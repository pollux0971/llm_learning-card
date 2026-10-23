/**
 * 10-desktop-shell(工單 T35)Wayland 一次性提示讓出位置:在真 Chrome 裡量「規則」,不比 `@manual` 那張表的數字。測試 agent 寫;開發 worker 不改。
 * 工單:`docs/tickets/T35-wayland-note-reserve-space.md`。T34 的提示測試在 card-render-wayland-note.test.ts,這裡不重複,只加 T35 的:
 *
 *   1. 提示固定在底部不動:左右各 8、離視窗底 8;第一次出現、換畫面、捲到底、捲回頂都一樣(矩形一模一樣);
 *   2. 留白:提示在的時候,`[data-hud="panel"].hud-fill .hud-body` 的 padding-bottom = 原本的值 + 提示現在的高度(±0.5 px),而且是這個元素;
 *   3. 捲到底不蓋:每個畫面捲到底之後,每顆按鈕、每個輸入框、每個有字的元素跟提示的**矩形重疊面積**都是 0
 *      (只用矩形量,不用 elementFromPoint:提示是 pointer-events: none,點擊會穿過去,那正是 T34 的盲點);
 *   4. 變窄重算:視窗變窄、提示變高,留白跟著變成新的高度,捲到底還是 0;改回來也跟著;
 *   5. 按掉:提示不見,padding-bottom 回到原本的值,沒有 inline 的 padding-bottom;
 *   6. X11(沒有這段程式):padding-bottom 是原本的值、沒有 inline 值;
 *   7. 靜態:提示程式沒有 style 屬性、innerHTML、cssText、<style>、色碼字面值,而且有碰 padding-bottom(靜態只管這幾條,行為靠上面的量測)。
 * 「原本的值」= 同一張卡 X11(沒有提示程式)時 `.hud-body` 的計算 padding-bottom,不寫死 16。
 * 找不到 Chrome 就紅(設 LC_CHROME)。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CARD_VIEWPORT, DEV_PAGE_CSP, NEXT_LABEL, WAYLAND_NOTE_DISMISS_LABEL, WAYLAND_NOTE_JS, WAYLAND_NOTE_TEXT, type CardName,
} from './card-design-values-test-support.js';
import { gotoApply, openCard, submitCurrent } from './card-render-test-support.js';
import type { GalleryPage } from './render-test-support.js';
import { REPO_ROOT } from './test-support.js';

const WINDOW_MODE_JS = join(REPO_ROOT, 'apps/desktop/src-tauri/src/window_mode.js');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const READY: Record<CardName, string> = { 'teach-card': '.markers', 'test-card': '.prompt' };

const COLLECT_ERRORS = `(() => {
  window.__lcErrors = [];
  const push = (kind, text) => window.__lcErrors.push(kind + ': ' + text);
  window.addEventListener('error', (e) => push('error', e.message));
  window.addEventListener('unhandledrejection', (e) => push('rejection', String(e.reason)));
  document.addEventListener('securitypolicyviolation', (e) => push('csp ' + e.effectiveDirective, e.blockedURI + ' ' + (e.sample || '')));
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { push('console.' + level, args.map(String).join(' ')); original(...args); };
  }
})();`;

function initScript(wayland: boolean): string {
  const mode = `window.__LC_WINDOW_MODE__ = ${JSON.stringify({ frameless: true, solid: false })};\n${readFileSync(WINDOW_MODE_JS, 'utf8')}`;
  return `${COLLECT_ERRORS}\n${mode}\n${wayland && existsSync(WAYLAND_NOTE_JS) ? readFileSync(WAYLAND_NOTE_JS, 'utf8') : ''}`;
}

const harmful = (errors: string[]) =>
  errors.filter((e) => /^(error|rejection|console\.|csp script-src|csp style-src-attr)/.test(e) && e !== 'csp script-src: eval ');
const errorsOf = (page: GalleryPage) => page.evaluate<string[]>('window.__lcErrors ?? ["(沒有掛上錯誤收集)"]');

/** 頁面裡:找提示盒子(含「知道了」鍵、含提示字樣的最近祖先);沒有回 null */
const FIND_NOTE = `(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(WAYLAND_NOTE_DISMISS_LABEL)});
  if (!btn) return null;
  let box = btn;
  while (box.parentElement && box !== document.body && !box.innerText.includes(${JSON.stringify(WAYLAND_NOTE_TEXT)})) box = box.parentElement;
  return box;
})()`;

