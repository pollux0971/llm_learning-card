// SOURCE: template v1.4.1 (ff7f64b) sha256=88205646de5008d41ee5af30ce55ef2b330c73169493c19cde4aa6cd3678d1dd — 勿手改;升版用 sync-gates.sh
/**
 * Phase 涵蓋率檢查(P-32,見 docs/03-agile-workflow.md 合併檢查段落)。
 *
 * 背景:cucumber 的 tag 表達式打錯字(例如 `@phase-1` 打成 `@phase1`,或資料夾名稱
 * 跟 tag 對不上)不會讓任何測試變紅——它只是安靜地比對到 0 個場景,`npm run accept` 一樣
 * 全綠,因為根本沒有場景被跑到。這支腳本對每個 phase 檔用「它自己宣稱的 tag」跑一次
 * cucumber,分兩段檢查,抓的是兩種不同的病:
 *
 *   段一(預設,dry-run):不執行 step 的內容,只確認 tag 表達式比對到 ≥1 個場景、
 *   且每個 step 都能對上一個定義(cucumber 在 dry-run 下仍會回報 undefined)。
 *   抓的是「接線」問題——tag 打錯字、資料夾跟 tag 對不上、step 完全沒寫——
 *   而且不會跑到 step 裡有副作用的程式碼。
 *
 *   段二(`--run`,真跑):實際執行 step,要求輸出 `N scenarios (N passed)`
 *   且 N ≥ 1,輸出裡只要出現 failed/undefined/ambiguous 就算這個 phase 紅。
 *   抓的是「邏輯」問題——step 有定義但斷言失敗、同一句話比對到兩個 step
 *   定義(ambiguous)——這些 dry-run 不會執行到,只有真跑才看得到。
 *   真跑比較慢、有副作用,所以預設不開,要加 `--run` 才做。
 *
 * cucumber 執行目錄(cwd)三層決定(某些 repo 的 cucumber 設定不在 repo 根,
 * 而是某個 workspace package 底下,例如 `features/cucumber.js` +
 * `features/node_modules/.bin/cucumber-js`;這種情況下用 `cwd: ROOT` 跑
 * `npx cucumber-js` 會完全找不到設定,`N scenarios` 抓不到甚至卡住):
 *   (a) `--cwd <dir>` 旗標(相對 ROOT,或絕對路徑)
 *   (b) `scripts/gates.config.json` 的 `"cucumberCwd"`(相對 ROOT;沒有這份檔或沒填這個欄位就跳過)
 *   (c) 自動偵測:ROOT 底下有 cucumber.js|cucumber.cjs|cucumber.mjs|cucumber.json|cucumber.yaml|cucumber.yml
 *       → 用 ROOT;否則掃 ROOT 的直接子目錄(排除 node_modules、.git、dist、archive),
 *       取第一個含上述任一檔案的目錄
 *   三層都沒有 → exit 1,印「找不到 cucumber 設定,用 --cwd 或 scripts/gates.config.json 指定」。
 *   實際採用的 cwd 會印在輸出的第一行。
 *
 * feature 檔的掃描(找 phase 檔、讀第一行 tag)永遠以 ROOT 為準
 * (`features/<NN-name>/phase-N.feature`),跟 cucumber 執行目錄是兩件事:
 * 我們只用 `--tags` 表達式,不傳路徑給 cucumber,cucumber 自己的設定檔(paths)
 * 會決定去哪裡找 feature 檔,所以 cwd ≠ ROOT 時不需要換算 feature 路徑。
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析,不在 git repo 裡則退回 cwd):
 *   npx tsx scripts/check-phase-coverage.ts                    # 複製進 repo 後執行,全部 phase 檔(dry-run)
 *   npx tsx <template>/scripts/check-phase-coverage.ts         # 從模板路徑直接執行,cwd 需在目標 repo
 *   npx tsx scripts/check-phase-coverage.ts --only 04-scheduler
 *   npx tsx scripts/check-phase-coverage.ts --list         # 只列出會檢查哪些檔案,不執行
 *   npx tsx scripts/check-phase-coverage.ts --cwd features # 指定 cucumber 執行目錄(相對 ROOT)
 *   npx tsx scripts/check-phase-coverage.ts --run          # 額外加跑段二(真跑,見上)
 *
 * `--run` 預設**只真跑**對應 `features/<folder>/FEATURE.md` phase 表狀態是 `done` 或
 * `in-progress` 的 phase 檔;`todo` / `ready` / `blocked`,或狀態解析不到,一律只 dry-run
 * 並印「(todo,略過真跑)」——這些狀態代表 phase 本來就還沒定案,真跑一個半成品只是白花
 * 時間(CHANGELOG 1.3.2 (E))。要手動蓋過這個規則、指定確切要真跑哪幾個 phase,用:
 *   npx tsx scripts/check-phase-coverage.ts --run --run-phases 04-scheduler/phase-2,05-grading/phase-1
 *
 * `gates.config.json` 的搜尋順序是「這支腳本自己所在的目錄 → ROOT/scripts/」(見 _root.ts
 * 的 `resolveConfig`),不是只認 ROOT/scripts/——sync-gates.sh 把腳本裝到別的目錄
 * (例如 `features/scripts/`)時,設定檔通常也裝在那裡,兩處都要找。
 *
 * `--run` 對每個 phase 檔的逾時毫秒數由 `scripts/gates.config.json` 的
 * `phaseCoverage.runTimeoutMs` 決定,預設 600000(10 分鐘);這份檔不存在,或存在但沒填
 * 這個欄位,就用預設值。逾時是跟「輸出裡找不到 N scenarios」不同的病(前者是執行本身沒
 * 跑完,後者是跑完了但解析不出來),訊息會明說「逾時」並附上目前的逾時值,不會混在一起。
 *
 * 退出碼:
 *   0  每個 phase 檔用自己的 tag 都至少比對到 1 個場景(有 --run 時,段二也要全部通過)
 *   1  任一 phase 檔比對到 0 個場景,或 tag 掛錯,或執行/解析失敗;
 *      或掃到 0 個 phase 檔(這不是很乾淨,是掃描器壞了);
 *      或找不到 cucumber 執行目錄(三層都沒指定/偵測到);
 *      或 --run 時任一 phase 檔輸出含 failed/undefined/ambiguous
 *
 * 反向驗證(改完要還原,不要留下改動):
 *   (a) 挑一個 phase 檔(例如 features/04-scheduler/phase-1.feature),把第一行的
 *       `@phase-1` 手動改成 `@phase-9`(製造 tag 與檔名對不上)。重跑這支腳本 →
 *       應該紅,列出 04-scheduler/phase-1 的 tag 對不上或比對到 0 個場景。
 *   (b) 改回 `@phase-1` → 重跑 → 應該綠。
 *   (c) 這個 worktree 的舊版根目錄本身就是資料:直接跑一次全部,應該看到每個既有
 *       phase 檔都 ≥1 個場景(沒有場景清單本身就是紅,不用手動改壞就看得到)。
 *   (d) cwd 偵測:在一個 cucumber 設定不在根目錄的 repo(例如根目錄沒有
 *       cucumber.js,但 `features/cucumber.js` 有)跑這支腳本,應該自動偵測到
 *       `features/` 當 cwd,印出來;把那個子目錄的設定檔也拿掉 → 應該 exit 1
 *       印「找不到 cucumber 設定」。
 *   (e) `--run`:對一個已知會失敗的 phase(例如故意讓某個 step 斷言錯誤)跑
 *       `--run` → 應該紅且印出 failed;拿掉 `--run` 只跑 dry-run → 應該綠
 *       (因為 dry-run 不執行斷言)。這就是兩段分開存在的理由。
 *   (f) 第一行不是 tag 行:把某個 phase 檔第一行從 tag 行改成 `# PROPOSAL` 這類註解
 *       (tag 移到第二行)。重跑 → 應該紅,訊息含「第一行必須是 tag 行」那句,不是只說
 *       「缺少 @xxx」讓人以為要加 tag 而不是搬動 tag 的位置。改回來 → 應該綠。
 *   (g) `--run` 逾時:把 `scripts/gates.config.json` 的 `phaseCoverage.runTimeoutMs`
 *       設成 `1`(1 毫秒,任何 phase 都來不及跑完),跑 `--run` → 應該紅,訊息含「逾時」,
 *       不是「輸出裡找不到 N scenarios」。改回正常值(或刪掉這個欄位退回預設)→ 應該綠。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, relative } from 'node:path';
import { DEFAULT_SKIP_DIRS, ROOT, loadGatesConfig as loadSharedGatesConfig, requireConfigType, resolveConfig, configSearchPaths } from './_root.js';

/** 這支腳本在 gate 機器可讀標記(見 CHANGELOG 1.3.2 (C))裡的名字。 */
const GATE_NAME = 'phase-coverage';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ONLY = arg('--only');
const LIST_ONLY = process.argv.includes('--list');
const RUN = process.argv.includes('--run');
/** `--run-phases NN-folder/phase-N,NN-folder/phase-M` 手動指定「段二」要真跑的 phase 檔,
 *  蓋過用 FEATURE.md 狀態自動判斷的規則(見下面 shouldRunActual)。空字串視為未指定。 */
