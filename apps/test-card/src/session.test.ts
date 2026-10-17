/**
 * T24 驗收 2、3、4(`docs/tickets/T24-test-card-phase-2.md`):`TestSession` 改吃 `ReviewClient`。
 * 紅測試作者寫;開發 worker 不改。
 *
 * 這份測試用「假的 ReviewClient」(記下每次呼叫與參數)與「假的 fs」,一列一列對工單的表。
 * 不起行程、不碰真的 learning/、不打網路。程序內跑真的 core 那一層在 `session-core.test.ts`。
 *
 * 工單沒有定死 `getView()` 的欄位名,這份測試固定它們(開發 worker 照這個做,要改由我改):
 *
 *   state            'loading' | 'paused' | 'empty' | 'question' | 'reteach' | 'done' | 'error'
 *   message          paused / empty / done / error 時畫面上那段主文字(其他狀態 undefined)
 *   canRestart       error 狀態有沒有「重新開始」(按了 = 再呼叫一次 init())
 *   testModeNotice   start 回 fakeCloud true 才有:'測試模式:批改是假的';false 或還沒 start 時 undefined
 *   answeredCount    question 狀態的已答數 = progress.index - 1;其他狀態 0(T15 的靜態檢查要 App.svelte 寫 view.answeredCount)
 *   totalCount       question 狀態的總數 = progress.total;其他狀態 0
 *   current          { card, type, stage, prompt, blanks, stuck, overdueDays } —— question 狀態才有;
 *                    apply 題 blanks = 0
 *   submitting       送出中 true
 *   gradingError     批改回 status error 時 '評分失敗,請再試一次',其他時候 undefined
 *   result           { status, pass, feedback, cardDone, correctAnswers? } —— 送出得到 passed / failed / partial 後
 *                    有值,直到按「下一題」;error 時 undefined
 *   reteach          { card, text, notice } —— reteach 狀態才有;text 是去掉 frontmatter 的純文字;
 *                    notice 只有 short 為 false 時有那句說明,否則 undefined
 *
 * 方法:`init()`、`next()`(「下一題」與 reteach 的「繼續」共用)、`submitFill(string[])`、`submitApply(string)`、
 * `decideKeydown(key, mods)`(照 phase-1)。
 *
 * session.ts 是 T24 要改的檔:用算出來的 file URL 動態 import,基底上是「欄位 / 方法還沒有」而紅,不是 tsc 錯。
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

type Obj = Record<string, unknown>;

// 桌面殼的 ReviewError(真的那個類別)。用算出來的 file URL 動態 import:測試檔不新增 06 → 10 的靜態 import
// (那條邊是 T24 的實作加進 boundaries.allow.json 的),基底上 npm run boundaries 不因這個檔而紅。
const REVIEW_CLIENT = pathToFileURL(join(import.meta.dirname, '../../desktop/src/webview/review-client.ts')).href;
const { ReviewError } = (await import(/* @vite-ignore */ REVIEW_CLIENT)) as { ReviewError: new (kind: string, message: string) => Error & { kind: string } };

interface View {
  state: string;
  message: string | undefined;
  canRestart: boolean;
  testModeNotice: string | undefined;
  answeredCount: number;
  totalCount: number;
  current: { card: string; type: 'fill' | 'apply'; stage: number; prompt: string; blanks: number; stuck: boolean; overdueDays: number } | undefined;
  submitting: boolean;
  gradingError: string | undefined;
  result: { status: string; pass: boolean | null; feedback: string; cardDone: boolean; correctAnswers?: string[] } | undefined;
  reteach: { card: string; text: string; notice: string | undefined } | undefined;
}

interface Session {
  init(): Promise<void>;
  next(): Promise<void>;
  submitFill(answers: string[]): Promise<void>;
  submitApply(text: string): Promise<void>;
  decideKeydown(key: string, mods?: { ctrl?: boolean; meta?: boolean }): 'submit' | 'newline' | 'ignore';
  getView(): View;
}

interface Client {
  start(): Promise<Obj>;
  next(): Promise<Obj>;
  submit(answer: { fill: string[] } | { apply: string }): Promise<Obj>;
  summary(): Promise<Obj>;
  status(): Promise<Obj>;
}
interface Fs {
  read(relPath: string): Promise<string>;
}

const SESSION = pathToFileURL(join(import.meta.dirname, 'session.ts')).href;
async function create(client: Client, fs: Fs): Promise<Session> {
  const mod = (await import(/* @vite-ignore */ SESSION)) as { TestSession: new (deps: { client: Client; fs: Fs }) => Session };
  return new mod.TestSession({ client, fs });
}

// ---------------------------------------------------------------- 假的 client

