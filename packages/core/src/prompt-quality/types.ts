/**
 * 本地型別鏡射自 contracts/types.md §7(LlmTask/LlmResult/LlmRouter 為硬約定)。
 * packages/contracts/src/index.ts 目前是空的(01-data-layer 尚未填),
 * Wave 0 期間各功能自備一份鏡射,整合後改成從 @learning/contracts import。
 */
export type LlmTask =
  | 'ingest.cards'
  | 'ingest.questions'
  | 'ingest.deps'
  | 'deepen'
  | 'grade.fill.llm'
  | 'grade.apply'
  | 'reteach.short';

export interface LlmResult {
  text: string;
  provider: 'anthropic' | 'openai' | 'ollama' | 'fake';
  model: string;
  latency_ms: number;
  provisional: boolean;
  tokens_in?: number;
  tokens_out?: number;
}

export interface LlmRouter {
  call(task: LlmTask, prompt: string, opts?: { timeoutMs?: number }): Promise<LlmResult>;
  probeOnline(): Promise<boolean>;
  probeLocal(): Promise<{ available: boolean; models: string[] }>;
}

// ---------------------------------------------------------------- golden

/** 一個 golden run 的固定輸入。id 是穩定的檔名主幹,不要用會變動的東西。 */
export interface GoldenInput {
  id: string;
  /** 送進 router 的完整 prompt。必須包含對應 fixture 的 prompt_contains 標記。 */
  prompt: string;
}

/** 一個 prompt 任務的 golden set:固定輸入 + 它評的是哪個 prompt 檔。 */
export interface GoldenSet {
  task: LlmTask;
  /** 相對 repo 根目錄的路徑,golden run 會把這個檔案的內容存一份快照、並記錄它的 git commit。 */
  promptFile: string;
  inputs: GoldenInput[];
}

export interface GoldenRunMeta {
  task: LlmTask;
  /** 這次 run 的日期,同時是輸出目錄名稱(YYYY-MM-DD) */
  date: string;
  model: string;
  provider: string;
  /** promptFile 當下的 git commit(短 sha),檔案未追蹤或無 commit 時是 'uncommitted' */
  promptFileGitCommit: string;
  mode: 'fake' | 'live';
}

export type StructuralIssueKind =
  | 'invalid-json'
  | 'body-too-long'
  | 'rubric-too-few'
  | 'rubric-too-many'
  | 'blank-answer-mismatch'
  | 'missing-field';

export interface StructuralIssue {
  kind: StructuralIssueKind;
  detail: string;
}

/** 結構性檢查不判斷品質,note 永遠存在,提醒好壞要人評分。 */
export interface StructuralCheckResult {
  issues: StructuralIssue[];
  note: string;
}

export interface GoldenOutput {
  id: string;
  text: string;
  structural: StructuralCheckResult;
}

export interface GoldenRunResult {
  dir: string;
  meta: GoldenRunMeta;
  outputs: GoldenOutput[];
}

export const SCORE_DIMENSIONS = ['正確嗎', '是一個概念嗎'] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export interface CompareItem {
  id: string;
  outputA: string | null;
  outputB: string | null;
  same: boolean;
  /** 沒有欄位是 undefined,不是省略——「填了才顯示」看的是值,不是 key 存不存在 */
  scoresA: Partial<Record<ScoreDimension, string>> | undefined;
  scoresB: Partial<Record<ScoreDimension, string>> | undefined;
}

export interface CompareResult {
  task: LlmTask;
  dirA: string;
  dirB: string;
  items: CompareItem[];
}
