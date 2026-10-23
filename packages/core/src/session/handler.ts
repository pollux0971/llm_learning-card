/**
 * 複習側車的方法(ADR-075)。收一行、回一行,不含換行,不碰 stdio、不呼叫 process.exit。
 * 行程框線(scripts/review-sidecar.ts)負責換行與 stderr。
 */
import { relative } from 'node:path';
import type { CardId } from '@contracts/index.js';
import type { LlmRouter } from '@core/grading/index.js';
import { credentialMessage, credentialProblem } from '@core/llm/credentials.js';
import { MissingCredentialError } from '@core/llm/errors.js';
import { submitAnswer } from './answer.js';
import { readSessionCache, type SessionCache } from './cache.js';
import { openDay, snapshotAfterReview, summarizeDay } from './engine.js';
import { findCardFile, listCardIds, loadReviews, loadSettings } from './io.js';
import { presentNextCard } from './present.js';
import { ERROR_MESSAGES, classifyRequestLine, type ErrorKind } from './protocol.js';
import { createDeepenController } from './teach-deepen.js';
import { createTeachRuntime } from './teach.js';
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
  today: string | (() => string);
  routerFactory: () => unknown | Promise<unknown>;
  env: NodeJS.ProcessEnv;
  /** 重讀 .env,回「內容有沒有變」。不給就是 T22:不重讀、不丟快取。 */
  reloadEnv?: () => boolean;
  /** 回缺的鍵名。不給就是 T22:不查金鑰。 */
  missingKeys?: () => readonly string[];
}

export interface ReviewHandler {
  (line: string): Promise<string>;
  shutdown(): void;
}

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

export function createReviewHandler(deps: ReviewHandlerDeps): ReviewHandler {
  const { learningDir, env } = deps;
  let router: LlmRouter | undefined;
  let session: Session | undefined;
  let cache: SessionCache | undefined;
  let resumed = false;
  let answeredThisRun = 0;
  let roundDay: string | undefined;
  if (typeof deps.today === 'string') roundDay = deps.today;

  const fail = (id: number | null, kind: ErrorKind): string =>
    JSON.stringify({ v: 1, id, ok: false, error: { kind, message: ERROR_MESSAGES[kind] } });
  const failCredential = (id: number, message: string): string =>
    JSON.stringify({ v: 1, id, ok: false, error: { kind: 'credential-unavailable', message } });
  const ok = (id: number, result: unknown): string => JSON.stringify({ v: 1, id, ok: true, result });

  function day(): string {
    if (roundDay !== undefined) return roundDay;
    if (typeof deps.today === 'function') return deps.today();
    throw new Error('internal: today 還沒在 start 算過');
  }

  function lockToday(): void {
    if (typeof deps.today !== 'function') return;
    roundDay = deps.today();
  }

  function reloadAndMaybeDropRouter(): void {
    if (deps.reloadEnv === undefined) return;
    if (deps.reloadEnv()) router = undefined;
  }

  const diskPaused = (): boolean => {
    const prior = readSessionCache(learningDir, day(), env);
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
      if ((reviews[item.card]?.history ?? []).some((entry) => entry.date === day())) n += 1;
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
    // 當日快取名單(queue)裡 overdue_days ≥ 1 的張數。剛好 1 天要算;reteach 不在 queue,不算。
    let overdue = 0;
    for (const item of dayCache.queue) {
      if (item.overdue_days >= 1) overdue += 1;
    }
    return {
      state,
      today: day(),
      resumed: resumedFlag,
      total: dayCache.total_due,
      answered: answeredToday(dayCache),
      deferred,
      dailyCap,
      overdue,
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

  function credentialLine(id: number, err: unknown): string | undefined {
    const problem = credentialProblem(err, env);
    if (problem === undefined) return undefined;
    return failCredential(id, credentialMessage(problem));
  }

  async function handleStart(id: number): Promise<string> {
    if (listCardIds(learningDir).length === 0) return fail(id, 'no-cards');
    reloadAndMaybeDropRouter();
    lockToday();
    const prior = readSessionCache(learningDir, day(), env);
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
      if (deps.missingKeys !== undefined) {
        const missing = deps.missingKeys();
        const first = missing[0];
        if (first !== undefined) {
          session = undefined;
          cache = undefined;
          const line = credentialLine(id, new MissingCredentialError(first));
          if (line !== undefined) return line;
          return fail(id, 'credential-unavailable');
        }
      }
    }
    try {
      const opened = await openDay({ learningDir, today: day(), router: active ?? refusingRouter(), env });
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
      reloadAndMaybeDropRouter();
      if (router === undefined) session.router = await ensureRouter();
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
      const line = credentialLine(id, err);
      if (line !== undefined) return line;
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
        today: day(),
        cache,
        dailyCap: session.dailyCap,
        answeredThisRun,
        resumed,
      });
      const snap = snapshotAfterReview({ learningDir, today: day(), answeredThisRun });
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
    return ok(id, { paused: diskPaused(), today: day() });
  }

  const teach = createTeachRuntime({
    learningDir,
    today: () => day(),
    examSession: () => session,
  });

  function teachLine(id: number, outcome: ReturnType<typeof teach.open>): string {
    if (!outcome.ok) return fail(id, outcome.kind);
    return ok(id, outcome.view);
  }

  function deepenLine(id: number, outcome: { ok: true; view: unknown } | { ok: false; kind: ErrorKind; message?: string }): string {
    if (!outcome.ok) {
      const message = outcome.message ?? ERROR_MESSAGES[outcome.kind];
      return JSON.stringify({ v: 1, id, ok: false, error: { kind: outcome.kind, message } });
    }
    return ok(id, outcome.view);
  }

  const deepen = createDeepenController({
    learningDir,
    today: () => day(),
    env,
    teach,
    missingKeys: deps.missingKeys,
    acquireRouter: async () => {
      reloadAndMaybeDropRouter();
      return ensureRouter();
    },
    startFailureKind,
  });

  const handle = async (line: string): Promise<string> => {
    const classified = classifyRequestLine(line);
    if (!classified.ok) return fail(classified.id, classified.kind);
    const request = classified.request as {
      id: number;
      method:
        | 'start'
        | 'next'
        | 'submit'
        | 'summary'
        | 'status'
        | 'teach.open'
        | 'teach.next'
        | 'teach.switch'
        | 'teach.prereq'
        | 'teach.deepen'
        | 'teach.poll'
        | 'teach.cancel'
        | 'teach.back';
      params: { fill?: string[]; apply?: string; category?: string; index?: number };
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
        case 'teach.open':
          deepen.abandon();
          return teachLine(request.id, teach.open(request.params.category));
        case 'teach.next':
          if (deepen.running()) return fail(request.id, 'bad-request');
          return teachLine(request.id, teach.next());
        case 'teach.switch':
          if (deepen.running()) return fail(request.id, 'bad-request');
          return teachLine(request.id, teach.switchTo(request.params.category ?? ''));
        case 'teach.prereq':
          if (deepen.running()) return fail(request.id, 'bad-request');
          return teachLine(request.id, teach.prereq(request.params.index ?? -1));
        case 'teach.deepen':
          return deepenLine(request.id, await deepen.deepen());
        case 'teach.poll':
          return deepenLine(request.id, deepen.poll());
        case 'teach.cancel':
          return deepenLine(request.id, deepen.cancel());
        case 'teach.back':
          return deepenLine(request.id, deepen.back());
        default:
          return fail(request.id, 'unknown-method');
      }
    } catch {
      return fail(request.id, 'internal');
    }
  };
  return Object.assign(handle, {
    shutdown(): void {
      deepen.shutdown();
    },
  });
}