const SCROLL_AREA = `document.querySelector('[data-hud="panel"].hud-fill .hud-body')`;

interface Rect4 { left: number; top: number; right: number; bottom: number; width: number; height: number }
interface Measure {
  view: { w: number; h: number };
  note: Rect4 | null;
  scroll: { top: number; max: number; padding: number; inline: string; found: boolean };
  /** 跟提示重疊的元素(面積 > 0 的才列):標籤與面積 px² */
  overlaps: { label: string; area: number }[];
  /** 量到的按鈕、輸入框、有字的元素數(確認真的有量) */
  counted: { buttons: number; fields: number; texts: number };
}

/** 捲到指定位置(top / bottom / keep),等兩個 frame 與 120 ms(ResizeObserver 與重排),再量 */
const measureExpr = (where: 'top' | 'bottom' | 'keep') => `(async () => {
  const body = ${SCROLL_AREA};
  if (body && ${JSON.stringify(where)} === 'bottom') body.scrollTop = body.scrollHeight;
  if (body && ${JSON.stringify(where)} === 'top') body.scrollTop = 0;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 120));
  const note = ${FIND_NOTE};
  const rect = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const out = {
    view: { w: window.innerWidth, h: window.innerHeight },
    note: note ? rect(note) : null,
    scroll: body ? { top: body.scrollTop, max: body.scrollHeight - body.clientHeight, padding: parseFloat(getComputedStyle(body).paddingBottom), inline: body.style.getPropertyValue('padding-bottom'), found: true }
                 : { top: 0, max: 0, padding: NaN, inline: '', found: false },
    overlaps: [],
    counted: { buttons: 0, fields: 0, texts: 0 },
  };
  if (!note || !body) return out;
  const nr = rect(note);
  const visible = rect(body); // 按鈕在捲動區外面的部分不算
  const label = (e) => e.tagName.toLowerCase() + ':' + (e.textContent || e.getAttribute('aria-label') || e.getAttribute('data-hud') || '').trim().slice(0, 16);
  const check = (e, kind) => {
    out.counted[kind] += 1;
    const r = rect(e);
    const clipped = { left: Math.max(r.left, visible.left), top: Math.max(r.top, visible.top), right: Math.min(r.right, visible.right), bottom: Math.min(r.bottom, visible.bottom) };
    const a = clipped.right > clipped.left && clipped.bottom > clipped.top ? inter(clipped, nr) : 0;
    if (a > 0.01) out.overlaps.push({ label: label(e), area: Math.round(a * 10) / 10 });
  };
  for (const b of document.querySelectorAll('button')) {
    if (note.contains(b)) continue;
    const r = b.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) check(b, 'buttons');
  }
  for (const f of document.querySelectorAll('input, textarea, [data-hud="field"]')) {
    if (note.contains(f)) continue;
    const r = f.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) check(f, 'fields');
  }
  for (const e of body.querySelectorAll('*')) {
    if (note.contains(e)) continue;
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    if (!hasText) continue;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) check(e, 'texts');
  }
  return out;
})()`;

const measure = (page: GalleryPage, where: 'top' | 'bottom' | 'keep' = 'keep') => page.evaluate<Measure>(measureExpr(where));

