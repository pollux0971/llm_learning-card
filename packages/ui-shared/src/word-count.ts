/**
 * 教學卡 body 字數規則的可執行版本(contracts/types.md §2,硬約定)。
 * 演算法必須跟其他實作(01-data-layer、09-lint)算出同一個數字。
 */

const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const ALNUM = /[\p{L}\p{N}]/u;

/** 移除所有 example 圍欄(開頭 3 個以上反引號 + example,結尾同樣數量的反引號)。 */
function stripExampleFences(body: string): string {
  return body.replace(/(`{3,})\s*example\s*\r?\n[\s\S]*?\r?\n\1[ \t]*(?:\r?\n|$)/g, '');
}

/**
 * 計算教學卡 body 的字數。只算 body,不含 frontmatter、不含 example 圍欄。
 * CJK 每字元計 1;非 CJK 的字母數字連續序列計 1(標點、空白、符號會切斷序列並計 0)。
 */
export function wordCount(body: string): number {
  const stripped = stripExampleFences(body);
  let count = 0;
  let inSequence = false;
  for (const ch of stripped) {
    if (CJK.test(ch)) {
      count += 1;
      inSequence = false;
      continue;
    }
    if (ALNUM.test(ch)) {
      if (!inSequence) count += 1;
      inSequence = true;
      continue;
    }
    inSequence = false;
  }
  return count;
}
