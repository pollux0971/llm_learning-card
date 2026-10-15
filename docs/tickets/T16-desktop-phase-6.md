---
id: T16
deps: []
touches: [apps/desktop/src-tauri/tauri.conf.json, apps/desktop/src-tauri/capabilities/default.json, apps/desktop/src-tauri/src/main.rs, apps/desktop/src-tauri/src/lib.rs, apps/desktop/src-tauri/src/window_mode.rs, apps/desktop/src-tauri/src/window_mode.js, apps/desktop/src-tauri/Cargo.toml, apps/desktop/src-tauri/Cargo.lock, packages/ui-shared/src/hud/hud.css, packages/ui-shared/src/hud/HudTitleBar.svelte, packages/ui-shared/src/hud/gallery/Gallery.svelte]
cpu: heavy
budget_usd: 5
status: todo
owner: worker-grok
must_catch:
  - 任一個視窗(teach 或 test)的 decorations 改回 true 或沒寫:「兩個視窗都沒有系統外框」必須紅
  - 任一個視窗的 transparent 改回 false 或沒寫:「兩個視窗都透明」必須紅
  - 任一個視窗的 visible 改回 true:「載入完才顯示」的設定檢查必須紅
  - 頁面一直不完成載入,視窗永遠不顯示(拿掉 3 秒的逾時退路):「載入卡住也要顯示」必須紅
  - 逾時退路顯示兩次,或頁面已經載入完、3 秒到時還寫 warn:「只顯示一次、載入完不警告」必須紅
  - capabilities 少開四個權限中的任一個(開始拖曳、開始縮放拖曳、縮小、關閉):權限檢查必須紅
  - capabilities 多開別的視窗操作(例如 allow-set-position、allow-hide、allow-destroy、core:window:default 以外的任何一條):「不多開」必須紅
  - 頁面那段程式不加 hud-frameless,或寫錯字(例如 hud-frame-less):「頁面根元素有 frameless class」必須紅
  - 有合成器時也加 hud-solid,或沒合成器時不加:Scenario Outline 的兩列各自必須紅
  - Rust 端的 class 名字跟 14 的 layout.ts(FRAMELESS_CLASS、SOLID_CLASS)不一樣:名字一致性檢查必須紅
  - 頁面那段程式改用 innerHTML、插 <style>、設 style 屬性,或改成等 invoke 回來才加 class:頁面程式的靜態檢查必須紅
  - 縮小 / 關閉鈕 hover 或 focus 時又出現長方形 outline,或橘色填滿切角:切角外側與外圍一圈的橘色點數必須紅
  - 縮小 / 關閉鈕的內底寫死不透明色(例如 #fff、--hud-solid):放大法必須紅
  - HudButton、HudField、縮小 / 關閉鈕 hover 或 focus 時框線不是飽和橘(線不見、變淡、變黑):框線顏色檢查必須紅
  - 縮放把手 hover 時又塗橘色方塊:縮放把手 hover 的檢查必須紅
  - 停用的按鈕或作答欄看起來跟一般一樣,或停用時變橘:停用狀態的檢查必須紅
  - 10 phase-1、phase-2,14 phase-1、phase-2,06、07 已 done 的 phase 的非 @manual 場景照舊全綠、.feature 沒改
---

# 工單 T16:10-desktop-shell phase-6 —— 無框透明視窗、自畫控制項的權限、實心底退路

> 狀態:草稿,待技術顧問審。
> 作者:UI/Tauri 負責人(10 phase-6 與 14-hud-skin 的規格作者,不是實作者)。編號:協調者配(T16)。派工:協調者。
> 實作:worker-grok。紅測試:另一個角色(建議見「紅測試」)。驗收:-ed。觀感:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 規格來源:`features/10-desktop-shell/phase-6.feature`(**不改**)、`features/10-desktop-shell/NEXT.md` 的 phase-6 段、
> `features/10-desktop-shell/FEATURE.md`、`features/14-hud-skin/FEATURE.md` 的「不在範圍」。
> 基底:origin/main `337512f`(含 T15、14 phase-2 done)。協調者本地的 NEXT.md gate 打勾 commit 還沒推,合併時處理。
> **需要 ADR**(合成器偵測與頁面模式的傳遞,見「需要 ADR」),配給 **ADR-072**。

## 為什麼有這張

使用者 2026-10-15 要「無框 + SAO HUD 風格」,選了 A:透明視窗,切角就是視窗的形狀。
14 phase-1、phase-2 做好了長相,兩張卡已經用 HUD 的面板、標題列、縮放把手(T15)。
但桌面殼還有系統外框:自畫的標題列與縮放把手只在根元素有 `hud-frameless` 時才顯示,現在沒有人加。
這張把系統外框拿掉,開自畫控制項要的權限,告訴頁面現在是哪一種模式。

另外併進兩件小事(協調者 2026-10-16 轉技術顧問):

| 來源 | 問題 |
|---|---|
| T15 第四輪之後的新規則 | hover / focus 時要量框線是飽和橘 (231, 119, 31) ±10,跟淡橘填色 (247, 208, 177) 分得開;線不見要紅 |
| -ed 驗收 T15 時發現 | 標題列的縮小、關閉鈕 hover / focus 是長方形 outline。現在有系統外框,自畫標題列不顯示,所以沒人看到;無框之後就看得到了 |

## 外觀類工單的規則(技術顧問 2026-10-16,T15 的教訓)

T15 退回四輪,三次是「一般狀態量了、hover / focus 沒量」或「量法分不開不透明與半透明」。從這張開始:

1. **每一種狀態都要量**:一般、hover、focus(`:focus-visible` 或 `:focus-within`)、停用。哪一種不存在,工單要明寫「沒有這個狀態」。
2. **量法要分得開「不透明」與「半透明」**:用放大法。量的時候把 `--hud-panel` 覆寫成 `rgba(255, 0, 0, 0.5)`、頁底換成 `#202020`,
   跟著 token 走的內部約 (200, 8, 8)(巢狀)或 (143, 16, 16)(單層);寫死的不透明白、灰都差幾十色階。
3. **切角外側與外圍一圈要量**(T15 第四輪的量法):元素矩形(四捨五入)兩個切角三角形裡、離斜邊 ≥ 1.5 像素的點,以及元素外面 2–5 像素那一圈,
   橘色點數要是 0。橘色的定義:R > 180、80 < G < 170、B < 90。
4. hover / focus 的截圖不送滑鼠鍵盤:Chrome 用 DevTools 的 `CSS.forcePseudoState`;桌面 app(WebKitGTK 2.52)用 CSSOM 把 `:hover` / `:focus-visible` 規則
   複製到測試屬性上(檢查器的 `CSS.enable` 會卡死整個 session,前端實測)。

## 驗收條件

### 1. 兩個視窗沒有系統外框、透明、載入完才顯示(場景 1)

- `apps/desktop/src-tauri/tauri.conf.json` 的 `teach` 與 `test` 兩個視窗:`"decorations": false`、`"transparent": true`。
- 兩個視窗都 `"visible": false`,等頁面第一次載入完(Tauri 的 page load 事件,`Finished`)才由 Rust 顯示。
  理由:沒有合成器時,透明視窗在頁面畫出來之前是黑的;先藏起來,使用者就不會看到「先黑再變」。
  - 注意 window-state 外掛會還原「可見」:它的 `StateFlags` 要拿掉 `VISIBLE`,不然它會在頁面載入之前就把視窗打開。
  - **逾時退路(技術顧問 2026-10-16,必修)**:頁面載入失敗或卡住時,不能讓使用者永遠看不到視窗(看起來像程式沒開)。
    規則:載入完成就顯示;**超過 3 秒**還沒完成,也照樣顯示(這時可能先黑一下,可以接受),並寫一行 `log::warn!`(說是哪一個視窗、等了多久)。
    - 每個視窗**只顯示一次**:載入完成與 3 秒到時,先到的那一個顯示;後到的什麼都不做。
    - 載入在 3 秒內完成時,不寫 warn。
    - 判斷邏輯放 `window_mode.rs`,不碰時鐘與視窗,才測得到。例如 `pub const SHOW_FALLBACK: Duration = Duration::from_secs(3);`,
      加一個小狀態(例如 `ShowGate`):`on_page_finished() -> bool`、`on_timeout() -> bool`,回傳「這一次要不要顯示」;`on_timeout` 回 true 時呼叫端寫 warn。
      main.rs 在 page load 的 `Finished` 呼叫前者,另開一個計時(3 秒)呼叫後者。名字由實作者定,但要能不開視窗就測。
- 啟動失敗時開的 `setup` 視窗(`start_screen`)**不改**:它不是 HUD 的畫面,照舊有系統外框。
- 置頂照舊:X11 建好視窗後 `set_always_on_top(true)`、拿到焦點時再設一次(`apply_session_behaviour`)。

### 2. 權限剛好四個(場景 2)

`apps/desktop/src-tauri/capabilities/default.json` 的 `permissions` 剛好是這六條(順序不拘):

```json
["core:default", "window-state:default",
 "core:window:allow-start-dragging", "core:window:allow-start-resize-dragging",
 "core:window:allow-minimize", "core:window:allow-close"]
```

- 對應 `packages/ui-shared/src/hud/window-controls.ts` 用到的四個方法:`startDragging`、`startResizeDragging`、`minimize`、`close`。
- 不多開別的視窗操作(`core:default` 自帶的唯讀項目不算)。`windows` 照舊是 `["teach", "test"]`。

### 3. 頁面在第一次畫面之前就知道模式(場景 3、Scenario Outline)

- **偵測放 Rust 端**:建視窗之前,問 GDK 預設螢幕有沒有合成器(`gdk::Screen::is_composited()`;Wayland 永遠是 true,X11 沒有合成管理員時是 false)。
  - 只問一次,建窗前決定。執行中合成器開或關不處理(ADR 裡寫)。
  - `gdk` 已經是 tauri(經 tao)的間接依賴,版本 0.18.2。`Cargo.toml` 直接依賴時用同一個版本,不要讓 lock 裡多出第二份。
- **怎麼交給頁面**:`WebviewWindowBuilder::initialization_script`。WebKit 在建好根元素之後、頁面任何內容載入之前執行它;
  它是 user script,不受頁面的 CSP 管,也比卡片的 `main.ts` 早。
  - 頁面那一段程式放在 **`apps/desktop/src-tauri/src/window_mode.js`**,Rust 用 `include_str!` 讀進來。
    Rust 只在它前面接一行 `window.__LC_WINDOW_MODE__ = {"frameless":true,"solid":false};`(JSON,由 `serde_json` 產生)。
    這樣 Rust 與 vitest 測的是同一個檔。
  - `window_mode.js` 只做一件事:照 `__LC_WINDOW_MODE__` 對 `document.documentElement.classList` 加 `hud-frameless` 與(需要時)`hud-solid`。
    不用 `innerHTML`、不插 `<style>`、不設 `style` 屬性、不呼叫 `invoke`、不等任何非同步的東西。
    防呆:`document.documentElement` 是 null 時不丟錯、直接結束(WebKit 的 document start 時根元素應該已經在;真的沒有就是 `@manual` 會抓到的錯,不在頁面裡補救)。
  - class 名字跟 14 的 `packages/ui-shared/src/hud/layout.ts`(`FRAMELESS_CLASS`、`SOLID_CLASS`)一致。
- 純函式放 **`apps/desktop/src-tauri/src/window_mode.rs`**(`lib.rs` 加 `pub mod window_mode;`):
  - `WindowMode { frameless: bool, solid: bool }`。
  - `mode_for(composited: bool) -> WindowMode`:`frameless` 永遠 true,`solid = !composited`。
  - `init_script(mode: WindowMode) -> String`:那一行 JSON 加上 `window_mode.js` 的內容。
- 判定「第一次畫面之前就決定」:HudPanel 只在 render 當下讀根元素的 class(`readRoot`,不會跟著變)。
  所以面板元素自己帶 `hud-frameless` class、而且畫了標題列,就證明 class 在卡片掛上之前就在了。

### 4. 關閉走同一條路

- 自畫的關閉鈕呼叫視窗的 `close()`(`window-controls.ts` 已經這樣做),跟系統關閉鈕送同一個關閉請求。這張不改那條路,也不另外攔。
- 兩個視窗都關掉之後 app 結束(exit 0),window-state 外掛照舊在關閉時寫檔(T2c-2 的 F2)。
- phase-3 的「關閉縮到系統列」之後攔的是同一個事件,自畫的按鈕不用另外處理。

### 5. 標題列的縮小、關閉鈕改成切角(只改 `hud.css`,必要時 `HudTitleBar.svelte`)

- 跟 T15 第四輪的 HudButton 同一種畫法:1 像素黑線沿切角走一圈(左上、右下兩個切角;切角大小由實作者依按鈕尺寸定,4–6 像素),內底跟著 `--hud-panel` 走。
- 四種狀態:

  | 狀態 | 長相 |
  |---|---|
  | 一般 | 黑框、內底跟面板同一個 token |
  | hover | 框線變飽和橘,內底淡橘(跟 HudButton 的 hover 同一組 token) |
  | focus-visible | 框線變飽和橘,加一圈淺色內框(T14 的內框);跟 hover 分得出來 |
  | 停用 | 沒有這個狀態(標題列的按鈕不會停用) |

- **不准有 outline**(任何狀態的計算樣式 `outline-style` 都是 `none`,或 `outline-width` 是 0);切角外側與外圍一圈 0 個橘色點。

### 6. 縮放把手

- 一般:看不見(現在就是)。hover:**不畫填色,只換游標**(現在是整塊橘色,四個角的把手會在透明的切角裡畫出 12 × 12 的橘色方塊)。
- focus、停用:沒有這兩個狀態(把手不是按鈕,不能取得焦點)。
- 量法:hover 時把手的計算 `background-color` 是透明;面板四個切角外側 0 個橘色點。

### 7. hover / focus 的框線是飽和橘(T15 之後的新規則)

- HudButton、HudField、縮小、關閉鈕,在 hover 與 focus 時,四條直邊正中間那一點是 (231, 119, 31) ±10(每個通道)。
- 淡橘填色 (247, 208, 177) 跟它差很遠,所以「線不見、只剩淡橘」會紅;線變黑、變淡也會紅。
- 在展示頁(Chrome)與兩張卡(桌面 app,`@manual` 時一起量)都量。

### 8. 停用狀態(新規則第 1 條)

- 展示頁加一顆停用的 HudButton 與一個停用的 HudField,放在現有元件**後面**
  (第一個 `[data-hud="panel"]`、前三顆 `[data-hud="button"]`、前兩個 `[data-hud="field"]` 維持原樣:T14、T15 的量尺用索引找元素)。
- 停用時:跟一般狀態至少差 30 個像素(任一通道差 > 32,外擴 6 像素);沒有橘色;切角外側與外圍一圈 0 個橘色點。
- 考試卡的「送出」在評分中會停用(06 phase-1 `@manual`),`@manual` 時一起看。

### 9. 展示頁要看得到縮小、關閉鈕(只改 `gallery/Gallery.svelte`)

- 現在的展示頁在瀏覽器裡,`createWindowControls()` 的 `available` 是 false,標題列的兩顆按鈕不畫,量不到。
- 加一個開關 `<input type="checkbox" data-gallery="fake-window-controls">`:勾起來時,HudPanel 拿到一個假的 controls(`available: true`,四個方法都是空動作)。
  配合「無框」開關,兩顆按鈕就畫出來。只影響展示頁;`hud.css` 照舊不提 gallery。

### 10. 不退步

- 10 phase-1、phase-2,14 phase-1、phase-2,06、07 已 done 的 phase,非 `@manual` 場景全綠,`.feature` 沒改。
- `apps/desktop/src/*.test.ts`(含 `tauri-config.test.ts` 的 CSP 與兩個視窗的 html)、`packages/ui-shared/src/hud/*.test.ts` 全綠。
- T15 的量值照舊:底色放大法、O2–O4、切角、送出鍵不捲動可見、D1。
  注意:無框之後兩張卡上方多一條標題列(約 30 像素),送出鍵與 100 字內文在 360 × 480 還要看得到,`@manual` 時重量。
- CSP 照舊:`window_mode.js` 是 user script,不改頁面的 CSP。

### 11. 觀感(`@manual`,前端重拍、技術顧問判;開發 worker 不做這件)

一律用 `tauri build` 的產物(有 CSP,理由見 T2c-2 工單驗收 11)。重活要協調者給位子。真的 learning/ 開工、收工各量一次,前後要相同。
不在使用者的桌面上送滑鼠鍵盤;需要指標動作的,在獨立的虛擬顯示(Xvfb)裡做。

| 場景 | 怎麼拍、怎麼量 |
|---|---|
| 有合成器時切角看得到桌面 | Xvfb 加 `xcompmgr`,背景用 `xsetroot -solid` 塗一個已知顏色;`xwd -root` 截整個螢幕。切角三角形裡的像素 = 背景色 ±3;根元素沒有 `hud-solid` |
| 沒有合成器時切角是實心底,不是黑的 | 同一個 Xvfb 不開 `xcompmgr`。根元素有 `hud-solid`;切角三角形裡的像素 = `--hud-solid` (244, 246, 248) ±3,沒有 (0, 0, 0)。**從啟動開始每 100 毫秒 `xwd` 一張、拍 3 秒**:視窗出現之後的每一張,切角都不是黑的(證明「載入完才顯示」) |
| 拖曳與縮放、重開後回到原位 | Xvfb 裡用 XTest(`ctypes` 呼叫 `libXtst`)在標題列按下、移動、放開;在右下角把手做一次。視窗的位置與大小(`xwininfo`)要變。關掉再開,位置大小要一樣。沒有視窗管理員時 GDK 會自己模擬移動;**做不到時停下來回報顧問**,不在使用者桌面上送輸入 |
| 自畫的縮小、關閉 | 在 `:1`(GNOME)上,經由檢查器呼叫按鈕的 `click()`(DOM 事件,不是 OS 輸入)。縮小:`xprop` 看到 `_NET_WM_STATE_HIDDEN`。關閉:兩個視窗都關掉後 app exit 0、window-state 有寫檔,跟用 `WM_DELETE_WINDOW` 關的那一次一樣 |
| 置頂照舊 | `:1` 上兩個視窗的 `_NET_WM_STATE` 有 `_NET_WM_STATE_ABOVE` |
| 點切角還是點到視窗(已知限制) | Xvfb 裡 XTest 點切角的一點,頁面收到 `pointerdown`(檢查器先掛監聽);或 `xwininfo -shape` 顯示沒有輸入形狀 |
| 標題列、縮小 / 關閉鈕、縮放把手的長相 | 檢查器截圖(`Page.snapshotRect`)。四種狀態各一張(第 5 點的表),附切角外側、外圍一圈、框線顏色、放大法的數字 |
| 兩張卡沒退步 | T15 的整套重拍:送出鍵不捲動可見、100 字內文、對錯符號、HP 條、作答欄與按鈕的狀態 |

### 需要 ADR(ADR-072)

協調者配給 **ADR-072**。要寫的:

- 合成器怎麼偵測:GDK `Screen::is_composited()`,建窗前問一次;不追執行中的變化(之後要追再開票,GTK 有 `composited-changed` 訊號)。
- 結果怎麼交給頁面:`initialization_script`(user script,在頁面內容之前執行,不受頁面 CSP 管);不用 `invoke`(非同步,會先畫一次錯的)、不用 URL 參數(要改兩張卡的程式)。
- 視窗載入完才顯示,window-state 外掛不還原「可見」。**逾時退路:超過 3 秒還沒載入完也照樣顯示,寫一行 warn**(使用者不能永遠看不到視窗;代價是那一次可能先黑一下)。
- 已知限制:合成器只問一次(執行中開關要重開 app);Wayland 上 `is_composited` 一律 true,只驗 X11。
- 只驗 Linux;macOS(`macOSPrivateApi`)、Windows 的透明視窗跟 phase-4、phase-5 一起在實機上做。

## 使用者看得到的差別

- 兩個視窗沒有系統的標題列與外框了。視窗就是那塊切角的 HUD 面板;最上面是 HUD 自己的標題列(「教學卡」「考試卡」),右邊有 – 和 × 兩顆切角小按鈕。
- 四個切角外面看得到桌面(有合成器時);沒有合成器時切角是淺灰的實心底,不會是黑的。
- 拖標題列移動視窗、拖邊或角縮放;– 縮小、× 關閉,跟以前按系統的按鈕一樣。
- 已知限制:點在切角外面那一小塊,點擊還是給視窗(視窗實際上是長方形);執行中開關合成器要重開 app。全部見「已知限制」。
- 頁面卡住超過 3 秒時,視窗照樣出現(可能先黑一下),不會像程式沒開。
- 標題列佔掉上面約 30 像素,卡片內容往下移。
- 視窗打開時不會先閃一下黑的。

## 已知限制(不在這張修)

- 點在切角外面那一小塊,點擊還是給視窗(視窗實際上是長方形)。使用者選 A 時已知道。
- **合成器只在建窗前問一次**:使用者在 app 執行中開或關合成器,畫法不會跟著變,要重開 app。
- **Wayland 上 `is_composited` 一律是 true**(Wayland 的合成器就是顯示伺服器)。這張只驗 X11 的兩種情況(有合成管理員、沒有)。
- 逾時退路顯示的那一次,沒有合成器時可能先黑一下(頁面還沒畫好)。只在載入超過 3 秒時發生。

## 紅測試(另一個角色寫,開發 worker 不改)

規格作者不寫紅測試(SKILL §4g 第 1 條)。**建議由 -e5 寫**,-ed 驗收,跟 T13、T15 一樣三雙手。

| 驗收 | 量什麼 | 怎麼量(建議) |
|---|---|---|
| 1 | 設定檔 | 讀 `tauri.conf.json`:兩個視窗 `decorations === false`、`transparent === true`、`visible === false` |
| 2 | 權限 | 讀 `capabilities/default.json`:`permissions` 跟那六條的集合相等,`windows` 不變 |
| 3 | 頁面程式 | vitest 讀 `window_mode.js`,在 `node:vm` 裡配一個假的 `document.documentElement.classList` 跑兩種模式,看 class;靜態掃描禁止 `innerHTML`、`<style>`、`style` 屬性、`invoke`、`await`、`setTimeout`;class 名字跟 `layout.ts` 的兩個常數一致 |
| 3 | Rust 純函式 | `apps/desktop/src-tauri/tests/window_mode.rs`(獨立檔,不寫在實作檔的 `mod tests`):`mode_for(true/false)`、`init_script` 開頭那行是合法 JSON、後面就是 `window_mode.js` 的內容 |
| 1 | 逾時退路 | 同一個 Rust 測試檔:用一個**故意不結束載入的頁面**(測試替身,只會叫 `on_timeout`、永遠不叫 `on_page_finished`)→ 要顯示一次、要警告;載入在逾時前完成 → 顯示一次、`on_timeout` 回 false(不警告);逾時之後才完成 → `on_page_finished` 回 false(不顯示第二次);`SHOW_FALLBACK` 是 3 秒。測試不真的等 3 秒(直接呼叫兩個方法);另可加一條靜態檢查:main.rs 有計時並在逾時時呼叫 `log::warn!` |
| 5、7 | 縮小 / 關閉鈕 | 展示頁勾「無框」與「假視窗按鈕」:四種狀態的切角外側、外圍一圈、框線中點顏色、`outline` 計算樣式、放大法、focus vs hover 像素差 |
| 6 | 縮放把手 | hover 時計算 `background-color` 透明;面板切角外側 0 個橘色點 |
| 7 | 框線顏色 | HudButton、HudField 在 hover / focus 時四邊中點 (231, 119, 31) ±10 |
| 8 | 停用 | 停用的按鈕與作答欄:跟一般差 ≥ 30 像素、沒有橘色、切角乾淨 |
| 10 | 不退步 | 子行程跑上面列的 phase 的非 `@manual` 場景,exit 0;done phase 的 `.feature` 雜湊不變 |

注意:

- 量尺沿用 T15 的 `render-test-support.ts`、`card-render-test-support.ts`、`gallery-phase2-test-support.ts`。前端的量法腳本在 scratchpad,需要的話跟前端要。
- 在基底上預期:1、2、3、5、6、7(縮小 / 關閉鈕那部分)、8 紅;7 的 HudButton、HudField 部分本來就綠(T15 第四輪是飽和橘),當防退步;10 綠。
- 合成器偵測本身(GDK)沒有自動測試,靠 `@manual` 的 Xvfb 有 / 沒有 `xcompmgr` 兩種真的環境。
- 建議照 T14 用丟棄式改法證明能轉綠(不進 git,交件前刪)。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run apps/desktop packages/ui-shared/src/hud
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@desktop-shell and @phase-6 and not @manual' --format summary
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@hud-skin and not @manual' --format summary
(cd apps/desktop/src-tauri && CARGO_BUILD_JOBS=2 cargo test --test window_mode)
npm run boundaries
```

- 環境:`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`。受保護的測試檔清單由協調者派工時附上。
- **cucumber 一律用 `--tags`,不要在命令列給 feature 檔路徑**(`cucumber.js` 的 `paths` 不會被蓋掉,給檔名會跑全部場景)。
- **每次跑 cucumber,`BeforeAll` 都會 `cargo build --bin lc-fs`**(新 worktree 第一次是冷編譯約 55 秒)。`cargo test` 也是 Rust 編譯。這兩樣都是重活,先跟協調者拿位子,一次一個。
- 開發 worker 可以跑一次 `npm run tauri -- build --debug --no-bundle` 確認編得過(重活,要位子);截圖與 `@manual` 是前端的事。
- 不跑變異測試(-ed 驗收的事)、不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev`。

## 不在範圍

- 不改任何測試檔(`*.test.ts`、`*test-support.ts`、`features/steps/`、`src-tauri/tests/`)與 `.feature`。覺得測試錯了就停下回報協調者,由紅測試作者改。
- 不改兩張卡(`apps/teach-card`、`apps/test-card`)的程式:頁面模式由桌面殼的 user script 設,卡片照舊只讀根元素。
- 不改 `setup` 視窗(啟動失敗的畫面)。
- 不做 macOS、Windows(phase-4、phase-5)。不做點擊穿透(要改視窗形狀,使用者選 A 時已知道)。不追執行中的合成器變化。
- 不改 `package.json`、`package-lock.json`。`apps/desktop/src-tauri/Cargo.toml` 與 `Cargo.lock` 是 10 自己的檔,可以改,但只加 `gdk`(或 `gtk`)的直接依賴,版本跟 lock 裡現有的一樣。
- 不配 ADR 號(協調者配)。

## 預算

`budget_usd: 5`。grok 不設花費上限(使用者 2026-10-15),只記錄;算不出來寫「不知道」。

## 測試誰寫

- 紅測試、步驟定義、量尺:建議 -e5(見上)。開發 worker 以紅測試分支為基底。
- 實作:worker-grok,只改「touches」列的檔。
- 驗收:-ed,照 `worker-acceptance`。
- 觀感:前端重拍,技術顧問判(驗收 11)。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
排程:這張改 `apps/desktop/` 與 `packages/ui-shared/src/hud/`;做的期間不要開別的改這兩處的工單(R2)。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
