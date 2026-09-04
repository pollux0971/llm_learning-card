/**
 * phase-4(ADR-039):把 phase-2 的 `LlmRouterImpl` 包起來,加上這個 phase 的三樣東西:
 *
 * 1. **真的 `probeLocal()`**——委派給 `GatewayClient.probe()`(換 token +
 *    `GET /gateway/models`)。phase-2 的 `alwaysUnavailable` 從此只是預設值。
 * 2. **閘道呼叫**——`grade.fill.llm` 一律走閘道;`deepen` / `grade.apply` /
 *    `reteach.short` 在雲端不能用的時候走閘道並標 `provisional = true`。
 * 3. **當日預算**——呼叫雲端**之前**先算今天花了多少(`spend.ts`),達上限就當作
 *    `cloud === 'budget-exhausted'` 交給 `fallback.ts` 決定。
 *
 * 這個檔案**不改 `router.ts` 與 `router-impl.ts` 的任何一行**——那是 phase-1 /
 * phase-2 已經測過、驗收過的邏輯,只用組合(把它們當底層依賴注入),跟 phase-2
 * 包 phase-1 的做法一致。
 *
 * 決策本身也不在這裡:契約 §7 的路由表在 `routing.ts`(純函式),ADR-039 的備援
 * 規則在 `fallback.ts`(純函式),金額計算在 `spend.ts`(純函式)。這個類別只負責
 * 把 I/O(探測、呼叫、寫 log)接到那三個純函式上。
 *
 * -------------------------------------------------------------- 公開介面清單
 *
 * - `CLOUD_FAILURE_ERRORS`:哪些錯誤算「雲端這次不能用、可以備援」——
 *   `LlmTimeoutError`(逾時)、`OutputTruncatedError`(截斷,重試後仍失敗)、
 *   以及 HTTP 5xx。**不包含** `MissingCredentialError` / `UnsupportedProviderError` /
 *   `UnknownTaskError`:那些是設定或呼叫端的錯,備援只會讓錯誤設定藏著。
 * - `isCloudFailure(err)`:上面那條規則的判斷函式。
 * - `GatewayLlmRouterOptions`:phase-2 `LlmRouterImplOptions` 全部 +
 *     - `gateway?: GatewayClient`(不給就用 `createGatewayClient(env)`)
 *     - `fallbackTable?: Readonly<Record<LlmTask, FallbackGroup>>`(預設 FALLBACK_TABLE)
 *     - `dailyCapUsd?: number`(預設 `readDailyCapUsd(env)`)
 *     - `prices?: SpendPrices`(預設 `readSpendPrices(env)`)
 *     - `spendReader?: (day: string) => DailySpend`(測試注入;預設讀 `logPath`)
 *     - `today?: () => string`(預設 `dayOf(new Date().toISOString())`)
 * - `class GatewayLlmRouter implements LlmRouter`
 *     - `call(task, prompt, opts?)`:
 *       1. `cloudStatus()`:預算達上限 → `'budget-exhausted'`,否則 `'ok'`。
 *       2. `decideFallback({ task, cloud })`。`cloud-only` + 預算用完在這一步就
 *          丟 `DailyBudgetExceededError`——**在花錢之前拒絕**。
 *       3. `target === 'gateway'` → `callGateway()`;`target === 'cloud'` →
 *          底層 `LlmRouterImpl.call()`。
 *       4. 雲端丟出 `isCloudFailure()` 認得的錯 → 用 `cloud: 'failed'` 重跑一次
 *          `decideFallback`。再回 cloud 就代表沒有備援(`cloud-only`),把原本的
 *          錯誤往外丟(`ingest.*` 得到 `CloudRequiredError`)。
 *       5. 備援成功時,除了底層已經寫的 `llm_call` 事件之外,再寫一筆帶
 *          `fallback: "gateway"` 與 `fallback_reason`(`cloud_failed` /
 *          `budget_exhausted`)的 `llm_call` 事件,並記下原本的錯誤訊息
 *          (`fallback_from` / `error`)。
 *     - `probeOnline()`:直接委派底層(快取行為不變)。
 *     - `probeLocal()`:委派 `GatewayClient.probe()`;任何錯誤接住回
 *       `{ available: false, models: [] }`。
 *     - `dailySpend(): DailySpend` / `budgetExhausted(): boolean`:給
 *       `scripts/llm-spend.ts` 與測試用。
 *
 * 本體先留空/丟 not implemented,邏輯留給下一輪開發 agent。測試見 router-gateway.test.ts。
 */

