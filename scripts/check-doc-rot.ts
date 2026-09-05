// SOURCE: template v1.4.1 (ff7f64b) sha256=886089a1ef7cbaf8c36139352042be9b6a9a613114c12bbf63d3c6ba20fdfcd4 — 勿手改;升版用 sync-gates.sh
/**
 * 文件腐爛黑名單掃描(S7,來源 nightmare-assault;模板 1.4.1 S13 補上 report 模式、
 * 自我測試與事故記錄檔的預設排除,同樣來源 nightmare-assault:他們自己的第一版
 * doc-rot 掃出 310 筆、收斂到 34 筆全部是假警報,見下方「report 模式」段落)。
 *
 * 背景:有些字串是「已知會過時、已知會出事,不管出現在哪裡都算壞」——一個寫死的顧問
 * session 名字(換了顧問或換了專案編號就是假的)、一個繞過鎖的指令(有人抄了範例
 * 直接貼進腳本,鎖就形同虛設)、一個把具體數字寫死進固定量詞的措辭(核心項目數量
 * 改了,文字沒跟著改,講的話就是錯的)。這些不是「連結斷了」(check-doc-links.ts 管的)
 * 也不是「場景重複」(check-gherkin-dup.ts 管的),是「內容本身已知有毒」——`doc-rot`
 * 是一份黑名單(regex),命中就報,不管命中的檔案是什麼類型。
 *
 * `doc-rot.blacklist.json` 的 schema(陣列,每一筆都要有下面四個必填欄位,**都不能是
 * 空字串**;`note` 選填,記錄「為什麼這條規則收斂成這個樣子」——nightmare 的教訓是
 * 「每一條收斂都要留下理由」,不留理由的收斂下次沒人知道能不能再收窄):
 *   [{ "pattern": "<regex>", "reason": "...", "since": "YYYY-MM-DD", "incident": "P-59",
 *      "note": "選填,收斂這條規則時的判斷依據" }]
 * 陣列裡帶 `_doc` 鍵的項目是 metadata,不算條目(跟 `check-known-defects.ts` 的
 * `known-defects.json` 同一個慣例)。一筆格式壞掉(缺欄位、欄位是空字串、`pattern`
 * 不是合法正規表達式、出現不認識的欄位)就讓整個 gate 失敗(S9 的設定壞掉大聲失敗原則
 * ——不是「這一筆跳過,其他照跑」,壞掉的黑名單本身就不可信)。
 *
 * 掃描範圍:consumer 根目錄底下,副檔名屬於 `SCAN_EXTS`(md、txt、json、yaml、yml、toml、
 * sh、ts、js、py、feature、svelte、rs、html、css)的檔案,套用共用略過清單(S10,
 * `_root.ts` 的 `DEFAULT_SKIP_DIRS` + `gates.config.json` 的 `skipDirs`)。**排除**
 * (S13 (a),`DEFAULT_EXCLUDE_GLOBS`,`gates.config.json` 的 `docRot.exclude` 在後面追加,
 * 不取代):
 *   1. `docs/02-decision-map.md`、`docs/adr/**` ——決策記錄合理地會逐字引用那個過時/
 *      危險的東西(「我們決定不要再用 X」本來就要寫出 X 是什麼),不該被自己記錄的決策
 *      打自己的臉。
 *   2. `**​/PITFALLS.md`、`**​/CHANGELOG.md` ——這兩份是事故日誌,合理地會逐字引用
 *      「曾經出過的問題長什麼樣子」(例如這份檔案自己就在講「寫死的顧問 session 名字」
 *      這件事,黑名單規則的 `reason` 欄本身就會命中自己描述的模式)。
 *   3. 黑名單設定檔自己(`doc-rot.blacklist.json`)——它的內容就是這些危險字串的
 *      literal pattern,不排除的話會自我命中。
 *
 * 任何一行命中任何一條黑名單規則 → 印
 *   `✗ <file>:<line> 命中黑名單「<pattern>」(<incident>: <reason>)`
 * 並算失敗(是否讓 exit code 也變成 1,看 `docRot.mode`,見下)。
 *
 * ## report 模式(S13 (b))
 *
 * `gates.config.json` 的 `docRot.mode`:`"report"`(**全新安裝的預設值**)| `"enforce"`。
 * `"report"` 時,命中一樣全部印出來、`gate=doc-rot result=FAIL` 標記一樣印(讓讀 log 的人
 * 看得出有問題),但 **exit 0**——給剛裝上這支 gate、還沒把既有命中清乾淨的專案一個
 * 「先看得到問題、不立刻擋住其他工作」的過渡期,跟 `check-next-gates.ts` 的
 * `nextGates.mode` 是同一個套路。`"enforce"` 時命中一律 exit 1。動機(nightmare-assault
 * 的第一版 doc-rot,同一份規則從 310 筆掃到 266、67、45,最後收斂到 34 筆——每一次
 * 都是「叫狼」,全部是假警報,不是真的文件腐爛)見 PITFALLS P-71:一支新守門第一版
 * 幾乎必然會抓到規則設計沒想到的合理例外,default enforce 只會逼專案在還沒摸清規則
 * 之前就被擋;`mode` 不影響「0 條黑名單規則」或「掃到 0 個檔案」這兩個 0 目標守衛——
 * 那兩個永遠 exit 1,跟其餘掃描器同一個道理。
 *
 * `docRot.exclude`(字串陣列,glob):追加在 `DEFAULT_EXCLUDE_GLOBS` 之後(不取代)。
 * glob 語法只支援這裡實際用得到的兩種形狀:`**​/X`(X 在任何深度,含根目錄本身)、
 * `X/**`(X 目錄底下任何檔案,不含 X 自己)、以及沒有萬用字元的完整路徑字面比對。
 *
 * ## --self-test(S13 (c))
 *
 * `npx tsx check-doc-rot.ts --self-test`:對**現在讀到的那份黑名單**,替每一條規則合成
 * 一個會命中它自己的探針字串(`synthesizeProbe`,處理常見的 `\d` `\w` `\s` 與逃脫字元;
 * 合成不出來的規則會被誠實地報成「沒命中」,不會假裝成功),寫進一個臨時目錄裡的單一
 * 檔案,只對那個臨時目錄跑一次掃描,要求命中數 = 規則數。任何一條規則的探針沒命中自己
 * → `✗ self-test:黑名單第 k 條「pattern」對自己的探針沒命中` 並 exit 1。
 * 這是 nightmare 的教訓(PITFALLS P-68/P-71):「0 個命中」可能是「真的乾淨」,也可能是
 * 「規則本身壞了、探不到任何東西」,兩者長得一模一樣——`--self-test` 讓「規則本身有效」
 * 這件事變成一個可以獨立驗證、不依賴真的文件內容的量測,而不是憑感覺相信。
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析,不在 git repo 裡則退回 cwd;
 * `--root <dir>` 明講的話優先):
 *   npx tsx scripts/check-doc-rot.ts
 *   npx tsx <template>/scripts/check-doc-rot.ts --root <dir>
 *   npx tsx scripts/check-doc-rot.ts --self-test
 *
 * 退出碼:0 沒有命中,或有命中但 `docRot.mode` 是 `"report"`;1 有命中且是 `"enforce"`
 * (預設是 `"report"`,見上),或黑名單是空陣列,或掃到 0 個檔案(這不是很乾淨,是掃描器
 * 壞了——跟其餘掃描器同一個道理:0 目標不是「沒事可做」),或 `--self-test` 有規則沒
 * 命中自己的探針。
 *
 * 反向驗證(改完要還原,不要留下改動):
 *   (a) 造一個臨時目錄,放一份含一條規則的 blacklist 跟一個命中該規則的 .md 檔,
 *       重跑這支腳本 → 應該紅,訊息含 file:line。
 *   (b) 同一個臨時目錄,把命中的那個字串搬進 `docs/02-decision-map.md` → 重跑 →
 *       不該被報(ADR 檔排除)。
 *   (c) `--self-test` 對出貨的黑名單跑一次 → 每條規則都命中自己的探針。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import {
  DEFAULT_SKIP_DIRS,
  ROOT as GIT_ROOT,
  loadGatesConfig,
  lookupConfig,
  readConfigJson,
  requireConfigType,
  requireKnownTopLevelKeys,
  splitSkipDirs,
} from './_root.js';

/** 這支腳本在 gate 機器可讀標記裡的名字。 */
const GATE_NAME = 'doc-rot';

