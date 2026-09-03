/**
 * 契約 §7 的可執行版本。LlmTask 與路由表為硬約定,函式簽章為軟約定。
 * Wave 0 期間本檔案是這個功能自己的型別來源(packages/contracts/ 尚未由
 * 01-data-layer 填入),整合時視情況搬過去。
 */

export const LLM_TASKS = [
  'ingest.cards',
  'ingest.questions',
  'ingest.deps',
  'deepen',
  'grade.fill.llm',
  'grade.apply',
  'reteach.short',
] as const;

export type LlmTask = (typeof LLM_TASKS)[number];

export function isLlmTask(value: string): value is LlmTask {
  return (LLM_TASKS as readonly string[]).includes(value);
}

export interface LlmResult {
  text: string;
  provider: 'anthropic' | 'openai' | 'ollama';
  model: string;
  latency_ms: number;
  provisional: boolean;
  tokens_in?: number;
  tokens_out?: number;
}

export interface LlmRouter {
  call(task: LlmTask, prompt: string, opts?: { timeoutMs?: number; maxTokens?: number }): Promise<LlmResult>;
  probeOnline(): Promise<boolean>;
  probeLocal(): Promise<{ available: boolean; models: string[] }>;
}

// -------------------------------------------------------------- 雲端 adapter

export const CLOUD_PROVIDERS = ['anthropic', 'openai'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

export function isCloudProvider(value: string): value is CloudProvider {
  return (CLOUD_PROVIDERS as readonly string[]).includes(value);
}

export interface CloudAdapterCallArgs {
  prompt: string;
  model: string;
  apiKey: string;
  signal: AbortSignal;
  /** 每任務上限(見 token-limits.ts),取代 adapter 內寫死的常數 */
  maxTokens: number;
}

/**
 * LlmResult 扣掉 provisional——那是 router 依路由表決定的,不是 adapter 該知道的。
 * `truncated` 由 adapter 依 provider 自己的截斷訊號設定
 * (openai: `finish_reason==='length'`;anthropic: `stop_reason==='max_tokens'`)。
 * router.ts 看到 true 就丟 OutputTruncatedError,不回傳 text。
 */
export type CloudAdapterResult = Omit<LlmResult, 'provisional'> & { truncated?: boolean };

export interface CloudAdapter {
  call(args: CloudAdapterCallArgs): Promise<CloudAdapterResult>;
}
