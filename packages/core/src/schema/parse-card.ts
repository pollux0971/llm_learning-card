import matter from 'gray-matter';

export interface ParsedCard {
  /** gray-matter 讀出的原始 frontmatter,型別未經 zod 驗證 */
  frontmatter: Record<string, unknown>;
  /** markdown body,已移除所有 example 圍欄並 trim */
  body: string;
  /** 每個 example 圍欄的原始內容(已 trim),依出現順序 */
  examples: string[];
}

const EXAMPLE_FENCE_RE = /```example\r?\n([\s\S]*?)```/g;

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
    .replace(EXAMPLE_FENCE_RE, (_match, inner: string) => {
      examples.push(inner.trim());
      return '';
    })
    .trim();
  return { frontmatter: normalizeDates((data ?? {}) as Record<string, unknown>), body, examples };
}
