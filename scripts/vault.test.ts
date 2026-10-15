/**
 * T5:vault.ts init / show,以及 llm / llm-spend 的拒絕姿態。
 * 讀寫只在 mkdtemp。spawn 的子程序也只拿到沙箱的 HOME / XDG。
 */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { initVault, showVault, type VaultIo } from './vault.js';
import { resolveLlmLedger } from './llm.js';
import { buildSpendReport, formatSpendReport, exitCodeFor, resolveSpendLedger } from './llm-spend.js';
import { resolvePollutionLogPath } from './check-ledger-pollution.js';

const REAL_HOME = homedir();
const REAL_XDG = process.env.XDG_CONFIG_HOME;
const UUID_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const UUID_B = '11111111-2222-4333-8444-555555555555';
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

function sandbox(): { root: string; home: string; config: string; runtime: string } {
  const root = mkdtempSync(join(tmpdir(), 't5-vault-cli-'));
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
  expect(snapshotRealPointer()).toEqual(realPointerBefore);
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

function childEnv(box: { home: string; config: string; runtime: string }): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    HOME: box.home,
    XDG_CONFIG_HOME: box.config,
    XDG_RUNTIME_DIR: box.runtime,
  };
}

function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = abs.slice(root.length + 1);
      out.push(rel);
      if (statSync(abs).isDirectory()) walk(abs);
    }
  };
  walk(root);
  return out.sort();
}

function learningDir(root: string, name = 'learning'): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function ioRecording(rootWrites: string[]): VaultIo {
  return {
    exists: (path) => {
      try {
        statSync(path);
        return true;
      } catch {
        return false;
      }
    },
    readFile: (path) => readFileSync(path, 'utf8'),
    writeAtomic: (path, content) => {
      rootWrites.push(path);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);
    },
    mkdir: (path, mode) => {
      mkdirSync(path, { recursive: true, mode });
    },
  };
}

