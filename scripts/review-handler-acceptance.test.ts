/**
 * T22 驗收補測(-ed):handler.ts / engine.ts 的 Stryker 存活逐個判決後留下的缺口。
 * 用 createReviewHandler 與暫存 vault,不打網路、不碰真的 learning/。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { snapshotMessage } from '@core/schema/git-repo.js';
import { ERROR_MESSAGES } from '../packages/core/src/session/protocol.js';
import { createReviewHandler } from '../packages/core/src/session/handler.js';
import { openDay, snapshotAfterReview } from '../packages/core/src/session/engine.js';
import {
  TODAY,
  addDays,
  cachePath,
  createVault,
  gitInit,
  headMessage,
  installFailingPreCommit,
  ledgerEvents,
  readReviews,
  removeVault,
  reviewRecord,
  reviewsPath,
  writeReviews,
  type Vault,
} from '../features/support/review-session-harness.js';

type Obj = Record<string, unknown>;
const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});

function envOf(v: Vault): NodeJS.ProcessEnv {
  return { ...process.env, HOME: v.home, XDG_CACHE_HOME: v.xdgCache, XDG_CONFIG_HOME: v.xdgConfig, LC_REVIEW_FAKE_CLOUD: undefined, LC_REVIEW_TODAY: undefined };
}
const noRouter = {
  async call(): Promise<never> {
    throw new Error('沒有本機模型');
  },
  async probeOnline(): Promise<boolean> {
    return false;
  },
  async probeLocal(): Promise<unknown> {
    return { available: false, models: [] };
  },
};

function rig(entries: Record<string, Partial<ReturnType<typeof reviewRecord>> & { stage: number; overdue?: number }>, factory?: () => unknown, git = false) {
  const v = createVault({ cards: 6 });
  vaults.push(v);
  const reviews: Record<string, ReturnType<typeof reviewRecord>> = {};
  for (const [id, e] of Object.entries(entries)) {
    const { overdue, ...rest } = e;
    reviews[id] = reviewRecord({ ...rest, next_due: addDays(TODAY, -(overdue ?? 1)) });
  }
  writeReviews(v, reviews);
  if (git) gitInit(v);
  let calls = 0;
  const handler = createReviewHandler({
    learningDir: v.dir,
    today: TODAY,
    routerFactory: () => {
      calls += 1;
      return factory ? factory() : noRouter;
    },
    env: envOf(v),
  });
  let id = 1;
  const send = async (method: string, params: Obj = {}): Promise<Obj> => JSON.parse(await handler(JSON.stringify({ v: 1, id: id++, method, params }))) as Obj;
  return { v, send, calls: () => calls };
}
const ok = (r: Obj): Obj => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.result as Obj;
};
const kind = (r: Obj): string => {
  expect(r.ok, JSON.stringify(r)).toBe(false);
  return (r.error as { kind: string }).kind;
};
/** 錯誤回應只准是 { kind: 'internal', message: 固定句子 },不帶例外原文、路徑、金鑰樣子的字串。 */
function expectFixedInternal(res: Obj): void {
  expect(res.ok).toBe(false);
  expect(res.error).toEqual({ kind: 'internal', message: ERROR_MESSAGES.internal });
  expect(Object.keys(res).sort()).toEqual(['error', 'id', 'ok', 'v']);
}
const base = { 'sec-0001': { stage: 1, overdue: 3 } };

describe('暫停日的 start', () => {
  it('回 resumed false,而且不叫 routerFactory(暫停日不需要帳本)', async () => {
    const r = rig(base);
    ok(await r.send('start'));
    const path = cachePath(r.v, TODAY);
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), paused: true }), 'utf8');
    let calls = 0;
    const second = createReviewHandler({
      learningDir: r.v.dir,
      today: TODAY,
      routerFactory: () => {
        calls += 1;
        return noRouter;
      },
      env: envOf(r.v),
    });
    const out = JSON.parse(await second(JSON.stringify({ v: 1, id: 1, method: 'start', params: {} }))) as Obj;
    expect(ok(out)).toMatchObject({ state: 'paused', resumed: false });
    expect(calls).toBe(0);
  });
});

describe('start 的 state 與續答計數', () => {
  it('今天沒有到期但有要重教的卡:state 是 ready,不是 empty', async () => {
    const r = rig({});
    const p = cachePath(r.v, TODAY);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, JSON.stringify({ version: 1, date: TODAY, paused: false, total_due: 0, deferred: 0, queue: [], reteach: ['sec-0001'] }), 'utf8');
    expect(ok(await r.send('start'))).toMatchObject({ state: 'ready', total: 0 });
  });

  it('answered 只算「今天」答的:歷史裡只有別天的紀錄就是 0', async () => {
    const r = rig({ 'sec-0001': { stage: 1, overdue: 3, history: [{ date: addDays(TODAY, -5), stage: 1, type: 'fill', pass: true, grader: 'exact' }] } });
    expect(ok(await r.send('start'))).toMatchObject({ answered: 0 });
  });
});

