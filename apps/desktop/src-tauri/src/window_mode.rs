//! 合成器判定、頁面模式、載入完才顯示的逾時退路(T16 / ADR-072)。
//! 不開視窗、不碰時鐘:main.rs 負責問 GDK、把這段程式交給 WebKit、計時與 show。

use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowMode {
    pub frameless: bool,
    pub solid: bool,
}

/// 頁面一直不完成載入時,超過這段時間也要顯示(使用者不能永遠看不到視窗)。
pub const SHOW_FALLBACK: Duration = Duration::from_secs(3);

/// `frameless` 永遠 true。`solid` 只在沒有合成器時為 true,切角才不會是黑的。
pub fn mode_for(composited: bool) -> WindowMode {
    WindowMode {
        frameless: true,
        solid: !composited,
    }
}

/// 第一行把模式交給頁面;第一個換行之後逐字是 `window_mode.js`(vitest 測同一個檔)。
pub fn init_script(mode: WindowMode) -> String {
    let json = serde_json::json!({
        "frameless": mode.frameless,
        "solid": mode.solid,
    });
    format!("window.__LC_WINDOW_MODE__ = {json};\n{}", include_str!("window_mode.js"))
}

/// 每個視窗一顆:載入完成與逾時,先到的那一次要顯示,後到的什麼都不做。
#[derive(Debug)]
pub struct ShowGate {
    shown: bool,
}

impl ShowGate {
    pub fn new() -> Self {
        Self { shown: false }
    }

    /// 載入完成。回 true 時呼叫端顯示視窗,不寫 warn。
    pub fn on_page_finished(&mut self) -> bool {
        self.show_once()
    }

    /// 逾時。回 true 時呼叫端顯示視窗並寫 warn;已經顯示過則回 false。
    pub fn on_timeout(&mut self) -> bool {
        self.show_once()
    }

    fn show_once(&mut self) -> bool {
        if self.shown {
            return false;
        }
        self.shown = true;
        true
    }
}
