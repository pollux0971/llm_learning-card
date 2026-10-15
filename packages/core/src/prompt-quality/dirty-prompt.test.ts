/**
 * T11:golden run 的 meta 不能把「有未提交修改的 prompt」記成乾淨的 commit。
 *
 * 這份測試的作者是測試 agent,開發 worker 不改它。全部在 mkdtemp 的 git repo 裡做,
 * 不碰真的 prompts/、不碰真的 golden/(最後一組測試量前後相等)。
 *
 * 釘住的介面(packages/core/src/prompt-quality/):
 *   golden-run.ts
 *     gitCommitOf(relPath: string, root?: string): string        ← 新增匯出,root 預設 ROOT
 *       乾淨且有 commit        → '<短 sha>'(跟 `git log -1 --format=%h -- <檔>` 同值)
 *       已追蹤且有 commit,但  `git diff --quiet -- <檔>` 或 `git diff --cached --quiet -- <檔>` 任一不為 0
 *                              → '<短 sha>-dirty'
 *       沒追蹤、沒有 commit、不是 git repo → 'uncommitted'(既有行為不變)
 *     RunGoldenOptions.root?: string                              ← 新增;讀 prompt 檔與問 git 的 repo 根,預設 ROOT
 *     defaultGoldenBaseDir(mode, root?: string)                   ← root 給了,預設存放處也跟著搬到 <root>/…/golden 或 golden-fake
 *     DirtyPromptError(extends Error, name 'DirtyPromptError', 欄位 set、promptFile)   ← 新增匯出
 *       訊息含 prompt 檔的相對路徑與 `--out`,講明為什麼拒絕
 *     拒絕規則(顧問 2026-10-15 裁決)看**解析後的輸出路徑**,不看有沒有帶 --out:
 *       prompt 是 dirty,而且輸出目錄(baseDir)的 realpath 落在 <root>/packages/core/src/prompt-quality/golden/ 底下
 *       (含 golden/ 本身)→ 丟 DirtyPromptError,**在任何 router.call 之前、在建立任何目錄之前**。
 *       沒給 baseDir 時預設存放處(live)就是 golden/,所以同樣被拒絕。
 *       baseDir 還不存在時,取最近一個存在的祖先做 realpath 再接回剩下的路徑(symlink 繞進 golden/ 也要抓到)。
 *       「底下」要比路徑邊界:golden-fake/、golden-extra/ 不算 golden/ 底下。
 *       輸出目錄在 golden/ 以外(例如 mkdtemp)→ 照常寫,meta 是 -dirty。
 *       規則不分 mode(顧問原話沒有限定 live;fake 預設存 golden-fake/,不會碰到)。
 *   cli.ts
 *     main(argv, deps?: { root?: string })                        ← 第二參數新增,root 原樣傳給 runGolden
 *       dirty 且輸出會落在 golden/ 底下(沒有 --out,或 --out 指進 golden/)→ code 非 0,
 *       output 含 prompt 檔相對路徑與 `--out`,且含 'dirty' 或 '未提交'
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as goldenRun from './golden-run.js';
import { DEFAULT_FAKE_GOLDEN_BASE_DIR, DEFAULT_GOLDEN_BASE_DIR, runGolden } from './golden-run.js';
import { main } from './cli.js';
import { getGoldenSet } from './golden-sets/registry.js';
import type { GoldenRunMeta, LlmRouter } from './types.js';

// ───────────────────────────── 實作還不存在的部分一律動態取用(tsc 0 錯,執行時才紅)
type GitCommitOf = (relPath: string, root?: string) => string;
const gitCommitOf: GitCommitOf = (relPath, root) => {
  const fn = (goldenRun as unknown as { gitCommitOf?: GitCommitOf }).gitCommitOf;
  if (typeof fn !== 'function') throw new Error('golden-run.ts 沒有匯出 gitCommitOf');
  return fn(relPath, root);
};
function dirtyPromptErrorClass(): new (...a: never[]) => Error & { set: string; promptFile: string } {
  const c = (goldenRun as unknown as { DirtyPromptError?: unknown }).DirtyPromptError;
  if (typeof c !== 'function') throw new Error('golden-run.ts 沒有匯出 DirtyPromptError');
  return c as never;
}
/** runGolden 的選項多了 root(尚未存在的欄位),這裡用寬鬆型別傳 */
type LooseOpts = Parameters<typeof runGolden>[0] & { root?: string };
/**
 * 安全閘:沒給 baseDir 的測試會用「預設存放處」。如果實作還不認 root,預設存放處就是**真的** golden/ 或 golden-fake/,
 * 測試一跑就會寫進去(第一次在沒有實作的 base 上跑就發生過)。所以先確認預設存放處真的搬進了 root 底下,否則直接丟錯、不執行。
 */
