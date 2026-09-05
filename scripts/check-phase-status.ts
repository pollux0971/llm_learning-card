// SOURCE: template v1.4.3 (629b609) sha256=174187aef25bd2ad4770728e1e29cced5df31f73cb0e1828e9ac86bc59f6d91e — 勿手改;升版用 sync-gates.sh
/**
 * Phase 狀態表漂移檢查(S15,來源:專案 A 協調者,2026-09-05;PITFALLS P-75)。
 *
 * 背景:`FEATURE.md` 的 Phase 表是「唯一狀態來源」(見 CLAUDE.md「目錄慣例」),但沒有任何
 * 守門在看它跟現實對不對得上——專案 A 實測 `01-data-layer/phase-4` 兩輪合併都已經場景全綠、
 * 審核 PASS 進了 main,狀態表卻連續兩輪還寫 `in-progress`,`NEXT.md` 也還列著四個「待實作」
 * 的函式,其實早就 `export function` 寫好了。這支腳本抓三種形狀的漂移,**預設 report 模式**
 * (P-71:新守門第一版必然叫狼,先讓人看見、不擋 exit code)。
 *
 * ## 三種形狀
 *
 * **形狀一:疑似已完成,狀態表未更新。** 條件同時成立:
 *   (a) 狀態表寫 `in-progress`;
 *   (b) 那個 phase 自己的 `.feature`(`features/<NN-x>/phase-N.feature`)用它自己的 tag
 *       (`@name and @phase-N`)真跑,場景 K/K 全線(沿用 `check-phase-coverage.ts` 的
 *       真跑邏輯,尊重 `gates.config.json` 的 `cucumberCwd`、`phaseCoverage.runTimeoutMs`);
 *   (c) 找得到一份審核判定檔——`features/<NN-x>/REVIEW.md`,或 `phaseStatus.reviewDirs`
 *       (預設 `["docs/reviews"]`)底下任何 `.md` 檔——內容同時**提到** `<NN-x>/phase-N`
 *       這個字串**且**帶「PASS 標記」(見下);
 *   (d) 那份判定檔已經 commit 過(`git log --oneline -1 -- <file>` 非空)。
 *   四者都成立 → 印 `○ <NN-x>/phase-N 疑似已完成:場景 K/K 綠、<review file> PASS 已合併,
 *   狀態表仍 in-progress`。
 *
 *   **PASS 標記的定義**(這支腳本認的兩種寫法,務求機械可判、不用猜語意):
 *     1. 單行:去掉行首 `#+` 標題符號與 `**` 粗體符號之後,整行符合
 *        `^(判定|Verdict)\s*[:：]\s*PASS\b`(例如「判定:PASS」「**Verdict**: PASS」)。
 *     2. 標題另起一行:某一行去掉 `#+`/`**` 之後**恰好**是「判定」或「Verdict」,而它後面
 *        第一個非空白行去掉 `**` 之後以 `PASS` 開頭(這個 repo 的 `REVIEW.md` 實際慣例是
 *        `## 判定` 換行接 `**PASS**。`,只認同一行的規則會完全比對不到,這是覆核這支腳本
 *        草稿時才發現的落差,記在這裡避免下一次重犯)。
 *     3. 或者整份檔案任何地方出現字面「審核 PASS」四個字。
 *   三選一命中就算有 PASS 標記。**已知限制**:這是機械近似,不是語意理解——判定寫法五花
 *   八門時可能漏判(漏判只會讓形狀一少報,不會誤報),不追求完美,追求「先報告、能收斂」
 *   (P-71 的紀律)。
 *
 * **形狀二:done 但場景紅。** 狀態表寫 `done`,真跑該 phase 自己的 tag 卻有 failed /
 * undefined / ambiguous,或掃到的場景數 < 表格宣稱的「已完成」語意(< 1 或 passed < scenarios)
 * → 印 `✗ <NN-x>/phase-N 狀態 done 但場景紅`。**跟 `check-phase-coverage.ts --run` 是同一件
 * 事的兩份獨立判斷**——那支腳本用 `FEATURE.md` 狀態決定「要不要真跑」,這支腳本用同一個
 * 狀態決定「紅了算不算數」,兩支腳本用不同的角度盯著同一個不變量(狀態=done ⇒ 必須綠),
 * 刻意留兩份,不是重複勞動。
 *
 * **形狀三:NEXT.md 過期。** 在 `features/<NN-x>/NEXT.md` 裡,標題含「下一輪」/「要做」/
 * 「待做」/「TODO」四個字樣任一個的段落(直到下一個同級或更高級標題為止)算「待辦區塊」;
 * 待辦區塊裡用反引號包住的識別碼(`` `name` ``,`name` 必須是合法識別碼字元:字母/底線開頭,
 * 後接字母數字底線,不含點號、括號、空白——避免把整段程式碼片段當成一個識別碼)逐一檢查
 * 兩層:
 *   (a) 這個識別碼在 repo(排除 `_root.ts` 的 `DEFAULT_SKIP_DIRS` + `gates.config.json` 的
 *       `skipDirs`)底下任何 `.ts`/`.tsx`/`.js`/`.jsx`/`.py` 檔裡,找得到
 *       `export function name` / `function name` / `const name =` / `class name` /
 *       `def name(` 這五種寫法之一的定義;
 *   (b) 那個定義之後 15 行以內,**不含**任何一個樁字樣:`not implemented`、
 *       `TODO(ADR-`、`throw new Error('TODO`、`NotImplementedError`、`pass  # TODO`
 *       (大小寫不拘,除了 `TODO(ADR-` 與 `pass  # TODO` 這兩個保留原樣)。
 *   兩層都成立(有實作、而且不是樁)→ 印 `○ NEXT.md 過期:<NN-x> 列 <name> 待實作,但
 *   <file>:<line> 已有實作`。**只有 (a) 成立但 (b) 不成立(還是個樁)→ 不報**——測試輪
 *   慣例本來就會先留一個會拋錯的樁,單看「定義存在」會在測試輪之後、開發輪之前這段
 *   期間整批誤報,不是漂移。
 *
 * ## Config(`gates.config.json` 的 `phaseStatus`,選填)
 *
 *   { "phaseStatus": { "mode": "report" | "enforce", "reviewDirs": ["docs/reviews"] } }
 *
 * `mode` 預設 `"report"`(P-71:新守門先報告不擋,見上);`reviewDirs` 預設
 * `["docs/reviews"]`,`features/<NN-x>/REVIEW.md` 永遠額外檢查、不受這個設定影響。
 * 真跑用的 `cucumberCwd` / `phaseCoverage.runTimeoutMs` 沿用 `check-phase-coverage.ts`
 * 已有的兩個鍵(這支腳本不重新發明一套,見上「形狀一」)。
 *
 * ## 測試用的執行替換
 *
 * 跟 `check-known-defects.ts` 的 `KNOWN_DEFECTS_ENUMERATE_CMD` 同一個道理:設
 * `PHASE_STATUS_RUN_CMD` 環境變數指到一個指令(shell 字串),這支腳本就用它的 stdout
 * 取代真的 `npx cucumber-js --tags <expr> --format summary`——指令可以從
 * `PHASE_STATUS_TAG_EXPR` 環境變數讀到這次呼叫的 tag 表達式,藉此對不同 phase 回不同的
 * 假輸出。輸出格式跟真的 cucumber summary 一樣:必須含 `N scenarios (詳細)`。設了這個
 * 環境變數之後,cwd 三層決定(見下)也不要求真的偵測到 cucumber 設定,退回 ROOT。
 *
 * ## cucumber 執行目錄(cwd)
 *
 * 跟 `check-phase-coverage.ts` / `check-known-defects.ts` 同一套三層決定(`--cwd` 旗標 >
 * `gates.config.json` 的 `cucumberCwd` > 自動偵測),各自維護一份(sync-gates.sh 把每支
 * check-*.ts 當獨立檔案複製,不共用 helper,除了 `_root.ts`)。
 *
 * 用法:
 *   npx tsx scripts/check-phase-status.ts
 *   npx tsx scripts/check-phase-status.ts --root <dir> --cwd <cucumber 執行目錄>
 *
 * 退出碼:report 模式(預設)——有命中也印 `result=FAIL` 但 exit 0;enforce 模式——有命中
 * exit 1。0 份 `FEATURE.md`,或掃到的 phase 表格列總數是 0(表格存在但一列都解析不出來,
 * 同樣是「這不是很乾淨,是掃描器壞了」,NA-2:0 目標不代表「都合格」),不受模式影響,
 * 一律 exit 1。`scanned=N` 是掃到的 phase 表格列總數,不是命中數。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import {
  DEFAULT_SKIP_DIRS,
  ROOT as GIT_ROOT,
  loadGatesConfig,
  lookupConfig,
  requireConfigType,
  requireRootDir,
  resolveSkipDirs,
} from './_root.js';

/** 這支腳本在 gate 機器可讀標記裡的名字。 */
const GATE_NAME = 'phase-status';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ROOT_EXPLICIT = argValue('--root') !== undefined;
const ROOT = resolve(argValue('--root') ?? GIT_ROOT);
requireRootDir(ROOT, ROOT_EXPLICIT, GATE_NAME);

