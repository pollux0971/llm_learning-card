/**
 * 從一個入口檔沿著 import 走完整張圖(T2c-1 驗收 A4;測試 agent 寫的,實作者不要改)。
 *
 * webview 跑在瀏覽器引擎裡,沒有 node: 模組;它也不能拉 `@core/schema/log`(那是 node:fs 的 appendLineAtomic)。
 * 相對路徑與 `@core/`、`@contracts/` 別名會跟進去;套件名(例如 `@tauri-apps/api/core`)是葉子,不跟。
 * 套件名若是 Node 內建模組(`fs`、`path`……,不寫 `node:` 也一樣)算 node 模組。
 */
import { builtinModules } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const REPO_ROOT = join(import.meta.dirname, '../../../..');

export interface ImportHit {
  /** repo 相對路徑 */
  file: string;
  spec: string;
}

export interface ImportGraph {
  files: string[];
  imports: ImportHit[];
}

const ALIASES: [string, string][] = [
  ['@core/', 'packages/core/src/'],
  ['@contracts/', 'packages/contracts/src/'],
];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (_m, pre: string) => pre);
}

export function importSpecs(src: string): string[] {
  const body = stripComments(src);
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of body.matchAll(re)) if (m[1]) specs.push(m[1]);
  }
  return specs;
}

function resolveFile(base: string): string | undefined {
  const candidates = [
    base,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.mjs$/, '.mts'),
    `${base}.ts`,
    join(base, 'index.ts'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return undefined;
}

function resolveSpec(fromFile: string, spec: string, repoRoot: string): string | undefined {
  if (spec.startsWith('.')) return resolveFile(resolve(dirname(fromFile), spec));
  for (const [alias, target] of ALIASES) {
    if (spec.startsWith(alias)) return resolveFile(join(repoRoot, target, spec.slice(alias.length)));
  }
  return undefined;
}

function rel(repoRoot: string, file: string): string {
  return relative(repoRoot, file).split(sep).join('/');
}

export function scanImportGraph(entry: string, repoRoot = REPO_ROOT): ImportGraph {
  if (!existsSync(entry)) throw new Error(`入口檔不存在: ${entry}`);
  const seen = new Set<string>();
  const files: string[] = [];
  const imports: ImportHit[] = [];
  const queue = [resolve(entry)];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(rel(repoRoot, file));
    for (const spec of importSpecs(readFileSync(file, 'utf8'))) {
      imports.push({ file: rel(repoRoot, file), spec });
      const next = resolveSpec(file, spec, repoRoot);
      if (next) queue.push(next);
      else if (spec.startsWith('.') || ALIASES.some(([a]) => spec.startsWith(a))) {
        imports.push({ file: rel(repoRoot, file), spec: `UNRESOLVED:${spec}` });
      }
    }
  }
  return { files, imports };
}

const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));

export function isNodeModule(spec: string): boolean {
  if (spec.startsWith('node:')) return true;
  const head = spec.split('/')[0] ?? spec;
  return BUILTINS.has(spec) || BUILTINS.has(head);
}

export function isSchemaLog(spec: string, fromFile: string, repoRoot = REPO_ROOT): boolean {
  if (/^@core\/schema\/log(\.js|\.ts)?$/.test(spec)) return true;
  const target = resolveSpec(join(repoRoot, fromFile), spec, repoRoot);
  return target !== undefined && rel(repoRoot, target) === 'packages/core/src/schema/log.ts';
}
