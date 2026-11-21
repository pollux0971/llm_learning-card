/**
 * T67 渲染測試(07 phase-5 今日負擔提示):`App.svelte` 真的畫出來,量畫面,不比原始碼字串(SKILL §4g 第 29 條)。測試 agent 寫;開發 worker 不改。
 * 工單 docs/tickets/T67-teach-card-daily-load-hint.md「紅測試」表的「版面」「樣式」「焦點」與 must_catch 後 4 條。
 *
 * 做法同 t45-status-layout-render.test.ts:`openApp(apps/teach-card, { viewport, initScript })` = 單獨的 vite dev server + 真的側車(跑在
 * fixture 的暫存複本上,今天釘 2026-09-10)+ headless Chrome。initScript 換掉 `window.fetch`(測試那一邊的事):
 *   - 記每個 `/__review` 請求的 method;能讓某個 method 回指定的錯誤(`inject`);能把 `teach.load` 的回應換成指定的數字(`loadOverride`);
 *   - 收 console 與 window 錯誤(`console`)。
 * 「視窗拿到焦點」= 對 window 送 `focus` 事件。「另一個視窗學了一張」= 測試直接對側車送 teach.next(不經過畫面),視窗的卡片不動。
 *
 * 提示的位置只認工單寫的(D2 甲、D3 乙):字樣「今天已學 N 張,明天約 M 張」,在 `.dock` 裡、`.status-slot` 底下、固定一行高;
 * 卡片畫面與「這個類別學完了」都有;載入中、出錯、類別清單不顯示。class 名稱不指定,用字樣找。
 *
 * 取捨:
 *   - 按鈕矩形用 t45 的量法(每顆主按鈕前後都在,x / y / 寬 / 高差 0);
 *   - 「最寬的數字」用 loadOverride 注入 1234 / 5678(四位數),量 360 寬還是一行、沒有橫向捲動;
 *   - 顏色:掃所有「選擇器對得到提示元素」的 CSS 規則,color / background / border 類屬性的值,拿掉 var(--hud-*) 之後不能剩下顏色字面(#hex、rgb()、hsl()、顏色名)。
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openApp, type GalleryPage } from '../../../packages/ui-shared/src/hud/render-test-support.js';
import { BUSY_MESSAGE, FINISHED_MESSAGE } from './teach-session.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const TEACH_DIR = join(import.meta.dirname, '..');
const WIDE = { width: 360, height: 480 } as const;
const SMALL = { width: 360, height: 400 } as const;
const HINT_SRC = String.raw`^今天已學 (\d+) 張,明天約 (\d+) 張$`;

const INIT_SCRIPT = `(() => {
  const orig = window.fetch.bind(window);
  const st = (window.__t67 = { methods: [], inject: {}, loadOverride: null, console: [] });
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const was = console[level].bind(console);
    console[level] = (...args) => { st.console.push(level + ': ' + args.map(String).join(' ')); was(...args); };
  }
  window.addEventListener('error', (e) => st.console.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => st.console.push('rejection: ' + String(e.reason)));
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('/__review')) return orig(input, init);
    const body = JSON.parse(init.body);
    st.methods.push(body.method);
    const queue = st.inject[body.method];
    if (queue && queue.length > 0) return json({ v: 1, id: body.id, ok: false, error: queue.shift() });
    if (body.method === 'teach.load' && st.loadOverride) return json({ v: 1, id: body.id, ok: true, result: st.loadOverride });
    return orig(input, init);
  };
})()`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const BUTTON_EXPR = `[...document.querySelectorAll('button')]`;
const BUTTON = (label: string): string => `[...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\\s+/g, '') === ${JSON.stringify(label)})`;

async function waitFor(page: GalleryPage, predicate: string, ms = 8000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate<boolean>(`Boolean(${predicate})`)) return true;
    await sleep(60);
  }
  return false;
}
const pageText = (page: GalleryPage): Promise<string> => page.evaluate<string>('document.body.innerText');
const methods = (page: GalleryPage): Promise<string[]> => page.evaluate<string[]>('window.__t67.methods.slice()');
const loadCalls = async (page: GalleryPage): Promise<number> => (await methods(page)).filter((m) => m === 'teach.load').length;

async function clickButton(page: GalleryPage, label: string): Promise<void> {
  const ok = await page.evaluate<boolean>(`(() => { const b = ${BUTTON(label)}; if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`畫面上找不到字是「${label}」的按鈕;畫面文字:${await pageText(page)}`);
}
async function inject(page: GalleryPage, method: string, error: { kind: string; message: string }): Promise<void> {
  await page.evaluate(`(() => { (window.__t67.inject[${JSON.stringify(method)}] ??= []).push(${JSON.stringify(error)}); return true; })()`);
}
/** 對側車直接送一個動作(不經過畫面);回 result */
async function direct(page: GalleryPage, method: string): Promise<Record<string, unknown>> {
  return page.evaluate<Record<string, unknown>>(`(async () => {
    const r = await fetch('/__review', { method: 'POST', body: JSON.stringify({ v: 1, id: 80000 + Math.floor(Math.random() * 9999), method: ${JSON.stringify(method)}, params: {} }) });
    return JSON.parse(await r.text());
  })()`);
}
const focus = (page: GalleryPage): Promise<boolean> => page.evaluate<boolean>(`(() => { window.dispatchEvent(new Event('focus')); return true; })()`);

