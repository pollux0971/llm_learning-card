/**
 * T5 驗收 16、17:三個簽出寫進同一本帳本;沒有指標時真呼叫拒絕且不建檔。
 * 子程序的 HOME / XDG 只指向 mkdtemp。不讀真指標檔內容。
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../../..');
const REAL_HOME = homedir();
const REAL_XDG = process.env.XDG_CONFIG_HOME;

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

afterAll(() => {
  expect(snapshotRealPointer()).toEqual(realPointerBefore);
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', timeout: 60_000 },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失敗:${result.stderr ?? ''}`);
}

function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      out.push(abs.slice(root.length + 1));
      if (statSync(abs).isDirectory()) walk(abs);
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

function childEnv(box: { home: string; config: string; runtime: string }, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    HOME: box.home,
    XDG_CONFIG_HOME: box.config,
    XDG_RUNTIME_DIR: box.runtime,
    ...extra,
  };
}

function makeCheckout(sandbox: string): { main: string; worktree: string; clone: string } {
  const main = join(sandbox, 'main');
  const worktree = join(sandbox, 'worktree');
  const clone = join(sandbox, 'clone');
  mkdirSync(main, { recursive: true });
  cpSync(join(ROOT, 'packages'), join(main, 'packages'), { recursive: true });
  cpSync(join(ROOT, 'contracts'), join(main, 'contracts'), { recursive: true });
  cpSync(join(ROOT, 'scripts'), join(main, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'tsconfig.json'), join(main, 'tsconfig.json'));
  cpSync(join(ROOT, 'package.json'), join(main, 'package.json'));
  git(main, ['init', '-q', '-b', 'main', '.']);
  git(main, ['add', 'packages', 'contracts', 'scripts', 'tsconfig.json', 'package.json']);
  git(main, ['commit', '-q', '-m', 'synthetic source']);
  git(main, ['worktree', 'add', '-q', '-b', 'synthetic-worktree', worktree]);
  git(sandbox, ['clone', '-q', main, clone]);
  symlinkSync(join(ROOT, 'node_modules'), join(main, 'node_modules'));
  symlinkSync(join(ROOT, 'node_modules'), join(worktree, 'node_modules'));
  symlinkSync(join(ROOT, 'node_modules'), join(clone, 'node_modules'));
  return { main, worktree, clone };
}

describe('T5:沒有指標時真呼叫拒絕且不建檔', () => {
  it('must_catch: 指標不存在時 createDefaultLiveRouter 與 scripts/llm.ts 拒絕,合成樹沒有新檔', () => {
    const root = mkdtempSync(join(tmpdir(), 't5-no-pointer-'));
    sandboxes.push(root);
    const home = join(root, 'home');
    const config = join(root, 'xdg-config');
    const runtime = join(root, 'xdg-runtime');
    mkdirSync(home, { recursive: true });
    mkdirSync(config, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = config;
    process.env.XDG_RUNTIME_DIR = runtime;

    const { main } = makeCheckout(root);
    const before = listTree(root);
    try {
      const runner = join(main, '.t5-reject-live.ts');
      writeFileSync(
        runner,
        [
          "import { writeSync } from 'node:fs';",
          "import { createDefaultLiveRouter } from './packages/core/src/prompt-quality/golden-run.ts';",
          'try {',
          '  createDefaultLiveRouter();',
          "  writeSync(1, 'CREATED\\n');",
          '  process.exit(0);',
          '} catch (err) {',
          '  const message = err instanceof Error ? err.message : String(err);',
          "  writeSync(2, message + '\\n');",
          '  process.exit(2);',
          '}',
          '',
        ].join('\n'),
      );
      const live = spawnSync(process.execPath, ['--import=tsx', runner], {
        cwd: main,
        encoding: 'utf8',
        timeout: 60_000,
        env: childEnv({ home, config, runtime }),
      });
      expect(live.status, `${live.stdout ?? ''}\n${live.stderr ?? ''}`).toBe(2);
      expect(live.stderr).toContain('npx tsx scripts/vault.ts init');
      expect(live.stderr).toContain('npx tsx scripts/vault.ts show');

      const cli = spawnSync(process.execPath, ['--import=tsx', 'scripts/llm.ts', '--probe'], {
        cwd: main,
        encoding: 'utf8',
        timeout: 60_000,
        env: childEnv({ home, config, runtime }),
      });
      expect(cli.status, `${cli.stdout ?? ''}\n${cli.stderr ?? ''}`).toBe(2);
      expect(`${cli.stderr ?? ''}`).toContain('npx tsx scripts/vault.ts init');

      const after = listTree(root).filter((rel) => rel !== '.t5-reject-live.ts' && !rel.endsWith('/.t5-reject-live.ts'));
      const beforeWithoutRunner = before.filter((rel) => rel !== '.t5-reject-live.ts' && !rel.endsWith('/.t5-reject-live.ts'));
      expect(after).toEqual(beforeWithoutRunner);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});
