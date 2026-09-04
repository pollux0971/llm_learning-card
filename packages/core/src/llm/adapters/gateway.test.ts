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
import { describe, expect, it } from 'vitest';
import { GatewayCallError, GatewayModelRejectedError, MissingCredentialError } from '../errors.js';
import {
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
  throwOn?: 'all' | 'models' | undefined;
}

interface FakeFetch {
  fetchImpl: typeof fetch;
  tokenCalls: number;
  modelCalls: number;
  chatCalls: number;
  chatBodies: { prompt?: string; model?: string; service?: string }[];
  authHeaders: string[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeFetch(opts: FakeOpts = {}): FakeFetch {
  const state: FakeFetch = {
    fetchImpl: (() => {}) as unknown as typeof fetch,
    tokenCalls: 0,
    modelCalls: 0,
    chatCalls: 0,
    chatBodies: [],
    authHeaders: [],
  };

  const pick = (list: number[] | undefined, i: number): number => {
    if (!list || list.length === 0) return 200;
    return list[Math.min(i, list.length - 1)]!;
  };

  state.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    state.authHeaders.push(headers.get('authorization') ?? '');

    if (opts.throwOn === 'all') throw new TypeError('fetch failed: connect ECONNREFUSED');

    if (url.includes('/auth/token/exchange')) {
      const status = pick(opts.tokenStatuses, state.tokenCalls);
      state.tokenCalls += 1;
      if (status !== 200) return json({ detail: 'invalid api key' }, status);
      const body: Record<string, unknown> = { access_token: `jwt-${state.tokenCalls}` };
      if (opts.expiresIn !== undefined) body.expires_in = opts.expiresIn;
      return json(body);
    }

    if (url.includes('/gateway/models')) {
      if (opts.throwOn === 'models') throw new TypeError('fetch failed: connect ECONNREFUSED');
      state.modelCalls += 1;
      return json({ auto_match: true, models: MODELS });
    }

    if (url.includes('/gateway/chat')) {
      const status = pick(opts.chatStatuses, state.chatCalls);
      const body = JSON.parse(String(init?.body ?? '{}')) as { prompt?: string; model?: string; service?: string };
      state.chatBodies.push(body);
      state.chatCalls += 1;
      if (status !== 200) return json({ detail: `status ${status}` }, status);
      return json({
        content: '本機模型的回覆。',
        provider: 'ollama',
        model: body.model ?? MODEL,
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

  it('沒有 LLM_LOCAL_MODEL 就用 .env.example 的預設 qwen2.5:32b', () => {
    const c = createGatewayClient({ GATEWAY_BASE_URL: BASE, GATEWAY_API_KEY: KEY });
    expect(c.config.model).toBe('qwen2.5:32b');
  });
});
