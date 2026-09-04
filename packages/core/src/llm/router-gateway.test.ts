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
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogEvent } from '@contracts/index.js';
import { parseLogLines } from '@core/schema/log.js';
import {
  CloudRequiredError,
  DailyBudgetExceededError,
  GatewayCallError,
  GatewayModelRejectedError,
  LlmTimeoutError,
  MissingCredentialError,
  NoModelError,
  OutputTruncatedError,
  UnknownTaskError,
  UnsupportedProviderError,
} from './errors.js';
import { GatewayClient } from './adapters/gateway.js';
import { GatewayLlmRouter, isCloudFailure } from './router-gateway.js';
import {
  FALLBACK_TABLE,
  decideFallback,
  type FallbackDecision,
  type FallbackGroup,
} from './fallback.js';
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

function makeHarness(opts: { cloudFails?: Error; spend?: DailySpend; online?: boolean; gatewayDown?: boolean } = {}): Harness {
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
    // 閘道整台不在(機器沒開 / 沒網路):連 /auth/token/exchange 都連不上。
    // 照 features/steps/_fake-cloud.mjs 的模式,只換 fetch,GatewayClient 與
    // router 全跑真的——所以這裡丟的就是真的 fetch 連不上時丟的那個 TypeError。
    if (opts.gatewayDown) throw new TypeError('fetch failed: connect ECONNREFUSED');
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

/**
 * 「什麼都沒丟」也是一種結果,而且是最容易讓 `expect(...).not.toBe(X)` 假綠的
 * 那一種——用一個哨兵值把它跟「丟了東西」分開,測試裡再明確排除掉。
 */
const NOTHING_THROWN = Symbol('沒有丟出任何錯誤');

async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return NOTHING_THROWN;
  } catch (err) {
    return err;
  }
}

