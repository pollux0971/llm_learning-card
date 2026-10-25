# T54 調查報告:HUD 縮放把手第一下拖不動、變成選字(T47 `@manual` 的 O1)

> 工單:`../tickets/T54-hud-resize-first-drag-investigation.md`。做的人:前端(UI/Tauri 負責人)。判的人:技術顧問。
> 基底:main `815e17b`。建置產物 sha256 `42032d5e303497d3…`(跟 T50 `@manual` 那次同一個,這之間 app 沒改)。
> 量測時間:2026-10-25 13:22–13:47。LLM 真呼叫 0。真的 learning/ 前後相同。**只調查,沒有改產品碼**(丟棄式的兩個改法都已還原,不進 git)。

## 結論

- **重現了**:照 T47 的做法,6 次壞 6 次(T47 是 7 次壞 6 次)。
- **H1 成立,H2 不成立。不是視窗管理員吃掉這一下。**
  - 壞的那一下,四層都看得到它:X 有按下與放開;按下前 server 說左鍵是放開的;沒有人抓著指標;GTK 收到 PRESS 與 RELEASE;頁面收到 `mousedown` 與 `mouseup`。
  - 頁面就是**沒有 `pointerdown`**。我們的把手(`../../packages/ui-shared/src/hud/HudResizeHandles.svelte:26`)與標題列(`../../packages/ui-shared/src/hud/HudTitleBar.svelte:13`)都掛在 `onpointerdown`,所以沒有叫 `startResizeDragging` / `startDragging`,只剩 WebKit 自己的拖曳(選字)。
- **原因**:上一次拖拉被桌面接手(縮放或移動)之後,放開給了桌面。GTK 只報一般的 LEAVE / ENTER(crossing mode 是 normal,不是 grab),沒有 RELEASE,也沒有 GRAB_BROKEN。WebKitGTK 的 pointer 狀態因此一直是「按著」。下一次按下只發 `mousedown`、不發 `pointerdown`;放開時收到 `pointerup`,狀態才回正。所以重試、或中間點一下,就好了。
- **跟最小尺寸無關**:不是最小尺寸也一樣壞(E1 6/6);最小尺寸但前面是一次點擊,就不壞(E2 0/6)。T47 的「從 360×400 開始才壞」是順序造成的:那幾次剛好都是「拖到最小」之後接著拖。
- **X11 與 Wayland 都會**(E7 8/8)。
- **標題列也會**:拖標題列移動視窗,馬上再移動,第二下 4/4 不動(E8)。使用者的真桌面是 X11 session,**真人很可能遇到**:連續移動 HUD 視窗兩次,第二次不動,要先點一下別的地方。
- **T47 第一輪那兩次對不上的**:按在離邊 3 px 的地方,落在 tao 自己的 5 px 縮放邊(tao 在 GTK 那一層直接開始縮放,不經過頁面),所以不受影響(E5 0/6)。按在 6 px(只有頁面的把手接得到)就 4/4 壞(E5b)。
- **我們的程式繞得過**:把手改成 `onmousedown`(丟棄式建置),X11 0/12 壞、Wayland 0/4 壞。`onpointerdown` 裡加 `preventDefault` 沒用(6/6 壞),因為壞的那一下根本沒有 `pointerdown`。

## 建議

1. **開修正工單(14-hud-skin)**:`HudResizeHandles.svelte` 與 `HudTitleBar.svelte` 都改成在 `mousedown` 開始拖拉,只認左鍵(`button === 0`;現在任何鍵都會開始縮放)。考試卡、教學卡共用這兩個元件,一起修好。量法照這份(X11 與 Wayland 的 R、E1、E4、E8)。
   - 觸控:tao 的觸控縮放邊照舊有效;觸控拖標題列在 HUD 不在範圍,要的話另議。
2. **要不要回報上游**(WebKitGTK:桌面接手拖拉之後 pointer 狀態不重設):顧問決定。這份的 E1 就是最小重現。
3. **真桌面要不要請使用者試**:機制在 X11 與 Wayland 都證實了。若顧問要確認真人遇得到,一分鐘的試法是「拖標題列移動視窗兩次」。

## 每一次拖拉記了什麼

