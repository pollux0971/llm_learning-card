/**
 * 14-hud-skin phase-2(工單 T15)的展示頁部分:HudField(新元件)與 D1(頁首在深色背景上看得清楚),
 * 加上 hud.css 的新設計值(--hud-pass / --hud-fail、HudField 的樣式規則)。測試 agent 寫;開發 worker 不改。
 *
 * 給 vitest(`hud/gallery-phase2.test.ts`)與 cucumber(`hud-skin-phase2.steps.ts`)共用。
 * 展示頁用 `openGallery()`(720 × 900)。要量的元素可能在視窗下面:量之前 scrollIntoView,
 * 之後一律用「視窗座標」(getBoundingClientRect)搭配整個視窗的截圖(自己裁),不傳 clip,免得頁面座標與視窗座標搞混。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCENT_MIN_PIXELS, FIELD_FOCUS_MIN_DIFF_PIXELS, FIELD_MIN_HEIGHT_PX, FIELD_WIDTH_TOLERANCE_PX, HEAD_MIN_CONTRAST, PASS_FAIL_MIN_CONTRAST,
} from './card-design-values-test-support.js';
import { attrOf, allEls, hasAncestor, parseMarkup, textOf, type El } from './card-static-test-support.js';
import {
  DIAGONAL_INK, ONE_PIXEL_INK, differingPixels, edgeInk, inkAcross, px, type GalleryPage, type Image, type Rect,
} from './render-test-support.js';
import { CARD_DIRS } from './card-design-values-test-support.js';
import { isOrangeish } from './card-render-test-support.js';
import { HUD_DIR, contrast, cssVar, flattenRules, parseColor, parseCss, readHudCss, worstContrast } from './test-support.js';

// ───────────────────────────── hud.css 的新設計值
/** `--hud-pass` / `--hud-fail` 對面板的最差對比(算法同內文) */
export function passFailContrastProblems(): string[] {
  const { nodes } = readHudCss();
  const problems: string[] = [];
  const panel = cssVar(nodes, '--hud-panel');
  if (panel === undefined) return ['hud.css 沒有 --hud-panel'];
  for (const name of ['--hud-pass', '--hud-fail']) {
    const v = cssVar(nodes, name);
    if (v === undefined) { problems.push(`hud.css 沒有 ${name}`); continue; }
    try {
      const c = worstContrast(parseColor(v), parseColor(panel));
      if (c < PASS_FAIL_MIN_CONTRAST) problems.push(`${name}(${v})對面板的最差對比 ${c.toFixed(2)},要 ≥ ${PASS_FAIL_MIN_CONTRAST}`);
    } catch (e) { problems.push(`${name}:${String(e)}`); }
  }
  const pass = cssVar(nodes, '--hud-pass'); const fail = cssVar(nodes, '--hud-fail');
  if (pass !== undefined && pass === fail) problems.push('--hud-pass 與 --hud-fail 是同一個值');
  return problems;
}

/** HudField 在 hud.css 的規則:有、只引用 var(--hud-*)、橘色只用在線條不印字 */
export function fieldCssProblems(): string[] {
  const { nodes } = readHudCss();
  const rules = flattenRules(nodes).map((x) => x.rule).filter((r) => /data-hud\s*=\s*["']field["']/.test(r.selector));
  if (rules.length === 0) return ['hud.css 沒有 [data-hud="field"] 的規則'];
  const problems: string[] = [];
  if (!rules.some((r) => /:focus-within/.test(r.selector))) problems.push('hud.css 沒有 [data-hud="field"]:focus-within 的規則(鍵盤焦點)');
  for (const r of rules) {
    for (const [k, v] of Object.entries(r.decls)) {
      if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(v.replace(/var\([^)]*\)/g, ''))) problems.push(`${r.selector} { ${k}: ${v} } 用了顏色字面值(只引用 var(--hud-*))`);
      if (k === 'color' && /--hud-accent/.test(v)) problems.push(`${r.selector} 把橘色用在字上(橘色只用在線條)`);
    }
  }
  return problems;
}