/** 契約 §7 的錯誤都帶 `code`。不是 Error 或沒有 code 就回 undefined。 */
function codeOf(err: unknown): unknown {
  return err instanceof Error ? (err as { code?: unknown }).code : undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const ALL_TASKS: LlmTask[] = [
  'ingest.cards',
  'ingest.questions',
  'ingest.deps',
  'deepen',
  'grade.apply',
  'reteach.short',
  'grade.fill.llm',
];

/** 契約 §7 路由表第三欄(離線+無本機)要求 NO_MODEL 的四個 task。 */
const OFFLINE_NO_MODEL_TASKS: LlmTask[] = ['deepen', 'grade.apply', 'reteach.short', 'grade.fill.llm'];

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


// ============================================================ 收尾輪:契約偏差
//
// 契約 §7 路由表第三欄「離線+無本機」對 deepen / grade.apply / reteach.short /
// grade.fill.llm 的要求是 **`NO_MODEL`**。閘道就是 ADR-039 決策 1 定義的「本機」,
// 所以「連閘道也連不上」**就是**「無本機」那一格,不是一種新的失敗種類。
//
// phase-4 的審核輪實測到這裡丟的是 `GATEWAY_FAILED`,而且**刻意沒有補測試**——
// 補了就等於把偏差固化成規格。技術顧問裁決:**對齊契約,但保留資訊**。
//
//   - 丟出來的 `code` / 型別是 `NO_MODEL`
//   - 閘道層的細節放進 `cause`:`new NoModelError('...', { cause: gatewayError })`
//   - 訊息文字仍要說得清「本機閘道不可達」
//   - `GATEWAY_FAILED` 只准出現在閘道 adapter 內部,不外洩
//
// 為什麼不能反過來把 `GATEWAY_FAILED` 寫成規格:§7 是**硬約定**,`NO_MODEL` 是
// 消費者(05-grading/phase-3 的離線審核、11-review、之後的 06)分支的依據。
// 實作發明第二個名字,等於讓**每一個**消費者都多一個 case 要處理。
//
// 這一輪只寫測試,實作留給下一輪——所以下面這些是預期的紅燈。
describe('GatewayLlmRouter.call — 完全離線(雲端不通 + 閘道也不通)', () => {
  it.each(OFFLINE_NO_MODEL_TASKS)('%s 丟契約 §7 的 NO_MODEL,不是閘道的錯誤碼', async (task) => {
    const h = makeHarness({ online: false, gatewayDown: true });
    const err = await caught(() => h.router.call(task, '同源政策'));
    expect(err).toBeInstanceOf(NoModelError);
    expect(codeOf(err)).toBe('NO_MODEL');
  });

  it.each(OFFLINE_NO_MODEL_TASKS)('%s 把閘道的原始錯誤留在 cause 裡,診斷資訊不丟掉', async (task) => {
    const h = makeHarness({ online: false, gatewayDown: true });
    const err = await caught(() => h.router.call(task, '同源政策'));
    const cause = (err as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(GatewayCallError);
    expect(codeOf(cause)).toBe('GATEWAY_FAILED');
    // cause 要是**這一次**閘道真的丟出來的那個,不是隨手 new 一個空殼。
    expect(messageOf(cause)).toContain('ECONNREFUSED');
  });

  it.each(OFFLINE_NO_MODEL_TASKS)('%s 的訊息說得清「本機閘道不可達」,不是只有一句沒有模型', async (task) => {
    const h = makeHarness({ online: false, gatewayDown: true });
    const err = await caught(() => h.router.call(task, '同源政策'));
    expect(messageOf(err)).toMatch(/gateway/i);
    // 還是要看得出來是哪個 task ——NoModelError 原本就帶 task,別在改訊息時弄丟。
    expect(messageOf(err)).toContain(task);
  });

  // 審核補洞:上面那條的 `/gateway/i` **鎖不住 router 自己加的那句話**。
  // `cause` 的 `GatewayCallError` 訊息本來就以「gateway call failed: 」開頭,所以
  // 把 detail 從 `local gateway unreachable: …` 改成 `unreachable: …`(整個「本機
  // 閘道」的說法都不見了),`/gateway/i` 仍然被**內層**那句話餵飽 → 全綠。實測過。
  //
  // detail 是 router 這一層唯一貢獻的使用者可見文字,鎖它要鎖字面。
  it.each(OFFLINE_NO_MODEL_TASKS)('%s 的 detail 字面就是「local gateway unreachable」', async (task) => {
    const h = makeHarness({ online: false, gatewayDown: true });
    const err = await caught(() => h.router.call(task, '同源政策'));
    expect(messageOf(err)).toContain('(local gateway unreachable: ');
  });

  it('離線時的完整訊息一字不差(括號內外都是使用者看得到的東西)', async () => {
    // 只挑 grade.fill.llm 一個 task 做全字串比對:它是**直接**走閘道那條路
    // (不經過雲端失敗),所以內層訊息最短、最不會因為別處改動而假紅。
    const h = makeHarness({ online: false, gatewayDown: true });
    const err = await caught(() => h.router.call('grade.fill.llm', '填空題'));
    expect(messageOf(err)).toBe(
      'task "grade.fill.llm" has no model available: offline and no local model ' +
        '(local gateway unreachable: gateway call failed: token exchange failed: fetch failed: connect ECONNREFUSED)',
    );
  });

  it.each(['ingest.cards', 'ingest.questions', 'ingest.deps'] as LlmTask[])(
    '%s 不變:離線一律 CLOUD_REQUIRED,而且閘道一次都沒被打',
    async (task) => {
      const h = makeHarness({ online: false, gatewayDown: true });
      const err = await caught(() => h.router.call(task, '同源政策'));
      expect(err).toBeInstanceOf(CloudRequiredError);
      expect(codeOf(err)).toBe('CLOUD_REQUIRED');
      expect(h.gatewayChats).toBe(0);
    },
  );

  it('probeLocal() 在閘道整台不在時回不可用,不 throw(phase-2 的行為不變)', async () => {
    const h = makeHarness({ online: false, gatewayDown: true });
    await expect(h.router.probeLocal()).resolves.toEqual({ available: false, models: [] });
  });
});

describe('GATEWAY_FAILED 不從 router 的公開介面外洩', () => {
  // GatewayCallError / `GATEWAY_FAILED` 是**閘道 adapter 的內部詞彙**:它描述的是
  // 「那台代理這次不行」,不是呼叫端能拿來分支的東西。router 對外只講契約 §7 的詞
  // (NO_MODEL / CLOUD_REQUIRED),加上 ADR-039 明寫要往外丟的兩個設定錯誤
  // (GATEWAY_MODEL_REJECTED、BUDGET_EXCEEDED)。

  it.each(ALL_TASKS)('%s:完全離線時丟出來的不是 GATEWAY_FAILED', async (task) => {
    const h = makeHarness({ online: false, gatewayDown: true });
    const err = await caught(() => h.router.call(task, '同源政策'));
    expect(err).not.toBe(NOTHING_THROWN);
    expect(err).not.toBeInstanceOf(GatewayCallError);
    expect(codeOf(err)).not.toBe('GATEWAY_FAILED');
  });

  it('grade.fill.llm:在線但閘道不通,一樣不外洩', async () => {
    // 契約 §7 對 grade.fill.llm 的「在線」那一欄寫的就是 local,所以對它來說
    // 「閘道不通」仍然是「無本機」;§7 給這個 task 定義的失敗只有 NO_MODEL 一種。
    const h = makeHarness({ online: true, gatewayDown: true });
    const err = await caught(() => h.router.call('grade.fill.llm', '填空題'));
    expect(err).not.toBe(NOTHING_THROWN);
    expect(err).not.toBeInstanceOf(GatewayCallError);
    expect(codeOf(err)).not.toBe('GATEWAY_FAILED');
  });

  it('在線、雲端失敗、閘道也不通:備援兩邊都掛掉時仍不外洩', async () => {
    // 這一格契約 §7 沒有(那張表假設「在線」就等於雲端可用)。所以這裡**只**鎖住
    // 「不准把閘道的內部錯誤碼丟給呼叫端」這一條;該丟原本那個雲端錯誤、還是
    // NO_MODEL,是實作的選擇,這個測試刻意不指定。
    const h = makeHarness({ cloudFails: Object.assign(new Error('503'), { status: 503 }), gatewayDown: true });
    const err = await caught(() => h.router.call('deepen', '同源政策'));
    expect(err).not.toBe(NOTHING_THROWN);
    expect(err).not.toBeInstanceOf(GatewayCallError);
    expect(codeOf(err)).not.toBe('GATEWAY_FAILED');
  });
});


// ==================================================== 收尾輪:router-gateway.ts
//                                       的備援重試分支裡那個到不了的 if
//
// `call()` 的 catch 裡是這樣:
//
//     const retry = decideFallback({ task, cloud: 'failed', ... }, this.fallbackTable);
//     if (retry.target !== 'gateway') throw err;      // ← 到不了
//     return this.callGateway(task, prompt, retry, opts, err);
//
// `cloud` 在這裡是**寫死的 `'failed'`**,而 `decideFallback` 在 `cloud === 'failed'`
// 時三個分組的結果分別是:gateway-always → gateway、gateway-fallback → gateway、
// cloud-only → **丟 CloudRequiredError**。沒有任何一條路會回 `target: 'cloud'`,
// 所以那個 if 永遠是 false。
//
// 換句話說 `ingest.*` 拿到 CLOUD_REQUIRED 靠的是 decideFallback **丟出來**的錯誤
// (它會蓋掉原本的 err),不是那個 if。這一輪把「不會回到 cloud」這個前提用測試
// 鎖起來:下一輪可以放心刪掉那一行,而如果將來有人讓 decideFallback 在 'failed'
// 時回 cloud,這裡會先變紅。
//
// 查證方式(不是只信轉述):把那一行實際從原始碼刪掉跑全套,71 個檔案 1209 個
// 測試全綠。
describe('備援重試:cloud "failed" 永遠不會回到 cloud(router-gateway.ts 的死分支)', () => {
  // 這一份 Record 是**編譯期**的窮舉檢查:FallbackGroup 多一個成員時,少列的那個
  // 會讓 tsc 直接紅——不然新分組會從下面的迴圈裡靜靜溜掉。
  const EVERY_GROUP: Record<FallbackGroup, true> = {
    'gateway-always': true,
    'gateway-fallback': true,
    'cloud-only': true,
  };
  const GROUPS = Object.keys(EVERY_GROUP) as FallbackGroup[];

  const cases = ALL_TASKS.flatMap((task) => GROUPS.map((group) => ({ task, group })));

  it.each(cases)('$group 的 $task:回 gateway 或丟錯,不會回 cloud', ({ task, group }) => {
    const table = Object.fromEntries(ALL_TASKS.map((t) => [t, group])) as Record<LlmTask, FallbackGroup>;
    let decision: FallbackDecision;
    try {
      decision = decideFallback({ task, cloud: 'failed' }, table);
    } catch (err) {
      // cloud-only:decideFallback 自己丟 CloudRequiredError,函式根本沒回傳,
      // 所以那個 if 連被求值的機會都沒有。
      expect(err).toBeInstanceOf(CloudRequiredError);
      return;
    }
    expect(decision.target).toBe('gateway');
  });

  it.each(ALL_TASKS)('預設的 FALLBACK_TABLE:%s 也一樣', (task) => {
    let decision: FallbackDecision;
    try {
      decision = decideFallback({ task, cloud: 'failed' }, FALLBACK_TABLE);
    } catch (err) {
      expect(err).toBeInstanceOf(CloudRequiredError);
      return;
    }
    expect(decision.target).toBe('gateway');
  });

  it('FALLBACK_TABLE 沒有用到上面那三組以外的分組', () => {
    // 上面的窮舉靠 GROUPS;這條擋的是「表裡塞了一個不在型別裡的字串」那種繞過。
    expect(Object.values(FALLBACK_TABLE).every((g) => GROUPS.includes(g))).toBe(true);
    expect(Object.keys(FALLBACK_TABLE).sort()).toEqual([...ALL_TASKS].sort());
  });
});


// ============================================ 審核補洞:router-gateway.ts 的變異覆蓋
//
// 這一輪是 `router-gateway.ts` **第一次**被 Stryker 量到(上一輪的報告寫得很清楚:
// 它不在當時要跑的三個檔案裡)。第一次量出來是 **46.15%**,遠低於標準 80% 門檻,
// 23 個存活 + 5 個零覆蓋。缺口不是零散的,是三整塊從來沒有測試碰過的接線:
//
//   1. `callGateway()` 的**逾時接線**(第 229–254 行):`opts.timeoutMs ??
//      defaultTimeoutMs` 的解析、要不要開計時器、signal 有沒有真的傳進
//      `client.chat()`、`finally` 的 `clearTimeout`。既有測試一條都沒給過
//      `timeoutMs`,所以整段是死的——`??` 被換成 `&&`、三元被換成 `true`/`false`、
//      `clearTimeout` 被拿掉,全都沒人發現。
//   2. **log 事件的組裝**(第 257–275 行):`type: 'llm_call'` 這個字串、
//      `tokens_in` / `tokens_out` 的 `!= null` 判斷、`fallback_from` / `error`
//      只在備援時才掛。既有測試只斷言 `fallback` 與 `fallback_reason` 兩個欄位。
//   3. `probeLocal()` 的 **catch 分支**與 `createFileLogAppender()`。
//
// 逾時那一塊尤其值得補:`callGateway()` 是**唯一**會真的送出閘道請求的地方,
// 而閘道在另一台機器上。「router 設的逾時有沒有真的接到閘道呼叫」跟 f7eef94 修的
// probe 逾時是同一類問題,只是這一半從來沒被量過。

describe('isCloudFailure — 5xx 的邊界(剛好 500)', () => {
  it('剛好 500 算雲端失敗', () => {
    // `status >= 500` 被換成 `> 500` 時,503 那條測試仍然綠——邊界只有這一個點。
    expect(isCloudFailure(Object.assign(new Error('internal'), { status: 500 }))).toBe(true);
  });

  it('499 不算', () => {
    expect(isCloudFailure(Object.assign(new Error('client closed'), { status: 499 }))).toBe(false);
  });
});

/** 記下每一次閘道 chat 請求有沒有帶 signal,並可以讓它掛住(測逾時)。 */
function timeoutHarness(opts: { chatHangs?: boolean; noTokens?: boolean } = {}) {
  const chatSignals: (AbortSignal | null | undefined)[] = [];
  const logged: LogEvent[] = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url.includes('/auth/token/exchange')) return json({ access_token: 'jwt-1', expires_in: 3600 });
    if (url.includes('/gateway/chat')) {
      chatSignals.push(init?.signal);
      if (opts.chatHangs) {
        // 只有 abort 能結束——沒接上 signal 的話會永遠掛著。
        await new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return json({
        content: '閘道回覆。',
        provider: 'ollama',
        model: LOCAL_MODEL,
        // 閘道不一定回 tokens_used(協定裡是 optional)。
        ...(opts.noTokens ? {} : { tokens_used: { prompt: 3, completion: 4 } }),
      });
    }
    throw new Error(`沒有預期到的請求:${url}`);
  }) as typeof fetch;

  const make = (extra: Record<string, unknown> = {}) =>
    new GatewayLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'gpt-5.6-luna', OPENAI_API_KEY: 'k', LLM_LOCAL_MODEL: LOCAL_MODEL },
      adapters: { openai: { async call() { throw new Error('這個測試不該打到雲端'); } } },
      onlineProber: async () => true,
      logAppender: (event) => logged.push(event),
      gateway: new GatewayClient({ config: { baseUrl: BASE, apiKey: 'gk', model: LOCAL_MODEL }, fetchImpl }),
      dailyCapUsd: CAP,
      prices: PRICES,
      spendReader: () => ({ usd: 0, calls: 0 }),
      ...extra,
    });

  return { chatSignals, logged, make };
}

