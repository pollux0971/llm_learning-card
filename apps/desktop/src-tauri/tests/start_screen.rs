//! 啟動畫面(T2c-2 驗收 3 的畫面文字;驗收者補的測試,cargo-mutants 在 `start_screen.rs` 存活 27 個之後寫)。
//!
//! 畫面文字、視窗清單、HTML 轉義、回應標頭、網址。畫面上的路徑來自使用者的指標檔(任意字串),
//! 所以轉義是安全邊界:路徑裡的 `<script>` 不能原樣進到頁面。

use std::path::PathBuf;

use http::header::{CONTENT_SECURITY_POLICY, CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS};
use learning_cards_desktop::learning_root::{Pointer, Resolved, StartState};
use learning_cards_desktop::start_screen::{self, INIT_COMMAND, SHOW_COMMAND};

const ID: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

fn resolved(state: StartState, learning_dir: Option<&str>) -> Resolved {
    Resolved {
        state,
        root: None,
        pointer_path: PathBuf::from("/home/u/.config/llm-learning-cards/vault.json"),
        pointer: learning_dir.map(|d| Pointer { learning_dir: d.to_string(), vault_id: ID.to_string() }),
    }
}

const FAILED: [StartState; 4] = [
    StartState::PointerMissing,
    StartState::PointerUnreadable,
    StartState::LearningDirMissing,
    StartState::MarkerMismatch,
];

#[test]
fn only_ok_opens_the_two_card_windows() {
    assert_eq!(start_screen::windows(StartState::Ok), ["teach", "test"]);
    for s in FAILED {
        assert!(start_screen::windows(s).is_empty(), "{s:?} must not open the card windows");
    }
}

#[test]
fn the_four_titles_are_the_ticket_wording_and_ok_has_none() {
    assert_eq!(start_screen::title(StartState::PointerMissing), "還沒有設定 learning 資料夾");
    assert_eq!(start_screen::title(StartState::PointerUnreadable), "設定檔讀不到");
    assert_eq!(start_screen::title(StartState::LearningDirMissing), "找不到資料夾");
    assert_eq!(start_screen::title(StartState::MarkerMismatch), "這不是同一個資料夾");
    assert_eq!(start_screen::title(StartState::Ok), "");
}

#[test]
fn text_starts_with_its_title_and_ok_has_no_text() {
    for s in FAILED {
        let t = start_screen::text(&resolved(s, Some("/data/learning")));
        assert!(t.starts_with(start_screen::title(s)), "{s:?}: {t}");
        assert!(t.len() > start_screen::title(s).len() + 20, "{s:?} must say more than the title");
    }
    assert_eq!(start_screen::text(&resolved(StartState::Ok, Some("/data/learning"))), "");
}

#[test]
fn every_failed_text_has_the_full_init_command_with_a_path() {
    for s in FAILED {
        let t = start_screen::text(&resolved(s, Some("/data/learning")));
        assert!(t.contains(INIT_COMMAND), "{s:?}: {t}");
        assert!(t.contains(&format!("{INIT_COMMAND} ")), "{s:?}: the command must be followed by a path");
    }
}

#[test]
fn the_text_shows_what_each_state_needs_and_nothing_else() {
    let missing = start_screen::text(&resolved(StartState::PointerMissing, None));
    assert!(missing.contains("/home/u/.config/llm-learning-cards/vault.json"));
    assert!(missing.contains("<絕對路徑>"), "a placeholder the person replaces");
    assert!(!missing.contains("--force"), "nothing to overwrite when the pointer does not exist");
    assert!(!missing.contains(SHOW_COMMAND));

    let unreadable = start_screen::text(&resolved(StartState::PointerUnreadable, None));
    assert!(unreadable.contains("/home/u/.config/llm-learning-cards/vault.json"), "the absolute pointer path");
    assert!(unreadable.contains(SHOW_COMMAND));
    assert!(unreadable.contains(&format!("{INIT_COMMAND} <絕對路徑> --force")));
    assert!(unreadable.contains("不會改寫"), "says the app does not overwrite it");

    let dir_missing = start_screen::text(&resolved(StartState::LearningDirMissing, Some("/data/gone")));
    assert!(dir_missing.contains("/data/gone"), "the path that was not found");
    assert!(dir_missing.contains("/home/u/.config/llm-learning-cards/vault.json"));
    assert!(dir_missing.contains(&format!("{INIT_COMMAND} <絕對路徑> --force")));

    let mismatch = start_screen::text(&resolved(StartState::MarkerMismatch, Some("/data/learning")));
    assert!(mismatch.contains("/data/learning"));
    assert!(mismatch.contains(SHOW_COMMAND));
    assert!(mismatch.contains(&format!("{INIT_COMMAND} /data/learning --force")), "the path is filled in, ready to paste");
    assert!(mismatch.contains("不會改寫"), "says neither side is rewritten automatically");
}

