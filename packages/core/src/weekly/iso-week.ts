import { getISOWeek, getISOWeekYear, parseISO } from 'date-fns';
import type { IsoDate, IsoWeek } from './types.js';

/**
 * 把當地日期轉成 ISO 8601 週別,如 "2026-W37"。
 * 年末交界依 ISO 規則歸屬(2026-12-31 與 2027-01-01 同屬 2026-W53)。
 */
export function isoWeekOf(date: IsoDate): IsoWeek {
  const d = parseISO(date);
  const week = getISOWeek(d);
  const year = getISOWeekYear(d);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
