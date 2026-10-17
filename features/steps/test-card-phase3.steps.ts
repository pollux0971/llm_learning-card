/**
 * 06-test-card / phase-3(T23)的四個自動場景:續答、當天名單固定、跨日重建、明天預估。
 * 紅測試作者寫;開發 worker 不改。`.feature` 的字一個都沒改(四個 @manual 場景不在這裡)。
 *
 * 後端跟 phase-2 一樣是程序內的真 core(createReviewHandler + 暫存根 + 假 router,features/support/test-card-rig.ts)。
 * 每個場景一個暫存根;用 `TestSession` 的 view(逾期數、已答 / 總數、小結句子)看結果。
 *
 * 有四句 Gherkin 的字跟 11-review-cli 的步驟一模一樣(`the estimate is computed`、`it resumes at the third question`、
 * `more cards have become due since`、`yesterday's three are one day more overdue`):cucumber 不允許兩個定義對到同一句,
 * 所以原來的那四個定義最前面加一行 `if (p3Active(this)) return …`,是 phase-3 的場景(已經跑過這個檔的 Given)就轉到這裡。這四句的函式在這個檔匯出(p3Estimate、p3Resumes、p3MoreCards、p3Yesterday),定義留在原來的檔。
 * 其他場景不受影響(`this.testCardP3` 沒設)。
 */
import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';
import { DEFAULT_FIVE_ORDER, TODAY, answerCurrent, createRig, walkToEnd, type Obj, type Rig, type View } from '../support/test-card-rig.js';
import { addDays, readReviews, reviewRecord, writeReviews } from '../support/review-session-harness.js';

interface Estimate {
  view: View;
  summary: Obj;
}

interface Phase3State {
  rigs: Rig[];
  // 明天預估
  dueTomorrow?: number;
  returnedToday?: number;
  estimate?: Estimate;
  // 續答
  overdueBefore?: number;
  reopened?: { start: Obj; view: View };
  // 當天名單固定
  morningIds?: string[];
  walked?: string[];
  // 跨日
  yesterdayDays?: number;
  yesterdayOverdue?: number;
  today?: { start: Obj; view: View; days: Record<string, number> };
}

declare module './_world.js' {
  interface LearningWorld {
    testCardP3?: Phase3State;
  }
}

function st(world: LearningWorld): Phase3State {
  if (!world.testCardP3) world.testCardP3 = { rigs: [] };
  return world.testCardP3;
}

export function p3Active(world: LearningWorld): boolean {
  return world.testCardP3 !== undefined;
}

After({ tags: '@test-card and @phase-3' }, function (this: LearningWorld) {
  for (const r of this.testCardP3?.rigs ?? []) r.dispose();
});

async function rig(world: LearningWorld, opts: Parameters<typeof createRig>[0]): Promise<Rig> {
  const r = await createRig(opts);
  st(world).rigs.push(r);
  return r;
}

// ---------------------------------------------------------------- 場景:明天預估

Given('four cards were already due tomorrow', function (this: LearningWorld) {
  st(this).dueTomorrow = 4;
});

Given('two cards were returned today', function (this: LearningWorld) {
  st(this).returnedToday = 2;
});

async function estimateWithCap(world: LearningWorld, dailyCap: number | undefined): Promise<Estimate> {
  const s = st(world);
  assert.equal(s.dueTomorrow, 4);
  assert.equal(s.returnedToday, 2);
  const entries: Record<string, { stage: number; overdue: number }> = { 'sec-0001': { stage: 1, overdue: 2 }, 'sec-0002': { stage: 1, overdue: 1 } };
  for (const id of ['sec-0003', 'sec-0004', 'sec-0005', 'sec-0006']) entries[id] = { stage: 1, overdue: -1 };
  const r = await rig(world, { cards: 6, entries, ...(dailyCap !== undefined ? { dailyCap } : {}) });
  await r.session.init();
  assert.equal(r.session.getView().totalCount, 2, '今天只有兩張到期(明天才到期的四張不在今天)');
  await walkToEnd(r.session);
  const view = r.session.getView();
  assert.equal(view.state, 'done', `答完要是小結畫面:${JSON.stringify(view)}`);
  return { view, summary: (await r.client.summary()) as Obj };
}

export async function p3Estimate(world: LearningWorld): Promise<void> {
  st(world).estimate = await estimateWithCap(world, undefined);
}

Then('it reports six', function (this: LearningWorld) {
  const e = st(this).estimate;
  assert.ok(e, '先要算預估');
  const tomorrow = e.summary.tomorrow as { total: number; capped: boolean; shown: number; overflow: number };
  assert.deepEqual(tomorrow, { total: 6, capped: false, shown: 6, overflow: 0 });
  assert.deepEqual(e.view.summaryLines, ['通過 0 張、退回 2 張。', '明天預估 6 張。'], '畫面要說明天預估 6 張,而且沒有說上限');
});

Then('if that exceeds the cap it reports the cap and how many defer', async function (this: LearningWorld) {
  const capped = await estimateWithCap(this, 4);
  const tomorrow = capped.summary.tomorrow as { total: number; capped: boolean; shown: number; overflow: number };
  assert.deepEqual(tomorrow, { total: 6, capped: true, shown: 4, overflow: 2 });
  assert.deepEqual(capped.view.summaryLines, ['通過 0 張、退回 2 張。', '明天預估 4 張(已到每天上限,另 2 張順延)。']);
});

// ---------------------------------------------------------------- 場景:關到一半,同一天再開,接著做

