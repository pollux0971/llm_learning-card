/**
 * T5 第 4、5 條:`scripts/vault.ts init` / `show`。
 *
 * 讀寫只在 mkdtemp。HOME / XDG_CONFIG_HOME / XDG_RUNTIME_DIR 指到沙箱並在結束時還原;
 * spawn 的子程序也只拿到沙箱的值。守門只 stat 真指標檔,不讀內容。
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { realVaultIo } from '../packages/core/src/llm/ledger.js';
import { initVault, showVault, type VaultIo } from './vault.js';

// T8 E:renameSync 穿透包一層,記下「rename 的那一刻,來源暫存檔的權限」。指標檔在 rename 之後才對外可見,
// 所以 rename 那一刻暫存檔就必須已經是 0600(不能 rename 完才 chmod)。其餘行為完全穿透。
const renameSeen: Array<{ to: string; mode: number }> = [];
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (from: import('node:fs').PathLike, to: import('node:fs').PathLike): void => {
      try {
        renameSeen.push({ to: String(to), mode: actual.statSync(from).mode & 0o777 });
      } catch {
        /* 來源不存在就讓真的 rename 去丟錯 */
      }
      actual.renameSync(from, to);
    },
  };
});

const ENV_KEYS = ['HOME', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR'] as const;
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;
const REAL_HOME = homedir();
const REAL_XDG = process.env.XDG_CONFIG_HOME;
const UUID_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const UUID_B = '11111111-2222-4333-8444-555555555555';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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
  for (const k of ENV_KEYS) {
    const v = SAVED_ENV[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
  expect(snapshotRealPointer()).toEqual(realPointerBefore);
});

function childEnv(box: Box): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    HOME: box.home,
    XDG_CONFIG_HOME: box.config,
    XDG_RUNTIME_DIR: box.runtime,
  };
}

/** 列檔(相對路徑,排序)連同每個檔的內容——「不改任何檔」要連內容一起比。 */
function treeWithContent(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = abs.slice(root.length + 1);
      if (statSync(abs).isDirectory()) {
        out.push(`${rel}/`);
        walk(abs);
      } else {
        out.push(`${rel} ${readFileSync(abs, 'utf8')}`);
      }
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

function pointerPathOf(box: Box): string {
  return join(box.config, 'llm-learning-cards', 'vault.json');
}

function writePointerRaw(box: Box, raw: string): string {
  mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
  writeFileSync(pointerPathOf(box), raw);
  return pointerPathOf(box);
}

function writeMarker(learning: string, text: string): void {
  mkdirSync(join(learning, 'config'), { recursive: true });
  writeFileSync(join(learning, 'config', 'vault-id'), text);
}

/** 真的寫檔,另外記下每一次 writeAtomic 的目標——「沒有寫任何東西」要能斷言。 */
function ioRecording(writes: string[]): VaultIo {
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
      writes.push(path);
      writeFileSync(path, content);
    },
    mkdir: (path, mode) => {
      if (mode === undefined) mkdirSync(path, { recursive: true });
      else mkdirSync(path, { recursive: true, mode });
    },
  };
}

function readPointer(box: Box): { learning_dir: string; vault_id: string } {
  return JSON.parse(readFileSync(pointerPathOf(box), 'utf8')) as { learning_dir: string; vault_id: string };
}

