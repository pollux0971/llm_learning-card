/**
 * T53 補測 ①(顧問裁 A):訊息與記錄——不從分母排除、不用 Stryker 設定排除 StringLiteral;改釘「訊息裡的事實」,不釘措辭。測試 agent 寫;開發 worker 不改。
 * 事實 = 張數、檔名、分類 id、資料夾名、卡 id:
 *   - 每個測試只讓「一個桶」有東西,而且數字彼此不同(stale 3、source_missing 4、看不懂 2、處理 5、略過 6、連結 7),所以訊息裡少了那一段、數字就不見;
 *   - 拒絕訊息要有使用者給的分類 id;卡檔不見的訊息要有卡 id;未設定的資料夾要有名字;失敗的要有檔名;
 *   - state/log.jsonl 的 warning 事件:欄位(file / files / folders / cards / card)是事實,釘欄位值,不釘 message 措辭;type 都是 warning。
 * 純措辭(「張卡的來源改了」這幾個字本身、分隔用的「;」)不釘——這些存活的變異逐條列在交給顧問的清單。
 */
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardPath, countingRouter, ingestOne, loadScan, makeLearning, rawText, readLog, writeRaw } from './t53-test-support.js';

const TODAY = '2026-09-10';
const quiet = () => countingRouter({});
const titles = (n: number): string[] => Array.from({ length: n }, (_, i) => `卡${i + 1}`);

describe('T53 ① 訊息裡的事實', () => {
  it('stale 3 張:訊息有 3(只有 stale 這一桶有東西)', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('v1'));
    await ingestOne(dir, 'security', 't53-a.md', titles(3));
    writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('v2'), 'utf8');
    const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(r.staleCards.length).toBe(3);
    expect(r.message).toMatch(/3/);
    expect(r.message.split(';'), '只有 stale 這一桶有東西:訊息只有一段(沒有「0 個…」的雜訊)').toHaveLength(1);
  });

  it('source_missing 4 張:訊息有 4', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('v1'));
    await ingestOne(dir, 'security', 't53-a.md', titles(4));
    rmSync(join(dir, 'raw/security/t53-a.md'));
    const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(r.missingSourceCards.length).toBe(4);
    expect(r.message).toMatch(/4/);
    expect(r.message.split(';')).toHaveLength(1);
  });

  it('看不懂的旗標 2 張:訊息有 2;卡檔被刪的卡 id 在訊息裡', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('v1'));
    const ids = await ingestOne(dir, 'security', 't53-a.md', titles(3));
    for (const id of ids.slice(0, 2)) {
      const p = cardPath(dir, 'security', id);
      writeFileSync(p, readFileSync(p, 'utf8').replace('\n---\n\n', '\nstale: yes\n---\n\n'), 'utf8');
    }
    rmSync(cardPath(dir, 'security', ids[2]!));
    writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('v2'), 'utf8');
    const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect([...r.unreadableFlags].sort()).toEqual([ids[0]!, ids[1]!].sort());
    expect(r.message, '看不懂的張數').toMatch(/2/);
    expect(r.message, '卡檔不見的那張,卡 id 要在訊息裡').toContain(ids[2]!);
    expect(r.message.split(';'), '看不懂 + 卡檔不見 = 兩段').toHaveLength(2);
  });

  it('處理 5 個新檔:訊息有 5', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const files: Record<string, string[]> = {};
    for (let i = 0; i < 5; i += 1) {
      const name = `t53-f${'abcde'[i]}.md`;
      writeRaw(dir, 'security', name, rawText(`n${i}`));
      files[name] = ['卡'];
    }
    const r = await scan({ outDir: dir, router: countingRouter(files).router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(r.processed.length).toBe(5);
    expect(r.message).toMatch(/5/);
    expect(r.message.split(';')).toHaveLength(1);
  });

  it('略過 6 個沒改的檔:訊息有 6', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    for (let i = 0; i < 6; i += 1) {
      const name = `t53-s${'abcdef'[i]}.md`;
      writeRaw(dir, 'security', name, rawText(`s${i}`));
      await ingestOne(dir, 'security', name, ['卡']);
    }
    const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(r.skipped.length).toBe(6);
    expect(r.message).toMatch(/6/);
    expect(r.message.split(';')).toHaveLength(1);
  });

  it('略過 7 個符號連結:訊息有 7', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    mkdirSync(join(dir, 'raw/security'), { recursive: true });
    for (let i = 0; i < 7; i += 1) symlinkSync(join(dir, 'nope.md'), join(dir, `raw/security/l${i}.md`));
    const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(r.skippedLinks.length).toBe(7);
    expect(r.message).toMatch(/7/);
    expect(r.message.split(';')).toHaveLength(1);
  });

  it('未設定的資料夾:名字在訊息裡', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    mkdirSync(join(dir, 'raw/zebra'), { recursive: true });
    mkdirSync(join(dir, 'raw/yak'), { recursive: true });
    const r = await scan({ outDir: dir, router: quiet().router, today: TODAY, levelZeroOnly: true });
    expect(r.message).toContain('zebra');
    expect(r.message).toContain('yak');
    expect(r.message.split(';')).toHaveLength(1);
  });

  it('什麼都沒有:訊息還是非空字串(給人看的一行)', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const r = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(r.message.trim().length).toBeGreaterThan(0);
  });

  it('拒絕:訊息有使用者給的分類 id(沒設定的與不合法的)', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    const a = await scan({ outDir: dir, router: quiet().router, category: 'ghostcat', today: TODAY, levelZeroOnly: true });
    expect(a.refused).toBe('category_undefined');
    expect(a.message).toContain('ghostcat');
    const b = await scan({ outDir: dir, router: quiet().router, category: '../escape', today: TODAY, levelZeroOnly: true });
    expect(b.refused).toBe('category_undefined');
    expect(b.message).toContain('../escape');
  });

  it('主題被略過:有 raw 又給主題時 topicIgnored 為 true,沒 raw 時不是', async () => {
    const scan = await loadScan();
    const dir = makeLearning([{ id: 'peach', name: '桃子', require_raw: false }]);
    writeRaw(dir, 'peach', 't53-p.md', rawText('p'));
    const withRaw = await scan({ outDir: dir, router: countingRouter({ 't53-p.md': ['桃'] }).router, category: 'peach', topic: '桃子', today: TODAY, levelZeroOnly: true });
    expect(withRaw.topicIgnored).toBe(true);
    const again = await scan({ outDir: dir, router: quiet().router, category: 'peach', topic: '桃子', today: TODAY, levelZeroOnly: true });
    expect(again.topicIgnored, '檔在(已處理)也算有 raw').toBe(true);
    expect(again.refused).toBeUndefined();
  });
});

