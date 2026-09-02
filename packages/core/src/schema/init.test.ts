import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as yamlParse } from 'yaml';
import { DEFAULT_SETTINGS, initLearningDir, isoWeek } from './init.js';

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const EXPECTED_DIRS = ['raw/', 'cards/', 'questions/', 'assets/', 'state/', 'graph/', 'config/'];
const EXPECTED_FILES = [
  'state/reviews.json',
  'state/weekly.json',
  'graph/deps.json',
  'config/categories.yaml',
  'config/settings.yaml',
];
const EXPECTED_ALL = [...EXPECTED_DIRS, ...EXPECTED_FILES];

describe('DEFAULT_SETTINGS', () => {
  it('matches contract §11 defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      daily_cap: 10,
      weekly_target: 7,
      short_body_limit: 50,
      llm: {
        cloud_provider: 'anthropic',
        cloud_model: 'claude-sonnet-4-6',
        local_model: 'qwen2.5:14b',
      },
    });
  });
});

describe('initLearningDir', () => {
  it('creates exactly the contract §12 directories and default files, in order', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    const result = initLearningDir(dir, { today: new Date('2026-09-10T00:00:00Z') });

    expect(result.created).toEqual(EXPECTED_ALL);
    expect(result.created).toHaveLength(12);
    expect(result.skipped).toEqual([]);

    for (const name of EXPECTED_DIRS) expect(existsSync(join(dir, name))).toBe(true);
    for (const name of EXPECTED_FILES) expect(existsSync(join(dir, name))).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(['assets', 'cards', 'config', 'graph', 'questions', 'raw', 'state']);
  });

  it('writes reviews.json as an empty pretty-printed object with a trailing newline', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    initLearningDir(dir);
    expect(readFileSync(join(dir, 'state/reviews.json'), 'utf8')).toBe('{}\n');
  });

  it('writes weekly.json with the given week, the default target and zeroed counters', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    initLearningDir(dir, { today: new Date('2026-09-10T00:00:00Z') });

    const text = readFileSync(join(dir, 'state/weekly.json'), 'utf8');
    expect(JSON.parse(text)).toEqual({ week: '2026-W37', target: 7, learned: 0, passed_d1: 0, counted: [] });
    expect(text).toBe(
      `${JSON.stringify({ week: '2026-W37', target: 7, learned: 0, passed_d1: 0, counted: [] }, null, 2)}\n`,
    );
  });

  it('uses the current week when no date is given', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    initLearningDir(dir);
    const weekly = JSON.parse(readFileSync(join(dir, 'state/weekly.json'), 'utf8'));
    expect(weekly.week).toBe(isoWeek(new Date()));
  });

  it('leaves no temp files behind in state/', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    initLearningDir(dir);
    expect(readdirSync(join(dir, 'state')).sort()).toEqual(['reviews.json', 'weekly.json']);
  });

  it('writes deps.json as an empty pretty-printed object with a trailing newline', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    initLearningDir(dir);
    expect(readFileSync(join(dir, 'graph/deps.json'), 'utf8')).toBe('{}\n');
  });

  it('writes categories.yaml as an empty list and settings.yaml with the full defaults', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    initLearningDir(dir);

    expect(yamlParse(readFileSync(join(dir, 'config/categories.yaml'), 'utf8'))).toEqual([]);
    expect(yamlParse(readFileSync(join(dir, 'config/settings.yaml'), 'utf8'))).toEqual(DEFAULT_SETTINGS);
  });

  it('creates the learning directory itself when it does not exist yet (recursive)', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    const nested = join(dir, 'deep', 'er', 'learning');
    expect(existsSync(nested)).toBe(false);

    const result = initLearningDir(nested);

    expect(result.created).toEqual(EXPECTED_ALL);
    expect(existsSync(join(nested, 'state/weekly.json'))).toBe(true);
  });

  it('reports everything as skipped and creates nothing on a second run', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    initLearningDir(dir);

    const second = initLearningDir(dir);

    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(EXPECTED_ALL);
  });

  it('does not overwrite existing state on a second run', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    initLearningDir(dir);
    const reviewsPath = join(dir, 'state/reviews.json');
    const weeklyPath = join(dir, 'state/weekly.json');
    writeFileSync(reviewsPath, JSON.stringify({ 'sec-0001': { stage: 1 } }));
    writeFileSync(weeklyPath, JSON.stringify({ week: '2020-W01', target: 3, learned: 2, passed_d1: 1, counted: ['sec-0001'] }));

    const second = initLearningDir(dir);

    expect(second.skipped).toContain('state/reviews.json');
    expect(second.skipped).toContain('state/weekly.json');
    expect(JSON.parse(readFileSync(reviewsPath, 'utf8'))).toEqual({ 'sec-0001': { stage: 1 } });
    expect(JSON.parse(readFileSync(weeklyPath, 'utf8'))).toEqual({
      week: '2020-W01',
      target: 3,
      learned: 2,
      passed_d1: 1,
      counted: ['sec-0001'],
    });
  });

  it('does not overwrite existing graph or config files on a second run', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    initLearningDir(dir);
    writeFileSync(join(dir, 'graph/deps.json'), '{"sec-0001":["sec-0002"]}');
    writeFileSync(join(dir, 'config/categories.yaml'), '- security\n');
    writeFileSync(join(dir, 'config/settings.yaml'), 'daily_cap: 3\n');

    const second = initLearningDir(dir);

    expect(second.created).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, 'graph/deps.json'), 'utf8'))).toEqual({ 'sec-0001': ['sec-0002'] });
    expect(yamlParse(readFileSync(join(dir, 'config/categories.yaml'), 'utf8'))).toEqual(['security']);
    expect(yamlParse(readFileSync(join(dir, 'config/settings.yaml'), 'utf8'))).toEqual({ daily_cap: 3 });
  });

  it('only creates the missing pieces when some directories already exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
    initLearningDir(dir);
    rmSync(join(dir, 'graph'), { recursive: true, force: true });
    rmSync(join(dir, 'state/weekly.json'));

    const result = initLearningDir(dir);

    expect(result.created).toEqual(['graph/', 'state/weekly.json', 'graph/deps.json']);
    expect(result.skipped).toEqual([
      'raw/',
      'cards/',
      'questions/',
      'assets/',
      'state/',
      'config/',
      'state/reviews.json',
      'config/categories.yaml',
      'config/settings.yaml',
    ]);
  });
});