describe('GatewayLlmRouter.callGateway — 逾時接線', () => {
  it('沒有任何逾時設定時,閘道請求不帶 signal(也不開計時器)', async () => {
    const h = timeoutHarness();
    await h.make().call('grade.fill.llm', '填空題');
    expect(h.chatSignals).toHaveLength(1);
    expect(h.chatSignals[0] == null).toBe(true);
  });

  it('opts.timeoutMs 會讓閘道請求帶上 signal', async () => {
    const h = timeoutHarness();
    await h.make().call('grade.fill.llm', '填空題', { timeoutMs: 30_000 });
    expect(h.chatSignals[0]).toBeInstanceOf(AbortSignal);
  });

  it('沒給 opts.timeoutMs 時吃 defaultTimeoutMs', async () => {
    // `opts.timeoutMs ?? this.opts.defaultTimeoutMs` 被換成 `&&` 時,這條會紅:
    // `undefined && 30000` 是 undefined,計時器就不會開。
    const h = timeoutHarness();
    await h.make({ defaultTimeoutMs: 30_000 }).call('grade.fill.llm', '填空題');
    expect(h.chatSignals[0]).toBeInstanceOf(AbortSignal);
  });

  it('opts.timeoutMs 蓋過 defaultTimeoutMs(用逾時長度分辨)', async () => {
    // defaultTimeoutMs 很長、opts.timeoutMs 很短:短的那個生效才會逾時。
    vi.useFakeTimers();
    try {
      const h = timeoutHarness({ chatHangs: true });
      let settled: unknown;
      void h
        .make({ defaultTimeoutMs: 10 * 60_000 })
        .call('grade.fill.llm', '填空題', { timeoutMs: 1_000 })
        .then(
          (r) => {
            settled = r;
          },
          (e: unknown) => {
            settled = e;
          },
        );
      await vi.advanceTimersByTimeAsync(5_000);
      // abort → fetch 丟 AbortError → GatewayCallError → 轉成契約 §7 的 NO_MODEL
      expect(settled).toBeInstanceOf(NoModelError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('逾時真的會中斷掛住的閘道呼叫,並轉成 NO_MODEL', async () => {
    vi.useFakeTimers();
    try {
      const h = timeoutHarness({ chatHangs: true });
      let settled: unknown;
      void h
        .make()
        .call('grade.fill.llm', '填空題', { timeoutMs: 2_000 })
        .then(
          (r) => {
            settled = r;
          },
          (e: unknown) => {
            settled = e;
          },
        );
      await vi.advanceTimersByTimeAsync(20_000);
      expect(settled).toBeInstanceOf(NoModelError);
      expect(codeOf(settled)).toBe('NO_MODEL');
    } finally {
      vi.useRealTimers();
    }
  });

  it('成功回來之後不留下計時器(finally 的 clearTimeout 有效)', async () => {
    vi.useFakeTimers();
    try {
      const h = timeoutHarness();
      await h.make().call('grade.fill.llm', '填空題', { timeoutMs: 30_000 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GatewayLlmRouter.callGateway — log 事件的組裝', () => {
  it('直接走閘道那一筆是 llm_call,帶 task / provider / model / latency_ms / token 數', async () => {
    const h = timeoutHarness();
    await h.make().call('grade.fill.llm', '填空題');
    const event = h.logged[0] as unknown as Record<string, unknown>;
    expect(event.type).toBe('llm_call');
    expect(event.task).toBe('grade.fill.llm');
    expect(event.provider).toBe('ollama');
    expect(event.model).toBe(LOCAL_MODEL);
    expect(typeof event.latency_ms).toBe('number');
    expect(event.tokens_in).toBe(3);
    expect(event.tokens_out).toBe(4);
    expect(typeof event.ts).toBe('string');
  });

  it('閘道沒回 tokens_used 時,事件裡連 key 都不放(不是塞 undefined)', async () => {
    // `result.tokens_in != null ? { tokens_in } : {}` 被換成永遠放的話,log 會多出
    // 兩個值是 undefined 的欄位——JSON.stringify 會把它們吃掉,但事件物件本身變了,
    // 而 spend.ts 是照這些欄位算錢的。
    const h = timeoutHarness({ noTokens: true });
    await h.make().call('grade.fill.llm', '填空題');
    const event = h.logged[0] as unknown as Record<string, unknown>;
    expect('tokens_in' in event).toBe(false);
    expect('tokens_out' in event).toBe(false);
  });

  it('直接走閘道(不是備援)時不掛 fallback 那組欄位', async () => {
    const h = timeoutHarness();
    await h.make().call('grade.fill.llm', '填空題');
    const event = h.logged[0] as unknown as Record<string, unknown>;
    expect('fallback' in event).toBe(false);
    expect('fallback_reason' in event).toBe(false);
    expect('fallback_from' in event).toBe(false);
    expect('error' in event).toBe(false);
  });

  it('備援那一筆記下 fallback_from 與原本的雲端錯誤訊息', async () => {
    // `if (cause !== undefined)` 這個判斷之前沒有任何測試碰過(被換成 `if (true)`
    // 也全綠)——上面那條管「沒有 cause 就不掛」,這條管「有 cause 就要掛」。
    const h = makeHarness({ cloudFails: Object.assign(new Error('upstream 503 boom'), { status: 503 }) });
    await h.router.call('grade.apply', '應用題');
    const event = fallbackEvent(h.logged);
    expect(event?.fallback_from).toBe('openai');
    expect(event?.error).toBe('upstream 503 boom');
  });

  it('預算用完的備援也有 fallback,但沒有 fallback_from(那一格沒有雲端錯誤)', async () => {
    const h = makeHarness({ spend: { usd: CAP, calls: 3 } });
    await h.router.call('deepen', '同源政策');
    const event = fallbackEvent(h.logged);
    expect(event?.fallback_reason).toBe('budget_exhausted');
    expect('fallback_from' in (event ?? {})).toBe(false);
    expect('error' in (event ?? {})).toBe(false);
  });
});

describe('GatewayLlmRouter — probeLocal 的 catch 與檔案 log', () => {
  it('沒設 GATEWAY_API_KEY 時 probeLocal 回不可用,不 throw', async () => {
    // createGatewayClient 會丟 MissingCredentialError;probeLocal 的 catch 要接住。
    const router = new GatewayLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'gpt-5.6-luna', OPENAI_API_KEY: 'k' },
      dailyCapUsd: CAP,
      prices: PRICES,
      spendReader: () => ({ usd: 0, calls: 0 }),
    });
    await expect(router.probeLocal()).resolves.toEqual({ available: false, models: [] });
  });

  it('給 logPath 而不給 logAppender 時,事件真的寫進檔案', async () => {
    // createFileLogAppender 那條路之前零覆蓋(`return (event) => recordEvent(...)`
    // 被換成 `() => undefined` 也全綠)。
    const dir = mkdtempSync(join(tmpdir(), 'router-gateway-log-'));
    try {
      const logPath = join(dir, 'log.jsonl');
      const h = timeoutHarness();
      await h.make({ logAppender: undefined, logPath }).call('grade.fill.llm', '填空題');

      const events = parseLogLines(readFileSync(logPath, 'utf8')) as unknown as Record<string, unknown>[];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('llm_call');
      expect(events[0]?.task).toBe('grade.fill.llm');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * ADR-044 的 `llm.gateway-router.spend-no-log-zero`:沒給 logPath 也沒注入 spendReader
 * 時,今日花費**一律當 0**,預算分支永遠走不到。基準報告(959b039 / 45c83a7)裡這條
 * 退化分支**沒有任何測試走過**——它壞了沒人會發現。這一組讓它真的被走到,而且斷言
 * 它的行為:雲端已經花了遠超上限的錢,router 仍然當作一毛沒花。
 *
 * 對照組給真的 logPath(router 自己寫、自己讀那個檔),證明「差別只在有沒有 log」:
 * 有 log 的第二次就被預算擋下,沒 log 的怎麼打都不會。
 *
 * 每次雲端呼叫回 tokens_in = 1,000,000,依 PRICES(2.5 美元 / 百萬)一次就是 2.5 美元,
 * 遠超 CAP(1 美元)。
 */
describe('GatewayLlmRouter — 沒給 logPath 也沒注入 spendReader:花費一律當 0(ADR-044 spend-no-log-zero)', () => {
  const TOKENS_IN_PER_CALL = 1_000_000; // 2.5 美元 / 次,CAP 是 1 美元

  interface SpendHarness {
    cloudCalls: number;
    gatewayChats: number;
    router: GatewayLlmRouter;
  }

  function spendHarness(opts: { logPath?: string } = {}): SpendHarness {
    const h = { cloudCalls: 0, gatewayChats: 0 } as SpendHarness;

    const cloudAdapter: CloudAdapter = {
      async call({ prompt, model }) {
        h.cloudCalls += 1;
        return { text: `雲端回覆:${prompt}`, provider: 'openai', model, latency_ms: 5, tokens_in: TOKENS_IN_PER_CALL, tokens_out: 0 };
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
        return json({ content: '閘道回覆。', provider: 'ollama', model: body.model ?? LOCAL_MODEL, tokens_used: { prompt: 3, completion: 4 } });
      }
      throw new Error(`沒有預期到的請求:${url}`);
    }) as typeof fetch;

    // 刻意**不給** spendReader;logPath 有沒有由 opts 決定。沒 logPath 時也不給
    // logAppender——那正是「純單元測試沒接 log」的建構方式,退化分支就是為它而存在。
    h.router = new GatewayLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'gpt-5.6-luna', OPENAI_API_KEY: 'k', LLM_LOCAL_MODEL: LOCAL_MODEL },
      adapters: { openai: cloudAdapter },
      onlineProber: async () => true,
      gateway: new GatewayClient({ config: { baseUrl: BASE, apiKey: 'gk', model: LOCAL_MODEL }, fetchImpl }),
      dailyCapUsd: CAP,
      prices: PRICES,
      ...(opts.logPath === undefined ? {} : { logPath: opts.logPath }),
    });
    return h;
  }

  function withTmpLog<T>(fn: (logPath: string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), 'router-gateway-spend-'));
    return fn(join(dir, 'log.jsonl')).finally(() => rmSync(dir, { recursive: true, force: true }));
  }

  it('cloud-only 任務:沒 log 時打了三次、花了 7.5 美元,仍然一次也沒被 1 美元的預算擋下', async () => {
    const h = spendHarness();
    for (let i = 0; i < 3; i++) {
      const result = await h.router.call('ingest.cards', `第 ${i + 1} 次`);
      expect(result.provider).toBe('openai');
      expect(result.provisional).toBe(false);
    }
    expect(h.cloudCalls).toBe(3);
    expect(h.gatewayChats).toBe(0);
  });

  it('對照:同樣的三次呼叫,只要有 logPath,第二次就在花錢之前被 DailyBudgetExceededError 擋下', async () => {
    await withTmpLog(async (logPath) => {
      const h = spendHarness({ logPath });
      await h.router.call('ingest.cards', '第 1 次');
      const second = await caught(() => h.router.call('ingest.cards', '第 2 次'));
      expect(second).not.toBe(NOTHING_THROWN);
      expect(second).toBeInstanceOf(DailyBudgetExceededError);
      expect(h.cloudCalls).toBe(1);
    });
  });

  it('gateway-fallback 任務:沒 log 時三次都走雲端、都不是暫定,閘道一次都沒被打到', async () => {
    const h = spendHarness();
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await h.router.call('deepen', `同源政策 ${i + 1}`));
    expect(results.map((r) => r.provider)).toEqual(['openai', 'openai', 'openai']);
    expect(results.map((r) => r.provisional)).toEqual([false, false, false]);
    expect(h.cloudCalls).toBe(3);
    expect(h.gatewayChats).toBe(0);
  });

  it('對照:gateway-fallback 任務有 logPath 時,第二次改走閘道且回 provisional=true', async () => {
    await withTmpLog(async (logPath) => {
      const h = spendHarness({ logPath });
      const first = await h.router.call('deepen', '同源政策 1');
      const second = await h.router.call('deepen', '同源政策 2');
      expect(first.provider).toBe('openai');
      expect(second.provider).toBe('ollama');
      expect(second.provisional).toBe(true);
      expect(h.cloudCalls).toBe(1);
      expect(h.gatewayChats).toBe(1);

      const events = parseLogLines(readFileSync(logPath, 'utf8')) as unknown as Record<string, unknown>[];
      const fallback = events.find((e) => e.fallback === 'gateway');
      expect(fallback?.fallback_reason).toBe('budget_exhausted');
    });
  });

  it('沒 log 時 spend 被當 0 是「每次呼叫都重新當 0」,不是只有第一次:第 10 次仍打雲端', async () => {
    const h = spendHarness();
    for (let i = 0; i < 10; i++) await h.router.call('ingest.questions', `第 ${i + 1} 次`);
    expect(h.cloudCalls).toBe(10);
  });
});
