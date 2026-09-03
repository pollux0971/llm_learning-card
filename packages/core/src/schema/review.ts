import { ReviewSchema, type IsoDate, type Review } from '@contracts/index.js';
import { formatIssuePath } from './validate-card.js';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** zod 顧欄位型別與 stage/next_due 的關聯(§4);這裡沒有額外的跨欄位規則要補。 */
export function validateReview(raw: unknown): ValidationResult {
  const parsed = ReviewSchema.safeParse(raw);
  if (parsed.success) return { ok: true, errors: [] };
  const errors = parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
  return { ok: false, errors };
}

/** "YYYY-MM-DD" 加一天,回傳一樣格式的字串。純日曆運算,不管時區。 */
export function nextCalendarDay(date: IsoDate): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const yyyy = String(next.getUTCFullYear()).padStart(4, '0');
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 卡片首次被標記已學會時的初始狀態(契約 §4)。這是產生「一個」初始物件,
 * 不是排程演算法——之後 stage 怎麼往前走、next_due 怎麼算,是 04-scheduler 的事。
 */
export function createInitialReview(learnedAt: IsoDate): Review {
  return {
    stage: 1,
    learned_at: learnedAt,
    next_due: nextCalendarDay(learnedAt),
    fails_in_row: 0,
    total_fails: 0,
    stuck: false,
    history: [],
  };
}
