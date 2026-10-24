/**
 * 教學卡單獨執行(ADR-022、ADR-075、ADR-077):只在 vite dev server 生效。
 * 暫存根跟 dev server 同生命。重新載入頁面不會重新種子。
 * 跟考試卡同一支側車,跑在 contracts/fixtures/learning-minimal 的暫存複本上。
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

const DEV = import.meta.dirname;
const DEFAULT_ROOT = resolve(DEV, '../../..');
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

function sidecarEnv(root: string): Record<string, string> {
  const env: Record<string, string> = {
    HOME: join(root, 'home'),
    XDG_CONFIG_HOME: join(root, 'xdg-config'),
    XDG_CACHE_HOME: join(root, 'xdg-cache'),
    LC_REVIEW_TODAY: TODAY,
    LLM_CLOUD_PROVIDER: 'openai',
    LLM_CLOUD_MODEL: 'fake-model',
    OPENAI_API_KEY: 'fake-key',
    ANTHROPIC_API_KEY: 'fake-key',
    GATEWAY_API_KEY: 'fake-key',
    LC_REVIEW_FAKE_CLOUD: join(DEV, 'fake-cloud.mjs'),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const path = process.env.PATH;
  if (typeof path === 'string') env.PATH = path;
  return env;
}

interface Lines {
  nextLine(timeoutMs: number): Promise<string>;
  fail(err: Error): void;
}

function attachLines(child: ChildProcessWithoutNullStreams): Lines {
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
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', () => {
    /* 不讀會把管線塞滿 */
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

export async function startStandaloneBackend(opts: { repoRoot?: string } = {}): Promise<StandaloneBackend> {
  const repoRoot = opts.repoRoot === undefined ? DEFAULT_ROOT : opts.repoRoot;
  const root = mkdtempSync(join(tmpdir(), 'teach-card-'));
  const learningDir = join(root, 'learning');
  const env = sidecarEnv(root);
  env.TSX_TSCONFIG_PATH = join(repoRoot, 'tsconfig.json');
  mkdirSync(env.HOME!, { recursive: true });
  mkdirSync(env.XDG_CONFIG_HOME!, { recursive: true });
  mkdirSync(env.XDG_CACHE_HOME!, { recursive: true });
  cpSync(join(repoRoot, 'contracts/fixtures/learning-minimal'), learningDir, { recursive: true });
  seedAsset(learningDir);

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
  child.stdin.on('error', () => {
    /* 側車先結束時寫入失敗,由下一行的逾時或結束回報 */
  });
  const lines = attachLines(child);
  let closed = false;
  let chain: Promise<unknown> = Promise.resolve();

  try {
    await lines.nextLine(HELLO_TIMEOUT_MS);
  } catch (err) {
    if (child.exitCode === null) child.kill('SIGKILL');
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

function readLearningFile(learningDir: string, relPath: string): string | undefined {
  if (relPath.length === 0 || relPath.includes('..') || relPath.startsWith('/') || relPath.includes('\\')) return undefined;
  const root = resolve(learningDir);
  const full = resolve(root, relPath);
  if (full !== root && !full.startsWith(root + sep)) return undefined;
  if (!existsSync(full)) return undefined;
  return readFileSync(full, 'utf8');
}

/** 1×1 的真 PNG。單獨執行時 assets/ 裡要有一張能用的圖。 */
const SEED_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

function seedAsset(learningDir: string): void {
  const dir = join(learningDir, 'assets');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'seed.png'), SEED_PNG);
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * 只回最上層 assets 底下的圖檔。`..` 在 resolve 之後再對一次(字串檢查被拿掉也出不去),
 * 目錄、空路徑、不是圖的副檔名都不回。
 */
function readAssetFile(learningDir: string, relPath: string): { bytes: Buffer; type: string } | undefined {
  if (relPath.length === 0 || relPath.includes('..') || relPath.includes('\\') || relPath.includes('\0') || relPath.startsWith('/')) {
    return undefined;
  }
  if (!relPath.startsWith('assets/')) return undefined;
  const root = resolve(learningDir);
  const assetsRoot = resolve(root, 'assets');
  const full = resolve(root, relPath);
  if (full === assetsRoot || !full.startsWith(assetsRoot + sep)) return undefined;
  if (!existsSync(full)) return undefined;
  let info;
  try {
    info = statSync(full);
  } catch {
    return undefined;
  }
  if (!info.isFile()) return undefined;
  const type = IMAGE_TYPES[extname(full).slice(1).toLowerCase()];
  if (!type) return undefined;
  return { bytes: readFileSync(full), type };
}

export function standalonePlugin(): Plugin {
  return {
    name: 'teach-card-standalone',
    apply: 'serve',
    async configureServer(server) {
      const backend = await startStandaloneBackend();
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const path = url.split('?')[0];
        if (path === '/__card' && req.method === 'GET') {
          const query = new URL(url, 'http://127.0.0.1').searchParams.get('path') ?? '';
          const text = readLearningFile(backend.learningDir, query);
          if (text === undefined) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end(text);
          return;
        }
        if (path === '/__asset') {
          if (req.method !== 'GET') {
            res.statusCode = 404;
            res.end();
            return;
          }
          const query = new URL(url, 'http://127.0.0.1').searchParams.get('path') ?? '';
          const file = readAssetFile(backend.learningDir, query);
          if (!file) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-type', file.type);
          res.setHeader('content-length', String(file.bytes.length));
          res.end(file.bytes);
          return;
        }
        if (path !== '/__review') {
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
      server.httpServer?.on('close', () => {
        void backend.close();
      });
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
