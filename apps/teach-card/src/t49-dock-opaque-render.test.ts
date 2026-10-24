/**
 * T49(黏底那一塊不透明、底下不留縫;T47 `@manual` 的透字與 O2)渲染測試 a、b。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T49-teach-card-dock-opaque.md 「驗收條件 1」的渲染測試 a、b 與「起草時補的兩處」。
 *
 * 真的把 `App.svelte` 畫出來(`openApp(apps/teach-card, { viewport: 360 × 480, initScript })` + 真的側車 + headless Chrome),
 * 縮放用真的鍵盤(Ctrl+=,連同一個 Chrome 的第二條 CDP),捲動用程式(scrollTop),然後**讀截圖的像素**(`page.screenshot()` + `px`)。
 * 不讀原始碼比字串(SKILL §4g 第 29 條)。
 *
 * 黏底那一塊不寫死是哪個元素:從「下一個」往上找 computed `position: sticky` 的祖先(同 T47 c);找不到就丟錯(前提不成立)。
 *
 * 卡:一個很長的例子——30 行字、一張高的純洋紅圖(280 × 1200)、再 30 行字。捲動位置由程式算:
 *   - 圖(image):圖的上緣在黏底那一塊上緣上面 40 px,圖的下緣一直延伸到看得到範圍下面——洋紅同時在黏底那一塊底下、也在黏底那一塊與看得到範圍下緣之間;
 *   - 字(text):a 讓一行字的正中間對到黏底那一塊的正中間;b 讓一行字的正中間對到「黏底那一塊下緣下面第一排」(Wayland 時對到下緣與提示上緣之間);
 *   - 底(bottom):捲到最底(內容在黏底那一塊上面結束,底下沒有東西可透;守門用,實作不能為了補縫把這個弄壞)。
 *
 * 面板的顏色不算出來,**量出來**:`.hud-body` 左內距裡(離看得到範圍左緣 6 px)、黏底那一塊上面 8 px 的一個點(那裡沒有字、沒有例子框)。
 * 兩種底都量:`html` 沒有 `hud-solid`(有合成器,T47 `@manual` 的環境)與有 `hud-solid`(沒有合成器,T21)。
 *
 * a 不透明、同色:黏底那一塊的矩形,左右各縮 12 px(避開面板的 10 px 切角)、上緣縮 1 px,扣掉每顆按鈕(外擴 1.5 px)之後,
 *   每個像素跟面板色每個通道差 ≤ 1;出錯字樣在的時候再扣掉 `.deepen-error` 那一行(外擴 2 px,含它的 1px 上分隔線)。
 *   100% 與 150%,洋紅圖、字、捲到底。
 * b 下面不留縫:黏底那一塊下緣(往上取整)到看得到範圍下緣(往下取整)之間每一排(左右各縮 12 px),每個像素跟面板色每通道差 ≤ 1,或者那幾排根本不存在。
 *   Wayland 提示在時(`initScript` 放 Rust 組出來的提示程式,T47 f 的做法):量黏底那一塊下緣(往上取整)到提示上緣(往下取整)之間。
 *
 * 「在 42bbcb2 的 App.svelte 上紅」:a 的洋紅圖與字(底是半透明 var(--hud-panel),透 10%)、b 的 1 px 縫(Wayland 提示在時 2 排)。
 * 本來就綠(守門,標出來):「捲到最底」那幾條(底下沒有東西可透、內容在黏底那一塊上面結束);實作為了補縫把它弄壞時它要紅。
 *
 * 取捨:
 *   - b 的列數照畫出來的樣子算(Chrome 把版面邊緣吸到整數像素):黏底那一塊下緣與下界各自四捨五入,中間每一排都量。
 *     提示在時,提示的 CSS 是 `bottom: 8px`、.hud-body 的下緣離視窗下緣 9 px,所以黏底那一塊停在內容區邊緣時,它和提示之間有 base + 1 排。
 *   - 補縫的做法不綁:黏底那一塊的 border box、往下多蓋的偽元素、或別的,量的是畫面。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WAYLAND_NOTE_DISMISS_LABEL, WAYLAND_NOTE_JS, WAYLAND_NOTE_TEXT } from '../../../packages/ui-shared/src/hud/card-design-values-test-support.js';
import { openApp, px, type GalleryPage, type Image } from '../../../packages/ui-shared/src/hud/render-test-support.js';
import { KEYS, RealInput, newLearningRoot, writeImage, type KeySpec } from './t47-test-support.js';

// 每條都真的起 vite、headless Chrome、側車:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const ROOT = join(import.meta.dirname, '../../..');
const TEACH_DIR = join(import.meta.dirname, '..');
const VIEWPORT = { width: 360, height: 480 } as const;
const WINDOW_MODE_JS = join(ROOT, 'apps/desktop/src-tauri/src/window_mode.js');
const PROTOCOL = pathToFileURL(join(ROOT, 'packages/core/src/session/protocol.ts')).href;

const LEVELS = [1, 1.5] as const;
const ZOOM_IN_TIMES: Record<number, number> = { 1: 0, 1.5: 4 }; // 100% → 110% → 125% → 150% 要 3 次;多按 1 次確認到頂不動

// ---------------------------------------------------------------- 卡片內容

const LINE = (n: number): string => `- 補充的第 ${n} 行字很多很多很多很多很多很多很多很多`;
const LINES = (from: number, to: number): string => Array.from({ length: to - from + 1 }, (_, i) => LINE(from + i)).join('\n');
const BODY = [
  'T49-BODY 內文。',
  '',
  '```example',
  '很長的例子:',
  '',
  LINES(1, 30),
  '',
  '![洋紅](../../assets/t49-magenta.png)',
  '',
  LINES(31, 60),
  '```',
].join('\n');

// ---------------------------------------------------------------- 頁面腳本

const FETCH_SCRIPT = `(() => {
  const orig = window.fetch.bind(window);
  const st = (window.__t49 = { hold: false, holdError: null, waiters: [] });
  st.release = () => {
    st.hold = false;
    for (const wake of st.waiters.splice(0)) wake();
  };
  const errorResponse = (id, error) =>
    new Response(JSON.stringify({ v: 1, id, ok: false, error }), { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/__card')) {
      const res = await orig(input, init);
      const text = await res.text();
      let body = '';
      try { body = localStorage.getItem('t49.body') || ''; } catch { body = ''; }
      if (!body) return new Response(text, { status: res.status, headers: { 'content-type': 'text/plain' } });
      const fm = /^---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n?/.exec(text);
      return new Response((fm ? fm[0] : '') + body, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (!url.includes('/__review')) return orig(input, init);
    const req = JSON.parse(init.body);
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

interface Mode { frameless: boolean; solid: boolean; wayland: boolean }

function initScript(mode: Mode): string {
  // initScript 在文件開始時跑,那時 documentElement 可能還沒有;window_mode.js 只在有 root 時才加 class,所以等 root 出現再跑
  const windowMode = `window.__LC_WINDOW_MODE__ = ${JSON.stringify({ frameless: mode.frameless, solid: mode.solid })};
(function applyMode() {
  if (!document.documentElement) { new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); applyMode(); } }).observe(document, { childList: true }); return; }
${readFileSync(WINDOW_MODE_JS, 'utf8')}
})();`;
  const note = mode.wayland && existsSync(WAYLAND_NOTE_JS) ? readFileSync(WAYLAND_NOTE_JS, 'utf8') : '';
  return `${windowMode}\n${note}\n${FETCH_SCRIPT}`;
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

interface App { page: GalleryPage; input: RealInput; learningDir: string }

async function start(mode: Mode): Promise<App> {
  const before = new Set(readdirSync(tmpdir()));
  const page = await openApp(TEACH_DIR, { viewport: VIEWPORT, ready: '.markers', initScript: initScript(mode) });
  const learningDir = newLearningRoot(before);
  writeImage(learningDir, 'assets/t49-magenta.png', 280, 1200, [255, 0, 255]);
  const input = await RealInput.attach(page.url);
  return { page, input, learningDir };
}

async function stop(app: App | undefined): Promise<void> {
  app?.input.close();
  await app?.page.close();
}

async function quiesce(page: GalleryPage): Promise<void> {
  await page.evaluate(`(async () => {
    window.__t49.holdError = null;
    window.__t49.release();
    const res = await fetch('/__review', { method: 'POST', body: JSON.stringify({ v: 1, id: 90001, method: 'teach.cancel', params: {} }) });
    await res.text();
    return true;
  })()`);
}

/** 一條測試的開頭:學過紀錄清空、換上這張卡、清掉 localStorage(縮放記錄也清,回 100%)、整頁重新載入 */
async function prepare(app: App): Promise<void> {
  writeFileSync(join(app.learningDir, 'state/reviews.json'), '{}\n');
  await app.page.evaluate(`(() => { try { localStorage.clear(); localStorage.setItem('t49.body', ${JSON.stringify(BODY)}); } catch {} return true; })()`);
  await app.page.reset();
  expect(await waitFor(app.page, `document.querySelector('.hud-body') && document.querySelector('.markers') && document.querySelector('.body img') && ${BUTTON('下一個')}`, 12_000), `卡片要畫出來;畫面文字:${await pageText(app.page)}`).toBe(true);
  expect(await waitFor(app.page, `document.querySelector('.body img').complete && document.querySelector('.body img').naturalWidth > 0`, 10_000), '例子裡的洋紅圖要載好').toBe(true);
  await sleep(250);
}

