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
  ACCENT_CHANNEL_TOLERANCE, ACCENT_MIN_PIXELS, CARD_DIRS, CARD_VIEWPORT, CUT_CORNER_TOLERANCE, EXAMPLE_BORDER_LEFT_PX, EXAMPLE_MIN_MARGIN_PX, FACE_CHANNEL_TOLERANCE, FACE_TEST_BACKDROP, FACE_TEST_PANEL, HP_FILL_TOLERANCE_PX, HP_PERCENT_ONE_THIRD, NEXT_LABEL,
  FIELD_HOVER_MAX_DIFF_PIXELS, OUTER_RING_MAX_ACCENT_PIXELS, OUTER_RING_MAX_PX, OUTER_RING_MIN_PX,
  PANEL_FILL_TOLERANCE_PX, RESULT_TEXT, SUBMIT_FIELD_MIN_GAP_PX, SUBMIT_HIDDEN_AFTER_RESULT, SUBMIT_LABEL, TEXTAREA_MIN_ROWS,
  TEXTAREA_RESIZE, type CardName,
} from './card-design-values-test-support.js';
import {
  ONE_PIXEL_INK, differingPixels, edgeInk, openApp, px, type GalleryPage, type Image, type Rect,
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

// ───────────────────────────── 第二輪(O1–O4)
/** 一直答到出現應用題(textarea)為止;最多 8 次 */
export async function gotoApply(page: GalleryPage): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    if ((await currentQuestion(page)).textareas > 0) return;
    await submitCurrent(page);
    await click(page, NEXT_LABEL);
    await sleep(150);
  }
  throw new Error('答了 8 次還沒有出現應用題');
}

/** 量內部像素的目標:一組元素(運算式回傳陣列)與說明 */
interface FaceTarget { label: string; elements: string }
const FIELDS: FaceTarget = { label: '作答欄', elements: `[...document.querySelectorAll('[data-hud="field"]')]` };
const buttonNamed = (label: string): FaceTarget => ({ label: `「${label}」鍵`, elements: `[${BUTTON_BY_TEXT(label)}].filter(Boolean)` });

/**
 * O1(第三輪):目標元素的內部(取樣點避開字)每個像素 = 測試用的半透明 --hud-panel 疊在「把目標藏起來之後」同一點的像素上。
 * 做法:疊測試覆寫(--hud-panel 換半透明紅、頁面背景換深色)→ 截圖 → 目標設 visibility: hidden 再截一次當「後面」→ 逐點比對。
 * 寫死的白(#fff)、灰 230、或半透明疊在黑底上都會對不上;跟著 --hud-panel 走的內部才對得上。
 */
async function faceProblems(page: GalleryPage, what: string, targets: FaceTarget[]): Promise<string[]> {
  const T = FACE_TEST_PANEL;
  await page.evaluate(`(() => { document.activeElement?.blur?.(); const s = document.createElement('style');
    s.textContent = ':root { --hud-panel: rgba(${T.r}, ${T.g}, ${T.b}, ${T.a}) !important; } html { background: ${FACE_TEST_BACKDROP} !important; }';
    document.head.append(s); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`);
  const probes = await page.evaluate<{ label: string; points: [number, number][] }[]>(`(() => {
    const out = [];
    for (const t of ${JSON.stringify(targets.map((t) => ({ label: t.label })))}) out.push({ label: t.label, points: [] });
    const lists = [${targets.map((t) => t.elements).join(', ')}];
    for (const els of lists) for (const e of els) e.scrollIntoView({ block: 'nearest' }); // 在捲動區下面的鍵(教學卡的「下一個」)先捲進來
    lists.forEach((els, i) => {
      for (const e of els) {
        e.setAttribute('data-zz-face', '');
        const b = e.getBoundingClientRect(); const cy = b.y + b.height / 2;
        const isField = e.getAttribute('data-hud') === 'field';
        const xs = isField ? [0.3, 0.5, 0.7].map((f) => b.x + b.width * f) : [b.x + 6, b.x + 8, b.x + b.width - 8, b.x + b.width - 6];
        for (const x of xs) out[i].points.push([x, cy]);
      }
    });
    return out;
  })()`);
  await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'); // 捲動之後等畫面更新
  const withTargets = await page.screenshot();
  await page.evaluate(`(() => { const s = document.createElement('style'); s.id = 'zz-hide'; s.textContent = '[data-zz-face] { visibility: hidden !important; }'; document.head.append(s);
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`);
  const behind = await page.screenshot();
  await page.evaluate(`(() => { document.getElementById('zz-hide')?.remove(); document.querySelectorAll('[data-zz-face]').forEach((e) => e.removeAttribute('data-zz-face')); return true; })()`);
  const problems: string[] = [];
  for (const pr of probes) {
    if (pr.points.length === 0) { problems.push(`${what}:畫面上找不到${pr.label}`); continue; }
    let bad = 0;
    for (const [x, y] of pr.points) {
      const got = px(withTargets, x, y); const bg = px(behind, x, y);
      const want = [T.r, T.g, T.b].map((c, i) => Math.round(c * T.a + bg[i]! * (1 - T.a)));
      if (got.some((v, i) => Math.abs(v - want[i]!) > FACE_CHANNEL_TOLERANCE)) {
        bad += 1;
        if (bad === 1) problems.push(`${what}:${pr.label}內部 (${Math.round(x)},${Math.round(y)}) 是 rgb(${got.join(',')}),半透明 --hud-panel 疊在後面 rgb(${bg.join(',')}) 上應該約 rgb(${want.join(',')})`);
      }
    }
  }
  return problems;
}

