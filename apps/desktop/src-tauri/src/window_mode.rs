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

// ───────────────────────────── T21:沒有合成器時的實心底、啟動焦點

/// 沒有合成器時視窗的底色:跟 packages/ui-shared/src/hud/hud.css 的 --hud-solid 同一個值(測試釘住)。
pub const SOLID_BACKGROUND: [u8; 4] = [0xf4, 0xf6, 0xf8, 0xff];

/// 建窗時視窗的表面:透明與否、底色。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowSurface {
    pub transparent: bool,
    pub background: Option<[u8; 4]>,
}

/// 只看 `mode.solid`,不另外問 GDK。有合成器 → 透明、不塗底色;沒有 → 不透明、`SOLID_BACKGROUND`。
pub fn surface_for(mode: WindowMode) -> WindowSurface {
    if mode.solid {
        WindowSurface {
            transparent: false,
            background: Some(SOLID_BACKGROUND),
        }
    } else {
        WindowSurface {
            transparent: true,
            background: None,
        }
    }
}

/// 最後顯示、拿到焦點的那個視窗(考試卡:使用者開 app 之後要在這裡打字)。
pub const STARTUP_FOCUS: &str = "test";

/// 先顯示的那個視窗(教學卡)。(T21 第 3 輪 stub:空字串,值由開發 worker 依工單寫,紅測試要因為「值不對」而紅。)
pub const SHOW_FIRST: &str = "";

/// 教學卡一直沒顯示時,考試卡最晚在建窗後這麼久顯示。(stub:0 秒,值由開發 worker 依工單寫。)
pub const ORDER_BACKSTOP: Duration = Duration::from_secs(0);

/// 啟動時要依序執行的視窗動作。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupAction {
    Show(&'static str),
    Focus(&'static str),
}

/// 啟動焦點。第 3 輪起管「顯示順序」:考試卡一定在教學卡之後顯示。不開視窗、不碰時鐘。
#[derive(Debug)]
pub struct StartupFocus {
    /// 還沒顯示過的標籤(第 2 輪的狀態;第 3 輪由開發 worker 換成自己的狀態)。
    pending: Vec<String>,
    given: bool,
}

impl StartupFocus {
    /// labels:這次要開的卡片視窗(open_windows 的那一份,ok 時是 teach、test;四種失敗是空的)。
    pub fn new(labels: &[&'static str]) -> Self {
        let mut pending = Vec::new();
        for label in labels {
            if !pending.iter().any(|seen| seen == label) {
                pending.push((*label).to_string());
            }
        }
        Self { pending, given: false }
    }

    /// 第 2 輪的介面,**第 3 輪取代**(由 on_ready / on_backstop)。stub 先留著,不然 main.rs 編不過;
    /// 開發 worker 要把它和 main.rs 裡的呼叫一起拿掉(靜態檢查會抓還留著)。
    pub fn on_shown(&mut self, label: &str) -> Option<&'static str> {
        if self.given {
            return None;
        }
        let at = self.pending.iter().position(|pending| pending == label)?;
        self.pending.swap_remove(at);
        if !self.pending.is_empty() {
            return None;
        }
        self.given = true;
        Some(STARTUP_FOCUS)
    }

    /// 這個視窗準備好了(ShowGate 第一次回 true)。回傳現在要依序執行的動作。
    pub fn on_ready(&mut self, _label: &str) -> Vec<StartupAction> {
        unimplemented!("T21 round 3: on_ready")
    }

    /// ORDER_BACKSTOP 到了。教學卡還沒顯示時,考試卡照樣顯示。
    pub fn on_backstop(&mut self) -> Vec<StartupAction> {
        unimplemented!("T21 round 3: on_backstop")
    }
}
