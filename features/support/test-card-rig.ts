/**
 * T24 紅測試共用的「程序內真 core」接法:考試卡的 TestSession ← ReviewClient(handler 模式)← createReviewHandler ← 暫存根。
 * vitest(`apps/test-card/src/session-core.test.ts`)與 cucumber(`features/steps/test-card*.steps.ts`)共用。
 * 紅測試作者寫;開發 worker 不改。
 *
 * 只有佈置與觀測:不算題目、不算排程、不批改——那些全是真的 core 在做。
 * 路由器是程序內的假物件(用 `_i2-cloud-script.ts` 的 scriptedApplyReply 回應應用題;沒有本機模型),不打網路。
 * 全部用暫存目錄(learning、XDG_*、HOME 同一個 mkdtemp),不碰真的 learning/ 與真的 ~/.cache。
 * TestSession 還沒改好:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReviewClient, type ReviewClient } from '../../apps/desktop/src/webview/review-client.js';
import { createReviewHandler } from '../../packages/core/src/session/handler.js';
import { scriptedApplyReply } from '../steps/_i2-cloud-script.js';
import { NoModelError } from '../../packages/core/src/llm/errors.js';
import { TODAY, addDays, createVault, gitInit, removeVault, reviewRecord, runReview, writeReviews, type ReviewRecord, type Vault } from './review-session-harness.js';

export { TODAY };

const ROOT = join(import.meta.dirname, '../..');
const SESSION_MODULE = pathToFileURL(join(ROOT, 'apps/test-card/src/session.ts')).href;

export type Obj = Record<string, unknown>;

/** 測試對 TestSession 的期待(欄位名見 apps/test-card/src/session.test.ts 檔頭) */
export interface View {
  state: string;
  message: string | undefined;
  canRestart: boolean;
  canRetry: boolean;
  testModeNotice: string | undefined;
  answeredCount: number;
  totalCount: number;
  overdueCount: number;
  summaryLines: string[];
  current: { card: string; type: 'fill' | 'apply'; stage: number; prompt: string; blanks: number; stuck: boolean; overdueDays: number } | undefined;
  submitting: boolean;
  gradingError: string | undefined;
  result: { status: string; pass: boolean | null; feedback: string; cardDone: boolean; correctAnswers?: string[] } | undefined;
  reteach: { card: string; text: string; notice: string | undefined } | undefined;
}

export interface Session {
  init(): Promise<void>;
  next(): Promise<void>;
  submitFill(answers: string[]): Promise<void>;
  submitApply(text: string): Promise<void>;
  decideKeydown(key: string, mods?: { ctrl?: boolean; meta?: boolean }): 'submit' | 'newline' | 'ignore';
  getView(): View;
}

export interface Fs {
  read(relPath: string): Promise<string>;
}

export interface FakeRouter {
  /** 被問了幾次(任何 task) */
  calls: number;
  /** 被問了幾次 grade.apply */
  applyCalls: number;
  call(task: string, prompt: string): Promise<unknown>;
  probeOnline(): Promise<boolean>;
  probeLocal(): Promise<unknown>;
}

export function fakeRouter(): FakeRouter {
  const r: FakeRouter = {
    calls: 0,
    applyCalls: 0,
    async call(task: string, prompt: string): Promise<unknown> {
      r.calls += 1;
      if (task !== 'grade.apply') throw new NoModelError(task);
      r.applyCalls += 1;
      return { text: scriptedApplyReply(prompt), provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false };
    },
    async probeOnline(): Promise<boolean> {
      return true;
    },
    async probeLocal(): Promise<unknown> {
      return { available: false, models: [] };
    },
  };
  return r;
}

export function envOf(v: Vault, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, HOME: v.home, XDG_CACHE_HOME: v.xdgCache, XDG_CONFIG_HOME: v.xdgConfig, LC_REVIEW_FAKE_CLOUD: undefined, LC_REVIEW_TODAY: undefined, ...extra };
}

export type SeedEntry = { stage: number; overdue?: number } & Partial<ReviewRecord>;

/** `today` 是「逾期幾天」的基準日,預設 TODAY。 */
export function seed(v: Vault, entries: Record<string, SeedEntry>, today: string = TODAY): void {
  const reviews: Record<string, ReviewRecord> = {};
  for (const [id, e] of Object.entries(entries)) {
    const { stage, overdue, ...rest } = e;
    reviews[id] = reviewRecord({ ...rest, stage, next_due: addDays(today, -(overdue ?? 1)) });
  }
  writeReviews(v, reviews);
}

/** 預設:五張 stage 1,逾期 5、1、3、0、2 天 → 04 排出來的順序是 0001、0003、0005、0002、0004 */
export const DEFAULT_FIVE: Record<string, SeedEntry> = {
  'sec-0001': { stage: 1, overdue: 5 },
  'sec-0002': { stage: 1, overdue: 1 },
  'sec-0003': { stage: 1, overdue: 3 },
  'sec-0004': { stage: 1, overdue: 0 },
  'sec-0005': { stage: 1, overdue: 2 },
};
export const DEFAULT_FIVE_ORDER = ['sec-0001', 'sec-0003', 'sec-0005', 'sec-0002', 'sec-0004'];

