/**
 * 10-desktop-shell phase-6(工單 T16、T21)的量尺:視窗設定、權限、頁面那段程式(window_mode.js)、main.rs 與 Cargo 的靜態檢查。
 * 測試 agent 寫;開發 worker 不改。vitest(window-frameless.test.ts)與 cucumber(desktop-shell-phase6.steps.ts)共用。
 *
 * 不 import 14-hud-skin 的任何模組(boundaries):layout.ts 的 class 名字用讀文字的方式取。
 * 所有函式回傳「問題清單」;空 = 通過。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { SRC_TAURI, readTauriConf, type TauriConf } from './frontend-dist.js';

export const CAPABILITY_FILE = join(SRC_TAURI, 'capabilities/default.json');
export const WINDOW_MODE_JS = join(SRC_TAURI, 'src/window_mode.js');
export const WINDOW_MODE_RS = join(SRC_TAURI, 'src/window_mode.rs');
export const MAIN_RS = join(SRC_TAURI, 'src/main.rs');
export const CARGO_TOML = join(SRC_TAURI, 'Cargo.toml');
export const CARGO_LOCK = join(SRC_TAURI, 'Cargo.lock');
const LAYOUT_TS = join(SRC_TAURI, '../../../packages/ui-shared/src/hud/layout.ts');

/** 驗收 2:剛好這六條 */
export const REQUIRED_PERMISSIONS = [
  'core:default', 'window-state:default',
  'core:window:allow-start-dragging', 'core:window:allow-start-resize-dragging',
  'core:window:allow-minimize', 'core:window:allow-close',
] as const;

// ───────────────────────────── 視窗設定(驗收 1)

const CARD_WINDOWS = ['teach', 'test'] as const;

function windowOf(conf: TauriConf, label: string): Record<string, unknown> | undefined {
  return (conf.app?.windows ?? []).find((w) => w.label === label);
}

/** 兩個卡片視窗每個欄位都要是指定的值;沒寫不算(預設值不是我們要的) */
export function windowFlagProblems(conf: TauriConf, key: string, want: boolean, what: string): string[] {
  const problems: string[] = [];
  for (const label of CARD_WINDOWS) {
    const w = windowOf(conf, label);
    if (!w) { problems.push(`tauri.conf.json 沒有 label 是 ${label} 的視窗`); continue; }
    if (w[key] !== want) problems.push(`視窗 ${label} 的 ${key} 是 ${JSON.stringify(w[key] ?? '(沒寫)')},要明寫 ${want}(${what})`);
  }
  return problems;
}
export const decorationsProblems = (conf: TauriConf = readTauriConf()) => windowFlagProblems(conf, 'decorations', false, '沒有系統外框');
/** T21:透明由程式依合成器決定,設定檔不寫 `transparent`(true、false 都算寫了) */
export function transparencyLeftToAppProblems(conf: TauriConf = readTauriConf()): string[] {
  const problems: string[] = [];
  for (const label of CARD_WINDOWS) {
    const w = windowOf(conf, label);
    if (!w) { problems.push(`tauri.conf.json 沒有 label 是 ${label} 的視窗`); continue; }
    if ('transparent' in w) problems.push(`視窗 ${label} 寫了 transparent: ${JSON.stringify(w['transparent'])}:透明由程式依合成器決定(surface_for),設定檔不寫`);
  }
  return problems;
}
export const hiddenUntilLoadedProblems = (conf: TauriConf = readTauriConf()) => windowFlagProblems(conf, 'visible', false, '載入完才由 Rust 顯示');

// ───────────────────────────── 權限(驗收 2)

interface Capability { identifier?: string; windows?: unknown; permissions?: unknown }

export function readCapability(path = CAPABILITY_FILE): Capability {
  return JSON.parse(readFileSync(path, 'utf8')) as Capability;
}

/** 權限的集合跟六條相等(不多不少、沒有重複)、windows 照舊 */
export function capabilityProblems(cap: Capability = readCapability()): string[] {
  const problems: string[] = [];
  const perms = Array.isArray(cap.permissions) ? cap.permissions : null;
  if (!perms || perms.some((p) => typeof p !== 'string')) return ['permissions 要是字串陣列'];
  const got = perms as string[];
  for (const p of REQUIRED_PERMISSIONS) if (!got.includes(p)) problems.push(`少了權限 ${p}`);
  for (const p of got) if (!(REQUIRED_PERMISSIONS as readonly string[]).includes(p)) problems.push(`多開了權限 ${p}(只准那六條)`);
  if (new Set(got).size !== got.length) problems.push('permissions 有重複的項目');
  if (got.length !== REQUIRED_PERMISSIONS.length) problems.push(`permissions 有 ${got.length} 條,要剛好 ${REQUIRED_PERMISSIONS.length} 條`);
  const windows = cap.windows;
  if (!Array.isArray(windows) || windows.length !== 2 || windows[0] !== 'teach' || windows[1] !== 'test') {
    problems.push(`windows 要照舊是 ["teach","test"],實際是 ${JSON.stringify(windows)}`);
  }
  return problems;
}

// ───────────────────────────── 14 的 class 名字

