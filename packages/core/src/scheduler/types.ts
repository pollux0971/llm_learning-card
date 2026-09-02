/**
 * 契約 §1 §4 §5 §6 的可執行版本,只到 04-scheduler 需要的範圍。
 * Wave 0 phase-1 沒有依賴,所以不 import packages/contracts(還是空的),
 * 這裡自己宣告,整合時對照 contracts/types.md 換成共用型別。
 */

export type CardId = string;
export type IsoDate = string;
export type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type QuestionType = 'fill' | 'apply';

export type Grader =
  | 'exact'
  | 'fuzzy'
  | 'local-llm'
  | 'fallback-strict'
  | 'empty'
  | 'cloud'
  | 'local-provisional'
  | 'error';

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

export interface DueItem {
  card: CardId;
  stage: Stage;
  types: QuestionType[];
  overdue_days: number;
  overdue_ratio: number;
  stuck: boolean;
}

export interface SchedulerEvent {
  type: 'reteach_queued' | 'stuck' | 'archived';
  card: CardId;
}

export interface SchedulerOutcome {
  review: Review;
  events: SchedulerEvent[];
}
