//! T22 驗收 5:複習側車的 Rust 端(`src/review_sidecar.rs`)。紅測試作者寫;開發 worker 不改。
//!
//! 三塊:
//!   1. 純函式:常數、`child_env`(白名單重建)、`sidecar_command`、`request_line` / `parse_response_line`
//!      對 `packages/core/src/session/protocol.vectors.json` 的每一列(TS 讀同一份,見 protocol.test.ts);
//!   2. 靜態:`review_sidecar.rs` 不出現 method 名字與 result / error 的字串比對(Rust 原樣傳遞,不看內容);
//!   3. `SidecarHost` 的生命週期:用一支假側車(`sh -c` 小腳本,行為由環境變數 MODE 決定)測 lazy 起行程、
//!      原樣傳遞、舊回應與非協定行丟掉、超長行、逾時、側車結束後重起、busy、id 遞增、起不來、關 app 收乾淨。
//!      逾時與等待時間用注入的短值(不真的等 180 秒)。
//!
//! 簽名在 `src/review_sidecar.rs` 的 stub 裡固定:`SidecarHost::new(provider, timeouts)`、`call(&Value)`、`shutdown()`、`child_pid()`。
//! 工單只寫了純函式與「逾時與等待時間可以注入」;`SidecarHost` 的建構細節由這份測試固定,協調者轉進工單。
//! 不開真的 node、不碰網路、不碰 learning/。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use learning_cards_desktop::review_sidecar::{
    child_env, parse_response_line, request_line, sidecar_command, ReviewError, SidecarHost, SidecarSpec, SidecarTimeouts, CHILD_ENV_ALLOWLIST,
    DEBUG_ONLY_ENV, HELLO_TIMEOUT, MAX_LINE_BYTES, REQUEST_TIMEOUT,
};
use serde_json::{json, Value};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

// ───────────────────────────── 常數

#[test]
fn the_constants_are_fixed() {
    assert_eq!(MAX_LINE_BYTES, 262_144);
    assert_eq!(HELLO_TIMEOUT, Duration::from_secs(20));
    assert_eq!(REQUEST_TIMEOUT, Duration::from_secs(180));
    assert_eq!(
        CHILD_ENV_ALLOWLIST,
        ["PATH", "HOME", "USER", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]
    );
    assert_eq!(DEBUG_ONLY_ENV, ["LC_REVIEW_FAKE_CLOUD", "LC_REVIEW_TODAY"]);
}

// ───────────────────────────── 子行程的環境:白名單,不是黑名單

fn env_of(pairs: &[(&str, &str)]) -> impl Iterator<Item = (String, String)> {
    pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<Vec<_>>().into_iter()
}

const NOISY_ENV: &[(&str, &str)] = &[
    ("PATH", "/usr/bin"),
    ("HOME", "/home/someone"),
    ("USER", "someone"),
    ("LANG", "C.UTF-8"),
    ("XDG_CACHE_HOME", "/cache"),
    ("XDG_CONFIG_HOME", "/config"),
    ("NODE_OPTIONS", "--require /evil.js"),
    ("OPENAI_API_KEY", "sk-should-not-travel"),
    ("ANTHROPIC_API_KEY", "sk-ant-should-not-travel"),
    ("LLM_DAILY_CAP_USD", "99"),
    ("LLM_CLOUD_PROVIDER", "openai"),
    ("FOO", "bar"),
    ("LC_REVIEW_FAKE_CLOUD", "/tmp/fake.mjs"),
    ("LC_REVIEW_TODAY", "2026-01-01"),
    ("RUST_LOG", "debug"),
    ("LD_PRELOAD", "/evil.so"),
];

fn keys(env: &[(String, String)]) -> Vec<String> {
    let mut k: Vec<String> = env.iter().map(|(k, _)| k.clone()).collect();
    k.sort();
    k
}

