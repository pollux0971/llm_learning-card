/**
 * 深入的背景工作、取消、與麵包屑的接線(ADR-079,歸 11)。
 * 生成與寫卡在 02 的 deepen.ts。這裡只決定要不要開工、接住錯、寫入前再確認一次。
 */
import type { Card } from '@contracts/index.js';
import { credentialMessage, credentialProblem, type CredentialProblem } from '@core/llm/credentials.js';
import { MissingCredentialError } from '@core/llm/errors.js';
import type { LlmRouter as GradingRouter } from '@core/grading/index.js';
import type { LlmRouter } from '@core/llm/index.js';
import { commitDeepen, generateDeepen, type GenerateDeepenResult } from '../ingest/deepen.js';
import { ERROR_MESSAGES, type ErrorKind } from './protocol.js';
import { createTeachRuntime, type TeachView } from './teach.js';

type TeachRuntime = ReturnType<typeof createTeachRuntime>;

export type DeepenOutcome =
  | { ok: true; view: TeachView }
  | { ok: false; kind: ErrorKind; message?: string };

interface Job {
  id: number;
  cancelled: boolean;
  running: boolean;
}

export interface DeepenControllerDeps {
  learningDir: string;
  today(): string;
  env: NodeJS.ProcessEnv;
  teach: TeachRuntime;
  missingKeys?: (() => readonly string[]) | undefined;
  /**
   * 重讀 .env(內容變了就丟掉舊 router)然後拿 router。
   * 失敗丟 ReviewStartError 或帶 kind 的錯。
   */
  acquireRouter(): Promise<GradingRouter>;
  /** acquireRouter 失敗時的種類。其他例外當 internal。 */
  startFailureKind(err: unknown): 'root-mismatch' | 'router-unavailable' | 'internal';
}

export interface DeepenController {
  deepen(): Promise<DeepenOutcome>;
  poll(): DeepenOutcome;
  cancel(): DeepenOutcome;
  back(): DeepenOutcome;
  /** 生成中為 true。teach.open 要先放棄工作再照舊開。 */
  running(): boolean;
  /** 把進行中的工作當成取消。不等手上的呼叫。 */
  shutdown(): void;
  abandon(): void;
}

function withGenerating(view: TeachView, generating: boolean): TeachView {
  return { ...view, generating };
}

export function createDeepenController(deps: DeepenControllerDeps): DeepenController {
  const { teach } = deps;
  let seq = 0;
  let active: Job | undefined;
  let pending: { kind: ErrorKind; message: string } | undefined;

  function current(generating: boolean): TeachView {
    return withGenerating(teach.view(), generating);
  }

  function isCurrent(job: Job): boolean {
    return active === job && !job.cancelled;
  }

  function failJob(job: Job, kind: ErrorKind, message?: string): void {
    if (!isCurrent(job)) return;
    job.running = false;
    pending = { kind, message: message ?? ERROR_MESSAGES[kind] };
  }

  function credentialLine(problem: CredentialProblem): { kind: 'credential-unavailable'; message: string } {
    return { kind: 'credential-unavailable', message: credentialMessage(problem, 'deepen') };
  }

  async function runJob(job: Job, parent: Card, router: GradingRouter): Promise<void> {
    try {
      const generated: GenerateDeepenResult = await generateDeepen({
        parent,
        // 側車的 router 是 05 的型別(多一個 fake provider);呼叫面與 03 的相同。
        router: router as unknown as LlmRouter,
        learningDir: deps.learningDir,
        today: deps.today(),
        env: deps.env,
        shouldStop: () => !isCurrent(job),
      });
      if (!isCurrent(job)) return;
      if (generated.kind === 'stopped') return;
      if (generated.kind === 'no-model') {
        failJob(job, 'no-model');
        return;
      }
      if (generated.kind === 'failed') {
        failJob(job, 'deepen-failed');
        return;
      }
      if (generated.kind === 'credential') {
        const line = credentialLine(generated.problem);
        failJob(job, line.kind, line.message);
        return;
      }
      if (!isCurrent(job)) return;
      const committed = commitDeepen({
        learningDir: deps.learningDir,
        parentId: parent.frontmatter.id,
        category: parent.frontmatter.category,
        cards: generated.cards,
        skipped: generated.skipped,
      });
      if (!isCurrent(job)) return;
      if (!committed.ok) {
        failJob(job, 'deepen-failed');
        return;
      }
      teach.enterChildren(parent.frontmatter.id, committed.ids);
      if (active === job) job.running = false;
    } catch {
      failJob(job, 'deepen-failed');
    }
  }

  function abandon(): void {
    if (active?.running) {
      active.cancelled = true;
      active.running = false;
    }
  }

  return {
    running: () => active?.running === true,

    abandon,

    shutdown(): void {
      if (active) {
        active.cancelled = true;
        active.running = false;
      }
      active = undefined;
      pending = undefined;
    },

    async deepen(): Promise<DeepenOutcome> {
      if (active?.running) return { ok: true, view: current(true) };
      const prep = teach.prepareDeepen();
      if (prep.action === 'bad-request') return { ok: false, kind: 'bad-request' };
      if (prep.action === 'floor') return { ok: false, kind: 'deepen-floor' };
      if (prep.action === 'reuse') return { ok: true, view: prep.view };
      let router: GradingRouter;
      try {
        router = await deps.acquireRouter();
      } catch (err) {
        return { ok: false, kind: deps.startFailureKind(err) };
      }
      if (deps.missingKeys !== undefined) {
        const missing = deps.missingKeys();
        const first = missing[0];
        if (first !== undefined) {
          const problem = credentialProblem(new MissingCredentialError(first), deps.env);
          if (problem !== undefined) return { ok: false, kind: 'credential-unavailable', message: credentialMessage(problem, 'deepen') };
          return { ok: false, kind: 'credential-unavailable' };
        }
      }
      pending = undefined;
      const job: Job = { id: (seq += 1), cancelled: false, running: true };
      active = job;
      void runJob(job, prep.parent, router).catch(() => {
        failJob(job, 'deepen-failed');
      });
      return { ok: true, view: current(true) };
    },

    poll(): DeepenOutcome {
      if (pending && active?.running !== true) {
        const err = pending;
        pending = undefined;
        if (active && !active.running) active = undefined;
        return { ok: false, kind: err.kind, message: err.message };
      }
      if (active?.running) return { ok: true, view: current(true) };
      return { ok: true, view: current(false) };
    },

    cancel(): DeepenOutcome {
      abandon();
      return { ok: true, view: current(false) };
    },

    back(): DeepenOutcome {
      if (active?.running) return { ok: false, kind: 'bad-request' };
      const outcome = teach.back();
      if (!outcome.ok) return outcome;
      return { ok: true, view: outcome.view };
    },
  };
}
