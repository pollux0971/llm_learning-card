import { closeSync, fsyncSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileAtomic } from './atomic-write.js';

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
  });
});
