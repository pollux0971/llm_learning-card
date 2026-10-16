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

// ───────────────────────────── T21(紅測試 stub:簽名固定,內容由開發 worker 依工單寫)

/// 沒有合成器時視窗的底色。跟 packages/ui-shared/src/hud/hud.css 的 `--hud-solid` 同一個值(測試釘住)。
/// (stub:故意不是正確的值,紅測試要因為「值不對」而紅。)
pub const SOLID_BACKGROUND: [u8; 4] = [0, 0, 0, 0];

/// 建窗時視窗的表面:透明與否、底色。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowSurface {
    pub transparent: bool,
    pub background: Option<[u8; 4]>,
}

/// 只看 `mode.solid`:有合成器 → 透明、不塗底色;沒有 → 不透明、`SOLID_BACKGROUND`。
pub fn surface_for(_mode: WindowMode) -> WindowSurface {
    unimplemented!("T21: surface_for")
}

/// 兩個卡片視窗都顯示之後,鍵盤焦點給這個視窗(考試卡)。(stub:空字串,值由開發 worker 依工單寫。)
pub const STARTUP_FOCUS: &str = "";

/// 啟動焦點:所有要開的卡片視窗都顯示之後,只給一次。
#[derive(Debug)]
pub struct StartupFocus {
    _stub: (),
}

impl StartupFocus {
    pub fn new(_labels: &[&str]) -> Self {
        unimplemented!("T21: StartupFocus::new")
    }

    /// 某個視窗剛顯示。全部都顯示的那一次回 `Some(STARTUP_FOCUS)`,之後都回 `None`。
    pub fn on_shown(&mut self, _label: &str) -> Option<&'static str> {
        unimplemented!("T21: StartupFocus::on_shown")
    }
}