/** 考試卡:填空題的每個作答欄與「送出」鍵、應用題的作答欄與「送出」鍵、看到結果後的「下一題」鍵 */
export async function testCardFaceProblems(page: GalleryPage): Promise<string[]> {
  const problems: string[] = [];
  // 每個階段都用同一個頁面;覆寫疊在頁面上,之後的步驟仍然看得到
  problems.push(...(await faceProblems(page, '填空題', [FIELDS, buttonNamed(SUBMIT_LABEL)])));
  await gotoApply(page);
  problems.push(...(await faceProblems(page, '應用題', [FIELDS, buttonNamed(SUBMIT_LABEL)])));
  await submitCurrent(page);
  problems.push(...(await faceProblems(page, '看到結果後', [buttonNamed(NEXT_LABEL)])));
  return problems;
}

/** 教學卡:「下一個」鍵 */
export async function teachCardFaceProblems(page: GalleryPage): Promise<string[]> {
  return faceProblems(page, '教學卡', [buttonNamed('下一個')]);
}

/** O2:應用題 textarea 的 resize 是 none,至少五行高(06 phase-1「應用題至少五行高」不退步) */
export async function textareaProblems(page: GalleryPage): Promise<string[]> {
  await gotoApply(page);
  const m = await page.evaluate<{ resize: string; rows: number; height: number; line: number }>(`(() => { const t = document.querySelector('textarea'); const s = getComputedStyle(t);
    const lh = parseFloat(s.lineHeight); return { resize: s.resize, rows: t.rows, height: t.clientHeight, line: Number.isNaN(lh) ? parseFloat(s.fontSize) * 1.2 : lh }; })()`);
  const problems: string[] = [];
  if (m.resize !== TEXTAREA_RESIZE) problems.push(`textarea 的 resize 是「${m.resize}」,要是「${TEXTAREA_RESIZE}」(縮放把手會壓在切角線上)`);
  if (m.rows < TEXTAREA_MIN_ROWS) problems.push(`textarea 的 rows 是 ${m.rows},要 ≥ ${TEXTAREA_MIN_ROWS}`);
  if (m.height < TEXTAREA_MIN_ROWS * m.line - 1) problems.push(`textarea 內高 ${m.height}px,不到 ${TEXTAREA_MIN_ROWS} 行(行高 ${m.line.toFixed(1)}px)`);
  return problems;
}

/** O3:「送出」鍵上緣離上方作答欄外框下緣 ≥ 8 像素;填空與應用題各量一次 */
export async function submitGapProblems(page: GalleryPage): Promise<string[]> {
  const problems: string[] = [];
  const gap = (what: string) => page.evaluate<number | null>(`(() => { const b = ${BUTTON_BY_TEXT(SUBMIT_LABEL)}; if (!b) return null;
    const top = b.getBoundingClientRect().top;
    const above = [...document.querySelectorAll('[data-hud="field"]')].map((f) => f.getBoundingClientRect().bottom).filter((v) => v <= top + 1);
    return above.length ? top - Math.max(...above) : null; })()`).then((g) => {
    if (g === null) problems.push(`${what}:找不到「${SUBMIT_LABEL}」或它上方的作答欄`);
    else if (g < SUBMIT_FIELD_MIN_GAP_PX) problems.push(`${what}:「${SUBMIT_LABEL}」離上方作答欄 ${g.toFixed(1)} 像素,要 ≥ ${SUBMIT_FIELD_MIN_GAP_PX}`);
  });
  await gap('填空題');
  await gotoApply(page);
  await gap('應用題');
  return problems;
}

