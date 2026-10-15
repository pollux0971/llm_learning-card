//! learning_fs 的測試(T2c-1 起放在獨立檔,只有測試 agent 改)。
//!
//! 前半段是 T2b 寫在 `src/learning_fs.rs` 的 `mod tests`(讀、拒絕、symlink、懸空 symlink),搬過來。
//! 改的只有兩處,都是工單要求:
//!   - 錯誤不再只有 `Refusal`:T2c-1 驗收 D 要 io 錯誤和拒絕分得出來,所以斷言改成看錯誤在邊界上的 JSON
//!     (`{"kind":"refused","reason":...}`),reason 的值不變;
//!   - 暫存目錄改用 tests/common 的 TempDir(原本寫死 `/tmp/opencode`,換一台機器就不存在)。
//! §11b 原子寫入的舊測試搬到 tests/atomic_write.rs(trait 改成 syscall 層,見工單 9a)。
//!
//! 後半段是 T2c-1 新增:驗收 B5(拒絕寫一行 warning、io 錯誤與成功不寫)、D11(io 錯誤分類)、C10(每個路徑都走原子寫入)。

#![cfg(unix)]

mod common;

use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};

use common::{assert_warning_line, io_code, is_root_user, refusal_reason, wire, Learning, TempDir};
use learning_cards_desktop::learning_fs::{exists, list, read, write};

// ---------------------------------------------------------------- T2b(搬過來)

#[test]
fn allowed_read_records_the_original_string() {
    let l = Learning::new("read-ok");
    l.plant("cards/a.md", b"hi");
    let out = read(&l.root, "cards/a.md").unwrap();
    assert_eq!(out.fs_calls[0].path, "cards/a.md");
    assert_eq!(out.value, serde_json::json!("hi"));
}

#[test]
fn refused_path_does_not_touch_the_fs() {
    let l = Learning::new("read-refused");
    let err = read(&l.root, "..\\..\\etc\\passwd").unwrap_err();
    assert_eq!(refusal_reason(&err), "structure");
}

#[test]
fn symlink_out_is_refused_and_whitelist_still_allows_a_normal_file() {
    let l = Learning::new("symlink-out");
    l.plant("cards/a.md", b"in");
    symlink(l.outside.join("secret"), l.root.join("cards/link.md")).unwrap();
    assert!(read(&l.root, "cards/link.md").is_err());
    assert!(read(&l.root, "cards/a.md").is_ok());
}

fn plant_dangling(l: &Learning, rel: &str) -> std::path::PathBuf {
    let full = l.root.join(rel);
    fs::create_dir_all(full.parent().unwrap()).unwrap();
    let target = l.outside.join("new");
    symlink(&target, &full).unwrap();
    assert!(!target.exists(), "fixture target must not exist yet");
    target
}

#[test]
fn dangling_symlink_write_is_refused_and_does_not_create_outside() {
    let l = Learning::new("dangle-write");
    let target = plant_dangling(&l, "cards/evil.md");
    let result = write(&l.root, "cards/evil.md", "x");
    let created = target.exists();
    let err = result.expect_err("dangling write must be refused");
    assert_eq!(refusal_reason(&err), "symlink");
    assert!(!created, "outside target was created: {}", target.display());
}

#[test]
fn dangling_symlink_read_is_refused() {
    let l = Learning::new("dangle-read");
    let target = plant_dangling(&l, "cards/evil.md");
    let err = read(&l.root, "cards/evil.md").expect_err("dangling read must be refused");
    assert_eq!(refusal_reason(&err), "symlink");
    assert!(!target.exists());
}

#[test]
fn dangling_symlink_exists_is_refused() {
    let l = Learning::new("dangle-exists");
    let target = plant_dangling(&l, "cards/evil.md");
    let err = exists(&l.root, "cards/evil.md").expect_err("dangling exists must be refused");
    assert_eq!(refusal_reason(&err), "symlink");
    assert!(!target.exists());
}

#[test]
fn dangling_symlink_list_is_refused() {
    let l = Learning::new("dangle-list");
    let target = plant_dangling(&l, "cards/evil.md");
    let err = list(&l.root, "cards/evil.md").expect_err("dangling list must be refused");
    assert_eq!(refusal_reason(&err), "symlink");
    assert!(!target.exists());
}

