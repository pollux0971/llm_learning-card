/**
 * T45(教學卡的系統狀態字樣不推動按鈕、直角引號裡的詞不折斷;T44 `@manual` 的 N1、N2)渲染測試。測試 agent 寫;開發 worker 不改。
 *
 * 真的把 `App.svelte` 畫出來:`openApp(apps/teach-card, { viewport: 360 × 480, initScript })`(`packages/ui-shared/src/hud/render-test-support.js`),
 * 同 t44-generating-render.test.ts 的做法:單獨執行的 vite dev server + 真的側車 + `dev/fake-cloud.mjs` + headless Chrome。
 * 量的都是畫面(DOM、計算樣式、`getBoundingClientRect`、`Range.getClientRects`、`elementFromPoint`),不看 `view()`、不比原始碼字串。
 *
 * 頁面腳本之前的 `initScript` 換掉 `window.fetch`(測試那一邊的事,產品程式不用為它改):
 *   - 記錄 `/__review` 每個請求的 method;能「扣住」`teach.poll`(`hold`),放行時可以改回一個錯誤(`holdError`:輪詢拿到錯誤);
 *     能讓某個 method 回指定的錯誤(`inject`,含 `credential-unavailable` 帶 `message`)。
 *   - 改 `/__card` 回的卡片內文:`localStorage['t45.card']` 是 `short` 就拿掉例子區塊(內容放得下的短卡),`long` 就多加一個例子區塊(要捲的長卡)。
 *
 * 對應工單 must_catch:
 *   a 短卡,字樣出現/收掉/換成另一種的每一種轉換,前後每顆按鈕的矩形相同(差 0);
 *   b 長卡捲到底,同樣的轉換,按鈕矩形與 scrollTop 都相同;
 *   c 字樣整塊在面板看得到的範圍裡(短卡、長卡捲到底),生成中的「取消」中心點打得到自己;
 *   d O1 樣式(T44 第 8 條)不退步,分隔線在 .generating / .deepen-error 自己身上、祖先到 .hud-body 沒有框線;
 *   e 360 寬時「…」括起來的詞不折成兩行(預設句、掃一串注入的句子),捲動區沒有橫向捲動;
 *   f 最深一層雙擊:第二下不送 teach.back;沒有子卡雙擊:第二下不送 teach.cancel。
 *
 * 取捨(工單沒寫死的地方):
 *   - 每一種轉換各自一條測試、各自 reset(整頁重新載入)再走:一條紅了看得出是哪一種轉換。
 *   - 「最高的金鑰句」:`credentialMessage(…, 'deepen')` 的 missing / rejected × 三個鍵名共 6 句,外加
 *     `ERROR_MESSAGES['credential-unavailable']`(協定規定 message 一定是字串,所以當成側車的 message 送;畫面顯示的就是 err.message);一句一句注入、量 `.deepen-error` 的高度,取最高的那一句(`tallestCredential`),
 *     a、b、c 與錯誤↔錯誤的轉換都用它。量到的高度與行數用 console.log 印出來(commit 說明也寫)。
 *   - e 的「掃一串」:用一串長短不同的前綴把「…」推到每一種折行位置,不靠這台機器剛好哪個字寬;任何一種前綴讓詞被折斷就紅。
 *   - f 用 DOM 模擬「指標還停在原地的第二下」:記下「深入這個」的中心點,按它,字樣出現後在同一點 elementFromPoint,
 *     是按鈕就 click()(停用的按鈕 click 不會有事,跟真的指標一樣)。
 *   - 每條測試收尾直接送 teach.cancel(quiesce),同 t44:背景工作不收掉會把子卡寫進暫存根。只有 f(最深一層)那一組真的生出一張子卡。
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openApp, type GalleryPage } from '../../../packages/ui-shared/src/hud/render-test-support.js';
import { GENERATING_MESSAGE } from './teach-session.js';

// 每條都真的起 vite、headless Chrome、側車:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = join(import.meta.dirname, '../../..');
const TEACH_DIR = join(import.meta.dirname, '..');
const VIEWPORT = { width: 360, height: 480 } as const;
const CREDENTIALS = pathToFileURL(join(ROOT, 'packages/core/src/llm/credentials.ts')).href;
const PROTOCOL = pathToFileURL(join(ROOT, 'packages/core/src/session/protocol.ts')).href;

const GRADING_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GATEWAY_API_KEY'] as const;
const PROBLEM_KINDS = ['missing', 'rejected'] as const;

interface CredentialsModule {
  credentialMessage(problem: unknown, use?: 'grade' | 'deepen'): string;
}
interface ProtocolModule {
  ERROR_MESSAGES: Record<string, string>;
}
const credentials = async (): Promise<CredentialsModule> => (await import(/* @vite-ignore */ CREDENTIALS)) as CredentialsModule;
const protocol = async (): Promise<ProtocolModule> => (await import(/* @vite-ignore */ PROTOCOL)) as ProtocolModule;

