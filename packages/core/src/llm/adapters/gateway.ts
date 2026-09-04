/**
 * 閘道 adapter(ADR-039)。本機模型跑在**另一台機器**上的 Ollama,前面一個 JWT
 * 閘道。對這個專案來說它就是契約 §7 的「本機」——`LlmResult.provider` 回
 * `'ollama'`,不改契約。
 *
 * 協定(使用者提供,ADR-039 有完整記錄):
 *   POST {BASE}/auth/token/exchange   header `Authorization: Bearer <明文 key>`
 *                                     → { access_token, expires_in? | expires_at? }
 *   GET  {BASE}/gateway/models        Bearer <token>
 *                                     → { auto_match, models: { <name>: [...] } }
 *   POST {BASE}/gateway/chat          Bearer <token>, body { prompt, model, service }
 *                                     → { content, provider: "ollama", model, tokens_used, ... }
 *
 * 兩個一定會踩到的坑:
 *   1. `model` 只能填**本機**模型名。填雲端模型名或 `"auto"` 會回 **403**——那是
 *      設定錯誤,不是「閘道暫時不行」,所以丟 `GatewayModelRejectedError` 往外傳,
 *      **不觸發任何 fallback**(fallback 只會讓錯誤設定一直藏著)。
 *   2. token 是短期的。過期後任何請求會回 401——這時要**自動重換一次 token 再重試
 *      一次**(只重試一次,避免 key 真的錯掉時無限迴圈)。
 *
 * 不打真網路的測試怎麼做:這個 client 的 `fetch` 是可注入的(預設
 * `globalThis.fetch`),單元測試注入假的;cucumber 的 `@llm` 場景照
 * `features/steps/_fake-cloud.mjs` 的模式,只換掉 `globalThis.fetch`,
 * client / router 全跑真的。
 *
 * -------------------------------------------------------------- 公開介面清單
 *
 * - `GATEWAY_TOKEN_FALLBACK_TTL_MS = 50 * 60_000`
 *   回應沒有 `expires_in` / `expires_at` 時的保守存活時間(50 分鐘)。
 * - `GATEWAY_PROBE_TIMEOUT_MS = 5_000`
 *   probe 只是可達性檢查,逾時要短——不能用雲端那個 60 秒(閘道在另一台機器上,
 *   機器沒開的時候要很快就知道)。
 * - `GatewayConfig { baseUrl, apiKey, model }`
 * - `GatewayProbeResult { available: boolean; models: string[] }`(= 契約 §7 的
 *   `probeLocal()` 回傳形狀)
 * - `GatewayChatArgs { prompt, model, signal?, service? }`
 * - `GatewayChatResult`:`Omit<LlmResult, 'provisional'>`,`provider` 恆為 `'ollama'`
 * - `GatewayClientOptions`:`config` +
 *     - `fetchImpl?: typeof fetch`(預設 globalThis.fetch;測試注入假的)
 *     - `now?: () => number`(token 快取的時鐘,預設 Date.now)
 *     - `probeTimeoutMs?: number`
 * - `class GatewayClient`
 *     - `token(): Promise<string>`:快取。快取還沒過期就直接回,不打
 *       `/auth/token/exchange`;過期(或還沒換過)才換一次。
 *     - `probe(): Promise<GatewayProbeResult>`:換 token → `GET /gateway/models`,
 *       回 `{ available: true, models: Object.keys(body.models) }`。
 *       **401(key 錯)、連線被拒、逾時一律回 `{ available: false, models: [] }`,
 *       不 throw**——沿用 phase-2「本機模型不在不是錯誤」的行為。
 *     - `chat(args): Promise<GatewayChatResult>`:`POST /gateway/chat`。
 *       403 → `GatewayModelRejectedError`;401 → 重換 token 後**重試一次**,
 *       再 401 就丟 `GatewayCallError`;其他非 2xx / 連線失敗 → `GatewayCallError`。
 *     - `invalidateToken(): void`:丟掉快取的 token(401 重試路徑用)。
 * - `createGatewayClient(env, opts?)`:從契約 §11 的環境變數
 *   (`GATEWAY_BASE_URL` / `GATEWAY_API_KEY` / `LLM_LOCAL_MODEL`)組出 client。
 *   `GATEWAY_API_KEY` 沒設就丟 `MissingCredentialError`(這是憑證,猜不出來);
 *   `LLM_LOCAL_MODEL` 沒設就用 `DEFAULT_LOCAL_MODEL`,`GATEWAY_BASE_URL` 沒設就用
 *   `DEFAULT_GATEWAY_BASE_URL`(`.env.example` 的值)。
 *
 * 本體先留空/丟 not implemented,邏輯留給下一輪開發 agent。測試見 gateway.test.ts。
 */

import type { LlmResult } from '../types.js';

