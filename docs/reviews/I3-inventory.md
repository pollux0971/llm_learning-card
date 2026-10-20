# I3 盤點:桌面複習這個整合點現在在哪裡(2026-10-18)

> 作者:UI/Tauri 負責人(T22、T24、T23 的規格作者)。判定:技術顧問。派工:協調者(顧問 2026-10-18 派)。
> 被盤點:main `de5ac65`,加這個分支上的兩個 commit(`9416073` 07 NEXT.md 的 gate、`a42b354` T32 工單檔頭),tree `44d4167fc5dfd6483d414ae8c848df5d19a866bd`。
> 簽出:workers clone 的 worktree(分支 `pollux0971/i3-inventory`)。重活(cucumber、守門、建置、開 app)在協調者給的位子裡跑,06:07–06:20。
> 依據:`../integration/i3-desktop-review.feature`、`../01-roadmap.md` 的 I3 段落、ADR-073、ADR-075。

## 結論

- **I3 要的四個 phase 都 `done`**:10-desktop-shell phase-2(2026-10-15)、06-test-card phase-2 與 phase-3(2026-10-17)、11-review-cli phase-2(2026-10-16)。
  phase 表標 I3 的另外兩個也 `done`:01-data-layer phase-4(2026-09-04)、11-review-cli phase-3(2026-10-17)。
- **roadmap 的兩項整合工作都做了**,在 T24(合併 `341b663`)。做法照 ADR-075 改過(見第 3 節)。
- **i3 的九個場景**:
  - 五條自動場景**都還沒有步驟定義**(cucumber 回 undefined)。每一條要的行為,phase 層都有一對一的場景守著,真的跑全綠。
  - 三條 `@manual` 不用真資料。這次在隔離的顯示裡做了:視窗位置重開保留**過**、X11 置頂**過**。
    Wayland 偵測與說明**不過**:真前端的頁面沒有那個提示(見第 4、5 節)。
    (2026-10-21 更新:T34 後重做,Wayland 這條**過**,見 T34-manual-2026-10-21.md;O1 提示蓋住捲到底的按鈕,開補丁票 T35。)
  - 一條 `@e2e @manual` 要真資料上有到期的卡,現在做不到,照 ADR-073 併到 I4。
- **缺口兩件,開成一張 T34**(協調者配號;草稿另交顧問審):(A) 整合層的步驟定義;(B) Wayland 提示接到真前端。
- **I3 照 ADR-073 不打 tag。** 「I3 自動驗收通過」= T34 合併後 i3 的自動場景全綠,而且三條 fixture 的 `@manual` 顧問判過(Wayland 那條要 T34 之後重做)。
  `@e2e @manual` 那條併到 I4。

## 1. 九個場景逐條

`docs/integration/i3-desktop-review.feature`,行號是場景那一行。「守著它的測試」是現在真的會跑、而且這次跑過是綠的那些。