const RUN_PHASES = arg('--run-phases');
const RUN_PHASES_SET: Set<string> | undefined = RUN_PHASES
  ? new Set(RUN_PHASES.split(',').map((s) => s.trim()).filter(Boolean))
  : undefined;

interface PhaseFile { folder: string; name: string; phase: number; file: string; relFile: string }

function collectPhaseFiles(): PhaseFile[] {
  const featuresDir = join(ROOT, 'features');
  if (!existsSync(featuresDir)) return [];
  const out: PhaseFile[] = [];
  for (const entry of readdirSync(featuresDir)) {
    const folderMatch = entry.match(/^(\d{2})-(.+)$/);
    if (!folderMatch) continue; // 跳過 _template、steps 等非 NN-name 資料夾
    const folder = entry;
    const name = folderMatch[2]!;
    const folderPath = join(featuresDir, folder);
    if (!statSync(folderPath).isDirectory()) continue;
    for (const file of readdirSync(folderPath)) {
      const phaseMatch = file.match(/^phase-(\d+)\.feature$/);
      if (!phaseMatch) continue;
      out.push({
        folder,
        name,
        phase: Number(phaseMatch[1]),
        file: join(folderPath, file),
        relFile: `features/${folder}/${file}`,
      });
    }
  }
  return out.sort((a, b) => (a.folder === b.folder ? a.phase - b.phase : a.folder.localeCompare(b.folder)));
}

