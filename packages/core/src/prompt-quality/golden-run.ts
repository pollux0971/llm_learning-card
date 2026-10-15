/**
 * golden run:對一個任務的固定輸入跑一次 router、把輸出、prompt 快照、
 * 執行環境(model/provider/日期/prompt 檔的 git commit)、評分表一起存到
 * `golden/<task>/<ISO date>/`。Wave 0 phase-1 只支援 fake 模式。
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse as yamlParse } from 'yaml';
import {
  DEFAULT_SPEND_PRICES,
  LlmRouterImpl,
  defaultVaultDeps,
  resolveVerifiedLedger,
  type RouterSettings,
  type VaultResolveDeps,
} from '@core/llm/index.js';
import { FakeLlmRouter } from './fake-llm.js';
import { getGoldenSet, GOLDEN_SET_REGISTRY_FILE } from './golden-sets/registry.js';
import { runStructuralChecks } from './structural-checks.js';
import { renderScoresSheet } from './scores.js';
import { witnessed } from '@contracts/witness.js';
import type { GoldenOutput, GoldenRunMeta, GoldenRunResult, GoldenSet, GoldenSetId, LlmRouter } from './types.js';

export const ROOT = resolve(import.meta.dirname, '../../../..');
/** live run(phase-2)的存放處:進 git,diff 看得到(FEATURE.md「golden 儲存」)。 */
export const DEFAULT_GOLDEN_BASE_DIR = join(ROOT, 'packages/core/src/prompt-quality/golden');
/**
 * fake run 的存放處:重播 fixture 的輸出沒有品質資訊,不值得進 git,
 * 所以放在 .gitignore 掉的目錄。CI / 單獨執行 `--golden --fake` 跑完 git status 仍是乾淨的。
 */
export const DEFAULT_FAKE_GOLDEN_BASE_DIR = join(ROOT, 'packages/core/src/prompt-quality/golden-fake');
export const DEFAULT_FAKE_FIXTURE_DIR = join(ROOT, 'packages/core/src/prompt-quality/fixtures/llm');

const GOLDEN_DIR_REL = 'packages/core/src/prompt-quality/golden';
const FAKE_GOLDEN_DIR_REL = 'packages/core/src/prompt-quality/golden-fake';

/**
 * 沒指定 baseDir 時,依模式決定預設存放處。
 * `root` 給了就把存放處搬到那個 repo 底下(測試用 mkdtemp,不碰真的 golden/)。
 * 不給 `root` 時回傳既有常數,既有呼叫的行為不變。
 */
export function defaultGoldenBaseDir(mode: GoldenRunMeta['mode'], root?: string): string {
  if (root === undefined) {
    return mode === 'fake' ? DEFAULT_FAKE_GOLDEN_BASE_DIR : DEFAULT_GOLDEN_BASE_DIR;
  }
  return join(root, mode === 'fake' ? FAKE_GOLDEN_DIR_REL : GOLDEN_DIR_REL);
}

export class MissingGoldenSetError extends Error {
  constructor(public readonly set: string) {
    super(`golden set「${set}」沒有登記,去 ${GOLDEN_SET_REGISTRY_FILE} 定義它的固定輸入`);
    this.name = 'MissingGoldenSetError';
  }
}

export class LiveRunOfflineError extends Error {
  constructor(public readonly set: string) {
    super(`live golden run 需要雲端,現在連不上(set=${set})。要離線跑就用 --fake,那是重播 fixture、沒有品質資訊。`);
    this.name = 'LiveRunOfflineError';
  }
}

/**
 * dirty 的 prompt 不能寫進 golden/(回歸基準必須能用某個 commit 的 prompt 重現)。
 * 在任何 router.call 之前、在建立任何目錄之前丟出。
 */
