/**
 * T5:使用者層指標、帳本身分、花費不得在未驗證時回 0、真呼叫 router 只收 VerifiedLedger。
 *
 * 隔離(工單第 15 條):所有讀寫都在 mkdtemp;HOME / XDG_CONFIG_HOME / XDG_RUNTIME_DIR 指過去,
 * 結束時還原。守門只 stat 真指標檔(存在與否、mtime),不讀內容。
 *
 * 型別測試(工單第 8 條):`// @ts-expect-error` 那幾行是由 `npx tsc --noEmit` 驗的——
 * 拿掉型別限制,那幾行的 expect-error 就「沒有錯誤可以期待」,tsc 會報 TS2578 變紅。
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../schema/atomic-write.js';
import { GatewayLlmRouter, createLiveGatewayRouter } from './router-gateway.js';
import { MissingLedgerError, readDailySpend, type SpendPrices } from './spend.js';
import type { CloudAdapter } from './types.js';
import {
  ExplicitLedger,
  VAULT_INIT_CMD,
  VAULT_SHOW_CMD,
  VerifiedLedger,
  parseMarker,
  parsePointer,
  realVaultIo,
  resolveVerifiedLedger,
  vaultIdsEqual,
  vaultPointerPath,
  type VaultResolveDeps,
} from './ledger.js';

const ENV_KEYS = ['HOME', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR'] as const;
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;
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
  for (const k of ENV_KEYS) {
    const v = SAVED_ENV[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
  expect(snapshotRealPointer()).toEqual(realPointerBefore);
});

function pointerOf(config: string): string {
  return join(config, 'llm-learning-cards', 'vault.json');
}

function writePointerRaw(config: string, raw: string): void {
  mkdirSync(join(config, 'llm-learning-cards'), { recursive: true });
  writeFileSync(pointerOf(config), raw);
}

function writePointer(config: string, learningDir: string, vaultId: string): void {
  writePointerRaw(config, JSON.stringify({ learning_dir: learningDir, vault_id: vaultId }));
}

function learningWithMarker(root: string, name: string, markerText: string | null): string {
  const dir = join(root, name);
  mkdirSync(join(dir, 'config'), { recursive: true });
  if (markerText !== null) writeFileSync(join(dir, 'config', 'vault-id'), markerText);
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
  expect(message).toContain('npx tsx scripts/vault.ts init');
  expect(message).toContain('npx tsx scripts/vault.ts show');
  expect(VAULT_INIT_CMD).toBe('npx tsx scripts/vault.ts init');
  expect(VAULT_SHOW_CMD).toBe('npx tsx scripts/vault.ts show');
}

/** 每個雲端 provider 都注入的假 adapter——「假的 adapter 的 router」的型別前提。 */
const FAKE_ADAPTER: CloudAdapter = {
  async call() {
    throw new Error('型別測試不該真的呼叫');
  },
};

describe('指標檔位置(第 1 條)', () => {
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

  it('沒設 XDG_CONFIG_HOME 時用 homedir()/.config,而且是呼叫端注入的 homedir', () => {
    const box = sandbox();
    expect(vaultPointerPath({}, () => box.home)).toBe(join(box.home, '.config', 'llm-learning-cards', 'vault.json'));
  });
});

