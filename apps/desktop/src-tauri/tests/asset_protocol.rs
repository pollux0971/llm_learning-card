//! `lc` asset protocol(T2c-1 驗收 E14、B7;測試 agent 寫的,實作者不要改)。
//!
//! 介面:
//!   `asset_protocol::respond(root, encoded_rel, &mut AssetRefusalLimiter, now) -> AssetReply`
//!     - `encoded_rel` 是請求的 URL path 拿掉**一個**開頭 `/` 之後的字串(`asset_rel_from_url_path` 的結果),
//!       還沒解碼;respond 自己解碼恰好一次,再交給跟 read 同一份白名單。
//!     - `AssetReply { response: http::Response<Vec<u8>>, checked: String, fs_calls: Vec<FsCall>, refusal: Option<Refusal> }`
//!       `checked` 是解碼後被檢查的字串(解碼失敗時是原字串);`fs_calls` 被拒絕時是空的;`refusal` 被拒絕時有值。
//!     - main.rs 的 lc handler 與 probe 的 asset op 都呼叫它,只回 `response`。
//!   拒絕 → 403,照 B7 限流往 `<root>/state/log.jsonl` 寫 warning;檔案不存在 → 404,不寫;
//!   每個回應都帶 `X-Content-Type-Options: nosniff`;`.svg` 另帶 `Content-Security-Policy: script-src 'none'`。
//!
//! 前半段是 T2b 寫在 `src/asset_protocol.rs` 的 `mod tests`,搬過來;用到 `handle_custom` 的那幾條改成 `respond`
//! (圖片要用 bytes,handle_custom 回的是文字),斷言的內容不變。

#![cfg(unix)]

mod common;

use std::fs;
use std::os::unix::fs::symlink;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::{assert_warning_line, Learning};
use learning_cards_desktop::asset_protocol::{asset_rel_from_url_path, decode_once, reject_builtin, respond, AssetReply};
use learning_cards_desktop::event_log::AssetRefusalLimiter;
use learning_cards_desktop::path_guard;
use sha2::{Digest, Sha256};

fn now() -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(1_760_000_000)
}

fn get(l: &Learning, encoded_rel: &str) -> AssetReply {
    let mut limiter = AssetRefusalLimiter::new();
    respond(&l.root, encoded_rel, &mut limiter, now())
}

fn header<'a>(reply: &'a AssetReply, name: &str) -> Option<&'a str> {
    reply.response.headers().get(name).and_then(|v| v.to_str().ok())
}

fn assert_nosniff(reply: &AssetReply) {
    assert_eq!(
        header(reply, "x-content-type-options"),
        Some("nosniff"),
        "every response must say nosniff (status {})",
        reply.response.status()
    );
}

// ---------------------------------------------------------------- T2b(搬過來)

#[test]
fn double_encoding_still_contains_percent_after_one_decode() {
    assert_eq!(decode_once("..%252f..%252fetc").unwrap(), "..%2f..%2fetc");
    assert!(path_guard::check_rel_path(&decode_once("..%252f..%252fetc").unwrap()).is_err());
}

#[test]
fn percent_encoded_hangul_decodes_once_to_nfc() {
    assert_eq!(decode_once("cards/%EA%B0%80.md").unwrap(), "cards/\u{AC00}.md");
}

#[test]
fn builtin_reject_does_not_record_a_read() {
    let out = reject_builtin();
    assert!(out.fs_calls.is_empty());
    assert!(out.rust_log.iter().any(|l| l.to_lowercase().contains("refus")));
}

#[test]
fn allowed_percent_name_is_the_decoded_string() {
    let l = Learning::new("asset-hangul-name");
    l.plant("cards/\u{AC00}.md", b"hangul");
    let reply = get(&l, "cards/%EA%B0%80.md");
    assert_eq!(reply.response.status(), 200);
    assert_eq!(reply.fs_calls[0].path, "cards/\u{AC00}.md");
}

#[test]
fn one_leading_slash_is_stripped_and_allowed() {
    let rel = asset_rel_from_url_path("/cards/a.md");
    assert_eq!(rel, "cards/a.md");
    assert!(path_guard::check_rel_path(rel).is_ok());
}

#[test]
fn two_leading_slashes_stay_absolute_and_are_refused() {
    let rel = asset_rel_from_url_path("//cards/a.md");
    assert!(rel.starts_with('/'), "must not collapse //cards/a.md into a relative path, got {rel:?}");
    assert!(path_guard::check_rel_path(rel).is_err(), "{rel:?} must be refused");
}

#[test]
fn three_leading_slashes_are_refused() {
    let rel = asset_rel_from_url_path("///x");
    assert!(path_guard::check_rel_path(rel).is_err(), "{rel:?} must be refused");
    assert_ne!(rel, "x", "///x must not become x before the whitelist");
}

#[test]
fn handler_does_not_trim_every_leading_slash() {
    let main = include_str!("../src/main.rs");
    assert!(
        !main.contains("trim_start_matches('/')"),
        "asset handler still strips every leading slash before the whitelist"
    );
    assert!(main.contains("asset_rel_from_url_path"), "handler must call the single-slash strip");
}

#[test]
fn percent_ff_is_refused_as_decode_not_replacement() {
    let l = Learning::new("asset-ff");
    let reply = get(&l, "cards/%FF.md");
    assert_eq!(reply.response.status(), 403);
    assert_eq!(reply.refusal.as_ref().map(|r| r.reason), Some("decode"));
    assert!(!reply.checked.contains('\u{FFFD}'), "converted invalid UTF-8: {:?}", reply.checked);
}

