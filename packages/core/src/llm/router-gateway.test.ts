/**
 * router-gateway.ts 的單元測試(ADR-039)。
 *
 * 這一層只做「把三個純函式接到 I/O 上」,所以測的是**接線**:
 *   - 該走閘道的真的走閘道、該走雲端的真的走雲端
 *   - 雲端失敗時真的會退到閘道,而且只有該退的 task 會退
 *   - 備援那一筆 log 有 `fallback: "gateway"` 與 `fallback_reason`
 *   - 設定錯誤(缺憑證、403)**不**觸發備援
 *
 * 決策本身在 fallback.test.ts / routing.test.ts / spend.test.ts,不在這裡重測。
 * 雲端 adapter 用注入的假的,閘道用注入的假 fetch,兩邊都不打真網路。
 */
import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@contracts/index.js';
import {
  CloudRequiredError,
  DailyBudgetExceededError,
  GatewayModelRejectedError,
  LlmTimeoutError,
  MissingCredentialError,
  OutputTruncatedError,
  UnknownTaskError,
  UnsupportedProviderError,
} from './errors.js';
import { GatewayClient } from './adapters/gateway.js';
import { GatewayLlmRouter, isCloudFailure } from './router-gateway.js';
import type { CloudAdapter, LlmTask } from './types.js';
import type { DailySpend, SpendPrices } from './spend.js';

const BASE = 'http://gateway.test:8787';
const LOCAL_MODEL = 'qwen2.5:32b';
const PRICES: SpendPrices = { inPerM: 2.5, outPerM: 10 };
const CAP = 1;

interface Harness {
  cloudCalls: number;
  gatewayChats: number;
  logged: LogEvent[];
  router: GatewayLlmRouter;
}

function makeHarness(opts: { cloudFails?: Error; spend?: DailySpend; online?: boolean } = {}): Harness {
  const h: Partial<Harness> & { cloudCalls: number; gatewayChats: number; logged: LogEvent[] } = {
    cloudCalls: 0,
    gatewayChats: 0,
    logged: [],
  };

  const cloudAdapter: CloudAdapter = {
    async call({ prompt, model }) {
      h.cloudCalls += 1;
      if (opts.cloudFails) throw opts.cloudFails;
      return { text: `雲端回覆:${prompt}`, provider: 'openai', model, latency_ms: 5, tokens_in: 7, tokens_out: 9 };
    },
  };

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url.includes('/auth/token/exchange')) return json({ access_token: 'jwt-1', expires_in: 3600 });
    if (url.includes('/gateway/models')) return json({ auto_match: true, models: { [LOCAL_MODEL]: ['chat'] } });
    if (url.includes('/gateway/chat')) {
      h.gatewayChats += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
      return json({
        content: '閘道回覆。',
        provider: 'ollama',
        model: body.model ?? LOCAL_MODEL,
        tokens_used: { prompt: 3, completion: 4 },
      });
    }
    throw new Error(`沒有預期到的請求:${url}`);
  }) as typeof fetch;

  h.router = new GatewayLlmRouter({
    env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'gpt-5.6-luna', OPENAI_API_KEY: 'k', LLM_LOCAL_MODEL: LOCAL_MODEL },
    adapters: { openai: cloudAdapter },
    onlineProber: async () => opts.online ?? true,
    logAppender: (event) => h.logged.push(event),
    gateway: new GatewayClient({ config: { baseUrl: BASE, apiKey: 'gk', model: LOCAL_MODEL }, fetchImpl }),
    dailyCapUsd: CAP,
    prices: PRICES,
    spendReader: () => opts.spend ?? { usd: 0, calls: 0 },
  });

  return h as Harness;
}

function fallbackEvent(logged: LogEvent[]): Record<string, unknown> | undefined {
  return (logged as unknown as Record<string, unknown>[]).find((e) => e.fallback === 'gateway');
}