describe('標記比對(第 2 條)', () => {
  it('逐字相等,容許且只容許一個結尾換行', () => {
    expect(vaultIdsEqual(UUID_A, UUID_A)).toBe(true);
    expect(vaultIdsEqual(`${UUID_A}\n`, UUID_A)).toBe(true);
    expect(vaultIdsEqual(`${UUID_A}\n\n`, UUID_A)).toBe(false);
    expect(vaultIdsEqual(`${UUID_A}\r\n`, UUID_A)).toBe(false);
    expect(vaultIdsEqual(` ${UUID_A}`, UUID_A)).toBe(false);
    expect(vaultIdsEqual(`${UUID_A} `, UUID_A)).toBe(false);
    expect(vaultIdsEqual(`\n${UUID_A}`, UUID_A)).toBe(false);
  });

  it('must_catch: 標記只比前綴不得放行', () => {
    expect(vaultIdsEqual(UUID_PREFIX_TWIN, UUID_A)).toBe(false);
    expect(vaultIdsEqual(UUID_A.slice(0, 8), UUID_A)).toBe(false);
    expect(vaultIdsEqual(`${UUID_A}0`, UUID_A)).toBe(false);
    expect(vaultIdsEqual(UUID_A, UUID_A.slice(0, 8))).toBe(false);
  });

  it('不分大小寫不得放行;uuid 格式不合也算不符(兩邊同為大寫也一樣:大寫不是本系統寫出的格式)', () => {
    expect(vaultIdsEqual(UUID_A.toUpperCase(), UUID_A)).toBe(false);
    expect(vaultIdsEqual(UUID_A, UUID_A.toUpperCase())).toBe(false);
    expect(vaultIdsEqual(UUID_A.toUpperCase(), UUID_A.toUpperCase())).toBe(false);
    expect(vaultIdsEqual('not-a-uuid', 'not-a-uuid')).toBe(false);
    expect(vaultIdsEqual('', '')).toBe(false);
    expect(vaultIdsEqual(UUID_A, 'not-a-uuid')).toBe(false);
  });

  it('parseMarker 只回合法 uuid', () => {
    expect(parseMarker(`${UUID_A}\n`)).toBe(UUID_A);
    expect(parseMarker(UUID_A)).toBe(UUID_A);
    expect(parseMarker(`${UUID_A}\n\n`)).toBeUndefined();
    expect(parseMarker('garbage\n')).toBeUndefined();
  });
});

describe('parsePointer(第 1 條、第 6 條的「讀不到」)', () => {
  it('合法內容回 learning_dir 與 vault_id', () => {
    expect(parsePointer(JSON.stringify({ learning_dir: '/abs/learning', vault_id: UUID_A }))).toEqual({
      ok: true,
      learningDir: '/abs/learning',
      vaultId: UUID_A,
    });
  });

  it('JSON 壞、不是物件、欄位缺、型別錯、learning_dir 相對,全部是讀不到', () => {
    for (const raw of [
      '{',
      'null',
      '[]',
      '"x"',
      JSON.stringify({ vault_id: UUID_A }),
      JSON.stringify({ learning_dir: '/abs' }),
      JSON.stringify({ learning_dir: 1, vault_id: UUID_A }),
      JSON.stringify({ learning_dir: '/abs', vault_id: 7 }),
      JSON.stringify({ learning_dir: 'learning', vault_id: UUID_A }),
      JSON.stringify({ learning_dir: './learning', vault_id: UUID_A }),
    ]) {
      const parsed = parsePointer(raw);
      expect(parsed.ok, raw).toBe(false);
    }
  });
});

