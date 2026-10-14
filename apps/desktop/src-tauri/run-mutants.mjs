/**
 * cargo-mutants 取 .stryker.lock。
 * 射程:解決變異測試之間的互斥;不解決整條鏈之間的互斥,見另案(T3)。
 *
 * 用法(在 repo 根,NODE_OPTIONS=--import=tsx):
 *   node apps/desktop/src-tauri/run-mutants.mjs
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, selfLockInfo, strykerLockPath } from '../../../scripts/mutate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const lock = await acquireLock(strykerLockPath(here), { info: selfLockInfo(here) });
console.log(`acquired ${lock.lockPath}`);
const child = spawn(
  'cargo',
  ['mutants', '-j', '4', '-t', '120', '-v'],
  { cwd: here, stdio: 'inherit' },
);
const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
lock.release();
process.exit(code);