async function press(app: App, spec: KeySpec): Promise<void> {
  await app.input.combo(spec);
  await sleep(120);
  await app.page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
}

async function setLevel(app: App, level: number): Promise<void> {
  for (let i = 0; i < ZOOM_IN_TIMES[level]!; i += 1) await press(app, KEYS.in[0]);
  await sleep(200);
}

// ---------------------------------------------------------------- 量測

interface DockFacts {
  /** 黏住那一塊(從「下一個」往上第一個 computed position 是 sticky 的祖先)的矩形 */
  dock: { top: number; bottom: number; left: number; right: number };
  /** .hud-body 看得到的範圍 */
  visible: { top: number; bottom: number; left: number; right: number };
  buttons: { top: number; bottom: number; left: number; right: number }[];
  deepenError: { top: number; bottom: number; left: number; right: number } | null;
  /** Wayland 提示的上緣;沒有提示是 null */
  noteTop: number | null;
  scale: number;
}

const DOCK_FACTS = `(() => {
  const next = ${BUTTON('下一個')};
  let dock = null;
  for (let e = next ? next.parentElement : null; e; e = e.parentElement) {
    if (getComputedStyle(e).position === 'sticky') { dock = e; break; }
  }
  if (!dock) return null;
  const hudBody = document.querySelector('.hud-body');
  const hb = hudBody.getBoundingClientRect();
  const vTop = hb.top + hudBody.clientTop, vLeft = hb.left + hudBody.clientLeft;
  const box = (r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  const d = dock.getBoundingClientRect();
  const err = document.querySelector('.deepen-error');
  const noteBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(WAYLAND_NOTE_DISMISS_LABEL)});
  let note = null;
  if (noteBtn) {
    let n = noteBtn;
    while (n.parentElement && n !== document.body && !n.innerText.includes(${JSON.stringify(WAYLAND_NOTE_TEXT)})) n = n.parentElement;
    note = n;
  }
  return {
    dock: box(d),
    visible: { top: vTop, bottom: vTop + hudBody.clientHeight, left: vLeft, right: vLeft + hudBody.clientWidth },
    buttons: [...dock.querySelectorAll('button')].map((b) => box(b.getBoundingClientRect())),
    deepenError: err ? box(err.getBoundingClientRect()) : null,
    noteTop: note ? note.getBoundingClientRect().top : null,
    scale: window.devicePixelRatio || 1,
  };
})()`;
const dockFacts = async (page: GalleryPage): Promise<DockFacts> => {
  const f = await page.evaluate<DockFacts | null>(DOCK_FACTS);
  if (!f) throw new Error(`前提不成立:從「下一個」往上找不到 position: sticky 的祖先;畫面文字:${await pageText(page)}`);
  return f;
};

