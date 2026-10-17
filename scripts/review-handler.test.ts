/**
 * T22 驗收 4(程序內這一層):`createReviewHandler(deps) => (line) => Promise<line>`(`packages/core/src/session/handler.ts`)。
 * 紅測試作者寫;開發 worker 不改。起真的行程、stdio、環境變數那一層在 `review-sidecar.test.ts`。
 *
 * 工單的簽名:`deps = { learningDir, today, routerFactory, env }`;handler 收一行、回一行,**不碰 stdio**。
 * 這份測試額外固定的細節(工單沒寫,協調者轉進工單):回傳的字串是**不含換行**的一行 JSON(框線程式才加 `\\n`);
 * `start` 的 `fakeCloud` = `Boolean(deps.env.LC_REVIEW_FAKE_CLOUD)`;`routerFactory` 在第一次 `start` 才呼叫、之後不再呼叫。
 *
 * 路由器是程序內的假物件(用 `_i2-cloud-script.ts` 的 scriptedApplyReply 回應應用題),不打網路、不花錢。
 * 全部用暫存目錄(learning、XDG_*、HOME 同一個 mkdtemp),不碰真的 learning/ 與真的 ~/.cache。
 * 模組還沒寫:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { scriptedApplyReply } from '../features/steps/_i2-cloud-script.js';
import { NoModelError } from '../packages/core/src/llm/errors.js';
import {
  TODAY,
  addDays,
  cachePath,
  createVault,
  gitInit,
  readReviews,
  removeVault,
  reviewRecord,
  reviewsPath,
  writeReviews,
  type Vault,
} from '../features/support/review-session-harness.js';

const ROOT = join(import.meta.dirname, '..');
const HANDLER = pathToFileURL(join(ROOT, 'packages/core/src/session/handler.ts')).href;
const PROTOCOL = pathToFileURL(join(ROOT, 'packages/core/src/session/protocol.ts')).href;

type Obj = Record<string, unknown>;
interface Deps { learningDir: string; today: string; routerFactory: () => unknown | Promise<unknown>; env: NodeJS.ProcessEnv }
type Handler = (line: string) => Promise<string>;

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** 一般填空題用 exact 就過;打錯的答案走到 local-llm 那層時,假裝沒有本機模型(跟離線時一樣退回嚴格比對) */
function fakeRouter(): { calls: number; call(task: string, prompt: string): Promise<unknown>; probeOnline(): Promise<boolean>; probeLocal(): Promise<unknown> } {
  const r = {
    calls: 0,
    async call(task: string, prompt: string): Promise<unknown> {
      r.calls += 1;
      if (task !== 'grade.apply') throw new NoModelError(task);
      return { text: scriptedApplyReply(prompt), provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false };
    },
    async probeOnline(): Promise<boolean> {
      return true;
    },
    async probeLocal(): Promise<unknown> {
      return { available: false, models: [] };
    },
  };
  return r;
}

function envOf(v: Vault, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, HOME: v.home, XDG_CACHE_HOME: v.xdgCache, XDG_CONFIG_HOME: v.xdgConfig, LC_REVIEW_FAKE_CLOUD: undefined, LC_REVIEW_TODAY: undefined, ...extra };
}

function seed(v: Vault, entries: Record<string, { stage: number; overdue?: number } & Partial<ReturnType<typeof reviewRecord>>>): void {
  const reviews: Record<string, ReturnType<typeof reviewRecord>> = {};
  for (const [id, e] of Object.entries(entries)) {
    const { stage, overdue, ...rest } = e;
    reviews[id] = reviewRecord({ ...rest, stage, next_due: addDays(TODAY, -(overdue ?? 1)) });
  }
  writeReviews(v, reviews);
}