| 場景(行) | 標籤 | 現況 | 現在守著它的測試 | 差在哪 |
|---|---|---|---|---|
| A person completes a review session in the window(12) | `@e2e @manual` | **要真資料**,併到 I4 | 同一件事在 fixture 上:06 phase-2「A full session end to end」(`@manual`,T24 `@manual` 證據 `T24-manual-2026-10-17.md`)、T23 / T32 的 `@manual` | 要真的 learning/ 上有五張到期的卡。卡要被教學卡標成學過才會到期(07 phase-2,I4)。另見 O1:「Today 0 / 5」這個字樣跟現在的 header 不一樣 |
| The window and the terminal produce the same session(20) | — | **步驟 undefined**(3 條:背景第 1 條、When、Then) | 06 phase-2「The card shows exactly what the real scheduler returns」(`../../features/06-test-card/phase-2.feature:9`;步驟 `../../features/steps/test-card-phase2.steps.ts:68`、`:76`、`:82`)。考試卡的 `TestSession` 接程序內的真 core,終端機那一邊是真的 `scripts/review.ts --dry-run` 行程 | 「視窗」是程序內的 handler,不是 Rust 起的側車行程 |
| File access goes through the Tauri boundary(25) | — | **步驟 undefined**(5 條) | 10 phase-2「Reading a file goes through the boundary」(`../../features/10-desktop-shell/phase-2.feature:136`)、「Paths that are not clean relative paths are refused through the read command」(`:176`,16 列含 `..`、絕對路徑、反斜線)、「A symbolic link out of the directory is refused」(`:442`);06 phase-2「A file outside the learning directory cannot be reached」(`../../features/06-test-card/phase-2.feature:14`)。步驟 `../../features/steps/desktop-shell-phase2.steps.ts:561`、`:588`、`:841`、`:852`、`:879`。走的是 lc-fs probe,跟 Tauri command 同一份 `learning_fs`。vitest:`../../apps/desktop/src/webview-learning-fs.test.ts`(webview 的 LearningFs 只叫 `invoke`);cargo:`../../apps/desktop/src-tauri/tests/path_guard.rs`、`learning_fs.rs`、`commands.rs` | 沒有一條從「考試卡的頁面讀卡片」一路走到 Rust command 的測試;兩半各有人守 |
| Answers are written immediately(31) | — | **步驟 undefined**(3 條) | 06 phase-2「Answers are written immediately」(`../../features/06-test-card/phase-2.feature:18`;步驟 `../../features/steps/test-card-phase2.steps.ts:98`、`:105`、`:112`) | phase 層的「killed」是程序內丟掉參照(`:105` 的註解寫明),證明的是「submit 回來之前已經寫到磁碟」。真的把側車或 app 行程殺掉,沒有自動測試 |
| The window and the terminal see the same state(36) | — | **步驟 undefined**(4 條) | 06 phase-2「The interface and the terminal agree」(`../../features/06-test-card/phase-2.feature:23`;步驟 `../../features/steps/test-card-phase2.steps.ts:122`、`:131`、`:136`) | 「視窗」同上,是程序內的 handler |
| Window position survives a restart(43) | `@manual` | **這次做了,過**(第 4 節) | 10 phase-1 同名的 `@manual`(T16 `@manual` 證據 `T16-manual-2026-10-16.md`,當時沒有視窗管理員) | — |
| Windows stay on top under X11(49) | `@manual` | **這次做了,過**(第 4 節) | `_NET_WM_STATE_ABOVE` 在 T16 量過;偵測 X11 / Wayland 是 10 phase-1 的自動場景「Detecting the session type」與 `session.rs` 的單元測試 | — |
| Wayland is detected and explained rather than hacked(55) | `@manual` | **這次做了,不過**(第 4、5 節) | 偵測:同上。「不設置頂」:`../../apps/desktop/src-tauri/src/main.rs:21` 的 `apply_session_behaviour`,Wayland 分支沒有呼叫 `set_always_on_top` | 提示不會出現:真前端沒有 `__lcShowWaylandNote` → T34 (B) | (2026-10-21 重做:過;O1 開 T35)
| The terminal review loop still works as in I2(61) | `@regression` | **步驟 undefined**(背景第 1 條、Then 那條) | `../integration/i2-review-loop-headless.feature` 全部的自動場景(`@i2 and not @manual` 93 / 93 綠,其中 i2 headless 14 條) | 只缺一條把「as in I2」接到 i2 那幾條的步驟 |

背景的三條:「Given the desktop application is built for Linux」沒有定義;另兩條有(`../../features/steps/common.steps.ts:27`、`../../features/steps/scheduler.steps.ts:550`)。

## 2. 跑了什麼

| 指令(都在這個簽出;cucumber 一律 `--tags`) | 結果 |
|---|---|
| `cucumber-js --tags '@i3' --dry-run`(輕量,先看) | 190 場景:5 undefined、185 skipped;858 步:17 undefined。undefined 的就是第 1 節那五條 |
| `cucumber-js --tags '@i3 and not @manual'`(重活) | 190 場景:**185 passed、5 undefined**;858 步:828 passed、17 undefined、13 skipped;1 分 45 秒;exit 1(因為 undefined)。另外 185 條來自 01 phase-4(13)、06 phase-2(9)、06 phase-3(4)、10 phase-2(145)、11 phase-2(13)、standalone 回歸(1) |
| `cucumber-js --tags '@i2 and not @manual'`(重活,回歸那條) | **93 / 93 passed**,464 步;35 秒 |

lc-fs 的 probe 路徑寫死在簽出的 `apps/desktop/src-tauri/target/debug/`。為了不冷編,跑之前把這個簽出的 `target/debug` 做成指到前端熱快取的符號連結。
cucumber 開頭照舊重編 lc-fs(`Compiling learning-cards-desktop` 那一行的路徑是這個簽出)。收工時連結拿掉,cucumber 自己建的 `target/`(syscall shim、tmp)也刪了,簽出 porcelain 空。

