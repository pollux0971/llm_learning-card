//! T16 紅測試用的空殼:只讓 `tests/window_mode.rs` 編得過,沒有任何實作(每個函式都 `unimplemented!`)。
//! 開發 worker 整個換掉這個檔;型別名、函式名、簽章、derive 照這裡(測試用得到):
//!   - `WindowMode { frameless, solid }`:Debug、Clone、Copy、PartialEq、Eq。
//!   - `mode_for(composited) -> WindowMode`、`init_script(mode) -> String`。
//!   - `SHOW_FALLBACK: Duration`、`ShowGate::new()`、`on_page_finished(&mut self) -> bool`、`on_timeout(&mut self) -> bool`。
//! 規格見 docs/tickets/T16-desktop-phase-6.md 驗收 1 與 3。

use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowMode {
    pub frameless: bool,
    pub solid: bool,
}

/// 空殼的值是錯的(零秒),真正的值見工單。
pub const SHOW_FALLBACK: Duration = Duration::from_secs(0);

pub fn mode_for(_composited: bool) -> WindowMode {
    unimplemented!("T16:mode_for")
}

pub fn init_script(_mode: WindowMode) -> String {
    unimplemented!("T16:init_script")
}

#[derive(Debug)]
pub struct ShowGate {
    _private: (),
}

impl ShowGate {
    pub fn new() -> Self {
        unimplemented!("T16:ShowGate::new")
    }

    pub fn on_page_finished(&mut self) -> bool {
        unimplemented!("T16:ShowGate::on_page_finished")
    }

    pub fn on_timeout(&mut self) -> bool {
        unimplemented!("T16:ShowGate::on_timeout")
    }
}
