import { CloudRequiredError, FakeLlmRouter } from './fake-llm.js';

describe('FakeLlmRouter', () => {
  it('依 prompt_contains 選檔,attempt 依呼叫次數遞增', async () => {
    const router = new FakeLlmRouter({
      extra: [
        {
          task: 'ingest.cards',
          prompt_contains: 'foo',
          attempt: 1,
          response: { text: 'first', provider: 'fake', model: 'x', latency_ms: 0, provisional: false },
        },
        {
          task: 'ingest.cards',
          prompt_contains: 'foo',
          attempt: 2,
          response: { text: 'second', provider: 'fake', model: 'x', latency_ms: 0, provisional: false },
        },
      ],
    });
    const r1 = await router.call('ingest.cards', 'prompt with foo in it');
    const r2 = await router.call('ingest.cards', 'prompt with foo in it');
    expect(r1.text).toBe('first');
    expect(r2.text).toBe('second');
  });

  it('沒有錄過的情境直接丟錯,不靜默回空字串', async () => {
    const router = new FakeLlmRouter({ extra: [] });
    await expect(router.call('ingest.cards', 'anything')).rejects.toThrow();
  });

  it('呼叫次數超過已錄的 attempt 數也丟錯', async () => {
    const router = new FakeLlmRouter({
      extra: [
        {
          task: 'ingest.cards',
          prompt_contains: 'foo',
          attempt: 1,
          response: { text: 'first', provider: 'fake', model: 'x', latency_ms: 0, provisional: false },
        },
      ],
    });
    await router.call('ingest.cards', 'foo');
    await expect(router.call('ingest.cards', 'foo')).rejects.toThrow();
  });

  it('cloudUnavailable 時立刻丟 CloudRequiredError,不查 fixture', async () => {
    const router = new FakeLlmRouter({ cloudUnavailable: true });
    await expect(router.call('ingest.cards', 'anything')).rejects.toThrow(CloudRequiredError);
  });

  it('onCall 在每次呼叫前被觸發,包含丟錯的呼叫', async () => {
    const calls: { task: string; prompt: string }[] = [];
    const router = new FakeLlmRouter({ cloudUnavailable: true, onCall: (c) => calls.push(c) });
    await expect(router.call('ingest.cards', 'p')).rejects.toThrow();
    expect(calls).toEqual([{ task: 'ingest.cards', prompt: 'p' }]);
  });

  it('probeOnline / probeLocal 反映 cloudUnavailable 狀態', async () => {
    const online = new FakeLlmRouter();
    const offline = new FakeLlmRouter({ cloudUnavailable: true });
    expect(await online.probeOnline()).toBe(true);
    expect(await offline.probeOnline()).toBe(false);
    expect(await online.probeLocal()).toEqual({ available: false, models: [] });
  });

  it('一個 prompt 同時命中多組 marker 時丟錯,要求 marker 互斥', async () => {
    const router = new FakeLlmRouter({
      extra: [
        {
          task: 'ingest.cards',
          prompt_contains: 'foo',
          attempt: 1,
          response: { text: 'a', provider: 'fake', model: 'x', latency_ms: 0, provisional: false },
        },
        {
          task: 'ingest.cards',
          prompt_contains: 'foobar',
          attempt: 1,
          response: { text: 'b', provider: 'fake', model: 'x', latency_ms: 0, provisional: false },
        },
      ],
    });
    await expect(router.call('ingest.cards', 'has foobar in it')).rejects.toThrow();
  });
});
