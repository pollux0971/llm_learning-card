/**
 * T4b 驗收 3、4、5 的測試。全部用合成 fixture,不改本 repo 的 SOURCE 標頭,
 * 不碰 /data/python/dev-loop-mcp。
 *
 * T60:暫存目錄在 os.tmpdir() 底下自己開一個(beforeAll 建、afterAll 刪),子行程的 TMPDIR 指到它;
 * 不依賴跑測試那台機器上先有某個資料夾,也不碰別人(opencode)的暫存位置。
 *
 * 包裝腳本契約(實作必須對上這些字,測試轉綠之後不要改這裡):
 * - 呼叫:`bash scripts/check-gates-pinned.sh <consumer-root>`
 * - `TEMPLATE_DIR` 非空:印一行 `TEMPLATE_DIR 明設,未驗證釘版本`,
 *   然後直接跑 `$TEMPLATE_DIR/scripts/sync-gates.sh <root> scripts --check`,
 *   不讀模板 repo、不 git archive。
 * - 否則用 `TEMPLATE_REPO`(預設不在這些測試裡出現;測試一律明設)。
 * - 混版:`✗ SOURCE 標頭的 (版本, commit) 不是恰好一種,不准多數決`
 *   接著每個標頭檔一行 `<相對路徑>\t<version>\t<commit>`。
 * - 缺 repo:`✗ 模板 repo 不存在: <path>`
 * - 缺 commit:`✗ commit 不存在於模板 repo: <標頭裡的 sha>`
 * - tag 物件:`✗ tag <version> 要比 commit,不是 tag 物件: 標頭=<sha>`
 * - archive 解不出 sync-gates.sh:`✗ archive 解不出 sync-gates.sh`
 * - 零個 SOURCE 標頭:非零,並印 `✗ SOURCE 標頭的 (版本, commit) 不是恰好一種,不准多數決`
 *   (零組走同一條「不是恰好一種」;只斷言非零的話,拿掉該檢查後 `read`/`set -e` 仍非零,突變不會變紅)
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WRAPPER = resolve(import.meta.dirname, 'check-gates-pinned.sh');
let TEMP_BASE = '';
const MISSING_COMMIT = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const SUCCESS = '✓ 守門內容自同步以來未被更動';
const EXPLICIT_LINE = 'TEMPLATE_DIR 明設,未驗證釘版本';
const MIXED_LINE = '✗ SOURCE 標頭的 (版本, commit) 不是恰好一種,不准多數決';
const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];

beforeAll(() => {
  TEMP_BASE = mkdtempSync(join(tmpdir(), 'lc-gates-pinned-'));
});

afterAll(() => {
  rmSync(TEMP_BASE, { recursive: true, force: true });
});

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(TEMP_BASE, prefix));
  tmpDirs.push(dir);
  return dir;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: TEMP_BASE,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 't4b-test',
    GIT_AUTHOR_EMAIL: 't4b-test@example.invalid',
    GIT_COMMITTER_NAME: 't4b-test',
    GIT_COMMITTER_EMAIL: 't4b-test@example.invalid',
  };
}

function git(repo: string, args: string[]): string {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: gitEnv() });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} rc=${r.status}: ${r.stdout ?? ''}${r.stderr ?? ''}`);
  }
  return (r.stdout ?? '').trim();
}

function initRepo(): string {
  const repo = tempDir('t4b-repo-');
  git(repo, ['init', '-q']);
  return repo;
}

/** 會被 archive 出來的 stub。被呼叫就印標記並以 0 結束,方便看出「退回 HEAD / 直接執行」。 */
function writeArchivedStub(repo: string): void {
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  writeFileSync(
    join(repo, 'scripts', 'sync-gates.sh'),
    '#!/usr/bin/env bash\necho STUB_SYNC_GATES_CALLED\necho "✓ 守門內容自同步以來未被更動"\nexit 0\n',
    { mode: 0o755 },
  );
}

