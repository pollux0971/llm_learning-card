import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmRouter, loadFixturesFromDir } from './fake-llm.js';

function writeFixture(dir: string, name: string, body: unknown): void {
  writeFileSync(join(dir, name), JSON.stringify(body), 'utf8');
}

describe('FakeLlmRouter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fake-llm-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the recorded response for a matching task and prompt', async () => {
    writeFixture(dir, 'a.json', {
      task: 'grade.fill.llm',
      prompt_contains: '通訊協定',
      attempt: 1,
      response: { text: 'yes', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    const router = new FakeLlmRouter(loadFixturesFromDir(dir));
    const result = await router.call('grade.fill.llm', '標準答案:協定\n使用者回答:通訊協定');
    expect(result.text).toBe('yes');
  });

  it('throws when nothing matches, instead of returning silently', async () => {
    writeFixture(dir, 'a.json', {
      task: 'grade.fill.llm',
      prompt_contains: '通訊協定',
      attempt: 1,
      response: { text: 'yes', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    const router = new FakeLlmRouter(loadFixturesFromDir(dir));
    await expect(router.call('grade.fill.llm', '完全不相關的提示')).rejects.toThrow(/沒有錄製/);
  });

  it('throws when there is no fixture at all', async () => {
    const router = new FakeLlmRouter([]);
    await expect(router.call('grade.fill.llm', 'anything')).rejects.toThrow(/沒有錄製/);
  });

  it('ignores non-json files in the fixtures directory', () => {
    writeFileSync(join(dir, 'README.md'), '不是 fixture', 'utf8');
    writeFixture(dir, 'a.json', {
      task: 'grade.fill.llm',
      prompt_contains: 'x',
      attempt: 1,
      response: { text: 'yes', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    expect(loadFixturesFromDir(dir)).toHaveLength(1);
  });

  it('does not match a fixture recorded for a different task even with the same prompt_contains', async () => {
    writeFixture(dir, 'other-task.json', {
      task: 'grade.apply',
      prompt_contains: '共用字串',
      attempt: 1,
      response: { text: 'wrong-task', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    const router = new FakeLlmRouter(loadFixturesFromDir(dir));
    await expect(router.call('grade.fill.llm', '提示裡有共用字串')).rejects.toThrow(/沒有錄製/);
  });

  it('keeps call counters independent per task+prompt_contains pair', async () => {
    writeFixture(dir, 'alpha.json', {
      task: 'grade.fill.llm',
      prompt_contains: 'alpha',
      attempt: 1,
      response: { text: 'A', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    writeFixture(dir, 'beta.json', {
      task: 'grade.apply',
      prompt_contains: 'beta',
      attempt: 1,
      response: { text: 'B', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    const router = new FakeLlmRouter(loadFixturesFromDir(dir));
    const a = await router.call('grade.fill.llm', 'alpha context');
    const b = await router.call('grade.apply', 'beta context');
    expect(a.text).toBe('A');
    expect(b.text).toBe('B');
  });

  it('does not borrow an attempt from a less specific prompt_contains group', async () => {
    writeFixture(dir, 'generic.json', {
      task: 'grade.fill.llm',
      prompt_contains: '協定',
      attempt: 1,
      response: { text: 'generic', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    writeFixture(dir, 'specific.json', {
      task: 'grade.fill.llm',
      prompt_contains: '通訊協定',
      attempt: 2,
      response: { text: 'specific', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    const router = new FakeLlmRouter(loadFixturesFromDir(dir));
    // 最具體的候選是 attempt=2,但這是第一次呼叫(count=1);不該借用 generic 的 attempt=1。
    await expect(router.call('grade.fill.llm', '使用者回答:通訊協定')).rejects.toThrow(/attempt=1/);
  });

  it('advances through attempts in call order for the same task+prompt_contains', async () => {
    writeFixture(dir, 'a1.json', {
      task: 'grade.apply',
      prompt_contains: 'cors',
      attempt: 1,
      response: { text: 'first', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    writeFixture(dir, 'a2.json', {
      task: 'grade.apply',
      prompt_contains: 'cors',
      attempt: 2,
      response: { text: 'second', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    const router = new FakeLlmRouter(loadFixturesFromDir(dir));
    const first = await router.call('grade.apply', 'about cors handling');
    const second = await router.call('grade.apply', 'about cors handling');
    expect(first.text).toBe('first');
    expect(second.text).toBe('second');
  });

  it('picks the most specific prompt_contains when several match', async () => {
    writeFixture(dir, 'generic.json', {
      task: 'grade.fill.llm',
      prompt_contains: '協定',
      attempt: 1,
      response: { text: 'generic', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    writeFixture(dir, 'specific.json', {
      task: 'grade.fill.llm',
      prompt_contains: '通訊協定',
      attempt: 1,
      response: { text: 'specific', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    const router = new FakeLlmRouter(loadFixturesFromDir(dir));
    const result = await router.call('grade.fill.llm', '使用者回答:通訊協定');
    expect(result.text).toBe('specific');
  });

  it('reports calls made through onCall', async () => {
    writeFixture(dir, 'a.json', {
      task: 'grade.fill.llm',
      prompt_contains: 'x',
      attempt: 1,
      response: { text: 'yes', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    const calls: { task: string; prompt: string }[] = [];
    const router = new FakeLlmRouter(loadFixturesFromDir(dir), (call) => calls.push(call));
    await router.call('grade.fill.llm', 'x marks the spot');
    expect(calls).toEqual([{ task: 'grade.fill.llm', prompt: 'x marks the spot' }]);
  });

  it('probeLocal reflects whether any fixtures were loaded', async () => {
    expect(await new FakeLlmRouter([]).probeLocal()).toEqual({ available: false, models: [] });
    writeFixture(dir, 'a.json', {
      task: 'grade.fill.llm',
      prompt_contains: 'x',
      attempt: 1,
      response: { text: 'yes', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false },
    });
    expect(await new FakeLlmRouter(loadFixturesFromDir(dir)).probeLocal()).toEqual({ available: true, models: ['fake'] });
  });

  it('probeOnline is always false in Wave 0', async () => {
    expect(await new FakeLlmRouter([]).probeOnline()).toBe(false);
  });
});
