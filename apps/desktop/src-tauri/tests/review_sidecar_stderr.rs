//! T28:側車 stderr 轉到 app 時,前綴只印一次(`docs/tickets/T28-sidecar-stderr-prefix-once.md`)。
//! 紅測試作者寫;開發 worker 不改。
//!
//! 五塊:
//!   1. `STDERR_PREFIX` 與 `host_stderr_line`:驗收 1 的表逐列(加幾個邊界:多個結尾換行、只有前綴缺空白);
//!   2. `forward_lines`:假 sink 記下每一次 `write` —— 三行輸入剛好三次,每次是「換好的一行 + `\n`」;
//!   3. 轉送不會自己停:不合法的 UTF-8 繼續讀下一行;讀錯才停;sink 寫失敗也讀到 EOF、不 panic;
//!   4. 靜態:`forward_lines` / `forward_stderr` 的原始碼不用 `eprintln!`、`read_line`、`unwrap`、`expect`;
//!   5. 接線:`SidecarHost` 起的假側車往 stderr 印的字,真的出現在 app 行程的 stderr,每一行剛好一個前綴。
//!      測試 binary 用 `current_exe()` 帶 `--exact <名字> --nocapture` 重跑自己一次(libtest 會攔測試開的執行緒的輸出,
//!      所以要 `--nocapture`);子行程把自己的 fd 2 接到暫存檔,**不靠固定的睡眠**:等到假側車最後印的那一行出現在檔案裡
//!      (條件式輪詢,有上限),才把檔案交回父行程比對。
//!
//! 比對的是「只有轉送才會產生」的行:假側車印的是 `[review-sidecar] 正在用假 router`(已有前綴)、`plain from dependency`
//! (沒前綴)、`crlf line\r\n`、含 `\377` 的壞位元組行;父行程預期的是 Rust 換好的樣子。換成空函式、加兩次前綴、
//! 壞位元組後停止,這幾種都會讓這條紅。
//! 全部用 `std::env::temp_dir()` 底下新建的目錄,不碰真的 learning/、不開真的 node、不碰網路。
#![cfg(unix)]

use std::cell::Cell;
use std::fs;
use std::io::{self, BufReader, Cursor, Read, Write};
use std::os::unix::io::AsRawFd;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use learning_cards_desktop::review_sidecar::{
    forward_lines, host_stderr_line, SidecarHost, SidecarSpec, SidecarTimeouts, STDERR_PREFIX,
};
use serde_json::json;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

// ───────────────────────────── 1. 常數與純函式

#[test]
fn the_prefix_constant_is_fixed_with_one_trailing_space() {
    assert_eq!(STDERR_PREFIX, "[review-sidecar] ");
    assert!(STDERR_PREFIX.ends_with(' '));
    assert_eq!(STDERR_PREFIX.len(), "[review-sidecar]".len() + 1);
}

#[test]
fn host_stderr_line_follows_the_ticket_table_row_by_row() {
    let rows: &[(&[u8], &str)] = &[
        (
            "[review-sidecar] 正在用假 router\n".as_bytes(),
            "[review-sidecar] 正在用假 router",
        ),
        (
            b"[review-sidecar] internal\r\n",
            "[review-sidecar] internal",
        ),
        (
            b"plain from a dependency\n",
            "[review-sidecar] plain from a dependency",
        ),
        (
            b"x [review-sidecar] y\n",
            "[review-sidecar] x [review-sidecar] y",
        ),
        (
            b"  [review-sidecar] x\n",
            "[review-sidecar]   [review-sidecar] x",
        ),
        (
            b"[Review-Sidecar] x\n",
            "[review-sidecar] [Review-Sidecar] x",
        ),
        (b"[review-sidecar]x\n", "[review-sidecar] [review-sidecar]x"),
        (b"[review-sidecar] ", "[review-sidecar] "),
        (b"\n", "[review-sidecar] "),
        (b"a\rb\n", "[review-sidecar] a\rb"),
        (b"bad \xff byte\n", "[review-sidecar] bad \u{FFFD} byte"),
    ];
    for (raw, want) in rows {
        assert_eq!(
            host_stderr_line(raw),
            *want,
            "raw = {:?}",
            String::from_utf8_lossy(raw)
        );
    }
}

