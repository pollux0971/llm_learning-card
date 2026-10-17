/**
 * 考試卡單獨執行(ADR-022、ADR-075):只在 vite dev server 生效。
 * 暫存根跟 dev server 同生命。重新載入頁面不會重新種子。
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const DEV = import.meta.dirname;
const DEFAULT_ROOT = resolve(DEV, '../../..');
const FAKE_CLOUD = join(DEV, 'fake-cloud.mjs');
const SEED = join(DEV, 'reviews.seed.json');
const TODAY = '2026-09-10';
const HELLO_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 60_000;
const STDERR_KEEP = 20;
const TIMEOUT_PHRASE = '側車沒有在時限內回覆';
const EXITED_PHRASE = '側車已經結束';
const RETIRED_PHRASE = '先前逾時,側車已收掉';

export interface StandaloneBackend {
  root: string;
  learningDir: string;
  sidecarEnv: Record<string, string | undefined>;
  sidecarPid: number | undefined;
  request(line: string): Promise<string>;
  close(): Promise<void>;
}

interface LineWaiter {
  nextLine(timeoutMs: number): Promise<string>;
  fail(err: Error): void;
  /** 丟掉已到、還沒被取走的行,避免逾時後晚到的那一行被下一個請求拿走。 */
  discard(): void;
}

interface StderrRing {
  last(n: number): string[];
}

/** 持續讀 stderr,只留最後幾行。不讀的話管線會塞滿,側車卡住。 */
function attachStderr(child: ChildProcessWithoutNullStreams): StderrRing {
  const buf: string[] = [];
  let tail = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    tail += chunk;
    let at = tail.indexOf('\n');
    while (at >= 0) {
      buf.push(tail.slice(0, at));
      if (buf.length > STDERR_KEEP) buf.shift();
      tail = tail.slice(at + 1);
      at = tail.indexOf('\n');
    }
  });
  return {
    last(n: number): string[] {
      const all = tail.length > 0 ? [...buf, tail] : [...buf];
      return all.slice(-n);
    },
  };
}

function attachLines(child: ChildProcessWithoutNullStreams): LineWaiter {
  const lines: string[] = [];
  let tail = '';
  let waiter: (() => void) | undefined;
  let failed: Error | undefined;
  let ignore = false;
  const wake = (): void => {
    const current = waiter;
    waiter = undefined;
    current?.();
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (ignore) return;
    tail += chunk;
    let at = tail.indexOf('\n');
    while (at >= 0) {
      lines.push(tail.slice(0, at));
      tail = tail.slice(at + 1);
      at = tail.indexOf('\n');
    }
    wake();
  });
  child.on('close', () => wake());
  return {
    fail(err: Error): void {
      failed = err;
      wake();
    },
    async nextLine(timeoutMs: number): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (lines.length === 0) {
        if (failed) throw failed;
        if (child.exitCode !== null) throw new Error(EXITED_PHRASE);
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(TIMEOUT_PHRASE);
        await new Promise<void>((resolveWait) => {
          const timer = setTimeout(() => {
            waiter = undefined;
            resolveWait();
          }, left);
          waiter = () => {
            clearTimeout(timer);
            resolveWait();
          };
        });
      }
      const line = lines.shift();
      if (line === undefined) throw new Error(TIMEOUT_PHRASE);
      return line;
    },
    discard(): void {
      lines.length = 0;
      tail = '';
      ignore = true;
    },
  };
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.message === TIMEOUT_PHRASE;
}

function methodOf(line: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return '(不是 JSON)';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return '(沒有 method)';
  const method = (parsed as { method?: unknown }).method;
  if (typeof method !== 'string' || method.length === 0) return '(沒有 method)';
  return method;
}

