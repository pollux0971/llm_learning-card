/**
 * 14-hud-skin phase-1 修補(工單 T14)的渲染量測:headless Chrome 把展示頁畫出來,量像素與計算樣式。
 *
 * 給 vitest(`hud/render.test.ts`)與 cucumber(`features/steps/hud-skin-render.steps.ts`)共用,兩邊跑同一份檢查。
 * 規格作者(UI/Tauri 負責人)寫;開發 worker 不改。檔名以 `test-support.ts` 結尾,所以
 * `test-support.ts` 的 `hudSourceFiles()` 會把它當測試輔助排除,不會被「hud/ 原始碼」的掃描掃到。
 *
 * ── 怎麼畫 ──────────────────────────────────────────────────────────────
 * - 展示頁:用 vite 的 `createServer` 起 `gallery/` 的 dev server(跟 FEATURE.md 的單獨執行指令同一份設定)。
 * - 瀏覽器:Chrome / Chromium 的 headless(`--headless=new`),暫存的 user-data-dir,`--force-color-profile=srgb`
 *   讓截圖的顏色等於 CSS 的顏色。位置:環境變數 `LC_CHROME`,否則找常見路徑;**找不到就丟錯(紅),不跳過**。
 * - 視窗 720 × 900、deviceScaleFactor 1:截圖的一個像素就是一個 CSS 像素。
 * - 不送滑鼠鍵盤:hover / focus 用 DevTools 的 `CSS.forcePseudoState`。
 * - 每一項檢查都先重新載入展示頁,檢查之間不互相影響。
 *
 * ── 釘住的東西(開發 worker 照這個做)──────────────────────────────────────
 * - DOM 掛鉤沿用 `test-support.ts`:`data-hud="panel"`、`data-hud="button"`。
 * - 面板的顏色與不透明度只看 `hud.css` 的 `--hud-panel`(`getComputedStyle(:root)` 讀出來)。
 * - 展示頁的面板在沒有 `hud-frameless` 時,左右兩邊各有至少 8px 沒有字的內距(現在是 0.95rem)。
 * - 展示頁有一個深色背景的切換:`<input type="checkbox" data-gallery="dark-backdrop">`,勾起來就換成深色背景
 *   (高對比的圖樣,例如深色底加粗格線)。只寫在 `gallery/Gallery.svelte`;顏色照舊只能用 `var(--hud-*)`。預設不勾 = 原本的格線。
 * - 其餘都是量出來的結果,不綁做法:黑線怎麼畫、焦點怎麼畫,由實作者決定。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { HUD_DIR, flattenRules, parseColor, readHudCss, type Rgba } from './test-support.js';

// ───────────────────────────── PNG(Chrome 截圖)解碼:8 位元 RGB / RGBA,不交錯
export interface Image { width: number; height: number; data: Uint8Array }

export function decodePng(buf: Uint8Array): Image {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => buf[i] === b)) throw new Error('不是 PNG');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let width = 0; let height = 0; let colorType = -1; let bitDepth = 0; let interlace = 0;
  const idat: Uint8Array[] = [];
  while (pos < buf.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(buf[pos + 4]!, buf[pos + 5]!, buf[pos + 6]!, buf[pos + 7]!);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
      width = v.getUint32(0); height = v.getUint32(4); bitDepth = body[8]!; colorType = body[9]!; interlace = body[12]!;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`不支援的 PNG(bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let v = line[i]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`PNG filter ${filter}`);
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      out[(y * width + x) * 4] = cur[x * bpp]!;
      out[(y * width + x) * 4 + 1] = cur[x * bpp + 1]!;
      out[(y * width + x) * 4 + 2] = cur[x * bpp + 2]!;
      out[(y * width + x) * 4 + 3] = bpp === 4 ? cur[x * bpp + 3]! : 255;
    }
    prev = cur;
  }
  return { width, height, data: out };
}

export function px(img: Image, x: number, y: number): [number, number, number] {
  const xi = Math.round(x); const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) throw new Error(`像素 (${xi},${yi}) 在截圖外`);
  const i = (yi * img.width + xi) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}
const luma = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * 沿著一條跨過邊框的短線量「墨水量」:Σ (底色 − 這一格) / 底色。1 像素的純黑線 ≈ 1,不管它落在整數還是半個像素上
 * (半個像素時會變成兩格各 50% 灰,加起來還是 ≈ 1)。2 像素寬的線 ≈ 2。
 * 底色取兩端(線外、線內)比較暗的那一個:半透明面板比外面亮,不能把外面的底色也算成墨水。
 */
