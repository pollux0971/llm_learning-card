/**
 * T17(11-review-cli phase-2)紅測試的共用量尺:在暫存目錄上跑**真的** `scripts/review.ts`,
 * 查它留在磁碟上的東西(reviews.json、state/log.jsonl、XDG cache 底下的當日快取、git 歷史)。
 *
 * 這裡只有「佈置」與「觀測」,沒有任何 session 邏輯:不算題目集合、不算快取內容、不判斷已答。
 * 預期值一律由測試自己從工單寫死的規格推出來(快取位置、檔名、欄位),不從這裡取。
 *
 * 純輔助模組(沒有 cucumber / vitest 相依):步驟檔與 vitest 都 import 它。
 *
 * 全部用暫存目錄:learning 目錄、XDG_CONFIG_HOME、XDG_CACHE_HOME、HOME 都在同一個 mkdtemp 底下,
 * 不碰真的 learning/ 與真的 ~/.cache。子程序的網路層換成假的(_fake-review-cloud.mjs),不打真網路。
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const ROOT = resolve(import.meta.dirname, '../..');
const TEMPLATE = join(ROOT, 'contracts/fixtures/learning-minimal');
const TEMPLATE_CARD = 'sec-0001';
const TSX_LOADER = join(ROOT, 'node_modules/tsx/dist/esm/index.mjs');
const FAKE_CLOUD = join(ROOT, 'features/steps/_fake-review-cloud.mjs');
const REVIEW_SCRIPT = join(ROOT, 'scripts/review.ts');

export const TODAY = '2026-09-10';
export const FILL_PROMPT_MARK = '用逗號分隔:';
export const APPLY_PROMPT_MARK = '輸入空行結束:';

/** 一個暫存世界:learning 目錄加上環境(指標檔、快取根、HOME)。 */
export interface Vault {
  scratch: string;
  dir: string;
  xdgConfig: string;
  xdgCache: string;
  home: string;
  /** config/vault-id 的內容(uuid);沒有標記檔時 undefined */
  vaultId: string | undefined;
}

export interface CreateVaultOpts {
  /** 磁碟上要有幾張可以考的卡(sec-0001 起);預設 3(fixture 原有的) */
  cards?: number;
  /** 指定 vault_id;`null` = 不寫 config/vault-id 也不寫指標檔(沒有帳本身分的目錄) */
  vaultId?: string | null;
  /** 與別的 vault 共用同一個快取根 */
  xdgCache?: string;
  /** daily_cap(settings.yaml);預設用 fixture 的 10 */
  dailyCap?: number;
}

