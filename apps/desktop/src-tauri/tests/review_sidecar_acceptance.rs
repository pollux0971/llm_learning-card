//! T22 驗收補測(-ed):`src/review_sidecar.rs` 的 cargo-mutants 存活逐個判決後留下的缺口。
//! 只用最小的合成片段;不放接近完整的側車實作。

use std::time::Duration;

use learning_cards_desktop::review_sidecar::{parse_response_line, request_line, SidecarHost, SidecarSpec, SidecarTimeouts, MAX_LINE_BYTES};
use serde_json::json;

/// 把 apply 補到序列化之後剛好 total 個位元組。
fn request_of_len(total: usize) -> serde_json::Value {
    let make = |n: usize| json!({"v": 1, "id": 1, "method": "submit", "params": {"apply": "a".repeat(n)}});
    let base = serde_json::to_string(&make(0)).unwrap().len();
    let value = make(total - base);
    assert_eq!(serde_json::to_string(&value).unwrap().len(), total);
    value
}

#[test]
fn a_request_line_of_exactly_the_limit_is_accepted_and_one_byte_more_is_refused() {
    assert!(request_line(&request_of_len(MAX_LINE_BYTES)).is_ok());
    assert_eq!(request_line(&request_of_len(MAX_LINE_BYTES + 1)).unwrap_err().kind, "bad-envelope");
}

#[test]
fn a_response_line_of_exactly_the_limit_is_accepted_and_one_byte_more_is_refused() {
    let line_of = |total: usize| {
        let base = r#"{"v":1,"id":1,"ok":true,"result":{"t":""}}"#.len();
        format!(r#"{{"v":1,"id":1,"ok":true,"result":{{"t":"{}"}}}}"#, "a".repeat(total - base))
    };
    assert_eq!(line_of(MAX_LINE_BYTES).len(), MAX_LINE_BYTES);
    assert!(parse_response_line(&line_of(MAX_LINE_BYTES)).is_ok());
    assert_eq!(parse_response_line(&line_of(MAX_LINE_BYTES + 1)).unwrap_err().kind, "bad-response");
}

#[test]
fn a_protocol_looking_line_that_is_not_hello_does_not_count_as_hello() {
    // 側車只印一行合法的協定回應(不是 hello)就不再說話:host 要等不到 hello,回 sidecar-unavailable。
    let spec = SidecarSpec {
        program: "sh".to_string(),
        args: vec!["-c".to_string(), r#"printf '%s\n' '{"v":1,"id":1,"ok":true,"result":{}}'; sleep 30"#.to_string()],
        cwd: std::env::temp_dir(),
        env: vec![("PATH".to_string(), "/usr/bin:/bin".to_string())],
    };
    let host = SidecarHost::new(
        Box::new(move || Ok(spec.clone())),
        SidecarTimeouts { hello: Duration::from_millis(500), request: Duration::from_millis(2000), exit_grace: Duration::from_millis(500) },
    );
    let err = host.call(&json!({"v": 1, "id": 1, "method": "status", "params": {}})).unwrap_err();
    assert_eq!(err.kind, "sidecar-unavailable");
    host.shutdown();
}

/// 去掉 // 與 /* */ 註解(夠這裡掃描用)。
fn code_of(path: &str) -> String {
    let src = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(path)).unwrap();
    let mut out = String::new();
    let mut rest = src.as_str();
    while let Some(i) = rest.find("/*") {
        out.push_str(&rest[..i]);
        rest = rest[i..].find("*/").map_or("", |j| &rest[i + j + 2..]);
    }
    out.push_str(rest);
    out.lines().map(|l| l.split("//").next().unwrap_or("")).collect::<Vec<_>>().join("\n")
}

#[test]
fn closing_the_app_shuts_the_sidecar_down_from_the_exit_event() {
    let main = code_of("src/main.rs");
    let exit = main.find("RunEvent::Exit").expect("main.rs 要處理 RunEvent::Exit");
    let after = &main[exit..];
    assert!(
        after.contains("state::<SidecarHost>()") && after.contains(".shutdown()"),
        "RunEvent::Exit 的分支要對 SidecarHost 呼叫 shutdown"
    );
    assert!(main.contains(".manage(host)") || main.contains(".manage(SidecarHost"), "SidecarHost 要交給 tauri 管(.manage)");
}
