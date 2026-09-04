/**
 * scripts/check-boundaries.ts 的「掃描器壞了」測試(P-28 commit 1)。
 *
 * 守的是一件事:**空的掃描器跟全綠的退出碼長得一模一樣**。
 * 掃到 0 個檔案 → exit 0 → 看起來像「這個 repo 很乾淨」,其實是掃描器的
 * 落點表、walk()、或副檔名清單壞掉了,一個檔案都沒進來。所以「掃到 0 個」
 * 一律當成 FAIL,而且訊息要直接講出這件事,不能只印一個乾巴巴的錯誤碼。
 *
 * 測法:掃描器**不能測自己**——如果直接跑 `npm run boundaries`,它掃的是這個
 * repo,永遠掃得到上百個檔案,那個 0 的分支一輩子跑不到。所以這裡用臨時目錄
 * 當 fixture root,餵已知內容進去,只斷言退出碼與輸出。
 *
 * 這要求 CLI 多一個 `--root <dir>`:把掃描的根目錄指到別處(預設仍是 repo 根)。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

/** 三支掃描器共用的那句話。看到它就知道方向是「掃描器壞了」,不是「程式碼很乾淨」。 */
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

/**
 * spawnSync 起一個 `npx tsx` 子行程要一到三秒,機器忙的時候更久。
 * vitest 預設的 5 秒 test timeout 會讓這些測試在負載高時假性變紅
 * (掃描器的測試變成 flaky,比沒有測試更糟),所以每個開子行程的測試都放寬。
 */
const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];

function fixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'lc-boundaries-'));
  tmpDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return root;
}

/** 不帶 --root,掃這個 repo 本身(P-28 之前的既有行為)。 */
function runDefaultRoot(...extra: string[]): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', 'scripts/check-boundaries.ts', ...extra], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function runBoundaries(root: string): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', 'scripts/check-boundaries.ts', '--root', root], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('check-boundaries 掃到 0 個檔案', () => {
  it('完全空的 root:退出碼 1,不是 0', () => {
    const root = fixtureRoot({ 'README.md': '空的 repo,一個原始檔都沒有\n' });

    const { code } = runBoundaries(root);

    expect(code).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it('訊息要明講「掃描器壞了」,而不是印「✓ 無違規」', () => {
    const root = fixtureRoot({ 'README.md': '空的 repo\n' });

    const { output } = runBoundaries(root);

    expect(output).toContain('掃描到 0 個檔案');
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).not.toContain('✓ 無違規');
  }, SPAWN_TIMEOUT_MS);

  it('有 packages/ 目錄但裡面沒有任何原始檔,一樣算 0', () => {
    const root = fixtureRoot({
      'packages/core/src/schema/notes.txt': '不是 .ts,不會被掃到\n',
      'apps/desktop/README.md': '也不是原始檔\n',
    });

    const { code, output } = runBoundaries(root);

    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
  }, SPAWN_TIMEOUT_MS);
});

describe('check-boundaries 正常輸入(回歸:0 的規則不能誤殺正常的掃描)', () => {
  it('掃得到檔案又沒有違規:退出碼 0,且印出來的檔案數 > 0', () => {
    const root = fixtureRoot({
      'packages/core/src/schema/a.ts': "import { b } from './b.js';\nexport const a = b;\n",
      'packages/core/src/schema/b.ts': "export const b = 1;\n",
    });

    const { code, output } = runBoundaries(root);

    expect(code).toBe(0);
    const m = /掃描 (\d+) 個檔案/.exec(output);
    expect(m, `輸出裡沒有「掃描 N 個檔案」:\n${output}`).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![1])).toBe(2);
    expect(output).toContain('✓ 無違規');
  }, SPAWN_TIMEOUT_MS);

  it('掃得到檔案但有跨資料夾 import:還是照舊報違規,退出碼 1', () => {
    const root = fixtureRoot({
      'packages/core/src/schema/a.ts': "import { s } from '../scheduler/s.js';\nexport const a = s;\n",
      'packages/core/src/scheduler/s.ts': 'export const s = 1;\n',
    });

    const { code, output } = runBoundaries(root);

    expect(code).toBe(1);
    expect(output).toContain('違規 import');
    // 這條紅是真的違規,不是「掃描器壞了」——兩種 FAIL 的訊息不可以混在一起。
    expect(output).not.toContain(SCANNER_BROKEN);
  }, SPAWN_TIMEOUT_MS);
});

// ── P-29 審核輪補的:上面那三條只驗到 found=0 的情況,found>0 但 scanned=0 沒人守 ──

describe('check-boundaries 掃得到檔案但一個都沒真的檢查', () => {
  it('全部都是膠水落點(scanned=0):不可以印「✓ 無違規」', () => {
    // 這是最陰險的瞎法:落點表把所有東西標成 infra/steps,walk 找得到檔案,
    // 但沒有一個檔案的 import 被看過。found===0 的條件擋不到,要靠 scanned===0。
    const root = fixtureRoot({
      'scripts/snapshot.ts': "import { x } from 'anywhere';\nexport const s = x;\n",
      'scripts/check-boundaries.ts': 'export const b = 1;\n',
    });

    const { code, output } = runBoundaries(root);

    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).not.toContain('✓ 無違規');
    // 兩個數字要分開講:walk 找得到,只是一個都沒檢查
    expect(output).toMatch(/walk 找到 [1-9]\d* 個原始檔,實際檢查 0 個/);
  }, SPAWN_TIMEOUT_MS);

  it('掃得到檔案但沒有落點(unmapped):照舊報 unmapped,而且也要說掃描器可能壞了', () => {
    const root = fixtureRoot({
      'packages/nowhere/a.ts': 'export const a = 1;\n',
    });

    const { code, output } = runBoundaries(root);

    expect(code).toBe(1);
    expect(output).toContain('不在任何功能的落點內');
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).not.toContain('✓ 無違規');
  }, SPAWN_TIMEOUT_MS);

  it('--root 指到不存在的目錄:0 個檔案 → FAIL,不是當機也不是綠燈', () => {
    const { code, output } = runBoundaries(join(tmpdir(), 'lc-boundaries-absolutely-no-such-dir'));

    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
  }, SPAWN_TIMEOUT_MS);
});

describe('check-boundaries 不帶 --root 的既有行為(--root 是 P-28 新加的,不能改掉預設)', () => {
  it('預設掃這個 repo:掃到的檔案數 > 0、無違規、退出碼 0', () => {
    const { code, output } = runDefaultRoot();

    const m = /掃描 (-?\d+) 個檔案/.exec(output);
    expect(m, `輸出裡沒有「掃描 N 個檔案」:\n${output}`).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(output).toContain('✓ 無違規');
    expect(output).not.toContain(SCANNER_BROKEN);
    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('--verbose 會多印每個檔案的歸屬,不帶就不印', () => {
    const verbose = runDefaultRoot('--verbose');
    const quiet = runDefaultRoot();

    expect(verbose.code).toBe(0);
    // 每一行長成 `  <相對路徑>  →  <擁有者>`
    expect(verbose.output).toMatch(/\n {2}scripts\/check-boundaries\.ts {2}→ {2}infra\n/);
    expect(quiet.output).not.toContain('→  infra');
    expect(verbose.output.split('\n').length).toBeGreaterThan(quiet.output.split('\n').length);
  }, SPAWN_TIMEOUT_MS);
});