/** 三支掃描器共用的那句話。0 個目標的紅,方向永遠是「掃描器壞了」。 */
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

/** 要掃描的副檔名(含點)。 */
const SCAN_EXTS = [
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.sh',
  '.ts', '.js', '.py', '.feature', '.svelte', '.rs', '.html', '.css',
];

const BLACKLIST_FILENAME = 'doc-rot.blacklist.json';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ROOT_EXPLICIT = argValue('--root') !== undefined;
const ROOT = resolve(argValue('--root') ?? GIT_ROOT);
const SELF_TEST = process.argv.includes('--self-test');

/** 印一則設定錯誤、印 gate 標記(0 目標)、exit 1——跟其餘掃描器同一套(見
 *  check-boundaries.ts 的 `configError`,每支腳本各自一份,不共用 helper 是刻意的:
 *  `sync-gates.sh` 把每支 check-*.ts 當獨立檔案複製)。 */
function configError(msg: string): never {
  console.error(`✗ ${msg}`);
  console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
  process.exit(1);
}

/**
 * 找一份設定檔——委派給 `_root.ts` 的 `lookupConfig`(S14,來源 AI_KM 2026-09-05,
 * PITFALLS P-73):`--root` 明講時只認 `GATES_CONFIG_DIR` 或 `<ROOT>/scripts/`,不退回
 * 這支腳本自己所在的目錄(那通常是模板自己的佔位設定)。每次呼叫印一行
 * 「<name>: 設定:...」(找不到印「設定:無,使用預設」)。
 */
