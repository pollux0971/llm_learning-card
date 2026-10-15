/**
 * 11-review-cli / phase-2(T17):session 邊界 —— 當日快取、續答、跨日、暫停、dry-run、結束時 snapshot。
 *
 * 全部走**真的** `scripts/review.ts` 子程序(量尺在 features/support/review-session-harness.ts):
 * 使用者在終端機看到的字、退出碼、留在磁碟上的 reviews.json / 快取 / git 歷史才是要守的東西。
 * 沒有任何一步花錢或打網路;題目只用填空題(精確比對,不需要審核)。
 *
 * 共用句子:`the review command is run` 與 `the review command is run in dry run mode` 在 phase-1 的
 * review-cli.steps.ts 已經有定義(程序內直接呼叫),cucumber 不准同一句有兩個定義,
 * 所以那邊依 tag 分派過來(`this.tags` 含 `@phase-2`),實作在這裡匯出。
 *
 * Background 的「日常使用中」:16 張卡在磁碟上;3 張今天到期(逾期 3/2/1 天)、4 張排在之後(未到期)。
 * 每個場景需要別的狀態時,自己的 Given 會整份重設到期集合(`resetDue`)。
 *
 * 各場景為了讓「保護」真的被考到而多佈置的東西,寫在對應步驟的註解裡。
 */
import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TODAY,
  addDays,
  cacheBase,
  cachePath,
  commitCount,
  createVault,
  ensureCards,
  gitInit,
  headFiles,
  headMessage,
  headSha,
  installPostCommitStamp,
  ledgerEvents,
  mtimeMs,
  readCache,
  readReviews,
  removeVault,
  reviewRecord,
  reviewsPath,
  runReview,
  trackedFiles,
  writeReviews,
  type CacheShape,
  type RunOut,
  type Vault,
} from '../support/review-session-harness.js';
import type { LearningWorld } from './_world.js';

/** 每個會起 review.ts 子程序的步驟(一次 2–10 秒,多次執行會更久)。 */
const STEP_TIMEOUT_MS = 180_000;
const YESTERDAY = addDays(TODAY, -1);
/** 摘要的第一行(phase-1 的 renderSummary):`3 passed, 0 returned.` */
const SUMMARY_LINE = /\d+ passed, \d+ returned\./;
const PAUSED_TODAY = /今天已暫停/;

interface P2State {
  vault: Vault;
  runs: RunOut[];
  /** 當日快取建立當下的 queue(從快取檔讀出來的卡片 id,依順序) */
  originalQueue: string[];
  reviewsBefore?: string;
  logBefore?: string;
  cacheBytesBefore?: string;
  cacheMtimeBefore?: number;
  commitsBefore?: number;
  headBefore?: string;
  stampFile?: string;
  /** 新到期、不該被問的卡 */
  newlyDue: string[];
  /** 「早上已經答過」的卡 */
  answeredCard?: string;
  /** 另一本帳本的過期快取(不該被刪) */
  otherVaultStale?: string;
}

const states = new WeakMap<LearningWorld, P2State>();

function st(world: LearningWorld): P2State {
  const s = states.get(world);
  assert.ok(s, '這個場景沒有跑 Background「a learning directory in daily use」');
  return s;
}

After(function (this: LearningWorld) {
  const s = states.get(this);
  if (s) removeVault(s.vault);
});

function lastRun(world: LearningWorld): RunOut {
  const s = st(world);
  const run = s.runs[s.runs.length - 1];
  assert.ok(run, '還沒有跑過 review.ts');
  return run;
}

async function run(world: LearningWorld, opts: Parameters<typeof runReview>[1] = {}): Promise<RunOut> {
  const s = st(world);
  const out = await runReview(s.vault, { today: world.today, ...opts });
  s.runs.push(out);
  world.lastRun = { status: out.status, stdout: out.stdout, stderr: out.stderr, output: out.output };
  return out;
}

/**
 * 整份重設:到期的卡 = ids(逾期天數由大到小,所以順序固定),另外 4 張排在之後的卡原樣保留。
 * `dueDate` 是「到期日」的基準(預設今天);昨天沒答的場景用昨天。
 */
