/**
 * 刻意缺席登記表守門。
 *
 * 只登記「違反之後會留下一個可指名的痕跡」的否定決定。
 * 痕跡 = 一個檔案存在、一個設定值出現、一個目錄被建立。
 * 而「痕跡在版控外」的那些最該登記——因為 `git status` 幫不上忙。
 *
 * 這支守門不管「決定不用某種寫法」那類否定決定；那種違反通常不留下一個
 * 可列舉的存在性痕跡，要靠掃描器，不是靠這張登記表。
 *
 * `deliberately-absent.json` 是本守門自帶的設定檔。每一筆必須有非空的
 * `path`、`reason`、`adr`；缺少理由或 ADR 的一筆本身就是設定壞掉，不能把
 * 它當成成立的豁免。登記的 path 以 repo 根為基準；但 `.git/hooks/` 是
 * linked worktree 共用的實際位置，不能拼成 `<repo>/.git/hooks`，一定要以
 * `git rev-parse --git-path hooks` 解析後再檢查。
 *
 * 用法:
 *   npx tsx scripts/check-deliberately-absent.ts
 *   npx tsx scripts/check-deliberately-absent.ts --root <dir>
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  ROOT as GIT_ROOT,
  lookupConfig,
  readConfigJson,
  requireRootDir,
} from './_root.js';

const GATE_NAME = 'deliberately-absent';
const REGISTRY_FILENAME = 'deliberately-absent.json';
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

export interface AbsentEntry {
  path: string;
  reason: string;
  adr: string;
}

interface Registry {
  entries: AbsentEntry[];
  /** Each malformed item counts as one scanned registration and makes the gate fail. */
  errors: string[];
  scanned: number;
  path: string;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const ROOT_EXPLICIT = argValue('--root') !== undefined;
const ROOT = resolve(argValue('--root') ?? GIT_ROOT);

function fail(message: string, scanned = 0): never {
  console.error(`✗ ${message}`);
  console.log(`gate=${GATE_NAME} result=FAIL scanned=${scanned}`);
  process.exit(1);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function findRegistry(): { path: string | undefined; hardErrorMessage?: string; triedPaths: string[] } {
  const result = lookupConfig(import.meta.dirname, REGISTRY_FILENAME, { root: ROOT, rootExplicit: ROOT_EXPLICIT });
  console.log(`${REGISTRY_FILENAME}: ${result.source}`);
  return result;
}

function loadRegistry(): Registry {
  const found = findRegistry();
  if (found.hardErrorMessage) fail(found.hardErrorMessage);
  if (!found.path) fail(`找不到 ${REGISTRY_FILENAME}(搜尋過:${found.triedPaths.join('、')})`);

  const raw = readConfigJson(found.path, GATE_NAME);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`${found.path} 頂層必須是物件`);
  }
  const object = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(object).filter((key) => key !== 'absent');
  if (unknownKeys.length > 0) {
    fail(`${found.path} 有不認識的鍵:${unknownKeys[0]}(打錯字?)已知鍵:absent`);
  }
  const rawEntries = object.absent;
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    fail(`${found.path} 的 "absent" 必須是非空陣列。${SCANNER_BROKEN}`);
  }

  const entries: AbsentEntry[] = [];
  const errors: string[] = [];
  rawEntries.forEach((item, index) => {
    const number = index + 1;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${found.path} 第 ${number} 筆不是物件:${JSON.stringify(item)}`);
      return;
    }
    const value = item as Record<string, unknown>;
    const unknownEntryKeys = Object.keys(value).filter((key) => !['path', 'reason', 'adr'].includes(key));
    if (unknownEntryKeys.length > 0) {
      errors.push(`${found.path} 第 ${number} 筆有不認識的欄位:${unknownEntryKeys[0]}(打錯字?)已知欄位:path, reason, adr`);
      return;
    }
    const missing: string[] = [];
    for (const field of ['path', 'reason', 'adr'] as const) {
      if (!nonEmptyString(value[field])) missing.push(field);
    }
    if (missing.length > 0) {
      errors.push(`${found.path} 第 ${number} 筆缺少必填欄位或欄位是空字串:${missing.join(',')}`);
      return;
    }
    entries.push({ path: value.path as string, reason: value.reason as string, adr: value.adr as string });
  });

  return { entries, errors, scanned: rawEntries.length, path: found.path };
}

/** Resolve the actual shared hooks directory; never infer it from `<root>/.git`. */
export function resolveGitHooksDir(root: string): string {
  const output = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!output) throw new Error('git rev-parse --git-path hooks 沒有回傳路徑');
  return resolve(root, output);
}

/** Resolve a registry path, mapping `.git/hooks/` through git's real worktree path. */
export function resolveRegisteredPath(root: string, hooksDir: string, registeredPath: string): string {
  const normalized = registeredPath.replaceAll('\\', '/');
  const hooksPrefix = '.git/hooks';
  if (normalized === hooksPrefix) return hooksDir;
  if (normalized.startsWith(`${hooksPrefix}/`)) return join(hooksDir, normalized.slice(hooksPrefix.length + 1));
  return resolve(root, normalized);
}

function main(): void {
  requireRootDir(ROOT, ROOT_EXPLICIT, GATE_NAME);
  const registry = loadRegistry();
  if (registry.errors.length > 0) {
    for (const error of registry.errors) console.error(`✗ ${error}`);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=${registry.scanned}`);
    process.exit(1);
  }

  let hooksDir: string;
  try {
    hooksDir = resolveGitHooksDir(ROOT);
  } catch (error) {
    fail(`無法解析 git hooks 路徑:git rev-parse --git-path hooks:${(error as Error).message}`, registry.scanned);
  }

  const failures: string[] = [];
  for (const entry of registry.entries) {
    const actualPath = resolveRegisteredPath(ROOT, hooksDir, entry.path);
    if (existsSync(actualPath)) {
      failures.push(`✗ ${entry.path} 實際存在:違反 ${entry.adr}`);
    }
  }
  for (const failure of failures) console.log(failure);
  if (failures.length === 0) console.log(`✓ ${registry.entries.length} 個刻意缺席項目不存在`);
  console.log(`gate=${GATE_NAME} result=${failures.length === 0 ? 'PASS' : 'FAIL'} scanned=${registry.scanned}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

const isDirectRun = process.argv[1]?.endsWith('check-deliberately-absent.ts') ?? false;
if (isDirectRun) main();