function findConfigFile(name: string): { path: string | undefined; hardErrorMessage: string | undefined; triedPaths: string[] } {
  const result = lookupConfig(import.meta.dirname, name, { root: ROOT, rootExplicit: ROOT_EXPLICIT });
  console.log(`${name}: ${result.source}`);
  return { path: result.path, hardErrorMessage: result.hardErrorMessage, triedPaths: result.triedPaths };
}

export interface BlacklistEntry {
  pattern: string;
  reason: string;
  since: string;
  incident: string;
  /** 選填:記錄這條規則收斂/存在的判斷依據(S13 (d))——「每一條收斂都要留下理由」的紀律。 */
  note?: string;
}

/** 非空字串(trim 之後還有內容)。 */
function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

const BLACKLIST_KNOWN_FIELDS = ['pattern', 'reason', 'since', 'incident', 'note'] as const;

/**
 * 讀 `doc-rot.blacklist.json`。找不到檔案本身是設定錯誤(這份黑名單是必要設定,
 * 不是選填——沒有黑名單,這支 gate 沒有存在的意義);解析錯誤、每一筆的形狀由
 * `readConfigJson`(S9)跟這裡的欄位檢查共同把關,壞掉一律大聲失敗、不放行。
 * 陣列裡帶 `_doc` 鍵的項目是 metadata,跳過(不算條目,S13 (d),跟
 * `check-known-defects.ts` 的 `known-defects.json` 同一個慣例)。
 */
