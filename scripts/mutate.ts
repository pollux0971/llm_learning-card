/**
 * 跨 worktree 的 Stryker 檔案鎖(P-29)。
 *
 * 為什麼有這支:三個 worktree 的審核輪同時跑 Stryker,把彼此 OOM 掉(exit 144)。
 * 那一輪三個審核跑了 84 / 45 / 40 分鐘,一大半燒在互相踩踏。更危險的是被 OOM
 * 殺掉的那一輪如果沒被診斷出來,殘缺的分數會被當成驗收結果回報——靜默的假驗收。
 *
 * 用法(package.json 的 `mutate` 是 `tsx scripts/mutate.ts --`,指到這裡):
 *   npm run mutate                                   # 拿鎖,再把 Stryker CLI 以預設設定跑起來
 *   npm run mutate -- --mutate "packages/core/src/x.ts"
 *   npm run mutate -- stryker.scanner-doclinks.json
 *
 * 參數原樣透傳給 Stryker CLI,所以設定檔、--mutate 等旗標照樣生效。
 * 退出碼:Stryker 自己的退出碼;等鎖等超過上限則 1。
 *
 * ⚠️ 這支保護的是「經過 npm run mutate 的人」。直接叫 Stryker CLI 繞過鎖,
 * repo 裡的文件、skill 與程式碼註解一律寫 `npm run mutate --`,否則鎖只擋得住一半的人
 * (`scripts/mutate.test.ts` §13 掃所有文字檔守著這條,含 .ts 的註解)。
 */
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, fsyncSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
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

/**
 * 持鎖者在跑什麼。這把鎖從 P-29 的「只有 Stryker」變成「Stryker 與全套 vitest 共用」
 * (見 scripts/run-tests.ts),等鎖的人要知道對面是哪一種,訊息才講得出人話。
 * 舊格式的鎖檔沒有這欄,parseLock 要能照樣解(缺欄 = undefined,不是壞檔)。
 */
export type LockTask = 'stryker' | 'test';

/** 鎖檔內容。契約沒有規定這個型別(infra,不進 contracts/)。 */
export interface LockInfo {
  pid: number;
  /** ISO 8601。用字串而不是 epoch,人打開鎖檔要看得懂。 */
  startedAt: string;
  /** 持鎖者的 worktree 路徑,等鎖時印給人看。 */
  cwd: string;
  /** 持鎖者在跑 Stryker 還是全套測試。舊鎖檔沒有這欄。 */
  task?: LockTask;
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
 * 從 fs / child_process 丟出來的錯誤裡取 errno 字串。取不到回 undefined。
 *
 * 不另外檢查型別:呼叫端一律拿去跟 'ENOENT' / 'EEXIST' / 'ESRCH' 這種字面值比對,
 * `code` 是數字或根本不存在的時候比出來一樣是 false,多一層守衛不會改變任何人的行為。
 */
function errnoCode(err: unknown): string | undefined {
  return (err as { code?: string } | null | undefined)?.code;
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
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  return join(dirname(resolve(cwd, common)), LOCK_FILENAME);
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
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return errnoCode(err) !== 'ESRCH';
  }
}

/** 讀鎖檔。檔案不在回 null。 */
export function readLock(lockPath: string): LockRead | null {
  try {
    const raw = readFileSync(lockPath, 'utf8');
    // 先讀內容再 stat:中間鎖被別人刪掉的話 statSync 丟 ENOENT,同一個 catch 收掉回 null,
    // 跟「一開始就沒有鎖」是同一件事。
    return { raw, mtimeMs: statSync(lockPath).mtimeMs };
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return null;
    throw err;
  }
}

/** 解析鎖檔內容。格式不合(不是 JSON、少欄位、pid 不是數字)一律回 null。 */
export function parseLock(raw: string): LockInfo | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { pid, startedAt, cwd, task } = value as Record<string, unknown>;
  if (typeof pid !== 'number') return null;
  if (typeof cwd !== 'string') return null;
  // JSON 的數字一定是有限的,所以 pid 只要檢查型別。startedAt 反過來:型別對還不夠,
  // 解不出時間的字串('not-a-date')會讓年齡計算變 NaN,那比壞檔更難查。
  if (typeof startedAt !== 'string' || Number.isNaN(Date.parse(startedAt))) return null;
  const info: LockInfo = { pid, startedAt, cwd };
  // task 是標籤,不是鎖的效力:舊格式沒有這欄、或值認不得,都**不是壞檔**。
  // 判成壞檔會在寬限期一過被當殘鎖刪掉——刪掉一把活的、別人正在用的鎖。認得才帶。
  if (task === 'stryker' || task === 'test') info.task = task;
  return info;
}

