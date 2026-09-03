import { describe, expect, it } from 'vitest';
import { createInitialReview, nextCalendarDay, validateReview } from './review.js';

const BASE = {
  stage: 1,
  learned_at: '2026-09-01',
  next_due: '2026-09-02',
  fails_in_row: 0,
  total_fails: 0,
  stuck: false,
  history: [] as unknown[],
};

describe('validateReview', () => {
  it('passes a well formed review', () => {
    const result = validateReview(BASE);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it.each([0, 1, 2, 3, 4, 5, 6])('accepts stage %i', (stage) => {
    const next_due = stage === 6 ? null : '2026-09-02';
    const result = validateReview({ ...BASE, stage, next_due });
    expect(result.ok).toBe(true);
  });

  it.each([7, -1])('rejects stage %i', (stage) => {
    const result = validateReview({ ...BASE, stage, next_due: '2026-09-02' });
    expect(result.ok).toBe(false);
  });

  it('passes stage 6 with a null next_due', () => {
    const result = validateReview({ ...BASE, stage: 6, next_due: null });
    expect(result.ok).toBe(true);
  });

  it('fails stage 6 with a non null next_due', () => {
    const result = validateReview({ ...BASE, stage: 6, next_due: '2026-09-20' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('next_due'))).toBe(true);
  });

  it('fails when next_due is missing entirely', () => {
    const { next_due: _drop, ...rest } = BASE;
    const result = validateReview(rest);
    expect(result.ok).toBe(false);
  });

  it('fails when fails_in_row is negative', () => {
    const result = validateReview({ ...BASE, fails_in_row: -1 });
    expect(result.ok).toBe(false);
  });

  it('fails when total_fails is negative', () => {
    const result = validateReview({ ...BASE, total_fails: -1 });
    expect(result.ok).toBe(false);
  });

  it('fails when stuck is not a boolean', () => {
    const result = validateReview({ ...BASE, stuck: 'yes' });
    expect(result.ok).toBe(false);
  });

  it('validates history entries and reports a nested path', () => {
    const result = validateReview({
      ...BASE,
      history: [{ date: '2026-09-01', stage: 1, type: 'fill', pass: true, grader: 'not-a-grader' }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('history.0.grader'))).toBe(true);
  });

  it('accepts a history entry with the optional provisional/revised fields', () => {
    const result = validateReview({
      ...BASE,
      history: [
        {
          date: '2026-09-01',
          stage: 2,
          type: 'apply',
          pass: false,
          grader: 'local-provisional',
          provisional: true,
          revised_by: 'cloud',
          revised_to: true,
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object input', () => {
    const result = validateReview(null);
    expect(result.ok).toBe(false);
  });
});

describe('nextCalendarDay', () => {
  it('adds one day within a month', () => {
    expect(nextCalendarDay('2026-09-01')).toBe('2026-09-02');
  });

  it('rolls over to the next month', () => {
    expect(nextCalendarDay('2026-09-30')).toBe('2026-10-01');
  });

  it('rolls over to the next year', () => {
    expect(nextCalendarDay('2026-12-31')).toBe('2027-01-01');
  });

  it('handles the leap day', () => {
    expect(nextCalendarDay('2024-02-28')).toBe('2024-02-29');
    expect(nextCalendarDay('2024-02-29')).toBe('2024-03-01');
  });

  it('handles a non-leap February', () => {
    expect(nextCalendarDay('2026-02-28')).toBe('2026-03-01');
  });

  it('pads a year under 1000 back out to four digits', () => {
    // 用 999,不是 0..99:JS 的 Date.UTC 對 0..99 的年份有「自動加 1900」的
    // 歷史怪癖,999 不在那個範圍,可以放心當成字面上的年份來測 padStart。
    expect(nextCalendarDay('0999-12-30')).toBe('0999-12-31');
  });
});

describe('createInitialReview', () => {
  it('builds the contract-mandated initial state', () => {
    const review = createInitialReview('2026-09-02');
    expect(review).toEqual({
      stage: 1,
      learned_at: '2026-09-02',
      next_due: '2026-09-03',
      fails_in_row: 0,
      total_fails: 0,
      stuck: false,
      history: [],
    });
  });

  it('produces a review that itself passes validation', () => {
    const review = createInitialReview('2026-01-15');
    expect(validateReview(review).ok).toBe(true);
  });

  it('rolls the due date over a month boundary', () => {
    const review = createInitialReview('2026-09-30');
    expect(review.next_due).toBe('2026-10-01');
  });
});
