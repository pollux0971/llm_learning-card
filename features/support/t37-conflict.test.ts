/**
 * T37:教學卡寫入的那幾毫秒衝突(ADR-077 第 3 點 a)。測試 agent 寫;開發 worker 不改。
 *
 * 用 `vi.mock` 把 core 的 `saveReviewsIfUnchanged`(`packages/core/src/session/io.ts`)包一層:
 * 真的函式照跑,但在它被呼叫的那一刻,先照腳本讓「別的行程」改一次磁碟上的 reviews.json
 * (模擬「重讀比對到 rename 之間」有人寫入)。真的函式看到雜湊不符,丟 `ReviewsChangedError`。
 * 所以這個檔同時證明:教學卡寫 reviews.json 一定走 `saveReviewsIfUnchanged`(不走的話計數是 0)。
 *
 * 規則(顧問 2026-10-21):
 *   - 每次寫都在同一個請求裡重讀、用「剛讀到的雜湊」當 expectedHash(不留長期基準);
 *   - 檢查沒過:重讀再試一次;還是不過才回 `teach-record-changed`,這時 reviews.json 與 log.jsonl 都沒有教學卡的東西。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { childEnv } from './review-session-harness.js';
import {
  TODAY,
  createTeachVault,
  freshLearned,
  learnedEvents,
  logText,
  readReviews,
  removeVault,
  reviewsPath,
  reviewsText,
  writeReviews,
  type Vault,
} from './teach-harness.js';

interface Call {
  expected: string;
  /** 被呼叫的那一刻,磁碟上 reviews.json 的雜湊(在腳本動手之前) */
  diskBefore: string;
}
const control = vi.hoisted(() => ({
  calls: [] as { expected: string; diskBefore: string }[],
  /** 還要讓幾次呼叫在真的函式之前被「別的行程」搶先改一次 */
  sabotage: 0,
  foreign: undefined as undefined | ((dir: string, n: number) => void),
  /** 設了就在真的函式之前直接丟這個錯(模擬磁碟寫入失敗;不是 reviews-changed) */
  failWith: undefined as undefined | Error,
}));

vi.mock('../../packages/core/src/session/io.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../packages/core/src/session/io.js')>();
  const { createHash: hash } = await import('node:crypto');
  const { readFileSync: read, existsSync: exists } = await import('node:fs');
  const { join: joinPath } = await import('node:path');
  return {
    ...real,
    saveReviewsIfUnchanged: (dir: string, reviews: never, expected: string): string => {
      const path = joinPath(dir, 'state/reviews.json');
      const diskBefore = exists(path) ? hash('sha256').update(read(path)).digest('hex') : 'absent';
      control.calls.push({ expected, diskBefore });
      if (control.failWith) throw control.failWith;
      if (control.sabotage > 0) {
        control.sabotage -= 1;
        control.foreign?.(dir, control.calls.length);
      }
      return real.saveReviewsIfUnchanged(dir, reviews, expected);
    },
  };
});

const HANDLER = pathToFileURL(join(import.meta.dirname, '../../packages/core/src/session/handler.ts')).href;
type Obj = Record<string, unknown>;

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});
beforeEach(() => {
  control.calls.length = 0;
  control.sabotage = 0;
  control.foreign = undefined;
  control.failWith = undefined;
});

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

async function rig(): Promise<{ v: Vault; send(method: string, params?: Obj): Promise<Obj> }> {
  const v = createTeachVault();
  vaults.push(v);
  const mod = (await import(/* @vite-ignore */ HANDLER)) as { createReviewHandler(deps: Obj): (line: string) => Promise<string> };
  const handler = mod.createReviewHandler({ learningDir: v.dir, today: TODAY, routerFactory: () => ({}), env: childEnv(v) });
  let id = 0;
  return {
    v,
    send: async (method, params = {}) => {
      id += 1;
      return JSON.parse(await handler(JSON.stringify({ v: 1, id, method, params }))) as Obj;
    },
  };
}

