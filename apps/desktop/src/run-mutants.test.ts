/**
 * 冒煙測試:apps/desktop/src-tauri/run-mutants.mjs(cargo-mutants 的包裝)。測試 agent 寫。
 *
 * 為什麼要有:T5 把 `strykerLockPath` 的簽章改成收 `{ env, homedir }`,這支 .mjs 還在傳字串,
 * 一跑就 `TypeError: Cannot read properties of undefined (reading 'XDG_RUNTIME_DIR')`,鎖根本沒取到。
 * .mjs 不經過 tsc,也沒有任何測試跑它,所以沒被抓到。
 *
 * 做法:PATH 前面放一支假 cargo(shell 腳本,只記下「收到什麼」),真的跑 run-mutants.mjs。
 * 所有目錄(XDG_RUNTIME_DIR、HOME、假 cargo、紀錄檔)都來自 mkdtemp;不碰真的鎖,不跑真的 cargo。
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO = resolve(import.meta.dirname, '../../..');
const SCRIPT = join(REPO, 'apps/desktop/src-tauri/run-mutants.mjs');
const SPAWN_TIMEOUT_MS = 60_000;

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

interface Box {
  root: string;
  bin: string;
  runtime: string;
  home: string;
  log: string;
}

/** 假 cargo:把引數、CARGO_BUILD_JOBS、「鎖檔此刻在不在」記下來,然後用 FAKE_CARGO_EXIT 當退出碼。 */
function box(): Box {
  const root = mkdtempSync(join(tmpdir(), 'run-mutants-smoke-'));
  roots.push(root);
  const bin = join(root, 'bin');
  const runtime = join(root, 'runtime');
  const home = join(root, 'home');
  const log = join(root, 'log');
  for (const d of [bin, runtime, home, log]) mkdirSync(d, { recursive: true });
  const cargo = [
    '#!/bin/sh',
    `printf '%s\\n' "$@" > "${log}/args.txt"`,
    `printf '%s' "\${CARGO_BUILD_JOBS-UNSET}" > "${log}/cargo-build-jobs.txt"`,
    `pwd > "${log}/cwd.txt"`,
    `if [ -e "$XDG_RUNTIME_DIR/llm-learning-cards/stryker.lock" ]; then echo held > "${log}/lock-during.txt"; else echo absent > "${log}/lock-during.txt"; fi`,
    'exit "${FAKE_CARGO_EXIT:-0}"',
    '',
  ].join('\n');
  writeFileSync(join(bin, 'cargo'), cargo);
  chmodSync(join(bin, 'cargo'), 0o755);
  return { root, bin, runtime, home, log };
}

function run(b: Box, extraEnv: Record<string, string | undefined> = {}): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    PATH: `${b.bin}:${process.env.PATH ?? ''}`,
    HOME: b.home,
    XDG_RUNTIME_DIR: b.runtime,
    XDG_CONFIG_HOME: join(b.root, 'xdg-config'),
    NODE_OPTIONS: '--import=tsx',
  };
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: 'utf8', env, timeout: SPAWN_TIMEOUT_MS });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function logged(b: Box, name: string): string | undefined {
  const p = join(b.log, name);
  return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
}

const LOCK_PATH = (b: Box): string => join(b.runtime, 'llm-learning-cards', 'stryker.lock');

