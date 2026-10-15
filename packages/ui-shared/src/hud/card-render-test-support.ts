/**
 * 14-hud-skin phase-2(工單 T15)的渲染量測:headless Chrome 開兩張卡的 dev server,360 × 480,量像素與版面。
 * 測試 agent 寫;開發 worker 不改。給 vitest(`hud/card-render.test.ts`)與 cucumber(`hud-skin-phase2.steps.ts`)共用。
 *
 * 開法:`openApp(卡片目錄, …)`(render-test-support.ts 一般化的版本),傳**目錄路徑**,不 import 06、07 的模組。
 * 互動全走 DOM:填答案用原生 setter + input 事件(Svelte 的 bind:value 聽 input),點鍵用 `click()`。
 * 考試卡的答案從 `apps/test-card/src/stubs/fixtures.ts` 的文字裡讀(fs,不 import)。
 * 每項檢查都先 `page.reset()` 重新載入,檢查之間不互相影響。數值都在 card-design-values-test-support.ts。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CARD_DIRS, CARD_VIEWPORT, EXAMPLE_MIN_MARGIN_PX, HP_FILL_TOLERANCE_PX, HP_PERCENT_ONE_THIRD, NEXT_LABEL,
  PANEL_FILL_TOLERANCE_PX, RESULT_TEXT, SUBMIT_HIDDEN_AFTER_RESULT, SUBMIT_LABEL, type CardName,
} from './card-design-values-test-support.js';
import {
  ONE_PIXEL_INK, openApp, px, type GalleryPage, type Image, type Rect,
} from './render-test-support.js';
import { parseColor } from './test-support.js';

const READY: Record<CardName, string> = { 'teach-card': '.markers', 'test-card': '.prompt' };

export async function openCard(name: CardName): Promise<GalleryPage> {
  return openApp(CARD_DIRS[name], { viewport: CARD_VIEWPORT, ready: READY[name] });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 頁面裡輪詢到 predicate(JS 運算式字串)為真,最多 ms 毫秒;回傳有沒有等到 */
async function waitFor(page: GalleryPage, predicate: string, ms = 8000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate<boolean>(`Boolean(${predicate})`)) return true;
    await sleep(60);
  }
  return false;
}

// ───────────────────────────── 頁面裡用的 JS 片段
/** 面板裡「會捲」的那個元素(面板自己或它的後代,overflow-y 是 auto / scroll,取最高的);沒有回 null */
const SCROLL_AREA = `(() => {
  const panel = document.querySelector('[data-hud="panel"]');
  if (!panel) return null;
  const cands = [panel, ...panel.querySelectorAll('*')].filter((e) => {
    const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.clientHeight > 0;
  });
  cands.sort((a, b) => b.clientHeight - a.clientHeight);
  return cands[0] ?? null;
})()`;

const BUTTON_BY_TEXT = (label: string) => `[...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\\s+/g, '') === ${JSON.stringify(label)})`;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

// ───────────────────────────── 像素:只往內量的墨水量(視窗外面沒有像素)
/** points 由外往內排;底色取最內側那一點(面板色),1 像素純黑線 ≈ 1 */
export function inkInward(img: Image, points: [number, number][]): number {
  const lum = points.map(([x, y]) => { const [r, g, b] = px(img, x, y); return 0.2126 * r + 0.7152 * g + 0.0722 * b; });
  const ref = lum[lum.length - 1]!;
  if (ref <= 0) return Number.POSITIVE_INFINITY;
  return lum.reduce((s, l) => s + Math.max(0, ref - l) / ref, 0);
}

export function windowEdgeInk(img: Image, width: number, height: number): Record<'top' | 'bottom' | 'left' | 'right', number> {
  const cx = Math.round(width / 2); const cy = Math.round(height / 2);
  const n = 7;
  const line = (f: (i: number) => [number, number]) => Array.from({ length: n }, (_, i) => f(i));
  return {
    top: inkInward(img, line((i) => [cx, i])),
    bottom: inkInward(img, line((i) => [cx, height - 1 - i])),
    left: inkInward(img, line((i) => [i, cy])),
    right: inkInward(img, line((i) => [width - 1 - i, cy])),
  };
}

