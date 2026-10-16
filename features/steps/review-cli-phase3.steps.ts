/**
 * 11-review-cli / phase-3(T25):連錯兩次的卡沒有縮短版時,複習不中止、退回原卡。
 *
 * 跑**真的** `scripts/review.ts` 子程序(量尺在 features/support/review-session-harness.ts):
 * 使用者在終端機看到的字、退出碼、state/log.jsonl 才是要守的東西。題目只用填空題(精確比對,不花錢)。
 * 這裡的句子刻意和 phase-1、phase-2 的步驟不同字,不用依 tag 分派。
 */
import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCardText } from '@core/schema/parse-card.js';
import {
  TODAY,
  createVault,
  ledgerEvents,
  removeVault,
  reviewRecord,
  runReview,
  writeReviews,
  type RunOut,
  type Vault,
} from '../support/review-session-harness.js';
import type { LearningWorld } from './_world.js';

const STEP_TIMEOUT_MS = 180_000;
const CARD = 'sec-0001';
const HEADING = '[複習提示,先看過再回答問題]';
const SHORT_MARK = '縮短版標記PHASE3SHORT';

interface P3State {
  vault: Vault;
  run?: RunOut;
}
const states = new WeakMap<LearningWorld, P3State>();

function st(world: LearningWorld): P3State {
  const s = states.get(world);
  assert.ok(s, '這個場景還沒建立 vault');
  return s;
}

After(function (this: LearningWorld) {
  const s = states.get(this);
  if (s) removeVault(s.vault);
});

function shortFile(vault: Vault): string {
  return join(vault.dir, 'cards/security', `${CARD}.short.md`);
}

function originalBody(vault: Vault): string {
  return parseCardText(readFileSync(join(vault.dir, 'cards/security', `${CARD}.md`), 'utf8')).body;
}

function warnings(vault: Vault): Record<string, unknown>[] {
  return ledgerEvents(vault).filter((e) => e.type === 'warning' && e.reason === 'short-card-missing');
}

Given('a card that failed twice in a row is due today', function (this: LearningWorld) {
  const vault = createVault({ cards: 3 });
  this.dir = vault.dir;
  states.set(this, { vault });
  // fails_in_row 剛好 2:進 reteach 佇列(build.ts 的 deriveReteachQueue);只有這一張到期
  writeReviews(vault, { [CARD]: reviewRecord({ next_due: TODAY, fails_in_row: 2, total_fails: 2 }) });
});

Given('that card has no short version', function (this: LearningWorld) {
  assert.ok(!existsSync(shortFile(st(this).vault)), 'fixture 不該有縮短版');
});

Given('that card has a short version', function (this: LearningWorld) {
  const { vault } = st(this);
  writeFileSync(
    shortFile(vault),
    `---\nid: ${CARD}\ncategory: security\ntitle: 同源政策\nlevel: 0\nsource: raw\ncreated: 2026-09-01\n---\n${SHORT_MARK}:協定、主機、埠號三者相同。\n`,
    'utf8',
  );
});

When("the person works through the day's review", { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld) {
  const s = st(this);
  s.run = await runReview(s.vault, { today: TODAY, answers: 'all' });
  this.lastRun = { status: s.run.status, stdout: s.run.stdout, stderr: s.run.stderr, output: s.run.output };
});

function run(world: LearningWorld): RunOut {
  const r = st(world).run;
  assert.ok(r, '還沒跑過 review.ts');
  return r;
}

Then('the review does not stop early', function (this: LearningWorld) {
  const r = run(this);
  assert.doesNotMatch(r.output, /找不到卡片檔案/, `複習不該因為缺縮短版而中止:\n${r.output}`);
  assert.match(r.stdout, /\d+ passed, \d+ returned\./, `應該一路跑到小結:\n${r.output}`);
});

Then('the original card is shown with a note that there is no short version', function (this: LearningWorld) {
  const { vault } = st(this);
  const r = run(this);
  const heading = `${HEADING} ${CARD}(沒有縮短版,以下是原卡)`;
  const at = r.stdout.indexOf(heading);
  assert.ok(at >= 0, `標題行應該是「${heading}」:\n${r.stdout}`);
  const bodyAt = r.stdout.indexOf(originalBody(vault), at);
  assert.ok(bodyAt > at, `標題之後要印原卡的 body(不含 frontmatter 與 example 圍欄):\n${r.stdout}`);
  assert.ok(!r.stdout.includes('```example'), '原卡的 example 圍欄不該印出來');
  assert.ok(!r.stdout.includes('source_ref'), '原卡的 frontmatter 不該印出來');
});

Then('the question of that card is asked afterwards', function (this: LearningWorld) {
  const r = run(this);
  assert.equal(r.asked.length, 1, `應該問該卡的題目一次:${JSON.stringify(r.asked)}`);
  assert.deepEqual(r.asked[0], { index: 1, total: 1, card: CARD }, '複習提示不算進進度');
  const hintAt = r.stdout.search(/\[複習提示,先看過再回答問題\]/);
  assert.ok(hintAt >= 0 && hintAt < r.stdout.indexOf('(1/1)'), '複習提示要在第一題之前');
});

Then('the review ends with exit status {int}', function (this: LearningWorld, status: number) {
  assert.equal(run(this).status, status, run(this).output);
});

Then('one warning about the missing short version is logged', function (this: LearningWorld) {
  const { vault } = st(this);
  const found = warnings(vault);
  assert.equal(found.length, 1, `應該剛好一筆 short-card-missing 的 warning:${JSON.stringify(ledgerEvents(vault))}`);
  assert.equal(found[0]!.card, CARD);
  assert.equal(found[0]!.type, 'warning');
  assert.deepEqual(Object.keys(found[0]!).sort(), ['card', 'reason', 'ts', 'type'], '欄位只有 ts、type、card、reason');
  assert.ok(!JSON.stringify(found[0]).includes(vault.scratch), '事件裡不可以有絕對路徑');
});

Then('the short version is shown without any note', function (this: LearningWorld) {
  const r = run(this);
  const heading = `${HEADING} ${CARD}\n`;
  const at = r.stdout.indexOf(heading);
  assert.ok(at >= 0, `標題行應該跟 phase-1 逐字相同、沒有提示:\n${r.stdout}`);
  assert.ok(r.stdout.indexOf(SHORT_MARK, at) > at, '標題之後要印縮短版的內容');
  assert.doesNotMatch(r.stdout, /沒有縮短版/);
});

Then('no warning about a short version is logged', function (this: LearningWorld) {
  assert.equal(warnings(st(this).vault).length, 0);
});