describe('vault init(第 4 條的表,每列一個測試)', () => {
  it('全新:無指標、learning 無標記 → 產生 uuid,寫標記與指標,exit 0', () => {
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
    expect(writes).toEqual([join(learning, 'config', 'vault-id'), pointerPathOf(box)]);
    expect(readFileSync(join(learning, 'config', 'vault-id'), 'utf8')).toBe(`${UUID_A}\n`);
    expect(readPointer(box)).toEqual({ learning_dir: learning, vault_id: UUID_A });
  });

  it('全新且不注入 randomUUID:寫出的是合法的小寫 uuid,兩份檔相同', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    const result = initVault({ learningDir: learning, env: childEnv(box), homedir: () => box.home, io: ioRecording([]) });
    expect(result.exitCode).toBe(0);
    const pointer = readPointer(box);
    expect(pointer.vault_id).toMatch(UUID_RE);
    expect(readFileSync(join(learning, 'config', 'vault-id'), 'utf8')).toBe(`${pointer.vault_id}\n`);
  });

  it('learning 已有標記、無指標 → 沿用標記的 uuid 寫指標(不重新產生,標記不動)', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    writeMarker(learning, `${UUID_B}\n`);
    const writes: string[] = [];
    const result = initVault({
      learningDir: learning,
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording(writes),
      randomUUID: () => {
        throw new Error('不該重新產生 uuid');
      },
    });
    expect(result.exitCode).toBe(0);
    expect(writes).toEqual([pointerPathOf(box)]);
    expect(readPointer(box)).toEqual({ learning_dir: learning, vault_id: UUID_B });
    expect(readFileSync(join(learning, 'config', 'vault-id'), 'utf8')).toBe(`${UUID_B}\n`);
  });

  it('指標已存在、指向同一個 learning_dir 且 id 相符 → 不改任何檔,exit 0,印「已初始化」', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    writeMarker(learning, `${UUID_A}\n`);
    writePointerRaw(box, JSON.stringify({ learning_dir: learning, vault_id: UUID_A }));
    const before = treeWithContent(box.root);
    const writes: string[] = [];
    const result = initVault({ learningDir: learning, env: childEnv(box), homedir: () => box.home, io: ioRecording(writes) });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('已初始化');
    expect(writes).toEqual([]);
    expect(treeWithContent(box.root)).toEqual(before);
  });

  it('must_catch: init 不加 --force 就覆寫指向別處的指標 —— 拒絕,不改任何檔,exit 非 0,訊息說要 --force', () => {
    const box = sandbox();
    const here = learningDir(box.root, 'here');
    const there = learningDir(box.root, 'there');
    writeMarker(there, `${UUID_A}\n`);
    writePointerRaw(box, JSON.stringify({ learning_dir: there, vault_id: UUID_A }));
    const before = treeWithContent(box.root);
    const writes: string[] = [];
    const result = initVault({ learningDir: here, env: childEnv(box), homedir: () => box.home, io: ioRecording(writes) });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('--force');
    expect(writes).toEqual([]);
    expect(treeWithContent(box.root)).toEqual(before);
  });

  it('指標指向別處 + --force → 覆寫指標,而且先印出舊指標內容(第 5 條)', () => {
    const box = sandbox();
    const here = learningDir(box.root, 'here');
    const there = learningDir(box.root, 'there');
    const old = JSON.stringify({ learning_dir: there, vault_id: UUID_A });
    writePointerRaw(box, old);
    const result = initVault({
      learningDir: here,
      force: true,
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording([]),
      randomUUID: () => UUID_B,
    });
    expect(result.exitCode).toBe(0);
    const oldAt = result.stdout.indexOf(old);
    expect(oldAt).toBeGreaterThanOrEqual(0);
    expect(oldAt).toBeLessThan(result.stdout.indexOf('--force'));
    expect(readPointer(box)).toEqual({ learning_dir: here, vault_id: UUID_B });
    expect(readFileSync(join(here, 'config', 'vault-id'), 'utf8')).toBe(`${UUID_B}\n`);
  });

  it('--learning-dir 是相對路徑或不存在 → 拒絕,不建任何東西', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    const before = treeWithContent(box.root);
    const writes: string[] = [];
    // 相對路徑:就算從 cwd 解析得到一個真的目錄也拒絕。
    const relativeResult = initVault({
      learningDir: relative(process.cwd(), learning),
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording(writes),
    });
    expect(relativeResult.exitCode).not.toBe(0);
    const missing = initVault({
      learningDir: join(box.root, 'nope'),
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording(writes),
    });
    expect(missing.exitCode).not.toBe(0);
    const empty = initVault({ learningDir: '', env: childEnv(box), homedir: () => box.home, io: ioRecording(writes) });
    expect(empty.exitCode).not.toBe(0);
    expect(writes).toEqual([]);
    expect(treeWithContent(box.root)).toEqual(before);
  });

  it('指標與標記的 id 不符 → 拒絕,只印兩邊各自的前 8 碼(不印整個 uuid),要 --force', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    writeMarker(learning, `${UUID_B}\n`);
    writePointerRaw(box, JSON.stringify({ learning_dir: learning, vault_id: UUID_A }));
    const before = treeWithContent(box.root);
    const writes: string[] = [];
    const result = initVault({ learningDir: learning, env: childEnv(box), homedir: () => box.home, io: ioRecording(writes) });
    expect(result.exitCode).not.toBe(0);
    const out = `${result.stdout}${result.stderr}`;
    expect(result.stderr).toContain('--force');
    expect(result.stderr).toContain(`指標 ${UUID_A.slice(0, 8)}`);
    expect(result.stderr).toContain(`標記 ${UUID_B.slice(0, 8)}`);
    expect(out).not.toContain(UUID_A);
    expect(out).not.toContain(UUID_B);
    expect(out).not.toContain(learning);
    expect(writes).toEqual([]);
    expect(treeWithContent(box.root)).toEqual(before);
  });

  it('id 不符 + --force → 指標改成標記的 id(標記是帳本本身的身分,不動),並先印舊指標', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    writeMarker(learning, `${UUID_B}\n`);
    const old = JSON.stringify({ learning_dir: learning, vault_id: UUID_A });
    writePointerRaw(box, old);
    const writes: string[] = [];
    const result = initVault({
      learningDir: learning,
      force: true,
      env: childEnv(box),
      homedir: () => box.home,
      io: ioRecording(writes),
      randomUUID: () => {
        throw new Error('標記在,不該重新產生');
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(old);
    expect(writes).toEqual([pointerPathOf(box)]);
    expect(readPointer(box)).toEqual({ learning_dir: learning, vault_id: UUID_B });
    expect(readFileSync(join(learning, 'config', 'vault-id'), 'utf8')).toBe(`${UUID_B}\n`);
  });

  it('指標檔壞掉(不是 JSON)→ 拒絕,訊息說指標讀不到、要 --force,不誤報成 id 不符', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    writePointerRaw(box, '{ not json');
    const before = treeWithContent(box.root);
    const writes: string[] = [];
    const result = initVault({ learningDir: learning, env: childEnv(box), homedir: () => box.home, io: ioRecording(writes) });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('讀不到');
    expect(result.stderr).toContain('--force');
    expect(result.stderr).not.toContain('不符');
    expect(writes).toEqual([]);
    expect(treeWithContent(box.root)).toEqual(before);
  });

  it('指標裡的 learning_dir 是相對路徑(就算從 cwd 解析剛好是同一處)→ 不算「已初始化」,要 --force', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    writeMarker(learning, `${UUID_A}\n`);
    writePointerRaw(box, JSON.stringify({ learning_dir: relative(process.cwd(), learning), vault_id: UUID_A }));
    const writes: string[] = [];
    const result = initVault({ learningDir: learning, env: childEnv(box), homedir: () => box.home, io: ioRecording(writes) });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain('已初始化');
    expect(result.stderr).toContain('--force');
    expect(writes).toEqual([]);
  });

  it('標記檔內容不是合法 uuid → 拒絕,不寫指標(帳本身分壞了,要人看)', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    writeMarker(learning, 'garbage\n');
    const before = treeWithContent(box.root);
    const writes: string[] = [];
    const result = initVault({ learningDir: learning, env: childEnv(box), homedir: () => box.home, io: ioRecording(writes) });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('vault-id');
    expect(writes).toEqual([]);
    expect(treeWithContent(box.root)).toEqual(before);
  });
});

