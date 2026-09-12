/**
 * 審核輪:reports/ 下唯二可進版控的資料不是一般產物。
 *
 * 這些測試故意用暫存目錄與暫存 git repo 製造條件；不從被測程式讀答案，
 * 否則 ignore 規則或「局部跑」判定壞掉時斷言會一起被跳過。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mutationCommand, mutationSummaryFromReport, withReportEnforcement } from './mutate.js';
import { shouldUpdateTestcaseBaseline, testcaseNamesFromJunit } from './run-tests.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const RUN_TESTS = join(REPO_ROOT, 'scripts', 'run-tests.ts');
const created: string[] = [];

interface StoredMutationSummary {
  score: number;
  killed: number;
  timeout: number;
  survived: number;
  noCoverage: number;
}

/**
 * The committed summary must remain independently auditable: it is deliberately
 * not imported from mutate.ts, so a future Stryker definition change makes this
 * assertion fail until both the producer and this recorded interpretation agree.
 * Stryker 10 defines the score as (Killed + Timeout) / valid, with Survived and
 * NoCoverage also valid; the summary keeps ignored/invalid statuses separately.
 */
function scoreFromStoredMutationCounts(summary: StoredMutationSummary): number {
  const valid = summary.killed + summary.timeout + summary.survived + summary.noCoverage;
  return valid === 0 ? 0 : Number((((summary.killed + summary.timeout) / valid) * 100).toFixed(2));
}

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  created.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true });
});

describe('JUnit testcase 名稱基準', () => {
  it('只有明確維護開關才允許成功全套覆寫基準', () => {
    expect(shouldUpdateTestcaseBaseline({})).toBe(false);
    expect(shouldUpdateTestcaseBaseline({ UPDATE_JUNIT_TESTCASE_BASELINE: '0' })).toBe(false);
    expect(shouldUpdateTestcaseBaseline({ UPDATE_JUNIT_TESTCASE_BASELINE: '1' })).toBe(true);
  });

  it('以 classname + name 當完整名，並保留重複名稱作為 multiset', () => {
    const xml = [
      '<testsuites>',
      '  <testcase classname="a.first" name="同名 &amp; &lt;符號&gt;"/>',
      '  <testcase classname="a.first" name="同名 &amp; &lt;符號&gt;"/>',
      '  <testcase classname="b.second" name="同名 &amp; &lt;符號&gt;"/>',
      '</testsuites>',
    ].join('\n');

    expect(testcaseNamesFromJunit(xml)).toEqual([
      'a.first > 同名 & <符號>',
      'a.first > 同名 & <符號>',
      'b.second > 同名 & <符號>',
    ]);
  });

  it('局部執行真實 run-tests CLI 時，既有的全套基準位元組不變', () => {
    const cwd = temp('reports-persist-partial');
    const baseline = join(cwd, 'reports', 'junit', 'testcase-names.txt');
    const testFile = join(cwd, 'foo.test.ts');
    const before = '全套 > 唯一基準\n全套 > 重複\n全套 > 重複\n';
    mkdirSync(join(cwd, 'reports', 'junit'), { recursive: true });
    writeFileSync(baseline, before, 'utf8');
    // 暫存目錄不是 repo，不可依賴本專案 vitest 設定；放真 node_modules 連結讓它能跑一支真測試。
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(cwd, 'node_modules'), 'dir');
    writeFileSync(testFile, "import { expect, it } from 'vitest'; it('局部', () => expect(1).toBe(1));\n", 'utf8');

    const result = spawnSync(process.execPath, ['--import', 'tsx', RUN_TESTS, '--', testFile], {
      cwd,
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(baseline, 'utf8')).toBe(before);
  }, 70_000);
});