export function inkAcross(img: Image, points: [number, number][]): number {
  const lum = points.map(([x, y]) => luma(px(img, x, y)));
  const ref = Math.min(lum[0]!, lum[lum.length - 1]!);
  if (ref <= 0) return Number.POSITIVE_INFINITY;
  return lum.reduce((s, l) => s + Math.max(0, ref - l) / ref, 0);
}

/** 兩張同大小截圖裡「看得出不一樣」的像素數(任一通道差 > 32) */
export function differingPixels(a: Image, b: Image): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i]! - b.data[i]!) > 32 || Math.abs(a.data[i + 1]! - b.data[i + 1]!) > 32 || Math.abs(a.data[i + 2]! - b.data[i + 2]!) > 32) n += 1;
  }
  return n;
}

// ───────────────────────────── Chrome DevTools Protocol(Node 22 內建 WebSocket)
const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
];
export function findChrome(env: NodeJS.ProcessEnv = process.env): string {
  if (env['LC_CHROME']) {
    if (!existsSync(env['LC_CHROME'])) throw new Error(`LC_CHROME=${env['LC_CHROME']} 不存在`);
    return env['LC_CHROME'];
  }
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error(`找不到 Chrome / Chromium(試過 ${CHROME_CANDIDATES.join('、')});設 LC_CHROME 指到執行檔。渲染檢查不跳過。`);
  return found;
}

