//! path_guard 的測試(T2c-1 起放在獨立檔,只有測試 agent 改)。
//!
//! 前半段是 T2b 寫在 `src/path_guard.rs` 的 `mod tests`,**原樣搬過來**(工單 A' 4a:T2b 的既有 path_guard
//! 測試全綠、不改)。只改了 import:從 `use super::*` 換成 crate 的公開 API。
//! 後半段是 T2c-1 驗收 A' 4b–4c:段規則讀契約的共用向量 `contracts/fixtures/path-segment-vectors.json`。

#![cfg(unix)]

use learning_cards_desktop::path_guard::{check_rel_path, check_segment};
use unicode_normalization::is_nfc;

// ---------------------------------------------------------------- T2b(原樣)


fn refused(rel: &str) -> bool {
    check_rel_path(rel).is_err()
}

#[test]
fn traversal_and_junk_are_refused_without_conversion() {
    for p in [
        "../../etc/passwd",
        "cards/../../../etc/passwd",
        "/etc/passwd",
        "cards/./../../secret",
        "//etc/passwd",
        "..",
        "..%2f..%2fetc%2fpasswd",
        "..%2F..%2Fetc%2Fpasswd",
        "%2e%2e/%2e%2e/etc/passwd",
        "..%252f..%252fetc",
        "..\\..\\etc\\passwd",
        "cards\\..\\..\\secret",
        "\\etc\\passwd",
        "\\\\server\\share\\x",
        "C:\\Windows\\win.ini",
        "C:/Windows/win.ini",
        "file:///etc/passwd",
        "~/secret",
        " ../x",
        "cards/../state/reviews.json",
        "./cards/a.md",
        "cards//a.md",
        "cards/.hidden.md",
        "cards/",
        "",
        "cards/C++.md",
    ] {
        assert!(refused(p), "should refuse {p:?}");
    }
    assert!(refused("cards/a.md\0.png"));
}

#[test]
fn trailing_dot_reserved_raw_and_nfc() {
    assert!(refused("cards/a."));
    assert!(refused("nul.md"));
    assert!(refused("CON"));
    assert!(refused("cards/Aux.txt"));
    assert!(refused("com1.md"));
    assert!(refused("COM\u{00B9}.txt"));
    assert!(refused("LPT\u{00B2}.log"));
    assert!(refused("cards/Lpt3.md"));
    assert!(refused("raw/security/x.md"));
    assert!(refused("Raw/security/x.md"));
    assert!(refused("RAW/security/x.md"));
    assert!(refused("raw"));
    assert!(refused("Raw/security"));
    assert!(refused("cards/\u{1100}\u{1161}.md"));
    assert!(refused("cards/\u{F900}.md"));
    assert!(refused("cards/e\u{0301}.md"));
}

#[test]
fn allowed_vectors_pass_byte_for_byte() {
    for p in [
        "cards/a.md",
        "state/reviews.json",
        "cards/security/sec-0042.md",
        "assets/sec-0042-diagram.png",
        "assets/sec_0042_diagram.png",
        "cards/console.md",
        "cards/Security.md",
        "cards/\u{AC00}.md",
        "cards/\u{00E9}.md",
        "cards/\u{30BB}\u{30AD}\u{30E5}\u{30EA}\u{30C6}\u{30A3}\u{30FC}.md",
        "com0.md",
        "cards/lpt0.txt",
    ] {
        assert!(check_rel_path(p).is_ok(), "should allow {p:?}");
    }
}

#[test]
fn length_counts_utf8_bytes() {
    let ok_ascii = format!("cards/{}.md", "a".repeat(231));
    let bad_ascii = format!("cards/{}.md", "a".repeat(232));
    assert_eq!(ok_ascii.len(), 240);
    assert_eq!(bad_ascii.len(), 241);
    assert!(check_rel_path(&ok_ascii).is_ok());
    assert!(refused(&bad_ascii));
    let ok_hangul = format!("cards/{}.md", "\u{AC00}".repeat(77));
    let bad_hangul = format!("cards/{}.md", "\u{AC00}".repeat(78));
    assert_eq!(ok_hangul.len(), 240);
    assert_eq!(bad_hangul.len(), 243);
    assert!(check_rel_path(&ok_hangul).is_ok());
    assert!(refused(&bad_hangul));
}