| 層 | 量什麼 | 怎麼量 |
|---|---|---|
| X(實體) | 按下、放開真的有發生 | XI2 原始事件(RawButtonPress / RawButtonRelease),記主機時間與 server 時間 |
| X(按鍵狀態) | 按下前一刻,server 認為左鍵是放開的嗎 | `XQueryPointer` 讀按鍵 mask(只讀) |
| X(抓取) | 按下前一刻,有沒有人還抓著指標 | 試一次 `XGrabPointer` 馬上放掉(每種實驗一半次數才做) |
| GTK | app 收到哪些按下、放開、進出、抓取中斷 | gdb 在 `gtk_main_do_event` 下條件中斷點,只記不停(`GDK_DEBUG=events` 在這台沒有輸出,照工單改用 gdb) |
| 頁面 | 懸停時的 `buttons`;這一下的 `pointerdown`、`pointermove`、`pointerup`、`mousedown`、`mouseup`、`selectstart`;選到幾個字 | 檢查器裝 capture 監聽,只記不擋 |
| 視窗 | 拖之前、之後的大小與位置 | X11:`xwininfo`;Wayland:頁面的 `innerWidth`/`innerHeight` 與截圖對齊找到的位置 |

每次記錄的那一下之前,先移到起點懸停 0.6 秒,再讀 mask、(一半次數)試抓,然後才按下去。真拖拉:按下、等 0.6 秒、分 40 步移動、放開。

## 結果

「壞」= 視窗大小(標題列那幾種:位置)沒變。每種的「前置」(記錄那一下之前的那次拖拉或縮放)每一次都成功,所以每一筆都算數。

| 實驗 | 做法 | H1 預測 | H2 預測 | 壞 / 次數 | 有試抓 / 沒試抓 |
|---|---|---|---|---|---|
| 重現 R | 360×480 → 拖右下角縮到最小(停在 360×400)→ 不點 → 從 360×400 拖右下角往外 | 壞 | 壞 | **6 / 6** | (重現不試抓) |
| E1 | 480×600 → 點一下 → 拖角 +40(接上)→ 不點 → 拖角 −40 | 壞 | 好 | **6 / 6** | 3/3、3/3 |
| E2 | `XResizeWindow` 縮到 360×400 → 點一下 → 拖角 +120 | 好 | 壞 | **0 / 6** | 0/3、0/3 |
| E3 | 480×600 → 點一下 → 拖角 +40 → **點一下** → 拖角 −40 | 好 | 好 | **0 / 6** | 0/3、0/3 |
| E4 | 480×600 → 點一下 → 拖標題列移動 → 不點 → 拖角 +40 | 壞 | 好 | **6 / 6** | 3/3、3/3 |
| E5 | 480×600 → 點一下 → 拖右邊(離邊 3 px)+40 → 不點 → 再拖右邊 −40 | 壞 | 好 | **0 / 6** | 0/3、0/3 |
| E5b(加的) | 同 E5,按在離邊 6 px | 壞 | 好 | **4 / 4** | 2/2、2/2 |
| E8(加的) | 480×600 → 點一下 → 拖標題列移動 → 不點 → 再移動 | 壞 | 好 | **4 / 4** | 2/2、2/2 |
| E6a(丟棄式:把手改 `onmousedown`) | R、E1、E4 各 4 次 | — | — | **0 / 12** | 0/6、0/6 |
| E6b(丟棄式:`onpointerdown` 加 `preventDefault`) | R、E1 各 3 次 | — | — | **6 / 6** | 3/3、3/3 |
| E7a(Wayland) | 點一下 → 拖角 +40 → 不點 → 拖角 −40 | 壞 | 好 | **4 / 4** | 2/2、2/2 |
| E7b(Wayland) | 點一下 → 拖標題列移動 → 不點 → 再移動 | 壞 | 好 | **4 / 4** | 2/2、2/2 |
| E7a + `onmousedown`(Wayland) | 同 E7a | — | — | **0 / 4** | 0/2、0/2 |

- E1 與 E2 的預測正好相反:E1 全壞、E2 全好,所以 H2 不成立。E3 說明一次完整的點擊就讓狀態回正。
- E5 跟 H1 的預測不同,原因見下一節(另一條路徑);E5b 補上之後就對上了。
- E5b、E8 是 E1–E5 已經分出 H1 / H2 之後才加的(用來解釋 E5、看標題列),各 4 次。工單的時間上限是「分不出來就停」,這次分得出來。

### 每一層量到的(每一筆都是這個樣子;GTK 那一列只量了 gdb 那一組,E1、E3 各 3 次)

