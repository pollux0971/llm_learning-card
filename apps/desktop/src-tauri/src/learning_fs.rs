//! 白名單通過之後才碰檔案系統。symlink 的 canonicalize 比對是另一道檢查,
//! 跟白名單無關:拿掉它,字元集合那組仍然全綠,只有逃出根目錄的 symlink 變紅。
//!
//! Tauri command(`commands.rs`)與 probe(`bin/lc-fs.rs`)呼叫的都是這裡的 `read` / `write` / `list` / `exists`。
//! 錯誤分兩種(ADR-069、T2c-1 驗收 D):
//!   - **拒絕**:白名單或 symlink 不過,還沒碰到檔案;往 `<learning 根>/state/log.jsonl` 寫一行 warning
//!     (每一次都寫,不限流);
//!   - **io 錯誤**:路徑合法、檔案系統出錯(不存在、是目錄、權限、不是 UTF-8……);不寫 warning。
//! 另外,啟動狀態不是 ok(指標檔不存在、讀不到、learning 資料夾不存在、身分不符;T2c-2)時,
//! command 根本不呼叫這裡,直接回 `FsError::NotConfigured`(見 `commands::LearningRoot::dir`)。

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use crate::event_log;
use crate::path_guard::{self, Refusal};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsCall {
    pub op: String,
    pub path: String,
}

#[derive(Debug)]
pub struct Outcome {
    pub value: serde_json::Value,
    pub fs_calls: Vec<FsCall>,
}

impl Outcome {
    pub fn into_value(self) -> serde_json::Value {
        self.value
    }
}

/// io 錯誤在邊界上的形狀:`{"kind":"io","code":...,"errno":...}`。`errno` 是原始的 OS 錯誤碼,沒有就不出現。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename = "io")]
pub struct IoFailure {
    pub code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errno: Option<i32>,
}

impl IoFailure {
    pub fn from_io(err: &io::Error) -> Self {
        Self {
            code: io_code(err),
            errno: err.raw_os_error(),
        }
    }
}

/// learning 根沒設好(啟動狀態不是 ok,T2c-2 驗收 3):`{"kind":"not-configured"}`。
/// 不是拒絕、不是 io 錯誤;不碰檔案、不寫 warning(沒有可以寫的根)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename = "not-configured")]
pub struct NotConfigured {}

/// command 的錯誤。拒絕序列化成 `{"kind":"refused","reason":...}`,io 錯誤見 `IoFailure`,
/// 根沒設好見 `NotConfigured`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum FsError {
    Refused(Refusal),
    Io(IoFailure),
    NotConfigured(NotConfigured),
}

impl FsError {
    pub fn refusal(&self) -> Option<&Refusal> {
        match self {
            FsError::Refused(refusal) => Some(refusal),
            FsError::Io(_) | FsError::NotConfigured(_) => None,
        }
    }
}

impl From<&io::Error> for FsError {
    fn from(err: &io::Error) -> Self {
        FsError::Io(IoFailure::from_io(err))
    }
}

impl From<io::Error> for FsError {
    fn from(err: io::Error) -> Self {
        FsError::from(&err)
    }
}

/// io 錯誤的分類。webview 端的 `LearningIoError.code` 就是這個字串。
pub fn io_code(err: &io::Error) -> &'static str {
    match err.kind() {
        io::ErrorKind::NotFound => "not_found",
        io::ErrorKind::IsADirectory => "is_dir",
        io::ErrorKind::NotADirectory => "not_dir",
        io::ErrorKind::PermissionDenied => "permission",
        io::ErrorKind::StorageFull => "no_space",
        io::ErrorKind::ReadOnlyFilesystem => "read_only",
        io::ErrorKind::CrossesDevices => "cross_device",
        _ => "other",
    }
}

fn inside(root: &Path, rel: &str) -> Result<PathBuf, Refusal> {
    let root = root.canonicalize().map_err(|_| Refusal::new("root"))?;
    let full = root.join(rel);
    let mut acc = root.clone();
    for seg in rel.split('/') {
        if seg.is_empty() {
            return Err(Refusal::new("symlink"));
        }
        acc.push(seg);
        must_be_inside_if_present(&root, &acc)?;
    }
    if acc != full {
        must_be_inside_if_present(&root, &full)?;
    }
    Ok(full)
}

