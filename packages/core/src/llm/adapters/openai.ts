import OpenAI from 'openai';
import type { CloudAdapter, CloudAdapterCallArgs, CloudAdapterResult } from '../types.js';

/**
 * ADR-034:這一代的模型(如 gpt-5.6-luna)不吃 `max_tokens`——會回 400
 * `Unsupported parameter: 'max_tokens' ... Use 'max_completion_tokens' instead.`
 * 一律用 `max_completion_tokens`,不要改回 `max_tokens`。
 *
 * TODO(下一輪開發 agent,i1-integration-fix 洞:MAX_COMPLETION_TOKENS 寫死 1024 導致截斷):
 *   1. `max_completion_tokens: MAX_COMPLETION_TOKENS` 改成 `max_completion_tokens: args.maxTokens`
 *      (`CloudAdapterCallArgs.maxTokens` 已經加好,由 router.ts 依 token-limits.ts 查表傳進來)。
 *   2. `response.choices[0]?.finish_reason === 'length'` 時,在回傳的 `CloudAdapterResult`
 *      加 `truncated: true`(型別已加好,見 types.ts `CloudAdapterResult`)。
 *      router.ts 看到 `truncated` 就會丟 `OutputTruncatedError`,不用在這裡丟。
 *   測試已經寫好(router.test.ts,用假 adapter 驗證 router.ts 這半的行為)。
 */
const MAX_COMPLETION_TOKENS = 1024;

export const openaiAdapter: CloudAdapter = {
  async call({ prompt, model, apiKey, signal }: CloudAdapterCallArgs): Promise<CloudAdapterResult> {
    const client = new OpenAI({ apiKey });
    const started = Date.now();
    const response = await client.chat.completions.create(
      { model, max_completion_tokens: MAX_COMPLETION_TOKENS, messages: [{ role: 'user', content: prompt }] },
      { signal },
    );
    const latency_ms = Date.now() - started;
    const text = response.choices[0]?.message?.content ?? '';

    const result: CloudAdapterResult = { text, provider: 'openai', model: response.model, latency_ms };
    if (response.usage?.prompt_tokens != null) result.tokens_in = response.usage.prompt_tokens;
    if (response.usage?.completion_tokens != null) result.tokens_out = response.usage.completion_tokens;
    return result;
  },
};
