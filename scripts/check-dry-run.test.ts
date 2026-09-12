// SOURCE: template v1.6.4 (4dc1513) sha256=479829ea49478c14613adf5743196cef540bb51271fff16f8d8d275d37b40467 — 勿手改;升版用 sync-gates.sh
/**
 * scripts/check-dry-run.ts 的測試(模板 1.6.0,P-86)。
 *
 * 跟其餘掃描器的測試同一個形狀:造一次性的暫存目錄當假 consumer 根,`--root` 明講,
 * 不碰真的 repo。**這裡跑的是真的 cucumber**(fixture 的 `node_modules` 是指向模板自己
 * `node_modules` 的符號連結,`npx cucumber-js` 在 fixture 裡就找得到執行檔跟 tsx)——
 * 因為這支守門的全部價值就在「cucumber 對 dry-run 的 ambiguous/undefined 退出碼是 0」
 * 這個實測事實,用假的 cucumber 輸出去測等於在測自己的想像。
 *
 * 坑 23(來源 AI_KM):守門提案接進 CI 前要先讓它紅一次——下面「ambiguous」那條測試就是
 * 那個「紅一次」,而且同一份 fixture 先直接對 `cucumber-js --dry-run --strict` 斷言 exit 0,
 * 證明「不信退出碼」不是多此一舉。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHECK_DRY_RUN_TS = resolve(import.meta.dirname, 'check-dry-run.ts');
const TEMPLATE_NODE_MODULES = resolve(import.meta.dirname, '..', 'node_modules');
const CUCUMBER_BIN = join(TEMPLATE_NODE_MODULES, '.bin', 'cucumber-js');
const SPAWN_TIMEOUT_MS = 120_000;
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

/** 一個能跑真 cucumber 的最小 consumer:cucumber.json + 兩個資料夾各一個 phase 檔 +
 *  兩個 steps 檔(CJS,fixture 沒有 package.json 所以 .js 就是 CJS)。預設狀態是乾淨的:
 *  每句恰好一個定義。 */
function makeCleanRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lc-dry-run-'));
  tmpDirs.push(root);
  symlinkSync(TEMPLATE_NODE_MODULES, join(root, 'node_modules'), 'dir');
  writeRaw(
    root,
    'cucumber.json',
    JSON.stringify({ default: { paths: ['features/**/*.feature'], import: ['features/steps/**/*.js'] } }, null, 2),
  );
  writeRaw(root, 'scripts/gates.config.json', '{}');
  writeRaw(
    root,
    'features/01-alpha/phase-1.feature',
    ['@alpha @phase-1', 'Feature: alpha', '  Scenario: one', '    Given the store has 3 items', '    Then it exits with status 0', ''].join('\n'),
  );
  writeRaw(
    root,
    'features/02-beta/phase-1.feature',
    ['@beta @phase-1', 'Feature: beta', '  Scenario: two', '    Given the store has 5 items', '    Then the output mentions "x"', ''].join('\n'),
  );
  writeRaw(
    root,
    'features/steps/alpha.steps.js',
    [
      "const { Given, Then } = require('@cucumber/cucumber');",
      "Given('the store has {int} items', function () {});",
      "Then('it exits with status {int}', function () {});",
      '',
    ].join('\n'),
  );
  writeRaw(
    root,
    'features/steps/beta.steps.js',
    ["const { Then } = require('@cucumber/cucumber');", "Then('the output mentions {string}', function () {});", ''].join('\n'),
  );
  return root;
}

/** 反向驗證 (a):把 alpha 的第一句原樣複製貼進 beta → 兩個定義 → ambiguous。 */
function injectAmbiguous(root: string): void {
  writeRaw(
    root,
    'features/steps/beta.steps.js',
    [
      "const { Given, Then } = require('@cucumber/cucumber');",
      "Given('the store has {int} items', function () {});",
      "Then('the output mentions {string}', function () {});",
      '',
    ].join('\n'),
  );
}

