import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { categoryPrefix, nextCardIds } from './ids.js';

describe('categoryPrefix', () => {
  it('取類別 id 前三個字母', () => {
    expect(categoryPrefix('security')).toBe('sec');
  });

  it('非字母字元被濾掉', () => {
    expect(categoryPrefix('a-b')).toBe('ab');
  });
});

describe('nextCardIds', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lc-ids-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('目錄不存在時從 0001 開始', () => {
    expect(nextCardIds(join(dir, 'nope'), 'security', 2)).toEqual(['sec-0001', 'sec-0002']);
  });

  it('目錄是空的時從 0001 開始', () => {
    expect(nextCardIds(dir, 'security', 3)).toEqual(['sec-0001', 'sec-0002', 'sec-0003']);
  });

  it('接續已存在的最大編號', () => {
    writeFileSync(join(dir, 'sec-0001.md'), '');
    writeFileSync(join(dir, 'sec-0005.md'), '');
    writeFileSync(join(dir, 'sec-0003.md'), '');
    expect(nextCardIds(dir, 'security', 3)).toEqual(['sec-0006', 'sec-0007', 'sec-0008']);
  });

  it('忽略 .short.md 縮短版與不同前綴的檔案', () => {
    writeFileSync(join(dir, 'sec-0001.md'), '');
    writeFileSync(join(dir, 'sec-0009.short.md'), '');
    writeFileSync(join(dir, 'wev-0099.md'), '');
    expect(nextCardIds(dir, 'security', 1)).toEqual(['sec-0002']);
  });
});
