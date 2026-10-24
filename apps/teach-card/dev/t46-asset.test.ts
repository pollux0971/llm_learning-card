/**
 * T46 驗收「單獨執行的圖片路由」(工單第 3 條第 6 點):`npm run dev -w apps/teach-card` 的 dev server 多一條路由,
 * 服務暫存根(`<root>/learning`)裡的圖片,例如 `/__asset?path=<learning 相對路徑>`。測試 agent 寫;開發 worker 不改。
 *
 * 釘死的(工單寫「例如」,但渲染測試的請求紀錄也用這個名字,所以這裡當成定案):
 *   - 路由 `GET /__asset?path=<learning 相對路徑>`,跟 `/__card` 同一個 dev server、同一個暫存根。
 *   - 回位元組(不是文字:0–255 每個位元組原樣回來)、`Content-Type` 照副檔名(png / jpg / jpeg / gif / webp)、不存在回 404。
 *   - 跟 `/__card` 一樣只讀暫存根、擋 `..`、絕對路徑、反斜線:不回 200、不回檔案內容、server 照常活著。
 *   - 路徑指到目錄、空路徑:404(不是 500、不讓 server 掛掉)。
 *   - 暫存根起來時 `assets/` 裡就有至少一張能用的圖(單獨執行時看得到):這條不知道檔名,所以列 `<root>/learning/assets/` 的檔,
 *     每一個圖檔都要能經路由取回、位元組相同、Content-Type 是 image/*。
 * 不釘死的:seed 的圖叫什麼、多大、是什麼格式;路由實作怎麼做。
 *
 * 暫存根怎麼找:起 dev server 前後比對 os.tmpdir() 底下 `teach-card-*`(且有 learning/)的目錄。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP = resolve(import.meta.dirname, '..');

interface Running {
  base: string;
  learningDir: string;
  close(): Promise<void>;
}
let running: Running | undefined;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 0–255 每個位元組各一個:文字編碼(utf8)會把 0x80 以上的位元組毀掉 */
const ALL_BYTES = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

beforeAll(async () => {
  const { createServer } = await import('vite');
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
  const roots = readdirSync(tmpdir()).filter((n) => !tmpBefore.has(n) && n.startsWith('teach-card-') && existsSync(join(tmpdir(), n, 'learning')));
  if (port === 0 || roots.length !== 1) {
    await server.close();
    throw new Error(`起不來:port=${port}、新的暫存根 ${roots.length} 個`);
  }
  running = {
    base: `http://127.0.0.1:${port}`,
    learningDir: join(tmpdir(), roots[0]!, 'learning'),
    async close() {
      (server.httpServer as { closeAllConnections?: () => void } | null)?.closeAllConnections?.();
      await server.close();
    },
  };
}, 120_000);

afterAll(async () => {
  await running?.close();
});

function need(): Running {
  if (!running) throw new Error('dev server 沒有起來');
  return running;
}