function findConfigFile(name: string): { path: string | undefined; hardErrorMessage: string | undefined } {
  const result = lookupConfig(import.meta.dirname, name, { root: ROOT, rootExplicit: ROOT_EXPLICIT });
  console.log(`${name}: ${result.source}`);
  return { path: result.path, hardErrorMessage: result.hardErrorMessage };
}

/** `gates.config.json` 只找一次、只印一次「設定:...」——`loadConfig()` 跟 `main()` 都
 *  要讀同一份物件(前者拿 cucumberCwd/phaseStatus,後者拿 skipDirs),不重複找路徑。 */
let cachedGatesConfig: Record<string, unknown> | undefined;
let gatesConfigLoaded = false;
function getGatesConfig(): Record<string, unknown> | undefined {
  if (!gatesConfigLoaded) {
    const found = findConfigFile('gates.config.json');
    cachedGatesConfig = loadGatesConfig(found.path, GATE_NAME);
    gatesConfigLoaded = true;
  }
  return cachedGatesConfig;
}

// ---------------------------------------------------------------------------
// gates.config.json:phaseStatus.mode / phaseStatus.reviewDirs,以及沿用
// check-phase-coverage.ts 已有的 cucumberCwd / phaseCoverage.runTimeoutMs。
// ---------------------------------------------------------------------------

