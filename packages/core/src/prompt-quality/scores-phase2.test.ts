/**
 * SCORES.md 的 phase-2 格式。
 *
 * 兩件事被釘住:
 *   1. **人只填兩個維度**(ADR-032:多了就沒人填)。批次檢查的數字放在另一段,
 *      不是第三、第四個要人填的欄位。
 *   2. **格式穩定**——這份檔案之後要拿來 diff。0 的時候標題與數字照印,不整段消失。
 */
import { describe, it, expect } from 'vitest';
import { renderScoresSheet, renderBatchCheckSection, parseScoresSheet } from './scores.js';
import { SCORE_DIMENSIONS } from './types.js';
import type { BatchCheckResult } from './types.js';

const CLEAN: BatchCheckResult = {
  issues: [],
  note: '不判斷品質',
  duplicates: { cardCount: 25, pairs: [], rate: 0 },
  prereqShape: [],
};

const DIRTY: BatchCheckResult = {
  issues: [],
  note: '不判斷品質',
  duplicates: {
    cardCount: 10,
    pairs: [
      { a: 'syn-0001', b: 'syn-0002', reason: 'title', similarity: 0.147 },
      { a: 'syn-0005', b: 'syn-0006', reason: 'body', similarity: 0.6 },
    ],
    rate: 0.2,
  },
  prereqShape: [{ card: 'sec-0003', cardLevel: 0, prereq: 'sec-0011', prereqLevel: 1 }],
};

describe('人打分的表格維持兩個維度', () => {
  it('就是兩個維度,不多不少', () => {
    expect(SCORE_DIMENSIONS).toHaveLength(2);
    expect([...SCORE_DIMENSIONS]).toEqual(['正確嗎', '是一個概念嗎']);
  });

  it('表頭只有 id 加那兩欄,沒有第三個要人填的欄位', () => {
    const header = renderScoresSheet('grade.apply', '2026-09-10', ['demo-1']).split('\n').find((l) => l.startsWith('| id'));
    expect(header).toBe('| id | 正確嗎 | 是一個概念嗎 |');
  });
});

describe('renderBatchCheckSection', () => {
  it('全 0 時格式仍然完整——標題與數字照印,不整段消失', () => {
    expect(renderBatchCheckSection(CLEAN)).toBe(
      ['## 機器檢查(不用填)', '', '重複對數 / 卡數 = 0 / 25(0.000)', '', '圖形狀 = 0', ''].join('\n'),
    );
  });

  it('有東西時列出每一對與每一筆,依字典序', () => {
    expect(renderBatchCheckSection(DIRTY)).toBe(
      [
        '## 機器檢查(不用填)',
        '',
        '重複對數 / 卡數 = 2 / 10(0.200)',
        '',
        '- syn-0001 ↔ syn-0002(title,0.147)',
        '- syn-0005 ↔ syn-0006(body,0.600)',
        '',
        '圖形狀 = 1',
        '',
        '- sec-0003(L0) → sec-0011(L1)',
        '',
      ].join('\n'),
    );
  });

  it('rate 固定三位小數,similarity 也是——浮點數尾巴會讓 diff 一直吵', () => {
    const section = renderBatchCheckSection(DIRTY);
    expect(section).toContain('(0.200)');
    expect(section).toContain('0.600');
    expect(section).not.toMatch(/0\.\d{4,}/);
  });

  it('這一段不會被 parseScoresSheet 誤讀成分數列', () => {
    const sheet = renderScoresSheet('grade.apply', '2026-09-10', ['demo-1']) + '\n' + renderBatchCheckSection(DIRTY);
    expect(parseScoresSheet(sheet)).toEqual({});
  });
});
