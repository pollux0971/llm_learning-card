/**
 * adapters/gateway.ts 的單元測試(ADR-039)。
 *
 * 全部注入假的 fetch,不打真網路。重點三件事:
 *   1. **token 快取**:過期前重用(不再打 /auth/token/exchange),過期就重換。
 *   2. **probe 不 throw**:401(key 錯)、連線被拒、逾時都回 unavailable——沿用
 *      phase-2「本機模型不在不是錯誤」的行為。
 *   3. **403 vs 401 的分別**:403 是設定錯誤(填了雲端模型名),往外丟不備援;
 *      401 是 token 過期,自動重換一次再重試一次。
 */
import { describe, expect, it, vi } from 'vitest';
import { GatewayCallError, GatewayModelRejectedError, MissingCredentialError } from '../errors.js';
import {
  DEFAULT_GATEWAY_BASE_URL,
  DEFAULT_LOCAL_MODEL,
  GATEWAY_PROBE_TIMEOUT_MS,
  GATEWAY_TOKEN_FALLBACK_TTL_MS,
  GatewayClient,
  createGatewayClient,
  type GatewayClientOptions,
} from './gateway.js';

const BASE = 'http://gateway.test:8787';
const KEY = 'plain-key';
const MODEL = 'qwen2.5:32b';
const MODELS = { 'qwen2.5:32b': ['chat'], 'deepseek-r1:70b': ['chat'] };

interface FakeOpts {
  /** 每次 /auth/token/exchange 的回應狀態,用完就重複最後一個 */
  tokenStatuses?: number[];
  /** 每次 /gateway/chat 的回應狀態,用完就重複最後一個 */
  chatStatuses?: number[];
  /** token 回應要不要帶 expires_in(秒) */
  expiresIn?: number | undefined;
  /** fetch 直接 throw(連線被拒) */
  throwOn?: 'all' | 'models' | 'chat' | undefined;
  /** /gateway/models 的回應狀態(預設 200) */
  modelsStatus?: number;
  /** 蓋掉 /gateway/models 的 body(測形狀不對的回應) */
  modelsBody?: unknown;
  /** 蓋掉 token 回應的 access_token(測空字串 / 型別不對) */
  accessToken?: unknown;
  /** token 回應帶 expires_at 而不是 expires_in */
  expiresAt?: unknown;
  /** 蓋掉 /gateway/chat 回應裡的 model 欄位 */
  chatModel?: unknown;
  /** 蓋掉 /gateway/chat 的整個 body */
  chatBody?: unknown;
  /** /gateway/models 回應前先等這麼久(測 probe 的逾時) */
  modelsDelayMs?: number;
  /**
   * `/auth/token/exchange` 回應前先等這麼久(**會**正常回,不像 `tokenHangs` 永遠掛著)。
   * 用來分辨「一個計時器管兩段」與「兩段各開一個計時器」——後者每一段都在自己的
   * 額度內就都不會逾時,前者看的是兩段加起來。
   */
  tokenDelayMs?: number;
  /**
   * `/auth/token/exchange` 永不回應——只有 abort 能結束它。重現「閘道的 auth
   * 端點掛住」:封包被防火牆黑洞吃掉,連 ECONNREFUSED 都不會回來。
   */
  tokenHangs?: boolean;
  /** 回一段不是 JSON 的原始內容(例如反向代理的 502 HTML 錯誤頁) */
  rawOn?: 'token' | 'models' | 'chat';
  rawStatus?: number;
}

