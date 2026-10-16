//! T16 + T21(10-desktop-shell phase-6)的 Rust 純函式:合成器判定、頁面模式、載入完才顯示的逾時退路、
//! 沒有合成器時的實心底(surface_for)、啟動焦點(StartupFocus)。
//! 測試 agent 寫;開發 worker 不改。不開視窗、不碰時鐘(兩個方法直接呼叫,不真的等 3 秒)。
//!
//! 頁面那段程式(`src/window_mode.js`)本身的行為由 vitest 測(apps/desktop/src/window-frameless.test.ts):
//! Rust 與 vitest 讀的是同一個檔。這裡只看 Rust 端把它接起來的方式。

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use learning_cards_desktop::window_mode::{
    init_script, mode_for, surface_for, ShowGate, StartupFocus, WindowMode, WindowSurface, SHOW_FALLBACK, SOLID_BACKGROUND, STARTUP_FOCUS,
};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn window_mode_js() -> String {
    fs::read_to_string(manifest_dir().join("src/window_mode.js"))
        .expect("src/window_mode.js 不存在(頁面那段程式要放在 apps/desktop/src-tauri/src/window_mode.js)")
}

/// 14 的 layout.ts 裡 `export const NAME = '值';` 的值。
fn layout_constant(name: &str) -> String {
    let path = manifest_dir().join("../../../packages/ui-shared/src/hud/layout.ts");
    let text = fs::read_to_string(&path).expect("讀不到 layout.ts");
    let marker = format!("export const {name} = '");
    let start = text.find(&marker).unwrap_or_else(|| panic!("layout.ts 沒有 {name}")) + marker.len();
    let end = text[start..].find('\'').expect("layout.ts 的字串沒有結尾");
    text[start..start + end].to_string()
}

// ───────────────────────────── 模式:有沒有合成器

#[test]
fn a_composited_desktop_is_frameless_and_not_solid() {
    assert_eq!(mode_for(true), WindowMode { frameless: true, solid: false });
}

#[test]
fn a_desktop_without_a_compositor_is_frameless_and_solid() {
    assert_eq!(mode_for(false), WindowMode { frameless: true, solid: true });
}

#[test]
fn frameless_does_not_depend_on_the_compositor() {
    assert!(mode_for(true).frameless);
    assert!(mode_for(false).frameless);
}

// ───────────────────────────── init_script:一行 JSON 加上 window_mode.js

fn first_line_json(script: &str) -> serde_json::Value {
    let first = script.lines().next().expect("init_script 是空的");
    let body = first
        .strip_prefix("window.__LC_WINDOW_MODE__ = ")
        .unwrap_or_else(|| panic!("第一行要以 `window.__LC_WINDOW_MODE__ = ` 開頭,實際是:{first}"));
    let body = body.strip_suffix(';').unwrap_or_else(|| panic!("第一行要以 `;` 結尾,實際是:{first}"));
    serde_json::from_str(body).unwrap_or_else(|e| panic!("第一行的值不是合法 JSON({e}):{body}"))
}

#[test]
fn the_first_line_hands_the_mode_over_as_json() {
    for composited in [true, false] {
        let mode = mode_for(composited);
        let value = first_line_json(&init_script(mode));
        let object = value.as_object().expect("要是一個物件");
        assert_eq!(object.len(), 2, "只有 frameless 與 solid 兩個欄位:{value}");
        assert_eq!(object["frameless"], serde_json::Value::Bool(mode.frameless));
        assert_eq!(object["solid"], serde_json::Value::Bool(mode.solid));
    }
}

#[test]
fn the_rest_of_the_script_is_window_mode_js_untouched() {
    let js = window_mode_js();
    assert!(!js.trim().is_empty(), "window_mode.js 是空的");
    for composited in [true, false] {
        let script = init_script(mode_for(composited));
        let (_, rest) = script.split_once('\n').expect("第一行之後要換行,接 window_mode.js");
        assert_eq!(rest, js, "第一行之後必須逐字等於 window_mode.js 的內容(Rust 與 vitest 測同一個檔)");
    }
}

