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

// CategoryId(契約 1.4.0 §1,ADR-067):必須是 §13 的一個合法段,且 UTF-8 位元組 ≤ 64。
// Rust 那一側是權威,這裡是同一規則的 TypeScript 實作;兩邊都對著同一個向量檔
// contracts/fixtures/path-segment-vectors.json 測,不各自抄表。
// 實作住在 contracts 而不是 core:CategoryIdSchema 本身要擋(這份 schema 不可以比契約寬),
// 而 packages/contracts 不准 import core。core 的 schema/category-id.ts 從這裡 re-export,
// 02-ingest 與 09-lint 引用那一份。

/** 拒絕時的規則名,與向量檔的 `rule` 欄同名。 */
export type CategoryIdRule =
  | 'empty'
  | 'separator'
  | 'charset'
  | 'nfc'
  | 'leading-dot'
  | 'trailing-dot'
  | 'reserved'
  | 'length';

export type CategoryIdVerdict = { ok: true } | { ok: false; rule: CategoryIdRule };

/** §1:CategoryId 的 UTF-8 位元組上限。§13 的路徑段沒有這條(只有整條 relPath ≤ 240)。 */
export const CATEGORY_ID_MAX_BYTES = 64;

/**
 * §13 字元集合**之外**的任一字元。集合是 ASCII 的 `A`–`Z` `a`–`z` `0`–`9` `_` `-` `.`,
 * 或 Unicode 一般類別 L、N、M;ASCII 字母與數字本來就在 L、N 裡,所以只另列 `_` `.` `-`。
 */
const OUTSIDE_SEGMENT_CHARSET = /[^\p{L}\p{N}\p{M}_.\-]/u;

/** §13 第 6 條的 Windows 保留裝置名,已摺成小寫。不含 COM0、LPT0;`¹²³` 是 U+00B9 U+00B2 U+00B3。 */
const RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...[...'123456789¹²³'].flatMap((d) => ['com' + d, 'lpt' + d]),
]);

/** 固定 ASCII 摺疊:只把 `A`–`Z` 變成 `a`–`z`,不用 Unicode 或依語系的大小寫對照(§13)。 */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/**
 * §1 的 CategoryId 檢查。收到什麼就檢查什麼:不修剪、不正規化(§13「不轉換」)。
 *
 * 一個輸入只回報一條 rule:照下面的固定順序,回報第一條違反的。這個順序讓向量檔每一列的
 * rule 對得上,例如 `.` 同時以點開頭也以點結尾,回報 leading-dot;`a/b` 的 `/` 也不在字元集合,
 * 回報 separator;`가` 的 NFD 形式每個字元都在字元集合裡,回報 nfc。
 */
export function validateCategoryId(value: string): CategoryIdVerdict {
  const refuse = (rule: CategoryIdRule): CategoryIdVerdict => ({ ok: false, rule });
  if (value.length === 0) return refuse('empty');
  if (value.includes('/')) return refuse('separator');
  if (OUTSIDE_SEGMENT_CHARSET.test(value)) return refuse('charset');
  if (value.normalize('NFC') !== value) return refuse('nfc');
  if (value.startsWith('.')) return refuse('leading-dot');
  if (value.endsWith('.')) return refuse('trailing-dot');
  // 比的是第一個 `.` 之前的部分:`nul.md` 也算裝置名,`console` 不算。
  if (RESERVED_DEVICE_NAMES.has(asciiLower(value.split('.')[0]!))) return refuse('reserved');
  if (new TextEncoder().encode(value).length > CATEGORY_ID_MAX_BYTES) return refuse('length');
  return { ok: true };
}

/** 拒絕訊息:原樣帶出被拒絕的值與 rule 名。schema、ingest、lint 用同一句。 */
export function formatCategoryIdRefusal(value: string, rule: CategoryIdRule): string {
  return `分類 "${value}" 不合法(rule: ${rule},見契約 §1 與 §13)`;
}

export const CategoryIdSchema = z.string().superRefine((value, ctx) => {
  const verdict = validateCategoryId(value);
  if (!verdict.ok) ctx.addIssue(formatCategoryIdRefusal(value, verdict.rule));
});
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

// ---------------------------------------------------------------- §3 考題

export const QuestionTypeSchema = z.enum(['fill', 'apply']);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

/** 一組答案:至少要有一個非空字串(允許同義詞陣列裡混雜空字串,但不能全空)。 */
export const AnswerGroupSchema = z
  .array(z.string())
  .min(1, '答案組不能空')
  .refine((group) => group.some((s) => s.trim().length > 0), '答案組至少需要一個非空字串');

