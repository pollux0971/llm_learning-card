/**
 * T18 (a):`siblings.ts` 的三個純函式與一個讀磁碟的函式。
 *
 * 規格:`docs/tickets/T18-children-sees-sibling-cards.md` 的 (a)(b)。`siblings.ts` 還不存在,
 * 所以用算出來的 file URL 動態 import,型別用本檔的介面(tsc 照樣乾淨);取不到就以「還沒有 siblings.ts」紅,
 * 不是測試自己壞掉。
 *
 * 一律暫存目錄,不碰真的 learning/。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Card } from '@contracts/index.js';

interface Sibling {
  id: string;
  title: string;
  summary: string;
}
interface SiblingsModule {
  cardSummary(body: string): string;
  listSiblings(cards: Card[], parent: Card, cap?: number): Sibling[];
  loadCategoryCards(outDir: string, category: string): Card[];
  formatAlreadyCovered(siblings: Sibling[]): string[];
}

let mod: Partial<SiblingsModule> = {};
let loadError = '';
beforeAll(async () => {
  try {
    mod = (await import(pathToFileURL(join(import.meta.dirname, 'siblings.ts')).href)) as Partial<SiblingsModule>;
  } catch (err) {
    loadError = (err as Error).message;
  }
});

function need<K extends keyof SiblingsModule>(name: K): SiblingsModule[K] {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`packages/core/src/ingest/siblings.ts 還沒有匯出 ${name}(T18 要求 (a)(b))${loadError ? `:${loadError}` : ''}`);
  }
  return fn as SiblingsModule[K];
}

function card(id: string, over: { title?: string; body?: string; category?: string; level?: number } = {}): Card {
  const category = over.category ?? 'security';
  const level = over.level ?? 0;
  return {
    frontmatter: {
      id,
      category,
      title: over.title ?? `標題 ${id}`,
      level,
      source: level === 0 ? 'raw' : 'llm',
      created: '2026-09-01',
      ...(level === 0 ? { source_ref: 'raw/security/x.md#L1-L2' } : { parent: 'sec-0001' }),
      prereqs: [],
      provisional: false,
      stale: false,
      source_missing: false,
    } as Card['frontmatter'],
    body: over.body ?? `${id} 的第一句。第二句不該出現。`,
    examples: [],
  };
}

// ================================================================ cardSummary

describe('cardSummary(T18 (a)):body 的第一句,60 字上限', () => {
  it('取到第一個全形句號為止,句號留著', () => {
    expect(need('cardSummary')('甲乙丙。丁戊己。')).toBe('甲乙丙。');
  });

  it.each([
    ['全形驚嘆號', '小心！後面還有。', '小心！'],
    ['全形問號', '為什麼？因為如此。', '為什麼？'],
    ['半形驚嘆號', '小心!後面還有。', '小心!'],
    ['半形問號', '為什麼?因為如此。', '為什麼?'],
  ])('%s也是句子結束', (_name, body, expected) => {
    expect(need('cardSummary')(body)).toBe(expected);
  });

  it('「.」後面接空白或字串結尾才算句子結束(小數點、縮寫中間不算)', () => {
    const summary = need('cardSummary');
    expect(summary('Version 2.0 is out. The rest is ignored.')).toBe('Version 2.0 is out.');
    expect(summary('e.g.這不是句子結束,也沒有別的結束符')).toBe('e.g.這不是句子結束,也沒有別的結束符');
    expect(summary('Ends with a dot.')).toBe('Ends with a dot.');
  });

  it('沒有句子結束符就取整段', () => {
    expect(need('cardSummary')('沒有句號的一段話')).toBe('沒有句號的一段話');
  });

  it('換行與連續空白壓成一個半形空格,頭尾去掉', () => {
    expect(need('cardSummary')('  第一行\n第二行\t\t還是第一句。第二句。  ')).toBe('第一行 第二行 還是第一句。');
  });

  // 四個反引號、內含三個反引號內層圍欄的那種(契約 §2 的向量)不測:現有的 normalizeBody 與 parseCardText
  // 都還不照「同數量結束」切(T20 要修),T18 不該先依賴它。這裡只測三個反引號的一般圍欄。
  it('example 圍欄不算進摘要(三個反引號的一般圍欄)', () => {
    const summary = need('cardSummary');
    expect(summary('```example\n圍欄裡的句子。\n```\n真正的第一句。第二句。')).toBe('真正的第一句。');
    expect(summary('前面的話\n```example\n圍欄裡有句號。\n```\n接著說完。後面。')).toBe('前面的話 接著說完。');
  });

  it('剛好 60 個字不截;61 個字截到 60 再加「…」', () => {
    const summary = need('cardSummary');
    expect(summary('字'.repeat(60))).toBe('字'.repeat(60));
    expect(summary('字'.repeat(61))).toBe(`${'字'.repeat(60)}…`);
    expect([...summary('字'.repeat(61))]).toHaveLength(61);
  });

  it('第一句本身超過 60 字也截(句號被截掉)', () => {
    expect(need('cardSummary')(`${'句'.repeat(70)}。第二句。`)).toBe(`${'句'.repeat(60)}…`);
    expect(need('cardSummary')(`${'句'.repeat(59)}。後面。`)).toBe(`${'句'.repeat(59)}。`);
  });

  it('以 code point 算,不拆代理對', () => {
    const out = need('cardSummary')(`${'字'.repeat(59)}😀😀`);
    expect(out).toBe(`${'字'.repeat(59)}😀…`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false);
  });
});

// ================================================================ listSiblings

describe('listSiblings(T18 (a)):同分類的其他卡,依 id 排序,上限 80 保留 id 最大的', () => {
  it('排除父卡自己;回 id、title、summary;依 id 遞增', () => {
    const parent = card('sec-0002');
    const cards = [card('sec-0003'), parent, card('sec-0001', { title: '第一張', body: '一號卡的第一句。後面。' })];
    expect(need('listSiblings')(cards, parent)).toEqual([
      { id: 'sec-0001', title: '第一張', summary: '一號卡的第一句。' },
      { id: 'sec-0003', title: '標題 sec-0003', summary: 'sec-0003 的第一句。' },
    ]);
  });

  it('level 1 的子卡也列(already_covered 是「已有卡片(含子卡)」)', () => {
    const parent = card('sec-0001');
    const out = need('listSiblings')([parent, card('sec-0002', { level: 1 })], parent);
    expect(out.map((s) => s.id)).toEqual(['sec-0002']);
  });

  it('別的分類的卡不混進來', () => {
    const parent = card('sec-0001');
    const out = need('listSiblings')([parent, card('net-0001', { category: 'network' }), card('sec-0002')], parent);
    expect(out.map((s) => s.id)).toEqual(['sec-0002']);
  });

  it('超過上限(預設 80)時保留 id 最大的 80 張,仍依 id 遞增', () => {
    const parent = card('sec-0001');
    const others = Array.from({ length: 100 }, (_, i) => card(`sec-${String(i + 2).padStart(4, '0')}`));
    const out = need('listSiblings')([...others].reverse().concat(parent), parent);
    expect(out).toHaveLength(80);
    expect(out[0]!.id).toBe('sec-0022');
    expect(out[79]!.id).toBe('sec-0101');
    expect(out.map((s) => s.id)).toEqual([...out.map((s) => s.id)].sort());
  });

  it('cap 可以指定;剛好等於上限時不砍', () => {
    const parent = card('sec-0001');
    const others = ['sec-0002', 'sec-0003', 'sec-0004'].map((id) => card(id));
    expect(need('listSiblings')([parent, ...others], parent, 2).map((s) => s.id)).toEqual(['sec-0003', 'sec-0004']);
    expect(need('listSiblings')([parent, ...others], parent, 3).map((s) => s.id)).toEqual(['sec-0002', 'sec-0003', 'sec-0004']);
  });

  it('摘要用的就是 cardSummary;不改輸入陣列', () => {
    const parent = card('sec-0001');
    const body = `${'長'.repeat(61)}`;
    const cards = [card('sec-0003'), parent, card('sec-0002', { body })];
    const before = cards.map((c) => c.frontmatter.id);
    const out = need('listSiblings')(cards, parent);
    expect(out.find((s) => s.id === 'sec-0002')!.summary).toBe(need('cardSummary')(body));
    expect(cards.map((c) => c.frontmatter.id)).toEqual(before);
  });
});

// ================================================================ formatAlreadyCovered

describe('formatAlreadyCovered(T18 (b)):already_covered 區塊的行', () => {
  it('沒有 sibling → 空陣列(整段省略,不印空的 already_covered:)', () => {
    expect(need('formatAlreadyCovered')([])).toEqual([]);
  });

  it('一張卡一行,全形冒號;標題裡的換行壓成一個空格', () => {
    expect(
      need('formatAlreadyCovered')([
        { id: 'sec-0002', title: '跨\n行標題', summary: '第一句。' },
        { id: 'sec-0003', title: '第二張', summary: '另一句。' },
      ]),
    ).toEqual(['already_covered:', '- 跨 行標題:第一句。', '- 第二張:另一句。']);
  });
});

// ================================================================ loadCategoryCards

describe('loadCategoryCards(T18 (a)):讀 cards/<category>/*.md', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  function outDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'lc-t18-load-'));
    dirs.push(d);
    return d;
  }

  function writeCard(root: string, category: string, id: string, title: string, body: string): void {
    const dir = join(root, 'cards', category);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${id}.md`),
      `---\nid: ${id}\ncategory: ${category}\ntitle: ${title}\nlevel: 0\nsource: raw\ncreated: 2026-09-01\nsource_ref: raw/${category}/x.md#L1-L2\nprereqs: []\n---\n\n${body}\n`,
      'utf8',
    );
  }

  it('讀到該分類的卡;不讀 .short.md、不讀別的分類;壞掉的卡檔略過、不丟錯', () => {
    const root = outDir();
    writeCard(root, 'security', 'sec-0001', '一號', '一號的內文。');
    writeCard(root, 'security', 'sec-0002', '二號', '二號的內文。');
    // 縮短版的 frontmatter 完整合法:要靠檔名排除,不是靠解析失敗剛好略過
    writeFileSync(join(root, 'cards/security/sec-0001.short.md'), `---\nid: sec-0001\ncategory: security\ntitle: 縮短版\nlevel: 0\nsource: raw\ncreated: 2026-09-01\nsource_ref: raw/security/x.md#L1-L2\nprereqs: []\n---\n\n縮短版。\n`, 'utf8');
    writeFileSync(join(root, 'cards/security/sec-0009.md'), '---\nid: [沒有結尾\n---\n\n壞掉的 frontmatter\n', 'utf8');
    writeFileSync(join(root, 'cards/security/notes.txt'), '不是卡片', 'utf8');
    writeCard(root, 'network', 'net-0001', '別的分類', '不該被讀到。');

    const cards = need('loadCategoryCards')(root, 'security');
    expect(cards.map((c) => c.frontmatter.id).sort()).toEqual(['sec-0001', 'sec-0002']);
    expect(cards.find((c) => c.frontmatter.id === 'sec-0002')!.body).toBe('二號的內文。');
    expect(cards.find((c) => c.frontmatter.id === 'sec-0001')!.frontmatter.title).toBe('一號');
  });

  it('分類資料夾還不存在 → 空陣列,不丟錯', () => {
    expect(need('loadCategoryCards')(outDir(), 'security')).toEqual([]);
  });
});