type Step = Obj | Error | (() => Promise<Obj>);
interface Call {
  method: string;
  arg?: unknown;
}
interface Fake {
  client: Client;
  calls: Call[];
  count(method: string): number;
}
/** script:每個方法一串結果(依序用);用完還被呼叫就丟錯,不靜默回東西。 */
function fakeClient(script: Partial<Record<'start' | 'next' | 'submit' | 'summary' | 'status', Step[]>>): Fake {
  const calls: Call[] = [];
  const queues = new Map<string, Step[]>(Object.entries(script).map(([k, v]) => [k, [...(v ?? [])]]));
  const run = (method: string, arg?: unknown): Promise<Obj> => {
    calls.push(arg === undefined ? { method } : { method, arg });
    const step = queues.get(method)?.shift();
    if (step === undefined) return Promise.reject(new Error(`假 client 沒有預期到第 ${calls.filter((c) => c.method === method).length} 次 ${method}`));
    if (step instanceof Error) return Promise.reject(step);
    if (typeof step === 'function') return step();
    return Promise.resolve(step);
  };
  const client: Client = {
    start: () => run('start'),
    next: () => run('next'),
    submit: (answer) => run('submit', answer),
    summary: () => run('summary'),
    status: () => run('status'),
  };
  return { client, calls, count: (m) => calls.filter((c) => c.method === m).length };
}

function fakeFs(files: Record<string, string> = {}): Fs & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async read(relPath: string): Promise<string> {
      reads.push(relPath);
      const text = files[relPath];
      if (text === undefined) throw new Error(`假 fs 沒有 ${relPath}`);
      return text;
    },
  };
}

const START_READY: Obj = { state: 'ready', today: '2026-09-10', resumed: false, total: 5, answered: 0, deferred: 0, dailyCap: 10, fakeCloud: false };
const start = (over: Obj = {}): Obj => ({ ...START_READY, ...over });
const fillQ = (over: Obj = {}): Obj => ({
  kind: 'question',
  card: 'sec-0001',
  stage: 1,
  type: 'fill',
  prompt: '同源是 ___ 加 ___ 加 ___ 都相同',
  progress: { index: 1, total: 5 },
  stuck: false,
  overdueDays: 2,
  blanks: 3,
  ...over,
});
const applyQ = (over: Obj = {}): Obj => ({
  kind: 'question',
  card: 'sec-0002',
  stage: 3,
  type: 'apply',
  prompt: '說明 CORS 為什麼存在',
  progress: { index: 2, total: 5 },
  stuck: true,
  overdueDays: 0,
  ...over,
});
const graded = (over: Obj = {}): Obj => ({ status: 'passed', pass: true, feedback: '答對了', cardDone: true, newStage: 2, ...over });

async function ready(script: Parameters<typeof fakeClient>[0], files: Record<string, string> = {}): Promise<{ s: Session; f: Fake; fs: ReturnType<typeof fakeFs> }> {
  const f = fakeClient(script);
  const fs = fakeFs(files);
  const s = await create(f.client, fs);
  return { s, f, fs };
}

// ---------------------------------------------------------------- init:start 的三種狀態

describe('init():start 的結果(驗收 2 第一列)', () => {
  it('ready:呼叫 start 一次、再呼叫 next 一次,畫面是題目', async () => {
    const { s, f } = await ready({ start: [start()], next: [fillQ()] });
    await s.init();
    expect(f.calls.map((c) => c.method)).toEqual(['start', 'next']);
    expect(s.getView().state).toBe('question');
    expect(s.getView().current?.card).toBe('sec-0001');
  });

  it('paused:畫面是暫停、只有一句話(含 --unpause),不呼叫 next', async () => {
    const { s, f } = await ready({ start: [start({ state: 'paused' })] });
    await s.init();
    expect(f.calls.map((c) => c.method)).toEqual(['start']);
    const v = s.getView();
    expect(v.state).toBe('paused');
    expect(v.message).toContain('今天已暫停');
    expect(v.message).toContain('scripts/review.ts');
    expect(v.message).toContain('--unpause');
    expect(v.current).toBeUndefined();
  });

  it('empty:畫面是「今天沒有到期」,不呼叫 next,沒有題目', async () => {
    const { s, f } = await ready({ start: [start({ state: 'empty', total: 0 })] });
    await s.init();
    expect(f.calls.map((c) => c.method)).toEqual(['start']);
    const v = s.getView();
    expect(v.state).toBe('empty');
    expect(v.message).toContain('今天沒有到期');
    expect(v.current).toBeUndefined();
  });

  it('init 之前的畫面是 loading', async () => {
    const { s } = await ready({});
    expect(s.getView().state).toBe('loading');
  });
});

// ---------------------------------------------------------------- 題目與 header

