/**
 * 11-review-cli / phase-1。
 *
 * 「the review command is run」(scenario 2、3、13 共用同一句)不透過
 * spawn 一個真的子行程——互動流程需要餵好幾輪 stdin,真的 spawn 容易卡住
 * (readline 在沒有 input 時會一直等)。這裡改成直接呼叫 session 模組的函式
 * (buildTodaySession → presentNextCard/submitAnswer 迴圈),把結果整理成
 * `this.lastRun`,讓 common.steps.ts 的「it exits with status {int}」照樣能用。
 * 這正是 FEATURE.md 說的「把讀 stdin 的 IO 邊界隔開」——測試永遠不用真的
 * readline,只在 scripts/review.ts 的實作裡才會出現。
 *
 * Given 只負責佈置磁碟狀態(state/reviews.json、必要時的 cards/questions),
 * 不建立 session——session 一律由對應的 When 步驟(呼叫 buildTodaySession)
 * 建立,對照真實 CLI 的行為(先讀磁碟,才知道要問什麼)。
 *
 * @manual 的最後一個場景(「The session is pleasant enough to use daily」)
 * 刻意不定義 step,跟 05-grading phase-2 的慣例一致。
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CardId, Review } from '@contracts/index.js';
import { FakeLlmRouter, loadFixturesFromDir, type LlmRouter } from '@core/grading/index.js';
import { nextCalendarDay } from '@core/schema/review.js';
import { buildTodaySession } from '../../packages/core/src/session/build.js';
import { presentNextCard } from '../../packages/core/src/session/present.js';
import { joinApplyLines, submitAnswer } from '../../packages/core/src/session/answer.js';
import { estimateTomorrow, renderDryRun, renderSummary } from '../../packages/core/src/session/summary.js';
import type { AnswerOutcome, CardPresentation, CurrentQuestion, EstimateResult, Session } from '../../packages/core/src/session/types.js';
import type { LearningWorld, RunResult } from './_world.js';

const LLM_FIXTURES_DIR = resolve(import.meta.dirname, '../../contracts/fixtures/llm');

interface ReviewCliState {
  session?: Session;
  presentations: CardPresentation[];
  outcome?: AnswerOutcome;
  currentCard?: CardId;
  reviewsSnapshotBefore?: string;
  joinedApplyAnswer?: string;
  estimate?: EstimateResult;
  summaryText?: string;
  /** scenario 12 專用:兩個 Given 各填一半,When 合併成 estimateTomorrow 的輸入。 */
  dueTomorrowExcludingReturns?: number;
  returnedToday?: number;
}

const states = new WeakMap<LearningWorld, ReviewCliState>();

function stateOf(world: LearningWorld): ReviewCliState {
  let s = states.get(world);
  if (!s) {
    s = { presentations: [] };
    states.set(world, s);
  }
  return s;
}

function makeRouter(): LlmRouter {
  return new FakeLlmRouter(loadFixturesFromDir(LLM_FIXTURES_DIR));
}

function reviewsPath(world: LearningWorld): string {
  return join(world.dir!, 'state/reviews.json');
}

function readReviews(world: LearningWorld): Record<CardId, Review> {
  return JSON.parse(readFileSync(reviewsPath(world), 'utf8')) as Record<CardId, Review>;
}

function writeReviews(world: LearningWorld, reviews: Record<CardId, Review>): void {
  writeFileSync(reviewsPath(world), `${JSON.stringify(reviews, null, 2)}\n`);
}

function baseReview(overrides: Partial<Review> & Pick<Review, 'stage' | 'learned_at' | 'next_due'>): Review {
  return { fails_in_row: 0, total_fails: 0, stuck: false, history: [], ...overrides };
}

/**
 * 「the review command is run」的共用實作。走完整個 session:
 * build → 反覆 presentNextCard/submitAnswer,直到 'done'。不關心題目對錯,
 * 用空字串作答(fill/apply 對空白答案都不呼叫 router,見 grade-fill.ts /
 * grade-apply.ts 的空白短路),只是為了讓佇列往前走,scenario 2/3/13 都只
 * 檢查呈現順序與 progress,不檢查 pass/fail。
 */
