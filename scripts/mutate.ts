/**
 * 跨 worktree 的 Stryker 檔案鎖(P-29)。
 *
 * 為什麼有這支:三個 worktree 的審核輪同時跑 Stryker,把彼此 OOM 掉(exit 144)。
 * 那一輪三個審核跑了 84 / 45 / 40 分鐘,一大半燒在互相踩踏。更危險的是被 OOM
 * 殺掉的那一輪如果沒被診斷出來,殘缺的分數會被當成驗收結果回報——靜默的假驗收。
 *
 * 用法(package.json 的 `mutate` 指到這裡):
 *   npm run mutate                                   # = stryker run
 *   npm run mutate -- --mutate "packages/core/src/x.ts"
 *   npm run mutate -- stryker.scanner-doclinks.json
 *
 * 退出碼:Stryker 自己的退出碼;等鎖等超過上限則 1。
 *
 * ⚠️ 這支保護的是「經過 npm run mutate 的人」。直接 `npx stryker run` 繞過鎖,
 * 文件裡的指令要逐步改成 `npm run mutate --`,否則鎖只擋得住一半的人。
 */
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 鎖檔名。放在主 repo 的 `.git/` 旁邊(不是各 worktree 自己的根)。 */
export const LOCK_FILENAME = '.stryker.lock';

/** 拿不到鎖時的重試間隔。 */
export const RETRY_INTERVAL_MS = 15_000;

/** 等鎖的總上限。超過就 exit 1,不無限等。 */
export const MAX_WAIT_MS = 90 * 60_000;

/** 鎖活過這個時間就算殘鎖。Stryker 跑再久也不該超過兩小時。 */
export const STALE_AFTER_MS = 2 * 60 * 60_000;

/**
 * 鎖檔內容壞掉時的寬限期。
 *
 * 為什麼需要:`openSync(path, 'wx')` 建檔與寫入內容是兩步。另一個程序剛好在這中間
 * 讀到鎖,看到的是**空檔案**——那不是壞掉,是還沒寫完。這個窗口只有幾毫秒,
 * 給 10 秒的寬限綽綽有餘;超過 10 秒還讀不出合法 JSON 的,才是真的壞了。
 */
export const CORRUPT_GRACE_MS = 10_000;

/** 鎖檔內容。契約沒有規定這個型別(infra,不進 contracts/)。 */
export interface LockInfo {
  pid: number;
  /** ISO 8601。用字串而不是 epoch,人打開鎖檔要看得懂。 */
  startedAt: string;
  /** 持鎖者的 worktree 路徑,等鎖時印給人看。 */
  cwd: string;
}

/** 讀鎖的結果。`mtimeMs` 是給壞檔寬限期用的。 */
export interface LockRead {
  raw: string;
  mtimeMs: number;
}

/** 判鎖的結論。`info` 在鎖檔壞掉時是 null。 */
export interface LockVerdict {
  kind: 'live' | 'stale';
  info: LockInfo | null;
  /** 人看的理由,會被印出來,也是測試的斷言對象。 */
  why: string;
}

export interface ClassifyDeps {
  /** 現在時間(epoch ms)。測試注入假時鐘。 */
  now?: number;
  /** pid 是否還活著。預設是 pidIsAlive。 */
  isAlive?: (pid: number) => boolean;
  staleAfterMs?: number;
  corruptGraceMs?: number;
}

export interface AcquireDeps {
  /** 要寫進鎖檔的內容。預設是現在這個程序。 */
  info?: LockInfo;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  isAlive?: (pid: number) => boolean;
  retryMs?: number;
  maxWaitMs?: number;
  staleAfterMs?: number;
  corruptGraceMs?: number;
}

/** 拿到鎖之後的把手。`release` 必須是冪等的(finally 與 signal handler 都會叫)。 */
export interface HeldLock {
  lockPath: string;
  info: LockInfo;
  release: () => void;
}

/** 等鎖等超過上限。呼叫端把它翻成 exit 1。 */
export class LockTimeoutError extends Error {
  constructor(
    message: string,
    readonly waitedMs: number,
    readonly holder: LockInfo | null,
  ) {
    super(message);
    this.name = 'LockTimeoutError';
  }
}

/**
 * 算鎖的路徑。
 *
 * **這條最容易寫錯**:每個 worktree 有自己的根,鎖放在自己的根等於沒鎖。
 * `git rev-parse --git-common-dir` 在任何 worktree 裡都指向**主 repo 的 `.git/`**,
 * 取它的上一層就是主 repo 的工作目錄——所有 worktree 算出來會是同一個路徑。
 *
 * 主 repo 裡 git 可能回相對路徑(`.git`),所以先 resolve 再 dirname。
 */
export function strykerLockPath(cwd: string = process.cwd()): string {
  void cwd;
  void execFileSync;
  void dirname;
  void join;
  void resolve;
  throw new Error('TODO: 用 git rev-parse --git-common-dir 算跨 worktree 的鎖路徑');
}

/**
 * pid 是否還活著。
 *
 * - `ESRCH` = 程序不在 → 死了(殘鎖)
 * - `EPERM` = 程序**在**,只是不是我的 → **活著**。誤判成殘鎖就會刪掉別人正在用的鎖,
 *   那正是這支要防的踩踏,所以往「活著」的方向保守。
 * - 其他錯誤也當活著,理由同上:不確定就別刪。
 *
 * 注意 pid 會重用。pid 檢查是盡力而為,真正的保底是 STALE_AFTER_MS。
 */
