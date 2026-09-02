/**
 * Wave 0 的最小字數檢查,實作 contracts/types.md §2 的權威演算法。
 * I1 整合後改用 01-data-layer 的正式驗證器(見 FEATURE.md「Wave 0 的重複」表)。
 *
 * 演算法(依序):
 *   1. 移除所有 example 圍欄
 *   2. 逐字元分三類:CJK、字母數字(非 CJK 的字母類與數字類)、其他(空白/標點/符號)
 *   3. CJK 每字算 1
 *   4. 字母數字的連續序列算 1,「其他」類的字元會切斷序列
 *   5. 「其他」類本身算 0
 */

const EXAMPLE_FENCE_RE = /```example\r?\n?[\s\S]*?```/g;

export function stripExampleFences(text: string): { body: string; examples: string[] } {
  const examples: string[] = [];
  const body = text.replace(EXAMPLE_FENCE_RE, (m) => {
    const inner = m.replace(/^```example\r?\n?/, '').replace(/```$/, '');
    examples.push(inner.replace(/\n$/, ''));
    return '';
  });
  return { body, examples };
}

// CJK Unified Ideographs、Hiragana、Katakana、Hangul(含各自的擴充區段)。
const CJK_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
// 非 CJK 的字母數字:Unicode 類別 L*(字母)與 N*(數字)。
const ALNUM_RE = /^[\p{L}\p{N}]$/u;

/** 對已經去除 example 圍欄的 body 計算字數。 */
export function countWords(bodyWithoutExamples: string): number {
  let count = 0;
  let inSequence = false;
  for (const ch of Array.from(bodyWithoutExamples)) {
    if (CJK_RE.test(ch)) {
      count += 1;
      inSequence = false;
    } else if (ALNUM_RE.test(ch)) {
      if (!inSequence) count += 1;
      inSequence = true;
    } else {
      inSequence = false;
    }
  }
  return count;
}

/** 方便呼叫端一次算完:先去圍欄,再算字數。 */
export function countBodyWords(rawBody: string): number {
  const { body } = stripExampleFences(rawBody);
  return countWords(body);
}

export const BODY_WORD_LIMIT = 100;
