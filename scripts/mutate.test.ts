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
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  CORRUPT_GRACE_MS,
  LockTimeoutError,
  MAX_WAIT_MS,
  RETRY_INTERVAL_MS,
  STALE_AFTER_MS,
  acquireLock,
  classifyLock,
  configPositionalIndex,
  installCleanup,
  isMainModule,
  parseLock,
  pidIsAlive,
  readLock,
  releaseLock,
  reportBaseName,
  runMutate,
  selfLockInfo,
  strykerArgs,
  strykerLockPath,
  tryAcquire,
  waitingMessage,
  withReportEnforcement,
  type HeldLock,
  type LockInfo,
  type LockVerdict,
  type SignalTarget,
} from './mutate.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const MUTATE_MODULE = join(REPO_ROOT, 'scripts/mutate.ts');
/** 這個 repo 的 tsx。給 cwd 不在 repo 裡的子行程用(bare `--import tsx` 會從 cwd 找 node_modules)。 */
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

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

  it('npm run mutate 走的是 scripts/mutate.ts,不是直接叫 Stryker CLI', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.mutate).toContain('scripts/mutate.ts');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. 審核輪補的:預設值、錯誤往外丟、競態窗口、子行程收屍
//
// 上一輪(實作輪)不准動測試,所以把 55 個沒殺掉的變異裡「真的是漏測」的那些留給這裡。
// 這一節補的都是同一類東西:**注入 fake 之後就沒人走的預設值**,以及
// **不是 ENOENT / EEXIST 就往外丟** 的那幾條 —— 兩者都是真的會影響行為的路徑。
// ─────────────────────────────────────────────────────────────────────────────

describe('錯誤不是 ENOENT / EEXIST 就往外丟', () => {
  it('readLock 碰到 ENOENT 以外的錯誤要往外丟,不能靜靜當成沒鎖', () => {
    // 靜靜回 null = 「沒人持鎖」= 直接搶。權限壞掉那種情況吞掉會讓兩個 Stryker 一起跑。
    const dir = tmp('mutate-lock-readerr');
    const asDir = join(dir, '.stryker.lock');
    mkdirSync(asDir); // 拿目錄當鎖檔:readFileSync 會丟 EISDIR
    expect(() => readLock(asDir)).toThrow(/EISDIR/);
  });

  it('tryAcquire 碰到 EEXIST 以外的錯誤要往外丟,不能靜靜當成「有人持鎖」', () => {
    // 靜靜回 false = 永遠等一把根本建不出來的鎖,90 分鐘之後 exit 1。要立刻爆。
    const dir = tmp('mutate-lock-acqerr');
    const missing = join(dir, 'no-such-dir', '.stryker.lock');
    expect(() => tryAcquire(missing, info())).toThrow(/ENOENT/);
  });
});

describe('selfLockInfo 的預設值', () => {
  it('不給參數時用這個程序的 pid、現在的時間、現在的工作目錄', () => {
    const before = Date.now();
    const self = selfLockInfo();
    const after = Date.now();

    expect(self.pid).toBe(process.pid);
    expect(self.cwd).toBe(process.cwd());
    // 寫死別人的 pid / 別人的 cwd 都會讓 releaseLock 認不出自己的鎖。
    const t = Date.parse(self.startedAt);
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBeGreaterThanOrEqual(before - 1000);
    expect(t).toBeLessThanOrEqual(after + 1000);
  });

  it('給了參數就用給的', () => {
    const self = selfLockInfo('/given/cwd', '2026-09-04T00:00:00.000Z');
    expect(self).toEqual({ pid: process.pid, cwd: '/given/cwd', startedAt: '2026-09-04T00:00:00.000Z' });
  });
});

describe('acquireLock 的預設值(不注入 now / sleep / log 時)', () => {
  it('用真的時鐘、真的 setTimeout、真的 console.log,等滿就丟 LockTimeoutError', async () => {
    const dir = tmp('mutate-lock-realclock');
    const lockPath = join(dir, '.stryker.lock');
    // 持鎖的是「這個程序」——pid 一定活著,所以一定會走到等待那條路。
    // startedAt 必須是「現在」:這條走**真的時鐘**,而 info() 預設的 T0 是寫死的日期,
    // 過了兩小時的殘鎖門檻就會被判定成殘鎖、直接搶到鎖,測試就再也等不到逾時了。
    expect(
      tryAcquire(lockPath, info({ pid: process.pid, cwd: '/holder', startedAt: new Date().toISOString() })),
    ).toBe(true);

    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    const started = Date.now();
    try {
      // 只給 retryMs / maxWaitMs,now / sleep / log 全部走預設值。
      await expect(acquireLock(lockPath, { retryMs: 20, maxWaitMs: 60 })).rejects.toBeInstanceOf(LockTimeoutError);
    } finally {
      spy.mockRestore();
    }
    // 真的睡了(預設 sleep 不是 no-op),也真的用真時鐘算了等待時間。
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
    // 預設 log 真的印到 console.log,不是丟掉。
    expect(lines.some((l) => l.includes('/holder'))).toBe(true);
  });

  it('拿到鎖之後回傳的 release 真的把鎖刪掉', async () => {
    const dir = tmp('mutate-lock-relhandle');
    const lockPath = join(dir, '.stryker.lock');
    const mine = info({ pid: process.pid, cwd: dir });

    const held = await acquireLock(lockPath, { info: mine, now: () => T0, sleep: async () => {}, log: () => {} });
    expect(held.lockPath).toBe(lockPath);
    expect(held.info).toEqual(mine);
    expect(existsSync(lockPath)).toBe(true);

    held.release();
    expect(existsSync(lockPath)).toBe(false);
    // finally 與 signal handler 會各叫一次,第二次不能爆。
    expect(() => held.release()).not.toThrow();
  });

  it('殘鎖在清掉之前就被別人刪走了也不會爆,照樣拿到鎖', async () => {
    // removeLockFile 的 ENOENT 分支:讀到鎖、判成殘鎖、要刪的時候檔案已經不在了。
    // 用 isAlive 的副作用把那個競態窗口變成確定的。
    const dir = tmp('mutate-lock-vanish');
    const lockPath = join(dir, '.stryker.lock');
    expect(tryAcquire(lockPath, info({ pid: DEAD_PID }))).toBe(true);

    let asked = 0;
    const mine = info({ pid: process.pid, cwd: dir });
    const held = await acquireLock(lockPath, {
      info: mine,
      now: () => T0,
      sleep: async () => {},
      log: () => {},
      isAlive: () => {
        asked++;
        rmSync(lockPath, { force: true }); // 別人搶先清掉了殘鎖
        return false;
      },
    });

    expect(asked).toBe(1);
    expect(held.info.pid).toBe(process.pid);
    expect(parseLock(readFileSync(lockPath, 'utf8'))).toEqual(mine);
  });

  it('剛好在 tryAcquire 與 readLock 之間被放掉時,馬上重搶而不是睡 15 秒', async () => {
    // openSync('wx') 對「懸空的 symlink」丟 EEXIST,但 readFileSync 對它丟 ENOENT ——
    // 正好造出「搶不到但也讀不到」的那個窗口。外面的程序把 symlink 移掉之後就該搶到。
    const dir = tmp('mutate-lock-window');
    const lockPath = join(dir, '.stryker.lock');
    symlinkSync(join(dir, 'no-such-target'), lockPath);
    expect(tryAcquire(lockPath, info())).toBe(false);
    expect(readLock(lockPath)).toBeNull();

    // 這一條的迴圈是同步空轉的(read===null 就 continue,不 await),
    // 所以必須由**另一個行程**把 symlink 拿掉,本行程的 timer 不會有機會跑。
    const remover = spawn('sh', ['-c', `sleep 0.5; rm -f ${JSON.stringify(lockPath)}`], { stdio: 'ignore' });
    const mine = info({ pid: process.pid, cwd: dir });
    const sleeps: number[] = [];
    const held = await acquireLock(lockPath, {
      info: mine,
      now: () => T0,
      sleep: async (ms) => void sleeps.push(ms),
      log: () => {},
    });
    remover.kill();

    expect(held.info).toEqual(mine);
    // 重點:一次都沒睡。讀不到鎖是「剛被放掉」,不是「有人在跑」。
    expect(sleeps).toEqual([]);
  }, SPAWN_TIMEOUT_MS);
});

describe('runMutate 的預設值與例外', () => {
  it('不給 lockPath 時用 strykerLockPath(),以現在的 cwd 算', async () => {
    let seen: string | undefined;
    const code = await runMutate({
      argv: ['node', 'mutate.ts'],
      acquire: async (p) => {
        seen = p;
        return { lockPath: p, info: info(), release: () => {} };
      },
      runStryker: async () => 0,
      installCleanup: () => () => {},
      log: () => {},
    });
    expect(code).toBe(0);
    expect(seen).toBe(strykerLockPath());
    expect(seen).toBe(strykerLockPath(process.cwd()));
    // 「鎖在主 repo 的根,不是 worktree 自己的根」**不在這裡**用「套件現在跑在哪」推。
    // 這裡曾寫成 `if (inWorktree) expect(seen).not.toBe(join(REPO_ROOT, '.stryker.lock'))`,
    // 而 inWorktree 是拿被測的 strykerLockPath() 自己算的:函式算錯成 worktree 本地時,
    // inWorktree 恰好變 false、斷言被跳過 —— 綠的是它自己,不是實作
    // (2026-09-05 審核輪實測:把 strykerLockPath 改成回 worktree 本地路徑,這條在 worktree 裡照樣綠)。
    // 那個保證由 §1 的 describe('strykerLockPath') 在臨時 git repo 裡蓋 worktree 直接驗,
    // 再由 §12 的「從 worktree 裡起跑」在行程層級驗一次;兩條都不管套件本身在哪裡跑。
  });

  it('不給 acquire 時走真的 acquireLock', async () => {
    const dir = tmp('mutate-lock-defacq');
    const lockPath = join(dir, '.stryker.lock');
    let sawLock = false;
    const code = await runMutate({
      argv: ['node', 'mutate.ts'],
      lockPath,
      runStryker: async () => {
        // 真的 acquireLock 會把鎖建出來,而且內容是這個程序的。
        sawLock = parseLock(readFileSync(lockPath, 'utf8'))?.pid === process.pid;
        return 7;
      },
      installCleanup: () => () => {},
      log: () => {},
    });
    expect(code).toBe(7);
    expect(sawLock).toBe(true);
    expect(existsSync(lockPath)).toBe(false); // finally 刪掉了
  });

  it('等鎖超時時,不給 log 就印到真的 console.log', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    let code: number;
    try {
      code = await runMutate({
        argv: ['node', 'mutate.ts'],
        lockPath: '/unused',
        acquire: async () => {
          throw new LockTimeoutError('等太久了啦', 123, null);
        },
        runStryker: async () => 0,
        installCleanup: () => () => {},
      });
    } finally {
      spy.mockRestore();
    }
    expect(code).toBe(1);
    // 靜靜 return 1 而不印訊息 = 人看到 exit 1 但不知道是在等鎖。
    expect(lines.join('\n')).toContain('等太久了啦');
  });

  it('acquire 丟的不是 LockTimeoutError 就原樣往外丟,不能翻成 exit 1', async () => {
    // 翻成 exit 1 會讓「磁碟壞了」長得跟「等鎖等太久」一模一樣。
    const boom = new Error('磁碟壞了');
    await expect(
      runMutate({
        argv: ['node', 'mutate.ts'],
        lockPath: '/unused',
        acquire: async () => {
          throw boom;
        },
        runStryker: async () => 0,
        installCleanup: () => () => {},
        log: () => {},
      }),
    ).rejects.toBe(boom);
  });

  it('交給 installCleanup 的那個 callback 真的會放掉這一把鎖', async () => {
    const dir = tmp('mutate-lock-cbrel');
    const lockPath = join(dir, '.stryker.lock');
    let onSignal: (() => void) | undefined;
    await runMutate({
      argv: ['node', 'mutate.ts'],
      lockPath,
      runStryker: async () => {
        // Stryker 還在跑的時候,signal 進來就該走這個 callback。
        expect(existsSync(lockPath)).toBe(true);
        onSignal?.();
        expect(existsSync(lockPath), 'signal 的 callback 沒有放掉鎖').toBe(false);
        return 0;
      },
      installCleanup: (release) => {
        onSignal = release;
        return () => {};
      },
      log: () => {},
    });
    expect(onSignal).toBeTypeOf('function');
  });
});