function resetDue(world: LearningWorld, ids: string[], overdue: number[], dueDate = world.today): void {
  const { vault } = st(world);
  const reviews: Record<string, ReturnType<typeof reviewRecord>> = {};
  ['sec-0013', 'sec-0014', 'sec-0015', 'sec-0016'].forEach((id, i) => {
    reviews[id] = reviewRecord({ stage: 2, next_due: addDays(world.today, 5 + i), history: [] });
  });
  ids.forEach((id, i) => {
    reviews[id] = reviewRecord({ next_due: addDays(dueDate, -(overdue[i] ?? 0)) });
  });
  writeReviews(vault, reviews);
}

function idsFrom(n: number, from = 1): string[] {
  return Array.from({ length: n }, (_, i) => `sec-${String(from + i).padStart(4, '0')}`);
}

function descending(n: number, top = n): number[] {
  return Array.from({ length: n }, (_, i) => top - i);
}

function queueOf(world: LearningWorld, date = world.today): string[] {
  return (readCache(st(world).vault, date) as unknown as CacheShape).queue.map((q) => q.card);
}

function askedCards(out: RunOut): string[] {
  return out.asked.map((a) => a.card);
}

// ---------------------------------------------------------------- 共用句子(phase-1 檔分派過來)

/** `the review command is run`:今天、一路答到結束。 */
export async function phase2RunReviewCommand(world: LearningWorld): Promise<void> {
  await run(world, { answers: 'all' });
}

/** `the review command is run in dry run mode`。 */
export async function phase2RunDryRun(world: LearningWorld): Promise<void> {
  const s = st(world);
  s.reviewsBefore = readFileSync(reviewsPath(s.vault), 'utf8');
  await run(world, { args: ['--dry-run'] });
}

// ---------------------------------------------------------------- Background

Given('a learning directory in daily use', function (this: LearningWorld) {
  const vault = createVault({ cards: 16 });
  this.dir = vault.dir;
  states.set(this, { vault, runs: [], originalQueue: [], newlyDue: [] });
  resetDue(this, idsFrom(3), [3, 2, 1]);
});

// ---------------------------------------------------------------- 場景 1:當日集合固定

Given('the session was created this morning with {int} questions', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld, n: number) {
  const s = st(this);
  resetDue(this, idsFrom(n), descending(n, n + 2));
  // 看到第一題就離開:當天的快取已經建好,什麼都還沒答
  await run(this, { answers: 0 });
  s.originalQueue = queueOf(this);
  assert.equal(s.originalQueue.length, n, `快取應該記下 ${n} 題,實際:${JSON.stringify(s.originalQueue)}`);
});

Given('more cards have become due since', function (this: LearningWorld) {
  const s = st(this);
  // 3 張新到期的卡,逾期天數比原本任何一張都多:要是被重建,它們會排在最前面、把原本的擠掉
  const reviews = readReviews(s.vault);
  s.newlyDue = ['sec-0011', 'sec-0012', 'sec-0013'];
  s.newlyDue.forEach((id, i) => {
    reviews[id] = reviewRecord({ next_due: addDays(this.today, -(30 - i)) });
  });
  writeReviews(s.vault, reviews);
  s.reviewsBefore = readFileSync(reviewsPath(s.vault), 'utf8');
});

When('the review command is run again today', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld) {
  await run(this, { answers: 'all' });
});

Then('the same {int} questions are used', function (this: LearningWorld, n: number) {
  const s = st(this);
  const out = lastRun(this);
  assert.equal(s.originalQueue.length, n);
  assert.deepEqual(askedCards(out), s.originalQueue, `第二次執行問的題目集合/順序不是第一次建好的那一份:\n${out.output}`);
  assert.ok(out.asked.every((a) => a.total === n), `進度分母應該一直是 ${n}:${JSON.stringify(out.asked)}`);
});

