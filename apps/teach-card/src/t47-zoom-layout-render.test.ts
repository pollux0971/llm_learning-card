/**
 * T47(教學卡的縮放、長內容不弄丟按鈕、視窗大小;07-teach-card phase-4 場景 6–8)渲染測試。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T47-teach-card-zoom-layout.md 「驗收條件 1」的渲染測試 a、b、c、d、f(靜態 e 在 t47-window-static.test.ts)。
 *
 * 真的把 `App.svelte` 畫出來:`openApp(apps/teach-card, { viewport, initScript })`,單獨執行的 vite dev server + 真的側車 + headless Chrome。
 * 縮放鍵用「真的鍵盤」(連同一個 Chrome 的第二條 CDP:Input.dispatchKeyEvent,含 Ctrl / Shift / 數字鍵盤的 key、code、location);
 * 按鈕用真的指標。量的都是畫面(Range 的寬度、getBoundingClientRect、computed style、elementFromPoint),不看原始碼字串。
 *
 * 取捨(工單沒寫死的地方):
 *   - 「內容變一級」不讀 computed font-size(`zoom` 與 `font-size` 兩種做法都該過):量「看得到的大小」。
 *     內文、例子裡一行 10 個全形字的 Range 寬度、標題 h2 的 Range 寬度、例子裡的圖的寬,各自跟「同一張卡 100% 時」的比,要等於級距(文字 ±2%,圖 ±0.5 px)。
 *   - 「按鈕列、系統狀態字樣、標題列不縮放」:同一張卡每一級的「下一個」寬高與字級、`.controls` 與 `.status-slot` 的高、標題列的高都跟 100% 時相同。
 *   - 「重排不是 transform」:一段很長的內文,行數隨級距增加(80% < 100% < 150%);`.hud-body` 裡與它的祖先沒有 computed transform。
 *   - 黏住的那一塊不寫死是哪個元素:從「下一個」往上找 computed `position: sticky` 的祖先;它要包含 `.controls` 與 `.status-slot`。
 *   - 側車的 `teach.next` 會把卡標成學過、fixture 只有 3 張:每條測試開頭把暫存根的 `state/reviews.json` 寫回 `{}`,再整頁重新載入。
 *   - 圖(`assets/t47-img.png`)由測試自己寫進暫存根的 `assets/`。
 *   - 每條測試收尾直接送 teach.cancel(quiesce);d 的轉換會扣住 teach.poll,收尾要放行。
 *
 * 對應工單 must_catch:
 *   a 縮放鍵、到頭不動、還原、換卡/重載照舊、按鈕列與系統字樣與標題列不變;
 *   b 每一級 × 四種視窗大小:無橫向捲動、行數隨級距增加(重排)、沒有 transform;
 *   c 很長的例子:捲到上、中、下,按鈕列整塊看得到、打得到、位置不變(兩種視窗高度、含 150%);黏住的那一塊有底色、沒有框線與陰影;
 *   d 縮放下 T45 的轉換(短卡、長卡捲到底、長卡捲到中間):按鈕矩形差 0、捲動位置不變;
 *   f Wayland 提示在時,黏在下面的按鈕列不被提示蓋住(矩形不重疊、中心點打得到)。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WAYLAND_NOTE_DISMISS_LABEL, WAYLAND_NOTE_JS, WAYLAND_NOTE_TEXT } from '../../../packages/ui-shared/src/hud/card-design-values-test-support.js';
import { openApp, type GalleryPage } from '../../../packages/ui-shared/src/hud/render-test-support.js';
import { KEYS, RealInput, newLearningRoot, writeImage, type KeySpec } from './t47-test-support.js';

// 每條都真的起 vite、headless Chrome、側車:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const ROOT = join(import.meta.dirname, '../../..');
const TEACH_DIR = join(import.meta.dirname, '..');
const VIEWPORT = { width: 360, height: 480 } as const;
const WINDOW_MODE_JS = join(ROOT, 'apps/desktop/src-tauri/src/window_mode.js');
const CREDENTIALS = pathToFileURL(join(ROOT, 'packages/core/src/llm/credentials.ts')).href;

const LEVELS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
const LEVEL_STEPS = (level: number): { dir: 'in' | 'out'; times: number } => {
  const i = LEVELS.indexOf(level as (typeof LEVELS)[number]);
  if (i < 0) throw new Error(`不是級距:${level}`);
  const from = LEVELS.indexOf(1);
  return i >= from ? { dir: 'in', times: i - from } : { dir: 'out', times: from - i };
};

// ---------------------------------------------------------------- 卡片內容

const TEXT_BODY = '一二三四五六七八九十';
const TEXT_EXAMPLE = '十九八七六五四三二一';
const PARA = '這是一段用來數行數的內文,它夠長所以在三百六十寬的視窗裡會折成很多行,縮放之後折行的位置會跟著變。'.repeat(3);
const LIST_LINES = (n: number): string => Array.from({ length: n }, (_, i) => `- 補充的第 ${i + 1} 行,讓例子很長`).join('\n');
const IMG = '![圖](../../assets/t47-img.png)';

const BODIES = {
  /** 一般卡:內文一行字、長段落、例子(一行字 + 圖) */
  plain: ['T47-BODY 內文。', '', TEXT_BODY, '', PARA, '', '```example', '例子:', '', `- ${TEXT_EXAMPLE}`, '', IMG, '```'].join('\n'),
  /** 很長的例子:40 行清單,捲得動(≥ 300 px) */
  long: ['T47-BODY 內文。', '', TEXT_BODY, '', PARA, '', '```example', '很長的例子:', '', `- ${TEXT_EXAMPLE}`, LIST_LINES(40), '', IMG, '```'].join('\n'),
  /** 短卡:沒有例子,內文放得下 */
  short: ['T47-BODY 短卡。', '', TEXT_BODY].join('\n'),
} as const;
type BodyKey = keyof typeof BODIES;

// ---------------------------------------------------------------- 頁面腳本

const COLLECT_ERRORS = `(() => {
  window.__lcErrors = [];
  const push = (kind, text) => window.__lcErrors.push(kind + ': ' + text);
  window.addEventListener('error', (e) => push('error', e.message));
  window.addEventListener('unhandledrejection', (e) => push('rejection', String(e.reason)));
})();`;