function sidecarEnv(root: string): { env: Record<string, string>; home: string; xdgConfig: string; xdgCache: string } {
  const home = join(root, 'home');
  const xdgConfig = join(root, 'xdg-config');
  const xdgCache = join(root, 'xdg-cache');
  const env: Record<string, string> = {
    HOME: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
    LC_REVIEW_FAKE_CLOUD: FAKE_CLOUD,
    LC_REVIEW_TODAY: TODAY,
    LLM_CLOUD_PROVIDER: 'openai',
    LLM_CLOUD_MODEL: 'fake-model',
    OPENAI_API_KEY: 'fake-key',
    ANTHROPIC_API_KEY: 'fake-key',
    GATEWAY_API_KEY: 'fake-key',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const path = process.env.PATH;
  if (typeof path === 'string') env.PATH = path;
  return { env, home, xdgConfig, xdgCache };
}

export async function startStandaloneBackend(opts: { repoRoot?: string } = {}): Promise<StandaloneBackend> {
  const repoRoot = opts.repoRoot === undefined ? DEFAULT_ROOT : opts.repoRoot;
  const root = mkdtempSync(join(tmpdir(), 'test-card-'));
  const learningDir = join(root, 'learning');
  const built = sidecarEnv(root);
  const env = built.env;
  env.TSX_TSCONFIG_PATH = join(repoRoot, 'tsconfig.json');
  mkdirSync(built.home, { recursive: true });
  mkdirSync(built.xdgConfig, { recursive: true });
  mkdirSync(built.xdgCache, { recursive: true });
  cpSync(join(repoRoot, 'contracts/fixtures/learning-minimal'), learningDir, { recursive: true });
  cpSync(SEED, join(learningDir, 'state/reviews.json'));

  const tsx = join(repoRoot, 'node_modules/tsx/dist/esm/index.mjs');
  const vault = spawnSync(process.execPath, ['--import', tsx, join(repoRoot, 'scripts/vault.ts'), 'init', '--learning-dir', learningDir], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  if (vault.status !== 0) {
    rmSync(root, { recursive: true, force: true });
    throw new Error('帳本身分初始化失敗');
  }

  const child = spawn(process.execPath, ['--import', tsx, join(repoRoot, 'scripts/review-sidecar.ts'), '--dir', learningDir], {
    cwd: repoRoot,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  const stderrRing = attachStderr(child);
  child.stdin.on('error', () => {
    /* 側車先結束時寫入失敗,由下一行的逾時或結束回報 */
  });
  const lines = attachLines(child);
  let closed = false;
  let retired: Error | undefined;
  let chain: Promise<unknown> = Promise.resolve();

  function timeoutDetail(where: string, waitedMs: number): string {
    const alive = child.exitCode === null && child.killed !== true;
    const code = child.exitCode === null ? 'null' : String(child.exitCode);
    const tail = stderrRing.last(STDERR_KEEP);
    return [
      TIMEOUT_PHRASE,
      `卡在 ${where}`,
      `等了 ${waitedMs} 毫秒`,
      `側車還活著: ${String(alive)}`,
      `exitCode: ${code}`,
      `killed: ${String(child.killed)}`,
      'stderr 最後 20 行:',
      ...tail,
    ].join('\n');
  }

  /** 逾時後收掉側車。這一筆帶診斷;之後的請求立刻失敗,不再各等 60 秒,也不拿走晚到的那一行。 */
  function retire(where: string, waitedMs: number): Error {
    const detail = new Error(timeoutDetail(where, waitedMs));
    console.error(`[standalone] ${detail.message}`);
    if (retired === undefined) {
      retired = new Error(RETIRED_PHRASE);
      lines.discard();
      lines.fail(retired);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    return detail;
  }

  const helloStarted = Date.now();
  try {
    await lines.nextLine(HELLO_TIMEOUT_MS);
  } catch (err) {
    if (isTimeout(err)) {
      const detail = new Error(timeoutDetail('hello', Date.now() - helloStarted));
      console.error(`[standalone] ${detail.message}`);
      child.kill('SIGKILL');
      rmSync(root, { recursive: true, force: true });
      throw detail;
    }
    child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
    throw err;
  }

  async function writeAndRead(line: string): Promise<string> {
    const method = methodOf(line);
    const started = Date.now();
    if (retired) {
      console.error(`[standalone] ${method} 0ms 失敗`);
      throw retired;
    }
    if (closed || child.exitCode !== null) throw new Error(EXITED_PHRASE);
    const payload = line.endsWith('\n') ? line : `${line}\n`;
    child.stdin.write(payload);
    try {
      const reply = await lines.nextLine(REQUEST_TIMEOUT_MS);
      console.error(`[standalone] ${method} ${Date.now() - started}ms`);
      return reply;
    } catch (err) {
      const waited = Date.now() - started;
      console.error(`[standalone] ${method} ${waited}ms 失敗`);
      if (isTimeout(err)) throw retire(method, waited);
      throw err;
    }
  }

  function request(line: string): Promise<string> {
    const runRequest = chain.then(() => writeAndRead(line));
    chain = runRequest.then(
      () => undefined,
      () => undefined,
    );
    return runRequest;
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    lines.fail(new Error(EXITED_PHRASE));
    if (child.exitCode === null) {
      child.stdin.end();
      child.kill('SIGTERM');
    }
    await new Promise<void>((resolveExit) => {
      if (child.exitCode !== null) {
        resolveExit();
        return;
      }
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolveExit();
      }, 1500);
      child.once('close', () => {
        clearTimeout(timer);
        resolveExit();
      });
    });
    rmSync(root, { recursive: true, force: true });
  }

  return {
    root,
    learningDir,
    sidecarEnv: env,
    sidecarPid: child.pid,
    request,
    close,
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function standalonePlugin(): Plugin {
  return {
    name: 'test-card-standalone',
    apply: 'serve',
    async configureServer(server) {
      const backend = await startStandaloneBackend();
      server.middlewares.use((req, res, next) => {
        const url = req.url;
        if (typeof url !== 'string' || url.split('?')[0] !== '/__review') {
          next();
          return;
        }
        if (req.method !== 'POST') {
          req.resume();
          res.statusCode = 405;
          res.end();
          return;
        }
        void handlePost(backend, req, res);
      });
      const cleanup = (): void => {
        void backend.close();
      };
      server.httpServer?.on('close', cleanup);
    },
  };
}

async function handlePost(backend: StandaloneBackend, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const line = await backend.request(body);
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(line);
  } catch {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('複習程式停了。');
    }
  }
}