type Where = 'image' | 'text' | 'bottom';

/** 把 .hud-body 捲到這個位置,回量測;b 的字(text)要對到 gapY,a 的字對到黏底那一塊的正中間 */
async function scrollTo(page: GalleryPage, where: Where, purpose: 'a' | 'b'): Promise<void> {
  const before = await dockFacts(page);
  const gapY = before.noteTop !== null ? (before.dock.bottom + before.noteTop) / 2 : Math.ceil(before.dock.bottom) + 0.5;
  const target = purpose === 'a' ? (before.dock.top + before.dock.bottom) / 2 : gapY;
  await page.evaluate(`(() => {
    const b = document.querySelector('.hud-body');
    const where = ${JSON.stringify(where)};
    if (where === 'bottom') { b.scrollTop = b.scrollHeight; return true; }
    if (where === 'image') {
      const img = document.querySelector('.lc-example img');
      b.scrollTop += img.getBoundingClientRect().top - (${before.dock.top} - 40);
      return true;
    }
    const lines = [...document.querySelectorAll('.lc-example li')];
    const li = lines.find((x) => x.textContent.includes('補充的第 20 行'));
    const r = li.getBoundingClientRect();
    b.scrollTop += (r.top + r.height / 2) - ${target};
    return true;
  })()`);
  await sleep(350);
}