#[test]
fn the_script_uses_the_class_names_of_the_hud_kit() {
    let script = init_script(mode_for(true));
    for name in ["FRAMELESS_CLASS", "SOLID_CLASS"] {
        let class = layout_constant(name);
        assert!(script.contains(&class), "init_script 裡找不到 layout.ts 的 {name}(`{class}`)");
    }
}

// ───────────────────────────── 載入完才顯示:3 秒逾時退路

#[test]
fn the_fallback_waits_three_seconds() {
    assert_eq!(SHOW_FALLBACK, Duration::from_secs(3));
}

#[test]
fn a_page_that_never_finishes_loading_is_shown_once_when_the_timeout_fires() {
    // 測試替身:故意不結束載入的頁面,只會叫 on_timeout,永遠不叫 on_page_finished。
    let mut gate = ShowGate::new();
    assert!(gate.on_timeout(), "逾時到了,頁面還沒載入完 → 要顯示(呼叫端同時寫 warn)");
    assert!(!gate.on_timeout(), "逾時只顯示一次");
}

#[test]
fn a_page_that_finishes_in_time_is_shown_once_and_the_timeout_does_nothing() {
    let mut gate = ShowGate::new();
    assert!(gate.on_page_finished(), "載入完成 → 顯示");
    assert!(!gate.on_timeout(), "已經顯示過:逾時不再顯示,也不警告(回 false 呼叫端就不寫 warn)");
}

#[test]
fn a_page_that_finishes_after_the_timeout_is_not_shown_a_second_time() {
    let mut gate = ShowGate::new();
    assert!(gate.on_timeout(), "逾時先到 → 顯示");
    assert!(!gate.on_page_finished(), "之後才載入完 → 什麼都不做");
}

#[test]
fn finishing_twice_shows_once() {
    // 頁面重新整理或換頁時,Finished 會再來一次
    let mut gate = ShowGate::new();
    assert!(gate.on_page_finished());
    assert!(!gate.on_page_finished());
    assert!(!gate.on_timeout());
}

#[test]
fn each_window_has_its_own_gate() {
    let mut teach = ShowGate::new();
    let mut test = ShowGate::new();
    assert!(teach.on_page_finished());
    assert!(test.on_timeout(), "另一個視窗的結果不影響這一個");
    assert!(!teach.on_timeout());
    assert!(!test.on_page_finished());
}

// ───────────────────────────── 給 cucumber 場景用(沒設環境變數時什麼都不做)

/// 場景「The solid fallback follows what the desktop can draw」要的是 Rust 端真的組出來的 init_script,
/// 由步驟定義用 `LC_WINDOW_MODE_COMPOSITED=1|0 cargo test --test window_mode emit_init_script_for_the_scenarios -- --exact --nocapture`
/// 取得,再把它放進假的頁面根元素跑。
#[test]
fn emit_init_script_for_the_scenarios() {
    let Ok(value) = std::env::var("LC_WINDOW_MODE_COMPOSITED") else {
        return;
    };
    let script = init_script(mode_for(value == "1"));
    println!("LC-INIT-SCRIPT-BEGIN\n{script}\nLC-INIT-SCRIPT-END");
}

// ═════════════════════════════ T21:視窗的表面(驗收 1)

#[test]
fn a_composited_desktop_gets_a_transparent_window_without_a_background() {
    assert_eq!(surface_for(mode_for(true)), WindowSurface { transparent: true, background: None });
}

#[test]
fn a_desktop_without_a_compositor_gets_an_opaque_window_in_the_solid_colour() {
    assert_eq!(surface_for(mode_for(false)), WindowSurface { transparent: false, background: Some(SOLID_BACKGROUND) });
}

