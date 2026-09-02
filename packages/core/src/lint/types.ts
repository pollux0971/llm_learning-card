export type LintProblemType =
  | 'body_over_limit'
  | 'missing_questions'
  | 'orphan_questions'
  | 'missing_prereq'
  | 'orphan_child'
  | 'cycle'
  | 'prereq_mismatch'
  | 'review_orphan';

export interface LintProblem {
  type: LintProblemType;
  /** 主要相關的卡片 id,不是所有問題都有(cycle 沒有單一卡片) */
  card?: string;
  /** 相對於 learning 目錄的路徑 */
  path: string;
  detail: string;
}

export type LintStatusType = 'stale' | 'source_missing';

export interface LintStatus {
  type: LintStatusType;
  card: string;
  path: string;
}

export interface LintResult {
  problems: LintProblem[];
  statuses: LintStatus[];
}
