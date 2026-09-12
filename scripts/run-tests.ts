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
 * **`--` 可省略,但邊界在哪要講清楚**(2026-09-05 實測,協調者):
 *   `npm test scripts/x.test.ts` 與 `npm test -- scripts/x.test.ts` **等價** ——
 *   `npm test` 是 npm 的特例別名,會把尾隨參數接在 script 尾巴那個 `--` 之後。
 *   (實測 `npm test scripts/mutate.test.ts` → 1 檔 150 條、沒取鎖;當全套會是 97 檔。)
 *   **但直接叫腳本 `npx tsx scripts/run-tests.ts scripts/x.test.ts`(沒有 `--`)會當全套**,
 *   因為那時沒有人幫你補那個 `--`。技術顧問就是量了後者、推廣成前者才推論錯的。
 *
 * **哪條線算「小範圍」**(釘在 scripts/run-tests.test.ts §2,改線先改測試):
 * `--` 之後有任何一個**存在於磁碟上的檔案或目錄**當位置參數,**而且它不是 cwd 本身或 cwd 的祖先**,
 * 就是小範圍,不拿鎖。
 * 其他一律當全套:沒有位置參數、只有旗標、旗標的值(`--reporter verbose` 的 verbose)、
 * 以及 vitest 的子字串 pattern(`npm test -- mutate`)。pattern 也當全套是**故意往安全的方向錯**:
 * 多鎖一次的代價是等幾分鐘,漏鎖一次的代價是整輪 OOM 或假紅。要快就給真的路徑。
 *
 * **超集也算全套**(§2b):給的路徑解析後的聯集涵蓋了**所有**含 `*.test.ts` 的頂層目錄
 * (現況 `packages scripts apps features` 四個全給),那是 100% 只是換了個寫法,照樣拿鎖。
 * 測試根是**掃 cwd 的頂層目錄**算出來的,不從 vitest config 推;`node_modules`、點開頭目錄、
 * 建置產物不掃。cwd 底下一個測試根都沒有時這層不介入。
 *
 * 「cwd 本身或祖先」那半句是審核輪補的洞:`.`、`''`、`./`、`/`、`scripts/..` 全都「存在」,
 * 但 vitest 拿它們當 filter 會跑**整套**(實測 `vitest list .` 跟 `vitest list` 都是 2661 條),
 * 沒鎖跑整套正是這支要防的事。`..` 也擋(vitest 對它找到 0 個檔,擋了沒損失)。
 *
 * 逾時、殘鎖、壞檔寬限、signal 清理**全部沿用** scripts/mutate.ts 的 acquireLock,
 * 這支不重新發明任何一條鎖的規則。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
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