describe('解析器的四種拒絕(第 6 條)', () => {
  it('must_catch: 指標檔不存在必須拒絕且不退回 git', () => {
    const box = sandbox();
    // 沙箱的 root 底下放一個看起來像舊做法會找到的 learning/(帶合法標記)。
    // 舊行為(git-common-dir 的上一層 + learning/)或任何「退回預設位置」都會拿到東西;新行為只能拒絕。
    learningWithMarker(box.root, 'learning', `${UUID_A}\n`);
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('pointer-missing');
    expectBothHints(result.message);
  });

  it('指標檔讀不到(JSON 壞)必須拒絕', () => {
    const box = sandbox();
    writePointerRaw(box.config, '{');
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('pointer-unreadable');
    expectBothHints(result.message);
  });

  it('指標檔存在但讀取丟錯(例如權限)也算讀不到,不是丟例外', () => {
    const box = sandbox();
    writePointer(box.config, join(box.root, 'learning'), UUID_A);
    const deps = depsFor(box);
    const result = resolveVerifiedLedger({
      ...deps,
      readFile: () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('pointer-unreadable');
    expectBothHints(result.message);
  });

  it('欄位缺或型別錯算讀不到', () => {
    const box = sandbox();
    writePointerRaw(box.config, JSON.stringify({ learning_dir: 1, vault_id: UUID_A }));
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('pointer-unreadable');
    expectBothHints(result.message);
  });

  it('must_catch: learning_dir 是相對路徑必須拒絕(就算從 cwd 解析得到一個帶合法標記的目錄)', () => {
    const box = sandbox();
    const learning = learningWithMarker(box.root, 'learning', `${UUID_A}\n`);
    // 相對於目前 cwd、真的指得到上面那個 learning/ 的相對路徑:放行它的實作會驗證成功。
    writePointer(box.config, relative(process.cwd(), learning), UUID_A);
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
    const learning = learningWithMarker(box.root, 'learning', `${UUID_B}\n`);
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
    expectBothHints(result.message);
  });

  it('標記只有前 8 碼相同也是標記不符', () => {
    const box = sandbox();
    const learning = learningWithMarker(box.root, 'learning', `${UUID_PREFIX_TWIN}\n`);
    writePointer(box.config, learning, UUID_A);
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('marker-mismatch');
  });

  it('相符時回 VerifiedLedger,log 在該 learning 的 state/log.jsonl', () => {
    const box = sandbox();
    const learning = learningWithMarker(box.root, 'learning', `${UUID_A}\n`);
    writePointer(box.config, learning, UUID_A);
    const result = resolveVerifiedLedger(depsFor(box));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger).toBeInstanceOf(VerifiedLedger);
    expect(result.ledger.kind).toBe('verified');
    expect(result.ledger.learningDir).toBe(learning);
    expect(result.ledger.logPath).toBe(join(learning, 'state', 'log.jsonl'));
    expect(result.ledger.vaultId).toBe(UUID_A);
    expect(result.pointerPath).toBe(pointerOf(box.config));
  });

  it('解析器只讀指標與標記兩個檔,不建任何東西', () => {
    const box = sandbox();
    const learning = learningWithMarker(box.root, 'learning', `${UUID_A}\n`);
    writePointer(box.config, learning, UUID_A);
    const seen: string[] = [];
    const result = resolveVerifiedLedger(depsFor(box, (path) => seen.push(path)));
    expect(result.ok).toBe(true);
    expect(seen).toEqual([pointerOf(box.config), join(learning, 'config', 'vault-id')]);
  });
});

describe('VerifiedLedger 只能由指標解析器產生(第 8 條)', () => {
  it('類別上沒有任何公開的 static 工廠:mint / of / from 之類都不存在', () => {
    const statics = Object.getOwnPropertyNames(VerifiedLedger).filter(
      (name) => typeof (VerifiedLedger as unknown as Record<string, unknown>)[name] === 'function',
    );
    expect(statics).toEqual([]);
  });

  it('型別上建構子是私有的,字面值也冒充不了', () => {
    const forge = (): void => {
      // @ts-expect-error 建構子是私有的:只有 ledger.ts 的解析器能做出 VerifiedLedger
      new VerifiedLedger('/forged', UUID_A);
    };
    // @ts-expect-error 結構相同的字面值不是 VerifiedLedger(類別帶 # 私有欄位,是名義型別)
    const literal: VerifiedLedger = { kind: 'verified', logPath: '/forged/state/log.jsonl', learningDir: '/forged', vaultId: UUID_A };
    // @ts-expect-error ExplicitLedger 不是 VerifiedLedger
    const crossed: VerifiedLedger = ExplicitLedger.unverified('/forged/log.jsonl', 'test');
    expect(typeof forge).toBe('function');
    expect(literal.kind).toBe('verified');
    expect(crossed.kind).toBe('explicit');
  });

  it('ExplicitLedger 也只能經 ExplicitLedger.unverified 產生(grep 找得到每一個)', () => {
    const forge = (): void => {
      // @ts-expect-error 建構子是私有的
      new ExplicitLedger('/x', 'r');
    };
    // @ts-expect-error 字面值冒充不了
    const literal: ExplicitLedger = { kind: 'explicit', logPath: '/x', reason: 'r' };
    expect(typeof forge).toBe('function');
    expect(literal.kind).toBe('explicit');
    const ledger = ExplicitLedger.unverified('/x/log.jsonl', '測試的理由');
    expect(ledger).toBeInstanceOf(ExplicitLedger);
    expect(ledger.kind).toBe('explicit');
    expect(ledger.logPath).toBe('/x/log.jsonl');
    expect(ledger.reason).toBe('測試的理由');
  });
});

describe('must_catch: 沒有帳本把手時 readDailySpend 不回 0(第 4、8 條)', () => {
  it('沒給把手就丟 MissingLedgerError,不是 { usd: 0 }', () => {
    expect(() => readDailySpend(undefined, '2026-10-15', PRICES)).toThrow(MissingLedgerError);
  });

  it('GatewayLlmRouter 沒有帳本、也沒注入 spendReader:查花費丟錯,不回 0', () => {
    const router = new GatewayLlmRouter({ logAppender: () => {} });
    expect(() => router.dailySpend()).toThrow(MissingLedgerError);
    expect(() => router.budgetExhausted()).toThrow(MissingLedgerError);
  });

  it('GatewayLlmRouter 沒有帳本時 call() 在打任何 adapter 之前就丟錯', async () => {
    let calls = 0;
    const counting: CloudAdapter = {
      async call() {
        calls += 1;
        return { text: 'x', provider: 'openai', model: 'm', latency_ms: 1, tokens_in: 1, tokens_out: 1 };
      },
    };
    const router = new GatewayLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'm', OPENAI_API_KEY: 'k' },
      adapters: { openai: counting, anthropic: counting },
      onlineProber: async () => true,
      localProber: async () => ({ available: false, models: [] }),
      logAppender: () => {},
    });
    await expect(router.call('deepen', 'x')).rejects.toThrow(MissingLedgerError);
    expect(calls).toBe(0);
  });

  it('兩種把手的檔案不存在 = 0(全新安裝),不是丟錯', () => {
    const box = sandbox();
    const missing = join(box.root, 'no-such-log.jsonl');
    expect(readDailySpend(ExplicitLedger.unverified(missing, 'fresh install fixture'), '2026-10-15', PRICES)).toEqual({
      usd: 0,
      calls: 0,
    });
    const learning = learningWithMarker(box.root, 'learning', `${UUID_A}\n`);
    writePointer(box.config, learning, UUID_A);
    const resolved = resolveVerifiedLedger(depsFor(box));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(readDailySpend(resolved.ledger, '2026-10-15', PRICES)).toEqual({ usd: 0, calls: 0 });
  });

  it('帳本檔存在但讀不出來(是目錄)= 不知道,丟錯,不回 0', () => {
    const box = sandbox();
    const dirAsLog = join(box.root, 'log-is-a-dir');
    mkdirSync(dirAsLog);
    expect(() => readDailySpend(ExplicitLedger.unverified(dirAsLog, 'eisdir fixture'), '2026-10-15', PRICES)).toThrow();
  });
});

