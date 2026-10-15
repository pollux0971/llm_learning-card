/**
 * 跑完整 Vitest 前後比較 LLM 帳本的行數。帳本是使用者層指標檔指向、經身分標記驗證的那本
 * (T5 / ADR-066;以前是主簽出的 learning/)。
 *
 * `learning/` 是跨簽出共用的使用者資料，測試不應該因為忘了注入
 * 暫存 log 而把事件寫進去。帳本不存在、或帳本位置解析不到時，不能把「沒量到」說成
 * 「行數相同」，因此這支守門輸出第三態 UNKNOWN（而不是 PASS）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defaultVaultDeps, resolveVerifiedLedger, type VaultResolveDeps } from '../packages/core/src/llm/ledger.js';

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

interface LedgerGuardCommon {
  runTests: () => number;
  print?: (line: string) => void;
}

/** `logPath`:要量的帳本;`unresolved`:帳本位置解析不到的原因(T5)——那時只跑測試、回 UNKNOWN。 */
export type LedgerGuardDeps = LedgerGuardCommon & ({ logPath: string } | { unresolved: string });

/**
 * 執行測試並比較帳本。`runTests` 可注入，讓守門本身能測到「故意追加一行」的紅燈。
 */
export function runLedgerGuard(deps: LedgerGuardDeps): number {
  const { runTests, print = console.log } = deps;
  if ('unresolved' in deps) {
    // 不知道帳本在哪,就量不了;不是 PASS(沒量到不能說「行數相同」),也不是新增的紅。
    const testCode = runTests();
    print(`○ 無法判斷(帳本位置解析失敗:${deps.unresolved})`);
    print(`gate=${GATE_NAME} result=UNKNOWN scanned=1`);
    return testCode;
  }
  const { logPath } = deps;
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

/**
 * 要量哪一本帳(T5 / ADR-066):指標檔與身分標記驗證過的那本。解析不到(指標不存在、讀不到、
 * learning_dir 不存在、標記不符)就是 `unresolved`——守門走既有的第三態 UNKNOWN,不拿一個
 * 「剛好不存在」的路徑去量,也不退回任何預設位置。
 */
export type PollutionLedger = { kind: 'resolved'; logPath: string } | { kind: 'unresolved'; reason: string };

export function resolvePollutionLedger(deps: VaultResolveDeps): PollutionLedger {
  const result = resolveVerifiedLedger(deps);
  return result.ok ? { kind: 'resolved', logPath: result.ledger.logPath } : { kind: 'unresolved', reason: result.message };
}

/** 入口層:只有這裡拿真的 process.env / os.homedir()(經 defaultVaultDeps)。 */
function main(): void {
  const root = resolve(import.meta.dirname, '..');
  const ledger = resolvePollutionLedger(defaultVaultDeps());
  const args = process.argv.slice(2);
  const runner = resolve(root, 'scripts/run-tests.ts');
  // 測試要在 runLedgerGuard **裡面**跑:它先量 before、再跑測試、再量 after。
  // (T5 之前這裡先跑完測試才把退出碼交進去,before 量到的已經是測試之後的行數,守門永遠是 PASS。)
  const runTests = (): number => {
    const result = spawnSync('npx', ['tsx', runner, '--', ...args], {
      cwd: root,
      stdio: 'inherit',
    });
    return result.error ? 1 : (result.status ?? 1);
  };
  process.exitCode = runLedgerGuard(
    ledger.kind === 'resolved' ? { logPath: ledger.logPath, runTests } : { unresolved: ledger.reason, runTests },
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
