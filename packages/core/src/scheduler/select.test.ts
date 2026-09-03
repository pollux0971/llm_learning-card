import { describe, expect, it } from 'vitest';
import { addIsoDays } from './dates.js';
import { buildDueList } from './due.js';
import { computeOverdueRatio, selectSession, simulateSteadyState } from './select.js';
import type { SchedulableCard } from './select.js';
import type { CardId, Review, Stage } from './types.js';

/**
 * 對照 features/04-scheduler/phase-3.feature 的 10 個場景(含 Outline 展開)。
 * 三個函式現在都 throw not implemented,這裡的斷言是給下一輪實作對的行為,
 * 不是現在就要綠燈。
 */

function card(overrides: Partial<SchedulableCard> & { card: CardId }): SchedulableCard {
  return {
    stage: 1,
    types: ['fill'],
    overdue_days: 1,
    overdue_ratio: 1,
    stuck: false,
    learned_at: '2026-01-01',
    ...overrides,
  };
}

/** n 張卡,overdue_ratio 依序遞減(第一張最高),id 依序 sec-0001.. */
function manyCards(n: number): SchedulableCard[] {
  return Array.from({ length: n }, (_, i) =>
    card({ card: `sec-${String(i + 1).padStart(4, '0')}`, overdue_ratio: n - i }),
  );
}

// ------------------------------------------------------------------------
// computeOverdueRatio
// ------------------------------------------------------------------------

describe('computeOverdueRatio', () => {
  it.each([
    [1, 1, 1.0],
    [1, 3, 3.0],
    [2, 1, 1 / 7],
    [3, 3, 3 / 30],
    [4, 9, 9 / 90],
    [5, 1, 1 / 180],
  ] as [Stage, number, number][])('stage %i 逾期 %i 天,比例約 %f(距上次通過的間隔照間隔表)', (stage, late, ratio) => {
    const today = '2026-09-10';
    const nextDue = addIsoDays(today, -late);
    expect(computeOverdueRatio({ stage, next_due: nextDue }, today)).toBeCloseTo(ratio, 3);
  });

  it('剛好今天到期時比例是 0', () => {
    expect(computeOverdueRatio({ stage: 1, next_due: '2026-09-10' }, '2026-09-10')).toBe(0);
  });
});

// ------------------------------------------------------------------------
// selectSession
// ------------------------------------------------------------------------

