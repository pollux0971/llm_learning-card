/**
 * T53 補測 ②(顧問裁 A):路徑防護(嚴格級)。測試 agent 寫;開發 worker 不改。
 * 每一種都要「被略過並報出來(或安靜略過)、沒有處理、沒有叫 LLM、raw/ 位元組不變(含連結目標那邊的檔)」:
 *   - 分類資料夾本身是符號連結(報在 skippedLinks:raw/<分類>);分類資料夾是一般檔案;分類資料夾不存在;raw/ 整個不存在
 *   - 檔案是符號連結(指到分類外、分類內、不存在的檔)被替換進已處理過的鍵:不算「檔案不見」,卡不被標 source_missing
 *   - 一般檔以外的東西(名字叫 x.md 的資料夾)、非 .md、. 開頭:略過,不進任何桶
 *   - ingested.json 的鍵不是「分類資料夾的直接子檔」(巢狀路徑、別的分類):不拿去標旗標
 *   - categories.yaml 裡寫了不合法的分類 id(含 ../):不拿去拼路徑,不碰分類外的東西
 *   - unconfiguredFolders:符號連結、. 開頭、已設定的、raw/ 直接放的檔都不列
 * 不可達(等價)的:`resolvedInsideCategory` 的「解析後在分類外 / 相對路徑一行」——readdir 出來的一般檔,realpath 一定是分類資料夾的直接子檔,
 * 構造不出來(連結已在更前面被略過)。這幾個存活變異另列給顧問,不為它們寫假測試。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardPath, countingRouter, ingestOne, loadScan, makeLearning, rawText, readCard, treeHash, writeRaw } from './t53-test-support.js';

const TODAY = '2026-09-10';
const quiet = () => countingRouter({});
const outsideDir = (): string => mkdtempSync(join(tmpdir(), 'lc-t53-outside-'));

describe('T53 ② 分類資料夾本身', () => {
  it('raw/<分類> 是指到分類外的符號連結:不跟、報在 skippedLinks(raw/security)、不處理、外面那邊的檔不動、不叫 LLM 也不探測', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const out = outsideDir();
    writeFileSync(join(out, 'x.md'), rawText('outside'), 'utf8');
    rmSync(join(dir, 'raw/security'), { recursive: true, force: true });
    symlinkSync(out, join(dir, 'raw/security'));
    const outBefore = treeHash(out);
    const rawBefore = treeHash(join(dir, 'raw'));
    const { router, calls, probes } = quiet();
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.skippedLinks).toEqual(['raw/security']);
    expect(result.processed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(probes()).toBe(0);
    expect(treeHash(out), '連結目標那邊的檔位元組不變').toBe(outBefore);
    expect(treeHash(join(dir, 'raw')), 'raw/ 不變').toBe(rawBefore);
  });

  it('同一個連結在「掃每個分類」的跑法也只報一次、不處理', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const out = outsideDir();
    writeFileSync(join(out, 'x.md'), rawText('outside'), 'utf8');
    rmSync(join(dir, 'raw/security'), { recursive: true, force: true });
    symlinkSync(out, join(dir, 'raw/security'));
    const { router, calls } = quiet();
    const result = await scan({ outDir: dir, router, today: TODAY, levelZeroOnly: true });
    expect(result.skippedLinks).toEqual(['raw/security']);
    expect(result.processed).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('raw/<分類> 是一般檔案不是資料夾:什麼都不處理、不丟錯、不報成連結', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    rmSync(join(dir, 'raw/security'), { recursive: true, force: true });
    writeFileSync(join(dir, 'raw/security'), '我是檔案', 'utf8');
    const result = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.processed).toEqual([]);
    expect(result.skippedLinks).toEqual([]);
    expect(readFileSync(join(dir, 'raw/security'), 'utf8')).toBe('我是檔案');
  });

  it('已設定的分類沒有 raw 資料夾:安靜地什麼都不做', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    rmSync(join(dir, 'raw/security'), { recursive: true, force: true });
    const result = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.processed).toEqual([]);
    expect(result.skippedLinks).toEqual([]);
    expect(result.refused).toBeUndefined();
  });

  it('raw/ 整個不存在:不丟錯,unconfiguredFolders 是空陣列', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    rmSync(join(dir, 'raw'), { recursive: true, force: true });
    const result = await scan({ outDir: dir, router: quiet().router, today: TODAY, levelZeroOnly: true });
    expect(result.unconfiguredFolders).toEqual([]);
    expect(result.processed).toEqual([]);
  });
});

describe('T53 ② 檔案層', () => {
  it('名字叫 x.md 的資料夾、非 .md、. 開頭的檔:不進任何桶、不處理(叫了 LLM 就會丟錯)', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    mkdirSync(join(dir, 'raw/security/weird.md'), { recursive: true });
    writeFileSync(join(dir, 'raw/security/weird.md/inner.md'), rawText('inner'), 'utf8');
    writeFileSync(join(dir, 'raw/security/notes.txt'), '純文字', 'utf8');
    writeFileSync(join(dir, 'raw/security/.hidden.md'), rawText('hidden'), 'utf8');
    const before = treeHash(join(dir, 'raw'));
    const { router, calls } = quiet();
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.processed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.skippedLinks).toEqual([]);
    expect(result.outsideCategory).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(treeHash(join(dir, 'raw'))).toBe(before);
  });

  for (const [name, make] of [
    ['指到分類外的檔', (dir: string, target: string) => { writeFileSync(target, rawText('outside'), 'utf8'); }],
    ['指到不存在的檔', () => undefined],
  ] as const) {
    it(`已處理的檔被換成符號連結(${name}):不算「檔案不見」——卡不被標 source_missing,連結報在 skippedLinks、不進 skipped`, async () => {
      const scan = await loadScan();
      const dir = makeLearning();
      writeRaw(dir, 'security', 't53-a.md', rawText('a'));
      const ids = await ingestOne(dir, 'security', 't53-a.md', ['甲一', '甲二']);
      const out = outsideDir();
      const target = join(out, 'target.md');
      make(dir, target);
      rmSync(join(dir, 'raw/security/t53-a.md'));
      symlinkSync(target, join(dir, 'raw/security/t53-a.md'));
      const cardsBefore = ids.map((id) => readCard(dir, 'security', id));
      const outBefore = treeHash(out);
      const result = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
      expect(result.skippedLinks).toEqual(['raw/security/t53-a.md']);
      expect(result.missingSourceCards, '換成連結不是檔案不見').toEqual([]);
      expect(result.staleCards).toEqual([]);
      expect(result.skipped).toEqual([]);
      ids.forEach((id, i) => expect(readCard(dir, 'security', id)).toBe(cardsBefore[i]));
      expect(treeHash(out), '連結目標那邊不動').toBe(outBefore);
    });
  }

  it('已處理的檔被換成同名資料夾:不算「檔案不見」,卡不被標', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a'));
    const ids = await ingestOne(dir, 'security', 't53-a.md', ['甲一']);
    rmSync(join(dir, 'raw/security/t53-a.md'));
    mkdirSync(join(dir, 'raw/security/t53-a.md'));
    const before = readCard(dir, 'security', ids[0]!);
    const result = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.missingSourceCards).toEqual([]);
    expect(readCard(dir, 'security', ids[0]!)).toBe(before);
  });
});

describe('T53 ② ingested.json 的鍵', () => {
  it('巢狀路徑的鍵(raw/security/sub/x.md)不是分類資料夾的直接子檔:不拿去標旗標,即使那個路徑不存在', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a'));
    const ids = await ingestOne(dir, 'security', 't53-a.md', ['甲一', '甲二']);
    const state = JSON.parse(readFileSync(join(dir, 'state/ingested.json'), 'utf8')) as Record<string, unknown>;
    const entry = state['raw/security/t53-a.md'];
    writeFileSync(join(dir, 'state/ingested.json'), JSON.stringify({ ...state, 'raw/security/sub/ghost.md': entry, 'raw/securityX/x.md': entry }), 'utf8');
    const before = ids.map((id) => readCard(dir, 'security', id));
    const result = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.missingSourceCards, '不是直接子檔的鍵不算').toEqual([]);
    ids.forEach((id, i) => expect(readCard(dir, 'security', id)).toBe(before[i]));
  });

  it('另一個分類的鍵:只掃 security 時不碰 peach 的卡;掃全部時 peach 的才標', async () => {
    const scan = await loadScan();
    const dir = makeLearning([
      { id: 'security', name: '資安', require_raw: true },
      { id: 'peach', name: '桃子', require_raw: false },
    ]);
    writeRaw(dir, 'peach', 't53-p.md', rawText('p'));
    const ids = await ingestOne(dir, 'peach', 't53-p.md', ['桃一']);
    rmSync(join(dir, 'raw/peach/t53-p.md'));
    const before = readCard(dir, 'peach', ids[0]!);
    const only = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(only.missingSourceCards).toEqual([]);
    expect(readCard(dir, 'peach', ids[0]!)).toBe(before);
    const all = await scan({ outDir: dir, router: quiet().router, today: TODAY, levelZeroOnly: true });
    expect(all.missingSourceCards).toEqual(ids);
    expect(existsSync(cardPath(dir, 'peach', ids[0]!))).toBe(true);
  });
});

describe('T53 ② categories.yaml 裡不合法的分類 id', () => {
  it('id 含 ../:不拿去拼路徑、不碰分類外的東西、不丟錯;合法的分類照掃', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const evil = join(dir, 'evil-t53'); // raw/../evil-t53 = <dir>/evil-t53:不合法的 id 若被拿去拼路徑,會讀到這裡
    mkdirSync(evil, { recursive: true });
    writeFileSync(join(evil, 'x.md'), rawText('evil'), 'utf8');
    writeFileSync(join(dir, 'config/categories.yaml'), '- id: ../evil-t53\n  name: 壞\n  require_raw: true\n- id: security\n  name: 資安\n  require_raw: true\n', 'utf8');
    writeRaw(dir, 'security', 't53-ok.md', rawText('ok'));
    const evilBefore = treeHash(evil);
    const { router, calls } = countingRouter({ 't53-ok.md': ['好一'] });
    const result = await scan({ outDir: dir, router, today: TODAY, levelZeroOnly: true });
    expect(result.processed, '只處理合法分類的檔').toEqual(['raw/security/t53-ok.md']);
    expect(calls.length).toBe(1);
    expect(treeHash(evil), '分類外的資料夾不動').toBe(evilBefore);
    expect(result.message, '不合法的分類 id 連處理失敗都不該出現(根本沒有被拿去拼路徑)').not.toContain('evil-t53');
  });
});

describe('T53 ② unconfiguredFolders 不列的東西', () => {
  it('符號連結資料夾、. 開頭的資料夾、已設定的分類、raw/ 直接放的檔都不列;真的沒設定的列', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const out = outsideDir();
    symlinkSync(out, join(dir, 'raw/linkdir'));
    mkdirSync(join(dir, 'raw/.hiddendir'), { recursive: true });
    writeFileSync(join(dir, 'raw/loose.md'), rawText('loose'), 'utf8');
    mkdirSync(join(dir, 'raw/zeta'), { recursive: true });
    mkdirSync(join(dir, 'raw/alpha'), { recursive: true });
    const result = await scan({ outDir: dir, router: quiet().router, today: TODAY, levelZeroOnly: true });
    expect(result.unconfiguredFolders, '排序後、只有真的資料夾').toEqual(['alpha', 'zeta']);
  });
});