#[test]
fn already_prefixed_lines_come_out_unchanged_and_exactly_one_prefix() {
    let line = host_stderr_line("[review-sidecar] 正在用假 router\n".as_bytes());
    assert_eq!(line.matches("[review-sidecar]").count(), 1, "{line}");
    assert!(!line.contains("[review-sidecar] [review-sidecar]"));
    // 轉兩次也不會長出第二個(冪等)
    assert_eq!(host_stderr_line(format!("{line}\n").as_bytes()), line);
}

#[test]
fn trailing_newlines_and_carriage_returns_are_all_removed_but_inner_ones_stay() {
    assert_eq!(host_stderr_line(b"abc\r\r\n\n"), "[review-sidecar] abc");
    assert_eq!(host_stderr_line(b"abc\n\n\n"), "[review-sidecar] abc");
    assert_eq!(host_stderr_line(b"abc\r\n"), "[review-sidecar] abc");
    assert_eq!(host_stderr_line(b"a\r\nb\r\n"), "[review-sidecar] a\r\nb");
    assert_eq!(host_stderr_line(b"\r\n"), "[review-sidecar] ");
    assert_eq!(host_stderr_line(b""), "[review-sidecar] ");
    // 沒有換行也一樣
    assert_eq!(
        host_stderr_line(b"no newline"),
        "[review-sidecar] no newline"
    );
}

#[test]
fn newlines_are_removed_before_the_prefix_check() {
    // 去掉結尾換行之後是「[review-sidecar]」(沒有空白)→ 不算已有前綴
    assert_eq!(
        host_stderr_line(b"[review-sidecar]\n"),
        "[review-sidecar] [review-sidecar]"
    );
    assert_eq!(
        host_stderr_line(b"[review-sidecar]\r\n"),
        "[review-sidecar] [review-sidecar]"
    );
    // 有那個空白(後面接換行)→ 算,原樣
    assert_eq!(
        host_stderr_line(b"[review-sidecar] \r\n"),
        "[review-sidecar] "
    );
}

#[test]
fn the_prefix_check_is_byte_exact_starts_with_not_contains_or_trimmed_or_case_folded() {
    let rows: &[(&[u8], &str)] = &[
        (
            b"[REVIEW-SIDECAR] x\n",
            "[review-sidecar] [REVIEW-SIDECAR] x",
        ),
        (
            b"[review-sidecar]\tx\n",
            "[review-sidecar] [review-sidecar]\tx",
        ),
        (
            b"\t[review-sidecar] x\n",
            "[review-sidecar] \t[review-sidecar] x",
        ),
        (
            b" [review-sidecar] x\n",
            "[review-sidecar]  [review-sidecar] x",
        ),
        (
            b"prefix [review-sidecar] x\n",
            "[review-sidecar] prefix [review-sidecar] x",
        ),
        (
            b"[review-sidecar]  two spaces\n",
            "[review-sidecar]  two spaces",
        ),
        (
            b"[review-sidecar ] x\n",
            "[review-sidecar] [review-sidecar ] x",
        ),
        (b"review-sidecar] x\n", "[review-sidecar] review-sidecar] x"),
    ];
    for (raw, want) in rows {
        assert_eq!(
            host_stderr_line(raw),
            *want,
            "raw = {:?}",
            String::from_utf8_lossy(raw)
        );
    }
}

#[test]
fn invalid_utf8_becomes_the_replacement_character_per_bad_byte_and_does_not_panic() {
    assert_eq!(
        host_stderr_line(b"\xff\xfe\n"),
        "[review-sidecar] \u{FFFD}\u{FFFD}"
    );
    assert_eq!(
        host_stderr_line(b"ok \xc3\n"),
        "[review-sidecar] ok \u{FFFD}"
    );
    // 前綴本身後面接壞位元組:前綴是位元組開頭,所以算已有前綴,原樣(壞位元組變 U+FFFD)
    assert_eq!(
        host_stderr_line(b"[review-sidecar] \xff\n"),
        "[review-sidecar] \u{FFFD}"
    );
}

// ───────────────────────────── 2. forward_lines

