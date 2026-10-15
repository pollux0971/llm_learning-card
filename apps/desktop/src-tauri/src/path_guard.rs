//! §13 1.3.1 白名單。被檢查的字串與被使用的字串逐位元相同:這裡不轉換。
//!
//! 每一條額外檢查都是獨立函式,呼叫點在 `check_rel_path`。拿掉其中一個呼叫,
//! 對應的拒絕場景必須變紅(結尾點、保留名、`raw/`)。NFC、長度、結構也分開,
//! 方便 cargo-mutants 與審核對照。

use unicode_normalization::is_nfc;
use unicode_properties::general_category::{GeneralCategoryGroup, UnicodeGeneralCategory};

/// 保留名用的上標數字(Microsoft 清單的 COM¹–COM³ / LPT¹–LPT³)。
const SUP_1: char = '\u{00B9}';
const SUP_2: char = '\u{00B2}';
const SUP_3: char = '\u{00B3}';

#[derive(Debug, Clone, PartialEq, Eq)]
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
    refuse_unless_nfc(rel)?;
    refuse_too_long(rel)?;
    refuse_trailing_dot(rel)?;
    refuse_reserved(rel)?;
    refuse_raw(rel)?;
    Ok(())
}

fn check_structure(rel: &str) -> Result<(), Refusal> {
    if rel.is_empty() || rel.starts_with('/') || rel.ends_with('/') || rel.contains("//") {
        return Err(Refusal::new("structure"));
    }
    for seg in rel.split('/') {
        if seg.is_empty() || seg.starts_with('.') || !seg.chars().all(char_allowed) {
            return Err(Refusal::new("structure"));
        }
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

fn refuse_unless_nfc(rel: &str) -> Result<(), Refusal> {
    if is_nfc(rel) {
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

fn refuse_trailing_dot(rel: &str) -> Result<(), Refusal> {
    if rel.split('/').any(|seg| seg.ends_with('.')) {
        Err(Refusal::new("trailing-dot"))
    } else {
        Ok(())
    }
}

fn refuse_reserved(rel: &str) -> Result<(), Refusal> {
    for seg in rel.split('/') {
        let stem = seg.split('.').next().unwrap_or(seg);
        if is_reserved_stem(stem) {
            return Err(Refusal::new("reserved"));
        }
    }
    Ok(())
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
