/**
 * T53 補測 ④:`init.ts` 的 setCategory / listCategories(行為測試)。測試 agent 寫;開發 worker 不改。
 * 驗收的變異範圍含這兩個函式(init.ts:48–62),約 18 個存活:都是行為——檔案不在、空檔、不是陣列、依 id 覆蓋、不合法 id 不寫檔。
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureInitialized, listCategories, setCategory } from './init.js';

const fresh = (): string => mkdtempSync(join(tmpdir(), 'lc-t53-init-'));
const withConfig = (text: string | null): string => {
  const dir = fresh();
  mkdirSync(join(dir, 'config'), { recursive: true });
  if (text !== null) writeFileSync(join(dir, 'config/categories.yaml'), text, 'utf8');
  return dir;
};

describe('T53 ④ listCategories', () => {
  it('檔案不在:空清單,而且不建任何東西(只讀)', () => {
    const dir = fresh();
    expect(listCategories(dir)).toEqual([]);
    expect(() => readFileSync(join(dir, 'config/categories.yaml'))).toThrow();
  });
  it('空檔、只有註解:空清單', () => {
    expect(listCategories(withConfig(''))).toEqual([]);
    expect(listCategories(withConfig('# 沒有分類\n'))).toEqual([]);
  });
  it('不是陣列(字串、數字、物件):空清單,不丟錯', () => {
    expect(listCategories(withConfig('hello\n'))).toEqual([]);
    expect(listCategories(withConfig('42\n'))).toEqual([]);
    expect(listCategories(withConfig('id: security\nname: 資安\nrequire_raw: true\n'))).toEqual([]);
  });
  it('是陣列:原樣回傳每一個項目(id、name、require_raw),順序不變', () => {
    const dir = withConfig('- id: security\n  name: 資安\n  require_raw: true\n- id: peach\n  name: 桃子\n  require_raw: false\n');
    expect(listCategories(dir)).toEqual([
      { id: 'security', name: '資安', require_raw: true },
      { id: 'peach', name: '桃子', require_raw: false },
    ]);
  });
  it('ensureInitialized 建出來的空設定檔(空陣列):空清單', () => {
    const dir = fresh();
    ensureInitialized(dir);
    expect(listCategories(dir)).toEqual([]);
  });
});

describe('T53 ④ setCategory', () => {
  it('第一次(設定檔不在):建出檔、只有那一個分類', () => {
    const dir = withConfig(null);
    setCategory(dir, { id: 'security', name: '資安', require_raw: true });
    expect(listCategories(dir)).toEqual([{ id: 'security', name: '資安', require_raw: true }]);
  });
  it('已有別的分類:保留,新的加在最後', () => {
    const dir = withConfig(null);
    setCategory(dir, { id: 'security', name: '資安', require_raw: true });
    setCategory(dir, { id: 'peach', name: '桃子', require_raw: false });
    expect(listCategories(dir).map((c) => c.id)).toEqual(['security', 'peach']);
  });
  it('同 id 再設定:依 id 覆蓋(name、require_raw 都換新的)、不重複', () => {
    const dir = withConfig(null);
    setCategory(dir, { id: 'security', name: '資安', require_raw: true });
    setCategory(dir, { id: 'peach', name: '桃子', require_raw: false });
    setCategory(dir, { id: 'security', name: '新名字', require_raw: false });
    expect(listCategories(dir)).toEqual([
      { id: 'peach', name: '桃子', require_raw: false },
      { id: 'security', name: '新名字', require_raw: false },
    ]);
  });
  it('設定檔是空檔 / 不是陣列時也能加(當作空清單)', () => {
    const dir = withConfig('');
    setCategory(dir, { id: 'security', name: '資安', require_raw: true });
    expect(listCategories(dir)).toEqual([{ id: 'security', name: '資安', require_raw: true }]);
  });
  it('不合法的 id:丟錯(訊息有那個 id)、設定檔位元組不變', () => {
    const dir = withConfig('- id: security\n  name: 資安\n  require_raw: true\n');
    const before = readFileSync(join(dir, 'config/categories.yaml'), 'utf8');
    expect(() => setCategory(dir, { id: '../evil', name: 'x', require_raw: true })).toThrow(/\.\.\/evil/);
    expect(readFileSync(join(dir, 'config/categories.yaml'), 'utf8')).toBe(before);
  });
  it('不合法的 id 且設定檔不在:不建設定檔', () => {
    const dir = fresh();
    expect(() => setCategory(dir, { id: 'a/b', name: 'x', require_raw: true })).toThrow();
    expect(() => readFileSync(join(dir, 'config/categories.yaml'))).toThrow();
  });
});