/** 「別的行程」每次呼叫都多加一筆(zzz-000n,不同的 key),讓磁碟雜湊一定跟教學卡剛讀到的不同 */
function foreignAdds(v: Vault): void {
  control.foreign = (_dir, n) => {
    writeReviews(v, { ...readReviews(v), [`zzz-000${n}`]: freshLearned('2026-08-30', '2026-08-31') as never });
  };
}

describe('寫 reviews.json 一律經 core 的 saveReviewsIfUnchanged,用剛讀到的雜湊', () => {
  it('沒有衝突:呼叫一次;expectedHash 就是呼叫當下磁碟上的雜湊', async () => {
    const r = await rig();
    await r.send('teach.open');
    const res = await r.send('teach.next');
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(control.calls).toHaveLength(1);
    const first = control.calls[0] as Call;
    expect(first.expected).toBe(first.diskBefore);
  });

  it('reviews.json 還不存在(第一次學):expectedHash 是 absent 的那個值,一樣成功', async () => {
    const r = await rig();
    // createTeachVault 寫了 {};把檔案刪掉,模擬一本全新的帳本
    const { rmSync } = await import('node:fs');
    rmSync(reviewsPath(r.v));
    await r.send('teach.open');
    const res = await r.send('teach.next');
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(control.calls).toHaveLength(1);
    expect(Object.keys(readReviews(r.v))).toEqual(['sec-0002']);
  });

  it('每次 teach.next 都用當下剛讀到的雜湊(不留上一次的):連按三次,每次 expected 都等於呼叫當下的磁碟雜湊', async () => {
    const r = await rig();
    await r.send('teach.open');
    for (let i = 0; i < 3; i += 1) {
      const res = await r.send('teach.next');
      expect(res.ok).toBe(true);
    }
    expect(control.calls).toHaveLength(3);
    for (const c of control.calls) expect(c.expected).toBe(c.diskBefore);
  });
});

describe('第一次寫入前有人搶先:重讀再試一次', () => {
  it('衝突一次:第二次成功;外面的那一筆還在、教學卡那一筆也在;learned 只記一次', async () => {
    const r = await rig();
    await r.send('teach.open');
    control.sabotage = 1;
    foreignAdds(r.v);
    const res = await r.send('teach.next');
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(control.calls).toHaveLength(2);
    const reviews = readReviews(r.v);
    expect(Object.keys(reviews).sort()).toEqual(['sec-0002', 'zzz-0001']);
    expect(reviews['sec-0002']).toEqual(freshLearned());
    expect(learnedEvents(r.v).map((e) => e.card)).toEqual(['sec-0002']);
  });

  it('重試用的是「重讀之後」的雜湊(搶先改過的那一份),不是第一次的', async () => {
    const r = await rig();
    await r.send('teach.open');
    control.sabotage = 1;
    foreignAdds(r.v);
    await r.send('teach.next');
    const [first, second] = control.calls as [Call, Call];
    expect(first.expected).not.toBe(second.expected);
    expect(second.expected).toBe(second.diskBefore);
  });

  it('衝突一次之後,畫面照常前進(回的是下一張)', async () => {
    const r = await rig();
    await r.send('teach.open');
    control.sabotage = 1;
    foreignAdds(r.v);
    const res = await r.send('teach.next');
    const view = res.result as { card: { id: string } | null };
    expect(view.card?.id).toBe('sec-0003');
  });
});