interface Hint {
  count: number;
  text: string;
  learned: number;
  due: number;
  rect: [number, number, number, number];
  lines: number;
  fontSize: number;
  inDock: boolean;
  belowStatusSlot: boolean;
  lowestInDock: boolean;
  styleAttr: string | null;
}
const HINT = `(() => {
  const re = new RegExp(${JSON.stringify(HINT_SRC)});
  const all = [...document.querySelectorAll('body *')].filter((e) => re.test(e.textContent.trim()) && ![...e.children].some((c) => re.test(c.textContent.trim())));
  if (all.length === 0) return { count: 0 };
  const el = all[0];
  const m = re.exec(el.textContent.trim());
  const r = el.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(el);
  const tops = [];
  for (const q of range.getClientRects()) if (q.height > 0 && !tops.some((t) => Math.abs(t - q.top) < 2)) tops.push(q.top);
  const dock = el.closest('.dock');
  const slot = dock && dock.querySelector('.status-slot');
  let lowest = false;
  if (dock) {
    lowest = true;
    for (const other of dock.querySelectorAll('*')) {
      if (other === el || el.contains(other) || other.contains(el)) continue;
      const q = other.getBoundingClientRect();
      if (q.height > 0 && q.bottom > r.top + 0.5) lowest = false;
    }
  }
  return {
    count: all.length, text: el.textContent.trim(), learned: Number(m[1]), due: Number(m[2]),
    rect: [r.x, r.y, r.width, r.height], lines: tops.length, fontSize: parseFloat(getComputedStyle(el).fontSize),
    inDock: Boolean(dock), belowStatusSlot: Boolean(slot) && r.top >= slot.getBoundingClientRect().bottom - 0.5, lowestInDock: lowest,
    styleAttr: el.getAttribute('style'),
  };
})()`;
const hint = (page: GalleryPage): Promise<Hint> => page.evaluate<Hint>(HINT);

