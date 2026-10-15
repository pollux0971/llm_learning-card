/**
 * T5:使用者層指標、帳本身分、花費不得在未驗證時回 0。
 * 所有讀寫都在 mkdtemp;HOME / XDG_CONFIG_HOME / XDG_RUNTIME_DIR 指過去。
 * 守門只 stat 真指標檔,不讀內容。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../schema/atomic-write.js';
import { GatewayLlmRouter } from './router-gateway.js';
import { readDailySpend, type SpendPrices } from './spend.js';
import {
  ExplicitLedger,
  VAULT_INIT_CMD,
  VAULT_SHOW_CMD,
  createLiveGatewayRouter,
  ledgerFromExplicitLog,
  realVaultIo,
  resolveVerifiedLedger,
  vaultAtomicWrite,
  vaultIdsEqual,
  vaultPointerPath,
  type VaultResolveDeps,
} from './ledger.js';

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
const PRICES: SpendPrices = { inPerM: 2.5, outPerM: 10 };
const UUID_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const UUID_B = '11111111-2222-4333-8444-555555555555';
const UUID_PREFIX_TWIN = 'aaaaaaaa-0000-4000-8000-000000000000';

const sandboxes: string[] = [];
function sandbox(): { root: string; home: string; config: string; runtime: string } {
  const root = mkdtempSync(join(tmpdir(), 't5-vault-'));
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
  const after = snapshotRealPointer();
  expect(after).toEqual(realPointerBefore);
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

function pointerOf(config: string): string {
  return join(config, 'llm-learning-cards', 'vault.json');
}

function writePointer(config: string, learningDir: string, vaultId: string): void {
  const path = pointerOf(config);
  mkdirSync(join(config, 'llm-learning-cards'), { recursive: true });
  writeFileSync(path, JSON.stringify({ learning_dir: learningDir, vault_id: vaultId }));
}

function learningWithMarker(root: string, name: string, vaultId: string | null): string {
  const dir = join(root, name);
  mkdirSync(join(dir, 'config'), { recursive: true });
  if (vaultId !== null) writeFileSync(join(dir, 'config', 'vault-id'), `${vaultId}\n`);
  return dir;
}

function depsFor(box: { home: string; config: string }, readSpy?: (path: string) => void): VaultResolveDeps {
  return {
    env: { XDG_CONFIG_HOME: box.config, HOME: box.home },
    homedir: () => box.home,
    readFile: (path) => {
      readSpy?.(path);
      return readFileSync(path, 'utf8');
    },
    exists: (path) => {
      try {
        statSync(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function expectBothHints(message: string): void {
  expect(message).toContain(VAULT_INIT_CMD);
  expect(message).toContain(VAULT_SHOW_CMD);
  expect(VAULT_INIT_CMD).toBe('npx tsx scripts/vault.ts init');
  expect(VAULT_SHOW_CMD).toBe('npx tsx scripts/vault.ts show');
}

describe('指標檔位置', () => {
  it('XDG_CONFIG_HOME 優先於 ~/.config', () => {
    const box = sandbox();
    expect(vaultPointerPath({ XDG_CONFIG_HOME: box.config }, () => box.home)).toBe(pointerOf(box.config));
  });

  it('XDG_CONFIG_HOME 空字串視同未設', () => {
    const box = sandbox();
    expect(vaultPointerPath({ XDG_CONFIG_HOME: '' }, () => box.home)).toBe(
      join(box.home, '.config', 'llm-learning-cards', 'vault.json'),
    );
  });

  it('沒設 XDG_CONFIG_HOME 時用 homedir()/.config', () => {
    const box = sandbox();
    expect(vaultPointerPath({}, () => box.home)).toBe(join(box.home, '.config', 'llm-learning-cards', 'vault.json'));
  });
});

describe('標記比對', () => {
  it('逐字相等,容許且只容許一個結尾換行', () => {
    expect(vaultIdsEqual(UUID_A, UUID_A)).toBe(true);
    expect(vaultIdsEqual(`${UUID_A}\n`, UUID_A)).toBe(true);
    expect(vaultIdsEqual(`${UUID_A}\n\n`, UUID_A)).toBe(false);
    expect(vaultIdsEqual(`${UUID_A}\r\n`, UUID_A)).toBe(false);
  });

  it('must_catch: 標記只比前綴不得放行', () => {
    expect(vaultIdsEqual(UUID_PREFIX_TWIN, UUID_A)).toBe(false);
    expect(vaultIdsEqual(UUID_A.slice(0, 8), UUID_A)).toBe(false);
  });

  it('不分大小寫不得放行;uuid 格式不合也算不符', () => {
    expect(vaultIdsEqual(UUID_A.toUpperCase(), UUID_A)).toBe(false);
    expect(vaultIdsEqual('not-a-uuid', 'not-a-uuid')).toBe(false);
    expect(vaultIdsEqual(UUID_A, 'not-a-uuid')).toBe(false);
  });
});

describe('解析器的四種拒絕', () => {
  it('must_catch: 指標檔不存在必須拒絕且不退回 git', () => {
    const box = sandbox();
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('pointer-missing');
    expectBothHints(result.message);
    expect(result.message).not.toContain('git-common-dir');
  });

  it('指標檔讀不到(JSON 壞)必須拒絕', () => {
    const box = sandbox();
    const path = pointerOf(box.config);
    mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
    writeFileSync(path, '{');
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('pointer-unreadable');
    expectBothHints(result.message);
  });

  it('欄位缺或型別錯算讀不到', () => {
    const box = sandbox();
    mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
    writeFileSync(pointerOf(box.config), JSON.stringify({ learning_dir: 1, vault_id: UUID_A }));
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('pointer-unreadable');
  });

  it('must_catch: learning_dir 相對路徑必須拒絕', () => {
    const box = sandbox();
    mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
    writeFileSync(pointerOf(box.config), JSON.stringify({ learning_dir: 'learning', vault_id: UUID_A }));
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('pointer-unreadable');
    expectBothHints(result.message);
  });

  it('learning_dir 不存在必須拒絕', () => {
    const box = sandbox();
    writePointer(box.config, join(box.root, 'missing-learning'), UUID_A);
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('learning-dir-missing');
    expectBothHints(result.message);
  });

  it('must_catch: 標記不符必須拒絕', () => {
    const box = sandbox();
    const learning = learningWithMarker(box.root, 'learning', UUID_B);
    writePointer(box.config, learning, UUID_A);
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('marker-mismatch');
    expectBothHints(result.message);
  });

  it('標記檔不存在也算標記不符', () => {
    const box = sandbox();
    const learning = learningWithMarker(box.root, 'learning', null);
    writePointer(box.config, learning, UUID_A);
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('marker-mismatch');
  });

  it('相符時回 VerifiedLedger,log 在該 learning 的 state/log.jsonl', () => {
    const box = sandbox();
    const learning = learningWithMarker(box.root, 'learning', UUID_A);
    writePointer(box.config, learning, UUID_A);
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.kind).toBe('verified');
    expect(result.ledger.learningDir).toBe(learning);
    expect(result.ledger.logPath).toBe(join(learning, 'state', 'log.jsonl'));
    expect(result.ledger.vaultId).toBe(UUID_A);
  });
});

describe('明確參數優先,且不讀指標檔', () => {
  it('指標檔是壞的,明確 --log 仍得到 ExplicitLedger,而且沒讀指標檔', () => {
    const box = sandbox();
    mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
    writeFileSync(pointerOf(box.config), '{');
    const seen: string[] = [];
    const result = ledgerFromExplicitLog('/tmp/explicit-log.jsonl', 'test --log', depsFor(box, (path) => seen.push(path)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger).toBeInstanceOf(ExplicitLedger);
    expect(result.ledger.logPath).toBe('/tmp/explicit-log.jsonl');
    expect(result.ledger.kind).toBe('explicit');
    expect(seen.some((path) => path.endsWith('vault.json'))).toBe(false);
  });
});

describe('must_catch: 沒有帳本把手時 readDailySpend 不回 0', () => {
  it('沒給把手就丟錯,不是 { usd: 0 }', () => {
    expect(() => readDailySpend(undefined, '2026-10-15', PRICES)).toThrow();
    const router = new GatewayLlmRouter({});
    expect(() => router.dailySpend()).toThrow();
    let returnedZero = false;
    try {
      const spend = router.dailySpend();
      returnedZero = spend.usd === 0 && spend.calls === 0;
    } catch {
      returnedZero = false;
    }
    expect(returnedZero).toBe(false);
  });

  it('兩種把手檔案不存在 = 0,不是丟錯', () => {
    const box = sandbox();
    const missing = join(box.root, 'no-such-log.jsonl');
    const explicit = ExplicitLedger.unverified(missing, 'fresh install fixture');
    expect(readDailySpend(explicit, '2026-10-15', PRICES)).toEqual({ usd: 0, calls: 0 });
    const learning = learningWithMarker(box.root, 'learning', UUID_A);
    writePointer(box.config, learning, UUID_A);
    const resolved = resolveVerifiedLedger(depsFor(box));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(readDailySpend(resolved.ledger, '2026-10-15', PRICES)).toEqual({ usd: 0, calls: 0 });
  });
});

describe('must_catch: 真呼叫 router 不收 ExplicitLedger', () => {
  it('型別上 ExplicitLedger 不能傳給 createLiveGatewayRouter', () => {
    const explicit = ExplicitLedger.unverified('/tmp/x.jsonl', 'unverified');
    // @ts-expect-error 真呼叫 router 只收 VerifiedLedger
    createLiveGatewayRouter({ ledger: explicit });
    expect(explicit.kind).toBe('explicit');
  });
});

describe('原子寫入接線', () => {
  it('預設寫入器就是 schema 的 writeFileAtomic', () => {
    expect(vaultAtomicWrite).toBe(writeFileAtomic);
    expect(realVaultIo().writeAtomic).toBe(writeFileAtomic);
  });
});

describe('must_catch: 測試不得讀到或改到真的指標檔', () => {
  beforeAll(() => {
    sandbox();
  });

  it('這個檔案前後,真指標檔的存在與否與 mtime 不變(只 stat)', () => {
    expect(snapshotRealPointer()).toEqual(realPointerBefore);
  });
});
