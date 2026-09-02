import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileLogAppender } from './log-min.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('createFileLogAppender', () => {
  it('appends one complete JSON line per event, creating parent directories as needed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'log-min-'));
    dirs.push(dir);
    const path = join(dir, 'nested', 'log.jsonl');
    const append = createFileLogAppender(path);

    append({ type: 'llm_call', task: 'deepen' });
    append({ type: 'llm_call', task: 'grade.apply' });

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ task: 'deepen' });
    expect(JSON.parse(lines[1]!)).toMatchObject({ task: 'grade.apply' });
  });

  it('does nothing when no path is given', () => {
    const append = createFileLogAppender(undefined);
    expect(() => append({ type: 'llm_call' })).not.toThrow();
  });
});
