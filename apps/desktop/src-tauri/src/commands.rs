//! 四個 Tauri command(T2c-1 驗收 A1、ADR-069)。webview 端的 `LearningFs`(`apps/desktop/src/webview/learning-fs.ts`)
//! 用 `invoke('read', { relPath })` 之類叫它們。
//!
//! 每個本體只有一行:呼叫 probe(`src/bin/lc-fs.rs`)也呼叫的**同一個** `learning_fs` 函式,
//! 白名單、symlink、warning 事件、io 錯誤分類、§11b 原子寫入都在那裡,不在這裡。
//! 回傳:read → string、write → null、list → string[]、exists → bool;錯誤 → `learning_fs::FsError` 的 JSON。
//!
//! 都是同步 command(Tauri 在主執行緒跑);一次讀寫一個學習卡大小的檔,不值得多一條執行緒。

use std::path::Path;

use serde_json::Value;
use tauri::ipc::Invoke;
use tauri::{Runtime, State};

use crate::learning_fs::{self, FsError, NotConfigured, Outcome};
use crate::learning_root::Resolved;

/// learning 根(Tauri managed state)。T2c-2 起只有一個來源:啟動時解析一次的指標檔(`learning_root::resolve`)。
/// 四個 command 與 `lc` 協定都讀這一份,不各自讀環境或指標檔。
#[derive(Debug, Clone)]
pub struct LearningRoot {
    resolved: Resolved,
}

impl LearningRoot {
    pub fn new(resolved: Resolved) -> Self {
        Self { resolved }
    }

    pub fn resolved(&self) -> &Resolved {
        &self.resolved
    }

    /// 啟動狀態是 ok 才有根(canonical);四種失敗一律「未設定」,不是拒絕、不寫 warning。
    pub fn dir(&self) -> Result<&Path, FsError> {
        self.resolved
            .root
            .as_deref()
            .ok_or(FsError::NotConfigured(NotConfigured {}))
    }
}

#[tauri::command]
pub fn read(root: State<'_, LearningRoot>, rel_path: String) -> Result<Value, FsError> {
    learning_fs::read(root.dir()?, &rel_path).map(Outcome::into_value)
}

#[tauri::command]
pub fn write(root: State<'_, LearningRoot>, rel_path: String, content: String) -> Result<Value, FsError> {
    learning_fs::write(root.dir()?, &rel_path, &content).map(Outcome::into_value)
}

#[tauri::command]
pub fn list(root: State<'_, LearningRoot>, rel_dir: String) -> Result<Value, FsError> {
    learning_fs::list(root.dir()?, &rel_dir).map(Outcome::into_value)
}

#[tauri::command]
pub fn exists(root: State<'_, LearningRoot>, rel_path: String) -> Result<Value, FsError> {
    learning_fs::exists(root.dir()?, &rel_path).map(Outcome::into_value)
}

/// main.rs 與 tests/commands.rs 用的同一個 handler。
pub fn handler<R: Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![read, write, list, exists]
}
