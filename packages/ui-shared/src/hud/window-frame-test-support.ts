/**
 * 10-desktop-shell phase-6(工單 T16)的外觀量測:展示頁(Chrome,720 × 900)勾「無框」與「假視窗按鈕」,
 * 量標題列的縮小 / 關閉鈕、縮放把手、停用的按鈕與作答欄,以及 HudButton、HudField 在 hover / focus 時的框線顏色。
 * 測試 agent 寫;開發 worker 不改。給 vitest(`hud/window-frame.test.ts`)用。
 *
 * 規則(技術顧問 2026-10-16,T15 的教訓):每一種狀態都量;量法要分得開不透明與半透明(放大法);
 * hover / focus 的截圖不送滑鼠鍵盤,用 CDP 強制偽類(`GalleryPage.forceState`);
 * 切角外側與外圍一圈的橘色點數用 T15 第四輪的 `stateShapeProblems`(card-render-test-support.ts)。
 *
 * 「飽和橘」的量法要考慮小數像素:1 像素的線落在小數位置會被抗鋸齒分到兩格。所以先在頁面裡把目標「壓成整數像素」
 * (寬高四捨五入、位置用 CSS translate 補到整數;只為了量,不改被測的樣式規則),再量垂直於邊的 ±1 像素,取最接近的那一格。
 */
import {
  BACKDROP_DARK, BACKDROP_LIGHT, CHIP_SAMPLE_DY_PX, CHIP_SAMPLE_INSET_PX, DISABLED_MARGIN_PX, DISABLED_MIN_DIFF_PIXELS, EDGE_BAND_PX,
  FAKE_CONTROLS_SWITCH, GALLERY_EXISTING_BUTTONS, GALLERY_EXISTING_FIELDS, HANDLE_COUNT, HANDLE_MARGIN_PX, HANDLE_MAX_ORANGE_PIXELS,
  ORANGE_WASH, SATURATED_ORANGE, SATURATED_ORANGE_TOLERANCE, SEE_THROUGH_MIN_DIFF, SEE_THROUGH_MIN_FRACTION, STATE_MIN_DIFF_PIXELS,
} from './window-frame-design-values-test-support.js';
import {
  CUT_CORNER_TOLERANCE, FACE_CHANNEL_TOLERANCE, FACE_TEST_BACKDROP, FACE_TEST_PANEL, OUTER_RING_MAX_ACCENT_PIXELS, OUTER_RING_MAX_PX, OUTER_RING_MIN_PX,
} from './card-design-values-test-support.js';
import {
  BUTTON_STATES, FIELD_STATES, STATE_ATTR, cropImage, isOrangeish, stateShapeProblems, type ShapeTarget,
} from './card-render-test-support.js';
import { differingPixels, px, type GalleryPage, type Image, type Rect } from './render-test-support.js';
import { HUD_DIR, readText } from './test-support.js';
import { join } from 'node:path';

const RAF2 = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────────── 目標元素
const nth = (selector: string, i: number) => `document.querySelectorAll('${selector}')[${i}]`;
export const MINIMIZE: ShapeTarget = { label: '縮小鈕', element: nth('[data-hud="minimize"]', 0), kind: 'button' };
export const CLOSE: ShapeTarget = { label: '關閉鈕', element: nth('[data-hud="close"]', 0), kind: 'button' };
export const GALLERY_BUTTON: ShapeTarget = { label: 'HudButton(展示頁第一顆)', element: nth('[data-hud="button"]', 0), kind: 'button' };
export const GALLERY_FIELD: ShapeTarget = { label: 'HudField(展示頁第一個)', element: nth('[data-hud="field"]', 0), kind: 'field' };
const CHIPS = [MINIMIZE, CLOSE];

// ───────────────────────────── 開展示頁:勾無框與假視窗按鈕
/**
 * 重新載入展示頁,勾「無框」(標題列、縮放把手)與「假視窗按鈕」(讓縮小、關閉鈕在瀏覽器裡畫出來)。
 * 回傳問題清單:沒有開關、勾了之後兩顆鈕沒有出現。
 */
