/** 初始化 / 更新一個 learning 目錄的骨架,見 contracts/types.md §12。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { formatCategoryIdRefusal, validateCategoryId } from '@core/schema/category-id.js';

const SKELETON_DIRS = ['raw', 'cards', 'questions', 'assets', 'state', 'graph', 'config'];

export interface CategoryConfig {
  id: string;
  name: string;
  require_raw: boolean;
}

/** 建立缺少的目錄與預設設定檔,已存在的不動。可重複呼叫。 */
export function ensureInitialized(dir: string): void {
  for (const d of SKELETON_DIRS) mkdirSync(join(dir, d), { recursive: true });

  const categoriesPath = join(dir, 'config/categories.yaml');
  if (!existsSync(categoriesPath)) writeFileSync(categoriesPath, stringify([]), 'utf8');

  const settingsPath = join(dir, 'config/settings.yaml');
  if (!existsSync(settingsPath)) {
    writeFileSync(
      settingsPath,
      stringify({
        daily_cap: 10,
        weekly_target: 7,
        short_body_limit: 50,
        llm: { cloud_provider: 'anthropic', cloud_model: 'claude-sonnet-4-6', local_model: 'qwen2.5:14b' },
      }),
      'utf8',
    );
  }

  const logPath = join(dir, 'state/log.jsonl');
  if (!existsSync(logPath)) writeFileSync(logPath, '', 'utf8');
}

/**
 * 新增或覆蓋一個類別設定(依 id 覆蓋)。id 不合法(契約 1.4.0 §1)就丟錯,
 * 不寫 categories.yaml——ingest 建分類的入口之一,不讓邊界讀不了的分類寫進設定檔。
 */
export function setCategory(dir: string, category: CategoryConfig): void {
  const verdict = validateCategoryId(category.id);
  if (!verdict.ok) throw new Error(formatCategoryIdRefusal(category.id, verdict.rule));
  const categoriesPath = join(dir, 'config/categories.yaml');
  const list = existsSync(categoriesPath)
    ? ((parse(readFileSync(categoriesPath, 'utf8')) as CategoryConfig[] | null) ?? [])
    : [];
  const next = [...list.filter((c) => c.id !== category.id), category];
  writeFileSync(categoriesPath, stringify(next), 'utf8');
}
