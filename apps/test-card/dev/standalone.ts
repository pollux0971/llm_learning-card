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
}

function attachLines(child: ChildProcessWithoutNullStreams): LineWaiter {
  const lines: string[] = [];
  let tail = '';
  let waiter: (() => void) | undefined;
  let failed: Error | undefined;
  const wake = (): void => {
    const current = waiter;
    waiter = undefined;
    current?.();
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
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
        if (child.exitCode !== null) throw new Error('側車已經結束');
        const left = deadline - Date.now();
        if (left <= 0) throw new Error('側車沒有在時限內回覆');
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
      if (line === undefined) throw new Error('側車沒有在時限內回覆');
      return line;
    },
  };
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
  child.stderr.resume();
  child.stdin.on('error', () => {
    /* 側車先結束時寫入失敗,由下一行的逾時或結束回報 */
  });
  const lines = attachLines(child);
  let closed = false;
  let chain: Promise<unknown> = Promise.resolve();

  try {
    await lines.nextLine(HELLO_TIMEOUT_MS);
  } catch (err) {
    child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
    throw err;
  }

  async function writeAndRead(line: string): Promise<string> {
    if (closed || child.exitCode !== null) throw new Error('側車已經結束');
    const payload = line.endsWith('\n') ? line : `${line}\n`;
    child.stdin.write(payload);
    return lines.nextLine(REQUEST_TIMEOUT_MS);
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
    lines.fail(new Error('側車已經結束'));
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
