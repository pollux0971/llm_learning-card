//! cucumber 用的無頭入口。跟 Tauri command、lc protocol 呼叫同一份 library。
//! 一行 JSON 進來,一行 JSON 出去。不開視窗。
//!
//! JSON 介面寫在 `apps/desktop/src/test-support/probe.ts` 的檔頭(測試 agent 定的):
//!   - `read` / `write` / `list` / `exists`:跟 command 同一個 `learning_fs` 函式;`error` 是 command 回給
//!     webview 的同一個錯誤 JSON(成功是 null)。
//!   - `asset`:`asset_protocol::respond`;另回 `status`、`headers`(名字小寫)、`bodyHex`、`checked`、`fsCalls`。
//!   - `asset-sequence`:同一個限流器依序處理 `requests`(時鐘 = 固定起點 + `at` 秒),`endAt` 不是 null 就在那一秒 flush。
//!   - `segment`:`path_guard::check_segment`。
//!   - `status` / `builtin-asset`:T2b,不變。

use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use learning_cards_desktop::asset_protocol::{self, AssetReply};
use learning_cards_desktop::event_log::AssetRefusalLimiter;
use learning_cards_desktop::learning_fs::{self, FsCall, FsError};
use learning_cards_desktop::path_guard::{self, Refusal};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// asset-sequence 的時鐘起點(秒)。只要固定就好;限流只看相對的秒數。
const SEQUENCE_EPOCH_SECS: u64 = 1_760_000_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Req {
    op: String,
    root: Option<String>,
    path: Option<String>,
    content: Option<String>,
    #[serde(default)]
    requests: Vec<SequenceRequest>,
    end_at: Option<u64>,
}

#[derive(Deserialize)]
struct SequenceRequest {
    at: u64,
    path: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Resp {
    ok: bool,
    refused: bool,
    error: Option<Value>,
    value: Value,
    fs_calls: Vec<FsCall>,
    rust_log: Vec<String>,
    checked: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    headers: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    responses: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scheme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    custom_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scope_is_learning_root: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    same_checks_as_read: Option<bool>,
}

fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).expect("stdin");
    let req: Req = serde_json::from_str(&raw).unwrap_or(Req {
        op: "bad".into(),
        root: None,
        path: None,
        content: None,
        requests: Vec::new(),
        end_at: None,
    });
    let resp = dispatch(req);
    let out = serde_json::to_string(&resp).unwrap();
    let mut stdout = io::stdout().lock();
    let _ = writeln!(stdout, "{out}");
}

fn dispatch(req: Req) -> Resp {
    match req.op.as_str() {
        "status" => Resp {
            ok: true,
            scheme: Some(asset_protocol::SCHEME.into()),
            custom_enabled: Some(true),
            scope_is_learning_root: Some(asset_protocol::scope_is_learning_root()),
            same_checks_as_read: Some(asset_protocol::same_checks_as_read()),
            ..Resp::default()
        },
        "builtin-asset" => {
            let rejected = asset_protocol::reject_builtin();
            Resp {
                refused: true,
                fs_calls: rejected.fs_calls,
                rust_log: rejected.rust_log,
                ..Resp::default()
            }
        }
        "asset" => asset(req),
        "asset-sequence" => asset_sequence(req),
        "segment" => segment(req),
        _ => command(req),
    }
}

fn root_of(req: &Req) -> PathBuf {
    PathBuf::from(req.root.clone().unwrap_or_default())
}

fn wire<E: Serialize>(err: &E) -> Value {
    serde_json::to_value(err).unwrap_or(Value::Null)
}

fn asset(req: Req) -> Resp {
    let root = root_of(&req);
    let path = req.path.unwrap_or_default();
    let mut limiter = AssetRefusalLimiter::new();
    let reply = asset_protocol::respond(&root, &path, &mut limiter, SystemTime::now());
    // 一次一個行程:第一次拒絕一定寫出,不會有沒寫出的次數;照 main.rs 一樣在結束時 flush。
    asset_protocol::flush_refusals(&root, &mut limiter, SystemTime::now());
    asset_resp(reply)
}

fn asset_resp(reply: AssetReply) -> Resp {
    let status = reply.response.status();
    let headers = reply
        .response
        .headers()
        .iter()
        .map(|(name, value)| (name.as_str().to_string(), value.to_str().unwrap_or("").to_string()))
        .collect();
    Resp {
        ok: status == http::StatusCode::OK,
        refused: reply.refusal.is_some(),
        error: reply.refusal.as_ref().map(wire),
        value: Value::Null,
        fs_calls: reply.fs_calls,
        checked: Some(reply.checked),
        status: Some(status.as_u16()),
        headers: Some(headers),
        body_hex: Some(hex(reply.response.body())),
        ..Resp::default()
    }
}

fn asset_sequence(req: Req) -> Resp {
    let root = root_of(&req);
    let at = |secs: u64| UNIX_EPOCH + Duration::from_secs(SEQUENCE_EPOCH_SECS + secs);
    let mut limiter = AssetRefusalLimiter::new();
    let responses = req
        .requests
        .iter()
        .map(|r| {
            let reply = asset_protocol::respond(&root, &r.path, &mut limiter, at(r.at));
            json!({ "status": reply.response.status().as_u16() })
        })
        .collect();
    if let Some(end) = req.end_at {
        asset_protocol::flush_refusals(&root, &mut limiter, at(end));
    }
    Resp {
        ok: true,
        responses: Some(responses),
        ..Resp::default()
    }
}

fn segment(req: Req) -> Resp {
    let seg = req.path.unwrap_or_default();
    match path_guard::check_segment(&seg) {
        Ok(()) => Resp {
            ok: true,
            checked: Some(seg),
            ..Resp::default()
        },
        Err(refusal) => Resp {
            refused: true,
            error: Some(wire(&refusal)),
            checked: Some(seg),
            ..Resp::default()
        },
    }
}

fn command(req: Req) -> Resp {
    let root = root_of(&req);
    let path = req.path.clone().unwrap_or_default();
    let result = match req.op.as_str() {
        "read" => learning_fs::read(&root, &path),
        "write" => learning_fs::write(&root, &path, req.content.as_deref().unwrap_or("")),
        "list" => learning_fs::list(&root, &path),
        "exists" => learning_fs::exists(&root, &path),
        _ => Err(FsError::Refused(Refusal::new("op"))),
    };
    match result {
        Ok(out) => Resp {
            ok: true,
            value: out.value,
            fs_calls: out.fs_calls,
            ..Resp::default()
        },
        Err(err) => Resp {
            refused: err.refusal().is_some(),
            error: Some(wire(&err)),
            ..Resp::default()
        },
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