export async function openFrameGallery(page: GalleryPage): Promise<string[]> {
  await page.reset();
  const r = await page.evaluate<{ frameless: boolean; fake: boolean }>(`(() => {
    const labelled = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('無框'))?.querySelector('input[type="checkbox"]');
    const frameless = labelled ?? document.querySelector('input[type="checkbox"]');
    const fake = document.querySelector(${JSON.stringify(FAKE_CONTROLS_SWITCH)});
    if (frameless && !frameless.checked) frameless.click();
    if (fake && fake.type === 'checkbox' && !fake.checked) fake.click();
    return { frameless: Boolean(frameless), fake: Boolean(fake && fake.type === 'checkbox') };
  })()`);
  const problems: string[] = [];
  if (!r.frameless) problems.push('展示頁沒有「無框」開關');
  if (!r.fake) problems.push(`展示頁沒有假視窗按鈕開關(<input type="checkbox" data-gallery="fake-window-controls">)`);
  await page.evaluate(RAF2);
  for (let i = 0; i < 40; i += 1) {
    if (await page.evaluate<boolean>(`Boolean(document.querySelector('[data-hud="minimize"]') && document.querySelector('[data-hud="close"]'))`)) break;
    await sleep(50);
  }
  const found = await page.evaluate<{ min: number; close: number; handles: number }>(`({ min: document.querySelectorAll('[data-hud="minimize"]').length,
    close: document.querySelectorAll('[data-hud="close"]').length, handles: document.querySelectorAll('[data-hud="resize-handle"]').length })`);
  if (found.min !== 1 || found.close !== 1) problems.push(`勾了「無框」與「假視窗按鈕」之後,縮小鈕 ${found.min} 顆、關閉鈕 ${found.close} 顆(各要 1 顆)`);
  if (r.frameless && found.handles !== HANDLE_COUNT) problems.push(`勾了「無框」之後縮放把手有 ${found.handles} 個,要 ${HANDLE_COUNT} 個`);
  return problems;
}

// ───────────────────────────── 共用小工具
async function mark(page: GalleryPage, t: ShapeTarget): Promise<Rect | null> {
  return page.evaluate<Rect | null>(`(() => { document.activeElement?.blur?.(); document.querySelectorAll('[${STATE_ATTR}]').forEach((x) => x.removeAttribute('${STATE_ATTR}'));
    const e = ${t.element}; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); e.setAttribute('${STATE_ATTR}', '');
    return ${RAF2}.then(() => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }); })()`);
}
async function unmark(page: GalleryPage): Promise<void> {
  await page.evaluate(`(() => { document.querySelectorAll('[${STATE_ATTR}]').forEach((e) => { e.removeAttribute('${STATE_ATTR}'); e.style.removeProperty('translate'); e.style.removeProperty('width'); e.style.removeProperty('height'); e.style.removeProperty('box-sizing'); }); return true; })()`);
}
async function rectOfMarked(page: GalleryPage): Promise<Rect> {
  return page.evaluate<Rect>(`${RAF2}.then(() => { const b = document.querySelector('[${STATE_ATTR}]').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })`);
}
/** 把做了記號的元素壓成整數像素的位置與大小(只為了量線的顏色) */
async function snapMarked(page: GalleryPage): Promise<Rect> {
  await page.evaluate(`(() => { const e = document.querySelector('[${STATE_ATTR}]'); const b = e.getBoundingClientRect();
    e.style.boxSizing = 'border-box'; e.style.width = Math.round(b.width) + 'px'; e.style.height = Math.round(b.height) + 'px'; return ${RAF2}; })()`);
  await page.evaluate(`(() => { const e = document.querySelector('[${STATE_ATTR}]'); const b = e.getBoundingClientRect();
    e.style.translate = (Math.round(b.x) - b.x) + 'px ' + (Math.round(b.y) - b.y) + 'px'; return ${RAF2}; })()`);
  return rectOfMarked(page);
}
const dist = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
const inside = (img: Image, x: number, y: number) => x >= 0 && y >= 0 && x < img.width && y < img.height;