describe('連續兩次都被搶先:teach-record-changed,什麼都不留', () => {
  it('回固定字樣的錯誤;只試兩次;reviews.json 只有外面的改動、沒有教學卡那一筆;log.jsonl 沒有 learned', async () => {
    const r = await rig();
    await r.send('teach.open');
    control.sabotage = 2;
    foreignAdds(r.v);
    const res = await r.send('teach.next');
    expect(res.ok).toBe(false);
    const error = res.error as Obj;
    expect(error.kind).toBe('teach-record-changed');
    expect(error.message).toBe('學習紀錄剛被別的地方改過,這一張還沒記成學過。請再按一次。');
    expect(control.calls, '只試兩次,不無限重試').toHaveLength(2);
    expect(Object.keys(readReviews(r.v)).sort()).toEqual(['zzz-0001', 'zzz-0002']);
    expect(learnedEvents(r.v)).toEqual([]);
    expect(logText(r.v)).toBe('');
  });

  it('失敗之後再按一次:成功,而且標的還是同一張(目前卡沒有因為失敗而前進)', async () => {
    const r = await rig();
    await r.send('teach.open');
    control.sabotage = 2;
    foreignAdds(r.v);
    expect((await r.send('teach.next')).ok).toBe(false);
    const again = await r.send('teach.next');
    expect(again.ok, JSON.stringify(again)).toBe(true);
    expect(readReviews(r.v)['sec-0002']).toEqual(freshLearned());
    expect(learnedEvents(r.v).map((e) => e.card)).toEqual(['sec-0002']);
  });

  it('teach.switch 一樣:兩次都被搶先 → 錯誤,類別沒換(再按一次標的還是離開的那張)', async () => {
    const r = await rig();
    await r.send('teach.open');
    control.sabotage = 2;
    foreignAdds(r.v);
    const res = await r.send('teach.switch', { category: 'language' });
    expect((res.error as Obj | undefined)?.kind).toBe('teach-record-changed');
    expect(Object.keys(readReviews(r.v)).sort()).toEqual(['zzz-0001', 'zzz-0002']);
    const again = await r.send('teach.switch', { category: 'language' });
    expect(again.ok, JSON.stringify(again)).toBe(true);
    expect(readReviews(r.v)['sec-0002']).toEqual(freshLearned());
    expect(((again.result as Obj).card as Obj).id).toBe('lang-0003');
  });
});

describe('reviews.json 位元組:失敗時教學卡沒有動它', () => {
  it('第二次也失敗時,磁碟上的檔就是外面最後一次寫的那份', async () => {
    const r = await rig();
    await r.send('teach.open');
    control.sabotage = 2;
    foreignAdds(r.v);
    await r.send('teach.next');
    expect(sha(reviewsPath(r.v))).toBe(createHash('sha256').update(reviewsText(r.v)).digest('hex'));
    expect(JSON.parse(reviewsText(r.v))['sec-0002']).toBeUndefined();
  });
});

describe('寫入遇到「不是記錄被改過」的錯誤:真錯誤往上丟,不當成衝突重試(G-a)', () => {
  it('磁碟寫入失敗(EIO):回 internal,不是 teach-record-changed;只呼叫一次、不重試;reviews.json 與 log.jsonl 不動', async () => {
    const r = await rig();
    await r.send('teach.open');
    const reviewsBefore = reviewsText(r.v);
    const logBefore = logText(r.v);
    control.failWith = Object.assign(new Error('EIO: i/o error, write'), { code: 'EIO' });
    const res = await r.send('teach.next');
    expect(res.ok, JSON.stringify(res)).toBe(false);
    expect((res.error as Obj).kind).toBe('internal');
    expect(control.calls).toHaveLength(1);
    expect(reviewsText(r.v)).toBe(reviewsBefore);
    expect(logText(r.v)).toBe(logBefore);
    expect(learnedEvents(r.v)).toEqual([]);
  });

  it('同一種錯誤在 teach.switch 也一樣:internal、只呼叫一次', async () => {
    const r = await rig();
    await r.send('teach.open');
    control.failWith = new Error('ENOSPC');
    const res = await r.send('teach.switch', { category: 'language' });
    expect((res.error as Obj).kind).toBe('internal');
    expect(control.calls).toHaveLength(1);
    expect(learnedEvents(r.v)).toEqual([]);
  });
});
