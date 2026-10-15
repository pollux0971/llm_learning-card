/**
 * T5 第 7、9 條:`scripts/llm.ts` 的帳本姿態。
 *
 * - 真呼叫(`--task … --prompt …`)的帳本只能來自指標檔;給 `--log` 就拒絕(exit 2)。
 * - 解析被拒絕 → 不發出任何請求、exit 2、不建任何檔。
 * - `--fake`(假 adapter)一定要 `--log`,收 `ExplicitLedger`,不讀指標檔,不碰任何真的 provider。
 * - `--probe` 不花錢、也不判斷花了多少(契約 §12 的範圍外),不解析帳本——
 *   `standalone.json` 的 03-llm-router 與 phase-4 的 probe 場景都靠它在沒有指標時照常 exit 0。
 *
 * 隔離:HOME / XDG_* 指到 mkdtemp 並在結束時還原;子程序只拿沙箱的值;守門只 stat 真指標檔。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ExplicitLedger, VerifiedLedger, type VaultResolveDeps } from '../packages/core/src/llm/ledger.js';
import { createFakeRouter, planLlmRun } from './llm.js';

const ENV_KEYS = ['HOME', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR'] as const;
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;
const REAL_HOME = homedir();
const REAL_XDG = process.env.XDG_CONFIG_HOME;
const UUID_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const REPO = resolve(import.meta.dirname, '..');

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

interface Box {
  root: string;
  home: string;
  config: string;
  runtime: string;
}

function sandbox(): Box {
  const root = mkdtempSync(join(tmpdir(), 't5-llm-cli-'));
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
  return { root, home, config, runtime };
}

afterAll(() => {
  for (const k of ENV_KEYS) {
    const v = SAVED_ENV[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
  expect(snapshotRealPointer()).toEqual(realPointerBefore);
});

function pointerPathOf(box: Box): string {
  return join(box.config, 'llm-learning-cards', 'vault.json');
}

function writeValidVault(box: Box): string {
  const learning = join(box.root, 'learning');
  mkdirSync(join(learning, 'config'), { recursive: true });
  writeFileSync(join(learning, 'config', 'vault-id'), `${UUID_A}\n`);
  mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
  writeFileSync(pointerPathOf(box), JSON.stringify({ learning_dir: learning, vault_id: UUID_A }));
  return learning;
}

/** 真的讀沙箱的檔,並記下讀過 / 探測過哪些路徑。 */
function realDeps(box: Box, touched: string[] = []): VaultResolveDeps {
  return {
    env: { HOME: box.home, XDG_CONFIG_HOME: box.config, XDG_RUNTIME_DIR: box.runtime },
    homedir: () => box.home,
    readFile: (path) => {
      touched.push(path);
      return readFileSync(path, 'utf8');
    },
    exists: (path) => {
      touched.push(path);
      try {
        statSync(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** 一碰就丟錯的 deps:證明「這條路不解析帳本」。 */
const UNTOUCHABLE: VaultResolveDeps = {
  env: {},
  homedir: () => {
    throw new Error('不該解析帳本(homedir)');
  },
  readFile: () => {
    throw new Error('不該解析帳本(readFile)');
  },
  exists: () => {
    throw new Error('不該解析帳本(exists)');
  },
};

function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      out.push(abs.slice(root.length + 1));
      if (statSync(abs).isDirectory()) walk(abs);
    }
  };
  walk(root);
  return out.sort();
}

describe('planLlmRun:真呼叫的帳本只能來自指標檔(第 9 條)', () => {
  it('真呼叫模式給 --log 就拒絕,exit 2,訊息說帳本位置只能由指標檔決定;連指標都不看', () => {
    const plan = planLlmRun(['--task', 'deepen', '--prompt', 'x', '--log', '/tmp/other.jsonl'], UNTOUCHABLE);
    expect(plan.kind).toBe('exit');
    if (plan.kind !== 'exit') return;
    expect(plan.exitCode).toBe(2);
    expect(plan.message).toContain('指標檔');
    expect(plan.message).toContain('--log');
  });

  it('--probe 加 --log(非 fake)也拒絕:--log 在真呼叫模式從來不是選項', () => {
    const plan = planLlmRun(['--probe', '--log', '/tmp/other.jsonl'], UNTOUCHABLE);
    expect(plan.kind).toBe('exit');
    if (plan.kind !== 'exit') return;
    expect(plan.exitCode).toBe(2);
  });

  it('沒有指標時真呼叫拒絕,exit 2,訊息含 init 與 show', () => {
    const box = sandbox();
    const plan = planLlmRun(['--task', 'deepen', '--prompt', 'x'], realDeps(box));
    expect(plan.kind).toBe('exit');
    if (plan.kind !== 'exit') return;
    expect(plan.exitCode).toBe(2);
    expect(plan.message).toContain('npx tsx scripts/vault.ts init');
    expect(plan.message).toContain('npx tsx scripts/vault.ts show');
  });

  it('標記不符時真呼叫拒絕,exit 2', () => {
    const box = sandbox();
    const learning = writeValidVault(box);
    writeFileSync(join(learning, 'config', 'vault-id'), '11111111-2222-4333-8444-555555555555\n');
    const plan = planLlmRun(['--task', 'deepen', '--prompt', 'x'], realDeps(box));
    expect(plan.kind).toBe('exit');
    if (plan.kind !== 'exit') return;
    expect(plan.exitCode).toBe(2);
  });

  it('must_catch: 正式程式的預設路徑走 ExplicitLedger —— 沒有明確參數時,llm.ts 的帳本是指標驗證過的那本', () => {
    const box = sandbox();
    const learning = writeValidVault(box);
    const plan = planLlmRun(['--task', 'deepen', '--prompt', 'x', '--timeout-ms', '1500'], realDeps(box));
    expect(plan.kind).toBe('call');
    if (plan.kind !== 'call') return;
    expect(plan.mode).toBe('live');
    expect(plan.ledger).toBeInstanceOf(VerifiedLedger);
    expect(plan.ledger).not.toBeInstanceOf(ExplicitLedger);
    expect(plan.ledger.logPath).toBe(join(learning, 'state', 'log.jsonl'));
    expect(plan.task).toBe('deepen');
    expect(plan.prompt).toBe('x');
    expect(plan.timeoutMs).toBe(1500);
  });

  it('用法錯(缺 --prompt、不認得的 task)exit 1,不解析帳本', () => {
    for (const argv of [['--task', 'deepen'], ['--prompt', 'x'], ['--task', 'no.such.task', '--prompt', 'x'], []]) {
      const plan = planLlmRun(argv, UNTOUCHABLE);
      expect(plan.kind, argv.join(' ')).toBe('exit');
      if (plan.kind !== 'exit') continue;
      expect(plan.exitCode).toBe(1);
    }
  });
});

describe('planLlmRun:--probe 不碰帳本', () => {
  it('--probe 不解析指標(不花錢、不判斷花費,不在契約 §12 範圍)', () => {
    expect(planLlmRun(['--probe'], UNTOUCHABLE)).toEqual({ kind: 'probe', mode: 'live' });
  });
});

describe('planLlmRun:--fake 的 --log(第 7、9 條)', () => {
  it('假 adapter 模式 --log 可用,得到 ExplicitLedger;指標檔是壞的也通過,而且根本沒讀它', () => {
    const box = sandbox();
    mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
    writeFileSync(pointerPathOf(box), '{ broken');
    const touched: string[] = [];
    const log = join(box.root, 'fake.jsonl');
    const plan = planLlmRun(['--fake', '--log', log, '--task', 'deepen', '--prompt', 'x'], realDeps(box, touched));
    expect(plan.kind).toBe('call');
    if (plan.kind !== 'call') return;
    expect(plan.mode).toBe('fake');
    expect(plan.ledger).toBeInstanceOf(ExplicitLedger);
    expect(plan.ledger.logPath).toBe(log);
    expect(touched).toEqual([]);
  });

  it('--fake --log --probe:假 probe,不解析指標', () => {
    const plan = planLlmRun(['--fake', '--log', '/tmp/fake.jsonl', '--probe'], UNTOUCHABLE);
    expect(plan.kind).toBe('probe');
    if (plan.kind !== 'probe') return;
    expect(plan.mode).toBe('fake');
  });

  it('--fake 沒給 --log 就拒絕(exit 2):假呼叫不寫進指標指向的真帳本,也不偷偷變成真呼叫', () => {
    for (const argv of [
      ['--fake', '--task', 'deepen', '--prompt', 'x'],
      ['--fake', '--probe'],
      ['--fake', '--log', '--task', 'deepen', '--prompt', 'x'],
    ]) {
      const plan = planLlmRun(argv, UNTOUCHABLE);
      expect(plan.kind, argv.join(' ')).toBe('exit');
      if (plan.kind !== 'exit') continue;
      expect(plan.exitCode).toBe(2);
      expect(plan.message).toContain('--log');
    }
  });
});

describe('createFakeRouter:假的 adapter,不打任何真的 provider', () => {
  it('雲端任務與閘道任務都回假結果,事件寫進 --log 那本', async () => {
    const box = sandbox();
    const log = join(box.root, 'fake.jsonl');
    const router = createFakeRouter(ExplicitLedger.unverified(log, 'test'));
    const cloud = await router.call('deepen', '同源政策');
    expect(cloud.text).toContain('[fake]');
    expect(cloud.provider).toBe('openai');
    const local = await router.call('grade.fill.llm', '填空');
    expect(local.provider).toBe('ollama');
    const events = readFileSync(log, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as { type: string; task: string; provider: string });
    expect(events.map((e) => [e.type, e.task, e.provider])).toEqual([
      ['llm_call', 'deepen', 'openai'],
      ['llm_call', 'grade.fill.llm', 'ollama'],
    ]);
    expect(await router.probeOnline()).toBe(true);
    expect((await router.probeLocal()).available).toBe(true);
  });
});

describe('scripts/llm.ts CLI(子程序,沙箱 env)', () => {
  function cli(box: Box, args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, ['--import=tsx', join(REPO, 'scripts/llm.ts'), ...args], {
      cwd: box.root,
      encoding: 'utf8',
      timeout: 60_000,
      env: { PATH: process.env.PATH ?? '', HOME: box.home, XDG_CONFIG_HOME: box.config, XDG_RUNTIME_DIR: box.runtime },
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  it('--fake --log:exit 0,印出假結果,事件寫進 --log', () => {
    const box = sandbox();
    const log = join(box.root, 'fake.jsonl');
    const r = cli(box, ['--fake', '--log', log, '--task', 'deepen', '--prompt', 'hi']);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout) as { text: string }).toMatchObject({ provider: 'openai' });
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('真呼叫給 --log:exit 2,不建那個檔,沙箱樹不變', () => {
    const box = sandbox();
    writeValidVault(box);
    const log = join(box.root, 'other.jsonl');
    const before = listTree(box.root);
    const r = cli(box, ['--task', 'deepen', '--prompt', 'hi', '--log', log]);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(2);
    expect(r.stdout).toBe('');
    expect(existsSync(log)).toBe(false);
    expect(listTree(box.root)).toEqual(before);
  });

  it('沒有指標:exit 2,stderr 含 init 與 show,不建 learning/ 或任何檔', () => {
    const box = sandbox();
    const before = listTree(box.root);
    const r = cli(box, ['--task', 'deepen', '--prompt', 'hi']);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('npx tsx scripts/vault.ts init');
    expect(r.stderr).toContain('npx tsx scripts/vault.ts show');
    expect(listTree(box.root)).toEqual(before);
  });
});