describe('vault show(第 4 條)', () => {
  function setup(box: Box, markerText: string | null, pointerId = UUID_A): string {
    const learning = learningDir(box.root);
    if (markerText !== null) writeMarker(learning, markerText);
    writePointerRaw(box, JSON.stringify({ learning_dir: learning, vault_id: pointerId }));
    return learning;
  }

  it('相符時印出指標位置、learning_dir、標記存在、相符,exit 0', () => {
    const box = sandbox();
    const learning = setup(box, `${UUID_A}\n`);
    const result = showVault({ env: childEnv(box), homedir: () => box.home, io: ioRecording([]) });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`pointer: ${pointerPathOf(box)}`);
    expect(result.stdout).toContain(`learning_dir: ${learning}`);
    expect(result.stdout).toContain('marker: present');
    expect(result.stdout).toContain('match: yes');
  });

  it('標記不符:exit 非 0,match: no', () => {
    const box = sandbox();
    setup(box, `${UUID_B}\n`);
    const result = showVault({ env: childEnv(box), homedir: () => box.home, io: ioRecording([]) });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain('marker: present');
    expect(result.stdout).toContain('match: no');
  });

  it('標記不存在:exit 非 0,marker: missing', () => {
    const box = sandbox();
    setup(box, null);
    const result = showVault({ env: childEnv(box), homedir: () => box.home, io: ioRecording([]) });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain('marker: missing');
    expect(result.stdout).toContain('match: no');
  });

  it('指標不存在 / 讀不到:exit 非 0', () => {
    const box = sandbox();
    expect(showVault({ env: childEnv(box), homedir: () => box.home, io: ioRecording([]) }).exitCode).not.toBe(0);
    writePointerRaw(box, '{');
    const broken = showVault({ env: childEnv(box), homedir: () => box.home, io: ioRecording([]) });
    expect(broken.exitCode).not.toBe(0);
    expect(broken.stdout).toContain('match: no');
  });

  it('show 不寫任何東西', () => {
    const box = sandbox();
    setup(box, `${UUID_A}\n`);
    const before = treeWithContent(box.root);
    const writes: string[] = [];
    showVault({ env: childEnv(box), homedir: () => box.home, io: ioRecording(writes) });
    expect(writes).toEqual([]);
    expect(treeWithContent(box.root)).toEqual(before);
  });
});

describe('CLI(子程序,HOME / XDG 在沙箱)', () => {
  function cli(box: Box, args: string[]): { status: number | null; stdout: string; stderr: string } {
    // cwd 是 repo 根(tsx 要從那裡解析得到);HOME / XDG 是沙箱,vault.ts 不看 cwd。
    const r = spawnSync(process.execPath, ['--import=tsx', join(REPO, 'scripts/vault.ts'), ...args], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 60_000,
      env: childEnv(box),
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  it('init → show 相符;再 init 一次是「已初始化」;沒有暫存檔殘留', () => {
    const box = sandbox();
    const learning = learningDir(box.root);
    const init = cli(box, ['init', '--learning-dir', learning]);
    expect(init.status, `${init.stdout}\n${init.stderr}`).toBe(0);
    const show = cli(box, ['show']);
    expect(show.status, `${show.stdout}\n${show.stderr}`).toBe(0);
    expect(show.stdout).toContain('match: yes');
    const again = cli(box, ['init', '--learning-dir', learning]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('已初始化');
    expect(readdirSync(join(learning, 'config'))).toEqual(['vault-id']);
    expect(readdirSync(join(box.config, 'llm-learning-cards'))).toEqual(['vault.json']);
    expect(snapshotRealPointer()).toEqual(realPointerBefore);
  });

  it('沒有指標時 show 非 0;不認得的子指令非 0', () => {
    const box = sandbox();
    expect(cli(box, ['show']).status).not.toBe(0);
    expect(cli(box, ['bogus']).status).not.toBe(0);
    expect(snapshotRealPointer()).toEqual(realPointerBefore);
  });
});

describe('驗收補測(T5 測試 agent):init 的覆寫判定', () => {
  function initOnce(box: Box, learning: string, extra: { force?: boolean; randomUUID?: () => string } = {}): ReturnType<typeof initVault> {
    return initVault({ learningDir: learning, env: childEnv(box), homedir: () => box.home, io: ioRecording([]), ...extra });
  }

  it('指標指向 A,B 的標記剛好是同一個 id(複製來的):init B 不算「已初始化」,不加 --force 拒絕,加了才改指向 B', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    const b = learningDir(box.root, 'B');
    writeMarker(a, `${UUID_A}\n`);
    writeMarker(b, `${UUID_A}\n`);
    expect(initOnce(box, a).exitCode).toBe(0);
    const before = readFileSync(pointerPathOf(box), 'utf8');

    const refused = initOnce(box, b);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stdout).not.toContain('已初始化');
    expect(refused.stderr).toContain('--force');
    expect(refused.stderr).toContain(a);
    expect(readFileSync(pointerPathOf(box), 'utf8')).toBe(before);

    const forced = initOnce(box, b, { force: true });
    expect(forced.exitCode).toBe(0);
    expect(readPointer(box)).toEqual({ learning_dir: b, vault_id: UUID_A });
  });

  it('指標指向這裡,但標記檔不存在:不加 --force 拒絕(說出標記與指標 id 的前 8 碼),加了才重建標記', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, `${UUID_A}\n`);
    expect(initOnce(box, a).exitCode).toBe(0);
    rmSync(join(a, 'config', 'vault-id'));
    const before = readFileSync(pointerPathOf(box), 'utf8');
    const writes: string[] = [];

    const refused = initVault({ learningDir: a, env: childEnv(box), homedir: () => box.home, io: ioRecording(writes) });
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toContain('config/vault-id');
    expect(refused.stderr).toContain(UUID_A.slice(0, 8));
    expect(refused.stderr).not.toContain(UUID_A);
    expect(refused.stderr).toContain('--force');
    expect(writes).toEqual([]);
    expect(readFileSync(pointerPathOf(box), 'utf8')).toBe(before);

    const forced = initOnce(box, a, { force: true, randomUUID: () => UUID_B });
    expect(forced.exitCode).toBe(0);
    expect(readFileSync(join(a, 'config', 'vault-id'), 'utf8')).toBe(`${UUID_B}\n`);
    expect(readPointer(box)).toEqual({ learning_dir: a, vault_id: UUID_B });
  });

  it('--learning-dir 沒給或是相對路徑:訊息帶出收到的值與用法', () => {
    const box = sandbox();
    const none = initOnce(box, '');
    expect(none.exitCode).not.toBe(0);
    expect(none.stderr).toContain('(沒給)');
    expect(none.stderr).toContain('用法');
    const rel = initOnce(box, 'some/relative/dir');
    expect(rel.exitCode).not.toBe(0);
    expect(rel.stderr).toContain('some/relative/dir');
    expect(rel.stderr).toContain('用法');
  });

  it('全新與沿用既有標記,輸出各自說明是哪一種;stderr 是空的', () => {
    const box = sandbox();
    const fresh = learningDir(box.root, 'fresh');
    const first = initOnce(box, fresh, { randomUUID: () => UUID_A });
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('已建立指標');
    expect(first.stdout).toContain('新的帳本身分');
    expect(first.stdout).not.toContain('沿用');
    expect(first.stderr).toBe('');

    const box2 = sandbox();
    const reuse = learningDir(box2.root, 'reuse');
    writeMarker(reuse, `${UUID_B}\n`);
    const second = initOnce(box2, reuse);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('沿用既有的帳本身分標記');
    expect(second.stdout).not.toContain('新的帳本身分');
    expect(second.stderr).toBe('');
  });
});