/** 前提:真的有內容在黏底那一塊底下(a)或在它與看得到範圍下緣之間(b);不然這條是空轉 */
async function behindProblems(page: GalleryPage, where: Where): Promise<string[]> {
  if (where === 'bottom') return [];
  const f = await dockFacts(page);
  const out = await page.evaluate<string[]>(`(() => {
    const problems = [];
    const dockTop = ${f.dock.top}, dockBottom = ${f.dock.bottom}, visBottom = ${f.visible.bottom};
    if (${JSON.stringify(where)} === 'image') {
      const r = document.querySelector('.lc-example img').getBoundingClientRect();
      if (!(r.top < dockTop && r.bottom > visBottom + 4)) problems.push('洋紅圖要從黏底那一塊上緣上面一路延伸到看得到範圍下面(圖 ' + r.top.toFixed(1) + '–' + r.bottom.toFixed(1) + '、黏底那塊 ' + dockTop.toFixed(1) + '–' + dockBottom.toFixed(1) + '、看得到範圍下緣 ' + visBottom.toFixed(1) + ')');
    } else {
      const lines = [...document.querySelectorAll('.lc-example li')];
      const li = lines.find((x) => x.textContent.includes('補充的第 20 行'));
      const r = li.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (!(mid > dockTop - 1 && mid < visBottom + 1)) problems.push('那一行字的正中間(' + mid.toFixed(1) + ')要在黏底那一塊與看得到範圍下緣之間(' + dockTop.toFixed(1) + '–' + visBottom.toFixed(1) + ')');
    }
    return problems;
  })()`);
  return out;
}

