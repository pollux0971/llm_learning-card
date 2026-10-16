/**
 * T22 驗收 1:編排只有一份(`packages/core/src/session/engine.ts`)。
 * 紅測試作者寫;開發 worker 不改。CLI 的行為由既有的 review.test.ts / review-session.test.ts / review-router.test.ts 與 cucumber 守住(不改、全綠)。
 *
 * 這裡量 engine.ts 五個函式的行為(照 review.ts 現在 main 裡的分支逐一列),以及「scripts/review.ts 不再自己做編排」的靜態檢查。
 * 名字與簽名照工單驗收 1(`DayOpen` 型別、`openDay` / `pauseDay` / `unpauseDay` / `summarizeDay` / `snapshotAfterReview`)。
 * 模組還沒寫:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 *
 * 全部用暫存目錄(learning、XDG_CACHE_HOME、HOME 都在同一個 mkdtemp 底下;快取根經 `env` 參數傳進去,不碰 process.env);
 * 路由器是記帳用的假物件,**被呼叫就記一次**——openDay / pauseDay 都不該叫它(建 session 不評分)。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  TODAY,
  addDays,
  cachePath,
  commitCount,
  createVault,
  gitInit,
  installFailingPreCommit,
  ledgerEvents,
  readCache,
  readReviews,
  removeVault,
  reviewRecord,
  seedDue,
  writeReviews,
  type CacheShape,
  type Vault,
} from '../features/support/review-session-harness.js';

const ROOT = join(import.meta.dirname, '..');
const ENGINE = pathToFileURL(join(ROOT, 'packages/core/src/session/engine.ts')).href;

interface Cache extends CacheShape {}
interface Session { queue: { card: string }[]; reteachQueue: string[]; totalDue: number; deferred: number; today: string; learningDir: string; router: unknown; dailyCap: number }
type DayOpen = { kind: 'paused'; cache: Cache } | { kind: 'ready'; session: Session; cache: Cache; resumed: boolean };
interface Snapshot { status: 'committed' | 'no-changes' | 'skipped' | 'failed'; hint?: string }
interface Summary { passed: number; failed: number; errors: number; retryLater?: number; answeredThisRun?: number; tomorrow: { total: number; capped: boolean; shown: number; overflow: number } }
interface Engine {
  openDay(o: { learningDir: string; today: string; router: unknown; env?: NodeJS.ProcessEnv }): Promise<DayOpen>;
  pauseDay(o: { learningDir: string; today: string; env?: NodeJS.ProcessEnv }): Promise<void>;
  unpauseDay(o: { learningDir: string; today: string; env?: NodeJS.ProcessEnv }): Cache | undefined;
  summarizeDay(o: { learningDir: string; today: string; cache: Cache; dailyCap: number; answeredThisRun: number; resumed: boolean; env?: NodeJS.ProcessEnv }): Summary;
  snapshotAfterReview(o: { learningDir: string; today: string; answeredThisRun: number }): Snapshot;
}
async function engine(): Promise<Engine> {
  return (await import(/* @vite-ignore */ ENGINE)) as Engine;
}

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `sec-${String(1 + i).padStart(4, '0')}`);
/** 逾期天數由大到小:sec-0001 在最前面(04 的排序固定) */
const spread = (n: number): number[] => Array.from({ length: n }, (_, i) => n + 2 - i);
function dueVault(n: number): Vault {
  const v = createVault({ cards: Math.max(n, 6) });
  vaults.push(v);
  seedDue(v, ids(n), spread(n));
  return v;
}
const envOf = (v: Vault): NodeJS.ProcessEnv => ({ ...process.env, HOME: v.home, XDG_CACHE_HOME: v.xdgCache, XDG_CONFIG_HOME: v.xdgConfig });
/** 被呼叫就記一次;openDay / pauseDay 都不該叫它 */
function countingRouter(): { calls: number; call(): Promise<never>; probeOnline(): Promise<never>; probeLocal(): Promise<never> } {
  const r = {
    calls: 0,
    async call(): Promise<never> {
      r.calls += 1;
      throw new Error('建 session / 暫停不該呼叫 router');
    },
    async probeOnline(): Promise<never> {
      r.calls += 1;
      throw new Error('不該呼叫');
    },
    async probeLocal(): Promise<never> {
      r.calls += 1;
      throw new Error('不該呼叫');
    },
  };
  return r;
}
function writeCache(v: Vault, over: Partial<Cache> = {}, raw?: string): string {
  const queue = over.queue ?? ids(3).map((card, i) => ({ card, stage: 1, overdue_days: 3 - i, overdue_ratio: 3 - i }));
  const cache: Cache = { version: 1, date: TODAY, paused: false, total_due: queue.length, deferred: 0, queue, reteach: [], ...over };
  const path = cachePath(v, TODAY);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, raw ?? `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return path;
}
const warnings = (v: Vault): Record<string, unknown>[] => ledgerEvents(v).filter((e) => e.type === 'warning' && e.reason === 'session-cache-invalid');
const queueCards = (c: Cache): string[] => c.queue.map((q) => q.card);

describe('openDay:讀或建當日快取(驗收 1)', () => {
  it('沒有快取:建 session、寫快取;queue 是 04 排出來的到期清單,resumed false,router 原樣放進去、一次都沒叫', async () => {
    const v = dueVault(4);
    const router = countingRouter();
    const out = await (await engine()).openDay({ learningDir: v.dir, today: TODAY, router, env: envOf(v) });
    expect(out.kind).toBe('ready');
    if (out.kind !== 'ready') return;
    expect(out.resumed).toBe(false);
    expect(out.session.queue.map((q) => q.card)).toEqual(ids(4));
    expect(out.session.totalDue).toBe(4);
    expect(out.session.today).toBe(TODAY);
    expect(out.session.learningDir).toBe(v.dir);
    expect(out.session.router).toBe(router);
    expect(router.calls).toBe(0);
    const onDisk = readCache(v, TODAY) as unknown as Cache;
    expect(onDisk).toEqual(out.cache);
    expect(queueCards(onDisk)).toEqual(ids(4));
    expect(onDisk.paused).toBe(false);
    expect(onDisk.total_due).toBe(4);
  });

  it('沒有快取:reviews.json 逐位元不變(建 session 不寫帳)', async () => {
    const v = dueVault(3);
    const before = readFileSync(join(v.dir, 'state/reviews.json'), 'utf8');
    await (await engine()).openDay({ learningDir: v.dir, today: TODAY, router: countingRouter(), env: envOf(v) });
    expect(readFileSync(join(v.dir, 'state/reviews.json'), 'utf8')).toBe(before);
  });

  it('快取在 env 指的 XDG_CACHE_HOME 底下,不在 process.env 的', async () => {
    const v = dueVault(3);
    await (await engine()).openDay({ learningDir: v.dir, today: TODAY, router: countingRouter(), env: envOf(v) });
    expect(existsSync(cachePath(v, TODAY))).toBe(true);
  });

  it('同一天已經有快取:續答——用快取裡那一份的順序(不重算),resumed true,快取檔逐位元不變', async () => {
    const v = dueVault(4);
    const path = writeCache(v, {
      queue: [
        { card: 'sec-0003', stage: 1, overdue_days: 1, overdue_ratio: 1 },
        { card: 'sec-0001', stage: 1, overdue_days: 3, overdue_ratio: 3 },
      ],
      total_due: 2,
      deferred: 5,
    });
    const before = readFileSync(path, 'utf8');
    const out = await (await engine()).openDay({ learningDir: v.dir, today: TODAY, router: countingRouter(), env: envOf(v) });
    expect(out.kind).toBe('ready');
    if (out.kind !== 'ready') return;
    expect(out.resumed).toBe(true);
    expect(out.session.queue.map((q) => q.card), '照快取的順序,不是 04 現在算出來的').toEqual(['sec-0003', 'sec-0001']);
    expect(out.session.totalDue, '分母是快取的 total_due').toBe(2);
    expect(out.session.deferred).toBe(5);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('續答:今天已經答過的卡(reviews.json 有 date 等於今天的 history)從 queue 剃掉,分母不變', async () => {
    const v = dueVault(3);
    writeCache(v);
    const reviews = readReviews(v);
    reviews['sec-0001'] = reviewRecord({ stage: 2, next_due: addDays(TODAY, 2), history: [{ date: TODAY, stage: 1, type: 'fill', pass: true, grader: 'exact' }] });
    writeReviews(v, reviews);
    const out = await (await engine()).openDay({ learningDir: v.dir, today: TODAY, router: countingRouter(), env: envOf(v) });
    if (out.kind !== 'ready') throw new Error('應該是 ready');
    expect(out.session.queue.map((q) => q.card)).toEqual(['sec-0002', 'sec-0003']);
    expect(out.session.totalDue).toBe(3);
  });

  it('續答:reteach 佇列照快取', async () => {
    const v = dueVault(3);
    writeCache(v, { reteach: ['sec-0002'] });
    const out = await (await engine()).openDay({ learningDir: v.dir, today: TODAY, router: countingRouter(), env: envOf(v) });
    if (out.kind !== 'ready') throw new Error('應該是 ready');
    expect(out.session.reteachQueue).toEqual(['sec-0002']);
  });

  it('今天暫停:回 paused 與快取,什麼都不建、快取逐位元不變、router 不叫', async () => {
    const v = dueVault(3);
    const path = writeCache(v, { paused: true });
    const before = readFileSync(path, 'utf8');
    const router = countingRouter();
    const out = await (await engine()).openDay({ learningDir: v.dir, today: TODAY, router, env: envOf(v) });
    expect(out.kind).toBe('paused');
    if (out.kind === 'paused') expect(out.cache.paused).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(router.calls).toBe(0);
  });

  it('壞快取(不是 JSON):記一筆 warning(只有檔名)、丟掉重建、resumed false', async () => {
    const v = dueVault(3);
    writeCache(v, {}, '這不是 JSON');
    const out = await (await engine()).openDay({ learningDir: v.dir, today: TODAY, router: countingRouter(), env: envOf(v) });
    expect(out.kind).toBe('ready');
    if (out.kind !== 'ready') return;
    expect(out.resumed).toBe(false);
    const w = warnings(v);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`session-${TODAY}.json`);
    expect(JSON.stringify(w[0])).not.toContain(v.dir);
    const rebuilt = readCache(v, TODAY) as unknown as Cache;
    expect(queueCards(rebuilt)).toEqual(ids(3));
  });

  it('壞快取(多一個欄位,strictObject):同樣記 warning、重建', async () => {
    const v = dueVault(3);
    writeCache(v, {}, JSON.stringify({ version: 1, date: TODAY, paused: false, total_due: 0, deferred: 0, queue: [], reteach: [], extra: 1 }));
    const out = await (await engine()).openDay({ learningDir: v.dir, today: TODAY, router: countingRouter(), env: envOf(v) });
    expect(out.kind).toBe('ready');
    expect(warnings(v)).toHaveLength(1);
  });

  it('日期對不上(檔名是今天、內容 date 是昨天 = stale):重建,不記 warning', async () => {
    const v = dueVault(3);
    writeCache(v, { date: addDays(TODAY, -1) });
    const out = await (await engine()).openDay({ learningDir: v.dir, today: TODAY, router: countingRouter(), env: envOf(v) });
    expect(out.kind).toBe('ready');
    if (out.kind === 'ready') expect(out.resumed).toBe(false);
    expect(warnings(v)).toHaveLength(0);
    expect((readCache(v, TODAY) as unknown as Cache).date).toBe(TODAY);
  });

  it('今天沒有到期:ready、queue 空、totalDue 0,快取照樣寫(handler 才決定叫它 empty)', async () => {
    const v = createVault({ cards: 3 });
    vaults.push(v);
    const out = await (await engine()).openDay({ learningDir: v.dir, today: TODAY, router: countingRouter(), env: envOf(v) });
    expect(out.kind).toBe('ready');
    if (out.kind !== 'ready') return;
    expect(out.session.queue).toEqual([]);
    expect(out.session.totalDue).toBe(0);
    expect(existsSync(cachePath(v, TODAY))).toBe(true);
  });
});

describe('pauseDay / unpauseDay(驗收 1)', () => {
  it('pauseDay 有快取:只把 paused 改 true,其他欄位原樣;不用 router', async () => {
    const v = dueVault(3);
    writeCache(v, { deferred: 2, reteach: ['sec-0002'] });
    await (await engine()).pauseDay({ learningDir: v.dir, today: TODAY, env: envOf(v) });
    const after = readCache(v, TODAY) as unknown as Cache;
    expect(after.paused).toBe(true);
    expect({ ...after, paused: false }).toEqual({ version: 1, date: TODAY, paused: false, total_due: 3, deferred: 2, queue: queueOf3(), reteach: ['sec-0002'] });
  });

  it('pauseDay 沒有快取:用不評分的 router 建一份 paused 的快取(裡面是現在的到期清單)', async () => {
    const v = dueVault(3);
    await (await engine()).pauseDay({ learningDir: v.dir, today: TODAY, env: envOf(v) });
    const after = readCache(v, TODAY) as unknown as Cache;
    expect(after.paused).toBe(true);
    expect(queueCards(after)).toEqual(ids(3));
    expect(after.total_due).toBe(3);
  });

  it('pauseDay 壞快取:先記 warning、再建 paused 的快取', async () => {
    const v = dueVault(3);
    writeCache(v, {}, '壞掉');
    await (await engine()).pauseDay({ learningDir: v.dir, today: TODAY, env: envOf(v) });
    expect(warnings(v)).toHaveLength(1);
    expect((readCache(v, TODAY) as unknown as Cache).paused).toBe(true);
  });

  it('pauseDay 連呼兩次:結果一樣(冪等)', async () => {
    const v = dueVault(3);
    const e = await engine();
    await e.pauseDay({ learningDir: v.dir, today: TODAY, env: envOf(v) });
    const first = readFileSync(cachePath(v, TODAY), 'utf8');
    await e.pauseDay({ learningDir: v.dir, today: TODAY, env: envOf(v) });
    expect(readFileSync(cachePath(v, TODAY), 'utf8')).toBe(first);
  });

  it('pauseDay 之後 openDay 回 paused;unpauseDay 之後 openDay 回 ready 並續答', async () => {
    const v = dueVault(3);
    const e = await engine();
    await e.pauseDay({ learningDir: v.dir, today: TODAY, env: envOf(v) });
    expect((await e.openDay({ learningDir: v.dir, today: TODAY, router: countingRouter(), env: envOf(v) })).kind).toBe('paused');
    const back = e.unpauseDay({ learningDir: v.dir, today: TODAY, env: envOf(v) });
    expect(back?.paused).toBe(false);
    const out = await e.openDay({ learningDir: v.dir, today: TODAY, router: countingRouter(), env: envOf(v) });
    expect(out.kind).toBe('ready');
    if (out.kind === 'ready') expect(out.resumed).toBe(true);
  });

  it('unpauseDay 有快取:paused 改 false 寫回,回傳新的快取', async () => {
    const v = dueVault(3);
    writeCache(v, { paused: true });
    const got = (await engine()).unpauseDay({ learningDir: v.dir, today: TODAY, env: envOf(v) });
    expect(got).toBeDefined();
    expect(got!.paused).toBe(false);
    expect(readCache(v, TODAY)).toEqual(got);
  });

  it('unpauseDay 沒有快取:回 undefined,不建任何檔', async () => {
    const v = dueVault(3);
    expect((await engine()).unpauseDay({ learningDir: v.dir, today: TODAY, env: envOf(v) })).toBeUndefined();
    expect(existsSync(cachePath(v, TODAY))).toBe(false);
  });

  it('unpauseDay 壞快取:回 undefined、不動壞檔、自己不記 warning(openDay 重建時才記)', async () => {
    const v = dueVault(3);
    const path = writeCache(v, {}, '壞掉');
    expect((await engine()).unpauseDay({ learningDir: v.dir, today: TODAY, env: envOf(v) })).toBeUndefined();
    expect(readFileSync(path, 'utf8')).toBe('壞掉');
    expect(warnings(v)).toHaveLength(0);
  });
});
function queueOf3(): Cache['queue'] {
  return ids(3).map((card, i) => ({ card, stage: 1, overdue_days: 3 - i, overdue_ratio: 3 - i }));
}

describe('summarizeDay:小結的數字(驗收 1,算法跟現在 review.ts 相同)', () => {
  const tomorrow = addDays(TODAY, 1);
  /** sec-0001 與 sec-0006 今天過了、sec-0002 今天錯了(回 stage 1,明天到期)、sec-0003 還沒答;sec-0004 本來就明天到期、sec-0005 很久以後 */
  function summaryVault(): Vault {
    const v = createVault({ cards: 6 });
    vaults.push(v);
    writeReviews(v, {
      'sec-0001': reviewRecord({ stage: 2, next_due: addDays(TODAY, 2), history: [{ date: TODAY, stage: 1, type: 'fill', pass: true, grader: 'exact' }] }),
      'sec-0002': reviewRecord({ stage: 1, next_due: tomorrow, fails_in_row: 1, total_fails: 1, history: [{ date: TODAY, stage: 1, type: 'fill', pass: false, grader: 'exact' }] }),
      'sec-0003': reviewRecord({ stage: 1, next_due: addDays(TODAY, -1) }),
      'sec-0006': reviewRecord({ stage: 2, next_due: addDays(TODAY, 2), history: [{ date: TODAY, stage: 1, type: 'fill', pass: true, grader: 'exact' }] }),
      'sec-0004': reviewRecord({ stage: 2, next_due: tomorrow }),
      'sec-0005': reviewRecord({ stage: 3, next_due: addDays(TODAY, 20) }),
    });
    return v;
  }
  const cache = (): Cache => ({ version: 1, date: TODAY, paused: false, total_due: 4, deferred: 0, queue: [...ids(3), 'sec-0006'].map((card) => ({ card, stage: 1, overdue_days: 1, overdue_ratio: 1 })), reteach: [] });

  it('passed / returned / retryLater 來自今天的 history;明天估計 = 本來就明天到期的 + 今天回退的', async () => {
    const v = summaryVault();
    const got = (await engine()).summarizeDay({ learningDir: v.dir, today: TODAY, cache: cache(), dailyCap: 10, answeredThisRun: 2, resumed: false });
    expect(got.passed).toBe(2);
    expect(got.failed, 'failed 欄位放的是 returned(回退的張數;跟 passed 不同數字才量得出有沒有放反)').toBe(1);
    expect(got.errors).toBe(0);
    expect(got.retryLater).toBe(1);
    // 明天(含)以前到期的:sec-0002(今天回退)、sec-0003(逾期還沒答)、sec-0004 共 3 張;扣掉回退的 1 張得 2,再加回退的 1 張 = 3
    expect(got.tomorrow).toEqual({ total: 3, capped: false, shown: 3, overflow: 0 });
  });

  it('明天估計套 dailyCap:超過上限時 capped、shown 是上限、overflow 是超出的', async () => {
    const v = summaryVault();
    const got = (await engine()).summarizeDay({ learningDir: v.dir, today: TODAY, cache: cache(), dailyCap: 1, answeredThisRun: 2, resumed: false });
    expect(got.tomorrow).toEqual({ total: 3, capped: true, shown: 1, overflow: 2 });
  });

  it('answeredThisRun 只在續答(resumed)時帶,而且 0 也帶;沒續答時整個鍵不存在', async () => {
    const v = summaryVault();
    const e = await engine();
    const fresh = e.summarizeDay({ learningDir: v.dir, today: TODAY, cache: cache(), dailyCap: 10, answeredThisRun: 2, resumed: false });
    expect('answeredThisRun' in fresh).toBe(false);
    const resumed = e.summarizeDay({ learningDir: v.dir, today: TODAY, cache: cache(), dailyCap: 10, answeredThisRun: 2, resumed: true });
    expect(resumed.answeredThisRun).toBe(2);
    const zero = e.summarizeDay({ learningDir: v.dir, today: TODAY, cache: cache(), dailyCap: 10, answeredThisRun: 0, resumed: true });
    expect(zero.answeredThisRun).toBe(0);
  });

  it('只看快取名單裡的卡:名單外的卡今天的 history 不算', async () => {
    const v = summaryVault();
    const only = cache();
    only.queue = only.queue.filter((q) => q.card === 'sec-0003');
    const got = (await engine()).summarizeDay({ learningDir: v.dir, today: TODAY, cache: only, dailyCap: 10, answeredThisRun: 0, resumed: false });
    expect(got.passed).toBe(0);
    expect(got.failed).toBe(0);
    expect(got.retryLater).toBe(1);
  });
});

describe('snapshotAfterReview:這一次有答題才 snapshot,失敗不丟錯(驗收 1)', () => {
  function gitVault(): Vault {
    const v = dueVault(3);
    gitInit(v);
    return v;
  }
  function touchReviews(v: Vault): void {
    const reviews = readReviews(v);
    reviews['sec-0001'] = reviewRecord({ stage: 2, next_due: addDays(TODAY, 2) });
    writeReviews(v, reviews);
  }

  it('這一次沒答題(0):skipped,而且不 commit(就算有變更)', async () => {
    const v = gitVault();
    touchReviews(v);
    const before = commitCount(v);
    const got = (await engine()).snapshotAfterReview({ learningDir: v.dir, today: TODAY, answeredThisRun: 0 });
    expect(got.status).toBe('skipped');
    expect(commitCount(v)).toBe(before);
  });

  it('有答題且有變更:committed,多一個 commit', async () => {
    const v = gitVault();
    touchReviews(v);
    const before = commitCount(v);
    const got = (await engine()).snapshotAfterReview({ learningDir: v.dir, today: TODAY, answeredThisRun: 1 });
    expect(got.status).toBe('committed');
    expect(commitCount(v)).toBe(before + 1);
  });

  it('有答題但沒有變更:no-changes,不多 commit', async () => {
    const v = gitVault();
    const before = commitCount(v);
    const got = (await engine()).snapshotAfterReview({ learningDir: v.dir, today: TODAY, answeredThisRun: 2 });
    expect(got.status).toBe('no-changes');
    expect(commitCount(v)).toBe(before);
  });

  it('不是 git repo:failed,hint 指到 cli.ts init;不丟錯', async () => {
    const v = dueVault(3);
    const got = (await engine()).snapshotAfterReview({ learningDir: v.dir, today: TODAY, answeredThisRun: 1 });
    expect(got.status).toBe('failed');
    expect(got.hint).toContain('cli.ts init');
  });

  it('git 出錯(commit 一律失敗的 hook):failed,不丟錯', async () => {
    const v = gitVault();
    touchReviews(v);
    installFailingPreCommit(v);
    const got = (await engine()).snapshotAfterReview({ learningDir: v.dir, today: TODAY, answeredThisRun: 1 });
    expect(got.status).toBe('failed');
  });
});

describe('靜態:編排只有一份(驗收 1)', () => {
  const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
  /** 拿掉註解與字串之外的呼叫才算(註解可以提到這些名字) */
  const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const calls = (text: string, name: string): number => [...text.matchAll(new RegExp(`(?<!function\\s)(?<![.\\w])${name}\\s*\\(`, 'g'))].length;

  it('scripts/review.ts 不再直接呼叫 writeSessionCache、tallyToday、estimateTomorrow、snapshotLearningDir、buildAndStore、sessionFromCache', () => {
    const review = code('scripts/review.ts');
    for (const name of ['writeSessionCache', 'tallyToday', 'estimateTomorrow', 'snapshotLearningDir', 'buildAndStore', 'sessionFromCache', 'cacheFromSession', 'snapshotQuietly', 'warnInvalidSessionCache']) {
      expect(calls(review, name), `${name}( 還在 scripts/review.ts 裡被呼叫`).toBe(0);
    }
  });

  it('唯讀的路徑可以留 readSessionCache 與 buildTodaySession,寫的與建 session 的不行:buildTodaySession 只剩 --dry-run 那一處;readSessionCache 最多兩處(--dry-run、以及「暫停日不需要帳本」要在查帳本之前先看一眼)', () => {
    const review = code('scripts/review.ts');
    expect(calls(review, 'buildTodaySession')).toBeLessThanOrEqual(1);
    expect(calls(review, 'readSessionCache')).toBeLessThanOrEqual(2);
  });

  it('scripts/review.ts 改成呼叫 engine 的函式', () => {
    const review = code('scripts/review.ts');
    expect(review).toMatch(/session\/engine\.js/);
    for (const name of ['openDay', 'pauseDay', 'unpauseDay', 'summarizeDay', 'snapshotAfterReview']) {
      expect(calls(review, name), `${name}( 沒有被呼叫`).toBeGreaterThanOrEqual(1);
    }
  });

  it('engine.ts 匯出工單的五個函式與 DayOpen 型別', () => {
    const text = read('packages/core/src/session/engine.ts');
    for (const name of ['openDay', 'pauseDay', 'unpauseDay', 'summarizeDay', 'snapshotAfterReview']) {
      expect(text, name).toMatch(new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`));
    }
    expect(text).toMatch(/export\s+type\s+DayOpen\b/);
  });

  it('engine.ts 與 handler.ts 不寫 stdout(側車的 stdout 只准協定行):沒有 console.log / info / debug / warn、process.stdout', () => {
    for (const rel of ['packages/core/src/session/engine.ts', 'packages/core/src/session/handler.ts']) {
      const text = code(rel);
      expect(text, rel).not.toMatch(/console\s*\.\s*(log|info|debug|warn)\b/);
      expect(text, rel).not.toMatch(/process\s*\.\s*stdout/);
      expect(text, rel).not.toMatch(/\bprocess\s*\.\s*exit\b/);
    }
  });

  it('量尺自測:計數抓得到呼叫,不算定義與註解', () => {
    expect(calls('function buildAndStore(a) {}\nbuildAndStore(x);', 'buildAndStore')).toBe(1);
    expect(calls('const r = tallyToday(a);', 'tallyToday')).toBe(1);
    expect(calls('x.tallyToday(a);', 'tallyToday')).toBe(0);
  });
});
