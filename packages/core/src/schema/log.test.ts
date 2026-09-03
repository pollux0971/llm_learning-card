import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseLogLines, recordEvent, validateLogEvent } from './log.js';

describe('validateLogEvent', () => {
  it.each([
    'learned',
    'reviewed',
    'ingested',
    'linted',
    'llm_call',
    'deepened',
    'reteach_queued',
    'reteach_viewed',
    'week_rolled',
    'regenerate',
    'cycle_removed',
    'provisional_resolved',
    'warning',
  ])('accepts the contract type %s', (type) => {
    const result = validateLogEvent({ ts: '2026-09-02T00:00:00Z', type });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a type outside the closed set', () => {
    const result = validateLogEvent({ ts: '2026-09-02T00:00:00Z', type: 'not_a_real_type' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('type'))).toBe(true);
  });

  it('accepts an event with a card id', () => {
    const result = validateLogEvent({ ts: '2026-09-02T00:00:00Z', type: 'learned', card: 'sec-0001' });
    expect(result.ok).toBe(true);
  });

  it('rejects a malformed card id', () => {
    const result = validateLogEvent({ ts: '2026-09-02T00:00:00Z', type: 'learned', card: 'not-an-id' });
    expect(result.ok).toBe(false);
  });

  it('rejects a missing ts', () => {
    const result = validateLogEvent({ type: 'learned' });
    expect(result.ok).toBe(false);
  });

  it('allows extra event-specific fields', () => {
    const result = validateLogEvent({ ts: '2026-09-02T00:00:00Z', type: 'llm_call', tokens_in: 100 });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object input', () => {
    const result = validateLogEvent('not an event');
    expect(result.ok).toBe(false);
  });
});

describe('recordEvent + parseLogLines', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes an event that round-trips through parseLogLines', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-log-'));
    const logPath = join(dir, 'log.jsonl');

    recordEvent(logPath, { ts: '2026-09-02T00:00:00Z', type: 'learned', card: 'sec-0001' });

    const events = parseLogLines(readFileSync(logPath, 'utf8'));
    expect(events).toEqual([{ ts: '2026-09-02T00:00:00Z', type: 'learned', card: 'sec-0001' }]);
  });

  it('appends multiple events as separate complete lines', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-log-'));
    const logPath = join(dir, 'log.jsonl');

    recordEvent(logPath, { ts: '2026-09-02T00:00:00Z', type: 'learned', card: 'sec-0001' });
    recordEvent(logPath, { ts: '2026-09-02T00:00:01Z', type: 'reviewed', card: 'sec-0001' });

    const events = parseLogLines(readFileSync(logPath, 'utf8'));
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe('reviewed');
  });
});

describe('parseLogLines', () => {
  it('skips blank lines', () => {
    const events = parseLogLines('{"ts":"t","type":"learned"}\n\n{"ts":"t2","type":"reviewed"}\n');
    expect(events).toHaveLength(2);
  });

  it('returns an empty array for empty content', () => {
    expect(parseLogLines('')).toEqual([]);
  });

  it('treats a whitespace-only line as blank rather than invalid JSON', () => {
    const events = parseLogLines('{"ts":"t","type":"learned"}\n   \n{"ts":"t2","type":"reviewed"}\n');
    expect(events).toHaveLength(2);
  });
});
