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

// ------------------------------------------------------------------------
// phase-2:答錯回退、連錯計數、stuck 判定、reteach 事件。
// 下面只放型別與函式簽章,函式本體先 throw——這個 phase 只寫測試骨架,
// 邏輯留給下一輪開發 agent(見 features/04-scheduler/phase-2.feature)。
// ------------------------------------------------------------------------

/**
 * 一次checkpoint 裡被考的其中一題結果。stage 2 同時考 fill 跟 apply,
 * 兩題都要各記一條 history,但只要其中一題沒過,整張卡就算這次沒過、
 * 只回退一次、連錯只計一次——由呼叫端把兩題的結果都放進 answers 裡,
 * 一次呼叫 applyFailTransition,而不是每題呼叫一次。
 */
export interface FailAnswer {
  type: QuestionType;
  pass: boolean;
  grader: Grader;
}

export interface FailCtx {
  card: CardId;
  today: IsoDate;
  /** 這次 checkpoint 的所有題目結果;長度 1(stage 1/3/4/5)或 2(stage 2)。 */
  answers: FailAnswer[];
}

/**
 * 答錯:回退到 stage 1(第一個檢查點),fails_in_row / total_fails 各 +1,
 * answers 裡每一題各自附加一條 history entry(用被考的那個 stage,推進前)。
 *
 * 連錯數的門檻(對照 phase-2.feature 與嚴格變異測試要求的邊界):
 *   1 次:不 emit 事件。
 *   2 次:emit 'reteach_queued'。
 *   3 次以上:stuck=true;剛跨過 3 那次額外 emit 'stuck',之後(4 次、5 次...)
 *            fails_in_row 繼續累加、stuck 維持 true,但不重複 emit 'stuck'。
 *
 * 通過(applyPassTransition)清空 fails_in_row 與 stuck 是 phase-2 的一部分,
 * 但那個函式屬於既有邏輯(phase-1 已經在跑),這裡不動它的函式本體——
 * 由下一輪實作者更新,同時要處理 transitions.test.ts 裡「phase-1 不碰
 * fails_in_row / stuck」那個舊測試(見那個測試旁的註解)。
 */
export function applyFailTransition(_review: Review, _ctx: FailCtx): SchedulerOutcome {
  throw new Error('applyFailTransition: phase-2 尚未實作,這是測試骨架');
}
