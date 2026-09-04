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

/**
 * ADR-044 的 `prompt-quality.fake.attempt-fallback-first`:同一個 task+marker 第 N 次
 * 呼叫沒有 attempt=N 的 fixture 時,**重播 attempt=1 的那一份**,不丟錯。基準報告
 * (959b039 / 45c83a7)裡這條退化分支沒有任何測試走過;這一組讓它被走到,而且斷言
 * 「重播的是哪一份」——不是最後一份、不是隨便一份、也不是丟錯。
 */
describe('FakeLlmRouter — 第 N 次呼叫沒有 attempt=N 的 fixture 時重播 attempt=1(ADR-044 attempt-fallback-first)', () => {
  const resp = (text: string) => ({ text, provider: 'fake', model: 'm', latency_ms: 0, provisional: false });

  it('只錄了 attempt=1:第 2、3 次呼叫都重播 attempt=1,不丟 FixtureNotFoundError', async () => {
    const dir = fixtureDir([{ task: 'ingest.cards', prompt_contains: 'ONLY_ONE', attempt: 1, response: resp('first') }]);
    const router = new FakeLlmRouter([dir]);
    expect((await router.call('ingest.cards', '[ONLY_ONE]')).text).toBe('first');
    expect((await router.call('ingest.cards', '[ONLY_ONE]')).text).toBe('first');
    expect((await router.call('ingest.cards', '[ONLY_ONE]')).text).toBe('first');
    expect(router.calls).toHaveLength(3);
  });

  it('錄了 attempt=1、2:第 3 次重播的是 attempt=1,不是最後一份 attempt=2', async () => {
    const dir = fixtureDir([
      { task: 'ingest.cards', prompt_contains: 'TWO', attempt: 1, response: resp('first') },
      { task: 'ingest.cards', prompt_contains: 'TWO', attempt: 2, response: resp('second') },
    ]);
    const router = new FakeLlmRouter([dir]);
    await router.call('ingest.cards', '[TWO]');
    await router.call('ingest.cards', '[TWO]');
    expect((await router.call('ingest.cards', '[TWO]')).text).toBe('first');
    expect((await router.call('ingest.cards', '[TWO]')).text).toBe('first');
  });

  it('重播的是 attempt=1 那一份,跟 fixture 檔案的排列順序無關(attempt=2 的檔排在前面也一樣)', async () => {
    const dir = fixtureDir([
      { task: 'grade.apply', prompt_contains: 'ORDER', attempt: 2, response: resp('second') },
      { task: 'grade.apply', prompt_contains: 'ORDER', attempt: 1, response: resp('first') },
    ]);
    const router = new FakeLlmRouter([dir]);
    expect((await router.call('grade.apply', '[ORDER]')).text).toBe('first');
    expect((await router.call('grade.apply', '[ORDER]')).text).toBe('second');
    expect((await router.call('grade.apply', '[ORDER]')).text).toBe('first');
  });

  it('只有 attempt=1 可以當替身:只錄了 attempt=2 時,第 1 次就丟 FixtureNotFoundError,不會拿 attempt=2 頂替', async () => {
    const dir = fixtureDir([{ task: 'grade.apply', prompt_contains: 'NO_FIRST', attempt: 2, response: resp('second') }]);
    const router = new FakeLlmRouter([dir]);
    const err = await router.call('grade.apply', '[NO_FIRST]').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FixtureNotFoundError);
    expect((err as Error).message).toMatch(/attempt=1/);
  });

  it('計數是 task+marker 各自算的:一個 marker 進入重播,不影響另一個 marker 的 attempt 序', async () => {
    const dir = fixtureDir([
      { task: 'ingest.cards', prompt_contains: 'A_MARK', attempt: 1, response: resp('a1') },
      { task: 'ingest.cards', prompt_contains: 'B_MARK', attempt: 1, response: resp('b1') },
      { task: 'ingest.cards', prompt_contains: 'B_MARK', attempt: 2, response: resp('b2') },
    ]);
    const router = new FakeLlmRouter([dir]);
    await router.call('ingest.cards', '[A_MARK]');
    expect((await router.call('ingest.cards', '[A_MARK]')).text).toBe('a1'); // A 第 2 次:重播
    expect((await router.call('ingest.cards', '[B_MARK]')).text).toBe('b1'); // B 第 1 次:不受 A 影響
    expect((await router.call('ingest.cards', '[B_MARK]')).text).toBe('b2'); // B 第 2 次:照序
  });
});
