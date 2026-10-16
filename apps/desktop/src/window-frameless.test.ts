/**
 * 10-desktop-shell phase-6(工單 T16)的 vitest:視窗設定、權限、頁面那段程式、main.rs 與 Cargo 的靜態檢查、不退步。
 * 測試 agent 寫;開發 worker 不改。量尺在 test-support/window-frame.ts(cucumber 的 desktop-shell-phase6.steps.ts 共用)。
 *
 * 自測用的片段一律是最小的合成片段(一兩行、每一條只為了讓量尺的某一個判斷出聲),不放可以直接抄的完整實作。
 * 合成器偵測(GDK)沒有自動測試,靠 @manual 的 Xvfb 有 / 沒有 xcompmgr。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTauriConf } from './test-support/frontend-dist.js';
import {
  CARGO_LOCK, CARGO_TOML, MAIN_RS, REQUIRED_PERMISSIONS, assembleInitScript, builderProblems, callGraphProblems, capabilityProblems, deadCodeProblems, decorationsProblems,
  focusWiringProblems, gdkCfgProblems, gdkDependencyProblems, hiddenUntilLoadedProblems, hudSolidFromCss, layoutClassNames, mainRsProblems, mainRsUnchangedProblems,
  modeVariableProblems, notifiesAfterShow, readCapability, readWindowModeJs, runInitScript, rustByteArrayConst, rustCallCount, rustFnBody, solidBackgroundProblems,
  startupFocusConst, startupFocusTargetProblems, stateFlagsProblems, stripRustComments, surfaceWiringProblems, transparencyLeftToAppProblems,
  windowModeJsBehaviourProblems, windowModeJsStaticProblems,
} from './test-support/window-frame.js';

const REPO = join(import.meta.dirname, '../../..');

describe('兩個視窗的設定(驗收 1、場景 1)', () => {
  it('兩個視窗都沒有系統外框:decorations 明寫 false', () => {
    expect(decorationsProblems()).toEqual([]);
  });
  it('設定檔不寫 transparent(T21):透明由程式依合成器決定,teach、test 都沒有這個鍵', () => {
    expect(transparencyLeftToAppProblems()).toEqual([]);
  });
  it('兩個視窗都先藏起來:visible 明寫 false,載入完才由 Rust 顯示', () => {
    expect(hiddenUntilLoadedProblems()).toEqual([]);
  });
  it('setup 視窗(啟動失敗的畫面)不在設定檔裡,仍由 main.rs 動態建立、不改', () => {
    const labels = (readTauriConf().app?.windows ?? []).map((w) => w.label).sort();
    expect(labels).toEqual(['teach', 'test']);
    expect(mainRsUnchangedProblems(readFileSync(MAIN_RS, 'utf8'))).toEqual([]);
  });
  it('window-state 外掛的 StateFlags 拿掉 VISIBLE(不然它在頁面載入前就把視窗打開)', () => {
    expect(stateFlagsProblems(readFileSync(MAIN_RS, 'utf8'))).toEqual([]);
  });
});

describe('權限剛好六條(驗收 2、場景 2)', () => {
  it('permissions 跟那六條集合相等、沒有重複,windows 仍是 teach 與 test', () => {
    expect(capabilityProblems()).toEqual([]);
  });
  it('六條裡有開始拖曳、開始縮放拖曳、縮小、關閉', () => {
    const got = readCapability().permissions as string[];
    for (const p of ['core:window:allow-start-dragging', 'core:window:allow-start-resize-dragging', 'core:window:allow-minimize', 'core:window:allow-close']) {
      expect(got, p).toContain(p);
    }
    expect(REQUIRED_PERMISSIONS).toHaveLength(6);
  });
});

describe('頁面那段程式 window_mode.js(驗收 3、場景 3 與 Scenario Outline)', () => {
  it('class 名字跟 14 的 layout.ts 一樣(hud-frameless、hud-solid),不是自己寫一份', () => {
    const names = layoutClassNames();
    expect(names).toEqual({ frameless: 'hud-frameless', solid: 'hud-solid' });
    const js = readWindowModeJs();
    expect(js).toContain(names.frameless);
    expect(js).toContain(names.solid);
  });
  it('有合成器:根元素只有 hud-frameless;沒有合成器:hud-frameless 與 hud-solid;不碰 classList 以外的東西;根元素是 null 不丟錯', () => {
    expect(windowModeJsBehaviourProblems(readWindowModeJs())).toEqual([]);
  });
  it('靜態:不用 innerHTML、不插 <style>、不設 style 屬性、不呼叫 invoke、不等任何非同步、不帶外部資料', () => {
    expect(windowModeJsStaticProblems(readWindowModeJs())).toEqual([]);
  });
  it('跟 Rust 組出來的那一行接起來之後也成立(兩行格式:先賦值,再接這個檔)', () => {
    const r = runInitScript(assembleInitScript({ frameless: true, solid: false }, readWindowModeJs()));
    expect(r.threw).toBeUndefined();
    expect(r.classes).toEqual(['hud-frameless']);
  });
});

describe('量尺自測:壞的頁面程式會被抓到(最小合成片段)', () => {
  const mode = { frameless: true, solid: false };
  const classesOf = (js: string) => runInitScript(assembleInitScript(mode, js)).classes;

  it('不論模式都加 solid → 行為檢查紅', () => {
    expect(windowModeJsBehaviourProblems(`document.documentElement.classList.add('hud-frameless', 'hud-solid');`).join('\n')).toMatch(/solid=false/);
  });
  it('class 名字寫錯字 → 行為檢查紅', () => {
    expect(windowModeJsBehaviourProblems(`document.documentElement.classList.add('hud-frame-less');`).join('\n')).toMatch(/要是 \[hud-frameless\]/);
  });
  it('根元素是 null 時丟錯 → 行為檢查紅', () => {
    expect(windowModeJsBehaviourProblems(`document.documentElement.classList.add('hud-frameless');`).join('\n')).toMatch(/null 時丟了錯/);
  });
  it('設 style 屬性 → 行為檢查與靜態檢查都紅', () => {
    const js = `document.documentElement.style.background = 'red';`;
    expect(windowModeJsBehaviourProblems(js).join('\n')).toMatch(/碰了 classList 以外的東西:documentElement\.style/);
    expect(windowModeJsStaticProblems(js).join('\n')).toMatch(/style/);
  });
  it('靜態檢查逐項抓得到', () => {
    for (const bad of ['a.innerHTML = 1;', "x('<style>');", 'a.setAttribute("x","y");', 'invoke("m");', 'await z;', 'setTimeout(f, 0);', 'fetch("u");', "addEventListener('x', f);"]) {
      expect(windowModeJsStaticProblems(bad), bad).not.toEqual([]);
    }
  });
  it('註解裡提到被禁的字不算', () => {
    expect(windowModeJsStaticProblems('// 不用 innerHTML\n/* invoke 也不用 */\nvoid 0;')).toEqual([]);
  });
  it('跑的是 window.__LC_WINDOW_MODE__ 的值:給 solid 才出現 solid', () => {
    const js = `if (window.__LC_WINDOW_MODE__.solid) document.documentElement.classList.add('s');`;
    expect(classesOf(js)).toEqual([]);
    expect(runInitScript(assembleInitScript({ frameless: true, solid: true }, js)).classes).toEqual(['s']);
  });
});

