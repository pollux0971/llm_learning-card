---
id: T51
deps: []
touches: [docs/reviews/]
cpu: heavy
budget_usd: 1
status: todo
owner: 前端
must_catch:
  - 結論沒有數字撐住(每個假說都要有一個實驗能讓它不成立;報告列出每個實驗的次數與結果)
  - 只跑一種先後順序就下結論(T47 三輪的順序沒有完全對上,就是這樣看不出來的):E1 到 E4 每種至少 5 次,交錯排
  - 把頁面沒收到 pointerdown 直接說成視窗管理員吃掉:要有 X 那一層的量測(原始按鍵事件、試抓指標)才能這樣說
  - 丟棄式的量測碼或試的改法進了 git:分支上只能有報告檔
  - 對 :1 送任何輸入,或碰真桌面的 ibus-daemon
---

# 工單 T51(調查):HUD 縮放把手第一下拖不動、變成選字(T47 `@manual` 的 O1)

> 狀態:起草 2026-10-25,依技術顧問 2026-10-25 的交代(07p4 之後;低優先;先寫「要量什麼才能分辨視窗管理員吃事件還是我們的程式」,送顧問審)。規格與調查:UI/Tauri 負責人。編號 T51:暫用,協調者配號時改。
> 依據:`../reviews/T47-manual-2026-10-24.md` 的 O1;元件 `../../packages/ui-shared/src/hud/HudResizeHandles.svelte:26`(14-hud-skin phase-1)。
> **這張只調查,不改產品碼。** 交件是一份報告(`docs/reviews/T51-investigation.md`)加建議:開修正工單,或收。LLM 真呼叫 0。

## 已經知道的(T47 `@manual`,Xvfb `:97` + 巢狀 `gnome-shell --x11`,XTest 真拖拉)

- 把手的寫法:每個邊一個 `<div data-hud="resize-handle">`,`onpointerdown` 直接叫 `startResizeDragging`。沒看是哪個鍵,沒有 `preventDefault`。標題列的移動也是同一種:`../../packages/ui-shared/src/hud/HudTitleBar.svelte:9` 叫 `startDragging`。
- 三輪加起來,從最小 360×400 開始的 7 次拖拉,第一下有 6 次沒接上;從別的大小開始的 7 次都接上。重試 1–2 下都接上。
- 有記頁面事件的那一輪:
  - **沒接上**:頁面 0 個 `pointerdown`、39–44 個 `pointermove`、1 個 `pointerup`,選到字(73、1114 個字)。
  - **接上**:1 個 `pointerdown`(打在把手上)、3–4 個 `pointermove`、**0 個 `pointerup`**(放開時指標在 mutter 手上)。
- 那一輪的先後順序:拖(接上)→ 沒有任何點擊 → 下一次拖第一下沒接上。中間有真的點擊(按下 + 放開)的,下一次拖都接上。
- 但第一輪有兩次不合這個順序:接上之後馬上再拖(邊,不是角),也接上了。那一輪沒記頁面事件。
- 使用者的真桌面是 X11 session(`XDG_SESSION_TYPE=x11`),走的是同一條 mutter 的路。真人會不會遇到,還不知道。

## 兩個假說(這張要分出來)

- **H1:按鈕狀態沒還原**。上一次拖接上之後,放開被視窗管理員的抓取接走,GTK / WebKit 一直以為左鍵還按著。下一次按下被當成「已經按著時又按一下」,不發 `pointerdown`,只當一般拖曳去選字。放開時收到 `pointerup`,狀態才回正,所以重試就好。
  - 這是我們這一層(GTK / WebKitGTK / tao 的組合,加上我們怎麼叫它)的事,不是視窗管理員吃掉這一下。
- **H2:跟最小尺寸有關**。視窗在最小尺寸、上一次拖被 mutter 夾住時,這一下在 X 那一層就被 mutter 留著或吃掉,app 根本沒拿到按下。
- 兩個都不是的話,報告寫「H3:其他」,附量到的東西。

## 要量什麼(每一次拖拉都記這幾層)

