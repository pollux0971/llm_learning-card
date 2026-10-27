/**
 * T67 紅測試(純函式):`estimateTomorrowFrom`(session/summary.ts)與 `countLearnedOn`(teach/deck.ts)。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T67-teach-card-daily-load-hint.md「要的結果」第 1、2 節與「紅測試」表的「純函式」「不退步」。
 *
 * 被測函式用 `import * as` 再取名字:基底上它們還不存在,tsc 仍要乾淨(紅在「不是函式」,不是編譯錯)。
 * 預期值全部手算,照現有 summarizeDay 的算法(engine.ts):
 *   明天 = nextCalendarDay(today);dueAll = buildDueList(reviews, 明天).length(stage 1–5、next_due ≤ 明天);
 *   returned = tallyToday(queueCards, reviews, today).returned;total = max(0, dueAll − returned) + returned;再套 dailyCap(estimateTomorrow)。
 *
 * 本來就綠(基底上已成立,守不退步):summarizeDay 的數字(最後一個 describe 的「不退步」兩條)。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Review } from '@contracts/index.js';
import * as deckModule from '../teach/deck.js';
import { summarizeDay } from './engine.js';
import * as summaryModule from './summary.js';
import { toSessionCache } from './cache.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type EstimateResult = { total: number; capped: boolean; shown: number; overflow: number };
type EstimateFn = (input: { reviews: Readonly<Record<string, Review>>; today: string; queueCards: readonly string[]; dailyCap: number }) => EstimateResult;
type CountFn = (reviews: Readonly<Record<string, Review>>, day: string) => number;

const estimateTomorrowFrom = (summaryModule as unknown as { estimateTomorrowFrom?: EstimateFn }).estimateTomorrowFrom as EstimateFn;
const countLearnedOn = (deckModule as unknown as { countLearnedOn?: CountFn }).countLearnedOn as CountFn;

const TODAY = '2026-09-10';
const YESTERDAY = '2026-09-09';
const TOMORROW = '2026-09-11';

interface Entry {
  pass: boolean;
  revised_to?: boolean;
  date?: string;
}
function review(stage: number, nextDue: string | null, over: { learnedAt?: string; today?: Entry[] } = {}): Review {
  return {
    stage,
    learned_at: over.learnedAt ?? '2026-09-01',
    next_due: nextDue,
    fails_in_row: 0,
    total_fails: 0,
    stuck: false,
    history: (over.today ?? []).map((e) => ({
      date: e.date ?? TODAY,
      stage: Math.max(1, stage),
      type: 'fill',
      pass: e.pass,
      grader: 'exact',
      ...(e.revised_to === undefined ? {} : { revised_to: e.revised_to }),
    })),
  } as unknown as Review;
}

describe('estimateTomorrowFrom(兩邊共用的明天預估)', () => {
  it('匯出存在、是函式', () => {
    expect(typeof estimateTomorrowFrom).toBe('function');
  });

  it('沒有任何紀錄、沒有名單:全 0,不出錯', () => {
    expect(estimateTomorrowFrom({ reviews: {}, today: TODAY, queueCards: [], dailyCap: 10 })).toEqual({ total: 0, capped: false, shown: 0, overflow: 0 });
  });

  it('數明天到期(next_due ≤ 明天、stage 1–5):含逾期的;stage 6(歸檔)、stage 0、之後才到期的不算', () => {
    const reviews = {
      'a-0001': review(1, TOMORROW),
      'a-0002': review(2, TODAY),
      'a-0003': review(3, '2026-09-12'),
      'a-0004': review(6, null),
      'a-0005': review(0, TOMORROW),
      'a-0006': review(5, '2026-09-01'),
    };
    expect(estimateTomorrowFrom({ reviews, today: TODAY, queueCards: [], dailyCap: 10 })).toEqual({ total: 3, capped: false, shown: 3, overflow: 0 });
  });

  it('今天回退的卡:算進「回退」,total = max(0, 明天到期 − 回退) + 回退(明天到期 3 張裡有 2 張是回退的 → 3)', () => {
    const reviews = {
      'a-0001': review(1, TOMORROW, { today: [{ pass: false }] }),
      'a-0002': review(1, TOMORROW, { today: [{ pass: false }] }),
      'a-0003': review(2, '2026-09-14', { today: [{ pass: true }] }),
      'a-0004': review(1, TOMORROW),
    };
    const queueCards = ['a-0001', 'a-0002', 'a-0003'];
    expect(estimateTomorrowFrom({ reviews, today: TODAY, queueCards, dailyCap: 10 })).toEqual({ total: 3, capped: false, shown: 3, overflow: 0 });
  });

  it('回退的卡明天不一定到期:明天到期 0、回退 2 → total 2(max(0, 0 − 2) = 0,再加回退)', () => {
    const reviews = {
      'a-0001': review(1, '2026-09-20', { today: [{ pass: false }] }),
      'a-0002': review(1, '2026-09-20', { today: [{ pass: false }] }),
    };
    expect(estimateTomorrowFrom({ reviews, today: TODAY, queueCards: ['a-0001', 'a-0002'], dailyCap: 10 })).toEqual({ total: 2, capped: false, shown: 2, overflow: 0 });
  });

  it('有效結果是 revised_to ?? pass:原本沒過、雲端改成過 → 不算回退;原本過、改成沒過 → 算回退', () => {
    const reviews = {
      'a-0001': review(1, '2026-09-20', { today: [{ pass: false, revised_to: true }] }),
      'a-0002': review(1, '2026-09-20', { today: [{ pass: true, revised_to: false }] }),
    };
    expect(estimateTomorrowFrom({ reviews, today: TODAY, queueCards: ['a-0001', 'a-0002'], dailyCap: 10 }).total).toBe(1);
  });

  it('名單裡今天沒有紀錄的卡(批改失敗或沒問到)不算回退;名單裡不在 reviews 的 id 不出錯', () => {
    const reviews = { 'a-0001': review(1, '2026-09-20'), 'a-0002': review(1, '2026-09-20', { today: [{ pass: false, date: YESTERDAY }] }) };
    expect(estimateTomorrowFrom({ reviews, today: TODAY, queueCards: ['a-0001', 'a-0002', 'zz-9999'], dailyCap: 10 }).total).toBe(0);
  });

  it('名單以外的卡今天的紀錄不算回退(queueCards 才是範圍)', () => {
    const reviews = { 'a-0001': review(1, '2026-09-20', { today: [{ pass: false }] }) };
    expect(estimateTomorrowFrom({ reviews, today: TODAY, queueCards: [], dailyCap: 10 }).total).toBe(0);
  });

  it('每日上限:剛好等於上限不算超(capped false);多 1 張才 capped,shown = 上限、overflow = 1', () => {
    const reviews = { 'a-0001': review(1, TOMORROW), 'a-0002': review(1, TOMORROW), 'a-0003': review(1, TOMORROW) };
    expect(estimateTomorrowFrom({ reviews, today: TODAY, queueCards: [], dailyCap: 3 })).toEqual({ total: 3, capped: false, shown: 3, overflow: 0 });
    expect(estimateTomorrowFrom({ reviews, today: TODAY, queueCards: [], dailyCap: 2 })).toEqual({ total: 3, capped: true, shown: 2, overflow: 1 });
  });

  it('「明天」是 today 的下一個日曆日,跨月也對(today 2026-09-30 → 明天 10-01)', () => {
    const reviews = { 'a-0001': review(1, '2026-10-01'), 'a-0002': review(1, '2026-10-02') };
    expect(estimateTomorrowFrom({ reviews, today: '2026-09-30', queueCards: [], dailyCap: 10 }).total).toBe(1);
  });

  it('不改傳進去的東西(reviews、queueCards 原樣)', () => {
    const reviews = { 'a-0001': review(1, TOMORROW, { today: [{ pass: false }] }) };
    const before = JSON.stringify(reviews);
    const queue = ['a-0001'];
    estimateTomorrowFrom({ reviews, today: TODAY, queueCards: queue, dailyCap: 10 });
    expect(JSON.stringify(reviews)).toBe(before);
    expect(queue).toEqual(['a-0001']);
  });
});

describe('countLearnedOn(今天學了幾張)', () => {
  it('匯出存在、是函式', () => {
    expect(typeof countLearnedOn).toBe('function');
  });

  it('空 → 0', () => {
    expect(countLearnedOn({}, TODAY)).toBe(0);
  });

  it('只數 learned_at 等於那一天的:今天 4 張、昨天 1 張 → 4', () => {
    const reviews = {
      'a-0001': review(1, TOMORROW, { learnedAt: TODAY }),
      'a-0002': review(1, TOMORROW, { learnedAt: TODAY }),
      'a-0003': review(1, TOMORROW, { learnedAt: TODAY }),
      'a-0004': review(1, TOMORROW, { learnedAt: TODAY }),
      'a-0005': review(1, TODAY, { learnedAt: YESTERDAY }),
    };
    expect(countLearnedOn(reviews, TODAY)).toBe(4);
    expect(countLearnedOn(reviews, YESTERDAY)).toBe(1);
  });

  it('不看 stage、next_due、history:歸檔的、考過的,只要 learned_at 是那天都算', () => {
    const reviews = {
      'a-0001': review(6, null, { learnedAt: TODAY }),
      'a-0002': review(3, '2026-09-20', { learnedAt: TODAY, today: [{ pass: true }] }),
    };
    expect(countLearnedOn(reviews, TODAY)).toBe(2);
  });

  it('日期要整個相等:未來的日子、差一天、前綴相同的字串都不算', () => {
    const reviews = { 'a-0001': review(1, TOMORROW, { learnedAt: TOMORROW }), 'a-0002': review(1, TOMORROW, { learnedAt: '2026-09-100' }) };
    expect(countLearnedOn(reviews, TODAY)).toBe(0);
    expect(countLearnedOn(reviews, '2026-09-10')).toBe(0);
  });
});

// ---------------------------------------------------------------- 不退步:summarizeDay 的小結數字(本來就綠)

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function learningWith(reviews: Record<string, Review>): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-t67-est-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(join(dir, 'state/reviews.json'), JSON.stringify(reviews), 'utf8');
  return dir;
}
const cacheOf = (cards: string[]) =>
  toSessionCache({ date: TODAY, paused: false, totalDue: cards.length, deferred: 0, queue: cards.map((card) => ({ card, stage: 1, overdue_days: 0, overdue_ratio: 0 })), reteach: [] });

describe('不退步:summarizeDay 的小結數字不變(06、11 的小結)', () => {
  const reviews = {
    'a-0001': review(1, TOMORROW, { today: [{ pass: false }] }),
    'a-0002': review(1, TOMORROW, { today: [{ pass: false }] }),
    'a-0003': review(2, '2026-09-14', { today: [{ pass: true }] }),
    'a-0004': review(1, TOMORROW),
    'a-0005': review(2, '2026-09-30'),
  };
  const queue = ['a-0001', 'a-0002', 'a-0003', 'a-0005'];

  it('通過 1、回退 2、沒問到 1;明天預估 3 張(不到上限)', () => {
    const out = summarizeDay({ learningDir: learningWith(reviews), today: TODAY, cache: cacheOf(queue), dailyCap: 10, answeredThisRun: 3, resumed: false });
    expect(out).toMatchObject({ passed: 1, failed: 2, retryLater: 1, tomorrow: { total: 3, capped: false, shown: 3, overflow: 0 } });
  });

  it('上限 2:total 3、shown 2、overflow 1', () => {
    const out = summarizeDay({ learningDir: learningWith(reviews), today: TODAY, cache: cacheOf(queue), dailyCap: 2, answeredThisRun: 3, resumed: false });
    expect(out.tomorrow).toEqual({ total: 3, capped: true, shown: 2, overflow: 1 });
  });
});

describe('summarizeDay 的明天預估 = estimateTomorrowFrom(同一個算法,只有一份)', () => {
  const reviews = {
    'a-0001': review(1, TOMORROW, { today: [{ pass: false }] }),
    'a-0002': review(2, '2026-09-14', { today: [{ pass: true }] }),
    'a-0003': review(1, TOMORROW),
    'a-0004': review(1, TOMORROW),
  };
  const queue = ['a-0001', 'a-0002'];

  it.each([10, 3, 2, 1, 0])('dailyCap %i:兩邊的結果一模一樣', (cap) => {
    const dir = learningWith(reviews);
    const summary = summarizeDay({ learningDir: dir, today: TODAY, cache: cacheOf(queue), dailyCap: cap, answeredThisRun: 2, resumed: false });
    const direct = estimateTomorrowFrom({ reviews, today: TODAY, queueCards: queue, dailyCap: cap });
    expect(summary.tomorrow).toEqual(direct);
  });
});
