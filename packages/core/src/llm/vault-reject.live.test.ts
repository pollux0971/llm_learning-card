/**
 * T5 驗收 17(反向測試,必備):合成環境**沒有指標檔**,跑真呼叫路徑——`scripts/llm.ts --task … --prompt …`
 * 與 `createDefaultLiveRouter()`——要拒絕,而且整個合成樹裡沒有任何新檔或新目錄(列檔前後相等)。
 *
 * 合成樹裡刻意放一個舊做法會找到的 `learning/`(主簽出底下,帶合法標記):退回 git-common-dir 的實作
 * 會在那裡寫帳本、建 `state/`,樹就變了。子程序的 HOME / XDG 只指向 mkdtemp,沒有任何 API key;
 * 拒絕發生在任何請求之前,所以不打網路。守門只 stat 真指標檔,不讀內容。
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  lstatSync,
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
const sandboxes: string[] = [];

afterAll(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
  expect(snapshotRealPointer()).toEqual(realPointerBefore);
});

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', timeout: 60_000 },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失敗:${result.stderr ?? ''}`);
}

/**
 * 列出整棵樹(相對路徑,排序)。用 lstat:符號連結(node_modules)只記它本身,不跟進去——
 * 跟進去會把整個真的 node_modules 列一遍,而且那不是這個測試能建出來的東西。
 */
function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      out.push(abs.slice(root.length + 1));
      if (lstatSync(abs).isDirectory()) walk(abs);
    }
  };
  walk(root);
  return out.sort();
}

describe('T5:沒有指標時真呼叫拒絕且不建檔(第 17 條)', () => {
  it('must_catch: 指標檔不存在時退回 git-common-dir —— createDefaultLiveRouter 與 scripts/llm.ts 都拒絕,合成樹沒有新檔', () => {
    const root = mkdtempSync(join(tmpdir(), 't5-no-pointer-'));
    sandboxes.push(root);
    const home = join(root, 'home');
    const config = join(root, 'xdg-config');
    const runtime = join(root, 'xdg-runtime');
    mkdirSync(home, { recursive: true });
    mkdirSync(config, { recursive: true });
    mkdirSync(runtime, { recursive: true });

    const main = join(root, 'main');
    mkdirSync(main, { recursive: true });
    // golden-run.ts 載入時就讀 contracts/fixtures(golden set 的 raw 切片),所以 contracts 也要複製。
    cpSync(join(ROOT, 'packages'), join(main, 'packages'), { recursive: true });
    cpSync(join(ROOT, 'contracts'), join(main, 'contracts'), { recursive: true });
    cpSync(join(ROOT, 'scripts'), join(main, 'scripts'), { recursive: true });
    cpSync(join(ROOT, 'tsconfig.json'), join(main, 'tsconfig.json'));
    cpSync(join(ROOT, 'package.json'), join(main, 'package.json'));
    git(main, ['init', '-q', '-b', 'main', '.']);
    git(main, ['add', 'packages', 'contracts', 'scripts', 'tsconfig.json', 'package.json']);
    git(main, ['commit', '-q', '-m', 'synthetic source']);
    symlinkSync(join(ROOT, 'node_modules'), join(main, 'node_modules'));
    // 舊做法(git-common-dir 的上一層 + learning/)會找到的位置,帶合法標記。
    mkdirSync(join(main, 'learning', 'config'), { recursive: true });
    writeFileSync(join(main, 'learning', 'config', 'vault-id'), `${UUID_A}\n`);

    const runner = join(main, '.t5-reject-live.mts');
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
    const env = { PATH: process.env.PATH ?? '', HOME: home, XDG_CONFIG_HOME: config, XDG_RUNTIME_DIR: runtime };
    const before = listTree(root);

    const live = spawnSync(process.execPath, ['--import=tsx', runner], { cwd: main, encoding: 'utf8', timeout: 60_000, env });
    expect(live.status, `${live.stdout ?? ''}\n${live.stderr ?? ''}`).toBe(2);
    expect(live.stdout).not.toContain('CREATED');
    expect(live.stderr).toContain('npx tsx scripts/vault.ts init');
    expect(live.stderr).toContain('npx tsx scripts/vault.ts show');

    const cli = spawnSync(
      process.execPath,
      ['--import=tsx', 'scripts/llm.ts', '--task', 'deepen', '--prompt', 'T5 反向測試'],
      { cwd: main, encoding: 'utf8', timeout: 60_000, env },
    );
    expect(cli.status, `${cli.stdout ?? ''}\n${cli.stderr ?? ''}`).toBe(2);
    expect(cli.stdout).toBe('');
    expect(cli.stderr).toContain('npx tsx scripts/vault.ts init');
    expect(cli.stderr).toContain('npx tsx scripts/vault.ts show');

    expect(listTree(root)).toEqual(before);
  }, 180_000);
});
