/**
 * 04-scheduler 的步驟定義。共用句子(exits with status / today is / 純函式不變性)
 * 已在 common.steps.ts,這裡不重複定義。
 */
import { Given, When, Then, Before, DataTable } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';
import {
  addIsoDays,
  applyFailTransition,
  applyLearnedTransition,
  applyPassTransition,
  buildDueList,
  questionTypesForStage,
} from '../../packages/core/src/scheduler/index.js';
import type {
  CardId,
  DueItem,
  Grader,
  IsoDate,
  QuestionType,
  Review,
  SchedulerOutcome,
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

Before(function () {
  singleReview = undefined;
  learnedAt = undefined;
  lastOutcome = undefined;
  dueList = undefined;
  requestedTypes = undefined;
  reviewState = undefined;
  failsInRowBeforeMultiAnswer = undefined;
});

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
