/**
 * T53 補測 ③(顧問裁 A,全分母變異 ≥ 80%):離線拒絕。測試 agent 寫;開發 worker 不改。
 * 驗收 acceptance-T53.md 指出的真缺口:有新檔要生成、雲端探測失敗 → 不叫 LLM、不寫卡、不改 ingested.json、結果標成被擋(cloudBlocked)。
 * 同一檔也釘:探測丟例外 = 離線、只標旗標的掃描不受影響、有新檔且在線時不是被擋、新檔生成失敗(空白 raw)報在訊息裡且不算處理、
 * 沒給 levelZeroOnly 才跑完整管線(要考題 / 子卡的 LLM 工作)、today 選項有傳進卡的 created。
 * 結果欄位 cloudBlocked 是實作加的(工單形狀沒有);CLI 用它退出 1。CLI 層沒有測:要真的雲端探測,這裡不碰網路。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { FakeLlmRouter } from './fake-llm.js';
import { bytesOrNull, cardsFixture, countingRouter, ingestOne, loadScan, makeLearning, rawText, readCard, treeHash, writeRaw } from './t53-test-support.js';

const TODAY = '2026-09-10';
const cardFiles = (dir: string, category = 'security'): string[] =>
  existsSync(join(dir, 'cards', category)) ? readdirSync(join(dir, 'cards', category)).filter((f) => f.endsWith('.md')) : [];

describe('T53 ③ 有新檔要生成、探測失敗 → 被擋', () => {
  it('離線:LLM 呼叫 0、不寫卡、ingested.json 不動、raw 不動、結果標 cloudBlocked、沒有處理', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-new.md', rawText('new'));
    const rawBefore = treeHash(join(dir, 'raw'));
    const stateBefore = bytesOrNull(join(dir, 'state/ingested.json'));
    const { router, calls, probes } = countingRouter({ 't53-new.md': ['新一', '新二'] }, { offline: true });
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.cloudBlocked, '有新檔要生成但離線:標成被擋').toBe(true);
    expect(result.refused, '不是工單的四種拒絕').toBeUndefined();
    expect(result.processed).toEqual([]);
    expect(calls, '離線不叫 LLM').toHaveLength(0);
    expect(probes(), '有新檔才探測,且探測過').toBeGreaterThanOrEqual(1);
    expect(cardFiles(dir), '不寫卡').toEqual([]);
    expect(bytesOrNull(join(dir, 'state/ingested.json')), 'ingested.json 不動(沒有就維持沒有)').toBe(stateBefore);
    expect(treeHash(join(dir, 'raw')), 'raw 不動').toBe(rawBefore);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('探測丟例外也當離線:被擋、LLM 0、不寫卡', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-new.md', rawText('new'));
    const calls: unknown[] = [];
    class Throwing extends FakeLlmRouter {
      override async probeOnline(): Promise<boolean> {
        throw new Error('探測爆了');
      }
    }
    const router = new Throwing({ extra: [cardsFixture('t53-new.md', ['新一'])], onCall: (c) => calls.push(c) });
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.cloudBlocked).toBe(true);
    expect(calls).toHaveLength(0);
    expect(cardFiles(dir)).toEqual([]);
  });

  it('混合:舊檔改過(標 stale)+ 新檔(離線):stale 照標、新檔被擋、ingested.json 只有舊檔那一鍵', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-old.md', rawText('old-v1'));
    const oldIds = await ingestOne(dir, 'security', 't53-old.md', ['舊一', '舊二']);
    writeFileSync(join(dir, 'raw/security/t53-old.md'), rawText('old-v2'), 'utf8');
    writeRaw(dir, 'security', 't53-new.md', rawText('new'));
    const stateBefore = bytesOrNull(join(dir, 'state/ingested.json'));
    const { router, calls } = countingRouter({ 't53-new.md': ['新一'] }, { offline: true });
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.cloudBlocked).toBe(true);
    expect([...result.staleCards].sort()).toEqual([...oldIds].sort());
    for (const id of oldIds) expect(readCard(dir, 'security', id)).toMatch(/^stale: true$/m);
    expect(calls).toHaveLength(0);
    expect(cardFiles(dir).length, '新檔沒有卡').toBe(oldIds.length);
    expect(bytesOrNull(join(dir, 'state/ingested.json'))).toBe(stateBefore);
  });

  it('在線 + 有新檔:不是被擋,照處理', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-new.md', rawText('new'));
    const { router } = countingRouter({ 't53-new.md': ['新一', '新二'] });
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.cloudBlocked).not.toBe(true);
    expect(result.processed).toEqual(['raw/security/t53-new.md']);
  });

  it('沒有新檔、離線:不是被擋(沒東西要生成)', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a'));
    await ingestOne(dir, 'security', 't53-a.md', ['甲一']);
    const result = await scan({ outDir: dir, router: countingRouter({}, { offline: true }).router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.cloudBlocked).not.toBe(true);
    expect(result.skipped).toEqual(['raw/security/t53-a.md']);
  });
});

describe('T53 新檔生成失敗與選項', () => {
  it('新檔是空白(runIngest 回失敗):不算處理、不進 skipped、檔名報在訊息裡、不寫卡', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-blank.md', '   \n\t\n');
    const { router, calls } = countingRouter({});
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.processed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.cloudBlocked).not.toBe(true);
    expect(result.message, '失敗的檔名要在訊息裡').toContain('t53-blank.md');
    expect(calls).toHaveLength(0);
    expect(cardFiles(dir)).toEqual([]);
  });

  it('today 選項傳進新卡的 created;沒給時用系統今天(不是亂填)', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-new.md', rawText('new'));
    const { router } = countingRouter({ 't53-new.md': ['新一'] });
    await scan({ outDir: dir, router, category: 'security', today: '2031-02-03', levelZeroOnly: true });
    const file = cardFiles(dir)[0]!;
    const created = matter(readFileSync(join(dir, 'cards/security', file), 'utf8')).data['created'];
    expect(String(created instanceof Date ? created.toISOString().slice(0, 10) : created)).toBe('2031-02-03');
    const dir2 = makeLearning();
    writeRaw(dir2, 'security', 't53-new.md', rawText('new'));
    await scan({ outDir: dir2, router: countingRouter({ 't53-new.md': ['新一'] }).router, category: 'security', levelZeroOnly: true });
    const f2 = cardFiles(dir2)[0]!;
    const c2 = matter(readFileSync(join(dir2, 'cards/security', f2), 'utf8')).data['created'];
    expect(String(c2 instanceof Date ? c2.toISOString().slice(0, 10) : c2)).toBe(new Date().toISOString().slice(0, 10));
  });

  it('levelZeroOnly:true 只叫 ingest.cards;沒給(跑完整管線)還會叫 ingest.questions', async () => {
    const scan = await loadScan();
    const dirA = makeLearning();
    writeRaw(dirA, 'security', 't53-new.md', rawText('new'));
    const a = countingRouter({ 't53-new.md': ['新一'] });
    await scan({ outDir: dirA, router: a.router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect([...new Set(a.calls.map((c) => c.task))]).toEqual(['ingest.cards']);
    const dirB = makeLearning();
    writeRaw(dirB, 'security', 't53-new.md', rawText('new'));
    const b = countingRouter({ 't53-new.md': ['新一'] });
    await scan({ outDir: dirB, router: b.router, category: 'security', today: TODAY });
    expect(b.calls.map((c) => c.task), '完整管線:卡之後還要考題').toContain('ingest.questions');
  });
});
