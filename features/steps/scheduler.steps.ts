/**
 * 04-scheduler 的步驟定義。共用句子(exits with status / today is / 純函式不變性)
 * 已在 common.steps.ts,這裡不重複定義。
 */
import { Given, When, Then, Before, DataTable } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';
import { seedCardsDue } from './review-cli.steps.js';
import {
  addIsoDays,
  applyFailTransition,
  applyLearnedTransition,
  applyPassTransition,
  buildDueList,
  computeOverdueRatio,
  intervalDaysForStage,
  questionTypesForStage,
  selectSession,
  simulateSteadyState,
} from '../../packages/core/src/scheduler/index.js';
import type {
  CardId,
  DueItem,
  Grader,
  IsoDate,
  OverdueCtx,
  QuestionType,
  Review,
  SchedulableCard,
  SchedulerOutcome,
  SelectResult,
  SimulationReport,
  Stage,
} from '../../packages/core/src/scheduler/index.js';

const DEFAULT_CARD: CardId = 'sec-0001';

function reviewAtStage(stage: Stage): Review {
  return {
    stage,
    learned_at: '2026-01-01',
    next_due: stage === 6 ? null : '2026-01-02',
    fails_in_row: 0,
    total_fails: 0,
    stuck: false,
    history: [],
  };
}

// 這個檔案內的場景全部循序執行(cucumber 預設不平行),所以用模組層級變數
// 存放單一場景的暫存狀態就夠了,不用動 features/steps/_world.ts(共用檔)。
let singleReview: Review | undefined;
let learnedAt: IsoDate | undefined;
let lastOutcome: SchedulerOutcome | undefined;
let dueList: DueItem[] | undefined;
let requestedTypes: QuestionType[] | undefined;
let reviewState: Record<CardId, Review> | undefined;
// phase-2:「stage 2 兩題都考」場景用來確認「只回退一次」——記下呼叫前的連錯數。
let failsInRowBeforeMultiAnswer: number | undefined;

// ---------------------------------------------------------------- phase-3
let dailyCap: number | undefined;
let selectDueCards: SchedulableCard[] | undefined;
let selectDueCardsSnapshot: string | undefined;
let selectReteach: CardId[] | undefined;
let selectResult: SelectResult | undefined;
let selectError: Error | undefined;
let overdueCardCtx: OverdueCtx | undefined;
let overdueToday: IsoDate | undefined;
let overdueRatioResult: number | undefined;
let simulationReport: SimulationReport | undefined;
// 「Deferred cards are one day more overdue tomorrow」場景:day1/day2 的到期清單與
// 「被順延的卡片 id」,給兩個 Then 分別斷言用。
let rolloverReviews: Record<CardId, Review> | undefined;
let rolloverDay1: IsoDate | undefined;
let rolloverDay1Cards: SchedulableCard[] | undefined;
let rolloverDay2Cards: SchedulableCard[] | undefined;
let rolloverDeferredIds: CardId[] | undefined;

Before(function () {
  singleReview = undefined;
  learnedAt = undefined;
  lastOutcome = undefined;
  dueList = undefined;
  requestedTypes = undefined;
  reviewState = undefined;
  failsInRowBeforeMultiAnswer = undefined;

  dailyCap = undefined;
  selectDueCards = undefined;
  selectDueCardsSnapshot = undefined;
  selectReteach = undefined;
  selectResult = undefined;
  selectError = undefined;
  overdueCardCtx = undefined;
  overdueToday = undefined;
  overdueRatioResult = undefined;
  simulationReport = undefined;
  rolloverReviews = undefined;
  rolloverDay1 = undefined;
  rolloverDay1Cards = undefined;
  rolloverDay2Cards = undefined;
  rolloverDeferredIds = undefined;
});

/** 逾期比例:day.late / 間隔天數(intervals.ts 的權威表,不重新發明數字)。用在
 * Given 步驟裡組裝 fixture,跟被測的 computeOverdueRatio 分開,避免用「還沒實作」
 * 的函式去建立測試資料、把設定階段也一起弄紅。 */
