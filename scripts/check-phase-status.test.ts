// SOURCE: template v1.4.2 (1c1d403) sha256=d3439c86eba59381f49b3cd783f148256c3e212c678dd2f4ef100c86167b8865 — 勿手改;升版用 sync-gates.sh
/**
 * scripts/check-phase-status.ts 的單元測試(S15,模板 1.4.2)。
 *
 * cucumber 的「真跑」這一步用 `PHASE_STATUS_RUN_CMD` 注入(見這支腳本檔頭說明):
 * 指到一個會讀 `PHASE_STATUS_TAG_EXPR` 環境變數、印出「跟 cucumber --format summary
 * 輸出格式一致」內容的 shell 指令,不需要臨時 repo 真的裝 cucumber、真的有場景就能測完整的
 * 三種形狀邏輯。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHECK_PHASE_STATUS_TS = resolve(import.meta.dirname, 'check-phase-status.ts');
const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];
let originalRunCmd: string | undefined;

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-phase-status-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  return dir;
}

function write(root: string, relPath: string, content: string): void {
  const p = join(root, relPath);
  mkdirSync(resolve(p, '..'), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

function writeFeatureTable(root: string, folder: string, rows: { phase: number; status: string }[]): void {
  const header = ['| Phase | 標題 | 階段 | 狀態 | 完成日 |', '|---|---|---|---|---|'];
  const body = rows.map((r) => `| ${r.phase} | 標題 | Wave 0 | ${r.status} |  |`);
  write(root, `features/${folder}/FEATURE.md`, [`# ${folder}`, '', '## Phase', '', ...header, ...body, ''].join('\n'));
}

function writePhaseFeatureFile(root: string, folder: string, phase: number): void {
  const name = folder.replace(/^\d{2}-/, '');
  write(root, `features/${folder}/phase-${phase}.feature`, `@${name} @phase-${phase}\nFeature: 佔位\n\n  Scenario: 佔位\n    Given x\n`);
}

/** 寫一支假的「cucumber 真跑」腳本:依 `PHASE_STATUS_TAG_EXPR` 裡有沒有出現某個子字串,
 *  回不同的假 summary 輸出。 */
function writeRunStub(root: string, mapping: Record<string, string>): string {
  const p = join(root, 'run-stub.mjs');
  const code = [
    "const expr = process.env.PHASE_STATUS_TAG_EXPR || '';",
    `const map = ${JSON.stringify(mapping)};`,
    'let out = "0 scenarios (0 passed)";',
    'for (const key of Object.keys(map)) { if (expr.includes(key)) { out = map[key]; break; } }',
    'process.stdout.write(out);',
  ].join('\n');
  writeFileSync(p, code, 'utf8');
  return `node ${p}`;
}

function gitInitAndCommit(root: string, relFiles: string[]): void {
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['add', ...relFiles], { cwd: root });
  spawnSync('git', ['commit', '-q', '-m', 'test commit'], { cwd: root });
}

function run(root: string, runCmd: string, extra: string[] = []): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', CHECK_PHASE_STATUS_TS, '--root', root, ...extra], {
    cwd: root,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, GATES_CONFIG_DIR: join(root, 'scripts'), PHASE_STATUS_RUN_CMD: runCmd },
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function writeGatesConfig(root: string, config: unknown): void {
  writeFileSync(join(root, 'scripts', 'gates.config.json'), JSON.stringify(config, null, 2), 'utf8');
}

function reviewWithHeadingPass(mentions: string): string {
  return ['# 審核', '', '## 判定', '', `**PASS**。${mentions} 全部通過。`, ''].join('\n');
}

beforeEach(() => {
  originalRunCmd = process.env.PHASE_STATUS_RUN_CMD;
});

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  if (originalRunCmd === undefined) delete process.env.PHASE_STATUS_RUN_CMD;
  else process.env.PHASE_STATUS_RUN_CMD = originalRunCmd;
});