#[test]
fn a_release_child_gets_only_the_allowlist_and_never_the_two_test_variables() {
    let got = child_env(false, env_of(NOISY_ENV));
    assert_eq!(keys(&got), ["HOME", "LANG", "PATH", "USER", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"]);
    for (k, v) in &got {
        let original = NOISY_ENV.iter().find(|(ok, _)| ok == k).map(|(_, ov)| *ov);
        assert_eq!(Some(v.as_str()), original, "{k} 的值要原樣");
    }
}

#[test]
fn a_debug_child_also_gets_the_two_test_variables_but_nothing_else_outside_the_list() {
    let got = child_env(true, env_of(NOISY_ENV));
    assert_eq!(keys(&got), ["HOME", "LANG", "LC_REVIEW_FAKE_CLOUD", "LC_REVIEW_TODAY", "PATH", "USER", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"]);
}

#[test]
fn neither_build_passes_node_options_keys_llm_or_anything_unlisted() {
    for debug in [false, true] {
        let got = child_env(debug, env_of(NOISY_ENV));
        for banned in ["NODE_OPTIONS", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LLM_DAILY_CAP_USD", "LLM_CLOUD_PROVIDER", "FOO", "RUST_LOG", "LD_PRELOAD"] {
            assert!(!keys(&got).contains(&banned.to_string()), "debug={debug}:{banned} 不能帶進子行程");
        }
    }
}

#[test]
fn variables_that_are_not_set_are_not_invented() {
    assert_eq!(child_env(true, env_of(&[])), Vec::<(String, String)>::new());
    let only_path = child_env(false, env_of(&[("PATH", "/bin")]));
    assert_eq!(only_path, vec![("PATH".to_string(), "/bin".to_string())]);
}

// ───────────────────────────── 起側車的指令

#[test]
fn the_sidecar_command_is_node_with_tsx_and_the_two_paths() {
    let (program, args, cwd) = sidecar_command(Path::new("/repo/root"), Path::new("/home/x/learning"));
    assert_eq!(program, "node");
    assert_eq!(args, ["--import", "tsx", "/repo/root/scripts/review-sidecar.ts", "--dir", "/home/x/learning"]);
    assert_eq!(cwd, PathBuf::from("/repo/root"));
}

// ───────────────────────────── 向量(TS 讀同一份)

fn vectors() -> Value {
    let path = manifest_dir().join("../../../packages/core/src/session/protocol.vectors.json");
    serde_json::from_str(&fs::read_to_string(&path).expect("讀不到 protocol.vectors.json")).expect("protocol.vectors.json 不是合法 JSON")
}

/// 向量的一行:`line` 照抄;`parts` 的 `{cp}` 是碼點、`{repeat,times}` 是重複。
fn line_of(entry: &Value) -> String {
    if let Some(line) = entry.get("line").and_then(Value::as_str) {
        return line.to_string();
    }
    let mut out = String::new();
    for part in entry["parts"].as_array().expect("parts") {
        match part {
            Value::String(s) => out.push_str(s),
            Value::Object(o) if o.contains_key("cp") => out.push(char::from_u32(o["cp"].as_u64().unwrap() as u32).unwrap()),
            Value::Object(o) => out.push_str(&o["repeat"].as_str().unwrap().repeat(o["times"].as_u64().unwrap() as usize)),
            other => panic!("看不懂的 part:{other}"),
        }
    }
    out
}

#[test]
fn the_vector_file_is_the_one_ts_reads() {
    let v = vectors();
    assert_eq!(v["maxLineBytes"], json!(MAX_LINE_BYTES));
    let rust_judged = |list: &str| v[list].as_array().unwrap().iter().filter(|e| matches!(e["rust"].as_str(), Some("accept") | Some("reject"))).count();
    assert!(rust_judged("requests") >= 40, "請求向量裡 Rust 要判的列不夠:{}", rust_judged("requests"));
    assert!(rust_judged("responses") >= 8, "回應向量裡 Rust 要判的列不夠:{}", rust_judged("responses"));
}

#[test]
fn request_line_judges_every_request_vector_the_way_the_file_says() {
    for entry in vectors()["requests"].as_array().unwrap() {
        let name = entry["name"].as_str().unwrap();
        let expect = entry["rust"].as_str().unwrap();
        if expect == "n/a" || expect == "either" {
            continue;
        }
        let line = line_of(entry);
        let value: Value = serde_json::from_str(&line).unwrap_or_else(|e| panic!("向量「{name}」標了 Rust 要判,但不是 JSON:{e}"));
        let got = request_line(&value);
        match expect {
            "accept" => {
                let out = got.unwrap_or_else(|e| panic!("向量「{name}」要接受,卻被拒絕:{e:?}"));
                assert!(!out.contains('\n') && !out.contains('\r'), "「{name}」:輸出必須是一行");
                assert!(out.len() <= MAX_LINE_BYTES, "「{name}」:輸出超過上限");
                let back: Value = serde_json::from_str(&out).expect("輸出要是合法 JSON");
                assert_eq!(back, value, "「{name}」:內容必須原樣(不加欄位、不改值)");
            }
            "reject" => {
                let e = got.expect_err(&format!("向量「{name}」要拒絕,卻被接受"));
                assert_eq!(e.kind, "bad-envelope", "「{name}」");
            }
            other => panic!("看不懂的 rust 欄位:{other}"),
        }
    }
}

#[test]
fn parse_response_line_judges_every_response_vector_the_way_the_file_says() {
    for entry in vectors()["responses"].as_array().unwrap() {
        let name = entry["name"].as_str().unwrap();
        let expect = entry["rust"].as_str().unwrap();
        if expect == "either" || expect == "n/a" {
            continue;
        }
        let line = line_of(entry);
        let got = parse_response_line(&line);
        match expect {
            "accept" => {
                let value = got.unwrap_or_else(|e| panic!("回應向量「{name}」要接受,卻被拒絕:{e:?}"));
                let want: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(value, want, "「{name}」:要原樣回傳");
            }
            "reject" => {
                let e = got.expect_err(&format!("回應向量「{name}」要拒絕,卻被接受"));
                assert_eq!(e.kind, "bad-response", "「{name}」");
            }
            other => panic!("看不懂的 rust 欄位:{other}"),
        }
    }
}

#[test]
fn the_envelope_check_is_by_type_not_by_looking_inside_params_or_method() {
    // Rust 不看 method 的值與 params 的內容:這些 TS 會拒絕的,Rust 要放行(交給側車回 unknown-method / bad-request)
    for request in [
        json!({"v": 1, "id": 1, "method": "Start", "params": {}}),
        json!({"v": 1, "id": 1, "method": "pause", "params": {}}),
        json!({"v": 1, "id": 1, "method": "status", "params": {"path": "cards/x.md"}}),
        json!({"v": 1, "id": 1, "method": "submit", "params": {"fill": "not-an-array"}}),
    ] {
        let line = request_line(&request).unwrap_or_else(|e| panic!("{request}:{e:?}"));
        assert_eq!(serde_json::from_str::<Value>(&line).unwrap(), request);
    }
}

#[test]
fn a_request_over_the_limit_is_refused_and_one_under_it_is_not() {
    let make = |n: usize| json!({"v": 1, "id": 1, "method": "submit", "params": {"apply": "a".repeat(n)}});
    assert!(request_line(&make(1000)).is_ok());
    assert_eq!(request_line(&make(MAX_LINE_BYTES)).unwrap_err().kind, "bad-envelope");
    assert_eq!(request_line(&make(MAX_LINE_BYTES * 2)).unwrap_err().kind, "bad-envelope");
}

#[test]
fn parse_response_line_refuses_a_line_over_the_limit() {
    let line = format!("{{\"v\":1,\"id\":1,\"ok\":true,\"result\":{{\"t\":\"{}\"}}}}", "a".repeat(MAX_LINE_BYTES));
    assert_eq!(parse_response_line(&line).unwrap_err().kind, "bad-response");
}

// ───────────────────────────── 靜態:Rust 原樣傳遞

fn strip_rust_comments(src: &str) -> String {
    let mut out = String::new();
    let mut chars = src.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '/' && chars.peek() == Some(&'/') {
            for d in chars.by_ref() {
                if d == '\n' {
                    out.push('\n');
                    break;
                }
            }
        } else if c == '/' && chars.peek() == Some(&'*') {
            chars.next();
            let mut prev = ' ';
            for d in chars.by_ref() {
                if prev == '*' && d == '/' {
                    break;
                }
                prev = d;
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[test]
fn rust_never_looks_at_the_method_name_or_the_result_or_error_content() {
    let src = strip_rust_comments(&fs::read_to_string(manifest_dir().join("src/review_sidecar.rs")).expect("src/review_sidecar.rs"));
    for banned in ["\"start\"", "\"next\"", "\"submit\"", "\"summary\"", "\"status\"", "\"result\"", "\"error\"", "\"ok\""] {
        assert!(!src.contains(banned), "review_sidecar.rs 不能比對 {banned}(Rust 不看 method / result / error 的內容,只看信封)");
    }
}

// ───────────────────────────── SidecarHost:假側車

const HELLO: &str = r#"{"v":1,"kind":"hello","fakeCloud":false,"today":"2026-09-10"}"#;

/// 假側車。MODE:
///   echo           每則請求回 RESP(__ID__ 換成請求的 id)
///   stale          先回一個 id 999 的舊回應,再回對的
///   stale2         先印 STALE(環境變數給的一整行舊回應,id 由測試決定),再回對的(T40:舊回應的 id 剛好等於 webview 的 id)
///   noise          先印兩行非協定行(一行文字、一個 JSON 陣列),再回對的
///   big            回一行 300000 個字元(超過上限)
///   silent         收到請求不回(sleep 30)
///   exit           收到第一則請求就結束(退出碼 3)
///   slow           睡 1 秒再回
///   nohello        不印 hello
///   stubborn       回第一則之後不再讀 stdin、睡 30 秒(關 stdin 不會讓它結束,要被 kill)
///   envdump        把自己的環境印到 ENVOUT 再回
const SCRIPT: &str = r#"
printf '%s\n' "$$" > "$PIDFILE"
if [ "$MODE" = nohello ]; then sleep 30; exit 0; fi
printf '%s\n' "$HELLO"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$LOG"
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  resp=$(printf '%s' "$RESP" | sed "s/__ID__/$id/")
  case "$MODE" in
    echo) printf '%s\n' "$resp" ;;
    stale) printf '%s\n' "$(printf '%s' "$RESP" | sed 's/__ID__/999/')"; printf '%s\n' "$resp" ;;
    stale2) printf '%s\n' "$STALE"; printf '%s\n' "$resp" ;;
    noise) printf '%s\n' 'hello world not json'; printf '%s\n' '[1,2,3]'; printf '%s\n' "$resp" ;;
    big) head -c 300000 /dev/zero | tr '\0' 'a'; printf '\n' ;;
    silent) sleep 30 ;;
    exit) exit 3 ;;
    slow) sleep 1; printf '%s\n' "$resp" ;;
    stubborn) printf '%s\n' "$resp"; sleep 30; exit 0 ;;
    envdump) env > "$ENVOUT"; printf '%s\n' "$resp" ;;
  esac
