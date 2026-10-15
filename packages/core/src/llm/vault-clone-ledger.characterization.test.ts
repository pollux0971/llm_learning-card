/**
 * T0 驗收 3、4 的合成主簽出 / worktree / clone,改成 T5 的新行為證明(工單第 16 條):
 * 三個位置各跑一次「寫一筆帳」的程序——經過 `GatewayLlmRouter.call()`、帳本由
 * `resolveVerifiedLedger(defaultVaultDeps())` 從子程序自己的環境解析、雲端 adapter 是假的
 * (不呼叫任何真的 provider)——`XDG_CONFIG_HOME` 指向同一個合成指標;三處的事件都進**同一本**帳本。
 *
 * 舊行為(`git rev-parse --git-common-dir` 的上一層 + `learning/`)下,clone 會寫進自己的
 * `clone/learning/state/log.jsonl`,共用帳本只看得到兩筆;這裡斷言三筆、而且每個簽出底下都沒有 `learning/`。
 *
 * 清理目標只有 mkdtemp 的回傳值。子程序的 HOME / XDG 也指到那個沙箱;守門只 stat 真指標檔。
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

/**
 * 子程序:用**自己這個簽出**的程式碼解析帳本(預設路徑,沒有任何明確參數),
 * 經 GatewayLlmRouter.call() 寫一筆。假 adapter 回的 tokens_in 是第幾個簽出(1/2/3),
 * 用來分辨事件是誰寫的——帳本事件裡沒有 prompt。
 */
const APPEND = [
  "import { writeSync } from 'node:fs';",
  "import { GatewayLlmRouter, defaultVaultDeps, resolveVerifiedLedger } from './packages/core/src/llm/index.ts';",
  '',
  'const nth = Number(process.argv[2]);',
  'const resolved = resolveVerifiedLedger(defaultVaultDeps());',
  'if (!resolved.ok) {',
  '  writeSync(2, `${resolved.message}\\n`);',
  '  process.exit(2);',
  '}',
  'const fake = {',
  '  async call() {',
  "    return { text: 'fake', provider: 'openai' as const, model: 'fake-model', latency_ms: 1, tokens_in: nth, tokens_out: 1 };",
  '  },',
  '};',
  'const router = new GatewayLlmRouter({',
  "  env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'fake-model', OPENAI_API_KEY: 'fake-key' },",
  '  ledger: resolved.ledger,',
  '  adapters: { openai: fake, anthropic: fake },',
  '  onlineProber: async () => true,',
  '  localProber: async () => ({ available: false, models: [] }),',
  '  dailyCapUsd: 100,',
  '  prices: { inPerM: 1, outPerM: 1 },',
  '});',
  "await router.call('deepen', 'T5 shared ledger');",
  "writeSync(1, 'OK\\n');",
  '',
].join('\n');

describe('T5:三個簽出寫進指標指向的同一本帳本(第 16 條)', () => {
  const root = mkdtempSync(join(tmpdir(), 't5-shared-ledger-'));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    expect(snapshotRealPointer()).toEqual(realPointerBefore);
  });

  it('合成主簽出、worktree、clone 的假呼叫事件都進同一本,不是 clone 各記各的', () => {
    const home = join(root, 'home');
    const config = join(root, 'xdg-config');
    const runtime = join(root, 'xdg-runtime');
    mkdirSync(home, { recursive: true });
    mkdirSync(runtime, { recursive: true });

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
    cpSync(join(ROOT, 'tsconfig.json'), join(main, 'tsconfig.json'));
    cpSync(join(ROOT, 'package.json'), join(main, 'package.json'));
    git(main, ['init', '-q', '-b', 'main', '.']);
    git(main, ['add', 'packages', 'tsconfig.json', 'package.json']);
    git(main, ['commit', '-q', '-m', 'synthetic source']);
    git(main, ['worktree', 'add', '-q', '-b', 'synthetic-worktree', worktree]);
    git(root, ['clone', '-q', main, clone]);
    for (const checkout of [main, worktree, clone]) symlinkSync(join(ROOT, 'node_modules'), join(checkout, 'node_modules'));

    const env = {
      PATH: process.env.PATH ?? '',
      HOME: home,
      XDG_CONFIG_HOME: config,
      XDG_RUNTIME_DIR: runtime,
    };
    for (const [checkout, nth] of [
      [main, 1],
      [worktree, 2],
      [clone, 3],
    ] as const) {
      const runner = join(checkout, '.t5-append-ledger.mts');
      writeFileSync(runner, APPEND);
      const child = spawnSync(process.execPath, ['--import=tsx', runner, String(nth)], {
        cwd: checkout,
        encoding: 'utf8',
        timeout: 60_000,
        env,
      });
      expect(child.status, `${checkout}\n${child.stdout ?? ''}\n${child.stderr ?? ''}`).toBe(0);
    }

    const events = readFileSync(join(shared, 'state', 'log.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { type?: string; tokens_in?: number });
    expect(events.map((e) => e.type)).toEqual(['llm_call', 'llm_call', 'llm_call']);
    expect(events.map((e) => e.tokens_in)).toEqual([1, 2, 3]);
    for (const checkout of [main, worktree, clone]) {
      expect(existsSync(join(checkout, 'learning')), checkout).toBe(false);
    }
  }, 180_000);
});