/** 回應沒帶到期時間時的保守存活時間。 */
export const GATEWAY_TOKEN_FALLBACK_TTL_MS = 50 * 60_000;

/** probe 是可達性檢查,不是模型呼叫,逾時要短。 */
export const GATEWAY_PROBE_TIMEOUT_MS = 5_000;

/** `GATEWAY_BASE_URL` 沒設時的預設值(`.env.example` 記的那個)。 */
export const DEFAULT_GATEWAY_BASE_URL = 'http://localhost:8787';

/** 閘道回報的 provider 值就是 `ollama`——契約 §7 三個合法值之一,不用改契約。 */
export const GATEWAY_PROVIDER = 'ollama' as const;

/** `LLM_LOCAL_MODEL` 沒設時的預設值(`.env.example` 記的那個)。 */
export const DEFAULT_LOCAL_MODEL = 'qwen2.5:32b';

/** 閘道 `POST /gateway/chat` body 的 `service` 欄位預設值。 */
export const GATEWAY_DEFAULT_SERVICE = 'chat';

export interface GatewayConfig {
  /** 例:`http://localhost:8787`(之後換成網域)。結尾的 `/` 會被去掉。 */
  baseUrl: string;
  /** 明文 key,拿去 `/auth/token/exchange` 換 JWT */
  apiKey: string;
  /** `LLM_LOCAL_MODEL`,例:`qwen2.5:32b`。只能是本機模型名,填雲端名會 403。 */
  model: string;
}

export interface GatewayProbeResult {
  available: boolean;
  models: string[];
}

export interface GatewayChatArgs {
  prompt: string;
  model: string;
  signal?: AbortSignal;
  /** 閘道 body 的 `service` 欄位;不給就用預設值 */
  service?: string;
}

/** LlmResult 扣掉 provisional——那是 router 依備援規則決定的,不是 adapter 的事。 */
export type GatewayChatResult = Omit<LlmResult, 'provisional'>;

export interface GatewayClientOptions {
  config: GatewayConfig;
  /** 預設 globalThis.fetch;測試注入假的(不打真網路) */
  fetchImpl?: typeof fetch;
  /** token 快取的時鐘,預設 Date.now */
  now?: () => number;
  probeTimeoutMs?: number;
}

/** 內部的 token 快取形狀,匯出只為了測試好斷言。 */
export interface CachedToken {
  accessToken: string;
  /** 絕對時間(ms epoch);`now() >= expiresAt` 就算過期 */
  expiresAt: number;
}

export class GatewayClient {
  readonly config: GatewayConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly probeTimeoutMs: number;
  private cached: CachedToken | undefined;
  /** 測試用:實際打過 `/auth/token/exchange` 幾次(驗證快取有效) */
  tokenExchanges = 0;

  constructor(opts: GatewayClientOptions) {
    this.config = { ...opts.config, baseUrl: opts.config.baseUrl.replace(/\/+$/, '') };
    this.fetchImpl = opts.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.now = opts.now ?? Date.now;
    this.probeTimeoutMs = opts.probeTimeoutMs ?? GATEWAY_PROBE_TIMEOUT_MS;
  }

  /** 快取到過期前重用;過期(或還沒換過)才打 `/auth/token/exchange`。 */
  async token(): Promise<string> {
    void this.fetchImpl;
    void this.now;
    void this.cached;
    throw new Error('not implemented: GatewayClient.token (03-llm-router/phase-4)');
  }

  /** 丟掉快取的 token,下一次 `token()` 會重換。401 重試路徑用。 */
  invalidateToken(): void {
    throw new Error('not implemented: GatewayClient.invalidateToken (03-llm-router/phase-4)');
  }

  /** 換 token → `GET /gateway/models`。任何失敗都回 unavailable,不 throw。 */
  async probe(): Promise<GatewayProbeResult> {
    void this.probeTimeoutMs;
    throw new Error('not implemented: GatewayClient.probe (03-llm-router/phase-4)');
  }

  /** `POST /gateway/chat`。403 → 設定錯誤;401 → 重換 token 重試一次。 */
  async chat(_args: GatewayChatArgs): Promise<GatewayChatResult> {
    throw new Error('not implemented: GatewayClient.chat (03-llm-router/phase-4)');
  }
}

/**
 * 契約 §11:`GATEWAY_BASE_URL` / `GATEWAY_API_KEY` / `LLM_LOCAL_MODEL`。
 * key 沒設就丟 `MissingCredentialError`(跟雲端那半同一個模式)。
 */
export function createGatewayClient(
  _env: NodeJS.ProcessEnv,
  _opts: Omit<GatewayClientOptions, 'config'> = {},
): GatewayClient {
  throw new Error('not implemented: createGatewayClient (03-llm-router/phase-4)');
}
