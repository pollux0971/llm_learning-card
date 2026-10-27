/**
 * T58 紅測試(a):寫卡片時 example 圍欄的長度跟著內容走(ADR-082)。
 * 工單:docs/tickets/T58-card-writer-fence-length.md 第 4 節 (a)。測試 agent 寫;開發 worker 不改。
 *
 * 直接呼叫新檔 card-file.ts 的 renderCardFile,27 列表每一列斷言:
 *   1. 寫出的每個 example 圍欄,開始行與結束行剛好是表上那麼多個反引號(開始行是那串反引號接 `example`)。
 *      量法:用 markdown-it(跟 core 讀的同一組選項)解析寫出來的檔,讀頂層 fence token 的 markup 長度,
 *      再用 token.map 看開始行與結束行的原文。不用整份檔找「反引號接 example」的行
 *      (第 9 列的內容裡有一行長得像開始行)。
 *   2. 用 T57 的解析器 parseCardText 讀回:body 與 examples 跟表一樣。
 *   3. 穩定:讀回的 body 與 examples 再寫一次、再讀回,結果跟第一次讀回一樣(deps 改寫卡片的那條路)。
 * 第 1、16、21 列另外比整份檔逐字(期望值手寫)。
 *
 * 載入方式:被測模組用動態 import 算出來的 file URL(紅測試在 base 上要 tsc 乾淨,而新檔在 base 上還不存在)。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { CARD_MARKDOWN_OPTIONS, isExampleFence } from '@contracts/card-markdown.js';
import { parseCardText } from '@core/schema/parse-card.js';

type RenderArgs = { frontmatter: object; body: string; examples: readonly string[] };
type Render = (card: RenderArgs) => string;

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD_FILE = join(HERE, 'card-file.ts');

async function loadRender(): Promise<Render> {
  expect(existsSync(CARD_FILE), 'packages/core/src/ingest/card-file.ts 要存在(ADR-082:只留一個寫卡片的函式)').toBe(true);
  const mod = (await import(pathToFileURL(CARD_FILE).href)) as { renderCardFile?: Render };
  expect(typeof mod.renderCardFile, 'card-file.ts 要 export renderCardFile').toBe('function');
  return mod.renderCardFile as Render;
}

const K = '`';
const T = K.repeat(3);
const Q = K.repeat(4);
const F = K.repeat(5);
const X = K.repeat(10);
const W = '~'.repeat(3);

const FM = { id: 'sec-0001', category: 'security', title: '卡', level: 0, source: 'raw', created: '2026-09-01', prereqs: [] as string[] };

interface Row {
  n: number;
  note: string;
  body?: string;
  examples: string[];
  /** 這次寫進去的 example 圍欄,各自的反引號個數(依序) */
  fences: number[];
  /** 讀回的 examples */
  out: string[];
  /** 讀回的 body;沒寫就是 body 原樣(trim) */
  bodyOut?: string;
}