describe('isCloudFailure', () => {
  it('逾時算雲端失敗,可以備援', () => {
    expect(isCloudFailure(new LlmTimeoutError('deepen', 60_000))).toBe(true);
  });

  it('截斷算雲端失敗', () => {
    expect(isCloudFailure(new OutputTruncatedError('deepen', 2048, 2048))).toBe(true);
  });

  it('缺憑證不算——備援只會讓錯誤設定一直藏著', () => {
    expect(isCloudFailure(new MissingCredentialError('OPENAI_API_KEY'))).toBe(false);
  });

  it('provider 不支援不算', () => {
    expect(isCloudFailure(new UnsupportedProviderError('nope'))).toBe(false);
  });

  it('task 不在契約裡不算', () => {
    expect(isCloudFailure(new UnknownTaskError('not.a.task'))).toBe(false);
  });

  it('帶 5xx 狀態碼的錯誤算', () => {
    expect(isCloudFailure(Object.assign(new Error('service unavailable'), { status: 503 }))).toBe(true);
  });

  it('4xx 不算(那是請求本身有問題,重試沒用)', () => {
    expect(isCloudFailure(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false);
  });

  it('不是 Error 的東西不算', () => {
    expect(isCloudFailure('boom')).toBe(false);
    expect(isCloudFailure(undefined)).toBe(false);
  });
});

describe('GatewayLlmRouter.probeLocal', () => {
  it('委派給閘道,回可用與模型清單', async () => {
    const h = makeHarness();
    await expect(h.router.probeLocal()).resolves.toEqual({ available: true, models: [LOCAL_MODEL] });
  });
});

describe('GatewayLlmRouter.call — 一般路徑', () => {
  it('grade.fill.llm 走閘道,provider 是 ollama,不標 provisional', async () => {
    const h = makeHarness();
    const result = await h.router.call('grade.fill.llm', '填空題');
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe(LOCAL_MODEL);
    expect(result.provisional).toBe(false);
    expect(h.cloudCalls).toBe(0);
  });

  it.each(['deepen', 'grade.apply', 'reteach.short'] as LlmTask[])('%s 雲端沒事就走雲端', async (task) => {
    const h = makeHarness();
    const result = await h.router.call(task, '提示');
    expect(result.provider).toBe('openai');
    expect(result.provisional).toBe(false);
    expect(h.gatewayChats).toBe(0);
  });

  it.each(['ingest.cards', 'ingest.questions', 'ingest.deps'] as LlmTask[])('%s 走雲端', async (task) => {
    const h = makeHarness();
    const result = await h.router.call(task, '提示');
    expect(result.provider).toBe('openai');
    expect(h.gatewayChats).toBe(0);
  });
});

describe('GatewayLlmRouter.call — 雲端失敗時的備援', () => {
  it('grade.apply 退到閘道並標 provisional', async () => {
    const h = makeHarness({ cloudFails: Object.assign(new Error('503'), { status: 503 }) });
    const result = await h.router.call('grade.apply', '應用題');
    expect(result.provider).toBe('ollama');
    expect(result.provisional).toBe(true);
    expect(h.gatewayChats).toBe(1);
  });

  it('備援那一筆 log 記下 fallback 與原因', async () => {
    const h = makeHarness({ cloudFails: Object.assign(new Error('503'), { status: 503 }) });
    await h.router.call('grade.apply', '應用題');
    const event = fallbackEvent(h.logged);
    expect(event).toBeDefined();
    expect(event?.fallback).toBe('gateway');
    expect(event?.fallback_reason).toBe('cloud_failed');
    expect(event?.task).toBe('grade.apply');
  });

  it('逾時也會備援', async () => {
    const h = makeHarness({ cloudFails: new LlmTimeoutError('deepen', 60_000) });
    const result = await h.router.call('deepen', '深入');
    expect(result.provider).toBe('ollama');
    expect(result.provisional).toBe(true);
  });

  it('ingest.cards 不備援,丟 CLOUD_REQUIRED,而且閘道一次都沒被打', async () => {
    const h = makeHarness({ cloudFails: Object.assign(new Error('503'), { status: 503 }) });
    await expect(h.router.call('ingest.cards', '生成卡片')).rejects.toBeInstanceOf(CloudRequiredError);
    expect(h.gatewayChats).toBe(0);
  });

  it('缺憑證這種設定錯誤不備援,原錯誤直接往外丟', async () => {
    const h = makeHarness({ cloudFails: new MissingCredentialError('OPENAI_API_KEY') });
    await expect(h.router.call('deepen', '深入')).rejects.toBeInstanceOf(MissingCredentialError);
    expect(h.gatewayChats).toBe(0);
  });
});

describe('GatewayLlmRouter.call — 雲端整個連不上(probeOnline 回 false)', () => {
  // ADR-039 讓閘道成為契約 §7 的「本機」,但底層 LlmRouterImpl 的 localProber 是
  // alwaysUnavailable,不知道閘道存在——OpenAI 整個不通時它判成「離線+無本機」
  // 並丟 NoModelError。閘道在另一台機器上、還活著而且免費,這時候放棄是浪費,
  // 所以 call() 把 NoModelError 也當成可備援的失敗。
  //
  // 這一格契約 §7 沒有:那張表假設「離線」等於「什麼都連不到」,而 OpenAI 掛掉
  // 但區網閘道還在,是 ADR-039 之後才會發生的第四種情況。
  it('deepen 在 NoModelError 之後改走閘道並標 provisional', async () => {
    const h = makeHarness({ online: false });
    const result = await h.router.call('deepen', '同源政策');
    expect(result.provider).toBe('ollama');
    expect(result.provisional).toBe(true);
    expect(h.gatewayChats).toBe(1);
    // 離線,雲端 adapter 一次都不該被打到
    expect(h.cloudCalls).toBe(0);
  });

  it('grade.apply 與 reteach.short 也一樣', async () => {
    for (const task of ['grade.apply', 'reteach.short'] as const) {
      const h = makeHarness({ online: false });
      const result = await h.router.call(task, '同源政策');
      expect(result.provider).toBe('ollama');
      expect(result.provisional).toBe(true);
    }
  });

  it('備援那一筆 log 記下原因是 cloud_failed,而不是預算', async () => {
    const h = makeHarness({ online: false });
    await h.router.call('deepen', '同源政策');
    expect(fallbackEvent(h.logged)?.fallback_reason).toBe('cloud_failed');
  });

  it('ingest.cards 不因為閘道活著就改走它——契約 §7 的 CLOUD_REQUIRED 不變', async () => {
    const h = makeHarness({ online: false });
    await expect(h.router.call('ingest.cards', '同源政策')).rejects.toBeInstanceOf(CloudRequiredError);
    expect(h.gatewayChats).toBe(0);
  });
});

describe('GatewayLlmRouter.call — 當日預算', () => {
  it('預算用完時 deepen 直接走閘道,連雲端都不打', async () => {
    const h = makeHarness({ spend: { usd: CAP, calls: 3 } });
    const result = await h.router.call('deepen', '深入');
    expect(result.provider).toBe('ollama');
    expect(result.provisional).toBe(true);
    expect(h.cloudCalls).toBe(0);
  });

  it('預算用完的備援原因是 budget_exhausted', async () => {
    const h = makeHarness({ spend: { usd: CAP, calls: 3 } });
    await h.router.call('deepen', '深入');
    expect(fallbackEvent(h.logged)?.fallback_reason).toBe('budget_exhausted');
  });

  it('預算用完時 ingest.cards 在花錢之前就被拒絕', async () => {
    const h = makeHarness({ spend: { usd: CAP, calls: 3 } });
    await expect(h.router.call('ingest.cards', '生成卡片')).rejects.toBeInstanceOf(DailyBudgetExceededError);
    expect(h.cloudCalls).toBe(0);
    expect(h.gatewayChats).toBe(0);
  });

  it('剛好等於上限就算用完(ADR-039 的邊界)', async () => {
    const h = makeHarness({ spend: { usd: CAP, calls: 1 } });
    expect(h.router.budgetExhausted()).toBe(true);
  });

  it('差一點點還沒用完', async () => {
    const h = makeHarness({ spend: { usd: CAP - 0.000_1, calls: 1 } });
    expect(h.router.budgetExhausted()).toBe(false);
    const result = await h.router.call('deepen', '深入');
    expect(result.provider).toBe('openai');
  });

  it('dailySpend() 回報今天的金額與筆數', () => {
    const h = makeHarness({ spend: { usd: 0.42, calls: 5 } });
    expect(h.router.dailySpend()).toEqual({ usd: 0.42, calls: 5 });
  });

  it('grade.fill.llm 不受預算影響——它本來就免費', async () => {
    const h = makeHarness({ spend: { usd: 99, calls: 100 } });
    const result = await h.router.call('grade.fill.llm', '填空題');
    expect(result.provider).toBe('ollama');
    expect(result.provisional).toBe(false);
  });
});

describe('GatewayLlmRouter.call — 閘道 403 不觸發備援', () => {
  it('填了雲端模型名時錯誤往外丟,不改走雲端', async () => {
    const h = makeHarness();
    const rejecting = new GatewayLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'gpt-5.6-luna', OPENAI_API_KEY: 'k' },
      onlineProber: async () => true,
      logAppender: () => {},
      gateway: new GatewayClient({
        config: { baseUrl: BASE, apiKey: 'gk', model: 'gpt-5.6-luna' },
        fetchImpl: (async (input: RequestInfo | URL): Promise<Response> => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          const json = (b: unknown, s = 200): Response => new Response(JSON.stringify(b), { status: s });
          if (url.includes('/auth/token/exchange')) return json({ access_token: 'jwt-1', expires_in: 3600 });
          return json({ detail: 'model not allowed' }, 403);
        }) as typeof fetch,
      }),
      dailyCapUsd: CAP,
      prices: PRICES,
      spendReader: () => ({ usd: 0, calls: 0 }),
    });
    await expect(rejecting.call('grade.fill.llm', '填空題')).rejects.toBeInstanceOf(GatewayModelRejectedError);
    expect(h.cloudCalls).toBe(0);
  });
});
