/**
 * T19 要求 4:generateCards 的字數判斷要用契約 §2 的**權威實作** `@core/schema/word-count.js` 的 `countWords`
 * (先去 example 圍欄),不是 `word-count-min.ts` 的 Wave 0 複本、也不是再抄一份。
 *
 * 兩份演算法現在算出一樣的數字,從結果看不出用的是哪一份;所以這裡把權威模組換成「遇到記號就多算 1000」的版本:
 * 決定(要不要重寫、parked 記的字數)跟著換掉的版本走,才證明它真的經過權威實作。記號 ⟦⁂⟧ 全是標點(Ps、Po、Pe),真算法算 0。
 */
import { stripExampleFences } from './word-count-min.js';
import { generateCards } from './generate-cards.js';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

vi.mock('@core/schema/word-count.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@core/schema/word-count.js')>();
  return {
    ...real,
    countWords: vi.fn((text: string) => real.countWords(text) + (text.includes('⟦⁂⟧') ? 1000 : 0)),
  };
});

const MARK = '⟦⁂⟧';
/** 沒被換掉的真算法(一般的 import 會拿到換掉的版本,所以用 importActual 取原版)。 */
const { countWords: realCountWords } = await vi.importActual<typeof import('@core/schema/word-count.js')>('@core/schema/word-count.js');

function scriptedRouter(responses: string[]): LlmRouter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call(_task: LlmTask, prompt: string): Promise<LlmResult> {
      const text = responses[calls.length];
      calls.push(prompt);
      if (text === undefined) throw new Error(`scriptedRouter: 第 ${calls.length} 次呼叫沒有預設回應`);
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

const OPTS = { relLabel: 'x.md', category: 'security', content: 'raw' };
const card = (body: string) => ({ title: '卡', body, examples: ['例'], lines: [3, 4] });
const SHORT = '重寫後的精簡正文。';

/** 換掉的權威實作算出來的數字(真算法 + 記號的 1000)。 */
const mocked = (body: string) => {
  const stripped = stripExampleFences(body).body;
  return realCountWords(stripped) + (stripped.includes(MARK) ? 1000 : 0);
};

describe('要求 4:字數判斷經過 @core/schema/word-count.js', () => {
  it('前提:記號本身在真算法裡算 0', () => {
    expect(realCountWords(`短正文${MARK}`)).toBe(3);
  });

  it('權威實作說超長 → 會呼叫 regenerate(真算法只有 3 字)', async () => {
    const router = scriptedRouter([JSON.stringify([card(`短正文${MARK}`)]), JSON.stringify([card(SHORT)])]);
    const result = await generateCards(router, OPTS);
    expect(router.calls).toHaveLength(2);
    expect(result.regenerateEvents).toBe(1);
    expect(result.accepted.map((c) => c.body)).toEqual([SHORT]);
  });

  it('parked 的每次字數是權威實作算的,而且是去掉 example 圍欄之後算的', async () => {
    const bodies = [
      `第一次${MARK}`,
      `第二次${MARK}\n\`\`\`example\n圍欄裡${MARK}的字不算\n\`\`\``,
      `第三次${MARK}還是太長`,
    ];
    const router = scriptedRouter(bodies.map((b) => JSON.stringify([card(b)])));
    const result = await generateCards(router, OPTS);
    expect(router.calls).toHaveLength(3);
    expect(result.accepted).toEqual([]);
    expect(result.parked).toHaveLength(1);
    expect(result.parked[0]!.attempts.map((a) => a.wordCount)).toEqual(bodies.map(mocked));
    expect(bodies.map(mocked)).toEqual([1003, 1003, 1007]);
  });

  it('圍欄裡的記號不影響判斷:記號只在 example 圍欄內 → 不算超長', async () => {
    const router = scriptedRouter([JSON.stringify([card(`短正文\n\`\`\`example\n${MARK}\n\`\`\``)])]);
    const result = await generateCards(router, OPTS);
    expect(router.calls).toHaveLength(1);
    expect(result.accepted).toHaveLength(1);
    expect(result.regenerateEvents).toBe(0);
  });
});