describe('selectSession', () => {
  it('到期數多於上限時只取上限,其餘計入 deferred,輸入的卡片狀態不變', () => {
    const cards = manyCards(15);
    const snapshot = JSON.stringify(cards);
    const result = selectSession(cards, { dailyCap: 10 });
    expect(result.due).toHaveLength(10);
    expect(result.deferred).toBe(5);
    expect(JSON.stringify(cards)).toBe(snapshot);
  });

  it('到期數少於上限時全部回傳,沒有順延', () => {
    const cards = manyCards(4);
    const result = selectSession(cards, { dailyCap: 10 });
    expect(result.due).toHaveLength(4);
    expect(result.deferred).toBe(0);
  });

  it('依逾期比例高到低排序,最脆弱(比例最高)的先考', () => {
    const cards: SchedulableCard[] = [
      card({ card: 'sec-0001', stage: 5, overdue_days: 2, overdue_ratio: 2 / 180 }),
      card({ card: 'sec-0002', stage: 1, overdue_days: 1, overdue_ratio: 1 / 1 }),
      card({ card: 'sec-0003', stage: 2, overdue_days: 2, overdue_ratio: 2 / 7 }),
    ];
    const result = selectSession(cards, { dailyCap: 10 });
    expect(result.due.map((d) => d.card)).toEqual(['sec-0002', 'sec-0003', 'sec-0001']);
  });

  it('比例相同時,較早學會的卡片排前面', () => {
    const cards: SchedulableCard[] = [
      card({ card: 'sec-0002', overdue_ratio: 1, learned_at: '2026-02-01' }),
      card({ card: 'sec-0001', overdue_ratio: 1, learned_at: '2026-01-01' }),
    ];
    const result = selectSession(cards, { dailyCap: 10 });
    expect(result.due.map((d) => d.card)).toEqual(['sec-0001', 'sec-0002']);
  });

  it('上限來自 ctx.dailyCap,不是寫死的常數', () => {
    const result = selectSession(manyCards(8), { dailyCap: 5 });
    expect(result.due).toHaveLength(5);
  });

  it.each([0, -1])('上限是 %i(非正數)時丟錯,訊息帶出這個上限值', (cap) => {
    expect(() => selectSession([], { dailyCap: cap })).toThrow(String(cap));
  });

  it('reteach 佇列不佔用每日上限,原樣在獨立欄位回傳', () => {
    const dueCards = manyCards(10);
    const reteach = ['sec-1001', 'sec-1002'];
    const result = selectSession(dueCards, { dailyCap: 10, reteach });
    expect(result.due).toHaveLength(10);
    expect(result.deferred).toBe(0);
    expect(result.reteach).toEqual(reteach);
  });

  it('沒有給 reteach 時預設為空陣列', () => {
    const result = selectSession(manyCards(3), { dailyCap: 10 });
    expect(result.reteach).toEqual([]);
  });

  it('順延的卡片隔天逾期天數 +1,重新參與下一次排序', () => {
    const reviews: Record<CardId, Review> = {};
    for (let i = 1; i <= 12; i++) {
      const id = `sec-${String(i).padStart(4, '0')}`;
      reviews[id] = {
        stage: 1,
        // learned_at 遞增,讓比例打平時的順序是確定的(越早學越先考)
        learned_at: addIsoDays('2026-08-01', i),
        next_due: '2026-09-09',
        fails_in_row: 0,
        total_fails: 0,
        stuck: false,
        history: [],
      };
    }

    const day1 = '2026-09-10';
    const day1Cards: SchedulableCard[] = buildDueList(reviews, day1).map((d) => ({
      ...d,
      learned_at: reviews[d.card]!.learned_at,
    }));
    const result1 = selectSession(day1Cards, { dailyCap: 10 });
    expect(result1.due).toHaveLength(10);
    expect(result1.deferred).toBe(2);
    const selectedIds1 = new Set(result1.due.map((d) => d.card));
    const deferredIds = day1Cards.map((d) => d.card).filter((id) => !selectedIds1.has(id));
    expect(deferredIds).toHaveLength(2);

    const day2 = addIsoDays(day1, 1);
    const day2Cards: SchedulableCard[] = buildDueList(reviews, day2).map((d) => ({
      ...d,
      learned_at: reviews[d.card]!.learned_at,
    }));
    // 順延卡片的狀態沒有被 selectSession 改過(它是純函式,呼叫端才是真正推進狀態的地方),
    // 所以隔天重新從 review state 建到期清單時,它們的逾期天數比昨天多一天。
    for (const id of deferredIds) {
      const yesterday = day1Cards.find((d) => d.card === id)!;
      const today = day2Cards.find((d) => d.card === id)!;
      expect(today.overdue_days).toBe(yesterday.overdue_days + 1);
    }

    const result2 = selectSession(day2Cards, { dailyCap: 10 });
    for (const id of deferredIds) {
      expect(day2Cards.some((d) => d.card === id)).toBe(true);
    }
    expect(result2.due.length + result2.deferred).toBe(day2Cards.length);
  });
});

// ------------------------------------------------------------------------
// simulateSteadyState
// ------------------------------------------------------------------------

describe('simulateSteadyState', () => {
  it('回報 200 天的逐日題數曲線與碰到上限的頻率', () => {
    const report = simulateSteadyState({ days: 200, newCardsPerDay: 2, dailyCap: 10 });

    expect(report.daily).toHaveLength(200);
    expect(report.daily[0]!.day).toBe(1);
    expect(report.daily.at(-1)!.day).toBe(200);

    for (const day of report.daily) {
      expect(day.selected_count).toBeLessThanOrEqual(10);
      expect(day.selected_count + day.deferred_count).toBe(day.due_count);
      expect(day.cap_reached).toBe(day.deferred_count > 0);
    }

    const capReachedDays = report.daily.filter((d) => d.cap_reached).length;
    expect(report.cap_reached_days).toBe(capReachedDays);
    expect(report.cap_reached_ratio).toBeCloseTo(capReachedDays / 200, 5);
  });

  it('每天新學的卡片數照 ctx.newCardsPerDay,不是寫死的常數', () => {
    const light = simulateSteadyState({ days: 30, newCardsPerDay: 1, dailyCap: 10 });
    const heavy = simulateSteadyState({ days: 30, newCardsPerDay: 5, dailyCap: 10 });
    const totalDue = (r: typeof light) => r.daily.reduce((sum, d) => sum + d.due_count, 0);
    expect(totalDue(heavy)).toBeGreaterThan(totalDue(light));
  });
});
