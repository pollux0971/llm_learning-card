//! learning 根目錄解析的測試(T2c-2,測試 agent 寫)。
//!
//! 桌面程式的 learning 根只有一個來源:使用者層指標檔 `${XDG_CONFIG_HOME:-~/.config}/llm-learning-cards/vault.json`
//! (契約 §12,T5 定)。這個檔跟 TS 那邊(`packages/core/src/llm/ledger.ts`)共用同一份向量
//! `contracts/fixtures/vault-pointer-vectors.json`(47 列),逐列、不新增、不略過。
//!
//! 這個檔定的是 library 的公開介面(開發 worker 照它實作 `src/learning_root.rs`;改名要先回報協調者):
//!
//! ```text
//! pub struct Pointer { pub learning_dir: String, pub vault_id: String }
//! #[derive(Debug, Clone, Copy, PartialEq, Eq)]
//! pub enum StartState { PointerMissing, PointerUnreadable, LearningDirMissing, MarkerMismatch, Ok }
//! impl StartState { pub fn reason(&self) -> &'static str }          // "pointer-missing" … "ok"
//! pub struct Resolved { pub state: StartState, pub root: Option<PathBuf>, pub pointer_path: PathBuf, pub pointer: Option<Pointer> }
//! pub fn pointer_path(xdg_config_home: Option<&str>, home: &Path) -> PathBuf
//! pub fn marker_matches(marker_text: &str, vault_id: &str) -> bool
//! pub fn parse_pointer(raw: &str) -> Option<Pointer>                // None = unreadable
//! pub fn resolve_at(pointer_path: &Path) -> Resolved                // 讀一次指標檔,再讀一次標記檔,什麼都不寫
//! pub fn resolve(xdg_config_home: Option<&str>, home: &Path) -> Resolved
//! commands::LearningRoot::new(Resolved) -> LearningRoot            // Tauri managed state,四個 command 與 lc 協定共用這一份
//! ```
//!
//! `root` 只有 state 是 Ok 的時候是 Some,而且是 canonical 路徑;其他四種失敗一律 None。
//! 解析**不寫任何檔、不建任何目錄**(包括 `state/`)。
//!
//! 隔離:每個測試一個 mkdtemp 風格的暫存目錄(`std::env::temp_dir()` 底下、行程 id + 計數器),結束時刪掉。
//! 不讀環境變數、不碰真的指標檔:所有輸入都是參數。

#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use learning_cards_desktop::learning_root::{marker_matches, parse_pointer, pointer_path, resolve, resolve_at, StartState};
use serde_json::Value;
use sha2::{Digest, Sha256};

const VECTORS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../contracts/fixtures/vault-pointer-vectors.json");
/// 向量檔的固定指紋。有人偷偷加列或刪列,這裡會紅(跟 cucumber 的「47 列、sha256 是固定值」同一個值)。
const VECTORS_SHA256: &str = "4f22dc2a8062686e69ebcfd4f770f1d4ac0103571acba9988a838288c4bbbd96";

const ID_A: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ID_B: &str = "11111111-2222-4333-8444-555555555555";

fn vectors() -> Value {
    serde_json::from_str(&fs::read_to_string(VECTORS).expect("vectors file")).expect("vectors json")
}

fn rows<'a>(v: &'a Value, key: &str) -> &'a Vec<Value> {
    v[key].as_array().unwrap_or_else(|| panic!("{key} is not an array"))
}

struct Tmp(PathBuf);

