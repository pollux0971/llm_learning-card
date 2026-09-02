import { describe, expect, it } from 'vitest';
import { isTargetMet } from './target.js';

describe('isTargetMet', () => {
  it.each([
    [6, 7, false],
    [7, 7, true],
    [9, 7, true],
    [0, 1, false],
  ])('passed=%i target=%i -> %s', (passed, target, met) => {
    expect(isTargetMet(passed, target)).toBe(met);
  });
});
