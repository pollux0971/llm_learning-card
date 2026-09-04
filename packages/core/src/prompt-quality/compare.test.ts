import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareRuns, LegacyRunLayoutError, NotComparableError } from './compare.js';
import { renderScoresSheet } from './scores.js';

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeRunDir(set: string, date: string, outputs: Record<string, string>, scores?: string): string {
  const base = mkdtempSync(join(tmpdir(), 'pq-compare-'));
  tmpDirs.push(base);
  const dir = join(base, set, date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ set, task: 'grade.apply', date, model: 'recorded', provider: 'fake', promptFileGitCommit: 'abc123', mode: 'fake' }));
  for (const [id, text] of Object.entries(outputs)) {
    writeFileSync(join(dir, `${id}.output.json`), JSON.stringify({ id, text, structural: { issues: [], note: '' } }));
  }
  writeFileSync(join(dir, 'SCORES.md'), scores ?? renderScoresSheet(set, date, Object.keys(outputs)));
  return dir;
}

describe('compareRuns', () => {
  it('同一組 golden set 的兩次 run:每個輸入都顯示兩邊的輸出', () => {
    const dirA = makeRunDir('selftest', '2026-09-10', { 'demo-1': 'A 版輸出' });
    const dirB = makeRunDir('selftest', '2026-09-11', { 'demo-1': 'B 版輸出' });

    const result = compareRuns(dirA, dirB);
    expect(result.set).toBe('selftest');
    expect(result.items).toEqual([
      expect.objectContaining({ id: 'demo-1', outputA: 'A 版輸出', outputB: 'B 版輸出', same: false }),
    ]);
  });

  it('差異只是被顯示出來,不會下判斷(same 是布林,沒有 verdict 之類欄位)', () => {
    const dirA = makeRunDir('selftest', '2026-09-10', { 'demo-1': '一樣' });
    const dirB = makeRunDir('selftest', '2026-09-11', { 'demo-1': '一樣' });
    const result = compareRuns(dirA, dirB);
    expect(result.items[0]!.same).toBe(true);
    expect(Object.keys(result.items[0]!)).toEqual(['id', 'outputA', 'outputB', 'same', 'scoresA', 'scoresB']);
  });

  it('填過的分數會一起顯示;沒填的是 undefined', () => {
    const filledScores = [
      '| id | 正確嗎 | 是一個概念嗎 |',
      '|---|---|---|',
      '| demo-1 | 5 | 4 |',
    ].join('\n');
    const dirA = makeRunDir('selftest', '2026-09-10', { 'demo-1': 'x' }, filledScores);
    const dirB = makeRunDir('selftest', '2026-09-11', { 'demo-1': 'y' });

    const result = compareRuns(dirA, dirB);
    expect(result.items[0]!.scoresA).toEqual({ 正確嗎: '5', 是一個概念嗎: '4' });
    expect(result.items[0]!.scoresB).toBeUndefined();
  });

  it('不同 golden set 拒絕比較,錯誤帶得走名字與兩組 id', () => {
    const dirA = makeRunDir('selftest', '2026-09-10', { 'demo-1': 'x' });
    const dirB = makeRunDir('ingest.cards', '2026-09-10', { 'demo-1': 'y' });
    try {
      compareRuns(dirA, dirB);
      expect.unreachable('應該要丟 NotComparableError');
    } catch (e) {
      expect(e).toBeInstanceOf(NotComparableError);
      // name 是給呼叫端分流用的,被改掉要紅
      expect((e as Error).name).toBe('NotComparableError');
      expect((e as Error).message).toBe('兩次 run 的 golden set 不一樣,不能比較:selftest vs ingest.cards');
    }
  });

  it('輸出 id 依字典序,不是依兩邊目錄的讀取順序', () => {
    // A 只有 z、B 只有 a:聯集的自然順序是 [z, a],排序後才是 [a, z]
    const dirA = makeRunDir('selftest', '2026-09-10', { z: 'x' });
    const dirB = makeRunDir('selftest', '2026-09-11', { a: 'y' });
    expect(compareRuns(dirA, dirB).items.map((i) => i.id)).toEqual(['a', 'z']);
  });

  it('輸出檔名只砍結尾的 .output.json,中間出現的不算', () => {
    const dirA = makeRunDir('selftest', '2026-09-10', { 'weird.output.json-1': 'x' });
    const dirB = makeRunDir('selftest', '2026-09-11', { 'weird.output.json-1': 'y' });
    expect(compareRuns(dirA, dirB).items.map((i) => i.id)).toEqual(['weird.output.json-1']);
  });
});

/**
 * 舊版面的 run:目錄名是 LlmTask、meta.json 沒有 `set` 欄位
 * (phase-2 補完之前 `<base>/<task>/<date>` 的產物)。
 *
 * 這裡最重要的一條是「兩個都是舊的」:`undefined === undefined` 會通過,
 * 於是兩個不同任務的 run 被當成同一組並排顯示。比不出來還好,給出錯的比較結果最糟。
 */