export class DirtyPromptError extends Error {
  constructor(
    public readonly set: string,
    public readonly promptFile: string,
  ) {
    super(
      `prompt 檔 ${promptFile} 有未提交的修改(dirty),不能寫進 golden/:` +
        `回歸基準必須能用某個 commit 的 prompt 重現。先提交這個檔,或用 --out 指到 golden/ 以外。`,
    );
    this.name = 'DirtyPromptError';
  }
}

/**
 * 粗估用的價目表:model → 每百萬 token 的美金單價。
 *
 * **不是計費依據,也不是真的煞車**(ADR-050)。真正擋預算的是 `spend.ts` 的
 * `computeDailySpend()`,那邊讀的是 `.env` 的 `LLM_PRICE_IN_PER_M` /
 * `LLM_PRICE_OUT_PER_M` 一組固定費率,完全不看 model 名字——只要 provider 是
 * openai 就照那組費率算,`LLM_DAILY_CAP_USD` 一樣會擋下來。這張表只是讓
 * golden run 的 SCORES.md / CLI 輸出多印一個「大概花多少」的估計,**跟預算煞車
 * 是兩個互相獨立的機制**,不要看到這張表印「不估」就以為煞車也沒接上。
 *
 * model 不在表上就只回報 token 數、不填 estimated_cost_usd——寧可不給數字,
 * 也不要給一個看起來像帳單的假數字。`gpt-5.6-luna`(目前 .env 設定的雲端模型)
 * 沒有公開牌價,借用跟 `spend.ts` 的 `DEFAULT_SPEND_PRICES` 同一組數字
 * (`.env.example` 記的預設)當估計,不是真的官方報價。
 */
export type ModelPriceTable = Record<string, { inPerMTok: number; outPerMTok: number }>;
export const DEFAULT_MODEL_PRICES: ModelPriceTable = {
  'gpt-5.6-luna': { inPerMTok: DEFAULT_SPEND_PRICES.inPerM, outPerMTok: DEFAULT_SPEND_PRICES.outPerM },
};

export interface RunGoldenOptions {
  /** 跑哪一組 golden set。**不是 LlmTask**——三個 ingest prompt 檔共用 'ingest.cards'。 */
  set: GoldenSetId;
  /** 這次 run 的日期,預設今天(YYYY-MM-DD)。同一天重跑會覆蓋同一個目錄。 */
  today?: string;
  /** 預設是自備的 FakeLlmRouter,phase-1 只有這個模式 */
  router?: LlmRouter;
  /** 每次呼叫 router.call 都會觸發,方便呼叫端(cucumber World)記錄 llmCalls */
  onCall?: (task: string, prompt: string) => void;
  /**
   * 存放根目錄。不給就依模式用 defaultGoldenBaseDir()。
   * 測試一律要傳暫存目錄,不要讓測試對 repo 裡的檔案讀寫或刪除(審核意見,ADR-032)。
   */
  baseDir?: string;
  /**
   * phase-2:'live' 走 03-llm-router 的真 router 打雲端;預設 'fake' 重播 fixture。
   * live 會先 probeOnline(),連不上就丟 LiveRunOfflineError,**而且不建立目錄**
   * ——半個空目錄比沒有目錄更糟,之後 diff 會拿它當一次 run。
   */
  mode?: GoldenRunMeta['mode'];
  /**
   * live 模式建立 router 的工廠。預設用 03 的 LlmRouterImpl(讀 env 的 provider/model/金鑰)。
   * 測試傳自己的工廠,或者在 globalThis.fetch 那一層造假——後者是首選,
   * 那樣 router / adapter / SDK 全都跑真的(見 features/steps/_fake-cloud.mjs 的理由)。
   */
  createRouter?: () => LlmRouter;
  /** 估價用的價目表,預設 DEFAULT_MODEL_PRICES */
  prices?: ModelPriceTable;
  /**
   * 只有沒給 `router` / `createRouter`(用預設的 `createDefaultLiveRouter()`)時才有作用:
   * 讀哪個目錄的 `config/settings.yaml`(契約 §11 的 settings.llm)。**只管輸出 / 設定的位置,不管帳本**
   * (T5 / ADR-066):帳本一律是使用者層指標檔指向、經身分標記驗證的那本,`--live --out /tmp/x`
   * 不會把錢記進 `/tmp/x/state/log.jsonl`——那樣日上限又裂成兩本。不給就是帳本那本 learning/。
   * **測試一律要用沙箱的 HOME / XDG_CONFIG_HOME 與合成指標**(ADR-032、T5 第 15 條)——
   * 不然會讀到使用者真的指標檔,往真的帳本加一行。
   */
  learningDir?: string;
  /**
   * 讀 prompt 檔與問 git 的 repo 根。不給就是 ROOT,既有呼叫的行為不變。
   * 測試傳 mkdtemp 的 git repo,才不會碰真的 prompts/ 與 golden/。
   */
  root?: string;
}

