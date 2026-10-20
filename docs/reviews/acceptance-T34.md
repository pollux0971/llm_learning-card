# T34 驗收證據(B:Wayland 一次性提示接到真前端)

- 被驗分支:t34-opencode,tip 95b0aef(起點 3511a5a = main d397537 + 紅測試 20e3ac5;worker commit e3e5583 實作、95b0aef 報告)
- 驗收開跑與跑完的 tree sha:2eb82ca13346ef6a39dbaf416e78d38d3db3e2eb(前後相同,改壞後都還原,git status 乾淨)
- 日期:2026-10-20;host 8 核,開跑時 load 約 11.7(同時有別的 session 在跑),跑到一半最高 17,結束約 2.6。
- .env:不存在(ls 失敗)。
- 只驗 B 與不退步;A(整合層步驟定義)是 -e5 的測試,基準有跑(下面 @i3)。

## 測試作者
起點到 tip 恰好 4 檔:main.rs、wayland_note.js(新)、window_mode.rs、docs/reviews/T34-report.md。測試、步驟定義、.feature、fixtures 都是 0 變動;兩個 commit 作者都是 worker。起點之前 -e5 的 commit 20e3ac5 加了測試與支援檔。
-e5 改既有檔:i2-review-loop 步驟(加一條 I3 回歸步驟與一行分派)、test-card-phase2 步驟(兩處 I3 分派)、render-test-support 與 card-render-test-support(openCard 多兩個選用參數)、card-design-values-test-support(加常數)。逐行看過:全是新增或新的選用參數,沒有刪斷言、沒有放寬。

## 實作檢查
- wayland_note.js 靜態:沒有 style 屬性、innerHTML、style 標籤、色碼字面值(grep 0 命中);樣式只走 CSSOM 的 setProperty,顏色只有 var(--hud-text)、var(--hud-solid)、var(--hud-line)、var(--hud-font-body),四個都在 hud.css 裡定義。
- main.rs:不再 eval 提示函式(grep 0 命中);置頂改由 session_actions 的結果決定,X11 才置頂與重新置頂。提示由 window_mode 的 with_wayland_note 接在 init script 後面(頁面載入前注入,提示程式自己等 DOMContentLoaded)。
- placeholder 的 wayland-note.js 沒動。

## 基準(都在驗收簽出;先複製 target,lc-fs 已編)
- cargo test 全 crate(CARGO_BUILD_JOBS=2):249 passed、0 failed。
- vitest(apps/desktop、packages/ui-shared/src/hud、apps/test-card、apps/teach-card;VITEST_MAX_WORKERS=1):47 檔、858 passed。
- cucumber '@integration and @i3 and not @manual':6 場景、33 步全過。
- cucumber '@i2 and not @manual':第一次 93 場景有 1 個失敗——「The session can be interrupted and resumed」的第一步 Given 逾時(5000 毫秒的預設步驟逾時,當時 load 約 17)。該場景單跑 3 次都過,每次約 5.3 秒、那一步本身約 4.7 秒,離上限很近。整組重跑 93/93 全過。判讀:負載造成的逾時,這一步是舊步驟(T34 沒改它),不是 T34 退步。給顧問:這一步的逾時邊際太薄,建議之後在步驟上設較長的逾時(測試 agent 的事,不擋 T34)。
- cucumber '@desktop-shell and not @manual':171 場景,162 passed、9 undefined、0 failed。9 個 undefined 全在 10-desktop-shell 的 phase-3、phase-4、phase-5 的場景,沒有步驟定義;這些 .feature 與步驟檔 T34 都沒動。
- tsc 0、boundaries PASS(338)、doc-links PASS(124)。