async function runReviewCommand(world: LearningWorld): Promise<void> {
  const s = stateOf(world);
  const lines: string[] = [];
  try {
    s.session ??= await buildTodaySession({ learningDir: world.dir!, today: world.today, router: makeRouter() });
    s.presentations = [];
    for (;;) {
      const presentation = await presentNextCard(s.session);
      if (presentation.kind === 'done') break;
      s.presentations.push(presentation);
      if (presentation.kind === 'reteach') {
        lines.push(presentation.shortBody);
      } else {
        lines.push(`(${presentation.progress.index}/${presentation.progress.total}) ${presentation.prompt}`);
        await submitAnswer(s.session, '');
      }
    }
    if (s.presentations.length === 0) lines.push(renderDryRun([]));
    world.lastRun = { status: 0, stdout: lines.join('\n'), stderr: '', output: lines.join('\n') };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    world.lastRun = { status: 1, stdout: lines.join('\n'), stderr: message, output: `${lines.join('\n')}\n${message}` } satisfies RunResult;
  }
}

// ---------------------------------------------------------------- Given:磁碟狀態

Given('no cards are due today', function (this: LearningWorld) {
  writeReviews(this, {});
});

/**
 * 04-scheduler 的 phase-3.feature 已經用掉一模一樣的文字
 * (`/^(\d+) cards are due(?: today)?$/`,見 scheduler.steps.ts)——那句是佈置
 * `selectSession` 用的記憶體陣列,跟這裡要寫 state/reviews.json 完全是兩回事,
 * 兩邊剛好撞了同一句英文。cucumber 不准同一句話有兩個定義,所以不在這裡註冊
 * Given,改成匯出一個普通函式,由 scheduler.steps.ts 用 `this.tags` 分派
 * (跟 grading.steps.ts 對 phase-1/phase-2 共用句子的作法一致)。
 */
export function seedCardsDue(world: LearningWorld, n: number): void {
  const ids = ['sec-0001', 'sec-0002', 'sec-0003'].slice(0, n);
  assert.ok(ids.length === n, `learning-minimal fixture 只有 3 張卡有真的 card/question 檔,收到 n=${n}`);
  const reviews: Record<CardId, Review> = {};
  for (const id of ids) {
    reviews[id] = baseReview({ stage: 1, learned_at: '2026-09-09', next_due: world.today });
  }
  writeReviews(world, reviews);
}

Given('1 card is queued for reteach', function (this: LearningWorld) {
  // fails_in_row === 2:見 build.ts 的 deriveReteachQueue 設計決定。
  writeReviews(this, { 'sec-0001': baseReview({ stage: 1, learned_at: '2026-09-01', next_due: this.today, fails_in_row: 2 }) });
  const category = 'security';
  const frontmatter = `---\nid: sec-0001\ncategory: ${category}\ntitle: 同源政策\nlevel: 0\nsource: raw\ncreated: 2026-09-01\n---\n`;
  writeFileSync(join(this.dir!, 'cards', category, 'sec-0001.short.md'), `${frontmatter}同源:協定、主機、埠號三者相同。\n`);
});

Given('the current card has failed three times in a row', function (this: LearningWorld) {
  writeReviews(this, { 'sec-0001': baseReview({ stage: 1, learned_at: '2026-09-01', next_due: this.today, fails_in_row: 3, stuck: true }) });
});

// ---------------------------------------------------------------- When/Then:scenario 1(dry run)

When('the review command is run in dry run mode', async function (this: LearningWorld) {
  const reviews: Record<CardId, Review> = {
    'sec-0001': baseReview({ stage: 1, learned_at: '2026-09-05', next_due: '2026-09-07' }), // overdue_ratio 3.0
    'sec-0002': baseReview({ stage: 2, learned_at: '2026-09-01', next_due: '2026-09-09', history: [{ date: '2026-09-02', stage: 1, type: 'fill', pass: true, grader: 'exact' }] }), // overdue_ratio 1/7
    'sec-0003': baseReview({ stage: 3, learned_at: '2026-08-01', next_due: '2026-09-08' }), // overdue_ratio 2/30
  };
  writeReviews(this, reviews);
  const s = stateOf(this);
  s.reviewsSnapshotBefore = readFileSync(reviewsPath(this), 'utf8');
  try {
    s.session = await buildTodaySession({ learningDir: this.dir!, today: this.today, router: makeRouter() });
    const text = renderDryRun(s.session.queue.map((d) => ({ card: d.card, stage: d.stage, overdueDays: d.overdue_days })));
    this.lastRun = { status: 0, stdout: text, stderr: '', output: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    this.lastRun = { status: 1, stdout: '', stderr: message, output: message };
  }
});

Then('it prints each due card with its stage and how overdue it is', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑 dry run');
  for (const [id, stage] of [
    ['sec-0001', 1],
    ['sec-0002', 2],
    ['sec-0003', 3],
  ] as const) {
    assert.ok(this.lastRun!.output.includes(id), `輸出缺少 ${id}:\n${this.lastRun!.output}`);
    assert.ok(this.lastRun!.output.includes(String(stage)), `輸出缺少 stage ${stage}:\n${this.lastRun!.output}`);
  }
});