#[test]
fn the_surface_only_looks_at_solid() {
    // 不另外問 GDK:同一個 mode 永遠同一個表面;frameless 不影響它
    for frameless in [true, false] {
        assert_eq!(
            surface_for(WindowMode { frameless, solid: true }),
            WindowSurface { transparent: false, background: Some(SOLID_BACKGROUND) }
        );
        assert_eq!(surface_for(WindowMode { frameless, solid: false }), WindowSurface { transparent: true, background: None });
    }
}

#[test]
fn the_solid_background_is_fully_opaque() {
    assert_eq!(SOLID_BACKGROUND[3], 0xff, "alpha 一定是 255");
    assert_eq!(surface_for(mode_for(false)).background.map(|c| c[3]), Some(0xff));
}

// ───────────────────────────── 色值只有一個意思:SOLID_BACKGROUND = hud.css 的 --hud-solid(驗收 2)

fn hud_css() -> String {
    let path = manifest_dir().join("../../../packages/ui-shared/src/hud/hud.css");
    fs::read_to_string(&path).expect("讀不到 packages/ui-shared/src/hud/hud.css")
}

/// 量尺:`:root { … }` 區塊裡 `--hud-solid:` 那一行的 `#rrggbb`。找不到、格式不對 → Err(測試紅,不是跳過)。
/// 只認 `:root` 區塊(別的區塊同名的變數不算);註解先拿掉;值後面有 `!important` 算格式不對。
fn parse_hud_solid(css: &str) -> Result<[u8; 3], String> {
    let mut code = String::new();
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        code.push_str(&rest[..start]);
        match rest[start + 2..].find("*/") {
            Some(end) => rest = &rest[start + 2 + end + 2..],
            None => {
                rest = "";
                break;
            }
        }
    }
    code.push_str(rest);

    let mut search = code.as_str();
    while let Some(at) = search.find(":root") {
        let after = search[at + ":root".len()..].trim_start();
        search = &search[at + ":root".len()..];
        let Some(body_and_rest) = after.strip_prefix('{') else { continue };
        let Some(close) = body_and_rest.find('}') else { return Err("`:root` 區塊沒有結尾的 }".into()) };
        let block = &body_and_rest[..close];
        for decl in block.split(';') {
            let decl = decl.trim();
            let Some(value) = decl.strip_prefix("--hud-solid") else { continue };
            let Some(value) = value.trim_start().strip_prefix(':') else { continue };
            let value = value.trim();
            let hex = value.strip_prefix('#').ok_or_else(|| format!("--hud-solid 的值要以 # 開頭:{value}"))?;
            if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(format!("--hud-solid 的值要是 # 加 6 個十六進位字:{value}"));
            }
            let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).expect("已檢查是十六進位");
            return Ok([byte(0), byte(2), byte(4)]);
        }
    }
    Err("`:root` 區塊裡找不到 --hud-solid".into())
}

#[test]
fn the_solid_background_is_the_hud_solid_of_hud_css() {
    let rgb = parse_hud_solid(&hud_css()).unwrap_or_else(|e| panic!("hud.css 解析失敗:{e}"));
    assert_eq!(&SOLID_BACKGROUND[..3], &rgb[..], "SOLID_BACKGROUND 的 RGB 要等於 hud.css 的 --hud-solid");
}

#[test]
fn the_css_reader_reads_only_the_root_block() {
    // 最小合成片段:量尺本身要出聲,不然 hud.css 改了格式量尺就悄悄失靈
    assert_eq!(parse_hud_solid(":root { --hud-solid: #f4f6f8; }"), Ok([0xf4, 0xf6, 0xf8]));
    assert_eq!(parse_hud_solid(":root{--hud-solid:#112233}"), Ok([0x11, 0x22, 0x33]), "最後一個宣告可以沒有分號");
    assert_eq!(parse_hud_solid(":root { --hud-solid: #F4F6F8; }"), Ok([0xf4, 0xf6, 0xf8]), "大寫十六進位字也認");
    assert!(parse_hud_solid(":root { --hud-ink: #000000; }").is_err(), ":root 裡沒有 --hud-solid");
    assert!(parse_hud_solid("").is_err(), "沒有 :root");
    assert!(parse_hud_solid(".a { --hud-solid: #f4f6f8; }").is_err(), "沒有 :root 區塊");
}