/** prompt 裡 `___` 標記空格的數量(契約 §3)。 */
export function countBlanks(prompt: string): number {
  return (prompt.match(/___/g) ?? []).length;
}

export const FillQuestionSchema = z
  .object({
    prompt: z.string().min(1, 'prompt 不可為空'),
    answers: z.array(AnswerGroupSchema),
  })
  .superRefine((fill, ctx) => {
    const blanks = countBlanks(fill.prompt);
    if (blanks === 0) {
      ctx.addIssue({ code: 'custom', path: ['prompt'], message: 'prompt 至少要有一個 ___ 標記的空格' });
    } else if (blanks !== fill.answers.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['answers'],
        message: `prompt has ${blanks} blank(s) but answers has ${fill.answers.length} group(s)`,
      });
    }
  });
export type FillQuestion = z.infer<typeof FillQuestionSchema>;

export const ApplyQuestionSchema = z.object({
  prompt: z.string().min(1, 'prompt 不可為空'),
  rubric: z
    .array(z.string().min(1, 'rubric 條目不可為空'))
    .min(2, 'rubric 至少需要 2 條')
    .max(4, 'rubric 最多 4 條'),
});
export type ApplyQuestion = z.infer<typeof ApplyQuestionSchema>;

export const QuestionFileSchema = z.object({
  card: CardIdSchema,
  fill: z.array(FillQuestionSchema).min(2, '至少需要 2 題填空').max(3, '最多 3 題填空'),
  apply: z.array(ApplyQuestionSchema).min(1, '至少需要 1 題應用').max(2, '最多 2 題應用'),
});
export type QuestionFile = z.infer<typeof QuestionFileSchema>;

// ---------------------------------------------------------------- §4 複習狀態

export const GraderSchema = z.enum([
  'exact',
  'fuzzy',
  'local-llm',
  'fallback-strict',
  'empty',
  'cloud',
  'local-provisional',
  'error',
]);
export type Grader = z.infer<typeof GraderSchema>;

export const ReviewEntrySchema = z.object({
  date: IsoDateSchema,
  stage: StageSchema,
  type: QuestionTypeSchema,
  pass: z.boolean(),
  grader: GraderSchema,
  provisional: z.boolean().optional(),
  revised_by: z.literal('cloud').optional(),
  revised_to: z.boolean().optional(),
});
export type ReviewEntry = z.infer<typeof ReviewEntrySchema>;

export const ReviewSchema = z
  .object({
    stage: StageSchema,
    learned_at: IsoDateSchema,
    next_due: IsoDateSchema.nullable(),
    fails_in_row: z.number().int().min(0),
    total_fails: z.number().int().min(0),
    stuck: z.boolean(),
    history: z.array(ReviewEntrySchema),
  })
  .superRefine((review, ctx) => {
    if (review.stage === 6 && review.next_due !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['next_due'],
        message: 'stage 6(歸檔)的 next_due 必須是 null',
      });
    }
  });
export type Review = z.infer<typeof ReviewSchema>;

// ---------------------------------------------------------------- §10 事件記錄

export const EVENT_TYPES = [
  'learned',
  'reviewed',
  'ingested',
  'linted',
  'llm_call',
  'deepened',
  'reteach_queued',
  'reteach_viewed',
  'week_rolled',
  'regenerate',
  'cycle_removed',
  'provisional_resolved',
  'warning',
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const LogEventSchema = z
  .object({
    ts: z.string().min(1, 'ts 不可為空'),
    type: EventTypeSchema,
    card: CardIdSchema.optional(),
  })
  .catchall(z.unknown());
export type LogEvent = z.infer<typeof LogEventSchema>;

// ---------------------------------------------------------------- §11 設定

export const CategorySchema = z.object({
  id: CategoryIdSchema,
  name: z.string().min(1, 'name 不可為空'),
  require_raw: z.boolean(),
});
export type Category = z.infer<typeof CategorySchema>;

export const SettingsSchema = z.object({
  daily_cap: z.number().int('daily_cap 必須是整數').positive('daily_cap 必須大於 0'),
  weekly_target: z.number().int('weekly_target 必須是整數').positive('weekly_target 必須大於 0'),
  short_body_limit: z.number().int('short_body_limit 必須是整數').positive('short_body_limit 必須大於 0'),
  llm: z.object({
    cloud_provider: z.enum(['anthropic', 'openai']),
    cloud_model: z.string().min(1, 'cloud_model 不可為空'),
    local_model: z.string().min(1, 'local_model 不可為空'),
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;