/// 記下每一次 `write` 的 sink(`flush` 不記)。
#[derive(Clone, Default)]
struct RecordingSink {
    writes: Arc<Mutex<Vec<Vec<u8>>>>,
}
impl Write for RecordingSink {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.writes.lock().unwrap().push(buf.to_vec());
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
impl RecordingSink {
    fn writes(&self) -> Vec<Vec<u8>> {
        self.writes.lock().unwrap().clone()
    }
    fn strings(&self) -> Vec<String> {
        self.writes()
            .iter()
            .map(|w| String::from_utf8_lossy(w).into_owned())
            .collect()
    }
}

#[test]
fn three_input_lines_make_exactly_three_writes_each_one_converted_line_plus_newline() {
    let sink = RecordingSink::default();
    let input: &[u8] = "[review-sidecar] 正在用假 router\nplain\r\nlast one\n".as_bytes();
    let n = forward_lines(BufReader::new(input), sink.clone());
    assert_eq!(n, 3);
    assert_eq!(
        sink.strings(),
        [
            "[review-sidecar] 正在用假 router\n",
            "[review-sidecar] plain\n",
            "[review-sidecar] last one\n"
        ],
        "一行的內容與換行要在同一次 write(不會跟別的執行緒的輸出交錯)"
    );
}

#[test]
fn a_last_line_without_a_trailing_newline_is_still_written_with_one() {
    let sink = RecordingSink::default();
    let n = forward_lines(
        BufReader::new(&b"first\nsecond-no-newline"[..]),
        sink.clone(),
    );
    assert_eq!(n, 2);
    assert_eq!(
        sink.strings(),
        [
            "[review-sidecar] first\n",
            "[review-sidecar] second-no-newline\n"
        ]
    );
}

#[test]
fn empty_input_returns_zero_and_writes_nothing() {
    let sink = RecordingSink::default();
    assert_eq!(forward_lines(BufReader::new(&b""[..]), sink.clone()), 0);
    assert!(sink.writes().is_empty());
}

#[test]
fn empty_lines_are_forwarded_as_prefix_only_lines() {
    let sink = RecordingSink::default();
    assert_eq!(
        forward_lines(BufReader::new(&b"\n\nx\n"[..]), sink.clone()),
        3
    );
    assert_eq!(
        sink.strings(),
        [
            "[review-sidecar] \n",
            "[review-sidecar] \n",
            "[review-sidecar] x\n"
        ]
    );
}

#[test]
fn a_sink_that_accepts_only_a_few_bytes_per_write_still_gets_every_byte() {
    // write_all 會重試;如果實作用單次 write 而不是 write_all,內容會被截掉
    struct Tiny(Arc<Mutex<Vec<u8>>>);
    impl Write for Tiny {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            let n = buf.len().min(3);
            self.0.lock().unwrap().extend_from_slice(&buf[..n]);
            Ok(n)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let got = Arc::new(Mutex::new(Vec::new()));
    let n = forward_lines(
        BufReader::new(&b"hello world\n[review-sidecar] again\n"[..]),
        Tiny(got.clone()),
    );
    assert_eq!(n, 2);
    assert_eq!(
        String::from_utf8(got.lock().unwrap().clone()).unwrap(),
        "[review-sidecar] hello world\n[review-sidecar] again\n"
    );
}

#[test]
fn a_line_is_one_line_even_when_the_reader_hands_it_over_in_tiny_pieces() {
    // 管子一次只給 2 個位元組:forward_lines 要組成完整的一行再寫
    struct Drip<'a>(&'a [u8]);
    impl Read for Drip<'_> {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let n = self.0.len().min(buf.len()).min(2);
            buf[..n].copy_from_slice(&self.0[..n]);
            self.0 = &self.0[n..];
            Ok(n)
        }
    }
    let sink = RecordingSink::default();
    let n = forward_lines(
        BufReader::with_capacity(2, Drip(b"abcdef\nghij\n")),
        sink.clone(),
    );
    assert_eq!(n, 2);
    assert_eq!(
        sink.strings(),
        ["[review-sidecar] abcdef\n", "[review-sidecar] ghij\n"]
    );
}

// ───────────────────────────── 3. 轉送不會自己停

