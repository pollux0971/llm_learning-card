import { generateCards } from './generate-cards.js';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

function mockRouter(responses: string[]): LlmRouter & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    async call(_task: LlmTask, prompt: string): Promise<LlmResult> {
      calls.push(prompt);
      const text = responses[i];
      if (text === undefined) throw new Error(`mockRouter: 第 ${i + 1} 次呼叫沒有預設回應`);
      i += 1;
      return { text, provider: 'fake', model: 'mock', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

const shortBody = (title: string) => JSON.stringify([{ title, body: '這是一段很短的正文。', examples: [], lines: [1, 2] }]);
const overlongBody = (title: string) => JSON.stringify([{ title, body: '測'.repeat(120), examples: [], lines: [1, 2] }]);

describe('generateCards', () => {
  it('全部在字數上限內時,一次呼叫就接受', async () => {
    const router = mockRouter([shortBody('卡片一')]);
    const result = await generateCards(router, { relLabel: 'x.md', category: 'security', content: 'raw' });
    expect(result.accepted).toHaveLength(1);
    expect(result.parked).toHaveLength(0);
    expect(result.regenerateEvents).toBe(0);
    expect(router.calls).toHaveLength(1);
  });

  it('第一次超長、第二次符合上限:接受並記一次 regenerate', async () => {
    const router = mockRouter([overlongBody('卡片一'), shortBody('卡片一')]);
    const result = await generateCards(router, { relLabel: 'x.md', category: 'security', content: 'raw' });
    expect(result.accepted).toHaveLength(1);
    expect(result.parked).toHaveLength(0);
    expect(result.regenerateEvents).toBe(1);
    expect(router.calls).toHaveLength(2);
  });

  it('連續三次都超長:放進 parked,附三次嘗試紀錄,不接受', async () => {
    const router = mockRouter([overlongBody('卡片一'), overlongBody('卡片一'), overlongBody('卡片一')]);
    const result = await generateCards(router, { relLabel: 'x.md', category: 'security', content: 'raw' });
    expect(result.accepted).toHaveLength(0);
    expect(result.parked).toHaveLength(1);
    expect(result.parked[0]!.attempts).toHaveLength(3);
    expect(router.calls).toHaveLength(3);
  });

  it('多張候選卡各自獨立處理:正常的直接收,超長的照樣重試', async () => {
    const batch = JSON.stringify([
      { title: '正常卡', body: '這是一段很短的正文。', examples: [], lines: [1, 2] },
      { title: '超長卡', body: '測'.repeat(120), examples: [], lines: [3, 4] },
    ]);
    const router = mockRouter([batch, shortBody('超長卡')]);
    const result = await generateCards(router, { relLabel: 'x.md', category: 'security', content: 'raw' });
    expect(result.accepted.map((c) => c.title)).toEqual(['正常卡', '超長卡']);
    expect(result.parked).toHaveLength(0);
    expect(result.regenerateEvents).toBe(1);
  });

  it('LLM 回應不是合法 JSON 時丟錯', async () => {
    const router = mockRouter(['not json']);
    await expect(generateCards(router, { relLabel: 'x.md', category: 'security', content: 'raw' })).rejects.toThrow();
  });

  it('LLM 回應缺欄位時丟錯', async () => {
    const router = mockRouter([JSON.stringify([{ title: '缺東西' }])]);
    await expect(generateCards(router, { relLabel: 'x.md', category: 'security', content: 'raw' })).rejects.toThrow();
  });
});
