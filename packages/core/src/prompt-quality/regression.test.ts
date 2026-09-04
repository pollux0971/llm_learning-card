/**
 * phase-2 的回歸流程:基準、prompt 漂移、分數沿用。
 * 這一層不碰 git 也不碰 router,全部吃已經寫在磁碟上的 run 目錄,所以測得動。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BASELINE_MARKER,
  BaselineAlreadyExistsError,
  detectPromptDrift,
  findBaseline,
  markBaseline,
  reviewRegression,
} from './regression.js';
import { compareRuns } from './compare.js';
import { renderScoresSheet } from './scores.js';
import type { BaselineInfo } from './types.js';

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function newBaseDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'pq-regr-'));
  tmpDirs.push(d);
  return d;
}

function makeRun(
  baseDir: string,
  task: string,
  date: string,
  outputs: Record<string, string>,
  opts: { commit?: string; scores?: string } = {},
): string {
  const dir = join(baseDir, task, date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({ task, date, model: 'claude-sonnet-5', provider: 'anthropic', promptFileGitCommit: opts.commit ?? 'aaa1111', mode: 'live' }),
  );
  for (const [id, text] of Object.entries(outputs)) {
    writeFileSync(join(dir, `${id}.output.json`), JSON.stringify({ id, text, structural: { issues: [], note: '' } }));
  }
  writeFileSync(join(dir, 'SCORES.md'), opts.scores ?? renderScoresSheet(task, date, Object.keys(outputs)));
  return dir;
}

describe('markBaseline / findBaseline', () => {
  it('沒有基準時 findBaseline 回 undefined', () => {
    expect(findBaseline(newBaseDir(), 'grade.apply')).toBeUndefined();
  });

  it('標了基準之後找得回來,而且目錄裡多了一個標記檔', () => {
    const base = newBaseDir();
    const dir = makeRun(base, 'grade.apply', '2026-09-10', { 'demo-1': 'x' }, { commit: 'aaa1111' });

    const info = markBaseline(base, dir);
    expect(info).toEqual<BaselineInfo>({ task: 'grade.apply', dir, date: '2026-09-10', promptFileGitCommit: 'aaa1111' });
    expect(existsSync(join(dir, BASELINE_MARKER))).toBe(true);
    expect(findBaseline(base, 'grade.apply')).toEqual(info);
  });

  it('基準只立一次:再標第二次會拒絕,舊基準原封不動', () => {
    const base = newBaseDir();
    const first = makeRun(base, 'grade.apply', '2026-09-10', { 'demo-1': 'x' });
    const second = makeRun(base, 'grade.apply', '2026-09-11', { 'demo-1': 'y' });
    markBaseline(base, first);

    expect(() => markBaseline(base, second)).toThrow(BaselineAlreadyExistsError);
    expect(findBaseline(base, 'grade.apply')!.dir).toBe(first);
    expect(existsSync(join(second, BASELINE_MARKER))).toBe(false);
  });

  it('標記檔的內容就是那次 run 的 meta,不用另外維護索引', () => {
    const base = newBaseDir();
    const dir = makeRun(base, 'grade.apply', '2026-09-10', { 'demo-1': 'x' });
    markBaseline(base, dir);
    const marker = JSON.parse(readFileSync(join(dir, BASELINE_MARKER), 'utf8')) as { task: string; date: string };
    expect(marker.task).toBe('grade.apply');
    expect(marker.date).toBe('2026-09-10');
  });

  it('不同任務的基準各自獨立', () => {
    const base = newBaseDir();
    const a = makeRun(base, 'grade.apply', '2026-09-10', { 'demo-1': 'x' });
    const b = makeRun(base, 'deepen', '2026-09-10', { 'demo-1': 'y' });
    markBaseline(base, a);
    markBaseline(base, b);
    expect(findBaseline(base, 'grade.apply')!.dir).toBe(a);
    expect(findBaseline(base, 'deepen')!.dir).toBe(b);
  });
});

describe('detectPromptDrift', () => {
  it('prompt 檔的 commit 跟基準不一樣時報漂移,並指出檔案與兩個 commit', () => {
    const base = newBaseDir();
    markBaseline(base, makeRun(base, 'grade.apply', '2026-09-10', { 'demo-1': 'x' }, { commit: 'aaa1111' }));

    const drift = detectPromptDrift(base, 'grade.apply', 'bbb2222');
    expect(drift).toEqual({
      promptFile: expect.stringContaining('grade.apply'),
      baselineCommit: 'aaa1111',
      currentCommit: 'bbb2222',
    });
  });

  it('commit 一樣就沒有漂移', () => {
    const base = newBaseDir();
    markBaseline(base, makeRun(base, 'grade.apply', '2026-09-10', { 'demo-1': 'x' }, { commit: 'aaa1111' }));
    expect(detectPromptDrift(base, 'grade.apply', 'aaa1111')).toBeUndefined();
  });

  it('還沒有基準就談不上漂移', () => {
    expect(detectPromptDrift(newBaseDir(), 'grade.apply', 'bbb2222')).toBeUndefined();
  });
});

describe('reviewRegression', () => {
  const FILLED = ['| id | 正確嗎 | 是一個概念嗎 |', '|---|---|---|', '| demo-1 | 5 | 4 |', '| demo-2 | 2 | 3 |', '| demo-3 | 4 | 4 |'].join('\n');

  function twoRuns(outputsB: Record<string, string>): ReturnType<typeof compareRuns> {
    const base = newBaseDir();
    const a = makeRun(base, 'grade.apply', '2026-09-10', { 'demo-1': '一', 'demo-2': '二', 'demo-3': '三' }, { scores: FILLED });
    const b = makeRun(base, 'grade.apply', '2026-09-11', outputsB);
    return compareRuns(a, b);
  }

  it('三個輸入變了兩個:那兩個要重打分,沒變的那個另外列', () => {
    const review = reviewRegression(twoRuns({ 'demo-1': '一', 'demo-2': '二號改了', 'demo-3': '三號也改了' }));
    expect(review.needsScoring).toEqual(['demo-2', 'demo-3']);
    expect(review.unchanged).toEqual(['demo-1']);
  });

  it('沒變的那個直接沿用舊分數', () => {
    const review = reviewRegression(twoRuns({ 'demo-1': '一', 'demo-2': '二號改了', 'demo-3': '三號也改了' }));
    expect(review.carriedForward).toEqual({ 'demo-1': { 正確嗎: '5', 是一個概念嗎: '4' } });
  });

  it('全部沒變時全部沿用,沒有人需要重打分', () => {
    const review = reviewRegression(twoRuns({ 'demo-1': '一', 'demo-2': '二', 'demo-3': '三' }));
    expect(review.needsScoring).toEqual([]);
    expect(review.unchanged).toEqual(['demo-1', 'demo-2', 'demo-3']);
    expect(Object.keys(review.carriedForward)).toEqual(['demo-1', 'demo-2', 'demo-3']);
  });

  it('沒變但 A 根本沒填分數的,不會憑空生出一筆', () => {
    const base = newBaseDir();
    const a = makeRun(base, 'grade.apply', '2026-09-10', { 'demo-1': '一' });
    const b = makeRun(base, 'grade.apply', '2026-09-11', { 'demo-1': '一' });
    const review = reviewRegression(compareRuns(a, b));
    expect(review.unchanged).toEqual(['demo-1']);
    expect(review.carriedForward).toEqual({});
  });

  it('task 跟著比對結果走,兩個清單都依字典序', () => {
    const review = reviewRegression(twoRuns({ 'demo-1': '改', 'demo-2': '二', 'demo-3': '改' }));
    expect(review.task).toBe('grade.apply');
    expect(review.needsScoring).toEqual(['demo-1', 'demo-3']);
    expect(review.unchanged).toEqual(['demo-2']);
  });

  it('只有一邊有的輸入算「變了」,需要人看', () => {
    const review = reviewRegression(twoRuns({ 'demo-1': '一', 'demo-2': '二' }));
    expect(review.needsScoring).toEqual(['demo-3']);
    expect(review.unchanged).toEqual(['demo-1', 'demo-2']);
  });
});
