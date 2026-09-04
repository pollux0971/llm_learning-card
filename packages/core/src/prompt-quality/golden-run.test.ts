import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  composeGoldenPrompt,
  runGolden,
  MissingGoldenSetError,
  defaultGoldenBaseDir,
  DEFAULT_GOLDEN_BASE_DIR,
  DEFAULT_FAKE_GOLDEN_BASE_DIR,
} from './golden-run.js';
import type { GoldenSetId } from './types.js';

/** 永遠不會被登記的 golden set id(理由見 live-run.test.ts 同名常數)。 */
const NOT_REGISTERED = 'not-registered' as GoldenSetId;

const tmpDirs: string[] = [];
function tmpBaseDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'pq-golden-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('defaultGoldenBaseDir', () => {
  it('fake run 預設存到不進 git 的 golden-fake/,live run 存到進 git 的 golden/', () => {
    expect(defaultGoldenBaseDir('fake')).toBe(DEFAULT_FAKE_GOLDEN_BASE_DIR);
    expect(defaultGoldenBaseDir('live')).toBe(DEFAULT_GOLDEN_BASE_DIR);
    expect(DEFAULT_FAKE_GOLDEN_BASE_DIR).not.toBe(DEFAULT_GOLDEN_BASE_DIR);
    expect(DEFAULT_FAKE_GOLDEN_BASE_DIR.endsWith('golden-fake')).toBe(true);
  });
});

describe('runGolden', () => {
  it('沒登記的 golden set 會清楚報錯,並指出定義檔在哪裡', async () => {
    await expect(runGolden({ set: NOT_REGISTERED, baseDir: tmpBaseDir() })).rejects.toThrow(MissingGoldenSetError);
    await expect(runGolden({ set: NOT_REGISTERED, baseDir: tmpBaseDir() })).rejects.toThrow(/registry\.ts/);
  });

  it('建立以日期命名的目錄,每個輸入一個輸出檔,並存一份當下的 prompt 檔', async () => {
    const baseDir = tmpBaseDir();
    const result = await runGolden({ set: 'selftest', today: '2026-09-10', baseDir });

    expect(result.dir).toBe(join(baseDir, 'selftest', '2026-09-10'));
    expect(existsSync(result.dir)).toBe(true);
    expect(result.outputs.length).toBe(3);
    for (const o of result.outputs) {
      expect(existsSync(join(result.dir, `${o.id}.output.json`))).toBe(true);
    }
    expect(existsSync(join(result.dir, 'prompt.snapshot.md'))).toBe(true);
    const snapshot = readFileSync(join(result.dir, 'prompt.snapshot.md'), 'utf8');
    expect(snapshot.length).toBeGreaterThan(0);
  });

  it('記錄 model、provider、日期,以及 prompt 檔的 git commit', async () => {
    const baseDir = tmpBaseDir();
    const result = await runGolden({ set: 'selftest', today: '2026-09-10', baseDir });

    expect(result.meta.set).toBe('selftest');
    expect(result.meta.task).toBe('grade.apply');
    expect(result.meta.date).toBe('2026-09-10');
    expect(result.meta.model).toBeTruthy();
    expect(result.meta.provider).toBeTruthy();
    expect(result.meta.promptFileGitCommit).toBeTruthy();

    const metaFile = JSON.parse(readFileSync(join(result.dir, 'meta.json'), 'utf8'));
    expect(metaFile).toEqual(result.meta);
  });

  it('在 run 目錄寫一份評分表,列出每個輸入、分數欄是空的,並列出兩個評分維度', async () => {
    const baseDir = tmpBaseDir();
    const result = await runGolden({ set: 'selftest', today: '2026-09-10', baseDir });

    const scores = readFileSync(join(result.dir, 'SCORES.md'), 'utf8');
    for (const o of result.outputs) expect(scores).toContain(o.id);
    expect(scores).toContain('正確嗎');
    expect(scores).toContain('是一個概念嗎');
  });

  /**
   * 這條是整個資料夾的重點。少了 prompt 檔的內容,golden run 只是把檔案快照下來、
   * 卻從來沒有把它送出去——改了 `cards.md` 再 `--diff` 會拿到「沒有變化」。
   */
  it('送進 router 的 prompt 一定包含 prompt 檔的內容,不只是把它快照起來', async () => {
    const baseDir = tmpBaseDir();
    const calls: string[] = [];
    await runGolden({
      set: 'selftest',
      today: '2026-09-10',
      baseDir,
      onCall: (_task, prompt) => calls.push(prompt),
    });

    const snapshot = readFileSync(join(baseDir, 'selftest', '2026-09-10', 'prompt.snapshot.md'), 'utf8');
    expect(calls.length).toBe(3);
    for (const prompt of calls) expect(prompt).toContain(snapshot);
  });

  it('composeGoldenPrompt 把 prompt 檔接在輸入前面,中間換行', () => {
    expect(composeGoldenPrompt('模板', '輸入')).toBe('模板\n輸入');
  });

  it('fake 模式下每次呼叫 router 都會觸發 onCall,不會碰網路', async () => {
    const baseDir = tmpBaseDir();
    const calls: { task: string; prompt: string }[] = [];
    await runGolden({
      set: 'selftest',
      today: '2026-09-10',
      baseDir,
      onCall: (task, prompt) => calls.push({ task, prompt }),
    });
    expect(calls.length).toBe(3);
    expect(calls.every((c) => c.task === 'grade.apply')).toBe(true);
  });
});
