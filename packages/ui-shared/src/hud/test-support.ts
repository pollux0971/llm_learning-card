/**
 * 14-hud-skin / phase-1 的測試輔助(測試 agent 擁有,開發 worker 不改)。
 *
 * 給 vitest(`hud/*.test.ts`)與 cucumber(`features/steps/hud-skin.steps.ts`)共用,
 * 兩邊跑的是同一份檢查,不各寫一份。這個檔不 import 任何還沒寫的實作:
 * 實作模組一律用 `importHud()` 動態載入(算出來的相對路徑),實作還不存在時
 * tsc 仍然 0 錯,測試以「找不到模組」變紅(記憶 red-tests-tsc-clean)。
 *
 * ── 測試釘住的介面(開發 worker 照這個做)─────────────────────────────────────
 * packages/ui-shared/src/hud/
 *   hud.css                 設計值只有這一份(CSS 自訂屬性,見 CSS_VARS)
 *   hp-bar.ts               hpPercent(done, total): number
 *   layout.ts               hudChrome({ frameless, tauri }), readRootFlags(root), 常數 FRAMELESS_CLASS / SOLID_CLASS
 *   window-controls.ts      createWindowControls(deps?) → WindowControls
 *   HudPanel.svelte         props: title?, frameless?, solid?, controls?, children(snippet)
 *   HudTitleBar.svelte      props: title, controls
 *   HudResizeHandles.svelte props: controls
 *   HudButton.svelte        props: disabled?, onclick?, children(snippet)
 *   HpBar.svelte            props: done, total
 *   fonts/                  字型檔 + OFL.txt
 *   gallery/                index.html、main.ts、Gallery.svelte、(vite 設定自理)
 * DOM 掛鉤(伺服器端 render 的 HTML 要看得到,測試靠這些找東西):
 *   data-hud="panel" | "titlebar" | "title" | "minimize" | "close" | "resize-handle" | "button" | "hp-bar"
 *   resize-handle 共 8 個,各帶 data-hud-edge=North|South|East|West|NorthEast|NorthWest|SouthEast|SouthWest
 *   hp-bar:role="progressbar"、data-percent="<0..100>"、aria-valuenow 同值、aria-valuemin="0"、aria-valuemax="100"
 *   HudButton 是 <button type="button">,disabled 時有 disabled 屬性
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HUD_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HUD_DIR, '../../../..');

/** 動態載入 hud/ 底下的實作模組(名稱不含副檔名)。找不到就丟錯 = 紅。 */
export async function importHud<T = Record<string, unknown>>(name: string): Promise<T> {
  const spec: string = `./${name}.js`;
  return (await import(/* @vite-ignore */ spec)) as T;
}

// ───────────────────────────── 型別(只是測試端的描述,不是實作的 import)
export type ResizeDirection =
  | 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';
