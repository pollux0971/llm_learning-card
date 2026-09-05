// SOURCE: template v1.4.3 (629b609) sha256=3414b8f7fa01a54d289df0a4e73d5adb44fb56b740658ff7222d07eb35b573b8 — 勿手改;升版用 sync-gates.sh
/**
 * scripts/check-next-gates.ts 的單元測試(模板 1.4.0 S6)。
 *
 * 造一次性的臨時 git repo(commit sha 引用要靠真的 git 歷史才能驗證存在與否),裡面放
 * 最小的 docs/02-decision-map.md、contracts/types.md、docs/01-roadmap.md、
 * docs/integration/、features/<NN-name>/{FEATURE.md,NEXT.md},跟真的專案格式對齊
 * (見這支腳本檔頭的說明)。`--root` 明講根目錄,不碰真的 repo。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHECK_NEXT_GATES_TS = resolve(import.meta.dirname, 'check-next-gates.ts');
const SPAWN_TIMEOUT_MS = 60_000;
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

const tmpDirs: string[] = [];

function runGit(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-next-gates-'));
  tmpDirs.push(dir);
  runGit(dir, 'init', '-q');
  runGit(dir, 'config', 'user.email', 'next-gates-test@example.com');
  runGit(dir, 'config', 'user.name', 'next-gates-test');
  runGit(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

function write(root: string, relPath: string, content: string): void {
  const p = join(root, relPath);
  mkdirSync(resolve(p, '..'), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

function commitAll(root: string, message: string): string {
  runGit(root, 'add', '-A');
  runGit(root, 'commit', '-q', '-m', message);
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return r.stdout.trim();
}

function writeDecisionMap(root: string, adrIds: string[]): void {
  const body = adrIds.map((id) => `## ADR-${id} · 測試用決策\n\n- **Decision**: 測試\n`).join('\n');
  write(root, 'docs/02-decision-map.md', `# 決策地圖\n\n${body}`);
}

function writeContracts(root: string, sections: string[]): void {
  const body = sections.map((s) => `## ${s}. 測試章節\n\n內容。\n`).join('\n');
  write(root, 'contracts/types.md', `# 契約\n\n${body}`);
}

function writeRoadmap(root: string, integrationIds: number[]): void {
  const body = integrationIds.map((n) => `## I${n} · 測試整合點\n\n內容。\n`).join('\n');
  write(root, 'docs/01-roadmap.md', `# Roadmap\n\n${body}`);
}

function writeFeature(root: string, folder: string, phases: { n: number; status: string }[]): void {
  const rows = phases.map((p) => `| ${p.n} | 標題 | Wave 0 | ${p.status} |  |`).join('\n');
  write(
    root,
    `features/${folder}/FEATURE.md`,
    `# ${folder}\n\n## Phase\n\n| Phase | 標題 | 階段 | 狀態 | 完成日 |\n|---|---|---|---|---|\n${rows}\n`,
  );
}

function writeNext(root: string, folder: string, body: string): void {
  write(root, `features/${folder}/NEXT.md`, `# ${folder} — 下一步\n\n${body}\n`);
}

function run(root: string, ...extra: string[]): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', CHECK_NEXT_GATES_TS, '--root', root, ...extra], {
    cwd: root,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, GATES_CONFIG_DIR: join(root, 'scripts') },
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('check-next-gates:0 份 NEXT.md 一律 FAIL', () => {
  it('features/ 底下沒有任何 NEXT.md → exit 1', () => {
    const root = makeRepo();
    write(root, 'features/.gitkeep', '');
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).toContain('gate=next-gates result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-next-gates:引用解析(各種形狀)', () => {
  it('ADR 引用存在 → PASS', () => {
    const root = makeRepo();
    writeDecisionMap(root, ['037']);
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(root, '01-foo', '## Gate\n\n**phase-2** 需要:ADR-037 解除\n');
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).toContain('✓ 全部 gate 宣告都有能解析的引用');
    expect(output).toContain('gate=next-gates result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('ADR 引用不存在 → FAIL,訊息說「引用不存在」', () => {
    const root = makeRepo();
    writeDecisionMap(root, ['037']);
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(root, '01-foo', '## Gate\n\n**phase-2** 需要:ADR-999 解除\n');
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('引用不存在(ADR-999)');
    expect(output).toContain('gate=next-gates result=FAIL scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('完全沒有引用 → FAIL,訊息說「沒有引用」', () => {
    const root = makeRepo();
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(root, '01-foo', '## Gate\n\n**phase-2** 需要:等主管口頭同意\n');
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('gate 沒有引用 ADR/commit/§/IN/phase');
  }, SPAWN_TIMEOUT_MS);

  it('契約章節 §N 存在 / 不存在', () => {
    const root = makeRepo();
    writeContracts(root, ['7', '11b']);
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(
      root,
      '01-foo',
      '## Gate\n\n**phase-2** 需要:見契約 §7\n\n**phase-3** 需要:見契約 §99\n',
    );
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(1); // phase-3 那條的 §99 不存在
    expect(output).toContain('gate=next-gates result=FAIL scanned=1');
    expect(output).toContain('引用不存在(§99)');
  }, SPAWN_TIMEOUT_MS);

  it('契約章節帶字母後綴(§11b)也能解析', () => {
    const root = makeRepo();
    writeContracts(root, ['11b']);
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(root, '01-foo', '## Gate\n\n**phase-2** 需要:見契約 §11b\n');
    commitAll(root, 'init');

    const { code } = run(root);

    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('整合點 I<N>:roadmap 標題與 docs/integration 檔名前綴都算數', () => {
    const root = makeRepo();
    writeRoadmap(root, [1]);
    write(root, 'docs/integration/i2-something.feature', 'Feature: x\n');
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(
      root,
      '01-foo',
      '## Gate\n\n**phase-2** 需要:**I1 通過**\n\n**phase-3** 需要:**I2 通過**\n\n**phase-4** 需要:**I9 通過**\n',
    );
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(1); // 只有 I9 那條找不到
    expect(output).toContain('引用不存在(I9)');
  }, SPAWN_TIMEOUT_MS);

  it('phase 參照三種寫法都算數:完整資料夾名 / 兩位數字 / 自身裸寫', () => {
    const root = makeRepo();
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }, { n: 2, status: 'todo' }]);
    writeFeature(root, '02-bar', [{ n: 3, status: 'done' }]);
    writeNext(
      root,
      '01-foo',
      [
        '## Gate',
        '',
        '**phase-2** 需要:',
        '- [ ] 自身:phase-1 `done`',
        '- [ ] 跨資料夾:02 phase-3 `done`',
        '- [ ] 完整寫法:02-bar/phase-3 `done`',
      ].join('\n'),
    );
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).toContain('gate=next-gates result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('phase 參照解析失敗(資料夾存在,但沒有那個 phase 列)→ FAIL', () => {
    const root = makeRepo();
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(root, '01-foo', '## Gate\n\n**phase-2** 需要:phase-9 `done`\n');
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('引用不存在');
    expect(output).toContain('phase-9');
  }, SPAWN_TIMEOUT_MS);

  it('commit sha 引用:真的存在的 commit 算數,亂寫的不算', () => {
    const root = makeRepo();
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    const sha = commitAll(root, 'init(還沒有 NEXT.md,先建一個基準 commit)');
    writeNext(
      root,
      '01-foo',
      [
        '## Gate',
        '',
        `**phase-2** 需要:見 commit ${sha.slice(0, 10)}`,
        '',
        '**phase-3** 需要:見 commit deadbeef00',
      ].join('\n'),
    );
    commitAll(root, 'add NEXT.md');

    const { code, output } = run(root);

    expect(code).toBe(1); // phase-3 那條的 deadbeef00 不是真的 commit
    expect(output).toContain('引用不存在(deadbeef00)');
  }, SPAWN_TIMEOUT_MS);

  it('已打勾(已解除/已滿足)的 gate 一樣要掃、一樣要有能解析的引用', () => {
    const root = makeRepo();
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(
      root,
      '01-foo',
      ['## Gate', '', '**phase-2** 需要:', '- [x] 契約:**已解除**(反正就是解除了)'].join('\n'),
    );
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('gate 沒有引用');
  }, SPAWN_TIMEOUT_MS);

  it('「無 gate」的 phase 不產生 gate 宣告,不算錯誤', () => {
    const root = makeRepo();
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(root, '01-foo', '## Gate\n\n**phase-1**:無 gate。純函式。\n');
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).toContain('掃到 0 條 gate 宣告');
    expect(output).toContain('gate=next-gates result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-next-gates:nextGates.mode', () => {
  it('report 模式:有失敗一樣印出來、marker 一樣 FAIL,但 exit 0', () => {
    const root = makeRepo();
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'gates.config.json'), JSON.stringify({ nextGates: { mode: 'report' } }), 'utf8');
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(root, '01-foo', '## Gate\n\n**phase-2** 需要:等主管口頭同意\n');
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).toContain('gate=next-gates result=FAIL scanned=1');
    expect(output).toContain('report');
  }, SPAWN_TIMEOUT_MS);

  it('預設(沒有 gates.config.json,或沒填 nextGates.mode)是 enforce:同樣的失敗要 exit 1', () => {
    const root = makeRepo();
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(root, '01-foo', '## Gate\n\n**phase-2** 需要:等主管口頭同意\n');
    commitAll(root, 'init');

    const { code } = run(root);

    expect(code).toBe(1);
  }, SPAWN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// S9:設定檔壞掉要大聲失敗(不是未捕捉的堆疊,也不是悄悄套用預設值)。
// ---------------------------------------------------------------------------

describe('check-next-gates:S9 設定檔壞掉', () => {
  it('gates.config.json 是壞掉的 JSON → 印「設定檔壞掉」+ 標記,不是未捕捉的堆疊', () => {
    const root = makeRepo();
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'gates.config.json'), '{ broken json', 'utf8');
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(root, '01-foo', '## Gate\n\n**phase-2** 需要:phase-1\n');
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔壞掉:');
    expect(output).toContain('gate=next-gates result=FAIL scanned=0');
    expect(output).not.toContain('at JSON.parse');
    expect(output).not.toContain('SyntaxError');
  }, SPAWN_TIMEOUT_MS);

  it('gates.config.json 有不認識的頂層鍵(打錯字)→ 印「設定檔有不認識的鍵」', () => {
    const root = makeRepo();
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'gates.config.json'), JSON.stringify({ nextGatess: { mode: 'report' } }), 'utf8');
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(root, '01-foo', '## Gate\n\n**phase-2** 需要:phase-1\n');
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔有不認識的鍵:nextGatess');
    expect(output).toContain('gate=next-gates result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('合法設定不受影響(nextGates.mode 照常生效)', () => {
    const root = makeRepo();
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'gates.config.json'), JSON.stringify({ nextGates: { mode: 'report' } }), 'utf8');
    writeFeature(root, '01-foo', [{ n: 1, status: 'done' }]);
    writeNext(root, '01-foo', '## Gate\n\n**phase-2** 需要:等主管口頭同意\n');
    commitAll(root, 'init');

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).toContain('gate=next-gates result=FAIL scanned=1');
  }, SPAWN_TIMEOUT_MS);
});
