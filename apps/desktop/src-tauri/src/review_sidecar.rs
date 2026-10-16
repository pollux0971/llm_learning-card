//! T22:複習側車的 Rust 端(起、傳、收、關)。**紅測試 stub**:簽名固定在這裡,內容由開發 worker 依工單寫。
//! 常數的值故意不是正確的(紅測試要因為「值不對」而紅);函式都是 `unimplemented!`。
//! Rust 不看 method、params、result、error 的內容(ADR-075):只看信封。

use std::path::{Path, PathBuf};
use std::time::Duration;

/// 一行最多這麼多位元組(不含結尾換行)。
pub const MAX_LINE_BYTES: usize = 0;
/// 等側車的 hello 最久這麼久。
pub const HELLO_TIMEOUT: Duration = Duration::from_secs(0);
/// 一個請求最久這麼久沒回就收掉側車。
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(0);
/// 子行程的環境只從這份白名單重建。
pub const CHILD_ENV_ALLOWLIST: [&str; 12] = [""; 12];
/// 只有 debug build 才另外帶入的兩個。
pub const DEBUG_ONLY_ENV: [&str; 2] = ["", ""];

/// 信封不合。`kind` 是 `bad-envelope`(webview 給的請求)或 `bad-response`(側車回的那一行)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvelopeError {
    pub kind: String,
}

/// Rust 自己的錯誤:`kind` 是 `not-configured`、`sidecar-unavailable`、`sidecar-exited`、`timeout`、`busy`、`bad-envelope`、`bad-response`。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ReviewError {
    pub kind: String,
}

/// webview 給的請求:只檢查 v == 1、id 是 ≥ 1 的整數、method 是字串、params 是物件、序列化成一行後 ≤ MAX_LINE_BYTES。
/// 通過就回那一行(內容不改,不含換行)。
pub fn request_line(_request: &serde_json::Value) -> Result<String, EnvelopeError> {
    unimplemented!("T22: request_line")
}

/// 側車回的一行:只檢查是 JSON 物件、v == 1、長度 ≤ MAX_LINE_BYTES;回傳原樣的 Value。
pub fn parse_response_line(_line: &str) -> Result<serde_json::Value, EnvelopeError> {
    unimplemented!("T22: parse_response_line")
}

/// 子行程的環境:CHILD_ENV_ALLOWLIST 裡有值的變數;`debug` 為 true 時再加 DEBUG_ONLY_ENV 裡有值的。其他一律不帶。
pub fn child_env(_debug: bool, _env: impl Iterator<Item = (String, String)>) -> Vec<(String, String)> {
    unimplemented!("T22: child_env")
}

/// 起側車的程式、參數、工作目錄:("node", ["--import", "tsx", "<repo>/scripts/review-sidecar.ts", "--dir", <learning 根>], <repo>)。
pub fn sidecar_command(_repo_root: &Path, _learning_root: &Path) -> (String, Vec<String>, PathBuf) {
    unimplemented!("T22: sidecar_command")
}

/// 起一個側車行程要的東西(程式、參數、工作目錄、**完整**環境:host 先 env_clear 再逐一帶入這份)。
#[derive(Debug, Clone)]
pub struct SidecarSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
}

/// 可以注入的時間(測試用短的;預設是上面的常數與 3 秒)。
#[derive(Debug, Clone, Copy)]
pub struct SidecarTimeouts {
    pub hello: Duration,
    pub request: Duration,
    /// 關 app 時關掉 stdin 之後最多等這麼久,還在就 kill
    pub exit_grace: Duration,
}

type SpecProvider = Box<dyn Fn() -> Result<SidecarSpec, ReviewError> + Send + Sync>;

/// 側車行程的管理者(Tauri managed state)。第一次 `call` 才起行程;一次只有一個請求。
pub struct SidecarHost {
    _provider: SpecProvider,
    _timeouts: SidecarTimeouts,
}

impl SidecarHost {
    /// `provider` 在每次要(重)起側車時呼叫;回 Err(`not-configured`)就不起、`call` 回那個錯。
    pub fn new(provider: SpecProvider, timeouts: SidecarTimeouts) -> Self {
        Self {
            _provider: provider,
            _timeouts: timeouts,
        }
    }

    /// 送一則請求、等 `id` 相同的那一行回應,原樣回傳(含 `ok: false` 的業務錯誤)。Rust 自己的錯誤是 `Err`。
    pub fn call(&self, _request: &serde_json::Value) -> Result<serde_json::Value, ReviewError> {
        unimplemented!("T22: SidecarHost::call")
    }

    /// 關 app:關掉 stdin、等 `exit_grace`,還在就 kill,再 wait。沒有行程時什麼都不做。
    pub fn shutdown(&self) {
        unimplemented!("T22: SidecarHost::shutdown")
    }

    /// 目前側車的 pid(沒有行程時 None)。
    pub fn child_pid(&self) -> Option<u32> {
        unimplemented!("T22: SidecarHost::child_pid")
    }
}
