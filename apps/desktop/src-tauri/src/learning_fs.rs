//! 白名單通過之後才碰檔案系統。symlink 的 canonicalize 比對是另一道檢查,
//! 跟白名單無關:拿掉它,字元集合那組仍然全綠,只有逃出根目錄的 symlink 變紅。

use std::fs::{self, File};
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
    let canon = existing
        .canonicalize()
        .map_err(|_| Refusal::new("symlink"))?;
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

/// 寫入四步可注入失敗。生產路徑用 `StdWriteIo`;測試替換單步。
/// 紅測試階段 `atomic_replace` 仍走舊的 `fs::write`,所以失敗注入還沒接上。
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

#[allow(dead_code)]
pub fn atomic_replace(dest: &Path, content: &str, _io: &impl WriteIo) -> Result<(), IoStep> {
    fs::write(dest, content).map_err(|e| IoStep {
        step: "legacy",
        detail: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::os::unix::fs::symlink;
    use std::process::Command;

    fn tmp() -> PathBuf {
        let p = std::env::temp_dir().join(format!("lc-fs-{}-{}", std::process::id(), unique()));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn unique() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64
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

    /// 路徑來自 `mktemp -d`(mkdtemp)。Drop 只刪這個路徑,且必須在 /tmp/opencode 底下。
    struct Mkdtemp(PathBuf);

    impl Drop for Mkdtemp {
        fn drop(&mut self) {
            if self.0.starts_with("/tmp/opencode") {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }

    impl Mkdtemp {
        fn path(&self) -> &Path {
            &self.0
        }
    }

    fn mkdtemp(prefix: &str) -> Mkdtemp {
        let out = Command::new("mktemp")
            .args(["-d", "-p", "/tmp/opencode", &format!("{prefix}.XXXXXX")])
            .output()
            .unwrap_or_else(|e| panic!("mktemp: {e}"));
        assert!(
            out.status.success(),
            "mktemp failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let path = PathBuf::from(String::from_utf8(out.stdout).expect("mktemp utf8").trim());
        assert!(
            path.starts_with("/tmp/opencode"),
            "refusing non-mkdtemp path {}",
            path.display()
        );
        Mkdtemp(path)
    }

    fn leftover_tmp(dir: &Path) -> Vec<String> {
        let mut names = Vec::new();
        for entry in fs::read_dir(dir).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            if name.ends_with(".tmp") {
                names.push(name);
            }
        }
        names
    }

    fn plant_dangling(rel: &str) -> (Mkdtemp, Mkdtemp, PathBuf) {
        let root = mkdtemp("lc-dangle");
        let outside = mkdtemp("lc-out");
        let full = root.path().join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let target = outside.path().join("new");
        symlink(&target, &full).unwrap();
        assert!(!target.exists(), "fixture target must not exist yet");
        (root, outside, target)
    }

    #[test]
    fn dangling_symlink_write_is_refused_and_does_not_create_outside() {
        let (root, _outside, target) = plant_dangling("cards/evil.md");
        let result = write(root.path(), "cards/evil.md", "x");
        let created = target.exists();
        let reason = result.as_ref().err().map(|e| e.reason);
        assert!(
            result.is_err() && !created && reason == Some("symlink"),
            "refused={} reason={reason:?} outside_created={created} target={}",
            result.is_err(),
            target.display()
        );
    }

    #[test]
    fn dangling_symlink_read_is_refused() {
        let (root, _outside, target) = plant_dangling("cards/evil.md");
        let err = read(root.path(), "cards/evil.md").expect_err("dangling read must be refused");
        assert_eq!(err.reason, "symlink");
        assert!(!target.exists());
    }

    #[test]
    fn dangling_symlink_exists_is_refused() {
        let (root, _outside, target) = plant_dangling("cards/evil.md");
        let err =
            exists(root.path(), "cards/evil.md").expect_err("dangling exists must be refused");
        assert_eq!(err.reason, "symlink");
        assert!(!target.exists());
    }

    #[test]
    fn dangling_symlink_list_is_refused() {
        let (root, _outside, target) = plant_dangling("cards/evil.md");
        let err = list(root.path(), "cards/evil.md").expect_err("dangling list must be refused");
        assert_eq!(err.reason, "symlink");
        assert!(!target.exists());
    }

    struct Script {
        fail: Option<IoStep>,
        cleanup_fail: Option<IoStep>,
        einval_dir: bool,
        log: RefCell<Vec<&'static str>>,
    }

    impl Script {
        fn failing(step: &'static str) -> Self {
            Self {
                fail: Some(IoStep {
                    step,
                    detail: format!("boom-{step}"),
                }),
                cleanup_fail: None,
                einval_dir: false,
                log: RefCell::new(Vec::new()),
            }
        }

        fn ok() -> Self {
            Self {
                fail: None,
                cleanup_fail: None,
                einval_dir: false,
                log: RefCell::new(Vec::new()),
            }
        }

        fn note(&self, step: &'static str) {
            self.log.borrow_mut().push(step);
        }

        fn injected(&self, step: &'static str) -> Option<IoStep> {
            self.fail.clone().filter(|e| e.step == step)
        }
    }

    impl WriteIo for Script {
        fn create_tmp(&self, tmp: &Path) -> Result<File, IoStep> {
            self.note("create");
            if let Some(err) = self.injected("create") {
                return Err(err);
            }
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
            self.note("write");
            if let Some(err) = self.injected("write") {
                return Err(err);
            }
            file.write_all(bytes).map_err(|e| IoStep {
                step: "write",
                detail: e.to_string(),
            })
        }

        fn fsync_file(&self, file: &File) -> Result<(), IoStep> {
            self.note("fsync_file");
            if let Some(err) = self.injected("fsync_file") {
                return Err(err);
            }
            file.sync_all().map_err(|e| IoStep {
                step: "fsync_file",
                detail: e.to_string(),
            })
        }

        fn rename_over(&self, tmp: &Path, dest: &Path) -> Result<(), IoStep> {
            self.note("rename");
            if let Some(err) = self.injected("rename") {
                return Err(err);
            }
            fs::rename(tmp, dest).map_err(|e| IoStep {
                step: "rename",
                detail: e.to_string(),
            })
        }

        fn fsync_dir(&self, dir: &Path) -> Result<(), IoStep> {
            self.note("fsync_dir");
            if self.einval_dir {
                return Err(IoStep {
                    step: "fsync_dir",
                    detail: "EINVAL".into(),
                });
            }
            if let Some(err) = self.injected("fsync_dir") {
                return Err(err);
            }
            let f = File::open(dir).map_err(|e| IoStep {
                step: "fsync_dir",
                detail: e.to_string(),
            })?;
            f.sync_all().map_err(|e| IoStep {
                step: "fsync_dir",
                detail: e.to_string(),
            })
        }

        fn remove_tmp(&self, tmp: &Path) -> Result<(), IoStep> {
            self.note("remove_tmp");
            if let Some(err) = &self.cleanup_fail {
                return Err(err.clone());
            }
            match fs::remove_file(tmp) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
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

    fn planted(name: &str) -> (Mkdtemp, PathBuf) {
        let dir = mkdtemp("lc-atomic");
        let dest = dir.path().join(name);
        fs::write(&dest, "OLD").unwrap();
        (dir, dest)
    }

    fn assert_before_rename_failed(step: &'static str) {
        let (dir, dest) = planted("note.md");
        let io = Script::failing(step);
        let boom = io.fail.clone().unwrap();
        let err = atomic_replace(&dest, "NEW", &io).expect_err(step);
        assert_eq!(
            err, boom,
            "must return the original {step} error, got {err:?}"
        );
        assert!(
            leftover_tmp(dir.path()).is_empty(),
            "{step}: tmp left behind {:?}",
            leftover_tmp(dir.path())
        );
        assert_eq!(
            fs::read_to_string(&dest).unwrap(),
            "OLD",
            "{step} changed the original file"
        );
        assert!(
            io.log.borrow().iter().any(|s| *s == "remove_tmp"),
            "{step}: cleanup was not attempted: {:?}",
            io.log.borrow()
        );
    }

    #[test]
    fn atomic_create_failure_returns_original_and_cleans_tmp() {
        assert_before_rename_failed("create");
    }

    #[test]
    fn atomic_write_failure_returns_original_and_cleans_tmp() {
        assert_before_rename_failed("write");
    }

    #[test]
    fn atomic_fsync_file_failure_returns_original_and_cleans_tmp() {
        assert_before_rename_failed("fsync_file");
    }

    #[test]
    fn atomic_rename_failure_returns_original_and_cleans_tmp() {
        assert_before_rename_failed("rename");
    }

    #[test]
    fn atomic_fsync_dir_failure_returns_original_and_tmp_is_gone() {
        let (dir, dest) = planted("note.md");
        let io = Script::failing("fsync_dir");
        let boom = io.fail.clone().unwrap();
        let err = atomic_replace(&dest, "NEW", &io).expect_err("fsync_dir");
        assert_eq!(
            err, boom,
            "must return the original fsync_dir error, got {err:?}"
        );
        assert!(
            leftover_tmp(dir.path()).is_empty(),
            "fsync_dir: tmp left behind {:?}",
            leftover_tmp(dir.path())
        );
        assert!(
            io.log.borrow().iter().any(|s| *s == "remove_tmp"),
            "cleanup was not attempted: {:?}",
            io.log.borrow()
        );
    }

    #[test]
    fn atomic_cleanup_failure_does_not_mask_original_error() {
        let (_dir, dest) = planted("note.md");
        let boom = IoStep {
            step: "write",
            detail: "boom-write".into(),
        };
        let cleanup = IoStep {
            step: "remove_tmp",
            detail: "boom-cleanup".into(),
        };
        let io = Script {
            fail: Some(boom.clone()),
            cleanup_fail: Some(cleanup.clone()),
            einval_dir: false,
            log: RefCell::new(Vec::new()),
        };
        let err = atomic_replace(&dest, "NEW", &io).expect_err("write");
        assert_eq!(err, boom, "cleanup error masked the original: {err:?}");
        assert_ne!(err, cleanup);
        assert!(
            io.log.borrow().iter().any(|s| *s == "remove_tmp"),
            "cleanup was not attempted: {:?}",
            io.log.borrow()
        );
        assert_eq!(fs::read_to_string(&dest).unwrap(), "OLD");
    }

    #[test]
    fn atomic_success_fsyncs_file_before_rename_and_leaves_no_tmp() {
        let (dir, dest) = planted("note.md");
        let io = Script::ok();
        atomic_replace(&dest, "NEW", &io).expect("atomic write");
        let log = io.log.borrow().clone();
        let fsync_file = log
            .iter()
            .position(|s| *s == "fsync_file")
            .unwrap_or_else(|| panic!("no fsync_file before rename: {log:?}"));
        let rename = log
            .iter()
            .position(|s| *s == "rename")
            .unwrap_or_else(|| panic!("no rename: {log:?}"));
        let fsync_dir = log
            .iter()
            .position(|s| *s == "fsync_dir")
            .unwrap_or_else(|| panic!("no fsync_dir: {log:?}"));
        assert!(
            fsync_file < rename,
            "fsync(file) must precede rename: {log:?}"
        );
        assert!(rename < fsync_dir, "fsync(dir) must follow rename: {log:?}");
        assert!(leftover_tmp(dir.path()).is_empty(), "leftover tmp: {log:?}");
        assert_eq!(fs::read_to_string(&dest).unwrap(), "NEW");
    }

    #[test]
    fn atomic_dir_fsync_einval_is_success_and_was_attempted() {
        let (dir, dest) = planted("note.md");
        let io = Script {
            fail: None,
            cleanup_fail: None,
            einval_dir: true,
            log: RefCell::new(Vec::new()),
        };
        atomic_replace(&dest, "NEW", &io).expect("EINVAL on dir fsync is success");
        assert!(
            io.log.borrow().iter().any(|s| *s == "fsync_dir"),
            "dir fsync was not attempted: {:?}",
            io.log.borrow()
        );
        assert_eq!(fs::read_to_string(&dest).unwrap(), "NEW");
        assert!(leftover_tmp(dir.path()).is_empty());
    }

    #[test]
    fn write_success_leaves_no_tmp_in_the_same_directory() {
        let root = mkdtemp("lc-write");
        fs::create_dir_all(root.path().join("cards")).unwrap();
        write(root.path(), "cards/a.md", "body").unwrap();
        assert_eq!(
            fs::read_to_string(root.path().join("cards/a.md")).unwrap(),
            "body"
        );
        assert!(leftover_tmp(&root.path().join("cards")).is_empty());
    }
}
