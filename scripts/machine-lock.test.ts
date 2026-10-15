/**
 * T5 第 11–14 條:鎖改成機器範圍。路徑函式注入 env / homedir,不碰真的 XDG_RUNTIME_DIR;
 * 鎖目錄建不出來或寫不進去 = 拒絕開始跑(不是沒鎖繼續跑);主簽出 / worktree / clone 看到同一把鎖。
 *
 * 隔離:HOME / XDG_CONFIG_HOME / XDG_RUNTIME_DIR 指到 mkdtemp,結束時還原;spawn 的子程序也只拿沙箱的值。
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ensureLockDir, runMutate, strykerLockPath, tryAcquire } from './mutate.js';
import { runTests } from './run-tests.js';

const ENV_KEYS = ['HOME', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR'] as const;
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;
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

function sandbox(): { root: string; home: string; config: string; runtime: string } {
  const root = mkdtempSync(join(tmpdir(), 't5-lock-'));
  sandboxes.push(root);
  const home = join(root, 'home');
  const config = join(root, 'xdg-config');
  const runtime = join(root, 'runtime');
  mkdirSync(home, { recursive: true });
  mkdirSync(config, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = config;
  process.env.XDG_RUNTIME_DIR = runtime;
  return { root, home, config, runtime };
}

afterAll(() => {
  for (const k of ENV_KEYS) {
    const v = SAVED_ENV[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const dir of sandboxes) {
    // 「寫不進去」那條把目錄改成唯讀;還原權限才刪得掉。目標一律是 mkdtemp 的回傳值。
    spawnSync('chmod', ['-R', 'u+rwx', dir]);
    rmSync(dir, { recursive: true, force: true });
  }
  expect(snapshotRealPointer()).toEqual(realPointerBefore);
});

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失敗:${result.stderr ?? ''}`);
}

describe('strykerLockPath(第 11、12 條)', () => {
  it('XDG_RUNTIME_DIR 設了就用機器範圍路徑', () => {
    const box = sandbox();
    expect(strykerLockPath({ env: { XDG_RUNTIME_DIR: box.runtime }, homedir: () => box.home })).toBe(
      join(box.runtime, 'llm-learning-cards', 'stryker.lock'),
    );
  });

  it('XDG_RUNTIME_DIR 未設或空字串 → ~/.cache/llm-learning-cards/stryker.lock(homedir 是注入的)', () => {
    const box = sandbox();
    const expected = join(box.home, '.cache', 'llm-learning-cards', 'stryker.lock');
    expect(strykerLockPath({ env: {}, homedir: () => box.home })).toBe(expected);
    expect(strykerLockPath({ env: { XDG_RUNTIME_DIR: '' }, homedir: () => box.home })).toBe(expected);
  });

  it('只看注入的 env:process.env 與 cwd 不同也不影響', () => {
    const box = sandbox();
    const other = join(box.root, 'other-runtime');
    process.env.XDG_RUNTIME_DIR = other;
    expect(strykerLockPath({ env: { XDG_RUNTIME_DIR: box.runtime }, homedir: () => box.home })).toBe(
      join(box.runtime, 'llm-learning-cards', 'stryker.lock'),
    );
  });
});

describe('ensureLockDir(第 11 條)', () => {
  it('目錄不存在就建,權限 0700', () => {
    const box = sandbox();
    const lockPath = join(box.runtime, 'llm-learning-cards', 'stryker.lock');
    ensureLockDir(lockPath);
    const mode = statSync(join(box.runtime, 'llm-learning-cards')).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('XDG_RUNTIME_DIR 沒設時連 ~/.cache 一起建出來', () => {
    const box = sandbox();
    const lockPath = strykerLockPath({ env: {}, homedir: () => box.home });
    ensureLockDir(lockPath);
    expect(statSync(join(box.home, '.cache', 'llm-learning-cards')).isDirectory()).toBe(true);
  });

  it('建不出來就丟錯,不是安靜繼續', () => {
    const box = sandbox();
    const file = join(box.root, 'a-file');
    writeFileSync(file, '');
    expect(() => ensureLockDir(join(file, 'llm-learning-cards', 'stryker.lock'))).toThrow(/鎖目錄/);
  });

  it('目錄在、但寫不進去也丟錯', () => {
    const box = sandbox();
    const dir = join(box.runtime, 'llm-learning-cards');
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o500);
    expect(() => ensureLockDir(join(dir, 'stryker.lock'))).toThrow(/鎖目錄/);
  });
});

describe('鎖目錄建不出來 / 寫不進去 = 拒絕開始跑(第 11 條)', () => {
  function unwritableLockPath(): string {
    const box = sandbox();
    const dir = join(box.runtime, 'llm-learning-cards');
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o500);
    return join(dir, 'stryker.lock');
  }

  function uncreatableLockPath(): string {
    const box = sandbox();
    const file = join(box.root, 'a-file');
    writeFileSync(file, '');
    return join(file, 'llm-learning-cards', 'stryker.lock');
  }

  for (const [label, makePath] of [
    ['建不出來', uncreatableLockPath],
    ['寫不進去', unwritableLockPath],
  ] as const) {
    it(`runMutate:${label}時回 1,Stryker 一次都沒跑`, async () => {
      const lockPath = makePath();
      let strykerRuns = 0;
      const logs: string[] = [];
      const code = await runMutate({
        argv: ['node', 'mutate.ts'],
        lockPath,
        runStryker: async () => {
          strykerRuns += 1;
          return 0;
        },
        installCleanup: () => () => {},
        log: (msg) => logs.push(msg),
      });
      expect(code).toBe(1);
      expect(strykerRuns).toBe(0);
      expect(logs.join('\n')).toMatch(/鎖目錄/);
      expect(existsSync(lockPath)).toBe(false);
    });

    it(`runTests(全套):${label}時回 1,vitest 一次都沒跑`, async () => {
      const lockPath = makePath();
      let vitestRuns = 0;
      const logs: string[] = [];
      const code = await runTests({
        argv: ['node', 'run-tests.ts'],
        lockPath,
        runVitest: async () => {
          vitestRuns += 1;
          return 0;
        },
        installCleanup: () => () => {},
        log: (msg) => logs.push(msg),
      });
      expect(code).toBe(1);
      expect(vitestRuns).toBe(0);
      expect(logs.join('\n')).toMatch(/鎖目錄/);
      expect(existsSync(lockPath)).toBe(false);
    });
  }
});

describe('must_catch: 鎖路徑退回每個 clone 一把(第 14 條)', () => {
  it('合成主簽出持鎖時,worktree 與另一個 clone 起的程序都看得到同一把鎖', async () => {
    const box = sandbox();
    const main = join(box.root, 'main');
    const worktree = join(box.root, 'worktree');
    const clone = join(box.root, 'clone');
    mkdirSync(main, { recursive: true });
    git(main, ['init', '-q', '-b', 'main', '.']);
    git(main, ['commit', '-q', '--allow-empty', '-m', 'init']);
    git(main, ['worktree', 'add', '-q', '-b', 'wt', worktree]);
    git(box.root, ['clone', '-q', main, clone]);
    for (const checkout of [main, worktree, clone]) symlinkSync(join(REPO, 'node_modules'), join(checkout, 'node_modules'));

    // 程序用的是正式的預設路徑(defaultLockPath = strykerLockPath(process.env, os.homedir)),
    // 不是測試自己算的路徑:舊實作(git-common-dir)在 clone 裡會算出 clone 自己的一把。
    const runner = join(box.root, 'hold-lock.mts');
    writeFileSync(
      runner,
      [
        'import { defaultLockPath, ensureLockDir, tryAcquire } from ' + JSON.stringify(join(REPO, 'scripts/mutate.ts')) + ';',
        'const path = defaultLockPath();',
        'ensureLockDir(path);',
        "const info = { pid: process.pid, cwd: process.cwd(), startedAt: new Date().toISOString(), task: 'test' as const };",
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
      XDG_CONFIG_HOME: box.config,
      XDG_RUNTIME_DIR: box.runtime,
    };
    const hold = spawn(process.execPath, ['--import=tsx', runner, 'hold'], { cwd: main, env });
    let acquired = '';
    let holderErr = '';
    hold.stdout?.setEncoding('utf8');
    hold.stderr?.setEncoding('utf8');
    hold.stderr?.on('data', (chunk: string) => {
      holderErr += chunk;
    });
    try {
      await new Promise<void>((resolvePromise, reject) => {
        const timer = setTimeout(() => reject(new Error(`holder did not acquire: ${acquired}\n${holderErr}`)), 30_000);
        hold.stdout?.on('data', (chunk: string) => {
          acquired += chunk;
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

      const lock = join(box.runtime, 'llm-learning-cards', 'stryker.lock');
      expect(acquired).toContain(lock);
      for (const checkout of [worktree, clone]) {
        const second = spawnSync(process.execPath, ['--import=tsx', runner, 'look'], {
          cwd: checkout,
          env,
          encoding: 'utf8',
          timeout: 30_000,
        });
        expect(second.status, `${checkout}\n${second.stdout ?? ''}\n${second.stderr ?? ''}`).toBe(0);
        expect(second.stdout).toContain(`SEEN ${lock}`);
      }
    } finally {
      hold.kill('SIGTERM');
    }
  }, 90_000);
});