const EXAMPLE_BLOCK = '```example[\\s\\S]*?```';
const EXTRA_EXAMPLE = '\n\n```example\n補充:\n\n- 第一點\n- 第二點\n- 第三點\n- 第四點\n- 第五點\n- 第六點\n- 第七點\n- 第八點\n```\n';

const INIT_SCRIPT = `(() => {
  const orig = window.fetch.bind(window);
  const st = (window.__t45 = { methods: [], hold: false, holdError: null, waiters: [], inject: {} });
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
      let text = await res.text();
      let mode = '';
      try { mode = localStorage.getItem('t45.card') || ''; } catch { mode = ''; }
      if (mode === 'short') text = text.replace(new RegExp(${JSON.stringify(EXAMPLE_BLOCK)}, 'g'), '');
      if (mode === 'long') text += ${JSON.stringify(EXTRA_EXAMPLE)};
      return new Response(text, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (!url.includes('/__review')) return orig(input, init);
    const body = JSON.parse(init.body);
    st.methods.push(body.method);
    const queue = st.inject[body.method];
    if (queue && queue.length > 0) return errorResponse(body.id, queue.shift());
    if (body.method === 'teach.poll' && st.hold) {
      await new Promise((wake) => st.waiters.push(wake));
      if (st.holdError) {
        const error = st.holdError;
        st.holdError = null;
        return errorResponse(body.id, error);
      }
    }
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

const pageText = (page: GalleryPage): Promise<string> => page.evaluate<string>('document.body.innerText');
const methods = (page: GalleryPage): Promise<string[]> => page.evaluate<string[]>('window.__t45.methods.slice()');
const title = (page: GalleryPage): Promise<string> => page.evaluate<string>(`document.querySelector('h2')?.textContent.trim() ?? ''`);

async function clickButton(page: GalleryPage, label: string): Promise<void> {
  const ok = await page.evaluate<boolean>(`(() => { const b = ${BUTTON(label)}; if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`畫面上找不到字是「${label}」的按鈕;畫面文字:${await pageText(page)}`);
}

async function injectError(page: GalleryPage, method: string, kind: string, message: string): Promise<void> {
  const error = { kind, message };
  await page.evaluate(`(() => { (window.__t45.inject[${JSON.stringify(method)}] ??= []).push(${JSON.stringify(error)}); return true; })()`);
}

/** 一條測試的收尾:放行被扣住的 poll,直接對側車送 teach.cancel(不經過畫面) */
async function quiesce(page: GalleryPage): Promise<void> {
  await page.evaluate(`(async () => {
    window.__t45.holdError = null;
    window.__t45.release();
    const res = await fetch('/__review', { method: 'POST', body: JSON.stringify({ v: 1, id: 90001, method: 'teach.cancel', params: {} }) });
    await res.text();
    return true;
  })()`);
}

// ---------------------------------------------------------------- 卡片(短卡 / 長卡)

type CardMode = 'short' | 'long';

interface Metrics { sh: number; ch: number; sw: number; cw: number; scrollTop: number }
const metrics = (page: GalleryPage): Promise<Metrics> =>
  page.evaluate<Metrics>(`(() => { const b = document.querySelector('.hud-body'); return { sh: b.scrollHeight, ch: b.clientHeight, sw: b.scrollWidth, cw: b.clientWidth, scrollTop: b.scrollTop }; })()`);

/** 設好卡片模式、整頁重新載入,確認真的是「放得下」或「要捲 ≥ 150 px」的卡 */
async function prepare(page: GalleryPage, mode: CardMode): Promise<void> {
  await page.evaluate(`(() => { try { localStorage.setItem('t45.card', ${JSON.stringify(mode)}); } catch {} return true; })()`);
  await page.reset();
  expect(await waitFor(page, `document.querySelector('.hud-body') && document.querySelector('.markers') && ${BUTTON('深入這個')}`, 10_000), `卡片要載好;畫面文字:${await pageText(page)}`).toBe(true);
  await sleep(200);
  const m = await metrics(page);
  if (mode === 'short') expect(m.sh, `短卡:內容要放得下(scrollHeight ${m.sh} ≤ clientHeight ${m.ch})`).toBeLessThanOrEqual(m.ch + 0.5);
  else expect(m.sh - m.ch, `長卡:要能捲 ≥ 150 px(scrollHeight ${m.sh} - clientHeight ${m.ch})`).toBeGreaterThanOrEqual(150);
}

