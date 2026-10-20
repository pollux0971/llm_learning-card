//! 10-desktop-shell(工單 T34 B)的 Rust 純函式:Wayland 底下要做什麼、要不要把一次性提示的頁面程式交給兩個卡片視窗。
//! 測試 agent 寫;開發 worker 不改。不開視窗、不碰時鐘。
//!
//! 頁面那段程式(`src/wayland_note.js`)本身的行為由真 Chrome 測(packages/ui-shared/src/hud/card-render-wayland-note.test.ts):
//! Rust 與 Chrome 讀的是同一個檔。這裡只看 Rust 端把它接起來的方式與「什麼 session 做什麼」的判斷。
//!
//! 釘住的介面(`learning_cards_desktop::window_mode`):
//!   `session_actions(SessionType) -> SessionActions { always_on_top: bool, show_wayland_note: bool }`
//!   `with_wayland_note(script: String, session: SessionType) -> String`
//! `init_script(mode)` 照舊(兩個欄位的第一行 + window_mode.js),main.rs 把它交給 `with_wayland_note` 再交給 `initialization_script`。

use std::fs;
use std::path::PathBuf;

use learning_cards_desktop::session::SessionType;
use learning_cards_desktop::window_mode::{init_script, mode_for, session_actions, with_wayland_note, SessionActions};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn wayland_note_js() -> String {
    fs::read_to_string(manifest_dir().join("src/wayland_note.js"))
        .expect("src/wayland_note.js 不存在(提示的頁面程式要放在 apps/desktop/src-tauri/src/wayland_note.js)")
}

const SESSIONS: [SessionType; 2] = [SessionType::X11, SessionType::Wayland];

// ───────────────────────────── session → 動作(純函式)

#[test]
fn x11_stays_on_top_and_shows_no_note() {
    assert_eq!(session_actions(SessionType::X11), SessionActions { always_on_top: true, show_wayland_note: false });
}

#[test]
fn wayland_does_not_set_always_on_top_and_shows_the_note() {
    assert_eq!(session_actions(SessionType::Wayland), SessionActions { always_on_top: false, show_wayland_note: true });
}

#[test]
fn exactly_one_of_the_two_per_session() {
    // 不置頂就要用提示告訴使用者怎麼辦;置頂了就不用提示
    for session in SESSIONS {
        let actions = session_actions(session);
        assert_ne!(actions.always_on_top, actions.show_wayland_note, "{session:?}:置頂與提示恰好一個");
    }
}

// ───────────────────────────── 頁面程式:誰會拿到

#[test]
fn the_note_script_exists_and_is_not_empty() {
    let js = wayland_note_js();
    assert!(!js.trim().is_empty(), "wayland_note.js 是空的");
}

#[test]
fn x11_gets_exactly_the_window_mode_script_and_nothing_about_the_note() {
    let base = init_script(mode_for(true));
    let script = with_wayland_note(base.clone(), SessionType::X11);
    assert_eq!(script, base, "X11:原樣,不加任何東西");
    assert!(!script.contains("lc-wayland-note-dismissed"), "X11 的頁面程式不能帶提示的鍵名");
    assert!(!script.contains("Wayland"), "X11 的頁面程式不能帶提示的字樣");
}

#[test]
fn wayland_gets_the_window_mode_script_followed_by_the_note_script() {
    for composited in [true, false] {
        let base = init_script(mode_for(composited));
        let script = with_wayland_note(base.clone(), SessionType::Wayland);
        assert!(script.starts_with(&base), "Wayland:前面仍然是 window_mode 的 init script(第一行與 window_mode.js 不動)");
        let js = wayland_note_js();
        assert!(script.trim_end().ends_with(js.trim_end()), "Wayland:最後接 wayland_note.js 的全文,逐字");
        assert!(script.len() > base.len() + js.trim().len() - 1, "接上去的是整個檔,不是一部分");
    }
}

#[test]
fn the_window_mode_part_is_unchanged_for_wayland() {
    // 既有的 init_script 測試(tests/window_mode.rs)釘住的形狀:第一行兩個欄位。提示不靠多帶一欄。
    let base = init_script(mode_for(false));
    let script = with_wayland_note(base.clone(), SessionType::Wayland);
    assert_eq!(script.lines().next(), base.lines().next());
}

#[test]
fn the_note_script_follows_the_session_actions() {
    for session in SESSIONS {
        let base = init_script(mode_for(true));
        let changed = with_wayland_note(base.clone(), session) != base;
        assert_eq!(changed, session_actions(session).show_wayland_note, "{session:?}:交不交提示程式,跟 session_actions 說的一樣");
    }
}

#[test]
fn the_note_script_does_not_depend_on_the_compositor() {
    for composited in [true, false] {
        let script = with_wayland_note(init_script(mode_for(composited)), SessionType::Wayland);
        assert!(script.contains("lc-wayland-note-dismissed"), "composited={composited}:提示程式的鍵名在");
    }
}
