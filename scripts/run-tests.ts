/**
 * 全套 vitest 與 Stryker 共用同一把跨 worktree 檔案鎖(`.stryker.lock`,P-29 那把)。
 *
 * 為什麼有這支:`scripts/zero-input-guard.test.ts` 的子行程探針有 90 秒逾時。另一個 worktree
 * 同時在跑 Stryker、機器 load 15–37 的時候,會有 5 個探針逾時——那是**假紅**。三次紀錄:
 * never-executed-signals 的 worker 三次全中(load 25–37)、技術顧問在隔離簽出驗 5748a38
 * 第一次也中(load 17–29)、協調者合併後跑那次沒中(load 18–30)。兩台環境、三個人、
 * 同一個形狀、時好時壞。放寬 90 秒只是讓同樣的問題晚一點出現而且從此看不見,
 * 所以改成:**跑全套的人跟 Stryker 排同一條隊**。
 *
 * 用法(package.json 的 `test` 指到這裡):
 *   npm test                                   # 全套 → 拿鎖排隊,再跑 vitest run
 *   npm test -- scripts/mutate.test.ts         # 給了存在的檔案 / 目錄 → **不拿鎖**,直接跑
 *   npx vitest run scripts/mutate.test.ts      # 根本不經過這支 → 當然不拿鎖
 *
 * **哪條線算「小範圍」**(釘在 scripts/run-tests.test.ts §2,改線先改測試):
 * `--` 之後有任何一個**存在於磁碟上的檔案或目錄**當位置參數,就是小範圍,不拿鎖。
 * 其他一律當全套:沒有位置參數、只有旗標、旗標的值(`--reporter verbose` 的 verbose)、
 * 以及 vitest 的子字串 pattern(`npm test -- mutate`)。pattern 也當全套是**故意往安全的方向錯**:
 * 多鎖一次的代價是等幾分鐘,漏鎖一次的代價是整輪 OOM 或假紅。要快就給真的路徑。
 *
 * 逾時、殘鎖、壞檔寬限、signal 清理**全部沿用** scripts/mutate.ts 的 acquireLock,
 * 這支不重新發明任何一條鎖的規則。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LockTimeoutError,
  acquireLock,
  installCleanup,
  isMainModule,
  selfLockInfo,
  strykerLockPath,
  type AcquireDeps,
  type HeldLock,
} from './mutate.js';

export interface RunTestsDeps {
  argv?: string[];
  /** 鎖的路徑。預設 strykerLockPath():跟 Stryker 同一把。 */
  lockPath?: string;
  /** 直接注入拿鎖的動作。給了就不走 acquireLock,也不看 `lock`。 */
  acquire?: (lockPath: string) => Promise<HeldLock>;
  /** 交給預設 acquireLock 的注入(時鐘、sleep、log、retryMs…)。`info.task` 一律是 'test'。 */
  lock?: AcquireDeps;
  runVitest?: (args: string[]) => Promise<number>;
  installCleanup?: (release: () => void) => () => void;
  log?: (msg: string) => void;
  /** isPartialRun 用來判「位置參數是不是存在的路徑」。預設 process.cwd()。 */
  cwd?: string;
}

/**
 * 把 argv 翻成給 vitest 的參數。`--` 之後原樣透傳,一律補 `run` 子指令
 * (使用者自己打了 `run` 就不補第二次)。跟 strykerArgs 同一個形狀。
 */
export function vitestArgs(argv: string[]): string[] {
  // 只認**第一個** `--`:後面再出現的是使用者要給 vitest 的,原樣送過去。
  const at = argv.indexOf('--');
  const passthrough = at === -1 ? [] : argv.slice(at + 1);
  // 一律是 `run`,不是裸 vitest(那會進 watch,把鎖握到天荒地老)。
  return passthrough[0] === 'run' ? passthrough : ['run', ...passthrough];
}