function ratioForStageAndLateDays(stage: Stage, daysLate: number): number {
  return daysLate / intervalDaysForStage(stage);
}

function makeDueCard(id: CardId, overrides: Partial<SchedulableCard> = {}): SchedulableCard {
  return {
    card: id,
    stage: 1,
    types: questionTypesForStage(1),
    overdue_days: 1,
    overdue_ratio: 1,
    stuck: false,
    learned_at: '2026-01-01',
    ...overrides,
  };
}

/** N 張卡,overdue_ratio 依序遞減,只用在「幾張卡到期」這類不在乎排序理由的場景。 */
function makeDueCards(n: number): SchedulableCard[] {
  return Array.from({ length: n }, (_, i) =>
    makeDueCard(`sec-${String(i + 1).padStart(4, '0')}`, { overdue_ratio: n - i }),
  );
}

function toSchedulableCards(items: DueItem[], reviews: Record<CardId, Review>): SchedulableCard[] {
  return items.map((item) => ({ ...item, learned_at: reviews[item.card]!.learned_at }));
}

/** fill 用 exact,apply 用 cloud——跟契約 §5 的 Grader 分組一致,只是預設值。 */
function defaultGraderFor(type: QuestionType): Grader {
  return type === 'fill' ? 'exact' : 'cloud';
}

// ---------------------------------------------------------------- Given

Given('a card at stage {int}', function (stage: number) {
  singleReview = reviewAtStage(stage as Stage);
});

Given('a review state object', function () {
  singleReview = reviewAtStage(2);
});

Given(/^a card marked learned on (\d{4}-\d{2}-\d{2})$/, function (date: string) {
  learnedAt = date;
});

Given(/^a card due on (\d{4}-\d{2}-\d{2}) in a timezone that changes offset that day$/, function (date: string) {
  learnedAt = date;
});

// ---------------------------------------------------------- Given(phase-2)

Given('a card with two consecutive failures and two total', function () {
  singleReview = { ...reviewAtStage(3), fails_in_row: 2, total_fails: 2 };
});

Given('a card with one consecutive failure', function () {
  singleReview = { ...reviewAtStage(3), fails_in_row: 1, total_fails: 1 };
});

Given('a card with no consecutive failures', function () {
  singleReview = { ...reviewAtStage(3), fails_in_row: 0, total_fails: 0 };
});

Given('a card with two consecutive failures', function () {
  singleReview = { ...reviewAtStage(3), fails_in_row: 2, total_fails: 2 };
});

Given('a stuck card', function () {
  singleReview = { ...reviewAtStage(3), fails_in_row: 3, total_fails: 3, stuck: true };
});

Given('a stuck card at stage 1 due today', function (this: LearningWorld) {
  reviewState = {
    [DEFAULT_CARD]: {
      stage: 1,
      learned_at: '2026-01-01',
      next_due: this.today,
      fails_in_row: 3,
      total_fails: 3,
      stuck: true,
      history: [],
    },
  };
});

// Scenario Outline「Repeated failure and recovery」的 Given。用數字/true|false
// 的 regex,跟上面幾句固定字面(two/one/no)不會撞——cucumber 用文字比對,
// 「two」不會滿足 (\d+),兩邊各自唯一匹配。
Given(/^a card with (\d+) consecutive failures and stuck (true|false)$/, function (before: string, stuckBefore: string) {
  singleReview = { ...reviewAtStage(3), fails_in_row: Number(before), stuck: stuckBefore === 'true' };
});

Given('the following review state:', function (table: DataTable) {
  reviewState = {};
  for (const row of table.hashes()) {
    reviewState[row.id!] = {
      stage: Number(row.stage) as Stage,
      learned_at: '2026-01-01',
      next_due: row.next_due ? row.next_due : null,
      fails_in_row: 0,
      total_fails: 0,
      stuck: false,
      history: [],
    };
  }
});

// ---------------------------------------------------------------- When

When('the standalone due command is run against a fixture state', function (this: LearningWorld) {
  this.runStandalone();
});