interface CdpMessage { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string } }
class Cdp {
  private id = 0;
  private readonly pending = new Map<number, (m: CdpMessage) => void>();
  private readonly listeners: { method: string; fn: (p: Record<string, unknown>) => void }[] = [];
  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as CdpMessage;
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        this.pending.get(msg.id)!(msg);
        this.pending.delete(msg.id);
        return;
      }
      for (const l of [...this.listeners]) if (l.method === msg.method) l.fn(msg.params ?? {});
    };
  }
  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`連不上 DevTools ${url}`));
    });
    return new Cdp(ws);
  }
  async send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = (this.id += 1);
    const msg = await new Promise<CdpMessage>((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
    if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
    return (msg.result ?? {}) as T;
  }
  once(method: string, timeoutMs = 20_000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等不到 ${method}`)), timeoutMs);
      const l = { method, fn: (p: Record<string, unknown>) => { clearTimeout(timer); this.listeners.splice(this.listeners.indexOf(l), 1); resolve(p); } };
      this.listeners.push(l);
    });
  }
  close(): void { this.ws.close(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const VIEWPORT = { width: 720, height: 900 } as const;

export interface Rect { x: number; y: number; width: number; height: number }

export interface GalleryPage {
  readonly url: string;
  /** 重新載入展示頁,等字型與開場動畫結束 */
  reset(): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
  rect(selector: string, index?: number): Promise<Rect>;
  screenshot(clip?: Rect): Promise<Image>;
  /** 對第 index 個符合 selector 的元素強制 :hover / :focus 之類的狀態;傳 [] 清掉 */
  forceState(selector: string, index: number, states: string[]): Promise<void>;
  close(): Promise<void>;
}

/** 起 vite dev server 與 headless Chrome,開好展示頁。呼叫端負責 close()。 */
export async function openGallery(): Promise<GalleryPage> {
  return openApp(join(HUD_DIR, 'gallery'));
}

export interface OpenAppOptions {
  /** 視窗大小,預設 720 × 900(展示頁);卡片用 360 × 480 */
  viewport?: { width: number; height: number };
  /** reset() 等到這個選擇器出現才算載好(最多 5 秒,到時不丟錯,讓後面的檢查自己報「找不到」);預設面板 */
  ready?: string;
  /**
   * 每次載入頁面時、在頁面自己的腳本之前執行的一段程式(CDP 的 Page.addScriptToEvaluateOnNewDocument)。
   * 跟 Tauri 的 `initialization_script` 同一個時機:document 還沒有 body。T34 用它把 Rust 組出來的提示程式交給真 Chrome。
   */
  initScript?: string;
  /** dev server 回應的標頭(例如 Tauri 的 CSP,看提示程式有沒有被它擋);預設沒有 */
  headers?: Record<string, string>;
}

/**
 * 通用版:起 `appDir`(有 index.html 與 vite.config.ts 的目錄)的 vite dev server 與 headless Chrome。
 * T15 起卡片(apps/teach-card、apps/test-card)也用它;傳目錄路徑,不 import 卡片的模組。
 */
export async function openApp(appDir: string, opts: OpenAppOptions = {}): Promise<GalleryPage> {
  const chrome = findChrome();
  const galleryDir = appDir;
  const viewport = opts.viewport ?? VIEWPORT;
  const ready = opts.ready ?? '[data-hud="panel"]';
  if (!existsSync(join(galleryDir, 'index.html'))) throw new Error(`${galleryDir}/index.html 不存在`);
  const { createServer } = await import('vite');
  const configFile = existsSync(join(galleryDir, 'vite.config.ts')) ? join(galleryDir, 'vite.config.ts') : false;
  const server = await createServer({
    configFile, root: galleryDir, logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, ...(opts.headers ? { headers: opts.headers } : {}) },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) { await server.close(); throw new Error('vite dev server 沒有給出網址'); }

  const profile = mkdtempSync(join(tmpdir(), 'hud-render-chrome-'));
  let proc: ChildProcess | undefined;
  let cdp: Cdp | undefined;
  const cleanup = async () => {
    cdp?.close();
    if (proc?.pid !== undefined && proc.exitCode === null) {
      // Chrome 會開好幾個子行程(renderer、gpu…),整個行程群組一起收,等主行程結束再刪暫存 profile
      const exited = new Promise((r) => proc!.once('exit', r));
      const group = -proc.pid;
      try { process.kill(group, 'SIGTERM'); } catch { /* 已經結束 */ }
      await Promise.race([exited, sleep(3000)]);
      try { process.kill(group, 'SIGKILL'); } catch { /* 已經結束 */ }
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await server.close();
  };
  try {
    proc = spawn(chrome, [
      '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking',
      '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank',
    ], { stdio: 'ignore', detached: true });
    const portFile = join(profile, 'DevToolsActivePort');
    let port = '';
    for (let i = 0; i < 200 && !port; i += 1) {
      if (existsSync(portFile)) port = readFileSync(portFile, 'utf8').split('\n')[0]!.trim();
      if (!port) await sleep(50);
    }
    if (!port) throw new Error('Chrome 沒有在 10 秒內打開 DevTools 埠');
    let pageWs = '';
    for (let i = 0; i < 100 && !pageWs; i += 1) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        pageWs = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? '';
      } catch { /* 還沒好 */ }
      if (!pageWs) await sleep(50);
    }
    if (!pageWs) throw new Error('Chrome 沒有 page target');
    cdp = await Cdp.connect(pageWs);
    for (const d of ['Page.enable', 'Runtime.enable', 'DOM.enable', 'CSS.enable']) await cdp.send(d);
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
    if (opts.initScript !== undefined) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: opts.initScript });
  } catch (e) {
    await cleanup();
    throw e;
  }
  const c = cdp;

  const evaluate = async <T>(expression: string): Promise<T> => {
    const r = await c.send<{ result: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>(
      'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`頁面裡執行失敗:${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as T;
  };
  const page: GalleryPage = {
    url,
    async reset() {
      const loaded = c.once('Page.loadEventFired');
      await c.send('Page.navigate', { url });
      await loaded;
      await evaluate(`(async () => {
        for (let i = 0; i < 100 && !document.querySelector(${JSON.stringify(ready)}); i += 1) await new Promise((r) => setTimeout(r, 50));
        await document.fonts.ready;
        await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return true;
      })()`);
    },
    evaluate,
    async rect(selector, index = 0) {
      const r = await evaluate<Rect | null>(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
        if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height }; })()`);
      if (!r) throw new Error(`展示頁裡找不到 ${selector} 第 ${index + 1} 個`);
      return r;
    },
    async screenshot(clip) {
      const params: Record<string, unknown> = { format: 'png', captureBeyondViewport: false };
      if (clip) params['clip'] = { ...clip, scale: 1 };
      const r = await c.send<{ data: string }>('Page.captureScreenshot', params);
      return decodePng(Buffer.from(r.data, 'base64'));
    },
    async forceState(selector, index, states) {
      const doc = await c.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: -1 });
      const q = await c.send<{ nodeIds: number[] }>('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector });
      const nodeId = q.nodeIds[index];
      if (nodeId === undefined) throw new Error(`展示頁裡找不到 ${selector} 第 ${index + 1} 個`);
      await c.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states });
      await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
      await sleep(150); // 120ms 的轉場走完
    },
    close: cleanup,
  };
  await page.reset();
  return page;
}

// ───────────────────────────── 檢查(都回傳問題清單;空 = 通過)

/** 面板的設計色(`--hud-panel` 的計算值) */
async function panelColour(page: GalleryPage): Promise<Rgba> {
  const v = await page.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue('--hud-panel').trim()`);
  if (!v) throw new Error(':root 沒有 --hud-panel');
  return parseColor(v);
}

