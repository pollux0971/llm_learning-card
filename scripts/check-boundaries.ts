// SOURCE: template v1.4.1 (ff7f64b) sha256=3a5e18c688f7b1f28666cfa0ce13b321f0342ac7839dea8a59127c11cbbde5c7 — 勿手改;升版用 sync-gates.sh
/**
 * 邊界檢查(見 docs/02-decision-map.md ADR-004 / ADR-014)。
 *
 * 規則:每個功能的程式碼只准 import
 *   1. 自己的落點(見 `scripts/boundaries.owners.json` 的 owners 表)
 *   2. contracts/ 與 packages/contracts/(owners.json 的 contractsOwner 那個擁有者)
 *   3. node 內建模組與 node_modules
 *   4. scripts/boundaries.allow.json 明列的例外邊(整合後逐條加,附理由)
 *
 * **落點表、glue 集合、alias 對映、掃描範圍不寫死在這支程式裡**,讀
 * `scripts/boundaries.owners.json`(ROOT 下,不是模板裡那份)。這是專案自己的設定,
 * 跟 `boundaries.allow.json` 一樣不會被 `sync-gates.sh` 覆蓋——程式(這支 .ts)跟設定
 * (owners.json)分開,升級模板版本不會把專案填好的落點表洗掉。格式:
 *
 *   {
 *     "owners": [["packages/contracts/", "contracts"], ...],   // 順序有意義,先比對較長的前綴
 *     "glue": ["infra", "steps", { "owner": "generated", "role": "glue" }],
 *     "aliases": [["@contracts/", "packages/contracts/src/"], ...],
 *     "scanDirs": ["packages", "apps", "scripts"],
 *     "contractsOwner": "contracts"                             // 對到這個擁有者的 import 一律放行
 *   }
 *
 * `glue` 陣列的每一項要嘛是字串(擁有者名稱——這個擁有者可以 import 任何東西,
 * 不當來源檢查,舊格式,行為不變),要嘛是 `{ owner, role: "glue" }`(CHANGELOG 1.4.0):
 * 除了「不當來源檢查」之外,還多一條「不准當 import 目標」——任何人 import 到這個
 * 擁有者名下的檔案都算違規(印 `glue 不准被 import`)。用在「這個資料夾是產物 /
 * 只讀寫自己,不該被任何功能依賴」的場景。
 *
 * `owners.json` 找不到、或找到但 `owners` 是空陣列——這兩種都當「尚未設定」,exit 1
 * 並印一句可執行的訊息(「從每個 features 資料夾的 FEATURE.md 的 owner 欄起草」)加上面這份範例,
 * 不是「留空也能跑」也不是「留空 = PASS」:一個宣稱「沒有違規」但其實根本沒有落點表可
 * 比對的 gate,比沒有這個 gate 更危險——它會讓看到綠燈的人以為邊界真的被檢查過。
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析,不在 git repo 裡則退回 cwd;
 * `--root <dir>` 明講的話優先):
 *   npx tsx scripts/check-boundaries.ts                        # 複製進 repo 後執行
 *   npx tsx <template>/scripts/check-boundaries.ts             # 從模板路徑直接執行,cwd 需在目標 repo
 *   npx tsx scripts/check-boundaries.ts --verbose               # 也印出每個檔案的歸屬
 *   npx tsx scripts/check-boundaries.ts --root <dir>            # 明講根目錄(測試/對照用)
 *
 * 退出碼:0 無違規;1 有違規、有檔案不在任何落點內,或**一個檔案都沒掃到**(見下)。
 *
 * 「掃到 0 個檔案一律 FAIL」是刻意的:落點表打錯字、SKIP_DIRS 多寫一個、
 * 副檔名清單少一個,掃描器就會安靜地變瞎,而下一個人看到綠燈以為 repo 很乾淨。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ROOT as GIT_ROOT, loadGatesConfig, lookupConfig, readConfigJson, requireConfigType, resolveSkipDirs } from './_root.js';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ROOT_EXPLICIT = argValue('--root') !== undefined;
const ROOT = resolve(argValue('--root') ?? GIT_ROOT);
const VERBOSE = process.argv.includes('--verbose');

/** 三支掃描器共用的那句話。看到它就知道方向是「掃描器壞了」,不是「程式碼很乾淨」。 */
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