interface FakeFetch {
  fetchImpl: typeof fetch;
  tokenCalls: number;
  modelCalls: number;
  chatCalls: number;
  chatBodies: { prompt?: string; model?: string; service?: string }[];
  authHeaders: string[];
  /** 每一次請求的形狀:method / content-type / authorization / url / 有沒有帶 signal */
  requests: { url: string; method: string; contentType: string; authorization: string; hasSignal: boolean }[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** 不是 JSON 的回應——中間那層代理掛掉時常常長這樣。 */
function html(status: number): Response {
  return new Response('<html><body>502 Bad Gateway</body></html>', {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

function makeFetch(opts: FakeOpts = {}): FakeFetch {
  const state: FakeFetch = {
    fetchImpl: (() => {}) as unknown as typeof fetch,
    tokenCalls: 0,
    modelCalls: 0,
    chatCalls: 0,
    chatBodies: [],
    authHeaders: [],
    requests: [],
  };

  const pick = (list: number[] | undefined, i: number): number => {
    if (!list || list.length === 0) return 200;
    return list[Math.min(i, list.length - 1)]!;
  };

  state.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // 真的 fetch 收到已經 abort 的 signal 會立刻 reject,假的也要一樣,
    // 不然「signal 有沒有真的接上去」在測試裡看起來永遠都對。
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const headers = new Headers(init?.headers);
    state.authHeaders.push(headers.get('authorization') ?? '');
    state.requests.push({
      url,
      method: init?.method ?? 'GET',
      contentType: headers.get('content-type') ?? '',
      authorization: headers.get('authorization') ?? '',
      hasSignal: init?.signal != null,
    });

    if (opts.throwOn === 'all') throw new TypeError('fetch failed: connect ECONNREFUSED');

    if (url.includes('/auth/token/exchange')) {
      if (opts.tokenHangs) {
        state.tokenCalls += 1;
        // 只有 abort 能讓這個 promise 結束。沒有 signal 的話它永遠掛著——
        // 那正是「probe 的逾時管不到換 token」現在的樣子。
        await new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      if (opts.tokenDelayMs !== undefined) {
        // 跟 modelsDelayMs 同一個形狀:時間到就正常回,但中途被 abort 就立刻 reject。
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.tokenDelayMs);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
      if (opts.rawOn === 'token') {
        state.tokenCalls += 1;
        return html(opts.rawStatus ?? 200);
      }
      const status = pick(opts.tokenStatuses, state.tokenCalls);
      state.tokenCalls += 1;
      if (status !== 200) return json({ detail: 'invalid api key' }, status);
      const body: Record<string, unknown> = { access_token: `jwt-${state.tokenCalls}` };
      if ('accessToken' in opts) body.access_token = opts.accessToken;
      if (opts.expiresIn !== undefined) body.expires_in = opts.expiresIn;
      if ('expiresAt' in opts) body.expires_at = opts.expiresAt;
      return json(body);
    }

    if (url.includes('/gateway/models')) {
      if (opts.throwOn === 'models') throw new TypeError('fetch failed: connect ECONNREFUSED');
      state.modelCalls += 1;
      if (opts.rawOn === 'models') return html(opts.rawStatus ?? 200);
      if (opts.modelsDelayMs !== undefined) {
        // 只有 abort 能提早結束——沒被 abort 的話這個 promise 會一直掛著,
        // 剛好可以驗證 probe 的逾時真的有把 controller abort 掉。
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.modelsDelayMs);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
      const modelsStatus = opts.modelsStatus ?? 200;
      const body = 'modelsBody' in opts ? opts.modelsBody : { auto_match: true, models: MODELS };
      if (modelsStatus !== 200 && !('modelsBody' in opts)) {
        return json({ detail: `status ${modelsStatus}` }, modelsStatus);
      }
      return json(body, modelsStatus);
    }

    if (url.includes('/gateway/chat')) {
      if (opts.throwOn === 'chat') throw new TypeError('fetch failed: connect ECONNREFUSED');
      const status = pick(opts.chatStatuses, state.chatCalls);
      const body = JSON.parse(String(init?.body ?? '{}')) as { prompt?: string; model?: string; service?: string };
      state.chatBodies.push(body);
      state.chatCalls += 1;
      if (opts.rawOn === 'chat') return html(opts.rawStatus ?? 200);
      if (status !== 200) return json({ detail: `status ${status}` }, status);
      if ('chatBody' in opts) return json(opts.chatBody);
      return json({
        content: '本機模型的回覆。',
        provider: 'ollama',
        model: 'chatModel' in opts ? opts.chatModel : (body.model ?? MODEL),
        tokens_used: { prompt: 11, completion: 13 },
      });
    }

    throw new Error(`沒有預期到的請求:${url}`);
  }) as typeof fetch;

  return state;
}

function client(fake: FakeFetch, extra: Partial<GatewayClientOptions> = {}): GatewayClient {
  return new GatewayClient({
    config: { baseUrl: BASE, apiKey: KEY, model: MODEL },
    fetchImpl: fake.fetchImpl,
    ...extra,
  });
}

describe('GatewayClient.token — 快取', () => {
  it('第一次呼叫會換 token', async () => {
    const fake = makeFetch();
    const token = await client(fake).token();
    expect(token).toBe('jwt-1');
    expect(fake.tokenCalls).toBe(1);
  });

  it('用明文 key 去換(header 是 Bearer <key>)', async () => {
    const fake = makeFetch();
    await client(fake).token();
    expect(fake.authHeaders[0]).toBe(`Bearer ${KEY}`);
  });

  it('過期前重用,不再打 /auth/token/exchange', async () => {
    const fake = makeFetch({ expiresIn: 3600 });
    let now = 0;
    const c = client(fake, { now: () => now });
    await c.token();
    now += 60_000; // 一分鐘後
    await c.token();
    expect(fake.tokenCalls).toBe(1);
  });

  it('過期後重換一次', async () => {
    const fake = makeFetch({ expiresIn: 3600 });
    let now = 0;
    const c = client(fake, { now: () => now });
    await c.token();
    now += 3_600_001; // 一小時又一毫秒
    const second = await c.token();
    expect(fake.tokenCalls).toBe(2);
    expect(second).toBe('jwt-2');
  });

  it('回應沒帶到期時間時用 50 分鐘的保守值', async () => {
    const fake = makeFetch({ expiresIn: undefined });
    let now = 0;
    const c = client(fake, { now: () => now });
    await c.token();
    now += GATEWAY_TOKEN_FALLBACK_TTL_MS - 1;
    await c.token();
    expect(fake.tokenCalls).toBe(1);
    now += 2;
    await c.token();
    expect(fake.tokenCalls).toBe(2);
  });

  it('invalidateToken() 之後下一次一定重換', async () => {
    const fake = makeFetch({ expiresIn: 3600 });
    const c = client(fake, { now: () => 0 });
    await c.token();
    c.invalidateToken();
    await c.token();
    expect(fake.tokenCalls).toBe(2);
  });

  it('key 錯(401)時 token() 丟 GatewayCallError', async () => {
    const fake = makeFetch({ tokenStatuses: [401] });
    await expect(client(fake).token()).rejects.toBeInstanceOf(GatewayCallError);
  });

  // 只斷言 instanceof 不夠:拿掉 `if (!response.ok)` 那個檢查之後,程式會往下走到
  // 「body 裡沒有 access_token」那條路,丟的**還是** GatewayCallError、status 還是
  // 401。兩個版本只有訊息不一樣,所以訊息與 status 都要斷言。
  it('換 token 的失敗狀態碼直接反映在訊息與 status 上', async () => {
    const fake = makeFetch({ tokenStatuses: [500] });
    await expect(client(fake).token()).rejects.toMatchObject({
      message: 'gateway call failed: token exchange returned 500',
      status: 500,
    });
  });

  it('連不上閘道時訊息說得出是換 token 這一步失敗', async () => {
    const fake = makeFetch({ throwOn: 'all' });
    await expect(client(fake).token()).rejects.toMatchObject({
      message: 'gateway call failed: token exchange failed: fetch failed: connect ECONNREFUSED',
      status: undefined,
    });
  });

  it('回應是 200 但沒有 access_token(或是空字串)一樣算失敗', async () => {
    for (const bad of ['', 123, null, undefined]) {
      const fake = makeFetch({ accessToken: bad });
      await expect(client(fake).token()).rejects.toMatchObject({
        message: 'gateway call failed: token exchange returned no access_token',
      });
    }
  });

  it('剛好到期的那一刻就算過期,不再重用', async () => {
    // `now < expiresAt` 的邊界:now === expiresAt 必須重換。token 用過期的
    // 那一瞬間去打閘道會拿到 401,寧可早一毫秒換掉。
    const fake = makeFetch({ expiresIn: 60 });
    let now = 0;
    const c = client(fake, { now: () => now });
    await c.token();
    now = 59_999;
    await c.token();
    expect(fake.tokenCalls).toBe(1);
    now = 60_000; // 剛好到期
    await c.token();
    expect(fake.tokenCalls).toBe(2);
  });

  it('沒帶到期時間時的保守值就是 50 分鐘(不是別的數字)', async () => {
    // 上面那個測試拿 GATEWAY_TOKEN_FALLBACK_TTL_MS 當基準,所以常數本身被改掉時
    // 它會跟著一起變、驗不出來。這裡寫死 50 分鐘的實際毫秒數。
    expect(GATEWAY_TOKEN_FALLBACK_TTL_MS).toBe(3_000_000);
    const fake = makeFetch({ expiresIn: undefined });
    let now = 0;
    const c = client(fake, { now: () => now });
    await c.token();
    now = 2_999_999;
    await c.token();
    expect(fake.tokenCalls).toBe(1);
    now = 3_000_000;
    await c.token();
    expect(fake.tokenCalls).toBe(2);
  });

  it('expires_in 是 0 或負數時不採用,退回 50 分鐘', async () => {
    for (const bad of [0, -1]) {
      const fake = makeFetch({ expiresIn: bad });
      let now = 0;
      const c = client(fake, { now: () => now });
      await c.token();
      now = GATEWAY_TOKEN_FALLBACK_TTL_MS - 1;
      await c.token();
      expect(fake.tokenCalls).toBe(1);
    }
  });

  /** 換一次 token,然後把時鐘推到 `at`,回報到那個時間點為止總共換了幾次。 */
  async function exchangesBy(opts: Parameters<typeof makeFetch>[0], startNow: number, at: number): Promise<number> {
    const fake = makeFetch(opts);
    let now = startNow;
    const c = client(fake, { now: () => now });
    await c.token();
    now = at;
    await c.token();
    return fake.tokenCalls;
  }

  it('沒有 expires_in 時改用 expires_at 的 epoch 秒', async () => {
    // 1800 < 1e12,所以要當成秒:到期時間 = 1_800_000ms。
    const o = { expiresIn: undefined, expiresAt: 1_800 };
    expect(await exchangesBy(o, 0, 1_799_999)).toBe(1);
    expect(await exchangesBy(o, 0, 1_800_000)).toBe(2);
  });

  it('expires_at 是 epoch 毫秒時不再乘一千', async () => {
    // >= 1e12 已經是毫秒。乘一千的話到期時間會變成 1e15,那就永遠不過期了。
    const o = { expiresIn: undefined, expiresAt: 2_000_000_000_000 };
    expect(await exchangesBy(o, 0, 1_999_999_999_999)).toBe(1);
    expect(await exchangesBy(o, 0, 2_000_000_000_000)).toBe(2);
  });

  it('epoch 秒與毫秒的分界剛好是 1e12(1e12 本身算毫秒)', async () => {
    // `value < 1e12` 的邊界。1e12 當毫秒 → 到期在 1e12;當秒 → 到期在 1e15。
    const o = { expiresIn: undefined, expiresAt: 1_000_000_000_000 };
    expect(await exchangesBy(o, 0, 999_999_999_999)).toBe(1);
    expect(await exchangesBy(o, 0, 1_000_000_000_000)).toBe(2);
  });

  it('expires_at 是 ISO 字串也接', async () => {
    const o = { expiresIn: undefined, expiresAt: '1970-01-01T00:30:00.000Z' };
    expect(await exchangesBy(o, 0, 1_799_999)).toBe(1);
    expect(await exchangesBy(o, 0, 1_800_000)).toBe(2);
  });

  it('expires_at 算的是「從現在到那個時間」,不是兩個時間相加', async () => {
    // now 不是 0 才驗得出 `absolute - now` 有沒有被寫成 `absolute + now`。
    const o = { expiresIn: undefined, expiresAt: 3_000 }; // 絕對時間 3_000_000ms
    expect(await exchangesBy(o, 1_000_000, 2_999_999)).toBe(1);
    expect(await exchangesBy(o, 1_000_000, 3_000_000)).toBe(2);
  });

  it('expires_at 剛好等於現在時不採用,退回 50 分鐘', async () => {
    // `absolute > now` 的邊界:剛好等於代表「已經到期」,拿它當存活時間會得到 0。
    const o = { expiresIn: undefined, expiresAt: 1_000 }; // 絕對時間 1_000_000ms
    expect(await exchangesBy(o, 1_000_000, 1_000_000 + GATEWAY_TOKEN_FALLBACK_TTL_MS - 1)).toBe(1);
  });

  it('expires_at 已經是過去的時間時不採用,退回 50 分鐘', async () => {
    const fake = makeFetch({ expiresIn: undefined, expiresAt: 1 });
    let now = 10_000;
    const c = client(fake, { now: () => now });
    await c.token();
    now = 10_000 + GATEWAY_TOKEN_FALLBACK_TTL_MS - 1;
    await c.token();
    expect(fake.tokenCalls).toBe(1);
  });

  it('tokenExchanges 只在真的換到 token 時往上加', async () => {
    const fake = makeFetch({ expiresIn: 3600 });
    const c = client(fake, { now: () => 0 });
    expect(c.tokenExchanges).toBe(0);
    await c.token();
    expect(c.tokenExchanges).toBe(1);
    await c.token(); // 走快取
    expect(c.tokenExchanges).toBe(1);
    c.invalidateToken();
    await c.token();
    expect(c.tokenExchanges).toBe(2);
  });

  it('換 token 用 POST 並且帶 JSON 的 content-type', async () => {
    const fake = makeFetch();
    await client(fake).token();
    expect(fake.requests[0]).toMatchObject({
      method: 'POST',
      contentType: 'application/json',
      authorization: `Bearer ${KEY}`,
    });
  });
});

describe('GatewayClient.probe', () => {
  it('換到 token 就回可用,models 是回應裡 models 物件的 key', async () => {
    const fake = makeFetch();
    const result = await client(fake).probe();
    expect(result.available).toBe(true);
    expect([...result.models].sort()).toEqual(Object.keys(MODELS).sort());
  });

  it('用 JWT(不是明文 key)去打 /gateway/models', async () => {
    const fake = makeFetch();
    await client(fake).probe();
    expect(fake.authHeaders.at(-1)).toBe('Bearer jwt-1');
  });

  it('key 錯(401)回不可用,**不 throw**', async () => {
    const fake = makeFetch({ tokenStatuses: [401] });
    await expect(client(fake).probe()).resolves.toEqual({ available: false, models: [] });
  });

  it('連線被拒回不可用,不 throw', async () => {
    const fake = makeFetch({ throwOn: 'all' });
    await expect(client(fake).probe()).resolves.toEqual({ available: false, models: [] });
  });

  it('token 換得到但 /gateway/models 連不上,一樣回不可用', async () => {
    const fake = makeFetch({ throwOn: 'models' });
    await expect(client(fake).probe()).resolves.toEqual({ available: false, models: [] });
  });

  it('/gateway/models 回錯誤狀態碼時回不可用,不 throw', async () => {
    for (const status of [401, 403, 500, 503]) {
      const fake = makeFetch({ modelsStatus: status });
      await expect(client(fake).probe()).resolves.toEqual({ available: false, models: [] });
    }
  });

  it('回應形狀不對(models 不是物件)時回不可用', async () => {
    // 別人的服務,不能假設它一定照著回。字串 / 陣列以外的原始值 / null 都不算。
    for (const body of [{}, { models: null }, { models: 'qwen' }, { models: 7 }, {}]) {
      const fake = makeFetch({ modelsBody: body });
      await expect(client(fake).probe()).resolves.toEqual({ available: false, models: [] });
    }
  });

  it('狀態碼是錯的就不看 body,即使 body 裡有一份看起來正常的模型清單', async () => {
    // 少了 `!response.ok` 這道檢查的話,500 配一份合法的 models 會被當成「可用」。
    const fake = makeFetch({ modelsStatus: 500, modelsBody: { auto_match: true, models: MODELS } });
    await expect(client(fake).probe()).resolves.toEqual({ available: false, models: [] });
  });

  it('models 是空物件時算可用但清單是空的', async () => {
    // 閘道活著、只是現在沒有載入模型——這跟「連不上」不一樣,不能混為一談。
    const fake = makeFetch({ modelsBody: { auto_match: true, models: {} } });
    await expect(client(fake).probe()).resolves.toEqual({ available: true, models: [] });
  });

  it('成功回來之後不留下逾時計時器', async () => {
    // finally 裡的 clearTimeout:少了它,一個 5 秒的 timer 會繼續掛在 event loop 上,
    // 短命的 CLI 程序(scripts/llm.ts --probe)要多等 5 秒才肯結束。
    vi.useFakeTimers();
    try {
      const fake = makeFetch();
      await client(fake).probe();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('probe 逾時會 abort 掉請求並回不可用,不會一直掛著', async () => {
    // GATEWAY_PROBE_TIMEOUT_MS 是可達性檢查用的短逾時(不是雲端那個 60 秒)。
    // 把它調成 20ms,假閘道故意拖 10 秒——只有真的 abort 才回得來。
    expect(GATEWAY_PROBE_TIMEOUT_MS).toBe(5_000);
    const fake = makeFetch({ modelsDelayMs: 10_000 });
    const started = Date.now();
    await expect(client(fake, { probeTimeoutMs: 20 }).probe()).resolves.toEqual({ available: false, models: [] });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('GatewayClient.chat', () => {
  it('回傳 provider ollama 與請求的模型名', async () => {
    const fake = makeFetch();
    const result = await client(fake).chat({ prompt: '你好', model: MODEL });
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe(MODEL);
    expect(result.text).toContain('本機模型');
  });

  it('body 帶 prompt / model / service 三個欄位', async () => {
    const fake = makeFetch();
    await client(fake).chat({ prompt: '你好', model: MODEL });
    expect(fake.chatBodies[0]).toMatchObject({ prompt: '你好', model: MODEL });
    expect(fake.chatBodies[0]?.service).toBeDefined();
  });

  it('把 tokens_used 映射成契約 §7 的 tokens_in / tokens_out', async () => {
    const fake = makeFetch();
    const result = await client(fake).chat({ prompt: '你好', model: MODEL });
    expect(result.tokens_in).toBe(11);
    expect(result.tokens_out).toBe(13);
  });

  it('latency_ms 是數字', async () => {
    const fake = makeFetch();
    const result = await client(fake).chat({ prompt: '你好', model: MODEL });
    expect(typeof result.latency_ms).toBe('number');
  });

  it('403(填了雲端模型名)丟 GatewayModelRejectedError,訊息點名那個模型', async () => {
    const fake = makeFetch({ chatStatuses: [403] });
    try {
      await client(fake).chat({ prompt: '你好', model: 'gpt-5.6-luna' });
      expect.unreachable('應該丟錯');
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayModelRejectedError);
      expect((err as GatewayModelRejectedError).code).toBe('GATEWAY_MODEL_REJECTED');
      expect((err as Error).message).toContain('gpt-5.6-luna');
    }
  });

  it('403 不會重試,也不會重換 token——那是設定錯誤,不是暫時性失敗', async () => {
    const fake = makeFetch({ chatStatuses: [403] });
    await expect(client(fake).chat({ prompt: '你好', model: 'gpt-5.6-luna' })).rejects.toThrow();
    expect(fake.chatCalls).toBe(1);
    expect(fake.tokenCalls).toBe(1);
  });

  it('401(token 過期)重換 token 後重試一次就成功', async () => {
    const fake = makeFetch({ chatStatuses: [401, 200] });
    const result = await client(fake).chat({ prompt: '你好', model: MODEL });
    expect(result.provider).toBe('ollama');
    expect(fake.chatCalls).toBe(2);
    expect(fake.tokenCalls).toBe(2);
  });

  it('重試後還是 401 就丟 GatewayCallError,不無限迴圈', async () => {
    const fake = makeFetch({ chatStatuses: [401] });
    await expect(client(fake).chat({ prompt: '你好', model: MODEL })).rejects.toBeInstanceOf(GatewayCallError);
    expect(fake.chatCalls).toBe(2);
  });

  it('5xx 丟 GatewayCallError 並帶著狀態碼', async () => {
    const fake = makeFetch({ chatStatuses: [503] });
    try {
      await client(fake).chat({ prompt: '你好', model: MODEL });
      expect.unreachable('應該丟錯');
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayCallError);
      expect((err as GatewayCallError).status).toBe(503);
    }
  });

  it('連線失敗丟 GatewayCallError', async () => {
    const fake = makeFetch({ throwOn: 'all' });
    await expect(client(fake).chat({ prompt: '你好', model: MODEL })).rejects.toBeInstanceOf(GatewayCallError);
  });

  // 跟 token 那邊同一個陷阱:拿掉 `if (!response.ok)` 之後會落到「回應裡沒有
  // content」那條路,丟的還是 GatewayCallError、status 也還是一樣。要斷言訊息。
  it('5xx 的訊息說得出是 chat 這一步、以及狀態碼', async () => {
    const fake = makeFetch({ chatStatuses: [503] });
    await expect(client(fake).chat({ prompt: '你好', model: MODEL })).rejects.toMatchObject({
      message: 'gateway call failed: chat returned 503',
      status: 503,
    });
  });

  // 注意:throwOn:'all' 會讓**換 token** 那一步先失敗,根本走不到 postChat 的
  // catch。要驗 chat 自己的連線失敗,token 必須先換得到。
  it('連線失敗的訊息說得出是 chat 這一步', async () => {
    const fake = makeFetch({ throwOn: 'chat' });
    await expect(client(fake).chat({ prompt: '你好', model: MODEL })).rejects.toMatchObject({
      message: 'gateway call failed: chat failed: fetch failed: connect ECONNREFUSED',
    });
  });

  it('200 但沒有 content(或 content 不是字串)算失敗,不回半截結果', async () => {
    for (const body of [{}, { content: null }, { content: 123 }]) {
      const fake = makeFetch({ chatBody: body });
      await expect(client(fake).chat({ prompt: '你好', model: MODEL })).rejects.toMatchObject({
        message: 'gateway call failed: chat returned no content',
      });
    }
  });

  it('回應沒回 model(或回空字串)時用送出去的模型名', async () => {
    // 空字串是邊界:`body.model.length > 0` 為假才會退回 args.model。
    for (const bad of ['', undefined, 123, null]) {
      const fake = makeFetch({ chatModel: bad });
      const r = await client(fake).chat({ prompt: '你好', model: MODEL });
      expect(r.model).toBe(MODEL);
    }
    const fake = makeFetch({ chatModel: 'deepseek-r1:70b' });
    expect((await client(fake).chat({ prompt: '你好', model: MODEL })).model).toBe('deepseek-r1:70b');
  });

  it('latency_ms 是經過的時間,不是兩個時間戳相加', async () => {
    const fake = makeFetch();
    const r = await client(fake).chat({ prompt: '你好', model: MODEL });
    expect(r.latency_ms).toBeGreaterThanOrEqual(0);
    // Date.now() + started 會是 2020 年代的兩倍,大約 3.5e12
    expect(r.latency_ms).toBeLessThan(60_000);
  });

  it('tokens_used 缺欄位或型別不對時就不放 tokens_in / tokens_out', async () => {
    const fake = makeFetch({ chatBody: { content: '嗨', tokens_used: { prompt: 'x' } } });
    const r = await client(fake).chat({ prompt: '你好', model: MODEL });
    expect(r.tokens_in).toBeUndefined();
    expect(r.tokens_out).toBeUndefined();
  });

  it('chat 用 POST、帶 JSON content-type 與 JWT', async () => {
    const fake = makeFetch();
    await client(fake).chat({ prompt: '你好', model: MODEL });
    const chatReq = fake.requests.find((r) => r.url.includes('/gateway/chat'));
    expect(chatReq).toMatchObject({
      method: 'POST',
      contentType: 'application/json',
      authorization: 'Bearer jwt-1',
    });
  });

  it('service 沒給時預設 chat', async () => {
    const fake = makeFetch();
    await client(fake).chat({ prompt: '你好', model: MODEL });
    expect(fake.chatBodies[0]?.service).toBe('chat');
  });
});

describe('GatewayClient — 回應不是 JSON', () => {
  // 閘道前面通常還有一層反向代理。它掛掉時回的是 HTML 錯誤頁,不是 JSON。
  // response.json() 會丟錯——那個錯不能冒出去變成看不懂的 SyntaxError。
  it('換 token 時拿到 HTML 當成「沒有 access_token」', async () => {
    const fake = makeFetch({ rawOn: 'token' });
    await expect(client(fake).token()).rejects.toMatchObject({
      message: 'gateway call failed: token exchange returned no access_token',
    });
  });

  it('probe 拿到 HTML 回不可用,不 throw', async () => {
    const fake = makeFetch({ rawOn: 'models' });
    await expect(client(fake).probe()).resolves.toEqual({ available: false, models: [] });
  });

  it('chat 拿到 HTML 當成「沒有 content」,不會冒出 SyntaxError', async () => {
    const fake = makeFetch({ rawOn: 'chat' });
    await expect(client(fake).chat({ prompt: '你好', model: MODEL })).rejects.toMatchObject({
      name: 'GatewayCallError',
      message: 'gateway call failed: chat returned no content',
    });
  });
});

describe('GatewayClient.chat — 呼叫端的 AbortSignal', () => {
  // GatewayLlmRouter 會用 defaultTimeoutMs 開一個 controller 傳進來。
  // signal 沒有真的接上 fetch 的話,逾時就完全沒有作用。
  it('signal 有傳給 fetch', async () => {
    const fake = makeFetch();
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/gateway/chat')) seen = init?.signal ?? undefined;
      return fake.fetchImpl(input, init);
    }) as typeof fetch;
    await client(fake, { fetchImpl: spy }).chat({ prompt: '你好', model: MODEL, signal: controller.signal });
    expect(seen).toBe(controller.signal);
  });

  it('已經 abort 掉的 signal 讓 chat 失敗,而不是照樣送出去', async () => {
    const fake = makeFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(
      client(fake).chat({ prompt: '你好', model: MODEL, signal: controller.signal }),
    ).rejects.toBeInstanceOf(GatewayCallError);
  });
});

describe('createGatewayClient — 契約 §11 的環境變數', () => {
  it('從三個環境變數組出 client', () => {
    const c = createGatewayClient({
      GATEWAY_BASE_URL: BASE,
      GATEWAY_API_KEY: KEY,
      LLM_LOCAL_MODEL: MODEL,
    });
    expect(c.config).toEqual({ baseUrl: BASE, apiKey: KEY, model: MODEL });
  });

  it('base url 結尾的斜線會被去掉,免得組出 //gateway/chat', () => {
    const c = createGatewayClient({
      GATEWAY_BASE_URL: `${BASE}/`,
      GATEWAY_API_KEY: KEY,
      LLM_LOCAL_MODEL: MODEL,
    });
    expect(c.config.baseUrl).toBe(BASE);
  });

  it('沒有 GATEWAY_API_KEY 就丟 MissingCredentialError,點名那個變數', () => {
    try {
      createGatewayClient({ GATEWAY_BASE_URL: BASE, LLM_LOCAL_MODEL: MODEL });
      expect.unreachable('應該丟錯');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingCredentialError);
      expect((err as MissingCredentialError).envVar).toBe('GATEWAY_API_KEY');
    }
  });

  it('沒有 GATEWAY_BASE_URL 就用 .env.example 的預設 http://localhost:8787', () => {
    const c = createGatewayClient({ GATEWAY_API_KEY: KEY });
    expect(c.config.baseUrl).toBe('http://localhost:8787');
    expect(DEFAULT_GATEWAY_BASE_URL).toBe('http://localhost:8787');
  });

  it('結尾有好幾個斜線也全部去掉,不只去掉一個', () => {
    // `\/+$` 與 `\/$` 的差別:`http://x:8787///` 只去掉一個會留下 `//`,
    // 組出來就是 `http://x:8787///gateway/chat`。
    const c = createGatewayClient({ GATEWAY_BASE_URL: 'http://gw.test:8787///', GATEWAY_API_KEY: KEY });
    expect(c.config.baseUrl).toBe('http://gw.test:8787');
  });

  it('預設本機模型常數就是 qwen2.5:32b', () => {
    expect(DEFAULT_LOCAL_MODEL).toBe('qwen2.5:32b');
  });

  it('沒有 LLM_LOCAL_MODEL 就用 .env.example 的預設 qwen2.5:32b', () => {
    const c = createGatewayClient({ GATEWAY_BASE_URL: BASE, GATEWAY_API_KEY: KEY });
    expect(c.config.model).toBe('qwen2.5:32b');
  });
});


// ================================================ 收尾輪:probe 的逾時涵蓋範圍
//
// `probe()` 開的 AbortController 只傳給 `/gateway/models` 的 fetch;`token()` 打
// `/auth/token/exchange` 的那個 fetch **沒有 signal**。也就是閘道的 auth 端點掛住
// 時,`probe()` 會無限期卡住,`GATEWAY_PROBE_TIMEOUT_MS = 5000` 完全沒作用。
//
// 現在 `GATEWAY_BASE_URL` 是 `localhost:8787`,沒人聽就是立刻 ECONNREFUSED,所以
// 看不出來。但 ADR-039 明說「啟用只需閘道可達,不用改程式」,而且 Consequences
// 特別要求「probeLocal() 的逾時要短(當可用性檢查用)」——換成網域之後封包被防火牆
// 黑洞吃掉,`token()` 會掛到 OS 預設的 TCP timeout(可能兩分鐘)。這是**啟用當天
// 就會踩到**的東西,不是理論問題。
//
// 這一輪只寫測試,實作留給下一輪,所以下面是預期的紅燈。
describe('GatewayClient.probe — 逾時要涵蓋換 token 那一步', () => {
  it('換 token 永不回應時,probe 仍在逾時內回不可用,不會一直掛著', async () => {
    // 用假計時器,不真的等 5 秒。
    vi.useFakeTimers();
    try {
      const fake = makeFetch({ tokenHangs: true });
      let settled: unknown;
      void client(fake, { probeTimeoutMs: GATEWAY_PROBE_TIMEOUT_MS })
        .probe()
        .then(
          (result) => {
            settled = result;
          },
          // probe() 契約上不 throw;真的丟了要看得出來,不能讓它假裝成「還沒回來」。
          (err: unknown) => {
            settled = err;
          },
        );

      // 推進到遠超過逾時。逾時真的管得到換 token 的話,這時候早就回來了。
      await vi.advanceTimersByTimeAsync(GATEWAY_PROBE_TIMEOUT_MS * 10);

      expect(settled).toEqual({ available: false, models: [] });
      // 而且真的有打出去過——不是靠「根本沒發請求」蒙混過關。
      expect(fake.tokenCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('probe 打的換 token 請求要帶 AbortSignal(逾時管得到它的前提)', async () => {
    // 上一條測的是行為,這條測的是機制:少了 signal,逾時就只是一個沒人聽的計時器。
    const fake = makeFetch();
    await client(fake).probe();
    const tokenRequest = fake.requests.find((r) => r.url.includes('/auth/token/exchange'));
    expect(tokenRequest).toBeDefined();
    expect(tokenRequest?.hasSignal).toBe(true);
  });

  it('換 token 掛住不會留下逾時計時器', async () => {
    // finally 的 clearTimeout 在逾時路徑上也要有效,不然短命的 CLI 程序
    // (scripts/llm.ts --probe)還是要多掛著。
    vi.useFakeTimers();
    try {
      const fake = makeFetch({ tokenHangs: true });
      let done = false;
      void client(fake, { probeTimeoutMs: GATEWAY_PROBE_TIMEOUT_MS })
        .probe()
        .then(
          () => {
            done = true;
          },
          () => {
            done = true;
          },
        );
      await vi.advanceTimersByTimeAsync(GATEWAY_PROBE_TIMEOUT_MS * 10);
      expect(done).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================== 審核補洞:一個計時器管兩段 vs 兩段各開一個計時器
//
// 上面那三條**分辨不出來**實作是哪一種:
//
//   - `tokenHangs` 那條:換 token 永遠不回。兩段各開一個 5 秒計時器的話,換 token
//     那一段自己的計時器一樣會在 5 秒 abort 它 → 一樣回不可用 → 一樣綠。
//   - `hasSignal` 那條:兩種做法都會**帶** signal,只是帶的是不是同一個。
//   - `getTimerCount` 那條:兩種做法最後都會清乾淨。
//
// 差別只在**額度是共用還是各算**。所以要一個「每一段都在額度內、但加起來超過」的
// 情境才分得出來:換 token 花 4 秒、`/gateway/models` 再花 2 秒,總共 6 秒。
//
//   - 一個計時器管兩段(現在的實作):5 秒到的時候第二個請求還在飛 → abort → 不可用。
//   - 兩段各開一個 5 秒的計時器:4 < 5、2 < 5,兩段都沒逾時 → 回**可用**。
//
// 這是「逾時涵蓋整個 probe 流程」這句話真正的意思。少了這條,把 `probe()` 改成
// 各開一個 controller 仍然全綠,而閘道換成網域之後(auth 端點慢、models 端點也慢)
// probe 就會拖到接近兩倍的時間才回答一個「可不可用」的問題。
describe('GatewayClient.probe — 逾時是整段流程共用一份額度,不是每段各一份', () => {
  it('換 token 4 秒 + models 2 秒(各自都沒超過 5 秒,加起來超過)→ 回不可用', async () => {
    vi.useFakeTimers();
    try {
      const fake = makeFetch({ tokenDelayMs: 4_000, modelsDelayMs: 2_000 });
      let settled: unknown;
      void client(fake, { probeTimeoutMs: GATEWAY_PROBE_TIMEOUT_MS })
        .probe()
        .then(
          (result) => {
            settled = result;
          },
          (err: unknown) => {
            settled = err;
          },
        );

      await vi.advanceTimersByTimeAsync(GATEWAY_PROBE_TIMEOUT_MS * 10);

      // 兩段各算一份額度的實作在這裡會拿到 { available: true, models: [...] }。
      expect(settled).toEqual({ available: false, models: [] });
      // 兩段都真的打出去過——不是在第一段就掛掉、根本沒走到第二段。
      expect(fake.tokenCalls).toBe(1);
      expect(fake.modelCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('對照組:同樣的 4 秒 + 2 秒,額度放寬到 10 秒就回可用', async () => {
    // 沒有這一條的話,上面那條可能是被「假的延遲根本回不來」這種理由弄綠的,
    // 而不是被逾時。兩條一起看才證明分辨的是**額度**,不是別的東西。
    vi.useFakeTimers();
    try {
      const fake = makeFetch({ tokenDelayMs: 4_000, modelsDelayMs: 2_000 });
      let settled: unknown;
      void client(fake, { probeTimeoutMs: 10_000 })
        .probe()
        .then(
          (result) => {
            settled = result;
          },
          (err: unknown) => {
            settled = err;
          },
        );

      await vi.advanceTimersByTimeAsync(60_000);

      expect(settled).toEqual({ available: true, models: Object.keys(MODELS) });
    } finally {
      vi.useRealTimers();
    }
  });

  it('probe 的兩個請求帶的是**同一個** AbortSignal(共用額度的機制前提)', async () => {
    // 上面兩條測行為,這條測機制。兩個 fetch 各拿各的 controller 的話,
    // 「共用一份額度」就只是巧合,下一個人重構時沒有東西擋著。
    const seen: (AbortSignal | null | undefined)[] = [];
    const inner = makeFetch();
    const spying = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      seen.push(init?.signal);
      return inner.fetchImpl(input, init);
    }) as typeof fetch;

    await new GatewayClient({
      config: { baseUrl: BASE, apiKey: KEY, model: MODEL },
      fetchImpl: spying,
    }).probe();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[1]).toBe(seen[0]);
  });
});
