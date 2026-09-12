// SOURCE: template v1.6.4 (4dc1513) sha256=5ad25eebee6eaf1cb82c489eb2e34a1a7f85c18402ae0988e2de4d553ccd3cb2 — 勿手改;升版用 sync-gates.sh
/**
 * scripts/check-step-dup.ts 的測試(模板 1.6.0,P-87)。
 *
 * 這支守門沒有 `--root` 旗標(見 zero-input.gates.test.ts 的 NO_ROOT_FLAG),repo 根一律
 * 用 `git rev-parse --show-toplevel` 從 cwd 推定——所以 fixture 自己要是一個 git repo
 * (`git init`),子行程的 cwd 指到 fixture。gates.config.json 用 GATES_CONFIG_DIR 指到
 * fixture 自己的 scripts/,不讓它撿到模板自己的那份。
 *
 * 四條反向驗證對應檔頭的 (a)–(d);(d) 是 1.6.0 補的角落:**跨檔逐字相同、但 feature 還沒
 * 用到**的定義也要紅——1.5.x 只比對 feature 已經用到的句子,這種重複完全看不見。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHECK_STEP_DUP_TS = resolve(import.meta.dirname, 'check-step-dup.ts');
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

const COMMON_STEPS = [
  "import { Given, Then } from '@cucumber/cucumber';",
  "Then('it exits with status {int}', function () {});",
  '',
].join('\n');

const ALPHA_STEPS = [
  "import { Given, Then } from '@cucumber/cucumber';",
  "Given('the store has {int} items', function () {});",
  "Then('the log line(s) contain(s) {string}', function () {});",
  '',
].join('\n');

const BETA_STEPS = [
  "import { Given, Then } from '@cucumber/cucumber';",
  "Then('the output mentions {string}', function () {});",
  '',
].join('\n');

/** 乾淨的 fixture:兩個能力資料夾 + 一個整合場景,每句恰好一個定義,`it exits with status`
 *  跨三個資料夾但只定義在 common(反向驗證 (c) 的情境)。 */
function makeCleanRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lc-step-dup-'));
  tmpDirs.push(root);
  const git = spawnSync('git', ['init', '-q', root], { encoding: 'utf8' });
  if (git.status !== 0) throw new Error(`git init 失敗:${git.stderr}`);
  writeRaw(root, 'scripts/gates.config.json', '{}');
  writeRaw(
    root,
    'features/01-alpha/phase-1.feature',
    ['@alpha @phase-1', 'Feature: alpha', '  Scenario: one', '    Given the store has 3 items', '    Then it exits with status 0', ''].join('\n'),
  );
  writeRaw(
    root,
    'features/02-beta/phase-1.feature',
    ['@beta @phase-1', 'Feature: beta', '  Scenario: two', '    Then the output mentions "x"', '    Then it exits with status 1', ''].join('\n'),
  );
  writeRaw(
    root,
    'docs/integration/i1.feature',
    ['@integration @i1', 'Feature: i1', '  Scenario: end to end', '    Given the store has 9 items', '    Then it exits with status 0', ''].join('\n'),
  );
  writeRaw(root, 'features/steps/common.steps.ts', COMMON_STEPS);
  writeRaw(root, 'features/steps/alpha.steps.ts', ALPHA_STEPS);
  writeRaw(root, 'features/steps/beta.steps.ts', BETA_STEPS);
  return root;
}

