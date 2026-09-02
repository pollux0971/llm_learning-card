import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import matter from 'gray-matter';
import { wordCount } from './word-count.js';

const ROOT = resolve(import.meta.dirname, '../../..');

describe('wordCount', () => {
  it.each([
    ['same-origin', 2],
    ['TLS', 1],
    ['1.5', 2],
    ["don't", 2],
    ['同源政策', 4],
    ['RFC 6265', 2],
  ])('%s -> %d', (input, expected) => {
    expect(wordCount(input)).toBe(expected);
  });

  it('matches the contract fixture (wordcount-cases.md)', () => {
    // contracts/fixtures/cards/README.md 的敘述文字說「合計 26」,但它自己列的逐片段表格
    // (4+2+1+1+1+2+3+1+1+3+1+1+2)加總是 23,而且跟本檔案演算法照契約 §2 逐步算出來的
    // 結果一致。判斷這是文件的加總筆誤,不是演算法錯——已回報給協調者,待 ADR 或修正文件。
    const raw = readFileSync(resolve(ROOT, 'contracts/fixtures/cards/wordcount-cases.md'), 'utf8');
    const { content } = matter(raw);
    expect(wordCount(content.trim())).toBe(23);
  });

  it('excludes example fences from the count', () => {
    const raw = readFileSync(resolve(ROOT, 'contracts/fixtures/cards/valid-basic.md'), 'utf8');
    const { content } = matter(raw);
    const withFence = wordCount(content);
    const withoutFence = wordCount(content.replace(/```example[\s\S]*?```/, ''));
    expect(withFence).toBe(withoutFence);
  });

  it('rejects nothing over 100 for the shared fixture cards used by the app', () => {
    const files = [
      'contracts/fixtures/cards/valid-basic.md',
      'contracts/fixtures/cards/valid-no-example.md',
      'contracts/fixtures/cards/valid-three-examples.md',
      'contracts/fixtures/cards/valid-level1-with-parent.md',
    ];
    for (const f of files) {
      const raw = readFileSync(resolve(ROOT, f), 'utf8');
      const { content } = matter(raw);
      expect(wordCount(content.trim())).toBeLessThanOrEqual(100);
    }
  });
});
