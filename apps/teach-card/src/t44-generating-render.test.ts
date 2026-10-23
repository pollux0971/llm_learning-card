/**
 * T44(教學卡生成中的畫面要跟著更新;T43 `@manual` 的 F1、F2、O1)渲染測試。測試 agent 寫;開發 worker 不改。
 *
 * 真的把 `App.svelte` 畫出來:`openApp(apps/teach-card, { viewport: 360 × 480, initScript })`(`packages/ui-shared/src/hud/render-test-support.ts`),
 * 起的是單獨執行的 vite dev server(`dev/standalone.ts`:真的側車、暫存根、`dev/fake-cloud.mjs` 每個模型呼叫延遲約 1.5 秒)+ headless Chrome。
 * 看的都是畫面(DOM 與計算樣式),不看 `view()`、不比原始碼字串。找不到 Chrome 就紅(設 LC_CHROME)。
 *
 * 時點用 `initScript` 控制,不靠等很久:頁面自己的腳本之前把 `window.fetch` 換成
 *   - 記錄 `/__review` 每個請求的 method(`window.__t44.methods`);
 *   - 能「扣住」`teach.poll`:`__t44.hold = true` 之後的 `teach.poll` 等 `__t44.release()` 才轉給真的側車;
 *   - 能讓某個 method 回一個錯誤(`__t44.inject[method]` 一串錯誤,用掉就放行;同 card-render-phase3.test.ts 的做法)。
 * 這是測試那一邊的事,產品程式不用為它改。
 *
 * 對應工單 must_catch:a 生成中有那一行與「取消」;b 三顆主按鈕停用(回上一層出現就也停用);c 生成中按「下一個」0 個 teach.next、沒有出錯畫面;
 * d 完成後畫面自己換成子卡;e 取消回原卡、按鈕恢復;f 有子卡的那張按深入不閃出生成中那一行;g 樣式(生成中與深入的錯誤字樣:
 * 字比內文小、上方 1px var(--hud-line)、「取消」跟「下一個」一樣大、最深一層四顆按鈕都在面板裡且點得到)。
 * 工單預期在 930de2a 之前的基底上 a、b、c、e、g 紅,d、f 本來就綠(它們守的是修完之後不能退步)。
 *
 * 取捨(工單沒寫死的地方):
 *   - 「先備提示的按鈕也停用」:單獨執行的種子裡,第一張卡沒有先備時這句沒有東西可量,有就量(條件式,b 裡註明)。
 *   - A 組等「畫面出現某個東西」最多 2 秒:假網路一次深入要 ~4.5 秒才寫完,等太久的話,基底上(畫面本來就不會變)測試還在等的時候背景工作已經把
 *     子卡寫進暫存根,後面的測試就沒有「還沒有子卡」的前提了。每條測試收尾另外直接送 teach.cancel(quiesce)。
 *   - 最深一層與沒有模型:用 `inject` 讓 teach.deepen 回 deepen-floor / no-model / deepen-failed(固定句子由 App 照 kind 查表),
 *     不真的生到 level 4。
 */
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openApp, type GalleryPage } from '../../../packages/ui-shared/src/hud/render-test-support.js';
import { GENERATING_MESSAGE } from './teach-session.js';

// 每條都真的起 vite、headless Chrome、側車,深入一次約 5 秒:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const TEACH_DIR = join(import.meta.dirname, '..');
const VIEWPORT = { width: 360, height: 480 } as const;

const INIT_SCRIPT = `(() => {
  const orig = window.fetch.bind(window);
  const st = (window.__t44 = { methods: [], hold: false, waiters: [], inject: {}, sawGenerating: false });
  st.release = () => {
    st.hold = false;
    for (const wake of st.waiters.splice(0)) wake();
  };
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('/__review')) return orig(input, init);
    const body = JSON.parse(init.body);
    st.methods.push(body.method);
    const queue = st.inject[body.method];
    if (queue && queue.length > 0) {
      const error = queue.shift();
      return new Response(JSON.stringify({ v: 1, id: body.id, ok: false, error }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (body.method === 'teach.poll' && st.hold) await new Promise((wake) => st.waiters.push(wake));
    return orig(input, init);
  };
})()`;

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

