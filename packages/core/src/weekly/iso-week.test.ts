import { describe, expect, it } from 'vitest';
import { isoWeekOf } from './iso-week.js';

describe('isoWeekOf', () => {
  it('computes an ordinary week', () => {
    expect(isoWeekOf('2026-09-10')).toBe('2026-W37');
  });

  it('pads single-digit week numbers', () => {
    expect(isoWeekOf('2026-01-05')).toBe('2026-W02');
  });

  it.each([
    ['2026-12-31', '2026-W53'],
    ['2027-01-01', '2026-W53'],
    ['2027-01-04', '2027-W01'],
  ])('year boundary: %s -> %s', (date, week) => {
    expect(isoWeekOf(date)).toBe(week);
  });
});
