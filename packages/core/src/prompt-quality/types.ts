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
  /** phase-2:整次 run 的 token 合計。fake run 的 fixture 沒有 token 資訊時是 0。 */
  tokens_in?: number;
  tokens_out?: number;
  /**
   * phase-2:粗估的美金花費。**只有** model 在價目表上時才有值——
   * 沒有價目就回報 token 數,不要瞎猜一個數字讓人以為那是帳單。
   */
  estimated_cost_usd?: number;
}

export type StructuralIssueKind =
  | 'invalid-json'
  | 'body-too-long'
  | 'rubric-too-few'
  | 'rubric-too-many'
  | 'blank-answer-mismatch'
  | 'missing-field'
  // phase-2 的兩項批次檢查(整批一起看才算得出來,單一輸出看不出)
  | 'duplicate-pair'
  | 'prereq-shape';

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

// ------------------------------------------------------- phase-2 批次檢查

/**
 * 批次檢查的輸入:同一批(同一類別一次 ingest)產出的卡。
 * 只留檢查會用到的欄位——批次檢查不碰磁碟格式,contracts §2 的完整 CardFrontmatter
 * 是 01/02 的事,這裡要的是「一批卡的形狀」。
 * body 已移除 example 圍欄(契約 §2:圍欄不算字數,也不參與重複率比對)。
 */
export interface BatchCard {
  id: string;
  title: string;
  level: number;
  /** 預設 [];level 0 的卡也可能有 prereqs(I1 實際資料就有) */
  prereqs?: string[];
  body: string;
}

/** 為什麼判定為一對重複:標題正規化後相同,或 body 3-gram Jaccard 過門檻。 */
export type DuplicateReason = 'title' | 'body';

export interface DuplicatePair {
  /** 兩個 id 依字典序排,a < b,讓清單穩定可 diff */
  a: string;
  b: string;
  reason: DuplicateReason;
  /** body 相似度(reason==='title' 時仍然算給人看,不影響判定) */
  similarity: number;
}

/** 「重複對數 / 卡數」與清單(工單第 2 項的輸出定義)。 */
export interface DuplicateReport {
  cardCount: number;
  /** 依 (a, b) 字典序排序,固定順序才能 diff */
  pairs: DuplicatePair[];
  /** pairs.length / cardCount;cardCount === 0 時為 0 */
  rate: number;
}

/** 一張卡的 prereq 指向比自己 level 更深的卡(主卡依賴別人的子卡)。 */
export interface PrereqShapeViolation {
  card: string;
  cardLevel: number;
  prereq: string;
  prereqLevel: number;
}

/** 批次檢查的完整結果。issues 走既有的 StructuralIssue 體系,細節另外附。 */
export interface BatchCheckResult extends StructuralCheckResult {
  duplicates: DuplicateReport;
  prereqShape: PrereqShapeViolation[];
}

// ------------------------------------------------------- phase-2 回歸流程

/**
 * 基準 run:一個任務的第一次 live golden run 打完分之後就是基準,之後的 run 預設跟它比。
 * 標記方式是在 run 目錄放一個 BASELINE 檔(內容是這份 meta 的 JSON),
 * 不用另外維護索引——目錄本身就是資料。
 */
export interface BaselineInfo {
  task: LlmTask;
  /** 基準 run 的目錄(絕對路徑) */
  dir: string;
  date: string;
  promptFileGitCommit: string;
}

/** prompt 檔在基準之後被改過,但沒有新的 golden run(ADR-032 要抓的就是這件事)。 */
export interface PromptDrift {
  /** 相對 repo 根目錄的 prompt 檔路徑 */
  promptFile: string;
  /** 基準 run 當時的 commit */
  baselineCommit: string;
  /** 現在的 commit */
  currentCommit: string;
}

/**
 * 比對之後的分流:哪些要人重看、哪些可以直接沿用舊分數。
 * 刻意跟 CompareItem 分開:compare 只負責「把差異顯示出來」(ADR-032),
 * 「誰需要人看」是上面一層的判斷,混進 CompareItem 會讓比對開始下判斷。
 */
export interface RegressionReview {
  task: LlmTask;
  /** 輸出有變、需要人重新打分的 id,依字典序 */
  needsScoring: string[];
  /** 輸出完全相同、不必重打分的 id,依字典序 */
  unchanged: string[];
  /** unchanged 且 A 有填過分數的 id → 沿用過來的分數。A 沒填的不會出現 */
  carriedForward: Record<string, Partial<Record<ScoreDimension, string>>>;
}
