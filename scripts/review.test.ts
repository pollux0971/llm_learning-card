/**
 * scripts/review.ts --dry-run 的「空的跟健康的長一樣」測試(P-28)。
 *
 * 這支比 lint.ts 更嚴重,因為「Nothing is due today.」是使用者**每天**都會
 * 看到的句子:
 *
 *   $ npx tsx scripts/review.ts --dir ./learning --today 2026-09-04 --dry-run
 *   Nothing is due today.                    exit=0     # 25 張卡,今天沒到期
 *   $ npx tsx scripts/review.ts --dir <設定齊全但 0 張卡> --today ... --dry-run
 *   Nothing is due today.                    exit=0     # 卡片全部不見了
 *
 * 卡片如果因為任何原因消失,使用者看到的是一模一樣的安心訊息,而且會連續看
 * 好幾天才可能起疑。I5「開機就在」整條路徑都靠這一行。
 *
 * 這一輪要把兩件事分開:
 *   「今天沒有到期」  = 正常的空閒日 → exit 0,但訊息要帶基數,讓使用者看得
 *                       出來系統確實看過他的卡。
 *   「這個 vault 沒有卡片」= 異常狀態 → exit 1,而且絕不可以說 Nothing is due。
 *
 * reviews.json 的三個邊界,語意判斷寫在下面各自的 describe 裡。第三種
 * (卡片在、沒有任何 review 紀錄)是**正常的**——I1 剛產出的 25 張就是這個
 * 狀態,不可以誤判成錯誤。
 *
 * 測法:一律臨時目錄,不碰 /data/python/llm_learning-cards/learning/
 * (CLAUDE.md 硬規則 2)。--dry-run 本身不寫檔,但受測的 vault 仍然全部是複本。
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..');

/** 每天都會看到的那句話。0 張卡的路徑絕不可以再印它。 */
const NOTHING_DUE = 'Nothing is due today.';

const TODAY = '2026-09-04';

/** spawnSync 起 `npx tsx` 子行程要一到三秒,忙的時候更久(同 check-boundaries.test.ts)。 */
const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];

interface ReviewRecord {
  stage: number;
  learned_at: string;
  next_due: string | null;
  fails_in_row: number;
  total_fails: number;
  stuck: boolean;
  history: unknown[];
}

function review(nextDue: string | null, stage = 2): ReviewRecord {
  return {
    stage,
    learned_at: '2026-08-01',
    next_due: nextDue,
    fails_in_row: 0,
    total_fails: 0,
    stuck: false,
    history: [],
  };
}

/**
 * learning-minimal 的複本(3 張卡 sec-0001..0003、config/settings.yaml 齊全),
 * 再照參數調整 cards/ 與 state/reviews.json。
 *
 * reviews 傳 null 代表「reviews.json 這個檔案不存在」,跟傳 `{}`(檔案在、內容空)
 * 是不同的兩件事——底下 reviews.json 那組邊界測試就是在分這兩種。
 */
function vault(opts: { cards?: boolean; reviews?: Record<string, ReviewRecord> | null } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-review-cli-'));
  tmpDirs.push(dir);
  cpSync(join(REPO_ROOT, 'contracts/fixtures/learning-minimal'), dir, { recursive: true });

  if (opts.cards === false) {
    // 設定齊全、目錄結構在,就是一張卡都沒有——同步壞掉 / 目錄改名後的樣子。
    for (const name of readdirSync(join(dir, 'cards/security'))) {
      rmSync(join(dir, 'cards/security', name), { force: true });
    }
  }

  const reviewsPath = join(dir, 'state/reviews.json');
  if (opts.reviews === null) {
    rmSync(reviewsPath, { force: true });
  } else if (opts.reviews !== undefined) {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(reviewsPath, `${JSON.stringify(opts.reviews, null, 2)}\n`, 'utf8');
  }

  return dir;
}