/** 展示頁的深色背景切換(只在 Gallery.svelte;觀感判定時用眼睛看半透明) */
export const DARK_BACKDROP_SWITCH = '[data-gallery="dark-backdrop"]';

/** 打開深色背景;沒有這個開關就回傳問題 */
async function switchDarkBackdrop(page: GalleryPage): Promise<string[]> {
  const ok = await page.evaluate<boolean>(`(() => {
    const c = document.querySelector(${JSON.stringify(DARK_BACKDROP_SWITCH)});
    if (!c) return false;
    if (!c.checked) c.click();
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
  })()`);
  return ok ? [] : [`展示頁沒有深色背景的切換(${DARK_BACKDROP_SWITCH} 的 checkbox)`];
}

interface PanelSample { x: number; y: number; got: [number, number, number]; behind: [number, number, number] }
/**
 * 面板左右內距各一條直線上的像素,以及「面板後面」同一個位置的像素
 * (把面板藏起來——visibility: hidden——再截一次)。
 */
async function samplePanel(page: GalleryPage, darkBackdrop: boolean): Promise<{ colour: Rgba; samples: PanelSample[]; behind: Image; rect: Rect } | string[]> {
  await page.reset();
  if (darkBackdrop) {
    const sw = await switchDarkBackdrop(page);
    if (sw.length) return sw;
  }
  const colour = await panelColour(page);
  const r = await page.rect('[data-hud="panel"]');
  const withPanel = await page.screenshot();
  await page.evaluate(`(() => { const s = document.createElement('style'); s.textContent = '[data-hud="panel"] { visibility: hidden !important; }'; document.head.append(s); return true; })()`);
  await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  const behind = await page.screenshot();
  const samples: PanelSample[] = [];
  for (const x of [Math.floor(r.x) + 5, Math.ceil(r.x + r.width) - 6]) {
    for (let y = Math.ceil(r.y) + 16; y <= Math.floor(r.y + r.height) - 16; y += 1) samples.push({ x, y, got: px(withPanel, x, y), behind: px(behind, x, y) });
  }
  return { colour, samples, behind, rect: r };
}

