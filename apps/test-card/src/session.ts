/**
 * 考試卡的互動邏輯,純 TypeScript、不依賴 Svelte。
 *
 * 為什麼要拆出來:App.svelte 用 runes,但 cucumber 用 tsx 直接跑 .ts,不會過 Svelte
 * 編譯器,沒辦法 import 用 $state 的檔案。判斷(排程、批改、寫複習紀錄)在側車;
 * 這裡只把 ReviewClient 的結果收窄成畫面、收輸入。
 */
import { ReviewError, type ReviewClient } from '../../desktop/src/webview/review-client.js';
import type { LearningFs } from '../../desktop/src/webview/learning-fs.js';
import type { KeydownAction, QuestionView, ReteachView, ResultView, SessionState, SessionView } from './types.js';

export type { KeydownAction, SessionView } from './types.js';

export interface SessionDeps {
  client: ReviewClient;
  fs: Pick<LearningFs, 'read'>;
}

const PAUSED_MESSAGE = '今天已暫停。要繼續,在終端機執行 npx tsx scripts/review.ts --dir <learning 目錄> --today <今天> --unpause。';
const EMPTY_MESSAGE = '今天沒有到期的複習,休息一下。';
const DONE_MESSAGE = '今天的複習都做完了。';
const STOPPED_MESSAGE = '複習程式停了。';
const NO_CARDS_MESSAGE = '掃描到 0 張卡 —— 這個 learning 資料夾沒有卡片。';
const ROUTER_MESSAGE = '帳本身分驗不過,批改不能用。請在終端機執行 npx tsx scripts/vault.ts show 看原因。';
const VAULT_HINT = '請在終端機執行 npx tsx scripts/vault.ts show 看原因。';
const RETRY_HINT = '改好之後按「再試一次」。';
const GRADING_ERROR = '評分失敗,請再試一次';
const TEST_MODE_NOTICE = '測試模式:批改是假的';
const SHORT_NOTICE = '這張卡連續答錯兩次;縮短版還沒有產生,先看原卡。';

type Obj = Record<string, unknown>;

