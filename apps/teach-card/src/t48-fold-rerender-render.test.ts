/**
 * T48(同一張卡不重畫例子、放大跟著視窗重算;T46 `@manual` 的 F1、L2、F2)渲染測試 f、g、h。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T48-teach-card-fold-rerender-fix.md 「驗收條件 1」的渲染測試。靜態測試 i 在 t48-app-compile-static.test.ts。
 *
 * 真的把 `App.svelte` 畫出來:`openApp(apps/teach-card, { viewport: 360 × 480, initScript })` + 真的側車 + headless Chrome;
 * 按標題、按圖用真指標(連同一個 Chrome 的第二條 CDP,Input.dispatchMouseEvent / dispatchKeyEvent);按「深入這個」「取消」用 DOM click
 * (同 T45:不讓「捲到頂」那一組為了點到按鈕被 scrollIntoView 改掉捲動位置)。量的都是畫面,不看原始碼字串。
 *
 * 頁面腳本(`initScript`,測試那一邊的事,產品程式不為它改):
 *   - 換 `/__card` 的內文(`localStorage['t48.body']`);`mutate` 為真時,之後每一次 `/__card` 的內文都把「T48-BODY」換成「T48-CHANGED」(同一個 path、內容變了,而且之後不再變);
 *     session 只在側車回「帶卡片的畫面」時重讀卡片檔(輪詢拿到不是生成中的畫面,例如取消之後),所以換內容的時機是「取消」放行輪詢那一下;

 *   - `levelPatch`:為真時,不是 sec-0001 的卡,frontmatter 的 level 由 0 改成 3(讓兩張卡的標記不同);
 *   - `rewrite`:把某個 method 的回應裡 `card.path` 改成別的目錄(`/__card` 對那個 path 回同樣的內文),用來造「內文一樣、目錄不同」的兩張卡;
 *   - 記錄 `/__review` 的 method、能「扣住」`teach.poll`(`hold`)、放行時能改回錯誤(`holdError`)、能讓某個 method 回指定錯誤(`inject`);
 *   - 每幀取樣(`requestAnimationFrame` + `MutationObserver`):每個例子的開或收、每個 `details` 的記號(`data-t48`:節點被換掉記號就沒了)、
 *     三顆按鈕的矩形、`.hud-body` 的 scrollTop、生成中那一行與「取消」是否整塊在看得到的範圍裡。
 *
 * 對應工單 must_catch:
 *   f 同一張卡手動收放之後深入(三種情況 × 捲到頂 / 捲到底):每一幀其他例子不變、details 同一顆、按鈕 0 px、scrollTop 不變、生成中那一行看得到、缺圖請求不增加、storage 不被改;
 *   g 放大的大小:高圖整張看得到(本來就綠)、裝得進視窗的圖不比卡片裡小(T46 已有,這裡不退步)、放大時 resize(480,600) 重算、改回復原、字樣字級不大於例子的字(本來就綠);
 *   h 同一個 path、內容變了算換卡:html 重算、例子照 storage 畫;之後同一張新卡上的 pull 不再重算(基底上紅在這一段)。
 *
 * 「在 3a1913b 上紅」:f(別的例子被改、details 換顆、按鈕動、缺圖再要)、g 的 resize 兩條、h 的第二段。本來就綠(標出來):g 的高圖、裝得進視窗的圖、字樣字級。
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openApp, type GalleryPage } from '../../../packages/ui-shared/src/hud/render-test-support.js';
import { RealInput, newLearningRoot, writeImage } from './t48-test-support.js';

// 每條都真的起 vite、headless Chrome、側車:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const ROOT = join(import.meta.dirname, '../../..');
const TEACH_DIR = join(import.meta.dirname, '..');
const VIEWPORT = { width: 360, height: 480 } as const;
const PROTOCOL = pathToFileURL(join(ROOT, 'packages/core/src/session/protocol.ts')).href;

// ---------------------------------------------------------------- 卡片內容

const FILLER = Array.from({ length: 12 }, (_, i) => `- 內文補充的第 ${i + 1} 行,讓卡片比視窗長`).join('\n');
const LIST = (tag: string, n: number): string => Array.from({ length: n }, (_, i) => `- ${tag}-${i + 1}`).join('\n');

const BODIES = {
  /** f、h:三個例子,例子 2 裡有一張不存在的圖;只開例子 2 時卡片還是比視窗長(≥ 100 px 可捲) */
  three: [
    'T48-BODY 內文。',
    '',
    FILLER,
    '',
    '```example',
    '第一個:',
    '',
    LIST('T48-E1', 6),
    '```',
    '',
    '```example',
    '第二個:',
    '',
    LIST('T48-E2', 10),
    '',
    '![缺的](../../assets/t48-missing.png)',
    '```',
    '',
    '```example',
    '第三個:',
    '',
    LIST('T48-E3', 6),
    '```',
  ].join('\n'),
  /** 換卡的鍵要含 path:兩張內文一樣、目錄深度不同的卡,同一條相對路徑解析結果不同 */
  dirs: ['T48-BODY 同樣的內文。', '', '```example', '例子:', '', '![圖](../../assets/t48-ok.png)', '```'].join('\n'),
  /** g:裝得進視窗的圖(120×60) */
  ok: ['T48-ZOOM 小圖。', '', '```example', '例子:', '', '![小圖](../../assets/t48-ok.png)', '```'].join('\n'),
  /** g:比視窗高的圖(240×960) */
  tall: ['T48-ZOOM 高圖。', '', '```example', '例子:', '', '![高圖](../../assets/t48-tall.png)', '```'].join('\n'),
  /** g:找不到圖片的字樣字級 */
  missing: ['T48-ZOOM 缺圖。', '', '```example', '- 例子裡的字 T48-LI', '', '![缺的](../../assets/t48-missing.png)', '```'].join('\n'),
} as const;
type BodyKey = keyof typeof BODIES;

