import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runGolden,
  MissingGoldenSetError,
  defaultGoldenBaseDir,
  DEFAULT_GOLDEN_BASE_DIR,
  DEFAULT_FAKE_GOLDEN_BASE_DIR,
} from './golden-run.js';

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
  it('沒登記的 task 會清楚報錯,並指出定義檔在哪裡', async () => {
    await expect(runGolden({ task: 'deepen', baseDir: tmpBaseDir() })).rejects.toThrow(MissingGoldenSetError);
    await expect(runGolden({ task: 'deepen', baseDir: tmpBaseDir() })).rejects.toThrow(/registry\.ts/);
  });

  it('建立以日期命名的目錄,每個輸入一個輸出檔,並存一份當下的 prompt 檔', async () => {
    const baseDir = tmpBaseDir();
    const result = await runGolden({ task: 'grade.apply', today: '2026-09-10', baseDir });

    expect(result.dir).toBe(join(baseDir, 'grade.apply', '2026-09-10'));
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
    const result = await runGolden({ task: 'grade.apply', today: '2026-09-10', baseDir });

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
    const result = await runGolden({ task: 'grade.apply', today: '2026-09-10', baseDir });

    const scores = readFileSync(join(result.dir, 'SCORES.md'), 'utf8');
    for (const o of result.outputs) expect(scores).toContain(o.id);
    expect(scores).toContain('正確嗎');
    expect(scores).toContain('是一個概念嗎');
  });

  it('fake 模式下每次呼叫 router 都會觸發 onCall,不會碰網路', async () => {
    const baseDir = tmpBaseDir();
    const calls: { task: string; prompt: string }[] = [];
    await runGolden({
      task: 'grade.apply',
      today: '2026-09-10',
      baseDir,
      onCall: (task, prompt) => calls.push({ task, prompt }),
    });
    expect(calls.length).toBe(3);
    expect(calls.every((c) => c.task === 'grade.apply')).toBe(true);
  });
});
