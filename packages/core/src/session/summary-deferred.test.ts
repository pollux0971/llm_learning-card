/**
 * T13 驗收補測(驗收者寫):「N 張延後」那一行的邊界。
 * 突變 S7(`deferred === 0` 改成 `deferred <= 1`)原本存活:只延後 1 張時整行消失,使用者看不到有一張被排到明天。
 * 措辭是建議值;測試只釘 N 與「0 張時整行不出現」。
 */
import { describe, expect, it } from 'vitest';
import { renderDeferred } from './summary.js';

describe('renderDeferred', () => {
  it('0 張:不印(回 undefined),不是印「0 張延後」', () => {
    expect(renderDeferred(0, 5)).toBeUndefined();
  });

  it.each([1, 2, 7, 120])('%i 張:印出,而且 N 就是延後的張數', (n) => {
    const line = renderDeferred(n, 5);
    expect(line).toBeDefined();
    const m = /(\d+)\s*張延後/.exec(line!);
    expect(m, line).not.toBeNull();
    expect(Number(m![1])).toBe(n);
  });

  it('N 用的是延後數,不是今日上限(兩個數字不同時分得出來)', () => {
    const line = renderDeferred(3, 10)!;
    expect(/(\d+)\s*張延後/.exec(line)![1]).toBe('3');
  });

  it('單行、沒有換行(終端機輸出一行一事)', () => {
    expect(renderDeferred(4, 5)).not.toMatch(/\n/);
  });
});
