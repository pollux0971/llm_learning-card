/**
 * 每個 LlmTask 的預設 token 上限。原本 adapter 裡寫死 `MAX_COMPLETION_TOKENS = 1024`,
 * 真的呼叫 gpt-5.6-luna 生成卡片時回應被截斷——如果截斷點剛好切壞 JSON 還能被抓到,
 * 切在別的地方 JSON 可能仍合法,會得到一張少字的卡而且測試全綠。
 *
 * 這張表對照契約 §7 的 7 個 LlmTask,router.ts 的 call() 用
 * `opts.maxTokens ?? TASK_MAX_TOKENS[task]` 查表,查到的值連同 prompt 一起交給 adapter。
 * 獨立成檔案(不放進 routing.ts)是為了不動 routing.ts 既有的嚴格 95% 變異門檻。
 */

import type { LlmTask } from './types.js';

export const TASK_MAX_TOKENS: Readonly<Record<LlmTask, number>> = {
  'ingest.cards': 8192,
  'ingest.questions': 4096,
  'ingest.deps': 2048,
  deepen: 2048,
  'reteach.short': 512,
  'grade.fill.llm': 256,
  'grade.apply': 512,
};
