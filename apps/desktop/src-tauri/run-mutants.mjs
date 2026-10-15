/**
 * cargo-mutants 取跟 Stryker 同一把鎖(T5 起是機器範圍:`$XDG_RUNTIME_DIR/llm-learning-cards/stryker.lock`,
 * 退 `~/.cache/llm-learning-cards/stryker.lock`;路徑由 scripts/mutate.ts 的 defaultLockPath() 算)。
 * 射程:解決變異測試之間的互斥;不解決整條鏈之間的互斥,見另案(T3)。
 * T5 把 strykerLockPath 改成收 { env, homedir } 之後,這裡原本的 strykerLockPath(here) 一跑就丟 TypeError,
 * 鎖根本沒取到;2026-10-15 改成 defaultLockPath()。
 *
 * 並行度(技術顧問 2026-10-15:8 核留一半給別人):
 *   - `MUTANTS_JOBS`:同時測幾個變異體,傳給 `cargo mutants -j`;沒設或空字串 = 2。
 *   - `CARGO_BUILD_JOBS`:每一份編譯用幾個 rustc;子行程沒設(或空字串)就補 2,有設就原樣交給 cargo。
 *   預設 2 份 × 2 個 rustc。只由驗收 / 測試 agent 在拿到重活位子後跑;開發 worker 不跑。
 *
 * 用法(在 repo 根,NODE_OPTIONS=--import=tsx):
 *   node apps/desktop/src-tauri/run-mutants.mjs
 *   MUTANTS_JOBS=1 node apps/desktop/src-tauri/run-mutants.mjs
 */
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, defaultLockPath, ensureLockDir, selfLockInfo } from '../../../scripts/mutate.ts';

const DEFAULT_JOBS = '2';

/** MUTANTS_JOBS:沒設或空字串用預設;設了就必須是正整數,不是就停下,不默默換成別的數字。 */
function jobsFrom(name, value) {
  if (value === undefined || value === '') return DEFAULT_JOBS;
  if (!/^[1-9][0-9]*$/.test(value)) {
    console.error(`${name}=${JSON.stringify(value)} 不是正整數`);
    process.exit(2);
  }
  return value;
}

const mutantsJobs = jobsFrom('MUTANTS_JOBS', process.env.MUTANTS_JOBS);
const env = { ...process.env };
if (env.CARGO_BUILD_JOBS === undefined || env.CARGO_BUILD_JOBS === '') env.CARGO_BUILD_JOBS = DEFAULT_JOBS;

const here = dirname(fileURLToPath(import.meta.url));
const lockPath = defaultLockPath();
ensureLockDir(lockPath);
const lock = await acquireLock(lockPath, { info: selfLockInfo(here) });
console.log(`acquired ${lock.lockPath}`);
console.log(`cargo mutants -j ${mutantsJobs}, CARGO_BUILD_JOBS=${env.CARGO_BUILD_JOBS}`);
const child = spawn(
  'cargo',
  ['mutants', '-j', mutantsJobs, '-t', '120', '-v'],
  { cwd: here, stdio: 'inherit', env },
);
const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
lock.release();
process.exit(code);