// ───────────────────────────── 1. 框線顏色:hover / focus 時四條直邊正中間是飽和橘(驗收 7)
interface Probe { edge: string; at: [number, number]; best: [number, number, number]; d: number }
function edgeProbes(img: Image, rect: Rect): Probe[] {
  const L = Math.round(rect.x); const T = Math.round(rect.y);
  const R = L + Math.round(rect.width) - 1; const B = T + Math.round(rect.height) - 1;
  const xm = Math.round((L + R) / 2); const ym = Math.round((T + B) / 2);
  const lines: [string, [number, number][]][] = [];
  const band = (f: (k: number) => [number, number]) => { const out: [number, number][] = []; for (let k = -EDGE_BAND_PX; k <= EDGE_BAND_PX; k += 1) out.push(f(k)); return out; };
  lines.push(['上邊', band((k) => [xm, T + k])], ['下邊', band((k) => [xm, B + k])], ['左邊', band((k) => [L + k, ym])], ['右邊', band((k) => [R + k, ym])]);
  return lines.map(([edge, pts]) => {
    let best: [number, number, number] = [0, 0, 0]; let at: [number, number] = pts[0]!; let d = Number.POSITIVE_INFINITY;
    for (const [x, y] of pts) {
      if (!inside(img, x, y)) continue;
      const c = px(img, x, y); const dd = dist(c, SATURATED_ORANGE);
      if (dd < d) { d = dd; best = c; at = [x, y]; }
    }
    return { edge, at, best, d };
  });
}

/** 目標在這些狀態下,四條直邊正中間(取垂直於邊 ±1 像素裡最近的一格)是 (231,119,31) ±10 */
async function lineColourProblems(page: GalleryPage, t: ShapeTarget, states: { name: string; list: string[] }[]): Promise<string[]> {
  const problems: string[] = [];
  if (!(await mark(page, t))) return [`${t.label}:畫面上找不到`];
  const rect = await snapMarked(page);
  for (const st of states) {
    await page.forceState(`[${STATE_ATTR}]`, 0, st.list.filter((s) => s === 'focus-within' || s === 'hover' || t.kind === 'button'));
    if (t.kind === 'field' && st.list.includes('focus')) await page.forceState(`[${STATE_ATTR}] input, [${STATE_ATTR}] textarea`, 0, ['focus', 'focus-visible']);
    const shot = await page.screenshot();
    for (const p of edgeProbes(shot, rect)) {
      if (p.d > SATURATED_ORANGE_TOLERANCE) {
        problems.push(`${t.label} ${st.name}:${p.edge}正中間附近最接近飽和橘的那一格 (${p.at.join(',')}) 是 rgb(${p.best.join(',')}),要是 rgb(${SATURATED_ORANGE.join(',')}) ±${SATURATED_ORANGE_TOLERANCE}`
          + `(淡橘填色是 rgb(${ORANGE_WASH.join(',')}),框線不見、變淡或變黑都不行)`);
      }
    }
    await page.forceState(`[${STATE_ATTR}]`, 0, []);
    if (t.kind === 'field') await page.forceState(`[${STATE_ATTR}] input, [${STATE_ATTR}] textarea`, 0, []);
  }
  await unmark(page);
  return problems;
}

export async function buttonLineColourProblems(page: GalleryPage): Promise<string[]> {
  await openFrameGallery(page);
  return lineColourProblems(page, GALLERY_BUTTON, BUTTON_STATES);
}
export async function fieldLineColourProblems(page: GalleryPage): Promise<string[]> {
  await openFrameGallery(page);
  return lineColourProblems(page, GALLERY_FIELD, FIELD_STATES);
}
export async function chipLineColourProblems(page: GalleryPage): Promise<string[]> {
  const opened = await openFrameGallery(page);
  if (opened.length) return opened;
  const out: string[] = [];
  for (const t of CHIPS) out.push(...(await lineColourProblems(page, t, BUTTON_STATES)));
  return out;
}

// ───────────────────────────── 2. 縮小 / 關閉鈕:切角、外圍一圈、沒有 outline(驗收 5)
export async function chipShapeProblems(page: GalleryPage): Promise<string[]> {
  const opened = await openFrameGallery(page);
  if (opened.length) return opened;
  const out: string[] = [];
  for (const t of CHIPS) out.push(...(await stateShapeProblems(page, t, BUTTON_STATES)));
  return out;
}