/** 桌面版 LearningFs 的替身:只能 read,讀暫存根(learning)底下的相對路徑;路徑檢查是 Rust 的事,不在這裡 */
export function vaultFs(v: Vault): Fs & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async read(relPath: string): Promise<string> {
      reads.push(relPath);
      return readFileSync(join(v.dir, relPath), 'utf8');
    },
  };
}

export interface RecordedCall {
  method: string;
  arg?: unknown;
}

/** 包一層 client,記下每次呼叫(方法與參數) */
export function spyClient(inner: ReviewClient): { client: ReviewClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: ReviewClient = {
    start: () => (calls.push({ method: 'start' }), inner.start()),
    next: () => (calls.push({ method: 'next' }), inner.next()),
    submit: (answer) => (calls.push({ method: 'submit', arg: answer }), inner.submit(answer)),
    summary: () => (calls.push({ method: 'summary' }), inner.summary()),
    status: () => (calls.push({ method: 'status' }), inner.status()),
  };
  return { client, calls };
}

export async function makeSession(client: ReviewClient, fs: Fs): Promise<Session> {
  const mod = (await import(/* @vite-ignore */ SESSION_MODULE)) as { TestSession?: new (deps: { client: ReviewClient; fs: Fs }) => Session };
  if (typeof mod.TestSession !== 'function') throw new Error('apps/test-card/src/session.ts 沒有匯出 TestSession');
  return new mod.TestSession({ client, fs });
}

export interface Rig {
  vault: Vault;
  router: FakeRouter;
  /** 目前這個「視窗」用的 client(包了記錄) */
  client: ReviewClient;
  calls: RecordedCall[];
  fs: ReturnType<typeof vaultFs>;
  session: Session;
  env: NodeJS.ProcessEnv;
  /** 再開一個全新的 handler + client + TestSession(像關掉重開 app:側車重起,記憶體裡的東西都沒了)。`today` 不給就沿用建立時的那天。 */
  reopen(today?: string): Promise<{ session: Session; client: ReviewClient; calls: RecordedCall[]; router: FakeRouter }>;
  dispose(): void;
}

export interface RigOpts {
  cards?: number;
  entries?: Record<string, SeedEntry>;
  env?: NodeJS.ProcessEnv;
  git?: boolean;
  /** 不佈置 reviews.json(用 fixture 原樣) */
  noSeed?: boolean;
  /** 這個 handler 的「今天」,預設 TODAY(T23:跨日場景用前一天起手) */
  today?: string;
  /** daily_cap(settings.yaml);預設 fixture 的 10 */
  dailyCap?: number;
}

export async function createRig(opts: RigOpts = {}): Promise<Rig> {
  const vault = createVault({ cards: opts.cards ?? 6, ...(opts.dailyCap !== undefined ? { dailyCap: opts.dailyCap } : {}) });
  const baseToday = opts.today ?? TODAY;
  if (!opts.noSeed) seed(vault, opts.entries ?? DEFAULT_FIVE, baseToday);
  if (opts.git) gitInit(vault);
  const env = envOf(vault, opts.env);
  const fs = vaultFs(vault);

  async function open(today: string = baseToday): Promise<{ session: Session; client: ReviewClient; calls: RecordedCall[]; router: FakeRouter }> {
    const router = fakeRouter();
    const handler = createReviewHandler({ learningDir: vault.dir, today, routerFactory: () => router, env });
    const spy = spyClient(createReviewClient({ handler }));
    const session = await makeSession(spy.client, fs);
    return { session, client: spy.client, calls: spy.calls, router };
  }

  const first = await open();
  return {
    vault,
    router: first.router,
    client: first.client,
    calls: first.calls,
    fs,
    session: first.session,
    env,
    reopen: open,
    dispose: () => removeVault(vault),
  };
}

// ---------------------------------------------------------------- 走一輪

/** 一個通用作答:填空每格填 'x'(會錯),應用題填含 PASSALL 標記的文字(會過) */
export async function answerCurrent(session: Session): Promise<void> {
  const cur = session.getView().current;
  if (!cur) throw new Error(`現在沒有題目:${JSON.stringify(session.getView())}`);
  if (cur.type === 'fill') await session.submitFill(Array.from({ length: cur.blanks }, () => 'x'));
  else await session.submitApply('PASSALL 我的回答');
}

/** 一直答到 done 或離開題目狀態;回傳依序看到的卡(同一張卡兩題只算一次連續出現) */
export async function walkToEnd(session: Session, limit = 50): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    const v = session.getView();
    if (v.state === 'reteach') {
      await session.next();
      continue;
    }
    if (v.state !== 'question') break;
    const card = v.current!.card;
    if (seen[seen.length - 1] !== card) seen.push(card);
    await answerCurrent(session);
    await session.next();
  }
  return seen;
}

/** 終端機那邊看到的清單:真的跑 `scripts/review.ts --dry-run`(假網路層,不評分),依序回卡 id */
export async function terminalDueCards(vault: Vault): Promise<string[]> {
  const out = await runReview(vault, { args: ['--dry-run'] });
  if (out.status !== 0) throw new Error(`review.ts --dry-run 失敗(${out.status}):\n${out.output}`);
  return out.stdout
    .split('\n')
    .map((l) => /^(sec-\d{4})\s+stage\s+\d/.exec(l)?.[1])
    .filter((id): id is string => id !== undefined);
}
