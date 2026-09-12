/**
 * 零輸入守門(P-44 升類):每一支 CLI 入口對「空 / 缺 / 壞」輸入的行為,一張表管到底。
 *
 * 為什麼升類:同一種洞(空的跟健康的長一樣、缺檔噴 stack、壞 JSON 吐裸 JS 錯誤)
 * 連續三輪都還找得到——第一輪 lint.ts / review.ts,第二輪 check-questions / due.ts /
 * llm-spend.ts / weekly.ts,第三輪 validate-log / validate-review / validate-category /
 * grade.ts / check-standalone。靠人記得去 grep 已經證明不夠,所以寫成常設測試。
 *
 * 規則(每一個入口、每一種輸入形狀都套):
 *
 *   1. **退出碼非 0**。例外只有「正當的空狀態」(`legitZero`),而且要寫理由。
 *      正當的判準是 snapshot.ts「是 repo 但無變更」與 review.ts「有卡但今天 0 張到期」:
 *      **訊息說清楚了發生什麼事、而且跟異常狀態的訊息不同**。壞輸入(malformed / wrong-type)
 *      永遠不可以是正當的 exit 0——型別上就不給填 `legitZero`。
 *   2. **不噴裸 stack trace、不吐裸引擎訊息**(`Cannot read properties…`、`Unexpected end of
 *      JSON input`、`ENOENT: …` 開頭的一行……)。使用者要看到的是「哪個檔案怎麼了」,
 *      不是 V8 的內心話。包了前後文的訊息可以帶引擎細節(weekly.ts 的
 *      「讀不到 --state 指定的檔案:<path>(…)」就是這種),所以判的是**整行以引擎話開頭**。
 *   3. **跟健康輸入的輸出不同**(正規化掉路徑、日期、毫秒之後比)。這是整批的核心:
 *      `{}` 的 reviews.json 印「OK」、三筆的 reviews.json 也印「OK」,就是洞。
 *      正當的 exit 0 一樣要過這條——「沒有變更」跟「commit 了」本來就不該長一樣。
 *   4. **缺輸入時要指名那條路徑**(`mention`),使用者才拿得去 ls。
 *
 * 清單(ROSTER)在 zero-input-roster.ts，而**磁碟上每一個 `scripts/*.ts` 與
 * `packages/core/src/**\/cli.ts` 都必須在清單裡**——沒進清單就紅。不是入口的檔案
 * (`_env.ts` 這種 side-effect 模組、被別的入口包起來的 library、真的沒辦法便宜地探的
 * `mutate.ts`)也要列,標上種類跟理由。這條的反向驗證見 describe('清單完整性')。
 *
 * P-50 的形狀(讀 state/ config/ 之後直接 cast,不驗 schema)在這裡的 `wrong-type`
 * 探針裡:合法 JSON 但型別不符(`[]` 當 `{}` 用、`5` 當物件用)→ 不可以捏造出一個
 * 「正常」的結果。那張工單修 `readJson<T>` 的簽章;這裡的探針會自動擋住之後新增的 cast。
 *
 * 測法:一律臨時目錄(CLAUDE.md 硬規則 2:不碰 raw/ 與使用者的 learning/)。所有子行程
 * 在 beforeAll 用小型工作池一起跑完(單獨 spawnSync 一百多次要好幾分鐘),測試本身只讀結果。
 *
 * **棘輪基準(ADR-045)**:第一次跑出 89 個紅燈,全部是既有入口的洞。直接合併會讓 main 紅、
 * 擋掉所有後續合併;整檔 `.skip` 又是「看起來有守其實沒守」。所以既有的洞記在
 * `scripts/zero-input-guard.baseline.json`,三道鎖:
 *
 *   鎖 1 · 不在基準裡的探針**必須過**——新入口、新探針立刻受保護。
 *   鎖 2 · 在基準裡的探針**必須仍然紅**——變綠就 FAIL,訊息說「已修好,從基準移除」。
 *          基準不准靜默腐爛,每一次收緊都是一個明確的 commit。
 *   鎖 3 · 基準**只准減不准增**——條數 ≤ 檔內寫死的 `max`,每還一批就把 `max` 改小。
 *
 * 見 describe('棘輪基準')。
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KINDS, ROSTER, SCHEMA_CLI, type Builder, type Command, type Invocation } from './zero-input-roster.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const TSX_CLI = join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const MINIMAL = join(REPO_ROOT, 'contracts/fixtures/learning-minimal');
const FIXTURES = join(REPO_ROOT, 'contracts/fixtures');
const SCRATCH_PREFIX = 'lc-zig-';

/** 一個子行程的上限。tsx 冷啟動一到三秒,phase-coverage 真跑 cucumber dry-run 要十幾秒。 */
const SPAWN_TIMEOUT_MS = 90_000;
/** 全部跑完的上限(beforeAll)。 */
const SUITE_TIMEOUT_MS = 600_000;
/** 同時開幾個子行程。 */
const POOL_SIZE = 8;

