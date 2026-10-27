/**
 * 03-llm-router/phase-3(provisional 佇列,T59)的步驟定義。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T59-llm-router-provisional-queue.md。.feature:features/03-llm-router/phase-3.feature(8 個場景,沒有 @manual)。
 *
 * 8 個場景都用真的 GatewayLlmRouter,外面套 recordProvisional;不打真網路、不需要真的閘道:
 *   - 閘道與雲端都由假的 globalThis.fetch 接走(只在 @llm-router and @phase-3 的場景裝上、還原;
 *     只寫 @phase-3 會碰到 06/07/10 的場景——phase-4 的步驟檔寫過同一個陷阱);
 *   - 「網路在不在」:onlineProber 注入(離線 → 走閘道、標 provisional);drain 的 isOnline 也用同一個旗標;
 *   - 學習資料夾用暫存目錄,After 清掉。
 * 被測模組用動態 import 算出來的 file URL(紅測試在 base 上要 tsc 乾淨,而新檔在 base 上還不存在)。
 *
 * 三句跟別的功能撞名的步驟(the network is available / unavailable、a warning is logged)的接縫見 _llm-phase3-shared.ts。
 */
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ExplicitLedger, GatewayLlmRouter, anthropicAdapter, openaiAdapter, type LlmResult, type LlmRouter, type LlmTask } from '../../packages/core/src/llm/index.js';
import { phase3Hooks } from './_llm-phase3-shared.js';

const QUEUE_MODULE = join(import.meta.dirname, '../../packages/core/src/llm/provisional-queue.ts');
const GATEWAY_BASE_URL = 'http://gateway.test:8787';
const LOCAL_TEXT = '閘道上的本機模型回覆。';
const CLOUD_TEXT = '雲端回覆。';
const CARD = 'sec-0001';
const T1 = '2026-10-27T01:00:00.000Z';
const T2 = '2026-10-27T02:00:00.000Z';
const CORRUPT = '{not json';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

interface QueueLike {
  enqueue(a: { task: LlmTask; card: string; prompt: string; localText: string; maxTokens?: number }): unknown;
  list(): unknown;
  drain(isOnline: () => Promise<boolean>): unknown;
  resolve(key: { card: string; task: LlmTask }, r: { cloudText: string; changed: boolean }): unknown;
}
interface QueueModule {
  ProvisionalQueue: new (o: { path: string; log: (e: Record<string, unknown>) => void; now?: () => string }) => QueueLike;
  recordProvisional: (inner: LlmRouter, queue: QueueLike, card: string) => LlmRouter;
}
interface Entry {
  task: string;
  card: string;
  queued_at: string;
  local_sha256: string;
  prompt: string;
}

interface P3 {
  dir: string;
  logPath: string;
  queuePath: string;
  online: boolean;
  clock: string;
  events: Record<string, unknown>[];
  mod?: QueueModule;
  queue?: QueueLike;
  result?: LlmResult;
  /** When 之前的佇列檔內容(null = 沒有檔),給「the queue is unchanged」比 */
  snapshot: string | null;
  drained?: Entry[];
  resolved?: unknown;
  queuedBefore: Entry[];
  reopened?: Entry[];
  realFetch?: typeof globalThis.fetch;
  cloudCalls: number;
  gatewayChats: number;
}
let p3: P3;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function installFakeFetch(): void {
  p3.realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(GATEWAY_BASE_URL)) {
      if (url.includes('/auth/token/exchange')) return jsonResponse({ access_token: 'jwt-1', expires_in: 3600 });
      if (url.includes('/gateway/models')) return jsonResponse({ auto_match: true, models: { 'qwen2.5:32b': ['chat'] } });
      if (url.includes('/gateway/chat')) {
        p3.gatewayChats += 1;
        const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
        return jsonResponse({ content: LOCAL_TEXT, provider: 'ollama', model: body.model ?? 'qwen2.5:32b', tokens_used: { prompt: 11, completion: 13 } });
      }
    }
    if (url.includes('/v1/models')) return jsonResponse({ data: [] });
    if (url.includes('/v1/chat/completions')) {
      p3.cloudCalls += 1;
      return jsonResponse({
        id: 'chatcmpl-fake',
        model: 'gpt-5.6-luna',
        choices: [{ index: 0, message: { role: 'assistant', content: CLOUD_TEXT }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 7, completion_tokens: 9 },
      });
    }
    throw new Error(`phase-3 假 fetch 沒有預期到的請求:${url}`);
  }) as typeof globalThis.fetch;
}

