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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainModule, type AcquireDeps, type HeldLock } from './mutate.js';

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
  void argv;
  throw new Error('TODO(開發輪):vitestArgs 未實作');
}

/**
 * `passthrough`(已經去掉 `--` 與 `run` 的 vitest 參數)是不是小範圍。
 * 規則見檔頭:有任何一個**存在的檔案 / 目錄**當位置參數 → true(不拿鎖)。
 */
export function isPartialRun(passthrough: string[], cwd: string = process.cwd()): boolean {
  void passthrough;
  void cwd;
  throw new Error('TODO(開發輪):isPartialRun 未實作');
}

/**
 * 進入點的本體。小範圍 → 直接跑 vitest;全套 → 拿鎖 → 跑 vitest → **finally 刪鎖**。
 * 回傳退出碼:vitest 自己的退出碼;等鎖超時 1(跟 runMutate 一樣,而且不跑 vitest)。
 */
export async function runTests(deps: RunTestsDeps = {}): Promise<number> {
  void deps;
  throw new Error('TODO(開發輪):runTests 未實作');
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
void spawnVitest; // TODO(開發輪):runTests 的預設 runVitest 用它;現在只是不讓 tsc 抱怨沒人用。
// Stryker restore all

/** 同 mutate.ts:只有被當成指令跑的時候才執行,測試 import 這個模組不能起 vitest。 */
if (isMainModule(process.argv[1], import.meta.url)) {
  void runTests().then((code) => {
    process.exitCode = code;
  });
}
