/**
 * golden run:對一個任務的固定輸入跑一次 router、把輸出、prompt 快照、
 * 執行環境(model/provider/日期/prompt 檔的 git commit)、評分表一起存到
 * `golden/<task>/<ISO date>/`。Wave 0 phase-1 只支援 fake 模式。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { DEFAULT_SPEND_PRICES, LlmRouterImpl, resolveVaultLearningDir, type RouterSettings } from '@core/llm/index.js';
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

/** 沒指定 baseDir 時,依模式決定預設存放處。 */
export function defaultGoldenBaseDir(mode: GoldenRunMeta['mode']): string {
  return mode === 'fake' ? DEFAULT_FAKE_GOLDEN_BASE_DIR : DEFAULT_GOLDEN_BASE_DIR;
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
   * 這次呼叫要記進哪個 learning/ 目錄(契約 §11 的 settings.llm、契約 §10 的 log.jsonl)。
   * 不給就是 `resolveVaultLearningDir()`(ADR-051:主簽出的 learning/,不管現在
   * 站在哪個 git worktree,一律指回同一份帳本——理由見 `packages/core/src/llm/vault.ts`)。
   * **測試一律要傳暫存目錄**(ADR-032)——不然每跑一次測試就真的往主簽出的
   * `learning/state/log.jsonl` 加一行,那是使用者的記帳資料,不是測試夾具。
   */
  learningDir?: string;
}

function gitCommitOf(relPath: string): string {
  const r = spawnSync('git', ['log', '-1', '--format=%h', '--', relPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const out = (r.stdout ?? '').trim();
  return out || 'uncommitted';
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
  const date = opts.today ?? today();
  const baseDir = opts.baseDir ?? defaultGoldenBaseDir(mode);
  const dir = join(baseDir, goldenSet.id, date);
  mkdirSync(dir, { recursive: true });

  const router = opts.router ?? witnessed('prompt-quality.router-default-fake', new FakeLlmRouter([DEFAULT_FAKE_FIXTURE_DIR], opts.onCall));

  const promptFileAbs = join(ROOT, goldenSet.promptFile);
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
    promptFileGitCommit: gitCommitOf(goldenSet.promptFile),
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

  const router = opts.router ?? (opts.createRouter ? opts.createRouter() : createDefaultLiveRouter(opts.learningDir));

  // 順序有意義:先確認連得上、再讀 prompt 檔,兩件事都成功才建立目錄。
  // 反過來的話離線那次會留下一個空目錄,之後 diff 會把它當成一次 run。
  if (!(await router.probeOnline())) throw new LiveRunOfflineError(goldenSet.id);

  const promptFileAbs = join(ROOT, goldenSet.promptFile);
  if (!existsSync(promptFileAbs)) {
    throw new Error(`golden set「${goldenSet.id}」指向的 prompt 檔不存在:${goldenSet.promptFile}`);
  }
  const promptContent = readFileSync(promptFileAbs, 'utf8');

  const mode: GoldenRunMeta['mode'] = 'live';
  const date = opts.today ?? today();
  const baseDir = opts.baseDir ?? defaultGoldenBaseDir(mode);
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
    promptFileGitCommit: gitCommitOf(goldenSet.promptFile),
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
 * `learningDir` 不給就是 `resolveVaultLearningDir()`——主簽出的 learning/,不是
 * 目前這個 git worktree 自己的一份(ADR-051:learning/ 是使用者跨 worktree 共用的
 * 帳本,每個 worktree 各自一份會讓每日預算上限變成「每個簽出各算一次」,而且
 * worktree 被清掉時那份花費紀錄會永久消失)。`RunGoldenOptions.learningDir`
 * 的測試一律要傳暫存目錄(ADR-032),理由見那個欄位的註解。
 */
/**
 * `learningDir` 不給時的實際決策,拆成獨立函式方便測——不用真的呼叫
 * `createDefaultLiveRouter()`(那會真的 `mkdirSync` 一次)就能斷言「沒給的話
 * 退回哪裡」,跟 scripts/llm-spend.ts 的 `resolveLogPath()` 同一個理由。
 */
export function resolveLiveLearningDir(learningDir?: string): string {
  return learningDir ?? resolveVaultLearningDir(ROOT);
}

export function createDefaultLiveRouter(learningDir?: string): LlmRouter {
  const dir = resolveLiveLearningDir(learningDir);
  const logPath = join(dir, 'state/log.jsonl');
  // learning/ 整個目錄是 gitignored(使用者的資料),第一次跑在這台機器上可能
  // 還不存在——append-only 的 log 寫入(atomic-write.ts 的 appendLineAtomic())
  // 只開檔不建目錄,建不起來就先建好,不要讓「目錄不存在」偽裝成別的錯誤。
  mkdirSync(join(dir, 'state'), { recursive: true });
  return new LlmRouterImpl({
    settings: readLlmSettings(dir),
    logPath,
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