async function scrollToBottom(page: GalleryPage): Promise<void> {
  await page.evaluate(`(() => { const b = document.querySelector('.hud-body'); b.scrollTop = b.scrollHeight; return true; })()`);
  await sleep(150);
}

// ---------------------------------------------------------------- 按鈕矩形

interface Snapshot { rects: Record<string, [number, number, number, number]>; scrollTop: number }
const SNAPSHOT = `(() => {
  const rects = {};
  for (const b of document.querySelectorAll('button')) {
    const label = b.textContent.replace(/\\s+/g, '');
    if (label === '取消') continue;
    const r = b.getBoundingClientRect();
    rects[label] = [r.x, r.y, r.width, r.height];
  }
  return { rects, scrollTop: document.querySelector('.hud-body').scrollTop };
})()`;
const snapshot = (page: GalleryPage): Promise<Snapshot> => page.evaluate<Snapshot>(SNAPSHOT);

const MAIN_BUTTONS = ['下一個', '換類別', '深入這個'] as const;
const EPS = 0.01;

/** 前後都在的按鈕矩形必須相同;回傳問題清單。主按鈕前後都要在(不然這個比較是空的)。 */
function movedButtons(before: Snapshot, after: Snapshot, withScroll: boolean): string[] {
  const problems: string[] = [];
  for (const label of MAIN_BUTTONS) {
    if (!before.rects[label] || !after.rects[label]) problems.push(`「${label}」前後要都在畫面上(前 ${before.rects[label] ? '有' : '沒有'}、後 ${after.rects[label] ? '有' : '沒有'})`);
  }
  for (const [label, was] of Object.entries(before.rects)) {
    const now = after.rects[label];
    if (!now) continue;
    const delta = was.map((v, i) => Math.abs(v - now[i]!));
    if (delta.some((d) => d > EPS)) problems.push(`「${label}」動了:前 [${was.map((v) => v.toFixed(2)).join(', ')}] 後 [${now.map((v) => v.toFixed(2)).join(', ')}](x, y, 寬, 高)`);
  }
  if (withScroll && Math.abs(before.scrollTop - after.scrollTop) > EPS) problems.push(`捲動位置變了:前 ${before.scrollTop.toFixed(2)} 後 ${after.scrollTop.toFixed(2)}`);
  return problems;
}

// ---------------------------------------------------------------- 最高的金鑰句

/** 協定規定 error.message 一定是字串(ResponseSchema),所以「側車沒帶 message」注入不了;非金鑰的 kind 畫面查 ERROR_MESSAGES,message 只是要有 */
interface Spec { kind: string; message: string; text: string; label: string }

