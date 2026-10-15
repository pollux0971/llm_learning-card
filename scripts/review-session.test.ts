/**
 * T17(11-review-cli phase-2)· 當日 session 的邊界,從 CLI 外面量。
 *
 * 跑**真的** `scripts/review.ts` 子程序(量尺在 features/support/review-session-harness.ts),
 * 查它留在磁碟上的東西:XDG cache 底下的當日快取、reviews.json、state/log.jsonl、git 歷史,以及使用者看到的字。
 * 場景層(`features/11-review-cli/phase-2.feature`)走主要的快樂路徑;這支補場景沒有指到的邊界與
 * 工單 must_catch 的每一條壞法:環境變數、vault_id 分開、跨日清理只動自己的資料夾、壞快取的各種壞法、
 * 暫停日不需要帳本、dry-run 不碰快取、snapshot 的有無與失敗。
 *
 * 規格來源是工單 `docs/tickets/T17-review-cli-phase-2.md` 與 ADR-074。工單沒有指定函式名字,
 * 所以這裡不 import 任何還沒寫的模組——全部從外面量。快取檔的內容格式(工單「快取格式」)是規格,
 * 測試會自己手寫符合格式的快取來證明「讀的是快取、不是重算」。
 *
 * 測法:一律暫存目錄(learning、XDG_CONFIG_HOME、XDG_CACHE_HOME、HOME),不碰真的 learning/ 與真的 ~/.cache。
 * 沒有任何一步花錢或打網路(子程序的網路層是假的;題目只用填空題,加一題故意讓審核失敗的應用題)。
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  TODAY,
  addDays,
  cacheBase,
  cacheDir,
  cachePath,
  commitCount,
  createVault,
  gitInit,
  headFiles,
  headMessage,
  headSha,
  installFailingPreCommit,
  ledgerEvents,
  linkTo,
  listTree,
  mtimeMs,
  readCache,
  readReviews,
  removeVault,
  reviewRecord,
  reviewsPath,
  runAndQuit,
  runCwd,
  runReview,
  runToEnd,
  seedDue,
  trackedFiles,
  treeBytes,
  writeReviews,
  type CacheShape,
  type CreateVaultOpts,
  type Vault,
} from '../features/support/review-session-harness.js';

const YESTERDAY = addDays(TODAY, -1);
const SUMMARY_LINE = /\d+ passed, \d+ returned\./;
const TEST_TIMEOUT_MS = 180_000;

const vaults: Vault[] = [];
function vault(opts: CreateVaultOpts = {}): Vault {
  const v = createVault(opts);
  vaults.push(v);
  return v;
}
afterAll(() => {
  for (const v of vaults) removeVault(v);
});

const ids = (n: number, from = 1): string[] => Array.from({ length: n }, (_, i) => `sec-${String(from + i).padStart(4, '0')}`);
/** 逾期天數由大到小:04 排出來的順序固定(sec-0001 在最前面)。 */
const spread = (n: number): number[] => Array.from({ length: n }, (_, i) => n + 2 - i);

function dueVault(n: number, opts: CreateVaultOpts = {}): Vault {
  const v = vault({ cards: Math.max(n, 6), ...opts });
  seedDue(v, ids(n), spread(n));
  return v;
}

function cacheOf(over: Partial<CacheShape> = {}): CacheShape {
  const queue = over.queue ?? ids(3).map((card, i) => ({ card, stage: 1, overdue_days: 3 - i, overdue_ratio: 3 - i }));
  return { version: 1, date: TODAY, paused: false, total_due: queue.length, deferred: 0, queue, reteach: [], ...over };
}

function writeCacheFile(v: Vault, content: unknown, date = TODAY, folder?: string): string {
  const path = cachePath(v, date, folder);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  return path;
}

function fileBytes(path: string): string {
  return readFileSync(path).toString('base64');
}

