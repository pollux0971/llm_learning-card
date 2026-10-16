---
id: T21
deps: []
touches: [apps/desktop/src-tauri/tauri.conf.json, apps/desktop/src-tauri/src/main.rs, apps/desktop/src-tauri/src/window_mode.rs]
cpu: heavy
budget_usd: 2
status: todo
owner: worker-grok
must_catch:
  - 沒有合成器時 surface_for 回 transparent true:「沒有合成器時視窗不透明」必須紅
  - 沒有合成器時 surface_for 不給底色(None),或底色的 alpha 不是 255:「沒有合成器時底色是不透明的 --hud-solid」必須紅
  - SOLID_BACKGROUND 跟 hud.css 的 --hud-solid 不一樣(改任一邊,例如 Rust 寫 [0xf4, 0xf6, 0xf9, 0xff],或 hud.css 改成 #f4f6f9):色值一致性檢查必須紅
  - 有合成器時 surface_for 回 transparent false,或給了不透明底色:「有合成器時照舊透明、不塗底色」必須紅
  - main.rs 的卡片視窗寫死 .transparent(true) 或 .transparent(false)、不呼叫 surface_for、或拿到底色不套用:接線的靜態檢查必須紅
  - main.rs 在 .build() 之後才改透明或底色(set_background_color 之類),不是在建窗的 builder 上:接線的靜態檢查必須紅
  - main.rs 問兩次合成器(desktop_is_composited 在 open_windows 裡呼叫不只一次),或 surface_for 拿的不是給 init_script 的同一個 mode:接線的靜態檢查必須紅
  - tauri.conf.json 的 teach 或 test 還寫著 transparent(true 或 false 都算):「透明由程式決定,設定檔不寫」必須紅
  - setup 視窗(啟動失敗的畫面)被加上透明或底色:T16 既有的「setup 視窗不改」必須紅
  - 沒有合成器時頁面不再加 hud-solid、visible 改回 true、拿掉 3 秒退路:T16 既有的檢查照舊紅
  - (第 3 輪)教學卡還沒顯示就先顯示考試卡(考試卡先準備好、或考試卡的 3 秒退路先到):StartupFocus 的單元測試必須紅
  - (第 3 輪)教學卡顯示時,已經準備好的考試卡沒有跟著顯示(卡住),或考試卡顯示了兩次:單元測試必須紅
  - (第 3 輪)教學卡一直沒顯示時,考試卡沒有退路(ORDER_BACKSTOP 到了還不顯示),或 ORDER_BACKSTOP 不是 5 秒:單元測試必須紅
  - (第 3 輪)只開一張卡時還在等另一張(只有考試卡卻等教學卡、只有教學卡卻等考試卡),或四種失敗(labels 空)時有任何動作:單元測試必須紅
  - (第 3 輪)Focus(test) 沒有緊接在 Show(test) 之後、少了、或對教學卡下 Focus:單元測試必須紅
  - (第 3 輪)main.rs 有卡片視窗的 .show() 不經 StartupFocus 回傳的動作(例如 Finished 或 3 秒退路直接 show)、或沒有起 ORDER_BACKSTOP 的計時:接線的靜態檢查必須紅
  - STARTUP_FOCUS 不是 test、SHOW_FIRST 不是 teach,或任一個不是 tauri.conf.json 裡的視窗標籤:焦點目標檢查必須紅
---

# 工單 T21:10-desktop-shell phase-6 後續 —— 沒有合成器時,視窗一出現就是實心底,不先黑;啟動後焦點固定給考試卡

> 狀態:草稿,待技術顧問審。
> 作者:UI/Tauri 負責人(10 phase-6 規格作者,不是實作者)。編號:協調者配(T21)。派工:協調者。
> 實作:worker-grok(opencode grok-4.7)。紅測試:-e5。驗收:-ed。觀感:前端重拍(20 ms 取樣),技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 來源:T16 `@manual` 的 F1(證據檔 docs/reviews/T16-manual-2026-10-16.md,在分支 pollux0971/t16-manual-evidence @ eb92408,還沒進 main);技術顧問裁決「要修」(協調者 2026-10-16 轉達)。
> 規格:`features/10-desktop-shell/phase-6.feature`(這張的工單分支另有一個 commit 改它,見「規格的改動」)。
> 基底:origin/main `4fdf666`(含 T16、T17)。
> 第 2 輪(技術顧問 2026-10-16 批准第 1 輪後追加,協調者轉達):併進 T16 `@manual` 的 O1 —— 啟動後焦點固定給考試卡(驗收 8)。
> **第 3 輪**(技術顧問 2026-10-16,T21 `@manual` 之後):第 2 輪的做法(兩個都顯示後 `set_focus`)在 `:1` 開 10 次只有 6 次焦點在考試卡(證據 docs/reviews/T21-manual-2026-10-16.md,分支 pollux0971/t21-manual-evidence @ 83034df)。
>   改成**管顯示順序**:考試卡一定在教學卡之後顯示,焦點自然落在後 map 的考試卡;`set_focus` 留著當保險。見驗收 8 之後的「8(第 3 輪)」。驗收 1–7 不變(第 1、2 輪已合併,6e39a01)。

## 為什麼有這張

T16 的 `@manual` 量到:沒有合成器時,兩個卡片視窗出現後的第一張畫面整個是黑的(5/5 次;20 ms 取樣量到黑 105–145 ms),之後才變成實心底。

原因(gdb 量的,見 T16 `@manual` 證據 F1):

- 實作照 T16 工單做:頁面 load `Finished` 才 `show()`。
- 但視窗藏著的時候 WebKit 不畫。視窗 map 之後才畫第一張,大約要 0.1 秒。
- 這段時間視窗是 32 位元透明視窗(alpha 0)。沒有合成器的螢幕不管 alpha,所以是黑的。
- 所以 T16 工單「先藏起來就不會先黑」的假設不成立。這是規格的漏洞,不是實作錯。

丟棄式實驗(前端,不進 git)證明修法有效:沒有合成器時建窗用 `.transparent(false).background_color(244, 246, 248, 255)`,
20 ms 取樣 2 次,黑 0 張。視窗一出現就是整片 `--hud-solid`(約 140 ms),接著卡片內容出來。

另外併進一件(T16 `@manual` 的 O1):

- T16 之前,兩個視窗建好就顯示,後建的考試卡固定拿到鍵盤焦點。
- T16 之後,視窗載入完才顯示,**後載入完的那個**拿到焦點。`:1` 兩次開 app,一次是教學卡、一次是考試卡。
- 使用者開 app 之後直接打字,可能打不進考試卡。顧問裁決:兩個視窗都顯示之後,固定把焦點給考試卡,跟以前一樣。

## 技術顧問的裁決(協調者轉達,照原意列)

1. 建窗時就依 `is_composited` 決定。
2. 沒有合成器時,`WebviewWindowBuilder` 用 `.transparent(false)`,視窗底色設成 `--hud-solid` 那個顏色。
3. Rust 端用同一個值,不另寫一個不同的顏色;最好有單一來源,或用測試釘住兩邊相等。
4. 頁面 class 照舊 `hud-solid`。
5. 有合成器時照現在的做法。
6. `tauri.conf.json` 裡寫死的 `transparent: true` 改成由程式決定。
7. 改實作,不改契約。不需要新的 ADR(ADR-072 補一段,見「補記到 ADR-072 的文字」;顧問已批准)。
8. (第 2 輪)兩個視窗都顯示之後,固定把鍵盤焦點給考試卡,不要「誰後載入完就給誰」。
9. (第 3 輪)用**顯示順序**做到第 8 點,不是事後搶焦點:視窗管理器的通則是「新 map 的視窗拿焦點」,考試卡最後 map,焦點自然在它身上,不用跟視窗管理器搶;事後搶回焦點會撞各家的「防止搶焦點」規則,各桌面環境表現不一。教學卡一準備好就顯示;考試卡要等自己準備好**而且**教學卡已經顯示;3 秒退路照舊,也守這個順序;最後的 `set_focus(test)` 保留當保險。

## 驗收條件

### 1. 視窗的表面由一個純函式決定(`window_mode.rs`)

加在 `apps/desktop/src-tauri/src/window_mode.rs`。名字照這裡寫,紅測試會直接用:

```rust
/// 沒有合成器時視窗的底色:跟 packages/ui-shared/src/hud/hud.css 的 --hud-solid 同一個值(測試釘住)。
pub const SOLID_BACKGROUND: [u8; 4] = [0xf4, 0xf6, 0xf8, 0xff];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowSurface {
    pub transparent: bool,
    pub background: Option<[u8; 4]>,
}

pub fn surface_for(mode: WindowMode) -> WindowSurface;
```

| `mode.solid` | `transparent` | `background` |
|---|---|---|
| false(有合成器) | true | `None`(不塗底色,切角才看得到桌面) |
| true(沒有合成器) | false | `Some(SOLID_BACKGROUND)` |

- 只看 `mode.solid`,不另外問 GDK。不開視窗、不碰時鐘,才測得到。
- `background` 的 alpha 一定是 255。

### 2. 色值只有一個意思(單一來源 = `hud.css`,Rust 用測試釘住)

- `--hud-solid` 的正本是 `packages/ui-shared/src/hud/hud.css` 的 `:root`(現在是 `#f4f6f8`)。`hud.css` 這張**不改**。
- Rust 端的 `SOLID_BACKGROUND` 是一份副本,由測試讀真的 `hud.css`、解析 `--hud-solid` 的 `#rrggbb`,跟 `SOLID_BACKGROUND` 的 RGB 比,另外檢查 alpha 是 255。任一邊改了,測試紅。
- 為什麼不讓 Rust 在編譯時直接讀 `hud.css`:要從 `src-tauri/src` 跨到 `packages/ui-shared` 去 `include_str!` 再解析 CSS,桌面殼的建置會綁到另一個套件的檔案位置;
  T16 的 class 名字(`FRAMELESS_CLASS`、`SOLID_CLASS`)也是「Rust 一份、測試讀 `layout.ts` 比對」,這張照同一個做法。
- 解析規則(紅測試照這個寫):找 `:root {` 區塊裡的 `--hud-solid:` 那一行,值是 `#` 加 6 個十六進位字。找不到、格式不對,測試紅(不是跳過)。

### 3. 建窗時套用(`main.rs` 的 `open_windows`)

- `desktop_is_composited()` 在 `open_windows` 裡只呼叫一次(現在就是),算出 `mode`。
- 同一個 `mode` 給 `init_script(mode)` 與 `surface_for(mode)`。
- 卡片視窗的 builder(`WebviewWindowBuilder::from_config(...)` 那一條鏈)在 `.build()` **之前**:
  - 一律呼叫 `.transparent(surface.transparent)`。參數來自 `surface_for`,不是字面的 `true` / `false`。
  - `surface.background` 是 `Some` 時呼叫 `.background_color(...)`(tauri 2 的 `tauri::window::Color(r, g, b, a)`);是 `None` 時不呼叫。
- 不在 `.build()` 之後補(不用 `set_background_color` 之類)。建好之後才改,第一張可能已經畫錯。
- `setup` 視窗(`start_screen`)**不改**:照舊有系統外框,不加透明、不加底色。
- 置頂、`initialization_script`、`on_page_load`、3 秒退路、window-state 的 `StateFlags` 都不動。

### 4. 設定檔不再寫死透明(`tauri.conf.json`)

- `teach` 與 `test` 兩個視窗**拿掉** `transparent` 這個鍵(不是改成 false):透明只由程式決定,設定檔不寫,免得有兩個地方說了不一樣的話。
- `decorations: false`、`visible: false`、`create: false`、大小位置都不變。

### 5. 頁面這邊不變

- `window_mode.js` 不改。沒有合成器時根元素照舊有 `hud-frameless hud-solid`,有合成器時只有 `hud-frameless`。
- 兩張卡(`apps/teach-card`、`apps/test-card`)、`packages/ui-shared` 都不改。

### 6. 不退步

- T16 的自動測試(`apps/desktop/src/window-frameless*.test.ts`、`apps/desktop/src-tauri/tests/window_mode.rs`、`logging.rs`)除了「規格的改動」列出的那幾條,全綠。
- cucumber `@desktop-shell and @phase-6 and not @manual` 全綠(步驟依新的 `.feature` 改)。
- 10 phase-1、phase-2,14 phase-1、phase-2,06、07 已 done 的 phase,非 `@manual` 場景全綠,`.feature` 沒改。
- `apps/desktop/src/*.test.ts`(含 `tauri-config.test.ts` 的 CSP 與兩個視窗的 html)全綠。

### 7. 觀感(`@manual`,前端重拍、技術顧問判;開發 worker 不做這件)

一律用 `tauri build --debug --no-bundle` 的產物。重活要協調者給位子。真的 learning/ 開工、收工各量一次(SKILL §4g 第 9 條的唯一量法),前後要相同。
不在使用者的桌面上送滑鼠鍵盤。

量法(T16 `@manual` 定下的,照做):

- Xvfb `:97`:`-screen 0 1000x700x24 -noreset -fbdir <目錄>`,底色 `xsetroot -solid '#2e8b57'`;有合成器時另開 `xcompmgr`,並放一張同色的 root pixmap(設 `_XROOTPMAP_ID`)。
- **截圖讀 Xvfb 的 framebuffer**(`-fbdir` 底下的 `Xvfb_screen0`),**不用 `xwd -root`**:有合成器時 `xwd -root` 拿到的是視窗自己的像素、alpha 被丟掉,量不到螢幕上真的樣子(T16 `@manual` O3 有對照組)。
- 「視窗出現」用 map 事件的時間算(一支只讀事件的小程式記 root 底下的 `MapNotify`),不用像素猜。
- **黑幀**:視窗出現之後的某一張,那個視窗四個切角(10 像素,離斜邊 ≥ 1.5 像素,共 144 點)有任一點是 (0, 0, 0),
  或內部取樣點(每 17 像素一點)過半每個通道都 ≤ 16。

| 場景 | 怎麼拍 | 過的條件 |
|---|---|---|
| 沒有合成器,第一張就不黑 | 每 20 ms 一張、拍 1.5 秒,**3 次**(每次新的暫存根) | 3 次加起來**黑幀 0**。出現之後切角都是 (244, 246, 248) ±3;根元素 `hud-frameless hud-solid` |
| 沒有合成器,工單原本的量法 | 每 100 ms 一張、拍 3 秒,1 次 | 黑幀 0;切角同上 |
| 有合成器,照舊透明 | 每 100 ms 一張、拍 3 秒,1 次 | 出現之後每一張切角 144/144 = 桌面底色 ±3;面板內部 ≈ 0.9 白疊在桌面上 ±3;根元素只有 `hud-frameless` |
| 視窗的位元深度 | `xwininfo` | 沒有合成器:卡片視窗 Depth 24;有合成器:Depth 32 |
| 3 秒退路還在,而且卡住時不黑 | 沒有合成器;WebKitWebProcess 一出現就 `SIGSTOP`,5 秒才 `SIGCONT` | 兩個視窗 3 秒多一點出現,各一行 warn、各只 map 一次;**停住的那段時間視窗是 (244, 246, 248),不是黑的**;解凍後照常畫出來 |
| `:1` 冒煙 | GNOME,開一次;不送輸入 | 兩個視窗 `_NET_WM_STATE_ABOVE`;根元素 `hud-frameless`;DOM click 兩顆關閉鈕後 exit 0 |
| ~~`:1` 啟動焦點(驗收 8)~~ | 第 3 輪取代 | 見「8(第 3 輪)」的 `@manual` 表 |
| ~~`:1` 啟動焦點,頁面卡住那一次~~ | 第 3 輪取代 | 見「8(第 3 輪)」的 `@manual` 表 |
| ~~`:1` 焦點的後果~~ | 第 3 輪取代 | 見「8(第 3 輪)」的 `@manual` 表 |

- 沒有合成器時,第一張之後頁面才畫出卡片內容(約 140 ms 是整片 `--hud-solid`),這是預期,不算問題。

### 8. 啟動後鍵盤焦點固定給考試卡(第 2 輪,T16 `@manual` O1)—— **介面與接線已被下一節「8(第 3 輪)」取代**

> 這一節留著當紀錄(第 2 輪已合併)。`STARTUP_FOCUS` 不變;`StartupFocus::on_shown` 與「兩個都顯示之後才 `set_focus`」由第 3 輪的 `on_ready` / `on_backstop` 取代。

純函式加在 `window_mode.rs`,名字照這裡寫(紅測試直接用):

```rust
/// 兩個卡片視窗都顯示之後,鍵盤焦點給這個視窗(考試卡:使用者開 app 之後要在這裡打字)。
pub const STARTUP_FOCUS: &str = "test";

pub struct StartupFocus { /* 實作者定 */ }

impl StartupFocus {
    /// labels:這次要開的卡片視窗(open_windows 的那一份,ok 時是 teach、test;四種失敗是空的)。
    pub fn new(labels: &[&str]) -> Self;
    /// 某個視窗剛顯示。全部都顯示的那一次回 Some(STARTUP_FOCUS),之後都回 None。
    pub fn on_shown(&mut self, label: &str) -> Option<&'static str>;
}
```

| 情況 | `on_shown` 的回傳 |
|---|---|
| `new(["teach", "test"])`,先 teach 再 test | teach → `None`;test → `Some("test")` |
| 先 test 再 teach | test → `None`;teach → `Some("test")`(教學卡後顯示、搶走焦點,要拿回來) |
| 同一個標籤顯示兩次 | 第二次不算,不會因此提早回 `Some` |
| 已經回過 `Some` | 之後每次都 `None`(只給一次,不跟使用者搶焦點) |
| 不在 labels 裡的標籤 | 忽略 |
| labels 裡沒有 `STARTUP_FOCUS`(例如空的) | 永遠 `None` |

`main.rs` 的接線:

- `open_windows` 在迴圈之前建**一個** `StartupFocus`,用 `start_screen::windows(state)` 那一份標籤,用 `Arc<Mutex<…>>` 給每個視窗共用。
- 兩個顯示的地方都要通知:`on_page_load` 的 `Finished` 裡 `on_page_finished()` 回 true、`show()` 之後;`arm_show_fallback` 裡 `on_timeout()` 回 true、`show()` 之後。各自呼叫 `on_shown(<這個視窗的標籤>)`。
- `on_shown` 回 `Some(label)` 時,用 `get_webview_window(label)` 拿那個視窗,呼叫 `set_focus()`。標籤用回傳值,不寫字面的 `"test"`。
- `main.rs` 裡 `set_focus` 只出現在這一處。不要建窗後直接 `set_focus`(那時候視窗還藏著,而且另一個視窗之後顯示會把焦點搶走)。
- 頁面卡住、靠 3 秒退路才顯示的那一次,焦點在兩個都顯示之後才給(最多晚 3 秒)。這是預期。
- 執行中使用者自己點別的視窗,焦點照使用者的;這裡只管啟動那一次。
- 只驗 X11(`:1` 的 GNOME)。Wayland 上視窗能不能自己拿焦點由合成器決定,這張不驗。

### 8(第 3 輪). 用顯示順序讓焦點落在考試卡

純函式在 `window_mode.rs`,名字照這裡寫(紅測試直接用)。`StartupFocus` 這個型別名字不變,但改成管**顯示順序**:

```rust
pub const STARTUP_FOCUS: &str = "test";                        // 不變:最後顯示、拿焦點的那一個
pub const SHOW_FIRST: &str = "teach";                          // 先顯示的那一個
pub const ORDER_BACKSTOP: Duration = Duration::from_secs(5);   // 教學卡一直沒顯示時,考試卡最晚在建窗後這麼久顯示

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupAction {
    Show(&'static str),
    Focus(&'static str),
}

impl StartupFocus {
    /// labels:這次要開的卡片視窗(start_screen::windows(state);ok 時是 teach、test;四種失敗是空的)。
    pub fn new(labels: &[&'static str]) -> Self;
    /// 這個視窗準備好了:它的 ShowGate 第一次回 true(頁面載入完,或它自己的 3 秒退路到了;每個視窗只來一次)。
    /// 回傳現在要依序執行的動作。
    pub fn on_ready(&mut self, label: &str) -> Vec<StartupAction>;
    /// ORDER_BACKSTOP 到了。教學卡還沒顯示時,考試卡照樣顯示(呼叫端寫一行 warn)。
    pub fn on_backstop(&mut self) -> Vec<StartupAction>;
}
```

| labels | 事件順序 | 每一次回傳 |
|---|---|---|
| `[teach, test]` | `on_ready(teach)` → `on_ready(test)` | `[Show(teach)]` → `[Show(test), Focus(test)]` |
| `[teach, test]` | `on_ready(test)` → `on_ready(teach)` | `[]`(考試卡先等著)→ `[Show(teach), Show(test), Focus(test)]`(順序就是這樣) |
| `[teach, test]` | `on_ready(test)` → `on_backstop()`(教學卡還沒顯示) | `[]` → `[Show(test), Focus(test)]` |
| `[teach, test]` | `on_backstop()` 時考試卡還沒準備好、教學卡也還沒顯示 | `[Show(test), Focus(test)]`(不能永遠不顯示) |
| `[teach, test]` | 考試卡被退路顯示之後,`on_ready(teach)` | `[Show(teach), Focus(test)]`(教學卡後 map 會搶焦點,補一次保險) |
| `[teach, test]` | 兩個都顯示之後,任何 `on_ready` / `on_backstop` | `[]` |
| `[teach, test]` | 同一個標籤 `on_ready` 兩次 | 第二次 `[]` |
| `[test]`(只開考試卡) | `on_ready(test)` | `[Show(test), Focus(test)]`(不等教學卡) |
| `[teach]`(只開教學卡) | `on_ready(teach)`;`on_backstop()` | `[Show(teach)]`;`[]`(沒有 Focus) |
| `[]`(四種失敗,只開 setup) | 任何 | `[]` |
| 任何 | 不在 labels 裡的標籤 | `[]` |

- **教學卡載入失敗或卡住**:教學卡自己的 3 秒退路一定會讓它 `on_ready`(T16),所以考試卡最晚跟著它在 3 秒多一點顯示;萬一教學卡一直沒顯示,`ORDER_BACKSTOP`(5 秒)讓考試卡照樣顯示。考試卡不會永遠不顯示。
- 每個視窗還是只顯示一次(ShowGate 不變)。`Focus` 只在 `Show(test)` 之後出現。
- **3 秒退路與 5 秒 `ORDER_BACKSTOP` 的關係**:兩條管的事不一樣,不重複。
  - 3 秒顯示退路(`SHOW_FALLBACK`,T16)是**每個視窗自己的**:頁面 3 秒還沒載入完,這個視窗也算「準備好了」(`on_ready`)。所以正常情況下,教學卡最晚 3 秒多一點就會顯示,考試卡跟著它顯示。
  - 5 秒 `ORDER_BACKSTOP` 只管**考試卡等教學卡**這件事:只有教學卡整個出不來(例如它的視窗沒有建成、或它的退路也沒有觸發)時才會用到。正常的載入慢、載入卡住都由 3 秒退路處理,5 秒那條不會被走到。
  - 所以 5 秒那條觸發時一定寫 warn(那是不正常的情況);`@manual` 的十次啟動與凍住測試都**不應該**看到這一行 warn。

`main.rs` 的接線:

- `open_windows` 在迴圈前建一個 `StartupFocus::new(start_screen::windows(state))`(`Arc<Mutex<…>>` 共用)。
- `on_page_load` 的 Finished 與 `arm_show_fallback` 的 on_timeout:ShowGate 回 true 時**不再直接 `window.show()`**,改成呼叫 `on_ready(<這個視窗的標籤>)`,把回傳的動作依序執行:
  `Show(l)` → `get_webview_window(l)` 的 `show()`;`Focus(l)` → 那個視窗的 `set_focus()`。執行動作的地方是一個函式,卡片視窗的 `show()` 與 `set_focus()` **只出現在那個函式裡**。
- `labels` 同時有 `SHOW_FIRST` 與 `STARTUP_FOCUS` 時,另開一個計時(`ORDER_BACKSTOP`),到了呼叫 `on_backstop()`;回傳不是空的就寫一行 `log::warn!`(說考試卡在教學卡顯示之前就被顯示了、等了多久),再執行動作。
- 3 秒退路的 `log::warn!` 照舊(每個視窗自己的)。setup 視窗不經過這些。

`@manual`(併進驗收 7 的表,取代第 2 輪那三列):

| 場景 | 怎麼拍 | 過的條件 |
|---|---|---|
| `:1` 啟動焦點 | GNOME,開 **10 次**(每次新的暫存根);兩個都可見後 2 秒讀;每 20 ms 記一次 `_NET_ACTIVE_WINDOW` 的時間線;不送輸入 | **10/10** 焦點在考試卡(`_NET_ACTIVE_WINDOW`、`_NET_WM_STATE_FOCUSED`、`document.hasFocus()` 一致);時間線上考試卡是最後拿到焦點的 |
| 顯示順序 | Xvfb 沒有合成器,記 `MapNotify`,開 5 次 | 5/5 教學卡的 map 早於考試卡 |
| 頁面卡住那一次 | `:1`,兩個 WebKitWebProcess 都 `SIGSTOP` 5 秒 | 兩個都靠 3 秒退路出現;教學卡先、考試卡後;焦點在考試卡 |
| 只卡教學卡 | Xvfb,只凍住教學卡的 WebKitWebProcess(由載入順序對應) | 考試卡等到教學卡的 3 秒退路之後才顯示;warn 照實記 |
| 焦點的後果 | 考試卡作答欄真的 `focus()` | 框線四邊中點 (231, 119, 31) ±10 |
| 黑幀不退步 | Xvfb 沒有合成器,20 ms × 3 秒 × 1 次 | 黑幀 0(第 1 輪的結果不變) |

## 使用者看得到的差別

- 沒有合成器的桌面上,開 app 時兩個視窗一出現就是淺灰的實心底,接著卡片內容出來;不會再先閃一下黑的。
- 頁面卡住超過 3 秒的那一次,沒有合成器時視窗也是淺灰的,不是黑的。
- 有合成器的桌面(一般的 GNOME、KDE)看不出差別:切角照舊看得到桌面。
- 開 app 之後,鍵盤焦點一定在考試卡,直接打字就打進作答欄(跟 T16 之前一樣)。
- (第 3 輪)教學卡總是先出現、考試卡緊接在後;考試卡先準備好時會多等教學卡一下(最多到教學卡的 3 秒退路;最壞 5 秒)。

## 規格的改動(工單分支另一個 commit,技術顧問一起審)

`features/10-desktop-shell/phase-6.feature`(規格作者改;開發 worker 不改):

- 功能說明:沒有合成器時視窗用實心底打開,不是透明。
- 場景 1 的 `And both windows are transparent` 換成 `And the configuration leaves transparency to the app`。
- Scenario Outline 加兩個 Then:`And the window <is> transparent`、`And the window background is <background>`(有合成器:`is` / `left clear`;沒有:`is not` / `the solid fallback colour`)。
- `@manual` 場景「Without transparency the corners are solid, not black」的 `And no black area appears` 加上 `, not even in the first frame after the window is shown`。
- (第 2 輪)加 Scenario Outline「The test card gets the keyboard focus once both windows are shown」(兩列:先顯示 teach、先顯示 test),
  與 `@manual` 場景「The test card has the keyboard focus after every start」。步驟可以照 T16 `emit_init_script_for_the_scenarios` 的做法,
  由 Rust 測試檔印出 `StartupFocus` 對某個顯示順序的回傳,cucumber 讀輸出比對。

T16 的測試裡要跟著改的(紅測試作者改,開發 worker 不改):

| 現在 | 改成 |
|---|---|
| `window-frameless.test.ts`「兩個視窗都透明:transparent 明寫 true」、`transparentProblems`(要 true) | 「設定檔不寫 transparent」:teach、test 沒有這個鍵(true、false 都紅) |
| `desktop-shell-phase6.steps.ts` 的 `both windows are transparent` | 新的 `the configuration leaves transparency to the app`,加 Outline 的兩個新 Then |
| `mainRsProblems` 的 T16 接線檢查 | 保留,另外加驗收 3 的接線檢查 |

`features/10-desktop-shell/NEXT.md` 的 phase-6 段:`transparent: true` 那句改成「透明由程式依合成器決定(T21)」。

## 補記到 ADR-072 的文字(規格那個 commit 已加進 decision-map;技術顧問 2026-10-16 批准)

不開新號。照 ADR-072「第 2 輪」的寫法,在 Consequences 後面加:

> 第 3 輪(T21,技術顧問 2026-10-16,不另開號):Decision 3「載入完才顯示,就不會先閃黑」不成立 ——
> 藏著的視窗 WebKit 不畫,map 之後第一張要再等約 0.1 秒,這段時間沒有合成器的螢幕上透明視窗是黑的(T16 `@manual` F1)。
> 改成:透明不寫在 `tauri.conf.json`,建窗時由 `surface_for(mode)` 決定;沒有合成器時 `transparent(false)`、
> 底色 `SOLID_BACKGROUND`(= `hud.css` 的 `--hud-solid`,測試釘住)。有合成器時照舊透明、不塗底色。載入完才顯示與 3 秒退路不變。

## 紅測試(-e5 寫,開發 worker 不改)

規格作者不寫紅測試(SKILL §4g 第 1 條)。Rust 的放 `apps/desktop/src-tauri/tests/`(獨立檔,不寫在實作檔的 `mod tests`)。

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| 1 | `surface_for` 兩種模式 | `tests/window_mode.rs`:`surface_for(mode_for(true))` = `{ transparent: true, background: None }`;`surface_for(mode_for(false))` = `{ transparent: false, background: Some(SOLID_BACKGROUND) }`;alpha 255 | 紅(沒有這個函式;用 `--no-run` 逐檔確認編不過的原因是缺符號) |
| 2 | 色值一致 | 同一個檔:讀 `../../../packages/ui-shared/src/hud/hud.css`,照驗收 2 的規則解析,跟 `SOLID_BACKGROUND` 比 | 紅(沒有常數) |
| 2 | 量尺自測 | 最小合成片段:`:root` 沒有 `--hud-solid`、值是 `#fff`、值寫在別的區塊 → 解析要報錯 | 綠(量尺本身) |
| 3 | 接線 | vitest 靜態讀 `main.rs`(照 T16 `window-frame.ts` 的寫法):`open_windows` 裡 `desktop_is_composited()` 一次;`surface_for(mode)` 與 `init_script(mode)` 同一個變數;卡片 builder 鏈在 `.build()` 前有 `.transparent(` 而且參數不是字面 `true`/`false`、有條件地 `.background_color(`;沒有 `set_background_color`;setup 視窗那段沒有 `transparent`、`background_color` | 紅 |
| 3 | 量尺自測 | 最小合成片段:寫死 `transparent(true)`、`.build()` 之後才 `set_background_color`、呼叫兩次 `desktop_is_composited` → 各自報錯 | 綠 |
| 4 | 設定檔 | 讀 `tauri.conf.json`:teach、test 沒有 `transparent` 鍵;`decorations`、`visible` 照舊 | 紅 |
| 8 | `StartupFocus` | ~~第 2 輪的 `on_shown`~~(第 3 輪取代;那幾條測試由紅測試作者改寫或刪) | — |
| 8(第 3 輪) | 顯示順序 | `tests/window_mode.rs`:「8(第 3 輪)」表逐列;`SHOW_FIRST`、`STARTUP_FOCUS`、`ORDER_BACKSTOP` 的值;`Focus` 一定在 `Show(test)` 之後 | 紅(沒有 `on_ready`、`on_backstop`、`StartupAction`) |
| 8(第 3 輪) | 接線 | vitest 靜態讀 `main.rs`:Finished 與 3 秒退路的分支都呼叫 `on_ready(`、不直接 `.show()`;卡片視窗的 `.show()` / `.set_focus()` 只在執行動作的那個函式裡;有 `ORDER_BACKSTOP` 的計時並呼叫 `on_backstop(`,回傳不是空的才 `log::warn!` | 紅 |
| 8(第 3 輪) | 步驟 | cucumber 新的 Outline 與退路場景,用 Rust 測試檔印出 `on_ready` / `on_backstop` 的回傳(照 `emit_init_script_for_the_scenarios` 的做法) | 紅 |
| 8 | 焦點目標 | 讀 `tauri.conf.json`:`STARTUP_FOCUS` 是 `app.windows` 裡的一個 label | 紅 |
| 8 | 焦點接線 | vitest 靜態讀 `main.rs`:`open_windows` 一個 `StartupFocus::new(`(在迴圈之前);`on_page_load` 的 Finished 分支與 `arm_show_fallback` 的 on_timeout 分支,都在 `show()` 之後 `on_shown(`;`set_focus()` 只有一處,而且在 `on_shown` 回 `Some` 的分支裡、對 `get_webview_window(<回傳值>)`;沒有對字串字面的 `get_webview_window("test")` 呼叫 `set_focus` | 紅 |
| 8 | 量尺自測 | 最小合成片段:只有 Finished 那邊通知、建窗後直接 `set_focus()`、`set_focus` 出現兩次 → 各自報錯 | 綠 |
| 6 | 不退步 | T16 其餘測試、cucumber `@desktop-shell and @phase-6 and not @manual` | 綠(步驟改完之後,新的兩個 Outline 各兩列紅) |

注意:

- 自測片段一律最小(一兩行),不放可以直接抄的完整實作(T16 的慣例)。
- 建議照 T14 用丟棄式改法證明能轉綠(不進 git,交件前刪)。前端的實驗改法在 T16 `@manual` 證據裡,只有建窗那幾行,可以參考。
- 合成器偵測本身(GDK)與「第一張不黑」沒有自動測試,靠驗收 7 的 `@manual`。

## 怎麼跑

```bash
(cd apps/desktop/src-tauri && CARGO_BUILD_JOBS=2 cargo test --test window_mode)
VITEST_MAX_WORKERS=1 npx vitest run apps/desktop
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@desktop-shell and @phase-6 and not @manual' --format summary
npm run boundaries
```

- 環境:`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`。受保護的測試檔清單由協調者派工時附上。
- **cucumber 一律用 `--tags`,不要在命令列給 feature 檔路徑**(會跑全部場景)。`BeforeAll` 會 `cargo build --bin lc-fs`,新 worktree 第一次是冷編譯。cargo 與 cucumber 都是重活,先跟協調者拿位子,一次一個。
- 開發 worker 可以跑一次 `npm run tauri -- build --debug --no-bundle` 確認編得過(重活,要位子);截圖與 `@manual` 是前端的事。
- 不跑變異測試(-ed 驗收的事)、不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev`。

## 不在範圍

- 不改任何測試檔(`*.test.ts`、`*test-support.ts`、`features/steps/`、`src-tauri/tests/`)與 `.feature`。覺得測試錯了就停下回報協調者,由紅測試作者改。
- 不改 `hud.css`、`window_mode.js`、兩張卡、`packages/ui-shared`。
- 不改 `setup` 視窗。不改 `Cargo.toml`、`Cargo.lock`、`package.json`、`package-lock.json`、`capabilities/`。
- 不追執行中的合成器變化;不做 Wayland、macOS、Windows(跟 T16 一樣)。
- T16 `@manual` 的觀察 O2(Xvfb 沒有視窗管理員時,拖曳 / 縮放之後下一次按下被吃掉)記成**已知限制**,不在這張修:
  只在沒有視窗管理員的 Xvfb 看到(GDK 的模擬拖曳);真的桌面走視窗管理員,I3 的 `@manual` 由使用者在真桌面試(技術顧問 2026-10-16)。
- 啟動之後的焦點(使用者自己點來點去)不管;驗收 8 只管啟動那一次。
- 不配 ADR 號(不需要;補記見上)。

## 預算

`budget_usd: 2`。grok 不設花費上限(使用者 2026-10-15),只記錄;算不出來寫「不知道」。

## 測試誰寫

- 紅測試、步驟定義、量尺:-e5。開發 worker 以紅測試分支為基底。
- 實作:worker-grok,只改「touches」列的三個檔(第 2 輪的焦點也在 `main.rs`、`window_mode.rs`,不多動檔)。
- 驗收:-ed,照 `worker-acceptance`。
- 觀感:前端重拍(驗收 7),技術顧問判。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
排程:這張改 `apps/desktop/src-tauri/`;做的期間不要開別的改這裡的工單。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
