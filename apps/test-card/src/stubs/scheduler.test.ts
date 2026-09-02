import { describe, expect, it } from 'vitest';
import { advance, selectDue, type ReviewsMap } from './scheduler.js';
import type { Review } from '../types.js';

describe('selectDue', () => {
  it('sorts by overdue ratio, not overdue days (ADR-015)', () => {
    // sec-a:stage1、逾期0天、比例0。sec-b:stage2、逾期1天、比例1/7。
    // 天數看起來 sec-a 落後,但比例上 sec-b 更急,該排前面。
    const reviews: ReviewsMap = {
      'sec-a': { stage: 1, next_due: '2026-09-10', stuck: false },
      'sec-b': { stage: 2, next_due: '2026-09-09', stuck: false },
    };
    const { due } = selectDue(reviews, '2026-09-10', 10);
    expect(due.map((d) => d.card)).toEqual(['sec-b', 'sec-a']);
  });

  it('excludes stage 0 (new, unreviewed) and stage 6 (archived)', () => {
    const reviews: ReviewsMap = {
      'sec-new': { stage: 0, next_due: '2026-09-01', stuck: false },
      'sec-archived': { stage: 6, next_due: null, stuck: false },
      'sec-due': { stage: 1, next_due: '2026-09-01', stuck: false },
    };
    const { due } = selectDue(reviews, '2026-09-10', 10);
    expect(due.map((d) => d.card)).toEqual(['sec-due']);
  });

  it('caps at daily_cap and reports the deferred count', () => {
    const reviews: ReviewsMap = {
      a: { stage: 1, next_due: '2026-09-01', stuck: false },
      b: { stage: 1, next_due: '2026-09-01', stuck: false },
      c: { stage: 1, next_due: '2026-09-01', stuck: false },
    };
    const { due, deferred } = selectDue(reviews, '2026-09-10', 2);
    expect(due.length).toBe(2);
    expect(deferred).toBe(1);
  });
});

describe('advance', () => {
  const base: Review = {
    stage: 2,
    learned_at: '2026-09-01',
    next_due: '2026-09-10',
    fails_in_row: 0,
    total_fails: 0,
    stuck: false,
    history: [],
  };

  it('returns a new object and does not mutate the input', () => {
    const input = { ...base };
    const outcome = advance(input, { today: '2026-09-10', pass: true, type: 'apply' });
    expect(outcome.review).not.toBe(input);
    expect(input).toEqual(base);
  });

  it('advances the stage on pass and resets to stage 1 on fail', () => {
    const passOutcome = advance(base, { today: '2026-09-10', pass: true, type: 'apply' });
    expect(passOutcome.review.stage).toBe(3);

    const failOutcome = advance(base, { today: '2026-09-10', pass: false, type: 'apply' });
    expect(failOutcome.review.stage).toBe(1);
    expect(failOutcome.review.fails_in_row).toBe(1);
  });

  it('archives at stage 6 with next_due null', () => {
    const outcome = advance({ ...base, stage: 5 }, { today: '2026-09-10', pass: true, type: 'apply' });
    expect(outcome.review.stage).toBe(6);
    expect(outcome.review.next_due).toBeNull();
    expect(outcome.events).toContainEqual({ type: 'archived', card: '' });
  });
});