describe('題目的畫面(驗收 2 第二列、header)', () => {
  it('填空:輸入格數 = blanks,題目欄位原樣帶出', async () => {
    const { s } = await ready({ start: [start()], next: [fillQ({ blanks: 3, stage: 1, stuck: false, overdueDays: 2 })] });
    await s.init();
    expect(s.getView().current).toEqual({
      card: 'sec-0001',
      type: 'fill',
      stage: 1,
      prompt: '同源是 ___ 加 ___ 加 ___ 都相同',
      blanks: 3,
      stuck: false,
      overdueDays: 2,
    });
  });

  it('應用題:blanks 是 0,stuck 與 overdueDays 照 next 的值', async () => {
    const { s } = await ready({ start: [start()], next: [applyQ()] });
    await s.init();
    expect(s.getView().current).toEqual({ card: 'sec-0002', type: 'apply', stage: 3, prompt: '說明 CORS 為什麼存在', blanks: 0, stuck: true, overdueDays: 0 });
  });

  it.each([
    [1, 5, 0],
    [2, 5, 1],
    [5, 5, 4],
    [3, 7, 2],
  ])('header:progress index %i / total %i → 已答 %i(index - 1,不是 index)', async (index, total, answered) => {
    const { s } = await ready({ start: [start({ total })], next: [fillQ({ progress: { index, total } })] });
    await s.init();
    expect([s.getView().answeredCount, s.getView().totalCount]).toEqual([answered, total]);
  });

  it('送出之後、按下一題之前,header 不動(已答要等 next 的 progress)', async () => {
    const { s } = await ready({ start: [start()], next: [fillQ({ progress: { index: 2, total: 5 } })], submit: [graded()] });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    expect([s.getView().answeredCount, s.getView().totalCount]).toEqual([1, 5]);
  });

  it('題目換了,header 跟著 next 的新 progress 走', async () => {
    const { s } = await ready({
      start: [start()],
      next: [fillQ({ progress: { index: 1, total: 5 } }), applyQ({ progress: { index: 2, total: 5 } })],
      submit: [graded()],
    });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    await s.next();
    expect(s.getView().current?.card).toBe('sec-0002');
    expect([s.getView().answeredCount, s.getView().totalCount]).toEqual([1, 5]);
  });
});

describe('Enter / Ctrl+Enter 的規則照 phase-1(decideKeydown)', () => {
  it('填空:Enter 送出;其他鍵忽略', async () => {
    const { s } = await ready({ start: [start()], next: [fillQ()] });
    await s.init();
    expect(s.decideKeydown('Enter')).toBe('submit');
    expect(s.decideKeydown('a')).toBe('ignore');
  });

  it('應用題:Enter 換行;Ctrl 或 Meta + Enter 送出', async () => {
    const { s } = await ready({ start: [start()], next: [applyQ()] });
    await s.init();
    expect(s.decideKeydown('Enter')).toBe('newline');
    expect(s.decideKeydown('Enter', { ctrl: true })).toBe('submit');
    expect(s.decideKeydown('Enter', { meta: true })).toBe('submit');
    expect(s.decideKeydown('x', { ctrl: true })).toBe('ignore');
  });

  it('沒有題目(暫停、結束)時一律忽略', async () => {
    const { s } = await ready({ start: [start({ state: 'paused' })] });
    await s.init();
    expect(s.decideKeydown('Enter')).toBe('ignore');
    expect(s.decideKeydown('Enter', { ctrl: true })).toBe('ignore');
  });
});

// ---------------------------------------------------------------- 測試模式標記

describe('測試模式標記(驗收 3,start 的 fakeCloud)', () => {
  it('fakeCloud true:有「測試模式:批改是假的」', async () => {
    const { s } = await ready({ start: [start({ fakeCloud: true })], next: [fillQ()] });
    await s.init();
    expect(s.getView().testModeNotice).toBe('測試模式:批改是假的');
  });

  it('fakeCloud false:沒有', async () => {
    const { s } = await ready({ start: [start({ fakeCloud: false })], next: [fillQ()] });
    await s.init();
    expect(s.getView().testModeNotice).toBeUndefined();
  });

  it('暫停的畫面也看得到標記(標記跟著 start,不跟著題目)', async () => {
    const { s } = await ready({ start: [start({ state: 'paused', fakeCloud: true })] });
    await s.init();
    expect(s.getView().testModeNotice).toBe('測試模式:批改是假的');
  });

  it('重新 init 以最新的 start 為準(true → false 標記消失)', async () => {
    const { s } = await ready({ start: [start({ fakeCloud: true }), start({ fakeCloud: false })], next: [fillQ(), fillQ()] });
    await s.init();
    expect(s.getView().testModeNotice).toBeDefined();
    await s.init();
    expect(s.getView().testModeNotice).toBeUndefined();
  });
});

// ---------------------------------------------------------------- 送出