describe('驗收補測(T5 測試 agent):show 的每一種狀態,逐行與錯誤說明', () => {
  function show(box: Box): ReturnType<typeof showVault> {
    return showVault({ env: childEnv(box), homedir: () => box.home, io: ioRecording([]) });
  }
  const lines = (r: ReturnType<typeof showVault>): string[] => r.stdout.split('\n');

  it('沒有指標', () => {
    const box = sandbox();
    const r = show(box);
    expect(r.exitCode).toBe(1);
    expect(lines(r)).toEqual([`pointer: ${pointerPathOf(box)}`, 'learning_dir: (no pointer)', 'marker: unknown', 'match: no', '']);
    expect(r.stderr).toContain('指標檔不存在');
    expect(r.stderr).toContain('init');
  });

  it('指標壞掉', () => {
    const box = sandbox();
    writePointerRaw(box, '{');
    const r = show(box);
    expect(r.exitCode).toBe(1);
    expect(lines(r)).toEqual([`pointer: ${pointerPathOf(box)}`, 'learning_dir: (unreadable)', 'marker: unknown', 'match: no', '']);
    expect(r.stderr).toContain('指標檔讀不到');
  });

  it('learning_dir 不存在', () => {
    const box = sandbox();
    const gone = join(box.root, 'gone');
    writePointerRaw(box, JSON.stringify({ learning_dir: gone, vault_id: UUID_A }));
    const r = show(box);
    expect(r.exitCode).toBe(1);
    expect(lines(r)).toEqual([`pointer: ${pointerPathOf(box)}`, `learning_dir: ${gone}`, 'marker: missing', 'match: no', '']);
    expect(r.stderr).toContain('learning_dir 不存在');
  });

  it('標記不存在', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writePointerRaw(box, JSON.stringify({ learning_dir: a, vault_id: UUID_A }));
    const r = show(box);
    expect(r.exitCode).toBe(1);
    expect(lines(r)).toEqual([`pointer: ${pointerPathOf(box)}`, `learning_dir: ${a}`, 'marker: missing', 'match: no', '']);
    expect(r.stderr).toContain('config/vault-id 不存在');
  });

  it('標記不符', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, `${UUID_B}\n`);
    writePointerRaw(box, JSON.stringify({ learning_dir: a, vault_id: UUID_A }));
    const r = show(box);
    expect(r.exitCode).toBe(1);
    expect(lines(r)).toEqual([`pointer: ${pointerPathOf(box)}`, `learning_dir: ${a}`, 'marker: present', 'match: no', '']);
    expect(r.stderr).toContain('不符');
  });

  it('相符:四行、exit 0、stderr 空', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, `${UUID_A}\n`);
    writePointerRaw(box, JSON.stringify({ learning_dir: a, vault_id: UUID_A }));
    const r = show(box);
    expect(r.exitCode).toBe(0);
    expect(lines(r)).toEqual([`pointer: ${pointerPathOf(box)}`, `learning_dir: ${a}`, 'marker: present', 'match: yes', '']);
    expect(r.stderr).toBe('');
  });
});