const OUTLINE = `(() => { const s = getComputedStyle(document.querySelector('[${STATE_ATTR}]')); return { style: s.outlineStyle, width: s.outlineWidth }; })()`;
/** 任何狀態的計算樣式 outline-style 是 none 或 outline-width 是 0 */
export async function chipOutlineProblems(page: GalleryPage): Promise<string[]> {
  const opened = await openFrameGallery(page);
  if (opened.length) return opened;
  const problems: string[] = [];
  for (const t of [...CHIPS, GALLERY_BUTTON]) {
    if (!(await mark(page, t))) { problems.push(`${t.label}:畫面上找不到`); continue; }
    for (const st of [{ name: '一般', list: [] as string[] }, ...BUTTON_STATES]) {
      await page.forceState(`[${STATE_ATTR}]`, 0, st.list);
      const o = await page.evaluate<{ style: string; width: string }>(OUTLINE);
      if (o.style !== 'none' && parseFloat(o.width) !== 0) problems.push(`${t.label} ${st.name}:outline 是 ${o.style} ${o.width}(要 none 或 0)`);
    }
    await page.forceState(`[${STATE_ATTR}]`, 0, []);
    await unmark(page);
  }
  return problems;
}

/** hover、focus-visible、一般 三種狀態兩兩看得出不同(T14 G5 同一個數字);外擴 6 像素的截圖 */
export async function chipStateDistinctProblems(page: GalleryPage): Promise<string[]> {
  const opened = await openFrameGallery(page);
  if (opened.length) return opened;
  const problems: string[] = [];
  for (const t of CHIPS) {
    const r = await mark(page, t);
    if (!r) { problems.push(`${t.label}:畫面上找不到`); continue; }
    const box: Rect = { x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12 };
    const shot = async (list: string[]) => { await page.forceState(`[${STATE_ATTR}]`, 0, list); return cropImage(await page.screenshot(), box); };
    const normal = await shot([]); const hover = await shot(['hover']); const focus = await shot(['focus', 'focus-visible']);
    await page.forceState(`[${STATE_ATTR}]`, 0, []);
    await unmark(page);
    const pairs: [string, number][] = [['hover 與一般', differingPixels(hover, normal)], ['focus-visible 與 hover', differingPixels(focus, hover)], ['focus-visible 與一般', differingPixels(focus, normal)]];
    for (const [what, n] of pairs) if (n < STATE_MIN_DIFF_PIXELS) problems.push(`${t.label}:${what}只差 ${n} 個像素(至少 ${STATE_MIN_DIFF_PIXELS}),看不出差別`);
  }
  return problems;
}

// ───────────────────────────── 3. 放大法:內部跟著 --hud-panel 走(驗收 5、7)
const OVERRIDE_ID = 'zz-amp-panel';
const BACKDROP_ID = 'zz-amp-backdrop';
async function applyAmplification(page: GalleryPage, backdrop: string): Promise<void> {
  const T = FACE_TEST_PANEL;
  await page.evaluate(`(() => { document.getElementById('${OVERRIDE_ID}')?.remove(); document.getElementById('${BACKDROP_ID}')?.remove();
    const a = document.createElement('style'); a.id = '${OVERRIDE_ID}'; a.textContent = ':root { --hud-panel: rgba(${T.r}, ${T.g}, ${T.b}, ${T.a}) !important; }';
    const b = document.createElement('style'); b.id = '${BACKDROP_ID}'; b.textContent = 'html { background: ${backdrop} !important; }';
    document.head.append(a, b); return ${RAF2}; })()`);
}
async function setBackdrop(page: GalleryPage, backdrop: string): Promise<void> {
  await page.evaluate(`(() => { document.getElementById('${BACKDROP_ID}').textContent = 'html { background: ${backdrop} !important; }'; return ${RAF2}; })()`);
}

/** hover / focus 的格子取樣點:寬 20%–80%、高 30% / 50% / 70% */
function gridPoints(r: Rect): [number, number][] {
  const out: [number, number][] = [];
  for (const fy of [0.3, 0.5, 0.7]) for (const fx of [0.2, 0.35, 0.5, 0.65, 0.8]) out.push([r.x + r.width * fx, r.y + r.height * fy]);
  return out;
}