function isRecord(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

interface StartView {
  state: 'ready' | 'paused' | 'empty';
  fakeCloud: boolean;
  overdue: number;
}

/** 缺必要欄位就回 undefined,呼叫端當 bad-response。不補預設值。 */
function readStart(raw: Obj): StartView | undefined {
  const state = raw.state;
  if (state !== 'ready' && state !== 'paused' && state !== 'empty') return undefined;
  if (typeof raw.today !== 'string') return undefined;
  if (typeof raw.resumed !== 'boolean') return undefined;
  if (!isFiniteNumber(raw.total)) return undefined;
  if (!isFiniteNumber(raw.answered)) return undefined;
  if (!isFiniteNumber(raw.deferred)) return undefined;
  if (!isFiniteNumber(raw.dailyCap)) return undefined;
  if (!isFiniteNumber(raw.overdue)) return undefined;
  if (typeof raw.fakeCloud !== 'boolean') return undefined;
  return { state, fakeCloud: raw.fakeCloud, overdue: raw.overdue };
}

interface NextQuestion {
  kind: 'question';
  card: string;
  stage: number;
  type: 'fill' | 'apply';
  prompt: string;
  index: number;
  total: number;
  stuck: boolean;
  overdueDays: number;
  blanks: number;
}

interface NextReteach {
  kind: 'reteach';
  card: string;
  path: string;
  short: boolean;
}

type NextView = NextQuestion | NextReteach | { kind: 'done' };

function readProgress(value: unknown): { index: number; total: number } | undefined {
  if (!isRecord(value)) return undefined;
  if (!isFiniteNumber(value.index) || !isFiniteNumber(value.total)) return undefined;
  return { index: value.index, total: value.total };
}

function readNext(raw: Obj): NextView | undefined {
  if (raw.kind === 'done') return { kind: 'done' };
  if (raw.kind === 'reteach') {
    if (typeof raw.card !== 'string' || typeof raw.path !== 'string' || typeof raw.short !== 'boolean') return undefined;
    return { kind: 'reteach', card: raw.card, path: raw.path, short: raw.short };
  }
  if (raw.kind !== 'question') return undefined;
  if (typeof raw.card !== 'string' || typeof raw.prompt !== 'string') return undefined;
  if (!isFiniteNumber(raw.stage)) return undefined;
  if (raw.type !== 'fill' && raw.type !== 'apply') return undefined;
  if (typeof raw.stuck !== 'boolean' || !isFiniteNumber(raw.overdueDays)) return undefined;
  const progress = readProgress(raw.progress);
  if (!progress) return undefined;
  if (raw.type === 'fill') {
    if (!isFiniteNumber(raw.blanks)) return undefined;
    return {
      kind: 'question',
      card: raw.card,
      stage: raw.stage,
      type: 'fill',
      prompt: raw.prompt,
      index: progress.index,
      total: progress.total,
      stuck: raw.stuck,
      overdueDays: raw.overdueDays,
      blanks: raw.blanks,
    };
  }
  return {
    kind: 'question',
    card: raw.card,
    stage: raw.stage,
    type: 'apply',
    prompt: raw.prompt,
    index: progress.index,
    total: progress.total,
    stuck: raw.stuck,
    overdueDays: raw.overdueDays,
    blanks: 0,
  };
}

interface SubmitView {
  status: 'passed' | 'failed' | 'partial' | 'error';
  pass: boolean | null;
  feedback: string;
  cardDone: boolean;
  correctAnswers?: string[];
}

function readSubmit(raw: Obj): SubmitView | undefined {
  const status = raw.status;
  if (status !== 'passed' && status !== 'failed' && status !== 'partial' && status !== 'error') return undefined;
  if (typeof raw.feedback !== 'string' || typeof raw.cardDone !== 'boolean') return undefined;
  if (status === 'error') {
    if (raw.pass !== null) return undefined;
  } else if (typeof raw.pass !== 'boolean') {
    return undefined;
  }
  const view: SubmitView = { status, pass: raw.pass, feedback: raw.feedback, cardDone: raw.cardDone };
  if (raw.correctAnswers !== undefined) {
    if (!isStringArray(raw.correctAnswers)) return undefined;
    view.correctAnswers = raw.correctAnswers;
  }
  return view;
}

interface TomorrowView {
  total: number;
  capped: boolean;
  shown: number;
  overflow: number;
}

interface SummaryView {
  passed: number;
  returned: number;
  retryLater: number;
  tomorrow: TomorrowView;
  snapshot: string;
  answeredThisRun?: number;
}

function readTomorrow(value: unknown): TomorrowView | undefined {
  if (!isRecord(value)) return undefined;
  if (!isFiniteNumber(value.total) || typeof value.capped !== 'boolean') return undefined;
  if (!isFiniteNumber(value.shown) || !isFiniteNumber(value.overflow)) return undefined;
  return { total: value.total, capped: value.capped, shown: value.shown, overflow: value.overflow };
}

/** summary 缺必要欄位就回 undefined,呼叫端當 bad-response。answeredThisRun 可缺,有的話必須是有限數字。 */
function readSummary(raw: Obj): SummaryView | undefined {
  if (!isFiniteNumber(raw.passed) || !isFiniteNumber(raw.returned) || !isFiniteNumber(raw.retryLater)) return undefined;
  const tomorrow = readTomorrow(raw.tomorrow);
  if (!tomorrow) return undefined;
  if (typeof raw.snapshot !== 'string') return undefined;
  const view: SummaryView = {
    passed: raw.passed,
    returned: raw.returned,
    retryLater: raw.retryLater,
    tomorrow,
    snapshot: raw.snapshot,
  };
  if (raw.answeredThisRun !== undefined) {
    if (!isFiniteNumber(raw.answeredThisRun)) return undefined;
    view.answeredThisRun = raw.answeredThisRun;
  }
  return view;
}

/** 小結句子。第一句「今天的複習都做完了。」在 message,不在這裡。 */
function summaryLinesOf(summary: SummaryView): string[] {
  const lines = [`通過 ${summary.passed} 張、退回 ${summary.returned} 張。`];
  if (summary.retryLater > 0) lines.push(`另有 ${summary.retryLater} 題評分失敗,下次再考。`);
  if (summary.tomorrow.capped) {
    lines.push(`明天預估 ${summary.tomorrow.shown} 張(已到每天上限,另 ${summary.tomorrow.overflow} 張順延)。`);
  } else {
    lines.push(`明天預估 ${summary.tomorrow.shown} 張。`);
  }
  return lines;
}

function reviewOf(err: unknown): { kind: string; message: string } | undefined {
  if (err instanceof ReviewError) return { kind: err.kind, message: err.message };
  if (!(err instanceof Error) || err.name !== 'ReviewError') return undefined;
  const kind = (err as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || kind.length === 0) return undefined;
  return { kind, message: err.message };
}

/** 第一行是 --- 時,去掉到下一個只有 --- 的行(含)為止。內文後來的 --- 留著。 */
export function stripFrontmatter(text: string): string {
  const lines = text.split('\n');
  const first = lines[0];
  if (first !== '---') return text;
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      end = i;
      break;
    }
  }
  if (end < 0) return text;
  return lines.slice(end + 1).join('\n');
}

