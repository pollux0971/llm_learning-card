/**
 * scripts/check-standalone.ts 的「掃描器壞了」測試(P-28 commit 1)。
 *
 * 跟 check-boundaries 同一個形狀:manifest 讀到 **0 個條目** 時,
 * 「全部通過」的退出碼 0 是騙人的——沒有東西通過,是根本沒讀到東西。
 * 所以 0 個條目一律 FAIL,訊息要直接說是掃描器壞了。
 *
 * 測法:一樣不能讓掃描器測自己。真的 standalone.json 永遠有十幾個條目,
 * 那個 0 的分支跑不到;而且真的跑那些指令要好幾分鐘。所以這裡:
 *   1. 用臨時 manifest 檔當 fixture,要求 CLI 多一個 `--manifest <path>`
 *   2. 一律加 `--list`,只列出不執行,測試才不會真的去跑 npx tsx 那一堆指令
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

/** 三支掃描器共用的那句話。 */
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

const tmpDirs: string[] = [];

function fixtureManifest(manifest: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-standalone-'));
  tmpDirs.push(dir);
  const p = join(dir, 'standalone.json');
  writeFileSync(p, JSON.stringify(manifest, null, 2), 'utf8');
  return p;
}

function runStandalone(manifestPath: string, ...extra: string[]): { code: number; output: string } {
  const r = spawnSync(
    'npx',
    ['tsx', 'scripts/check-standalone.ts', '--manifest', manifestPath, '--list', ...extra],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 },
  );
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('check-standalone 讀到 0 個條目', () => {
  it('空的 manifest {}:退出碼 1,不是 0', () => {
    const { code } = runStandalone(fixtureManifest({}));

    expect(code).toBe(1);
  });

  it('訊息要明講「掃描器壞了」,而不是印「全部通過」', () => {
    const { output } = runStandalone(fixtureManifest({}));

    expect(output).toContain('讀到 0 個條目');
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).not.toContain('全部通過');
  });
});

describe('check-standalone 正常輸入(回歸:0 的規則不能誤殺正常的 manifest)', () => {
  const OK_MANIFEST = {
    'demo-a': { cmd: 'node -e "console.log(\'OK\')"', interactive: false, expect: 'OK' },
    'demo-b': { cmd: 'node -e "console.log(\'OK\')"', interactive: false, expect: 'OK' },
  };

  it('有條目時退出碼 0,且印出來的條目數 > 0', () => {
    const { code, output } = runStandalone(fixtureManifest(OK_MANIFEST));

    expect(code).toBe(0);
    const m = /(\d+) 個條目/.exec(output);
    expect(m, `輸出裡沒有「N 個條目」:\n${output}`).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![1])).toBe(2);
    expect(output).toContain('demo-a');
    expect(output).toContain('demo-b');
  });

  it('全部條目都是 interactive 也算有讀到東西,不當成掃描器壞了', () => {
    const { code, output } = runStandalone(
      fixtureManifest({ 'demo-dev': { cmd: 'npm run dev', interactive: true } }),
    );

    expect(code).toBe(0);
    expect(output).not.toContain(SCANNER_BROKEN);
  });

  it('--only 指到不存在的名字:照舊 FAIL,但那是「找不到這個名字」不是「掃描器壞了」', () => {
    const { code, output } = runStandalone(fixtureManifest(OK_MANIFEST), '--only', 'no-such-name');

    expect(code).toBe(1);
    expect(output).toContain('no-such-name');
    expect(output).not.toContain(SCANNER_BROKEN);
  });
});
