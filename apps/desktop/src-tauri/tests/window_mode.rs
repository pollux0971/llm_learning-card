//! T16 + T21(10-desktop-shell phase-6)的 Rust 純函式:合成器判定、頁面模式、載入完才顯示的逾時退路、
//! 沒有合成器時的實心底(surface_for)、啟動焦點(StartupFocus)。
//! 測試 agent 寫;開發 worker 不改。不開視窗、不碰時鐘(兩個方法直接呼叫,不真的等 3 秒)。
//!
//! 頁面那段程式(`src/window_mode.js`)本身的行為由 vitest 測(apps/desktop/src/window-frameless.test.ts):
//! Rust 與 vitest 讀的是同一個檔。這裡只看 Rust 端把它接起來的方式。

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use learning_cards_desktop::window_mode::{
    init_script, mode_for, surface_for, ShowGate, StartupAction, StartupFocus, WindowMode, WindowSurface, ORDER_BACKSTOP, SHOW_FALLBACK, SHOW_FIRST,
    SOLID_BACKGROUND, STARTUP_FOCUS,
};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn window_mode_js() -> String {
    fs::read_to_string(manifest_dir().join("src/window_mode.js"))
        .expect("src/window_mode.js 不存在(頁面那段程式要放在 apps/desktop/src-tauri/src/window_mode.js)")
}

/// 14 的 layout.ts 裡 `export const NAME = '值';` 的值。
fn layout_constant(name: &str) -> String {
    let path = manifest_dir().join("../../../packages/ui-shared/src/hud/layout.ts");
    let text = fs::read_to_string(&path).expect("讀不到 layout.ts");
    let marker = format!("export const {name} = '");
    let start = text.find(&marker).unwrap_or_else(|| panic!("layout.ts 沒有 {name}")) + marker.len();
    let end = text[start..].find('\'').expect("layout.ts 的字串沒有結尾");
    text[start..start + end].to_string()
}

// ───────────────────────────── 模式:有沒有合成器

#[test]
fn a_composited_desktop_is_frameless_and_not_solid() {
    assert_eq!(mode_for(true), WindowMode { frameless: true, solid: false });
}

#[test]
fn a_desktop_without_a_compositor_is_frameless_and_solid() {
    assert_eq!(mode_for(false), WindowMode { frameless: true, solid: true });
}

#[test]
fn frameless_does_not_depend_on_the_compositor() {
    assert!(mode_for(true).frameless);
    assert!(mode_for(false).frameless);
}

// ───────────────────────────── init_script:一行 JSON 加上 window_mode.js

fn first_line_json(script: &str) -> serde_json::Value {
    let first = script.lines().next().expect("init_script 是空的");
    let body = first
        .strip_prefix("window.__LC_WINDOW_MODE__ = ")
        .unwrap_or_else(|| panic!("第一行要以 `window.__LC_WINDOW_MODE__ = ` 開頭,實際是:{first}"));
    let body = body.strip_suffix(';').unwrap_or_else(|| panic!("第一行要以 `;` 結尾,實際是:{first}"));
    serde_json::from_str(body).unwrap_or_else(|e| panic!("第一行的值不是合法 JSON({e}):{body}"))
}

#[test]
fn the_first_line_hands_the_mode_over_as_json() {
    for composited in [true, false] {
        let mode = mode_for(composited);
        let value = first_line_json(&init_script(mode));
        let object = value.as_object().expect("要是一個物件");
        assert_eq!(object.len(), 2, "只有 frameless 與 solid 兩個欄位:{value}");
        assert_eq!(object["frameless"], serde_json::Value::Bool(mode.frameless));
        assert_eq!(object["solid"], serde_json::Value::Bool(mode.solid));
    }
}

#[test]
fn the_rest_of_the_script_is_window_mode_js_untouched() {
    let js = window_mode_js();
    assert!(!js.trim().is_empty(), "window_mode.js 是空的");
    for composited in [true, false] {
        let script = init_script(mode_for(composited));
        let (_, rest) = script.split_once('\n').expect("第一行之後要換行,接 window_mode.js");
        assert_eq!(rest, js, "第一行之後必須逐字等於 window_mode.js 的內容(Rust 與 vitest 測同一個檔)");
    }
}

