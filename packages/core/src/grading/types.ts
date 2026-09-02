/**
 * contracts/types.md §3 §5 §7 的可執行版本,05-grading 自己的落點內複製。
 * packages/contracts 還沒填內容(01-data-layer 尚未做),Wave 0 期間各功能只能
 * import 自己的目錄,所以這裡自己定義,整合時再改成從 packages/contracts import。
 */

export interface FillQuestion {
  prompt: string;
  answers: string[][];
}

/** 契約 §5(軟約定):填空的 grader 只用前五個值,apply 的三個值不在這裡出現 */
export type Grader = 'exact' | 'fuzzy' | 'local-llm' | 'fallback-strict' | 'empty';

export interface GradeResult {
  pass: boolean | null;
  criteria?: boolean[];
  feedback: string;
  grader: Grader;
}

/** 契約 §7(硬約定:LlmTask 本身與路由表;這裡只用得到 grade.fill.llm) */
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
