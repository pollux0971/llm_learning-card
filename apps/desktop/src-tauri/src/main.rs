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
use learning_cards_desktop::window_mode;
use tauri::webview::PageLoadEvent;
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

/// 建窗前問一次 GDK 預設螢幕有沒有合成器。Wayland 永遠是 true;沒有預設螢幕時當作沒有,
/// 切角走實心底,不要黑的。執行中開關不追(ADR-072)。
#[cfg(target_os = "linux")]
fn desktop_is_composited() -> bool {
    match gdk::Screen::default() {
        Some(screen) => screen.is_composited(),
        None => {
            log::warn!("GDK has no default screen; treating the desktop as not composited");
            false
        }
    }
}

/// macOS / Windows 不偵測(gdk 只有 Linux 有)。直接走透明,跟 `mode_for(true)` 一樣。
#[cfg(not(target_os = "linux"))]
fn desktop_is_composited() -> bool {
    true
}

/// 超過 SHOW_FALLBACK 還沒載入完也顯示一次,並寫明是哪一個視窗、等了多久。
/// 已經顯示過(載入先完成)則什麼都不做、不寫 warn。show() 把訊息送回事件迴圈,可以在這條執行緒叫。
fn arm_show_fallback(window: &WebviewWindow, gate: Arc<Mutex<window_mode::ShowGate>>) {
    let window = window.clone();
    let label = window.label().to_string();
    std::thread::spawn(move || {
        std::thread::sleep(window_mode::SHOW_FALLBACK);
        let mut gate = gate.lock().unwrap_or_else(PoisonError::into_inner);
        if gate.on_timeout() {
            log::warn!(
                "window {label} still not finished loading after {:?}; showing it anyway",
                window_mode::SHOW_FALLBACK
            );
            let _ = window.show();
        }
    });
}

/// tauri.conf.json 的兩個視窗是 `create: false`:啟動狀態決定要不要開(T2c-2 驗收 3)。
/// ok 開教學卡與測驗卡;四種失敗只開 `setup` 視窗,顯示 `start_screen` 的那一頁。
/// 卡片視窗先藏起來:頁面第一次載入完(或逾時)才顯示。setup 視窗不改,照舊有系統外框。
fn open_windows(app: &App, state: StartState) -> Result<(), Box<dyn std::error::Error>> {
    let session = session::detect_from_env();
    let mode = window_mode::mode_for(desktop_is_composited());
    let script = window_mode::init_script(mode);
    for label in start_screen::windows(state) {
        let config = app
            .config()
            .app
            .windows
            .iter()
            .find(|w| w.label == *label)
            .ok_or_else(|| format!("tauri.conf.json has no window labelled {label}"))?
            .clone();
        let gate = Arc::new(Mutex::new(window_mode::ShowGate::new()));
        let gate_for_page = Arc::clone(&gate);
        let window = WebviewWindowBuilder::from_config(app.handle(), &config)?
            .initialization_script(script.clone())
            .on_page_load(move |window, payload| {
                if payload.event() != PageLoadEvent::Finished {
                    return;
                }
                let mut gate = gate_for_page.lock().unwrap_or_else(PoisonError::into_inner);
                if gate.on_page_finished() {
                    let _ = window.show();
                }
            })
            .build()?;
        arm_show_fallback(&window, gate);
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
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
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
