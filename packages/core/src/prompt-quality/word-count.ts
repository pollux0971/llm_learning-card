/**
 * 教學卡 body 字數規則(contracts/types.md §2,硬約定)。
 * 演算法權威定義在契約,這裡是它的一份實作——Wave 0 期間各功能自備一份,
 * 不 import packages/contracts(01 尚未填)。
 */

const EXAMPLE_FENCE = /```example[\s\S]*?```/g;

function isCJK(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x3040 && cp <= 0x309f) || // Hiragana
    (cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
    (cp >= 0xac00 && cp <= 0xd7a3) // Hangul syllables
  );
}

function isAlnum(ch: string): boolean {
  return /\p{L}/u.test(ch) || /\p{N}/u.test(ch);
}

/**
 * 依契約 §2 演算法計算 body 字數:
 * 1. 移除 example 圍欄
 * 2. 逐字元分三類:CJK / 字母數字(非 CJK) / 其他
 * 3. 每個 CJK 字元計 1
 * 4. 每個「字母數字連續序列」計 1,「其他」類切斷序列
 * 5. 「其他」類本身計 0
 */
export function countBodyWords(rawBody: string): number {
  const body = rawBody.replace(EXAMPLE_FENCE, '');
  let count = 0;
  let inSeq = false;

  for (const ch of body) {
    const cp = ch.codePointAt(0)!;
    if (isCJK(cp)) {
      count += 1;
      inSeq = false;
    } else if (isAlnum(ch)) {
      if (!inSeq) {
        count += 1;
        inSeq = true;
      }
    } else {
      inSeq = false;
    }
  }
  return count;
}