const IMAGES = {
  ok: { rel: 'assets/t48-ok.png', w: 120, h: 60, rgb: [200, 40, 40] as [number, number, number] },
  tall: { rel: 'assets/t48-tall.png', w: 240, h: 960, rgb: [40, 40, 200] as [number, number, number] },
};

// ---------------------------------------------------------------- 頁面腳本

const INIT_SCRIPT = `(() => {
  const orig = window.fetch.bind(window);
  const st = (window.__t48 = { methods: [], cardFetches: 0, mutate: false, levelPatch: false, rewrite: null, lastFm: '', cardPaths: [], hold: false, holdError: null, waiters: [], inject: {}, samples: [], armed: false });
  st.release = () => {
    st.hold = false;
    for (const wake of st.waiters.splice(0)) wake();
  };
  const errorResponse = (id, error) =>
    new Response(JSON.stringify({ v: 1, id, ok: false, error }), { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/__card')) {
      const wanted = new URL(url, location.href).searchParams.get('path') || '';
      st.cardPaths.push(wanted);
      if (wanted.includes('/nested/')) {
        // 被改寫成不同目錄的那張卡:檔案不存在,用上一張的 frontmatter 與同樣的內文
        let nestedBody = '';
        try { nestedBody = localStorage.getItem('t48.body') || ''; } catch { nestedBody = ''; }
        return new Response(st.lastFm + nestedBody, { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      const res = await orig(input, init);
      const text = await res.text();
      st.cardFetches += 1;
      let body = '';
      try { body = localStorage.getItem('t48.body') || ''; } catch { body = ''; }
      if (!body) return new Response(text, { status: res.status, headers: { 'content-type': 'text/plain' } });
      if (st.mutate) body = body.replace('T48-BODY', 'T48-CHANGED');
      const fm = /^---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n?/.exec(text);
      // levelPatch:不是 sec-0001 的卡,等級標記改成 3(固定測資的卡等級都是 0、類別都是 security,只有標題不同;標記要能分出兩張卡)
      let head = fm ? fm[0] : '';
      if (st.levelPatch && head && !/^id: sec-0001$/m.test(head)) head = head.replace(/^level: 0$/m, 'level: 3');
      if (fm) st.lastFm = head;
      return new Response(head + body, { status: 200, headers: { 'content-type': 'text/plain' } });
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
    if (st.rewrite && req.method === st.rewrite.method) {
      // 側車回的畫面,把卡片的 path 改成別的目錄(同一個內文)
      const res = await orig(input, init);
      const reply = await res.json();
      if (reply.ok && reply.result && reply.result.card) {
        reply.result.card = { ...reply.result.card, path: st.rewrite.to };
        st.rewrite = null;
      }
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return orig(input, init);
  };

  const label = (b) => b.textContent.replace(/\\s+/g, '');
  st.mark = () => { document.querySelectorAll('.lc-example').forEach((d, i) => d.setAttribute('data-t48', String(i))); return document.querySelectorAll('.lc-example').length; };
  const frame = (kind) => {
    const hb = document.querySelector('.hud-body');
    if (!hb || st.samples.length >= 30000) return;
    const exs = [...document.querySelectorAll('.lc-example')];
    const b = hb.getBoundingClientRect();
    const top = b.top + hb.clientTop, bottom = top + hb.clientHeight;
    const rects = {};
    for (const x of document.querySelectorAll('button')) {
      const l = label(x);
      if (l === '取消') continue;
      const r = x.getBoundingClientRect();
      rects[l] = [r.x, r.y, r.width, r.height];
    }
    const inside = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.top >= top - 0.5 && r.bottom <= bottom + 0.5; };
    const gen = document.querySelector('.generating');
    const cancel = [...document.querySelectorAll('button')].find((x) => label(x) === '取消');
    st.samples.push({
      kind, t: performance.now(),
      open: exs.map((d) => d.open),
      ids: exs.map((d) => d.getAttribute('data-t48')),
      rects, scrollTop: hb.scrollTop,
      genInside: gen ? inside(gen) : null,
      cancelInside: cancel ? inside(cancel) : null,
    });
  };
  const loop = () => { if (st.armed) frame('frame'); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  new MutationObserver(() => { if (st.armed) frame('mutation'); }).observe(document, { childList: true, subtree: true, attributes: true });
  st.frame = () => frame('manual');
})()`;

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
const methods = (page: GalleryPage): Promise<string[]> => page.evaluate<string[]>('window.__t48.methods.slice()');

