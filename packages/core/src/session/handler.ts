/**
 * 複習側車的方法(ADR-075)。收一行、回一行,不含換行,不碰 stdio、不呼叫 process.exit。
 * 行程框線(scripts/review-sidecar.ts)負責換行與 stderr。
 */
import { relative } from 'node:path';
import type { CardId } from '@contracts/index.js';
import type { LlmRouter } from '@core/grading/index.js';
import { submitAnswer } from './answer.js';
import { readSessionCache, type SessionCache } from './cache.js';
import { openDay, snapshotAfterReview, summarizeDay } from './engine.js';
import { findCardFile, listCardIds, loadReviews, loadSettings } from './io.js';
import { presentNextCard } from './present.js';
import { ERROR_MESSAGES, classifyRequestLine, type ErrorKind } from './protocol.js';
import type { Session } from './types.js';

/** routerFactory 用這個告訴 handler 是哪一種啟動失敗。其他例外一律是 internal。 */
export class ReviewStartError extends Error {
  readonly kind: 'root-mismatch' | 'router-unavailable';

  constructor(kind: 'root-mismatch' | 'router-unavailable') {
    super(ERROR_MESSAGES[kind]);
    this.name = 'ReviewStartError';
    this.kind = kind;
  }
}

export interface ReviewHandlerDeps {
  learningDir: string;
  today: string;
  routerFactory: () => unknown | Promise<unknown>;
  env: NodeJS.ProcessEnv;
}

type Handler = (line: string) => Promise<string>;

