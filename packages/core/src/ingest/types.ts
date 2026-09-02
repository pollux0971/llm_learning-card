/**
 * Wave 0 的本地型別,對應 contracts/types.md §2 §7。
 * I1 整合後改成從 @learning/contracts import,這份檔案跟著 fake-llm.ts /
 * word-count-min.ts 一起移除(見 FEATURE.md「Wave 0 的重複」表)。
 */

export type CardId = string;
export type CategoryId = string;
export type IsoDate = string;
export type Level = number;
export type Source = 'raw' | 'llm';

export interface CardFrontmatter {
  id: CardId;
  category: CategoryId;
  title: string;
  level: Level;
  source: Source;
  created: IsoDate;
  parent?: CardId;
  prereqs?: CardId[];
  source_ref?: string;
  provisional?: boolean;
  stale?: boolean;
  source_missing?: boolean;
}

export interface Card {
  frontmatter: CardFrontmatter;
  body: string;
  examples: string[];
}

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

export type EventType =
  | 'learned'
  | 'reviewed'
  | 'ingested'
  | 'linted'
  | 'llm_call'
  | 'deepened'
  | 'reteach_queued'
  | 'reteach_viewed'
  | 'week_rolled'
  | 'regenerate'
  | 'cycle_removed'
  | 'provisional_resolved'
  | 'warning';

export interface LogEvent {
  ts: string;
  type: EventType;
  card?: CardId;
  [k: string]: unknown;
}
