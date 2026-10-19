/**
 * 10-desktop-shell(工單 T34 B)Wayland 一次性提示,在真 Chrome 裡量:兩張卡都載入「Rust 會交給頁面的那段程式」,
 * 跟 Tauri 的 `initialization_script` 同一個時機(頁面自己的腳本之前、document 還沒有 body)。測試 agent 寫;開發 worker 不改。
 *
 * 那段程式是 `apps/desktop/src-tauri/src/wayland_note.js`(Rust 的 `with_wayland_note` 把它接在 window_mode 的 init script 後面,
 * Rust 側的接法由 src-tauri/tests/wayland_note.rs 守;這裡把同樣的東西用 CDP 的 Page.addScriptToEvaluateOnNewDocument 交給頁面)。
 *
 * 量的是:
 *   1. Wayland:兩個頁面都出現提示(字樣、一顆「知道了」),頁面載入完才出現(init script 在 document start 跑,不能因為還沒有 body 而丟錯);
 *   2. 只出現到按掉為止:按「知道了」→ 提示消失、localStorage 的鍵是 '1' → 同一個來源重新載入不再出現;沒按掉就重新載入仍然出現;
 *   3. X11(沒有這段程式):沒有提示;
 *   4. 樣式:頁面掛著桌面程式的 CSP(`default-src 'self'; script-src 'self'`)時,沒有 style 屬性被擋、沒有程式被擋、console 沒有錯;
 *      提示與按鈕的顏色只來自 `--hud-*`(把每個 --hud-* 色票換成哨兵色,算出來的顏色都得是哨兵色之一);
 *   5. 提示在的時候按鈕都看得到、正中心點得到(考試卡的「送出」照 T15 的量法)。
 * 找不到 Chrome 就紅(設 LC_CHROME)。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CARD_VIEWPORT, DEV_PAGE_CSP, WAYLAND_NOTE_DISMISS_LABEL, WAYLAND_NOTE_JS, WAYLAND_NOTE_STORAGE_KEY, WAYLAND_NOTE_TEXT, type CardName,
} from './card-design-values-test-support.js';
import { openCard, submitVisibleProblems } from './card-render-test-support.js';
import type { GalleryPage } from './render-test-support.js';
import { REPO_ROOT } from './test-support.js';

const WINDOW_MODE_JS = join(REPO_ROOT, 'apps/desktop/src-tauri/src/window_mode.js');
const HUD_CSS = join(REPO_ROOT, 'packages/ui-shared/src/hud/hud.css');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 頁面一開始就掛上的錯誤收集:error、unhandledrejection、CSP 違規、console.error / warn */
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

/** 跟 Rust 的 init script 一樣的形狀:先 window.__LC_WINDOW_MODE__ 那一行,再 window_mode.js,(Wayland 時)再接提示程式 */
function initScript(opts: { wayland: boolean; dismissed?: boolean }): string {
  const mode = `window.__LC_WINDOW_MODE__ = ${JSON.stringify({ frameless: true, solid: false })};\n${readFileSync(WINDOW_MODE_JS, 'utf8')}`;
  const preset = opts.dismissed ? `try { localStorage.setItem(${JSON.stringify(WAYLAND_NOTE_STORAGE_KEY)}, '1'); } catch (e) {}\n` : '';
  return `${COLLECT_ERRORS}\n${preset}${mode}\n${opts.wayland && existsSync(WAYLAND_NOTE_JS) ? readFileSync(WAYLAND_NOTE_JS, 'utf8') : ''}`;
}

const READY: Record<CardName, string> = { 'teach-card': '.markers', 'test-card': '.prompt' };

