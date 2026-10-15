//! 10-desktop-shell。路徑檢查的權威在這裡;TS 的 assetUrl 只是提示。

pub mod asset_protocol;
pub mod learning_fs;
pub mod path_guard;
pub mod session;

use std::path::PathBuf;

/// 桌面行程用的 learning 根。測試與 probe 各自帶根目錄,不走這條。
pub fn configured_root() -> Option<PathBuf> {
    std::env::var_os("LC_LEARNING_ROOT").map(PathBuf::from)
}