/**
 * prompt 檔在 `root` 這個 repo 裡的短 sha。只看這個檔,不看整個 repo。
 *
 * 已追蹤且有 commit,但 `git diff --quiet -- <檔>` 或 `git diff --cached --quiet -- <檔>`
 * 任一不為 0 → `<短 sha>-dirty`。沒追蹤、沒有 commit、不是 git repo → `uncommitted`(不加後綴)。
 */
export function gitCommitOf(relPath: string, root: string = ROOT): string {
  const log = spawnSync('git', ['log', '-1', '--format=%h', '--', relPath], {
    cwd: root,
    encoding: 'utf8',
  });
  const sha = (log.stdout ?? '').trim();
  if (!sha) return 'uncommitted';
  const worktree = spawnSync('git', ['diff', '--quiet', '--', relPath], { cwd: root });
  const index = spawnSync('git', ['diff', '--cached', '--quiet', '--', relPath], { cwd: root });
  if (worktree.status !== 0 || index.status !== 0) return `${sha}-dirty`;
  return sha;
}

/**
 * 解析成可跟 symlink 對齊的絕對路徑。路徑還不存在時,取最近一個存在的祖先做 realpath,
 * 再接回剩下的路徑。`..` 先由 resolve 折掉。
 */
function resolveOutputPath(p: string): string {
  const abs = resolve(p);
  const missing: string[] = [];
  let cursor = abs;
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return abs;
    missing.push(basename(cursor));
    cursor = parent;
  }
  const real = realpathSync(cursor);
  return missing.length === 0 ? real : join(real, ...missing.reverse());
}

/**
 * 輸出目錄的 realpath 是否落在 `<root>/…/golden/` 底下(含它本身)。
 * 比路徑邊界,不是字串前綴:golden-fake/、golden-extra/ 不算。
 * golden/ 自己的位置也走 realpath(root 可能是 symlink)。
 */
function isInsideGolden(baseDir: string, root: string): boolean {
  const golden = resolveOutputPath(join(root, GOLDEN_DIR_REL));
  const out = resolveOutputPath(baseDir);
  const rel = relative(golden, out);
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
  return true;
}

function repoRootOf(opts: RunGoldenOptions): string {
  return opts.root ?? ROOT;
}

function resolveRunBaseDir(mode: GoldenRunMeta['mode'], opts: RunGoldenOptions): string {
  if (opts.baseDir !== undefined) return opts.baseDir;
  if (opts.root !== undefined) return defaultGoldenBaseDir(mode, opts.root);
  return defaultGoldenBaseDir(mode);
}

/**
 * dirty 的 prompt 若會寫進 golden/ 就拒絕。必須在建立目錄與 router.call 之前呼叫。
 * 回傳要寫進 meta 的 commit 字串(乾淨 sha、`<sha>-dirty` 或 uncommitted)。
 */
