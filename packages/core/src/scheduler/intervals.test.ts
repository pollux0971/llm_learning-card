import { describe, expect, it } from 'vitest';
import { intervalDaysForStage, questionTypesForStage } from './intervals.js';
import type { Stage } from './types.js';

describe('intervalDaysForStage', () => {
  it.each([
    [1, 1],
    [2, 7],
    [3, 30],
    [4, 90],
    [5, 180],
  ] as [Stage, number][])('stage %i 的間隔是 %i 天', (stage, expected) => {
    expect(intervalDaysForStage(stage)).toBe(expected);
  });

  it.each([0, 6] as Stage[])('stage %i 沒有固定間隔,丟出錯誤', (stage) => {
    expect(() => intervalDaysForStage(stage)).toThrow();
  });
});

describe('questionTypesForStage', () => {
  it.each([
    [1, ['fill']],
    [2, ['fill', 'apply']],
    [3, ['apply']],
    [4, ['apply']],
    [5, ['apply']],
  ] as [Stage, string[]][])('stage %i 的題型是 %j', (stage, expected) => {
    expect(questionTypesForStage(stage)).toEqual(expected);
  });

  it.each([0, 6] as Stage[])('stage %i 沒有題型,丟出錯誤', (stage) => {
    expect(() => questionTypesForStage(stage)).toThrow();
  });
});
