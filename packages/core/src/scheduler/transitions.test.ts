import { describe, expect, it } from 'vitest';
import { applyFailTransition, applyLearnedTransition, applyPassTransition } from './transitions.js';
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

  /**
   * phase-1 當時故意留白(標題原本是「phase-1 不碰 fails_in_row / stuck,原封不動
   * 傳遞」),phase-2 的範圍就是把這件事實作出來:答對要清空連錯數與 stuck,
   * 總錯數不變。這條測試已更新為 phase-2 的真實規格(協調者確認過不是規格衝突,
   * 只是這條骨架測試過時了)。目前是紅燈,因為 applyPassTransition 本體還沒改。
   */
  it('[phase-2,紅燈,尚未實作] 答對清空連錯數與 stuck,總錯數不變', () => {
    const review = reviewAtStage(3, { fails_in_row: 2, total_fails: 5, stuck: true });
    const outcome = applyPassTransition(review, { card: 'sec-0001', today: '2026-09-10', type: 'apply', grader: 'cloud' });
    expect(outcome.review.fails_in_row).toBe(0);
    expect(outcome.review.total_fails).toBe(5);
    expect(outcome.review.stuck).toBe(false);
  });
});

describe('applyFailTransition(phase-2,紅燈,尚未實作)', () => {
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

  it('答錯永遠回到 stage 1(第一個檢查點),不管原本在哪個 stage', () => {
    const outcome = applyFailTransition(reviewAtStage(4), {
      card: 'sec-0001',
      today: '2026-09-10',
      answers: [{ type: 'apply', pass: false, grader: 'cloud' }],
    });
    expect(outcome.review.stage).toBe(1);
    expect(outcome.review.next_due).toBe('2026-09-11');
  });

  it('連錯數與總錯數各 +1', () => {
    const outcome = applyFailTransition(reviewAtStage(3, { fails_in_row: 1, total_fails: 4 }), {
      card: 'sec-0001',
      today: '2026-09-10',
      answers: [{ type: 'apply', pass: false, grader: 'cloud' }],
    });
    expect(outcome.review.fails_in_row).toBe(2);
    expect(outcome.review.total_fails).toBe(5);
  });

  it.each([
    [0, 1, false, [] as string[]],
    [1, 2, false, ['reteach_queued']],
    [2, 3, true, ['stuck']],
    [3, 4, true, []],
  ] as [number, number, boolean, string[]][])(
    '連錯邊界:%i 次再錯一次變 %i 次,stuck=%s,events=%j',
    (before, after, stuckAfter, eventTypes) => {
      const outcome = applyFailTransition(reviewAtStage(3, { fails_in_row: before, stuck: before >= 3 }), {
        card: 'sec-0001',
        today: '2026-09-10',
        answers: [{ type: 'apply', pass: false, grader: 'cloud' }],
      });
      expect(outcome.review.fails_in_row).toBe(after);
      expect(outcome.review.stuck).toBe(stuckAfter);
      expect(outcome.events.map((e) => e.type)).toEqual(eventTypes);
    },
  );

  it('不修改輸入物件,回傳新物件', () => {
    const input = reviewAtStage(3);
    const snapshot = JSON.stringify(input);
    const outcome = applyFailTransition(input, {
      card: 'sec-0001',
      today: '2026-09-10',
      answers: [{ type: 'apply', pass: false, grader: 'cloud' }],
    });
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(outcome.review).not.toBe(input);
  });

  it('stage 2 同時考兩種題型時只回退一次,但兩筆答案都各自記進 history', () => {
    const outcome = applyFailTransition(reviewAtStage(2), {
      card: 'sec-0001',
      today: '2026-09-10',
      answers: [
        { type: 'fill', pass: true, grader: 'exact' },
        { type: 'apply', pass: false, grader: 'cloud' },
      ],
    });
    expect(outcome.review.fails_in_row).toBe(1);
    expect(outcome.review.history).toEqual([
      { date: '2026-09-10', stage: 2, type: 'fill', pass: true, grader: 'exact' },
      { date: '2026-09-10', stage: 2, type: 'apply', pass: false, grader: 'cloud' },
    ]);
  });

  it('history 如實記錄評分者:cloud 評分的 apply 失敗', () => {
    const outcome = applyFailTransition(reviewAtStage(3), {
      card: 'sec-0001',
      today: '2026-09-10',
      answers: [{ type: 'apply', pass: false, grader: 'cloud' }],
    });
    expect(outcome.review.history.at(-1)).toEqual({
      date: '2026-09-10',
      stage: 3,
      type: 'apply',
      pass: false,
      grader: 'cloud',
    });
  });

  it('history 如實記錄評分者:離線 local-provisional 評分的 apply 失敗', () => {
    const outcome = applyFailTransition(reviewAtStage(3), {
      card: 'sec-0001',
      today: '2026-09-10',
      answers: [{ type: 'apply', pass: false, grader: 'local-provisional' }],
    });
    expect(outcome.review.history.at(-1)).toEqual({
      date: '2026-09-10',
      stage: 3,
      type: 'apply',
      pass: false,
      grader: 'local-provisional',
    });
  });

  it('保留既有的歷史紀錄,新的附加在後面', () => {
    const input = reviewAtStage(3, {
      history: [{ date: '2026-09-01', stage: 3, type: 'apply', pass: true, grader: 'cloud' }],
    });
    const outcome = applyFailTransition(input, {
      card: 'sec-0001',
      today: '2026-09-10',
      answers: [{ type: 'apply', pass: false, grader: 'cloud' }],
    });
    expect(outcome.review.history).toHaveLength(2);
    expect(outcome.review.history[0]).toEqual({ date: '2026-09-01', stage: 3, type: 'apply', pass: true, grader: 'cloud' });
  });
});
