/**
 * StubScheduler(FEATURE.md「Wave 0 的重複」表)。
 *
 * `advance` 對齊契約 §6 的簽章:`(review, ctx) => SchedulerOutcome`,純函式、
 * 不修改輸入。整合時(I3)這個檔案整個刪掉,session.ts 改吃 packages/core/src/scheduler
 * 匯出的同名函式——"The stubs are drop in replaceable" 這個場景驗的就是這件事。
 *
 * 間隔表與題型對應照契約 §4,逾期比例排序照 ADR-015。
 */
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type {
  CardId,
  DueItem,
  QuestionType,
  Review,
  SchedulerAdvanceFn,
  SchedulerEvent,
  SelectResult,
  Stage,
} from '../types.js';

const INTERVAL_DAYS: Partial<Record<Stage, number>> = { 1: 1, 2: 7, 3: 30, 4: 90, 5: 180 };

const TYPES_BY_STAGE: Partial<Record<Stage, QuestionType[]>> = {
  1: ['fill'],
  2: ['fill', 'apply'],
  3: ['apply'],
  4: ['apply'],
  5: ['apply'],
};

export interface ReviewsMap {
  [card: string]: Pick<Review, 'stage' | 'next_due' | 'stuck'>;
}

/** 純函式:今天該考哪些卡。stage 0(新學未考)與 stage 6(已歸檔)一律不選。 */
export function selectDue(reviews: ReviewsMap, today: string, dailyCap: number): SelectResult {
  const candidates: DueItem[] = [];
  for (const [card, review] of Object.entries(reviews)) {
    if (review.stage === 0 || review.stage === 6) continue;
    if (!review.next_due) continue;
    const overdue_days = differenceInCalendarDays(parseISO(today), parseISO(review.next_due));
    if (overdue_days < 0) continue;
    const interval = INTERVAL_DAYS[review.stage] ?? 1;
    candidates.push({
      card,
      stage: review.stage,
      types: TYPES_BY_STAGE[review.stage] ?? ['apply'],
      overdue_days,
      overdue_ratio: overdue_days / interval,
      stuck: review.stuck,
    });
  }
  candidates.sort((a, b) => b.overdue_ratio - a.overdue_ratio);
  const due = candidates.slice(0, dailyCap);
  return { due, deferred: Math.max(0, candidates.length - dailyCap), reteach: [] };
}

function nextStage(stage: Stage, pass: boolean): Stage {
  if (!pass) return 1;
  return (Math.min(6, stage + 1) as Stage);
}

/** 契約 §6 的 advance:(review, ctx) => SchedulerOutcome。不修改輸入,回傳新物件。 */
export const advance: SchedulerAdvanceFn = (review, ctx) => {
  const events: SchedulerEvent[] = [];
  const fails_in_row = ctx.pass ? 0 : review.fails_in_row + 1;
  const total_fails = ctx.pass ? review.total_fails : review.total_fails + 1;
  const stage = nextStage(review.stage, ctx.pass);
  const stuck = !ctx.pass && fails_in_row >= 3 ? true : review.stuck;

  const card: CardId = '';
  if (stuck && !review.stuck) events.push({ type: 'stuck', card });
  if (stage === 6 && review.stage !== 6) events.push({ type: 'archived', card });

  const interval = INTERVAL_DAYS[stage];
  const next_due = stage === 6 ? null : format(addDays(parseISO(ctx.today), interval ?? 1), 'yyyy-MM-dd');

  const newReview: Review = {
    ...review,
    stage,
    fails_in_row,
    total_fails,
    stuck,
    next_due,
  };
  return { review: newReview, events };
};
