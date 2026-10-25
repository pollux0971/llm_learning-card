/**
 * T20:舊 `word-count-min.test.ts` 的每一條邊界案例搬到這裡,改量「ingest 真正走的那條路」。
 * 工單:docs/tickets/T20-unify-example-fence-regex.md「2026-10-25 顧問審後更新」第 2 點與「測試」表。測試 agent 寫;開發 worker 不改。
 *
 * 兩個量法,同一組案例:
 *   - 葉模組:`@core/schema/index.js` 的 `parseCardText` + `countWords`(契約 §2 的實作,validateCard 用的);
 *   - ingest 的路:`generate-cards.ts` 的 `enforceWordLimit`,看它記下的第一次字數(`attempts[0].wordCount`;字數沒超過上限時一次 LLM 都不會叫)。
 * 再加差分:同一段 body,ingest 的字數 = `validateCard` 的 `bodyWordCount`。
 *
 * 不放進來的(顧問 2026-10-25):
 *   - 開閉在同一行的圍欄、未閉合的圍欄:契約 §2 沒定義,不測。
 *   - 四反引號圍欄:契約 1.2.0(ADR-060)的向量是 2,但 `parse-card.ts` 現在算 6(T51 才修),所以這裡不放、也不釘 6。舊測試沒有這一條,沒東西可搬。
 * 舊測試與搬過來的對照:
 *   countWords 八條(CJK、連字號、連續英數、句點、撇號、空白、標點、wordcount-cases.md 的 23)→ 下面的 COUNT_CASES;
 *   stripExampleFences 三條(移除圍欄 + 收 example、沒圍欄、多個圍欄依序)→ `parseCardText` 的 body / examples;
 *   countBodyWords 一條(先去掉圍欄內容再算 5)→ FENCE_CASES;
 *   另補工單測試表列的「非 example 的圍欄不移除」(舊測試沒有)。
 */
import { parseCardText, countWords, validateCard } from '@core/schema/index.js';
import { describe, expect, it } from 'vitest';
import { enforceWordLimit } from './generate-cards.js';

const PREFIX = '---\n---\n\n';

/** ingest 對這段 body 算出的字數(不超過 100 字,所以 call 不會被叫) */
async function ingestCount(body: string): Promise<number> {
  const r = await enforceWordLimit(
    async () => {
      throw new Error('字數沒超過上限,不該叫 LLM');
    },
    'ingest.cards',
    'security',
    'test',
    { title: 't', body, examples: [] },
  );
  expect(r.attempts.length, `字數沒超過上限,只該有一次嘗試(實際 ${r.attempts.length})`).toBe(1);
  return r.attempts[0]!.wordCount;
}

/** 沒有圍欄的 body 與期望字數(舊 countWords 八條) */
const COUNT_CASES: { name: string; body: string; words: number }[] = [
  { name: 'CJK 每字算 1', body: '同源政策', words: 4 },
  { name: '連字號切斷英數字序列', body: 'same-origin', words: 2 },
  { name: '連續英數字算一個序列', body: 'TLS', words: 1 },
  { name: '句點切斷序列', body: '1.5', words: 2 },
  { name: '撇號切斷序列', body: "don't", words: 2 },
  { name: '空白切斷序列', body: 'RFC 6265', words: 2 },
  { name: '標點與符號本身算 0', body: '。、!?', words: 0 },
  // contracts/fixtures/cards/wordcount-cases.md 的 body。README 宣稱 26,依契約 §2 逐字元推演是 23(README 表格自己加總也是 23)
  { name: '混合案例(wordcount-cases.md 的 body)', body: "同源政策(same-origin policy)在 TLS 1.3 下不變。don't 算兩個。RFC 6265 也是。", words: 23 },
];

/** 有圍欄的整段文字:body 裡去掉 example 圍欄之後的字數 */
const FENCE_CASES: { name: string; text: string; words: number }[] = [
  { name: 'example 圍欄裡的字不算(正文四個字 → 5)', text: '正文四個字\n```example\n這裡有很多不該被算進去的字\n```', words: 5 },
  { name: '圍欄在中間,前後的字都算', text: '正文開頭\n```example\n範例內容\n```\n正文結尾', words: 8 },
  { name: '多個圍欄各自去掉', text: '```example\nA\n```\n中間\n```example\nB\n```', words: 2 },
  { name: '非 example 的圍欄不移除(js 圍欄裡的字照算:正文 2 + js 1 + 四個字呀 4)', text: '正文\n```js\n四個字呀\n```', words: 7 },
];

describe('T20:舊 countWords 邊界案例(葉模組與 ingest 的路都量)', () => {
  for (const c of COUNT_CASES) {
    it(`${c.name}:${JSON.stringify(c.body)} → ${c.words}`, async () => {
      expect(countWords(parseCardText(PREFIX + c.body + '\n').body), 'schema 的 countWords(parseCardText(...).body)').toBe(c.words);
      expect(await ingestCount(c.body), 'ingest 的 enforceWordLimit 第一次字數').toBe(c.words);
    });
  }
});

describe('T20:舊 stripExampleFences / countBodyWords 邊界案例(圍欄)', () => {
  for (const c of FENCE_CASES) {
    it(`${c.name}`, async () => {
      expect(countWords(parseCardText(PREFIX + c.text + '\n').body), 'schema 的路').toBe(c.words);
      expect(await ingestCount(c.text), 'ingest 的路').toBe(c.words);
    });
  }

  it('移除 example 圍欄:body 只剩其他文字,examples 收到圍欄裡的內容', () => {
    const parsed = parseCardText(PREFIX + '正文開頭\n```example\n範例內容\n```\n正文結尾\n');
    expect(parsed.body.replace(/\s+/g, ''), 'body 沒有圍欄裡的字').toBe('正文開頭正文結尾');
    expect(parsed.examples).toEqual(['範例內容']);
  });

  it('沒有圍欄時 body 原樣(trim 後),examples 是空陣列', () => {
    const parsed = parseCardText(PREFIX + '只是一段文字\n');
    expect(parsed.body).toBe('只是一段文字');
    expect(parsed.examples).toEqual([]);
  });

  it('多個圍欄依序收集 examples', () => {
    const parsed = parseCardText(PREFIX + '```example\nA\n```\n中間\n```example\nB\n```\n');
    expect(parsed.examples).toEqual(['A', 'B']);
    expect(parsed.body.replace(/\s+/g, '')).toBe('中間');
  });
});

describe('T20:差分——同一段 body,ingest 算出的字數 = validateCard 的 bodyWordCount', () => {
  const FM = '---\nid: sec-0001\ncategory: security\ntitle: t\nlevel: 0\nsource: llm\ncreated: 2026-09-01\n---\n';
  const bodies = [...COUNT_CASES.map((c) => c.body), ...FENCE_CASES.map((c) => c.text)];
  for (const body of bodies) {
    it(`${JSON.stringify(body).slice(0, 48)}`, async () => {
      const viaValidate = validateCard(FM + body + '\n').bodyWordCount;
      expect(await ingestCount(body), `ingest 與 validateCard 對 ${JSON.stringify(body)} 算出不同字數`).toBe(viaValidate);
    });
  }
});
