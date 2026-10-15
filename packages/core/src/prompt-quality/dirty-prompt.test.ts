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
 *     runGoldenLive:沒給 baseDir 且 prompt 是 dirty → 丟 DirtyPromptError,
 *       **在任何 router.call 之前、在建立任何目錄之前**;給了 baseDir 照常寫,meta 仍是 -dirty。
 *       fake 模式不拒絕(預設存放處 golden-fake/ 不進 git),meta 一樣記 -dirty。
 *   cli.ts
 *     main(argv, deps?: { root?: string })                        ← 第二參數新增,root 原樣傳給 runGolden
 *       --live、沒有 --out、dirty → code 非 0,output 含 prompt 檔相對路徑與 `--out`,且含 'dirty' 或 '未提交'
 *
 * 未裁決(測試不涵蓋,不要在實作裡自己當成已定):--live 明確把 --out 指到 golden/ 本身的 dirty 行為。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

  it('prompt dirty、有給 baseDir(--out):照常寫,meta 仍是 <sha>-dirty,快照是修改後的內容', async () => {
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