When('the learned transition is applied', function () {
  assert.ok(learnedAt, '還沒有 Given 學會日期');
  singleReview = applyLearnedTransition({ card: DEFAULT_CARD, learnedAt });
});

When('the pass transition is applied', function (this: LearningWorld) {
  assert.ok(singleReview, '還沒有 Given 一張卡片');
  this.trackInput(singleReview);
  const outcome = applyPassTransition(singleReview, {
    card: DEFAULT_CARD,
    today: this.today,
    type: 'fill',
    grader: 'exact',
  });
  lastOutcome = outcome;
  this.lastResult = outcome;
});

When('it passes a fill question graded exactly', function (this: LearningWorld) {
  assert.ok(singleReview, '還沒有 Given 一張卡片');
  lastOutcome = applyPassTransition(singleReview, {
    card: DEFAULT_CARD,
    today: this.today,
    type: 'fill',
    grader: 'exact',
  });
});

// ----------------------------------------------------------- When(phase-2)

// 沒有指名題型/評分者的通用「答錯」場景(scenario 1、3、4、5,以及 Outline 的
// fail 那一列)都吃這句;跟「the pass transition is applied」對稱地更新
// singleReview,讓 phase-1 就有的「it is due on」也能讀到答錯後的狀態。
When('the fail transition is applied', function (this: LearningWorld) {
  assert.ok(singleReview, '還沒有 Given 一張卡片');
  this.trackInput(singleReview);
  const type = questionTypesForStage(singleReview.stage)[0] ?? 'fill';
  const outcome = applyFailTransition(singleReview, {
    card: DEFAULT_CARD,
    today: this.today,
    answers: [{ type, pass: false, grader: defaultGraderFor(type) }],
  });
  lastOutcome = outcome;
  this.lastResult = outcome;
  singleReview = outcome.review;
});

When('the fill answer passes but the apply answer fails', function (this: LearningWorld) {
  assert.ok(singleReview, '還沒有 Given 一張卡片');
  this.trackInput(singleReview);
  failsInRowBeforeMultiAnswer = singleReview.fails_in_row;
  const outcome = applyFailTransition(singleReview, {
    card: DEFAULT_CARD,
    today: this.today,
    answers: [
      { type: 'fill', pass: true, grader: 'exact' },
      { type: 'apply', pass: false, grader: 'cloud' },
    ],
  });
  lastOutcome = outcome;
  this.lastResult = outcome;
  singleReview = outcome.review;
});

When('it fails an apply question graded by the cloud', function (this: LearningWorld) {
  assert.ok(singleReview, '還沒有 Given 一張卡片');
  this.trackInput(singleReview);
  const outcome = applyFailTransition(singleReview, {
    card: DEFAULT_CARD,
    today: this.today,
    answers: [{ type: 'apply', pass: false, grader: 'cloud' }],
  });
  lastOutcome = outcome;
  this.lastResult = outcome;
  singleReview = outcome.review;
});

When('the due list is built for any date', function () {
  assert.ok(singleReview, '還沒有 Given 一張卡片');
  dueList = buildDueList({ [DEFAULT_CARD]: singleReview }, '2099-01-01');
});

When('the due list is built', function (this: LearningWorld) {
  assert.ok(reviewState, '還沒有 Given 複習狀態表');
  dueList = buildDueList(reviewState, this.today);
});

When('the question types are requested', function () {
  assert.ok(singleReview, '還沒有 Given 一張卡片');
  requestedTypes = questionTypesForStage(singleReview.stage);
});

