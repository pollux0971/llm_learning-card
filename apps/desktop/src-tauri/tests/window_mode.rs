//! T16(10-desktop-shell phase-6)的 Rust 純函式:合成器判定、頁面模式、載入完才顯示的逾時退路。
//! 測試 agent 寫;開發 worker 不改。不開視窗、不碰時鐘(兩個方法直接呼叫,不真的等 3 秒)。
//!
//! 頁面那段程式(`src/window_mode.js`)本身的行為由 vitest 測(apps/desktop/src/window-frameless.test.ts):
//! Rust 與 vitest 讀的是同一個檔。這裡只看 Rust 端把它接起來的方式。

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use learning_cards_desktop::window_mode::{init_script, mode_for, ShowGate, WindowMode, SHOW_FALLBACK};

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
