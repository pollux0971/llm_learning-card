/**
 * T17(11-review-cli phase-2)· `session/cache.ts` 的單元層:當日快取的格式驗證與寫入方式。
 *
 * 工單只釘了一個名字:`SessionCacheSchema`(放 `packages/core/src/session/cache.ts`)。
 * 其餘函式(讀、寫、算路徑)沒有指定名字,所以它們的行為由 `scripts/review-session.test.ts` 與
 * `features/11-review-cli/phase-2.feature` 從 CLI 外面量,這裡不猜名字。
 *
 * cache.ts 還沒有:用算出來的 file URL 動態載入(`tsc --noEmit` 不解析非字面的 specifier),
 * 載不到時只有用到它的測試紅,訊息是 Cannot find module。
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const SESSION_DIR = resolve(import.meta.dirname);
const CACHE_TS = join(SESSION_DIR, 'cache.ts');

interface SafeParse {
  success: boolean;
  data?: unknown;
}
interface SchemaLike {
  safeParse(value: unknown): SafeParse;
}

async function loadSchema(): Promise<SchemaLike> {
  const mod = (await import(pathToFileURL(CACHE_TS).href)) as { SessionCacheSchema?: SchemaLike };
  expect(mod.SessionCacheSchema, 'cache.ts 要匯出 SessionCacheSchema').toBeDefined();
  return mod.SessionCacheSchema!;
}

/** 工單「快取格式」那一段的最小例子(只有格式,沒有任何邏輯)。 */
function valid(): Record<string, unknown> {
  return {
    version: 1,
    date: '2026-10-16',
    paused: false,
    total_due: 2,
    deferred: 0,
    queue: [
      { card: 'sec-0001', stage: 1, overdue_days: 0, overdue_ratio: 0 },
      { card: 'sec-0002', stage: 3, overdue_days: 2, overdue_ratio: 0.5 },
    ],
    reteach: ['sec-0002'],
  };
}

function without(key: string): Record<string, unknown> {
  const v = valid();
  delete v[key];
  return v;
}

describe('SessionCacheSchema 接受工單的格式', () => {
  it('完整的快取通過,而且原樣吐回來(不改、不加欄位)', async () => {
    const schema = await loadSchema();
    const r = schema.safeParse(valid());
    expect(r.success).toBe(true);
    expect(r.data).toEqual(valid());
  });

  it('paused 為 true、deferred 大於 0、reteach 為空都合法', async () => {
    const schema = await loadSchema();
    expect(schema.safeParse({ ...valid(), paused: true }).success).toBe(true);
    expect(schema.safeParse({ ...valid(), deferred: 4 }).success).toBe(true);
    expect(schema.safeParse({ ...valid(), reteach: [] }).success).toBe(true);
  });
});

describe('SessionCacheSchema 拒絕壞的快取(壞了就丟掉重建)', () => {
  it('未知的 version 當壞掉(2、0、字串 "1")', async () => {
    const schema = await loadSchema();
    for (const version of [2, 0, '1', null]) {
      expect(schema.safeParse({ ...valid(), version }).success, `version=${String(version)}`).toBe(false);
    }
  });

  it('頂層缺任何一個欄位都不行', async () => {
    const schema = await loadSchema();
    for (const key of ['version', 'date', 'paused', 'total_due', 'deferred', 'queue', 'reteach']) {
      expect(schema.safeParse(without(key)).success, `缺 ${key}`).toBe(false);
    }
  });

  it('欄位型別不對不行:paused 不是布林、date 不是 YYYY-MM-DD、total_due 負數或小數、deferred 負數', async () => {
    const schema = await loadSchema();
    expect(schema.safeParse({ ...valid(), paused: 'yes' }).success).toBe(false);
    expect(schema.safeParse({ ...valid(), paused: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...valid(), date: '2026-9-1' }).success).toBe(false);
    expect(schema.safeParse({ ...valid(), date: '20261016' }).success).toBe(false);
    expect(schema.safeParse({ ...valid(), date: 20261016 }).success).toBe(false);
    expect(schema.safeParse({ ...valid(), total_due: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...valid(), total_due: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ ...valid(), deferred: -2 }).success).toBe(false);
    expect(schema.safeParse({ ...valid(), reteach: 'sec-0001' }).success).toBe(false);
    expect(schema.safeParse({ ...valid(), reteach: [1] }).success).toBe(false);
    expect(schema.safeParse({ ...valid(), queue: 'sec-0001' }).success).toBe(false);
  });

  it('queue 的每一項要有 card、stage、overdue_days、overdue_ratio(04 DueItem 的欄位),缺一個都不行', async () => {
    const schema = await loadSchema();
    for (const key of ['card', 'stage', 'overdue_days', 'overdue_ratio']) {
      const item: Record<string, unknown> = { card: 'sec-0001', stage: 1, overdue_days: 0, overdue_ratio: 0 };
      delete item[key];
      expect(schema.safeParse({ ...valid(), queue: [item] }).success, `queue 項缺 ${key}`).toBe(false);
    }
  });

  it('queue 項的 stage 只能是 1–5(契約的 Stage)', async () => {
    const schema = await loadSchema();
    const item = (over: Record<string, unknown>): Record<string, unknown> => ({ card: 'sec-0001', stage: 1, overdue_days: 0, overdue_ratio: 0, ...over });
    expect(schema.safeParse({ ...valid(), queue: [item({ stage: 0 })] }).success).toBe(false);
    expect(schema.safeParse({ ...valid(), queue: [item({ stage: 6 })] }).success).toBe(false);
    expect(schema.safeParse({ ...valid(), queue: [item({ stage: 5 })] }).success).toBe(true);
  });

  it('不存 learned_at:queue 項若多一個 learned_at 就是壞的(那個以 reviews.json 為準)', async () => {
    const schema = await loadSchema();
    const queue = [{ card: 'sec-0001', stage: 1, overdue_days: 0, overdue_ratio: 0, learned_at: '2026-08-01' }];
    expect(schema.safeParse({ ...valid(), queue }).success).toBe(false);
  });

  it('不存答案與分數:queue 項多任何欄位(passed、answer、score)都不行', async () => {
    const schema = await loadSchema();
    for (const extra of [{ passed: true }, { answer: 'x' }, { score: 3 }]) {
      const queue = [{ card: 'sec-0001', stage: 1, overdue_days: 0, overdue_ratio: 0, ...extra }];
      expect(schema.safeParse({ ...valid(), queue }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('不是物件的東西(null、陣列、字串、數字)都不行', async () => {
    const schema = await loadSchema();
    for (const value of [null, [], 'session', 7, undefined]) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});

describe('寫入走 writeFileAtomic(硬規則 5:暫存檔、fsync、rename)', () => {
  /** 去掉註解後的原始碼。 */
  function code(): string {
    return readFileSync(CACHE_TS, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
  }

  it('cache.ts 用 writeFileAtomic 寫檔', () => {
    expect(code()).toMatch(/\bwriteFileAtomic\b/);
  });

  it('cache.ts 沒有自己寫檔或改名(writeFileSync / writeFile / rename / createWriteStream)', () => {
    expect(code()).not.toMatch(/\b(writeFileSync|writeFile|renameSync|rename|createWriteStream|copyFileSync)\b/);
  });
});
