import matter from 'gray-matter';

/**
 * contracts/types.md §2 CardFrontmatter 的 Wave 0 鏡像。§2 是硬約定,但 packages/contracts
 * 目前是空的(01-data-layer 尚未填),所以先照契約文字自己宣告一份,型別一致但不 import。
 */
export interface CardFrontmatter {
  id: string;
  category: string;
  title: string;
  level: number;
  source: 'raw' | 'llm';
  created: string;
  parent?: string;
  prereqs?: string[];
  source_ref?: string;
  provisional?: boolean;
  stale?: boolean;
  source_missing?: boolean;
}

export interface ParsedCard {
  frontmatter: CardFrontmatter;
  /** 去除 frontmatter 後剩下的 markdown,example 圍欄仍嵌在裡面,交給 renderMarkdown 一次處理。 */
  bodyMarkdown: string;
}

export function parseCard(raw: string): ParsedCard {
  const { data, content } = matter(raw);
  return { frontmatter: data as CardFrontmatter, bodyMarkdown: content.trim() };
}
