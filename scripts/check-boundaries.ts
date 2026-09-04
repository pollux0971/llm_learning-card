// SOURCE: template v1.3.4 (eb04f73) sha256=e883fc23acd99947eae48a23dbb83f63838e4e2f58f7eee3768880a7b1022209 — 勿手改;升版用 sync-gates.sh
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
 *     "glue": ["infra", "steps"],                               // 這些擁有者可以 import 任何東西
 *     "aliases": [["@contracts/", "packages/contracts/src/"], ...],
 *     "scanDirs": ["packages", "apps", "scripts"],
 *     "contractsOwner": "contracts"                             // 對到這個擁有者的 import 一律放行
 *   }
 *
 * 不存在就 exit 1 並印出範例——這是硬性要求的設定,不是「留空也能跑」。
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
import { ROOT as GIT_ROOT } from './_root.js';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ROOT = resolve(argValue('--root') ?? GIT_ROOT);
const VERBOSE = process.argv.includes('--verbose');

/** 三支掃描器共用的那句話。看到它就知道方向是「掃描器壞了」,不是「程式碼很乾淨」。 */
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

/** 這支腳本在 gate 機器可讀標記(見 CHANGELOG 1.3.2 (C))裡的名字。 */
const GATE_NAME = 'boundaries';

/**
 * 找一份設定檔(`boundaries.owners.json` / `boundaries.allow.json`)的順序(env 優先權
 * 見 CHANGELOG 1.3.4 (3)):
 *   0. 環境變數 `GATES_CONFIG_DIR`(若設且該目錄存在)——`verify-against.sh` 跑模板版
 *      `check-boundaries.ts` 時會設這個,不然「這支腳本自己所在的目錄」(順位 1)在那個
 *      情境下是模板自己的 `scripts/`(佔位 owners.json),永遠比不出跟 consumer 一致。
 *   1. 這支腳本自己所在的目錄(sync 後就是 consumer 的安裝目錄,例如 `features/scripts/`)
 *   2. `<ROOT>/scripts/`(ROOT 是上面算出來的那個,`--root` 覆蓋時用覆蓋值,不是全域 git root——
 *      這支腳本本來就支援對別的 repo 跑,設定檔搜尋要跟著同一個 ROOT 走;這也是這支腳本沒有
 *      直接用 `_root.ts` 的 `resolveConfig` 的原因——那支用的是模組層級固定的 git ROOT,
 *      不會跟著 `--root` 走)
 * 三處都沒有 → 回傳 undefined,呼叫端決定必要設定要不要印「設定檔未找到於 <搜尋過的路徑>」並 exit 1。
 */
function configSearchPathsList(name: string): string[] {
  const paths: string[] = [];
  const envDir = process.env.GATES_CONFIG_DIR;
  if (envDir && existsSync(envDir)) {
    paths.push(join(envDir, name));
  }
  paths.push(join(import.meta.dirname, name), join(ROOT, 'scripts', name));
  return paths;
}