Then('it prints them in the order they would be asked', function (this: LearningWorld) {
  const out = this.lastRun!.output;
  const i1 = out.indexOf('sec-0001');
  const i2 = out.indexOf('sec-0002');
  const i3 = out.indexOf('sec-0003');
  assert.ok(i1 >= 0 && i2 > i1 && i3 > i2, `期望 sec-0001 → sec-0002 → sec-0003 的順序,實際輸出:\n${out}`);
});

Then('no file is written', function (this: LearningWorld) {
  const s = stateOf(this);
  assert.equal(readFileSync(reviewsPath(this), 'utf8'), s.reviewsSnapshotBefore, 'dry run 不該寫任何檔案');
});

// ---------------------------------------------------------------- When/Then:scenario 2/3/13(互動 session)

When('the review command is run', async function (this: LearningWorld) {
  await runReviewCommand(this);
});

Then('it says there is nothing due', function (this: LearningWorld) {
  const s = stateOf(this);
  assert.equal(s.presentations.length, 0);
  assert.match(this.lastRun?.output ?? '', /nothing|沒有|無/i);
});

Then('the cards are presented in the order the scheduler returned', function (this: LearningWorld) {
  const s = stateOf(this);
  const questionCards = s.presentations.filter((p) => p.kind === 'question').map((p) => (p as { card: CardId }).card);
  assert.deepEqual(questionCards, ['sec-0001', 'sec-0002', 'sec-0003']);
});

Then('the progress is shown before each question', function (this: LearningWorld) {
  const s = stateOf(this);
  const progressions = s.presentations
    .filter((p): p is Extract<CardPresentation, { kind: 'question' }> => p.kind === 'question')
    .map((p) => p.progress);
  assert.deepEqual(
    progressions.map((p) => p.index),
    [1, 2, 3],
  );
  assert.ok(progressions.every((p) => p.total === 3));
});

Then('the shortened version is shown before the first question', function (this: LearningWorld) {
  const s = stateOf(this);
  assert.equal(s.presentations[0]?.kind, 'reteach');
  assert.equal(s.presentations[1]?.kind, 'question');
});

Then('it is not counted in the progress', function (this: LearningWorld) {
  const s = stateOf(this);
  const question = s.presentations[1];
  assert.ok(question && question.kind === 'question');
  assert.equal((question as Extract<CardPresentation, { kind: 'question' }>).progress.index, 1);
});

// ---------------------------------------------------------------- scenario 4:fill 三個空格,一行逗號分隔