/// 路徑上任何一段(含最後一段)只要存在任何東西——檔、目錄、或懸空 symlink——
/// 就必須 canonicalize 成功且落在根內。`exists()` 對懸空 symlink 是 false,會漏檢;
/// 這裡用 `symlink_metadata`。最後一段是懸空 symlink 時 canonicalize 失敗,一律拒絕。
fn must_be_inside_if_present(root: &Path, path: &Path) -> Result<(), Refusal> {
    match fs::symlink_metadata(path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(Refusal::new("symlink")),
        Ok(_) => {
            let canon = fs::canonicalize(path).map_err(|_| Refusal::new("symlink"))?;
            if canon != *root && !canon.starts_with(root) {
                return Err(Refusal::new("symlink"));
            }
            Ok(())
        }
    }
}

/// 白名單 + symlink。不寫 log:command 的拒絕由 `guarded` 寫,asset 的拒絕由 asset_protocol 限流後寫。
pub fn guard(root: &Path, rel: &str) -> Result<PathBuf, Refusal> {
    path_guard::check_rel_path(rel)?;
    inside(root, rel)
}

/// command 用:拒絕時寫一行 warning(`path` 是原樣的 relPath),再把拒絕交出去。
fn guarded(root: &Path, rel: &str, op: &str) -> Result<PathBuf, FsError> {
    guard(root, rel).map_err(|refusal| {
        note_refusal(root, op, rel, &refusal);
        FsError::Refused(refusal)
    })
}

/// log 只寫進 canonicalize 得了的根底下;根本身不存在(reason `root`)就沒有地方寫,只記 Rust log。
fn note_refusal(root: &Path, op: &str, rel: &str, refusal: &Refusal) {
    match root.canonicalize() {
        Ok(root) => event_log::record(
            &root,
            &event_log::command_refusal(SystemTime::now(), op, rel, refusal.reason),
        ),
        Err(err) => log::error!("refused {op} {rel:?} ({}); no learning root for the log: {err}", refusal.reason),
    }
}

fn record(op: &str, rel: &str) -> FsCall {
    FsCall {
        op: op.to_string(),
        path: rel.to_string(),
    }
}

/// 讀不到就是 io 錯誤,不是空字串;不是 UTF-8 也是 io 錯誤(`not_utf8`),不轉換。
pub fn read(root: &Path, rel: &str) -> Result<Outcome, FsError> {
    let full = guarded(root, rel, "read")?;
    let bytes = fs::read(&full)?;
    let text = String::from_utf8(bytes).map_err(|_| {
        FsError::Io(IoFailure {
            code: "not_utf8",
            errno: None,
        })
    })?;
    Ok(Outcome {
        value: serde_json::Value::String(text),
        fs_calls: vec![record("read", rel)],
    })
}

/// `learning/` 底下**所有**路徑都走同一份 §11b 原子寫入(不只 `state/`)。
pub fn write(root: &Path, rel: &str, content: &str) -> Result<Outcome, FsError> {
    let full = guarded(root, rel, "write")?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent)?;
    }
    atomic_replace(&full, content, &StdWriteIo).map_err(|step| FsError::from(&step.error))?;
    Ok(Outcome {
        value: serde_json::Value::Null,
        fs_calls: vec![record("write", rel)],
    })
}

/// 合法而不存在是 `false`,不是錯誤;其他讀不到 metadata 的情況是 io 錯誤。
pub fn exists(root: &Path, rel: &str) -> Result<Outcome, FsError> {
    let full = guarded(root, rel, "exists")?;
    let hit = match fs::metadata(&full) {
        Ok(_) => true,
        Err(err) if err.kind() == io::ErrorKind::NotFound => false,
        Err(err) => return Err(FsError::from(&err)),
    };
    Ok(Outcome {
        value: serde_json::Value::Bool(hit),
        fs_calls: vec![record("exists", rel)],
    })
}

