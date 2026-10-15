//! cucumber 與 vitest 用的無頭入口。跟 Tauri command、lc protocol 呼叫同一份 library。
//! 一行 JSON 進來,一行 JSON 出去。不開視窗。
//!
//! JSON 介面寫在 `apps/desktop/src/test-support/probe.ts` 的檔頭(測試 agent 定的):
//!   - learning 根只有一個來源(T2c-2):probe 從自己的環境(`XDG_CONFIG_HOME`、`HOME`)找使用者層指標檔,
//!     用 `learning_root::resolve` 解析一次,交給 `commands::LearningRoot`——跟 main.rs 的 Tauri state 同一個型別、
//!     同一個 `dir()`。請求裡有 `root` 欄位就是壞請求(不開第二條給根目錄的路)。
//!   - `read` / `write` / `list` / `exists`:跟 command 同一個 `learning_fs` 函式;`error` 是 command 回給
//!     webview 的同一個錯誤 JSON(成功是 null)。根沒設好時是 `{"kind":"not-configured"}`。
//!   - `asset`:跟 main.rs 的 lc handler 一樣——根設好了走 `asset_protocol::respond`,沒設好回 `refuse_response()`(403,
//!     不開檔、不寫 warning);另回 `status`、`headers`(名字小寫)、`bodyHex`、`checked`、`fsCalls`。
//!   - `asset-sequence`:同一個限流器依序處理 `requests`(時鐘 = 固定起點 + `at` 秒),`endAt` 不是 null 就在那一秒 flush。
//!   - `startup`:啟動狀態、根、指標檔路徑、畫面文字、要開的視窗(`start_screen`,跟 main.rs 同一份)。什麼都不寫。
//!   - `session`:解析一次之後,`read` 與 `asset` 依序吃同一份結果。
//!   - `pointer-path` / `marker-compare` / `pointer-parse`:`learning_root` 的三個純函式,不讀環境。
//!   - `segment`:`path_guard::check_segment`。
//!   - `status`:只回 scheme。`builtin-asset`:T2b,不變。

use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use learning_cards_desktop::asset_protocol::{self, AssetReply};
use learning_cards_desktop::commands::LearningRoot;
use learning_cards_desktop::event_log::AssetRefusalLimiter;
use learning_cards_desktop::learning_fs::{self, FsCall, FsError};
use learning_cards_desktop::learning_root;
use learning_cards_desktop::path_guard::{self, Refusal};
use learning_cards_desktop::start_screen;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// asset-sequence 的時鐘起點(秒)。只要固定就好;限流只看相對的秒數。
const SEQUENCE_EPOCH_SECS: u64 = 1_760_000_000;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Req {
    op: String,
    path: Option<String>,
    content: Option<String>,
    #[serde(default)]
    requests: Vec<SequenceRequest>,
    end_at: Option<u64>,
    xdg: Option<String>,
    home: Option<String>,
    marker_text: Option<String>,
    vault_id: Option<String>,
    raw: Option<String>,
}

/// `asset-sequence` 用 `at`;`session` 用 `kind`(`read` 或 `asset`)。
#[derive(Deserialize)]
struct SequenceRequest {
    #[serde(default)]
    at: u64,
    kind: Option<String>,
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
}

fn main() {
    learning_cards_desktop::init_logging();
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).expect("stdin");
    let out = serde_json::to_string(&handle(&raw)).unwrap();
    let mut stdout = io::stdout().lock();
    let _ = writeln!(stdout, "{out}");
}

fn handle(raw: &str) -> Value {
    let parsed: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
    if parsed.get("root").is_some() {
        return to_value(bad_request("root"));
    }
    let req: Req = serde_json::from_value(parsed).unwrap_or_else(|_| Req {
        op: "bad".into(),
        ..Req::default()
    });
    dispatch(req)
}

fn to_value(resp: Resp) -> Value {
    serde_json::to_value(resp).unwrap_or(Value::Null)
}

fn bad_request(field: &str) -> Resp {
    Resp {
        error: Some(json!({ "kind": "bad-request", "field": field })),
        ..Resp::default()
    }
}

fn dispatch(req: Req) -> Value {
    match req.op.as_str() {
        "status" => to_value(Resp {
            ok: true,
            scheme: Some(asset_protocol::SCHEME.into()),
            ..Resp::default()
        }),
        "builtin-asset" => {
            let rejected = asset_protocol::reject_builtin();
            to_value(Resp {
                refused: true,
                fs_calls: rejected.fs_calls,
                rust_log: rejected.rust_log,
                ..Resp::default()
            })
        }
        "segment" => to_value(segment(req)),
        "pointer-path" => pointer_path(&req),
        "marker-compare" => marker_compare(&req),
        "pointer-parse" => pointer_parse(&req),
        "startup" => startup(&resolve_once()),
        "session" => session(&resolve_once(), &req.requests),
        "asset" => to_value(asset(&resolve_once(), &req)),
        "asset-sequence" => to_value(asset_sequence(&resolve_once(), &req)),
        "read" | "write" | "list" | "exists" => to_value(command(&resolve_once(), &req)),
        _ => to_value(error_resp(FsError::Refused(Refusal::new("op")))),
    }
}

/// 跟 main.rs 一樣:從行程環境找指標檔,解析一次。
fn resolve_once() -> LearningRoot {
    let (xdg_config_home, home) = learning_cards_desktop::pointer_env();
    LearningRoot::new(learning_root::resolve(xdg_config_home.as_deref(), &home))
}