// ───────────────────────────────────────────────────────────────── 裸 stack / 裸引擎訊息的判準

/**
 * 每一條附理由(ADR-045)。判的是**整行開頭**或**stack frame 的形狀**,不判「包含」:
 * weekly.ts 的「讀不到 --state 指定的檔案:<path>(Unexpected end of JSON input)」包了前後文,
 * 可以;grade.ts 直接 console.error(err.message) 印出來的
 * 「Cannot read properties of null (reading 'fill')」整行就是引擎話,不行。
 *
 * 這組 regex 自己也要有人守:見 describe('判準本身') 餵捏造的 stack 的那一條。
 */
const BARE_PATTERNS: readonly { re: RegExp; why: string }[] = [
  {
    re: /^\s+at\s+(?:\S.*\s\()?(?:file:\/\/|node:|\/)[^\n]*:\d+:\d+\)?\s*$/m,
    why: 'Node 的 stack frame,位置是絕對路徑、file:// 或 node: 開頭:`    at foo (/x/y.ts:12:3)`、`    at file:///x/y.ts:12:3`、`    at node:internal/…:1:1`',
  },
  {
    re: /^\s+at .+\(.+:\d+:\d+\)/m,
    why: '任何形狀的 stack frame「at 名字 (位置:行:列)」,出現在任何一行都算——位置被相對化、打包過、或不是 / 開頭的也抓得到(顧問補的第一條)',
  },
  {
    re: /^\s*(?:TypeError|SyntaxError|ReferenceError|RangeError|ZodError|Error)\b/m,
    why: '行首是 JS 錯誤類別名(`TypeError: …`、`Error: …`):把 Error 物件整個丟給 console.error 的痕跡,使用者看到的是類別名不是發生了什麼(顧問補的第二條)',
  },
  {
    re: /^\s*E[A-Z]{3,}:/m,
    why: '行首是 libuv 錯誤碼(`ENOENT:`、`EACCES:`、`EISDIR:`、`ENOTDIR:`):fs 的 err.message 原樣吐出,沒說是哪個參數指到的檔(顧問補的第二條)',
  },
  { re: /^\s*Cannot read propert/m, why: 'V8 對 null/undefined 取屬性的話:讀了不存在的欄位還沒驗 schema 就用' },
  { re: /^\s*Cannot convert undefined or null/m, why: 'V8 對 null/undefined 做 Object.keys / 展開的話:同上,型別沒驗' },
  { re: /^\s*Unexpected token/m, why: 'JSON.parse / 語法錯誤的引擎話:壞 JSON 沒包成「哪個檔壞了」' },
  { re: /^\s*Unexpected end of JSON/m, why: 'JSON.parse 對空檔或截斷檔的引擎話:同上' },
  { re: /^\s*Unexpected non-whitespace/m, why: 'JSON.parse 對「合法 JSON 後面還有東西」的引擎話:同上' },
  { re: /^\s*\S.* is not a function/m, why: 'V8 對型別不符的呼叫:`[]` 當 `{}` 用、`5` 當物件用的下場' },
  { re: /^\s*\S.* is not iterable/m, why: 'V8 對型別不符的迭代:同上' },
  { re: /^\s*\S.* is not defined/m, why: 'ReferenceError 的訊息本體:程式自己壞了,更不該原樣給使用者' },
  { re: /^\s*\[object Object\]/m, why: '把物件當字串印:訊息根本沒組好' },
  { re: /^\s*✖ /m, why: 'zod v4 prettifyError 的開頭:schema 錯誤原樣吐出,沒說是哪個檔' },
  { re: /^\s*undefined$/m, why: '整行只有 undefined:console.error(err.message) 但 err 不是 Error' },
  { re: /^\s*null$/m, why: '整行只有 null:同上' },
  { re: /^\s*NaN$/m, why: '整行只有 NaN:數字沒驗就算' },
];