#[test]
fn the_mismatch_command_quotes_a_path_that_a_shell_would_split_or_expand() {
    let command_for = |dir: &str| -> String {
        let t = start_screen::text(&resolved(StartState::MarkerMismatch, Some(dir)));
        t.lines().find(|l| l.starts_with(INIT_COMMAND)).expect("a command line").to_string()
    };
    assert_eq!(command_for("/data/learning"), format!("{INIT_COMMAND} /data/learning --force"));
    assert_eq!(command_for("/data/a-b_c.d+e,f:g@h%i=j"), format!("{INIT_COMMAND} /data/a-b_c.d+e,f:g@h%i=j --force"));
    assert_eq!(command_for("/data/my learning"), format!("{INIT_COMMAND} '/data/my learning' --force"));
    assert_eq!(command_for("/data/$(rm -rf x)"), format!("{INIT_COMMAND} '/data/$(rm -rf x)' --force"));
    assert_eq!(command_for("/data/it's"), format!("{INIT_COMMAND} '/data/it'\\''s' --force"));
    assert_eq!(command_for("/data/a;b"), format!("{INIT_COMMAND} '/data/a;b' --force"));
    assert_eq!(command_for("/data/日本語"), format!("{INIT_COMMAND} '/data/日本語' --force"), "non-ASCII is quoted too");
    assert_eq!(command_for(""), format!("{INIT_COMMAND} '' --force"), "an empty path is quoted, not dropped");
}

#[test]
fn the_page_escapes_every_html_special_character_in_a_path() {
    let nasty = "/data/<script>alert(1)</script>&\"x\"'y'>";
    let page = start_screen::page(&resolved(StartState::LearningDirMissing, Some(nasty)));
    assert!(!page.contains("<script>"), "{page}");
    assert!(!page.contains("</script>"), "{page}");
    assert!(page.contains("&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;x&quot;&#39;y&#39;&gt;"), "{page}");
    // 轉義只做一次:頁面上不會出現被轉兩次的 &amp;lt;
    assert!(!page.contains("&amp;lt;"), "{page}");
    assert!(!page.contains("&amp;amp;"), "{page}");
}

#[test]
fn the_page_has_the_title_in_title_and_h1_and_the_rest_in_pre() {
    let r = resolved(StartState::PointerUnreadable, None);
    let page = start_screen::page(&r);
    let title = start_screen::title(StartState::PointerUnreadable);
    assert!(page.starts_with("<!doctype html>"), "{page}");
    assert!(page.contains(&format!("<title>{title}</title>")), "{page}");
    assert!(page.contains(&format!("<h1>{title}</h1>")), "{page}");
    assert!(page.contains("<pre>"));
    assert!(page.contains("</pre>"));
    assert!(page.contains("/home/u/.config/llm-learning-cards/vault.json"));
    assert!(page.contains(INIT_COMMAND), "the command is selectable text on the page");
    assert!(!page.contains("<script"), "the page has no script");
    // 標題那一行不重複放進 <pre>(第一行拿去當標題,其餘放 pre)
    let pre = &page[page.find("<pre>").unwrap()..];
    assert!(!pre.contains(title), "{pre}");
}

#[test]
fn every_failed_state_makes_a_different_page() {
    let pages: Vec<String> = FAILED.iter().map(|s| start_screen::page(&resolved(*s, Some("/data/learning")))).collect();
    for i in 0..pages.len() {
        for j in i + 1..pages.len() {
            assert_ne!(pages[i], pages[j], "{:?} and {:?} must not share a page", FAILED[i], FAILED[j]);
        }
    }
}

#[test]
fn the_response_is_the_page_with_safe_headers() {
    let page = start_screen::page(&resolved(StartState::PointerMissing, None));
    let response = start_screen::response(&page);
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()[CONTENT_TYPE], "text/html; charset=utf-8");
    assert_eq!(response.headers()[X_CONTENT_TYPE_OPTIONS], "nosniff");
    let csp = response.headers()[CONTENT_SECURITY_POLICY].to_str().unwrap();
    assert!(csp.contains("default-src 'none'"), "{csp}");
    assert!(!csp.contains("script-src"), "no script is allowed: {csp}");
    assert_eq!(response.body().as_slice(), page.as_bytes());
    assert!(!response.body().is_empty());
}

#[test]
fn the_window_url_uses_the_dedicated_scheme_not_lc() {
    assert_eq!(start_screen::SCHEME, "lc-start");
    assert_ne!(start_screen::SCHEME, learning_cards_desktop::asset_protocol::SCHEME, "lc only serves learning files");
    assert_eq!(start_screen::WINDOW_LABEL, "setup");
    if cfg!(any(windows, target_os = "android")) {
        assert_eq!(start_screen::url(), "http://lc-start.localhost/");
    } else {
        assert_eq!(start_screen::url(), "lc-start://localhost/");
    }
}