#[test]
fn percent_truncated_utf8_is_refused_as_decode() {
    let l = Learning::new("asset-c3");
    let reply = get(&l, "cards/%C3.md");
    assert_eq!(reply.response.status(), 403);
    assert_eq!(reply.refusal.as_ref().map(|r| r.reason), Some("decode"));
    assert!(!reply.checked.contains('\u{FFFD}'), "{:?}", reply.checked);
}

#[test]
fn percent_encoded_hangul_still_passes_strict_decode() {
    let l = Learning::new("asset-hangul");
    l.plant("cards/\u{AC00}.md", b"hangul");
    let reply = get(&l, "cards/%EA%B0%80.md");
    assert_eq!(reply.response.status(), 200, "valid UTF-8 percent must pass");
    assert_eq!(reply.fs_calls[0].path, "cards/\u{AC00}.md");
    assert_eq!(reply.response.body(), b"hangul");
}

// ---------------------------------------------------------------- T2c-1 E14:bytes、Content-Type、nosniff、SVG

fn png_bytes() -> Vec<u8> {
    let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    bytes.extend_from_slice(&[0x00, 0xFF, 0x00, 0xFE, 0xFF, 0x80, 0x00, 0x0A, 0x0D, 0xC3, 0x28]);
    bytes
}

#[test]
fn an_image_comes_back_byte_for_byte() {
    let l = Learning::new("asset-png");
    let bytes = png_bytes();
    assert!(String::from_utf8(bytes.clone()).is_err(), "fixture must not be valid UTF-8");
    l.plant("assets/x.png", &bytes);
    let reply = get(&l, "assets/x.png");
    assert_eq!(reply.response.status(), 200);
    assert_eq!(
        Sha256::digest(reply.response.body()),
        Sha256::digest(&bytes),
        "body is not the file's bytes ({} vs {} bytes)",
        reply.response.body().len(),
        bytes.len()
    );
    assert_eq!(header(&reply, "content-type"), Some("image/png"));
    assert_nosniff(&reply);
}

#[test]
fn content_type_follows_the_extension() {
    for (ext, want) in [
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("gif", "image/gif"),
        ("webp", "image/webp"),
        ("svg", "image/svg+xml"),
        ("bin", "application/octet-stream"),
        ("png", "image/png"),
    ] {
        let l = Learning::new("asset-type");
        let rel = format!("assets/x.{ext}");
        l.plant(&rel, &png_bytes());
        let reply = get(&l, &rel);
        assert_eq!(reply.response.status(), 200, "{rel}");
        assert_eq!(header(&reply, "content-type"), Some(want), "{rel}");
        assert_nosniff(&reply);
    }
}

#[test]
fn an_svg_response_forbids_script() {
    let l = Learning::new("asset-svg");
    l.plant(
        "assets/x.svg",
        b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>document.title='pwned'</script></svg>",
    );
    let reply = get(&l, "assets/x.svg");
    assert_eq!(reply.response.status(), 200);
    assert_eq!(header(&reply, "content-type"), Some("image/svg+xml"));
    assert_eq!(header(&reply, "content-security-policy"), Some("script-src 'none'"));
    assert_nosniff(&reply);
}

#[test]
fn a_missing_asset_is_404_and_writes_no_warning() {
    let l = Learning::new("asset-404");
    let reply = get(&l, "assets/missing.png");
    assert_eq!(reply.response.status(), 404, "not 200 with an empty body, not 403");
    assert!(reply.refusal.is_none(), "a missing file is not a refusal");
    assert_nosniff(&reply);
    assert_eq!(l.log_text(), "", "a 404 writes no warning");
}

#[test]
fn a_refused_asset_is_403_and_writes_one_limited_warning() {
    let l = Learning::new("asset-403");
    l.plant("raw/x.png", &png_bytes());
    let mut limiter = AssetRefusalLimiter::new();
    let first = respond(&l.root, "raw/x.png", &mut limiter, now());
    assert_eq!(first.response.status(), 403);
    assert_eq!(first.refusal.as_ref().map(|r| r.reason), Some("raw"));
    assert!(first.fs_calls.is_empty(), "a refused asset must not touch the file");
    assert!(!first.response.body().starts_with(&png_bytes()[..8]), "a refused asset leaked the file");
    assert_nosniff(&first);
    let lines = l.log_lines();
    assert_eq!(lines.len(), 1, "{lines:?}");
    let v = assert_warning_line(&lines[0], "raw/x.png");
    assert_eq!(v["count"], 1);

    let second = respond(&l.root, "raw/x.png", &mut limiter, now() + Duration::from_secs(10));
    assert_eq!(second.response.status(), 403);
    assert_eq!(l.log_lines().len(), 1, "10 s later the same reason is not written again");
}

#[test]
fn an_asset_symlink_out_of_the_root_is_refused_and_not_served() {
    let l = Learning::new("asset-symlink");
    fs::create_dir_all(l.root.join("assets")).unwrap();
    symlink(l.outside.join("secret"), l.root.join("assets/link.png")).unwrap();
    let reply = get(&l, "assets/link.png");
    assert_eq!(reply.response.status(), 403);
    assert!(
        !String::from_utf8_lossy(reply.response.body()).contains("OUTSIDE-SENTINEL"),
        "served a file outside the learning directory"
    );
}

#[test]
fn main_rs_serves_lc_through_respond() {
    let main = include_str!("../src/main.rs");
    assert!(main.contains("asset_protocol::respond"), "the lc handler must call asset_protocol::respond (one code path with the probe)");
    assert!(!main.contains(".as_str().unwrap_or(\"\")"), "the lc handler still turns the body into text");
}
