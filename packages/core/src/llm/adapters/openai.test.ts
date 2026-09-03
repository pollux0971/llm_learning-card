import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function (this: unknown, opts: { apiKey: string }) {
    Object.assign(this as object, { __apiKey: opts.apiKey, chat: { completions: { create: mockCreate } } });
  }),
}));

import OpenAI from 'openai';
import { openaiAdapter } from './openai.js';

function baseArgs(overrides: Partial<Parameters<typeof openaiAdapter.call>[0]> = {}) {
  return {
    prompt: 'hello',
    model: 'gpt-5.6-luna',
    apiKey: 'sk-test',
    signal: new AbortController().signal,
    maxTokens: 777,
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    model: 'gpt-5.6-luna',
    choices: [{ message: { content: 'card text' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
    ...overrides,
  };
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe('openaiAdapter.call', () => {
  it('sends max_completion_tokens (not max_tokens) using the caller-supplied maxTokens, not a hardcoded constant', async () => {
    mockCreate.mockResolvedValue(response());
    await openaiAdapter.call(baseArgs({ maxTokens: 42 }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_completion_tokens: 42, model: 'gpt-5.6-luna' }),
      expect.anything(),
    );
    const [body] = mockCreate.mock.calls[0] as [Record<string, unknown>];
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('passes prompt as the user message and the abort signal through', async () => {
    mockCreate.mockResolvedValue(response());
    const signal = new AbortController().signal;
    await openaiAdapter.call(baseArgs({ prompt: 'ingest this', signal }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [{ role: 'user', content: 'ingest this' }] }),
      expect.objectContaining({ signal }),
    );
  });

  it('constructs the client with the caller-supplied apiKey', async () => {
    mockCreate.mockResolvedValue(response());
    await openaiAdapter.call(baseArgs({ apiKey: 'sk-specific' }));
    expect(vi.mocked(OpenAI)).toHaveBeenCalledWith({ apiKey: 'sk-specific' });
  });

  it('extracts text from choices[0].message.content', async () => {
    mockCreate.mockResolvedValue(response({ choices: [{ message: { content: 'the card' }, finish_reason: 'stop' }] }));
    const result = await openaiAdapter.call(baseArgs());
    expect(result.text).toBe('the card');
  });

  it('falls back to empty text when message/content is missing', async () => {
    mockCreate.mockResolvedValue(response({ choices: [{ message: {}, finish_reason: 'stop' }] }));
    const result = await openaiAdapter.call(baseArgs());
    expect(result.text).toBe('');
  });

  it('falls back to empty text (not a throw) when the message field itself is absent', async () => {
    mockCreate.mockResolvedValue(response({ choices: [{ finish_reason: 'stop' }] }));
    const result = await openaiAdapter.call(baseArgs());
    expect(result.text).toBe('');
  });

  it('sets tokens_in/tokens_out from usage when present', async () => {
    mockCreate.mockResolvedValue(response({ usage: { prompt_tokens: 111, completion_tokens: 222 } }));
    const result = await openaiAdapter.call(baseArgs());
    expect(result.tokens_in).toBe(111);
    expect(result.tokens_out).toBe(222);
  });

  it('omits tokens_in/tokens_out when usage is missing', async () => {
    mockCreate.mockResolvedValue(response({ usage: undefined }));
    const result = await openaiAdapter.call(baseArgs());
    expect(result).not.toHaveProperty('tokens_in');
    expect(result).not.toHaveProperty('tokens_out');
  });

  it('sets truncated:true when finish_reason is "length" (the real bug this fix targets)', async () => {
    mockCreate.mockResolvedValue(response({ choices: [{ message: { content: 'cut off' }, finish_reason: 'length' }] }));
    const result = await openaiAdapter.call(baseArgs());
    expect(result.truncated).toBe(true);
  });

  it('does not set truncated when finish_reason is "stop"', async () => {
    mockCreate.mockResolvedValue(response({ choices: [{ message: { content: 'complete' }, finish_reason: 'stop' }] }));
    const result = await openaiAdapter.call(baseArgs());
    expect(result.truncated).toBeUndefined();
  });

  it('reports the model and provider the SDK actually returned', async () => {
    mockCreate.mockResolvedValue(response({ model: 'gpt-5.6-luna-2026-08-01' }));
    const result = await openaiAdapter.call(baseArgs());
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-5.6-luna-2026-08-01');
  });

  it('reports a non-negative latency_ms', async () => {
    mockCreate.mockResolvedValue(response());
    const result = await openaiAdapter.call(baseArgs());
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('computes latency_ms as elapsed time (end - start), not end + start', async () => {
    const dateNow = vi.spyOn(Date, 'now');
    dateNow.mockReturnValueOnce(1_700_000_000_000).mockReturnValueOnce(1_700_000_000_060);
    mockCreate.mockResolvedValue(response());
    const result = await openaiAdapter.call(baseArgs());
    expect(result.latency_ms).toBe(60);
    dateNow.mockRestore();
  });
});
