/**
 * 14-hud-skin phase-2(工單 T15)的靜態掃描:兩張卡的 App.svelte 與 main.ts。測試 agent 寫;開發 worker 不改。
 *
 * 給 vitest(`hud/card-static.test.ts`)與 cucumber(`features/steps/hud-skin-phase2.steps.ts`)共用。
 * 用 fs 讀卡片的檔,**不 import** 06、07 的模組(boundaries 只開 06→14、07→14,沒有 14→06 / 14→07)。
 * 每個檢查回傳問題清單,空 = 通過。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CARD_DIRS, CARD_TITLES, RESULT_SYMBOL, RESULT_TEXT, type CardName,
} from './card-design-values-test-support.js';
import { loadProblems, parseCss, flattenRules } from './test-support.js';

// ───────────────────────────── 讀檔與切塊
export interface CardSource { name: CardName; app: string; main: string; script: string; style: string; markup: string }

export function readCardSource(name: CardName): CardSource {
  const dir = CARD_DIRS[name];
  const appPath = join(dir, 'src/App.svelte');
  const mainPath = join(dir, 'src/main.ts');
  if (!existsSync(appPath)) throw new Error(`${appPath} 不存在`);
  return parseCardSource(name, readFileSync(appPath, 'utf8'), existsSync(mainPath) ? readFileSync(mainPath, 'utf8') : '');
}

/** 從文字切塊(自測用:拿範例原始碼與它的改壞版本餵進來) */
export function parseCardSource(name: CardName, app: string, main: string): CardSource {
  const script = (app.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) ?? []).map((s) => s.replace(/^<script[^>]*>|<\/script>$/gi, '')).join('\n');
  const style = (app.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? []).map((s) => s.replace(/^<style[^>]*>|<\/style>$/gi, '')).join('\n');
  const markup = app.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  return { name, app, main, script, style, markup };
}

// ───────────────────────────── 迷你標記樹(Svelte 5:認得 {…} 與引號裡的 > 與 <)
export interface Attr { name: string; raw: string }
export interface El { tag: string; attrs: Attr[]; children: Node[]; parent: El | undefined }
export interface Txt { text: string }
export type Node = El | Txt;
const isEl = (n: Node): n is El => 'tag' in n;
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);

/** 從 s[i] 的 `{` 找到對應的 `}`(跳過引號與反引號字串),回傳 `}` 的位置 */
function matchBrace(s: string, i: number): number {
  let depth = 0; let quote = '';
  for (let j = i; j < s.length; j += 1) {
    const ch = s[j]!;
    if (quote) { if (ch === '\\') j += 1; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return j; }
  }
  return s.length - 1;
}

function parseAttrs(s: string): Attr[] {
  const attrs: Attr[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i += 1;
    if (i >= s.length) break;
    if (s[i] === '{') { // 簡寫 {disabled} 或展開 {...props}
      const end = matchBrace(s, i);
      const inner = s.slice(i + 1, end).trim();
      attrs.push({ name: inner.startsWith('...') ? '...' : inner, raw: s.slice(i, end + 1) });
      i = end + 1; continue;
    }
    const m = /^[^\s=/>{}]+/.exec(s.slice(i));
    if (!m) { i += 1; continue; }
    const name = m[0]; i += name.length;
    while (i < s.length && /\s/.test(s[i]!)) i += 1;
    if (s[i] !== '=') { attrs.push({ name, raw: '' }); continue; }
    i += 1;
    while (i < s.length && /\s/.test(s[i]!)) i += 1;
    let raw = '';
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i]!; let j = i + 1;
      while (j < s.length && s[j] !== q) { if (s[j] === '{') j = matchBrace(s, j); j += 1; }
      raw = s.slice(i, j + 1); i = j + 1;
    } else if (s[i] === '{') {
      const end = matchBrace(s, i); raw = s.slice(i, end + 1); i = end + 1;
    } else {
      const mm = /^[^\s>]+/.exec(s.slice(i)); raw = mm ? mm[0] : ''; i += raw.length;
    }
    attrs.push({ name, raw });
  }
  return attrs;
}

