/**
 * 06-test-card / phase-1(T24 之後改接新的後端)。
 *
 * 這裡直接呼叫 apps/test-card/src 底下的真實模組(session.ts),後端是程序內的真 core:
 * `createReviewClient({ handler: createReviewHandler(…) })` + 暫存根 + 假 router(features/support/test-card-rig.ts)。
 * Wave 0 的 stubs 沒了(T24):`.feature` 的字一個都沒改,下面的步驟對舊句子給新的意思——
 *   「stub grader is configured to take four seconds」= 假 router 延遲 4 秒、
 *   「stub grader returns an error result」= 假 router 對應用題回不合法的回應、
 *   「stub grader is called with …」= 送給 core 批改的就是打的那些答案(client.submit 的參數)、
 *   「The stubs are drop in replaceable」= 考試卡用的就是 core 的 scheduler(經 handler),session.ts 裡沒有排程。
 * features/steps/ 是膠水,不受 npm run boundaries 限制,可以這樣 import(見 packages/core/README.md)。
 */
import { After, Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LearningWorld } from './_world.js';
import { seedApplyQuestion } from './review-cli.steps.js';
import { phase2Active, phase2Load } from './teach-card-phase2.steps.js';
import {
  answerCurrent,
  createRig,
  terminalDueCards,
  type Rig,
  type Session,
  type View,
} from '../support/test-card-rig.js';
import { reviewsPath } from '../support/review-session-harness.js';

interface TestCardState {
  rig: Rig;
  session: Session;
  applyAnswer: string;
  lastTypedAnswers?: string[];
  lastTypedAnswer?: string;
  applyInputValue: string;
  questionBefore: View['current'];
  reviewsBefore: string | undefined;
}

declare module './_world.js' {
  interface LearningWorld {
    testCard?: TestCardState;
  }
}

/** 三張到期卡:第一張 stage 2(先填空再應用)、第二張 stage 1(填空)、第三張 stage 3(應用);第一張逾期最多 */
const PHASE1_CARDS = {
  'sec-0001': { stage: 2, overdue: 8 },
  'sec-0002': { stage: 1, overdue: 2 },
  'sec-0003': { stage: 3, overdue: 1 },
};

export async function buildTestCardState(): Promise<TestCardState> {
  const rig = await createRig({ cards: 3, entries: PHASE1_CARDS });
  await rig.session.init();
  return {
    rig,
    session: rig.session,
    applyAnswer: 'PASSALL 我的回答',
    applyInputValue: '',
    questionBefore: undefined,
    reviewsBefore: undefined,
  };
}

function state(world: LearningWorld): TestCardState {
  if (!world.testCard) throw new Error('尚未執行 Background(the development server is running against the rich fixture set)');
  return world.testCard;
}

After({ tags: '@test-card' }, function (this: LearningWorld) {
  this.testCard?.rig.dispose();
});

function submits(s: TestCardState): { method: string; arg?: unknown }[] {
  return s.rig.calls.filter((c) => c.method === 'submit');
}

/** 目前在填空題就答掉(隨便填)再按下一題,直到在應用題。 */
async function moveToApplyQuestion(s: TestCardState): Promise<void> {
  for (let i = 0; i < 6 && s.session.getView().current?.type !== 'apply'; i += 1) {
    await answerCurrent(s.session);
    await s.session.next();
  }
  // 佈置用的呼叫不算場景裡的動作:後面的「送出了什麼」只看之後的
  s.rig.calls.length = 0;
}

// ---------------------------------------------------------------- Given

// 「the development server is running against the rich fixture set」跟 07-teach-card
// 逐字相同,依規則移到 common.steps.ts 用 tag 分派,這裡不重複定義。

Given('three questions are due', function (this: LearningWorld) {
  const total = state(this).session.getView().totalCount;
  assert.equal(total, 3, `預期三張到期卡,實際 ${total}`);
});

Given('the current question is a fill question', function (this: LearningWorld) {
  const view = state(this).session.getView();
  assert.equal(view.current?.type, 'fill', `目前題型是 ${view.current?.type ?? '(無)'},預期 fill`);
});

// 11-review-cli 的 phase-1.feature 剛好也用一模一樣的文字(它是手動組
// session.current,不是操作這裡真的 TestSession/getView())——用 tag 分派
// 避免 cucumber 的 ambiguous-step 錯誤(跟 grading.steps.ts 對 phase-1/phase-2
// 共用句子的作法一致)。
Given('the current question is an apply question', async function (this: LearningWorld) {
  if (this.tags.includes('@review-cli')) {
    seedApplyQuestion(this);
    return;
  }
  const s = state(this);
  await moveToApplyQuestion(s);
  const view = s.session.getView();
  assert.equal(view.current?.type, 'apply', `目前題型是 ${view.current?.type ?? '(無)'},預期 apply`);
});

Given('the stub grader returns an error result', async function (this: LearningWorld) {
  // 假 router 對應用題回不合法的回應(作答文字帶 GARBAGE 標記);批改失敗只會出現在應用題,所以先移到應用題
  const s = state(this);
  s.applyAnswer = 'GARBAGE 亂回';
  await moveToApplyQuestion(s);
});

Given('the stub scheduler is swapped for the real one from the core package', function (this: LearningWorld) {
  // T24 之後沒有替身:考試卡經 handler 用的就是 core 的 scheduler。這句只確認那條路是通的(handler 已經在跑)。
  assert.ok(state(this).rig.calls.some((c) => c.method === 'start'), '考試卡應該已經對 core 的 handler 呼叫過 start');
});

