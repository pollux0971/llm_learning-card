/**
 * T9 的紅測試:帳本每一行都要通過同一份 LogEventSchema,llm_call 再加三條花費相關的規則。
 * 測試 agent 寫;開發 agent 只寫實作,不改這個檔。
 *
 * 為什麼:T8 之後「壞行 = 不知道」,但壞行的定義只有「JSON 壞掉」與「ts 在卻不是字串」。
 * JSON 合法、卻會讓花費算少的行還是能混進去:負的 tokens 把別的花費抵掉(5 美元變 0)、
 * 字串或缺少的 tokens 變成 0、缺 ts 的行被默默略過。我們自己寫的行一定合規;
 * 不合規只可能是損壞、手動改過、或程式有 bug——三種都不能當成「花得比較少」。
 *
 * 規則(單一定義在 spend.ts 的 `parseLedger`,`scripts/llm-spend.ts` 與 router 都經過它):
 *   L. 每一行:JSON 物件,而且通過 `@contracts/index.js` 的 `LogEventSchema`(同一份定義,不另寫一份)。
 *      不通過的 `bad.what` 要含 `LogEventSchema`,並帶出 schema 的第一個錯誤訊息。
 *   C. `type === 'llm_call'` 再加:
 *      C1. `ts` 是 ISO 8601 含時區(`Z` 或 `±hh:mm`)的真實時間點(`2026-02-30` 不算)。
 *      C2. `tokens_in`、`tokens_out` 只要出現,就必須是非負的安全整數。
 *      C3. 計價行(provider 不是 `ollama`、而且不是 timeout / truncated / retry 標記行)
 *          必須有字串 provider(非空)、有 `tokens_in` 與 `tokens_out`。
 *      標記行 = 我們自己寫的、本來就沒有完整 tokens 的行:`timeout: true`(逾時)、`truncated: true`(只有 tokens_out)、
 *      `retry: true`(ingest.questions 的重試,沒有 provider)。標記必須剛好是布林 true。
 *      `ollama` 是明確免費的本機閘道:tokens 可有可無,有的話仍受 C2。
 *      C1、C2 對標記行與 ollama 一樣適用。
 *   每個違規的 `bad.what` 要點名違規的欄位(`ts` / `tokens_in` / `tokens_out` / `provider`)。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LogEventSchema } from '@contracts/index.js';
import { GatewayClient } from './adapters/gateway.js';
import { ExplicitLedger } from './ledger.js';
import { GatewayLlmRouter } from './router-gateway.js';
import { parseLedger, readDailySpend, UnknownSpendError } from './spend.js';
import type { CloudAdapter } from './types.js';

const PRICES = { inPerM: 2.5, outPerM: 10 };
const DAY = '2026-10-15';
const TS = `${DAY}T10:00:00Z`;
const LOCAL_MODEL = 'qwen2.5:32b';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 't9-'));
  dirs.push(d);
  return d;
}

function writeLog(lines: string[]): string {
  const path = join(tmp(), 'log.jsonl');
  writeFileSync(path, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  return path;
}

function llm(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ ts: TS, type: 'llm_call', provider: 'openai', model: 'gpt-x', tokens_in: 1_000_000, tokens_out: 0, ...over });
}

/** 刪掉某幾個欄位(JSON.stringify 會丟掉 undefined)。 */
function llmWithout(...keys: string[]): string {
  const base: Record<string, unknown> = { ts: TS, type: 'llm_call', provider: 'openai', model: 'gpt-x', tokens_in: 1_000_000, tokens_out: 0 };
  for (const k of keys) delete base[k];
  return JSON.stringify(base);
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

// ---------------------------------------------------------------- 合規的行(不能被誤傷)

const GOOD: [string, string][] = [
  ['最小的計價行', llm()],
  ['tokens 是 0', llm({ tokens_in: 0, tokens_out: 0 })],
  ['tokens 是最大安全整數', llm({ tokens_in: Number.MAX_SAFE_INTEGER, tokens_out: Number.MAX_SAFE_INTEGER })],
  ['ts 帶 +08:00', llm({ ts: '2026-10-15T10:00:00+08:00' })],
  ['ts 帶 -05:30', llm({ ts: '2026-10-15T10:00:00-05:30' })],
  ['ts 帶毫秒與 Z', llm({ ts: '2026-10-15T10:00:00.123Z' })],
  ['閏日 2028-02-29 是真實的日期', llm({ ts: '2028-02-29T00:00:00Z' })],
  ['多餘欄位照樣放行(catchall)', llm({ task: 'ingest.cards', latency_ms: 12, extra: { nested: [1, 2, 3] } })],
  ['ollama 沒有 tokens', JSON.stringify({ ts: TS, type: 'llm_call', provider: 'ollama', model: LOCAL_MODEL })],
  ['ollama 有 tokens', JSON.stringify({ ts: TS, type: 'llm_call', provider: 'ollama', model: LOCAL_MODEL, tokens_in: 5, tokens_out: 7 })],
  ['逾時標記行(沒有 tokens)', JSON.stringify({ ts: TS, type: 'llm_call', task: 'ingest.cards', provider: 'openai', model: 'gpt-x', timeout: true, timeout_ms: 30000 })],
  ['截斷標記行(只有 tokens_out)', JSON.stringify({ ts: TS, type: 'llm_call', task: 'ingest.cards', provider: 'openai', model: 'gpt-x', truncated: true, max_tokens: 800, tokens_out: 800 })],
  ['重試標記行(沒有 provider、沒有 tokens,帶 card)', JSON.stringify({ ts: TS, type: 'llm_call', task: 'ingest.questions', card: 'sec-0001', retry: true, retry_reason: 'x' })],
  ['非 llm_call 事件:learned', JSON.stringify({ ts: TS, type: 'learned', card: 'sec-0042' })],
  ['非 llm_call 事件:warning 帶任意欄位(tokens_in 是字串也不管它)', JSON.stringify({ ts: TS, type: 'warning', path: 'raw/x', reason: 'path-refused', tokens_in: 'not-checked' })],
  ['非 llm_call 事件:ts 不是 ISO 但非空(只受 LogEventSchema 管)', JSON.stringify({ ts: 'not-iso-but-nonempty', type: 'linted' })],
];

describe('T9 合規的行:全部放行', () => {
  it.each(GOOD)('%s', (_name, line) => {
    const r = parseLedger(`${line}\n`);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.events).toHaveLength(1);
  });

  it('放行的行一律也通過 LogEventSchema(兩邊不會對同一行下不同結論)', () => {
    for (const [name, line] of GOOD) expect(LogEventSchema.safeParse(JSON.parse(line)).success, name).toBe(true);
  });

  it('空白行仍不是壞行(T8 的規則不變)', () => {
    expect(parseLedger(`\n   \n${llm()}\n\t\n`).ok).toBe(true);
  });
});

