/**
 * scripts/mutate.ts 的鎖測試(P-29)。
 *
 * 背景:三個 worktree 的審核輪同時跑 Stryker,把彼此 OOM 掉(exit 144),
 * 那一輪三個審核跑了 84 / 45 / 40 分鐘。更糟的是殘缺的分數可能被當成驗收結果。
 *
 * 這個檔案測的是**鎖**,不是 Stryker。三條原則:
 *   1. 不真的跑 Stryker(太慢)——runStryker 一律注入假的。
 *   2. 不真的等 15 秒 / 90 分鐘——時鐘與 sleep 注入假的,測試是瞬間的。
 *   3. 不在主 repo 或任何 worktree 留下 .stryker.lock——所有鎖都在 mkdtemp 的臨時目錄。
 *
 * 有三條測試會真的開子行程(搶鎖、SIGTERM),因為那兩件事在單一行程裡假不出來:
 * `openSync(path,'wx')` 的原子性要兩個行程才看得到,signal handler 也要真的被 kill。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  CORRUPT_GRACE_MS,
  LockTimeoutError,
  MAX_WAIT_MS,
  RETRY_INTERVAL_MS,
  STALE_AFTER_MS,
  acquireLock,
  classifyLock,
  installCleanup,
  parseLock,
  pidIsAlive,
  readLock,
  releaseLock,
  runMutate,
  strykerArgs,
  strykerLockPath,
  tryAcquire,
  waitingMessage,
  type HeldLock,
  type LockInfo,
  type SignalTarget,
} from './mutate.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const MUTATE_MODULE = join(REPO_ROOT, 'scripts/mutate.ts');

/** 開一個 tsx 子行程要一到三秒,機器忙的時候更久。跟其他掃描器測試同一個放寬。 */
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

/** 固定的假「現在」,所有時間斷言以它為基準。 */
const T0 = Date.UTC(2026, 8, 4, 12, 0, 0);

function info(over: Partial<LockInfo> = {}): LockInfo {
  return { pid: 4242, startedAt: new Date(T0).toISOString(), cwd: '/some/worktree', ...over };
}

/** 造一個 LockRead。mtime 預設就是「剛剛寫的」,壞檔寬限期才不會誤觸發。 */
function read(raw: string, mtimeMs = T0): { raw: string; mtimeMs: number } {
  return { raw, mtimeMs };
}

/**
 * 一定不存在的 pid。/proc 幾乎不會發到這個數字,而且我們也不 kill 它,只 signal 0。
 * 真的撞到的話 pidIsAlive 會回 true,測試會紅而不是假綠——方向是安全的。
 */
const DEAD_PID = 0x7ffffffe;

// ─────────────────────────────────────────────────────────────────────────────
// 1. 鎖的位置:跨 worktree 必須是同一個
// ─────────────────────────────────────────────────────────────────────────────

