/**
 * 對照 phase-1.feature 的兩個純算式場景:
 *   - 「The session ends with a summary」
 *   - 「The estimate accounts for returns and the cap」
 * 這兩個函式故意設計成不吃 Session/磁碟,所以這裡直接餵資料測邊界值。
 */
import { describe, expect, it } from 'vitest';
import { estimateTomorrow, renderDryRun, renderSummary } from './summary.js';
import type { EstimateResult } from './types.js';

describe('estimateTomorrow', () => {
  it('sums due-tomorrow and today’s returns when under the cap', () => {
    // Given 4 cards were already due tomorrow / And 2 cards were returned today
    const result = estimateTomorrow({ dueTomorrowExcludingReturns: 4, returnedToday: 2, dailyCap: 10 });
    expect(result).toEqual<EstimateResult>({ total: 6, capped: false, shown: 6, overflow: 0 });
  });

  it('reports the cap and the overflow when the total exceeds daily_cap', () => {
    const result = estimateTomorrow({ dueTomorrowExcludingReturns: 4, returnedToday: 2, dailyCap: 4 });
    expect(result).toEqual<EstimateResult>({ total: 6, capped: true, shown: 4, overflow: 2 });
  });

  it('is not capped when the total exactly equals the cap', () => {
    const result = estimateTomorrow({ dueTomorrowExcludingReturns: 3, returnedToday: 1, dailyCap: 4 });
    expect(result).toEqual<EstimateResult>({ total: 4, capped: false, shown: 4, overflow: 0 });
  });

  it('handles zero returns and zero already-due-tomorrow', () => {
    const result = estimateTomorrow({ dueTomorrowExcludingReturns: 0, returnedToday: 0, dailyCap: 10 });
    expect(result).toEqual<EstimateResult>({ total: 0, capped: false, shown: 0, overflow: 0 });
  });
});

describe('renderSummary', () => {
  it('reports passed and returned counts, and an uncapped tomorrow estimate', () => {
    // Given 5 cards were answered with 3 passes and 2 failures
    const text = renderSummary({
      passed: 3,
      failed: 2,
      errors: 0,
      tomorrow: { total: 6, capped: false, shown: 6, overflow: 0 },
    });
    expect(text).toContain('3');
    expect(text).toMatch(/pass/i);
    expect(text).toContain('2');
    expect(text).toMatch(/return/i);
    expect(text).toContain('6');
  });

  it('mentions the cap and overflow when the estimate is capped', () => {
    const text = renderSummary({
      passed: 1,
      failed: 2,
      errors: 0,
      tomorrow: { total: 6, capped: true, shown: 4, overflow: 2 },
    });
    expect(text).toContain('4');
    expect(text).toContain('2');
  });

  // T17:SessionSummaryInput 多了 answeredThisRun、retryLater(取代 errors 那一行)。基底的型別還沒有這兩欄,
  // 所以用 cast 餵進去,tsc 才會是 0 錯。
  const tomorrow = { total: 0, capped: false, shown: 0, overflow: 0 };
  const render = (input: Record<string, unknown>): string => renderSummary({ ...input } as unknown as Parameters<typeof renderSummary>[0]);

  it('prints how many questions were answered in this run', () => {
    const text = render({ passed: 4, failed: 1, errors: 0, answeredThisRun: 3, retryLater: 0, tomorrow });
    expect(text).toMatch(/4 passed, 1 returned\./);
    expect(text).toMatch(/Answered this run: 3\./);
  });

  it('prints Answered this run: 0. when nothing was answered in this run', () => {
    const text = render({ passed: 5, failed: 0, errors: 0, answeredThisRun: 0, retryLater: 0, tomorrow });
    expect(text).toMatch(/Answered this run: 0\./);
  });

  it('lists the questions left to retry, and the old grading-error line is gone', () => {
    const text = render({ passed: 2, failed: 0, errors: 1, answeredThisRun: 3, retryLater: 1, tomorrow });
    expect(text).toMatch(/Retry later: 1 question\(s\)\./);
    expect(text).not.toMatch(/grading error/);
  });

  it('omits the retry line entirely when nothing is left to retry', () => {
    const text = render({ passed: 3, failed: 0, errors: 0, answeredThisRun: 3, retryLater: 0, tomorrow });
    expect(text).not.toMatch(/Retry later/);
  });

  it('keeps the tomorrow line as before', () => {
    const text = render({ passed: 1, failed: 1, errors: 0, answeredThisRun: 2, retryLater: 0, tomorrow: { total: 6, capped: true, shown: 4, overflow: 2 } });
    expect(text).toMatch(/Tomorrow: 4 due \(daily cap reached, 2 more waiting\)\./);
  });
});

describe('renderDryRun', () => {
  it('lists each due card with its stage and overdue amount, in the given order', () => {
    // Given a scenario 1 style due list, already in scheduler order
    const text = renderDryRun([
      { card: 'sec-0003', stage: 3, overdueDays: 3 },
      { card: 'sec-0002', stage: 2, overdueDays: 1 },
    ]);
    const iSec3 = text.indexOf('sec-0003');
    const iSec2 = text.indexOf('sec-0002');
    expect(iSec3).toBeGreaterThanOrEqual(0);
    expect(iSec2).toBeGreaterThan(iSec3);
    expect(text).toContain('3');
    expect(text).toContain('1');
  });

  it('says nothing is due when the list is empty', () => {
    const text = renderDryRun([]);
    expect(text).toMatch(/nothing|沒有|無/i);
  });
});
