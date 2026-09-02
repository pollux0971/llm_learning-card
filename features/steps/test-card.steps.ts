/**
 * 06-test-card / phase-1。
 *
 * 這裡直接呼叫 apps/test-card/src 底下的真實模組(session.ts、stubs/*),不重寫一份邏輯——
 * 這樣測試驗的是 App.svelte 實際在用的程式碳,不是測試自己編的替身。
 * features/steps/ 是膠水,不受 npm run boundaries 限制,可以這樣 import(見 packages/core/README.md)。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';

import { MemoryFs } from '../../apps/test-card/src/stubs/memory-fs.js';
import { buildFsSeed, TODAY } from '../../apps/test-card/src/stubs/fixtures.js';
import { selectDue, advance as realAdvance } from '../../apps/test-card/src/stubs/scheduler.js';
import { StubGrader } from '../../apps/test-card/src/stubs/grader.js';
import { loadQuestions, loadReviews, loadDailyCap } from '../../apps/test-card/src/stubs/loader.js';
import { TestSession, type Grader } from '../../apps/test-card/src/session.js';
import type {
  ApplyQuestion,
  CurrentQuestion,
  DueItem,
  FillQuestion,
  QuestionFile,
  SchedulerAdvanceFn,
  Stage,
} from '../../apps/test-card/src/types.js';

interface GraderCallLog {
  fill: { question: FillQuestion; typed: string[] }[];
  apply: { question: ApplyQuestion; typed: string }[];
}

interface AdvanceCallLog {
  count: number;
}

interface TestCardState {
  due: DueItem[];
  questions: Record<string, QuestionFile>;
  innerGrader: StubGrader;
  grader: Grader;
  graderCalls: GraderCallLog;
  advance: SchedulerAdvanceFn;
  advanceCalls: AdvanceCallLog;
  session: TestSession;
  applyInputValue: string;
  lastTypedAnswers?: string[];
  lastTypedAnswer?: string;
  questionBefore: CurrentQuestion | undefined;
}

declare module './_world.js' {
  interface LearningWorld {
    testCard?: TestCardState;
  }
}

function makeSpyGrader(inner: StubGrader): { grader: Grader; calls: GraderCallLog } {
  const calls: GraderCallLog = { fill: [], apply: [] };
  const grader: Grader = {
    async gradeFill(question, typed) {
      calls.fill.push({ question, typed });
      return inner.gradeFill(question, typed);
    },
    async gradeApply(question, typed) {
      calls.apply.push({ question, typed });
      return inner.gradeApply(question, typed);
    },
  };
  return { grader, calls };
}

function makeSpyAdvance(inner: SchedulerAdvanceFn): { advance: SchedulerAdvanceFn; calls: AdvanceCallLog } {
  const calls: AdvanceCallLog = { count: 0 };
  const advance: SchedulerAdvanceFn = (review, ctx) => {
    calls.count += 1;
    return inner(review, ctx);
  };
  return { advance, calls };
}

export async function buildTestCardState(): Promise<TestCardState> {
  const fs = new MemoryFs(buildFsSeed());
  const reviews = await loadReviews(fs);
  const dailyCap = await loadDailyCap(fs);
  const { due } = selectDue(reviews, TODAY, dailyCap);
  const questions = await loadQuestions(fs, due.map((d) => d.card));

  const innerGrader = new StubGrader();
  const { grader, calls: graderCalls } = makeSpyGrader(innerGrader);
  const { advance, calls: advanceCalls } = makeSpyAdvance(realAdvance);

  const session = new TestSession({ due, questions, grader, advance, today: TODAY });

  return {
    due,
    questions,
    innerGrader,
    grader,
    graderCalls,
    advance,
    advanceCalls,
    session,
    applyInputValue: '',
    questionBefore: undefined,
  };
}

function state(world: LearningWorld): TestCardState {
  if (!world.testCard) throw new Error('尚未執行 Background(the development server is running against the rich fixture set)');
  return world.testCard;
}

// ---------------------------------------------------------------- Given

// 「the development server is running against the rich fixture set」跟 07-teach-card
// 逐字相同,依規則移到 common.steps.ts 用 tag 分派,這裡不重複定義。

Given('three questions are due', function (this: LearningWorld) {
  assert.equal(state(this).due.length, 3, `預期三張到期卡,實際 ${state(this).due.length}`);
});

Given('the current question is a fill question', function (this: LearningWorld) {
  const view = state(this).session.getView();
  assert.equal(view.current?.type, 'fill', `目前題型是 ${view.current?.type ?? '(無)'},預期 fill`);
});

Given('the current question is an apply question', function (this: LearningWorld) {
  const s = state(this);
  let view = s.session.getView();
  if (view.current?.type !== 'apply') {
    s.session.next();
    view = s.session.getView();
  }
  assert.equal(view.current?.type, 'apply', `目前題型是 ${view.current?.type ?? '(無)'},預期 apply`);
});

Given('the stub grader returns an error result', function (this: LearningWorld) {
  state(this).innerGrader.configureError(true);
});

Given('the stub scheduler is swapped for the real one from the core package', function (this: LearningWorld) {
  // packages/core/src/scheduler 目前只有 .gitkeep(04-scheduler 還沒實作)。
  // 用一個符合契約 §6 簽章 (review, ctx) => SchedulerOutcome 的替身代表「真的那個」,
  // 驗的是型別相容、session.ts 不用改一行——不是真的去 import 04 的產出。
  const s = state(this);
  const substituteAdvance: SchedulerAdvanceFn = (review, ctx) => ({
    review: {
      ...review,
      stage: (ctx.pass ? Math.min(6, review.stage + 1) : 1) as Stage,
      next_due: ctx.today,
    },
    events: [],
  });
  s.session = new TestSession({ due: s.due, questions: s.questions, grader: s.grader, advance: substituteAdvance, today: TODAY });
});

// ---------------------------------------------------------------- When

Then('opening it shows the first question', function (this: LearningWorld) {
  const s = state(this);
  const view = s.session.getView();
  assert.ok(view.current, '沒有題目可顯示');
  assert.equal(view.current!.card, s.due[0]!.card, '顯示的不是排序後第一張到期卡');
});

When('the person presses enter', async function (this: LearningWorld) {
  const s = state(this);
  const view = s.session.getView();
  const action = s.session.decideKeydown('Enter');
  if (action === 'newline') {
    s.applyInputValue += '\n';
    return;
  }
  if (action !== 'submit') return;
  if (view.current?.type === 'fill' && view.current.fill) {
    s.lastTypedAnswers = view.current.fill.answers.map(() => '占位答案');
    await s.session.submitFill(s.lastTypedAnswers);
  } else if (view.current?.type === 'apply') {
    s.lastTypedAnswer = '占位作答內容';
    await s.session.submitApply(s.lastTypedAnswer);
  }
});

When('the person presses the submit shortcut', async function (this: LearningWorld) {
  const s = state(this);
  const view = s.session.getView();
  assert.equal(view.current?.type, 'apply', '提交快捷鍵的場景應該在應用題上');
  const action = s.session.decideKeydown('Enter', { ctrl: true });
  assert.equal(action, 'submit', '修飾鍵 + enter 應該送出');
  s.lastTypedAnswer = '占位作答內容';
  await s.session.submitApply(s.lastTypedAnswer);
});

When('the person submits an answer', async function (this: LearningWorld) {
  const s = state(this);
  const view = s.session.getView();
  s.questionBefore = view.current;
  if (view.current?.type === 'apply') {
    await s.session.submitApply('任意作答內容');
  } else {
    const blanks = view.current?.fill?.answers.length ?? 1;
    await s.session.submitFill(Array.from({ length: blanks }, () => '任意答案'));
  }
});

When('the interface loads', function (this: LearningWorld) {
  state(this).session.getView();
});

// ---------------------------------------------------------------- Then

Then('the stub grader is called with the typed answers', function (this: LearningWorld) {
  const s = state(this);
  assert.equal(s.graderCalls.fill.length, 1, `填空題 stub grader 應該被呼叫一次,實際 ${s.graderCalls.fill.length}`);
  assert.deepEqual(s.graderCalls.fill[0]!.typed, s.lastTypedAnswers);
});

Then('the stub grader is called with the typed answer', function (this: LearningWorld) {
  const s = state(this);
  assert.equal(s.graderCalls.apply.length, 1, `應用題 stub grader 應該被呼叫一次,實際 ${s.graderCalls.apply.length}`);
  assert.equal(s.graderCalls.apply[0]!.typed, s.lastTypedAnswer);
});

Then('nothing is submitted', function (this: LearningWorld) {
  const s = state(this);
  assert.equal(s.graderCalls.fill.length, 0, '不該呼叫填空題的 stub grader');
  assert.equal(s.graderCalls.apply.length, 0, '不該呼叫應用題的 stub grader');
});

Then('a newline is added to the input', function (this: LearningWorld) {
  assert.ok(state(this).applyInputValue.endsWith('\n'), `輸入內容應該以換行結尾,實際 ${JSON.stringify(state(this).applyInputValue)}`);
});

Then('no scheduler transition is applied', function (this: LearningWorld) {
  assert.equal(state(this).advanceCalls.count, 0, '不該呼叫排程的 advance');
});

Then('the interface says grading failed and to try again', function (this: LearningWorld) {
  const view = state(this).session.getView();
  assert.ok(view.error, '應該要有錯誤訊息');
});

Then('the question stays in the session', function (this: LearningWorld) {
  const s = state(this);
  const view = s.session.getView();
  assert.equal(view.current?.card, s.questionBefore?.card, '出錯後不該換卡');
  assert.equal(view.current?.type, s.questionBefore?.type, '出錯後不該換題型');
});

Then('it compiles and runs without any change to the interface code', function (this: LearningWorld) {
  const s = state(this);
  const view = s.session.getView();
  assert.ok(view.current, '換了排程實作後,session 應該還能正常給出目前題目');
  assert.doesNotThrow(() => s.session.next(), '換了排程實作後,session.next() 不該丟例外');
});
