/**
 * T50(沒有 Wayland 提示時,黏底那一塊的偽元素不往下多蓋 1 px;T49 `@manual` 的 F2)渲染測試 c1–c4。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T50-teach-card-dock-extension-wayland-only.md 「驗收條件 1」與「顧問審工單時加的三條」。
 *
 * 真的把 `App.svelte` 畫出來(`openApp(apps/teach-card, { viewport: 360 × 480, initScript })` + 真的側車 + headless Chrome),
 * 縮放用真的鍵盤(Ctrl+=),捲動用程式(scrollTop),量計算後的樣式與位置。不讀原始碼比字串(SKILL §4g 第 29 條)。
 *
 * 黏底那一塊不寫死是哪個元素:從「下一個」往上找 computed `position: sticky` 的祖先;找不到就丟錯(前提不成立)。
 *
 * c1 沒有提示:黏底那一塊的 `::before`、`::after` 計算後的 `bottom` 是 `0px`;`.hud-body` 的 `scrollHeight`
 *    等於「把兩個偽元素的 `bottom` 改成 0」時的值。比較用的規則加 `!important`(Svelte 會在選擇器加 scoped class,裸規則權重輸),
 *    插完先量計算後的 `bottom` 確認真的是 `0px` 才比(顧問 2026-10-25:不然兩邊永遠相等,那半條是假綠)。
 *    有合成器與 hud-solid 兩種底 × 100% 與 150%。
 * c2 提示在(`initScript` 放 Rust 組出來的真提示程式,T47 f / T49 b 的做法):兩個偽元素計算後的 `bottom` 是 `-1px`。
 * c3 提示在 → 按「知道了」(提示拿掉):回到 c1 的兩條。
 * c4 沒有提示,150% 長卡:捲到中間 − 捲到底,黏底那一塊裡每顆按鈕的 y 差 ≤ 0.5 px(只在這個檔;T47 c 的容差維持 1.5 不動)。
 *
 * 在 67e2ded 的 App.svelte 上:c1、c3、c4 紅(偽元素一律 `inset: 0 0 -1px 0`);c2 本來就綠(護欄)。
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
const PROTOCOL = pathToFileURL(join(ROOT, 'packages/core/src/session/protocol.ts')).href;

const LEVELS = [1, 1.5] as const;
const ZOOM_IN_TIMES: Record<number, number> = { 1: 0, 1.5: 4 }; // 100% → 110% → 125% → 150% 要 3 次;多按 1 次確認到頂不動

// ---------------------------------------------------------------- 卡片內容

const LINE = (n: number): string => `- 補充的第 ${n} 行字很多很多很多很多很多很多很多很多`;
const LINES = (from: number, to: number): string => Array.from({ length: to - from + 1 }, (_, i) => LINE(from + i)).join('\n');
const BODY = [
  'T50-BODY 內文。',
  '',
  '```example',
  '很長的例子:',
  '',
  LINES(1, 30),
  '',
  '![洋紅](../../assets/t50-magenta.png)',
  '',
  LINES(31, 60),
  '```',
].join('\n');

// ---------------------------------------------------------------- 頁面腳本

const FETCH_SCRIPT = `(() => {
  const orig = window.fetch.bind(window);
  const st = (window.__t50 = { hold: false, holdError: null, waiters: [] });
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
      try { body = localStorage.getItem('t50.body') || ''; } catch { body = ''; }
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
  writeImage(learningDir, 'assets/t50-magenta.png', 280, 1200, [255, 0, 255]);
  const input = await RealInput.attach(page.url);
  return { page, input, learningDir };
}

async function stop(app: App | undefined): Promise<void> {
  app?.input.close();
  await app?.page.close();
}

async function quiesce(page: GalleryPage): Promise<void> {
  await page.evaluate(`(async () => {
    window.__t50.holdError = null;
    window.__t50.release();
    const res = await fetch('/__review', { method: 'POST', body: JSON.stringify({ v: 1, id: 90001, method: 'teach.cancel', params: {} }) });
    await res.text();
    return true;
  })()`);
}

/** 一條測試的開頭:學過紀錄清空、換上這張卡、清掉 localStorage(縮放記錄也清,回 100%)、整頁重新載入 */
async function prepare(app: App): Promise<void> {
  writeFileSync(join(app.learningDir, 'state/reviews.json'), '{}\n');
  await app.page.evaluate(`(() => { try { localStorage.clear(); localStorage.setItem('t50.body', ${JSON.stringify(BODY)}); } catch {} return true; })()`);
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

const FIND_DOCK = `(() => {
  const next = ${BUTTON('下一個')};
  for (let e = next ? next.parentElement : null; e; e = e.parentElement) if (getComputedStyle(e).position === 'sticky') return e;
  return null;
})()`;

/** 前提:黏底那一塊找得到(沒有就丟錯,不是斷言失敗) */
async function requireDock(page: GalleryPage): Promise<void> {
  const found = await page.evaluate<boolean>(`Boolean(${FIND_DOCK})`);
  if (!found) throw new Error(`前提不成立:從「下一個」往上找不到 position: sticky 的祖先;畫面文字:${await pageText(page)}`);
}

/** 兩個偽元素計算後的 bottom */
async function pseudoBottoms(page: GalleryPage): Promise<{ before: string; after: string }> {
  return page.evaluate<{ before: string; after: string }>(`(() => {
    const dock = ${FIND_DOCK};
    return { before: getComputedStyle(dock, '::before').bottom, after: getComputedStyle(dock, '::after').bottom };
  })()`);
}

interface Probe {
  scrollHeight: number;
  /** 插入「兩個偽元素 bottom: 0 !important」之後,偽元素計算後的 bottom(前提:要是 0px,規則才算真的生效) */
  probedBottoms: { before: string; after: string };
  probedScrollHeight: number;
  /** 量完 deleteRule 之後的 scrollHeight(前提:要回到原值) */
  restoredScrollHeight: number;
  restoredBottoms: { before: string; after: string };
}

/** 在測試頁裡用 CSSOM 插一條規則把兩個偽元素的 bottom 改成 0(!important,權重一定贏 Svelte 的 scoped 規則),量完刪掉。不改檔。 */
async function probeScrollHeight(page: GalleryPage): Promise<Probe> {
  return page.evaluate<Probe>(`(() => {
    const dock = ${FIND_DOCK};
    const body = document.querySelector('.hud-body');
    const bottoms = () => ({ before: getComputedStyle(dock, '::before').bottom, after: getComputedStyle(dock, '::after').bottom });
    const scrollHeight = body.scrollHeight;
    const style = document.createElement('style');
    document.head.appendChild(style);
    const sheet = style.sheet;
    const index = sheet.insertRule('.hud-body .dock::before, .hud-body .dock::after, [data-hud] .hud-body *::before, [data-hud] .hud-body *::after { bottom: 0px !important; }', 0);
    const probedBottoms = bottoms();
    const probedScrollHeight = body.scrollHeight;
    sheet.deleteRule(index);
    style.remove();
    return { scrollHeight, probedBottoms, probedScrollHeight, restoredScrollHeight: body.scrollHeight, restoredBottoms: bottoms() };
  })()`);
}

/** c1 / c3 共用:偽元素的 bottom 是 0px,scrollHeight 跟「改成 0」時一樣 */
async function noExtensionChecks(page: GalleryPage, tag: string): Promise<void> {
  await requireDock(page);
  const p = await probeScrollHeight(page);
  // 前提:比較用的規則真的生效,而且量完有還原(不然下面的相等是假綠)
  expect(p.probedBottoms, `${tag}:前提:插入的規則要真的把兩個偽元素計算後的 bottom 變成 0px`).toEqual({ before: '0px', after: '0px' });
  expect(p.restoredBottoms, `${tag}:前提:量完 deleteRule 要回到插入前的計算值`).toEqual(await pseudoBottoms(page));
  expect(p.restoredScrollHeight, `${tag}:前提:量完 scrollHeight 要回到原值`).toBe(p.scrollHeight);
  const now = await pseudoBottoms(page);
  expect(now, `${tag}:沒有提示時,黏底那一塊的 ::before 與 ::after 計算後的 bottom 要是 0px(不往下多蓋)`).toEqual({ before: '0px', after: '0px' });
  expect(p.scrollHeight, `${tag}:沒有提示時,.hud-body 的 scrollHeight(${p.scrollHeight})要等於偽元素 bottom 改成 0 時的值(${p.probedScrollHeight});多出來的是偽元素往下多蓋的 1 px`).toBe(p.probedScrollHeight);
}

/** 黏底那一塊裡每顆按鈕的上緣 y */
async function buttonYs(page: GalleryPage): Promise<number[]> {
  return page.evaluate<number[]>(`(() => {
    const dock = ${FIND_DOCK};
    return [...dock.querySelectorAll('button')].map((b) => b.getBoundingClientRect().top);
  })()`);
}

async function scrollHudBody(page: GalleryPage, where: 'middle' | 'bottom'): Promise<void> {
  await page.evaluate(`(() => {
    const b = document.querySelector('.hud-body');
    const max = b.scrollHeight - b.clientHeight;
    b.scrollTop = ${JSON.stringify(where)} === 'middle' ? Math.round(max / 2) : max;
    return true;
  })()`);
  await sleep(350);
}

const noteIsThere = (page: GalleryPage): Promise<boolean> => page.evaluate<boolean>(`Boolean(document.getElementById('lc-wayland-note'))`);

// ================================================================ c1、c4:沒有 Wayland 提示

function noNoteSuite(name: string, mode: Mode): void {
  describe(`T50 渲染:沒有提示、${name}`, () => {
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
      expect(await noteIsThere(a().page), '前提:沒有 Wayland 提示').toBe(false);
    };

    for (const level of LEVELS) {
      it(`c1. ${name}、${Math.round(level * 100)}%、長卡:偽元素的 bottom 是 0px,scrollHeight 等於 bottom 改成 0 時的值`, async () => {
        await prepare(a());
        await premise();
        await setLevel(a(), level);
        await noExtensionChecks(a().page, `${name}、${Math.round(level * 100)}%`);
      });
    }

    it(`c4. ${name}、150%、長卡:捲到中間 − 捲到底,黏底那一塊裡每顆按鈕的 y 差 ≤ 0.5 px`, async () => {
      await prepare(a());
      await premise();
      await setLevel(a(), 1.5);
      await requireDock(a().page);
      await scrollHudBody(a().page, 'middle');
      const mid = await buttonYs(a().page);
      await scrollHudBody(a().page, 'bottom');
      const bottom = await buttonYs(a().page);
      expect(mid.length, `前提:黏底那一塊裡有按鈕(中間 ${mid.length} 顆、最底 ${bottom.length} 顆)`).toBeGreaterThanOrEqual(1);
      expect(bottom.length, '前提:兩個位置的按鈕一樣多').toBe(mid.length);
      const max = await a().page.evaluate<{ scrollTop: number; max: number }>(`(() => { const b = document.querySelector('.hud-body'); return { scrollTop: b.scrollTop, max: b.scrollHeight - b.clientHeight }; })()`);
      expect(max.max, '前提:卡夠長,真的能捲').toBeGreaterThan(400);
      const diffs = mid.map((y, i) => y - bottom[i]!);
      expect(diffs.map((d) => Math.abs(d)).filter((d) => d > 0.5), `按鈕 y(捲到中間 ${mid.map((y) => y.toFixed(2)).join('、')};捲到底 ${bottom.map((y) => y.toFixed(2)).join('、')})差 ${diffs.map((d) => d.toFixed(2)).join('、')} px,要都 ≤ 0.5`).toEqual([]);
    });
  });
}

