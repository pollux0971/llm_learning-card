/**
 * `listCardIds()` / `renderDryRunHeader()` / `renderNoCards()` 的單元測試(P-28)。
 *
 * 為什麼跟 `scripts/review.test.ts` 分開:那一支 spawn 真的 CLI,守的是
 * 「使用者在終端機看到什麼」。那層守得住整條路徑,守不住細節——變異測試指出
 * `.sort()`、`!name.endsWith('.md')`、`.slice(0, -'.md'.length)` 這些改掉之後
 * CLI 輸出照樣通過(基準 75.51%)。
 *
 * 這裡直接對純函式斷言。CLI 那一層繼續守「Nothing is due today. 不可以出現在
 * 0 張卡的路徑上」這種端到端的事。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listCardIds } from './io.js';
import { renderDryRunHeader, renderNoCards } from './summary.js';

const tmpDirs: string[] = [];

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-zero-guard-'));
  tmpDirs.push(dir);
  return dir;
}

function writeCard(root: string, category: string, name: string): void {
  mkdirSync(join(root, 'cards', category), { recursive: true });
  writeFileSync(join(root, 'cards', category, name), `---\nid: x\n---\n內容\n`, 'utf8');
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe('listCardIds()', () => {
  it('cards/ 不存在 → 空陣列(不是丟例外,也不是憑空生出項目)', () => {
    expect(listCardIds(tmpRoot())).toEqual([]);
  });

  it('cards/ 在但沒有類別 → 空陣列', () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'cards'), { recursive: true });

    expect(listCardIds(root)).toEqual([]);
  });

  it('回傳的是卡片 id,不是檔名——`.md` 要去掉', () => {
    const root = tmpRoot();
    writeCard(root, 'security', 'sec-0001.md');

    expect(listCardIds(root)).toEqual(['sec-0001']);
  });

  it('`.short.md` 是同一張卡的縮短版,不另外算一張', () => {
    const root = tmpRoot();
    writeCard(root, 'security', 'sec-0001.md');
    writeCard(root, 'security', 'sec-0001.short.md');

    expect(listCardIds(root)).toEqual(['sec-0001']);
  });

  it('非 .md 的檔案不算卡片', () => {
    const root = tmpRoot();
    writeCard(root, 'security', 'sec-0001.md');
    writeFileSync(join(root, 'cards/security/notes.txt'), 'x\n', 'utf8');
    writeFileSync(join(root, 'cards/security/sec-0002.yaml'), 'x\n', 'utf8');

    expect(listCardIds(root)).toEqual(['sec-0001']);
  });

  it('cards/ 底下的檔案不會被當成類別目錄(不可以炸掉,也不可以算進去)', () => {
    const root = tmpRoot();
    writeCard(root, 'security', 'sec-0001.md');
    writeFileSync(join(root, 'cards/README.md'), '這不是類別\n', 'utf8');

    expect(listCardIds(root)).toEqual(['sec-0001']);
  });

  it('跨類別收齊,而且排序過', () => {
    const root = tmpRoot();
    // 十張卡,建立順序刻意不照字母序。readdir 在 ext4 上是 hash 序,
    // .sort() 被拿掉幾乎一定會紅。
    const names = ['zeta', 'mu', 'alpha', 'nu', 'beta', 'xi', 'gamma', 'omicron', 'delta', 'pi'];
    for (const [i, name] of names.entries()) {
      writeCard(root, i % 2 === 0 ? 'security' : 'network', `${name}-0001.md`);
    }

    const ids = listCardIds(root);
    expect(ids).toHaveLength(10);
    expect(ids).toEqual([...names].sort().map((n) => `${n}-0001`));
  });
});

describe('renderDryRunHeader()', () => {
  it('三個數字都印出來,而且各自對得上自己的名稱', () => {
    expect(renderDryRunHeader({ cards: 25, due: 3, unscheduled: 22 })).toBe('掃描 25 張卡,3 張到期,22 張未排程。');
  });

  it('數字跟著輸入走,不是寫死的', () => {
    expect(renderDryRunHeader({ cards: 3, due: 0, unscheduled: 0 })).toBe('掃描 3 張卡,0 張到期,0 張未排程。');
  });

  it('三個位置不可以互換——「幾張卡」跟「幾張到期」講的不是同一件事', () => {
    const line = renderDryRunHeader({ cards: 7, due: 2, unscheduled: 5 });

    expect(line.indexOf('7 張卡')).toBeGreaterThanOrEqual(0);
    expect(line.indexOf('2 張到期')).toBeGreaterThan(line.indexOf('7 張卡'));
    expect(line.indexOf('5 張未排程')).toBeGreaterThan(line.indexOf('2 張到期'));
  });
});

describe('renderNoCards()', () => {
  it('說出「這個 vault 沒有卡片」,把 0 印出來,並指名是哪個目錄', () => {
    const text = renderNoCards('/vault/cards');

    expect(text).toContain('0 張卡');
    expect(text).toContain('沒有卡片');
    expect(text).toContain('/vault/cards');
  });

  it('帶上三支守門掃描器共用的那句話——方向是「掃描器壞了」', () => {
    expect(renderNoCards('/vault/cards')).toContain('這不是很乾淨,是掃描器壞了');
  });

  it('說明可能的原因,不是只丟一句錯誤', () => {
    const text = renderNoCards('/vault/cards');

    expect(text).toContain('--dir');
    expect(text).toMatch(/搬走|同步刪掉/);
  });

  it('兩行:第一行是事實,第二行是方向與原因', () => {
    const lines = renderNoCards('/vault/cards').split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('/vault/cards');
    expect(lines[1]).toContain('這不是很乾淨,是掃描器壞了');
  });

  it('絕對不可以出現使用者每天看到的那句安心訊息', () => {
    expect(renderNoCards('/vault/cards')).not.toContain('Nothing is due today.');
  });
});