describe('submitFill / submitApply(驗收 2)', () => {
  it('填空:陣列原樣送給 client.submit({ fill }),不接成字串;答案裡有逗號也原樣', async () => {
    const { s, f } = await ready({ start: [start()], next: [fillQ()], submit: [graded()] });
    await s.init();
    await s.submitFill(['a,b', ' c ', '']);
    const submits = f.calls.filter((c) => c.method === 'submit');
    expect(submits).toHaveLength(1);
    expect(submits[0]!.arg).toEqual({ fill: ['a,b', ' c ', ''] });
    expect(Array.isArray((submits[0]!.arg as { fill: unknown }).fill)).toBe(true);
  });

  it('應用題:client.submit({ apply: 原文 }),換行與前後空白原樣', async () => {
    const { s, f } = await ready({ start: [start()], next: [applyQ()], submit: [graded()] });
    await s.init();
    await s.submitApply('第一行\n  第二行,有逗號 \n');
    expect(f.calls.find((c) => c.method === 'submit')!.arg).toEqual({ apply: '第一行\n  第二行,有逗號 \n' });
  });

  it('送出中:submitting 為 true;結束後為 false', async () => {
    let release: (v: Obj) => void = () => undefined;
    const pending = new Promise<Obj>((res) => {
      release = res;
    });
    const { s } = await ready({ start: [start()], next: [fillQ()], submit: [() => pending] });
    await s.init();
    const inFlight = s.submitFill(['a', 'b', 'c']);
    expect(s.getView().submitting).toBe(true);
    release(graded());
    await inFlight;
    expect(s.getView().submitting).toBe(false);
  });

  it('passed:顯示結果(pass、feedback、cardDone),題目還在、等「下一題」,不呼叫 next', async () => {
    const { s, f } = await ready({ start: [start()], next: [fillQ()], submit: [graded({ feedback: '答對了' })] });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    const v = s.getView();
    expect(v.result).toMatchObject({ status: 'passed', pass: true, feedback: '答對了', cardDone: true });
    expect(v.gradingError).toBeUndefined();
    expect(v.current?.card).toBe('sec-0001');
    expect(f.count('next')).toBe(1);
  });

  it('failed 的填空有 correctAnswers:原樣帶到 result,給畫面顯示「正確答案」', async () => {
    const { s } = await ready({
      start: [start()],
      next: [fillQ()],
      submit: [graded({ status: 'failed', pass: false, feedback: '不對', correctAnswers: ['協定', '主機', '埠號'] })],
    });
    await s.init();
    await s.submitFill(['x', 'y', 'z']);
    expect(s.getView().result?.correctAnswers).toEqual(['協定', '主機', '埠號']);
    expect(s.getView().result?.pass).toBe(false);
  });

  it('failed 的應用題沒有 correctAnswers:view 也沒有', async () => {
    const { s } = await ready({ start: [start()], next: [applyQ()], submit: [graded({ status: 'failed', pass: false, feedback: '少了一點', cardDone: true })] });
    await s.init();
    await s.submitApply('短');
    expect(s.getView().result?.correctAnswers).toBeUndefined();
  });

  it('「下一題」:result 清掉,呼叫 client.next 取同一輪的下一題', async () => {
    const { s, f } = await ready({ start: [start()], next: [fillQ(), applyQ()], submit: [graded()] });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    await s.next();
    expect(f.count('next')).toBe(2);
    expect(s.getView().result).toBeUndefined();
    expect(s.getView().current?.card).toBe('sec-0002');
  });

  it('partial(同一張卡還有第二題):顯示這一題的結果;按下一題呼叫 client.next,不是 summary', async () => {
    const { s, f } = await ready({
      start: [start()],
      next: [fillQ({ stage: 2 }), applyQ({ card: 'sec-0001', stage: 2, progress: { index: 1, total: 5 } })],
      submit: [graded({ status: 'partial', cardDone: false, newStage: undefined })],
    });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    expect(s.getView().result).toMatchObject({ status: 'partial', cardDone: false });
    await s.next();
    expect(f.count('next')).toBe(2);
    expect(f.count('summary')).toBe(0);
    expect(s.getView().current).toMatchObject({ card: 'sec-0001', type: 'apply' });
  });
});

describe('批改失敗題目留在原地(驗收 2 的 error 列)', () => {
  const errorResult = (): Obj => ({ status: 'error', pass: null, feedback: '掛了', cardDone: false });

  it('回 status error:顯示「評分失敗,請再試一次」,題目、header 不動,沒有 result,不換題', async () => {
    const { s, f } = await ready({ start: [start()], next: [fillQ({ progress: { index: 3, total: 5 } })], submit: [errorResult()] });
    await s.init();
    const before = s.getView().current;
    await s.submitFill(['a', 'b', 'c']);
    const v = s.getView();
    expect(v.gradingError).toBe('評分失敗,請再試一次');
    expect(v.result).toBeUndefined();
    expect(v.state).toBe('question');
    expect(v.current).toEqual(before);
    expect([v.answeredCount, v.totalCount]).toEqual([2, 5]);
    expect(v.submitting).toBe(false);
    expect(f.count('next')).toBe(1);
  });

  it('error 之後可以再送:第二次一樣呼叫 client.submit(不是 start、不是 next),成功後 gradingError 消失', async () => {
    const { s, f } = await ready({ start: [start()], next: [applyQ()], submit: [errorResult(), graded()] });
    await s.init();
    await s.submitApply('我的答案');
    await s.submitApply('我的答案');
    expect(f.calls.map((c) => c.method)).toEqual(['start', 'next', 'submit', 'submit']);
    expect(f.calls[3]!.arg).toEqual({ apply: '我的答案' });
    expect(s.getView().gradingError).toBeUndefined();
    expect(s.getView().result?.status).toBe('passed');
  });

  it('連續 error:每次都留在原地、不累積成別的狀態', async () => {
    const { s } = await ready({ start: [start()], next: [fillQ()], submit: [errorResult(), errorResult(), errorResult()] });
    await s.init();
    for (let i = 0; i < 3; i += 1) {
      await s.submitFill(['a', 'b', 'c']);
      expect(s.getView().state).toBe('question');
      expect(s.getView().gradingError).toBe('評分失敗,請再試一次');
    }
  });
});

