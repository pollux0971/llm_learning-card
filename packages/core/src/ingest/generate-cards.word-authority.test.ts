/**
 * T19 要求 4(顧問 Q3):generateCards 的字數判斷要和寫檔前後把關的 `validateCard` 走**同一條路**:
 * `countWords(parseCardText('---\n---\n\n' + body.trim() + '\n').body)`(`schema/parse-card.ts` 去圍欄、`schema/word-count.ts` 算字),
 * 不是 `word-count-min.ts` 的 Wave 0 複本,也不是再抄一份。
 *
 * 現在幾份算法對多數字串算出一樣的數字,只看結果分不出用的是哪一份;所以這裡把那條路上的兩個函式換掉:
 * - `countWords`:遇到記號 ⟦⁂⟧ 就多算 1000(記號全是標點,真算法算 0)。
 * - `parseCardText`:真的解析完,再把 ⟪…⟫ 整段從 body 拿掉(真算法會照算裡面的字)。
 * 判斷(要不要重寫、parked 記的字數)跟著換掉的版本走,才證明它真的經過這兩個函式。
 * 換的是葉模組(`parse-card.js`、`word-count.js`),所以從 `@core/schema/index.js` 或直接從葉模組 import 都攔得到。
 */
import { generateCards } from './generate-cards.js';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

vi.mock('@core/schema/word-count.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@core/schema/word-count.js')>();
  return {
    ...real,
    countWords: vi.fn((text: string) => real.countWords(text) + (text.includes('⟦⁂⟧') ? 1000 : 0)),
  };
});

vi.mock('@core/schema/parse-card.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@core/schema/parse-card.js')>();
  return {
    ...real,
    parseCardText: vi.fn((raw: string) => {
      const parsed = real.parseCardText(raw);
      return { ...parsed, body: parsed.body.replace(/⟪[\s\S]*?⟫/g, '') };
    }),
  };
});

const MARK = '⟦⁂⟧';
/** 沒被換掉的真函式(一般的 import 會拿到換掉的版本,所以用 importActual 取原版)。 */
const { countWords: realCountWords } = await vi.importActual<typeof import('@core/schema/word-count.js')>('@core/schema/word-count.js');
const { parseCardText: realParseCardText } = await vi.importActual<typeof import('@core/schema/parse-card.js')>('@core/schema/parse-card.js');

/** 真的那條路(validateCard 的算法,照工單的卡檔前綴)。 */
const realPath = (body: string) => realCountWords(realParseCardText('---\n---\n\n' + body.trim() + '\n').body);

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
const HIDDEN = '⟪' + '藏'.repeat(200) + '⟫';

describe('要求 4(Q3):字數判斷經過 validateCard 用的 parseCardText 與 countWords', () => {
  it('前提:記號在真算法裡算 0;⟪…⟫ 裡的字真算法照算', () => {
    expect(realPath(`短正文${MARK}`)).toBe(3);
    expect(realPath(`短正文${HIDDEN}`)).toBe(203);
  });

  it('countWords 說超長 → 會呼叫 regenerate(真算法只有 3 字)', async () => {
    const router = scriptedRouter([JSON.stringify([card(`短正文${MARK}`)]), JSON.stringify([card(SHORT)])]);
    const result = await generateCards(router, OPTS);
    expect(router.calls).toHaveLength(2);
    expect(result.regenerateEvents).toBe(1);
    expect(result.accepted.map((c) => c.body)).toEqual([SHORT]);
  });

  it('parseCardText 拿掉的字不算 → 不呼叫 regenerate(真算法 203 字)', async () => {
    const router = scriptedRouter([JSON.stringify([card(`短正文${HIDDEN}`)]), JSON.stringify([card(SHORT)])]);
    const result = await generateCards(router, OPTS);
    expect(router.calls).toHaveLength(1);
    expect(result.regenerateEvents).toBe(0);
    expect(result.accepted.map((c) => c.body)).toEqual([`短正文${HIDDEN}`]);
  });

  it('parked 的每次字數是這條路算的:先經過 parseCardText(去圍欄、拿掉 ⟪…⟫)再 countWords', async () => {
    const bodies = [
      `第一次${MARK}`,
      `第二次${MARK}${HIDDEN}\n\`\`\`example\n圍欄裡${MARK}的字不算\n\`\`\``,
      `第三次${MARK}還是太長`,
    ];
    const router = scriptedRouter(bodies.map((b) => JSON.stringify([card(b)])));
    const result = await generateCards(router, OPTS);
    expect(router.calls).toHaveLength(3);
    expect(result.accepted).toEqual([]);
    expect(result.parked).toHaveLength(1);
    expect(result.parked[0]!.attempts.map((a) => a.wordCount)).toEqual([1003, 1003, 1007]);
  });

  it('記號只在 example 圍欄內 → 圍欄先被 parseCardText 拿掉,不算超長', async () => {
    const router = scriptedRouter([JSON.stringify([card(`短正文\n\`\`\`example\n${MARK}\n\`\`\``)])]);
    const result = await generateCards(router, OPTS);
    expect(router.calls).toHaveLength(1);
    expect(result.accepted).toHaveLength(1);
    expect(result.regenerateEvents).toBe(0);
  });
});
