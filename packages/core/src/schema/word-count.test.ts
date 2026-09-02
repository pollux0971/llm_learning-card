import { describe, expect, it } from 'vitest';
import { countWords } from './word-count.js';

describe('countWords', () => {
  it.each([
    ['TLS handshake needs 3 rounds.', 5],
    ['同源政策', 4],
    ['同源政策(same-origin policy)', 7],
    ['a b c d e', 5],
    ['一、二、三。', 3],
    ['TLS 1.3', 3],
    ["don't", 2],
    ['RFC 6265', 2],
    ['', 0],
  ])('counts %j as %i (contract §2 examples)', (content, expected) => {
    expect(countWords(content)).toBe(expected);
  });

  it('matches the shipped word count fixture card (23)', () => {
    const body = "同源政策(same-origin policy)在 TLS 1.3 下不變。don't 算兩個。RFC 6265 也是。";
    expect(countWords(body)).toBe(23);
  });

  it('counts a body of exactly 100 CJK characters as 100', () => {
    expect(countWords('字'.repeat(100))).toBe(100);
  });

  it('counts a body of exactly 101 CJK characters as 101', () => {
    expect(countWords('字'.repeat(101))).toBe(101);
  });

  it('treats consecutive hyphenated words as separate sequences', () => {
    expect(countWords('same-origin')).toBe(2);
  });

  it('treats a period inside digits as a sequence break', () => {
    expect(countWords('1.5')).toBe(2);
  });

  it('treats an apostrophe as a sequence break', () => {
    expect(countWords("don't")).toBe(2);
  });

  it('does not count whitespace-only content', () => {
    expect(countWords('   \n\t  ')).toBe(0);
  });
});