async function getAsset(path: string): Promise<{ status: number; type: string; bytes: Buffer }> {
  const res = await fetch(`${need().base}/__asset?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(30_000) });
  return { status: res.status, type: res.headers.get('content-type') ?? '', bytes: Buffer.from(await res.arrayBuffer()) };
}

function put(rel: string, bytes: Buffer | string): void {
  const full = join(need().learningDir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, bytes);
}

describe('GET /__asset?path=…', () => {
  it('暫存根起來時 assets/ 裡就有圖,每一張都能取回:位元組相同、Content-Type 是 image/*(單獨執行時看得到)', async () => {
    const dir = join(need().learningDir, 'assets');
    expect(existsSync(dir), '暫存根要有 assets/').toBe(true);
    const images = readdirSync(dir).filter((n) => /\.(png|jpe?g|gif|webp)$/i.test(n));
    expect(images.length, 'assets/ 裡要有至少一張圖').toBeGreaterThan(0);
    for (const name of images) {
      const got = await getAsset(`assets/${name}`);
      expect(got.status, `${name} 要 200`).toBe(200);
      expect(got.type, `${name} 的 Content-Type`).toMatch(/^image\//);
      expect(got.bytes.equals(readFileSync(join(dir, name))), `${name} 的位元組要和磁碟相同`).toBe(true);
    }
    const png = images.find((n) => /\.png$/i.test(n));
    if (png) expect([...readFileSync(join(dir, png)).subarray(0, 8)], 'seed 的 png 要是真的 PNG').toEqual(PNG_SIGNATURE);
  });

  it('回的是位元組:0–255 每個位元組原樣回來(不經文字編碼)', async () => {
    put('assets/t46-bytes.png', ALL_BYTES);
    const got = await getAsset('assets/t46-bytes.png');
    expect(got.status).toBe(200);
    expect(got.bytes.length).toBe(256);
    expect(got.bytes.equals(ALL_BYTES)).toBe(true);
  });

  it('Content-Type 照副檔名:png、jpg、jpeg、gif、webp', async () => {
    const want: [string, RegExp][] = [
      ['t46-t.png', /^image\/png\b/],
      ['t46-t.jpg', /^image\/jpeg\b/],
      ['t46-t.jpeg', /^image\/jpeg\b/],
      ['t46-t.gif', /^image\/gif\b/],
      ['t46-t.webp', /^image\/webp\b/],
    ];
    for (const [name, type] of want) {
      put(`assets/${name}`, ALL_BYTES);
      const got = await getAsset(`assets/${name}`);
      expect(got.status, name).toBe(200);
      expect(got.type, name).toMatch(type);
    }
  });

  it('子目錄與中文檔名:assets/sub/b.png、assets/同源.png', async () => {
    put('assets/sub/t46-b.png', ALL_BYTES);
    put('assets/同源.png', ALL_BYTES);
    expect((await getAsset('assets/sub/t46-b.png')).status).toBe(200);
    const zh = await getAsset('assets/同源.png');
    expect(zh.status, '中文檔名').toBe(200);
    expect(zh.bytes.equals(ALL_BYTES)).toBe(true);
  });

  it('不存在:404', async () => {
    const got = await getAsset('assets/t46-nope.png');
    expect(got.status).toBe(404);
  });

  it('擋 ..、絕對路徑、反斜線:不回 200、不回檔案內容、server 照常活著', async () => {
    const secret = readFileSync(join(need().learningDir, 'cards/security/sec-0001.md'));
    const bad = [
      'assets/../cards/security/sec-0001.md',
      '../cards/security/sec-0001.md',
      'assets/../../teach-card-escape.png',
      '/etc/passwd',
      `/${need().learningDir}/cards/security/sec-0001.md`,
      'assets\\..\\cards\\security\\sec-0001.md',
      'assets/%2e%2e/cards/security/sec-0001.md',
    ];
    for (const path of bad) {
      const got = await getAsset(path);
      expect(got.status, `${JSON.stringify(path)} 不能是 200`).not.toBe(200);
      expect(got.status, `${JSON.stringify(path)} 要是 4xx`).toBeGreaterThanOrEqual(400);
      expect(got.status).toBeLessThan(500);
      expect(got.bytes.includes(secret.subarray(0, 40)), `${JSON.stringify(path)} 不能回檔案內容`).toBe(false);
    }
    expect((await getAsset('assets/t46-bytes.png')).status, '被擋的請求之後 server 還在').toBe(200);
  });

  it('擋 ..:cards/ 底下有一個 .png(副檔名白名單擋不到的檔),用 assets/../ 與 ../ 開頭的路徑取:不回 200、不回位元組', async () => {
    const marker = Buffer.concat([Buffer.from('T46-OUTSIDE-ASSETS-'), ALL_BYTES]);
    put('cards/security/t46-outside.png', marker);
    put('t46-root-outside.png', marker);
    const bad = [
      'assets/../cards/security/t46-outside.png',
      '../cards/security/t46-outside.png',
      'assets/sub/../../cards/security/t46-outside.png',
      'assets/../t46-root-outside.png',
      '../t46-root-outside.png',
      'assets/../../t46-root-outside.png',
    ];
    for (const path of bad) {
      const got = await getAsset(path);
      expect(got.status, `${JSON.stringify(path)} 不能是 200`).not.toBe(200);
      expect(got.status, `${JSON.stringify(path)} 要是 4xx`).toBeGreaterThanOrEqual(400);
      expect(got.status).toBeLessThan(500);
      expect(got.bytes.includes(Buffer.from('T46-OUTSIDE-ASSETS-')), `${JSON.stringify(path)} 不能回檔案的位元組`).toBe(false);
    }
    expect((await getAsset('assets/t46-bytes.png')).status, '被擋的請求之後 server 還在').toBe(200);
  });

  it('指到目錄、空路徑、沒有 path:404,不是 500,server 照常活著', async () => {
    for (const path of ['assets', 'assets/', 'assets/sub', '']) {
      const got = await getAsset(path);
      expect(got.status, `${JSON.stringify(path)}`).toBe(404);
    }
    const res = await fetch(`${need().base}/__asset`, { signal: AbortSignal.timeout(30_000) });
    expect(res.status, '沒有 path 參數').toBe(404);
    await res.arrayBuffer();
    expect((await getAsset('assets/t46-bytes.png')).status).toBe(200);
  });
});
