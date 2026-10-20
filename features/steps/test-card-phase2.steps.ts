/**
 * 06-test-card / phase-2(T24):考試卡接上真的 core。
 *
 * 後端是程序內的真 core(createReviewHandler + 暫存根 + 假 router,features/support/test-card-rig.ts),
 * 「終端機」那一邊是真的 `scripts/review.ts --dry-run` 行程。`.feature` 的字一個都沒改。
 * 路徑防護那一條走 10 的 probe 邊界(跟 Tauri command 同一個 learning_fs),見 desktop-shell-phase2.steps.ts 的 requestPathOutsideDirectory。
 *
 * T22 加的五個場景(側車訊息、向量、重起、環境變數)的步驟不在這裡(那五個由 T22 的 vitest / cargo 測試守)。
 */
import { After, Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';
import { requestPathOutsideDirectory } from './desktop-shell-phase2.steps.js';
import { i3AnsweredOneQuestion, i3FixedDirectoryAndDate, isI3 } from './i3-desktop-review.steps.js';
import {
  DEFAULT_FIVE_ORDER,
  TODAY,
  answerCurrent,
  createRig,
  seed,
  terminalDueCards,
  walkToEnd,
  type Rig,
} from '../support/test-card-rig.js';
import { readReviews, type ReviewRecord } from '../support/review-session-harness.js';

interface Phase2State {
  rig: Rig;
  expectedList: string[];
  walked: string[];
  applyAnswer: string;
  answeredCard: string | undefined;
  recordBefore: ReviewRecord | undefined;
  card: string | undefined;
  terminalList: string[];
}

declare module './_world.js' {
  interface LearningWorld {
    testCardP2?: Phase2State;
  }
}

function p2(world: LearningWorld): Phase2State {
  if (!world.testCardP2) throw new Error('尚未執行 Background(the desktop application is running against a real learning directory)');
  return world.testCardP2;
}

After({ tags: '@test-card and @phase-2' }, function (this: LearningWorld) {
  this.testCardP2?.rig.dispose();
});

Given('the desktop application is running against a real learning directory', async function (this: LearningWorld) {
  // 暫存根 = learning-minimal 的複本(補到六張卡),五張到期;帳本身分、XDG、HOME 都在同一個 mkdtemp 底下
  this.testCardP2 = {
    rig: await createRig(),
    expectedList: [],
    walked: [],
    applyAnswer: 'PASSALL 我的回答',
    answeredCard: undefined,
    recordBefore: undefined,
    card: undefined,
    terminalList: [],
  };
});

// ---------------------------------------------------------------- 場景:清單跟真的 scheduler 一樣

Given('a fixed learning directory and a fixed date', async function (this: LearningWorld) {
  // 同一句也在 docs/integration/i3-desktop-review.feature:那邊的版本在 i3-desktop-review.steps.ts(真側車)
  if (isI3(this)) return i3FixedDirectoryAndDate(this);
  const s = p2(this);
  assert.equal(this.today, TODAY, '固定日期應該是 2026-09-10');
  // 真的 scheduler 的答案由終端機那條路(scripts/review.ts --dry-run)給
  s.expectedList = await terminalDueCards(s.rig.vault);
  assert.deepEqual(s.expectedList, DEFAULT_FIVE_ORDER, `終端機看到的清單應該是固定的五張:${JSON.stringify(s.expectedList)}`);
});

When("the card builds its question list from the real scheduler", async function (this: LearningWorld) {
  const s = p2(this);
  await s.rig.session.init();
  s.walked = await walkToEnd(s.rig.session);
});

Then("the list matches the scheduler's due list in content and order", function (this: LearningWorld) {
  const s = p2(this);
  assert.deepEqual(s.walked, s.expectedList, '考試卡依序問的卡,應該跟 scheduler 的到期清單內容與順序一樣');
  assert.equal(s.rig.session.getView().state, 'done');
});

// ---------------------------------------------------------------- 場景:目錄外的檔案碰不到

When('the interface is made to request a path outside the directory', async function (this: LearningWorld) {
  await requestPathOutsideDirectory(this);
});

// Then('the request is refused') 已在 desktop-shell-phase2.steps.ts 定義(同一個邊界、同一句)。

// ---------------------------------------------------------------- 場景:答案馬上寫進去

Given('the person has answered one question', async function (this: LearningWorld) {
  // 同一句也在 I3:那邊的版本在 i3-desktop-review.steps.ts(真側車)
  if (isI3(this)) return i3AnsweredOneQuestion(this);
  const s = p2(this);
  await s.rig.session.init();
  s.answeredCard = s.rig.session.getView().current!.card;
  await answerCurrent(s.rig.session);
});

When('the process is killed without a clean exit', function (this: LearningWorld) {
  // 程序內沒有「乾淨結束」這一步:不按下一題、不叫 summary、不關任何東西,直接丟掉 session / handler / client 的參照。
  const s = p2(this);
  s.rig.session = undefined as never;
  s.rig.client = undefined as never;
});

Then('that answer is present in the review state on disk', function (this: LearningWorld) {
  const s = p2(this);
  const record = readReviews(s.rig.vault)[s.answeredCard!];
  assert.ok(record, `${s.answeredCard} 不在 reviews.json`);
  assert.equal(record!.history.length, 1, '那一題的答案應該已經在磁碟上');
  assert.equal(record!.history[0]!.date, TODAY);
});

// ---------------------------------------------------------------- 場景:視窗與終端機一致

Given('the person answers two questions in the interface', async function (this: LearningWorld) {
  const s = p2(this);
  await s.rig.session.init();
  for (let i = 0; i < 2; i += 1) {
    await answerCurrent(s.rig.session);
    await s.rig.session.next();
  }
});

When('the review command is run in the terminal', async function (this: LearningWorld) {
  const s = p2(this);
  s.terminalList = await terminalDueCards(s.rig.vault);
});

Then('it offers the remaining questions', function (this: LearningWorld) {
  const s = p2(this);
  assert.deepEqual(s.terminalList, DEFAULT_FIVE_ORDER.slice(2), '終端機應該只提供視窗還沒答的三張,順序不變');
});

// ---------------------------------------------------------------- 場景:批改錯誤不動卡片

/** 「the cloud grader returns an unparseable response twice」在 i2-review-loop.steps.ts 依 tag 分派到這裡。 */
export function seedTestCardGradingError(world: LearningWorld): void {
  const s = p2(world);
  seed(s.rig.vault, { 'sec-0001': { stage: 3, overdue: 2 } });
  s.applyAnswer = 'GARBAGE 亂回'; // 假 router 對含 GARBAGE 的作答回不合法的內容;core 會問兩次(重試一次)才放棄
  s.card = 'sec-0001';
  s.recordBefore = readReviews(s.rig.vault)['sec-0001'];
}

When('an apply answer is submitted', async function (this: LearningWorld) {
  const s = p2(this);
  await s.rig.session.init();
  assert.equal(s.rig.session.getView().current?.type, 'apply', '這個場景的卡是 stage 3,先問應用題');
  await s.rig.session.submitApply(s.applyAnswer);
});

Then("the card's stage on disk is unchanged", function (this: LearningWorld) {
  const s = p2(this);
  assert.deepEqual(readReviews(s.rig.vault)[s.card!], s.recordBefore, '批改失敗,reviews.json 裡那張卡不該有任何變動');
  assert.equal(readReviews(s.rig.vault)[s.card!]!.stage, 3);
  assert.equal(s.rig.router.applyCalls, 2, '雲端應該被問了剛好兩次(第一次不合法,重試一次仍不合法才放棄)');
});

Then('the question remains in the session', function (this: LearningWorld) {
  const s = p2(this);
  const view = s.rig.session.getView();
  assert.equal(view.current?.card, s.card);
  assert.equal(view.current?.type, 'apply');
  assert.equal(view.gradingError, '評分失敗,請再試一次');
});