function runDryRun(dir: string, today = TODAY): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', 'scripts/review.ts', '--dir', dir, '--today', today, '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** 從輸出裡撈一個「N <單位>」的數字。撈不到回傳 null,測試就指著缺的那個數字紅。 */
function count(output: string, unit: string): number | null {
  const m = new RegExp(`(\\d+)\\s*${unit}`).exec(output);
  return m ? Number(m[1]) : null;
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe('review.ts --dry-run 印出基數', () => {
  it('有卡、今天沒到期:輸出帶「幾張卡」與「幾張到期」兩個數字', () => {
    const dir = vault({ reviews: { 'sec-0001': review('2026-12-01'), 'sec-0002': review('2026-12-02') } });
    const { code, output } = runDryRun(dir);

    expect(code).toBe(0);
    expect(count(output, '張卡')).toBe(3);
    expect(count(output, '張到期')).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('有卡、有到期:兩個數字都要對,不是只有到期的那些才數得出來', () => {
    const dir = vault({
      reviews: {
        'sec-0001': review('2026-09-01'),
        'sec-0002': review('2026-09-04'),
        'sec-0003': review('2026-12-01'),
      },
    });
    const { code, output } = runDryRun(dir);

    expect(code).toBe(0);
    expect(count(output, '張卡')).toBe(3);
    expect(count(output, '張到期')).toBe(2);
  }, SPAWN_TIMEOUT_MS);

  it('基數是真的數出來的:刪掉一張卡,「幾張卡」要跟著變', () => {
    const dir = vault({ reviews: { 'sec-0001': review('2026-12-01') } });
    expect(count(runDryRun(dir).output, '張卡')).toBe(3);

    rmSync(join(dir, 'cards/security/sec-0003.md'), { force: true });
    expect(count(runDryRun(dir).output, '張卡')).toBe(2);
  }, SPAWN_TIMEOUT_MS);

  it('到期清單本身不變:該列的卡片 id、stage、逾期天數還在(既有行為的護欄)', () => {
    const dir = vault({
      reviews: { 'sec-0001': review('2026-09-01', 3), 'sec-0002': review('2026-12-01') },
    });
    const { output } = runDryRun(dir);

    expect(output).toContain('sec-0001');
    expect(output).toContain('stage 3');
    expect(output).toContain('overdue 3d');
    expect(output).not.toContain('sec-0002');
  }, SPAWN_TIMEOUT_MS);
});

describe('review.ts --dry-run:0 張卡不是空閒日', () => {
  it('0 張卡 → exit 1(那是異常狀態,不是正常的空閒日)', () => {
    const { code } = runDryRun(vault({ cards: false, reviews: {} }));
    expect(code).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it('0 張卡 → 絕不可以說「Nothing is due today.」', () => {
    const { output } = runDryRun(vault({ cards: false, reviews: {} }));
    expect(output).not.toContain(NOTHING_DUE);
  }, SPAWN_TIMEOUT_MS);

  it('0 張卡 → 訊息要說清楚是「這個 vault 沒有卡片」,並且把 0 印出來', () => {
    const { output } = runDryRun(vault({ cards: false, reviews: {} }));
    expect(count(output, '張卡')).toBe(0);
    expect(output).toMatch(/沒有卡片|一張卡片也沒有/);
  }, SPAWN_TIMEOUT_MS);

  it('cards/ 整個不存在也是 0 張卡,走同一條路徑', () => {
    const dir = vault({ reviews: {} });
    rmSync(join(dir, 'cards'), { recursive: true, force: true });
    const { code, output } = runDryRun(dir);

    expect(code).toBe(1);
    expect(output).not.toContain(NOTHING_DUE);
  }, SPAWN_TIMEOUT_MS);

  it('「0 張卡」與「有卡但 0 張到期」的輸出必須不一樣', () => {
    const empty = runDryRun(vault({ cards: false, reviews: {} }));
    const quiet = runDryRun(vault({ reviews: { 'sec-0001': review('2026-12-01') } }));

    expect(empty.output).not.toBe(quiet.output);
    expect(empty.code).not.toBe(quiet.code);
  }, SPAWN_TIMEOUT_MS);

  it('有卡但 0 張到期仍然 exit 0——正常的空閒日不可以被改成紅燈', () => {
    const { code } = runDryRun(vault({ reviews: { 'sec-0001': review('2026-12-01') } }));
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);
});

/**
 * reviews.json 的三個邊界,語意判斷(這一輪的決定):
 *
 *   1. **檔案不存在** —— 這個 vault 從來沒有被複習過。載入端(session/io.ts
 *      的 loadReviews)已經把它當成 `{}`,那是對的:不存在不是壞掉,是還沒開始。
 *   2. **檔案存在但是 `{}`** —— 意思跟 1 完全相同(排程是空的)。差別只在磁碟上
 *      有沒有那個檔案,對使用者沒有任何意義,所以**輸出必須一模一樣**;
 *      如果兩者印出不同的話,那是實作細節漏到使用者面前。
 *   3. **卡片存在、但那些卡沒有任何 review 紀錄** —— 「新卡還沒排程」。
 *      I1 剛產出的 25 張就是這個狀態,而且真 vault 現在就是這樣
 *      (25 張卡、連 state/reviews.json 都還沒有)。這是**正常的**,
 *      不可以誤判成錯誤,但要說出來,不然使用者分不出「排程是空的」跟
 *      「今天剛好沒排到」。
 *
 * 三者跟「0 張卡」正交:卡片在不在決定退出碼,排程有沒有只影響訊息。
 */
describe('review.ts --dry-run:reviews.json 的三個邊界', () => {
  it('1. reviews.json 不存在、卡片在 → exit 0,不是錯誤', () => {
    const { code } = runDryRun(vault({ reviews: null }));
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('1. reviews.json 不存在 → 說得出「3 張卡、0 張到期」,不是只有一句 Nothing is due', () => {
    const { output } = runDryRun(vault({ reviews: null }));

    expect(count(output, '張卡')).toBe(3);
    expect(count(output, '張到期')).toBe(0);
    expect(output.trim()).not.toBe(NOTHING_DUE);
  }, SPAWN_TIMEOUT_MS);

  it('1. reviews.json 不存在 → 要說出「還沒排程」,不可以說這個 vault 沒有卡片', () => {
    const { output } = runDryRun(vault({ reviews: null }));

    expect(output).toMatch(/未排程|還沒排程|尚未排程/);
    expect(output).not.toMatch(/沒有卡片|一張卡片也沒有/);
  }, SPAWN_TIMEOUT_MS);

  it('2. reviews.json 存在但是 {} → 跟「檔案不存在」的輸出一模一樣(對使用者是同一件事)', () => {
    const missing = runDryRun(vault({ reviews: null }));
    const emptyObject = runDryRun(vault({ reviews: {} }));

    expect(emptyObject.output).toBe(missing.output);
    expect(emptyObject.code).toBe(missing.code);
  }, SPAWN_TIMEOUT_MS);

  it('3. 卡片在、部分卡沒有 review 紀錄 → exit 0,而且說得出有幾張還沒排程', () => {
    // 3 張卡,只有 sec-0001 排過程,而且排在很久以後 → 今天 0 張到期、2 張未排程。
    const dir = vault({ reviews: { 'sec-0001': review('2026-12-01') } });
    const { code, output } = runDryRun(dir);

    expect(code).toBe(0);
    expect(count(output, '張未排程')).toBe(2);
  }, SPAWN_TIMEOUT_MS);

  it('3. 全部卡都排過程、今天剛好都沒到期 → 不可以再說有卡沒排程', () => {
    const dir = vault({
      reviews: {
        'sec-0001': review('2026-12-01'),
        'sec-0002': review('2026-12-02'),
        'sec-0003': review('2026-12-03'),
      },
    });
    const { code, output } = runDryRun(dir);

    expect(code).toBe(0);
    expect(count(output, '張未排程')).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('「全部未排程」與「全部排好但今天沒到期」必須分得出來——都是 0 張到期,意思不同', () => {
    const unscheduled = runDryRun(vault({ reviews: null }));
    const scheduledQuiet = runDryRun(
      vault({
        reviews: {
          'sec-0001': review('2026-12-01'),
          'sec-0002': review('2026-12-02'),
          'sec-0003': review('2026-12-03'),
        },
      }),
    );

    expect(unscheduled.code).toBe(0);
    expect(scheduledQuiet.code).toBe(0);
    expect(unscheduled.output).not.toBe(scheduledQuiet.output);
  }, SPAWN_TIMEOUT_MS);

  it('0 張卡 + reviews.json 不存在 → 「沒有卡片」贏,exit 1(不是「還沒排程」)', () => {
    const { code, output } = runDryRun(vault({ cards: false, reviews: null }));

    expect(code).toBe(1);
    expect(output).toMatch(/沒有卡片|一張卡片也沒有/);
  }, SPAWN_TIMEOUT_MS);
});
