// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex, PoisonError};
use std::time::SystemTime;

use learning_cards_desktop::asset_protocol::{self, SCHEME};
use learning_cards_desktop::commands::{self, LearningRoot};
use learning_cards_desktop::event_log::AssetRefusalLimiter;
use learning_cards_desktop::learning_root::{self, StartState};
use learning_cards_desktop::session::{self, SessionType};
use learning_cards_desktop::start_screen;
use tauri::{App, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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

/// tauri.conf.json 的兩個視窗是 `create: false`:啟動狀態決定要不要開(T2c-2 驗收 3)。
/// ok 開教學卡與測驗卡;四種失敗只開 `setup` 視窗,顯示 `start_screen` 的那一頁。
fn open_windows(app: &App, state: StartState) -> Result<(), Box<dyn std::error::Error>> {
    let session = session::detect_from_env();
    for label in start_screen::windows(state) {
        let config = app
            .config()
            .app
            .windows
            .iter()
            .find(|w| w.label == *label)
            .ok_or_else(|| format!("tauri.conf.json has no window labelled {label}"))?
            .clone();
        let window = WebviewWindowBuilder::from_config(app.handle(), &config)?.build()?;
        apply_session_behaviour(&window, session);
    }
    if state != StartState::Ok {
        WebviewWindowBuilder::new(app, start_screen::WINDOW_LABEL, WebviewUrl::CustomProtocol(start_screen::url().parse()?))
            .title(format!("LLM Cards — {}", start_screen::title(state)))
            .inner_size(640.0, 520.0)
            .build()?;
    }
    Ok(())
}

fn main() {
    learning_cards_desktop::init_logging();
    // learning 根只有一個來源:使用者層指標檔。啟動時解析這一次,之後 command 與 lc 協定都讀 Tauri state 裡的這一份。
    let (xdg_config_home, home) = learning_cards_desktop::pointer_env();
    let resolved = learning_root::resolve(xdg_config_home.as_deref(), &home);
    let state = resolved.state;
    let start_page = start_screen::page(&resolved);
    // lc 協定的拒絕限流器:整個行程共用一個,結束時把沒寫出的次數補寫進 log。
    let limiter = Arc::new(Mutex::new(AssetRefusalLimiter::new()));
    let lc_limiter = Arc::clone(&limiter);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(LearningRoot::new(resolved))
        .invoke_handler(commands::handler())
        // 內建 asset: 即使 protocol-asset feature 以後被打開,這裡先佔掉 scheme,內建 handler 不會掛上。
        .register_uri_scheme_protocol("asset", |_ctx, _request| {
            let rejected = asset_protocol::reject_builtin();
            for line in &rejected.rust_log {
                log::error!("{line}");
            }
            asset_protocol::refuse_response()
        })
        .register_uri_scheme_protocol(SCHEME, move |ctx, request| {
            // 根沒設好(四種失敗):一律 403,不開檔、不寫 warning。
            let state = ctx.app_handle().state::<LearningRoot>();
            let Ok(root) = state.dir() else {
                return asset_protocol::refuse_response();
            };
            let encoded = asset_protocol::asset_rel_from_url_path(request.uri().path());
            let mut limiter = lc_limiter.lock().unwrap_or_else(PoisonError::into_inner);
            asset_protocol::respond(root, encoded, &mut limiter, SystemTime::now()).response
        })
        .register_uri_scheme_protocol(start_screen::SCHEME, move |_ctx, _request| start_screen::response(&start_page))
        .setup(move |app| open_windows(app, state))
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |app, event| {
        if let RunEvent::Exit = event {
            if let Ok(root) = app.state::<LearningRoot>().dir() {
                let mut limiter = limiter.lock().unwrap_or_else(PoisonError::into_inner);
                asset_protocol::flush_refusals(root, &mut limiter, SystemTime::now());
            }
        }
    });
}
