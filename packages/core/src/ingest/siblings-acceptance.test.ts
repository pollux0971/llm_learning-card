/**
 * T18 驗收補測(驗收者寫):siblings.ts 的邊界。Stryker 對 siblings.ts 的存活裡,下面這幾個是缺口
 * (其餘是等價,見 docs/reviews/acceptance-T18.md):
 *   - 排序比較子的「大於」分支壞掉(回 0)時,輸入是倒序就排不好;
 *   - 上限守衛 `others.length > cap` 變成恆真時,50 張(介於 cap/2 與 cap 之間)會少掉前 20 張;
 *   - 分類資料夾讀不了(那個路徑其實是檔案)時要回 [],不是丟錯或回別的東西;
 *   - frontmatter 對不上契約的卡要略過、不丟錯;副檔名不是 .md 的檔案(即使內容像卡)要忽略。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '@contracts/index.js';
import { listSiblings, loadCategoryCards } from './siblings.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function card(id: string, category = 'chemistry', title = `標題${id}`, body = `${id} 的第一句。第二句。`): Card {
  return {
    frontmatter: { id, category, title, level: 0, source: 'raw', source_ref: 'raw/x.md#L1-L2', created: '2026-09-01', prereqs: [] },
    body,
    examples: [],
  } as unknown as Card;
}
const ids = (cards: Card[], parent: Card, cap?: number): string[] => listSiblings(cards, parent, cap).map((s) => s.id);
const PARENT = card('chem-0000');
const num = (n: number): string => `chem-${String(n).padStart(4, '0')}`;

describe('listSiblings 的排序與上限', () => {
  it('輸入是倒序或亂序,輸出一律依 id 遞增', () => {
    const shuffled = [5, 2, 9, 1, 7, 3].map((n) => card(num(n)));
    expect(ids(shuffled, PARENT)).toEqual([1, 2, 3, 5, 7, 9].map(num));
    expect(ids([...shuffled].reverse(), PARENT)).toEqual([1, 2, 3, 5, 7, 9].map(num));
  });

  it('50 張(未超過上限 80)全部保留,一張都不少', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => card(num(i + 1)));
    expect(ids(fifty, PARENT)).toHaveLength(50);
    expect(ids(fifty, PARENT)[0]).toBe(num(1));
  });

  it('剛好 80 張全留;81 張只留 id 最大的 80 張(丟掉最小那一張);自訂 cap 同樣', () => {
    const eighty = Array.from({ length: 80 }, (_, i) => card(num(i + 1)));
    expect(ids(eighty, PARENT)).toHaveLength(80);
    const eightyOne = Array.from({ length: 81 }, (_, i) => card(num(i + 1)));
    const kept = ids(eightyOne, PARENT);
    expect(kept).toHaveLength(80);
    expect(kept[0]).toBe(num(2));
    expect(kept[79]).toBe(num(81));
    expect(ids(Array.from({ length: 10 }, (_, i) => card(num(i + 1))), PARENT, 4)).toEqual([7, 8, 9, 10].map(num));
    expect(ids(Array.from({ length: 6 }, (_, i) => card(num(i + 1))), PARENT, 4)).toEqual([3, 4, 5, 6].map(num));
  });

  it('不改輸入陣列', () => {
    const input = [card(num(3)), card(num(1)), card(num(2))];
    const before = input.map((c) => c.frontmatter.id);
    listSiblings(input, PARENT);
    expect(input.map((c) => c.frontmatter.id)).toEqual(before);
  });
});

describe('loadCategoryCards 的容錯', () => {
  function outDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'lc-t18acc-'));
    dirs.push(d);
    mkdirSync(join(d, 'cards'), { recursive: true });
    return d;
  }
  const cardText = (id: string, category: string): string =>
    `---\nid: ${id}\ncategory: ${category}\ntitle: ${id}\nlevel: 0\nsource: raw\nsource_ref: raw/${category}/x.md#L1-L2\ncreated: 2026-09-01\nprereqs: []\n---\n\n${id} 的內容。\n`;

  it('分類資料夾讀不了(那個路徑是個檔案)→ 回 [],不丟錯', () => {
    const d = outDir();
    writeFileSync(join(d, 'cards', 'chemistry'), '我是檔案不是資料夾');
    expect(loadCategoryCards(d, 'chemistry')).toEqual([]);
  });

  it('分類資料夾不存在 → []', () => {
    expect(loadCategoryCards(outDir(), 'nope')).toEqual([]);
  });

  it('frontmatter 對不上契約的卡(缺 category)略過、不丟錯;其他卡照常載入', () => {
    const d = outDir();
    mkdirSync(join(d, 'cards', 'chemistry'), { recursive: true });
    writeFileSync(join(d, 'cards/chemistry/chem-0001.md'), cardText('chem-0001', 'chemistry'));
    writeFileSync(join(d, 'cards/chemistry/chem-0002.md'), '---\nid: chem-0002\ntitle: 缺欄位\n---\n內容。\n');
    writeFileSync(join(d, 'cards/chemistry/chem-0003.md'), '---\n壞掉的 yaml: [\n---\n內容。\n');
    const loaded = loadCategoryCards(d, 'chemistry');
    expect(loaded.map((c) => c.frontmatter.id)).toEqual(['chem-0001']);
  });

  it('副檔名不是 .md 的檔案(即使內容是合法的卡)與 .short.md 都忽略', () => {
    const d = outDir();
    mkdirSync(join(d, 'cards', 'chemistry'), { recursive: true });
    writeFileSync(join(d, 'cards/chemistry/chem-0001.md'), cardText('chem-0001', 'chemistry'));
    writeFileSync(join(d, 'cards/chemistry/chem-0002.txt'), cardText('chem-0002', 'chemistry'));
    writeFileSync(join(d, 'cards/chemistry/chem-0003.md.bak'), cardText('chem-0003', 'chemistry'));
    writeFileSync(join(d, 'cards/chemistry/chem-0004.short.md'), cardText('chem-0004', 'chemistry'));
    expect(loadCategoryCards(d, 'chemistry').map((c) => c.frontmatter.id)).toEqual(['chem-0001']);
  });
});