// ───────────────────────────── 展示頁原始碼
function galleryMarkup(): { text: string; root: El; script: string } {
  const p = join(HUD_DIR, 'gallery/Gallery.svelte');
  if (!existsSync(p)) throw new Error('hud/gallery/Gallery.svelte 不存在');
  const text = readFileSync(p, 'utf8');
  const script = (text.match(/<script[^>]*>([\s\S]*?)<\/script>/i) ?? [])[1] ?? '';
  const markup = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  return { text, root: parseMarkup(markup), script };
}

/** 展示頁的標記:HudField 兩個(單行、多行)在面板裡 HP 條後面;頁首容器;只有一個 HudPanel;前三顆按鈕不動 */
export function galleryStaticProblems(): string[] {
  const { root, script } = galleryMarkup();
  const els = allEls(root);
  const problems: string[] = [];
  const panels = els.filter((e) => e.tag === 'HudPanel');
  if (panels.length !== 1) problems.push(`展示頁的 HudPanel 要剛好 1 個(T14 的量尺找第一個,頁首不能再用面板),現在 ${panels.length} 個`);
  const heads = els.filter((e) => attrOf(e, 'data-gallery') !== undefined && /["']?head["']?/.test(attrOf(e, 'data-gallery')!) && !/dark-backdrop/.test(attrOf(e, 'data-gallery')!));
  if (heads.length !== 1) problems.push(`展示頁要有剛好 1 個 data-gallery="head" 的容器,現在 ${heads.length} 個`);
  const head = heads[0];
  if (head) {
    if (!allEls(head).some((e) => /dark-backdrop/.test(attrOf(e, 'data-gallery') ?? ''))) problems.push('深色背景的開關(data-gallery="dark-backdrop")要留在頁首容器裡');
    if (allEls(head).some((e) => e.tag === 'HudPanel')) problems.push('頁首容器裡有 HudPanel');
    if (panels[0] && hasAncestor(panels[0], head.tag) && head.children.includes(panels[0])) problems.push('HudPanel 在頁首容器裡');
  }
  const fields = els.filter((e) => e.tag === 'HudField');
  if (fields.length < 2) problems.push(`展示頁要有 2 個作答欄範例(單行、多行),現在 ${fields.length} 個`);
  if (!fields.some((f) => allEls(f).some((e) => e.tag === 'input'))) problems.push('沒有包著 <input> 的 HudField(單行範例)');
  if (!fields.some((f) => allEls(f).some((e) => e.tag === 'textarea'))) problems.push('沒有包著 <textarea> 的 HudField(多行範例)');
  if (panels[0]) {
    for (const f of fields) if (!hasAncestor(f, 'HudPanel')) problems.push('有一個 HudField 在 HudPanel 外面(要放在面板裡)');
    const order = els.filter((e) => e.tag === 'HpBar' || e.tag === 'HudField');
    const lastHp = order.map((e) => e.tag).lastIndexOf('HpBar');
    const firstField = order.map((e) => e.tag).indexOf('HudField');
    if (firstField >= 0 && lastHp >= 0 && firstField < lastHp) problems.push('HudField 要放在 HP 條的後面');
  }
  const buttons = els.filter((e) => e.tag === 'HudButton').slice(0, 3).map((b) => textOf(b).trim());
  if (buttons.join('|') !== '上一張|記住了|下一張') problems.push(`展示頁前三顆 HudButton 要維持原樣(上一張|記住了|下一張),現在是 ${buttons.join('|')}`);
  if (!/HudField/.test(script)) problems.push('Gallery.svelte 沒有 import HudField');
  return problems;
}

// ───────────────────────────── 截圖小工具(視窗座標)
function crop(img: Image, r: Rect): Image {
  const x0 = Math.max(0, Math.floor(r.x)); const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.width, Math.ceil(r.x + r.width)); const y1 = Math.min(img.height, Math.ceil(r.y + r.height));
  const w = Math.max(0, x1 - x0); const h = Math.max(0, y1 - y0);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const s = ((y0 + y) * img.width + x0 + x) * 4; const d = (y * w + x) * 4;
    data[d] = img.data[s]!; data[d + 1] = img.data[s + 1]!; data[d + 2] = img.data[s + 2]!; data[d + 3] = img.data[s + 3]!;
  }
  return { width: w, height: h, data };
}
const grow = (r: Rect, n: number): Rect => ({ x: r.x - n, y: r.y - n, width: r.width + 2 * n, height: r.height + 2 * n });
const nextFrames = (page: GalleryPage) => page.evaluate<boolean>('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');