function assertRootAwareDefaults(o: LooseOpts): void {
  if (o.baseDir !== undefined || o.root === undefined) return;
  const fn = goldenRun.defaultGoldenBaseDir as unknown as (m: 'live' | 'fake', root?: string) => string;
  const dir = fn(o.mode ?? 'fake', o.root);
  if (!dir.startsWith(o.root)) {
    throw new Error(`安全閘:defaultGoldenBaseDir 還不認 root(${dir}),不執行,免得寫進真的 golden/`);
  }
}
const run = (o: LooseOpts) => {
  assertRootAwareDefaults(o);
  return runGolden(o as Parameters<typeof runGolden>[0]);
};
type MainDeps = { root?: string };
const cli = (argv: string[], deps?: MainDeps) => {
  if (deps?.root !== undefined && !argv.includes('--out')) {
    assertRootAwareDefaults({ set: 'selftest', mode: argv.includes('--live') ? 'live' : 'fake', root: deps.root });
  }
  return (main as unknown as (a: string[], d?: MainDeps) => ReturnType<typeof main>)(argv, deps);
};

// ───────────────────────────── 暫存 git repo
const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
function git(root: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.email=t@example.test', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失敗:${r.stderr}`);
  return r.stdout.trim();
}
function newRepo(): string {
  const root = tmp('pq-dirty-repo-');
  git(root, 'init', '-q');
  return root;
}
function put(root: string, rel: string, text: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
}
function commitFile(root: string, rel: string, text: string, msg = 'c'): string {
  put(root, rel, text);
  git(root, 'add', '--', rel);
  git(root, 'commit', '-q', '-m', msg);
  return git(root, 'log', '-1', '--format=%h', '--', rel);
}

const PROMPT = (getGoldenSet('selftest') ?? { promptFile: 'MISSING' }).promptFile;
const REL = 'prompts/x.md';
const SHA_RE = /^[0-9a-f]{7,12}$/;

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

