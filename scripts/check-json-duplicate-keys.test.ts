import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverJsonFiles, findDuplicateKeys } from './check-json-duplicate-keys.js';

const CHECK_TS = resolve(import.meta.dirname, 'check-json-duplicate-keys.ts');
const SPAWN_TIMEOUT_MS = 60_000;
const dirs: string[] = [];
const CONFIG_FILENAME = 'json-duplicate-keys.scope.json';
const INCLUDE = ['scripts/*.json', 'stryker*.json', 'package.json', 'tsconfig*.json'];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lc-json-dupkey-'));
  dirs.push(root);
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts', CONFIG_FILENAME), JSON.stringify({ include: INCLUDE }, null, 2));
  writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n');
  writeFileSync(join(root, 'tsconfig.json'), '{"compilerOptions":{}}\n');
  return root;
}

function write(root: string, path: string, content: string): void {
  const fullPath = join(root, path);
  mkdirSync(resolve(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

function run(root: string): { code: number; output: string } {
  const result = spawnSync('npx', ['tsx', CHECK_TS, '--root', root], {
    cwd: root,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
  });
  return { code: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('check-json-duplicate-keys: parser', () => {
  it('只報同一層的重複，保留兩個行號', () => {
    const duplicates = findDuplicateKeys('{\n  "same": 1,\n  "nested": { "same": 2 },\n  "same": 3\n}\n');
    expect(duplicates).toEqual([{ key: 'same', firstLine: 2, duplicateLine: 4 }]);
  });

  it('同一行兩個鍵、跳脫 key 與字串內引號都正確處理', () => {
    const duplicates = findDuplicateKeys('{"a\\u0062":"a \\\"quote\\\"", "ab": 2}');
    expect(duplicates).toEqual([{ key: 'ab', firstLine: 1, duplicateLine: 1 }]);
  });
});

describe('check-json-duplicate-keys: config scope and CLI', () => {
  it('符合 config glob 的新 JSON 檔會自動納入，不靠手抄檔名', () => {
    const root = makeRoot();
    write(root, 'scripts/new-setting.json', '{}\n');
    write(root, 'stryker.new-rule.json', '{}\n');
    write(root, 'tsconfig.browser.json', '{}\n');
    write(root, 'other.json', '{}\n');
    expect(discoverJsonFiles(root, INCLUDE).map((path) => path.slice(root.length + 1).replaceAll('\\', '/'))).toEqual([
      'package.json',
      `scripts/${CONFIG_FILENAME}`,
      'scripts/new-setting.json',
      'stryker.new-rule.json',
      'tsconfig.browser.json',
      'tsconfig.json',
    ]);
  });

  it('反向驗證：同一 object 的第二個鍵會紅，訊息指名檔案、鍵與兩行', () => {
    const root = makeRoot();
    write(root, 'scripts/duplicate.json', '{\n  "skipDirs": [],\n  "skipDirs": ["tmp"]\n}\n');
    const failure = run(root);
    expect(failure.code).toBe(1);
    expect(failure.output).toContain('scripts/duplicate.json');
    expect(failure.output).toContain('鍵 "skipDirs" 重複(第 2 行與第 3 行)');
    expect(failure.output).toContain('gate=json-duplicate-keys result=FAIL scanned=4');

    write(root, 'scripts/duplicate.json', '{\n  "skipDirs": []\n}\n');
    const restored = run(root);
    expect(restored.code).toBe(0);
    expect(restored.output).toContain('gate=json-duplicate-keys result=PASS scanned=4');
  }, SPAWN_TIMEOUT_MS);

  it('範圍缺席或掃到 0 個檔案一律紅，不能把掃描器壞掉當乾淨', () => {
    const root = makeRoot();
    write(root, `scripts/${CONFIG_FILENAME}`, '{}\n');
    const absent = run(root);
    expect(absent.code).toBe(1);
    expect(absent.output).toContain(`缺少 "include"`);
    expect(absent.output).toContain('scanned=0');

    write(root, `scripts/${CONFIG_FILENAME}`, JSON.stringify({ include: ['never/*.json'] }));
    const empty = run(root);
    expect(empty.code).toBe(1);
    expect(empty.output).toContain('沒有命中任何檔案');
    expect(empty.output).toContain('掃描器壞了');
  }, SPAWN_TIMEOUT_MS);
});
