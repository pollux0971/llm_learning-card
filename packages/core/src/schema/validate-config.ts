import { CategorySchema, SettingsSchema } from '@contracts/index.js';
import { formatIssuePath } from './validate-card.js';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** 驗證 config/categories.yaml 的單一項目(§11)。 */
export function validateCategory(raw: unknown): ValidationResult {
  const parsed = CategorySchema.safeParse(raw);
  if (parsed.success) return { ok: true, errors: [] };
  const errors = parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
  return { ok: false, errors };
}

/** 驗證 config/settings.yaml(§11)。daily_cap / weekly_target 下限與整數規則見 SettingsSchema。 */
export function validateSettings(raw: unknown): ValidationResult {
  const parsed = SettingsSchema.safeParse(raw);
  if (parsed.success) return { ok: true, errors: [] };
  const errors = parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
  return { ok: false, errors };
}