#[test]
fn invalid_utf8_does_not_stop_the_forwarding_the_next_lines_still_come_out() {
    let sink = RecordingSink::default();
    let n = forward_lines(BufReader::new(&b"a\nbad \xff\nlast\n"[..]), sink.clone());
    assert_eq!(
        n, 3,
        "三行都要寫出來(read_line 遇到壞位元組會回 Err 然後停)"
    );
    assert_eq!(
        sink.strings(),
        [
            "[review-sidecar] a\n",
            "[review-sidecar] bad \u{FFFD}\n",
            "[review-sidecar] last\n"
        ]
    );
}

#[test]
fn a_real_read_error_ends_the_loop_and_returns_the_lines_so_far() {
    struct ThenError {
        data: Cursor<Vec<u8>>,
    }
    impl Read for ThenError {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let n = self.data.read(buf)?;
            if n > 0 {
                return Ok(n);
            }
            Err(io::Error::new(io::ErrorKind::Other, "boom"))
        }
    }
    let sink = RecordingSink::default();
    let n = forward_lines(
        BufReader::new(ThenError {
            data: Cursor::new(b"one\ntwo\n".to_vec()),
        }),
        sink.clone(),
    );
    assert_eq!(n, 2);
    assert_eq!(
        sink.strings(),
        ["[review-sidecar] one\n", "[review-sidecar] two\n"]
    );
}

#[test]
fn an_interrupted_read_is_retried_not_treated_as_the_end() {
    struct Hiccup {
        data: Cursor<Vec<u8>>,
        interrupted: bool,
    }
    impl Read for Hiccup {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            if !self.interrupted {
                self.interrupted = true;
                return Err(io::Error::from(io::ErrorKind::Interrupted));
            }
            self.data.read(buf)
        }
    }
    let sink = RecordingSink::default();
    let n = forward_lines(
        BufReader::new(Hiccup {
            data: Cursor::new(b"after the hiccup\nsecond\n".to_vec()),
            interrupted: false,
        }),
        sink.clone(),
    );
    assert_eq!(n, 2);
    assert_eq!(
        sink.strings(),
        [
            "[review-sidecar] after the hiccup\n",
            "[review-sidecar] second\n"
        ]
    );
}

/// 記下自己有沒有被讀到 EOF 的 reader。
struct Watched {
    inner: Cursor<Vec<u8>>,
    saw_eof: Rc<Cell<bool>>,
}
impl Read for Watched {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        if n == 0 {
            self.saw_eof.set(true);
        }
        Ok(n)
    }
}

struct AlwaysFails {
    attempts: Rc<Cell<usize>>,
}
impl Write for AlwaysFails {
    fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
        self.attempts.set(self.attempts.get() + 1);
        Err(io::Error::from(io::ErrorKind::BrokenPipe))
    }
    fn flush(&mut self) -> io::Result<()> {
        Err(io::Error::from(io::ErrorKind::BrokenPipe))
    }
}

#[test]
fn a_sink_that_always_fails_does_not_panic_and_the_reader_is_still_read_to_eof() {
    let saw_eof = Rc::new(Cell::new(false));
    let attempts = Rc::new(Cell::new(0));
    let reader = Watched {
        inner: Cursor::new(b"one\ntwo\nthree\nfour\n".to_vec()),
        saw_eof: saw_eof.clone(),
    };
    let n = forward_lines(
        BufReader::new(reader),
        AlwaysFails {
            attempts: attempts.clone(),
        },
    );
    assert_eq!(n, 4, "寫不出去也要回全部讀到的行數");
    assert!(
        saw_eof.get(),
        "寫失敗不能停止讀:不讀的話側車的 stderr 管子會滿或斷,側車會卡住或死"
    );
    assert!(attempts.get() >= 1, "至少試過寫一次(不是根本沒寫)");
}