function loadBlacklist(): { entries: BlacklistEntry[]; path: string } {
  const found = findConfigFile(BLACKLIST_FILENAME);
  if (found.hardErrorMessage) configError(found.hardErrorMessage);
  const p = found.path;
  if (!p) {
    configError(
      `找不到 ${BLACKLIST_FILENAME}(搜尋過:${found.triedPaths.join('、')})。` +
        '這份黑名單是必要設定,範例見 template/scripts/doc-rot.blacklist.json。',
    );
  }
  const raw = readConfigJson(p, GATE_NAME);
  if (!Array.isArray(raw)) configError(`${p} 必須是陣列(每一項是 { pattern, reason, since, incident },或帶 "_doc" 的說明項目)`);

  const entries: BlacklistEntry[] = [];
  raw.forEach((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      configError(`${p} 第 ${i + 1} 筆不是物件:${JSON.stringify(item)}`);
    }
    const obj = item as Record<string, unknown>;
    if ('_doc' in obj) return; // metadata 項目,跳過,不算條目

    for (const field of ['pattern', 'reason', 'since', 'incident'] as const) {
      requireConfigType(obj[field], `${BLACKLIST_FILENAME}[${i}].${field}`, 'string', GATE_NAME);
      if (!nonEmptyString(obj[field])) {
        configError(`${p} 第 ${i + 1} 筆的 "${field}" 不可為空字串`);
      }
    }
    if (obj.note !== undefined) requireConfigType(obj.note, `${BLACKLIST_FILENAME}[${i}].note`, 'string', GATE_NAME);
    // S13 (d):不認識的欄位(打錯字最常見的癥狀)一律大聲失敗,跟 gates.config.json
    // 的「不認識的頂層鍵」(S9)同一套紀律。
    for (const key of Object.keys(obj)) {
      if (!(BLACKLIST_KNOWN_FIELDS as readonly string[]).includes(key)) {
        configError(
          `${p} 第 ${i + 1} 筆有不認識的欄位:${key}(打錯字?)已知欄位:${BLACKLIST_KNOWN_FIELDS.join(', ')}`,
        );
      }
    }
    const pattern = obj.pattern as string;
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern);
    } catch (e) {
      configError(`${p} 第 ${i + 1} 筆的 "pattern" 不是合法正規表達式:${pattern}(${(e as Error).message})`);
    }
    entries.push({
      pattern,
      reason: obj.reason as string,
      since: obj.since as string,
      incident: obj.incident as string,
      ...(obj.note !== undefined ? { note: obj.note as string } : {}),
    });
  });
  return { entries, path: p };
}

/** S10:共用略過清單 + `gates.config.json` 的 `skipDirs` 追加。回傳值已經拆成「單層
 *  目錄名」(逐層比對,例如 `node_modules`)跟「多層路徑前綴」(例如 `.claude/worktrees`)
 *  兩組(`_root.ts` 的 `splitSkipDirs`)——`DEFAULT_SKIP_DIRS` 裡有 `.claude/worktrees`
 *  這種帶斜線的項目,單純逐層比對目錄名永遠比不到它(`.claude` 跟 `worktrees` 是
 *  兩層,任何單一層的名字都不會剛好等於 `.claude/worktrees` 這個字串),這支腳本掃的是
 *  **整個 ROOT**(不像 boundaries/gherkin-dup 只掃固定的少數子樹),不做前綴比對的話
 *  會遞迴進 `.claude/worktrees/<其他 worktree>` 把整個 repo 重新掃一次。 */