function firstNonEmptyLine(file: string): string {
  const lines = readFileSync(file, 'utf8').split('\n');
  return lines.find((l) => l.trim().length > 0) ?? '';
}

function hasTag(line: string, tag: string): boolean {
  const tags: string[] = line.match(/@[^\s]+/g) ?? [];
  return tags.includes(tag);
}

// ---- cucumber 執行目錄(cwd)三層決定 ----

const CUCUMBER_CONFIG_FILES = ['cucumber.js', 'cucumber.cjs', 'cucumber.mjs', 'cucumber.json', 'cucumber.yaml', 'cucumber.yml'];
/** 掃 ROOT 直接子目錄找 cucumber 設定時要跳過的目錄(S10):共用清單 + `archive`
 *  (模板慣例的封存目錄,不在通用清單裡)。不准在這裡另外寫死一份 `node_modules` 之類的
 *  字面陣列——見 check-boundaries.test.ts 那條「every check-*.ts 都要用共用清單」的 grep 測試。 */
const CWD_SCAN_SKIP = new Set([...DEFAULT_SKIP_DIRS, 'archive']);

interface GatesConfig { cucumberCwd?: string; runTimeoutMs?: number }

/** `--run`(段二,真跑)對每個 phase 檔各自套用的逾時毫秒數;`gates.config.json` 沒有
 *  這份檔、或有但沒填 `phaseCoverage.runTimeoutMs` 時用這個預設值。 */