// ---------------------------------------------------------------- When

Then('opening it shows the first question', async function (this: LearningWorld) {
  const s = state(this);
  const view = s.session.getView();
  assert.ok(view.current, '沒有題目可顯示');
  const terminal = await terminalDueCards(s.rig.vault);
  assert.equal(view.current!.card, terminal[0], '顯示的不是排序後第一張到期卡(終端機看到的第一張)');
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
  if (view.current?.type === 'fill') {
    s.lastTypedAnswers = Array.from({ length: view.current.blanks }, () => '占位答案');
    await s.session.submitFill(s.lastTypedAnswers);
  } else if (view.current?.type === 'apply') {
    s.lastTypedAnswer = '占位作答內容 PASSALL';
    await s.session.submitApply(s.lastTypedAnswer);
  }
});

When('the person presses the submit shortcut', async function (this: LearningWorld) {
  const s = state(this);
  const view = s.session.getView();
  assert.equal(view.current?.type, 'apply', '提交快捷鍵的場景應該在應用題上');
  const action = s.session.decideKeydown('Enter', { ctrl: true });
  assert.equal(action, 'submit', '修飾鍵 + enter 應該送出');
  s.lastTypedAnswer = '占位作答內容 PASSALL';
  await s.session.submitApply(s.lastTypedAnswer);
});

When('the person submits an answer', async function (this: LearningWorld) {
  const s = state(this);
  const view = s.session.getView();
  s.questionBefore = view.current;
  s.reviewsBefore = readFileSync(reviewsPath(s.rig.vault), 'utf8');
  if (view.current?.type === 'apply') {
    await s.session.submitApply(s.applyAnswer);
  } else {
    await s.session.submitFill(Array.from({ length: view.current?.blanks ?? 1 }, () => '任意答案'));
  }
});

When('the interface loads', { timeout: 180_000 }, async function (this: LearningWorld) {
  // 07-teach-card phase-2 的 Background 把 world 標成 phase-2 之後,改派到 teach-card-phase2.steps.ts(真的側車)
  if (phase2Active(this)) {
    await phase2Load(this);
    return;
  }
  state(this).session.getView();
});

// ---------------------------------------------------------------- Then

Then('the stub grader is called with the typed answers', function (this: LearningWorld) {
  const s = state(this);
  const calls = submits(s);
  assert.equal(calls.length, 1, `填空題應該送給 core 批改一次,實際 ${calls.length}`);
  assert.deepEqual(calls[0]!.arg, { fill: s.lastTypedAnswers });
});

Then('the stub grader is called with the typed answer', function (this: LearningWorld) {
  const s = state(this);
  const calls = submits(s);
  assert.equal(calls.length, 1, `應用題應該送給 core 批改一次,實際 ${calls.length}`);
  assert.deepEqual(calls[0]!.arg, { apply: s.lastTypedAnswer });
});

Then('nothing is submitted', function (this: LearningWorld) {
  const s = state(this);
  assert.equal(submits(s).length, 0, '不該送出任何答案');
});

Then('a newline is added to the input', function (this: LearningWorld) {
  assert.ok(state(this).applyInputValue.endsWith('\n'), `輸入內容應該以換行結尾,實際 ${JSON.stringify(state(this).applyInputValue)}`);
});

Then('no scheduler transition is applied', function (this: LearningWorld) {
  const s = state(this);
  assert.notEqual(s.reviewsBefore, undefined, '送出前沒有記下 reviews.json');
  assert.equal(readFileSync(reviewsPath(s.rig.vault), 'utf8'), s.reviewsBefore, '批改失敗,reviews.json 不該有任何變動');
});

Then('the interface says grading failed and to try again', function (this: LearningWorld) {
  const view = state(this).session.getView();
  assert.equal(view.gradingError, '評分失敗,請再試一次');
});

Then('the question stays in the session', function (this: LearningWorld) {
  const s = state(this);
  const view = s.session.getView();
  assert.equal(view.current?.card, s.questionBefore?.card, '出錯後不該換卡');
  assert.equal(view.current?.type, s.questionBefore?.type, '出錯後不該換題型');
});

Then('it compiles and runs without any change to the interface code', async function (this: LearningWorld) {
  const s = state(this);
  const view = s.session.getView();
  assert.ok(view.current, '接上真的 scheduler 後,session 應該還能正常給出目前題目');
  // 考試卡的程式裡沒有排程:session.ts 不 import 任何排程、批改或 stubs
  const src = readFileSync(join(import.meta.dirname, '../../apps/test-card/src/session.ts'), 'utf8');
  for (const name of ['selectSession', 'selectDue', 'advance', 'gradeFill', 'gradeApply', 'StubScheduler', 'StubGrader', 'MemoryFs']) {
    assert.ok(!new RegExp(`\\b${name}\\b`).test(src), `session.ts 不該有 ${name}`);
  }
  // 出的題目順序就是 core 的 scheduler 排的(終端機看到的清單)
  const terminal = await terminalDueCards(s.rig.vault);
  assert.equal(view.current!.card, terminal[0]);
  await assert.doesNotReject(async () => {
    await answerCurrent(s.session);
    await s.session.next();
  }, '接上真的 scheduler 後,按下一題不該丟例外');
});