function resolveSkipDirsForDocRot(gatesConfig: Record<string, unknown> | undefined): { segments: Set<string>; prefixes: string[] } {
  const extra = gatesConfig?.skipDirs;
  if (extra !== undefined) requireConfigType(extra, 'skipDirs', 'array', GATE_NAME);
  const extraStrings = Array.isArray(extra) ? extra.filter((s): s is string => typeof s === 'string') : [];
  return splitSkipDirs(new Set([...DEFAULT_SKIP_DIRS, ...extraStrings]));
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

/** S13 (a):把一個限定形狀的 glob(`**​/X`、`X/**`,或沒有萬用字元的完整路徑)轉成
 *  能比對 posix 相對路徑的正規表達式。不支援任意 glob 語法(例如中段的 `*`、`?`)——
 *  這裡只需要涵蓋事故日誌排除這個具體場景用得到的兩種形狀。 */
function globToRegExp(glob: string): RegExp {
  let g = glob;
  let prefixOptionalDir = false;
  if (g.startsWith('**/')) {
    prefixOptionalDir = true;
    g = g.slice(3);
  }
  let suffixAnyUnder = false;
  if (g.endsWith('/**')) {
    suffixAnyUnder = true;
    g = g.slice(0, -3);
  }
  let body = '';
  for (const c of g) {
    if (c === '*') body += '[^/]*';
    else if ('.+^${}()|[]\\'.includes(c)) body += `\\${c}`;
    else body += c;
  }
  let pattern = '^';
  if (prefixOptionalDir) pattern += '(?:.*/)?';
  pattern += body;
  if (suffixAnyUnder) pattern += '/.*';
  pattern += '$';
  return new RegExp(pattern);
}

/** S13 (a):預設排除的 glob——決策記錄與事故日誌合理地會逐字引用過時/危險的東西,
 *  不該被自己記錄的東西打自己的臉。`gates.config.json` 的 `docRot.exclude` 追加在
 *  後面,不取代。 */
const DEFAULT_EXCLUDE_GLOBS: readonly string[] = [
  'docs/02-decision-map.md',
  'docs/adr/**',
  '**/PITFALLS.md',
  '**/CHANGELOG.md',
];

function isExcludedByGlob(relPath: string, extraGlobs: readonly string[]): boolean {
  const posix = toPosix(relPath);
  return [...DEFAULT_EXCLUDE_GLOBS, ...extraGlobs].some((g) => globToRegExp(g).test(posix));
}

/** 這個相對於 ROOT 的路徑(posix)要不要整個跳過(整段子樹排除)——跟
 *  `check-doc-links.ts` 的 `isSkipped` 同一套規則:單層目錄名逐層比對 `segments`,
 *  或整段路徑以某個 `prefixes` 開頭。 */
function isSkippedPath(relPath: string, skip: { segments: Set<string>; prefixes: string[] }): boolean {
  const posix = toPosix(relPath);
  if (posix.split('/').some((seg) => skip.segments.has(seg))) return true;
  return skip.prefixes.some((prefix) => posix === prefix || posix.startsWith(`${prefix}/`));
}

function* walk(root: string, dir: string, relDir: string, skip: { segments: Set<string>; prefixes: string[] }): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    if (isSkippedPath(rel, skip)) continue;
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(root, full, rel, skip);
    else if (SCAN_EXTS.some((e) => name.endsWith(e))) yield full;
  }
}

interface Hit {
  file: string;
  line: number;
  pattern: string;
  reason: string;
  incident: string;
}

/** S13 (b):`docRot.mode`(`"report"` | `"enforce"`,預設 `"report"`)與 `docRot.exclude`
 *  (glob 陣列,追加在 `DEFAULT_EXCLUDE_GLOBS` 之後)。`gates.config.json` 的頂層鍵
 *  `docRot` 本身已經在 `_root.ts` 的 `KNOWN_GATES_CONFIG_KEYS` 裡;這裡驗它自己底下的
 *  子鍵(不認識的子鍵一樣大聲失敗,同一套 S9 紀律)。 */
interface DocRotConfig {
  mode: 'report' | 'enforce';
  excludeGlobs: string[];
}

