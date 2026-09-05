// SOURCE: template v1.4.2 (1c1d403) sha256=80d384ea2d1f7382908730933e93ecc3c516347dee4c72d14e3155a5eb589898 — 勿手改;升版用 sync-gates.sh
/**
 * 步驟重複檢查(見 docs/03-agile-workflow.md「便宜的模型做機械工作」與 PITFALLS.md P-02)。
 *
 * 背景:cucumber 對「同一句話有兩個定義」的容忍度是 0——只要兩個定義的形狀都能匹配
 * 到同一句 Gherkin 文字,cucumber 就會在跑到那句時炸成 ambiguous step。這是唯一真正
 * 會讓 cucumber 崩潰的不變量:**同一個步驟形狀,全專案只准有一個定義**,不管那個定義
 * 住在哪個 *.steps.ts 檔。
 *
 * 這支腳本刻意**不**檢查「有沒有進 common.steps.ts」——那是代理指標,兩個方向都會誤判:
 *   - 假綠:一句話被定義了 3 次,其中一次剛好在 common.steps.ts 裡,「有沒有在 common」
 *     這個問法會放行,但 cucumber 一樣會因為另外兩個重複定義而炸。
 *   - 假紅:一句只描述單一能力的話(例如「the current question is an apply question」),
 *     被 docs/integration 的整合場景直接重用、定義住在該能力自己的 steps 檔——這完全正常
 *     (整合場景本來就該重用能力層的字彙),但只看「有沒有在 common」會誤判成缺陷。
 * 守門只對著「恰好一個定義」這個不變量,不對著「住在哪個檔案」這個代理指標。
 *
 * 規則:
 *   1. 掃 features/<NN-name>/**\/*.feature 與 docs/integration/**\/*.feature,
 *      每個 Given/When/Then/And/But 步驟句正規化:去掉開頭關鍵字、引號內容 → {string}、
 *      獨立數字 → {int}、<param> → {param}、去頭尾空白
 *   2. 掃 features/steps/*.steps.ts **全部**(不只 common.steps.ts),用正規表達式抓
 *      Given(/When(/Then( 開頭、緊接引號或 / 的定義,建一個「正規化形狀 → 定義它的檔案清單」
 *      的 Map。cucumber expression 的所有參數型別({string}/{int}/{}/{word}/...)與
 *      regex 的捕獲群都正規化成同一個萬用字 {},跟步驟句那邊的 {string}/{int}/{param}
 *      也統一收斂成 {} 再比對形狀是否相同
 *   3. 對每個出現在 feature 檔裡的步驟形狀(不限跨幾個資料夾):
 *        定義 0 次 → 不歸這支管(cucumber --strict 跑下去會判 undefined,那是另一道檢查)
 *        定義 1 次 → OK,不管那個定義住在哪個 *.steps.ts 檔
 *        定義 ≥2 次 → 列出這句話與每個定義所在的檔案,退出 1
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析,不在 git repo 裡則退回 cwd):
 *   npx tsx scripts/check-step-dup.ts               # 複製進 repo 後執行
 *   npx tsx <template>/scripts/check-step-dup.ts    # 從模板路徑直接執行,cwd 需在目標 repo
 *   npx tsx scripts/check-step-dup.ts --list        # 列出每個跨 ≥2 資料夾的句子與它的定義檔清單
 *                                                    # (0 個定義印 "(undefined)"),不判斷退出碼
 *
 * 退出碼:
 *   0  沒有被定義 ≥2 次的步驟形狀
 *   1  有步驟形狀被定義 ≥2 次;或掃到 0 個 .feature 檔 / 0 個步驟句(這不是很乾淨,是掃描器壞了)
 *
 * 反向驗證(用根目錄 scripts/ 暫放這支腳本的方式對真實資料跑,跑完刪除暫存檔案,
 * 確認 `git status` 乾淨,不要留下改動):
 *   (a) 挑一句已經定義在 features/steps/common.steps.ts 的句子(例如
 *       `it exits with status {int}`),把整行原樣複製貼進另一個能力的 *.steps.ts
 *       (例如 features/steps/scheduler.steps.ts)。重跑這支腳本 → 應該紅,列出這句話與
 *       兩個定義檔(common.steps.ts 與 scheduler.steps.ts)。
 *   (b) 刪掉剛貼的那個定義,還原檔案 → 重跑 → 應該綠。
 *   (c) 找一句只定義在某個能力自己的 *.steps.ts、但被 docs/integration 的場景重用的句子
 *       (常見情況:整合場景直接寫該能力 phase-1 已經在用的斷言字彙)。確認它不在失敗清單裡
 *       (跨資料夾但恰好 1 個定義 → OK)→ 綠,不用改任何檔案。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_SKIP_DIRS, ROOT, loadGatesConfig, requireConfigType, resolveConfig } from './_root.js';

/** 這支腳本在 gate 機器可讀標記(見 CHANGELOG 1.3.2 (C))裡的名字。 */
const GATE_NAME = 'step-dup';

const LIST_ONLY = process.argv.includes('--list');
const STEPS_DIR = join(ROOT, 'features/steps');

