//! 10-desktop-shell。路徑檢查的權威在這裡;TS 的 assetUrl 只是提示。
//! learning 根目錄只有一個來源:使用者層指標檔(`learning_root`,T2c-2)。

pub mod asset_protocol;
pub mod commands;
pub mod event_log;
pub mod learning_fs;
pub mod learning_root;
pub mod path_guard;
pub mod review_sidecar;
pub mod session;
pub mod start_screen;
pub mod window_mode;

use std::path::PathBuf;

/// 行程環境裡解析 learning 根要的兩個輸入,交給 `learning_root::resolve`:`XDG_CONFIG_HOME`(原樣;空字串由
/// `learning_root::pointer_path` 當成沒設)與家目錄(`HOME`,沒設才問系統的使用者資料庫;跟 Node 的 `os.homedir()`
/// 同一個順序)。main.rs 與 probe 用同一個;沒有別的來源。
pub fn pointer_env() -> (Option<String>, PathBuf) {
    let xdg_config_home = std::env::var_os("XDG_CONFIG_HOME").map(|v| v.to_string_lossy().into_owned());
    #[allow(deprecated)]
    let home = std::env::home_dir().unwrap_or_default();
    (xdg_config_home, home)
}

/// main.rs 與 probe(`src/bin/lc-fs.rs`)共用的 logger(T2c-2 驗收 10):寫到 stderr。
/// 沒設 `RUST_LOG` 時,依賴只印 error,本 crate 的 warn 也印(T16 逾時退路);設了就完全照它。重複呼叫不算錯。
pub fn init_logging() {
    let filter = log_filter(std::env::var("RUST_LOG").ok().as_deref());
    let _ = env_logger::Builder::new()
        .parse_filters(&filter)
        .target(env_logger::Target::Stderr)
        .try_init();
}

/// 沒設 `RUST_LOG` 時讓本 crate 的 warn 看得到,別的 crate 仍只印 error。設了就原樣採用,不加預設。
pub fn log_filter(rust_log: Option<&str>) -> String {
    match rust_log {
        Some(value) => value.to_string(),
        None => "error,learning_cards_desktop=warn".to_string(),
    }
}
