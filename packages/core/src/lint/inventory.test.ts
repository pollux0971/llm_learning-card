/**
 * `inventory()` / `formatScanSummary()` / `formatZeroCards()` 的單元測試(P-28)。
 *
 * 為什麼要跟 `scripts/lint.test.ts` 分開:那一支 spawn 真的 CLI,守的是
 * 「使用者在終端機看到什麼」——那層對得起使用者,但對得起不了細節。變異測試
 * 把差距指得很清楚:清點邏輯裡的 `.filter(n => n.endsWith('.yaml'))`、
 * `.sort()`、`'graph/deps.json 缺'` 這些東西全部改掉,CLI 的輸出照樣通過
 * (基準 60.23%,scan.ts 只有 48.89%)。
 *
 * 所以這一層直接對純函式斷言:數字與字串各自的**來源**都要被釘住,
 * CLI 那一層繼續守整條路徑。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inventory, type DirInventory } from './scan.js';
import { formatScanSummary, formatZeroCards, SCANNER_BROKEN } from './report.js';

const tmpDirs: string[] = [];

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-inventory-'));
  tmpDirs.push(dir);
  return dir;
}

/** 卡片檔的內容對清點無關(inventory 不 parse),但寫成像樣的卡片比較不誤導。 */
function card(id: string): string {
  return `---\nid: ${id}\n---\n內容\n`;
}

function writeCard(root: string, category: string, name: string): void {
  mkdirSync(join(root, 'cards', category), { recursive: true });
  writeFileSync(join(root, 'cards', category, name), card(name.replace(/\..*$/, '')), 'utf8');
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe('inventory():類別', () => {
  it('cards/ 不存在時,categories 是空的(不是憑空生出一個項目)', () => {
    const root = tmpRoot();
    const inv = inventory(root);

    expect(inv.cardsDirExists).toBe(false);
    expect(inv.categories).toEqual([]);
    expect(inv.emptyCategories).toEqual([]);
  });

  it('cards/ 底下的檔案不算類別——只有子目錄才算', () => {
    const root = tmpRoot();
    writeCard(root, 'security', 'sec-0001.md');
    writeFileSync(join(root, 'cards', 'README.md'), '這不是類別\n', 'utf8');

    expect(inventory(root).categories).toEqual(['security']);
  });

  it('categories 排序過,不是磁碟給什麼順序就用什麼', () => {
    const root = tmpRoot();
    // 十個目錄,故意用不照字母序的建立順序。readdir 的原始順序在 ext4 上是
    // hash 序,幾乎不可能剛好等於字母序,所以 .sort() 被拿掉就會紅。
    for (const name of ['zeta', 'mu', 'alpha', 'nu', 'beta', 'xi', 'gamma', 'omicron', 'delta', 'pi']) {
      writeCard(root, name, `${name}-0001.md`);
    }

    const { categories } = inventory(root);
    expect(categories).toEqual([...categories].sort());
    expect(categories).toEqual(['alpha', 'beta', 'delta', 'gamma', 'mu', 'nu', 'omicron', 'pi', 'xi', 'zeta']);
  });

  it('emptyCategories 只列真的空的那些,不是把所有類別都算進去', () => {
    const root = tmpRoot();
    writeCard(root, 'security', 'sec-0001.md');
    mkdirSync(join(root, 'cards', 'network'), { recursive: true });

    const inv = inventory(root);
    expect(inv.categories).toEqual(['network', 'security']);
    expect(inv.emptyCategories).toEqual(['network']);
  });
});

describe('inventory():卡片數', () => {
  it('只數 .md,別的副檔名不算', () => {
    const root = tmpRoot();
    writeCard(root, 'security', 'sec-0001.md');
    writeFileSync(join(root, 'cards/security/notes.txt'), '不是卡片\n', 'utf8');
    writeFileSync(join(root, 'cards/security/sec-0001.yaml'), '不是卡片\n', 'utf8');

    expect(inventory(root).cards).toBe(1);
  });

  it('`.short.md` 是同一張卡的縮短版,不另外計數', () => {
    const root = tmpRoot();
    writeCard(root, 'security', 'sec-0001.md');
    writeCard(root, 'security', 'sec-0001.short.md');

    expect(inventory(root).cards).toBe(1);
  });

  it('跨類別加總', () => {
    const root = tmpRoot();
    writeCard(root, 'security', 'sec-0001.md');
    writeCard(root, 'security', 'sec-0002.md');
    writeCard(root, 'network', 'net-0001.md');

    expect(inventory(root).cards).toBe(3);
  });
});

describe('inventory():考題數', () => {
  it('只數 questions/*.yaml', () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'questions'), { recursive: true });
    writeFileSync(join(root, 'questions/sec-0001.yaml'), 'card: sec-0001\n', 'utf8');
    writeFileSync(join(root, 'questions/README.md'), '說明\n', 'utf8');
    writeFileSync(join(root, 'questions/sec-0002.yml'), 'card: sec-0002\n', 'utf8');

    expect(inventory(root).questions).toBe(1);
  });

  it('questions/ 不存在就是 0', () => {
    expect(inventory(tmpRoot()).questions).toBe(0);
  });
});

