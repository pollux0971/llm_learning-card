/**
 * ADR 編號重複守門。
 *
 * 只掃 ADR 的**定義處**(`^#+ *ADR-NNN` 標題)，不掃引用處；文件裡到處都是
 * ADR 引用，把引用當定義會造成大量誤報。
 *
 * **不要加斷號檢查**：空號可能只是取了沒用，不代表內容被刪；完整理由見 ADR-052。
 *
 * 掃描範圍不是寫死在程式裡，而是這支 gate 自己的 `adr-numbers.scope.json` 設定檔的
 * `include` glob 陣列。`*` 不跨目錄，`**` 可跨目錄；空範圍或沒有命中任何定義一律
 * 視為掃描器壞掉，不會假裝乾淨。
 *
 * 用法:
 *   npx tsx scripts/check-adr-numbers.ts
 *   npx tsx scripts/check-adr-numbers.ts --root <dir>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  DEFAULT_SKIP_DIRS,
  ROOT as GIT_ROOT,
  lookupConfig,
  readConfigJson,
  requireConfigType,
  requireRootDir,
} from './_root.js';

const GATE_NAME = 'adr-numbers';
const CONFIG_FILENAME = 'adr-numbers.scope.json';
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function configError(message: string): never {
  console.error(`✗ ${message}`);
  console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
  process.exit(1);
}

/** 將這支 gate 用到的 `*` / `**` glob 轉成相對路徑 regex。 */
function globMatches(path: string, glob: string): boolean {
  let pattern = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          pattern += '(?:.*/)?';
          i += 2;
        } else {
          pattern += '.*';
          i += 1;
        }
      } else {
        pattern += '[^/]*';
      }
    } else {
      pattern += /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
    }
  }
  return new RegExp(`${pattern}$`).test(path);
}

function isSkipped(path: string): boolean {
  return DEFAULT_SKIP_DIRS.some((skip) => path === skip || path.startsWith(`${skip}/`));
}

export function discoverMarkdownFiles(root: string, include: readonly string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const repoPath = relative(root, fullPath).split('\\').join('/');
      if (entry.isDirectory()) {
        if (!isSkipped(repoPath)) walk(fullPath);
      } else if (entry.isFile() && include.some((glob) => globMatches(repoPath, glob))) {
        files.push(fullPath);
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

interface Definition {
  id: string;
  file: string;
  line: number;
}

const ADR_DEFINITION_RE = /^#+[ \t]*ADR-([0-9]+)\b/;

export function findAdrDefinitions(root: string, files: readonly string[]): Definition[] {
  const definitions: Definition[] = [];
  for (const file of files) {
    const displayPath = relative(root, file).split('\\').join('/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = ADR_DEFINITION_RE.exec(line);
      if (match) definitions.push({ id: match[1]!, file: displayPath, line: index + 1 });
    });
  }
  return definitions;
}

function loadInclude(root: string, rootExplicit: boolean): string[] {
  const found = lookupConfig(import.meta.dirname, CONFIG_FILENAME, { root, rootExplicit });
  console.log(`${CONFIG_FILENAME}: ${found.source}`);
  if (found.hardErrorMessage) configError(found.hardErrorMessage);
  if (!found.path) configError(`找不到 ${CONFIG_FILENAME}(搜尋過:${found.triedPaths.join('、')})`);
  const config = readConfigJson(found.path, GATE_NAME);
  requireConfigType(config, CONFIG_FILENAME, 'object', GATE_NAME);
  const obj = config as Record<string, unknown>;
  const unknownKeys = Object.keys(obj).filter((key) => key !== 'include');
  if (unknownKeys.length > 0) configError(`${CONFIG_FILENAME} 有不認識的鍵:${unknownKeys[0]}(打錯字?)已知鍵:include`);
  const include = obj.include;
  if (include === undefined) configError(`${CONFIG_FILENAME} 缺少 "include" glob 陣列`);
  requireConfigType(include, `${CONFIG_FILENAME}.include`, 'array', GATE_NAME);
  if (!Array.isArray(include) || include.length === 0 || include.some((glob) => typeof glob !== 'string' || glob.length === 0)) {
    configError(`${CONFIG_FILENAME}.include 必須是非空的 glob 字串陣列`);
  }
  return include as string[];
}

function main(): void {
  const rootExplicit = argValue('--root') !== undefined;
  const root = resolve(argValue('--root') ?? GIT_ROOT);
  requireRootDir(root, rootExplicit, GATE_NAME);
  const include = loadInclude(root, rootExplicit);
  const files = discoverMarkdownFiles(root, include);
  if (files.length === 0) configError(`${CONFIG_FILENAME}.include 沒有命中任何檔案。${SCANNER_BROKEN}`);

  let definitions: Definition[];
  try {
    definitions = findAdrDefinitions(root, files);
  } catch (error) {
    console.error(`✗ ADR 定義掃描失敗:${(error as Error).message}`);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }
  if (definitions.length === 0) configError(`沒有掃到任何 ADR 定義。${SCANNER_BROKEN}`);

  const firstById = new Map<string, Definition>();
  const failures: string[] = [];
  for (const definition of definitions) {
    const first = firstById.get(definition.id);
    if (!first) {
      firstById.set(definition.id, definition);
      continue;
    }
    failures.push(
      `✗ ADR-${definition.id} 重複(${first.file}:第 ${first.line} 行與 ${definition.file}:第 ${definition.line} 行)`,
    );
  }

  for (const failure of failures) console.log(failure);
  if (failures.length === 0) console.log(`✓ ${definitions.length} 個 ADR 定義的編號沒有重複`);
  console.log(`gate=${GATE_NAME} result=${failures.length === 0 ? 'PASS' : 'FAIL'} scanned=${definitions.length}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

const isDirectRun = process.argv[1]?.endsWith('check-adr-numbers.ts') ?? false;
if (isDirectRun) main();