export function cardIdOf(n: number): string {
  return `sec-${String(n).padStart(4, '0')}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function createVault(opts: CreateVaultOpts = {}): Vault {
  const scratch = mkdtempSync(join(tmpdir(), 'lc-t17-'));
  const dir = join(scratch, 'learning');
  cpSync(TEMPLATE, dir, { recursive: true });
  const xdgConfig = join(scratch, 'config-home');
  const xdgCache = opts.xdgCache ?? join(scratch, 'cache-home');
  const home = join(scratch, 'home');
  for (const d of [xdgConfig, home]) mkdirSync(d, { recursive: true });
  const vaultId = opts.vaultId === null ? undefined : (opts.vaultId ?? randomUUID());
  const vault: Vault = { scratch, dir, xdgConfig, xdgCache, home, vaultId };
  if (vaultId !== undefined) {
    mkdirSync(join(xdgConfig, 'llm-learning-cards'), { recursive: true });
    writeFileSync(join(xdgConfig, 'llm-learning-cards', 'vault.json'), JSON.stringify({ learning_dir: dir, vault_id: vaultId }), 'utf8');
    writeFileSync(join(dir, 'config/vault-id'), `${vaultId}\n`, 'utf8');
  }
  if (opts.dailyCap !== undefined) {
    const path = join(dir, 'config/settings.yaml');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^daily_cap:.*$/m, `daily_cap: ${opts.dailyCap}`), 'utf8');
  }
  ensureCards(vault, opts.cards ?? 3);
  return vault;
}

export function removeVault(vault: Vault): void {
  rmSync(vault.scratch, { recursive: true, force: true });
}

/** 讓磁碟上有 sec-0001..sec-000n 的卡片與考題(第 4 張起複製 sec-0001,題幹前面加 [id],從題幹認得出是哪一張)。 */
export function ensureCards(vault: Vault, n: number): string[] {
  const ids: string[] = [];
  for (let i = 1; i <= n; i += 1) {
    const id = cardIdOf(i);
    ids.push(id);
    if (existsSync(join(vault.dir, 'questions', `${id}.yaml`))) continue;
    const card = readFileSync(join(vault.dir, 'cards/security', `${TEMPLATE_CARD}.md`), 'utf8').replace(`id: ${TEMPLATE_CARD}`, `id: ${id}`);
    writeFileSync(join(vault.dir, 'cards/security', `${id}.md`), card, 'utf8');
    const q = parseYaml(readFileSync(join(vault.dir, 'questions', `${TEMPLATE_CARD}.yaml`), 'utf8')) as {
      card: string;
      fill: { prompt: string }[];
      apply: { prompt: string }[];
    };
    q.card = id;
    for (const f of q.fill) f.prompt = `[${id}] ${f.prompt}`;
    for (const a of q.apply) a.prompt = `[${id}] ${a.prompt}`;
    writeFileSync(join(vault.dir, 'questions', `${id}.yaml`), JSON.stringify(q, null, 2), 'utf8');
  }
  // fixture 原本的三張卡題幹沒有 [id] 前綴,補上,讓每張卡的題幹都認得出來
  for (const id of ['sec-0001', 'sec-0002', 'sec-0003']) {
    const path = join(vault.dir, 'questions', `${id}.yaml`);
    if (!existsSync(path)) continue;
    const q = parseYaml(readFileSync(path, 'utf8')) as { fill: { prompt: string }[]; apply: { prompt: string }[] };
    if (q.fill[0]!.prompt.startsWith(`[${id}]`)) continue;
    for (const f of q.fill) f.prompt = `[${id}] ${f.prompt}`;
    for (const a of q.apply) a.prompt = `[${id}] ${a.prompt}`;
    writeFileSync(path, JSON.stringify({ card: id, ...q }, null, 2), 'utf8');
  }
  return ids;
}

// ---------------------------------------------------------------- reviews.json

export interface HistoryEntry {
  date: string;
  stage: number;
  type: 'fill' | 'apply';
  pass: boolean;
  grader: string;
  revised_by?: 'cloud';
  revised_to?: boolean;
}

export interface ReviewRecord {
  stage: number;
  learned_at: string;
  next_due: string;
  fails_in_row: number;
  total_fails: number;
  stuck: boolean;
  history: HistoryEntry[];
}

export function reviewRecord(over: Partial<ReviewRecord> & Pick<ReviewRecord, 'next_due'>): ReviewRecord {
  return { stage: 1, learned_at: '2026-08-01', fails_in_row: 0, total_fails: 0, stuck: false, history: [], ...over };
}

export function reviewsPath(vault: Vault): string {
  return join(vault.dir, 'state/reviews.json');
}

export function readReviews(vault: Vault): Record<string, ReviewRecord> {
  return JSON.parse(readFileSync(reviewsPath(vault), 'utf8')) as Record<string, ReviewRecord>;
}

export function writeReviews(vault: Vault, reviews: Record<string, ReviewRecord>): void {
  writeFileSync(reviewsPath(vault), `${JSON.stringify(reviews, null, 2)}\n`, 'utf8');
}

/**
 * 把 ids 設成 stage 1、已到期:`overdue[i]` 是第 i 張逾期幾天(今天算 0)。
 * 各張逾期天數不同,所以 04 排出來的順序是固定的(逾期多的在前),重建一定會看得出差別。
 * 已存在的其他卡片紀錄保留。
 */
export function seedDue(vault: Vault, ids: string[], overdue: number[], today = TODAY): void {
  const reviews = existsSync(reviewsPath(vault)) ? readReviews(vault) : {};
  ids.forEach((id, i) => {
    reviews[id] = reviewRecord({ next_due: addDays(today, -(overdue[i] ?? 0)) });
  });
  writeReviews(vault, reviews);
}

// ---------------------------------------------------------------- 觀測:快取、帳本事件

/** 快取根(`${XDG_CACHE_HOME:-~/.cache}` 的 llm-learning-cards 那一層),給定環境值。 */
export function cacheBase(vault: Vault, env: { xdgCache?: string | undefined; home?: string } = {}): string {
  const xdg = 'xdgCache' in env ? env.xdgCache : vault.xdgCache;
  const root = xdg !== undefined && xdg !== '' ? xdg : join(env.home ?? vault.home, '.cache');
  return join(root, 'llm-learning-cards');
}

/** 這本帳本的快取資料夾(有 vault-id 就用它;沒有就由呼叫端傳 folder)。 */
export function cacheDir(vault: Vault, folder?: string): string {
  const name = folder ?? vault.vaultId;
  if (name === undefined) throw new Error('這個 vault 沒有 vault-id,請傳 folder(path-…)');
  return join(cacheBase(vault), name);
}

export function cachePath(vault: Vault, date = TODAY, folder?: string): string {
  return join(cacheDir(vault, folder), `session-${date}.json`);
}

export function readCache(vault: Vault, date = TODAY, folder?: string): Record<string, unknown> {
  return JSON.parse(readFileSync(cachePath(vault, date, folder), 'utf8')) as Record<string, unknown>;
}

export interface CacheShape {
  version: number;
  date: string;
  paused: boolean;
  total_due: number;
  deferred: number;
  queue: { card: string; stage: number; overdue_days: number; overdue_ratio: number }[];
  reteach: string[];
}

export function cacheQueueCards(vault: Vault, date = TODAY): string[] {
  return (readCache(vault, date) as unknown as CacheShape).queue.map((q) => q.card);
}

export function ledgerEvents(vault: Vault): Record<string, unknown>[] {
  const path = join(vault.dir, 'state/log.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** 目錄樹所有檔案的相對路徑(排序過),用來證明「learning/ 底下沒有多出任何檔案」。 */
export function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full.slice(root.length + 1));
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

export function treeBytes(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of listTree(root)) out[rel] = readFileSync(join(root, rel)).toString('base64');
  return out;
}

export function mtimeMs(path: string): number {
  return statSync(path).mtimeMs;
}

export function linkTo(vault: Vault, name = 'learning-link'): string {
  const link = join(vault.scratch, name);
  symlinkSync(vault.dir, link);
  return link;
}

// ---------------------------------------------------------------- git

function git(dir: string, args: string[]): string {
  const r = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失敗:${r.stderr}`);
  return r.stdout.trim();
}

