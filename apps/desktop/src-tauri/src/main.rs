// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use learning_cards_desktop::asset_protocol::{self, SCHEME};
use learning_cards_desktop::session::{self, SessionType};
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

fn refuse_response() -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(http::StatusCode::FORBIDDEN)
        .header(http::header::CONTENT_TYPE, "text/plain")
        .body(b"refused".to_vec())
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // 內建 asset: 即使 protocol-asset feature 以後被打開,這裡先佔掉 scheme,內建 handler 不會掛上。
        .register_uri_scheme_protocol("asset", |_ctx, _request| {
            let rejected = asset_protocol::reject_builtin();
            for line in &rejected.rust_log {
                log::error!("{line}");
            }
            refuse_response()
        })
        .register_uri_scheme_protocol(SCHEME, |_ctx, request| {
            let Some(root) = learning_cards_desktop::configured_root() else {
                log::error!("refused asset: no learning root");
                return refuse_response();
            };
            let raw = asset_protocol::asset_rel_from_url_path(request.uri().path());
            match asset_protocol::handle_custom(&root, raw) {
                Ok(out) => http::Response::builder()
                    .status(http::StatusCode::OK)
                    .body(out.value.as_str().unwrap_or("").as_bytes().to_vec())
                    .unwrap_or_else(|_| http::Response::new(Vec::new())),
                Err((_, rejected)) => {
                    for line in &rejected.rust_log {
                        log::error!("{line}");
                    }
                    refuse_response()
                }
            }
        })
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