const FETCH_SCRIPT = `(() => {
  const orig = window.fetch.bind(window);
  const st = (window.__t47 = { methods: [], hold: false, holdError: null, waiters: [], inject: {}, keys: [] });
  st.release = () => {
    st.hold = false;
    for (const wake of st.waiters.splice(0)) wake();
  };
  // 每個 keydown 的事件物件留著,之後才看有沒有被 preventDefault(App 的處理在冒泡階段,比這個捕獲階段晚)
  window.addEventListener('keydown', (e) => st.keys.push(e), true);
  const errorResponse = (id, error) =>
    new Response(JSON.stringify({ v: 1, id, ok: false, error }), { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/__card')) {
      const res = await orig(input, init);
      const text = await res.text();
      let body = '';
      try { body = localStorage.getItem('t47.body') || ''; } catch { body = ''; }
      if (!body) return new Response(text, { status: res.status, headers: { 'content-type': 'text/plain' } });
      const fm = /^---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n?/.exec(text);
      return new Response((fm ? fm[0] : '') + body, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (!url.includes('/__review')) return orig(input, init);
    const req = JSON.parse(init.body);
    st.methods.push(req.method);
    const queue = st.inject[req.method];
    if (queue && queue.length > 0) return errorResponse(req.id, queue.shift());
    if (req.method === 'teach.poll' && st.hold) {
      await new Promise((wake) => st.waiters.push(wake));
      if (st.holdError) {
        const error = st.holdError;
        st.holdError = null;
        return errorResponse(req.id, error);
      }
    }
    return orig(input, init);
  };
})();`;