/**
 * `passthrough`(已經去掉 `--` 與 `run` 的 vitest 參數)是不是小範圍。
 * 規則見檔頭:有任何一個**存在的檔案 / 目錄**當位置參數 → true(不拿鎖)。
 */
export function isPartialRun(passthrough: string[], cwd: string = process.cwd()): boolean {
  // 只看「存在不存在」,不猜哪些旗標帶值:`--reporter verbose` 的 verbose 在磁碟上不存在,
  // 自然被當全套;`npm test -- mutate` 這種子字串 pattern 也一樣——故意往「多鎖一次」錯。
  return passthrough.some((arg) => !arg.startsWith('-') && existsSync(resolve(cwd, arg)));
}

/**
 * 進入點的本體。小範圍 → 直接跑 vitest;全套 → 拿鎖 → 跑 vitest → **finally 刪鎖**。
 * 回傳退出碼:vitest 自己的退出碼;等鎖超時 1(跟 runMutate 一樣,而且不跑 vitest)。
 */
export async function runTests(deps: RunTestsDeps = {}): Promise<number> {
  const argv = deps.argv ?? process.argv;
  const runVitest = deps.runVitest ?? spawnVitest;
  const install = deps.installCleanup ?? ((release: () => void) => installCleanup(release));
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const cwd = deps.cwd ?? process.cwd();

  const args = vitestArgs(argv);
  // args[0] 一定是 `run`,後面才是使用者給 vitest 的東西。
  if (isPartialRun(args.slice(1), cwd)) {
    // 小範圍:連鎖都不碰(不算鎖的路徑、不 acquire、不掛 signal)。日常開發的命脈。
    return runVitest(args);
  }

  const lockPath = deps.lockPath ?? strykerLockPath();
  const acquire =
    deps.acquire ??
    ((path: string) =>
      // 展開 deps.lock 再蓋 info.task:給的 info 只能蓋 pid / cwd / startedAt,標籤一律是 test。
      acquireLock(path, { ...deps.lock, info: { ...(deps.lock?.info ?? selfLockInfo()), task: 'test' } }));

  let held: HeldLock;
  try {
    held = await acquire(lockPath);
  } catch (err) {
    // 等超過上限:回 1、不跑 vitest。鎖不是我的,不動它(跟 runMutate 一樣)。
    if (err instanceof LockTimeoutError) {
      log(err.message);
      return 1;
    }
    throw err;
  }

  // finally 管正常結束與例外;signal 走 installCleanup 那條路(finally 跑不到)。兩邊都要有。
  const uninstall = install(() => held.release());
  try {
    return await runVitest(args);
  } finally {
    uninstall();
    held.release();
  }
}

// Stryker disable all
/**
 * 真的把 vitest 叫起來。測試一律注入假的 `runVitest`(這支在 vitest 裡面跑,再起一個 vitest
 * 是遞迴),所以這一段沒有測試覆蓋——跟 mutate.ts 的 spawnStryker 同樣用 disable 標掉。
 */
function spawnVitest(args: string[]): Promise<number> {
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.bin', 'vitest');
  return new Promise((done) => {
    const child = spawn(bin, args, { stdio: 'inherit' });
    const forward = (sig: 'SIGINT' | 'SIGTERM') => () => void child.kill(sig);
    const onInt = forward('SIGINT');
    const onTerm = forward('SIGTERM');
    process.prependListener('SIGINT', onInt);
    process.prependListener('SIGTERM', onTerm);
    const unforward = () => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
    };
    child.on('error', (err) => {
      unforward();
      console.error(`跑不起來 vitest(${bin}):${String(err)}`);
      done(1);
    });
    child.on('close', (code) => {
      unforward();
      done(code ?? 1);
    });
  });
}
// Stryker restore all

/** 同 mutate.ts:只有被當成指令跑的時候才執行,測試 import 這個模組不能起 vitest。 */
if (isMainModule(process.argv[1], import.meta.url)) {
  void runTests().then((code) => {
    process.exitCode = code;
  });
}
