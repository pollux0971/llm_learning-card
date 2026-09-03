import Anthropic from '@anthropic-ai/sdk';
import type { CloudAdapter, CloudAdapterCallArgs, CloudAdapterResult } from '../types.js';

/**
 * TODO(下一輪開發 agent,i1-integration-fix 洞:MAX_TOKENS 寫死 1024 導致截斷):
 *   1. `max_tokens: MAX_TOKENS` 改成 `max_tokens: args.maxTokens`
 *      (`CloudAdapterCallArgs.maxTokens` 已經加好,由 router.ts 依 token-limits.ts 查表傳進來)。
 *   2. `response.stop_reason === 'max_tokens'` 時,在回傳的 `CloudAdapterResult`
 *      加 `truncated: true`(型別已加好,見 types.ts `CloudAdapterResult`)。
 *      router.ts 看到 `truncated` 就會丟 `OutputTruncatedError`,不用在這裡丟。
 *   測試已經寫好(router.test.ts,用假 adapter 驗證 router.ts 這半的行為)。
 */
const MAX_TOKENS = 1024;

export const anthropicAdapter: CloudAdapter = {
  async call({ prompt, model, apiKey, signal }: CloudAdapterCallArgs): Promise<CloudAdapterResult> {
    const client = new Anthropic({ apiKey });
    const started = Date.now();
    const response = await client.messages.create(
      { model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] },
      { signal },
    );
    const latency_ms = Date.now() - started;
    const textBlock = response.content.find((block) => block.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    const result: CloudAdapterResult = { text, provider: 'anthropic', model: response.model, latency_ms };
    if (response.usage.input_tokens != null) result.tokens_in = response.usage.input_tokens;
    if (response.usage.output_tokens != null) result.tokens_out = response.usage.output_tokens;
    return result;
  },
};
