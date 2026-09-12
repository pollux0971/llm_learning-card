/**
 * JSON 重複鍵守門。
 *
 * JSON.parse 會靜靜保留最後一個同名鍵，失去前一個鍵與它的行號；這支守門改以
 * 小型 JSON 語法走訪器逐一讀每個 object 的 member。每個 object 都有自己的
 * `seen` 表，所以只在同一層重複才報錯，巢狀物件的同名鍵是合法的。
 *
 * 掃描範圍不是寫在程式裡，而是這支 gate 自己的
 * `json-duplicate-keys.scope.json` 設定檔的 `include` glob 陣列。新增符合現有
 * glob 的 JSON 設定檔會自動納入；空範圍或沒有命中任何檔案一律是掃描器壞掉，
 * 不會假裝乾淨。
 *
 * 用法:
 *   npx tsx scripts/check-json-duplicate-keys.ts
 *   npx tsx scripts/check-json-duplicate-keys.ts --root <dir>
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

const GATE_NAME = 'json-duplicate-keys';
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';
const CONFIG_FILENAME = 'json-duplicate-keys.scope.json';

export interface DuplicateKey {
  key: string;
  firstLine: number;
  duplicateLine: number;
}

/** JSON 語法錯誤，保留行號讓 CLI 可以指出壞的是哪一行。 */
export class JsonSyntaxError extends Error {
  constructor(message: string, readonly line: number) {
    super(message);
  }
}

/**
 * 保留 object member 的 JSON 走訪器。字串 token 會用 JSON.parse 解碼，所以
 * `"a"` 與 `"\\u0061"` 視為同一個鍵；JSON.parse 只用在單一字串，不會吞掉
 * object 的重複 member。
 */
class JsonDuplicateKeyParser {
  private index = 0;
  private readonly duplicates: DuplicateKey[] = [];

  constructor(private readonly source: string) {}

  parse(): DuplicateKey[] {
    this.skipWhitespace();
    this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) this.fail('JSON 結束後還有額外內容');
    return this.duplicates;
  }

  private parseValue(): void {
    this.skipWhitespace();
    const ch = this.source[this.index];
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"') {
      this.parseString();
      return;
    }
    if (ch === '-' || (ch !== undefined && ch >= '0' && ch <= '9')) return this.parseNumber();
    if (this.consumeLiteral('true') || this.consumeLiteral('false') || this.consumeLiteral('null')) return;
    this.fail('預期 JSON 值');
  }

  private parseObject(): void {
    this.index += 1; // {
    this.skipWhitespace();
    const seen = new Map<string, number>();
    if (this.source[this.index] === '}') {
      this.index += 1;
      return;
    }
    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] !== '"') this.fail('object 的鍵必須是字串');
      const keyOffset = this.index;
      const key = this.parseString();
      const line = this.lineAt(keyOffset);
      const firstLine = seen.get(key);
      if (firstLine === undefined) seen.set(key, line);
      else this.duplicates.push({ key, firstLine, duplicateLine: line });

      this.skipWhitespace();
      if (this.source[this.index] !== ':') this.fail('object 的鍵後面應有 :');
      this.index += 1;
      this.parseValue();
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === '}') {
        this.index += 1;
        return;
      }
      if (separator !== ',') this.fail('object 的欄位後面應有 , 或 }');
      this.index += 1;
    }
  }

  private parseArray(): void {
    this.index += 1; // [
    this.skipWhitespace();
    if (this.source[this.index] === ']') {
      this.index += 1;
      return;
    }
    while (true) {
      this.parseValue();
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === ']') {
        this.index += 1;
        return;
      }
      if (separator !== ',') this.fail('array 的項目後面應有 , 或 ]');
      this.index += 1;
    }
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1; // opening quote
    while (this.index < this.source.length) {
      const ch = this.source[this.index]!;
      if (ch === '"') {
        this.index += 1;
        try {
          return JSON.parse(this.source.slice(start, this.index)) as string;
        } catch (error) {
          this.fail(`不合法的 JSON 字串:${(error as Error).message}`, start);
        }
      }
      if (ch === '\\') {
        this.index += 1;
        if (this.index >= this.source.length) this.fail('字串的跳脫字元不完整', start);
        if (this.source[this.index] === 'u') this.index += 4;
      }
      this.index += 1;
    }
    this.fail('字串沒有結尾引號', start);
  }

  private parseNumber(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.index));
    if (!match) this.fail('不合法的數字');
    this.index += match[0].length;
  }

  private consumeLiteral(literal: string): boolean {
    if (!this.source.startsWith(literal, this.index)) return false;
    this.index += literal.length;
    return true;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.index] ?? '')) this.index += 1;
  }

  private lineAt(offset: number): number {
    let line = 1;
    for (let i = 0; i < offset; i += 1) if (this.source[i] === '\n') line += 1;
    return line;
  }

  private fail(message: string, offset = this.index): never {
    throw new JsonSyntaxError(message, this.lineAt(offset));
  }
}

export function findDuplicateKeys(source: string): DuplicateKey[] {
  return new JsonDuplicateKeyParser(source).parse();
}

/** 只支援設定檔所需的 `*` glob；`*` 不跨目錄，避免意外擴大掃描範圍。 */
function globMatches(path: string, glob: string): boolean {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*');
  return new RegExp(`^${escaped}$`).test(path);
}

function isSkipped(relativeDir: string): boolean {
  return DEFAULT_SKIP_DIRS.some((skip) => relativeDir === skip || relativeDir.startsWith(`${skip}/`));
}

/** 回傳配置 glob 命中的所有檔案，排序讓輸出與測試穩定。 */
export function discoverJsonFiles(root: string, include: readonly string[]): string[] {
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

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function configError(message: string): never {
  console.error(`✗ ${message}`);
  console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
  process.exit(1);
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
  if (unknownKeys.length > 0) {
    configError(`${CONFIG_FILENAME} 有不認識的鍵:${unknownKeys[0]}(打錯字?)已知鍵:include`);
  }
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
  const files = discoverJsonFiles(root, include);
  if (files.length === 0) configError(`jsonDuplicateKeys.include 沒有命中任何檔案。${SCANNER_BROKEN}`);

  const failures: string[] = [];
  for (const path of files) {
    const displayPath = relative(root, path).split('\\').join('/');
    let source: string;
    try {
      source = readFileSync(path, 'utf8');
    } catch (error) {
      failures.push(`✗ ${displayPath}:讀不到檔案(${(error as Error).message})`);
      continue;
    }
    try {
      for (const duplicate of findDuplicateKeys(source)) {
        failures.push(`✗ ${displayPath}:鍵 "${duplicate.key}" 重複(第 ${duplicate.firstLine} 行與第 ${duplicate.duplicateLine} 行)`);
      }
    } catch (error) {
      if (error instanceof JsonSyntaxError) failures.push(`✗ ${displayPath}:${error.line}:JSON 語法錯誤:${error.message}`);
      else failures.push(`✗ ${displayPath}:JSON 掃描失敗:${(error as Error).message}`);
    }
  }

  for (const failure of failures) console.log(failure);
  if (failures.length === 0) console.log(`✓ ${files.length} 個 JSON 設定檔沒有同層重複鍵`);
  console.log(`gate=${GATE_NAME} result=${failures.length === 0 ? 'PASS' : 'FAIL'} scanned=${files.length}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

const isDirectRun = process.argv[1]?.endsWith('check-json-duplicate-keys.ts') ?? false;
if (isDirectRun) main();