describe('isoWeek', () => {
  it.each([
    ['2026-09-10', '2026-W37'],
    ['2026-09-13', '2026-W37'],
    ['2026-09-14', '2026-W38'],
    ['2026-06-15', '2026-W25'],
    ['2026-01-01', '2026-W01'],
    ['2025-12-29', '2026-W01'],
    ['2026-12-31', '2026-W53'],
    ['2027-01-01', '2026-W53'],
    ['2027-01-04', '2027-W01'],
    ['2024-12-30', '2025-W01'],
    ['2020-12-31', '2020-W53'],
    ['2021-01-03', '2020-W53'],
  ])('%s -> %s', (date, expected) => {
    expect(isoWeek(new Date(`${date}T00:00:00Z`))).toBe(expected);
  });

  it('uses the local calendar date, not the UTC instant', () => {
    // 建一個當地時間的日期(不帶 Z),確認用的是 getFullYear/getMonth/getDate
    const local = new Date(2026, 8, 14, 0, 30); // 2026-09-14 00:30 當地時間,週一
    expect(isoWeek(local)).toBe('2026-W38');
    const localSunday = new Date(2026, 8, 13, 23, 30); // 2026-09-13 23:30 當地時間,週日
    expect(isoWeek(localSunday)).toBe('2026-W37');
  });

  it('always pads the week number to two digits', () => {
    expect(isoWeek(new Date('2026-01-05T00:00:00Z'))).toMatch(/^\d{4}-W\d{2}$/);
    expect(isoWeek(new Date('2026-01-05T00:00:00Z'))).toBe('2026-W02');
  });
});
