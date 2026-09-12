// SOURCE: template v1.6.4 (4dc1513) sha256=3ef1cdf2b2dcf3ad79a11f03219f2a359bc30c07ee2d6e761318d0d1148283e9 — 勿手改;升版用 sync-gates.sh
/**
 * 模組命名空間轉型守門(P-88,來源 AI_KM 顧問 2026-09-08)。
 *
 * 背景:steps 檔裡這樣呼叫實作——
 *
 *   import * as core from '../../packages/core/src/index.js';
 *   const api = core as unknown as { computeDue: (x: Input) => Output };
 *   api.computeDue(input);
 *
 * ——會讓兩道守門對「有人把 `computeDue` 刪了(或改名)」同時瞎掉:`tsc` 看到的是
 * `unknown` 再轉成一個手寫的物件型別,實作有沒有那個函式它不管;grep 找 `core.computeDue`
 * 也找不到(呼叫的是 `api.computeDue`,而 `api` 的型別是手寫的)。函式真的消失時,只有
 * 真跑那個場景才會炸 `api.computeDue is not a function`——而那個場景可能在別人的 tag 底下。
 *
 * 只擋**模組命名空間**那一種轉型:`<namespace> as unknown as …`,其中 `<namespace>` 是
 * 同一個檔案裡 `import * as X from` 或 `import X = require(...)` 引進來的名字;另外擋
 * `import('…') as unknown as` / `require('…') as unknown as` 這種對動態載入結果直接轉型。
 * **不**全掃 `as unknown as`——AI_KM 實測全掃是 23 抓 2,其餘 21 個是對值(測試資料、
 * 第三方回傳值)的正常轉型,一律擋會逼人把守門放寬,放寬之後真的那 2 個也一起放掉。
 * 守門只對著會讓別的守門瞎掉的那一種,不對著語法本身。
 *
 * 掃描範圍:`gates.config.json` 的 `moduleCast.scanDirs`(相對 ROOT 的目錄陣列),沒填就是
 * `["features/steps"]`。底下所有 `.ts` / `.tsx` / `.mts` / `.cts`(不含 `.d.ts`),略過
 * `_root.ts` 的 DEFAULT_SKIP_DIRS + `gates.config.json` 的 `skipDirs`。註解裡的內容先剝掉
 * 再比對(反向驗證時 `// const api = core as unknown as …` 不算)。
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析;`--root <dir>` 明講的話優先):
 *   npx tsx scripts/check-module-cast.ts
 *   npx tsx scripts/check-module-cast.ts --root <dir>
 *
 * 退出碼:0 掃到 ≥1 個檔案且 0 個命中;1 有命中、掃到 0 個檔案(掃描器壞了)、設定檔壞掉。
 * gate 標記:`gate=module-cast result=PASS|FAIL scanned=<檔案數>`。
 *
 * 反向驗證:
 *   (a) 在任一 steps 檔加 `import * as m from './_world.js'; const x = m as unknown as { f: () => void };`
 *       → 應該紅,印出 檔案:行號 與那一行。
 *   (b) 把同一行改成 `const x = someValue as unknown as { f: () => void };`(`someValue` 不是
 *       命名空間)→ 應該綠——這是「只擋那一種」的證明。
 *   (c) 把 (a) 那行整行註解掉 → 應該綠。
 *   `check-module-cast.test.ts` 把 (a)–(c) 做成自動測試。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  ROOT as GIT_ROOT,
  loadGatesConfig,
  lookupConfig,
  requireConfigType,
  requireRootDir,
  resolveSkipDirs,
} from './_root.js';

/** 所有掃描器共用的那句話。0 個目標的紅,方向永遠是「掃描器壞了」。 */
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

/** 這支腳本在 gate 機器可讀標記裡的名字。 */
const GATE_NAME = 'module-cast';

const DEFAULT_SCAN_DIRS = ['features/steps'];

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ROOT_EXPLICIT = argValue('--root') !== undefined;
const ROOT = resolve(argValue('--root') ?? GIT_ROOT);
requireRootDir(ROOT, ROOT_EXPLICIT, GATE_NAME);

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

/** 委派給 `_root.ts` 的 `lookupConfig`(S14,PITFALLS P-73):`--root` 明講時不退回這支
 *  腳本自己所在的目錄。gates.config.json 對這支腳本是選填(`moduleCast.scanDirs`、
 *  `skipDirs`),找不到就用預設,不理會 hardErrorMessage。 */
function findConfigFile(name: string): string | undefined {
  const result = lookupConfig(import.meta.dirname, name, { root: ROOT, rootExplicit: ROOT_EXPLICIT });
  console.log(`${name}: ${result.source}`);
  return result.path;
}

interface Settings { scanDirs: string[]; skipDirs: Set<string> }