/**
 * G1:面板真的半透明。面板內距那一條直線上的每個像素,都要等於「--hud-panel 疊在面板後面那個像素上」。
 * 容許每個通道差 3。`darkBackdrop` 時先把展示頁切到深色背景再量。
 */
export async function panelSeeThroughProblems(page: GalleryPage, opts: { darkBackdrop?: boolean } = {}): Promise<string[]> {
  const s = await samplePanel(page, opts.darkBackdrop ?? false);
  if (Array.isArray(s)) return s;
  const { colour, samples } = s;
  if (!(colour.a > 0 && colour.a < 1)) return [`--hud-panel 的不透明度是 ${colour.a},不是半透明`];
  if (samples.length === 0) return ['面板太小,量不到'];
  const problems: string[] = [];
  for (const { x, y, got, behind } of samples) {
    const want = [colour.r, colour.g, colour.b].map((ch, i) => Math.round(ch * colour.a + behind[i]! * (1 - colour.a)));
    if (got.some((v, i) => Math.abs(v - want[i]!) > 3) && problems.length < 5) {
      problems.push(`(${x},${y}) 是 rgb(${got.join(',')}),面板後面是 rgb(${behind.join(',')}),半透明疊上去應該約 rgb(${want.join(',')})`);
    }
  }
  return problems;
}

/**
 * 深色背景:面板後面整片區域(每 4 像素取一點)的平均亮度上限(比中灰暗),
 * 與面板那兩條取樣線上的亮度起伏下限(高對比的圖樣要穿過取樣線,面板上才看得出來)。
 */
export const DARK_BACKDROP: { readonly maxMeanLuma: number; readonly minLumaRange: number } = { maxMeanLuma: 128, minLumaRange: 100 };

/**
 * 深色背景真的是深色、而且有高對比的圖樣穿過面板後面(這樣用眼睛才看得出面板是半透明)。
 * 量的是「面板後面」的像素(面板藏起來之後)。
 */
export async function darkBackdropProblems(page: GalleryPage): Promise<string[]> {
  const s = await samplePanel(page, true);
  if (Array.isArray(s)) return s;
  const problems: string[] = [];
  const area: number[] = [];
  for (let y = Math.ceil(s.rect.y); y < Math.floor(s.rect.y + s.rect.height); y += 4) {
    for (let x = Math.ceil(s.rect.x); x < Math.floor(s.rect.x + s.rect.width); x += 4) area.push(luma(px(s.behind, x, y)));
  }
  const mean = area.reduce((a, b) => a + b, 0) / Math.max(1, area.length);
  if (mean > DARK_BACKDROP.maxMeanLuma) problems.push(`深色背景在面板後面的平均亮度是 ${mean.toFixed(0)},要 ≤ ${DARK_BACKDROP.maxMeanLuma}`);
  let widest = 0;
  for (const x of [...new Set(s.samples.map((p) => p.x))]) {
    const lum = s.samples.filter((p) => p.x === x).map((p) => luma(p.behind));
    widest = Math.max(widest, Math.max(...lum) - Math.min(...lum));
  }
  if (widest < DARK_BACKDROP.minLumaRange) problems.push(`面板取樣線後面的亮度起伏只有 ${widest.toFixed(0)},要 ≥ ${DARK_BACKDROP.minLumaRange}(要有高對比的圖樣穿過面板後面)`);
  return problems;
}

/** 深色背景與格線都是展示頁的東西:共用的 hud.css 不提 gallery */
export function galleryOnlyProblems(): string[] {
  return /gallery/i.test(readHudCss().text) ? ['hud.css 提到 gallery(展示頁的背景與開關放在 gallery/ 裡)'] : [];
}