// ───────────────────────────── gitCommitOf
describe('T11 gitCommitOf', () => {
  it('乾淨:回短 sha,跟 git log 同值,沒有 -dirty、沒有換行', () => {
    const root = newRepo();
    const sha = commitFile(root, REL, 'v1\n');
    const got = gitCommitOf(REL, root);
    expect(got).toMatch(SHA_RE);
    expect(got).toBe(sha);
  });

  it('工作區有修改(沒 add):<sha>-dirty(must_catch:dirty 卻記成乾淨的 sha)', () => {
    const root = newRepo();
    const sha = commitFile(root, REL, 'v1\n');
    put(root, REL, 'v1 changed\n');
    expect(gitCommitOf(REL, root)).toBe(`${sha}-dirty`);
  });

  it('只有暫存區有修改(git add 了,工作區跟暫存區一樣):<sha>-dirty(must_catch:只查工作區不查暫存區)', () => {
    const root = newRepo();
    const sha = commitFile(root, REL, 'v1\n');
    put(root, REL, 'v2\n');
    git(root, 'add', '--', REL);
    // 這時 `git diff --quiet` 是 0,只有 `git diff --cached --quiet` 是 1
    expect(spawnSync('git', ['diff', '--quiet', '--', REL], { cwd: root }).status).toBe(0);
    expect(spawnSync('git', ['diff', '--cached', '--quiet', '--', REL], { cwd: root }).status).toBe(1);
    expect(gitCommitOf(REL, root)).toBe(`${sha}-dirty`);
  });

  it('暫存了修改、工作區又改回原樣:仍是 dirty(暫存區跟 HEAD 不一樣)', () => {
    const root = newRepo();
    const sha = commitFile(root, REL, 'v1\n');
    put(root, REL, 'v2\n');
    git(root, 'add', '--', REL);
    put(root, REL, 'v1\n');
    expect(gitCommitOf(REL, root)).toBe(`${sha}-dirty`);
  });

  it('暫存了又在工作區再改:dirty,而且只有一個 -dirty 後綴', () => {
    const root = newRepo();
    const sha = commitFile(root, REL, 'v1\n');
    put(root, REL, 'v2\n');
    git(root, 'add', '--', REL);
    put(root, REL, 'v3\n');
    expect(gitCommitOf(REL, root)).toBe(`${sha}-dirty`);
  });

  it('別的檔案有修改、這個檔案乾淨:仍是乾淨的 sha(只看這個檔,不看整個 repo)', () => {
    const root = newRepo();
    const sha = commitFile(root, REL, 'v1\n');
    commitFile(root, 'other.md', 'o1\n');
    put(root, 'other.md', 'o2 dirty\n');
    put(root, 'untracked.md', 'u\n');
    expect(gitCommitOf(REL, root)).toBe(sha);
  });

  it('只改了 mtime、內容一樣:仍是乾淨的 sha', () => {
    const root = newRepo();
    const sha = commitFile(root, REL, 'v1\n');
    const t = new Date(Date.now() + 5_000);
    utimesSync(join(root, REL), t, t);
    expect(gitCommitOf(REL, root)).toBe(sha);
  });

  it('commit 過兩次又修改:sha 是最近一次動過這個檔的 commit,加 -dirty', () => {
    const root = newRepo();
    commitFile(root, REL, 'v1\n');
    const sha2 = commitFile(root, REL, 'v2\n');
    commitFile(root, 'other.md', 'o\n'); // HEAD 往前走,但不是動這個檔
    put(root, REL, 'v3\n');
    expect(gitCommitOf(REL, root)).toBe(`${sha2}-dirty`);
  });

  it('修改之後提交:回到乾淨,而且是新的 sha(不留舊的 dirty)', () => {
    const root = newRepo();
    const sha1 = commitFile(root, REL, 'v1\n');
    put(root, REL, 'v2\n');
    expect(gitCommitOf(REL, root)).toBe(`${sha1}-dirty`);
    const sha2 = commitFile(root, REL, 'v2\n');
    expect(sha2).not.toBe(sha1);
    expect(gitCommitOf(REL, root)).toBe(sha2);
  });

  it('檔名有空白與中文:修改後也是 dirty', () => {
    const root = newRepo();
    const rel = 'prompts/卡片 提示.md';
    const sha = commitFile(root, rel, 'v1\n');
    put(root, rel, 'v2\n');
    expect(gitCommitOf(rel, root)).toBe(`${sha}-dirty`);
  });

  it('已追蹤的檔案在工作區被刪掉:dirty(用的就是 git diff 的退出碼)', () => {
    const root = newRepo();
    const sha = commitFile(root, REL, 'v1\n');
    rmSync(join(root, REL));
    expect(gitCommitOf(REL, root)).toBe(`${sha}-dirty`);
  });

  it('沒追蹤的新檔、或只 add 了還沒有 commit:仍是 uncommitted(既有行為,不加 -dirty)', () => {
    const root = newRepo();
    commitFile(root, 'other.md', 'o\n');
    put(root, REL, 'new\n');
    expect(gitCommitOf(REL, root)).toBe('uncommitted');
    git(root, 'add', '--', REL);
    expect(gitCommitOf(REL, root)).toBe('uncommitted');
  });

  it('根本不是 git repo:uncommitted,不丟錯', () => {
    const root = tmp('pq-dirty-nogit-');
    put(root, REL, 'v1\n');
    expect(gitCommitOf(REL, root)).toBe('uncommitted');
  });
});

// ───────────────────────────── runGolden:meta 與拒絕
interface CountingRouter extends LlmRouter { calls: number }
function countingRouter(): CountingRouter {
  const r: CountingRouter = {
    calls: 0,
    async call() {
      r.calls += 1;
      return { text: JSON.stringify({ criteria: [true, false], feedback: 'ok' }), model: 'm', provider: 'anthropic', tokens_in: 1, tokens_out: 1 } as never;
    },
    async probeOnline() { return true; },
    async probeLocal() { return { available: false, models: [] }; },
  };
  return r;
}
const GOLDEN_REL = 'packages/core/src/prompt-quality/golden';
const FAKE_REL = 'packages/core/src/prompt-quality/golden-fake';