fn wire<E: Serialize>(err: &E) -> Value {
    serde_json::to_value(err).unwrap_or(Value::Null)
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// 跟 main.rs 的 lc handler 同一個分支:根設好了 `respond`,沒設好 403。
fn lc_request(state: &LearningRoot, encoded_rel: &str, limiter: &mut AssetRefusalLimiter, now: SystemTime) -> AssetReply {
    match state.dir() {
        Ok(root) => asset_protocol::respond(root, encoded_rel, limiter, now),
        Err(_) => AssetReply {
            response: asset_protocol::refuse_response(),
            checked: encoded_rel.to_string(),
            fs_calls: Vec::new(),
            refusal: None,
        },
    }
}

fn root_text(state: &LearningRoot) -> Value {
    state.dir().map(|root| Value::String(path_text(root))).unwrap_or(Value::Null)
}

// ---------------------------------------------------------------- learning 根(T2c-2)

fn startup(state: &LearningRoot) -> Value {
    let resolved = state.resolved();
    json!({
        "ok": true,
        "state": resolved.state.reason(),
        "root": root_text(state),
        "pointerPath": path_text(&resolved.pointer_path),
        "view": { "text": start_screen::text(resolved) },
        "windows": start_screen::windows(resolved.state),
    })
}

fn session(state: &LearningRoot, requests: &[SequenceRequest]) -> Value {
    let mut limiter = AssetRefusalLimiter::new();
    let results: Vec<Value> = requests
        .iter()
        .map(|r| match r.kind.as_deref() {
            Some("read") => match state.dir().and_then(|root| learning_fs::read(root, &r.path)) {
                Ok(out) => json!({ "kind": "read", "ok": true, "valueText": out.value, "fsCalls": out.fs_calls }),
                Err(err) => json!({ "kind": "read", "ok": false, "error": wire(&err), "fsCalls": [] }),
            },
            Some("asset") => {
                let reply = lc_request(state, &r.path, &mut limiter, SystemTime::now());
                let status = reply.response.status();
                json!({
                    "kind": "asset",
                    "ok": status == http::StatusCode::OK,
                    "status": status.as_u16(),
                    "bodyHex": hex(reply.response.body()),
                    "fsCalls": reply.fs_calls,
                })
            }
            other => json!({
                "kind": other,
                "ok": false,
                "error": { "kind": "bad-request", "field": "kind" },
                "fsCalls": [],
            }),
        })
        .collect();
    if let Ok(root) = state.dir() {
        asset_protocol::flush_refusals(root, &mut limiter, SystemTime::now());
    }
    json!({
        "ok": true,
        "state": state.resolved().state.reason(),
        "root": root_text(state),
        "results": results,
    })
}

fn pointer_path(req: &Req) -> Value {
    let home = req.home.as_deref().unwrap_or("");
    let path = learning_root::pointer_path(req.xdg.as_deref(), Path::new(home));
    json!({ "ok": true, "value": path_text(&path) })
}

fn marker_compare(req: &Req) -> Value {
    let equal = learning_root::marker_matches(
        req.marker_text.as_deref().unwrap_or(""),
        req.vault_id.as_deref().unwrap_or(""),
    );
    json!({ "ok": true, "value": if equal { "equal" } else { "not-equal" } })
}

fn pointer_parse(req: &Req) -> Value {
    match learning_root::parse_pointer(req.raw.as_deref().unwrap_or("")) {
        Some(pointer) => json!({
            "ok": true,
            "value": "ok",
            "learningDir": pointer.learning_dir,
            "vaultId": pointer.vault_id,
        }),
        None => json!({ "ok": true, "value": "unreadable" }),
    }
}

// ---------------------------------------------------------------- asset

fn asset(state: &LearningRoot, req: &Req) -> Resp {
    let path = req.path.clone().unwrap_or_default();
    let mut limiter = AssetRefusalLimiter::new();
    let reply = lc_request(state, &path, &mut limiter, SystemTime::now());
    // 一次一個行程:第一次拒絕一定寫出,不會有沒寫出的次數;照 main.rs 一樣在結束時 flush。
    if let Ok(root) = state.dir() {
        asset_protocol::flush_refusals(root, &mut limiter, SystemTime::now());
    }
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

fn asset_sequence(state: &LearningRoot, req: &Req) -> Resp {
    let at = |secs: u64| UNIX_EPOCH + Duration::from_secs(SEQUENCE_EPOCH_SECS + secs);
    let mut limiter = AssetRefusalLimiter::new();
    let responses = req
        .requests
        .iter()
        .map(|r| {
            let reply = lc_request(state, &r.path, &mut limiter, at(r.at));
            json!({ "status": reply.response.status().as_u16() })
        })
        .collect();
    if let (Some(end), Ok(root)) = (req.end_at, state.dir()) {
        asset_protocol::flush_refusals(root, &mut limiter, at(end));
    }
    Resp {
        ok: true,
        responses: Some(responses),
        ..Resp::default()
    }
}

// ---------------------------------------------------------------- segment / command

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

fn command(state: &LearningRoot, req: &Req) -> Resp {
    let path = req.path.clone().unwrap_or_default();
    let result = state.dir().and_then(|root| match req.op.as_str() {
        "read" => learning_fs::read(root, &path),
        "write" => learning_fs::write(root, &path, req.content.as_deref().unwrap_or("")),
        "list" => learning_fs::list(root, &path),
        "exists" => learning_fs::exists(root, &path),
        _ => Err(FsError::Refused(Refusal::new("op"))),
    });
    match result {
        Ok(out) => Resp {
            ok: true,
            value: out.value,
            fs_calls: out.fs_calls,
            ..Resp::default()
        },
        Err(err) => error_resp(err),
    }
}

fn error_resp(err: FsError) -> Resp {
    Resp {
        refused: err.refusal().is_some(),
        error: Some(wire(&err)),
        ..Resp::default()
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
