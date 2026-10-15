//! §13 1.3.1 白名單。被檢查的字串與被使用的字串逐位元相同:這裡不轉換。
//!
//! 段的規則在 `check_segment`(契約 1.4.0 / ADR-067:§1 的 `CategoryId` 引用同一條段規則,
//! 兩份實作讀同一份 `contracts/fixtures/path-segment-vectors.json`)。`check_rel_path` 先看整條路徑
//! 的結構,再對每一段呼叫 `check_segment`,最後做只屬於整條路徑的規則(NFC、240 位元組、`raw/`)。
//!
//! 每一條檢查都是獨立函式,呼叫點在 `check_segment` 或 `check_rel_path`。拿掉其中一個呼叫,
//! 對應的拒絕場景必須變紅(結尾點、保留名、`raw/`)。NFC、長度、結構也分開,
//! 方便 cargo-mutants 與審核對照。
//!
//! 段沒有長度上限:64 位元組是 §1 `CategoryId` 的,§13 只限制整條 `relPath` 240 位元組。

use serde::Serialize;
use unicode_normalization::is_nfc;
use unicode_properties::general_category::{GeneralCategoryGroup, UnicodeGeneralCategory};

/// 保留名用的上標數字(Microsoft 清單的 COM¹–COM³ / LPT¹–LPT³)。
const SUP_1: char = '\u{00B9}';
const SUP_2: char = '\u{00B2}';
const SUP_3: char = '\u{00B3}';

/// 拒絕。在邊界上(command 回給 webview、probe 的 `error`)序列化成 `{"kind":"refused","reason":...}`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename = "refused")]
pub struct Refusal {
    pub reason: &'static str,
}

impl Refusal {
    pub const fn new(reason: &'static str) -> Self {
        Self { reason }
    }
}

/// 通過才可以用這個字串。失敗方向一律拒絕,不做解碼、修剪、換斜線、NFC 轉換。
pub fn check_rel_path(rel: &str) -> Result<(), Refusal> {
    check_structure(rel)?;
    for seg in rel.split('/') {
        check_segment(seg)?;
    }
    refuse_unless_nfc(rel)?;
    refuse_too_long(rel)?;
    refuse_raw(rel)?;
    Ok(())
}

/// 單一段:非空、不含 `/`、字元集合、不以 `.` 開頭、段層級的 NFC、不以 `.` 結尾、保留名。
pub fn check_segment(seg: &str) -> Result<(), Refusal> {
    check_segment_shape(seg)?;
    refuse_unless_nfc(seg)?;
    refuse_trailing_dot(seg)?;
    refuse_reserved(seg)?;
    Ok(())
}

/// 整條路徑:非空,沒有開頭、結尾的 `/`,沒有 `//`。段裡面的事交給 `check_segment`。
fn check_structure(rel: &str) -> Result<(), Refusal> {
    if rel.is_empty() || rel.starts_with('/') || rel.ends_with('/') || rel.contains("//") {
        return Err(Refusal::new("structure"));
    }
    Ok(())
}

fn check_segment_shape(seg: &str) -> Result<(), Refusal> {
    if seg.is_empty() || seg.contains('/') || seg.starts_with('.') || !seg.chars().all(char_allowed) {
        return Err(Refusal::new("structure"));
    }
    Ok(())
}

fn char_allowed(c: char) -> bool {
    if c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' {
        return true;
    }
    if c.is_ascii() {
        return false;
    }
    matches!(
        c.general_category_group(),
        GeneralCategoryGroup::Letter | GeneralCategoryGroup::Number | GeneralCategoryGroup::Mark
    )
}

fn refuse_unless_nfc(s: &str) -> Result<(), Refusal> {
    if is_nfc(s) {
        Ok(())
    } else {
        Err(Refusal::new("nfc"))
    }
}

fn refuse_too_long(rel: &str) -> Result<(), Refusal> {
    if rel.len() <= 240 {
        Ok(())
    } else {
        Err(Refusal::new("length"))
    }
}

fn refuse_trailing_dot(seg: &str) -> Result<(), Refusal> {
    if seg.ends_with('.') {
        Err(Refusal::new("trailing-dot"))
    } else {
        Ok(())
    }
}

/// 段落在第一個 `.` 之前的部分是保留裝置名就拒絕(`nul.md` 也算,`console.md` 不算)。
fn refuse_reserved(seg: &str) -> Result<(), Refusal> {
    let stem = seg.split('.').next().unwrap_or(seg);
    if is_reserved_stem(stem) {
        Err(Refusal::new("reserved"))
    } else {
        Ok(())
    }
}

fn is_reserved_stem(stem: &str) -> bool {
    let folded = ascii_fold(stem);
    const ASCII: &[&str] = &[
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
        "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    if ASCII.contains(&folded.as_str()) {
        return true;
    }
    let sup = [SUP_1, SUP_2, SUP_3];
    for s in sup {
        if folded == format!("com{s}") || folded == format!("lpt{s}") {
            return true;
        }
    }
    false
}

/// 只摺 A–Z。不用依語系變化的 to_lowercase(土耳其語的 I)。
fn ascii_fold(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_uppercase() {
                c.to_ascii_lowercase()
            } else {
                c
            }
        })
        .collect()
}

fn refuse_raw(rel: &str) -> Result<(), Refusal> {
    let first = rel.split('/').next().unwrap_or("");
    if ascii_fold(first) == "raw" {
        Err(Refusal::new("raw"))
    } else {
        Ok(())
    }
}