const FAILURE_MESSAGE =
  "Keep exactly ONE definition: a sentence about one capability lives in that capability's steps file " +
  '(integration features reuse it); a sentence genuinely shared by several capabilities lives in ' +
  'features/steps/common.steps.ts (coordinator-owned).';

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

/** S10:跟其餘會走目錄樹的 gate 共用同一份略過清單。 */
function resolveSkipDirsForStepDup(): Set<string> {
  const p = resolveConfig(import.meta.dirname, 'gates.config.json');
  const cfg = loadGatesConfig(p, GATE_NAME);
  if (cfg?.skipDirs !== undefined) requireConfigType(cfg.skipDirs, 'skipDirs', 'array', GATE_NAME);
  const extra = Array.isArray(cfg?.skipDirs) ? (cfg.skipDirs as unknown[]).filter((s): s is string => typeof s === 'string') : [];
  return new Set([...DEFAULT_SKIP_DIRS, ...extra]);
}

function* walk(dir: string, skipDirs: Set<string>): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full, skipDirs);
    else if (name.endsWith('.feature')) yield full;
  }
}

/** features/<NN-name>/... → "features/<NN-name>";docs/integration/... → "docs/integration";其餘 undefined(不算目標,例如 features/_template)。 */
function folderOf(relPath: string): string | undefined {
  const posix = toPosix(relPath);
  const m = posix.match(/^features\/(\d{2}-[^/]+)\//);
  if (m) return `features/${m[1]}`;
  if (posix.startsWith('docs/integration/')) return 'docs/integration';
  return undefined;
}

function collectFeatureFiles(): string[] {
  const skipDirs = resolveSkipDirsForStepDup();
  const all = [...walk(join(ROOT, 'features'), skipDirs), ...walk(join(ROOT, 'docs/integration'), skipDirs)];
  return all.filter((f) => folderOf(toPosix(relative(ROOT, f))) !== undefined);
}

interface StepOccurrence { folder: string; file: string; line: number; raw: string }

const STEP_LINE_RE = /^\s*(?:Given|When|Then|And|But)\s+(.*\S)\s*$/;

function extractSteps(file: string): { line: number; raw: string }[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out: { line: number; raw: string }[] = [];
  lines.forEach((line, i) => {
    const m = line.match(STEP_LINE_RE);
    if (m) out.push({ line: i + 1, raw: m[1]! });
  });
  return out;
}

/** 步驟句正規化:去掉開頭關鍵字(呼叫端已處理)、引號內容 → {string}、獨立數字 → {int}、<param> → {param}。 */
function normalize(raw: string): string {
  return raw
    .replace(/"[^"]*"/g, '{string}')
    .replace(/<[^>]+>/g, '{param}')
    .replace(/\b\d+\b/g, '{int}')
    .trim();
}

/** 把正規化後的步驟句再收斂一層:{string}/{int}/{param} 全部變成同一個萬用字 {},跟定義那邊的形狀比對。 */
function genericize(normalized: string): string {
  return normalized.replace(/\{string\}|\{int\}|\{param\}/g, '{}');
}

/** 解析字串字面值(從 quoteChar 後一個字元開始),回傳值與結尾索引(quote 之後那個位置)。 */
function parseStringLiteral(src: string, start: number, quoteChar: string): { value: string; end: number } | undefined {
  let i = start;
  let value = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      value += src[i + 1];
      i += 2;
      continue;
    }
    if (c === quoteChar) return { value, end: i + 1 };
    value += c;
    i++;
  }
  return undefined;
}

/** 解析 regex 字面值(從第一個 / 之後開始),回傳 source 與結尾索引(flags 之後那個位置)。 */
function parseRegexLiteral(src: string, start: number): { source: string; end: number } | undefined {
  let i = start;
  let source = '';
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      source += c + src[i + 1];
      i += 2;
      continue;
    }
    if (c === '[') inClass = true;
    if (c === ']') inClass = false;
    if (c === '/' && !inClass) {
      let j = i + 1;
      while (j < src.length && /[a-z]/i.test(src[j]!)) j++;
      return { source, end: j };
    }
    source += c;
    i++;
  }
  return undefined;
}

/** 去掉註解,避免註解掉的定義(例如反向驗證時 `// Then(...)`)被誤判成還活著。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (_m, pre: string) => pre);
}

/** cucumber expression 的字串定義 → 形狀 key:任何 {word} 參數(不管型別)都收斂成 {}。 */
function literalToKey(lit: string): string {
  return lit.replace(/\{[A-Za-z0-9_]*\}/g, '{}');
}

/** regex 定義 → 形狀 key:去掉 ^ $ 錨點,把捕獲群(不處理巢狀)換成 {}。其餘 regex 語法原樣保留,
 * 只用來跟其他定義的 key 做字面比對(偵測「複製貼上同一個定義」這種真的會撞名的情況),
 * 不是完整的 regex 語意比較。 */