/** 一般狀態的取樣點(頁面座標):縮小 / 關閉鈕避開正中央的字;按鈕與作答欄同 T15 */
function samplePoints(t: ShapeTarget, r: Rect): [number, number][] {
  const cy = r.y + r.height / 2;
  if (t === MINIMIZE || t === CLOSE) {
    const xs = [r.x + CHIP_SAMPLE_INSET_PX, r.x + r.width - CHIP_SAMPLE_INSET_PX];
    return xs.flatMap((x) => [[x, cy - CHIP_SAMPLE_DY_PX], [x, cy + CHIP_SAMPLE_DY_PX]] as [number, number][]);
  }
  if (t.kind === 'field') return [0.3, 0.5, 0.7].map((f) => [r.x + r.width * f, cy] as [number, number]);
  return [r.x + 6, r.x + 8, r.x + r.width - 8, r.x + r.width - 6].map((x) => [x, cy] as [number, number]);
}

/** 一般狀態:每個取樣點 = 測試用的半透明 --hud-panel 疊在「把目標藏起來之後」同一點的像素上(±3)。寫死的不透明色對不上 */
export async function chipFaceProblems(page: GalleryPage): Promise<string[]> {
  const opened = await openFrameGallery(page);
  if (opened.length) return opened;
  const T = FACE_TEST_PANEL;
  await applyAmplification(page, FACE_TEST_BACKDROP);
  const problems: string[] = [];
  for (const t of CHIPS) {
    const r = await mark(page, t);
    if (!r) { problems.push(`${t.label}:畫面上找不到`); continue; }
    const withTarget = await page.screenshot();
    await page.evaluate(`(() => { const s = document.createElement('style'); s.id = 'zz-hide-face'; s.textContent = '[${STATE_ATTR}] { visibility: hidden !important; }'; document.head.append(s); return ${RAF2}; })()`);
    const behind = await page.screenshot();
    await page.evaluate(`document.getElementById('zz-hide-face')?.remove()`);
    for (const [x, y] of samplePoints(t, r)) {
      const got = px(withTarget, x, y); const bg = px(behind, x, y);
      const want = [T.r, T.g, T.b].map((c, i) => Math.round(c * T.a + bg[i]! * (1 - T.a)));
      if (got.some((v, i) => Math.abs(v - want[i]!) > FACE_CHANNEL_TOLERANCE)) {
        problems.push(`${t.label}內部 (${Math.round(x)},${Math.round(y)}) 是 rgb(${got.join(',')}),半透明 --hud-panel 疊在後面 rgb(${bg.join(',')}) 上應該約 rgb(${want.join(',')})`);
        break;
      }
    }
    await unmark(page);
  }
  return problems;
}

/**
 * hover / focus 狀態:換兩個頁底(深、淺)各截一次,內部取樣點的顏色要隨頁底變(任一通道差 ≥ 20)。
 * 內部被不透明色蓋住(例如 hover 時寫死 #fff 或 --hud-solid)就不會隨頁底變。
 */
async function seeThroughProblems(page: GalleryPage, t: ShapeTarget, states: { name: string; list: string[] }[]): Promise<string[]> {
  const problems: string[] = [];
  const r = await mark(page, t);
  if (!r) return [`${t.label}:畫面上找不到`];
  for (const st of states) {
    await applyAmplification(page, BACKDROP_DARK);
    await page.forceState(`[${STATE_ATTR}]`, 0, st.list.filter((s) => s === 'focus-within' || s === 'hover' || t.kind === 'button'));
    if (t.kind === 'field' && st.list.includes('focus')) await page.forceState(`[${STATE_ATTR}] input, [${STATE_ATTR}] textarea`, 0, ['focus', 'focus-visible']);
    const dark = await page.screenshot();
    await setBackdrop(page, BACKDROP_LIGHT);
    const light = await page.screenshot();
    // 格子取樣:字、focus 的淺色內框(T14 G5,不透明)會佔掉少數幾點,所以看比例,不是每點都要透
    const pts = gridPoints(r); let through = 0; let sample = '';
    for (const [x, y] of pts) {
      const a = px(dark, x, y); const b = px(light, x, y);
      if (Math.max(...a.map((v, i) => Math.abs(v - b[i]!))) >= SEE_THROUGH_MIN_DIFF) through += 1;
      else if (!sample) sample = `(${Math.round(x)},${Math.round(y)}) 深色頁底 rgb(${a.join(',')}) / 淺色頁底 rgb(${b.join(',')})`;
    }
    if (through < pts.length * SEE_THROUGH_MIN_FRACTION) {
      problems.push(`${t.label} ${st.name}:${pts.length} 個內部取樣點只有 ${through} 個會隨頁底變(至少 ${Math.ceil(pts.length * SEE_THROUGH_MIN_FRACTION)} 個),例如 ${sample}:內部被不透明色蓋住了`);
    }
    await page.forceState(`[${STATE_ATTR}]`, 0, []);
    if (t.kind === 'field') await page.forceState(`[${STATE_ATTR}] input, [${STATE_ATTR}] textarea`, 0, []);
  }
  await unmark(page);
  return problems;
}

