/**
 * 09-lint 的最小驗證器(Wave 0 stub,見 FEATURE.md「Wave 0 的重複」)。
 *
 * 刻意不 import packages/core/src/schema/ ——這是 lint 用「另一雙眼睛」讀契約
 * 的重點,見 contracts/types.md §2 與 09-lint/FEATURE.md。I6 整合時改用 01 的正式驗證器。
 */
import matter from 'gray-matter';

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

const EXAMPLE_FENCE = /```example\r?\n([\s\S]*?)```/g;

export function parseCard(raw: string): ParsedCard {
  const { data, content } = matter(raw);
  const examples: string[] = [];
  const fenceRe = new RegExp(EXAMPLE_FENCE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(content)) !== null) {
    examples.push(m[1]!.trim());
  }
  const body = content.replace(new RegExp(EXAMPLE_FENCE.source, 'g'), '').trim();
  return { frontmatter: data as CardFrontmatterMin, body, examples };
}

// contracts/types.md §2:CJK Unified Ideographs、Hiragana、Katakana、Hangul
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
// 字母數字:Unicode 類別 L*(非 CJK)與 N*
const ALNUM_RE = /[\p{L}\p{N}]/u;

/**
 * contracts/types.md §2 的 body 字數演算法。
 * 1. 移除所有 example 圍欄
 * 2-5. 逐字元掃描:CJK 各計 1;字母數字連續序列各計 1(其他類切斷序列);其他類計 0
 */
export function countBodyWords(body: string): number {
  const stripped = body.replace(EXAMPLE_FENCE, '');
  let count = 0;
  let inAlnumRun = false;
  for (const ch of stripped) {
    if (CJK_RE.test(ch)) {
      count += 1;
      inAlnumRun = false;
    } else if (ALNUM_RE.test(ch)) {
      if (!inAlnumRun) count += 1;
      inAlnumRun = true;
    } else {
      inAlnumRun = false;
    }
  }
  return count;
}