Then('the newly due cards are left for tomorrow', function (this: LearningWorld) {
  const s = st(this);
  const out = lastRun(this);
  const asked = new Set(askedCards(out));
  for (const id of s.newlyDue) assert.ok(!asked.has(id), `${id} 是當天新到期的,不該被問`);
  const reviews = readReviews(s.vault);
  for (const id of s.newlyDue) assert.equal(reviews[id]!.history.length, 0, `${id} 不該被記錄任何作答`);
});

// ---------------------------------------------------------------- 場景 2:續答

Given('{int} questions were due and {int} were answered before quitting', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld, total: number, answered: number) {
  const s = st(this);
  resetDue(this, idsFrom(total), descending(total, total + 2));
  await run(this, { answers: answered });
  s.originalQueue = queueOf(this);
  const reviews = readReviews(s.vault);
  const done = s.originalQueue.filter((id) => (reviews[id]?.history ?? []).some((h) => h.date === this.today));
  assert.equal(done.length, answered, `離開前應該已經答了 ${answered} 題,磁碟上只有 ${done.length} 題有今天的作答`);
});

When('the review command is run again the same day', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld) {
  await run(this, { answers: 'all' });
});

Then('it resumes at the third question', function (this: LearningWorld) {
  const s = st(this);
  const out = lastRun(this);
  assert.ok(out.asked.length > 0, `續答時完全沒有問題:\n${out.output}`);
  assert.equal(out.asked[0]!.index, 3, `應該從第 3 題接著問:${JSON.stringify(out.asked)}`);
  assert.equal(out.asked[0]!.card, s.originalQueue[2], '第 3 題應該是快取裡 queue 的第 3 張卡');
  assert.deepEqual(askedCards(out), s.originalQueue.slice(2), '已經答過的卡不該再被問');
});

Then('the progress shows two of five', function (this: LearningWorld) {
  const out = lastRun(this);
  // 已答 2 題、共 5 題:續答的進度從 3/5 起算,分母仍是 5,絕不是從 1/3 重新數
  assert.deepEqual(out.asked.map((a) => [a.index, a.total]), [[3, 5], [4, 5], [5, 5]], `進度不對:${JSON.stringify(out.asked)}`);
  assert.doesNotMatch(out.stdout, /\((1|2)\/5\)/, '不該再出現第 1、2 題的進度');
  // 小結是「今天這一輪」(顧問裁決):早上答的 2 題 + 下午答的 3 題 = 5 題的結果,另外說明本次作答 3 題
  assert.match(out.stdout, /5 passed, 0 returned\./, `小結應該是整個 session 5 題的結果:\n${out.stdout}`);
  assert.match(out.stdout, /本次作答\s*3\s*題/);
});

// ---------------------------------------------------------------- 場景 3:跨午夜

Given('{int} questions were left unanswered yesterday', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld, n: number) {
  const s = st(this);
  // 3 張在「昨天」到期、沒答就離開(昨天的快取建好了)
  const ids = idsFrom(n);
  resetDue(this, ids, new Array(n).fill(0), YESTERDAY);
  await run(this, { today: YESTERDAY, answers: 0 });
  assert.ok(existsSync(cachePath(s.vault, YESTERDAY)), '昨天的快取應該已經存在');
  s.originalQueue = ids;
  // 另一本帳本的資料夾裡有一個很舊的快取:跨日清理只能動這本帳本自己的資料夾
  const other = join(cacheBase(s.vault), '00000000-0000-4000-8000-000000000000');
  mkdirSync(other, { recursive: true });
  s.otherVaultStale = join(other, 'session-2026-09-01.json');
  writeFileSync(s.otherVaultStale, '{}\n', 'utf8');
});

When('the review command is run today', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld) {
  await run(this, { answers: 'all' });
});

Then('the session is rebuilt from scratch', function (this: LearningWorld) {
  const s = st(this);
  const out = lastRun(this);
  assert.equal(out.status, 0, out.output);
  assert.ok(existsSync(cachePath(s.vault, this.today)), '今天的快取應該建好了');
  const cache = readCache(s.vault, this.today) as unknown as CacheShape;
  assert.equal(cache.date, this.today);
  assert.equal(cache.total_due, s.originalQueue.length);
  assert.deepEqual(new Set(askedCards(out)), new Set(s.originalQueue), '昨天沒答的卡今天要重新被問');
});