export class TestSession {
  private phase: SessionState = 'loading';
  private message: string | undefined;
  private canRestart = false;
  private canRetry = false;
  private testModeNotice: string | undefined;
  private answeredCount = 0;
  private totalCount = 0;
  private overdueCount = 0;
  private summaryLines: string[] = [];
  private question: QuestionView | undefined;
  private submitting = false;
  private gradingError: string | undefined;
  private result: ResultView | undefined;
  private reteach: ReteachView | undefined;

  constructor(private readonly deps: SessionDeps) {}

  decideKeydown(key: string, mods: { ctrl?: boolean; meta?: boolean } = {}): KeydownAction {
    if (key !== 'Enter') return 'ignore';
    if (this.phase !== 'question' || this.question === undefined) return 'ignore';
    if (this.question.type === 'fill') return 'submit';
    if (mods.ctrl === true) return 'submit';
    if (mods.meta === true) return 'submit';
    return 'newline';
  }

  async init(): Promise<void> {
    this.phase = 'loading';
    this.message = undefined;
    this.canRestart = false;
    this.canRetry = false;
    this.testModeNotice = undefined;
    this.overdueCount = 0;
    this.summaryLines = [];
    this.clearCard();
    try {
      const raw = await this.deps.client.start();
      const start = readStart(raw);
      if (!start) {
        this.showStopped();
        return;
      }
      this.overdueCount = start.overdue;
      if (start.fakeCloud) this.testModeNotice = TEST_MODE_NOTICE;
      else this.testModeNotice = undefined;
      if (start.state === 'paused') {
        this.showPaused();
        return;
      }
      if (start.state === 'empty') {
        this.clearCard();
        this.phase = 'empty';
        this.message = EMPTY_MESSAGE;
        return;
      }
      await this.pullNext();
    } catch (err) {
      this.showError(err);
    }
  }

  /** 「下一題」與 reteach 的「繼續」共用:再問側車下一個要顯示的東西。 */
  async next(): Promise<void> {
    if (this.phase !== 'reteach' && !(this.phase === 'question' && this.result !== undefined)) return;
    await this.pullNext();
  }

  async submitFill(answers: string[]): Promise<void> {
    if (this.phase !== 'question' || this.question?.type !== 'fill') return;
    await this.submit({ fill: answers });
  }

  async submitApply(text: string): Promise<void> {
    if (this.phase !== 'question' || this.question?.type !== 'apply') return;
    await this.submit({ apply: text });
  }

  getView(): SessionView {
    const onQuestion = this.phase === 'question';
    return {
      state: this.phase,
      message: this.message,
      canRestart: this.canRestart,
      canRetry: this.canRetry,
      testModeNotice: this.testModeNotice,
      answeredCount: onQuestion ? this.answeredCount : 0,
      totalCount: onQuestion ? this.totalCount : 0,
      overdueCount: onQuestion ? this.overdueCount : 0,
      summaryLines: this.phase === 'done' ? this.summaryLines : [],
      current: onQuestion ? this.question : undefined,
      submitting: this.submitting,
      gradingError: this.gradingError,
      result: this.result,
      reteach: this.phase === 'reteach' ? this.reteach : undefined,
    };
  }