#[test]
fn the_script_uses_the_class_names_of_the_hud_kit() {
    let script = init_script(mode_for(true));
    for name in ["FRAMELESS_CLASS", "SOLID_CLASS"] {
        let class = layout_constant(name);
        assert!(script.contains(&class), "init_script 裡找不到 layout.ts 的 {name}(`{class}`)");
    }
}

// ───────────────────────────── 載入完才顯示:3 秒逾時退路

#[test]
fn the_fallback_waits_three_seconds() {
    assert_eq!(SHOW_FALLBACK, Duration::from_secs(3));
}

#[test]
fn a_page_that_never_finishes_loading_is_shown_once_when_the_timeout_fires() {
    // 測試替身:故意不結束載入的頁面,只會叫 on_timeout,永遠不叫 on_page_finished。
    let mut gate = ShowGate::new();
    assert!(gate.on_timeout(), "逾時到了,頁面還沒載入完 → 要顯示(呼叫端同時寫 warn)");
    assert!(!gate.on_timeout(), "逾時只顯示一次");
}

#[test]
fn a_page_that_finishes_in_time_is_shown_once_and_the_timeout_does_nothing() {
    let mut gate = ShowGate::new();
    assert!(gate.on_page_finished(), "載入完成 → 顯示");
    assert!(!gate.on_timeout(), "已經顯示過:逾時不再顯示,也不警告(回 false 呼叫端就不寫 warn)");
}

#[test]
fn a_page_that_finishes_after_the_timeout_is_not_shown_a_second_time() {
    let mut gate = ShowGate::new();
    assert!(gate.on_timeout(), "逾時先到 → 顯示");
    assert!(!gate.on_page_finished(), "之後才載入完 → 什麼都不做");
}

#[test]
fn finishing_twice_shows_once() {
    // 頁面重新整理或換頁時,Finished 會再來一次
    let mut gate = ShowGate::new();
    assert!(gate.on_page_finished());
    assert!(!gate.on_page_finished());
    assert!(!gate.on_timeout());
}

#[test]
fn each_window_has_its_own_gate() {
    let mut teach = ShowGate::new();
    let mut test = ShowGate::new();
    assert!(teach.on_page_finished());
    assert!(test.on_timeout(), "另一個視窗的結果不影響這一個");
    assert!(!teach.on_timeout());
    assert!(!test.on_page_finished());
}

// ───────────────────────────── 給 cucumber 場景用(沒設環境變數時什麼都不做)

/// 場景「The solid fallback follows what the desktop can draw」要的是 Rust 端真的組出來的 init_script,
/// 由步驟定義用 `LC_WINDOW_MODE_COMPOSITED=1|0 cargo test --test window_mode emit_init_script_for_the_scenarios -- --exact --nocapture`
/// 取得,再把它放進假的頁面根元素跑。
#[test]
fn emit_init_script_for_the_scenarios() {
    let Ok(value) = std::env::var("LC_WINDOW_MODE_COMPOSITED") else {
        return;
    };
    let script = init_script(mode_for(value == "1"));
    println!("LC-INIT-SCRIPT-BEGIN\n{script}\nLC-INIT-SCRIPT-END");
}

// ═════════════════════════════ T21:視窗的表面(驗收 1)

#[test]
fn a_composited_desktop_gets_a_transparent_window_without_a_background() {
    assert_eq!(surface_for(mode_for(true)), WindowSurface { transparent: true, background: None });
}

#[test]
fn a_desktop_without_a_compositor_gets_an_opaque_window_in_the_solid_colour() {
    assert_eq!(surface_for(mode_for(false)), WindowSurface { transparent: false, background: Some(SOLID_BACKGROUND) });
}

#[test]
fn the_surface_only_looks_at_solid() {
    // 不另外問 GDK:同一個 mode 永遠同一個表面;frameless 不影響它
    for frameless in [true, false] {
        assert_eq!(
            surface_for(WindowMode { frameless, solid: true }),
            WindowSurface { transparent: false, background: Some(SOLID_BACKGROUND) }
        );
        assert_eq!(surface_for(WindowMode { frameless, solid: false }), WindowSurface { transparent: true, background: None });
    }
}

#[test]
fn the_solid_background_is_fully_opaque() {
    assert_eq!(SOLID_BACKGROUND[3], 0xff, "alpha 一定是 255");
    assert_eq!(surface_for(mode_for(false)).background.map(|c| c[3]), Some(0xff));
}