/** git init 一個 repo,再掛兩個 worktree。回主 repo 與兩個 worktree 的路徑。 */
function gitRepoWithWorktrees(): { main: string; wtA: string; wtB: string } {
  const base = tmp('mutate-lock-git');
  const main = join(base, 'main');
  mkdirSync(main, { recursive: true });
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS },
    );
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失敗:${r.stderr ?? ''}`);
    return (r.stdout ?? '').trim();
  };
  git(main, 'init', '-q', '-b', 'main', '.');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  const wtA = join(base, 'wt-a');
  const wtB = join(base, 'wt-b');
  git(main, 'worktree', 'add', '-q', '-b', 'a', wtA);
  git(main, 'worktree', 'add', '-q', '-b', 'b', wtB);
  return { main, wtA, wtB };
}

describe('strykerLockPath', () => {
  it('兩個不同 worktree 算出來是同一個鎖路徑', () => {
    const { wtA, wtB } = gitRepoWithWorktrees();
    // 這條是整個功能的地基。鎖放在各自的 worktree 根等於沒鎖——
    // 三個 worktree 會各拿到一把自己的鎖,然後照樣同時跑 Stryker。
    expect(strykerLockPath(wtA)).toBe(strykerLockPath(wtB));
  });

  it('worktree 與主 repo 算出來也是同一個', () => {
    const { main, wtA } = gitRepoWithWorktrees();
    expect(strykerLockPath(wtA)).toBe(strykerLockPath(main));
  });

  it('鎖就在主 repo 的 .git 旁邊,檔名 .stryker.lock', () => {
    const { main, wtA } = gitRepoWithWorktrees();
    expect(strykerLockPath(wtA)).toBe(join(main, '.stryker.lock'));
  });

  it('回的是絕對路徑(主 repo 裡 git 會回相對的 .git,不 resolve 就會算錯)', () => {
    const { main } = gitRepoWithWorktrees();
    const p = strykerLockPath(main);
    expect(p).toBe(resolve(p));
  });

  it('worktree 的子目錄算出來還是同一個', () => {
    const { main, wtA } = gitRepoWithWorktrees();
    const sub = join(wtA, 'packages', 'core');
    mkdirSync(sub, { recursive: true });
    expect(strykerLockPath(sub)).toBe(join(main, '.stryker.lock'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 原子建鎖:兩個行程搶,只有一個拿到
// ─────────────────────────────────────────────────────────────────────────────

/** 寫一支只做「等到 startAt 再搶一次鎖」的小程式,回它的路徑。 */
function writeRacer(dir: string): string {
  // .mts:臨時目錄在 repo 外面,沒有 package.json 的 type: module,
  // 用 .mts 才保證 tsx 走 ESM(不然 import 會被當 CJS 轉譯)。
  const p = join(dir, 'racer.mts');
  writeFileSync(
    p,
    `import { tryAcquire } from ${JSON.stringify(MUTATE_MODULE)};
