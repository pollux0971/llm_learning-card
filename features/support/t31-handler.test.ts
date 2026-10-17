/**
 * T31 驗收 4:側車 handler——應用題遇到「模型這次不能用」→ submit 回 `status: "error"`、題目留著;bug 與設定錯誤照舊 internal;
 * 憑證照舊 credential-unavailable(T30)。紅測試作者寫;開發 worker 不改。
 *
 * 不改側車(handler.ts 本來就用 keepOnError 把 pass === null 變成 status error);這裡證明「模型不能用」這個成因也走那條路:
 *   - submit 的結果 `{ status: 'error', pass: null, cardDone: false, feedback: 固定那一句 }`,不是 internal;
 *   - session 還在(再送一次可以、status 照常)、reviews.json 位元組不變、卡片 stage 不動、小結 passed / returned 都是 0;
 *   - 不自動重打:一次 submit 只問一次 grade.apply;使用者再按「送出」才是第二次(改好之後可以過);
 *   - bug(TypeError 等)、設定錯誤(403、模型名被拒)照舊 internal 且不洩漏原文;憑證照舊 credential-unavailable;
 *   - 填空題的 router 失敗照舊 fallback-strict(不是 error)。
 *
 * 路由器、時鐘全是程序內的假物件:不打網路、不花錢、不讀真的 .env。全部用暫存目錄。
 * handler 的行為在基底上「模型不能用」會變 internal(紅);bug / 憑證 / 其他的本來就綠。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { scriptedApplyReply } from '../steps/_i2-cloud-script.js';
import { GatewayCallError, LlmTimeoutError, MissingCredentialError, NoModelError, OutputTruncatedError } from '../../packages/core/src/llm/errors.js';
import { ReviewStartError } from '../../packages/core/src/session/handler.js';
import {
  TODAY,
  addDays,
  cachePath,
  createVault,
  ledgerEvents,
  readReviews,
  removeVault,
  reviewRecord,
  reviewsPath,
  writeReviews,
  type Vault,
} from './review-session-harness.js';

const ROOT = join(import.meta.dirname, '../..');
const HANDLER = pathToFileURL(join(ROOT, 'packages/core/src/session/handler.ts')).href;

type Obj = Record<string, unknown>;
interface Deps {
  learningDir: string;
  today: string | (() => string);
  routerFactory: () => unknown | Promise<unknown>;
  env: NodeJS.ProcessEnv;
  reloadEnv?: () => boolean;
  missingKeys?: () => readonly string[];
}
type Handler = (line: string) => Promise<string>;

const MISSING = (key: string): string => `批改要用的金鑰沒有設定:${key}。請在專案根目錄的 .env 加上。`;
const REJECTED = (key: string): string => `批改用的金鑰被拒絕:${key}(可能過期或打錯)。請在專案根目錄的 .env 換一個。`;

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- 假路由器

type ApplyStep = 'pass' | unknown;
interface Router {
  id: string;
  /** 所有 call 的次數(任何 task) */
  calls: number;
  /** grade.apply 被問的次數 */
  applyCalls: number;
  probes: number;
  call(task: string, prompt: string): Promise<unknown>;
  probeOnline(): Promise<boolean>;
  probeLocal(): Promise<unknown>;
}
/** 應用題依序用 steps:'pass' = 通過;Error = 丟那個錯。用完一律通過。其他 task 當沒有本機模型。 */
function makeRouter(id: string, steps: ApplyStep[] = []): Router {
  const queue = [...steps];
  const r: Router = {
    id,
    calls: 0,
    applyCalls: 0,
    probes: 0,
    async call(task, prompt) {
      r.calls += 1;
      if (task !== 'grade.apply') throw new NoModelError('grade.fill.llm');
      r.applyCalls += 1;
      const step = queue.length > 0 ? queue.shift() : 'pass';
      if (step !== 'pass') throw step;
      return { text: scriptedApplyReply(prompt), provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      r.probes += 1;
      return true;
    },
    async probeLocal() {
      r.probes += 1;
      return { available: false, models: [] };
    },
  };
  return r;
}

function statusError(status: number, message = 'Incorrect API key provided'): Error {
  const e = new Error(message);
  (e as unknown as { status: number }).status = status;
  return e;
}

// ---------------------------------------------------------------- 佈置

function seed(v: Vault, entries: Record<string, { stage: number; overdue: number }>, today = TODAY): void {
  const reviews: Record<string, ReturnType<typeof reviewRecord>> = {};
  for (const [id, e] of Object.entries(entries)) reviews[id] = reviewRecord({ stage: e.stage, next_due: addDays(today, -e.overdue) });
  writeReviews(v, reviews);
}
const APPLY_ONE = { 'sec-0003': { stage: 3, overdue: 1 } };
const FILL_THREE = { 'sec-0001': { stage: 1, overdue: 3 }, 'sec-0002': { stage: 1, overdue: 2 }, 'sec-0003': { stage: 1, overdue: 1 } };

interface RigOpts {
  entries?: Record<string, { stage: number; overdue: number }>;
  env?: NodeJS.ProcessEnv;
  today?: string | (() => string);
  routers?: Router[];
  reloadEnv?: () => boolean;
  missingKeys?: () => readonly string[];
  factory?: () => unknown;
  cards?: number;
}
interface Rig {
  v: Vault;
  send(method: string, params?: Obj): Promise<Obj>;
  factoryCalls: () => number;
}
async function rig(opts: RigOpts = {}): Promise<Rig> {
  const v = createVault({ cards: opts.cards ?? 6 });
  vaults.push(v);
  seed(v, opts.entries ?? FILL_THREE);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: v.home, XDG_CACHE_HOME: v.xdgCache, XDG_CONFIG_HOME: v.xdgConfig, LC_REVIEW_FAKE_CLOUD: undefined, LC_REVIEW_TODAY: undefined, ...opts.env };
  const routers = [...(opts.routers ?? [makeRouter('r1')])];
  let made = 0;
  const deps: Deps = {
    learningDir: v.dir,
    today: opts.today ?? TODAY,
    routerFactory:
      opts.factory ??
      (() => {
        made += 1;
        const next = routers.length > 1 ? routers.shift()! : routers[0]!;
        return next;
      }),
    env,
    ...(opts.reloadEnv ? { reloadEnv: opts.reloadEnv } : {}),
    ...(opts.missingKeys ? { missingKeys: opts.missingKeys } : {}),
  };
  const mod = (await import(/* @vite-ignore */ HANDLER)) as { createReviewHandler(d: Deps): Handler };
  const handler = mod.createReviewHandler(deps);
  let id = 1;
  return {
    v,
    factoryCalls: () => made,
    async send(method, params = {}) {
      const out = await handler(JSON.stringify({ v: 1, id: id++, method, params }));
      return JSON.parse(out) as Obj;
    },
  };
}
const ok = (r: Obj): Obj => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.result as Obj;
};
const err = (r: Obj): { kind: string; message: string } => {
  expect(r.ok, JSON.stringify(r)).toBe(false);
  return r.error as { kind: string; message: string };
};
const bytes = (v: Vault): string => readFileSync(reviewsPath(v), 'utf8');
const ledgerCount = (v: Vault): number => ledgerEvents(v).length;