/** 回傳命中的那一行(給訊息用),沒命中回 null。 */
export function bareEngineSpeak(output: string): string | null {
  for (const { re } of BARE_PATTERNS) {
    const m = re.exec(output);
    if (m) return `裸 stack / 裸引擎訊息:${m[0].trim()}`;
  }
  return null;
}

// ───────────────────────────────────────────────────────────────── 棘輪基準(ADR-045)

const BASELINE_PATH = join(REPO_ROOT, 'scripts/zero-input-guard.baseline.json');

/** 五種類別,對應底下每個探針的五種檢查。 */
const CATEGORIES = ['裸stack', '退出碼', '同healthy', '同quiet', '沒指名路徑'] as const;
type Category = (typeof CATEGORIES)[number];

interface BaselineEntry {
  /** `${file} · ${label}`,跟 describe 的標題一樣。 */
  command: string;
  /** 探針的 name。 */
  probe: string;
  category: Category;
  /** 記進基準的日期,YYYY-MM-DD。 */
  since: string;
  reason: string;
}

interface BaselineFile {
  /** 鎖 3:條數 ≤ 這個數;每還一批就把它改小。 */
  max: number;
  /** `excluded` 是「不適用」的類別判斷,不是待辦事項;數量只能減不能增。 */
  excludedMax: number;
  entries: BaselineEntry[];
}