type PhaseStatusMode = 'report' | 'enforce';

interface ResolvedConfig {
  mode: PhaseStatusMode;
  reviewDirs: string[];
  cucumberCwd: string | undefined;
  runTimeoutMs: number;
}

const DEFAULT_RUN_TIMEOUT_MS = 600_000;

function loadConfig(): ResolvedConfig {
  // 這份設定對這支腳本整份都是選填的(找不到就用全部預設值),不理會 hardErrorMessage——
  // `--root` 明講但 consumer 還沒裝 gates.config.json 是常見情況,不該因此擋住這支
  // report 模式的 gate。
  const raw = (getGatesConfig() ?? {}) as {
    cucumberCwd?: unknown;
    phaseCoverage?: { runTimeoutMs?: unknown };
    phaseStatus?: { mode?: unknown; reviewDirs?: unknown };
  };

  if (raw.cucumberCwd !== undefined) requireConfigType(raw.cucumberCwd, 'cucumberCwd', 'string', GATE_NAME);
  if (raw.phaseCoverage !== undefined) {
    requireConfigType(raw.phaseCoverage, 'phaseCoverage', 'object', GATE_NAME);
    if (raw.phaseCoverage.runTimeoutMs !== undefined) {
      requireConfigType(raw.phaseCoverage.runTimeoutMs, 'phaseCoverage.runTimeoutMs', 'number', GATE_NAME);
    }
  }
  if (raw.phaseStatus !== undefined) {
    requireConfigType(raw.phaseStatus, 'phaseStatus', 'object', GATE_NAME);
    if (raw.phaseStatus.mode !== undefined) requireConfigType(raw.phaseStatus.mode, 'phaseStatus.mode', 'string', GATE_NAME);
    if (raw.phaseStatus.reviewDirs !== undefined) {
      requireConfigType(raw.phaseStatus.reviewDirs, 'phaseStatus.reviewDirs', 'array', GATE_NAME);
    }
  }

  const mode: PhaseStatusMode = raw.phaseStatus?.mode === 'enforce' ? 'enforce' : 'report';
  const reviewDirs = Array.isArray(raw.phaseStatus?.reviewDirs)
    ? (raw.phaseStatus!.reviewDirs as unknown[]).filter((s): s is string => typeof s === 'string')
    : ['docs/reviews'];
  const cucumberCwd = typeof raw.cucumberCwd === 'string' ? raw.cucumberCwd : undefined;
  const runTimeoutMs = raw.phaseCoverage && typeof raw.phaseCoverage.runTimeoutMs === 'number'
    ? raw.phaseCoverage.runTimeoutMs
    : DEFAULT_RUN_TIMEOUT_MS;

  return { mode, reviewDirs, cucumberCwd, runTimeoutMs };
}