const ROWS: Row[] = [
  { n: 1, note: '最少 3', examples: ['範例'], fences: [3], out: ['範例'] },
  { n: 2, note: '一個反引號', examples: [`${K}c${K}`], fences: [3], out: [`${K}c${K}`] },
  { n: 3, note: '兩個反引號', examples: [`a${K}${K}b`], fences: [3], out: [`a${K}${K}b`] },
  { n: 4, note: '內層程式碼圍欄(§2 那句)', examples: [`${T}js\nx\n${T}`], fences: [4], out: [`${T}js\nx\n${T}`] },
  { n: 5, note: '內層四個', examples: [`${Q}\nx\n${Q}`], fences: [5], out: [`${Q}\nx\n${Q}`] },
  { n: 6, note: '行中的也算', examples: [`a ${T} b`], fences: [4], out: [`a ${T} b`] },
  { n: 7, note: '只有三個反引號', examples: [T], fences: [4], out: [T] },
  { n: 8, note: '十個', examples: [X], fences: [11], out: [X] },
  { n: 9, note: '內層是 example 圍欄', examples: [`${T}example\ninner\n${T}`], fences: [4], out: [`${T}example\ninner\n${T}`] },
  { n: 10, note: '波浪號不算', examples: [`${W}\nx\n${W}`], fences: [3], out: [`${W}\nx\n${W}`] },
  { n: 11, note: '空字串', examples: [''], fences: [3], out: [''] },
  { n: 12, note: '三個空白', examples: ['   '], fences: [3], out: [''] },
  { n: 13, note: 'CRLF', examples: ['l1\r\nl2'], fences: [3], out: ['l1\nl2'] },
  { n: 14, note: '只有 CR', examples: ['x\ry'], fences: [3], out: ['x\ny'] },
  { n: 15, note: 'NUL', examples: ['a\u0000b'], fences: [3], out: ['a�b'] },
  { n: 16, note: '寫之前 trim', examples: ['  lead  '], fences: [3], out: ['lead'] },
  { n: 17, note: '最後一行五個', examples: [`x\n${F}`], fences: [6], out: [`x\n${F}`] },
  { n: 18, note: '中間一行只有三個', examples: [`before\n${T}\nafter`], fences: [4], out: [`before\n${T}\nafter`] },
  { n: 19, note: 'Tab 留著', examples: ['a\n\tb'], fences: [3], out: ['a\n\tb'] },
  { n: 20, note: '行尾的也算', examples: [`foo${T}`], fences: [4], out: [`foo${T}`] },
  {
    n: 21,
    note: '三個 example 各自算,不是整張卡取最大',
    examples: [`${T}js\nx\n${T}`, `${Q}\nx\n${Q}`, 'plain'],
    fences: [4, 5, 3],
    out: [`${T}js\nx\n${T}`, `${Q}\nx\n${Q}`, 'plain'],
  },
  {
    n: 22,
    note: 'body 裡關好的程式碼圍欄不變',
    body: `a\n\n${T}js\nx\n${T}`,
    examples: ['plain', `${T}py\ny\n${T}`],
    fences: [3, 4],
    out: ['plain', `${T}py\ny\n${T}`],
    bodyOut: `a\n\n${T}js\nx\n${T}`,
  },
  {
    n: 23,
    note: 'body 自己的 example 在前面',
    body: `a\n\n${T}example\nz\n${T}`,
    examples: ['plain'],
    fences: [3],
    out: ['z', 'plain'],
    bodyOut: 'a',
  },
  {
    n: 24,
    note: 'body 的 CRLF 不變',
    body: 'a\r\nb',
    examples: [`${T}\nq\n${T}`],
    fences: [4],
    out: [`${T}\nq\n${T}`],
    bodyOut: 'a\r\nb',
  },
  {
    n: 25,
    note: 'body 結尾是清單、引用、縮排程式碼',
    body: 'a\n\n- p\n\n> q\n\n    code',
    examples: [`${T}\nq\n${T}`],
    fences: [4],
    out: [`${T}\nq\n${T}`],
    bodyOut: 'a\n\n- p\n\n> q\n\n    code',
  },
  {
    n: 26,
    note: '同一個 example 內兩串反引號,最長的在前(四個,之後再一串三個)',
    examples: [`${Q}\nx\n${T}`],
    fences: [5],
    out: [`${Q}\nx\n${T}`],
  },
  {
    n: 27,
    note: '同一個 example 內兩串反引號,最長的在後(三個,之後再一串四個)',
    examples: [`${T}\nx\n${Q}`],
    fences: [5],
    out: [`${T}\nx\n${Q}`],
  },
];

/** 寫出的檔裡,這次寫進去的 example 圍欄:取最後 n 個頂層 example fence(body 自己的在前面)。 */
function writtenFences(file: string, n: number): { markup: string; open: string; close: string }[] {
  const content = matter(file).content;
  const md = new MarkdownIt(CARD_MARKDOWN_OPTIONS);
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const all = md
    .parse(content, {})
    .filter((t) => t.type === 'fence' && t.level === 0 && isExampleFence(t.info))
    .map((t) => ({
      markup: t.markup,
      open: lines[t.map![0]!]!,
      close: lines[t.map![1]! - 1]!,
    }));
  return all.slice(all.length - n);
}