export function loadBaseline(path: string): BaselineFile {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${path}:頂層要是物件`);
  const { max, excludedMax, entries } = raw as Record<string, unknown>;
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 0) throw new Error(`${path}:max 要是非負整數`);
  if (typeof excludedMax !== 'number' || !Number.isInteger(excludedMax) || excludedMax < 0) throw new Error(`${path}:excludedMax 要是非負整數`);
  if (!Array.isArray(entries)) throw new Error(`${path}:entries 要是陣列`);
  return { max, excludedMax, entries: entries as BaselineEntry[] };
}

export const baselineKey = (command: string, probe: string, category: Category): string => `${command} :: ${probe} :: ${category}`;

const BASELINE = loadBaseline(BASELINE_PATH);
const BASELINED = new Map<string, BaselineEntry>(BASELINE.entries.map((e) => [baselineKey(e.command, e.probe, e.category), e]));
/** 跑過的基準 key;最後一個 describe 用它抓「基準裡有、探針裡沒有」的死條目。 */
const consumedBaseline = new Set<string>();

/** 鎖 2 的訊息,反向驗證會 grep 它。 */
export const FIXED_MESSAGE = '已修好,從基準移除';

/**
 * 鎖 1 + 鎖 2。不在基準裡:照常檢查。在基準裡:檢查**必須仍然失敗**,變綠就 FAIL。
 * 回傳值給標題用,不影響判斷。
 */
export function ratchet(key: string, check: () => void): void {
  const entry = BASELINED.get(key);
  if (!entry) {
    check();
    return;
  }
  consumedBaseline.add(key);
  let stillRed = false;
  try {
    check();
  } catch {
    stillRed = true;
  }
  expect(
    stillRed,
    `${FIXED_MESSAGE}:${key}\n(since ${entry.since}:${entry.reason})\n` +
      `這一條已經通過了。把它從 ${relative(REPO_ROOT, BASELINE_PATH)} 拿掉,並把 max 改小,讓收緊變成一個明確的 commit。`,
  ).toBe(true);
}

/** 標題後綴:在基準裡的測試一眼看得出「預期仍紅」。 */
function ratchetTag(key: string): string {
  const e = BASELINED.get(key);
  return e ? ` 〔基準 since ${e.since},預期仍紅〕` : '';
}

// ───────────────────────────────────────────────────────────────── 磁碟上的入口

/** 這兩條規則就是「哪些檔案必須在清單裡」。改這裡等於改守門範圍,要有理由。 */
export function entryFilesOnDisk(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, 'scripts'))) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    out.push(`scripts/${name}`);
  }
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'cli.ts') out.push(relative(root, full).split('\\').join('/'));
    }
  };
  walk(join(root, 'packages/core/src'));
  return out.sort();
}

/** 純函式,給反向驗證用:磁碟上有、清單裡沒有的檔案。 */
export function missingFromRoster(onDisk: readonly string[], rosterKeys: readonly string[]): string[] {
  const listed = new Set(rosterKeys);
  return onDisk.filter((f) => !listed.has(f));
}

// ───────────────────────────────────────────────────────────────── 執行

interface RunResult {
  code: number;
  output: string;
  scratch: string;
  timedOut: boolean;
  /** build 時算出來的「輸出裡必須出現的字串」,執行後不再重建 fixture。 */
  mention?: string;
}

function withoutNodeOptions(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _dropped, ...rest } = env;
  return rest;
}

function runEntry(entryFile: string, inv: Invocation, scratch: string): Promise<RunResult> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [TSX_CLI, join(REPO_ROOT, entryFile), ...inv.args], {
      cwd: inv.cwd ?? REPO_ROOT,
      env: { ...withoutNodeOptions(process.env), ...inv.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stdin.end();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, SPAWN_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      done({ code: -1, output: `${out}\n(spawn error) ${String(err)}`, scratch, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code: code ?? -1, output: out, scratch, timedOut });
    });
  });
}

async function pool<T>(jobs: readonly (() => Promise<T>)[], size: number): Promise<T[]> {
  const results: T[] = new Array<T>(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const job = jobs[i];
      if (!job) return;
      results[i] = await job();
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
  return results;
}

const scratchDirs: string[] = [];
function newScratch(): string {
  const d = mkdtempSync(join(tmpdir(), SCRATCH_PREFIX));
  scratchDirs.push(d);
  return d;
}

/** key = `${file}::${label}::${probe|baseline}` */
const results = new Map<string, RunResult>();
const resultKey = (file: string, label: string, name: string): string => `${file}::${label}::${name}`;

function getResult(file: string, label: string, name: string): RunResult {
  const r = results.get(resultKey(file, label, name));
  if (!r) throw new Error(`沒有這一筆的執行結果(beforeAll 沒跑到?):${resultKey(file, label, name)}`);
  if (r.timedOut) throw new Error(`子行程逾時 ${SPAWN_TIMEOUT_MS} ms:${resultKey(file, label, name)}\n${r.output}`);
  return r;
}

const entryCommands = (): { file: string; command: Command }[] =>
  Object.entries(ROSTER).flatMap(([file, entry]) => (entry.kind === 'entry' ? entry.commands.map((command) => ({ file, command })) : []));

function assertExcludedCount(count: number, max: number): void {
  expect(
    count,
    `excluded 有 ${count} 筆,超過 max=${max}。又多一個「不適用」:請說明為什麼它真的不適用;` +
      '若只是尚未補探針,應改成 entry 並補齊零輸入案例。',
  ).toBeLessThanOrEqual(max);
}

beforeAll(async () => {
  const jobs: (() => Promise<void>)[] = [];
  for (const { file: entryFile, command } of entryCommands()) {
    const all: { name: string; build: Builder }[] = [
      ...Object.entries(command.baselines).map(([name, build]) => ({ name: `baseline:${name}`, build })),
      ...command.probes.map((p) => ({ name: `probe:${p.name}`, build: p.build })),
    ];
    for (const { name, build } of all) {
      jobs.push(async () => {
        const scratch = newScratch();
        const inv = build(scratch);
        const r = await runEntry(entryFile, inv, scratch);
        results.set(resultKey(entryFile, command.label, name), inv.mention === undefined ? r : { ...r, mention: inv.mention });
      });
    }
  }
  await pool(jobs, POOL_SIZE);
}, SUITE_TIMEOUT_MS);

afterAll(() => {
  for (const d of scratchDirs) rmSync(d, { recursive: true, force: true });
});

// ───────────────────────────────────────────────────────────────── 正規化

const SCRATCH_RE = new RegExp(join(tmpdir(), SCRATCH_PREFIX).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^/\\s"\'()]+', 'g');
const ROOT_RE = new RegExp(REPO_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

/** 路徑、日期、毫秒都不算差異——差異要出在「說了什麼」。 */
export function normalize(output: string): string {
  return output
    .replace(SCRATCH_RE, '<SCRATCH>')
    .replace(ROOT_RE, '<ROOT>')
    .replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/g, '<DATE>')
    .replace(/\d{4}-W\d{2}/g, '<WEEK>')
    .replace(/\(\d+ ms\)/g, '(<N> ms)')
    .trim();
}

function describeRun(r: RunResult): string {
  return `exit=${r.code}\n--- output ---\n${r.output.trim() || '(沒有輸出)'}\n--------------`;
}

// ───────────────────────────────────────────────────────────────── 測試

describe('清單完整性:磁碟上每一個入口都要在 ROSTER 裡', () => {
  const onDisk = entryFilesOnDisk(REPO_ROOT);
  const keys = Object.keys(ROSTER);

  it('掃描器本身要掃得到東西(0 個入口就是掃描器壞了,不是很乾淨)', () => {
    expect(onDisk.length).toBeGreaterThan(10);
    expect(onDisk).toContain('scripts/lint.ts');
    expect(onDisk).toContain(SCHEMA_CLI);
  });

  it('新增一個 scripts/*.ts 或 packages/core/src/**/cli.ts 卻沒進清單 → 紅', () => {
    const missing = missingFromRoster(onDisk, keys);
    expect(missing, `這些入口不在 ROSTER 裡,補進去(是入口就加探針;不是入口就標 helper/library/excluded 並寫理由):\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('清單裡的檔案都還在磁碟上(刪了入口就把它從清單拿掉)', () => {
    const gone = keys.filter((k) => !onDisk.includes(k));
    expect(gone, `ROSTER 指到已經不存在的檔案:${gone.join(', ')}`).toEqual([]);
  });

  it('反向驗證(純函式):多一個 scripts/_probe.ts 就會被抓出來', () => {
    // 用合成的清單,不用磁碟上的——這條測的是判斷本身,不受工作樹裡剛好有什麼影響。
    expect(missingFromRoster(['scripts/lint.ts', 'scripts/_probe.ts'], keys)).toEqual(['scripts/_probe.ts']);
    expect(missingFromRoster([SCHEMA_CLI, 'packages/core/src/newthing/cli.ts'], keys)).toEqual(['packages/core/src/newthing/cli.ts']);
    expect(missingFromRoster(['scripts/lint.ts', SCHEMA_CLI], keys)).toEqual([]);
  });

  it('不是入口的檔案要有理由;library 的 via 要指到清單裡的一個入口', () => {
    for (const [file, entry] of Object.entries(ROSTER)) {
      if (entry.kind === 'entry') continue;
      expect(entry.reason.trim().length, `${file} 的理由是空的`).toBeGreaterThan(10);
      if (entry.kind === 'library') {
        const target = ROSTER[entry.via];
        expect(target?.kind, `${file} 的 via 指到 ${entry.via},那不是清單裡的入口`).toBe('entry');
      }
    }
  });

  it('excluded 筆數 ≤ excludedMax;「不適用」只能減不能增', () => {
    const excluded = Object.values(ROSTER).filter((entry) => entry.kind === 'excluded');
    assertExcludedCount(excluded.length, BASELINE.excludedMax);
  });

  it('反向驗證:故意多加一筆 excluded → 紅,訊息要求說明為什麼又多一個「不適用」', () => {
    const excluded = Object.values(ROSTER).filter((entry) => entry.kind === 'excluded');
    expect(() => assertExcludedCount(excluded.length + 1, excluded.length)).toThrow('又多一個「不適用」');
  });

  it('每個命令四種輸入形狀都要有探針,略過的要寫理由;legitZero 要有理由', () => {
    for (const { file, command } of entryCommands()) {
      for (const kind of KINDS) {
        const has = command.probes.some((p) => p.kind === kind);
        const omitted = command.omit?.[kind];
        expect(has || Boolean(omitted), `${file} ${command.label}:沒有 ${kind} 的探針,也沒有在 omit 寫理由`).toBe(true);
        expect(has && Boolean(omitted), `${file} ${command.label}:${kind} 既有探針又寫了 omit,二選一`).toBe(false);
      }
      for (const p of command.probes) {
        if ('legitZero' in p && p.legitZero !== undefined) {
          expect(p.legitZero.trim().length, `${file} ${command.label} ${p.name}:legitZero 的理由太短`).toBeGreaterThan(10);
        }
        for (const b of p.against ?? []) {
          expect(Object.keys(command.baselines), `${file} ${command.label} ${p.name}:against 指到不存在的基線 ${b}`).toContain(b);
        }
      }
      if (Object.keys(command.baselines).length === 0) {
        expect(command.noBaseline?.trim().length ?? 0, `${file} ${command.label}:沒有基線要寫理由`).toBeGreaterThan(10);
      } else {
        expect(command.baselines.healthy, `${file} ${command.label}:基線一定要有 healthy`).toBeDefined();
        expect(command.noBaseline, `${file} ${command.label}:有基線就不該寫 noBaseline`).toBeUndefined();
      }
    }
  });
});