/** 一個元素四條直邊的線寬(在每條邊的正中間,跨邊各量 3 像素) */
export function edgeInk(img: Image, rect: Rect): Record<'top' | 'bottom' | 'left' | 'right', number> {
  const cx = rect.x + rect.width / 2; const cy = rect.y + rect.height / 2;
  const line = (from: [number, number], step: [number, number], n: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => [from[0] + step[0] * i, from[1] + step[1] * i] as [number, number]);
  const top = Math.round(rect.y); const bottom = Math.round(rect.y + rect.height) - 1;
  const left = Math.round(rect.x); const right = Math.round(rect.x + rect.width) - 1;
  return {
    top: inkAcross(img, line([Math.round(cx), top - 3], [0, 1], 7)),
    bottom: inkAcross(img, line([Math.round(cx), bottom - 3], [0, 1], 7)),
    left: inkAcross(img, line([left - 3, Math.round(cy)], [1, 0], 7)),
    right: inkAcross(img, line([right - 3, Math.round(cy)], [1, 0], 7)),
  };
}

/** 墨水量 1 像素的容許範圍(抗鋸齒與半像素位置) */
export const ONE_PIXEL_INK: readonly [number, number] = [0.7, 1.35];

/**
 * 框線在每條直邊都剛好 1 像素:面板四邊、三顆按鈕四邊。第 3 顆按鈕先把字換成純英文 `NEXT`(G3:
 * 字型行高不同時,按鈕被 flex 拉高,框看起來變粗)。換字只改文字節點,不動結構。
 */
