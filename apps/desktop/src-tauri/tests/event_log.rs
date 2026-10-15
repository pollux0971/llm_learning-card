//! Rust 寫 §10 warning 事件(T2c-1 驗收 B6、B7;測試 agent 寫的,實作者不要改)。
//!
//! 介面:
//!   - `event_log::append_line(sink: &mut impl Write, event: &serde_json::Value) -> io::Result<()>`:
//!     把「JSON + `\n`」用**一次** `write_all` 寫進 sink。寫 log.jsonl 的路徑(O_APPEND 開檔、寫、fsync)用的就是它。
//!   - `event_log::AssetRefusalLimiter`:asset handler 的拒絕限流,時鐘由呼叫端傳入。
//!       `new()`;
//!       `on_refusal(now: SystemTime, reason: &str, path: &str) -> Option<Value>`:這一次要寫一行就回那一行;
//!       `flush(now: SystemTime) -> Vec<Value>`:程式正常結束時,還沒寫出的次數各補一行。
//!     規則(phase-2.feature,顧問 2026-10-15):同一個 reason 距離上一行 **≥ 60 秒**才寫;
//!     那一行的 `count` = 上一行之後(含這一次)被拒絕的次數;`path` 是觸發寫入的那一次的路徑。

#![cfg(unix)]

mod common;

use std::io::{self, Write};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::{assert_warning_line, is_iso8601_with_zone};
use learning_cards_desktop::event_log::{append_line, AssetRefusalLimiter};
use serde_json::{json, Value};

/// 記下每一次 `write` 呼叫拿到的緩衝區。
#[derive(Default)]
struct CountingSink {
    writes: Vec<Vec<u8>>,
}