describe('check-phase-status:形狀一(疑似已完成,狀態表未更新)', () => {
  it('in-progress + 場景全綠 + REVIEW PASS 已 commit → 命中,report 模式 exit 0', () => {
    const root = makeRoot();
    writeFeatureTable(root, '01-foo', [{ phase: 4, status: 'in-progress' }]);
    writePhaseFeatureFile(root, '01-foo', 4);
    write(root, 'features/01-foo/REVIEW.md', reviewWithHeadingPass('01-foo/phase-4'));
    gitInitAndCommit(root, ['features/01-foo/REVIEW.md']);
    const cmd = writeRunStub(root, { 'phase-4': '13 scenarios (13 passed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).toContain('○ 01-foo/phase-4 疑似已完成:場景 13/13 綠、features/01-foo/REVIEW.md PASS 已合併,狀態表仍 in-progress');
    expect(output).toContain('gate=phase-status result=FAIL scanned=1');
    expect(output).toContain('phaseStatus.mode = "report"');
  }, SPAWN_TIMEOUT_MS);

  it('同上但 REVIEW.md 沒有 commit → 不命中', () => {
    const root = makeRoot();
    writeFeatureTable(root, '01-foo', [{ phase: 4, status: 'in-progress' }]);
    writePhaseFeatureFile(root, '01-foo', 4);
    write(root, 'features/01-foo/REVIEW.md', reviewWithHeadingPass('01-foo/phase-4'));
    // 刻意不 git init / commit。
    const cmd = writeRunStub(root, { 'phase-4': '13 scenarios (13 passed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).not.toContain('疑似已完成');
    expect(output).toContain('gate=phase-status result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('場景沒有全綠(有 1 個 failed)→ 不命中', () => {
    const root = makeRoot();
    writeFeatureTable(root, '01-foo', [{ phase: 4, status: 'in-progress' }]);
    writePhaseFeatureFile(root, '01-foo', 4);
    write(root, 'features/01-foo/REVIEW.md', reviewWithHeadingPass('01-foo/phase-4'));
    gitInitAndCommit(root, ['features/01-foo/REVIEW.md']);
    const cmd = writeRunStub(root, { 'phase-4': '13 scenarios (12 passed, 1 failed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).not.toContain('疑似已完成');
    expect(output).toContain('gate=phase-status result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('REVIEW.md 存在且 commit,但沒有 PASS 標記 → 不命中', () => {
    const root = makeRoot();
    writeFeatureTable(root, '01-foo', [{ phase: 4, status: 'in-progress' }]);
    writePhaseFeatureFile(root, '01-foo', 4);
    write(root, 'features/01-foo/REVIEW.md', '# 審核\n\n01-foo/phase-4 還在看,還沒有結論。\n');
    gitInitAndCommit(root, ['features/01-foo/REVIEW.md']);
    const cmd = writeRunStub(root, { 'phase-4': '13 scenarios (13 passed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).not.toContain('疑似已完成');
    expect(output).toContain('gate=phase-status result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('PASS 標記單行寫法(判定:PASS)也能命中', () => {
    const root = makeRoot();
    writeFeatureTable(root, '01-foo', [{ phase: 4, status: 'in-progress' }]);
    writePhaseFeatureFile(root, '01-foo', 4);
    write(root, 'features/01-foo/REVIEW.md', '# 審核\n\n判定:PASS。01-foo/phase-4 全部通過。\n');
    gitInitAndCommit(root, ['features/01-foo/REVIEW.md']);
    const cmd = writeRunStub(root, { 'phase-4': '13 scenarios (13 passed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).toContain('疑似已完成');
  }, SPAWN_TIMEOUT_MS);

  it('PASS 標記用字面「審核 PASS」也能命中', () => {
    const root = makeRoot();
    writeFeatureTable(root, '01-foo', [{ phase: 4, status: 'in-progress' }]);
    writePhaseFeatureFile(root, '01-foo', 4);
    write(root, 'features/01-foo/REVIEW.md', '# 審核\n\n01-foo/phase-4 審核 PASS,合併。\n');
    gitInitAndCommit(root, ['features/01-foo/REVIEW.md']);
    const cmd = writeRunStub(root, { 'phase-4': '13 scenarios (13 passed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).toContain('疑似已完成');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-phase-status:形狀二(done 但場景紅)', () => {
  it('done + 有 failed → 命中,訊息交叉引用 check-phase-coverage.ts --run', () => {
    const root = makeRoot();
    writeFeatureTable(root, '02-bar', [{ phase: 1, status: 'done' }]);
    writePhaseFeatureFile(root, '02-bar', 1);
    const cmd = writeRunStub(root, { 'phase-1': '5 scenarios (4 passed, 1 failed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(0); // 預設 report 模式
    expect(output).toContain('✗ 02-bar/phase-1 狀態 done 但場景紅(failed)');
    expect(output).toContain('check-phase-coverage.ts --run');
    expect(output).toContain('gate=phase-status result=FAIL scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('done + 全綠 → 不命中', () => {
    const root = makeRoot();
    writeFeatureTable(root, '02-bar', [{ phase: 1, status: 'done' }]);
    writePhaseFeatureFile(root, '02-bar', 1);
    const cmd = writeRunStub(root, { 'phase-1': '5 scenarios (5 passed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).not.toContain('狀態 done 但場景紅');
    expect(output).toContain('gate=phase-status result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-phase-status:report 模式 vs enforce 模式', () => {
  it('預設(沒有 gates.config.json)是 report:有命中一樣 exit 0,marker 印 FAIL', () => {
    const root = makeRoot();
    writeFeatureTable(root, '02-bar', [{ phase: 1, status: 'done' }]);
    writePhaseFeatureFile(root, '02-bar', 1);
    const cmd = writeRunStub(root, { 'phase-1': '5 scenarios (4 passed, 1 failed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).toContain('gate=phase-status result=FAIL scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('phaseStatus.mode = "enforce":同樣的命中要 exit 1', () => {
    const root = makeRoot();
    writeFeatureTable(root, '02-bar', [{ phase: 1, status: 'done' }]);
    writePhaseFeatureFile(root, '02-bar', 1);
    writeGatesConfig(root, { phaseStatus: { mode: 'enforce' } });
    const cmd = writeRunStub(root, { 'phase-1': '5 scenarios (4 passed, 1 failed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('gate=phase-status result=FAIL scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('enforce 模式但沒有命中 → 一樣 exit 0', () => {
    const root = makeRoot();
    writeFeatureTable(root, '02-bar', [{ phase: 1, status: 'done' }]);
    writePhaseFeatureFile(root, '02-bar', 1);
    writeGatesConfig(root, { phaseStatus: { mode: 'enforce' } });
    const cmd = writeRunStub(root, { 'phase-1': '5 scenarios (5 passed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).toContain('gate=phase-status result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-phase-status:0 目標', () => {
  it('沒有 features/ 目錄(0 份 FEATURE.md)→ exit 1', () => {
    const root = makeRoot();
    const cmd = writeRunStub(root, {});

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('掃到 0 份 FEATURE.md');
    expect(output).toContain('這不是很乾淨,是掃描器壞了');
    expect(output).toContain('gate=phase-status result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('FEATURE.md 存在但一個 phase 表格列都解析不到 → exit 1', () => {
    const root = makeRoot();
    write(root, 'features/01-foo/FEATURE.md', '# 01-foo\n\n沒有任何表格。\n');
    const cmd = writeRunStub(root, {});

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('掃到 0 個 phase 表格列');
    expect(output).toContain('gate=phase-status result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-phase-status:S9 設定檔壞掉(共用 loader)', () => {
  it('gates.config.json 是壞掉的 JSON → 印「設定檔壞掉」,不是未捕捉的堆疊', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'scripts', 'gates.config.json'), '{ broken', 'utf8');
    const cmd = writeRunStub(root, {});

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔壞掉:');
    expect(output).toContain('gate=phase-status result=FAIL scanned=0');
    expect(output).not.toContain('at JSON.parse');
  }, SPAWN_TIMEOUT_MS);

  it('gates.config.json 有不認識的頂層鍵(打錯字)→ 大聲失敗', () => {
    const root = makeRoot();
    writeGatesConfig(root, { phaseStatuz: { mode: 'enforce' } });
    const cmd = writeRunStub(root, {});

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔有不認識的鍵:phaseStatuz');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-phase-status:形狀三(NEXT.md 過期)', () => {
  it('待辦區塊裡的識別碼有真的實作(非樁)→ 命中', () => {
    const root = makeRoot();
    writeFeatureTable(root, '01-foo', [{ phase: 1, status: 'todo' }]);
    write(root, 'features/01-foo/NEXT.md', ['# 下一步', '', '## 下一輪要做', '', '- `myFunc`', ''].join('\n'));
    write(root, 'src/impl.ts', ['export function myFunc(): number {', '  return 1;', '}', ''].join('\n'));
    const cmd = writeRunStub(root, {});

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).toContain('○ NEXT.md 過期:01-foo 列 myFunc 待實作,但 src/impl.ts:1 已有實作');
    expect(output).toContain('gate=phase-status result=FAIL scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('識別碼還是個樁(throw not implemented)→ 不報', () => {
    const root = makeRoot();
    writeFeatureTable(root, '01-foo', [{ phase: 1, status: 'todo' }]);
    write(root, 'features/01-foo/NEXT.md', ['# 下一步', '', '## 下一輪要做', '', '- `myFunc`', ''].join('\n'));
    write(root, 'src/impl.ts', [
      'export function myFunc(): number {',
      "  throw new Error('not implemented');",
      '}',
      '',
    ].join('\n'));
    const cmd = writeRunStub(root, {});

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).not.toContain('NEXT.md 過期');
    expect(output).toContain('gate=phase-status result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('識別碼找不到定義 → 不報', () => {
    const root = makeRoot();
    writeFeatureTable(root, '01-foo', [{ phase: 1, status: 'todo' }]);
    write(root, 'features/01-foo/NEXT.md', ['# 下一步', '', '## 下一輪要做', '', '- `myFunc`', ''].join('\n'));
    const cmd = writeRunStub(root, {});

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).not.toContain('NEXT.md 過期');
  }, SPAWN_TIMEOUT_MS);

  it('標題不含四個關鍵字之一 → 不算待辦區塊,即使有實作也不報', () => {
    const root = makeRoot();
    writeFeatureTable(root, '01-foo', [{ phase: 1, status: 'todo' }]);
    write(root, 'features/01-foo/NEXT.md', ['# 下一步', '', '## 已完成', '', '- `myFunc`', ''].join('\n'));
    write(root, 'src/impl.ts', ['export function myFunc(): number {', '  return 1;', '}', ''].join('\n'));
    const cmd = writeRunStub(root, {});

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).not.toContain('NEXT.md 過期');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-phase-status:專案 A 真實案例的 fixture(01/phase-4)', () => {
  function setupFixture(root: string, stubBodies: boolean): void {
    writeFeatureTable(root, '01-data-layer', [{ phase: 4, status: 'in-progress' }]);
    writePhaseFeatureFile(root, '01-data-layer', 4);
    write(root, 'features/01-data-layer/REVIEW.md', reviewWithHeadingPass('01-data-layer/phase-4'));
    write(
      root,
      'features/01-data-layer/NEXT.md',
      [
        '# 01 · data-layer — 下一步',
        '',
        '## 下一輪要做',
        '',
        '- `isGitAvailable`',
        '- `isOwnGitRepo`',
        '- `initGitRepo`',
        '- `snapshotLearningDir`',
        '',
      ].join('\n'),
    );
    const body = (name: string) =>
      stubBodies
        ? `export function ${name}(): void {\n  throw new Error('not implemented');\n}\n`
        : `export function ${name}(): void {\n  // 真的實作\n  return;\n}\n`;
    write(
      root,
      'packages/core/src/ingest/git-repo.ts',
      ['isGitAvailable', 'isOwnGitRepo', 'initGitRepo', 'snapshotLearningDir'].map(body).join('\n'),
    );
    gitInitAndCommit(root, ['features/01-data-layer/REVIEW.md']);
  }

  it('四個函式都已實作 → 形狀一與形狀三都命中', () => {
    const root = makeRoot();
    setupFixture(root, false);
    const cmd = writeRunStub(root, { 'phase-4': '13 scenarios (13 passed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).toContain('○ 01-data-layer/phase-4 疑似已完成');
    expect(output).toContain('NEXT.md 過期:01-data-layer 列 isGitAvailable 待實作');
    expect(output).toContain('NEXT.md 過期:01-data-layer 列 isOwnGitRepo 待實作');
    expect(output).toContain('NEXT.md 過期:01-data-layer 列 initGitRepo 待實作');
    expect(output).toContain('NEXT.md 過期:01-data-layer 列 snapshotLearningDir 待實作');
    expect(output).toContain('gate=phase-status result=FAIL scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('四個函式都還是樁(throw not implemented)→ 形狀一仍命中,但形狀三整批安靜', () => {
    const root = makeRoot();
    setupFixture(root, true);
    const cmd = writeRunStub(root, { 'phase-4': '13 scenarios (13 passed)' });

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).toContain('○ 01-data-layer/phase-4 疑似已完成');
    expect(output).not.toContain('NEXT.md 過期');
  }, SPAWN_TIMEOUT_MS);
});
