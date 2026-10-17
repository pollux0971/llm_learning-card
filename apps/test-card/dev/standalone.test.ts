/**
 * T24 驗收 5(單獨執行,ADR-022,`npm run dev -w apps/test-card`)。紅測試作者寫;開發 worker 不改。
 *
 * `apps/test-card/dev/standalone.ts` 工單只說「一個只在 dev server 生效的 plugin」。這份測試固定它的匯出(開發 worker 照做):
 *
 *   startStandaloneBackend(opts?: { repoRoot?: string }): Promise<StandaloneBackend>
 *     StandaloneBackend = {
 *       root: string;                       // mkdtemp 開的暫存根(在 os.tmpdir() 底下)
 *       learningDir: string;                // <root>/learning(learning-minimal 的複本,state/reviews.json 換成 dev/reviews.seed.json)
 *       sidecarEnv: Record<string, string | undefined>;   // 起側車用的環境(含 LC_REVIEW_FAKE_CLOUD、LC_REVIEW_TODAY、暫存的 HOME / XDG_*)
 *       sidecarPid: number | undefined;     // 側車行程 id
 *       request(line: string): Promise<string>;           // 一行進、一行出(不含換行)
 *       close(): Promise<void>;             // 收掉側車、刪暫存根
 *     }
 *   standalonePlugin(): import('vite').Plugin   // name 隨意;只在 dev server(apply: 'serve');POST /__review → request(body);server 關掉時 close()
 *
 * 暫存根跟 dev server 同生命(工單 §5):重新載入頁面不會重新種子。
 * 暫存根要自己做:複製 contracts/fixtures/learning-minimal、`npx tsx scripts/vault.ts init --learning-dir <暫存 learning>`
 * (暫存的 HOME / XDG_CONFIG_HOME / XDG_CACHE_HOME)、起 scripts/review-sidecar.ts。這個檔跑一次要幾秒(起行程)。
 *
 * 不寫 contracts/fixtures/ 本身;一律假 router(LC_REVIEW_FAKE_CLOUD 指到 dev/fake-cloud.mjs 的絕對路徑);不打網路、不 live。
 * 模組還沒寫:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const DEV = import.meta.dirname;
const APP = resolve(DEV, '..');
const ROOT = resolve(APP, '../..');
const FIXTURES = join(ROOT, 'contracts/fixtures');
const STANDALONE = pathToFileURL(join(DEV, 'standalone.ts')).href;
const FAKE_CLOUD = join(DEV, 'fake-cloud.mjs');
const SEED = join(DEV, 'reviews.seed.json');

type Obj = Record<string, unknown>;
interface Backend {
  root: string;
  learningDir: string;
  sidecarEnv: Record<string, string | undefined>;
  sidecarPid: number | undefined;
  request(line: string): Promise<string>;
  close(): Promise<void>;
}
interface Mod {
  startStandaloneBackend(opts?: { repoRoot?: string }): Promise<Backend>;
  standalonePlugin(): { name: string; apply?: unknown; configureServer?: unknown };
}
async function load(): Promise<Mod> {
  const mod = (await import(/* @vite-ignore */ STANDALONE)) as Partial<Mod>;
  for (const name of ['startStandaloneBackend', 'standalonePlugin'] as const) {
    if (typeof mod[name] !== 'function') throw new Error(`apps/test-card/dev/standalone.ts 沒有匯出 ${name}`);
  }
  return mod as Mod;
}

function digestTree(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        h.update(relative(dir, full));
        h.update(readFileSync(full));
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sidecarPids(): number[] {
  const out: number[] = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const cmd = readFileSync(`/proc/${name}/cmdline`, 'utf8');
      if (cmd.includes('review-sidecar')) out.push(Number(name));
    } catch {
      /* 行程已經消失 */
    }
  }
  return out;
}

const open: Backend[] = [];
afterAll(async () => {
  for (const b of open) await b.close().catch(() => undefined);
});
async function backend(): Promise<Backend> {
  const mod = await load();
  const b = await mod.startStandaloneBackend();
  open.push(b);
  return b;
}