/** 這支腳本在 gate 機器可讀標記(見 CHANGELOG 1.3.2 (C))裡的名字。 */
const GATE_NAME = 'boundaries';

/**
 * 找一份設定檔(`boundaries.owners.json` / `boundaries.allow.json`)——委派給 `_root.ts`
 * 的 `lookupConfig`(S14,來源 AI_KM 2026-09-05,PITFALLS P-73):`--root` 有沒有明講
 * 決定要不要允許退回這支腳本自己所在的目錄(那通常是模板自己的佔位設定,`--root` 明講時
 * 退回去就是 P-73 那次事故本身)。每次呼叫印一行「<name>: 設定:...」(找不到印
 * 「設定:無,使用預設」),讀 log 的人第一行就看得出這次讀了哪份設定,不用等掃描結果
 * 對不上才回頭懷疑設定檔。
 */
function findConfigFile(name: string): { path: string | undefined; hardErrorMessage: string | undefined; triedPaths: string[] } {
  const result = lookupConfig(import.meta.dirname, name, { root: ROOT, rootExplicit: ROOT_EXPLICIT });
  console.log(`${name}: ${result.source}`);
  return { path: result.path, hardErrorMessage: result.hardErrorMessage, triedPaths: result.triedPaths };
}

/**
 * 一個 `glue` 項目要嘛是純字串(擁有者名稱,舊格式,行為不變:這個擁有者可以
 * import 任何東西、不當來源檢查),要嘛是 `{ owner, role: "glue" }`(CHANGELOG 1.4.0):
 * 除了「不當來源檢查」之外,**還多一條「不准當 import 目標」**——任何人 import 到
 * 這個擁有者名下的檔案都算違規,原因印 `glue 不准被 import`。用在「這個資料夾是
 * 產物 / 只能被自己讀寫,不該被任何功能依賴」的場景(例如某個生成後即棄的暫存區)。
 */
type GlueEntry = string | { owner: string; role: 'glue' };

function glueOwnerName(e: GlueEntry): string {
  return typeof e === 'string' ? e : e.owner;
}

function isGlueTargetForbidden(e: GlueEntry): boolean {
  return typeof e !== 'string' && e.role === 'glue';
}

interface OwnersConfig {
  /** 落點 → 擁有的功能。順序有意義:先比對較長的前綴。 */
  owners: [prefix: string, owner: string][];
  /** 這些擁有者是「膠水」,可以 import 任何東西,不當作來源檢查;見 GlueEntry。 */
  glue: GlueEntry[];
  /** import alias → 對到的 repo 相對路徑前綴。 */
  aliases: [alias: string, target: string][];
  /** 要掃描的根目錄(相對 ROOT)。 */
  scanDirs: string[];
  /** 對到這個擁有者的 import 一律放行(不算跨界),通常是 contracts。 */
  contractsOwner: string;
  /** S11(來源 nightmare-assault):涵蓋率棘輪的基準——選填。存在時,這次跑出來的
   *  「納管/掃描」比例必須 ≥ 這裡記的比例,否則判失敗(只准升,不准降)。 */
  coverageBaseline?: { managed: number; scanned: number };
}

const OWNERS_JSON_PATH = 'scripts/boundaries.owners.json';

const OWNERS_EXAMPLE = `{
  "owners": [
    ["packages/contracts/", "contracts"],
    ["contracts/", "contracts"],
    ["packages/core/src/{{FEATURE_SRC_DIR}}/", "{{FEATURE_OWNER}}"],
    ["features/steps/", "steps"]
  ],
  "glue": ["infra", "steps", { "owner": "generated", "role": "glue" }],
  "aliases": [
    ["@contracts/", "packages/contracts/src/"],
    ["@core/", "packages/core/src/"]
  ],
  "scanDirs": ["packages", "apps", "scripts"],
  "contractsOwner": "contracts"
}`;

/** 印一則設定錯誤、印 gate 標記(0 目標)、exit 1——每一種設定壞掉都要走這條路,
 *  不能是沒印標記行就中斷的未捕捉例外(舊版的 bug:見這支腳本 1.4.0 的反向驗證)。 */
function configError(msg: string): never {
  console.error(`✗ ${msg}`);
  console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
  process.exit(1);
}