function loadSettings(): Settings {
  const p = findConfigFile('gates.config.json');
  // 解析錯誤、不認識的頂層鍵都在這裡大聲失敗(S9),不是未捕捉的堆疊。
  const raw = loadGatesConfig(p, GATE_NAME);
  const skipDirs = resolveSkipDirs(raw, GATE_NAME);
  const section = raw?.moduleCast;
  if (section === undefined) return { scanDirs: DEFAULT_SCAN_DIRS, skipDirs };
  requireConfigType(section, 'moduleCast', 'object', GATE_NAME);
  const scanDirs = (section as { scanDirs?: unknown }).scanDirs;
  if (scanDirs === undefined) return { scanDirs: DEFAULT_SCAN_DIRS, skipDirs };
  requireConfigType(scanDirs, 'moduleCast.scanDirs', 'array', GATE_NAME);
  const list = (scanDirs as unknown[]).filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (list.length === 0) {
    console.error(`✗ ${p} 的 "moduleCast.scanDirs" 是空陣列(要掃哪些目錄?沒填就刪掉這個欄位用預設 ${JSON.stringify(DEFAULT_SCAN_DIRS)})`);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }
  return { scanDirs: list, skipDirs };
}

const SOURCE_EXT_RE = /\.(?:ts|tsx|mts|cts)$/;

function* walk(dir: string, skipDirs: Set<string>): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full, skipDirs);
    else if (SOURCE_EXT_RE.test(name) && !name.endsWith('.d.ts')) yield full;
  }
}

/** 去掉註解但保留換行(行號不變),避免註解掉的轉型被誤判成還活著。 */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (_m, pre: string) => pre);
}

/** 這個檔案裡以命名空間形式引進的模組名字:`import * as X from` 與 `import X = require(`。 */
export function namespaceImports(src: string): string[] {
  const names = new Set<string>();
  const star = /\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\b/g;
  const eqRequire = /\bimport\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = star.exec(src)) !== null) names.add(m[1]!);
  while ((m = eqRequire.exec(src)) !== null) names.add(m[1]!);
  return [...names];
}

export interface CastHit { line: number; text: string; reason: string }

/** 對一個檔案的原始碼找「模組命名空間轉型」。回傳每個命中的行號、原文、理由。 */
export function findModuleCasts(rawSrc: string): CastHit[] {
  const src = stripComments(rawSrc);
  const names = namespaceImports(src);
  const hits: CastHit[] = [];
  const lines = src.split('\n');
  const rawLines = rawSrc.split('\n');
  const nsRe = names.length ? new RegExp(`\\b(${names.map((n) => n.replace(/\$/g, '\\$')).join('|')})\\s+as\\s+unknown\\s+as\\b`) : undefined;
  // `(await import('./x.js')) as unknown as` / `require('./x.js') as unknown as`:對動態載入結果直接轉型。
  const dynRe = /\b(?:import|require)\s*\([^)]*\)\s*\)?\s*as\s+unknown\s+as\b/;
  lines.forEach((line, i) => {
    if (nsRe) {
      const m = line.match(nsRe);
      if (m) {
        hits.push({ line: i + 1, text: rawLines[i]!.trim(), reason: `命名空間 \`${m[1]}\`(import * as ${m[1]})被 as unknown as 轉型` });
        return;
      }
    }
    if (dynRe.test(line)) {
      hits.push({ line: i + 1, text: rawLines[i]!.trim(), reason: '動態 import()/require() 的結果被 as unknown as 轉型' });
    }
  });
  return hits;
}

function main(): void {
  const { scanDirs, skipDirs } = loadSettings();
  const files: string[] = [];
  for (const d of scanDirs) files.push(...walk(resolve(ROOT, d), skipDirs));
  files.sort();

  console.log(`module-cast: 掃描 ${scanDirs.join(', ')} 底下 ${files.length} 個 .ts 檔`);
  if (files.length === 0) {
    console.log(
      `✗ 掃到 0 個 .ts 檔(找過 ${scanDirs.map((d) => resolve(ROOT, d)).join('、')})。${SCANNER_BROKEN}` +
        ' steps 目錄不在預設位置的話,在 gates.config.json 填 "moduleCast": { "scanDirs": ["<目錄>"] }。',
    );
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  const allHits: { file: string; hit: CastHit }[] = [];
  for (const f of files) {
    const rel = toPosix(relative(ROOT, f));
    for (const hit of findModuleCasts(readFileSync(f, 'utf8'))) allHits.push({ file: rel, hit });
  }

  if (allHits.length) {
    console.log(`\n✗ ${allHits.length} 處模組命名空間轉型(P-88):`);
    for (const { file, hit } of allHits) {
      console.log(`  ${file}:${hit.line}  ${hit.text}`);
      console.log(`      ${hit.reason}`);
    }
    console.log(
      '\n  這種轉型讓 typecheck 跟 grep 都看不見「那個函式被刪了/改名了」——實作真的少了那個函式,只有真跑到那個場景才會炸,' +
        '而那個場景可能在別人的 tag 底下。改成具名 import(`import { computeDue } from …`)讓 tsc 守住;' +
        '型別真的對不上就修契約或加 adapter,不要用 as unknown as 蓋過去。',
    );
    console.log(`gate=${GATE_NAME} result=FAIL scanned=${files.length}`);
    process.exit(1);
  }

  console.log(`✓ 0 處模組命名空間轉型(${files.length} 個檔案)`);
  console.log(`gate=${GATE_NAME} result=PASS scanned=${files.length}`);
  process.exit(0);
}

main();