describe('判準本身', () => {
  it('每一條 regex 都有理由', () => {
    expect(BARE_PATTERNS.length).toBeGreaterThan(10);
    for (const { re, why } of BARE_PATTERNS) {
      expect(why.trim().length, `${re} 的理由太短`).toBeGreaterThan(10);
      expect(re.flags, `${re} 要有 m 旗標,不然「行首」只會看整段輸出的第一行`).toContain('m');
    }
  });

  it('反向驗證:捏造的 stack 一定要被判成裸 stack(沒有這條,那組 regex 自己就沒人守)', () => {
    // 完整的 Node 未捕捉例外長相:引擎話一行 + 好幾個 frame。
    const fabricated = [
      '/x/y/z.ts:12',
      '  throw new Error("boom");',
      '        ^',
      '',
      'Error: boom',
      '    at main (/x/y/z.ts:12:9)',
      '    at ModuleJob.run (node:internal/modules/esm/module_job:274:25)',
      '',
      'Node.js v22.15.1',
    ].join('\n');
    expect(bareEngineSpeak(fabricated)).not.toBeNull();

    // 只有 frame、沒有引擎話那一行(有人只印了 err.stack 的尾巴):也要抓到。
    expect(bareEngineSpeak('讀檔失敗\n    at readState (/x/due.ts:25:22)\n    at main (/x/due.ts:40:3)')).not.toBeNull();

    // 位置不是 / 開頭(相對路徑、打包過的名字):顧問補的那一條要抓到。
    expect(bareEngineSpeak('讀檔失敗\n    at readState (src/due.ts:25:22)')).not.toBeNull();
    expect(bareEngineSpeak('讀檔失敗\n    at Object.<anonymous> (webpack:///./due.ts:25:22)')).not.toBeNull();

    // 行首是錯誤類別名 / libuv 錯誤碼:顧問補的那一條要抓到。
    for (const line of ['TypeError: x is not a function', 'ReferenceError: y is not defined', 'RangeError: Invalid array length', 'Error: boom', "ENOENT: no such file or directory, open '/x/q.yaml'", "EACCES: permission denied, open '/x/q.yaml'"]) {
      expect(bareEngineSpeak(`前面一行是正常的\n${line}`), line).not.toBeNull();
    }
  });

  it('抓得到 stack frame 與裸引擎訊息', () => {
    expect(bareEngineSpeak("SyntaxError: Unexpected end of JSON input\n    at JSON.parse (<anonymous>)\n    at file:///x/due.ts:25:22")).not.toBeNull();
    expect(bareEngineSpeak("Cannot read properties of null (reading 'fill')")).not.toBeNull();
    expect(bareEngineSpeak("ENOENT: no such file or directory, open '/x/q.yaml'")).not.toBeNull();
    expect(bareEngineSpeak('✖ Invalid input: expected object, received array')).not.toBeNull();
  });

  it('包了前後文的訊息不算裸的', () => {
    expect(bareEngineSpeak('讀不到 --state 指定的檔案:/x/w.json(Unexpected end of JSON input)')).toBeNull();
    expect(bareEngineSpeak('✗ lint: --dir 指到的目錄不存在:/x/nope\n不會幫你建出來')).toBeNull();
    expect(bareEngineSpeak('FAIL\n  - fill: expected array, received string')).toBeNull();
    // 「at」出現在句子裡但不是 frame 的形狀:不算。
    expect(bareEngineSpeak('  at most 10 cards per day (see config/settings.yaml)')).toBeNull();
    // 錯誤碼包在句子裡、不在行首:不算。
    expect(bareEngineSpeak('讀不到 /x/q.yaml(ENOENT: no such file or directory)')).toBeNull();
  });

  it('正規化後,只差路徑與日期的兩段輸出算相同', () => {
    const a = `report written to ${join(tmpdir(), `${SCRATCH_PREFIX}abc`)}/state/lint-report-2026-09-05.md`;
    const b = `report written to ${join(tmpdir(), `${SCRATCH_PREFIX}xyz`)}/state/lint-report-2026-09-06.md`;
    expect(normalize(a)).toBe(normalize(b));
    expect(normalize('3 張卡')).not.toBe(normalize('0 張卡'));
  });
});