#[test]
fn nfc_mark_names_are_allowed_and_each_mark_is_mn_or_mc() {
    use unicode_properties::{GeneralCategory, GeneralCategoryGroup, UnicodeGeneralCategory};

    let hindi = "cards/\u{0939}\u{093F}\u{0902}\u{0926}\u{0940}.md";
    let thai = "cards/\u{0E17}\u{0E35}\u{0E48}.md";
    assert!(is_nfc(hindi), "hindi vector must already be NFC");
    assert!(is_nfc(thai), "thai vector must already be NFC");
    assert_marks_are_mn_or_mc("\u{0939}\u{093F}\u{0902}\u{0926}\u{0940}");
    assert_marks_are_mn_or_mc("\u{0E17}\u{0E35}\u{0E48}");
    assert!(check_rel_path(hindi).is_ok(), "{hindi:?}");
    assert!(check_rel_path(thai).is_ok(), "{thai:?}");

    fn assert_marks_are_mn_or_mc(stem: &str) {
        let mut saw = false;
        for c in stem.chars() {
            if c.general_category_group() != GeneralCategoryGroup::Mark {
                continue;
            }
            saw = true;
            let cat = c.general_category();
            assert!(
                matches!(
                    cat,
                    GeneralCategory::NonspacingMark | GeneralCategory::SpacingMark
                ),
                "U+{:04X} is {:?}, not Mn/Mc",
                u32::from(c),
                cat
            );
        }
        assert!(saw, "vector has no Mn/Mc code point: {stem:?}");
    }
}

#[test]
fn all_28_reserved_names_are_refused_bare_and_nested() {
    let mut names = vec!["CON".to_string(), "PRN".into(), "AUX".into(), "NUL".into()];
    for n in 1..=9 {
        names.push(format!("COM{n}"));
        names.push(format!("LPT{n}"));
    }
    for s in ['\u{00B9}', '\u{00B2}', '\u{00B3}'] {
        names.push(format!("COM{s}"));
        names.push(format!("LPT{s}"));
    }
    assert_eq!(names.len(), 28, "{names:?}");
    for name in &names {
        assert!(refused(name), "bare {name}");
        assert!(refused(&format!("x/{name}.md")), "x/{name}.md");
    }
    assert!(refused("COM\u{00B3}"), "COM³");
    assert!(refused("LPT\u{00B3}"), "LPT³");
    assert!(refused("x/COM\u{00B3}.md"));
    assert!(refused("x/LPT\u{00B3}.md"));
    for ok in ["com0.md", "lpt0.md", "com10.md"] {
        assert!(check_rel_path(ok).is_ok(), "{ok} must pass");
    }
}

#[test]
fn ascii_punctuation_is_refused() {
    for p in [
        "cards/a b.md",
        "cards/a:b.md",
        "cards/a*b.md",
        "cards/a?b.md",
        "cards/a<b.md",
        "cards/a|b.md",
        "cards/a\"b.md",
        "cards/a+b.md",
        "cards/a(b).md",
    ] {
        assert!(refused(p), "{p:?}");
    }
}

// ---------------------------------------------------------------- T2c-1 A':共用段向量

/// 從 `apps/desktop/src-tauri/tests/` 往上四層是 repo 根。只讀,不寫。
const SEGMENT_VECTORS: &str = include_str!("../../../../contracts/fixtures/path-segment-vectors.json");

/// 向量檔一改(加、刪、改一列,或改說明),下面四個數字至少一個對不上。
/// 改向量檔的人必須同時更新這裡,也就會看到 Rust 的段測試。
const PINNED_SHA256: &str = "71dded0ecbe5376fdb9adbe417f82e0d27d756d7256d359c6516e75e8ac7a1c6";
const PINNED_TOTAL_ROWS: usize = 51;
const PINNED_SEGMENT_ROWS: usize = 47;
const PINNED_IGNORED_ROWS: usize = 4;
const PINNED_RULE_COUNTS: &[(&str, usize)] = &[
    ("charset", 21),
    ("reserved", 15),
    ("nfc", 5),
    ("length", 4),
    ("leading-dot", 3),
    ("empty", 1),
    ("separator", 1),
    ("trailing-dot", 1),
];

