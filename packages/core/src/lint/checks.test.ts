import { describe, it, expect } from 'vitest';
import {
  checkBodyLimit,
  checkMissingQuestions,
  checkOrphanQuestions,
  checkMissingPrereqs,
  checkOrphanChildren,
  findCycles,
  checkPrereqMismatch,
  checkReviewOrphans,
  checkStatuses,
  runChecks,
} from './checks.js';
import type { ScannedDir, ScannedCard, ScannedQuestionFile } from './scan.js';
import type { CardFrontmatterMin } from './validator-min.js';

function card(id: string, overrides: Partial<CardFrontmatterMin> = {}, body = '短短的正文。'): ScannedCard {
  return {
    id,
    category: 'security',
    path: `cards/security/${id}.md`,
    parsed: {
      frontmatter: { id, category: 'security', title: id, level: 0, source: 'raw', created: '2026-09-01', ...overrides },
      body,
      examples: [],
    },
  };
}

function question(id: string, cardId = id): ScannedQuestionFile {
  return { id, card: cardId, path: `questions/${id}.yaml` };
}

function baseDir(overrides: Partial<ScannedDir> = {}): ScannedDir {
  return { root: '/tmp/does-not-matter', cards: [], questions: [], graphs: {}, reviews: {}, ...overrides };
}

describe('checkBodyLimit', () => {
  it('超過 100 字的回報', () => {
    const over = '同'.repeat(101);
    const dir = baseDir({ cards: [card('sec-0001', {}, over)] });
    const problems = checkBodyLimit(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ type: 'body_over_limit', card: 'sec-0001' });
  });

  it('剛好 100 字不算超過', () => {
    const exact = '同'.repeat(100);
    const dir = baseDir({ cards: [card('sec-0001', {}, exact)] });
    expect(checkBodyLimit(dir)).toHaveLength(0);
  });
});

describe('checkMissingQuestions / checkOrphanQuestions', () => {
  it('沒有考題檔的卡片被回報', () => {
    const dir = baseDir({ cards: [card('sec-0001'), card('sec-0002')], questions: [question('sec-0001')] });
    const problems = checkMissingQuestions(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.card).toBe('sec-0002');
  });

  it('考題檔對應的卡片不存在時回報孤兒', () => {
    const dir = baseDir({ cards: [card('sec-0001')], questions: [question('sec-0001'), question('sec-9999')] });
    const problems = checkOrphanQuestions(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ type: 'orphan_questions', card: 'sec-9999' });
  });
});

describe('checkMissingPrereqs / checkOrphanChildren', () => {
  it('prereq 指向不存在的卡片', () => {
    const dir = baseDir({ cards: [card('sec-0001', { prereqs: ['sec-9999'] })] });
    const problems = checkMissingPrereqs(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ type: 'missing_prereq', card: 'sec-0001' });
  });

  it('parent 指向不存在的卡片', () => {
    const dir = baseDir({ cards: [card('sec-0010', { level: 1, parent: 'sec-9999' })] });
    const problems = checkOrphanChildren(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ type: 'orphan_child', card: 'sec-0010' });
  });
});

describe('findCycles', () => {
  it('找到迴圈並回傳完整路徑', () => {
    const dir = baseDir({
      graphs: {
        security: {
          nodes: ['a', 'b', 'c'],
          edges: [
            ['a', 'b'],
            ['b', 'c'],
            ['c', 'a'],
          ],
        },
      },
    });
    const problems = findCycles(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain('a → b → c → a');
  });

  it('無環的圖不回報', () => {
    const dir = baseDir({ graphs: { security: { nodes: ['a', 'b'], edges: [['a', 'b']] } } });
    expect(findCycles(dir)).toHaveLength(0);
  });
});

describe('checkPrereqMismatch', () => {
  it('卡片的 prereqs 跟 graph 的 edges 不一致時回報', () => {
    const dir = baseDir({
      cards: [card('sec-0001'), card('sec-0002', { prereqs: [] })],
      graphs: { security: { nodes: ['sec-0001', 'sec-0002'], edges: [['sec-0001', 'sec-0002']] } },
    });
    const problems = checkPrereqMismatch(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ type: 'prereq_mismatch', card: 'sec-0002' });
  });

  it('一致時不回報', () => {
    const dir = baseDir({
      cards: [card('sec-0001'), card('sec-0002', { prereqs: ['sec-0001'] })],
      graphs: { security: { nodes: ['sec-0001', 'sec-0002'], edges: [['sec-0001', 'sec-0002']] } },
    });
    expect(checkPrereqMismatch(dir)).toHaveLength(0);
  });

  it('迴圈成員不重複回報 mismatch(已經算在 cycle 裡)', () => {
    const dir = baseDir({
      cards: [card('a', { prereqs: [] }), card('b', { prereqs: [] })],
      graphs: {
        security: {
          nodes: ['a', 'b'],
          edges: [
            ['a', 'b'],
            ['b', 'a'],
          ],
        },
      },
    });
    expect(checkPrereqMismatch(dir)).toHaveLength(0);
  });
});

describe('checkReviewOrphans', () => {
  it('複習狀態裡的卡片不存在時回報', () => {
    const dir = baseDir({ cards: [card('sec-0001')], reviews: { 'sec-0001': {}, 'sec-9999': {} } });
    const problems = checkReviewOrphans(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ type: 'review_orphan', card: 'sec-9999' });
  });
});

describe('checkStatuses', () => {
  it('stale 與 source_missing 分開列,且不是問題', () => {
    const dir = baseDir({
      cards: [card('sec-0001', { stale: true }), card('sec-0002', { source_missing: true }), card('sec-0003')],
    });
    const statuses = checkStatuses(dir);
    expect(statuses).toHaveLength(2);
    expect(statuses.find((s) => s.card === 'sec-0001')).toMatchObject({ type: 'stale' });
    expect(statuses.find((s) => s.card === 'sec-0002')).toMatchObject({ type: 'source_missing' });
  });
});

describe('runChecks', () => {
  it('乾淨的目錄回報 0 個問題', () => {
    const dir = baseDir({
      cards: [card('sec-0001'), card('sec-0002', { prereqs: ['sec-0001'] })],
      questions: [question('sec-0001'), question('sec-0002')],
      graphs: { security: { nodes: ['sec-0001', 'sec-0002'], edges: [['sec-0001', 'sec-0002']] } },
    });
    const result = runChecks(dir);
    expect(result.problems).toHaveLength(0);
    expect(result.statuses).toHaveLength(0);
  });
});
