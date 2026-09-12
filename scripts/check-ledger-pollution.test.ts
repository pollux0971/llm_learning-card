import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countLedgerLines, runLedgerGuard } from './check-ledger-pollution.js';

const dirs: string[] = [];

function tempLedger(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-pollution-'));
  dirs.push(dir);
  const path = join(dir, 'log.jsonl');
  writeFileSync(path, contents, 'utf8');
  return path;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('countLedgerLines', () => {
  it('不存在時回 undefined，不把未知當成 0 行', () => {
    expect(countLedgerLines(join(tmpdir(), 'ledger-pollution-does-not-exist', 'log.jsonl'))).toBeUndefined();
  });

  it('空檔是可判斷的 0 行', () => {
    expect(countLedgerLines(tempLedger(''))).toBe(0);
  });

  it('計算 JSONL 的實際非空行數', () => {
    expect(countLedgerLines(tempLedger('{"a":1}\n{"a":2}\n'))).toBe(2);
  });
});

describe('runLedgerGuard', () => {
  it('行數相同時 PASS', () => {
    const output: string[] = [];
    const result = runLedgerGuard({ logPath: tempLedger('{"a":1}\n'), runTests: () => 0, print: (line) => output.push(line) });
    expect(result).toBe(0);
    expect(output).toEqual(['✓ 帳本行數相同:1', 'gate=ledger-pollution result=PASS scanned=1']);
  });

  it('故意讓測試追加一行時會紅——守門確實接上', () => {
    const path = tempLedger('{"a":1}\n');
    const output: string[] = [];
    const result = runLedgerGuard({
      logPath: path,
      runTests: () => {
        appendFileSync(path, '{"a":2}\n', 'utf8');
        return 0;
      },
      print: (line) => output.push(line),
    });
    expect(result).toBe(1);
    expect(output).toEqual([
      `✗ 帳本行數改變:before=1 after=2 path=${path}`,
      'gate=ledger-pollution result=FAIL scanned=1',
    ]);
  });

  it('帳本不存在時是 UNKNOWN，不印 PASS，且測試本身仍可成功', () => {
    const output: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'ledger-pollution-missing-'));
    dirs.push(dir);
    const path = join(dir, 'log.jsonl');
    const result = runLedgerGuard({ logPath: path, runTests: () => 0, print: (line) => output.push(line) });
    expect(result).toBe(0);
    expect(output[0]).toContain('○ 無法判斷');
    expect(output[1]).toBe('gate=ledger-pollution result=UNKNOWN scanned=1');
    expect(output.join('\n')).not.toContain('PASS');
  });
});
