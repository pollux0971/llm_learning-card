import { afterEach, describe, expect, it } from 'vitest';
import { addIsoDays, isoDaysBetween } from './dates.js';

describe('addIsoDays', () => {
  it('加天數會跨月', () => {
    expect(addIsoDays('2026-09-25', 7)).toBe('2026-10-02');
  });

  it('加 0 天原樣返回', () => {
    expect(addIsoDays('2026-09-10', 0)).toBe('2026-09-10');
  });

  describe('在會變 offset 的時區裡結果一樣', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it('DST 那天加 7 天,跟 UTC 算出來一樣', () => {
      process.env.TZ = 'Europe/London';
      const withDst = addIsoDays('2026-03-29', 7);
      process.env.TZ = 'UTC';
      const withUtc = addIsoDays('2026-03-29', 7);
      expect(withDst).toBe(withUtc);
      expect(withDst).toBe('2026-04-05');
    });
  });
});

describe('isoDaysBetween', () => {
  it('同一天是 0', () => {
    expect(isoDaysBetween('2026-09-10', '2026-09-10')).toBe(0);
  });

  it('to 在 from 之後是正數', () => {
    expect(isoDaysBetween('2026-09-09', '2026-09-10')).toBe(1);
  });

  it('to 在 from 之前是負數', () => {
    expect(isoDaysBetween('2026-09-10', '2026-09-09')).toBe(-1);
  });
});
