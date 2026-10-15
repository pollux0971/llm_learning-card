//! 真的 Tauri command(T2c-1 驗收 A1–A2、B5–B6、C10、D11;測試 agent 寫的,實作者不要改)。
//!
//! 經過 Tauri 的 IPC(`tauri::test` 的 mock runtime)呼叫,不經 probe、不經 webview:
//! 參數名(`relPath`、`relDir`、`content`)、錯誤的 JSON 形狀、`State` 的注入,都跟 webview 真的 invoke 一樣。
//!
//! 介面:
//!   - `commands::LearningRoot::new(learning_root::Resolved)`:Tauri managed state。T2c-2 起根目錄只有一個來源(指標檔),
//!     所以這裡的 harness 也一樣:在暫存目錄寫指標檔與 `config/vault-id`,用 `learning_root::resolve_at` 解析,再交給 `LearningRoot::new`。
//!     四個 command 吃的是這一份,不自己讀環境、不自己讀指標檔。
//!   - `commands::handler::<R>()`:回傳 `generate_handler![read, write, list, exists]`;main.rs 用同一個。
//!   - command 的回傳:read → string、write → null、list → string[]、exists → bool;
//!     錯誤 → `{"kind":"refused","reason":...}` 或 `{"kind":"io","code":...}`(io 可以另帶 errno 等欄位)。

#![cfg(unix)]

mod common;

use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::Path;

use common::{assert_warning_line, is_root_user, Learning};
use learning_cards_desktop::commands::{self, LearningRoot};
use learning_cards_desktop::learning_root;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};

struct Harness {
    _app: App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
    pointer_dir: std::path::PathBuf,
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.pointer_dir);
    }
}

const POINTER_ID: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

fn fresh_pointer_dir() -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("lc-cmd-pointer-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    fs::create_dir_all(dir.join("llm-learning-cards")).unwrap();
    dir
}

/// 唯一的給根方式:暫存指標檔 + 根裡的 `config/vault-id`。
fn harness(root: &Path) -> Harness {
    let pointer_dir = fresh_pointer_dir();
    let pointer_file = pointer_dir.join("llm-learning-cards").join("vault.json");
    fs::write(&pointer_file, json!({ "learning_dir": root, "vault_id": POINTER_ID }).to_string()).unwrap();
    fs::create_dir_all(root.join("config")).unwrap();
    fs::write(root.join("config/vault-id"), format!("{POINTER_ID}\n")).unwrap();
    let resolved = learning_root::resolve_at(&pointer_file);
    assert_eq!(resolved.state.reason(), "ok", "the harness root must resolve");
    harness_with(resolved, pointer_dir)
}

fn harness_with(resolved: learning_root::Resolved, pointer_dir: std::path::PathBuf) -> Harness {
    let app = mock_builder()
        .manage(LearningRoot::new(resolved))
        .invoke_handler(commands::handler())
        .build(mock_context(noop_assets()))
        .expect("build the mock app");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build the mock webview");
    Harness { _app: app, webview, pointer_dir }
}

impl Harness {
    fn call(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        get_ipc_response(
            &self.webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|body| body.deserialize::<Value>().expect("response is JSON"))
    }

    fn read(&self, rel: &str) -> Result<Value, Value> {
        self.call("read", json!({ "relPath": rel }))
    }

    fn write(&self, rel: &str, content: &str) -> Result<Value, Value> {
        self.call("write", json!({ "relPath": rel, "content": content }))
    }

    fn exists(&self, rel: &str) -> Result<Value, Value> {
        self.call("exists", json!({ "relPath": rel }))
    }

    fn list(&self, rel: &str) -> Result<Value, Value> {
        self.call("list", json!({ "relDir": rel }))
    }
}

fn refused(result: Result<Value, Value>, what: &str) -> String {
    let err = match result {
        Ok(v) => panic!("{what}: expected a refusal, got Ok({v})"),
        Err(e) => e,
    };
    assert_eq!(err["kind"], "refused", "{what}: {err}");
    err["reason"].as_str().unwrap_or_else(|| panic!("{what}: no reason in {err}")).to_string()
}