const [lockPath, startAt] = process.argv.slice(2);
// 兩個子行程的啟動時間差好幾百毫秒,不對齊就不是搶,是排隊。
// 先空轉到同一個時間點,兩邊才真的會撞在 openSync 的同一瞬間。
while (Date.now() < Number(startAt)) { /* spin */ }
const ok = tryAcquire(lockPath, { pid: process.pid, startedAt: new Date().toISOString(), cwd: process.cwd() });
console.log(ok ? 'WON' : 'LOST');
`,
    'utf8',
  );
  return p;
}

/**
 * 直接用 `node --import tsx`,不要 `npx tsx`:npx 會再包一層行程,
 * child.kill('SIGTERM') 打在 npx 上,底下真正的 node 收不到,SIGTERM 那條測試就會吊死。
 */
function runChild(script: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], { cwd: REPO_ROOT });
    let out = '';
    child.stdout?.on('data', (c) => (out += String(c)));
    child.stderr?.on('data', (c) => (out += String(c)));
    child.on('error', rej);
    child.on('close', (code) => res({ code, out }));
  });
}

describe('tryAcquire(openSync wx)', () => {
  it(
    '兩個行程同時搶,只有一個拿到',
    async () => {
      const dir = tmp('mutate-lock-race');
      const lockPath = join(dir, '.stryker.lock');
      const racer = writeRacer(dir);
      // tsx 冷啟動要一到三秒,對齊點抓寬一點,兩邊才都來得及進到 spin。
      const startAt = String(Date.now() + 8_000);

      const [a, b] = await Promise.all([runChild(racer, [lockPath, startAt]), runChild(racer, [lockPath, startAt])]);

      expect(a.code, a.out).toBe(0);
      expect(b.code, b.out).toBe(0);
      const results = [a.out, b.out].map((o) => o.trim().split('\n').pop());
      expect(results.filter((r) => r === 'WON')).toHaveLength(1);
      expect(results.filter((r) => r === 'LOST')).toHaveLength(1);
      expect(existsSync(lockPath)).toBe(true);
    },
    SPAWN_TIMEOUT_MS,
  );

  it('鎖不存在時拿得到,而且寫進去的內容讀得回來', () => {
    const dir = tmp('mutate-lock-acq');
    const lockPath = join(dir, '.stryker.lock');
    const mine = info({ pid: 123, cwd: dir });

    expect(tryAcquire(lockPath, mine)).toBe(true);
    expect(parseLock(readFileSync(lockPath, 'utf8'))).toEqual(mine);
  });

  it('鎖已經在的時候回 false,而且不覆蓋原本的內容', () => {
    const dir = tmp('mutate-lock-acq2');
    const lockPath = join(dir, '.stryker.lock');
    const first = info({ pid: 111, cwd: '/first' });
    expect(tryAcquire(lockPath, first)).toBe(true);

    expect(tryAcquire(lockPath, info({ pid: 222, cwd: '/second' }))).toBe(false);
    // 覆蓋別人的鎖 = 兩個 Stryker 一起跑。這條比回傳值更重要。
    expect(parseLock(readFileSync(lockPath, 'utf8'))).toEqual(first);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 判鎖:活的 / 殘的
// ─────────────────────────────────────────────────────────────────────────────

describe('pidIsAlive', () => {
  it('自己的 pid 是活的', () => {
    expect(pidIsAlive(process.pid)).toBe(true);
  });

  it('ESRCH(程序不在)算死的', () => {
    expect(pidIsAlive(DEAD_PID)).toBe(false);
  });

  it('EPERM(程序在,只是不是我的)算活的', () => {
    // 【判斷】EPERM 證明那個 pid **存在**,只是我沒權限 signal 它。
    // 當成殘鎖就會刪掉別人正在用的鎖,那正是這支要防的踩踏。不確定就別刪。
    const kill = () => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    };
    expect(pidIsAlive(1, kill)).toBe(true);
  });

  it('其他錯誤碼也當活的(不確定就別刪)', () => {
    const kill = () => {
      throw Object.assign(new Error('weird'), { code: 'EWHATEVER' });
    };
    expect(pidIsAlive(1, kill)).toBe(true);
  });
});

describe('parseLock', () => {
  it('合法的鎖檔解得出來', () => {
    expect(parseLock(JSON.stringify(info()))).toEqual(info());
  });

  it.each([
    ['空字串', ''],
    ['只有空白', '   \n'],
    ['半截 JSON', '{"pid":42,'],
    ['不是物件', '"hello"'],
    ['null', 'null'],
    ['陣列', '[1,2,3]'],
    ['少了 pid', JSON.stringify({ startedAt: new Date(T0).toISOString(), cwd: '/x' })],
    ['pid 是字串', JSON.stringify({ pid: '42', startedAt: new Date(T0).toISOString(), cwd: '/x' })],
    ['pid 是 NaN 來源', JSON.stringify({ pid: null, startedAt: new Date(T0).toISOString(), cwd: '/x' })],
    ['startedAt 不是可解析的時間', JSON.stringify({ pid: 42, startedAt: 'not-a-date', cwd: '/x' })],
    ['少了 cwd', JSON.stringify({ pid: 42, startedAt: new Date(T0).toISOString() })],
  ])('壞掉的鎖檔(%s)回 null', (_name, raw) => {
    expect(parseLock(raw)).toBeNull();
  });
});

describe('classifyLock', () => {
  const alive = () => true;
  const dead = () => false;

  it('pid 還在、時間也還沒到 → 活鎖', () => {
    const v = classifyLock(read(JSON.stringify(info())), { now: T0 + 60_000, isAlive: alive });
    expect(v.kind).toBe('live');
    expect(v.info).toEqual(info());
  });

  it('pid 不在(ESRCH)→ 殘鎖', () => {
    const v = classifyLock(read(JSON.stringify(info())), { now: T0 + 60_000, isAlive: dead });
    expect(v.kind).toBe('stale');
    expect(v.why).toContain('pid');
  });

  // ── startedAt 的邊界 ─────────────────────────────────────────────
  // 【判斷】規格寫「**超過** 2 小時」。剛好 2 小時是「還沒超過」,所以還是活鎖,
  // 只有嚴格大於才算殘。這兩條把 > 跟 >= 釘死,少一條就分不出來。

  it('剛好 2 小時 → 還是活鎖(規格是「超過」,不是「達到」)', () => {
    const v = classifyLock(read(JSON.stringify(info())), { now: T0 + STALE_AFTER_MS, isAlive: alive });
    expect(v.kind).toBe('live');
  });

  it('2 小時又 1 毫秒 → 殘鎖', () => {
    const v = classifyLock(read(JSON.stringify(info())), { now: T0 + STALE_AFTER_MS + 1, isAlive: alive });
    expect(v.kind).toBe('stale');
    expect(v.why).toContain('小時');
  });

  it('2 小時差 1 毫秒 → 活鎖', () => {
    const v = classifyLock(read(JSON.stringify(info())), { now: T0 + STALE_AFTER_MS - 1, isAlive: alive });
    expect(v.kind).toBe('live');
  });

  it('超時的鎖就算 pid 還活著也算殘鎖(pid 會重用,時間才是保底)', () => {
    const v = classifyLock(read(JSON.stringify(info())), { now: T0 + STALE_AFTER_MS + 1, isAlive: alive });
    expect(v.kind).toBe('stale');
  });

  it('startedAt 在未來(時鐘跳了)不算殘鎖', () => {
    // 負的年齡不能被當成「超過兩小時」。跨機器或 NTP 校時之後會長這樣。
    const v = classifyLock(read(JSON.stringify(info())), { now: T0 - 60_000, isAlive: alive });
    expect(v.kind).toBe('live');
  });

  // ── 鎖檔內容壞掉的邊界 ───────────────────────────────────────────
  // 【判斷】壞檔分兩種:
  //   (a) 剛被 openSync('wx') 建出來、內容還沒寫進去——那不是壞,是還沒寫完,
  //       這個窗口只有幾毫秒。這時候刪掉就等於搶走別人剛拿到的鎖。
  //   (b) 真的壞了(程序寫到一半被 OOM 殺掉)——留著會擋滿 90 分鐘。
  // 用鎖檔的 mtime 分:CORRUPT_GRACE_MS 之內當活的,之後當殘的。

  it('壞掉的鎖檔、剛寫沒多久 → 當活鎖(可能是別人才剛 openSync 還沒寫完)', () => {
    const v = classifyLock(read('', T0), { now: T0 + CORRUPT_GRACE_MS - 1, isAlive: dead });
    expect(v.kind).toBe('live');
    expect(v.info).toBeNull();
  });

  it('壞掉的鎖檔、剛好在寬限期上 → 當活鎖', () => {
    const v = classifyLock(read('', T0), { now: T0 + CORRUPT_GRACE_MS, isAlive: dead });
    expect(v.kind).toBe('live');
  });

  it('壞掉的鎖檔、超過寬限期 → 殘鎖,刪掉', () => {
    const v = classifyLock(read('{"pid":', T0), { now: T0 + CORRUPT_GRACE_MS + 1, isAlive: dead });
    expect(v.kind).toBe('stale');
    expect(v.info).toBeNull();
    expect(v.why).toContain('讀不出');
  });

  it('壞掉的鎖檔超過寬限期時,不會去問 isAlive(根本沒有 pid 可問)', () => {
    let asked = 0;
    classifyLock(read('garbage', T0), {
      now: T0 + CORRUPT_GRACE_MS + 1,
      isAlive: () => {
        asked++;
        return true;
      },
    });
    expect(asked).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 讀鎖 / 刪鎖
// ─────────────────────────────────────────────────────────────────────────────

describe('readLock', () => {
  it('檔案不在回 null', () => {
    expect(readLock(join(tmp('mutate-lock-read'), 'nope.lock'))).toBeNull();
  });

  it('讀得到內容與 mtime', () => {
    const dir = tmp('mutate-lock-read2');
    const p = join(dir, '.stryker.lock');
    writeFileSync(p, 'hello', 'utf8');
    const past = T0 / 1000 - 3600; // utimesSync 收的是秒
    utimesSync(p, past, past);

    const r = readLock(p);
    expect(r?.raw).toBe('hello');
    expect(r?.mtimeMs).toBe(statSync(p).mtimeMs);
  });
});

describe('releaseLock', () => {
  it('是自己的鎖就刪掉', () => {
    const dir = tmp('mutate-lock-rel');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: 777 }));

    expect(releaseLock(p, 777)).toBe(true);
    expect(existsSync(p)).toBe(false);
  });

  it('不是自己的鎖就不動它', () => {
    // 【判斷】誤刪別人的鎖是立刻踩踏;留下殘鎖最多兩小時後自己過期。往不刪的方向保守。
    const dir = tmp('mutate-lock-rel2');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: 777 }));

    expect(releaseLock(p, 888)).toBe(false);
    expect(existsSync(p)).toBe(true);
  });

  it('鎖已經不在了也不丟例外(release 會被 finally 跟 signal 各叫一次)', () => {
    const p = join(tmp('mutate-lock-rel3'), '.stryker.lock');
    expect(() => releaseLock(p, 777)).not.toThrow();
    expect(releaseLock(p, 777)).toBe(false);
  });

  it('鎖檔壞掉時不刪(讀不出 pid 就證明不了是自己的)', () => {
    const dir = tmp('mutate-lock-rel4');
    const p = join(dir, '.stryker.lock');
    writeFileSync(p, 'not json', 'utf8');
    expect(releaseLock(p, 777)).toBe(false);
    expect(existsSync(p)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 等鎖:假時鐘,不真的等
// ─────────────────────────────────────────────────────────────────────────────

/** 假時鐘:sleep 就是把時間往前推,所以測試是瞬間的。 */
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

describe('acquireLock', () => {
  it('沒人持鎖時直接拿到,一次都不睡', async () => {
    const dir = tmp('mutate-wait-1');
    const p = join(dir, '.stryker.lock');
    const clock = fakeClock();
    const mine = info({ pid: 555, cwd: dir });

    const held = await acquireLock(p, { info: mine, now: clock.now, sleep: clock.sleep, log: () => {} });

    expect(clock.sleeps).toHaveLength(0);
    expect(held.lockPath).toBe(p);
    expect(parseLock(readFileSync(p, 'utf8'))).toEqual(mine);
  });

  it('殘鎖(假 pid)會被清掉,然後立刻拿到——不用等 15 秒', async () => {
    const dir = tmp('mutate-wait-2');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: DEAD_PID, cwd: '/dead/worktree' }));
    const clock = fakeClock();
    const mine = info({ pid: 555, cwd: dir });

    const held = await acquireLock(p, {
      info: mine,
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
      isAlive: () => false,
    });

    // 殘鎖是「馬上可以用」,不是「等 15 秒再看一次」。睡了就代表白等。
    expect(clock.sleeps).toHaveLength(0);
    expect(held.info).toEqual(mine);
    expect(parseLock(readFileSync(p, 'utf8'))).toEqual(mine);
  });

  it('超過 2 小時的鎖也算殘鎖,清掉重拿', async () => {
    const dir = tmp('mutate-wait-3');
    const p = join(dir, '.stryker.lock');
    // startedAt 是 3 小時前,但 pid 還「活著」
    tryAcquire(p, info({ pid: 999, startedAt: new Date(T0 - 3 * 3600_000).toISOString() }));
    const clock = fakeClock();
    const mine = info({ pid: 555, cwd: dir });

    await acquireLock(p, { info: mine, now: clock.now, sleep: clock.sleep, log: () => {}, isAlive: () => true });

    expect(clock.sleeps).toHaveLength(0);
    expect(parseLock(readFileSync(p, 'utf8'))).toEqual(mine);
  });

  it('活鎖時每 15 秒重試一次,並印出持鎖的 worktree 與 pid', async () => {
    const dir = tmp('mutate-wait-4');
    const p = join(dir, '.stryker.lock');
    const holder = info({ pid: 4242, cwd: '/other/worktree' });
    tryAcquire(p, holder);
    const logs: string[] = [];
    // 第二次睡的時候別人放掉鎖 → 第三次嘗試就拿到
    const clock = fakeClock((n) => {
      if (n === 2) rmSync(p);
    });

    await acquireLock(p, {
      info: info({ pid: 555, cwd: dir }),
      now: clock.now,
      sleep: clock.sleep,
      log: (m) => logs.push(m),
      isAlive: () => true,
    });

    expect(clock.sleeps).toEqual([RETRY_INTERVAL_MS, RETRY_INTERVAL_MS]);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain('/other/worktree');
    expect(logs[0]).toContain('4242');
  });

  it('等超過 90 分鐘就放棄,丟 LockTimeoutError', async () => {
    const dir = tmp('mutate-wait-5');
    const p = join(dir, '.stryker.lock');
    const holder = info({ pid: 4242, cwd: '/busy/worktree' });
    // startedAt 每次都跟著假時鐘走,不然等到一半會被 2 小時規則判成殘鎖
    tryAcquire(p, holder);
    const clock = fakeClock();

    const err = await acquireLock(p, {
      info: info({ pid: 555, cwd: dir }),
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
      isAlive: () => true,
      // 2 小時的殘鎖規則會在 90 分鐘之內就先觸發,這裡把它調高才測得到等待上限
      staleAfterMs: Number.POSITIVE_INFINITY,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LockTimeoutError);
    const timeout = err as LockTimeoutError;
    expect(timeout.waitedMs).toBe(MAX_WAIT_MS);
    expect(timeout.holder?.pid).toBe(4242);
    // 90 分鐘 / 15 秒 = 360 次
    expect(clock.sleeps).toHaveLength(MAX_WAIT_MS / RETRY_INTERVAL_MS);
    // 放棄不等於接管:鎖不是我的,不能刪
    expect(existsSync(p)).toBe(true);
  });

  it('等待上限與重試間隔可以調,邊界是「等滿才放棄」', async () => {
    const dir = tmp('mutate-wait-6');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: 4242 }));
    const clock = fakeClock();

    const err = await acquireLock(p, {
      info: info({ pid: 555, cwd: dir }),
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
      isAlive: () => true,
      retryMs: 15_000,
      maxWaitMs: 45_000,
      staleAfterMs: Number.POSITIVE_INFINITY,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LockTimeoutError);
    // t=0 失敗睡、t=15s 失敗睡、t=30s 失敗睡、t=45s 失敗 → 等滿 45 秒才放棄
    expect(clock.sleeps).toEqual([15_000, 15_000, 15_000]);
  });
});

describe('waitingMessage', () => {
  it('印得出是哪個 worktree 的哪個 pid', () => {
    const m = waitingMessage(info({ pid: 4242, cwd: '/home/x/wt-a' }), 30_000);
    expect(m).toContain('等');
    expect(m).toContain('/home/x/wt-a');
    expect(m).toContain('4242');
    expect(m).toContain('Stryker');
  });

  it('鎖檔讀不出持有者時也印得出東西,不是 undefined', () => {
    const m = waitingMessage(null, 30_000);
    expect(m).toContain('Stryker');
    expect(m).not.toContain('undefined');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. 清理:finally 與 signal
// ─────────────────────────────────────────────────────────────────────────────

function fakeSignalTarget() {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  const exits: (number | undefined)[] = [];
  const target: SignalTarget = {
    on(event, handler) {
      handlers.set(event, handler);
      return target;
    },
    off(event) {
      handlers.delete(event);
      return target;
    },
    exit(code?: number): never {
      exits.push(code);
      throw new Error(`__exit__${code}`);
    },
  };
  return { target, handlers, exits };
}

describe('installCleanup', () => {
  it('掛上 SIGINT / SIGTERM / exit 三個 handler', () => {
    const { target, handlers } = fakeSignalTarget();
    installCleanup(() => {}, target);
    expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM', 'exit']);
  });

  it('SIGTERM 會 release,然後以 143 結束', () => {
    const { target, handlers, exits } = fakeSignalTarget();
    let released = 0;
    installCleanup(() => released++, target);

    expect(() => handlers.get('SIGTERM')?.()).toThrow('__exit__143');
    expect(released).toBe(1);
    expect(exits).toEqual([143]);
  });

  it('SIGINT 會 release,然後以 130 結束', () => {
    const { target, handlers, exits } = fakeSignalTarget();
    let released = 0;
    installCleanup(() => released++, target);

    expect(() => handlers.get('SIGINT')?.()).toThrow('__exit__130');
    expect(released).toBe(1);
    expect(exits).toEqual([130]);
  });

  it('exit 會 release,但不會再 exit 一次(已經在結束了)', () => {
    const { target, handlers, exits } = fakeSignalTarget();
    let released = 0;
    installCleanup(() => released++, target);

    expect(() => handlers.get('exit')?.()).not.toThrow();
    expect(released).toBe(1);
    expect(exits).toEqual([]);
  });

  it('回傳的函式會把 handler 拆掉', () => {
    const { target, handlers } = fakeSignalTarget();
    const uninstall = installCleanup(() => {}, target);
    uninstall();
    expect([...handlers.keys()]).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. SIGTERM 之後鎖不留(真的開子行程、真的 kill)
// ─────────────────────────────────────────────────────────────────────────────

/** 寫一支「拿鎖 → 假裝在跑 Stryker(永遠不結束)」的小程式。 */
function writeHolder(dir: string): string {
  const p = join(dir, 'holder.mts'); // 同 racer:.mts 才保證走 ESM
  writeFileSync(
    p,
    `import { runMutate } from ${JSON.stringify(MUTATE_MODULE)};