/** O4:教學卡例子框左邊那條線是 1 像素(跟面板的細黑線一致) */
export async function exampleBorderProblems(page: GalleryPage): Promise<string[]> {
  const m = await page.evaluate<{ width: string; style: string; colour: string }[]>(`[...document.querySelectorAll('.lc-example')].map((e) => { const s = getComputedStyle(e); return { width: s.borderLeftWidth, style: s.borderLeftStyle, colour: s.borderLeftColor }; })`);
  const line = parseColor(await page.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue('--hud-line')`));
  if (m.length === 0) return ['第一張卡裡沒有 .lc-example'];
  const problems: string[] = [];
  m.forEach((e, i) => {
    if (e.width !== `${EXAMPLE_BORDER_LEFT_PX}px`) problems.push(`第 ${i + 1} 個例子框的 border-left-width 是 ${e.width},要 ${EXAMPLE_BORDER_LEFT_PX}px`);
    if (e.style === 'none') problems.push(`第 ${i + 1} 個例子框的 border-left-style 是 none(線不見了)`);
    // 線要看得見而且是黑線(--hud-line):transparent 的線寬度與樣式都對,但畫面上沒有線
    const c = parseColor(e.colour);
    if (c.a !== 1 || c.r !== line.r || c.g !== line.g || c.b !== line.b) problems.push(`第 ${i + 1} 個例子框的 border-left-color 是 ${e.colour},要是不透明的 --hud-line(rgb(${line.r}, ${line.g}, ${line.b}))`);
  });
  return problems;
}

// ───────────────────────────── 第四輪:hover / focus 不能把切角填成方塊、不能多一圈方框
export const STATE_ATTR = 'data-zz-state';
/** 目標元素的運算式;kind 決定要強制哪些偽類 */
export interface ShapeTarget { label: string; element: string; kind: 'button' | 'field' }
const cardButton = (label: string): ShapeTarget => ({ label: `「${label}」鍵`, element: BUTTON_BY_TEXT(label), kind: 'button' });
const lastField: ShapeTarget = { label: '作答欄', element: `(() => { const a = document.querySelectorAll('[data-hud="field"]'); return a[a.length - 1]; })()`, kind: 'field' };

/**
 * 「橘色」:1 像素的橘線落在小數像素位置時會被抗鋸齒稀釋成淡橘,所以不比「等於 --hud-accent」,
 * 比「明顯偏橘」:R 夠大、R−B 夠大、G 介於 B 與 R 之間(白、黑、灰、淡橘底 accent-wash(R−B≈27)都不算)。
 */
export function isOrangeish([r, g, b]: [number, number, number]): boolean {
  return r >= 200 && r - b >= 60 && g > b && g < r;
}
const nearAccent = (c: [number, number, number], _accent: { r: number; g: number; b: number }) => isOrangeish(c);

export function cropImage(img: Image, r: Rect): Image {
  const x0 = Math.max(0, Math.floor(r.x)); const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.width, Math.ceil(r.x + r.width)); const y1 = Math.min(img.height, Math.ceil(r.y + r.height));
  const w = Math.max(0, x1 - x0); const h = Math.max(0, y1 - y0);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const s = ((y0 + y) * img.width + x0 + x) * 4; const d = (y * w + x) * 4;
    for (let k = 0; k < 4; k += 1) data[d + k] = img.data[s + k]!;
  }
  return { width: w, height: h, data };
}

/**
 * 目標在 hover / focus 下:
 * (a) 被切掉的角(平常就等於後面背景的那幾個角)外側的小三角形像素,仍然等於後面的背景(不能被橘色填成方塊);
 * (b) 矩形外面 2–4 像素那一圈沒有橘色(不能有方形 outline);
 * (c) 橘色還在(矩形外擴 1 像素範圍內至少 ACCENT_MIN_PIXELS 個接近 --hud-accent 的像素)。
 * 「後面」= 把目標藏起來截的圖。強制偽類用 CDP(CSS.forcePseudoState),不送滑鼠鍵盤、不插 <style> 以外的東西。
 */
export async function stateShapeProblems(page: GalleryPage, t: ShapeTarget, states: { name: string; list: string[] }[]): Promise<string[]> {
  const problems: string[] = [];
  const accent = parseColor(await page.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue('--hud-accent')`));
  const rect = await page.evaluate<Rect | null>(`(() => { document.activeElement?.blur?.(); const e = ${t.element}; if (!e) return null;
    e.scrollIntoView({ block: 'nearest' }); e.setAttribute('${STATE_ATTR}', '');
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => { const b = e.getBoundingClientRect(); r({ x: b.x, y: b.y, width: b.width, height: b.height }); }))); })()`);
  if (!rect) return [`${t.label}:畫面上找不到`];
  const L = Math.floor(rect.x); const T = Math.floor(rect.y); const R = Math.ceil(rect.x + rect.width) - 1; const B = Math.ceil(rect.y + rect.height) - 1;
  const hideStyle = `(() => { const s = document.createElement('style'); s.id = 'zz-hide-state'; s.textContent = '[${STATE_ATTR}] { visibility: hidden !important; }'; document.head.append(s);
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`;
  await page.evaluate(hideStyle);
  const behind = await page.screenshot();
  await page.evaluate(`(() => { document.getElementById('zz-hide-state')?.remove(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`);
  const normal = await page.screenshot();
  // 平常狀態:四條直邊的黑線在小數像素位置仍是完整的 1 像素(線不被偽元素盒子裁掉)
  for (const [edge, v] of Object.entries(edgeInk(normal, rect))) {
    if (!(v >= ONE_PIXEL_INK[0] && v <= ONE_PIXEL_INK[1])) problems.push(`${t.label}:${edge}邊黑線量起來是 ${v.toFixed(2)} 像素(元件在 x=${rect.x.toFixed(2)} y=${rect.y.toFixed(2)}),要 1 像素`);
  }
  const near = [[1, 1], [2, 1], [1, 2], [3, 1], [1, 3], [2, 2]] as const;
  const corners: [string, (a: number, b: number) => [number, number]][] = [
    ['左上', (a, b) => [L + a - 1, T + b - 1]], ['右上', (a, b) => [R - a + 1, T + b - 1]],
    ['左下', (a, b) => [L + a - 1, B - b + 1]], ['右下', (a, b) => [R - a + 1, B - b + 1]],
  ];
  const diff = (x: number, y: number, a: Image, b: Image) => { const p = px(a, x, y); const q = px(b, x, y); return Math.max(...p.map((v, i) => Math.abs(v - q[i]!))); };
  // 平常就切掉的角:每個點都等於後面
  const cutCorners = corners.filter(([, at]) => near.every(([a, b]) => { const [x, y] = at(a, b); return diff(x, y, normal, behind) <= CUT_CORNER_TOLERANCE; }));
  if (cutCorners.length < 2) problems.push(`${t.label}:平常狀態只有 ${cutCorners.length} 個角被切掉(要至少 2 個),量不了 hover / focus`);

  for (const st of states) {
    const sel = t.kind === 'field' ? `[${STATE_ATTR}]` : `[${STATE_ATTR}]`;
    await page.forceState(sel, 0, st.list.filter((s) => s === 'focus-within' || s === 'hover' || t.kind === 'button'));
    if (t.kind === 'field' && st.list.includes('focus')) await page.forceState(`[${STATE_ATTR}] input, [${STATE_ATTR}] textarea`, 0, ['focus', 'focus-visible']);
    const shot = await page.screenshot();
    for (const [name, at] of cutCorners) {
      for (const [a, b] of near) {
        const [x, y] = at(a, b);
        const d = diff(x, y, shot, behind);
        if (d > CUT_CORNER_TOLERANCE) { problems.push(`${t.label} ${st.name}:${name}切角外側 (${x},${y}) 是 rgb(${px(shot, x, y).join(',')}),後面是 rgb(${px(behind, x, y).join(',')})(切角被填滿了)`); break; }
      }
    }
    // 外圈 2–4 像素:沒有橘色
    let ring = 0; let first = '';
    for (let y = T - OUTER_RING_MAX_PX; y <= B + OUTER_RING_MAX_PX; y += 1) for (let x = L - OUTER_RING_MAX_PX; x <= R + OUTER_RING_MAX_PX; x += 1) {
      if (x < 0 || y < 0 || x >= shot.width || y >= shot.height) continue;
      const dist = Math.max(L - x, x - R, T - y, y - B);
      if (dist < OUTER_RING_MIN_PX || dist > OUTER_RING_MAX_PX) continue;
      if (nearAccent(px(shot, x, y), accent)) { ring += 1; if (!first) first = `(${x},${y})`; }
    }
    if (ring > OUTER_RING_MAX_ACCENT_PIXELS) problems.push(`${t.label} ${st.name}:矩形外 ${OUTER_RING_MIN_PX}–${OUTER_RING_MAX_PX} 像素那一圈有 ${ring} 個橘色像素(例如 ${first}),不能有方形 outline`);
    // 橘色還在
    let inside = 0;
    for (let y = T - 1; y <= B + 1; y += 1) for (let x = L - 1; x <= R + 1; x += 1) {
      if (x < 0 || y < 0 || x >= shot.width || y >= shot.height) continue;
      if (x > L + 3 && x < R - 3 && y > T + 3 && y < B - 3) continue; // 字的次像素抗鋸齒會有橘色邊,只數貼邊的一圈
      if (nearAccent(px(shot, x, y), accent)) inside += 1;
    }
    if (inside < ACCENT_MIN_PIXELS) problems.push(`${t.label} ${st.name}:橘色只剩 ${inside} 個像素,要 ≥ ${ACCENT_MIN_PIXELS}(hover / focus 的橘色不能拿掉)`);
    await page.forceState(sel, 0, []);
    if (t.kind === 'field') await page.forceState(`[${STATE_ATTR}] input, [${STATE_ATTR}] textarea`, 0, []);
  }
  await page.evaluate(`(() => { document.querySelectorAll('[${STATE_ATTR}]').forEach((e) => e.removeAttribute('${STATE_ATTR}')); return true; })()`);
  return problems;
}