impl Write for CountingSink {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.writes.push(buf.to_vec());
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn warning(path: &str) -> Value {
    json!({ "ts": "2026-10-15T00:00:00.000Z", "type": "warning", "path": path, "reason": "path-refused" })
}

#[test]
fn append_line_is_exactly_one_write_of_one_complete_line() {
    let mut sink = CountingSink::default();
    let event = warning("raw/x.md");
    append_line(&mut sink, &event).expect("append");
    assert_eq!(sink.writes.len(), 1, "JSON and newline must go in one write, got {} writes", sink.writes.len());
    let buf = &sink.writes[0];
    assert_eq!(buf.last(), Some(&b'\n'), "the line must end with a newline");
    assert_eq!(buf.iter().filter(|b| **b == b'\n').count(), 1, "exactly one newline, at the end");
    let parsed: Value = serde_json::from_slice(&buf[..buf.len() - 1]).expect("the line without its newline is JSON");
    assert_eq!(parsed, event);
}

#[test]
fn append_line_escapes_a_nul_and_stays_one_line() {
    let mut sink = CountingSink::default();
    let path = "cards/a.md\u{0}.png";
    append_line(&mut sink, &warning(path)).expect("append");
    assert_eq!(sink.writes.len(), 1);
    let text = String::from_utf8(sink.writes[0].clone()).unwrap();
    assert!(text.contains("\\u0000"), "{text:?}");
    assert!(!text.contains('\u{0}'));
    let parsed: Value = serde_json::from_str(text.trim_end_matches('\n')).unwrap();
    assert_eq!(parsed["path"], path);
}

#[test]
fn append_line_does_not_swallow_a_sink_error() {
    struct Broken;
    impl Write for Broken {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::Error::from_raw_os_error(libc::ENOSPC))
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let err = append_line(&mut Broken, &warning("raw/x.md")).expect_err("ENOSPC must come out");
    assert_eq!(err.raw_os_error(), Some(libc::ENOSPC));
}

// ---------------------------------------------------------------- B7:asset 拒絕的限流

const BASE: u64 = 1_760_000_000;

fn at(secs: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(BASE + secs)
}

fn assert_limited_line(v: &Value, path: &str, count: u64) {
    let line = serde_json::to_string(v).unwrap();
    assert_warning_line(&line, path);
    assert_eq!(v["count"], json!(count), "count in {line}");
    assert!(is_iso8601_with_zone(v["ts"].as_str().unwrap()));
}

/// 工單 B7 的向量表:structure 在 0、10、20、61,raw 在 5。
#[test]
fn limiter_vector_table() {
    let mut l = AssetRefusalLimiter::new();
    let t0 = l.on_refusal(at(0), "structure", "../s0.png").expect("first structure refusal is written");
    assert_limited_line(&t0, "../s0.png", 1);
    let t5 = l.on_refusal(at(5), "raw", "raw/r5.png").expect("first raw refusal is written (reasons are counted apart)");
    assert_limited_line(&t5, "raw/r5.png", 1);
    assert!(l.on_refusal(at(10), "structure", "../s10.png").is_none(), "10 s after the last line: not written");
    assert!(l.on_refusal(at(20), "structure", "../s20.png").is_none(), "20 s after the last line: not written");
    let t61 = l.on_refusal(at(61), "structure", "../s61.png").expect("61 s after the last line is written");
    assert_limited_line(&t61, "../s61.png", 3);
    assert!(l.flush(at(62)).is_empty(), "nothing pending after the 61 s line");
}

#[test]
fn limiter_flush_writes_the_unwritten_count() {
    let mut l = AssetRefusalLimiter::new();
    assert!(l.on_refusal(at(0), "structure", "../s0.png").is_some());
    assert!(l.on_refusal(at(10), "structure", "../s10.png").is_none());
    assert!(l.on_refusal(at(20), "structure", "../s20.png").is_none());
    let flushed = l.flush(at(30));
    assert_eq!(flushed.len(), 1, "{flushed:?}");
    assert_eq!(flushed[0]["count"], json!(2), "10 and 20 were not written yet");
    assert_eq!(flushed[0]["type"], "warning");
    assert_eq!(flushed[0]["reason"], "path-refused");
    assert!(l.flush(at(31)).is_empty(), "a second flush has nothing left");
}

#[test]
fn limiter_flush_after_the_61_second_line_counts_only_the_later_refusals() {
    let mut l = AssetRefusalLimiter::new();
    l.on_refusal(at(0), "structure", "../a.png");
    l.on_refusal(at(10), "structure", "../a.png");
    l.on_refusal(at(20), "structure", "../a.png");
    assert!(l.on_refusal(at(61), "structure", "../a.png").is_some());
    assert!(l.on_refusal(at(70), "structure", "../a.png").is_none());
    assert!(l.on_refusal(at(80), "structure", "../a.png").is_none());
    let flushed = l.flush(at(90));
    assert_eq!(flushed.len(), 1);
    assert_eq!(flushed[0]["count"], json!(2));
}

#[test]
fn limiter_writes_at_exactly_60_seconds() {
    let mut l = AssetRefusalLimiter::new();
    assert!(l.on_refusal(at(0), "structure", "../s0.png").is_some());
    let t60 = l.on_refusal(at(60), "structure", "../s60.png").expect(">= 60 s since the last line is written");
    assert_limited_line(&t60, "../s60.png", 1);
}

#[test]
fn limiter_does_not_write_at_59_seconds() {
    let mut l = AssetRefusalLimiter::new();
    assert!(l.on_refusal(at(0), "structure", "../s0.png").is_some());
    assert!(l.on_refusal(at(59), "structure", "../s59.png").is_none(), "59 s is inside the window");
    let flushed = l.flush(at(59));
    assert_eq!(flushed.len(), 1);
    assert_eq!(flushed[0]["count"], json!(1));
}

#[test]
fn limiter_window_is_measured_from_the_last_written_line_not_the_last_refusal() {
    let mut l = AssetRefusalLimiter::new();
    assert!(l.on_refusal(at(0), "structure", "../a.png").is_some());
    for s in [30, 50, 59] {
        assert!(l.on_refusal(at(s), "structure", "../a.png").is_none(), "{s}");
    }
    let line = l.on_refusal(at(60), "structure", "../a.png").expect("60 s after the line at 0");
    assert_eq!(line["count"], json!(4), "30, 50, 59 and 60");
}

#[test]
fn limiter_flush_with_nothing_refused_is_empty() {
    let mut l = AssetRefusalLimiter::new();
    assert!(l.flush(at(0)).is_empty());
}