function run(root: string, ...extra: string[]): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', CHECK_STEP_DUP_TS, ...extra], {
    cwd: root,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, GATES_CONFIG_DIR: join(root, 'scripts') },
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('check-step-dup:每種步驟形狀恰好一個定義', () => {
  it('乾淨的 fixture:exit 0、跨資料夾但只有一個定義的句子不算紅', () => {
    const root = makeCleanRoot();
    const { code, output } = run(root);
    expect(output).toContain('無重複定義');
    expect(output).toContain('gate=step-dup result=PASS scanned=6');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (a):common 的句子原樣貼進另一個 steps 檔 → exit 1、列出兩個定義檔與用到它的資料夾', () => {
    const root = makeCleanRoot();
    writeRaw(root, 'features/steps/beta.steps.ts', BETA_STEPS + "Then('it exits with status {int}', function () {});\n");
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('1 句被定義了 ≥2 次');
    expect(output).toContain('定義於:features/steps/common.steps.ts');
    expect(output).toContain('定義於:features/steps/beta.steps.ts');
    expect(output).toContain('用於:docs/integration, features/01-alpha, features/02-beta');
    expect(output).toContain('gate=step-dup result=FAIL scanned=6');
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (b):刪掉剛貼的定義 → 回綠', () => {
    const root = makeCleanRoot();
    writeRaw(root, 'features/steps/beta.steps.ts', BETA_STEPS + "Then('it exits with status {int}', function () {});\n");
    expect(run(root).code).toBe(1);
    writeRaw(root, 'features/steps/beta.steps.ts', BETA_STEPS);
    const { code, output } = run(root);
    expect(output).toContain('gate=step-dup result=PASS scanned=6');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (d,P-87):跨檔逐字相同、但沒有任何 feature 用到的定義 → exit 1、明說沒有 feature 用到', () => {
    const root = makeCleanRoot();
    // alpha 的 optional-text 句子(feature 裡沒人用)被 beta 逐字照抄
    writeRaw(root, 'features/steps/beta.steps.ts', BETA_STEPS + "Then('the log line(s) contain(s) {string}', function () {});\n");
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain("'the log line(s) contain(s) {string}'");
    expect(output).toContain('定義於:features/steps/alpha.steps.ts');
    expect(output).toContain('定義於:features/steps/beta.steps.ts');
    expect(output).toContain('目前沒有任何 .feature 用到');
    expect(output).toContain('1 句目前沒有 feature 用到');
    expect(output).toContain('gate=step-dup result=FAIL scanned=6');
  }, SPAWN_TIMEOUT_MS);

  it('regex 定義與 expression 定義形狀相同也算重複(複製貼上換個寫法躲不掉)', () => {
    const root = makeCleanRoot();
    writeRaw(root, 'features/steps/beta.steps.ts', BETA_STEPS + "Then(/^it exits with status (\\d+)$/, function () {});\n");
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('/^it exits with status (\\d+)$/');
    expect(output).toContain('定義於:features/steps/common.steps.ts');
    expect(output).toContain('定義於:features/steps/beta.steps.ts');
  }, SPAWN_TIMEOUT_MS);

  it('AI_KM 坑 23 的原文(純字面、無參數)跨檔逐字相同 → 紅;前綴相同但不同句、參數句多一段的對照組 → 不誤報', () => {
    const root = makeCleanRoot();
    const sentence = 'a person has already asked a question in a conversation whose reply the server will generate itself, with real citations';
    writeRaw(
      root,
      'features/steps/app-shell-phase-3.steps.ts',
      [
        "import { Given, Then, When } from '@cucumber/cucumber';",
        `Given('${sentence}', function () {});`,
        "Then('a server-generated reply carries two citations', function () {});",
        "When('the vitest check for {string} is run', function () {});",
        '',
      ].join('\n'),
    );
    writeRaw(
      root,
      'features/steps/app-shell-phase-4.steps.ts',
      [
        "import { Given, Then, When } from '@cucumber/cucumber';",
        `Given('${sentence}', function () {});`,
        "Then('a server-generated reply carries one citation with its own projected text', function () {});",
        "When('the vitest check for {string} in message-thread.test.tsx is run', function () {});",
        '',
      ].join('\n'),
    );
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('1 句被定義了 ≥2 次');
    expect(output).toContain(sentence);
    expect(output).not.toContain('a server-generated reply carries');
    expect(output).not.toContain('the vitest check for');
  }, SPAWN_TIMEOUT_MS);

  it('註解掉的定義不算(反向驗證時 `// Then(...)` 不會誤判)', () => {
    const root = makeCleanRoot();
    writeRaw(root, 'features/steps/beta.steps.ts', BETA_STEPS + "// Then('it exits with status {int}', function () {});\n");
    const { code, output } = run(root);
    expect(output).toContain('gate=step-dup result=PASS');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('0 個 .feature 檔 → exit 1、掃描器壞了、scanned=0', () => {
    const root = makeCleanRoot();
    rmSync(join(root, 'features/01-alpha'), { recursive: true, force: true });
    rmSync(join(root, 'features/02-beta'), { recursive: true, force: true });
    rmSync(join(root, 'docs'), { recursive: true, force: true });
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('掃到 0 個 .feature 檔');
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).toContain('gate=step-dup result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('有 feature 但解析到 0 個步驟定義(steps 目錄不在 features/steps)→ exit 1、掃描器壞了', () => {
    const root = makeCleanRoot();
    rmSync(join(root, 'features/steps'), { recursive: true, force: true });
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('解析到 0 個步驟定義');
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).toContain('gate=step-dup result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('--list 只列跨資料夾的句子,不判斷退出碼', () => {
    const root = makeCleanRoot();
    writeRaw(root, 'features/steps/beta.steps.ts', BETA_STEPS + "Then('it exits with status {int}', function () {});\n");
    const { code, output } = run(root, '--list');
    expect(output).toContain('[3 資料夾]');
    expect(output).toContain('gate=step-dup result=PASS scanned=6');
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);
});