// ---------------------------------------------------------------------------
// cucumber 執行目錄(cwd)三層決定——跟 check-phase-coverage.ts / check-known-defects.ts
// 同一套邏輯,這裡各自一份。
// ---------------------------------------------------------------------------

const CUCUMBER_CONFIG_FILES = ['cucumber.js', 'cucumber.cjs', 'cucumber.mjs', 'cucumber.json', 'cucumber.yaml', 'cucumber.yml'];
const CWD_SCAN_SKIP = new Set([...DEFAULT_SKIP_DIRS, 'archive']);

function hasCucumberConfig(dir: string): boolean {
  return CUCUMBER_CONFIG_FILES.some((f) => existsSync(join(dir, f)));
}

function autodetectCucumberCwd(): string | undefined {
  if (hasCucumberConfig(ROOT)) return ROOT;
  let entries: string[];
  try {
    entries = readdirSync(ROOT);
  } catch {
    return undefined;
  }
  const dirs = entries
    .filter((e) => !CWD_SCAN_SKIP.has(e))
    .filter((e) => {
      try {
        return statSync(join(ROOT, e)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
  for (const d of dirs) {
    const full = join(ROOT, d);
    if (hasCucumberConfig(full)) return full;
  }
  return undefined;
}

function resolveCucumberCwd(cucumberCwdConfig: string | undefined): string {
  const cwdFlag = argValue('--cwd');
  if (cwdFlag) {
    const resolved = resolve(ROOT, cwdFlag);
    if (!existsSync(resolved)) {
      console.log(`✗ --cwd 指定的目錄不存在:${resolved}`);
      process.exit(1);
    }
    return resolved;
  }
  if (cucumberCwdConfig) {
    const resolved = resolve(ROOT, cucumberCwdConfig);
    if (!existsSync(resolved)) {
      console.log(`✗ "cucumberCwd" 指定的目錄不存在:${resolved}`);
      process.exit(1);
    }
    return resolved;
  }
  const detected = autodetectCucumberCwd();
  if (detected) return detected;
  // 列舉被 PHASE_STATUS_RUN_CMD 注入(測試用途)時不需要真的 cucumber 設定,退回 ROOT。
  if (process.env.PHASE_STATUS_RUN_CMD) return ROOT;
  console.log('✗ 找不到 cucumber 設定(cucumber.js|.cjs|.mjs|.json|.yaml|.yml),用 --cwd 或 gates.config.json 的 "cucumberCwd" 指定。');
  process.exit(1);
}

function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  env.NODE_OPTIONS = '--import=tsx';
  return env;
}

interface RunResult { scenarios: number; passed: number; bad: string[] }
type RunOutcome = RunResult | { error: string };

/** 對一個 phase 自己的 tag 表達式真跑一次(段二,沿用 check-phase-coverage.ts 的邏輯)。
 *  `PHASE_STATUS_RUN_CMD` 設了就用它取代真的 cucumber(測試用途,見檔頭說明)。 */
function runTagActual(cwd: string, tagExpr: string, timeoutMs: number): RunOutcome {
  const override = process.env.PHASE_STATUS_RUN_CMD;
  const r = override
    ? spawnSync(override, {
        shell: true,
        cwd,
        encoding: 'utf8',
        env: { ...process.env, PHASE_STATUS_TAG_EXPR: tagExpr },
        timeout: timeoutMs,
      })
    : spawnSync('npx', ['cucumber-js', '--tags', tagExpr, '--format', 'summary'], {
        cwd,
        encoding: 'utf8',
        env: baseEnv(),
        timeout: timeoutMs,
      });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const isTimeout = (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') || !!r.signal;
  if (isTimeout) {
    return { error: `逾時(超過 ${timeoutMs}ms 未完成${r.signal ? `,收到訊號 ${r.signal}` : ''})` };
  }
  if (r.error) return { error: r.error.message };
  const m = output.match(/(\d+)\s+scenarios?\s*\(([^)]*)\)/);
  if (!m) return { error: `輸出裡找不到 "N scenarios (N passed)":${output.slice(0, 500)}` };
  const scenarios = Number(m[1]);
  const detail = m[2] ?? '';
  const bad = ['failed', 'undefined', 'ambiguous'].filter((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(detail));
  const passedMatch = detail.match(/(\d+)\s+passed/);
  const passed = passedMatch ? Number(passedMatch[1]) : 0;
  return { scenarios, passed, bad };
}

// ---------------------------------------------------------------------------
// FEATURE.md 的 Phase 表——跟 check-phase-coverage.ts 的 parseTableRow/readPhaseStatus
// 同一套邏輯,這裡取全部列而不是單一 phase。
// ---------------------------------------------------------------------------

function parseTableRow(line: string): string[] | undefined {
  const t = line.trim();
  if (!t.startsWith('|')) return undefined;
  const parts = t.split('|');
  if (parts.length && parts[0]!.trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1]!.trim() === '') parts.pop();
  return parts.map((c) => c.trim());
}

interface PhaseRow { phase: number; status: string }

function readPhaseTable(featurePath: string): PhaseRow[] {
  const content = readFileSync(featurePath, 'utf8');
  const rows: PhaseRow[] = [];
  for (const line of content.split('\n')) {
    const cells = parseTableRow(line);
    if (!cells || cells.length < 4) continue;
    if (!/^\d+$/.test(cells[0]!)) continue; // 跳過表頭列、分隔列、其他表格的列
    rows.push({ phase: Number(cells[0]), status: (cells[3] ?? '').trim() });
  }
  return rows;
}

function collectFeatureFolders(root: string): string[] {
  const dir = join(root, 'features');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    if (!/^\d{2}-.+$/.test(name)) return false; // 跳過 _template、steps、support 等非 NN-name 資料夾
    return statSync(join(dir, name)).isDirectory();
  });
}

// ---------------------------------------------------------------------------
// 形狀一:PASS 標記解析(見檔頭「PASS 標記的定義」)。
// ---------------------------------------------------------------------------

function stripMd(line: string): string {
  return line.trim().replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '').trim();
}