## 變異測試
### cargo-mutants(window_mode.rs,走專案的 run-mutants 入口)
入口 apps/desktop/src-tauri/run-mutants.mjs(MUTANTS_JOBS=2、CARGO_BUILD_JOBS=2、TMPDIR 指到簽出的 dist/mutants-tmp)。為了只跑這個檔,我在驗收簽出暫時把 mutants.toml 的 examine_globs 縮成 src/window_mode.rs,跑完還原,沒進 git。
結果:53 個變異,17 分鐘;43 caught、3 missed、7 unviable。
- 本張新增的兩個函式:with_wayland_note 的 3 個變異(整個換成空字串、換成固定字串、拿掉 ! )全 caught。session_actions 只產生 1 個變異(整個換成預設值),編不過(unviable);cargo-mutants 不會改裡面的布林字面值,所以下面用手動改壞補。
- 3 個存活都不是 T34 的程式:StartupFocus 的 on_ready(行 179)、on_backstop(行 207)、show_first(行 218)各一個「|| 換成 &&」,是 T21 的舊程式,T34 沒碰;不是新退步。
- 對舊地板(window_mode.rs 本來就在 examine 範圍內)沒有新的存活。

### Rust 手動改壞 window_mode.rs(cargo test 的 wayland_note 與 window_mode 兩個測試檔)
| 改壞 | 結果 |
|---|---|
| X11 不置頂 | 2 紅 |
| Wayland 置頂 | 2 紅 |
| X11 帶提示 | 3 紅 |
| Wayland 不帶提示 | 4 紅以上 |
| 提示接在 window_mode 前面 | 2 紅 |
| 完全丟掉 window_mode 的部分 | 2 紅 |
| 接的時候不加換行 | 存活,等價:window_mode.js 本來就以換行結尾 |
| 提示程式接兩次 | 存活(低):斷言是 starts_with 與 ends_with,多接一份看不出來;頁面上有 id 防重複,不會畫兩個 |

### wayland_note.js 改壞(Chrome 渲染測試與靜態測試,共 37 條)
20 個改壞:13 紅、7 存活。
紅:鍵名改掉(4)、已按掉判斷反過來(14)、字樣改掉(13)、按鈕字樣改掉(11)、按了不存 localStorage(2)、按了不移除(2)、不等頁面載入(12)、顏色寫死字面值(文字與背景各 3)、按鈕拿掉 data-hud(2)、innerHTML(1)、style 屬性(5)、已按掉還顯示(4)。
存活逐條:
- 拿掉第一次擺位 place、或拿掉 MutationObserver:各自單獨是等價——兩條路徑任一條都會把提示擺好。
- pointer-events 改 auto:單獨存活,因為擺位已經避開按鈕,沒有東西可蓋。
- 覆蓋判斷邊界(>= 改 >):低,邊界剛好壓在中心點的情況。
- 重複顯示防護(id 檢查)拿掉:等價,show 只呼叫一次。
- localStorage 讀取丟錯時回「已按掉」:低,測試環境讀得到 localStorage。
- z-index 改 -1:低,視覺層級,留給 B4 的 @manual。
- 補查「提示蓋住送出」這條 must_catch 的靈敏度(最初幾個改壞剛好差 1 px 沒蓋到,所以先存活;量到 test-card 的「送出」中心 y 約 305.9,提示上緣 306.9):把提示放高到蓋住「送出」(bottom 140px)、拿掉兩條擺位路徑、pointer-events 改 auto:測試紅,訊息「送出正中心那一點被別的東西蓋住(提示蓋住了按鈕)」;只保留擺位:綠(擺位把它挪開,符合預期)。
- 已知盲點(給顧問):提示維持 pointer-events: none 時,即使畫面上蓋住按鈕,elementFromPoint 也會穿過去,點得到的量法看不出視覺上的覆蓋;靠擺位程式與 B4 的 @manual 看畫面。

## 其他
- tsc 0;boundaries PASS(338);doc-links PASS(124)。
- 沒有 live、沒有碰真的 learning/。

## 資料前後
learning/:64 個檔、雜湊 c2e4dd6d71de3976、帳本 108 行,前後相同。

## 花費
worker 累計 3.474 美元,預算 3 美元,比值 1.16。未超過 2 倍。

## 結論
通過