// ───────────────────────────── 色值只有一個意思:SOLID_BACKGROUND = hud.css 的 --hud-solid(驗收 2)

fn hud_css() -> String {
    let path = manifest_dir().join("../../../packages/ui-shared/src/hud/hud.css");
    fs::read_to_string(&path).expect("讀不到 packages/ui-shared/src/hud/hud.css")
}

/// 量尺:`:root { … }` 區塊裡 `--hud-solid:` 那一行的 `#rrggbb`。找不到、格式不對 → Err(測試紅,不是跳過)。
/// 只認 `:root` 區塊(別的區塊同名的變數不算);註解先拿掉;值後面有 `!important` 算格式不對。
fn parse_hud_solid(css: &str) -> Result<[u8; 3], String> {
    let mut code = String::new();
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        code.push_str(&rest[..start]);
        match rest[start + 2..].find("*/") {
            Some(end) => rest = &rest[start + 2 + end + 2..],
            None => {
                rest = "";
                break;
            }
        }
    }
    code.push_str(rest);

    let mut search = code.as_str();
    while let Some(at) = search.find(":root") {
        let after = search[at + ":root".len()..].trim_start();
        search = &search[at + ":root".len()..];
        let Some(body_and_rest) = after.strip_prefix('{') else { continue };
        let Some(close) = body_and_rest.find('}') else { return Err("`:root` 區塊沒有結尾的 }".into()) };
        let block = &body_and_rest[..close];
        for decl in block.split(';') {
            let decl = decl.trim();
            let Some(value) = decl.strip_prefix("--hud-solid") else { continue };
            let Some(value) = value.trim_start().strip_prefix(':') else { continue };
            let value = value.trim();
            let hex = value.strip_prefix('#').ok_or_else(|| format!("--hud-solid 的值要以 # 開頭:{value}"))?;
            if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(format!("--hud-solid 的值要是 # 加 6 個十六進位字:{value}"));
            }
            let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).expect("已檢查是十六進位");
            return Ok([byte(0), byte(2), byte(4)]);
        }
    }
    Err("`:root` 區塊裡找不到 --hud-solid".into())
}

#[test]
fn the_solid_background_is_the_hud_solid_of_hud_css() {
    let rgb = parse_hud_solid(&hud_css()).unwrap_or_else(|e| panic!("hud.css 解析失敗:{e}"));
    assert_eq!(&SOLID_BACKGROUND[..3], &rgb[..], "SOLID_BACKGROUND 的 RGB 要等於 hud.css 的 --hud-solid");
}

#[test]
fn the_css_reader_reads_only_the_root_block() {
    // 最小合成片段:量尺本身要出聲,不然 hud.css 改了格式量尺就悄悄失靈
    assert_eq!(parse_hud_solid(":root { --hud-solid: #f4f6f8; }"), Ok([0xf4, 0xf6, 0xf8]));
    assert_eq!(parse_hud_solid(":root{--hud-solid:#112233}"), Ok([0x11, 0x22, 0x33]), "最後一個宣告可以沒有分號");
    assert_eq!(parse_hud_solid(":root { --hud-solid: #F4F6F8; }"), Ok([0xf4, 0xf6, 0xf8]), "大寫十六進位字也認");
    assert!(parse_hud_solid(":root { --hud-ink: #000000; }").is_err(), ":root 裡沒有 --hud-solid");
    assert!(parse_hud_solid("").is_err(), "沒有 :root");
    assert!(parse_hud_solid(".a { --hud-solid: #f4f6f8; }").is_err(), "沒有 :root 區塊");
}

#[test]
fn the_css_reader_rejects_a_value_it_cannot_trust() {
    assert!(parse_hud_solid(":root { --hud-solid: #fff; }").is_err(), "三碼不認");
    assert!(parse_hud_solid(":root { --hud-solid: #f4f6f8ff; }").is_err(), "八碼不認");
    assert!(parse_hud_solid(":root { --hud-solid: #f4f6gg; }").is_err(), "不是十六進位");
    assert!(parse_hud_solid(":root { --hud-solid: rgb(244, 246, 248); }").is_err(), "不是 # 開頭");
    assert!(parse_hud_solid(":root { --hud-solid: #f4f6f8 !important; }").is_err(), "!important 算格式不對");
    assert!(parse_hud_solid(":root { --hud-solid: var(--other); }").is_err(), "引用別的變數不認");
}