// ---------------------------------------------------------------- 常數與案例

const UNAVAILABLE_FEEDBACK = '這次沒辦法批改(模型暫時連不上),請再試一次。';
const SECRET = 'boom-secret-detail-71c2';

const UNAVAILABLE: [string, () => unknown][] = [
  ['LlmTimeoutError', () => new LlmTimeoutError('grade.apply', 60_000)],
  ['OutputTruncatedError', () => new OutputTruncatedError('grade.apply', 500, 500)],
  ['NoModelError(離線又沒有本機模型)', () => new NoModelError('grade.apply', { detail: SECRET })],
  ['NoModelError 包著閘道 503', () => new NoModelError('grade.apply', { cause: new GatewayCallError('chat returned 503', 503) })],
  ['AbortError(閘道逾時)', () => Object.assign(new Error('aborted'), { name: 'AbortError' })],
  ['TypeError("fetch failed")(連線被拒)', () => new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })],
  ['status 429', () => statusError(429, SECRET)],
  ['status 503', () => statusError(503, SECRET)],
];

async function atFirstQuestion(opts: RigOpts): Promise<{ r: Rig; q: Obj }> {
  const r = await rig({ entries: APPLY_ONE, ...opts });
  ok(await r.send('start'));
  const q = ok(await r.send('next'));
  return { r, q };
}

// ---------------------------------------------------------------- 應用題:模型不能用

