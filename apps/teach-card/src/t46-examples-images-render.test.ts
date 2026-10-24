/**
 * T46(07-teach-card phase-4 場景 1–5:例子折疊、圖片經 assetUrl、放大、找不到)渲染測試。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T46-teach-card-examples-images.md 「驗收條件 1」的渲染測試 a、b、d、e。單元 c 在 packages/ui-shared/src/image-path.test.ts,
 * 單獨執行的圖片路由在 apps/teach-card/dev/t46-asset.test.ts,場景 3 的 cucumber 在 features/steps/teach-card-phase4.steps.ts。
 *
 * 真的把 `App.svelte` 畫出來:`openApp(apps/teach-card, { viewport: 360 × 480, initScript })`(同 t44 / t45:單獨執行的 vite dev server + 真的側車
 * + `dev/fake-cloud.mjs` + headless Chrome)。量的都是畫面(DOM、`checkVisibility()`、`getBoundingClientRect`、`elementFromPoint`、資源請求紀錄),
 * 不讀原始碼比字串(SKILL §4g 第 29 條)。
 *
 * 真的使用者動作:工單 d 要「關的那一下不能穿過去按到底下的按鈕」、b 要「Tab 到標題按 Enter」,DOM 的 `.click()` 與假的 KeyboardEvent 量不到
 * (假的鍵盤事件不會觸發瀏覽器內建的 summary 切換;假的 click 沒有 mousedown → mouseup 的順序)。所以這份測試另外連上同一個 Chrome 的同一個頁面
 * (找 `hud-render-chrome-*` 的 DevToolsActivePort,用頁面網址對上),用 DevTools 的 `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` 送真的指標與鍵盤。
 * `render-test-support.ts` 不動。
 *
 * 頁面腳本之前的 `initScript`(測試那一邊的事,產品程式不用為它改):
 *   - `/__card` 的回應:`localStorage['t46.body']` 有字就把卡片內文換成它(frontmatter 留著),所有卡都一樣。
 *   - 記錄 `/__review` 每個請求的 method。
 *   - 每一個 requestAnimationFrame、每一批 DOM 變動(MutationObserver:微任務,在畫出來之前)都記下「每個例子的內容看不看得到」(`__t46.samples`):
 *     「從第一幀就是收起的」靠它量,先畫展開、之後才收起來的實作,在第一批變動就會留下一筆「展開」。
 *   - `__t46.info()`:每個例子的標題字、標題是不是看得到、內容看不看得到、高度。
 *
 * 取捨(工單沒寫死的地方):
 *   - 「內容看不看得到」用 `checkVisibility()`(而且高度 > 0):這台 Chrome 的收起的 <details>,內容還有版面盒(`offsetParent` 不是 null、高度 18),
 *     工單寫的「offsetParent 為 null 或高度 0」量不到;`checkVisibility()` 對 `content-visibility: hidden` 與 `display: none` 都回 false。另外 a 還要「收起後例子整塊變矮」。
 *   - 「標題」:例子裡的 `<summary>`;沒有 summary 時,找例子裡字剛好是「例子」或「例子 N」的葉節點。
 *   - 這份檔的圖(`t46-ok.png` 等)由測試自己寫進暫存根的 `assets/`(找暫存根:起 app 前後比對 os.tmpdir() 底下 `teach-card-*`),所以不依賴 worker 的 seed 叫什麼名字。
 *   - 側車的 `teach.next` 會把卡標成學過、fixture 只有 3 張:每條測試開頭把暫存根的 `state/reviews.json` 寫回 `{}`,再整頁重新載入。
 *   - 例子的圖放在卡片很下面的長卡(d):按鈕與圖在捲到底時都看得到,才能用真指標按「圖」再按「原本按鈕的位置」。
 *   - 每條測試收尾直接送 teach.cancel(quiesce):只有 G3(深入)那一組真的生出子卡,所以自己一個 app。
 *
 * 對應工單 must_catch:
 *   a 折疊:預設展開、按標題收放、第一幀、跨卡記住(下一個、換類別、深入、回上一層)、重載還在;
 *   b 三個例子:標題「例子 1/2/3」、各自收放(含整張不重畫:節點沒被換掉)、鍵盤 Tab + Enter / 空白鍵、最後一下為準;
 *   d 放大:蓋整個視窗、圖等比放到最大、同一個 src、不載第二份、按任何地方 / Esc 關、關的那一下 0 個 /__review、捲動位置不變、佔位字樣不能放大;
 *   e 找不到 / 拒絕:字樣寫出路徑、沒有破圖、拒絕的 0 個請求、跳脫、卡片其他部分照常。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openApp, type GalleryPage } from '../../../packages/ui-shared/src/hud/render-test-support.js';

// 每條都真的起 vite、headless Chrome、側車:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const TEACH_DIR = join(import.meta.dirname, '..');
const VIEWPORT = { width: 360, height: 480 } as const;

// ---------------------------------------------------------------- 圖檔(測試自己寫進暫存根)

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
/** 單色 8 位元 RGB 的 PNG */
function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      raw[y * stride + 1 + x * 3] = rgb[0];
      raw[y * stride + 2 + x * 3] = rgb[1];
      raw[y * stride + 3 + x * 3] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const IMAGES: Record<string, { w: number; h: number; rgb: [number, number, number] }> = {
  'assets/t46-ok.png': { w: 120, h: 60, rgb: [200, 40, 40] },
  'assets/t46-tall.png': { w: 60, h: 240, rgb: [40, 40, 200] },
  'assets/同源.png': { w: 40, h: 40, rgb: [40, 160, 40] },
  'assets/sub/t46-b.png': { w: 50, h: 50, rgb: [200, 180, 40] },
};

// ---------------------------------------------------------------- 卡片內文

const OK_IMG = '![小圖](../../assets/t46-ok.png)';
const FILLER = Array.from({ length: 14 }, (_, i) => `- 補充的第 ${i + 1} 行,讓卡片要捲動`).join('\n');

