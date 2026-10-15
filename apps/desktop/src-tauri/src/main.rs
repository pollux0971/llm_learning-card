// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::SystemTime;

use learning_cards_desktop::asset_protocol::{self, SCHEME};
use learning_cards_desktop::commands::{self, LearningRoot};
use learning_cards_desktop::event_log::AssetRefusalLimiter;
use learning_cards_desktop::session::{self, SessionType};
use tauri::{Manager, RunEvent, WebviewWindow};

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
    // 本張沿用 T2b 的來源 LC_LEARNING_ROOT(T2c-2 換成單一來源)。沒設的話 command 以 reason `root` 拒絕。
    let root: Option<PathBuf> = learning_cards_desktop::configured_root();
    // lc 協定的拒絕限流器:整個行程共用一個,結束時把沒寫出的次數補寫進 log。
    let limiter = Arc::new(Mutex::new(AssetRefusalLimiter::new()));
    let lc_root = root.clone();
    let lc_limiter = Arc::clone(&limiter);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(LearningRoot(root.clone().unwrap_or_default()))
        .invoke_handler(commands::handler())
        // 內建 asset: 即使 protocol-asset feature 以後被打開,這裡先佔掉 scheme,內建 handler 不會掛上。
        .register_uri_scheme_protocol("asset", |_ctx, _request| {
            let rejected = asset_protocol::reject_builtin();
            for line in &rejected.rust_log {
                log::error!("{line}");
            }
            asset_protocol::refuse_response()
        })
        .register_uri_scheme_protocol(SCHEME, move |_ctx, request| {
            let Some(root) = lc_root.as_deref() else {
                log::error!("refused asset: no learning root");
                return asset_protocol::refuse_response();
            };
            let encoded = asset_protocol::asset_rel_from_url_path(request.uri().path());
            let mut limiter = lc_limiter.lock().unwrap_or_else(PoisonError::into_inner);
            asset_protocol::respond(root, encoded, &mut limiter, SystemTime::now()).response
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            if let Some(root) = root.as_deref() {
                let mut limiter = limiter.lock().unwrap_or_else(PoisonError::into_inner);
                asset_protocol::flush_refusals(root, &mut limiter, SystemTime::now());
            }
        }
    });
}