describe('must_catch: 真呼叫的 router 收了 ExplicitLedger(第 8 條,型別測試由 tsc 驗)', () => {
  it('ExplicitLedger 不能傳給 createLiveGatewayRouter,也不能傳給沒注入 adapter 的 GatewayLlmRouter', () => {
    const explicit = ExplicitLedger.unverified('/tmp/never-written.jsonl', 'type test');
    const build = (): unknown[] => [
      // @ts-expect-error 真呼叫 router 只收 VerifiedLedger
      createLiveGatewayRouter({ ledger: explicit }),
      // @ts-expect-error 沒注入 adapter = 用真的雲端 adapter = 真呼叫,不收 ExplicitLedger
      new GatewayLlmRouter({ ledger: explicit }),
      // @ts-expect-error 只注入一個 provider 也不行:另一個 provider 會落回真的 adapter
      new GatewayLlmRouter({ ledger: explicit, adapters: { openai: FAKE_ADAPTER } }),
    ];
    expect(typeof build).toBe('function');
  });

  it('假的 adapter 的 router(每個 provider 都注入)兩種把手都收;真呼叫 router 收 VerifiedLedger', () => {
    const box = sandbox();
    const learning = learningWithMarker(box.root, 'learning', `${UUID_A}\n`);
    writePointer(box.config, learning, UUID_A);
    const resolved = resolveVerifiedLedger(depsFor(box));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const explicit = ExplicitLedger.unverified(join(box.root, 'fake.jsonl'), 'fake adapter');
    const fakeAdapters = { openai: FAKE_ADAPTER, anthropic: FAKE_ADAPTER };
    expect(new GatewayLlmRouter({ ledger: explicit, adapters: fakeAdapters })).toBeInstanceOf(GatewayLlmRouter);
    expect(new GatewayLlmRouter({ ledger: resolved.ledger, adapters: fakeAdapters })).toBeInstanceOf(GatewayLlmRouter);
    expect(createLiveGatewayRouter({ ledger: resolved.ledger })).toBeInstanceOf(GatewayLlmRouter);
  });
});

describe('原子寫入接線(第 3 條)', () => {
  it('vault.ts 用的寫入器就是 schema 的 writeFileAtomic(寫暫存檔、fsync、rename)', () => {
    expect(realVaultIo().writeAtomic).toBe(writeFileAtomic);
  });
});

describe('must_catch: 測試讀到或改到真的指標檔(第 15 條)', () => {
  it('這個檔案跑到這裡,真指標檔的存在與否與 mtime 不變(只 stat;afterAll 再驗一次)', () => {
    expect(snapshotRealPointer()).toEqual(realPointerBefore);
  });
});

