//! §11b 原子寫入(T2c-1 驗收 C9、9a;測試 agent 寫的,實作者不要改)。
//!
//! 介面(工單 9a:注入只在 syscall 層,判斷不能被替身覆寫):
//!   - `WriteIo` 每個方法對應 T7 共用向量的一個 inject.call:
//!     open_tmp=open:tmp、write=write、fsync_file=fsync:file、close_file=close:file、rename=rename、
//!     open_dir=open:dir、fsync_dir=fsync:dir、close_dir=close:dir、unlink=unlink。
//!   - `IoStep { step, error }`:step 是上面那串名字,error 是原始的 `io::Error`(不是字串)。
//!   - `dir_fsync_is_unsupported(&io::Error) -> bool` 是普通函式,不在 trait 上,用 `libc::EINVAL` 比對。
//!
//! 第一部分逐列跑 `packages/core/src/schema/atomic-write.vectors.json`(TS 的 writeFileAtomic 跑同一份)。
//! 第二部分是 T2b 修正輪寫在 `src/learning_fs.rs` 的原子寫入測試,搬過來、改成 syscall 層的替身。
//! 第三部分是 9a:EINVAL 判斷本身。

#![cfg(unix)]

mod common;

use std::cell::RefCell;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};

use common::TempDir;
use learning_cards_desktop::learning_fs::{atomic_replace, dir_fsync_is_unsupported, IoStep, StdWriteIo, WriteIo};
use serde_json::Value;

const VECTORS: &str = include_str!("../../../../packages/core/src/schema/atomic-write.vectors.json");

/// 跟 TS harness(atomic-write.vectors.test.ts 的 VECTOR_NAMES)同一份清單。
/// 向量檔少一列、改名、多一列,這份對不上就紅;Rust 不得自己新增或略過任何一列。
const VECTOR_NAMES: &[&str] = &[
    "syscall-order",
    "stale-tmp-overwritten",
    "old-style-stray-cleaned",
    "other-tmp-untouched",
    "rename-exdev",
    "rename-and-cleanup-both-fail",
    "dir-fsync-einval",
    "dir-fsync-eio",
    "dir-fsync-enospc",
    "fds-closed-on-success",
    "fds-closed-on-dir-fsync-error",
];

/// 向量的每一個欄位都要被這個 harness 讀到;向量檔加了新欄位而這裡不認得,就紅。
const KNOWN_EXPECT_KEYS: &[&str] = &[
    "outcome",
    "code",
    "identity",
    "remaining",
    "target_bytes",
    "absent",
    "untouched",
    "order",
    "tmp_basename",
    "fds_closed",
    "open_count",
    "cleanup_attempted",
    "saw_calls",
];

fn errno_of(name: &str) -> i32 {
    match name {
        "EXDEV" => libc::EXDEV,
        "EPERM" => libc::EPERM,
        "EINVAL" => libc::EINVAL,
        "EIO" => libc::EIO,
        "ENOSPC" => libc::ENOSPC,
        "EACCES" => libc::EACCES,
        "ENOENT" => libc::ENOENT,
        other => panic!("unknown errno name {other:?} in the vector file"),
    }
}

enum Fault {
    Errno(i32),
    Message(String),
}

impl Fault {
    fn make(&self) -> io::Error {
        match self {
            Fault::Errno(code) => io::Error::from_raw_os_error(*code),
            Fault::Message(m) => io::Error::other(m.clone()),
        }
    }
}

/// syscall 層的替身:每個方法先記一筆,再看要不要注入,不注入就做真的那一個 syscall。
/// 判斷(EINVAL 算不算成功)不在這裡,一律走 learning_fs 的 dir_fsync_is_unsupported。
struct Recorder {
    injects: Vec<(String, u32, Fault)>,
    seen: RefCell<HashMap<&'static str, u32>>,
    calls: RefCell<Vec<&'static str>>,
    opened: RefCell<Vec<(i32, PathBuf)>>,
    closed: RefCell<Vec<i32>>,
    tmp_paths: RefCell<Vec<PathBuf>>,
}

impl Recorder {
    fn new() -> Self {
        Recorder {
            injects: Vec::new(),
            seen: RefCell::new(HashMap::new()),
            calls: RefCell::new(Vec::new()),
            opened: RefCell::new(Vec::new()),
            closed: RefCell::new(Vec::new()),
            tmp_paths: RefCell::new(Vec::new()),
        }
    }

    fn inject(mut self, call: &str, nth: u32, fault: Fault) -> Self {
        self.injects.push((call.to_string(), nth, fault));
        self
    }