## 3. roadmap 的「整合工作」

| 項目(roadmap I3 段落原文) | 做了沒 | commit |
|---|---|---|
| 06 丟掉 stub 改用 core | **做了**。`apps/test-card/src/stubs/` 整個刪掉,考試卡改吃複習側車;靜態檢查 `../../apps/test-card/src/no-stubs-static.test.ts` 守著(沒有 stubs/、不 import StubScheduler / StubGrader / MemoryFs) | `54a75e9`(feat T24),合併 `341b663` |
| `MemoryFs` 換成 Tauri 的 `LearningFs` | **做了,形狀照 ADR-075 改過**。排程與批改不在 webview 算,跑在 Node 側車(`scripts/review-sidecar.ts`,跟 CLI 同一份 core);webview 的 `LearningFs` 只剩 `read`,用來讀 reteach 的卡。Tauri 裡用 `createLearningFs()`,單獨執行時 `read` 一律丟錯(`../../apps/test-card/src/main.ts`) | 同上;側車底層 T22 合併 `9773f49`,ADR-075 |

roadmap 寫的是 ADR-075 之前的想法(「webview import core + LearningFs」)。這份盤點同一批把 roadmap 的 I3 段落改成實際狀態。

## 4. 人眼那幾條

### 分類

| 場景 | 類別 | 誰做 |
|---|---|---|
| A person completes a review session in the window | **要真資料**:真的 learning/ 上要有到期的卡。卡要先被教學卡標成學過(I4) | 併到 I4,和 I2 的人工確認一起問使用者(ADR-073) |
| Window position survives a restart | 暫存根 + fixture 就能做 | 前端這次做了,顧問判 |
| Windows stay on top under X11 | 暫存根 + fixture 就能做(要有真的視窗管理員) | 前端這次做了,顧問判 |
| Wayland is detected and explained rather than hacked | 暫存根 + fixture 就能做(要有 Wayland 合成器) | 前端這次做了(不過),T34 之後重做 |(2026-10-21 重做:過,O1 開補丁票 T35)

### 怎麼做的

- 全部在隔離的顯示裡,**沒有碰使用者的桌面 `:1`**,也沒有對 `:1` 送任何輸入。
- 視窗管理員與 Wayland 合成器都用這台機器上的 GNOME Shell 46(跟使用者桌面同一個)。都用 `dbus-run-session` 起私人的 session bus,`HOME` 與 `XDG_*` 全指暫存目錄,不加 `--replace`。
  - X11:`Xvfb :97 -screen 0 1000x700x24 -nolisten tcp -noreset -fbdir <暫存>`,上面跑 `gnome-shell --x11 --sm-disable` 當視窗管理員。
  - Wayland:`gnome-shell --headless --wayland --no-x11 --virtual-monitor 1000x700 --wayland-display <暫存名>`,`XDG_RUNTIME_DIR` 是暫存目錄。
- 指標與按鍵用一支幾行 C 的 XTest 小工具,**只准 `:97` / `:98`**,對 `:1` 直接拒絕(實測 exit 3)。
  拖曳是按下自畫標題列 → 視窗管理員接手移動;縮放是按右下角的縮放把手。
- app 是這個簽出的 `tauri build --debug --no-bundle`(熱快取,1.05 秒)。暫存根 + `vault.ts init` + fixture,假 router。簽出的 `.env` 只放假值,做完刪掉。
- 關窗:X11 送 `WM_DELETE_WINDOW`;Wayland 用檢查器 `click()` 自畫的關閉鈕。所有行程照 PID / 行程群組關,收工再列一次:我起的行程一個都沒剩。

### 視窗位置重開保留:過

| | 教學卡 (x, y, 寬 × 高) | 考試卡 |
|---|---|---|
| 第一次開 | (100, 100, 360 × 480) | (520, 100, 360 × 480) |
| 拖標題列、拖右下角之後 | (220, 160, 420 × 520) | (440, 190, 400 × 510) |
| 關掉時存下的 window-state | 220, 160, 420 × 520,`decorated: false` | 440, 190, 400 × 510 |
| 再開 | **(220, 160, 420 × 520)** | **(440, 190, 400 × 510)** |

