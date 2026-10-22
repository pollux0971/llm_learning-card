//! T22:複習側車的 Rust 端。只「起、傳、收、關」(ADR-075)。
//! 不看動作名稱,也不看回覆內容。信封只查版本、識別碼、動作是不是字串、參數是不是物件、長度。

use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Mutex, TryLockError};
use std::thread;
use std::time::{Duration, Instant};

/// 一行最多這麼多位元組(不含結尾換行)。
pub const MAX_LINE_BYTES: usize = 262_144;
/// 等側車的 hello 最久這麼久。
pub const HELLO_TIMEOUT: Duration = Duration::from_secs(20);
/// 一個請求最久這麼久沒回就收掉側車。
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);
/// 子行程的環境只從這份白名單重建。
pub const CHILD_ENV_ALLOWLIST: [&str; 12] = [
    "PATH",
    "HOME",
    "USER",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
];
/// 只有 debug build 才另外帶入的兩個。
pub const DEBUG_ONLY_ENV: [&str; 2] = ["LC_REVIEW_FAKE_CLOUD", "LC_REVIEW_TODAY"];

/// 信封不合。`kind` 是 `bad-envelope`(webview 給的請求)或 `bad-response`(側車回的那一行)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvelopeError {
    pub kind: String,
}

/// Rust 自己的錯誤。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ReviewError {
    pub kind: String,
}

fn envelope_err(kind: &str) -> EnvelopeError {
    EnvelopeError {
        kind: kind.to_string(),
    }
}

fn review_err(kind: &str) -> ReviewError {
    ReviewError {
        kind: kind.to_string(),
    }
}

/// webview 給的請求:只檢查 v == 1、id 是 ≥ 1 的整數、method 是字串、params 是物件、序列化成一行後 ≤ MAX_LINE_BYTES。
/// 通過就回那一行(內容不改,不含換行)。
pub fn request_line(request: &serde_json::Value) -> Result<String, EnvelopeError> {
    let obj = request
        .as_object()
        .ok_or_else(|| envelope_err("bad-envelope"))?;
    let version = obj
        .get("v")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| envelope_err("bad-envelope"))?;
    if version != 1 {
        return Err(envelope_err("bad-envelope"));
    }
    let id = obj
        .get("id")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| envelope_err("bad-envelope"))?;
    if id < 1 {
        return Err(envelope_err("bad-envelope"));
    }
    if obj
        .get("method")
        .and_then(serde_json::Value::as_str)
        .is_none()
    {
        return Err(envelope_err("bad-envelope"));
    }
    let params = obj
        .get("params")
        .ok_or_else(|| envelope_err("bad-envelope"))?;
    if !params.is_object() {
        return Err(envelope_err("bad-envelope"));
    }
    let line = serde_json::to_string(request).map_err(|_| envelope_err("bad-envelope"))?;
    if line.len() > MAX_LINE_BYTES {
        return Err(envelope_err("bad-envelope"));
    }
    Ok(line)
}

/// 側車回的一行:只檢查是 JSON 物件、v == 1、長度 ≤ MAX_LINE_BYTES;回傳原樣的 Value。
pub fn parse_response_line(line: &str) -> Result<serde_json::Value, EnvelopeError> {
    if line.len() > MAX_LINE_BYTES {
        return Err(envelope_err("bad-response"));
    }
    let value: serde_json::Value =
        serde_json::from_str(line).map_err(|_| envelope_err("bad-response"))?;
    let obj = value
        .as_object()
        .ok_or_else(|| envelope_err("bad-response"))?;
    let version = obj
        .get("v")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| envelope_err("bad-response"))?;
    if version != 1 {
        return Err(envelope_err("bad-response"));
    }
    Ok(value)
}

/// 子行程的環境:CHILD_ENV_ALLOWLIST 裡有值的變數;`debug` 為 true 時再加 DEBUG_ONLY_ENV 裡有值的。其他一律不帶。
pub fn child_env(
    debug: bool,
    env: impl Iterator<Item = (String, String)>,
) -> Vec<(String, String)> {
    let map: HashMap<String, String> = env.collect();
    let mut out = Vec::new();
    for key in CHILD_ENV_ALLOWLIST {
        if let Some(value) = map.get(key) {
            out.push((key.to_string(), value.clone()));
        }
    }
    if debug {
        for key in DEBUG_ONLY_ENV {
            if let Some(value) = map.get(key) {
                out.push((key.to_string(), value.clone()));
            }
        }
    }
    out
}

/// 起側車的程式、參數、工作目錄。
pub fn sidecar_command(repo_root: &Path, learning_root: &Path) -> (String, Vec<String>, PathBuf) {
    let script = repo_root.join("scripts").join("review-sidecar.ts");
    (
        "node".to_string(),
        vec![
            "--import".to_string(),
            "tsx".to_string(),
            script.to_string_lossy().into_owned(),
            "--dir".to_string(),
            learning_root.to_string_lossy().into_owned(),
        ],
        repo_root.to_path_buf(),
    )
}

/// 起一個側車行程要的東西(程式、參數、工作目錄、完整環境:host 先 env_clear 再逐一帶入這份)。
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