/** 縮小 / 關閉鈕 hover、focus-visible,以及 HudButton、HudField 的 hover / focus:內部仍是半透明 */
export async function seeThroughStateProblems(page: GalleryPage): Promise<string[]> {
  const opened = await openFrameGallery(page);
  if (opened.length) return opened;
  const out: string[] = [];
  for (const t of CHIPS) out.push(...(await seeThroughProblems(page, t, BUTTON_STATES)));
  out.push(...(await seeThroughProblems(page, GALLERY_BUTTON, BUTTON_STATES)));
  out.push(...(await seeThroughProblems(page, GALLERY_FIELD, FIELD_STATES)));
  return out;
}

// ───────────────────────────── 4. 縮放把手 hover 不畫填色(驗收 6)
export async function resizeHandleProblems(page: GalleryPage): Promise<string[]> {
  const opened = await openFrameGallery(page);
  if (opened.length) return opened;
  const problems: string[] = [];
  const count = await page.evaluate<number>(`document.querySelectorAll('[data-hud="resize-handle"]').length`);
  for (let i = 0; i < count; i += 1) {
    const info = await page.evaluate<{ edge: string; rect: Rect; bg: string; image: string } | null>(`(() => { document.querySelectorAll('[${STATE_ATTR}]').forEach((x) => x.removeAttribute('${STATE_ATTR}'));
      const e = document.querySelectorAll('[data-hud="resize-handle"]')[${i}]; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); e.setAttribute('${STATE_ATTR}', '');
      return ${RAF2}.then(() => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return { edge: e.getAttribute('data-hud-edge') ?? String(${i}), rect: { x: b.x, y: b.y, width: b.width, height: b.height }, bg: s.backgroundColor, image: s.backgroundImage }; }); })()`);
    if (!info) continue;
    await page.forceState(`[${STATE_ATTR}]`, 0, ['hover']);
    const after = await page.evaluate<{ bg: string; image: string; shadow: string; outline: string }>(`(() => { const s = getComputedStyle(document.querySelector('[${STATE_ATTR}]'));
      return { bg: s.backgroundColor, image: s.backgroundImage, shadow: s.boxShadow, outline: s.outlineStyle }; })()`);
    const shot = await page.screenshot();
    await page.forceState(`[${STATE_ATTR}]`, 0, []);
    await unmark(page);
    const transparent = /^(transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))$/i;
    if (!transparent.test(after.bg)) problems.push(`縮放把手 ${info.edge} hover:計算 background-color 是 ${after.bg},要透明(只換游標,不畫填色)`);
    if (after.image !== 'none') problems.push(`縮放把手 ${info.edge} hover:background-image 是 ${after.image},要 none`);
    const r = info.rect; let orange = 0; let first = '';
    for (let y = Math.floor(r.y) - HANDLE_MARGIN_PX; y <= Math.ceil(r.y + r.height) + HANDLE_MARGIN_PX; y += 1) {
      for (let x = Math.floor(r.x) - HANDLE_MARGIN_PX; x <= Math.ceil(r.x + r.width) + HANDLE_MARGIN_PX; x += 1) {
        if (!inside(shot, x, y)) continue;
        if (isOrangeish(px(shot, x, y))) { orange += 1; if (!first) first = `(${x},${y})`; }
      }
    }
    if (orange > HANDLE_MAX_ORANGE_PIXELS) problems.push(`縮放把手 ${info.edge} hover:範圍裡有 ${orange} 個橘色像素(例如 ${first}),四個角的把手會在透明的切角裡畫出橘色方塊`);
  }
  return problems;
}