function hasPassMarker(content: string): boolean {
  if (content.includes('審核 PASS')) return true;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const stripped = stripMd(lines[i]!);
    if (/^(判定|Verdict)\s*[:：]\s*PASS\b/.test(stripped)) return true;
    if (stripped === '判定' || stripped === 'Verdict') {
      for (let j = i + 1; j < lines.length; j++) {
        const t = (lines[j] ?? '').trim();
        if (!t) continue;
        if (/^PASS\b/.test(stripMd(t))) return true;
        break; // 只看標題後第一個非空白行,避免往後一路掃到不相干的段落
      }
    }
  }
  return false;
}

function walkMdFiles(dir: string, skipDirs: Set<string>, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (skipDirs.has(e)) continue;
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkMdFiles(full, skipDirs, out);
    } else if (e.endsWith('.md')) {
      out.push(full);
    }
  }
}

/** 找一份「提到 `<folder>/phase-<phaseNum>` 且帶 PASS 標記」的判定檔:先看
 *  `features/<folder>/REVIEW.md`,再看 `reviewDirs` 底下的 `.md` 檔。回傳第一個命中的路徑。 */
function findReviewFile(
  root: string,
  folder: string,
  phaseNum: number,
  reviewDirs: string[],
  skipDirs: Set<string>,
): string | undefined {
  const candidates: string[] = [join(root, 'features', folder, 'REVIEW.md')];
  for (const dir of reviewDirs) {
    const abs = join(root, dir);
    if (existsSync(abs) && statSync(abs).isDirectory()) walkMdFiles(abs, skipDirs, candidates);
  }
  const needle = `${folder}/phase-${phaseNum}`;
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (content.includes(needle) && hasPassMarker(content)) return file;
  }
  return undefined;
}

