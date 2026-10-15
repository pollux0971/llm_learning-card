//! asset handler:協定解碼恰好一次,然後交給跟 read 同一份白名單與 symlink 檢查(`learning_fs::guard`)。
//! 內建 `asset:` 不服務 learning/——handler 一律拒絕、不開檔。
//!
//! 回應(T2c-1 驗收 E14、ADR-069):
//!   - 圖片是位元組:`fs::read`,不轉成文字;`Content-Type` 依副檔名;
//!   - 每個回應都帶 `X-Content-Type-Options: nosniff`;`.svg` 另帶 `Content-Security-Policy: script-src 'none'`;
//!   - 拒絕 → 403,照限流往 `<learning 根>/state/log.jsonl` 寫 warning;
//!   - 路徑合法但讀不到(不存在、是目錄)→ 404,其他 io 錯誤 → 500;io 錯誤不寫 warning;
//!   - learning 根沒設好(啟動狀態不是 ok,T2c-2 驗收 3)→ 403(`refuse_response`),不解碼、不開檔、不寫 warning。
//!
//! 「scope 只在 learning 根」與「跟 read 同一份檢查」不由 app 自己回報(T2c-2 驗收 8 刪掉了兩個自我回報函式),
//! 由真的請求證明:`tests/asset_protocol.rs` 與 phase-2 的 cucumber 經 probe 的 `asset` op 送 symlink 與編碼過的路徑。

use std::fs;
use std::io;
use std::path::Path;
use std::time::SystemTime;

use http::header::{CONTENT_SECURITY_POLICY, CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS};
use http::{Response, StatusCode};
use percent_encoding::percent_decode_str;

use crate::event_log::{self, AssetRefusalLimiter};
use crate::learning_fs::{self, FsCall};
use crate::path_guard::Refusal;

pub const SCHEME: &str = "lc";

/// 請求 path 進白名單之前,只拿掉一個開頭的 `/`。
/// 去完還以 `/` 開頭(例如 `//x`)就原樣交給白名單拒絕,不能先收成 `x`。
pub fn asset_rel_from_url_path(url_path: &str) -> &str {
    url_path.strip_prefix('/').unwrap_or(url_path)
}

/// 恰好一次,且必須是合法 UTF-8。失敗只拒絕,不把壞位元組換成 U+FFFD。
/// `percent_decode` 不會把解完的 `%` 再解一次。
pub fn decode_once(raw: &str) -> Result<String, Refusal> {
    percent_decode_str(raw)
        .decode_utf8()
        .map(|s| s.into_owned())
        .map_err(|_| Refusal::new("decode"))
}

/// `lc` 協定的一個回應。`checked` 是解碼後被檢查、被使用的字串(解碼失敗時是原字串);
/// 被拒絕時 `fs_calls` 是空的、`refusal` 有值。
#[derive(Debug)]
pub struct AssetReply {
    pub response: Response<Vec<u8>>,
    pub checked: String,
    pub fs_calls: Vec<FsCall>,
    pub refusal: Option<Refusal>,
}

/// main.rs 的 lc handler 與 probe 的 asset op 都走這裡。`root` 是 `commands::LearningRoot::dir` 給的那一份;
/// 根沒設好時兩邊都不呼叫這裡,直接回 `refuse_response()`。`encoded_rel` 是 URL path 拿掉一個 `/`、還沒解碼的字串。
pub fn respond(root: &Path, encoded_rel: &str, limiter: &mut AssetRefusalLimiter, now: SystemTime) -> AssetReply {
    let checked = match decode_once(encoded_rel) {
        Ok(decoded) => decoded,
        Err(refusal) => return refused(root, encoded_rel.to_string(), refusal, limiter, now),
    };
    let full = match learning_fs::guard(root, &checked) {
        Ok(full) => full,
        Err(refusal) => return refused(root, checked, refusal, limiter, now),
    };
    let fs_calls = vec![FsCall {
        op: "asset".into(),
        path: checked.clone(),
    }];
    let response = match fs::read(&full) {
        Ok(bytes) => served(&checked, bytes),
        Err(err) => plain(status_for_io(&err), "unavailable"),
    };
    AssetReply {
        response,
        checked,
        fs_calls,
        refusal: None,
    }
}

/// 403,並照限流寫 warning(`path` 是被檢查的那個字串)。
fn refused(
    root: &Path,
    checked: String,
    refusal: Refusal,
    limiter: &mut AssetRefusalLimiter,
    now: SystemTime,
) -> AssetReply {
    if let Some(line) = limiter.on_refusal(now, refusal.reason, &checked) {
        record_in_root(root, &line);
    }
    AssetReply {
        response: refuse_response(),
        checked,
        fs_calls: Vec::new(),
        refusal: Some(refusal),
    }
}

/// 程式正常結束時把限流器還沒寫出的次數補寫進 log。
pub fn flush_refusals(root: &Path, limiter: &mut AssetRefusalLimiter, now: SystemTime) {
    for line in limiter.flush(now) {
        record_in_root(root, &line);
    }
}

/// log 只寫進 canonicalize 得了的根底下。
fn record_in_root(root: &Path, line: &serde_json::Value) {
    match root.canonicalize() {
        Ok(root) => event_log::record(&root, line),
        Err(err) => log::error!("refused asset; no learning root for the log: {err}"),
    }
}

fn status_for_io(err: &io::Error) -> StatusCode {
    match err.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::IsADirectory | io::ErrorKind::NotADirectory => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// 副檔名(最後一段的最後一個 `.` 之後,不分大小寫)→ `Content-Type`。認不得的一律 `application/octet-stream`。
pub fn content_type_for(rel: &str) -> &'static str {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let ext = name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase());
    match ext.as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn served(checked: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    let content_type = content_type_for(checked);
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, content_type)
        .header(X_CONTENT_TYPE_OPTIONS, "nosniff");
    if content_type == "image/svg+xml" {
        // SVG 可以帶 script;用 `<img>` 載入時瀏覽器本來就不跑,直接在視窗開時靠這一行擋。
        builder = builder.header(CONTENT_SECURITY_POLICY, "script-src 'none'");
    }
    builder.body(bytes).unwrap_or_else(|_| fallback(StatusCode::INTERNAL_SERVER_ERROR))
}

fn plain(status: StatusCode, text: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain")
        .header(X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(text.as_bytes().to_vec())
        .unwrap_or_else(|_| fallback(status))
}

/// 403。learning 根沒設好、或內建 `asset:` 被呼叫時也回這個。
pub fn refuse_response() -> Response<Vec<u8>> {
    plain(StatusCode::FORBIDDEN, "refused")
}

/// builder 只會在 header 值不合法時失敗(這裡的值都是常數);保險起見仍然帶 nosniff。
fn fallback(status: StatusCode) -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(X_CONTENT_TYPE_OPTIONS, http::HeaderValue::from_static("nosniff"));
    response
}

/// 內建 `asset:` 被呼叫時的紀錄:不開檔,只有 Rust log 的一行。
#[derive(Debug)]
pub struct AssetOutcome {
    pub fs_calls: Vec<FsCall>,
    pub rust_log: Vec<String>,
}

/// 內建 asset: 不讀檔。註冊這個 handler 是為了在 feature 被打開時蓋過內建實作。
pub fn reject_builtin() -> AssetOutcome {
    AssetOutcome {
        fs_calls: Vec::new(),
        rust_log: vec!["refused builtin asset: protocol".into()],
    }
}
