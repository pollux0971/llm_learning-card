import Anthropic from '@anthropic-ai/sdk';
import type { CloudAdapter, CloudAdapterCallArgs, CloudAdapterResult } from '../types.js';

export const anthropicAdapter: CloudAdapter = {
  async call({ prompt, model, apiKey, signal, maxTokens }: CloudAdapterCallArgs): Promise<CloudAdapterResult> {
    const client = new Anthropic({ apiKey });
    const started = Date.now();
    const response = await client.messages.create(
      { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
      { signal },
    );
    const latency_ms = Date.now() - started;
    const textBlock = response.content.find((block) => block.type === 'text');
    // Stryker disable next-line ConditionalExpression: textBlock 是用 block.type === 'text' 找到的,
    // truthy 時 .type 必為 'text',再檢查一次恆真——等價變異,不是真的分支。
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    const result: CloudAdapterResult = { text, provider: 'anthropic', model: response.model, latency_ms };
    if (response.usage.input_tokens != null) result.tokens_in = response.usage.input_tokens;
    if (response.usage.output_tokens != null) result.tokens_out = response.usage.output_tokens;
    if (response.stop_reason === 'max_tokens') result.truncated = true;
    return result;
  },
};
