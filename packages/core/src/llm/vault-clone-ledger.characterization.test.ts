/**
 * T0 驗收 3、4 的合成主簽出 / worktree / clone,改成 T5 的新行為證明:
 * 三個位置各寫一筆假帳(不打 provider),XDG_CONFIG_HOME 指向同一個指標,
 * 事件都進同一本帳本。
 *
 * 清理目標只有 mkdtemp 的回傳值。子程序的 HOME / XDG 也指到那個沙箱。
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
const UUID_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

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

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', timeout: 60_000 },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失敗:${result.stderr ?? ''}`);
}

const APPEND = [
  "import { writeSync } from 'node:fs';",
  "import { createDefaultLiveRouter } from './packages/core/src/prompt-quality/golden-run.ts';",
  '',
  'const marker = process.argv[2];',
  'let router;',
  'try {',
  '  router = createDefaultLiveRouter();',
  '} catch (err) {',
  '  writeSync(2, `${err instanceof Error ? err.message : String(err)}\\n`);',
  '  process.exit(2);',
  '}',
  'const log = (router as { cloudRouter?: { log?: (event: unknown) => void } }).cloudRouter?.log;',
  "if (typeof log !== 'function') {",
  "  writeSync(2, 'no log appender\\n');",
  '  process.exit(3);',
  '}',
  'log({',
  "  ts: '2026-10-15T00:00:00+08:00',",
  "  type: 'llm_call',",
  "  provider: 'openai',",
  '  tokens_in: 1,',
  '  tokens_out: 1,',
  '  marker,',
  '});',
  "writeSync(1, 'OK\\n');",
  'process.exit(0);',
  '',
].join('\n');

describe('T5:三個簽出寫進指標指向的同一本帳本', () => {
  const root = mkdtempSync(join(tmpdir(), 't5-shared-ledger-'));

  afterAll(() => {
    expect(snapshotRealPointer()).toEqual(realPointerBefore);
    rmSync(root, { recursive: true, force: true });
  });

  it('合成主簽出、worktree、clone 的假事件都進同一本,不是 clone 各記各的', () => {
    const home = join(root, 'home');
    const config = join(root, 'xdg-config');
    const runtime = join(root, 'xdg-runtime');
    mkdirSync(home, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = config;
    process.env.XDG_RUNTIME_DIR = runtime;

    const shared = join(root, 'shared-learning');
    mkdirSync(join(shared, 'config'), { recursive: true });
    writeFileSync(join(shared, 'config', 'vault-id'), `${UUID_A}\n`);
    mkdirSync(join(config, 'llm-learning-cards'), { recursive: true });
    writeFileSync(
      join(config, 'llm-learning-cards', 'vault.json'),
      JSON.stringify({ learning_dir: shared, vault_id: UUID_A }),
    );

    const main = join(root, 'main');
    const worktree = join(root, 'worktree');
    const clone = join(root, 'clone');
    mkdirSync(main, { recursive: true });
    cpSync(join(ROOT, 'packages'), join(main, 'packages'), { recursive: true });
    cpSync(join(ROOT, 'contracts'), join(main, 'contracts'), { recursive: true });
    cpSync(join(ROOT, 'tsconfig.json'), join(main, 'tsconfig.json'));
    cpSync(join(ROOT, 'package.json'), join(main, 'package.json'));
    git(main, ['init', '-q', '-b', 'main', '.']);
    git(main, ['add', 'packages', 'contracts', 'tsconfig.json', 'package.json']);
    git(main, ['commit', '-q', '-m', 'synthetic source']);
    git(main, ['worktree', 'add', '-q', '-b', 'synthetic-worktree', worktree]);
    git(root, ['clone', '-q', main, clone]);
    symlinkSync(join(ROOT, 'node_modules'), join(main, 'node_modules'));
    symlinkSync(join(ROOT, 'node_modules'), join(worktree, 'node_modules'));
    symlinkSync(join(ROOT, 'node_modules'), join(clone, 'node_modules'));

    const env = {
      PATH: process.env.PATH ?? '',
      HOME: home,
      XDG_CONFIG_HOME: config,
      XDG_RUNTIME_DIR: runtime,
    };
    for (const [checkout, marker] of [
      [main, 'from-main'],
      [worktree, 'from-worktree'],
      [clone, 'from-clone'],
    ] as const) {
      const runner = join(checkout, '.t5-append-ledger.ts');
      writeFileSync(runner, APPEND);
      const child = spawnSync(process.execPath, ['--import=tsx', runner, marker], {
        cwd: checkout,
        encoding: 'utf8',
        timeout: 60_000,
        env,
      });
      expect(child.status, `${marker}\n${child.stdout ?? ''}\n${child.stderr ?? ''}`).toBe(0);
    }

    const markers = readFileSync(join(shared, 'state', 'log.jsonl'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => (JSON.parse(line) as { marker?: string }).marker);
    expect(markers).toEqual(['from-main', 'from-worktree', 'from-clone']);
    expect(existsSync(join(clone, 'learning', 'state', 'log.jsonl'))).toBe(false);
  }, 180_000);
});