async function clickButton(page: GalleryPage, label: string): Promise<void> {
  const ok = await page.evaluate<boolean>(`(() => { const b = ${BUTTON(label)}; if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`畫面上找不到字是「${label}」的按鈕;畫面文字:${await pageText(page)}`);
}

const pageText = (page: GalleryPage): Promise<string> => page.evaluate<string>('document.body.innerText');
const hasButton = (page: GalleryPage, label: string): Promise<boolean> => page.evaluate<boolean>(`Boolean(${BUTTON(label)})`);
const isDisabled = (page: GalleryPage, label: string): Promise<boolean> => page.evaluate<boolean>(`${BUTTON(label)}.disabled === true`);
const methods = (page: GalleryPage): Promise<string[]> => page.evaluate<string[]>('window.__t44.methods.slice()');
const title = (page: GalleryPage): Promise<string> => page.evaluate<string>(`document.querySelector('h2')?.textContent.trim() ?? ''`);
const hasFrom = (page: GalleryPage): Promise<boolean> => page.evaluate<boolean>(`/來自:/.test(document.querySelector('.markers')?.textContent ?? '')`);
const generatingLine = (page: GalleryPage): Promise<boolean> =>
  page.evaluate<boolean>(`(() => { const e = document.querySelector('.generating'); return Boolean(e) && e.textContent.includes(${JSON.stringify(GENERATING_MESSAGE)}); })()`);

/** 扣住 teach.poll;按「深入這個」;等到被扣住的那個 poll 真的到了(= 側車已經回了 generating:true,session 已經在輪詢) */
async function startHeldDeepen(page: GalleryPage): Promise<void> {
  await page.evaluate('(window.__t44.hold = true)');
  await clickButton(page, '深入這個');
  const reached = await waitFor(page, 'window.__t44.waiters.length > 0', 10_000);
  if (!reached) throw new Error(`teach.poll 一直沒有送出(深入沒有進到輪詢);已送的請求:${(await methods(page)).join(',')}`);
}

/**
 * 一條測試的收尾:放行被扣住的 poll,直接對側車送 teach.cancel(不經過畫面)。
 * 背景工作跟 poll 無關,自己會寫完;不收掉的話它會把子卡寫進暫存根,後面「還沒有子卡」的前提就沒了。
 * 取消不寫檔(工作被當成取消,手上的呼叫回來之後不提交)。
 */
async function quiesce(page: GalleryPage): Promise<void> {
  await page.evaluate(`(async () => {
    window.__t44.release();
    const res = await fetch('/__review', { method: 'POST', body: JSON.stringify({ v: 1, id: 90001, method: 'teach.cancel', params: {} }) });
    await res.text();
    return true;
  })()`);
}

async function injectError(page: GalleryPage, method: string, kind: string, message: string): Promise<void> {
  await page.evaluate(`(() => { (window.__t44.inject[${JSON.stringify(method)}] ??= []).push({ kind: ${JSON.stringify(kind)}, message: ${JSON.stringify(message)} }); return true; })()`);
}

// ---------------------------------------------------------------- 樣式量測(頁面裡執行)

interface StyleFacts {
  fontSize: number;
  bodyFontSize: number;
  borderTopWidth: string;
  borderTopStyle: string;
  borderTopColor: string;
  hudLine: string;
  color: string;
  hudText: string;
}

const STYLE_OF = (selector: string): string => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const body = document.querySelector('.body');
  if (!el || !body) return null;
  const colourOf = (v) => { const p = document.createElement('span'); p.style.color = v; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const cs = getComputedStyle(el);
  return {
    fontSize: parseFloat(cs.fontSize),
    bodyFontSize: parseFloat(getComputedStyle(body).fontSize),
    borderTopWidth: cs.borderTopWidth,
    borderTopStyle: cs.borderTopStyle,
    borderTopColor: cs.borderTopColor,
    hudLine: colourOf('var(--hud-line)'),
    color: cs.color,
    hudText: colourOf('var(--hud-text)'),
  };
})()`;

async function expectSystemLineStyle(page: GalleryPage, selector: string, what: string): Promise<void> {
  const facts = await page.evaluate<StyleFacts | null>(STYLE_OF(selector));
  expect(facts, `${what}:畫面上找不到 ${selector} 或 .body`).not.toBeNull();
  const f = facts!;
  expect(f.fontSize, `${what}:字(${f.fontSize}px)要比內文(${f.bodyFontSize}px)小`).toBeLessThan(f.bodyFontSize);
  expect(f.borderTopWidth, `${what}:上面要有 1px 的分隔線`).toBe('1px');
  expect(f.borderTopStyle, `${what}:分隔線要是實線`).toBe('solid');
  expect(f.borderTopColor, `${what}:分隔線的顏色要是 var(--hud-line)(${f.hudLine})`).toBe(f.hudLine);
  expect(f.color, `${what}:字色照舊是 var(--hud-text)`).toBe(f.hudText);
}

/** 「取消」跟「下一個」一樣大:字級與高度都相同 */
async function expectCancelSameSizeAsNext(page: GalleryPage): Promise<void> {
  const sizes = await page.evaluate<{ cancel: { fs: number; h: number }; next: { fs: number; h: number } } | null>(`(() => {
    const cancel = ${BUTTON('取消')}; const next = ${BUTTON('下一個')};
    if (!cancel || !next) return null;
    const of = (b) => ({ fs: parseFloat(getComputedStyle(b).fontSize), h: Math.round(b.getBoundingClientRect().height * 100) / 100 });
    return { cancel: of(cancel), next: of(next) };
  })()`);
  expect(sizes, '畫面上要同時有「取消」與「下一個」').not.toBeNull();
  expect(sizes!.cancel.fs, `「取消」字級要跟「下一個」一樣(${sizes!.next.fs}px)`).toBe(sizes!.next.fs);
  expect(sizes!.cancel.h, `「取消」高度要跟「下一個」一樣(${sizes!.next.h}px)`).toBe(sizes!.next.h);
}

/** 四顆(或現有的)主按鈕都在面板框裡,中心點點得到自己 */
async function expectButtonsReachable(page: GalleryPage, labels: string[]): Promise<void> {
  const problems = await page.evaluate<string[]>(`(() => {
    const panel = document.querySelector('[data-hud="panel"]');
    const out = [];
    if (!panel) return ['沒有面板'];
    const box = panel.getBoundingClientRect();
    for (const label of ${JSON.stringify(labels)}) {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.replace(/\\s+/g, '') === label);
      if (!b) { out.push(label + ':找不到'); continue; }
      b.scrollIntoView({ block: 'end' });
      const r = b.getBoundingClientRect();
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5) out.push(label + ':超出面板框');
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === b || b.contains(hit))) out.push(label + ':中心點點到別的東西(' + (hit ? hit.tagName + '.' + hit.className : 'null') + ')');
    }
    return out;
  })()`);
  expect(problems).toEqual([]);
}

// ---------------------------------------------------------------- A:扣住 poll 的檢查(取消不寫檔,所以這一組不會生出子卡)

describe('T44 渲染(A):生成中的畫面——a、b、c、e、g 生成中那一半', () => {
  let page: GalleryPage | undefined;
  beforeAll(async () => {
    page = await openApp(TEACH_DIR, { viewport: VIEWPORT, ready: '.markers', initScript: INIT_SCRIPT });
  });
  afterAll(async () => {
    await page?.close();
  });
  const p = (): GalleryPage => {
    if (!page) throw new Error('教學卡沒有開起來');
    return page;
  };
  afterEach(async () => {
    if (page) await quiesce(page);
  });

  it('常數:生成中的字樣照工單', () => {
    expect(GENERATING_MESSAGE).toBe('正在產生更深入的卡片,可能要等幾十秒。');
  });

  it('a. 按深入、teach.poll 被扣住時:畫面上有生成中那一行與「取消」(而且在按鈕列上面)', async () => {
    await p().reset();
    await startHeldDeepen(p());
    expect(await waitFor(p(), `(() => { const e = document.querySelector('.generating'); return e && e.textContent.includes(${JSON.stringify(GENERATING_MESSAGE)}); })()`, 2000), `畫面要出現「${GENERATING_MESSAGE}」;畫面文字:${await pageText(p())}`).toBe(true);
    expect(await hasButton(p(), '取消'), '要有「取消」').toBe(true);
    expect(await isDisabled(p(), '取消'), '「取消」可以按').toBe(false);
    const above = await p().evaluate<boolean>(`(() => {
      const line = document.querySelector('.generating'); const controls = document.querySelector('.controls');
      return Boolean(line && controls) && Boolean(line.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING);
    })()`);
    expect(above, '生成中那一行在按鈕列上面').toBe(true);
    await p().evaluate('window.__t44.release()');
  });

  it('b. 同一個時點:「下一個」「換類別」「深入這個」都是 disabled;有「回上一層」就也是;先備提示的按鈕也是(有的話)', async () => {
    await p().reset();
    await startHeldDeepen(p());
    await sleep(150);
    expect(await isDisabled(p(), '下一個'), '「下一個」要停用').toBe(true);
    expect(await isDisabled(p(), '換類別'), '「換類別」要停用').toBe(true);
    expect(await isDisabled(p(), '深入這個'), '「深入這個」要停用').toBe(true);
    if (await hasButton(p(), '回上一層')) expect(await isDisabled(p(), '回上一層'), '「回上一層」出現就要停用').toBe(true);
    const prereqs = await p().evaluate<boolean[]>(`[...document.querySelectorAll('.prereqs button')].map((b) => b.disabled)`);
    expect(prereqs.every((d) => d), '先備提示的按鈕要停用').toBe(true);
    await p().evaluate('window.__t44.release()');
  });

  it('c. 同一個時點按「下一個」:0 個 teach.next;畫面沒有「這一列不是合法的請求。」、沒有出錯畫面', async () => {
    await p().reset();
    await startHeldDeepen(p());
    await sleep(150);
    await clickButton(p(), '下一個');
    await sleep(1200);
    const seen = await methods(p());
    expect(seen.filter((m) => m === 'teach.next'), `不能送 teach.next;已送:${seen.join(',')}`).toEqual([]);
    const text = await pageText(p());
    expect(text, '不能出現這句錯誤').not.toContain('這一列不是合法的請求。');
    expect(await p().evaluate<boolean>(`Boolean(document.querySelector('.error'))`), '不能進出錯畫面').toBe(false);
    expect(await hasButton(p(), '再試一次'), '不能有「再試一次」').toBe(false);
    await p().evaluate('window.__t44.release()');
  });

  it('e. 按「取消」(放行手上那一個 teach.poll):畫面回到原本那張、生成中那一行收掉、主按鈕恢復;送了 teach.cancel', async () => {
    await p().reset();
    const before = await title(p());
    await startHeldDeepen(p());
    expect(await waitFor(p(), `document.querySelector('.generating')`, 2000), `畫面要先有生成中那一行才有得取消;畫面文字:${await pageText(p())}`).toBe(true);
    await clickButton(p(), '取消');
    await p().evaluate('window.__t44.release()');
    expect(await waitFor(p(), `!document.querySelector('.generating')`, 10_000), '生成中那一行要收掉').toBe(true);
    expect(await title(p()), '回到原本那張').toBe(before);
    expect(await hasFrom(p()), '不是子卡(沒有「來自:」)').toBe(false);
    expect(await waitFor(p(), `${BUTTON('下一個')} && !${BUTTON('下一個')}.disabled`, 4000), '「下一個」恢復').toBe(true);
    expect(await isDisabled(p(), '換類別'), '「換類別」恢復').toBe(false);
    expect(await isDisabled(p(), '深入這個'), '「深入這個」恢復').toBe(false);
    expect(await hasButton(p(), '取消'), '「取消」收掉').toBe(false);
    expect(await methods(p()), '送過 teach.cancel').toContain('teach.cancel');
  });

  it('g(生成中). 生成中那一行:字比內文小、上面 1px var(--hud-line) 分隔線、字色照舊;「取消」跟「下一個」一樣大(字級與高度)', async () => {
    await p().reset();
    await startHeldDeepen(p());
    expect(await waitFor(p(), `document.querySelector('.generating')`, 2000), `畫面要有生成中那一行;畫面文字:${await pageText(p())}`).toBe(true);
    await expectSystemLineStyle(p(), '.generating', '生成中那一行');
    await expectCancelSameSizeAsNext(p());
    await p().evaluate('window.__t44.release()');
  });

  it('g(沒有模型 / 其他深入錯誤). 深入的錯誤字樣一樣是小字、1px 分隔線(三種 kind 都量)', async () => {
    const cases: { kind: string; text: string }[] = [
      { kind: 'no-model', text: '現在沒辦法產生新卡:連不上雲端,也沒有可用的本機模型。' },
      { kind: 'deepen-failed', text: '這次沒有產生出能用的卡。可以再按一次「深入這個」。' },
    ];
    for (const c of cases) {
      await p().reset();
      await injectError(p(), 'teach.deepen', c.kind, c.text);
      await clickButton(p(), '深入這個');
      expect(await waitFor(p(), `document.querySelector('.deepen-error')`, 5000), `${c.kind}:要顯示錯誤字樣;畫面文字:${await pageText(p())}`).toBe(true);
      expect(await p().evaluate<string>(`document.querySelector('.deepen-error').textContent.trim()`)).toBe(c.text);
      await expectSystemLineStyle(p(), '.deepen-error', `${c.kind} 的錯誤字樣`);
    }
  });
});

// ---------------------------------------------------------------- D:會寫檔的檢查(d、f,以及子卡畫面上的 b、g)

describe('T44 渲染(D):完成自己換、不閃、子卡畫面——d、f、b(回上一層)、g(最深一層)', () => {
  let page: GalleryPage | undefined;
  beforeAll(async () => {
    page = await openApp(TEACH_DIR, { viewport: VIEWPORT, ready: '.markers', initScript: INIT_SCRIPT });
  });
  afterAll(async () => {
    await page?.close();
  });
  const p = (): GalleryPage => {
    if (!page) throw new Error('教學卡沒有開起來');
    return page;
  };

  /** 讓第一張卡有子卡(假網路真的生一次);已經有就直接帶過。完成後畫面停在第一張子卡。 */
  async function ensureChildrenAndShowChild(): Promise<void> {
    await p().reset();
    await p().evaluate('(window.__t44.hold = false)');
    await clickButton(p(), '深入這個');
    // 沒有子卡:輪詢到寫完(假網路 ~4.5 秒);有子卡:一個請求就換。兩種都等「來自:」
    expect(await waitFor(p(), `/來自:/.test(document.querySelector('.markers')?.textContent ?? '')`, 40_000), `深入之後要出現子卡;畫面文字:${await pageText(p())}`).toBe(true);
  }

  it('d. 放行之後畫面自己換成第一張新卡(標題換了、有「來自:」、生成中那一行不見),測試期間不再按任何按鈕', async () => {
    await p().reset();
    const before = await title(p());
    await p().evaluate('(window.__t44.hold = true)');
    await clickButton(p(), '深入這個');
    expect(await waitFor(p(), 'window.__t44.waiters.length > 0', 10_000), 'teach.poll 要送出').toBe(true);
    await p().evaluate('window.__t44.release()');
    // 從這裡開始不再按任何按鈕
    expect(await waitFor(p(), `/來自:/.test(document.querySelector('.markers')?.textContent ?? '')`, 40_000), `畫面要自己換成子卡;畫面文字:${await pageText(p())}`).toBe(true);
    const after = await title(p());
    expect(after, '標題換了').not.toBe(before);
    expect(await generatingLine(p()), '生成中那一行不見').toBe(false);
    expect(await p().evaluate<boolean>(`Boolean(document.querySelector('.generating'))`)).toBe(false);
    expect(await hasButton(p(), '取消'), '「取消」不見').toBe(false);
    expect(await hasButton(p(), '回上一層'), '子卡有「回上一層」').toBe(true);
  });

  it('f. 有子卡的那張按深入:從按下去到子卡出現,畫面上沒有任何一刻有生成中那一行(MutationObserver),也沒送 teach.poll', async () => {
    await ensureChildrenAndShowChild();
    await p().reset(); // 回到有子卡的那張(第一張還沒學過)
    expect(await hasFrom(p()), '前提:reset 之後是有子卡的那張父卡,不是子卡').toBe(false);
    await p().evaluate(`(() => {
      const st = window.__t44;
      st.sawGenerating = false;
      st.methods.length = 0;
      const check = () => { if (document.body.textContent.includes(${JSON.stringify(GENERATING_MESSAGE)}) || document.querySelector('.generating')) st.sawGenerating = true; };
      st.observer = new MutationObserver(check);
      st.observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      return true;
    })()`);
    await clickButton(p(), '深入這個');
    expect(await waitFor(p(), `/來自:/.test(document.querySelector('.markers')?.textContent ?? '')`, 10_000), `子卡要出現;畫面文字:${await pageText(p())}`).toBe(true);
    await sleep(800); // 超過一個輪詢間隔,晚閃出來的也抓得到
    const saw = await p().evaluate<boolean>('(window.__t44.observer.takeRecords(), window.__t44.observer.disconnect(), window.__t44.sawGenerating)');
    expect(saw, '有子卡時不能閃出生成中那一行').toBe(false);
    expect(await methods(p()), '有子卡:不輪詢').not.toContain('teach.poll');
  });

  it('b(回上一層). 子卡上再按深入(poll 被扣住):「回上一層」若在畫面上就要停用;其他三顆也停用', async () => {
    await ensureChildrenAndShowChild();
    expect(await hasButton(p(), '回上一層'), '前提:子卡有「回上一層」').toBe(true);
    await startHeldDeepen(p());
    await sleep(150);
    if (await hasButton(p(), '回上一層')) expect(await isDisabled(p(), '回上一層'), '生成中「回上一層」要停用').toBe(true);
    expect(await isDisabled(p(), '下一個')).toBe(true);
    expect(await isDisabled(p(), '換類別')).toBe(true);
    expect(await isDisabled(p(), '深入這個')).toBe(true);
    // 收尾:取消,放行手上那一個 poll
    if (await hasButton(p(), '取消')) await clickButton(p(), '取消');
    await p().evaluate('window.__t44.release()');
  });

  it('g(最深一層). 子卡畫面的最深一層錯誤字樣:小字、1px var(--hud-line) 分隔線;四顆按鈕都在面板框裡、中心點點得到自己', async () => {
    await ensureChildrenAndShowChild();
    await p().evaluate('(window.__t44.hold = false)');
    await injectError(p(), 'teach.deepen', 'deepen-floor', '這張已經是最深的一層了。');
    await clickButton(p(), '深入這個');
    expect(await waitFor(p(), `document.querySelector('.deepen-error')`, 5000), `要顯示最深一層的字樣;畫面文字:${await pageText(p())}`).toBe(true);
    expect(await p().evaluate<string>(`document.querySelector('.deepen-error').textContent.trim()`)).toBe('這張已經是最深的一層了。');
    await expectSystemLineStyle(p(), '.deepen-error', '最深一層的字樣');
    await expectButtonsReachable(p(), ['回上一層', '下一個', '換類別', '深入這個']);
  });
});