const BODIES = {
  /** a:一個例子(三條清單 + 一張存在的圖) */
  one: ['T46-BODY 內文一句話。', '', '```example', '範例內容:', '', '- 第一點 T46-A1', '- 第二點 T46-A2', '- 第三點 T46-A3', '', OK_IMG, '```'].join('\n'),
  /** b:三個例子,各有自己的字 */
  three: [
    'T46-BODY 三個例子。',
    '',
    '```example',
    '第一個:',
    '',
    '- T46-E1-a',
    '- T46-E1-b',
    '```',
    '',
    '中間一段。',
    '',
    '```example',
    '第二個:',
    '',
    '- T46-E2-a',
    '- T46-E2-b',
    '```',
    '',
    '```example',
    '第三個:',
    '',
    '- T46-E3-a',
    '- T46-E3-b',
    '```',
  ].join('\n'),
  /** d:長卡,圖在例子最後,捲到底時圖與按鈕都看得到 */
  zoom: ['T46-ZOOM 說明文字。', '', '```example', FILLER, '', OK_IMG, '```'].join('\n'),
  tall: ['T46-ZOOM 高圖。', '', '```example', FILLER, '', '![高圖](../../assets/t46-tall.png)', '```'].join('\n'),
  /** e:存在、不存在、會被拒絕、會注入的、中文檔名、內文裡的圖,兩個例子 */
  mixed: [
    'T46-BODY 這是內文。',
    '',
    '![內文的圖](../../assets/sub/t46-b.png)',
    '',
    '```example',
    '第一個例子:T46-E1',
    '',
    OK_IMG,
    '',
    '![缺的](../../assets/t46-missing.png)',
    '',
    '![原始](../../raw/demo/x.png)',
    '',
    '![外部](https://example.invalid/x.png)',
    '',
    '![資料](data:image/png;base64,AAAA)',
    '',
    '![中文](../../assets/同源.png)',
    '```',
    '',
    '```example',
    '第二個例子:T46-E2',
    '',
    '- T46-E2-a',
    '',
    '![注入](../../assets/a"><img/src=x/onerror=window.__t46pwn=1><b>x</b>&<i>.png)',
    '```',
  ].join('\n'),
} as const;
type BodyKey = keyof typeof BODIES;

const MISSING_TEXT = '找不到圖片:assets/t46-missing.png';
const EVIL_PATH = '../../assets/a"><img/src=x/onerror=window.__t46pwn=1><b>x</b>&<i>.png';

// ---------------------------------------------------------------- 頁面腳本

const INIT_SCRIPT = `(() => {
  const orig = window.fetch.bind(window);
  const st = (window.__t46 = { methods: [], samples: [], cardPaths: [] });
  st.examples = () => [...document.querySelectorAll('.lc-example')];
  st.heading = (ex) =>
    ex.querySelector('summary') ||
    [...ex.querySelectorAll('*')].find((e) => e.children.length === 0 && /^例子( \\d+)?$/.test(e.textContent.trim())) ||
    null;
  st.contentVisible = (ex) => [...ex.querySelectorAll('li, img, ul')].some((e) => e.checkVisibility() && e.getBoundingClientRect().height > 0);
  st.info = () =>
    st.examples().map((ex) => {
      const h = st.heading(ex);
      const hr = h ? h.getBoundingClientRect() : null;
      return {
        heading: h ? h.textContent.trim() : null,
        headingTag: h ? h.tagName : null,
        headingVisible: Boolean(h) && h.checkVisibility() && hr.height > 0,
        open: st.contentVisible(ex),
        height: ex.getBoundingClientRect().height,
      };
    });
  const sample = (kind) => {
    const exs = st.examples();
    if (exs.length === 0 || st.samples.length >= 20000) return;
    st.samples.push({ kind, t: performance.now(), title: (document.querySelector('h2') || {}).textContent || '', states: exs.map((ex) => st.contentVisible(ex)) });
  };
  st.clear = () => { st.samples.length = 0; return true; };
  const loop = () => { sample('frame'); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  new MutationObserver(() => sample('mutation')).observe(document, { childList: true, subtree: true, attributes: true });
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/__card')) {
      const res = await orig(input, init);
      const text = await res.text();
      st.cardPaths.push(new URL(url, location.href).searchParams.get('path'));
      let body = '';
      try { body = localStorage.getItem('t46.body') || ''; } catch { body = ''; }
      if (!body) return new Response(text, { status: res.status, headers: { 'content-type': 'text/plain' } });
      const fm = /^---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n?/.exec(text);
      return new Response((fm ? fm[0] : '') + body, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (url.includes('/__review')) {
      try { st.methods.push(JSON.parse(init.body).method); } catch { st.methods.push('?'); }
    }
    return orig(input, init);
  };
})()`;

// ---------------------------------------------------------------- 真的指標與鍵盤(連同一個 Chrome 的同一個頁面)

class RealInput {
  private seq = 0;
  private readonly pending = new Map<number, (m: { error?: { message: string } }) => void>();

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; error?: { message: string } };
      if (msg.id !== undefined) {
        this.pending.get(msg.id)?.(msg);
        this.pending.delete(msg.id);
      }
    };
  }

  static async attach(pageUrl: string): Promise<RealInput> {
    for (const name of readdirSync(tmpdir()).filter((n) => n.startsWith('hud-render-chrome-'))) {
      const portFile = join(tmpdir(), name, 'DevToolsActivePort');
      if (!existsSync(portFile)) continue;
      const port = readFileSync(portFile, 'utf8').split('\n')[0]?.trim();
      if (!port) continue;
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
        const target = list.find((t) => t.type === 'page' && t.url.startsWith(pageUrl));
        if (!target) continue;
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error('連不上 DevTools'));
        });
        const input = new RealInput(ws);
        await input.send('Page.bringToFront');
        await input.send('Emulation.setFocusEmulationEnabled', { enabled: true });
        return input;
      } catch {
        /* 別人的(已經結束的)Chrome,換下一個 */
      }
    }
    throw new Error(`找不到開著 ${pageUrl} 的 Chrome(hud-render-chrome-*/DevToolsActivePort)`);
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<void> {
    this.seq += 1;
    const id = this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve()));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 真的指標:移過去、按下、放開(同一個點) */
  async click(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  async key(name: 'Tab' | 'Enter' | 'Space' | 'Escape'): Promise<void> {
    const spec = {
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
      Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    }[name];
    await this.send('Input.dispatchKeyEvent', { type: spec.text ? 'keyDown' : 'rawKeyDown', ...spec });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.windowsVirtualKeyCode });
  }

  close(): void {
    this.ws.close();
  }
}

// ---------------------------------------------------------------- 共用

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const BUTTON = (label: string): string =>
  `[...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\\s+/g, '') === ${JSON.stringify(label)})`;

