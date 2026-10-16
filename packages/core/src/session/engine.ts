/**
 * 複習的編排只有這一份(ADR-075):CLI 與側車都呼叫這裡。
 * 不寫 stdout、不呼叫 process.exit——印字與退出碼留在 CLI。
 */
import type { LlmRouter } from '@core/grading/index.js';
import { snapshotLearningDir } from '@core/schema/git-repo.js';
import { nextCalendarDay } from '@core/schema/review.js';
import { buildDueList } from '@core/scheduler/index.js';
import { buildTodaySession, dropAnsweredToday, dueItemsFromCache } from './build.js';
import { readSessionCache, toSessionCache, warnInvalidSessionCache, writeSessionCache, type SessionCache } from './cache.js';
import { loadReviews, loadSettings, readReviewsSnapshot } from './io.js';
import { estimateTomorrow, tallyToday } from './summary.js';
import type { Session, SessionSummaryInput } from './types.js';

export type DayOpen =
  | { kind: 'paused'; cache: SessionCache }
  | { kind: 'ready'; session: Session; cache: SessionCache; resumed: boolean };

/** --dry-run / --pause 永遠不評分。被呼叫就丟錯,避免悄悄走一條會花錢的路。 */
function refusingRouter(): LlmRouter {
  const refuse = async (): Promise<never> => {
    throw new Error('dry-run 不評分,不該呼叫 router');
  };
  return { call: refuse, probeOnline: refuse, probeLocal: refuse };
}

function cacheFromSession(session: Session, paused: boolean): SessionCache {
  return toSessionCache({
    date: session.today,
    paused,
    totalDue: session.totalDue,
    deferred: session.deferred,
    queue: session.queue,
    reteach: session.reteachQueue,
  });
}

async function buildAndStore(
  dir: string,
  today: string,
  router: LlmRouter,
  paused: boolean,
  env: NodeJS.ProcessEnv,
): Promise<SessionCache> {
  const session = await buildTodaySession({ learningDir: dir, today, router });
  const cache = cacheFromSession(session, paused);
  writeSessionCache(dir, cache, env);
  return cache;
}

function sessionFromCache(dir: string, today: string, router: LlmRouter, cache: SessionCache): Session {
  const snap = readReviewsSnapshot(dir);
  const settings = loadSettings(dir);
  return {
    learningDir: dir,
    today,
    dailyCap: settings.daily_cap,
    router,
    queue: dropAnsweredToday(dueItemsFromCache(cache.queue, snap.reviews), snap.reviews, today),
    reteachQueue: [...cache.reteach],
    totalDue: cache.total_due,
    deferred: cache.deferred,
    passed: 0,
    failed: 0,
    errors: 0,
    reviewsHash: snap.hash,
    current: undefined,
  };
}

/** 讀今天的快取:ok 就用(續答);invalid 記 warning 再重建;missing / stale 重建並寫快取;paused 回 paused。 */
export async function openDay(opts: {
  learningDir: string;
  today: string;
  router: LlmRouter;
  env?: NodeJS.ProcessEnv;
}): Promise<DayOpen> {
  const env = opts.env ?? process.env;
  const prior = readSessionCache(opts.learningDir, opts.today, env);
  if (prior.kind === 'ok' && prior.cache.paused) {
    return { kind: 'paused', cache: prior.cache };
  }
  if (prior.kind === 'ok') {
    return {
      kind: 'ready',
      session: sessionFromCache(opts.learningDir, opts.today, opts.router, prior.cache),
      cache: prior.cache,
      resumed: true,
    };
  }
  if (prior.kind === 'invalid') warnInvalidSessionCache(opts.learningDir, opts.today);
  const cache = await buildAndStore(opts.learningDir, opts.today, opts.router, false, env);
  return {
    kind: 'ready',
    session: sessionFromCache(opts.learningDir, opts.today, opts.router, cache),
    cache,
    resumed: false,
  };
}

/** CLI 的 --pause:有快取就標 paused;沒有(或壞掉,先記 warning)就用不評分的 router 建一份 paused 的快取。 */
export async function pauseDay(opts: { learningDir: string; today: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  const env = opts.env ?? process.env;
  const prior = readSessionCache(opts.learningDir, opts.today, env);
  if (prior.kind === 'ok') {
    writeSessionCache(opts.learningDir, { ...prior.cache, paused: true }, env);
    return;
  }
  if (prior.kind === 'invalid') warnInvalidSessionCache(opts.learningDir, opts.today);
  await buildAndStore(opts.learningDir, opts.today, refusingRouter(), true, env);
}

/** CLI 的 --unpause:有快取就把 paused 改 false 並寫回,回傳新的快取;沒有或壞掉就回 undefined,不記 warning。 */
export function unpauseDay(opts: { learningDir: string; today: string; env?: NodeJS.ProcessEnv }): SessionCache | undefined {
  const env = opts.env ?? process.env;
  const prior = readSessionCache(opts.learningDir, opts.today, env);
  if (prior.kind !== 'ok') return undefined;
  const next = { ...prior.cache, paused: false };
  writeSessionCache(opts.learningDir, next, env);
  return next;
}

/** 小結的數字:tallyToday + 明天估計(跟現在 review.ts 算法相同);resumed 時帶 answeredThisRun。 */
export function summarizeDay(opts: {
  learningDir: string;
  today: string;
  cache: SessionCache;
  dailyCap: number;
  answeredThisRun: number;
  resumed: boolean;
}): SessionSummaryInput {
  const reviews = loadReviews(opts.learningDir);
  const tally = tallyToday(
    opts.cache.queue.map((item) => item.card),
    reviews,
    opts.today,
  );
  const tomorrow = nextCalendarDay(opts.today);
  const dueTomorrowAll = buildDueList(reviews as unknown as Parameters<typeof buildDueList>[0], tomorrow).length;
  const estimate = estimateTomorrow({
    dueTomorrowExcludingReturns: Math.max(0, dueTomorrowAll - tally.returned),
    returnedToday: tally.returned,
    dailyCap: opts.dailyCap,
  });
  const summary: SessionSummaryInput = {
    passed: tally.passed,
    failed: tally.returned,
    errors: 0,
    tomorrow: estimate,
    retryLater: tally.retryLater,
  };
  if (opts.resumed) summary.answeredThisRun = opts.answeredThisRun;
  return summary;
}

/** 這一次有答題(answeredThisRun ≥ 1)才 snapshot;失敗不丟錯。hint 可能含路徑,側車不往 webview 送。 */
export function snapshotAfterReview(opts: {
  learningDir: string;
  today: string;
  answeredThisRun: number;
}): { status: 'committed' | 'no-changes' | 'skipped' | 'failed'; hint?: string } {
  if (opts.answeredThisRun < 1) return { status: 'skipped' };
  try {
    const [y, m, d] = opts.today.split('-').map(Number);
    const result = snapshotLearningDir(opts.learningDir, { today: new Date(y ?? 0, (m ?? 1) - 1, d ?? 1) });
    if (result.status === 'committed' || result.status === 'no-changes') return { status: result.status };
    if (result.hint !== undefined) return { status: 'failed', hint: result.hint };
    return { status: 'failed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', hint: `snapshot 失敗:${message}` };
  }
}