impl Tmp {
    fn new() -> Tmp {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!("lc-root-rs-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        fs::create_dir_all(&dir).unwrap();
        Tmp(fs::canonicalize(dir).unwrap())
    }
    fn path(&self, rel: &str) -> PathBuf {
        self.0.join(rel)
    }
}

impl Drop for Tmp {
    fn drop(&mut self) {
        // chmod 000 的檔先改回來才刪得掉
        for rel in ["xdg/llm-learning-cards/vault.json", "learning/config/vault-id"] {
            let _ = fs::set_permissions(self.0.join(rel), fs::Permissions::from_mode(0o600));
        }
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn chmod_zero_blocks_reading(tmp: &Tmp) -> bool {
    let f = tmp.path("chmod-probe");
    fs::write(&f, "x").unwrap();
    fs::set_permissions(&f, fs::Permissions::from_mode(0o000)).unwrap();
    let blocked = fs::read_to_string(&f).is_err();
    fs::set_permissions(&f, fs::Permissions::from_mode(0o600)).unwrap();
    blocked
}

// ---------------------------------------------------------------- 向量檔本身

#[test]
fn the_vectors_file_is_the_pinned_47_rows() {
    let bytes = fs::read(VECTORS).expect("vectors file");
    let digest = Sha256::digest(&bytes);
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, VECTORS_SHA256, "向量檔被改過:要改先走 decision-record,並同步 TS 與 Rust 兩邊");
    let v = vectors();
    let counts = ["pointer_path", "marker_compare", "pointer_content", "states"].map(|k| rows(&v, k).len());
    assert_eq!(counts, [3, 19, 11, 14]);
    assert_eq!(counts.iter().sum::<usize>(), 47);
    let reasons: Vec<&str> = v["reasons"].as_array().unwrap().iter().map(|r| r.as_str().unwrap()).collect();
    assert_eq!(reasons, ["pointer-missing", "pointer-unreadable", "learning-dir-missing", "marker-mismatch", "ok"]);
}

#[test]
fn the_five_start_states_have_five_distinct_reasons() {
    let all = [
        StartState::PointerMissing,
        StartState::PointerUnreadable,
        StartState::LearningDirMissing,
        StartState::MarkerMismatch,
        StartState::Ok,
    ];
    let reasons: Vec<&str> = all.iter().map(StartState::reason).collect();
    assert_eq!(reasons, ["pointer-missing", "pointer-unreadable", "learning-dir-missing", "marker-mismatch", "ok"]);
}

// ---------------------------------------------------------------- pointer_path

#[test]
fn pointer_path_agrees_with_every_row() {
    let v = vectors();
    let mut covered = (false, false, false); // set, unset, empty
    for row in rows(&v, "pointer_path") {
        let xdg = row["env"].get("XDG_CONFIG_HOME").map(|x| x.as_str().unwrap());
        match xdg {
            Some("") => covered.2 = true,
            Some(_) => covered.0 = true,
            None => covered.1 = true,
        }
        let home = row["home"].as_str().unwrap();
        let got = pointer_path(xdg, Path::new(home));
        assert_eq!(got, PathBuf::from(row["expect"].as_str().unwrap()), "{}", row["why"]);
    }
    assert_eq!(covered, (true, true, true), "向量要涵蓋 XDG 有設、沒設、空字串");
}

#[test]
fn pointer_path_is_not_the_tauri_app_config_dir() {
    // 常見的錯法:Tauri 的 app_config_dir = <config>/<identifier>/。路徑裡不能有 identifier。
    let p = pointer_path(Some("/tmp/x"), Path::new("/tmp/h"));
    assert!(!p.to_string_lossy().contains("dev.learningcards.desktop"), "{p:?}");
    assert_eq!(p.file_name().unwrap(), "vault.json");
    assert_eq!(p.parent().unwrap().file_name().unwrap(), "llm-learning-cards");
}

// ---------------------------------------------------------------- marker_matches

#[test]
fn marker_comparison_agrees_with_every_row() {
    let v = vectors();
    for row in rows(&v, "marker_compare") {
        let equal = marker_matches(row["marker_text"].as_str().unwrap(), row["vault_id"].as_str().unwrap());
        let expect = row["expect"].as_str().unwrap() == "equal";
        assert_eq!(equal, expect, "{}", row["why"]);
    }
}

// ---------------------------------------------------------------- parse_pointer

#[test]
fn pointer_content_agrees_with_every_row() {
    let v = vectors();
    for row in rows(&v, "pointer_content") {
        let got = parse_pointer(row["raw"].as_str().unwrap());
        match row["expect"].as_str().unwrap() {
            "ok" => {
                let p = got.unwrap_or_else(|| panic!("應該讀得出來: {}", row["why"]));
                assert_eq!(p.learning_dir, row["learning_dir"].as_str().unwrap(), "{}", row["why"]);
                assert_eq!(p.vault_id, row["vault_id"].as_str().unwrap(), "{}", row["why"]);
            }
            "unreadable" => assert!(got.is_none(), "應該讀不出來: {}", row["why"]),
            other => panic!("未知的 expect {other}"),
        }
    }
}

// ---------------------------------------------------------------- 解析狀態(向量逐列)

fn arrange(tmp: &Tmp, row: &Value) -> PathBuf {
    let learning = tmp.path("learning");
    let xdg_dir = tmp.path("xdg/llm-learning-cards");
    let pointer_file = xdg_dir.join("vault.json");
    let marker_file = learning.join("config/vault-id");
    let missing = tmp.path("missing-learning");
    let cwd = tmp.path("cwd");
    fs::create_dir_all(&learning).unwrap();
    fs::create_dir_all(&cwd).unwrap();
    let sub = |s: &str| -> String {
        s.replace("<LEARNING>", learning.to_str().unwrap())
            .replace("<MISSING>", missing.to_str().unwrap())
            .replace("<RELATIVE>", "../learning")
    };
    let pointer = &row["pointer"];
    match pointer["kind"].as_str().unwrap() {
        "absent" => {}
        "raw" => {
            fs::create_dir_all(&xdg_dir).unwrap();
            fs::write(&pointer_file, pointer["raw"].as_str().unwrap()).unwrap();
        }
        "json" => {
            fs::create_dir_all(&xdg_dir).unwrap();
            let body = serde_json::json!({
                "learning_dir": sub(pointer["learning_dir"].as_str().unwrap()),
                "vault_id": pointer["vault_id"].as_str().unwrap(),
            });
            fs::write(&pointer_file, body.to_string()).unwrap();
        }
        "io-error" => {
            assert!(chmod_zero_blocks_reading(tmp), "chmod 000 擋不住這個行程(root?),io-error 這列擺不出來,不能略過");
            fs::create_dir_all(&xdg_dir).unwrap();
            fs::write(&pointer_file, serde_json::json!({ "learning_dir": learning, "vault_id": ID_A }).to_string()).unwrap();
            fs::set_permissions(&pointer_file, fs::Permissions::from_mode(0o000)).unwrap();
        }
        other => panic!("未知的 pointer kind {other}"),
    }
    let marker = &row["marker"];
    match marker["kind"].as_str().unwrap() {
        "absent" => {}
        "text" => {
            fs::create_dir_all(learning.join("config")).unwrap();
            fs::write(&marker_file, marker["text"].as_str().unwrap()).unwrap();
        }
        "io-error" => {
            assert!(chmod_zero_blocks_reading(tmp), "chmod 000 擋不住這個行程(root?),io-error 這列擺不出來,不能略過");
            fs::create_dir_all(learning.join("config")).unwrap();
            fs::write(&marker_file, format!("{ID_A}\n")).unwrap();
            fs::set_permissions(&marker_file, fs::Permissions::from_mode(0o000)).unwrap();
        }
        other => panic!("未知的 marker kind {other}"),
    }
    if row.get("decoy_learning_dir_with_valid_marker").and_then(Value::as_bool) == Some(true) {
        fs::create_dir_all(learning.join("config")).unwrap();
        fs::write(&marker_file, format!("{ID_A}\n")).unwrap();
    }
    pointer_file
}

fn listing(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    fn walk(base: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        let mut names: Vec<_> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
        names.sort();
        for p in names {
            let rel = p.strip_prefix(base).unwrap().to_string_lossy().into_owned();
            let meta = fs::symlink_metadata(&p).unwrap();
            if meta.is_dir() {
                out.push((format!("{rel}/"), Vec::new()));
                walk(base, &p, out);
            } else {
                out.push((rel, fs::read(&p).unwrap_or_else(|_| b"<unreadable>".to_vec())));
            }
        }
    }
    walk(root, root, &mut out);
    out
}

#[test]
fn every_state_row_resolves_to_its_reason_and_writes_nothing() {
    let v = vectors();
    let mut seen = std::collections::BTreeSet::new();
    for row in rows(&v, "states") {
        let tmp = Tmp::new();
        let pointer_file = arrange(&tmp, row);
        let before = listing(&tmp.0);
        let resolved = resolve_at(&pointer_file);
        let after = listing(&tmp.0);
        let expect = row["expect"].as_str().unwrap();
        assert_eq!(resolved.state.reason(), expect, "{}", row["why"]);
        assert_eq!(before, after, "解析寫了東西: {}", row["why"]);
        assert_eq!(resolved.pointer_path, pointer_file, "{}", row["why"]);
        if expect == "ok" {
            assert_eq!(resolved.root, Some(tmp.path("learning")), "ok 要給 canonical 的根: {}", row["why"]);
        } else {
            assert_eq!(resolved.root, None, "失敗狀態不給根: {}", row["why"]);
        }
        seen.insert(expect.to_string());
    }
    assert_eq!(seen.len(), 5, "五種狀態每一種至少一列: {seen:?}");
}

#[test]
fn a_missing_learning_dir_is_not_created_by_resolving() {
    let tmp = Tmp::new();
    let missing = tmp.path("never-created");
    let pointer_dir = tmp.path("xdg/llm-learning-cards");
    fs::create_dir_all(&pointer_dir).unwrap();
    fs::write(pointer_dir.join("vault.json"), serde_json::json!({ "learning_dir": missing, "vault_id": ID_A }).to_string()).unwrap();
    let r = resolve_at(&pointer_dir.join("vault.json"));
    assert_eq!(r.state, StartState::LearningDirMissing);
    assert!(!missing.exists(), "根不存在時不建根");
}

#[test]
fn an_ok_root_gets_no_state_directory_from_resolving() {
    let tmp = Tmp::new();
    let learning = tmp.path("learning");
    fs::create_dir_all(learning.join("config")).unwrap();
    fs::write(learning.join("config/vault-id"), format!("{ID_A}\n")).unwrap();
    let pointer_dir = tmp.path("xdg/llm-learning-cards");
    fs::create_dir_all(&pointer_dir).unwrap();
    fs::write(pointer_dir.join("vault.json"), serde_json::json!({ "learning_dir": learning, "vault_id": ID_A }).to_string()).unwrap();
    let r = resolve_at(&pointer_dir.join("vault.json"));
    assert_eq!(r.state, StartState::Ok);
    assert!(!learning.join("state").exists(), "啟動不建 state/(驗收 10:只在要寫 warning 的時候才建)");
}

#[test]
fn resolve_uses_the_pointer_path_rule_and_ignores_other_places() {
    let tmp = Tmp::new();
    let learning = tmp.path("learning");
    fs::create_dir_all(learning.join("config")).unwrap();
    fs::write(learning.join("config/vault-id"), format!("{ID_A}\n")).unwrap();
    let xdg = tmp.path("xdg");
    let home = tmp.path("home");
    // 對的位置
    fs::create_dir_all(xdg.join("llm-learning-cards")).unwrap();
    fs::write(xdg.join("llm-learning-cards/vault.json"), serde_json::json!({ "learning_dir": learning, "vault_id": ID_A }).to_string()).unwrap();
    // 誘餌:Tauri 的位置與 ~/.config(XDG 有設就不能看這裡)
    for decoy in [xdg.join("dev.learningcards.desktop"), home.join(".config/llm-learning-cards")] {
        fs::create_dir_all(&decoy).unwrap();
        fs::write(decoy.join("vault.json"), serde_json::json!({ "learning_dir": tmp.path("nowhere"), "vault_id": ID_B }).to_string()).unwrap();
    }
    let r = resolve(Some(xdg.to_str().unwrap()), &home);
    assert_eq!(r.state, StartState::Ok);
    assert_eq!(r.pointer_path, xdg.join("llm-learning-cards/vault.json"));
    // XDG 空字串 = 沒設 → 看 home/.config:那裡是誘餌,指向不存在的資料夾
    let r2 = resolve(Some(""), &home);
    assert_eq!(r2.state, StartState::LearningDirMissing);
    assert_eq!(r2.pointer_path, home.join(".config/llm-learning-cards/vault.json"));
}