describe('應用題 submit 遇到模型不能用 → status error,題目留著(驗收 4)', () => {
  it.each(UNAVAILABLE)('%s:submit 回 status error / pass null / cardDone false / 固定那一句,不是 internal', async (_name, make) => {
    const { r } = await atFirstQuestion({ routers: [makeRouter('r1', [make()])] });
    const res = await r.send('submit', { apply: 'PASSALL 回答' });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(res.result).toMatchObject({ status: 'error', pass: null, cardDone: false, feedback: UNAVAILABLE_FEEDBACK });
  });

  it.each(UNAVAILABLE)('%s:reviews.json 位元組不變、帳本沒多一筆、小結通過與退回都是 0', async (_name, make) => {
    const { r } = await atFirstQuestion({ routers: [makeRouter('r1', [make()])] });
    const reviewsBefore = bytes(r.v);
    const ledgerBefore = ledgerCount(r.v);
    ok(await r.send('submit', { apply: 'PASSALL 回答' }));
    expect(bytes(r.v)).toBe(reviewsBefore);
    expect(ledgerCount(r.v)).toBe(ledgerBefore);
    expect(ok(await r.send('summary'))).toMatchObject({ passed: 0, returned: 0 });
  });

  it.each(UNAVAILABLE)('%s:一次 submit 只問一次 grade.apply(不自動重打)', async (_name, make) => {
    const router = makeRouter('r1', [make(), 'pass']);
    const { r } = await atFirstQuestion({ routers: [router] });
    ok(await r.send('submit', { apply: 'PASSALL 回答' }));
    expect(router.applyCalls).toBe(1);
  });

  it('session 還在、卡片沒前進也沒退回:再送同一題(模型好了)就過,只問第二次,歷史只多一筆', async () => {
    const router = makeRouter('r1', [new LlmTimeoutError('grade.apply', 60_000)]);
    const { r, q } = await atFirstQuestion({ routers: [router] });
    const before = readReviews(r.v)[q.card as string]!;
    expect(ok(await r.send('submit', { apply: 'PASSALL 回答' }))).toMatchObject({ status: 'error' });
    expect(readReviews(r.v)[q.card as string]).toEqual(before);
    expect(ok(await r.send('status'))).toMatchObject({ paused: false, today: TODAY });
    const again = ok(await r.send('submit', { apply: 'PASSALL 回答' }));
    expect(again).toMatchObject({ status: 'passed', pass: true, cardDone: true });
    expect(router.applyCalls).toBe(2);
    expect(readReviews(r.v)[q.card as string]!.history.filter((h) => h.date === TODAY)).toHaveLength(1);
  });

  it('連續兩次模型不能用都是 error,第三次才過;每次送出只問一次', async () => {
    const router = makeRouter('r1', [new NoModelError('grade.apply'), statusError(503, SECRET)]);
    const { r } = await atFirstQuestion({ routers: [router] });
    expect(ok(await r.send('submit', { apply: 'PASSALL 回答' }))).toMatchObject({ status: 'error', cardDone: false });
    expect(router.applyCalls).toBe(1);
    expect(ok(await r.send('submit', { apply: 'PASSALL 回答' }))).toMatchObject({ status: 'error', cardDone: false });
    expect(router.applyCalls).toBe(2);
    expect(ok(await r.send('submit', { apply: 'PASSALL 回答' }))).toMatchObject({ status: 'passed', cardDone: true });
    expect(router.applyCalls).toBe(3);
  });

  it('回應不能用的訊息與結果都不洩漏例外原文、絕對路徑', async () => {
    const { r } = await atFirstQuestion({ routers: [makeRouter('r1', [new NoModelError('grade.apply', { detail: SECRET, cause: statusError(503, `${SECRET} at /home/someone/x`) })])] });
    const raw = JSON.stringify(await r.send('submit', { apply: 'PASSALL 回答' }));
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('/home/someone');
  });

  it('作答在送出前被改過的 reviews.json(T26 樂觀檢查)不受影響:模型不能用時沒有寫入,所以也沒有 reviews-changed', async () => {
    const { r } = await atFirstQuestion({ routers: [makeRouter('r1', [new LlmTimeoutError('grade.apply', 1)])] });
    const res = await r.send('submit', { apply: 'PASSALL 回答' });
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({ status: 'error' });
  });
});

// ---------------------------------------------------------------- bug、設定錯誤、憑證照舊