const lockPath = process.argv[2];
await runMutate({
  lockPath,
  // 不真的跑 Stryker。這裡只要一個永遠不結束的東西,好讓 SIGTERM 打在「跑到一半」。
  runStryker: async () => {
    console.log('HELD');
    // 要用 setTimeout 而不是一個永不 resolve 的 Promise:光是 pending 的 Promise
    // 不算 event loop handle,node 會直接判定沒事做然後結束,測試就測不到 SIGTERM。
    await new Promise((r) => setTimeout(r, 600_000));
    return 0;
  },
  log: (m) => console.log(m),
});
`,
    'utf8',
  );
  return p;
}

describe('SIGTERM 之後鎖不留', () => {
  it(
    '跑到一半被 SIGTERM 殺掉,鎖檔不會留下來',
    async () => {
      const dir = tmp('mutate-sigterm');
      const lockPath = join(dir, '.stryker.lock');
      const holder = writeHolder(dir);

      const child = spawn(process.execPath, ['--import', 'tsx', holder, lockPath], { cwd: REPO_ROOT });
      let out = '';
      const exited = new Promise<void>((res) => child.on('close', () => res()));
      const held = new Promise<void>((res, rej) => {
        child.stdout.on('data', (c) => {
          out += String(c);
          if (out.includes('HELD')) res();
        });
        // 子行程沒印 HELD 就先死了(例如 runMutate 還沒實作),不要在這裡吊滿 60 秒
        void exited.then(() => rej(new Error(`子行程沒拿到鎖就結束了:\n${out}`)));
      });

      await held;
      expect(existsSync(lockPath), `拿到鎖之前鎖檔就該在:${out}`).toBe(true);

      child.kill('SIGTERM');
      await exited;

      // 這條就是整張票的重點。留下鎖檔 = 下一個人白等 90 分鐘然後 exit 1。
      expect(existsSync(lockPath), `SIGTERM 之後鎖還在:${out}`).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. 參數透傳
// ─────────────────────────────────────────────────────────────────────────────

describe('strykerArgs', () => {
  it.each([
    ['沒有參數', ['node', 'mutate.ts'], ['run']],
    ['只有 --', ['node', 'mutate.ts', '--'], ['run']],
    ['一般參數原樣透傳', ['node', 'mutate.ts', '--', '--concurrency', '2'], ['run', '--concurrency', '2']],
    [
      '設定檔當位置參數',
      ['node', 'mutate.ts', '--', 'stryker.scanner-doclinks.json'],
      ['run', 'stryker.scanner-doclinks.json'],
    ],
    [
      '--mutate 的值有逗號與驚嘆號,不能被拆開',
      ['node', 'mutate.ts', '--', '--mutate', 'a.ts,!a.test.ts'],
      ['run', '--mutate', 'a.ts,!a.test.ts'],
    ],
    ['使用者自己打了 run 就不補第二次', ['node', 'mutate.ts', '--', 'run', '--foo'], ['run', '--foo']],
    ['第二個 -- 之後的也原樣透傳', ['node', 'mutate.ts', '--', '--a', '--', '--b'], ['run', '--a', '--', '--b']],
  ])('%s', (_name, argv, want) => {
    expect(strykerArgs(argv)).toEqual(want);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. runMutate:finally 一定刪鎖
// ─────────────────────────────────────────────────────────────────────────────

function fakeHeld(dir: string): HeldLock & { released: () => number } {
  const p = join(dir, '.stryker.lock');
  const mine = info({ pid: process.pid, cwd: dir });
  tryAcquire(p, mine);
  let n = 0;
  return {
    lockPath: p,
    info: mine,
    release: () => {
      n++;
      releaseLock(p, mine.pid);
    },
    released: () => n,
  };
}

describe('runMutate', () => {
  it('Stryker 成功時回它的退出碼,並刪掉鎖', async () => {
    const dir = tmp('mutate-run-1');
    const held = fakeHeld(dir);

    const code = await runMutate({
      argv: ['node', 'mutate.ts'],
      lockPath: held.lockPath,
      acquire: async () => held,
      runStryker: async () => 0,
      log: () => {},
    });

    expect(code).toBe(0);
    expect(existsSync(held.lockPath)).toBe(false);
  });

  it('Stryker 失敗時把退出碼原樣往外傳,鎖照樣刪掉', async () => {
    const dir = tmp('mutate-run-2');
    const held = fakeHeld(dir);

    const code = await runMutate({
      argv: ['node', 'mutate.ts'],
      lockPath: held.lockPath,
      acquire: async () => held,
      runStryker: async () => 1,
      log: () => {},
    });

    // 分數沒過是 Stryker 的 exit 1,不能被鎖吞掉變成 0——那是靜默的假驗收。
    expect(code).toBe(1);
    expect(existsSync(held.lockPath)).toBe(false);
  });

  it('Stryker 丟例外時鎖也要刪掉(這條就是 finally)', async () => {
    const dir = tmp('mutate-run-3');
    const held = fakeHeld(dir);

    await expect(
      runMutate({
        argv: ['node', 'mutate.ts'],
        lockPath: held.lockPath,
        acquire: async () => held,
        runStryker: async () => {
          throw new Error('stryker 爆了');
        },
        log: () => {},
      }),
    ).rejects.toThrow('stryker 爆了');

    expect(existsSync(held.lockPath)).toBe(false);
    expect(held.released()).toBe(1);
  });

  it('把 -- 之後的參數交給 Stryker', async () => {
    const dir = tmp('mutate-run-4');
    const held = fakeHeld(dir);
    let got: string[] = [];

    await runMutate({
      argv: ['node', 'mutate.ts', '--', '--concurrency', '2'],
      lockPath: held.lockPath,
      acquire: async () => held,
      runStryker: async (a) => {
        got = a;
        return 0;
      },
      log: () => {},
    });

    expect(got).toEqual(['run', '--concurrency', '2']);
  });

  it('等鎖超時回 1,而且根本不跑 Stryker', async () => {
    const dir = tmp('mutate-run-5');
    let ran = false;
    const logs: string[] = [];

    const code = await runMutate({
      argv: ['node', 'mutate.ts'],
      lockPath: join(dir, '.stryker.lock'),
      acquire: async () => {
        throw new LockTimeoutError('等太久了', MAX_WAIT_MS, info());
      },
      runStryker: async () => {
        ran = true;
        return 0;
      },
      log: (m) => logs.push(m),
    });

    expect(code).toBe(1);
    expect(ran).toBe(false);
    expect(logs.join('\n')).toContain('等太久了');
  });

  it('掛上 signal 清理,結束時再拆掉', async () => {
    const dir = tmp('mutate-run-6');
    const held = fakeHeld(dir);
    let installed = 0;
    let uninstalled = 0;

    await runMutate({
      argv: ['node', 'mutate.ts'],
      lockPath: held.lockPath,
      acquire: async () => held,
      runStryker: async () => 0,
      installCleanup: (release) => {
        installed++;
        // 掛進去的必須是「刪這把鎖」,不是別的東西
        expect(typeof release).toBe('function');
        return () => uninstalled++;
      },
      log: () => {},
    });

    expect(installed).toBe(1);
    expect(uninstalled).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. 別在版本控制裡留下鎖
// ─────────────────────────────────────────────────────────────────────────────

describe('.gitignore', () => {
  it('擋掉 .stryker.lock', () => {
    // 鎖就放在主 repo 的根,沒 ignore 的話每次跑 mutate 都會多一個未追蹤檔案。
    const ignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(ignore.split('\n').map((l) => l.trim())).toContain('.stryker.lock');
  });

  it('npm run mutate 走的是 scripts/mutate.ts,不是直接 stryker run', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.mutate).toContain('scripts/mutate.ts');
  });
});
