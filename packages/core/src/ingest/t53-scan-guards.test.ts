/**
 * T53 補測第五輪(驗收 -5b 點出,2026-10-26):三個還有行為可釘的存活變異。測試 agent 寫;開發 worker 不改。
 *   ① scan.ts 約 342 行 `!verdict.ok` 拒絕(路徑防護,嚴格級):--category 是不合法的 id(含 ../)時,就算 categories.yaml 手寫了同名 id,也要在拿去拼路徑之前拒絕——
 *      拒絕、不處理、不叫 LLM、輸出目錄(含分類外那個被拼出來的資料夾)位元組不變。
 *   ② 132 / 188 行的 .sort():處理順序與未設定資料夾名單的排序不能靠檔案系統(libuv 的 scandir 在 Linux 上本來就排序,所以只能把 readdirSync 換掉才分得出來)。
 *   ③ 172 行 ENOENT 判斷:raw 是一般檔案(readdir 丟 ENOTDIR)不是「沒有 raw」,要丟錯——而且要在沒有設定任何分類的情況下測,才不會被後面 listCategoryRaw 的同一個錯蓋住。
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countingRouter, loadScan, makeLearning, rawText, treeHash, writeRaw } from './t53-test-support.js';

// ② 要把 readdirSync 換成「倒著排」:只換這個檔裡的(vi.mock 的範圍是這份測試檔)。預設走真的。
const hold = vi.hoisted(() => ({ reverse: false }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    readdirSync: ((...args: Parameters<typeof real.readdirSync>) => {
      const out = (real.readdirSync as (...a: unknown[]) => unknown)(...args);
      return hold.reverse && Array.isArray(out) ? [...out].reverse() : out;
    }) as typeof real.readdirSync,
  };
});
afterEach(() => {
  hold.reverse = false;
});

const TODAY = '2026-09-10';
const quiet = () => countingRouter({});

describe('T53 ① 不合法的 --category 在拿去拼路徑之前就拒絕', () => {
  for (const evil of ['../evil-t53', 'a/b', '..']) {
    it(`categories.yaml 手寫了同名 id「${evil}」,--category ${evil}:拒絕、不處理、不叫 LLM、輸出目錄不變`, async () => {
      const scan = await loadScan();
      const dir = makeLearning();
      const target = join(dir, 'evil-t53'); // raw/../evil-t53 會拼到這裡
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, 'x.md'), rawText('evil'), 'utf8');
      writeFileSync(join(dir, 'config/categories.yaml'), `- id: '${evil}'\n  name: 壞\n  require_raw: false\n- id: security\n  name: 資安\n  require_raw: true\n`, 'utf8');
      const before = treeHash(dir);
      const { router, calls, probes } = quiet();
      const result = await scan({ outDir: dir, router, category: evil, today: TODAY, levelZeroOnly: true });
      expect(result.refused, '不合法的 id 一律當「沒有定義」拒絕').toBe('category_undefined');
      expect(result.processed).toEqual([]);
      expect(result.message).toContain(evil);
      expect(calls).toHaveLength(0);
      expect(probes()).toBe(0);
      expect(treeHash(dir), '輸出目錄(含被拼出來的資料夾)位元組不變').toBe(before);
    });
  }

  it('帶主題也一樣:拒絕,不是被當成「有 raw」處理', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    mkdirSync(join(dir, 'evil-t53'), { recursive: true });
    writeFileSync(join(dir, 'evil-t53/x.md'), rawText('evil'), 'utf8');
    writeFileSync(join(dir, 'config/categories.yaml'), "- id: '../evil-t53'\n  name: 壞\n  require_raw: false\n", 'utf8');
    const before = treeHash(dir);
    const result = await scan({ outDir: dir, router: quiet().router, category: '../evil-t53', topic: '什麼', today: TODAY, levelZeroOnly: true });
    expect(result.refused).toBe('category_undefined');
    expect(result.topicIgnored).toBe(false);
    expect(treeHash(dir)).toBe(before);
  });
});

describe('T53 ② 排序不靠檔案系統(把 readdirSync 換成倒著排)', () => {
  it('readdirSync 倒著給:處理順序仍是檔名排序;未設定資料夾名單仍是排序', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const names = ['t53-m.md', 't53-z.md', 't53-a.md', 't53-q.md'];
    const files: Record<string, string[]> = {};
    for (const n of names) {
      writeRaw(dir, 'security', n, rawText(n));
      files[n] = ['卡'];
    }
    for (const f of ['m', 'z', 'a']) mkdirSync(join(dir, 'raw', `un-${f}`), { recursive: true });
    hold.reverse = true;
    expect(readdirSync(join(dir, 'raw/security')), '前提:換掉之後 readdirSync 真的是倒著給').toEqual([...names].sort().reverse());
    const r = await scan({ outDir: dir, router: countingRouter(files).router, today: TODAY, levelZeroOnly: true });
    expect(r.processed).toEqual([...names].sort().map((n) => `raw/security/${n}`));
    expect(r.unconfiguredFolders).toEqual(['un-a', 'un-m', 'un-z']);
  });
});

describe('T53 ③ raw 是一般檔案時丟錯,不是當成「沒有 raw」', () => {
  it('沒有設定任何分類 + 不給分類 + raw 是檔案:丟錯(只有列未設定資料夾那一步會碰到 raw)', async () => {
    const scan = await loadScan();
    const dir = mkdtempSync(join(tmpdir(), 'lc-t53-guard-'));
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'config/categories.yaml'), '[]\n', 'utf8');
    writeFileSync(join(dir, 'raw'), '我是檔案', 'utf8');
    await expect(scan({ outDir: dir, router: quiet().router, today: TODAY, levelZeroOnly: true })).rejects.toThrow();
  });

  it('對照:raw 不存在(真的沒有 raw)不丟錯、名單是空的', async () => {
    const scan = await loadScan();
    const dir = mkdtempSync(join(tmpdir(), 'lc-t53-guard-'));
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'config/categories.yaml'), '[]\n', 'utf8');
    rmSync(join(dir, 'raw'), { recursive: true, force: true });
    const r = await scan({ outDir: dir, router: quiet().router, today: TODAY, levelZeroOnly: true });
    expect(r.unconfiguredFolders).toEqual([]);
  });
});