/// 回傳的每個名字接回 `rel` 之後都通過白名單;不通過的、名字不是 UTF-8 的、讀不到 metadata 的
/// (例如懸空 symlink)條目略過,不丟錯(§13)。
pub fn list(root: &Path, rel: &str) -> Result<Outcome, FsError> {
    let full = guarded(root, rel, "list")?;
    let mut names = Vec::new();
    for entry in fs::read_dir(&full)?.flatten() {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if path_guard::check_rel_path(&format!("{rel}/{name}")).is_err() {
            continue;
        }
        if fs::metadata(entry.path()).is_err() {
            continue;
        }
        names.push(name);
    }
    names.sort();
    Ok(Outcome {
        value: serde_json::Value::Array(names.into_iter().map(serde_json::Value::String).collect()),
        fs_calls: vec![record("list", rel)],
    })
}

// ---------------------------------------------------------------- §11b 原子寫入

/// 失敗的那一步與原始的 `io::Error`。`step` 是 T7 共用向量
/// (`packages/core/src/schema/atomic-write.vectors.json`)的 `inject.call` 名字。
#[derive(Debug)]
pub struct IoStep {
    pub step: &'static str,
    pub error: io::Error,
}

fn at(step: &'static str) -> impl FnOnce(io::Error) -> IoStep {
    move |error| IoStep { step, error }
}

/// syscall 層。每個方法對應向量的一個 `inject.call`;測試替身只在這一層注入錯誤,
/// 「目錄 fsync 的 EINVAL 算不算成功」不在這裡判斷(見 `dir_fsync_is_unsupported`)。
pub trait WriteIo {
    /// `open:tmp`:以寫入模式開(建、截斷)同目錄的 `<name>.tmp`。
    fn open_tmp(&self, tmp: &Path) -> io::Result<File>;
    /// `write`
    fn write(&self, file: &mut File, bytes: &[u8]) -> io::Result<()>;
    /// `fsync:file`
    fn fsync_file(&self, file: &File) -> io::Result<()>;
    /// `close:file`
    fn close_file(&self, file: File) -> io::Result<()>;
    /// `rename`
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()>;
    /// `open:dir`
    fn open_dir(&self, dir: &Path) -> io::Result<File>;
    /// `fsync:dir`
    fn fsync_dir(&self, dir: &File) -> io::Result<()>;
    /// `close:dir`
    fn close_dir(&self, dir: File) -> io::Result<()>;
    /// `unlink`(失敗後清 tmp,以及清舊樣式的殘檔)
    fn unlink(&self, path: &Path) -> io::Result<()>;
}

/// 生產用:每個方法就是一個真的 syscall。
pub struct StdWriteIo;

impl WriteIo for StdWriteIo {
    fn open_tmp(&self, tmp: &Path) -> io::Result<File> {
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        no_follow(&mut options);
        options.open(tmp)
    }

    fn write(&self, file: &mut File, bytes: &[u8]) -> io::Result<()> {
        file.write_all(bytes)
    }

    fn fsync_file(&self, file: &File) -> io::Result<()> {
        file.sync_all()
    }

    fn close_file(&self, file: File) -> io::Result<()> {
        close(file)
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        fs::rename(from, to)
    }

    fn open_dir(&self, dir: &Path) -> io::Result<File> {
        File::open(dir)
    }

    fn fsync_dir(&self, dir: &File) -> io::Result<()> {
        dir.sync_all()
    }

    fn close_dir(&self, dir: File) -> io::Result<()> {
        close(dir)
    }

    fn unlink(&self, path: &Path) -> io::Result<()> {
        fs::remove_file(path)
    }
}

/// `<name>.tmp` 若是別人放的 symlink,不跟過去寫(那會寫到 symlink 指的地方,可能在根外)。
#[cfg(unix)]
fn no_follow(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.custom_flags(libc::O_NOFOLLOW);
}

#[cfg(not(unix))]
fn no_follow(_options: &mut OpenOptions) {}

