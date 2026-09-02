import { describe, it, expect } from 'vitest';
import { countBodyWords } from './word-count.js';

// 案例表原文照抄自 contracts/types.md §2「關鍵推論」表,這是權威來源,不要自己重新發明。
describe('countBodyWords', () => {
  it.each([
    ['same-origin', 2],
    ['TLS', 1],
    ['1.5', 2],
    ["don't", 2],
    ['同源政策', 4],
    ['RFC 6265', 2],
  ])('%s → %i', (input, expected) => {
    expect(countBodyWords(input)).toBe(expected);
  });

  it('移除 example 圍欄後才計算', () => {
    const body = '同源政策很重要\n```example\na.com 與 a.com 同源,這一段完全不該被算進去\n```';
    expect(countBodyWords(body)).toBe(countBodyWords('同源政策很重要'));
  });

  it('空字串是 0', () => {
    expect(countBodyWords('')).toBe(0);
  });

  it('連續空白只切斷序列,不額外計數', () => {
    expect(countBodyWords('a   b')).toBe(2);
  });

  it('101 個中文字元超過 100 上限', () => {
    const body = '同'.repeat(101);
    expect(countBodyWords(body)).toBe(101);
    expect(countBodyWords(body)).toBeGreaterThan(100);
  });
});
