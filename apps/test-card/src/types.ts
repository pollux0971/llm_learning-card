/**
 * 考試卡的畫面型別(ADR-075)。
 *
 * 側車的 start / next / submit / summary 回的是 Record,沒有匯出結果型別。
 * session.ts 用讀取函式收窄成這裡的形狀;缺必要欄位就當 bad-response,不在這裡補值。
 */

export type SessionState = 'loading' | 'paused' | 'empty' | 'question' | 'reteach' | 'done' | 'error';

export type KeydownAction = 'submit' | 'newline' | 'ignore';

/** 畫面上的一題。填空的輸入格數是 blanks;應用題固定 0。 */
export interface QuestionView {
  card: string;
  type: 'fill' | 'apply';
  stage: number;
  prompt: string;
  blanks: number;
  stuck: boolean;
  overdueDays: number;
}

/** 送出得到 passed / failed / partial 之後,到按「下一題」之前。 */
export interface ResultView {
  status: string;
  pass: boolean | null;
  feedback: string;
  cardDone: boolean;
  correctAnswers?: string[];
}

/** 縮短版。text 是去掉開頭 frontmatter 的純文字;notice 只有 short 為 false 時有。 */
export interface ReteachView {
  card: string;
  text: string;
  notice: string | undefined;
}

export interface SessionView {
  state: SessionState;
  message: string | undefined;
  canRestart: boolean;
  /** no-cards、router-unavailable、root-mismatch、not-configured,以及 client 放棄(timeout 且 unsent)。與 canRestart 不同時為 true。 */
  canRetry: boolean;
  testModeNotice: string | undefined;
  answeredCount: number;
  totalCount: number;
  /** question 狀態才是 start 的 overdue;其他狀態 0。一天之內固定,不是目前這張卡的 overdueDays。 */
  overdueCount: number;
  /** done 狀態的小結句子(不含「今天的複習都做完了。」);其他狀態空陣列。 */
  summaryLines: string[];
  current: QuestionView | undefined;
  submitting: boolean;
  /** client 通知正在等側車(busy 重試超過 1 秒)到通知結束之間。 */
  waiting: boolean;
  /** waiting 時是「複習程式還在準備,稍等一下。」,否則 undefined。 */
  waitNotice: string | undefined;
  gradingError: string | undefined;
  result: ResultView | undefined;
  reteach: ReteachView | undefined;
}