function regexToKey(source: string): string {
  let body = source;
  if (body.startsWith('^')) body = body.slice(1);
  if (body.endsWith('$')) body = body.slice(0, -1);
  return body.replace(/\((?:\?:)?[^()]*\)/g, '{}');
}

function extractDefinitionKeys(rawSrc: string): string[] {
  const src = stripComments(rawSrc);
  const keys: string[] = [];
  const callRe = /\b(?:Given|When|Then)\s*\(\s*/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(src)) !== null) {
    const after = m.index + m[0].length;
    const next = src[after];
    if (next === '"' || next === "'" || next === '`') {
      const parsed = parseStringLiteral(src, after + 1, next);
      if (parsed) keys.push(literalToKey(parsed.value));
    } else if (next === '/') {
      const parsed = parseRegexLiteral(src, after + 1);
      if (parsed) keys.push(regexToKey(parsed.source));
    }
    // 其餘(例如 `for (const phrase of [...]) { Then(phrase, ...) }` 這種變數形式)不是
    // 「直接以引號或 / 開頭」的定義,略過——這是這支腳本刻意的限制,見檔頭註解。
  }
  return keys;
}

function collectStepDefinitionFiles(): string[] {
  if (!existsSync(STEPS_DIR)) return [];
  return readdirSync(STEPS_DIR)
    .filter((name) => name.endsWith('.steps.ts'))
    .map((name) => join(STEPS_DIR, name));
}

function buildDefinitionsByKey(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of collectStepDefinitionFiles()) {
    const rel = toPosix(relative(ROOT, file));
    const src = readFileSync(file, 'utf8');
    for (const key of extractDefinitionKeys(src)) {
      const list = map.get(key) ?? [];
      list.push(rel);
      map.set(key, list);
    }
  }
  return map;
}

interface Group { folders: Set<string>; occurrences: StepOccurrence[]; displayTexts: Set<string> }

function main(): void {
  const files = collectFeatureFiles();
  if (files.length === 0) {
    console.log('✗ 掃到 0 個 .feature 檔(features/**/*.feature 或 docs/integration/**/*.feature)。這不是很乾淨,是掃描器壞了。');
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  const groups = new Map<string, Group>();
  for (const file of files) {
    const rel = toPosix(relative(ROOT, file));
    const folder = folderOf(rel)!;
    for (const { line, raw } of extractSteps(file)) {
      const normalized = normalize(raw);
      const key = genericize(normalized);
      let g = groups.get(key);
      if (!g) { g = { folders: new Set(), occurrences: [], displayTexts: new Set() }; groups.set(key, g); }
      g.folders.add(folder);
      g.occurrences.push({ folder, file: rel, line, raw });
      g.displayTexts.add(normalized);
    }
  }

  let totalSteps = 0;
  for (const g of groups.values()) totalSteps += g.occurrences.length;
  if (totalSteps === 0) {
    console.log('✗ 掃到 0 個步驟句。這不是很乾淨,是掃描器壞了。');
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  const defsByKey = buildDefinitionsByKey();
  const defCount = [...defsByKey.values()].reduce((n, l) => n + l.length, 0);
  const stepFiles = collectStepDefinitionFiles();

  console.log(
    `step-dup: 掃描 ${files.length} 個 .feature 檔,${totalSteps} 個步驟句,${groups.size} 種正規化形狀;` +
      `features/steps/*.steps.ts 共 ${stepFiles.length} 個檔案,${defCount} 個可解析定義`,
  );

  const crossFolder = [...groups.entries()].filter(([, g]) => g.folders.size >= 2);

  if (LIST_ONLY) {
    for (const [key, g] of crossFolder.sort((a, b) => b[1].folders.size - a[1].folders.size)) {
      const defFiles = defsByKey.get(key) ?? [];
      const label = [...g.displayTexts].join(' | ');
      console.log(`  [${g.folders.size} 資料夾]  ${label}`);
      console.log(`      定義於:${defFiles.length ? defFiles.join(', ') : '(undefined)'}`);
    }
    console.log(`gate=${GATE_NAME} result=PASS scanned=${totalSteps}`);
    process.exit(0);
  }

  const duplicated = [...groups.entries()].filter(([key]) => (defsByKey.get(key) ?? []).length >= 2);
  if (duplicated.length) {
    console.log(`\n✗ ${FAILURE_MESSAGE}`);
    console.log(`\n${duplicated.length} 句被定義了 ≥2 次:`);
    for (const [key, g] of duplicated) {
      const defFiles = defsByKey.get(key)!;
      const label = [...g.displayTexts].join(' | ');
      console.log(`  "${label}"`);
      console.log(`      定義於:${defFiles.join(', ')}`);
      console.log(`      用於:${[...g.folders].sort().join(', ')}`);
    }
    console.log(`gate=${GATE_NAME} result=FAIL scanned=${totalSteps}`);
    process.exit(1);
  }

  console.log(`✓ 無重複定義(跨資料夾形狀 ${crossFolder.length} 種,每種都恰好 0 或 1 個定義)`);
  console.log(`gate=${GATE_NAME} result=PASS scanned=${totalSteps}`);
  process.exit(0);
}

main();