function isCommitted(root: string, relFile: string): boolean {
  try {
    const out = execFileSync('git', ['log', '--oneline', '-1', '--', relFile], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 形狀三:NEXT.md 的待辦區塊 + 識別碼定義/樁判定。
// ---------------------------------------------------------------------------

const TODO_HEADING_RE = /^#{1,6}\s.*(下一輪|要做|待做|TODO)/;
const IDENT_RE = /`([A-Za-z_][A-Za-z0-9_]*)`/g;

/** 抓「標題含下一輪/要做/待做/TODO 任一字樣」的段落(到下一個標題為止)裡,用反引號
 *  包住的識別碼(見檔頭「形狀三」的字元限制)。 */
function extractTodoIdentifiers(content: string): string[] {
  const idents = new Set<string>();
  let inSection = false;
  for (const raw of content.split('\n')) {
    if (/^#{1,6}\s/.test(raw)) {
      inSection = TODO_HEADING_RE.test(raw);
      continue;
    }
    if (!inSection) continue;
    for (const m of raw.matchAll(IDENT_RE)) idents.add(m[1]!);
  }
  return [...idents];
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py']);

function walkSourceFiles(dir: string, skipDirs: Set<string>, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (skipDirs.has(e)) continue;
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkSourceFiles(full, skipDirs, out);
    } else if (SOURCE_EXTS.has(extname(e))) {
      out.push(full);
    }
  }
}

interface DefLoc { file: string; line: number; contextLines: string[] }

/** 找 `name` 的定義(五種寫法之一,見檔頭)。第一個命中的檔案/行號就回傳,連同它之後
 *  最多 15 行(給 `isStub` 判斷是不是還是個樁)。 */
function findDefinition(files: string[], name: string): DefLoc | undefined {
  const defRe = new RegExp(
    `^\\s*(export\\s+)?(function\\s+${name}\\b|const\\s+${name}\\s*=|class\\s+${name}\\b|def\\s+${name}\\s*\\()`,
  );
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (defRe.test(lines[i]!)) {
        return { file, line: i + 1, contextLines: lines.slice(i + 1, i + 16) };
      }
    }
  }
  return undefined;
}