    fn step(&self, call: &'static str) -> io::Result<()> {
        self.calls.borrow_mut().push(call);
        let mut seen = self.seen.borrow_mut();
        let n = seen.entry(call).or_insert(0);
        *n += 1;
        let nth = *n;
        drop(seen);
        for (c, at, fault) in &self.injects {
            if c == call && *at == nth {
                return Err(fault.make());
            }
        }
        Ok(())
    }

    fn calls(&self) -> Vec<&'static str> {
        self.calls.borrow().clone()
    }

    fn still_open(&self) -> Vec<String> {
        let closed = self.closed.borrow();
        let mut remaining: Vec<i32> = closed.clone();
        let mut open = Vec::new();
        for (fd, path) in self.opened.borrow().iter() {
            if let Some(pos) = remaining.iter().position(|c| c == fd) {
                remaining.remove(pos);
            } else {
                open.push(format!("{fd}={}", path.display()));
            }
        }
        open
    }
}

impl WriteIo for Recorder {
    fn open_tmp(&self, tmp: &Path) -> io::Result<File> {
        self.step("open:tmp")?;
        self.tmp_paths.borrow_mut().push(tmp.to_path_buf());
        let f = OpenOptions::new().write(true).create(true).truncate(true).open(tmp)?;
        self.opened.borrow_mut().push((f.as_raw_fd(), tmp.to_path_buf()));
        Ok(f)
    }

    fn write(&self, file: &mut File, bytes: &[u8]) -> io::Result<()> {
        self.step("write")?;
        file.write_all(bytes)
    }

    fn fsync_file(&self, file: &File) -> io::Result<()> {
        self.step("fsync:file")?;
        file.sync_all()
    }

    fn close_file(&self, file: File) -> io::Result<()> {
        self.closed.borrow_mut().push(file.as_raw_fd());
        self.step("close:file")?;
        drop(file);
        Ok(())
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        self.step("rename")?;
        fs::rename(from, to)
    }

    fn open_dir(&self, dir: &Path) -> io::Result<File> {
        self.step("open:dir")?;
        let f = File::open(dir)?;
        self.opened.borrow_mut().push((f.as_raw_fd(), dir.to_path_buf()));
        Ok(f)
    }

    fn fsync_dir(&self, dir: &File) -> io::Result<()> {
        self.step("fsync:dir")?;
        // tmpfs 之類的檔案系統本來就回 EINVAL;原樣往上交,讓 learning_fs 自己判斷。
        dir.sync_all()
    }

    fn close_dir(&self, dir: File) -> io::Result<()> {
        self.closed.borrow_mut().push(dir.as_raw_fd());
        self.step("close:dir")?;
        drop(dir);
        Ok(())
    }

    fn unlink(&self, path: &Path) -> io::Result<()> {
        self.step("unlink")?;
        fs::remove_file(path)
    }
}

fn vectors() -> Vec<Value> {
    let doc: Value = serde_json::from_str(VECTORS).expect("vector file is JSON");
    doc["vectors"].as_array().expect("vectors array").clone()
}

fn names_in_dir(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap_or_else(|| panic!("expected an array, got {v}"))
        .iter()
        .map(|s| s.as_str().unwrap_or_else(|| panic!("expected a string, got {s}")).to_string())
        .collect()
}

