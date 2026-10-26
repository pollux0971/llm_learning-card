/**
 * 09-lint 的最小驗證器(Wave 0 stub,見 FEATURE.md「Wave 0 的重複」)。
 *
 * 字數與 example 圍欄用 01(T52、ADR-060):countBodyWords 從 @core/schema 轉 export,
 * parseCard 的 body 與 examples 用 stripExampleFences。這裡不留圍欄 regex、CJK 或字母數字判斷。
 * frontmatter 的最小驗證還是 Wave 0 的「另一雙眼睛」(gray-matter 原樣,不做日期轉換),I6 再換。
 */
import matter from 'gray-matter';
import { stripExampleFences } from '@core/schema/example-fence.js';

export { countBodyWords } from '@core/schema/word-count.js';

export type CardId = string;
export type CategoryId = string;
export type Level = number;
export type Source = 'raw' | 'llm';

export interface CardFrontmatterMin {
  id: CardId;
  category: CategoryId;
  title: string;
  level: Level;
  source: Source;
  created: string;
  parent?: string;
  prereqs?: CardId[];
  source_ref?: string;
  provisional?: boolean;
  stale?: boolean;
  source_missing?: boolean;
}

export interface ParsedCard {
  frontmatter: CardFrontmatterMin;
  /** markdown,不含 example 圍欄 */
  body: string;
  examples: string[];
}

export function parseCard(raw: string): ParsedCard {
  const { data, content } = matter(raw);
  const { body, examples } = stripExampleFences(content);
  return { frontmatter: data as CardFrontmatterMin, body, examples };
}