done
# stdin 結束(EOF)之後的收尾:慢一點才完成,證明 host 是關 stdin 後「等」它,不是直接殺
if [ "$MODE" = echo ]; then sleep 0.4; printf done > "$DONEFILE"; fi
"#;

const OK_RESP: &str = r#"{"v":1,"id":__ID__,"ok":true,"result":{"echoed":true}}"#;

struct Fixture {
    dir: PathBuf,
}
impl Fixture {
    fn new(tag: &str) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("lc-t22-{tag}-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Self { dir }
    }
    /// 假側車啟動時把自己的 pid 寫在這(host 逾時 / 結束 / 起不來之後,拿它確認行程真的沒了、不是殭屍)
    fn pid(&self) -> Option<u32> {
        fs::read_to_string(self.dir.join("pid")).ok().and_then(|t| t.trim().parse().ok())
    }
    fn log(&self) -> PathBuf {
        self.dir.join("received.log")
    }
    fn log_lines(&self) -> Vec<String> {
        fs::read_to_string(self.log()).map(|t| t.lines().map(str::to_string).collect()).unwrap_or_default()
    }
    fn spec(&self, mode: &str, resp: &str) -> SidecarSpec {
        SidecarSpec {
            program: "sh".to_string(),
            args: vec!["-c".to_string(), SCRIPT.to_string()],
            cwd: self.dir.clone(),
            env: vec![
                ("PATH".to_string(), "/usr/bin:/bin".to_string()),
                ("MODE".to_string(), mode.to_string()),
                ("LOG".to_string(), self.log().display().to_string()),
                ("HELLO".to_string(), HELLO.to_string()),
                ("RESP".to_string(), resp.to_string()),
                ("ENVOUT".to_string(), self.dir.join("env.out").display().to_string()),
                ("PIDFILE".to_string(), self.dir.join("pid").display().to_string()),
                ("DONEFILE".to_string(), self.dir.join("cleanup.done").display().to_string()),
            ],
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn timeouts(hello_ms: u64, request_ms: u64, grace_ms: u64) -> SidecarTimeouts {
    SidecarTimeouts { hello: Duration::from_millis(hello_ms), request: Duration::from_millis(request_ms), exit_grace: Duration::from_millis(grace_ms) }
}

fn host_with(spec: SidecarSpec, t: SidecarTimeouts) -> SidecarHost {
    SidecarHost::new(Box::new(move || Ok(spec.clone())), t)
}

fn req(id: u64) -> Value {
    json!({"v": 1, "id": id, "method": "status", "params": {}})
}

/// received.log 每一行的 id(側車那一側看到的線上 id)
fn wire_ids(fx: &Fixture) -> Vec<u64> {
    fx.log_lines().iter().map(|l| serde_json::from_str::<Value>(l).expect("log 的每一行是 JSON")["id"].as_u64().expect("id 是正整數")).collect()
}

fn kind(e: ReviewError) -> String {
    e.kind
}

fn wait_gone(pid: u32, secs: u64) -> bool {
    let end = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < end {
        if !Path::new(&format!("/proc/{pid}")).exists() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

// ───────────────────────────── SidecarHost:生命週期

#[test]
fn the_sidecar_starts_on_the_first_call_not_before_and_is_reused() {
    let fx = Fixture::new("lazy");
    let host = host_with(fx.spec("echo", OK_RESP), timeouts(3000, 5000, 1000));
    assert_eq!(host.child_pid(), None, "建好 host 還沒有行程");
    host.call(&req(1)).expect("第一次呼叫");
    let pid = host.child_pid().expect("第一次呼叫之後有行程");
    host.call(&req(2)).expect("第二次呼叫");
    assert_eq!(host.child_pid(), Some(pid), "同一個行程,不是每次重起");
    host.shutdown();
}

#[test]
fn the_request_is_written_as_request_line_says_and_the_response_comes_back_untouched() {
    let fx = Fixture::new("echo");
    let resp = r#"{"v":1,"id":__ID__,"ok":true,"result":{"kind":"question","nested":{"a":[1,2,{"b":null}]},"text":"中文 😀"}}"#;
    let host = host_with(fx.spec("echo", resp), timeouts(3000, 5000, 1000));
    let request = json!({"v": 1, "id": 7, "method": "submit", "params": {"fill": ["a,b", "c"]}});
    let got = host.call(&request).unwrap();
    assert_eq!(got["id"], json!(7));
    assert_eq!(got["result"]["nested"], json!({"a": [1, 2, {"b": null}]}));
    assert_eq!(got["result"]["text"], json!("中文 😀"));
    let sent = fx.log_lines();
    assert_eq!(sent.len(), 1);
    // T40/ADR-078:寫進側車的是「換過線上 id」的請求(第一個請求的線上 id 是 1),其餘欄位原樣;回應的 id 換回 webview 的 7
    let on_the_wire = json!({"v": 1, "id": 1, "method": "submit", "params": {"fill": ["a,b", "c"]}});
    assert_eq!(sent[0], request_line(&on_the_wire).unwrap(), "寫進側車的就是 request_line 對(換了線上 id 的)請求的輸出");
    host.shutdown();
}

#[test]
fn a_business_error_from_the_sidecar_is_returned_as_is_not_as_a_rust_error() {
    let fx = Fixture::new("biz");
    let resp = r#"{"v":1,"id":__ID__,"ok":false,"error":{"kind":"no-session","message":"x"}}"#;
    let host = host_with(fx.spec("echo", resp), timeouts(3000, 5000, 1000));
    let got = host.call(&req(1)).expect("ok:false 是業務錯誤,不是 Rust 的 Err");
    assert_eq!(got["ok"], json!(false));
    assert_eq!(got["error"]["kind"], json!("no-session"));
    host.shutdown();
}

#[test]
fn a_stale_response_with_another_id_is_dropped_and_the_right_one_is_returned() {
    let fx = Fixture::new("stale");
    let host = host_with(fx.spec("stale", OK_RESP), timeouts(3000, 5000, 1000));
    let got = host.call(&req(4)).unwrap();
    assert_eq!(got["id"], json!(4));
    host.shutdown();
}

#[test]
fn lines_that_are_not_protocol_lines_are_dropped_and_never_returned() {
    let fx = Fixture::new("noise");
    let host = host_with(fx.spec("noise", OK_RESP), timeouts(3000, 5000, 1000));
    let got = host.call(&req(2)).unwrap();
    assert_eq!(got["id"], json!(2));
    assert_eq!(got["ok"], json!(true));
    host.shutdown();
}

#[test]
fn a_response_line_over_the_limit_becomes_bad_response() {
    let fx = Fixture::new("big");
    let host = host_with(fx.spec("big", OK_RESP), timeouts(3000, 5000, 1000));
    assert_eq!(kind(host.call(&req(1)).unwrap_err()), "bad-response");
    host.shutdown();
}

#[test]
fn an_invalid_envelope_is_refused_before_anything_starts() {
    let fx = Fixture::new("badenv");
    let host = host_with(fx.spec("echo", OK_RESP), timeouts(3000, 5000, 1000));
    for bad in [
        json!({"v": 2, "id": 1, "method": "status", "params": {}}),
        json!({"v": 1, "id": "1", "method": "status", "params": {}}),
        json!({"v": 1, "id": 0, "method": "status", "params": {}}),
        json!({"v": 1, "id": 1, "method": 5, "params": {}}),
        json!({"v": 1, "id": 1, "method": "status", "params": []}),
    ] {
        assert_eq!(kind(host.call(&bad).unwrap_err()), "bad-envelope", "{bad}");
    }
    assert_eq!(host.child_pid(), None, "信封不合就不該起側車");
    assert!(fx.log_lines().is_empty());
}

// ───────────────────────────── T40/ADR-078:id 由 Rust 編(線上 id 只增不減;webview 的 id 原樣換回去)
//
// 舊規則(「id 沒有比上一個大就 bad-envelope」)把兩個視窗共用側車時各自從 1 數的 client 擋掉了(T37 @manual 的 F2、F3)。
// 舊測試 request_ids_must_increase_and_a_refused_one_is_not_sent 把那條規則釘住,這裡換成下面這幾條:
//   - 兩個 client 交錯、各自從 1 數:全部成功,線上 id 一路變大,回應的 id 是 webview 送的那個;
//   - 同一個 client 從 1 重新數(視窗重新載入)成功;
//   - 線上 id 跨側車重起不歸零;信封檢查沒過的請求不用掉線上 id;
//   - 舊回應(id 跟線上 id 不同)丟掉 —— 就算它的 id 等於 webview 的 id。

#[test]
fn two_clients_that_both_count_from_one_can_interleave_and_the_wire_ids_keep_growing() {
    let fx = Fixture::new("interleave");
    let host = host_with(fx.spec("echo", OK_RESP), timeouts(3000, 5000, 1000));
    // 考試卡與教學卡各自從 1 數:1、1、2、2、3
    for webview_id in [1u64, 1, 2, 2, 3] {
        let got = host.call(&req(webview_id)).unwrap_or_else(|e| panic!("webview id {webview_id} 不該被拒絕:{e:?}"));
        assert_eq!(got["id"], json!(webview_id), "回應的 id 要換回 webview 送的那個");
        assert_eq!(got["ok"], json!(true));
    }
    assert_eq!(wire_ids(&fx), [1, 2, 3, 4, 5], "側車收到的 id:從 1 起、一個都不重複、一直變大");
    host.shutdown();
}

#[test]
fn a_client_that_starts_counting_from_one_again_after_larger_ids_still_succeeds() {
    let fx = Fixture::new("renumber");
    let host = host_with(fx.spec("echo", OK_RESP), timeouts(3000, 5000, 1000));
    host.call(&req(5)).unwrap();
    host.call(&req(6)).unwrap();
    let again = host.call(&req(1)).expect("視窗重新載入、從 1 重新數:不能被拒絕");
    assert_eq!(again["id"], json!(1));
    assert_eq!(wire_ids(&fx), [1, 2, 3], "線上 id 照樣變大(不是跟著 webview id 走)");
    host.shutdown();
}

#[test]
fn the_same_webview_id_twice_in_a_row_is_fine_each_gets_its_own_wire_id() {
    let fx = Fixture::new("dup-webview");
    let host = host_with(fx.spec("echo", OK_RESP), timeouts(3000, 5000, 1000));
    host.call(&req(7)).unwrap();
    host.call(&req(7)).unwrap();
    assert_eq!(wire_ids(&fx), [1, 2]);
    host.shutdown();
}

#[test]
fn the_response_id_is_the_one_the_webview_sent_larger_and_smaller_than_the_wire_id() {
    let fx = Fixture::new("restore");
    let host = host_with(fx.spec("echo", OK_RESP), timeouts(3000, 5000, 1000));
    let big = 9_007_199_254_740_991u64; // 2^53 - 1:JavaScript 能精確表示的最大整數
    let a = host.call(&req(big)).unwrap();
    assert_eq!(a["id"], json!(big), "webview id 比線上 id 大:要換回原值");
    let b = host.call(&req(1)).unwrap();
    assert_eq!(b["id"], json!(1), "webview id 比線上 id(現在是 2)小:要換回原值");
    let c = host.call(&req(2)).unwrap();
    assert_eq!(c["id"], json!(2), "webview id 跟線上 id(3)不同:換回原值");
    assert_eq!(wire_ids(&fx), [1, 2, 3]);
    // 其餘欄位原樣
    assert_eq!(a["ok"], json!(true));
    assert_eq!(a["result"], json!({"echoed": true}));
    host.shutdown();
}

#[test]
fn a_business_error_response_also_gets_the_webview_id_back() {
    let fx = Fixture::new("restore-biz");
    let resp = r#"{"v":1,"id":__ID__,"ok":false,"error":{"kind":"no-session","message":"x"}}"#;
    let host = host_with(fx.spec("echo", resp), timeouts(3000, 5000, 1000));
    host.call(&req(10)).unwrap();
    let got = host.call(&req(3)).unwrap();
    assert_eq!(got["id"], json!(3));
    assert_eq!(got["error"]["kind"], json!("no-session"));
    host.shutdown();
}

#[test]
fn the_wire_id_does_not_reset_when_the_sidecar_is_restarted_after_a_timeout() {
    let fx = Fixture::new("restart-timeout");
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&calls);
    let (silent, echo) = (fx.spec("silent", OK_RESP), fx.spec("echo", OK_RESP));
    let host = SidecarHost::new(
        Box::new(move || Ok(if counter.fetch_add(1, Ordering::SeqCst) == 0 { silent.clone() } else { echo.clone() })),
        timeouts(3000, 500, 1000),
    );
    assert_eq!(kind(host.call(&req(1)).unwrap_err()), "timeout");
    let got = host.call(&req(1)).expect("下一個請求重起側車,webview 的 id 一樣是 1 也可以");
    assert_eq!(got["id"], json!(1));
    assert_eq!(wire_ids(&fx), [1, 2], "新側車收到的線上 id 接著數(2),不是歸 1;log 檔兩個側車共用");
    host.shutdown();
}

#[test]
fn the_wire_id_does_not_reset_when_the_sidecar_exited() {
    let fx = Fixture::new("restart-exit");
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&calls);
    let (dying, echo) = (fx.spec("exit", OK_RESP), fx.spec("echo", OK_RESP));
    let host = SidecarHost::new(
        Box::new(move || Ok(if counter.fetch_add(1, Ordering::SeqCst) == 0 { dying.clone() } else { echo.clone() })),
        timeouts(3000, 5000, 1000),
    );
    assert_eq!(kind(host.call(&req(4)).unwrap_err()), "sidecar-exited");
    host.call(&req(2)).unwrap();
    host.call(&req(3)).unwrap();
    assert_eq!(wire_ids(&fx), [1, 2, 3]);
    host.shutdown();
}

#[test]
fn a_request_refused_by_the_envelope_check_does_not_use_up_a_wire_id() {
    let fx = Fixture::new("refused-no-id");
    let host = host_with(fx.spec("echo", OK_RESP), timeouts(3000, 5000, 1000));
    assert_eq!(kind(host.call(&json!({"v": 1, "id": 0, "method": "status", "params": {}})).unwrap_err()), "bad-envelope");
    host.call(&req(8)).unwrap();
    assert_eq!(wire_ids(&fx), [1], "被信封檢查擋下的請求沒有送進側車,也沒有用掉線上 id");
    host.shutdown();
}

#[test]
fn a_stale_response_is_matched_on_the_wire_id_even_when_it_carries_the_webview_id() {
    let fx = Fixture::new("stale-webview-id");
    let mut spec = fx.spec("stale2", OK_RESP);
    // 舊回應的 id 是 999,內容和對的那個不同;webview 送的 id 剛好也是 999(線上 id 是 1)
    spec.env.push(("STALE".to_string(), r#"{"v":1,"id":999,"ok":true,"result":{"stale":true}}"#.to_string()));
    let host = host_with(spec, timeouts(3000, 5000, 1000));
    let got = host.call(&req(999)).unwrap();
    assert_eq!(got["id"], json!(999));
    assert_eq!(got["result"], json!({"echoed": true}), "id 跟 webview id 一樣的舊回應不是答案(比對的是線上 id)");
    host.shutdown();
}

#[test]
fn the_envelope_check_still_requires_a_positive_integer_id_and_refuses_before_anything_starts() {
    let fx = Fixture::new("badenv-ids");
    let host = host_with(fx.spec("echo", OK_RESP), timeouts(3000, 5000, 1000));
    for bad in [
        json!({"v": 1, "id": 0, "method": "status", "params": {}}),
        json!({"v": 1, "id": -1, "method": "status", "params": {}}),
        json!({"v": 1, "id": 1.5, "method": "status", "params": {}}),
        json!({"v": 1, "id": "7", "method": "status", "params": {}}),
        json!({"v": 1, "id": null, "method": "status", "params": {}}),
        json!({"v": 1, "id": true, "method": "status", "params": {}}),
        json!({"v": 1, "method": "status", "params": {}}),
    ] {
        assert_eq!(kind(host.call(&bad).unwrap_err()), "bad-envelope", "{bad}");
    }
    assert_eq!(host.child_pid(), None, "信封不合就不該起側車");
    assert!(fx.log_lines().is_empty());
}

#[test]
fn the_child_environment_is_exactly_what_the_spec_says() {
    // 這個行程自己的環境變數不能漏進子行程(env_clear 之後逐一帶入 spec.env)
    std::env::set_var("LC_T22_PROBE_SECRET", "must-not-travel");
    let fx = Fixture::new("env");
    let host = host_with(fx.spec("envdump", OK_RESP), timeouts(3000, 5000, 1000));
    host.call(&req(1)).unwrap();
    host.shutdown();
    let dump = fs::read_to_string(fx.dir.join("env.out")).expect("假側車有把環境印出來");
    assert!(!dump.contains("LC_T22_PROBE_SECRET"), "子行程繼承了這個行程的環境變數:\n{dump}");
    assert!(!dump.contains("must-not-travel"));
    assert!(dump.contains("MODE=envdump"), "spec.env 的東西要帶進去");
}

#[test]
fn a_request_that_gets_no_answer_times_out_kills_the_sidecar_and_the_next_call_starts_a_new_one() {
    let fx = Fixture::new("timeout");
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&calls);
    let (silent, echo) = (fx.spec("silent", OK_RESP), fx.spec("echo", OK_RESP));
    let host = SidecarHost::new(
        Box::new(move || Ok(if counter.fetch_add(1, Ordering::SeqCst) == 0 { silent.clone() } else { echo.clone() })),
        timeouts(3000, 500, 1000),
    );
    let started = Instant::now();
    assert_eq!(kind(host.call(&req(1)).unwrap_err()), "timeout");
    assert!(started.elapsed() < Duration::from_secs(10), "逾時要照注入的 500ms,不是 180 秒");
    // 逾時之後側車被收掉(不是留著等)
    assert_eq!(host.child_pid(), None, "逾時之後沒有行程");
    host.call(&req(2)).expect("下一個請求重新起一個側車");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    host.shutdown();
}

#[test]
fn the_timed_out_sidecar_is_really_gone_not_a_zombie() {
    let fx = Fixture::new("zombie");
    let host = host_with(fx.spec("silent", OK_RESP), timeouts(3000, 500, 1000));
    let _ = host.call(&req(1));
    let pid = fx.pid().expect("假側車有寫下自己的 pid");
    assert!(wait_gone(pid, 5), "逾時之後 pid {pid} 還在(要 kill 並 wait,不留殭屍)");
}

#[test]
fn a_sidecar_that_exits_is_reported_and_the_next_call_starts_a_new_one() {
    let fx = Fixture::new("exit");
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&calls);
    let (dying, echo) = (fx.spec("exit", OK_RESP), fx.spec("echo", OK_RESP));
    let host = SidecarHost::new(
        Box::new(move || Ok(if counter.fetch_add(1, Ordering::SeqCst) == 0 { dying.clone() } else { echo.clone() })),
        timeouts(3000, 5000, 1000),
    );
    assert_eq!(kind(host.call(&req(1)).unwrap_err()), "sidecar-exited");
    let got = host.call(&req(2)).expect("下一個請求重起,不是一直回 sidecar-exited");
    assert_eq!(got["id"], json!(2));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    host.shutdown();
}

#[test]
fn a_second_call_while_one_is_waiting_gets_busy_and_the_first_still_finishes() {
    let fx = Fixture::new("busy");
    let host = Arc::new(host_with(fx.spec("slow", OK_RESP), timeouts(3000, 10_000, 1000)));
    let first = {
        let host = Arc::clone(&host);
        std::thread::spawn(move || host.call(&req(1)))
    };
    // 等到側車真的收到第一則(它在睡 1 秒)
    let end = Instant::now() + Duration::from_secs(5);
    while fx.log_lines().is_empty() && Instant::now() < end {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(fx.log_lines().len(), 1, "第一則請求要已經送進側車");
    let started = Instant::now();
    assert_eq!(kind(host.call(&req(2)).unwrap_err()), "busy");
    assert!(started.elapsed() < Duration::from_millis(700), "busy 要馬上回,不能排隊等");
    assert_eq!(fx.log_lines().len(), 1, "busy 的請求沒有送進側車");
    assert!(first.join().unwrap().is_ok(), "第一個請求照常完成");
    host.shutdown();
}

#[test]
fn a_sidecar_that_never_says_hello_is_unavailable_and_not_left_running() {
    let fx = Fixture::new("nohello");
    let host = host_with(fx.spec("nohello", OK_RESP), timeouts(500, 5000, 1000));
    assert_eq!(kind(host.call(&req(1)).unwrap_err()), "sidecar-unavailable");
    assert_eq!(host.child_pid(), None);
    let pid = fx.pid().expect("假側車有寫下自己的 pid");
    assert!(wait_gone(pid, 5), "沒有 hello 的側車 pid {pid} 還在");
}

#[test]
fn a_program_that_cannot_start_is_unavailable() {
    let fx = Fixture::new("nospawn");
    let mut spec = fx.spec("echo", OK_RESP);
    spec.program = "/nonexistent/definitely-not-a-program".to_string();
    let host = host_with(spec, timeouts(500, 500, 500));
    assert_eq!(kind(host.call(&req(1)).unwrap_err()), "sidecar-unavailable");
    assert_eq!(host.child_pid(), None);
}

#[test]
fn when_the_app_is_not_configured_nothing_starts_and_the_error_says_so() {
    let host = SidecarHost::new(Box::new(|| Err(ReviewError { kind: "not-configured".to_string() })), timeouts(500, 500, 500));
    assert_eq!(kind(host.call(&req(1)).unwrap_err()), "not-configured");
    assert_eq!(host.child_pid(), None);
}

#[test]
fn shutdown_closes_stdin_and_waits_for_a_sidecar_that_exits_on_eof() {
    let fx = Fixture::new("shutdown-ok");
    let host = host_with(fx.spec("echo", OK_RESP), timeouts(3000, 5000, 3000));
    host.call(&req(1)).unwrap();
    let pid = host.child_pid().unwrap();
    let started = Instant::now();
    host.shutdown();
    assert!(fx.dir.join("cleanup.done").exists(), "關 stdin 之後要等側車自己收尾(它 EOF 後還要 0.4 秒才寫完收尾檔),不是一關就殺");
    assert!(started.elapsed() < Duration::from_millis(2500), "EOF 就結束的側車不用等滿寬限期");
    assert!(wait_gone(pid, 2), "shutdown 回來時側車已經 wait 過(不留殭屍)");
    assert_eq!(host.child_pid(), None);
}

#[test]
fn shutdown_kills_a_sidecar_that_ignores_eof_after_the_grace_period() {
    let fx = Fixture::new("shutdown-kill");
    let host = host_with(fx.spec("stubborn", OK_RESP), timeouts(3000, 5000, 300));
    host.call(&req(1)).unwrap();
    let pid = host.child_pid().unwrap();
    let started = Instant::now();
    host.shutdown();
    assert!(started.elapsed() < Duration::from_secs(5), "寬限期 300ms,到了就 kill,不能等它睡完 30 秒");
    assert!(wait_gone(pid, 2), "被 kill 的側車也要 wait 掉");
}

#[test]
fn shutdown_without_a_sidecar_does_nothing() {
    let fx = Fixture::new("shutdown-none");
    let host = host_with(fx.spec("echo", OK_RESP), timeouts(3000, 5000, 300));
    host.shutdown();
    assert_eq!(host.child_pid(), None);
    host.shutdown();
}