describe('T58(a) card-file.ts 的 renderCardFile:27 列寫入 → 讀回', () => {
  for (const row of ROWS) {
    it(`第 ${row.n} 列 ${row.note}:圍欄 ${row.fences.join('、')} 個反引號;讀回的 body 與 examples 照表;再寫一次再讀回不變`, async () => {
      const render = await loadRender();
      const body = row.body ?? '正文';
      const file = render({ frontmatter: FM, body, examples: row.examples });

      const fences = writtenFences(file, row.examples.length);
      expect(
        fences.map((f) => f.markup.length),
        `第 ${row.n} 列:每個 example 圍欄的反引號個數`,
      ).toEqual(row.fences);
      for (const [i, f] of fences.entries()) {
        const ticks = K.repeat(row.fences[i]!);
        expect(f.markup, `第 ${row.n} 列第 ${i + 1} 個圍欄只用反引號`).toBe(ticks);
        expect(f.open, `第 ${row.n} 列第 ${i + 1} 個圍欄的開始行`).toBe(`${ticks}example`);
        expect(f.close, `第 ${row.n} 列第 ${i + 1} 個圍欄的結束行`).toBe(ticks);
      }

      const back = parseCardText(file);
      expect(back.examples, `第 ${row.n} 列讀回的 examples`).toEqual(row.out);
      expect(back.body, `第 ${row.n} 列讀回的 body`).toBe(row.bodyOut ?? body.trim());

      const file2 = render({ frontmatter: back.frontmatter, body: back.body, examples: back.examples });
      const back2 = parseCardText(file2);
      expect(back2.examples, `第 ${row.n} 列再寫一次再讀回:examples`).toEqual(back.examples);
      expect(back2.body, `第 ${row.n} 列再寫一次再讀回:body`).toBe(back.body);
    });
  }

  it('表有 27 列、編號 1 到 27(沒有漏列)', () => {
    expect(ROWS.map((r) => r.n)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
  });
});

describe('T58(a) 整份檔逐字比對(期望值手寫)', () => {
  const FM_MIN = { id: 'sec-0001', title: '卡' };
  const HEAD = '---\nid: sec-0001\ntitle: 卡\n---\n\n';

  it('第 1 列:沒有三個以上反引號時跟今天一字不差(frontmatter、body 後空一行、結尾一個換行)', async () => {
    const render = await loadRender();
    expect(render({ frontmatter: FM_MIN, body: '正文', examples: ['範例'] })).toBe(`${HEAD}正文\n\n${T}example\n範例\n${T}\n`);
  });

  it('兩個 example 之間空一行;沒有 example 就沒有結尾區塊;body 前後空白去掉', async () => {
    const render = await loadRender();
    expect(render({ frontmatter: FM_MIN, body: '  正文  \n', examples: ['一', '二'] })).toBe(
      `${HEAD}正文\n\n${T}example\n一\n${T}\n\n${T}example\n二\n${T}\n`,
    );
    expect(render({ frontmatter: FM_MIN, body: '正文', examples: [] })).toBe(`${HEAD}正文\n`);
  });

  it('第 16 列:example 寫之前 trim(前後各兩個空白不見)', async () => {
    const render = await loadRender();
    expect(render({ frontmatter: FM_MIN, body: '正文', examples: ['  lead  '] })).toBe(`${HEAD}正文\n\n${T}example\nlead\n${T}\n`);
  });

  it('第 21 列:三個 example 各自的圍欄長度(4、5、3),整份檔逐字', async () => {
    const render = await loadRender();
    const file = render({ frontmatter: FM_MIN, body: '正文', examples: [`${T}js\nx\n${T}`, `${Q}\nx\n${Q}`, 'plain'] });
    expect(file).toBe(
      `${HEAD}正文\n\n` +
        `${Q}example\n${T}js\nx\n${T}\n${Q}\n\n` +
        `${F}example\n${Q}\nx\n${Q}\n${F}\n\n` +
        `${T}example\nplain\n${T}\n`,
    );
  });

  it('參數型別放寬:frontmatter 只要是物件、examples 可以是唯讀陣列(ingest 的 CardFrontmatter 的 prereqs 是選填的)', async () => {
    const render = await loadRender();
    const examples: readonly string[] = ['a'];
    expect(render({ frontmatter: { id: 'x' }, body: 'b', examples })).toBe(`---\nid: x\n---\n\nb\n\n${T}example\na\n${T}\n`);
  });
});