#[test]
fn the_css_reader_ignores_the_same_name_in_other_blocks() {
    let css = ".hud-dark { --hud-solid: #000000; }\n:root { --hud-solid: #f4f6f8; }\n.other { --hud-solid: #ffffff; }";
    assert_eq!(parse_hud_solid(css), Ok([0xf4, 0xf6, 0xf8]), "要讀 :root 的,不是第一個或最後一個同名的");
    assert!(parse_hud_solid(".hud-dark { --hud-solid: #000000; }\n:root { --hud-ink: #111111; }").is_err(), "別的區塊有、:root 沒有 → 找不到");
}

#[test]
fn the_css_reader_ignores_comments() {
    assert!(parse_hud_solid(":root { /* --hud-solid: #000000; */ }").is_err(), "註解裡的不算");
    assert_eq!(parse_hud_solid(":root { /* --hud-solid: #000000; */ --hud-solid: #f4f6f8; }"), Ok([0xf4, 0xf6, 0xf8]));
    assert_eq!(parse_hud_solid("/* :root { --hud-solid: #000000; } */ :root { --hud-solid: #f4f6f8; }"), Ok([0xf4, 0xf6, 0xf8]));
    assert!(parse_hud_solid(":root { --hud-solid: /* x */ #fff; }").is_err(), "拿掉註解之後仍是三碼");
}

// ═════════════════════════════ T21 第 3 輪:啟動時的顯示順序(驗收 8,第 3 輪)

use StartupAction::{Focus, Show};

#[test]
fn the_startup_constants_are_fixed() {
    assert_eq!(SHOW_FIRST, "teach", "先顯示的是教學卡");
    assert_eq!(STARTUP_FOCUS, "test", "最後顯示、拿焦點的是考試卡");
    assert_eq!(ORDER_BACKSTOP, Duration::from_secs(5), "教學卡一直沒顯示時,考試卡最晚 5 秒後顯示");
    assert!(ORDER_BACKSTOP > SHOW_FALLBACK, "5 秒的順序退路要比每個視窗自己的 3 秒顯示退路晚,不然 3 秒那條永遠輪不到");
}

fn both() -> StartupFocus {
    StartupFocus::new(&["teach", "test"])
}

#[test]
fn the_teach_card_first_then_the_test_card() {
    let mut s = both();
    assert_eq!(s.on_ready("teach"), vec![Show("teach")]);
    assert_eq!(s.on_ready("test"), vec![Show("test"), Focus("test")]);
}

#[test]
fn a_test_card_that_is_ready_first_waits_for_the_teach_card() {
    let mut s = both();
    assert_eq!(s.on_ready("test"), vec![], "考試卡先準備好:等著,不顯示");
    assert_eq!(s.on_ready("teach"), vec![Show("teach"), Show("test"), Focus("test")], "順序就是這樣:教學卡、考試卡、焦點");
}

#[test]
fn the_backstop_shows_the_test_card_when_the_teach_card_never_shows() {
    let mut s = both();
    assert_eq!(s.on_ready("test"), vec![]);
    assert_eq!(s.on_backstop(), vec![Show("test"), Focus("test")], "教學卡還沒顯示,考試卡也不能永遠不顯示");
}

#[test]
fn the_backstop_works_even_when_nothing_was_ready() {
    let mut s = both();
    assert_eq!(s.on_backstop(), vec![Show("test"), Focus("test")]);
}

#[test]
fn a_teach_card_that_shows_after_the_backstop_gets_the_focus_taken_back_by_the_test_card() {
    let mut s = both();
    assert_eq!(s.on_backstop(), vec![Show("test"), Focus("test")]);
    assert_eq!(s.on_ready("teach"), vec![Show("teach"), Focus("test")], "教學卡後 map 會搶焦點,補一次保險");
}

#[test]
fn after_both_are_shown_nothing_more_happens() {
    for first in [vec!["teach", "test"], vec!["test", "teach"]] {
        let mut s = both();
        for label in &first {
            s.on_ready(label);
        }
        assert_eq!(s.on_ready("teach"), vec![], "{first:?}:兩個都顯示之後 on_ready(teach)");
        assert_eq!(s.on_ready("test"), vec![], "{first:?}:兩個都顯示之後 on_ready(test)");
        assert_eq!(s.on_backstop(), vec![], "{first:?}:兩個都顯示之後 on_backstop");
    }
    let mut via_backstop = both();
    via_backstop.on_backstop();
    via_backstop.on_ready("teach");
    assert_eq!(via_backstop.on_backstop(), vec![], "退路顯示之後教學卡也顯示了:再來的 on_backstop 什麼都不做");
    assert_eq!(via_backstop.on_ready("test"), vec![]);
}

