//! T16:沒設 `RUST_LOG` 時,本 crate 的 `log::warn!`(3 秒逾時退路)預設就要印出來;別的 crate 仍只印 error。
//! 設了 `RUST_LOG` 就照它。測試 agent 寫;開發 worker 不改。
//!
//! 不改全域 logger、不碰環境變數:用 `log_filter(Option<&str>)` 算出 filter 字串,
//! 再用 env_logger 建一個 logger,問它對某筆 record 要不要輸出(`matches`)。

use learning_cards_desktop::log_filter;
use log::{Level, Record};

fn matches(filter: &str, target: &str, level: Level) -> bool {
    let logger = env_logger::Builder::new().parse_filters(filter).build();
    logger.matches(&Record::builder().target(target).level(level).args(format_args!("x")).build())
}

#[test]
fn without_rust_log_this_crates_warnings_are_printed() {
    let filter = log_filter(None);
    assert!(matches(&filter, "learning_cards_desktop", Level::Warn), "預設 filter `{filter}` 看不到本 crate 的 warn");
    assert!(matches(&filter, "learning_cards_desktop::main", Level::Warn), "子模組的 warn 也要看得到:`{filter}`");
    assert!(matches(&filter, "learning_cards_desktop", Level::Error));
}

#[test]
fn without_rust_log_this_crates_info_and_debug_stay_quiet() {
    let filter = log_filter(None);
    assert!(!matches(&filter, "learning_cards_desktop", Level::Info), "預設不印 info:`{filter}`");
    assert!(!matches(&filter, "learning_cards_desktop", Level::Debug));
}

#[test]
fn without_rust_log_other_crates_only_print_errors() {
    let filter = log_filter(None);
    assert!(matches(&filter, "tauri", Level::Error));
    assert!(!matches(&filter, "tauri", Level::Warn), "別的 crate 的 warn 不印(太吵):`{filter}`");
    assert!(!matches(&filter, "tao", Level::Warn));
}

#[test]
fn rust_log_when_set_decides_everything() {
    let filter = log_filter(Some("debug"));
    assert!(matches(&filter, "tauri", Level::Debug), "RUST_LOG=debug 時別的 crate 的 debug 也印:`{filter}`");
    assert!(matches(&filter, "learning_cards_desktop", Level::Debug));

    let off = log_filter(Some("off"));
    assert!(!matches(&off, "learning_cards_desktop", Level::Error), "RUST_LOG=off 就全關,預設值不能蓋過它:`{off}`");

    let only = log_filter(Some("tauri=trace"));
    assert!(matches(&only, "tauri", Level::Trace));
    assert!(!matches(&only, "learning_cards_desktop", Level::Warn), "RUST_LOG 有設時不再加預設的本 crate warn:`{only}`");
}