interface LineFacts { height: number; lines: number }
const LINE_FACTS = (selector: string): string => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const range = document.createRange();
  range.selectNodeContents(el);
  const tops = [];
  for (const r of range.getClientRects()) {
    if (r.height === 0) continue;
    if (!tops.some((t) => Math.abs(t - r.top) < 2)) tops.push(r.top);
  }
  return { height: el.getBoundingClientRect().height, lines: tops.length };
})()`;

/** 注入一個深入錯誤、按「深入這個」、等到錯誤字樣出現 */
async function errorStep(page: GalleryPage, spec: Spec): Promise<void> {
  await injectError(page, 'teach.deepen', spec.kind, spec.message);
  await clickButton(page, '深入這個');
  const ok = await waitFor(page, `(document.querySelector('.deepen-error')?.textContent ?? '').trim() === ${JSON.stringify(spec.text)}`, 6000);
  if (!ok) throw new Error(`${spec.label}:畫面要顯示「${spec.text}」;畫面文字:${await pageText(page)}`);
  await sleep(250);
}

let tallest: Spec | undefined;
let tallestReport = '';

/** 量每一句會出現的金鑰字樣(360 寬、真的樣式),取最高的那一句 */
async function tallestCredential(page: GalleryPage): Promise<Spec> {
  if (tallest) return tallest;
  const { credentialMessage } = await credentials();
  const { ERROR_MESSAGES } = await protocol();
  const candidates: Spec[] = [];
  for (const kind of PROBLEM_KINDS) {
    for (const key of GRADING_KEYS) {
      const text = credentialMessage({ kind, key }, 'deepen');
      expect(typeof text, `credentialMessage(${kind}, ${key}) 要有字`).toBe('string');
      candidates.push({ kind: 'credential-unavailable', message: text, text, label: `金鑰 ${kind}/${key}` });
    }
  }
  const fallback = ERROR_MESSAGES['credential-unavailable']!;
  expect(fallback, 'ERROR_MESSAGES 要有 credential-unavailable').toBeTruthy();
  candidates.push({ kind: 'credential-unavailable', message: fallback, text: fallback, label: '金鑰(ERROR_MESSAGES 那一句)' });
  await prepare(page, 'short');
  const measured: { spec: Spec; facts: LineFacts }[] = [];
  for (const spec of candidates) {
    await errorStep(page, spec);
    const facts = await page.evaluate<LineFacts | null>(LINE_FACTS('.deepen-error'));
    expect(facts, `${spec.label}:量不到 .deepen-error`).not.toBeNull();
    measured.push({ spec, facts: facts! });
  }
  let best = measured[0]!;
  for (const m of measured) if (m.facts.height > best.facts.height + 0.01) best = m;
  tallestReport = measured.map((m) => `${m.spec.label}: ${m.facts.height.toFixed(1)}px / ${m.facts.lines} 行`).join(';');
  console.log(`[T45] 360 寬各句金鑰字樣高度:${tallestReport};最高:${best.spec.label}(${best.facts.height.toFixed(1)}px / ${best.facts.lines} 行)`);
  tallest = best.spec;
  await quiesce(page);
  return tallest;
}

// ---------------------------------------------------------------- 狀態

const FLOOR = (m: Record<string, string>): Spec => ({ kind: 'deepen-floor', message: m['deepen-floor']!, text: m['deepen-floor']!, label: '最深一層' });
const NO_MODEL = (m: Record<string, string>): Spec => ({ kind: 'no-model', message: m['no-model']!, text: m['no-model']!, label: '沒有模型' });
const FAILED = (m: Record<string, string>): Spec => ({ kind: 'deepen-failed', message: m['deepen-failed']!, text: m['deepen-failed']!, label: '其他深入錯誤' });

/** 扣住 poll、按「深入這個」,等到生成中那一行出現且被扣住的 poll 到了 */
async function holdGenerating(page: GalleryPage): Promise<void> {
  await page.evaluate('(window.__t45.hold = true)');
  await clickButton(page, '深入這個');
  const ok = await waitFor(page, 'window.__t45.waiters.length > 0 && document.querySelector(".generating")', 10_000);
  if (!ok) throw new Error(`沒有進到生成中(要有 .generating 且 teach.poll 被扣住);已送的請求:${(await methods(page)).join(',')};畫面文字:${await pageText(page)}`);
  await sleep(250);
}

interface Transition {
  id: string;
  start(page: GalleryPage, ctx: Ctx): Promise<void>;
  act(page: GalleryPage, ctx: Ctx): Promise<void>;
}
interface Ctx { cred: Spec; messages: Record<string, string> }

const noStart = async (): Promise<void> => {};

const TRANSITIONS: Transition[] = [
  { id: '沒字 → 生成中', start: noStart, act: (p) => holdGenerating(p) },
  {
    id: '生成中 → 沒字(取消)',
    start: (p) => holdGenerating(p),
    act: async (p) => {
      await clickButton(p, '取消');
      await p.evaluate('window.__t45.release()');
      expect(await waitFor(p, `!document.querySelector('.generating') && !document.querySelector('.deepen-error')`, 10_000), '取消之後生成中那一行要收掉').toBe(true);
      await sleep(250);
    },
  },
  {
    id: '生成中 → 錯誤(輪詢拿到其他深入錯誤)',
    start: (p) => holdGenerating(p),
    act: async (p, c) => {
      await p.evaluate(`(window.__t45.holdError = { kind: 'deepen-failed', message: ${JSON.stringify(c.messages['deepen-failed'])} })`);
      await p.evaluate('window.__t45.release()');
      expect(await waitFor(p, `(document.querySelector('.deepen-error')?.textContent ?? '').trim() === ${JSON.stringify(c.messages['deepen-failed'])}`, 10_000), `輪詢拿到錯誤之後要出現錯誤字樣;畫面文字:${await pageText(p)}`).toBe(true);
      await sleep(250);
    },
  },
  {
    id: '生成中 → 錯誤(輪詢拿到最高的金鑰句)',
    start: (p) => holdGenerating(p),
    act: async (p, c) => {
      await p.evaluate(`(window.__t45.holdError = ${JSON.stringify({ kind: c.cred.kind, message: c.cred.message })})`);
      await p.evaluate('window.__t45.release()');
      expect(await waitFor(p, `(document.querySelector('.deepen-error')?.textContent ?? '').trim() === ${JSON.stringify(c.cred.text)}`, 10_000), `輪詢拿到金鑰錯誤之後要出現那一句;畫面文字:${await pageText(p)}`).toBe(true);
      await sleep(250);
    },
  },
  { id: '沒字 → 最深一層', start: noStart, act: (p, c) => errorStep(p, FLOOR(c.messages)) },
  { id: '沒字 → 沒有模型', start: noStart, act: (p, c) => errorStep(p, NO_MODEL(c.messages)) },
  { id: '沒字 → 其他深入錯誤', start: noStart, act: (p, c) => errorStep(p, FAILED(c.messages)) },
  { id: '沒字 → 最高的金鑰句', start: noStart, act: (p, c) => errorStep(p, c.cred) },
  { id: '錯誤(其他深入錯誤)→ 生成中', start: (p, c) => errorStep(p, FAILED(c.messages)), act: (p) => holdGenerating(p) },
  { id: '錯誤(最高的金鑰句)→ 生成中', start: (p, c) => errorStep(p, c.cred), act: (p) => holdGenerating(p) },
  { id: '錯誤(最深一層)→ 另一種錯誤(最高的金鑰句)', start: (p, c) => errorStep(p, FLOOR(c.messages)), act: (p, c) => errorStep(p, c.cred) },
  { id: '錯誤(最高的金鑰句)→ 另一種錯誤(最深一層)', start: (p, c) => errorStep(p, c.cred), act: (p, c) => errorStep(p, FLOOR(c.messages)) },
];

// ---------------------------------------------------------------- 樣式(同 T44 g)

interface StyleFacts { fontSize: number; bodyFontSize: number; borderTopWidth: string; borderTopStyle: string; borderTopColor: string; hudLine: string; color: string; hudText: string }

const STYLE_OF = (selector: string): string => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const body = document.querySelector('.body');
  if (!el || !body) return null;
  const colourOf = (v) => { const p = document.createElement('span'); p.style.color = v; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const cs = getComputedStyle(el);
  return {
    fontSize: parseFloat(cs.fontSize), bodyFontSize: parseFloat(getComputedStyle(body).fontSize),
    borderTopWidth: cs.borderTopWidth, borderTopStyle: cs.borderTopStyle, borderTopColor: cs.borderTopColor,
    hudLine: colourOf('var(--hud-line)'), color: cs.color, hudText: colourOf('var(--hud-text)'),
  };
})()`;