// ---------------------------------------------------------------- done

describe('做完要叫 summary(驗收 2 的 done 列)', () => {
  it('next 回 done:呼叫 client.summary 一次、畫面 done、文字「今天的複習都做完了。」', async () => {
    const { s, f } = await ready({
      start: [start()],
      next: [fillQ(), { kind: 'done' }],
      submit: [graded()],
      summary: [{ passed: 1, returned: 0, retryLater: 0, tomorrow: 2, snapshot: 'committed' }],
    });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    await s.next();
    expect(f.calls.map((c) => c.method)).toEqual(['start', 'next', 'submit', 'next', 'summary']);
    const v = s.getView();
    expect(v.state).toBe('done');
    expect(v.message).toBe('今天的複習都做完了。');
    expect(v.current).toBeUndefined();
  });

  it('第一個 next 就是 done(續答到底):一樣要 summary', async () => {
    const { s, f } = await ready({ start: [start()], next: [{ kind: 'done' }], summary: [{ passed: 0, returned: 0, retryLater: 0, tomorrow: 0, snapshot: 'none' }] });
    await s.init();
    expect(f.count('summary')).toBe(1);
    expect(s.getView().state).toBe('done');
  });

  it('看畫面(getView)不會再叫 summary;summary 只在 done 那一刻叫一次', async () => {
    const { s, f } = await ready({ start: [start()], next: [{ kind: 'done' }], summary: [{ passed: 0, returned: 0, retryLater: 0, tomorrow: 0, snapshot: 'none' }] });
    await s.init();
    s.getView();
    s.getView();
    expect(f.count('summary')).toBe(1);
  });

  it('summary 失敗:不卡住,走錯誤畫面(複習程式停了、可重新開始)', async () => {
    const { s } = await ready({ start: [start()], next: [{ kind: 'done' }], summary: [new ReviewError('sidecar-exited', 'x')] });
    await s.init();
    expect(s.getView().state).toBe('error');
    expect(s.getView().message).toContain('複習程式停了');
    expect(s.getView().canRestart).toBe(true);
  });
});

// ---------------------------------------------------------------- reteach

const SHORT_PATH = 'cards/security/sec-0001.short.md';
const FULL_PATH = 'cards/security/sec-0001.md';
const SHORT_NOTICE = '這張卡連續答錯兩次;縮短版還沒有產生,先看原卡。';

describe('reteach:經 LearningFs 讀檔,純文字顯示,「繼續」再 next(驗收 2)', () => {
  const reteach = (over: Obj = {}): Obj => ({ kind: 'reteach', card: 'sec-0001', path: SHORT_PATH, short: true, ...over });

  it('讀的是 next 給的 path(剛好一次),不經 client、不 fetch;畫面是 reteach,有那張卡', async () => {
    const { s, f, fs } = await ready({ start: [start()], next: [reteach()] }, { [SHORT_PATH]: '同源指協定、主機、埠號三者相同。' });
    await s.init();
    expect(fs.reads).toEqual([SHORT_PATH]);
    expect(f.calls.map((c) => c.method)).toEqual(['start', 'next']);
    expect(s.getView().state).toBe('reteach');
    expect(s.getView().reteach?.card).toBe('sec-0001');
    expect(s.getView().reteach?.text).toContain('同源指協定');
  });

  it('開頭的 frontmatter 去掉(第一行 --- 到下一個只有 --- 的行),其餘原樣', async () => {
    const file = '---\nid: sec-0001\ntitle: 同源\n---\n\n第一段正文\n\n第二段正文\n';
    const { s } = await ready({ start: [start()], next: [reteach()] }, { [SHORT_PATH]: file });
    await s.init();
    const text = s.getView().reteach!.text;
    expect(text).not.toContain('id: sec-0001');
    expect(text).not.toContain('title: 同源');
    expect(text.startsWith('---')).toBe(false);
    expect(text).toContain('第一段正文');
    expect(text).toContain('第二段正文');
  });

  it('只去掉第一組:內文裡後來的 --- 行要留著', async () => {
    const file = '---\nid: a\n---\n上\n---\n下\n';
    const { s } = await ready({ start: [start()], next: [reteach()] }, { [SHORT_PATH]: file });
    await s.init();
    const text = s.getView().reteach!.text;
    expect(text).toContain('上');
    expect(text).toContain('下');
    expect(text.split('\n').filter((l) => l === '---')).toHaveLength(1);
  });

  it('第一行不是 --- 就整份都是正文(不亂切)', async () => {
    const file = '標題\n---\n這行像分隔線,但第一行不是 ---\n';
    const { s } = await ready({ start: [start()], next: [reteach()] }, { [SHORT_PATH]: file });
    await s.init();
    expect(s.getView().reteach!.text).toContain('標題');
    expect(s.getView().reteach!.text).toContain('這行像分隔線');
  });

  it('內容是純文字:HTML 標籤原樣保留在 text(畫面不用 innerHTML,所以不會變成標籤)', async () => {
    const file = '---\nid: a\n---\n<b>粗體</b> <img src=x onerror=alert(1)>\n';
    const { s } = await ready({ start: [start()], next: [reteach()] }, { [SHORT_PATH]: file });
    await s.init();
    expect(s.getView().reteach!.text).toContain('<b>粗體</b>');
    expect(s.getView().reteach!.text).toContain('<img src=x onerror=alert(1)>');
  });

  it('short true:沒有「先看原卡」的說明', async () => {
    const { s } = await ready({ start: [start()], next: [reteach({ short: true })] }, { [SHORT_PATH]: '內容' });
    await s.init();
    expect(s.getView().reteach!.notice).toBeUndefined();
  });

  it('short false:讀的是原卡的 path,畫面上有那句說明', async () => {
    const { s, fs } = await ready({ start: [start()], next: [reteach({ path: FULL_PATH, short: false })] }, { [FULL_PATH]: '---\nid: sec-0001\n---\n原卡正文\n' });
    await s.init();
    expect(fs.reads).toEqual([FULL_PATH]);
    expect(s.getView().reteach!.notice).toBe(SHORT_NOTICE);
    expect(s.getView().reteach!.text).toContain('原卡正文');
  });

  it('「繼續」(next):再呼叫 client.next,拿到題目;reteach 消失;沒有 submit', async () => {
    const { s, f } = await ready({ start: [start()], next: [reteach(), fillQ()] }, { [SHORT_PATH]: '內容' });
    await s.init();
    await s.next();
    expect(f.calls.map((c) => c.method)).toEqual(['start', 'next', 'next']);
    expect(s.getView().state).toBe('question');
    expect(s.getView().reteach).toBeUndefined();
    expect(s.getView().current?.card).toBe('sec-0001');
  });

  it('讀檔失敗:不卡住,走「複習程式停了」且不露出例外原文', async () => {
    const { s } = await ready({ start: [start()], next: [reteach()] }, {});
    await s.init();
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain('複習程式停了');
    expect(v.message).not.toContain('假 fs');
  });
});

