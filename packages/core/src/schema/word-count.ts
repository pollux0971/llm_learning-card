/**
 * 契約 §2 字數規則的權威實作。逐字元掃描,CJK 每字算 1,
 * 字母數字的連續序列算 1(標點、符號、空白會切斷序列並自己計 0)。
 */

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const ALNUM_RE = /[\p{L}\p{N}]/u;

function isCjk(ch: string): boolean {
  return CJK_RE.test(ch);
}

function isAlnum(ch: string): boolean {
  return !isCjk(ch) && ALNUM_RE.test(ch);
}

/** 依契約 §2 演算法計算字數。呼叫端負責先移除 example 圍欄。 */
export function countWords(text: string): number {
  let count = 0;
  let inSequence = false;
  for (const ch of text) {
    if (isCjk(ch)) {
      count += 1;
      inSequence = false;
    } else if (isAlnum(ch)) {
      if (!inSequence) {
        count += 1;
        inSequence = true;
      }
    } else {
      inSequence = false;
    }
  }
  return count;
}
