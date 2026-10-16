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

/// 先顯示的那個視窗(教學卡)。考試卡要等它顯示過才顯示,焦點才會落在後 map 的考試卡。
pub const SHOW_FIRST: &str = "teach";

/// 教學卡一直沒顯示時,考試卡最晚在建窗後這麼久顯示。比每個視窗自己的 3 秒顯示退路晚。
pub const ORDER_BACKSTOP: Duration = Duration::from_secs(5);

/// 啟動時要依序執行的視窗動作。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupAction {
    Show(&'static str),
    Focus(&'static str),
}

/// 啟動順序:兩張都開時,考試卡一定在教學卡之後顯示。不開視窗、不碰時鐘。
#[derive(Debug)]
pub struct StartupFocus {
    opening: Vec<String>,
    ready: Vec<String>,
    shown: Vec<String>,
}

impl StartupFocus {
    /// labels:這次要開的卡片視窗(start_screen::windows(state);ok 時是 teach、test;四種失敗是空的)。
    pub fn new(labels: &[&'static str]) -> Self {
        let mut opening = Vec::new();
        for label in labels {
            if !opening.iter().any(|seen| seen == label) {
                opening.push((*label).to_string());
            }
        }
        Self {
            opening,
            ready: Vec::new(),
            shown: Vec::new(),
        }
    }

    fn opens(&self, label: &str) -> bool {
        self.opening.iter().any(|open| open == label)
    }

    fn is_ready(&self, label: &str) -> bool {
        self.ready.iter().any(|ready| ready == label)
    }

    fn is_shown(&self, label: &str) -> bool {
        self.shown.iter().any(|shown| shown == label)
    }

    /// 兩張都開才等。只開考試卡不等教學卡;沒有考試卡就沒有東西好等。
    fn test_waits_for_teach(&self) -> bool {
        self.opens(SHOW_FIRST) && self.opens(STARTUP_FOCUS)
    }

    /// 這個視窗準備好了(ShowGate 第一次回 true)。回傳現在要依序執行的動作。
    pub fn on_ready(&mut self, label: &str) -> Vec<StartupAction> {
        if !self.opens(label) || self.is_ready(label) {
            return Vec::new();
        }
        self.ready.push(label.to_string());

        if label == SHOW_FIRST {
            let mut actions = self.show_first();
            if self.test_waits_for_teach() && self.is_ready(STARTUP_FOCUS) && !self.is_shown(STARTUP_FOCUS) {
                actions.extend(self.show_focus());
            } else if self.is_shown(STARTUP_FOCUS) && !actions.is_empty() {
                // 考試卡已被退路顯示,教學卡後 map 會搶焦點,補一次保險。
                actions.push(StartupAction::Focus(STARTUP_FOCUS));
            }
            return actions;
        }

        if label == STARTUP_FOCUS {
            if self.test_waits_for_teach() && !self.is_shown(SHOW_FIRST) {
                return Vec::new();
            }
            return self.show_focus();
        }

        Vec::new()
    }

    /// ORDER_BACKSTOP 到了。教學卡還沒顯示時,考試卡照樣顯示(呼叫端寫一行 warn)。
    pub fn on_backstop(&mut self) -> Vec<StartupAction> {
        if !self.opens(STARTUP_FOCUS) || self.is_shown(STARTUP_FOCUS) {
            return Vec::new();
        }
        // 教學卡已經顯示:考試卡等自己的 on_ready,這條退路不管。
        if self.test_waits_for_teach() && self.is_shown(SHOW_FIRST) {
            return Vec::new();
        }
        self.show_focus()
    }

    fn show_first(&mut self) -> Vec<StartupAction> {
        if !self.opens(SHOW_FIRST) || self.is_shown(SHOW_FIRST) {
            return Vec::new();
        }
        self.shown.push(SHOW_FIRST.to_string());
        vec![StartupAction::Show(SHOW_FIRST)]
    }

    /// Show(test) 與 Focus(test) 一起回,Focus 緊接在 Show 之後。
    fn show_focus(&mut self) -> Vec<StartupAction> {
        if !self.opens(STARTUP_FOCUS) || self.is_shown(STARTUP_FOCUS) {
            return Vec::new();
        }
        self.shown.push(STARTUP_FOCUS.to_string());
        vec![
            StartupAction::Show(STARTUP_FOCUS),
            StartupAction::Focus(STARTUP_FOCUS),
        ]
    }
}