/** layout.ts 的 FRAMELESS_CLASS、SOLID_CLASS(讀文字,不 import) */
export function layoutClassNames(): { frameless: string; solid: string } {
  const text = readFileSync(LAYOUT_TS, 'utf8');
  const read = (name: string) => {
    const m = new RegExp(`export const ${name} = '([^']+)'`).exec(text);
    if (!m) throw new Error(`layout.ts 沒有 ${name}`);
    return m[1]!;
  };
  return { frameless: read('FRAMELESS_CLASS'), solid: read('SOLID_CLASS') };
}

// ───────────────────────────── 頁面那段程式(window_mode.js)

export interface RunResult {
  /** 跑完之後根元素的 class(集合) */
  classes: string[];
  /** 對根元素(及 classList)做過的事:除了 classList 之外的任何讀寫都列在這裡 */
  touched: string[];
  threw?: string;
}

export interface Mode { frameless: boolean; solid: boolean }

/** 跟 Rust `init_script` 同一個形狀:先一行賦值,再接 window_mode.js */
export function assembleInitScript(mode: Mode, js: string): string {
  return `window.__LC_WINDOW_MODE__ = ${JSON.stringify(mode)};\n${js}`;
}

/**
 * 在 node:vm 裡跑一份完整的 init script。`document.documentElement` 是會記帳的假根元素:
 * 只准碰 classList 的 add / remove / toggle / contains;別的屬性(style、innerHTML、setAttribute…)讀或寫都記在 touched。
 * root = 'null' 時 documentElement 是 null(WebKit 的 document start 防呆)。
 */
export function runInitScript(script: string, opts: { root?: 'present' | 'null' } = {}): RunResult {
  const classes = new Set<string>();
  const touched: string[] = [];
  const classList = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'add') return (...names: string[]) => { for (const n of names) classes.add(n); };
      if (prop === 'remove') return (...names: string[]) => { for (const n of names) classes.delete(n); };
      if (prop === 'toggle') return (name: string, force?: boolean) => {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      };
      if (prop === 'contains') return (name: string) => classes.has(name);
      touched.push(`classList.${String(prop)}`);
      return undefined;
    },
    set(_t, prop) { touched.push(`classList.${String(prop)} = …`); return true; },
  });
  const root = opts.root === 'null' ? null : new Proxy({}, {
    get(_t, prop) {
      if (prop === 'classList') return classList;
      touched.push(`documentElement.${String(prop)}`);
      return undefined;
    },
    set(_t, prop) { touched.push(`documentElement.${String(prop)} = …`); return true; },
  });
  const sandbox: Record<string, unknown> = {};
  sandbox['window'] = sandbox;
  sandbox['document'] = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'documentElement') return root;
      touched.push(`document.${String(prop)}`);
      return undefined;
    },
    set(_t, prop) { touched.push(`document.${String(prop)} = …`); return true; },
  });
  vm.createContext(sandbox);
  let threw: string | undefined;
  try { vm.runInContext(script, sandbox, { timeout: 1000 }); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  return { classes: [...classes].sort(), touched, ...(threw === undefined ? {} : { threw }) };
}

