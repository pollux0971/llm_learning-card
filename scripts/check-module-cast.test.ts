// SOURCE: template v1.6.4 (4dc1513) sha256=82c029d7f27f112dfc6ef454d96ba86a983ea9da4647d2f3ed7815f7dae560af — 勿手改;升版用 sync-gates.sh
/**
 * scripts/check-module-cast.ts 的測試(模板 1.6.0,P-88)。
 *
 * 跟其餘掃描器的測試同一個形狀:暫存目錄當假 consumer 根,`--root` 明講,
 * GATES_CONFIG_DIR 指到 fixture 自己的 scripts/。三條反向驗證對應檔頭的 (a)–(c);
 * 「只擋那一種」是這支守門的核心承諾,所以對值的 `as unknown as` 一定要有一條綠的測試。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHECK_MODULE_CAST_TS = resolve(import.meta.dirname, 'check-module-cast.ts');
const SPAWN_TIMEOUT_MS = 60_000;
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function writeRaw(root: string, relPath: string, content: string): void {
  const p = join(root, relPath);
  mkdirSync(resolve(p, '..'), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

const CLEAN_STEPS = [
  "import { Given, Then } from '@cucumber/cucumber';",
  "import { computeDue } from '../../packages/core/src/index.js';",
  "import type { World } from './_world.js';",
  'Given(\'the store has {int} items\', function (this: World, n: number) { this.result = computeDue(n); });',
  '',
].join('\n');

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lc-module-cast-'));
  tmpDirs.push(root);
  writeRaw(root, 'scripts/gates.config.json', '{}');
  writeRaw(root, 'features/steps/_world.ts', 'export interface World { result?: unknown }\n');
  writeRaw(root, 'features/steps/alpha.steps.ts', CLEAN_STEPS);
  return root;
}

function run(root: string, ...extra: string[]): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', CHECK_MODULE_CAST_TS, '--root', root, ...extra], {
    cwd: root,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, GATES_CONFIG_DIR: join(root, 'scripts') },
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('check-module-cast:只擋模組命名空間轉型(P-88)', () => {
  it('乾淨的 fixture(具名 import):exit 0、scanned 是檔案數', () => {
    const root = makeRoot();
    const { code, output } = run(root);
    expect(output).toContain('0 處模組命名空間轉型');
    expect(output).toContain('gate=module-cast result=PASS scanned=2');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (a):import * as X 之後 X as unknown as → exit 1、印 檔案:行號 與那一行', () => {
    const root = makeRoot();
    writeRaw(
      root,
      'features/steps/beta.steps.ts',
      [
        "import { Then } from '@cucumber/cucumber';",
        "import * as core from '../../packages/core/src/index.js';",
        'const api = core as unknown as { computeDue: (n: number) => number };',
        "Then('it computes', function () { api.computeDue(1); });",
        '',
      ].join('\n'),
    );
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('features/steps/beta.steps.ts:3  const api = core as unknown as');
    expect(output).toContain('命名空間 `core`');
    expect(output).toContain('gate=module-cast result=FAIL scanned=3');
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (b):對「值」的 as unknown as 不算(23 抓 2 的那 21 個要放行)', () => {
    const root = makeRoot();
    writeRaw(
      root,
      'features/steps/beta.steps.ts',
      [
        "import { Then } from '@cucumber/cucumber';",
        "import * as core from '../../packages/core/src/index.js';",
        'const fixture = JSON.parse(\'{}\') as unknown as { rows: string[] };',
        'const result = core.computeDue(1) as unknown as { ok: boolean };',
        "Then('it computes', function () { void fixture; void result; });",
        '',
      ].join('\n'),
    );
    const { code, output } = run(root);
    expect(output).toContain('gate=module-cast result=PASS scanned=3');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (c):那一行整行註解掉 → 回綠(區塊註解也一樣)', () => {
    const root = makeRoot();
    writeRaw(
      root,
      'features/steps/beta.steps.ts',
      [
        "import * as core from '../../packages/core/src/index.js';",
        '// const api = core as unknown as { computeDue: (n: number) => number };',
        '/* const api2 = core as unknown as { computeDue: (n: number) => number }; */',
        'export const keep = core;',
        '',
      ].join('\n'),
    );
    const { code, output } = run(root);
    expect(output).toContain('gate=module-cast result=PASS scanned=3');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('動態 import() / require() 的結果直接轉型也算', () => {
    const root = makeRoot();
    writeRaw(
      root,
      'features/steps/beta.steps.ts',
      [
        "import { Then } from '@cucumber/cucumber';",
        "Then('it loads', async function () {",
        "  const api = (await import('../../packages/core/src/index.js')) as unknown as { computeDue: (n: number) => number };",
        "  const legacy = require('../../packages/core/dist/index.cjs') as unknown as { computeDue: (n: number) => number };",
        '  api.computeDue(1); legacy.computeDue(2);',
        '});',
        '',
      ].join('\n'),
    );
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('features/steps/beta.steps.ts:3');
    expect(output).toContain('features/steps/beta.steps.ts:4');
    expect(output).toContain('動態 import()/require()');
    expect(output).toContain('gate=module-cast result=FAIL scanned=3');
  }, SPAWN_TIMEOUT_MS);

  it('import X = require(...) 的 X 也算命名空間', () => {
    const root = makeRoot();
    writeRaw(
      root,
      'features/steps/beta.steps.ts',
      ["import core = require('../../packages/core/dist/index.cjs');", 'export const api = core as unknown as { f: () => void };', ''].join('\n'),
    );
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('features/steps/beta.steps.ts:2');
  }, SPAWN_TIMEOUT_MS);

  it('moduleCast.scanDirs 指到別的目錄時掃那裡,不掃 features/steps', () => {
    const root = makeRoot();
    writeRaw(root, 'scripts/gates.config.json', JSON.stringify({ moduleCast: { scanDirs: ['tests/steps'] } }));
    writeRaw(
      root,
      'tests/steps/x.steps.ts',
      ["import * as core from '../../src/index.js';", 'export const api = core as unknown as { f: () => void };', ''].join('\n'),
    );
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('tests/steps/x.steps.ts:2');
    expect(output).toContain('gate=module-cast result=FAIL scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('moduleCast.scanDirs 是空陣列 → exit 1、名出檔案', () => {
    const root = makeRoot();
    writeRaw(root, 'scripts/gates.config.json', JSON.stringify({ moduleCast: { scanDirs: [] } }));
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('"moduleCast.scanDirs" 是空陣列');
    expect(output).toContain('gate=module-cast result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('moduleCast.scanDirs 型別錯(字串)→ exit 1、設定檔鍵型別錯', () => {
    const root = makeRoot();
    writeRaw(root, 'scripts/gates.config.json', JSON.stringify({ moduleCast: { scanDirs: 'features/steps' } }));
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('moduleCast.scanDirs');
    expect(output).toContain('gate=module-cast result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('0 個 .ts 檔 → exit 1、掃描器壞了、名出找過的目錄', () => {
    const root = makeRoot();
    rmSync(join(root, 'features'), { recursive: true, force: true });
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('掃到 0 個 .ts 檔');
    expect(output).toContain(join(root, 'features/steps'));
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).toContain('gate=module-cast result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('skipDirs 生效:node_modules 底下的檔案不掃', () => {
    const root = makeRoot();
    writeRaw(
      root,
      'features/steps/node_modules/x.ts',
      ["import * as core from 'y';", 'export const api = core as unknown as { f: () => void };', ''].join('\n'),
    );
    const { code, output } = run(root);
    expect(output).toContain('gate=module-cast result=PASS scanned=2');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);
});