// 「Then the result is the same as in any other timezone」跟 common.steps.ts 的
// 「the result is {}」是同一句(anonymous 參數吃掉整段),所以不另外定義 Then,
// 這裡直接把比對結果寫進 this.resultText 給那個通用步驟讀。
When('the interval is added', function (this: LearningWorld) {
  assert.ok(learnedAt, '還沒有 Given 日期');
  const originalTz = process.env.TZ;
  try {
    process.env.TZ = 'Europe/London';
    const withDst = addIsoDays(learnedAt, 7);
    process.env.TZ = 'UTC';
    const withUtc = addIsoDays(learnedAt, 7);
    this.resultText = withDst === withUtc ? 'the same as in any other timezone' : `${withDst} vs ${withUtc}`;
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

// ---------------------------------------------------------------- Then

Then('it prints the cards due on the given date', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過 standalone 指令');
  assert.match(this.lastRun.output, /sec-\d{4}/, `輸出應包含到期卡片的 id:\n${this.lastRun.output}`);
});

Then('its stage is {int}', function (stage: number) {
  assert.ok(singleReview);
  assert.equal(singleReview.stage, stage);
});

Then(/^it is due on (\d{4}-\d{2}-\d{2})$/, function (date: string) {
  assert.ok(singleReview);
  assert.equal(singleReview.next_due, date);
});

Then('its stage becomes {int}', function (stage: number) {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.stage, stage);
});

Then(/^it is next due on (\d{4}-\d{2}-\d{2})$/, function (date: string) {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.next_due, date);
});

Then('it has no next due date', function () {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.next_due, null);
});

Then('that card is not included', function () {
  assert.ok(dueList);
  assert.ok(!dueList.some((d) => d.card === DEFAULT_CARD));
});

Then(/^they are ((?:fill|apply)(?:,(?:fill|apply))?)$/, function (typesStr: string) {
  assert.deepEqual(requestedTypes, typesStr.split(','));
});

Then(/^it contains (.+) only$/, function (idsStr: string) {
  assert.ok(dueList);
  const expected = idsStr.split(/,| and /).map((s) => s.trim()).filter(Boolean).sort();
  const actual = dueList.map((d) => d.card).sort();
  assert.deepEqual(actual, expected);
});

Then('a history entry records the date, the stage, the type, a pass and the grader', function (this: LearningWorld) {
  assert.ok(lastOutcome);
  const entry = lastOutcome.review.history.at(-1);
  assert.ok(entry, '歷史記錄是空的');
  assert.equal(entry.date, this.today);
  assert.equal(entry.stage, 1);
  assert.equal(entry.type, 'fill');
  assert.equal(entry.pass, true);
  assert.equal(entry.grader, 'exact');
});

// ----------------------------------------------------------- Then(phase-2)

Then('its consecutive failure count is {int}', function (n: number) {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.fails_in_row, n);
});

Then('its total failure count is {int}', function (n: number) {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.total_fails, n);
});

Then('the consecutive count is zero', function () {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.fails_in_row, 0);
});

Then('the total is still two', function () {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.total_fails, 2);
});

Then('the consecutive count is two', function () {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.fails_in_row, 2);
});

Then('a reteach event is emitted for that card', function () {
  assert.ok(lastOutcome);
  assert.ok(
    lastOutcome.events.some((e) => e.type === 'reteach_queued' && e.card === DEFAULT_CARD),
    `events 裡沒有 reteach_queued:${JSON.stringify(lastOutcome.events)}`,
  );
});

Then('no events are emitted', function () {
  assert.ok(lastOutcome);
  assert.deepEqual(lastOutcome.events, []);
});

Then('the card is marked stuck', function () {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.stuck, true);
});

Then('a stuck event is emitted', function () {
  assert.ok(lastOutcome);
  assert.ok(
    lastOutcome.events.some((e) => e.type === 'stuck' && e.card === DEFAULT_CARD),
    `events 裡沒有 stuck:${JSON.stringify(lastOutcome.events)}`,
  );
});

Then('it is included', function () {
  assert.ok(dueList);
  assert.ok(dueList.some((d) => d.card === DEFAULT_CARD));
});

Then('the entry is flagged as stuck', function () {
  assert.ok(dueList);
  const entry = dueList.find((d) => d.card === DEFAULT_CARD);
  assert.ok(entry, '到期清單裡沒有這張卡');
  assert.equal(entry.stuck, true);
});

Then('it is no longer stuck', function () {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.stuck, false);
});

Then('the caller applies one fail transition', function () {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.fails_in_row, (failsInRowBeforeMultiAnswer ?? 0) + 1);
});