describe('新舊版面混雜', () => {
  function makeLegacyRunDir(task: string, date: string, outputs: Record<string, string>): string {
    const base = mkdtempSync(join(tmpdir(), 'pq-legacy-'));
    tmpDirs.push(base);
    const dir = join(base, task, date);
    mkdirSync(dir, { recursive: true });
    // 舊 meta:有 task、沒有 set
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({ task, date, model: 'recorded', provider: 'fake', promptFileGitCommit: 'abc123', mode: 'fake' }),
    );
    for (const [id, text] of Object.entries(outputs)) {
      writeFileSync(join(dir, `${id}.output.json`), JSON.stringify({ id, text, structural: { issues: [], note: '' } }));
    }
    return dir;
  }

  it('兩個都是舊版面時丟錯,不會因為 set 都是 undefined 就靜靜比下去', () => {
    const dirA = makeLegacyRunDir('grade.apply', '2026-09-02', { 'demo-1': 'x' });
    const dirB = makeLegacyRunDir('ingest.cards', '2026-09-02', { 'demo-1': 'y' });
    expect(() => compareRuns(dirA, dirB)).toThrow(LegacyRunLayoutError);
  });

  it('舊的在 A、新的在 B 時丟的是舊版面的錯,不是「兩組不一樣」', () => {
    const dirA = makeLegacyRunDir('grade.apply', '2026-09-02', { 'demo-1': 'x' });
    const dirB = makeRunDir('selftest', '2026-09-10', { 'demo-1': 'y' });
    expect(() => compareRuns(dirA, dirB)).toThrow(LegacyRunLayoutError);
  });

  it('新的在 A、舊的在 B 時也丟舊版面的錯,而且指名是 B 那個目錄', () => {
    const dirA = makeRunDir('selftest', '2026-09-10', { 'demo-1': 'x' });
    const dirB = makeLegacyRunDir('grade.apply', '2026-09-02', { 'demo-1': 'y' });
    try {
      compareRuns(dirA, dirB);
      expect.unreachable('應該要丟 LegacyRunLayoutError');
    } catch (e) {
      expect(e).toBeInstanceOf(LegacyRunLayoutError);
      expect((e as LegacyRunLayoutError).dir).toBe(dirB);
    }
  });

  it('錯誤訊息逐字說清楚:哪個目錄、為什麼、新目錄長什麼樣、怎麼搬', () => {
    const dirA = makeLegacyRunDir('grade.apply', '2026-09-02', { 'demo-1': 'x' });
    const dirB = makeRunDir('selftest', '2026-09-10', { 'demo-1': 'y' });
    const message = (() => {
      try {
        compareRuns(dirA, dirB);
        return '';
      } catch (e) {
        expect((e as Error).name).toBe('LegacyRunLayoutError');
        return (e as Error).message;
      }
    })();
    // 逐字比對,不是 toContain 幾個關鍵字——訊息是這個錯的全部價值
    expect(message).toBe(
      `${dirA} 是舊版面的 golden run(meta.json 沒有 set 欄位,目錄名是 LlmTask)。` +
        '新版面一組 golden set 一個目錄:<base>/<golden set id>/<date>。' +
        '這一份的 task 是「grade.apply」——對應的新 set id 是「selftest」,' +
        '把它搬到 <base>/selftest/<date>/ 並在 meta.json 補上 "set": "selftest" 就能比。',
    );
  });

  it('舊 meta 連 task 都沒有時,訊息叫人重跑一次', () => {
    const base = mkdtempSync(join(tmpdir(), 'pq-legacy-'));
    tmpDirs.push(base);
    const dir = join(base, 'whatever', '2026-09-02');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ date: '2026-09-02', mode: 'fake' }));
    const dirB = makeRunDir('selftest', '2026-09-10', { 'demo-1': 'y' });
    expect(() => compareRuns(dir, dirB)).toThrow(
      `${dir} 是舊版面的 golden run(meta.json 沒有 set 欄位,目錄名是 LlmTask)。` +
        '新版面一組 golden set 一個目錄:<base>/<golden set id>/<date>。' +
        '重跑一次 golden run 最省事。',
    );
  });

  it('舊 meta 的 task 不是 grade.apply 時,叫人去看登記表', () => {
    const dirA = makeLegacyRunDir('ingest.questions', '2026-09-02', { 'demo-1': 'x' });
    const dirB = makeRunDir('selftest', '2026-09-10', { 'demo-1': 'y' });
    expect(() => compareRuns(dirA, dirB)).toThrow(
      `${dirA} 是舊版面的 golden run(meta.json 沒有 set 欄位,目錄名是 LlmTask)。` +
        '新版面一組 golden set 一個目錄:<base>/<golden set id>/<date>。' +
        '這一份的 task 是「ingest.questions」——對應的 set id 見 golden set 登記表' +
        '(prompt-check.ts --list),搬過去並在 meta.json 補上 "set" 就能比。',
    );
  });
});
