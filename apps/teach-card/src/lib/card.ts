import { parse as parseYaml } from 'yaml';

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

/**
 * gray-matter 內部依賴 Node 的 Buffer,Vite 建置的瀏覽器端沒有這個 global,
 * import 就整個模組炸掉(App.svelte 的讀取失敗訊息就是這樣來的)。這裡不碰
 * gray-matter,自己拆 frontmatter 區塊,YAML 部分交給專案已經在用的 yaml 套件。
 */
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseCard(raw: string): ParsedCard {
  const match = FRONTMATTER_PATTERN.exec(raw);
  if (!match) {
    throw new Error('card is missing a frontmatter block (---...---)');
  }
  const frontmatterYaml = match[1] ?? '';
  const body = match[2] ?? '';
  const data = parseYaml(frontmatterYaml);
  return { frontmatter: data as CardFrontmatter, bodyMarkdown: body.trim() };
}
