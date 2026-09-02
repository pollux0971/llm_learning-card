/**
 * `contracts/types.md` 的鏡射子集(只列 06 這個 phase 用到的部分)。
 *
 * Wave 0 期間 apps/test-card 不能 import packages/contracts(那個套件現在是空的,
 * 由 01-data-layer 填)。這裡的型別是手動對齊契約寫的,整合時如果簽章對不上,
 * 就是這個檔案的 bug——見 features/06-test-card/NEXT.md。
 */

export type CardId = string;
export type IsoDate = string;
export type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type QuestionType = 'fill' | 'apply';

export interface FillQuestion {
  prompt: string;
  answers: string[][];
}

export interface ApplyQuestion {
  prompt: string;
  rubric: string[];
}

export interface QuestionFile {
  card: CardId;
  fill: FillQuestion[];
  apply: ApplyQuestion[];
}

export type Grader =
  | 'exact' | 'fuzzy' | 'local-llm' | 'fallback-strict' | 'empty'
  | 'cloud' | 'local-provisional' | 'error';

export interface GradeResult {
  pass: boolean | null;
  criteria?: boolean[];
  feedback: string;
  grader: Grader;
}

export interface DueItem {
  card: CardId;
  stage: Stage;
  types: QuestionType[];
  overdue_days: number;
  overdue_ratio: number;
  stuck: boolean;
}

export interface SelectResult {
  due: DueItem[];
  deferred: number;
  reteach: CardId[];
}

export interface ReviewEntry {
  date: IsoDate;
  stage: Stage;
  type: QuestionType;
  pass: boolean;
  grader: Grader;
  provisional?: boolean;
  revised_by?: 'cloud';
  revised_to?: boolean;
}

export interface Review {
  stage: Stage;
  learned_at: IsoDate;
  next_due: IsoDate | null;
  fails_in_row: number;
  total_fails: number;
  stuck: boolean;
  history: ReviewEntry[];
}

export interface SchedulerEvent {
  type: 'reteach_queued' | 'stuck' | 'archived';
  card: CardId;
}

export interface SchedulerOutcome {
  review: Review;
  events: SchedulerEvent[];
}

/** 契約 §6:「排程函式一律純函式」。這是 advance 的簽章,drop-in 相容性靠它檢查。 */
export type SchedulerAdvanceCtx = { today: IsoDate; pass: boolean; type: QuestionType };
export type SchedulerAdvanceFn = (review: Review, ctx: SchedulerAdvanceCtx) => SchedulerOutcome;

/** 契約 §13,relPath 一律相對於 learning/、用正斜線、拒絕 .. 與絕對路徑 */
export interface LearningFs {
  read(relPath: string): Promise<string>;
  write(relPath: string, content: string): Promise<void>;
  list(relDir: string): Promise<string[]>;
  exists(relPath: string): Promise<boolean>;
  assetUrl(relPath: string): string;
}

/** 目前顯示中的題目:哪張卡、哪個題型、對應的題目內容 */
export interface CurrentQuestion {
  card: CardId;
  type: QuestionType;
  fill?: FillQuestion;
  apply?: ApplyQuestion;
}