describe('驗收補測(T5 測試 agent):CLI 把 --force 與路徑接到 init', () => {
  function cliRun(box: Box, args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, ['--import=tsx', join(REPO, 'scripts/vault.ts'), ...args], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 60_000,
      env: childEnv(box),
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  it('init A;init B 不加 --force 退出非 0 且指標沒變;加 --force 退出 0、指標改指 B、先印舊指標', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    const b = learningDir(box.root, 'B');
    expect(cliRun(box, ['init', '--learning-dir', a]).status).toBe(0);
    const before = readFileSync(pointerPathOf(box), 'utf8');

    const refused = cliRun(box, ['init', '--learning-dir', b]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('--force');
    expect(readFileSync(pointerPathOf(box), 'utf8')).toBe(before);

    const forced = cliRun(box, ['init', '--learning-dir', b, '--force']);
    expect(forced.status, `${forced.stdout}\n${forced.stderr}`).toBe(0);
    expect(forced.stdout).toContain('舊指標(將被丟棄)');
    expect(forced.stdout).toContain(a);
    expect(readPointer(box).learning_dir).toBe(b);
    expect(snapshotRealPointer()).toEqual(realPointerBefore);
  });

  it('init 沒給 --learning-dir 或值是另一個旗標:退出非 0,什麼都不建', () => {
    const box = sandbox();
    expect(cliRun(box, ['init']).status).not.toBe(0);
    const flagAsValue = cliRun(box, ['init', '--learning-dir', '--force']);
    expect(flagAsValue.status).not.toBe(0);
    expect(flagAsValue.stderr).toContain('(沒給)');
    expect(readdirSync(box.config)).toEqual([]);
    expect(snapshotRealPointer()).toEqual(realPointerBefore);
  });
});

describe('驗收補測(T5 測試 agent):輸出的精確形狀', () => {
  function initOnce(box: Box, learning: string, extra: { force?: boolean } = {}): ReturnType<typeof initVault> {
    return initVault({ learningDir: learning, env: childEnv(box), homedir: () => box.home, io: ioRecording([]), ...extra });
  }

  it('拒絕時 stdout 是空的、stderr 剛好以一個換行結尾', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    const b = learningDir(box.root, 'B');
    expect(initOnce(box, a).exitCode).toBe(0);
    for (const r of [initOnce(box, b), initOnce(box, 'relative/dir'), initOnce(box, '')]) {
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr.endsWith('\n')).toBe(true);
      expect(r.stderr.endsWith('\n\n')).toBe(false);
    }
  });

  it('「已初始化」的整段輸出與 stderr', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    expect(initOnce(box, a).exitCode).toBe(0);
    const again = initOnce(box, a);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toBe(`已初始化:${pointerPathOf(box)} 指向這個 learning_dir,帳本身分相符,沒有改任何檔。\n`);
    expect(again.stderr).toBe('');
  });

  it('--force 的輸出:先印舊指標原文(結尾沒換行就補一個,有換行不重複),再說已覆寫', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    const b = learningDir(box.root, 'B');
    const rawNoNewline = JSON.stringify({ learning_dir: a, vault_id: UUID_B });
    writePointerRaw(box, rawNoNewline);
    const first = initOnce(box, b, { force: true });
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toBe(`舊指標(將被丟棄):\n${rawNoNewline}\n已用 --force 覆寫指標 ${pointerPathOf(box)}\n`);
    expect(first.stderr).toBe('');

    const box2 = sandbox();
    const a2 = learningDir(box2.root, 'A');
    const b2 = learningDir(box2.root, 'B');
    const rawWithNewline = `${JSON.stringify({ learning_dir: a2, vault_id: UUID_B })}\n`;
    writePointerRaw(box2, rawWithNewline);
    const second = initOnce(box2, b2, { force: true });
    expect(second.stdout).toBe(`舊指標(將被丟棄):\n${rawWithNewline}已用 --force 覆寫指標 ${pointerPathOf(box2)}\n`);
  });
});

