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
 *          `decideFallback`。沒有備援的 `cloud-only`(`ingest.*`)在這一步就被
 *          `decideFallback` **丟出** `CloudRequiredError`(蓋掉原本的雲端錯誤);
 *          會回傳的兩組一律是 `target: 'gateway'`,所以之後直接走閘道。
 *       5. 備援成功時,除了底層已經寫的 `llm_call` 事件之外,再寫一筆帶
 *          `fallback: "gateway"` 與 `fallback_reason`(`cloud_failed` /
 *          `budget_exhausted`)的 `llm_call` 事件,並記下原本的錯誤訊息
 *          (`fallback_from` / `error`)。
 *       6. 閘道呼叫失敗(`GatewayCallError`)一律轉成契約 §7 的 `NoModelError`,
 *          原始錯誤放 `cause`。閘道就是 ADR-039 決策 1 的「本機」,所以打不通就是
 *          §7 的「離線+無本機」那一格;`GATEWAY_FAILED` 只留在 adapter 內部,
 *          不外洩到這個介面。403(`GatewayModelRejectedError`)不轉,原樣往外丟。
 *     - `probeOnline()`:直接委派底層(快取行為不變)。
 *     - `probeLocal()`:委派 `GatewayClient.probe()`;任何錯誤接住回
 *       `{ available: false, models: [] }`。
 *     - `dailySpend(): DailySpend` / `budgetExhausted(): boolean`:給
 *       `scripts/llm-spend.ts` 與測試用。
 *
 * 本體先留空/丟 not implemented,邏輯留給下一輪開發 agent。測試見 router-gateway.test.ts。
 */

import type { LlmResult, LlmRouter, LlmTask } from './types.js';
import type { LogEvent } from '@contracts/index.js';
import { recordEvent } from '@core/schema/log.js';
import { LlmRouterImpl, type LlmRouterImplOptions } from './router-impl.js';
import { GatewayClient, createGatewayClient } from './adapters/gateway.js';
import { GatewayCallError, NoModelError } from './errors.js';
import { FALLBACK_TABLE, decideFallback, type CloudStatus, type FallbackDecision, type FallbackGroup } from './fallback.js';
import {
  dayOf,
  isBudgetExhausted,
  readDailyCapUsd,
  readDailySpend,
  readSpendPrices,
  type DailySpend,
  type SpendPrices,
} from './spend.js';
import type { LogAppender } from './router.js';

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
export function isCloudFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ((CLOUD_FAILURE_ERRORS as readonly string[]).includes(err.name)) return true;

  // OpenAI SDK 的 APIError 沒有專屬類別可以認,但帶著 status。5xx 是「服務端這次
  // 不行」,4xx 是「請求本身有問題」——後者重試或換 provider 都沒有用。
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' && status >= 500;
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

/** 沒給 path 就不寫(例如純單元測試);給了就用 01 的 recordEvent() 原子寫入。 */
function createFileLogAppender(path: string | undefined): LogAppender {
  if (!path) return () => {};
  return (event) => recordEvent(path, event);
}

export class GatewayLlmRouter implements LlmRouter {
  private readonly opts: GatewayLlmRouterOptions;
  private readonly inner: LlmRouterImpl;
  private readonly fallbackTable: Readonly<Record<LlmTask, FallbackGroup>>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly log: LogAppender;
  private readonly capUsd: number;
  private readonly prices: SpendPrices;
  private readonly spendReader: (day: string) => DailySpend;
  private readonly today: () => string;
  /** 懶建立:沒設 GATEWAY_API_KEY 的人也要能只用雲端那半,不該在建構時就爆炸。 */
  private gatewayClient: GatewayClient | undefined;

  constructor(opts: GatewayLlmRouterOptions = {}) {
    this.opts = opts;
    this.inner = new LlmRouterImpl(opts);
    this.fallbackTable = opts.fallbackTable ?? FALLBACK_TABLE;
    this.env = opts.env ?? process.env;
    this.log = opts.logAppender ?? createFileLogAppender(opts.logPath);
    this.capUsd = opts.dailyCapUsd ?? readDailyCapUsd(this.env);
    this.prices = opts.prices ?? readSpendPrices(this.env);
    this.today = opts.today ?? (() => dayOf(new Date().toISOString()));
    this.spendReader =
      opts.spendReader ??
      ((day) => (opts.logPath ? readDailySpend(opts.logPath, day, this.prices) : { usd: 0, calls: 0 }));
    this.gatewayClient = opts.gateway;
  }