const DEFAULT_RUN_TIMEOUT_MS = 600_000;

function loadGatesConfig(): GatesConfig {
  // 找設定檔的順序:(1) 這支腳本自己所在的目錄(sync 後就是 consumer 的安裝目錄,
  // 例如 features/scripts/)、(2) ROOT/scripts/——見 _root.ts 的 resolveConfig。
  // gates.config.json 是選填設定,兩處都沒有就退回內建預設,不印任何訊息。
  const p = resolveConfig(import.meta.dirname, 'gates.config.json');
  // 解析錯誤、不認識的頂層鍵在這裡大聲失敗(S9),不是未捕捉的堆疊、也不是悄悄回退預設值。
  const raw = (loadSharedGatesConfig(p, GATE_NAME) ?? {}) as {
    cucumberCwd?: unknown;
    phaseCoverage?: { runTimeoutMs?: unknown };
  };
  if (raw.cucumberCwd !== undefined) requireConfigType(raw.cucumberCwd, 'cucumberCwd', 'string', GATE_NAME);
  if (raw.phaseCoverage !== undefined) {
    requireConfigType(raw.phaseCoverage, 'phaseCoverage', 'object', GATE_NAME);
    if (raw.phaseCoverage.runTimeoutMs !== undefined) {
      requireConfigType(raw.phaseCoverage.runTimeoutMs, 'phaseCoverage.runTimeoutMs', 'number', GATE_NAME);
    }
  }
  const cucumberCwd = typeof raw.cucumberCwd === 'string' ? raw.cucumberCwd : undefined;
  const runTimeoutMs = raw.phaseCoverage && typeof raw.phaseCoverage.runTimeoutMs === 'number'
    ? raw.phaseCoverage.runTimeoutMs
    : undefined;
  // exactOptionalPropertyTypes:true 下,可選欄位不能顯式指派 undefined——用條件展開
  // 只在有值時放進物件,而不是 `{ cucumberCwd: cucumberCwd }`(cucumberCwd 可能是 undefined)。
  return {
    ...(cucumberCwd !== undefined ? { cucumberCwd } : {}),
    ...(runTimeoutMs !== undefined ? { runTimeoutMs } : {}),
  };
}

function hasCucumberConfig(dir: string): boolean {
  return CUCUMBER_CONFIG_FILES.some((f) => existsSync(join(dir, f)));
}

/** 掃 ROOT 的直接子目錄(排除 node_modules、.git、dist、archive),取第一個含 cucumber 設定的。 */
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

function resolveCucumberCwd(): string {
  const cwdFlag = arg('--cwd');
  if (cwdFlag) {
    const resolved = resolve(ROOT, cwdFlag);
    if (!existsSync(resolved)) {
      console.log(`✗ --cwd 指定的目錄不存在:${resolved}`);
      process.exit(1);
    }
    return resolved;
  }

  const config = loadGatesConfig();
  if (config.cucumberCwd) {
    const resolved = resolve(ROOT, config.cucumberCwd);
    // 這個 exit 是刻意的:cucumberCwd 一旦被設定卻指向不存在的目錄,不能讓後面的
    // 自動偵測「靜默救回」——那會讓設定看起來有效但其實從沒被套用過(consumer 實測的
    // 迴歸,見 CHANGELOG 1.3.2 (A))。找不到設定檔本身是另一回事(上面 config.cucumberCwd
    // 就會是 undefined,直接往下走自動偵測),這裡管的是「設定了但指錯路徑」。
    if (!existsSync(resolved)) {
      console.log(`✗ "cucumberCwd" 指定的目錄不存在:${resolved}`);
      console.log(`  (設定來自 gates.config.json,搜尋順序:${configSearchPaths(import.meta.dirname, 'gates.config.json').join(' → ')})`);
      process.exit(1);
    }
    return resolved;
  }

  const detected = autodetectCucumberCwd();
  if (detected) return detected;

  console.log(
    `✗ 找不到 cucumber 設定(cucumber.js|.cjs|.mjs|.json|.yaml|.yml),用 --cwd 或 gates.config.json 的 "cucumberCwd" 指定` +
      `(設定檔未找到於 ${configSearchPaths(import.meta.dirname, 'gates.config.json').join('、')})。`,
  );
  process.exit(1);
}

