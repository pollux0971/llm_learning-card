/**
 * T53 補測(顧問裁,2026-10-25):三條。測試 agent 寫;開發 worker 不改。
 *   ① 一個 raw 檔只落一個桶:`skipped` 只放「已處理、sha 相同」的;內容變了的不進 skipped,只在 staleCards(與訊息裡的張數)出現。
 *   ② 不需要模型的工作不碰網路:掃描沒有新檔要生成時,雲端探測(probeOnline)與 LLM 呼叫都是 0;離線時只標 stale / source_missing 的掃描照樣成功
 *      (沒有拒絕、卡照標、退出碼 0);有新檔要生成才探測。CLI 層:不帶 --fake 的掃描,沒有新檔時不探測,沒有金鑰、沒有網路也退出碼 0。
 *   ③ 工單 D4:raw/ 底下不在設定裡的資料夾列在結果的 `unconfiguredFolders`(釘進測試),測試比欄位不比訊息字串;已設定的、沒檔的不列。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensureInitialized, setCategory } from './init.js';
import { REPO_ROOT, countingRouter, ingestOne, loadScan, makeLearning, rawText, readCard, writeRaw } from './t53-test-support.js';

// 有的條目會用 spawnSync 起 tsx 子行程(scripts/ingest.ts),機器忙時超過 vitest 預設的 5 秒;逐檔放寬逾時(不動全域設定,同 T47/T49/T50 渲染測試的做法)
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const TODAY = '2026-09-10';
const quiet = (offline = false) => countingRouter({}, { offline });

describe('T53 ① 一個 raw 檔只落一個桶', () => {
  it('內容變了的檔:不進 skipped,只在 staleCards(三張)與訊息裡的張數出現;沒有處理、沒有叫 LLM', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-src.md', rawText('v1'));
    const ids = await ingestOne(dir, 'security', 't53-src.md', ['卡一', '卡二', '卡三']);
    writeFileSync(join(dir, 'raw/security/t53-src.md'), rawText('v2-edited'), 'utf8');
    const { router, calls } = quiet();
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.skipped, '改過的檔不能同時算「略過」').toEqual([]);
    expect(result.processed).toEqual([]);
    expect([...result.staleCards].sort()).toEqual([...ids].sort());
    expect(result.message, '訊息裡要有張數 3').toMatch(/3/);
    expect(calls).toHaveLength(0);
  });

  it('一個沒變、一個改過:skipped 只有沒變的;stale 只有改過的那一檔的卡', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-same.md', rawText('same'));
    writeRaw(dir, 'security', 't53-edit.md', rawText('edit-v1'));
    const sameIds = await ingestOne(dir, 'security', 't53-same.md', ['同一', '同二']);
    const editIds = await ingestOne(dir, 'security', 't53-edit.md', ['改一', '改二', '改三']);
    writeFileSync(join(dir, 'raw/security/t53-edit.md'), rawText('edit-v2'), 'utf8');
    const sameBytes = sameIds.map((id) => readCard(dir, 'security', id));
    const result = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.skipped).toEqual(['raw/security/t53-same.md']);
    expect([...result.staleCards].sort()).toEqual([...editIds].sort());
    sameIds.forEach((id, i) => expect(readCard(dir, 'security', id), '沒變的檔的卡不動').toBe(sameBytes[i]));
  });

  it('改過又再掃一次(已經標過):還是不進 skipped,還是報同一批 stale', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-src.md', rawText('v1'));
    const ids = await ingestOne(dir, 'security', 't53-src.md', ['卡一', '卡二']);
    writeFileSync(join(dir, 'raw/security/t53-src.md'), rawText('v2'), 'utf8');
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    const again = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(again.skipped).toEqual([]);
    expect([...again.staleCards].sort()).toEqual([...ids].sort());
  });

  it('raw 刪了的檔:也不進 skipped、不進 processed', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-src.md', rawText('v1'));
    const ids = await ingestOne(dir, 'security', 't53-src.md', ['卡一']);
    rmSync(join(dir, 'raw/security/t53-src.md'));
    const result = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.skipped).toEqual([]);
    expect(result.processed).toEqual([]);
    expect(result.missingSourceCards).toEqual(ids);
  });
});

describe('T53 ② 不需要模型的工作不碰網路', () => {
  it('沒有新檔(全部略過):探測 0 次、LLM 0 次', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a'));
    await ingestOne(dir, 'security', 't53-a.md', ['甲一']);
    const { router, calls, probes } = quiet();
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.skipped).toEqual(['raw/security/t53-a.md']);
    expect(probes(), '沒有新檔要生成:不探測雲端').toBe(0);
    expect(calls).toHaveLength(0);
  });

  for (const [name, mutate, key] of [
    ['raw 改了(只標 stale)', (dir: string) => writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('a-edited'), 'utf8'), 'staleCards'],
    ['raw 刪了(只標 source_missing)', (dir: string) => rmSync(join(dir, 'raw/security/t53-a.md')), 'missingSourceCards'],
  ] as const) {
    it(`離線(探測會失敗)時,只${name}的掃描照樣成功:沒有拒絕、卡照標、探測 0 次、LLM 0 次`, async () => {
      const scan = await loadScan();
      const dir = makeLearning();
      writeRaw(dir, 'security', 't53-a.md', rawText('a'));
      const ids = await ingestOne(dir, 'security', 't53-a.md', ['甲一', '甲二']);
      mutate(dir);
      const { router, calls, probes } = quiet(true);
      const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
      expect(result.refused, '離線也不能拒絕(退出碼 0)').toBeUndefined();
      expect([...result[key]].sort()).toEqual([...ids].sort());
      expect(readCard(dir, 'security', ids[0]!)).toMatch(key === 'staleCards' ? /^stale: true$/m : /^source_missing: true$/m);
      expect(probes(), '離線時也沒去探測').toBe(0);
      expect(calls).toHaveLength(0);
    });
  }

  it('有新檔要生成:才探測(至少一次)並叫 LLM', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-new.md', rawText('new'));
    const { router, calls, probes } = countingRouter({ 't53-new.md': ['新一', '新二'] });
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.processed).toEqual(['raw/security/t53-new.md']);
    expect(probes(), '有新檔要生成:要探測雲端').toBeGreaterThanOrEqual(1);
    expect(calls.length).toBe(1);
  });

  it('拒絕的情況(分類沒設定、要求 raw 卻沒有 raw)也不探測', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const a = quiet();
    await scan({ outDir: dir, router: a.router, category: 'ghost', today: TODAY, levelZeroOnly: true });
    const b = quiet();
    await scan({ outDir: dir, router: b.router, category: 'security', topic: '同源政策', today: TODAY, levelZeroOnly: true });
    expect(a.probes() + b.probes()).toBe(0);
  });
});

describe('T53 ② CLI:沒有新檔的掃描不探測,沒有金鑰、沒有網路也退出碼 0', () => {
  it('先用 --fake --file 處理一個檔,改 raw,再用「不帶 --fake」掃描 → 退出碼 0、卡被標 stale', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-t53-cli2-'));
    ensureInitialized(dir);
    setCategory(dir, { id: 'security', name: '資安', require_raw: true });
    const base = { cwd: REPO_ROOT, encoding: 'utf8' as const, timeout: 120_000 };
    // 沒有金鑰:任何真的雲端呼叫都會立刻失敗(不會花錢)
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_OPTIONS' && !/API_KEY|TOKEN|SECRET/i.test(k)));
    const first = spawnSync(process.execPath, ['--import', 'tsx', join(REPO_ROOT, 'scripts/ingest.ts'), '--fake', '--file', join(REPO_ROOT, 'contracts/fixtures/raw/security-basics.md'), '--out', dir, '--category', 'security'], { ...base, env });
    expect(first.status, `${first.stdout}${first.stderr}`).toBe(0);
    writeFileSync(join(dir, 'raw/security/security-basics.md'), rawText('edited'), 'utf8');
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(REPO_ROOT, 'scripts/ingest.ts'), '--out', dir, '--category', 'security'], { ...base, env });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status, out).toBe(0);
    expect(out, '不該因為雲端探測失敗而拒絕').not.toMatch(/需要雲端|requires a cloud/);
    const cards = readdirSync(join(dir, 'cards/security')).filter((f) => f.endsWith('.md'));
    expect(cards.length).toBeGreaterThanOrEqual(3);
    for (const f of cards) expect(readFileSync(join(dir, 'cards/security', f), 'utf8'), f).toMatch(/^stale: true$/m);
  });
});

describe('T53 ③ raw/ 底下不在設定裡的資料夾列在 unconfiguredFolders', () => {
  it('不給 --category 的掃描:ghost、other 列出(排序後),已設定的與沒檔的分類不列,不處理、不建 cards/<它>', async () => {
    const scan = await loadScan();
    const dir = makeLearning([
      { id: 'security', name: '資安', require_raw: true },
      { id: 'peach', name: '桃子', require_raw: false },
    ]);
    writeRaw(dir, 'ghost', 'x.md', rawText('ghost'));
    writeRaw(dir, 'other', 'y.md', rawText('other'));
    mkdirSync(join(dir, 'raw/emptydir'), { recursive: true }); // 沒設定、沒檔的資料夾也算「不在設定裡」
    writeFileSync(join(dir, 'raw/loose.md'), rawText('loose'), 'utf8'); // raw/ 直接放的檔不是資料夾,不列
    const { router, calls } = quiet();
    const result = await scan({ outDir: dir, router, today: TODAY, levelZeroOnly: true });
    expect([...result.unconfiguredFolders].sort()).toEqual(['emptydir', 'ghost', 'other']);
    expect(result.processed).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(readdirSync(join(dir, 'cards')), '沒有建 cards/ghost 之類').not.toContain('ghost');
  });

  it('沒有不在設定裡的資料夾:空陣列', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a'));
    const { router } = countingRouter({ 't53-a.md': ['甲一'] });
    const result = await scan({ outDir: dir, router, today: TODAY, levelZeroOnly: true });
    expect(result.unconfiguredFolders).toEqual([]);
  });
});