describe('main.rs 的接線(靜態;驗收 1、3)', () => {
  it('問 GDK、用 initialization_script、page load 的 Finished 與另開的計時各呼叫 ShowGate,逾時寫 warn', () => {
    expect(mainRsProblems(readFileSync(MAIN_RS, 'utf8'))).toEqual([]);
  });
  it('StateFlags 檢查抓得到:沒呼叫、用 all()、把 VISIBLE 加進去', () => {
    expect(stateFlagsProblems('Builder::default().build()')).not.toEqual([]);
    expect(stateFlagsProblems('Builder::default().with_state_flags(StateFlags::all()).build()')).not.toEqual([]);
    expect(stateFlagsProblems('x.with_state_flags(StateFlags::SIZE | StateFlags::VISIBLE).build()')).not.toEqual([]);
    expect(stateFlagsProblems('x.with_state_flags(StateFlags::all() - StateFlags::VISIBLE).build()')).toEqual([]);
    expect(stateFlagsProblems('x.with_state_flags(StateFlags::SIZE | StateFlags::POSITION).build()')).toEqual([]);
  });
});

describe('Cargo:gdk 只在 Linux 的依賴區塊、lock 裡不多出第二份(驗收 3)', () => {
  it('Cargo.toml 直接依賴 gdk(或 gtk)且只放在 [target.\'cfg(target_os = "linux")\'.dependencies],Cargo.lock 的 gdk 仍是唯一一份 0.18.2', () => {
    expect(gdkDependencyProblems(readFileSync(CARGO_TOML, 'utf8'), readFileSync(CARGO_LOCK, 'utf8'))).toEqual([]);
  });
  it('main.rs 用 gdk 的函式包在 #[cfg(target_os = "linux")] 裡(非 Linux 不偵測)', () => {
    expect(gdkCfgProblems(readFileSync(MAIN_RS, 'utf8'))).toEqual([]);
  });
  const lock = '[[package]]\nname = "gdk"\nversion = "0.18.2"\n';
  const LINUX = `[target.'cfg(target_os = "linux")'.dependencies]`;
  it('檢查抓得到:沒直接依賴、兩份 gdk、版本不同', () => {
    expect(gdkDependencyProblems('[dependencies]\nlog = "0.4"\n', lock).join('\n')).toMatch(/沒有直接依賴/);
    expect(gdkDependencyProblems(`${LINUX}\ngdk = "0.18"\n`, `${lock}\n[[package]]\nname = "gdk"\nversion = "0.19.0"\n`).join('\n')).toMatch(/2 份/);
    expect(gdkDependencyProblems(`${LINUX}\ngdk = "0.19"\n`, lock).join('\n')).toMatch(/同一個/);
    expect(gdkDependencyProblems(`${LINUX}\ngdk = "0.18"\n`, lock)).toEqual([]);
  });
  it('檢查抓得到:gdk 放在一般 [dependencies] 或別的平台區塊', () => {
    expect(gdkDependencyProblems('[dependencies]\ngdk = "0.18"\n', lock).join('\n')).toMatch(/只能放在/);
    expect(gdkDependencyProblems(`[target.'cfg(windows)'.dependencies]\ngdk = "0.18"\n`, lock).join('\n')).toMatch(/只能放在/);
    expect(gdkDependencyProblems(`[dependencies]\ngdk = "0.18"\n${LINUX}\ngdk = "0.18"\n`, lock).join('\n')).toMatch(/\[dependencies\] 有 gdk/);
  });
  it('檢查逐行掃區塊標題:前面有別的 target 區塊、註解裡寫區塊標題都不影響', () => {
    const toml = `[dependencies]\nlog = "0.4"\n\n[target.'cfg(unix)'.dependencies]\nlibc = "0.2"\n\n# [target.'cfg(target_os = "linux")'.dependencies] 先放這裡\n${LINUX}\ngdk = "0.18" # 同 lock\n`;
    expect(gdkDependencyProblems(toml, lock)).toEqual([]);
    expect(gdkDependencyProblems(`# ${LINUX}\n[dependencies]\ngdk = "0.18"\n`, lock).join('\n')).toMatch(/只能放在/);
  });
  it('cfg 檢查抓得到:沒有 cfg、cfg 是別的平台;有 cfg 的通過(最小合成片段)', () => {
    expect(gdkCfgProblems('fn probe() -> bool { s.is_composited() }').join('\n')).toMatch(/沒有 #\[cfg/);
    expect(gdkCfgProblems('#[cfg(unix)]\nfn probe() -> bool { s.is_composited() }').join('\n')).toMatch(/沒有 #\[cfg/);
    expect(gdkCfgProblems('#[cfg(target_os = "linux")]\nfn probe() -> bool { s.is_composited() }')).toEqual([]);
  });
});

describe('日誌預設 filter(驗收 1 逾時退路的 warn 要看得到)', () => {
  const lib = () => readFileSync(join(REPO, 'apps/desktop/src-tauri/src/lib.rs'), 'utf8');
  it('init_logging 的預設 filter 來自 log_filter(RUST_LOG),不再是 default_filter_or("error")', () => {
    const body = /pub fn init_logging\s*\(\s*\)\s*\{([\s\S]*?)\n\}/.exec(lib())?.[1] ?? '';
    expect(body, 'lib.rs 找不到 init_logging').not.toBe('');
    expect(body).toMatch(/log_filter\s*\(/);
    expect(body).not.toMatch(/default_filter_or\s*\(\s*"error"\s*\)/);
    expect(body).toMatch(/RUST_LOG/);
  });
});

describe('不退步:done phase 的 .feature 沒改(驗收 10)', () => {
  // 雜湊是這一批(T21 紅測試)落地時的內容;done phase 的 .feature 不改,phase-6 的以 T21 的最終檔為準。
  const PINNED: [string, string][] = [
    ['features/10-desktop-shell/phase-1.feature', '39b0cf091a2309fc12033471652ba3d9389652e2f38900ebf9b3192612290f66'],
    ['features/10-desktop-shell/phase-2.feature', '73c22987e9565f1893a97b9f2fe8bd71dcdb56b7724e86638572e81d04fab505'],
    // T21 之後的內容(2026-10-16,工單 T21 的場景一併進來)
    ['features/10-desktop-shell/phase-6.feature', 'c499e3d96062684606512fcce5ed99942d697bf5a45b9843a80a58943944d04c'],
    ['features/14-hud-skin/phase-1.feature', '7bddbc8f67fb626a39770a403af365b508ed65ece345cd23fcdc2e178659633a'],
    ['features/14-hud-skin/phase-2.feature', 'fd79522575336c324bef608e47a8ce790c3f7d53422b7c3cb4fc1255409cccd4'],
  ];
  it.each(PINNED)('%s 內容沒變', (file, sha) => {
    expect(createHash('sha256').update(readFileSync(join(REPO, file))).digest('hex')).toBe(sha);
  });
});

// ═════════════════════════════ T21:沒有合成器時的實心底(驗收 1–4)與啟動焦點(驗收 8)
// 自測用的片段一律是最小的合成片段(只為了讓量尺的某一個判斷出聲),不放可以直接抄的完整實作。

const WINDOW_MODE_RS = join(REPO, 'apps/desktop/src-tauri/src/window_mode.rs');
const rustSrc = () => readFileSync(WINDOW_MODE_RS, 'utf8');
const mainSrc = () => readFileSync(MAIN_RS, 'utf8');

describe('色值:SOLID_BACKGROUND = hud.css 的 --hud-solid(驗收 2)', () => {
  it('window_mode.rs 的 SOLID_BACKGROUND 的 RGB 等於 hud.css :root 的 --hud-solid,alpha 是 255', () => {
    expect(solidBackgroundProblems()).toEqual([]);
  });
  it('hud.css 現在讀得到 #rrggbb(量尺不跳過:格式變了就要改量尺)', () => {
    expect(hudSolidFromCss(readFileSync(join(REPO, 'packages/ui-shared/src/hud/hud.css'), 'utf8'))).toBeDefined();
  });
  it('量尺自測:兩邊任一邊改了、alpha 不是 255、讀不到 → 紅', () => {
    const css = ':root { --hud-solid: #f4f6f8; }';
    const rs = (arr: string) => `pub const SOLID_BACKGROUND: [u8; 4] = ${arr};`;
    expect(solidBackgroundProblems(rs('[0xf4, 0xf6, 0xf8, 0xff]'), css)).toEqual([]);
    expect(solidBackgroundProblems(rs('[244, 246, 248, 255]'), css)).toEqual([]);
    expect(solidBackgroundProblems(rs('[0xf4, 0xf6, 0xf9, 0xff]'), css).join('\n')).toMatch(/兩邊要一樣/);
    expect(solidBackgroundProblems(rs('[0xf4, 0xf6, 0xf8, 0xff]'), ':root { --hud-solid: #f4f6f9; }').join('\n')).toMatch(/兩邊要一樣/);
    expect(solidBackgroundProblems(rs('[0xf4, 0xf6, 0xf8, 0x80]'), css).join('\n')).toMatch(/alpha/);
    expect(solidBackgroundProblems('pub const OTHER: u8 = 1;', css).join('\n')).toMatch(/沒有/);
    expect(solidBackgroundProblems(rs('[0xf4, 0xf6, 0xf8, 0xff]'), ':root { --hud-ink: #000000; }').join('\n')).toMatch(/讀不到/);
  });
  it('hud.css 解析的邊角:別的區塊同名、三碼、!important、註解', () => {
    expect(hudSolidFromCss(':root { --hud-solid: #f4f6f8; }')).toEqual([0xf4, 0xf6, 0xf8]);
    expect(hudSolidFromCss('.hud-dark { --hud-solid: #000000; }\n:root { --hud-solid: #f4f6f8; }')).toEqual([0xf4, 0xf6, 0xf8]);
    expect(hudSolidFromCss('.hud-dark { --hud-solid: #000000; }\n:root { --hud-ink: #111111; }')).toBeUndefined();
    expect(hudSolidFromCss(':root { --hud-solid: #FFF; }')).toBeUndefined();
    expect(hudSolidFromCss(':root { --hud-solid: #f4f6f8 !important; }')).toBeUndefined();
    expect(hudSolidFromCss(':root { /* --hud-solid: #000000; */ }')).toBeUndefined();
    expect(hudSolidFromCss(':root { /* --hud-solid: #000000; */ --hud-solid: #f4f6f8; }')).toEqual([0xf4, 0xf6, 0xf8]);
  });
  it('rustByteArrayConst:十六進位與十進位都讀,註解裡的不算,看不懂的項目回 undefined', () => {
    expect(rustByteArrayConst('pub const X: [u8; 4] = [0xf4, 246, 0xF8, 0xff];', 'X')).toEqual([0xf4, 246, 0xf8, 255]);
    expect(rustByteArrayConst('// pub const X: [u8; 4] = [1, 2, 3, 4];', 'X')).toBeUndefined();
    expect(rustByteArrayConst('pub const X: [u8; 4] = [1, A, 3, 4];', 'X')).toBeUndefined();
  });
});

describe('啟動焦點的目標(驗收 8)', () => {
  it('STARTUP_FOCUS 是 "test",而且是 tauri.conf.json 裡的視窗標籤', () => {
    expect(startupFocusTargetProblems()).toEqual([]);
  });
  it('量尺自測:不是 test、不在設定檔、沒有常數 → 紅', () => {
    const conf = { app: { windows: [{ label: 'teach' }, { label: 'test' }] } };
    expect(startupFocusTargetProblems('pub const STARTUP_FOCUS: &str = "test";', conf)).toEqual([]);
    expect(startupFocusTargetProblems('pub const STARTUP_FOCUS: &str = "teach";', conf).join('\n')).toMatch(/要是 "test"/);
    expect(startupFocusTargetProblems('pub const STARTUP_FOCUS: &str = "";', conf).join('\n')).toMatch(/不是 tauri\.conf\.json/);
    expect(startupFocusTargetProblems('pub const STARTUP_FOCUS: &str = "test";', { app: { windows: [{ label: 'teach' }] } }).join('\n')).toMatch(/不是 tauri\.conf\.json/);
    expect(startupFocusTargetProblems('const X: u8 = 1;', conf).join('\n')).toMatch(/沒有/);
    expect(startupFocusConst("// pub const STARTUP_FOCUS: &str = \"test\";")).toBeUndefined();
  });
});

describe('main.rs 的接線:取函式本體再斷言(驗收 3、8)', () => {
  it('卡片視窗接線:desktop_is_composited 一次、surface_for 與 init_script 同一個 mode、.transparent(surface.transparent)、有條件的 .background_color、都在 .build() 之前', () => {
    expect(surfaceWiringProblems(mainSrc())).toEqual([]);
  });
  it('啟動焦點接線:一個 StartupFocus、兩個顯示的地方都通知、set_focus 只有一處且對 on_shown 回的標籤', () => {
    expect(focusWiringProblems(mainSrc())).toEqual([]);
  });
  it('setup 視窗那段:不加 transparent / background_color / 初始化腳本 / 先藏起來,也沒有建窗後才改外觀(擴大版)', () => {
    expect(mainRsUnchangedProblems(mainSrc())).toEqual([]);
  });
  it('T16 既有的接線檢查仍成立(GDK、initialization_script、ShowGate、warn、StateFlags)', () => {
    expect(mainRsProblems(mainSrc())).toEqual([]);
  });
});

describe('量尺自測:取函式本體(最小合成片段)', () => {
  it('大括號配對,字串字面裡的大括號不算;找不到回 undefined', () => {
    expect(rustFnBody('fn a() { x }', 'a')).toBe(' x ');
    expect(rustFnBody('fn a() { let s = "}"; y }', 'a')).toBe(' let s = "}"; y ');
    expect(rustFnBody('fn a() { if p { b } c }', 'a')).toBe(' if p { b } c ');
    expect(rustFnBody('fn a() { x }', 'b')).toBeUndefined();
    expect(rustFnBody('fn a() { "\\"}" }', 'a')).toBe(' "\\"}" ');
  });
  it('呼叫次數不算 fn 定義;註解先拿掉', () => {
    expect(rustCallCount('fn f() {} fn g() { f(); f(); }', 'f')).toBe(2);
    expect(rustCallCount(stripRustComments('fn f() {} // f();\n/* f(); */ fn g() {}'), 'f')).toBe(0);
  });
  it('定義還在、呼叫被拿掉 → 呼叫圖檢查紅(T16 驗收時存活的那一種)', () => {
    const call = 'fn open_windows() { arm_show_fallback(&w); let m = desktop_is_composited(); }\nfn arm_show_fallback() {}\nfn desktop_is_composited() -> bool { true }\nx.setup(move |a| open_windows(a));';
    expect(callGraphProblems(call)).toEqual([]);
    expect(callGraphProblems(call.replace('arm_show_fallback(&w); ', '')).join('\n')).toMatch(/沒有呼叫 arm_show_fallback/);
    expect(callGraphProblems(call.replace('let m = desktop_is_composited();', 'let m = desktop_is_composited(); let n = desktop_is_composited();')).join('\n')).toMatch(/剛好呼叫一次/);
    expect(callGraphProblems(call.replace('x.setup(move |a| open_windows(a));', '')).join('\n')).toMatch(/\.setup/);
    expect(callGraphProblems(call + '\nfn other() { desktop_is_composited(); }').join('\n')).toMatch(/之外也被呼叫/);
  });
  it('寫在死程式碼裡 → 紅', () => {
    expect(deadCodeProblems('if false { a(); }').join('\n')).toMatch(/if false/);
    expect(deadCodeProblems('#[allow(dead_code)]\nfn f() {}').join('\n')).toMatch(/dead_code/);
    expect(deadCodeProblems('#[cfg(test)]\nfn f() {}').join('\n')).toMatch(/cfg/);
    expect(deadCodeProblems('fn f() { a(); }')).toEqual([]);
  });
});

describe('量尺自測:mode 變數與 builder(最小合成片段)', () => {
  const ok = 'let mode = mode_for(c); let script = init_script(mode); let surface = surface_for(mode);';
  it('同一個 mode、來自 mode_for;換一個變數或傳呼叫 → 紅', () => {
    expect(modeVariableProblems(ok)).toEqual([]);
    expect(modeVariableProblems(ok.replace('surface_for(mode)', 'surface_for(other)')).join('\n')).toMatch(/不是同一個 mode/);
    expect(modeVariableProblems(ok.replace('surface_for(mode)', 'surface_for(mode_for(c))')).join('\n')).toMatch(/沒有 surface_for\(<變數>\)/);
    expect(modeVariableProblems('let mode = Default(); let a = init_script(mode); let b = surface_for(mode);').join('\n')).toMatch(/不是 mode_for/);
  });
  const chain = (mid: string, tail = '') =>
    `let surface = surface_for(mode); let b = WebviewWindowBuilder::from_config(h, &c)?${mid}; ${tail} let w = b.build()?;`;
  it('.transparent 的參數:來自 surface.transparent 才過;字面 true / false 或別的值 → 紅', () => {
    const bg = 'if let Some(c) = surface.background { b = b.background_color(Color(c[0], c[1], c[2], c[3])); }';
    expect(builderProblems(chain('.transparent(surface.transparent)', bg))).toEqual([]);
    expect(builderProblems(chain('.transparent(true)', bg)).join('\n')).toMatch(/參數要是 surface\.transparent/);
    expect(builderProblems(chain('.transparent(false)', bg)).join('\n')).toMatch(/參數要是 surface\.transparent/);
    expect(builderProblems(chain('.transparent(mode.solid)', bg)).join('\n')).toMatch(/參數要是 surface\.transparent/);
    expect(builderProblems(chain('', bg)).join('\n')).toMatch(/沒有 \.transparent/);
  });
  it('.background_color:要有條件、不能寫死數字、不能在 .build() 之後', () => {
    const t = '.transparent(surface.transparent)';
    expect(builderProblems(chain(t)).join('\n')).toMatch(/沒有 \.background_color/);
    expect(builderProblems(chain(`${t}.background_color(Color(244, 246, 248, 255))`)).join('\n')).toMatch(/寫死的數字/);
    expect(builderProblems(chain(`${t}.background_color(Color(r, g, b, a))`)).join('\n')).toMatch(/只在 surface\.background 是 Some 時/);
    expect(builderProblems(`${chain(t)} w.set_transparent(true); b.build()?.background_color(x);`).join('\n')).toMatch(/沒有 \.background_color|\.build\(\) 之後/);
  });
  it('寫死 .transparent(true) 且沒有 surface_for 變數 → 紅', () => {
    expect(builderProblems('let b = WebviewWindowBuilder::from_config(h, &c)?.transparent(true); b.build()?;').join('\n')).toMatch(/surface_for/);
  });
});

describe('量尺自測:焦點的接線(最小合成片段)', () => {
  it('顯示之後有通知(直接或經 helper);只在一邊通知、參數寫死字串、沒有 .show() → 紅', () => {
    expect(notifiesAfterShow('{ let _ = w.show(); f.on_shown(w.label()); }', [])).toBeUndefined();
    expect(notifiesAfterShow('{ let _ = w.show(); notify(&f, w.label()); }', ['notify'])).toBeUndefined();
    expect(notifiesAfterShow('{ let _ = w.show(); }', [])).toMatch(/沒有通知/);
    expect(notifiesAfterShow('{ f.on_shown(l); let _ = w.show(); }', [])).toMatch(/沒有通知/);
    expect(notifiesAfterShow('{ let _ = w.show(); f.on_shown("test"); }', [])).toMatch(/字串字面/);
    expect(notifiesAfterShow('{ x(); }', [])).toMatch(/沒有 \.show/);
  });
  const skeleton = (extra: { loop?: string; fallback?: string; pageLoad?: string; focus?: string }) => `
fn arm_show_fallback(w: &W, f: F) { if gate.on_timeout() { let _ = w.show(); ${extra.fallback ?? 'f.on_shown(l);'} } }
fn go(f: F) { if let Some(l) = f.on_shown(n) { app.get_webview_window(l).map(|w| w.set_focus()); } }
fn open_windows(app: &App, state: S) { let focus = Arc::new(Mutex::new(StartupFocus::new(start_screen::windows(state)))); for label in x { b.on_page_load(|w, p| { if gate.on_page_finished() { let _ = w.show(); ${extra.pageLoad ?? 'f.on_shown(l);'} } }).build()?; } }`;
  it('最小骨架通過(只有這幾條判斷的最小量,不是實作)', () => {
    expect(focusWiringProblems(skeleton({}))).toEqual([]);
  });
  it('只有 Finished 那條通知(3 秒退路那條忘了)→ 紅', () => {
    expect(focusWiringProblems(skeleton({ fallback: '' })).join('\n')).toMatch(/arm_show_fallback 的逾時那條/);
  });
  it('只有 3 秒退路那條通知(Finished 那條忘了)→ 紅', () => {
    expect(focusWiringProblems(skeleton({ pageLoad: '' })).join('\n')).toMatch(/Finished 那條/);
  });
  it('建窗後直接 set_focus、或 set_focus 兩處 → 紅', () => {
    const direct = skeleton({}).replace('let _ = w.show();', 'let _ = w.show(); w.set_focus();');
    expect(focusWiringProblems(direct).join('\n')).toMatch(/set_focus 要剛好一處|不在「on_shown/);
    expect(focusWiringProblems(skeleton({}) + '\nfn z() { w.set_focus(); }').join('\n')).toMatch(/set_focus 要剛好一處/);
  });
  it('對寫死的標籤 set_focus → 紅', () => {
    expect(focusWiringProblems(skeleton({}).replace('get_webview_window(l)', 'get_webview_window("test")')).join('\n')).toMatch(/get_webview_window\(l\)|寫死的標籤/);
  });
  it('StartupFocus 建在迴圈裡 / 標籤不是 start_screen::windows 那份 / 沒放進 Arc<Mutex> → 紅', () => {
    const inLoop = skeleton({}).replace('for label in x {', 'for label in x { let focus2 = StartupFocus::new(start_screen::windows(state));').replace(/let focus = Arc::new\(Mutex::new\(StartupFocus::new\(start_screen::windows\(state\)\)\)\);/, '');
    expect(focusWiringProblems(inLoop).join('\n')).toMatch(/for 迴圈裡面或之後/);
    expect(focusWiringProblems(skeleton({}).replace('start_screen::windows(state)', '["teach", "test"]')).join('\n')).toMatch(/start_screen::windows/);
    expect(focusWiringProblems(skeleton({}).replace('Arc::new(Mutex::new(', 'Some((').replace('Arc', 'Rc')).join('\n')).toMatch(/Arc<Mutex/);
  });
});

describe('量尺自測:setup 視窗與建窗後改外觀(擴大版)', () => {
  const setup = (mid: string) => `fn x() { WebviewWindowBuilder::new(app, start_screen::WINDOW_LABEL, u)${mid}.build()?; }\nset_always_on_top(true); Focused(true)`;
  it('setup 視窗被加 transparent(任何參數)/ background_color / 初始化腳本 / on_page_load / visible → 紅', () => {
    expect(mainRsUnchangedProblems(setup('.title(t)'))).toEqual([]);
    for (const bad of ['.transparent(false)', '.transparent(s.transparent)', '.background_color(c)', '.initialization_script(s)', '.on_page_load(f)', '.visible(false)']) {
      expect(mainRsUnchangedProblems(setup(bad)).join('\n'), bad).toMatch(/setup 視窗/);
    }
  });
  it('建窗之後才 set_background_color / set_transparent → 紅;註解裡提到不算', () => {
    expect(mainRsUnchangedProblems(`${setup('')} w.set_background_color(c);`).join('\n')).toMatch(/建窗之後才改外觀/);
    expect(mainRsUnchangedProblems(`${setup('')} w.set_transparent(true);`).join('\n')).toMatch(/建窗之後才改外觀/);
    expect(mainRsUnchangedProblems(`${setup('')} // 不用 set_background_color`)).toEqual([]);
  });
});
