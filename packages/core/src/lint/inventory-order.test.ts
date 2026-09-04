/**
 * `inventory()` 的排序,用假的 `node:fs` 鎖住。
 *
 * 為什麼要另外一支檔案、而且要 mock:`inventory()` 對 `readdirSync` 的回傳
 * 直接 `.sort()`,但**這台機器的檔案系統本來就回傳字母序**——
 *
 *   $ node -e "...mkdir zeta,mu,alpha...; console.log(readdirSync(d))"
 *   alpha,beta,delta,gamma,mu,nu,omicron,pi,xi,zeta
 *
 * 所以真的建目錄再斷言「結果是排序的」,`.sort()` 被拿掉照樣綠(第一輪補完
 * 測試後 scan.ts 剩下的兩個存活變異就是這個)。排序這件事只有在 readdir
 * 回傳非字母序的時候才觀察得到,而那不是測試控制得了的東西——所以這裡把
 * `node:fs` 換掉,讓 readdir 保證回傳倒序。
 *
 * `vi.mock` 是整個檔案生效的,會影響同檔案裡所有的測試,所以不能塞進
 * `inventory.test.ts`(那一支要用真的檔案系統)。
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

const { inventory } = await import('./scan.js');

beforeEach(() => {
  vi.clearAllMocks();
  existsSync.mockReturnValue(true);
  // `listFiles` 會遞迴進子目錄,所以 statSync 一律說「是目錄」會無限遞迴。
  // 規則:路徑最後一段有副檔名就是檔案,沒有就是目錄。
  statSync.mockImplementation((p: string) => ({ isDirectory: () => !p.split('/').pop()!.includes('.') }));
});

describe('inventory() 的排序不靠檔案系統的順序', () => {
  it('readdir 回傳倒序時,categories 仍然是字母序', () => {
    // cards/ 底下三個類別目錄,倒序回傳;每個類別目錄裡各一張卡。
    readdirSync.mockImplementation((dir: string) => {
      if (dir.endsWith('cards')) return ['zeta', 'mu', 'alpha'];
      if (dir.endsWith('graph')) return [];
      if (dir.endsWith('questions')) return [];
      return ['card-0001.md'];
    });

    expect(inventory('/vault').categories).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('readdir 回傳倒序時,orderFiles 仍然是字母序', () => {
    readdirSync.mockImplementation((dir: string) => {
      if (dir.endsWith('graph')) return ['order-zeta.json', 'order-mu.json', 'order-alpha.json'];
      return [];
    });

    expect(inventory('/vault').orderFiles).toEqual(['order-alpha.json', 'order-mu.json', 'order-zeta.json']);
  });

  it('emptyCategories 也跟著 categories 的字母序,不是磁碟順序', () => {
    readdirSync.mockImplementation((dir: string) => {
      if (dir.endsWith('cards')) return ['zeta', 'mu', 'alpha'];
      if (dir.endsWith('graph')) return [];
      if (dir.endsWith('questions')) return [];
      return [];
    });

    const inv = inventory('/vault');
    expect(inv.cards).toBe(0);
    expect(inv.emptyCategories).toEqual(['alpha', 'mu', 'zeta']);
  });
});