function loadDocRotConfig(gatesConfigPath: string | undefined): DocRotConfig {
  const cfg = loadGatesConfig(gatesConfigPath, GATE_NAME);
  const docRot = cfg?.docRot;
  let mode: 'report' | 'enforce' = 'report';
  let excludeGlobs: string[] = [];
  if (docRot !== undefined) {
    if (docRot === null || typeof docRot !== 'object' || Array.isArray(docRot)) {
      configError(`${gatesConfigPath} 的 "docRot" 必須是物件`);
    }
    const obj = docRot as Record<string, unknown>;
    requireKnownTopLevelKeys(obj, ['mode', 'exclude'], `${gatesConfigPath} 的 docRot`, GATE_NAME);
    if (obj.mode !== undefined) {
      requireConfigType(obj.mode, 'docRot.mode', 'string', GATE_NAME);
      if (obj.mode !== 'report' && obj.mode !== 'enforce') {
        configError(`docRot.mode 必須是 "report" 或 "enforce"(實際:${JSON.stringify(obj.mode)})`);
      }
      mode = obj.mode as 'report' | 'enforce';
    }
    if (obj.exclude !== undefined) {
      requireConfigType(obj.exclude, 'docRot.exclude', 'array', GATE_NAME);
      excludeGlobs = (obj.exclude as unknown[]).filter((s): s is string => typeof s === 'string');
    }
  }
  return { mode, excludeGlobs };
}

/**
 * S13 (c):把一條 regex pattern「反著合成」一個會命中它自己的探針字串。只處理這個
 * 黑名單實際會用到的常見 token(`\d` `\w` `\s` 的量詞形式,以及逃脫字元);合成不出來
 * (探針自己測不過那條 regex)不是這個函式的錯——那正是 `--self-test` 存在的理由:
 * 誠實地報「這條規則的探針沒命中」,而不是假裝每條規則都測得出來。
 */
export function synthesizeProbe(pattern: string): string {
  let s = pattern;
  s = s.replace(/\\d\+/g, '57');
  s = s.replace(/\\d\*/g, '5');
  s = s.replace(/\\d/g, '5');
  s = s.replace(/\\w\+/g, 'abc');
  s = s.replace(/\\w\*/g, 'a');
  s = s.replace(/\\w/g, 'a');
  s = s.replace(/\\s\+/g, ' ');
  s = s.replace(/\\s\*/g, ' ');
  s = s.replace(/\\s/g, ' ');
  // 逃脫的規則字元(例如 \. \( \) \[ \] \{ \} \| \+ \* \? \^ \$ \\)還原成字面字元本身。
  s = s.replace(/\\([.^$|()[\]{}*+?\\])/g, '$1');
  return s;
}

/** S13 (c):`--self-test` 主體。對現在讀到的那份黑名單,替每一條規則合成探針、寫進
 *  臨時目錄的單一檔案,只對那個臨時目錄跑一次掃描,要求命中數 = 規則數。 */