function initScript(opts: { frameless: boolean; wayland: boolean }): string {
  const mode = opts.frameless ? `window.__LC_WINDOW_MODE__ = ${JSON.stringify({ frameless: true, solid: false })};\n${readFileSync(WINDOW_MODE_JS, 'utf8')}` : '';
  const note = opts.wayland && existsSync(WAYLAND_NOTE_JS) ? readFileSync(WAYLAND_NOTE_JS, 'utf8') : '';
  return `${COLLECT_ERRORS}\n${mode}\n${note}\n${FETCH_SCRIPT}`;
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
const title = (page: GalleryPage): Promise<string> => page.evaluate<string>(`document.querySelector('h2')?.textContent.trim() ?? ''`);
const methods = (page: GalleryPage): Promise<string[]> => page.evaluate<string[]>('window.__t47.methods.slice()');

async function injectError(page: GalleryPage, method: string, kind: string, message: string): Promise<void> {
  await page.evaluate(`(() => { (window.__t47.inject[${JSON.stringify(method)}] ??= []).push(${JSON.stringify({ kind, message })}); return true; })()`);
}

async function quiesce(page: GalleryPage): Promise<void> {
  await page.evaluate(`(async () => {
    window.__t47.holdError = null;
    window.__t47.release();
    const res = await fetch('/__review', { method: 'POST', body: JSON.stringify({ v: 1, id: 90001, method: 'teach.cancel', params: {} }) });
    await res.text();
    return true;
  })()`);
}

interface App { page: GalleryPage; input: RealInput; learningDir: string }

async function start(opts: { frameless: boolean; wayland: boolean }): Promise<App> {
  const before = new Set(readdirSync(tmpdir()));
  const page = await openApp(TEACH_DIR, { viewport: VIEWPORT, ready: '.markers', initScript: initScript(opts) });
  const learningDir = newLearningRoot(before);
  writeImage(learningDir, 'assets/t47-img.png', 120, 60, [200, 40, 40]);
  const input = await RealInput.attach(page.url);
  return { page, input, learningDir };
}

async function stop(app: App | undefined): Promise<void> {
  app?.input.close();
  await app?.page.close();
}

/** 一條測試的開頭:學過紀錄清空、換上這條要的內文、清掉 localStorage(縮放記錄也清,回 100%)、整頁重新載入 */
async function prepare(app: App, body: BodyKey, opts: { keepStorage?: boolean } = {}): Promise<void> {
  writeFileSync(join(app.learningDir, 'state/reviews.json'), '{}\n');
  await app.page.evaluate(`(() => { try { ${opts.keepStorage ? '' : 'localStorage.clear();'} localStorage.setItem('t47.body', ${JSON.stringify(BODIES[body])}); } catch {} return true; })()`);
  await app.page.reset();
  const withImage = BODIES[body].includes(IMG);
  expect(await waitFor(app.page, `document.querySelector('.hud-body') && document.querySelector('.markers') && ${withImage ? "document.querySelector('.body img') && " : ''}${BUTTON('下一個')}`, 12_000), `卡片要畫出來;畫面文字:${await pageText(app.page)}`).toBe(true);
  if (withImage) expect(await waitFor(app.page, `document.querySelector('.body img').complete && document.querySelector('.body img').naturalWidth > 0`, 10_000), '例子裡的圖要載好').toBe(true);
  await sleep(250);
}

async function clickButtonReal(app: App, label: string): Promise<void> {
  const at = await app.page.evaluate<{ x: number; y: number } | null>(`(() => {
    const b = ${BUTTON(label)};
    if (!b) return null;
    b.scrollIntoView({ block: 'nearest' });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!at) throw new Error(`畫面上找不到字是「${label}」的按鈕;畫面文字:${await pageText(app.page)}`);
  await app.input.click(at.x, at.y);
}

// ---------------------------------------------------------------- 縮放量測

interface Facts {
  bodyText: number;
  exText: number;
  title: number;
  imgW: number;
  imgH: number;
  lines: number;
  scrollWidth: number;
  clientWidth: number;
  next: { w: number; h: number; fs: number };
  controlsH: number;
  slotH: number;
  titleBarH: number | null;
  transforms: string[];
  mid: { top: number; max: number };
}

const FACTS = `(() => {
  const rangeWidth = (root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue.trim() === text) { const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect().width; }
    }
    return -1;
  };
  const body = document.querySelector('.body');
  const example = document.querySelector('.lc-example');
  const hudBody = document.querySelector('.hud-body');
  const h2 = document.querySelector('h2');
  const para = [...body.querySelectorAll('p')].find((p) => p.textContent.startsWith('這是一段用來數行數的內文'));
  let lines = -1;
  if (para) {
    const range = document.createRange();
    range.selectNodeContents(para);
    const tops = [];
    for (const r of range.getClientRects()) { if (r.height === 0) continue; if (!tops.some((t) => Math.abs(t - r.top) < 2)) tops.push(r.top); }
    lines = tops.length;
  }
  const img = body.querySelector('.lc-example img');
  const ir = img ? img.getBoundingClientRect() : { width: -1, height: -1 };
  const next = ${BUTTON('下一個')};
  const nr = next.getBoundingClientRect();
  const controls = document.querySelector('.controls');
  const slot = document.querySelector('.status-slot');
  const bar = document.querySelector('[data-hud="titlebar"]');
  const transforms = [];
  for (const el of [...hudBody.querySelectorAll('*'), ...(() => { const out = []; for (let e = hudBody; e; e = e.parentElement) out.push(e); return out; })()]) {
    const t = getComputedStyle(el).transform;
    if (t && t !== 'none') transforms.push((el.className || el.tagName) + ': ' + t);
  }
  return {
    bodyText: rangeWidth(body, ${JSON.stringify(TEXT_BODY)}),
    exText: example ? rangeWidth(example, ${JSON.stringify(TEXT_EXAMPLE)}) : -1,
    title: (() => { const r = document.createRange(); r.selectNodeContents(h2); return r.getBoundingClientRect().width; })(),
    imgW: ir.width, imgH: ir.height, lines,
    scrollWidth: hudBody.scrollWidth, clientWidth: hudBody.clientWidth,
    next: { w: nr.width, h: nr.height, fs: parseFloat(getComputedStyle(next).fontSize) },
    controlsH: controls ? controls.getBoundingClientRect().height : -1,
    slotH: slot ? slot.getBoundingClientRect().height : -1,
    titleBarH: bar ? bar.getBoundingClientRect().height : null,
    transforms,
    mid: { top: hudBody.scrollTop, max: hudBody.scrollHeight - hudBody.clientHeight },
  };
})()`;
const facts = (page: GalleryPage): Promise<Facts> => page.evaluate<Facts>(FACTS);

/** 打一個真的鍵,等重排 */
async function press(app: App, spec: KeySpec): Promise<void> {
  await app.input.combo(spec);
  await sleep(120);
  await app.page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
}

/** 回到指定級距:先 Ctrl+0,再放大 / 縮小幾次 */
async function setLevel(app: App, level: number): Promise<void> {
  await press(app, KEYS.reset[0]);
  const { dir, times } = LEVEL_STEPS(level);
  for (let i = 0; i < times; i += 1) await press(app, KEYS[dir][0]);
}

/** 這一級的內容大小要等於 level × 100% 時的(同一張卡):文字 ±2%、圖 ±0.5 px */
function scaleProblems(base: Facts, now: Facts, level: number): string[] {
  const out: string[] = [];
  const ratio = (a: number, b: number): number => a / b;
  for (const [name, a, b] of [['內文', now.bodyText, base.bodyText], ['例子裡的字', now.exText, base.exText], ['標題', now.title, base.title]] as const) {
    if (b <= 0 || a <= 0) out.push(`${name}量不到(100%:${b}、這一級:${a})`);
    else if (Math.abs(ratio(a, b) - level) > 0.02) out.push(`${name}的寬是 100% 時的 ${ratio(a, b).toFixed(3)} 倍,要 ${level} 倍(100%:${b.toFixed(2)}、這一級:${a.toFixed(2)})`);
  }
  if (Math.abs(now.imgW - base.imgW * level) > 0.5) out.push(`例子裡的圖寬 ${now.imgW.toFixed(2)},要 ${(base.imgW * level).toFixed(2)}(100% 時 ${base.imgW.toFixed(2)} × ${level})`);
  return out;
}

/** 按鈕列、系統狀態字樣、標題列不縮放:跟 100% 時相同 */
function unscaledProblems(base: Facts, now: Facts): string[] {
  const out: string[] = [];
  const same = (name: string, a: number, b: number): void => {
    if (Math.abs(a - b) > 0.01) out.push(`${name}變了:100% 時 ${b.toFixed(2)},這一級 ${a.toFixed(2)}`);
  };
  same('「下一個」的寬', now.next.w, base.next.w);
  same('「下一個」的高', now.next.h, base.next.h);
  same('「下一個」的字級', now.next.fs, base.next.fs);
  same('.controls 的高', now.controlsH, base.controlsH);
  same('.status-slot 的高', now.slotH, base.slotH);
  if (base.titleBarH !== null) {
    if (now.titleBarH === null) out.push('標題列不見了');
    else same('標題列的高', now.titleBarH, base.titleBarH);
  }
  return out;
}

// ================================================================ G1:縮放(a)與重排(b),frameless(有標題列)

describe('T47 渲染:縮放(a)與重排(b)', () => {
  let app: App | undefined;
  beforeAll(async () => {
    app = await start({ frameless: true, wayland: false });
  });
  afterEach(async () => {
    if (!app) return;
    await app.page.resize?.(VIEWPORT.width, VIEWPORT.height);
    await quiesce(app.page).catch(() => undefined);
  });
  afterAll(async () => {
    await stop(app);
  });
  const a = (): App => {
    if (!app) throw new Error('教學卡沒有開起來');
    return app;
  };

  /** 等級距生效後量一次,對 100% 的 base 比 */
  async function expectLevel(base: Facts, level: number, why: string): Promise<Facts> {
    const now = await facts(a().page);
    expect(scaleProblems(base, now, level), `${why}:內容要是 ${Math.round(level * 100)}%`).toEqual([]);
    return now;
  }

  it('a. 放大鍵 Ctrl+=、Ctrl++、數字鍵盤 Ctrl+加號:各放大一級(110% → 125% → 150%),到最大再按每一種鍵都不變', async () => {
    await prepare(a(), 'plain');
    const base = await facts(a().page);
    const steps: [KeySpec & { name: string }, number][] = [
      [KEYS.in[0], 1.1],
      [KEYS.in[1], 1.25],
      [KEYS.in[2], 1.5],
      [KEYS.in[0], 1.5],
      [KEYS.in[1], 1.5],
      [KEYS.in[2], 1.5],
    ];
    for (const [key, level] of steps) {
      await press(a(), key);
      await expectLevel(base, level, `按 ${key.name}`);
    }
  });

  it('a. 縮小鍵 Ctrl+-、數字鍵盤 Ctrl+減號:各縮小一級(90% → 80%),到最小再按每一種鍵都不變', async () => {
    await prepare(a(), 'plain');
    const base = await facts(a().page);
    const steps: [KeySpec & { name: string }, number][] = [
      [KEYS.out[0], 0.9],
      [KEYS.out[1], 0.8],
      [KEYS.out[0], 0.8],
      [KEYS.out[1], 0.8],
    ];
    for (const [key, level] of steps) {
      await press(a(), key);
      await expectLevel(base, level, `按 ${key.name}`);
    }
  });

  it('a. 還原鍵 Ctrl+0、數字鍵盤 Ctrl+0:放大過、縮小過都回 100%;已經是 100% 再按不變', async () => {
    await prepare(a(), 'plain');
    const base = await facts(a().page);
    for (let i = 0; i < 3; i += 1) await press(a(), KEYS.in[0]);
    await expectLevel(base, 1.5, '放大三次');
    await press(a(), KEYS.reset[0]);
    await expectLevel(base, 1, '按 Ctrl+0');
    for (let i = 0; i < 2; i += 1) await press(a(), KEYS.out[0]);
    await expectLevel(base, 0.8, '縮小兩次');
    await press(a(), KEYS.reset[1]);
    await expectLevel(base, 1, '按數字鍵盤 Ctrl+0');
    await press(a(), KEYS.reset[0]);
    await expectLevel(base, 1, '已經 100% 再按 Ctrl+0');
  });

  it('a. 一級就是一級:從 100% 一路放大再縮小走完六個級距,每一級的內容大小都對', async () => {
    await prepare(a(), 'plain');
    const base = await facts(a().page);
    for (const level of [1.1, 1.25, 1.5]) {
      await press(a(), KEYS.in[0]);
      await expectLevel(base, level, `放大到 ${level}`);
    }
    for (const level of [1.25, 1.1, 1, 0.9, 0.8]) {
      await press(a(), KEYS.out[0]);
      await expectLevel(base, level, `縮小到 ${level}`);
    }
  });

  it('a. 每一級:按鈕列、系統狀態字樣、標題列都不縮放(「下一個」的寬高字級、.controls 與 .status-slot 的高、標題列的高跟 100% 時相同)', async () => {
    await prepare(a(), 'plain');
    const base = await facts(a().page);
    expect(base.titleBarH, '前提:有標題列(frameless)').not.toBeNull();
    expect(base.slotH, '前提:有 .status-slot').toBeGreaterThan(0);
    for (const level of LEVELS) {
      await setLevel(a(), level);
      const now = await facts(a().page);
      expect(scaleProblems(base, now, level), `${Math.round(level * 100)}%`).toEqual([]);
      expect(unscaledProblems(base, now), `${Math.round(level * 100)}%:按鈕列、字樣、標題列不能跟著縮放`).toEqual([]);
    }
  });

  it('a. 縮放鍵被攔下來(preventDefault,不給瀏覽器自己縮放);沒按 Ctrl 的 = - 0 與 Ctrl+C、Ctrl+A 不改縮放、也不被攔', async () => {
    await prepare(a(), 'plain');
    const base = await facts(a().page);
    await a().page.evaluate('(window.__t47.keys.length = 0)');
    const zoomKeys = [...KEYS.in, ...KEYS.out, ...KEYS.reset];
    for (const k of zoomKeys) await press(a(), k);
    const prevented = await a().page.evaluate<boolean[]>('window.__t47.keys.map((e) => e.defaultPrevented)');
    expect(prevented, `七個縮放鍵每一個的 keydown 都要被 preventDefault;實際 ${JSON.stringify(prevented)}`).toEqual(zoomKeys.map(() => true));
    await a().page.evaluate('(window.__t47.keys.length = 0)');
    const others: KeySpec[] = [
      { key: '=', code: 'Equal', vk: 187, modifiers: 0 },
      { key: '-', code: 'Minus', vk: 189, modifiers: 0 },
      { key: '0', code: 'Digit0', vk: 48, modifiers: 0 },
      { key: 'c', code: 'KeyC', vk: 67, modifiers: 2 },
      { key: 'a', code: 'KeyA', vk: 65, modifiers: 2 },
    ];
    for (const k of others) await press(a(), k);
    const passed = await a().page.evaluate<boolean[]>('window.__t47.keys.map((e) => e.defaultPrevented)');
    expect(passed, `沒按 Ctrl 的 = - 0、Ctrl+C、Ctrl+A 不能被攔;實際 ${JSON.stringify(passed)}`).toEqual(others.map(() => false));
    await expectLevel(base, 1, '這些鍵之後還是 100%');
    // 放大一級後,這些鍵也不會把它改掉
    await press(a(), KEYS.in[0]);
    for (const k of others) await press(a(), k);
    await expectLevel(base, 1.1, '放大一級之後按這些鍵還是 110%');
  });

  it('a. Cmd(Meta)+= 放大、Cmd+- 縮小、Cmd+0 還原(macOS 一樣;工單第 1 條)', async () => {
    await prepare(a(), 'plain');
    const base = await facts(a().page);
    const META = 4;
    await press(a(), { key: '=', code: 'Equal', vk: 187, modifiers: META });
    await expectLevel(base, 1.1, 'Cmd+=');
    await press(a(), { key: '-', code: 'Minus', vk: 189, modifiers: META });
    await press(a(), { key: '-', code: 'Minus', vk: 189, modifiers: META });
    await expectLevel(base, 0.9, 'Cmd+- 兩次');
    await press(a(), { key: '0', code: 'Digit0', vk: 48, modifiers: META });
    await expectLevel(base, 1, 'Cmd+0');
  });

  it('a. 跨卡記住:放大到 125% 之後「下一個」、「換類別」選一個類別、重新載入頁面,內容都還是 125%(記在 deps.storage)', async () => {
    await prepare(a(), 'plain');
    const base = await facts(a().page);
    await press(a(), KEYS.in[0]);
    await press(a(), KEYS.in[0]);
    await expectLevel(base, 1.25, '放大兩次');
    const first = await title(a().page);
    await clickButtonReal(a(), '下一個');
    expect(await waitFor(a().page, `document.querySelector('h2') && document.querySelector('h2').textContent.trim() !== ${JSON.stringify(first)} && document.querySelector('.body img')`, 10_000), `「下一個」之後要換卡;畫面文字:${await pageText(a().page)}`).toBe(true);
    await sleep(300);
    await expectLevel(base, 1.25, '按「下一個」換卡之後');
    await clickButtonReal(a(), '換類別');
    expect(await waitFor(a().page, `document.querySelector('.list button')`, 8000), `「換類別」要出現類別清單;畫面文字:${await pageText(a().page)}`).toBe(true);
    const picked = await a().page.evaluate<string>(`(() => { const b = [...document.querySelectorAll('.list button')].find((x) => x.textContent.replace(/\\s+/g, '') !== '取消'); const t = b.textContent.trim(); b.click(); return t; })()`);
    expect(picked, '前提:有類別可選').toBeTruthy();
    expect(await waitFor(a().page, `document.querySelector('.markers') && document.querySelector('.body img')`, 10_000), `選了類別之後要出現卡片;畫面文字:${await pageText(a().page)}`).toBe(true);
    await sleep(300);
    await expectLevel(base, 1.25, '「換類別」選了類別之後');
    await prepare(a(), 'plain', { keepStorage: true });
    await expectLevel(base, 1.25, '重新載入頁面之後');
  });

  it('a. 深入這個、回上一層之後也還是同一級', async () => {
    await prepare(a(), 'plain');
    const base = await facts(a().page);
    await press(a(), KEYS.in[0]);
    await press(a(), KEYS.in[0]);
    await press(a(), KEYS.in[0]);
    await expectLevel(base, 1.5, '放大三次');
    await a().page.evaluate('(window.__t47.hold = false)');
    await clickButtonReal(a(), '深入這個');
    expect(await waitFor(a().page, `/來自:/.test(document.querySelector('.markers')?.textContent ?? '') && document.querySelector('.body img')`, 60_000), `深入之後要出現子卡;畫面文字:${await pageText(a().page)}`).toBe(true);
    await sleep(300);
    await expectLevel(base, 1.5, '深入這個、出現子卡之後');
    await clickButtonReal(a(), '回上一層');
    expect(await waitFor(a().page, `!/來自:/.test(document.querySelector('.markers')?.textContent ?? '') && document.querySelector('.body img')`, 10_000), `回上一層之後要回到原卡;畫面文字:${await pageText(a().page)}`).toBe(true);
    await sleep(300);
    await expectLevel(base, 1.5, '回上一層之後');
  });

  // ---- b:重排

  const SIZES: [number, number][] = [[360, 400], [360, 480], [480, 600], [600, 800]];
  for (const [w, h] of SIZES) {
    it(`b. ${w} × ${h}:每一級都沒有橫向捲動(scrollWidth ≤ clientWidth)、沒有 transform、行數隨級距增加(80% < 100% < 150%)`, async () => {
      await prepare(a(), 'plain');
      expect(a().page.resize, 'GalleryPage 要有 resize').toBeDefined();
      await a().page.resize!(w, h);
      await sleep(200);
      const lineCounts: number[] = [];
      for (const level of LEVELS) {
        await setLevel(a(), level);
        const f = await facts(a().page);
        expect(f.scrollWidth, `${w}×${h}、${Math.round(level * 100)}%:橫向捲動(scrollWidth ${f.scrollWidth} > clientWidth ${f.clientWidth})`).toBeLessThanOrEqual(f.clientWidth);
        expect(f.transforms, `${w}×${h}、${Math.round(level * 100)}%:不能用 transform 縮放`).toEqual([]);
        expect(f.lines, '前提:量得到那段長內文的行數').toBeGreaterThan(0);
        lineCounts.push(f.lines);
      }
      const at = (level: number): number => lineCounts[LEVELS.indexOf(level as (typeof LEVELS)[number])]!;
      for (let i = 1; i < lineCounts.length; i += 1) expect(lineCounts[i]!, `行數隨級距不減少:${LEVELS.map((l, j) => `${Math.round(l * 100)}%=${lineCounts[j]}`).join(' ')}`).toBeGreaterThanOrEqual(lineCounts[i - 1]!);
      expect(at(1.5), `150% 的行數要比 100% 多(重排,不是 transform):${lineCounts.join(',')}`).toBeGreaterThan(at(1));
      expect(at(1), `100% 的行數要比 80% 多:${lineCounts.join(',')}`).toBeGreaterThan(at(0.8));
    });
  }
});

// ================================================================ G2:長內容(c)與縮放下的 T45(d),不加標題列(同 T45 的環境)

describe('T47 渲染:很長的內容不弄丟按鈕(c)、縮放下 T45 照舊(d)', () => {
  let app: App | undefined;
  beforeAll(async () => {
    app = await start({ frameless: false, wayland: false });
  });
  afterEach(async () => {
    if (!app) return;
    await app.page.resize?.(VIEWPORT.width, VIEWPORT.height);
    await quiesce(app.page).catch(() => undefined);
  });
  afterAll(async () => {
    await stop(app);
  });
  const a = (): App => {
    if (!app) throw new Error('教學卡沒有開起來');
    return app;
  };

  interface ButtonFacts {
    label: string;
    rect: [number, number, number, number];
    inside: boolean;
    hitsSelf: boolean;
  }
  interface Layout {
    scrollTop: number;
    max: number;
    buttons: ButtonFacts[];
    controls: [number, number, number, number] | null;
    slot: [number, number, number, number] | null;
    controlsInside: boolean;
    slotInside: boolean;
    visible: { top: number; bottom: number };
  }

  const LAYOUT = `(() => {
    const hudBody = document.querySelector('.hud-body');
    const hb = hudBody.getBoundingClientRect();
    const top = hb.top + hudBody.clientTop, bottom = top + hudBody.clientHeight;
    const left = hb.left + hudBody.clientLeft, right = left + hudBody.clientWidth;
    const inside = (r) => r.top >= top - 0.5 && r.bottom <= bottom + 0.5 && r.left >= left - 0.5 && r.right <= right + 0.5;
    const buttons = [];
    for (const label of ['下一個', '換類別', '深入這個']) {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.replace(/\\s+/g, '') === label);
      if (!b) { buttons.push({ label, rect: [0, 0, 0, 0], inside: false, hitsSelf: false }); continue; }
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      buttons.push({ label, rect: [r.x, r.y, r.width, r.height], inside: inside(r), hitsSelf: Boolean(hit) && (hit === b || b.contains(hit)) });
    }
    const controls = document.querySelector('.controls');
    const slot = document.querySelector('.status-slot');
    const cr = controls ? controls.getBoundingClientRect() : null;
    const sr = slot ? slot.getBoundingClientRect() : null;
    return {
      scrollTop: hudBody.scrollTop, max: hudBody.scrollHeight - hudBody.clientHeight, buttons,
      controls: cr ? [cr.x, cr.y, cr.width, cr.height] : null, slot: sr ? [sr.x, sr.y, sr.width, sr.height] : null,
      controlsInside: cr ? inside(cr) : false, slotInside: sr ? inside(sr) : false,
      visible: { top, bottom },
    };
  })()`;
  const layout = (page: GalleryPage): Promise<Layout> => page.evaluate<Layout>(LAYOUT);

  async function scrollTo(page: GalleryPage, where: 'top' | 'middle' | 'bottom'): Promise<void> {
    await page.evaluate(`(() => { const b = document.querySelector('.hud-body'); const max = b.scrollHeight - b.clientHeight; b.scrollTop = ${JSON.stringify(where)} === 'top' ? 0 : ${JSON.stringify(where)} === 'middle' ? Math.round(max / 2) : max; return true; })()`);
    await sleep(200);
  }

  const sameRect = (x: number[] | null, y: number[] | null): boolean => Boolean(x && y) && x!.every((v, i) => Math.abs(v - y![i]!) <= 0.01);

  async function longCheck(level: number, size: [number, number]): Promise<void> {
    await prepare(a(), 'long');
    expect(a().page.resize, 'GalleryPage 要有 resize').toBeDefined();
    await a().page.resize!(size[0], size[1]);
    await sleep(200);
    await setLevel(a(), level);
    await sleep(200);
    const tag = `${size[0]}×${size[1]}、${Math.round(level * 100)}%`;
    const seen: Layout[] = [];
    for (const where of ['top', 'middle', 'bottom'] as const) {
      await scrollTo(a().page, where);
      const l = await layout(a().page);
      expect(l.max, `${tag}:前提:很長的例子要捲得動 ≥ 300 px(scrollHeight - clientHeight ${l.max})`).toBeGreaterThanOrEqual(300);
      if (where === 'middle') expect(l.scrollTop, `${tag}:前提:真的捲到中間`).toBeGreaterThan(50);
      if (where === 'bottom') expect(l.scrollTop, `${tag}:前提:真的捲到底`).toBeGreaterThan(l.max - 1.5);
      for (const b of l.buttons) {
        expect(b.rect[2] * b.rect[3], `${tag}、${where}:「${b.label}」要在畫面上`).toBeGreaterThan(0);
        expect(b.inside, `${tag}、捲到${where}:「${b.label}」整顆都要在 .hud-body 看得到的範圍裡(矩形 ${b.rect.map((v) => v.toFixed(1)).join(', ')},範圍 ${l.visible.top.toFixed(1)}–${l.visible.bottom.toFixed(1)})`).toBe(true);
        expect(b.hitsSelf, `${tag}、捲到${where}:「${b.label}」中心點要打得到自己`).toBe(true);
      }
      expect(l.controlsInside, `${tag}、捲到${where}:.controls 整塊在看得到的範圍裡`).toBe(true);
      expect(l.slotInside, `${tag}、捲到${where}:.status-slot 整塊在看得到的範圍裡`).toBe(true);
      seen.push(l);
    }
    for (const label of ['下一個', '換類別', '深入這個']) {
      const rects = seen.map((l) => l.buttons.find((b) => b.label === label)!.rect);
      expect(sameRect(rects[0]!, rects[1]!) && sameRect(rects[0]!, rects[2]!), `${tag}:「${label}」的位置不能跟著捲動變(上 ${rects[0]!.map((v) => v.toFixed(2))}、中 ${rects[1]!.map((v) => v.toFixed(2))}、下 ${rects[2]!.map((v) => v.toFixed(2))})`).toBe(true);
    }
    expect(sameRect(seen[0]!.controls, seen[2]!.controls) && sameRect(seen[0]!.controls, seen[1]!.controls), `${tag}:.controls 的位置不能變`).toBe(true);
    expect(sameRect(seen[0]!.slot, seen[2]!.slot) && sameRect(seen[0]!.slot, seen[1]!.slot), `${tag}:.status-slot 的位置不能變`).toBe(true);
  }

  // ---- c

  it('c. 很長的例子,360 × 480、100%:捲到上、中、下,三顆按鈕與 .controls、.status-slot 整塊看得到、打得到自己、位置不變', async () => {
    await longCheck(1, [360, 480]);
  });
  it('c. 很長的例子,360 × 400(最小視窗)、100%:同上', async () => {
    await longCheck(1, [360, 400]);
  });
  it('c. 很長的例子,360 × 400、150%:同上(內容放大了,按鈕列還是整塊看得到)', async () => {
    await longCheck(1.5, [360, 400]);
  });
  it('c. 很長的例子,600 × 800、80%:同上', async () => {
    await longCheck(0.8, [600, 800]);
  });

  it('c. 最大 scrollTop 時,最後的內容在黏住那一塊的上面(沒被擋住):例子最後一個項目與圖的下緣 ≤ .controls 的上緣', async () => {
    await prepare(a(), 'long');
    await scrollTo(a().page, 'bottom');
    const got = await a().page.evaluate<{ lastBottom: number; imgBottom: number; controlsTop: number; stickyTop: number | null }>(`(() => {
      const items = [...document.querySelectorAll('.lc-example li')];
      const img = document.querySelector('.lc-example img');
      const controls = document.querySelector('.controls');
      let sticky = null;
      for (let e = controls; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).position === 'sticky') { sticky = e; break; }
      return {
        lastBottom: items[items.length - 1].getBoundingClientRect().bottom,
        imgBottom: img.getBoundingClientRect().bottom,
        controlsTop: controls.getBoundingClientRect().top,
        stickyTop: sticky ? sticky.getBoundingClientRect().top : null,
      };
    })()`);
    expect(got.lastBottom, `最後一個項目的下緣 ${got.lastBottom.toFixed(1)} 要在 .controls 上緣 ${got.controlsTop.toFixed(1)} 之上`).toBeLessThanOrEqual(got.controlsTop + 0.5);
    expect(got.imgBottom, `圖的下緣 ${got.imgBottom.toFixed(1)} 要在 .controls 上緣 ${got.controlsTop.toFixed(1)} 之上`).toBeLessThanOrEqual(got.controlsTop + 0.5);
  });

  it('c. 短卡(內容放得下):按鈕列在內容後面,不是黏在視窗底(.controls 的上緣離內文下緣不遠:0–60 px)', async () => {
    await prepare(a(), 'short');
    const got = await a().page.evaluate<{ gap: number; max: number }>(`(() => {
      const body = document.querySelector('.body');
      const controls = document.querySelector('.controls');
      const hudBody = document.querySelector('.hud-body');
      return { gap: controls.getBoundingClientRect().top - body.getBoundingClientRect().bottom, max: hudBody.scrollHeight - hudBody.clientHeight };
    })()`);
    expect(got.max, '前提:短卡不用捲').toBeLessThanOrEqual(0.5);
    expect(got.gap, `按鈕列離內文下緣 ${got.gap.toFixed(1)} px,要在 0–60 之間(內容比視窗短時,按鈕在內容後面)`).toBeGreaterThanOrEqual(0);
    expect(got.gap).toBeLessThanOrEqual(60);
  });

  it('c. 黏住的那一塊:從「下一個」往上有 position: sticky 的祖先,它包含 .controls 與 .status-slot,有底色(不透明度不是 0)、沒有框線、沒有陰影', async () => {
    await prepare(a(), 'long');
    const got = await a().page.evaluate<{
      found: boolean; containsControls: boolean; containsSlot: boolean; bg: string; bgAlpha: number; panel: string; solid: string;
      borders: string[]; shadow: string; outline: string; bottom: string;
    }>(`(() => {
      const next = ${BUTTON('下一個')};
      let sticky = null;
      for (let e = next; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).position === 'sticky') { sticky = e; break; }
      const colourOf = (v) => { const p = document.createElement('span'); p.style.color = v; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
      if (!sticky) return { found: false, containsControls: false, containsSlot: false, bg: '', bgAlpha: 0, panel: '', solid: '', borders: [], shadow: '', outline: '', bottom: '' };
      const cs = getComputedStyle(sticky);
      const m = /rgba?\\(([^)]+)\\)/.exec(cs.backgroundColor);
      const parts = m ? m[1].split(/[ ,\\/]+/).filter(Boolean) : [];
      const alpha = parts.length >= 4 ? parseFloat(parts[3]) : (cs.backgroundColor === 'transparent' ? 0 : 1);
      return {
        found: true,
        containsControls: sticky.contains(document.querySelector('.controls')),
        containsSlot: sticky.contains(document.querySelector('.status-slot')),
        bg: cs.backgroundColor, bgAlpha: alpha,
        panel: colourOf('var(--hud-panel)'), solid: colourOf('var(--hud-solid)'),
        borders: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].filter((w) => parseFloat(w) > 0),
        shadow: cs.boxShadow, outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? cs.outlineStyle : 'none',
        bottom: cs.bottom,
      };
    })()`);
    expect(got.found, '「下一個」往上要有 computed position: sticky 的祖先(黏住按鈕列與字樣那一塊)').toBe(true);
    expect(got.containsControls, '黏住的那一塊要包含 .controls').toBe(true);
    expect(got.containsSlot, '黏住的那一塊要包含 .status-slot(字樣也在下面那一塊裡)').toBe(true);
    expect(got.bgAlpha, `黏住的那一塊要有底色,內容從底下捲過去才不會透出來(背景 ${got.bg})`).toBeGreaterThan(0);
    expect([got.panel, got.solid], `底色(${got.bg})要是 var(--hud-panel) 或 var(--hud-solid) 的計算值`).toContain(got.bg);
    expect(got.borders, '黏住的那一塊不畫框線(card-static)').toEqual([]);
    expect(got.shadow, '黏住的那一塊不加陰影').toBe('none');
    expect(got.outline, '黏住的那一塊不加 outline').toBe('none');
  });

  // ---- d:縮放下 T45 的轉換

  const CRED = async (): Promise<{ text: string }> => {
    const mod = (await import(/* @vite-ignore */ CREDENTIALS)) as { credentialMessage(problem: unknown, use?: 'grade' | 'deepen'): string };
    return { text: mod.credentialMessage({ kind: 'missing', key: 'ANTHROPIC_API_KEY' }, 'deepen') };
  };

  async function holdGenerating(page: GalleryPage): Promise<void> {
    await page.evaluate('(window.__t47.hold = true)');
    const ok0 = await page.evaluate<boolean>(`(() => { const b = ${BUTTON('深入這個')}; if (!b) return false; b.click(); return true; })()`);
    if (!ok0) throw new Error(`找不到「深入這個」;畫面文字:${await pageText(page)}`);
    const ok = await waitFor(page, 'window.__t47.waiters.length > 0 && document.querySelector(".generating")', 10_000);
    if (!ok) throw new Error(`沒有進到生成中;已送的請求:${(await methods(page)).join(',')};畫面文字:${await pageText(page)}`);
    await sleep(250);
  }

  async function credentialError(page: GalleryPage): Promise<void> {
    const { text } = await CRED();
    await injectError(page, 'teach.deepen', 'credential-unavailable', text);
    await page.evaluate(`(() => { ${BUTTON('深入這個')}.click(); return true; })()`);
    const ok = await waitFor(page, `(document.querySelector('.deepen-error')?.textContent ?? '').trim() === ${JSON.stringify(text)}`, 6000);
    if (!ok) throw new Error(`畫面要顯示金鑰那一句;畫面文字:${await pageText(page)}`);
    await sleep(250);
  }

  interface Transition {
    id: string;
    start(page: GalleryPage): Promise<void>;
    act(page: GalleryPage): Promise<void>;
  }
  const none = async (): Promise<void> => {};
  const TRANSITIONS: Transition[] = [
    { id: '沒字 → 生成中', start: none, act: (p) => holdGenerating(p) },
    {
      id: '生成中 → 沒字(取消)',
      start: (p) => holdGenerating(p),
      act: async (p) => {
        await p.evaluate(`(() => { ${BUTTON('取消')}.click(); window.__t47.release(); return true; })()`);
        expect(await waitFor(p, `!document.querySelector('.generating') && !document.querySelector('.deepen-error')`, 10_000), '取消之後生成中那一行要收掉').toBe(true);
        await sleep(250);
      },
    },
    { id: '沒字 → 最高的金鑰句', start: none, act: (p) => credentialError(p) },
    { id: '錯誤(最高的金鑰句)→ 生成中', start: (p) => credentialError(p), act: (p) => holdGenerating(p) },
    {
      id: '生成中 → 錯誤(輪詢拿到最高的金鑰句)',
      start: (p) => holdGenerating(p),
      act: async (p) => {
        const { text } = await CRED();
        await p.evaluate(`(window.__t47.holdError = ${JSON.stringify({ kind: 'credential-unavailable', message: text })})`);
        await p.evaluate('window.__t47.release()');
        expect(await waitFor(p, `(document.querySelector('.deepen-error')?.textContent ?? '').trim() === ${JSON.stringify(text)}`, 10_000), `輪詢拿到金鑰錯誤之後要出現那一句;畫面文字:${await pageText(p)}`).toBe(true);
        await sleep(250);
      },
    },
  ];

  interface Snap { rects: Record<string, number[]>; scrollTop: number }
  const SNAP = `(() => {
    const rects = {};
    for (const b of document.querySelectorAll('button')) {
      const label = b.textContent.replace(/\\s+/g, '');
      if (label === '取消') continue;
      const r = b.getBoundingClientRect();
      rects[label] = [r.x, r.y, r.width, r.height];
    }
    return { rects, scrollTop: document.querySelector('.hud-body').scrollTop };
  })()`;
  const snap = (page: GalleryPage): Promise<Snap> => page.evaluate<Snap>(SNAP);
  function moved(before: Snap, after: Snap): string[] {
    const out: string[] = [];
    for (const label of ['下一個', '換類別', '深入這個']) {
      if (!before.rects[label] || !after.rects[label]) out.push(`「${label}」前後要都在畫面上`);
    }
    for (const [label, was] of Object.entries(before.rects)) {
      const now = after.rects[label];
      if (!now) continue;
      if (was.some((v, i) => Math.abs(v - now[i]!) > 0.01)) out.push(`「${label}」動了:前 [${was.map((v) => v.toFixed(2))}] 後 [${now.map((v) => v.toFixed(2))}]`);
    }
    if (Math.abs(before.scrollTop - after.scrollTop) > 0.01) out.push(`捲動位置變了:前 ${before.scrollTop.toFixed(2)} 後 ${after.scrollTop.toFixed(2)}`);
    return out;
  }

  const D_CASES: { id: string; body: BodyKey; where: 'none' | 'middle' | 'bottom'; levels: number[] }[] = [
    { id: '短卡', body: 'short', where: 'none', levels: [0.8, 1.5] },
    { id: '長卡捲到底', body: 'long', where: 'bottom', levels: [0.8, 1.5] },
    { id: '長卡捲到中間', body: 'long', where: 'middle', levels: [0.8, 1, 1.5] },
  ];
  for (const dc of D_CASES) {
    for (const level of dc.levels) {
      for (const t of TRANSITIONS) {
        it(`d. ${Math.round(level * 100)}%、${dc.id}:${t.id}——前後每顆按鈕的矩形相同(差 0)、捲動位置不變`, async () => {
          await prepare(a(), dc.body);
          await setLevel(a(), level);
          await sleep(200);
          if (dc.where !== 'none') {
            await scrollTo(a().page, dc.where);
            const l = await layout(a().page);
            expect(l.max, `前提:長卡要捲得動(${l.max})`).toBeGreaterThanOrEqual(100);
            expect(l.scrollTop, '前提:真的捲到了').toBeGreaterThan(30);
          }
          await t.start(a().page);
          const before = await snap(a().page);
          await t.act(a().page);
          const after = await snap(a().page);
          expect(moved(before, after), `${Math.round(level * 100)}%、${dc.id}、${t.id}`).toEqual([]);
          const needsVisible = dc.where !== 'none';
          if (needsVisible) {
            const l = await layout(a().page);
            for (const b of l.buttons) expect(b.inside, `${Math.round(level * 100)}%、${dc.id}、${t.id}之後:「${b.label}」要整顆看得到`).toBe(true);
          }
        });
      }
    }
  }
});

// ================================================================ G3:Wayland 提示在時,黏底的按鈕不被蓋住(f)

describe('T47 渲染:Wayland 一次性提示不蓋住黏在下面的按鈕列(f)', () => {
  let app: App | undefined;
  beforeAll(async () => {
    expect(existsSync(WAYLAND_NOTE_JS), `${WAYLAND_NOTE_JS} 要存在(Wayland 提示程式)`).toBe(true);
    app = await start({ frameless: true, wayland: true });
  });
  afterEach(async () => {
    if (!app) return;
    await app.page.resize?.(VIEWPORT.width, VIEWPORT.height);
    await quiesce(app.page).catch(() => undefined);
  });
  afterAll(async () => {
    await stop(app);
  });
  const a = (): App => {
    if (!app) throw new Error('教學卡沒有開起來');
    return app;
  };

  const NOTE = `(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(WAYLAND_NOTE_DISMISS_LABEL)});
    if (!btn) return null;
    let box = btn;
    while (box.parentElement && box !== document.body && !box.innerText.includes(${JSON.stringify(WAYLAND_NOTE_TEXT)})) box = box.parentElement;
    return box;
  })()`;

  interface NoteFacts {
    note: { top: number; bottom: number; left: number; right: number } | null;
    items: { label: string; top: number; bottom: number; left: number; right: number; overlap: number; hitsSelf: boolean; inside: boolean }[];
    scrollTop: number;
    max: number;
  }
  const NOTE_FACTS = `(() => {
    const note = ${NOTE};
    const hudBody = document.querySelector('.hud-body');
    const hb = hudBody.getBoundingClientRect();
    const vTop = hb.top + hudBody.clientTop, vBottom = vTop + hudBody.clientHeight;
    const nr = note ? note.getBoundingClientRect() : null;
    const items = [];
    const add = (label, el) => {
      if (!el) { items.push({ label, top: 0, bottom: 0, left: 0, right: 0, overlap: -1, hitsSelf: false, inside: false }); return; }
      const r = el.getBoundingClientRect();
      const ov = nr ? Math.max(0, Math.min(r.right, nr.right) - Math.max(r.left, nr.left)) * Math.max(0, Math.min(r.bottom, nr.bottom) - Math.max(r.top, nr.top)) : 0;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      items.push({ label, top: r.top, bottom: r.bottom, left: r.left, right: r.right, overlap: Math.round(ov * 10) / 10, hitsSelf: Boolean(hit) && (hit === el || el.contains(hit)), inside: r.top >= vTop - 0.5 && r.bottom <= vBottom + 0.5 });
    };
    for (const label of ['下一個', '換類別', '深入這個']) add('按鈕「' + label + '」', [...document.querySelectorAll('button')].find((x) => x.textContent.replace(/\\s+/g, '') === label));
    add('.controls', document.querySelector('.controls'));
    add('.status-slot', document.querySelector('.status-slot'));
    return { note: nr ? { top: nr.top, bottom: nr.bottom, left: nr.left, right: nr.right } : null, items, scrollTop: hudBody.scrollTop, max: hudBody.scrollHeight - hudBody.clientHeight };
  })()`;
  const noteFacts = (page: GalleryPage): Promise<NoteFacts> => page.evaluate<NoteFacts>(NOTE_FACTS);

  async function scrollTo(page: GalleryPage, where: 'top' | 'middle' | 'bottom'): Promise<void> {
    await page.evaluate(`(() => { const b = document.querySelector('.hud-body'); const max = b.scrollHeight - b.clientHeight; b.scrollTop = ${JSON.stringify(where)} === 'top' ? 0 : ${JSON.stringify(where)} === 'middle' ? Math.round(max / 2) : max; return true; })()`);
    await sleep(300);
  }

  async function withNote(level: number): Promise<void> {
    await prepare(a(), 'long');
    expect(await waitFor(a().page, `document.body.innerText.includes(${JSON.stringify(WAYLAND_NOTE_TEXT)})`, 6000), `Wayland 提示要出現;畫面文字:${await pageText(a().page)}`).toBe(true);
    await setLevel(a(), level);
    await sleep(300);
  }

  function noteProblems(f: NoteFacts, tag: string): string[] {
    const out: string[] = [];
    if (!f.note) return [`${tag}:找不到提示`];
    for (const it of f.items) {
      if (it.overlap < 0) out.push(`${tag}:找不到 ${it.label}`);
      else {
        if (it.overlap > 0) out.push(`${tag}:${it.label} 跟提示重疊 ${it.overlap} px²(${it.label} ${it.top.toFixed(1)}–${it.bottom.toFixed(1)},提示 ${f.note.top.toFixed(1)}–${f.note.bottom.toFixed(1)})`);
        if (it.bottom > f.note.top + 0.5) out.push(`${tag}:${it.label} 的下緣 ${it.bottom.toFixed(1)} 要在提示上緣 ${f.note.top.toFixed(1)} 之上`);
        if (!it.inside) out.push(`${tag}:${it.label} 不在 .hud-body 看得到的範圍裡`);
        if (it.label.startsWith('按鈕') && !it.hitsSelf) out.push(`${tag}:${it.label} 中心點打不到自己`);
      }
    }
    return out;
  }

  for (const where of ['top', 'middle', 'bottom'] as const) {
    it(`f. 提示在、很長的卡捲到${where === 'top' ? '最上面' : where === 'middle' ? '中間' : '最下面'}:按鈕、.controls、.status-slot 都在提示上面、不重疊、中心點打得到按鈕`, async () => {
      await withNote(1);
      await scrollTo(a().page, where);
      const f = await noteFacts(a().page);
      expect(f.max, '前提:長卡要捲得動').toBeGreaterThanOrEqual(200);
      expect(noteProblems(f, `捲到${where}`)).toEqual([]);
    });
  }

  it('f. 提示在、150%、很長的卡捲到中間與最下面:同上', async () => {
    await withNote(1.5);
    for (const where of ['middle', 'bottom'] as const) {
      await scrollTo(a().page, where);
      const f = await noteFacts(a().page);
      expect(noteProblems(f, `150%、捲到${where}`)).toEqual([]);
    }
  });

  it('f. 按「知道了」把提示關掉:提示不見,按鈕列還是整塊看得到、位置不變(捲到中間)', async () => {
    await withNote(1);
    await scrollTo(a().page, 'middle');
    const dismissAt = await a().page.evaluate<{ x: number; y: number } | null>(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(WAYLAND_NOTE_DISMISS_LABEL)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    expect(dismissAt, '要有「知道了」').not.toBeNull();
    await a().input.click(dismissAt!.x, dismissAt!.y);
    await sleep(400);
    expect(await a().page.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(WAYLAND_NOTE_TEXT)})`), '提示要關掉').toBe(false);
    const f = await noteFacts(a().page);
    for (const it of f.items) {
      expect(it.overlap, `${it.label} 要找得到`).toBeGreaterThanOrEqual(0);
      expect(it.inside, `關掉提示之後 ${it.label} 還是在看得到的範圍裡`).toBe(true);
    }
    for (const it of f.items.filter((x) => x.label.startsWith('按鈕'))) expect(it.hitsSelf, `${it.label} 中心點打得到自己`).toBe(true);
  });
});
