/**
 * 契約 §2 字數規則的權威實作。逐字元掃描,CJK 每字算 1,
 * 字母數字的連續序列算 1(標點、符號、空白會切斷序列並自己計 0)。
 *
 * CJK 的判定以 Unicode **Script** 屬性(Han / Hiragana / Katakana / Hangul)為準,
 * 不是用 Unicode 區段(block)。區段會漏掉擴充區與相容區的漢字,也會把區段內的
 * 標點誤算成字。09-lint 之後若自己寫驗證器,要用同一套判定才對得齊。
 *
 * CJK 字元同時也會切斷字母數字序列:「字a」= 2、「在TLS下」= 3。
 */

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const ALNUM_RE = /[\p{L}\p{N}]/u;

function isCjk(ch: string): boolean {
  return CJK_RE.test(ch);
}

/** 只在 isCjk 為 false 之後呼叫(見 countWords 的判斷順序),所以不必再排除 CJK。 */
function isAlnum(ch: string): boolean {
  return ALNUM_RE.test(ch);
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