#[test]
fn a_sink_that_fails_only_after_the_first_line_still_lets_the_rest_be_read() {
    struct FailAfterFirst {
        ok_writes: usize,
    }
    impl Write for FailAfterFirst {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            if self.ok_writes == 0 {
                return Err(io::Error::from(io::ErrorKind::BrokenPipe));
            }
            self.ok_writes -= 1;
            Ok(buf.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let saw_eof = Rc::new(Cell::new(false));
    let reader = Watched {
        inner: Cursor::new(b"a\nbad \xff\nc\nd\n".to_vec()),
        saw_eof: saw_eof.clone(),
    };
    let n = forward_lines(BufReader::new(reader), FailAfterFirst { ok_writes: 1 });
    assert_eq!(n, 4);
    assert!(saw_eof.get());
}

// ───────────────────────────── 4. 靜態:轉送這一段的原始碼

fn forwarding_source() -> (String, String) {
    let src = fs::read_to_string(manifest_dir().join("src/review_sidecar.rs")).unwrap();
    let from_lines = src
        .find("pub fn forward_lines")
        .expect("review_sidecar.rs 缺 pub fn forward_lines");
    let from_stderr = src
        .find("fn forward_stderr")
        .expect("review_sidecar.rs 缺 fn forward_stderr");
    let body_end = |from: usize| -> usize {
        let rest = &src[from..];
        // 函式結束:行首的 `}`
        from + rest.find("\n}\n").map(|i| i + 3).unwrap_or(rest.len())
    };
    (
        src[from_lines..body_end(from_lines)].to_string(),
        src[from_stderr..body_end(from_stderr)].to_string(),
    )
}

#[test]
fn forward_lines_uses_read_until_and_one_write_all_and_never_eprintln_unwrap_or_expect() {
    let (lines_fn, _) = forwarding_source();
    assert!(
        lines_fn.contains("read_until"),
        "用 read_until 讀位元組,不用 read_line"
    );
    assert!(
        !lines_fn.contains("read_line"),
        "read_line 遇到壞位元組會回 Err"
    );
    assert!(lines_fn.contains("write_all"), "一行一次 write_all");
    assert!(
        !lines_fn.contains("writeln!") && !lines_fn.contains("write!("),
        "writeln! 會把內容和換行分兩次寫"
    );
    for banned in [
        "eprintln!",
        "eprint!",
        "println!",
        ".unwrap()",
        ".expect(",
        "panic!",
    ] {
        assert!(
            !lines_fn.contains(banned),
            "forward_lines 不該有 {banned}(寫失敗不能 panic)"
        );
    }
}

#[test]
fn forward_stderr_is_only_wiring_a_thread_running_forward_lines_on_the_real_stderr() {
    let (_, stderr_fn) = forwarding_source();
    assert!(
        stderr_fn.contains("thread::spawn") || stderr_fn.contains("std::thread::spawn"),
        "要開一條執行緒"
    );
    assert!(
        stderr_fn.contains("forward_lines"),
        "轉送交給 forward_lines"
    );
    assert!(
        stderr_fn.contains("io::stderr()"),
        "寫進 app 的 stderr(std::io::stderr())"
    );
    assert!(stderr_fn.contains("BufReader"), "包 BufReader");
    for banned in ["eprintln!", "read_line", ".unwrap()", ".expect("] {
        assert!(
            !stderr_fn.contains(banned),
            "forward_stderr 不該有 {banned}"
        );
    }
}

#[test]
fn the_two_rust_own_dropped_line_messages_are_untouched() {
    let src = fs::read_to_string(manifest_dir().join("src/review_sidecar.rs")).unwrap();
    assert_eq!(
        src.matches("eprintln!(\"[review-sidecar] dropped non-protocol line\")")
            .count(),
        2,
        "Rust 自己印的兩個地方照舊(不經過 host_stderr_line)"
    );
}

// ───────────────────────────── 5. 接線

const HELLO: &str = r#"{"v":1,"kind":"hello","fakeCloud":false,"today":"2026-09-10"}"#;

/// 先往 stderr 印幾種行(已有前綴、沒有前綴、CRLF、壞位元組、壞位元組之後的一行),再印 hello、回一則;
/// stdin 結束之後最後再印一行 tail marker(測試靠它知道轉送做完了,不用睡)。
const SCRIPT: &str = r#"
printf '[review-sidecar] 正在用假 router\n' >&2
printf 'plain from dependency\n' >&2
printf 'crlf line\r\n' >&2
printf 'bad \377 byte\n' >&2
printf 'after bad\n' >&2
printf '%s\n' "$HELLO"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  printf '%s\n' "$RESP" | sed "s/__ID__/$id/"
done
printf 'tail marker\n' >&2
"#;

const OK_RESP: &str = r#"{"v":1,"id":__ID__,"ok":true,"result":{"echoed":true}}"#;

const CHILD_ENV: &str = "LC_T28_CHILD";
const CAPTURE_ENV: &str = "LC_T28_STDERR_FILE";

fn expected_forwarded_lines() -> Vec<String> {
    vec![
        "[review-sidecar] 正在用假 router".to_string(),
        "[review-sidecar] plain from dependency".to_string(),
        "[review-sidecar] crlf line".to_string(),
        "[review-sidecar] bad \u{FFFD} byte".to_string(),
        "[review-sidecar] after bad".to_string(),
        "[review-sidecar] tail marker".to_string(),
    ]
}

fn temp_dir(tag: &str) -> PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "lc-t28-{tag}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// 子行程那一半:fd 2 接到檔案,起 SidecarHost、call 一次、shutdown,然後等到 tail marker 出現在檔案裡。
fn child_half() {
    let capture = PathBuf::from(std::env::var(CAPTURE_ENV).expect("子行程要有擷取檔路徑"));
    let file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&capture)
        .unwrap();
    // 之後這個行程所有寫到 stderr 的東西(包含轉送執行緒的)都進這個檔案
    let rc = unsafe { libc::dup2(file.as_raw_fd(), 2) };
    assert_eq!(rc, 2, "dup2 失敗");

    let dir = temp_dir("child");
    let spec = SidecarSpec {
        program: "sh".to_string(),
        args: vec!["-c".to_string(), SCRIPT.to_string()],
        cwd: dir.clone(),
        env: vec![
            ("PATH".to_string(), "/usr/bin:/bin".to_string()),
            ("HELLO".to_string(), HELLO.to_string()),
            ("RESP".to_string(), OK_RESP.to_string()),
        ],
    };
    let timeouts = SidecarTimeouts {
        hello: Duration::from_secs(20),
        request: Duration::from_secs(20),
        exit_grace: Duration::from_secs(5),
    };
    let host = SidecarHost::new(Box::new(move || Ok(spec.clone())), timeouts);
    let reply = host
        .call(&json!({"v": 1, "id": 1, "method": "status", "params": {}}))
        .expect("假側車要回應");
    assert_eq!(reply["ok"], json!(true));
    host.shutdown();

    // 條件式等待:最後一行出現就收(有上限,上限是給「根本沒有轉送」的紅時間停下來,不是正常路徑要等的)
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(15) {
        if fs::read_to_string(&capture)
            .map(|t| t.contains("tail marker"))
            .unwrap_or(false)
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn what_the_sidecar_prints_reaches_the_app_stderr_with_exactly_one_prefix_per_line() {
    if std::env::var_os(CHILD_ENV).is_some() {
        child_half();
        return;
    }

    let dir = temp_dir("parent");
    let capture = dir.join("app-stderr.txt");
    fs::write(&capture, b"").unwrap();
    let exe = std::env::current_exe().unwrap();
    let out = Command::new(exe)
        .args([
            "--exact",
            "what_the_sidecar_prints_reaches_the_app_stderr_with_exactly_one_prefix_per_line",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(CHILD_ENV, "1")
        .env(CAPTURE_ENV, &capture)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("重跑自己失敗");
    let child_stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let raw = fs::read(&capture).unwrap();
    let captured = String::from_utf8_lossy(&raw).into_owned();
    let _ = fs::remove_dir_all(&dir);

    assert!(
        out.status.success(),
        "子行程失敗:\n{child_stdout}\n--- 擷取到的 stderr ---\n{captured}"
    );
    let got: Vec<String> = captured
        .split_inclusive('\n')
        .map(|l| l.strip_suffix('\n').unwrap_or(l).to_string())
        .collect();
    assert_eq!(
        got,
        expected_forwarded_lines(),
        "app stderr 要剛好是換好的樣子、順序一樣、各一次:\n{captured}"
    );
    assert!(
        !captured.contains("[review-sidecar] [review-sidecar]"),
        "前綴印了兩次:\n{captured}"
    );
    assert!(raw.ends_with(b"\n"));
}
