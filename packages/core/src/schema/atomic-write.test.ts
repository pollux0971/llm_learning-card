import { closeSync, fsyncSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendLineAtomic, writeFileAtomic } from './atomic-write.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
    fsyncSync: vi.fn(actual.fsyncSync),
    closeSync: vi.fn(actual.closeSync),
  };
});

let dir: string;

afterEach(() => {
  vi.mocked(openSync).mockClear();
  vi.mocked(closeSync).mockClear();
  vi.mocked(fsyncSync).mockReset();
  vi.mocked(fsyncSync).mockImplementation(() => undefined);
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** 這次測試裡 openSync 回傳的 fd(暫存檔的描述子) */
function openedFd(): number {
  const fd = vi.mocked(openSync).mock.results[0]?.value;
  expect(typeof fd).toBe('number');
  return fd as number;
}

describe('writeFileAtomic', () => {
  it('writes the exact content to a new file and leaves no temp file behind', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-atomic-'));
    const target = join(dir, 'reviews.json');

    writeFileAtomic(target, '{"a":1}\n');

    expect(readFileSync(target, 'utf8')).toBe('{"a":1}\n');
    expect(readdirSync(dir)).toEqual(['reviews.json']);
  });

  it('replaces an existing file completely', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-atomic-'));
    const target = join(dir, 'weekly.json');
    writeFileSync(target, 'old content that is longer than the new one');

    writeFileAtomic(target, 'new');

    expect(readFileSync(target, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['weekly.json']);
  });

  it('fsyncs the temp file descriptor and closes it exactly once', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-atomic-'));
    const target = join(dir, 'reviews.json');

    writeFileAtomic(target, '{}');

    const fd = openedFd();
    expect(fsyncSync).toHaveBeenCalledTimes(1);
    expect(fsyncSync).toHaveBeenCalledWith(fd);
    expect(closeSync).toHaveBeenCalledTimes(1);
    expect(closeSync).toHaveBeenCalledWith(fd);
  });

  it('writes UTF-8 so CJK content round-trips', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-atomic-'));
    const target = join(dir, 'x.json');

    writeFileAtomic(target, '{"title":"同源政策"}');

    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ title: '同源政策' });
  });

  it('keeps the old file and removes the temp file when fsync fails', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-atomic-'));
    const target = join(dir, 'reviews.json');
    writeFileSync(target, 'old');
    vi.mocked(fsyncSync).mockImplementationOnce(() => {
      throw new Error('disk on fire');
    });

    expect(() => writeFileAtomic(target, 'new')).toThrow('disk on fire');

    expect(readFileSync(target, 'utf8')).toBe('old');
    expect(readdirSync(dir)).toEqual(['reviews.json']);
    expect(closeSync).toHaveBeenCalledTimes(1);
    expect(closeSync).toHaveBeenCalledWith(openedFd());
  });

  it('throws when the target directory does not exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-atomic-'));
    expect(() => writeFileAtomic(join(dir, 'missing', 'x.json'), 'x')).toThrow();
    expect(readdirSync(dir)).toEqual([]);
    // 目錄不存在時,清暫存檔那步要先短路離開(見 cleanupStrayTmp 的 existsSync 檢查),
    // 讓真正的錯誤來自後面的 openSync,而不是先在 readdirSync 一個不存在的目錄就爆掉。
    expect(openSync).toHaveBeenCalled();
  });

  it('cleans up a stray tmp file left by an interrupted previous write', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-atomic-'));
    const target = join(dir, 'reviews.json');
    writeFileSync(target, '{"sec-0001":{}}');
    // 模擬上次寫入在 rename 前中斷:tmp 檔留在同目錄。
    const stray = join(dir, '.reviews.json.12345.999.tmp');
    writeFileSync(stray, 'half-written garbage');
    expect(readdirSync(dir).sort()).toEqual(['.reviews.json.12345.999.tmp', 'reviews.json']);

    writeFileAtomic(target, '{"sec-0001":{},"sec-0002":{}}');

    expect(readFileSync(target, 'utf8')).toBe('{"sec-0001":{},"sec-0002":{}}');
    expect(readdirSync(dir)).toEqual(['reviews.json']);
  });

  it('does not touch a stray tmp file belonging to a different target file', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-atomic-'));
    const target = join(dir, 'reviews.json');
    const otherStray = join(dir, '.weekly.json.1.2.tmp');
    writeFileSync(otherStray, 'not mine');

    writeFileAtomic(target, '{}');

    expect(readdirSync(dir).sort()).toEqual(['.weekly.json.1.2.tmp', 'reviews.json']);
  });
});

describe('appendLineAtomic', () => {
  it('appends a single line with a trailing newline to a new file', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-append-'));
    const target = join(dir, 'log.jsonl');

    appendLineAtomic(target, '{"ts":"2026-09-02T00:00:00Z","type":"learned","card":"sec-0001"}');

    expect(readFileSync(target, 'utf8')).toBe('{"ts":"2026-09-02T00:00:00Z","type":"learned","card":"sec-0001"}\n');
  });

  it('does not add a second newline when the line already ends with one', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-append-'));
    const target = join(dir, 'log.jsonl');

    appendLineAtomic(target, '{"a":1}\n');

    expect(readFileSync(target, 'utf8')).toBe('{"a":1}\n');
  });

  it('appends multiple lines in order without interleaving or truncating', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-append-'));
    const target = join(dir, 'log.jsonl');

    appendLineAtomic(target, '{"n":1}');
    appendLineAtomic(target, '{"n":2}');
    appendLineAtomic(target, '{"n":3}');

    const lines = readFileSync(target, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('preserves an existing line when appending a new one', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-append-'));
    const target = join(dir, 'log.jsonl');
    writeFileSync(target, '{"n":1}\n');

    appendLineAtomic(target, '{"n":2}');

    expect(readFileSync(target, 'utf8')).toBe('{"n":1}\n{"n":2}\n');
  });

  it('fsyncs and closes the file descriptor exactly once', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-append-'));
    const target = join(dir, 'log.jsonl');

    appendLineAtomic(target, '{"a":1}');

    const fd = openedFd();
    expect(fsyncSync).toHaveBeenCalledTimes(1);
    expect(fsyncSync).toHaveBeenCalledWith(fd);
    expect(closeSync).toHaveBeenCalledTimes(1);
    expect(closeSync).toHaveBeenCalledWith(fd);
  });
});