Given('five questions were due and two were answered before closing', async function (this: LearningWorld) {
  const s = st(this);
  const r = await rig(this, {});
  await r.session.init();
  s.overdueBefore = r.session.getView().overdueCount;
  for (let i = 0; i < 2; i += 1) {
    await answerCurrent(r.session);
    await r.session.next();
  }
  assert.equal(r.session.getView().answeredCount, 2);
});

When('the interface is reopened the same day', async function (this: LearningWorld) {
  const s = st(this);
  const r = s.rigs[0]!;
  const opened = await r.reopen();
  const start = (await opened.client.start()) as Obj;
  // 再開一個新的視窗(新的 handler)用 TestSession 看畫面
  const window = await r.reopen();
  await window.session.init();
  s.reopened = { start, view: window.session.getView() };
});

export function p3Resumes(world: LearningWorld): void {
  const re = st(world).reopened;
  assert.ok(re, '先要重開');
  assert.equal(re.start.resumed, true);
  assert.equal(re.start.answered, 2);
  assert.equal(re.view.state, 'question');
  assert.equal(re.view.current?.card, DEFAULT_FIVE_ORDER[2], '應該從第三題接著問');
}

Then('the header shows two of five', function (this: LearningWorld) {
  const s = st(this);
  const re = s.reopened;
  assert.ok(re);
  assert.equal(re.view.answeredCount, 2);
  assert.equal(re.view.totalCount, 5);
  assert.equal(re.view.overdueCount, s.overdueBefore, '逾期數跟關掉前一樣');
});

// ---------------------------------------------------------------- 場景:當天名單建好就固定

const TEN = Array.from({ length: 10 }, (_, i) => `sec-${String(i + 1).padStart(4, '0')}`);

Given('the session was built in the morning with ten questions', async function (this: LearningWorld) {
  const s = st(this);
  const entries: Record<string, { stage: number; overdue: number }> = {};
  TEN.forEach((id, i) => {
    entries[id] = { stage: 1, overdue: 10 - i };
  });
  const r = await rig(this, { cards: 12, entries });
  await r.session.init();
  assert.equal(r.session.getView().totalCount, 10);
  s.morningIds = TEN;
});

export function p3MoreCards(world: LearningWorld): void {
  const s = st(world);
  const r = s.rigs[0]!;
  const reviews = readReviews(r.vault);
  reviews['sec-0011'] = reviewRecord({ stage: 1, next_due: TODAY });
  reviews['sec-0012'] = reviewRecord({ stage: 1, next_due: addDays(TODAY, -30) });
  writeReviews(r.vault, reviews);
}

When('the interface is reopened later the same day', async function (this: LearningWorld) {
  const s = st(this);
  const window = await s.rigs[0]!.reopen();
  await window.session.init();
  s.walked = await walkToEnd(window.session);
});

Then('the same ten questions are used', function (this: LearningWorld) {
  const s = st(this);
  assert.deepEqual(s.walked, s.morningIds, '早上建好的十張,同樣的順序');
});

Then('the newly due cards wait until tomorrow', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(!s.walked!.includes('sec-0011') && !s.walked!.includes('sec-0012'), '新到期的卡今天不該被問');
  const after = readReviews(s.rigs[0]!.vault);
  assert.equal(after['sec-0011']!.history.length, 0);
  assert.equal(after['sec-0012']!.history.length, 0);
});

// ---------------------------------------------------------------- 場景:過了午夜重建

Given('three questions were left unanswered yesterday', async function (this: LearningWorld) {
  const s = st(this);
  const yesterday = addDays(TODAY, -1);
  const r = await rig(this, {
    today: yesterday,
    entries: { 'sec-0001': { stage: 1, overdue: 0 }, 'sec-0002': { stage: 1, overdue: 0 }, 'sec-0003': { stage: 1, overdue: 0 } },
  });
  await r.session.init();
  const v = r.session.getView();
  s.yesterdayDays = v.current!.overdueDays;
  s.yesterdayOverdue = v.overdueCount;
  assert.equal(v.totalCount, 3);
});

When('the interface is opened today', async function (this: LearningWorld) {
  const s = st(this);
  const r = s.rigs[0]!;
  const probe = await r.reopen(TODAY);
  const start = (await probe.client.start()) as Obj;
  const window = await r.reopen(TODAY);
  await window.session.init();
  const first = window.session.getView();
  const days: Record<string, number> = {};
  for (let i = 0; i < 6 && window.session.getView().state === 'question'; i += 1) {
    const v = window.session.getView();
    days[v.current!.card] = v.current!.overdueDays;
    await answerCurrent(window.session);
    await window.session.next();
  }
  s.today = { start, view: first, days };
});

Then('the session is rebuilt', function (this: LearningWorld) {
  const t = st(this).today;
  assert.ok(t);
  assert.equal(t.start.resumed, false, '換日之後要重建,不是續答');
  assert.equal(t.start.answered, 0);
  assert.equal(t.start.total, 3);
});

export function p3Yesterday(world: LearningWorld): void {
  const s = st(world);
  const t = s.today;
  assert.ok(t);
  assert.deepEqual(Object.keys(t.days).sort(), ['sec-0001', 'sec-0002', 'sec-0003']);
  for (const [card, days] of Object.entries(t.days)) assert.equal(days, s.yesterdayDays! + 1, `${card} 應該比昨天多逾期一天`);
  assert.equal(t.view.overdueCount, 3, '今天三張都逾期 1 天,逾期數是 3');
  assert.ok(t.view.overdueCount > s.yesterdayOverdue!, '逾期數跟著變');
}