async function quiesce(page: GalleryPage): Promise<void> {
  await page.evaluate(`(async () => {
    window.__t48.armed = false;
    window.__t48.holdError = null;
    window.__t48.release();
    const res = await fetch('/__review', { method: 'POST', body: JSON.stringify({ v: 1, id: 90001, method: 'teach.cancel', params: {} }) });
    await res.text();
    return true;
  })()`);
}

interface App { page: GalleryPage; input: RealInput; learningDir: string }

async function start(): Promise<App> {
  const before = new Set(readdirSync(tmpdir()));
  const page = await openApp(TEACH_DIR, { viewport: VIEWPORT, ready: '.markers', initScript: INIT_SCRIPT });
  const learningDir = newLearningRoot(before);
  for (const img of Object.values(IMAGES)) writeImage(learningDir, img.rel, img.w, img.h, img.rgb);
  const input = await RealInput.attach(page.url);
  return { page, input, learningDir };
}

async function stop(app: App | undefined): Promise<void> {
  app?.input.close();
  await app?.page.close();
}

/** 一條測試的開頭:學過紀錄清空、換上這條要的內文、清掉 localStorage、整頁重新載入 */
async function prepare(app: App, body: BodyKey, opts: { keepStorage?: boolean } = {}): Promise<void> {
  writeFileSync(join(app.learningDir, 'state/reviews.json'), '{}\n');
  await app.page.evaluate(`(() => { try { ${opts.keepStorage ? '' : 'localStorage.clear();'} localStorage.setItem('t48.body', ${JSON.stringify(BODIES[body])}); } catch {} return true; })()`);
  await app.page.reset();
  expect(await waitFor(app.page, `document.querySelector('.hud-body') && document.querySelector('.markers') && document.querySelector('.lc-example') && ${BUTTON('深入這個')}`, 12_000), `卡片與例子要畫出來;畫面文字:${await pageText(app.page)}`).toBe(true);
  await sleep(300);
}

async function clickCentre(app: App, x: number, y: number): Promise<void> {
  await app.input.click(x, y);
  await sleep(200);
}

/** 第 index 個例子的標題(summary)用真指標按一下;先捲進看得到的範圍 */
async function clickHeading(app: App, index: number): Promise<void> {
  const at = await app.page.evaluate<{ x: number; y: number } | null>(`(() => {
    const s = document.querySelectorAll('.lc-example summary')[${index}];
    if (!s) return null;
    s.scrollIntoView({ block: 'nearest' });
    const r = s.getBoundingClientRect();
    return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 };
  })()`);
  if (!at) throw new Error(`找不到第 ${index + 1} 個例子的標題;畫面文字:${await pageText(app.page)}`);
  await clickCentre(app, at.x, at.y);
}

const opens = (page: GalleryPage): Promise<boolean[]> => page.evaluate<boolean[]>(`[...document.querySelectorAll('.lc-example')].map((d) => d.open)`);
const storageSnapshot = (page: GalleryPage): Promise<Record<string, string>> =>
  page.evaluate<Record<string, string>>(`(() => { const out = {}; for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); if (!k.startsWith('t48.')) out[k] = localStorage.getItem(k); } return out; })()`);
const missingRequests = (page: GalleryPage): Promise<number> =>
  page.evaluate<number>(`performance.getEntriesByType('resource').filter((e) => e.name.includes('t48-missing') || decodeURIComponent(e.name).includes('t48-missing')).length`);

/**
 * 手動收放,停在「畫面 010」:
 *   情況 1、3:收掉三個、重新載入(進卡時 storage 是收,畫面 000),再手動只開例子 2(storage 變開);
 *   情況 2:進卡時 storage 是開(預設,三個都開),收例子 1、再收例子 3(storage 變收,最後按的是「收」)。
 * 情況 2 不照工單例子的序列(進卡 storage 收 → 開 1、2 → 收 1):那個序列進卡時與按完之後 storage 都是收,
 * html 字串本來就一樣,基底上也不會重畫,抓不到 F1。T46 `@manual` 的重現是「進卡時 storage 是開,最後按的是收」,這裡照它。
 */
async function reachManualState(app: App, kind: 1 | 2 | 3): Promise<{ storage: Record<string, string> }> {
  await prepare(app, 'three');
  expect(await opens(app.page), '前提:預設三個都展開').toEqual([true, true, true]);
  if (kind === 2) {
    await clickHeading(app, 0);
    await clickHeading(app, 2);
  } else {
    for (const i of [0, 1, 2]) await clickHeading(app, i);
    expect(await opens(app.page), '前提:三個都收起來了').toEqual([false, false, false]);
    await prepare(app, 'three', { keepStorage: true });
    expect(await opens(app.page), '前提:進卡時 storage 是收,三個都收').toEqual([false, false, false]);
    await clickHeading(app, 1);
  }
  expect(await opens(app.page), `前提:畫面是 010(情況 ${kind})`).toEqual([false, true, false]);
  return { storage: await storageSnapshot(app.page) };
}