interface Rig { v: Vault; handler: Handler; router: ReturnType<typeof fakeRouter>; factoryCalls: () => number; send(method: string, params?: Obj, id?: number): Promise<Obj> }
async function rig(over: { cards?: number; entries?: Record<string, { stage: number; overdue?: number } & Partial<ReturnType<typeof reviewRecord>>>; env?: NodeJS.ProcessEnv; git?: boolean } = {}): Promise<Rig> {
  const v = createVault({ cards: over.cards ?? 6 });
  vaults.push(v);
  seed(v, over.entries ?? { 'sec-0001': { stage: 1, overdue: 3 }, 'sec-0002': { stage: 1, overdue: 2 }, 'sec-0003': { stage: 3, overdue: 1 } });
  if (over.git) gitInit(v);
  const router = fakeRouter();
  let factoryCalls = 0;
  const deps: Deps = {
    learningDir: v.dir,
    today: TODAY,
    routerFactory: () => {
      factoryCalls += 1;
      return router;
    },
    env: envOf(v, over.env),
  };
  const mod = (await import(/* @vite-ignore */ HANDLER)) as { createReviewHandler(d: Deps): Handler };
  const handler = mod.createReviewHandler(deps);
  let nextId = 1;
  return {
    v,
    handler,
    router,
    factoryCalls: () => factoryCalls,
    async send(method, params = {}, id) {
      const useId = id ?? nextId++;
      const out = await handler(JSON.stringify({ v: 1, id: useId, method, params }));
      expect(out, '回傳是一行(不含換行)').not.toContain('\n');
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
async function messages(): Promise<Record<string, string>> {
  return ((await import(/* @vite-ignore */ PROTOCOL)) as { ERROR_MESSAGES: Record<string, string> }).ERROR_MESSAGES;
}
function questionYaml(v: Vault, card: string): { fill: { answers: string[][] }[] } {
  return parseYaml(readFileSync(join(v.dir, 'questions', `${card}.yaml`), 'utf8')) as { fill: { answers: string[][] }[] };
}
const rightFill = (v: Vault, card: string): string[] => questionYaml(v, card).fill[0]!.answers.map((g) => g[0]!);
const bytes = (v: Vault): string => readFileSync(reviewsPath(v), 'utf8');

describe('起來與回應的形狀(驗收 3、4)', () => {
  it('routerFactory 在第一次 start 才呼叫(之後不再),status 不叫;不 import 就不起任何行程', async () => {
    const r = await rig();
    expect(r.factoryCalls()).toBe(0);
    ok(await r.send('status'));
    expect(r.factoryCalls()).toBe(0);
    ok(await r.send('start'));
    expect(r.factoryCalls()).toBe(1);
    ok(await r.send('start'));
    expect(r.factoryCalls()).toBe(1);
  });

  it('回應的信封:v 1、id 跟請求一樣、ok true、result 是物件;失敗時 ok false、error 只有 kind 與 message', async () => {
    const r = await rig();
    const good = await r.send('status', {}, 41);
    expect(good).toEqual({ v: 1, id: 41, ok: true, result: expect.any(Object) });
    const bad = await r.send('next', {}, 42);
    expect(Object.keys(bad).sort()).toEqual(['error', 'id', 'ok', 'v']);
    expect(bad.id).toBe(42);
    expect(Object.keys(bad.error as Obj).sort()).toEqual(['kind', 'message']);
  });

  it('壞的一行:bad-request,id 是 null;不丟錯;下一則正常請求照常處理', async () => {
    const r = await rig();
    const bad = JSON.parse(await r.handler('not json')) as Obj;
    expect(bad).toMatchObject({ v: 1, id: null, ok: false, error: { kind: 'bad-request' } });
    expect((bad.error as Obj).message).toBe((await messages())['bad-request']);
    ok(await r.send('status'));
  });

  it('未知的 v、未知 method、超長的一行:各自的 kind,id 讀得出就帶;處理完還活著', async () => {
    const r = await rig();
    const msgs = await messages();
    const v2 = JSON.parse(await r.handler(JSON.stringify({ v: 2, id: 5, method: 'status', params: {} }))) as Obj;
    expect(v2).toMatchObject({ id: 5, ok: false, error: { kind: 'unsupported-version', message: msgs['unsupported-version'] } });
    const unknown = JSON.parse(await r.handler(JSON.stringify({ v: 1, id: 6, method: 'Status', params: {} }))) as Obj;
    expect(unknown).toMatchObject({ id: 6, ok: false, error: { kind: 'unknown-method', message: msgs['unknown-method'] } });
    const big = JSON.parse(await r.handler(JSON.stringify({ v: 1, id: 7, method: 'submit', params: { apply: 'a'.repeat(300_000) } }))) as Obj;
    expect(big).toMatchObject({ ok: false, error: { kind: 'too-large', message: msgs['too-large'] } });
    ok(await r.send('status'));
  });

  it('不寫 stdout、不呼叫 process.exit(側車的 stdout 只准協定行)', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const r = await rig();
    ok(await r.send('start'));
    ok(await r.send('next'));
    await r.handler('壞的一行');
    expect(out).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('start / status(驗收 4)', () => {
  it('有到期的卡:ready,數字對得上,fakeCloud 跟環境變數一致', async () => {
    const r = await rig();
    expect(ok(await r.send('start'))).toEqual({ state: 'ready', today: TODAY, resumed: false, total: 3, answered: 0, deferred: 0, dailyCap: 10, overdue: 3, fakeCloud: false });
    const fake = await rig({ env: { LC_REVIEW_FAKE_CLOUD: '/some/fake.mjs' } });
    expect(ok(await fake.send('start')).fakeCloud).toBe(true);
  });

  it('start 的 result 只有工單的那九個鍵(T23 加了 overdue 整數;沒有路徑、沒有 learning 目錄、沒有卡 id 清單)', async () => {
    const r = await rig();
    const res = ok(await r.send('start'));
    expect(Object.keys(res).sort()).toEqual(['answered', 'dailyCap', 'deferred', 'fakeCloud', 'overdue', 'resumed', 'state', 'today', 'total']);
    expect(typeof res.overdue).toBe('number');
    expect(Number.isInteger(res.overdue)).toBe(true);
    expect(JSON.stringify(await r.send('start'))).not.toContain(r.v.dir);
  });

  it('今天沒有到期:state empty', async () => {
    const r = await rig({ entries: { 'sec-0001': { stage: 1, overdue: -5 } } });
    expect(ok(await r.send('start'))).toMatchObject({ state: 'empty', total: 0 });
  });

  it('cards/ 底下 0 張卡:no-cards(不能說成「今天沒有到期」),固定句子', async () => {
    const r = await rig();
    const dir = join(r.v.dir, 'cards/security');
    for (const f of readdirSync(dir)) rmSync(join(dir, f));
    const e = err(await r.send('start'));
    expect(e).toEqual({ kind: 'no-cards', message: (await messages())['no-cards'] });
  });

  it('今天暫停:start 回 state paused;next / submit 回 paused;status 回 paused true', async () => {
    const r = await rig();
    ok(await r.send('start'));
    writeFileSync(cachePath(r.v, TODAY), JSON.stringify({ ...JSON.parse(readFileSync(cachePath(r.v, TODAY), 'utf8')), paused: true }), 'utf8');
    expect(ok(await r.send('status'))).toEqual({ paused: true, today: TODAY });
    expect(ok(await r.send('start'))).toMatchObject({ state: 'paused' });
    expect(err(await r.send('next')).kind).toBe('paused');
    expect(err(await r.send('submit', { fill: ['a'] })).kind).toBe('paused');
  });

  it('status:沒有快取 → paused false;不叫 routerFactory、不建快取', async () => {
    const r = await rig();
    expect(ok(await r.send('status'))).toEqual({ paused: false, today: TODAY });
    expect(existsSync(cachePath(r.v, TODAY))).toBe(false);
    expect(r.factoryCalls()).toBe(0);
  });

  it('在 session 中途再 start:續答——resumed true、answered 是今天已答的張數、下一題從第二題開始', async () => {
    const r = await rig();
    ok(await r.send('start'));
    const q = ok(await r.send('next'));
    ok(await r.send('submit', { fill: rightFill(r.v, q.card as string) }));
    const again = ok(await r.send('start'));
    expect(again).toMatchObject({ state: 'ready', resumed: true, answered: 1, total: 3 });
    const q2 = ok(await r.send('next'));
    expect(q2.card).not.toBe(q.card);
    expect(q2.progress).toEqual({ index: 2, total: 3 });
  });
});

describe('沒有 session / 沒有題目時的錯誤(驗收 4)', () => {
  it('還沒 start:next、submit、summary 都回 no-session(固定句子)', async () => {
    const r = await rig();
    const msg = (await messages())['no-session'];
    for (const [method, params] of [['next', {}], ['submit', { fill: ['a'] }], ['summary', {}]] as const) {
      expect(err(await r.send(method, params))).toEqual({ kind: 'no-session', message: msg });
    }
  });

  it('start 了但還沒 next 拿到題目就 submit:no-question', async () => {
    const r = await rig();
    ok(await r.send('start'));
    expect(err(await r.send('submit', { fill: ['a'] }))).toEqual({ kind: 'no-question', message: (await messages())['no-question'] });
  });

  it('fill / apply 跟目前題型不合:no-question,而且這一題沒被吃掉(磁碟沒動、同一題還在)', async () => {
    const r = await rig();
    ok(await r.send('start'));
    const q = ok(await r.send('next'));
    expect(q.type).toBe('fill');
    const before = bytes(r.v);
    expect(err(await r.send('submit', { apply: '一段回答' })).kind).toBe('no-question');
    expect(bytes(r.v)).toBe(before);
    expect(ok(await r.send('next'))).toMatchObject({ kind: 'question', card: q.card, type: 'fill' });
  });
});

describe('next 與 submit(驗收 4)', () => {
  it('填空題:question 的欄位剛好是工單的那些;blanks 是空格數;progress 從 1 起', async () => {
    const r = await rig();
    ok(await r.send('start'));
    const q = ok(await r.send('next'));
    expect(Object.keys(q).sort()).toEqual(['blanks', 'card', 'kind', 'overdueDays', 'progress', 'prompt', 'stage', 'stuck', 'type']);
    expect(q).toMatchObject({ kind: 'question', card: 'sec-0001', stage: 1, type: 'fill', blanks: 3, progress: { index: 1, total: 3 }, stuck: false, overdueDays: 3 });
    expect(q.prompt).toContain('同源');
  });

  it('應用題:沒有 blanks 鍵', async () => {
    const r = await rig({ entries: { 'sec-0003': { stage: 3, overdue: 1 } } });
    ok(await r.send('start'));
    const q = ok(await r.send('next'));
    expect(q).toMatchObject({ kind: 'question', type: 'apply', card: 'sec-0003' });
    expect('blanks' in q).toBe(false);
  });

  it('答對填空題:passed、cardDone true、newStage 2,reviews.json 已落地;沒有 correctAnswers', async () => {
    const r = await rig();
    ok(await r.send('start'));
    const q = ok(await r.send('next'));
    const out = ok(await r.send('submit', { fill: rightFill(r.v, q.card as string) }));
    expect(out).toMatchObject({ status: 'passed', pass: true, cardDone: true, newStage: 2 });
    expect(typeof out.feedback).toBe('string');
    expect('correctAnswers' in out).toBe(false);
    expect(readReviews(r.v)[q.card as string]!.stage).toBe(2);
  });

  it('答錯填空題:failed,帶 correctAnswers = 每個空格可接受寫法的第一個', async () => {
    const r = await rig();
    ok(await r.send('start'));
    const q = ok(await r.send('next'));
    const out = ok(await r.send('submit', { fill: ['錯', '錯', '錯'] }));
    expect(out).toMatchObject({ status: 'failed', pass: false, cardDone: true });
    expect(out.correctAnswers).toEqual(rightFill(r.v, q.card as string));
    expect(readReviews(r.v)[q.card as string]!.stage).toBe(1);
  });

  it('填空題用陣列送:答案裡的逗號不被切開', async () => {
    const r = await rig();
    ok(await r.send('start'));
    ok(await r.send('next'));
    const out = ok(await r.send('submit', { fill: ['協定,主機,埠號', '', ''] }));
    expect(out.status, '一個空格塞了三個答案,不是三個空格').toBe('failed');
  });

  it('stage 2 的卡(填空再應用):填空題的結果是 partial;填空答錯時 pass false 就帶 correctAnswers,答對時 pass true 就不帶', async () => {
    const wrong = await rig({ entries: { 'sec-0002': { stage: 2, overdue: 1 } } });
    ok(await wrong.send('start'));
    ok(await wrong.send('next'));
    const w = ok(await wrong.send('submit', { fill: ['錯'] }));
    expect(w).toMatchObject({ status: 'partial', pass: false, cardDone: false });
    expect(w.correctAnswers).toEqual(rightFill(wrong.v, 'sec-0002'));

    const right = await rig({ entries: { 'sec-0002': { stage: 2, overdue: 1 } } });
    ok(await right.send('start'));
    ok(await right.send('next'));
    const r = ok(await right.send('submit', { fill: rightFill(right.v, 'sec-0002') }));
    expect(r).toMatchObject({ status: 'partial', pass: true, cardDone: false });
    expect('correctAnswers' in r).toBe(false);
  });

  it('答應用題通過:passed、沒有 correctAnswers;失敗(FAILONE)也沒有 correctAnswers', async () => {
    const r = await rig({ entries: { 'sec-0003': { stage: 3, overdue: 1 }, 'sec-0004': { stage: 3, overdue: 2 } } });
    ok(await r.send('start'));
    ok(await r.send('next'));
    const passed = ok(await r.send('submit', { apply: 'PASSALL 這是回答' }));
    expect(passed).toMatchObject({ status: 'passed', pass: true, cardDone: true });
    expect('correctAnswers' in passed).toBe(false);
    ok(await r.send('next'));
    const failed = ok(await r.send('submit', { apply: 'FAILONE 這是回答' }));
    expect(failed).toMatchObject({ status: 'failed', pass: false, cardDone: true });
    expect('correctAnswers' in failed).toBe(false);
  });

  it('批改失敗不是錯誤:ok true、status error、pass null、cardDone false;reviews.json 沒動;下一次 next 還是同一題;重送可以過', async () => {
    const r = await rig({ entries: { 'sec-0003': { stage: 3, overdue: 1 } } });
    ok(await r.send('start'));
    const q = ok(await r.send('next'));
    const before = bytes(r.v);
    const out = ok(await r.send('submit', { apply: 'GARBAGE 亂回' }));
    expect(out).toMatchObject({ status: 'error', pass: null, cardDone: false });
    expect(bytes(r.v)).toBe(before);
    const again = ok(await r.send('next'));
    expect(again).toMatchObject({ kind: 'question', card: q.card, type: 'apply', progress: { index: 1, total: 1 } });
    expect(ok(await r.send('submit', { apply: 'PASSALL 好' }))).toMatchObject({ status: 'passed', cardDone: true });
  });

  it('全部答完:next 回 done', async () => {
    const r = await rig({ entries: { 'sec-0001': { stage: 1, overdue: 1 } } });
    ok(await r.send('start'));
    const q = ok(await r.send('next'));
    ok(await r.send('submit', { fill: rightFill(r.v, q.card as string) }));
    expect(ok(await r.send('next'))).toEqual({ kind: 'done' });
  });
});

describe('reteach 不送內容,只送路徑(驗收 3、4,T25 的退回原卡)', () => {
  const entries = { 'sec-0001': { stage: 1, overdue: 3, fails_in_row: 2, total_fails: 2 } };

  it('有縮短版:next 回 { kind: reteach, card, path: 縮短版的相對路徑, short: true },沒有 shortBody 也沒有內文', async () => {
    const r = await rig({ entries });
    writeFileSync(join(r.v.dir, 'cards/security/sec-0001.short.md'), '---\nid: sec-0001\n---\n\n縮短版的獨特內文標記 ZETA-SHORT。\n', 'utf8');
    ok(await r.send('start'));
    const out = ok(await r.send('next'));
    expect(out).toEqual({ kind: 'reteach', card: 'sec-0001', path: 'cards/security/sec-0001.short.md', short: true });
    expect(JSON.stringify(out)).not.toContain('ZETA-SHORT');
  });

  it('沒有縮短版:退回原卡的 path、short false;next 不丟錯、不卡住;之後照常問題目', async () => {
    const r = await rig({ entries });
    ok(await r.send('start'));
    const out = ok(await r.send('next'));
    expect(out).toEqual({ kind: 'reteach', card: 'sec-0001', path: 'cards/security/sec-0001.md', short: false });
    expect(ok(await r.send('next'))).toMatchObject({ kind: 'question', card: 'sec-0001' });
  });

  it('path 是正斜線的相對路徑:不以 / 開頭、不含反斜線、不含 learning 目錄的絕對路徑', async () => {
    const r = await rig({ entries });
    ok(await r.send('start'));
    const out = ok(await r.send('next'));
    expect(out.path).toMatch(/^cards\/[^/\\]+\/sec-0001(\.short)?\.md$/);
    expect(JSON.stringify(out)).not.toContain(r.v.dir);
  });
});

describe('summary(驗收 4)', () => {
  it('這一次沒答題:snapshot skipped(不 commit),result 沒有 hint;數字:retryLater 是沒答的張數', async () => {
    const r = await rig({ git: true });
    ok(await r.send('start'));
    const out = ok(await r.send('summary'));
    expect(out.snapshot).toBe('skipped');
    expect('hint' in out).toBe(false);
    expect(out).toMatchObject({ passed: 0, returned: 0, retryLater: 3 });
    expect(out.tomorrow).toMatchObject({ capped: false });
  });

  it('答了題:snapshot 是 committed(learning/ 是 git repo、有變更);passed 與 returned 數對;沒續答就沒有 answeredThisRun', async () => {
    const r = await rig({ git: true });
    ok(await r.send('start'));
    const q1 = ok(await r.send('next'));
    ok(await r.send('submit', { fill: rightFill(r.v, q1.card as string) }));
    const q2 = ok(await r.send('next'));
    ok(await r.send('submit', { fill: ['錯', '錯', '錯'].slice(0, rightFill(r.v, q2.card as string).length) }));
    const out = ok(await r.send('summary'));
    expect(out).toMatchObject({ passed: 1, returned: 1, retryLater: 1, snapshot: 'committed' });
    expect('answeredThisRun' in out).toBe(false);
    expect('hint' in out).toBe(false);
  });

  it('續答後的小結帶 answeredThisRun(只算這一次執行答的)', async () => {
    const r = await rig({ git: true });
    ok(await r.send('start'));
    const q1 = ok(await r.send('next'));
    ok(await r.send('submit', { fill: rightFill(r.v, q1.card as string) }));
    ok(await r.send('start'));
    const q2 = ok(await r.send('next'));
    ok(await r.send('submit', { fill: rightFill(r.v, q2.card as string) }));
    expect(ok(await r.send('summary'))).toMatchObject({ passed: 2, answeredThisRun: 1 });
  });

  it('批改失敗那一題也算「這一次答了」(使用者答了):summary 會 snapshot', async () => {
    const r = await rig({ git: true, entries: { 'sec-0003': { stage: 3, overdue: 1 } } });
    ok(await r.send('start'));
    ok(await r.send('next'));
    ok(await r.send('submit', { apply: 'GARBAGE' }));
    const out = ok(await r.send('summary'));
    expect(['committed', 'no-changes']).toContain(out.snapshot);
    expect(out.snapshot).not.toBe('skipped');
  });
});

describe('紀錄被改過(T26)(驗收 4)', () => {
  it('start 之後、最後一題 submit 之前 reviews.json 被別處改了:review-record-changed(T26 全文)、不寫、丟掉 session', async () => {
    const r = await rig();
    ok(await r.send('start'));
    const q = ok(await r.send('next'));
    // 別處(例如終端機)改了另一張卡的紀錄
    const reviews = readReviews(r.v);
    reviews['sec-0002'] = { ...reviews['sec-0002']!, history: [{ date: TODAY, stage: 1, type: 'fill', pass: true, grader: 'exact' }] };
    writeReviews(r.v, reviews);
    const changed = bytes(r.v);

    const e = err(await r.send('submit', { fill: rightFill(r.v, q.card as string) }));
    expect(e.kind).toBe('review-record-changed');
    expect(e.message).toBe('複習紀錄剛被別的地方改過,請重新開始今天的複習。剛才那一題需要重答。');
    expect(e.message).toBe((await messages())['review-record-changed']);
    expect(bytes(r.v), 'reviews.json 逐位元等於別處改過的那一份').toBe(changed);

    for (const method of ['next', 'summary'] as const) {
      expect(err(await r.send(method)).kind, `${method} 要重新 start`).toBe('no-session');
    }
    expect(err(await r.send('submit', { fill: ['a'] })).kind).toBe('no-session');
  });

  it('重新 start 之後可以繼續:被拒絕的那一題再問一次,答了就寫進去', async () => {
    const r = await rig();
    ok(await r.send('start'));
    const q = ok(await r.send('next'));
    const reviews = readReviews(r.v);
    reviews['sec-0002'] = { ...reviews['sec-0002']!, history: [{ date: TODAY, stage: 1, type: 'fill', pass: true, grader: 'exact' }] };
    writeReviews(r.v, reviews);
    expect(err(await r.send('submit', { fill: rightFill(r.v, q.card as string) })).kind).toBe('review-record-changed');

    ok(await r.send('start'));
    const again = ok(await r.send('next'));
    expect(again.card, '被拒絕的那一題沒存,再問一次').toBe(q.card);
    expect(ok(await r.send('submit', { fill: rightFill(r.v, q.card as string) })).status).toBe('passed');
    expect(readReviews(r.v)[q.card as string]!.stage).toBe(2);
  });

  it('前面幾題已經落地的不受影響:第二題被拒絕時,第一題的結果還在', async () => {
    const r = await rig();
    ok(await r.send('start'));
    const q1 = ok(await r.send('next'));
    ok(await r.send('submit', { fill: rightFill(r.v, q1.card as string) }));
    const q2 = ok(await r.send('next'));
    const reviews = readReviews(r.v);
    reviews['sec-0003'] = { ...reviews['sec-0003']!, total_fails: 9 };
    writeReviews(r.v, reviews);
    expect(err(await r.send('submit', { fill: rightFill(r.v, q2.card as string) })).kind).toBe('review-record-changed');
    expect(readReviews(r.v)[q1.card as string]!.stage).toBe(2);
    expect(readReviews(r.v)['sec-0003']!.total_fails).toBe(9);
  });

  it('同一個 session 連續答兩題、中間沒人改:不誤報(寫入後基準有更新)', async () => {
    const r = await rig();
    ok(await r.send('start'));
    for (let i = 0; i < 3; i += 1) {
      const q = ok(await r.send('next'));
      if (q.kind !== 'question') break;
      const out = q.type === 'fill' ? ok(await r.send('submit', { fill: rightFill(r.v, q.card as string) })) : ok(await r.send('submit', { apply: 'PASSALL' }));
      expect(out.status).toBe('passed');
    }
  });
});

describe('routerFactory 失敗之後(工單驗收 9 補記)', () => {
  it('第一次 start 的 routerFactory 失敗:回錯誤,沒有 router;下一次 start 再呼叫 routerFactory,成功就正常開始', async () => {
    const v = createVault({ cards: 4 });
    vaults.push(v);
    seed(v, { 'sec-0001': { stage: 1, overdue: 1 } });
    let calls = 0;
    const router = fakeRouter();
    const mod = (await import(/* @vite-ignore */ HANDLER)) as { createReviewHandler(d: Deps): Handler };
    const handler = mod.createReviewHandler({
      learningDir: v.dir,
      today: TODAY,
      routerFactory: () => {
        calls += 1;
        if (calls === 1) throw new Error('帳本身分驗不過');
        return router;
      },
      env: envOf(v),
    });
    const send = async (method: string): Promise<Obj> => JSON.parse(await handler(JSON.stringify({ v: 1, id: calls + 10, method, params: {} }))) as Obj;
    const first = await send('start');
    expect(first.ok).toBe(false);
    expect(calls).toBe(1);
    expect(err(await send('next')).kind, '沒有 session').toBe('no-session');
    const second = await send('start');
    expect(second.ok, JSON.stringify(second)).toBe(true);
    expect(calls, '失敗之後下一次 start 要再叫 routerFactory').toBe(2);
    expect(ok(second)).toMatchObject({ state: 'ready' });
  });
});

describe('其他例外一律是 internal,原文不出去(驗收 4)', () => {
  it('reviews.json 壞掉:start 回 internal 與固定句子;回應裡沒有例外原文、路徑、stack', async () => {
    const r = await rig();
    mkdirSync(join(r.v.dir, 'state'), { recursive: true });
    writeFileSync(reviewsPath(r.v), '{ 這不是 JSON', 'utf8');
    const res = await r.send('start');
    expect(err(res)).toEqual({ kind: 'internal', message: (await messages())['internal'] });
    const text = JSON.stringify(res);
    for (const leak of ['SyntaxError', 'JSON', r.v.dir, 'reviews.json', 'at ', 'node_modules', 'Unexpected']) expect(text, leak).not.toContain(leak);
  });

  it('routerFactory 丟錯:回應只有固定句子,金鑰樣子的字串不出現', async () => {
    const v = createVault({ cards: 4 });
    vaults.push(v);
    seed(v, { 'sec-0001': { stage: 1, overdue: 1 } });
    const mod = (await import(/* @vite-ignore */ HANDLER)) as { createReviewHandler(d: Deps): Handler };
    const handler = mod.createReviewHandler({
      learningDir: v.dir,
      today: TODAY,
      routerFactory: () => {
        throw new Error('401 invalid key sk-proj-ABCDEFGHIJKLMNOP at /home/someone/.env');
      },
      env: envOf(v),
    });
    const res = JSON.parse(await handler(JSON.stringify({ v: 1, id: 1, method: 'start', params: {} }))) as Obj;
    expect(res.ok).toBe(false);
    const text = JSON.stringify(res);
    expect(text).not.toContain('sk-');
    expect(text).not.toContain('/home/');
    expect(text).not.toContain('401');
    expect(['internal', 'router-unavailable']).toContain((res.error as Obj).kind);
  });
});