function logBytes(v: Vault): string {
  const path = join(v.dir, 'state/log.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function pathFolder(v: Vault, dir = v.dir): string {
  return `path-${createHash('sha256').update(realpathSync(dir)).digest('hex').slice(0, 16)}`;
}

function sessionFiles(v: Vault, folder?: string): string[] {
  const dir = cacheDir(v, folder);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function warnings(v: Vault): Record<string, unknown>[] {
  return ledgerEvents(v).filter((e) => e.type === 'warning' && e.reason === 'session-cache-invalid');
}

// =====================================================================================
describe('當日快取:位置與格式(驗收 1)', () => {
  it(
    '第一次執行在 ${XDG_CACHE_HOME}/llm-learning-cards/<vault_id>/session-<今天>.json 建快取;資料夾裡只有這一個檔(沒有殘留的暫存檔);learning/ 底下一個檔都沒多',
    async () => {
      const v = dueVault(5);
      const treeBefore = treeBytes(v.dir);
      const out = await runAndQuit(v);
      expect(out.asked.length, out.output).toBeGreaterThan(0);

      expect(existsSync(join(v.xdgCache, 'llm-learning-cards', v.vaultId!, `session-${TODAY}.json`))).toBe(true);
      expect(sessionFiles(v)).toEqual([`session-${TODAY}.json`]);
      expect(treeBytes(v.dir), '什麼都沒答:learning/ 底下的檔案與內容都不該變(快取不在 learning/ 裡)').toEqual(treeBefore);
      expect(readdirSync(cacheBase(v))).toEqual([v.vaultId]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '快取內容是工單的格式:version 1、date、paused false、total_due、deferred、queue(只有四個欄位)、reteach;queue 的順序就是互動模式問的順序',
    async () => {
      const v = dueVault(5);
      const out = await runToEnd(v);
      const asked = out.asked.map((a) => a.card);
      expect(asked).toEqual(ids(5));
      const cache = readCache(v) as unknown as CacheShape;
      expect(Object.keys(cache).sort()).toEqual(['date', 'deferred', 'paused', 'queue', 'reteach', 'total_due', 'version']);
      expect(cache.version).toBe(1);
      expect(cache.date).toBe(TODAY);
      expect(cache.paused).toBe(false);
      expect(cache.total_due).toBe(5);
      expect(cache.deferred).toBe(0);
      expect(cache.reteach).toEqual([]);
      expect(cache.queue.map((q) => q.card)).toEqual(asked);
      for (const [i, item] of cache.queue.entries()) {
        expect(Object.keys(item).sort(), '只存 04 DueItem 的欄位:不存 learned_at、答案、分數').toEqual(['card', 'overdue_days', 'overdue_ratio', 'stage']);
        expect(item.stage).toBe(1);
        expect(item.overdue_days).toBe(spread(5)[i]);
        expect(typeof item.overdue_ratio).toBe('number');
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '要 reteach 的卡(fails_in_row 剛好 2)記在 reteach;超過每日上限的記在 deferred,total_due 是上限內的張數,續答時延後那一行與分母都跟快取一致',
    async () => {
      const v = vault({ cards: 6, dailyCap: 3 });
      const reviews = Object.fromEntries(ids(5).map((id, i) => [id, reviewRecord({ next_due: addDays(TODAY, -spread(5)[i]!) })]));
      reviews['sec-0001'] = reviewRecord({ next_due: addDays(TODAY, -7), fails_in_row: 2, total_fails: 2 });
      writeReviews(v, reviews);
      writeFileSync(
        join(v.dir, 'cards/security/sec-0001.short.md'),
        '---\nid: sec-0001\ncategory: security\ntitle: 同源政策\nlevel: 0\nsource: raw\ncreated: 2026-09-01\n---\n同源:協定、主機、埠號三者相同。\n',
        'utf8',
      );
      const first = await runReview(v, { answers: 1 });
      expect(first.stdout).toMatch(/2\s*張延後/);
      const cache = readCache(v) as unknown as CacheShape;
      expect(cache.reteach).toEqual(['sec-0001']);
      expect(cache.total_due).toBe(3);
      expect(cache.deferred).toBe(2);
      expect(cache.queue).toHaveLength(3);

      const second = await runToEnd(v);
      expect(second.stdout, '續答時延後的張數也要照快取').toMatch(/2\s*張延後/);
      expect(second.asked.map((a) => [a.index, a.total])).toEqual([
        [2, 3],
        [3, 3],
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '快取用 vault_id 分開:兩本帳本共用同一個 XDG_CACHE_HOME,各用各的資料夾,互不看見也互不改',
    async () => {
      const a = dueVault(3);
      await runAndQuit(a);
      const aBytes = fileBytes(cachePath(a));

      const b = vault({ cards: 8, xdgCache: a.xdgCache });
      expect(b.vaultId).not.toBe(a.vaultId);
      seedDue(b, ids(4, 5), [9, 8, 7, 6]);
      await runAndQuit(b);

      expect(readdirSync(cacheBase(a)).sort()).toEqual([a.vaultId, b.vaultId].sort());
      expect((readCache(b) as unknown as CacheShape).queue.map((q) => q.card), '換一本帳本不可以讀到別本的快取').toEqual(ids(4, 5));
      expect(fileBytes(cachePath(a)), 'b 不可以改到 a 的快取').toBe(aBytes);
      expect((readCache(a) as unknown as CacheShape).queue.map((q) => q.card)).toEqual(ids(3));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'XDG_CACHE_HOME 為空字串或沒設:改用 $HOME/.cache(不是相對於目前目錄),而且空字串跟沒設結果一樣',
    async () => {
      for (const xdg of ['', undefined] as const) {
        const v = dueVault(3);
        const out = await runAndQuit(v, { env: { XDG_CACHE_HOME: xdg } });
        expect(out.asked.length, out.output).toBeGreaterThan(0);
        const expected = join(v.home, '.cache', 'llm-learning-cards', v.vaultId!, `session-${TODAY}.json`);
        expect(existsSync(expected), `XDG_CACHE_HOME=${JSON.stringify(xdg)} 時快取應該在 ${'$HOME/.cache/…'}`).toBe(true);
        expect(readdirSync(runCwd(v)), '相對路徑的快取會長在目前目錄').toEqual([]);
        expect(existsSync(v.xdgCache), '不該寫到沒設定的 XDG 位置').toBe(false);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '沒有 vault-id 的目錄(複習不需要帳本身分):資料夾名是 path- 加上 --dir 的真實絕對路徑 sha256 前 16 個十六進位字元;用 symlink 指到同一個目錄結果相同',
    async () => {
      const v = vault({ cards: 4, vaultId: null });
      seedDue(v, ids(3), spread(3));
      const link = linkTo(v);
      const out = await runReview(v, { args: ['--pause'], rawArgs: ['--dir', link, '--today', TODAY, '--pause'] });
      expect(out.status, out.output).toBe(0);
      const folder = pathFolder(v);
      expect(folder).toMatch(/^path-[0-9a-f]{16}$/);
      expect(sessionFiles(v, folder)).toEqual([`session-${TODAY}.json`]);
      expect(readdirSync(cacheBase(v))).toEqual([folder]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'vault-id 內容不是 uuid 時也走 path-<16 hex>(不把亂字串當資料夾名)',
    async () => {
      const v = vault({ cards: 4 });
      writeFileSync(join(v.dir, 'config/vault-id'), '../../escape\n', 'utf8');
      seedDue(v, ids(3), spread(3));
      const out = await runReview(v, { args: ['--pause'] });
      expect(out.status, out.output).toBe(0);
      expect(readdirSync(cacheBase(v))).toEqual([pathFolder(v)]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '正常執行不會寫任何 session-cache-invalid 的 warning;learning/ 底下整場只會動到既有檔案,沒有任何 session 或 .tmp',
    async () => {
      const v = dueVault(3);
      const before = new Set(listTree(v.dir));
      await runToEnd(v);
      expect(warnings(v)).toEqual([]);
      const added = listTree(v.dir).filter((f) => !before.has(f));
      expect(added.filter((f) => /session|\.tmp$/.test(f))).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

// =====================================================================================
describe('當日快取:同一天再跑,用快取裡那一份(驗收 1)', () => {
  it(
    '題目集合與順序、分母都來自快取,不重算:手寫一份只有兩張卡、順序相反的快取,就照那份問(磁碟上其實有三張到期)',
    async () => {
      const v = dueVault(3);
      writeCacheFile(
        v,
        cacheOf({
          queue: [
            { card: 'sec-0003', stage: 1, overdue_days: 1, overdue_ratio: 1 },
            { card: 'sec-0001', stage: 1, overdue_days: 3, overdue_ratio: 3 },
          ],
          total_due: 2,
        }),
      );
      const out = await runToEnd(v);
      expect(out.asked.map((a) => [a.index, a.total, a.card])).toEqual([
        [1, 2, 'sec-0003'],
        [2, 2, 'sec-0001'],
      ]);
      expect(readReviews(v)['sec-0002']!.history, '不在快取裡的卡今天不問').toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '快取的 queue 裡今天已答過的卡(reviews.json 有今天的 history)直接略過;進度分母仍是 total_due',
    async () => {
      const v = dueVault(4);
      const reviews = readReviews(v);
      reviews['sec-0002'] = reviewRecord({ stage: 2, next_due: addDays(TODAY, 7), history: [{ date: TODAY, stage: 1, type: 'fill', pass: true, grader: 'exact' }] });
      writeReviews(v, reviews);
      writeCacheFile(v, cacheOf({ queue: ids(4).map((card, i) => ({ card, stage: 1, overdue_days: 4 - i, overdue_ratio: 4 - i })) }));
      const out = await runToEnd(v);
      expect(out.asked.map((a) => a.card)).toEqual(['sec-0001', 'sec-0003', 'sec-0004']);
      expect(out.asked.every((a) => a.total === 4)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '「已答」只看今天的 history:昨天(或更早)答過的紀錄不算,到期的卡照問',
    async () => {
      const v = dueVault(3);
      const reviews = readReviews(v);
      reviews['sec-0001'] = reviewRecord({
        stage: 2,
        next_due: addDays(TODAY, -3),
        history: [{ date: YESTERDAY, stage: 1, type: 'fill', pass: true, grader: 'exact' }],
      });
      writeReviews(v, reviews);
      writeCacheFile(v, cacheOf({ queue: [{ card: 'sec-0001', stage: 2, overdue_days: 3, overdue_ratio: 0.5 }, { card: 'sec-0002', stage: 1, overdue_days: 2, overdue_ratio: 2 }], total_due: 2 }));
      const out = await runReview(v, { answers: 1 });
      expect(out.asked[0]).toEqual({ index: 1, total: 2, card: 'sec-0001' });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '小結是「今天這一輪」(顧問裁決):先答 1 題、續答剩下 3 題(續答第一題故意答錯)→ 「3 passed, 1 returned.」,另有「Answered this run: 3.」',
    async () => {
      const v = dueVault(4);
      await runReview(v, { answers: 1 });
      expect(readReviews(v)['sec-0001']!.history).toHaveLength(1);
      const out = await runReview(v, { answers: 'all', wrongAt: [0] });
      expect(out.asked.map((a) => a.index)).toEqual([2, 3, 4]);
      expect(out.stdout).toMatch(/3 passed, 1 returned\./);
      expect(out.stdout).toMatch(/Answered this run: 3\./);
      expect(out.stdout).not.toMatch(/Retry later/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '小結的 passed / returned 從 reviews.json 算(今天這一輪):stage 2 的兩筆合成一張卡,有效結果 = revised_to ?? pass,每張卡只算一次;沒有今天 history 的卡是待重試,不算進去',
    async () => {
      const v = vault({ cards: 6 });
      const todays = (over: Partial<{ stage: number; type: 'fill' | 'apply'; pass: boolean; revised_to: boolean }>): { date: string; stage: number; type: 'fill' | 'apply'; pass: boolean; grader: string; revised_by?: 'cloud'; revised_to?: boolean } => ({
        date: TODAY,
        stage: 2,
        type: 'fill',
        pass: true,
        grader: 'exact',
        ...(over.revised_to !== undefined ? { revised_by: 'cloud' as const } : {}),
        ...over,
      });
      const far = addDays(TODAY, 9);
      writeReviews(v, {
        // 0001:stage 2,填空過、應用原本沒過但雲端改判為過 → 通過
        'sec-0001': reviewRecord({ stage: 3, next_due: far, history: [todays({}), todays({ type: 'apply', pass: false, revised_to: true })] }),
        // 0002:單筆應用題,原本過、雲端改判為沒過 → 回退
        'sec-0002': reviewRecord({ stage: 1, next_due: addDays(TODAY, 1), history: [todays({ stage: 3, type: 'apply', pass: true, revised_to: false })] }),
        // 0003:stage 2,填空過、應用沒過(沒改判)→ 回退(兩筆只算一張卡)
        'sec-0003': reviewRecord({ stage: 1, next_due: addDays(TODAY, 1), history: [todays({}), todays({ type: 'apply', pass: false })] }),
        // 0004:今天還沒答、到期 → 這一次執行答(填空答對)
        'sec-0004': reviewRecord({ next_due: addDays(TODAY, -2) }),
        // 0005:stage 3 應用題,這一次執行回答 GARBAGE → 批改失敗,卡片不動、沒有今天的 history → 待重試
        'sec-0005': reviewRecord({ stage: 3, next_due: addDays(TODAY, -1) }),
      });
      writeCacheFile(
        v,
        cacheOf({
          queue: ids(5).map((card, i) => ({ card, stage: 1, overdue_days: 5 - i, overdue_ratio: 5 - i })),
        }),
      );
      const out = await runToEnd(v, { applyText: 'GARBAGE' });
      expect(out.status, out.output).toBe(0);
      expect(out.asked.map((a) => a.card).sort()).toEqual(['sec-0004', 'sec-0005']);
      expect(out.stdout).toMatch(/2 passed, 2 returned\./);
      expect(out.stdout).toMatch(/Answered this run: 2\./);
      expect(out.stdout).toMatch(/Retry later: 1 question\(s\)\./);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '因錯誤而沒有結果的卡(審核失敗,卡片不動、沒有 history)續答時會再問一次',
    async () => {
      const v = vault({ cards: 4 });
      writeReviews(v, { 'sec-0001': reviewRecord({ stage: 3, next_due: TODAY }), 'sec-0002': reviewRecord({ stage: 1, next_due: addDays(TODAY, -1) }) });
      // sec-0001 是 stage 3,只有應用題:回答 GARBAGE → 假雲端回一段不是 JSON 的字 → 審核失敗(error),卡片不動
      const first = await runToEnd(v, { applyText: 'GARBAGE' });
      expect(first.asked.map((a) => a.card).sort()).toEqual(['sec-0001', 'sec-0002']);
      expect(readReviews(v)['sec-0001']!.history, '審核失敗不寫 history').toEqual([]);
      expect(readReviews(v)['sec-0002']!.history).toHaveLength(1);
      // 批改失敗的題沒有 history:不算 passed / returned,另列「Retry later: 1 question(s).」
      expect(first.stdout).toMatch(/1 passed, 0 returned\./);
      expect(first.stdout).toMatch(/Retry later: 1 question\(s\)\./);
      expect(first.stdout).toMatch(/Answered this run: 2\./);

      const second = await runToEnd(v, { applyText: 'PASSALL' });
      expect(second.asked.map((a) => a.card), '沒有結果的卡要再問,已經答完的不再問').toEqual(['sec-0001']);
      expect(readReviews(v)['sec-0001']!.history).toHaveLength(1);
      expect(second.stdout).toMatch(/2 passed, 0 returned\./);
      expect(second.stdout).toMatch(/Answered this run: 1\./);
      expect(second.stdout).not.toMatch(/Retry later/);
    },
    TEST_TIMEOUT_MS,
  );
});

// =====================================================================================
describe('跨日(驗收 1)', () => {
  it(
    '昨天的快取不管暫停與否都失效:今天重建並照常問題;建好今天的之後,這本帳本資料夾裡其他日期的 session-*.json 全刪,別本帳本的資料夾不動',
    async () => {
      const v = dueVault(3);
      writeCacheFile(v, cacheOf({ date: YESTERDAY, paused: true, queue: [{ card: 'sec-0003', stage: 1, overdue_days: 0, overdue_ratio: 0 }], total_due: 1 }), YESTERDAY);
      writeCacheFile(v, cacheOf({ date: '2026-09-01' }), '2026-09-01');
      const otherFolder = '11111111-2222-4333-8444-555555555555';
      const otherFile = writeCacheFile(v, cacheOf({ date: '2026-09-01' }), '2026-09-01', otherFolder);
      const otherBytes = fileBytes(otherFile);

      const out = await runToEnd(v);
      expect(out.status, out.output).toBe(0);
      expect(out.asked.map((a) => a.card), '昨天的暫停與題目都不能帶到今天').toEqual(ids(3));
      expect(sessionFiles(v)).toEqual([`session-${TODAY}.json`]);
      expect(fileBytes(otherFile), '別本帳本的資料夾不動').toBe(otherBytes);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '檔名是今天、但檔案裡的 date 是昨天(過期的快取):用 reviews.json 重建,不用裡面的題目',
    async () => {
      const v = dueVault(3);
      writeCacheFile(v, cacheOf({ date: YESTERDAY, queue: [{ card: 'sec-0003', stage: 1, overdue_days: 0, overdue_ratio: 0 }], total_due: 1 }), TODAY);
      const out = await runToEnd(v);
      expect(out.asked.map((a) => a.card)).toEqual(ids(3));
      expect((readCache(v) as unknown as CacheShape).date).toBe(TODAY);
    },
    TEST_TIMEOUT_MS,
  );
});

// =====================================================================================
describe('壞快取:丟掉、重建、記一筆 warning,不當掉(驗收 1)', () => {
  const cases: [string, () => string | CacheShape | Record<string, unknown>][] = [
    ['不是合法 JSON', () => '{"version": 1, "date": "2026-09-10", "queue": [ <<<'],
    ['空檔', () => ''],
    ['JSON 但不是物件', () => '[]'],
    ['缺 queue 欄位', () => ({ version: 1, date: TODAY, paused: false, total_due: 3, deferred: 0, reteach: [] })],
    ['未知的 version', () => ({ ...cacheOf(), version: 2 })],
    ['queue 項多了 learned_at', () => ({ ...cacheOf(), queue: [{ card: 'sec-0001', stage: 1, overdue_days: 1, overdue_ratio: 1, learned_at: '2026-08-01' }] })],
    ['paused 不是布林', () => ({ ...cacheOf(), paused: 'yes' })],
  ];

  it.each(cases)(
    '%s → 重建、剛好一筆 warning(reason 與檔名,不含絕對路徑)、退出碼 0、題目照常問',
    async (_name, make) => {
      const v = dueVault(3);
      const reviewsBefore = readFileSync(reviewsPath(v), 'utf8');
      writeCacheFile(v, make());
      const out = await runToEnd(v);
      expect(out.status, out.output).toBe(0);
      expect(out.asked.map((a) => a.card)).toEqual(ids(3));
      const found = warnings(v);
      expect(found).toHaveLength(1);
      expect(found[0]!.path).toBe(`session-${TODAY}.json`);
      expect(JSON.stringify(found[0]), '事件裡不寫絕對路徑').not.toContain(v.scratch);
      expect(typeof found[0]!.ts === 'string' && !Number.isNaN(Date.parse(found[0]!.ts as string))).toBe(true);
      const rebuilt = readCache(v) as unknown as CacheShape;
      expect(rebuilt.version).toBe(1);
      expect(rebuilt.date).toBe(TODAY);
      expect(rebuilt.queue.map((q) => q.card)).toEqual(ids(3));
      expect(readFileSync(reviewsPath(v), 'utf8')).not.toBe(reviewsBefore);
      expect(sessionFiles(v)).toEqual([`session-${TODAY}.json`]);
    },
    TEST_TIMEOUT_MS,
  );

  it.skipIf(process.getuid?.() === 0)(
    '讀不到(沒有讀取權限)也算壞掉:重建並記 warning,不當掉',
    async () => {
      const v = dueVault(3);
      const path = writeCacheFile(v, cacheOf());
      chmodSync(path, 0o000);
      const out = await runToEnd(v);
      expect(out.status, out.output).toBe(0);
      expect(warnings(v)).toHaveLength(1);
      expect(out.asked.map((a) => a.card)).toEqual(ids(3));
    },
    TEST_TIMEOUT_MS,
  );
});

// =====================================================================================
describe('暫停(驗收 2、5)', () => {
  it(
    '--pause 不需要指標檔、不需要帳本身分:退出碼 0、印「今天已暫停」、快取標記 paused;reviews.json、weekly.json、log.jsonl 位元組完全不變',
    async () => {
      const v = vault({ cards: 4, vaultId: null });
      seedDue(v, ids(3), spread(3));
      const before = { reviews: fileBytes(reviewsPath(v)), weekly: fileBytes(join(v.dir, 'state/weekly.json')), log: logBytes(v) };
      const out = await runReview(v, { args: ['--pause'] });
      expect(out.status, out.output).toBe(0);
      expect(out.output).toMatch(/今天已暫停/);
      expect(out.asked).toEqual([]);
      const cache = readCache(v, TODAY, pathFolder(v)) as unknown as CacheShape;
      expect(cache.paused).toBe(true);
      expect(cache.date).toBe(TODAY);
      expect(fileBytes(reviewsPath(v))).toBe(before.reviews);
      expect(fileBytes(join(v.dir, 'state/weekly.json'))).toBe(before.weekly);
      expect(logBytes(v)).toBe(before.log);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '--pause 在快取已經存在時只把 paused 設成 true,題目集合(queue、reteach、total_due、deferred)原封不動',
    async () => {
      const v = dueVault(4);
      await runAndQuit(v);
      const before = readCache(v) as unknown as CacheShape;
      const out = await runReview(v, { args: ['--pause'] });
      expect(out.status, out.output).toBe(0);
      expect(readCache(v)).toEqual({ ...before, paused: true });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '暫停的那天直接再執行:在查帳本之前就擋下(沒有指標檔也是退出碼 0,不是 2)、說要加 --unpause、不問任何題目、reviews.json 不變',
    async () => {
      const v = vault({ cards: 4, vaultId: null });
      seedDue(v, ids(3), spread(3));
      await runReview(v, { args: ['--pause'] });
      const reviewsBefore = fileBytes(reviewsPath(v));
      const out = await runToEnd(v);
      expect(out.status, out.output).toBe(0);
      expect(out.output).toMatch(/今天已暫停/);
      expect(out.output).toMatch(/--unpause/);
      expect(out.asked).toEqual([]);
      expect(fileBytes(reviewsPath(v))).toBe(reviewsBefore);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '--pause 與 --unpause 同時給 → 用法錯誤(退出碼 1),不建快取',
    async () => {
      const v = dueVault(3);
      const out = await runReview(v, { args: ['--pause', '--unpause'] });
      expect(out.status, out.output).toBe(1);
      expect(out.output).toMatch(/用法/);
      expect(existsSync(cacheBase(v)), '用法錯誤不該建任何快取').toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '--unpause:印「已恢復今天的複習」、paused 設回 false、題目集合維持原來那份(暫停期間新到期的卡不加進來),接著照一般執行進入答題;一題都沒答就離開,快取仍是 paused:false',
    async () => {
      const v = dueVault(4);
      await runReview(v, { args: ['--pause'] });
      const original = (readCache(v) as unknown as CacheShape).queue.map((q) => q.card);
      expect(original).toEqual(ids(4));
      const reviews = readReviews(v);
      reviews['sec-0005'] = reviewRecord({ next_due: addDays(TODAY, -30) });
      writeReviews(v, reviews);

      const out = await runAndQuit(v, { args: ['--unpause'] });
      expect(out.output).toMatch(/已恢復今天的複習/);
      expect(out.asked.length, '--unpause 之後要進入答題').toBeGreaterThan(0);
      const after = readCache(v) as unknown as CacheShape;
      expect(after.paused).toBe(false);
      expect(after.queue.map((q) => q.card)).toEqual(original);

      const rest = await runToEnd(v);
      expect(rest.asked.map((a) => a.card)).toEqual(original);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '暫停只管當天:昨天暫停、今天再跑 → 不是暫停,照常重建並問題目',
    async () => {
      const v = dueVault(3);
      writeCacheFile(v, cacheOf({ date: YESTERDAY, paused: true }), YESTERDAY);
      const out = await runToEnd(v);
      expect(out.output).not.toMatch(/今天已暫停/);
      expect(out.asked.map((a) => a.card)).toEqual(ids(3));
      expect(existsSync(cachePath(v, YESTERDAY))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '檢查順序:磁碟上 0 張卡 → 「沒有卡片」退出碼 1,早於 --pause(不建快取);缺 --dir 的 --pause 是用法錯誤 1',
    async () => {
      const v = vault({ cards: 3 });
      // 把 cards/ 整個拿掉:這個 vault 一張卡也沒有
      rmSync(join(v.dir, 'cards'), { recursive: true, force: true });
      const pause = await runReview(v, { args: ['--pause'] });
      expect(pause.status, pause.output).toBe(1);
      expect(pause.output).toMatch(/沒有卡片/);
      expect(existsSync(cacheBase(v))).toBe(false);

      const w = dueVault(3);
      const usage = await runReview(w, { rawArgs: ['--today', TODAY, '--pause'] });
      expect(usage.status, usage.output).toBe(1);
      expect(usage.output).toMatch(/用法/);
    },
    TEST_TIMEOUT_MS,
  );
});

// =====================================================================================
describe('--dry-run 反映真實 session、永遠不寫(驗收 3)', () => {
  it(
    '今天沒有快取:跟 phase-1 一樣現算(第一行基數、逐張列出),不建任何快取,連資料夾都不建;不需要指標檔',
    async () => {
      const v = vault({ cards: 6, vaultId: null });
      seedDue(v, ids(3), spread(3));
      const treeBefore = treeBytes(v.dir);
      const out = await runReview(v, { args: ['--dry-run'] });
      expect(out.status, out.output).toBe(0);
      expect(out.stdout).toMatch(/掃描 6 張卡,3 張到期/);
      const order = ids(3).map((id) => out.stdout.indexOf(id));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(existsSync(v.xdgCache)).toBe(false);
      expect(existsSync(join(v.home, '.cache'))).toBe(false);
      expect(treeBytes(v.dir)).toEqual(treeBefore);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '已有快取(5 題答了 2 題):列出剩下 3 題、同順序,標題行說「已答 2 / 共 5」;快取內容與 mtime、reviews.json、log.jsonl 都不變',
    async () => {
      const v = dueVault(5);
      await runReview(v, { answers: 2 });
      const path = cachePath(v);
      const old = new Date('2020-01-01T00:00:00Z');
      utimesSync(path, old, old);
      const before = { cache: fileBytes(path), mtime: mtimeMs(path), reviews: fileBytes(reviewsPath(v)), log: logBytes(v) };

      const out = await runReview(v, { args: ['--dry-run'] });
      expect(out.status, out.output).toBe(0);
      expect(out.stdout).toMatch(/已答\s*2\s*\/\s*共\s*5/);
      const remaining = ids(5).slice(2);
      const pos = remaining.map((id) => out.stdout.indexOf(id));
      expect(pos.every((i) => i >= 0)).toBe(true);
      expect([...pos].sort((a, b) => a - b)).toEqual(pos);
      for (const answered of ids(5).slice(0, 2)) expect(out.stdout).not.toContain(answered);

      expect(fileBytes(path)).toBe(before.cache);
      expect(mtimeMs(path)).toBe(before.mtime);
      expect(fileBytes(reviewsPath(v))).toBe(before.reviews);
      expect(logBytes(v)).toBe(before.log);
      expect(sessionFiles(v)).toEqual([`session-${TODAY}.json`]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '快取壞掉:--dry-run 不重建、不寫 warning(它不寫任何東西),照現算列出,並說明快取無法讀取',
    async () => {
      const v = dueVault(3);
      const path = writeCacheFile(v, '{"version": 1, <<< broken');
      const old = new Date('2020-01-01T00:00:00Z');
      utimesSync(path, old, old);
      const before = { cache: fileBytes(path), mtime: mtimeMs(path), log: logBytes(v) };
      const out = await runReview(v, { args: ['--dry-run'] });
      expect(out.status, out.output).toBe(0);
      expect(out.output).toMatch(/快取/);
      for (const id of ids(3)) expect(out.stdout).toContain(id);
      expect(fileBytes(path)).toBe(before.cache);
      expect(mtimeMs(path)).toBe(before.mtime);
      expect(logBytes(v)).toBe(before.log);
      expect(warnings(v)).toEqual([]);
      expect(sessionFiles(v)).toEqual([`session-${TODAY}.json`]);
    },
    TEST_TIMEOUT_MS,
  );
});

// =====================================================================================
describe('結束時 snapshot(驗收 4,ADR-042)', () => {
  /** 目錄是 git repo,而且工作樹有「上次備份之後」的變動——該 snapshot 時真的有東西可以 commit。 */
  function repoVault(n: number): Vault {
    const v = dueVault(n);
    gitInit(v);
    const reviews = readReviews(v);
    reviews['sec-0006'] = reviewRecord({ stage: 3, next_due: addDays(TODAY, 21) });
    writeReviews(v, reviews);
    return v;
  }

  it(
    '答完一題以上:結束時剛好一個 commit(只有 state/ 底下的檔案,commit 訊息 snapshot <日期>),快取不在 learning/ 的 git 裡',
    async () => {
      const v = repoVault(3);
      const before = commitCount(v);
      const out = await runToEnd(v);
      expect(out.status, out.output).toBe(0);
      expect(commitCount(v)).toBe(before + 1);
      expect(headMessage(v)).toMatch(/^snapshot \d{4}-\d{2}-\d{2}$/);
      const files = headFiles(v);
      expect(files).toContain('state/reviews.json');
      expect(files.filter((f) => !f.startsWith('state/'))).toEqual([]);
      expect(trackedFiles(v).filter((f) => f.includes('session-'))).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '暫停日再跑、--pause、--dry-run、--unpause 之後一題都沒答就離開:都不 snapshot(工作樹的變動還在、HEAD 沒動)',
    async () => {
      const v = repoVault(3);
      const head = headSha(v);
      await runReview(v, { args: ['--dry-run'] });
      await runReview(v, { args: ['--pause'] });
      await runToEnd(v); // 暫停日直接再跑
      await runAndQuit(v, { args: ['--unpause'] });
      expect(headSha(v)).toBe(head);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '本次作答 0 題(名單全是已答):照樣印小結「Answered this run: 0.」,不 snapshot',
    async () => {
      const v = repoVault(3);
      await runToEnd(v);
      const afterFirst = commitCount(v);
      const reviews = readReviews(v);
      reviews['sec-0006'] = reviewRecord({ stage: 3, next_due: addDays(TODAY, 30) }); // 工作樹又有新的變動
      writeReviews(v, reviews);
      const head = headSha(v);
      const out = await runToEnd(v);
      expect(out.status, out.output).toBe(0);
      expect(out.asked).toEqual([]);
      expect(out.stdout).toMatch(/3 passed, 0 returned\./);
      expect(out.stdout).toMatch(/Answered this run: 0\./);
      expect(commitCount(v)).toBe(afterFirst);
      expect(headSha(v)).toBe(head);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '--unpause 之後答完 → 照一般結束,snapshot 一次',
    async () => {
      const v = repoVault(3);
      await runReview(v, { args: ['--pause'] });
      const before = commitCount(v);
      const out = await runToEnd(v, { args: ['--unpause'] });
      expect(out.stdout).toMatch(SUMMARY_LINE);
      expect(commitCount(v)).toBe(before + 1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'git 出錯(commit 被 hook 擋下)不影響複習:退出碼仍是 0、答案已落地、小結照印,之後有一行說明失敗(不丟錯)',
    async () => {
      const v = repoVault(3);
      installFailingPreCommit(v);
      const head = headSha(v);
      const out = await runToEnd(v);
      expect(out.status, out.output).toBe(0);
      expect(out.stdout).toMatch(SUMMARY_LINE);
      expect(headSha(v)).toBe(head);
      for (const id of ids(3)) expect(readReviews(v)[id]!.history).toHaveLength(1);
      const afterSummary = out.output.slice(out.output.search(SUMMARY_LINE));
      expect(afterSummary).toMatch(/snapshot|版本控制|git/i);
      expect(afterSummary).not.toMatch(/at .*\.ts:\d+/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '不是 git repo:退出碼不變(0),小結先印,之後提示「跑 cli.ts init 就會補上版本控制」;learning/ 底下不會多出 .git',
    async () => {
      const v = dueVault(3);
      const out = await runToEnd(v);
      expect(out.status, out.output).toBe(0);
      const afterSummary = out.output.slice(out.output.search(SUMMARY_LINE));
      expect(afterSummary).toMatch(/cli\.ts init/);
      expect(afterSummary).toMatch(/版本控制/);
      expect(existsSync(join(v.dir, '.git'))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});
