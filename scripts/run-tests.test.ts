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
 *   §2b **超集漏**——給的路徑聯集涵蓋了**所有**含測試檔的頂層目錄(現況 packages / scripts /
 *      apps / features 四個)→ 跑的是 100%,仍算全套、要拿鎖。測試根是**掃出來的**,不從 vitest
 *      config 推(config 會變,改 config 的人不會想到要同步這裡)。錯的方向仍然是多鎖。
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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  LOCK_FILENAME,
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
    // 兩個測試根(scripts、packages),不是一個:§2b 的超集規則說「給的路徑涵蓋**所有**含測試檔的
    // 頂層目錄就是全套」。只有一個根的話,`scripts/` 就是 100%,下面「給了存在的目錄 → 小範圍」
    // 那幾條會變成在測超集,不是在測「目錄算小範圍」。
    writeFileSync(join(d, 'packages', 'core', 'core.test.ts'), '', 'utf8');
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

  // 審核輪(2026-09-05)補的洞:「存在的目錄」也包括 cwd 自己跟它的祖先,而 vitest 拿它們當 filter
  // 會跑**整套**(實測 `vitest list .`、`vitest list ''`、`vitest list /` 都是 2661 條,跟不給一樣)。
  // 整套沒鎖正是這支要防的事,所以這些一律當全套。
  it('cwd 自己(`.`、``、`./`)→ 全套(拿鎖):存在,但那是整個 repo', () => {
    const d = cwdWithFiles();
    expect(isPartialRun(['.'], d)).toBe(false);
    expect(isPartialRun([''], d)).toBe(false);
    expect(isPartialRun(['./'], d)).toBe(false);
  });

  it('繞回 cwd 的路徑(`scripts/..`、`./scripts/../`)→ 全套:看的是解析後的位置,不是字面', () => {
    const d = cwdWithFiles();
    expect(isPartialRun(['scripts/..'], d)).toBe(false);
    expect(isPartialRun(['./scripts/../'], d)).toBe(false);
    expect(isPartialRun(['packages/core/../..'], d)).toBe(false);
  });

  it('cwd 的祖先(`..`、`/`)→ 全套', () => {
    const d = cwdWithFiles();
    expect(isPartialRun(['..'], d)).toBe(false);
    expect(isPartialRun(['/'], d)).toBe(false);
    // `/` 本身以分隔符結尾,前綴比對不能變成 `//`。
    expect(isPartialRun(['/', 'scripts/'], d)).toBe(false);
  });

  it('絕對路徑寫的 cwd 自己(有沒有結尾斜線都一樣)→ 全套', () => {
    const d = cwdWithFiles();
    expect(isPartialRun([d], d)).toBe(false);
    expect(isPartialRun([`${d}/`], d)).toBe(false);
  });

  it('cwd 自己跟一個真的檔案混著給 → 還是全套:`.` 那個 filter 已經涵蓋整套', () => {
    const d = cwdWithFiles();
    expect(isPartialRun(['.', 'scripts/mutate.test.ts'], d)).toBe(false);
    expect(isPartialRun(['scripts/mutate.test.ts', '..'], d)).toBe(false);
  });

  it('cwd 底下的目錄還是小範圍(前綴比對只擋「祖先」,不擋「後代」)', () => {
    const d = cwdWithFiles();
    expect(isPartialRun(['scripts'], d)).toBe(true);
    expect(isPartialRun(['scripts/'], d)).toBe(true);
    expect(isPartialRun([join(d, 'packages', 'core')], d)).toBe(true);
    // 名字只是以 cwd 的名字開頭的**兄弟**目錄,不是祖先也不是自己:照舊看存不存在。
    mkdirSync(`${d}-sibling`, { recursive: true });
    expect(isPartialRun([`${d}-sibling`], d)).toBe(true);
  });

  it('cwd 給的是相對或沒正規化的路徑也一樣判(兩邊都先 resolve)', () => {
    const d = cwdWithFiles();
    expect(isPartialRun(['.'], `${d}/scripts/..`)).toBe(false);
    expect(isPartialRun(['scripts'], `${d}/scripts/..`)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2b. 超集漏:四個頂層目錄全給,判成小範圍卻跑了 100%
//
// `npm test -- packages scripts apps features`:四個都存在、都不是 cwd 或 cwd 的祖先,
// §2 的規則判成小範圍 → 不拿鎖。**但它跑的是整套。** 這是 nightmare-assault 的工人拿我們的
// 「小範圍誤判」表去量出來的 9 種之一(其他 8 種我們不中:沒有單一 testpaths 目錄、npm test 的
// cwd 永遠是 repo 根、`--root` 的值一律當全套所以多鎖)。
//
// 裁定(技術顧問):小範圍判定之後**再加一層**——給定路徑的聯集涵蓋了所有「含 *.test.ts 的
// 頂層目錄」→ 仍算全套。測試根**掃 repo 頂層目錄**算出來,**不從 vitest config 推**。
// 錯的方向仍然是多鎖。
// ─────────────────────────────────────────────────────────────────────────────

describe('isPartialRun 的超集規則(§2b)', () => {
  /**
   * 一個長得像本 repo 的臨時 cwd:四個含測試檔的頂層目錄(測試檔藏在不同深度)、
   * 一個沒有測試檔的頂層目錄(docs)、一個頂層檔案(vitest.config.ts)。
   * 現況實測(2026-09-05,repo 根):packages 76 檔、scripts 13、apps 7、features 1,就是這四個。
   */
  const ROOTS = ['packages', 'scripts', 'apps', 'features'] as const;
  function cwdLikeRepo(): string {
    const d = tmp('run-tests-superset');
    mkdirSync(join(d, 'packages', 'core', 'src'), { recursive: true });
    writeFileSync(join(d, 'packages', 'core', 'src', 'scheduler.test.ts'), '', 'utf8');
    mkdirSync(join(d, 'scripts'), { recursive: true });
    writeFileSync(join(d, 'scripts', 'mutate.test.ts'), '', 'utf8');
    mkdirSync(join(d, 'apps', 'desktop', 'src', 'lib'), { recursive: true });
    writeFileSync(join(d, 'apps', 'desktop', 'src', 'lib', 'store.test.ts'), '', 'utf8');
    mkdirSync(join(d, 'features', 'support'), { recursive: true });
    writeFileSync(join(d, 'features', 'support', 'helpers.test.ts'), '', 'utf8');
    mkdirSync(join(d, 'docs', 'reviews'), { recursive: true });
    writeFileSync(join(d, 'docs', 'reviews', 'x.md'), '', 'utf8');
    writeFileSync(join(d, 'vitest.config.ts'), '', 'utf8');
    return d;
  }

  it('四個測試根全給 → 全套(拿鎖):那就是 100%,只是換了個寫法', () => {
    // 這條是這半的核心。
    expect(isPartialRun([...ROOTS], cwdLikeRepo())).toBe(false);
  });

  it('順序、結尾斜線、絕對路徑、重複給都不影響:看的是聯集,不是字面也不是個數', () => {
    const d = cwdLikeRepo();
    expect(isPartialRun(['features', 'apps', 'scripts', 'packages'], d)).toBe(false);
    expect(isPartialRun(['packages/', 'scripts/', 'apps/', 'features/'], d)).toBe(false);
    expect(isPartialRun(ROOTS.map((r) => join(d, r)), d)).toBe(false);
    expect(isPartialRun(['packages', join(d, 'scripts'), 'apps/', './features'], d)).toBe(false);
    // 同一個根給三次還是只涵蓋一個根,不是「給了 ≥ 4 個就算全套」。
    expect(isPartialRun(['scripts', 'scripts', 'scripts', 'scripts'], d)).toBe(true);
  });

  it('給三個 → 仍是小範圍(不拿鎖):少一個根就不是 100%', () => {
    const d = cwdLikeRepo();
    expect(isPartialRun(['packages', 'scripts', 'apps'], d)).toBe(true);
    expect(isPartialRun(['scripts', 'apps', 'features'], d)).toBe(true);
    expect(isPartialRun(['packages', 'features'], d)).toBe(true);
    expect(isPartialRun(['packages'], d)).toBe(true);
  });

  it('四個根全給再多給旗標 → 還是全套(旗標不改變範圍,§2 同一條)', () => {
    expect(isPartialRun(['--reporter=verbose', ...ROOTS, '--bail=1'], cwdLikeRepo())).toBe(false);
  });

  it('沒有測試檔的頂層目錄不是測試根:給它不算涵蓋,少給它也不算漏', () => {
    const d = cwdLikeRepo();
    // docs 沒有 *.test.ts。三個根 + docs 還是三個根 → 小範圍。
    expect(isPartialRun(['packages', 'scripts', 'apps', 'docs'], d)).toBe(true);
    // 四個根 + docs → 全套;docs 不會把「還差一個」的錯覺帶進來。
    expect(isPartialRun([...ROOTS, 'docs'], d)).toBe(false);
  });

  it('頂層檔案不是測試根:vitest.config.ts 存在也不算一個要涵蓋的目錄', () => {
    const d = cwdLikeRepo();
    expect(isPartialRun([...ROOTS], d)).toBe(false);
    expect(isPartialRun(['vitest.config.ts', 'packages', 'scripts', 'apps'], d)).toBe(true);
  });

  it('根底下的檔案或子目錄不算涵蓋那個根:scripts/mutate.test.ts + 其他三個根 → 小範圍', () => {
    const d = cwdLikeRepo();
    expect(isPartialRun(['scripts/mutate.test.ts', 'packages', 'apps', 'features'], d)).toBe(true);
    expect(isPartialRun(['packages/core', 'scripts', 'apps', 'features'], d)).toBe(true);
    // 子目錄湊起來也不算:packages/core 不等於 packages(packages 底下可能還有別的套件)。
    expect(isPartialRun(['packages/core', 'packages/core/src', 'scripts', 'apps', 'features'], d)).toBe(true);
  });

  it('測試根是掃出來的,不是寫死的:新增一個含測試檔的頂層目錄,判定跟著變', () => {
    const d = cwdLikeRepo();
    expect(isPartialRun([...ROOTS], d)).toBe(false);
    // 多一個含測試檔的頂層目錄 → 原本的四個就不再是 100%。
    mkdirSync(join(d, 'tools', 'deep', 'er'), { recursive: true });
    writeFileSync(join(d, 'tools', 'deep', 'er', 'cli.test.ts'), '', 'utf8');
    expect(isPartialRun([...ROOTS], d)).toBe(true);
    expect(isPartialRun([...ROOTS, 'tools'], d)).toBe(false);
    // 反過來:拿掉一個根的測試檔,剩三個根,三個全給就是全套。
    rmSync(join(d, 'tools'), { recursive: true, force: true });
    rmSync(join(d, 'features', 'support', 'helpers.test.ts'));
    expect(isPartialRun(['packages', 'scripts', 'apps'], d)).toBe(false);
  });

  it('只認 *.test.ts:.spec.ts、.test.js、test.ts(沒有點)都不會把一個目錄變成測試根', () => {
    const d = cwdLikeRepo();
    mkdirSync(join(d, 'tools'), { recursive: true });
    writeFileSync(join(d, 'tools', 'a.spec.ts'), '', 'utf8');
    writeFileSync(join(d, 'tools', 'b.test.js'), '', 'utf8');
    writeFileSync(join(d, 'tools', 'test.ts'), '', 'utf8');
    writeFileSync(join(d, 'tools', 'test.ts.bak'), '', 'utf8');
    // tools 不是測試根 → 四個仍是 100%。
    expect(isPartialRun([...ROOTS], d)).toBe(false);
    // 真的放一個 *.test.ts 進去才算。
    writeFileSync(join(d, 'tools', 'c.test.ts'), '', 'utf8');
    expect(isPartialRun([...ROOTS], d)).toBe(true);
  });

  it('node_modules 與點開頭的目錄不掃:裡面的 *.test.ts 不會製造一個永遠涵蓋不到的假根', () => {
    // 這條是這個規則的命門。node_modules 裡有幾百個 *.test.ts(現況 190 檔),.stryker-tmp 的
    // 沙盒更是整個專案的複本。它們若算根,四個全給永遠「還差一個」→ 永遠小範圍 → 規則形同虛設。
    const d = cwdLikeRepo();
    mkdirSync(join(d, 'node_modules', 'some-dep', 'src'), { recursive: true });
    writeFileSync(join(d, 'node_modules', 'some-dep', 'src', 'index.test.ts'), '', 'utf8');
    mkdirSync(join(d, '.stryker-tmp', 'sandbox-123', 'scripts'), { recursive: true });
    writeFileSync(join(d, '.stryker-tmp', 'sandbox-123', 'scripts', 'mutate.test.ts'), '', 'utf8');
    mkdirSync(join(d, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(d, '.git', 'hooks', 'x.test.ts'), '', 'utf8');
    expect(isPartialRun([...ROOTS], d)).toBe(false);
    // 而且就算有人把它們也寫進去,也不會因此變成「多涵蓋了根」以外的東西:還是全套。
    expect(isPartialRun([...ROOTS, 'node_modules', '.stryker-tmp'], d)).toBe(false);
  });

  it('根底下的 node_modules 不算:packages/core/node_modules 裡的測試檔不會讓 packages 變成根', () => {
    const d = cwdLikeRepo();
    rmSync(join(d, 'packages', 'core', 'src', 'scheduler.test.ts'));
    mkdirSync(join(d, 'packages', 'core', 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(d, 'packages', 'core', 'node_modules', 'dep', 'a.test.ts'), '', 'utf8');
    // packages 現在沒有自己的測試檔 → 三個根,三個全給就是全套。
    expect(isPartialRun(['scripts', 'apps', 'features'], d)).toBe(false);
  });

  // 下面三條是覆核輪補的:第一次跑嚴格級變異,run-tests.ts 這段掃描碼存活 6 個、沒覆蓋 2 個,全在這裡。

  it('*.test.ts 要在檔名**結尾**:a.test.ts.bak、b.test.tsx 都不算(regex 的 $ 錨點)', () => {
    const d = cwdLikeRepo();
    mkdirSync(join(d, 'tools'), { recursive: true });
    writeFileSync(join(d, 'tools', 'a.test.ts.bak'), '', 'utf8');
    writeFileSync(join(d, 'tools', 'b.test.tsx'), '', 'utf8');
    // 沒有 $ 的話 `.test.ts` 會對到這兩個,tools 就變成第五個根、四個全給就不再是 100%。
    expect(isPartialRun([...ROOTS], d)).toBe(false);
  });

  it('dist / target / coverage / reports 四個建置產物目錄不掃:頂層的不是根,根底下的也不算數', () => {
    // 每個名字各自一條斷言:少掃任何一個(例如 SKIP_DIRS 漏了 'coverage')都要有一條紅。
    for (const name of ['dist', 'target', 'coverage', 'reports']) {
      const d = cwdLikeRepo();
      // 頂層:`reports/x.test.ts`(Stryker 會把整個專案複製進 reports 底下的沙盒)不是第五個根。
      mkdirSync(join(d, name, 'deep'), { recursive: true });
      writeFileSync(join(d, name, 'deep', 'x.test.ts'), '', 'utf8');
      expect(isPartialRun([...ROOTS], d), `頂層 ${name}/ 被當成測試根`).toBe(false);
      // 根底下:tools 本身沒測試,只有 tools/<name>/ 裡有 → tools 不是根。
      mkdirSync(join(d, 'tools', name), { recursive: true });
      writeFileSync(join(d, 'tools', name, 'y.test.ts'), '', 'utf8');
      expect(isPartialRun([...ROOTS], d), `tools/${name}/ 讓 tools 變成測試根`).toBe(false);
    }
  });

  it('讀不到的頂層目錄(沒有讀權限)不是測試根,也不會讓判定炸掉', () => {
    // root 看得到任何目錄,chmod 000 擋不住 → 這條在 root 底下不成立,跳過而不是假綠。
    if (process.getuid?.() === 0) return;
    const d = cwdLikeRepo();
    const sealed = join(d, 'sealed');
    mkdirSync(sealed, { recursive: true });
    writeFileSync(join(sealed, 'x.test.ts'), '', 'utf8');
    chmodSync(sealed, 0o000);
    try {
      // 裡面明明有 x.test.ts,但讀不到就不能算它是根:四個全給還是 100%。
      // readdirSync 丟 EACCES 要被接住回 false,不是往外丟、也不是當成「有」。
      expect(isPartialRun([...ROOTS], d)).toBe(false);
    } finally {
      // afterAll 的 rmSync 要能進去刪。
      chmodSync(sealed, 0o700);
    }
  });

  it('cwd 底下一個測試根都沒有(或 cwd 不存在)→ 超集規則不介入,§2 的規則照舊', () => {
    // 「涵蓋所有根」對空集合是空泛的真;但那不是 100%,那是「這裡沒有測試」。
    // 拿存在的檔案判小範圍的舊規則要留著,不然 `絕對路徑也算` 那條(cwd=/nowhere)就翻了。
    const d = tmp('run-tests-no-roots');
    mkdirSync(join(d, 'src'), { recursive: true });
    writeFileSync(join(d, 'src', 'a.ts'), '', 'utf8');
    expect(isPartialRun(['src'], d)).toBe(true);
    expect(isPartialRun([], d)).toBe(false);
    const elsewhere = cwdLikeRepo();
    expect(isPartialRun([join(elsewhere, 'scripts', 'mutate.test.ts')], '/nowhere/at/all')).toBe(true);
  });

  it('cwd 的祖先或 cwd 自己混在四個根裡 → 還是全套(§2 那半句蓋過一切,不會被這層翻回小範圍)', () => {
    const d = cwdLikeRepo();
    expect(isPartialRun(['.', ...ROOTS], d)).toBe(false);
    expect(isPartialRun(['..', 'packages'], d)).toBe(false);
  });

  it('真的 repo:packages scripts apps features 四個全給 → 全套;少一個 → 小範圍', () => {
    // 這條釘的是「現況就是這四個」。多了或少了一個含測試檔的頂層目錄,這條會紅——那是對的:
    // 那時候要來這裡改 ROOTS,順便想一下 package.json / 文件裡的例子要不要跟著改。
    expect(isPartialRun([...ROOTS], REPO_ROOT)).toBe(false);
    expect(isPartialRun(['packages', 'scripts', 'apps'], REPO_ROOT)).toBe(true);
    expect(isPartialRun(['scripts'], REPO_ROOT)).toBe(true);
  });
});

describe('runTests 的超集:四個根全給要拿鎖', () => {
  it('`npm test -- packages scripts apps features`:鎖被別人握著就要排隊,不能直接跑', async () => {
    // isPartialRun 判對了還不夠,要確認 runTests 真的去拿鎖(跟 `npm test -- .` 那條同一個形狀)。
    const dir = tmp('run-tests-superset-queues');
    const lockPath = holdLiveLock(dir);
    let acquired = 0;
    let ran: string[] | undefined;
    const code = await runTests({
      argv: ['node', 'run-tests.ts', '--', 'packages', 'scripts', 'apps', 'features'],
      lockPath,
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
    expect(acquired).toBe(1);
    // 參數原樣給 vitest:是拿不拿鎖的問題,不是改使用者要跑什麼。
    expect(ran).toEqual(['run', 'packages', 'scripts', 'apps', 'features']);
  });

  it('三個根:鎖被別人握著照樣立刻跑(這層不能把小範圍做過頭)', async () => {
    const dir = tmp('run-tests-three-roots');
    const lockPath = holdLiveLock(dir);
    const before = readFileSync(lockPath, 'utf8');
    let ran = false;
    const code = await runTests({
      argv: ['node', 'run-tests.ts', '--', 'packages', 'scripts', 'apps'],
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
    expect(readFileSync(lockPath, 'utf8')).toBe(before);
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

  it('`npm test -- .` 不是小範圍:鎖被別人握著就要排隊,不能直接跑', async () => {
    // 審核輪補的洞的 runTests 層:isPartialRun 判對了還不夠,要確認 runTests 真的去拿鎖。
    const dir = tmp('run-tests-dot-queues');
    const lockPath = holdLiveLock(dir);
    let acquired = 0;
    let ran: string[] | undefined;
    const code = await runTests({
      argv: ['node', 'run-tests.ts', '--', '.'],
      lockPath,
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
    expect(acquired).toBe(1);
    // 參數原樣給 vitest:是拿不拿鎖的問題,不是改使用者要跑什麼。
    expect(ran).toEqual(['run', '.']);
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
    // 值從 import 驗、宣告從原始碼驗。不能比對「LOCK_FILENAME = '.stryker.lock'」整段字面:
    // Stryker 的沙盒會把初始值包成 mutant 開關,那段字面就不在了,dry run 直接紅(審核輪 2026-09-05 踩到)。
    expect(LOCK_FILENAME).toBe('.stryker.lock');
    const src = readFileSync(MUTATE_MODULE, 'utf8');
    expect(src).toMatch(/export const LOCK_FILENAME\b/);
    expect(readFileSync(RUN_TESTS_MODULE, 'utf8')).not.toMatch(/const LOCK_FILENAME\b/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. 審核輪(2026-09-05)補殺的變異:預設接線、旗標與路徑的邊界、release 真的會刪鎖
// ─────────────────────────────────────────────────────────────────────────────

describe('runTests 的預設接線(不注入時)', () => {
  it('不給 lock 也不給 acquire:走真的 acquireLock,鎖檔標 task: "test",跑完鎖不在', async () => {
    // `deps.lock?.info` 的 `?.` 拿掉會在這裡炸。
    const dir = tmp('run-tests-defaults-lock');
    const lockPath = join(dir, '.stryker.lock');
    let seen: string | undefined;
    const code = await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath,
      runVitest: async () => {
        seen = readFileSync(lockPath, 'utf8');
        return 0;
      },
      installCleanup: () => () => {},
      log: () => {},
    });
    expect(code).toBe(0);
    expect(parseLock(seen ?? '')?.task).toBe('test');
    expect(parseLock(seen ?? '')?.pid).toBe(process.pid);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('不給 installCleanup:真的把 SIGTERM / SIGINT handler 掛到 process 上,跑完拆掉', async () => {
    const dir = tmp('run-tests-defaults-install');
    const term0 = process.listenerCount('SIGTERM');
    const int0 = process.listenerCount('SIGINT');
    let during: [number, number] | undefined;
    await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath: join(dir, '.stryker.lock'),
      lock: { sleep: NEVER_SLEEP, log: () => {} },
      runVitest: async () => {
        during = [process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')];
        return 0;
      },
      log: () => {},
    });
    expect(during).toEqual([term0 + 1, int0 + 1]);
    expect(process.listenerCount('SIGTERM')).toBe(term0);
    expect(process.listenerCount('SIGINT')).toBe(int0);
  });

  it('不給 log:等鎖逾時的訊息印到 console.log', async () => {
    const dir = tmp('run-tests-defaults-log');
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    try {
      const code = await runTests({
        argv: ['node', 'run-tests.ts'],
        lockPath: join(dir, '.stryker.lock'),
        acquire: async () => {
          throw new LockTimeoutError('等太久了啦', 123, null);
        },
        runVitest: async () => {
          throw new Error('等鎖逾時不該跑 vitest');
        },
        installCleanup: () => () => {},
      });
      expect(code).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(lines).toEqual(['等太久了啦']);
  });

  it('不給 cwd:用 process.cwd() 判;給了 cwd 就用給的,不偷看 process.cwd()', async () => {
    // 套件在 repo 根跑:`scripts/run-tests.test.ts` 相對 process.cwd() 存在 → 小範圍。
    let acquired = 0;
    const acquire = async (p: string) => {
      acquired += 1;
      return { lockPath: p, info: info(), release: () => {} };
    };
    const base = { runVitest: async () => 0, installCleanup: () => () => {}, log: () => {}, acquire };
    const dir = tmp('run-tests-cwd');
    await runTests({ ...base, argv: ['node', 'run-tests.ts', '--', 'scripts/run-tests.test.ts'], lockPath: join(dir, '.stryker.lock') });
    expect(acquired).toBe(0);
    // 同一個相對路徑,cwd 改成一個沒有 scripts/ 的臨時目錄 → 不存在 → 全套,要拿鎖。
    // `deps.cwd ?? process.cwd()` 變成 `deps.cwd && process.cwd()` 的話,這裡會拿 process.cwd() 判成小範圍。
    await runTests({ ...base, argv: ['node', 'run-tests.ts', '--', 'scripts/run-tests.test.ts'], lockPath: join(dir, '.stryker.lock'), cwd: dir });
    expect(acquired).toBe(1);
  });
});

describe('isPartialRun 的邊界(補殺)', () => {
  it('旗標就算剛好有同名檔案存在也不是路徑(`-t` 檔在 cwd 裡 → 還是全套)', () => {
    const d = tmp('run-tests-flag-file');
    writeFileSync(join(d, '-t'), '', 'utf8');
    writeFileSync(join(d, '--coverage'), '', 'utf8');
    expect(existsSync(join(d, '-t'))).toBe(true);
    expect(isPartialRun(['-t'], d)).toBe(false);
    expect(isPartialRun(['--coverage'], d)).toBe(false);
  });

  it('cwd 的名字剛好以某個存在目錄的名字開頭(/tmp/x 對 /tmp/xy)→ 那不是祖先,還是小範圍', () => {
    // 前綴比對少了分隔符的話,/tmp/x 會被當成 /tmp/xy 的祖先。
    const base = tmp('run-tests-prefix');
    const short = join(base, 'x');
    const cwd = join(base, 'xy');
    mkdirSync(short);
    mkdirSync(cwd);
    expect(isPartialRun([short], cwd)).toBe(true);
  });

  it('runTests 只拿 `run` 後面的參數判:cwd 裡剛好有個叫 run 的檔案,只給旗標還是全套', async () => {
    const d = tmp('run-tests-run-file');
    writeFileSync(join(d, 'run'), '', 'utf8');
    let acquired = 0;
    const code = await runTests({
      argv: ['node', 'run-tests.ts', '--', '--reporter=dot'],
      lockPath: join(d, '.stryker.lock'),
      acquire: async (p) => {
        acquired += 1;
        return { lockPath: p, info: info(), release: () => {} };
      },
      runVitest: async () => 0,
      installCleanup: () => () => {},
      log: () => {},
      cwd: d,
    });
    expect(code).toBe(0);
    expect(acquired).toBe(1);
  });
});

describe('交給 installCleanup 的 release 真的會刪鎖', () => {
  it('signal handler 拿到的那個 callback 叫下去,鎖檔就不在了(不是一個空函式)', async () => {
    const dir = tmp('run-tests-release-cb');
    const lockPath = join(dir, '.stryker.lock');
    let handler: (() => void) | undefined;
    let goneDuring: boolean | undefined;
    await runTests({
      argv: ['node', 'run-tests.ts'],
      lockPath,
      lock: { sleep: NEVER_SLEEP, log: () => {} },
      installCleanup: (release) => {
        handler = release;
        return () => {};
      },
      runVitest: async () => {
        expect(existsSync(lockPath)).toBe(true);
        handler?.();
        goneDuring = !existsSync(lockPath);
        return 0;
      },
      log: () => {},
    });
    expect(handler).toBeDefined();
    expect(goneDuring).toBe(true);
  });
});