/** 判一把讀到的鎖是活的還是殘的。 */
export function classifyLock(read: LockRead, deps: ClassifyDeps = {}): LockVerdict {
  const now = deps.now ?? Date.now();
  const isAlive = deps.isAlive ?? pidIsAlive;
  const staleAfterMs = deps.staleAfterMs ?? STALE_AFTER_MS;
  const corruptGraceMs = deps.corruptGraceMs ?? CORRUPT_GRACE_MS;

  const info = parseLock(read.raw);
  if (info === null) {
    // 【判斷】壞檔分兩種。剛 openSync('wx') 建好、內容還沒寫進去(幾毫秒的窗口)不算壞,
    // 刪掉等於搶走別人剛拿到的鎖;真的壞了(寫到一半被 OOM 殺掉)留著會擋滿 90 分鐘。
    // 用 mtime 分:寬限期之內當活的,之後才清。沒有 pid 可問,所以不問 isAlive。
    if (now - read.mtimeMs <= corruptGraceMs) {
      return { kind: 'live', info: null, why: `鎖檔讀不出內容,但剛寫沒多久,當作別人才剛建好還沒寫完` };
    }
    return { kind: 'stale', info: null, why: `鎖檔讀不出合法內容,而且超過 ${corruptGraceMs / 1000} 秒沒動過` };
  }

  if (!isAlive(info.pid)) {
    return { kind: 'stale', info, why: `持鎖的 pid ${info.pid} 已經不在了` };
  }

  // 【判斷】規格寫「**超過** 2 小時」。剛好 2 小時是還沒超過,所以只有嚴格大於才算殘。
  // startedAt 在未來(NTP 校時、跨機器)會算出負的年齡,那也不該被當成超時。
  const ageMs = now - Date.parse(info.startedAt);
  if (ageMs > staleAfterMs) {
    return { kind: 'stale', info, why: `鎖從 ${info.startedAt} 到現在超過 ${staleAfterMs / 3_600_000} 小時` };
  }

  return { kind: 'live', info, why: `pid ${info.pid} 還在跑` };
}

/**
 * 原子地建鎖。拿到回 true,已經有人回 false。
 *
 * 一定要 `openSync(path, 'wx')`:existsSync 再 create 中間有 race,兩個程序會同時「拿到」。
 */
