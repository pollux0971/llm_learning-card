import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudLlmRouter } from './router.js';
import { LlmTimeoutError, MissingCredentialError, UnknownTaskError, UnsupportedProviderError } from './errors.js';
import type { CloudAdapter, CloudAdapterResult } from './types.js';

function fakeAdapter(result: Partial<CloudAdapterResult> = {}): CloudAdapter {
  const base: CloudAdapterResult = { text: 'ok', provider: 'openai', model: 'test-model', latency_ms: 1 };
  return {
    call: vi.fn(async (): Promise<CloudAdapterResult> => ({ ...base, ...result })),
  };
}

function hangingAdapter(): CloudAdapter {
  return { call: vi.fn(() => new Promise<never>(() => {})) };
}

const dirs: string[] = [];
function tmpLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'llm-router-'));
  dirs.push(dir);
  return join(dir, 'log.jsonl');
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('CloudLlmRouter.call', () => {
  it('rejects a task name that is not in the LlmTask contract, without touching any adapter', async () => {
    const adapter = fakeAdapter();
    const router = new CloudLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'm', OPENAI_API_KEY: 'k' },
      adapters: { openai: adapter },
    });

    await expect(router.call('not.a.real.task' as never, 'hi')).rejects.toThrow(UnknownTaskError);
    expect(adapter.call).not.toHaveBeenCalled();
  });

  it('returns the same shape for every task: text, provider, model, latency, provisional', async () => {
    const router = new CloudLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'anthropic', LLM_CLOUD_MODEL: 'm', ANTHROPIC_API_KEY: 'k' },
      adapters: { anthropic: fakeAdapter({ provider: 'anthropic' }) },
    });

    const result = await router.call('deepen', 'hi');
    expect(result).toMatchObject({ text: 'ok', provider: 'anthropic', model: 'test-model' });
    expect(typeof result.latency_ms).toBe('number');
    expect(result.provisional).toBe(false);
  });

  it.each(['anthropic', 'openai'] as const)('uses the %s adapter when configured', async (provider) => {
    const adapter = fakeAdapter({ provider });
    const other = fakeAdapter();
    const router = new CloudLlmRouter({
      env: { LLM_CLOUD_PROVIDER: provider, LLM_CLOUD_MODEL: 'm', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k' },
      adapters: { [provider]: adapter, [provider === 'anthropic' ? 'openai' : 'anthropic']: other },
    });

    await router.call('deepen', 'hi');
    expect(adapter.call).toHaveBeenCalledTimes(1);
    expect(other.call).not.toHaveBeenCalled();
  });

  it('rejects an unsupported provider immediately, without attempting a network call', async () => {
    const adapter = fakeAdapter();
    const router = new CloudLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'not-a-real-provider', LLM_CLOUD_MODEL: 'm' },
      adapters: { openai: adapter, anthropic: adapter },
    });

    await expect(router.call('deepen', 'hi')).rejects.toThrow(UnsupportedProviderError);
    expect(adapter.call).not.toHaveBeenCalled();
  });

  it('reports a missing credential plainly and does not fall back to anything else', async () => {
    const adapter = fakeAdapter();
    const router = new CloudLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'anthropic', LLM_CLOUD_MODEL: 'm' },
      adapters: { anthropic: adapter },
    });

    const err = await router.call('deepen', 'hi').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingCredentialError);
    expect((err as MissingCredentialError).envVar).toBe('ANTHROPIC_API_KEY');
    expect(adapter.call).not.toHaveBeenCalled();
  });

  it('lets the environment override the model named in settings', async () => {
    const adapter = fakeAdapter();
    const router = new CloudLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'from-env', OPENAI_API_KEY: 'k' },
      settings: { cloud_provider: 'openai', cloud_model: 'from-settings' },
      adapters: { openai: adapter },
    });

    await router.call('deepen', 'hi');
    expect(adapter.call).toHaveBeenCalledWith(expect.objectContaining({ model: 'from-env' }));
  });

  it('logs every call with task, provider, model, latency and token counts when reported', async () => {
    const logPath = tmpLogPath();
    const router = new CloudLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'm', OPENAI_API_KEY: 'k' },
      adapters: { openai: fakeAdapter({ tokens_in: 12, tokens_out: 34 }) },
      logPath,
    });

    await router.call('grade.apply', 'hi');
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]!);
    expect(event).toMatchObject({
      type: 'llm_call',
      task: 'grade.apply',
      provider: 'openai',
      model: 'test-model',
      tokens_in: 12,
      tokens_out: 34,
    });
    expect(typeof event.latency_ms).toBe('number');
  });

  it('does not log token counts the provider did not report', async () => {
    const logPath = tmpLogPath();
    const router = new CloudLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'm', OPENAI_API_KEY: 'k' },
      adapters: { openai: fakeAdapter() },
      logPath,
    });

    await router.call('deepen', 'hi');
    const event = JSON.parse(readFileSync(logPath, 'utf8').trim());
    expect(event).not.toHaveProperty('tokens_in');
    expect(event).not.toHaveProperty('tokens_out');
  });

  it('abandons a call that exceeds the timeout and logs the timeout', async () => {
    const logPath = tmpLogPath();
    const router = new CloudLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'm', OPENAI_API_KEY: 'k' },
      adapters: { openai: hangingAdapter() },
      defaultTimeoutMs: 20,
      logPath,
    });

    await expect(router.call('deepen', 'hi')).rejects.toThrow(LlmTimeoutError);
    const event = JSON.parse(readFileSync(logPath, 'utf8').trim());
    expect(event).toMatchObject({ task: 'deepen', timeout: true, timeout_ms: 20 });
  });

  it('lets a call override the timeout to a shorter deadline', async () => {
    const router = new CloudLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'm', OPENAI_API_KEY: 'k' },
      adapters: { openai: hangingAdapter() },
      defaultTimeoutMs: 5_000,
    });

    const started = Date.now();
    await expect(router.call('deepen', 'hi', { timeoutMs: 20 })).rejects.toThrow(LlmTimeoutError);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('produces the identical set of fields from both adapters for the same prompt', async () => {
    const routerA = new CloudLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'anthropic', LLM_CLOUD_MODEL: 'm', ANTHROPIC_API_KEY: 'k' },
      adapters: { anthropic: fakeAdapter({ provider: 'anthropic' }) },
    });
    const routerB = new CloudLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'm', OPENAI_API_KEY: 'k' },
      adapters: { openai: fakeAdapter({ provider: 'openai' }) },
    });

    const [a, b] = await Promise.all([routerA.call('deepen', 'hi'), routerB.call('deepen', 'hi')]);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });
});

describe('CloudLlmRouter.probeOnline / probeLocal', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('reports online when the provider responds', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const router = new CloudLlmRouter({ env: { LLM_CLOUD_PROVIDER: 'openai', OPENAI_API_KEY: 'k' } });
    await expect(router.probeOnline()).resolves.toBe(true);
  });

  it('reports offline when the request fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const router = new CloudLlmRouter({ env: { LLM_CLOUD_PROVIDER: 'openai', OPENAI_API_KEY: 'k' } });
    await expect(router.probeOnline()).resolves.toBe(false);
  });

  it('probeLocal reports unavailable in phase-1 (no local adapter yet)', async () => {
    const router = new CloudLlmRouter({ env: {} });
    await expect(router.probeLocal()).resolves.toEqual({ available: false, models: [] });
  });
});