async function waitFor(page: GalleryPage, predicate: string, ms = 8000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate<boolean>(`Boolean(${predicate})`)) return true;
    await sleep(60);
  }
  return false;
}

const pageText = (page: GalleryPage): Promise<string> => page.evaluate<string>('document.body.innerText');
const methods = (page: GalleryPage): Promise<string[]> => page.evaluate<string[]>('window.__t46.methods.slice()');
const title = (page: GalleryPage): Promise<string> => page.evaluate<string>(`document.querySelector('h2')?.textContent.trim() ?? ''`);

interface ExampleInfo { heading: string | null; headingTag: string | null; headingVisible: boolean; open: boolean; height: number }
const info = (page: GalleryPage): Promise<ExampleInfo[]> => page.evaluate<ExampleInfo[]>('window.__t46.info()');
const opens = async (page: GalleryPage): Promise<boolean[]> => (await info(page)).map((e) => e.open);

interface Sample { kind: string; t: number; title: string; states: boolean[] }
const samples = (page: GalleryPage): Promise<Sample[]> => page.evaluate<Sample[]>('window.__t46.samples.slice()');

interface Pt { x: number; y: number }
const centerOf = (expr: string): string => `(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;

/** 暫存根:起 app 前後比對 os.tmpdir() 底下 teach-card-*(有 learning/ 的) */
function newRoot(before: Set<string>): string {
  const found = readdirSync(tmpdir()).filter((n) => !before.has(n) && n.startsWith('teach-card-') && existsSync(join(tmpdir(), n, 'learning')));
  if (found.length !== 1) throw new Error(`新的暫存根要剛好一個,找到 ${found.length} 個`);
  return join(tmpdir(), found[0]!, 'learning');
}

function seedImages(learningDir: string): void {
  for (const [rel, spec] of Object.entries(IMAGES)) {
    const full = join(learningDir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, makePng(spec.w, spec.h, spec.rgb));
  }
}

interface App {
  page: GalleryPage;
  input: RealInput;
  learningDir: string;
}

async function start(): Promise<App> {
  const before = new Set(readdirSync(tmpdir()));
  const page = await openApp(TEACH_DIR, { viewport: VIEWPORT, ready: '.markers', initScript: INIT_SCRIPT });
  const learningDir = newRoot(before);
  seedImages(learningDir);
  const input = await RealInput.attach(page.url);
  return { page, input, learningDir };
}

async function stop(app: App | undefined): Promise<void> {
  app?.input.close();
  await app?.page.close();
}

/** 一條測試的開頭:學過紀錄清空、換上這條要的內文、清掉 localStorage(折疊記錄也清)、整頁重新載入,等例子畫出來 */
async function prepare(app: App, body: BodyKey, opts: { keepStorage?: boolean } = {}): Promise<void> {
  writeFileSync(join(app.learningDir, 'state/reviews.json'), '{}\n');
  await app.page.evaluate(`(() => { try { ${opts.keepStorage ? '' : 'localStorage.clear();'} localStorage.setItem('t46.body', ${JSON.stringify(BODIES[body])}); } catch {} return true; })()`);
  await app.page.reset();
  expect(await waitFor(app.page, `document.querySelector('.hud-body') && document.querySelector('.markers') && document.querySelector('.lc-example') && ${BUTTON('下一個')}`, 12_000), `卡片與例子要畫出來;畫面文字:${await pageText(app.page)}`).toBe(true);
  await sleep(250);
}

async function quiesce(page: GalleryPage): Promise<void> {
  await page.evaluate(`(async () => {
    const res = await fetch('/__review', { method: 'POST', body: JSON.stringify({ v: 1, id: 90001, method: 'teach.cancel', params: {} }) });
    await res.text();
    return true;
  })()`);
}

/** 真指標按第 index 個例子的標題 */
async function clickHeading(app: App, index: number): Promise<void> {
  await app.page.evaluate<boolean>(`(() => {
    const h = window.__t46.heading(window.__t46.examples()[${index}]);
    if (h) h.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(80);
  const at = await app.page.evaluate<Pt | null>(centerOf(`window.__t46.heading(window.__t46.examples()[${index}])`));
  if (!at) throw new Error(`第 ${index + 1} 個例子找不到標題;畫面文字:${await pageText(app.page)}`);
  await app.input.click(at.x, at.y);
  await sleep(150);
}

async function clickButtonReal(app: App, label: string): Promise<void> {
  await app.page.evaluate<boolean>(`(() => { const b = ${BUTTON(label)}; if (b) b.scrollIntoView({ block: 'nearest' }); return true; })()`);
  await sleep(80);
  const at = await app.page.evaluate<Pt | null>(centerOf(BUTTON(label)));
  if (!at) throw new Error(`找不到「${label}」;畫面文字:${await pageText(app.page)}`);
  await app.input.click(at.x, at.y);
}

/** 換卡之後的每一筆取樣:至少要有一筆、而且都是 want */
async function expectAllFrames(page: GalleryPage, want: boolean, why: string, notTitle?: string): Promise<void> {
  // notTitle:換卡前那張還在畫面上的取樣不算(它的狀態是舊的);只看換過去之後的
  const got = (await samples(page)).filter((x) => notTitle === undefined || x.title.trim() !== notTitle);
  expect(got.length, `${why}:要有取樣(頁面有畫出例子)`).toBeGreaterThan(0);
  const bad = got.filter((s) => s.states.some((v) => v !== want));
  expect(bad.map((s) => `${s.kind}@${s.t.toFixed(0)}:${JSON.stringify(s.states)}`).slice(0, 5), `${why}:每一幀 / 每一批變動的例子都要是${want ? '展開' : '收起'}(共 ${got.length} 筆取樣)`).toEqual([]);
}

// ================================================================ G1:折疊(a)與三個例子(b)

describe('T46 渲染:例子折疊(a)與三個例子(b)', () => {
  let app: App | undefined;
  beforeAll(async () => {
    app = await start();
  });
  afterEach(async () => {
    if (app) await quiesce(app.page).catch(() => undefined);
  });
  afterAll(async () => {
    await stop(app);
  });
  const a = (): App => {
    if (!app) throw new Error('教學卡沒有開起來');
    return app;
  };

  it('a. 沒有記錄的時候,例子一開始是展開的:標題「例子」看得到、內容看得到、整塊比標題高', async () => {
    await prepare(a(), 'one');
    const [ex] = await info(a().page);
    expect(ex, '要有一個例子').toBeTruthy();
    expect(ex!.heading, '單一個例子的標題(D3)').toBe('例子');
    expect(ex!.headingVisible, '標題看得到').toBe(true);
    expect(ex!.open, '內容看得到').toBe(true);
    await expectAllFrames(a().page, true, '第一次載入');
    expect(await pageText(a().page)).toContain('T46-A2');
  });

  it('a. 真指標按標題:收起(內容看不到、整塊變矮、標題還在)→ 再按:展開', async () => {
    await prepare(a(), 'one');
    const before = (await info(a().page))[0]!;
    await clickHeading(a(), 0);
    const folded = (await info(a().page))[0]!;
    expect(folded.open, '收起後內容看得到').toBe(false);
    expect(folded.headingVisible, '收起後標題還在').toBe(true);
    expect(folded.height, `收起後整塊要變矮(展開 ${before.height.toFixed(1)}、收起 ${folded.height.toFixed(1)})`).toBeLessThan(before.height - 20);
    expect(await pageText(a().page), '收起後內容不在畫面文字裡').not.toContain('T46-A2');
    await clickHeading(a(), 0);
    const again = (await info(a().page))[0]!;
    expect(again.open, '再按一次:展開').toBe(true);
    expect(Math.abs(again.height - before.height), '展開後回到原本的高度').toBeLessThan(1);
  });

  it('a. 收起之後按「下一個」:新卡的例子從第一幀就是收起的(每一幀與每一批 DOM 變動取樣,沒有一筆展開)', async () => {
    await prepare(a(), 'one');
    await clickHeading(a(), 0);
    expect(await opens(a().page)).toEqual([false]);
    const titleBefore = await title(a().page);
    await a().page.evaluate('window.__t46.clear()');
    await clickButtonReal(a(), '下一個');
    expect(await waitFor(a().page, `document.querySelector('h2') && document.querySelector('h2').textContent.trim() !== ${JSON.stringify(titleBefore)} && document.querySelector('.lc-example')`, 10_000), `要換成下一張卡;畫面文字:${await pageText(a().page)}`).toBe(true);
    await sleep(400);
    await expectAllFrames(a().page, false, '收起後換下一張', titleBefore);
    expect(await opens(a().page)).toEqual([false]);
  });

  it('a. 展開之後(收起再展開)按「下一個」:新卡是展開的,從第一幀就是', async () => {
    await prepare(a(), 'one');
    await clickHeading(a(), 0);
    await clickHeading(a(), 0);
    expect(await opens(a().page)).toEqual([true]);
    const titleBefore = await title(a().page);
    await a().page.evaluate('window.__t46.clear()');
    await clickButtonReal(a(), '下一個');
    expect(await waitFor(a().page, `document.querySelector('h2') && document.querySelector('h2').textContent.trim() !== ${JSON.stringify(titleBefore)} && document.querySelector('.lc-example')`, 10_000)).toBe(true);
    await sleep(400);
    await expectAllFrames(a().page, true, '展開後換下一張', titleBefore);
  });

  it('a. 連換兩張:收起 → 下一個 → 展開 → 下一個:每一張都從「最後一次按的那一下」開始', async () => {
    await prepare(a(), 'one');
    await clickHeading(a(), 0); // 收起
    const t1 = await title(a().page);
    await clickButtonReal(a(), '下一個');
    expect(await waitFor(a().page, `document.querySelector('h2').textContent.trim() !== ${JSON.stringify(t1)} && document.querySelector('.lc-example')`, 10_000)).toBe(true);
    await sleep(300);
    expect(await opens(a().page), '第二張:收起').toEqual([false]);
    await clickHeading(a(), 0); // 展開
    expect(await opens(a().page)).toEqual([true]);
    const t2 = await title(a().page);
    await a().page.evaluate('window.__t46.clear()');
    await clickButtonReal(a(), '下一個');
    expect(await waitFor(a().page, `document.querySelector('h2').textContent.trim() !== ${JSON.stringify(t2)} && document.querySelector('.lc-example')`, 10_000)).toBe(true);
    await sleep(400);
    await expectAllFrames(a().page, true, '第三張(最後按的是展開)', t2);
  });

  it('a. 「換類別」再選一個類別換到的卡:照最後一次按的(收起),從第一幀就是', async () => {
    await prepare(a(), 'one');
    await clickHeading(a(), 0);
    await clickButtonReal(a(), '換類別');
    expect(await waitFor(a().page, `!document.querySelector('.lc-example')`, 8000), `要出現類別清單;畫面文字:${await pageText(a().page)}`).toBe(true);
    await a().page.evaluate('window.__t46.clear()');
    const pick = await a().page.evaluate<Pt | null>(centerOf(`document.querySelector('.hud-body .list button')`));
    expect(pick, '類別清單的第一顆').toBeTruthy();
    await a().input.click(pick!.x, pick!.y);
    expect(await waitFor(a().page, `document.querySelector('.lc-example')`, 10_000), `選了類別要回到卡片;畫面文字:${await pageText(a().page)}`).toBe(true);
    await sleep(400);
    await expectAllFrames(a().page, false, '換類別之後');
  });

  it('a. 重新載入頁面(同一份 storage):最後一次是收起 → 收起、從第一幀;最後一次是展開 → 展開', async () => {
    await prepare(a(), 'one');
    await clickHeading(a(), 0); // 收起
    await prepare(a(), 'one', { keepStorage: true });
    expect(await opens(a().page), '重新載入後還是收起').toEqual([false]);
    await expectAllFrames(a().page, false, '重新載入(收起)');
    await clickHeading(a(), 0); // 展開
    await prepare(a(), 'one', { keepStorage: true });
    expect(await opens(a().page), '重新載入後還是展開').toEqual([true]);
    await expectAllFrames(a().page, true, '重新載入(展開)');
  });

  // ---- b
  it('b. 三個例子:標題字是「例子 1」「例子 2」「例子 3」,都看得到,內容都展開', async () => {
    await prepare(a(), 'three');
    const got = await info(a().page);
    expect(got.map((e) => e.heading)).toEqual(['例子 1', '例子 2', '例子 3']);
    expect(got.map((e) => e.headingVisible)).toEqual([true, true, true]);
    expect(got.map((e) => e.open)).toEqual([true, true, true]);
  });

  it('b. 按第 2 個的標題:只有第 2 個收起,第 1、3 個不變;其他兩個的節點沒有被換掉(整張沒有重畫);再按:回來', async () => {
    await prepare(a(), 'three');
    await a().page.evaluate(`(() => { window.__t46.examples().forEach((ex, i) => { ex.__t46mark = 'mark' + i; }); return true; })()`);
    await clickHeading(a(), 1);
    expect(await opens(a().page), '只有第 2 個收起').toEqual([true, false, true]);
    const marks = await a().page.evaluate<(string | null)[]>(`window.__t46.examples().map((ex) => ex.__t46mark ?? null)`);
    expect(marks, '三個例子的節點都還是原來那三個(整張 html 沒有重算重畫)').toEqual(['mark0', 'mark1', 'mark2']);
    await clickHeading(a(), 1);
    expect(await opens(a().page), '再按第 2 個:回到全展開').toEqual([true, true, true]);
    await clickHeading(a(), 0);
    await clickHeading(a(), 2);
    expect(await opens(a().page), '按第 1、3 個:只剩第 2 個展開').toEqual([false, true, false]);
    expect(await a().page.evaluate<(string | null)[]>(`window.__t46.examples().map((ex) => ex.__t46mark ?? null)`)).toEqual(['mark0', 'mark1', 'mark2']);
  });

  it('b. 收起第 2 個之後按「下一個」:新卡的三個例子都收起(單一個狀態,等於最後一次按的那一下);展開第 3 個再下一個:都展開', async () => {
    await prepare(a(), 'three');
    await clickHeading(a(), 1); // 最後一下 = 收起
    const t1 = await title(a().page);
    await a().page.evaluate('window.__t46.clear()');
    await clickButtonReal(a(), '下一個');
    expect(await waitFor(a().page, `document.querySelector('h2').textContent.trim() !== ${JSON.stringify(t1)} && document.querySelector('.lc-example')`, 10_000)).toBe(true);
    await sleep(400);
    await expectAllFrames(a().page, false, '三個例子,最後按的是收起', t1);
    expect(await opens(a().page)).toEqual([false, false, false]);
    await clickHeading(a(), 2); // 最後一下 = 展開
    expect(await opens(a().page)).toEqual([false, false, true]);
    const t2 = await title(a().page);
    await a().page.evaluate('window.__t46.clear()');
    await clickButtonReal(a(), '下一個');
    expect(await waitFor(a().page, `document.querySelector('h2').textContent.trim() !== ${JSON.stringify(t2)} && document.querySelector('.lc-example')`, 10_000)).toBe(true);
    await sleep(400);
    await expectAllFrames(a().page, true, '三個例子,最後按的是展開', t2);
  });

  it('b. 鍵盤:Tab 走得到第 1 個標題;Enter 收起(只有第 1 個);空白鍵展開', async () => {
    await prepare(a(), 'three');
    await a().page.evaluate(`(() => { document.activeElement && document.activeElement.blur(); return true; })()`);
    let reached = false;
    for (let i = 0; i < 20 && !reached; i += 1) {
      await a().input.key('Tab');
      reached = await a().page.evaluate<boolean>(`(() => {
        const h = window.__t46.heading(window.__t46.examples()[0]);
        return Boolean(h) && (document.activeElement === h || h.contains(document.activeElement));
      })()`);
    }
    expect(reached, `Tab 要走得到第 1 個標題(最多按 20 次);目前焦點:${await a().page.evaluate<string>(`document.activeElement ? document.activeElement.tagName + ':' + document.activeElement.textContent.trim().slice(0, 20) : 'null'`)}`).toBe(true);
    await a().input.key('Enter');
    await sleep(150);
    expect(await opens(a().page), 'Enter:只有第 1 個收起').toEqual([false, true, true]);
    await a().input.key('Space');
    await sleep(150);
    expect(await opens(a().page), '空白鍵:展開').toEqual([true, true, true]);
  });
});

// ================================================================ G2:圖片(放大 d、找不到與拒絕 e)

interface ImgFact {
  src: string;
  nw: number;
  nh: number;
  complete: boolean;
  rect: { x: number; y: number; w: number; h: number };
  orig: boolean;
}
const IMG_FACTS = `(() => [...document.querySelectorAll('img')].map((i) => {
  const r = i.getBoundingClientRect();
  return { src: i.currentSrc || i.src, nw: i.naturalWidth, nh: i.naturalHeight, complete: i.complete, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, orig: i.hasAttribute('data-t46-orig') };
}))()`;
const imgFacts = (page: GalleryPage): Promise<ImgFact[]> => page.evaluate<ImgFact[]>(IMG_FACTS);

/** 圖片的資源請求(Resource Timing:任何 img 發起的,以及名字裡有 /__asset 的) */
const IMG_REQUESTS = `performance.getEntriesByType('resource').filter((e) => e.initiatorType === 'img' || e.name.includes('/__asset')).map((e) => e.name)`;
const imgRequests = (page: GalleryPage): Promise<string[]> => page.evaluate<string[]>(`(() => ${IMG_REQUESTS})()`);
/** 不同源的請求(例如外部網址的圖) */
const externalRequests = (page: GalleryPage): Promise<string[]> =>
  page.evaluate<string[]>(`performance.getEntriesByType('resource').map((e) => e.name).filter((n) => { try { return new URL(n).host !== location.host; } catch { return true; } })`);

describe('T46 渲染:放大(d)、找不到與拒絕(e)', () => {
  let app: App | undefined;
  beforeAll(async () => {
    app = await start();
  });
  afterEach(async () => {
    if (app) await quiesce(app.page).catch(() => undefined);
  });
  afterAll(async () => {
    await stop(app);
  });
  const a = (): App => {
    if (!app) throw new Error('教學卡沒有開起來');
    return app;
  };

  // ---- 放大(d)

  interface ZoomSetup { scrollTop: number; button: Pt; imgCenter: Pt; orig: ImgFact }

  /** 長卡捲到底:圖在例子最後、按鈕在圖下面,兩個都要在畫面裡 */
  async function zoomSetup(body: 'zoom' | 'tall'): Promise<ZoomSetup> {
    await prepare(a(), body);
    expect(await waitFor(a().page, `document.querySelector('.lc-example img') && document.querySelector('.lc-example img').complete && document.querySelector('.lc-example img').naturalWidth > 0`, 10_000), `例子裡的圖要載好;圖:${JSON.stringify(await imgFacts(a().page))}`).toBe(true);
    await a().page.evaluate(`(() => { const b = document.querySelector('.hud-body'); b.scrollTop = b.scrollHeight; return true; })()`);
    await sleep(200);
    const facts = await a().page.evaluate<{ sh: number; ch: number; scrollTop: number; bodyTop: number; bodyBottom: number }>(`(() => { const b = document.querySelector('.hud-body'); const r = b.getBoundingClientRect(); return { sh: b.scrollHeight, ch: b.clientHeight, scrollTop: b.scrollTop, bodyTop: r.top, bodyBottom: r.bottom }; })()`);
    expect(facts.scrollTop, `前提:長卡要捲得動(scrollHeight ${facts.sh}、clientHeight ${facts.ch})`).toBeGreaterThan(30);
    await a().page.evaluate(`(() => { document.querySelectorAll('img').forEach((i) => i.setAttribute('data-t46-orig', '1')); return true; })()`);
    const orig = (await imgFacts(a().page))[0]!;
    expect(orig.rect.y, `前提:圖在畫面裡(top ${orig.rect.y}、body ${facts.bodyTop}–${facts.bodyBottom})`).toBeGreaterThanOrEqual(facts.bodyTop);
    expect(orig.rect.y + orig.rect.h).toBeLessThanOrEqual(facts.bodyBottom);
    const button = (await a().page.evaluate<Pt | null>(centerOf(BUTTON('下一個'))))!;
    expect(button.y, `前提:「下一個」在畫面裡(y ${button.y})`).toBeLessThan(VIEWPORT.height);
    expect(button.y).toBeGreaterThan(facts.bodyTop);
    return { scrollTop: facts.scrollTop, button, imgCenter: { x: orig.rect.x + orig.rect.w / 2, y: orig.rect.y + orig.rect.h / 2 }, orig };
  }

  /** 放大層裡的那張(跟原本同一個 src、不是開之前標記過的那一張) */
  async function enlarged(src: string): Promise<ImgFact | undefined> {
    return (await imgFacts(a().page)).filter((f) => f.src === src).find((f) => !f.orig);
  }

  async function openZoom(setup: ZoomSetup): Promise<ImgFact> {
    await a().input.click(setup.imgCenter.x, setup.imgCenter.y);
    expect(await waitFor(a().page, `document.querySelectorAll('img').length >= 2`, 3000), `按了圖要出現放大的圖;圖:${JSON.stringify(await imgFacts(a().page))}`).toBe(true);
    await sleep(150);
    const big = await enlarged(setup.orig.src);
    expect(big, `放大層裡要有跟原本同一個網址的新圖(不是原本那一張);圖:${JSON.stringify(await imgFacts(a().page))}`).toBeTruthy();
    return big!;
  }

  const isClosed = (page: GalleryPage, src: string): Promise<boolean> =>
    page.evaluate<boolean>(`(() => [...document.querySelectorAll('img')].filter((i) => (i.currentSrc || i.src) === ${JSON.stringify(src)}).length === 1)()`);

  it('d. 按例子裡的圖:放大層蓋住整個視窗(含標題列、原本「下一個」的位置),圖用同一個網址、等比例、放到視窗裝得下的最大、比原本大', async () => {
    const s = await zoomSetup('zoom');
    const big = await openZoom(s);
    expect(big.src, '同一個網址').toBe(s.orig.src);
    const { rect } = big;
    expect(rect.w / rect.h, '等比例').toBeCloseTo(s.orig.nw / s.orig.nh, 1);
    expect(Math.abs(rect.w / rect.h - s.orig.nw / s.orig.nh) / (s.orig.nw / s.orig.nh), '等比例(誤差 < 1%)').toBeLessThan(0.01);
    expect(rect.x, '不超出視窗(左)').toBeGreaterThanOrEqual(-0.5);
    expect(rect.y, '不超出視窗(上)').toBeGreaterThanOrEqual(-0.5);
    expect(rect.x + rect.w, '不超出視窗(右)').toBeLessThanOrEqual(VIEWPORT.width + 0.5);
    expect(rect.y + rect.h, '不超出視窗(下)').toBeLessThanOrEqual(VIEWPORT.height + 0.5);
    expect(rect.w * rect.h, `比原本大(原本 ${s.orig.rect.w}×${s.orig.rect.h},放大 ${rect.w}×${rect.h})`).toBeGreaterThan(s.orig.rect.w * s.orig.rect.h * 1.5);
    const fitsWidth = Math.abs(rect.w - VIEWPORT.width) <= 2;
    const fitsHeight = Math.abs(rect.h - VIEWPORT.height) <= 2;
    expect(fitsWidth || fitsHeight, `放到視窗裝得下的最大(寬 ${rect.w}、高 ${rect.h},視窗 360×480)`).toBe(true);
    // 蓋住整個視窗(四角內縮到 HudPanel 的 10px 切角 --hud-cut 外,切角裡 elementFromPoint 本來就打到 .hud-fill):放大層 = 放大的圖往上最高、而且不含原本那張圖的祖先;幾個點打到的都要在它裡面,而且它蓋滿視窗
    const cover = await a().page.evaluate<{ roots: string[]; same: boolean; covers: boolean; containsBig: boolean }>(`(() => {
      const origImg = document.querySelector('img[data-t46-orig]');
      const big = [...document.querySelectorAll('img')].find((i) => !i.hasAttribute('data-t46-orig'));
      let root = big;
      while (root.parentElement && !root.parentElement.contains(origImg)) root = root.parentElement;
      const pts = [[12, 12], [348, 12], [12, 468], [348, 468], [180, 6], [${s.button.x}, ${s.button.y}], [180, 240]];
      const hits = pts.map(([x, y]) => document.elementFromPoint(x, y));
      const r = root.getBoundingClientRect();
      return {
        roots: hits.map((h) => (h ? h.tagName + '.' + h.className : 'null')),
        same: hits.every((h) => h && root.contains(h)),
        covers: r.left <= 0.5 && r.top <= 0.5 && r.right >= 359.5 && r.bottom >= 479.5,
        containsBig: root.contains(big),
      };
    })()`);
    expect(cover.same, `視窗四角、標題列、原本按鈕的位置打到的都要在放大層裡;實際:${cover.roots.join(' | ')}`).toBe(true);
    expect(cover.covers, '放大層蓋滿整個視窗').toBe(true);
    expect(cover.containsBig, '放大的圖在那一層裡').toBe(true);
  });

  it('d. 高圖(60×240)放大:高度放到視窗的 480、寬按比例,不超出', async () => {
    const s = await zoomSetup('tall');
    const big = await openZoom(s);
    expect(Math.abs(big.rect.h - VIEWPORT.height), `高 ${big.rect.h}`).toBeLessThanOrEqual(2);
    expect(Math.abs(big.rect.w / big.rect.h - 0.25), '寬高比 1:4').toBeLessThan(0.01);
    expect(big.rect.x).toBeGreaterThanOrEqual(-0.5);
    expect(big.rect.x + big.rect.w).toBeLessThanOrEqual(VIEWPORT.width + 0.5);
    expect(big.rect.y + big.rect.h).toBeLessThanOrEqual(VIEWPORT.height + 0.5);
  });

  it('d. 放大期間在原本「下一個」的位置按一下(真指標):放大層關掉、/__review 0 個請求、標題沒換、捲動位置不變', async () => {
    const s = await zoomSetup('zoom');
    const titleBefore = await title(a().page);
    const seenBefore = await methods(a().page);
    await openZoom(s);
    await a().input.click(s.button.x, s.button.y);
    await sleep(700);
    expect(await isClosed(a().page, s.orig.src), '放大層要關掉').toBe(true);
    const seenAfter = await methods(a().page);
    expect(seenAfter.slice(seenBefore.length), `關的那一下不能穿過去按到底下的按鈕;多出來的請求:${seenAfter.slice(seenBefore.length).join(',')}`).toEqual([]);
    expect(await title(a().page), '卡片沒換').toBe(titleBefore);
    const scrollTop = await a().page.evaluate<number>(`document.querySelector('.hud-body').scrollTop`);
    expect(Math.abs(scrollTop - s.scrollTop), `捲動位置不變(前 ${s.scrollTop}、後 ${scrollTop})`).toBeLessThan(1);
    const hit = await a().page.evaluate<string>(`(() => { const e = document.elementFromPoint(${s.button.x}, ${s.button.y}); const b = e && e.closest('button'); return b ? b.textContent.replace(/\\s+/g, '') : 'x'; })()`);
    expect(hit, '關掉之後,原本的位置又是「下一個」').toBe('下一個');
  });

  it('d. 按放大的圖本身關掉;按放大層的角落(圖外,內縮到 HudPanel 的 10px 切角外)也關掉;兩次都不送請求、不換卡', async () => {
    const s = await zoomSetup('zoom');
    const titleBefore = await title(a().page);
    const seenBefore = await methods(a().page);
    const big = await openZoom(s);
    await a().input.click(big.rect.x + big.rect.w / 2, big.rect.y + big.rect.h / 2);
    await sleep(500);
    expect(await isClosed(a().page, s.orig.src), '按圖本身:關掉').toBe(true);
    await openZoom(s);
    await a().input.click(12, 12);
    await sleep(500);
    expect(await isClosed(a().page, s.orig.src), '按角落(圖外):關掉').toBe(true);
    expect((await methods(a().page)).slice(seenBefore.length), '沒有請求').toEqual([]);
    expect(await title(a().page)).toBe(titleBefore);
  });

  it('d. 按 Esc 關掉(真的鍵盤);回到原本的卡片,捲動位置不變;放大時沒有載第二份圖(同一個網址只有一個請求)', async () => {
    const s = await zoomSetup('zoom');
    const requestsBefore = await imgRequests(a().page);
    await openZoom(s);
    await a().input.key('Escape');
    await sleep(500);
    expect(await isClosed(a().page, s.orig.src), 'Esc:關掉').toBe(true);
    const scrollTop = await a().page.evaluate<number>(`document.querySelector('.hud-body').scrollTop`);
    expect(Math.abs(scrollTop - s.scrollTop), `捲動位置不變(前 ${s.scrollTop}、後 ${scrollTop})`).toBeLessThan(1);
    const requestsAfter = await imgRequests(a().page);
    expect([...new Set(requestsAfter)], '放大前後,圖片的網址只有原本那一個').toEqual([...new Set(requestsBefore)]);
    expect(new Set(requestsAfter).size, '只有一張圖').toBe(1);
  });

  // ---- 找不到與拒絕(e)

  async function mixed(): Promise<void> {
    await prepare(a(), 'mixed');
    expect(await waitFor(a().page, `document.body.innerText.includes(${JSON.stringify(MISSING_TEXT)})`, 10_000), `不存在的圖要出現字樣;畫面文字:${await pageText(a().page)};圖:${JSON.stringify(await imgFacts(a().page))}`).toBe(true);
    await sleep(300);
  }

  it('e. 圖片不存在:位置換成「找不到圖片:assets/t46-missing.png」,不留破圖也不留空的 img', async () => {
    await mixed();
    const text = await pageText(a().page);
    expect(text).toContain(MISSING_TEXT);
    const facts = await imgFacts(a().page);
    expect(facts.filter((f) => f.src.includes('t46-missing')), '缺的那張不能還有 img').toEqual([]);
    const broken = facts.filter((f) => f.complete && f.nw === 0);
    expect(broken.map((f) => f.src), '不能有破圖(載好了卻沒有圖的 img)').toEqual([]);
    expect(await a().page.evaluate<number>(`document.querySelectorAll('.hud-body img:not([src]), .hud-body img[src=""]').length`), '沒有空的 img').toBe(0);
  });

  it('e. 會被拒絕的路徑(raw、https、data):「圖片路徑不能用:<原文>」,沒有 img、圖片請求與外部網址 0 個', async () => {
    await mixed();
    const text = await pageText(a().page);
    for (const raw of ['../../raw/demo/x.png', 'https://example.invalid/x.png', 'data:image/png;base64,AAAA']) {
      expect(text, `「圖片路徑不能用:${raw}」`).toContain(`圖片路徑不能用:${raw}`);
    }
    const facts = await imgFacts(a().page);
    for (const bad of ['raw/', 'example.invalid', 'data:image', 'x.png']) {
      expect(facts.filter((f) => f.src.includes(bad)).map((f) => f.src), `不能有 img 要「${bad}」`).toEqual([]);
    }
    expect(await externalRequests(a().page), '不能有任何外部網址的請求').toEqual([]);
    // 圖片請求只准是存在的、缺的(404)、內文的、中文檔名那幾張
    const safeDecode = (s: string): string => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    };
    const allowed = ['t46-ok.png', 't46-missing.png', 't46-b.png', '同源.png'];
    const stray = (await imgRequests(a().page)).filter((r) => !allowed.some((name) => safeDecode(r).includes(name)));
    expect(stray, '圖片請求只准是存在的與缺的那幾張(raw、x.png 都不准)').toEqual([]);
  });

  it('e. 路徑含角括號、引號、&:字樣裡看得到原字,DOM 沒有多出元素或屬性,沒有執行', async () => {
    await mixed();
    const text = await pageText(a().page);
    expect(text, '原字照樣看得到').toContain(`圖片路徑不能用:${EVIL_PATH}`);
    expect(await a().page.evaluate<number>(`document.querySelectorAll('.hud-body b, .hud-body i').length`), '沒有多出 <b>、<i>').toBe(0);
    expect(await a().page.evaluate<number>(`document.querySelectorAll('.hud-body [onerror]').length`), '沒有 onerror 屬性').toBe(0);
    expect(await a().page.evaluate<boolean>(`document.querySelector('img[src="x"]') === null`), '沒有 src=x 的 img').toBe(true);
    expect(await a().page.evaluate<unknown>(`window.__t46pwn ?? null`), '沒有執行').toBe(null);
  });

  it('e. 卡片其他部分照常:標題、內文、兩個例子、存在的圖(例子裡、內文裡、中文檔名)、按鈕都在;「下一個」按得下去', async () => {
    await mixed();
    const text = await pageText(a().page);
    for (const piece of ['T46-BODY', 'T46-E1', 'T46-E2', 'T46-E2-a']) expect(text, piece).toContain(piece);
    expect(await title(a().page)).not.toBe('');
    const info1 = await info(a().page);
    expect(info1.map((e) => e.heading), '兩個例子的標題').toEqual(['例子 1', '例子 2']);
    expect(info1.map((e) => e.open)).toEqual([true, true]);
    const facts = await imgFacts(a().page);
    const shown = facts.filter((f) => f.complete && f.nw > 0).map((f) => decodeURIComponent(f.src));
    for (const name of ['t46-ok.png', 't46-b.png', '同源.png']) {
      expect(shown.some((s) => s.includes(name)), `${name} 要載得出來;載好的:${shown.join(' | ')}`).toBe(true);
    }
    for (const label of ['下一個', '換類別', '深入這個']) {
      expect(await a().page.evaluate<boolean>(`Boolean(${BUTTON(label)})`), `按鈕「${label}」在`).toBe(true);
    }
    const t0 = await title(a().page);
    await a().page.evaluate('window.__t46.methods.length = 0');
    await clickButtonReal(a(), '下一個');
    expect(await waitFor(a().page, `window.__t46.methods.includes('teach.next')`, 5000), '「下一個」要送出 teach.next').toBe(true);
    expect(await waitFor(a().page, `document.querySelector('h2').textContent.trim() !== ${JSON.stringify(t0)}`, 10_000), '換卡').toBe(true);
  });

  it('e. 佔位字樣不能放大:按「找不到圖片」與「圖片路徑不能用」的字,不出現放大層、沒有新的 img', async () => {
    await mixed();
    const before = await imgFacts(a().page);
    for (const needle of [MISSING_TEXT, '圖片路徑不能用:../../raw/demo/x.png']) {
      const at = await a().page.evaluate<Pt | null>(`(() => {
        const walker = document.createTreeWalker(document.querySelector('.hud-body'), NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.textContent.indexOf(${JSON.stringify(needle)});
          if (i < 0) continue;
          n.parentElement.scrollIntoView({ block: 'center' });
          const range = document.createRange();
          range.setStart(n, i);
          range.setEnd(n, i + 3);
          const r = range.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return null;
      })()`);
      expect(at, `畫面上要找得到「${needle}」`).toBeTruthy();
      await sleep(100);
      const at2 = await a().page.evaluate<Pt>(`(() => {
        const walker = document.createTreeWalker(document.querySelector('.hud-body'), NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.textContent.indexOf(${JSON.stringify(needle)});
          if (i < 0) continue;
          const range = document.createRange();
          range.setStart(n, i);
          range.setEnd(n, i + 3);
          const r = range.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return { x: 0, y: 0 };
      })()`);
      await a().input.click(at2.x, at2.y);
      await sleep(400);
      const after = await imgFacts(a().page);
      expect(after.length, `按「${needle}」不能多出 img`).toBe(before.length);
    }
  });
});