fn io_error(result: Result<Value, Value>, what: &str) -> String {
    let err = match result {
        Ok(v) => panic!("{what}: expected an io error, got Ok({v})"),
        Err(e) => e,
    };
    assert_eq!(err["kind"], "io", "{what}: {err}");
    err["code"].as_str().unwrap_or_else(|| panic!("{what}: no code in {err}")).to_string()
}

// ---------------------------------------------------------------- A2:直接呼叫 command 的拒絕

#[test]
fn read_raw_is_refused_and_the_file_is_not_returned() {
    let l = Learning::new("cmd-read-raw");
    l.plant("raw/security/x.md", b"SECRET");
    let h = harness(&l.root);
    let result = h.read("raw/security/x.md");
    if let Ok(v) = &result {
        assert_ne!(v, "SECRET", "read went around the guard");
    }
    assert_eq!(refused(result, "read raw"), "raw");
    let lines = l.log_lines();
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_warning_line(&lines[0], "raw/security/x.md");
}

#[test]
fn write_raw_is_refused_and_nothing_is_created() {
    let l = Learning::new("cmd-write-raw");
    let h = harness(&l.root);
    assert_eq!(refused(h.write("raw/security/x.md", "x"), "write raw"), "raw");
    assert!(!l.root.join("raw/security/x.md").exists(), "write went around the guard");
    assert_eq!(l.log_lines().len(), 1);
}

#[test]
fn read_traversal_is_refused_as_structure() {
    let l = Learning::new("cmd-read-dotdot");
    let h = harness(&l.root);
    assert_eq!(refused(h.read("../../etc/passwd"), "read ../../etc/passwd"), "structure");
    assert_eq!(l.log_lines().len(), 1);
}

#[test]
fn write_escape_is_refused_and_nothing_appears_above_the_root() {
    let l = Learning::new("cmd-write-escape");
    let h = harness(&l.root);
    assert_eq!(refused(h.write("cards/../../escape.md", "x"), "write escape"), "structure");
    assert!(!l.parent.path().join("escape.md").exists(), "write escaped the learning directory");
    assert!(!l.root.join("escape.md").exists());
}

#[test]
fn exists_raw_is_refused_not_false() {
    let l = Learning::new("cmd-exists-raw");
    l.plant("raw/security/x.md", b"SECRET");
    let h = harness(&l.root);
    assert_eq!(refused(h.exists("raw/security/x.md"), "exists raw"), "raw");
    assert_eq!(l.log_lines().len(), 1);
}

#[test]
fn list_raw_is_refused() {
    let l = Learning::new("cmd-list-raw");
    l.plant("raw/security/x.md", b"SECRET");
    let h = harness(&l.root);
    assert_eq!(refused(h.list("raw"), "list raw"), "raw");
    assert_eq!(l.log_lines().len(), 1);
}

#[test]
fn write_to_a_dangling_symlink_is_refused_and_creates_nothing_outside() {
    let l = Learning::new("cmd-dangling");
    fs::create_dir_all(l.root.join("cards")).unwrap();
    let target = l.outside.join("new");
    symlink(&target, l.root.join("cards/evil.md")).unwrap();
    let h = harness(&l.root);
    assert_eq!(refused(h.write("cards/evil.md", "x"), "write dangling"), "symlink");
    assert!(!target.exists(), "the outside target was created");
}

#[test]
fn command_refusals_are_never_rate_limited() {
    let l = Learning::new("cmd-three");
    let h = harness(&l.root);
    for _ in 0..3 {
        refused(h.read("raw/x.md"), "read raw/x.md");
    }
    let lines = l.log_lines();
    assert_eq!(lines.len(), 3, "{lines:?}");
    for line in &lines {
        let v = assert_warning_line(line, "raw/x.md");
        assert!(v.get("count").is_none(), "command refusals carry no count: {line}");
    }
}

// ---------------------------------------------------------------- 成功的路徑(同一個 command,不寫 log)

#[test]
fn allowed_calls_work_and_write_no_line() {
    let l = Learning::new("cmd-ok");
    l.plant("cards/a.md", "第一張".as_bytes());
    let h = harness(&l.root);
    assert_eq!(h.read("cards/a.md").expect("read"), json!("第一張"));
    assert_eq!(h.write("cards/b.md", "new").expect("write"), Value::Null);
    assert_eq!(fs::read_to_string(l.root.join("cards/b.md")).unwrap(), "new");
    assert_eq!(h.exists("cards/b.md").expect("exists"), json!(true));
    assert_eq!(h.list("cards").expect("list"), json!(["a.md", "b.md"]));
    assert_eq!(l.log_text(), "");
}

