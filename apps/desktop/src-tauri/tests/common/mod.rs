//! T2c-1 測試共用(測試 agent 寫的;實作者不要改,要改先回報協調者)。
//!
//! 暫存目錄一律在 `std::env::temp_dir()` 底下新建、名字帶 `lc-t2c1-`,Drop 只刪自己建的那一個。
//! 不碰真的 learning/。

#![allow(dead_code)]

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

const MARK: &str = "lc-t2c1-";

pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new(prefix: &str) -> Self {
        static N: AtomicU64 = AtomicU64::new(0);
        let base = std::env::temp_dir();
        loop {
            let n = N.fetch_add(1, Ordering::SeqCst);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let p = base.join(format!("{MARK}{prefix}-{}-{n}-{nanos}", std::process::id()));
            match fs::create_dir(&p) {
                Ok(()) => {
                    // learning_fs 會 canonicalize 根目錄;測試這邊也用 canonical 形式比對路徑。
                    let canon = p.canonicalize().expect("canonicalize temp dir");
                    return TempDir(canon);
                }
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => panic!("create temp dir {}: {e}", p.display()),
            }
        }
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let name = self.0.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name.starts_with(MARK) {
            restore_permissions(&self.0);
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

/// 權限 000 的 fixture 刪不掉的話留垃圾;刪之前把權限改回來。
fn restore_permissions(dir: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else { continue };
        if meta.file_type().is_symlink() {
            continue;
        }
        let mode = if meta.is_dir() { 0o755 } else { 0o644 };
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(mode));
        if meta.is_dir() {
            restore_permissions(&path);
        }
    }
}

/// `<parent>/learning`(含 `state/`)與 `<parent>/outside`(含哨兵檔 `secret`)。
pub struct Learning {
    pub parent: TempDir,
    pub root: PathBuf,
    pub outside: PathBuf,
}

impl Learning {
    pub fn new(prefix: &str) -> Self {
        let parent = TempDir::new(prefix);
        let root = parent.path().join("learning");
        let outside = parent.path().join("outside");
        fs::create_dir_all(root.join("state")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret"), "OUTSIDE-SENTINEL").unwrap();
        Learning {
            parent,
            root,
            outside,
        }
    }

    pub fn plant(&self, rel: &str, bytes: &[u8]) -> PathBuf {
        let full = self.root.join(rel);
        if let Some(dir) = full.parent() {
            fs::create_dir_all(dir).unwrap();
        }
        fs::write(&full, bytes).unwrap();
        full
    }

    pub fn log_path(&self) -> PathBuf {
        self.root.join("state").join("log.jsonl")
    }

    /// log.jsonl 的原始內容(不存在 = 空字串)。
    pub fn log_text(&self) -> String {
        match fs::read(self.log_path()) {
            Ok(bytes) => String::from_utf8(bytes).expect("log.jsonl must be UTF-8"),
            Err(e) if e.kind() == io::ErrorKind::NotFound => String::new(),
            Err(e) => panic!("read log.jsonl: {e}"),
        }
    }

    /// 完整的行(以 `\n` 結尾的那些)。最後一段沒有 `\n` 就 panic:那是「不是一整行」。
    pub fn log_lines(&self) -> Vec<String> {
        let text = self.log_text();
        if text.is_empty() {
            return Vec::new();
        }
        assert!(
            text.ends_with('\n'),
            "log.jsonl does not end with a newline: {text:?}"
        );
        text.trim_end_matches('\n')
            .split('\n')
            .map(str::to_string)
            .collect()
    }

    pub fn log_events(&self) -> Vec<Value> {
        self.log_lines()
            .iter()
            .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("not JSON: {l:?}: {e}")))
            .collect()
    }
}

/// 錯誤在邊界上的形狀:command 回給 webview 的就是這個 JSON。
/// `{"kind":"refused","reason":<Refusal 的 reason>}` 或 `{"kind":"io","code":<分類>, ...}`。
pub fn wire<E: Serialize>(e: &E) -> Value {
    serde_json::to_value(e).expect("error must serialize")
}

pub fn refusal_reason<E: Serialize>(e: &E) -> String {
    let v = wire(e);
    assert_eq!(v["kind"], "refused", "expected a refusal, got {v}");
    v["reason"]
        .as_str()
        .unwrap_or_else(|| panic!("refusal without reason: {v}"))
        .to_string()
}

pub fn io_code<E: Serialize>(e: &E) -> String {
    let v = wire(e);
    assert_eq!(v["kind"], "io", "expected an io error, got {v}");
    v["code"]
        .as_str()
        .unwrap_or_else(|| panic!("io error without code: {v}"))
        .to_string()
}

pub fn is_root_user() -> bool {
    // SAFETY: geteuid 沒有前置條件。
    unsafe { libc::geteuid() == 0 }
}

/// ISO 8601,含時區(`Z` 或 `±hh:mm`)。契約 §10。
pub fn is_iso8601_with_zone(ts: &str) -> bool {
    let b = ts.as_bytes();
    if b.len() < 20 {
        return false;
    }
    let digits = |r: std::ops::Range<usize>| r.into_iter().all(|i| b[i].is_ascii_digit());
    if !(digits(0..4)
        && b[4] == b'-'
        && digits(5..7)
        && b[7] == b'-'
        && digits(8..10)
        && b[10] == b'T'
        && digits(11..13)
        && b[13] == b':'
        && digits(14..16)
        && b[16] == b':'
        && digits(17..19))
    {
        return false;
    }
    let mut i = 19;
    if b[i] == b'.' {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == start {
            return false;
        }
    }
    let zone = &ts[i..];
    if zone == "Z" {
        return true;
    }
    let z = zone.as_bytes();
    z.len() == 6
        && (z[0] == b'+' || z[0] == b'-')
        && z[1].is_ascii_digit()
        && z[2].is_ascii_digit()
        && z[3] == b':'
        && z[4].is_ascii_digit()
        && z[5].is_ascii_digit()
}

/// command 拒絕寫出的 warning 事件(T2b 的 TS 版欄位與順序:ts、type、path、reason)。
/// `op`、`check`、`count` 是 Rust 可以多加的欄位;其他欄位不准出現。
pub fn assert_warning_line(line: &str, path: &str) -> Value {
    let v: Value = serde_json::from_str(line).unwrap_or_else(|e| panic!("not JSON: {line:?}: {e}"));
    let obj = v.as_object().unwrap_or_else(|| panic!("not an object: {line}"));
    let ts = obj
        .get("ts")
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("no ts: {line}"));
    assert!(is_iso8601_with_zone(ts), "ts is not ISO 8601 with a time zone: {ts:?}");
    assert_eq!(obj.get("type"), Some(&Value::from("warning")), "{line}");
    assert_eq!(obj.get("path"), Some(&Value::from(path)), "{line}");
    assert_eq!(obj.get("reason"), Some(&Value::from("path-refused")), "{line}");
    for key in obj.keys() {
        assert!(
            matches!(key.as_str(), "ts" | "type" | "path" | "reason" | "op" | "check" | "count"),
            "unexpected field {key:?} in {line}"
        );
    }
    let pos = |k: &str| {
        line.find(&format!("\"{k}\":"))
            .unwrap_or_else(|| panic!("{k} missing in {line}"))
    };
    assert!(
        pos("ts") < pos("type") && pos("type") < pos("path") && pos("path") < pos("reason"),
        "field order must be ts, type, path, reason (T2b TS version): {line}"
    );
    v
}