// ───────────────────────────── 5. 停用狀態(驗收 8)
interface DisabledTarget { label: string; element: string; toggle: string; index: string }
const DISABLED_TARGETS: DisabledTarget[] = [
  {
    label: '停用的 HudButton',
    element: `[...document.querySelectorAll('[data-hud="button"]')].find((b) => b.disabled)`,
    toggle: `(e, on) => { e.disabled = on; }`,
    index: `[...document.querySelectorAll('[data-hud="button"]')].findIndex((b) => b.disabled)`,
  },
  {
    label: '停用的 HudField',
    element: `[...document.querySelectorAll('[data-hud="field"]')].find((f) => f.querySelector('input:disabled, textarea:disabled'))`,
    toggle: `(e, on) => { e.querySelectorAll('input, textarea').forEach((c) => { c.disabled = on; }); }`,
    index: `[...document.querySelectorAll('[data-hud="field"]')].findIndex((f) => f.querySelector('input:disabled, textarea:disabled'))`,
  },
];

/**
 * 展示頁在現有元件後面放一顆停用的 HudButton 與一個停用的 HudField。
 * 停用時:跟(同一個元素)一般狀態差 ≥ 30 像素、沒有橘色(連「滑鼠移上去」也不變橘)、切角外側與外圍一圈 0 個橘色點。
 */
export async function disabledProblems(page: GalleryPage): Promise<string[]> {
  await page.reset();
  const problems: string[] = [];
  for (const t of DISABLED_TARGETS) {
    const idx = await page.evaluate<number>(`(() => ${t.index})()`);
    if (idx < 0) { problems.push(`${t.label}:展示頁裡找不到(要在現有元件後面加一個停用的)`); continue; }
    const floor = t.label.includes('Button') ? GALLERY_EXISTING_BUTTONS : GALLERY_EXISTING_FIELDS;
    if (idx < floor) problems.push(`${t.label}排在第 ${idx + 1} 個,現有的前 ${floor} 個要維持原樣(T14、T15 的量尺用索引找元素),停用的要放在它們後面`);
    const rect = await page.evaluate<Rect | null>(`(() => { document.activeElement?.blur?.(); document.querySelectorAll('[${STATE_ATTR}]').forEach((x) => x.removeAttribute('${STATE_ATTR}'));
      const e = ${t.element}; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); e.setAttribute('${STATE_ATTR}', '');
      return ${RAF2}.then(() => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }); })()`);
    if (!rect) continue;
    const box: Rect = { x: rect.x - DISABLED_MARGIN_PX, y: rect.y - DISABLED_MARGIN_PX, width: rect.width + 2 * DISABLED_MARGIN_PX, height: rect.height + 2 * DISABLED_MARGIN_PX };
    const setDisabled = (on: boolean) => page.evaluate(`(() => { const e = document.querySelector('[${STATE_ATTR}]'); (${t.toggle})(e, ${on}); return ${RAF2}; })()`);
    const hideStyle = `(() => { const s = document.createElement('style'); s.id = 'zz-hide-disabled'; s.textContent = '[${STATE_ATTR}] { visibility: hidden !important; }'; document.head.append(s); return ${RAF2}; })()`;
    await setDisabled(false);
    const enabledShot = await page.screenshot();
    const enabledCrop = cropImage(enabledShot, box);
    await page.evaluate(hideStyle);
    const behind = await page.screenshot();
    await page.evaluate(`document.getElementById('zz-hide-disabled')?.remove()`);
    await setDisabled(true);
    await page.evaluate(RAF2);
    const states: { name: string; shot: Image }[] = [{ name: '停用', shot: await page.screenshot() }];
    await page.forceState(`[${STATE_ATTR}]`, 0, ['hover']);
    if (t.label.includes('Field')) await page.forceState(`[${STATE_ATTR}] input, [${STATE_ATTR}] textarea`, 0, ['hover']);
    states.push({ name: '停用 + 滑鼠移上去', shot: await page.screenshot() });
    await page.forceState(`[${STATE_ATTR}]`, 0, []);
    if (t.label.includes('Field')) await page.forceState(`[${STATE_ATTR}] input, [${STATE_ATTR}] textarea`, 0, []);
    await unmark(page);

    const d = differingPixels(enabledCrop, cropImage(states[0]!.shot, box));
    if (d < DISABLED_MIN_DIFF_PIXELS) problems.push(`${t.label}:跟一般狀態只差 ${d} 個像素(至少 ${DISABLED_MIN_DIFF_PIXELS}),看起來跟一般一樣`);
    problems.push(...disabledShapeProblems(t.label, rect, enabledShot, behind, states));
  }
  return problems;
}