// ================================================================ G3:深入、回上一層也從「最後一次按的」開始(真的生出子卡,所以自己一個 app)

describe('T46 渲染(a):深入這個、回上一層', () => {
  let app: App | undefined;
  beforeAll(async () => {
    app = await start();
  });
  afterAll(async () => {
    await stop(app);
  });
  const a = (): App => {
    if (!app) throw new Error('教學卡沒有開起來');
    return app;
  };

  it('a. 收起 → 「深入這個」:子卡的例子從第一幀就收起;展開 → 「回上一層」:上一層的卡從第一幀就是展開', async () => {
    await prepare(a(), 'one');
    await clickHeading(a(), 0); // 收起
    expect(await opens(a().page)).toEqual([false]);
    await a().page.evaluate('window.__t46.clear()');
    await clickButtonReal(a(), '深入這個');
    expect(await waitFor(a().page, `/來自:/.test(document.querySelector('.markers')?.textContent ?? '') && document.querySelector('.lc-example')`, 60_000), `深入之後要出現子卡;畫面文字:${await pageText(a().page)}`).toBe(true);
    await sleep(500);
    await expectAllFrames(a().page, false, '深入到子卡(最後按的是收起)');
    await clickHeading(a(), 0); // 展開
    expect(await opens(a().page)).toEqual([true]);
    expect(await waitFor(a().page, `${BUTTON('回上一層')}`, 5000), '子卡要有「回上一層」').toBe(true);
    await a().page.evaluate('window.__t46.clear()');
    await clickButtonReal(a(), '回上一層');
    expect(await waitFor(a().page, `!/來自:/.test(document.querySelector('.markers')?.textContent ?? '') && document.querySelector('.lc-example')`, 10_000), `回上一層之後要是原本那張;畫面文字:${await pageText(a().page)}`).toBe(true);
    await sleep(500);
    await expectAllFrames(a().page, true, '回上一層(最後按的是展開)');
    await quiesce(a().page);
  });
});
