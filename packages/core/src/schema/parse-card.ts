import matter from 'gray-matter';

export interface ParsedCard {
  /** gray-matter 讀出的原始 frontmatter,型別未經 zod 驗證 */
  frontmatter: Record<string, unknown>;
  /** markdown body,已移除所有 example 圍欄並 trim */
  body: string;
  /** 每個 example 圍欄的原始內容(已 trim),依出現順序 */
  examples: string[];
}

/**
 * 契約 §2「Example 圍欄」,並對齊 CommonMark 的空白寬容(顧問 5a 裁決乙)。
 * N = 開始的反引號數(N ≥ 3):
 * 開始是 N 個反引號接著 example、可有空白或 Tab、再換行(CRLF 也行);
 * 結束是該行 0–3 個空白縮排、剛好 N 個反引號(後面不能再接反引號)、
 * 可有空白或 Tab、再換行或檔尾。
 * 數量比開始少的那一行不結束。結束反引號後面接字、貼在內容行尾的反引號、
 * 縮排 4 個以上,都不是結束(後者契約未定義,不擴大)。
 * 第一個捕獲組是開頭的反引號,第二個是圍欄內容(尚未 trim)。
 */
const EXAMPLE_FENCE_RE = /(?<!`)(`{3,})example[ \t]*\r?\n([\s\S]*?)^[ ]{0,3}\1(?!`)[ \t]*(?=\r?\n|$)/gm;

/**
 * gray-matter 底層的 YAML 解析器(js-yaml)會把 `created: 2026-09-01` 這種
 * 沒加引號的日期自動轉成 JS Date,但契約 §1 的 IsoDate 是字串。這裡轉回來,
 * 讓 frontmatter 進 zod 之前一律是純 JSON 型別。
 */
function normalizeDates(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  }
  return out;
}

/** 讀一張卡的原始文字,拆成 frontmatter / body / examples。不做欄位驗證。 */
export function parseCardText(raw: string): ParsedCard {
  const { data, content } = matter(raw);
  const examples: string[] = [];
  const body = content
    .replace(EXAMPLE_FENCE_RE, (_match, _ticks: string, inner: string) => {
      examples.push(inner.trim());
      return '';
    })
    .trim();
  return { frontmatter: normalizeDates(data as Record<string, unknown>), body, examples };
}