#[test]
fn the_relpath_reaches_the_file_system_byte_for_byte() {
    let l = Learning::new("cmd-bytes");
    let rel = "cards/\u{30BB}\u{30AD}\u{30E5}\u{30EA}\u{30C6}\u{30A3}\u{30FC}.md";
    l.plant(rel, b"katakana");
    let h = harness(&l.root);
    assert_eq!(h.read(rel).expect("read"), json!("katakana"));
}

// ---------------------------------------------------------------- B6:warning 行的內容

#[test]
fn a_nul_in_the_path_is_one_escaped_line() {
    let l = Learning::new("cmd-nul");
    let rel = "cards/a.md\u{0}.png";
    let h = harness(&l.root);
    refused(h.read(rel), "read with NUL");
    let text = l.log_text();
    assert!(text.contains("\\u0000"), "{text:?}");
    let lines = l.log_lines();
    assert_eq!(lines.len(), 1);
    assert_warning_line(&lines[0], rel);
}

#[test]
fn a_missing_file_writes_no_line() {
    let l = Learning::new("cmd-missing-nolog");
    let h = harness(&l.root);
    let _ = h.read("cards/missing.md");
    assert_eq!(l.log_text(), "", "an io error is not a refusal");
}

// ---------------------------------------------------------------- D11:io 錯誤跟拒絕分得出來

#[test]
fn read_missing_is_io_not_found() {
    let l = Learning::new("cmd-io-missing");
    let h = harness(&l.root);
    assert_eq!(io_error(h.read("cards/missing.md"), "read missing"), "not_found");
    assert_eq!(l.log_text(), "");
}

#[test]
fn read_a_directory_is_io_is_dir() {
    let l = Learning::new("cmd-io-dir");
    fs::create_dir_all(l.root.join("cards")).unwrap();
    let h = harness(&l.root);
    assert_eq!(io_error(h.read("cards"), "read a directory"), "is_dir");
    assert_eq!(l.log_text(), "");
}

#[test]
fn read_an_unreadable_file_is_io_permission() {
    if is_root_user() {
        eprintln!("SKIPPED read_an_unreadable_file_is_io_permission: running as root");
        return;
    }
    let l = Learning::new("cmd-io-perm");
    let full = l.plant("cards/locked.md", b"secret");
    fs::set_permissions(&full, fs::Permissions::from_mode(0o000)).unwrap();
    let h = harness(&l.root);
    assert_eq!(io_error(h.read("cards/locked.md"), "read mode 000"), "permission");
    assert_eq!(l.log_text(), "");
}

#[test]
fn read_invalid_utf8_is_io_not_utf8() {
    let l = Learning::new("cmd-io-utf8");
    l.plant("cards/bad.md", &[0xFF, 0xFE, 0x00]);
    let h = harness(&l.root);
    assert_eq!(io_error(h.read("cards/bad.md"), "read FF FE 00"), "not_utf8");
    assert_eq!(l.log_text(), "");
}

#[test]
fn exists_on_a_missing_legal_path_is_false() {
    let l = Learning::new("cmd-exists-missing");
    let h = harness(&l.root);
    assert_eq!(h.exists("cards/missing.md").expect("not an error"), json!(false));
    assert_eq!(l.log_text(), "");
}

#[test]
fn list_of_a_missing_directory_is_io_not_found() {
    let l = Learning::new("cmd-list-missing");
    let h = harness(&l.root);
    assert_eq!(io_error(h.list("cards/nope"), "list missing"), "not_found");
    assert_eq!(l.log_text(), "");
}

#[test]
fn list_skips_an_entry_whose_metadata_cannot_be_read() {
    let l = Learning::new("cmd-list-skip");
    l.plant("cards/ok.md", b"yes");
    symlink(l.parent.path().join("nowhere"), l.root.join("cards/ghost.md")).unwrap();
    let h = harness(&l.root);
    assert_eq!(h.list("cards").expect("one bad entry must not fail the list"), json!(["ok.md"]));
}

