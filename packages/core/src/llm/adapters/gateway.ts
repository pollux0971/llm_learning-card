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
 *     - `token(signal?): Promise<string>`:快取。快取還沒過期就直接回,不打
 *       `/auth/token/exchange`;過期(或還沒換過)才換一次。`signal` 給 `probe()`
 *       用,讓 probe 的逾時也管得到換 token 那一步。
 *     - `probe(): Promise<GatewayProbeResult>`:換 token → `GET /gateway/models`,
 *       回 `{ available: true, models: Object.keys(body.models) }`。
 *       **401(key 錯)、連線被拒、逾時一律回 `{ available: false, models: [] }`,
 *       不 throw**——沿用 phase-2「本機模型不在不是錯誤」的行為。
 *       `GATEWAY_PROBE_TIMEOUT_MS` 涵蓋**兩個**請求(換 token + `/gateway/models`),
 *       所以 auth 端點掛住時也會準時回不可用,不會無限期卡住。
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
import { GatewayCallError, GatewayModelRejectedError, MissingCredentialError } from '../errors.js';

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

/** 閘道回應的形狀。欄位全是 optional——別人的服務,不能假設它一定照著回。 */
interface TokenExchangeBody {
  access_token?: unknown;
  expires_in?: unknown;
  expires_at?: unknown;
}

interface ModelsBody {
  models?: unknown;
}

interface ChatBody {
  content?: unknown;
  model?: unknown;
  tokens_used?: { prompt?: unknown; completion?: unknown } | undefined;
}

/** 只在錯誤訊息裡用,所以連 Error 都不是的東西也要能印出來。 */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 回應可能不是 JSON(例如 502 的 HTML 錯誤頁),parse 不動就回 undefined。 */
async function readJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
    // 下面的 catch 是等價變異:函式掉到結尾本來就回 undefined,所以
    // `catch { return undefined }` 與 `catch {}` 對呼叫端完全一樣。明寫出來
    // 是為了講清楚「parse 不動就當作沒有 body」是刻意的,不是漏寫。
    // Stryker disable next-line all: 等價變異,理由見上。
  } catch {
    return undefined;
  }
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

  /**
   * 快取到過期前重用;過期(或還沒換過)才打 `/auth/token/exchange`。
   *
   * `signal` 是給 `probe()` 用的:換 token 也要被 probe 的逾時管到,不然閘道的
   * auth 端點掛住時(封包被防火牆黑洞吃掉,連 ECONNREFUSED 都不會回來)這個
   * fetch 會掛到 OS 預設的 TCP timeout,`GATEWAY_PROBE_TIMEOUT_MS` 形同虛設。
   * 不給就跟以前一樣不帶 signal。
   */
  async token(signal?: AbortSignal): Promise<string> {
    const now = this.now();
    if (this.cached && now < this.cached.expiresAt) return this.cached.accessToken;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/auth/token/exchange`, {
        method: 'POST',
        // 換 token 用的是**明文 key**,不是 JWT——這是唯一一個這樣的端點。
        headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      throw new GatewayCallError(`token exchange failed: ${describe(err)}`);
    }

    if (!response.ok) {
      throw new GatewayCallError(`token exchange returned ${response.status}`, response.status);
    }

    const body = await readJson<TokenExchangeBody>(response);
    const accessToken = body?.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new GatewayCallError('token exchange returned no access_token', response.status);
    }

    this.tokenExchanges += 1;
    this.cached = { accessToken, expiresAt: now + resolveTtlMs(body, now) };
    return accessToken;
  }

  /** 丟掉快取的 token,下一次 `token()` 會重換。401 重試路徑用。 */
  invalidateToken(): void {
    this.cached = undefined;
  }

  /**
   * 換 token → `GET /gateway/models`。任何失敗都回 unavailable,不 throw。
   *
   * 逾時涵蓋**整個流程**:同一個 controller 的 signal 兩個 fetch 都帶,所以
   * 「換 token 那一步掛住」也會在 `probeTimeoutMs` 之後被 abort。只包第二個
   * fetch 的話,auth 端點掛住時 probe() 會無限期卡住。
   */
  async probe(): Promise<GatewayProbeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);
    try {
      const token = await this.token(controller.signal);
      const response = await this.fetchImpl(`${this.config.baseUrl}/gateway/models`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) return { available: false, models: [] };

      const body = await readJson<ModelsBody>(response);
      const models = body?.models;
      // Stryker disable next-line all: `models === null` 這半邊是等價變異。
      // typeof null 是 'object',少了它 null 會一路走到 Object.keys(null) 丟
      // TypeError,而那個 TypeError 剛好被下面的 catch 接住、回同一個
      // { available: false, models: [] }。留著是為了明講「null 不算一份清單」,
      // 而不是靠一個例外繞出去。
      if (typeof models !== 'object' || models === null) return { available: false, models: [] };
      return { available: true, models: Object.keys(models as Record<string, unknown>) };
    } catch {
      // 401(key 錯)、連線被拒、逾時——本機模型不在不是錯誤(phase-2 的行為)。
      return { available: false, models: [] };
    } finally {
      // Stryker disable next-line all: 等價變異。清掉逾時計時器只影響 Node 的
      // event loop 要不要多醒著 5 秒,probe() 的回傳值一模一樣,沒有任何斷言
      // 分辨得出來。留著是因為不清掉會讓短命的 CLI 程序多掛 5 秒才結束。
      clearTimeout(timer);
    }
  }

  /** `POST /gateway/chat`。403 → 設定錯誤;401 → 重換 token 重試一次。 */
  async chat(args: GatewayChatArgs): Promise<GatewayChatResult> {
    const started = Date.now();

    let response = await this.postChat(args);
    if (response.status === 401) {
      // token 過期。重換一次再重試一次——只有一次,key 真的錯掉時才不會無限迴圈。
      this.invalidateToken();
      response = await this.postChat(args);
    }

    if (response.status === 403) {
      // 設定錯誤(填了雲端模型名或 "auto"),不是暫時性失敗:往外丟,不備援。
      throw new GatewayModelRejectedError(args.model);
    }
    if (!response.ok) {
      throw new GatewayCallError(`chat returned ${response.status}`, response.status);
    }

    const body = await readJson<ChatBody>(response);
    if (body === undefined || typeof body.content !== 'string') {
      throw new GatewayCallError('chat returned no content', response.status);
    }

    const result: GatewayChatResult = {
      text: body.content,
      provider: GATEWAY_PROVIDER,
      model: typeof body.model === 'string' && body.model.length > 0 ? body.model : args.model,
      latency_ms: Date.now() - started,
    };
    const tokensIn = body.tokens_used?.prompt;
    const tokensOut = body.tokens_used?.completion;
    if (typeof tokensIn === 'number') result.tokens_in = tokensIn;
    if (typeof tokensOut === 'number') result.tokens_out = tokensOut;
    return result;
  }

  /** 一次 `POST /gateway/chat`(含取 token)。狀態碼的意義交給 chat() 判讀。 */
  private async postChat(args: GatewayChatArgs): Promise<Response> {
    const token = await this.token();
    try {
      return await this.fetchImpl(`${this.config.baseUrl}/gateway/chat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: args.prompt,
          model: args.model,
          service: args.service ?? GATEWAY_DEFAULT_SERVICE,
        }),
        ...(args.signal ? { signal: args.signal } : {}),
      });
    } catch (err) {
      throw new GatewayCallError(`chat failed: ${describe(err)}`);
    }
  }
}