兩次關窗 app 都是 exit 0。兩次開窗、兩個頁面的 console 都是 0 則。

### X11 置頂:過

- 第二次開著時,先開一個一般視窗 xclock(對照組),再開一個蓋滿畫面的 xlogo,然後 XTest 點 xlogo 上兩張卡都沒蓋到的一點 (12, 680)。
- 點完之後:
  - `_NET_ACTIVE_WINDOW` 是 xlogo(點擊有效,xlogo 拿到焦點)。
  - `_NET_CLIENT_LIST_STACKING` 由下到上:xclock → xlogo → 考試卡 → 教學卡。對照組 xclock 被 xlogo 蓋掉,兩張卡還在 xlogo 上面。
  - 兩張卡的 `_NET_WM_STATE` 都有 `_NET_WM_STATE_ABOVE`;xlogo 是 `_NET_WM_STATE_FOCUSED`;xclock 沒有任何狀態。
- 截圖(framebuffer):兩張卡都在 xlogo 上面,字看得清楚。面板本來就是半透明的(`--hud-panel`),所以 xlogo 的圖樣淡淡透過來(見 O3)。

### Wayland 偵測與說明:不過

- app 的環境沒有 `DISPLAY`,合成器沒有 Xwayland(`--no-x11`),兩個視窗照樣開起來、頁面載入完,所以 GTK 走的是 Wayland。
- Rust 依 `XDG_SESSION_TYPE=wayland` 判成 Wayland,走 `apply_session_behaviour` 的 Wayland 分支:不呼叫 `set_always_on_top`(這一半符合場景)。
- 兩個頁面(考試卡、教學卡)用檢查器看:`typeof window.__lcShowWaylandNote` 都是 `"undefined"`,沒有 `#wayland-note`,頁面字裡沒有「Wayland」。**提示沒有出現**(這一半不符合)。
- 原因(讀程式):
  - 提示的函式只寫在 placeholder 頁面用的 `../../apps/desktop/src-tauri/placeholder/wayland-note.js`。10 phase-2「The real front ends are loaded」換成真前端之後,兩張卡的頁面都沒有載入它(建出來的 `apps/desktop/dist/` 裡 0 處)。
  - 而且 Rust 在 `builder.build()` 之後馬上 `eval`(`../../apps/desktop/src-tauri/src/main.rs:166`),沒有等頁面載入完。就算頁面有那個函式,也可能叫不到。
- console 兩頁都是 0 則。用檢查器按自畫的關閉鈕,app exit 0。

## 5. 缺口:T34

| | 缺口 | 誰做 |
|---|---|---|
| A | i3 的五條自動場景與背景「built for Linux」沒有步驟定義。phase 層的同義場景都綠,但整合點自己的驗收檔一條都沒跑過 | 測試(-e5);產品程式不用改 |
| B | Wayland 的一次性提示在真前端不見了:真前端沒有那個函式,Rust 呼叫的時機也太早 | 開發 worker 改;-e5 寫紅測試;前端做 `@manual`(同這次的無頭 Wayland 量法) |

工單草稿 `docs/tickets/T34-i3-integration-steps-and-wayland-note.md` 另放分支 `pollux0971/t34-ticket`,送顧問審,審過交協調者。
A 要不要用真的側車行程(Rust 起的同一支 `scripts/review-sidecar.ts`,而不是程序內的 handler),是工單裡請顧問判的一點。

## 6. I3 的 tag 與 gate(套 ADR-073,不用新 ADR)

- I3 **不打 tag**。ADR-073 的處理方式:自動場景全綠、人工確認缺前置條件 → 延後並寫進 roadmap,不為了湊 tag 補一條臨時入口。
- 「I3 自動驗收通過」的條件:
  1. T34 合併,`cucumber-js --tags '@i3 and not @manual'` 全綠(沒有 undefined);
  2. 三條 fixture 的 `@manual`(位置、X11 置頂、Wayland)顧問判過。Wayland 那條在 T34 (B) 之後重做。
- **併到 I4、和 I4 一起問使用者的**:`@e2e @manual`「A person completes a review session in the window」(在真的 learning/ 上做,要有到期的卡)。
  延後,不是跳過。I4 通過前補做,結果回頭寫進 I3。
- 這一條同一批寫進 `../01-roadmap.md` 的 I3 段落。

## 7. 繞圈的 gate 寫法

