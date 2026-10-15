/**
 * T6:lint 回報既有資料裡不合法的分類。作者:測試 agent。開發 worker 不改。
 *
 * 約定(測試釘住):新的問題類型 'invalid_category';每個違規一個問題,
 *   path   = 出現的位置(相對路徑):資料夾 `cards/<名>`、`raw/<名>`、卡片檔(frontmatter 的 category)、
 *            `config/categories.yaml`(裡面的 id)
 *   detail = 同時含分類名與 rule 名(rule 用 contracts/fixtures/path-segment-vectors.json 的 rule 欄)
 * 位置的種類見 contracts/fixtures/learning-broken-category/EXPECTED.md。
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from './index.js';

const FIXTURES = fileURLToPath(new URL('../../../../contracts/fixtures/', import.meta.url));

function categoryProblems(dir: string) {
  return lint(dir).problems.filter((p) => p.type === ('invalid_category' as never));
}

describe('lint 對 learning-broken-category', () => {
  it('恰好 3 個問題,都是 invalid_category,位置與 rule 對得上 EXPECTED.md', () => {
    const result = lint(join(FIXTURES, 'learning-broken-category'));
    expect(result.problems.length).toBe(3);
    const rows = result.problems
      .map((p) => ({ type: p.type as string, path: p.path, detail: p.detail }))
      .sort((a, b) => a.path.localeCompare(b.path));
    expect(rows.map((r) => r.type)).toEqual(['invalid_category', 'invalid_category', 'invalid_category']);
    expect(rows.map((r) => r.path)).toEqual(['cards/security/sec-0001.md', 'config/categories.yaml', 'raw/C++']);
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r.detail]));
    expect(byPath['raw/C++']).toContain('C++');
    expect(byPath['raw/C++']).toContain('charset');
    expect(byPath['cards/security/sec-0001.md']).toContain('a.');
    expect(byPath['cards/security/sec-0001.md']).toContain('trailing-dot');
    expect(byPath['config/categories.yaml']).toContain('.hidden');
    expect(byPath['config/categories.yaml']).toContain('leading-dot');
  });

  it('既有的 learning-broken 仍然恰好 10 個問題(沒有新增誤報)', () => {
    const result = lint(join(FIXTURES, 'learning-broken'));
    expect(result.problems.length).toBe(10);
    expect(result.problems.filter((p) => (p.type as string) === 'invalid_category')).toEqual([]);
  });
});

describe('lint 對 learning-minimal', () => {
  it('仍然回報 0 個問題(合法的分類不被誤殺)', () => {
    expect(lint(join(FIXTURES, 'learning-minimal')).problems).toEqual([]);
  });
});

// 在其他系統上建不出來的名字(nul)與分解形式,現場在暫存目錄建。
describe('lint 回報每一個違規的資料夾名(暫存目錄現場建)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lc-t6-lint-'));
    cpSync(join(FIXTURES, 'learning-minimal'), dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const BAD: Array<[string, string]> = [
    ['C++', 'charset'],
    ['\u1100\u1161', 'nfc'],
    ['a.', 'trailing-dot'],
    ['.hidden', 'leading-dot'],
    ['nul', 'reserved'],
    ['\uac00'.repeat(21) + 'ab', 'length'],
  ];

  it.each(BAD)('raw/%s 回報一個問題,detail 含分類名與 rule %s', (folder, rule) => {
    mkdirSync(join(dir, 'raw', folder), { recursive: true });
    writeFileSync(join(dir, 'raw', folder, 'x.md'), '內容\n', 'utf8');
    const found = categoryProblems(dir);
    expect(found.length).toBe(1);
    expect(found[0]!.path).toBe(`raw/${folder}`);
    expect(found[0]!.detail).toContain(folder);
    expect(found[0]!.detail).toContain(rule);
  });

  it.each(BAD)('cards/%s 也回報(資料夾名),detail 含 rule %s', (folder, rule) => {
    mkdirSync(join(dir, 'cards', folder), { recursive: true });
    const found = categoryProblems(dir);
    expect(found.length).toBe(1);
    expect(found[0]!.path).toBe(`cards/${folder}`);
    expect(found[0]!.detail).toContain(rule);
  });

  it('兩個不合法的分類 = 兩個問題(每個違規都回報,不是只回報第一個)', () => {
    mkdirSync(join(dir, 'raw', 'C++'), { recursive: true });
    mkdirSync(join(dir, 'raw', 'nul'), { recursive: true });
    writeFileSync(join(dir, 'raw/C++/x.md'), '內容\n', 'utf8');
    writeFileSync(join(dir, 'raw/nul/x.md'), '內容\n', 'utf8');
    expect(categoryProblems(dir).length).toBe(2);
  });

  it('正向對照:合法的 Security 與 セキュリティー 資料夾不被報', () => {
    for (const folder of ['Security', '\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u30fc']) {
      mkdirSync(join(dir, 'raw', folder), { recursive: true });
      mkdirSync(join(dir, 'cards', folder), { recursive: true });
    }
    expect(categoryProblems(dir)).toEqual([]);
  });
});
