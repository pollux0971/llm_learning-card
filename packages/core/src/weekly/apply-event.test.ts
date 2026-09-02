import { describe, expect, it } from 'vitest';
import { applyEvent } from './apply-event.js';
import type { Weekly } from './types.js';

const base: Weekly = { week: '2026-W37', target: 7, learned: 0, passed_d1: 0, counted: [] };

describe('applyEvent — learned', () => {
  it('increases learned only', () => {
    const { weekly } = applyEvent(base, { type: 'learned', card: 'sec-0001' }, '2026-W37');
    expect(weekly.learned).toBe(1);
    expect(weekly.passed_d1).toBe(0);
    expect(weekly.counted).toEqual([]);
  });

  it('does not add the card to counted', () => {
    const { weekly } = applyEvent(base, { type: 'learned', card: 'sec-0001' }, '2026-W37');
    expect(weekly.counted).not.toContain('sec-0001');
  });

  it('preserves an existing counted list untouched', () => {
    const withCounted: Weekly = { ...base, learned: 3, passed_d1: 2, counted: ['sec-0001', 'sec-0002'] };
    const { weekly } = applyEvent(withCounted, { type: 'learned', card: 'sec-0099' }, '2026-W37');
    expect(weekly.counted).toEqual(['sec-0001', 'sec-0002']);
    expect(weekly.passed_d1).toBe(2);
    expect(weekly.learned).toBe(4);
  });
});

describe('applyEvent — checkpoint 1 (D1)', () => {
  it('increases passed_d1 and records the card', () => {
    const { weekly } = applyEvent(base, { type: 'checkpoint-passed', card: 'sec-0001', checkpoint: 1 }, '2026-W37');
    expect(weekly.passed_d1).toBe(1);
    expect(weekly.counted).toEqual(['sec-0001']);
  });

  it('does not count twice for the same card within a week', () => {
    const once = applyEvent(base, { type: 'checkpoint-passed', card: 'sec-0001', checkpoint: 1 }, '2026-W37').weekly;
    const twice = applyEvent(once, { type: 'checkpoint-passed', card: 'sec-0001', checkpoint: 1 }, '2026-W37').weekly;
    expect(twice.passed_d1).toBe(1);
    expect(twice.counted).toEqual(['sec-0001']);
  });

  it('counts distinct cards independently', () => {
    const first = applyEvent(base, { type: 'checkpoint-passed', card: 'sec-0001', checkpoint: 1 }, '2026-W37').weekly;
    const second = applyEvent(first, { type: 'checkpoint-passed', card: 'sec-0002', checkpoint: 1 }, '2026-W37').weekly;
    expect(second.passed_d1).toBe(2);
    expect(second.counted).toEqual(['sec-0001', 'sec-0002']);
  });
});

describe('applyEvent — later checkpoints', () => {
  it.each([2, 3, 4, 5])('checkpoint %i does not change passed_d1 or counted', (checkpoint) => {
    const { weekly } = applyEvent(base, { type: 'checkpoint-passed', card: 'sec-0001', checkpoint }, '2026-W37');
    expect(weekly.passed_d1).toBe(0);
    expect(weekly.counted).toEqual([]);
    expect(weekly.learned).toBe(0);
  });
});

describe('applyEvent — rollover', () => {
  const midWeek: Weekly = { week: '2026-W37', target: 7, learned: 5, passed_d1: 3, counted: ['sec-0001', 'sec-0002', 'sec-0003'] };

  it('resets counts and counted, preserves target, when the week changes', () => {
    const { weekly } = applyEvent(midWeek, { type: 'learned', card: 'sec-0009' }, '2026-W38');
    expect(weekly.week).toBe('2026-W38');
    expect(weekly.target).toBe(7);
    expect(weekly.counted).toEqual([]);
  });

  it('reports the closed week in the rollover record with target_met', () => {
    const { rollover } = applyEvent(midWeek, { type: 'learned', card: 'sec-0009' }, '2026-W38');
    expect(rollover).toEqual({ week: '2026-W37', target: 7, learned: 5, passed_d1: 3, target_met: false });
  });

  it('reports target_met true when the closed week hit the target', () => {
    const metWeek: Weekly = { ...midWeek, passed_d1: 7 };
    const { rollover } = applyEvent(metWeek, { type: 'learned', card: 'sec-0009' }, '2026-W38');
    expect(rollover?.target_met).toBe(true);
  });

  it('applies the incoming event on top of the freshly reset state', () => {
    const { weekly } = applyEvent(midWeek, { type: 'checkpoint-passed', card: 'sec-0009', checkpoint: 1 }, '2026-W38');
    expect(weekly.passed_d1).toBe(1);
    expect(weekly.counted).toEqual(['sec-0009']);
  });

  it('jumps straight to the current week, logging only one rollover, when several weeks were skipped', () => {
    const staleWeek: Weekly = { week: '2026-W35', target: 7, learned: 9, passed_d1: 8, counted: ['sec-0001', 'sec-0002'] };
    const outcome = applyEvent(staleWeek, { type: 'learned', card: 'sec-0009' }, '2026-W38');
    expect(outcome.rollover?.week).toBe('2026-W35');
    expect(outcome.weekly.week).toBe('2026-W38');
  });

  it('does not roll over when the week is unchanged', () => {
    const { rollover } = applyEvent(midWeek, { type: 'learned', card: 'sec-0009' }, '2026-W37');
    expect(rollover).toBeUndefined();
  });
});

describe('applyEvent — purity', () => {
  it('never mutates the input object', () => {
    const input: Weekly = { week: '2026-W37', target: 7, learned: 2, passed_d1: 1, counted: ['sec-0001'] };
    const snapshot = JSON.stringify(input);
    applyEvent(input, { type: 'checkpoint-passed', card: 'sec-0002', checkpoint: 1 }, '2026-W37');
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('never mutates the input counted array', () => {
    const counted = ['sec-0001'];
    const input: Weekly = { week: '2026-W37', target: 7, learned: 0, passed_d1: 1, counted };
    applyEvent(input, { type: 'checkpoint-passed', card: 'sec-0002', checkpoint: 1 }, '2026-W37');
    expect(counted).toEqual(['sec-0001']);
  });

  it('always returns a new object, distinct from the input', () => {
    const { weekly } = applyEvent(base, { type: 'learned', card: 'sec-0001' }, '2026-W37');
    expect(weekly).not.toBe(base);
    expect(weekly.counted).not.toBe(base.counted);
  });
});
