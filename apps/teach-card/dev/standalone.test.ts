/**
 * T37 驗收「單獨執行」(ADR-022、ADR-075、ADR-077;`npm run dev -w apps/teach-card`)。測試 agent 寫;開發 worker 不改。
 * 「照 06 的做法」:`apps/test-card/dev/standalone.test.ts` 的教學卡版,範圍小一點(教學卡的動作不呼叫 LLM,不需要種子與假雲端的測試)。
 *
 * `apps/teach-card/dev/standalone.ts` 要匯出(跟 06 的同名、同形狀):
 *
 *   startStandaloneBackend(opts?: { repoRoot?: string }): Promise<StandaloneBackend>
 *     StandaloneBackend = {
 *       root: string;            // mkdtemp 開的暫存根(在 os.tmpdir() 底下)
 *       learningDir: string;     // <root>/learning:contracts/fixtures/learning-minimal 的複本(state/reviews.json 是 {}:什麼都還沒學)
 *       sidecarEnv: Record<string, string | undefined>;   // 起側車用的環境(含 LC_REVIEW_TODAY、暫存的 HOME / XDG_*)
 *       sidecarPid: number | undefined;
 *       request(line: string): Promise<string>;           // 一行進、一行出(不含換行)
 *       close(): Promise<void>;
 *     }
 *   standalonePlugin(): import('vite').Plugin   // 只在 dev server(apply: 'serve');POST /__review → request(body);server 關掉時 close()
 *
 * 暫存根跟 dev server 同生命。暫存根自己做:複製 learning-minimal、`vault.ts init`(暫存的 HOME / XDG_*)、起 scripts/review-sidecar.ts。
 * 不寫 contracts/fixtures/ 本身;不打網路、不 live。
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
    if (typeof mod[name] !== 'function') throw new Error(`apps/teach-card/dev/standalone.ts 沒有匯出 ${name}`);
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
      if (readFileSync(`/proc/${name}/cmdline`, 'utf8').includes('review-sidecar')) out.push(Number(name));
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

describe('暫存根', () => {
  it('在 os.tmpdir() 底下、不在 contracts/fixtures/ 底下;learning 是 learning-minimal 的複本,什麼都還沒學', async () => {
    const before = digestTree(FIXTURES);
    const b = await backend();
    expect(b.root.startsWith(tmpdir() + sep) || b.root.startsWith(resolve(tmpdir()) + sep)).toBe(true);
    expect(b.learningDir).toBe(join(b.root, 'learning'));
    expect(b.root.startsWith(FIXTURES)).toBe(false);
    expect(existsSync(join(b.learningDir, 'cards/security/sec-0001.md'))).toBe(true);
    expect(JSON.parse(readFileSync(join(b.learningDir, 'state/reviews.json'), 'utf8'))).toEqual({});
    expect(digestTree(FIXTURES), 'contracts/fixtures 不該有任何變動').toBe(before);
  }, 120_000);

  it('帳本身分標記已初始化;暫存的 HOME / XDG_* 都在暫存根底下;LC_REVIEW_TODAY 是 2026-09-10;沒有真的金鑰', async () => {
    const b = await backend();
    expect(existsSync(join(b.learningDir, 'config/vault-id'))).toBe(true);
    for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']) {
      const p = b.sidecarEnv[key] ?? '';
      expect(p, `${key} 要設`).not.toBe('');
      expect(p.startsWith(b.root), `${p} 要在暫存根底下`).toBe(true);
    }
    expect(b.sidecarEnv.LC_REVIEW_TODAY).toBe('2026-09-10');
    for (const [k, v] of Object.entries(b.sidecarEnv)) {
      if (v !== undefined && /KEY|TOKEN|SECRET/i.test(k)) expect(v, `${k} 不是假值`).toMatch(/^fake/);
    }
  }, 120_000);
});

describe('一行進、一行出:教學卡的動作', () => {
  it('teach.open:第一個類別、第一張卡;teach.next:標成學過,只落在暫存根(contracts/fixtures 不動)', async () => {
    const before = digestTree(FIXTURES);
    const b = await backend();
    const open = await call(b, 'teach.open');
    expect(open.ok, JSON.stringify(open)).toBe(true);
    const view = open.result as { category: string; card: { id: string } | null };
    expect(view.category).toBe('security');
    expect(view.card?.id).toBe('sec-0001');
    const next = await call(b, 'teach.next');
    expect(next.ok, JSON.stringify(next)).toBe(true);
    const reviews = JSON.parse(readFileSync(join(b.learningDir, 'state/reviews.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(reviews)).toEqual(['sec-0001']);
    expect(digestTree(FIXTURES)).toBe(before);
  }, 120_000);

  it("同一支側車也回考試卡的動作(status 有合法回應)", async () => {
    const b = await backend();
    const res = await call(b, 'status');
    expect(res.ok === true || res.ok === false).toBe(true);
    expect(res.v).toBe(1);
  }, 120_000);
});

describe('收尾', () => {
  it('close():側車行程不在了、暫存根刪掉了;重複呼叫不丟錯', async () => {
    const mod = await load();
    const b = await mod.startStandaloneBackend();
    const pid = b.sidecarPid;
    expect(pid, 'sidecarPid').toBeTypeOf('number');
    expect(alive(pid!)).toBe(true);
    await b.close();
    expect(existsSync(b.root)).toBe(false);
    for (let i = 0; i < 40 && alive(pid!); i += 1) await new Promise((r) => setTimeout(r, 50));
    expect(alive(pid!)).toBe(false);
    await expect(b.close()).resolves.toBeUndefined();
  }, 120_000);
});

describe('plugin 掛在真的 vite dev server 上', () => {
  it('用 apps/teach-card/vite.config.ts 起 dev server:POST /__review 回側車的那一行;server 關掉後側車行程與暫存根都沒了', async () => {
    const { createServer } = await import('vite');
    const pidsBefore = new Set(sidecarPids());
    const tmpBefore = new Set(readdirSync(tmpdir()));
    const server = await createServer({
      configFile: join(APP, 'vite.config.ts'),
      root: APP,
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, ws: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    await server.listen();
    const address = server.httpServer?.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      expect(port).toBeGreaterThan(0);
      const post = async (method: string, params: Obj = {}): Promise<{ status: number; body: Obj; text: string }> => {
        const res = await fetch(`http://127.0.0.1:${port}/__review`, {
          method: 'POST',
          body: JSON.stringify({ v: 1, id: nextId++, method, params }),
          signal: AbortSignal.timeout(60_000),
        });
        const text = await res.text();
        return { status: res.status, body: JSON.parse(text) as Obj, text };
      };
      const first = await post('teach.open');
      expect(first.status).toBe(200);
      expect(first.text).not.toContain('\n');
      expect(first.body).toMatchObject({ v: 1, ok: true });
      expect(((first.body.result as Obj).card as Obj).id).toBe('sec-0001');
      const second = await post('teach.next');
      expect(second.body.ok, second.text).toBe(true);
      expect(sidecarPids().filter((p) => !pidsBefore.has(p)).length).toBeGreaterThan(0);
      // 重新載入頁面不會重新種子:剛才學過的留著(再開一次,第一張已經不是 sec-0001)
      const page = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(60_000) });
      expect(page.status).toBe(200);
      const again = await post('teach.open');
      expect(((again.body.result as Obj).card as Obj).id).toBe('sec-0002');
    } finally {
      (server.httpServer as { closeAllConnections?: () => void } | null)?.closeAllConnections?.();
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
});
