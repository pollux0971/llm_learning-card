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
 *   canRetry         error 狀態有沒有「再試一次」(啟動錯誤四種:no-cards、router-unavailable、root-mismatch、not-configured;按了 = 再呼叫一次 init(),從 start 開始)。
 *                    canRetry 與 canRestart 不會同時為 true;兩個都 false = 沒有按鈕(例如 paused / empty 的錯誤畫面以外的狀態)
 *   overdueCount     question 狀態的逾期數 = start 結果的 overdue(T23:一天之內固定,不是目前這張卡的 overdueDays);其他狀態 0
 *   summaryLines     done 狀態小結的句子(不含第一句「今天的複習都做完了。」,那句在 message):
 *                    「通過 {passed} 張、退回 {returned} 張。」→(retryLater > 0 才有)「另有 {retryLater} 題評分失敗,下次再考。」→
 *                    「明天預估 {shown} 張。」或(capped)「明天預估 {shown} 張(已到每天上限,另 {overflow} 張順延)。」;其他狀態 []
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
  canRetry: boolean;
  testModeNotice: string | undefined;
  answeredCount: number;
  totalCount: number;
  overdueCount: number;
  summaryLines: string[];
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

const START_READY: Obj = { state: 'ready', today: '2026-09-10', resumed: false, total: 5, answered: 0, deferred: 0, dailyCap: 10, overdue: 2, fakeCloud: false };
const summaryResult = (over: Obj = {}): Obj => ({
  passed: 3,
  returned: 2,
  retryLater: 0,
  tomorrow: { total: 6, capped: false, shown: 6, overflow: 0 },
  snapshot: 'committed',
  ...over,
});
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
      summary: [summaryResult({ passed: 1, returned: 0, tomorrow: { total: 2, capped: false, shown: 2, overflow: 0 } })],
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
    const { s, f } = await ready({ start: [start()], next: [{ kind: 'done' }], summary: [summaryResult({ passed: 0, returned: 0, tomorrow: { total: 0, capped: false, shown: 0, overflow: 0 }, snapshot: 'none' })] });
    await s.init();
    expect(f.count('summary')).toBe(1);
    expect(s.getView().state).toBe('done');
  });

  it('看畫面(getView)不會再叫 summary;summary 只在 done 那一刻叫一次', async () => {
    const { s, f } = await ready({ start: [start()], next: [{ kind: 'done' }], summary: [summaryResult({ passed: 0, returned: 0, tomorrow: { total: 0, capped: false, shown: 0, overflow: 0 }, snapshot: 'none' })] });
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
    expect(v.message).not.toContain('複習程式停了');
    expect(v.message).toContain('改好之後按「再試一次」。');
    expect(v.canRetry).toBe(true);
    expect(v.canRestart).toBe(false);
    expect(v.current).toBeUndefined();
  });

  it('router-unavailable:帳本身分驗不過、請執行 vault.ts show', async () => {
    const { s } = await ready({ start: [new ReviewError('router-unavailable', '帳本現在無法使用。')] });
    await s.init();
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain('帳本身分驗不過,批改不能用');
    expect(v.message).toContain(VAULT_HINT);
    expect(v.message).toContain('改好之後按「再試一次」。');
    expect(v.message).not.toContain('複習程式停了');
    expect(v.canRetry).toBe(true);
    expect(v.canRestart).toBe(false);
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
    expect(v.canRetry).toBe(false);
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

  it.each(['root-mismatch', 'not-configured'])('%s:顯示 ReviewError.message 原文加 vault.ts show 加「再試一次」,不顯示「複習程式停了」,沒有「重新開始」', async (kind) => {
    const { s } = await ready({ start: [new ReviewError(kind, `固定句-${kind}`)] });
    await s.init();
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain(`固定句-${kind}`);
    expect(v.message).toContain(VAULT_HINT);
    expect(v.message).toContain('改好之後按「再試一次」。');
    expect(v.message).not.toContain('複習程式停了');
    expect(v.canRetry).toBe(true);
    expect(v.canRestart).toBe(false);
  });

  it.each([
    ['no-cards', '卡片目錄裡沒有任何卡片。'],
    ['router-unavailable', '帳本現在無法使用。'],
    ['root-mismatch', '固定句-root-mismatch'],
    ['not-configured', '固定句-not-configured'],
  ])('%s:按「再試一次」(init)= 重新 start(不是 next / submit),改好之後出題', async (kind, msg) => {
    const { s, f } = await ready({ start: [new ReviewError(kind, msg), start()], next: [fillQ()] });
    await s.init();
    expect(s.getView().canRetry).toBe(true);
    await s.init();
    expect(f.calls.map((c) => c.method)).toEqual(['start', 'start', 'next']);
    const v = s.getView();
    expect(v.state).toBe('question');
    expect(v.message).toBeUndefined();
    expect(v.canRetry).toBe(false);
    expect(v.canRestart).toBe(false);
  });

  it.each(['no-cards', 'router-unavailable', 'root-mismatch', 'not-configured'])('%s:按了「再試一次」還是同一個錯 → 還在錯誤畫面、還有「再試一次」(不卡死、不跳成別的狀態)', async (kind) => {
    const { s, f } = await ready({ start: [new ReviewError(kind, 'a'), new ReviewError(kind, 'b')] });
    await s.init();
    await s.init();
    expect(f.count('start')).toBe(2);
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.canRetry).toBe(true);
    expect(v.message).not.toContain('複習程式停了');
  });

  it.each(['paused', 'sidecar-exited', 'timeout', 'sidecar-unavailable', 'internal', 'busy', 'no-session', 'bad-response', 'review-record-changed'])(
    '%s:不是啟動錯誤,沒有「再試一次」',
    async (kind) => {
      const { s } = await ready({ start: [start()], next: [fillQ()], submit: [new ReviewError(kind, 'x')] });
      await s.init();
      await s.submitFill(['a', 'b', 'c']);
      expect(s.getView().canRetry).toBe(false);
    },
  );

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
      summary: [summaryResult({ passed: 2, returned: 0, tomorrow: { total: 1, capped: false, shown: 1, overflow: 0 } })],
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

// ================================================================ T23(06 phase-3)

const STOPPED_TEXT = '複習程式停了。';

/** 走到錯誤畫面:複習程式停了、可重新開始、沒有再試一次(缺欄位的結果走 showStopped,不是 showError) */
function expectStopped(s: Session, label: string): void {
  const v = s.getView();
  expect(v.state, label).toBe('error');
  expect(v.message, label).toContain(STOPPED_TEXT);
  expect(v.canRestart, label).toBe(true);
  expect(v.canRetry, label).toBe(false);
}

// ---------------------------------------------------------------- 驗收 1:逾期數

describe('readStart 要求 overdue 是有限數字(驗收 1)', () => {
  it.each([
    ['缺', undefined],
    ['字串', '2'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
    ['布林', true],
  ])('overdue %s → 複習程式停了,不出題、不叫 next', async (_label, bad) => {
    const { s, f } = await ready({ start: [start({ overdue: bad })], next: [fillQ()] });
    await s.init();
    expectStopped(s, String(_label));
    expect(f.calls.map((c) => c.method)).toEqual(['start']);
    expect(s.getView().current).toBeUndefined();
  });

  it.each(['paused', 'empty'])('%s 的結果也要有 overdue(缺 → 複習程式停了)', async (state) => {
    const { s } = await ready({ start: [start({ state, overdue: undefined })] });
    await s.init();
    expectStopped(s, state);
  });

  it('overdue 是 0 合法(不是缺)', async () => {
    const { s } = await ready({ start: [start({ overdue: 0 })], next: [fillQ()] });
    await s.init();
    expect(s.getView().state).toBe('question');
    expect(s.getView().overdueCount).toBe(0);
  });
});

describe('header 的逾期數(驗收 1)', () => {
  it('overdueCount 是 start 的 overdue,不是目前這張卡的 overdueDays', async () => {
    const { s } = await ready({ start: [start({ overdue: 3 })], next: [fillQ({ overdueDays: 9 })] });
    await s.init();
    const v = s.getView();
    expect(v.overdueCount).toBe(3);
    expect(v.current!.overdueDays).toBe(9);
  });

  it('答一題、換下一題,逾期數都不變(每一題的 overdueDays 不同)', async () => {
    const { s } = await ready({
      start: [start({ overdue: 3 })],
      next: [fillQ({ overdueDays: 5 }), applyQ({ overdueDays: 0, progress: { index: 2, total: 5 } }), fillQ({ overdueDays: 1, progress: { index: 3, total: 5 } })],
      submit: [graded(), graded()],
    });
    await s.init();
    expect(s.getView().overdueCount).toBe(3);
    await s.submitFill(['a', 'b', 'c']);
    expect(s.getView().overdueCount).toBe(3);
    await s.next();
    expect(s.getView().overdueCount).toBe(3);
    await s.submitApply('x');
    await s.next();
    expect(s.getView().overdueCount).toBe(3);
    expect(s.getView().answeredCount).toBe(2);
  });

  it('逾期數 0 也是 0(不是 undefined、不是被省略)', async () => {
    const { s } = await ready({ start: [start({ overdue: 0 })], next: [fillQ({ overdueDays: 4 })] });
    await s.init();
    expect(s.getView().overdueCount).toBe(0);
  });

  it('重新 init(續答)用新的 start 結果的 overdue', async () => {
    const { s } = await ready({
      start: [start({ overdue: 4 }), start({ overdue: 7, resumed: true, answered: 1 })],
      next: [fillQ(), fillQ({ progress: { index: 2, total: 5 } })],
    });
    await s.init();
    expect(s.getView().overdueCount).toBe(4);
    await s.init();
    expect(s.getView().overdueCount).toBe(7);
    expect(s.getView().answeredCount).toBe(1);
  });

  it('不是題目狀態時 overdueCount 是 0(paused / empty / done / error)', async () => {
    const paused = await ready({ start: [start({ state: 'paused', overdue: 5 })] });
    await paused.s.init();
    expect(paused.s.getView().overdueCount).toBe(0);
    const empty = await ready({ start: [start({ state: 'empty', total: 0, overdue: 5 })] });
    await empty.s.init();
    expect(empty.s.getView().overdueCount).toBe(0);
    const done = await ready({ start: [start({ overdue: 5 })], next: [{ kind: 'done' }], summary: [summaryResult()] });
    await done.s.init();
    expect(done.s.getView().overdueCount).toBe(0);
    const err = await ready({ start: [new ReviewError('internal', 'x')] });
    await err.s.init();
    expect(err.s.getView().overdueCount).toBe(0);
  });

  it('已答 / 總數還是 progress 的值(逾期數不插進去、不改字):answeredCount = index - 1,totalCount = total', async () => {
    const { s } = await ready({ start: [start({ overdue: 3 })], next: [fillQ({ progress: { index: 3, total: 5 } })] });
    await s.init();
    expect(s.getView().answeredCount).toBe(2);
    expect(s.getView().totalCount).toBe(5);
  });
});

// ---------------------------------------------------------------- 驗收 2:小結

describe('小結(驗收 2)', () => {
  async function doneWith(summary: Obj): Promise<Session> {
    const { s } = await ready({ start: [start()], next: [{ kind: 'done' }], summary: [summary] });
    await s.init();
    return s;
  }

  it('通過 3、退回 2、沒超過上限:message 是「今天的複習都做完了。」,後面兩句', async () => {
    const s = await doneWith(summaryResult());
    const v = s.getView();
    expect(v.state).toBe('done');
    expect(v.message).toBe('今天的複習都做完了。');
    expect(v.summaryLines).toEqual(['通過 3 張、退回 2 張。', '明天預估 6 張。']);
  });

  it('passed 與 returned 不對調:通過 1、退回 4', async () => {
    const s = await doneWith(summaryResult({ passed: 1, returned: 4 }));
    expect(s.getView().summaryLines[0]).toBe('通過 1 張、退回 4 張。');
  });

  it('全是 0:「通過 0 張、退回 0 張。」(0 照樣顯示)與「明天預估 0 張。」', async () => {
    const s = await doneWith(summaryResult({ passed: 0, returned: 0, tomorrow: { total: 0, capped: false, shown: 0, overflow: 0 } }));
    expect(s.getView().summaryLines).toEqual(['通過 0 張、退回 0 張。', '明天預估 0 張。']);
  });

  it('retryLater 是 0:不說「評分失敗」', async () => {
    const s = await doneWith(summaryResult({ retryLater: 0 }));
    expect(s.getView().summaryLines.join('\n')).not.toContain('評分失敗');
    expect(s.getView().summaryLines).toHaveLength(2);
  });

  it('retryLater > 0:在「通過 / 退回」與「明天預估」之間多一句「另有 N 題評分失敗,下次再考。」', async () => {
    const s = await doneWith(summaryResult({ retryLater: 2 }));
    expect(s.getView().summaryLines).toEqual(['通過 3 張、退回 2 張。', '另有 2 題評分失敗,下次再考。', '明天預估 6 張。']);
  });

  it('retryLater = 1 也說(邊界是 > 0,不是 > 1)', async () => {
    const s = await doneWith(summaryResult({ retryLater: 1 }));
    expect(s.getView().summaryLines[1]).toBe('另有 1 題評分失敗,下次再考。');
  });

  it('capped 為 true:說上限與順延張數;shown 是上限', async () => {
    const s = await doneWith(summaryResult({ tomorrow: { total: 13, capped: true, shown: 10, overflow: 3 } }));
    expect(s.getView().summaryLines).toEqual(['通過 3 張、退回 2 張。', '明天預估 10 張(已到每天上限,另 3 張順延)。']);
  });

  it('capped 為 false:不說上限、不說順延(就算 overflow 有值也不說)', async () => {
    const s = await doneWith(summaryResult({ tomorrow: { total: 6, capped: false, shown: 6, overflow: 0 } }));
    const text = s.getView().summaryLines.join('\n');
    expect(text).not.toContain('上限');
    expect(text).not.toContain('順延');
  });

  it('retryLater > 0 又 capped:三句依序', async () => {
    const s = await doneWith(summaryResult({ retryLater: 1, tomorrow: { total: 12, capped: true, shown: 10, overflow: 2 } }));
    expect(s.getView().summaryLines).toEqual(['通過 3 張、退回 2 張。', '另有 1 題評分失敗,下次再考。', '明天預估 10 張(已到每天上限,另 2 張順延)。']);
  });

  it('snapshot、answeredThisRun 讀進來但這張不顯示:多給 answeredThisRun 不多一句', async () => {
    const s = await doneWith(summaryResult({ answeredThisRun: 4, snapshot: 'committed' }));
    expect(s.getView().summaryLines).toEqual(['通過 3 張、退回 2 張。', '明天預估 6 張。']);
    expect(s.getView().message).not.toContain('4');
  });

  it('續答到 done(第一個 next 就是 done):一樣顯示小結', async () => {
    const { s } = await ready({ start: [start({ resumed: true, answered: 5 })], next: [{ kind: 'done' }], summary: [summaryResult({ passed: 5, returned: 0 })] });
    await s.init();
    expect(s.getView().summaryLines[0]).toBe('通過 5 張、退回 0 張。');
  });

  it('summaryLines 只有 done 才有;題目、錯誤、暫停時是空陣列', async () => {
    const q = await ready({ start: [start()], next: [fillQ()] });
    await q.s.init();
    expect(q.s.getView().summaryLines).toEqual([]);
    const e = await ready({ start: [new ReviewError('internal', 'x')] });
    await e.s.init();
    expect(e.s.getView().summaryLines).toEqual([]);
  });

  it('summaryLines 在每一個非 done 狀態都是空陣列(loading / paused / empty / reteach / question / error;T23 驗收 S7)', async () => {
    const loading = await ready({ start: [start()] });
    expect(loading.s.getView().state).toBe('loading');
    expect(loading.s.getView().summaryLines).toEqual([]);
    const paused = await ready({ start: [start({ state: 'paused' })] });
    await paused.s.init();
    expect(paused.s.getView().state).toBe('paused');
    expect(paused.s.getView().summaryLines).toEqual([]);
    const empty = await ready({ start: [start({ state: 'empty', total: 0 })] });
    await empty.s.init();
    expect(empty.s.getView().state).toBe('empty');
    expect(empty.s.getView().summaryLines).toEqual([]);
    const re = await ready(
      { start: [start()], next: [{ kind: 'reteach', card: 'sec-0001', path: SHORT_PATH, short: true }] },
      { [SHORT_PATH]: '同源指協定、主機、埠號三者相同。' },
    );
    await re.s.init();
    expect(re.s.getView().state).toBe('reteach');
    expect(re.s.getView().summaryLines).toEqual([]);
    const q = await ready({ start: [start()], next: [fillQ()] });
    await q.s.init();
    expect(q.s.getView().state).toBe('question');
    expect(q.s.getView().summaryLines).toEqual([]);
    const err = await ready({ start: [new ReviewError('no-cards', 'x')] });
    await err.s.init();
    expect(err.s.getView().state).toBe('error');
    expect(err.s.getView().summaryLines).toEqual([]);
  });

  it('done 之後按重新開始(init)→ summaryLines 清掉', async () => {
    const { s } = await ready({ start: [start(), start()], next: [{ kind: 'done' }, fillQ()], summary: [summaryResult()] });
    await s.init();
    expect(s.getView().summaryLines.length).toBeGreaterThan(0);
    await s.init();
    expect(s.getView().summaryLines).toEqual([]);
    expect(s.getView().state).toBe('question');
  });
});

describe('readSummary 的必要欄位(驗收 2:缺一個就是 bad-response → 複習程式停了)', () => {
  const broken: [string, Obj][] = [
    ['缺 passed', summaryResult({ passed: undefined })],
    ['passed 是字串', summaryResult({ passed: '3' })],
    ['passed 是 NaN', summaryResult({ passed: Number.NaN })],
    ['缺 returned', summaryResult({ returned: undefined })],
    ['returned 是 Infinity', summaryResult({ returned: Number.POSITIVE_INFINITY })],
    ['缺 retryLater', summaryResult({ retryLater: undefined })],
    ['retryLater 是字串', summaryResult({ retryLater: '0' })],
    ['缺 tomorrow', summaryResult({ tomorrow: undefined })],
    ['tomorrow 是數字(舊形狀)', summaryResult({ tomorrow: 6 })],
    ['tomorrow 是 null', summaryResult({ tomorrow: null })],
    ['tomorrow 缺 total', summaryResult({ tomorrow: { capped: false, shown: 6, overflow: 0 } })],
    ['tomorrow.total 是字串', summaryResult({ tomorrow: { total: '6', capped: false, shown: 6, overflow: 0 } })],
    ['tomorrow 缺 capped', summaryResult({ tomorrow: { total: 6, shown: 6, overflow: 0 } })],
    ['tomorrow.capped 是字串', summaryResult({ tomorrow: { total: 6, capped: 'false', shown: 6, overflow: 0 } })],
    ['tomorrow.capped 是 0', summaryResult({ tomorrow: { total: 6, capped: 0, shown: 6, overflow: 0 } })],
    ['tomorrow 缺 shown', summaryResult({ tomorrow: { total: 6, capped: false, overflow: 0 } })],
    ['tomorrow.shown 是 NaN', summaryResult({ tomorrow: { total: 6, capped: false, shown: Number.NaN, overflow: 0 } })],
    ['tomorrow 缺 overflow', summaryResult({ tomorrow: { total: 6, capped: false, shown: 6 } })],
    ['tomorrow.overflow 是字串', summaryResult({ tomorrow: { total: 6, capped: false, shown: 6, overflow: '0' } })],
    ['缺 snapshot', summaryResult({ snapshot: undefined })],
    ['snapshot 是數字', summaryResult({ snapshot: 1 })],
  ];
  it.each(broken)('%s → 複習程式停了,不顯示小結', async (label, summary) => {
    const { s } = await ready({ start: [start()], next: [{ kind: 'done' }], summary: [summary] });
    await s.init();
    expectStopped(s, label);
    expect(s.getView().summaryLines).toEqual([]);
    expect(s.getView().state).not.toBe('done');
  });
});

// ---------------------------------------------------------------- 驗收 3:stuck

describe('stuck(驗收 3)', () => {
  it('next 的 stuck 是 true:current.stuck 為 true;false 為 false', async () => {
    const t = await ready({ start: [start()], next: [fillQ({ stuck: true })] });
    await t.s.init();
    expect(t.s.getView().current!.stuck).toBe(true);
    const f = await ready({ start: [start()], next: [fillQ({ stuck: false })] });
    await f.s.init();
    expect(f.s.getView().current!.stuck).toBe(false);
  });

  it('stuck 跟著每一題走:stuck 的一題之後的下一題是 false', async () => {
    const { s } = await ready({
      start: [start()],
      next: [fillQ({ stuck: true }), applyQ({ stuck: false, progress: { index: 2, total: 5 } })],
      submit: [graded()],
    });
    await s.init();
    expect(s.getView().current!.stuck).toBe(true);
    await s.submitFill(['a', 'b', 'c']);
    await s.next();
    expect(s.getView().current!.stuck).toBe(false);
  });

  it('stuck 不是布林(缺、字串 "true"、1)→ 複習程式停了(不是被當成 false)', async () => {
    for (const bad of [undefined, 'true', 1, null]) {
      const { s } = await ready({ start: [start()], next: [fillQ({ stuck: bad })] });
      await s.init();
      expectStopped(s, `stuck=${String(bad)}`);
    }
  });
});

// ---------------------------------------------------------------- 驗收 5(b):缺欄位之後只給重新開始

describe('缺欄位的結果:複習程式停了 + 重新開始,沒有再試一次(驗收 5 (b))', () => {
  it('start 的結果缺必要欄位(讀取函式回 undefined)', async () => {
    const { s } = await ready({ start: [{ state: 'ready' }] });
    await s.init();
    expectStopped(s, 'start');
  });

  it('next 的結果缺必要欄位', async () => {
    const { s } = await ready({ start: [start()], next: [{ kind: 'question', card: 'sec-0001' }] });
    await s.init();
    expectStopped(s, 'next');
  });

  it('submit 的結果缺必要欄位', async () => {
    const { s } = await ready({ start: [start()], next: [fillQ()], submit: [{ status: 'passed' }] });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    expectStopped(s, 'submit');
    expect(s.getView().submitting).toBe(false);
  });

  it('summary 的結果缺必要欄位', async () => {
    const { s } = await ready({ start: [start()], next: [{ kind: 'done' }], summary: [{ passed: 1 }] });
    await s.init();
    expectStopped(s, 'summary');
  });

  it('對照:丟 kind 為 no-cards 的 ReviewError 才是「再試一次」(canRetry true、canRestart false)', async () => {
    const { s } = await ready({ start: [new ReviewError('no-cards', 'x')] });
    await s.init();
    expect(s.getView().canRetry).toBe(true);
    expect(s.getView().canRestart).toBe(false);
  });
});

// ---------------------------------------------------------------- 驗收 6:結果收窄的缺口(acceptance-T24 §5 第 1–5 組)

describe('第 1 組:readStart 的 today、resumed、deferred、dailyCap', () => {
  it.each([
    ['today 缺', { today: undefined }],
    ['today 是數字', { today: 20260910 }],
    ['resumed 缺', { resumed: undefined }],
    ['resumed 是字串', { resumed: 'false' }],
    ['deferred 缺', { deferred: undefined }],
    ['deferred 是字串', { deferred: '0' }],
    ['deferred 是 NaN', { deferred: Number.NaN }],
    ['dailyCap 缺', { dailyCap: undefined }],
    ['dailyCap 是字串', { dailyCap: '10' }],
    ['dailyCap 是 Infinity', { dailyCap: Number.POSITIVE_INFINITY }],
    ['total 缺', { total: undefined }],
    ['answered 缺', { answered: undefined }],
    ['fakeCloud 缺', { fakeCloud: undefined }],
    ['fakeCloud 是字串', { fakeCloud: 'false' }],
  ])('%s → 複習程式停了,不叫 next', async (label, over) => {
    const { s, f } = await ready({ start: [start(over)], next: [fillQ()] });
    await s.init();
    expectStopped(s, label);
    expect(f.calls.map((c) => c.method)).toEqual(['start']);
  });
});

describe('第 2 組:readNext 題目的 stage、reteach 的 card', () => {
  it.each([
    ['stage 缺', { stage: undefined }],
    ['stage 是字串', { stage: '1' }],
    ['stage 是 NaN', { stage: Number.NaN }],
  ])('題目 %s → 複習程式停了', async (label, over) => {
    const { s } = await ready({ start: [start()], next: [fillQ(over)] });
    await s.init();
    expectStopped(s, label);
  });

  it.each([
    ['應用題 stage 缺', applyQ({ stage: undefined })],
    ['應用題 stage 是字串', applyQ({ stage: '3' })],
  ])('%s → 複習程式停了', async (label, q) => {
    const { s } = await ready({ start: [start()], next: [q] });
    await s.init();
    expectStopped(s, label);
  });

  it.each([
    ['card 缺', { kind: 'reteach', path: 'cards/security/sec-0001.md', short: false }],
    ['card 是數字', { kind: 'reteach', card: 1, path: 'cards/security/sec-0001.md', short: false }],
    ['path 缺', { kind: 'reteach', card: 'sec-0001', short: false }],
    ['short 缺', { kind: 'reteach', card: 'sec-0001', path: 'cards/security/sec-0001.md' }],
  ])('reteach %s → 複習程式停了,不去讀檔', async (label, reteach) => {
    const { s, fs } = await ready({ start: [start()], next: [reteach as Obj] }, { 'cards/security/sec-0001.md': '內文' });
    await s.init();
    expectStopped(s, label);
    expect(fs.reads).toEqual([]);
  });
});

describe('第 3 組:readSubmit 的 error 與 correctAnswers', () => {
  async function submitWith(result: Obj): Promise<Session> {
    const { s } = await ready({ start: [start()], next: [fillQ()], submit: [result] });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    return s;
  }

  it('status error 但 pass 是 false → 複習程式停了(error 的 pass 一定是 null)', async () => {
    expectStopped(await submitWith({ status: 'error', pass: false, feedback: 'x', cardDone: false }), 'error+false');
  });

  it('status error 但 pass 是 true → 複習程式停了', async () => {
    expectStopped(await submitWith({ status: 'error', pass: true, feedback: 'x', cardDone: false }), 'error+true');
  });

  it('status error 但沒有 pass 欄位 → 複習程式停了', async () => {
    expectStopped(await submitWith({ status: 'error', feedback: 'x', cardDone: false }), 'error+missing');
  });

  it('status passed 但 pass 是 null → 複習程式停了', async () => {
    expectStopped(await submitWith({ status: 'passed', pass: null, feedback: 'x', cardDone: true }), 'passed+null');
  });

  it('correctAnswers 混一個數字(["協定", 1])→ 複習程式停了(every,不是 some)', async () => {
    expectStopped(await submitWith(graded({ status: 'failed', pass: false, correctAnswers: ['協定', 1] })), 'mixed');
  });

  it('correctAnswers 第一個是數字、後面是字串 → 也停了', async () => {
    expectStopped(await submitWith(graded({ status: 'failed', pass: false, correctAnswers: [1, '協定'] })), 'mixed2');
  });

  it('correctAnswers 不是陣列 → 停了', async () => {
    expectStopped(await submitWith(graded({ status: 'failed', pass: false, correctAnswers: '協定' })), 'string');
  });

  it('對照:correctAnswers 全是字串 → 照常顯示', async () => {
    const s = await submitWith(graded({ status: 'failed', pass: false, correctAnswers: ['協定', '主機', '埠'] }));
    expect(s.getView().state).toBe('question');
    expect(s.getView().result!.correctAnswers).toEqual(['協定', '主機', '埠']);
  });
});

describe('第 4 組:reviewOf 的備援分支(不是同一個 class 的 ReviewError)', () => {
  function foreign(kind: unknown, message = 'x'): Error {
    const e = new Error(message);
    e.name = 'ReviewError';
    (e as unknown as { kind: unknown }).kind = kind;
    return e;
  }

  it('Error(不是 ReviewError 的 instance),name 是 "ReviewError"、kind 是 no-cards → 走「再試一次」', async () => {
    const { s } = await ready({ start: [foreign('no-cards')] });
    await s.init();
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain('掃描到 0 張卡');
    expect(v.canRetry).toBe(true);
    expect(v.canRestart).toBe(false);
  });

  it('同一個備援:kind 是 root-mismatch → message 原文接 vault.ts show 與再試一次', async () => {
    const { s } = await ready({ start: [foreign('root-mismatch', '固定句。')] });
    await s.init();
    expect(s.getView().message).toBe('固定句。請在終端機執行 npx tsx scripts/vault.ts show 看原因。改好之後按「再試一次」。');
    expect(s.getView().canRetry).toBe(true);
  });

  it('同一個備援:kind 是 paused → 暫停畫面;review-record-changed → 全文加重新開始', async () => {
    const p = await ready({ start: [foreign('paused')] });
    await p.s.init();
    expect(p.s.getView().state).toBe('paused');
    const r = await ready({ start: [start()], next: [fillQ()], submit: [foreign('review-record-changed', '全文-RRC')] });
    await r.s.init();
    await r.s.submitFill(['a', 'b', 'c']);
    expect(r.s.getView().message).toContain('全文-RRC');
    expect(r.s.getView().canRestart).toBe(true);
    expect(r.s.getView().canRetry).toBe(false);
  });

  it('對照:kind 是空字串 → 複習程式停了', async () => {
    const { s } = await ready({ start: [foreign('')] });
    await s.init();
    expectStopped(s, 'empty kind');
  });

  it('對照:kind 不是字串 → 複習程式停了', async () => {
    const { s } = await ready({ start: [foreign(42)] });
    await s.init();
    expectStopped(s, 'numeric kind');
  });

  it('對照:丟的是普通物件 { name: "ReviewError", kind: "no-cards" }(不是 Error)→ 複習程式停了', async () => {
    const plain = { name: 'ReviewError', kind: 'no-cards', message: 'x' };
    // fakeClient 把 Error 的 step 當 reject、其他物件當回傳值,所以用函式 step 才丟得出「不是 Error 的東西」
    const { s } = await ready({ start: [() => Promise.reject(plain)] });
    await s.init();
    expectStopped(s, 'plain object');
  });

  it('對照:name 不是 "ReviewError" 的 Error 帶 kind: no-cards → 複習程式停了', async () => {
    const other = new Error('x');
    other.name = 'SomethingElse';
    (other as unknown as { kind: string }).kind = 'no-cards';
    const { s } = await ready({ start: [other] });
    await s.init();
    expectStopped(s, 'other name');
  });
});

describe('第 5 組:stripFrontmatter', () => {
  async function load(): Promise<(text: string) => string> {
    const mod = (await import(/* @vite-ignore */ SESSION)) as { stripFrontmatter?: (text: string) => string };
    if (typeof mod.stripFrontmatter !== 'function') throw new Error('session.ts 沒有匯出 stripFrontmatter');
    return mod.stripFrontmatter;
  }

  it('第一行是 ---、後面沒有收尾的 ---:原樣回傳整段(含開頭那行),不吃掉內文', async () => {
    const strip = await load();
    const text = '---\ntitle: x\n這是內文\n第二行';
    expect(strip(text)).toBe(text);
  });

  it('只有一行 ---:原樣', async () => {
    expect((await load())('---')).toBe('---');
  });

  it('有收尾的 ---:去掉到收尾(含);內文後來的 --- 留著', async () => {
    const strip = await load();
    expect(strip('---\ntitle: x\n---\n內文\n---\n還有')).toBe('內文\n---\n還有');
  });

  it('第一行不是剛好 ---(多一個空白、或不是第一行):原樣', async () => {
    const strip = await load();
    expect(strip('--- \na\n---\nb')).toBe('--- \na\n---\nb');
    expect(strip('\n---\na\n---\nb')).toBe('\n---\na\n---\nb');
  });

  it('經過 reteach 畫面:沒有收尾的 --- 時,顯示的內文是整個檔案', async () => {
    const text = '---\nid: sec-0001\n沒有收尾\n內文';
    const { s } = await ready(
      { start: [start()], next: [{ kind: 'reteach', card: 'sec-0001', path: 'cards/security/sec-0001.md', short: false }] },
      { 'cards/security/sec-0001.md': text },
    );
    await s.init();
    expect(s.getView().state).toBe('reteach');
    expect(s.getView().reteach!.text).toBe(text);
  });
});

// ---------------------------------------------------------------- 驗收 7:刪重複之後仍要殺得掉

describe('showError 的 clearCard 與 submit() 的 finally(驗收 7)', () => {
  it.each(['internal', 'no-cards', 'router-unavailable', 'root-mismatch', 'review-record-changed', 'sidecar-exited'])(
    '答完一題、按「下一題」時側車出錯(%s):錯誤畫面的 view 沒有上一題的 result',
    async (kind) => {
      const { s } = await ready({ start: [start()], next: [fillQ(), new ReviewError(kind, 'x')], submit: [graded()] });
      await s.init();
      await s.submitFill(['a', 'b', 'c']);
      expect(s.getView().result).toBeDefined();
      await s.next();
      const v = s.getView();
      expect(v.state).toBe('error');
      expect(v.result).toBeUndefined();
      expect(v.gradingError).toBeUndefined();
      expect(v.current).toBeUndefined();
    },
  );

  it('不是 ReviewError 的例外(TypeError)也一樣', async () => {
    const { s } = await ready({ start: [start()], next: [fillQ(), new TypeError('boom')], submit: [graded()] });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    await s.next();
    expect(s.getView().state).toBe('error');
    expect(s.getView().result).toBeUndefined();
  });

  it('評分失敗(gradingError)之後再送出遇到錯誤:錯誤畫面沒有 gradingError', async () => {
    const { s } = await ready({
      start: [start()],
      next: [fillQ()],
      submit: [{ status: 'error', pass: null, feedback: '掛了', cardDone: false }, new ReviewError('internal', 'x')],
    });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    expect(s.getView().gradingError).toBe('評分失敗,請再試一次');
    await s.submitFill(['a', 'b', 'c']);
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.gradingError).toBeUndefined();
    expect(v.result).toBeUndefined();
  });

  it.each(['internal', 'no-cards', 'root-mismatch', 'review-record-changed', 'sidecar-exited', 'timeout'])(
    '送出出錯(%s)之後 submitting 是 false',
    async (kind) => {
      const { s } = await ready({ start: [start()], next: [fillQ()], submit: [new ReviewError(kind, 'x')] });
      await s.init();
      await s.submitFill(['a', 'b', 'c']);
      expect(s.getView().submitting).toBe(false);
    },
  );

  it('送出出錯(TypeError)、送出的結果缺欄位之後,submitting 也是 false', async () => {
    const a = await ready({ start: [start()], next: [fillQ()], submit: [new TypeError('x')] });
    await a.s.init();
    await a.s.submitFill(['a', 'b', 'c']);
    expect(a.s.getView().submitting).toBe(false);
    const b = await ready({ start: [start()], next: [fillQ()], submit: [{ status: 'passed' }] });
    await b.s.init();
    await b.s.submitFill(['a', 'b', 'c']);
    expect(b.s.getView().submitting).toBe(false);
  });

  it('送出進行中 submitting 是 true(finally 才改回 false)', async () => {
    let release: (v: Obj) => void = () => undefined;
    const pending = new Promise<Obj>((resolve) => {
      release = resolve;
    });
    const { s } = await ready({ start: [start()], next: [fillQ()], submit: [() => pending] });
    await s.init();
    const p = s.submitFill(['a', 'b', 'c']);
    expect(s.getView().submitting).toBe(true);
    release(graded());
    await p;
    expect(s.getView().submitting).toBe(false);
  });

  it('送出出錯之後可以重新開始、再送出(送出鍵沒被卡死)', async () => {
    const { s, f } = await ready({
      start: [start(), start()],
      next: [fillQ(), fillQ()],
      submit: [new ReviewError('timeout', 'x'), graded()],
    });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    expect(s.getView().submitting).toBe(false);
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    expect(f.count('submit')).toBe(2);
    expect(s.getView().result).toBeDefined();
  });
});

describe('root-mismatch、not-configured 的畫面字全文(驗收 7)', () => {
  it.each([
    ['root-mismatch', '學習目錄跟指標檔指向的地方不一樣。'],
    ['not-configured', '學習目錄還沒設定好。'],
  ])('%s:句子接 vault.ts show 接再試一次,中間沒有多的空白', async (kind, fixed) => {
    const { s } = await ready({ start: [new ReviewError(kind, fixed)] });
    await s.init();
    expect(s.getView().message).toBe(`${fixed}請在終端機執行 npx tsx scripts/vault.ts show 看原因。改好之後按「再試一次」。`);
  });

  it('不論 message 是什麼,中間都不加空白(message 原文 + 固定的下一句)', async () => {
    const { s } = await ready({ start: [new ReviewError('root-mismatch', 'ABC')] });
    await s.init();
    expect(s.getView().message).toBe('ABC請在終端機執行 npx tsx scripts/vault.ts show 看原因。改好之後按「再試一次」。');
    expect(s.getView().message).not.toMatch(/。 請/);
  });

  it('其他兩個啟動錯誤(no-cards、router-unavailable)的全文也固定', async () => {
    const a = await ready({ start: [new ReviewError('no-cards', 'x')] });
    await a.s.init();
    expect(a.s.getView().message).toBe('掃描到 0 張卡 —— 這個 learning 資料夾沒有卡片。改好之後按「再試一次」。');
    const b = await ready({ start: [new ReviewError('router-unavailable', 'x')] });
    await b.s.init();
    expect(b.s.getView().message).toBe('帳本身分驗不過,批改不能用。請在終端機執行 npx tsx scripts/vault.ts show 看原因。改好之後按「再試一次」。');
  });
});

// ---------------------------------------------------------------- T30:金鑰問題(credential-unavailable)

describe('T30 驗收 4:start 回 credential-unavailable → 「再試一次」畫面(不是「複習程式停了」)', () => {
  const MISSING = '批改要用的金鑰沒有設定:GATEWAY_API_KEY。請在專案根目錄的 .env 加上。';
  const REJECTED = '批改用的金鑰被拒絕:OPENAI_API_KEY(可能過期或打錯)。請在專案根目錄的 .env 換一個。';
  const credential = (message: string): Error => new ReviewError('credential-unavailable', message);

  it('訊息照原文,後面直接接「改好之後按「再試一次」。」(中間沒有空格);有「再試一次」、沒有「重新開始」', async () => {
    const { s } = await ready({ start: [credential(MISSING)] });
    await s.init();
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.message).toBe(`${MISSING}改好之後按「再試一次」。`);
    expect(v.canRetry).toBe(true);
    expect(v.canRestart).toBe(false);
    expect(v.message).not.toContain('複習程式停了');
    expect(v.current).toBeUndefined();
    expect(v.summaryLines).toEqual([]);
  });

  it('被拒絕的那一句也一樣(訊息用側車給的,不在畫面裡寫死)', async () => {
    const { s } = await ready({ start: [credential(REJECTED)] });
    await s.init();
    expect(s.getView().message).toBe(`${REJECTED}改好之後按「再試一次」。`);
    expect(s.getView().canRetry).toBe(true);
  });

  it('側車給什麼句子就顯示什麼句子(不同的字也原樣帶出)', async () => {
    const { s } = await ready({ start: [credential('別的句子 XYZ')] });
    await s.init();
    expect(s.getView().message).toBe('別的句子 XYZ改好之後按「再試一次」。');
  });

  it('按「再試一次」= 再 init():重新 start,補好金鑰就出題;沒有走 next 以外的路', async () => {
    const { s, f } = await ready({ start: [credential(MISSING), start()], next: [fillQ()] });
    await s.init();
    expect(s.getView().canRetry).toBe(true);
    await s.init();
    expect(f.calls.map((c) => c.method)).toEqual(['start', 'start', 'next']);
    const v = s.getView();
    expect(v.state).toBe('question');
    expect(v.canRetry).toBe(false);
    expect(v.canRestart).toBe(false);
    expect(v.message).toBeUndefined();
  });

  it('再試一次還是缺 → 還在「再試一次」畫面;可以一直試', async () => {
    const { s, f } = await ready({ start: [credential(MISSING), credential(MISSING), credential(REJECTED)] });
    for (let i = 0; i < 3; i += 1) await s.init();
    expect(f.count('start')).toBe(3);
    expect(s.getView().message).toBe(`${REJECTED}改好之後按「再試一次」。`);
    expect(s.getView().canRetry).toBe(true);
  });

  it('其他種類的 start 失敗不受影響:internal 還是「複習程式停了」加「重新開始」', async () => {
    const { s } = await ready({ start: [new ReviewError('internal', 'x')] });
    await s.init();
    expect(s.getView().message).toContain('複習程式停了');
    expect(s.getView().canRestart).toBe(true);
    expect(s.getView().canRetry).toBe(false);
  });
});

