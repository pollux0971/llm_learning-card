/**
 * T53 單元測試 A:分類與來源規則(02 phase-3 場景 1、3、7,與主題跑法的拒絕 / raw 優先)。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T53-ingest-phase3-incremental-stale.md「A. 分類與來源規則」。
 *
 *   - 分類沒有設定(掃描與主題兩種跑法):拒絕 category_undefined,輸出目錄前後完全相同(不建骨架、不建 raw/<分類>、cards/<分類>、不寫設定),LLM 呼叫數 0。
 *   - 分類要求 raw、沒有可處理的 raw、給了主題:拒絕 requires_raw,不寫卡,LLM 呼叫數 0。
 *   - 分類有 raw、又給主題:照 raw 跑(卡的 source 是 raw),topicIgnored 為 true,沒有拒絕。
 *   - 分類不要求 raw、沒有 raw、給了主題:拒絕 topic_not_implemented,LLM 呼叫數 0,什麼都不寫(T55 接手時這一條會被換掉)。
 *   - 掃描沒給主題:topicIgnored 不為 true。
 * 不比對訊息原文(message 只要是非空字串)。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { countingRouter, loadScan, makeLearning, rawText, treeHash, writeRaw } from './t53-test-support.js';

const cardsOf = (dir: string, category: string): string[] =>
  existsSync(join(dir, 'cards', category)) ? readdirSync(join(dir, 'cards', category)).filter((f) => f.endsWith('.md')).sort() : [];

describe('T53 A. 分類沒有設定 → 拒絕,輸出目錄不變(場景 7)', () => {
  for (const topic of [undefined, '怎麼煮咖啡']) {
    const how = topic === undefined ? '掃描跑法' : '主題跑法';
    it(`${how}:分類 ghost 沒有設定 → category_undefined、目錄前後相同、沒叫 LLM`, async () => {
      const scan = await loadScan();
      const dir = makeLearning([{ id: 'security', name: '資安', require_raw: true }]);
      writeRaw(dir, 'security', 'x.md', rawText('x')); // 別的分類的素材在,證明不是因為整個目錄空才沒動
      const before = treeHash(dir);
      const { router, calls } = countingRouter({ 'x.md': ['X1'] });
      const result = await scan({ outDir: dir, router, category: 'ghost', ...(topic ? { topic } : {}), today: '2026-09-10', levelZeroOnly: true });
      expect(result.refused).toBe('category_undefined');
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
      expect(calls, '拒絕時不呼叫 LLM').toHaveLength(0);
      expect(treeHash(dir), '輸出目錄前後完全相同(連空資料夾都不能多)').toBe(before);
      expect(existsSync(join(dir, 'raw/ghost')) || existsSync(join(dir, 'cards/ghost'))).toBe(false);
    });
  }

  it('分類名不合法(含路徑分隔符)也拒絕,目錄不變、沒叫 LLM', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const before = treeHash(dir);
    const { router, calls } = countingRouter({});
    const result = await scan({ outDir: dir, router, category: '../escape', today: '2026-09-10', levelZeroOnly: true });
    expect(result.refused, '不合法的分類名當作沒有設定的分類拒絕').toBe('category_undefined');
    expect(calls).toHaveLength(0);
    expect(treeHash(dir)).toBe(before);
  });
});

describe('T53 A. 分類要求 raw、沒有 raw、給了主題 → 拒絕(場景 1)', () => {
  it('requires_raw、不寫任何卡、LLM 呼叫數 = 0', async () => {
    const scan = await loadScan();
    const dir = makeLearning([{ id: 'security', name: '資安', require_raw: true }]);
    const { router, calls } = countingRouter({});
    const result = await scan({ outDir: dir, router, category: 'security', topic: '同源政策', today: '2026-09-10', levelZeroOnly: true });
    expect(result.refused).toBe('requires_raw');
    expect(result.message.length).toBeGreaterThan(0);
    expect(cardsOf(dir, 'security'), '不寫任何卡').toEqual([]);
    expect(calls, 'LLM 呼叫數要是 0(不只是沒寫卡)').toHaveLength(0);
    expect(result.processed).toEqual([]);
  });

  it('raw/<分類>/ 裡只有不可處理的東西(.txt、. 開頭的檔)也算沒有 raw → requires_raw', async () => {
    const scan = await loadScan();
    const dir = makeLearning([{ id: 'security', name: '資安', require_raw: true }]);
    writeRaw(dir, 'security', 'notes.txt', '不是 md');
    writeRaw(dir, 'security', '.hidden.md', rawText('hidden'));
    const { router, calls } = countingRouter({});
    const result = await scan({ outDir: dir, router, category: 'security', topic: '同源政策', today: '2026-09-10', levelZeroOnly: true });
    expect(result.refused).toBe('requires_raw');
    expect(calls).toHaveLength(0);
    expect(cardsOf(dir, 'security')).toEqual([]);
  });
});

describe('T53 A. 分類有 raw、又給了主題 → 照 raw 跑(場景 3)', () => {
  for (const requireRaw of [false, true]) {
    it(`require_raw ${requireRaw}:卡的 source 是 raw、topicIgnored 為 true、沒有拒絕`, async () => {
      const scan = await loadScan();
      const dir = makeLearning([{ id: 'peach', name: '桃子', require_raw: requireRaw }]);
      const rel = writeRaw(dir, 'peach', 'peach-notes.md', rawText('peach'));
      const { router, calls } = countingRouter({ 'peach-notes.md': ['桃一', '桃二', '桃三'] });
      const result = await scan({ outDir: dir, router, category: 'peach', topic: '桃子的種法', today: '2026-09-10', levelZeroOnly: true });
      expect(result.refused).toBeUndefined();
      expect(result.topicIgnored).toBe(true);
      expect(result.processed).toEqual([rel]);
      expect(calls.length, '只為 raw 檔叫 LLM').toBe(1);
      expect(calls[0]!.prompt, '提示裡是 raw 的檔名,不是主題').toContain('peach-notes.md');
      expect(calls[0]!.prompt).not.toContain('桃子的種法');
      const files = cardsOf(dir, 'peach');
      expect(files.length).toBe(3);
      for (const f of files) expect(matter(readFileSync(join(dir, 'cards/peach', f), 'utf8')).data['source'], `${f} 的 source`).toBe('raw');
    });
  }

  it('沒給主題時 topicIgnored 不為 true', async () => {
    const scan = await loadScan();
    const dir = makeLearning([{ id: 'peach', name: '桃子', require_raw: false }]);
    writeRaw(dir, 'peach', 'peach-notes.md', rawText('peach'));
    const { router } = countingRouter({ 'peach-notes.md': ['桃一', '桃二', '桃三'] });
    const result = await scan({ outDir: dir, router, category: 'peach', today: '2026-09-10', levelZeroOnly: true });
    expect(result.topicIgnored).not.toBe(true);
    expect(result.refused).toBeUndefined();
  });
});

describe('T53 A. 分類不要求 raw、沒有 raw、給了主題 → 還沒做(T55 接手)', () => {
  it('topic_not_implemented、LLM 呼叫數 0、什麼都不寫', async () => {
    const scan = await loadScan();
    const dir = makeLearning([{ id: 'peach', name: '桃子', require_raw: false }]);
    const before = treeHash(dir);
    const { router, calls } = countingRouter({});
    const result = await scan({ outDir: dir, router, category: 'peach', topic: '桃子的種法', today: '2026-09-10', levelZeroOnly: true });
    expect(result.refused).toBe('topic_not_implemented');
    expect(calls).toHaveLength(0);
    expect(treeHash(dir), '什麼都不寫').toBe(before);
  });
});