// ---------------------------------------------------------------- 壞行:每一條都要紅

interface BadCase {
  name: string;
  line: string;
  /** `bad.what` 要含的字串(全部) */
  mentions: string[];
}

const BAD: BadCase[] = [
  // L:LogEventSchema
  { name: '缺 ts', line: JSON.stringify({ type: 'learned', card: 'sec-0001' }), mentions: ['LogEventSchema'] },
  { name: '缺 ts 的 llm_call', line: llmWithout('ts'), mentions: ['LogEventSchema'] },
  { name: 'ts 是空字串', line: llm({ ts: '' }), mentions: ['LogEventSchema', 'ts 不可為空'] },
  { name: 'ts 是 null', line: llm({ ts: null }), mentions: ['LogEventSchema'] },
  { name: 'ts 是數字', line: llm({ ts: 20261015 }), mentions: ['LogEventSchema'] },
  { name: '缺 type', line: JSON.stringify({ ts: TS, provider: 'openai', tokens_in: 1, tokens_out: 1 }), mentions: ['LogEventSchema'] },
  { name: 'type 不在 EVENT_TYPES 裡(review_done)', line: JSON.stringify({ ts: TS, type: 'review_done', card: 'sec-0001' }), mentions: ['LogEventSchema'] },
  { name: 'type 不是字串', line: JSON.stringify({ ts: TS, type: 7 }), mentions: ['LogEventSchema'] },
  { name: 'card 不是 CardId', line: JSON.stringify({ ts: TS, type: 'learned', card: 'Not A Card' }), mentions: ['LogEventSchema'] },
  // C1:ts
  { name: 'llm_call 的 ts 只有日期', line: llm({ ts: '2026-10-15' }), mentions: ['ts'] },
  { name: 'llm_call 的 ts 沒有時區', line: llm({ ts: '2026-10-15T10:00:00' }), mentions: ['ts'] },
  { name: 'llm_call 的 ts 用空白分隔', line: llm({ ts: '2026-10-15 10:00:00Z' }), mentions: ['ts'] },
  { name: 'llm_call 的 ts 是一句話', line: llm({ ts: 'yesterday' }), mentions: ['ts'] },
  { name: 'llm_call 的 ts 月份 13', line: llm({ ts: '2026-13-01T00:00:00Z' }), mentions: ['ts'] },
  { name: 'llm_call 的 ts 是 2 月 30 日(會被 Date 滾到 3 月)', line: llm({ ts: '2026-02-30T00:00:00Z' }), mentions: ['ts'] },
  { name: 'llm_call 的 ts 是非閏年的 2 月 29 日', line: llm({ ts: '2026-02-29T00:00:00Z' }), mentions: ['ts'] },
  { name: 'llm_call 的 ts 小時 25', line: llm({ ts: '2026-10-15T25:00:00Z' }), mentions: ['ts'] },
  { name: 'llm_call 的 ts 時區寫成 +0800(沒有冒號)', line: llm({ ts: '2026-10-15T10:00:00+0800' }), mentions: ['ts'] },
  // C2:tokens 有出現就要是非負整數
  { name: 'tokens_in 是負數(把別的花費抵掉)', line: llm({ tokens_in: -1_000_000 }), mentions: ['tokens_in'] },
  { name: 'tokens_out 是負數', line: llm({ tokens_out: -1 }), mentions: ['tokens_out'] },
  { name: 'tokens_in 是字串', line: llm({ tokens_in: '1000000' }), mentions: ['tokens_in'] },
  { name: 'tokens_out 是字串', line: llm({ tokens_out: '5' }), mentions: ['tokens_out'] },
  { name: 'tokens_in 是 null', line: llm({ tokens_in: null }), mentions: ['tokens_in'] },
  { name: 'tokens_in 是小數', line: llm({ tokens_in: 1.5 }), mentions: ['tokens_in'] },
  { name: 'tokens_out 是布林', line: llm({ tokens_out: true }), mentions: ['tokens_out'] },
  { name: 'tokens_in 是陣列', line: llm({ tokens_in: [1] }), mentions: ['tokens_in'] },
  { name: 'tokens_in 是 Infinity(JSON 的 1e999)', line: llm().replace('"tokens_in":1000000', '"tokens_in":1e999'), mentions: ['tokens_in'] },
  { name: 'tokens_in 超過安全整數', line: llm({ tokens_in: Number.MAX_SAFE_INTEGER + 2 }), mentions: ['tokens_in'] },
  { name: 'ollama 的 tokens_in 是負數(免費也不能亂寫)', line: JSON.stringify({ ts: TS, type: 'llm_call', provider: 'ollama', tokens_in: -5 }), mentions: ['tokens_in'] },
  { name: '逾時標記行的 tokens_out 是字串', line: JSON.stringify({ ts: TS, type: 'llm_call', provider: 'openai', timeout: true, tokens_out: 'x' }), mentions: ['tokens_out'] },
  { name: '截斷標記行的 tokens_out 是負數', line: JSON.stringify({ ts: TS, type: 'llm_call', provider: 'openai', truncated: true, tokens_out: -800 }), mentions: ['tokens_out'] },
  { name: '標記行的 ts 不合法', line: JSON.stringify({ ts: 'soon', type: 'llm_call', provider: 'openai', timeout: true }), mentions: ['ts'] },
  // C3:計價行要有 provider 與 tokens
  { name: '計價行缺 tokens_in', line: llmWithout('tokens_in'), mentions: ['tokens_in'] },
  { name: '計價行缺 tokens_out', line: llmWithout('tokens_out'), mentions: ['tokens_out'] },
  { name: '計價行兩個 tokens 都缺', line: llmWithout('tokens_in', 'tokens_out'), mentions: ['tokens_in'] },
  { name: '計價行缺 provider', line: llmWithout('provider'), mentions: ['provider'] },
  { name: '計價行 provider 是空字串', line: llm({ provider: '' }), mentions: ['provider'] },
  { name: '計價行 provider 是數字', line: llm({ provider: 5 }), mentions: ['provider'] },
  { name: '計價行 provider 是 null', line: llm({ provider: null }), mentions: ['provider'] },
  { name: 'provider 大小寫不同的 Ollama 不算免費(只認小寫 ollama),缺 tokens 就是壞行', line: JSON.stringify({ ts: TS, type: 'llm_call', provider: 'Ollama', model: 'm' }), mentions: ['tokens_in'] },
  { name: 'timeout 是 false 不是標記行,缺 tokens 就是壞行', line: JSON.stringify({ ts: TS, type: 'llm_call', provider: 'openai', timeout: false }), mentions: ['tokens_in'] },
  { name: 'timeout 是字串 "true" 不是標記行', line: JSON.stringify({ ts: TS, type: 'llm_call', provider: 'openai', timeout: 'true' }), mentions: ['tokens_in'] },
  { name: 'retry 是 1 不是標記行', line: JSON.stringify({ ts: TS, type: 'llm_call', task: 'ingest.questions', retry: 1 }), mentions: ['provider'] },
];

