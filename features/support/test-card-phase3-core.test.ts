/**
 * T23(06 phase-3)驗收 1、2、4 的「真 core」那一半:`TestSession` ← `createReviewClient({ handler })` ← `createReviewHandler`
 * ← 暫存根。紅測試作者寫;開發 worker 不改。路由器是程序內的假物件,不打網路;全部 mkdtemp,不碰真的 learning/。
 *
 *   1. `start` 結果的 `overdue` = 當日快取名單(`dayCache.queue`)裡 `overdue_days ≥ 1` 的張數(剛好 1 天要算;0 天不算;
 *      因上限順延的不算;reteach 不另外加);`ready`、`paused`、`empty` 都帶;一天之內固定;
 *   2. 小結:真的做完一輪之後,畫面的 `summaryLines`(通過 / 退回、明天預估)跟 core 的 `summary` 結果一致;
 *   4. 四個自動場景的 vitest 版(cucumber 版在 `features/steps/test-card-phase3.steps.ts`):續答、當天名單固定、跨日重建、明天預估。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { pauseDay } from '../../packages/core/src/session/engine.js';
import { DEFAULT_FIVE_ORDER, TODAY, answerCurrent, createRig, walkToEnd, type Obj, type Rig } from './test-card-rig.js';
import { addDays, readReviews, reviewRecord, writeReviews } from './review-session-harness.js';

const rigs: Rig[] = [];
afterAll(() => {
  for (const r of rigs) r.dispose();
});
async function rig(opts: Parameters<typeof createRig>[0] = {}): Promise<Rig> {
  const r = await createRig(opts);
  rigs.push(r);
  return r;
}

const YESTERDAY = addDays(TODAY, -1);

describe('start 結果的 overdue(驗收 1)', () => {
  it('逾期 0、1、2 天各一張 → 2(剛好逾期 1 天的那張要算進去;今天到期的不算)', async () => {
    const r = await rig({ entries: { 'sec-0001': { stage: 1, overdue: 2 }, 'sec-0002': { stage: 1, overdue: 1 }, 'sec-0003': { stage: 1, overdue: 0 } } });
    const start = (await r.client.start()) as Obj;
    expect(start.state).toBe('ready');
    expect(start.total).toBe(3);
    expect(start.overdue).toBe(2);
  });

  it('全部都逾期 ≥ 1 → 張數;全部今天到期 → 0(欄位仍在、是數字 0)', async () => {
    const late = await rig({ entries: { 'sec-0001': { stage: 1, overdue: 1 }, 'sec-0002': { stage: 1, overdue: 1 }, 'sec-0003': { stage: 1, overdue: 5 }, 'sec-0004': { stage: 1, overdue: 1 } } });
    expect(((await late.client.start()) as Obj).overdue).toBe(4);
    const none = await rig({ entries: { 'sec-0001': { stage: 1, overdue: 0 }, 'sec-0002': { stage: 1, overdue: 0 } } });
    const start = (await none.client.start()) as Obj;
    expect(Object.prototype.hasOwnProperty.call(start, 'overdue')).toBe(true);
    expect(start.overdue).toBe(0);
  });

  it('範圍是當日快取名單:因 daily_cap 順延的逾期卡不算(只算實際排進今天的)', async () => {
    // 四張都逾期,上限 2 → 今天只排兩張、兩張順延;overdue 是 2 不是 4
    const r = await rig({
      dailyCap: 2,
      entries: { 'sec-0001': { stage: 1, overdue: 4 }, 'sec-0002': { stage: 1, overdue: 3 }, 'sec-0003': { stage: 1, overdue: 2 }, 'sec-0004': { stage: 1, overdue: 1 } },
    });
    const start = (await r.client.start()) as Obj;
    expect(start.total).toBe(2);
    expect(start.deferred).toBe(2);
    expect(start.overdue).toBe(2);
  });

  it('reteach 的卡不另外加:一張 reteach(fails_in_row 2、逾期 3)、一張逾期 2、一張今天到期 → 2', async () => {
    const r = await rig({
      entries: { 'sec-0001': { stage: 1, overdue: 3, fails_in_row: 2, total_fails: 2 }, 'sec-0002': { stage: 1, overdue: 2 }, 'sec-0003': { stage: 1, overdue: 0 } },
    });
    const start = (await r.client.start()) as Obj;
    expect(start.total).toBe(3);
    expect(start.overdue).toBe(2);
  });

  it('一天之內固定:答題之後、同一個 handler 再 start、同一天關掉重開(續答)都是同一個數', async () => {
    const r = await rig({ entries: { 'sec-0001': { stage: 1, overdue: 3 }, 'sec-0002': { stage: 1, overdue: 1 }, 'sec-0003': { stage: 1, overdue: 0 }, 'sec-0004': { stage: 1, overdue: 0 } } });
    await r.session.init();
    expect(r.session.getView().overdueCount).toBe(2);
    await answerCurrent(r.session);
    await r.session.next();
    expect(r.session.getView().overdueCount).toBe(2);
    expect(((await r.client.start()) as Obj).overdue).toBe(2);
    const again = await r.reopen();
    const start = (await again.client.start()) as Obj;
    expect(start).toMatchObject({ resumed: true, answered: 1, overdue: 2 });
    await again.session.init();
    expect(again.session.getView().overdueCount).toBe(2);
  });

  it('答完全部之後的 start 還是同一個數(算的是當日名單,不是「還沒答的」)', async () => {
    const r = await rig({ entries: { 'sec-0001': { stage: 1, overdue: 2 }, 'sec-0002': { stage: 1, overdue: 1 }, 'sec-0003': { stage: 1, overdue: 0 } } });
    await r.session.init();
    await walkToEnd(r.session);
    expect(r.session.getView().state).toBe('done');
    expect(((await r.client.start()) as Obj).overdue).toBe(2);
  });

  it('paused 的結果也有 overdue(讀暫停當天的名單)', async () => {
    const r = await rig({ entries: { 'sec-0001': { stage: 1, overdue: 2 }, 'sec-0002': { stage: 1, overdue: 1 }, 'sec-0003': { stage: 1, overdue: 0 } } });
    await pauseDay({ learningDir: r.vault.dir, today: TODAY, env: r.env });
    const again = await r.reopen();
    const start = (await again.client.start()) as Obj;
    expect(start.state).toBe('paused');
    expect(typeof start.overdue).toBe('number');
    expect(Number.isFinite(start.overdue as number)).toBe(true);
  });

  it('empty 的結果也有 overdue,而且是 0', async () => {
    const r = await rig({ entries: { 'sec-0001': { stage: 1, overdue: -5 } } });
    const start = (await r.client.start()) as Obj;
    expect(start.state).toBe('empty');
    expect(start.overdue).toBe(0);
  });
});

describe('header 的逾期數是 start 的 overdue(真 core)', () => {
  it('畫面的 overdueCount = start 的 overdue,不是目前這張卡的逾期天數;每一題都一樣', async () => {
    const r = await rig({ entries: { 'sec-0001': { stage: 1, overdue: 6 }, 'sec-0002': { stage: 1, overdue: 1 }, 'sec-0003': { stage: 1, overdue: 0 } } });
    await r.session.init();
    const seen: { overdueDays: number; count: number }[] = [];
    for (let i = 0; i < 6 && r.session.getView().state === 'question'; i += 1) {
      const v = r.session.getView();
      if (seen[seen.length - 1]?.overdueDays !== v.current!.overdueDays) seen.push({ overdueDays: v.current!.overdueDays, count: v.overdueCount });
      await answerCurrent(r.session);
      await r.session.next();
    }
    expect(seen.map((s) => s.overdueDays)).toEqual([6, 1, 0]);
    expect(seen.map((s) => s.count)).toEqual([2, 2, 2]);
  });
});

describe('小結(驗收 2,真 core)', () => {
  it('五張:三張應用題答對、兩張填空答錯 → 「通過 3 張、退回 2 張。」加明天預估,跟 core 的 summary 一致', async () => {
    const r = await rig({
      entries: {
        'sec-0001': { stage: 3, overdue: 5 },
        'sec-0002': { stage: 3, overdue: 4 },
        'sec-0003': { stage: 3, overdue: 3 },
        'sec-0004': { stage: 1, overdue: 2 },
        'sec-0005': { stage: 1, overdue: 1 },
      },
    });
    await r.session.init();
    await walkToEnd(r.session);
    const view = r.session.getView();
    expect(view.state).toBe('done');
    expect(view.message).toBe('今天的複習都做完了。');
    const summary = (await r.client.summary()) as Obj;
    expect(summary).toMatchObject({ passed: 3, returned: 2, retryLater: 0 });
    const tomorrow = summary.tomorrow as { total: number; shown: number; capped: boolean; overflow: number };
    expect(view.summaryLines).toEqual(['通過 3 張、退回 2 張。', `明天預估 ${tomorrow.shown} 張。`]);
    expect(tomorrow.capped).toBe(false);
    expect(tomorrow.total).toBeGreaterThanOrEqual(2);
  });

  it('同一天關掉重開、續答到 done:小結是同一份(側車照當日快取算)', async () => {
    const r = await rig({ entries: { 'sec-0001': { stage: 1, overdue: 2 }, 'sec-0002': { stage: 1, overdue: 1 } } });
    await r.session.init();
    await walkToEnd(r.session);
    const first = r.session.getView().summaryLines;
    expect(first.length).toBeGreaterThanOrEqual(2);
    const again = await r.reopen();
    await again.session.init();
    // 全部答完了 → 重開得到「沒有題目了」:next 直接是 done → 同一份小結
    const v = again.session.getView();
    expect(['done', 'empty']).toContain(v.state);
    if (v.state === 'done') expect(v.summaryLines).toEqual(first);
  });
});

describe('Closing part way through resumes in the same place', () => {
  it('五張答了兩張後關掉、同一天重開:resumed true、answered 2,第三張、header 2 / 5、逾期數不變', async () => {
    const r = await rig();
    await r.session.init();
    const before = r.session.getView().overdueCount;
    for (let i = 0; i < 2; i += 1) {
      await answerCurrent(r.session);
      await r.session.next();
    }
    expect(r.session.getView().answeredCount).toBe(2);
    const again = await r.reopen();
    const start = (await again.client.start()) as Obj;
    expect(start).toMatchObject({ state: 'ready', resumed: true, answered: 2, total: 5 });
    const first = (await again.client.next()) as Obj;
    expect(first).toMatchObject({ kind: 'question', card: DEFAULT_FIVE_ORDER[2], progress: { index: 3, total: 5 } });

    const fresh = await r.reopen();
    await fresh.session.init();
    const v = fresh.session.getView();
    expect(v.state).toBe('question');
    expect(v.current!.card).toBe(DEFAULT_FIVE_ORDER[2]);
    expect(v.answeredCount).toBe(2);
    expect(v.totalCount).toBe(5);
    expect(v.overdueCount).toBe(before);
  });
});

describe("The day's question set is fixed once chosen", () => {
  it('早上建了十張;之後兩張新的卡到期、同一天重開:還是同樣十張、同樣順序,新到期的那兩張沒被問到', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `sec-${String(i + 1).padStart(4, '0')}`);
    const seedTen: Record<string, { stage: number; overdue: number }> = {};
    ids.forEach((id, i) => {
      seedTen[id] = { stage: 1, overdue: 11 - (i + 1) + 1 };
    });
    const r = await rig({ cards: 12, entries: seedTen });
    await r.session.init();
    expect(r.session.getView().totalCount).toBe(10);
    // 中午:兩張新的卡到期(直接改 reviews.json;sec-0012 逾期 3 天,排序上會擠進前面如果有被算進來)
    const reviews = readReviews(r.vault);
    reviews['sec-0011'] = reviewRecord({ stage: 1, next_due: TODAY });
    reviews['sec-0012'] = reviewRecord({ stage: 1, next_due: addDays(TODAY, -30) });
    writeReviews(r.vault, reviews);
    const later = await r.reopen();
    const start = (await later.client.start()) as Obj;
    expect(start).toMatchObject({ state: 'ready', total: 10, resumed: true });
    await later.session.init();
    const seen = await walkToEnd(later.session);
    expect(seen).toEqual(ids);
    const after = readReviews(r.vault);
    expect(after['sec-0011']!.history).toHaveLength(0);
    expect(after['sec-0012']!.history).toHaveLength(0);
  });
});

describe('Crossing midnight rebuilds the set', () => {
  it('昨天留三張沒答;今天重開:重建(resumed false),那三張的逾期天數各加一,overdue 跟著變', async () => {
    const r = await rig({
      today: YESTERDAY,
      entries: { 'sec-0001': { stage: 1, overdue: 0 }, 'sec-0002': { stage: 1, overdue: 0 }, 'sec-0003': { stage: 1, overdue: 0 } },
    });
    const y = (await r.client.start()) as Obj;
    expect(y).toMatchObject({ resumed: false, total: 3, overdue: 0 });
    await r.session.init();
    const yesterdayDays = r.session.getView().current!.overdueDays;
    expect(yesterdayDays).toBe(0);

    const today = await r.reopen(TODAY);
    const t = (await today.client.start()) as Obj;
    expect(t).toMatchObject({ state: 'ready', resumed: false, answered: 0, total: 3, overdue: 3 });
    await today.session.init();
    const v = today.session.getView();
    expect(v.current!.overdueDays).toBe(yesterdayDays + 1);
    expect(v.overdueCount).toBe(3);
    expect(v.totalCount).toBe(3);
  });

  it('每一張都加一,不只第一張:昨天逾期 1、3、0 天的三張,今天各是 2、4、1', async () => {
    const r = await rig({
      today: YESTERDAY,
      entries: { 'sec-0001': { stage: 1, overdue: 1 }, 'sec-0002': { stage: 1, overdue: 3 }, 'sec-0003': { stage: 1, overdue: 0 } },
    });
    await r.client.start();
    const todayRig = await r.reopen(TODAY);
    await todayRig.session.init();
    const days: Record<string, number> = {};
    for (let i = 0; i < 6 && todayRig.session.getView().state === 'question'; i += 1) {
      const v = todayRig.session.getView();
      days[v.current!.card] = v.current!.overdueDays;
      await answerCurrent(todayRig.session);
      await todayRig.session.next();
    }
    expect(days).toEqual({ 'sec-0001': 2, 'sec-0002': 4, 'sec-0003': 1 });
  });
});

describe("Tomorrow's estimate accounts for returns and the cap", () => {
  const dueTomorrow = (ids: string[]): Record<string, { stage: number; overdue: number }> => Object.fromEntries(ids.map((id) => [id, { stage: 1, overdue: -1 }]));

  it('明天已到期 4 張、今天退回 2 張 → 6,沒超過上限:不說上限與順延', async () => {
    const r = await rig({
      cards: 6,
      entries: { 'sec-0001': { stage: 1, overdue: 2 }, 'sec-0002': { stage: 1, overdue: 1 }, ...dueTomorrow(['sec-0003', 'sec-0004', 'sec-0005', 'sec-0006']) },
    });
    await r.session.init();
    expect(r.session.getView().totalCount).toBe(2);
    await walkToEnd(r.session);
    const summary = (await r.client.summary()) as Obj;
    expect(summary).toMatchObject({ passed: 0, returned: 2, tomorrow: { total: 6, capped: false, shown: 6, overflow: 0 } });
    const v = r.session.getView();
    expect(v.state).toBe('done');
    expect(v.summaryLines).toEqual(['通過 0 張、退回 2 張。', '明天預估 6 張。']);
  });

  it('超過 daily_cap(4):capped、shown = 上限、overflow = 超出的張數;畫面照第 4 句', async () => {
    const r = await rig({
      cards: 6,
      dailyCap: 4,
      entries: { 'sec-0001': { stage: 1, overdue: 2 }, 'sec-0002': { stage: 1, overdue: 1 }, ...dueTomorrow(['sec-0003', 'sec-0004', 'sec-0005', 'sec-0006']) },
    });
    await r.session.init();
    await walkToEnd(r.session);
    const summary = (await r.client.summary()) as Obj;
    expect(summary).toMatchObject({ tomorrow: { total: 6, capped: true, shown: 4, overflow: 2 } });
    expect(r.session.getView().summaryLines).toEqual(['通過 0 張、退回 2 張。', '明天預估 4 張(已到每天上限,另 2 張順延)。']);
  });

  it('剛好等於上限不算超過(capped false)', async () => {
    const r = await rig({
      cards: 6,
      dailyCap: 6,
      entries: { 'sec-0001': { stage: 1, overdue: 2 }, 'sec-0002': { stage: 1, overdue: 1 }, ...dueTomorrow(['sec-0003', 'sec-0004', 'sec-0005', 'sec-0006']) },
    });
    await r.session.init();
    await walkToEnd(r.session);
    expect(r.session.getView().summaryLines).toEqual(['通過 0 張、退回 2 張。', '明天預估 6 張。']);
  });
});