| 層 | 壞的那一下 | 好的那一下 |
|---|---|---|
| X 原始事件 | 有按下、有放開 | 有按下、有放開 |
| 按下前 server 的 mask | 左鍵放開(0) | 左鍵放開(0) |
| 試抓指標 | 成功(沒有人抓著) | 成功 |
| GTK(gdb) | PRESS,約 2.1 秒後 RELEASE | PRESS;4–14 ms 後兩個 LEAVE(mode normal);放開那一刻兩個 ENTER(mode normal);**沒有 RELEASE、沒有 GRAB_BROKEN** |
| 頁面 | **`pointerdown` 0**、`mousedown` 1、`pointermove` 31–43(`buttons` 有 0 也有 1)、`pointerup` 1、`mouseup` 1;`selectstart` 0 或 1,選到的字 0–79 個(看拖過的地方有沒有字:R、E4 是 79 個,E1、標題列是 0 個) | `pointerdown` 1(打在把手上)、`mousedown` 1、`pointermove` 3–4、**`pointerup` 0、`mouseup` 0** |
| 懸停時頁面的 `buttons` | 0 | 0 |

- 工單判讀表裡 H1 的預測是「懸停 `buttons` = 1」。**這一條沒成立**:懸停時頁面的 `buttons` 一直是 0,跟 X 的 mask 一致。壞掉的是 WebKit pointer 那一層「這個指標已經按著」的狀態,不是 `buttons` 這個位元。判讀表的另外兩條(X 上沒人抓、GTK 收到按下)都對上 H1。
- 好的那一下,`selectstart` 也有 1 次,但沒選到字:桌面馬上接手,WebKit 收不到後面的移動。

### 另一條路徑:tao 自己的縮放邊

- tao 0.35.3 對沒有邊框的視窗,在 GTK 的 `button-press-event` 裡自己判斷:按下的位置在視窗外圍 **5 px** 以內,就直接 `begin_resize_drag`,用的是那次按下的時間(`src/platform_impl/linux/event_loop.rs` 的 `connect_button_press_event`)。這條路不經過頁面,所以不受 WebKit 的狀態影響。
- HUD 的邊把手是 **6 px** 寬、角把手 12 px(`../../packages/ui-shared/src/hud/hud.css:464`)。按在 0–5 px 走 tao;按在 5–6 px 的邊、或角的其餘部分,只走頁面。
- 頁面那條路:`startResizeDragging` → tao 的 `DragResizeWindow` 排進事件迴圈,才 `begin_resize_drag(…, GDK_CURRENT_TIME)`(同一個檔的 `WindowRequest::DragResizeWindow`)。

### 量測工具的影響

- **試抓指標**:每一種實驗,有試抓與沒試抓的壞的比例都一樣(上表最右欄)。試抓沒有改變結果。
- **`GDK_DEBUG=events`**:app 的輸出裡沒有任何事件行,這台的 GTK 沒開這個。E1、E3 各 3 次照跑:3/3 壞、0/3 壞,跟沒有它一樣。
- **gdb**:E1、E3 各 3 次:3/3 壞、0/3 壞,跟沒有 gdb 一樣。時序沒被拖慢到改變結果。

## 環境與規則

- Xvfb `:97`(1280×1024)+ 巢狀 `gnome-shell --x11`;Wayland:Xvfb `:98`(1000×700)+ 巢狀 `gnome-shell --nested --wayland --no-x11`。教學卡視窗,真的 XTest 拖拉。
- 巢狀 session 包在 `systemd-run --user --scope -p MemoryMax=2G -p MemorySwapMax=0`(Xvfb 1G),PATH 最前面放 ibus-daemon 替身;真桌面的 ibus-daemon 沒動。OOM 0。收尾時 `:97`、`:98` 都不在,沒有殘留行程。
- 所有工具只准 `:97` / `:98`(對 `:1` 結束碼 3,試過)。**沒有對 `:1` 送任何輸入。**
- 每一輪用新的暫存根、假網路、假 `.env`(跑完就刪)。十輪的 console 都是 0 則。
- 丟棄式建置兩次:把手改 `onmousedown`(產物 `5974c191dd2ed4d1…`)、`onpointerdown` 加 `preventDefault`(產物 `59294c9979d8180b…`)。每次建完立刻 `git checkout` 還原,worktree 乾淨;這條分支只有這份報告。
- 量測工具與原始紀錄在前端的暫存區,不進 git。沒有裝任何東西(gdb、xinput 是這台本來就有的)。

## 真的 learning/(只讀)

| | 時間 | 檔案數(不含 .git) | 整體雜湊 | 帳本行數 |
|---|---|---|---|---|
| 前 | 13:20:03 | 64 | `c2e4dd6d71de3976` | 108 |
| 後 | 13:47:49 | 64 | `c2e4dd6d71de3976` | 108 |
