/**
 * T53 補測(顧問裁 A,第二批):把 i9 上第一輪補測後仍存活的變異,凡是有行為可釘的都釘上。測試 agent 寫;開發 worker 不改。
 * 分組:
 *   - 拒絕結果的每個桶都是空的、topicIgnored 為 false(emptyResult 的預設值)
 *   - 不吞掉意外的錯:raw/ 是一般檔案時,掃描丟錯(ENOTDIR),不當成「沒東西」
 *   - 判斷不了「檔案還在不在」時不標 source_missing(祖先是檔案)
 *   - 排序:處理順序、未設定的資料夾是排序後的(不靠檔案系統的列舉順序)
 *   - ingested.json 的鍵:別的分類、只有 `raw/<分類>/` 的鍵都不拿去標
 *   - 卡檔位置是資料夾:當成「卡檔不見」,不丟錯
 *   - 旗標看不懂的三種:第一行不是 ---、frontmatter 沒結尾、同一個鍵出現兩次
 *   - 記錄:每個 raw 檔自己的張數(不是累計)、自己的看不懂 / 卡檔不見(不混進別檔)、全部都沒標成時不記「已標」、stale 與 source_missing 的記錄不一樣
 *   - 訊息:兩個旗標同時有 = 兩段、離線被擋的訊息跟「沒事做」的不一樣、兩個檔失敗 = 兩段
 *   - 沒有任何 raw、給主題、不給分類:topicIgnored 為 false
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardPath, countingRouter, ingestOne, loadScan, makeLearning, rawText, readCard, readLog, writeRaw } from './t53-test-support.js';

const TODAY = '2026-09-10';
const quiet = (offline = false) => countingRouter({}, { offline });
const titles = (n: number): string[] => Array.from({ length: n }, (_, i) => `卡${i + 1}`);

describe('T53 extra:拒絕的結果每個桶都是空的', () => {
  it('分類沒設定、要求 raw(沒有 raw 卻給主題):topicIgnored 為 false,所有清單都是空陣列', async () => {
    const scan = await loadScan();
    const dir = makeLearning([
      { id: 'security', name: '資安', require_raw: true },
      { id: 'peach', name: '桃子', require_raw: false },
    ]);
    const empties = { topicIgnored: false, processed: [], skipped: [], skippedLinks: [], outsideCategory: [], staleCards: [], missingSourceCards: [], unreadableFlags: [], unconfiguredFolders: [] };
    for (const args of [{ category: 'ghost' }, { category: 'security', topic: 'x' }]) {
      const r = await scan({ outDir: dir, router: quiet().router, today: TODAY, levelZeroOnly: true, ...args });
      expect(r.refused, JSON.stringify(args)).toBeDefined();
      expect(r).toMatchObject(empties);
    }
  });

  it('不給分類、給主題、哪個分類都沒有 raw:不拒絕、topicIgnored 為 false', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const r = await scan({ outDir: dir, router: quiet().router, topic: '同源政策', today: TODAY, levelZeroOnly: true });
    expect(r.refused).toBeUndefined();
    expect(r.topicIgnored).toBe(false);
  });
});

describe('T53 extra:不吞掉意外的錯、不確定就不標', () => {
  it('raw/ 是一般檔案:掃描丟錯(不是安靜地當作沒東西)——指定分類與不指定都是', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    rmSync(join(dir, 'raw'), { recursive: true, force: true });
    writeFileSync(join(dir, 'raw'), '我是檔案', 'utf8');
    await expect(scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true })).rejects.toThrow();
    await expect(scan({ outDir: dir, router: quiet().router, today: TODAY, levelZeroOnly: true })).rejects.toThrow();
  });

  it('已處理的檔,raw/<分類> 被換成一般檔案(判斷不了檔案還在不在):卡不被標 source_missing', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a'));
    const ids = await ingestOne(dir, 'security', 't53-a.md', titles(2));
    const before = ids.map((id) => readCard(dir, 'security', id));
    rmSync(join(dir, 'raw/security'), { recursive: true, force: true });
    writeFileSync(join(dir, 'raw/security'), '我是檔案', 'utf8');
    const result = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true }).catch(() => undefined);
    expect(result?.missingSourceCards ?? []).toEqual([]);
    ids.forEach((id, i) => expect(readCard(dir, 'security', id), '不確定就不標').toBe(before[i]));
  });
});

describe('T53 extra:排序不靠檔案系統的列舉順序', () => {
  it('處理順序是檔名排序後的;未設定的資料夾名單也是排序後的', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const names = ['t53-m.md', 't53-z.md', 't53-a.md', 't53-q.md', 't53-c.md'];
    const files: Record<string, string[]> = {};
    for (const n of names) {
      writeRaw(dir, 'security', n, rawText(n));
      files[n] = ['卡'];
    }
    for (const f of ['m', 'z', 'a', 'q']) mkdirSync(join(dir, 'raw', `un-${f}`), { recursive: true });
    const r = await scan({ outDir: dir, router: countingRouter(files).router, today: TODAY, levelZeroOnly: true });
    expect(r.processed).toEqual([...names].sort().map((n) => `raw/security/${n}`));
    expect(r.unconfiguredFolders).toEqual(['un-a', 'un-m', 'un-q', 'un-z']);
  });
});

describe('T53 extra:ingested.json 的鍵', () => {
  it('別的分類的鍵(raw/peach/…)在掃 security 時不拿去標,即使 security 底下有同 id 的卡檔', async () => {
    const scan = await loadScan();
    const dir = makeLearning([
      { id: 'security', name: '資安', require_raw: true },
      { id: 'peach', name: '桃子', require_raw: false },
    ]);
    writeRaw(dir, 'peach', 't53-p.md', rawText('p'));
    const ids = await ingestOne(dir, 'peach', 't53-p.md', ['桃一']);
    rmSync(join(dir, 'raw/peach/t53-p.md'));
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    copyFileSync(cardPath(dir, 'peach', ids[0]!), cardPath(dir, 'security', ids[0]!)); // 同 id 的卡在 security 底下:拿錯分類去標才會碰到
    const decoy = readCard(dir, 'security', ids[0]!);
    const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(r.missingSourceCards).toEqual([]);
    expect(readCard(dir, 'security', ids[0]!)).toBe(decoy);
  });

  it('鍵只有 `raw/<分類>/`(後面沒有檔名):不是檔,不拿去標,即使那個資料夾不在', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a'));
    const ids = await ingestOne(dir, 'security', 't53-a.md', titles(2));
    const state = JSON.parse(readFileSync(join(dir, 'state/ingested.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(dir, 'state/ingested.json'), JSON.stringify({ 'raw/security/': state['raw/security/t53-a.md'] }), 'utf8');
    rmSync(join(dir, 'raw/security'), { recursive: true, force: true });
    const before = ids.map((id) => readCard(dir, 'security', id));
    const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(r.missingSourceCards).toEqual([]);
    ids.forEach((id, i) => expect(readCard(dir, 'security', id)).toBe(before[i]));
  });
});

describe('T53 extra:卡檔位置與旗標看不懂', () => {
  it('卡檔的位置變成資料夾:當成「卡檔不見」(報出來、不丟錯、不算 stale)', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('v1'));
    const ids = await ingestOne(dir, 'security', 't53-a.md', titles(2));
    rmSync(cardPath(dir, 'security', ids[0]!));
    mkdirSync(cardPath(dir, 'security', ids[0]!));
    writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('v2'), 'utf8');
    const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(r.staleCards).toEqual([ids[1]]);
    expect(r.message).toContain(ids[0]!);
  });

  for (const [name, mutate] of [
    ['第一行不是 ---(後面才有 --- 行)', (t: string) => `前言\n---\nstale: false\n---\n${t}`],
    ['frontmatter 沒有結尾的 ---', () => '---\ntitle: 沒結尾\n這裡沒有結尾線\n'],
    ['同一個鍵出現兩次(stale: false 兩行)', (t: string) => t.replace('\n---\n\n', '\nstale: false\nstale: false\n---\n\n')],
  ] as const) {
    it(`旗標看不懂:${name} → 不動那張卡、報在 unreadableFlags、不算 stale`, async () => {
      const scan = await loadScan();
      const dir = makeLearning();
      writeRaw(dir, 'security', 't53-a.md', rawText('v1'));
      const ids = await ingestOne(dir, 'security', 't53-a.md', titles(2));
      const p = cardPath(dir, 'security', ids[0]!);
      writeFileSync(p, mutate(readFileSync(p, 'utf8')), 'utf8');
      const before = readFileSync(p, 'utf8');
      writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('v2'), 'utf8');
      const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
      expect(r.unreadableFlags).toEqual([ids[0]]);
      expect(r.staleCards).toEqual([ids[1]]);
      expect(readFileSync(p, 'utf8')).toBe(before);
    });
  }
});

describe('T53 extra:記錄是每個 raw 檔自己的事實', () => {
  async function twoFiles(): Promise<{ dir: string; a: string[]; b: string[] }> {
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a1'));
    writeRaw(dir, 'security', 't53-b.md', rawText('b1'));
    const a = await ingestOne(dir, 'security', 't53-a.md', titles(2));
    const b = await ingestOne(dir, 'security', 't53-b.md', ['乙一', '乙二', '乙三']);
    return { dir, a, b };
  }
  const forFile = (dir: string, file: string) => readLog(dir).filter((e) => e['type'] === 'warning' && e['file'] === file);

  it('兩個檔都改了:各自一筆,張數是自己的(2 與 3,不是累計的 5)', async () => {
    const scan = await loadScan();
    const { dir } = await twoFiles();
    writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('a2'), 'utf8');
    writeFileSync(join(dir, 'raw/security/t53-b.md'), rawText('b2'), 'utf8');
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    const ea = forFile(dir, 'raw/security/t53-a.md')[0]!;
    const eb = forFile(dir, 'raw/security/t53-b.md')[0]!;
    expect(String(ea['message'])).toMatch(/2/);
    expect(String(ea['message'])).not.toMatch(/5/);
    expect(String(eb['message'])).toMatch(/3/);
    expect(String(eb['message'])).not.toMatch(/5/);
  });

  it('兩個檔都刪了(2 張與 3 張):各自一筆,張數是自己的(不是累計的 5)', async () => {
    const scan = await loadScan();
    const { dir } = await twoFiles();
    rmSync(join(dir, 'raw/security/t53-a.md'));
    rmSync(join(dir, 'raw/security/t53-b.md'));
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    const ma = String(forFile(dir, 'raw/security/t53-a.md')[0]!['message']);
    const mb = String(forFile(dir, 'raw/security/t53-b.md')[0]!['message']);
    expect(ma).toMatch(/2/);
    expect(ma).not.toMatch(/5/);
    expect(mb).toMatch(/3/);
    expect(mb).not.toMatch(/5/);
  });

  it('兩個檔都刪了:各自一筆,張數是自己的;stale 與 source_missing 的記錄訊息不一樣(同張數時)', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a1'));
    writeRaw(dir, 'security', 't53-b.md', rawText('b1'));
    await ingestOne(dir, 'security', 't53-a.md', titles(2));
    await ingestOne(dir, 'security', 't53-b.md', ['乙一', '乙二']);
    writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('a2'), 'utf8'); // a:stale(2 張)
    rmSync(join(dir, 'raw/security/t53-b.md')); // b:source_missing(2 張)
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    const stale = String(forFile(dir, 'raw/security/t53-a.md')[0]!['message']);
    const missing = String(forFile(dir, 'raw/security/t53-b.md')[0]!['message']);
    expect(stale).toMatch(/2/);
    expect(missing).toMatch(/2/);
    expect(stale, 'stale 與 source_missing 是兩件事,記錄不能一樣').not.toBe(missing);
  });

  it('第一個檔有看不懂的旗標與卡檔不見:只記在第一個檔,不混進第二個檔的記錄;每筆都有說明文字', async () => {
    const scan = await loadScan();
    const { dir, a, b } = await twoFiles();
    const p = cardPath(dir, 'security', a[0]!);
    writeFileSync(p, readFileSync(p, 'utf8').replace('\n---\n\n', '\nstale: yes\n---\n\n'), 'utf8');
    rmSync(cardPath(dir, 'security', a[1]!));
    writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('a2'), 'utf8');
    writeFileSync(join(dir, 'raw/security/t53-b.md'), rawText('b2'), 'utf8');
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    const ea = forFile(dir, 'raw/security/t53-a.md');
    expect(ea.map((e) => e['card']).filter(Boolean).sort()).toEqual([a[0]!, a[1]!].sort());
    for (const e of ea) expect(String(e['message']).length, '每筆都有說明').toBeGreaterThan(0);
    const eb = forFile(dir, 'raw/security/t53-b.md');
    expect(eb.map((e) => e['card']).filter(Boolean), 'b 檔的記錄不能帶 a 檔的卡').toEqual([]);
    expect(eb.find((e) => Array.isArray(e['cards']))?.['cards']).toEqual(b);
  });

  it('一個檔的卡全部看不懂(一張也沒標成):不記「已標」那一筆(沒有 cards 欄位的事件)', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a1'));
    const ids = await ingestOne(dir, 'security', 't53-a.md', titles(2));
    for (const id of ids) {
      const p = cardPath(dir, 'security', id);
      writeFileSync(p, readFileSync(p, 'utf8').replace('\n---\n\n', '\nstale: yes\n---\n\n'), 'utf8');
    }
    writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('a2'), 'utf8');
    const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(r.staleCards).toEqual([]);
    expect(forFile(dir, 'raw/security/t53-a.md').filter((e) => Array.isArray(e['cards'])), '沒標成就沒有「已標」那筆').toEqual([]);
    expect(forFile(dir, 'raw/security/t53-a.md').length, '兩張看不懂各一筆').toBe(2);
  });

  it('連結與未設定資料夾的記錄:說明文字非空,連結那筆有張數', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    mkdirSync(join(dir, 'raw/security'), { recursive: true });
    for (let i = 0; i < 2; i += 1) symlinkSync(join(dir, 'nope.md'), join(dir, `raw/security/l${i}.md`));
    mkdirSync(join(dir, 'raw/zebra'), { recursive: true });
    await scan({ outDir: dir, router: quiet().router, today: TODAY, levelZeroOnly: true });
    const warns = readLog(dir).filter((e) => e['type'] === 'warning');
    const links = warns.find((e) => Array.isArray(e['files']))!;
    const folders = warns.find((e) => Array.isArray(e['folders']))!;
    expect(String(links['message'])).toMatch(/2/);
    expect(String(folders['message'])).toContain('zebra');
  });
});

describe('T53 extra:訊息的段落', () => {
  it('stale 與 source_missing 同時有:兩段', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a1'));
    writeRaw(dir, 'security', 't53-b.md', rawText('b1'));
    await ingestOne(dir, 'security', 't53-a.md', titles(3));
    await ingestOne(dir, 'security', 't53-b.md', ['乙一', '乙二']);
    writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('a2'), 'utf8');
    rmSync(join(dir, 'raw/security/t53-b.md'));
    const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(r.message.split(';')).toHaveLength(2);
    expect(r.message).toMatch(/3/);
    expect(r.message).toMatch(/2/);
  });

  it('兩個新檔都失敗(空白):兩段,兩個檔名都在', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-x.md', ' \n');
    writeRaw(dir, 'security', 't53-y.md', '\t\n');
    const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(r.message.split(';')).toHaveLength(2);
    expect(r.message).toContain('t53-x.md');
    expect(r.message).toContain('t53-y.md');
  });

  it('離線被擋的訊息跟「沒事做」的訊息不一樣,而且被擋時只有一段', async () => {
    const scan = await loadScan();
    const dirIdle = makeLearning();
    const idle = await scan({ outDir: dirIdle, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-new.md', rawText('new'));
    const blocked = await scan({ outDir: dir, router: countingRouter({ 't53-new.md': ['新一'] }, { offline: true }).router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(blocked.cloudBlocked).toBe(true);
    expect(blocked.message).not.toBe(idle.message);
    expect(blocked.message.split(';')).toHaveLength(1);
  });
});