function runSelfTest(): number {
  const { entries, path: blacklistPath } = loadBlacklist();
  if (entries.length === 0) {
    console.log(`self-test: ${blacklistPath} 是空陣列,沒有規則可以自我測試`);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    return 1;
  }

  const failures: string[] = [];
  const probes: { entry: BlacklistEntry; probe: string }[] = [];
  entries.forEach((entry, i) => {
    const probe = synthesizeProbe(entry.pattern);
    const re = new RegExp(entry.pattern);
    re.lastIndex = 0;
    if (!re.test(probe)) {
      failures.push(`✗ self-test:黑名單第 ${i + 1} 條「${entry.pattern}」對自己的探針沒命中(合成的探針:${JSON.stringify(probe)})`);
    } else {
      probes.push({ entry, probe });
    }
  });

  if (failures.length) {
    for (const f of failures) console.log(f);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    return 1;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'doc-rot-self-test-'));
  try {
    const probeFile = join(tmpDir, 'probes.md');
    writeFileSync(probeFile, `${probes.map((p) => p.probe).join('\n')}\n`, 'utf8');

    let hits = 0;
    const lines = readFileSync(probeFile, 'utf8').split('\n');
    for (const line of lines) {
      for (const entry of entries) {
        const re = new RegExp(entry.pattern);
        re.lastIndex = 0;
        if (re.test(line)) hits++;
      }
    }

    if (hits !== entries.length) {
      console.log(
        `✗ self-test:探針全部各自命中了自己那一條規則,但總命中數(${hits})不等於規則數(${entries.length})` +
          '——可能有探針彼此互相命中,自我測試本身不明確,需要人工檢查。',
      );
      console.log(`gate=${GATE_NAME} result=FAIL scanned=1`);
      return 1;
    }

    console.log(`✓ self-test:${entries.length} 條規則,探針全部命中自己(共 ${hits} 處命中)`);
    console.log(`gate=${GATE_NAME} result=PASS scanned=1`);
    return 0;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main(): void {
  if (SELF_TEST) {
    process.exit(runSelfTest());
  }

  const { entries, path: blacklistPath } = loadBlacklist();

  if (entries.length === 0) {
    console.log(`doc-rot: ${blacklistPath} 是空陣列`);
    console.log(`✗ ${SCANNER_BROKEN}。黑名單一條規則都沒有,不是「文件很乾淨」,是設定沒填。`);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  const gatesConfigPath = findConfigFile('gates.config.json').path;
  const docRotConfig = loadDocRotConfig(gatesConfigPath);
  const gatesConfig = loadGatesConfig(gatesConfigPath, GATE_NAME);

  const compiled = entries.map((e) => ({ ...e, re: new RegExp(e.pattern) }));
  const skipDirs = resolveSkipDirsForDocRot(gatesConfig);

  const blacklistAbs = resolve(blacklistPath);
  // 這支腳本自己的測試檔(check-doc-rot.test.ts)刻意在字串常數裡放黑名單命中的樣本
  // (例如寫死的顧問 session 名字),那是拿來當 fixture 用的文字,不是真的文件腐爛——
  // 排除掉,不然這支 gate 對著自己的測試檔案自我命中。
  const ownTestFileAbs = resolve(import.meta.dirname, 'check-doc-rot.test.ts');
  const files: string[] = [];
  for (const file of walk(ROOT, ROOT, '', skipDirs)) {
    const rel = toPosix(relative(ROOT, file));
    if (isExcludedByGlob(rel, docRotConfig.excludeGlobs)) continue;
    const fileAbs = resolve(file);
    if (fileAbs === blacklistAbs) continue;
    if (fileAbs === ownTestFileAbs) continue;
    files.push(file);
  }

  console.log(`doc-rot: ${entries.length} 條黑名單規則,掃描 ${files.length} 個檔案(docRot.mode=${docRotConfig.mode})`);

  if (files.length === 0) {
    console.log(`✗ ${SCANNER_BROKEN}。掃描範圍、副檔名清單,或略過清單壞掉時就長這樣。`);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  const hits: Hit[] = [];
  for (const file of files) {
    const rel = toPosix(relative(ROOT, file));
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const entry of compiled) {
        entry.re.lastIndex = 0;
        if (entry.re.test(line)) {
          hits.push({ file: rel, line: i + 1, pattern: entry.pattern, reason: entry.reason, incident: entry.incident });
        }
      }
    });
  }

  if (hits.length) {
    console.log(`\n✗ ${hits.length} 處命中黑名單:`);
    for (const h of hits) {
      console.log(`✗ ${h.file}:${h.line} 命中黑名單「${h.pattern}」(${h.incident}: ${h.reason})`);
    }
    console.log(`gate=${GATE_NAME} result=FAIL scanned=${files.length}`);
    if (docRotConfig.mode === 'report') {
      console.log('(docRot.mode = "report":只回報,不擋 exit code)');
      process.exit(0);
    }
    process.exit(1);
  }

  console.log('✓ 無命中');
  console.log(`gate=${GATE_NAME} result=PASS scanned=${files.length}`);
  process.exit(0);
}

main();