#[test]
fn the_css_reader_rejects_a_value_it_cannot_trust() {
    assert!(parse_hud_solid(":root { --hud-solid: #fff; }").is_err(), "三碼不認");
    assert!(parse_hud_solid(":root { --hud-solid: #f4f6f8ff; }").is_err(), "八碼不認");
    assert!(parse_hud_solid(":root { --hud-solid: #f4f6gg; }").is_err(), "不是十六進位");
    assert!(parse_hud_solid(":root { --hud-solid: rgb(244, 246, 248); }").is_err(), "不是 # 開頭");
    assert!(parse_hud_solid(":root { --hud-solid: #f4f6f8 !important; }").is_err(), "!important 算格式不對");
    assert!(parse_hud_solid(":root { --hud-solid: var(--other); }").is_err(), "引用別的變數不認");
}

#[test]
fn the_css_reader_ignores_the_same_name_in_other_blocks() {
    let css = ".hud-dark { --hud-solid: #000000; }\n:root { --hud-solid: #f4f6f8; }\n.other { --hud-solid: #ffffff; }";
    assert_eq!(parse_hud_solid(css), Ok([0xf4, 0xf6, 0xf8]), "要讀 :root 的,不是第一個或最後一個同名的");
    assert!(parse_hud_solid(".hud-dark { --hud-solid: #000000; }\n:root { --hud-ink: #111111; }").is_err(), "別的區塊有、:root 沒有 → 找不到");
}

#[test]
fn the_css_reader_ignores_comments() {
    assert!(parse_hud_solid(":root { /* --hud-solid: #000000; */ }").is_err(), "註解裡的不算");
    assert_eq!(parse_hud_solid(":root { /* --hud-solid: #000000; */ --hud-solid: #f4f6f8; }"), Ok([0xf4, 0xf6, 0xf8]));
    assert_eq!(parse_hud_solid("/* :root { --hud-solid: #000000; } */ :root { --hud-solid: #f4f6f8; }"), Ok([0xf4, 0xf6, 0xf8]));
    assert!(parse_hud_solid(":root { --hud-solid: /* x */ #fff; }").is_err(), "拿掉註解之後仍是三碼");
}

// ═════════════════════════════ T21:啟動焦點(驗收 8)

#[test]
fn the_startup_focus_target_is_the_test_card() {
    assert_eq!(STARTUP_FOCUS, "test");
}

#[test]
fn focus_goes_to_the_test_card_when_the_teach_card_is_shown_first() {
    let mut focus = StartupFocus::new(&["teach", "test"]);
    assert_eq!(focus.on_shown("teach"), None, "還有一個視窗沒顯示");
    assert_eq!(focus.on_shown("test"), Some("test"), "兩個都顯示了");
}

#[test]
fn focus_goes_back_to_the_test_card_when_the_teach_card_is_shown_last() {
    let mut focus = StartupFocus::new(&["teach", "test"]);
    assert_eq!(focus.on_shown("test"), None, "教學卡還沒顯示");
    assert_eq!(focus.on_shown("teach"), Some("test"), "教學卡後顯示、搶走焦點,要拿回來");
}

#[test]
fn showing_the_same_window_twice_does_not_count_twice() {
    let mut focus = StartupFocus::new(&["teach", "test"]);
    assert_eq!(focus.on_shown("teach"), None);
    assert_eq!(focus.on_shown("teach"), None, "同一個標籤第二次不算,不會提早回 Some");
    assert_eq!(focus.on_shown("test"), Some("test"));
}