#[test]
fn the_same_window_ready_twice_does_nothing_the_second_time() {
    let mut s = both();
    assert_eq!(s.on_ready("teach"), vec![Show("teach")]);
    assert_eq!(s.on_ready("teach"), vec![], "同一個標籤第二次");
    let mut s = both();
    assert_eq!(s.on_ready("test"), vec![]);
    assert_eq!(s.on_ready("test"), vec![], "考試卡等著的時候又來一次,也不能提早顯示");
    assert_eq!(s.on_ready("teach"), vec![Show("teach"), Show("test"), Focus("test")]);
}

#[test]
fn a_set_with_only_the_test_card_does_not_wait_for_the_teach_card() {
    let mut s = StartupFocus::new(&["test"]);
    assert_eq!(s.on_ready("test"), vec![Show("test"), Focus("test")]);
    assert_eq!(s.on_backstop(), vec![]);
    let mut s = StartupFocus::new(&["test"]);
    assert_eq!(s.on_backstop(), vec![Show("test"), Focus("test")], "只有考試卡時,退路也讓它顯示(它沒有東西好等)");
}

#[test]
fn a_set_with_only_the_teach_card_never_gets_a_focus_action() {
    let mut s = StartupFocus::new(&["teach"]);
    assert_eq!(s.on_ready("teach"), vec![Show("teach")]);
    assert_eq!(s.on_backstop(), vec![]);
    let mut s = StartupFocus::new(&["teach"]);
    assert_eq!(s.on_backstop(), vec![], "沒有考試卡:退路沒有東西要顯示");
    assert_eq!(s.on_ready("teach"), vec![Show("teach")]);
}

#[test]
fn an_empty_set_never_does_anything() {
    let mut s = StartupFocus::new(&[]);
    for label in ["teach", "test", "setup"] {
        assert_eq!(s.on_ready(label), vec![], "四種失敗只開 setup,labels 是空的:{label}");
    }
    assert_eq!(s.on_backstop(), vec![]);
}

#[test]
fn a_label_that_is_not_in_the_set_is_ignored() {
    let mut s = both();
    assert_eq!(s.on_ready("setup"), vec![]);
    assert_eq!(s.on_ready("teach"), vec![Show("teach")], "setup 不算進去");
    assert_eq!(s.on_ready("other"), vec![]);
    assert_eq!(s.on_ready("test"), vec![Show("test"), Focus("test")]);
}

#[test]
fn each_startup_focus_is_independent() {
    let mut a = both();
    let mut b = both();
    assert_eq!(a.on_ready("teach"), vec![Show("teach")]);
    assert_eq!(b.on_ready("test"), vec![]);
    assert_eq!(a.on_ready("test"), vec![Show("test"), Focus("test")]);
    assert_eq!(b.on_ready("teach"), vec![Show("teach"), Show("test"), Focus("test")], "另一個實例的狀態不影響這一個");
}

