//! 白名單通過之後才碰檔案系統。symlink 的 canonicalize 比對是另一道檢查,
//! 跟白名單無關:拿掉它,字元集合那組仍然全綠,只有逃出根目錄的 symlink 變紅。

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

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

fn guard(root: &Path, rel: &str) -> Result<PathBuf, Refusal> {
    path_guard::check_rel_path(rel)?;
    inside(root, rel)
}

fn record(op: &str, rel: &str) -> FsCall {
    FsCall {
        op: op.to_string(),
        path: rel.to_string(),
    }
}

pub fn read(root: &Path, rel: &str) -> Result<Outcome, Refusal> {
    let full = guard(root, rel)?;
    // 路徑已通過。檔案不存在不是拒絕——記錄這次呼叫,內容當空字串。
    // 拒絕只發生在 guard(白名單或 symlink)失敗、還沒碰到檔案的時候。
    let text = fs::read_to_string(&full).unwrap_or_default();
    Ok(Outcome {
        value: serde_json::Value::String(text),
        fs_calls: vec![record("read", rel)],
    })
}

pub fn write(root: &Path, rel: &str, content: &str) -> Result<Outcome, Refusal> {
    let full = guard(root, rel)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|_| Refusal::new("io"))?;
    }
    atomic_replace(&full, content, &StdWriteIo).map_err(|_| Refusal::new("io"))?;
    Ok(Outcome {
        value: serde_json::Value::Null,
        fs_calls: vec![record("write", rel)],
    })
}

pub fn exists(root: &Path, rel: &str) -> Result<Outcome, Refusal> {
    let full = guard(root, rel)?;
    let hit = full.exists();
    Ok(Outcome {
        value: serde_json::Value::Bool(hit),
        fs_calls: vec![record("exists", rel)],
    })
}

pub fn list(root: &Path, rel: &str) -> Result<Outcome, Refusal> {
    let full = guard(root, rel)?;
    let mut names = Vec::new();
    let entries = fs::read_dir(&full).map_err(|_| Refusal::new("io"))?;
    for entry in entries {
        let entry = entry.map_err(|_| Refusal::new("io"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let joined = format!("{rel}/{name}");
        if path_guard::check_rel_path(&joined).is_ok() {
            names.push(name);
        }
    }
    names.sort();
    Ok(Outcome {
        value: serde_json::Value::Array(names.into_iter().map(serde_json::Value::String).collect()),
        fs_calls: vec![record("list", rel)],
    })
}

/// 寫入四步可注入失敗。生產路徑用 `StdWriteIo`;測試替換單步。
/// 契約 §11b / ADR-040:同目錄 `<name>.tmp` → fsync 檔 → rename → fsync 目錄。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IoStep {
    pub step: &'static str,
    pub detail: String,
}

pub trait WriteIo {
    fn create_tmp(&self, tmp: &Path) -> Result<File, IoStep>;
    fn write_all(&self, file: &mut File, bytes: &[u8]) -> Result<(), IoStep>;
    fn fsync_file(&self, file: &File) -> Result<(), IoStep>;
    fn rename_over(&self, tmp: &Path, dest: &Path) -> Result<(), IoStep>;
    fn fsync_dir(&self, dir: &Path) -> Result<(), IoStep>;
    fn remove_tmp(&self, tmp: &Path) -> Result<(), IoStep>;
    /// 目錄 fsync 回 EINVAL(或該檔案系統不支援)算成功。
    fn dir_fsync_unsupported(&self, err: &IoStep) -> bool;
}

pub fn tmp_beside(dest: &Path) -> PathBuf {
    let name = dest.file_name().and_then(|s| s.to_str()).unwrap_or("write");
    dest.with_file_name(format!("{name}.tmp"))
}

pub struct StdWriteIo;

impl WriteIo for StdWriteIo {
    fn create_tmp(&self, tmp: &Path) -> Result<File, IoStep> {
        OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(tmp)
            .map_err(|e| IoStep {
                step: "create",
                detail: e.to_string(),
            })
    }

    fn write_all(&self, file: &mut File, bytes: &[u8]) -> Result<(), IoStep> {
        file.write_all(bytes).map_err(|e| IoStep {
            step: "write",
            detail: e.to_string(),
        })
    }

    fn fsync_file(&self, file: &File) -> Result<(), IoStep> {
        file.sync_all().map_err(|e| IoStep {
            step: "fsync_file",
            detail: e.to_string(),
        })
    }

    fn rename_over(&self, tmp: &Path, dest: &Path) -> Result<(), IoStep> {
        fs::rename(tmp, dest).map_err(|e| IoStep {
            step: "rename",
            detail: e.to_string(),
        })
    }

    fn fsync_dir(&self, dir: &Path) -> Result<(), IoStep> {
        let file = File::open(dir).map_err(|e| IoStep {
            step: "fsync_dir",
            detail: e.to_string(),
        })?;
        match file.sync_all() {
            Ok(()) => Ok(()),
            // POSIX EINVAL = 22。tmpfs 與部分檔案系統不支援對目錄 fsync。
            Err(e) if e.raw_os_error() == Some(22) => Err(IoStep {
                step: "fsync_dir",
                detail: "EINVAL".into(),
            }),
            Err(e) => Err(IoStep {
                step: "fsync_dir",
                detail: e.to_string(),
            }),
        }
    }

    fn remove_tmp(&self, tmp: &Path) -> Result<(), IoStep> {
        match fs::remove_file(tmp) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(IoStep {
                step: "remove_tmp",
                detail: e.to_string(),
            }),
        }
    }

    fn dir_fsync_unsupported(&self, err: &IoStep) -> bool {
        err.detail == "EINVAL"
    }
}

pub fn atomic_replace(dest: &Path, content: &str, io: &impl WriteIo) -> Result<(), IoStep> {
    let tmp = tmp_beside(dest);
    let result = (|| {
        {
            let mut file = io.create_tmp(&tmp)?;
            io.write_all(&mut file, content.as_bytes())?;
            io.fsync_file(&file)?;
        }
        io.rename_over(&tmp, dest)?;
        if let Some(dir) = dest.parent() {
            if !dir.as_os_str().is_empty() {
                match io.fsync_dir(dir) {
                    Ok(()) => {}
                    Err(err) if io.dir_fsync_unsupported(&err) => {}
                    Err(err) => return Err(err),
                }
            }
        }
        Ok(())
    })();
    if result.is_err() {
        // 清理失敗不能蓋掉原本的錯誤:這裡丟掉 remove 的 Result。
        let _ = io.remove_tmp(&tmp);
    }
    result
}
