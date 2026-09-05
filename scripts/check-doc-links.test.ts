// SOURCE: template v1.4.2 (1c1d403) sha256=696be5cd7b939949d01054601f9bba1ea0c50d85a78681123b0151368829b68f — 勿手改;升版用 sync-gates.sh
/**
 * scripts/check-doc-links.ts 的單元測試(模板 1.4.0 S7:backtick 路徑參照 + S9 設定壞掉)。
 *
 * `main()` 是純函式(回傳 `{ code, output }`,不自己 `process.exit`),多數案例不用起
 * 子行程就能測——跟其餘掃描器的測試(spawn `npx tsx`)比起來快很多,這支腳本原本就
 * 沒有專屬測試檔,這次順便補上。S9 的設定壞掉案例例外:設定壞掉時腳本走 `_root.ts`
 * 的 `failConfig`(`never` 型別,直接 `process.exit`),那條路徑必須起子行程才能觀察
 * 到退出碼與輸出,不能 in-process 呼叫(會直接讓測試行程跟著死掉)。
 *
 * 造一次性的臨時目錄當假 consumer 根,`GATES_CONFIG_DIR` 指到 `<fixture>/scripts`
 * (理由跟其餘掃描器的測試檔頭一樣:找設定檔的順位 1 是「腳本自己所在的目錄」,
 * 不設 env 會讀到模板自己的 scripts/)。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { main } from './check-doc-links.js';

const CHECK_DOC_LINKS_TS = resolve(import.meta.dirname, 'check-doc-links.ts');
const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];
let originalEnv: string | undefined;

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-doc-links-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  return dir;
}

function write(root: string, relPath: string, content: string): void {
  const p = join(root, relPath);
  mkdirSync(resolve(p, '..'), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

function run(root: string, argv: string[] = []): { code: number; output: string } {
  return main(['--root', root, ...argv]);
}

function runSpawned(root: string): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', CHECK_DOC_LINKS_TS, '--root', root], {
    cwd: root,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, GATES_CONFIG_DIR: join(root, 'scripts') },
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

beforeEach(() => {
  originalEnv = process.env.GATES_CONFIG_DIR;
});

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env.GATES_CONFIG_DIR;
  else process.env.GATES_CONFIG_DIR = originalEnv;
});

describe('check-doc-links:S7 backtick 路徑參照', () => {
  it('`path/to/file.ts:123` 形式:路徑存在 → 不報,路徑不存在 → 報壞掉的連結', () => {
    const root = makeRoot();
    process.env.GATES_CONFIG_DIR = join(root, 'scripts');
    write(root, 'README.md', '# root\n');
    write(
      root,
      'docs/x.md',
      ['見 `../README.md:1` 有說明。', '這個不存在:`docs/missing-file.md:42`。'].join('\n'),
    );

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('docs/x.md:2');
    expect(output).toContain('`docs/missing-file.md:42`');
    expect(output).not.toContain('README.md:1  →');
  });

  it('非路徑的 word:digits(port:3000)、word:word(key:value)不誤判', () => {
    const root = makeRoot();
    process.env.GATES_CONFIG_DIR = join(root, 'scripts');
    write(root, 'README.md', '# root\n');
    write(
      root,
      'docs/x.md',
      ['見 `../README.md:1`。', '設定 `port:3000`,不是路徑。', '也不是路徑:`key:value`。'].join('\n'),
    );

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).not.toContain('port:3000');
    expect(output).not.toContain('key:value');
  });

  it('fenced code block 裡的 backtick 路徑不算(規則 6 只看 inline code)', () => {
    const root = makeRoot();
    process.env.GATES_CONFIG_DIR = join(root, 'scripts');
    write(root, 'README.md', '# root\n');
    write(
      root,
      'docs/x.md',
      ['見 `../README.md:1`。', '```', '這裡面提到 `docs/missing-inside-fence.md:9` 也不該被抓。', '```'].join('\n'),
    );

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).not.toContain('missing-inside-fence');
  });
});

// ---------------------------------------------------------------------------
// S9:設定檔壞掉要大聲失敗(不是悄悄套用預設值)。
// ---------------------------------------------------------------------------

describe('check-doc-links:S9 設定檔壞掉', () => {
  it('gates.config.json 是壞掉的 JSON → 印「設定檔壞掉」+ 標記,不是悄悄用內建預設也不是未捕捉的堆疊', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'scripts', 'gates.config.json'), '{ broken', 'utf8');
    write(root, 'README.md', '# root\n');
    write(root, 'docs/x.md', '見 `../README.md:1`。\n');

    const { code, output } = runSpawned(root);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔壞掉:');
    expect(output).toContain('gate=doc-links result=FAIL scanned=0');
    expect(output).not.toContain('at JSON.parse');
  }, SPAWN_TIMEOUT_MS);

  it('gates.config.json 有不認識的頂層鍵(打錯字)→ 印「設定檔有不認識的鍵」', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'scripts', 'gates.config.json'), JSON.stringify({ docLinkz: {} }), 'utf8');
    write(root, 'README.md', '# root\n');
    write(root, 'docs/x.md', '見 `../README.md:1`。\n');

    const { code, output } = runSpawned(root);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔有不認識的鍵:docLinkz');
    expect(output).toContain('gate=doc-links result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('合法設定不受影響(docLinks.skipSegments 照常追加)', () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'scripts', 'gates.config.json'),
      JSON.stringify({ docLinks: { skipSegments: ['my-build-output'] } }),
      'utf8',
    );
    write(root, 'README.md', '# root\n');
    write(root, 'docs/x.md', '見 `../README.md:1`。\n');
    write(root, 'docs/my-build-output/broken.md', '壞掉的連結:[x](./nope.md)\n');

    const { code, output } = runSpawned(root);

    expect(code).toBe(0);
    expect(output).toContain('my-build-output');
    expect(output).not.toContain('nope.md');
  }, SPAWN_TIMEOUT_MS);
});