// ───────────────────────────── 驗收 5:面板撐滿視窗
export async function panelFillProblems(page: GalleryPage): Promise<string[]> {
  const problems: string[] = [];
  const has = await page.evaluate<boolean>(`Boolean(document.querySelector('[data-hud="panel"]'))`);
  if (!has) return ['畫面上沒有 [data-hud="panel"]'];
  const r = await page.rect('[data-hud="panel"]');
  const { width: W, height: H } = CARD_VIEWPORT;
  const want: [string, number, number][] = [['x', r.x, 0], ['y', r.y, 0], ['寬', r.width, W], ['高', r.height, H]];
  for (const [what, got, exp] of want) {
    if (Math.abs(got - exp) > PANEL_FILL_TOLERANCE_PX) problems.push(`面板的${what}是 ${got.toFixed(1)},要等於視窗的 ${exp}(±${PANEL_FILL_TOLERANCE_PX})`);
  }
  const doc = await page.evaluate<{ h: number; w: number }>(`({ h: document.scrollingElement.scrollHeight, w: document.scrollingElement.scrollWidth })`);
  if (doc.h > H) problems.push(`整頁會捲:scrollHeight ${doc.h} > ${H}(要捲的是面板裡面)`);
  if (doc.w > W) problems.push(`整頁會橫向捲:scrollWidth ${doc.w} > ${W}`);
  const img = await page.screenshot();
  for (const [edge, v] of Object.entries(windowEdgeInk(img, W, H))) {
    if (!(v >= ONE_PIXEL_INK[0] && v <= ONE_PIXEL_INK[1])) problems.push(`視窗${edge}邊的黑線往內量是 ${v.toFixed(2)} 像素,要 1 像素(線要就在視窗邊上)`);
  }
  return problems;
}

/** 內容比視窗長時,捲的是面板裡面(教學卡第一張有例子框的 fixture 卡) */
export async function scrollInsideProblems(page: GalleryPage): Promise<string[]> {
  const m = await page.evaluate<{ found: boolean; sh: number; ch: number; sw: number; cw: number } | null>(`(() => {
    const a = ${SCROLL_AREA};
    return a ? { found: true, sh: a.scrollHeight, ch: a.clientHeight, sw: a.scrollWidth, cw: a.clientWidth } : null;
  })()`);
  if (!m) return ['面板裡找不到會捲的區域(overflow-y: auto / scroll)'];
  const problems: string[] = [];
  if (!(m.sh > m.ch)) problems.push(`面板裡的捲動區沒有東西可捲:scrollHeight ${m.sh} ≤ clientHeight ${m.ch}(第一張卡比視窗長)`);
  if (m.sw > m.cw) problems.push(`捲動區有東西往橫向凸出去:scrollWidth ${m.sw} > clientWidth ${m.cw}`);
  return problems;
}

// ───────────────────────────── 驗收 6:例子框邊距
export async function exampleMarginProblems(page: GalleryPage): Promise<string[]> {
  const m = await page.evaluate<{ area: boolean; examples: { left: number; right: number }[]; a: { left: number; right: number } } | null>(`(() => {
    const a = ${SCROLL_AREA};
    const ex = [...document.querySelectorAll('.lc-example')];
    if (!a) return { area: false, examples: ex.map(() => ({ left: 0, right: 0 })), a: { left: 0, right: 0 } };
    const r = a.getBoundingClientRect();
    const left = r.left + a.clientLeft; const right = left + a.clientWidth;
    return { area: true, a: { left, right }, examples: ex.map((e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right }; }) };
  })()`);
  if (!m) return ['量不到'];
  const problems: string[] = [];
  if (!m.area) problems.push('面板裡找不到會捲的區域,量不到例子框邊距');
  if (m.examples.length === 0) problems.push('第一張卡裡沒有 .lc-example(要有例子框才量得到邊距)');
  m.examples.forEach((e, i) => {
    const l = e.left - m.a.left; const r = m.a.right - e.right;
    if (l < EXAMPLE_MIN_MARGIN_PX) problems.push(`第 ${i + 1} 個例子框左邊離捲動區 ${l.toFixed(1)} 像素,要 ≥ ${EXAMPLE_MIN_MARGIN_PX}`);
    if (r < EXAMPLE_MIN_MARGIN_PX) problems.push(`第 ${i + 1} 個例子框右邊離捲動區 ${r.toFixed(1)} 像素,要 ≥ ${EXAMPLE_MIN_MARGIN_PX}`);
  });
  return problems;
}