for (const { file, command } of entryCommands()) {
  const commandName = `${file} · ${command.label}`;
  describe(commandName, () => {
    const baselineNames = Object.keys(command.baselines);

    for (const name of baselineNames) {
      it(`基線 ${name}:exit 0、沒有裸錯誤(基線本身壞了,底下的比較就沒有意義)`, () => {
        const r = getResult(file, command.label, `baseline:${name}`);
        expect(r.code, describeRun(r)).toBe(0);
        expect(bareEngineSpeak(r.output), describeRun(r)).toBeNull();
      });
    }

    for (const probe of command.probes) {
      const legit = 'legitZero' in probe ? probe.legitZero : undefined;
      const title = `[${probe.kind}] ${probe.name}`;
      const get = (): RunResult => getResult(file, command.label, `probe:${probe.name}`);
      const key = (category: Category): string => baselineKey(commandName, probe.name, category);

      if (legit) {
        it(`${title}:正當的 exit 0(${legit})${ratchetTag(key('退出碼'))}`, () => {
          const r = get();
          ratchet(key('退出碼'), () => expect(r.code, describeRun(r)).toBe(0));
        });
      } else {
        it(`${title}:退出碼非 0${ratchetTag(key('退出碼'))}`, () => {
          const r = get();
          ratchet(key('退出碼'), () => expect(r.code, describeRun(r)).not.toBe(0));
        });
      }

      it(`${title}:不噴裸 stack trace、不吐裸引擎訊息${ratchetTag(key('裸stack'))}`, () => {
        const r = get();
        ratchet(key('裸stack'), () => expect(bareEngineSpeak(r.output), describeRun(r)).toBeNull());
      });

      const against = probe.against ?? (baselineNames.length ? ['healthy'] : []);
      for (const baseline of against) {
        const category = `同${baseline}` as Category;
        const card = probe.cardinality?.against === baseline ? probe.cardinality.re : undefined;
        const suffix = card ? `,而且兩邊都要印基數(${card})` : '';
        it(`${title}:輸出跟基線 ${baseline} 不可以長一樣${suffix}${ratchetTag(key(category))}`, () => {
          const r = get();
          const b = getResult(file, command.label, `baseline:${baseline}`);
          ratchet(key(category), () => {
            const same = r.code === b.code && normalize(r.output) === normalize(b.output);
            expect(same, `空的跟健康的長一樣。\n[探針] ${describeRun(r)}\n[基線 ${baseline}] ${describeRun(b)}`).toBe(false);
            if (card) {
              expect(r.output, `探針的輸出沒印基數 ${card}\n${describeRun(r)}`).toMatch(card);
              expect(b.output, `基線 ${baseline} 的輸出沒印基數 ${card}\n${describeRun(b)}`).toMatch(card);
            }
          });
        });
      }

      it(`${title}:指名有問題的那條路徑${ratchetTag(key('沒指名路徑'))}`, (ctx) => {
        const r = get();
        if (r.mention === undefined) ctx.skip();
        const mention = r.mention;
        ratchet(key('沒指名路徑'), () => expect(r.output, `輸出裡沒有 ${mention}\n${describeRun(r)}`).toContain(mention));
      });
    }
  });
}

