/**
 * T17 驗收補測(驗收者寫):session/cache.ts 與 build.ts、summary.ts 新函式的「程序內」單元層。
 *
 * 為什麼要有:紅測試(scripts/review-session.test.ts)跑真的 review.ts 子程序,一條約 2–3 秒,
 * 不能拿去跑 Stryker(每個變異都要重跑整包);而工單要求 session 邊界邏輯(快取讀寫、已答判定、跨日、暫停、
 * 小結算式)變異門檻 80%。這裡把同樣的邊界直接對函式斷言,讓變異測試能在秒級跑完。
 * 全部用暫存目錄與明確傳入的 env,不動 process.env、不碰真的 ~/.cache 與真的 learning/。
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { Review } from '@contracts/index.js';
import {
  readSessionCache,
  sessionCacheFile,
  sessionCacheFilename,
  sessionCacheFolder,
  sessionCacheHome,
  toSessionCache,
  warnInvalidSessionCache,
  writeSessionCache,
  type SessionCache,
} from './cache.js';
import { dropAnsweredToday, dueItemsFromCache } from './build.js';
import { renderSummary, tallyToday } from './summary.js';

const roots: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'lc-t17u-'));
  roots.push(d);
  return d;
}
afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

const UUID = '3f2b8c1e-5d4a-4b6f-9a7c-0e1d2c3b4a59';
const TODAY = '2026-09-10';

function sample(over: Partial<SessionCache> = {}): SessionCache {
  return {
    version: 1,
    date: TODAY,
    paused: false,
    total_due: 2,
    deferred: 1,
    queue: [
      { card: 'sec-0001', stage: 1, overdue_days: 2, overdue_ratio: 2 },
      { card: 'sec-0002', stage: 3, overdue_days: 0, overdue_ratio: 0 },
    ],
    reteach: ['sec-0001'],
    ...over,
  };
}

function vault(marker?: string | null): { dir: string; cache: string; env: NodeJS.ProcessEnv } {
  const dir = join(tmp(), 'learning');
  mkdirSync(join(dir, 'config'), { recursive: true });
  mkdirSync(join(dir, 'state'), { recursive: true });
  if (marker !== null) writeFileSync(join(dir, 'config/vault-id'), marker ?? `${UUID}\n`, 'utf8');
  const cache = join(tmp(), 'cache');
  return { dir, cache, env: { XDG_CACHE_HOME: cache, HOME: join(tmp(), 'home') } };
}

describe('sessionCacheHome', () => {
  it('XDG_CACHE_HOME 有值就用它', () => {
    expect(sessionCacheHome({ XDG_CACHE_HOME: '/x/cache', HOME: '/h' })).toBe('/x/cache');
  });
  it('空字串視同未設 → $HOME/.cache', () => {
    expect(sessionCacheHome({ XDG_CACHE_HOME: '', HOME: '/h' })).toBe(join('/h', '.cache'));
  });
  it('沒設 → $HOME/.cache', () => {
    expect(sessionCacheHome({ HOME: '/h' })).toBe(join('/h', '.cache'));
  });
  it('HOME 空字串或沒設 → 作業系統的家目錄(不是相對路徑)', () => {
    expect(sessionCacheHome({ XDG_CACHE_HOME: '', HOME: '' })).toBe(join(homedir(), '.cache'));
    expect(sessionCacheHome({})).toBe(join(homedir(), '.cache'));
  });
});

describe('sessionCacheFolder', () => {
  const pathName = (dir: string): string => `path-${createHash('sha256').update(dir).digest('hex').slice(0, 16)}`;

  it('合法 vault-id(含一個結尾換行或沒有換行)就用它', () => {
    expect(sessionCacheFolder(vault(`${UUID}\n`).dir)).toBe(UUID);
    expect(sessionCacheFolder(vault(UUID).dir)).toBe(UUID);
  });
  it('格式不對(多餘空白、\\r、不是 uuid、含路徑跳脫)走 path-<16 hex>,不把亂字串當資料夾名', () => {
    for (const bad of [`${UUID}\r\n`, ` ${UUID}\n`, `${UUID}\n\n`, '../../escape\n', 'not-a-uuid\n', '']) {
      const v = vault(bad);
      expect(sessionCacheFolder(v.dir), JSON.stringify(bad)).toBe(pathName(v.dir));
    }
  });
  it('沒有標記檔、或標記檔是個目錄(讀不到)→ path-<16 hex>', () => {
    const none = vault(null);
    expect(sessionCacheFolder(none.dir)).toBe(pathName(none.dir));
    const dirMarker = vault(null);
    mkdirSync(join(dirMarker.dir, 'config/vault-id'));
    expect(sessionCacheFolder(dirMarker.dir)).toBe(pathName(dirMarker.dir));
  });
  it('雜湊用的是真實路徑:symlink 與真實目錄得到同一個資料夾', () => {
    const v = vault(null);
    const link = join(tmp(), 'link');
    symlinkSync(v.dir, link);
    expect(sessionCacheFolder(link)).toBe(sessionCacheFolder(v.dir));
    expect(sessionCacheFolder(link)).toMatch(/^path-[0-9a-f]{16}$/);
  });
  it('目錄不存在也不丟錯(用給的路徑本身算)', () => {
    const ghost = join(tmp(), 'ghost');
    expect(sessionCacheFolder(ghost)).toBe(pathName(ghost));
  });
  it('不同目錄 → 不同資料夾', () => {
    expect(sessionCacheFolder(vault(null).dir)).not.toBe(sessionCacheFolder(vault(null).dir));
  });
});

describe('sessionCacheFile / sessionCacheFilename', () => {
  it('<快取根>/llm-learning-cards/<資料夾>/session-<日期>.json', () => {
    const v = vault();
    expect(sessionCacheFile(v.dir, TODAY, v.env)).toBe(join(v.cache, 'llm-learning-cards', UUID, `session-${TODAY}.json`));
    expect(sessionCacheFilename(TODAY)).toBe(`session-${TODAY}.json`);
  });
});

describe('readSessionCache', () => {
  function put(v: ReturnType<typeof vault>, content: string, date = TODAY): string {
    const path = sessionCacheFile(v.dir, date, v.env);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
    return path;
  }
  it('沒有檔 → missing(而且不建任何目錄)', () => {
    const v = vault();
    expect(readSessionCache(v.dir, TODAY, v.env)).toEqual({ kind: 'missing' });
    expect(existsSync(v.cache)).toBe(false);
  });
  it('合法 → ok,內容原樣', () => {
    const v = vault();
    put(v, JSON.stringify(sample()));
    expect(readSessionCache(v.dir, TODAY, v.env)).toEqual({ kind: 'ok', cache: sample() });
  });
  it('檔案裡的 date 不是今天 → stale(帶回內容)', () => {
    const v = vault();
    put(v, JSON.stringify(sample({ date: '2026-09-09' })));
    expect(readSessionCache(v.dir, TODAY, v.env)).toEqual({ kind: 'stale', cache: sample({ date: '2026-09-09' }) });
  });
  it('不是 JSON、空檔、schema 不過 → invalid', () => {
    for (const bad of ['{', '', '[]', JSON.stringify({ ...sample(), version: 2 }), JSON.stringify({ ...sample(), paused: 'x' })]) {
      const v = vault();
      put(v, bad);
      expect(readSessionCache(v.dir, TODAY, v.env), JSON.stringify(bad)).toEqual({ kind: 'invalid' });
    }
  });
  it('date 欄位的格式要整串是 YYYY-MM-DD(前後多一個字元就是壞的)', () => {
    for (const bad of ['x2026-09-10', '2026-09-10x', '2026-09-10\n', ' 2026-09-10']) {
      const v = vault();
      put(v, JSON.stringify(sample({ date: bad })));
      expect(readSessionCache(v.dir, TODAY, v.env), JSON.stringify(bad)).toEqual({ kind: 'invalid' });
    }
  });
  it('路徑是目錄(EISDIR)→ invalid,不是 missing', () => {
    const v = vault();
    mkdirSync(sessionCacheFile(v.dir, TODAY, v.env), { recursive: true });
    expect(readSessionCache(v.dir, TODAY, v.env)).toEqual({ kind: 'invalid' });
  });
  it.skipIf(process.getuid?.() === 0)('沒有讀取權限 → invalid', () => {
    const v = vault();
    chmodSync(put(v, JSON.stringify(sample())), 0o000);
    expect(readSessionCache(v.dir, TODAY, v.env)).toEqual({ kind: 'invalid' });
  });
});

describe('writeSessionCache', () => {
  it('建目錄、內容是兩格縮排 JSON 加結尾換行、資料夾裡沒有暫存檔', () => {
    const v = vault();
    writeSessionCache(v.dir, sample(), v.env);
    const path = sessionCacheFile(v.dir, TODAY, v.env);
    expect(readFileSync(path, 'utf8')).toBe(`${JSON.stringify(sample(), null, 2)}\n`);
    expect(readdirSync(join(path, '..'))).toEqual([`session-${TODAY}.json`]);
  });
  it('刪掉同一個帳本資料夾裡其他日期的 session-*.json,留下今天的、非 session 開頭或非 .json 的檔案與別本帳本的資料夾', () => {
    const v = vault();
    const folder = join(v.cache, 'llm-learning-cards', UUID);
    mkdirSync(folder, { recursive: true });
    for (const n of ['session-2026-09-09.json', 'session-2026-09-01.json']) writeFileSync(join(folder, n), '{}', 'utf8');
    for (const n of ['notes.json', 'session-2026-09-09.txt', 'xsession-2026-09-09.json']) writeFileSync(join(folder, n), 'keep', 'utf8');
    const other = join(v.cache, 'llm-learning-cards', 'other-vault');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'session-2026-09-01.json'), '{}', 'utf8');
    writeSessionCache(v.dir, sample(), v.env);
    expect(readdirSync(folder).sort()).toEqual(['notes.json', 'session-2026-09-09.txt', `session-${TODAY}.json`, 'xsession-2026-09-09.json'].sort());
    expect(readdirSync(other)).toEqual(['session-2026-09-01.json']);
  });
  it('再寫一次(例如 --pause 改 paused)覆蓋同一個檔', () => {
    const v = vault();
    writeSessionCache(v.dir, sample(), v.env);
    writeSessionCache(v.dir, sample({ paused: true }), v.env);
    expect(readSessionCache(v.dir, TODAY, v.env)).toEqual({ kind: 'ok', cache: sample({ paused: true }) });
  });
});

describe('warnInvalidSessionCache', () => {
  it('追加一筆 warning:reason、只有檔名的 path、ISO 時間;state/ 不存在也會建;不新增欄位', () => {
    const v = vault();
    rmSync(join(v.dir, 'state'), { recursive: true, force: true });
    warnInvalidSessionCache(v.dir, TODAY);
    warnInvalidSessionCache(v.dir, TODAY);
    const lines = readFileSync(join(v.dir, 'state/log.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const event = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(Object.keys(event).sort()).toEqual(['path', 'reason', 'ts', 'type']);
    expect(event.type).toBe('warning');
    expect(event.reason).toBe('session-cache-invalid');
    expect(event.path).toBe(`session-${TODAY}.json`);
    expect(new Date(event.ts as string).toISOString()).toBe(event.ts);
  });
});

describe('toSessionCache', () => {
  it('只留 DueItem 的四個欄位,不存 learned_at / 答案 / 分數;reteach 是拷貝', () => {
    const reteach = ['sec-0001'];
    const out = toSessionCache({
      date: TODAY,
      paused: true,
      totalDue: 5,
      deferred: 2,
      queue: [{ card: 'sec-0001', stage: 2, overdue_days: 1, overdue_ratio: 0.5, learned_at: '2026-08-01', passed: true } as never],
      reteach,
    });
    expect(out).toEqual({
      version: 1,
      date: TODAY,
      paused: true,
      total_due: 5,
      deferred: 2,
      queue: [{ card: 'sec-0001', stage: 2, overdue_days: 1, overdue_ratio: 0.5 }],
      reteach: ['sec-0001'],
    });
    reteach.push('mutated');
    expect(out.reteach).toEqual(['sec-0001']);
  });
});

function review(over: Partial<Review> = {}): Review {
  return { stage: 1, learned_at: '2026-08-01', next_due: TODAY, fails_in_row: 0, total_fails: 0, stuck: false, history: [], ...over } as Review;
}
const entry = (date: string, pass: boolean, extra: Record<string, unknown> = {}): Review['history'][number] =>
  ({ date, stage: 1, type: 'fill', pass, grader: 'exact', ...extra }) as Review['history'][number];

describe('dueItemsFromCache', () => {
  const queue = [
    { card: 'a', stage: 1 as const, overdue_days: 3, overdue_ratio: 3 },
    { card: 'b', stage: 1 as const, overdue_days: 1, overdue_ratio: 1 },
    { card: 'c', stage: 4 as const, overdue_days: 0, overdue_ratio: 0 },
  ];
  it('順序與 overdue 欄位照快取;stage 與題型、stuck 以 reviews.json 為準', () => {
    const items = dueItemsFromCache(queue, { a: review({ stage: 2, stuck: true }), b: review({ stage: 3 }) });
    expect(items.map((i) => i.card)).toEqual(['a', 'b', 'c']);
    expect(items[0]).toMatchObject({ stage: 2, types: ['fill', 'apply'], overdue_days: 3, overdue_ratio: 3, stuck: true });
    expect(items[1]).toMatchObject({ stage: 3, types: ['apply'], stuck: false });
  });
  it('帳本沒有這張卡 → 用快取的 stage、stuck 為 false', () => {
    const items = dueItemsFromCache(queue, {});
    expect(items[2]).toMatchObject({ stage: 4, stuck: false });
    expect(items[2]!.types).toEqual(dueItemsFromCache([{ ...queue[2]!, stage: 4 }], { c: review({ stage: 4 }) })[0]!.types);
  });
  it('帳本的 stage 不在 1–5(例如 0 或 6)→ 退回快取的 stage;邊界 1 與 5 照帳本', () => {
    expect(dueItemsFromCache([queue[0]!], { a: review({ stage: 0 as never }) })[0]!.stage).toBe(1);
    expect(dueItemsFromCache([queue[0]!], { a: review({ stage: 6 as never }) })[0]!.stage).toBe(1);
    expect(dueItemsFromCache([queue[2]!], { c: review({ stage: 1 }) })[0]!.stage).toBe(1);
    expect(dueItemsFromCache([queue[0]!], { a: review({ stage: 5 }) })[0]!.stage).toBe(5);
  });
});

describe('dropAnsweredToday', () => {
  const items = dueItemsFromCache(
    ['a', 'b', 'c', 'd'].map((card) => ({ card, stage: 1 as const, overdue_days: 0, overdue_ratio: 0 })),
    {},
  );
  it('今天有 history 的卡拿掉;昨天或更早的不算;沒有紀錄的卡留著;順序不變', () => {
    const out = dropAnsweredToday(items, { a: review({ history: [entry(TODAY, true)] }), b: review({ history: [entry('2026-09-09', true)] }), c: review() }, TODAY);
    expect(out.map((i) => i.card)).toEqual(['b', 'c', 'd']);
  });
  it('明天的 history 也不算今天已答', () => {
    const out = dropAnsweredToday(items, { a: review({ history: [entry('2026-09-11', true)] }) }, TODAY);
    expect(out.map((i) => i.card)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('tallyToday', () => {
  const run = (reviews: Record<string, Review>, cards = Object.keys(reviews)) => tallyToday(cards, reviews, TODAY);
  it('每筆有效結果都過 → passed;任何一筆沒過 → returned;沒有今天的 history → retryLater', () => {
    expect(
      run({
        p1: review({ history: [entry(TODAY, true)] }),
        p2: review({ history: [entry(TODAY, true), entry(TODAY, true, { type: 'apply' })] }),
        r1: review({ history: [entry(TODAY, false)] }),
        r2: review({ history: [entry(TODAY, true), entry(TODAY, false, { type: 'apply' })] }),
        t1: review({ history: [entry('2026-09-09', true)] }),
        t2: review(),
      }),
    ).toEqual({ passed: 2, returned: 2, retryLater: 2 });
  });
  it('有效結果 = revised_to ?? pass:改判成過算過、改判成沒過算回退(兩個方向)', () => {
    expect(run({ x: review({ history: [entry(TODAY, false, { revised_to: true })] }) })).toEqual({ passed: 1, returned: 0, retryLater: 0 });
    expect(run({ x: review({ history: [entry(TODAY, true, { revised_to: false })] }) })).toEqual({ passed: 0, returned: 1, retryLater: 0 });
  });
  it('帳本沒有這張卡(只在名單裡)→ retryLater;名單外的卡不算;空名單全 0', () => {
    expect(tallyToday(['ghost'], {}, TODAY)).toEqual({ passed: 0, returned: 0, retryLater: 1 });
    expect(tallyToday(['p'], { p: review({ history: [entry(TODAY, true)] }), other: review({ history: [entry(TODAY, false)] }) }, TODAY)).toEqual({ passed: 1, returned: 0, retryLater: 0 });
    expect(tallyToday([], {}, TODAY)).toEqual({ passed: 0, returned: 0, retryLater: 0 });
  });
  it('每張卡只算一次(同一天兩筆不重複算)', () => {
    expect(run({ x: review({ history: [entry(TODAY, false), entry(TODAY, false)] }) })).toEqual({ passed: 0, returned: 1, retryLater: 0 });
  });
});

describe('renderSummary 的新欄位', () => {
  const tomorrow = { total: 0, capped: false, shown: 0, overflow: 0 };
  it('answeredThisRun 沒傳 → 不印那行(跟 phase-1 位元組相同);傳 0 也要印', () => {
    expect(renderSummary({ passed: 3, failed: 0, errors: 0, tomorrow, retryLater: 0 })).toBe('3 passed, 0 returned.\nTomorrow: 0 due.');
    expect(renderSummary({ passed: 3, failed: 0, errors: 0, tomorrow, retryLater: 0, answeredThisRun: 0 })).toBe('3 passed, 0 returned.\nAnswered this run: 0.\nTomorrow: 0 due.');
  });
  it('retryLater > 0 才印;有傳 retryLater 就不印舊的 grading error 那行;沒傳才用 errors', () => {
    const withRetry = renderSummary({ passed: 1, failed: 0, errors: 2, tomorrow, retryLater: 1 });
    expect(withRetry).toContain('Retry later: 1 question(s).');
    expect(withRetry).not.toContain('grading error');
    const legacy = renderSummary({ passed: 1, failed: 0, errors: 2, tomorrow });
    expect(legacy).toContain('2 question(s) had a grading error and were skipped.');
    expect(renderSummary({ passed: 1, failed: 0, errors: 2, tomorrow, retryLater: 0 })).not.toMatch(/Retry later|grading error/);
    expect(renderSummary({ passed: 1, failed: 0, errors: 0, tomorrow })).not.toMatch(/grading error/);
  });
});