#[test]
fn write_success_leaves_no_tmp_in_the_same_directory() {
    let l = Learning::new("write-ok");
    fs::create_dir_all(l.root.join("cards")).unwrap();
    write(&l.root, "cards/a.md", "body").unwrap();
    assert_eq!(fs::read_to_string(l.root.join("cards/a.md")).unwrap(), "body");
    let leftovers: Vec<_> = fs::read_dir(l.root.join("cards"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

// ---------------------------------------------------------------- T2c-1 B5:拒絕寫一行 warning

#[test]
fn each_refusal_appends_exactly_one_warning_line() {
    let l = Learning::new("warn-each");
    l.plant("raw/security/x.md", b"SECRET");
    let before = l.log_lines().len();
    let r = read(&l.root, "raw/security/x.md").expect_err("raw read");
    assert_eq!(refusal_reason(&r), "raw");
    let w = write(&l.root, "raw/security/x.md", "x").expect_err("raw write");
    assert_eq!(refusal_reason(&w), "raw");
    let e = exists(&l.root, "raw/security/x.md").expect_err("raw exists");
    assert_eq!(refusal_reason(&e), "raw");
    let s = list(&l.root, "raw").expect_err("raw list");
    assert_eq!(refusal_reason(&s), "raw");
    let lines = l.log_lines();
    assert_eq!(lines.len(), before + 4, "one line per refusal, not rate limited: {lines:?}");
    assert_warning_line(&lines[before], "raw/security/x.md");
    assert_warning_line(&lines[before + 1], "raw/security/x.md");
    assert_warning_line(&lines[before + 2], "raw/security/x.md");
    assert_warning_line(&lines[before + 3], "raw");
    assert_eq!(fs::read(l.root.join("raw/security/x.md")).unwrap(), b"SECRET");
}

#[test]
fn the_same_refusal_three_times_writes_three_lines() {
    let l = Learning::new("warn-three");
    for _ in 0..3 {
        read(&l.root, "raw/x.md").expect_err("raw read");
    }
    assert_eq!(l.log_lines().len(), 3, "command refusals are never rate limited");
}

#[test]
fn a_successful_read_writes_no_line() {
    let l = Learning::new("warn-none-ok");
    l.plant("cards/a.md", b"hi");
    read(&l.root, "cards/a.md").unwrap();
    assert_eq!(l.log_text(), "");
}

#[test]
fn an_io_error_writes_no_line() {
    let l = Learning::new("warn-none-io");
    read(&l.root, "cards/missing.md").expect_err("missing file");
    assert_eq!(l.log_text(), "", "an io error is not a refusal");
}

#[test]
fn a_nul_in_the_path_is_escaped_and_stays_one_line() {
    let l = Learning::new("warn-nul");
    let rel = "cards/a.md\u{0}.png";
    let err = read(&l.root, rel).expect_err("NUL must be refused");
    assert_eq!(refusal_reason(&err), "structure");
    let text = l.log_text();
    assert!(text.contains("\\u0000"), "NUL must be JSON-escaped: {text:?}");
    assert!(!text.contains('\u{0}'), "raw NUL byte in the log");
    let lines = l.log_lines();
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_warning_line(&lines[0], rel);
}

// ---------------------------------------------------------------- T2c-1 D11:io 錯誤分類

#[test]
fn read_missing_file_is_io_not_found() {
    let l = Learning::new("io-missing");
    let err = read(&l.root, "cards/missing.md").expect_err("missing file must not read as empty");
    assert_eq!(io_code(&err), "not_found", "{}", wire(&err));
}

#[test]
fn read_directory_is_io_is_dir() {
    let l = Learning::new("io-dir");
    fs::create_dir_all(l.root.join("cards")).unwrap();
    let err = read(&l.root, "cards").expect_err("a directory is not a file");
    assert_eq!(io_code(&err), "is_dir", "{}", wire(&err));
}

#[test]
fn read_unreadable_file_is_io_permission() {
    if is_root_user() {
        eprintln!("SKIPPED read_unreadable_file_is_io_permission: running as root, mode 000 does not stop root");
        return;
    }
    let l = Learning::new("io-perm");
    let full = l.plant("cards/locked.md", b"secret");
    fs::set_permissions(&full, fs::Permissions::from_mode(0o000)).unwrap();
    let err = read(&l.root, "cards/locked.md").expect_err("mode 000");
    assert_eq!(io_code(&err), "permission", "{}", wire(&err));
    assert_eq!(l.log_text(), "", "permission is an io error, not a refusal");
}

#[test]
fn read_invalid_utf8_is_io_not_utf8() {
    let l = Learning::new("io-utf8");
    l.plant("cards/bad.md", &[0xFF, 0xFE, 0x00]);
    let err = read(&l.root, "cards/bad.md").expect_err("invalid UTF-8 must not be converted");
    assert_eq!(io_code(&err), "not_utf8", "{}", wire(&err));
    assert_eq!(l.log_text(), "");
}

#[test]
fn exists_on_a_legal_missing_path_is_false() {
    let l = Learning::new("exists-missing");
    let out = exists(&l.root, "cards/missing.md").expect("not an error");
    assert_eq!(out.value, serde_json::json!(false));
    assert_eq!(l.log_text(), "");
}

#[test]
fn list_of_a_missing_directory_is_io_not_found() {
    let l = Learning::new("list-missing");
    let err = list(&l.root, "cards/nope").expect_err("missing directory");
    assert_eq!(io_code(&err), "not_found", "{}", wire(&err));
    assert_eq!(l.log_text(), "");
}

/// 「讀不到 metadata 的條目」:懸空 symlink(跟隨後 stat 失敗)。§13:不通過的條目略過,不丟錯。
#[test]
fn list_skips_an_entry_whose_metadata_cannot_be_read() {
    let l = Learning::new("list-skip");
    l.plant("cards/ok.md", b"yes");
    symlink(l.parent.path().join("nowhere"), l.root.join("cards/ghost.md")).unwrap();
    let out = list(&l.root, "cards").expect("list must not fail on one bad entry");
    assert_eq!(out.value, serde_json::json!(["ok.md"]));
}

// ---------------------------------------------------------------- T2c-1 C10:每個路徑都走同一份原子寫入

/// 同目錄有上一次留下的 `<name>.tmp`:原子寫入會開它(截斷)再 rename 掉;直接 fs::write 會把它留下。
#[test]
fn write_outside_state_also_goes_through_the_atomic_write() {
    for rel in ["state/reviews.json", "cards/a.md", "questions/a.yaml"] {
        let l = Learning::new("atomic-everywhere");
        let stale = l.plant(&format!("{rel}.tmp"), b"stale");
        write(&l.root, rel, "NEW").unwrap_or_else(|e| panic!("{rel}: {}", wire(&e)));
        assert_eq!(fs::read_to_string(l.root.join(rel)).unwrap(), "NEW", "{rel}");
        assert!(!stale.exists(), "{rel}: the stale <name>.tmp is still there, so the write did not go through tmp + rename");
    }
}

#[test]
fn temp_dirs_are_distinct() {
    let a = TempDir::new("distinct");
    let b = TempDir::new("distinct");
    assert_ne!(a.path(), b.path());
}

// ---------------------------------------------------------------- 驗收補測(測試 agent,T2c-1 驗收時加)

/// worker 報告 §6 第 4 點:`guard` 只檢查 `rel`,不檢查 `rel.tmp`。有人在 learning/ 裡放一個指向根外的
/// `cards/a.md.tmp` symlink,`write("cards/a.md")` 如果跟著 symlink 開檔,內容就寫到根外。實作用 `O_NOFOLLOW`
/// 開暫存檔;原本沒有任何測試蓋到,拿掉它不會紅。
#[test]
fn write_does_not_follow_a_planted_tmp_symlink_out_of_the_root() {
    let l = Learning::new("tmp-symlink-new");
    l.plant("cards/a.md", b"old");
    let target = l.outside.join("escaped");
    symlink(&target, l.root.join("cards/a.md.tmp")).unwrap();
    assert!(!target.exists(), "fixture target must not exist yet");

    let err = write(&l.root, "cards/a.md", "new").expect_err("writing through a planted .tmp symlink must fail");

    assert!(!target.exists(), "the content was written outside the root through the .tmp symlink");
    assert_eq!(fs::read_to_string(l.root.join("cards/a.md")).unwrap(), "old", "the destination must be untouched");
    assert!(
        fs::symlink_metadata(l.root.join("cards/a.md.tmp")).is_err(),
        "cleanup must remove the planted symlink itself"
    );
    assert!(l.log_lines().is_empty(), "an io error is not a refusal: no warning event");
    assert_ne!(wire(&err)["kind"], "refused", "this is an io failure, not a path refusal");

    // 清掉之後同一個寫入就成功
    write(&l.root, "cards/a.md", "new").unwrap();
    assert_eq!(fs::read_to_string(l.root.join("cards/a.md")).unwrap(), "new");
}

#[test]
fn write_does_not_overwrite_an_existing_outside_file_through_a_planted_tmp_symlink() {
    let l = Learning::new("tmp-symlink-existing");
    l.plant("cards/a.md", b"old");
    let secret = l.outside.join("secret");
    symlink(&secret, l.root.join("cards/a.md.tmp")).unwrap();

    assert!(write(&l.root, "cards/a.md", "PWNED").is_err());

    assert_eq!(fs::read_to_string(&secret).unwrap(), "OUTSIDE-SENTINEL", "the outside file must keep its content");
    assert_eq!(fs::read_to_string(l.root.join("cards/a.md")).unwrap(), "old");
}