const XML_ENTITY = /&(?:amp|lt|gt|quot|apos|#x[\da-f]+|#\d+);/gi;

function unescapeXml(value: string): string {
  return value.replace(XML_ENTITY, (entity) => {
    const body = entity.slice(1, -1);
    if (body === 'amp') return '&';
    if (body === 'lt') return '<';
    if (body === 'gt') return '>';
    if (body === 'quot') return '"';
    if (body === 'apos') return "'";
    const code = body.startsWith('#x') ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    return Number.isNaN(code) ? entity : String.fromCodePoint(code);
  });
}

/** JUnit 的 testcase = 檔案 + suite + name;保留重複名稱,因此是 multiset 不是 Set。 */
export function testcaseNamesFromJunit(xml: string): string[] {
  const names: string[] = [];
  for (const match of xml.matchAll(/<testcase\b([^>]*)>/gi)) {
    const attrs = match[1] ?? '';
    const attr = (name: string): string => {
      const found = attrs.match(new RegExp(`\\b${name}\\s*=\\s*([\"'])(.*?)\\1`, 'i'));
      return found ? unescapeXml(found[2]!) : '';
    };
    const classname = attr('classname');
    const testName = attr('name');
    if (classname || testName) names.push(classname && testName ? `${classname} > ${testName}` : classname || testName);
  }
  return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 全套測試的唯一持久化基準;局部測試不呼叫這支,避免覆寫整套基準。 */
export function writeTestcaseNames(xml: string, cwd: string = process.cwd()): void {
  const names = testcaseNamesFromJunit(xml);
  if (names.length === 0) throw new Error('JUnit 報告沒有任何 testcase 名稱');
  const out = join(cwd, 'reports', 'junit', 'testcase-names.txt');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${names.join('\n')}\n`, 'utf8');
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
 * 規則見檔頭:有任何一個**存在的檔案 / 目錄**當位置參數,而且不是 cwd 本身或 cwd 的祖先 → true(不拿鎖)。
 */
export function isPartialRun(passthrough: string[], cwd: string = process.cwd()): boolean {
  const here = resolve(cwd);
  // 只看「存在不存在」,不猜哪些旗標帶值:`--reporter verbose` 的 verbose 在磁碟上不存在,
  // 自然被當全套;`npm test -- mutate` 這種子字串 pattern 也一樣——故意往「多鎖一次」錯。
  const existing = passthrough
    .filter((arg) => !arg.startsWith('-'))
    .map((arg) => resolve(here, arg))
    .filter((target) => existsSync(target));
  // 存在,但解析出來是 cwd 自己(`.`、`''`、`./`、`scripts/..`)或 cwd 的祖先(`..`、`/`):
  // 那是整個 repo,vitest 會跑全套。只要有一個這種,旁邊再多幾個真的檔案也救不回來
  // (vitest 的 filter 是「或」),所以它蓋過一切,不是 some() 裡的一員。
  if (existing.some((target) => isSameOrAncestor(target, here))) return false;
  if (existing.length === 0) return false;
  // 超集(§2b):給的路徑聯集涵蓋了所有含 *.test.ts 的頂層目錄 → 那是 100%,只是換了個寫法。
  // 沒有任何測試根(cwd 不存在、或這裡根本沒測試)→ 這層不介入,上面的規則照舊。
  const roots = testRoots(here);
  if (roots.length > 0 && roots.every((root) => existing.includes(root))) return false;
  return true;
}

const TEST_FILE = /\.test\.ts$/;
/** 不掃的目錄:相依、建置產物、Stryker 沙盒(整個專案的複本)。點開頭的一律不掃。 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', 'coverage', 'reports']);

/** cwd 底下「含 *.test.ts 的頂層目錄」,解析成絕對路徑。掃出來的,不從 vitest config 推。 */
export function testRoots(cwd: string): string[] {
  return listDirs(cwd)
    .filter((name) => hasTestFile(join(cwd, name)))
    .map((name) => resolve(cwd, name));
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
      .map((e) => e.name);
  } catch {
    // Stryker disable next-line ArrayDeclaration: 這個回傳值一定再過一次 hasTestFile → readdirSync,不存在的名字在那層被濾成 false;任何非空陣列(`["Stryker was here"]`)結果都一樣,真等價(覆核輪判定,2026-09-05)
    return [];
  }
}

/** 找到第一個 *.test.ts 就回,不把整棵樹列完。 */
function hasTestFile(dir: string): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some((e) => e.isFile() && TEST_FILE.test(e.name))) return true;
  return listDirs(dir).some((name) => hasTestFile(join(dir, name)));
}

/** `dir` 是不是 `here` 本身或它的祖先。兩邊都已經 resolve 過。`/` 已經以 sep 結尾,不能再接一個。 */
function isSameOrAncestor(dir: string, here: string): boolean {
  if (dir === here) return true;
  const prefix = dir.endsWith(sep) ? dir : dir + sep;
  return here.startsWith(prefix);
}

/**
 * 進入點的本體。小範圍 → 直接跑 vitest;全套 → 拿鎖 → 跑 vitest → **finally 刪鎖**。
 * 回傳退出碼:vitest 自己的退出碼;等鎖超時 1(跟 runMutate 一樣,而且不跑 vitest)。
 */
export async function runTests(deps: RunTestsDeps = {}): Promise<number> {
  const argv = deps.argv ?? process.argv;
  const runVitest = deps.runVitest;
  const install = deps.installCleanup ?? ((release: () => void) => installCleanup(release));
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const cwd = deps.cwd ?? process.cwd();

  const args = vitestArgs(argv);
  // args[0] 一定是 `run`,後面才是使用者給 vitest 的東西。
  if (isPartialRun(args.slice(1), cwd)) {
    // 小範圍:連鎖都不碰(不算鎖的路徑、不 acquire、不掛 signal)。日常開發的命脈。
    return runVitest ? runVitest(args) : spawnVitest(args, false, log);
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
    return await (runVitest ? runVitest(args) : spawnVitest(args, true, log));
  } finally {
    uninstall();
    held.release();
  }
}

// Stryker disable all
/**
 * 真的把 vitest 叫起來。測試一律注入假的 `runVitest`(這支在 vitest 裡面跑,再起一個 vitest
 * 是遞迴),所以這一段沒有測試覆蓋——跟 mutate.ts 的 spawnStryker 同樣用 disable 標掉。
 *
 * vitest 起在**自己的 process group**(`detached: true`),signal 轉給整個 group 而不是只給
 * vitest 主行程。實測(審核輪,2026-09-05):只 SIGTERM vitest 主行程,它會死,但它 fork 出來的
 * 6 個 worker 會被孤兒化、繼續把整套跑完——那時鎖已經放掉了,下一個拿到鎖的人跟這 6 個 worker
 * 搶 CPU,正是這把鎖要防的假紅。終端機的 Ctrl-C 沒這個問題(SIGINT 是給整個前景 group 的),
 * 但 `kill <pid>`、被 supervisor 收掉、被 timeout 砍掉都是只打一個 pid。
 */
function spawnVitest(args: string[], recordNames: boolean, log: (msg: string) => void): Promise<number> {
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.bin', 'vitest');
  const tempDir = recordNames ? mkdtempSync(join(tmpdir(), 'llm-learning-cards-junit-')) : null;
  const junitFile = tempDir ? join(tempDir, 'results.xml') : null;
  // 兩個 reporter 並存:保留原本的終端輸出,另取 JUnit 只抽穩定的 testcase 名稱。
  const finalArgs = junitFile
    ? [...args, '--reporter=default', '--reporter=junit', `--outputFile.junit=${junitFile}`]
    : args;
  return new Promise((done) => {
    const child = spawn(bin, finalArgs, { stdio: 'inherit', detached: true });
    const forward = (sig: 'SIGINT' | 'SIGTERM') => () => {
      // 負的 pid = 整個 process group。group 已經沒了(ESRCH)就當作已經死透,不能丟。
      try {
        if (child.pid !== undefined) process.kill(-child.pid, sig);
      } catch {
        void child.kill(sig);
      }
    };
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
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      done(1);
    });
    child.on('close', (code) => {
      unforward();
      let result = code ?? 1;
      if (junitFile && tempDir) {
        try {
          writeTestcaseNames(readFileSync(junitFile, 'utf8'));
        } catch (err) {
          log(`Vitest 結束了(退出碼 ${result}),但 testcase 名稱基準寫不出來:${String(err)}`);
          if (result === 0) result = 1;
        } finally {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
      done(result);
    });
  });
}
// Stryker restore all

/** 同 mutate.ts:只有被當成指令跑的時候才執行,測試 import 這個模組不能起 vitest。 */
// Stryker disable all: 頂層 bootstrap,理由同 mutate.ts 末尾——`if (true)` 會在 vitest worker 裡再起一個全套 vitest 並搶真的鎖
if (isMainModule(process.argv[1], import.meta.url)) {
  void runTests().then((code) => {
    process.exitCode = code;
  });
}