async function expectSystemLineStyle(page: GalleryPage, selector: string, what: string): Promise<void> {
  const facts = await page.evaluate<StyleFacts | null>(STYLE_OF(selector));
  expect(facts, `${what}:畫面上找不到 ${selector} 或 .body`).not.toBeNull();
  const f = facts!;
  expect(f.fontSize, `${what}:字(${f.fontSize}px)要比內文(${f.bodyFontSize}px)小`).toBeLessThan(f.bodyFontSize);
  expect(f.borderTopWidth, `${what}:上面要有 1px 的分隔線(就在 ${selector} 自己身上)`).toBe('1px');
  expect(f.borderTopStyle, `${what}:分隔線要是實線`).toBe('solid');
  expect(f.borderTopColor, `${what}:分隔線的顏色要是 var(--hud-line)(${f.hudLine})`).toBe(f.hudLine);
  expect(f.color, `${what}:字色照舊是 var(--hud-text)`).toBe(f.hudText);
  const framed = await page.evaluate<string[]>(`(() => {
    const out = [];
    const body = document.querySelector('.hud-body');
    for (let el = document.querySelector(${JSON.stringify(selector)}).parentElement; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const widths = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth];
      if (widths.some((w) => parseFloat(w) > 0)) out.push((el.className || el.tagName) + ' 有框線 ' + widths.join('/'));
      if (cs.boxShadow !== 'none') out.push((el.className || el.tagName) + ' 有 box-shadow');
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) out.push((el.className || el.tagName) + ' 有 outline');
      if (el === body) break;
    }
    return out;
  })()`);
  expect(framed, `${what}:分隔線之外,祖先到 .hud-body 為止不能畫任何框線`).toEqual([]);
}

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

// ---------------------------------------------------------------- 看得到