function promptRepo(): { root: string; sha: string } {
  const root = newRepo();
  const sha = commitFile(root, PROMPT, '# selftest prompt\n');
  return { root, sha };
}
function listAll(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : [];
}
function readMeta(dir: string): GoldenRunMeta {
  return JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as GoldenRunMeta;
}

let realGoldenBefore = '';
beforeEach(() => {
  realGoldenBefore = JSON.stringify([listAll(DEFAULT_GOLDEN_BASE_DIR), listAll(DEFAULT_FAKE_GOLDEN_BASE_DIR)]);
});
afterEach(() => {
  // 真的 golden/ 與 golden-fake/ 前後相等:這一組測試絕不能寫進去(最差情況就是蓋掉基準)
  expect(JSON.stringify([listAll(DEFAULT_GOLDEN_BASE_DIR), listAll(DEFAULT_FAKE_GOLDEN_BASE_DIR)])).toBe(realGoldenBefore);
});

describe('T11 defaultGoldenBaseDir 跟著 root 走', () => {
  it('給 root 時,live 與 fake 的預設存放處在 root 底下(測試才不會寫進真的 golden/)', () => {
    const fn = goldenRun.defaultGoldenBaseDir as unknown as (m: 'live' | 'fake', root?: string) => string;
    expect(fn('live', '/x/y')).toBe(join('/x/y', GOLDEN_REL));
    expect(fn('fake', '/x/y')).toBe(join('/x/y', FAKE_REL));
    expect(fn('live')).toBe(DEFAULT_GOLDEN_BASE_DIR);
    expect(fn('fake')).toBe(DEFAULT_FAKE_GOLDEN_BASE_DIR);
  });
});

