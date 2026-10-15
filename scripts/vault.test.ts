/**
 * T5 第 4、5 條:`scripts/vault.ts init` / `show`。
 *
 * 讀寫只在 mkdtemp。HOME / XDG_CONFIG_HOME / XDG_RUNTIME_DIR 指到沙箱並在結束時還原;
 * spawn 的子程序也只拿到沙箱的值。守門只 stat 真指標檔,不讀內容。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { initVault, showVault, type VaultIo } from './vault.js';

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
    expect(cliRun(box, ['init', '--learning-dir', '--force']).status).not.toBe(0);
    expect(readdirSync(box.config)).toEqual([]);
    expect(snapshotRealPointer()).toEqual(realPointerBefore);
  });
});