/// 跑一列,回傳不符合的地方(空 = 這列通過)。
fn run_vector(row: &Value) -> Vec<String> {
    let name = row["name"].as_str().unwrap().to_string();
    let mut problems = Vec::new();
    let dir = TempDir::new("vec");
    let setup = &row["setup"];
    let target_name = setup["target"].as_str().unwrap();
    let target = dir.path().join(target_name);
    if let Some(prior) = setup["prior_target"].as_str() {
        fs::write(&target, prior).unwrap();
    }
    for extra in setup["extra_files"].as_array().unwrap() {
        fs::write(dir.path().join(extra["name"].as_str().unwrap()), extra["bytes"].as_str().unwrap()).unwrap();
    }

    let mut io = Recorder::new();
    for inj in row["inject"].as_array().unwrap() {
        let call = inj["call"].as_str().unwrap();
        let nth = inj["nth"].as_u64().unwrap() as u32;
        let code = errno_of(inj["code"].as_str().unwrap());
        io = io.inject(call, nth, Fault::Errno(code));
    }

    let content = setup["content"].as_str().unwrap();
    let result = atomic_replace(&target, content, &io);
    let expect = &row["expect"];
    for key in expect.as_object().unwrap().keys() {
        if !KNOWN_EXPECT_KEYS.contains(&key.as_str()) {
            problems.push(format!("expect.{key} is not handled by the Rust harness"));
        }
    }

    match (expect["outcome"].as_str(), &result) {
        (Some("ok"), Ok(())) => {}
        (Some("ok"), Err(e)) => problems.push(format!("expected ok, got error step={} error={}", e.step, e.error)),
        (Some("error"), Ok(())) => problems.push("expected an error, got ok".into()),
        (Some("error"), Err(e)) => {
            if let Some(code) = expect["code"].as_str() {
                if e.error.raw_os_error() != Some(errno_of(code)) {
                    problems.push(format!("expected errno {code}, got {:?} ({})", e.error.raw_os_error(), e.error));
                }
            }
            if let Some(identity) = expect["identity"].as_str() {
                if e.step != identity {
                    problems.push(format!("the error thrown must be the one injected at {identity}, got step {}", e.step));
                }
            }
        }
        (other, _) => problems.push(format!("bad expect.outcome {other:?}")),
    }

    let remaining = {
        let mut r = strings(&expect["remaining"]);
        r.sort();
        r
    };
    let actual = names_in_dir(dir.path());
    if actual != remaining {
        problems.push(format!("remaining files {actual:?}, expected {remaining:?}"));
    }
    match expect["target_bytes"].as_str() {
        None => {
            if target.exists() {
                problems.push("target must not exist".into());
            }
        }
        Some(bytes) => match fs::read_to_string(&target) {
            Ok(got) if got == bytes => {}
            Ok(got) => problems.push(format!("target holds {got:?}, expected {bytes:?}")),
            Err(e) => problems.push(format!("target unreadable: {e}")),
        },
    }
    if let Some(absent) = expect.get("absent") {
        for n in strings(absent) {
            if dir.path().join(&n).exists() {
                problems.push(format!("{n} must not be left behind"));
            }
        }
    }
    if let Some(untouched) = expect.get("untouched").and_then(Value::as_array) {
        for f in untouched {
            let n = f["name"].as_str().unwrap();
            let want = f["bytes"].as_str().unwrap();
            match fs::read_to_string(dir.path().join(n)) {
                Ok(got) if got == want => {}
                other => problems.push(format!("{n} must stay {want:?}, got {other:?}")),
            }
        }
    }
    let calls = io.calls();
    if let Some(order) = expect.get("order") {
        let wanted = strings(order);
        let actual: Vec<String> = calls
            .iter()
            .filter(|c| wanted.iter().any(|w| w == *c))
            .map(|c| c.to_string())
            .collect();
        if actual != wanted {
            problems.push(format!("order {actual:?}, expected {wanted:?} (all calls: {calls:?})"));
        }
    }
    if let Some(tmp) = expect["tmp_basename"].as_str() {
        match io.tmp_paths.borrow().first() {
            None => problems.push("no tmp file was opened".into()),
            Some(p) => {
                if p != &dir.path().join(tmp) {
                    problems.push(format!("tmp opened at {}, expected {}", p.display(), dir.path().join(tmp).display()));
                }
            }
        }
    }
    if expect["fds_closed"].as_bool() == Some(true) {
        let open = io.still_open();
        if !open.is_empty() {
            problems.push(format!("not closed through WriteIo: {open:?}"));
        }
    }
    if let Some(n) = expect["open_count"].as_u64() {
        let opens = io.opened.borrow().len() as u64;
        if opens != n {
            problems.push(format!("opened {opens} times, expected {n}"));
        }
    }
    if expect["cleanup_attempted"].as_bool() == Some(true) && !calls.contains(&"unlink") {
        problems.push(format!("cleanup was not attempted: {calls:?}"));
    }
    if let Some(saw) = expect.get("saw_calls") {
        for c in strings(saw) {
            if !calls.iter().any(|x| *x == c) {
                problems.push(format!("never called {c}: {calls:?}"));
            }
        }
    }
    problems.into_iter().map(|p| format!("{name}: {p}")).collect()
}

// ---------------------------------------------------------------- 第一部分:共用向量

#[test]
fn vector_rows_are_the_same_list_as_the_typescript_harness() {
    let names: Vec<String> = vectors().iter().map(|r| r["name"].as_str().unwrap().to_string()).collect();
    assert_eq!(names, VECTOR_NAMES, "atomic-write.vectors.json rows changed; Rust may not add or skip a row");
    for row in vectors() {
        assert!(row["inject"].is_array(), "{} has no inject array", row["name"]);
        assert!(row["expect"]["remaining"].is_array(), "{} has no expect.remaining", row["name"]);
        assert!(row["expect"].get("code").is_some(), "{} has no expect.code", row["name"]);
        assert!(row["expect"].get("target_bytes").is_some(), "{} has no expect.target_bytes", row["name"]);
    }
}