describe('isMainModule', () => {
  const selfUrl = pathToFileURL(MUTATE_MODULE).href;

  it('沒有 argv[1](-e / REPL)時不算主模組', () => {
    // 回 true 的話,任何 import 這個模組的人都會被順便跑一輪 Stryker。
    expect(isMainModule(undefined, selfUrl)).toBe(false);
    expect(isMainModule('', selfUrl)).toBe(false);
  });

  it('argv[1] 就是這個檔案時算主模組', () => {
    expect(isMainModule(MUTATE_MODULE, selfUrl)).toBe(true);
  });

  it('相對路徑跟絕對路徑指到同一個檔案也算', () => {
    expect(isMainModule('./scripts/mutate.ts', pathToFileURL(join(REPO_ROOT, 'scripts/mutate.ts')).href)).toBe(
      resolve('./scripts/mutate.ts') === MUTATE_MODULE,
    );
  });

  it('別的檔案不算主模組', () => {
    expect(isMainModule(join(REPO_ROOT, 'scripts/mutate.test.ts'), selfUrl)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. 審核輪補的:SIGTERM 之後 Stryker 子行程也要一起收掉
//
// 上一輪只驗了「鎖不留」,沒有驗「子行程不留」。**殘留的 Stryker 會繼續吃記憶體**,
// 那正是這張工單要解的問題——鎖放掉了、吃記憶體的還在,下一個人照樣被 OOM。
//
// `spawnStryker` 沒有 export,也寫死了 `../node_modules/.bin/stryker`。
// 所以這裡把 `scripts/mutate.ts` **原封不動複製**到一個臨時目錄,在它旁邊放一支
// 假的 `node_modules/.bin/stryker`,走的就是真正的 spawnStryker 那條路。
// ─────────────────────────────────────────────────────────────────────────────

/** 造一份「mutate.ts 的複本 + 假 stryker」的沙盒,回 runner 腳本的路徑。 */
function sandboxWithFakeStryker(dir: string): { runner: string; pidFile: string } {
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  // 一個字都不改地複製,測到的才是真的那支。
  cpSync(MUTATE_MODULE, join(dir, 'scripts', 'mutate.ts'));

  const pidFile = join(dir, 'stryker.pid');
  const bin = join(dir, 'node_modules', '.bin', 'stryker');
  // `exec` 之後 sleep 就是這個 pid 本人,kill 到它才算真的收掉(不會只殺掉外層 sh)。
  writeFileSync(bin, `#!/bin/sh\necho $$ > ${JSON.stringify(pidFile)}\nexec sleep 600\n`, 'utf8');
  chmodSync(bin, 0o755);

  const runner = join(dir, 'runner.mts');
  writeFileSync(
    runner,
    `import { runMutate } from ${JSON.stringify(join(dir, 'scripts', 'mutate.ts'))};
// 只給 lockPath:runStryker 走預設值,也就是真的 spawnStryker。
const code = await runMutate({ lockPath: process.argv[2], argv: ['node', 'x'] });
console.log('EXITED ' + code);
`,
    'utf8',
  );
  return { runner, pidFile };
}

describe('SIGTERM 之後 Stryker 子行程不留', () => {
  it(
    '殺掉 npm run mutate,底下的 stryker 也要跟著死(不然它繼續吃記憶體)',
    async () => {
      const dir = tmp('mutate-childkill');
      const lockPath = join(dir, '.stryker.lock');
      const { runner, pidFile } = sandboxWithFakeStryker(dir);

      const child = spawn(process.execPath, ['--import', 'tsx', runner, lockPath], { cwd: REPO_ROOT });
      let out = '';
      child.stdout.on('data', (c) => (out += String(c)));
      child.stderr.on('data', (c) => (out += String(c)));
      const exited = new Promise<number | null>((res) => child.on('close', (code) => res(code)));

      // 等到假 stryker 真的被 spawn 起來為止。
      const deadline = Date.now() + SPAWN_TIMEOUT_MS - 5_000;
      while (!existsSync(pidFile) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(existsSync(pidFile), `假 stryker 沒被叫起來:${out}`).toBe(true);
      const strykerPid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(Number.isInteger(strykerPid) && strykerPid > 0).toBe(true);
      expect(pidIsAlive(strykerPid)).toBe(true);
      expect(existsSync(lockPath)).toBe(true);

      child.kill('SIGTERM');
      await exited;

      // 給 kernel 一點時間收屍。
      const gone = Date.now() + 5_000;
      while (pidIsAlive(strykerPid) && Date.now() < gone) {
        await new Promise((r) => setTimeout(r, 100));
      }

      // 這兩條缺一不可:鎖放掉了但 stryker 還在 = 下一個人拿到鎖,然後被同一個 stryker OOM。
      expect(pidIsAlive(strykerPid), `父行程死了但 stryker (pid ${strykerPid}) 還活著:${out}`).toBe(false);
      expect(existsSync(lockPath), `SIGTERM 之後鎖還在:${out}`).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 12b. 審核輪(allsuite-lock 的另一半):SIGTERM 之後 Stryker 的 **worker** 也不留
//
// §12 只驗了「stryker 主行程死掉」。Stryker 本來就會開一票 worker(child-process-proxy-worker)
// 跑變異,而且跑得久(90 分鐘逾時),中途被打斷的機率高。實測(2026-09-05,本 worktree,
// `npm run mutate -- stryker.scanner-mutatelock.json`,worker 起來後對跑 mutate.ts 的那個 node
// 送 SIGTERM):5 個 worker 剩 **1 個**孤兒,5 秒後還活著;打 tsx 啟動器那個 pid 也是剩 1。
// 孤兒 worker 正是這整條線要解的問題的成因之一:機器被壓垮 → 探針逾時 → 假紅 → 紅燈被當雜訊。
//
// `spawnVitest`(scripts/run-tests.ts)那邊已經做了 detached + 對整個 process group 送 signal,
// 而且實測歸零。這裡釘的是 `spawnStryker` 要**對稱**:主行程死,整個 group 一起死。
//
// 假 stryker 用 node 寫:spawn 3 個 `sleep` 當 worker、把 pid 寫檔、然後留著不退。
// node 吃到 SIGTERM / SIGINT 會自己死,但**不會**替子行程收屍——跟真 Stryker 留孤兒是同一個形狀。
// 只 signal 主行程 → 3 個 sleep 全活(紅);signal 整個 group → 3 個全死(綠)。
// 第一版是 sh 腳本 + `sleep &`:POSIX 規定非互動 sh 用 `&` 起的子行程 **SIGINT 設成忽略**,
// 群組送 SIGINT 時 3 個 sleep 全活——那是 sh 的規矩,不是 spawnStryker 的洞(真 Stryker 的 worker
// 是 node,實測 SIGINT 也歸零)。改成 node 起 worker,SIGTERM / SIGINT 兩個版本才都測得到真的東西。
// ─────────────────────────────────────────────────────────────────────────────

/** 造「mutate.ts 的複本 + 會 fork 3 個 worker 的假 stryker」的沙盒。 */
function sandboxWithForkingStryker(dir: string): { runner: string; pidFile: string; workersFile: string } {
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  cpSync(MUTATE_MODULE, join(dir, 'scripts', 'mutate.ts'));

  const pidFile = join(dir, 'stryker.pid');
  const workersFile = join(dir, 'workers.pid');
  const bin = join(dir, 'node_modules', '.bin', 'stryker');
  // 三個 worker 各自是一個 sleep 行程(同一個 process group,signal 的預設處置)。setInterval 讓
  // node 留在那裡當「Stryker 主行程」。sleep 300 不是 600:測試若紅,finally 會收掉;萬一沒收到,
  // 5 分鐘也會自己走。沙盒沒有 package.json → 這個檔是 CommonJS,用 require。
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { writeFileSync, appendFileSync } = require('node:fs');
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
for (let i = 0; i < 3; i++) {
  const w = spawn('sleep', ['300'], { stdio: 'ignore' });
  appendFileSync(${JSON.stringify(workersFile)}, w.pid + '\\n');
}
setInterval(() => {}, 1000);
`,
    'utf8',
  );
  chmodSync(bin, 0o755);

  const runner = join(dir, 'runner.mts');
  writeFileSync(
    runner,
    `import { runMutate } from ${JSON.stringify(join(dir, 'scripts', 'mutate.ts'))};
// 只給 lockPath:runStryker 走預設值,也就是真的 spawnStryker。
const code = await runMutate({ lockPath: process.argv[2], argv: ['node', 'x'] });
console.log('EXITED ' + code);
`,
    'utf8',
  );
  return { runner, pidFile, workersFile };
}

/** 讀 workers.pid,回目前寫進去的 pid(可能還沒寫滿)。 */
function readWorkerPids(workersFile: string): number[] {
  if (!existsSync(workersFile)) return [];
  return readFileSync(workersFile, 'utf8')
    .split('\n')
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

describe.each(['SIGTERM', 'SIGINT'] as const)('%s 之後 Stryker 的 worker 不留', (sig) => {
  it(
    `殺掉 npm run mutate(${sig}),stryker 底下 fork 出來的 worker 也要跟著死,一個都不能留`,
    async () => {
      const dir = tmp('mutate-workerkill');
      const lockPath = join(dir, '.stryker.lock');
      const { runner, pidFile, workersFile } = sandboxWithForkingStryker(dir);

      const child = spawn(process.execPath, ['--import', 'tsx', runner, lockPath], { cwd: REPO_ROOT });
      let out = '';
      child.stdout.on('data', (c) => (out += String(c)));
      child.stderr.on('data', (c) => (out += String(c)));
      // 等 `exit` 不等 `close`:孤兒 worker 會把繼承來的 stdout/stderr 管線握著不放,
      // `close` 要等管線全關才發——測試會在該紅的時候吊到逾時,而不是紅在「孤兒還活著」那條斷言上。
      const exited = new Promise<number | null>((res) => child.on('exit', (code) => res(code)));

      let workers: number[] = [];
      try {
        // 等到 3 個 worker 真的都起來(pgrep 數得到)為止。
        const deadline = Date.now() + SPAWN_TIMEOUT_MS - 5_000;
        while (readWorkerPids(workersFile).length < 3 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        workers = readWorkerPids(workersFile);
        expect(workers, `假 stryker 沒把 3 個 worker 起起來:${out}`).toHaveLength(3);
        const strykerPid = Number(readFileSync(pidFile, 'utf8').trim());
        expect(pidIsAlive(strykerPid)).toBe(true);
        for (const w of workers) expect(pidIsAlive(w), `worker ${w} 起來就死了`).toBe(true);
        expect(existsSync(lockPath)).toBe(true);

        // 只打 runner 這一個 pid——`kill <pid>`、Ctrl-C、被 timeout 砍、被 supervisor 收都是這個形狀。
        // SIGINT 也要 0:Stryker 是 detached 起的,終端機的 Ctrl-C 只會送到 mutate.ts 的 group,
        // 不會直接到 Stryker 那組,全靠 forward 轉。實測(2026-09-05,真 Stryker,5 個 worker)兩種都歸零。
        child.kill(sig);
        await exited;

        // 給 kernel 一點時間收屍;3 個都死了就不用等滿。
        const gone = Date.now() + 5_000;
        // 不能寫 `workers.some(pidIsAlive)`:some / filter 會把索引當第二個參數塞進去,
        // 那是 pidIsAlive 可注入的 `kill`,索引 0 → `kill = 0` → TypeError → 被當成「活著」。
        // 第一版就是這樣紅在假孤兒上的。
        const alive = (w: number) => pidIsAlive(w);
        while (workers.some(alive) && Date.now() < gone) {
          await new Promise((r) => setTimeout(r, 100));
        }

        const survivors = workers.filter(alive);
        // 主行程死了、鎖放了,但 worker 還在跑 = 下一個拿到鎖的人跟這幾個 worker 搶 CPU,
        // 正是這把鎖要防的假紅。要的是 **0**,不是「少幾個」。
        expect(survivors, `stryker 主行程死了但 worker 還活著(孤兒 ${survivors.length}/3):${out}`).toEqual([]);
        expect(pidIsAlive(strykerPid), `stryker (pid ${strykerPid}) 還活著:${out}`).toBe(false);
        expect(existsSync(lockPath), `SIGTERM 之後鎖還在:${out}`).toBe(false);
      } finally {
        // 測試紅的時候孤兒是真的:自己收掉,不留 3 個 sleep 給下一條測試或下一個人。
        for (const w of workers) {
          try {
            process.kill(w, 'SIGKILL');
          } catch {
            // 已經死了。
          }
        }
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});

// 12c. 審核輪:group kill 只打**自己**的 Stryker group,別的 worktree 的 worker 不動
//
// 兩個 worktree 同時跑(一個持真鎖在跑、一個在等;或各自用不同的鎖檔真的同時跑),其中一個被
// SIGTERM,另一個的 worker **不可以被誤殺**——group kill 打錯 group 會把別人跑到一半的驗收砍掉。
// 實測(2026-09-05,真 Stryker,兩邊各 5 個 worker,先殺 X 與先殺 Y 各做一次):被殺那邊的
// group 歸零,另一邊 worker 一個不少。這裡用兩個沙盒各自 fork 3 個 sleep 釘住同一件事。
// ─────────────────────────────────────────────────────────────────────────────

describe('SIGTERM 只收自己的 Stryker group,別的 worktree 的 worker 不動', () => {
  it(
    '兩個 runner 各帶 3 個 worker:殺 A → A 的 3 個死、B 的 3 個活、B 的鎖還在;再殺 B → 全死',
    async () => {
      const dirA = tmp('mutate-groupkill-a');
      const dirB = tmp('mutate-groupkill-b');
      const A = sandboxWithForkingStryker(dirA);
      const B = sandboxWithForkingStryker(dirB);
      const lockA = join(dirA, '.stryker.lock');
      const lockB = join(dirB, '.stryker.lock');
      // 不能寫 `workers.some(pidIsAlive)`:索引會被塞進 pidIsAlive 可注入的 `kill`(見 §12b)。
      const alive = (w: number) => pidIsAlive(w);
      const settle = async (workers: number[]) => {
        const gone = Date.now() + 5_000;
        while (workers.some(alive) && Date.now() < gone) await new Promise((r) => setTimeout(r, 100));
      };
      const start = (runner: string, lockPath: string) => {
        const child = spawn(process.execPath, ['--import', 'tsx', runner, lockPath], { cwd: REPO_ROOT });
        let out = '';
        child.stdout.on('data', (c) => (out += String(c)));
        child.stderr.on('data', (c) => (out += String(c)));
        // 等 `exit` 不等 `close`,理由同 §12b:孤兒會握著繼承來的管線。
        const exited = new Promise<number | null>((res) => child.on('exit', (code) => res(code)));
        return { child, exited, out: () => out };
      };

      const ra = start(A.runner, lockA);
      const rb = start(B.runner, lockB);
      let wa: number[] = [];
      let wb: number[] = [];
      try {
        const deadline = Date.now() + SPAWN_TIMEOUT_MS - 5_000;
        while ((readWorkerPids(A.workersFile).length < 3 || readWorkerPids(B.workersFile).length < 3) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        wa = readWorkerPids(A.workersFile);
        wb = readWorkerPids(B.workersFile);
        expect(wa, `A 的假 stryker 沒把 3 個 worker 起起來:${ra.out()}`).toHaveLength(3);
        expect(wb, `B 的假 stryker 沒把 3 個 worker 起起來:${rb.out()}`).toHaveLength(3);
        const strykerB = Number(readFileSync(B.pidFile, 'utf8').trim());
        expect(existsSync(lockA)).toBe(true);
        expect(existsSync(lockB)).toBe(true);

        // 殺 A。B 那邊什麼都不該變。
        ra.child.kill('SIGTERM');
        await ra.exited;
        await settle(wa);
        expect(wa.filter(alive), `A 死了但 A 的 worker 還在:${ra.out()}`).toEqual([]);
        expect(existsSync(lockA), `A 死了鎖還在:${ra.out()}`).toBe(false);
        // 這條是核心:B 的 3 個 worker、B 的 stryker、B 的鎖,一個都不能被 A 的 group kill 波及。
        expect(wb.filter(alive), `殺 A 波及到 B 的 worker(B 活著的:${wb.filter(alive).length}/3):${rb.out()}`).toEqual(wb);
        expect(pidIsAlive(strykerB), `殺 A 把 B 的 stryker 也殺了:${rb.out()}`).toBe(true);
        expect(existsSync(lockB), `殺 A 把 B 的鎖也放了:${rb.out()}`).toBe(true);

        // 再殺 B,現在才全死。
        rb.child.kill('SIGTERM');
        await rb.exited;
        await settle(wb);
        expect(wb.filter(alive), `B 死了但 B 的 worker 還在:${rb.out()}`).toEqual([]);
        expect(pidIsAlive(strykerB)).toBe(false);
        expect(existsSync(lockB)).toBe(false);
      } finally {
        for (const w of [...wa, ...wb]) {
          try {
            process.kill(w, 'SIGKILL');
          } catch {
            // 已經死了。
          }
        }
        for (const r of [ra, rb]) {
          if (r.child.exitCode === null && r.child.signalCode === null) r.child.kill('SIGKILL');
        }
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('鎖的位置不看測試套件自己在哪裡跑', () => {
  it(
    '從 worktree 裡起跑、不給 lockPath:鎖落在主 repo 的根,不是那個 worktree 的根',
    async () => {
      // 不靠「套件現在是在 main 還是在某個 worktree 裡跑」:自己 git init 一個主 repo、掛一個 worktree,
      // 子行程的 cwd 就是那個 worktree。原本這件事是靠「套件正好在 worktree 裡跑」才測得到,
      // 套件在 main 上跑就變成永遠紅(或加了守衛之後永遠綠)。這裡兩種位置都測到同一件事。
      const dir = tmp('mutate-lock-from-wt');
      const { main, wtA } = gitRepoWithWorktrees();
      const { runner, pidFile } = sandboxWithFakeStryker(dir);

      // 不傳 lockPath → runMutate 走 strykerLockPath(),用子行程的 cwd(= 那個 worktree)算。
      // 用絕對路徑叫 tsx:cwd 在 /tmp 底下,bare specifier 找不到 node_modules。
      const child = spawn(TSX_BIN, [runner], { cwd: wtA });
      let out = '';
      child.stdout.on('data', (c) => (out += String(c)));
      child.stderr.on('data', (c) => (out += String(c)));
      const exited = new Promise<number | null>((res) => child.on('close', (code) => res(code)));
      try {
        const deadline = Date.now() + SPAWN_TIMEOUT_MS - 5_000;
        while (!existsSync(pidFile) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(existsSync(pidFile), `假 stryker 沒被叫起來:${out}`).toBe(true);
        // 拿到鎖之後才會 spawn stryker,所以此刻鎖一定在。它必須在主 repo 的根,worktree 自己的根不能有。
        expect(existsSync(join(main, '.stryker.lock')), `主 repo 的根沒有鎖:${out}`).toBe(true);
        expect(existsSync(join(wtA, '.stryker.lock')), `鎖落在 worktree 自己的根:${out}`).toBe(false);
      } finally {
        child.kill('SIGTERM');
        await exited;
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. 審核輪補的:不准有人在文件裡教別人繞過鎖
//
// 這條比鎖本身還重要。鎖做得再好,只要工單模板 / skill / 審核紀錄還寫著
// 「直接叫 Stryker CLI」,每一輪審核都會照抄那條指令、繞過鎖,整張工單白做。
// 上一輪是靠人跑一次 grep 確認的;grep 不會自己再跑一次,所以釘成測試。
//
// 掃描範圍**不只文件**。2026-09-05 這條守門抓到兩份 REVIEW.md 裡過期的描述,
// 卻漏掉 `vitest.mutate.config.ts` 檔頭註解裡一條**完整可照抄**的 Stryker CLI 指令 ——
// 因為當時只掃 md / json / sh。真正危險的那一條躲在守門看不到的地方,是人手 grep 才發現的。
// 所以現在**所有會被人照抄的文字檔都掃**:程式碼的註解跟文件一樣會被複製貼上。
// ─────────────────────────────────────────────────────────────────────────────

describe('文件裡不准出現繞過鎖的指令', () => {
  /**
   * 真正的 repo 根。
   *
   * **不能用 `REPO_ROOT`**:Stryker 把整個專案複製到 `.stryker-tmp/sandbox-*` 裡跑測試,
   * 那個複本不是 git repo,沙盒裡也未必有 `.claude/`。往上找到第一個有 `.git`
   * 的祖先(worktree 的 `.git` 是檔案不是目錄,`existsSync` 兩種都認),
   * 就會從沙盒走回真正的 repo——而這條規則本來就該檢查真的那一份。
   */
  function realRepoRoot(): string {
    let dir = REPO_ROOT;
    for (;;) {
      if (existsSync(join(dir, '.git'))) return dir;
      const up = resolve(dir, '..');
      if (up === dir) throw new Error(`從 ${REPO_ROOT} 往上找不到 .git`);
      dir = up;
    }
  }

  const SKIP_DIRS = new Set(['node_modules', '.git', '.stryker-tmp', 'dist', 'target', 'reports', 'coverage']);

  /**
   * `dir` 自己是不是另一個 git 簽出(有 `.git`:一般 repo 是目錄,worktree 是檔案)。
   *
   * 主 repo 的 `.claude/worktrees/agent-*` 就是這種:**本 repo 別的分支**掛出來的 worktree
   * (不是別的 repo——`git worktree list` 看得到它,`.git` 檔指回主 repo 的 `.git/worktrees/`)。
   * 那是另一棵樹,不是我們現在這一份;它裡面的違規要等那個分支合併時由這條守門抓,
   * 現在掃到只會把別的分支的舊檔算在自己頭上 —— 跟 node_modules 同一類。
   * 用「有沒有 .git」認,不用目錄名字認:名字叫 worktrees 的普通目錄照掃,別的名字的巢狀簽出照跳。
   */
  function isNestedCheckout(dir: string): boolean {
    return existsSync(join(dir, '.git'));
  }

  /**
   * 會被人照抄的文字檔副檔名。文件、設定、腳本、**程式碼**(註解裡的指令一樣會被複製)。
   * 名單是白名單不是黑名單:二進位檔(png / ico / icns)與 lock 檔不掃,
   * 新的文字檔類型進 repo 時要來這裡加一行,不然又是一個守門看不到的角落。
   */
  const SCAN_EXTS = new Set([
    // 文件
    'md', 'txt', 'rst',
    // 設定 / 資料
    'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'env', 'example', 'template',
    // 腳本
    'sh', 'bash', 'zsh', 'ps1', 'py',
    // 程式碼(含 vitest / stryker 設定檔——它們是 .ts,檔頭註解就是文件)
    'ts', 'mts', 'cts', 'tsx', 'js', 'mjs', 'cjs', 'jsx', 'svelte', 'rs', 'html', 'css',
    // 驗收
    'feature',
  ]);

  /** 檔名的副檔名(小寫,沒有點)。`.gitignore` 這種點開頭的檔名回 'gitignore'。 */
  function extOf(name: string): string {
    const i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  }

  /** 掃 `root` 底下會被人照抄的文字檔。回相對路徑(排序過)。 */
  function scanFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (rel: string) => {
      for (const e of readdirSync(join(root, rel) || root, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          const sub = rel ? join(rel, e.name) : e.name;
          if (isNestedCheckout(join(root, sub))) continue;
          walk(sub);
        } else if (SCAN_EXTS.has(extOf(e.name))) {
          out.push(rel ? join(rel, e.name) : e.name);
        }
      }
    };
    walk('');
    return out.sort();
  }

  /** 真正的 repo 裡會被人照抄的文字檔。 */
  function docFiles(): string[] {
    return scanFiles(realRepoRoot());
  }

  /**
   * 這個檔案自己是規則的來源:下面的反向控制要拿違規字串餵正規表達式,
   * 所以字串在原始碼裡**拼起來**,不寫成一整句。不是為了躲守門,是不開任何例外 ——
   * 一開例外,例外那個檔案就變成下一個 `vitest.mutate.config.ts`。
   */
  const STRYKER_RUN = ['stryker', 'run'].join(' ');
  const NPX_STRYKER_RUN = `npx ${STRYKER_RUN}`;

  it('沒有任何檔案教人用 npx / pnpm / yarn 直接叫 stryker', () => {
    // `npm run mutate` 之外的每一條路都繞過鎖 → 跟別的 worktree 互相 OOM。
    const bypass = /\b(?:npx|pnpm(?:\s+dlx)?|yarn|bunx)\s+(?:@stryker-mutator\/\S+|stryker)\b/;
    const hits: string[] = [];
    for (const f of docFiles()) {
      const text = readFileSync(join(realRepoRoot(), f), 'utf8');
      text.split('\n').forEach((line, i) => {
        if (bypass.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits, `這些地方會讓下一輪審核繞過鎖:\n${hits.join('\n')}`).toEqual([]);
  });

  it('沒有任何檔案寫著可以照抄的 Stryker CLI 子指令', () => {
    // 連在說明文字裡都不要出現——下一輪的人 grep 到會以為還沒改完,
    // 或更糟:直接照抄。要提到那條路就寫「Stryker CLI」。
    const hits: string[] = [];
    for (const f of docFiles()) {
      const text = readFileSync(join(realRepoRoot(), f), 'utf8');
      text.split('\n').forEach((line, i) => {
        if (/\bstryker\s+run\b/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits, `還有可以照抄的 Stryker CLI 子指令:\n${hits.join('\n')}`).toEqual([]);
  });

  it('這個掃描器不是空掃(掃到 0 個檔案就該紅,不是看起來很乾淨)', () => {
    // P-28 的教訓:找到 0 條目的掃描器會長得跟「全部通過」一模一樣。
    const files = docFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('.claude/skills/mutation-testing/SKILL.md');
  });

  it('掃描範圍蓋到程式碼:那個躲過守門的活例子現在在範圍內', () => {
    // 2026-09-05 漏掉的就是這兩個 .ts。它們不在範圍裡,這條守門就只守了一半。
    const files = docFiles();
    expect(files).toContain('vitest.mutate.config.ts');
    expect(files).toContain('scripts/mutate.ts');
    expect(files).toContain('package.json');
    // 掃描器自己也在範圍內——它沒有例外,所以上面兩條測試對它也成立。
    expect(files).toContain('scripts/mutate.test.ts');
  });

  it('掃描範圍是白名單:文字檔全收,二進位與跳過目錄不收', () => {
    // 在臨時目錄造一棵小樹,直接驗 scanFiles 的取捨,不靠真 repo 剛好長什麼樣。
    const root = tmp('mutate-scan-exts');
    const touch = (rel: string) => {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), '', 'utf8');
    };
    const wanted = [
      'README.md', 'notes.txt', 'config.json', 'data.jsonl', 'ci.yaml', 'ci.yml', 'Cargo.toml',
      '.env.example', 'run.sh', 'tool.py', 'a.ts', 'b.mts', 'c.js', 'd.mjs', 'e.svelte', 'f.rs',
      'index.html', 'style.css', 'phase-1.feature', 'deep/nested/dir/x.ts', 'Dockerfile.template',
      // 只是**名字**叫 worktrees 的普通目錄,不是簽出:照掃。
      'worktrees/plain.md',
    ];
    const unwanted = [
      'icon.png', 'icon.ico', 'icon.icns', 'package-lock.lock', '.gitkeep', '.gitignore',
      'node_modules/pkg/index.ts', '.git/HEAD.md', '.stryker-tmp/sandbox/a.ts', 'dist/out.js',
      'target/debug/x.rs', 'reports/r.md', 'coverage/lcov.txt',
      // 巢狀簽出:worktree(.git 是檔案)與一般 repo(.git 是目錄)都跳過,不看目錄叫什麼。
      'worktrees/other/a.md', 'some-other-name/README.md',
    ];
    for (const f of [...wanted, ...unwanted]) touch(f);
    touch('worktrees/other/.git');
    touch('some-other-name/.git/HEAD');
    const found = scanFiles(root);
    for (const f of wanted) expect(found, `應該掃到 ${f}`).toContain(f);
    for (const f of unwanted) expect(found, `不該掃到 ${f}`).not.toContain(f);
    // 副檔名大小寫無關:Windows 來的檔案常常是 .MD / .JSON。
    touch('SHOUT.MD');
    expect(scanFiles(root)).toContain('SHOUT.MD');
  });

  it('掃描器真的抓得到(拿一個假的違規行餵它)', () => {
    // 反向控制:規則本身要能認得出違規,不然上面幾條永遠是綠的。
    const bypass = /\b(?:npx|pnpm(?:\s+dlx)?|yarn|bunx)\s+(?:@stryker-mutator\/\S+|stryker)\b/;
    expect(bypass.test(`跑 \`${NPX_STRYKER_RUN} stryker.config.json\``)).toBe(true);
    expect(bypass.test(`跑 \`pnpm dlx ${STRYKER_RUN}\``)).toBe(true);
    expect(bypass.test('跑 `npm run mutate -- stryker.config.json`')).toBe(false);
    expect(/\bstryker\s+run\b/.test(NPX_STRYKER_RUN)).toBe(true);
    expect(/\bstryker\s+run\b/.test('npm run mutate')).toBe(false);
  });

  it('反向控制用的違規字串跟寫死的一樣(拼接不是在改規則)', () => {
    // 字串拼起來是為了讓這個檔案自己過得了掃描;拼錯了反向控制就測到別的東西。
    expect(STRYKER_RUN).toBe('stryker' + ' ' + 'run');
    expect(NPX_STRYKER_RUN).toBe('npx ' + STRYKER_RUN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. 審核輪補的:剩下那批存活變異裡「真的會咬人」的
//
// 判定原則:訊息的**整句**不釘(改一個字就紅,那是壞測試),但
//   (a) 給人看的理由不能是空字串、
//   (b) 訊息裡的**單位換算**(秒 / 分 / 小時)算錯會直接誤導判斷、
//   (c) parseLock 的守衛拿掉會**丟例外**而不是回 null,
// 這三類是真的漏測,補。
// ─────────────────────────────────────────────────────────────────────────────

describe('parseLock 的守衛拿掉會爆,不是回 null', () => {
  it('內容是 JSON 的 null 時回 null,不能丟 TypeError', () => {
    // `typeof null === 'object'`,少了 `value === null` 那一段就會去解構 null → TypeError。
    // 那個例外會從 classifyLock 一路炸到 acquireLock,鎖也留在原地。
    expect(() => parseLock('null')).not.toThrow();
    expect(parseLock('null')).toBeNull();
  });

  it('內容是陣列時回 null', () => {
    expect(parseLock('[]')).toBeNull();
    expect(parseLock('[{"pid":1,"startedAt":"2026-01-01T00:00:00Z","cwd":"/x"}]')).toBeNull();
  });

  it('內容是純量時回 null', () => {
    for (const raw of ['1', '"x"', 'true']) expect(parseLock(raw), raw).toBeNull();
  });

  it('startedAt 是字串但解不出時間時回 null', () => {
    // 型別對還不夠:'not-a-date' 會讓 Date.parse 回 NaN,年齡算出來是 NaN,
    // `NaN > staleAfterMs` 永遠是 false → 那把鎖永遠不會過期,擋滿 90 分鐘。
    const raw = JSON.stringify({ pid: 1, startedAt: 'not-a-date', cwd: '/x' });
    expect(parseLock(raw)).toBeNull();
  });
});

describe('給人看的理由不能是空的', () => {
  // 一定要用 thunk:直接在 describe 裡呼叫 classifyLock 會在**模組載入時**跑,
  // Stryker 會把碰到的變異全部記成 static,一輪從 4 分鐘變 10 分鐘以上。
  const cases: Array<[string, () => LockVerdict]> = [
    ['活鎖', () => classifyLock(read(JSON.stringify(info())), { now: T0, isAlive: () => true })],
    ['pid 不在', () => classifyLock(read(JSON.stringify(info())), { now: T0, isAlive: () => false })],
    ['超時', () => classifyLock(read(JSON.stringify(info())), { now: T0 + STALE_AFTER_MS + 1, isAlive: () => true })],
    ['壞檔還在寬限期', () => classifyLock(read('not json', T0), { now: T0, isAlive: () => true })],
    [
      '壞檔超過寬限期',
      () => classifyLock(read('not json', T0), { now: T0 + CORRUPT_GRACE_MS + 1, isAlive: () => true }),
    ],
  ];

  it.each(cases)('%s 的 why 是有內容的一句話', (_name, make) => {
    // 空字串會讓「清掉殘留的 Stryker 鎖:」後面什麼都沒有,人看不出為什麼被清掉。
    const verdict = make();
    expect(verdict.why.trim().length).toBeGreaterThan(0);
    expect(verdict.why).not.toContain('undefined');
    expect(verdict.why).not.toContain('NaN');
  });
});

describe('訊息裡的單位換算', () => {
  it('壞檔超過寬限期時,講的是「秒」而且數字對', () => {
    const v = classifyLock(read('x', T0), { now: T0 + 60_000, corruptGraceMs: 10_000, isAlive: () => true });
    expect(v.kind).toBe('stale');
    // 乘除寫反會印成「10000 秒」,人會以為寬限期有三小時。
    expect(v.why).toContain('10 秒');
  });

  it('超時的鎖講的是「小時」而且數字對', () => {
    const v = classifyLock(read(JSON.stringify(info())), {
      now: T0 + STALE_AFTER_MS + 1,
      staleAfterMs: STALE_AFTER_MS,
      isAlive: () => true,
    });
    expect(v.kind).toBe('stale');
    expect(v.why).toContain('2 小時');
  });

  it('等鎖放棄時講的是「分鐘」而且數字對', async () => {
    const dir = tmp('mutate-lock-units');
    const lockPath = join(dir, '.stryker.lock');
    tryAcquire(lockPath, info({ pid: process.pid }));
    const clock = fakeClock();
    const err = await acquireLock(lockPath, {
      info: info({ pid: 999 }),
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
      isAlive: () => true,
      retryMs: 60_000,
      maxWaitMs: 90 * 60_000,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LockTimeoutError);
    // name 沒設好的話,catch 端的 `err.name === 'LockTimeoutError'` 判斷會失效。
    expect((err as Error).name).toBe('LockTimeoutError');
    expect((err as Error).message).toContain('90 分鐘');
    expect((err as Error).message).toContain(lockPath);
  });

  it('等待訊息裡的秒數是真的秒數,不是毫秒', () => {
    // `waitedMs * 1000` 會印成「已等 45000000 秒」——人會以為卡了一年。
    expect(waitingMessage(info({ pid: 7, cwd: '/w' }), 45_000)).toContain('已等 45 秒');
    expect(waitingMessage(info({ pid: 7, cwd: '/w' }), 0)).toContain('已等 0 秒');
  });

  it('讀不出持有者時,兩個備用字樣都要在(空字串等於沒訊息)', () => {
    const msg = waitingMessage(null, 0);
    expect(msg).toContain('另一個 worktree');
    // 第二行的判斷也有「讀不出」三個字,所以要釘 pid 那一格本身,不然它變空字串抓不到。
    expect(msg).toContain('pid 讀不出');
  });
});

describe('acquireLock 預設的 sleep 是真的在睡', () => {
  it('等 60 毫秒、每次重試 20 毫秒,印出來的等待訊息只有個位數行', async () => {
    // 預設 sleep 被換成 no-op 的話,這個迴圈會空轉幾千圈、印幾千行。
    const dir = tmp('mutate-lock-realsleep');
    const lockPath = join(dir, '.stryker.lock');
    // startedAt 同上:真時鐘 + 寫死的 T0 = 過了兩小時就變殘鎖,等不到逾時。
    tryAcquire(lockPath, info({ pid: process.pid, cwd: '/holder', startedAt: new Date().toISOString() }));

    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    try {
      await expect(acquireLock(lockPath, { retryMs: 20, maxWaitMs: 60 })).rejects.toBeInstanceOf(LockTimeoutError);
    } finally {
      spy.mockRestore();
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length, `印了 ${lines.length} 行,預設的 sleep 大概沒在睡`).toBeLessThan(10);
  });
});

describe('installCleanup 的 target 沒有 off 也不能爆', () => {
  it('拆 handler 時 target 沒有 off,uninstall 要安靜地什麼都不做', () => {
    // `off` 在 SignalTarget 介面裡是 optional。`?.` 拿掉的話,
    // 任何沒有 off 的 target(測試用的假的、或縮小過的介面)一 uninstall 就 TypeError。
    const events: string[] = [];
    const target = {
      on(e: string) {
        events.push(e);
        return this;
      },
      exit: (() => undefined) as unknown as (code?: number) => never,
    };
    const uninstall = installCleanup(() => {}, target as unknown as SignalTarget);
    expect(events).toEqual(['SIGINT', 'SIGTERM', 'exit']);
    expect(() => uninstall()).not.toThrow();
  });
});

describe('清殘鎖時要印出理由', () => {
  it('清掉殘鎖那一行要說清楚為什麼(空訊息等於沒交代)', async () => {
    const dir = tmp('mutate-lock-whylog');
    const lockPath = join(dir, '.stryker.lock');
    tryAcquire(lockPath, info({ pid: DEAD_PID }));

    const logs: string[] = [];
    const held = await acquireLock(lockPath, {
      info: info({ pid: process.pid, cwd: dir }),
      now: () => T0,
      sleep: async () => {},
      log: (m) => logs.push(m),
      isAlive: () => false,
    });

    expect(held.info.pid).toBe(process.pid);
    expect(logs).toHaveLength(1);
    // 鎖是共用的:不能叫「Stryker 鎖」(看的人會去找一個不存在的 Stryker),要講鎖檔名。
    expect(logs[0]).toContain('清掉殘留的鎖 .stryker.lock');
    expect(logs[0]).not.toContain('Stryker 鎖');
    // 冒號後面必須有東西——那就是 verdict.why。
    const why = logs[0]!.split('.stryker.lock:')[1] ?? '';
    expect(why.trim().length).toBeGreaterThan(0);
    expect(why).toContain(String(DEAD_PID));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. 等待訊息要分得出「自己排的鏈」與「別人」;鎖檔多一欄 task
//
// 2026-09-05 踩到的:five-zero-guards 的審核 agent 看到「鎖被佔著」,把**自己持有的鎖**
// (同一個 worktree 裡前一個指令還沒放)讀成別的 worktree 佔的,差點手動刪 .stryker.lock——
// 那會直接回到互相 OOM(之前燒掉過約 $25 和兩小時)。只印 cwd 讓 agent 自己比對已經證明
// 不夠(它就是沒比對出來),所以由程式判、訊息直接寫成人話,兩種文案都要有測試蓋到。
//
// 這把鎖現在也給全套 vitest 用(scripts/run-tests.ts),鎖檔多一欄 task 記持鎖者在跑什麼,
// 等鎖的人才講得出「對面是 Stryker」還是「對面是全套」。舊格式的鎖沒有這欄,照樣要能解。
// ─────────────────────────────────────────────────────────────────────────────

import { sameWorktree, type LockTask } from './mutate.js';

describe('parseLock 的 task 欄', () => {
  it('task 是 "stryker" / "test" 時保留', () => {
    for (const task of ['stryker', 'test'] as LockTask[]) {
      const parsed = parseLock(JSON.stringify(info({ task })));
      expect(parsed?.task).toBe(task);
    }
  });

  it('舊格式(沒有 task 欄)照樣解得出來,task 是 undefined——不是壞檔', () => {
    // 判成壞檔 = 10 秒寬限期一過就被當殘鎖刪掉 = 刪掉一把活的、別人正在用的鎖。
    const parsed = parseLock(JSON.stringify({ pid: 1, startedAt: new Date(T0).toISOString(), cwd: '/w' }));
    expect(parsed).not.toBeNull();
    expect(parsed?.task).toBeUndefined();
  });

  it('task 是認不得的字串時,丟掉那一欄但鎖照樣算合法(不因為一個標籤刪別人的鎖)', () => {
    const parsed = parseLock(JSON.stringify({ ...info(), task: 'coverage' }));
    expect(parsed).not.toBeNull();
    expect(parsed?.pid).toBe(4242);
    expect(parsed?.task).toBeUndefined();
  });

  it('task 不是字串(數字 / 物件)時同上:丟掉那一欄,鎖照樣合法', () => {
    expect(parseLock(JSON.stringify({ ...info(), task: 7 }))?.pid).toBe(4242);
    expect(parseLock(JSON.stringify({ ...info(), task: {} }))?.pid).toBe(4242);
    expect(parseLock(JSON.stringify({ ...info(), task: 7 }))?.task).toBeUndefined();
  });
});

describe('selfLockInfo 的 task', () => {
  it('給了 task 就寫進去', () => {
    expect(selfLockInfo('/w', new Date(T0).toISOString(), 'test').task).toBe('test');
    expect(selfLockInfo('/w', new Date(T0).toISOString(), 'stryker').task).toBe('stryker');
  });

  it('不給 task 時物件裡**沒有**那個 key(不是 task: undefined——JSON 化之後要跟舊格式一樣)', () => {
    const self = selfLockInfo('/w', new Date(T0).toISOString());
    expect('task' in self).toBe(false);
  });
});

describe('sameWorktree', () => {
  it('同一個 worktree 的根與子目錄 → 同一個', () => {
    const { wtA } = gitRepoWithWorktrees();
    const sub = join(wtA, 'packages', 'core');
    mkdirSync(sub, { recursive: true });
    expect(sameWorktree(wtA, sub)).toBe(true);
    expect(sameWorktree(sub, wtA)).toBe(true);
    expect(sameWorktree(wtA, wtA)).toBe(true);
  });

  it('兩個不同的 worktree → 不同(就算掛在同一個主 repo 底下)', () => {
    // 這條是關鍵:strykerLockPath 對兩個 worktree 算出**同一把鎖**,但「同一把鎖」不等於
    // 「同一個 worktree」。用 --git-common-dir 判會把所有 worktree 都判成自己的。
    const { wtA, wtB } = gitRepoWithWorktrees();
    expect(sameWorktree(wtA, wtB)).toBe(false);
  });

  it('worktree 與主 repo → 不同', () => {
    const { main, wtA } = gitRepoWithWorktrees();
    expect(sameWorktree(main, wtA)).toBe(false);
  });

  it('不是 git 目錄:路徑相同才算同一個', () => {
    const d = tmp('mutate-samewt-nogit');
    mkdirSync(join(d, 'x'), { recursive: true });
    expect(sameWorktree(d, d)).toBe(true);
    expect(sameWorktree(d, join(d, 'x'))).toBe(false);
  });

  it('持鎖者的路徑已經不存在(worktree 被 remove 掉了)→ 當別人的,而且**不丟例外**', () => {
    // 等鎖的人不能因為對面的 worktree 沒了就爆掉;不確定就往「別人的、不要刪」保守。
    const { wtA } = gitRepoWithWorktrees();
    expect(() => sameWorktree('/this/path/does/not/exist', wtA)).not.toThrow();
    expect(sameWorktree('/this/path/does/not/exist', wtA)).toBe(false);
    expect(sameWorktree(wtA, '/this/path/does/not/exist')).toBe(false);
  });
});

describe('waitingMessage:自己的鏈 vs 別人的', () => {
  const same = () => true;
  const other = () => false;
  const holder = info({ pid: 2636796, cwd: '/home/x/five-zero-guards', task: 'stryker' });

  it('第一行是事實:鎖檔名、持鎖者 pid、cwd', () => {
    const m = waitingMessage(holder, 6 * 60_000, { selfCwd: '/home/x/five-zero-guards', sameWorktree: same });
    expect(m).toContain('等待 .stryker.lock');
    expect(m).toContain('pid 2636796');
    expect(m).toContain('cwd=/home/x/five-zero-guards');
  });

  it('同一個 worktree → 「這是你自己排的鏈」,而且不能出現「別的 worktree」', () => {
    const m = waitingMessage(holder, 6 * 60_000, { selfCwd: '/home/x/five-zero-guards/packages', sameWorktree: same });
    expect(m).toContain('這是你自己排的鏈');
    expect(m).toContain('同一個 worktree');
    expect(m).toContain('繼續等');
    // 兩種文案互斥:同時出現兩句,agent 又要自己猜。
    expect(m).not.toContain('別的 worktree');
  });

  it('不同 worktree → 「這是別的 worktree 佔的」+ 不要刪鎖、不要 kill,而且不能出現「自己」', () => {
    const m = waitingMessage(holder, 6 * 60_000, { selfCwd: '/home/x/other-wt', sameWorktree: other });
    expect(m).toContain('這是別的 worktree 佔的');
    expect(m).toContain('不要刪鎖');
    expect(m).toContain('不要 kill');
    expect(m).not.toContain('自己');
  });

  it('逾時與已等的時間都在,單位是分鐘(≥ 60 秒)', () => {
    const m = waitingMessage(holder, 6 * 60_000 + 30_000, { selfCwd: '/x', sameWorktree: other });
    expect(m).toContain('逾時 90 分鐘');
    expect(m).toContain('已等 6 分鐘');
  });

  it('不到一分鐘講秒,剛好一分鐘講分鐘', () => {
    expect(waitingMessage(holder, 59_000, { selfCwd: '/x', sameWorktree: other })).toContain('已等 59 秒');
    expect(waitingMessage(holder, 60_000, { selfCwd: '/x', sameWorktree: other })).toContain('已等 1 分鐘');
  });

  it('maxWaitMs 可以調,印出來的逾時跟著變', () => {
    const m = waitingMessage(holder, 0, { selfCwd: '/x', sameWorktree: other, maxWaitMs: 5 * 60_000 });
    expect(m).toContain('逾時 5 分鐘');
  });

  it('持鎖者在跑什麼要講出來:Stryker / 全套測試', () => {
    const s = waitingMessage(info({ task: 'stryker' }), 0, { selfCwd: '/x', sameWorktree: other });
    const t = waitingMessage(info({ task: 'test' }), 0, { selfCwd: '/x', sameWorktree: other });
    expect(s).toContain('Stryker');
    expect(s).not.toContain('全套');
    expect(t).toContain('全套');
  });

  it('舊格式的鎖(沒有 task)不能印 undefined,也不能亂猜——講「Stryker 或全套測試」', () => {
    const m = waitingMessage(info(), 0, { selfCwd: '/x', sameWorktree: other });
    expect(m).not.toContain('undefined');
    expect(m).toContain('Stryker');
    expect(m).toContain('全套');
  });

  it('讀不出持有者(剛建鎖還沒寫完)→ 分不出是誰的,一樣寫「不要刪鎖」', () => {
    const m = waitingMessage(null, 0, { selfCwd: '/x', sameWorktree: same });
    expect(m).toContain('不要刪鎖');
    expect(m).not.toContain('undefined');
    // 分不出來就不能說是自己的——說是自己的,agent 會覺得可以動它。
    expect(m).not.toContain('自己排的鏈');
  });

  it('不給 sameWorktree 時用真的 sameWorktree 判:同一個 git worktree 的根與子目錄 → 自己的鏈', () => {
    const { wtA, wtB } = gitRepoWithWorktrees();
    const sub = join(wtA, 'packages');
    mkdirSync(sub, { recursive: true });
    expect(waitingMessage(info({ cwd: sub }), 0, { selfCwd: wtA })).toContain('自己排的鏈');
    expect(waitingMessage(info({ cwd: wtB }), 0, { selfCwd: wtA })).toContain('別的 worktree');
  });

  it('不給 selfCwd 時用 process.cwd():持鎖者寫的就是這個 cwd → 自己的鏈', () => {
    expect(waitingMessage(info({ cwd: process.cwd() }), 0)).toContain('自己排的鏈');
  });
});

describe('acquireLock 印的等待訊息帶著「自己 / 別人」的判斷', () => {
  it('持鎖者跟我在同一個 worktree → 每一行都說這是自己排的鏈', async () => {
    const { wtA } = gitRepoWithWorktrees();
    const p = join(wtA, '.stryker.lock');
    const holderCwd = join(wtA, 'packages');
    mkdirSync(holderCwd, { recursive: true });
    tryAcquire(p, info({ pid: 4242, cwd: holderCwd, task: 'stryker' }));
    const logs: string[] = [];
    const clock = fakeClock((n) => {
      if (n === 2) rmSync(p);
    });
    await acquireLock(p, {
      info: info({ pid: 555, cwd: wtA, task: 'test' }),
      now: clock.now,
      sleep: clock.sleep,
      log: (m) => logs.push(m),
      isAlive: () => true,
    });
    expect(logs).toHaveLength(2);
    for (const line of logs) {
      expect(line).toContain('自己排的鏈');
      expect(line).not.toContain('別的 worktree');
    }
  });

  it('持鎖者在別的 worktree → 每一行都說不要刪鎖、不要 kill', async () => {
    const { wtA, wtB } = gitRepoWithWorktrees();
    const p = join(wtA, '.stryker.lock');
    tryAcquire(p, info({ pid: 4242, cwd: wtB, task: 'test' }));
    const logs: string[] = [];
    const clock = fakeClock((n) => {
      if (n === 2) rmSync(p);
    });
    await acquireLock(p, {
      info: info({ pid: 555, cwd: wtA, task: 'stryker' }),
      now: clock.now,
      sleep: clock.sleep,
      log: (m) => logs.push(m),
      isAlive: () => true,
    });
    expect(logs).toHaveLength(2);
    for (const line of logs) {
      expect(line).toContain('別的 worktree');
      expect(line).toContain('不要刪鎖');
      expect(line).toContain('不要 kill');
      expect(line).toContain('4242');
    }
  });

  it('已等的時間跟逾時一起印,而且每次重試都在變', async () => {
    const dir = tmp('mutate-wait-msg-progress');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: 4242, cwd: '/other/worktree', task: 'stryker' }));
    const logs: string[] = [];
    const clock = fakeClock((n) => {
      if (n === 5) rmSync(p);
    });
    await acquireLock(p, {
      info: info({ pid: 555, cwd: dir }),
      now: clock.now,
      sleep: clock.sleep,
      log: (m) => logs.push(m),
      isAlive: () => true,
    });
    expect(logs).toHaveLength(5);
    expect(logs[0]).toContain('已等 0 秒');
    expect(logs[3]).toContain('已等 45 秒');
    expect(logs[4]).toContain('已等 1 分鐘');
    for (const line of logs) expect(line).toContain('逾時 90 分鐘');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 審核輪(2026-09-05)補的:鎖已經是 Stryker 與全套測試共用的,逾時訊息不能再講「Stryker 的鎖」;
// acquireLock 的 sameWorktree 記憶化是有行為可測的(問幾次),不是純效能。
// ─────────────────────────────────────────────────────────────────────────────

describe('LockTimeoutError 的訊息:講鎖檔名與持鎖者在跑什麼,不講「Stryker 的鎖」', () => {
  /** 等到逾時,回那個 error。holder 由呼叫端寫好。 */
  async function timeoutAgainst(lockPath: string): Promise<LockTimeoutError> {
    const clock = fakeClock();
    const err = await acquireLock(lockPath, {
      info: info({ pid: 555, cwd: '/me', task: 'test' }),
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
      isAlive: () => true,
      retryMs: 60_000,
      maxWaitMs: 3 * 60_000,
      staleAfterMs: Number.POSITIVE_INFINITY,
      corruptGraceMs: Number.POSITIVE_INFINITY,
      sameWorktree: () => false,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    return err as LockTimeoutError;
  }

  it('持鎖者在跑全套測試 → 訊息說「全套測試」、帶 pid 與 cwd,而且沒有「Stryker 的鎖」', async () => {
    const dir = tmp('mutate-timeout-msg-test');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: 4242, cwd: '/busy/worktree', task: 'test' }));
    const err = await timeoutAgainst(p);
    expect(err.message).toContain('.stryker.lock');
    expect(err.message).toContain('3 分鐘');
    expect(err.message).toContain('持鎖者 pid 4242 在跑 全套測試');
    expect(err.message).toContain('cwd=/busy/worktree');
    expect(err.message).toContain(p);
    expect(err.message).not.toContain('Stryker 的鎖');
    expect(err.message).not.toContain('undefined');
  });

  it('持鎖者在跑 Stryker → 訊息說「Stryker」(講的是它在跑什麼,不是鎖叫什麼)', async () => {
    const dir = tmp('mutate-timeout-msg-stryker');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: 4243, cwd: '/busy/worktree', task: 'stryker' }));
    const err = await timeoutAgainst(p);
    expect(err.message).toContain('持鎖者 pid 4243 在跑 Stryker(');
    expect(err.message).not.toContain('Stryker 的鎖');
  });

  it('舊格式的鎖(沒有 task)→ 「Stryker 或全套測試」,不猜', async () => {
    const dir = tmp('mutate-timeout-msg-old');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: 4244, cwd: '/busy/worktree' }));
    const err = await timeoutAgainst(p);
    expect(err.message).toContain('在跑 Stryker 或全套測試');
  });

  it('壞檔還在寬限期(持鎖者讀不出)→ 說「持鎖者讀不出」,不印 undefined', async () => {
    const dir = tmp('mutate-timeout-msg-corrupt');
    const p = join(dir, '.stryker.lock');
    writeFileSync(p, '{not json', 'utf8');
    const err = await timeoutAgainst(p);
    expect(err.holder).toBeNull();
    expect(err.message).toContain('持鎖者讀不出');
    expect(err.message).toContain('.stryker.lock');
    expect(err.message).not.toContain('undefined');
    expect(err.message).not.toContain('null');
  });
});

describe('acquireLock 對 sameWorktree 的記憶化:同一組路徑只問一次', () => {
  /** 一個會數次數、記參數的 sameWorktree。 */
  function counting(answer: boolean) {
    const calls: [string, string][] = [];
    return { calls, fn: (a: string, b: string) => (calls.push([a, b]), answer) };
  }

  it('等滿 90 分鐘(360 次重試)只問 1 次,而且每一行的判斷都來自注入的那個', async () => {
    const dir = tmp('mutate-memo-360');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: 4242, cwd: '/holder', task: 'stryker' }));
    const clock = fakeClock();
    const same = counting(true);
    const logs: string[] = [];
    const err = await acquireLock(p, {
      info: info({ pid: 555, cwd: '/me', task: 'test' }),
      now: clock.now,
      sleep: clock.sleep,
      log: (m) => logs.push(m),
      isAlive: () => true,
      staleAfterMs: Number.POSITIVE_INFINITY,
      sameWorktree: same.fn,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect(clock.sleeps).toHaveLength(MAX_WAIT_MS / RETRY_INTERVAL_MS);
    expect(logs).toHaveLength(MAX_WAIT_MS / RETRY_INTERVAL_MS);
    // 這條就是「記憶化是行為,不是純效能」:360 行訊息,只准問 1 次。
    expect(same.calls).toEqual([['/me', '/holder']]);
    // '/me' 跟 '/holder' 真問 git 是「別人的」;每一行都說「自己的」= 判斷真的來自注入的函式。
    for (const line of logs) expect(line).toContain('自己排的鏈');
  });

  it('注入的說「別人的」→ 每一行都說別的 worktree(對照組,證明不是寫死的)', async () => {
    const dir = tmp('mutate-memo-other');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: 4242, cwd: '/holder', task: 'test' }));
    const same = counting(false);
    const logs: string[] = [];
    const clock = fakeClock((n) => {
      if (n === 3) rmSync(p);
    });
    await acquireLock(p, {
      info: info({ pid: 555, cwd: '/me', task: 'test' }),
      now: clock.now,
      sleep: clock.sleep,
      log: (m) => logs.push(m),
      isAlive: () => true,
      sameWorktree: same.fn,
    });
    expect(logs).toHaveLength(3);
    for (const line of logs) expect(line).toContain('別的 worktree');
    expect(same.calls).toHaveLength(1);
  });

  it('持鎖者中途換人(另一個 worktree 搶到)→ 新的一組要再問一次,兩組各問一次', async () => {
    const dir = tmp('mutate-memo-switch');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: 4242, cwd: '/holder-1', task: 'stryker' }));
    const same = counting(false);
    const logs: string[] = [];
    const clock = fakeClock((n) => {
      // 第 2 次睡完:第一個放掉、第二個(別的 cwd)立刻搶到;第 4 次睡完:第二個也放掉。
      if (n === 2) {
        rmSync(p);
        tryAcquire(p, info({ pid: 4343, cwd: '/holder-2', task: 'test' }));
      }
      if (n === 4) rmSync(p);
    });
    await acquireLock(p, {
      info: info({ pid: 555, cwd: '/me', task: 'test' }),
      now: clock.now,
      sleep: clock.sleep,
      log: (m) => logs.push(m),
      isAlive: () => true,
      sameWorktree: same.fn,
    });
    expect(logs).toHaveLength(4);
    expect(logs[0]).toContain('4242');
    expect(logs[3]).toContain('4343');
    // key 只看其中一邊(例如只看 selfCwd)的話,第二個持鎖者會拿到第一個的答案,而且這裡只會問 1 次。
    expect(same.calls).toEqual([
      ['/me', '/holder-1'],
      ['/me', '/holder-2'],
    ]);
  });

  it('持鎖者的 cwd 只差一個結尾斜線也算不同的一組,要再問(key 不能把路徑正規化掉)', async () => {
    // sameWorktree 自己會 resolve;記憶化那層不該替它做判斷,原樣當 key。
    const dir = tmp('mutate-memo-key');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: 1, cwd: '/y/z', task: 'stryker' }));
    const same = counting(true);
    const clock = fakeClock((n) => {
      if (n === 1) {
        rmSync(p);
        tryAcquire(p, info({ pid: 2, cwd: '/y/z/', task: 'stryker' }));
      }
      if (n === 2) rmSync(p);
    });
    await acquireLock(p, {
      info: info({ pid: 555, cwd: '/x', task: 'test' }),
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
      isAlive: () => true,
      sameWorktree: same.fn,
    });
    expect(same.calls).toEqual([
      ['/x', '/y/z'],
      ['/x', '/y/z/'],
    ]);
  });

  it('不注入時走真的 sameWorktree:同一個 git worktree 的持鎖者是自己的鏈(記憶化沒有把預設吃掉)', async () => {
    const { wtA } = gitRepoWithWorktrees();
    const p = join(wtA, '.stryker.lock');
    // 自己在子目錄、持鎖者在根:路徑不同,只有真的問 git 才知道是同一個 worktree。
    const me = join(wtA, 'scripts');
    mkdirSync(me, { recursive: true });
    tryAcquire(p, info({ pid: 4242, cwd: wtA, task: 'stryker' }));
    const logs: string[] = [];
    const clock = fakeClock((n) => {
      if (n === 1) rmSync(p);
    });
    await acquireLock(p, {
      info: info({ pid: 555, cwd: me, task: 'test' }),
      now: clock.now,
      sleep: clock.sleep,
      log: (m) => logs.push(m),
      isAlive: () => true,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('自己排的鏈');
  });
});

describe('審核輪(2026-09-05)補殺的變異:守衛與資源', () => {
  it('parseLock:startedAt 是陣列(["2026-…"])也回 null——Date.parse 會把單元素陣列轉成字串再解,typeof 守衛不是多餘的', () => {
    expect(parseLock(JSON.stringify({ pid: 1, startedAt: [new Date(T0).toISOString()], cwd: '/x' }))).toBeNull();
    expect(parseLock(JSON.stringify({ pid: 1, startedAt: T0, cwd: '/x' }))).toBeNull();
  });

  it('tryAcquire 不漏 fd:拿 200 次鎖(含 200 次 EEXIST),/proc/self/fd 的數量不變', () => {
    // P-29 說「要撞 EMFILE 才看得到,不值得」。不用撞:Linux 上 /proc/self/fd 直接數得到。
    const dir = tmp('mutate-fd-leak');
    const p = join(dir, '.stryker.lock');
    const fds = () => readdirSync('/proc/self/fd').length;
    const before = fds();
    for (let i = 0; i < 200; i += 1) {
      expect(tryAcquire(p, info({ pid: i + 1 }))).toBe(true);
      expect(tryAcquire(p, info({ pid: i + 1 }))).toBe(false);
      expect(releaseLock(p, i + 1)).toBe(true);
    }
    expect(fds()).toBe(before);
  });

  it('刪鎖時碰到 ENOENT 以外的錯(目錄不可寫 → EACCES)要往外丟,不能當成刪掉了', async () => {
    // 「以為刪了其實沒刪」= 留下一把殘鎖,下一個人白等到兩小時規則觸發。
    const dir = tmp('mutate-unlink-eacces');
    const p = join(dir, '.stryker.lock');
    tryAcquire(p, info({ pid: 777 }));
    chmodSync(dir, 0o555);
    try {
      expect(() => releaseLock(p, 777)).toThrow(/EACCES|EPERM/);
      // 殘鎖那條路也一樣:清不掉就要丟,不能靜靜地重試到逾時。
      await expect(
        acquireLock(p, { info: info({ pid: 999, cwd: dir }), now: () => T0, sleep: async () => {}, log: () => {}, isAlive: () => false }),
      ).rejects.toThrow(/EACCES|EPERM/);
    } finally {
      chmodSync(dir, 0o755);
    }
    expect(existsSync(p)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. 變異分數留檔(工單 2026-09-12,測試輪,預期全紅)
//
// 現況量測(2026-09-12,main = 634be7f):13 個 stryker*.json 沒有一個帶 json reporter,
// jsonReporter 全部未設定過——分數只印在畫面上,沒有一份機器可讀的檔案留下來(交接紀錄
// 寫「13 個只有 1 個留檔」是錯的,實際是 0 個,html 是人看的不是機器可讀的分數)。
//
// 這一節釘住 mutate.ts 這個唯一入口「必須」在組給 Stryker 的參數裡強制加上 json reporter
// 與明確的輸出路徑,無論被指到的那個 stryker*.json 自己怎麼寫;而且要驗到檔案真的落地、
// 內容算得出來的分數跟畫面印出來的一致——「加了旗標」是宣稱,「檔案存在」才是驗證。
//
// 手法沿用 §12(sandboxWithFakeStryker):複製 mutate.ts 原封不動、放一支假 stryker,
// 走的是真正的 spawnStryker 那條路,不真的跑一輪 Stryker。假 stryker 收到的 argv 也原樣
// 寫進 spawn-args.json,斷言直接看那個檔案——這是「實際 spawn 的參數」,不是猜的。
//
// 不改任何 stryker*.json:沙盒裡的設定檔是從 REPO_ROOT 原封不動複製過去的。
// ─────────────────────────────────────────────────────────────────────────────

/** 假 stryker 用的固定報告:2 killed / 1 survived → 66.666…% ,四捨五入印成 66.67%。 */
const FAKE_MUTATION_REPORT = {
  files: {
    'fake.ts': {
      language: 'typescript',
      mutants: [
        { id: '1', status: 'Killed' },
        { id: '2', status: 'Killed' },
        { id: '3', status: 'Survived' },
      ],
    },
  },
};
const FAKE_SCORE_STDOUT_LINE = 'Mutation score: 66.67%';

/** 從報告裡算分數,用的是跟「印出來的那行」同一份定義(killed + timeout 算過)。 */
function scoreFromMutationReport(report: typeof FAKE_MUTATION_REPORT): number {
  let killed = 0;
  let total = 0;
  for (const file of Object.values(report.files)) {
    for (const m of file.mutants) {
      total += 1;
      if (m.status === 'Killed' || m.status === 'Timeout') killed += 1;
    }
  }
  return total === 0 ? 0 : (killed / total) * 100;
}

type FakeStrykerBehavior = 'honors-config' | 'never-writes-report';

/**
 * 造一個「mutate.ts 複本 + 假 stryker」的沙盒,沿用 sandboxWithFakeStryker 的手法。
 * 差別是這次的假 stryker 是一支 node 腳本:讀自己收到的 argv,從尾端找第一個
 * 存在且解得開的 `.json`,當作「最終真的生效的設定」——不管那是原封不動的
 * `stryker.*.json`,還是 mutate.ts 合成出來的另一份。
 *
 * `behavior: 'never-writes-report'` 模擬「Stryker 宣稱成功,實際什麼都沒產出」
 * (這個 repo 最貴的一課:ok 不等於發生),不管設定內容一律不落地報告,只印分數。
 * 專門餵給下面的零輸入測試。
 */
function sandboxForReportArtifact(
  dir: string,
  configFileName: string,
  behavior: FakeStrykerBehavior = 'honors-config',
): { runner: string; argsFile: string } {
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  cpSync(MUTATE_MODULE, join(dir, 'scripts', 'mutate.ts'));
  // 原封不動複製真正的設定檔——這張工單不准改 stryker*.json,沙盒裡也不改一個字。
  cpSync(join(REPO_ROOT, configFileName), join(dir, configFileName));

  const argsFile = join(dir, 'spawn-args.json');
  const bin = join(dir, 'node_modules', '.bin', 'stryker');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const argv = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(argv));
let cfg = null;
for (let i = argv.length - 1; i >= 0; i--) {
  const a = argv[i];
  if (!a || a.startsWith('-') || !a.endsWith('.json')) continue;
  const p = path.isAbsolute(a) ? a : path.resolve(process.cwd(), a);
  if (!fs.existsSync(p)) continue;
  try {
    cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    break;
  } catch {}
}
const reporters = (cfg && cfg.reporters) || [];
const outFile = cfg && cfg.jsonReporter && cfg.jsonReporter.fileName;
const shouldWrite = ${behavior === 'honors-config' ? 'true' : 'false'} && reporters.includes('json') && !!outFile;
if (shouldWrite) {
  const abs = path.isAbsolute(outFile) ? outFile : path.resolve(process.cwd(), outFile);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, ${JSON.stringify(JSON.stringify(FAKE_MUTATION_REPORT))});
}
console.log(${JSON.stringify(FAKE_SCORE_STDOUT_LINE)});
process.exit(0);
`,
    'utf8',
  );
  chmodSync(bin, 0o755);

  const runner = join(dir, 'runner.mts');
  writeFileSync(
    runner,
    `import { runMutate } from ${JSON.stringify(join(dir, 'scripts', 'mutate.ts'))};
// 只給 lockPath:runStryker 走預設值,也就是真的 spawnStryker。
const code = await runMutate({ lockPath: process.argv[2], argv: ['node', 'x', '--', ${JSON.stringify(configFileName)}] });
console.log('EXITED ' + code);
process.exitCode = code;
`,
    'utf8',
  );
  return { runner, argsFile };
}

/**
 * 跑沙盒裡的 runner,回收 exit code 與合併過的 stdout+stderr。
 * 用 TSX_BIN(絕對路徑)直接叫,不是 `node --import tsx`:沙盒的 cwd 在 /tmp 底下,
 * bare specifier 會從 cwd 找 node_modules,找不到就整支炸掉(同檔 §「鎖的位置不看測試套件
 * 自己在哪裡跑」已經踩過這個坑)。
 */
function runReportSandbox(dir: string, runner: string): Promise<{ code: number | null; out: string }> {
  return new Promise((res) => {
    const lockPath = join(dir, '.stryker.lock');
    const child = spawn(TSX_BIN, [runner, lockPath], { cwd: dir });
    let out = '';
    child.stdout.on('data', (c) => (out += String(c)));
    child.stderr.on('data', (c) => (out += String(c)));
    child.on('close', (code) => res({ code, out }));
  });
}

const REPORT_CONFIG_FILE = 'stryker.zero-guards-llmspend.json';
const REPORT_NAME = 'zero-guards-llmspend';
const REPORT_OUTPUT_REL = join('reports', 'mutation', `${REPORT_NAME}.json`);

describe('變異分數留檔:mutate.ts 必須在唯一入口強制 json reporter 與明確輸出路徑', () => {
  it(
    '組給 Stryker 的參數裡,最終生效的設定要同時保留原本的 reporters 並加上 json(是加不是換),而且 jsonReporter.fileName 是明確路徑',
    async () => {
      const dir = tmp('mutate-report-args');
      const { runner, argsFile } = sandboxForReportArtifact(dir, REPORT_CONFIG_FILE);
      const { code, out } = await runReportSandbox(dir, runner);
      expect(code, `runner 沒有正常結束:${out}`).toBe(0);
      expect(existsSync(argsFile), `假 stryker 沒被叫起來,拿不到實際 spawn 的參數:${out}`).toBe(true);

      const args = JSON.parse(readFileSync(argsFile, 'utf8')) as string[];
      let resolved: { reporters?: string[]; jsonReporter?: { fileName?: string } } | null = null;
      for (let i = args.length - 1; i >= 0; i--) {
        const a = args[i]!;
        if (!a.endsWith('.json')) continue;
        const p = resolve(dir, a);
        if (!existsSync(p)) continue;
        resolved = JSON.parse(readFileSync(p, 'utf8'));
        break;
      }
      expect(resolved, `實際 spawn 的參數裡找不到解得開的設定檔:${JSON.stringify(args)}`).not.toBeNull();

      const original = JSON.parse(readFileSync(join(REPO_ROOT, REPORT_CONFIG_FILE), 'utf8')) as { reporters: string[] };
      const reporters = resolved?.reporters ?? [];
      for (const r of original.reporters) {
        expect(reporters, `合成後的 reporters 弄丟了原本就有的 ${r}(是加不是換):${JSON.stringify(reporters)}`).toContain(r);
      }
      expect(reporters, `合成後的 reporters 沒有加上 json:${JSON.stringify(reporters)}`).toContain('json');
      expect(resolved?.jsonReporter?.fileName, `沒有明確指定 jsonReporter.fileName,實際收到:${JSON.stringify(resolved)}`).toBe(
        REPORT_OUTPUT_REL,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '⚠️ 最重要的一條:跑完之後報告要真的落在 reports/mutation/<name>.json、parse 得動、且算出來的分數跟畫面印出來的一致(對不上要同時印兩個數字)',
    async () => {
      const dir = tmp('mutate-report-lands');
      const { runner } = sandboxForReportArtifact(dir, REPORT_CONFIG_FILE);
      const { code, out } = await runReportSandbox(dir, runner);
      expect(code, `runner 沒有成功結束:${out}`).toBe(0);

      const reportPath = join(dir, REPORT_OUTPUT_REL);
      expect(
        existsSync(reportPath),
        `報告沒有落在 ${REPORT_OUTPUT_REL}——加旗標是宣稱,檔案存在才是驗證。實際輸出:${out}`,
      ).toBe(true);

      const raw = readFileSync(reportPath, 'utf8');
      let parsed: typeof FAKE_MUTATION_REPORT | undefined;
      expect(() => {
        parsed = JSON.parse(raw);
      }, `報告檔案 parse 不動:${raw.slice(0, 200)}`).not.toThrow();

      const fileScore = scoreFromMutationReport(parsed!);
      const printedMatch = out.match(/Mutation score:\s*([\d.]+)%/);
      expect(printedMatch, `畫面上找不到分數:${out}`).not.toBeNull();
      const printedScore = Number(printedMatch![1]);

      expect(
        fileScore,
        `檔案裡算出來的分數(${fileScore.toFixed(2)})跟畫面印出來的分數(${printedScore})對不上`,
      ).toBeCloseTo(printedScore, 1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    'Stryker 沒有真的產出報告檔案時(旗標加了、退出碼還是 0),mutate.ts 不能安靜地當成功——退出碼要非 0,而且要點名是哪個檔案沒出現',
    async () => {
      const dir = tmp('mutate-report-missing');
      const { runner } = sandboxForReportArtifact(dir, REPORT_CONFIG_FILE, 'never-writes-report');
      const { code, out } = await runReportSandbox(dir, runner);

      expect(code, `Stryker 沒交出報告卻被當成功,退出碼:${code};實際輸出:${out}`).not.toBe(0);
      expect(out, `訊息沒有點名是哪個檔案沒出現(應該提到 ${REPORT_NAME}):${out}`).toContain(REPORT_NAME);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '輸出目錄建不起來時(reports 被同名的一般檔案佔住),mutate.ts 要講清楚壞在哪,不能靜靜當成功',
    async () => {
      const dir = tmp('mutate-report-blocked-dir');
      const { runner } = sandboxForReportArtifact(dir, REPORT_CONFIG_FILE);
      // 用一個同名的普通檔案擋住 reports/,mkdir -p reports/mutation 會撞 ENOTDIR。
      writeFileSync(join(dir, 'reports'), 'not a directory');

      const { code, out } = await runReportSandbox(dir, runner);

      expect(code, `輸出目錄建不起來卻被當成功:${out}`).not.toBe(0);
      expect(out.trim().length > 0, '目錄建不起來時什麼訊息都沒印,壞在哪都不知道').toBe(true);
    },
    SPAWN_TIMEOUT_MS,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. 變異分數留檔:同行程補測(審核輪 2026-09-12,ADR-049)
//
// 背景:上面 §15 的三條黑盒測試是真的子行程,Stryker 的覆蓋率插樁跨不過行程邊界,
// 量不到 `configPositionalIndex` / `reportBaseName` / `withReportEnforcement` 被執行到——
// 「量尺看不見」不等於「沒被測到」,但也不等於「已經測夠了」,所以在這裡補跟 §9 同形狀的
// 同行程測試(直接塞假的 `run`,不開子行程),讓 Stryker 也看得見。§15 那三條照工單要求留著,
// 兩者驗的不是同一件事(黑盒驗「真的走 spawnStryker 時整條路線串得起來」,這裡驗邏輯本身),
// 不重疊。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 讓 `withReportEnforcement` 讀到的 `process.cwd()` 變成 `dir`,跑完(含拋例外)一定還原。
 * 用 `vi.spyOn` 換回傳值,不真的 `process.chdir()`——Stryker 跑 vitest 是 worker_threads 池,
 * Node 的 worker thread 裡 `process.chdir()` 直接丟 `ERR_WORKER_UNSUPPORTED_OPERATION`。
 */
async function withCwd<T>(dir: string, fn: () => Promise<T> | T): Promise<T> {
  const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

describe('configPositionalIndex', () => {
  it('沒有任何參數時回 null', () => {
    expect(configPositionalIndex([])).toBeNull();
  });

  it('只有子指令、沒有位置參數時回 null(下一個是旗標)', () => {
    expect(configPositionalIndex(['run', '--concurrency'])).toBeNull();
  });

  it('緊接在子指令後面的是旗標(以 - 開頭)時回 null', () => {
    expect(configPositionalIndex(['run', '-c'])).toBeNull();
  });

  it('緊接在子指令後面不是旗標時回 1', () => {
    expect(configPositionalIndex(['run', 'stryker.zero-guards-due.json'])).toBe(1);
  });

  it('位置參數後面還有其他旗標,一樣認第 1 個位置', () => {
    expect(configPositionalIndex(['run', 'stryker.foo.json', '--concurrency', '2'])).toBe(1);
  });
});

describe('reportBaseName', () => {
  it('標準檔名去掉 stryker. 前綴與 .json 後綴', () => {
    expect(reportBaseName('stryker.zero-guards-due.json')).toBe('zero-guards-due');
  });

  it('預設設定檔算出來是 config', () => {
    expect(reportBaseName('stryker.config.json')).toBe('config');
  });

  it('沒有 stryker. 前綴時只去掉 .json 後綴', () => {
    expect(reportBaseName('foo.json')).toBe('foo');
  });

  it('帶路徑時只看檔名那一段(basename)', () => {
    expect(reportBaseName('some/dir/stryker.scanner-mutatelock.json')).toBe('scanner-mutatelock');
  });

  it('只去掉開頭的 stryker.,中間出現的 stryker. 不動(前綴規則有錨點 ^)', () => {
    expect(reportBaseName('foo.stryker.json')).toBe('foo.stryker');
  });

  it('只去掉結尾的 .json,中間出現的 .json 不動(後綴規則有錨點 $)', () => {
    expect(reportBaseName('stryker.config.json.bak')).toBe('config.json.bak');
  });
});

describe('withReportEnforcement(同行程,假的 run)', () => {
  it('reporters 合成是加不是換,jsonReporter.fileName 指到 reports/mutation/<name>.json,報告存在時原樣回傳 run 的退出碼', async () => {
    const dir = tmp('report-enforce-honors');
    writeFileSync(join(dir, 'stryker.foo.json'), JSON.stringify({ reporters: ['clear-text'] }));
    const logs: string[] = [];
    let receivedArgs: string[] = [];

    const code = await withCwd(dir, () =>
      withReportEnforcement(async (args) => {
        receivedArgs = args;
        const cfg = JSON.parse(readFileSync(args[1]!, 'utf8')) as { jsonReporter: { fileName: string } };
        mkdirSync(dirname(resolve(dir, cfg.jsonReporter.fileName)), { recursive: true });
        writeFileSync(resolve(dir, cfg.jsonReporter.fileName), '{}');
        return 0;
      }, (msg) => logs.push(msg))(['run', 'stryker.foo.json']),
    );

    expect(code).toBe(0);
    expect(logs, `不該有任何警告訊息:${JSON.stringify(logs)}`).toEqual([]);
    // 位置參數是 args[1] 的替換(finalArgs[posIndex] = effectiveAbs),不是插入多一個元素——
    // 原本只有 2 個參數,合成後也該還是 2 個,不能變成 3 個(那是「沒有位置參數」那條路走錯了)。
    expect(receivedArgs, `參數個數變了,像是走到了插入而不是替換:${JSON.stringify(receivedArgs)}`).toHaveLength(2);
    expect(receivedArgs[1]).toBe(resolve(dir, 'reports', 'mutation', '.effective-foo.json'));
    const effective = JSON.parse(readFileSync(receivedArgs[1]!, 'utf8')) as {
      reporters: string[];
      jsonReporter: { fileName: string };
    };
    expect(effective.reporters).toEqual(['clear-text', 'json']);
    expect(effective.jsonReporter.fileName).toBe(join('reports', 'mutation', 'foo.json'));
  });

  it('原本的設定沒有 reporters 欄位時,當成空陣列處理,合成後只有 json 一個', async () => {
    const dir = tmp('report-enforce-no-reporters-field');
    writeFileSync(join(dir, 'stryker.foo.json'), JSON.stringify({}));
    let receivedArgs: string[] = [];

    await withCwd(dir, () =>
      withReportEnforcement(async (args) => {
        receivedArgs = args;
        const cfg = JSON.parse(readFileSync(args[1]!, 'utf8')) as { jsonReporter: { fileName: string } };
        mkdirSync(dirname(resolve(dir, cfg.jsonReporter.fileName)), { recursive: true });
        writeFileSync(resolve(dir, cfg.jsonReporter.fileName), '{}');
        return 0;
      }, () => {})(['run', 'stryker.foo.json']),
    );

    const effective = JSON.parse(readFileSync(receivedArgs[1]!, 'utf8')) as { reporters: string[] };
    expect(effective.reporters).toEqual(['json']);
  });

  it('原本的 reporters 已經有 json 時不重複加', async () => {
    const dir = tmp('report-enforce-dedup');
    writeFileSync(join(dir, 'stryker.foo.json'), JSON.stringify({ reporters: ['clear-text', 'json'] }));
    let receivedArgs: string[] = [];

    await withCwd(dir, () =>
      withReportEnforcement(async (args) => {
        receivedArgs = args;
        const cfg = JSON.parse(readFileSync(args[1]!, 'utf8')) as { jsonReporter: { fileName: string } };
        mkdirSync(dirname(resolve(dir, cfg.jsonReporter.fileName)), { recursive: true });
        writeFileSync(resolve(dir, cfg.jsonReporter.fileName), '{}');
        return 0;
      }, () => {})(['run', 'stryker.foo.json']),
    );

    const effective = JSON.parse(readFileSync(receivedArgs[1]!, 'utf8')) as { reporters: string[] };
    expect(effective.reporters).toEqual(['clear-text', 'json']);
  });

  it('沒有位置參數(空跑)時退回 stryker.config.json,並且把合成後的路徑插在子指令後面', async () => {
    const dir = tmp('report-enforce-default-config');
    writeFileSync(join(dir, 'stryker.config.json'), JSON.stringify({ reporters: [] }));
    let receivedArgs: string[] = [];

    await withCwd(dir, () =>
      withReportEnforcement(async (args) => {
        receivedArgs = args;
        const cfg = JSON.parse(readFileSync(args[1]!, 'utf8')) as { jsonReporter: { fileName: string } };
        mkdirSync(dirname(resolve(dir, cfg.jsonReporter.fileName)), { recursive: true });
        writeFileSync(resolve(dir, cfg.jsonReporter.fileName), '{}');
        return 0;
      }, () => {})(['run', '--concurrency', '2']),
    );

    expect(receivedArgs[0]).toBe('run');
    expect(receivedArgs[2]).toBe('--concurrency');
    expect(receivedArgs[3]).toBe('2');
    const effective = JSON.parse(readFileSync(receivedArgs[1]!, 'utf8')) as { jsonReporter: { fileName: string } };
    expect(effective.jsonReporter.fileName).toBe(join('reports', 'mutation', 'config.json'));
  });

  it('讀不到 / parse 不動目標設定檔時跳過強制,原樣把 args 交給 run', async () => {
    const dir = tmp('report-enforce-unreadable');
    // 故意不寫 stryker.config.json,模擬全新環境沒有預設檔。
    let receivedArgs: string[] | null = null;

    const code = await withCwd(dir, () =>
      withReportEnforcement(async (args) => {
        receivedArgs = args;
        return 0;
      }, () => {})(['run', '--concurrency', '2']),
    );

    expect(code).toBe(0);
    expect(receivedArgs).toEqual(['run', '--concurrency', '2']);
  });

  it('run 回 0 但承諾的報告沒有落地時,退出碼要改成非 0,訊息要點名報告名字', async () => {
    const dir = tmp('report-enforce-missing-report');
    writeFileSync(join(dir, 'stryker.zero-guards-llmspend.json'), JSON.stringify({ reporters: [] }));
    const logs: string[] = [];

    const code = await withCwd(dir, () =>
      withReportEnforcement(async () => 0, (msg) => logs.push(msg))(['run', 'stryker.zero-guards-llmspend.json']),
    );

    expect(code).not.toBe(0);
    expect(logs.some((m) => m.includes('zero-guards-llmspend')), `訊息沒點名檔案:${JSON.stringify(logs)}`).toBe(
      true,
    );
  });

  it('run 自己已經回非 0,報告也沒落地時,保留 run 原本的退出碼,不蓋成 1', async () => {
    const dir = tmp('report-enforce-nonzero-kept');
    writeFileSync(join(dir, 'stryker.foo.json'), JSON.stringify({ reporters: [] }));

    const code = await withCwd(dir, () => withReportEnforcement(async () => 7, () => {})(['run', 'stryker.foo.json']));

    expect(code).toBe(7);
  });

  it('報告輸出目錄建不起來時(reports 被同名檔案佔住),回非 0 且記一條警告', async () => {
    const dir = tmp('report-enforce-blocked-dir');
    writeFileSync(join(dir, 'stryker.foo.json'), JSON.stringify({ reporters: [] }));
    writeFileSync(join(dir, 'reports'), 'not a directory');
    const logs: string[] = [];
    let ran = false;

    const code = await withCwd(dir, () =>
      withReportEnforcement(async () => {
        ran = true;
        return 0;
      }, (msg) => logs.push(msg))(['run', 'stryker.foo.json']),
    );

    expect(ran, 'mkdir 失敗時不該還去叫 run').toBe(false);
    expect(code).not.toBe(0);
    expect(logs, '目錄建不起來時沒有記任何警告').toHaveLength(1);
    expect(logs[0], `警告訊息是空的,講不清楚壞在哪:${JSON.stringify(logs)}`).toContain('reports');
  });
});