describe('vault init', () => {
  it('全新:無指標、learning 無標記 → 產生 uuid,寫兩份,exit 0', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    const writes: string[] = [];
    const result = initVault({
      learningDir: learning,
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording(writes),
      randomUUID: () => UUID_A,
    });
    expect(result.exitCode).toBe(0);
    expect(writes).toEqual(
      expect.arrayContaining([
        join(box.config, 'llm-learning-cards', 'vault.json'),
        join(learning, 'config', 'vault-id'),
      ]),
    );
    expect(readFileSync(join(learning, 'config', 'vault-id'), 'utf8')).toBe(`${UUID_A}\n`);
    const pointer = JSON.parse(readFileSync(join(box.config, 'llm-learning-cards', 'vault.json'), 'utf8')) as {
      learning_dir: string;
      vault_id: string;
    };
    expect(pointer).toEqual({ learning_dir: learning, vault_id: UUID_A });
  });

  it('learning 已有標記、無指標 → 沿用標記 uuid,不重新產生', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    mkdirSync(join(learning, 'config'), { recursive: true });
    writeFileSync(join(learning, 'config', 'vault-id'), `${UUID_B}\n`);
    const result = initVault({
      learningDir: learning,
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording([]),
      randomUUID: () => {
        throw new Error('不該重新產生 uuid');
      },
    });
    expect(result.exitCode).toBe(0);
    const pointer = JSON.parse(readFileSync(join(box.config, 'llm-learning-cards', 'vault.json'), 'utf8')) as {
      vault_id: string;
    };
    expect(pointer.vault_id).toBe(UUID_B);
    expect(readFileSync(join(learning, 'config', 'vault-id'), 'utf8')).toBe(`${UUID_B}\n`);
  });

  it('指標已指向同一個 learning 且 id 相符 → 不改任何檔,exit 0,印已初始化', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    mkdirSync(join(learning, 'config'), { recursive: true });
    writeFileSync(join(learning, 'config', 'vault-id'), `${UUID_A}\n`);
    mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
    const pointerPath = join(box.config, 'llm-learning-cards', 'vault.json');
    writeFileSync(pointerPath, JSON.stringify({ learning_dir: learning, vault_id: UUID_A }));
    const before = readFileSync(pointerPath, 'utf8');
    const markerBefore = readFileSync(join(learning, 'config', 'vault-id'), 'utf8');
    const writes: string[] = [];
    const result = initVault({
      learningDir: learning,
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording(writes),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('已初始化');
    expect(writes).toEqual([]);
    expect(readFileSync(pointerPath, 'utf8')).toBe(before);
    expect(readFileSync(join(learning, 'config', 'vault-id'), 'utf8')).toBe(markerBefore);
  });

  it('must_catch: init 不加 --force 不得覆寫指向別處的指標', () => {
    const box = sandbox();
    const here = learningDir(box.root, 'here');
    const there = learningDir(box.root, 'there');
    mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
    const pointerPath = join(box.config, 'llm-learning-cards', 'vault.json');
    const old = JSON.stringify({ learning_dir: there, vault_id: UUID_A });
    writeFileSync(pointerPath, old);
    const writes: string[] = [];
    const result = initVault({
      learningDir: here,
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording(writes),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('--force');
    expect(writes).toEqual([]);
    expect(readFileSync(pointerPath, 'utf8')).toBe(old);
  });

  it('加 --force 才覆寫,而且先印出舊指標內容', () => {
    const box = sandbox();
    const here = learningDir(box.root, 'here');
    const there = learningDir(box.root, 'there');
    mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
    const pointerPath = join(box.config, 'llm-learning-cards', 'vault.json');
    const old = JSON.stringify({ learning_dir: there, vault_id: UUID_A });
    writeFileSync(pointerPath, old);
    const result = initVault({
      learningDir: here,
      force: true,
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording([]),
      randomUUID: () => UUID_B,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(old);
    const next = JSON.parse(readFileSync(pointerPath, 'utf8')) as { learning_dir: string };
    expect(next.learning_dir).toBe(here);
  });

  it('--learning-dir 相對路徑或不存在 → 拒絕,不建任何東西', () => {
    const box = sandbox();
    const before = listTree(box.root);
    const relative = initVault({
      learningDir: 'learning',
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording([]),
    });
    expect(relative.exitCode).not.toBe(0);
    const missing = initVault({
      learningDir: join(box.root, 'nope'),
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording([]),
    });
    expect(missing.exitCode).not.toBe(0);
    expect(listTree(box.root)).toEqual(before);
  });

  it('指標與標記 id 不符 → 拒絕,只印前 8 碼,要 --force', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    mkdirSync(join(learning, 'config'), { recursive: true });
    writeFileSync(join(learning, 'config', 'vault-id'), `${UUID_B}\n`);
    mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
    writeFileSync(
      join(box.config, 'llm-learning-cards', 'vault.json'),
      JSON.stringify({ learning_dir: learning, vault_id: UUID_A }),
    );
    const result = initVault({
      learningDir: learning,
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording([]),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('--force');
    expect(result.stderr).toContain(UUID_A.slice(0, 8));
    expect(result.stderr).toContain(UUID_B.slice(0, 8));
    expect(result.stderr).not.toContain(UUID_A);
    expect(result.stderr).not.toContain(UUID_B);
  });
});

describe('vault show', () => {
  it('相符時印出指標位置、learning_dir、標記存在且相符,exit 0', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    mkdirSync(join(learning, 'config'), { recursive: true });
    writeFileSync(join(learning, 'config', 'vault-id'), `${UUID_A}\n`);
    const pointerPath = join(box.config, 'llm-learning-cards', 'vault.json');
    mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
    writeFileSync(pointerPath, JSON.stringify({ learning_dir: learning, vault_id: UUID_A }));
    const result = showVault({ env: childEnv(box), homedir: () => box.home, io: ioRecording([]) });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(pointerPath);
    expect(result.stdout).toContain(learning);
    expect(result.stdout).toContain('marker: present');
    expect(result.stdout).toContain('match: yes');
  });

  it('任何不符 exit 非 0', () => {
    const box = sandbox();
    const result = showVault({ env: childEnv(box), homedir: () => box.home, io: ioRecording([]) });
    expect(result.exitCode).not.toBe(0);
  });
});

describe('scripts/llm.ts 解析', () => {
  it('真呼叫模式給 --log 就拒絕,exit 2', () => {
    const box = sandbox();
    const result = resolveLlmLedger({
      argv: ['--task', 'deepen', '--prompt', 'x', '--log', join(box.root, 'other.jsonl')],
      env: childEnv(box),
      homedir: () => box.home,
      readFile: (path) => readFileSync(path, 'utf8'),
      exists: () => false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('指標檔');
  });

  it('假 adapter 模式 --log 可用,而且不讀指標檔', () => {
    const box = sandbox();
    const seen: string[] = [];
    const log = join(box.root, 'fake.jsonl');
    const result = resolveLlmLedger({
      argv: ['--fake', '--log', log, '--probe'],
      env: childEnv(box),
      homedir: () => box.home,
      readFile: (path) => {
        seen.push(path);
        return readFileSync(path, 'utf8');
      },
      exists: () => false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.kind).toBe('explicit');
    expect(result.ledger.logPath).toBe(log);
    expect(seen).toEqual([]);
  });

  it('沒有指標時真呼叫拒絕,exit 2,訊息含 init 與 show', () => {
    const box = sandbox();
    const result = resolveLlmLedger({
      argv: ['--probe'],
      env: childEnv(box),
      homedir: () => box.home,
      readFile: (path) => readFileSync(path, 'utf8'),
      exists: () => false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('npx tsx scripts/vault.ts init');
    expect(result.message).toContain('npx tsx scripts/vault.ts show');
  });
});

describe('scripts/llm-spend.ts', () => {
  it('指標拒絕時 exit 2,不是 0', () => {
    const box = sandbox();
    const resolved = resolveSpendLedger({
      explicitLog: undefined,
      env: childEnv(box),
      homedir: () => box.home,
      readFile: (path) => readFileSync(path, 'utf8'),
      exists: () => false,
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.exitCode).toBe(2);
  });

  it('明確 --log 的報告第一行標 ledger=unverified,而且不能當煞車(exit 2)', () => {
    const box = sandbox();
    const log = join(box.root, 'log.jsonl');
    writeFileSync(log, '');
    const resolved = resolveSpendLedger({
      explicitLog: log,
      env: childEnv(box),
      homedir: () => box.home,
      readFile: () => {
        throw new Error('不該讀指標');
      },
      exists: () => {
        throw new Error('不該探測指標');
      },
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.ledger.kind).toBe('explicit');
    const report = buildSpendReport(
      { ...childEnv(box), LLM_DAILY_CAP_USD: '1', LLM_PRICE_IN_PER_M: '2.5', LLM_PRICE_OUT_PER_M: '10' },
      resolved.ledger,
      '2026-10-15',
    );
    expect(report.kind).toBe('computed');
    if (report.kind !== 'computed') return;
    expect(report.ledger).toBe('unverified');
    const text = formatSpendReport(report);
    expect(text.split('\n')[0]).toContain('ledger=unverified');
    expect(exitCodeFor(report)).toBe(2);
  });
});

describe('check-ledger-pollution 解析失敗是 UNKNOWN 路徑,不建檔', () => {
  it('沒有指標時不回一個可當 PASS 的既有帳本路徑,也不建檔', () => {
    const box = sandbox();
    const before = listTree(box.root);
    const result = resolvePollutionLogPath({
      env: childEnv(box),
      homedir: () => box.home,
      readFile: (path) => readFileSync(path, 'utf8'),
      exists: () => false,
    });
    expect(result.resolved).toBe(false);
    expect(listTree(box.root)).toEqual(before);
  });
});

describe('CLI 子程序隔離', () => {
  it('spawn vault show 時子程序的 HOME / XDG 在沙箱,真指標檔不變', () => {
    const box = sandbox();
    const child = spawnSync(process.execPath, ['--import=tsx', join(REPO, 'scripts/vault.ts'), 'show'], {
      cwd: box.root,
      encoding: 'utf8',
      timeout: 60_000,
      env: childEnv(box),
    });
    expect(child.status).not.toBe(0);
    expect(snapshotRealPointer()).toEqual(realPointerBefore);
  });
});
