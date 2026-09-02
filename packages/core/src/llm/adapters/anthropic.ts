import Anthropic from '@anthropic-ai/sdk';
import type { CloudAdapter, CloudAdapterCallArgs, CloudAdapterResult } from '../types.js';

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
