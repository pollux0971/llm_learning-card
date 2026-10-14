//! cucumber 用的無頭入口。跟 Tauri command 呼叫同一份 library。
//! 一行 JSON 進來,一行 JSON 出去。不開視窗。

use std::io::{self, Read, Write};
use std::path::PathBuf;

use learning_cards_desktop::asset_protocol;
use learning_cards_desktop::learning_fs;
use learning_cards_desktop::path_guard::Refusal;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Req {
    op: String,
    root: Option<String>,
    path: Option<String>,
    content: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Resp {
    ok: bool,
    refused: bool,
    value: serde_json::Value,
    fs_calls: Vec<learning_fs::FsCall>,
    rust_log: Vec<String>,
    checked: Option<String>,
    scheme: Option<String>,
    custom_enabled: Option<bool>,
    scope_is_learning_root: Option<bool>,
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
    });
    let resp = dispatch(req);
    let out = serde_json::to_string(&resp).unwrap();
    let mut stdout = io::stdout().lock();
    let _ = writeln!(stdout, "{out}");
}

fn dispatch(req: Req) -> Resp {
    let op = req.op.clone();
    match op.as_str() {
        "status" => Resp {
            ok: true,
            refused: false,
            value: json!(null),
            fs_calls: Vec::new(),
            rust_log: Vec::new(),
            checked: None,
            scheme: Some(asset_protocol::SCHEME.into()),
            custom_enabled: Some(true),
            scope_is_learning_root: Some(asset_protocol::scope_is_learning_root()),
            same_checks_as_read: Some(asset_protocol::same_checks_as_read()),
        },
        "builtin-asset" => {
            let rejected = asset_protocol::reject_builtin();
            Resp {
                ok: false,
                refused: true,
                value: json!(null),
                fs_calls: rejected.fs_calls,
                rust_log: rejected.rust_log,
                checked: None,
                scheme: None,
                custom_enabled: None,
                scope_is_learning_root: None,
                same_checks_as_read: None,
            }
        }
        "asset" => asset(req),
        other => command(other, req),
    }
}

fn asset(req: Req) -> Resp {
    let root = PathBuf::from(req.root.unwrap_or_default());
    let path = req.path.unwrap_or_default();
    match asset_protocol::handle_custom(&root, &path) {
        Ok(out) => {
            let checked = out.fs_calls.first().map(|c| c.path.clone());
            Resp {
            ok: true,
            refused: false,
            value: out.value,
            fs_calls: out.fs_calls,
            rust_log: Vec::new(),
            checked,
            scheme: None,
            custom_enabled: None,
            scope_is_learning_root: None,
            same_checks_as_read: None,
        }
        }
        Err((_, rejected)) => Resp {
            ok: false,
            refused: true,
            value: json!(null),
            fs_calls: rejected.fs_calls,
            rust_log: rejected.rust_log,
            checked: Some(rejected.checked),
            scheme: None,
            custom_enabled: None,
            scope_is_learning_root: None,
            same_checks_as_read: None,
        },
    }
}

fn command(op: &str, req: Req) -> Resp {
    let root = PathBuf::from(req.root.unwrap_or_default());
    let path = req.path.unwrap_or_default();
    let result = match op {
        "read" => learning_fs::read(&root, &path),
        "write" => learning_fs::write(&root, &path, req.content.as_deref().unwrap_or("")),
        "list" => learning_fs::list(&root, &path),
        "exists" => learning_fs::exists(&root, &path),
        _ => Err(Refusal::new("op")),
    };
    match result {
        Ok(out) => Resp {
            ok: true,
            refused: false,
            value: out.value,
            fs_calls: out.fs_calls,
            rust_log: Vec::new(),
            checked: None,
            scheme: None,
            custom_enabled: None,
            scope_is_learning_root: None,
            same_checks_as_read: None,
        },
        Err(_) => Resp {
            ok: false,
            refused: true,
            value: json!(null),
            fs_calls: Vec::new(),
            rust_log: Vec::new(),
            checked: None,
            scheme: None,
            custom_enabled: None,
            scope_is_learning_root: None,
            same_checks_as_read: None,
        },
    }
}
