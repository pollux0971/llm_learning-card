/**
 * 11-review-cli / phase-3(T26):寫 reviews.json 之前先確認 session 建立之後沒有人改過它。
 *
 * 跑**真的** `scripts/review.ts` 子程序(量尺 `features/support/review-session-harness.ts`;`beforeAnswer` 在送出某一題之前
 * 改寫磁碟上的 reviews.json,模擬桌面側車或另一個終端機同時在寫)。題目只用填空題(精確答案,不花錢、不打網路)。
 * 句子刻意跟 phase-1、phase-2 與 T25 的步驟不同字(例如退出碼用 the terminal review exits with status),不共用別人的狀態。
 * 續答路徑與第一題就被改的情況在 `features/support/reviews-changed-cli.test.ts`。
 */
import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  TODAY,
  commitCount,
  createVault,
  gitInit,
  readReviews,
  removeVault,
  reviewRecord,
  reviewsPath,
  runReview,
  seedDue,
  writeReviews,
  type RunOut,
  type Vault,
} from '../support/review-session-harness.js';
import type { LearningWorld } from './_world.js';

const STEP_TIMEOUT_MS = 180_000;
const MESSAGE = '複習紀錄剛被別的地方改過,請重新開始今天的複習。剛才那一題需要重答。';
const SUMMARY = /\d+ passed, \d+ returned\./;
const FIRST = 'sec-0001';
const SECOND = 'sec-0002';
const ELSEWHERE = 'sec-0003';

interface ConflictState {
  vault: Vault;
  commitsBefore: number;
  run?: RunOut;
  theirs?: Buffer;
}
const states = new WeakMap<LearningWorld, ConflictState>();

function st(world: LearningWorld): ConflictState {
  const s = states.get(world);
  assert.ok(s, '這個場景還沒建立 vault');
  return s;
}

function lastRun(world: LearningWorld): RunOut {
  const r = st(world).run;
  assert.ok(r, '還沒跑過 review.ts');
  return r;
}

function todays(vault: Vault, card: string): number {
  return (readReviews(vault)[card]?.history ?? []).filter((e) => e.date === TODAY).length;
}

After(function (this: LearningWorld) {
  const s = states.get(this);
  if (s) removeVault(s.vault);
});

Given('two cards are due today in a learning folder kept in git', function (this: LearningWorld) {
  const vault = createVault({ cards: 3 });
  this.dir = vault.dir;
  writeReviews(vault, { [ELSEWHERE]: reviewRecord({ next_due: '2026-12-31', stage: 3 }) });
  seedDue(vault, [FIRST, SECOND], [2, 0]); // FIRST 逾期多,先問
  gitInit(vault);
  states.set(this, { vault, commitsBefore: commitCount(vault) });
});

When(
  'the review record is changed elsewhere after the first card is answered in the terminal',
  { timeout: STEP_TIMEOUT_MS },
  async function (this: LearningWorld) {
    const s = st(this);
    s.run = await runReview(s.vault, {
      beforeAnswer: ({ index }) => {
        if (index !== 1) return;
        // 不在今天名單上的卡多一筆舊的 history:改的是別張卡,一樣要拒絕(寧可多拒絕一次)
        const reviews = readReviews(s.vault);
        const other = reviews[ELSEWHERE]!;
        reviews[ELSEWHERE] = { ...other, history: [...other.history, { date: '2026-09-01', stage: 3, type: 'apply', pass: true, grader: 'cloud' }] };
        writeReviews(s.vault, reviews);
        s.theirs = readFileSync(reviewsPath(s.vault));
      },
    });
    this.lastRun = { status: s.run.status, stdout: s.run.stdout, stderr: s.run.stderr, output: s.run.output };
    assert.ok(s.theirs, `應該問到第二張卡才改檔:\n${s.run.output}`);
  },
);

When(
  'both cards are answered in the terminal with nothing else touching the review record',
  { timeout: STEP_TIMEOUT_MS },
  async function (this: LearningWorld) {
    const s = st(this);
    s.run = await runReview(s.vault);
    this.lastRun = { status: s.run.status, stdout: s.run.stdout, stderr: s.run.stderr, output: s.run.output };
  },
);

Then('the terminal shows the message that the review record was changed elsewhere', function (this: LearningWorld) {
  const r = lastRun(this);
  assert.ok(r.stderr.includes(MESSAGE), `stderr 應該有固定訊息「${MESSAGE}」:\n${r.output}`);
});

Then('the terminal review exits with status {int}', function (this: LearningWorld, status: number) {
  assert.equal(lastRun(this).status, status, lastRun(this).output);
});

Then('the change made elsewhere is still in the review record', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(s.theirs, '前一步沒有改到檔');
  assert.ok(readFileSync(reviewsPath(s.vault)).equals(s.theirs), 'reviews.json 應該原樣是別處寫的那份,沒有被蓋掉');
});

Then('the second card has no answer recorded today', function (this: LearningWorld) {
  const { vault } = st(this);
  assert.equal(todays(vault, SECOND), 0, '被拒絕的那一題沒有存');
  assert.equal(todays(vault, FIRST), 1, '前一張已經寫進去的不受影響');
});

Then('no summary is printed and no snapshot is taken', function (this: LearningWorld) {
  const s = st(this);
  assert.doesNotMatch(lastRun(this).stdout, SUMMARY, '偵測到被改過時不印小結');
  assert.equal(commitCount(s.vault), s.commitsBefore, '偵測到被改過時不做 snapshot');
});

Then('running the review again asks only the second card', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld) {
  const s = st(this);
  const again = await runReview(s.vault);
  assert.equal(again.status, 0, again.output);
  assert.deepEqual(again.asked, [{ index: 2, total: 2, card: SECOND }], `重新開始後只問剩下的那張:\n${again.output}`);
  assert.equal(todays(s.vault, SECOND), 1);
});

Then('both cards have an answer recorded today', function (this: LearningWorld) {
  const s = st(this);
  const r = lastRun(this);
  assert.equal(todays(s.vault, FIRST), 1, r.output);
  assert.equal(todays(s.vault, SECOND), 1, r.output);
  assert.ok(!r.stderr.includes(MESSAGE), `沒有人動檔,不該說被改過:\n${r.output}`);
  assert.match(r.stdout, SUMMARY);
});
