/**
 * 邊界檢查(ADR-021 / ADR-035)。
 *
 * 規則:每個功能的程式碼只准 import
 *   1. 自己的落點(見 packages/core/README.md 的表)
 *   2. contracts/ 與 packages/contracts/
 *   3. node 內建模組與 node_modules
 *   4. scripts/boundaries.allow.json 明列的例外邊(整合後逐條加,附理由)
 *
 * 用法:
 *   npx tsx scripts/check-boundaries.ts            # 檢查整個 repo
 *   npx tsx scripts/check-boundaries.ts --verbose  # 也印出每個檔案的歸屬
 *
 * 退出碼:0 無違規;1 有違規或有檔案不在任何落點內。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const VERBOSE = process.argv.includes('--verbose');

/** 落點 → 擁有的功能。順序有意義:先比對較長的前綴。 */
const OWNERS: [prefix: string, owner: string][] = [
  ['packages/contracts/', 'contracts'],
  ['contracts/', 'contracts'],
  ['packages/core/src/schema/', '01-data-layer'],
  ['packages/core/src/ingest/', '02-ingest-pipeline'],
  ['packages/core/prompts/', '02-ingest-pipeline'],
  ['packages/core/src/llm/', '03-llm-router'],
  ['packages/core/src/scheduler/', '04-scheduler'],
  ['packages/core/src/grading/', '05-grading'],
  ['packages/core/src/weekly/', '08-weekly-goal'],
  ['packages/core/src/lint/', '09-lint'],
  ['packages/core/src/session/', '11-review-cli'],
  ['packages/core/src/prompt-quality/', '12-prompt-quality'],
  ['packages/ui-shared/', '07-teach-card'],
  ['apps/test-card/', '06-test-card'],
  ['apps/teach-card/', '07-teach-card'],
  ['apps/desktop/', '10-desktop-shell'],
  ['scripts/ingest.ts', '02-ingest-pipeline'],
  ['scripts/llm.ts', '03-llm-router'],
  ['scripts/due.ts', '04-scheduler'],
  ['scripts/grade.ts', '05-grading'],
  ['scripts/weekly.ts', '08-weekly-goal'],
  ['scripts/lint.ts', '09-lint'],
  ['scripts/review.ts', '11-review-cli'],
  ['scripts/prompt-check.ts', '12-prompt-quality'],
  ['scripts/check-boundaries.ts', 'infra'],
  ['scripts/check-standalone.ts', 'infra'],
  ['scripts/snapshot.ts', 'infra'],
  ['features/steps/', 'steps'],
];

/** 這些擁有者是「膠水」,可以 import 任何東西,不當作來源檢查。 */
const GLUE = new Set(['infra', 'steps']);

/** 要掃描的根目錄與副檔名 */
const SCAN_DIRS = ['packages', 'apps', 'scripts'];
const EXTS = ['.ts', '.mts', '.js', '.mjs', '.svelte'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.svelte-kit', 'src-tauri']);

interface AllowEdge { from: string; to: string; reason: string }
interface Violation { file: string; line: number; spec: string; from: string; to: string; kind: 'cross' | 'absolute' | 'unmapped-target' }

function loadAllow(): AllowEdge[] {
  const p = join(ROOT, 'scripts/boundaries.allow.json');
  if (!existsSync(p)) return [];
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

function ownerOf(relPath: string): string | undefined {
  const posix = toPosix(relPath);
  for (const [prefix, owner] of OWNERS) {
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
function resolveSpec(fromFile: string, spec: string): { rel: string } | { external: true } | { absolute: true } {
  if (spec.startsWith('node:')) return { external: true };
  if (spec.startsWith('/')) return { absolute: true };
  if (spec.startsWith('.')) {
    return { rel: toPosix(relative(ROOT, resolve(dirname(fromFile), spec))) };
  }
  const aliases: [string, string][] = [
    ['@contracts/', 'packages/contracts/src/'],
    ['@core/', 'packages/core/src/'],
    ['@learning/contracts/', 'packages/contracts/src/'],
    ['@learning/contracts', 'packages/contracts/src/index.ts'],
    ['@learning/core/', 'packages/core/src/'],
    ['@learning/ui-shared/', 'packages/ui-shared/src/'],
    ['@learning/ui-shared', 'packages/ui-shared/src/index.ts'],
  ];
  for (const [alias, target] of aliases) {
    if (spec === alias.replace(/\/$/, '') && !alias.endsWith('/')) return { rel: target };
    if (alias.endsWith('/') && spec.startsWith(alias)) return { rel: target + spec.slice(alias.length) };
    if (!alias.endsWith('/') && spec === alias) return { rel: target };
  }
  if (spec === '@learning/core') {
    // 沒有子路徑就無法判斷落點,當作違規處理
    return { rel: 'packages/core/src/' };
  }
  return { external: true };
}

function main(): void {
  const allow = loadAllow();
  const violations: Violation[] = [];
  const unmapped: string[] = [];
  let scanned = 0;

  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = toPosix(relative(ROOT, file));
      const from = ownerOf(rel);
      if (!from) { unmapped.push(rel); continue; }
      if (VERBOSE) console.log(`  ${rel}  →  ${from}`);
      if (GLUE.has(from)) continue;
      scanned++;
      const src = readFileSync(file, 'utf8');
      for (const { spec, line } of findImports(src)) {
        const r = resolveSpec(file, spec);
        if ('external' in r) continue;
        if ('absolute' in r) { violations.push({ file: rel, line, spec, from, to: '(absolute)', kind: 'absolute' }); continue; }
        if (r.rel.startsWith('..')) { violations.push({ file: rel, line, spec, from, to: '(outside repo)', kind: 'absolute' }); continue; }
        const to = ownerOf(r.rel);
        if (!to) { violations.push({ file: rel, line, spec, from, to: '(unmapped)', kind: 'unmapped-target' }); continue; }
        if (to === from || to === 'contracts') continue;
        if (allow.some((e) => e.from === from && e.to === to)) continue;
        violations.push({ file: rel, line, spec, from, to, kind: 'cross' });
      }
    }
  }

  console.log(`boundaries: 掃描 ${scanned} 個檔案,允許例外 ${allow.length} 條`);

  if (unmapped.length) {
    console.log(`\n✗ ${unmapped.length} 個檔案不在任何功能的落點內(見 packages/core/README.md):`);
    for (const u of unmapped) console.log(`  ${u}`);
  }
  if (violations.length) {
    console.log(`\n✗ ${violations.length} 個違規 import:`);
    for (const v of violations) {
      const why = v.kind === 'cross' ? `${v.from} → ${v.to}` : v.kind === 'absolute' ? '絕對路徑或跳出 repo' : `目標 ${v.spec} 不在任何落點內`;
      console.log(`  ${v.file}:${v.line}  import '${v.spec}'  (${why})`);
    }
    console.log('\nWave 0 只能 import contracts/ 與自己的目錄。整合後要跨功能,把邊加進 scripts/boundaries.allow.json 並附理由。');
  }
  if (!unmapped.length && !violations.length) console.log('✓ 無違規');
  process.exit(unmapped.length || violations.length ? 1 : 0);
}

main();