  private async submit(answer: { fill: string[] } | { apply: string }): Promise<void> {
    this.submitting = true;
    this.gradingError = undefined;
    try {
      const raw = await this.deps.client.submit(answer);
      const graded = readSubmit(raw);
      if (!graded) {
        this.showStopped();
        return;
      }
      if (graded.status === 'error') {
        this.gradingError = GRADING_ERROR;
        this.result = undefined;
        return;
      }
      const result: ResultView = {
        status: graded.status,
        pass: graded.pass,
        feedback: graded.feedback,
        cardDone: graded.cardDone,
      };
      if (graded.correctAnswers !== undefined) result.correctAnswers = graded.correctAnswers;
      this.result = result;
      this.gradingError = undefined;
    } catch (err) {
      this.showError(err);
    } finally {
      this.submitting = false;
    }
  }

  private async pullNext(): Promise<void> {
    try {
      const raw = await this.deps.client.next();
      const next = readNext(raw);
      if (!next) {
        this.showStopped();
        return;
      }
      if (next.kind === 'done') {
        let rawSummary: Obj;
        try {
          rawSummary = await this.deps.client.summary();
        } catch (err) {
          this.showError(err);
          return;
        }
        const summary = readSummary(rawSummary);
        if (!summary) {
          this.showStopped();
          return;
        }
        this.clearCard();
        this.phase = 'done';
        this.message = DONE_MESSAGE;
        this.summaryLines = summaryLinesOf(summary);
        return;
      }
      if (next.kind === 'reteach') {
        let text: string;
        try {
          text = stripFrontmatter(await this.deps.fs.read(next.path));
        } catch {
          this.showStopped();
          return;
        }
        this.clearCard();
        this.phase = 'reteach';
        this.message = undefined;
        this.reteach = {
          card: next.card,
          text,
          notice: next.short ? undefined : SHORT_NOTICE,
        };
        return;
      }
      this.clearCard();
      this.phase = 'question';
      this.message = undefined;
      this.answeredCount = next.index - 1;
      this.totalCount = next.total;
      this.question = {
        card: next.card,
        type: next.type,
        stage: next.stage,
        prompt: next.prompt,
        blanks: next.blanks,
        stuck: next.stuck,
        overdueDays: next.overdueDays,
      };
    } catch (err) {
      this.showError(err);
    }
  }

  private clearCard(): void {
    this.question = undefined;
    this.result = undefined;
    this.reteach = undefined;
    this.gradingError = undefined;
    this.answeredCount = 0;
    this.totalCount = 0;
  }

  private showPaused(): void {
    this.clearCard();
    this.phase = 'paused';
    this.message = PAUSED_MESSAGE;
    this.canRestart = false;
    this.canRetry = false;
  }

  private showStopped(): void {
    this.clearCard();
    this.phase = 'error';
    this.message = STOPPED_MESSAGE;
    this.canRestart = true;
    this.canRetry = false;
  }

  /** 啟動就能修好的四種:句子照舊,加「再試一次」,不給「重新開始」,也不說複習程式停了。 */
  private showRetry(message: string): void {
    this.phase = 'error';
    this.message = `${message}${RETRY_HINT}`;
    this.canRestart = false;
    this.canRetry = true;
  }

  private showError(err: unknown): void {
    const review = reviewOf(err);
    if (review === undefined) {
      this.showStopped();
      return;
    }
    if (review.kind === 'paused') {
      this.showPaused();
      return;
    }
    this.clearCard();
    this.phase = 'error';
    if (review.kind === 'no-cards') {
      this.showRetry(NO_CARDS_MESSAGE);
      return;
    }
    if (review.kind === 'router-unavailable') {
      this.showRetry(ROUTER_MESSAGE);
      return;
    }
    if (review.kind === 'review-record-changed') {
      this.message = review.message;
      this.canRestart = true;
      this.canRetry = false;
      return;
    }
    if (review.kind === 'root-mismatch' || review.kind === 'not-configured') {
      this.showRetry(`${review.message}${VAULT_HINT}`);
      return;
    }
    this.message = STOPPED_MESSAGE;
    this.canRestart = true;
    this.canRetry = false;
  }
}