Then('the history records both answers separately', function (this: LearningWorld) {
  assert.ok(lastOutcome);
  const entries = lastOutcome.review.history;
  assert.equal(entries.length, 2, `應該有兩筆 history,實際:${JSON.stringify(entries)}`);
  assert.deepEqual(entries[0], { date: this.today, stage: 2, type: 'fill', pass: true, grader: 'exact' });
  assert.deepEqual(entries[1], { date: this.today, stage: 2, type: 'apply', pass: false, grader: 'cloud' });
});

Then('a history entry records the failure with that grader', function () {
  assert.ok(lastOutcome);
  const entry = lastOutcome.review.history.at(-1);
  assert.ok(entry, '歷史記錄是空的');
  assert.equal(entry.pass, false);
  assert.equal(entry.type, 'apply');
  assert.equal(entry.grader, 'cloud');
});

// Scenario Outline「Repeated failure and recovery」的 Then。避開撞名:
// 01-data-layer/phase-2 的 data-layer.steps.ts 已經定義了字面完全相同的
// 「stuck is false」(讀 this.lastResult 當 Review,語意跟這裡的
// SchedulerOutcome.review.stuck 不同)。Outline 展開後 stuck_after=false 那三列
// 會產生字面上一模一樣的「stuck is false」,若沿用會撞名(cucumber 的 step
// 全域註冊、不分 tag),而且就算沒被判成 ambiguous、也可能誤用另一邊的資料
// 靜默通過。這裡改用不同措辭:「the resulting consecutive count is <after>」
// 「the outcomes stuck flag is <stuck_after>」,phase-2.feature 的 Outline 也
// 同步改了這兩行文字。
Then(/^the resulting consecutive count is (\d+)$/, function (after: string) {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.fails_in_row, Number(after));
});

Then(/^the outcomes stuck flag is (true|false)$/, function (stuckAfter: string) {
  assert.ok(lastOutcome);
  assert.equal(lastOutcome.review.stuck, stuckAfter === 'true');
});

// ============================================================ phase-3
// 每日上限、逾期比例優先序。對照 features/04-scheduler/phase-3.feature 的 10
// 個場景。selectSession / computeOverdueRatio / simulateSteadyState 這一輪
// 全部 throw not implemented(select.ts),所以這裡的場景現在會是紅的——
// 這是設計/測試輪的預期狀態,留給下一輪實作。

// ---------------------------------------------------------------- Given

Given('the daily cap is {int}', function (cap: number) {
  dailyCap = cap;
});

// 涵蓋「15 cards are due today」「8 cards are due」「10 cards are due」等說法。
// 11-review-cli 的 phase-1.feature 剛好也用「3 cards are due」——那句是佈置
// state/reviews.json,跟這裡佈置記憶體陣列給 selectSession 用完全是兩回事,
// 用 tag 分派避免 cucumber 的 ambiguous-step 錯誤(跟 grading.steps.ts 對
// phase-1/phase-2 共用句子的作法一致)。
Given(/^(\d+) cards are due(?: today)?$/, function (this: LearningWorld, n: string) {
  if (this.tags.includes('@review-cli')) {
    seedCardsDue(this, Number(n));
    return;
  }
  selectDueCards = makeDueCards(Number(n));
});

Given(/^a card at stage (\d+) that is (\d+) days late$/, function (stage: string, late: string) {
  const s = Number(stage) as Stage;
  const today = '2026-09-10';
  overdueToday = today;
  overdueCardCtx = { stage: s, next_due: addIsoDays(today, -Number(late)) };
});

Given('a card due today', function (this: LearningWorld) {
  overdueToday = this.today;
  overdueCardCtx = { stage: 1, next_due: this.today };
});

Given('the following due cards:', function (table: DataTable) {
  selectDueCards = table.hashes().map((row) => {
    const stage = Number(row.stage) as Stage;
    const daysLate = Number(row.days_late);
    return makeDueCard(row.id!, {
      stage,
      types: questionTypesForStage(stage),
      overdue_days: daysLate,
      overdue_ratio: ratioForStageAndLateDays(stage, daysLate),
    });
  });
});