describe('驗收補測(T5 測試 agent):CLI 入口層', () => {
  function cliRun(box: Box, args: string[], extraEnv: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, ['--import=tsx', join(REPO, 'scripts/vault.ts'), ...args], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...childEnv(box), ...extraEnv },
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  it('被別的模組 import 時不會自己跑 main(沒有輸出、退出碼 0)', () => {
    const box = sandbox();
    const r = spawnSync(process.execPath, ['--import=tsx', '-e', `await import(${JSON.stringify(join(REPO, 'scripts/vault.ts'))});`], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 60_000,
      env: childEnv(box),
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('沒有子指令與不認得的子指令都印用法、退出 1', () => {
    const box = sandbox();
    for (const args of [[], ['bogus']]) {
      const r = cliRun(box, args);
      expect(r.status).toBe(1);
      expect(r.stderr).toBe('用法:npx tsx scripts/vault.ts init --learning-dir <絕對路徑> [--force] | npx tsx scripts/vault.ts show\n');
      expect(r.stdout).toBe('');
    }
  });

  it('init 途中丟出意外錯誤(設定目錄唯讀):退出 1,stderr 以「vault.ts 失敗」開頭,不留殘檔', () => {
    if (process.getuid?.() === 0) return; // root 不受唯讀目錄限制,這個情境造不出來
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    chmodSync(box.config, 0o500);
    try {
      const r = cliRun(box, ['init', '--learning-dir', a]);
      expect(r.status).toBe(1);
      expect(r.stderr.startsWith('vault.ts 失敗')).toBe(true);
      expect(readdirSync(box.config)).toEqual([]);
    } finally {
      chmodSync(box.config, 0o700);
    }
  });

  it('init 的 stdout 與 stderr 由結果決定:成功時 stdout 有字 stderr 空;拒絕時 stderr 有字 stdout 空', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    const b = learningDir(box.root, 'B');
    const ok = cliRun(box, ['init', '--learning-dir', a]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).not.toBe('');
    expect(ok.stderr).toBe('');
    const no = cliRun(box, ['init', '--learning-dir', b]);
    expect(no.status).toBe(1);
    expect(no.stdout).toBe('');
    expect(no.stderr).not.toBe('');
  });
});

// ---------------------------------------------------------------- T8 B:壞標記可以 --force 重建

describe('T8 B:標記檔內容不是合法 uuid —— 不加 --force 拒絕,加了才重建', () => {
  const BAD_MARKERS: Array<[string, string]> = [
    ['不是 uuid 的文字', 'not-a-uuid\n'],
    ['空檔', ''],
    ['大寫 uuid', 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE\n'],
    ['結尾是 \\r\\n', `${UUID_A}\r\n`],
    ['結尾兩個換行', `${UUID_A}\n\n`],
  ];

  function run(box: Box, learning: string, extra: { force?: boolean; randomUUID?: () => string } = {}): ReturnType<typeof initVault> {
    return initVault({ learningDir: learning, env: childEnv(box), homedir: () => box.home, io: ioRecording([]), ...extra });
  }

  it.each(BAD_MARKERS)('must_catch: init 不加 --force 就重建壞標記 —— %s:拒絕,exit 非 0,整棵樹連內容都不變,訊息說可以 --force 且舊內容會被丟棄', (_label, bad) => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, bad);
    const before = treeWithContent(box.root);
    const r = run(box, a);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('--force');
    expect(r.stderr).toContain('丟棄');
    expect(treeWithContent(box.root)).toEqual(before);
  });

  it.each(BAD_MARKERS)('--force 重建 —— %s:exit 0,先印「舊標記(將被丟棄):」與舊內容,標記與指標都是合法 uuid 且相同', (_label, bad) => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, bad);
    const r = run(box, a, { force: true, randomUUID: () => UUID_B });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout.startsWith('舊標記(將被丟棄):')).toBe(true);
    expect(readFileSync(join(a, 'config', 'vault-id'), 'utf8')).toBe(`${UUID_B}\n`);
    expect(readPointer(box)).toEqual({ learning_dir: a, vault_id: UUID_B });
    expect(readdirSync(join(a, 'config'))).toEqual(['vault-id']);
  });

  it('must_catch: --force 沒有印出舊內容 —— 舊內容在「舊標記(將被丟棄):」之後、「新」的結果之前,原文可見', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, 'OLD-MARKER-CONTENT\n');
    const r = run(box, a, { force: true, randomUUID: () => UUID_B });
    const head = r.stdout.indexOf('舊標記(將被丟棄):');
    const body = r.stdout.indexOf('OLD-MARKER-CONTENT');
    expect(head).toBe(0);
    expect(body).toBeGreaterThan(head);
    expect(r.stdout).not.toContain(UUID_B.slice(0, 8) + 'OLD'); // 新舊沒有混在一起
  });

  it('舊內容最多印 200 位元組,控制字元以 \\xNN 顯示(不污染終端機)', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, `${'x'.repeat(500)}\n`);
    const long = run(box, a, { force: true, randomUUID: () => UUID_B });
    const runs = long.stdout.match(/x+/g) ?? [];
    expect(Math.max(...runs.map((r) => r.length))).toBe(200);

    const box2 = sandbox();
    const b = learningDir(box2.root, 'B');
    writeMarker(b, 'a\x07b\x1b[31mred');
    const ctrl = run(box2, b, { force: true, randomUUID: () => UUID_B });
    expect(ctrl.stdout).not.toContain('\x07');
    expect(ctrl.stdout).not.toContain('\x1b');
    expect(ctrl.stdout).toContain('\\x07');
    expect(ctrl.stdout).toContain('\\x1b');
  });

  it('驗收補測:可列印的邊界 —— 空白(0x20)與 ~(0x7e)原樣,0x1f 與 0x7f 才轉義', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, ' ~\x7f\x1f!');
    const r = run(box, a, { force: true, randomUUID: () => UUID_B });
    expect(r.stdout.startsWith('舊標記(將被丟棄):\n ~\\x7f\\x1f!\n')).toBe(true);
  });

  it('驗收補測:剛好 200 位元組不加註,201 位元組才加「共 N 位元組」', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, 'y'.repeat(200));
    const exact = run(box, a, { force: true, randomUUID: () => UUID_B });
    expect(exact.stdout).not.toContain('共 ');
    expect(exact.stdout.startsWith(`舊標記(將被丟棄):\n${'y'.repeat(200)}\n`)).toBe(true);

    const box2 = sandbox();
    const b = learningDir(box2.root, 'B');
    writeMarker(b, 'y'.repeat(201));
    const over = run(box2, b, { force: true, randomUUID: () => UUID_B });
    expect(over.stdout).toContain('…(共 201 位元組,只印前 200 位元組)');
  });

  it('驗收補測:--force 成功時 stdout 整段、stderr 空 —— 沿用指標 id 與產生新 id 各一條', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, `${UUID_A}\n`);
    expect(run(box, a).exitCode).toBe(0);
    writeMarker(a, 'bad');
    const reuse = run(box, a, { force: true });
    expect(reuse.stderr).toBe('');
    expect(reuse.stdout).toBe(
      `舊標記(將被丟棄):\nbad\n已用 --force 重建帳本身分標記 ${join(a, 'config', 'vault-id')}(沿用指標的帳本身分 ${UUID_A.slice(0, 8)},指標沒有改)\n`,
    );

    const box2 = sandbox();
    const b = learningDir(box2.root, 'B');
    writeMarker(b, 'bad');
    const fresh = run(box2, b, { force: true, randomUUID: () => UUID_B });
    expect(fresh.stderr).toBe('');
    expect(fresh.stdout).toBe(
      `舊標記(將被丟棄):\nbad\n已用 --force 重建帳本身分標記 ${join(b, 'config', 'vault-id')} 與指標 ${pointerPathOf(box2)}(新的帳本身分 ${UUID_B.slice(0, 8)})\n`,
    );
  });

  it('驗收補測:反斜線也要轉義(\\x5c)—— 否則舊內容裡的 `\\x07` 文字和真的 0x07 分不出來', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, 'ab\\x07cd\n');
    const r = run(box, a, { force: true, randomUUID: () => UUID_B });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('ab\\x5cx07cd');
    expect(r.stdout).not.toContain('ab\\x07cd');
  });

  it('驗收補測:空檔的舊標記要明說是空檔,不是印一個空白行讓人以為沒東西', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, '');
    const r = run(box, a, { force: true, randomUUID: () => UUID_B });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.startsWith('舊標記(將被丟棄):\n(空檔)\n')).toBe(true);
  });

  it('驗收補測:沿用指標 id 的那條路徑(指標指向同一處、vault_id 合法)也先印舊標記', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, `${UUID_A}\n`);
    expect(run(box, a).exitCode).toBe(0);
    writeMarker(a, 'OLD-GARBAGE-REUSE\n');
    const r = run(box, a, {
      force: true,
      randomUUID: () => {
        throw new Error('不該產生新 uuid');
      },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.startsWith('舊標記(將被丟棄):\n')).toBe(true);
    expect(r.stdout).toContain('OLD-GARBAGE-REUSE');
  });

  it('指標指向同一處、指標的 vault_id 合法 → 重建時沿用指標的 id(帳本身分不變,不產生新 uuid)', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, `${UUID_A}\n`);
    expect(run(box, a).exitCode).toBe(0); // 先建好指標(id = UUID_A)
    writeMarker(a, 'garbage\n');
    const r = run(box, a, {
      force: true,
      randomUUID: () => {
        throw new Error('不該產生新 uuid');
      },
    });
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(a, 'config', 'vault-id'), 'utf8')).toBe(`${UUID_A}\n`);
    expect(readPointer(box)).toEqual({ learning_dir: a, vault_id: UUID_A });
  });

  it('指標指向同一處、但指標的 vault_id 自己不是合法 uuid → 產生新 uuid,標記與指標一起改', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, 'garbage\n');
    writePointerRaw(box, JSON.stringify({ learning_dir: a, vault_id: 'not-a-uuid' }));
    const r = run(box, a, { force: true, randomUUID: () => UUID_B });
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(a, 'config', 'vault-id'), 'utf8')).toBe(`${UUID_B}\n`);
    expect(readPointer(box)).toEqual({ learning_dir: a, vault_id: UUID_B });
  });

  it('指標指向別處(合法)、這裡的標記是壞的 → --force:兩份舊內容(舊指標與舊標記)都先印出來,指標改指這裡並用新 uuid', () => {
    const box = sandbox();
    const here = learningDir(box.root, 'here');
    const there = learningDir(box.root, 'there');
    writeMarker(here, 'BROKEN-HERE\n');
    writePointerRaw(box, JSON.stringify({ learning_dir: there, vault_id: UUID_A }));
    const r = run(box, here, { force: true, randomUUID: () => UUID_B });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('舊標記(將被丟棄):');
    expect(r.stdout).toContain('BROKEN-HERE');
    expect(r.stdout).toContain('舊指標(將被丟棄):');
    expect(r.stdout).toContain(there);
    expect(readPointer(box)).toEqual({ learning_dir: here, vault_id: UUID_B });
    expect(readFileSync(join(here, 'config', 'vault-id'), 'utf8')).toBe(`${UUID_B}\n`);
  });

  it('標記是合法的(或不存在)時,--force 的行為不變:不印「舊標記」', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    const r = run(box, a, { randomUUID: () => UUID_B });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('舊標記');
    const again = run(box, a, { force: true });
    expect(again.stdout).not.toContain('舊標記');
  });

  it('CLI(子程序):壞標記 init 不加 --force 退出非 0;加 --force 退出 0 且 show 相符', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    writeMarker(a, 'not-a-uuid\n');
    const env = childEnv(box);
    const cli = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
      const r = spawnSync(process.execPath, ['--import=tsx', join(REPO, 'scripts/vault.ts'), ...args], { cwd: REPO, encoding: 'utf8', timeout: 60_000, env });
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    expect(cli(['init', '--learning-dir', a]).status).not.toBe(0);
    const forced = cli(['init', '--learning-dir', a, '--force']);
    expect(forced.status, `${forced.stdout}\n${forced.stderr}`).toBe(0);
    expect(forced.stdout).toContain('舊標記(將被丟棄)');
    expect(cli(['show']).status).toBe(0);
    expect(snapshotRealPointer()).toEqual(realPointerBefore);
  });
});

