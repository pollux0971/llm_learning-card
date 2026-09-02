/**
 * 08-weekly-goal / phase-1 的步驟定義。
 * 商業邏輯都在 packages/core/src/weekly/;這裡只是薄薄一層轉接。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { addWeeks, format as formatDate, parseISO, subWeeks } from 'date-fns';
import type { LearningWorld } from './_world.js';
import { applyEvent, isTargetMet, isoWeekOf } from '../../packages/core/src/weekly/index.js';
import type { ApplyOutcome, Weekly, WeeklyEvent } from '../../packages/core/src/weekly/index.js';

declare module './_world.js' {
  interface LearningWorld {
    weeklyState?: Weekly;
    weeklyOutcome?: ApplyOutcome;
    /** Given「today falls in …」明確指定的目標週,覆蓋掉從 this.today 算出來的週 */
    weeklyTargetWeek?: string;
    weeklyCard?: string;
    weeklyCheckpoint?: number;
    /** apply() 每次呼叫前的快照,給「unchanged / preserved」類的 Then 用 */
    weeklyPassedBefore?: number;
    weeklyWeekBefore?: string;
    weeklyTargetBefore?: number;
  }
}

const DEFAULT_CARD = 'sec-0001';

function currentWeekFor(world: LearningWorld): string {
  return world.weeklyTargetWeek ?? isoWeekOf(world.today);
}

/** 唯一的套用入口:記快照、呼叫純函式、把結果寫回 world。 */
function apply(world: LearningWorld, event: WeeklyEvent, week?: string): ApplyOutcome {
  const state = world.weeklyState;
  assert.ok(state, '尚未設定 weekly state(Given 要先建立)');
  world.weeklyPassedBefore = state.passed_d1;
  world.weeklyWeekBefore = state.week;
  world.weeklyTargetBefore = state.target;
  const outcome = applyEvent(state, event, week ?? currentWeekFor(world));
  world.weeklyOutcome = outcome;
  world.weeklyState = outcome.weekly;
  return outcome;
}

function neutralEvent(world: LearningWorld): WeeklyEvent {
  // checkpoint 2 通過不計數,用來測歸零邏輯而不干擾計數斷言
  return { type: 'checkpoint-passed', card: world.weeklyCard ?? DEFAULT_CARD, checkpoint: 2 };
}

// ---------------------------------------------------------------- Given

Given(
  /^a weekly state for week (\S+) with a target of (\d+) and both counts at zero$/,
  function (this: LearningWorld, week: string, target: string) {
    this.weeklyState = { week, target: Number(target), learned: 0, passed_d1: 0, counted: [] };
  },
);

Given('a card at the first checkpoint', function (this: LearningWorld) {
  this.weeklyCard = DEFAULT_CARD;
  this.weeklyCheckpoint = 1;
});

Given('a card at the second checkpoint', function (this: LearningWorld) {
  this.weeklyCard = DEFAULT_CARD;
  this.weeklyCheckpoint = 2;
});

Given('a card already counted this week', function (this: LearningWorld) {
  this.weeklyCard = DEFAULT_CARD;
  apply(this, { type: 'checkpoint-passed', card: DEFAULT_CARD, checkpoint: 1 });
});

Given('it later failed and returned to the first checkpoint', function (this: LearningWorld) {
  // scheduler 負責失敗轉移;週目標只在乎「本週是否已計過這張卡的 D1」,狀態不用動。
});

Given('a card was learned on the last day of the previous week', function (this: LearningWorld) {
  this.weeklyCard = DEFAULT_CARD;
  apply(this, { type: 'learned', card: DEFAULT_CARD });
});

Given(
  /^the passed count is (\d+) and the target is (\d+)$/,
  function (this: LearningWorld, passed: string, target: string) {
    this.weeklyState = { week: '2026-W37', target: Number(target), learned: 0, passed_d1: Number(passed), counted: [] };
  },
);

Given(/^the stored week is (\S+)$/, function (this: LearningWorld, week: string) {
  assert.ok(this.weeklyState, 'Background 應該已經建立 weekly state');
  this.weeklyState = { ...this.weeklyState, week };
});

Given('the stored week is three weeks behind', function (this: LearningWorld) {
  assert.ok(this.weeklyState, 'Background 應該已經建立 weekly state');
  const staleDate = formatDate(subWeeks(parseISO(this.today), 3), 'yyyy-MM-dd');
  this.weeklyState = { ...this.weeklyState, week: isoWeekOf(staleDate) };
});

Given(/^today falls in (\S+)$/, function (this: LearningWorld, week: string) {
  this.weeklyTargetWeek = week;
});

Given('the previous week reached three of seven', function (this: LearningWorld) {
  // 用跟目前系統日期距離夠遠的週,確保「the week rolls over」一定會觸發歸零。
  this.weeklyState = { week: '2026-W20', target: 7, learned: 5, passed_d1: 3, counted: ['sec-0001', 'sec-0002', 'sec-0003'] };
});

Given(/^the date is (\S+)$/, function (this: LearningWorld, date: string) {
  this.today = date;
});