| 層 | 量什麼 | 怎麼量 | H1 預測 | H2 預測 |
|---|---|---|---|---|
| X(實體) | 按下、放開真的發生、時間 | `xinput test-xi2 --root` 在 `:97` 記原始事件(RawButtonPress / RawButtonRelease) | 有 | 有 |
| X(抓取) | 按下前一刻,有沒有人還抓著指標 | 小工具在按下前試一次 `XGrabPointer`,馬上放掉;回 `AlreadyGrabbed` = 有人抓著 | 沒有 | 有(mutter) |
| GTK | app 有沒有收到按下、放開、抓取中斷 | `gdb` 在 `gtk_main_do_event` 下條件中斷點,記 `GDK_BUTTON_PRESS`、`GDK_BUTTON_RELEASE`、`GDK_GRAB_BROKEN`(中斷點會拖慢時序,先只記不停;拖慢到改變結果就改別的方法,寫進報告) | 收到按下 | 沒收到按下 |
| 頁面 | 按下前懸停時的 `buttons`;這一下有沒有 `pointerdown`、`mousedown`、`selectstart`;之後的 `pointermove` 帶的 `buttons` | 檢查器裝 capture 監聽(只記不擋) | 懸停 `buttons` = 1;沒有 `pointerdown` | 懸停 `buttons` = 0 |
| 視窗 | 拖之前、之後的大小 | `xwininfo` | | |

判讀:

| 量到的 | 結論 |
|---|---|
| X 上沒有人抓著、GTK 收到按下、頁面懸停 `buttons` = 1、沒有 `pointerdown` | H1:我們這一層的狀態沒還原,不是視窗管理員吃掉 |
| 按下前 X 上還有人抓著(`AlreadyGrabbed`),GTK 沒收到按下 | H2:視窗管理員還抓著,這一下被它吃了 |
| GTK 收到按下、頁面懸停 `buttons` = 0,還是沒有 `pointerdown` | 都不是:WebKit 自己的判斷,要再拆(H3) |

## 實驗(都在 `:97`,每種至少 5 次、交錯排)

| | 做法 | H1 預測 | H2 預測 |
|---|---|---|---|
| E1 | 不是最小尺寸:拖角接上 → 不點任何東西 → 馬上再拖角 | 第二下壞 | 第二下好 |
| E2 | 最小尺寸,但不是拖過去的:用 `XResizeWindow` 縮到 360×400,先真的點一下空白處 → 拖角 | 好 | 壞 |
| E3 | 拖角接上 → 真的點一下空白處(按下 + 放開)→ 再拖角 | 好 | 看尺寸 |
| E4 | 用標題列移動視窗(`startDragging`)→ 不點 → 拖角 | 壞(同一種接手) | 好 |
| E5 | 同 E1,拖的是邊,不是角(第一輪那兩次對不上的情況) | 壞 | 好 |

另外兩組,幫報告寫建議用(丟棄式建置,不進 git):

- **E6(我們的程式能不能繞過)**:把手改成 `onmousedown`,或在 `onpointerdown` 裡加 `preventDefault`,重跑 E1。看壞的那一下有沒有 `mousedown`、會不會選字。
- **E7(換一條路)**:同一個 app 在巢狀 Wayland(`:98`)重跑 E1。Wayland 的縮放走 `xdg_toplevel.resize`,不經 X 的抓取。

## 交件

- 報告 `docs/reviews/T51-investigation.md`:
  - 每個實驗每一次的四層紀錄(表格),次數、結果。
  - H1 / H2 / H3 哪一個成立,哪一個實驗讓另一個不成立。
  - 建議:開修正工單(寫是改我們的元件、改 tao / WebKitGTK 的用法、還是只能繞過),或收(真人遇不到的理由)。
- 量測工具在前端的暫存區,不進 git。報告不放暫存區路徑、不放 fixture 的卡片名與類別名。
- 真的 learning/ 前後各量一次。

## 環境與規則

- Xvfb `:97`(1280×1024)+ 巢狀 `gnome-shell --x11`;E7 用 Xvfb `:98` + 巢狀 `gnome-shell --nested --wayland`。
- 巢狀 session 包 `systemd-run --user --scope -p MemoryMax=2G -p MemorySwapMax=0`,PATH 最前面放 ibus-daemon 替身。
- XTest 只送 `:97` / `:98`(小工具對別的 display 直接結束)。**不對 `:1` 送任何輸入**,不碰真桌面的 ibus-daemon。
- 暫存根 + 假網路,假 `.env` 跑完就刪。關 app 用兩個視窗的關閉鈕。
- 重活(建置、巢狀 session)先跟協調者拿位子,`CARGO_BUILD_JOBS=2`;完成回「釋放」。
- 這台沒有 `xtrace` / `xscope`,也沒有別的 X 視窗管理員。要裝東西就先問,不自己裝。

## 不在範圍

- 修好它(調查完才決定要不要開修正工單)。
- 把手的大小、位置、游標樣子。
- 在真桌面上試(要不要請使用者自己試,顧問決定)。

## 預算

`budget_usd: 1`(沒有 LLM 花費;前端 session 的時間)。`cpu: heavy`:要建置丟棄式的 app,還要開巢狀 GNOME Shell。

## 顧問審(待)

- 量什麼、怎麼判、E1–E7 的設計,請顧問先審。審過才開始量。