Before({ tags: '@llm-router and @phase-3' }, function () {
  const dir = mkdtempSync(join(tmpdir(), 'llm-phase3-'));
  mkdirSync(join(dir, 'state'), { recursive: true });
  const logPath = join(dir, 'state', 'log.jsonl');
  writeFileSync(logPath, '');
  p3 = {
    dir,
    logPath,
    queuePath: join(dir, 'state', 'provisional-queue.json'),
    online: true,
    clock: T1,
    events: [],
    snapshot: null,
    queuedBefore: [],
    cloudCalls: 0,
    gatewayChats: 0,
  };
  installFakeFetch();
  phase3Hooks.network = (online) => {
    p3.online = online;
  };
  phase3Hooks.warningLogged = () => {
    const warnings = p3.events.filter((e) => e['type'] === 'warning' && e['reason'] === 'provisional_queue_corrupt');
    assert.equal(warnings.length, 1, `應該剛好一筆 provisional_queue_corrupt 的 warning:${JSON.stringify(p3.events)}`);
    const backup = String(warnings[0]!['backup']);
    assert.ok(backup.startsWith('provisional-queue.json.corrupt-'), `warning 要帶備份檔名:${backup}`);
    assert.ok(!backup.includes('/') && !backup.includes('\\'), `備份檔名不含路徑:${backup}`);
  };
});