/// `drop(File)` 會吞掉 close 的錯誤;這裡把它交出來。
#[cfg(unix)]
fn close(file: File) -> io::Result<()> {
    use std::os::fd::IntoRawFd;
    let fd = file.into_raw_fd();
    // SAFETY: fd 是剛從 File 拿出來的、只屬於這裡,只關這一次。
    if unsafe { libc::close(fd) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn close(file: File) -> io::Result<()> {
    drop(file);
    Ok(())
}

/// §11b 第 4 步唯一的例外:目錄 fsync 回 EINVAL(tmpfs 與部分 CI 的檔案系統不支援)算成功。
/// 只看 OS 錯誤碼,不看訊息。普通函式、不在 trait 上:測試替身覆寫不了這個判斷。
#[cfg(unix)]
pub fn dir_fsync_is_unsupported(err: &io::Error) -> bool {
    err.raw_os_error() == Some(libc::EINVAL)
}

/// Windows 的對應碼是 phase-5 的事;在那之前任何錯誤都往外丟。
#[cfg(not(unix))]
pub fn dir_fsync_is_unsupported(_err: &io::Error) -> bool {
    false
}

pub fn tmp_beside(dest: &Path) -> PathBuf {
    let name = dest.file_name().and_then(|s| s.to_str()).unwrap_or("write");
    dest.with_file_name(format!("{name}.tmp"))
}

/// 契約 §11b / ADR-040:同目錄 `<name>.tmp` → 寫 → fsync(檔) → close → rename → fsync(目錄)。
/// 任何一步失敗都先試著刪 `<name>.tmp` 再交出**原本那一步**的錯誤;清理失敗不遮蔽它。
/// 開始之前清掉同一個目標的舊樣式殘檔 `.<name>.<n>.<n>.tmp`(ADR-070 第 2 點)。
pub fn atomic_replace(dest: &Path, content: &str, io: &impl WriteIo) -> Result<(), IoStep> {
    remove_old_style_strays(dest, io);
    let tmp = tmp_beside(dest);
    let result = write_then_rename(&tmp, dest, content.as_bytes(), io);
    if result.is_err() {
        let _ = io.unlink(&tmp);
    }
    result
}

fn write_then_rename(tmp: &Path, dest: &Path, bytes: &[u8], io: &impl WriteIo) -> Result<(), IoStep> {
    let mut file = io.open_tmp(tmp).map_err(at("open:tmp"))?;
    let landed = io
        .write(&mut file, bytes)
        .map_err(at("write"))
        .and_then(|()| io.fsync_file(&file).map_err(at("fsync:file")));
    let closed = io.close_file(file).map_err(at("close:file"));
    landed?;
    closed?;
    io.rename(tmp, dest).map_err(at("rename"))?;
    match dest.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => sync_dir(dir, io),
        _ => Ok(()),
    }
}

/// 開了就要關:fsync 失敗也先 close 再交出 fsync 的錯誤。
fn sync_dir(dir: &Path, io: &impl WriteIo) -> Result<(), IoStep> {
    let handle = io.open_dir(dir).map_err(at("open:dir"))?;
    let synced = match io.fsync_dir(&handle) {
        Err(error) if !dir_fsync_is_unsupported(&error) => Err(IoStep {
            step: "fsync:dir",
            error,
        }),
        _ => Ok(()),
    };
    let closed = io.close_dir(handle).map_err(at("close:dir"));
    synced?;
    closed
}

/// 舊版 TS 的暫存檔名 `.<name>.<pid>.<ts>.tmp`(上次寫入中斷留下的)。別的目標的、新樣式的都不碰。
/// 列目錄或刪除失敗都不影響這次寫入。
fn remove_old_style_strays(dest: &Path, io: &impl WriteIo) {
    let (Some(dir), Some(name)) = (dest.parent(), dest.file_name().and_then(|s| s.to_str())) else {
        return;
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry
            .file_name()
            .to_str()
            .is_some_and(|entry_name| is_old_style_tmp(entry_name, name))
        {
            let _ = io.unlink(&entry.path());
        }
    }
}

fn is_old_style_tmp(entry: &str, name: &str) -> bool {
    let Some(middle) = entry
        .strip_prefix('.')
        .and_then(|rest| rest.strip_prefix(name))
        .and_then(|rest| rest.strip_prefix('.'))
        .and_then(|rest| rest.strip_suffix(".tmp"))
    else {
        return false;
    };
    match middle.split_once('.') {
        Some((pid, ts)) => all_digits(pid) && all_digits(ts),
        None => false,
    }
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}