const hasNote = (page: GalleryPage) => page.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(WAYLAND_NOTE_TEXT)})`);
async function waitForNote(page: GalleryPage, ms = 4000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await hasNote(page)) return true;
    await sleep(60);
  }
  return false;
}

async function reloadSame(page: GalleryPage, ready: string): Promise<void> {
  await page.evaluate('window.__lcBeforeReload = true; location.reload(); true');
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    await sleep(100);
    try {
      const fresh = await page.evaluate<boolean>(`window.__lcBeforeReload === undefined && document.readyState === 'complete' && Boolean(document.querySelector(${JSON.stringify(ready)}))`);
      if (fresh) return;
    } catch { /* 正在換文件 */ }
  }
  throw new Error('重新載入之後 15 秒內沒有回到卡片畫面');
}

async function freshLoad(page: GalleryPage, card: CardName): Promise<void> {
  await page.reset();
  await page.evaluate('try { localStorage.clear(); } catch (e) {} true');
  await reloadSame(page, READY[card]);
}

async function clickLabel(page: GalleryPage, label: string): Promise<void> {
  const ok = await page.evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.replace(/\\s+/g, '') === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`找不到「${label}」鍵`);
  await sleep(150);
}

const fmt = (m: Measure) => `提示 ${JSON.stringify(m.note)};捲動 ${JSON.stringify(m.scroll)};重疊 ${JSON.stringify(m.overlaps)}`;

/** 每一個畫面:名稱與「走到那裡」的函式(從剛載入的畫面起,依序往下走) */
interface Screen { name: string; go: (page: GalleryPage) => Promise<void> }
const SCREENS: Record<CardName, Screen[]> = {
  'teach-card': [{ name: '教學卡', go: async () => undefined }],
  'test-card': [
    { name: '填空題', go: async () => undefined },
    { name: '填空題的結果', go: async (p) => { await submitCurrent(p); } },
    { name: '應用題', go: async (p) => { await clickLabel(p, NEXT_LABEL); await gotoApply(p); } },
    { name: '應用題的結果', go: async (p) => { await submitCurrent(p); } },
  ],
};

for (const card of ['teach-card', 'test-card'] as const) {
  describe(`${card}:T35 提示讓出位置(真 Chrome)`, () => {
    let page: GalleryPage | undefined;
    let x11: GalleryPage | undefined;
    let base = NaN;
    beforeAll(async () => {
      x11 = await openCard(card, { initScript: initScript(false), headers: { 'Content-Security-Policy': DEV_PAGE_CSP } });
      const m = await measure(x11);
      base = m.scroll.padding;
      page = await openCard(card, { initScript: initScript(true), headers: { 'Content-Security-Policy': DEV_PAGE_CSP } });
    }, 180_000);
    afterAll(async () => { await page?.close(); await x11?.close(); }, 60_000);
    const p = (): GalleryPage => { if (!page) throw new Error('卡片沒有開起來'); return page; };

    it('X11(沒有提示程式):.hud-body 找得到、padding-bottom 是原本的值(> 0)、沒有 inline 的 padding-bottom、沒有提示', async () => {
      const m = await measure(x11!);
      expect(m.scroll.found, '找不到 [data-hud="panel"].hud-fill .hud-body').toBe(true);
      expect(m.note).toBeNull();
      expect(base).toBeGreaterThan(0);
      expect(m.scroll.inline, 'X11 不該有 inline 的 padding-bottom').toBe('');
      for (const s of SCREENS[card].slice(0, 1)) await s.go(x11!);
      expect((await measure(x11!, 'bottom')).scroll.padding).toBeCloseTo(base, 1);
    }, 120_000);

    it('提示固定在底部不動:左右各 8、離視窗底 8;第一次出現、捲到底、捲回頂、每個畫面(換畫面之後)矩形都一樣', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      const { width: W, height: H } = CARD_VIEWPORT;
      const seen: { where: string; m: Measure }[] = [];
      for (const s of SCREENS[card]) {
        await s.go(p());
        for (const where of ['keep', 'bottom', 'top'] as const) seen.push({ where: `${s.name}/${where}`, m: await measure(p(), where) });
      }
      const first = seen[0]!.m.note!;
      expect(first, '提示不見了').not.toBeNull();
      for (const { where, m } of seen) {
        const n = m.note;
        expect(n, `${where}:提示不見了`).not.toBeNull();
        expect(n!.left, `${where}:左邊離 8`).toBeCloseTo(8, 0);
        expect(W - n!.right, `${where}:右邊離 8`).toBeCloseTo(8, 0);
        expect(H - n!.bottom, `${where}:離視窗底 8`).toBeCloseTo(8, 0);
        expect(n!.top, `${where}:提示的上緣動了`).toBeCloseTo(first.top, 1);
        expect(n!.height, `${where}:提示的高度變了`).toBeCloseTo(first.height, 1);
      }
    }, 180_000);

    it('留白:提示在的時候,.hud-body 的 padding-bottom = 原本的值 + 提示現在的高度(±0.5 px),是 inline 值;每個畫面都一樣', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      for (const s of SCREENS[card]) {
        await s.go(p());
        const m = await measure(p());
        expect(m.note, `${s.name}:提示不見了`).not.toBeNull();
        expect(m.scroll.found, `${s.name}:找不到 .hud-body`).toBe(true);
        expect(m.scroll.padding, `${s.name}:padding-bottom 要是 ${base} + ${m.note!.height}(提示的高度)`).toBeGreaterThan(base + m.note!.height - 0.5);
        expect(m.scroll.padding, `${s.name}:留白多了`).toBeLessThan(base + m.note!.height + 0.5);
        expect(m.scroll.inline, `${s.name}:留白要設在 .hud-body 的 inline padding-bottom`).not.toBe('');
      }
      expect(harmful(await errorsOf(p())), `留白造成頁面有錯:${(await errorsOf(p())).join(' | ')}`).toEqual([]);
    }, 180_000);

    it('捲到底不蓋:每個畫面捲到底之後,按鈕、輸入框、有字的元素跟提示的矩形重疊面積都是 0(提示底下沒有有字的元素)', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      let scrollable = 0;
      for (const s of SCREENS[card]) {
        await s.go(p());
        const m = await measure(p(), 'bottom');
        expect(m.counted.buttons, `${s.name}:一顆按鈕都沒量到(量測壞了?)`).toBeGreaterThan(0);
        expect(m.counted.texts, `${s.name}:一個有字的元素都沒量到`).toBeGreaterThan(0);
        expect(m.overlaps, `${s.name}:捲到底之後還有東西跟提示重疊。${fmt(m)}`).toEqual([]);
        if (m.scroll.max > 0) scrollable += 1;
      }
      expect(scrollable, '至少要有一個畫面是捲得動的(一屏外面有東西),不然這條量不到「捲到底」').toBeGreaterThan(0);
    }, 180_000);

    it('變窄重算:視窗變窄、提示變高 → 留白等於新的高度,捲到底仍然重疊 0;改回原寬度,留白又跟著變回來', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      for (const s of SCREENS[card].slice(0, 2)) await s.go(p());
      const wide = await measure(p());
      expect(wide.note).not.toBeNull();
      const resize = p().resize;
      expect(resize, 'GalleryPage 沒有 resize(測試支援檔壞了)').toBeTypeOf('function');
      try {
        await p().resize!(230, CARD_VIEWPORT.height);
        await sleep(300);
        const narrow = await measure(p(), 'bottom');
        expect(narrow.view.w).toBe(230);
        expect(narrow.note!.height, '視窗變窄之後提示應該變高(量測前提)').toBeGreaterThan(wide.note!.height + 5);
        expect(narrow.scroll.padding, `留白沒有跟著提示的新高度(${narrow.note!.height})重算,還是 ${narrow.scroll.padding}`).toBeGreaterThan(base + narrow.note!.height - 0.5);
        expect(narrow.scroll.padding).toBeLessThan(base + narrow.note!.height + 0.5);
        expect(narrow.overlaps, `變窄之後捲到底仍有重疊。${fmt(narrow)}`).toEqual([]);
        expect(narrow.note!.bottom, '變窄之後提示還是離視窗底 8').toBeCloseTo(CARD_VIEWPORT.height - 8, 0);
      } finally {
        await p().resize!(CARD_VIEWPORT.width, CARD_VIEWPORT.height);
      }
      await sleep(300);
      const back = await measure(p(), 'bottom');
      expect(back.note!.height).toBeCloseTo(wide.note!.height, 0);
      expect(back.scroll.padding, '改回原寬度,留白應該跟著回到原本的提示高度').toBeGreaterThan(base + back.note!.height - 0.5);
      expect(back.scroll.padding).toBeLessThan(base + back.note!.height + 0.5);
      expect(back.overlaps).toEqual([]);
    }, 180_000);

    it('按「知道了」:提示不見,padding-bottom 回到原本的值,沒有 inline 的 padding-bottom;每個畫面按掉都一樣', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      const before = await measure(p());
      expect(before.scroll.padding, '提示在的時候要有留白(量測前提)').toBeGreaterThan(base + 1);
      expect(await p().evaluate<boolean>(`(() => { const n = ${FIND_NOTE}; const b = n && [...n.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(WAYLAND_NOTE_DISMISS_LABEL)}); if (!b) return false; b.click(); return true; })()`)).toBe(true);
      await sleep(250);
      expect(await hasNote(p()), '按了「知道了」,提示還在').toBe(false);
      const after = await measure(p(), 'bottom');
      expect(after.scroll.inline, '按掉之後 .hud-body 還留著 inline 的 padding-bottom').toBe('');
      expect(after.scroll.padding, `按掉之後 padding-bottom 要回到 ${base}`).toBeCloseTo(base, 1);
    }, 180_000);

    it('按掉之後才換畫面:留白不會又冒出來(考試卡:送出後的結果畫面)', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      await p().evaluate(`(() => { const n = ${FIND_NOTE}; [...n.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(WAYLAND_NOTE_DISMISS_LABEL)}).click(); return true; })()`);
      await sleep(250);
      for (const s of SCREENS[card]) {
        await s.go(p());
        const m = await measure(p(), 'bottom');
        expect(m.scroll.inline, `${s.name}:按掉之後換畫面,inline 的 padding-bottom 又出現`).toBe('');
        expect(m.scroll.padding, s.name).toBeCloseTo(base, 1);
      }
    }, 180_000);
  });
}

describe('T35 靜態:提示程式只走 CSSOM,而且有碰 .hud-body 的 padding-bottom', () => {
  const src = (): string => {
    expect(existsSync(WAYLAND_NOTE_JS), 'apps/desktop/src-tauri/src/wayland_note.js 不存在').toBe(true);
    return readFileSync(WAYLAND_NOTE_JS, 'utf8');
  };
  // 拿掉註解再比對(註解裡可以講「不用 style 屬性」)
  const code = (): string => src().replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('沒有 style 屬性(setAttribute("style")、style="…"、cssText)、沒有 innerHTML / outerHTML / insertAdjacentHTML、沒有 <style>', () => {
    const c = code();
    expect(c).not.toMatch(/setAttribute\(\s*['"]style['"]/);
    expect(c).not.toMatch(/\bstyle\s*=\s*['"]/);
    expect(c).not.toMatch(/\bcssText\b/);
    expect(c).not.toMatch(/\b(innerHTML|outerHTML|insertAdjacentHTML)\b/);
    expect(c).not.toMatch(/<style|createElement\(\s*['"]style['"]/i);
  });

  it('顏色沒有色碼字面值(#rgb / rgb( / hsl( / 色名),只用 var(--hud-*)', () => {
    const c = code();
    expect(c).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/);
    expect(c).not.toMatch(/\b(rgba?|hsla?)\(\s*\d/);
  });

  it('有設 padding-bottom(CSSOM:setProperty("padding-bottom") 或 .paddingBottom)', () => {
    expect(code()).toMatch(/padding-bottom|paddingBottom/);
  });
});

/* ───────────── N10(顧問 2026-10-23):.hud-body 原本就有 inline 的 padding-bottom ───────────── */

const PRESET_INLINE = '20px';

/** 在提示程式之前,.hud-body 一出現就先設一個 inline 的 padding-bottom(模擬「原本就有 inline 值」);之後才接提示程式 */
function initScriptPreset(): string {
  const preset = `(() => {
    const SEL = '[data-hud="panel"].hud-fill .hud-body';
    const apply = () => { const e = document.querySelector(SEL); if (e && !e.__lcPreset) { e.__lcPreset = true; e.style.setProperty('padding-bottom', ${JSON.stringify(PRESET_INLINE)}); } };
    new MutationObserver(apply).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', apply);
    apply();
  })();`;
  return `${COLLECT_ERRORS}\n${preset}\nwindow.__LC_WINDOW_MODE__ = ${JSON.stringify({ frameless: true, solid: false })};\n${readFileSync(WINDOW_MODE_JS, 'utf8')}\n${existsSync(WAYLAND_NOTE_JS) ? readFileSync(WAYLAND_NOTE_JS, 'utf8') : ''}`;
}

for (const card of ['teach-card', 'test-card'] as const) {
  describe(`${card}:T35 N10 .hud-body 原本就有 inline padding-bottom(${PRESET_INLINE})`, () => {
    let page: GalleryPage | undefined;
    beforeAll(async () => {
      page = await openCard(card, { initScript: initScriptPreset(), headers: { 'Content-Security-Policy': DEV_PAGE_CSP } });
    }, 120_000);
    afterAll(async () => { await page?.close(); }, 60_000);
    const p = (): GalleryPage => { if (!page) throw new Error('卡片沒有開起來'); return page; };

    it('提示在的時候:留白 = 原本的 inline 值 + 提示高度(量測前提:預設值真的被設上了);按「知道了」:inline 值還原成原本的那個,不是拿掉、也不是 16px', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      const before = await measure(p());
      expect(before.scroll.padding, `預設的 inline 值沒有設上(量測壞了?)。${fmt(before)}`).toBeGreaterThan(Number.parseFloat(PRESET_INLINE) + 1);
      expect(before.scroll.padding, '提示在的時候:原本的值(20)+ 提示的高度').toBeGreaterThan(Number.parseFloat(PRESET_INLINE) + before.note!.height - 0.5);
      expect(before.scroll.padding).toBeLessThan(Number.parseFloat(PRESET_INLINE) + before.note!.height + 0.5);
      expect(await p().evaluate<boolean>(`(() => { const n = ${FIND_NOTE}; const b = n && [...n.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(WAYLAND_NOTE_DISMISS_LABEL)}); if (!b) return false; b.click(); return true; })()`)).toBe(true);
      await sleep(250);
      expect(await hasNote(p())).toBe(false);
      const after = await measure(p(), 'bottom');
      expect(after.scroll.inline, '按掉之後 inline 的 padding-bottom 要回到原本的 20px').toBe(PRESET_INLINE);
      expect(after.scroll.padding).toBeCloseTo(Number.parseFloat(PRESET_INLINE), 1);
    }, 180_000);

    it('提示的高度變了(變窄)再按掉:還原的仍是最原本的 inline 值(不是中間算出來的留白)', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      try {
        await p().resize!(230, CARD_VIEWPORT.height);
        await sleep(300);
        const narrow = await measure(p());
        expect(narrow.scroll.padding).toBeGreaterThan(Number.parseFloat(PRESET_INLINE) + narrow.note!.height - 0.5);
      } finally {
        await p().resize!(CARD_VIEWPORT.width, CARD_VIEWPORT.height);
      }
      await sleep(300);
      await p().evaluate(`(() => { const n = ${FIND_NOTE}; [...n.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(WAYLAND_NOTE_DISMISS_LABEL)}).click(); return true; })()`);
      await sleep(250);
      const after = await measure(p());
      expect(after.scroll.inline).toBe(PRESET_INLINE);
    }, 180_000);
  });
}
