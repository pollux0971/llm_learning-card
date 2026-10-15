/**
 * T7 驗收補測(測試 agent):寫入內容那一步(writeSync)本身失敗時的保證。
 *
 * T7 刪掉 lint/atomic-write.test.ts 時,「write 炸掉:沒有舊檔時也不會憑空出現半個正式檔」
 * 這條沒有在 writeFileAtomic 這邊接住。實測:把 writeSync 的錯誤吞掉,382 個測試仍全綠,
 * 而那會把空的或半個內容 rename 成正式檔。這裡把它補回來。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileAtomic } from './atomic-write.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeSync: vi.fn(actual.writeSync),
  };
});

let dir: string;

afterEach(() => {
  vi.mocked(writeSync).mockReset();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function ioError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: injected`), { code, syscall: 'write' });
}

/** 讓下一次 writeSync 丟錯,之後的呼叫回到真的實作。 */
async function failNextWrite(code: string): Promise<NodeJS.ErrnoException> {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const err = ioError(code);
  vi.mocked(writeSync).mockImplementationOnce(() => {
    throw err;
  });
  vi.mocked(writeSync).mockImplementation(actual.writeSync as typeof writeSync);
  return err;
}

describe('writeFileAtomic · 寫內容失敗(writeSync 丟錯)', () => {
  it('沒有舊檔:丟出原本那個錯,目標檔不會憑空出現,tmp 也不留', async () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-atomic-wfail-'));
    const target = join(dir, 'reviews.json');
    const err = await failNextWrite('EIO');

    expect(() => writeFileAtomic(target, '{"a":1}\n')).toThrow(err);

    expect(existsSync(target)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('有舊檔:舊檔位元組完全不動,tmp 被清掉', async () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-atomic-wfail-'));
    const target = join(dir, 'reviews.json');
    writeFileSync(target, 'old bytes that must survive');
    const err = await failNextWrite('ENOSPC');

    expect(() => writeFileAtomic(target, 'new content')).toThrow(err);

    expect(readFileSync(target, 'utf8')).toBe('old bytes that must survive');
    expect(readdirSync(dir)).toEqual(['reviews.json']);
  });

  it('失敗之後下一次寫入照常成功(不被上一次的殘檔卡住)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-atomic-wfail-'));
    const target = join(dir, 'reviews.json');
    const err = await failNextWrite('EIO');
    expect(() => writeFileAtomic(target, 'first')).toThrow(err);

    writeFileAtomic(target, 'second');

    expect(readFileSync(target, 'utf8')).toBe('second');
    expect(readdirSync(dir)).toEqual(['reviews.json']);
  });
});
