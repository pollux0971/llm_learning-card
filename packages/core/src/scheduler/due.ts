/**
 * 今日到期清單。phase-1 只回傳所有到期卡片,不做每日上限與逾期比例排序
 * (那是 phase-3,契約 §6 SelectResult 的 due/deferred/reteach 欄位)。
 */
import { isoDaysBetween } from './dates.js';
import { intervalDaysForStage, questionTypesForStage } from './intervals.js';
import type { CardId, DueItem, IsoDate, Review } from './types.js';

/** stage 0(剛學,還沒考過)與 stage 6(已歸檔)一律排除,不在複習週期內。 */
export function buildDueList(reviews: Record<CardId, Review>, today: IsoDate): DueItem[] {
  const items: DueItem[] = [];

  for (const [card, review] of Object.entries(reviews)) {
    if (review.stage < 1 || review.stage > 5) continue;
    if (review.next_due === null || review.next_due > today) continue;

    const overdueDays = isoDaysBetween(review.next_due, today);
    items.push({
      card,
      stage: review.stage,
      types: questionTypesForStage(review.stage),
      overdue_days: overdueDays,
      overdue_ratio: overdueDays / intervalDaysForStage(review.stage),
      stuck: review.stuck,
    });
  }

  return items.sort((a, b) => a.card.localeCompare(b.card));
}