export const BUTTON_STATES = [{ name: 'hover', list: ['hover'] }, { name: 'focus-visible', list: ['focus', 'focus-visible'] }];
export const FIELD_STATES = [{ name: 'focus-within', list: ['focus-within', 'focus'] }];

/** 教學卡「下一個」(在捲動區下面、x 是小數像素) */
export async function teachShapeProblems(page: GalleryPage): Promise<string[]> {
  return stateShapeProblems(page, cardButton('下一個'), BUTTON_STATES);
}

/** 考試卡:填空題的「送出」與最後一個作答欄、應用題的「送出」與 textarea 的欄位、結果後的「下一題」 */
export async function testShapeProblems(page: GalleryPage): Promise<string[]> {
  const problems: string[] = [];
  problems.push(...(await stateShapeProblems(page, cardButton(SUBMIT_LABEL), BUTTON_STATES)).map((p) => `填空題 ${p}`));
  problems.push(...(await stateShapeProblems(page, lastField, FIELD_STATES)).map((p) => `填空題 ${p}`));
  await gotoApply(page);
  problems.push(...(await stateShapeProblems(page, cardButton(SUBMIT_LABEL), BUTTON_STATES)).map((p) => `應用題 ${p}`));
  problems.push(...(await stateShapeProblems(page, lastField, FIELD_STATES)).map((p) => `應用題 ${p}`));
  await submitCurrent(page);
  problems.push(...(await stateShapeProblems(page, cardButton(NEXT_LABEL), BUTTON_STATES)).map((p) => `結果後 ${p}`));
  return problems;
}

