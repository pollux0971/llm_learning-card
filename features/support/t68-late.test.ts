/**
 * T68 驗收補測第二輪(測試 agent 寫;開發 worker 不改):-65 逐個分析存活改壞後挑出的幾條(docs/reviews/acceptance-T68-impl.md 第 10 節)。
 *   ① 舊 ask 晚到收尾,不能清掉「換卡後新開的 ask」(新 ask 的答案要拿得到、poll 不能一直 idle)
 *   ② 舊 ask 晚到的「失敗」(NO_MODEL / 預算 / 一般錯誤)不能漏進新狀態(poll 不回那個錯誤)
 *   ③ router 丟非物件(字串、null、數字、undefined)→ error failed,沒有未處理的 rejection
 *   ④ state/log.jsonl 讀不了但不是「沒有這個檔」(例如變成資料夾)→ 花費是不知道 → error budget、router 0 次
 *   ⑤ 拿 router 的途中換卡(控制器單元):之後不再呼叫 router
 * ①② 是真 bug 的測試(在實作上可能紅);③④⑤ 是實作本來就對、只缺測試。世界與假 router 見 t68-harness.ts。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyBudgetExceededError, NoModelError } from '../../packages/core/src/llm/errors.js';
import { createAskController } from '../../packages/core/src/session/teach-ask.js';
import { cleanupRigs } from './t43-harness.js';
import { AFTER_PARENT, ThrowValue, askAnswer, askOf, askRig, cardIdOf, isAsking, type AskCall, type Obj } from './t68-harness.js';

vi.setConfig({ testTimeout: 30_000 });
afterAll(cleanupRigs);

const A = (n: number): string => `ATOKEN-${n}`;
const Q = (n: number): string => `QTOKEN-${n}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('① 舊 ask 晚到收尾,不清掉換卡後新開的 ask', () => {
  const MOVES: [string, (r: Awaited<ReturnType<typeof askRig>>) => Promise<Obj>][] = [
    ['teach.next', (r) => r.send('teach.next')],
    ['teach.open', (r) => r.send('teach.open')],
    ['teach.switch', (r) => r.send('teach.switch', { category: 'network' })],
  ];
  it.each(MOVES)('換卡:%s', async (_name, move) => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = (call: AskCall) => askAnswer({ answer: A(call.n) });
    const g1 = r.askRouter.hold();
    await r.ask(Q(1));
    await g1.reached;
    const moved = await move(r);
    expect(moved['ok'], JSON.stringify(moved)).toBe(true);
    const g2 = r.askRouter.hold();
    const second = await r.ask(Q(2));
    expect(second['ok'], JSON.stringify(second)).toBe(true);
    await g2.reached;
    // 舊的這時才回來
    g1.release();
    await sleep(150);
    const mid = await r.send('teach.ask.poll');
    expect(isAsking(mid), `新的 ask 還在跑,poll 要說 asking:${JSON.stringify(mid)}`).toBe(true);
    expect(JSON.stringify(mid)).not.toContain(A(1));
    // 新的回來:拿到新的答案,不是舊的
    g2.release();
    const done = await r.askDone();
    expect(askOf(done)?.answer, JSON.stringify(done)).toBe(A(2));
    expect(r.askRouter.asks).toHaveLength(2);
  });

  it('舊 ask 收尾之後,「一次一個」的鎖還在:新 ask 跑著時再問回 bad-request', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const g1 = r.askRouter.hold();
    await r.ask(Q(1));
    await g1.reached;
    await r.send('teach.next');
    const g2 = r.askRouter.hold();
    await r.ask(Q(2));
    await g2.reached;
    g1.release();
    await sleep(150);
    const third = await r.ask(Q(3));
    expect(third['ok'], '新的 ask 還在跑,不能再開一個').toBe(false);
    g2.release();
    await r.askDone();
  });
});

describe('② 舊 ask 晚到的失敗不漏進新狀態', () => {
  it.each<[string, () => Error]>([
    ['NO_MODEL', () => new NoModelError('teach.ask')],
    ['預算用完', () => new DailyBudgetExceededError('teach.ask', 2, 1)],
    ['一般錯誤', () => new Error('boom')],
  ])('換卡後 router 才丟 %s:poll 不回那個錯誤;之後在新卡上問照常', async (_name, makeError) => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = (call: AskCall) => (call.n === 1 ? makeError() : askAnswer({ answer: A(call.n) }));
    const g1 = r.askRouter.hold();
    await r.ask(Q(1));
    await g1.reached;
    const moved = await r.send('teach.next');
    expect(cardIdOf(moved)).toBe(AFTER_PARENT);
    g1.release();
    await r.settle();
    const poll = await r.send('teach.ask.poll');
    expect(poll['ok']).toBe(true);
    expect(askOf(poll), `晚到的失敗不能出現:${JSON.stringify(poll)}`).toBeUndefined();
    expect(isAsking(poll)).toBe(false);
    const again = await r.askFull(Q(2));
    expect(again.ask?.answer, JSON.stringify(again.done)).toBe(A(2));
  });

  it('同時:舊的失敗晚到、新的 ask 正在跑——新的答案照樣拿得到', async () => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = (call: AskCall) => (call.n === 1 ? new Error('boom') : askAnswer({ answer: A(call.n) }));
    const g1 = r.askRouter.hold();
    await r.ask(Q(1));
    await g1.reached;
    await r.send('teach.next');
    const g2 = r.askRouter.hold();
    await r.ask(Q(2));
    await g2.reached;
    g1.release();
    await sleep(150);
    g2.release();
    const done = await r.askDone();
    expect(askOf(done)?.answer, JSON.stringify(done)).toBe(A(2));
  });
});

describe('③ router 丟非物件', () => {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown): void => void seen.push(reason);
  beforeEach(() => {
    seen.length = 0;
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => {
    process.off('unhandledRejection', onRejection);
  });

  it.each<[string, unknown]>([
    ['字串', 'just a string'],
    ['null', null],
    ['undefined', undefined],
    ['數字', 42],
    ['沒有 code 的普通物件', { message: 'x' }],
  ])('丟 %s → error failed、訊息非空、沒有未處理的 rejection、之後照常能問', async (_name, value) => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = new ThrowValue(value);
    const res = await r.askFull(Q(1));
    expect(res.done['ok'], JSON.stringify(res.done)).toBe(true);
    expect(res.ask?.error).toBe('failed');
    expect(String(res.ask?.message).trim().length).toBeGreaterThan(0);
    r.askRouter.reply = askAnswer();
    expect((await r.askFull(Q(2))).ask?.answer).toBeDefined();
    await sleep(50);
    expect(seen, '不能有未處理的 rejection').toEqual([]);
  });
});

describe('④ state/log.jsonl 讀不了、又不是「沒有這個檔」→ 花費不知道,不呼叫', () => {
  it('log.jsonl 變成資料夾:error budget、router 0 次、訊息非空;卡照常能往下', async () => {
    const r = await askRig();
    await r.view('teach.open');
    rmSync(join(r.v.dir, 'state/log.jsonl'), { force: true });
    mkdirSync(join(r.v.dir, 'state/log.jsonl'));
    const res = await r.askFull(Q(1));
    expect(res.done['ok'], JSON.stringify(res.done)).toBe(true);
    expect(res.ask?.error).toBe('budget');
    expect(String(res.ask?.message).trim().length).toBeGreaterThan(0);
    await r.settle();
    expect(r.askRouter.asks, '花費不知道的時候不呼叫 AI').toHaveLength(0);
  });
});

describe('⑤ 拿 router 的途中換卡:之後不再呼叫 router(控制器單元)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('acquireRouter 還沒回來就 invalidate / abandon:router.call 一次都沒被呼叫;結果是 idle', async () => {
    for (const how of ['invalidate', 'abandon', 'shutdown'] as const) {
      const dir = mkdtempSync(join(tmpdir(), 'lc-t68-late-'));
      dirs.push(dir);
      let release!: () => void;
      const slow = new Promise<void>((resolve) => {
        release = resolve;
      });
      let called = 0;
      const router = {
        async call(): Promise<unknown> {
          called += 1;
          return { text: askAnswer(), provider: 'openai', model: 'fake', latency_ms: 0, provisional: false };
        },
        probeOnline: async () => true,
        probeLocal: async () => ({ available: false, models: [] }),
      };
      const ctx = {
        card: { frontmatter: { id: 'sec-0002', category: 'security', title: 'T', level: 1 }, body: 'B', examples: [] },
        prereqs: [],
        atFloor: false,
      };
      const ctl = createAskController({
        learningDir: dir,
        today: () => '2026-09-10',
        env: { LLM_DAILY_CAP_USD: '1' },
        teach: { askContext: () => ctx } as never,
        deepenRunning: () => false,
        acquireRouter: async () => {
          await slow;
          return router as never;
        },
      });
      expect(ctl.ask(Q(1)), how).toEqual({ ok: true });
      expect(ctl.running()).toBe(true);
      ctl[how]();
      release();
      await sleep(80);
      expect(called, `${how} 之後不該呼叫 router`).toBe(0);
      expect(ctl.poll()).toEqual({ state: 'idle' });
      expect(ctl.running()).toBe(false);
    }
  });

  it('對照:沒有換卡時 acquireRouter 慢一點也照常呼叫、拿到答案', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-t68-late-'));
    dirs.push(dir);
    let called = 0;
    const router = {
      async call(): Promise<unknown> {
        called += 1;
        return { text: askAnswer(), provider: 'openai', model: 'fake', latency_ms: 0, provisional: false };
      },
    };
    const ctx = { card: { frontmatter: { id: 'sec-0002', category: 'security', title: 'T', level: 1 }, body: 'B', examples: [] }, prereqs: [], atFloor: false };
    const ctl = createAskController({
      learningDir: dir,
      today: () => '2026-09-10',
      env: { LLM_DAILY_CAP_USD: '1' },
      teach: { askContext: () => ctx } as never,
      deepenRunning: () => false,
      acquireRouter: async () => {
        await sleep(40);
        return router as never;
      },
    });
    ctl.ask(Q(1));
    for (let i = 0; i < 100 && ctl.poll().state === 'asking'; i += 1) await sleep(10);
    const polled = ctl.poll();
    expect(called).toBe(1);
    expect(polled.state).toBe('done');
  });
});
