import { describe, expect, it } from 'vitest';
import { buildDueList } from './due.js';
import type { CardId, Review } from './types.js';

/**
 * 跟 features/04-scheduler/phase-1.feature 的 review state 表一致(sec-0001..0005),
 * 再加兩張邊界卡:
 * - sec-0006:stage 5 到期 → 確認上界 5 有包含(殺掉 `> 5` 改 `>= 5`)
 * - sec-0007:stage 6 但 next_due 非 null → 確認 stage 6 不是只靠 next_due===null 排除(殺掉 `> 5` 改 false)
 *
 * 插入順序故意打亂,跟 card id 排序後的順序不同,才能證明回傳有排序(殺掉 sort 拿掉)。
 */
function reviewFixture(): Record<CardId, Review> {
  return {
    'sec-0006': { stage: 5, learned_at: '2026-01-01', next_due: '2026-09-01', fails_in_row: 0, total_fails: 0, stuck: false, history: [] },
    'sec-0002': { stage: 2, learned_at: '2026-08-01', next_due: '2026-09-09', fails_in_row: 0, total_fails: 0, stuck: false, history: [] },
    'sec-0007': { stage: 6, learned_at: '2025-09-01', next_due: '2026-09-01', fails_in_row: 0, total_fails: 0, stuck: false, history: [] },
    'sec-0001': { stage: 1, learned_at: '2026-09-01', next_due: '2026-09-10', fails_in_row: 0, total_fails: 0, stuck: false, history: [] },
    'sec-0003': { stage: 3, learned_at: '2026-08-01', next_due: '2026-09-11', fails_in_row: 0, total_fails: 1, stuck: false, history: [] },
    'sec-0004': { stage: 6, learned_at: '2025-09-01', next_due: null, fails_in_row: 0, total_fails: 2, stuck: false, history: [] },
    'sec-0005': { stage: 0, learned_at: '2026-09-09', next_due: '2026-09-10', fails_in_row: 0, total_fails: 0, stuck: false, history: [] },
  };
}

describe('buildDueList', () => {
  it('只包含今天或之前到期、stage 1..5 的卡片,並照 card id 排序', () => {
    const due = buildDueList(reviewFixture(), '2026-09-10');
    expect(due.map((d) => d.card)).toEqual(['sec-0001', 'sec-0002', 'sec-0006']);
  });

  it('stage 1(下界)到期時包含', () => {
    const due = buildDueList(reviewFixture(), '2026-09-10');
    expect(due.some((d) => d.card === 'sec-0001')).toBe(true);
  });

  it('stage 5(上界)到期時包含', () => {
    const due = buildDueList(reviewFixture(), '2026-09-10');
    expect(due.some((d) => d.card === 'sec-0006')).toBe(true);
  });

  it('stage 0(剛學)一律排除,即使 next_due 已到', () => {
    const due = buildDueList(reviewFixture(), '2026-09-10');
    expect(due.some((d) => d.card === 'sec-0005')).toBe(false);
  });

  it('stage 6(已歸檔)在任何日期都不會出現', () => {
    const due = buildDueList(reviewFixture(), '2099-01-01');
    expect(due.some((d) => d.card === 'sec-0004')).toBe(false);
  });

  it('stage 6 即使 next_due 不是 null 也排除', () => {
    const due = buildDueList(reviewFixture(), '2026-09-10');
    expect(due.some((d) => d.card === 'sec-0007')).toBe(false);
  });

  it('未來才到期的卡片不包含在內', () => {
    const due = buildDueList(reviewFixture(), '2026-09-10');
    expect(due.some((d) => d.card === 'sec-0003')).toBe(false);
  });

  it('回傳順序是 card id 字典序,不是插入順序', () => {
    const reviews: Record<CardId, Review> = {
      'sec-0003': { stage: 3, learned_at: '2026-01-01', next_due: '2026-09-01', fails_in_row: 0, total_fails: 0, stuck: false, history: [] },
      'sec-0001': { stage: 1, learned_at: '2026-01-01', next_due: '2026-09-01', fails_in_row: 0, total_fails: 0, stuck: false, history: [] },
      'sec-0002': { stage: 2, learned_at: '2026-01-01', next_due: '2026-09-01', fails_in_row: 0, total_fails: 0, stuck: false, history: [] },
    };
    expect(Object.keys(reviews)).toEqual(['sec-0003', 'sec-0001', 'sec-0002']);
    const due = buildDueList(reviews, '2026-09-10');
    expect(due.map((d) => d.card)).toEqual(['sec-0001', 'sec-0002', 'sec-0003']);
  });

  it('剛好今天到期的 overdue_days 是 0,overdue_ratio 是 0', () => {
    const due = buildDueList(reviewFixture(), '2026-09-10');
    const item = due.find((d) => d.card === 'sec-0001')!;
    expect(item.overdue_days).toBe(0);
    expect(item.overdue_ratio).toBe(0);
  });

  it('逾期天數與逾期比例照間隔表計算', () => {
    const due = buildDueList(reviewFixture(), '2026-09-10');
    const item = due.find((d) => d.card === 'sec-0002')!;
    expect(item.overdue_days).toBe(1);
    expect(item.overdue_ratio).toBeCloseTo(1 / 7);
  });

  it('stage 5 逾期 9 天,比例是 9/180', () => {
    const due = buildDueList(reviewFixture(), '2026-09-10');
    const item = due.find((d) => d.card === 'sec-0006')!;
    expect(item.stage).toBe(5);
    expect(item.overdue_days).toBe(9);
    expect(item.overdue_ratio).toBeCloseTo(9 / 180);
  });

  it('每張卡的 types 照 stage 對應', () => {
    const due = buildDueList(reviewFixture(), '2026-09-10');
    expect(due.find((d) => d.card === 'sec-0001')!.types).toEqual(['fill']);
    expect(due.find((d) => d.card === 'sec-0002')!.types).toEqual(['fill', 'apply']);
    expect(due.find((d) => d.card === 'sec-0006')!.types).toEqual(['apply']);
  });

  it('stuck 原樣從 review 傳遞出來', () => {
    const reviews = reviewFixture();
    reviews['sec-0001']!.stuck = true;
    const due = buildDueList(reviews, '2026-09-10');
    expect(due.find((d) => d.card === 'sec-0001')!.stuck).toBe(true);
    expect(due.find((d) => d.card === 'sec-0002')!.stuck).toBe(false);
  });

  it('沒有到期卡片時回傳空陣列', () => {
    expect(buildDueList({}, '2026-09-10')).toEqual([]);
  });
});