import type { LlmResult, LlmRouter, LlmTask } from './types.js';
import { LlmRouterImpl, type LlmRouterImplOptions } from './router-impl.js';
import { GatewayClient } from './adapters/gateway.js';
import { FALLBACK_TABLE, type FallbackGroup } from './fallback.js';
import { type DailySpend, type SpendPrices } from './spend.js';

/**
 * 「雲端這次不能用,可以備援」的錯誤類別名單。用 `name` 比對而不是 instanceof
 * 的清單,是為了讓 HTTP 5xx 這種沒有專屬 Error 類別的情況也能走同一條路
 * (實作時把 status >= 500 的判斷也放進 `isCloudFailure`)。
 */
export const CLOUD_FAILURE_ERRORS = ['LlmTimeoutError', 'OutputTruncatedError'] as const;

/**
 * 哪些錯誤算「雲端這次不能用」。設定錯誤(缺憑證、provider 不支援、task 不在契約裡)
 * **不算**——備援只會讓錯誤設定一直藏著。
 */
export function isCloudFailure(_err: unknown): boolean {
  throw new Error('not implemented: isCloudFailure (03-llm-router/phase-4)');
}

export interface GatewayLlmRouterOptions extends LlmRouterImplOptions {
  /** 不給就用 createGatewayClient(env) */
  gateway?: GatewayClient;
  /** ADR-039 的備援表,預設 FALLBACK_TABLE */
  fallbackTable?: Readonly<Record<LlmTask, FallbackGroup>>;
  /** 預設 readDailyCapUsd(env) */
  dailyCapUsd?: number;
  /** 預設 readSpendPrices(env) */
  prices?: SpendPrices;
  /** 測試注入;預設從 logPath 讀 log.jsonl 算 */
  spendReader?: (day: string) => DailySpend;
  /** 「今天」是哪一天,預設本地日期 */
  today?: () => string;
}

export class GatewayLlmRouter implements LlmRouter {
  private readonly opts: GatewayLlmRouterOptions;
  private readonly inner: LlmRouterImpl;
  private readonly fallbackTable: Readonly<Record<LlmTask, FallbackGroup>>;

  constructor(opts: GatewayLlmRouterOptions = {}) {
    this.opts = opts;
    this.inner = opts.cloudRouter ? new LlmRouterImpl(opts) : new LlmRouterImpl(opts);
    this.fallbackTable = opts.fallbackTable ?? FALLBACK_TABLE;
  }

  async call(_task: LlmTask, _prompt: string, _opts: { timeoutMs?: number; maxTokens?: number } = {}): Promise<LlmResult> {
    void this.inner;
    void this.fallbackTable;
    void this.opts;
    throw new Error('not implemented: GatewayLlmRouter.call (03-llm-router/phase-4)');
  }

  /** 直接委派底層,快取行為不變。 */
  async probeOnline(): Promise<boolean> {
    throw new Error('not implemented: GatewayLlmRouter.probeOnline (03-llm-router/phase-4)');
  }

  /** 委派 GatewayClient.probe();任何錯誤接住回 unavailable,不 throw。 */
  async probeLocal(): Promise<{ available: boolean; models: string[] }> {
    throw new Error('not implemented: GatewayLlmRouter.probeLocal (03-llm-router/phase-4)');
  }

  /** 今日花費(給 scripts/llm-spend.ts 與測試用)。 */
  dailySpend(): DailySpend {
    throw new Error('not implemented: GatewayLlmRouter.dailySpend (03-llm-router/phase-4)');
  }

  /** ADR-039:`spent >= cap` 就算達到。 */
  budgetExhausted(): boolean {
    throw new Error('not implemented: GatewayLlmRouter.budgetExhausted (03-llm-router/phase-4)');
  }
}
