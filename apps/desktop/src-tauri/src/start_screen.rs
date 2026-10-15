//! 啟動畫面(T2c-2 驗收 3):五種啟動狀態各開哪些視窗、四種失敗各顯示什麼。
//! main.rs 與 probe 的 `startup` op 用同一份;畫面文字只寫在這裡。
//!
//! 全部正常才開教學卡與測驗卡兩個視窗。四種失敗只開一個 `setup` 視窗,內容是自訂協定 `lc-start`
//! 給的一頁靜態 HTML(沒有 script、不碰 learning/);文字裡的指令要能直接複製到終端機執行(驗收 6)。
//! 桌面程式只讀指標檔,不寫:畫面告訴人要跑哪一行 `scripts/vault.ts`,不替人跑。

use http::header::{CONTENT_SECURITY_POLICY, CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS};
use http::{Response, StatusCode};

use crate::learning_root::{Resolved, StartState};

/// `scripts/vault.ts` 的實際參數(T5 合併後的版本)。
pub const INIT_COMMAND: &str = "npx tsx scripts/vault.ts init --learning-dir";
pub const SHOW_COMMAND: &str = "npx tsx scripts/vault.ts show";
const PATH_PLACEHOLDER: &str = "<絕對路徑>";

/// 啟動畫面用的協定(跟 `lc` 分開:`lc` 只服務 learning/ 的檔案)。
pub const SCHEME: &str = "lc-start";
/// 四種失敗時開的那一個視窗。
pub const WINDOW_LABEL: &str = "setup";

/// 這個狀態要開的視窗(tauri.conf.json 的 label)。只有 `Ok` 開教學卡與測驗卡。
pub fn windows(state: StartState) -> &'static [&'static str] {
    match state {
        StartState::Ok => &["teach", "test"],
        _ => &[],
    }
}

/// 畫面的標題(也是整段文字的第一行)。`Ok` 沒有畫面,是空字串。
pub fn title(state: StartState) -> &'static str {
    match state {
        StartState::PointerMissing => "還沒有設定 learning 資料夾",
        StartState::PointerUnreadable => "設定檔讀不到",
        StartState::LearningDirMissing => "找不到資料夾",
        StartState::MarkerMismatch => "這不是同一個資料夾",
        StartState::Ok => "",
    }
}

/// 只有安全字元的路徑原樣放進指令;其他的用單引號包起來(複製貼上到 shell 才不會被拆開)。
fn shell_word(path: &str) -> String {
    let plain = !path.is_empty()
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/._-+,:@%=".contains(c));
    if plain {
        path.to_string()
    } else {
        format!("'{}'", path.replace('\'', r"'\''"))
    }
}

/// 畫面上整段文字。`Ok` 是空字串(不顯示畫面)。
pub fn text(resolved: &Resolved) -> String {
    let title = title(resolved.state);
    let pointer_path = resolved.pointer_path.display();
    let learning_dir = resolved.pointer.as_ref().map(|p| p.learning_dir.as_str()).unwrap_or("");
    match resolved.state {
        StartState::PointerMissing => format!(
            "{title}\n\n\
             桌面程式從這個設定檔讀 learning 資料夾在哪裡,這個檔還不存在:\n\
             {pointer_path}\n\n\
             在專案根目錄執行下面這一行(把 {PATH_PLACEHOLDER} 換成 learning 資料夾的絕對路徑),再重新開啟桌面程式:\n\
             {INIT_COMMAND} {PATH_PLACEHOLDER}\n\n\
             桌面程式只讀這個檔,不會自己建立它。"
        ),
        StartState::PointerUnreadable => format!(
            "{title}\n\n\
             桌面程式從這個設定檔讀 learning 資料夾在哪裡,但讀不出來\
             (權限不夠,或內容不是 {{\"learning_dir\": \"<絕對路徑>\", \"vault_id\": \"<uuid>\"}} 這個樣子):\n\
             {pointer_path}\n\n\
             桌面程式不會改寫這個檔。先看看它哪裡不對:\n\
             {SHOW_COMMAND}\n\n\
             要重新設定,在專案根目錄執行下面這一行(把 {PATH_PLACEHOLDER} 換成 learning 資料夾的絕對路徑;\
             --force 會先印出舊的內容再覆寫):\n\
             {INIT_COMMAND} {PATH_PLACEHOLDER} --force"
        ),
        StartState::LearningDirMissing => format!(
            "{title}\n\n\
             設定檔指向的 learning 資料夾不存在:\n\
             {learning_dir}\n\n\
             資料夾如果是搬走了、改了名字、或在還沒接上的磁碟上,把它放回這個位置,再重新開啟桌面程式。\n\n\
             要改指到別的位置,在專案根目錄執行下面這一行(把 {PATH_PLACEHOLDER} 換成新的絕對路徑;\
             --force 會先印出舊的設定再覆寫):\n\
             {INIT_COMMAND} {PATH_PLACEHOLDER} --force\n\n\
             設定檔:{pointer_path}"
        ),
        StartState::MarkerMismatch => format!(
            "{title}\n\n\
             設定檔指向這個資料夾:\n\
             {learning_dir}\n\
             但資料夾裡的帳本身分標記跟設定檔記的不一樣(或標記不存在、讀不到),所以桌面程式不打開它。\n\
             桌面程式不會改寫設定檔,也不會改寫資料夾裡的標記。\n\n\
             先看看兩邊各記了什麼:\n\
             {SHOW_COMMAND}\n\n\
             確定這個資料夾就是你要用的那一個,才在專案根目錄執行下面這一行\
             (以資料夾裡的標記為準改寫設定檔;--force 會先印出舊的內容):\n\
             {INIT_COMMAND} {dir} --force\n\n\
             設定檔:{pointer_path}",
            dir = shell_word(learning_dir),
        ),
        StartState::Ok => String::new(),
    }
}

fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// `setup` 視窗的整頁 HTML:第一行當標題,其餘原樣放進 `<pre>`(換行與指令都不動,可以選取複製)。
pub fn page(resolved: &Resolved) -> String {
    let text = text(resolved);
    let (head, body) = text.split_once('\n').unwrap_or((text.as_str(), ""));
    format!(
        "<!doctype html>\n<html lang=\"zh-Hant\"><head><meta charset=\"utf-8\"><title>{title}</title>\
         <style>body{{font-family:sans-serif;margin:24px;line-height:1.5}}\
         pre{{white-space:pre-wrap;word-break:break-all;font-family:monospace;user-select:text}}</style>\
         </head><body><h1>{title}</h1><pre>{body}</pre></body></html>\n",
        title = escape_html(head),
        body = escape_html(body.trim_start_matches('\n')),
    )
}

/// `lc-start` 協定的回應:永遠是這一頁。沒有 script(CSP 全擋),只允許頁內的 style。
pub fn response(page: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "text/html; charset=utf-8")
        .header(X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(CONTENT_SECURITY_POLICY, "default-src 'none'; style-src 'unsafe-inline'")
        .body(page.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// `setup` 視窗載入的網址。Windows 與 Android 的 webview 只認 `http://<scheme>.localhost/`(phase-5)。
pub fn url() -> String {
    if cfg!(any(windows, target_os = "android")) {
        format!("http://{SCHEME}.localhost/")
    } else {
        format!("{SCHEME}://localhost/")
    }
}