/// 把事件接在一起試(窮舉長度 ≤ 5、四種事件的所有序列),只看「不管事件怎麼排,下面這些都成立」。
#[test]
fn whatever_the_order_of_events_the_invariants_hold() {
    #[derive(Clone, Copy, Debug)]
    enum Ev {
        Ready(&'static str),
        Backstop,
    }
    let evs = [Ev::Ready("teach"), Ev::Ready("test"), Ev::Backstop, Ev::Ready("setup")];
    let mut seqs: Vec<Vec<Ev>> = vec![vec![]];
    let mut level: Vec<Vec<Ev>> = vec![vec![]];
    for _ in 0..5 {
        let mut next = Vec::new();
        for s in &level {
            for e in evs {
                let mut t = s.clone();
                t.push(e);
                next.push(t);
            }
        }
        seqs.extend(next.iter().cloned());
        level = next;
    }
    for seq in seqs {
        let mut focus = both();
        let mut all: Vec<StartupAction> = Vec::new();
        let mut used_backstop = false;
        for ev in &seq {
            let out = match ev {
                Ev::Ready(l) => focus.on_ready(l),
                Ev::Backstop => {
                    used_backstop = true;
                    focus.on_backstop()
                }
            };
            all.extend(out);
        }
        let ctx = format!("事件 {seq:?} → 動作 {all:?}");
        let shows = |l: &str| all.iter().filter(|a| **a == Show(match l { "teach" => "teach", _ => "test" })).count();
        assert!(shows("teach") <= 1 && shows("test") <= 1, "每個視窗最多顯示一次。{ctx}");
        assert!(!all.contains(&Show("setup")) && !all.contains(&Focus("teach")) && !all.contains(&Focus("setup")), "只會對考試卡下 Focus。{ctx}");
        if let Some(f) = all.iter().position(|a| *a == Focus("test")) {
            let shown = all[..f].iter().any(|a| *a == Show("test"));
            assert!(shown, "Focus(test) 之前考試卡一定已經顯示。{ctx}");
        }
        let teach_at = all.iter().position(|a| *a == Show("teach"));
        let test_at = all.iter().position(|a| *a == Show("test"));
        if !used_backstop {
            if let Some(t) = test_at {
                assert!(teach_at.is_some_and(|h| h < t), "沒有用退路時,考試卡一定在教學卡之後才顯示。{ctx}");
            }
        }
        if let Some(t) = test_at {
            assert_eq!(all.get(t + 1), Some(&Focus("test")), "Focus(test) 緊接在 Show(test) 之後。{ctx}");
        }
    }
}

// ───────────────────────────── 給 cucumber 場景用(沒設環境變數時什麼都不做)

/// 場景「The solid fallback follows what the desktop can draw」的 `the window <is> transparent`、
/// `the window background is <background>`:印出 Rust 端真的算出來的 surface_for。
/// `LC_WINDOW_MODE_COMPOSITED=1|0 cargo test --test window_mode emit_surface_for_the_scenarios -- --exact --nocapture`
#[test]
fn emit_surface_for_the_scenarios() {
    let Ok(value) = std::env::var("LC_WINDOW_MODE_COMPOSITED") else {
        return;
    };
    let surface = surface_for(mode_for(value == "1"));
    let json = serde_json::json!({
        "transparent": surface.transparent,
        "background": surface.background,
        "solidBackground": SOLID_BACKGROUND,
    });
    println!("LC-SURFACE-BEGIN\n{json}\nLC-SURFACE-END");
}

/// 場景「The test card is shown after the teach card…」與兩個退路 / 單張場景:
/// `LC_STARTUP_SCENARIO=ready-teach-first|ready-test-first|backstop|single-test cargo test --test window_mode emit_startup_order_for_the_scenarios -- --exact --nocapture`
/// 印出每個事件(`on_ready(label)` / `on_backstop()`)與 Rust 真的回傳的動作(JSON)。
#[test]
fn emit_startup_order_for_the_scenarios() {
    let Ok(scenario) = std::env::var("LC_STARTUP_SCENARIO") else {
        return;
    };
    let name = |a: StartupAction| match a {
        Show(l) => format!("Show({l})"),
        Focus(l) => format!("Focus({l})"),
    };
    let mut steps: Vec<serde_json::Value> = Vec::new();
    let mut record = |event: &str, actions: Vec<StartupAction>| {
        steps.push(serde_json::json!({ "event": event, "actions": actions.into_iter().map(name).collect::<Vec<_>>() }));
    };
    match scenario.as_str() {
        "ready-teach-first" => {
            let mut s = both();
            record("on_ready(teach)", s.on_ready("teach"));
            record("on_ready(test)", s.on_ready("test"));
        }
        "ready-test-first" => {
            let mut s = both();
            record("on_ready(test)", s.on_ready("test"));
            record("on_ready(teach)", s.on_ready("teach"));
        }
        "backstop" => {
            let mut s = both();
            record("on_backstop()", s.on_backstop());
        }
        "single-test" => {
            let mut s = StartupFocus::new(&["test"]);
            record("on_ready(test)", s.on_ready("test"));
        }
        other => panic!("不認得的 LC_STARTUP_SCENARIO:{other}"),
    }
    println!("LC-STARTUP-ORDER-BEGIN\n{}\nLC-STARTUP-ORDER-END", serde_json::json!({ "steps": steps }));
}
