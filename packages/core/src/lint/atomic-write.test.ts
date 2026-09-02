import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFileSync, tmpPathFor } from './atomic-write.js';

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'lc-atomic-'));
}

describe('atomicWriteFileSync', () => {
  it('暫存檔名是同目錄的 <name>.tmp(契約 §11b)', () => {
    expect(tmpPathFor('/a/state/lint-report-2026-01-01.md')).toBe(
      '/a/state/lint-report-2026-01-01.md.tmp',
    );
  });

  it('正常情況:寫入內容完整,暫存檔不留下來', () => {
    const dir = scratchDir();
    try {
      const target = join(dir, 'report.md');
      atomicWriteFileSync(target, 'hello\nworld\n');
      expect(readFileSync(target, 'utf8')).toBe('hello\nworld\n');
      expect(existsSync(tmpPathFor(target))).toBe(false);
      expect(readdirSync(dir)).toEqual(['report.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('走的是 tmp → fsync → rename,而且 rename 前正式檔還沒被碰、暫存檔已經完整', () => {
    const dir = scratchDir();
    try {
      const target = join(dir, 'report.md');
      const tmp = tmpPathFor(target);
      const order: string[] = [];
      let tmpContentBeforeRename: string | undefined;
      let targetExistedBeforeRename = true;

      atomicWriteFileSync(target, 'content', {
        fsyncSync: () => {
          order.push('fsync');
        },
        renameSync: (from, to) => {
          order.push('rename');
          expect(from).toBe(tmp);
          expect(to).toBe(target);
          tmpContentBeforeRename = readFileSync(tmp, 'utf8');
          targetExistedBeforeRename = existsSync(target);
          renameSync(from, to);
        },
      });

      expect(order).toEqual(['fsync', 'rename']);
      expect(tmpContentBeforeRename).toBe('content');
      expect(targetExistedBeforeRename).toBe(false);
      expect(readFileSync(target, 'utf8')).toBe('content');
      expect(existsSync(tmp)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('寫入途中失敗(fsync 炸掉):舊的正式檔完整不動,暫存檔被清掉', () => {
    const dir = scratchDir();
    try {
      const target = join(dir, 'report.md');
      const tmp = tmpPathFor(target);
      writeFileSync(target, 'OLD COMPLETE CONTENT');

      expect(() =>
        atomicWriteFileSync(target, 'NEW PARTIAL', {
          fsyncSync: () => {
            throw new Error('disk on fire');
          },
        }),
      ).toThrow('disk on fire');

      expect(readFileSync(target, 'utf8')).toBe('OLD COMPLETE CONTENT');
      expect(existsSync(tmp)).toBe(false);
      expect(readdirSync(dir)).toEqual(['report.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('寫入途中失敗(write 炸掉):沒有舊檔時也不會憑空出現半個正式檔', () => {
    const dir = scratchDir();
    try {
      const target = join(dir, 'report.md');
      const tmp = tmpPathFor(target);

      expect(() =>
        atomicWriteFileSync(target, 'NEW', {
          writeSync: () => {
            throw new Error('EIO');
          },
        }),
      ).toThrow('EIO');

      expect(existsSync(target)).toBe(false);
      expect(existsSync(tmp)).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rename 本身失敗:正式檔保持舊內容,暫存檔也清掉', () => {
    const dir = scratchDir();
    try {
      const target = join(dir, 'report.md');
      const tmp = tmpPathFor(target);
      writeFileSync(target, 'OLD');

      expect(() =>
        atomicWriteFileSync(target, 'NEW', {
          renameSync: () => {
            throw new Error('EXDEV');
          },
        }),
      ).toThrow('EXDEV');

      expect(readFileSync(target, 'utf8')).toBe('OLD');
      expect(existsSync(tmp)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('覆蓋既有檔:新內容整份取代舊內容', () => {
    const dir = scratchDir();
    try {
      const target = join(dir, 'report.md');
      atomicWriteFileSync(target, 'first version, quite long indeed');
      atomicWriteFileSync(target, 'v2');
      expect(readFileSync(target, 'utf8')).toBe('v2');
      expect(readdirSync(dir)).toEqual(['report.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