describe('T9 壞行:每一條都是壞行,點名違規的欄位,帶行號', () => {
  it.each(BAD.map((b) => [b.name, b] as const))('%s', (_name, b) => {
    const r = parseLedger(`${llm()}\n${b.line}\n`);
    expect(r.ok, `應該是壞行: ${b.line}`).toBe(false);
    if (r.ok) return;
    expect(r.bad.lineNumber).toBe(2);
    expect(r.bad.line).toBe(b.line);
    for (const m of b.mentions) expect(r.bad.what, b.name).toContain(m);
  });

  it('不分哪一天:壞行的 ts 看起來是別天的,一樣是壞行', () => {
    const r = parseLedger(`${llm({ ts: '2025-01-01T00:00:00Z', tokens_in: -1 })}\n`);
    expect(r.ok).toBe(false);
  });

  it('先修第一個:有多個壞行時回報的是行號最小的那個', () => {
    const r = parseLedger([llm(), llm({ tokens_in: -1 }), 'not json', llm({ ts: '' })].join('\n'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.bad.lineNumber).toBe(2);
  });

  it('壞行表蓋到每一種規則(表本身不能被縮水)', () => {
    expect(BAD.length).toBeGreaterThanOrEqual(40);
    for (const word of ['LogEventSchema', 'ts', 'tokens_in', 'tokens_out', 'provider']) {
      expect(BAD.some((b) => b.mentions.includes(word)), word).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- 單一定義:跟 LogEventSchema 同一份

describe('T9 單一定義', () => {
  it('spend.ts 用的是 contracts 的 LogEventSchema,沒有自己再寫一份事件類型清單', () => {
    const src = readFileSync(join(import.meta.dirname, 'spend.ts'), 'utf8');
    expect(src).toMatch(/LogEventSchema/);
    expect(src).not.toMatch(/EVENT_TYPES/);
    expect(src).not.toMatch(/'reteach_queued'|'cycle_removed'|'provisional_resolved'/);
  });

  it('LogEventSchema 拒絕的行,parseLedger 一定也拒絕(隨機湊 200 個形狀)', () => {
    const tsVariants: unknown[] = [TS, '', null, 5, undefined, 'x'];
    const typeVariants: unknown[] = ['learned', 'llm_call', 'warning', 'nope', 3, undefined];
    const cardVariants: unknown[] = [undefined, 'sec-0001', 'BAD', 7];
    let n = 0;
    for (const ts of tsVariants)
      for (const type of typeVariants)
        for (const card of cardVariants) {
          const obj = { ts, type, card, provider: 'ollama' };
          const line = JSON.stringify(obj);
          const schemaOk = LogEventSchema.safeParse(JSON.parse(line)).success;
          const r = parseLedger(`${line}\n`);
          if (!schemaOk) expect(r.ok, line).toBe(false);
          n += 1;
        }
    expect(n).toBeGreaterThanOrEqual(100);
  });
});

// ---------------------------------------------------------------- 花費:must_catch

describe('T9 readDailySpend:不合規的行讓花費變成「不知道」', () => {
  function unknownAt(lines: string[], lineNumber: number): void {
    const path = writeLog(lines);
    const err = thrown(() => readDailySpend(ExplicitLedger.unverified(path, 'T9 test'), DAY, PRICES));
    expect(err, JSON.stringify(lines)).toBeInstanceOf(UnknownSpendError);
    expect((err as Error).message).toMatch(new RegExp(`第\\s*${lineNumber}\\s*行`));
    expect((err as InstanceType<typeof UnknownSpendError>).lineNumber).toBe(lineNumber);
  }

  it('must_catch: 負的 tokens 抵掉花費 —— 5 美元的帳本多一行 −1M tokens,不能變成 $0 或 $2.5,而是不知道', () => {
    unknownAt([llm(), llm(), llm({ tokens_in: -2_000_000 })], 3);
  });

  it('對照:同樣的帳本拿掉負數那行 → $5', () => {
    const path = writeLog([llm(), llm()]);
    expect(readDailySpend(ExplicitLedger.unverified(path, 'T9 test'), DAY, PRICES)).toEqual({ usd: 5, calls: 2 });
  });

  it('must_catch: tokens 是字串被當成 0 —— 不能少算那一次', () => {
    unknownAt([llm(), llm({ tokens_in: '1000000' })], 2);
  });

  it('must_catch: tokens 缺少(計價行)被當成 0', () => {
    unknownAt([llm(), llmWithout('tokens_in', 'tokens_out')], 2);
  });

  it('must_catch: 缺 ts 的行被跳過 —— 它可能是今天的', () => {
    unknownAt([llm(), llmWithout('ts')], 2);
    unknownAt([JSON.stringify({ type: 'learned' }), llm()], 1);
  });

  it('must_catch: schema 驗證被拿掉 —— 不在 EVENT_TYPES 的 type、空 ts、壞的 card', () => {
    unknownAt([llm(), JSON.stringify({ ts: TS, type: 'definitely-not-an-event' })], 2);
    unknownAt([llm(), JSON.stringify({ ts: '', type: 'learned' })], 2);
    unknownAt([JSON.stringify({ ts: TS, type: 'learned', card: 'nope' }), llm()], 1);
  });

  it('壞行在別天也一樣(不用 ts 先濾今日)', () => {
    unknownAt([llm({ ts: '2020-01-01T00:00:00Z' }), llm({ ts: '2020-01-02T00:00:00Z', tokens_out: -3 })], 2);
  });

  it('標記行與 ollama 不誤傷:帶逾時、截斷、重試、本機呼叫的帳本照常算(5 美元 + 0)', () => {
    const path = writeLog([
      llm(),
      llm(),
      JSON.stringify({ ts: TS, type: 'llm_call', provider: 'ollama', model: LOCAL_MODEL }),
      JSON.stringify({ ts: TS, type: 'llm_call', provider: 'openai', timeout: true }),
      JSON.stringify({ ts: TS, type: 'llm_call', task: 'ingest.questions', card: 'sec-0001', retry: true }),
    ]);
    const spend = readDailySpend(ExplicitLedger.unverified(path, 'T9 test'), DAY, PRICES);
    expect(spend.usd).toBeCloseTo(5, 10);
  });
});

// ---------------------------------------------------------------- router:在打 adapter 之前拒絕

describe('T9 router:帳本有不合規的行,打任何 adapter 之前就拒絕', () => {
  function harness(logPath: string): { router: GatewayLlmRouter; cloud: () => number; chats: () => number } {
    let cloud = 0;
    let chats = 0;
    const adapter: CloudAdapter = {
      async call({ prompt, model }) {
        cloud += 1;
        return { text: `雲端:${prompt}`, provider: 'openai', model, latency_ms: 1, tokens_in: 10, tokens_out: 0 };
      },
    };
    const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const json = (b: unknown): Response => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/auth/token/exchange')) return json({ access_token: 'jwt', expires_in: 3600 });
      if (url.includes('/gateway/models')) return json({ auto_match: true, models: { [LOCAL_MODEL]: ['chat'] } });
      if (url.includes('/gateway/chat')) {
        chats += 1;
        return json({ content: '閘道', provider: 'ollama', model: LOCAL_MODEL, tokens_used: { prompt: 1, completion: 1 } });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const router = new GatewayLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'gpt-5.6-luna', OPENAI_API_KEY: 'k', LLM_LOCAL_MODEL: LOCAL_MODEL },
      adapters: { openai: adapter, anthropic: adapter },
      onlineProber: async () => true,
      localProber: async () => ({ available: false, models: [] }),
      gateway: new GatewayClient({ config: { baseUrl: 'http://gateway.test:8787', apiKey: 'gk', model: LOCAL_MODEL }, fetchImpl }),
      dailyCapUsd: 100,
      prices: PRICES,
      today: () => DAY,
      ledger: ExplicitLedger.unverified(logPath, 'T9 router test'),
    });
    return { router, cloud: () => cloud, chats: () => chats };
  }

  it.each([
    ['負的 tokens', llm({ tokens_in: -5_000_000 })],
    ['字串 tokens', llm({ tokens_out: '9' })],
    ['缺 ts', llmWithout('ts')],
  ])('%s:雲端 0 次、閘道 0 次,丟 UnknownSpendError', async (_name, bad) => {
    const h = harness(writeLog([llm(), bad]));
    const err = await h.router.call('ingest.cards', '第 1 次').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnknownSpendError);
    expect(h.cloud()).toBe(0);
    expect(h.chats()).toBe(0);
  });

  it('我們自己寫的行一定合規:router 真的呼叫成功後寫進帳本的 llm_call 行,馬上能被 parseLedger 接受,而且下一次呼叫照常', async () => {
    const logPath = join(tmp(), 'state', 'log.jsonl');
    const h = harness(logPath);
    const first = await h.router.call('ingest.cards', '第一次');
    expect(first.text).toContain('第一次');
    const written = readFileSync(logPath, 'utf8');
    expect(written).toContain('"type":"llm_call"');
    const parsed = parseLedger(written);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    const second = await h.router.call('ingest.cards', '第二次');
    expect(second.text).toContain('第二次');
    expect(h.cloud()).toBe(2);
  });
});

// ---------------------------------------------------------------- 寫入端的形狀:跟 router.ts 等處實際寫出的 llm_call 一致

describe('T9 寫入端:我們自己寫的每一種 llm_call 行都合規', () => {
  // 這幾個形狀逐字抄自實際的寫入點:router.ts(成功、逾時、截斷)、router-gateway.ts(成功,含 fallback 欄位)、
  // ingest/questions.ts(重試)。寫入端改了形狀(例如把 tokens 寫成字串),這張表要跟著改——它是「我們自己寫的行
  // 一定合規」這句話的證據。
  const WRITERS: [string, Record<string, unknown>][] = [
    ['router.ts 成功', { ts: new Date().toISOString(), type: 'llm_call', task: 'ingest.cards', provider: 'openai', model: 'gpt-5.6-luna', latency_ms: 120, tokens_in: 800, tokens_out: 300 }],
    ['router-gateway.ts 成功(閘道回 ollama)', { ts: new Date().toISOString(), type: 'llm_call', task: 'ingest.cards', provider: 'ollama', model: LOCAL_MODEL, latency_ms: 900, tokens_in: 1, tokens_out: 1 }],
    ['router-gateway.ts 備援', { ts: new Date().toISOString(), type: 'llm_call', task: 'ingest.cards', provider: 'ollama', model: LOCAL_MODEL, latency_ms: 900, fallback: 'gateway', fallback_reason: 'offline', fallback_from: 'openai', error: 'x' }],
    ['router.ts 逾時', { ts: new Date().toISOString(), type: 'llm_call', task: 'ingest.cards', provider: 'openai', model: 'gpt-5.6-luna', timeout: true, timeout_ms: 30000 }],
    ['router.ts 截斷', { ts: new Date().toISOString(), type: 'llm_call', task: 'ingest.cards', provider: 'openai', model: 'gpt-5.6-luna', truncated: true, max_tokens: 800, tokens_out: 800 }],
    ['questions.ts 重試', { ts: new Date().toISOString(), type: 'llm_call', task: 'ingest.questions', card: 'sec-0001', retry: true, retry_reason: 'too long' }],
  ];

  it.each(WRITERS)('%s', (_name, event) => {
    const r = parseLedger(`${JSON.stringify(event)}\n`);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});
