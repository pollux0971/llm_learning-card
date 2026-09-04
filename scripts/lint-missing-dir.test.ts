/**
 * scripts/lint.ts:`--dir` 指到不存在的目錄。
 *
 * 現況(實測):
 *
 *     $ npx tsx scripts/lint.ts --dir /tmp/does-not-exist-xyz
 *     # Lint report — ...
 *     0 problems found.
 *     report written to /tmp/does-not-exist-xyz/state/lint-report-2026-09-04.md
 *     >>> exit=0
 *
 * 它把目錄**建出來**,然後說「0 problems found」。也就是說「路徑打錯一個字」被變成
 * 「一個空 vault,而且很乾淨」——使用者看到綠燈,實際上根本沒有健檢到自己的資料,
 * 而且硬碟上多了一個假的 learning 目錄。
 *
 * 要的行為:**一律 exit 1**,說「目錄不存在,用 `cli.ts init` 建」,而且**不建目錄**。
 * 建目錄是 `init` 的事,`lint` 只看不動(這也是 lint.ts 檔頭原本就寫的承諾:
 * 「不改 cards / questions / graph / state/reviews.json 等既有檔案——lint 只看不動」,
 * 建一個新目錄樹顯然違反那句話)。
 *
 * ── 這個檔案為什麼叫 lint-missing-dir.test.ts ──
 * `scripts/lint.ts` 的**其他**部分同時在另一個 worktree 改(空 vault 與健康 vault 的
 * 輸出要分得開)。取一個只蓋這條路徑的檔名,兩邊就不會在同一個檔案上撞在一起;
 * 下面也刻意**不斷言 lint 成功時的輸出長什麼樣**,那半邊歸另一個 worktree。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-lint-missing-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function runLint(dir: string): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', 'scripts/lint.ts', '--dir', dir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('scripts/lint.ts --dir 指到不存在的目錄', () => {
  it('退出碼 1,不是 0', () => {
    const missing = join(tmpDir(), 'nope');
    expect(runLint(missing).code).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it('不建目錄 —— 建目錄是 init 的事,lint 只看不動', () => {
    const missing = join(tmpDir(), 'nope');
    runLint(missing);

    expect(existsSync(missing), `lint 把 ${missing} 建出來了`).toBe(false);
  }, SPAWN_TIMEOUT_MS);

  it('也不留下報告檔(不建目錄就不該有 state/lint-report-*.md)', () => {
    const missing = join(tmpDir(), 'nope');
    runLint(missing);

    expect(existsSync(join(missing, 'state'))).toBe(false);
  }, SPAWN_TIMEOUT_MS);

  it('訊息說「目錄不存在」,並指出用 init 建,而且點得出是哪個路徑', () => {
    const missing = join(tmpDir(), 'nope');
    const { output } = runLint(missing);

    expect(output).toContain('目錄不存在');
    expect(output).toContain(missing);
    expect(output).toContain('init');
  }, SPAWN_TIMEOUT_MS);

  it('絕不說「乾淨」——0 problems 是一句只有健檢真的跑過才配印的話', () => {
    const { output } = runLint(join(tmpDir(), 'nope'));

    expect(output).not.toMatch(/0 problems|沒有問題/);
  }, SPAWN_TIMEOUT_MS);

  it('路徑存在但是一個檔案、不是目錄 → 一樣 exit 1,不會當成空 vault', () => {
    const file = join(tmpDir(), 'learning.md');
    writeFileSync(file, '這是一個檔案,不是 learning 目錄\n', 'utf8');

    const { code, output } = runLint(file);
    expect(code).toBe(1);
    expect(output).not.toMatch(/0 problems|沒有問題/);
  }, SPAWN_TIMEOUT_MS);

  it('沒給 --dir 仍然是 exit 2(用法錯誤,跟「目錄不存在」分得開)', () => {
    // 回歸鎖:現在就是這個行為,改「目錄不存在」那條路徑時不要順手動到它。
    const r = spawnSync('npx', ['tsx', 'scripts/lint.ts'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
    });
    expect(r.status).toBe(2);
  }, SPAWN_TIMEOUT_MS);
});
