/**
 * T26 要求 5 · 終端機遇到「reviews.json 在 session 建立之後被別處改過」:印固定訊息到 stderr、退出碼 1、
 * 不印小結、不做 snapshot;已經寫進去的前幾題不受影響;再跑一次就從當日快取續答。
 *
 * 跑**真的** `scripts/review.ts` 子程序(量尺 `features/support/review-session-harness.ts`;
 * `beforeAnswer` 在送出某一題之前改寫磁碟上的 reviews.json,模擬桌面側車或另一個終端機同時在寫)。
 * 場景層(`features/11-review-cli/phase-3.feature` 的兩個 T26 場景)走第一次執行的路;這支補**續答那條建 session 的路**
 * (`sessionFromCache` 從快取還原時也要記雜湊,工單 must_catch 最後一條)與第一題就被改的情況。
 *
 * 一律暫存目錄,不碰真的 learning/;題目只用填空題(精確答案,不花錢、不打網路)。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  TODAY,
  commitCount,
  createVault,
  gitInit,
  readReviews,
  removeVault,
  reviewRecord,
  reviewsPath,
  runAndQuit,
  runReview,
  seedDue,
  writeReviews,
  type Vault,
} from './review-session-harness.js';

const MESSAGE = '複習紀錄剛被別的地方改過,請重新開始今天的複習。剛才那一題需要重答。';
const SUMMARY = /\d+ passed, \d+ returned\./;
const TIMEOUT = 240_000;

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});

/** sec-0001 逾期兩天排第一、sec-0002 今天到期排第二;sec-0003 不在今天的名單上。learning/ 是 git repo(看 snapshot)。 */
function twoDueVault(): Vault {
  const vault = createVault({ cards: 3 });
  vaults.push(vault);
  writeReviews(vault, { 'sec-0003': reviewRecord({ next_due: '2026-12-31', stage: 3 }) });
  seedDue(vault, ['sec-0001', 'sec-0002'], [2, 0]);
  gitInit(vault);
  return vault;
}

/** 別處改了 reviews.json:不在名單上的 sec-0003 多一筆舊的 history。回傳改完的位元組。 */
function changeElsewhere(vault: Vault): Buffer {
  const reviews = readReviews(vault);
  const other = reviews['sec-0003']!;
  reviews['sec-0003'] = { ...other, history: [...other.history, { date: '2026-09-01', stage: 3, type: 'apply', pass: true, grader: 'cloud' }] };
  writeReviews(vault, reviews);
  return readFileSync(reviewsPath(vault));
}

function todays(vault: Vault, card: string): number {
  return (readReviews(vault)[card]?.history ?? []).filter((e) => e.date === TODAY).length;
}

function stateNames(vault: Vault): string[] {
  return readdirSync(join(vault.dir, 'state')).sort();
}

describe('T26 要求 5:終端機遇到被改過的紀錄', () => {
  it(
    '續答(從當日快取還原 session)之後被改 → 退出碼 1、stderr 是固定訊息、沒有小結、沒有 snapshot;再跑一次只問剩下那張',
    async () => {
      const vault = twoDueVault();
      // 第一次:建好當日快取,一題都不答就離開
      const first = await runAndQuit(vault);
      expect(first.asked.map((a) => a.card), first.output).toEqual(['sec-0001']);
      const commits = commitCount(vault);

      // 第二次:從快取續答(sessionFromCache);答完第一張之後、送出第二張之前,別處改了檔
      let theirs: Buffer | undefined;
      const second = await runReview(vault, {
        beforeAnswer: ({ index }) => {
          if (index === 1) theirs = changeElsewhere(vault);
        },
      });
      expect(theirs, '應該問到第二張').toBeDefined();
      expect(second.status, second.output).toBe(1);
      expect(second.stderr).toContain(MESSAGE);
      expect(second.stdout).not.toMatch(SUMMARY);
      expect(commitCount(vault), '偵測到被改過時不做 snapshot').toBe(commits);
      expect(readFileSync(reviewsPath(vault)).equals(theirs!), '別處的改動要原樣留著').toBe(true);
      expect(todays(vault, 'sec-0001'), '前一張已經寫進去').toBe(1);
      expect(todays(vault, 'sec-0002'), '被拒絕的那一題沒有存').toBe(0);

      // 第三次:重新開始今天的複習 → 快取還在,已答的被剃掉,只問 sec-0002
      const third = await runReview(vault);
      expect(third.status, third.output).toBe(0);
      expect(third.asked).toEqual([{ index: 2, total: 2, card: 'sec-0002' }]);
      expect(todays(vault, 'sec-0002')).toBe(1);
    },
    TIMEOUT,
  );

  it(
    '第一題送出之前就被改 → 一筆都不寫(檔案還是別人的那份)、退出碼 1、沒有小結與 snapshot、state/ 沒有多出任何檔',
    async () => {
      const vault = twoDueVault();
      const commits = commitCount(vault);
      const names = stateNames(vault);
      let theirs: Buffer | undefined;
      const run = await runReview(vault, {
        beforeAnswer: ({ index }) => {
          if (index === 0) theirs = changeElsewhere(vault);
        },
      });
      expect(run.status, run.output).toBe(1);
      expect(run.stderr).toContain(MESSAGE);
      expect(run.stdout).not.toMatch(SUMMARY);
      expect(readFileSync(reviewsPath(vault)).equals(theirs!)).toBe(true);
      expect(commitCount(vault)).toBe(commits);
      expect(stateNames(vault)).toEqual(names);
      expect(run.asked.map((a) => a.card), '被拒絕之後不再出下一題').toEqual(['sec-0001']);
    },
    TIMEOUT,
  );

  it(
    '防退步:中間沒有人動檔 → 兩張都寫入、退出碼 0、印小結、做 snapshot',
    async () => {
      const vault = twoDueVault();
      const commits = commitCount(vault);
      const run = await runReview(vault);
      expect(run.status, run.output).toBe(0);
      expect(run.stdout).toMatch(SUMMARY);
      expect(run.stderr).not.toContain(MESSAGE);
      expect(todays(vault, 'sec-0001')).toBe(1);
      expect(todays(vault, 'sec-0002')).toBe(1);
      expect(commitCount(vault)).toBe(commits + 1);
    },
    TIMEOUT,
  );
});