#[test]
fn focus_is_given_only_once() {
    let mut focus = StartupFocus::new(&["teach", "test"]);
    assert_eq!(focus.on_shown("teach"), None);
    assert_eq!(focus.on_shown("test"), Some("test"));
    for label in ["teach", "test", "teach", "test"] {
        assert_eq!(focus.on_shown(label), None, "已經給過一次,之後不跟使用者搶焦點:{label}");
    }
}

#[test]
fn a_label_that_is_not_in_the_set_is_ignored() {
    let mut focus = StartupFocus::new(&["teach", "test"]);
    assert_eq!(focus.on_shown("setup"), None);
    assert_eq!(focus.on_shown("teach"), None, "setup 不算進去");
    assert_eq!(focus.on_shown("test"), Some("test"));
}

#[test]
fn a_set_that_does_not_contain_the_target_never_gives_focus() {
    let mut only_teach = StartupFocus::new(&["teach"]);
    assert_eq!(only_teach.on_shown("teach"), None);
    assert_eq!(only_teach.on_shown("test"), None);
    let mut nothing = StartupFocus::new(&[]);
    for label in ["teach", "test", "setup"] {
        assert_eq!(nothing.on_shown(label), None, "四種失敗只開 setup,labels 是空的:{label}");
    }
}

#[test]
fn a_single_card_window_set_gives_focus_when_that_window_is_shown() {
    let mut focus = StartupFocus::new(&["test"]);
    assert_eq!(focus.on_shown("test"), Some("test"));
    assert_eq!(focus.on_shown("test"), None);
}

#[test]
fn each_startup_focus_is_independent() {
    let mut a = StartupFocus::new(&["teach", "test"]);
    let mut b = StartupFocus::new(&["teach", "test"]);
    assert_eq!(a.on_shown("teach"), None);
    assert_eq!(b.on_shown("test"), None);
    assert_eq!(a.on_shown("test"), Some("test"));
    assert_eq!(b.on_shown("teach"), Some("test"), "另一個實例的狀態不影響這一個");
}

// ───────────────────────────── 給 cucumber 場景用(沒設環境變數時什麼都不做)

/// 場景「The solid fallback follows what the desktop can draw」的 `the window <is> transparent`、
/// `the window background is <background>`:印出 Rust 端真的算出來的 surface_for。
/// `LC_WINDOW_MODE_COMPOSITED=1|0 cargo test --test window_mode emit_surface_for_the_scenarios -- --exact --nocapture`
#[test]
fn emit_surface_for_the_scenarios() {
    let Ok(value) = std::env::var("LC_WINDOW_MODE_COMPOSITED") else {
        return;
    };
    let surface = surface_for(mode_for(value == "1"));
    let json = serde_json::json!({
        "transparent": surface.transparent,
        "background": surface.background,
        "solidBackground": SOLID_BACKGROUND,
    });
    println!("LC-SURFACE-BEGIN\n{json}\nLC-SURFACE-END");
}

/// 場景「The test card gets the keyboard focus once both windows are shown」:
/// `LC_STARTUP_FIRST=teach|test cargo test --test window_mode emit_startup_focus_for_the_scenarios -- --exact --nocapture`
/// 先顯示 `LC_STARTUP_FIRST` 那個,再顯示另一個,然後兩個各再顯示一次;印出每一次 `on_shown` 的回傳(JSON 陣列,四個)。
#[test]
fn emit_startup_focus_for_the_scenarios() {
    let Ok(first) = std::env::var("LC_STARTUP_FIRST") else {
        return;
    };
    let other = if first == "teach" { "test" } else { "teach" };
    let mut focus = StartupFocus::new(&["teach", "test"]);
    let calls = [first.as_str(), other, first.as_str(), other];
    let results: Vec<Option<&str>> = calls.iter().map(|label| focus.on_shown(label)).collect();
    println!("LC-STARTUP-FOCUS-BEGIN\n{}\nLC-STARTUP-FOCUS-END", serde_json::json!({ "calls": calls, "results": results }));
}