Then("yesterday's three are one day more overdue", function (this: LearningWorld) {
  const s = st(this);
  const cache = readCache(s.vault, this.today) as unknown as CacheShape;
  assert.equal(cache.queue.length, 3);
  for (const item of cache.queue) {
    assert.equal(item.overdue_days, 1, `${item.card} 應該比昨天多逾期一天,實際 ${item.overdue_days}`);
  }
});

Then("yesterday's session cache is removed", function (this: LearningWorld) {
  const s = st(this);
  assert.ok(!existsSync(cachePath(s.vault, YESTERDAY)), '昨天的快取檔還在');
  const leftovers = readdirSync(join(cacheBase(s.vault), s.vault.vaultId!)).filter((n) => n.startsWith('session-') && n !== `session-${this.today}.json`);
  assert.deepEqual(leftovers, [], '這本帳本的資料夾裡不該留下其他日期的快取');
  assert.ok(existsSync(s.otherVaultStale!), '別的帳本的資料夾不能動');
});

// ---------------------------------------------------------------- 場景 4:壞快取、場景 7:已答不再問

/**
 * 「早上已經答過」的卡:有今天的 history,但 next_due 仍然 ≤ 今天(而且逾期最多)。
 * 真的答過的卡 next_due 會往後移,重建時本來就不會出現;這裡刻意佈成「重建會把它列進來」的樣子,
 * 才考得到「已答的不再問」這條保護(它看 reviews.json,不看快取)。
 */
function seedAnsweredThisMorning(world: LearningWorld, id: string, others: string[]): void {
  const s = st(world);
  resetDue(world, others, descending(others.length, others.length));
  const reviews = readReviews(s.vault);
  reviews[id] = reviewRecord({
    next_due: addDays(world.today, -20),
    history: [{ date: world.today, stage: 1, type: 'fill', pass: true, grader: 'exact' }],
  });
  writeReviews(s.vault, reviews);
  s.answeredCard = id;
  s.reviewsBefore = readFileSync(reviewsPath(s.vault), 'utf8');
}

Given('the session cache for today is not valid JSON', function (this: LearningWorld) {
  const s = st(this);
  seedAnsweredThisMorning(this, 'sec-0006', idsFrom(5));
  const path = cachePath(s.vault, this.today);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '{"version": 1, "date": "2026-09-10", "queue": [ <<<not json', 'utf8');
  s.logBefore = existsSync(join(s.vault.dir, 'state/log.jsonl')) ? readFileSync(join(s.vault.dir, 'state/log.jsonl'), 'utf8') : '';
});

Then('the cache is rebuilt', function (this: LearningWorld) {
  const s = st(this);
  const out = lastRun(this);
  assert.equal(out.status, 0, `壞快取不該讓指令當掉:\n${out.output}`);
  const cache = JSON.parse(readFileSync(cachePath(s.vault, this.today), 'utf8')) as CacheShape;
  assert.equal(cache.version, 1);
  assert.equal(cache.date, this.today);
  assert.equal(cache.paused, false);
  assert.ok(cache.queue.length >= 5, `重建後的 queue 應該有今天到期的卡:${JSON.stringify(cache.queue)}`);
  assert.ok(askedCards(out).length >= 5, '重建後應該照常問題目');
});

Then('a warning is logged', function (this: LearningWorld) {
  const s = st(this);
  const warnings = ledgerEvents(s.vault).filter((e) => e.type === 'warning' && e.reason === 'session-cache-invalid');
  assert.equal(warnings.length, 1, `應該剛好一筆 session-cache-invalid 的 warning:${JSON.stringify(ledgerEvents(s.vault))}`);
  const w = warnings[0]!;
  assert.equal(w.path, `session-${this.today}.json`, 'path 只寫快取檔的檔名');
  assert.ok(!JSON.stringify(w).includes(s.vault.scratch), 'warning 不可以帶絕對路徑');
  assert.ok(typeof w.ts === 'string' && !Number.isNaN(Date.parse(w.ts)), 'ts 要是 ISO 時間');
});

