/**
 * T51:契約 §2(1.2.0,ADR-060)的字數向量寫成 `validateCard` 的測試——兩張表每一列,加上 fixture valid-example-with-nested-content.md。
 * 工單:docs/tickets/T51-parse-card-fence-backtick-count.md「測試」。測試 agent 寫;開發 worker 不改。
 *
 * 每一列都包成一張合法的卡(frontmatter 合法、body 就是那一列的內容),跑 `validateCard`,比 `bodyWordCount`(圍欄那幾列再比 `examplesCount`)。
 * 圍欄那幾列的寫法:開始那一行、內容、結束那一行各自一行;`前`、`後` 各在圍欄的前一段與後一段。
 * 不放:開閉在同一行、未閉合、結束的反引號比開始多、`example` 後面還有字、縮排(契約沒定義,工單要求不測、碰到停)。
 *
 * 在 T20 合併後的 main(bfe1424)上:四反引號相關(向量那一列、fixture、examples)紅,原因是 parse-card.ts 的 EXAMPLE_FENCE_RE 寫死三個反引號;其餘本來就綠(護欄)。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCardText } from './parse-card.js';
import { validateCard } from './validate-card.js';

const ROOT = join(import.meta.dirname, '../../../..');
const FM = ['id: sec-0001', 'category: security', 'title: 測試卡', 'level: 0', 'source: llm', 'created: 2026-09-01'].join('\n');
const card = (body: string, eol = '\n'): string => `---${eol}${FM.replace(/\n/g, eol)}${eol}---${eol}${body.replace(/\n/g, eol)}${eol}`;

const T3 = '```';
const T4 = '````';
const T5 = '`````';

describe('契約 §2「關鍵推論」六列', () => {
  const rows: [string, string, number][] = [
    ['same-origin', 'same-origin', 2],
    ['TLS', 'TLS', 1],
    ['1.5', '1.5', 2],
    ["don't", "don't", 2],
    ['同源政策', '同源政策', 4],
    ['RFC 6265', 'RFC 6265', 2],
  ];
  for (const [name, body, words] of rows) {
    it(`${name} = ${words}`, () => {
      const r = validateCard(card(body));
      expect(r.errors, '卡要合法').toEqual([]);
      expect(r.bodyWordCount).toBe(words);
    });
  }
});

describe('契約 §2「1.2.0 向量表」十列', () => {
  const cjk: [string, string][] = [
    ['同源(Han)', '同源'],
    ['U+3400 ×2(擴充 A)', '㐀㐀'],
    ['U+20000 ×2(擴充 B)', '\u{20000}\u{20000}'],
    ['U+F900 ×2(相容區)', '豈豈'],
    ['U+1100 ×2(Hangul Jamo)', 'ᄀᄀ'],
    ['U+3131 ×2(Hangul 相容字母)', 'ㄱㄱ'],
    ['か、カ 各一,相連(Hiragana、Katakana)', 'かカ'],
  ];
  for (const [name, body] of cjk) {
    it(`${name} = 2`, () => {
      const r = validateCard(card(body));
      expect(r.errors, '卡要合法').toEqual([]);
      expect(r.bodyWordCount).toBe(2);
    });
  }

  it('前 + 三反引號 example 圍欄(內含「內容 內容」) + 後 = 2', () => {
    const r = validateCard(card(`前\n${T3}example\n內容 內容\n${T3}\n後`));
    expect(r.errors).toEqual([]);
    expect(r.bodyWordCount).toBe(2);
    expect(r.examplesCount).toBe(1);
  });

  it('前 + 四反引號 example 圍欄(內含一個三反引號的內層圍欄與文字) + 後 = 2', () => {
    const r = validateCard(card(`前\n${T4}example\n${T3}js\nconst x = 1;\n${T3}\n內層文字\n${T4}\n後`));
    expect(r.errors, '卡要合法').toEqual([]);
    expect(r.bodyWordCount, '整個四反引號圍欄要從 body 拿掉,內層程式碼與文字都不算').toBe(2);
    expect(r.examplesCount).toBe(1);
  });

  it('三反引號 js 圍欄,內容 ab = 2(不是 example 圍欄,不移除;js、ab 各 1,反引號計 0)', () => {
    const r = validateCard(card(`${T3}js\nab\n${T3}`));
    expect(r.errors).toEqual([]);
    expect(r.bodyWordCount).toBe(2);
    expect(r.examplesCount).toBe(0);
  });
});

describe('四反引號 example 圍欄:body、examples、validateCard 一起對', () => {
  const INNER = `${T3}js\nconst x = 1;\n${T3}\n內層文字`;
  const FOUR = `前\n${T4}example\n${INNER}\n${T4}\n後`;

  it('examples 只有一個,內容是整個圍欄裡面(含內層三反引號的開始與結束兩行、內層文字),已 trim', () => {
    const parsed = parseCardText(card(FOUR));
    expect(parsed.examples, '被內層的三反引號截斷就會多出或少掉東西').toEqual([INNER]);
  });

  it('body 裡沒有反引號,只剩前、後', () => {
    const parsed = parseCardText(card(FOUR));
    expect(parsed.body).not.toContain('`');
    expect(parsed.body.replace(/\s+/g, '')).toBe('前後');
  });

  it('validateCard:examplesCount 1、字數 2、example 裡有內層圍欄的兩行與文字', () => {
    const r = validateCard(card(FOUR));
    expect(r.ok).toBe(true);
    expect(r.examplesCount).toBe(1);
    expect(r.bodyWordCount).toBe(2);
    expect(r.card?.examples[0]).toBe(INNER);
    expect(r.card?.examples[0]!.split('\n').filter((l) => l.startsWith(T3)).length, '內層圍欄的開始與結束兩行').toBe(2);
  });

  it('CRLF:同一張卡用 \\r\\n,字數還是 2、examples 還是一個', () => {
    const r = validateCard(card(FOUR, '\r\n'));
    expect(r.bodyWordCount).toBe(2);
    expect(r.examplesCount).toBe(1);
  });

  it('五反引號圍欄裡有四反引號的內層圍欄:數量比開始少的不結束,整段是一個 example,字數 2', () => {
    const inner = `${T4}example\n巢狀\n${T4}`;
    const raw = card(`前\n${T5}example\n${inner}\n${T5}\n後`);
    const parsed = parseCardText(raw);
    expect(parsed.examples).toEqual([inner]);
    expect(validateCard(raw).bodyWordCount).toBe(2);
  });

  it('一張卡裡四反引號與三反引號的 example 依序收集、各自 trim,body 剩 前、中、後', () => {
    const raw = card(`前\n${T4}example\n${T3}ts\nA\n${T3}\n${T4}\n中\n${T3}example\nB\n${T3}\n後`);
    const parsed = parseCardText(raw);
    expect(parsed.examples).toEqual([`${T3}ts\nA\n${T3}`, 'B']);
    expect(parsed.body.replace(/\s+/g, '')).toBe('前中後');
    expect(validateCard(raw).bodyWordCount).toBe(3);
  });

  it('四反引號圍欄後面的普通三反引號 js 圍欄照算(不移除)', () => {
    const raw = card(`${T4}example\n${INNER}\n${T4}\n${T3}js\nab\n${T3}`);
    const parsed = parseCardText(raw);
    expect(parsed.examples).toEqual([INNER]);
    expect(validateCard(raw).bodyWordCount, 'js 圍欄裡的 js、ab 各 1').toBe(2);
  });
});

describe('fixture valid-example-with-nested-content.md', () => {
  const raw = readFileSync(join(ROOT, 'contracts/fixtures/cards/valid-example-with-nested-content.md'), 'utf8');

  it('validateCard:ok、bodyWordCount 27、examplesCount 1', () => {
    const r = validateCard(raw);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.bodyWordCount, '圍欄(含裡面的 ts 程式碼區塊)整個拿掉,只剩開頭那一句').toBe(27);
    expect(r.examplesCount).toBe(1);
  });

  it('那一個 example 含內層的程式碼圍欄(開始與結束兩行),body 裡沒有反引號', () => {
    const r = validateCard(raw);
    const ex = r.card?.examples[0] ?? '';
    expect(ex).toContain('```ts');
    expect(ex).toContain('const csp = "script-src \'self\'";');
    expect(ex.split('\n').filter((l) => l.startsWith('```')).length).toBe(2);
    expect(ex.startsWith('允許的來源')).toBe(true);
    expect(r.card?.body).not.toContain('`');
  });
});