describe('不是「模型不能用」的照舊(驗收 4、6)', () => {
  const INTERNAL: [string, () => unknown][] = [
    ['TypeError(bug,不是網路特徵字)', () => new TypeError(`Cannot read properties of undefined (reading '${SECRET}')`)],
    ['RangeError', () => new RangeError(SECRET)],
    ['普通的 Error', () => new Error(SECRET)],
    ['雲端 403', () => statusError(403, SECRET)],
    ['雲端 400', () => statusError(400, SECRET)],
    ['雲端 404', () => statusError(404, SECRET)],
    ['不在三個鍵名裡的 MissingCredentialError', () => new MissingCredentialError('SOME_OTHER_KEY')],
  ];

  it.each(INTERNAL)('%s → internal,不洩漏原文;reviews.json 不動', async (_name, make) => {
    const { r } = await atFirstQuestion({ routers: [makeRouter('r1', [make()])] });
    const reviewsBefore = bytes(r.v);
    const e = err(await r.send('submit', { apply: 'PASSALL 回答' }));
    expect(e.kind).toBe('internal');
    expect(JSON.stringify(e)).not.toMatch(new RegExp(`${SECRET}|SOME_OTHER`));
    expect(bytes(r.v)).toBe(reviewsBefore);
  });

  it('bug 之後 session 不被清掉:再送一次(router 好了)可以過', async () => {
    const { r } = await atFirstQuestion({ routers: [makeRouter('r1', [new TypeError(SECRET)])] });
    expect(err(await r.send('submit', { apply: 'PASSALL 回答' })).kind).toBe('internal');
    expect(ok(await r.send('submit', { apply: 'PASSALL 回答' }))).toMatchObject({ status: 'passed' });
  });

  const CREDENTIAL: [string, () => unknown, NodeJS.ProcessEnv][] = [
    ['缺閘道鍵', () => new MissingCredentialError('GATEWAY_API_KEY'), {}],
    ['閘道 401', () => new GatewayCallError('chat returned 401', 401), {}],
    ['閘道 401 包在 NoModelError 裡', () => new NoModelError('grade.apply', { cause: new GatewayCallError('chat returned 401', 401) }), {}],
    ['雲端 401', () => statusError(401), { LLM_CLOUD_PROVIDER: 'openai' }],
  ];
  it.each(CREDENTIAL)('憑證問題「%s」照舊 credential-unavailable,不被收成評分失敗', async (_name, make, env) => {
    const { r } = await atFirstQuestion({ routers: [makeRouter('r1', [make()])], env });
    expect(err(await r.send('submit', { apply: 'PASSALL 回答' })).kind).toBe('credential-unavailable');
  });
});

// ---------------------------------------------------------------- 填空題

describe('填空題的 router 失敗(驗收 3、4)', () => {
  /** 第三層(同義判斷)才會呼叫 router;fillRouter 在 grade.fill.llm 丟指定的錯 */
  function fillRouter(thrown: unknown): { call(task: string, prompt: string): Promise<unknown>; probeOnline(): Promise<boolean>; probeLocal(): Promise<unknown>; calls: number } {
    const f = {
      calls: 0,
      async call(): Promise<never> {
        f.calls += 1;
        throw thrown;
      },
      async probeOnline(): Promise<boolean> {
        return true;
      },
      async probeLocal(): Promise<unknown> {
        return { available: false, models: [] };
      },
    };
    return f;
  }
  const WRONG = ['錯錯錯錯錯', '錯錯錯錯錯', '錯錯錯錯錯'];

  it.each([
    ['NoModelError', () => new NoModelError('grade.fill.llm')],
    ['逾時', () => new LlmTimeoutError('grade.fill.llm', 5000)],
    ['status 503', () => statusError(503)],
    ['連線被拒', () => new TypeError('fetch failed')],
  ])('同義判斷遇到「%s」:照舊收成嚴格比對(fallback-strict),submit 是 ok,不是 error 也不是 internal', async (_name, make) => {
    const f = fillRouter(make());
    const r = await rig({ entries: { 'sec-0001': { stage: 1, overdue: 1 } }, factory: () => f });
    ok(await r.send('start'));
    ok(await r.send('next'));
    const res = await r.send('submit', { fill: WRONG });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect((res.result as Obj).status).not.toBe('error');
    expect(f.calls).toBeGreaterThan(0);
  });

  it('同義判斷遇到程式的 bug(TypeError,非網路):internal,看得見,不收成錯題', async () => {
    const f = fillRouter(new TypeError(`x.trim is not a function ${SECRET}`));
    const r = await rig({ entries: { 'sec-0001': { stage: 1, overdue: 1 } }, factory: () => f });
    ok(await r.send('start'));
    ok(await r.send('next'));
    const reviewsBefore = bytes(r.v);
    const e = err(await r.send('submit', { fill: WRONG }));
    expect(e.kind).toBe('internal');
    expect(JSON.stringify(e)).not.toContain(SECRET);
    expect(bytes(r.v)).toBe(reviewsBefore);
  });
});