export interface WindowLike {
  minimize(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
  startResizeDragging(direction: ResizeDirection): Promise<void>;
}
export interface WindowControls {
  readonly available: boolean;
  minimize(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
  startResizeDragging(direction: ResizeDirection): Promise<void>;
}
export interface ControlsDeps {
  isTauri?: () => boolean;
  loadWindow?: () => Promise<WindowLike>;
}
export interface Chrome { titleBar: boolean; resizeHandles: boolean; windowButtons: boolean }

export interface WindowSpy {
  calls: string[];
  loads: number;
  deps: Required<ControlsDeps>;
}
/**
 * 假的視窗:記下每個被呼叫的方法。除了四個允許的方法,還放了 hide / destroy / setVisible / exit,
 * 好讓「直接藏視窗、直接結束程式」一被呼叫就留下紀錄。
 */
export function makeWindowSpy(tauri: boolean): WindowSpy {
  const spy: WindowSpy = { calls: [], loads: 0, deps: undefined as never };
  const rec = (name: string) => async (...args: unknown[]) => {
    spy.calls.push(args.length ? `${name}:${args.join(',')}` : name);
  };
  const win = {
    minimize: rec('minimize'), close: rec('close'), startDragging: rec('startDragging'),
    startResizeDragging: rec('startResizeDragging'),
    hide: rec('hide'), destroy: rec('destroy'), setVisible: rec('setVisible'), exit: rec('exit'),
  } as unknown as WindowLike;
  spy.deps = {
    isTauri: () => tauri,
    loadWindow: async () => { spy.loads += 1; return win; },
  };
  return spy;
}

// ───────────────────────────── 檔案掃描
const SCAN_EXT = new Set(['.css', '.svelte', '.ts', '.html']);
const FONT_EXT = new Set(['.woff2', '.woff', '.ttf', '.otf']);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function isTestFile(path: string): boolean {
  return /\.test\.ts$/.test(path) || path.endsWith('test-support.ts');
}

/** hud/ 底下要被掃的原始碼(.css .svelte .ts .html),排除測試檔、測試輔助與 fonts/ */
export function hudSourceFiles(root: string = HUD_DIR): string[] {
  return walk(root).filter((p) => {
    const ext = p.slice(p.lastIndexOf('.'));
    return SCAN_EXT.has(ext) && !isTestFile(p) && !relative(root, p).startsWith(`fonts${'/'}`);
  });
}
export function readText(path: string): string { return readFileSync(path, 'utf8'); }
export function relPath(path: string, root: string = HUD_DIR): string { return relative(root, path); }

export function fontFiles(root: string = HUD_DIR): string[] {
  return walk(join(root, 'fonts')).filter((p) => FONT_EXT.has(p.slice(p.lastIndexOf('.')).toLowerCase()));
}

/** 一個字型檔旁邊要有開放授權文字(OFL):同目錄、檔名含 OFL 或 LICENSE、內文有 SIL Open Font License 1.1 */
export function fontLicenceProblems(root: string = HUD_DIR): string[] {
  const fonts = fontFiles(root);
  if (fonts.length === 0) return ['hud/fonts/ 底下沒有任何字型檔(FEATURE 說要隨附開放授權字型)'];
  const problems: string[] = [];
  for (const f of fonts) {
    const dir = dirname(f);
    const lic = readdirSync(dir).filter((n) => /^(OFL|LICEN[CS]E)/i.test(n));
    const ok = lic.some((n) => {
      const t = readText(join(dir, n));
      return /SIL OPEN FONT LICENSE/i.test(t) && /Version 1\.1/i.test(t);
    });
    if (!ok) problems.push(`${relPath(f, root)} 旁邊沒有內含 "SIL Open Font License, Version 1.1" 的授權檔`);
  }
  return problems;
}

// ───────────────────────────── 「不載入外部東西、沒有 inline style」掃描
const SVG_NS = /http:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink)/g;

/** 掃一段原始碼文字,回傳違規說明。ext 決定規則:.svelte/.html 看標記,所有檔看外部網址。 */
export function loadProblems(text: string, ext: string): string[] {
  const problems: string[] = [];
  const noNs = text.replace(SVG_NS, '');
  if (/https?:\/\//i.test(noNs)) problems.push('出現外部網址 http(s)://');
  if (/(url\(\s*['"]?\s*\/\/|@import\s+(url\(\s*)?['"]?\s*\/\/)/i.test(noNs)) problems.push('出現 protocol-relative 網址 //host');
  if (/(src|href)\s*=\s*["']?\s*\/\//i.test(noNs)) problems.push('src/href 指向 //host');
  if (ext === '.svelte' || ext === '.html') {
    // 標記裡的 style 屬性(含 style={...}、style:dir 不算:那是 CSSOM,CSP 放行)
    const markup = ext === '.svelte' ? text.replace(/<style[\s\S]*?<\/style>/gi, '') : text;
    if (/<[a-zA-Z][^<>]*\sstyle\s*=/.test(markup)) problems.push('元素帶 style= 屬性(桌面版 CSP 沒有 style-src)');
  }
  if (ext === '.ts' || ext === '.html') {
    if (/<style[\s>]/i.test(text)) problems.push('原始碼裡插入 <style>');
  }
  if (/createElement\(\s*['"]style['"]\s*\)/.test(text)) problems.push("createElement('style')");
  if (/setAttribute\(\s*['"]style['"]/.test(text)) problems.push("setAttribute('style', …)");
  if (/\.style\.cssText\s*=/.test(text)) problems.push('.style.cssText = …');
  if (/insertAdjacentHTML|innerHTML\s*=/.test(text) && /style\s*=/.test(text)) problems.push('用 innerHTML 塞帶 style 的標記');
  return problems;
}

/** 掃整個 hud/ 目錄;至少要掃到一個 .css 與一個 .svelte(防止空目錄綠) */
export function scanHudLoads(root: string = HUD_DIR): { files: number; problems: string[] } {
  const files = hudSourceFiles(root);
  const exts = new Set(files.map((f) => f.slice(f.lastIndexOf('.'))));
  const problems: string[] = [];
  for (const need of ['.css', '.svelte']) {
    if (!exts.has(need)) problems.push(`hud/ 底下沒有任何 ${need} 檔可掃`);
  }
  for (const f of files) {
    const ext = f.slice(f.lastIndexOf('.'));
    for (const p of loadProblems(readText(f), ext)) problems.push(`${relPath(f, root)}: ${p}`);
  }
  return { files: files.length, problems };
}

// ───────────────────────────── 視窗 API 守則(只准 close,不准直接結束程式或藏視窗)
const FORBIDDEN_WINDOW_CALLS = [
  /\binvoke\s*\(/, /\bplugin-process\b/, /\bexit\s*\(/, /\brelaunch\s*\(/,
  /\.hide\s*\(/, /\.destroy\s*\(/, /\.setVisible\s*\(/, /\bwindow\.close\s*\(/,
];
export function windowApiProblems(root: string = HUD_DIR): string[] {
  const problems: string[] = [];
  for (const f of hudSourceFiles(root)) {
    if (f.endsWith('.css') || f.endsWith('.html')) continue;
    const text = readText(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
    for (const re of FORBIDDEN_WINDOW_CALLS) {
      if (re.test(text)) problems.push(`${relPath(f, root)}: 不該出現 ${re}`);
    }
  }
  return problems;
}

/** 取出 .svelte 裡帶某個 data-hud 值的起始標籤文字(認得 {…} 與引號裡的 >,找不到回 undefined) */
export function openingTag(svelte: string, dataHud: string): string | undefined {
  const marker = new RegExp(`data-hud\\s*=\\s*["']${dataHud}["']`).exec(svelte);
  if (!marker) return undefined;
  const start = svelte.lastIndexOf('<', marker.index);
  let depth = 0; let quote = '';
  for (let i = start + 1; i < svelte.length; i += 1) {
    const ch = svelte[i]!;
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (depth === 0 && (ch === '"' || ch === "'")) { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return svelte.slice(start, i + 1);
  }
  return undefined;
}

/** 所有樣式(每個 .css 與每個 .svelte 的 <style> 區塊)解析後的節點,hud.css 在內 */
export function allStyleNodes(root: string = HUD_DIR): CssNode[] {
  const nodes: CssNode[] = [];
  for (const f of hudSourceFiles(root)) {
    const text = readText(f);
    if (f.endsWith('.css')) nodes.push(...parseCss(text));
    else if (f.endsWith('.svelte')) {
      for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) nodes.push(...parseCss(m[1]!));
    }
  }
  return nodes;
}

/** 動畫只准走 CSS(減少動態才關得掉);Svelte 的 transition:/in:/out:/animate: 指令與 WAAPI 不准 */
export function jsMotionProblems(root: string = HUD_DIR): string[] {
  const problems: string[] = [];
  for (const f of hudSourceFiles(root)) {
    if (f.endsWith('.css')) continue;
    const text = readText(f);
    const markup = f.endsWith('.svelte') ? text.replace(/<style[\s\S]*?<\/style>/gi, '') : text;
    if (/\s(transition|in|out|animate):[a-zA-Z]/.test(markup)) problems.push(`${relPath(f, root)}: Svelte 動畫指令(不受 prefers-reduced-motion 管)`);
    if (/\.animate\s*\(|requestAnimationFrame\s*\(|\bsvelte\/(transition|animate|motion)\b/.test(markup)) {
      problems.push(`${relPath(f, root)}: 用程式驅動動畫`);
    }
  }
  return problems;
}

// ───────────────────────────── 迷你 CSS 解析
export interface CssRule { kind: 'rule'; selector: string; decls: Record<string, string> }
export interface CssAt { kind: 'at'; name: string; prelude: string; children: CssNode[]; decls: Record<string, string> }
export type CssNode = CssRule | CssAt;

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0; let quote = ''; let cur = '';
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function parseDecls(body: string): Record<string, string> {
  const decls: Record<string, string> = {};
  for (const part of splitTopLevel(body, ';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) decls[k.startsWith('--') ? k : k.toLowerCase()] = v;
  }
  return decls;
}
export function parseCss(input: string): CssNode[] {
  const text = input.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  function block(): CssNode[] {
    const nodes: CssNode[] = [];
    while (i < text.length) {
      const start = i;
      let depth = 0; let quote = ''; let j = i;
      for (; j < text.length; j += 1) {
        const ch = text[j]!;
        if (quote) { if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (depth === 0 && (ch === '{' || ch === '}' || ch === ';')) break;
      }
      const head = text.slice(start, j).trim();
      const stop = text[j];
      if (stop === '}' || stop === undefined) { i = j + 1; if (head) { /* 尾端沒有 ; 的宣告交給呼叫端 */ } return nodes; }
      if (stop === ';') { i = j + 1; continue; } // @import / @charset 之類
      // stop === '{'
      i = j + 1;
      if (head.startsWith('@')) {
        const m = /^@([a-zA-Z-]+)\s*(.*)$/s.exec(head)!;
        const name = m[1]!.toLowerCase();
        if (name === 'font-face' || name === 'page') {
          const end = text.indexOf('}', i);
          const decls = parseDecls(text.slice(i, end));
          i = end + 1;
          nodes.push({ kind: 'at', name, prelude: m[2]!.trim(), children: [], decls });
        } else {
          nodes.push({ kind: 'at', name, prelude: m[2]!.trim(), children: block(), decls: {} });
        }
      } else {
        const end = text.indexOf('}', i);
        const decls = parseDecls(text.slice(i, end));
        i = end + 1;
        nodes.push({ kind: 'rule', selector: head, decls });
      }
    }
    return nodes;
  }
  return block();
}

/** 攤平成 (規則, 是否在 prefers-reduced-motion: reduce 裡) */
export function flattenRules(nodes: CssNode[], inReduced = false): { rule: CssRule; reduced: boolean }[] {
  const out: { rule: CssRule; reduced: boolean }[] = [];
  for (const n of nodes) {
    if (n.kind === 'rule') out.push({ rule: n, reduced: inReduced });
    else if (n.name === 'media') {
      out.push(...flattenRules(n.children, inReduced || /prefers-reduced-motion\s*:\s*reduce/i.test(n.prelude)));
    } else if (n.name === 'supports' || n.name === 'layer') out.push(...flattenRules(n.children, inReduced));
  }
  return out;
}

// ───────────────────────────── 顏色與對比
export interface Rgba { r: number; g: number; b: number; a: number }
export function parseColor(value: string): Rgba {
  const v = value.trim().toLowerCase();
  if (v === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (v === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) throw new Error(`看不懂的顏色:${value}`);
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const fn = /^rgba?\(\s*([^)]+)\)$/.exec(v);
  if (fn) {
    const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean);
    const num = (s: string, scale: number) => (s.endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s));
    if (parts.length < 3) throw new Error(`看不懂的顏色:${value}`);
    return { r: num(parts[0]!, 255), g: num(parts[1]!, 255), b: num(parts[2]!, 255), a: parts[3] ? num(parts[3], 1) : 1 };
  }
  throw new Error(`看不懂的顏色(要寫死的 #hex 或 rgb()/rgba(),不要用 var() 轉手):${value}`);
}
function lum(c: Rgba): number {
  const f = (x: number) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
function over(fg: Rgba, bg: Rgba): Rgba {
  return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
}
/** 面板半透明,背後是什麼不知道:取壓在純白與純黑兩種底上最差的對比 */
export function worstContrast(text: Rgba, panel: Rgba): number {
  if (text.a !== 1) throw new Error('內文字色不能半透明');
  return Math.min(contrast(text, over(panel, { r: 255, g: 255, b: 255, a: 1 })), contrast(text, over(panel, { r: 0, g: 0, b: 0, a: 1 })));
}

/** hud.css 頂層(不在 @media 裡)第一次出現的自訂屬性值 */
export function cssVar(nodes: CssNode[], name: string): string | undefined {
  for (const { rule, reduced } of flattenRules(nodes)) {
    if (!reduced && rule.decls[name] !== undefined) return rule.decls[name];
  }
  return undefined;
}
export function readHudCss(root: string = HUD_DIR): { text: string; nodes: CssNode[] } {
  const p = join(root, 'hud.css');
  if (!existsSync(p)) throw new Error('hud/hud.css 不存在(設計值只有這一份)');
  const text = readText(p);
  return { text, nodes: parseCss(text) };
}
/** 內文字色與面板底色 → 最差對比 */
export function bodyContrast(nodes: CssNode[]): number {
  const text = cssVar(nodes, '--hud-text');
  const panel = cssVar(nodes, '--hud-panel');
  if (text === undefined) throw new Error('hud.css 沒有 --hud-text');
  if (panel === undefined) throw new Error('hud.css 沒有 --hud-panel');
  return worstContrast(parseColor(text), parseColor(panel));
}

// ───────────────────────────── 減少動態
function declOff(decls: Record<string, string>, prop: 'animation' | 'transition'): boolean {
  const short = decls[prop];
  if (short !== undefined && /^none\b/i.test(short.replace(/!important/i, '').trim())) return true;
  const zero = (v: string | undefined) => v !== undefined && /^0*\.?0*(s|ms)?(\s*!important)?$/i.test(v.trim()) || (v !== undefined && /^0\.0*1ms/i.test(v.trim()));
  if (prop === 'animation') return decls['animation-name']?.trim().startsWith('none') === true || zero(decls['animation-duration']);
  return decls['transition-property']?.trim().startsWith('none') === true || zero(decls['transition-duration']);
}
function isImportant(rule: CssRule, prop: string): boolean {
  return Object.entries(rule.decls).some(([k, v]) => k.startsWith(prop) && /!important/i.test(v));
}
function usesMotion(decls: Record<string, string>, prop: 'animation' | 'transition'): boolean {
  const short = decls[prop];
  if (short !== undefined && !/^none\b/i.test(short.trim())) return true;
  if (prop === 'animation') {
    const n = decls['animation-name'];
    return n !== undefined && !/^none\b/i.test(n.trim());
  }
  const p = decls['transition-property'];
  return p !== undefined && !/^none\b/i.test(p.trim());
}

/** 回傳違規說明;空陣列 = 減少動態時沒有任何 HUD 元件會動 */
export function reducedMotionProblems(nodes: CssNode[]): string[] {
  const flat = flattenRules(nodes);
  const problems: string[] = [];
  const reducedRules = flat.filter((x) => x.reduced).map((x) => x.rule);
  if (reducedRules.length === 0) return ['沒有 @media (prefers-reduced-motion: reduce) 區塊'];
  const catchAll = reducedRules.filter((r) =>
    r.selector.includes('*') && declOff(r.decls, 'animation') && declOff(r.decls, 'transition')
    && isImportant(r, 'animation') && isImportant(r, 'transition'));
  for (const { rule, reduced } of flat) {
    if (reduced) continue;
    for (const prop of ['animation', 'transition'] as const) {
      if (!usesMotion(rule.decls, prop)) continue;
      for (const sel of splitTopLevel(rule.selector, ',').map((s) => s.trim())) {
        const exact = reducedRules.some((r) => splitTopLevel(r.selector, ',').map((s) => s.trim()).includes(sel) && declOff(r.decls, prop));
        if (!exact && catchAll.length === 0) problems.push(`${sel} 有 ${prop},減少動態區塊沒有關掉它(沒有同選擇器的規則,也沒有 *{…!important} 的總關閉)`);
      }
    }
  }
  return problems;
}

/** 展開動畫:至少有一個、時間 ≤ 200ms、不無限重複 */
export function expandAnimationProblems(nodes: CssNode[]): string[] {
  const problems: string[] = [];
  let found = 0;
  for (const { rule, reduced } of flattenRules(nodes)) {
    if (reduced || !usesMotion(rule.decls, 'animation')) continue;
    found += 1;
    const shorthand = rule.decls['animation'] ?? '';
    const dur = /(^|\s)(\d*\.?\d+)(ms|s)(\s|$)/.exec(shorthand) ?? (rule.decls['animation-duration'] ? [, , rule.decls['animation-duration'].replace(/[a-z]+$/i, ''), /ms$/i.test(rule.decls['animation-duration']) ? 'ms' : 's'] : null);
    if (!dur) { problems.push(`${rule.selector}: 看不出動畫時間`); continue; }
    const ms = parseFloat(String(dur[2])) * (dur[3] === 's' ? 1000 : 1);
    if (ms > 200) problems.push(`${rule.selector}: 動畫 ${ms} ms > 200 ms`);
    if (/infinite/i.test(shorthand) || /infinite/i.test(rule.decls['animation-iteration-count'] ?? '')) problems.push(`${rule.selector}: 動畫無限重複`);
  }
  if (found === 0) problems.push('hud.css 沒有任何展開動畫(spec:面板打開時展開一次)');
  return problems;
}

/** 顏色字面值只准寫在 hud.css;其他 css 與 .svelte 的 <style> 只能引用 var(--hud-*) */
export function colourLiteralProblems(root: string = HUD_DIR): string[] {
  const problems: string[] = [];
  for (const f of hudSourceFiles(root)) {
    const name = relPath(f, root);
    if (name === 'hud.css' || f.endsWith('.ts') || f.endsWith('.html')) continue;
    let text = readText(f);
    if (f.endsWith('.svelte')) text = (text.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('\n');
    text = text.replace(/url\([^)]*\)/gi, '');
    const hit = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.exec(text);
    if (hit) problems.push(`${name}: 顏色字面值 ${hit[0]}(設計值只有 hud.css 一份)`);
  }
  return problems;
}

// ───────────────────────────── 用 vite 在 node 裡載入 .svelte 並做伺服器端 render
type ViteServer = { ssrLoadModule(id: string): Promise<Record<string, unknown>>; close(): Promise<void> };
let serverPromise: Promise<ViteServer> | undefined;
async function viteServer(): Promise<ViteServer> {
  serverPromise ??= (async () => {
    const vite = (await import(/* @vite-ignore */ 'vite')) as { createServer(c: unknown): Promise<ViteServer> };
    const { svelte } = (await import(/* @vite-ignore */ '@sveltejs/vite-plugin-svelte')) as { svelte(): unknown };
    return vite.createServer({
      root: REPO_ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
      plugins: [svelte()], server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
  })();
  return serverPromise;
}
export async function closeViteServer(): Promise<void> {
  if (!serverPromise) return;
  const s = await serverPromise;
  serverPromise = undefined;
  await s.close();
}
/** 載入 hud/<name>.svelte 的伺服器端版本;檔案不存在 = 丟錯 */
export async function loadSvelte(name: string): Promise<unknown> {
  const file = join(HUD_DIR, `${name}.svelte`);
  if (!existsSync(file)) throw new Error(`hud/${name}.svelte 不存在`);
  const s = await viteServer();
  return (await s.ssrLoadModule(file)).default;
}
/** 伺服器端 render 一個元件,回傳 HTML。svelte 本身也走 vite 的 ssr 圖(避免 client 版與 server 版混用) */
export async function renderSvelte(name: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = await loadSvelte(name);
  const s = await viteServer();
  const svelteServer = (await s.ssrLoadModule('svelte/server')) as {
    render(c: unknown, o: { props: Record<string, unknown> }): { body: string };
  };
  return svelteServer.render(component, { props }).body;
}
/** 給 children 的 snippet(伺服器端);html 原樣輸出 */
export async function createRawSnippetOrThrow(html: string): Promise<unknown> {
  const s = await viteServer();
  const { createRawSnippet } = (await s.ssrLoadModule('svelte')) as {
    createRawSnippet(fn: () => { render(): string }): unknown;
  };
  return createRawSnippet(() => ({ render: () => html }));
}

/** 從 render 出來的 HTML 數某個 data-hud 掛鉤出現幾次 */
export function countHook(html: string, hook: string): number {
  return (html.match(new RegExp(`data-hud=["']${hook}["']`, 'g')) ?? []).length;
}