describe('T11 runGolden --live', () => {
  it('prompt 乾淨、沒給 baseDir:寫進 <root>/…/golden/,meta 是乾淨的 sha', async () => {
    const { root, sha } = promptRepo();
    const router = countingRouter();
    const result = await run({ set: 'selftest', today: '2026-09-10', mode: 'live', root, createRouter: () => router });
    expect(result.dir.startsWith(join(root, GOLDEN_REL))).toBe(true);
    expect(readMeta(result.dir).promptFileGitCommit).toBe(sha);
    expect(router.calls).toBe(3);
  });

  it('prompt dirty、沒給 baseDir:丟 DirtyPromptError,一次 call 都沒有、什麼目錄都沒建(must_catch:dirty 時仍寫進 golden/)', async () => {
    const { root } = promptRepo();
    put(root, PROMPT, '# edited, not committed\n');
    const router = countingRouter();
    const err = await run({ set: 'selftest', today: '2026-09-10', mode: 'live', root, createRouter: () => router }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(dirtyPromptErrorClass());
    const e = err as Error & { set: string; promptFile: string };
    expect(e.name).toBe('DirtyPromptError');
    expect(e.set).toBe('selftest');
    expect(e.promptFile).toBe(PROMPT);
    expect(e.message).toContain(PROMPT);
    expect(e.message).toContain('--out');
    expect(router.calls).toBe(0);
    expect(existsSync(join(root, GOLDEN_REL))).toBe(false);
  });

  it('prompt 只有暫存區有修改、沒給 baseDir:同樣拒絕', async () => {
    const { root } = promptRepo();
    put(root, PROMPT, '# staged only\n');
    git(root, 'add', '--', PROMPT);
    const router = countingRouter();
    await expect(run({ set: 'selftest', today: '2026-09-10', mode: 'live', root, createRouter: () => router })).rejects.toBeInstanceOf(
      dirtyPromptErrorClass(),
    );
    expect(router.calls).toBe(0);
    expect(existsSync(join(root, GOLDEN_REL))).toBe(false);
  });

  it('prompt dirty、baseDir 在 golden/ 以外(--out 指到暫存目錄):照常寫,meta 仍是 <sha>-dirty,快照是修改後的內容', async () => {
    const { root, sha } = promptRepo();
    put(root, PROMPT, '# edited, not committed\n');
    const out = tmp('pq-dirty-out-');
    const router = countingRouter();
    const result = await run({ set: 'selftest', today: '2026-09-10', mode: 'live', root, baseDir: out, createRouter: () => router });
    expect(router.calls).toBe(3);
    expect(result.dir.startsWith(out)).toBe(true);
    expect(readMeta(result.dir).promptFileGitCommit).toBe(`${sha}-dirty`);
    expect(result.meta.promptFileGitCommit).toBe(`${sha}-dirty`);
    expect(readFileSync(join(result.dir, 'prompt.snapshot.md'), 'utf8')).toBe('# edited, not committed\n');
    expect(existsSync(join(root, GOLDEN_REL))).toBe(false);
  });

  it('prompt dirty、--out 指回 golden/ 底下(不存在的子目錄):拒絕(must_catch:用 --out 指回 golden/ 繞過拒絕)', async () => {
    const { root } = promptRepo();
    put(root, PROMPT, '# edited\n');
    const router = countingRouter();
    const baseDir = join(root, GOLDEN_REL, 'x');
    await expect(run({ set: 'selftest', today: '2026-09-10', mode: 'live', root, baseDir, createRouter: () => router })).rejects.toBeInstanceOf(
      dirtyPromptErrorClass(),
    );
    expect(router.calls).toBe(0);
    expect(existsSync(join(root, GOLDEN_REL))).toBe(false);
  });

  it('prompt dirty、--out 就是 golden/ 本身(已存在):拒絕,裡面沒長東西', async () => {
    const { root } = promptRepo();
    put(root, PROMPT, '# edited\n');
    mkdirSync(join(root, GOLDEN_REL), { recursive: true });
    const router = countingRouter();
    await expect(
      run({ set: 'selftest', today: '2026-09-10', mode: 'live', root, baseDir: join(root, GOLDEN_REL), createRouter: () => router }),
    ).rejects.toBeInstanceOf(dirtyPromptErrorClass());
    expect(router.calls).toBe(0);
    expect(readdirSync(join(root, GOLDEN_REL))).toEqual([]);
  });

  it('prompt dirty、--out 是繞進 golden/ 的 symlink(含 symlink 底下尚不存在的子目錄):拒絕(比 realpath)', async () => {
    const { root } = promptRepo();
    put(root, PROMPT, '# edited\n');
    mkdirSync(join(root, GOLDEN_REL), { recursive: true });
    const holder = tmp('pq-dirty-link-');
    symlinkSync(join(root, GOLDEN_REL), join(holder, 'link'));
    for (const baseDir of [join(holder, 'link'), join(holder, 'link', 'deeper', 'x')]) {
      const router = countingRouter();
      await expect(run({ set: 'selftest', today: '2026-09-10', mode: 'live', root, baseDir, createRouter: () => router })).rejects.toBeInstanceOf(
        dirtyPromptErrorClass(),
      );
      expect(router.calls).toBe(0);
    }
    expect(readdirSync(join(root, GOLDEN_REL))).toEqual([]);
  });

  it('root 本身是 symlink 路徑、--out 給真實路徑指進 golden/:拒絕(golden/ 的位置也要解析成 realpath)', async () => {
    const { root } = promptRepo();
    put(root, PROMPT, '# edited\n');
    const holder = tmp('pq-dirty-rootlink-');
    const linkedRoot = join(holder, 'repo');
    symlinkSync(root, linkedRoot);
    const router = countingRouter();
    await expect(
      run({ set: 'selftest', today: '2026-09-10', mode: 'live', root: linkedRoot, baseDir: join(realpathSync(root), GOLDEN_REL, 'x'), createRouter: () => router }),
    ).rejects.toBeInstanceOf(dirtyPromptErrorClass());
    expect(router.calls).toBe(0);
  });

  it('prompt dirty、--out 用 .. 繞回 golden/:拒絕(解析後的路徑)', async () => {
    const { root } = promptRepo();
    put(root, PROMPT, '# edited\n');
    const baseDir = join(root, 'packages', 'core', 'src', 'prompt-quality', 'golden-fake', '..', 'golden', 'y');
    const router = countingRouter();
    await expect(run({ set: 'selftest', today: '2026-09-10', mode: 'live', root, baseDir, createRouter: () => router })).rejects.toBeInstanceOf(
      dirtyPromptErrorClass(),
    );
    expect(router.calls).toBe(0);
  });

  it('prompt dirty、--out 在名字相近的兄弟目錄(golden-fake、golden-extra):照常寫(路徑邊界,不是字串前綴)', async () => {
    for (const sibling of ['golden-fake', 'golden-extra']) {
      const { root, sha } = promptRepo();
      put(root, PROMPT, '# edited\n');
      const baseDir = join(root, 'packages', 'core', 'src', 'prompt-quality', sibling, 'x');
      const router = countingRouter();
      const result = await run({ set: 'selftest', today: '2026-09-10', mode: 'live', root, baseDir, createRouter: () => router });
      expect(router.calls).toBe(3);
      expect(readMeta(result.dir).promptFileGitCommit).toBe(`${sha}-dirty`);
    }
  });

  it('prompt 乾淨、--out 指進 golden/ 底下:照常寫(拒絕只針對 dirty)', async () => {
    const { root, sha } = promptRepo();
    const baseDir = join(root, GOLDEN_REL, 'x');
    const router = countingRouter();
    const result = await run({ set: 'selftest', today: '2026-09-10', mode: 'live', root, baseDir, createRouter: () => router });
    expect(router.calls).toBe(3);
    expect(result.dir.startsWith(baseDir)).toBe(true);
    expect(readMeta(result.dir).promptFileGitCommit).toBe(sha);
  });

  it('拒絕之後把 prompt 提交,同一個呼叫就能寫進 golden/(拒絕不留狀態)', async () => {
    const { root } = promptRepo();
    put(root, PROMPT, '# v2\n');
    await expect(run({ set: 'selftest', today: '2026-09-10', mode: 'live', root, createRouter: () => countingRouter() })).rejects.toThrow();
    git(root, 'add', '--', PROMPT);
    git(root, 'commit', '-q', '-m', 'v2');
    const sha = git(root, 'log', '-1', '--format=%h', '--', PROMPT);
    const result = await run({ set: 'selftest', today: '2026-09-10', mode: 'live', root, createRouter: () => countingRouter() });
    expect(readMeta(result.dir).promptFileGitCommit).toBe(sha);
  });
});

describe('T11 runGolden fake', () => {
  it('dirty 的 prompt:fake 不拒絕(預設存 golden-fake/),meta 記 <sha>-dirty', async () => {
    const { root, sha } = promptRepo();
    put(root, PROMPT, '# edited\n');
    const result = await run({ set: 'selftest', today: '2026-09-10', mode: 'fake', root });
    expect(result.dir.startsWith(join(root, FAKE_REL))).toBe(true);
    expect(readMeta(result.dir).promptFileGitCommit).toBe(`${sha}-dirty`);
  });

  it('dirty 的 prompt、fake 模式、--out 指進 golden/:也拒絕(規則看輸出路徑,不分 mode)', async () => {
    const { root } = promptRepo();
    put(root, PROMPT, '# edited\n');
    await expect(
      run({ set: 'selftest', today: '2026-09-10', mode: 'fake', root, baseDir: join(root, GOLDEN_REL, 'x') }),
    ).rejects.toBeInstanceOf(dirtyPromptErrorClass());
    expect(existsSync(join(root, GOLDEN_REL))).toBe(false);
  });

  it('乾淨的 prompt:fake 的 meta 是乾淨的 sha', async () => {
    const { root, sha } = promptRepo();
    const result = await run({ set: 'selftest', today: '2026-09-10', mode: 'fake', root, baseDir: tmp('pq-dirty-out-') });
    expect(readMeta(result.dir).promptFileGitCommit).toBe(sha);
  });
});

// ───────────────────────────── CLI
describe('T11 cli main', () => {
  let realFetch: typeof globalThis.fetch;
  let realEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    realEnv = { ...process.env };
    // 沙箱 HOME:即使實作寫錯、真的往下跑,也讀不到使用者真的指標檔,打不到網路
    const home = tmp('pq-dirty-home-');
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = join(home, 'xdg');
    process.env.XDG_RUNTIME_DIR = join(home, 'runtime');
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      throw new Error(`T11 測試不該有網路請求:${String(input)}`);
    }) as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = realEnv;
  });

  it('--live 沒有 --out、prompt dirty:退出碼非 0,訊息有 prompt 檔路徑、--out、dirty/未提交;golden/ 什麼都沒長', async () => {
    const { root } = promptRepo();
    put(root, PROMPT, '# edited\n');
    const result = await cli(['--golden', '--set', 'selftest', '--live'], { root });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain(PROMPT);
    expect(result.output).toContain('--out');
    expect(result.output).toMatch(/dirty|未提交/);
    expect(existsSync(join(root, GOLDEN_REL))).toBe(false);
  });

  it('--live --out 指進 golden/ 底下、prompt dirty:退出碼非 0,golden/ 什麼都沒長', async () => {
    const { root } = promptRepo();
    put(root, PROMPT, '# edited\n');
    const result = await cli(['--golden', '--set', 'selftest', '--live', '--out', join(root, GOLDEN_REL, 'x')], { root });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain(PROMPT);
    expect(result.output).toMatch(/dirty|未提交/);
    expect(existsSync(join(root, GOLDEN_REL))).toBe(false);
  });

  it('--live --out 指到暫存目錄、prompt dirty:退出碼 0,meta 記 -dirty(帳本走沙箱指標)', async () => {
    const { root, sha } = promptRepo();
    put(root, PROMPT, '# edited\n');
    // 沙箱指標與標記(同 cli.test.ts 的 --live 區塊)+ 假雲端
    const vault = tmp('pq-dirty-vault-');
    const vaultId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const ledger = join(vault, 'learning');
    mkdirSync(join(ledger, 'config'), { recursive: true });
    writeFileSync(join(ledger, 'config', 'vault-id'), `${vaultId}\n`);
    mkdirSync(join(vault, 'xdg', 'llm-learning-cards'), { recursive: true });
    writeFileSync(join(vault, 'xdg', 'llm-learning-cards', 'vault.json'), JSON.stringify({ learning_dir: ledger, vault_id: vaultId }));
    process.env.HOME = vault;
    process.env.XDG_CONFIG_HOME = join(vault, 'xdg');
    process.env.LLM_CLOUD_PROVIDER = 'anthropic';
    process.env.LLM_CLOUD_MODEL = 'claude-sonnet-5';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/v1/models')) return json({ data: [] });
      if (url.includes('/v1/messages')) {
        return json({
          id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', stop_reason: 'end_turn', stop_sequence: null,
          content: [{ type: 'text', text: JSON.stringify({ criteria: [true, false], feedback: 'ok' }) }],
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      }
      throw new Error(`T11 測試沒預期到的請求:${url}`);
    }) as typeof globalThis.fetch;
    const out = tmp('pq-dirty-out-');
    const result = await cli(['--golden', '--set', 'selftest', '--live', '--out', out], { root });
    expect(result.code).toBe(0);
    const metaRel = listAll(out).find((p) => p.endsWith('meta.json'))!;
    expect(readMeta(join(out, metaRel, '..')).promptFileGitCommit).toBe(`${sha}-dirty`);
    expect(existsSync(join(root, GOLDEN_REL))).toBe(false);
  });

  it('--fake dirty:不拒絕,退出碼 0,meta 記 -dirty', async () => {
    const { root, sha } = promptRepo();
    put(root, PROMPT, '# edited\n');
    const result = await cli(['--golden', '--set', 'selftest', '--fake'], { root });
    expect(result.code).toBe(0);
    const runs = listAll(join(root, FAKE_REL)).filter((p) => p.endsWith('meta.json'));
    expect(runs).toHaveLength(1);
    expect(readMeta(join(root, FAKE_REL, runs[0]!, '..')).promptFileGitCommit).toBe(`${sha}-dirty`);
  });

  it('--fake --out 乾淨:meta 是乾淨的 sha(沒有誤標 dirty)', async () => {
    const { root, sha } = promptRepo();
    const out = tmp('pq-dirty-out-');
    const result = await cli(['--golden', '--set', 'selftest', '--fake', '--out', out], { root });
    expect(result.code).toBe(0);
    const metaRel = listAll(out).find((p) => p.endsWith('meta.json'))!;
    expect(readMeta(join(out, metaRel, '..')).promptFileGitCommit).toBe(sha);
  });
});