noNoteSuite('有合成器(html 沒有 hud-solid)', { frameless: false, solid: false, wayland: false });
noNoteSuite('沒有合成器(html 有 hud-solid)', { frameless: false, solid: true, wayland: false });

// ================================================================ c2、c3:Wayland 提示在

describe('T50 渲染:Wayland 提示在時多蓋的 1 px 還在(c2),按掉提示後回到沒有提示的樣子(c3)', () => {
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

  const showNote = async (): Promise<void> => {
    await prepare(a());
    expect(await waitFor(a().page, `document.body.innerText.includes(${JSON.stringify(WAYLAND_NOTE_TEXT)})`, 6000), `Wayland 提示要出現;畫面文字:${await pageText(a().page)}`).toBe(true);
    expect(await noteIsThere(a().page), '前提:提示在 DOM 裡(id lc-wayland-note)').toBe(true);
  };

  for (const level of LEVELS) {
    it(`c2. Wayland 提示在、${Math.round(level * 100)}%、長卡:兩個偽元素計算後的 bottom 是 -1px`, async () => {
      await showNote();
      await setLevel(a(), level);
      await requireDock(a().page);
      expect(await pseudoBottoms(a().page), `提示在時,黏底那一塊的 ::before 與 ::after 要往下多蓋 1 px(計算後的 bottom -1px)`).toEqual({ before: '-1px', after: '-1px' });
    });

    it(`c3. Wayland 提示在 → 按「${WAYLAND_NOTE_DISMISS_LABEL}」、${Math.round(level * 100)}%、長卡:回到 c1 的兩條(bottom 是 0px,scrollHeight 等於 bottom 改成 0 時的值)`, async () => {
      await showNote();
      await setLevel(a(), level);
      const clicked = await a().page.evaluate<boolean>(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(WAYLAND_NOTE_DISMISS_LABEL)});
        if (!b) return false;
        b.click();
        return true;
      })()`);
      expect(clicked, `要有「${WAYLAND_NOTE_DISMISS_LABEL}」按鈕`).toBe(true);
      expect(await waitFor(a().page, `!document.getElementById('lc-wayland-note')`, 6000), '按掉之後提示要從 DOM 拿掉').toBe(true);
      await sleep(250);
      await noExtensionChecks(a().page, `按掉提示後、${Math.round(level * 100)}%`);
    });
  }
});
