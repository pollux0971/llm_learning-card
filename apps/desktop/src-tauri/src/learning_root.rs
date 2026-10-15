//! learning 根目錄的唯一來源:使用者層指標檔(契約 §12、ADR-066;T2c-2)。
//!
//! 規則跟 T5 的 TS 版(`packages/core/src/llm/ledger.ts` 的 `resolveVerifiedLedger`)一樣,兩邊跑同一份向量
//! `contracts/fixtures/vault-pointer-vectors.json`:
//!   - 指標檔 `${XDG_CONFIG_HOME:-~/.config}/llm-learning-cards/vault.json`(`XDG_CONFIG_HOME` 空字串視同未設),
//!     內容 `{ "learning_dir": "<絕對路徑>", "vault_id": "<uuid>" }`;
//!   - 身分標記 `<learning_dir>/config/vault-id`:同一個 uuid,逐字相等,容許且只容許一個結尾 `\n`;
//!   - 四種失敗各自一個狀態,不混:指標檔不存在、讀不到(含 JSON 壞、不是物件、欄位缺或型別錯、相對路徑)、
//!     `learning_dir` 不存在、標記不符(含標記不存在、讀不到)。
//!
//! 這裡不讀環境變數(`XDG_CONFIG_HOME`、家目錄都是參數;從行程環境拿的是 lib 的 `pointer_env`),而且**只讀**檔案:
//! 不建目錄、不寫指標檔、不寫標記、不建 `state/`。寫這兩份檔的只有 `scripts/vault.ts init`
//! (技術顧問 2026-10-15 裁決 (b):桌面程式不做第三份 bootstrap)。
//! 桌面行程啟動時在 main.rs 解析一次,結果交給 Tauri state(`commands::LearningRoot`),四個 command 與 `lc` 協定共用。
//!
//! 跟 TS 版刻意對齊的細節:指標檔與標記都照 UTF-8 讀、壞位元組換成 U+FFFD(`readFileSync(…, 'utf8')` 的行為);
//! 「存在」用 `Path::exists`(跟 `existsSync` 一樣跟隨 symlink、任何錯誤都算不存在)。

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

const APP_DIR: &str = "llm-learning-cards";
const POINTER_FILE: &str = "vault.json";
const MARKER_DIR: &str = "config";
const MARKER_FILE: &str = "vault-id";

/// 指標檔的內容(已驗過:兩個欄位都是字串、`learning_dir` 是絕對路徑)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pointer {
    pub learning_dir: String,
    pub vault_id: String,
}

/// 五種啟動狀態。四種失敗互不相混。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartState {
    PointerMissing,
    PointerUnreadable,
    LearningDirMissing,
    MarkerMismatch,
    Ok,
}

impl StartState {
    /// 跟向量檔的 `reasons`、TS 的 `VaultRejectReason` 同一組名字。
    pub fn reason(&self) -> &'static str {
        match self {
            StartState::PointerMissing => "pointer-missing",
            StartState::PointerUnreadable => "pointer-unreadable",
            StartState::LearningDirMissing => "learning-dir-missing",
            StartState::MarkerMismatch => "marker-mismatch",
            StartState::Ok => "ok",
        }
    }
}

/// 解析一次的結果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub state: StartState,
    /// 只有 `Ok` 是 `Some`,而且是 canonical 路徑;四種失敗一律 `None`。
    pub root: Option<PathBuf>,
    /// 去找的那個指標檔(不論存不存在)。
    pub pointer_path: PathBuf,
    /// 指標檔的內容解析得出來(`LearningDirMissing`、`MarkerMismatch`、`Ok`)才有。
    pub pointer: Option<Pointer>,
}

/// `${XDG_CONFIG_HOME:-<home>/.config}/llm-learning-cards/vault.json`。不讀環境:兩個輸入都是參數。
/// 不是 Tauri 的 `app_config_dir`(那會是 `<config>/<identifier>/`,跟 CLI 找的不是同一個檔)。
pub fn pointer_path(xdg_config_home: Option<&str>, home: &Path) -> PathBuf {
    let base = match xdg_config_home {
        Some(xdg) if !xdg.is_empty() => PathBuf::from(xdg),
        _ => home.join(".config"),
    };
    base.join(APP_DIR).join(POINTER_FILE)
}

/// `<learning_dir>/config/vault-id`。
pub fn marker_path(learning_dir: &Path) -> PathBuf {
    learning_dir.join(MARKER_DIR).join(MARKER_FILE)
}

/// 小寫的 8-4-4-4-12 十六進位(跟 TS 的 `UUID_RE` 同一條)。
fn is_uuid(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, &b)| match i {
            8 | 13 | 18 | 23 => b == b'-',
            _ => b.is_ascii_digit() || (b'a'..=b'f').contains(&b),
        })
}

/// 標記與指標的 `vault_id` 整串相等。標記容許且只容許一個結尾 `\n`;不是前綴、不分大小寫不算;
/// 任一邊不是合法 uuid 都算不符。
pub fn marker_matches(marker_text: &str, vault_id: &str) -> bool {
    let body = marker_text.strip_suffix('\n').unwrap_or(marker_text);
    is_uuid(body) && body == vault_id
}

/// 指標檔的內容。JSON 壞、不是物件、欄位缺或型別錯、`learning_dir` 不是絕對路徑,一律 `None`(= 讀不到)。
pub fn parse_pointer(raw: &str) -> Option<Pointer> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let object = value.as_object()?;
    let learning_dir = object.get("learning_dir")?.as_str()?;
    let vault_id = object.get("vault_id")?.as_str()?;
    if !Path::new(learning_dir).is_absolute() {
        return None;
    }
    Some(Pointer {
        learning_dir: learning_dir.to_string(),
        vault_id: vault_id.to_string(),
    })
}

fn read_text(path: &Path) -> Option<String> {
    fs::read(path).ok().map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

/// 讀一次指標檔,再讀一次標記檔;什麼都不寫、不建。
pub fn resolve_at(pointer_path: &Path) -> Resolved {
    let failed = |state: StartState, pointer: Option<Pointer>| Resolved {
        state,
        root: None,
        pointer_path: pointer_path.to_path_buf(),
        pointer,
    };
    if !pointer_path.exists() {
        return failed(StartState::PointerMissing, None);
    }
    let Some(pointer) = read_text(pointer_path).and_then(|raw| parse_pointer(&raw)) else {
        return failed(StartState::PointerUnreadable, None);
    };
    let learning_dir = Path::new(&pointer.learning_dir);
    if !learning_dir.exists() {
        return failed(StartState::LearningDirMissing, Some(pointer));
    }
    let Ok(root) = fs::canonicalize(learning_dir) else {
        return failed(StartState::LearningDirMissing, Some(pointer));
    };
    let same_vault = read_text(&marker_path(&root)).is_some_and(|text| marker_matches(&text, &pointer.vault_id));
    if !same_vault {
        return failed(StartState::MarkerMismatch, Some(pointer));
    }
    Resolved {
        state: StartState::Ok,
        root: Some(root),
        pointer_path: pointer_path.to_path_buf(),
        pointer: Some(pointer),
    }
}

/// `pointer_path` + `resolve_at`。
pub fn resolve(xdg_config_home: Option<&str>, home: &Path) -> Resolved {
    resolve_at(&pointer_path(xdg_config_home, home))
}