#[test]
fn every_shared_vector_row_behaves_the_same_in_rust() {
    let mut problems = Vec::new();
    let mut ran = 0;
    for row in vectors() {
        ran += 1;
        problems.extend(run_vector(&row));
    }
    assert_eq!(ran, VECTOR_NAMES.len());
    assert!(problems.is_empty(), "{} problems:\n{}", problems.len(), problems.join("\n"));
}

/// 正式實作(StdWriteIo)也要跑無注入的那幾列:替身做得對、真的那份做錯,這條才抓得到。
#[test]
fn std_write_io_passes_the_rows_without_injection() {
    for row in vectors() {
        if !row["inject"].as_array().unwrap().is_empty() {
            continue;
        }
        let name = row["name"].as_str().unwrap();
        let dir = TempDir::new("vec-std");
        let setup = &row["setup"];
        let target = dir.path().join(setup["target"].as_str().unwrap());
        if let Some(prior) = setup["prior_target"].as_str() {
            fs::write(&target, prior).unwrap();
        }
        for extra in setup["extra_files"].as_array().unwrap() {
            fs::write(dir.path().join(extra["name"].as_str().unwrap()), extra["bytes"].as_str().unwrap()).unwrap();
        }
        atomic_replace(&target, setup["content"].as_str().unwrap(), &StdWriteIo)
            .unwrap_or_else(|e| panic!("{name}: step={} error={}", e.step, e.error));
        let mut want = strings(&row["expect"]["remaining"]);
        want.sort();
        assert_eq!(names_in_dir(dir.path()), want, "{name}");
        assert_eq!(
            fs::read_to_string(&target).unwrap(),
            row["expect"]["target_bytes"].as_str().unwrap(),
            "{name}"
        );
    }
}

// ---------------------------------------------------------------- 第二部分:T2b 的原子寫入測試(搬過來)

fn planted(name: &str) -> (TempDir, PathBuf) {
    let dir = TempDir::new("atomic");
    let dest = dir.path().join(name);
    fs::write(&dest, "OLD").unwrap();
    (dir, dest)
}

fn leftover_tmp(dir: &Path) -> Vec<String> {
    names_in_dir(dir).into_iter().filter(|n| n.ends_with(".tmp")).collect()
}

fn assert_before_rename_failed(step: &'static str) {
    let (dir, dest) = planted("note.md");
    let io = Recorder::new().inject(step, 1, Fault::Message(format!("boom-{step}")));
    let err: IoStep = atomic_replace(&dest, "NEW", &io).expect_err(step);
    assert_eq!(err.step, step, "must return the original {step} error, got step {}", err.step);
    assert_eq!(err.error.to_string(), format!("boom-{step}"), "must return the original {step} error");
    assert!(leftover_tmp(dir.path()).is_empty(), "{step}: tmp left behind {:?}", leftover_tmp(dir.path()));
    assert_eq!(fs::read_to_string(&dest).unwrap(), "OLD", "{step} changed the original file");
    if step != "open:tmp" {
        assert!(io.calls().contains(&"unlink"), "{step}: cleanup was not attempted: {:?}", io.calls());
    }
    assert!(io.still_open().is_empty(), "{step}: fd left open {:?}", io.still_open());
}

#[test]
fn atomic_open_tmp_failure_returns_original_and_leaves_no_tmp() {
    assert_before_rename_failed("open:tmp");
}

#[test]
fn atomic_write_failure_returns_original_and_cleans_tmp() {
    assert_before_rename_failed("write");
}

#[test]
fn atomic_fsync_file_failure_returns_original_and_cleans_tmp() {
    assert_before_rename_failed("fsync:file");
}

#[test]
fn atomic_rename_failure_returns_original_and_cleans_tmp() {
    assert_before_rename_failed("rename");
}

#[test]
fn atomic_fsync_dir_failure_returns_original_and_tmp_is_gone() {
    let (dir, dest) = planted("note.md");
    let io = Recorder::new().inject("fsync:dir", 1, Fault::Errno(libc::EIO));
    let err = atomic_replace(&dest, "NEW", &io).expect_err("fsync:dir EIO");
    assert_eq!(err.step, "fsync:dir");
    assert_eq!(err.error.raw_os_error(), Some(libc::EIO));
    assert!(leftover_tmp(dir.path()).is_empty(), "fsync:dir: tmp left behind {:?}", leftover_tmp(dir.path()));
    assert_eq!(fs::read_to_string(&dest).unwrap(), "NEW", "rename already happened");
    assert!(io.still_open().is_empty(), "{:?}", io.still_open());
}