interface Snapshot { rects: Record<string, [number, number, number, number]>; scrollTop: number; title: string }
const SNAPSHOT = `(() => {
  const rects = {};
  for (const b of document.querySelectorAll('button')) {
    const label = b.textContent.replace(/\\s+/g, '');
    if (label === '取消') continue;
    const r = b.getBoundingClientRect();
    rects[label] = [r.x, r.y, r.width, r.height];
  }
  return { rects, scrollTop: document.querySelector('.hud-body').scrollTop, title: document.querySelector('h2')?.textContent.trim() ?? '' };
})()`;
const snapshot = (page: GalleryPage): Promise<Snapshot> => page.evaluate<Snapshot>(SNAPSHOT);
const MAIN = ['下一個', '換類別', '深入這個'] as const;
function moved(before: Snapshot, after: Snapshot): string[] {
  const problems: string[] = [];
  for (const label of MAIN) if (!before.rects[label] || !after.rects[label]) problems.push(`「${label}」前後要都在畫面上`);
  for (const [label, was] of Object.entries(before.rects)) {
    const now = after.rects[label];
    if (!now) continue;
    if (was.some((v, i) => Math.abs(v - now[i]!) > 0.01)) problems.push(`「${label}」動了:前 [${was.map((v) => v.toFixed(2)).join(', ')}] 後 [${now.map((v) => v.toFixed(2)).join(', ')}]`);
  }
  if (Math.abs(before.scrollTop - after.scrollTop) > 0.01) problems.push(`捲動位置變了:${before.scrollTop} → ${after.scrollTop}`);
  return problems;
}

async function prepare(page: GalleryPage): Promise<void> {
  await page.reset();
  expect(await waitFor(page, `document.querySelector('.hud-body') && document.querySelector('.markers') && ${BUTTON('深入這個')}`, 10_000), `卡片要載好;畫面文字:${await pageText(page)}`).toBe(true);
  expect(await waitFor(page, `(${HINT}).count === 1`, 6000), `卡片畫面要有一個提示(「今天已學 N 張,明天約 M 張」);畫面文字:${await pageText(page)}`).toBe(true);
  await sleep(200);
}