describe('題型對不上與例外的分類', () => {
  it('對應用題送 fill:no-question(不是吃掉這一題)', async () => {
    const r = rig({ 'sec-0003': { stage: 3, overdue: 1 } });
    ok(await r.send('start'));
    expect(ok(await r.send('next'))).toMatchObject({ type: 'apply' });
    expect(kind(await r.send('submit', { fill: ['a'] }))).toBe('no-question');
    expect(ok(await r.send('next'))).toMatchObject({ type: 'apply' });
  });

  it('routerFactory 丟「帶 kind 的普通物件」也認得:root-mismatch / router-unavailable;別的 kind 是 internal', async () => {
    for (const k of ['root-mismatch', 'router-unavailable'] as const) {
      const r = rig(base, () => {
        throw { kind: k };
      });
      expect(kind(await r.send('start'))).toBe(k);
    }
    const other = rig(base, () => {
      throw { kind: 'whatever' };
    });
    expect(kind(await other.send('start'))).toBe('internal');
    const plain = rig(base, () => {
      throw new Error('x');
    });
    expect(kind(await plain.send('start'))).toBe('internal');
  });

  it('submit 時非「紀錄被改過」的例外是 internal(不是 review-record-changed)', async () => {
    const r = rig(base);
    ok(await r.send('start'));
    ok(await r.send('next'));
    writeFileSync(reviewsPath(r.v), '{ 壞掉', 'utf8');
    expectFixedInternal(await r.send('submit', { fill: ['a'] }));
  });

  it('next 時讀不到題目檔:internal;summary 時 reviews.json 壞掉:internal', async () => {
    const r = rig(base);
    ok(await r.send('start'));
    rmSync(join(r.v.dir, 'questions', 'sec-0001.yaml'));
    expectFixedInternal(await r.send('next'));
    const s = rig(base);
    ok(await s.send('start'));
    writeFileSync(reviewsPath(s.v), '{ 壞掉', 'utf8');
    expectFixedInternal(await s.send('summary'));
  });
});

describe('engine:警告與 snapshot', () => {
  const warnings = (v: Vault): Obj[] => ledgerEvents(v).filter((e) => e.type === 'warning' && e.reason === 'session-cache-invalid');

  it('openDay:沒有快取、舊的快取都不記 warning;壞掉的才記一次', async () => {
    const r = rig(base);
    await openDay({ learningDir: r.v.dir, today: TODAY, router: noRouter as never, env: envOf(r.v) });
    expect(warnings(r.v)).toHaveLength(0);
    const p = cachePath(r.v, TODAY);
    writeFileSync(p, '{ 壞掉', 'utf8');
    await openDay({ learningDir: r.v.dir, today: TODAY, router: noRouter as never, env: envOf(r.v) });
    expect(warnings(r.v)).toHaveLength(1);
  });

  it('答了題之後 snapshot 的 commit 訊息用「今天」的日期(不是現在的日期)', async () => {
    const r = rig(base, undefined, true);
    ok(await r.send('start'));
    ok(await r.send('next'));
    const reviews = readReviews(r.v);
    reviews['sec-0001'] = { ...reviews['sec-0001']!, history: [{ date: TODAY, stage: 1, type: 'fill', pass: true, grader: 'exact' }] };
    writeReviews(r.v, reviews);
    const out = snapshotAfterReview({ learningDir: r.v.dir, today: TODAY, answeredThisRun: 1 });
    expect(out.status).toBe('committed');
    expect(headMessage(r.v)).toBe(snapshotMessage(new Date(2026, 8, 10)));
  });

  it('commit 被擋:status failed、hint 是字串;learning 目錄不存在:failed 且 hint 開頭是固定的「snapshot 失敗:」', () => {
    const r = rig(base, undefined, true);
    installFailingPreCommit(r.v);
    writeFileSync(join(r.v.dir, 'new-file.txt'), 'x', 'utf8');
    const blocked = snapshotAfterReview({ learningDir: r.v.dir, today: TODAY, answeredThisRun: 1 });
    expect(blocked.status).toBe('failed');
    expect(blocked.hint).toMatch(/^snapshot 失敗:.+/);
    const missing = snapshotAfterReview({ learningDir: join(r.v.dir, 'no-such-dir'), today: TODAY, answeredThisRun: 1 });
    expect(missing.status).toBe('failed');
  });
});