function refusingRouter(): LlmRouter {
  const refuse = async (): Promise<never> => {
    throw new Error('暫停日不評分,不該呼叫 router');
  };
  return { call: refuse, probeOnline: refuse, probeLocal: refuse };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function startFailureKind(err: unknown): 'root-mismatch' | 'router-unavailable' | 'internal' {
  if (err instanceof ReviewStartError) return err.kind;
  if (isRecord(err)) {
    const kind = err.kind;
    if (kind === 'root-mismatch' || kind === 'router-unavailable') return kind;
  }
  return 'internal';
}

function isReviewsChanged(err: unknown): boolean {
  return isRecord(err) && err.code === 'reviews-changed';
}

export function createReviewHandler(deps: ReviewHandlerDeps): Handler {
  const { learningDir, today, env } = deps;
  let router: LlmRouter | undefined;
  let session: Session | undefined;
  let cache: SessionCache | undefined;
  let resumed = false;
  let answeredThisRun = 0;

  const fail = (id: number | null, kind: ErrorKind): string =>
    JSON.stringify({ v: 1, id, ok: false, error: { kind, message: ERROR_MESSAGES[kind] } });
  const ok = (id: number, result: unknown): string => JSON.stringify({ v: 1, id, ok: true, result });

  const diskPaused = (): boolean => {
    const prior = readSessionCache(learningDir, today, env);
    return prior.kind === 'ok' && prior.cache.paused;
  };

  async function ensureRouter(): Promise<LlmRouter> {
    if (router) return router;
    const created = await deps.routerFactory();
    router = created as LlmRouter;
    return router;
  }

  function answeredToday(dayCache: SessionCache): number {
    const reviews = loadReviews(learningDir);
    let n = 0;
    for (const item of dayCache.queue) {
      if ((reviews[item.card]?.history ?? []).some((entry) => entry.date === today)) n += 1;
    }
    return n;
  }

  function startResult(
    state: 'paused' | 'empty' | 'ready',
    dayCache: SessionCache,
    resumedFlag: boolean,
    dailyCap: number,
    deferred: number,
  ): Record<string, unknown> {
    return {
      state,
      today,
      resumed: resumedFlag,
      total: dayCache.total_due,
      answered: answeredToday(dayCache),
      deferred,
      dailyCap,
      fakeCloud: Boolean(env.LC_REVIEW_FAKE_CLOUD),
    };
  }

  function reteachResult(card: CardId): { kind: 'reteach'; card: CardId; path: string; short: boolean } {
    let short = true;
    let abs: string;
    try {
      abs = findCardFile(learningDir, card, { short: true });
    } catch {
      short = false;
      abs = findCardFile(learningDir, card);
    }
    const path = relative(learningDir, abs).split('\\').join('/');
    return { kind: 'reteach', card, path, short };
  }

  async function handleStart(id: number): Promise<string> {
    if (listCardIds(learningDir).length === 0) return fail(id, 'no-cards');
    const prior = readSessionCache(learningDir, today, env);
    const paused = prior.kind === 'ok' && prior.cache.paused;
    let active = router;
    if (!paused) {
      try {
        active = await ensureRouter();
      } catch (err) {
        session = undefined;
        cache = undefined;
        return fail(id, startFailureKind(err));
      }
    }
    try {
      const opened = await openDay({ learningDir, today, router: active ?? refusingRouter(), env });
      answeredThisRun = 0;
      if (opened.kind === 'paused') {
        session = undefined;
        cache = opened.cache;
        resumed = false;
        return ok(id, startResult('paused', opened.cache, false, loadSettings(learningDir).daily_cap, opened.cache.deferred));
      }
      session = opened.session;
      cache = opened.cache;
      resumed = opened.resumed;
      const state = opened.session.totalDue === 0 && opened.session.reteachQueue.length === 0 ? 'empty' : 'ready';
      return ok(id, startResult(state, opened.cache, opened.resumed, opened.session.dailyCap, opened.session.deferred));
    } catch {
      session = undefined;
      cache = undefined;
      return fail(id, 'internal');
    }
  }

  async function handleNext(id: number): Promise<string> {
    if (diskPaused()) return fail(id, 'paused');
    if (!session) return fail(id, 'no-session');
    try {
      const presentation = await presentNextCard(session);
      if (presentation.kind === 'done') return ok(id, { kind: 'done' });
      if (presentation.kind === 'reteach') return ok(id, reteachResult(presentation.card));
      const result: Record<string, unknown> = {
        kind: 'question',
        card: presentation.card,
        stage: presentation.stage,
        type: presentation.type,
        prompt: presentation.prompt,
        progress: presentation.progress,
        stuck: presentation.stuck,
        overdueDays: session.current?.overdueDays ?? 0,
      };
      if (presentation.type === 'fill') result.blanks = presentation.blanks ?? 0;
      return ok(id, result);
    } catch {
      return fail(id, 'internal');
    }
  }

  async function handleSubmit(id: number, params: { fill: string[] } | { apply: string }): Promise<string> {
    if (diskPaused()) return fail(id, 'paused');
    if (!session) return fail(id, 'no-session');
    const current = session.current;
    if (!current) return fail(id, 'no-question');
    const type = current.types[current.typeIndex];
    if ('fill' in params && type !== 'fill') return fail(id, 'no-question');
    if ('apply' in params && type !== 'apply') return fail(id, 'no-question');
    const correctAnswers = (current.fillQuestion?.answers ?? []).map((group) => group[0] ?? '');
    try {
      const outcome = await submitAnswer(session, 'fill' in params ? params.fill : params.apply, { keepOnError: true });
      answeredThisRun += 1;
      const result: Record<string, unknown> = {
        status: outcome.status,
        pass: outcome.pass,
        feedback: outcome.feedback,
        cardDone: outcome.cardDone,
      };
      if (outcome.newStage !== undefined) result.newStage = outcome.newStage;
      if (type === 'fill' && outcome.pass === false) result.correctAnswers = correctAnswers;
      return ok(id, result);
    } catch (err) {
      if (isReviewsChanged(err)) {
        session = undefined;
        cache = undefined;
        return fail(id, 'review-record-changed');
      }
      return fail(id, 'internal');
    }
  }

  async function handleSummary(id: number): Promise<string> {
    if (!session || !cache) return fail(id, 'no-session');
    try {
      const summary = summarizeDay({
        learningDir,
        today,
        cache,
        dailyCap: session.dailyCap,
        answeredThisRun,
        resumed,
      });
      const snap = snapshotAfterReview({ learningDir, today, answeredThisRun });
      const result: Record<string, unknown> = {
        passed: summary.passed,
        returned: summary.failed,
        retryLater: summary.retryLater ?? 0,
        tomorrow: summary.tomorrow,
        snapshot: snap.status,
      };
      if (summary.answeredThisRun !== undefined) result.answeredThisRun = summary.answeredThisRun;
      return ok(id, result);
    } catch {
      return fail(id, 'internal');
    }
  }

  function handleStatus(id: number): string {
    return ok(id, { paused: diskPaused(), today });
  }

  return async (line: string): Promise<string> => {
    const classified = classifyRequestLine(line);
    if (!classified.ok) return fail(classified.id, classified.kind);
    const request = classified.request as {
      id: number;
      method: 'start' | 'next' | 'submit' | 'summary' | 'status';
      params: { fill?: string[]; apply?: string };
    };
    try {
      switch (request.method) {
        case 'start':
          return await handleStart(request.id);
        case 'next':
          return await handleNext(request.id);
        case 'submit':
          return await handleSubmit(request.id, request.params as { fill: string[] } | { apply: string });
        case 'summary':
          return await handleSummary(request.id);
        case 'status':
          return handleStatus(request.id);
        default:
          return fail(request.id, 'unknown-method');
      }
    } catch {
      return fail(request.id, 'internal');
    }
  };
}