/** owners.json 找不到、或找到但落點表是空的——這兩種都是「還沒設定」,不是兩種不同的病,
 *  用同一句可執行的訊息(消費者回報:光說「設定檔未找到」不夠,要講清楚下一步做什麼)。 */
function ownersNotConfigured(pathDisplay: string): never {
  console.error(
    `✗ 尚未設定:找不到 ${pathDisplay} 或落點表是空的;從 features/*/FEATURE.md 的 owner 欄起草,` +
      '範例見 template/scripts/boundaries.owners.json',
  );
  console.error(OWNERS_EXAMPLE);
  console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
  process.exit(1);
}

function loadOwnersConfig(): OwnersConfig {
  const found = findConfigFile('boundaries.owners.json');
  if (found.hardErrorMessage) configError(found.hardErrorMessage);
  const p = found.path;
  if (!p) ownersNotConfigured(found.triedPaths.join('、'));
  // 解析錯誤(壞掉的 JSON)在這裡大聲失敗(S9),不會是未捕捉的堆疊。
  const raw = readConfigJson(p, GATE_NAME) as Partial<OwnersConfig>;
  if (!Array.isArray(raw.owners) || raw.owners.length === 0) ownersNotConfigured(p);
  if (!Array.isArray(raw.glue)) configError(`${OWNERS_JSON_PATH} 缺 "glue"(陣列,可以是空的)`);
  for (const g of raw.glue) {
    const isPlainString = typeof g === 'string';
    const isRoleObject =
      !isPlainString && g !== null && typeof g === 'object' &&
      typeof (g as { owner?: unknown }).owner === 'string' &&
      (g as { role?: unknown }).role === 'glue';
    if (!isPlainString && !isRoleObject) {
      configError(
        `${OWNERS_JSON_PATH} 的 "glue" 每一項要嘛是字串(擁有者名稱),要嘛是 { "owner": "...", "role": "glue" };實際:${JSON.stringify(g)}`,
      );
    }
  }
  if (!Array.isArray(raw.aliases)) configError(`${OWNERS_JSON_PATH} 缺 "aliases"(陣列,可以是空的)`);
  if (!Array.isArray(raw.scanDirs) || raw.scanDirs.length === 0) {
    configError(`${OWNERS_JSON_PATH} 的 "scanDirs" 必須是非空陣列`);
  }
  if (!raw.contractsOwner || typeof raw.contractsOwner !== 'string') {
    configError(`${OWNERS_JSON_PATH} 缺 "contractsOwner"(字串)`);
  }
  // S11:coverageBaseline 選填,存在就要驗證形狀——壞掉的基準比沒有基準更危險(棘輪
  // 比對會拿一個不合理的數字去比,S9 同一套「設定壞掉大聲失敗」原則)。
  if (raw.coverageBaseline !== undefined) {
    const cb = raw.coverageBaseline as unknown;
    if (cb === null || typeof cb !== 'object' || Array.isArray(cb)) {
      configError(`${OWNERS_JSON_PATH} 的 "coverageBaseline" 必須是物件 { "managed": N, "scanned": M }`);
    }
    const obj = cb as Record<string, unknown>;
    requireConfigType(obj.managed, 'coverageBaseline.managed', 'number', GATE_NAME);
    requireConfigType(obj.scanned, 'coverageBaseline.scanned', 'number', GATE_NAME);
    const managed = obj.managed as number;
    const scannedBaseline = obj.scanned as number;
    if (!Number.isInteger(managed) || managed < 0) {
      configError(`${OWNERS_JSON_PATH} 的 "coverageBaseline.managed" 必須是非負整數(實際:${JSON.stringify(managed)})`);
    }
    if (!Number.isInteger(scannedBaseline) || scannedBaseline <= 0) {
      configError(`${OWNERS_JSON_PATH} 的 "coverageBaseline.scanned" 必須是正整數(實際:${JSON.stringify(scannedBaseline)})`);
    }
    if (managed > scannedBaseline) {
      configError(`${OWNERS_JSON_PATH} 的 "coverageBaseline" 不合理:managed(${managed}) > scanned(${scannedBaseline})`);
    }
  }
  return raw as OwnersConfig;
}

