import { describe, expect, it } from 'vitest';
import { applyLearnedTransition, applyPassTransition } from './transitions.js';
import type { Review, Stage } from './types.js';

function reviewAtStage(stage: Stage, overrides: Partial<Review> = {}): Review {
  return {
    stage,
    learned_at: '2026-01-01',
    next_due: stage === 6 ? null : '2026-01-02',
    fails_in_row: 0,
    total_fails: 0,
    stuck: false,
    history: [],
    ...overrides,
  };
}

describe('applyLearnedTransition', () => {
  it('新學的卡片是 stage 1,明天到期', () => {
    const review = applyLearnedTransition({ card: 'sec-0001', learnedAt: '2026-09-02' });
    expect(review.stage).toBe(1);
    expect(review.next_due).toBe('2026-09-03');
    expect(review.fails_in_row).toBe(0);
    expect(review.total_fails).toBe(0);
    expect(review.stuck).toBe(false);
    expect(review.history).toEqual([]);
  });
});

describe('applyPassTransition', () => {
  it.each([
    [1, 2, '2026-09-17'],
    [2, 3, '2026-10-10'],
    [3, 4, '2026-12-09'],
    [4, 5, '2027-03-09'],
  ] as [Stage, Stage, string][])('stage %i 通過後變 %i,下次到期 %s', (from, to, due) => {
    const review = reviewAtStage(from);
    const outcome = applyPassTransition(review, { card: 'sec-0001', today: '2026-09-10', type: 'fill', grader: 'exact' });
    expect(outcome.review.stage).toBe(to);
    expect(outcome.review.next_due).toBe(due);
    expect(outcome.events).toEqual([]);
  });

  it('通過 stage 5 之後歸檔:stage 6、沒有下次到期、emit archived', () => {
    const review = reviewAtStage(5);
    const outcome = applyPassTransition(review, { card: 'sec-0001', today: '2026-09-10', type: 'apply', grader: 'cloud' });
    expect(outcome.review.stage).toBe(6);
    expect(outcome.review.next_due).toBeNull();
    expect(outcome.events).toEqual([{ type: 'archived', card: 'sec-0001' }]);
  });

  it('歷史記錄的 stage 是被考的那個 stage(推進前),不是推進後', () => {
    const review = reviewAtStage(2);
    const outcome = applyPassTransition(review, { card: 'sec-0002', today: '2026-09-10', type: 'apply', grader: 'cloud' });
    expect(outcome.review.history).toEqual([
      { date: '2026-09-10', stage: 2, type: 'apply', pass: true, grader: 'cloud' },
    ]);
  });

  it('保留既有的歷史紀錄,新的附加在後面', () => {
    const review = reviewAtStage(1, {
      history: [{ date: '2026-09-01', stage: 1, type: 'fill', pass: false, grader: 'exact' }],
    });
    const outcome = applyPassTransition(review, { card: 'sec-0003', today: '2026-09-10', type: 'fill', grader: 'exact' });
    expect(outcome.review.history).toHaveLength(2);
    expect(outcome.review.history[0]).toEqual({ date: '2026-09-01', stage: 1, type: 'fill', pass: false, grader: 'exact' });
  });

  it('不修改輸入物件,回傳新物件', () => {
    const review = reviewAtStage(1);
    const snapshot = JSON.stringify(review);
    const outcome = applyPassTransition(review, { card: 'sec-0001', today: '2026-09-10', type: 'fill', grader: 'exact' });
    expect(JSON.stringify(review)).toBe(snapshot);
    expect(outcome.review).not.toBe(review);
  });

  it('phase-1 不碰 fails_in_row / stuck,原封不動傳遞', () => {
    const review = reviewAtStage(3, { fails_in_row: 2, total_fails: 5, stuck: true });
    const outcome = applyPassTransition(review, { card: 'sec-0001', today: '2026-09-10', type: 'apply', grader: 'cloud' });
    expect(outcome.review.fails_in_row).toBe(2);
    expect(outcome.review.total_fails).toBe(5);
    expect(outcome.review.stuck).toBe(true);
  });
});