/**
 * token 還能活多久。`expires_in` 是秒數,`expires_at` 是絕對時間(epoch 秒 /
 * 毫秒 / ISO 字串都接);兩個都沒有就用 50 分鐘的保守值。
 */
function resolveTtlMs(body: TokenExchangeBody | undefined, now: number): number {
  const expiresIn = body?.expires_in;
  if (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0) {
    return expiresIn * 1_000;
  }

  const expiresAt = body?.expires_at;
  const absolute = typeof expiresAt === 'number' ? epochToMs(expiresAt) : typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
  if (Number.isFinite(absolute) && absolute > now) return absolute - now;

  return GATEWAY_TOKEN_FALLBACK_TTL_MS;
}

/** epoch 秒與毫秒長得很像。2001 年之後的毫秒時間戳都 > 1e12,用這個界線分。 */
function epochToMs(value: number): number {
  return value < 1e12 ? value * 1_000 : value;
}

/**
 * 契約 §11:`GATEWAY_BASE_URL` / `GATEWAY_API_KEY` / `LLM_LOCAL_MODEL`。
 * key 沒設就丟 `MissingCredentialError`(跟雲端那半同一個模式)。
 */
export function createGatewayClient(
  env: NodeJS.ProcessEnv,
  opts: Omit<GatewayClientOptions, 'config'> = {},
): GatewayClient {
  const apiKey = env.GATEWAY_API_KEY;
  if (!apiKey) throw new MissingCredentialError('GATEWAY_API_KEY');

  return new GatewayClient({
    ...opts,
    config: {
      baseUrl: env.GATEWAY_BASE_URL ?? DEFAULT_GATEWAY_BASE_URL,
      apiKey,
      model: env.LLM_LOCAL_MODEL ?? DEFAULT_LOCAL_MODEL,
    },
  });
}
