//! 桌面 session 類型偵測(X11 / Wayland)。
//! 純函式,規則與 `apps/desktop/src/session.ts` 一致,兩邊各自測試(見 phase-1.feature 的
//! "Detecting the session type" scenario outline,TS 那份是實際跑驗收的一份)。

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionType {
    X11,
    Wayland,
}

pub fn detect_session_type(xdg_session_type: Option<&str>, wayland_display: Option<&str>) -> SessionType {
    if xdg_session_type == Some("wayland") {
        return SessionType::Wayland;
    }
    if wayland_display.is_some_and(|d| !d.is_empty()) {
        return SessionType::Wayland;
    }
    SessionType::X11
}

pub fn detect_from_env() -> SessionType {
    let session = std::env::var("XDG_SESSION_TYPE").ok();
    let display = std::env::var("WAYLAND_DISPLAY").ok();
    detect_session_type(session.as_deref(), display.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wayland_session_wins_regardless_of_display() {
        assert_eq!(detect_session_type(Some("wayland"), Some("wayland-0")), SessionType::Wayland);
    }

    #[test]
    fn x11_session_with_no_display_is_x11() {
        assert_eq!(detect_session_type(Some("x11"), None), SessionType::X11);
    }

    #[test]
    fn no_session_but_wayland_display_is_wayland() {
        assert_eq!(detect_session_type(None, Some("wayland-0")), SessionType::Wayland);
    }

    #[test]
    fn nothing_set_defaults_to_x11() {
        assert_eq!(detect_session_type(None, None), SessionType::X11);
    }
}