let nextId = 1;
async function call(b: Backend, method: string, params: Obj = {}): Promise<Obj> {
  const line = await b.request(JSON.stringify({ v: 1, id: nextId++, method, params }));
  expect(line, '回的是一行(不含換行)').not.toContain('\n');
  return JSON.parse(line) as Obj;
}
const result = (r: Obj): Obj => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.result as Obj;
};

describe('種子與假雲端的檔', () => {
  it('dev/reviews.seed.json:三張卡(stage 1、2、3 各一),2026-09-10 都到期,fails_in_row 都是 0(不會出現 reteach)', () => {
    expect(existsSync(SEED), '缺 apps/test-card/dev/reviews.seed.json').toBe(true);
    const seed = JSON.parse(readFileSync(SEED, 'utf8')) as Record<string, { stage: number; next_due: string | null; fails_in_row: number }>;
    const rows = Object.values(seed);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.stage).sort()).toEqual([1, 2, 3]);
    for (const r of rows) {
      expect(r.next_due && r.next_due <= '2026-09-10', `${r.next_due} 要 ≤ 2026-09-10`).toBe(true);
      expect(r.fails_in_row).toBe(0);
    }
    for (const id of Object.keys(seed)) expect(existsSync(join(FIXTURES, 'learning-minimal/cards/security', `${id}.md`)), `${id} 要是 learning-minimal 的卡`).toBe(true);
  });

  it('dev/fake-cloud.mjs 存在、是 .mjs,不 import features/ 底下的檔', () => {
    expect(existsSync(FAKE_CLOUD), '缺 apps/test-card/dev/fake-cloud.mjs').toBe(true);
    const src = readFileSync(FAKE_CLOUD, 'utf8');
    expect(src).toMatch(/globalThis\.fetch\s*=/);
    expect(src).not.toMatch(/from\s+['"][^'"]*features\//);
    expect(src).not.toMatch(/import\s*\(\s*['"][^'"]*features\//);
  });
});

describe('暫存根(驗收 5 第 1、2 點、「不寫 contracts/fixtures」)', () => {
  it('暫存根在 os.tmpdir() 底下、不在 contracts/fixtures/ 底下;learning 是 learning-minimal 的複本', async () => {
    const before = digestTree(FIXTURES);
    const b = await backend();
    expect(b.root.startsWith(tmpdir() + sep) || b.root.startsWith(resolve(tmpdir()) + sep)).toBe(true);
    expect(b.learningDir).toBe(join(b.root, 'learning'));
    expect(b.learningDir.startsWith(FIXTURES)).toBe(false);
    expect(b.root.startsWith(FIXTURES)).toBe(false);
    expect(existsSync(join(b.learningDir, 'cards/security/sec-0001.md'))).toBe(true);
    expect(digestTree(FIXTURES), 'contracts/fixtures 不該有任何變動').toBe(before);
  }, 120_000);

  it('state/reviews.json 是種子檔的內容(不是 fixture 的 {})', async () => {
    const b = await backend();
    expect(JSON.parse(readFileSync(join(b.learningDir, 'state/reviews.json'), 'utf8'))).toEqual(JSON.parse(readFileSync(SEED, 'utf8')));
  }, 120_000);

  it('帳本身分標記已初始化(vault.ts init 在暫存的 HOME / XDG 底下做的)', async () => {
    const b = await backend();
    expect(existsSync(join(b.learningDir, 'config/vault-id'))).toBe(true);
    const home = b.sidecarEnv.HOME ?? '';
    const cfg = b.sidecarEnv.XDG_CONFIG_HOME ?? '';
    const cache = b.sidecarEnv.XDG_CACHE_HOME ?? '';
    for (const p of [home, cfg, cache]) {
      expect(p, '暫存的 HOME / XDG_* 要設').not.toBe('');
      expect(p.startsWith(b.root), `${p} 要在暫存根底下`).toBe(true);
    }
  }, 120_000);
});

describe('側車的環境(一律假 router)', () => {
  it('LC_REVIEW_FAKE_CLOUD 是 dev/fake-cloud.mjs 的絕對路徑;LC_REVIEW_TODAY 是 2026-09-10', async () => {
    const b = await backend();
    expect(b.sidecarEnv.LC_REVIEW_FAKE_CLOUD).toBe(FAKE_CLOUD);
    expect(b.sidecarEnv.LC_REVIEW_TODAY).toBe('2026-09-10');
  }, 120_000);

  it('側車環境沒有真的金鑰:名字像 KEY / TOKEN / SECRET 的變數,值只能是 fake- 開頭的假值(不從父行程繼承真的)', async () => {
    const b = await backend();
    const secrets = Object.entries(b.sidecarEnv).filter(([k, v]) => v !== undefined && /KEY|TOKEN|SECRET/i.test(k));
    for (const [k, v] of secrets) expect(v, `${k} 不是假值`).toMatch(/^fake/);
  }, 120_000);
});

describe('一行進、一行出(驗收 5 第 4 點)', () => {
  it('start → ready、三張、fakeCloud true(假 router 起來了)', async () => {
    const b = await backend();
    const out = result(await call(b, 'start'));
    expect(out).toMatchObject({ state: 'ready', today: '2026-09-10', total: 3, answered: 0, fakeCloud: true });
  }, 120_000);

  it('走完三張(stage 1 填空、stage 2 填空 + 應用、stage 3 應用):批改都有合法回應,沒有 status error', async () => {
    const b = await backend();
    result(await call(b, 'start'));
    const statuses: string[] = [];
    const types: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const q = result(await call(b, 'next'));
      if (q.kind === 'done') break;
      expect(q.kind).toBe('question');
      types.push(q.type as string);
      const answer = q.type === 'fill' ? { fill: Array.from({ length: q.blanks as number }, () => '隨便寫') } : { apply: '這是我的回答,說明了跨來源請求與伺服器端設定。' };
      const graded = result(await call(b, 'submit', answer));
      statuses.push(graded.status as string);
    }
    expect(types.filter((t) => t === 'apply').length).toBeGreaterThanOrEqual(2);
    expect(types.filter((t) => t === 'fill').length).toBeGreaterThanOrEqual(2);
    expect(statuses.length).toBeGreaterThanOrEqual(4);
    for (const s of statuses) expect(['passed', 'failed', 'partial'], `status ${s}`).toContain(s);
  }, 120_000);

  it('答案只落在暫存根的 reviews.json(contracts/fixtures 不動)', async () => {
    const before = digestTree(FIXTURES);
    const b = await backend();
    result(await call(b, 'start'));
    const q = result(await call(b, 'next'));
    const answer = q.type === 'fill' ? { fill: Array.from({ length: q.blanks as number }, () => 'x') } : { apply: '回答' };
    result(await call(b, 'submit', answer));
    const reviews = JSON.parse(readFileSync(join(b.learningDir, 'state/reviews.json'), 'utf8')) as Record<string, { history: unknown[] }>;
    expect(Object.values(reviews).some((r) => r.history.length > 0)).toBe(true);
    expect(digestTree(FIXTURES)).toBe(before);
  }, 120_000);
});

describe('收尾(驗收 5 第 5 點)', () => {
  it('close():側車行程不在了、暫存根刪掉了', async () => {
    const mod = await load();
    const b = await mod.startStandaloneBackend();
    const pid = b.sidecarPid;
    expect(pid, 'sidecarPid').toBeTypeOf('number');
    expect(alive(pid!)).toBe(true);
    await b.close();
    expect(existsSync(b.root)).toBe(false);
    for (let i = 0; i < 40 && alive(pid!); i += 1) await new Promise((r) => setTimeout(r, 50));
    expect(alive(pid!)).toBe(false);
  }, 120_000);

  it('close() 重複呼叫不丟錯', async () => {
    const mod = await load();
    const b = await mod.startStandaloneBackend();
    await b.close();
    await expect(b.close()).resolves.toBeUndefined();
  }, 120_000);
});

describe('plugin 掛在真的 vite dev server 上(POST /__review 往返、關掉就收)', () => {
  it('用 apps/test-card/vite.config.ts 起 dev server:POST /__review 回側車的那一行;server 關掉後側車行程與暫存根都沒了', async () => {
    const { createServer } = await import('vite');
    const pidsBefore = new Set(sidecarPids());
    const tmpBefore = new Set(readdirSync(tmpdir()));
    const server = await createServer({
      root: APP,
      configFile: join(APP, 'vite.config.ts'),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    });
    await server.listen();
    try {
      const address = server.httpServer?.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      expect(port).toBeGreaterThan(0);
      const post = async (body: string): Promise<{ status: number; text: string }> => {
        const res = await fetch(`http://127.0.0.1:${port}/__review`, { method: 'POST', body });
        return { status: res.status, text: await res.text() };
      };
      const first = await post(JSON.stringify({ v: 1, id: 1, method: 'start', params: {} }));
      expect(first.status).toBe(200);
      expect(first.text).not.toContain('\n');
      const parsed = JSON.parse(first.text) as Obj;
      expect(parsed).toMatchObject({ v: 1, id: 1, ok: true });
      expect((parsed.result as Obj).fakeCloud).toBe(true);
      const second = JSON.parse((await post(JSON.stringify({ v: 1, id: 2, method: 'next', params: {} }))).text) as Obj;
      expect((second.result as Obj).kind).toBe('question');
      // 側車真的是這個 plugin 起的
      expect(sidecarPids().filter((p) => !pidsBefore.has(p)).length).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
    const left: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      left.splice(0, left.length, ...sidecarPids().filter((p) => !pidsBefore.has(p)));
      if (left.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(left, '關掉 dev server 後側車還活著').toEqual([]);
    const leftovers = (): string[] => readdirSync(tmpdir()).filter((n) => !tmpBefore.has(n) && existsSync(join(tmpdir(), n, 'learning')));
    for (let i = 0; i < 60 && leftovers().length > 0; i += 1) await new Promise((r) => setTimeout(r, 100));
    expect(leftovers(), '關掉 dev server 後暫存根還在').toEqual([]);
  }, 120_000);

  it('重新載入頁面不會重新種子(工單 §5:暫存根跟 dev server 同生命):答過的留著,start 回續答', async () => {
    const { createServer } = await import('vite');
    const server = await createServer({ root: APP, configFile: join(APP, 'vite.config.ts'), logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
    try {
      const address = server.httpServer?.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const post = async (method: string, params: Obj = {}): Promise<Obj> => {
        const res = await fetch(`http://127.0.0.1:${port}/__review`, { method: 'POST', body: JSON.stringify({ v: 1, id: nextId++, method, params }) });
        return JSON.parse(await res.text()) as Obj;
      };
      const page = async (): Promise<void> => {
        const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: 'text/html' } });
        expect(res.status).toBe(200);
        await res.text();
      };
      await page();
      expect((await post('start')).ok).toBe(true);
      const q = (await post('next')).result as Obj;
      const answer = q.type === 'fill' ? { fill: Array.from({ length: q.blanks as number }, () => 'x') } : { apply: '回答' };
      expect(((await post('submit', answer)).result as Obj).status).toMatch(/passed|failed|partial/);
      await page(); // 重新載入
      expect((await post('start')).result).toMatchObject({ state: 'ready', total: 3, answered: 1, resumed: true });
    } finally {
      await server.close();
    }
  }, 120_000);

  it('GET /__review 只收 POST:回 405 或 404,而且側車沒收到任何一行(連 GET 帶的 body 都不轉)', async () => {
    const { createServer } = await import('vite');
    const http = await import('node:http');
    const server = await createServer({ root: APP, configFile: join(APP, 'vite.config.ts'), logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
    try {
      const address = server.httpServer?.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const startLine = JSON.stringify({ v: 1, id: nextId++, method: 'start', params: {} });
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: '/__review', method: 'GET', headers: { 'content-length': Buffer.byteLength(startLine) } }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        });
        req.on('error', reject);
        req.end(startLine);
      });
      expect([404, 405], `GET 回 ${status}`).toContain(status);
      // 側車沒收到 GET 帶的那行 start:所以現在 next 還沒有 session
      const res = await fetch(`http://127.0.0.1:${port}/__review`, { method: 'POST', body: JSON.stringify({ v: 1, id: nextId++, method: 'next', params: {} }) });
      const reply = JSON.parse(await res.text()) as { ok: boolean; error?: { kind: string } };
      expect(reply.ok).toBe(false);
      expect(reply.error?.kind).toBe('no-session');
    } finally {
      await server.close();
    }
  }, 120_000);
});