function commitAll(repo: string, message: string): string {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

function writeConsumer(files: Record<string, string>): string {
  const root = tempDir('t4b-consumer-');
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  return root;
}

function runWrapper(consumer: string, extra: Record<string, string>): { code: number; output: string } {
  const r = spawnSync('bash', [WRAPPER, consumer], {
    cwd: consumer,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...gitEnv(), ...extra },
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('T4b 驗收 3:紅燈對照(合成 fixture)', () => {
  it('不存在的 commit:非零,且不准退回活的 HEAD', () => {
    const repo = initRepo();
    writeArchivedStub(repo);
    commitAll(repo, 'head-with-stub');
    const consumer = writeConsumer({
      'scripts/only.ts': `// SOURCE: template v1.6.8 (${MISSING_COMMIT}) sha256=000\nexport {}\n`,
    });

    const { code, output } = runWrapper(consumer, { TEMPLATE_REPO: repo });

    expect(code).not.toBe(0);
    expect(output).toContain(`✗ commit 不存在於模板 repo: ${MISSING_COMMIT}`);
    expect(output).not.toContain('STUB_SYNC_GATES_CALLED');
    expect(output).not.toContain(SUCCESS);
  });

  it('不存在的 repo:非零,且不准退回預設路徑', () => {
    const missingRepo = join(tempDir('t4b-missing-'), 'no-such-repo');
    const consumer = writeConsumer({
      'scripts/only.ts': `// SOURCE: template v1.6.8 (${MISSING_COMMIT}) sha256=000\nexport {}\n`,
    });

    const { code, output } = runWrapper(consumer, { TEMPLATE_REPO: missingRepo });

    expect(code).not.toBe(0);
    expect(output).toContain(`✗ 模板 repo 不存在: ${missingRepo}`);
    expect(output).not.toContain(SUCCESS);
  });

  it('混版標頭:兩個都存在的合法 commit,非零,列出檔名與值,不准多數決', () => {
    const repo = initRepo();
    writeArchivedStub(repo);
    const commitA = commitAll(repo, 'commit-a');
    writeFileSync(join(repo, 'README'), 'b\n', 'utf8');
    const commitB = commitAll(repo, 'commit-b');
    expect(commitA).not.toBe(commitB);
    git(repo, ['cat-file', '-e', `${commitA}^{commit}`]);
    git(repo, ['cat-file', '-e', `${commitB}^{commit}`]);
    // 兩個 annotated tag 都剝得到標頭寫的 commit。失敗原因只能是「不是恰好一種」,
    // 不能是 commit 不存在,也不能是 tag 對不上。
    git(repo, ['tag', '-a', 'v1.0.0', commitA, '-m', 'a']);
    git(repo, ['tag', '-a', 'v2.0.0', commitB, '-m', 'b']);

    const consumer = writeConsumer({
      'scripts/alpha.ts': `// SOURCE: template v1.0.0 (${commitA}) sha256=aaa\nexport {}\n`,
      'scripts/beta.py': `# SOURCE: template v2.0.0 (${commitB}) sha256=bbb\n`,
      // 第一行不是標頭。掃全檔(grep -l)會把這行算進去;head -1 不准算。
      'scripts/local.ts': `export const x = 1;\n// SOURCE: template v3.0.0 (cccccccccccccccccccccccccccccccccccccccc)\n`,
    });

    const { code, output } = runWrapper(consumer, { TEMPLATE_REPO: repo });

    expect(code).not.toBe(0);
    expect(output).toContain(MIXED_LINE);
    expect(output).toContain(`scripts/alpha.ts\tv1.0.0\t${commitA}`);
    expect(output).toContain(`scripts/beta.py\tv2.0.0\t${commitB}`);
    expect(output).not.toContain('scripts/local.ts');
    expect(output).not.toContain('v3.0.0');
    expect(output).not.toContain('STUB_SYNC_GATES_CALLED');
    expect(output).not.toContain(SUCCESS);
  });
});

describe('T4b 驗收 4:TEMPLATE_DIR 明設', () => {
  it('直接用明設目錄,不經 git archive,並印出未驗證釘版本', () => {
    const direct = tempDir('t4b-direct-');
    mkdirSync(join(direct, 'scripts'));
    writeFileSync(
      join(direct, 'scripts', 'sync-gates.sh'),
      '#!/usr/bin/env bash\necho DIRECT_TEMPLATE_DIR\necho "args:$*"\necho "✓ 守門內容自同步以來未被更動"\nexit 0\n',
      { mode: 0o755 },
    );
    const missingRepo = join(tempDir('t4b-missing-'), 'no-such-repo');
    // 標頭是混的。若沒走明設分支、改去釘版本,這裡必須紅。測試期待綠。
    const consumer = writeConsumer({
      'scripts/a.ts': `// SOURCE: template v1.0.0 (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)\n`,
      'scripts/b.ts': `// SOURCE: template v2.0.0 (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)\n`,
    });

    const { code, output } = runWrapper(consumer, {
      TEMPLATE_DIR: direct,
      TEMPLATE_REPO: missingRepo,
    });

    expect(code).toBe(0);
    expect(output.split('\n')).toContain(EXPLICIT_LINE);
    expect(output).toContain('DIRECT_TEMPLATE_DIR');
    expect(output).toContain('--check');
    expect(output).not.toContain('模板 repo 不存在');
    expect(output).not.toContain(MIXED_LINE);
  });
});

describe('T4b 驗收 5:取 tag 要比 commit,不是 tag 物件', () => {
  it('annotated tag 的物件 sha 不同於 commit 時,標頭寫短 commit 仍綠', () => {
    const repo = initRepo();
    writeArchivedStub(repo);
    const peeled = commitAll(repo, 'pinned');
    git(repo, ['tag', '-a', 'v9.9.9', '-m', 'annotated']);
    const tagObj = git(repo, ['rev-parse', 'v9.9.9']);
    const peeledAgain = git(repo, ['rev-parse', 'v9.9.9^{commit}']);
    expect(peeledAgain).toBe(peeled);
    expect(tagObj).not.toBe(peeled);
    const short = peeled.slice(0, 7);
    expect(short).not.toBe(peeled);
    expect(git(repo, ['rev-parse', '--verify', short])).toBe(peeled);
    expect(git(repo, ['cat-file', '-t', short])).toBe('commit');

    const consumer = writeConsumer({
      'scripts/pinned.ts': `// SOURCE: template v9.9.9 (${short}) sha256=abc\nexport {}\n`,
      // 正文才有另一組標頭。head -1 必須忽略;掃全檔會變成混版或缺 commit。
      'scripts/trap.ts': `/**\n// SOURCE: template v0.0.1 (${MISSING_COMMIT})\n`,
    });

    const { code, output } = runWrapper(consumer, { TEMPLATE_REPO: repo });

    expect(code).toBe(0);
    expect(output).toContain('STUB_SYNC_GATES_CALLED');
    expect(output.split('\n').filter((line) => line.length > 0).at(-1)).toBe(SUCCESS);
    expect(output).not.toContain(EXPLICIT_LINE);
    expect(output).not.toContain('不是 tag 物件');
    expect(output).not.toContain('v0.0.1');
    expect(output).not.toContain(MISSING_COMMIT);
  });

  it('標頭寫 annotated tag 的物件 sha 時必須紅(git archive 該 sha 仍能解出樹)', () => {
    const repo = initRepo();
    writeArchivedStub(repo);
    const peeled = commitAll(repo, 'pinned');
    git(repo, ['tag', '-a', 'v9.9.9', '-m', 'annotated']);
    const tagObj = git(repo, ['rev-parse', 'v9.9.9']);
    expect(tagObj).not.toBe(peeled);
    expect(git(repo, ['cat-file', '-t', tagObj])).toBe('tag');
    // 對照:archive tag 物件 sha 本身會成功(git 會剝)。拿掉「不是 tag 物件」
    // 那道檢查、直接 archive 標頭 sha,stub 會被叫到,這條測試必須變紅。
    const extracted = tempDir('t4b-archive-probe-');
    const archived = spawnSync('git', ['-C', repo, 'archive', tagObj], { env: gitEnv() });
    expect(archived.status).toBe(0);
    const untar = spawnSync('tar', ['-x', '-C', extracted], { input: archived.stdout ?? undefined, env: gitEnv() });
    expect(untar.status).toBe(0);

    const consumer = writeConsumer({
      'scripts/pinned.ts': `// SOURCE: template v9.9.9 (${tagObj}) sha256=abc\nexport {}\n`,
    });

    const { code, output } = runWrapper(consumer, { TEMPLATE_REPO: repo });

    expect(code).not.toBe(0);
    expect(output).toContain(`✗ tag v9.9.9 要比 commit,不是 tag 物件: 標頭=${tagObj}`);
    expect(output).not.toContain('STUB_SYNC_GATES_CALLED');
    expect(output).not.toContain(SUCCESS);
  });
});

describe('T4b 退回修正:缺席紅燈(合成 fixture)', () => {
  it('archive 解不出 sync-gates.sh:非零,並印 archive 解不出 sync-gates.sh', () => {
    const repo = initRepo();
    mkdirSync(join(repo, 'scripts'));
    writeFileSync(join(repo, 'scripts', 'other.sh'), '#!/usr/bin/env bash\necho OTHER\n', 'utf8');
    const commit = commitAll(repo, 'no-sync-gates');
    git(repo, ['tag', '-a', 'v1.2.3', commit, '-m', 'no sync-gates']);
    expect(git(repo, ['cat-file', '-t', commit])).toBe('commit');
    expect(git(repo, ['rev-parse', 'v1.2.3^{commit}'])).toBe(commit);

    const consumer = writeConsumer({
      'scripts/only.ts': `// SOURCE: template v1.2.3 (${commit}) sha256=000\nexport {}\n`,
    });

    const { code, output } = runWrapper(consumer, { TEMPLATE_REPO: repo });

    expect(code).not.toBe(0);
    expect(output).toContain('archive 解不出 sync-gates.sh');
    expect(output).not.toContain('git archive 失敗');
    expect(output).not.toContain('OTHER');
    expect(output).not.toContain('STUB_SYNC_GATES_CALLED');
    expect(output).not.toContain(SUCCESS);
  });

  it('scripts 底下零個 SOURCE 標頭:非零', () => {
    const repo = initRepo();
    const consumer = writeConsumer({
      'scripts/plain.ts': 'export const x = 1;\n',
      // 正文才有 SOURCE。head -1 必須忽略;算進去就不是「零個標頭」。
      'scripts/body-only.ts': `export const y = 2;\n// SOURCE: template v9.9.9 (${MISSING_COMMIT})\n`,
    });

    const { code, output } = runWrapper(consumer, { TEMPLATE_REPO: repo });

    expect(code).not.toBe(0);
    expect(output).toContain(MIXED_LINE);
    expect(output).not.toContain('scripts/plain.ts');
    expect(output).not.toContain('scripts/body-only.ts');
    expect(output).not.toContain(MISSING_COMMIT);
    expect(output).not.toContain('模板 repo 不存在');
    expect(output).not.toContain('STUB_SYNC_GATES_CALLED');
    expect(output).not.toContain(SUCCESS);
  });
});