Given('the current question is a fill question with three blanks', function (this: LearningWorld) {
  const s = stateOf(this);
  const card = 'sec-fill3';
  s.currentCard = card;
  writeReviews(this, { [card]: baseReview({ stage: 1, learned_at: '2026-09-09', next_due: this.today }) });
  s.session = {
    learningDir: this.dir!,
    today: this.today,
    dailyCap: 10,
    router: makeRouter(),
    queue: [{ card, stage: 1, types: ['fill'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
    reteachQueue: [],
    totalDue: 1,
    deferred: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    current: {
      card,
      stage: 1,
      overdueDays: 0,
      overdueRatio: 0,
      stuck: false,
      types: ['fill'],
      typeIndex: 0,
      fillQuestion: {
        prompt: '同源的判定條件是 ___、___、___ 三者相同。',
        answers: [['協定'], ['主機'], ['埠號']],
      },
      pendingAnswers: [],
      hadError: false,
    } satisfies CurrentQuestion,
  };
});

When('the person enters three answers separated by commas', async function (this: LearningWorld) {
  const s = stateOf(this);
  // 中間那格故意答錯,證明「each blank is graded separately」——feedback 要指名第 2 格。
  s.outcome = await submitAnswer(s.session!, '協定, 錯誤答案, 埠號');
});

Then('each blank is graded separately', function (this: LearningWorld) {
  const s = stateOf(this);
  assert.equal(s.outcome!.status, 'failed');
  assert.match(s.outcome!.feedback, /2/);
});

Then('the fill-question feedback is shown', function (this: LearningWorld) {
  const s = stateOf(this);
  assert.ok(s.outcome!.feedback.length > 0);
});

// ---------------------------------------------------------------- scenario 5:apply 多行合併

/**
 * 06-test-card 的 test-card.steps.ts 也用一模一樣的文字(它是操作真的
 * TestCardSession/getView(),跟這裡手動組 session.current 完全是兩回事)。
 * 理由跟上面的 seedCardsDue 一樣:不在這裡註冊 Given,改成匯出函式,由
 * test-card.steps.ts 用 `this.tags` 分派。
 */
export function seedApplyQuestion(world: LearningWorld): void {
  const s = stateOf(world);
  const card = 'sec-apply1';
  s.currentCard = card;
  writeReviews(world, { [card]: baseReview({ stage: 3, learned_at: '2026-08-01', next_due: world.today }) });
  s.session = {
    learningDir: world.dir!,
    today: world.today,
    dailyCap: 10,
    router: makeRouter(),
    queue: [{ card, stage: 3, types: ['apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
    reteachQueue: [],
    totalDue: 1,
    deferred: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    current: {
      card,
      stage: 3,
      overdueDays: 0,
      overdueRatio: 0,
      stuck: false,
      types: ['apply'],
      typeIndex: 0,
      applyQuestion: { prompt: '跨來源請求會遇到什麼問題?', rubric: ['有指出這是跨來源請求', '有提出至少一個解法'] },
      pendingAnswers: [],
      hadError: false,
    } satisfies CurrentQuestion,
  };
}

When('the person enters several lines and ends the input', async function (this: LearningWorld) {
  const s = stateOf(this);
  const lines = ['這是跨來源請求,CORS 是解法', '第二行補充說明', ''];
  s.joinedApplyAnswer = joinApplyLines(lines);
  s.outcome = await submitAnswer(s.session!, s.joinedApplyAnswer);
});

Then('the whole text is submitted as one answer', function (this: LearningWorld) {
  const s = stateOf(this);
  assert.equal(s.joinedApplyAnswer, '這是跨來源請求,CORS 是解法\n第二行補充說明');
});

// ---------------------------------------------------------------- scenario 6/7:單題 checkpoint 的 pass/fail

Given('a card at stage 1 is being asked', function (this: LearningWorld) {
  const s = stateOf(this);
  const card = 'sec-stage1';
  s.currentCard = card;
  writeReviews(this, { [card]: baseReview({ stage: 1, learned_at: '2026-09-09', next_due: this.today }) });
  s.session = {
    learningDir: this.dir!,
    today: this.today,
    dailyCap: 10,
    router: makeRouter(),
    queue: [{ card, stage: 1, types: ['fill'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
    reteachQueue: [],
    totalDue: 1,
    deferred: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    current: {
      card,
      stage: 1,
      overdueDays: 0,
      overdueRatio: 0,
      stuck: false,
      types: ['fill'],
      typeIndex: 0,
      fillQuestion: { prompt: '答案是 ___。', answers: [['對']] },
      pendingAnswers: [],
      hadError: false,
    } satisfies CurrentQuestion,
  };
});

When('the person answers correctly', async function (this: LearningWorld) {
  const s = stateOf(this);
  s.outcome = await submitAnswer(s.session!, '對');
});

Given('a card at stage 3 is being asked', function (this: LearningWorld) {
  const s = stateOf(this);
  const card = 'sec-stage3';
  s.currentCard = card;
  writeReviews(this, { [card]: baseReview({ stage: 3, learned_at: '2026-08-01', next_due: this.today }) });
  s.session = {
    learningDir: this.dir!,
    today: this.today,
    dailyCap: 10,
    router: makeRouter(),
    queue: [{ card, stage: 3, types: ['apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
    reteachQueue: [],
    totalDue: 1,
    deferred: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    current: {
      card,
      stage: 3,
      overdueDays: 0,
      overdueRatio: 0,
      stuck: false,
      types: ['apply'],
      typeIndex: 0,
      applyQuestion: { prompt: '為什麼要重開瀏覽器?', rubric: ['有講到重點', '沒有事實錯誤'] },
      pendingAnswers: [],
      hadError: false,
    } satisfies CurrentQuestion,
  };
});

When('the person answers incorrectly', async function (this: LearningWorld) {
  const s = stateOf(this);
  // 「重開瀏覽器」命中 contracts/fixtures/llm/grade.apply.fail.json(criteria 不全過)。
  s.outcome = await submitAnswer(s.session!, '不知道,重開瀏覽器就好了吧');
});

Then(/^the review state on disk shows stage (\d)$/, function (this: LearningWorld, stageText: string) {
  const s = stateOf(this);
  const onDisk = readReviews(this)[s.currentCard!]!;
  assert.equal(onDisk.stage, Number(stageText));
});

Then(/^the review state on disk shows stage (\d) and due tomorrow$/, function (this: LearningWorld, stageText: string) {
  const s = stateOf(this);
  const onDisk = readReviews(this)[s.currentCard!]!;
  assert.equal(onDisk.stage, Number(stageText));
  assert.equal(onDisk.next_due, nextCalendarDay(this.today));
});

Then('the change is written before the next question is shown', function (this: LearningWorld) {
  const s = stateOf(this);
  assert.ok(s.outcome!.cardDone);
  const onDisk = readReviews(this)[s.currentCard!]!;
  assert.equal(onDisk.stage, s.outcome!.newStage);
});

// ---------------------------------------------------------------- scenario 8:stage 2,兩題才解決

Given('a card at stage 2 is being asked', function (this: LearningWorld) {
  const s = stateOf(this);
  const card = 'sec-stage2';
  s.currentCard = card;
  writeReviews(this, {
    [card]: baseReview({
      stage: 2,
      learned_at: '2026-09-01',
      next_due: this.today,
      history: [],
    }),
  });
  s.reviewsSnapshotBefore = readFileSync(reviewsPath(this), 'utf8');
  s.session = {
    learningDir: this.dir!,
    today: this.today,
    dailyCap: 10,
    router: makeRouter(),
    queue: [{ card, stage: 2, types: ['fill', 'apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
    reteachQueue: [],
    totalDue: 1,
    deferred: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    current: {
      card,
      stage: 2,
      overdueDays: 0,
      overdueRatio: 0,
      stuck: false,
      types: ['fill', 'apply'],
      typeIndex: 0,
      fillQuestion: { prompt: '答案是 ___。', answers: [['對']] },
      applyQuestion: { prompt: '為什麼要重開瀏覽器?', rubric: ['有講到重點', '沒有事實錯誤'] },
      pendingAnswers: [],
      hadError: false,
    } satisfies CurrentQuestion,
  };
});

When('the fill question is answered correctly', async function (this: LearningWorld) {
  const s = stateOf(this);
  s.outcome = await submitAnswer(s.session!, '對');
});

Then('no transition has been written yet', function (this: LearningWorld) {
  const s = stateOf(this);
  assert.equal(s.outcome!.status, 'partial');
  assert.equal(readFileSync(reviewsPath(this), 'utf8'), s.reviewsSnapshotBefore);
});

When('the apply question is answered incorrectly', async function (this: LearningWorld) {
  const s = stateOf(this);
  s.outcome = await submitAnswer(s.session!, '不知道,重開瀏覽器就好了吧');
});

Then('one failure is written', function (this: LearningWorld) {
  const s = stateOf(this);
  const onDisk = readReviews(this)[s.currentCard!]!;
  assert.equal(s.outcome!.status, 'failed');
  assert.equal(onDisk.stage, 1);
  assert.equal(onDisk.fails_in_row, 1);
});

Then('the history contains both answers', function (this: LearningWorld) {
  const s = stateOf(this);
  const onDisk = readReviews(this)[s.currentCard!]!;
  assert.equal(onDisk.history.length, 2);
  assert.deepEqual(
    onDisk.history.map((h) => h.type).sort(),
    ['apply', 'fill'],
  );
});

// -------------------------------------------------------- scenario 8b:stage 2,兩題都對只推進一次
//
// [TODO 下一輪實作] answer.ts 目前對 pendingAnswers.length>1 且 overallPass 的
// 分支還是 throw(見 answer.ts 的 TODO 註解)——這個場景現在預期是紅燈,規格見
// features/11-review-cli/REVIEW.md。用獨立的 applyQuestion prompt(跟 scenario 8
// 的「為什麼要重開瀏覽器?」不同)搭配新 fixture
// grade.apply.review-cli-both-pass.json,避免跟既有的失敗 fixture 撞到
// prompt_contains(FakeLlmRouter 用最長匹配決勝,共用同一個題目會撞到舊的 fail
// fixture,見 fake-llm.ts)。

Given('a card at stage 2 is being asked where both answers will pass', function (this: LearningWorld) {
  const s = stateOf(this);
  const card = 'sec-stage2-pass';
  s.currentCard = card;
  writeReviews(this, {
    [card]: baseReview({
      stage: 2,
      learned_at: '2026-09-01',
      next_due: this.today,
      history: [],
    }),
  });
  s.reviewsSnapshotBefore = readFileSync(reviewsPath(this), 'utf8');
  s.session = {
    learningDir: this.dir!,
    today: this.today,
    dailyCap: 10,
    router: makeRouter(),
    queue: [{ card, stage: 2, types: ['fill', 'apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
    reteachQueue: [],
    totalDue: 1,
    deferred: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    current: {
      card,
      stage: 2,
      overdueDays: 0,
      overdueRatio: 0,
      stuck: false,
      types: ['fill', 'apply'],
      typeIndex: 0,
      fillQuestion: { prompt: '答案是 ___。', answers: [['對']] },
      applyQuestion: { prompt: '瀏覽器的同源政策為什麼要檢查連接埠?', rubric: ['有講到重點', '沒有事實錯誤'] },
      pendingAnswers: [],
      hadError: false,
    } satisfies CurrentQuestion,
  };
});

When('the apply question is answered correctly', async function (this: LearningWorld) {
  const s = stateOf(this);
  s.outcome = await submitAnswer(s.session!, '因為連接埠不同就不算同源,要避免跨站資料外洩');
});

// ---------------------------------------------------------------- scenario 9:grading 錯誤

Given('the grader returns an error result for the current question', function (this: LearningWorld) {
  const s = stateOf(this);
  const card = 'sec-error1';
  s.currentCard = card;
  writeReviews(this, { [card]: baseReview({ stage: 3, learned_at: '2026-08-01', next_due: this.today }) });
  s.reviewsSnapshotBefore = readFileSync(reviewsPath(this), 'utf8');
  s.session = {
    learningDir: this.dir!,
    today: this.today,
    dailyCap: 10,
    router: makeRouter(),
    queue: [{ card, stage: 3, types: ['apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
    reteachQueue: [],
    totalDue: 1,
    deferred: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    current: {
      card,
      stage: 3,
      overdueDays: 0,
      overdueRatio: 0,
      stuck: false,
      types: ['apply'],
      typeIndex: 0,
      applyQuestion: { prompt: '請解釋 DOUBLE_MALFORMED_TEST 情境。', rubric: ['有講到重點', '沒有事實錯誤'] },
      pendingAnswers: [],
      hadError: false,
    } satisfies CurrentQuestion,
  };
});

When('the grading error is handled', async function (this: LearningWorld) {
  const s = stateOf(this);
  s.outcome = await submitAnswer(s.session!, '一些回答');
});

Then('no transition is written for that card', function (this: LearningWorld) {
  const s = stateOf(this);
  assert.equal(readFileSync(reviewsPath(this), 'utf8'), s.reviewsSnapshotBefore);
});

Then('the session reports that grading failed', function (this: LearningWorld) {
  const s = stateOf(this);
  assert.equal(s.outcome!.status, 'error');
  assert.equal(s.outcome!.pass, null);
});

Then('the session continues to the next question', function (this: LearningWorld) {
  const s = stateOf(this);
  assert.equal(s.session!.queue.find((d) => d.card === s.currentCard), undefined);
  assert.equal(s.session!.current, undefined);
});

// ---------------------------------------------------------------- scenario 10:答案落地是逐題立即寫

Given('5 cards are due and 2 have been answered', async function (this: LearningWorld) {
  const s = stateOf(this);
  const cards = ['sec-a1', 'sec-a2', 'sec-a3', 'sec-a4', 'sec-a5'];
  const reviews: Record<CardId, Review> = {};
  for (const card of cards) reviews[card] = baseReview({ stage: 1, learned_at: '2026-09-09', next_due: this.today });
  writeReviews(this, reviews);

  s.session = {
    learningDir: this.dir!,
    today: this.today,
    dailyCap: 10,
    router: makeRouter(),
    queue: cards.map((card) => ({ card, stage: 1 as const, types: ['fill' as const], overdue_days: 0, overdue_ratio: 0, stuck: false })),
    reteachQueue: [],
    totalDue: 5,
    deferred: 0,
    passed: 0,
    failed: 0,
    errors: 0,
  };

  for (const card of ['sec-a1', 'sec-a2']) {
    s.session.current = {
      card,
      stage: 1,
      overdueDays: 0,
      overdueRatio: 0,
      stuck: false,
      types: ['fill'],
      typeIndex: 0,
      fillQuestion: { prompt: '答案是 ___。', answers: [['對']] },
      pendingAnswers: [],
      hadError: false,
    };
    await submitAnswer(s.session, '對');
  }
});

When('the process is killed', function (this: LearningWorld) {
  // 模擬中斷:不再呼叫 submitAnswer,其餘卡片保持原樣。
});

Then('the review state on disk contains exactly those 2 outcomes', function (this: LearningWorld) {
  const onDisk = readReviews(this);
  assert.equal(onDisk['sec-a1']!.stage, 2);
  assert.equal(onDisk['sec-a2']!.stage, 2);
  for (const untouched of ['sec-a3', 'sec-a4', 'sec-a5']) {
    assert.equal(onDisk[untouched]!.stage, 1);
    assert.deepEqual(onDisk[untouched]!.history, []);
  }
});

// ---------------------------------------------------------------- scenario 11:小結

Given('5 cards were answered with 3 passes and 2 failures', function (this: LearningWorld) {
  const s = stateOf(this);
  s.estimate = estimateTomorrow({ dueTomorrowExcludingReturns: 0, returnedToday: 2, dailyCap: 10 });
  s.summaryText = renderSummary({ passed: 3, failed: 2, errors: 0, tomorrow: s.estimate });
});

When('the session finishes', function (this: LearningWorld) {
  // renderSummary 已經在 Given 算好(小結是純函式,不用等「事件」發生)。
});

Then('the summary reports {int} passed and {int} returned', function (this: LearningWorld, passed: number, returned: number) {
  const s = stateOf(this);
  assert.ok(s.summaryText!.includes(String(passed)));
  assert.ok(s.summaryText!.includes(String(returned)));
});

Then('it estimates how many are due tomorrow', function (this: LearningWorld) {
  const s = stateOf(this);
  assert.ok(s.summaryText!.includes(String(s.estimate!.shown)));
});

// ---------------------------------------------------------------- scenario 12:預估要考慮上限

Given('4 cards were already due tomorrow', function (this: LearningWorld) {
  stateOf(this).dueTomorrowExcludingReturns = 4;
});

Given('2 cards were returned today', function (this: LearningWorld) {
  stateOf(this).returnedToday = 2;
});

When('the estimate is computed', function (this: LearningWorld) {
  const s = stateOf(this);
  s.estimate = estimateTomorrow({ dueTomorrowExcludingReturns: s.dueTomorrowExcludingReturns!, returnedToday: s.returnedToday!, dailyCap: 10 });
});

Then('it reports {int}', function (this: LearningWorld, total: number) {
  const s = stateOf(this);
  assert.equal(s.estimate!.total, total);
});

Then('when that would exceed the daily cap it reports the cap and the overflow', function (this: LearningWorld) {
  const s = stateOf(this);
  const capped = estimateTomorrow({ dueTomorrowExcludingReturns: s.dueTomorrowExcludingReturns!, returnedToday: s.returnedToday!, dailyCap: 4 });
  assert.equal(capped.capped, true);
  assert.equal(capped.shown, 4);
  assert.equal(capped.overflow, 2);
});

// ---------------------------------------------------------------- scenario 14:stuck 提示

When('it is presented', async function (this: LearningWorld) {
  const s = stateOf(this);
  s.session = await buildTodaySession({ learningDir: this.dir!, today: this.today, router: makeRouter() });
  s.presentations = [await presentNextCard(s.session)];
});

Then('the output notes the repeated failures', function (this: LearningWorld) {
  const s = stateOf(this);
  const presentation = s.presentations[0];
  assert.ok(presentation && presentation.kind === 'question');
  assert.equal((presentation as Extract<CardPresentation, { kind: 'question' }>).stuck, true);
});
