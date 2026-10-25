/**
 * T51 補測(顧問 5a 裁決乙,2026-10-25):example 圍欄的開始行、結束行允許 CommonMark 的空白寬容。測試 agent 寫;開發 worker 不改。
 * 依據:契約 §2「Example 圍欄……(與 CommonMark 的圍欄規則一致)」,教學卡渲染(markdown-it)也是 CommonMark,字數要跟畫面一致。
 *
 * N = 開始的反引號數(≥ 3):
 *   - 開始:N 個反引號 + `example` + 可有空白/Tab + 換行。
 *   - 結束:該行 0–3 個空白縮排 + 剛好 N 個反引號 + 可有空白/Tab + 換行或檔尾。
 *
 * 每條都用 validateCard 比 bodyWordCount 與 examples;寫法同 validate-card.contract-vectors.test.ts(合法 frontmatter、開始/內容/結束各自一行)。
 * 期望值依 §2 步驟 1 手算:圍欄(開始行到結束行)整段拿掉,剩 `前` `後` = 2;examples 是圍欄內容(已 trim)。
 *
 * 在 ee0d8ef(worker 實作)上:
 *   - A(檔尾沒換行的結束行)、B(兩個反引號不是圍欄)是護欄,本來就綠;
 *   - C1(結束行尾有空白/Tab)、C2(結束行縮排 1、3 個空白)、C3(開始行 example 後有空白/Tab)紅。
 * 不測(契約沒定義,顧問要求碰到就停):同一行開閉、未閉合(含結束反引號後面有字、貼在內容行尾而後面沒有正確結束行的)、
 * 結束反引號比開始多、`example` 後面還有別的字、縮排 4 個以上。
 */
import { describe, expect, it } from 'vitest';
import { parseCardText } from './parse-card.js';
import { validateCard } from './validate-card.js';

const FM = ['id: sec-0001', 'category: security', 'title: 測試卡', 'level: 0', 'source: llm', 'created: 2026-09-01'].join('\n');
/** 合法的卡;`finalNewline` 為 false 時檔尾不加換行(A 用) */
const card = (body: string, finalNewline = true): string => `---\n${FM}\n---\n${body}${finalNewline ? '\n' : ''}`;

const TICKS = (n: number): string => '`'.repeat(n);
const INNER3 = '```js\nab\n```'; // 四反引號圍欄裡的內層三反引號程式碼圍欄
/** N 個反引號時的圍欄內容:N=3 用一般文字,N≥4 用含內層三反引號圍欄的內容(才分得出「數量比開始少的不結束」) */
const contentFor = (n: number): string => (n === 3 ? '內容 內容' : `${INNER3}\n內容 內容`);

interface Shape {
  /** 開始行 `example` 後面的空白 */
  openTail?: string;
  /** 結束行前面的縮排 */
  closeIndent?: string;
  /** 結束行反引號後面的空白/Tab */
  closeTail?: string;
}
const fenced = (n: number, s: Shape = {}): string =>
  `前\n${TICKS(n)}example${s.openTail ?? ''}\n${contentFor(n)}\n${s.closeIndent ?? ''}${TICKS(n)}${s.closeTail ?? ''}\n後`;

function expectFence(raw: string, n: number): void {
  const parsed = parseCardText(raw);
  expect(parsed.examples, '整個圍欄裡面是一個 example,已 trim').toEqual([contentFor(n)]);
  expect(parsed.body.replace(/\s+/g, ''), 'body 只剩 前、後(沒有反引號、沒有圍欄裡的字)').toBe('前後');
  const r = validateCard(raw);
  expect(r.errors, '卡要合法').toEqual([]);
  expect(r.bodyWordCount, '圍欄整段拿掉,只剩 前、後').toBe(2);
  expect(r.examplesCount).toBe(1);
  expect(r.card?.examples).toEqual([contentFor(n)]);
}

describe('A. 檔尾沒有換行的結束行(護欄)', () => {
  for (const n of [3, 4]) {
    it(`${n} 個反引號:結束行在檔尾、後面沒有換行,也算結束`, () => {
      const raw = card(`前\n${TICKS(n)}example\n${contentFor(n)}\n${TICKS(n)}`, false);
      expect(raw.endsWith(TICKS(n)), '前提:檔案真的以結束反引號結尾').toBe(true);
      const parsed = parseCardText(raw);
      expect(parsed.examples).toEqual([contentFor(n)]);
      expect(parsed.body).toBe('前');
      const r = validateCard(raw);
      expect(r.bodyWordCount).toBe(1);
      expect(r.examplesCount).toBe(1);
    });
  }
});