/** 作答欄沒有 hover 樣式:滑鼠移到作答欄(與裡面的輸入框)上,外觀不變 */
export async function fieldHoverProblems(page: GalleryPage): Promise<string[]> {
  const rect = await page.evaluate<Rect | null>(`(() => { document.activeElement?.blur?.(); const e = (${lastField.element}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); e.setAttribute('${STATE_ATTR}', '');
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => { const b = e.getBoundingClientRect(); r({ x: b.x, y: b.y, width: b.width, height: b.height }); }))); })()`);
  if (!rect) return ['畫面上找不到作答欄'];
  const box = { x: rect.x - 6, y: rect.y - 6, width: rect.width + 12, height: rect.height + 12 };
  const normal = cropImage(await page.screenshot(), box);
  // CDP 一次只留最後一個被強制的節點,所以欄位本身與裡面的輸入框分兩次量
  let d = 0;
  for (const target of [`[${STATE_ATTR}]`, `[${STATE_ATTR}] input, [${STATE_ATTR}] textarea`]) {
    await page.forceState(target, 0, ['hover']);
    d = Math.max(d, differingPixels(normal, cropImage(await page.screenshot(), box)));
    await page.forceState(target, 0, []);
  }
  await page.evaluate(`document.querySelectorAll('[${STATE_ATTR}]').forEach((e) => e.removeAttribute('${STATE_ATTR}'))`);
  return d <= FIELD_HOVER_MAX_DIFF_PIXELS ? [] : [`滑鼠移到作答欄上,外觀變了 ${d} 個像素(作答欄不該有 hover 樣式)`];
}