enum StdoutMsg {
    Line(String),
    TooLarge,
    Eof,
}

struct Running {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<StdoutMsg>,
}

struct Inner {
    running: Option<Running>,
    /// 下一個要寫進側車的識別碼。從 1 起,只增不減;側車逾時、結束、重起都不歸零(ADR-078)。
    next_wire_id: u64,
}

/// 側車行程的管理者(Tauri managed state)。第一次 `call` 才起行程;一次只有一個請求。
pub struct SidecarHost {
    provider: SpecProvider,
    timeouts: SidecarTimeouts,
    inner: Mutex<Inner>,
}

impl SidecarHost {
    /// `provider` 在每次要(重)起側車時呼叫;回 Err 就不起、`call` 回那個錯。
    pub fn new(provider: SpecProvider, timeouts: SidecarTimeouts) -> Self {
        Self {
            provider,
            timeouts,
            inner: Mutex::new(Inner {
                running: None,
                next_wire_id: 1,
            }),
        }
    }

    /// 送一則請求、等線上識別碼相同的那一行回應。回應的 `id` 換回 webview 原本的,其餘原樣。Rust 自己的錯誤是 `Err`。
    pub fn call(&self, request: &serde_json::Value) -> Result<serde_json::Value, ReviewError> {
        let mut guard = match self.inner.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => return Err(review_err("busy")),
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
        };
        self.call_locked(&mut guard, request)
    }

    /// 關 app:關掉 stdin、等 `exit_grace`,還在就 kill,再 wait。沒有行程時什麼都不做。
    pub fn shutdown(&self) {
        let mut guard = match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(running) = guard.running.take() {
            stop(running, self.timeouts.exit_grace);
        }
    }

    /// 目前側車的 pid(沒有行程時 None)。
    pub fn child_pid(&self) -> Option<u32> {
        let guard = match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.running.as_ref().map(|running| running.child.id())
    }

    fn call_locked(
        &self,
        guard: &mut Inner,
        request: &serde_json::Value,
    ) -> Result<serde_json::Value, ReviewError> {
        // 信封沒過:不起側車、不用掉線上 id。
        request_line(request).map_err(|_| review_err("bad-envelope"))?;
        let webview_id = request
            .get("id")
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| review_err("bad-envelope"))?;
        if guard.running.is_none() {
            match self.spawn() {
                Ok(running) => guard.running = Some(running),
                Err(err) => return Err(err),
            }
        }
        let wire_id = guard.next_wire_id;
        let mut rewritten = request.clone();
        let Some(obj) = rewritten.as_object_mut() else {
            return Err(review_err("bad-envelope"));
        };
        obj.insert("id".to_string(), serde_json::Value::from(wire_id));
        let line = request_line(&rewritten).map_err(|_| review_err("bad-envelope"))?;
        // 寫進側車失敗也算用掉,不回退。
        guard.next_wire_id = guard.next_wire_id.saturating_add(1);
        let running = guard
            .running
            .as_mut()
            .ok_or_else(|| review_err("sidecar-unavailable"))?;
        if writeln!(running.stdin, "{line}")
            .and_then(|_| running.stdin.flush())
            .is_err()
        {
            if let Some(dead) = guard.running.take() {
                stop(dead, Duration::ZERO);
            }
            return Err(review_err("sidecar-exited"));
        }
        let timeout = self.timeouts.request;
        loop {
            let running = guard
                .running
                .as_ref()
                .ok_or_else(|| review_err("sidecar-exited"))?;
            match running.lines.recv_timeout(timeout) {
                Ok(StdoutMsg::Line(text)) => {
                    if let Ok(mut value) = parse_response_line(&text) {
                        if value.get("id").and_then(serde_json::Value::as_u64) == Some(wire_id) {
                            if let Some(resp) = value.as_object_mut() {
                                resp.insert("id".to_string(), serde_json::Value::from(webview_id));
                            }
                            return Ok(value);
                        }
                        // 識別碼不同的舊回應丟掉(比的是線上 id,不是 webview 的 id)。
                        continue;
                    }
                    eprintln!("[review-sidecar] dropped non-protocol line");
                }
                Ok(StdoutMsg::TooLarge) => return Err(review_err("bad-response")),
                Ok(StdoutMsg::Eof) => {
                    if let Some(dead) = guard.running.take() {
                        stop(dead, Duration::ZERO);
                    }
                    return Err(review_err("sidecar-exited"));
                }
                Err(RecvTimeoutError::Timeout) => {
                    if let Some(dead) = guard.running.take() {
                        stop(dead, Duration::ZERO);
                    }
                    return Err(review_err("timeout"));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    if let Some(dead) = guard.running.take() {
                        stop(dead, Duration::ZERO);
                    }
                    return Err(review_err("sidecar-exited"));
                }
            }
        }
    }

    fn spawn(&self) -> Result<Running, ReviewError> {
        let spec = (self.provider)()?;
        let mut command = Command::new(&spec.program);
        command
            .args(&spec.args)
            .current_dir(&spec.cwd)
            .env_clear()
            .envs(spec.env.iter().cloned())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|_| review_err("sidecar-unavailable"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| review_err("sidecar-unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| review_err("sidecar-unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| review_err("sidecar-unavailable"))?;
        forward_stderr(stderr);
        let lines = spawn_reader(stdout);
        let running = Running {
            child,
            stdin,
            lines,
        };
        match wait_hello(&running.lines, self.timeouts.hello) {
            Ok(()) => Ok(running),
            Err(err) => {
                stop(running, Duration::ZERO);
                Err(err)
            }
        }
    }
}

