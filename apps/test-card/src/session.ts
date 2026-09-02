/**
 * 考試卡的互動邏輯,純 TypeScript、不依賴 Svelte。
 *
 * 為什麼要拆出來:App.svelte 用 runes,但 cucumber 用 tsx 直接跑 .ts,不會過 Svelte
 * 編譯器,沒辦法 import 用 $state 的檔案。判斷邏輯留在這裡,App.svelte 只是拿這裡的
 * 資料畫面、呼叫這裡的方法——符合 FEATURE.md「判斷都在 core,這裡只顯示與收輸入」的精神,
 * 只是 06 自己的輸入邏輯還沒資格進 packages/core,先留在 apps/test-card。
 */
import type {
  ApplyQuestion,
  CardId,
  CurrentQuestion,
  DueItem,
  FillQuestion,
  GradeResult,
  IsoDate,
  QuestionFile,
  QuestionType,
  Review,
  SchedulerAdvanceFn,
} from './types.js';

export interface Grader {
  gradeFill(question: FillQuestion, typed: string[]): Promise<GradeResult>;
  gradeApply(question: ApplyQuestion, typed: string): Promise<GradeResult>;
}

export interface SessionDeps {
  due: DueItem[];
  questions: Record<CardId, QuestionFile>;
  grader: Grader;
  advance: SchedulerAdvanceFn;
  today: IsoDate;
}

export type KeydownAction = 'submit' | 'newline' | 'ignore';

export interface SessionView {
  totalCount: number;
  answeredCount: number;
  isEmpty: boolean;
  done: boolean;
  current: CurrentQuestion | undefined;
  submitting: boolean;
  error: string | undefined;
  result: GradeResult | undefined;
  /** 只有填空題答錯時才有值:每個空格可接受的第一個寫法,給畫面顯示正確答案 */
  correctAnswers: string[] | undefined;
}

/** 一個到期項目裡,兩種題型都答完之前不套用排程轉移的暫存結果 */
interface PendingResult {
  type: QuestionType;
  result: GradeResult;
}

export class TestSession {
  private index = 0;
  private subIndex = 0;
  private answeredCount = 0;
  private submitting = false;
  private error: string | undefined;
  private result: GradeResult | undefined;
  private pending: PendingResult[] = [];
  private done = false;

  constructor(private readonly deps: SessionDeps) {}

  private get currentDue(): DueItem | undefined {
    return this.deps.due[this.index];
  }

  get currentQuestion(): CurrentQuestion | undefined {
    const due = this.currentDue;
    if (!due) return undefined;
    const qf = this.deps.questions[due.card];
    if (!qf) return undefined;
    const type = due.types[this.subIndex] ?? due.types[0];
    if (type === 'apply') {
      const apply = qf.apply[0];
      return apply ? { card: due.card, type: 'apply', apply } : undefined;
    }
    const fill = qf.fill[0];
    return fill ? { card: due.card, type: 'fill', fill } : undefined;
  }

  /** Enter 鍵的行為:填空送出;應用題換行,除非按了 ctrl/cmd 修飾鍵才送出 */
  decideKeydown(key: string, mods: { ctrl?: boolean; meta?: boolean } = {}): KeydownAction {
    if (key !== 'Enter') return 'ignore';
    const q = this.currentQuestion;
    if (!q) return 'ignore';
    if (q.type === 'fill') return 'submit';
    return mods.ctrl || mods.meta ? 'submit' : 'newline';
  }

  async submitFill(typedAnswers: string[]): Promise<void> {
    const q = this.currentQuestion;
    if (!q || q.type !== 'fill' || !q.fill) throw new Error('目前不是填空題');
    await this.submit(q.fill.prompt, () => this.deps.grader.gradeFill(q.fill!, typedAnswers), 'fill');
  }

  async submitApply(typedAnswer: string): Promise<void> {
    const q = this.currentQuestion;
    if (!q || q.type !== 'apply' || !q.apply) throw new Error('目前不是應用題');
    await this.submit(q.apply.prompt, () => this.deps.grader.gradeApply(q.apply!, typedAnswer), 'apply');
  }

  private async submit(_prompt: string, run: () => Promise<GradeResult>, type: QuestionType): Promise<void> {
    this.submitting = true;
    this.error = undefined;
    try {
      const result = await run();
      this.result = result;
      if (result.grader === 'error' || result.pass === null) {
        this.error = '評分失敗,請再試一次';
        return;
      }
      this.pending.push({ type, result });
    } finally {
      this.submitting = false;
    }
  }

  /** 按下下一題:同一張卡還有沒答的題型就先換題型;都答完才套用排程轉移、往下一張卡走 */
  next(): void {
    const due = this.currentDue;
    if (!due) return;

    const isLastSubtype = this.subIndex >= due.types.length - 1;
    if (!isLastSubtype) {
      this.subIndex += 1;
      this.result = undefined;
      this.error = undefined;
      return;
    }

    const passAll = this.pending.length > 0 && this.pending.every((p) => p.result.pass === true);
    const lastType = due.types[due.types.length - 1] ?? 'fill';
    const fauxReview: Review = {
      stage: due.stage,
      learned_at: this.deps.today,
      next_due: this.deps.today,
      fails_in_row: 0,
      total_fails: 0,
      stuck: due.stuck,
      history: [],
    };
    this.deps.advance(fauxReview, { today: this.deps.today, pass: passAll, type: lastType });

    this.pending = [];
    this.result = undefined;
    this.error = undefined;
    this.subIndex = 0;
    this.answeredCount += 1;
    this.index += 1;
    if (this.index >= this.deps.due.length) this.done = true;
  }

  getView(): SessionView {
    const current = this.currentQuestion;
    let correctAnswers: string[] | undefined;
    if (current?.type === 'fill' && current.fill && this.result && this.result.pass === false) {
      correctAnswers = current.fill.answers.map((options) => options[0] ?? '');
    }
    return {
      totalCount: this.deps.due.length,
      answeredCount: this.answeredCount,
      isEmpty: this.deps.due.length === 0,
      done: this.done,
      current,
      submitting: this.submitting,
      error: this.error,
      result: this.result,
      correctAnswers,
    };
  }
}