// ---------------------------------------------------------------- T8 D:symlink 與同時 init

describe('T8 D:init 與 symlink', () => {
  function run(box: Box, learning: string): ReturnType<typeof initVault> {
    return initVault({ learningDir: learning, env: childEnv(box), homedir: () => box.home, io: ioRecording([]), randomUUID: () => UUID_A });
  }

  it('--learning-dir 給的是 symlink:指標裡存的是給的那條路徑(不解 symlink),標記寫進 symlink 指到的真目錄', () => {
    const box = sandbox();
    const real = learningDir(box.root, 'real');
    const link = join(box.root, 'link');
    symlinkSync(real, link);
    const r = run(box, link);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(readPointer(box).learning_dir).toBe(link);
    expect(readFileSync(join(real, 'config', 'vault-id'), 'utf8')).toBe(`${UUID_A}\n`);
  });

  it('懸空的 symlink(目標不存在)→ 拒絕,什麼都不建', () => {
    const box = sandbox();
    const link = join(box.root, 'dangling');
    symlinkSync(join(box.root, 'nowhere'), link);
    const before = readdirSync(box.root).sort();
    const r = run(box, link);
    expect(r.exitCode).not.toBe(0);
    expect(readdirSync(box.root).sort()).toEqual(before); // 沒有長出 nowhere/ 之類的東西
    expect(readdirSync(box.config)).toEqual([]); // 沒有指標
  });
});

