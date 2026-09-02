import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as yamlParse } from 'yaml';
import { initLearningDir, isoWeek } from './init.js';

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('initLearningDir', () => {
  it('creates the full directory tree and default state files', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    const result = initLearningDir(dir, { today: new Date('2026-09-10T00:00:00Z') });

    for (const name of ['raw', 'cards', 'questions', 'assets', 'state', 'graph', 'config']) {
      expect(result.created).toContain(`${name}/`);
    }

    expect(JSON.parse(readFileSync(join(dir, 'state/reviews.json'), 'utf8'))).toEqual({});

    const weekly = JSON.parse(readFileSync(join(dir, 'state/weekly.json'), 'utf8'));
    expect(weekly.week).toBe('2026-W37');
    expect(weekly.target).toBeGreaterThan(0);

    expect(JSON.parse(readFileSync(join(dir, 'graph/deps.json'), 'utf8'))).toEqual({});

    const categories = yamlParse(readFileSync(join(dir, 'config/categories.yaml'), 'utf8'));
    expect(categories).toEqual([]);

    const settings = yamlParse(readFileSync(join(dir, 'config/settings.yaml'), 'utf8'));
    expect(settings.daily_cap).toBe(10);
    expect(settings.weekly_target).toBe(7);
    expect(settings.short_body_limit).toBe(50);
  });

  it('does not overwrite existing state on a second run', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    initLearningDir(dir);
    const reviewsPath = join(dir, 'state/reviews.json');
    writeFileSync(reviewsPath, JSON.stringify({ 'sec-0001': { stage: 1 } }));

    const second = initLearningDir(dir);

    expect(second.skipped).toContain('state/reviews.json');
    expect(JSON.parse(readFileSync(reviewsPath, 'utf8'))).toEqual({ 'sec-0001': { stage: 1 } });
  });
});

describe('isoWeek', () => {
  it.each([
    ['2026-09-10', '2026-W37'],
    ['2026-01-01', '2026-W01'],
    ['2025-12-29', '2026-W01'],
  ])('%s -> %s', (date, expected) => {
    expect(isoWeek(new Date(`${date}T00:00:00Z`))).toBe(expected);
  });
});