/** 解析標記成樹。{#if}{:else}{/if} 之類的區塊不成節點,裡面的元素直接掛在外層(最外層檢查要看到它們) */
export function parseMarkup(markup: string): El {
  const root: El = { tag: '#root', attrs: [], children: [], parent: undefined };
  let cur = root;
  let i = 0;
  let text = '';
  const flush = () => { if (text) { cur.children.push({ text }); text = ''; } };
  while (i < markup.length) {
    const ch = markup[i]!;
    if (ch === '{') { const end = matchBrace(markup, i); text += markup.slice(i, end + 1); i = end + 1; continue; }
    if (ch === '<' && /[A-Za-z]/.test(markup[i + 1] ?? '')) {
      flush();
      let j = i + 1; let depth = 0; let quote = '';
      for (; j < markup.length; j += 1) {
        const c = markup[j]!;
        if (quote) { if (c === quote) quote = ''; continue; }
        if (depth === 0 && (c === '"' || c === "'")) { quote = c; continue; }
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (c === '>' && depth === 0) break;
      }
      let inside = markup.slice(i + 1, j);
      const selfClosing = inside.endsWith('/');
      if (selfClosing) inside = inside.slice(0, -1);
      const nm = /^[^\s/>]+/.exec(inside)![0];
      const el: El = { tag: nm, attrs: parseAttrs(inside.slice(nm.length)), children: [], parent: cur };
      cur.children.push(el);
      if (!selfClosing && !VOID.has(nm.toLowerCase())) cur = el;
      i = j + 1; continue;
    }
    if (ch === '<' && markup[i + 1] === '/') {
      flush();
      const end = markup.indexOf('>', i);
      const nm = markup.slice(i + 2, end).trim();
      let up: El | undefined = cur;
      while (up && up.tag !== nm) up = up.parent;
      if (up?.parent) cur = up.parent;
      i = end + 1; continue;
    }
    text += ch; i += 1;
  }
  flush();
  return root;
}