- **改了**(顧問 2026-10-18 裁決,協調者轉達):`../../features/07-teach-card/NEXT.md` phase-2 的「整合:I3 通過」。
  - 改成「桌面複習那個整合點的自動驗收通過」,引用 ADR-073、不帶整合點編號。
  - 13-work-dag 會把它讀成決策 gate(印 HUMAN),不再是等一個不會打的 tag。
  - 同檔「Gate 未滿足時」那句「等 I3」一起改成同一個意思。
- **同型、沒改,列給顧問**。兩條都是 `done` 的 phase,13-work-dag 只檢查 `todo` / `ready`,所以現在不會擋:
  - `../../features/06-test-card/NEXT.md:18`(phase-2):「整合:I2 通過」。06 phase-2 屬 I3,而 I2 的 tag 照 ADR-073 等 I4,字面照讀也是繞圈。
  - `../../features/11-review-cli/NEXT.md:18`(phase-2):同一行寫了 I2 與 I4。11 phase-2 屬 I3,在 I4 前面;工具若讀它,I4 那一條是真的成環。
- 其他 `todo` 的 phase 寫整合點的(06 phase-4、08 phase-2、10 phase-3 → I4;05 phase-3、09 phase-2 → I5;10 phase-4 → I6;10 phase-5 → I7;02 phase-3 → I1)都是等前面的整合點,沒有繞圈。

## 8. 觀察(請顧問判)

- **O1 `@e2e @manual` 的字樣跟畫面不一樣。** 場景寫「the header shows "Today 0 / 5"」,`../00-design.md` §5.5 寫「今日 3 / 10 題,逾期 0」,現在的 header 是「0 / 5」「逾期 0」兩段(T15、T23、T32 定的)。
  I4 做這條時,照字面就對不上。建議改場景的字樣去對齊畫面,不改畫面:T15 的渲染測試讀 header 的第一個數字,前面加字會改到它。這條放在 T34 讓顧問判。
- **O2 GNOME 上第二次開時,考試卡沒拿到焦點,出現系統通知「"LLM Cards — Test" is ready」。** 考試卡帶 `_NET_WM_STATE_DEMANDS_ATTENTION`。
  第一次開時焦點有到考試卡的第一格(截圖裡框是橘的)。這像是 GNOME 的防搶焦點,跟 T21 第 3 輪的啟動焦點有關;只在巢狀 GNOME Shell 看到,真桌面沒試。不擋 I3,記下來。
- **O3 面板半透明。** 有合成器時,後面的視窗淡淡透過來。這是 14-hud-skin 的設計值(`--hud-panel`),不是這次的範圍;置頂那條的字仍然看得清楚。
- **O4 `../../features/10-desktop-shell/NEXT.md:41` 寫「I3 的 `@manual` 由使用者在真桌面試」。** 這次是在巢狀的 GNOME Shell(同版本)裡做的,不是使用者的真桌面。
  要不要再請使用者在真桌面看一次(可以併在 I4 那一輪),請顧問決定。

## 9. 守門、資料前後、花費

- 這一批碰到 `features/`,照 SKILL §4g 第 12 條跑完整的文件與規格守門,全 PASS:
  - 輕量、位子外:`check-doc-links`(99)、`check-next-gates`(14)、`check-adr-numbers`(75)、`lint:docs`、`check-gherkin-dup`(666)、`check-step-dup`(2678)、`check-standalone`(15)、`accept:dry`(exit 0)、`check:gates`。
  - 重活、位子裡:`check-phase-status`(45)、`check-phase-coverage`(45)。
- 真的 learning/,唯一量法(從我自己的簽出跑、只讀):

| | 時間 | 檔案數 | 整體雜湊 | 帳本行數 |
|---|---|---|---|---|
| 開工 | 06:07:30 | 64 | `c2e4dd6d71de3976` | 108 |
| 收工 | 06:20:08 | 64 | `c2e4dd6d71de3976` | 108 |

  使用者層的指標檔雜湊前後都是 `4449f64303778e3b`;app 的 window-state 目錄前後都不存在(app 的 `XDG_CONFIG_HOME` 指暫存根)。
- 花費:LLM US$0(假 router)。CPU:位子 13 分鐘(cucumber 兩次共 2 分 25 秒、兩個重守門 6 分 20 秒、建置 1 秒、開 app 三輪約 1 分鐘)。
