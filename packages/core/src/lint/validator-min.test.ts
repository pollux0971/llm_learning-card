import { describe, it, expect } from 'vitest';
import { countBodyWords, parseCard } from './validator-min.js';

describe('countBodyWords', () => {
  // contracts/types.md §2「關鍵推論」表
  it.each([
    ['same-origin', 2],
    ['TLS', 1],
    ['1.5', 2],
    ["don't", 2],
    ['同源政策', 4],
    ['RFC 6265', 2],
  ])('%s → %d', (text, expected) => {
    expect(countBodyWords(text)).toBe(expected);
  });

  it('移除 example 圍欄後才計算', () => {
    const body = '正文四個字\n\n```example\n這裡有一大堆不該被算進去的內容 same-origin TLS\n```\n';
    expect(countBodyWords(body)).toBe(5);
  });

  it('空字串是 0', () => {
    expect(countBodyWords('')).toBe(0);
  });

  it('連續空白只切斷序列,本身不計分', () => {
    expect(countBodyWords('a   b')).toBe(2);
  });
});

describe('parseCard', () => {
  it('拆出 frontmatter、body(不含圍欄)、examples', () => {
    const raw = [
      '---',
      'id: sec-0001',
      'category: security',
      'title: 測試',
      'level: 0',
      'source: raw',
      'created: 2026-09-01',
      '---',
      '正文內容。',
      '',
      '```example',
      '範例內容',
      '```',
      '',
    ].join('\n');
    const card = parseCard(raw);
    expect(card.frontmatter.id).toBe('sec-0001');
    expect(card.frontmatter.category).toBe('security');
    expect(card.body).toBe('正文內容。');
    expect(card.examples).toEqual(['範例內容']);
  });

  it('沒有 example 圍欄時 examples 是空陣列', () => {
    const raw = ['---', 'id: sec-0002', '---', '只有正文。'].join('\n');
    const card = parseCard(raw);
    expect(card.examples).toEqual([]);
    expect(card.body).toBe('只有正文。');
  });
});
