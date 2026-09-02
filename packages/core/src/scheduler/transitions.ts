/**
 * phase-1 只覆蓋「答對」這條路徑(見 phase-1.feature 開頭說明)。
 * 答錯回退、連錯計數、stuck 判定是 phase-2 的範圍,這裡完全不碰
 * fails_in_row / stuck,原封不動地從輸入傳遞到輸出。
 */
import { addIsoDays } from './dates.js';
import { intervalDaysForStage } from './intervals.js';
import type { CardId, Grader, IsoDate, QuestionType, Review, SchedulerOutcome, Stage } from './types.js';

export interface LearnedCtx {
  card: CardId;
  learnedAt: IsoDate;
}

/** 一張卡第一次學會時建立的初始複習狀態:stage 1,等待 D1。 */
export function applyLearnedTransition(ctx: LearnedCtx): Review {
  return {
    stage: 1,
    learned_at: ctx.learnedAt,
    next_due: addIsoDays(ctx.learnedAt, intervalDaysForStage(1)),
    fails_in_row: 0,
    total_fails: 0,
    stuck: false,
    history: [],
  };
}

export interface PassCtx {
  card: CardId;
  today: IsoDate;
  type: QuestionType;
  grader: Grader;
}

/**
 * 答對:歷史記錄的 stage 是「被考的那個 stage」(推進前),不是推進後的。
 * stage 5 通過後歸檔(stage 6,next_due 為 null,emit 'archived')。
 */
export function applyPassTransition(review: Review, ctx: PassCtx): SchedulerOutcome {
  const newStage = (review.stage + 1) as Stage;
  const archived = newStage === 6;

  const newReview: Review = {
    ...review,
    stage: newStage,
    next_due: archived ? null : addIsoDays(ctx.today, intervalDaysForStage(newStage)),
    history: [
      ...review.history,
      { date: ctx.today, stage: review.stage, type: ctx.type, pass: true, grader: ctx.grader },
    ],
  };

  return {
    review: newReview,
    events: archived ? [{ type: 'archived', card: ctx.card }] : [],
  };
}