interface Sample {
  kind: string;
  t: number;
  open: boolean[];
  ids: (string | null)[];
  rects: Record<string, number[]>;
  scrollTop: number;
  genInside: boolean | null;
  cancelInside: boolean | null;
}
const samples = (page: GalleryPage): Promise<Sample[]> => page.evaluate<Sample[]>('window.__t48.samples.slice()');

// ================================================================ G1:同一張卡手動收放之後深入(f)與同一個 path 內容變了(h)

describe('T48 渲染:同一張卡不重畫例子(f)與同一個 path 內容變了算換卡(h)', () => {
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

  async function scrollTo(where: 'top' | 'bottom'): Promise<number> {
    await a().page.evaluate(`(() => { const b = document.querySelector('.hud-body'); b.scrollTop = ${JSON.stringify(where)} === 'top' ? 0 : b.scrollHeight; return true; })()`);
    await sleep(250);
    const m = await a().page.evaluate<{ top: number; max: number }>(`(() => { const b = document.querySelector('.hud-body'); return { top: b.scrollTop, max: b.scrollHeight - b.clientHeight }; })()`);
    expect(m.max, `前提:卡比視窗長,可捲 ≥ 100 px(畫面 010 時 scrollHeight - clientHeight = ${m.max})`).toBeGreaterThanOrEqual(100);
    if (where === 'bottom') expect(m.top, '前提:真的捲到底').toBeGreaterThan(m.max - 1.5);
    return m.top;
  }

  async function holdGenerating(): Promise<void> {
    await a().page.evaluate('(window.__t48.hold = true)');
    const ok0 = await a().page.evaluate<boolean>(`(() => { const b = ${BUTTON('深入這個')}; if (!b) return false; b.click(); return true; })()`);
    if (!ok0) throw new Error(`找不到「深入這個」;畫面文字:${await pageText(a().page)}`);
    const ok = await waitFor(a().page, 'window.__t48.waiters.length > 0 && document.querySelector(".generating")', 10_000);
    if (!ok) throw new Error(`沒有進到生成中;已送的請求:${(await methods(a().page)).join(',')};畫面文字:${await pageText(a().page)}`);
  }

  async function runDeepen(kind: 1 | 2 | 3): Promise<void> {
    await holdGenerating();
    await sleep(400);
    if (kind === 3) {
      const { ERROR_MESSAGES } = (await import(/* @vite-ignore */ PROTOCOL)) as { ERROR_MESSAGES: Record<string, string> };
      const message = ERROR_MESSAGES['deepen-failed']!;
      await a().page.evaluate(`(window.__t48.holdError = ${JSON.stringify({ kind: 'deepen-failed', message })})`);
      await a().page.evaluate('window.__t48.release()');
      expect(await waitFor(a().page, `(document.querySelector('.deepen-error')?.textContent ?? '').trim() === ${JSON.stringify(message)}`, 10_000), `輪詢拿到深入錯誤之後要出現錯誤字樣;畫面文字:${await pageText(a().page)}`).toBe(true);
    } else {
      await a().page.evaluate(`(() => { const b = ${BUTTON('取消')}; if (b) b.click(); window.__t48.release(); return true; })()`);
      expect(await waitFor(a().page, `!document.querySelector('.generating') && !document.querySelector('.deepen-error')`, 10_000), '取消之後生成中那一行要收掉').toBe(true);
    }
    await sleep(1000);
  }

  const LABEL: Record<number, string> = {
    1: '進卡 storage 收、手動只開例子 2(畫面 010、storage 開)→ 深入 → 生成中 → 取消',
    2: '進卡 storage 開、收例子 1 再收例子 3(畫面 010、storage 收,最後按的是收)→ 深入 → 生成中 → 取消',
    3: '同情況 1,但生成中之後是深入出錯',
  };

  for (const kind of [1, 2, 3] as const) {
    for (const where of ['top', 'bottom'] as const) {
      it(`f. 情況 ${kind}(${LABEL[kind]}),捲到${where === 'top' ? '頂' : '底'}:每一幀其他例子不變、details 同一顆、按鈕 0 px、scrollTop 不變${where === 'bottom' ? '、生成中那一行與「取消」看得到' : ''}、缺圖不再要、storage 不被改`, async () => {
        const { storage } = await reachManualState(a(), kind);
        await scrollTo(where);
        expect(await a().page.evaluate<number>('window.__t48.mark()'), '前提:三個例子都做了記號').toBe(3);
        const requestsBefore = await missingRequests(a().page);
        await a().page.evaluate('(() => { window.__t48.samples.length = 0; window.__t48.armed = true; window.__t48.frame(); return true; })()');
        await sleep(120);
        const first = (await samples(a().page))[0]!;
        expect(first.open, '前提:第一幀是 010').toEqual([false, true, false]);
        expect(Object.keys(first.rects).sort(), '前提:三顆按鈕都量得到').toEqual(['下一個', '換類別', '深入這個'].sort());
        await runDeepen(kind);
        await a().page.evaluate('(window.__t48.armed = false)');
        const all = await samples(a().page);
        expect(all.length, '要取樣到每一幀(≥ 30)').toBeGreaterThan(30);

        const problems: string[] = [];
        const note = (s: Sample, text: string): void => {
          if (problems.length < 8) problems.push(`t=${(s.t - first.t).toFixed(0)}ms(${s.kind}):${text}`);
        };
        let genSeen = 0;
        for (const s of all) {
          if (s.open.length !== 3 || s.open.some((o, i) => o !== first.open[i])) note(s, `例子的開或收變了:${JSON.stringify(first.open)} → ${JSON.stringify(s.open)}`);
          if (s.ids.length !== 3 || s.ids.some((id, i) => id !== String(i))) note(s, `details 不是同一顆(記號 ${JSON.stringify(s.ids)};節點被換掉了)`);
          for (const label of ['下一個', '換類別', '深入這個']) {
            const was = first.rects[label]!;
            const now = s.rects[label];
            if (!now) note(s, `「${label}」不在畫面上`);
            else if (was.some((v, i) => Math.abs(v - now[i]!) > 0.01)) note(s, `「${label}」動了:前 [${was.map((v) => v.toFixed(2))}] 後 [${now.map((v) => v.toFixed(2))}]`);
          }
          if (Math.abs(s.scrollTop - first.scrollTop) > 0.01) note(s, `scrollTop 變了:前 ${first.scrollTop.toFixed(2)} 後 ${s.scrollTop.toFixed(2)}`);
          if (s.genInside !== null) {
            genSeen += 1;
            if (where === 'bottom' && s.genInside === false) note(s, '生成中那一行不在看得到的範圍裡');
          }
          if (where === 'bottom' && s.cancelInside === false) note(s, '「取消」不在看得到的範圍裡');
        }
        expect(problems, `每一幀:${LABEL[kind]},捲到${where}`).toEqual([]);
        if (kind !== 3) expect(genSeen, '前提:取樣到生成中那一行').toBeGreaterThan(3);
        expect(await opens(a().page), '最後的畫面還是 010').toEqual([false, true, false]);
        expect(await missingRequests(a().page), '不存在那張圖的請求數不能增加').toBe(requestsBefore);
        expect(await storageSnapshot(a().page), 'localStorage(折疊狀態)不被這些動作改掉').toEqual(storage);
      });
    }
  }

  it('換卡的鍵要含 path:兩張內文一樣、目錄深度不同的卡,換過去之後圖片路徑照新目錄重算(同一條 ../../assets/x.png 在新目錄不在最上層 assets,要變成「圖片路徑不能用」,不能沿用舊的 <img>)', async () => {
    await prepare(a(), 'dirs');
    expect(await waitFor(a().page, `document.querySelector('.lc-example img')`, 8000), `前提:第一張卡的圖要畫出來(卡在 cards/<分類>/,../../assets/ 就是最上層 assets);畫面文字:${await pageText(a().page)}`).toBe(true);
    expect(await pageText(a().page), '前提:第一張卡沒有拒絕字樣').not.toContain('圖片路徑不能用');
    const first = await a().page.evaluate<string>(`document.querySelector('.lc-example img').getAttribute('data-asset-path') || document.querySelector('.lc-example img').src`);
    await a().page.evaluate(`(window.__t48.rewrite = { method: 'teach.next', to: 'cards/security/nested/t48-nested.md' })`);
    await a().page.evaluate(`(() => { const b = ${BUTTON('下一個')}; if (!b) return false; b.click(); return true; })()`);
    expect(await waitFor(a().page, `window.__t48.cardPaths.some((p) => p.includes('/nested/'))`, 10_000), `「下一個」之後要讀新卡(cards/security/nested/t48-nested.md);已讀:${JSON.stringify(await a().page.evaluate<string[]>('window.__t48.cardPaths'))};畫面文字:${await pageText(a().page)}`).toBe(true);
    expect(await waitFor(a().page, `document.body.innerText.includes('圖片路徑不能用')`, 8000), `新卡在深一層的目錄,同一條 ../../assets/t48-ok.png 解析成 cards/assets/…,不在最上層 assets,要出現「圖片路徑不能用」(內文一樣但目錄不同,html 要重算,不能沿用舊卡的);第一張卡的圖:${first};畫面文字:${await pageText(a().page)}`).toBe(true);
    expect(await pageText(a().page)).toContain('圖片路徑不能用:../../assets/t48-ok.png');
    expect(await a().page.evaluate<number>(`document.querySelectorAll('.lc-example img').length`), '新卡的例子裡不能還留著舊卡的 <img>').toBe(0);
  });

  it('M22. 換到另一張 frontmatter 不同的卡(標題、等級標記不同),之後同一張卡上再 pull 一次(深入 → 取消):標題與標記留在新卡的,不退回上一張卡的', async () => {
    await prepare(a(), 'three');
    await a().page.evaluate('(window.__t48.levelPatch = true)');
    const marks = (): Promise<{ title: string; level: string; category: string }> =>
      a().page.evaluate<{ title: string; level: string; category: string }>(`(() => ({
        title: (document.querySelector('h2')?.textContent ?? '').trim(),
        level: (document.querySelector('.markers .level')?.textContent ?? '').trim(),
        category: (document.querySelector('.markers .category')?.textContent ?? '').trim(),
      }))()`);
    const cardA = await marks();
    expect(cardA.title, `前提:第一張卡有標題;畫面文字:${await pageText(a().page)}`).not.toBe('');
    expect(cardA.level, '前提:第一張卡(sec-0001)的等級標記是 Level 0').toBe('Level 0');
    await a().page.evaluate(`(() => { const b = ${BUTTON('下一個')}; if (!b) return false; b.click(); return true; })()`);
    expect(await waitFor(a().page, `(document.querySelector('.markers .level')?.textContent ?? '').trim() === 'Level 3'`, 10_000), `「下一個」之後要換成另一張卡(等級標記 Level 3);畫面文字:${await pageText(a().page)}`).toBe(true);
    await sleep(300);
    const cardB = await marks();
    expect(cardB.title, '前提:兩張卡的標題不同').not.toBe(cardA.title);
    // 同一張卡再 pull 一次:深入 → 取消(取消之後輪詢拿到帶卡片的畫面,session 重讀卡片檔,畫面重新 pull)
    await a().page.evaluate('(() => { window.__t48.samples.length = 0; return true; })()');
    await holdGenerating();
    await sleep(300);
    const during = await marks();
    await a().page.evaluate(`(() => { const b = ${BUTTON('取消')}; if (b) b.click(); window.__t48.release(); return true; })()`);
    expect(await waitFor(a().page, `!document.querySelector('.generating')`, 10_000), '取消之後生成中那一行要收掉').toBe(true);
    await sleep(1000);
    const after = await marks();
    expect(during, '生成中:標題、類別、等級標記還是新卡的').toEqual(cardB);
    expect(after, '取消之後(同一張卡再 pull):標題、類別、等級標記還是新卡的,不能變回上一張卡的').toEqual(cardB);
    expect(after.title, '標題不是上一張卡的').not.toBe(cardA.title);
    expect(after.level, '等級標記不是上一張卡的').not.toBe(cardA.level);
  });

  it('h. 同一個 path、內容變了算換卡:html 重算、例子照 storage 畫(開);之後同一張新卡上的 pull 不再重算(收放的結果留著)', async () => {
    await reachManualState(a(), 1);
    const cancelAndRelease = `(() => { const b = ${BUTTON('取消')}; if (b) b.click(); window.__t48.release(); return true; })()`;
    // 第一段:深入(生成中)→ 之後 /__card 的內容變了(同一個 path)→ 取消,輪詢拿到帶卡片的畫面,session 重讀卡片檔
    await holdGenerating();
    const fetchesBefore = await a().page.evaluate<number>('window.__t48.cardFetches');
    await a().page.evaluate('(window.__t48.mutate = true)');
    await a().page.evaluate(cancelAndRelease);
    expect(await waitFor(a().page, `document.body.innerText.includes('T48-CHANGED')`, 8000), `/__card 的內容變了(同一個 path),畫面要換成新內容;已要卡片 ${await a().page.evaluate<number>('window.__t48.cardFetches')} 次(之前 ${fetchesBefore});畫面文字:${await pageText(a().page)}`).toBe(true);
    expect(await a().page.evaluate<number>('window.__t48.cardFetches'), '取消之後 session 要重讀卡片檔').toBeGreaterThan(fetchesBefore);
    expect(await waitFor(a().page, `!document.querySelector('.generating')`, 8000), '取消之後生成中那一行要收掉').toBe(true);
    await sleep(300);
    expect(await opens(a().page), '內容變了算換卡:storage 是開,例子照 storage 畫成三個都開').toEqual([true, true, true]);
    // 第二段:新卡上手動收起例子 3(storage 變收),再深入、取消 → 又一次 pull 與重讀;內容沒再變,不能重算、不能重讀 storage
    expect(await a().page.evaluate<number>('window.__t48.mark()'), '前提:三個例子做了記號').toBe(3);
    await clickHeading(a(), 2);
    expect(await opens(a().page), '前提:手動收起例子 3').toEqual([true, true, false]);
    await a().page.evaluate('(() => { window.__t48.samples.length = 0; window.__t48.armed = true; window.__t48.frame(); return true; })()');
    const fetchesMid = await a().page.evaluate<number>('window.__t48.cardFetches');
    await holdGenerating();
    await sleep(300);
    await a().page.evaluate(cancelAndRelease);
    expect(await waitFor(a().page, `!document.querySelector('.generating')`, 10_000), '取消之後生成中那一行要收掉').toBe(true);
    await sleep(1000);
    await a().page.evaluate('(window.__t48.armed = false)');
    expect(await a().page.evaluate<number>('window.__t48.cardFetches'), '前提:第二次取消也重讀了卡片檔(內容一樣)').toBeGreaterThan(fetchesMid);
    const all = await samples(a().page);
    expect(all.length, '要取樣到每一幀').toBeGreaterThan(30);
    const bad = all.filter((s) => s.open.join() !== 'true,true,false' || s.ids.join() !== '0,1,2');
    expect(bad.slice(0, 3).map((s) => ({ open: s.open, ids: s.ids })), `內容沒變的 pull 不能重算:每一幀都要是 [開,開,收]、同一顆節點(共 ${bad.length} 幀不是)`).toEqual([]);
    expect(await opens(a().page)).toEqual([true, true, false]);
  });
});

