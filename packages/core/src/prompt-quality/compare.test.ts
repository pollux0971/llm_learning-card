import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareRuns, NotComparableError } from './compare.js';
import { renderScoresSheet } from './scores.js';

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeRunDir(task: string, date: string, outputs: Record<string, string>, scores?: string): string {
  const base = mkdtempSync(join(tmpdir(), 'pq-compare-'));
  tmpDirs.push(base);
  const dir = join(base, task, date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ task, date, model: 'recorded', provider: 'fake', promptFileGitCommit: 'abc123', mode: 'fake' }));
  for (const [id, text] of Object.entries(outputs)) {
    writeFileSync(join(dir, `${id}.output.json`), JSON.stringify({ id, text, structural: { issues: [], note: '' } }));
  }
  writeFileSync(join(dir, 'SCORES.md'), scores ?? renderScoresSheet(task, date, Object.keys(outputs)));
  return dir;
}

describe('compareRuns', () => {
  it('同一個 task 的兩次 run:每個輸入都顯示兩邊的輸出', () => {
    const dirA = makeRunDir('grade.apply', '2026-09-10', { 'demo-1': 'A 版輸出' });
    const dirB = makeRunDir('grade.apply', '2026-09-11', { 'demo-1': 'B 版輸出' });

    const result = compareRuns(dirA, dirB);
    expect(result.task).toBe('grade.apply');
    expect(result.items).toEqual([
      expect.objectContaining({ id: 'demo-1', outputA: 'A 版輸出', outputB: 'B 版輸出', same: false }),
    ]);
  });

  it('差異只是被顯示出來,不會下判斷(same 是布林,沒有 verdict 之類欄位)', () => {
    const dirA = makeRunDir('grade.apply', '2026-09-10', { 'demo-1': '一樣' });
    const dirB = makeRunDir('grade.apply', '2026-09-11', { 'demo-1': '一樣' });
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
    const dirA = makeRunDir('grade.apply', '2026-09-10', { 'demo-1': 'x' }, filledScores);
    const dirB = makeRunDir('grade.apply', '2026-09-11', { 'demo-1': 'y' });

    const result = compareRuns(dirA, dirB);
    expect(result.items[0]!.scoresA).toEqual({ 正確嗎: '5', 是一個概念嗎: '4' });
    expect(result.items[0]!.scoresB).toBeUndefined();
  });

  it('不同 task 拒絕比較', () => {
    const dirA = makeRunDir('grade.apply', '2026-09-10', { 'demo-1': 'x' });
    const dirB = makeRunDir('deepen', '2026-09-10', { 'demo-1': 'y' });
    expect(() => compareRuns(dirA, dirB)).toThrow(NotComparableError);
  });
});