describe('T67 今日負擔提示(360 × 480)', () => {
  let page: GalleryPage;
  beforeAll(async () => {
    page = await openApp(TEACH_DIR, { viewport: WIDE, ready: '.markers', initScript: INIT_SCRIPT });
  });
  afterAll(async () => {
    await page?.close();
  });

  it('卡片畫面:剛好一個提示,字樣是「今天已學 N 張,明天約 M 張」,在 .dock 裡、.status-slot 底下、是黏底塊最下面的一行,而且只有一行', async () => {
    await prepare(page);
    const h = await hint(page);
    expect(h.count).toBe(1);
    expect(h.text).toMatch(/^今天已學 \d+ 張,明天約 \d+ 張$/);
    expect(h.inDock, '提示要在 .dock 裡').toBe(true);
    expect(h.belowStatusSlot, '提示要在 .status-slot 底下').toBe(true);
    expect(h.lowestInDock, '提示是黏底塊最下面的一行(沒有別的東西比它低)').toBe(true);
    expect(h.lines, '一行').toBe(1);
    expect(h.rect[2], '有寬度').toBeGreaterThan(0);
    expect(h.rect[1] + h.rect[3], '整行在畫面裡').toBeLessThanOrEqual(WIDE.height + 0.5);
    expect(h.rect[0] + h.rect[2], '整行在畫面寬度裡').toBeLessThanOrEqual(WIDE.width + 0.5);
  });

  it('數字:一開始 0 張;明天約幾張 = 側車 teach.load 回的數(畫面不自己算)', async () => {
    await prepare(page);
    const h = await hint(page);
    const loaded = (await direct(page, 'teach.load')) as { result?: { learnedToday: number; dueTomorrow: number } };
    expect(loaded.result).toBeDefined();
    expect(h.learned).toBe(0);
    expect(h.learned).toBe(loaded.result!.learnedToday);
    expect(h.due).toBe(loaded.result!.dueTomorrow);
  });

  it('另一個視窗學了一張、這個視窗拿到焦點:送一次 teach.load,數字更新;卡片、按鈕矩形、捲動位置都不動(差 0)', async () => {
    await prepare(page);
    const before = await snapshot(page);
    const hintBefore = await hint(page);
    const callsBefore = await loadCalls(page);
    const learned = (await direct(page, 'teach.next')) as { ok?: boolean };
    expect(learned.ok, '佈置:側車的 teach.next 成功').toBe(true);
    const callsMid = await loadCalls(page);
    await focus(page);
    expect(await waitFor(page, `(${HINT}).learned === ${hintBefore.learned + 1}`, 6000), `焦點之後學過的數字要加 1;畫面文字:${await pageText(page)}`).toBe(true);
    const after = await snapshot(page);
    expect(await loadCalls(page) - callsMid, '一次焦點 = 剛好一次 teach.load').toBe(1);
    expect(callsMid, '佈置沒有偷偷多叫').toBe(callsBefore);
    expect(after.title, '畫面那張卡沒變').toBe(before.title);
    expect(moved(before, after)).toEqual([]);
    const loaded = (await direct(page, 'teach.load')) as { result: { learnedToday: number; dueTomorrow: number } };
    const h = await hint(page);
    expect(h.learned).toBe(loaded.result.learnedToday);
    expect(h.due).toBe(loaded.result.dueTomorrow);
  });

  it('每次焦點各送一次:三次焦點 = 三次 teach.load', async () => {
    await prepare(page);
    const base = await loadCalls(page);
    for (let i = 1; i <= 3; i += 1) {
      await focus(page);
      expect(await waitFor(page, `window.__t67.methods.filter((m) => m === 'teach.load').length === ${base + i}`, 6000), `第 ${i} 次焦點要送 teach.load`).toBe(true);
    }
    expect(await loadCalls(page)).toBe(base + 3);
  });

  it('按「下一個」(畫面自己的動作):數字用那次回應的,不另外多叫 teach.load', async () => {
    await prepare(page);
    const base = await loadCalls(page);
    const h0 = await hint(page);
    await clickButton(page, '下一個');
    expect(await waitFor(page, `(${HINT}).learned === ${h0.learned + 1}`, 6000), `按下一個之後學過的數字要加 1;畫面文字:${await pageText(page)}`).toBe(true);
    expect(await loadCalls(page), '按按鈕不需要再叫 teach.load').toBe(base);
  });

  it('焦點時側車出錯或忙:安靜保留舊數字;沒有錯誤畫面、沒有「稍等一下」、按鈕沒被停用、矩形不動', async () => {
    await prepare(page);
    const before = await snapshot(page);
    const h0 = await hint(page);
    for (const kind of ['internal', 'busy', 'bad-request']) {
      await inject(page, 'teach.load', { kind, message: `測試注入 ${kind}` });
      const calls = await loadCalls(page);
      await focus(page);
      expect(await waitFor(page, `window.__t67.methods.filter((m) => m === 'teach.load').length === ${calls + 1}`, 6000), `${kind}:要真的送出`).toBe(true);
      await sleep(300);
      const text = await pageText(page);
      expect(text, `${kind}:不出現錯誤畫面的字樣`).not.toContain('再試一次');
      expect(text, `${kind}:不出現忙碌字樣`).not.toContain(BUSY_MESSAGE);
      expect(text, `${kind}:不出現測試注入的錯誤原文`).not.toContain('測試注入');
      const h = await hint(page);
      expect(h.text, `${kind}:數字照舊`).toBe(h0.text);
      expect(await page.evaluate<number>(`[...document.querySelectorAll('button')].filter((b) => b.disabled).length`), `${kind}:按鈕沒被停用`).toBe(0);
    }
    expect(moved(before, await snapshot(page))).toEqual([]);
  });

  it('數字變得很寬(1234 / 5678):還是一行、沒有橫向捲動、按鈕矩形差 0', async () => {
    await prepare(page);
    const before = await snapshot(page);
    await page.evaluate(`(window.__t67.loadOverride = { learnedToday: 1234, dueTomorrow: 5678 })`);
    const calls = await loadCalls(page);
    await focus(page);
    expect(await waitFor(page, `(${HINT}).learned === 1234`, 6000), `要顯示 1234;畫面文字:${await pageText(page)}`).toBe(true);
    expect(await loadCalls(page)).toBe(calls + 1);
    const h = await hint(page);
    expect(h.text).toBe('今天已學 1234 張,明天約 5678 張');
    expect(h.lines, '四位數也是一行').toBe(1);
    const overflow = await page.evaluate<{ body: number; doc: number }>(`(() => { const b = document.querySelector('.hud-body'); return { body: b.scrollWidth - b.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()`);
    expect(overflow.body, '.hud-body 沒有橫向捲動').toBeLessThanOrEqual(0.5);
    expect(overflow.doc, '整頁沒有橫向捲動').toBeLessThanOrEqual(0.5);
    expect(moved(before, await snapshot(page))).toEqual([]);
    await page.evaluate(`(window.__t67.loadOverride = null)`);
  });

  it('樣式:不用 style 屬性;顏色只用 var(--hud-*)(掃對得到這個元素的 CSS 規則)', async () => {
    await prepare(page);
    const h = await hint(page);
    expect(h.styleAttr, '提示元素不能有 style 屬性').toBeNull();
    const problems = await page.evaluate<string[]>(`(() => {
      const re = new RegExp(${JSON.stringify(HINT_SRC)});
      const el = [...document.querySelectorAll('body *')].filter((e) => re.test(e.textContent.trim()) && ![...e.children].some((c) => re.test(c.textContent.trim())))[0];
      const out = [];
      const COLOR_PROPS = ['color', 'background', 'background-color', 'border', 'border-top', 'border-top-color', 'border-bottom', 'border-bottom-color', 'border-left', 'border-left-color', 'border-color', 'outline', 'outline-color', 'box-shadow', 'text-decoration-color'];
      const LITERAL = /#[0-9a-fA-F]{3,8}\\b|\\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\\(|\\b(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|brown|cyan|magenta|navy|teal|maroon|olive|lime|aqua|fuchsia)\\b/i;
      const visit = (rules) => {
        for (const rule of rules) {
          if (rule.cssRules && !rule.selectorText) visit(rule.cssRules);
          if (!rule.selectorText || !rule.style) continue;
          let hit = false;
          try { hit = el.matches(rule.selectorText); } catch { hit = false; }
          if (!hit) continue;
          for (const prop of COLOR_PROPS) {
            const value = rule.style.getPropertyValue(prop);
            if (!value) continue;
            const rest = value.replace(/var\\(--hud-[a-z0-9-]+(?:\\s*,[^)]*)?\\)/g, '');
            if (LITERAL.test(rest)) out.push(rule.selectorText + ' { ' + prop + ': ' + value + ' }');
          }
        }
      };
      for (const sheet of document.styleSheets) { try { visit(sheet.cssRules); } catch {} }
      return out;
    })()`);
    expect(problems, '顏色字面').toEqual([]);
  });

  it('縮放內容(Ctrl + = 三級):提示在縮放層外,字級、高度、一行都不變,仍在 .dock 最下面,沒蓋到按鈕', async () => {
    await prepare(page);
    const h0 = await hint(page);
    for (let i = 0; i < 3; i += 1) {
      await page.evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Equal', key: '=', ctrlKey: true, bubbles: true, cancelable: true })); return true; })()`);
      await sleep(150);
      const h = await hint(page);
      expect(h.count).toBe(1);
      expect(h.fontSize, `縮放第 ${i + 1} 級:字級不變`).toBeCloseTo(h0.fontSize, 2);
      expect(h.rect[3], `縮放第 ${i + 1} 級:高度不變`).toBeCloseTo(h0.rect[3], 1);
      expect(h.lines).toBe(1);
      expect(h.lowestInDock).toBe(true);
      const bottoms = await page.evaluate<number>(`Math.max(...[...document.querySelectorAll('.dock button')].map((b) => b.getBoundingClientRect().bottom))`);
      expect(h.rect[1], `縮放第 ${i + 1} 級:沒蓋到按鈕`).toBeGreaterThanOrEqual(bottoms - 0.5);
    }
    await page.evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit0', key: '0', ctrlKey: true, bubbles: true, cancelable: true })); return true; })()`);
  });

  it('類別清單(換類別)不顯示提示;取消回來又有', async () => {
    await prepare(page);
    await clickButton(page, '換類別');
    expect(await waitFor(page, `document.querySelector('.list')`, 4000)).toBe(true);
    expect((await hint(page)).count, '清單畫面沒有提示').toBe(0);
    await clickButton(page, '取消');
    expect(await waitFor(page, `(${HINT}).count === 1`, 4000), '回到卡片之後提示回來').toBe(true);
  });

  it('出錯畫面不顯示提示', async () => {
    await prepare(page);
    await inject(page, 'teach.next', { kind: 'internal', message: '測試注入' });
    await clickButton(page, '下一個');
    expect(await waitFor(page, `document.querySelector('.error')`, 6000), `要進錯誤畫面;畫面文字:${await pageText(page)}`).toBe(true);
    expect((await hint(page)).count).toBe(0);
  });

  it('「這個類別學完了」的畫面也有提示:在「換類別」按鈕下面,數字是學過的張數', async () => {
    await prepare(page);
    for (let i = 0; i < 6; i += 1) {
      if (await page.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(FINISHED_MESSAGE)})`)) break;
      await clickButton(page, '下一個');
      await sleep(250);
    }
    expect(await waitFor(page, `document.body.innerText.includes(${JSON.stringify(FINISHED_MESSAGE)})`, 6000), `要走到學完;畫面文字:${await pageText(page)}`).toBe(true);
    expect(await waitFor(page, `(${HINT}).count === 1`, 4000), `學完的畫面要有提示;畫面文字:${await pageText(page)}`).toBe(true);
    const h = await hint(page);
    expect(h.lines).toBe(1);
    const button = await page.evaluate<number>(`${BUTTON('換類別')}.getBoundingClientRect().bottom`);
    expect(h.rect[1], '提示在「換類別」下面').toBeGreaterThanOrEqual(button - 0.5);
    const learned = (await direct(page, 'teach.load')) as { result: { learnedToday: number } };
    expect(h.learned).toBe(learned.result.learnedToday);
    expect(h.learned).toBeGreaterThanOrEqual(3);
  });

  it('console 一則都沒有(整段下來)', async () => {
    // vite dev server 自己的 HMR 連線訊息(`[vite] connecting...`、`[vite] connected.`)不是 App 的,不算
    const logs = (await page.evaluate<string[]>('window.__t67.console.slice()')).filter((l) => !l.includes('[vite]'));
    expect(logs).toEqual([]);
  });
});

describe('T67 今日負擔提示(最小視窗 360 × 400)', () => {
  let page: GalleryPage;
  beforeAll(async () => {
    page = await openApp(TEACH_DIR, { viewport: SMALL, ready: '.markers', initScript: INIT_SCRIPT });
  });
  afterAll(async () => {
    await page?.close();
  });

  it('捲動位置在最上面與最下面,提示都整行在畫面裡(黏底)、沒有橫向捲動、按鈕沒被它擠出去', async () => {
    await prepare(page);
    for (const where of ['top', 'bottom']) {
      await page.evaluate(`(() => { const b = document.querySelector('.hud-body'); b.scrollTop = ${where === 'top' ? '0' : 'b.scrollHeight'}; return true; })()`);
      await sleep(200);
      const h = await hint(page);
      expect(h.count, where).toBe(1);
      expect(h.rect[1] + h.rect[3], `${where}:提示下緣在畫面裡`).toBeLessThanOrEqual(SMALL.height + 0.5);
      expect(h.rect[0] + h.rect[2], `${where}:提示右緣在畫面裡`).toBeLessThanOrEqual(SMALL.width + 0.5);
      expect(h.lines, where).toBe(1);
      const buttons = await page.evaluate<boolean>(`['下一個', '換類別', '深入這個'].every((label) => { const b = ${BUTTON_EXPR}.find((x) => x.textContent.replace(/\\s+/g, '') === label); if (!b) return false; const r = b.getBoundingClientRect(); return r.bottom <= window.innerHeight + 0.5 && r.top >= 0; })`);
      expect(buttons, `${where}:三顆主按鈕都在畫面裡`).toBe(true);
      const overflow = await page.evaluate<number>(`(() => { const b = document.querySelector('.hud-body'); return b.scrollWidth - b.clientWidth; })()`);
      expect(overflow).toBeLessThanOrEqual(0.5);
    }
  });
});
