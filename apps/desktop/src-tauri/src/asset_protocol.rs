//! asset handler:協定解碼恰好一次,然後交給跟 read 同一份 `check_rel_path`。
//! 內建 `asset:` 不服務 learning/——handler 一律拒絕、不開檔。

use std::path::Path;

use percent_encoding::percent_decode_str;

use crate::learning_fs::{self, FsCall, Outcome};
use crate::path_guard::{self, Refusal};

pub const SCHEME: &str = "lc";

#[derive(Debug)]
pub struct AssetOutcome {
    pub ok: bool,
    pub checked: String,
    pub fs_calls: Vec<FsCall>,
    pub rust_log: Vec<String>,
    pub value: Option<String>,
}

/// 恰好一次。`percent_decode` 不會把解完的 `%` 再解一次。
pub fn decode_once(raw: &str) -> String {
    percent_decode_str(raw).decode_utf8_lossy().into_owned()
}

pub fn handle_custom(root: &Path, url_path: &str) -> Result<Outcome, (Refusal, AssetOutcome)> {
    let checked = decode_once(url_path);
    if let Err(err) = path_guard::check_rel_path(&checked) {
        return Err((
            err,
            refused(&checked, url_path),
        ));
    }
    match learning_fs::read(root, &checked) {
        Ok(mut out) => {
            out.fs_calls = vec![FsCall {
                op: "asset".into(),
                path: checked.clone(),
            }];
            Ok(out)
        }
        Err(err) => Err((err, refused(&checked, url_path))),
    }
}

fn refused(checked: &str, url_path: &str) -> AssetOutcome {
    AssetOutcome {
        ok: false,
        checked: checked.to_string(),
        fs_calls: Vec::new(),
        rust_log: vec![format!("refused asset path {url_path}")],
        value: None,
    }
}

/// 內建 asset: 不讀檔。註冊這個 handler 是為了在 feature 被打開時蓋過內建實作。
pub fn reject_builtin() -> AssetOutcome {
    AssetOutcome {
        ok: false,
        checked: String::new(),
        fs_calls: Vec::new(),
        rust_log: vec!["refused builtin asset: protocol".into()],
        value: None,
    }
}

/// 解一次之後跑跟 read 同一份 `check_rel_path`。沒有 `%` 的樣本兩邊必須同拒同放。
pub fn same_checks_as_read() -> bool {
    let samples = [
        "../etc/passwd",
        "cards/a.",
        "nul.md",
        "raw/x",
        "cards/a.md",
        "cards/\u{AC00}.md",
    ];
    samples.iter().all(|p| {
        let via_read = path_guard::check_rel_path(p).is_err();
        let via_asset = path_guard::check_rel_path(&decode_once(p)).is_err();
        via_read == via_asset
    })
}

/// 自訂 handler 的 scope 是呼叫端給的 learning 根,不是整顆磁碟。
/// 用暫存目錄自測:指向根外的 symlink 必須拒絕,而且不回傳根外的內容。
pub fn scope_is_learning_root() -> bool {
    let parent = std::env::temp_dir().join(format!(
        "lc-scope-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let root = parent.join("learning");
    let outside = parent.join("outside");
    let ok = (|| {
        std::fs::create_dir_all(root.join("cards")).ok()?;
        std::fs::create_dir_all(&outside).ok()?;
        std::fs::write(outside.join("secret"), "OUTSIDE").ok()?;
        std::os::unix::fs::symlink(outside.join("secret"), root.join("cards/link.md")).ok()?;
        let result = handle_custom(&root, "cards/link.md");
        let refused = result.is_err();
        let leaked = match &result {
            Ok(out) => out.value.as_str() == Some("OUTSIDE"),
            Err((_, asset)) => asset.value.as_deref() == Some("OUTSIDE"),
        };
        Some(refused && !leaked)
    })();
    let _ = std::fs::remove_dir_all(&parent);
    ok == Some(true)
}

pub fn checked_of(root: &Path, url_path: &str) -> String {
    match handle_custom(root, url_path) {
        Ok(out) => out
            .fs_calls
            .first()
            .map(|c| c.path.clone())
            .unwrap_or_else(|| decode_once(url_path)),
        Err((_, asset)) => asset.checked,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn double_encoding_still_contains_percent_after_one_decode() {
        assert_eq!(decode_once("..%252f..%252fetc"), "..%2f..%2fetc");
        assert!(path_guard::check_rel_path(&decode_once("..%252f..%252fetc")).is_err());
    }

    #[test]
    fn percent_encoded_hangul_decodes_once_to_nfc() {
        assert_eq!(decode_once("cards/%EA%B0%80.md"), "cards/\u{AC00}.md");
    }

    #[test]
    fn builtin_reject_does_not_record_a_read() {
        let out = reject_builtin();
        assert!(out.fs_calls.is_empty());
        assert!(out.rust_log.iter().any(|l| l.to_lowercase().contains("refus")));
    }

    #[test]
    fn allowed_percent_name_is_the_decoded_string() {
        let parent = std::env::temp_dir().join(format!("lc-asset-{}", std::process::id()));
        let _ = fs::remove_dir_all(&parent);
        fs::create_dir_all(parent.join("cards")).unwrap();
        fs::write(parent.join("cards/\u{AC00}.md"), "hangul").unwrap();
        let out = handle_custom(&parent, "cards/%EA%B0%80.md").unwrap();
        assert_eq!(out.fs_calls[0].path, "cards/\u{AC00}.md");
        let _ = fs::remove_dir_all(&parent);
    }
}