// ---- 執行 cucumber ----

function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  env.NODE_OPTIONS = '--import=tsx';
  return env;
}

function runDryRun(cwd: string, tagExpr: string): { scenarios: number; output: string } | { error: string; output: string } {
  const r = spawnSync('npx', ['cucumber-js', '--tags', tagExpr, '--dry-run', '--format', 'summary'], {
    cwd,
    encoding: 'utf8',
    env: baseEnv(),
    timeout: 60_000,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.error) return { error: r.error.message, output };
  const m = output.match(/(\d+)\s+scenarios?\b/);
  if (!m) return { error: '輸出裡找不到 "N scenarios"', output };
  return { scenarios: Number(m[1]), output };
}

interface RunResult { scenarios: number; passed: number; bad: string[]; output: string }
type RunOutcome = RunResult | { error: string; output: string };

/** 真跑(段二):解析 "N scenarios (詳細)",詳細裡出現 failed/undefined/ambiguous 就記在 bad。
 *  `timeoutMs` 由呼叫端(gates.config.json 的 phaseCoverage.runTimeoutMs,預設 600000)決定,
 *  對每個 phase 檔各自套用——一個 phase 卡住逾時,不影響其他 phase 檔的逾時額度。 */
function runActual(cwd: string, tagExpr: string, timeoutMs: number): RunOutcome {
  const r = spawnSync('npx', ['cucumber-js', '--tags', tagExpr, '--format', 'summary'], {
    cwd,
    encoding: 'utf8',
    env: baseEnv(),
    timeout: timeoutMs,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  // 逾時偵測要放在一般 error 分支「之前」:實測 Node 對 spawnSync 逾時的行為是
  // 同時設定 r.error(code === 'ETIMEDOUT')「與」r.signal(通常是 SIGTERM、status 為
  // null)——先判斷 r.error 會把逾時吃成一句普通的 "spawnSync npx ETIMEDOUT"、
  // 混進「執行/解析失敗」那個泛用分支,呼叫端看不出來要調的是 runTimeoutMs 還是去
  // 修設定/環境。這裡兩種訊號(error.code、signal)都當逾時處理,訊息明說「逾時」。
  const isTimeout = (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') || !!r.signal;
  if (isTimeout) {
    return {
      error: `逾時(超過 ${timeoutMs}ms 未完成${r.signal ? `,收到訊號 ${r.signal}` : ''}——可用 scripts/gates.config.json 的 "phaseCoverage.runTimeoutMs" 調高)`,
      output,
    };
  }
  if (r.error) return { error: r.error.message, output };
  const m = output.match(/(\d+)\s+scenarios?\s*\(([^)]*)\)/);
  if (!m) return { error: '輸出裡找不到 "N scenarios (N passed)"', output };
  const scenarios = Number(m[1]);
  const detail = m[2] ?? '';
  const bad = ['failed', 'undefined', 'ambiguous'].filter((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(detail));
  const passedMatch = detail.match(/(\d+)\s+passed/);
  const passed = passedMatch ? Number(passedMatch[1]) : 0;
  return { scenarios, passed, bad, output };
}

/** 讀 `features/<folder>/FEATURE.md` 的 phase 表(見該檔「## Phase」段落),回傳指定
 *  phase 的狀態欄(`todo` / `ready` / `in-progress` / `done` / `blocked`)。表格格式固定是
 *  `| Phase | 標題 | 階段 | 狀態 | 完成日 |`(參考 features/04-scheduler/FEATURE.md);
 *  這裡不去找那個標題列,而是直接找「第一欄是純數字」的資料列並取第 4 欄——比對表頭文字
 *  更耐得住欄位順序以外的措辭差異,巧合命中的風險也低(FEATURE.md 裡其他表格的第一欄
 *  通常不是純數字,例如「後續 phase」表用的是 "phase-2" 這種字串)。
 *  檔案不存在、或找不到對應的列(表格改了格式、phase 還沒被列進去)→ 回傳 undefined,
 *  呼叫端把 undefined 當 todo 處理並印警告,不是直接當作可以真跑。 */
function parseTableRow(line: string): string[] | undefined {
  const t = line.trim();
  if (!t.startsWith('|')) return undefined;
  const parts = t.split('|');
  if (parts.length && parts[0]!.trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1]!.trim() === '') parts.pop();
  return parts.map((c) => c.trim());
}

function readPhaseStatus(folder: string, phase: number): string | undefined {
  const path = join(ROOT, 'features', folder, 'FEATURE.md');
  if (!existsSync(path)) return undefined;
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const line of lines) {
    const cells = parseTableRow(line);
    if (!cells || cells.length < 4) continue;
    if (!/^\d+$/.test(cells[0]!)) continue; // 跳過表頭列、分隔列、其他表格的列
    if (Number(cells[0]) !== phase) continue;
    return cells[3]; // Phase | 標題 | 階段 | 狀態 | 完成日 → 狀態是第 4 欄(index 3)
  }
  return undefined;
}

/** 段二(--run)要不要真跑這個 phase 檔:`--run-phases` 有指定就只認那份清單;
 *  沒指定就用 FEATURE.md 的狀態——`done` / `in-progress` 才真跑,`todo` / `ready` /
 *  `blocked` 或解析不到都只 dry-run(P-32 已經涵蓋),因為那些狀態代表這個 phase
 *  本來就還沒定案,真跑一個還在改的 phase 只是白花時間、甚至可能因為半成品而誤判紅。 */
function shouldRunActual(p: PhaseFile): { run: true } | { run: false; reason: string } {
  const key = `${p.folder}/phase-${p.phase}`;
  if (RUN_PHASES_SET) {
    return RUN_PHASES_SET.has(key) ? { run: true } : { run: false, reason: `未列在 --run-phases` };
  }
  const status = readPhaseStatus(p.folder, p.phase);
  if (status === undefined) {
    return { run: false, reason: `FEATURE.md 解析不到 phase ${p.phase} 的狀態,當 todo 處理(todo,略過真跑)` };
  }
  if (status === 'done' || status === 'in-progress') return { run: true };
  return { run: false, reason: `狀態=${status}(todo,略過真跑)` };
}

function main(): void {
  let phaseFiles = collectPhaseFiles();
  if (ONLY) phaseFiles = phaseFiles.filter((p) => p.folder === ONLY);

  if (phaseFiles.length === 0) {
    console.log(
      ONLY
        ? `✗ 找不到 features/${ONLY}/phase-*.feature`
        : '✗ 掃到 0 個 phase 檔(features/<NN-name>/phase-*.feature)。這不是很乾淨,是掃描器壞了。',
    );
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  if (LIST_ONLY) {
    for (const p of phaseFiles) console.log(`  ${p.relFile}  →  @${p.name} and @phase-${p.phase}`);
    console.log(`gate=${GATE_NAME} result=PASS scanned=${phaseFiles.length}`);
    process.exit(0);
  }

  const cucumberCwd = resolveCucumberCwd();
  const cwdDisplay = relative(ROOT, cucumberCwd) || '.';
  console.log(`phase-coverage: cucumber cwd = ${cwdDisplay}`);
  console.log(`phase-coverage: 段一(dry-run)檢查 ${phaseFiles.length} 個 phase 檔`);

  const failures: string[] = [];
  const tagOkFiles: PhaseFile[] = [];
  for (const p of phaseFiles) {
    const line = firstNonEmptyLine(p.file);
    const nameTag = `@${p.name}`;
    const phaseTag = `@phase-${p.phase}`;
    if (!hasTag(line, nameTag) || !hasTag(line, phaseTag)) {
      failures.push(
        `${p.relFile}  第一行缺少 ${nameTag} 或 ${phaseTag}(實際:${line.trim() || '(空白)'})。` +
          `第一行必須是 tag 行(\`@name @phase-N …\`),註解或 \`# PROPOSAL\` 之類請放第二行起。`,
      );
      console.log(`  ✗ ${p.relFile}  tag 掛錯`);
      continue;
    }
    const tagExpr = `${nameTag} and ${phaseTag}`;
    const result = runDryRun(cucumberCwd, tagExpr);
    if ('error' in result) {
      failures.push(`${p.relFile}  執行/解析失敗:${result.error}`);
      console.log(`  ✗ ${p.relFile}  執行/解析失敗:${result.error}`);
      continue;
    }
    if (result.scenarios < 1) {
      failures.push(`${p.relFile}  tag "${tagExpr}" 比對到 0 個場景`);
      console.log(`  ✗ ${p.relFile}  0 個場景(tag "${tagExpr}")`);
      continue;
    }
    console.log(`  ✓ ${p.relFile}  ${result.scenarios} 個場景`);
    tagOkFiles.push(p);
  }

  if (failures.length) {
    console.log(`\n✗ 段一(dry-run):${failures.length} 個 phase 檔沒有涵蓋率:`);
    for (const f of failures) console.log(`  ${f}`);
  } else {
    console.log('\n✓ 段一(dry-run):全部 phase 檔至少涵蓋 1 個場景');
  }

  if (!RUN) {
    console.log(`gate=${GATE_NAME} result=${failures.length ? 'FAIL' : 'PASS'} scanned=${phaseFiles.length}`);
    process.exit(failures.length ? 1 : 0);
  }

  // ---- 段二:--run(真跑) ----
  // 只真跑 FEATURE.md 狀態是 done / in-progress 的 phase(或 --run-phases 明講的清單)——
  // todo / ready / blocked 的 phase 本來就還沒定案,真跑只是白花時間(見 shouldRunActual)。
  const runTimeoutMs = loadGatesConfig().runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  console.log(
    `\nphase-coverage: 段二(--run,真跑)檢查 ${tagOkFiles.length} 個 phase 檔中該跑的部分` +
      `(要求 "N scenarios (N passed)",排除 failed/undefined/ambiguous;每個 phase 檔逾時 ${runTimeoutMs}ms` +
      `${RUN_PHASES_SET ? `;--run-phases 指定 ${RUN_PHASES_SET.size} 個` : ''})`,
  );

  const runFailures: string[] = [];
  let actuallyRun = 0;
  for (const p of tagOkFiles) {
    const decision = shouldRunActual(p);
    if (!decision.run) {
      console.log(`  ⏭ ${p.relFile}  ${decision.reason}`);
      continue;
    }
    actuallyRun++;
    const tagExpr = `@${p.name} and @phase-${p.phase}`;
    const result = runActual(cucumberCwd, tagExpr, runTimeoutMs);
    if ('error' in result) {
      runFailures.push(`${p.relFile}  執行/解析失敗:${result.error}`);
      console.log(`  ✗ ${p.relFile}  執行/解析失敗:${result.error}`);
      continue;
    }
    if (result.scenarios < 1 || result.bad.length > 0 || result.passed < 1) {
      const badDesc = result.bad.length ? result.bad.join('/') : '沒有任何 passed';
      runFailures.push(`${p.relFile}  真跑失敗(${badDesc})`);
      console.log(`  ✗ ${p.relFile}  真跑失敗(${badDesc})`);
      continue;
    }
    console.log(`  ✓ ${p.relFile}  ${result.scenarios} 個場景(${result.passed} passed)`);
  }

  if (runFailures.length) {
    console.log(`\n✗ 段二(--run):${runFailures.length} 個 phase 檔真跑失敗(實際真跑 ${actuallyRun} 個):`);
    for (const f of runFailures) console.log(`  ${f}`);
  } else {
    console.log(`\n✓ 段二(--run):全部 phase 檔真跑通過(實際真跑 ${actuallyRun} 個,其餘因狀態或 --run-phases 略過)`);
  }

  const overallResult = failures.length || runFailures.length ? 'FAIL' : 'PASS';
  console.log(`gate=${GATE_NAME} result=${overallResult} scanned=${phaseFiles.length}`);
  process.exit(failures.length || runFailures.length ? 1 : 0);
}

main();
