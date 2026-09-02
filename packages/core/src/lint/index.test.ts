import { describe, it, expect } from 'vitest';
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { lint } from './index.js';

const ROOT = resolve(import.meta.dirname, '../../../..');

function copyFixture(name: string): string {
  const src = join(ROOT, 'contracts/fixtures', name);
  const dst = mkdtempSync(join(tmpdir(), 'lc-lint-'));
  cpSync(src, dst, { recursive: true });
  return dst;
}

describe('lint() 對真實 fixture', () => {
  it('learning-broken 回報 10 個問題(見 EXPECTED.md)', () => {
    const dir = copyFixture('learning-broken');
    try {
      const result = lint(dir);
      expect(result.problems).toHaveLength(10);
      expect(result.statuses).toHaveLength(1);
      expect(result.statuses[0]).toMatchObject({ type: 'stale', card: 'sec-0004' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('learning-minimal 回報 0 個問題', () => {
    const dir = copyFixture('learning-minimal');
    try {
      const result = lint(dir);
      expect(result.problems).toHaveLength(0);
      expect(result.statuses).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