describe('B. 兩個反引號 + example 不是圍欄(護欄)', () => {
  it('``example 的整段照算:前、example、ab、後各 1 = 4,沒有 example', () => {
    const r = validateCard(card('前\n``example\nab\n``\n後'));
    expect(r.errors).toEqual([]);
    expect(r.bodyWordCount).toBe(4);
    expect(r.examplesCount).toBe(0);
  });
});

describe('C1. 結束行反引號後面有空白或 Tab(CommonMark 允許)', () => {
  for (const n of [3, 4]) {
    for (const [name, tail] of [['一個空白', ' '], ['兩個空白', '  '], ['一個 Tab', '\t'], ['空白加 Tab', ' \t']] as const) {
      it(`${n} 個反引號、結束行尾${name}:照樣結束,字數 2、examples 一個`, () => {
        expectFence(card(fenced(n, { closeTail: tail })), n);
      });
    }
  }
});

describe('C2. 結束行前面縮排 1–3 個空白(CommonMark 允許)', () => {
  for (const n of [3, 4]) {
    for (const indent of [' ', '   ']) {
      it(`${n} 個反引號、結束行縮排 ${indent.length} 個空白:照樣結束,字數 2、examples 一個`, () => {
        expectFence(card(fenced(n, { closeIndent: indent })), n);
      });
    }
  }
});

describe('C3. 開始行 example 後面有空白或 Tab(CommonMark 允許)', () => {
  for (const n of [3, 4]) {
    for (const [name, tail] of [['一個空白', ' '], ['兩個空白', '  '], ['一個 Tab', '\t']] as const) {
      it(`${n} 個反引號、example 後${name}再換行:照樣是 example 圍欄,字數 2、examples 一個`, () => {
        expectFence(card(fenced(n, { openTail: tail })), n);
      });
    }
  }
});

// ---------------------------------------------------------------- D. 不算結束的行(護欄;顧問 5a 裁決乙:①結束反引號後面有字、③貼在內容行尾,CommonMark 也不算)
// 圍欄「裡面」放這種行,圍欄要撐到真正的結束行:examples 含那些行、body 只剩 前、後 = 2。
// 讓「結束不必在行首」「結束反引號後面可以接字」這類改壞轉紅。ee0d8ef 上本來就綠。
describe('D. 圍欄裡面的「N 個反引號後面接字」「內容貼著 N 個反引號結尾」不算結束(護欄)', () => {
  const trapFollowedByWord = (n: number): string => `${TICKS(n)}後面有字`;
  const trapGluedToContent = (n: number): string => `貼著結尾的內容${TICKS(n)}`;
  const cases = (n: number): [string, string[]][] => [
    ['N 個反引號後面接字', [trapFollowedByWord(n)]],
    ['內容貼著 N 個反引號結尾', [trapGluedToContent(n)]],
    ['兩種都有(順序:貼著在前、接字在後)', [trapGluedToContent(n), trapFollowedByWord(n)]],
  ];
  for (const n of [3, 4]) {
    for (const [name, traps] of cases(n)) {
      it(`${n} 個反引號:圍欄裡面有「${name}」的行,圍欄撐到真正的結束行`, () => {
        const inner = `${contentFor(n)}\n${traps.join('\n')}`;
        const raw = card(`前\n${TICKS(n)}example\n${inner}\n${TICKS(n)}\n後`);
        const parsed = parseCardText(raw);
        expect(parsed.examples, '那些行都在 example 裡面,沒有提早結束').toEqual([inner]);
        expect(parsed.body.replace(/\s+/g, ''), 'body 只剩 前、後').toBe('前後');
        const r = validateCard(raw);
        expect(r.errors, '卡要合法').toEqual([]);
        expect(r.bodyWordCount, '圍欄整段拿掉,只剩 前、後').toBe(2);
        expect(r.examplesCount).toBe(1);
        expect(r.card?.examples).toEqual([inner]);
      });
    }
  }
});
