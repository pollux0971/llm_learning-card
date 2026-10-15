//! §10 的 warning 事件由 Rust 寫(ADR-069:webview 沒有 `node:fs`,TS 呼叫不了 `recordEvent`)。
//!
//! 一行的欄位與順序跟 T2b 的 TS 版一樣:`ts`、`type`、`path`、`reason`;Rust 另加 `op`(哪個入口)、
//! `check`(`Refusal` 的 reason),asset 的限流行再加 `count`。順序靠 serde_json 的 `preserve_order`。
//!
//! 寫法(§11b 的 log 例外):`O_APPEND` 開 `<learning 根>/state/log.jsonl`,「JSON + `\n`」用**一次**
//! `write_all` 寫完,再 `fsync`。開檔之前先建 `<根>/state` 這一層(T2c-2 驗收 10:`scripts/vault.ts init`
//! 只建 `config/`,剛初始化的根沒有 `state/`,warning 不能因此消失;TS 的 `appendLogEvent` 也自己建,ADR-070)。
//! 只建這一層、只在要寫的時候建:根本身不建(呼叫端先 canonicalize 根,根不在就走不到這裡),啟動時不建。
//! 還是寫不進去(例如 `state` 是一般檔案)就交給呼叫端記到 Rust log(`init_logging` 印到 stderr),
//! 拒絕照樣是拒絕。log 檔最後一行原本沒有 `\n` 的情況不處理(TS 版同樣不處理,已知限制)。

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};
use time::macros::format_description;
use time::OffsetDateTime;

/// asset 拒絕的限流視窗:同一個 reason 距離上一行 ≥ 60 秒才寫下一行。
pub const ASSET_REFUSAL_WINDOW: Duration = Duration::from_secs(60);

/// 把「JSON + `\n`」用一次 `write_all` 寫進 sink。
pub fn append_line(sink: &mut impl Write, event: &Value) -> io::Result<()> {
    let mut line = serde_json::to_vec(event)?;
    line.push(b'\n');
    sink.write_all(&line)
}

pub fn log_path(root: &Path) -> PathBuf {
    root.join("state").join("log.jsonl")
}

/// 先確定 `<根>/state` 在(已經存在不算錯),再 `O_APPEND` 開檔(不存在就建檔)、一次寫一整行、`fsync`。
pub fn append_to_log(root: &Path, event: &Value) -> io::Result<()> {
    ensure_state_dir(root)?;
    let mut file = OpenOptions::new().append(true).create(true).open(log_path(root))?;
    append_line(&mut file, event)?;
    file.sync_all()
}

/// 只建 `state` 這一層,不往上建(`create_dir`,不是 `create_dir_all`)。`state` 已經在——不論是目錄還是
/// 一般檔案——都不算錯;是一般檔案的話,接下來的開檔會失敗,錯誤交給 `record` 記下來。
fn ensure_state_dir(root: &Path) -> io::Result<()> {
    match fs::create_dir(root.join("state")) {
        Err(err) if err.kind() != io::ErrorKind::AlreadyExists => Err(err),
        _ => Ok(()),
    }
}

/// 寫一行;寫不進去只記到 Rust log,不改變呼叫端的結果(拒絕照樣是拒絕)。
pub fn record(root: &Path, event: &Value) {
    if let Err(err) = append_to_log(root, event) {
        log::error!("could not append a warning event to {}: {err}", log_path(root).display());
    }
}

/// ISO 8601、UTC、毫秒,例如 `2026-10-15T00:00:00.000Z`(跟 TS 的 `toISOString()` 同一個樣子)。
pub fn iso8601(at: SystemTime) -> String {
    let format = format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z");
    OffsetDateTime::from(at)
        .format(&format)
        .unwrap_or_else(|_| "1970-01-01T00:00:00.000Z".to_string())
}

/// command 的拒絕(不限流):`{ts, type, path, reason, op, check}`。
pub fn command_refusal(at: SystemTime, op: &str, path: &str, check: &str) -> Value {
    json!({
        "ts": iso8601(at),
        "type": "warning",
        "path": path,
        "reason": "path-refused",
        "op": op,
        "check": check,
    })
}

/// asset 的拒絕(限流):`{ts, type, path, reason, op: "asset", check, count}`。
pub fn asset_refusal(at: SystemTime, path: &str, check: &str, count: u64) -> Value {
    json!({
        "ts": iso8601(at),
        "type": "warning",
        "path": path,
        "reason": "path-refused",
        "op": "asset",
        "check": check,
        "count": count,
    })
}

/// asset handler 的拒絕限流,時鐘由呼叫端傳入。
///
/// 規則(ADR-069、phase-2.feature):同一個 reason 距離**上一行**(不是上一次拒絕)≥ 60 秒才寫;
/// 那一行的 `count` = 上一行之後(含這一次)被拒絕的次數;`path` 是觸發寫入的那一次的路徑。
/// 程式正常結束時 `flush` 把還沒寫出的次數各補一行(被強制結束時會少,已知限制)。
#[derive(Debug, Default)]
pub struct AssetRefusalLimiter {
    reasons: BTreeMap<String, Window>,
}

#[derive(Debug)]
struct Window {
    last_line: SystemTime,
    pending: u64,
    pending_path: String,
}

impl AssetRefusalLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// 這一次要寫一行就回那一行,不寫就回 `None`(次數記下來,下一行或 `flush` 時算進 `count`)。
    pub fn on_refusal(&mut self, now: SystemTime, reason: &str, path: &str) -> Option<Value> {
        let Some(window) = self.reasons.get_mut(reason) else {
            self.reasons.insert(
                reason.to_string(),
                Window {
                    last_line: now,
                    pending: 0,
                    pending_path: String::new(),
                },
            );
            return Some(asset_refusal(now, path, reason, 1));
        };
        if !window_has_passed(window.last_line, now) {
            window.pending += 1;
            window.pending_path = path.to_string();
            return None;
        }
        let count = window.pending + 1;
        window.last_line = now;
        window.pending = 0;
        window.pending_path.clear();
        Some(asset_refusal(now, path, reason, count))
    }

    /// 還沒寫出的次數,每個 reason 補一行;`path` 是最後一次沒寫出的那一個。
    pub fn flush(&mut self, now: SystemTime) -> Vec<Value> {
        let mut lines = Vec::new();
        for (reason, window) in &mut self.reasons {
            if window.pending == 0 {
                continue;
            }
            lines.push(asset_refusal(now, &window.pending_path, reason, window.pending));
            window.last_line = now;
            window.pending = 0;
            window.pending_path.clear();
        }
        lines
    }
}

/// 時鐘往回走(`now` 比上一行早)不算過了視窗。
fn window_has_passed(last_line: SystemTime, now: SystemTime) -> bool {
    now.duration_since(last_line)
        .map(|elapsed| elapsed >= ASSET_REFUSAL_WINDOW)
        .unwrap_or(false)
}