const hasNote = (page: GalleryPage) => page.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(WAYLAND_NOTE_TEXT)})`);
const DISMISS_BUTTONS = `[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === ${JSON.stringify(WAYLAND_NOTE_DISMISS_LABEL)})`;

async function waitForNote(page: GalleryPage, ms = 4000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await hasNote(page)) return true;
    await sleep(60);
  }
  return false;
}

/** 提示不會出現:頁面載好之後再等一陣子都沒有 */
async function noNoteFor(page: GalleryPage, ms = 1500): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await hasNote(page)) return false;
    await sleep(60);
  }
  return true;
}

/** 同一個來源重新載入(localStorage 還在),等新文件載好、卡片本身的內容出來 */
async function reload(page: GalleryPage, ready: string): Promise<void> {
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

/** 乾淨的起點:清掉 localStorage 再載入一次(教學卡的 reset 是同一個來源,不清的話前一條的「已按掉」會留著) */
async function freshLoad(page: GalleryPage, card: CardName): Promise<void> {
  await page.reset();
  await page.evaluate('try { localStorage.clear(); } catch (e) {} true');
  await reload(page, READY[card]);
}

const errorsOf = (page: GalleryPage) => page.evaluate<string[]>('window.__lcErrors ?? ["(沒有掛上錯誤收集)"]');
/** 會讓桌面程式的頁面壞掉的那幾種:程式或行內樣式被 CSP 擋掉、丟錯、console 有錯 */
const harmful = (errors: string[]) =>
  errors.filter((e) => /^(error|rejection|console\.|csp script-src|csp style-src-attr)/.test(e) && e !== 'csp script-src: eval '); // eval 是 dev server 自己的,不是提示程式

for (const card of ['teach-card', 'test-card'] as const) {
  describe(`${card}:Wayland 提示(真 Chrome,T34 B)`, () => {
    let page: GalleryPage | undefined;
    beforeAll(async () => {
      page = await openCard(card, { initScript: initScript({ wayland: true }), headers: { 'Content-Security-Policy': DEV_PAGE_CSP } });
    }, 120_000);
    afterAll(async () => { await page?.close(); }, 30_000);
    const p = (): GalleryPage => { if (!page) throw new Error('卡片沒有開起來'); return page; };

    it('B1 Wayland:載入完出現提示,字樣照 placeholder,而且只有一顆「知道了」;提示程式在 document start 跑也不丟錯', async () => {
      expect(existsSync(WAYLAND_NOTE_JS), 'apps/desktop/src-tauri/src/wayland_note.js 不存在(Rust 要 include_str! 它)').toBe(true);
      await freshLoad(p(), card);
      expect(await waitForNote(p()), `頁面載入後 4 秒內沒有出現提示「${WAYLAND_NOTE_TEXT}」;畫面文字:${await p().evaluate<string>('document.body.innerText')}`).toBe(true);
      expect(await p().evaluate<number>(`${DISMISS_BUTTONS}.length`), '「知道了」鍵要剛好一顆').toBe(1);
      expect(harmful(await errorsOf(p())), '提示出現的過程不該有錯').toEqual([]);
    }, 120_000);

    it('B2 沒按掉就重新載入:提示照樣出現(只有按掉才算看過)', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      await reload(p(), READY[card]);
      expect(await waitForNote(p()), '沒有按「知道了」,重新載入後提示應該還在').toBe(true);
    }, 120_000);

    it('B2 按「知道了」:提示消失、localStorage 的鍵是 1;同一個來源重新載入不再出現(兩張卡同一個來源,按一次就夠)', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      expect(await p().evaluate<boolean>(`(() => { const b = ${DISMISS_BUTTONS}[0]; if (!b) return false; b.click(); return true; })()`), '找不到「知道了」鍵').toBe(true);
      await sleep(200);
      expect(await hasNote(p()), '按了「知道了」,提示還在').toBe(false);
      expect(await p().evaluate<string | null>(`localStorage.getItem(${JSON.stringify(WAYLAND_NOTE_STORAGE_KEY)})`)).toBe('1');
      await reload(p(), READY[card]);
      expect(await noNoteFor(p()), '按掉之後重新載入,提示又出現了').toBe(true);
    }, 120_000);

    it('B2 localStorage 已經有 1(別的視窗按過):載入之後不出現', async () => {
      const dismissed = await openCard(card, { initScript: initScript({ wayland: true, dismissed: true }), headers: { 'Content-Security-Policy': DEV_PAGE_CSP } });
      try {
        expect(await noNoteFor(dismissed, 2000), '鍵已經是 1,提示不該出現').toBe(true);
      } finally {
        await dismissed.close();
      }
    }, 120_000);

    it('B5 樣式:CSP 底下沒有 style 屬性被擋、沒有程式被擋、console 0 則;提示裡沒有 <style>(style 屬性靠 CSP 擋、靜態測試查)', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      await sleep(300);
      expect(harmful(await errorsOf(p())), `提示在的時候,頁面有錯:${(await errorsOf(p())).join(' | ')}`).toEqual([]);
      const inline = await p().evaluate<number>(`(() => {
        const button = ${DISMISS_BUTTONS}[0];
        if (!button) return -1;
        let box = button;
        while (box.parentElement && box !== document.body && !box.innerText.includes(${JSON.stringify(WAYLAND_NOTE_TEXT)})) box = box.parentElement;
        return [box, ...box.querySelectorAll('*')].filter((e) => e.tagName === 'STYLE').length;
      })()`);
      expect(inline, '提示(含按鈕)裡有 <style> 元素').toBe(0);
    }, 120_000);

    it('B5 顏色只來自 --hud-*:把每個 --hud-* 色票換成哨兵色,提示與按鈕算出來的顏色都得是哨兵色(或全透明)', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      const tokens = [...new Set(readFileSync(HUD_CSS, 'utf8').match(/--hud-(?:text|panel|line|accent-wash|accent|hp|solid|page-line|page|pass|fail)\b(?=\s*:)/g) ?? [])];
      expect(tokens.length, 'hud.css 的色票名字讀不到').toBeGreaterThan(5);
      const offenders = await p().evaluate<string[]>(`(() => {
        const tokens = ${JSON.stringify(tokens)};
        const sentinel = new Set();
        tokens.forEach((t, i) => {
          const rgb = [11 + i * 17, 201 - i * 13, 31 + i * 9];
          sentinel.add(rgb.join(','));
          document.documentElement.style.setProperty(t, 'rgb(' + rgb.join(', ') + ')');
        });
        const channels = (c) => { const m = /rgba?\\(([^)]*)\\)/.exec(c); return m ? m[1].split(/[ ,\\/]+/).filter(Boolean).slice(0, 3).map(Number).join(',') : c; };
        const button = ${DISMISS_BUTTONS}[0];
        let box = button;
        while (box.parentElement && box !== document.body && !box.innerText.includes(${JSON.stringify(WAYLAND_NOTE_TEXT)})) box = box.parentElement;
        const bad = [];
        for (const e of [box, ...box.querySelectorAll('*')]) {
          const cs = getComputedStyle(e);
          const label = e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().split(/\\s+/).join('.') : '');
          const check = (prop, value, skipTransparent) => {
            if (skipTransparent && /rgba\\(0, 0, 0, 0\\)|transparent/.test(value)) return;
            if (!sentinel.has(channels(value))) bad.push(label + ' ' + prop + '=' + value);
          };
          check('color', cs.color, false);
          check('background-color', cs.backgroundColor, true);
          for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
            if (parseFloat(cs['border' + side + 'Width']) > 0 && cs['border' + side + 'Style'] !== 'none') check('border-' + side.toLowerCase() + '-color', cs['border' + side + 'Color'], true);
          }
          if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none') check('outline-color', cs.outlineColor, true);
        }
        return bad;
      })()`);
      expect(offenders, `這些顏色不是從 --hud-* 來的(寫死的色碼或別的來源):${offenders.join(' | ')}`).toEqual([]);
    }, 120_000);

    it('B5 提示在的時候:按鈕都看得到、正中心點得到;提示沒有超出視窗', async () => {
      await freshLoad(p(), card);
      expect(await waitForNote(p())).toBe(true);
      await sleep(200);
      const { width: W, height: H } = CARD_VIEWPORT;
      const m = await p().evaluate<{ box: { x: number; y: number; w: number; h: number }; buttons: { text: string; x: number; y: number; w: number; h: number; hit: boolean }[] }>(`(() => {
        const b0 = ${DISMISS_BUTTONS}[0];
        let box = b0;
        while (box.parentElement && box !== document.body && !box.innerText.includes(${JSON.stringify(WAYLAND_NOTE_TEXT)})) box = box.parentElement;
        const r = box.getBoundingClientRect();
        const buttons = [...document.querySelectorAll('button')].map((b) => {
          const q = b.getBoundingClientRect();
          const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
          return { text: b.textContent.trim(), x: q.left, y: q.top, w: q.width, h: q.height, hit: Boolean(hit && (hit === b || b.contains(hit))) };
        });
        return { box: { x: r.left, y: r.top, w: r.width, h: r.height }, buttons };
      })()`);
      expect(m.box.x, '提示超出視窗左緣').toBeGreaterThanOrEqual(-1);
      expect(m.box.x + m.box.w, '提示超出視窗右緣').toBeLessThanOrEqual(W + 1);
      expect(m.box.y + m.box.h, '提示超出視窗下緣').toBeLessThanOrEqual(H + 1);
      expect(m.buttons.length).toBeGreaterThan(0);
      for (const b of m.buttons) {
        const inside = b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H;
        if (!inside) continue; // 捲動區外面的鍵(例如還沒出現在第一屏的)不在這條量
        expect(b.hit, `「${b.text}」正中心那一點被別的東西蓋住(提示蓋住了按鈕)`).toBe(true);
      }
      expect(m.buttons.some((b) => b.text === WAYLAND_NOTE_DISMISS_LABEL && b.hit), '「知道了」自己點不到').toBe(true);
      if (card === 'test-card') expect(await submitVisibleProblems(p())).toEqual([]);
    }, 120_000);
  });

  describe(`${card}:X11(沒有提示程式)`, () => {
    it('B3 X11:Rust 不接提示程式,頁面沒有提示;console 0 則', async () => {
      const page = await openCard(card, { initScript: initScript({ wayland: false }), headers: { 'Content-Security-Policy': DEV_PAGE_CSP } });
      try {
        await freshLoad(page, card);
        expect(await noNoteFor(page, 1500), 'X11 不該出現提示').toBe(true);
        expect(harmful(await errorsOf(page))).toEqual([]);
      } finally {
        await page.close();
      }
    }, 120_000);
  });
}
