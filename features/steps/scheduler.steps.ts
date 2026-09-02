/**
 * 04-scheduler 的步驟定義。共用句子(exits with status / today is / 純函式不變性)
 * 已在 common.steps.ts,這裡不重複定義。
 */
import { Given, When, Then, Before, DataTable } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';
import {
  addIsoDays,
  applyLearnedTransition,
  applyPassTransition,
  buildDueList,
  questionTypesForStage,
} from '../../packages/core/src/scheduler/index.js';
import type {
  CardId,
  DueItem,
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

Before(function () {
  singleReview = undefined;
  learnedAt = undefined;
  lastOutcome = undefined;
  dueList = undefined;
  requestedTypes = undefined;
  reviewState = undefined;
});

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

Then(/^they are ([a-z,]+)$/, function (typesStr: string) {
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