#[test]
fn a_refusal_and_an_io_error_have_different_kinds() {
    let l = Learning::new("cmd-kinds");
    let h = harness(&l.root);
    let refusal = h.read("raw/x.md").expect_err("raw");
    let io = h.read("cards/missing.md").expect_err("missing");
    assert_eq!(refusal["kind"], "refused");
    assert_eq!(io["kind"], "io");
}

// ---------------------------------------------------------------- C10:write command 對所有路徑都走原子寫入

#[test]
fn write_command_goes_through_the_atomic_write_everywhere() {
    for rel in ["state/reviews.json", "cards/a.md", "questions/a.yaml"] {
        let l = Learning::new("cmd-atomic");
        let stale = l.plant(&format!("{rel}.tmp"), b"stale");
        let h = harness(&l.root);
        h.write(rel, "NEW").unwrap_or_else(|e| panic!("{rel}: {e}"));
        assert_eq!(fs::read_to_string(l.root.join(rel)).unwrap(), "NEW");
        assert!(!stale.exists(), "{rel}: the stale <name>.tmp survived, so this was not tmp + rename");
    }
}

// ---------------------------------------------------------------- A1:同一個 handler,main.rs 也用它

#[test]
fn main_rs_registers_the_same_handler() {
    let main = include_str!("../src/main.rs");
    assert!(main.contains(".invoke_handler("), "main.rs registers no invoke_handler");
    assert!(main.contains("commands::handler"), "main.rs must register commands::handler(), the one these tests call");
    assert!(main.contains("LearningRoot"), "main.rs must manage the LearningRoot state the commands read");
}

// ---------------------------------------------------------------- T2c-2 驗收 3:四種失敗狀態下 command 回「未設定」

fn failed_state_harness(which: &str) -> (Harness, std::path::PathBuf) {
    let pointer_dir = fresh_pointer_dir();
    let pointer_file = pointer_dir.join("llm-learning-cards").join("vault.json");
    let learning = pointer_dir.join("learning");
    fs::create_dir_all(learning.join("config")).unwrap();
    fs::write(learning.join("config/vault-id"), format!("{POINTER_ID}\n")).unwrap();
    match which {
        "pointer-missing" => {}
        "pointer-unreadable" => fs::write(&pointer_file, "{").unwrap(),
        "learning-dir-missing" => fs::write(&pointer_file, json!({ "learning_dir": pointer_dir.join("nowhere"), "vault_id": POINTER_ID }).to_string()).unwrap(),
        "marker-mismatch" => {
            fs::write(&pointer_file, json!({ "learning_dir": learning, "vault_id": "11111111-2222-4333-8444-555555555555" }).to_string()).unwrap()
        }
        other => panic!("unknown state {other}"),
    }
    let resolved = learning_root::resolve_at(&pointer_file);
    assert_eq!(resolved.state.reason(), which);
    (harness_with(resolved, pointer_dir), learning)
}

#[test]
fn in_every_failed_start_state_all_four_commands_say_not_configured() {
    for which in ["pointer-missing", "pointer-unreadable", "learning-dir-missing", "marker-mismatch"] {
        let (h, learning) = failed_state_harness(which);
        let results = [
            ("read", h.read("cards/c.md")),
            ("write", h.write("cards/c.md", "x")),
            ("list", h.list("cards")),
            ("exists", h.exists("cards/c.md")),
        ];
        for (name, result) in results {
            let err = result.expect_err(&format!("{which}/{name}: must fail"));
            assert_eq!(err["kind"], "not-configured", "{which}/{name}: neither a refusal nor an io error: {err}");
        }
        assert!(!learning.join("cards").exists(), "{which}: a failed state must not create anything");
        assert!(!learning.join("state").exists(), "{which}: no warning line, no state directory");
    }
}

#[test]
fn not_configured_is_not_a_refusal_and_writes_no_warning_even_for_a_raw_path() {
    // raw/ 在 ok 的根會被拒絕並寫 warning;根沒設好的時候是「未設定」,不是拒絕,也不寫。
    let (h, learning) = failed_state_harness("marker-mismatch");
    let err = h.read("raw/x.md").expect_err("must fail");
    assert_eq!(err["kind"], "not-configured", "{err}");
    assert!(!learning.join("state").exists(), "no warning, so no state directory");
}