describe('驗收補測(T5 測試 agent):uuid 的開頭與結尾都要錨定', () => {
  it('標記或指標的 id 前面或後面多了東西,即使裡面藏著一個合法 uuid,也不算合法', () => {
    expect(parseMarker(`${UUID_A}\n`)).toBe(UUID_A);
    expect(parseMarker(`x${UUID_A}\n`)).toBeUndefined();
    expect(parseMarker(`${UUID_A}x\n`)).toBeUndefined();
    expect(parseMarker(`junk-${UUID_A}`)).toBeUndefined();
    expect(vaultIdsEqual(`x${UUID_A}\n`, UUID_A)).toBe(false);
    expect(vaultIdsEqual(`${UUID_A}\n`, `x${UUID_A}`)).toBe(false);
  });
});

describe('驗收補測(T5 測試 agent):拒絕訊息要指出是哪個檔、哪個目錄', () => {
  it('pointer-missing / pointer-unreadable / learning-dir-missing / marker-mismatch 的訊息各自帶出出問題的路徑', () => {
    const box = sandbox();
    const pointer = pointerOf(box.config);
    const missing = resolveVerifiedLedger(depsFor(box));
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe('pointer-missing');
      expect(missing.message).toContain(pointer);
    }

    writePointerRaw(box.config, '{');
    const unreadable = resolveVerifiedLedger(depsFor(box));
    expect(unreadable.ok).toBe(false);
    if (!unreadable.ok) {
      expect(unreadable.reason).toBe('pointer-unreadable');
      expect(unreadable.message).toContain(pointer);
      expect(unreadable.message).toContain('JSON');
    }

    const nowhere = join(box.root, 'nowhere');
    writePointer(box.config, nowhere, UUID_A);
    const noDir = resolveVerifiedLedger(depsFor(box));
    expect(noDir.ok).toBe(false);
    if (!noDir.ok) {
      expect(noDir.reason).toBe('learning-dir-missing');
      expect(noDir.message).toContain(nowhere);
    }

    const noMarker = learningWithMarker(box.root, 'no-marker', null);
    writePointer(box.config, noMarker, UUID_A);
    const markerGone = resolveVerifiedLedger(depsFor(box));
    expect(markerGone.ok).toBe(false);
    if (!markerGone.ok) {
      expect(markerGone.reason).toBe('marker-mismatch');
      expect(markerGone.message).toContain(join(noMarker, 'config', 'vault-id'));
      expect(markerGone.message).toContain('帳本身分標記不存在');
    }

    const other = learningWithMarker(box.root, 'other-id', `${UUID_B}\n`);
    writePointer(box.config, other, UUID_A);
    const mismatch = resolveVerifiedLedger(depsFor(box));
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.reason).toBe('marker-mismatch');
      expect(mismatch.message).toContain(join(other, 'config', 'vault-id'));
    }
  });

  it('parsePointer 的「讀不到」各有自己的說明,不是同一句空話', () => {
    const detail = (raw: string): string => {
      const r = parsePointer(raw);
      expect(r.ok).toBe(false);
      return r.ok ? '' : r.detail;
    };
    expect(detail('{')).toContain('JSON');
    expect(detail('[1]')).toContain('物件');
    expect(detail('"text"')).toContain('物件');
    expect(detail('{"learning_dir":"/x"}')).toContain('vault_id');
    expect(detail('{"learning_dir":1,"vault_id":"a"}')).toContain('字串');
    expect(detail('{"learning_dir":"rel/dir","vault_id":"a"}')).toContain('絕對路徑');
    expect(new Set(['{', '[1]', '{"learning_dir":"/x"}', '{"learning_dir":"rel/dir","vault_id":"a"}'].map(detail)).size).toBe(4);
  });
});