/** 第 index 個符合 selector 的元素捲到視窗正中央,回傳它的視窗座標 */
async function viewRect(page: GalleryPage, selector: string, index: number): Promise<Rect> {
  const r = await page.evaluate<Rect | null>(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!e) return null; e.scrollIntoView({ block: 'center' });
    const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`);
  if (!r) throw new Error(`展示頁裡找不到 ${selector} 第 ${index + 1} 個`);
  await nextFrames(page);
  return page.evaluate<Rect>(`(() => { const b = document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`);
}

// ───────────────────────────── 驗收 4:HudField 畫出來
export async function fieldRenderProblems(page: GalleryPage): Promise<string[]> {
  await page.reset();
  const count = await page.evaluate<number>(`document.querySelectorAll('[data-hud="field"]').length`);
  if (count < 2) return [`展示頁上 [data-hud="field"] 只有 ${count} 個(要 2 個:單行、多行)`];
  const single = await page.evaluate<number>(`[...document.querySelectorAll('[data-hud="field"]')].findIndex((f) => f.querySelector('input'))`);
  const multi = await page.evaluate<number>(`[...document.querySelectorAll('[data-hud="field"]')].findIndex((f) => f.querySelector('textarea'))`);
  const problems: string[] = [];
  if (single < 0) problems.push('沒有包著 <input> 的 [data-hud="field"](單行)');
  if (multi < 0) problems.push('沒有包著 <textarea> 的 [data-hud="field"](多行)');
  if (single < 0) return problems;

  // 輸入框本身沒有自己的框、外框線、底色;字型與字色;撐滿 HudField
  const inner = await page.evaluate<{ tag: string; border: string[]; bg: string; resize: string; outline: string; shadow: string; font: string; color: string; wRatio: number }[]>(`(() => {
    const root = getComputedStyle(document.documentElement);
    return [...document.querySelectorAll('[data-hud="field"]')].map((f) => {
      const i = f.querySelector('input, textarea'); const s = getComputedStyle(i);
      return { tag: i.tagName.toLowerCase(),
        border: ['Top', 'Right', 'Bottom', 'Left'].map((d) => s.getPropertyValue('border-' + d.toLowerCase() + '-width') + ' ' + s.getPropertyValue('border-' + d.toLowerCase() + '-style')),
        bg: s.backgroundColor, resize: s.resize, outline: s.outlineStyle + ' ' + s.outlineWidth, shadow: s.boxShadow, font: s.fontFamily, color: s.color,
        wRatio: i.getBoundingClientRect().width / f.getBoundingClientRect().width };
    });
  })()`);
  const bodyFont = await page.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue('--hud-font-body')`);
  const firstFamily = (s: string) => (s.split(',')[0] ?? '').trim().replace(/["']/g, '');
  const text = parseColor(await page.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue('--hud-text')`));
  inner.forEach((i, n) => {
    const who = `第 ${n + 1} 個作答欄的 <${i.tag}>`;
    if (i.border.some((b) => !/^0px |none$/.test(b))) problems.push(`${who}有自己的邊框:${i.border.join(' / ')}`);
    if (!/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(i.bg)) problems.push(`${who}有自己的底色:${i.bg}`);
    if (i.tag === 'textarea' && i.resize !== 'none') problems.push(`${who}的 resize 是 ${i.resize},要 none`);
    if (!/^none /.test(i.outline) && !/ 0px$/.test(i.outline)) problems.push(`${who}平常就有外框線:${i.outline}`);
    if (i.shadow !== 'none') problems.push(`${who}有 box-shadow:${i.shadow}`);
    if (firstFamily(i.font) !== firstFamily(bodyFont)) problems.push(`${who}字型第一順位是「${firstFamily(i.font)}」,要是 --hud-font-body 的「${firstFamily(bodyFont)}」`);
    if (i.color.replace(/\s/g, '') !== `rgb(${text.r},${text.g},${text.b})`) problems.push(`${who}字色是 ${i.color},要是 --hud-text`);
    if (i.wRatio < 0.9) problems.push(`${who}只佔作答欄寬度的 ${(i.wRatio * 100).toFixed(0)}%,要撐滿`);
  });

  // 單行作答欄:框線、切角、高度、寬度
  const r = await viewRect(page, '[data-hud="field"]', single);
  const img = await page.screenshot();
  for (const [edge, v] of Object.entries(edgeInk(img, r))) {
    if (!(v >= ONE_PIXEL_INK[0] && v <= ONE_PIXEL_INK[1])) problems.push(`單行作答欄的${edge}邊框線量起來是 ${v.toFixed(2)} 像素,要 1 像素(${ONE_PIXEL_INK[0]}–${ONE_PIXEL_INK[1]})`);
  }
  const L = Math.round(r.x); const T = Math.round(r.y); const R = Math.round(r.x + r.width) - 1; const B = Math.round(r.y + r.height) - 1;
  const lumAt = (x: number, y: number) => { const [a, b, c] = px(img, x, y); return 0.2126 * a + 0.7152 * b + 0.0722 * c; };
  const inside = lumAt(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
  // 跟 HudButton 同一種框:至少有兩個角被切掉(HudButton 切左上與右下),切掉的角斜邊上要有一條細線
  const corners: [string, number, number, number, number][] = [['左上', L, T, 1, 4], ['右上', R, T, -1, 4], ['左下', L, B, 1, -4], ['右下', R, B, -1, -4]];
  let cut = 0;
  for (const [where, cx, cy, dir, k] of corners) {
    if (lumAt(cx, cy) < inside * 0.6) continue; // 最外面那一格是黑的 = 這個角沒切
    cut += 1;
    const v = inkAcross(img, Array.from({ length: 16 }, (_, i) => [cx - dir + dir * i, cy + k] as [number, number]));
    if (!(v >= DIAGONAL_INK[0] && v <= DIAGONAL_INK[1])) problems.push(`單行作答欄${where}切角的斜邊橫著量是 ${v.toFixed(2)},要在 ${DIAGONAL_INK[0]}–${DIAGONAL_INK[1]}`);
  }
  if (cut < 2) problems.push(`單行作答欄只有 ${cut} 個角被切掉,要至少 2 個(跟 HudButton 同一種框)`);
  if (r.height < FIELD_MIN_HEIGHT_PX) problems.push(`單行作答欄高 ${r.height.toFixed(1)} 像素,要 ≥ ${FIELD_MIN_HEIGHT_PX}(不是一條細線)`);
  const cw = await page.evaluate<number>(`(() => { const p = document.querySelectorAll('[data-hud="field"]')[${single}].parentElement; const s = getComputedStyle(p);
    return p.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth); })()`);
  if (Math.abs(r.width - cw) > FIELD_WIDTH_TOLERANCE_PX) problems.push(`單行作答欄寬 ${r.width.toFixed(1)},容器內寬 ${cw.toFixed(1)}(要相等 ±${FIELD_WIDTH_TOLERANCE_PX})`);

  // 鍵盤焦點:輸入框強制 :focus + :focus-visible(欄位強制 :focus-within)之後,作答欄外擴 6 像素,跟平常至少 30 個像素看得出不同
  const normal = crop(await page.screenshot(), grow(r, 6));
  await page.forceState('[data-hud="field"] input', 0, ['focus', 'focus-visible']);
  await page.forceState('[data-hud="field"]', single, ['focus-within']);
  const focused = crop(await page.screenshot(), grow(r, 6));
  await page.forceState('[data-hud="field"] input', 0, []);
  await page.forceState('[data-hud="field"]', single, []);
  const d = differingPixels(normal, focused);
  if (d < FIELD_FOCUS_MIN_DIFF_PIXELS) problems.push(`焦點狀態跟平常只差 ${d} 個像素,要 ≥ ${FIELD_FOCUS_MIN_DIFF_PIXELS}(框線要變亮點色)`);

  // 停用:跟 HudButton 停用一樣變淡(看像素)
  await page.evaluate(`(() => { document.querySelectorAll('[data-hud="field"]')[${single}].querySelector('input').disabled = true; return true; })()`);
  await nextFrames(page);
  const disabled = crop(await page.screenshot(), grow(r, 6));
  const dd = differingPixels(normal, disabled);
  if (dd < FIELD_FOCUS_MIN_DIFF_PIXELS) problems.push(`輸入框停用後作答欄只差 ${dd} 個像素,要變淡`);
  return problems;
}

// ───────────────────────────── 驗收 8:D1 頁首對比
async function switchDark(page: GalleryPage): Promise<boolean> {
  return page.evaluate<boolean>(`(() => { const c = document.querySelector('[data-gallery="dark-backdrop"]'); if (!c) return false; if (!c.checked) c.click();
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`);
}

/**
 * 頁首容器(data-gallery="head")裡每個「自己直接有文字」的元素:記字色 → 把頁首所有字設成透明、表單控制項 visibility: hidden →
 * 截那個元素的矩形 → 字色對範圍裡每一個像素的對比都要 ≥ 4.5。深色背景勾起來、沒勾,兩種都量。
 */
export async function headContrastProblems(page: GalleryPage, dark: boolean): Promise<string[]> {
  await page.reset();
  if (dark && !(await switchDark(page))) return ['展示頁沒有深色背景的切換([data-gallery="dark-backdrop"])'];
  const items = await page.evaluate<{ tag: string; text: string; color: string; rect: Rect }[] | null>(`(() => {
    const head = document.querySelector('[data-gallery="head"]');
    if (!head) return null;
    head.scrollIntoView({ block: 'start' });
    return [head, ...head.querySelectorAll('*')]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim()))
      .map((e) => { const b = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), text: [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data.trim()).join(' ').slice(0, 24),
        color: getComputedStyle(e).color, rect: { x: b.x, y: b.y, width: b.width, height: b.height } }; });
  })()`);
  if (!items) return ['展示頁沒有 data-gallery="head" 的頁首容器'];
  const problems: string[] = [];
  if (items.length < 5) problems.push(`頁首裡「自己直接有文字」的元素只有 ${items.length} 個(標題、說明、三個開關的字至少 5 個)`);
  await page.evaluate(`(() => { const s = document.createElement('style');
    s.textContent = '[data-gallery="head"], [data-gallery="head"] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; } [data-gallery="head"] input, [data-gallery="head"] select, [data-gallery="head"] textarea, [data-gallery="head"] button { visibility: hidden !important; }';
    document.head.append(s); return true; })()`);
  await nextFrames(page);
  const img = await page.screenshot();
  for (const it of items) {
    const fg = parseColor(it.color);
    const x0 = Math.max(0, Math.floor(it.rect.x)); const y0 = Math.max(0, Math.floor(it.rect.y));
    const x1 = Math.min(img.width, Math.ceil(it.rect.x + it.rect.width)); const y1 = Math.min(img.height, Math.ceil(it.rect.y + it.rect.height));
    if (x1 <= x0 || y1 <= y0) { problems.push(`頁首的 <${it.tag}>「${it.text}」不在視窗裡,量不到`); continue; }
    let worst = Number.POSITIVE_INFINITY;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      const [r, g, b] = px(img, x, y);
      worst = Math.min(worst, contrast(fg, { r, g, b, a: 1 }));
    }
    if (worst < HEAD_MIN_CONTRAST) problems.push(`${dark ? '深色背景' : '一般背景'}:頁首 <${it.tag}>「${it.text}」字色 ${it.color} 對底色最差對比 ${worst.toFixed(2)},要 ≥ ${HEAD_MIN_CONTRAST}`);
  }
  return problems;
}

/** 深色背景的開關在頁首裡,而且點得到(正中心那一點不被蓋住) */
export async function darkSwitchReachableProblems(page: GalleryPage): Promise<string[]> {
  await page.reset();
  const m = await page.evaluate<{ found: boolean; inHead: boolean; hit: boolean } | null>(`(() => {
    const c = document.querySelector('[data-gallery="dark-backdrop"]');
    if (!c) return { found: false, inHead: false, hit: false };
    const b = c.getBoundingClientRect();
    const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { found: true, inHead: Boolean(c.closest('[data-gallery="head"]')), hit: Boolean(e && (e === c || e.contains(c) || c.contains(e))) };
  })()`);
  if (!m?.found) return ['找不到深色背景的開關'];
  const problems: string[] = [];
  if (!m.inHead) problems.push('深色背景的開關不在頁首容器裡');
  if (!m.hit) problems.push('深色背景的開關正中心被別的東西蓋住(點不到)');
  return problems;
}

/** T14 的量尺用索引找元素:第一個面板、前三顆按鈕維持原樣 */
export async function gallerySlotsProblems(page: GalleryPage): Promise<string[]> {
  await page.reset();
  const m = await page.evaluate<{ panels: number; firstInHead: boolean; buttons: string[] }>(`({
    panels: document.querySelectorAll('[data-hud="panel"]').length,
    firstInHead: Boolean(document.querySelector('[data-hud="panel"]')?.closest('[data-gallery="head"]')),
    buttons: [...document.querySelectorAll('[data-hud="button"]')].slice(0, 3).map((b) => b.textContent.trim()),
  })`);
  const problems: string[] = [];
  if (m.panels !== 1) problems.push(`展示頁上 [data-hud="panel"] 有 ${m.panels} 個,要 1 個`);
  if (m.firstInHead) problems.push('第一個面板在頁首容器裡');
  if (m.buttons.join('|') !== '上一張|記住了|下一張') problems.push(`前三顆 [data-hud="button"] 是「${m.buttons.join('|')}」,要維持原樣`);
  return problems;
}

/**
 * T14 的量尺(面板與按鈕的框線、斜邊、半透明)用整個視窗的截圖(720 × 900)量,面板整個要在視窗裡:
 * 展示頁加了頁首容器與兩個作答欄之後,面板的下緣還要留在視窗內(基底只剩約 50 像素的空間;
 * 要用緊湊排版,例如 HP 條橫排、兩個作答欄並排)。不然 T14 的量尺會丟「像素在截圖外」。
 */
export async function panelFitsViewportProblems(page: GalleryPage): Promise<string[]> {
  await page.reset();
  const r = await page.rect('[data-hud="panel"]');
  const H = 900;
  const bottom = r.y + r.height;
  return bottom <= H - 4 ? [] : [`展示頁的面板下緣在 y=${bottom.toFixed(0)},視窗只有 ${H}:T14 的量尺要整個面板都在視窗裡(要 ≤ ${H - 4})。用緊湊排版`];
}


// ───────────────────────────── 第三輪:作答欄與按鈕的底色只來自 --hud-panel(靜態)
const FACE_SELECTOR = /data-hud\s*=\s*["'](field|button)["']|hud-button-label|hud-field-face|hud-field\b/;
const STATE_SELECTOR = /:(hover|focus|focus-visible|focus-within|active|disabled|has\()/;
const PSEUDO_SELECTOR = /::?(before|after)/;
/** 一般狀態只准面板色;畫黑線用的偽元素可以再加黑線色;hover / focus / disabled 可以用橘色與實心色 */
const ALLOWED_VARS = {
  base: ['--hud-panel'],
  pseudo: ['--hud-panel', '--hud-line'],
  state: ['--hud-panel', '--hud-line', '--hud-accent', '--hud-accent-wash', '--hud-solid'],
} as const;
const NAMED_COLOUR = /\b(white|black|gray|grey|silver|red|green|blue|orange|yellow|whitesmoke|gainsboro|lightgray|lightgrey)\b/i;
const KEEP_WORDS = /^(transparent|none|inherit|initial|unset|currentcolor)$/i;

/**
 * 作答欄(HudField)與 HUD 按鈕的底色:一般狀態只能來自 var(--hud-panel)(或 transparent / none);
 * 不准寫死不透明底色(#fff、rgb(255,255,255)、rgb(230,…)、具名色),也不准用 --hud-field 這類專用變數當底。
 * 範圍:hud.css、HudField.svelte、HudButton.svelte 的 <style>、兩張卡 App.svelte 的 <style>(只看選到 data-hud / .hud- 的規則)。
 */
export function faceBackgroundProblems(): string[] {
  const sources: { name: string; text: string; cardRule: boolean }[] = [{ name: 'hud.css', text: readHudCss().text, cardRule: false }];
  for (const f of ['HudField.svelte', 'HudButton.svelte']) {
    const p = join(HUD_DIR, f);
    if (existsSync(p)) sources.push({ name: f, text: (readFileSync(p, 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? []).join('\n').replace(/<\/?style[^>]*>/gi, ''), cardRule: false });
  }
  for (const [card, dir] of Object.entries(CARD_DIRS)) {
    const p = join(dir, 'src/App.svelte');
    if (existsSync(p)) sources.push({ name: `${card}/App.svelte`, text: (readFileSync(p, 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? []).join('\n').replace(/<\/?style[^>]*>/gi, ''), cardRule: true });
  }
  const problems: string[] = [];
  let seen = 0;
  for (const src of sources) {
    for (const { rule } of flattenRules(parseCss(src.text))) {
      const sel = rule.selector;
      const hit = src.cardRule ? /data-hud|\.hud-/.test(sel) : FACE_SELECTOR.test(sel);
      if (!hit) continue;
      for (const key of ['background', 'background-color', 'background-image']) {
        const v = rule.decls[key];
        if (v === undefined) continue;
        seen += 1;
        const kind = STATE_SELECTOR.test(sel) ? 'state' : PSEUDO_SELECTOR.test(sel) ? 'pseudo' : 'base';
        const noVars = v.replace(/var\(\s*--[a-z0-9-]+\s*\)/gi, '').replace(/url\([^)]*\)/gi, '');
        if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(noVars) || NAMED_COLOUR.test(noVars)) {
          problems.push(`${src.name}: ${sel} { ${key}: ${v} } 寫死了顏色(底色只能來自 var(--hud-panel))`);
          continue;
        }
        for (const m of v.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
          if (!(ALLOWED_VARS[kind] as readonly string[]).includes(m[1]!)) problems.push(`${src.name}: ${sel} { ${key}: ${v} } 用了 ${m[1]}(${kind === 'base' ? '一般狀態' : kind === 'pseudo' ? '偽元素' : 'hover/focus'}只准 ${ALLOWED_VARS[kind].join('、')})`);
        }
        if (kind === 'base' && !/var\(\s*--hud-panel/.test(v) && !KEEP_WORDS.test(v.replace(/!important/i, '').trim())) {
          problems.push(`${src.name}: ${sel} { ${key}: ${v} } 一般狀態的底色要是 var(--hud-panel) 或 transparent`);
        }
      }
    }
  }
  if (seen === 0) problems.push('沒有掃到任何作答欄或按鈕的背景規則(選擇器對不上?)');
  return problems;
}

// ───────────────────────────── 第三輪:hover / focus 還是橘色,而且 focus 與 hover 分得出來
/** 只數貼著邊的一圈(離外擴 6 像素的截圖邊 ≤ 10 像素 = 離元件邊 ≤ 4 像素):字的次像素抗鋸齒會出現橘色邊,不能算 */
function accentPixels(img: Image, _accent: { r: number; g: number; b: number }): number {
  let n = 0;
  for (let y = 0; y < img.height; y += 1) for (let x = 0; x < img.width; x += 1) {
    if (x > 10 && x < img.width - 11 && y > 10 && y < img.height - 11) continue;
    const i = (y * img.width + x) * 4;
    if (isOrangeish([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!])) n += 1;
  }
  return n;
}

export async function accentProblems(page: GalleryPage): Promise<string[]> {
  await page.reset();
  const accent = parseColor(await page.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue('--hud-accent')`));
  const problems: string[] = [];
  const shot = async (selector: string, index: number, states: { sel: string; idx: number; list: string[] }[]) => {
    const r = await viewRect(page, selector, index);
    for (const st of states) await page.forceState(st.sel, st.idx, st.list);
    return { img: crop(await page.screenshot(), grow(r, 6)) };
  };
  const clear = async (list: { sel: string; idx: number }[]) => { for (const c of list) await page.forceState(c.sel, c.idx, []); };

  // 按鈕:一般狀態沒有橘色,hover 有,focus 有,而且兩者不同
  const normalB = await shot('[data-hud="button"]', 1, []);
  const hoverB = await shot('[data-hud="button"]', 1, [{ sel: '[data-hud="button"]', idx: 1, list: ['hover'] }]);
  await clear([{ sel: '[data-hud="button"]', idx: 1 }]);
  const focusB = await shot('[data-hud="button"]', 1, [{ sel: '[data-hud="button"]', idx: 1, list: ['focus', 'focus-visible'] }]);
  await clear([{ sel: '[data-hud="button"]', idx: 1 }]);
  const n0 = accentPixels(normalB.img, accent); const nh = accentPixels(hoverB.img, accent); const nf = accentPixels(focusB.img, accent);
  if (n0 >= ACCENT_MIN_PIXELS) problems.push(`按鈕一般狀態就有 ${n0} 個橘色像素(橘色只給 hover / focus)`);
  if (nh < ACCENT_MIN_PIXELS) problems.push(`按鈕 hover 只有 ${nh} 個橘色像素,要 ≥ ${ACCENT_MIN_PIXELS}`);
  if (nf < ACCENT_MIN_PIXELS) problems.push(`按鈕 focus-visible 只有 ${nf} 個橘色像素,要 ≥ ${ACCENT_MIN_PIXELS}`);
  if (differingPixels(hoverB.img, focusB.img) < FIELD_FOCUS_MIN_DIFF_PIXELS) problems.push('按鈕 focus-visible 與 hover 看不出不同(T14 G5)');

  // 作答欄:focus-within 有橘色,平常沒有
  const single = await page.evaluate<number>(`[...document.querySelectorAll('[data-hud="field"]')].findIndex((f) => f.querySelector('input'))`);
  if (single < 0) return [...problems, '展示頁沒有單行作答欄'];
  const normalF = await shot('[data-hud="field"]', single, []);
  const focusF = await shot('[data-hud="field"]', single, [
    { sel: '[data-hud="field"] input', idx: 0, list: ['focus', 'focus-visible'] }, { sel: '[data-hud="field"]', idx: single, list: ['focus-within'] }]);
  await clear([{ sel: '[data-hud="field"] input', idx: 0 }, { sel: '[data-hud="field"]', idx: single }]);
  const f0 = accentPixels(normalF.img, accent); const f1 = accentPixels(focusF.img, accent);
  if (f0 >= ACCENT_MIN_PIXELS) problems.push(`作答欄一般狀態就有 ${f0} 個橘色像素`);
  if (f1 < ACCENT_MIN_PIXELS) problems.push(`作答欄 focus-within 只有 ${f1} 個橘色像素,要 ≥ ${ACCENT_MIN_PIXELS}(框線變橘)`);
  return problems;
}