describe('inventory():graph', () => {
  it('depsFile 看的是 graph/deps.json,不是別的東西存不存在', () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'graph'), { recursive: true });
    expect(inventory(root).depsFile).toBe(false);

    writeFileSync(join(root, 'graph/deps.json'), '{}\n', 'utf8');
    expect(inventory(root).depsFile).toBe(true);
  });

  it('orderFiles 只收 graph/ 底下 order- 開頭且 .json 結尾的,排序過', () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'graph'), { recursive: true });
    const keep = ['order-zeta.json', 'order-mu.json', 'order-alpha.json', 'order-nu.json', 'order-beta.json'];
    const drop = ['order-notes.txt', 'deps.json', 'ordering.json', 'security-order-.json', 'order-'];
    for (const name of [...keep, ...drop]) writeFileSync(join(root, 'graph', name), '{}\n', 'utf8');

    const { orderFiles } = inventory(root);
    expect(orderFiles).toEqual(['order-alpha.json', 'order-beta.json', 'order-mu.json', 'order-nu.json', 'order-zeta.json']);
  });

  it('order 檔放在 graph/ 以外的地方不算(路徑就是 graph/)', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'order-security.json'), '{}\n', 'utf8');

    expect(inventory(root).orderFiles).toEqual([]);
  });

  it('graph/ 不存在時 orderFiles 是空的', () => {
    expect(inventory(tmpRoot()).orderFiles).toEqual([]);
  });
});

describe('formatScanSummary()', () => {
  const base: DirInventory = {
    rootExists: true,
    cardsDirExists: true,
    categories: ['security'],
    emptyCategories: [],
    cards: 25,
    questions: 25,
    depsFile: true,
    orderFiles: ['order-security.json'],
  };

  it('四個數字加 graph 狀態都在同一行裡', () => {
    expect(formatScanSummary(base)).toBe('lint: 掃描 1 個類別,25 張卡,25 份考題;graph/deps.json 有,graph/order-*.json 1 份');
  });

  it('deps.json 不在的時候說「缺」,不是留白', () => {
    const line = formatScanSummary({ ...base, depsFile: false });

    expect(line).toContain('graph/deps.json 缺');
    expect(line).not.toContain('graph/deps.json 有');
  });

  it('數字跟著 inventory 走,不是寫死的', () => {
    expect(formatScanSummary({ ...base, cards: 0, questions: 0, categories: [], orderFiles: [] })).toBe(
      'lint: 掃描 0 個類別,0 張卡,0 份考題;graph/deps.json 有,graph/order-*.json 0 份',
    );
  });
});

describe('formatZeroCards()', () => {
  const base: DirInventory = {
    rootExists: true,
    cardsDirExists: true,
    categories: ['security'],
    emptyCategories: ['security'],
    cards: 0,
    questions: 0,
    depsFile: false,
    orderFiles: [],
  };

  it('有卡就不是這一類的紅,回傳空陣列', () => {
    expect(formatZeroCards('/x', { ...base, cards: 1 })).toEqual([]);
  });

  it('cards/ 不存在:訊息指名 <root>/cards 這條路徑', () => {
    const lines = formatZeroCards('/vault', { ...base, cardsDirExists: false, categories: [], emptyCategories: [] });

    expect(lines[0]).toContain(join('/vault', 'cards'));
    expect(lines[0]).toContain('不存在');
    expect(lines[1]).toContain(SCANNER_BROKEN);
  });

  it('cards/ 在但沒有類別:說的是類別,不是說 cards/ 不存在', () => {
    const lines = formatZeroCards('/vault', { ...base, categories: [], emptyCategories: [] });

    expect(lines[0]).toBe('✗ lint: 掃描到 0 張卡。cards/ 在,但底下一個類別目錄都沒有(0 個類別)。');
    expect(lines[1]).toContain(SCANNER_BROKEN);
  });

  it('類別在但都空的:點名是哪些類別,多個用「、」隔開', () => {
    const lines = formatZeroCards('/vault', {
      ...base,
      categories: ['network', 'security'],
      emptyCategories: ['network', 'security'],
    });

    expect(lines[0]).toBe('✗ lint: 掃描到 0 張卡。類別目錄 network、security 底下沒有任何 .md。');
    expect(lines[1]).toContain(SCANNER_BROKEN);
  });

  it('三種 0 的第一行兩兩不同', () => {
    const noDir = formatZeroCards('/vault', { ...base, cardsDirExists: false, categories: [], emptyCategories: [] })[0];
    const noCategory = formatZeroCards('/vault', { ...base, categories: [], emptyCategories: [] })[0];
    const emptyCategory = formatZeroCards('/vault', base)[0];

    expect(new Set([noDir, noCategory, emptyCategory]).size).toBe(3);
  });
});