Given('two stage one cards both one day late', function () {
  selectDueCards = [
    makeDueCard('sec-0001', { overdue_days: 1, overdue_ratio: ratioForStageAndLateDays(1, 1) }),
    makeDueCard('sec-0002', { overdue_days: 1, overdue_ratio: ratioForStageAndLateDays(1, 1) }),
  ];
});

Given('the first was learned earlier than the second', function () {
  assert.ok(selectDueCards && selectDueCards.length === 2, '還沒有 Given 兩張卡片');
  selectDueCards[0]!.learned_at = '2026-01-01';
  selectDueCards[1]!.learned_at = '2026-02-01';
});

Given(/^(\d+) cards are queued for reteach$/, function (n: string) {
  selectReteach = Array.from({ length: Number(n) }, (_, i) => `rte-${String(i + 1).padStart(4, '0')}`);
});

Given(/^(\d+) cards were due today and (\d+) were selected$/, function (this: LearningWorld, dueCount: string, _selectedCount: string) {
  const n = Number(dueCount);
  const reviews: Record<CardId, Review> = {};
  for (let i = 1; i <= n; i++) {
    const id = `sec-${String(i).padStart(4, '0')}`;
    reviews[id] = {
      stage: 1,
      // learned_at 依序遞增,讓比例相同時打平手的順序是確定的(見「the first
      // was learned earlier」那句同樣的邏輯:早學的排前面 → 晚學的先被順延)。
      learned_at: addIsoDays('2026-08-01', i),
      next_due: this.today,
      fails_in_row: 0,
      total_fails: 0,
      stuck: false,
      history: [],
    };
  }
  rolloverReviews = reviews;
  rolloverDay1 = this.today;
});

// ---------------------------------------------------------------- When

When('the session is selected', function () {
  assert.ok(dailyCap !== undefined, '還沒有 Given 每日上限');
  selectDueCardsSnapshot = JSON.stringify(selectDueCards ?? []);
  try {
    selectResult = selectSession(
      selectDueCards ?? [],
      selectReteach ? { dailyCap, reteach: selectReteach } : { dailyCap },
    );
    selectError = undefined;
  } catch (err) {
    selectError = err as Error;
    selectResult = undefined;
  }
});

When('the session is selected the following day', function () {
  assert.ok(rolloverReviews && rolloverDay1, '還沒有 Given 「N cards were due today and M were selected」');
  assert.ok(dailyCap !== undefined, '還沒有 Given 每日上限');

  const day1Cards = toSchedulableCards(buildDueList(rolloverReviews, rolloverDay1), rolloverReviews);
  const result1 = selectSession(day1Cards, { dailyCap });
  const selectedIds1 = new Set(result1.due.map((d) => d.card));
  rolloverDay1Cards = day1Cards;
  rolloverDeferredIds = day1Cards.map((d) => d.card).filter((id) => !selectedIds1.has(id));

  const day2 = addIsoDays(rolloverDay1, 1);
  const day2Cards = toSchedulableCards(buildDueList(rolloverReviews, day2), rolloverReviews);
  rolloverDay2Cards = day2Cards;
  selectResult = selectSession(day2Cards, { dailyCap });
});

When(/^the ratio is computed$/, function () {
  assert.ok(overdueCardCtx && overdueToday, '還沒有 Given 一張卡片');
  overdueRatioResult = computeOverdueRatio(overdueCardCtx, overdueToday);
});

When(/^the simulation runs for (\d+) days learning (\d+) cards per day$/, function (days: string, perDay: string) {
  assert.ok(dailyCap !== undefined, '還沒有 Given 每日上限');
  simulationReport = simulateSteadyState({ days: Number(days), newCardsPerDay: Number(perDay), dailyCap });
});

// ---------------------------------------------------------------- Then

Then(/^(\d+)(?: questions)? are returned$/, function (n: string) {
  assert.ok(selectResult, `session 選取沒有回傳結果;error=${selectError?.message ?? '無'}`);
  assert.equal(selectResult.due.length, Number(n));
});

Then(/^(\d+) are reported as deferred$/, function (n: string) {
  assert.ok(selectResult);
  assert.equal(selectResult.deferred, Number(n));
});