/** 要掃描的副檔名——這個不太需要因專案而異,留在程式裡。 */
const EXTS = ['.ts', '.mts', '.js', '.mjs', '.svelte'];

/**
 * 略過的目錄(S10,見 `_root.ts` 的 `DEFAULT_SKIP_DIRS`)——所有走目錄樹的 gate 共用同一份
 * 清單 + `gates.config.json` 的 `skipDirs` 追加,不准各自宣告自己的 `SKIP_DIRS`
 * (check-boundaries.test.ts 有一條 grep 測試強制這條:任何 `check-*.ts` 都不准再定義
 * 一個長得像獨立略過清單的陣列/集合)。`src-tauri` 是這支腳本原本額外加的一項,不在
 * `DEFAULT_SKIP_DIRS` 的通用清單裡(那是 Tauri 專屬的目錄名,不是每個專案都用得到)——
 * 額外加進來,不影響共用清單本身。gates.config.json 讀不到就是「沒有這份選填設定」,
 * 只用內建預設,不印訊息(跟其餘選填設定同規則)。
 */
function resolveSkipDirsForBoundaries(): Set<string> {
  // gates.config.json 是選填設定(見下方 loadAllow 同一句話):--root 明講時找不到只是
  // 「沒有這份選填設定」,不升級成 hardErrorMessage 那種大聲失敗——那個訊息是留給
  // owners.json 這種必要設定的。
  const cfgPath = findConfigFile('gates.config.json').path;
  const cfg = loadGatesConfig(cfgPath, GATE_NAME);
  const skip = resolveSkipDirs(cfg, GATE_NAME);
  skip.add('src-tauri');
  return skip;
}

interface AllowEdge { from: string; to: string; reason: string }
interface Violation { file: string; line: number; spec: string; from: string; to: string; kind: 'cross' | 'absolute' | 'unmapped-target' | 'glue-target' }

function loadAllow(): AllowEdge[] {
  const p = findConfigFile('boundaries.allow.json').path;
  if (!p) return []; // 選填設定,兩處都沒有就當沒有例外邊,不印訊息(hardErrorMessage 不理會)
  // 解析錯誤在這裡大聲失敗(S9),不會是未捕捉的堆疊。
  const raw = readConfigJson(p, GATE_NAME) as unknown;
  if (!Array.isArray(raw)) configError('boundaries.allow.json 必須是陣列');
  for (const e of raw as AllowEdge[]) {
    if (!e.from || !e.to || !e.reason) configError(`boundaries.allow.json 每一筆都要有 from / to / reason:${JSON.stringify(e)}`);
  }
  return raw as AllowEdge[];
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function ownerOf(owners: OwnersConfig['owners'], relPath: string): string | undefined {
  const posix = toPosix(relPath);
  for (const [prefix, owner] of owners) {
    if (posix === prefix || posix.startsWith(prefix)) return owner;
  }
  return undefined;
}

function* walk(dir: string, skipDirs: Set<string>): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full, skipDirs);
    else if (EXTS.some((e) => name.endsWith(e))) yield full;
  }
}

/** 去掉註解,避免註解裡的 "from '...'" 被誤判 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (_m, pre: string) => pre);
}

const IMPORT_RES: RegExp[] = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function findImports(src: string): { spec: string; line: number }[] {
  const out: { spec: string; line: number }[] = [];
  const clean = stripComments(src);
  for (const re of IMPORT_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) {
      const spec = m[1]!;
      const line = clean.slice(0, m.index).split('\n').length;
      if (!out.some((o) => o.spec === spec && o.line === line)) out.push({ spec, line });
    }
  }
  return out;
}

/**
 * 把 import 說明子轉成 repo 相對路徑。回傳 undefined 表示外部套件或內建模組(不檢查)。
 */
function resolveSpec(
  aliases: OwnersConfig['aliases'],
  fromFile: string,
  spec: string,
): { rel: string } | { external: true } | { absolute: true } {
  if (spec.startsWith('node:')) return { external: true };
  if (spec.startsWith('/')) return { absolute: true };
  if (spec.startsWith('.')) {
    return { rel: toPosix(relative(ROOT, resolve(dirname(fromFile), spec))) };
  }
  for (const [alias, target] of aliases) {
    if (alias.endsWith('/') && spec.startsWith(alias)) return { rel: target + spec.slice(alias.length) };
    if (!alias.endsWith('/') && spec === alias) return { rel: target };
  }
  return { external: true };
}