Then('the already recorded answers in the review state are respected', function (this: LearningWorld) {
  const s = st(this);
  const out = lastRun(this);
  const id = s.answeredCard!;
  assert.ok(!askedCards(out).includes(id), `${id} 今天已經答過,不該再被問:${JSON.stringify(askedCards(out))}`);
  const after = readReviews(s.vault)[id]!;
  const before = JSON.parse(s.reviewsBefore!)[id] as unknown;
  assert.deepEqual(after, before, '已經記錄的答案不可以被改掉或忘掉');
});

Given('a card was answered this morning', function (this: LearningWorld) {
  seedAnsweredThisMorning(this, 'sec-0006', idsFrom(4));
});

When('the session is rebuilt for any reason', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld) {
  const s = st(this);
  // 任何原因的重建:這裡是把當日快取刪掉(使用者清過 ~/.cache)
  rmSync(cachePath(s.vault, this.today), { force: true });
  await run(this, { answers: 'all' });
});

Then('that card is not asked again today', function (this: LearningWorld) {
  const s = st(this);
  const out = lastRun(this);
  const id = s.answeredCard!;
  assert.ok(out.asked.length > 0, '其餘的卡應該照常被問');
  assert.ok(!askedCards(out).includes(id), `${id} 今天已經答過,不該再被問:${JSON.stringify(askedCards(out))}`);
  assert.deepEqual(readReviews(s.vault)[id], JSON.parse(s.reviewsBefore!)[id] as unknown, '已答的卡不該被動到');
});

// ---------------------------------------------------------------- 場景 5、6:暫停

When('the review command is run with the pause option', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld) {
  const s = st(this);
  s.reviewsBefore = readFileSync(reviewsPath(s.vault), 'utf8');
  s.logBefore = existsSync(join(s.vault.dir, 'state/log.jsonl')) ? readFileSync(join(s.vault.dir, 'state/log.jsonl'), 'utf8') : '';
  const out = await run(this, { args: ['--pause'] });
  assert.equal(out.status, 0, `--pause 的退出碼應該是 0:\n${out.output}`);
  assert.match(out.output, PAUSED_TODAY);
});

Then('no card is recorded as failed', function (this: LearningWorld) {
  const s = st(this);
  assert.equal(readFileSync(reviewsPath(s.vault), 'utf8'), s.reviewsBefore, '--pause 不可以動 reviews.json');
  const logAfter = existsSync(join(s.vault.dir, 'state/log.jsonl')) ? readFileSync(join(s.vault.dir, 'state/log.jsonl'), 'utf8') : '';
  assert.equal(logAfter, s.logBefore, '--pause 不可以寫任何事件');
});

Then('the session cache marks the day as paused', function (this: LearningWorld) {
  const s = st(this);
  const cache = readCache(s.vault, this.today) as unknown as CacheShape;
  assert.equal(cache.paused, true);
  assert.equal(cache.date, this.today);
});

Then('running the command again says the day is paused', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld) {
  const out = await run(this, { answers: 'all' });
  assert.equal(out.status, 0, out.output);
  assert.match(out.output, PAUSED_TODAY);
  assert.match(out.output, /--unpause/, '要告訴使用者怎麼繼續');
  assert.equal(out.asked.length, 0, '暫停的那天不該問任何題目');
});

Given('today was paused', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld) {
  const s = st(this);
  resetDue(this, idsFrom(5), descending(5, 7));
  const out = await run(this, { args: ['--pause'] });
  assert.equal(out.status, 0, out.output);
  s.originalQueue = queueOf(this);
  assert.equal(s.originalQueue.length, 5);
  // 暫停期間又有 2 張卡新到期(逾期最多):要是 --unpause 改成重建,它們會排進來
  const reviews = readReviews(s.vault);
  s.newlyDue = ['sec-0011', 'sec-0012'];
  s.newlyDue.forEach((id, i) => {
    reviews[id] = reviewRecord({ next_due: addDays(this.today, -(30 - i)) });
  });
  writeReviews(s.vault, reviews);
});