// ───────────────────────────── 考試卡:fixture 答案與操作
/** 從 stubs/fixtures.ts 的文字讀出每個填空題的「提示 → 每格第一個可接受寫法」;fs 讀,不 import */
export function fixtureFillAnswers(): Map<string, string[]> {
  const text = readFileSync(join(CARD_DIRS['test-card'], 'src/stubs/fixtures.ts'), 'utf8');
  const out = new Map<string, string[]>();
  for (const m of text.matchAll(/- prompt: "([^"]*)"\n\s+answers:\n((?:\s+- \[[^\n]*\]\n)+)/g)) {
    const answers = m[2]!.split('\n').filter((l) => l.trim().startsWith('- [')).map((l) => (JSON.parse(l.trim().slice(2)) as string[])[0]!);
    out.set(m[1]!, answers);
  }
  return out;
}

async function setValue(page: GalleryPage, selector: string, index: number, value: string): Promise<void> {
  const ok = await page.evaluate<boolean>(`(() => {
    const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!e) return false;
    const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)});
    e.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`畫面上找不到 ${selector} 第 ${index + 1} 個`);
}

async function click(page: GalleryPage, label: string): Promise<void> {
  const ok = await page.evaluate<boolean>(`(() => { const b = ${BUTTON_BY_TEXT(label)}; if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`畫面上找不到字是「${label}」的按鈕`);
}

/** 目前題目的題型與提示 */
async function currentQuestion(page: GalleryPage): Promise<{ prompt: string; inputs: number; textareas: number }> {
  return page.evaluate(`({
    prompt: (document.querySelector('.prompt')?.textContent ?? '').trim(),
    inputs: document.querySelectorAll('input[type="text"]').length,
    textareas: document.querySelectorAll('textarea').length,
  })`);
}

/** 把目前這一題填好(wrong = true 填錯的)。回傳是填空題還是應用題 */
export async function fillCurrent(page: GalleryPage, wrong = false): Promise<'fill' | 'apply'> {
  const q = await currentQuestion(page);
  if (q.textareas > 0) { await setValue(page, 'textarea', 0, wrong ? '' : '我的答案'); return 'apply'; }
  const answers = fixtureFillAnswers().get(q.prompt);
  if (!answers) throw new Error(`fixture 裡找不到這一題的答案:${q.prompt}`);
  for (let i = 0; i < q.inputs; i += 1) await setValue(page, 'input[type="text"]', i, wrong ? '完全不對的答案' : (answers[i] ?? ''));
  return 'fill';
}

const PROGRESS = 'header.progress';
export const progressText = (page: GalleryPage) =>
  page.evaluate<string>(`(document.querySelector(${JSON.stringify(PROGRESS)})?.innerText ?? '').replace(/\\s+/g, ' ').trim()`);

const RESULT_SHOWN = `/答對了|答錯了/.test(document.body.innerText)`;

/** 填好 → 點「送出」→ 等到結果 */
export async function submitCurrent(page: GalleryPage, wrong = false): Promise<void> {
  await fillCurrent(page, wrong);
  await click(page, SUBMIT_LABEL);
  if (!(await waitFor(page, RESULT_SHOWN))) throw new Error('點了「送出」之後 8 秒內沒有出現結果');
}

/** 答完一個到期項目(一題或兩題):送出、下一題,直到進度的第一個數字加一 */
export async function answerOneItem(page: GalleryPage, wrong = false): Promise<void> {
  const before = Number(/^(\d+)/.exec(await progressText(page))?.[1] ?? NaN);
  if (Number.isNaN(before)) throw new Error(`讀不到進度(${PROGRESS} 裡的字:${await progressText(page)})`);
  for (let i = 0; i < 4; i += 1) {
    await submitCurrent(page, wrong);
    await click(page, NEXT_LABEL);
    await sleep(120);
    const now = Number(/^(\d+)/.exec(await progressText(page))?.[1] ?? NaN);
    if (now > before) return;
  }
  throw new Error('連答 4 題進度還沒加一');
}

// ───────────────────────────── 驗收 3:HP 條
export async function hpBarProblems(page: GalleryPage): Promise<string[]> {
  const problems: string[] = [];
  const bar = `document.querySelector('${PROGRESS} [data-hud="hp-bar"]')`;
  const read = () => page.evaluate<{ percent: string | null; role: string | null } | null>(`(() => { const b = ${bar}; return b ? { percent: b.getAttribute('data-percent'), role: b.getAttribute('role') } : null; })()`);
  const first = await read();
  if (!first) return [`${PROGRESS} 裡沒有 [data-hud="hp-bar"]`];
  if (Number(first.percent) !== 0) problems.push(`剛載入 data-percent 是 ${first.percent},要 0`);
  const t0 = await progressText(page);
  if (!/(^|\s)0 \/ 3(\s|$)/.test(t0)) problems.push(`剛載入進度那一區的字是「${t0}」,要含「0 / 3」`);

  await answerOneItem(page);
  const after = await read();
  if (!after) return [...problems, '答完一題之後 HP 條不見了'];
  const pct = Number(after.percent);
  if (!(pct >= HP_PERCENT_ONE_THIRD[0] && pct <= HP_PERCENT_ONE_THIRD[1])) problems.push(`答完一題 data-percent 是 ${after.percent},要在 ${HP_PERCENT_ONE_THIRD[0]}–${HP_PERCENT_ONE_THIRD[1]}`);
  const t1 = await progressText(page);
  if (norm(t1) !== '1 / 3' && !/(^|\s)1 \/ 3(\s|$)/.test(t1)) problems.push(`答完一題進度那一區的字是「${t1}」,要含「1 / 3」`);

  // 畫出來:HP 條正中間那一列,綠色那一段 ≈ 內寬的 1/3
  const r = await page.rect(`${PROGRESS} [data-hud="hp-bar"]`);
  const hp = parseColor((await page.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue('--hud-hp').trim()`)) || '#2f9e44');
  const line = parseFloat(await page.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue('--hud-line-width')`)) || 1;
  const img = await page.screenshot();
  const y = Math.round(r.y + r.height / 2);
  let green = 0;
  for (let x = Math.ceil(r.x); x < Math.floor(r.x + r.width); x += 1) {
    const [pr, pg, pb] = px(img, x, y);
    if (Math.abs(pr - hp.r) <= 28 && Math.abs(pg - hp.g) <= 28 && Math.abs(pb - hp.b) <= 28) green += 1;
  }
  const inner = r.width - 2 * line;
  const want = inner / 3;
  if (Math.abs(green - want) > HP_FILL_TOLERANCE_PX) problems.push(`HP 條中間那一列的綠色有 ${green} 像素,內寬 ${inner.toFixed(0)} 的 1/3 是 ${want.toFixed(1)}(±${HP_FILL_TOLERANCE_PX})`);
  return problems;
}

// ───────────────────────────── 驗收 7:送出鍵不捲動就看得到
export async function submitVisibleProblems(page: GalleryPage): Promise<string[]> {
  const m = await page.evaluate<{ found: boolean; rect?: Rect; area?: Rect | null; scrollTop?: number; topEl?: boolean } | null>(`(() => {
    const b = ${BUTTON_BY_TEXT(SUBMIT_LABEL)};
    if (!b) return { found: false };
    const r = b.getBoundingClientRect();
    const a = ${SCROLL_AREA};
    const ar = a ? (() => { const q = a.getBoundingClientRect(); return { x: q.left + a.clientLeft, y: q.top + a.clientTop, width: a.clientWidth, height: a.clientHeight }; })() : null;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { found: true, rect: { x: r.left, y: r.top, width: r.width, height: r.height }, area: ar, scrollTop: a ? a.scrollTop : 0, topEl: Boolean(hit && (hit === b || b.contains(hit))) };
  })()`);
  if (!m?.found) return [`畫面上找不到字是「${SUBMIT_LABEL}」的按鈕`];
  const problems: string[] = [];
  const r = m.rect!;
  const { width: W, height: H } = CARD_VIEWPORT;
  if (r.x < 0 || r.y < 0 || r.x + r.width > W || r.y + r.height > H) problems.push(`「${SUBMIT_LABEL}」不在視窗裡:x ${r.x.toFixed(0)} y ${r.y.toFixed(0)} 寬 ${r.width.toFixed(0)} 高 ${r.height.toFixed(0)}(視窗 ${W} × ${H})`);
  if (m.area) {
    const a = m.area;
    if (r.x < a.x || r.y < a.y || r.x + r.width > a.x + a.width || r.y + r.height > a.y + a.height) problems.push(`「${SUBMIT_LABEL}」在捲動區看得到的範圍外(要捲動才看得到)`);
  }
  if ((m.scrollTop ?? 0) !== 0) problems.push(`捲動區已經捲了 ${m.scrollTop}(量的時候不該捲過)`);
  if (!m.topEl) problems.push(`「${SUBMIT_LABEL}」正中心那一點被別的東西蓋住`);
  return problems;
}

// ───────────────────────────── 驗收 2:送出鍵的出現時機與 Enter
export async function submitLifecycleProblems(page: GalleryPage): Promise<string[]> {
  const problems: string[] = [];
  const has = (label: string) => page.evaluate<boolean>(`Boolean(${BUTTON_BY_TEXT(label)})`);
  if (!(await has(SUBMIT_LABEL))) return [`題目顯示中沒有「${SUBMIT_LABEL}」鍵`];
  if (await has(NEXT_LABEL)) problems.push(`還沒送出就有「${NEXT_LABEL}」`);
  await submitCurrent(page);
  if (SUBMIT_HIDDEN_AFTER_RESULT && (await has(SUBMIT_LABEL))) problems.push(`看到結果之後「${SUBMIT_LABEL}」還在(只剩「${NEXT_LABEL}」)`);
  if (!(await has(NEXT_LABEL))) problems.push(`看到結果之後沒有「${NEXT_LABEL}」`);
  return problems;
}

/** Enter 照舊能送出(鍵盤路徑不動) */
export async function enterKeyProblems(page: GalleryPage): Promise<string[]> {
  const q = await currentQuestion(page);
  if (q.textareas > 0) return ['第一題不是填空題,量不到 Enter'];
  await fillCurrent(page);
  await page.evaluate(`document.querySelector('input[type="text"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
  return (await waitFor(page, RESULT_SHOWN)) ? [] : ['填好之後在輸入框按 Enter,8 秒內沒有出現結果'];
}

// ───────────────────────────── 驗收 2:對錯不只靠顏色(畫出來量)
interface ResultSnapshot { text: string | null; attr: string | null; count: number }
async function readResult(page: GalleryPage): Promise<ResultSnapshot> {
  return page.evaluate(`(() => { const e = document.querySelectorAll('[data-result]'); const f = e[0];
    return { count: e.length, text: f ? f.innerText : null, attr: f ? f.getAttribute('data-result') : null }; })()`);
}

/**
 * 一題填 fixture 的正確答案、一題填錯的,各讀 [data-result] 的 innerText:剛好是「✓ 答對了」「× 答錯了」,兩者不同。
 * 再把 --hud-pass 與 --hud-fail 換成同一個顏色,字樣照樣分得出對錯。
 */
export async function resultTextProblems(page: GalleryPage): Promise<string[]> {
  const problems: string[] = [];
  const got: Record<'pass' | 'fail', ResultSnapshot> = { pass: { text: null, attr: null, count: 0 }, fail: { text: null, attr: null, count: 0 } };
  for (const kind of ['pass', 'fail'] as const) {
    await page.reset();
    await submitCurrent(page, kind === 'fail');
    got[kind] = await readResult(page);
    const g = got[kind];
    if (g.count !== 1) problems.push(`${kind === 'pass' ? '答對' : '答錯'}時帶 data-result 的元素有 ${g.count} 個,要剛好 1 個`);
    else {
      if (g.attr !== kind) problems.push(`${kind === 'pass' ? '答對' : '答錯'}時 data-result 是「${g.attr}」,要是「${kind}」`);
      if (g.text !== RESULT_TEXT[kind]) problems.push(`${kind === 'pass' ? '答對' : '答錯'}時看得到的字是「${g.text}」,要剛好是「${RESULT_TEXT[kind]}」`);
    }
    if (kind === 'fail') {
      // 兩個顏色換成同一個,字樣不能變(對錯靠字樣分得出來,不只靠顏色)
      await page.evaluate(`(() => { const s = document.createElement('style'); s.textContent = ':root { --hud-pass: #000000 !important; --hud-fail: #000000 !important; }'; document.head.append(s); return true; })()`);
      const same = await readResult(page);
      if (same.text !== g.text) problems.push(`把 --hud-pass 與 --hud-fail 換成同一色後,字樣變了:「${same.text}」`);
    }
  }
  if (got.pass.text !== null && got.pass.text === got.fail.text) problems.push('答對與答錯看得到的字一樣,只剩顏色不同');
  return problems;
}

/** 評分失敗不是對錯結果:這裡只確認「答對 / 答錯」之外的狀態不帶 data-result(開頭、題目顯示中) */
export async function noResultBeforeSubmitProblems(page: GalleryPage): Promise<string[]> {
  const r = await readResult(page);
  return r.count === 0 ? [] : [`還沒送出就有 ${r.count} 個 data-result 元素`];
}