fn wait_hello(lines: &Receiver<StdoutMsg>, timeout: Duration) -> Result<(), ReviewError> {
    let deadline = Instant::now() + timeout;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(review_err("sidecar-unavailable"));
        }
        match lines.recv_timeout(left) {
            Ok(StdoutMsg::Line(text)) => {
                if is_hello(&text) {
                    return Ok(());
                }
                eprintln!("[review-sidecar] dropped non-protocol line");
            }
            Ok(StdoutMsg::TooLarge) | Ok(StdoutMsg::Eof) | Err(_) => {
                return Err(review_err("sidecar-unavailable"))
            }
        }
    }
}

fn is_hello(line: &str) -> bool {
    let Ok(value) = parse_response_line(line) else {
        return false;
    };
    value.get("kind").and_then(serde_json::Value::as_str) == Some("hello")
}

fn spawn_reader(mut stdout: impl Read + Send + 'static) -> Receiver<StdoutMsg> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || loop {
        let msg = match read_limited(&mut stdout, MAX_LINE_BYTES) {
            ReadOut::Line(text) => StdoutMsg::Line(text),
            ReadOut::TooLarge => StdoutMsg::TooLarge,
            ReadOut::Eof => {
                let _ = tx.send(StdoutMsg::Eof);
                break;
            }
        };
        if tx.send(msg).is_err() {
            break;
        }
    });
    rx
}

enum ReadOut {
    Line(String),
    TooLarge,
    Eof,
}

fn read_limited(reader: &mut impl Read, max: usize) -> ReadOut {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        match reader.read(&mut byte) {
            Ok(0) => {
                if buf.is_empty() {
                    return ReadOut::Eof;
                }
                return ReadOut::Line(String::from_utf8_lossy(&buf).into_owned());
            }
            Ok(_) if byte[0] == b'\n' => {
                return ReadOut::Line(String::from_utf8_lossy(&buf).into_owned())
            }
            Ok(_) if buf.len() >= max => {
                discard_rest(reader);
                return ReadOut::TooLarge;
            }
            Ok(_) => buf.push(byte[0]),
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return ReadOut::Eof,
        }
    }
}

fn discard_rest(reader: &mut impl Read) {
    let mut byte = [0u8; 1];
    loop {
        match reader.read(&mut byte) {
            Ok(0) => return,
            Ok(_) if byte[0] == b'\n' => return,
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return,
        }
    }
}

/// 側車 stderr 轉到 app stderr 時用的前綴(結尾有一個空白)。側車自己印的行也是這個開頭(ADR-075 第 5 條)。
pub const STDERR_PREFIX: &str = "[review-sidecar] ";

/// 側車 stderr 的一行 → 要寫到 app stderr 的那一行(不含換行)。
/// `raw` 是讀到的位元組,可能帶結尾的 `\n` 或 `\r\n`,可能有不合法的 UTF-8。
pub fn host_stderr_line(raw: &[u8]) -> String {
    let mut end = raw.len();
    while end > 0 && (raw[end - 1] == b'\n' || raw[end - 1] == b'\r') {
        end -= 1;
    }
    let trimmed = &raw[..end];
    let text = String::from_utf8_lossy(trimmed);
    if trimmed.starts_with(STDERR_PREFIX.as_bytes()) {
        text.into_owned()
    } else {
        format!("{STDERR_PREFIX}{text}")
    }
}

/// 從 `reader` 一行一行讀(`read_until(b'\n')`)到 EOF,每一行經 `host_stderr_line` 換好、加 `\n`,
/// 用**一次** `write_all` 寫進 `sink`(一行的內容與換行一起寫,不會跟別的執行緒的輸出交錯)。回傳讀到幾行。
pub fn forward_lines(mut reader: impl BufRead, mut sink: impl Write) -> usize {
    let mut buf = Vec::new();
    let mut count = 0;
    let mut sink_ok = true;
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                count += 1;
                if sink_ok {
                    let mut out = host_stderr_line(&buf).into_bytes();
                    out.push(b'\n');
                    if sink.write_all(&out).is_err() {
                        sink_ok = false;
                    }
                }
            }
        }
    }
    count
}

fn forward_stderr(stderr: impl Read + Send + 'static) {
    thread::spawn(move || {
        forward_lines(std::io::BufReader::new(stderr), std::io::stderr());
    });
}

/// 關掉 stdin、等到寬限期,還在就 kill,再 wait。寬限期為 0 表示立刻收掉。
fn stop(running: Running, grace: Duration) {
    drop(running.stdin);
    let mut child = running.child;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if started.elapsed() >= grace => {
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
        }
    }
}
