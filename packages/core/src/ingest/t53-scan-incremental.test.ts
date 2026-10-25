/**
 * T53 單元測試 C(增量)與 B(掃描不寫 raw/、不跟符號連結、只掃設定好的分類)。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T53-ingest-phase3-incremental-stale.md「B」「C」。
 *
 * 做法:先用既有的 runIngest 處理一個 raw 檔(產生卡與 state/ingested.json 的鍵),再呼叫 runIngestScan(levelZeroOnly: true)。
 * 假 router 只錄了「要處理的檔」的回應:被拿去生成的別的檔會丟錯,所以「不該處理的檔沒被處理」是真的被量到,不只是看結果欄位。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardPath, countingRouter, ingestOne, ingestedJson, loadScan, makeLearning, mtimeOf, rawText, readCard, treeHash, writeRaw } from './t53-test-support.js';

const TODAY = '2026-09-10';
const sorted = (xs: string[]): string[] => [...xs].sort();

describe('T53 C. 增量:只處理 ingested.json 沒有的檔', () => {
  it('兩個 raw 檔、一個已處理:只處理沒處理的,舊卡一個位元組都不動、舊檔沒叫 LLM', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-old.md', rawText('old'));
    const oldIds = await ingestOne(dir, 'security', 't53-old.md', ['舊一', '舊二', '舊三']);
    const oldBytes = oldIds.map((id) => readCard(dir, 'security', id));
    const oldMtimes = oldIds.map((id) => mtimeOf(cardPath(dir, 'security', id)));
    const newRel = writeRaw(dir, 'security', 't53-new.md', rawText('new'));
    const { router, calls } = countingRouter({ 't53-new.md': ['新一', '新二'] }); // 沒錄 t53-old.md:叫了就會丟錯
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.refused).toBeUndefined();
    expect(result.processed).toEqual([newRel]);
    expect(result.skipped).toEqual(['raw/security/t53-old.md']);
    expect(calls.length, '只為新檔叫一次 LLM').toBe(1);
    expect(calls[0]!.prompt).toContain('t53-new.md');
    oldIds.forEach((id, i) => {
      expect(readCard(dir, 'security', id), `舊卡 ${id} 位元組不變`).toBe(oldBytes[i]);
      expect(mtimeOf(cardPath(dir, 'security', id)), `舊卡 ${id} 的 mtime 不變(沒重寫)`).toBe(oldMtimes[i]);
    });
    expect(ingestedJson(dir)['raw/security/t53-new.md']?.cardIds.length, '新檔進了 ingested.json、兩張卡').toBe(2);
    expect(Object.keys(ingestedJson(dir)).sort()).toEqual(['raw/security/t53-new.md', 'raw/security/t53-old.md']);
  });

  it('再掃一次:全部略過、沒叫 LLM、卡與 ingested.json 都不動', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a'));
    const { router: r1 } = countingRouter({ 't53-a.md': ['甲一', '甲二'] });
    const first = await scan({ outDir: dir, router: r1, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(first.processed).toEqual(['raw/security/t53-a.md']);
    const snapshot = (): string[] => [treeHash(join(dir, 'cards')), treeHash(join(dir, 'questions')), treeHash(join(dir, 'raw')), readFileSync(join(dir, 'state/ingested.json'), 'utf8')];
    const before = snapshot();
    const { router, calls } = countingRouter({});
    const second = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(second.processed).toEqual([]);
    expect(second.skipped).toEqual(['raw/security/t53-a.md']);
    expect(second.staleCards).toEqual([]);
    expect(calls).toHaveLength(0);
    // log 可以多一行(掃描本身的記錄),卡、考題、raw、ingested.json 全部要相同
    expect(snapshot()).toEqual(before);
  });

  it('不給 --category 掃每一個設定好的分類;給了只掃那一個', async () => {
    const scan = await loadScan();
    const dir = makeLearning([
      { id: 'security', name: '資安', require_raw: true },
      { id: 'peach', name: '桃子', require_raw: false },
    ]);
    const relS = writeRaw(dir, 'security', 't53-s.md', rawText('s'));
    const relP = writeRaw(dir, 'peach', 't53-p.md', rawText('p'));
    const files = { 't53-s.md': ['資一'], 't53-p.md': ['桃一'] };
    const onlySecurity = countingRouter(files);
    const one = await scan({ outDir: dir, router: onlySecurity.router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(one.processed).toEqual([relS]);
    expect(existsSync(join(dir, 'cards/peach')) ? readdirSync(join(dir, 'cards/peach')).length : 0, 'peach 沒被處理').toBe(0);
    const all = countingRouter(files);
    const two = await scan({ outDir: dir, router: all.router, today: TODAY, levelZeroOnly: true });
    expect(two.processed).toEqual([relP]);
    expect(two.skipped).toEqual([relS]);
  });
});

describe('T53 C. 掃描的範圍:第一層、.md、一般檔案、不跟符號連結', () => {
  it('子資料夾、非 .md、. 開頭的檔都不處理(叫了就會因為沒錄回應而丟錯)', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const rel = writeRaw(dir, 'security', 't53-ok.md', rawText('ok'));
    writeRaw(dir, 'security', 'notes.txt', '純文字');
    writeRaw(dir, 'security', '.hidden.md', rawText('hidden'));
    writeRaw(dir, 'security', 'sub/inner.md', rawText('inner'));
    const { router, calls } = countingRouter({ 't53-ok.md': ['好一'] });
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.processed).toEqual([rel]);
    expect(calls).toHaveLength(1);
    expect(Object.keys(ingestedJson(dir))).toEqual([rel]);
  });

  it('符號連結(指到分類外的檔、指到分類內的檔、指到不存在的檔)一律略過並報出來,不處理、不叫 LLM', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const outside = mkdtempSync(join(tmpdir(), 'lc-t53-outside-'));
    writeFileSync(join(outside, 'secret.md'), rawText('outside'), 'utf8');
    const rel = writeRaw(dir, 'security', 't53-real.md', rawText('real'));
    symlinkSync(join(outside, 'secret.md'), join(dir, 'raw/security/link-out.md'));
    symlinkSync(join(dir, rel), join(dir, 'raw/security/link-in.md'));
    symlinkSync(join(outside, 'nope.md'), join(dir, 'raw/security/link-dangling.md'));
    const { router, calls } = countingRouter({ 't53-real.md': ['真一', '真二'] });
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.processed, '只處理真的檔').toEqual([rel]);
    expect(sorted(result.skippedLinks)).toEqual(sorted(['raw/security/link-in.md', 'raw/security/link-out.md', 'raw/security/link-dangling.md']));
    expect(calls, '連結目標沒有被拿去生成').toHaveLength(1);
    expect(Object.keys(ingestedJson(dir)), 'ingested.json 只有真檔的鍵').toEqual([rel]);
    const cards = readdirSync(join(dir, 'cards/security')).filter((f) => f.endsWith('.md'));
    expect(cards.length, '卡只有真檔的兩張(連結沒讓卡變多)').toBe(2);
  });

  it('raw/ 底下不在設定裡的分類資料夾:不處理、不建 cards/<它>、不寫設定', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'ghost', 'x.md', rawText('ghost'));
    const configBefore = readFileSync(join(dir, 'config/categories.yaml'), 'utf8');
    const { router, calls } = countingRouter({});
    const result = await scan({ outDir: dir, router, today: TODAY, levelZeroOnly: true });
    expect(result.processed).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(existsSync(join(dir, 'cards/ghost'))).toBe(false);
    expect(existsSync(join(dir, 'questions/ghost'))).toBe(false);
    expect(readFileSync(join(dir, 'config/categories.yaml'), 'utf8'), '設定檔不變').toBe(configBefore);
  });
});

describe('T53 B. 掃描一個位元組都不寫 raw/(硬規則 2)', () => {
  it('處理新檔、略過舊檔、遇到連結與雜物之後,raw/ 的雜湊(檔案清單加內容)前後相同', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-old.md', rawText('old'));
    await ingestOne(dir, 'security', 't53-old.md', ['舊一']);
    writeRaw(dir, 'security', 't53-new.md', rawText('new'));
    writeRaw(dir, 'security', 'notes.txt', '雜物');
    writeRaw(dir, 'ghost', 'x.md', rawText('ghost'));
    symlinkSync(join(dir, 'raw/security/t53-new.md'), join(dir, 'raw/security/link.md'));
    const before = treeHash(join(dir, 'raw'));
    const mtimes = ['raw/security/t53-old.md', 'raw/security/t53-new.md'].map((r) => mtimeOf(join(dir, r)));
    const { router } = countingRouter({ 't53-new.md': ['新一', '新二'] });
    await scan({ outDir: dir, router, today: TODAY, levelZeroOnly: true });
    expect(treeHash(join(dir, 'raw')), 'raw/ 的檔案清單與內容不變').toBe(before);
    expect(['raw/security/t53-old.md', 'raw/security/t53-new.md'].map((r) => mtimeOf(join(dir, r))), 'raw 檔的 mtime 也不變(沒被重寫)').toEqual(mtimes);
  });
});

describe('T53 事件記錄只用契約 §10 已有的類型', () => {
  it('處理新檔、標 stale、標 source_missing 之後,log.jsonl 每一行的 type 都在 §10 的清單裡', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a'));
    writeRaw(dir, 'security', 't53-b.md', rawText('b'));
    const { router: r1 } = countingRouter({ 't53-a.md': ['甲一', '甲二'], 't53-b.md': ['乙一'] });
    await scan({ outDir: dir, router: r1, category: 'security', today: TODAY, levelZeroOnly: true });
    writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('a-edited'), 'utf8');
    rmSync(join(dir, 'raw/security/t53-b.md'));
    const { router: r2, calls } = countingRouter({});
    const result = await scan({ outDir: dir, router: r2, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.staleCards.length).toBe(2);
    expect(result.missingSourceCards.length).toBe(1);
    expect(calls).toHaveLength(0);
    const EVENT_TYPES = ['learned', 'reviewed', 'ingested', 'linted', 'llm_call', 'deepened', 'reteach_queued', 'reteach_viewed', 'week_rolled', 'regenerate', 'cycle_removed', 'provisional_resolved', 'warning'];
    const lines = readFileSync(join(dir, 'state/log.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
    expect(lines.length, '前提:有事件記錄').toBeGreaterThan(0);
    for (const line of lines) expect(EVENT_TYPES, `未知的事件類型:${line}`).toContain((JSON.parse(line) as { type: string }).type);
  });
});