/**
 * S11(來源 nightmare-assault):把某個 unmapped 檔案歸到「相對掃描根目錄的第一層子目錄」
 * ——例如 `scanDirs` 裡有 `"packages"`,檔案是 `packages/newthing/x.ts`,歸到
 * `packages/newthing`(不是整個 `packages`,那樣看不出是哪個子資料夾漏填;也不是完整
 * 檔案路徑,那樣看不出「這是一整個目錄沒納管」還是「只有一個檔案漏了」)。理論上不會
 * 落到 fallback(unmapped 一定是從某個 scanDir 底下走出來的),防禦性寫法。
 */
function topLevelUnmanagedDir(relPath: string, scanDirs: string[]): string {
  const posix = toPosix(relPath);
  for (const dir of scanDirs) {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    if (posix === dir || posix.startsWith(prefix)) {
      const rest = posix.slice(prefix.length);
      const firstSeg = rest.split('/')[0];
      return firstSeg ? `${dir}/${firstSeg}` : dir;
    }
  }
  return posix.split('/')[0] ?? posix;
}

function formatRatio(managed: number, total: number): string {
  const pct = total > 0 ? ((managed / total) * 100).toFixed(1) : '0.0';
  return `${managed}/${total}(${pct}%)`;
}

/** S11:涵蓋率永遠印,不只在有 unmapped 檔案時才提(PITFALLS P-72——「看起來綠但沒在看
 *  那塊」:落點表只填一半、另一半資料夾從沒被納管過,舊版完全不會提到這件事)。 */