const channelsOff = (p: [number, number, number], panel: [number, number, number]): number => Math.max(Math.abs(p[0] - panel[0]), Math.abs(p[1] - panel[1]), Math.abs(p[2] - panel[2]));
const hex = (p: [number, number, number]): string => `#${p.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** 面板色:.hud-body 左內距裡(離看得到範圍左緣 6 px)、黏底那一塊上面 8 px 的一個點 */
function panelColour(img: Image, f: DockFacts): [number, number, number] {
  return px(img, (f.visible.left + 6) * f.scale, (f.dock.top - 8) * f.scale);
}

/** a:黏底那一塊(扣掉按鈕與出錯字樣那一行)每個像素跟面板色差 ≤ 1;回有問題的像素(最多 8 個)與總數 */
function opaqueProblems(img: Image, f: DockFacts): { total: number; samples: string[]; checked: number } {
  const panel = panelColour(img, f);
  const s = f.scale;
  const x0 = Math.ceil((f.dock.left + 12) * s), x1 = Math.floor((f.dock.right - 12) * s);
  const y0 = Math.ceil((f.dock.top + 1) * s), y1 = Math.floor(f.dock.bottom * s);
  const holes = [...f.buttons.map((b) => ({ ...b, pad: 1.5 })), ...(f.deepenError ? [{ ...f.deepenError, pad: 2 }] : [])];
  const samples: string[] = [];
  let total = 0, checked = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = (x + 0.5) / s, cy = (y + 0.5) / s;
      if (holes.some((h) => cx >= h.left - h.pad && cx <= h.right + h.pad && cy >= h.top - h.pad && cy <= h.bottom + h.pad)) continue;
      checked += 1;
      const p = px(img, x, y);
      if (channelsOff(p, panel) > 1) {
        total += 1;
        if (samples.length < 8) samples.push(`(${x},${y}) ${hex(p)} 面板 ${hex(panel)}`);
      }
    }
  }
  return { total, samples, checked };
}

/** b:黏底那一塊下緣(往上取整)到下界(往下取整)之間每一排每個像素跟面板色差 ≤ 1 */
function gapProblems(img: Image, f: DockFacts, lower: number): { total: number; samples: string[]; rows: number } {
  const panel = panelColour(img, f);
  const s = f.scale;
  const x0 = Math.ceil((f.dock.left + 12) * s), x1 = Math.floor((f.dock.right - 12) * s);
  const y0 = Math.round(f.dock.bottom * s), y1 = Math.round(lower * s);
  const samples: string[] = [];
  let total = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const p = px(img, x, y);
      if (channelsOff(p, panel) > 1) {
        total += 1;
        if (samples.length < 8) samples.push(`(${x},${y}) ${hex(p)} 面板 ${hex(panel)}`);
      }
    }
  }
  return { total, samples, rows: Math.max(0, y1 - y0) };
}

// ================================================================ 沒有 Wayland 提示:兩種底 × 100% 與 150%

function suite(name: string, mode: Mode): void {
  describe(`T49 渲染:${name}`, () => {
    let app: App | undefined;
    beforeAll(async () => {
      app = await start(mode);
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

    const premise = async (): Promise<void> => {
      const solid = await a().page.evaluate<boolean>(`document.documentElement.classList.contains('hud-solid')`);
      expect(solid, `前提:html 的 hud-solid ${mode.solid ? '有' : '沒有'}`).toBe(mode.solid);
    };

    for (const level of LEVELS) {
      for (const where of ['image', 'text', 'bottom'] as const) {
        const what = where === 'image' ? '洋紅圖在黏底那一塊底下' : where === 'text' ? '一行字在黏底那一塊底下' : '捲到最底';
        it(`a. ${name}、${Math.round(level * 100)}%、${what}:黏底那一塊(扣掉按鈕)每個像素跟面板色每通道差 ≤ 1(不透明、同色)`, async () => {
          await prepare(a());
          await premise();
          await setLevel(a(), level);
          await scrollTo(a().page, where, 'a');
          expect(await behindProblems(a().page, where), '前提:真的有內容在黏底那一塊底下').toEqual([]);
          const f = await dockFacts(a().page);
          const img = await a().page.screenshot();
          expect(Math.abs(img.width - VIEWPORT.width * f.scale), '前提:截圖寬 = 視窗寬 × devicePixelRatio').toBeLessThanOrEqual(1);
          const r = opaqueProblems(img, f);
          expect(r.checked, '前提:有量到像素').toBeGreaterThan(1000);
          expect(r.samples, `黏底那一塊有 ${r.total} / ${r.checked} 個像素跟面板色差超過 1(黏底那塊 ${f.dock.top.toFixed(1)}–${f.dock.bottom.toFixed(1)})`).toEqual([]);
        });
      }
    }

    it(`a. ${name}、150%、捲到字在底下、深入出錯(出錯字樣在):黏底那一塊扣掉按鈕與字樣那一行,每個像素跟面板色差 ≤ 1`, async () => {
      await prepare(a());
      await premise();
      await setLevel(a(), 1.5);
      const { ERROR_MESSAGES } = (await import(/* @vite-ignore */ PROTOCOL)) as { ERROR_MESSAGES: Record<string, string> };
      const message = ERROR_MESSAGES['deepen-failed']!;
      await a().page.evaluate('(window.__t49.hold = true)');
      const clicked = await a().page.evaluate<boolean>(`(() => { const b = ${BUTTON('深入這個')}; if (!b) return false; b.click(); return true; })()`);
      expect(clicked, '要有「深入這個」').toBe(true);
      expect(await waitFor(a().page, 'window.__t49.waiters.length > 0 && document.querySelector(".generating")', 10_000), `要進到生成中;畫面文字:${await pageText(a().page)}`).toBe(true);
      await a().page.evaluate(`(window.__t49.holdError = ${JSON.stringify({ kind: 'deepen-failed', message })})`);
      await a().page.evaluate('window.__t49.release()');
      expect(await waitFor(a().page, `(document.querySelector('.deepen-error')?.textContent ?? '').trim() === ${JSON.stringify(message)}`, 10_000), `要出現深入錯誤字樣;畫面文字:${await pageText(a().page)}`).toBe(true);
      await sleep(400);
      await scrollTo(a().page, 'text', 'a');
      expect(await behindProblems(a().page, 'text'), '前提:真的有字在黏底那一塊底下').toEqual([]);
      const f = await dockFacts(a().page);
      expect(f.deepenError, '前提:量得到出錯字樣那一行').not.toBeNull();
      const r = opaqueProblems(await a().page.screenshot(), f);
      expect(r.checked, '前提:有量到像素').toBeGreaterThan(500);
      expect(r.samples, `出錯字樣在,黏底那一塊有 ${r.total} / ${r.checked} 個像素跟面板色差超過 1`).toEqual([]);
    });

    for (const level of LEVELS) {
      for (const where of ['image', 'text', 'bottom'] as const) {
        const what = where === 'image' ? '洋紅圖延伸到看得到範圍下面' : where === 'text' ? '一行字的正中間在黏底那一塊下面第一排' : '捲到最底';
        it(`b. ${name}、${Math.round(level * 100)}%、${what}:黏底那一塊下緣到看得到範圍下緣之間每一排都沒有露出內容(每通道跟面板色差 ≤ 1)`, async () => {
          await prepare(a());
          await premise();
          await setLevel(a(), level);
          await scrollTo(a().page, where, 'b');
          expect(await behindProblems(a().page, where), '前提:真的有內容在黏底那一塊下面').toEqual([]);
          const f = await dockFacts(a().page);
          const r = gapProblems(await a().page.screenshot(), f, f.visible.bottom);
          expect(r.samples, `黏底那一塊下緣 ${f.dock.bottom.toFixed(2)} 到看得到範圍下緣 ${f.visible.bottom.toFixed(2)} 之間 ${r.rows} 排,有 ${r.total} 個像素露出內容`).toEqual([]);
        });
      }
    }
  });
}

suite('有合成器(html 沒有 hud-solid)', { frameless: false, solid: false, wayland: false });
suite('沒有合成器(html 有 hud-solid)', { frameless: false, solid: true, wayland: false });

// ================================================================ Wayland 提示在:黏底那一塊與提示之間

describe('T49 渲染:Wayland 提示在時,黏底那一塊與提示之間不露出內容(b)', () => {
  let app: App | undefined;
  beforeAll(async () => {
    expect(existsSync(WAYLAND_NOTE_JS), `${WAYLAND_NOTE_JS} 要存在(Wayland 提示程式)`).toBe(true);
    app = await start({ frameless: true, solid: false, wayland: true });
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

  for (const level of LEVELS) {
    for (const where of ['image', 'text', 'bottom'] as const) {
      const what = where === 'image' ? '洋紅圖延伸到提示底下' : where === 'text' ? '一行字的正中間在黏底那一塊與提示之間' : '捲到最底';
      it(`b. Wayland 提示在、${Math.round(level * 100)}%、${what}:黏底那一塊下緣到提示上緣之間每一排都沒有露出內容`, async () => {
        await prepare(a());
        expect(await waitFor(a().page, `document.body.innerText.includes(${JSON.stringify(WAYLAND_NOTE_TEXT)})`, 6000), `Wayland 提示要出現;畫面文字:${await pageText(a().page)}`).toBe(true);
        await setLevel(a(), level);
        await scrollTo(a().page, where, 'b');
        const f = await dockFacts(a().page);
        expect(f.noteTop, '前提:量得到提示的上緣').not.toBeNull();
        if (where !== 'bottom') {
          const gap = Math.floor(f.noteTop!) - Math.ceil(f.dock.bottom);
          expect(gap, `前提:黏底那一塊與提示之間有排(下緣 ${f.dock.bottom.toFixed(2)}、提示上緣 ${f.noteTop!.toFixed(2)})`).toBeGreaterThanOrEqual(0);
        }
        const r = gapProblems(await a().page.screenshot(), f, f.noteTop!);
        expect(r.samples, `黏底那一塊下緣 ${f.dock.bottom.toFixed(2)} 到提示上緣 ${f.noteTop!.toFixed(2)} 之間 ${r.rows} 排,有 ${r.total} 個像素露出內容`).toEqual([]);
      });
    }
  }
});