When('the review command is run with the unpause option', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld) {
  await run(this, { args: ['--unpause'], answers: 'all' });
});

Then('the original question set is restored', function (this: LearningWorld) {
  const s = st(this);
  const out = lastRun(this);
  assert.match(out.output, /已恢復今天的複習/);
  assert.deepEqual(askedCards(out), s.originalQueue, `--unpause 之後題目集合應該是暫停前那一份:\n${out.output}`);
  const cache = readCache(s.vault, this.today) as unknown as CacheShape;
  assert.equal(cache.paused, false, '--unpause 之後快取不該還是暫停');
});

Then('answering continues normally', function (this: LearningWorld) {
  const s = st(this);
  const out = lastRun(this);
  assert.equal(out.status, 0, out.output);
  assert.match(out.stdout, /5 passed, 0 returned\./);
  assert.match(out.stdout, /本次作答\s*5\s*題/);
  const reviews = readReviews(s.vault);
  for (const id of s.originalQueue) {
    assert.ok(reviews[id]!.history.some((h) => h.date === this.today && h.pass), `${id} 的作答應該已經落地`);
  }
  for (const id of s.newlyDue) assert.equal(reviews[id]!.history.length, 0, `${id} 是暫停期間新到期的,不該被問`);
});

// ---------------------------------------------------------------- 場景 8:dry-run 反映真實 session

Given('a session already exists for today with {int} of {int} answered', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld, answered: number, total: number) {
  const s = st(this);
  resetDue(this, idsFrom(total), descending(total, total + 2));
  await run(this, { answers: answered });
  s.originalQueue = queueOf(this);
  // 把快取的修改時間調到很久以前:dry-run 若重寫(即使內容相同)mtime 就會變
  const path = cachePath(s.vault, this.today);
  const old = new Date('2020-01-01T00:00:00Z');
  utimesSync(path, old, old);
  s.cacheBytesBefore = readFileSync(path).toString('base64');
  s.cacheMtimeBefore = mtimeMs(path);
});