#[test]
fn atomic_cleanup_failure_does_not_mask_original_error() {
    let (_dir, dest) = planted("note.md");
    let io = Recorder::new()
        .inject("write", 1, Fault::Message("boom-write".into()))
        .inject("unlink", 1, Fault::Message("boom-cleanup".into()));
    let err = atomic_replace(&dest, "NEW", &io).expect_err("write");
    assert_eq!(err.step, "write", "cleanup error masked the original: {err:?}");
    assert_eq!(err.error.to_string(), "boom-write");
    assert!(io.calls().contains(&"unlink"), "cleanup was not attempted: {:?}", io.calls());
    assert_eq!(fs::read_to_string(&dest).unwrap(), "OLD");
}

#[test]
fn atomic_success_fsyncs_file_before_rename_and_dir_after() {
    let (dir, dest) = planted("note.md");
    let io = Recorder::new();
    atomic_replace(&dest, "NEW", &io).expect("atomic write");
    let log = io.calls();
    let pos = |s: &str| log.iter().position(|c| *c == s).unwrap_or_else(|| panic!("no {s}: {log:?}"));
    assert!(pos("fsync:file") < pos("rename"), "fsync(file) must precede rename: {log:?}");
    assert!(pos("rename") < pos("fsync:dir"), "fsync(dir) must follow rename: {log:?}");
    assert!(leftover_tmp(dir.path()).is_empty(), "leftover tmp: {log:?}");
    assert_eq!(fs::read_to_string(&dest).unwrap(), "NEW");
}

// ---------------------------------------------------------------- 第三部分:9a EINVAL 的判斷

#[test]
fn einval_is_the_only_unsupported_dir_fsync() {
    assert!(dir_fsync_is_unsupported(&io::Error::from_raw_os_error(libc::EINVAL)), "EINVAL means the file system cannot fsync a directory");
    for code in [libc::EIO, libc::ENOSPC, libc::EPERM, libc::EACCES, libc::EBADF, libc::EROFS, libc::EINVAL + 1, libc::EINVAL - 1] {
        assert!(
            !dir_fsync_is_unsupported(&io::Error::from_raw_os_error(code)),
            "errno {code} must not be treated as success"
        );
    }
    assert!(
        !dir_fsync_is_unsupported(&io::Error::other("EINVAL")),
        "only the OS error code counts, not a message that says EINVAL"
    );
    assert!(!dir_fsync_is_unsupported(&io::Error::from(io::ErrorKind::InvalidInput)), "InvalidInput without an OS code is not EINVAL");
}

/// 注入在 syscall 層(fsync_dir 回 EINVAL),判斷走真的函式:N4(永遠 false)、N11(換成別的碼)都會紅。
#[test]
fn injected_einval_at_dir_fsync_is_success_with_new_content() {
    let (dir, dest) = planted("reviews.json");
    let io = Recorder::new().inject("fsync:dir", 1, Fault::Errno(libc::EINVAL));
    atomic_replace(&dest, "NEW", &io).expect("EINVAL on dir fsync is success");
    assert!(io.calls().contains(&"fsync:dir"), "dir fsync was not attempted: {:?}", io.calls());
    assert_eq!(fs::read_to_string(&dest).unwrap(), "NEW");
    assert!(leftover_tmp(dir.path()).is_empty());
}

#[test]
fn injected_eio_and_enospc_at_dir_fsync_propagate() {
    for code in [libc::EIO, libc::ENOSPC] {
        let (_dir, dest) = planted("reviews.json");
        let io = Recorder::new().inject("fsync:dir", 1, Fault::Errno(code));
        let err = atomic_replace(&dest, "NEW", &io).expect_err("must not swallow");
        assert_eq!(err.error.raw_os_error(), Some(code), "the original error must come out: {}", err.error);
        assert_eq!(err.step, "fsync:dir");
        assert_eq!(fs::read_to_string(&dest).unwrap(), "NEW", "rename already happened");
    }
}

/// 判斷只能在 learning_fs 裡、以函式存在;trait 上不能有可以覆寫的判斷方法。
#[test]
fn the_einval_judgement_is_not_a_trait_method() {
    let src = include_str!("../src/learning_fs.rs");
    assert!(!src.contains("dir_fsync_unsupported"), "the overridable trait method dir_fsync_unsupported must be gone (T2b N4/N11)");
    assert!(src.contains("fn dir_fsync_is_unsupported"), "dir_fsync_is_unsupported must be a free function in learning_fs.rs");
    assert!(!src.contains("Some(22)"), "compare with libc::EINVAL, not the literal 22");
    assert!(src.contains("libc::EINVAL"), "use libc::EINVAL");
}
