//! 白名單通過之後才碰檔案系統。symlink 的 canonicalize 比對是另一道檢查,
//! 跟白名單無關:拿掉它,字元集合那組仍然全綠,只有逃出根目錄的 symlink 變紅。

use std::fs;
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
    let existing = existing_ancestor(&full).ok_or(Refusal::new("symlink"))?;
    let canon = existing.canonicalize().map_err(|_| Refusal::new("symlink"))?;
    if canon != root && !canon.starts_with(&root) {
        return Err(Refusal::new("symlink"));
    }
    if full.exists() {
        let followed = full.canonicalize().map_err(|_| Refusal::new("symlink"))?;
        if followed != root && !followed.starts_with(&root) {
            return Err(Refusal::new("symlink"));
        }
    }
    Ok(full)
}

fn existing_ancestor(path: &Path) -> Option<&Path> {
    let mut cur = path;
    loop {
        if cur.exists() {
            return Some(cur);
        }
        cur = cur.parent()?;
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
    fs::write(&full, content).map_err(|_| Refusal::new("io"))?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn tmp() -> PathBuf {
        let p = std::env::temp_dir().join(format!("lc-fs-{}-{}", std::process::id(), unique()));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn unique() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64
    }

    #[test]
    fn allowed_read_records_the_original_string() {
        let root = tmp();
        fs::create_dir_all(root.join("cards")).unwrap();
        fs::write(root.join("cards/a.md"), "hi").unwrap();
        let out = read(&root, "cards/a.md").unwrap();
        assert_eq!(out.fs_calls[0].path, "cards/a.md");
        assert_eq!(out.value, serde_json::json!("hi"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refused_path_does_not_touch_the_fs() {
        let root = tmp();
        let err = read(&root, "..\\..\\etc\\passwd").unwrap_err();
        assert_eq!(err.reason, "structure");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn symlink_out_is_refused_and_whitelist_still_allows_a_normal_file() {
        let parent = tmp();
        let root = parent.join("learning");
        let outside = parent.join("outside");
        fs::create_dir_all(root.join("cards")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret"), "OUT").unwrap();
        fs::write(root.join("cards/a.md"), "in").unwrap();
        symlink(outside.join("secret"), root.join("cards/link.md")).unwrap();
        assert!(read(&root, "cards/link.md").is_err());
        assert!(read(&root, "cards/a.md").is_ok());
        let _ = fs::remove_dir_all(&parent);
    }
}
