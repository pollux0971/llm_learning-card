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
  });

  it('訊息要明講「掃描器壞了」,而不是印「✓ 無違規」', () => {
    const root = fixtureRoot({ 'README.md': '空的 repo\n' });

    const { output } = runBoundaries(root);

    expect(output).toContain('掃描到 0 個檔案');
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).not.toContain('✓ 無違規');
  });

  it('有 packages/ 目錄但裡面沒有任何原始檔,一樣算 0', () => {
    const root = fixtureRoot({
      'packages/core/src/schema/notes.txt': '不是 .ts,不會被掃到\n',
      'apps/desktop/README.md': '也不是原始檔\n',
    });

    const { code, output } = runBoundaries(root);

    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
  });
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
  });

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
  });
});