describe('T53 ① 記錄裡的事實(state/log.jsonl 的 warning 事件)', () => {
  it('stale:有一筆 warning,file 是那個 raw、cards 是那幾張卡', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('v1'));
    const ids = await ingestOne(dir, 'security', 't53-a.md', titles(2));
    writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('v2'), 'utf8');
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    const ev = readLog(dir).filter((e) => e['type'] === 'warning' && e['file'] === 'raw/security/t53-a.md');
    expect(ev.length).toBe(1);
    expect(ev[0]!['cards']).toEqual(ids);
    expect(typeof ev[0]!['ts']).toBe('string');
    expect(String(ev[0]!['message'])).toMatch(/2/);
  });

  it('source_missing:一筆 warning,file、cards 同上,張數在 message', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('v1'));
    const ids = await ingestOne(dir, 'security', 't53-a.md', titles(3));
    rmSync(join(dir, 'raw/security/t53-a.md'));
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    const ev = readLog(dir).filter((e) => e['type'] === 'warning' && e['file'] === 'raw/security/t53-a.md');
    expect(ev.length).toBe(1);
    expect(ev[0]!['cards']).toEqual(ids);
    expect(String(ev[0]!['message'])).toMatch(/3/);
  });

  it('看不懂的旗標與卡檔不見:各一筆 warning,card 是那張卡的 id', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('v1'));
    const ids = await ingestOne(dir, 'security', 't53-a.md', titles(2));
    const p = cardPath(dir, 'security', ids[0]!);
    writeFileSync(p, readFileSync(p, 'utf8').replace('\n---\n\n', '\nstale: yes\n---\n\n'), 'utf8');
    rmSync(cardPath(dir, 'security', ids[1]!));
    writeFileSync(join(dir, 'raw/security/t53-a.md'), rawText('v2'), 'utf8');
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    const warns = readLog(dir).filter((e) => e['type'] === 'warning' && e['file'] === 'raw/security/t53-a.md');
    expect(warns.map((e) => e['card']).filter(Boolean).sort()).toEqual([ids[0]!, ids[1]!].sort());
  });

  it('連結與未設定的資料夾:各一筆 warning,files / folders 是名單;每筆都有 ts', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    mkdirSync(join(dir, 'raw/security'), { recursive: true });
    symlinkSync(join(dir, 'nope.md'), join(dir, 'raw/security/l1.md'));
    mkdirSync(join(dir, 'raw/zebra'), { recursive: true });
    await scan({ outDir: dir, router: quiet().router, today: TODAY, levelZeroOnly: true });
    const events = readLog(dir).filter((e) => e['type'] === 'warning');
    expect(events.find((e) => Array.isArray(e['files']))?.['files']).toEqual(['raw/security/l1.md']);
    expect(events.find((e) => Array.isArray(e['folders']))?.['folders']).toEqual(['zebra']);
    for (const e of events) expect(typeof e['ts']).toBe('string');
  });

  it('什麼都沒有的掃描不寫任何 warning', async () => {
    const scan = await loadScan();
    const dir = makeLearning();
    writeRaw(dir, 'security', 't53-a.md', rawText('a'));
    await ingestOne(dir, 'security', 't53-a.md', ['甲']);
    const before = readLog(dir).length;
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(readLog(dir).filter((e) => e['type'] === 'warning')).toEqual([]);
    expect(readLog(dir).length).toBe(before);
  });
});