/**
 * 反向驗證 (a2):**參數化定義蓋住字面定義**——兩個定義的字串**不相同**,但都匹配同一句。
 * 這是本 gate 存在的主要理由:`check-step-dup.ts` 比的是正規化後的字面形狀,
 * `{word}` 與 `rich` 是不同形狀,它看不出這兩個定義會撞在一起;cucumber 看得出來
 * (印 ambiguous)但不用退出碼講。只測 (a) 逐字相同的話,`check-step-dup.ts` 本來就
 * 接得住,等於沒驗到這支新 gate 真正要補的那一塊。
 * 來源:專案 A 技術顧問 2026-09-12 實測回報(參數化重疊時 accept:dry 與 check-step-dup 兩道全綠)。
 */
function injectParamOverlap(root: string): void {
  writeRaw(
    root,
    'features/steps/alpha.steps.js',
    [
      "const { Given, Then } = require('@cucumber/cucumber');",
      "Given('the store has {int} items', function () {});",
      "Given('the store loads the rich fixture set', function () {});",
      "Then('it exits with status {int}', function () {});",
      '',
    ].join('\n'),
  );
  writeRaw(
    root,
    'features/steps/beta.steps.js',
    [
      "const { Given, Then } = require('@cucumber/cucumber');",
      "Given('the store loads the {word} fixture set', function () {});",
      "Then('the output mentions {string}', function () {});",
      '',
    ].join('\n'),
  );
  writeRaw(
    root,
    'features/02-beta/phase-1.feature',
    [
      '@beta @phase-1',
      'Feature: beta',
      '  Scenario: two',
      '    Given the store loads the rich fixture set',
      '',
    ].join('\n'),
  );
}

/** 反向驗證 (c):feature 檔多一句沒有任何定義的步驟 → undefined。 */
function injectUndefined(root: string): void {
  writeRaw(
    root,
    'features/02-beta/phase-1.feature',
    [
      '@beta @phase-1',
      'Feature: beta',
      '  Scenario: two',
      '    Given the store has 5 items',
      '    Then the output mentions "x"',
      '    And nobody defined this line',
      '',
    ].join('\n'),
  );
}