/** 停用(與停用時滑鼠移上去)的畫面:切角外側 = 後面、外圍一圈與矩形附近沒有橘色 */
function disabledShapeProblems(label: string, rect: Rect, normal: Image, behind: Image, states: { name: string; shot: Image }[]): string[] {
  const problems: string[] = [];
  const L = Math.floor(rect.x); const T = Math.floor(rect.y); const R = Math.ceil(rect.x + rect.width) - 1; const B = Math.ceil(rect.y + rect.height) - 1;
  const near = [[1, 1], [2, 1], [1, 2], [3, 1], [1, 3], [2, 2]] as const;
  const corners: [string, (a: number, b: number) => [number, number]][] = [
    ['左上', (a, b) => [L + a - 1, T + b - 1]], ['右上', (a, b) => [R - a + 1, T + b - 1]],
    ['左下', (a, b) => [L + a - 1, B - b + 1]], ['右下', (a, b) => [R - a + 1, B - b + 1]],
  ];
  const diff = (x: number, y: number, a: Image, b: Image) => { const p = px(a, x, y); const q = px(b, x, y); return Math.max(...p.map((v, i) => Math.abs(v - q[i]!))); };
  const cut = corners.filter(([, at]) => near.every(([a, b]) => { const [x, y] = at(a, b); return diff(x, y, normal, behind) <= CUT_CORNER_TOLERANCE; }));
  if (cut.length < 2) problems.push(`${label}:平常狀態只有 ${cut.length} 個角被切掉(要至少 2 個),量不了停用狀態的切角`);
  for (const st of states) {
    for (const [name, at] of cut) {
      for (const [a, b] of near) {
        const [x, y] = at(a, b);
        if (diff(x, y, st.shot, behind) > CUT_CORNER_TOLERANCE) { problems.push(`${label} ${st.name}:${name}切角外側 (${x},${y}) 不等於後面的背景(切角被填滿了)`); break; }
      }
    }
    let orange = 0; let first = '';
    for (let y = T - OUTER_RING_MAX_PX; y <= B + OUTER_RING_MAX_PX; y += 1) for (let x = L - OUTER_RING_MAX_PX; x <= R + OUTER_RING_MAX_PX; x += 1) {
      if (!inside(st.shot, x, y)) continue;
      if (isOrangeish(px(st.shot, x, y))) { orange += 1; if (!first) first = `(${x},${y})`; }
    }
    if (orange > OUTER_RING_MAX_ACCENT_PIXELS) problems.push(`${label} ${st.name}:元件範圍與外圍 ${OUTER_RING_MIN_PX}–${OUTER_RING_MAX_PX} 像素內有 ${orange} 個橘色像素(例如 ${first}),停用時不能變橘`);
  }
  return problems;
}

// ───────────────────────────── 靜態:展示頁與 hud.css
export function frameGalleryStaticProblems(): string[] {
  const problems: string[] = [];
  const gallery = readText(join(HUD_DIR, 'gallery/Gallery.svelte'));
  if (!/<input\b[^>]*data-gallery="fake-window-controls"/.test(gallery)) problems.push('Gallery.svelte 沒有 <input data-gallery="fake-window-controls">');
  else if (!/<input\b(?=[^>]*type="checkbox")(?=[^>]*data-gallery="fake-window-controls")/.test(gallery)) problems.push('fake-window-controls 要是 checkbox');
  if (!/<HudButton\b[^>]*\bdisabled\b/.test(gallery)) problems.push('Gallery.svelte 沒有停用的 <HudButton disabled>');
  if (!/<(input|textarea)\b[^>]*\bdisabled\b/.test(gallery)) problems.push('Gallery.svelte 沒有停用的作答欄(<input disabled> 放在 HudField 裡)');
  return problems;
}
