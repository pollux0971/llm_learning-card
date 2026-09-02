/** 讀 packages/core/prompts/ingest/*.md 的模板(ADR-032:改了要跑 golden run)。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROMPTS_DIR = join(import.meta.dirname, '../../prompts/ingest');

export function loadPromptTemplate(name: string): string {
  return readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf8');
}