function run(root: string, ...extra: string[]): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', CHECK_DRY_RUN_TS, '--root', root, ...extra], {
    cwd: root,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, GATES_CONFIG_DIR: join(root, 'scripts') },
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** 直接對 fixture 跑 cucumber 本人(不經這支守門),拿它的退出碼跟摘要行。 */
function runRawCucumber(root: string, ...extra: string[]): { code: number; output: string } {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const r = spawnSync(CUCUMBER_BIN, ['--dry-run', '--format', 'summary', ...extra], {
    cwd: root,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env,
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const haveCucumber = existsSync(CUCUMBER_BIN);

describe.skipIf(!haveCucumber)('check-dry-run:讀摘要行,不信退出碼(P-86)', () => {
  it('乾淨的 fixture:exit 0、印 PASS 標記、scanned 是場景數', () => {
    const root = makeCleanRoot();
    const { code, output } = run(root);
    expect(output).toContain('2 scenarios');
    expect(output).toContain('gate=dry-run result=PASS scanned=2');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('前提(cucumber 本人):同一份 ambiguous fixture,--dry-run 與 --dry-run --strict 都 exit 0', () => {
    // 這條測的是「為什麼需要這支守門」的事實本身。哪天 cucumber 升版後這條開始紅,
    // 代表 cucumber 自己會擋了——那時候這支守門可以退休,但要先看到這條紅才算數。
    const root = makeCleanRoot();
    injectAmbiguous(root);
    const plain = runRawCucumber(root);
    expect(plain.output).toMatch(/\bambiguous\b/);
    expect(plain.code).toBe(0);
    const strict = runRawCucumber(root, '--strict');
    expect(strict.output).toMatch(/\bambiguous\b/);
    expect(strict.code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (a):跨檔逐字相同的 Cucumber Expression → exit 1、摘要行 ambiguous、列出兩個檔案', () => {
    const root = makeCleanRoot();
    injectAmbiguous(root);
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('ambiguous=');
    expect(output).toContain('alpha.steps.js');
    expect(output).toContain('beta.steps.js');
    expect(output).toContain('gate=dry-run result=FAIL scanned=2');
    expect(output).toContain('check:steps');
    expect(output).not.toContain('段 B'); // 沒帶 tag,段 B 略過
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (a2):參數化定義蓋住字面定義(兩個字串不同)→ exit 1、摘要行 ambiguous', () => {
    const root = makeCleanRoot();
    injectParamOverlap(root);
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('ambiguous=');
    expect(output).toContain('alpha.steps.js');
    expect(output).toContain('beta.steps.js');
    expect(output).toContain('gate=dry-run result=FAIL');
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (b):拿掉重複的定義 → 回綠', () => {
    const root = makeCleanRoot();
    injectAmbiguous(root);
    expect(run(root).code).toBe(1);
    // 還原成乾淨的 beta.steps.js
    writeRaw(
      root,
      'features/steps/beta.steps.js',
      ["const { Then } = require('@cucumber/cucumber');", "Then('the output mentions {string}', function () {});", ''].join('\n'),
    );
    const { code, output } = run(root);
    expect(output).toContain('gate=dry-run result=PASS scanned=2');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (c):沒有定義的步驟句 → exit 1、摘要行 undefined(cucumber 本人一樣 exit 0)', () => {
    const root = makeCleanRoot();
    injectUndefined(root);
    expect(runRawCucumber(root, '--strict').code).toBe(0);
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('undefined=1');
    expect(output).toContain('gate=dry-run result=FAIL scanned=2');
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (d):--tags 比對到 0 個場景 → exit 1、印 0 個場景與掃描器壞了、scanned=0', () => {
    const root = makeCleanRoot();
    const { code, output } = run(root, '--tags', '@this-tag-does-not-exist');
    expect(code).toBe(1);
    expect(output).toContain('掃到 0 個場景');
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).toContain('gate=dry-run result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('--tags 真的有傳給 cucumber:只選 @alpha 就只剩 1 個場景', () => {
    const root = makeCleanRoot();
    const { code, output } = run(root, '--tags', '@alpha');
    expect(output).toContain('1 scenario');
    expect(output).toContain('gate=dry-run result=PASS scanned=1');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('-- 之後的參數原樣附給 cucumber:--name 過濾', () => {
    const root = makeCleanRoot();
    const { code, output } = run(root, '--', '--name', 'two');
    expect(output).toContain('gate=dry-run result=PASS scanned=1');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('cucumber 自己說壞(feature 檔 Parse error,P-16):exit 1、標記 FAIL', () => {
    const root = makeCleanRoot();
    writeRaw(root, 'features/02-beta/phase-1.feature', '@beta @phase-1\nFeature: beta\n  Scenario: two\n    Given x\n</content>\n');
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('gate=dry-run result=FAIL');
  }, SPAWN_TIMEOUT_MS);

  // ---- 兩段(AI_KM 第二輪):undefined 只在驗收集合裡算,ambiguous 對全集算 ----

  /** 一個 @todo 場景(驗收 job 用 `not @todo` 排除),裡面放一句沒定義的步驟——設計上的 todo。 */
  function addTodoScenario(root: string, extraStep: string): void {
    writeRaw(
      root,
      'features/03-later/phase-1.feature',
      ['@later @phase-1', 'Feature: later', '  @todo', '  Scenario: not yet', `    Given ${extraStep}`, '    And nobody defined this line', ''].join('\n'),
    );
  }

  it('反向驗證 (e1):undefined 只出現在 @todo 場景、--tags "not @todo" → 綠,段 B 註明那是驗收集合外的 todo', () => {
    const root = makeCleanRoot();
    addTodoScenario(root, 'the store has 1 items');
    const { code, output } = run(root, '--tags', 'not @todo');
    expect(output).toContain('gate=dry-run result=PASS scanned=2');
    expect(output).toContain('視為設計上的 todo');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (e2):撞名的句子只出現在 @todo 場景、--tags "not @todo" → 紅(段 B 抓到,tag 排除不了 ambiguous)', () => {
    const root = makeCleanRoot();
    injectAmbiguous(root); // the store has {int} items 兩份
    // 驗收集合裡不用那句:把 alpha 的 Given 換掉,只有 @todo 場景還在用
    writeRaw(
      root,
      'features/01-alpha/phase-1.feature',
      ['@alpha @phase-1', 'Feature: alpha', '  Scenario: one', '    Then it exits with status 0', ''].join('\n'),
    );
    writeRaw(
      root,
      'features/02-beta/phase-1.feature',
      ['@beta @phase-1', 'Feature: beta', '  Scenario: two', '    Then the output mentions "x"', ''].join('\n'),
    );
    addTodoScenario(root, 'the store has 1 items');
    const { code, output } = run(root, '--tags', 'not @todo');
    expect(code).toBe(1);
    expect(output).toContain('段 B(全集)有 1 個 ambiguous');
    expect(output).toContain('gate=dry-run result=FAIL scanned=2');
  }, SPAWN_TIMEOUT_MS);

  it('沒帶 --tags 時 undefined 一律算(段 B 略過)', () => {
    const root = makeCleanRoot();
    addTodoScenario(root, 'the store has 1 items');
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('undefined=1');
    expect(output).not.toContain('段 B');
  }, SPAWN_TIMEOUT_MS);

  it('gates.config.json 的 dryRun.tags 當 --tags 用,--tags 旗標優先', () => {
    const root = makeCleanRoot();
    addTodoScenario(root, 'the store has 1 items');
    writeRaw(root, 'scripts/gates.config.json', JSON.stringify({ dryRun: { tags: 'not @todo' } }));
    const viaConfig = run(root);
    expect(viaConfig.output).toContain("tag 來源:gates.config.json 的 dryRun.tags('not @todo')");
    expect(viaConfig.output).toContain('gate=dry-run result=PASS scanned=2');
    expect(viaConfig.code).toBe(0);
    const viaFlag = run(root, '--tags', '@todo');
    expect(viaFlag.output).toContain("tag 來源:--tags 旗標('@todo')");
    expect(viaFlag.output).toContain('undefined=1');
    expect(viaFlag.code).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it('dryRun.tags 型別錯 / 空字串 → exit 1、設定錯訊息、scanned=0', () => {
    const root = makeCleanRoot();
    writeRaw(root, 'scripts/gates.config.json', JSON.stringify({ dryRun: { tags: ['not @todo'] } }));
    const typeErr = run(root);
    expect(typeErr.code).toBe(1);
    expect(typeErr.output).toContain('dryRun.tags');
    expect(typeErr.output).toContain('gate=dry-run result=FAIL scanned=0');
    writeRaw(root, 'scripts/gates.config.json', JSON.stringify({ dryRun: { tags: '  ' } }));
    const empty = run(root);
    expect(empty.code).toBe(1);
    expect(empty.output).toContain('"dryRun.tags" 是空字串');
  }, SPAWN_TIMEOUT_MS);

  it('--cwd 指到不存在的目錄:exit 1、名出路徑、scanned=0', () => {
    const root = makeCleanRoot();
    const missing = join(root, 'nope');
    const { code, output } = run(root, '--cwd', 'nope');
    expect(code).toBe(1);
    expect(output).toContain(missing);
    expect(output).toContain('gate=dry-run result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('gates.config.json 的 cucumberCwd 指到不存在的目錄:exit 1、不退回自動偵測', () => {
    const root = makeCleanRoot();
    writeRaw(root, 'scripts/gates.config.json', JSON.stringify({ cucumberCwd: 'elsewhere' }));
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('"cucumberCwd" 指定的目錄不存在');
    expect(output).toContain('gate=dry-run result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);
});
