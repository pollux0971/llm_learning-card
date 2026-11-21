/**
 * T67 紅測試(同一條路):考試卡小結的「明天預估」與教學卡頁尾的「明天約 M 張」是同一個函式 `estimateTomorrowFrom` 算的。
 * 測試 agent 寫;開發 worker 不改。工單 must_catch「明天的估計自己另算一份,不是考試卡小結的那個函式 → 同一個函式那條單元測試必須紅」。
 *
 * 量法(T19 的「同一條路」):把 session/summary.js 的 estimateTomorrowFrom 換成 spy。
 *   1. 預設包真的實作:考試卡的 summary、教學卡的 teach.open、teach.next、teach.load 各叫一次,spy 都要被叫到,
 *      而且帶的是「那一邊真正的輸入」(今天、每日上限、考試卡名單、reviews);
 *   2. 換成回一個不可能自然算出來的哨兵數(77):兩邊顯示的都是 77——教學卡不能自己另算一份再湊巧一樣。
 * handler 用靜態 import:vi.mock 掛在 summary.js 這個檔上,handler → engine.ts / teach.ts 的 import 都經過它。
 * 預期值手算(世界同 t67-teach-load.test.ts)。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoModelError } from '../../packages/core/src/llm/errors.js';
import { scriptedApplyReply } from '../steps/_i2-cloud-script.js';
import { childEnv, reviewRecord, seedDue } from './review-session-harness.js';
import { TODAY, TOMORROW, createTeachVault, readReviews, removeVault, requestLine, writeReviews, type Vault } from './teach-harness.js';

vi.mock('../../packages/core/src/session/summary.js', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const original = real['estimateTomorrowFrom'] as ((input: unknown) => unknown) | undefined;
  return { ...real, estimateTomorrowFrom: vi.fn((input: unknown) => (original === undefined ? undefined : original(input))) };
});
import * as summaryModule from '../../packages/core/src/session/summary.js';
import { createReviewHandler } from '../../packages/core/src/session/handler.js';

type Obj = Record<string, unknown>;
interface EstimateInput {
  reviews: Record<string, unknown>;
  today: string;
  queueCards: readonly string[];
  dailyCap: number;
}
const spy = (summaryModule as unknown as { estimateTomorrowFrom: ReturnType<typeof vi.fn> }).estimateTomorrowFrom;

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});
beforeEach(() => {
  spy.mockClear();
});

function router() {
  return {
    async call(task: string, prompt: string) {
      if (task !== 'grade.apply') throw new NoModelError('grade.fill.llm');
      return { text: scriptedApplyReply(prompt), provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

function world() {
  const v = createTeachVault();
  vaults.push(v);
  seedDue(v, ['sec-0001', 'sec-0002'], [0, 0]);
  const reviews = readReviews(v);
  reviews['lang-0001'] = reviewRecord({ next_due: TOMORROW });
  writeReviews(v, reviews);
  const handler = createReviewHandler({ learningDir: v.dir, today: TODAY, routerFactory: () => router(), env: childEnv(v) });
  let id = 0;
  const send = async (method: string, params: Obj = {}): Promise<Obj> => {
    id += 1;
    return JSON.parse(await handler(requestLine(id, method, params))) as Obj;
  };
  const ok = async (method: string, params: Obj = {}): Promise<Obj> => {
    const res = await send(method, params);
    expect(res['ok'], `${method}:${JSON.stringify(res)}`).toBe(true);
    return res['result'] as Obj;
  };
  /** 答完今天的考試卡(全答錯) */
  const finishExam = async (): Promise<void> => {
    await ok('start');
    for (let i = 0; i < 20; i += 1) {
      const q = await ok('next');
      if (q['kind'] === 'done') return;
      const params = q['type'] === 'fill' ? { fill: Array.from({ length: Number(q['blanks']) }, () => 'x') } : { apply: 'x' };
      await ok('submit', params);
    }
  };
  return { v, ok, send, finishExam };
}

const lastInput = (): EstimateInput => spy.mock.calls[spy.mock.calls.length - 1]![0] as EstimateInput;

describe('兩邊都經過 estimateTomorrowFrom', () => {
  it('考試卡的 summary 叫它:帶今天、每日上限 10、當日快取的名單(兩張到期的卡)、reviews', async () => {
    const w = world();
    await w.finishExam();
    spy.mockClear();
    await w.ok('summary');
    expect(spy).toHaveBeenCalledTimes(1);
    const input = lastInput();
    expect(input.today).toBe(TODAY);
    expect(input.dailyCap).toBe(10);
    expect([...input.queueCards].sort()).toEqual(['sec-0001', 'sec-0002']);
    expect(Object.keys(input.reviews)).toEqual(expect.arrayContaining(['sec-0001', 'sec-0002', 'lang-0001']));
  });

  it('教學卡的 teach.open 叫它:同樣的今天、每日上限與考試卡名單(session 還開著)', async () => {
    const w = world();
    await w.finishExam();
    spy.mockClear();
    await w.ok('teach.open');
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
    const input = lastInput();
    expect(input.today).toBe(TODAY);
    expect(input.dailyCap).toBe(10);
    expect([...input.queueCards].sort()).toEqual(['sec-0001', 'sec-0002']);
  });

  it('教學卡的 teach.next、teach.load 也叫它', async () => {
    const w = world();
    await w.ok('teach.open');
    spy.mockClear();
    await w.ok('teach.next');
    expect(spy.mock.calls.length, 'teach.next').toBeGreaterThanOrEqual(1);
    spy.mockClear();
    await w.ok('teach.load');
    expect(spy.mock.calls.length, 'teach.load').toBeGreaterThanOrEqual(1);
  });

  it('沒有開著的考試卡:名單從今天的快取檔來(側車重啟後的教學卡),上限讀設定檔', async () => {
    const w = world();
    await w.finishExam();
    const fresh = createReviewHandler({ learningDir: w.v.dir, today: TODAY, routerFactory: () => router(), env: childEnv(w.v) });
    spy.mockClear();
    const res = JSON.parse(await fresh(requestLine(1, 'teach.load'))) as Obj;
    expect(res['ok'], JSON.stringify(res)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect([...lastInput().queueCards].sort()).toEqual(['sec-0001', 'sec-0002']);
    expect(lastInput().dailyCap).toBe(10);
  });
});

describe('兩邊顯示的就是它回的數字(不是自己另算一份)', () => {
  it('函式回哨兵數 77:考試卡 summary.tomorrow.shown、教學卡 teach.load 與 teach.open 的 dueTomorrow 都是 77', async () => {
    const w = world();
    await w.finishExam();
    spy.mockImplementation(() => ({ total: 77, capped: false, shown: 77, overflow: 0 }));
    try {
      const summary = await w.ok('summary');
      expect((summary['tomorrow'] as Obj)['shown'], '考試卡').toBe(77);
      expect((await w.ok('teach.load'))['dueTomorrow'], 'teach.load').toBe(77);
      expect(((await w.ok('teach.open'))['load'] as Obj)['dueTomorrow'], 'teach.open 的 load').toBe(77);
      expect(((await w.ok('teach.next'))['load'] as Obj)['dueTomorrow'], 'teach.next 的 load').toBe(77);
    } finally {
      spy.mockReset();
    }
  });

  it('函式回「到上限」(shown 3、total 9、capped):教學卡顯示 shown(3),不是 total', async () => {
    const w = world();
    spy.mockImplementation(() => ({ total: 9, capped: true, shown: 3, overflow: 6 }));
    try {
      expect((await w.ok('teach.load'))['dueTomorrow']).toBe(3);
    } finally {
      spy.mockReset();
    }
  });
});

