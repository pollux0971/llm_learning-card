/**
 * T18:同分類其他卡的一句摘要,給 children 的 `already_covered:` 用。
 *
 * 不新增欄位、不讀 `contracts/` 以外的格式。摘要從 body 算出來。
 * 讀磁碟用既有的 `parseCardText`(01),不另寫一份卡片解析。
 * `listCardIds`(01 / 11)只回全庫的 id、不含 body,這裡要的是單一分類的完整卡,所以目錄掃描留在這個函式。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CardFrontmatterSchema, type Card } from '@contracts/index.js';
import { parseCardText, stripExampleFences } from '@core/schema/index.js';

/** 一句摘要的字元上限(code point)。超過就截到這個長度再加 `…`(總長 61)。 */
const SUMMARY_MAX_CODE_POINTS = 60;

/** 同分類列出的兄弟卡上限。超過時留 id 最大的這麼多張。 */
const DEFAULT_SIBLING_CAP = 80;

export interface Sibling {
  id: string;
  title: string;
  summary: string;
}

function collapseSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 以 code point 切,不拆 surrogate pair。 */
function codePoints(text: string): string[] {
  return [...text];
}

/**
 * body 的第一句,最多 60 個 code point。
 *
 * 1. 拿掉 example 圍欄(圍欄裡的句號不算句子結束)。用 01 的 stripExampleFences(T52、ADR-060),不在這裡另寫 regex。
 * 2. 空白(含換行)壓成一個半形空格,去頭尾。
 * 3. 取到第一個句子結束為止。結束符是 `。` `！` `？` `!` `?`,或「`.` 後面接空白或字串結尾」。
 *    結束符留在摘要裡。沒有結束符就取整段。
 * 4. 超過 60 個 code point 就截到 60,尾端加 `…`。
 */
export function cardSummary(body: string): string {
  const flat = collapseSpace(stripExampleFences(body).body);
  const chars = codePoints(flat);
  let end = chars.length;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    if (ch === '。' || ch === '！' || ch === '？' || ch === '!' || ch === '?') {
      end = i + 1;
      break;
    }
    if (ch === '.') {
      const next = chars[i + 1];
      if (next === undefined || /\s/.test(next)) {
        end = i + 1;
        break;
      }
    }
  }
  const sentence = chars.slice(0, end);
  if (sentence.length <= SUMMARY_MAX_CODE_POINTS) return sentence.join('');
  return `${sentence.slice(0, SUMMARY_MAX_CODE_POINTS).join('')}…`;
}

/**
 * 同分類、不是父卡自己的卡。依 id 遞增。超過 `cap` 時保留 id 最大的 `cap` 張
 * (最近建立的最可能相關),仍依 id 遞增。不改輸入陣列。
 */
export function listSiblings(cards: Card[], parent: Card, cap = DEFAULT_SIBLING_CAP): Sibling[] {
  const category = parent.frontmatter.category;
  const parentId = parent.frontmatter.id;
  const others = cards.filter((card) => card.frontmatter.id !== parentId && card.frontmatter.category === category);
  others.sort((a, b) => (a.frontmatter.id < b.frontmatter.id ? -1 : a.frontmatter.id > b.frontmatter.id ? 1 : 0));
  const kept = others.length > cap ? others.slice(others.length - cap) : others;
  return kept.map((card) => ({
    id: card.frontmatter.id,
    title: card.frontmatter.title,
    summary: cardSummary(card.body),
  }));
}

/**
 * `already_covered:` 區塊的行。沒有 sibling 回 `[]`(整段省略,不印空標題)。
 * 一張卡一行,半形冒號(工單程式範例與紅測試釘的都是 U+003A);標題裡的換行壓成一個空格。
 */
export function formatAlreadyCovered(siblings: Sibling[]): string[] {
  if (siblings.length === 0) return [];
  return [
    'already_covered:',
    ...siblings.map((sibling) => `- ${collapseSpace(sibling.title)}:${sibling.summary}`),
  ];
}

/**
 * 讀 `cards/<category>/*.md`,不含 `.short.md`。解析用 `parseCardText`。
 * 解析失敗或 frontmatter 對不上契約的卡略過、不丟錯——生成子卡不該因為別張卡壞掉而失敗。
 * 分類資料夾不存在回 `[]`。
 */
export function loadCategoryCards(outDir: string, category: string): Card[] {
  const dir = join(outDir, 'cards', category);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const cards: Card[] = [];
  for (const name of names) {
    if (!name.endsWith('.md') || name.endsWith('.short.md')) continue;
    try {
      const parsed = parseCardText(readFileSync(join(dir, name), 'utf8'));
      const fm = CardFrontmatterSchema.safeParse(parsed.frontmatter);
      if (!fm.success) continue;
      cards.push({ frontmatter: fm.data, body: parsed.body, examples: parsed.examples });
    } catch {
      // 壞掉的卡檔略過。
    }
  }
  return cards;
}