Then('none are deferred', function () {
  assert.ok(selectResult);
  assert.equal(selectResult.deferred, 0);
});

Then('the deferred cards keep their state', function () {
  assert.ok(selectDueCardsSnapshot !== undefined, '還沒有呼叫過 selectSession');
  assert.equal(JSON.stringify(selectDueCards ?? []), selectDueCardsSnapshot, '輸入的到期卡片被修改了');
});

Then(/^it is approximately ([\d.]+)$/, function (ratioStr: string) {
  assert.ok(overdueRatioResult !== undefined, '還沒有計算比例');
  const expected = Number(ratioStr);
  assert.ok(
    Math.abs(overdueRatioResult - expected) < 0.001,
    `期望約 ${expected},實際 ${overdueRatioResult}`,
  );
});

Then('it is zero', function () {
  assert.ok(overdueRatioResult !== undefined, '還沒有計算比例');
  assert.equal(overdueRatioResult, 0);
});

Then(/^the order is (.+)$/, function (idsStr: string) {
  assert.ok(selectResult);
  const expected = idsStr.split(',').map((s) => s.trim());
  assert.deepEqual(selectResult.due.map((d) => d.card), expected);
});

Then('the one learned earlier comes first', function () {
  assert.ok(selectResult && selectDueCards);
  const earlier = selectDueCards.reduce((a, b) => (a.learned_at < b.learned_at ? a : b));
  assert.equal(selectResult.due[0]?.card, earlier.card);
});

Then('an error is raised naming the cap', function () {
  assert.ok(selectError, `應該要丟錯,但沒有;dailyCap=${dailyCap}`);
  assert.match(selectError.message, new RegExp(String(dailyCap)));
});

Then(/^the (\d+) reteach cards are returned separately$/, function (n: string) {
  assert.ok(selectResult);
  assert.ok(selectReteach, '還沒有 Given reteach 佇列');
  assert.equal(selectResult.reteach.length, Number(n));
  assert.deepEqual(selectResult.reteach, selectReteach);
  for (const id of selectResult.reteach) {
    assert.ok(!selectResult.due.some((d) => d.card === id), `reteach 卡片 ${id} 不該出現在 due 裡`);
  }
});

Then(/^the (\d+) that were skipped are one day later$/, function (n: string) {
  assert.ok(rolloverDeferredIds, '還沒有跑過「the session is selected the following day」');
  const deferredIds: CardId[] = rolloverDeferredIds;
  const day1Cards: SchedulableCard[] = rolloverDay1Cards ?? [];
  const day2Cards: SchedulableCard[] = rolloverDay2Cards ?? [];
  assert.equal(deferredIds.length, Number(n));
  for (const id of deferredIds) {
    const dayOneEntry = day1Cards.find((d) => d.card === id)!;
    const dayTwoEntry = day2Cards.find((d) => d.card === id)!;
    assert.equal(dayTwoEntry.overdue_days, dayOneEntry.overdue_days + 1, `${id} 隔天的逾期天數應該 +1`);
  }
});

Then('they take part in the ordering again', function () {
  assert.ok(rolloverDeferredIds, '還沒有跑過「the session is selected the following day」');
  const deferredIds: CardId[] = rolloverDeferredIds;
  const day2Cards: SchedulableCard[] = rolloverDay2Cards ?? [];
  for (const id of deferredIds) {
    assert.ok(day2Cards.some((d) => d.card === id), `${id} 應該出現在隔天的到期候選清單裡`);
  }
});

Then('it reports the daily question count over time', function () {
  assert.ok(simulationReport, '還沒有跑模擬');
  assert.ok(simulationReport.daily.length > 0);
  assert.ok(simulationReport.daily.every((d) => typeof d.selected_count === 'number'));
});

Then('it reports how often the cap was reached', function () {
  assert.ok(simulationReport, '還沒有跑模擬');
  assert.equal(typeof simulationReport.cap_reached_days, 'number');
  assert.equal(typeof simulationReport.cap_reached_ratio, 'number');
});