describe('驗收補測(T5 測試 agent):讀檔丟錯時的拒絕說明', () => {
  it('指標檔存在但讀的時候丟錯:pointer-unreadable,訊息帶出路徑與底層錯誤', () => {
    const box = sandbox();
    writePointer(box.config, join(box.root, 'x'), UUID_A);
    const deps = depsFor(box);
    const result = resolveVerifiedLedger({
      ...deps,
      readFile: () => {
        throw new Error('EACCES: simulated');
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('pointer-unreadable');
      expect(result.message).toContain(pointerOf(box.config));
      expect(result.message).toContain('EACCES: simulated');
      expectBothHints(result.message);
    }
  });

  it('標記檔存在但讀的時候丟錯:marker-mismatch,訊息說「讀不到」並帶出底層錯誤', () => {
    const box = sandbox();
    const dir = learningWithMarker(box.root, 'L', `${UUID_A}\n`);
    writePointer(box.config, dir, UUID_A);
    const base = depsFor(box);
    const result = resolveVerifiedLedger({
      ...base,
      readFile: (path) => {
        if (path.endsWith(join('config', 'vault-id'))) throw new Error('EIO: simulated');
        return base.readFile(path);
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('marker-mismatch');
      expect(result.message).toContain('讀不到');
      expect(result.message).toContain('EIO: simulated');
    }
  });
});

describe('驗收補測(T5 測試 agent):ExplicitLedger.unverified 只准出現在核可的兩個入口', () => {
  // 型別只能分「有沒有注入完整 adapter」,分不出 adapter 是真是假:有人用 ExplicitLedger 加真的 adapter
  // 照樣編得過。所以用到 ExplicitLedger.unverified( 的地方要靠這份清單釘死——新增一處就紅,逼人來看。
  // features/steps/ 是測試的步驟定義(假閘道的 cucumber 場景用),跟 *.test.ts 一樣不算正式程式,不在掃描範圍。
  const APPROVED = ['scripts/llm-spend.ts', 'scripts/llm.ts'];
  const ROOT = join(import.meta.dirname, '../../../..');

  function walk(dir: string, out: string[]): void {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'target' || name === 'reports' || name === '.git') continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs, out);
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(abs);
    }
  }

  it('非測試的正式程式裡,呼叫 ExplicitLedger.unverified( 的檔案恰好是核可的兩個', () => {
    const files: string[] = [];
    for (const top of ['packages', 'scripts', 'apps']) walk(join(ROOT, top), files);
    const users = files
      .filter((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .some((line) => {
            const t = line.trim();
            return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && line.includes('ExplicitLedger.unverified(');
          }),
      )
      .map((file) => relative(ROOT, file))
      .sort();
    expect(users).toEqual(APPROVED);
  });
});

describe('T8 D:learning_dir 是 symlink(解析器)', () => {
  it('指標的 learning_dir 是 symlink、指向標記相符的目錄 → 解析成功,logPath 以指標裡寫的路徑為準(不 realpath)', () => {
    const box = sandbox();
    const real = learningWithMarker(box.root, 'real', `${UUID_A}\n`);
    const link = join(box.root, 'link');
    symlinkSync(real, link);
    writePointer(box.config, link, UUID_A);
    const r = resolveVerifiedLedger(depsFor(box));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ledger.learningDir).toBe(link);
    expect(r.ledger.logPath).toBe(join(link, 'state', 'log.jsonl'));
  });

  it('同一個 symlink 事後改指到標記不同的目錄 → marker-mismatch,拒絕', () => {
    const box = sandbox();
    const a = learningWithMarker(box.root, 'a', `${UUID_A}\n`);
    const b = learningWithMarker(box.root, 'b', `${UUID_B}\n`);
    const link = join(box.root, 'link');
    symlinkSync(a, link);
    writePointer(box.config, link, UUID_A);
    expect(resolveVerifiedLedger(depsFor(box)).ok).toBe(true);
    rmSync(link);
    symlinkSync(b, link);
    const r = resolveVerifiedLedger(depsFor(box));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('marker-mismatch');
  });

  it('懸空的 symlink(目標不存在)→ learning-dir-missing', () => {
    const box = sandbox();
    const link = join(box.root, 'dangling');
    symlinkSync(join(box.root, 'nowhere'), link);
    writePointer(box.config, link, UUID_A);
    const r = resolveVerifiedLedger(depsFor(box));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('learning-dir-missing');
  });

  it('記錄現行行為:learning/state 是 symlink 指到 learning 外面 → 解析器放行,logPath 仍是 learning_dir/state/log.jsonl(不 realpath)。帳本可以被導到驗證範圍之外', () => {
    const box = sandbox();
    const learning = learningWithMarker(box.root, 'L', `${UUID_A}\n`);
    const outside = join(box.root, 'outside-state');
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(learning, 'state'));
    writePointer(box.config, learning, UUID_A);
    const r = resolveVerifiedLedger(depsFor(box));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ledger.logPath).toBe(join(learning, 'state', 'log.jsonl'));
  });
});