Given('a weekly state object', function (this: LearningWorld) {
  const obj: Weekly = { week: '2026-W37', target: 7, learned: 2, passed_d1: 1, counted: ['sec-0001'] };
  this.weeklyState = this.trackInput(obj);
});

// ---------------------------------------------------------------- When

When('the standalone weekly command is run against a fixture with a pass event', function (this: LearningWorld) {
  this.runStandalone();
});

When('a learned event arrives', function (this: LearningWorld) {
  apply(this, { type: 'learned', card: this.weeklyCard ?? DEFAULT_CARD });
});

When('it passes', function (this: LearningWorld) {
  assert.ok(this.weeklyCheckpoint, 'Given 要先指定第幾個 checkpoint');
  apply(this, { type: 'checkpoint-passed', card: this.weeklyCard ?? DEFAULT_CARD, checkpoint: this.weeklyCheckpoint });
});

When('it passes the first checkpoint again', function (this: LearningWorld) {
  apply(this, { type: 'checkpoint-passed', card: this.weeklyCard ?? DEFAULT_CARD, checkpoint: 1 });
});

When('it passes its first checkpoint on the Monday', function (this: LearningWorld) {
  const nextWeek = isoWeekOf(formatDate(addWeeks(parseISO(this.today), 1), 'yyyy-MM-dd'));
  apply(this, { type: 'checkpoint-passed', card: this.weeklyCard ?? DEFAULT_CARD, checkpoint: 1 }, nextWeek);
});

When('the target check runs', function (this: LearningWorld) {
  assert.ok(this.weeklyState, '尚未設定 weekly state');
  this.lastResult = isTargetMet(this.weeklyState.passed_d1, this.weeklyState.target);
});

When('any event arrives', function (this: LearningWorld) {
  apply(this, neutralEvent(this));
});

When('the week rolls over', function (this: LearningWorld) {
  apply(this, neutralEvent(this));
});

When('the ISO week is computed', function (this: LearningWorld) {
  this.lastResult = isoWeekOf(this.today);
});

When('an event is applied', function (this: LearningWorld) {
  assert.ok(this.weeklyState, '尚未設定 weekly state');
  const outcome = applyEvent(this.weeklyState, { type: 'learned', card: DEFAULT_CARD }, this.weeklyState.week);
  this.weeklyOutcome = outcome;
  this.lastResult = outcome.weekly;
});

// ---------------------------------------------------------------- Then

Then('it prints the updated counts and whether the target is met', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過任何指令');
  assert.match(this.lastRun.output, /"passed_d1"/);
  assert.match(this.lastRun.output, /"target_met"/);
});

Then('the learned count is one', function (this: LearningWorld) {
  assert.equal(this.weeklyState?.learned, 1);
});

Then('the passed count is still zero', function (this: LearningWorld) {
  assert.equal(this.weeklyState?.passed_d1, 0);
});

Then('the passed count is one', function (this: LearningWorld) {
  assert.equal(this.weeklyState?.passed_d1, 1);
});

Then('the passed count is unchanged', function (this: LearningWorld) {
  assert.equal(this.weeklyState?.passed_d1, this.weeklyPassedBefore);
});

Then('the card remains in the counted list', function (this: LearningWorld) {
  assert.ok(this.weeklyState?.counted.includes(this.weeklyCard ?? DEFAULT_CARD));
});

Then("this week's passed count increases", function (this: LearningWorld) {
  assert.ok(this.weeklyState);
  assert.ok(this.weeklyState.passed_d1 > (this.weeklyPassedBefore ?? 0));
});

Then('a rollover event is logged for the old week', function (this: LearningWorld) {
  assert.ok(this.weeklyOutcome?.rollover, '應該要有 rollover');
  assert.equal(this.weeklyOutcome.rollover.week, this.weeklyWeekBefore);
});

Then('the counts reset to zero', function (this: LearningWorld) {
  assert.equal(this.weeklyState?.learned, 0);
  assert.equal(this.weeklyState?.passed_d1, 0);
});

Then('the counted list is emptied', function (this: LearningWorld) {
  assert.deepEqual(this.weeklyState?.counted, []);
});

Then('the target is preserved', function (this: LearningWorld) {
  assert.equal(this.weeklyState?.target, this.weeklyTargetBefore);
});

Then('the rollover event records that the target was not met', function (this: LearningWorld) {
  assert.equal(this.weeklyOutcome?.rollover?.target_met, false);
});

Then('nothing else changes', function (this: LearningWorld) {
  assert.equal(this.weeklyState?.learned, 0);
  assert.equal(this.weeklyState?.passed_d1, 0);
  assert.deepEqual(this.weeklyState?.counted, []);
  assert.equal(this.weeklyState?.target, this.weeklyTargetBefore);
});

Then('exactly one rollover event is logged for the stored week', function (this: LearningWorld) {
  assert.ok(this.weeklyOutcome?.rollover, '應該要有 rollover');
  assert.equal(this.weeklyOutcome.rollover.week, this.weeklyWeekBefore);
});

Then('the state is set to the current week', function (this: LearningWorld) {
  assert.equal(this.weeklyState?.week, isoWeekOf(this.today));
});

Then(/^it is (\S+)$/, function (this: LearningWorld, week: string) {
  assert.equal(this.lastResult, week);
});