describe('T8 D:兩個 init 同時跑,不會留下壞掉的指標檔', () => {
  const ROUNDS = 20;
  const PARALLEL = 3;

  function spawnInit(box: Box, learning: string): Promise<number | null> {
    return new Promise((done) => {
      const child = spawn(process.execPath, ['--import=tsx', join(REPO, 'scripts/vault.ts'), 'init', '--learning-dir', learning], {
        cwd: REPO,
        env: childEnv(box),
        stdio: 'ignore',
      });
      child.on('close', (code) => done(code));
      child.on('error', () => done(-1));
    });
  }

  it(`${PARALLEL} 個子程序同時 init 同一個全新 learning_dir,重複 ${ROUNDS} 輪:退出碼只有 0 或 1;指標檔存在就是合法 JSON;沒有 *.tmp 殘檔;標記存在就是合法 uuid`, async () => {
    let idMismatch = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const box = sandbox();
      const learning = learningDir(box.root, 'L');
      const codes = await Promise.all(Array.from({ length: PARALLEL }, () => spawnInit(box, learning)));
      for (const c of codes) expect([0, 1], `round ${round} exit codes ${codes.join(',')}`).toContain(c);

      const pointerDir = join(box.config, 'llm-learning-cards');
      const leftovers = [...(readdirSync(pointerDir)), ...(readdirSync(join(learning, 'config')))].filter((n) => n.endsWith('.tmp'));
      expect(leftovers, `round ${round} 暫存檔殘留`).toEqual([]);

      let pointerId: string | undefined;
      try {
        const raw = readFileSync(join(pointerDir, 'vault.json'), 'utf8');
        const parsed = JSON.parse(raw) as { learning_dir: unknown; vault_id: unknown };
        expect(typeof parsed.learning_dir, `round ${round} learning_dir 型別`).toBe('string');
        expect(typeof parsed.vault_id, `round ${round} vault_id 型別`).toBe('string');
        pointerId = parsed.vault_id as string;
      } catch (err) {
        // 檔案根本不存在是可以的(三個都在建立途中失敗);存在卻解析不了不可以。
        expect((err as NodeJS.ErrnoException).code, `round ${round}: 指標檔存在但不是合法 JSON:${String(err)}`).toBe('ENOENT');
      }
      let markerId: string | undefined;
      try {
        markerId = readFileSync(join(learning, 'config', 'vault-id'), 'utf8').replace(/\n$/, '');
        expect(markerId, `round ${round} 標記不是合法 uuid`).toMatch(UUID_RE);
      } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
      }
      if (pointerId !== undefined && markerId !== undefined && pointerId !== markerId) idMismatch += 1;
    }
    // 已知競爭:指標與標記的 id 可能不一致(本張不修);次數記在報告裡。
    console.info(`[T8 D] ${ROUNDS} 輪裡指標與標記 id 不一致:${idMismatch} 輪`);
  }, 180_000);
});

// ---------------------------------------------------------------- T8 E:指標檔權限 0600

describe('T8 E:init 寫出的指標檔是 0600', () => {
  function initReal(box: Box, learning: string, force = false): ReturnType<typeof initVault> {
    return initVault({ learningDir: learning, env: childEnv(box), homedir: () => box.home, io: realVaultIo(), force, randomUUID: () => UUID_A });
  }

  /**
   * 換 umask 跑一段。Stryker 的 vitest runner 固定用 worker threads(pool: 'threads'),
   * worker 裡 `process.umask(mask)` 會丟 ERR_WORKER_UNSUPPORTED_OPERATION —— 那時候沒辦法換,
   * 用當下的 umask 跑(一般是 022,仍然分得出 0600 和 0644)。一般的 vitest(forks)照指定的 mask 跑。
   */
  let effectiveMask = 0;
  function withUmask<T>(mask: number, fn: () => T): T {
    let old: number | undefined;
    try {
      old = process.umask(mask);
      effectiveMask = mask;
    } catch {
      old = undefined;
      effectiveMask = process.umask(); // 讀(不設)在 worker 裡是允許的
    }
    try {
      return fn();
    } finally {
      if (old !== undefined) process.umask(old);
    }
  }

  it.each([['000', 0o000], ['022', 0o022]] as const)('must_catch: 指標檔權限放寬 —— umask %s 下,新建的指標檔 mode 是 0600', (_label, mask) => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    const r = withUmask(mask, () => initReal(box, a));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(statSync(pointerPathOf(box)).mode & 0o777).toBe(0o600);
  });

  it.each([['000', 0o000], ['022', 0o022]] as const)('--force 覆寫原本是 0664 的舊指標 —— umask %s 下,覆寫後是 0600', (_label, mask) => {
    const box = sandbox();
    const here = learningDir(box.root, 'here');
    const there = learningDir(box.root, 'there');
    writePointerRaw(box, JSON.stringify({ learning_dir: there, vault_id: UUID_B }));
    chmodSync(pointerPathOf(box), 0o664);
    const r = withUmask(mask, () => initReal(box, here, true));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(statSync(pointerPathOf(box)).mode & 0o777).toBe(0o600);
  });

  it('沒有一個瞬間比 0600 寬:指標檔 rename 到位的那一刻,來源暫存檔就已經是 0600(不是 rename 完才 chmod)', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    renameSeen.length = 0;
    withUmask(0o000, () => initReal(box, a));
    const forPointer = renameSeen.filter((r) => r.to === pointerPathOf(box));
    expect(forPointer.length).toBeGreaterThan(0);
    for (const r of forPointer) expect(r.mode).toBe(0o600);
  });

  it('標記檔不在本條範圍:仍走原本的權限(跟 learning/ 一樣),沒有被改成 0600', () => {
    const box = sandbox();
    const a = learningDir(box.root, 'A');
    withUmask(0o022, () => initReal(box, a));
    // 標記檔沿用 umask(022 下是 0644);在 worker threads 裡換不了 umask,就用當下的那個算
    expect(statSync(join(a, 'config', 'vault-id')).mode & 0o777).toBe(0o666 & ~effectiveMask);
  });
});
