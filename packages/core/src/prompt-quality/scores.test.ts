import { describe, it, expect } from 'vitest';
import { renderScoresSheet, parseScoresSheet } from './scores.js';

describe('scores sheet', () => {
  it('render 出來每列一個 id,分數欄是空的,且列出兩個維度名稱', () => {
    const sheet = renderScoresSheet('grade.apply', '2026-09-10', ['demo-1', 'demo-2']);
    expect(sheet).toContain('demo-1');
    expect(sheet).toContain('demo-2');
    expect(sheet).toContain('正確嗎');
    expect(sheet).toContain('是一個概念嗎');
    expect(parseScoresSheet(sheet)).toEqual({});
  });

  it('parse 會讀回填好的分數,略過沒填的', () => {
    const sheet = [
      '| id | 正確嗎 | 是一個概念嗎 |',
      '|---|---|---|',
      '| demo-1 | 5 | 4 |',
      '| demo-2 |  |  |',
    ].join('\n');
    expect(parseScoresSheet(sheet)).toEqual({
      'demo-1': { 正確嗎: '5', 是一個概念嗎: '4' },
    });
  });

  it('render 完再 parse 拿到跟填寫後一致的結構', () => {
    const sheet = renderScoresSheet('grade.apply', '2026-09-10', ['demo-1']);
    const filled = sheet
      .split('\n')
      .map((line) => (line.startsWith('| demo-1') ? '| demo-1 | 3 | 2 |' : line))
      .join('\n');
    expect(parseScoresSheet(filled)).toEqual({ 'demo-1': { 正確嗎: '3', 是一個概念嗎: '2' } });
  });
});