function commitForRun(opts: RunGoldenOptions, goldenSet: GoldenSet, mode: GoldenRunMeta['mode']): string {
  const root = repoRootOf(opts);
  const commit = gitCommitOf(goldenSet.promptFile, root);
  if (commit.endsWith('-dirty') && isInsideGolden(resolveRunBaseDir(mode, opts), root)) {
    throw new DirtyPromptError(goldenSet.id, goldenSet.promptFile);
  }
  return commit;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runGolden(opts: RunGoldenOptions): Promise<GoldenRunResult> {
  const goldenSet = getGoldenSet(opts.set);
  if (!goldenSet) throw new MissingGoldenSetError(opts.set);

  if ((opts.mode ?? witnessed('prompt-quality.mode-default-fake', 'fake')) === 'live') return runGoldenLive(opts, goldenSet);
  return runGoldenFake(opts, goldenSet);
}

/**
 * 真正送進 router 的 prompt = prompt 檔的內容 + 這一則輸入會變動的那一半。
 *
 * 這一步是這整個資料夾的重點。少了它,golden run 只是把 prompt 檔快照下來、
 * 卻從來沒有把它送出去:改了 `cards.md` 再 `--diff` 會拿到「沒有變化」,
 * 因為被比的東西裡根本沒有那個 prompt。
 */
export function composeGoldenPrompt(promptFileContent: string, inputPrompt: string): string {
  return `${promptFileContent}\n${inputPrompt}`;
}

/**
 * fake 模式的 golden run:重播 fixture,不碰網路也不花錢。
 *
 * 審核記錄:第二個參數是後補的,理由跟 runGoldenLive 一樣——原本這段程式碼藏在
 * runGolden 裡面,golden set 一律從 registry 拿,所以「prompt 檔不存在」那個分支
 * 與「golden set 沒有輸入時 model 落在 unknown」那條路**沒有任何辦法從測試走到**
 * (registry 裡登記的那一組永遠有檔案、永遠有 3 個輸入)。兩條路徑現在形狀一致。
 */
export async function runGoldenFake(opts: RunGoldenOptions, set?: GoldenSet): Promise<GoldenRunResult> {
  const goldenSet = set ?? getGoldenSet(opts.set);
  if (!goldenSet) throw new MissingGoldenSetError(opts.set);

  const mode: GoldenRunMeta['mode'] = 'fake';
  const root = repoRootOf(opts);
  // 拒絕在 mkdir 與 router.call 之前:dirty 且輸出會落在 golden/ 時不留空目錄、不呼叫。
  const promptFileGitCommit = commitForRun(opts, goldenSet, mode);
  const date = opts.today ?? today();
  const baseDir = resolveRunBaseDir(mode, opts);
  const dir = join(baseDir, goldenSet.id, date);
  mkdirSync(dir, { recursive: true });

  const router = opts.router ?? witnessed('prompt-quality.router-default-fake', new FakeLlmRouter([DEFAULT_FAKE_FIXTURE_DIR], opts.onCall));

  const promptFileAbs = join(root, goldenSet.promptFile);
  if (!existsSync(promptFileAbs)) {
    throw new Error(`golden set「${goldenSet.id}」指向的 prompt 檔不存在:${goldenSet.promptFile}`);
  }
  const promptContent = readFileSync(promptFileAbs, 'utf8');
  writeFileSync(join(dir, 'prompt.snapshot.md'), promptContent);

  const outputs: GoldenOutput[] = [];
  let model = 'unknown';
  let provider = 'unknown';
  for (const input of goldenSet.inputs) {
    const result = await router.call(goldenSet.task, composeGoldenPrompt(promptContent, input.prompt));
    model = result.model;
    provider = result.provider;
    const structural = runStructuralChecks(result.text);
    const output: GoldenOutput = { id: input.id, text: result.text, structural };
    writeFileSync(join(dir, `${input.id}.output.json`), JSON.stringify(output, null, 2));
    outputs.push(output);
  }

  const meta: GoldenRunMeta = {
    set: goldenSet.id,
    task: goldenSet.task,
    date,
    model,
    provider,
    promptFileGitCommit,
    mode,
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  writeFileSync(
    join(dir, 'SCORES.md'),
    renderScoresSheet(
      goldenSet.id,
      date,
      goldenSet.inputs.map((i) => i.id),
    ),
  );

  return { dir, meta, outputs };
}

/**
 * live 模式的 golden run(phase-2)。跟 fake 路徑的差別:
 *   1. router 是 03 的真 router(預設 LlmRouterImpl),provider/model/金鑰讀 env(契約 §11)
 *   2. **先 probeOnline()**;連不上就丟 LiveRunOfflineError,而且在那之前不建立任何目錄
 *   3. meta 記 tokens_in / tokens_out 合計,model 在價目表上時再填 estimated_cost_usd
 *   4. 每次呼叫都經過 router 自己的 log(§10 llm_call 事件),這裡不另外記一份
 *   5. 沒指定 baseDir 時存到 golden/(進 git),不是 golden-fake/
 * 其餘(prompt 快照、逐項 output、結構性檢查、SCORES.md)跟 fake 路徑一致。
 */
export async function runGoldenLive(opts: RunGoldenOptions, set?: GoldenSet): Promise<GoldenRunResult> {
  const goldenSet = set ?? getGoldenSet(opts.set);
  if (!goldenSet) throw new MissingGoldenSetError(opts.set);

  const mode: GoldenRunMeta['mode'] = 'live';
  const root = repoRootOf(opts);
  // 拒絕在建立 router(預設路徑會 mkdir state/)、probeOnline、router.call、mkdir 之前:
  // dirty 且輸出會落在 golden/ 時不花錢、不留空目錄。
  const promptFileGitCommit = commitForRun(opts, goldenSet, mode);

  const router = opts.router ?? (opts.createRouter ? opts.createRouter() : createDefaultLiveRouter(opts.learningDir));

  // 順序有意義:先確認連得上、再讀 prompt 檔,兩件事都成功才建立目錄。
  // 反過來的話離線那次會留下一個空目錄,之後 diff 會把它當成一次 run。
  if (!(await router.probeOnline())) throw new LiveRunOfflineError(goldenSet.id);

  const promptFileAbs = join(root, goldenSet.promptFile);
  if (!existsSync(promptFileAbs)) {
    throw new Error(`golden set「${goldenSet.id}」指向的 prompt 檔不存在:${goldenSet.promptFile}`);
  }
  const promptContent = readFileSync(promptFileAbs, 'utf8');

  const date = opts.today ?? today();
  const baseDir = resolveRunBaseDir(mode, opts);
  const dir = join(baseDir, goldenSet.id, date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.snapshot.md'), promptContent);

  const outputs: GoldenOutput[] = [];
  let model = 'unknown';
  let provider = 'unknown';
  let tokensIn = 0;
  let tokensOut = 0;
  for (const input of goldenSet.inputs) {
    const prompt = composeGoldenPrompt(promptContent, input.prompt);
    opts.onCall?.(goldenSet.task, prompt);
    // 呼叫本身的 log(契約 §10 的 llm_call)由 router 自己寫,這裡不另外記一份。
    const result = await router.call(goldenSet.task, prompt);
    model = result.model;
    provider = result.provider;
    tokensIn += result.tokens_in ?? 0;
    tokensOut += result.tokens_out ?? 0;
    const structural = runStructuralChecks(result.text);
    const output: GoldenOutput = { id: input.id, text: result.text, structural };
    writeFileSync(join(dir, `${input.id}.output.json`), JSON.stringify(output, null, 2));
    outputs.push(output);
  }

  const cost = estimateCostUsd(model, tokensIn, tokensOut, opts.prices ?? DEFAULT_MODEL_PRICES);
  const meta: GoldenRunMeta = {
    set: goldenSet.id,
    task: goldenSet.task,
    date,
    model,
    provider,
    promptFileGitCommit,
    mode,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    // exactOptionalPropertyTypes:沒有價目就整個欄位不存在,不是一個 undefined 的值。
    ...(cost === undefined ? {} : { estimated_cost_usd: cost }),
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  writeFileSync(
    join(dir, 'SCORES.md'),
    renderScoresSheet(
      goldenSet.id,
      date,
      goldenSet.inputs.map((i) => i.id),
    ),
  );

  return { dir, meta, outputs };
}

/** 讀 <learningDir>/config/settings.yaml 的 llm 區塊,跟 scripts/ingest.ts 的 readLlmSettings() 同一套讀法。 */
function readLlmSettings(learningDir: string): RouterSettings {
  const settingsPath = join(learningDir, 'config/settings.yaml');
  if (!existsSync(settingsPath)) return {};
  const parsed = yamlParse(readFileSync(settingsPath, 'utf8')) as { llm?: RouterSettings } | null;
  return parsed?.llm ?? {};
}

/**
 * 建立 live 模式預設的 router(03-llm-router 的 LlmRouterImpl)。
 *
 * ADR-050 之前這裡沒給 `settings` 也沒給 `logPath`——那行舊註解「provider / model /
 * 金鑰全部由 03 依契約 §11 從 env 與 settings 解析」是錯的:`settings` 不是從 env
 * 解析出來的,是呼叫端要主動讀檔案再傳進去(照 scripts/ingest.ts:95 的寫法);
 * `logPath` 更不是「解析」得出來的東西,是呼叫端自己決定要不要記帳。
 * 少了 logPath,`LlmRouterImpl.call()` 現在會直接丟 `UnaccountableLlmCallError`
 * ——這是故意的煞車,不是退化。
 *
 * 帳本(T5 / ADR-066,契約 §12 1.4.0):**只**來自使用者層指標檔與身分標記驗證過的那本
 * (`resolveVerifiedLedger`)——不是主簽出的 learning/(ADR-051 用 git 位置解析的那一半已被取代:
 * 它在 clone 之間各算各的),也不是 `learningDir`。指標不存在、讀不到、learning_dir 不存在、
 * 標記不符:丟錯(訊息帶 `npx tsx scripts/vault.ts init` / `show`),**不建 router、不建任何目錄**。
 * `learningDir` 只決定讀哪裡的 `config/settings.yaml`(見 `RunGoldenOptions.learningDir`)。
 *
 * `deps` 只在測試注入;零參數的預設值是入口層,才拿真的 `process.env` / `os.homedir()`。
 */
export function createDefaultLiveRouter(learningDir?: string, deps: VaultResolveDeps = defaultVaultDeps()): LlmRouter {
  const resolved = resolveVerifiedLedger(deps);
  if (!resolved.ok) throw new Error(resolved.message);
  const settingsDir = learningDir ?? resolved.ledger.learningDir;
  // 驗證過的 learning/ 一定存在;全新安裝時 state/ 可能還沒有——append-only 的 log 寫入
  // (atomic-write.ts 的 appendLineAtomic())只開檔不建目錄,所以先建好。只建在驗證過的那本底下。
  mkdirSync(join(resolved.ledger.learningDir, 'state'), { recursive: true });
  return new LlmRouterImpl({
    settings: readLlmSettings(settingsDir),
    logPath: resolved.ledger.logPath,
    // 明講底層的本機探測(跟預設值同義:ADR-039 之後閘道才是「本機」),不借道
    // llm.router-impl.local-prober-default 那條退化分支(ADR-044)。
    localProber: async () => ({ available: false, models: [] }),
  });
}

/** token 合計 → 美金粗估。model 不在表上回 undefined(不猜)。 */
export function estimateCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number,
  prices: ModelPriceTable = DEFAULT_MODEL_PRICES,
): number | undefined {
  const price = prices[model];
  if (!price) return undefined;
  return (tokensIn / 1_000_000) * price.inPerMTok + (tokensOut / 1_000_000) * price.outPerMTok;
}
