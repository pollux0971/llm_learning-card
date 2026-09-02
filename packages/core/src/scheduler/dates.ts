/**
 * 純日曆日期運算。用 date-fns 的 addDays / differenceInCalendarDays 而不是
 * ms 算術,因為 IsoDate 沒有時間資訊,DST 那天用 ms 相減會差一小時。
 */
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { IsoDate } from './types.js';

export function addIsoDays(date: IsoDate, days: number): IsoDate {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd');
}

/** to 減 from 的天數,可為負 */
export function isoDaysBetween(from: IsoDate, to: IsoDate): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}