// ---------------------------------------------------------------- 錯誤

const STOPPED = '複習程式停了。';
const VAULT_HINT = 'npx tsx scripts/vault.ts show';

describe('側車錯誤:畫面不卡住(驗收 4)', () => {
  it('no-cards:說掃描到 0 張卡,不能說「今天沒有到期」(P-28)', async () => {
    const { s } = await ready({ start: [new ReviewError('no-cards', '卡片目錄裡沒有任何卡片。')] });
    await s.init();
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain('掃描到 0 張卡');
    expect(v.message).toContain('這個 learning 資料夾沒有卡片');
    expect(v.message).not.toContain('今天沒有到期');
    expect(v.current).toBeUndefined();
  });

  it('router-unavailable:帳本身分驗不過、請執行 vault.ts show', async () => {
    const { s } = await ready({ start: [new ReviewError('router-unavailable', '帳本現在無法使用。')] });
    await s.init();
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain('帳本身分驗不過,批改不能用');
    expect(v.message).toContain(VAULT_HINT);
  });

  it('paused(ReviewError,例如別處先暫停了):跟 start 回 paused 同一句話', async () => {
    const viaStart = await ready({ start: [start({ state: 'paused' })] });
    await viaStart.s.init();
    const viaError = await ready({ start: [start()], next: [new ReviewError('paused', '今天已暫停。')] });
    await viaError.s.init();
    expect(viaError.s.getView().message).toBe(viaStart.s.getView().message);
    expect(viaError.s.getView().message).toContain('--unpause');
    expect(viaError.s.getView().current).toBeUndefined();
  });

  it('review-record-changed:顯示全文與「重新開始」;沒有 result,不假裝記下了', async () => {
    const full = '複習紀錄剛被別的地方改過,請重新開始今天的複習。剛才那一題需要重答。';
    const { s } = await ready({ start: [start()], next: [applyQ()], submit: [new ReviewError('review-record-changed', full)] });
    await s.init();
    await s.submitApply('我的答案');
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain(full);
    expect(v.canRestart).toBe(true);
    expect(v.result).toBeUndefined();
    expect(v.submitting).toBe(false);
  });

  it('review-record-changed 的訊息用 ReviewError.message 原文(不寫死在畫面裡)', async () => {
    const { s } = await ready({ start: [start()], next: [applyQ()], submit: [new ReviewError('review-record-changed', '原文-ZETA')] });
    await s.init();
    await s.submitApply('x');
    expect(s.getView().message).toContain('原文-ZETA');
  });

  it('review-record-changed 按「重新開始」(init):重新 start,再出題;不會直接 next', async () => {
    const full = '複習紀錄剛被別的地方改過,請重新開始今天的複習。剛才那一題需要重答。';
    const { s, f } = await ready({
      start: [start(), start({ resumed: true, answered: 1 })],
      next: [applyQ(), applyQ()],
      submit: [new ReviewError('review-record-changed', full)],
    });
    await s.init();
    await s.submitApply('x');
    await s.init();
    expect(f.calls.map((c) => c.method)).toEqual(['start', 'next', 'submit', 'start', 'next']);
    expect(s.getView().state).toBe('question');
    expect(s.getView().message).toBeUndefined();
    expect(s.getView().canRestart).toBe(false);
  });

  it.each(['root-mismatch', 'not-configured'])('%s:顯示 ReviewError.message 原文加 vault.ts show,不給「重新開始」', async (kind) => {
    const { s } = await ready({ start: [new ReviewError(kind, `固定句-${kind}`)] });
    await s.init();
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain(`固定句-${kind}`);
    expect(v.message).toContain(VAULT_HINT);
    expect(v.message).not.toContain('複習程式停了');
    expect(v.canRestart).toBe(false);
  });

  it.each(['sidecar-exited', 'timeout', 'sidecar-unavailable', 'internal', 'busy', 'no-session', 'bad-response', 'no-question', 'totally-unknown-kind'])(
    '%s:「複習程式停了。」加「重新開始」,不露出 message 原文',
    async (kind) => {
      const { s } = await ready({ start: [start()], next: [fillQ()], submit: [new ReviewError(kind, 'RAW-STACK /home/someone/secret.ts:12')] });
      await s.init();
      await s.submitFill(['a', 'b', 'c']);
      const v = s.getView();
      expect(v.state).toBe('error');
      expect(v.message).toContain(STOPPED);
      expect(v.message).not.toContain('RAW-STACK');
      expect(v.message).not.toContain('secret');
      expect(v.canRestart).toBe(true);
      expect(v.submitting).toBe(false);
    },
  );

  it('不是 ReviewError 的例外(例如 TypeError):一樣是「複習程式停了。」,不露出例外原文', async () => {
    const { s } = await ready({ start: [new TypeError('Cannot read properties of undefined (reading x)')] });
    await s.init();
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain(STOPPED);
    expect(v.message).not.toContain('Cannot read');
    expect(v.canRestart).toBe(true);
  });

  it.each([
    ['start', 'sidecar-exited'],
    ['next', 'timeout'],
    ['submit', 'sidecar-unavailable'],
  ])('錯誤發生在 %s(%s):重新開始 = 從 start 重來,不是重送同一個 %s', async (where, kind) => {
    const script: Parameters<typeof fakeClient>[0] = {
      start: [start(), start({ resumed: true, answered: 1 })],
      next: [fillQ(), fillQ({ progress: { index: 2, total: 5 } })],
      submit: [graded()],
    };
    const err = new ReviewError(kind, 'x');
    if (where === 'start') script.start = [err, start()];
    if (where === 'next') script.next = [err, fillQ()];
    if (where === 'submit') script.submit = [err];
    const { s, f } = await ready(script);
    await s.init();
    if (where === 'submit') await s.submitFill(['a', 'b', 'c']);
    if (where === 'next') {
      expect(s.getView().state).toBe('error');
    }
    expect(s.getView().state).toBe('error');
    const startsBefore = f.count('start');
    await s.init();
    expect(f.count('start')).toBe(startsBefore + 1);
    if (where === 'submit') expect(f.count('submit')).toBe(1);
    expect(s.getView().state).toBe('question');
  });

  it('側車停了之後按「下一題」:顯示「複習程式停了」;重新開始後 header 是續答的已答 / 總數', async () => {
    const { s } = await ready({
      start: [start(), start({ resumed: true, answered: 2, total: 5 })],
      next: [fillQ(), new ReviewError('sidecar-exited', 'x'), fillQ({ progress: { index: 3, total: 5 } })],
      submit: [graded()],
    });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    await s.next();
    expect(s.getView().message).toContain(STOPPED);
    await s.init();
    expect([s.getView().answeredCount, s.getView().totalCount]).toEqual([2, 5]);
  });

  it('錯誤畫面不顯示 stack、原始 JSON 或例外原文', async () => {
    const { s } = await ready({ start: [start()], next: [new ReviewError('internal', '{"v":1,"ok":false} at Object.<anonymous> (file.ts:1:1)')] });
    await s.init();
    const text = JSON.stringify(s.getView().message);
    expect(text).not.toContain('"v"');
    expect(text).not.toContain('at Object');
    expect(text).not.toContain('file.ts');
  });

  it('錯誤時沒有殘留的題目、結果、reteach', async () => {
    const { s } = await ready({ start: [start()], next: [fillQ(), new ReviewError('sidecar-exited', 'x')], submit: [graded()] });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    await s.next();
    const v = s.getView();
    expect(v.current).toBeUndefined();
    expect(v.result).toBeUndefined();
    expect(v.reteach).toBeUndefined();
    expect([v.answeredCount, v.totalCount]).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------- 結果收窄

describe('結果收窄:缺必要欄位就當 bad-response(「複習程式停了」)(驗收 1)', () => {
  const stopped = (v: View): void => {
    expect(v.state).toBe('error');
    expect(v.message).toContain(STOPPED);
    expect(v.canRestart).toBe(true);
    expect(v.current).toBeUndefined();
  };

  it.each([
    ['空物件', {}],
    ['state 不認得', { ...START_READY, state: 'weird' }],
    ['缺 state', (() => { const { state: _state, ...rest } = START_READY; return rest; })()],
    ['缺 total', (() => { const { total: _total, ...rest } = START_READY; return rest; })()],
    ['total 不是數字', { ...START_READY, total: '5' }],
    ['缺 fakeCloud', (() => { const { fakeCloud: _fc, ...rest } = START_READY; return rest; })()],
    ['fakeCloud 不是布林', { ...START_READY, fakeCloud: 'yes' }],
    ['缺 answered', (() => { const { answered: _a, ...rest } = START_READY; return rest; })()],
  ])('start 的結果 %s', async (_name, result) => {
    const { s, f } = await ready({ start: [result as Obj] });
    await s.init();
    stopped(s.getView());
    expect(f.count('next')).toBe(0);
  });

  it.each([
    ['kind 不認得', { kind: 'weird' }],
    ['空物件', {}],
    ['question 缺 prompt', (() => { const { prompt: _p, ...rest } = fillQ(); return rest; })()],
    ['question 缺 card', (() => { const { card: _c, ...rest } = fillQ(); return rest; })()],
    ['question 缺 progress', (() => { const { progress: _p, ...rest } = fillQ(); return rest; })()],
    ['progress.index 不是數字', fillQ({ progress: { index: '1', total: 5 } })],
    ['progress 缺 total', fillQ({ progress: { index: 1 } })],
    ['填空缺 blanks', (() => { const { blanks: _b, ...rest } = fillQ(); return rest; })()],
    ['type 不是 fill / apply', fillQ({ type: 'essay' })],
    ['缺 stuck', (() => { const { stuck: _s, ...rest } = fillQ(); return rest; })()],
    ['缺 overdueDays', (() => { const { overdueDays: _o, ...rest } = fillQ(); return rest; })()],
    ['reteach 缺 short', { kind: 'reteach', card: 'sec-0001', path: SHORT_PATH }],
    ['reteach 缺 path', { kind: 'reteach', card: 'sec-0001', short: true }],
    ['reteach 的 short 不是布林', { kind: 'reteach', card: 'sec-0001', path: SHORT_PATH, short: 'true' }],
  ])('next 的結果 %s', async (_name, result) => {
    const { s, fs } = await ready({ start: [start()], next: [result as Obj] }, { [SHORT_PATH]: 'x' });
    await s.init();
    stopped(s.getView());
    expect(fs.reads).toEqual([]);
  });

  it('應用題不需要 blanks(沒有 blanks 是合法的 apply)', async () => {
    const { s } = await ready({ start: [start()], next: [applyQ()] });
    await s.init();
    expect(s.getView().state).toBe('question');
  });

  it.each([
    ['空物件', {}],
    ['status 不認得', graded({ status: 'maybe' })],
    ['缺 status', (() => { const { status: _s, ...rest } = graded(); return rest; })()],
    ['缺 feedback', (() => { const { feedback: _f, ...rest } = graded(); return rest; })()],
    ['缺 cardDone', (() => { const { cardDone: _c, ...rest } = graded(); return rest; })()],
    ['passed 但 pass 不是布林', graded({ pass: 'yes' })],
  ])('submit 的結果 %s', async (_name, result) => {
    const { s } = await ready({ start: [start()], next: [fillQ()], submit: [result as Obj] });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain(STOPPED);
    expect(v.result).toBeUndefined();
  });

  it('多出來的欄位不擋(只檢查必要欄位)', async () => {
    const { s } = await ready({ start: [start({ extra: 1 })], next: [fillQ({ extra: 2 })], submit: [graded({ extra: 3 })] });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    expect(s.getView().result?.status).toBe('passed');
  });

  it('error 結果的 pass 是 null 合法(批改失敗不是 bad-response)', async () => {
    const { s } = await ready({ start: [start()], next: [fillQ()], submit: [{ status: 'error', pass: null, feedback: '掛了', cardDone: false }] });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    expect(s.getView().gradingError).toBe('評分失敗,請再試一次');
    expect(s.getView().state).toBe('question');
  });
});

// ---------------------------------------------------------------- 不靠別的

describe('TestSession 只經 client 與 fs(驗收 2 的最後一條)', () => {
  it('整輪走完,fs 只有 reteach 才被讀;client 只被叫 start / next / submit / summary', async () => {
    const { s, f, fs } = await ready({
      start: [start()],
      next: [fillQ(), applyQ(), { kind: 'done' }],
      submit: [graded(), graded()],
      summary: [{ passed: 2, returned: 0, retryLater: 0, tomorrow: 1, snapshot: 'committed' }],
    });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    await s.next();
    await s.submitApply('答案');
    await s.next();
    expect(fs.reads).toEqual([]);
    expect(f.calls.map((c) => c.method)).toEqual(['start', 'next', 'submit', 'next', 'submit', 'next', 'summary']);
    expect(f.count('status')).toBe(0);
  });
});