function printCoverage(managed: number, total: number, unmapped: string[], scanDirs: string[]): void {
  const pct = total > 0 ? ((managed / total) * 100).toFixed(1) : '0.0';
  console.log(`涵蓋:納管 ${managed} / 掃描 ${total} 檔(${pct}%),未納管目錄:`);
  if (unmapped.length === 0) {
    console.log('  (無)');
    return;
  }
  const byDir = new Map<string, number>();
  for (const u of unmapped) {
    const key = topLevelUnmanagedDir(u, scanDirs);
    byDir.set(key, (byDir.get(key) ?? 0) + 1);
  }
  for (const [dir, count] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${dir}(${count} 個檔案未納管)`);
  }
}

/** S11:涵蓋率棘輪——`owners.json` 有 `coverageBaseline` 時,這次的納管比例必須 ≥ 基準,
 *  只准升不准降。回傳 `true` 代表棘輪本身判失敗(呼叫端要把這個併進整體 exit code)。 */
function checkCoverageRatchet(
  managed: number,
  total: number,
  baseline: OwnersConfig['coverageBaseline'],
): boolean {
  if (!baseline) return false;
  // 交叉相乘比較,不用浮點除法——避免棘輪卡在浮點誤差的邊界(例如 1/3 vs 33/99)。
  const nowCross = managed * baseline.scanned;
  const baseCross = baseline.managed * total;
  if (nowCross < baseCross) {
    console.log(
      `✗ 涵蓋率下降:${formatRatio(managed, total)} < 基準 ${formatRatio(baseline.managed, baseline.scanned)}(只准升)`,
    );
    return true;
  }
  if (nowCross > baseCross) {
    console.log(`○ 涵蓋率上升,可把基準改成 ${managed}/${total}`);
  }
  return false;
}

function main(): void {
  const config = loadOwnersConfig();
  const allow = loadAllow();
  const skipDirs = resolveSkipDirsForBoundaries();
  const glue = new Set(config.glue.map(glueOwnerName));
  const glueTargetForbidden = new Set(config.glue.filter(isGlueTargetForbidden).map(glueOwnerName));
  const violations: Violation[] = [];
  const unmapped: string[] = [];
  let scanned = 0;
  // found = walk() 真的在磁碟上找到的原始檔數;scanned = 有落點、非膠水、真的看了 import 的數量。
  // 兩個都是 0 的時候掃描器是瞎的,不是 repo 很乾淨。
  let found = 0;

  for (const dir of config.scanDirs) {
    for (const file of walk(join(ROOT, dir), skipDirs)) {
      found++;
      const rel = toPosix(relative(ROOT, file));
      const from = ownerOf(config.owners, rel);
      if (!from) { unmapped.push(rel); continue; }
      if (VERBOSE) console.log(`  ${rel}  →  ${from}`);
      if (glue.has(from)) continue;
      scanned++;
      const src = readFileSync(file, 'utf8');
      for (const { spec, line } of findImports(src)) {
        const r = resolveSpec(config.aliases, file, spec);
        if ('external' in r) continue;
        if ('absolute' in r) { violations.push({ file: rel, line, spec, from, to: '(absolute)', kind: 'absolute' }); continue; }
        if (r.rel.startsWith('..')) { violations.push({ file: rel, line, spec, from, to: '(outside repo)', kind: 'absolute' }); continue; }
        const to = ownerOf(config.owners, r.rel);
        if (!to) { violations.push({ file: rel, line, spec, from, to: '(unmapped)', kind: 'unmapped-target' }); continue; }
        // glue 的「不准被 import」比 contractsOwner 的一律放行更優先——明講的角色設定
        // 應該贏過預設的寬容,不然這條規則永遠生效不了(from 已經在上面被排除,
        // 所以這裡的 to 不會等於 from 本身,不會誤傷 glue 擁有者自己內部的 import)。
        if (glueTargetForbidden.has(to)) { violations.push({ file: rel, line, spec, from, to, kind: 'glue-target' }); continue; }
        if (to === from || to === config.contractsOwner) continue;
        if (allow.some((e) => e.from === from && e.to === to)) continue;
        violations.push({ file: rel, line, spec, from, to, kind: 'cross' });
      }
    }
  }

  console.log(`boundaries: 掃描 ${scanned} 個檔案,允許例外 ${allow.length} 條`);

  // S11(來源 nightmare-assault):涵蓋率永遠印,不只在有 unmapped 時才提——舊版「只在
  // checked==0 時宣稱不乾淨,其餘情況完全不提涵蓋了多少」,一個落點表**故意**只填一半
  // (例如只填了 packages/,apps/ 整個資料夾從沒被納管過)在舊版看起來跟「落點表填好了」
  // 一模一樣是綠燈,PITFALLS P-72。
  const coverageManaged = found - unmapped.length;
  printCoverage(coverageManaged, found, unmapped, config.scanDirs);
  const ratchetFailed = checkCoverageRatchet(coverageManaged, found, config.coverageBaseline);

  if (unmapped.length) {
    console.log(`\n✗ ${unmapped.length} 個檔案不在任何功能的落點內(見 ${OWNERS_JSON_PATH} 的 owners 表):`);
    for (const u of unmapped) console.log(`  ${u}`);
  }
  if (violations.length) {
    console.log(`\n✗ ${violations.length} 個違規 import:`);
    for (const v of violations) {
      const why =
        v.kind === 'cross' ? `${v.from} → ${v.to}`
        : v.kind === 'absolute' ? '絕對路徑或跳出 repo'
        : v.kind === 'glue-target' ? `glue 不准被 import(${v.to})`
        : `目標 ${v.spec} 不在任何落點內`;
      console.log(`  ${v.file}:${v.line}  import '${v.spec}'  (${why})`);
    }
    console.log(`\nWave 0 只能 import contracts/ 與自己的目錄。整合後要跨功能,把邊加進 scripts/boundaries.allow.json 並附理由。`);
  }
  if (found === 0 || scanned === 0) {
    console.log(`\n✗ boundaries: 掃描到 0 個檔案(walk 找到 ${found} 個原始檔,實際檢查 ${scanned} 個)`);
    console.log(`${SCANNER_BROKEN}。owners.json 的 owners 表、scanDirs,或程式裡的 SKIP_DIRS / EXTS 壞掉時就長這樣。`);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=${scanned}`);
    process.exit(1);
  }

  if (!unmapped.length && !violations.length && !ratchetFailed) console.log('✓ 無違規');
  const fail = unmapped.length > 0 || violations.length > 0 || ratchetFailed;
  console.log(`gate=${GATE_NAME} result=${fail ? 'FAIL' : 'PASS'} scanned=${scanned}`);
  process.exit(fail ? 1 : 0);
}

main();