  async call(task: LlmTask, prompt: string, opts: { timeoutMs?: number; maxTokens?: number } = {}): Promise<LlmResult> {
    // 花錢之前先看今天花了多少。ingest.* 在這一步就會被 decideFallback 擋下來
    // (丟 DailyBudgetExceededError),雲端一次都不會被打到。
    const spend = this.dailySpend();
    const cloud: CloudStatus = isBudgetExhausted(spend.usd, this.capUsd) ? 'budget-exhausted' : 'ok';
    const decision = decideFallback(
      { task, cloud, spentUsd: spend.usd, capUsd: this.capUsd },
      this.fallbackTable,
    );

    if (decision.target === 'gateway') {
      return this.callGateway(task, prompt, decision, opts);
    }

    try {
      return await this.inner.call(task, prompt, opts);
    } catch (err) {
      // NoModelError 也算:那是「離線,而底層的 localProber 不知道有閘道」。
      // 閘道就是契約 §7 的 local,所以這裡接手,契約那張表的行為不變。
      if (!isCloudFailure(err) && !(err instanceof NoModelError)) throw err;

      // `cloud: 'failed'` 之下 decideFallback 只有兩種結局:gateway-always /
      // gateway-fallback 回 `target: 'gateway'`,cloud-only **自己丟
      // CloudRequiredError**。`ingest.*` 拿到 CLOUD_REQUIRED 就是靠這一行丟出來的
      // 錯誤(它會蓋掉原本的 err),不是靠事後檢查 target。所以下面直接走閘道,
      // 沒有「retry 又回到 cloud」這種情況要防。
      // 前提由 router-gateway.test.ts 的「備援重試:cloud "failed" 永遠不會回到
      // cloud」窮舉鎖住(7 個 task × 3 個分組 + 預設表 + 編譯期的分組窮舉)。
      const retry = decideFallback(
        { task, cloud: 'failed', spentUsd: spend.usd, capUsd: this.capUsd },
        this.fallbackTable,
      );
      return this.callGateway(task, prompt, retry, opts, err);
    }
  }

  /** 直接委派底層,快取行為不變。 */
  async probeOnline(): Promise<boolean> {
    return this.inner.probeOnline();
  }

  /** 委派 GatewayClient.probe();任何錯誤接住回 unavailable,不 throw。 */
  async probeLocal(): Promise<{ available: boolean; models: string[] }> {
    try {
      return await this.gateway().probe();
    } catch {
      // 例如 GATEWAY_API_KEY 沒設(createGatewayClient 丟 MissingCredentialError)。
      return { available: false, models: [] };
    }
  }

  /** 今日花費(給 scripts/llm-spend.ts 與測試用)。 */
  dailySpend(): DailySpend {
    return this.spendReader(this.today());
  }

  /** ADR-039:`spent >= cap` 就算達到。 */
  budgetExhausted(): boolean {
    return isBudgetExhausted(this.dailySpend().usd, this.capUsd);
  }

  /** 懶建立的閘道 client。同一個 router 共用一個,token 快取才有意義。 */
  private gateway(): GatewayClient {
    this.gatewayClient ??= createGatewayClient(this.env);
    return this.gatewayClient;
  }

  /**
   * 打閘道並寫一筆 llm_call。備援時多帶 `fallback` / `fallback_reason`,
   * 以及原本那個雲端錯誤(`fallback_from` / `error`)——不然事後看 log 只知道
   * 「這一筆走了本機」,不知道為什麼。
   */
  private async callGateway(
    task: LlmTask,
    prompt: string,
    decision: FallbackDecision,
    opts: { timeoutMs?: number; maxTokens?: number },
    cause?: unknown,
  ): Promise<LlmResult> {
    const client = this.gateway();
    const timeoutMs = opts.timeoutMs ?? this.opts.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);

    let result;
    try {
      result = await client.chat({
        prompt,
        model: client.config.model,
        ...(timer === undefined ? {} : { signal: controller.signal }),
      });
    } catch (err) {
      // 契約 §7 路由表第三欄「離線+無本機」只認 `NO_MODEL`。閘道就是 ADR-039
      // 決策 1 定義的「本機」,所以「閘道這次打不通」**就是**那一格,不是一種新的
      // 失敗種類。`GATEWAY_FAILED` 是閘道 adapter 的內部詞彙(「那台代理這次不行」),
      // 只留在 `cause` 裡當診斷資訊,不外洩到 router 的公開介面——不然每一個消費者
      // 都要多處理一個錯誤碼。訊息仍然說得清是閘道不可達,資訊不丟掉。
      //
      // 403(`GatewayModelRejectedError`)**不**在此列:那是設定錯誤(填了雲端模型名),
      // ADR-039 明寫要原樣往外丟,包起來只會讓錯誤設定藏著。
      if (err instanceof GatewayCallError) {
        throw new NoModelError(task, { detail: `local gateway unreachable: ${err.message}`, cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const event: Record<string, unknown> = {
      ts: new Date().toISOString(),
      type: 'llm_call',
      task,
      provider: result.provider,
      model: result.model,
      latency_ms: result.latency_ms,
      ...(result.tokens_in != null ? { tokens_in: result.tokens_in } : {}),
      ...(result.tokens_out != null ? { tokens_out: result.tokens_out } : {}),
    };
    if (decision.reason !== undefined) {
      event.fallback = 'gateway';
      event.fallback_reason = decision.reason;
      if (cause !== undefined) {
        event.fallback_from = 'openai';
        event.error = cause instanceof Error ? cause.message : String(cause);
      }
    }
    this.log(event as unknown as LogEvent);

    return { ...result, provisional: decision.provisional };
  }
}