const STUB_MARKERS = [
  /not implemented/i,
  /TODO\(ADR-/,
  /throw new Error\('TODO/,
  /NotImplementedError/,
  /pass\s*#\s*TODO/,
];

function isStub(def: DefLoc): boolean {
  const joined = def.contextLines.join('\n');
  return STUB_MARKERS.some((re) => re.test(joined));
}

// ---------------------------------------------------------------------------

function main(): void {
  const config = loadConfig();
  console.log(`phase-status: phaseStatus.mode=${config.mode}(reviewDirs=${config.reviewDirs.join(', ')})`);

  const folders = collectFeatureFolders(ROOT);
  const featureFiles = folders
    .map((folder) => ({ folder, path: join(ROOT, 'features', folder, 'FEATURE.md') }))
    .filter((f) => existsSync(f.path));

  if (featureFiles.length === 0) {
    console.log('✗ 掃到 0 份 FEATURE.md。這不是很乾淨,是掃描器壞了。');
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  interface Row { folder: string; phase: number; status: string }
  const rows: Row[] = [];
  for (const f of featureFiles) {
    for (const r of readPhaseTable(f.path)) rows.push({ folder: f.folder, ...r });
  }

  if (rows.length === 0) {
    console.log('✗ 掃到 0 個 phase 表格列。這不是很乾淨,是掃描器壞了(NA-2:0 目標不代表都合格)。');
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  console.log(`phase-status: ${featureFiles.length} 份 FEATURE.md,共 ${rows.length} 個 phase 表格列`);

  const skipDirs = resolveSkipDirs(getGatesConfig(), GATE_NAME);
  const needsRun = rows.filter((r) => r.status === 'in-progress' || r.status === 'done');
  const cwd = needsRun.length > 0 ? resolveCucumberCwd(config.cucumberCwd) : undefined;

  const hits: string[] = [];

  for (const r of rows) {
    if (r.status !== 'in-progress' && r.status !== 'done') continue;
    const featureFile = join(ROOT, 'features', r.folder, `phase-${r.phase}.feature`);
    if (!existsSync(featureFile)) continue; // 沒有對應的 .feature,兩種形狀都無從檢查

    const name = r.folder.replace(/^\d{2}-/, '');
    const tagExpr = `@${name} and @phase-${r.phase}`;
    const outcome = runTagActual(cwd!, tagExpr, config.runTimeoutMs);
    if ('error' in outcome) {
      console.log(`  … ${r.folder}/phase-${r.phase} 跳過(執行/解析失敗:${outcome.error})`);
      continue;
    }
    const allGreen = outcome.scenarios >= 1 && outcome.bad.length === 0 && outcome.passed === outcome.scenarios;

    if (r.status === 'in-progress') {
      if (!allGreen) continue;
      const reviewFile = findReviewFile(ROOT, r.folder, r.phase, config.reviewDirs, skipDirs);
      if (!reviewFile) continue;
      const relReview = relative(ROOT, reviewFile);
      if (!isCommitted(ROOT, relReview)) continue;
      hits.push(`${r.folder}/phase-${r.phase}`);
      console.log(
        `○ ${r.folder}/phase-${r.phase} 疑似已完成:場景 ${outcome.passed}/${outcome.scenarios} 綠、` +
          `${relReview} PASS 已合併,狀態表仍 in-progress`,
      );
    } else {
      // status === 'done'
      if (allGreen) continue;
      hits.push(`${r.folder}/phase-${r.phase}`);
      const badDesc = outcome.bad.length ? outcome.bad.join('/') : `${outcome.passed}/${outcome.scenarios} passed`;
      console.log(
        `✗ ${r.folder}/phase-${r.phase} 狀態 done 但場景紅(${badDesc})——` +
          'check-phase-coverage.ts --run 也會抓到同一件事,這裡是同一個不變量的第二份判斷',
      );
    }
  }

  // 形狀三:NEXT.md 過期。
  let sourceFiles: string[] | undefined;
  for (const f of featureFiles) {
    const nextPath = join(ROOT, 'features', f.folder, 'NEXT.md');
    if (!existsSync(nextPath)) continue;
    const idents = extractTodoIdentifiers(readFileSync(nextPath, 'utf8'));
    if (idents.length === 0) continue;
    sourceFiles ??= (() => {
      const out: string[] = [];
      walkSourceFiles(ROOT, skipDirs, out);
      return out;
    })();
    for (const name of idents) {
      const def = findDefinition(sourceFiles, name);
      if (!def || isStub(def)) continue;
      hits.push(`${f.folder} NEXT.md:${name}`);
      console.log(`○ NEXT.md 過期:${f.folder} 列 ${name} 待實作,但 ${relative(ROOT, def.file)}:${def.line} 已有實作`);
    }
  }

  if (hits.length) {
    console.log(`\n✗ ${hits.length} 筆疑似狀態表漂移`);
  } else {
    console.log('\n✓ 沒有偵測到狀態表漂移');
  }
  console.log(`gate=${GATE_NAME} result=${hits.length ? 'FAIL' : 'PASS'} scanned=${rows.length}`);

  if (!hits.length) process.exit(0);
  if (config.mode === 'report') {
    console.log('(phaseStatus.mode = "report":P-71,新守門先報告不擋 exit code)');
    process.exit(0);
  }
  process.exit(1);
}

main();
