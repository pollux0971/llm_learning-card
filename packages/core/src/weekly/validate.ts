/**
 * 契約 §9 的 Weekly,可執行版本。
 *
 * 為什麼在這裡而不是 packages/contracts:`types.ts` 的檔頭已經記過同一個理由——
 * §9 的型別是在這個資料夾自己宣告的(Wave 0 時 packages/contracts 還是空殼),
 * schema 跟著型別放在一起,兩份才不會漂開。整合時要搬去 contracts 一起搬。
 *
 * 用途只有一個:**讀 `state/weekly.json` 的入口驗過再用**(P-50)。
 * `JSON.parse(...) as Weekly` 是用 cast 假裝驗過了,而 §9 的欄位全部缺席時
 * `applyEvent()` 照樣算得出一份看起來正常的 Weekly ——
 * 使用者看到的是「本週 1/undefined」,像「這週還沒開始」而不是「你的資料壞了」。
 */
import { z } from 'zod';
import type { Weekly } from './types.js';

/** §9 的 IsoWeek:`YYYY-Wnn`。跟 packages/contracts 的 IsoWeekSchema 同一條規則。 */
const IsoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/, 'week 必須是 "YYYY-Wnn"');

/**
 * §9 的 Weekly。`target` 是正整數(0 個目標沒有意義,而且會讓 isTargetMet 一開始
 * 就成立);`learned` / `passed_d1` 是非負整數;`counted` 是卡片 id 的陣列。
 *
 * 沒有用 `.strict()`:多出來的欄位不擋。舊版寫的檔多帶欄位是相容問題,不是壞資料,
 * 而這支 schema 是拿來擋「這根本不是 Weekly」的,不是拿來當格式警察。
 */
export const WeeklySchema = z.object({
  week: IsoWeekSchema,
  target: z.number().int().positive('target 必須是正整數'),
  learned: z.number().int().min(0, 'learned 不能是負數'),
  passed_d1: z.number().int().min(0, 'passed_d1 不能是負數'),
  counted: z.array(z.string()),
});

/** 驗過的結果。`ok: false` 時 `issue` 是第一個對不上的地方,給人看的一句話。 */
export type WeeklyParseResult = { ok: true; weekly: Weekly } | { ok: false; issue: string };

/**
 * 不丟例外——「不是 Weekly」是一種回傳值。丟例外的話呼叫端很容易寫成
 * catch 之後拿一份預設值繼續跑,那正是這支要擋的事。
 */
export function parseWeekly(raw: unknown): WeeklyParseResult {
  const parsed = WeeklySchema.safeParse(raw);
  if (parsed.success) return { ok: true, weekly: parsed.data };

  const first = parsed.error.issues[0];
  // path 用 `.` 接、不加引號:訊息會被印在終端機上,而呼叫端(scripts/weekly.ts)
  // 的測試盯著「不可以吐出一份看起來能用的 Weekly」,帶引號的欄位名會像 JSON。
  const where = first ? first.path.join('.') || '(根)' : '(根)';
  return { ok: false, issue: first ? `${where}: ${first.message}` : '(說不出是哪裡)' };
}
