import OpenAI from 'openai';
import type { CloudAdapter, CloudAdapterCallArgs, CloudAdapterResult } from '../types.js';

/**
 * ADR-034:這一代的模型(如 gpt-5.6-luna)不吃 `max_tokens`——會回 400
 * `Unsupported parameter: 'max_tokens' ... Use 'max_completion_tokens' instead.`
 * 一律用 `max_completion_tokens`,不要改回 `max_tokens`。
 */

export const openaiAdapter: CloudAdapter = {
  async call({ prompt, model, apiKey, signal, maxTokens }: CloudAdapterCallArgs): Promise<CloudAdapterResult> {
    const client = new OpenAI({ apiKey });
    const started = Date.now();
    const response = await client.chat.completions.create(
      { model, max_completion_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
      { signal },
    );
    const latency_ms = Date.now() - started;
    const text = response.choices[0]?.message?.content ?? '';

    const result: CloudAdapterResult = { text, provider: 'openai', model: response.model, latency_ms };
    if (response.usage?.prompt_tokens != null) result.tokens_in = response.usage.prompt_tokens;
    if (response.usage?.completion_tokens != null) result.tokens_out = response.usage.completion_tokens;
    if (response.choices[0]?.finish_reason === 'length') result.truncated = true;
    return result;
  },
};
