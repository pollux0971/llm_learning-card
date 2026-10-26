/**
 * T57:countBodyWords 的字面向量(契約 §2 關鍵推論六列、移除圍欄、空字串、連續空白)原本在這裡,現在是
 * `contracts/fixtures/word-count-vectors.json` 的列(對照:`docs/reviews/T57-old-vectors-map.md`),09-lint 的 countBodyWords
 * 與 parseCard 的 examples 由 `features/support/word-count-vectors.test.ts` 跑每一列。留下的是 parseCard 拆 frontmatter 與 body 的行為(不是向量)。
 */
import { describe, it, expect } from 'vitest';
import { parseCard } from './validator-min.js';

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
