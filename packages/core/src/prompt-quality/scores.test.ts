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

  /**
   * 審核補測(12-prompt-quality/phase-2 驗收)。
   *
   * 上面那些測試都是 `toContain` 的形狀,只問「有沒有出現這幾個字」。
   * 變異測試的結果是:整條標題、整條說明、分隔列、空白格全部換掉或清空,
   * 沒有一個測試會紅——可是 SCORES.md 是要拿去 **diff** 的檔案,
   * 格式本身就是規格。所以要有一個把整份輸出逐字釘住的測試。
   */
  it('render 的輸出逐字固定(這份檔案是要拿去 diff 的)', () => {
    expect(renderScoresSheet('grade.apply', '2026-09-10', ['demo-1', 'demo-2'])).toBe(
      [
        '# grade.apply — 2026-09-10 評分表',
        '',
        '兩個維度,各 1–5 分:正確嗎、是一個概念嗎。工具不判斷品質,這份表是給人填的。',
        '',
        '| id | 正確嗎 | 是一個概念嗎 |',
        '|---|---|---|',
        '| demo-1 |   |   |',
        '| demo-2 |   |   |',
        '',
      ].join('\n'),
    );
  });

  it('一個 id 都沒有時仍然印出表頭與分隔列', () => {
    const sheet = renderScoresSheet('deepen', '2026-09-11', []);
    expect(sheet.split('\n')).toEqual([
      '# deepen — 2026-09-11 評分表',
      '',
      '兩個維度,各 1–5 分:正確嗎、是一個概念嗎。工具不判斷品質,這份表是給人填的。',
      '',
      '| id | 正確嗎 | 是一個概念嗎 |',
      '|---|---|---|',
      '',
    ]);
  });

  it('parse:只填了第一個維度的列也讀得回來', () => {
    const sheet = ['| id | 正確嗎 | 是一個概念嗎 |', '|---|---|---|', '| demo-1 | 5 |', '| demo-2 | 4 |  |'].join('\n');
    expect(parseScoresSheet(sheet)).toEqual({ 'demo-1': { 正確嗎: '5' }, 'demo-2': { 正確嗎: '4' } });
  });

  it('parse:整份文件裡不是表格的行一律略過', () => {
    const sheet = [
      '# 標題',
      '',
      '一段說明文字,裡面提到 demo-1 但不是表格。',
      '| id | 正確嗎 | 是一個概念嗎 |',
      '|---|---|---|',
      '| demo-1 | 5 | 4 |',
      '這一行以字開頭 |',
      '| 這一行不以直線結尾',
      '',
    ].join('\n');
    expect(parseScoresSheet(sheet)).toEqual({ 'demo-1': { 正確嗎: '5', 是一個概念嗎: '4' } });
  });

  it('parse:整列前後有空白照樣讀得到(有人手動編輯過)', () => {
    const sheet = ['   | id | 正確嗎 | 是一個概念嗎 |  ', '  |---|---|---|', '\t| demo-1 | 5 | 4 |   '].join('\n');
    expect(parseScoresSheet(sheet)).toEqual({ 'demo-1': { 正確嗎: '5', 是一個概念嗎: '4' } });
  });

  it('parse:表頭列與分隔列不會被當成分數', () => {
    const sheet = ['| id | 正確嗎 | 是一個概念嗎 |', '|---|---|---|', '|----|----|----|'].join('\n');
    expect(parseScoresSheet(sheet)).toEqual({});
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
