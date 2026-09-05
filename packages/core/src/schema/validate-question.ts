import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  countBlanks,
  ApplyQuestionSchema,
  FillQuestionSchema,
  QuestionFileSchema,
  type ApplyQuestion,
  type CardId,
  type FillQuestion,
  type QuestionFile,
} from '@contracts/index.js';
import { formatIssuePath } from './validate-card.js';

/** 輕量版驗證結果:這幾個格式不像卡片有字數/圍欄要回報,只需要 ok/errors。 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * 驗證單一填空題。契約 §3 的跨欄位規則(blanks 數要對上 answers 數)已經
 * 寫進 FillQuestionSchema 自己的 superRefine,這裡只是薄薄一層 zod 轉接。
 */
export function validateFillQuestion(raw: unknown): ValidationResult {
  const parsed = FillQuestionSchema.safeParse(raw);
  if (parsed.success) return { ok: true, errors: [] };
  const errors = parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
  return { ok: false, errors };
}

/** 驗證單一應用題(rubric 2..4 條)。 */
export function validateApplyQuestion(raw: unknown): ValidationResult {
  const parsed = ApplyQuestionSchema.safeParse(raw);
  if (parsed.success) return { ok: true, errors: [] };
  const errors = parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
  return { ok: false, errors };
}

/**
 * 驗證一份完整的考題檔:card id、fill 題數(2..3)、apply 題數(1..2),
 * 加上巢狀的 FillQuestionSchema / ApplyQuestionSchema 逐題規則——
 * QuestionFileSchema 的 fill/apply 陣列元素本來就是那兩個 schema,
 * 所以 zod 一次 parse 就把所有層級都顧到了,不需要另外寫迴圈重跑一次。
 */
export function validateQuestionFile(raw: unknown): ValidationResult {
  const parsed = QuestionFileSchema.safeParse(raw);
  if (parsed.success) return { ok: true, errors: [] };
  const errors = parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
  return { ok: false, errors };
}

// 兩個錨點都要:^ 排除「檔名前面還有別的字」(例如 xxsec-0001.md),$ 排除
// 「.md 後面還有別的字」(例如 sec-0001.md.bak)。這條規則本身也順便排除了
// sec-0001.short.md(short 卡不用有自己的考題),不用另外判斷副檔名。
const CARD_FILE_RE = /^([a-z]{2,6}-\d{4})\.md$/;

/**
 * 掃 `cards/<分類>/` 底下所有卡片檔,回傳卡片 id。**分母**——呼叫端要說得出
 * 「檢查了 N 張卡」,而不是只知道「缺的有幾張」。`cards/` 不存在時回空陣列;
 * 「沒有 cards/」跟「cards/ 底下 0 張卡」的差別由呼叫端自己分
 * (見 cli.ts 的 runCheckQuestions)。
 */
export function listCardIds(learningDir: string): CardId[] {
  const cardsDir = join(learningDir, 'cards');
  if (!existsSync(cardsDir)) return [];

  const ids: CardId[] = [];
  for (const category of readdirSync(cardsDir)) {
    const categoryDir = join(cardsDir, category);
    if (!statSync(categoryDir).isDirectory()) continue;
    for (const file of readdirSync(categoryDir)) {
      const match = CARD_FILE_RE.exec(file);
      if (match) ids.push(match[1] as CardId);
    }
  }

  return ids;
}

/**
 * 掃 learning 目錄下的 cards/ 與 questions/,回報每一張卡有沒有對應的
 * questions/<id>.yaml。純粹的一致性檢查(哪些卡缺考題),不產生內容
 * (產生內容是 02-ingest-pipeline 的事)。
 *
 * 只回**缺的**那些,所以「回了空陣列」有兩種意思:每張卡都有考題、或者
 * 根本沒有卡可以檢查。要分得出來的呼叫端請自己配 `listCardIds()` 當分母。
 */
export function findCardsMissingQuestions(learningDir: string): CardId[] {
  const questionsDir = join(learningDir, 'questions');
  return listCardIds(learningDir).filter((id) => !existsSync(join(questionsDir, `${id}.yaml`)));
}

export { countBlanks };
export type { FillQuestion, ApplyQuestion, QuestionFile };
