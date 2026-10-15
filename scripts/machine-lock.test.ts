/**
 * T5:鎖改成機器範圍。路徑函式注入 env / homedir,不碰真的 XDG_RUNTIME_DIR。
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ensureLockDir, strykerLockPath, tryAcquire } from './mutate.js';

const REAL_HOME = homedir();
const REAL_XDG = process.env.XDG_CONFIG_HOME;
const REPO = join(import.meta.dirname, '..');

function realPointerPath(): string {
  const base = REAL_XDG !== undefined && REAL_XDG !== '' ? REAL_XDG : join(REAL_HOME, '.config');
  return join(base, 'llm-learning-cards', 'vault.json');
}

function snapshotRealPointer(): { exists: boolean; mtimeMs: number | null } {
  try {
    const st = statSync(realPointerPath());
    return { exists: true, mtimeMs: st.mtimeMs };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, mtimeMs: null };
    throw err;
  }
}

const realPointerBefore = snapshotRealPointer();
const sandboxes: string[] = [];

function sandbox(): { root: string; home: string; runtime: string } {
  const root = mkdtempSync(join(tmpdir(), 't5-lock-'));
  sandboxes.push(root);
  const home = join(root, 'home');
  const runtime = join(root, 'runtime');
  mkdirSync(home, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(root, 'xdg-config');
  process.env.XDG_RUNTIME_DIR = runtime;
  mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true });
  return { root, home, runtime };
}

afterAll(() => {
  expect(snapshotRealPointer()).toEqual(realPointerBefore);
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失敗:${result.stderr ?? ''}`);
}

describe('strykerLockPath', () => {
  it('XDG_RUNTIME_DIR 設了就用機器範圍路徑', () => {
    const box = sandbox();
    expect(strykerLockPath({ env: { XDG_RUNTIME_DIR: box.runtime }, homedir: () => box.home })).toBe(
      join(box.runtime, 'llm-learning-cards', 'stryker.lock'),
    );
  });

  it('XDG_RUNTIME_DIR 未設或空字串 → ~/.cache/llm-learning-cards/stryker.lock', () => {
    const box = sandbox();
    const expected = join(box.home, '.cache', 'llm-learning-cards', 'stryker.lock');
    expect(strykerLockPath({ env: {}, homedir: () => box.home })).toBe(expected);
    expect(strykerLockPath({ env: { XDG_RUNTIME_DIR: '' }, homedir: () => box.home })).toBe(expected);
  });

  it('路徑不看 cwd,所以 clone 與 worktree 算出同一把', () => {
    const box = sandbox();
    const env = { XDG_RUNTIME_DIR: box.runtime };
    const homedirFn = () => box.home;
    expect(strykerLockPath({ env, homedir: homedirFn })).toBe(strykerLockPath({ env, homedir: homedirFn }));
  });
});

describe('ensureLockDir', () => {
  it('目錄不存在就建,權限 0700', () => {
    const box = sandbox();
    const lockPath = join(box.runtime, 'llm-learning-cards', 'stryker.lock');
    ensureLockDir(lockPath);
    const mode = statSync(join(box.runtime, 'llm-learning-cards')).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('建不出來就丟錯,不是安靜繼續', () => {
    const box = sandbox();
    expect(() =>
      ensureLockDir(join(box.root, 'nope', 'stryker.lock'), {
        mkdirSync: () => {
          throw new Error('mkdir refused');
        },
        chmodSync: () => {},
        accessSync: () => {},
      }),
    ).toThrow(/mkdir refused/);
  });
});

describe('must_catch: 鎖路徑不得退回每個 clone 一把', () => {
  it('合成主簽出、worktree、clone 的第二個程序看得到第一個的鎖', async () => {
    const box = sandbox();
    const main = join(box.root, 'main');
    const worktree = join(box.root, 'worktree');
    const clone = join(box.root, 'clone');
    mkdirSync(main, { recursive: true });
    git(main, ['init', '-q', '-b', 'main', '.']);
    git(main, ['commit', '-q', '--allow-empty', '-m', 'init']);
    git(main, ['worktree', 'add', '-q', '-b', 'wt', worktree]);
    git(box.root, ['clone', '-q', main, clone]);
    symlinkSync(join(REPO, 'node_modules'), join(main, 'node_modules'));
    symlinkSync(join(REPO, 'node_modules'), join(worktree, 'node_modules'));
    symlinkSync(join(REPO, 'node_modules'), join(clone, 'node_modules'));

    const runner = join(box.root, 'hold-lock.ts');
    writeFileSync(
      runner,
      [
        'import { ensureLockDir, strykerLockPath, tryAcquire } from ' + JSON.stringify(join(REPO, 'scripts/mutate.ts')) + ';',
        'const path = strykerLockPath({ env: process.env, homedir: () => process.env.HOME ?? "" });',
        'ensureLockDir(path);',
        'const info = { pid: process.pid, cwd: process.cwd(), startedAt: new Date().toISOString(), task: "test" as const };',
        'const ok = tryAcquire(path, info);',
        "if (process.argv[2] === 'hold') {",
        "  if (!ok) { console.error('first should acquire'); process.exit(3); }",
        "  console.log('ACQUIRED ' + path);",
        '  setInterval(() => {}, 1000);',
        '} else {',
        "  console.log((ok ? 'ACQUIRED ' : 'SEEN ') + path);",
        '  process.exit(ok ? 4 : 0);',
        '}',
        '',
      ].join('\n'),
    );

    const env = {
      PATH: process.env.PATH ?? '',
      HOME: box.home,
      XDG_CONFIG_HOME: join(box.root, 'xdg-config'),
      XDG_RUNTIME_DIR: box.runtime,
    };
    const hold = spawn(process.execPath, ['--import=tsx', runner, 'hold'], { cwd: main, env });
    let acquired = '';
    let holderErr = '';
    hold.stdout?.setEncoding('utf8');
    hold.stderr?.setEncoding('utf8');
    hold.stdout?.on('data', (chunk: string) => {
      acquired += chunk;
    });
    hold.stderr?.on('data', (chunk: string) => {
      holderErr += chunk;
    });
    const ready = await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`holder did not acquire: ${acquired}\n${holderErr}`)), 20_000);
      hold.stdout?.on('data', () => {
        if (acquired.includes('ACQUIRED')) {
          clearTimeout(timer);
          resolvePromise();
        }
      });
      hold.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`holder exited ${code} before acquire: ${acquired}\n${holderErr}`));
      });
    });
    expect(ready).toBeUndefined();

    const second = spawnSync(process.execPath, ['--import=tsx', runner, 'look'], {
      cwd: clone,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    });
    hold.kill('SIGTERM');
    expect(second.status, `${second.stdout ?? ''}\n${second.stderr ?? ''}`).toBe(0);
    expect(second.stdout).toContain('SEEN');
    expect(second.stdout).toContain(join(box.runtime, 'llm-learning-cards', 'stryker.lock'));
  }, 60_000);
});
