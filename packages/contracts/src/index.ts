/**
 * @learning/contracts — contracts/types.md 的可執行版本。
 *
 * 這裡只放 01-data-layer/phase-1 範圍內的型別:§1 基本型別、§2 教學卡。
 * 考題(§3)、狀態檔(§4 §9 §10)、設定檔(§11)由 phase-2 補上;
 * 依賴圖(§8)由 phase-3 補上。其他功能整合後(I1 起)從這裡 import 型別;
 * Wave 0 期間各功能只能 import 這個套件與自己的目錄(npm run boundaries 會檢查)。
 */
import { z } from 'zod';

// ---------------------------------------------------------------- §1 識別碼與基本型別

export const CardIdSchema = z
  .string()
  .regex(/^[a-z]{2,6}-\d{4}$/, 'CardId 必須符合 /^[a-z]{2,6}-\\d{4}$/(例如 "sec-0042")');
export type CardId = z.infer<typeof CardIdSchema>;

export const CategoryIdSchema = z
  .string()
  .min(1, 'CategoryId 不可為空')
  .regex(/^[^\s/\\]+$/, 'CategoryId 不可包含空白或路徑分隔符');
export type CategoryId = z.infer<typeof CategoryIdSchema>;

/** 判斷 "YYYY-MM-DD" 是不是真實存在的日期(月 01–12、日在該月範圍內、閏年正確)。 */
function isRealCalendarDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'IsoDate 必須是 "YYYY-MM-DD"', abort: true })
  .refine(isRealCalendarDate, 'IsoDate 必須是真實存在的日期(月 01–12,日不可超過該月天數)');
export type IsoDate = z.infer<typeof IsoDateSchema>;

export const IsoWeekSchema = z
  .string()
  .regex(/^\d{4}-W\d{2}$/, 'IsoWeek 必須是 "YYYY-Wnn"');
export type IsoWeek = z.infer<typeof IsoWeekSchema>;

export const StageSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
export type Stage = z.infer<typeof StageSchema>;

/** §1:Level = 0..4。0 是根卡,1–4 是逐層拆解的子卡。 */
export const LevelSchema = z.number().int().min(0, 'level 最小為 0').max(4, 'level 最大為 4');
export type Level = z.infer<typeof LevelSchema>;

export const SourceSchema = z.enum(['raw', 'llm']);
export type Source = z.infer<typeof SourceSchema>;

// ---------------------------------------------------------------- §2 教學卡

/** 教學卡 body 的字數上限(硬約定)。縮短版上限見各功能自己的 settings.short_body_limit。 */
export const CARD_BODY_WORD_LIMIT = 100;

/** §2 source_ref 格式:raw/<cat>/<file>#L<a>-L<b>。 */
export const SOURCE_REF_RE = /^raw\/[^/\s]+\/[^\s#]+#L\d+-L\d+$/;

export const SourceRefSchema = z
  .string()
  .regex(SOURCE_REF_RE, 'source_ref 必須符合 raw/<cat>/<file>#L<a>-L<b>(例如 "raw/security/csp.md#L1-L20")');
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const CardFrontmatterSchema = z.object({
  id: CardIdSchema,
  category: CategoryIdSchema,
  title: z.string().min(1, 'title 不可為空'),
  level: LevelSchema,
  source: SourceSchema,
  created: IsoDateSchema,
  parent: CardIdSchema.optional(),
  prereqs: z.array(CardIdSchema).optional().default([]),
  source_ref: SourceRefSchema.optional(),
  provisional: z.boolean().optional().default(false),
  stale: z.boolean().optional().default(false),
  source_missing: z.boolean().optional().default(false),
});
export type CardFrontmatter = z.infer<typeof CardFrontmatterSchema>;

export const CardSchema = z.object({
  frontmatter: CardFrontmatterSchema,
  body: z.string(),
  examples: z.array(z.string()),
});
export type Card = z.infer<typeof CardSchema>;
