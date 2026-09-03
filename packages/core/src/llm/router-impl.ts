/**
 * phase-2:把 phase-1 的 `CloudLlmRouter`(雲端 call + 未快取的 probeOnline + 固定
 * unavailable 的 probeLocal)包起來,加上這個 phase 的三樣東西:
 *
 * 1. probeOnline() 的 60 秒快取(FEATURE.md:「網路可用性偵測含 60 秒快取」;
 *    phase-2.feature:10 秒內只打一次、90 秒後過期重打)。
 * 2. probeLocal() 的可注入介面——預設值(`alwaysUnavailable`)永遠回
 *    `{ available: false, models: [] }`(ADR-037,phase-2 沒有真的本機模型可測)。
 *    之後 phase-4 要接真的 Ollama HTTP 探測,只要換掉注入的 prober,不用動這個類別。
 * 3. `LLM_LOCAL_MODEL` 設定來源(契約 §11:環境變數覆蓋 `settings.llm.local_model`),
 *    對稱 phase-1 `CloudLlmRouter` 已有的 `LLM_CLOUD_MODEL` 解析。
 *
 * 這個檔案不改動 `router.ts` 裡 `CloudLlmRouter` 的任何一行——那是 phase-1 已經
 * 測過、驗收過的邏輯,只用組合(把它當底層依賴注入)。
 *
 * 路由決策本身(cloud/local/丟哪種錯誤)不在這裡——那是 `routing.ts` 的
 * `decideRoute()`,一個不碰 I/O 的純函式,phase-2.feature 的 Scenario Outline
 * 直接測它,不透過這個類別的 call()。
 *
 * -------------------------------------------------------------- 公開介面清單
 *
 * - `LocalProber = () => Promise<{ available: boolean; models: string[] }>`
 *   可替換的本機探測器型別。
 * - `OnlineProber = () => Promise<boolean>`
 *   可替換的線上探測器型別(預設應該委派給底層 CloudLlmRouter.probeOnline()——
 *   實作時再接,phase-2 測試用注入的假的即可,不需要真的打 fetch)。
 * - `RouterSettings extends CloudSettings { local_model?: string }`
 *   契約 §11 settings.llm 的完整形狀(cloud 那半沿用 phase-1 的 CloudSettings)。
 * - `LlmRouterImplOptions`:建構參數。除了 phase-1 CloudLlmRouterOptions 原有的
 *   env / settings / adapters / defaultTimeoutMs / logPath / logAppender,
 *   新增:
 *     - `localProber?: LocalProber`(預設 alwaysUnavailable)
 *     - `onlineProber?: OnlineProber`(預設委派底層 cloud router 的 probeOnline)
 *     - `onlineProbeTtlMs?: number`(預設 60_000)
 *     - `now?: () => number`(快取用的時鐘,測試注入假時間;預設 Date.now)
 *     - `cloudRouter?: CloudLlmRouter`(直接注入底層 router,取代用上面選項現場建一個)
 *     - `routingTable?: Readonly<Record<LlmTask, RouteGroup>>`(預設 ROUTING_TABLE)
 * - `class LlmRouterImpl implements LlmRouter`
 *     - `call(task, prompt, opts?)`:用 decideRoute() 決定 cloud/local。cloud 走
 *       底層 CloudLlmRouter.call();local 在 phase-2 還沒有真的 adapter(phase-4
 *       才做),本體先丟 not implemented。
 *     - `probeOnline()`:快取包住 onlineProber——10 秒內第二次呼叫不再打一次,
 *       90 秒後過期重打。
 *     - `probeLocal()`:呼叫注入的 localProber;prober 丟錯也要接住,回報
 *       unavailable,不能讓錯誤往外傳(phase-2.feature:「本機模型不在不是錯誤」)。
 *     - `resolveLocalModel(): string | undefined`:LLM_LOCAL_MODEL 環境變數優先於
 *       settings.llm.local_model。
 *
 * 本體先留空/丟 not implemented,邏輯留給下一輪開發 agent。測試見 router-impl.test.ts。
 */

import type { CloudAdapter, CloudProvider, LlmResult, LlmRouter, LlmTask } from './types.js';
import { CloudLlmRouter, type CloudSettings } from './router.js';
import { ROUTING_TABLE, type RouteGroup } from './routing.js';
import type { LogAppender } from './log-min.js';

export type LocalProber = () => Promise<{ available: boolean; models: string[] }>;
export type OnlineProber = () => Promise<boolean>;

/** 契約 §11:settings.llm 除了雲端那半,還有 local_model。 */
export interface RouterSettings extends CloudSettings {
  local_model?: string;
}

export interface LlmRouterImplOptions {
  /** 預設 process.env;測試用可換成假的 */
  env?: NodeJS.ProcessEnv;
  /** 契約 §11:環境變數覆蓋這裡的設定 */
  settings?: RouterSettings;
  /** 依 provider 替換雲端 adapter,轉給底層 CloudLlmRouter */
  adapters?: Partial<Record<CloudProvider, CloudAdapter>>;
  defaultTimeoutMs?: number;
  /** log.jsonl 的路徑;不給就不寫 */
  logPath?: string;
  /** 直接注入 appender,優先於 logPath */
  logAppender?: LogAppender;
  /** 可注入的本機探測器;不給就用 alwaysUnavailable(ADR-037) */
  localProber?: LocalProber;
  /** 可注入的線上探測器;不給就委派底層 CloudLlmRouter.probeOnline() */
  onlineProber?: OnlineProber;
  /** probeOnline() 快取存活時間,預設 60_000ms(FEATURE.md 的「60 秒快取」) */
  onlineProbeTtlMs?: number;
  /** 快取用的時鐘,測試注入假時間;預設 Date.now */
  now?: () => number;
  /** 測試/整合用:直接注入底層 cloud router,取代用上面選項現場建一個 */
  cloudRouter?: CloudLlmRouter;
  /** 路由表,預設 ROUTING_TABLE;phase-2.feature 最後一個 scenario 用改過的表格測 */
  routingTable?: Readonly<Record<LlmTask, RouteGroup>>;
}

/** 一律回報不可用——ADR-037:phase-2 沒有真的本機模型可偵測。 */
const alwaysUnavailable: LocalProber = async () => ({ available: false, models: [] });

export class LlmRouterImpl implements LlmRouter {
  private readonly opts: LlmRouterImplOptions;

  constructor(opts: LlmRouterImplOptions = {}) {
    this.opts = opts;
  }

  async call(task: LlmTask, prompt: string, opts: { timeoutMs?: number } = {}): Promise<LlmResult> {
    throw new Error('not implemented');
  }

  /** 10 秒內只打一次、90 秒後過期重打(phase-2.feature)。 */
  async probeOnline(): Promise<boolean> {
    throw new Error('not implemented');
  }

  /** 探測器丟錯也接住,回報 unavailable,不讓錯誤往外傳(phase-2.feature)。 */
  async probeLocal(): Promise<{ available: boolean; models: string[] }> {
    throw new Error('not implemented');
  }

  /** 契約 §11:LLM_LOCAL_MODEL 環境變數優先於 settings.llm.local_model。 */
  resolveLocalModel(): string | undefined {
    throw new Error('not implemented');
  }
}

export { alwaysUnavailable };