export function walkEls(node: El, fn: (e: El) => void): void {
  for (const c of node.children) if (isEl(c)) { fn(c); walkEls(c, fn); }
}
export function allEls(root: El): El[] { const out: El[] = []; walkEls(root, (e) => out.push(e)); return out; }
export function attrOf(e: El, name: string): string | undefined { return e.attrs.find((a) => a.name === name)?.raw; }
const unquote = (raw: string) => raw.replace(/^["']|["']$/g, '').replace(/^\{\s*|\s*\}$/g, '').replace(/^["'`]|["'`]$/g, '');
const squash = (s: string) => s.replace(/\s+/g, '');
export function textOf(e: El): string {
  return e.children.map((c) => (isEl(c) ? textOf(c) : c.text)).join('');
}
export function hasAncestor(e: El, tag: string): boolean {
  for (let p = e.parent; p; p = p.parent) if (p.tag === tag) return true;
  return false;
}
/** 最外層(不在任何元素裡)的元素,與最外層的字(去掉 {#…} {:…} {/…} 區塊標記與空白) */
export function rootLevel(root: El): { els: El[]; text: string } {
  const els = root.children.filter(isEl);
  const text = root.children.filter((c): c is Txt => !isEl(c)).map((c) => c.text).join('')
    .replace(/\{[#:/][^}]*\}/g, '').replace(/\s+/g, '');
  return { els, text };
}

// ───────────────────────────── 檢查
const HUD_IMPORT = '@learning/ui-shared/hud/';

/** import 的來源字串(script 與 main.ts) */
export function importSpecs(text: string): string[] {
  return [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

/** 驗收 1、2:最外層只有一個 HudPanel,所有內容都在裡面;標題、controls;不提 frameless / solid;沒有 h1 */
export function panelProblems(name: CardName, src: CardSource = readCardSource(name)): string[] {
  const root = parseMarkup(src.markup);
  const problems: string[] = [];
  const top = rootLevel(root);
  if (top.els.length !== 1 || top.els[0]!.tag !== 'HudPanel') {
    problems.push(`最外層要剛好一個 <HudPanel>,現在是 [${top.els.map((e) => `<${e.tag}>`).join(' ')}]`);
  }
  if (top.text !== '') problems.push(`HudPanel 外面還有字或運算式:${top.text.slice(0, 40)}`);
  const panels = allEls(root).filter((e) => e.tag === 'HudPanel');
  if (panels.length !== 1) problems.push(`HudPanel 要剛好 1 個(沒有第二個、不巢狀),現在 ${panels.length} 個`);
  const panel = panels[0];
  if (panel) {
    const title = attrOf(panel, 'title');
    if (title === undefined || unquote(title) !== CARD_TITLES[name]) problems.push(`HudPanel 的 title 要是「${CARD_TITLES[name]}」,現在是 ${title ?? '沒有'}`);
    if (attrOf(panel, 'controls') === undefined) problems.push('HudPanel 沒有傳 controls');
    for (const bad of ['frameless', 'solid', '...', 'class:hud-frameless', 'class:hud-solid']) {
      if (attrOf(panel, bad) !== undefined) problems.push(`HudPanel 不該傳 ${bad}(那個 class 由桌面殼決定)`);
    }
  }
  if (!/createWindowControls\s*\(/.test(src.app)) problems.push('沒有呼叫 createWindowControls()');
  if (!importSpecs(src.script).some((s) => s.startsWith(HUD_IMPORT) && /window-controls/.test(s))) problems.push('沒有從 @learning/ui-shared/hud/window-controls import');
  if (!importSpecs(src.script).some((s) => s.startsWith(HUD_IMPORT) && /HudPanel/.test(s))) problems.push('沒有從 @learning/ui-shared/hud/HudPanel.svelte import');
  if (allEls(root).some((e) => e.tag === 'h1')) problems.push('還有 <h1>(標題列由 HudPanel 畫)');
  const whole = `${src.app}\n${src.main}`;
  const hit = /(?<!-)hud-(?:frameless|solid)|FRAMELESS_CLASS|SOLID_CLASS|classList/.exec(whole);
  if (hit) problems.push(`卡片的原始碼提到 ${hit[0]}(兩個 class 由桌面殼決定)`);
  return problems;
}

/** 驗收 1、2:每一顆按鈕都是 HudButton,沒有原生 <button>;各按鈕的接線 */
export function buttonProblems(name: CardName, src: CardSource = readCardSource(name)): string[] {
  const els = allEls(parseMarkup(src.markup));
  const problems: string[] = [];
  const native = els.filter((e) => e.tag.toLowerCase() === 'button');
  if (native.length > 0) problems.push(`還有 ${native.length} 顆原生 <button>(每一顆都要是 <HudButton>)`);
  const hud = els.filter((e) => e.tag === 'HudButton');
  if (!importSpecs(src.script).some((s) => s.startsWith(HUD_IMPORT) && /HudButton/.test(s))) problems.push('沒有從 @learning/ui-shared/hud/HudButton.svelte import');
  if (name === 'teach-card') {
    if (hud.length < 1) problems.push('教學卡沒有任何 <HudButton>(「下一個」要是 HudButton)');
    const next = hud.find((b) => /下一個/.test(textOf(b)));
    if (!next) problems.push('找不到字是「下一個」的 <HudButton>');
    else {
      if (squash(unquote(attrOf(next, 'onclick') ?? '')) !== 'handleNext') problems.push(`「下一個」的 onclick 要是 handleNext,現在是 ${attrOf(next, 'onclick') ?? '沒有'}`);
      if (squash(unquote(attrOf(next, 'disabled') ?? '')) !== 'finished') problems.push(`「下一個」的 disabled 要是 finished,現在是 ${attrOf(next, 'disabled') ?? '沒有'}`);
    }
    return problems;
  }
  // 考試卡:送出(填空、應用題各一顆)與下一題
  const submits = hud.filter((b) => squash(textOf(b)) === '送出');
  const wired = (b: El) => squash(unquote(attrOf(b, 'onclick') ?? '')).replace(/^\(\)=>/, '').replace(/^\{|\}$/g, '').replace(/^void/, '').replace(/;$/, '').replace(/\(\)$/, '');
  const fill = submits.filter((b) => wired(b) === 'submitFill');
  const apply = submits.filter((b) => wired(b) === 'submitApply');
  if (fill.length < 1) problems.push('填空題沒有「送出」<HudButton>(onclick 要呼叫 submitFill,跟 Enter 鍵走同一個)');
  if (apply.length < 1) problems.push('應用題沒有「送出」<HudButton>(onclick 要呼叫 submitApply,跟 Ctrl+Enter 走同一個)');
  for (const b of submits) {
    if (!/view\.submitting/.test(attrOf(b, 'disabled') ?? '')) problems.push('「送出」的 disabled 要含 view.submitting(評分中停用)');
  }
  const next = hud.find((b) => squash(textOf(b)) === '下一題');
  if (!next) problems.push('找不到字是「下一題」的 <HudButton>');
  else if (squash(unquote(attrOf(next, 'onclick') ?? '')) !== 'next') problems.push(`「下一題」的 onclick 要是 next,現在是 ${attrOf(next, 'onclick') ?? '沒有'}`);
  // 鍵盤路徑不動:keydown 處理函式還是呼叫同一個 submitFill / submitApply
  if (!/function\s+handleFillKeydown[\s\S]*?submitFill\s*\(/.test(src.script)) problems.push('handleFillKeydown 不再呼叫 submitFill()(鍵盤路徑要照舊)');
  if (!/function\s+handleApplyKeydown[\s\S]*?submitApply\s*\(/.test(src.script)) problems.push('handleApplyKeydown 不再呼叫 submitApply()(鍵盤路徑要照舊)');
  if ((src.script.match(/function\s+submitFill\b/g) ?? []).length !== 1 || (src.script.match(/function\s+submitApply\b/g) ?? []).length !== 1) problems.push('submitFill / submitApply 要各只有一個定義');
  return problems;
}

/** 驗收 2:每一個 <input> 與 <textarea> 都包在 <HudField> 裡;輸入框本身還是原生元素 */
export function fieldProblems(src: CardSource = readCardSource('test-card')): string[] {
  const els = allEls(parseMarkup(src.markup));
  const problems: string[] = [];
  const inputs = els.filter((e) => e.tag === 'input');
  const areas = els.filter((e) => e.tag === 'textarea');
  if (inputs.length < 2) problems.push(`單行輸入框(<input>)至少 2 個(第一格與其餘各格),現在 ${inputs.length} 個`);
  if (areas.length !== 1) problems.push(`<textarea> 要剛好 1 個,現在 ${areas.length} 個`);
  for (const e of [...inputs, ...areas]) {
    if (!hasAncestor(e, 'HudField')) problems.push(`有一個 <${e.tag}> 沒有包在 <HudField> 裡`);
  }
  if (!importSpecs(src.script).some((s) => s.startsWith(HUD_IMPORT) && /HudField/.test(s))) problems.push('沒有從 @learning/ui-shared/hud/HudField.svelte import');
  if (els.some((e) => e.tag === 'HudField' && (attrOf(e, 'bind:value') !== undefined))) problems.push('HudField 不接管輸入框:bind:value 留在原生 input / textarea 上');
  // 06 phase-1 的行為照舊:第一格 bind:this、rows="6"、disabled、onkeydown
  const first = inputs.find((e) => attrOf(e, 'bind:this') !== undefined);
  if (!first) problems.push('第一格的 bind:this 不見了(06 phase-1「第一格有焦點」)');
  for (const e of inputs) {
    if (attrOf(e, 'disabled') === undefined) problems.push('有一個 <input> 沒有 disabled(評分中停用)');
    if (attrOf(e, 'onkeydown') === undefined) problems.push('有一個 <input> 沒有 onkeydown(Enter 送出)');
    if (attrOf(e, 'type') === undefined || unquote(attrOf(e, 'type')!) !== 'text') problems.push('有一個 <input> 不是 type="text"');
  }
  const area = areas[0];
  if (area && (unquote(attrOf(area, 'rows') ?? '') !== '6')) problems.push('<textarea> 的 rows 要照舊是 6(06 phase-1「應用題至少五行高」)');
  return problems;
}

/** 驗收 2:進度是 HpBar;字「x / y」還在同一區 */
export function progressProblems(src: CardSource = readCardSource('test-card')): string[] {
  const els = allEls(parseMarkup(src.markup));
  const problems: string[] = [];
  const header = els.find((e) => e.tag === 'header' && /\bprogress\b/.test(attrOf(e, 'class') ?? ''));
  if (!header) return ['找不到 <header class="progress">'];
  const bars = allEls(header).filter((e) => e.tag === 'HpBar');
  if (!importSpecs(src.script).some((s) => s.startsWith(HUD_IMPORT) && /HpBar/.test(s))) problems.push('沒有從 @learning/ui-shared/hud/HpBar.svelte import');
  if (bars.length !== 1) problems.push(`header.progress 裡要剛好 1 個 <HpBar>,現在 ${bars.length} 個`);
  const bar = bars[0];
  if (bar) {
    if (squash(unquote(attrOf(bar, 'done') ?? '')) !== 'view.answeredCount') problems.push(`HpBar 的 done 要是 view.answeredCount,現在是 ${attrOf(bar, 'done') ?? '沒有'}`);
    if (squash(unquote(attrOf(bar, 'total') ?? '')) !== 'view.totalCount') problems.push(`HpBar 的 total 要是 view.totalCount,現在是 ${attrOf(bar, 'total') ?? '沒有'}`);
  }
  if (!/\{\s*view\.answeredCount\s*\}\s*\/\s*\{\s*view\.totalCount\s*\}/.test(textOf(header))) problems.push('header.progress 裡的「{answeredCount} / {totalCount}」那行字不見了');
  return problems;
}

/** 驗收 2:結果那一行。兩個分支字樣不同、都含符號、符號不寫在 <style> 的 content 裡,評分失敗不帶 data-result */
export function resultMarkupProblems(src: CardSource = readCardSource('test-card')): string[] {
  const els = allEls(parseMarkup(src.markup));
  const problems: string[] = [];
  const results = els.filter((e) => attrOf(e, 'data-result') !== undefined);
  if (results.length === 0) return ['沒有任何元素帶 data-result(結果那一行要帶 data-result="pass" / "fail")'];
  // 一個元素用運算式選 pass / fail,或兩個元素各一個;兩種寫法都收
  const raws = results.map((e) => attrOf(e, 'data-result')!);
  const joined = raws.join(' ');
  if (!/pass/.test(joined) || !/fail/.test(joined)) problems.push(`data-result 要有 pass 與 fail 兩種值,現在是 ${joined}`);
  // 運算式裡的字串字面值也算(原樣保留 {…}),所以直接在整段文字裡找
  const visible = results.map((e) => textOf(e)).join('\n');
  if (!visible.includes(RESULT_TEXT.pass)) problems.push(`結果那一行的標記裡沒有「${RESULT_TEXT.pass}」`);
  if (!visible.includes(RESULT_TEXT.fail)) problems.push(`結果那一行的標記裡沒有「${RESULT_TEXT.fail}」`);
  if ((RESULT_TEXT.pass as string) === RESULT_TEXT.fail) problems.push('答對與答錯字樣相同');
  if (!visible.includes(RESULT_SYMBOL.pass) || !visible.includes(RESULT_SYMBOL.fail)) problems.push('答對 / 答錯的符號(✓ U+2713 / × U+00D7)不在標記的文字裡');
  if (visible.includes(String.fromCodePoint(0x2717))) problems.push('用了 ✗(U+2717),Noto Sans CJK TC 沒有這個字');
  for (const rule of flattenRules(parseCss(src.style))) {
    if ('content' in rule.rule.decls && rule.rule.decls['content'] !== 'none' && rule.rule.decls['content'] !== '""' && rule.rule.decls['content'] !== "''") {
      problems.push(`<style> 用了 content(符號要寫在標記裡,不用 ::before / content):${rule.rule.selector}`);
    }
  }
  if (/::?(before|after)/.test(src.style)) problems.push('<style> 有 ::before / ::after(符號不用 CSS 畫)');
  const errors = els.filter((e) => /評分失敗/.test(e.children.filter((c): c is Txt => !('tag' in c)).map((c) => c.text).join('')));
  for (const e of errors) {
    if (attrOf(e, 'data-result') !== undefined) problems.push('「評分失敗」那行不該帶 data-result');
    if ([RESULT_SYMBOL.pass, RESULT_SYMBOL.fail, String.fromCodePoint(0x2717)].some((c) => textOf(e).includes(c))) problems.push('「評分失敗」那行不該有對錯符號');
  }
  if (errors.length === 0) problems.push('找不到「評分失敗,請再試一次」那一行(06 phase-1 照舊要有)');
  return problems;
}

// ───────────────────────────── 樣式與載入
const FRAME_PROP = /^(border|outline|box-shadow|clip-path|mask|-webkit-mask)/;
const COLOUR_PROPS = /^(color|background|background-color|background-image|fill|stroke|border-.*color|outline-color|caret-color|accent-color|text-decoration-color)$/;
const COLOUR_OK = /^(transparent|inherit|currentcolor|none|initial|unset)$/i;
const LC_EXAMPLE_ALLOWED = new Set(['border-left', 'border-left-width', 'border-left-style', 'border-left-color']);

/** 驗收 1、2:<style> 不畫框;顏色只用 var(--hud-*) */
export function styleProblems(name: CardName, src: CardSource = readCardSource(name)): string[] {
  const problems: string[] = [];
  const nodes = parseCss(src.style);
  for (const { rule } of flattenRules(nodes)) {
    const isExample = /\.lc-example\b/.test(rule.selector);
    for (const [k, v] of Object.entries(rule.decls)) {
      if (FRAME_PROP.test(k) && !(isExample && LC_EXAMPLE_ALLOWED.has(k))) problems.push(`<style> 畫框:${rule.selector} { ${k}: ${v} }(只有 .lc-example 的 border-left 例外)`);
      if (COLOUR_PROPS.test(k) || (isExample && k === 'border-left')) {
        const parts = v.replace(/!important/i, '').trim();
        const colourish = k === 'border-left' ? parts.split(/\s+/).slice(2).join(' ') || parts : parts;
        const okVar = /var\(\s*--hud-[a-z-]+\s*\)/.test(parts);
        if (!okVar && !COLOUR_OK.test(colourish) && !(k === 'border-left' && !/[a-z#]/i.test(colourish.replace(/\d|px|rem|em|solid|dashed|dotted|none/gi, '')))) {
          problems.push(`<style> 的顏色不是 var(--hud-*):${rule.selector} { ${k}: ${v} }`);
        }
      }
      for (const m of v.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
        if (!m[1]!.startsWith('--hud-')) problems.push(`<style> 用了 hud 以外的變數 ${m[1]}`);
      }
    }
  }
  const text = src.style.replace(/url\([^)]*\)/gi, '');
  const lit = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.exec(text);
  if (lit) problems.push(`<style> 有顏色字面值 ${lit[0]}`);
  return problems;
}

/** 驗收 1、2、9:import 的來源;沒有 style= 屬性、inline <style>、外部網址(CSP) */
export function importProblems(name: CardName, src: CardSource = readCardSource(name)): string[] {
  const problems: string[] = [];
  const specs = [...importSpecs(src.script), ...importSpecs(src.main)];
  if (!specs.some((s) => s.startsWith(HUD_IMPORT) && s.endsWith('hud.css'))) problems.push('App.svelte 或 main.ts 沒有 import @learning/ui-shared/hud/hud.css(沒有它,HUD 元件沒有樣式)');
  for (const s of specs) {
    if (/ui-shared/.test(s) && !s.startsWith(HUD_IMPORT)) {
      if (name === 'test-card') problems.push(`考試卡只能 import @learning/ui-shared/hud/…,不能 import ${s}(07 的,ADR-035 第 2 點)`);
      else if (s !== '@learning/ui-shared') problems.push(`教學卡 import ${s}:只能是 @learning/ui-shared(renderMarkdown)或 @learning/ui-shared/hud/…`);
    }
    if (/^\.{1,2}\//.test(s) && /ui-shared|packages\//.test(s)) problems.push(`用相對路徑 import ui-shared:${s}`);
  }
  if (name === 'teach-card' && !specs.includes('@learning/ui-shared')) problems.push('教學卡原本 import 的 @learning/ui-shared(renderMarkdown)不見了');
  return problems;
}

export function loadScanProblems(name: CardName, src: CardSource = readCardSource(name)): string[] {
  return [
    ...loadProblems(src.app, '.svelte').map((p) => `App.svelte: ${p}`),
    ...loadProblems(src.main, '.ts').map((p) => `main.ts: ${p}`),
  ];
}

/** 一次跑完一張卡的所有靜態檢查(場景 1、2) */
export function allCardProblems(name: CardName): { kit: string[]; own: string[] } {
  const kit = [...panelProblems(name), ...buttonProblems(name), ...importProblems(name)];
  const own = [...styleProblems(name), ...loadScanProblems(name)];
  if (name === 'test-card') kit.push(...fieldProblems(), ...progressProblems(), ...resultMarkupProblems());
  return { kit, own };
}