After({ tags: '@llm-router and @phase-3' }, function () {
  if (p3?.realFetch) globalThis.fetch = p3.realFetch;
  delete phase3Hooks.network;
  delete phase3Hooks.warningLogged;
  if (p3?.dir) rmSync(p3.dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 工具

async function mod(): Promise<QueueModule> {
  assert.ok(existsSync(QUEUE_MODULE), 'packages/core/src/llm/provisional-queue.ts 要存在(T59)');
  p3.mod ??= (await import(/* @vite-ignore */ pathToFileURL(QUEUE_MODULE).href)) as QueueModule;
  return p3.mod;
}

async function queue(): Promise<QueueLike> {
  if (!p3.queue) {
    const m = await mod();
    p3.queue = new m.ProvisionalQueue({ path: p3.queuePath, log: (e) => p3.events.push(e), now: () => p3.clock });
  }
  return p3.queue;
}

function buildRouter(): GatewayLlmRouter {
  return new GatewayLlmRouter({
    env: {
      LLM_CLOUD_PROVIDER: 'openai',
      LLM_CLOUD_MODEL: 'gpt-5.6-luna',
      OPENAI_API_KEY: 'test-openai-key',
      GATEWAY_BASE_URL,
      GATEWAY_API_KEY: 'test-gateway-key',
      LLM_LOCAL_MODEL: 'qwen2.5:32b',
      LLM_DAILY_CAP_USD: '1',
      LLM_PRICE_IN_PER_M: '2.5',
      LLM_PRICE_OUT_PER_M: '10',
    },
    adapters: { openai: openaiAdapter, anthropic: anthropicAdapter },
    ledger: ExplicitLedger.unverified(p3.logPath, 'cucumber:假 globalThis.fetch 的 provisional 佇列場景'),
    defaultTimeoutMs: 5_000,
    onlineProber: async () => p3.online,
    dailyCapUsd: 1,
    prices: { inPerM: 2.5, outPerM: 10 },
  });
}

/** 走 recordProvisional 包住的真 router 呼叫一次。 */
async function call(task: LlmTask, prompt: string, card = CARD): Promise<LlmResult> {
  const m = await mod();
  const wrapped = m.recordProvisional(buildRouter(), await queue(), card);
  p3.result = await wrapped.call(task, prompt);
  return p3.result;
}

const fileText = (): string | null => (existsSync(p3.queuePath) ? readFileSync(p3.queuePath, 'utf8') : null);
const entries = (): Entry[] => {
  const t = fileText();
  return t === null ? [] : (JSON.parse(t) as Entry[]);
};
const backups = (): string[] => readdirSync(join(p3.dir, 'state')).filter((f) => f.startsWith('provisional-queue.json.corrupt-'));

async function seedThree(): Promise<void> {
  const q = await queue();
  const seeds: [LlmTask, string][] = [
    ['deepen', 'sec-0001'],
    ['grade.apply', 'sec-0002'],
    ['reteach.short', 'sec-0003'],
  ];
  for (const [i, [task, card]] of seeds.entries()) {
    p3.clock = `2026-10-27T0${i + 1}:00:00.000Z`;
    await q.enqueue({ task, card, prompt: `原本的 prompt ${i + 1}`, localText: `本機結果 ${i + 1}` });
  }
  p3.queuedBefore = entries();
  assert.equal(p3.queuedBefore.length, 3, '前提:佇列有三筆');
}

// ---------------------------------------------------------------- 場景 1、2

When('a deepen call is served locally', async function () {
  p3.online = false;
  const r = await call('deepen', '請深入說明同源政策。');
  assert.equal(r.provisional, true, '前提:離線時 deepen 走閘道、標 provisional');
  assert.equal(r.text, LOCAL_TEXT);
  assert.equal(p3.gatewayChats, 1, '前提:真的走了閘道');
});

Then('an entry is added to the provisional queue', function () {
  assert.equal(entries().length, 1, `佇列應該多一筆:${fileText()}`);
});

Then('it records the task, the card, the time and a hash of the local result', function () {
  const e = entries()[0]!;
  assert.equal(e.task, 'deepen');
  assert.equal(e.card, CARD);
  assert.equal(e.queued_at, p3.clock, 'queued_at 是注入的時鐘');
  assert.equal(e.local_sha256, sha(LOCAL_TEXT), '雜湊是本機結果 text 的 sha256');
  assert.equal(e.prompt, '請深入說明同源政策。');
});

When('a deepen call is served by the cloud', async function () {
  p3.online = true;
  p3.snapshot = fileText();
  const r = await call('deepen', '請深入說明同源政策。');
  assert.equal(r.provisional, false, '前提:雲端正常時 deepen 走雲端');
  assert.equal(r.text, CLOUD_TEXT);
  assert.equal(p3.cloudCalls, 1, '前提:真的走了雲端');
});

Then('the queue is unchanged', function () {
  assert.equal(fileText(), p3.snapshot, '佇列檔的位元組要跟動作之前一樣(不存在就還是不存在)');
});

// ---------------------------------------------------------------- 場景 3

Given('the queue already holds a grading entry for a card', async function () {
  const q = await queue();
  p3.clock = T1;
  await q.enqueue({ task: 'grade.apply', card: CARD, prompt: '第一次批改的 prompt', localText: '先前的本機批改' });
  assert.equal(entries().length, 1);
});

When('that card is graded locally again', async function () {
  p3.clock = T2;
  p3.online = false;
  const r = await call('grade.apply', '第二次批改的 prompt');
  assert.equal(r.provisional, true, '前提:離線時 grade.apply 走閘道、標 provisional');
});

Then('the queue still holds one grading entry for it', function () {
  const list = entries();
  assert.equal(list.length, 1, `整個佇列還是一筆:${fileText()}`);
  assert.equal(list[0]!.task, 'grade.apply');
  assert.equal(list[0]!.card, CARD);
});

Then('the timestamp is the newer one', function () {
  const e = entries()[0]!;
  assert.equal(e.queued_at, T2);
  assert.equal(e.prompt, '第二次批改的 prompt', '內容也是第二次的');
  assert.equal(e.local_sha256, sha(LOCAL_TEXT));
});

// ---------------------------------------------------------------- 場景 4、5

Given('the queue holds three entries', async function () {
  await seedThree();
});

When('the queue is drained', async function () {
  const q = await queue();
  p3.snapshot = fileText();
  p3.drained = (await q.drain(async () => p3.online)) as Entry[];
});

Then('three entries are returned', function () {
  assert.equal(p3.drained?.length, 3, `drain 應該回 3 筆:${JSON.stringify(p3.drained)}`);
});

Then('each carries the original prompt so it can be replayed', function () {
  assert.deepEqual(
    p3.drained!.map((e) => e.prompt),
    ['原本的 prompt 1', '原本的 prompt 2', '原本的 prompt 3'],
  );
});

Then('nothing is returned', function () {
  assert.deepEqual(p3.drained, [], '離線時 drain 什麼都不回');
});

// ---------------------------------------------------------------- 場景 6

Given('the queue holds one entry', async function () {
  const q = await queue();
  p3.clock = T1;
  await q.enqueue({ task: 'deepen', card: CARD, prompt: '深入說明', localText: LOCAL_TEXT });
  assert.equal(entries().length, 1);
});

When('it is resolved with a cloud result', async function () {
  const q = await queue();
  p3.resolved = await q.resolve({ card: CARD, task: 'deepen' }, { cloudText: CLOUD_TEXT, changed: true });
  assert.equal(p3.resolved, true, 'resolve 找到那一筆要回 true');
});

Then('it is removed from the queue', function () {
  assert.deepEqual(entries(), [], '那一筆要從佇列拿掉');
});

Then('a resolved event is logged recording whether the outcome changed', function () {
  const hits = p3.events.filter((e) => e['type'] === 'provisional_resolved');
  assert.equal(hits.length, 1, `應該剛好一筆 provisional_resolved:${JSON.stringify(p3.events)}`);
  const e = hits[0]!;
  assert.equal(e['card'], CARD);
  assert.equal(e['task'], 'deepen');
  assert.equal(e['changed'], true, 'changed 要等於呼叫端給的值');
  assert.equal(e['local_sha256'], sha(LOCAL_TEXT));
  assert.equal(e['cloud_sha256'], sha(CLOUD_TEXT));
});

// ---------------------------------------------------------------- 場景 7

Given('the queue file is not valid JSON', function () {
  writeFileSync(p3.queuePath, CORRUPT, 'utf8');
});

When('any local call happens', async function () {
  p3.online = false;
  p3.clock = T2;
  const r = await call('deepen', '壞檔之後的這一次呼叫');
  assert.equal(r.provisional, true, '前提:離線時 deepen 走閘道、標 provisional');
});

Then('the corrupt file is preserved with a backup suffix', function () {
  const names = backups();
  assert.equal(names.length, 1, `應該有一個備份檔:${readdirSync(join(p3.dir, 'state')).join(', ')}`);
  assert.equal(readFileSync(join(p3.dir, 'state', names[0]!), 'utf8'), CORRUPT, '備份的內容逐位元組等於原本壞掉的內容');
});

Then('an empty queue is rebuilt', function () {
  const list = entries();
  assert.equal(list.length, 1, `重建成空的、再放進這一次的那一筆,剛好 1 筆:${fileText()}`);
  assert.equal(list[0]!.prompt, '壞檔之後的這一次呼叫');
  assert.equal(list[0]!.card, CARD);
});

// ---------------------------------------------------------------- 場景 8

Given('three entries were queued', async function () {
  await seedThree();
});

When('the process restarts', async function () {
  const m = await mod();
  delete p3.queue; // 舊的實例丟掉,新的實例只能靠磁碟上的檔
  const fresh = new m.ProvisionalQueue({ path: p3.queuePath, log: (e) => p3.events.push(e), now: () => p3.clock });
  p3.reopened = (await fresh.list()) as Entry[];
});

Then('the queue still holds three entries', function () {
  assert.equal(p3.reopened?.length, 3);
  assert.deepEqual(p3.reopened, p3.queuedBefore, '內容跟重開之前一樣');
});
