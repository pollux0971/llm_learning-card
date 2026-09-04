/**
 * `listCardIds()` 的排序,用假的 `node:fs` 鎖住。
 *
 * 跟 `packages/core/src/lint/inventory-order.test.ts` 同一個理由:這台機器的
 * 檔案系統 readdir 本來就回傳字母序,所以真的建目錄再斷言「結果是排序的」,
 * `.sort()` 被拿掉照樣綠。排序只有在 readdir 給非字母序時才觀察得到。
 *
 * `vi.mock` 整檔生效,所以不能塞進 `zero-guard.test.ts`(那一支要用真的檔案系統)。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readdirSync = vi.fn();
const statSync = vi.fn();
const existsSync = vi.fn();

vi.mock('node:fs', () => ({
  readdirSync: (...args: unknown[]) => readdirSync(...args),
  statSync: (...args: unknown[]) => statSync(...args),
  existsSync: (...args: unknown[]) => existsSync(...args),
  readFileSync: () => '',
}));

const { listCardIds } = await import('./io.js');

beforeEach(() => {
  vi.clearAllMocks();
  existsSync.mockReturnValue(true);
  statSync.mockImplementation((p: string) => ({ isDirectory: () => !p.split('/').pop()!.includes('.') }));
});

describe('listCardIds() 的排序不靠檔案系統的順序', () => {
  it('readdir 回傳倒序時,卡片 id 仍然是字母序', () => {
    readdirSync.mockImplementation((dir: string) => {
      if (dir.endsWith('cards')) return ['zeta', 'alpha'];
      if (dir.endsWith('zeta')) return ['zed-0002.md', 'zed-0001.md'];
      return ['aaa-0002.md', 'aaa-0001.md'];
    });

    expect(listCardIds('/vault')).toEqual(['aaa-0001', 'aaa-0002', 'zed-0001', 'zed-0002']);
  });

  it('跨類別也是同一份排序,不是每個類別各自排完接起來', () => {
    readdirSync.mockImplementation((dir: string) => {
      if (dir.endsWith('cards')) return ['zeta', 'alpha'];
      if (dir.endsWith('zeta')) return ['mid-0001.md'];
      return ['aaa-0001.md', 'zzz-0001.md'];
    });

    // zeta 先被走訪,但 mid-0001 要落在 aaa 與 zzz 中間。
    expect(listCardIds('/vault')).toEqual(['aaa-0001', 'mid-0001', 'zzz-0001']);
  });
});
