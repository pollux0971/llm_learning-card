import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeLlmRouter, FixtureNotFoundError } from './fake-llm.js';

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function fixtureDir(records: Record<string, unknown>[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pq-fake-llm-'));
  tmpDirs.push(dir);
  records.forEach((r, i) => writeFileSync(join(dir, `f${i}.json`), JSON.stringify(r)));
  return dir;
}

describe('FakeLlmRouter', () => {
  it('依 task + prompt_contains 找到對應的預錄回應', async () => {
    const dir = fixtureDir([
      { task: 'grade.apply', prompt_contains: 'MARK', attempt: 1, response: { text: 'hi', provider: 'fake', model: 'm', latency_ms: 0, provisional: false } },
    ]);
    const router = new FakeLlmRouter([dir]);
    const result = await router.call('grade.apply', '[MARK] 內容');
    expect(result.text).toBe('hi');
  });

  it('都不中就丟錯,不會靜默回空字串', async () => {
    const dir = fixtureDir([]);
    const router = new FakeLlmRouter([dir]);
    await expect(router.call('grade.apply', '沒有標記的 prompt')).rejects.toThrow(FixtureNotFoundError);
  });

  it('同一個標記重複呼叫時,依 attempt 依序取用', async () => {
    const dir = fixtureDir([
      { task: 'ingest.cards', prompt_contains: 'RETRY', attempt: 1, response: { text: 'first', provider: 'fake', model: 'm', latency_ms: 0, provisional: false } },
      { task: 'ingest.cards', prompt_contains: 'RETRY', attempt: 2, response: { text: 'second', provider: 'fake', model: 'm', latency_ms: 0, provisional: false } },
    ]);
    const router = new FakeLlmRouter([dir]);
    expect((await router.call('ingest.cards', '[RETRY]')).text).toBe('first');
    expect((await router.call('ingest.cards', '[RETRY]')).text).toBe('second');
  });

  it('每次呼叫都會記錄下來,且觸發 onCall(給 world.llmCalls 用)', async () => {
    const dir = fixtureDir([
      { task: 'grade.apply', prompt_contains: 'MARK', attempt: 1, response: { text: 'hi', provider: 'fake', model: 'm', latency_ms: 0, provisional: false } },
    ]);
    const seen: { task: string; prompt: string }[] = [];
    const router = new FakeLlmRouter([dir], (task, prompt) => seen.push({ task, prompt }));
    await router.call('grade.apply', '[MARK]');
    expect(router.calls).toEqual([{ task: 'grade.apply', prompt: '[MARK]' }]);
    expect(seen).toEqual([{ task: 'grade.apply', prompt: '[MARK]' }]);
  });

  it('probeOnline / probeLocal 都回報離線,不會碰網路', async () => {
    const router = new FakeLlmRouter([]);
    expect(await router.probeOnline()).toBe(false);
    expect(await router.probeLocal()).toEqual({ available: false, models: [] });
  });
});
