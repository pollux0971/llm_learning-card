/**
 * scripts/run-tests.ts 的測試:全套 vitest 與 Stryker **共用同一把鎖**排隊。
 *
 * 背景(真的發生過三次,不是假設):`scripts/zero-input-guard.test.ts` 的子行程探針有
 * 90 秒逾時。另一個 worktree 同時在跑 Stryker、機器 load 15–37 時,會有 5 個探針逾時——
 * 那是假紅。never-executed-signals 的 worker 三次全中(load 25–37)、技術顧問在隔離簽出驗
 * 5748a38 第一次也中(load 17–29)、協調者合併後跑那次沒中(load 18–30)。
 * 技術顧問的裁定:**不放寬 90 秒**(只是讓問題晚一點出現而且從此看不見),
 * 改成跑全套的人跟 Stryker 排同一條隊。
 *
 * 這個檔案守四件事:
 *   §2 **哪條線算小範圍**——單檔 / 小範圍 vitest **不准搶鎖**,不然日常開發沒法用。
 *      這條最容易做過頭,所以線釘死在測試裡,改線先改這裡。
 *   §5 兩個 worktree 同時發起全套 → 第二個**真的等待**,不是直接跑。
 *   §6 一邊 Stryker、一邊全套 → **互斥**,兩個方向都要。
 *   §7 逾時 / 殘鎖 / 壞檔寬限**沿用** mutate.ts 的 acquireLock,這支不重新發明。
 *
 * 等鎖訊息「自己的鏈 / 別人的」那兩種文案在 scripts/mutate.test.ts §14(那是 mutate.ts 的函式)。
 *
 * 三條原則跟 mutate.test.ts 一樣:不真的跑 vitest(注入假的 runVitest)、不真的睡
 * (時鐘與 sleep 注入假的)、鎖檔全部放 mkdtemp 的臨時目錄。真的開子行程的只有兩條:
 * §5 兩個行程排隊、§8 SIGTERM 之後鎖不留——那兩件事在單一行程裡假不出來。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  LockTimeoutError,
  MAX_WAIT_MS,
  RETRY_INTERVAL_MS,
  acquireLock,
  parseLock,
  runMutate,
  strykerLockPath,
  tryAcquire,
  type HeldLock,
  type LockInfo,
} from './mutate.js';
import { isPartialRun, runTests, vitestArgs } from './run-tests.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const RUN_TESTS_MODULE = join(REPO_ROOT, 'scripts/run-tests.ts');
const MUTATE_MODULE = join(REPO_ROOT, 'scripts/mutate.ts');

/** 開一個 tsx 子行程要一到三秒,機器忙的時候更久。跟 mutate.test.ts 同一個放寬。 */
const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** 固定的假「現在」。 */
const T0 = Date.UTC(2026, 8, 5, 12, 0, 0);

function info(over: Partial<LockInfo> = {}): LockInfo {
  return { pid: 4242, startedAt: new Date(T0).toISOString(), cwd: '/some/worktree', ...over };
}

/** 假時鐘:sleep 不真的睡,把時間往前撥。`onSleep(n)` 在第 n 次睡的時候被叫。 */
function fakeClock(onSleep?: (n: number) => void) {
  let t = T0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
      onSleep?.(sleeps.length);
    },
  };
}

/**
 * 一定不存在的 pid。/proc 幾乎不會發到這個數字,而且我們也不 kill 它,只 signal 0。
 * 真的撞到的話 pidIsAlive 會回 true,測試會紅而不是假綠——方向是安全的。
 */
const DEAD_PID = 0x7ffffffe;

/** 一個「絕對不可以被叫到」的 sleep:誰叫到它就代表有人在該直接跑的時候去排隊了。 */
const NEVER_SLEEP = async (ms: number): Promise<void> => {
  throw new Error(`不該等鎖卻等了(sleep ${ms} ms)`);
};