async function visibilityProblems(page: GalleryPage, selector: string): Promise<string[]> {
  return page.evaluate<string[]>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const body = document.querySelector('.hud-body');
    if (!el) return [${JSON.stringify(selector)} + ' 不在畫面上'];
    const b = body.getBoundingClientRect();
    const top = b.top + body.clientTop, left = b.left + body.clientLeft;
    const bottom = top + body.clientHeight, right = left + body.clientWidth;
    const r = el.getBoundingClientRect();
    const out = [];
    if (r.top < top - 0.5) out.push('上緣在看得到的範圍外 ' + (top - r.top).toFixed(1) + 'px');
    if (r.bottom > bottom + 0.5) out.push('下緣在看得到的範圍外 ' + (r.bottom - bottom).toFixed(1) + 'px(字樣 ' + r.top.toFixed(1) + '–' + r.bottom.toFixed(1) + ',範圍 ' + top.toFixed(1) + '–' + bottom.toFixed(1) + ')');
    if (r.left < left - 0.5) out.push('左緣在範圍外');
    if (r.right > right + 0.5) out.push('右緣在範圍外');
    return out;
  })()`);
}

async function cancelReachable(page: GalleryPage): Promise<string[]> {
  return page.evaluate<string[]>(`(() => {
    const b = ${BUTTON('取消')};
    if (!b) return ['找不到「取消」'];
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && (hit === b || b.contains(hit)) ? [] : ['「取消」中心點點到別的東西(' + (hit ? hit.tagName + '.' + hit.className : 'null') + ')'];
  })()`);
}

// ---------------------------------------------------------------- 直角引號

interface QuoteFacts { text: string; segments: { segment: string; lines: number; fits: boolean }[]; overflowX: boolean; scrollWidth: number; clientWidth: number }

const QUOTE_FACTS = `(() => {
  const el = document.querySelector('.deepen-error');
  const body = document.querySelector('.hud-body');
  if (!el) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let full = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push({ node: n, start: full.length }); full += n.nodeValue; }
  const at = (offset) => { for (let i = nodes.length - 1; i >= 0; i -= 1) if (offset >= nodes[i].start) return { node: nodes[i].node, off: offset - nodes[i].start }; return null; };
  const segments = [];
  for (const m of full.matchAll(/「[^」]*」/g)) {
    const a = at(m.index); const z = at(m.index + m[0].length);
    if (!a || !z) continue;
    const range = document.createRange();
    range.setStart(a.node, a.off);
    range.setEnd(z.node, z.off);
    const tops = [];
    for (const r of range.getClientRects()) {
      if (r.height === 0) continue;
      if (!tops.some((t) => Math.abs(t - r.top) < 2)) tops.push(r.top);
    }
    const probe = document.createElement('span');
    const cs = getComputedStyle(el);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + cs.font + ';letter-spacing:' + cs.letterSpacing;
    probe.textContent = m[0];
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    segments.push({ segment: m[0], lines: tops.length, fits: width < el.clientWidth });
  }
  return { text: full.trim(), segments, overflowX: body.scrollWidth > body.clientWidth, scrollWidth: body.scrollWidth, clientWidth: body.clientWidth };
})()`;

function quoteProblems(f: QuoteFacts): string[] {
  const out: string[] = [];
  for (const s of f.segments) if (s.fits && s.lines > 1) out.push(`${s.segment} 被折成 ${s.lines} 行(它比一行短,不該折)`);
  if (f.overflowX) out.push(`捲動區有橫向捲動:scrollWidth ${f.scrollWidth} > clientWidth ${f.clientWidth}`);
  return out;
}

// ---------------------------------------------------------------- 測試

describe('T45 渲染:系統狀態字樣不推動按鈕、看得到、直角引號不折斷', () => {
  let page: GalleryPage | undefined;
  let ctx: Ctx | undefined;
  beforeAll(async () => {
    page = await openApp(TEACH_DIR, { viewport: VIEWPORT, ready: '.markers', initScript: INIT_SCRIPT });
    const { ERROR_MESSAGES } = await protocol();
    ctx = { cred: await tallestCredential(page), messages: ERROR_MESSAGES };
  });
  afterAll(async () => {
    await page?.close();
  });
  const p = (): GalleryPage => {
    if (!page) throw new Error('教學卡沒有開起來');
    return page;
  };
  const c = (): Ctx => {
    if (!ctx) throw new Error('沒有量到最高的金鑰句');
    return ctx;
  };
  afterEach(async () => {
    if (page) await quiesce(page);
  });

  it('最高的金鑰句:量過每一句(6 句 + ERROR_MESSAGES 那一句),取最高的;a、b、c 的轉換都包含它', () => {
    expect(tallest, '要量到最高的一句').toBeDefined();
    expect(tallestReport.split(';').length, '要量過 7 句').toBe(7);
  });

  // ---- a:短卡
  for (const t of TRANSITIONS) {
    it(`a. 短卡:${t.id}——前後每顆按鈕的矩形相同(差 0)`, async () => {
      await prepare(p(), 'short');
      await t.start(p(), c());
      const before = await snapshot(p());
      await t.act(p(), c());
      const after = await snapshot(p());
      expect(movedButtons(before, after, false), `${t.id}`).toEqual([]);
    });
  }

  // ---- b:長卡捲到底
  for (const t of TRANSITIONS) {
    it(`b. 長卡捲到底:${t.id}——按鈕矩形與捲動位置都不變`, async () => {
      await prepare(p(), 'long');
      await t.start(p(), c());
      await scrollToBottom(p());
      const before = await snapshot(p());
      expect(before.scrollTop, '前提:真的捲到底了').toBeGreaterThan(0);
      await t.act(p(), c());
      const after = await snapshot(p());
      expect(movedButtons(before, after, true), `${t.id}`).toEqual([]);
    });
  }

  // ---- c:看得到
  const STATES: { id: string; show(page: GalleryPage, ctx: Ctx): Promise<void>; selector: string }[] = [
    { id: '生成中', show: (pg) => holdGenerating(pg), selector: '.generating' },
    { id: '最深一層', show: (pg, x) => errorStep(pg, FLOOR(x.messages)), selector: '.deepen-error' },
    { id: '沒有模型', show: (pg, x) => errorStep(pg, NO_MODEL(x.messages)), selector: '.deepen-error' },
    { id: '其他深入錯誤', show: (pg, x) => errorStep(pg, FAILED(x.messages)), selector: '.deepen-error' },
    { id: '最高的金鑰句', show: (pg, x) => errorStep(pg, x.cred), selector: '.deepen-error' },
  ];
  for (const mode of ['short', 'long'] as const) {
    for (const s of STATES) {
      it(`c. ${mode === 'short' ? '短卡' : '長卡捲到底'}:${s.id}字樣整塊在面板看得到的範圍裡${s.id === '生成中' ? ',「取消」點得到自己' : ''}`, async () => {
        await prepare(p(), mode);
        if (mode === 'long') await scrollToBottom(p());
        await s.show(p(), c());
        expect(await visibilityProblems(p(), s.selector), `${s.id}`).toEqual([]);
        if (s.id === '生成中') expect(await cancelReachable(p())).toEqual([]);
      });
    }
  }

  // ---- d:樣式不退步
  it('d. O1 樣式不退步:生成中、其他深入錯誤、最高的金鑰句——小字、1px var(--hud-line) 分隔線在字樣自己身上、祖先沒有框線;「取消」跟「下一個」同大小', async () => {
    await prepare(p(), 'short');
    await holdGenerating(p());
    await expectSystemLineStyle(p(), '.generating', '生成中那一行');
    await expectCancelSameSizeAsNext(p());
    await quiesce(p());
    for (const spec of [FAILED(c().messages), c().cred]) {
      await prepare(p(), 'short');
      await errorStep(p(), spec);
      await expectSystemLineStyle(p(), '.deepen-error', spec.label);
    }
  });

  // ---- e:直角引號
  it('e. 360 寬:其他深入錯誤那一句裡每一段「…」在同一行;捲動區沒有橫向捲動', async () => {
    await prepare(p(), 'short');
    await errorStep(p(), FAILED(c().messages));
    const f = await p().evaluate<QuoteFacts | null>(QUOTE_FACTS);
    expect(f, '量不到 .deepen-error').not.toBeNull();
    expect(f!.segments.length, '這一句要有「…」').toBeGreaterThan(0);
    expect(quoteProblems(f!), f!.text).toEqual([]);
  });

  it('e. 注入的句子(掃一串前綴把「深入這個」推到每一種折行位置):每一種都不被折斷、沒有橫向捲動', async () => {
    await prepare(p(), 'short');
    const bad: string[] = [];
    for (let n = 4; n <= 34; n += 1) {
      const message = `${'請'.repeat(n)}再按一次「深入這個」。`;
      await errorStep(p(), { kind: 'credential-unavailable', message, text: message, label: `前綴 ${n} 字` });
      const f = await p().evaluate<QuoteFacts | null>(QUOTE_FACTS);
      for (const problem of quoteProblems(f!)) bad.push(`前綴 ${n} 字:${problem}`);
    }
    expect(bad).toEqual([]);
  });

  it('e. 比一行還長的「…」可以折,但不准橫向凸出去', async () => {
    await prepare(p(), 'short');
    const message = `這裡有一段很長的詞「${'長'.repeat(60)}」要看會不會凸出去。`;
    await errorStep(p(), { kind: 'credential-unavailable', message, text: message, label: '長詞' });
    const f = await p().evaluate<QuoteFacts | null>(QUOTE_FACTS);
    expect(f!.segments[0]?.fits, '前提:這一段比一行長').toBe(false);
    expect(f!.overflowX, `scrollWidth ${f!.scrollWidth} > clientWidth ${f!.clientWidth}`).toBe(false);
  });

  it('e. 另外量:最高的金鑰句與其他深入錯誤,字樣裡沒有橫向捲動', async () => {
    await prepare(p(), 'short');
    for (const spec of [c().cred, FAILED(c().messages), NO_MODEL(c().messages), FLOOR(c().messages)]) {
      await errorStep(p(), spec);
      const f = await p().evaluate<QuoteFacts | null>(QUOTE_FACTS);
      expect(f!.overflowX, `${spec.label}:scrollWidth ${f!.scrollWidth} > clientWidth ${f!.clientWidth}`).toBe(false);
    }
  });

  // ---- f(沒有子卡)
  it('f. 沒有子卡那張:按「深入這個」,字樣出現後在同一個點再按一下(DOM 模擬):0 個 teach.cancel、還在生成中', async () => {
    await prepare(p(), 'short');
    const point = await p().evaluate<{ x: number; y: number }>(`(() => { const r = ${BUTTON('深入這個')}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await holdGenerating(p());
    const hit = await p().evaluate<string>(`(() => {
      const el = document.elementFromPoint(${point.x}, ${point.y});
      const b = el && el.closest('button');
      if (b) b.click();
      return b ? b.textContent.replace(/\\s+/g, '') + (b.disabled ? '(停用)' : '') : (el ? el.tagName + '.' + el.className : 'null');
    })()`);
    await sleep(600);
    const seen = await methods(p());
    expect(seen.filter((m) => m === 'teach.cancel'), `第二下落在「${hit}」;已送:${seen.join(',')}`).toEqual([]);
    expect(await p().evaluate<boolean>(`Boolean(document.querySelector('.generating'))`), '生成照跑').toBe(true);
  });
});

