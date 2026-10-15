/**
 * T7 驗收補測(測試 agent):appendLineAtomic 的原子性靠「整行(含結尾換行)只用一次 writeSync 寫出」。
 * O_APPEND 下單一 write() 才不會被另一個行程的寫入切開(函式註解與契約 §11b 對 log 的要求)。
 * 先前沒有任何測試鎖這件事:把它拆成兩次 writeSync,41 個測試仍然全綠。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendLineAtomic } from './atomic-write.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeSync: vi.fn(actual.writeSync),
  };
});

let dir: string;

afterEach(() => {
  vi.mocked(writeSync).mockClear();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** writeSync 收到的內容轉成字串(實作傳字串或 Buffer 都算同一種) */
function writtenTexts(): string[] {
  return vi.mocked(writeSync).mock.calls.map((call) => String(call[1]));
}

describe('appendLineAtomic · 整行只用一次 writeSync', () => {
  it('一行沒有結尾換行:一次 writeSync 寫出「行 + 換行」', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-append-once-'));
    const target = join(dir, 'log.jsonl');

    appendLineAtomic(target, '{"n":1}');

    expect(writtenTexts()).toEqual(['{"n":1}\n']);
    expect(readFileSync(target, 'utf8')).toBe('{"n":1}\n');
  });

  it('一行已經有結尾換行:一次 writeSync,不補第二個換行', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-append-once-'));
    const target = join(dir, 'log.jsonl');

    appendLineAtomic(target, '{"n":2}\n');

    expect(writtenTexts()).toEqual(['{"n":2}\n']);
    expect(readFileSync(target, 'utf8')).toBe('{"n":2}\n');
  });

  it('長一點的一行(超過 2000 位元組)也是一次 writeSync,內容完整', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-append-once-'));
    const target = join(dir, 'log.jsonl');
    const line = JSON.stringify({ ts: '2026-10-15T00:00:00Z', type: 'learned', note: 'x'.repeat(2500) });

    appendLineAtomic(target, line);

    expect(vi.mocked(writeSync)).toHaveBeenCalledTimes(1);
    expect(writtenTexts()).toEqual([`${line}\n`]);
    expect(readFileSync(target, 'utf8')).toBe(`${line}\n`);
  });

  it('連續兩次 append、檔案已有內容:每次各一次 writeSync,舊行不動', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-append-once-'));
    const target = join(dir, 'log.jsonl');
    writeFileSync(target, '{"n":0}\n');
    vi.mocked(writeSync).mockClear();

    appendLineAtomic(target, '{"n":1}');
    appendLineAtomic(target, '{"n":2}');

    expect(writtenTexts()).toEqual(['{"n":1}\n', '{"n":2}\n']);
    expect(readFileSync(target, 'utf8')).toBe('{"n":0}\n{"n":1}\n{"n":2}\n');
  });
});