describe('T30 驗收 4:submit 回 credential-unavailable → 題目與輸入留著、可以再送', () => {
  const MISSING = '批改要用的金鑰沒有設定:GATEWAY_API_KEY。請在專案根目錄的 .env 加上。';
  const REJECTED = '批改用的金鑰被拒絕:OPENAI_API_KEY(可能過期或打錯)。請在專案根目錄的 .env 換一個。';
  const credential = (message: string): Error => new ReviewError('credential-unavailable', message);

  it('應用題:還在 question、題目沒變、submitting false;gradingError 是側車那一句加「改好之後再按「送出」。」', async () => {
    const { s } = await ready({ start: [start()], next: [applyQ()], submit: [credential(MISSING)] });
    await s.init();
    const before = s.getView().current;
    await s.submitApply('我的回答');
    const v = s.getView();
    expect(v.state).toBe('question');
    expect(v.current).toEqual(before);
    expect(v.submitting).toBe(false);
    expect(v.result).toBeUndefined();
    expect(v.gradingError).toBe(`${MISSING}改好之後再按「送出」。`);
    expect(v.canRetry).toBe(false);
    expect(v.canRestart).toBe(false);
    expect(v.message).toBeUndefined();
    expect(v.gradingError).not.toContain('評分失敗');
  });

  it('被拒絕那一句也一樣', async () => {
    const { s } = await ready({ start: [start()], next: [applyQ()], submit: [credential(REJECTED)] });
    await s.init();
    await s.submitApply('我的回答');
    expect(s.getView().gradingError).toBe(`${REJECTED}改好之後再按「送出」。`);
    expect(s.getView().state).toBe('question');
  });

  it('填空題一樣:題目留著、header 不動', async () => {
    const { s } = await ready({ start: [start()], next: [fillQ({ progress: { index: 2, total: 5 } })], submit: [credential(MISSING)] });
    await s.init();
    await s.submitFill(['a', 'b', 'c']);
    const v = s.getView();
    expect(v.state).toBe('question');
    expect(v.current?.card).toBe('sec-0001');
    expect([v.answeredCount, v.totalCount]).toEqual([1, 5]);
    expect(v.gradingError).toBe(`${MISSING}改好之後再按「送出」。`);
    expect(v.submitting).toBe(false);
  });

  it('改好之後再按「送出」:只多一次 submit(沒有 start、沒有 next),這次有結果、錯誤清掉', async () => {
    const { s, f } = await ready({ start: [start()], next: [applyQ()], submit: [credential(MISSING), graded()] });
    await s.init();
    await s.submitApply('我的回答');
    await s.submitApply('我的回答');
    expect(f.calls.map((c) => c.method)).toEqual(['start', 'next', 'submit', 'submit']);
    expect(f.calls[3]).toEqual({ method: 'submit', arg: { apply: '我的回答' } });
    const v = s.getView();
    expect(v.gradingError).toBeUndefined();
    expect(v.result).toMatchObject({ pass: true });
    expect(v.state).toBe('question');
  });

  it('連續兩次憑證錯誤:句子換成最新的那一句,沒有疊加', async () => {
    const { s } = await ready({ start: [start()], next: [applyQ()], submit: [credential(MISSING), credential(REJECTED)] });
    await s.init();
    await s.submitApply('x');
    await s.submitApply('x');
    expect(s.getView().gradingError).toBe(`${REJECTED}改好之後再按「送出」。`);
  });

  it('批改回 status:"error" 的老路不變:gradingError 還是「評分失敗,請再試一次」', async () => {
    const { s } = await ready({ start: [start()], next: [applyQ()], submit: [{ status: 'error', pass: null, feedback: '評分失敗', cardDone: false }] });
    await s.init();
    await s.submitApply('x');
    expect(s.getView().gradingError).toBe('評分失敗,請再試一次');
  });

  it('送出中:submitting 為 true,結束(包括憑證錯誤)後回 false', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { s } = await ready({
      start: [start()],
      next: [applyQ()],
      submit: [
        async () => {
          await gate;
          throw credential(MISSING);
        },
      ],
    });
    await s.init();
    const pending = s.submitApply('x');
    expect(s.getView().submitting).toBe(true);
    release?.();
    await pending;
    expect(s.getView().submitting).toBe(false);
  });

  it('其他種類的 submit 失敗照舊:internal → 「複習程式停了」加「重新開始」,題目收起來', async () => {
    const { s } = await ready({ start: [start()], next: [applyQ()], submit: [new ReviewError('internal', 'x')] });
    await s.init();
    await s.submitApply('x');
    const v = s.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain('複習程式停了');
    expect(v.canRestart).toBe(true);
    expect(v.current).toBeUndefined();
  });
});
