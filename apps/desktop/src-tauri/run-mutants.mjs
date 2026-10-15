/**
 * cargo-mutants 取 Stryker 的同一把機器鎖(scripts/mutate.ts 的 defaultLockPath)。
 * 射程:解決變異測試之間的互斥;不解決整條鏈之間的互斥,見另案(T3)。
 *
 * 用法(在 repo 根,NODE_OPTIONS=--import=tsx):
 *   node apps/desktop/src-tauri/run-mutants.mjs [cargo mutants 的其他參數,例如 -o <輸出目錄>]
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, defaultLockPath, ensureLockDir, selfLockInfo } from '../../../scripts/mutate.ts';

const here = dirname(fileURLToPath(import.meta.url));
// T5 之後鎖是機器範圍的 `$XDG_RUNTIME_DIR/llm-learning-cards/stryker.lock`(defaultLockPath),
// 跟 scripts/mutate.ts 的 Stryker 同一把;鎖目錄建不出來就拒絕開始跑。
const lockPath = defaultLockPath();
ensureLockDir(lockPath);
const lock = await acquireLock(lockPath, { info: selfLockInfo(here, new Date().toISOString(), 'stryker') });
console.log(`acquired ${lock.lockPath}`);
const child = spawn(
  'cargo',
  ['mutants', '-j', '4', '-t', '120', '-v', ...process.argv.slice(2)],
  { cwd: here, stdio: 'inherit' },
);
const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
lock.release();
process.exit(code);
