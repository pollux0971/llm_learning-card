import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function (this: unknown, opts: { apiKey: string }) {
    Object.assign(this as object, { __apiKey: opts.apiKey, messages: { create: mockCreate } });
  }),
}));

import Anthropic from '@anthropic-ai/sdk';
import { anthropicAdapter } from './anthropic.js';

function baseArgs(overrides: Partial<Parameters<typeof anthropicAdapter.call>[0]> = {}) {
  return {
    prompt: 'hello',
    model: 'claude-sonnet-5',
    apiKey: 'sk-ant-test',
    signal: new AbortController().signal,
    maxTokens: 888,
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text: 'card text' }],
    usage: { input_tokens: 10, output_tokens: 20 },
    stop_reason: 'end_turn',
    ...overrides,
  };
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe('anthropicAdapter.call', () => {
  it('sends max_tokens using the caller-supplied maxTokens, not a hardcoded constant', async () => {
    mockCreate.mockResolvedValue(response());
    await anthropicAdapter.call(baseArgs({ maxTokens: 55 }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 55, model: 'claude-sonnet-5' }),
      expect.anything(),
    );
  });

  it('passes prompt as the user message and the abort signal through', async () => {
    mockCreate.mockResolvedValue(response());
    const signal = new AbortController().signal;
    await anthropicAdapter.call(baseArgs({ prompt: 'ingest this', signal }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [{ role: 'user', content: 'ingest this' }] }),
      expect.objectContaining({ signal }),
    );
  });

  it('constructs the client with the caller-supplied apiKey', async () => {
    mockCreate.mockResolvedValue(response());
    await anthropicAdapter.call(baseArgs({ apiKey: 'sk-ant-specific' }));
    expect(vi.mocked(Anthropic)).toHaveBeenCalledWith({ apiKey: 'sk-ant-specific' });
  });

  it('extracts text from the first text-type content block', async () => {
    mockCreate.mockResolvedValue(response({ content: [{ type: 'text', text: 'the card' }] }));
    const result = await anthropicAdapter.call(baseArgs());
    expect(result.text).toBe('the card');
  });

  it('skips a leading non-text block (e.g. tool_use) and picks the text block', async () => {
    mockCreate.mockResolvedValue(
      response({
        content: [
          { type: 'tool_use', id: 'x', name: 'noop', input: {} },
          { type: 'text', text: 'the real card' },
        ],
      }),
    );
    const result = await anthropicAdapter.call(baseArgs());
    expect(result.text).toBe('the real card');
  });

  it('falls back to empty text when no content block is type "text"', async () => {
    mockCreate.mockResolvedValue(response({ content: [{ type: 'tool_use', id: 'x', name: 'noop', input: {} }] }));
    const result = await anthropicAdapter.call(baseArgs());
    expect(result.text).toBe('');
  });

  it('sets tokens_in/tokens_out from usage when present', async () => {
    mockCreate.mockResolvedValue(response({ usage: { input_tokens: 111, output_tokens: 222 } }));
    const result = await anthropicAdapter.call(baseArgs());
    expect(result.tokens_in).toBe(111);
    expect(result.tokens_out).toBe(222);
  });

  it('omits tokens_in/tokens_out when usage reports them as null', async () => {
    mockCreate.mockResolvedValue(response({ usage: { input_tokens: null, output_tokens: null } }));
    const result = await anthropicAdapter.call(baseArgs());
    expect(result).not.toHaveProperty('tokens_in');
    expect(result).not.toHaveProperty('tokens_out');
  });

  it('computes latency_ms as elapsed time (end - start), not end + start', async () => {
    const dateNow = vi.spyOn(Date, 'now');
    dateNow.mockReturnValueOnce(1_700_000_000_000).mockReturnValueOnce(1_700_000_000_075);
    mockCreate.mockResolvedValue(response());
    const result = await anthropicAdapter.call(baseArgs());
    expect(result.latency_ms).toBe(75);
    dateNow.mockRestore();
  });

  it('sets truncated:true when stop_reason is "max_tokens" (the real bug this fix targets)', async () => {
    mockCreate.mockResolvedValue(response({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'cut off' }] }));
    const result = await anthropicAdapter.call(baseArgs());
    expect(result.truncated).toBe(true);
  });

  it('does not set truncated when stop_reason is "end_turn"', async () => {
    mockCreate.mockResolvedValue(response({ stop_reason: 'end_turn' }));
    const result = await anthropicAdapter.call(baseArgs());
    expect(result.truncated).toBeUndefined();
  });

  it('reports the model and provider the SDK actually returned', async () => {
    mockCreate.mockResolvedValue(response({ model: 'claude-sonnet-5-2026-01-01' }));
    const result = await anthropicAdapter.call(baseArgs());
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-5-2026-01-01');
  });

  it('reports a non-negative latency_ms', async () => {
    mockCreate.mockResolvedValue(response());
    const result = await anthropicAdapter.call(baseArgs());
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });
});