// ---------------------------------------------------------------- f(最深一層):真的生出一張子卡,所以自己一個 app(自己的暫存根)

describe('T45 渲染(f):最深一層那張雙擊「深入這個」', () => {
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

  it('f. 子卡上按「深入這個」得到最深一層字樣;在同一個點再按一下(DOM 模擬):0 個 teach.back、標題與層級沒換、字樣還在', async () => {
    const { ERROR_MESSAGES } = await protocol();
    await p().reset();
    await p().evaluate('(window.__t45.hold = false)');
    await clickButton(p(), '深入這個');
    expect(await waitFor(p(), `/來自:/.test(document.querySelector('.markers')?.textContent ?? '')`, 60_000), `深入之後要出現子卡;畫面文字:${await pageText(p())}`).toBe(true);
    expect(await waitFor(p(), `${BUTTON('回上一層')}`, 5000), '前提:子卡有「回上一層」').toBe(true);
    await sleep(300);
    const level = (): Promise<string> => p().evaluate<string>(`document.querySelector('.level')?.textContent ?? ''`);
    const titleBefore = await title(p());
    const levelBefore = await level();
    const point = await p().evaluate<{ x: number; y: number }>(`(() => { const r = ${BUTTON('深入這個')}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await p().evaluate('window.__t45.methods.length = 0');
    // 兩個:第二下如果真的按到「深入這個」,側車也要回最深一層(不然會真的生一張新卡)
    await injectError(p(), 'teach.deepen', 'deepen-floor', ERROR_MESSAGES['deepen-floor']!);
    await injectError(p(), 'teach.deepen', 'deepen-floor', ERROR_MESSAGES['deepen-floor']!);
    await clickButton(p(), '深入這個');
    expect(await waitFor(p(), `(document.querySelector('.deepen-error')?.textContent ?? '').trim() === ${JSON.stringify(ERROR_MESSAGES['deepen-floor'])}`, 6000), `最深一層的字樣要出現;畫面文字:${await pageText(p())}`).toBe(true);
    await sleep(150); // 真的人的第二下大約隔 0.12 秒
    const hit = await p().evaluate<string>(`(() => {
      const el = document.elementFromPoint(${point.x}, ${point.y});
      const b = el && el.closest('button');
      if (b) b.click();
      return b ? b.textContent.replace(/\\s+/g, '') + (b.disabled ? '(停用)' : '') : (el ? el.tagName + '.' + el.className : 'null');
    })()`);
    await sleep(800);
    const seen = await methods(p());
    expect(seen.filter((m) => m === 'teach.back'), `第二下落在「${hit}」;已送:${seen.join(',')}`).toEqual([]);
    expect(await title(p()), '標題沒換').toBe(titleBefore);
    expect(await level(), '層級沒換').toBe(levelBefore);
    expect(await p().evaluate<boolean>(`Boolean(document.querySelector('.deepen-error'))`), '最深一層的字樣還在').toBe(true);
    void GENERATING_MESSAGE;
  });
});