/** 讓 learning 目錄成為它自己的 git repo,並把目前所有東西 commit 成 init。 */
export function gitInit(vault: Vault): void {
  git(vault.dir, ['init', '-q']);
  writeFileSync(join(vault.dir, '.gitignore'), '*.tmp\n', 'utf8');
  git(vault.dir, ['add', '-A']);
  git(vault.dir, ['-c', 'user.name=t17', '-c', 'user.email=t17@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
}

export function commitCount(vault: Vault): number {
  return Number(git(vault.dir, ['rev-list', '--count', 'HEAD']));
}

export function headSha(vault: Vault): string {
  return git(vault.dir, ['rev-parse', 'HEAD']);
}

export function headFiles(vault: Vault): string[] {
  return git(vault.dir, ['show', '--name-only', '--format=', 'HEAD'])
    .split('\n')
    .filter((l) => l !== '');
}

export function headMessage(vault: Vault): string {
  return git(vault.dir, ['log', '-1', '--format=%s']);
}

export function trackedFiles(vault: Vault): string[] {
  return git(vault.dir, ['ls-files']).split('\n').filter((l) => l !== '');
}

/** commit 完成的那一刻(hook 跑的時間,ns)寫進 stampFile;hook 先睡 0.3 秒,讓「輸出先到、commit 後到」的先後看得出來。 */
export function installPostCommitStamp(vault: Vault, stampFile: string): void {
  const hook = join(vault.dir, '.git/hooks/post-commit');
  writeFileSync(hook, `#!/bin/sh\nsleep 0.3\ndate +%s%N > '${stampFile}'\n`, { mode: 0o755 });
}

/** commit 一律失敗的 hook(模擬 git 出錯)。 */
export function installFailingPreCommit(vault: Vault): void {
  writeFileSync(join(vault.dir, '.git/hooks/pre-commit'), '#!/bin/sh\necho "t17 hook: refuse" >&2\nexit 1\n', { mode: 0o755 });
}

// ---------------------------------------------------------------- 跑真的 scripts/review.ts

export interface Asked {
  index: number;
  total: number;
  card: string;
}

export interface RunOut {
  status: number | null;
  stdout: string;
  stderr: string;
  output: string;
  /** 依出現順序,每個「(i/n) [卡片 id] 題幹」行 */
  asked: Asked[];
  /** stdout 每一塊到達的時間(ms),用來比先後 */
  chunks: { t: number; text: string }[];
}

export interface RunOpts {
  /** 預設 ['--dir', vault.dir, '--today', today] 之後再加這些 */
  args?: string[];
  /** 不給 --dir / --today 的完整參數(給用法錯誤的測試),給了就忽略 args 與 today */
  rawArgs?: string[];
  today?: string;
  /** 答幾題後離開(關掉 stdin):數字 = 答完這麼多題,看到下一題的提示就關;'all' = 一路答到結束。預設 'all' */
  answers?: number | 'all';
  /** 第幾題(0 起算)故意答錯 */
  wrongAt?: number[];
  /** 應用題要送出的文字(含 PASSALL / GARBAGE 之類的標記);預設 PASSALL */
  applyText?: string;
  /** 覆蓋環境變數;undefined = 刪掉那個變數 */
  env?: Record<string, string | undefined>;
  /** 不帶 --dir(給 rawArgs 以外的情況用不到,保留) */
  timeoutMs?: number;
  /**
   * 送出第 index 題(0 起算)的答案之前先跑這個(T26:在 session 建立之後、送出之前改寫磁碟上的 reviews.json)。
   * 跑完才送答案;沒給就跟以前一樣。
   */
  beforeAnswer?: (info: { index: number; card: string }) => void | Promise<void>;
}

function fillAnswerFor(vault: Vault, card: string, wrong: boolean): string {
  const q = parseYaml(readFileSync(join(vault.dir, 'questions', `${card}.yaml`), 'utf8')) as { fill: { prompt: string; answers: string[][] }[] };
  const fill = q.fill[0]!;
  return fill.answers.map((group) => (wrong ? 'wrong' : group[0]!)).join(',');
}

export function parseAsked(stdout: string): Asked[] {
  const out: Asked[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^\((\d+)\/(\d+)\) \[(sec-\d+)\]/.exec(line);
    if (m) out.push({ index: Number(m[1]), total: Number(m[2]), card: m[3]! });
  }
  return out;
}

export function childEnv(vault: Vault, over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _drop, XDG_CACHE_HOME: _c, XDG_CONFIG_HOME: _g, HOME: _h, ...rest } = process.env;
  const env: NodeJS.ProcessEnv = {
    ...rest,
    HOME: vault.home,
    XDG_CONFIG_HOME: vault.xdgConfig,
    XDG_CACHE_HOME: vault.xdgCache,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    LLM_CLOUD_PROVIDER: 'openai',
    LLM_CLOUD_MODEL: 'fake-model',
    OPENAI_API_KEY: 'fake-key',
    ANTHROPIC_API_KEY: 'fake-key',
    TSX_TSCONFIG_PATH: join(ROOT, 'tsconfig.json'),
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

/** 子程序的工作目錄:一個空的暫存目錄,不是 repo 根——快取路徑若退化成相對路徑,會長在這裡,看得出來。 */
export function runCwd(vault: Vault): string {
  const cwd = join(vault.scratch, 'cwd');
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

/**
 * 跑一次 `scripts/review.ts`。stdin 不能一次灌完(readline 在兩題之間會丟行),所以看到提示字才送下一題。
 * 沒有題目時(暫停、dry-run、沒有到期)程式自己結束,stdin 也一併關掉。
 */
export async function runReview(vault: Vault, opts: RunOpts = {}): Promise<RunOut> {
  const today = opts.today ?? TODAY;
  const args = opts.rawArgs ?? ['--dir', vault.dir, '--today', today, ...(opts.args ?? [])];
  const limit = opts.answers ?? 'all';
  const wrongAt = new Set(opts.wrongAt ?? []);
  const child = spawn(process.execPath, ['--import', TSX_LOADER, '--import', FAKE_CLOUD, REVIEW_SCRIPT, ...args], {
    cwd: runCwd(vault),
    env: childEnv(vault, opts.env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const chunks: { t: number; text: string }[] = [];
  let answered = 0;
  let prompts = 0;
  let writing = Promise.resolve();
  let closed = false;

  const countPrompts = (): number => stdout.split(FILL_PROMPT_MARK).length - 1 + (stdout.split(APPLY_PROMPT_MARK).length - 1);
  const closeStdin = (): void => {
    if (closed) return;
    closed = true;
    writing = writing.then(() => {
      child.stdin.end();
    });
  };
  const feed = (): void => {
    const now = countPrompts();
    while (prompts < now) {
      prompts += 1;
      if (limit !== 'all' && answered >= limit) {
        closeStdin();
        return;
      }
      const lines = stdout.split('\n').filter((l) => /^\(\d+\/\d+\) \[sec-\d+\]/.test(l));
      const last = lines[lines.length - 1];
      const card = last ? /\[(sec-\d+)\]/.exec(last)![1]! : '';
      const isApply = stdout.lastIndexOf(APPLY_PROMPT_MARK) > stdout.lastIndexOf(FILL_PROMPT_MARK);
      const index = answered;
      answered += 1;
      writing = writing.then(async () => {
        if (opts.beforeAnswer) await opts.beforeAnswer({ index, card });
        if (isApply) {
          child.stdin.write(`${opts.applyText ?? 'PASSALL'}\n`);
          await new Promise((r) => setTimeout(r, 150));
          child.stdin.write('\n');
        } else {
          child.stdin.write(`${fillAnswerFor(vault, card, wrongAt.has(index))}\n`);
        }
      });
    }
  };

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    chunks.push({ t: Date.now(), text });
    stdout += text;
    feed();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  child.stdin.on('error', () => {
    /* 子程序先結束了,寫入失敗不是這裡要報的 */
  });

  const status = await new Promise<number | null>((resolveStatus) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolveStatus(null);
    }, opts.timeoutMs ?? 90_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveStatus(code);
    });
    // 沒有要互動的執行(暫停、dry-run……)不會有提示;關掉 stdin,免得程式意外讀 stdin 時卡住
    if (opts.rawArgs !== undefined || (opts.args ?? []).some((a) => ['--dry-run', '--pause'].includes(a))) closeStdin();
  });
  return { status, stdout, stderr, output: stdout + stderr, asked: parseAsked(stdout), chunks };
}

/** 全部答完才結束的執行。 */
export async function runToEnd(vault: Vault, opts: RunOpts = {}): Promise<RunOut> {
  return runReview(vault, { ...opts, answers: 'all' });
}

/** 看到第一題就離開(建立當日快取、什麼都沒答)。 */
export async function runAndQuit(vault: Vault, opts: RunOpts = {}): Promise<RunOut> {
  return runReview(vault, { ...opts, answers: 0 });
}