Then('it lists the remaining {int} questions', function (this: LearningWorld, n: number) {
  const s = st(this);
  const out = lastRun(this);
  assert.equal(out.status, 0, out.output);
  const remaining = s.originalQueue.slice(s.originalQueue.length - n);
  const answered = s.originalQueue.slice(0, s.originalQueue.length - n);
  const positions = remaining.map((id) => out.stdout.indexOf(id));
  assert.ok(positions.every((p) => p >= 0), `輸出應該列出剩下的題目 ${remaining.join(', ')}:\n${out.stdout}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, '順序要跟互動模式接下來會問的一樣');
  for (const id of answered) assert.ok(!out.stdout.includes(id), `已答的 ${id} 不該列出來`);
  assert.match(out.stdout, new RegExp(`已答\\s*${s.originalQueue.length - n}\\s*/\\s*共\\s*${s.originalQueue.length}`), '標題行要說明「已答 X / 共 N」');
});

Then('it does not modify the cache', function (this: LearningWorld) {
  const s = st(this);
  const path = cachePath(s.vault, this.today);
  assert.equal(readFileSync(path).toString('base64'), s.cacheBytesBefore, 'dry-run 不可以改快取內容');
  assert.equal(mtimeMs(path), s.cacheMtimeBefore, 'dry-run 不可以動快取(連 mtime 都不行)');
  assert.equal(readFileSync(reviewsPath(s.vault), 'utf8'), s.reviewsBefore ?? readFileSync(reviewsPath(s.vault), 'utf8'), 'dry-run 不可以改 reviews.json');
});

// ---------------------------------------------------------------- 場景 9–11:結束時 snapshot

Given('a learning directory that is a git repository', function (this: LearningWorld) {
  const s = st(this);
  gitInit(s.vault);
  // 把上一次備份之後的變動留在工作樹裡(有一張卡剛排進未來):
  // 這樣「該 snapshot 的時候真的有東西可以 commit」,dry-run / pause 若偷偷 snapshot 就會多出一個 commit。
  const reviews = readReviews(s.vault);
  reviews['sec-0016'] = reviewRecord({ stage: 3, next_due: addDays(this.today, 21) });
  writeReviews(s.vault, reviews);
  s.commitsBefore = commitCount(s.vault);
  s.headBefore = headSha(s.vault);
  s.stampFile = join(s.vault.scratch, 'post-commit-stamp');
  installPostCommitStamp(s.vault, s.stampFile);
});

Given('a learning directory that is not a git repository', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(!existsSync(join(s.vault.dir, '.git')), 'fixture 目錄不該是 git repo');
});

Given('the person answers every due question', { timeout: STEP_TIMEOUT_MS }, async function (this: LearningWorld) {
  const s = st(this);
  await run(this, { answers: 'all' });
  assert.ok(lastRun(this).asked.length >= 3, `三張到期的卡都該被問:\n${lastRun(this).output}`);
  s.originalQueue = askedCards(lastRun(this));
});

When('the session ends', function (this: LearningWorld) {
  const out = lastRun(this);
  assert.equal(out.status, 0, `session 應該正常結束:\n${out.output}`);
});

Then('the summary is printed first', function (this: LearningWorld) {
  const s = st(this);
  const out = lastRun(this);
  assert.match(out.stdout, SUMMARY_LINE, '應該印出小結');
  assert.ok(existsSync(s.stampFile!), 'snapshot 的 commit 應該已經發生');
  const stampMs = Number(BigInt(readFileSync(s.stampFile!, 'utf8').trim()) / 1_000_000n);
  const summaryChunk = out.chunks.find((c) => SUMMARY_LINE.test(c.text));
  assert.ok(summaryChunk, '找不到小結到達的時間');
  assert.ok(summaryChunk.t < stampMs, `小結(${summaryChunk.t})應該比 snapshot 的 commit(${stampMs})先印出`);
});

Then('one snapshot commit of the state folder is made afterwards', function (this: LearningWorld) {
  const s = st(this);
  assert.equal(commitCount(s.vault), s.commitsBefore! + 1, '結束時剛好一個 snapshot commit');
  assert.match(headMessage(s.vault), /^snapshot \d{4}-\d{2}-\d{2}$/);
  const files = headFiles(s.vault);
  assert.ok(files.includes('state/reviews.json'), `commit 應該含 state/reviews.json:${files.join(', ')}`);
  assert.ok(files.every((f) => f.startsWith('state/')), `commit 只該有 state/ 底下的檔案:${files.join(', ')}`);
  assert.deepEqual(trackedFiles(s.vault).filter((f) => f.includes('session-')), [], '當日快取不可以進 learning/ 的 git');
});

Then('no new commit exists in the learning directory', function (this: LearningWorld) {
  const s = st(this);
  assert.equal(headSha(s.vault), s.headBefore, 'dry-run 與 --pause 不可以 snapshot');
  assert.equal(commitCount(s.vault), s.commitsBefore);
  assert.ok(!existsSync(s.stampFile!), 'hook 沒有被觸發過');
});

Then('the answers are on disk', function (this: LearningWorld) {
  const s = st(this);
  const reviews = readReviews(s.vault);
  for (const id of s.originalQueue) {
    assert.ok(reviews[id]!.history.some((h) => h.date === this.today), `${id} 的作答應該已經在 reviews.json`);
  }
});

Then('the exit status is the one the session would have had without the snapshot', function (this: LearningWorld) {
  const out = lastRun(this);
  assert.equal(out.status, 0, `全部答完的 session 退出碼是 0,snapshot 失敗不能改它:\n${out.output}`);
  assert.match(out.stdout, SUMMARY_LINE, '小結仍然要印出來');
});

Then('a hint says that running the init command adds version control', function (this: LearningWorld) {
  const out = lastRun(this);
  const summaryAt = out.output.search(SUMMARY_LINE);
  const afterSummary = out.output.slice(summaryAt);
  assert.match(afterSummary, /cli\.ts init/, `小結之後要提示跑 cli.ts init:\n${out.output}`);
  assert.match(afterSummary, /版本控制/, '提示要說明 init 會補上版本控制');
});
