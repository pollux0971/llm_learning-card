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
import type { BaselineInfo, CompareItem, CompareResult } from './types.js';

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

  /**
   * 審核補測:錯誤本身。原本只斷言 `toThrow(BaselineAlreadyExistsError)`,
   * 那在訊息被清空、`this.name` 被清空的時候照樣通過——而這個錯誤的訊息
   * 正是「舊基準在哪裡」的唯一出口。
   */
  it('拒絕的錯誤說得出是哪個任務、舊基準在哪個目錄', () => {
    const base = newBaseDir();
    const first = makeRun(base, 'grade.apply', '2026-09-10', { 'demo-1': 'x' });
    const second = makeRun(base, 'grade.apply', '2026-09-11', { 'demo-1': 'y' });
    markBaseline(base, first);
    try {
      markBaseline(base, second);
      throw new Error('應該要丟 BaselineAlreadyExistsError');
    } catch (e) {
      const err = e as BaselineAlreadyExistsError;
      expect(err.name).toBe('BaselineAlreadyExistsError');
      expect(err.task).toBe('grade.apply');
      expect(err.existingDir).toBe(first);
      expect(err.message).toContain('grade.apply');
      expect(err.message).toContain(first);
    }
  });

  /**
   * 審核補測:目錄名是日期,**由舊到新**排序後取最早的那個。
   * 原本每個測試都只有一個標記檔,所以排序整段拿掉也沒人發現;
   * 而「基準只立一次」的意思就是最早那次才算數,這條規則需要被釘住。
   * (刻意由新到舊建立目錄,好讓「不排序」跟「排序」的結果不一樣。)
   */
  it('真的有多個標記檔時取日期最早的那個', () => {
    const base = newBaseDir();
    const late = makeRun(base, 'grade.apply', '2026-09-12', { 'demo-1': 'z' });
    const mid = makeRun(base, 'grade.apply', '2026-09-11', { 'demo-1': 'y' });
    const early = makeRun(base, 'grade.apply', '2026-09-10', { 'demo-1': 'x' });
    // 手動放標記檔(markBaseline 本身只允許一個,這裡模擬的是磁碟上被手動搬出來的狀態)
    for (const dir of [late, mid, early]) {
      writeFileSync(join(dir, BASELINE_MARKER), readFileSync(join(dir, 'meta.json'), 'utf8'));
    }
    expect(findBaseline(base, 'grade.apply')!.dir).toBe(early);
    expect(findBaseline(base, 'grade.apply')!.date).toBe('2026-09-10');
  });

  /** 審核補測:task 目錄裡的檔案(不是目錄)要被跳過,不能拿去當 run 目錄。 */
  it('task 目錄裡夾雜檔案時跳過,不會當成 run 目錄', () => {
    const base = newBaseDir();
    const dir = makeRun(base, 'grade.apply', '2026-09-10', { 'demo-1': 'x' });
    writeFileSync(join(base, 'grade.apply', 'AAA-筆記.md'), '這不是 run 目錄');
    markBaseline(base, dir);
    expect(findBaseline(base, 'grade.apply')!.dir).toBe(dir);
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

  /**
   * 審核補測。**有基準、commit 也不一樣、但 golden set 從 registry 消失了**——
   * 這時候回 undefined 等於謊報「沒有漂移」,是靜默失敗的形狀:
   * 有人把 registry 的一行刪掉,漂移偵測就從此永遠說沒事。所以要大聲壞掉。
   * (`deepen` 有 LlmTask 但沒有登記 golden set,正好是這個狀態。)
   */
  it('有基準但 golden set 從 registry 不見了:丟錯,不是靜靜回 undefined', () => {
    const base = newBaseDir();
    markBaseline(base, makeRun(base, 'deepen', '2026-09-10', { 'demo-1': 'x' }, { commit: 'aaa1111' }));
    expect(() => detectPromptDrift(base, 'deepen', 'bbb2222')).toThrow(/沒有登記 golden set/);
  });

  it('同樣的狀況下 commit 一樣時仍然回 undefined(沒漂移就不必查 registry)', () => {
    const base = newBaseDir();
    markBaseline(base, makeRun(base, 'deepen', '2026-09-10', { 'demo-1': 'x' }, { commit: 'aaa1111' }));
    expect(detectPromptDrift(base, 'deepen', 'aaa1111')).toBeUndefined();
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

  /**
   * 審核補測:排序。原本所有輸入都已經照 id 排好(compareRuns 會排),
   * 所以 reviewRegression 自己那道排序拿掉也看不出來——可是這個函式的簽章
   * 吃的是任何一個 CompareResult,沒有人保證呼叫端排過。
   * 直接餵一個亂序的 CompareResult 進去,兩個清單都必須是字典序。
   */
  it('輸入亂序時兩個清單仍然是字典序', () => {
    const item = (id: string, same: boolean): CompareItem => ({
      id, outputA: 'a', outputB: same ? 'a' : 'b', same,
      scoresA: same ? { 正確嗎: '5', 是一個概念嗎: '4' } : undefined,
      scoresB: undefined,
    });
    const shuffled: CompareResult = {
      task: 'grade.apply', dirA: '/a', dirB: '/b',
      items: [item('demo-9', false), item('demo-3', true), item('demo-1', false), item('demo-5', true)],
    };
    const review = reviewRegression(shuffled);
    expect(review.needsScoring).toEqual(['demo-1', 'demo-9']);
    expect(review.unchanged).toEqual(['demo-3', 'demo-5']);
    expect(Object.keys(review.carriedForward)).toEqual(['demo-3', 'demo-5']);
  });

  it('只有一邊有的輸入算「變了」,需要人看', () => {
    const review = reviewRegression(twoRuns({ 'demo-1': '一', 'demo-2': '二' }));
    expect(review.needsScoring).toEqual(['demo-3']);
    expect(review.unchanged).toEqual(['demo-1', 'demo-2']);
  });
});
