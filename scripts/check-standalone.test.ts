// SOURCE: template v1.4.3 (629b609) sha256=8676fa2c41a3ae9e6dd4840cafba2ee3ee03f67d0fb2e495a4afdcc38f5bed26 — 勿手改;升版用 sync-gates.sh
/**
 * scripts/check-standalone.ts 的單元測試(模板 1.4.0 S3:pending 語意 + `_doc` metadata)。
 *
 * 跟其餘掃描器的測試同一個形狀:造一次性的暫存目錄當假 consumer 根,`--root` +
 * `--manifest` 明講,不碰真的 repo。pending 測試需要真的執行指令(不能只用 `--list`,
 * 因為 pending 的「done 與否決定要不要讓 gate 變紅」邏輯只在真跑那條分支才會走到),
 * 所以指令一律用 `node -e "process.exit(N)"` 這種零副作用的東西。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHECK_STANDALONE_TS = resolve(import.meta.dirname, 'check-standalone.ts');
const SPAWN_TIMEOUT_MS = 60_000;
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

const tmpDirs: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-standalone-'));
  tmpDirs.push(dir);
  return dir;
}

function writeFeaturePhase(root: string, folder: string, phaseNum: number, status: string): void {
  const dir = join(root, 'features', folder);
  mkdirSync(dir, { recursive: true });
  const content = [
    `# ${folder}`,
    '',
    '## Phase',
    '',
    '| Phase | 標題 | 階段 | 狀態 | 完成日 |',
    '|---|---|---|---|---|',
    `| ${phaseNum} | 標題 | Wave 0 | ${status} |  |`,
    '',
  ].join('\n');
  writeFileSync(join(dir, 'FEATURE.md'), content, 'utf8');
}

function writeManifest(root: string, manifest: unknown): string {
  const p = join(root, 'standalone.json');
  writeFileSync(p, JSON.stringify(manifest, null, 2), 'utf8');
  return p;
}

function run(root: string, manifestPath: string, ...extra: string[]): { code: number; output: string } {
  const r = spawnSync(
    'npx',
    ['tsx', CHECK_STANDALONE_TS, '--root', root, '--manifest', manifestPath, ...extra],
    { cwd: root, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS },
  );
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const PASS_CMD = 'node -e "process.exit(0)"';
const failCmd = (n: number) => `node -e "process.exit(${n})"`;

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('check-standalone:既有行為(回歸)', () => {
  it('0 個條目一律 FAIL,訊息明講掃描器壞了', () => {
    const root = makeRoot();
    const manifest = writeManifest(root, {});

    const { code, output } = run(root, manifest);

    expect(code).toBe(1);
    expect(output).toContain('讀到 0 個條目');
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).toContain('gate=standalone result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('正常條目全過 → exit 0', () => {
    const root = makeRoot();
    const manifest = writeManifest(root, { ok: { cmd: PASS_CMD, interactive: false } });

    const { code, output } = run(root, manifest);

    expect(code).toBe(0);
    expect(output).toContain('✓  ok');
    expect(output).toContain('gate=standalone result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('正常條目失敗 → exit 1', () => {
    const root = makeRoot();
    const manifest = writeManifest(root, { bad: { cmd: failCmd(2), interactive: false } });

    const { code, output } = run(root, manifest);

    expect(code).toBe(1);
    expect(output).toContain('✗  bad');
    expect(output).toContain('gate=standalone result=FAIL scanned=1');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-standalone:`_doc` metadata 慣例(消費者回報事故 AI_KM d3e0b80)', () => {
  it('`_doc` 排在第一個鍵、後面接一個真條目 → 不崩潰,scanned=1,不計入 metadata', () => {
    const root = makeRoot();
    const manifest = writeManifest(root, {
      _doc: '這份 manifest 給 /phase-done 用',
      real: { cmd: PASS_CMD, interactive: false },
    });

    const { code, output } = run(root, manifest);

    expect(code).toBe(0);
    expect(output).toContain('gate=standalone result=PASS scanned=1');
    expect(output).toContain('略過 1 個 metadata 欄位:_doc');
    expect(output).not.toContain('TypeError');
    expect(output).not.toContain('ERR_INVALID_ARG_TYPE');
  }, SPAWN_TIMEOUT_MS);

  it('非底線開頭的鍵、值不是物件 → FAIL,印「不是條目物件」,不當 metadata 放過', () => {
    const root = makeRoot();
    const manifest = writeManifest(root, {
      typo: 'this should have been an object',
      ok: { cmd: PASS_CMD, interactive: false },
    });

    const { code, output } = run(root, manifest);

    expect(code).toBe(1);
    expect(output).toContain('✗ typo 不是條目物件');
    expect(output).toContain('gate=standalone result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-standalone:pending 語意(來源 nightmare-assault)', () => {
  it('pending 的 phase 已 done、指令本來就通過 → 視為一般項目,PASS', () => {
    const root = makeRoot();
    writeFeaturePhase(root, '01-foo', 1, 'done');
    const manifest = writeManifest(root, {
      entry: { cmd: PASS_CMD, interactive: false, pending: '01-foo/phase-1' },
    });

    const { code, output } = run(root, manifest);

    expect(code).toBe(0);
    expect(output).toContain('✓  entry');
    expect(output).toContain('已 done,視為一般項目');
    expect(output).toContain('gate=standalone result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('pending 的 phase 已 done、但指令仍然紅 → pending 已過期,FAIL', () => {
    const root = makeRoot();
    writeFeaturePhase(root, '01-foo', 1, 'done');
    const manifest = writeManifest(root, {
      entry: { cmd: failCmd(1), interactive: false, pending: '01-foo/phase-1' },
    });

    const { code, output } = run(root, manifest);

    expect(code).toBe(1);
    expect(output).toContain('pending 已過期(01-foo/phase-1 已 done)仍然紅');
    expect(output).toContain('gate=standalone result=FAIL scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('pending 的 phase 還沒 done、指令是紅的 → 不擋 gate,回報實際 exit code', () => {
    const root = makeRoot();
    writeFeaturePhase(root, '02-bar', 3, 'in-progress');
    const manifest = writeManifest(root, {
      entry: { cmd: failCmd(7), interactive: false, pending: '02-bar/phase-3' },
    });

    const { code, output } = run(root, manifest);

    expect(code).toBe(0);
    expect(output).toContain('○  entry  pending(等 02-bar/phase-3)實際 exit=7');
    expect(output).toContain('gate=standalone result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('pending 參照的資料夾不存在 → FAIL(壞的參照,不是「還沒 done」)', () => {
    const root = makeRoot();
    const manifest = writeManifest(root, {
      entry: { cmd: PASS_CMD, interactive: false, pending: '99-does-not-exist/phase-1' },
    });

    const { code, output } = run(root, manifest);

    expect(code).toBe(1);
    expect(output).toContain('pending 參照無效(99-does-not-exist/phase-1)');
    expect(output).toContain('gate=standalone result=FAIL scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('pending 參照的資料夾存在,但 FEATURE.md 沒有那個 phase 列 → FAIL', () => {
    const root = makeRoot();
    writeFeaturePhase(root, '01-foo', 1, 'done');
    const manifest = writeManifest(root, {
      entry: { cmd: PASS_CMD, interactive: false, pending: '01-foo/phase-9' },
    });

    const { code, output } = run(root, manifest);

    expect(code).toBe(1);
    expect(output).toContain('pending 參照無效(01-foo/phase-9)');
    expect(output).toContain('沒有 phase-9 的表格列');
  }, SPAWN_TIMEOUT_MS);

  it('scanned 計數包含 pending 條目(即使它不擋 gate)', () => {
    const root = makeRoot();
    writeFeaturePhase(root, '02-bar', 3, 'todo');
    const manifest = writeManifest(root, {
      normal: { cmd: PASS_CMD, interactive: false },
      pendingOne: { cmd: failCmd(1), interactive: false, pending: '02-bar/phase-3' },
    });

    const { code, output } = run(root, manifest);

    expect(code).toBe(0);
    expect(output).toContain('gate=standalone result=PASS scanned=2');
  }, SPAWN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// S9:設定檔(manifest)壞掉要大聲失敗,不是未捕捉的堆疊。
// ---------------------------------------------------------------------------

describe('check-standalone:S9 manifest 壞掉', () => {
  it('standalone.json 是壞掉的 JSON → 印「設定檔壞掉」+ 標記,不是未捕捉的堆疊', () => {
    const root = makeRoot();
    const manifestPath = join(root, 'standalone.json');
    writeFileSync(manifestPath, '{ not valid json', 'utf8');

    const { code, output } = run(root, manifestPath);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔壞掉:');
    expect(output).toContain('gate=standalone result=FAIL scanned=0');
    expect(output).not.toContain('at JSON.parse');
    expect(output).not.toContain('SyntaxError');
  }, SPAWN_TIMEOUT_MS);

  it('standalone.json 根本不存在 → 一樣大聲失敗(不是未捕捉的 ENOENT)', () => {
    const root = makeRoot();
    const manifestPath = join(root, 'standalone.json'); // 沒有 writeFileSync

    const { code, output } = run(root, manifestPath);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔壞掉:');
    expect(output).toContain('gate=standalone result=FAIL scanned=0');
    expect(output).not.toContain('node:internal');
    expect(output).not.toContain('at Object.readFileSync');
  }, SPAWN_TIMEOUT_MS);

  it('合法 manifest 不受影響(行為不變)', () => {
    const root = makeRoot();
    const manifest = writeManifest(root, { a: { cmd: PASS_CMD, interactive: false } });

    const { code, output } = run(root, manifest);

    expect(code).toBe(0);
    expect(output).toContain('gate=standalone result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);
});