export function pidIsAlive(
  pid: number,
  // 包一層 arrow,不要直接傳 process.kill:拆下來的方法丟掉 this 就不保證還能用。
  kill: (pid: number, sig: 0) => void = (p, sig) => void process.kill(p, sig),
): boolean {
  void pid;
  void kill;
  throw new Error('TODO: process.kill(pid, 0),ESRCH 才算死');
}

/** 讀鎖檔。檔案不在回 null。 */
export function readLock(lockPath: string): LockRead | null {
  void lockPath;
  throw new Error('TODO: readFileSync + statSync,ENOENT 回 null');
}

/** 解析鎖檔內容。格式不合(不是 JSON、少欄位、pid 不是數字)一律回 null。 */
export function parseLock(raw: string): LockInfo | null {
  void raw;
  throw new Error('TODO: JSON.parse + 欄位檢查,壞的回 null');
}

/** 判一把讀到的鎖是活的還是殘的。 */
export function classifyLock(read: LockRead, deps: ClassifyDeps = {}): LockVerdict {
  void read;
  void deps;
  throw new Error('TODO: 壞檔寬限 → pid 檢查 → 年齡檢查');
}

/**
 * 原子地建鎖。拿到回 true,已經有人回 false。
 *
 * 一定要 `openSync(path, 'wx')`:existsSync 再 create 中間有 race,兩個程序會同時「拿到」。
 */
export function tryAcquire(lockPath: string, info: LockInfo): boolean {
  void lockPath;
  void info;
  throw new Error("TODO: openSync(lockPath, 'wx') + writeSync + fsync + close");
}

/**
 * 刪鎖。只刪自己的:鎖檔裡的 pid 跟 `pid` 不同就不動它。
 * 刪到別人的鎖比留下殘鎖糟得多(殘鎖兩小時後會自己過期,誤刪是立刻踩踏)。
 * 回傳是否真的刪掉。
 */
export function releaseLock(lockPath: string, pid: number): boolean {
  void lockPath;
  void pid;
  throw new Error('TODO: 讀鎖比對 pid,是自己的才 unlink');
}

/** 這個程序的鎖檔內容。 */
export function selfLockInfo(cwd: string = process.cwd(), nowIso: string = new Date().toISOString()): LockInfo {
  void cwd;
  void nowIso;
  throw new Error('TODO: { pid: process.pid, startedAt: nowIso, cwd }');
}

/**
 * 拿鎖,拿不到就等。
 *
 * 迴圈:tryAcquire → 拿到就回;拿不到讀鎖判斷,殘鎖刪掉重拿,活鎖印訊息睡 retryMs。
 * 累計等超過 maxWaitMs 丟 LockTimeoutError。
 */
export async function acquireLock(lockPath: string, deps: AcquireDeps = {}): Promise<HeldLock> {
  void lockPath;
  void deps;
  throw new Error('TODO: 重試迴圈');
}

/** 等鎖時印的那一行。抽出來是為了讓測試釘住格式。 */
export function waitingMessage(holder: LockInfo | null, waitedMs: number): string {
  void holder;
  void waitedMs;
  throw new Error('TODO: 等 <cwd> 的 Stryker(pid <pid>)');
}

/** installCleanup 需要的最小 process 介面,測試注入假的。 */
export interface SignalTarget {
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  off?(event: string, handler: (...args: unknown[]) => void): unknown;
  exit(code?: number): never;
}

/**
 * 掛 SIGINT / SIGTERM / exit 的清理。回傳一個「拆掉這些 handler」的函式。
 *
 * signal 有預設行為(結束程序),一旦掛了 handler 就變成我們負責結束,
 * 所以 release 之後要自己 exit(128 + signo)。
 */
export function installCleanup(release: () => void, target: SignalTarget = process): () => void {
  void release;
  void target;
  throw new Error('TODO: 掛 SIGINT / SIGTERM / exit,release 之後自己結束');
}

/**
 * 把 argv 翻成給 stryker 的參數。
 *
 * `npm run mutate -- --concurrency 2` → argv 裡 `--` 之後是使用者的參數,原樣透傳。
 * 一律補上 `run` 子指令;使用者自己打了 `run` 就不要補第二次。
 */
export function strykerArgs(argv: string[]): string[] {
  void argv;
  throw new Error('TODO: 取 -- 之後的參數,前面補 run');
}

export interface RunDeps {
  argv?: string[];
  lockPath?: string;
  acquire?: (lockPath: string) => Promise<HeldLock>;
  runStryker?: (args: string[]) => Promise<number>;
  installCleanup?: (release: () => void) => () => void;
  log?: (msg: string) => void;
}

/**
 * 進入點的本體。拿鎖 → 跑 Stryker → **finally 刪鎖**,回傳退出碼。
 *
 * finally 是這支的重點:Stryker 自己失敗、丟例外、被 Ctrl-C,鎖都不能留。
 */
export async function runMutate(deps: RunDeps = {}): Promise<number> {
  void deps;
  throw new Error('TODO: acquire → try/finally → release');
}

/**
 * 只有被當成指令跑的時候才執行。測試會 import 這個模組,不能讓 import 就跑 Stryker。
 *
 * 這個函式**不是 TODO**:它擋在頂層,留 TODO 會讓整個模組一 import 就爆,
 * 測試檔連載入都載入不了,每個 TODO 就看不出是哪一條紅——那對實作的人沒有用。
 */
export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  return resolve(argv1) === resolve(fileURLToPath(moduleUrl));
}

if (isMainModule(process.argv[1], import.meta.url)) {
  // 不用 top-level await:這個檔案會被測試的臨時腳本 import,
  // 那些腳本在 repo 外面,tsx 會當 CJS 轉譯,頂層 await 會直接爆掉。
  void runMutate().then((code) => {
    process.exitCode = code;
  });
}
