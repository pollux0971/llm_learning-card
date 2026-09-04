/**
 * golden run:對一個任務的固定輸入跑一次 router、把輸出、prompt 快照、
 * 執行環境(model/provider/日期/prompt 檔的 git commit)、評分表一起存到
 * `golden/<task>/<ISO date>/`。Wave 0 phase-1 只支援 fake 模式。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { LlmRouterImpl } from '@core/llm/index.js';
import { FakeLlmRouter } from './fake-llm.js';
import { getGoldenSet, GOLDEN_SET_REGISTRY_FILE } from './golden-sets/registry.js';
import { runStructuralChecks } from './structural-checks.js';
import { renderScoresSheet } from './scores.js';
import type { GoldenOutput, GoldenRunMeta, GoldenRunResult, GoldenSet, LlmRouter, LlmTask } from './types.js';

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
  constructor(public readonly task: string) {
    super(`task「${task}」沒有登記 golden set,去 ${GOLDEN_SET_REGISTRY_FILE} 定義它的固定輸入`);
    this.name = 'MissingGoldenSetError';
  }
}

export class LiveRunOfflineError extends Error {
  constructor(public readonly task: string) {
    super(`live golden run 需要雲端,現在連不上(task=${task})。要離線跑就用 --fake,那是重播 fixture、沒有品質資訊。`);
    this.name = 'LiveRunOfflineError';
  }
}

/**
 * 粗估用的價目表:model → 每百萬 token 的美金單價。
 * **不是計費依據**,只是讓人知道這次 golden run 大概花多少。價格會變,改這裡就好。
 * 預設是空的:model 不在表上就只回報 token 數、不填 estimated_cost_usd
 * ——寧可不給數字,也不要給一個看起來像帳單的假數字。
 */
export type ModelPriceTable = Record<string, { inPerMTok: number; outPerMTok: number }>;
export const DEFAULT_MODEL_PRICES: ModelPriceTable = {};

export interface RunGoldenOptions {
  task: LlmTask;
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
  /** 估價用的價目表,預設 DEFAULT_MODEL_PRICES(空的) */
  prices?: ModelPriceTable;
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
  const set = getGoldenSet(opts.task);
  if (!set) throw new MissingGoldenSetError(opts.task);

  if ((opts.mode ?? 'fake') === 'live') return runGoldenLive(opts, set);

  const mode: GoldenRunMeta['mode'] = 'fake';
  const date = opts.today ?? today();
  const baseDir = opts.baseDir ?? defaultGoldenBaseDir(mode);
  const dir = join(baseDir, set.task, date);
  mkdirSync(dir, { recursive: true });

  const router = opts.router ?? new FakeLlmRouter([DEFAULT_FAKE_FIXTURE_DIR], opts.onCall);

  const promptFileAbs = join(ROOT, set.promptFile);
  if (!existsSync(promptFileAbs)) {
    throw new Error(`golden set「${set.task}」指向的 prompt 檔不存在:${set.promptFile}`);
  }
  const promptContent = readFileSync(promptFileAbs, 'utf8');
  writeFileSync(join(dir, 'prompt.snapshot.md'), promptContent);

  const outputs: GoldenOutput[] = [];
  let model = 'unknown';
  let provider = 'unknown';
  for (const input of set.inputs) {
    const result = await router.call(set.task, input.prompt);
    model = result.model;
    provider = result.provider;
    const structural = runStructuralChecks(result.text);
    const output: GoldenOutput = { id: input.id, text: result.text, structural };
    writeFileSync(join(dir, `${input.id}.output.json`), JSON.stringify(output, null, 2));
    outputs.push(output);
  }

  const meta: GoldenRunMeta = {
    task: set.task,
    date,
    model,
    provider,
    promptFileGitCommit: gitCommitOf(set.promptFile),
    mode,
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  writeFileSync(
    join(dir, 'SCORES.md'),
    renderScoresSheet(
      set.task,
      date,
      set.inputs.map((i) => i.id),
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
  const goldenSet = set ?? getGoldenSet(opts.task);
  if (!goldenSet) throw new MissingGoldenSetError(opts.task);

  const router = opts.router ?? (opts.createRouter ?? createDefaultLiveRouter)();

  // 順序有意義:先確認連得上、再讀 prompt 檔,兩件事都成功才建立目錄。
  // 反過來的話離線那次會留下一個空目錄,之後 diff 會把它當成一次 run。
  if (!(await router.probeOnline())) throw new LiveRunOfflineError(goldenSet.task);

  const promptFileAbs = join(ROOT, goldenSet.promptFile);
  if (!existsSync(promptFileAbs)) {
    throw new Error(`golden set「${goldenSet.task}」指向的 prompt 檔不存在:${goldenSet.promptFile}`);
  }
  const promptContent = readFileSync(promptFileAbs, 'utf8');

  const mode: GoldenRunMeta['mode'] = 'live';
  const date = opts.today ?? today();
  const baseDir = opts.baseDir ?? defaultGoldenBaseDir(mode);
  const dir = join(baseDir, goldenSet.task, date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.snapshot.md'), promptContent);

  const outputs: GoldenOutput[] = [];
  let model = 'unknown';
  let provider = 'unknown';
  let tokensIn = 0;
  let tokensOut = 0;
  for (const input of goldenSet.inputs) {
    opts.onCall?.(goldenSet.task, input.prompt);
    // 呼叫本身的 log(契約 §10 的 llm_call)由 router 自己寫,這裡不另外記一份。
    const result = await router.call(goldenSet.task, input.prompt);
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
      goldenSet.task,
      date,
      goldenSet.inputs.map((i) => i.id),
    ),
  );

  return { dir, meta, outputs };
}

/** 建立 live 模式預設的 router(03-llm-router 的 LlmRouterImpl,讀 env)。 */
export function createDefaultLiveRouter(): LlmRouter {
  // 沒有參數:provider / model / 金鑰全部由 03 依契約 §11 從 env 與 settings 解析。
  // 硬規則「LLM 呼叫經過 llm-router 的介面」——這裡是 12 唯一碰 03 的地方。
  return new LlmRouterImpl();
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
