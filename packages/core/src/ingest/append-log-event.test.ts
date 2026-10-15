import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendLogEvent, readLogEvents } from './state.js';

describe('appendLogEvent', () => {
  let dir = '';

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('先建目錄,寫出的位元組是 JSON.stringify(event) + 換行,readLogEvents 讀回來一樣', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-append-log-'));
    const logPath = join(dir, 'state', 'nested', 'log.jsonl');
    const event = { ts: '2026-10-15T00:00:00Z', type: 'learned', card: 'sec-0001', note: '記憶' };

    appendLogEvent(logPath, event);

    expect(readFileSync(logPath, 'utf8')).toBe(`${JSON.stringify(event)}\n`);
    expect(readLogEvents(logPath)).toEqual([event]);
  });
});