function findConfigFile(name: string): string | undefined {
  for (const c of configSearchPathsList(name)) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

function configSearchPathsDisplay(name: string): string {
  return configSearchPathsList(name).join('、');
}

interface OwnersConfig {
  /** 落點 → 擁有的功能。順序有意義:先比對較長的前綴。 */
  owners: [prefix: string, owner: string][];
  /** 這些擁有者是「膠水」,可以 import 任何東西,不當作來源檢查。 */
  glue: string[];
  /** import alias → 對到的 repo 相對路徑前綴。 */
  aliases: [alias: string, target: string][];
  /** 要掃描的根目錄(相對 ROOT)。 */
  scanDirs: string[];
  /** 對到這個擁有者的 import 一律放行(不算跨界),通常是 contracts。 */
  contractsOwner: string;
}

const OWNERS_JSON_PATH = 'scripts/boundaries.owners.json';

const OWNERS_EXAMPLE = `{
  "owners": [
    ["packages/contracts/", "contracts"],
    ["contracts/", "contracts"],
    ["packages/core/src/{{FEATURE_SRC_DIR}}/", "{{FEATURE_OWNER}}"],
    ["features/steps/", "steps"]
  ],
  "glue": ["infra", "steps"],
  "aliases": [
    ["@contracts/", "packages/contracts/src/"],
    ["@core/", "packages/core/src/"]
  ],
  "scanDirs": ["packages", "apps", "scripts"],
  "contractsOwner": "contracts"
}`;

function loadOwnersConfig(): OwnersConfig {
  const p = findConfigFile('boundaries.owners.json');
  if (!p) {
    console.error(`✗ 設定檔未找到於 ${configSearchPathsDisplay('boundaries.owners.json')}`);
    console.error(
      'boundaries 需要這份設定檔才知道落點表 / glue / alias 對映 / 掃描範圍(程式跟設定分開,見這支腳本檔頭的說明)。範例:\n',
    );
    console.error(OWNERS_EXAMPLE);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<OwnersConfig>;
  if (!Array.isArray(raw.owners) || raw.owners.length === 0) {
    throw new Error(`${OWNERS_JSON_PATH} 的 "owners" 必須是非空陣列`);
  }
  if (!Array.isArray(raw.glue)) throw new Error(`${OWNERS_JSON_PATH} 缺 "glue"(陣列,可以是空的)`);
  if (!Array.isArray(raw.aliases)) throw new Error(`${OWNERS_JSON_PATH} 缺 "aliases"(陣列,可以是空的)`);
  if (!Array.isArray(raw.scanDirs) || raw.scanDirs.length === 0) {
    throw new Error(`${OWNERS_JSON_PATH} 的 "scanDirs" 必須是非空陣列`);
  }
  if (!raw.contractsOwner || typeof raw.contractsOwner !== 'string') {
    throw new Error(`${OWNERS_JSON_PATH} 缺 "contractsOwner"(字串)`);
  }
  return raw as OwnersConfig;
}

/** 要掃描的副檔名與略過的目錄——這兩個不太需要因專案而異,留在程式裡。 */
const EXTS = ['.ts', '.mts', '.js', '.mjs', '.svelte'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.svelte-kit', 'src-tauri']);

interface AllowEdge { from: string; to: string; reason: string }
interface Violation { file: string; line: number; spec: string; from: string; to: string; kind: 'cross' | 'absolute' | 'unmapped-target' }

function loadAllow(): AllowEdge[] {
  const p = findConfigFile('boundaries.allow.json');
  if (!p) return []; // 選填設定,兩處都沒有就當沒有例外邊,不印訊息
  const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown;
  if (!Array.isArray(raw)) throw new Error('boundaries.allow.json 必須是陣列');
  for (const e of raw as AllowEdge[]) {
    if (!e.from || !e.to || !e.reason) throw new Error(`boundaries.allow.json 每一筆都要有 from / to / reason:${JSON.stringify(e)}`);
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

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
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

function main(): void {
  const config = loadOwnersConfig();
  const allow = loadAllow();
  const glue = new Set(config.glue);
  const violations: Violation[] = [];
  const unmapped: string[] = [];
  let scanned = 0;
  // found = walk() 真的在磁碟上找到的原始檔數;scanned = 有落點、非膠水、真的看了 import 的數量。
  // 兩個都是 0 的時候掃描器是瞎的,不是 repo 很乾淨。
  let found = 0;

  for (const dir of config.scanDirs) {
    for (const file of walk(join(ROOT, dir))) {
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
        if (to === from || to === config.contractsOwner) continue;
        if (allow.some((e) => e.from === from && e.to === to)) continue;
        violations.push({ file: rel, line, spec, from, to, kind: 'cross' });
      }
    }
  }

  console.log(`boundaries: 掃描 ${scanned} 個檔案,允許例外 ${allow.length} 條`);

  if (unmapped.length) {
    console.log(`\n✗ ${unmapped.length} 個檔案不在任何功能的落點內(見 ${OWNERS_JSON_PATH} 的 owners 表):`);
    for (const u of unmapped) console.log(`  ${u}`);
  }
  if (violations.length) {
    console.log(`\n✗ ${violations.length} 個違規 import:`);
    for (const v of violations) {
      const why = v.kind === 'cross' ? `${v.from} → ${v.to}` : v.kind === 'absolute' ? '絕對路徑或跳出 repo' : `目標 ${v.spec} 不在任何落點內`;
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

  if (!unmapped.length && !violations.length) console.log('✓ 無違規');
  console.log(`gate=${GATE_NAME} result=${unmapped.length || violations.length ? 'FAIL' : 'PASS'} scanned=${scanned}`);
  process.exit(unmapped.length || violations.length ? 1 : 0);
}

main();