describe('棘輪基準(ADR-045):三道鎖', () => {
  const commandNames = new Set(entryCommands().map(({ file, command }) => `${file} · ${command.label}`));
  const probeNames = new Map<string, Set<string>>();
  for (const { file, command } of entryCommands()) {
    probeNames.set(`${file} · ${command.label}`, new Set(command.probes.map((p) => p.name)));
  }

  it('鎖 3:條數 ≤ max;基準只准減不准增,任何新增條目都紅', () => {
    expect(
      BASELINE.entries.length,
      `基準有 ${BASELINE.entries.length} 條,超過 max=${BASELINE.max}。基準只准減不准增:新的洞要當場修,不可以記進基準。`,
    ).toBeLessThanOrEqual(BASELINE.max);
  });

  it('每一條都有五個欄位,category 五選一,since 是日期,reason 不是空的', () => {
    for (const e of BASELINE.entries) {
      const where = `${e.command} :: ${e.probe} :: ${e.category}`;
      expect(typeof e.command, where).toBe('string');
      expect(typeof e.probe, where).toBe('string');
      expect(CATEGORIES, where).toContain(e.category);
      expect(e.since, where).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.reason.trim().length, where).toBeGreaterThan(0);
    }
  });

  it('沒有重複條目', () => {
    const seen = new Set<string>();
    const dup: string[] = [];
    for (const e of BASELINE.entries) {
      const k = baselineKey(e.command, e.probe, e.category);
      if (seen.has(k)) dup.push(k);
      seen.add(k);
    }
    expect(dup, `重複的基準條目:\n  ${dup.join('\n  ')}`).toEqual([]);
  });

  it('每一條都指到清單裡真的存在的命令與探針(探針改名或刪掉,就把基準那條一起拿掉)', () => {
    const dead: string[] = [];
    for (const e of BASELINE.entries) {
      if (!commandNames.has(e.command) || !probeNames.get(e.command)?.has(e.probe)) dead.push(baselineKey(e.command, e.probe, e.category));
    }
    expect(dead, `基準指到不存在的命令或探針:\n  ${dead.join('\n  ')}`).toEqual([]);
  });

  it('每一條都被某個檢查用到(同一個檔案裡的探針測試跑在這條之前)', () => {
    // 「指名路徑」只有 build 出 mention 的探針才會有那條檢查;沒有的話那條基準等於死條目。
    const unused = BASELINE.entries.map((e) => baselineKey(e.command, e.probe, e.category)).filter((k) => !consumedBaseline.has(k));
    expect(unused, `基準裡有、但沒有任何檢查用到的條目(那個探針沒有這種檢查):\n  ${unused.join('\n  ')}`).toEqual([]);
  });

  it('反向驗證(純函式):不在基準裡的檢查照常判;在基準裡的檢查變綠就 FAIL、訊息帶「已修好」', () => {
    const fail = (): void => { throw new Error('紅'); };
    const pass = (): void => {};
    const notListed = baselineKey('scripts/_nope.ts · nope', 'nope', '退出碼');
    expect(() => ratchet(notListed, pass)).not.toThrow();
    expect(() => ratchet(notListed, fail)).toThrow('紅');

    const listed = BASELINE.entries[0];
    expect(listed, '這條反向驗證要有至少一條基準才有東西可以驗;基準清空之後就把它改成合成的 Map').toBeDefined();
    if (!listed) return;
    const k = baselineKey(listed.command, listed.probe, listed.category);
    expect(() => ratchet(k, fail)).not.toThrow();
    expect(() => ratchet(k, pass)).toThrow(FIXED_MESSAGE);
  });
});
