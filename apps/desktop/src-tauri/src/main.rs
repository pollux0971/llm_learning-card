// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod session;

use session::SessionType;
use tauri::{Manager, WebviewWindow};

/// X11:視窗建立後立刻置頂,並在每次拿到焦點時重新置頂(有些視窗管理器點擊別的視窗後會把置頂效果蓋掉)。
/// Wayland:不強制置頂(協定不允許客戶端這樣做),改為呼叫 placeholder 頁面自己的一次性提示。
fn apply_session_behaviour(window: &WebviewWindow, session: SessionType) {
    match session {
        SessionType::X11 => {
            let _ = window.set_always_on_top(true);
            let w = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(true) = event {
                    let _ = w.set_always_on_top(true);
                }
            });
        }
        SessionType::Wayland => {
            let _ = window.eval("window.__lcShowWaylandNote && window.__lcShowWaylandNote();");
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let session = session::detect_from_env();
            for label in ["teach", "test"] {
                if let Some(window) = app.get_webview_window(label) {
                    apply_session_behaviour(&window, session);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
