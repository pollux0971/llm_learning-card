import { CARD_BODY_WORD_LIMIT, CardFrontmatterSchema, type Card } from '@contracts/index.js';
import { parseCardText } from './parse-card.js';
import { countWords } from './word-count.js';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  bodyWordCount: number;
  examplesCount: number;
  /** 驗證通過時附上組好的 Card,失敗時 undefined */
  card?: Card;
}

/** 驗證一張卡的原始文字。frontmatter 用 zod,額外的跨欄位規則(§2)在這裡補。 */
export function validateCard(raw: string): ValidationResult {
  const parsed = parseCardText(raw);
  const bodyWordCount = countWords(parsed.body);
  const errors: string[] = [];

  const fm = CardFrontmatterSchema.safeParse(parsed.frontmatter);
  if (!fm.success) {
    for (const issue of fm.error.issues) {
      const field = issue.path.length ? issue.path.join('.') : '(root)';
      errors.push(`${field}: ${issue.message}`);
    }
  } else {
    if (fm.data.level >= 1 && !fm.data.parent) {
      errors.push(`parent: level ${fm.data.level} requires a parent`);
    }
    if (fm.data.source === 'raw' && !fm.data.source_ref) {
      errors.push('source_ref: a raw sourced card requires source_ref');
    }
  }

  if (bodyWordCount > CARD_BODY_WORD_LIMIT) {
    errors.push(`body word count ${bodyWordCount} exceeds limit of ${CARD_BODY_WORD_LIMIT}`);
  }

  const ok = errors.length === 0;
  const result: ValidationResult = { ok, errors, bodyWordCount, examplesCount: parsed.examples.length };
  if (ok && fm.success) {
    result.card = { frontmatter: fm.data, body: parsed.body, examples: parsed.examples };
  }
  return result;
}
