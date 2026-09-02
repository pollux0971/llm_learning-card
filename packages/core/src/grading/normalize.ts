/**
 * 填空答案正規化:trim、NFKC(全形轉半形)、toLowerCase,並移除所有空白
 * (包含字中間的全形空白 — 這是打字習慣造成的雜訊,不是有意義的分隔)。
 */
export function normalize(input: string): string {
  // Stryker disable next-line Regex: replacing with '' makes \s and \s+ behave identically under /g
  return input.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}