describe('reports 的 gitignore 例外', () => {
  it('只放行 SHA mutation 摘要與 junit 基準，raw/effective 產物仍被 git 擋下', () => {
    const cwd = temp('reports-persist-ignore');
    writeFileSync(join(cwd, '.gitignore'), readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8'), 'utf8');
    expect(git(cwd, 'init', '-q').status).toBe(0);

    const allowed = ['reports/mutation/abcdef0-config.json', 'reports/junit/testcase-names.txt'];
    const blocked = ['reports/mutation/.raw-config.json', 'reports/mutation/.effective-config.json'];
    for (const path of [...allowed, ...blocked]) {
      const file = join(cwd, path);
      mkdirSync(resolve(file, '..'), { recursive: true });
      writeFileSync(file, '{}\n', 'utf8');
      expect(existsSync(file)).toBe(true);
    }

    for (const path of allowed) {
      const check = git(cwd, 'check-ignore', '-v', path);
      // `-v` 會把「解除父目錄 ignore」的 !pattern 也印出且回 0；重點是命中的規則本身必須是 negation。
      expect(check.status, `${path} 沒有得到可稽核的 ignore 規則說明: ${check.stdout}${check.stderr}`).toBe(0);
      expect(check.stdout, `${path} 被正向 ignore 而不是被 ! 規則放行: ${check.stdout}`).toMatch(/:\!reports\//);
    }
    for (const path of blocked) {
      const check = git(cwd, 'check-ignore', '-v', path);
      expect(check.status, `${path} unexpectedly trackable: ${check.stdout}${check.stderr}`).toBe(0);
      expect(check.stdout).toContain(path);
    }
  });
});

describe('mutation 摘要', () => {
  it('真實摘要可從檔內狀態計數自行驗算分數', () => {
    const summaryDir = join(REPO_ROOT, 'reports', 'mutation');
    const summaryNames = existsSync(summaryDir)
      ? readdirSync(summaryDir).filter((name) => /^[0-9a-f]{7}-.+\.json$/.test(name)).sort()
      : [];

    // A fresh checkout can have no generated summaries; passing is allowed, but never silent.
    if (summaryNames.length === 0) console.info('mutation summary self-check: 0 summaries found');

    for (const name of summaryNames) {
      const summary = JSON.parse(readFileSync(join(summaryDir, name), 'utf8')) as StoredMutationSummary;
      const recomputed = scoreFromStoredMutationCounts(summary);
      const difference = Math.abs(summary.score - recomputed);
      expect(
        difference,
        `${name}: stored score ${summary.score.toFixed(2)} differs from recomputed ${recomputed.toFixed(2)} by ${difference.toFixed(2)}`,
      ).toBeLessThanOrEqual(0.01);
    }
  });

  it('保留完整 Stryker 狀態計數和可重現命令；預設設定也必須明寫設定檔', () => {
    const summary = mutationSummaryFromReport(
      {
        files: {
          'x.ts': {
            mutants: [
              { status: 'Killed' },
              { status: 'Timeout' },
              { status: 'Survived' },
              { status: 'NoCoverage' },
              { status: 'Ignored' },
              { status: 'RuntimeError' },
              { status: 'CompileError' },
              { status: 'Pending' },
            ],
          },
        },
      },
      { command: mutationCommand(['node', 'scripts/mutate.ts', '--', '--mutate', 'packages/core/src/x.ts'], 'stryker.config.json'), strykerVersion: '10.0.0', config: 'stryker.config.json', commit: 'abcdef0' },
    );

    // The fixture must contain Ignored: without it, the old all-mutants denominator bug stays hidden.
    // Stryker counts only the four valid statuses in its score: (Killed + Timeout) / valid = 2 / 4.
    expect(summary).toMatchObject({
      score: 50,
      killed: 1,
      timeout: 1,
      survived: 1,
      noCoverage: 1,
      ignored: 1,
      runtimeError: 1,
      compileError: 1,
      pending: 1,
      config: 'stryker.config.json',
      commit: 'abcdef0',
    });
    expect(summary.command).toBe('npm run mutate -- stryker.config.json --mutate packages/core/src/x.ts');
  });

  it('在有 commit 的 worktree 將 raw 報告轉成 <sha>-<設定名>.json，而不是留下 raw 報告', async () => {
    const cwd = temp('reports-persist-mutation');
    expect(git(cwd, 'init', '-q').status).toBe(0);
    expect(git(cwd, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'init').status).toBe(0);
    writeFileSync(join(cwd, 'stryker.config.json'), JSON.stringify({ reporters: [] }), 'utf8');

    const code = await withCwd(cwd, () =>
      withReportEnforcement(async (args) => {
        const effective = JSON.parse(readFileSync(args[1]!, 'utf8')) as { jsonReporter: { fileName: string } };
        const raw = join(cwd, effective.jsonReporter.fileName);
        mkdirSync(resolve(raw, '..'), { recursive: true });
        writeFileSync(raw, JSON.stringify({ files: { 'x.ts': { mutants: [{ status: 'Killed' }, { status: 'Survived' }] } } }), 'utf8');
        return 0;
      }, () => {})(['run', 'stryker.config.json', '--mutate', 'packages/core/src/x.ts']),
    );

    expect(code).toBe(0);
    const mutationFiles = readFileSync(join(cwd, 'reports', 'mutation', `${git(cwd, 'rev-parse', '--short=7', 'HEAD').stdout.trim()}-config.json`), 'utf8');
    expect(JSON.parse(mutationFiles)).toMatchObject({
      score: 50,
      killed: 1,
      survived: 1,
      ignored: 0,
      runtimeError: 0,
      compileError: 0,
      pending: 0,
      config: 'stryker.config.json',
    });
  });
});