/** 去掉註解再掃(註解可以提到被禁的字) */
function stripComments(js: string): string {
  return js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** 禁用清單:不 innerHTML、不插 <style>、不設 style、不 invoke、不等任何非同步的東西、不連外 */
const FORBIDDEN: [RegExp, string][] = [
  [/innerHTML|outerHTML|insertAdjacentHTML|document\s*\.\s*write/, '用 HTML 字串寫進頁面(innerHTML 一類)'],
  [/<\s*style/i, '插 <style>'],
  [/\.\s*style\b|setAttribute|cssText|adoptedStyleSheets|insertRule|createElement/, '設 style 屬性或建立元素'],
  [/\binvoke\b|__TAURI/, '呼叫 Tauri 的 invoke(非同步,會先畫一次錯的)'],
  [/\bawait\b|\basync\b|\bPromise\b|setTimeout|setInterval|requestAnimationFrame|queueMicrotask|\.then\s*\(/, '等非同步的東西'],
  [/addEventListener|DOMContentLoaded|MutationObserver|readyState/, '等事件或等文件狀態'],
  [/\bfetch\b|XMLHttpRequest|WebSocket|localStorage|sessionStorage|\bimport\b|\beval\b|new\s+Function/, '帶外部資料或動態載入'],
];

export function windowModeJsStaticProblems(js: string): string[] {
  const code = stripComments(js);
  const problems: string[] = [];
  if (code.trim().length === 0) return ['window_mode.js 是空的'];
  for (const [re, what] of FORBIDDEN) if (re.test(code)) problems.push(`window_mode.js 不准${what}(${re.source.split('|')[0]}…)`);
  return problems;
}

/**
 * 行為:兩種模式各跑一次,看根元素最後的 class、有沒有碰別的東西、根元素是 null 時不丟錯。
 * frameless 是 false 的組合也跑(Rust 端永遠給 true,但頁面那段只該照值做事)。
 */
export function windowModeJsBehaviourProblems(js: string): string[] {
  const names = layoutClassNames();
  const problems: string[] = [];
  const cases: { mode: Mode; want: string[] }[] = [
    { mode: { frameless: true, solid: false }, want: [names.frameless] },
    { mode: { frameless: true, solid: true }, want: [names.frameless, names.solid] },
    { mode: { frameless: false, solid: false }, want: [] },
    { mode: { frameless: false, solid: true }, want: [names.solid] },
  ];
  for (const { mode, want } of cases) {
    const r = runInitScript(assembleInitScript(mode, js));
    const tag = `frameless=${mode.frameless} solid=${mode.solid}`;
    if (r.threw) { problems.push(`${tag}:丟了錯 ${r.threw}${r.touched.length ? `(丟錯之前碰了 classList 以外的東西:${r.touched.join(', ')})` : ''}`); continue; }
    if (JSON.stringify(r.classes) !== JSON.stringify([...want].sort())) {
      problems.push(`${tag}:根元素的 class 是 [${r.classes.join(', ')}],要是 [${[...want].sort().join(', ')}]`);
    }
    if (r.touched.length > 0) problems.push(`${tag}:碰了 classList 以外的東西:${r.touched.join(', ')}`);
  }
  const nullRoot = runInitScript(assembleInitScript({ frameless: true, solid: true }, js), { root: 'null' });
  if (nullRoot.threw) problems.push(`document.documentElement 是 null 時丟了錯:${nullRoot.threw}(要直接結束,不丟錯)`);
  return problems;
}

export function readWindowModeJs(): string {
  if (!existsSync(WINDOW_MODE_JS)) throw new Error('apps/desktop/src-tauri/src/window_mode.js 不存在');
  return readFileSync(WINDOW_MODE_JS, 'utf8');
}

// ───────────────────────────── Rust 端:真的組出來的 init script(給 cucumber 場景用)

export const EMIT_TIMEOUT_MS = 300_000;

/** 跑 Rust 測試檔裡的 emit_init_script_for_the_scenarios,取回 `init_script(mode_for(composited))` 的全文 */
export function rustInitScript(composited: boolean): string {
  const { NODE_OPTIONS: _drop, ...env } = process.env;
  const r = spawnSync('cargo', ['test', '--test', 'window_mode', 'emit_init_script_for_the_scenarios', '--', '--exact', '--nocapture'], {
    cwd: SRC_TAURI, encoding: 'utf8', timeout: EMIT_TIMEOUT_MS,
    env: { ...env, LC_WINDOW_MODE_COMPOSITED: composited ? '1' : '0' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.error || r.status !== 0) throw new Error(`cargo test --test window_mode 失敗 status=${r.status ?? 'error'}\n${out.slice(-2500)}`);
  const m = /LC-INIT-SCRIPT-BEGIN\n([\s\S]*?)\nLC-INIT-SCRIPT-END/.exec(out);
  if (!m) throw new Error(`輸出裡找不到 init script:\n${out.slice(-1500)}`);
  return m[1]!;
}

// ───────────────────────────── main.rs、Cargo(靜態)

/** window-state 外掛的 StateFlags 要拿掉 VISIBLE,不然它在頁面載入之前就把視窗打開(驗收 1 的注意) */
export function stateFlagsProblems(mainRs: string): string[] {
  const code = mainRs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const open = /with_state_flags\s*\(/.exec(code);
  if (!open) return ['main.rs 的 window-state 外掛沒有呼叫 with_state_flags(...)(要拿掉 StateFlags::VISIBLE)'];
  let depth = 1; let i = open.index + open[0].length; const from = i;
  for (; i < code.length && depth > 0; i += 1) { if (code[i] === '(') depth += 1; else if (code[i] === ')') depth -= 1; }
  const arg = code.slice(from, i - 1);
  if (!/VISIBLE/.test(arg)) {
    // 沒提到 VISIBLE:只有明列旗標(不含 all())才算拿掉了
    return /all\s*\(\s*\)/.test(arg) ? ['with_state_flags 用了 StateFlags::all() 卻沒有拿掉 VISIBLE'] : [];
  }
  // 提到 VISIBLE:要在「減掉」的位置
  const removed = /(-|&\s*!|&\s*~|\.remove\s*\(|\.difference\s*\()\s*(?:\w+::)*StateFlags\s*::\s*VISIBLE|!\s*(?:\w+::)*StateFlags\s*::\s*VISIBLE/.test(arg)
    || /\bremove\s*\([^)]*VISIBLE|\bdifference\s*\([^)]*VISIBLE/.test(arg);
  const added = /\|\s*(?:\w+::)*StateFlags\s*::\s*VISIBLE|(?:\w+::)*StateFlags\s*::\s*VISIBLE\s*\|/.test(arg);
  if (added || !removed) return [`with_state_flags(${arg.trim()}) 裡的 VISIBLE 不是被拿掉,而是被加進去或看不出被拿掉`];
  return [];
}

/** main.rs 接線(名字由測試檔的 Rust 端固定:ShowGate、SHOW_FALLBACK、on_page_finished、on_timeout) */
export function mainRsProblems(mainRs: string): string[] {
  const code = mainRs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const need: [RegExp, string][] = [
    [/\bis_composited\s*\(/, '沒有問 GDK 有沒有合成器(Screen::is_composited)'],
    [/\binitialization_script\s*\(/, '沒有用 initialization_script 把模式交給頁面'],
    [/\binit_script\s*\(/, '沒有用 window_mode::init_script 組那段程式'],
    [/\bmode_for\s*\(/, '沒有用 window_mode::mode_for 決定模式'],
    [/PageLoadEvent\s*::\s*Finished/, '沒有在 page load 的 Finished 時處理'],
    [/\bShowGate\b/, '沒有用 ShowGate 管「只顯示一次」'],
    [/\bon_page_finished\s*\(/, 'Finished 時沒有呼叫 on_page_finished'],
    [/\bon_timeout\s*\(/, '沒有另開計時、到時呼叫 on_timeout'],
    [/\bSHOW_FALLBACK\b/, '計時沒有用 SHOW_FALLBACK(3 秒)'],
    [/log\s*::\s*warn\s*!/, '逾時顯示時沒有寫 log::warn!'],
    [/\.show\s*\(\s*\)/, '沒有呼叫視窗的 show()'],
  ];
  const problems = need.filter(([re]) => !re.test(code)).map(([, what]) => `main.rs:${what}`);
  problems.push(...stateFlagsProblems(mainRs));
  problems.push(...gdkCfgProblems(mainRs));
  return problems;
}

/** 置頂、setup 視窗照舊(驗收 1 的最後兩條不退步) */
export function mainRsUnchangedProblems(mainRs: string): string[] {
  const problems: string[] = [];
  if (!/set_always_on_top\s*\(\s*true\s*\)/.test(mainRs)) problems.push('main.rs 不再呼叫 set_always_on_top(true)(置頂要照舊)');
  if (!/Focused\s*\(\s*true\s*\)/.test(mainRs)) problems.push('main.rs 不再處理 Focused(true)(拿到焦點時再置頂一次)');
  const setup = /WebviewWindowBuilder::new\s*\(\s*app\s*,\s*start_screen::WINDOW_LABEL[\s\S]*?\.build\s*\(\s*\)/.exec(mainRs)?.[0] ?? '';
  if (!setup) problems.push('main.rs 找不到 setup 視窗的建立(start_screen::WINDOW_LABEL)');
  else if (/decorations\s*\(|\btransparent\s*\(|background_color\s*\(|initialization_script|on_page_load|\bvisible\s*\(/.test(setup)) {
    problems.push('setup 視窗(啟動失敗的畫面)被改成無框/透明/有底色/帶模式/先藏起來了:它不改,照舊有系統外框');
  }
  if (/set_background_color|set_transparent|set_decorations/.test(mainRs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''))) {
    problems.push('main.rs 用了建窗之後才改外觀的 set_background_color / set_transparent / set_decorations(要在 builder 上、.build() 之前)');
  }
  return problems;
}

/** Cargo.toml 逐行切成區塊:標題只認行首(可有空白)的 `[...]`,`#` 開頭的註解行不算;回傳 標題 → 該區塊的行 */
export function tomlSections(toml: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current = '';
  out.set(current, []);
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) continue;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(line);
    if (header) {
      current = header[1]!.replace(/\s+/g, ' ');
      if (!out.has(current)) out.set(current, []);
      continue;
    }
    out.get(current)!.push(line);
  }
  return out;
}

/** gdk 是 GTK,只有 Linux 有:放一般 [dependencies] 會讓 macOS、Windows 一 build 就壞(10 phase-4、phase-5) */
const LINUX_TARGET_DEPS = /^target\.\s*(?:'cfg\(\s*target_os\s*=\s*"linux"\s*\)'|"cfg\(\s*target_os\s*=\s*\\"linux\\"\s*\)")\s*\.dependencies$/;
const GTK_DEP = /^(gdk|gtk)\s*=\s*(.+)$/;

/** gdk(或 gtk)只能直接依賴在 [target.'cfg(target_os = "linux")'.dependencies];lock 裡只有一份 0.18.2 */
export function gdkDependencyProblems(toml: string, lock: string): string[] {
  const problems: string[] = [];
  const found: { section: string; line: string }[] = [];
  for (const [section, lines] of tomlSections(toml)) {
    if (!/dependencies$/.test(section)) continue;
    for (const l of lines) if (GTK_DEP.test(l)) found.push({ section, line: l });
  }
  if (found.length === 0) problems.push('Cargo.toml 沒有直接依賴 gdk(或 gtk)');
  for (const f of found) {
    if (!LINUX_TARGET_DEPS.test(f.section)) {
      problems.push(`Cargo.toml 的 [${f.section}] 有 ${f.line.split('=')[0]!.trim()}:它只能放在 [target.'cfg(target_os = "linux")'.dependencies](GTK 只有 Linux 有,放別處會讓 macOS、Windows 編不過)`);
    }
  }
  const versions = [...lock.matchAll(/\[\[package\]\]\nname = "gdk"\nversion = "([^"]+)"/g)].map((m) => m[1]);
  if (versions.length !== 1) problems.push(`Cargo.lock 裡有 ${versions.length} 份 gdk(${versions.join(', ')}),要剛好一份`);
  else if (versions[0] !== '0.18.2') problems.push(`Cargo.lock 的 gdk 是 ${versions[0]},要維持 0.18.2`);
  for (const f of found) {
    const rhs = GTK_DEP.exec(f.line)![2]!;
    const spec = /^"([^"]+)"/.exec(rhs)?.[1] ?? /version\s*=\s*"([^"]+)"/.exec(rhs)?.[1] ?? '';
    if (spec && !/^[=^~]?\s*0\.18(\.2)?$/.test(spec)) problems.push(`Cargo.toml 的 gdk 版本寫 "${spec}",要跟 lock 的 0.18.2 同一個(寫 "0.18" 或 "0.18.2")`);
  }
  return problems;
}

/**
 * main.rs 用到 gdk 的程式碼(is_composited 那一段)要包在 #[cfg(target_os = "linux")] 裡:
 * 非 Linux 不偵測、直接走透明(不能因為 gdk 編不過而讓整個程式編不過)。
 * 做法:找到每一個 `is_composited(`,往回找包住它的最近一個 `fn`,看那個 fn 前面緊接的屬性裡有沒有 cfg(target_os = "linux")。
 */
export function gdkCfgProblems(mainRs: string): string[] {
  const code = mainRs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const problems: string[] = [];
  const uses = [...code.matchAll(/\bis_composited\s*\(/g)];
  if (uses.length === 0) return ['main.rs 沒有 is_composited('];
  for (const u of uses) {
    const before = code.slice(0, u.index);
    const fnAt = before.lastIndexOf('fn ');
    if (fnAt < 0) { problems.push('is_composited( 不在任何 fn 裡,看不出有沒有 cfg(target_os = "linux")'); continue; }
    const head = before.slice(0, fnAt).split('\n').reverse();
    const attrs: string[] = [];
    for (const l of head) { const t = l.trim(); if (t === '') { if (attrs.length === 0) continue; break; } if (!t.startsWith('#[')) break; attrs.push(t); }
    if (!attrs.some((a) => /^#\[\s*cfg\s*\(\s*target_os\s*=\s*"linux"\s*\)\s*\]$/.test(a))) {
      problems.push('main.rs 用到 gdk 的函式(is_composited 那一段)前面沒有 #[cfg(target_os = "linux")]');
    }
  }
  return problems;
}

// ═════════════════════════════ T21:沒有合成器時的實心底、啟動焦點

export const HUD_CSS = join(SRC_TAURI, '../../../packages/ui-shared/src/hud/hud.css');

/** 拿掉 Rust 的註解(行註解、區塊註解)。字串裡的 `//` 不處理——main.rs 沒有那種字串,有的話量尺會寧可多報 */
export function stripRustComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * 取出 `fn <name>` 的本體(大括號配對,字串字面裡的大括號不算)。找不到回 undefined。
 * 傳進來的字串要已經拿掉註解。
 */
export function rustFnBody(code: string, name: string): string | undefined {
  const head = new RegExp(`\\bfn\\s+${name}\\b`).exec(code);
  if (!head) return undefined;
  let i = code.indexOf('{', head.index);
  if (i < 0) return undefined;
  const start = i + 1;
  let depth = 0;
  for (; i < code.length; i += 1) {
    const ch = code[i]!;
    if (ch === '"') { // 跳過字串字面(含跳脫)
      i += 1;
      while (i < code.length && code[i] !== '"') i += code[i] === '\\' ? 2 : 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return code.slice(start, i); }
  }
  return undefined;
}

/** 呼叫 `name(` 的次數,不算 `fn name(` 的定義 */
export function rustCallCount(code: string, name: string): number {
  return [...code.matchAll(new RegExp(`(?<!\\bfn\\s+)\\b${name}\\s*\\(`, 'g'))].length;
}

/** 永遠不會跑的程式:`if false`、`#[allow(dead_code)]`、`#[cfg(any())]`/`#[cfg(test)]` 包住的東西 */
export function deadCodeProblems(code: string): string[] {
  const problems: string[] = [];
  if (/\bif\s+(false|0)\b/.test(code)) problems.push('有 `if false` 包住的程式(永遠不會跑)');
  if (/#\[\s*allow\s*\(\s*(dead_code|unreachable_code|unused)\b/.test(code)) problems.push('有 #[allow(dead_code)] 一類的屬性(接線不能靠被允許的死程式)');
  if (/#\[\s*cfg\s*\(\s*(any\s*\(\s*\)|test)\b/.test(code)) problems.push('有 #[cfg(any())] / #[cfg(test)] 包住的程式(release 不會編進去)');
  return problems;
}

// ───────────────────────────── 色值:SOLID_BACKGROUND = hud.css 的 --hud-solid(驗收 2)

/** `:root { … }` 裡 `--hud-solid` 的 #rrggbb;找不到、格式不對 → undefined(呼叫端報錯,不跳過) */
export function hudSolidFromCss(css: string): [number, number, number] | undefined {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const root of code.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const decl of root[1]!.split(';')) {
      const m = /^\s*--hud-solid\s*:\s*(.*?)\s*$/s.exec(decl);
      if (!m) continue;
      const hex = /^#([0-9a-fA-F]{6})$/.exec(m[1]!);
      if (!hex) return undefined;
      const h = hex[1]!;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
  }
  return undefined;
}

/** window_mode.rs 的 `pub const NAME: [u8; 4] = [0x.., ...];`(十進位或十六進位都讀) */
export function rustByteArrayConst(rs: string, name: string): number[] | undefined {
  const m = new RegExp(`pub\\s+const\\s+${name}\\s*:\\s*\\[\\s*u8\\s*;\\s*4\\s*\\]\\s*=\\s*\\[([^\\]]*)\\]`).exec(stripRustComments(rs));
  if (!m) return undefined;
  const items = m[1]!.split(',').map((x) => x.trim()).filter((x) => x !== '');
  const nums = items.map((x) => (/^0x[0-9a-fA-F]+$/.test(x) ? parseInt(x, 16) : /^\d+$/.test(x) ? parseInt(x, 10) : NaN));
  return nums.some(Number.isNaN) ? undefined : nums;
}

export function solidBackgroundProblems(rs: string = readFileSync(WINDOW_MODE_RS, 'utf8'), css: string = readFileSync(HUD_CSS, 'utf8')): string[] {
  const want = hudSolidFromCss(css);
  if (!want) return ['hud.css 的 :root 裡讀不到 --hud-solid 的 #rrggbb(量尺不跳過,格式變了就要改量尺)'];
  const got = rustByteArrayConst(rs, 'SOLID_BACKGROUND');
  if (!got || got.length !== 4) return ['window_mode.rs 沒有 `pub const SOLID_BACKGROUND: [u8; 4] = [...]`(或有看不懂的項目)'];
  const problems: string[] = [];
  if (got[0] !== want[0] || got[1] !== want[1] || got[2] !== want[2]) {
    problems.push(`SOLID_BACKGROUND 的 RGB 是 [${got.slice(0, 3).join(', ')}],hud.css 的 --hud-solid 是 [${want.join(', ')}]:兩邊要一樣`);
  }
  if (got[3] !== 255) problems.push(`SOLID_BACKGROUND 的 alpha 是 ${got[3]},要是 255(不透明)`);
  return problems;
}

/** STARTUP_FOCUS 的值(window_mode.rs 的 `pub const STARTUP_FOCUS: &str = "…";`) */
export function startupFocusConst(rs: string = readFileSync(WINDOW_MODE_RS, 'utf8')): string | undefined {
  return /pub\s+const\s+STARTUP_FOCUS\s*:\s*&(?:'static\s+)?str\s*=\s*"([^"]*)"/.exec(stripRustComments(rs))?.[1];
}

/** 啟動焦點的目標是考試卡,而且是 tauri.conf.json 裡的一個視窗標籤 */
export function startupFocusTargetProblems(rs: string = readFileSync(WINDOW_MODE_RS, 'utf8'), conf: TauriConf = readTauriConf()): string[] {
  const value = startupFocusConst(rs);
  if (value === undefined) return ['window_mode.rs 沒有 `pub const STARTUP_FOCUS: &str = "…";`'];
  const problems: string[] = [];
  if (value !== 'test') problems.push(`STARTUP_FOCUS 是 "${value}",要是 "test"(考試卡)`);
  const labels = (conf.app?.windows ?? []).map((w) => w.label);
  if (!labels.includes(value)) problems.push(`STARTUP_FOCUS "${value}" 不是 tauri.conf.json 裡的視窗標籤(${labels.join(', ')})`);
  return problems;
}

// ───────────────────────────── main.rs 的接線(取函式本體再斷言)

/** 這幾條都對「已經拿掉註解」的 main.rs 做 */
const OPEN = 'open_windows';

/** open_windows 被 .setup 呼叫;arm_show_fallback 與 desktop_is_composited 真的被呼叫(定義還在不算) */
export function callGraphProblems(code: string): string[] {
  const problems: string[] = [];
  const body = rustFnBody(code, OPEN);
  if (body === undefined) return [`main.rs 找不到 fn ${OPEN}`];
  if (!/\.setup\s*\([^)]*\b(?:open_windows)\s*\(/.test(code)) problems.push('.setup(...) 沒有呼叫 open_windows');
  if (rustCallCount(body, 'arm_show_fallback') < 1) problems.push('open_windows 沒有呼叫 arm_show_fallback(定義在、呼叫被拿掉:3 秒退路等於沒有)');
  if (rustCallCount(body, 'desktop_is_composited') !== 1) problems.push(`open_windows 裡 desktop_is_composited 要剛好呼叫一次,實際 ${rustCallCount(body, 'desktop_is_composited')} 次`);
  if (rustCallCount(code, 'desktop_is_composited') !== rustCallCount(body, 'desktop_is_composited')) problems.push('desktop_is_composited 在 open_windows 之外也被呼叫(只准問一次)');
  return problems;
}

/** `let X = … surface_for(M) …` 的 X;`init_script(M2)` 的 M2;兩個 M 要是同一個識別字,而且是 `mode_for(` 的結果 */
export function modeVariableProblems(body: string): string[] {
  const problems: string[] = [];
  const surfaceArg = /\bsurface_for\s*\(\s*([A-Za-z_]\w*)\s*\)/.exec(body)?.[1];
  const scriptArg = /\binit_script\s*\(\s*([A-Za-z_]\w*)\s*\)/.exec(body)?.[1];
  if (!surfaceArg) problems.push('open_windows 沒有 surface_for(<變數>)(參數要是一個變數,不是呼叫或字面)');
  if (!scriptArg) problems.push('open_windows 沒有 init_script(<變數>)');
  if (surfaceArg && scriptArg && surfaceArg !== scriptArg) problems.push(`surface_for(${surfaceArg}) 與 init_script(${scriptArg}) 用的不是同一個 mode`);
  const modeVar = surfaceArg ?? scriptArg;
  if (modeVar && !new RegExp(`\\blet\\s+(?:mut\\s+)?${modeVar}\\s*=[^;]*\\bmode_for\\s*\\(`).test(body)) {
    problems.push(`${modeVar} 不是 mode_for(...) 的結果(模式只在一個地方決定)`);
  }
  return problems;
}

/** 卡片視窗的 builder:.transparent(<surface>.transparent) 與有條件的 .background_color(...),都在 .build() 之前 */
export function builderProblems(body: string): string[] {
  const problems: string[] = [];
  const surfaceVar = /\blet\s+(?:mut\s+)?([A-Za-z_]\w*)\s*=\s*(?:\w+::)*surface_for\s*\(/.exec(body)?.[1];
  const from = body.search(/WebviewWindowBuilder\s*::\s*from_config\s*\(/);
  if (from < 0) return ['open_windows 找不到卡片視窗的 WebviewWindowBuilder::from_config'];
  const buildAt = body.slice(from).search(/\.build\s*\(\s*\)/);
  if (buildAt < 0) return ['卡片視窗的 builder 沒有 .build()'];
  const before = body.slice(from, from + buildAt);
  const after = body.slice(from + buildAt);
  if (!surfaceVar) { problems.push('open_windows 沒有 `let <變數> = surface_for(...)`'); return problems; }
  const transparentCalls = [...before.matchAll(/\.transparent\s*\(([^)]*)\)/g)];
  if (transparentCalls.length === 0) problems.push('卡片視窗的 builder 在 .build() 之前沒有 .transparent(...)');
  for (const c of transparentCalls) {
    if (c[1]!.trim() !== `${surfaceVar}.transparent`) problems.push(`.transparent(${c[1]!.trim()}):參數要是 ${surfaceVar}.transparent(來自 surface_for),不是字面或別的值`);
  }
  if (/\.(transparent|background_color)\s*\(/.test(after)) problems.push('.build() 之後才設 transparent 或 background_color(要在 builder 上、建窗之前)');
  const bg = [...before.matchAll(/\.background_color\s*\(([^)]*(?:\([^)]*\))?[^)]*)\)/g)];
  if (bg.length === 0) problems.push('卡片視窗的 builder 在 .build() 之前沒有 .background_color(...)(沒有合成器時要塗底色)');
  for (const c of bg) {
    if (/\d/.test(c[1]!.replace(/\[\s*\d\s*\]/g, ''))) problems.push(`.background_color(${c[1]!.trim()}) 有寫死的數字:底色要來自 ${surfaceVar}.background`);
  }
  const between = body.slice(from, from + buildAt + 1);
  const conditional = new RegExp(
    `if\\s+let\\s+Some\\s*\\([^)]*\\)\\s*=\\s*${surfaceVar}\\.background|match\\s+${surfaceVar}\\.background|${surfaceVar}\\.background\\s*\\.\\s*(?:map|map_or|map_or_else|filter|into_iter|iter|is_some)\\b`,
  );
  const wholeBefore = body.slice(0, from + buildAt);
  if (bg.length > 0 && !conditional.test(wholeBefore) && !conditional.test(between)) {
    problems.push(`.background_color 沒有「只在 ${surfaceVar}.background 是 Some 時」才呼叫(有合成器時不塗底色)`);
  }
  return problems;
}

/** 卡片視窗接線的全部(驗收 3) */
export function surfaceWiringProblems(mainRs: string): string[] {
  const code = stripRustComments(mainRs);
  const body = rustFnBody(code, OPEN);
  if (body === undefined) return [`main.rs 找不到 fn ${OPEN}`];
  return [...callGraphProblems(code), ...modeVariableProblems(body), ...builderProblems(body), ...deadCodeProblems(code)];
}

// ───────────────────────────── 啟動焦點的接線(驗收 8)

/** 本體裡有 `on_shown(` 的函式名(除了 open_windows):顯示的地方可以呼叫它代替直接叫 on_shown */
function focusHelpers(code: string): string[] {
  const names: string[] = [];
  for (const m of code.matchAll(/\bfn\s+([A-Za-z_]\w*)/g)) {
    const name = m[1]!;
    if (name === OPEN) continue;
    if (/\bon_shown\s*\(/.test(rustFnBody(code, name) ?? '')) names.push(name);
  }
  return names;
}

/** `region` 裡 `.show()` 之後有沒有通知(直接 on_shown,或叫會 on_shown 的函式);通知的參數不是字串字面 */
export function notifiesAfterShow(region: string, helpers: string[]): string | undefined {
  const show = region.search(/\.show\s*\(\s*\)/);
  if (show < 0) return '這一段沒有 .show()';
  const tail = region.slice(show);
  const call = new RegExp(`\\b(?:on_shown${helpers.map((h) => `|${h}`).join('')})\\s*\\(([^)]*)\\)`).exec(tail);
  if (!call) return '.show() 之後沒有通知 StartupFocus(on_shown 或會呼叫它的函式)';
  if (/"[^"]*"/.test(call[1]!)) return `通知的參數 (${call[1]!.trim()}) 有字串字面:要傳這個視窗自己的標籤`;
  return undefined;
}

export function focusWiringProblems(mainRs: string): string[] {
  const code = stripRustComments(mainRs);
  const body = rustFnBody(code, OPEN);
  if (body === undefined) return [`main.rs 找不到 fn ${OPEN}`];
  const problems: string[] = [];
  const helpers = focusHelpers(code);

  // 一個 StartupFocus,在迴圈之前,用 start_screen::windows 的那一份標籤
  const news = [...body.matchAll(/\bStartupFocus\s*::\s*new\s*\(([^;]*?)\)\s*[;)]/g)];
  if (news.length !== 1) problems.push(`open_windows 裡 StartupFocus::new 要剛好一個,實際 ${news.length} 個`);
  else {
    const loop = body.search(/\bfor\s+\w+\s+in\b/);
    if (loop >= 0 && news[0]!.index! > loop) problems.push('StartupFocus::new 在 for 迴圈裡面或之後:每個視窗會各有一個,不是共用一個');
    const arg = news[0]![1]!.trim();
    const labelsVar = /\blet\s+(?:mut\s+)?([A-Za-z_]\w*)\s*=[^;]*start_screen\s*::\s*windows\s*\(/.exec(body)?.[1];
    if (!/start_screen\s*::\s*windows\s*\(/.test(arg) && !(labelsVar && new RegExp(`\\b${labelsVar}\\b`).test(arg))) {
      problems.push(`StartupFocus::new(${arg}) 的標籤要是 start_screen::windows(state) 那一份`);
    }
  }
  if (!/\bArc\b/.test(body) || !/\bMutex\b/.test(body) || !/StartupFocus/.test(body)) problems.push('open_windows 要把 StartupFocus 放進 Arc<Mutex<…>> 給每個視窗共用');

  // 兩個顯示的地方:page load 的 Finished(on_page_finished → show)、arm_show_fallback 的逾時(on_timeout → show)
  const pageLoad = /\.on_page_load\s*\(([\s\S]*?)\.build\s*\(\s*\)/.exec(body)?.[1];
  if (!pageLoad) problems.push('open_windows 找不到 on_page_load(...) 到 .build() 的那一段');
  else {
    const finished = pageLoad.slice(Math.max(0, pageLoad.search(/\bon_page_finished\s*\(/)));
    const why = notifiesAfterShow(finished, helpers);
    if (why) problems.push(`page load 的 Finished 那條:${why}`);
  }
  const fallback = rustFnBody(code, 'arm_show_fallback');
  if (fallback === undefined) problems.push('main.rs 找不到 fn arm_show_fallback');
  else {
    const timeout = fallback.slice(Math.max(0, fallback.search(/\bon_timeout\s*\(/)));
    const why = notifiesAfterShow(timeout, helpers);
    if (why) problems.push(`arm_show_fallback 的逾時那條:${why}`);
  }

  // set_focus 只有一處,而且在「on_shown 回 Some(標籤)」的分支裡、對 get_webview_window(<那個標籤>)
  const focusCalls = [...code.matchAll(/\.set_focus\s*\(/g)];
  if (focusCalls.length !== 1) problems.push(`main.rs 裡 set_focus 要剛好一處,實際 ${focusCalls.length} 處`);
  else {
    const at = focusCalls[0]!.index!;
    const around = code.slice(Math.max(0, at - 500), at);
    // on_shown 的回傳要先被拿來決定(Some 才動):它在 set_focus 之前的這一段裡,而且 get_webview_window 的參數是變數(on_shown 回的標籤),不是字面
    if (!/\bon_shown\s*\(/.test(around) && !helpers.some((h) => new RegExp(`\\b${h}\\s*\\(`).test(around))) {
      problems.push('set_focus 之前沒有 on_shown(...):不能不管兩個視窗都顯示了沒就給焦點');
    }
    const arg = /get_webview_window\s*\(\s*([^)]*?)\s*\)/.exec(around.slice(around.lastIndexOf('get_webview_window') >= 0 ? around.lastIndexOf('get_webview_window') : 0))?.[1];
    if (arg === undefined) problems.push('set_focus 要對 get_webview_window(<on_shown 回的標籤>) 拿到的視窗');
    else if (!/^[A-Za-z_]\w*$/.test(arg)) problems.push(`get_webview_window(${arg}):參數要是 on_shown 回的標籤(一個變數)`);
    if (/get_webview_window\s*\(\s*"[^"]*"\s*\)/.test(around)) problems.push('set_focus 對寫死的標籤 get_webview_window("…")');
  }
  return problems;
}

// ───────────────────────────── Rust 端:給 cucumber 場景用(跑 tests/window_mode.rs 的 emit 測試)

export interface SurfaceEmit { transparent: boolean; background: number[] | null; solidBackground: number[] }
export interface StartupFocusEmit { calls: string[]; results: (string | null)[] }

function cargoEmit(testName: string, env: Record<string, string>, begin: string, end: string): string {
  const { NODE_OPTIONS: _drop, ...base } = process.env;
  const r = spawnSync('cargo', ['test', '--test', 'window_mode', testName, '--', '--exact', '--nocapture'], {
    cwd: SRC_TAURI, encoding: 'utf8', timeout: EMIT_TIMEOUT_MS, env: { ...base, ...env },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.error || r.status !== 0) throw new Error(`cargo test --test window_mode ${testName} 失敗 status=${r.status ?? 'error'}\n${out.slice(-2500)}`);
  const m = new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`).exec(out);
  if (!m) throw new Error(`輸出裡找不到 ${begin}:\n${out.slice(-1500)}`);
  return m[1]!;
}

/** Rust 端真的算出來的 surface_for(mode_for(composited)) */
export function rustSurface(composited: boolean): SurfaceEmit {
  return JSON.parse(cargoEmit('emit_surface_for_the_scenarios', { LC_WINDOW_MODE_COMPOSITED: composited ? '1' : '0' }, 'LC-SURFACE-BEGIN', 'LC-SURFACE-END')) as SurfaceEmit;
}

/** 先顯示 first、再顯示另一個、然後兩個各再顯示一次,每次 on_shown 的回傳 */
export function rustStartupFocus(first: 'teach' | 'test'): StartupFocusEmit {
  return JSON.parse(cargoEmit('emit_startup_focus_for_the_scenarios', { LC_STARTUP_FIRST: first }, 'LC-STARTUP-FOCUS-BEGIN', 'LC-STARTUP-FOCUS-END')) as StartupFocusEmit;
}