export function tryAcquire(lockPath: string, info: LockInfo): boolean {
  let fd: number;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (err) {
    if (errnoCode(err) === 'EEXIST') return false;
    throw err;
  }
  try {
    // fsync 是因為鎖的讀者是別的程序:留在 page cache 裡沒關係,但機器掉電之後
    // 半截鎖檔會擋到寬限期。寫完就同步,反正一輪只做一次。
    writeSync(fd, `${JSON.stringify(info)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * 刪鎖。只刪自己的:鎖檔裡的 pid 跟 `pid` 不同就不動它。
 * 刪到別人的鎖比留下殘鎖糟得多(殘鎖兩小時後會自己過期,誤刪是立刻踩踏)。
 * 回傳是否真的刪掉。
 */
export function releaseLock(lockPath: string, pid: number): boolean {
  const read = readLock(lockPath);
  if (read === null) return false;
  const info = parseLock(read.raw);
  // 讀不出 pid 就證明不了這把是自己的,不刪。
  if (info === null) return false;
  if (info.pid !== pid) return false;
  return removeLockFile(lockPath);
}

/**
 * 無條件刪鎖檔。只有兩個呼叫端:確認過是自己的鎖(releaseLock),
 * 或確認過是殘鎖(acquireLock)。回傳是否真的刪掉。
 */
function removeLockFile(lockPath: string): boolean {
  try {
    unlinkSync(lockPath);
  } catch (err) {
    // 別人先刪掉了,結果一樣好,不是錯誤。
    if (errnoCode(err) === 'ENOENT') return false;
    throw err;
  }
  return true;
}

/** 這個程序的鎖檔內容。`task` 是持鎖者在跑什麼;不給就是舊格式(沒有 task 欄)。 */
export function selfLockInfo(
  cwd: string = process.cwd(),
  nowIso: string = new Date().toISOString(),
  task?: LockTask,
): LockInfo {
  const info: LockInfo = { pid: process.pid, startedAt: nowIso, cwd };
  // 沒給 task 就不放那個 key:JSON 化之後要跟舊格式一模一樣(不是 `"task": undefined`,
  // JSON.stringify 會把它丟掉沒錯,但 `'task' in info` 這種判斷會看到它)。
  if (task !== undefined) info.task = task;
  return info;
}

/**
 * 拿鎖,拿不到就等。
 *
 * 迴圈:tryAcquire → 拿到就回;拿不到讀鎖判斷,殘鎖刪掉重拿,活鎖印訊息睡 retryMs。
 * 累計等超過 maxWaitMs 丟 LockTimeoutError。
 */
export async function acquireLock(lockPath: string, deps: AcquireDeps = {}): Promise<HeldLock> {
  const info = deps.info ?? selfLockInfo();
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const isAlive = deps.isAlive ?? pidIsAlive;
  const retryMs = deps.retryMs ?? RETRY_INTERVAL_MS;
  const maxWaitMs = deps.maxWaitMs ?? MAX_WAIT_MS;

  // 「自己的鏈 / 別人的」每次重試都要判,而 sameWorktree 每判一次要問 git 兩次。
  // 等 90 分鐘是 360 次重試;測試用假時鐘走完整個 90 分鐘時那 720 次 git 是真的跑
  // (實測 load 17 時 2.4 秒,load 30+ 就貼近 vitest 5 秒的逾時)。持鎖者與自己的 cwd
  // 在一次等待裡不會變,所以同一組路徑只問一次。
  const same = memoizedSameWorktree();
  const startedAt = now();
  for (;;) {
    if (tryAcquire(lockPath, info)) {
      return { lockPath, info, release: () => void releaseLock(lockPath, info.pid) };
    }

    const read = readLock(lockPath);
    // 剛好在 tryAcquire 與 readLock 之間被放掉,馬上再搶一次,不用睡。
    if (read === null) continue;

    // 展開 deps 而不是逐欄複製:staleAfterMs / corruptGraceMs 的預設值只有 classifyLock
    // 一份,這裡再寫一次就有兩個真相。多帶過去的 sleep / log 那幾欄 classifyLock 不看。
    const verdict = classifyLock(read, { ...deps, now: now(), isAlive });
    if (verdict.kind === 'stale') {
      // 殘鎖是「馬上可以用」,不是「等 15 秒再看一次」。清掉直接重搶。
      log(`清掉殘留的 Stryker 鎖:${verdict.why}`);
      removeLockFile(lockPath);
      continue;
    }

    const waitedMs = now() - startedAt;
    if (waitedMs >= maxWaitMs) {
      // 放棄不等於接管:鎖不是我的,不能刪。留給下一個人或兩小時的殘鎖規則處理。
      throw new LockTimeoutError(
        `等 Stryker 的鎖等超過 ${maxWaitMs / 60_000} 分鐘還是拿不到,放棄。鎖:${lockPath}(${verdict.why})`,
        waitedMs,
        verdict.info,
      );
    }
    log(waitingMessage(verdict.info, waitedMs, { selfCwd: info.cwd, maxWaitMs, sameWorktree: same }));
    await sleep(retryMs);
  }
}

/**
 * 等鎖訊息需要的上下文:我是誰(selfCwd)、等多久會放棄(maxWaitMs)。
 * `sameWorktree` 可注入,預設是下面那個真的問 git 的。
 */
export interface WaitContext {
  /** 等鎖的這個程序的 cwd。預設 process.cwd()。 */
  selfCwd?: string;
  /** 印「逾時 N 分鐘」用。預設 MAX_WAIT_MS。 */
  maxWaitMs?: number;
  sameWorktree?: (a: string, b: string) => boolean;
}

/**
 * 兩個路徑是不是同一個 worktree。
 *
 * 為什麼要有這個:five-zero-guards 的審核 agent 看到「鎖被佔著」,把**自己排的鏈**
 * (同一個 worktree 裡前一個指令還沒放鎖)讀成別的 worktree 佔的,差點手動刪 .stryker.lock。
 * 光印 cwd 讓 agent 自己比對已經證明不夠,所以由程式判,訊息直接寫成人話。
 *
 * 判法:各自 `git rev-parse --show-toplevel`,相同就是同一個 worktree。任一邊不是 git 目錄
 * 或路徑不存在 → 退回比對 resolve 後的路徑;還是不一樣就當**別人的**——不確定時往
 * 「別人的、不要刪」保守,跟 pidIsAlive 的 EPERM 同一個方向。**不可以丟例外**:
 * 持鎖者的 worktree 可能已經被 `git worktree remove` 掉了,那時候還在等鎖的人不能因此爆掉。
 */
export function sameWorktree(a: string, b: string): boolean {
  const rootA = worktreeRoot(a);
  const rootB = worktreeRoot(b);
  if (rootA !== null && rootB !== null) return rootA === rootB;
  // 任一邊問不到 git(不是 git 目錄、路徑不存在):只剩路徑本身可比。
  // 這裡不能用「另一邊的根包含這個路徑」之類的猜法——猜錯的方向是「把別人的當自己的」。
  return resolve(a) === resolve(b);
}

/**
 * 這個目錄所在的 worktree 根(`git rev-parse --show-toplevel`)。問不到回 null,**不丟**。
 *
 * 要用 `--show-toplevel` 而不是 `--git-common-dir`:後者對同一個主 repo 底下的所有 worktree
 * 都回同一個 `.git/`(strykerLockPath 正是靠這點算出同一把鎖),拿它來判會把所有 worktree
 * 都判成自己的——那就是這個函式要防的誤判本身。
 */
function worktreeRoot(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf8',
      // stderr 不接管:不是 git 目錄時 git 會抱怨一行,那不是給等鎖的人看的。
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // 路徑不存在(spawn ENOENT)、不是 git 目錄(exit 128)、git 不在——全部當「問不到」。
    return null;
  }
}

/** sameWorktree 的記憶版:同一組 (a, b) 只問 git 一次。給 acquireLock 的重試迴圈用。 */
function memoizedSameWorktree(): (a: string, b: string) => boolean {
  const seen = new Map<string, boolean>();
  return (a, b) => {
    const key = `${a}\0${b}`;
    let hit = seen.get(key);
    if (hit === undefined) {
      hit = sameWorktree(a, b);
      seen.set(key, hit);
    }
    return hit;
  };
}

/**
 * 等鎖時印的那一段。抽出來是為了讓測試釘住格式。
 *
 * 兩行:第一行是事實(鎖檔名、持鎖者 pid、在跑什麼、cwd),第二行是**判斷**——
 * 「這是你自己排的鏈,繼續等」或「這是別的 worktree,不要刪鎖、不要 kill」——
 * 再加上「逾時 N 分鐘,已等 M」。格式由 scripts/mutate.test.ts §14 釘住。
 */
export function waitingMessage(holder: LockInfo | null, waitedMs: number, ctx: WaitContext = {}): string {
  const selfCwd = ctx.selfCwd ?? process.cwd();
  const maxWaitMs = ctx.maxWaitMs ?? MAX_WAIT_MS;
  const same = ctx.sameWorktree ?? sameWorktree;

  // 第一行:事實。持鎖者讀不出時(剛 openSync 還沒寫完)每一欄都要有東西,不能印 undefined。
  const who = holder === null ? '另一個 worktree' : holder.cwd;
  const pid = holder === null ? '讀不出' : String(holder.pid);
  const task = holder === null ? undefined : holder.task;
  // 舊格式的鎖沒有 task:講「Stryker 或全套測試」,不猜。
  const doing = task === 'stryker' ? 'Stryker' : task === 'test' ? '全套測試' : 'Stryker 或全套測試';
  const fact = `等待 ${LOCK_FILENAME}(持鎖者 pid ${pid} 在跑 ${doing}, cwd=${who})`;

  // 第二行:判斷。三種,互斥——同時出現兩句,看的人又得自己猜。
  // 讀不出持鎖者就分不出是誰的,那時候不能說是自己的(說是自己的,agent 會覺得可以動它)。
  const verdict =
    holder === null
      ? '鎖檔還讀不出持鎖者(可能剛建好還沒寫完),分不出是誰的。不要刪鎖,不要 kill。'
      : same(selfCwd, holder.cwd)
        ? '這是你自己排的鏈(同一個 worktree),正常,繼續等。'
        : '這是別的 worktree 佔的。不要刪鎖,不要 kill 那個 pid。';

  const timing = `逾時 ${maxWaitMs / 60_000} 分鐘,已等 ${waitedText(waitedMs)}。`;
  return `${fact}\n→ ${verdict}${timing}`;
}

/** 已等多久,給人看:不到一分鐘講秒,滿一分鐘講分鐘(無條件捨去,「已等 6 分鐘」不是 6.5)。 */
function waitedText(waitedMs: number): string {
  if (waitedMs < 60_000) return `${Math.floor(waitedMs / 1000)} 秒`;
  return `${Math.floor(waitedMs / 60_000)} 分鐘`;
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
 *
 * 這跟 runMutate 的 finally 是**兩件獨立的事**:finally 管正常結束與例外,
 * signal 走的是另一條路,finally 根本不會跑到。兩邊都要有,少一個鎖就會留下來。
 */
export function installCleanup(release: () => void, target: SignalTarget = process): () => void {
  const onSigint = () => {
    release();
    target.exit(130); // 128 + SIGINT(2)
  };
  const onSigterm = () => {
    release();
    target.exit(143); // 128 + SIGTERM(15)
  };
  // exit 事件已經在結束流程裡了,再 exit 一次沒有意義(而且會蓋掉原本的退出碼)。
  const onExit = () => {
    release();
  };

  target.on('SIGINT', onSigint);
  target.on('SIGTERM', onSigterm);
  target.on('exit', onExit);

  return () => {
    target.off?.('SIGINT', onSigint);
    target.off?.('SIGTERM', onSigterm);
    target.off?.('exit', onExit);
  };
}

/**
 * 把 argv 翻成給 stryker 的參數。
 *
 * `npm run mutate -- --concurrency 2` → argv 裡 `--` 之後是使用者的參數,原樣透傳。
 * 一律補上 `run` 子指令;使用者自己打了 `run` 就不要補第二次。
 *
 * 只認**第一個** `--`:後面還有 `--` 是使用者要傳給 Stryker 的,原樣送過去。
 */
export function strykerArgs(argv: string[]): string[] {
  const at = argv.indexOf('--');
  const passthrough = at === -1 ? [] : argv.slice(at + 1);
  return passthrough[0] === 'run' ? passthrough : ['run', ...passthrough];
}

export interface RunDeps {
  argv?: string[];
  lockPath?: string;
  acquire?: (lockPath: string) => Promise<HeldLock>;
  /**
   * 交給預設 acquireLock 的注入(時鐘、sleep、log、retryMs…)。測試要走**真的**拿鎖迴圈
   * 但不真的睡 15 秒時用這個;給了 `acquire` 就不看。`info.task` 一律是 'stryker',
   * 這裡給的 `info` 只蓋 pid / cwd / startedAt。
   */
  lock?: AcquireDeps;
  runStryker?: (args: string[]) => Promise<number>;
  installCleanup?: (release: () => void) => () => void;
  log?: (msg: string) => void;
}

/**
 * 進入點的本體。拿鎖 → 跑 Stryker → **finally 刪鎖**,回傳退出碼。
 *
 * finally 是這支的重點:Stryker 自己失敗、丟例外,鎖都不能留。被 signal 殺掉走的是
 * installCleanup 那條路(finally 不會跑),兩條各自獨立。
 */
export async function runMutate(deps: RunDeps = {}): Promise<number> {
  const argv = deps.argv ?? process.argv;
  const acquire =
    deps.acquire ??
    ((path: string) =>
      // 展開 deps.lock 再蓋 info.task:給的 info 只能蓋 pid / cwd / startedAt,標籤一律是 stryker。
      acquireLock(path, { ...deps.lock, info: { ...(deps.lock?.info ?? selfLockInfo()), task: 'stryker' } }));
  const runStryker = deps.runStryker ?? spawnStryker;
  const install = deps.installCleanup ?? ((release: () => void) => installCleanup(release));
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const lockPath = deps.lockPath ?? strykerLockPath();

  let held: HeldLock;
  try {
    held = await acquire(lockPath);
  } catch (err) {
    if (err instanceof LockTimeoutError) {
      log(err.message);
      return 1;
    }
    throw err;
  }

  const uninstall = install(() => held.release());
  try {
    return await runStryker(strykerArgs(argv));
  } finally {
    uninstall();
    held.release();
  }
}

// Stryker disable all
/**
 * 真的把 Stryker 叫起來。測試一律注入假的 `runStryker`(真跑一輪要幾十分鐘),
 * 所以這一段沒有測試覆蓋——用 Stryker 自己的 disable 標掉,不要讓「測不到的 spawn」
 * 混進分數裡假裝有人守。
 */
function spawnStryker(args: string[]): Promise<number> {
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.bin', 'stryker');
  return new Promise((done) => {
    const child = spawn(bin, args, { stdio: 'inherit' });

    // 我們自己攔了 SIGINT / SIGTERM,預設「連子行程一起收掉」的行為就沒了。
    // 用 prependListener 排在 installCleanup 的 handler **前面**:那個 handler 會直接
    // process.exit,排在它後面永遠不會跑到,Stryker 就變成孤兒繼續吃記憶體——
    // 鎖放掉了、吃記憶體的還在,正是這支要防的踩踏。
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
      console.error(`跑不起來 Stryker(${bin}):${String(err)}`);
      done(1);
    });
    child.on('close', (code) => {
      unforward();
      // 被 signal 殺掉時 code 是 null。當成失敗,不要靜靜回 0 變成假驗收。
      done(code ?? 1);
    });
  });
}
// Stryker restore all

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
