/**
 * 跑完整 Vitest 前後比較主簽出的 LLM 帳本行數。
 *
 * `learning/` 是跨 worktree 共用的使用者資料，測試不應該因為忘了注入
 * 暫存 log 而把事件寫進去。帳本不存在時不能把「沒量到」說成「行數相同」，
 * 因此這支守門輸出第三態 UNKNOWN（而不是 PASS）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { resolveVaultLearningDir } from '../packages/core/src/llm/vault.js';

export const GATE_NAME = 'ledger-pollution';

/** `undefined` 代表不存在或無法讀取，不能冒充 0 行。 */
export function countLedgerLines(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const content = readFileSync(path, 'utf8');
    if (content.length === 0) return 0;
    const lines = content.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    return lines.length;
  } catch {
    return undefined;
  }
}

export interface LedgerGuardDeps {
  logPath: string;
  runTests: () => number;
  print?: (line: string) => void;
}

/**
 * 執行測試並比較帳本。`runTests` 可注入，讓守門本身能測到「故意追加一行」的紅燈。
 */
export function runLedgerGuard({ logPath, runTests, print = console.log }: LedgerGuardDeps): number {
  const before = countLedgerLines(logPath);
  const testCode = runTests();
  const after = countLedgerLines(logPath);

  if (before === undefined) {
    print(`○ 無法判斷(帳本不存在或無法讀取:${logPath})`);
    print(`gate=${GATE_NAME} result=UNKNOWN scanned=1`);
    return testCode;
  }

  if (after === undefined) {
    print(`✗ 帳本在測試後不存在或無法讀取:${logPath}`);
    print(`gate=${GATE_NAME} result=FAIL scanned=1`);
    return testCode === 0 ? 1 : testCode;
  }

  if (before !== after) {
    print(`✗ 帳本行數改變:before=${before} after=${after} path=${logPath}`);
    print(`gate=${GATE_NAME} result=FAIL scanned=1`);
    return testCode === 0 ? 1 : testCode;
  }

  if (testCode !== 0) {
    print(`✗ 測試失敗(帳本行數未變: ${before})`);
    print(`gate=${GATE_NAME} result=FAIL scanned=1`);
    return testCode;
  }

  print(`✓ 帳本行數相同:${before}`);
  print(`gate=${GATE_NAME} result=PASS scanned=1`);
  return 0;
}

function main(): void {
  const root = resolve(import.meta.dirname, '..');
  const logPath = join(resolveVaultLearningDir(root), 'state/log.jsonl');
  const args = process.argv.slice(2);
  const runner = resolve(root, 'scripts/run-tests.ts');
  const result = spawnSync('npx', ['tsx', runner, '--', ...args], {
    cwd: root,
    stdio: 'inherit',
  });
  const testCode = result.error ? 1 : (result.status ?? 1);
  process.exitCode = runLedgerGuard({ logPath, runTests: () => testCode });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
