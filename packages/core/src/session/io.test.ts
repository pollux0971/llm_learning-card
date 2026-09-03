/**
 * io.ts 是 session 模組唯一碰磁碟的地方。這裡不對照特定的 phase-1.feature
 * 場景(那些都是透過 build/present/answer 間接用到 io),只單獨驗證每個
 * 讀寫函式的格式處理是對的,包含契約規定的驗證會擋掉壞資料。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CardId, Review } from '@contracts/index.js';
import { findCardFile, loadCardBody, loadQuestionFile, loadReviews, loadSettings, saveReviews } from './io.js';

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-session-io-'));
  tmpDirs.push(dir);
  return dir;
}

describe('loadReviews / saveReviews', () => {
  it('reads Record<CardId, Review> back from state/reviews.json', () => {
    const dir = makeDir();
    mkdirSync(join(dir, 'state'), { recursive: true });
    const review: Review = { stage: 1, learned_at: '2026-09-09', next_due: '2026-09-10', fails_in_row: 0, total_fails: 0, stuck: false, history: [] };
    writeFileSync(join(dir, 'state/reviews.json'), JSON.stringify({ 'sec-0001': review }));

    const reviews = loadReviews(dir);
    expect(reviews['sec-0001']).toEqual(review);
  });

  it('treats a missing reviews.json as no reviews yet', () => {
    const dir = makeDir();
    expect(loadReviews(dir)).toEqual({});
  });

  it('rejects a review that violates the stage-6-must-have-null-next_due rule', () => {
    const dir = makeDir();
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(
      join(dir, 'state/reviews.json'),
      JSON.stringify({ x: { stage: 6, learned_at: '2026-09-09', next_due: '2026-09-10', fails_in_row: 0, total_fails: 0, stuck: false, history: [] } }),
    );
    expect(() => loadReviews(dir)).toThrow();
  });

  it('writes the whole object atomically and it round-trips', () => {
    const dir = makeDir();
    mkdirSync(join(dir, 'state'), { recursive: true });
    const reviews: Record<CardId, Review> = {
      a: { stage: 2, learned_at: '2026-09-01', next_due: '2026-09-10', fails_in_row: 0, total_fails: 0, stuck: false, history: [] },
    };
    saveReviews(dir, reviews);
    expect(JSON.parse(readFileSync(join(dir, 'state/reviews.json'), 'utf8'))).toEqual(reviews);
  });
});

describe('loadSettings', () => {
  it('reads daily_cap and the rest of config/settings.yaml', () => {
    const dir = makeDir();
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(
      join(dir, 'config/settings.yaml'),
      [
        'daily_cap: 5',
        'weekly_target: 7',
        'short_body_limit: 50',
        'llm:',
        '  cloud_provider: anthropic',
        '  cloud_model: claude-sonnet-4-6',
        '  local_model: qwen2.5:14b',
        '',
      ].join('\n'),
    );
    const settings = loadSettings(dir);
    expect(settings.daily_cap).toBe(5);
  });

  it('rejects daily_cap <= 0 (契約 §11)', () => {
    const dir = makeDir();
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(
      join(dir, 'config/settings.yaml'),
      [
        'daily_cap: 0',
        'weekly_target: 7',
        'short_body_limit: 50',
        'llm:',
        '  cloud_provider: anthropic',
        '  cloud_model: claude-sonnet-4-6',
        '  local_model: qwen2.5:14b',
        '',
      ].join('\n'),
    );
    expect(() => loadSettings(dir)).toThrow();
  });
});

describe('loadQuestionFile', () => {
  it('reads and validates questions/<id>.yaml', () => {
    const dir = makeDir();
    mkdirSync(join(dir, 'questions'), { recursive: true });
    writeFileSync(
      join(dir, 'questions/sec-0001.yaml'),
      [
        'card: sec-0001',
        'fill:',
        '  - prompt: "答案是 ___。"',
        '    answers:',
        '      - ["對"]',
        '  - prompt: "另一個 ___。"',
        '    answers:',
        '      - ["也對"]',
        'apply:',
        '  - prompt: "解釋一下。"',
        '    rubric:',
        '      - "有講到重點"',
        '      - "沒有事實錯誤"',
        '',
      ].join('\n'),
    );
    const q = loadQuestionFile(dir, 'sec-0001');
    expect(q.card).toBe('sec-0001');
    expect(q.fill).toHaveLength(2);
    expect(q.apply).toHaveLength(1);
  });
});

describe('findCardFile / loadCardBody', () => {
  it('finds a card by id under whichever category directory holds it', () => {
    const dir = makeDir();
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    const frontmatter = '---\nid: sec-0001\ncategory: security\ntitle: t\nlevel: 0\nsource: raw\nsource_ref: raw/security/x.md#L1-L2\ncreated: 2026-09-01\n---\n';
    writeFileSync(join(dir, 'cards/security/sec-0001.md'), `${frontmatter}內文。\n`);

    const path = findCardFile(dir, 'sec-0001');
    expect(path.endsWith('cards/security/sec-0001.md')).toBe(true);
    expect(loadCardBody(dir, 'sec-0001')).toBe('內文。');
  });

  it('finds the shortened version when opts.short is set', () => {
    const dir = makeDir();
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    const frontmatter = '---\nid: sec-0001\ncategory: security\ntitle: t\nlevel: 0\nsource: raw\ncreated: 2026-09-01\n---\n';
    writeFileSync(join(dir, 'cards/security/sec-0001.short.md'), `${frontmatter}縮短版。\n`);

    expect(loadCardBody(dir, 'sec-0001', { short: true })).toBe('縮短版。');
  });

  it('throws a clear error when the card file does not exist', () => {
    const dir = makeDir();
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    expect(() => findCardFile(dir, 'sec-9999')).toThrow();
  });
});