fn vectors() -> Vec<serde_json::Value> {
    let doc: serde_json::Value = serde_json::from_str(SEGMENT_VECTORS).expect("vector file is JSON");
    doc["vectors"]
        .as_array()
        .expect("vector file has a vectors array")
        .clone()
}

/// 用 `applies_to` 選列,不用 `rule`(向量檔說明:沒列在 applies_to 的檢查必須忽略該列)。
fn applies_to_segment(row: &serde_json::Value) -> bool {
    row["applies_to"]
        .as_array()
        .unwrap_or_else(|| panic!("row without applies_to: {row}"))
        .iter()
        .any(|v| v == "segment")
}

#[test]
fn segment_vector_file_is_the_pinned_one() {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(SEGMENT_VECTORS.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, PINNED_SHA256, "path-segment-vectors.json changed; update the pinned numbers and re-check the Rust segment rules");

    let rows = vectors();
    assert_eq!(rows.len(), PINNED_TOTAL_ROWS, "total rows");
    let mut counts = std::collections::BTreeMap::<String, usize>::new();
    for row in &rows {
        let rule = row["rule"].as_str().unwrap_or_else(|| panic!("row without rule: {row}"));
        *counts.entry(rule.to_string()).or_default() += 1;
    }
    let pinned: std::collections::BTreeMap<String, usize> =
        PINNED_RULE_COUNTS.iter().map(|(k, v)| (k.to_string(), *v)).collect();
    assert_eq!(counts, pinned, "rows per rule");
    assert_eq!(
        doc_unicode_version(),
        "15.0.0",
        "unicode_version_used_to_verify changed; T2c-1 4d says stop and report, do not edit the vectors"
    );
}

fn doc_unicode_version() -> String {
    let doc: serde_json::Value = serde_json::from_str(SEGMENT_VECTORS).unwrap();
    doc["unicode_version_used_to_verify"].as_str().unwrap_or("").to_string()
}

#[test]
fn rust_segment_check_agrees_with_every_shared_segment_row() {
    let rows = vectors();
    let mut ran = 0usize;
    let mut ignored = 0usize;
    let mut wrong = Vec::new();
    for row in &rows {
        if !applies_to_segment(row) {
            ignored += 1;
            continue;
        }
        ran += 1;
        let seg = row["segment"].as_str().unwrap_or_else(|| panic!("row without segment: {row}"));
        let expect_accept = match row["expect"].as_str() {
            Some("accept") => true,
            Some("refuse") => false,
            other => panic!("expect must be accept or refuse, got {other:?} in {row}"),
        };
        let got = check_segment(seg);
        if got.is_ok() != expect_accept {
            wrong.push(format!(
                "segment {seg:?} (rule {}) expected {} got {got:?}",
                row["rule"],
                row["expect"]
            ));
        }
    }
    assert_eq!(ran, PINNED_SEGMENT_ROWS, "rows with applies_to containing segment");
    assert_eq!(ignored, PINNED_IGNORED_ROWS, "rows ignored because applies_to has no segment");
    assert!(wrong.is_empty(), "{} rows disagree:\n{}", wrong.len(), wrong.join("\n"));
}

/// 被忽略的 4 列都是 64/65 位元組的長度列,只對 CategoryId 成立。對 §13 的段,它們全都合法
/// (§13 只限制整條 relPath 240 位元組)。段檢查若加了 64 上限,65 位元組那兩列會被拒絕。
#[test]
fn segment_check_has_no_64_byte_limit() {
    for row in vectors().iter().filter(|r| !applies_to_segment(r)) {
        let seg = row["segment"].as_str().unwrap();
        assert!(
            check_segment(seg).is_ok(),
            "{} bytes {seg:?} must be a legal path segment (64 is the CategoryId limit, not a segment rule)",
            seg.len()
        );
    }
}

/// check_rel_path 對每一段呼叫 check_segment:單段的路徑兩邊結論相同(raw 例外,那是整條路徑的規則)。
#[test]
fn check_rel_path_and_check_segment_agree_on_single_segments() {
    for row in vectors().iter().filter(|r| applies_to_segment(r)) {
        let seg = row["segment"].as_str().unwrap();
        if seg.contains('/') || seg.is_empty() {
            continue;
        }
        assert_eq!(
            check_rel_path(seg).is_ok(),
            check_segment(seg).is_ok(),
            "{seg:?}: check_rel_path and check_segment disagree"
        );
    }
}