// ================================================================ G2:放大的大小(g)

describe('T48 渲染:放大的大小(g)', () => {
  let app: App | undefined;
  beforeAll(async () => {
    app = await start();
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

  interface ImgFact { src: string; nw: number; nh: number; rect: { x: number; y: number; w: number; h: number }; orig: boolean }
  const imgFacts = (): Promise<ImgFact[]> =>
    a().page.evaluate<ImgFact[]>(`[...document.querySelectorAll('img')].map((i) => { const r = i.getBoundingClientRect(); return { src: i.currentSrc || i.src, nw: i.naturalWidth, nh: i.naturalHeight, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, orig: i.hasAttribute('data-t48-orig') }; })`);

  /** 放大層的根:放大的圖往上最高、而且不含原本那張圖的祖先 */
  const overlayRect = (): Promise<{ x: number; y: number; w: number; h: number } | null> =>
    a().page.evaluate(`(() => {
      const origImg = document.querySelector('img[data-t48-orig]');
      const big = [...document.querySelectorAll('img')].find((i) => !i.hasAttribute('data-t48-orig'));
      if (!big || !origImg) return null;
      let root = big;
      while (root.parentElement && !root.parentElement.contains(origImg)) root = root.parentElement;
      const r = root.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`);

  async function openZoom(body: 'ok' | 'tall'): Promise<{ orig: ImgFact; big: ImgFact }> {
    await prepare(a(), body);
    expect(await waitFor(a().page, `document.querySelector('.lc-example img') && document.querySelector('.lc-example img').complete && document.querySelector('.lc-example img').naturalWidth > 0`, 10_000), `例子裡的圖要載好;畫面文字:${await pageText(a().page)}`).toBe(true);
    await a().page.evaluate(`(() => { document.querySelectorAll('img').forEach((i) => i.setAttribute('data-t48-orig', '1')); return true; })()`);
    const at = await a().page.evaluate<{ x: number; y: number }>(`(() => {
      const img = document.querySelector('.lc-example img');
      img.scrollIntoView({ block: 'nearest' });
      const hb = document.querySelector('.hud-body').getBoundingClientRect();
      const r = img.getBoundingClientRect();
      const top = Math.max(r.top, hb.top), bottom = Math.min(r.bottom, hb.bottom);
      return { x: r.left + r.width / 2, y: (top + bottom) / 2 };
    })()`);
    const orig = (await imgFacts())[0]!;
    await clickCentre(a(), at.x, at.y);
    expect(await waitFor(a().page, `document.querySelectorAll('img').length >= 2`, 3000), `按了圖要出現放大的圖;圖:${JSON.stringify(await imgFacts())}`).toBe(true);
    await sleep(200);
    const big = (await imgFacts()).find((f) => !f.orig);
    expect(big, '放大層裡要有新的圖').toBeTruthy();
    return { orig, big: big! };
  }

  /** 視窗 W × H 裡裝得下的最大(等比例) */
  const fit = (nw: number, nh: number, W: number, H: number): { w: number; h: number } => {
    const s = Math.min(W / nw, H / nh);
    return { w: nw * s, h: nh * s };
  };
  const near = (x: number, y: number, tol = 1.5): boolean => Math.abs(x - y) <= tol;

  function sizeProblems(big: ImgFact, W: number, H: number, tag: string): string[] {
    const out: string[] = [];
    const want = fit(big.nw, big.nh, W, H);
    if (!near(big.rect.w, want.w) || !near(big.rect.h, want.h)) out.push(`${tag}:圖要是 ${want.w.toFixed(1)}×${want.h.toFixed(1)}(視窗 ${W}×${H} 裡裝得下的最大、等比例),實際 ${big.rect.w.toFixed(1)}×${big.rect.h.toFixed(1)}`);
    if (big.rect.x < -0.5 || big.rect.y < -0.5 || big.rect.x + big.rect.w > W + 0.5 || big.rect.y + big.rect.h > H + 0.5) out.push(`${tag}:圖超出視窗 ${W}×${H}:x ${big.rect.x.toFixed(1)} y ${big.rect.y.toFixed(1)} w ${big.rect.w.toFixed(1)} h ${big.rect.h.toFixed(1)}`);
    if (!near(big.rect.w, W, 2) && !near(big.rect.h, H, 2)) out.push(`${tag}:寬或高其中一邊要剛好碰到視窗(${W}×${H}),實際 ${big.rect.w.toFixed(1)}×${big.rect.h.toFixed(1)}`);
    return out;
  }

  async function overlayCovers(W: number, H: number, tag: string): Promise<void> {
    const r = await overlayRect();
    expect(r, `${tag}:找得到放大層`).not.toBeNull();
    expect(Math.abs(r!.x) <= 0.5 && Math.abs(r!.y) <= 0.5 && near(r!.w, W, 0.5) && near(r!.h, H, 0.5), `${tag}:放大層要蓋滿 ${W}×${H}(實際 x ${r!.x} y ${r!.y} 寬 ${r!.w} 高 ${r!.h})`).toBe(true);
  }

  it('g. 比視窗高的圖(240×960)放大:整張在視窗裡、比例不變、高剛好碰到視窗(F2;基底上本來就綠)', async () => {
    const { orig, big } = await openZoom('tall');
    expect(orig.rect.h, '前提:卡片裡這張圖比視窗高').toBeGreaterThan(VIEWPORT.height);
    expect(sizeProblems(big, 360, 480, '高圖')).toEqual([]);
    expect(big.rect.h, '高圖放大是整張看得到,高 = 視窗的高').toBeGreaterThan(470);
    expect(Math.abs(big.rect.w / big.rect.h - big.nw / big.nh) / (big.nw / big.nh), '比例不變(誤差 < 1%)').toBeLessThan(0.01);
    await overlayCovers(360, 480, '高圖');
  });

  it('g. 裝得進視窗的圖(120×60)放大:至少跟卡片裡一樣大(T46 的 d 已有,這裡不退步)、等比例裝進視窗的最大', async () => {
    const { orig, big } = await openZoom('ok');
    expect(sizeProblems(big, 360, 480, '小圖')).toEqual([]);
    expect(big.rect.w * big.rect.h, `放大後(${big.rect.w}×${big.rect.h})不能比卡片裡(${orig.rect.w}×${orig.rect.h})小`).toBeGreaterThanOrEqual(orig.rect.w * orig.rect.h - 1);
    await overlayCovers(360, 480, '小圖');
  });

  for (const body of ['ok', 'tall'] as const) {
    it(`g. 放大開著時視窗改大小(${body === 'ok' ? '120×60 的圖' : '240×960 的圖'}):resize(480, 600) → 放大層蓋滿 480×600、圖重算成裝得進的最大、比例不變;resize(360, 480) → 回到原本的大小`, async () => {
      expect(a().page.resize, 'GalleryPage 要有 resize').toBeDefined();
      const { big: before } = await openZoom(body);
      expect(sizeProblems(before, 360, 480, '改大小之前')).toEqual([]);
      await a().page.resize!(480, 600);
      await sleep(400);
      const bigger = (await imgFacts()).find((f) => !f.orig);
      expect(bigger, '改大小之後放大層還開著').toBeTruthy();
      await overlayCovers(480, 600, 'resize(480,600)');
      expect(sizeProblems(bigger!, 480, 600, 'resize(480,600)')).toEqual([]);
      expect(Math.abs(bigger!.rect.w / bigger!.rect.h - bigger!.nw / bigger!.nh) / (bigger!.nw / bigger!.nh), '比例不變(誤差 < 1%)').toBeLessThan(0.01);
      await a().page.resize!(360, 480);
      await sleep(400);
      const back = (await imgFacts()).find((f) => !f.orig);
      expect(back, '改回來之後放大層還開著').toBeTruthy();
      await overlayCovers(360, 480, 'resize(360,480)');
      expect(sizeProblems(back!, 360, 480, 'resize(360,480)')).toEqual([]);
      expect(near(back!.rect.w, before.rect.w, 1) && near(back!.rect.h, before.rect.h, 1), `改回原本的大小,圖也回到原本的 ${before.rect.w.toFixed(1)}×${before.rect.h.toFixed(1)}(實際 ${back!.rect.w.toFixed(1)}×${back!.rect.h.toFixed(1)})`).toBe(true);
    });
  }

  it('g. 縮小視窗也重算:放大開著時 resize(300, 300)(裝得下的圖要縮到 300 內):圖不超出新視窗', async () => {
    expect(a().page.resize, 'GalleryPage 要有 resize').toBeDefined();
    await openZoom('ok');
    await a().page.resize!(300, 300);
    await sleep(400);
    const small = (await imgFacts()).find((f) => !f.orig);
    expect(small, '改大小之後放大層還開著').toBeTruthy();
    expect(sizeProblems(small!, 300, 300, 'resize(300,300)')).toEqual([]);
  });

  it('找不到圖片的字樣:字級不大於例子裡的字(T46 第 5 條;基底上本來就綠)', async () => {
    await prepare(a(), 'missing');
    expect(await waitFor(a().page, `document.querySelector('.lc-missing')`, 8000), `要出現「找不到圖片」字樣;畫面文字:${await pageText(a().page)}`).toBe(true);
    const f = await a().page.evaluate<{ missing: number; li: number; text: string }>(`(() => ({
      missing: parseFloat(getComputedStyle(document.querySelector('.lc-missing')).fontSize),
      li: parseFloat(getComputedStyle(document.querySelector('.lc-example li')).fontSize),
      text: document.querySelector('.lc-missing').textContent,
    }))()`);
    expect(f.text).toContain('找不到圖片:assets/t48-missing.png');
    expect(f.missing, `字樣 ${f.missing}px 不大於例子裡的字 ${f.li}px`).toBeLessThanOrEqual(f.li + 0.01);
  });
});