describe('run-mutants.mjs 冒煙(假 cargo)', () => {
  it('(1) 不丟錯:退出碼 0、stderr 沒有 TypeError', () => {
    const b = box();
    const r = run(b);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stderr).not.toMatch(/TypeError|reading 'XDG_RUNTIME_DIR'/);
  }, SPAWN_TIMEOUT_MS);

  it('(2) 取的是機器範圍的鎖(defaultLockPath):路徑在 XDG_RUNTIME_DIR/llm-learning-cards/stryker.lock;cargo 執行時鎖在手上;跑完鎖已放掉', () => {
    const b = box();
    const r = run(b);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain(`acquired ${LOCK_PATH(b)}`);
    expect(logged(b, 'lock-during.txt')?.trim()).toBe('held');
    expect(existsSync(LOCK_PATH(b))).toBe(false);
  }, SPAWN_TIMEOUT_MS);

  it('(2b) 沒有 XDG_RUNTIME_DIR 時退到 ~/.cache/llm-learning-cards/stryker.lock(HOME 在沙箱)', () => {
    const b = box();
    const r = run(b, { XDG_RUNTIME_DIR: undefined });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain(`acquired ${join(b.home, '.cache', 'llm-learning-cards', 'stryker.lock')}`);
    expect(existsSync(join(b.home, '.cache', 'llm-learning-cards', 'stryker.lock'))).toBe(false);
  }, SPAWN_TIMEOUT_MS);

  it('(3) 預設:cargo 收到 `mutants -j 2 -t 120 -v`,環境裡 CARGO_BUILD_JOBS=2,工作目錄是 src-tauri', () => {
    const b = box();
    const r = run(b);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(logged(b, 'args.txt')?.split('\n').filter(Boolean)).toEqual(['mutants', '-j', '2', '-t', '120', '-v']);
    expect(logged(b, 'cargo-build-jobs.txt')).toBe('2');
    expect(logged(b, 'cwd.txt')?.trim()).toBe(join(REPO, 'apps/desktop/src-tauri'));
    expect(r.stdout).toContain('cargo mutants -j 2, CARGO_BUILD_JOBS=2');
  }, SPAWN_TIMEOUT_MS);

  it.each(['1', '3', '8'])('(3) MUTANTS_JOBS=%s → cargo 收到 `-j %s`', (n) => {
    const b = box();
    const r = run(b, { MUTANTS_JOBS: n });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(logged(b, 'args.txt')?.split('\n').filter(Boolean)).toEqual(['mutants', '-j', n, '-t', '120', '-v']);
    expect(logged(b, 'cargo-build-jobs.txt')).toBe('2');
  }, SPAWN_TIMEOUT_MS);

  it('(3) MUTANTS_JOBS 設成空字串 = 預設 2', () => {
    const b = box();
    const r = run(b, { MUTANTS_JOBS: '' });
    expect(r.status).toBe(0);
    expect(logged(b, 'args.txt')?.split('\n')[2]).toBe('2');
  }, SPAWN_TIMEOUT_MS);

  it('(3) 呼叫端已經設了 CARGO_BUILD_JOBS 就原樣交給 cargo(設 4 → 4);設成空字串則補 2', () => {
    const b1 = box();
    expect(run(b1, { CARGO_BUILD_JOBS: '4' }).status).toBe(0);
    expect(logged(b1, 'cargo-build-jobs.txt')).toBe('4');
    const b2 = box();
    expect(run(b2, { CARGO_BUILD_JOBS: '' }).status).toBe(0);
    expect(logged(b2, 'cargo-build-jobs.txt')).toBe('2');
  }, SPAWN_TIMEOUT_MS);

  it.each([['0'], ['two'], ['-1'], ['1.5'], [' 2']])('(3) MUTANTS_JOBS=%j 不是正整數 → exit 2、訊息點出變數名、cargo 沒被呼叫、沒有取鎖', (bad) => {
    const b = box();
    const r = run(b, { MUTANTS_JOBS: bad });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('MUTANTS_JOBS');
    expect(logged(b, 'args.txt')).toBeUndefined();
    expect(existsSync(join(b.runtime, 'llm-learning-cards'))).toBe(false); // 連鎖目錄都沒建 = 沒走到取鎖
    expect(r.stdout).not.toContain('acquired');
  }, SPAWN_TIMEOUT_MS);

  it('cargo 的退出碼原樣傳出去(7 → 7),而且失敗時鎖也放掉', () => {
    const b = box();
    const r = run(b, { FAKE_CARGO_EXIT: '7' });
    expect(r.status).toBe(7);
    expect(existsSync(LOCK_PATH(b))).toBe(false);
  }, SPAWN_TIMEOUT_MS);
});
