/**
 * 契約 §2「Example 圍欄」,並對齊 CommonMark 的空白寬容(顧問 5a 裁決乙)。
 * N = 開始的反引號數(N ≥ 3):
 * 開始是 N 個反引號接著 example、可有空白或 Tab、再換行(CRLF 也行);
 * 結束是該行 0–3 個空白縮排、剛好 N 個反引號(後面不能再接反引號)、
 * 可有空白或 Tab、再換行或檔尾。
 * 數量比開始少的那一行不結束。結束反引號後面接字、貼在內容行尾的反引號、
 * 縮排 4 個以上,都不是結束(後者契約未定義,不擴大)。
 * 第一個捕獲組是開頭的反引號,第二個是圍欄內容(尚未 trim)。
 *
 * 從 parse-card.ts 原樣搬來(T51 + 裁決乙)。正則一個字不改。T52 起這是唯一一份。
 */
const EXAMPLE_FENCE_RE = /(?<!`)(`{3,})example[ \t]*\r?\n([\s\S]*?)^[ ]{0,3}\1(?!`)[ \t]*(?=\r?\n|$)/gm;

/**
 * 拿掉所有 example 圍欄。
 * body 是移除後再 trim;examples 是每個圍欄內容 trim 過、依出現順序。
 */
export function stripExampleFences(text: string): { body: string; examples: string[] } {
  const examples: string[] = [];
  const body = text
    .replace(EXAMPLE_FENCE_RE, (_match, _ticks: string, inner: string) => {
      examples.push(inner.trim());
      return '';
    })
    .trim();
  return { body, examples };
}