/** 拿一把「別的 worktree、pid 活著」的鎖擋在路上。回鎖的路徑。 */
function holdLiveLock(dir: string, over: Partial<LockInfo> = {}): string {
  const lockPath = join(dir, '.stryker.lock');
  // pid 用自己的:一定活著,而且 releaseLock 只刪 pid 對得上的,runTests 的 finally
  // 不會把它當自己的刪掉——除非它拿到了(那正是要驗的事)。
  // startedAt 用真時間:假時鐘從 T0 起算,鎖若寫成 T0 就不會被當殘鎖;這裡故意也用 T0。
  const ok = tryAcquire(lockPath, info({ pid: process.pid, cwd: '/other/worktree', ...over }));
  if (!ok) throw new Error(`測試自己拿不到鎖:${lockPath}`);
  return lockPath;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 參數翻譯:跟 strykerArgs 同一個形狀
// ─────────────────────────────────────────────────────────────────────────────

describe('vitestArgs', () => {
  it('沒有 -- 時只有 run', () => {
    expect(vitestArgs(['node', 'run-tests.ts'])).toEqual(['run']);
  });

  it('-- 之後原樣透傳,前面補 run', () => {
    expect(vitestArgs(['node', 'run-tests.ts', '--', 'scripts/mutate.test.ts'])).toEqual(['run', 'scripts/mutate.test.ts']);
    expect(vitestArgs(['node', 'run-tests.ts', '--', '--reporter=verbose'])).toEqual(['run', '--reporter=verbose']);
  });

  it('使用者自己打了 run 就不補第二次', () => {
    expect(vitestArgs(['node', 'run-tests.ts', '--', 'run', 'scripts/a.test.ts'])).toEqual(['run', 'scripts/a.test.ts']);
  });

  it('只認第一個 --,後面的 -- 是要給 vitest 的', () => {
    expect(vitestArgs(['node', 'run-tests.ts', '--', 'a', '--', 'b'])).toEqual(['run', 'a', '--', 'b']);
  });

  it('不會讓 vitest 進 watch 模式:透傳裡沒有 run 就補 run,不是補 watch', () => {
    // watch 模式會把鎖握到天荒地老,別人等滿 90 分鐘 exit 1。`npm run test:watch` 走的是
    // 裸 vitest(§9 釘住),這支永遠是 run。
    expect(vitestArgs(['node', 'run-tests.ts'])[0]).toBe('run');
    expect(vitestArgs(['node', 'run-tests.ts', '--', '--reporter=dot'])[0]).toBe('run');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 哪條線算「小範圍」——這一節是整支最容易做過頭的地方
//
// 線:`--` 之後有任何一個**存在於磁碟上的檔案或目錄**當位置參數 → 小範圍,不拿鎖。
// 其他一律全套(拿鎖)。
//
// 為什麼是「存在的路徑」而不是「不是旗標的東西」:`--reporter verbose` 的 verbose 也不是
// 旗標,用「不是旗標」判會把一個全套跑成**沒鎖**——那是漏鎖,代價是整輪 OOM 或假紅。
// 反過來,vitest 的子字串 pattern(`npm test -- mutate`)在這條線下會被當全套多鎖一次,
// 代價是等幾分鐘。兩種錯只能選一種,選代價小的那種。要快就給真的路徑,或直接叫 vitest。
// ─────────────────────────────────────────────────────────────────────────────

describe('isPartialRun(小範圍的線)', () => {
  /** 一個有真檔案、真目錄的臨時 cwd。 */
  function cwdWithFiles(): string {
    const d = tmp('run-tests-partial');
    mkdirSync(join(d, 'scripts'), { recursive: true });
    mkdirSync(join(d, 'packages', 'core'), { recursive: true });
    writeFileSync(join(d, 'scripts', 'mutate.test.ts'), '', 'utf8');
    return d;
  }

  it('沒有位置參數 → 全套(拿鎖)', () => {
    expect(isPartialRun([], cwdWithFiles())).toBe(false);
  });

  it('給了存在的測試檔 → 小範圍(不拿鎖)', () => {
    // 這條是日常開發的命脈:改一個檔案跑一個檔案,要能**立刻**跑,不能被隔壁 Stryker 擋 40 分鐘。
    expect(isPartialRun(['scripts/mutate.test.ts'], cwdWithFiles())).toBe(true);
  });

  it('給了存在的目錄 → 小範圍(不拿鎖)', () => {
    expect(isPartialRun(['packages/core'], cwdWithFiles())).toBe(true);
    expect(isPartialRun(['scripts/'], cwdWithFiles())).toBe(true);
  });

  it('絕對路徑也算', () => {
    const d = cwdWithFiles();
    expect(isPartialRun([join(d, 'scripts', 'mutate.test.ts')], '/nowhere')).toBe(true);
  });

  it('旗標加檔案 → 還是小範圍(旗標不改變範圍)', () => {
    expect(isPartialRun(['--reporter=verbose', 'scripts/mutate.test.ts'], cwdWithFiles())).toBe(true);
    expect(isPartialRun(['scripts/mutate.test.ts', '--bail=1'], cwdWithFiles())).toBe(true);
  });

  it('只有旗標 → 全套(拿鎖)', () => {
    expect(isPartialRun(['--reporter=verbose'], cwdWithFiles())).toBe(false);
    expect(isPartialRun(['--bail=1', '--reporter=dot'], cwdWithFiles())).toBe(false);
  });

  it('旗標的值(--reporter verbose 的 verbose)不是路徑 → 全套(這條就是不用「不是旗標」判的理由)', () => {
    // 用「不是旗標就是 filter」會把這個全套跑成沒鎖。
    expect(isPartialRun(['--reporter', 'verbose'], cwdWithFiles())).toBe(false);
  });

  it('-t <名字> 沒有檔案 → 全套(還是會載入所有檔案,重的是載入)', () => {
    expect(isPartialRun(['-t', 'waitingMessage'], cwdWithFiles())).toBe(false);
    expect(isPartialRun(['--testNamePattern=x'], cwdWithFiles())).toBe(false);
  });

  it('子字串 pattern(不是存在的路徑)→ 全套:故意往安全的方向錯', () => {
    // `npm test -- mutate` 在 vitest 是「檔名含 mutate」。這裡當全套多鎖一次,
    // 代價是等;反過來漏鎖的代價是 OOM。要快就打 scripts/mutate.test.ts。
    expect(isPartialRun(['mutate'], cwdWithFiles())).toBe(false);
    expect(isPartialRun(['scripts/nope.test.ts'], cwdWithFiles())).toBe(false);
  });

  it('不給 cwd 時用 process.cwd() 判(套件在 repo 根跑,scripts/ 就在)', () => {
    expect(isPartialRun(['scripts/run-tests.test.ts'])).toBe(true);
    expect(isPartialRun(['this-path-does-not-exist-anywhere'])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 小範圍:runTests 連鎖都不碰
// ─────────────────────────────────────────────────────────────────────────────

describe('runTests 小範圍時不拿鎖', () => {
  it('給了存在的檔案:acquire 一次都不會被叫,vitest 直接跑', async () => {
    const dir = tmp('run-tests-partial-noacq');
    let acquired = 0;
    let ran: string[] | undefined;
    const code = await runTests({
      argv: ['node', 'run-tests.ts', '--', 'scripts/run-tests.test.ts'],
      lockPath: join(dir, '.stryker.lock'),
      acquire: async (p) => {
        acquired += 1;
        return { lockPath: p, info: info(), release: () => {} };
      },
      runVitest: async (args) => {
        ran = args;
        return 0;
      },
      installCleanup: () => () => {},
      log: () => {},
      cwd: REPO_ROOT,
    });
    expect(code).toBe(0);
    expect(acquired).toBe(0);
    expect(ran).toEqual(['run', 'scripts/run-tests.test.ts']);
    expect(existsSync(join(dir, '.stryker.lock'))).toBe(false);
  });

  it('鎖被活著的別人握著,單檔 vitest 照樣**立刻**跑,不排隊', async () => {
    // 這條是「不准做過頭」的實體:隔壁 worktree 在跑 Stryker(鎖在、pid 活),
    // 我改一個檔要跑一個檔,不能被擋 40 分鐘。
    const dir = tmp('run-tests-partial-held');
    const lockPath = holdLiveLock(dir);
    const before = readFileSync(lockPath, 'utf8');
    let ran = false;
    const code = await runTests({
      argv: ['node', 'run-tests.ts', '--', 'scripts/run-tests.test.ts'],
      lockPath,
      lock: { sleep: NEVER_SLEEP, log: () => {}, isAlive: () => true },
      runVitest: async () => {
        ran = true;
        return 0;
      },
      installCleanup: () => () => {},
      log: () => {},
      cwd: REPO_ROOT,
    });
    expect(code).toBe(0);
    expect(ran).toBe(true);
    // 別人的鎖一個位元組都不能動。
    expect(readFileSync(lockPath, 'utf8')).toBe(before);
  });

  it('小範圍時退出碼一樣原樣往外傳', async () => {
    const dir = tmp('run-tests-partial-code');
    const code = await runTests({
      argv: ['node', 'run-tests.ts', '--', 'scripts/run-tests.test.ts'],
      lockPath: join(dir, '.stryker.lock'),
      runVitest: async () => 3,
      installCleanup: () => () => {},
      log: () => {},
      cwd: REPO_ROOT,
    });
    expect(code).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 全套:拿鎖 → 跑 → finally 刪鎖,鎖檔寫的是 task: 'test'
// ─────────────────────────────────────────────────────────────────────────────

describe('runTests 全套時拿鎖', () => {
  it('沒人持鎖:拿到鎖再跑 vitest,跑的時候鎖在、跑完鎖不在', async () => {
    const dir = tmp('run-tests-full-1');
    const lockPath = join(dir, '.stryker.lock');
    let seen: LockInfo | null | undefined;
    const code = await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath,
      lock: { sleep: NEVER_SLEEP, log: () => {} },
      runVitest: async () => {
        seen = parseLock(readFileSync(lockPath, 'utf8'));
        return 0;
      },
      installCleanup: () => () => {},
      log: () => {},
    });
    expect(code).toBe(0);
    expect(seen?.pid).toBe(process.pid);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('鎖檔裡寫 task: "test",等鎖的人才分得出對面是 Stryker 還是全套', async () => {
    const dir = tmp('run-tests-full-task');
    const lockPath = join(dir, '.stryker.lock');
    let seen: LockInfo | null | undefined;
    await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath,
      lock: { sleep: NEVER_SLEEP, log: () => {} },
      runVitest: async () => {
        seen = parseLock(readFileSync(lockPath, 'utf8'));
        return 0;
      },
      installCleanup: () => () => {},
      log: () => {},
    });
    expect(seen?.task).toBe('test');
  });

  it('runMutate 那邊寫的是 task: "stryker"(對照組,兩邊都要標)', async () => {
    const dir = tmp('run-tests-full-task-stryker');
    const lockPath = join(dir, '.stryker.lock');
    let seen: LockInfo | null | undefined;
    await runMutate({
      argv: ['node', 'mutate.ts'],
      lockPath,
      lock: { sleep: NEVER_SLEEP, log: () => {} },
      runStryker: async () => {
        seen = parseLock(readFileSync(lockPath, 'utf8'));
        return 0;
      },
      installCleanup: () => () => {},
      log: () => {},
    });
    expect(seen?.task).toBe('stryker');
  });

  it('vitest 失敗時退出碼原樣往外傳,鎖照樣刪掉', async () => {
    const dir = tmp('run-tests-full-2');
    const lockPath = join(dir, '.stryker.lock');
    const code = await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath,
      lock: { sleep: NEVER_SLEEP, log: () => {} },
      runVitest: async () => 1,
      installCleanup: () => () => {},
      log: () => {},
    });
    // 測試紅是 vitest 的 exit 1,不能被鎖吞掉變成 0——那是靜默的假驗收。
    expect(code).toBe(1);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('vitest 丟例外時鎖也要刪掉(這條就是 finally)', async () => {
    const dir = tmp('run-tests-full-3');
    const lockPath = join(dir, '.stryker.lock');
    await expect(
      runTests({
        argv: ['node', 'run-tests.ts'],
        lockPath,
        lock: { sleep: NEVER_SLEEP, log: () => {} },
        runVitest: async () => {
          throw new Error('boom');
        },
        installCleanup: () => () => {},
        log: () => {},
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('給了 acquire 就用給的,而且 finally 會叫它回的 release', async () => {
    const dir = tmp('run-tests-full-acq');
    let released = 0;
    const held: HeldLock = { lockPath: join(dir, '.stryker.lock'), info: info(), release: () => void (released += 1) };
    const code = await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath: held.lockPath,
      acquire: async () => held,
      runVitest: async () => 0,
      installCleanup: () => () => {},
      log: () => {},
    });
    expect(code).toBe(0);
    expect(released).toBeGreaterThanOrEqual(1);
  });

  it('不給 lockPath 時用 strykerLockPath():跟 Stryker **同一把**,不是另一把', async () => {
    let seen: string | undefined;
    await runTests({
      argv: ['node', 'run-tests.ts'],
      acquire: async (p) => {
        seen = p;
        return { lockPath: p, info: info(), release: () => {} };
      },
      runVitest: async () => 0,
      installCleanup: () => () => {},
      log: () => {},
    });
    // 兩把不同的鎖 = 沒有互斥。這條是整張工單的地基。
    expect(seen).toBe(strykerLockPath());
    expect(seen?.endsWith('.stryker.lock')).toBe(true);
  });

  it('把 signal 清理掛上去,結束時再拆掉', async () => {
    const dir = tmp('run-tests-full-sig');
    let installed = 0;
    let uninstalled = 0;
    await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath: join(dir, '.stryker.lock'),
      lock: { sleep: NEVER_SLEEP, log: () => {} },
      runVitest: async () => 0,
      installCleanup: () => {
        installed += 1;
        return () => void (uninstalled += 1);
      },
      log: () => {},
    });
    expect(installed).toBe(1);
    expect(uninstalled).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 兩個 worktree 同時發起全套 → 第二個真的等待
// ─────────────────────────────────────────────────────────────────────────────

describe('兩個全套排隊', () => {
  it('第一個握著鎖時,第二個每 15 秒重試、印等待訊息,鎖放掉才跑 vitest', async () => {
    const dir = tmp('run-tests-queue-1');
    // 「第一個 worktree」:鎖在、pid 活著(用自己的 pid)。
    const lockPath = holdLiveLock(dir, { cwd: '/wt/first', task: 'test' });
    const logs: string[] = [];
    let ranAtSleep = -1;
    // 第二次睡的時候第一個跑完放鎖 → 第三次嘗試才拿到。
    const clock = fakeClock((n) => {
      if (n === 2) rmSync(lockPath);
    });

    const code = await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath,
      lock: { now: clock.now, sleep: clock.sleep, log: (m) => logs.push(m), isAlive: () => true },
      runVitest: async () => {
        ranAtSleep = clock.sleeps.length;
        return 0;
      },
      installCleanup: () => () => {},
      log: (m) => logs.push(m),
    });

    expect(code).toBe(0);
    // 「真的等待」= 睡了兩次(15 秒一次)才跑,不是直接跑。
    expect(clock.sleeps).toEqual([RETRY_INTERVAL_MS, RETRY_INTERVAL_MS]);
    expect(ranAtSleep).toBe(2);
    // 等的時候要講話,而且講的是誰握著。
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs[0]).toContain('/wt/first');
    expect(logs[0]).toContain(String(process.pid));
    expect(existsSync(lockPath)).toBe(false);
  });

  it('等的時候不動別人的鎖(內容一個位元組都不變)', async () => {
    const dir = tmp('run-tests-queue-2');
    const lockPath = holdLiveLock(dir, { cwd: '/wt/first', task: 'test' });
    const before = readFileSync(lockPath, 'utf8');
    let snapshotWhileWaiting = '';
    const clock = fakeClock((n) => {
      if (n === 1) snapshotWhileWaiting = readFileSync(lockPath, 'utf8');
      if (n === 2) rmSync(lockPath);
    });
    await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath,
      lock: { now: clock.now, sleep: clock.sleep, log: () => {}, isAlive: () => true },
      runVitest: async () => 0,
      installCleanup: () => () => {},
      log: () => {},
    });
    expect(snapshotWhileWaiting).toBe(before);
  });

  it(
    '真的兩個行程:第一個握著,第二個只印等待、不印 RAN;第一個被殺掉之後第二個才 RAN',
    async () => {
      const dir = tmp('run-tests-queue-proc');
      const lockPath = join(dir, '.stryker.lock');
      const holder = writeHolder(dir, 'holder', 600_000);
      const waiter = writeHolder(dir, 'waiter', 0);

      const first = spawnChild(holder, [lockPath]);
      await first.until('HELD');
      expect(existsSync(lockPath), `第一個拿到鎖之後鎖檔就該在:${first.out()}`).toBe(true);

      const second = spawnChild(waiter, [lockPath]);
      // 第二個要「等」:先看到等待訊息。這裡 retryMs 是 300 ms(holder 腳本裡設的),
      // 所以幾秒內一定會印出來;它**不可以**在第一個還活著的時候印 HELD。
      await second.until('等待');
      expect(second.out(), '第二個在第一個還握著鎖的時候就跑了').not.toContain('HELD');
      expect(second.out()).toContain(String(first.pid()));

      first.kill('SIGTERM');
      await first.exited;
      await second.until('RAN');
      const code = await second.exited;
      expect(code, second.out()).toBe(0);
      expect(existsSync(lockPath)).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. 一邊 Stryker、一邊全套 → 互斥(兩個方向)
// ─────────────────────────────────────────────────────────────────────────────

describe('Stryker 與全套互斥', () => {
  it('Stryker 握著鎖 → 全套等它放掉才跑', async () => {
    const dir = tmp('run-tests-mutex-1');
    const lockPath = holdLiveLock(dir, { cwd: '/wt/stryker', task: 'stryker' });
    const logs: string[] = [];
    let ranAtSleep = -1;
    const clock = fakeClock((n) => {
      if (n === 3) rmSync(lockPath);
    });
    const code = await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath,
      lock: { now: clock.now, sleep: clock.sleep, log: (m) => logs.push(m), isAlive: () => true },
      runVitest: async () => {
        ranAtSleep = clock.sleeps.length;
        return 0;
      },
      installCleanup: () => () => {},
      log: (m) => logs.push(m),
    });
    expect(code).toBe(0);
    expect(ranAtSleep).toBe(3);
    expect(logs[0]).toContain('Stryker');
  });

  it('全套握著鎖 → Stryker(runMutate)等它放掉才跑', async () => {
    const dir = tmp('run-tests-mutex-2');
    const lockPath = holdLiveLock(dir, { cwd: '/wt/test', task: 'test' });
    const logs: string[] = [];
    let ranAtSleep = -1;
    const clock = fakeClock((n) => {
      if (n === 3) rmSync(lockPath);
    });
    try {
      const code = await runMutate({
        argv: ['node', 'mutate.ts'],
        lockPath,
        // runMutate 還沒接 `lock` 的時候會走真的 sleep(15 秒)→ 這條以 5 秒逾時紅掉。
        lock: { now: clock.now, sleep: clock.sleep, log: (m) => logs.push(m), isAlive: () => true },
        runStryker: async () => {
          ranAtSleep = clock.sleeps.length;
          return 0;
        },
        installCleanup: () => () => {},
        log: (m) => logs.push(m),
      });
      expect(code).toBe(0);
      expect(ranAtSleep).toBe(3);
      // 對面是全套,訊息要講出來,不能還寫「等 X 的 Stryker」。
      expect(logs[0]).toContain('全套');
    } finally {
      // 紅掉(逾時)之後不要把一個真的在睡 15 秒的迴圈留在 worker 裡:把鎖拿掉讓它下一輪就結束。
      rmSync(lockPath, { force: true });
    }
  });

  it('全套握著鎖 → 裸 acquireLock(Stryker 那條路)也拿不到', async () => {
    const dir = tmp('run-tests-mutex-3');
    const lockPath = holdLiveLock(dir, { cwd: '/wt/test', task: 'test' });
    const clock = fakeClock();
    await expect(
      acquireLock(lockPath, {
        info: info({ pid: 999, cwd: '/wt/stryker', task: 'stryker' }),
        now: clock.now,
        sleep: clock.sleep,
        log: () => {},
        isAlive: () => true,
        maxWaitMs: RETRY_INTERVAL_MS * 3,
      }),
    ).rejects.toBeInstanceOf(LockTimeoutError);
    expect(clock.sleeps.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. 逾時 / 殘鎖沿用既有行為——不重新發明
// ─────────────────────────────────────────────────────────────────────────────

describe('逾時與殘鎖沿用 acquireLock 的規則', () => {
  it('等滿 90 分鐘(MAX_WAIT_MS)就放棄:回 1,而且根本不跑 vitest', async () => {
    const dir = tmp('run-tests-timeout-1');
    const lockPath = holdLiveLock(dir, { cwd: '/wt/other', task: 'stryker' });
    const clock = fakeClock();
    let ran = false;
    const logs: string[] = [];
    const code = await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath,
      // 不給 maxWaitMs:預設要是 MAX_WAIT_MS,那是 Stryker 那把鎖的 90 分鐘。
      lock: { now: clock.now, sleep: clock.sleep, log: () => {}, isAlive: () => true },
      runVitest: async () => {
        ran = true;
        return 0;
      },
      installCleanup: () => () => {},
      log: (m) => logs.push(m),
    });
    expect(code).toBe(1);
    expect(ran).toBe(false);
    expect(clock.sleeps.length).toBe(MAX_WAIT_MS / RETRY_INTERVAL_MS);
    expect(logs.join('\n')).toContain('90 分鐘');
    // 放棄不等於接管:別人的鎖還在。
    expect(existsSync(lockPath)).toBe(true);
  });

  it('90 分鐘就是 90 分鐘:MAX_WAIT_MS 沒被這支另外定義', () => {
    expect(MAX_WAIT_MS).toBe(90 * 60_000);
  });

  it('殘鎖(pid 不在)清掉直接跑,一次都不睡', async () => {
    const dir = tmp('run-tests-stale-1');
    const lockPath = join(dir, '.stryker.lock');
    tryAcquire(lockPath, info({ pid: DEAD_PID, cwd: '/wt/dead', task: 'stryker' }));
    const logs: string[] = [];
    const clock = fakeClock();
    let seen: LockInfo | null | undefined;
    const code = await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath,
      lock: { now: clock.now, sleep: clock.sleep, log: (m) => logs.push(m) },
      runVitest: async () => {
        seen = parseLock(readFileSync(lockPath, 'utf8'));
        return 0;
      },
      installCleanup: () => () => {},
      log: (m) => logs.push(m),
    });
    expect(code).toBe(0);
    expect(clock.sleeps).toEqual([]);
    expect(seen?.pid).toBe(process.pid);
    expect(logs.join('\n')).toContain('清掉殘留');
  });

  it('超過 2 小時的鎖也算殘鎖,清掉重拿(時間規則是 mutate.ts 的,這裡只確認有走到)', async () => {
    const dir = tmp('run-tests-stale-2');
    const lockPath = join(dir, '.stryker.lock');
    const old = new Date(T0 - 2 * 60 * 60_000 - 1).toISOString();
    tryAcquire(lockPath, info({ pid: process.pid, cwd: '/wt/old', startedAt: old, task: 'test' }));
    const clock = fakeClock();
    let ran = false;
    const code = await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath,
      lock: { now: clock.now, sleep: clock.sleep, log: () => {}, isAlive: () => true },
      runVitest: async () => {
        ran = true;
        return 0;
      },
      installCleanup: () => () => {},
      log: () => {},
    });
    expect(code).toBe(0);
    expect(ran).toBe(true);
    expect(clock.sleeps).toEqual([]);
  });

  it('等鎖超時時 LockTimeoutError 被翻成 1;別的例外原樣往外丟', async () => {
    const dir = tmp('run-tests-timeout-2');
    await expect(
      runTests({
        argv: ['node', 'run-tests.ts'],
        lockPath: join(dir, '.stryker.lock'),
        acquire: async () => {
          throw new Error('disk on fire');
        },
        runVitest: async () => 0,
        installCleanup: () => () => {},
        log: () => {},
      }),
    ).rejects.toThrow('disk on fire');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. SIGTERM 之後鎖不留(真的開子行程、真的 kill)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 寫一支「拿鎖 → 假裝在跑 vitest」的小程式。`holdMs` 是假 vitest 要跑多久:
 * 600_000 = 永遠不結束(等人來 SIGTERM),0 = 立刻結束。印 HELD(拿到鎖)與 RAN(跑完)。
 */
function writeHolder(dir: string, name: string, holdMs: number): string {
  const p = join(dir, `${name}.mts`); // .mts 才保證 tsx 走 ESM(臨時目錄外面沒有 type: module)
  writeFileSync(
    p,
    `import { runTests } from ${JSON.stringify(RUN_TESTS_MODULE)};
const lockPath = process.argv[2];
const code = await runTests({
  argv: ['node', 'run-tests.ts'],
  lockPath,
  // 真的走 acquireLock,只把重試間隔縮到 300 ms,測試不用等 15 秒。
  lock: { retryMs: 300, log: (m) => console.log(m) },
  runVitest: async () => {
    console.log('HELD');
    // setTimeout 而不是永不 resolve 的 Promise:pending 的 Promise 不算 event loop handle。
    await new Promise((r) => setTimeout(r, ${holdMs}));
    console.log('RAN');
    return 0;
  },
  log: (m) => console.log(m),
});
process.exitCode = code;
`,
    'utf8',
  );
  return p;
}

/** 開一個 tsx 子行程,收 stdout/stderr,提供「等到印出某個字」與「結束」兩個 Promise。 */
function spawnChild(script: string, args: string[]) {
  const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], { cwd: REPO_ROOT });
  let out = '';
  const waiters: { needle: string; res: () => void }[] = [];
  const onData = (c: Buffer) => {
    out += String(c);
    for (const w of [...waiters]) {
      if (out.includes(w.needle)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.res();
      }
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const exited = new Promise<number | null>((res) => child.on('close', (code) => res(code)));
  return {
    exited,
    pid: () => child.pid ?? -1,
    out: () => out,
    kill: (sig: NodeJS.Signals) => child.kill(sig),
    until: (needle: string) =>
      new Promise<void>((res, rej) => {
        if (out.includes(needle)) return res();
        waiters.push({ needle, res });
        // 子行程沒印就先死了(例如 runTests 還沒實作),不要在這裡吊滿 60 秒。
        void exited.then(() => rej(new Error(`子行程沒印出「${needle}」就結束了:\n${out}`)));
      }),
  };
}

describe('SIGTERM 之後鎖不留', () => {
  it(
    '跑到一半被 SIGTERM 殺掉,鎖檔不會留下來',
    async () => {
      const dir = tmp('run-tests-sigterm');
      const lockPath = join(dir, '.stryker.lock');
      const holder = writeHolder(dir, 'holder', 600_000);
      const child = spawnChild(holder, [lockPath]);
      await child.until('HELD');
      expect(existsSync(lockPath), `拿到鎖之前鎖檔就該在:${child.out()}`).toBe(true);

      child.kill('SIGTERM');
      await child.exited;
      // 留下鎖檔 = 下一個人(Stryker 或全套)白等 90 分鐘然後 exit 1。
      expect(existsSync(lockPath), `SIGTERM 之後鎖還在:${child.out()}`).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. 接線:npm test 要走這支;test:watch 不准走
// ─────────────────────────────────────────────────────────────────────────────

describe('package.json 接線', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('npm test 走 scripts/run-tests.ts,不是裸 vitest', () => {
    // 裸 `vitest run` 就是今天的狀態:跟隔壁 Stryker 互踩,探針假紅。
    expect(pkg.scripts.test).toContain('scripts/run-tests.ts');
    expect(pkg.scripts.test).not.toMatch(/^vitest\b/);
  });

  it('npm test 的參數會透傳(結尾是 --,跟 mutate 一樣)', () => {
    // `npm test -- scripts/x.test.ts` 才到得了 isPartialRun。沒有 -- 的話位置參數會被 tsx 吃掉。
    expect(pkg.scripts.test?.trim().endsWith('--')).toBe(true);
  });

  it('test:watch 不走鎖(watch 會把鎖握到天荒地老)', () => {
    expect(pkg.scripts['test:watch']).not.toContain('run-tests');
  });

  it('mutate 還是走 scripts/mutate.ts(這張工單不動 Stryker 那邊的接線)', () => {
    expect(pkg.scripts.mutate).toContain('scripts/mutate.ts');
  });

  it('.gitignore 擋掉 .stryker.lock(同一把鎖,同一條 ignore)', () => {
    const ignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(ignore.split('\n').map((l) => l.trim())).toContain('.stryker.lock');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. 兩支腳本共用的是**同一個**鎖模組,不是各抄一份
// ─────────────────────────────────────────────────────────────────────────────

describe('不重新發明鎖', () => {
  it('run-tests.ts 從 mutate.ts import 鎖,自己沒有 openSync / unlinkSync', () => {
    const src = readFileSync(RUN_TESTS_MODULE, 'utf8');
    expect(src).toMatch(/from '\.\/mutate\.js'/);
    // 鎖的規則只能有一份真相。這支自己 openSync('wx') 就是第二份。
    expect(src).not.toContain('openSync(');
    expect(src).not.toContain('unlinkSync(');
    // 檔名字面值只准在 mutate.ts 出現一次(註解裡提到無妨,字串字面值不行)。
    expect(src).not.toContain("'.stryker.lock'");
  });

  it('mutate.ts 還是鎖的唯一定義處(LOCK_FILENAME 只在那裡)', () => {
    const src = readFileSync(MUTATE_MODULE, 'utf8');
    expect(src).toContain("LOCK_FILENAME = '.stryker.lock'");
  });
});