export async function frameLineProblems(page: GalleryPage, opts: { latinOnlyThird?: boolean } = {}): Promise<string[]> {
  const latinOnlyThird = opts.latinOnlyThird ?? true;
  await page.reset();
  if (latinOnlyThird) await page.evaluate(`(() => {
    const b = document.querySelectorAll('[data-hud="button"]')[2];
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let first = true;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.trim()) continue;
      n.data = first ? 'NEXT' : '';
      first = false;
    }
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
  })()`);
  const img = await page.screenshot();
  const problems: string[] = [];
  const targets: [string, Rect][] = [['面板', await page.rect('[data-hud="panel"]')]];
  // T16 起展示頁後面多一顆停用的按鈕:停用是故意淡的(黑線也淡),不在這裡量 1 像素黑線(停用狀態由 window-frame-test-support.ts 的 disabledProblems 量)
  const enabled = await page.evaluate<number[]>(`[...document.querySelectorAll('[data-hud="button"]')].flatMap((b, i) => (b.disabled ? [] : [i]))`);
  for (const i of enabled) targets.push([`第 ${i + 1} 顆按鈕${i === 2 && latinOnlyThird ? '(NEXT)' : ''}`, await page.rect('[data-hud="button"]', i)]);
  for (const [name, rect] of targets) {
    const ink = edgeInk(img, rect);
    for (const [edge, v] of Object.entries(ink)) {
      if (!(v >= ONE_PIXEL_INK[0] && v <= ONE_PIXEL_INK[1])) problems.push(`${name}的${edge}邊框線量起來是 ${v.toFixed(2)} 像素,要 1 像素`);
    }
  }
  // 切角的斜邊也要有線(只量面板):在斜邊正中間那一列橫著量。45° 的線橫著量會是垂直粗細的 √2 倍:
  // 垂直 1 像素 ≈ 1.41,現在的 0.71 像素 ≈ 1.0;沒有線 ≈ 0
  const cut = parseFloat(await page.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue('--hud-cut')`));
  if (!(cut > 0)) problems.push(':root 沒有 --hud-cut');
  else {
    const p = targets[0]![1];
    const L = Math.round(p.x); const T = Math.round(p.y); const R = Math.round(p.x + p.width) - 1; const B = Math.round(p.y + p.height) - 1;
    const half = Math.round(cut / 2);
    const corners: [string, number, number][] = [['左上', L + half, T + half], ['右上', R - half, T + half], ['左下', L + half, B - half], ['右下', R - half, B - half]];
    for (const [where, x, y] of corners) {
      const v = inkAcross(img, Array.from({ length: 7 }, (_, i) => [x - 3 + i, y] as [number, number]));
      if (!(v >= DIAGONAL_INK[0] && v <= DIAGONAL_INK[1])) problems.push(`面板${where}切角的斜邊橫著量是 ${v.toFixed(2)},要在 ${DIAGONAL_INK[0]}–${DIAGONAL_INK[1]}(斜邊上要有一條細黑線)`);
    }
  }
  return problems;
}

/** 斜邊橫著量的墨水量範圍:垂直 0.71 到 1 像素的線(≈ 1.0–1.41),加抗鋸齒的餘裕 */
export const DIAGONAL_INK: readonly [number, number] = [0.6, 2.0];

/** 按鈕與它所有後代(含 ::before ::after)跟外觀有關的計算樣式,串成一個字串 */
const STYLE_SIGNATURE = `((b) => {
  const props = ['background-color', 'background-image', 'outline-style', 'outline-width', 'outline-color', 'outline-offset',
    'box-shadow', 'border-top-color', 'border-top-width', 'border-top-style', 'color', 'filter', 'opacity', 'text-decoration-line',
    'clip-path', 'mask-image', '-webkit-mask-image'];
  const parts = [];
  for (const e of [b, ...b.querySelectorAll('*')]) for (const pseudo of [null, '::before', '::after']) {
    const s = getComputedStyle(e, pseudo);
    parts.push(props.map((p) => s.getPropertyValue(p)).join('|'));
  }
  return parts.join('\\n');
})(document.querySelectorAll('[data-hud="button"]')[1])`;

/**
 * G5:鍵盤焦點(:focus-visible)要跟 hover 長得不一樣,也要跟一般狀態不一樣——看像素,不只看樣式
 * (樣式不同但被 clip-path 裁掉的話,像素還是一樣)。量第 2 顆按鈕,截圖範圍是按鈕外擴 6 像素。
 */
export async function focusDistinctProblems(page: GalleryPage): Promise<string[]> {
  await page.reset();
  const r = await page.rect('[data-hud="button"]', 1);
  const clip = { x: Math.floor(r.x) - 6, y: Math.floor(r.y) - 6, width: Math.ceil(r.width) + 12, height: Math.ceil(r.height) + 12 };
  const shotIn = async (states: string[]) => {
    await page.forceState('[data-hud="button"]', 1, states);
    return { img: await page.screenshot(clip), sig: await page.evaluate<string>(STYLE_SIGNATURE) };
  };
  const normal = await shotIn([]);
  const hover = await shotIn(['hover']);
  const focus = await shotIn(['focus', 'focus-visible']);
  await page.forceState('[data-hud="button"]', 1, []);
  const problems: string[] = [];
  const MIN = 30;
  const dHover = differingPixels(focus.img, hover.img);
  const dNormal = differingPixels(focus.img, normal.img);
  const dHoverNormal = differingPixels(hover.img, normal.img);
  if (dHoverNormal < MIN) problems.push(`hover 跟一般狀態只差 ${dHoverNormal} 個像素,看不出 hover`);
  if (dHover < MIN) problems.push(`focus-visible 跟 hover 只差 ${dHover} 個像素(至少要 ${MIN}),鍵盤使用者分不出焦點`);
  if (dNormal < MIN) problems.push(`focus-visible 跟一般狀態只差 ${dNormal} 個像素(至少要 ${MIN}),看不到焦點`);
  if (focus.sig === hover.sig) problems.push('focus-visible 與 hover 的計算樣式完全相同');
  return problems;
}

/** 選擇器是不是指「整個頁面」(html / :root / body),而且不是 hud-solid 那一條 */
function isPageRootSelector(selector: string): boolean {
  return selector.split(',').map((s) => s.trim()).some((s) => /^(html|:root|body|html\s+body|:root\s+body)$/i.test(s));
}
const TRANSPARENT = /^(transparent|none|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|initial|unset)$/i;

/**
 * G2:共用的 hud.css 不替頁面畫底色或格線(格線是展示頁假裝桌面用的,搬到 Gallery.svelte)。
 * 指整個頁面的規則(html、:root、body)不准設 background / background-color / background-image,
 * 只有帶 `hud-solid` 的規則(實心底退路)可以。
 */
export function rootBackgroundProblems(): string[] {
  const problems: string[] = [];
  for (const { rule } of flattenRules(readHudCss().nodes)) {
    if (/hud-solid/.test(rule.selector) || !isPageRootSelector(rule.selector)) continue;
    for (const k of ['background', 'background-color', 'background-image']) {
      const v = rule.decls[k];
      if (v !== undefined && !TRANSPARENT.test(v.trim())) problems.push(`hud.css 的「${rule.selector}」設了 ${k}: ${v}`);
    }
  }
  return problems;
}

/** G6:Rajdhani 的 @font-face 有 size-adjust,而且是放大(> 100%) */
export function sizeAdjustProblems(): string[] {
  const faces = readHudCss().nodes.filter((n) => n.kind === 'at' && n.name === 'font-face' && /rajdhani/i.test(n.decls['font-family'] ?? ''));
  if (faces.length === 0) return ['hud.css 沒有 Rajdhani 的 @font-face'];
  const problems: string[] = [];
  for (const f of faces) {
    const v = f.kind === 'at' ? f.decls['size-adjust'] : undefined;
    if (v === undefined) problems.push('Rajdhani 的 @font-face 沒有 size-adjust');
    else if (!(/%$/.test(v.trim()) && parseFloat(v) > 100)) problems.push(`Rajdhani 的 size-adjust 是 ${v},要大於 100%`);
  }
  return problems;
}

/**
 * 大寫拉丁字母高度 ÷ 中文字高度,允許的範圍(同一個字級、同一串顯示字型)。
 * 參考:Noto Sans CJK TC 自己的「H」是「國」的 0.81(47 / 58 px @64px,Chrome 142 量),那就是中文字型裡「看起來相配」的比例;
 * 沒有 size-adjust 的 Rajdhani 是 0.72(42 / 58)。
 */
export const CAP_TO_CJK: readonly [number, number] = [0.78, 0.92];

/**
 * G6:中英混排時,Rajdhani 的大寫看起來跟中文差不多高。用畫布量字形的實際高度:
 * 同一個字級、同一串顯示字型(`[data-hud="button"]` 的 font-family),量「H」與「國」。
 * 「H」由 Rajdhani 畫,「國」由後備的中文字型畫,跟真的混排一樣。
 */
export async function capHeightRatio(page: GalleryPage): Promise<{ ratio: number; latin: number; cjk: number; family: string }> {
  await page.reset();
  return page.evaluate(`(async () => {
    const family = getComputedStyle(document.querySelector('[data-hud="button"]')).fontFamily;
    await document.fonts.load('500 64px ' + family, 'H國');
    const c = document.createElement('canvas').getContext('2d');
    const h = (t) => { c.font = '500 64px ' + family; const m = c.measureText(t); return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent; };
    const latin = h('H'); const cjk = h('國');
    return { ratio: latin / cjk, latin, cjk, family };
  })()`);
}
export async function capHeightProblems(page: GalleryPage): Promise<string[]> {
  const m = await capHeightRatio(page);
  if (!/rajdhani/i.test(m.family.split(',')[0] ?? '')) return [`按鈕的第一順位字型不是 Rajdhani(${m.family})`];
  if (m.ratio >= CAP_TO_CJK[0] && m.ratio <= CAP_TO_CJK[1]) return [];
  return [`大寫「H」高 ${m.latin.toFixed(1)}px、中文「國」高 ${m.cjk.toFixed(1)}px,比例 ${m.ratio.toFixed(3)},要在 ${CAP_TO_CJK[0]}–${CAP_TO_CJK[1]} 之間`];
}
