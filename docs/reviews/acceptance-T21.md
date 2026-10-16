# 驗收證據:T21 沒有合成器時視窗用實心底、啟動焦點給考試卡

驗收角色:-ed(測試·驗收)。日期:2026-10-16(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`t21-opencode` @ `7ec36c1`(worker 兩個 commit:ad8fd05 實作、7ec36c1 報告);起點 `t21-start` 91daade(= fdb0a75 + -e5 的紅測試)。
驗收用簽出 `acceptance-t21`(分支 `pollux0971/t21-accept-tests`,只加這份證據)。不合併、不 push、沒改 worker 的任何實作檔。
觀感(@manual:20 毫秒取樣黑幀、焦點 5/5)不在這份,前端與顧問判。

## 0. 結論

**通過,沒有阻擋項,也沒有測試缺口。** 工單 must_catch 十三條(含第 2 輪三條焦點)每條都有改壞版本被抓到;29 個改壞版本 26 個紅、3 個存活且都是等價(見第 3 節)。
cargo-mutants(window_mode.rs):16 個變異,14 caught、0 missed、2 unviable。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| H-1 | 備註 | 對照上一張 T16 的教訓(接線檢查只認字串出現):T21 的接線檢查是取出 open_windows 與 builder 鏈再斷言;我專門做了「呼叫被拿掉」「通知漏一邊」「建窗後直接 set_focus」「寫死標籤」「底色在 build 之後才設」「問兩次合成器」等改壞版本,全紅 | 無缺口 |
| H-2 | 備註 | 3 個存活:拿掉 `given` 旗標的兩種寫法與「重複標籤各算一個」。`StartupFocus` 給出 Some 之後 `pending` 已經空了,之後任何 `on_shown` 都因為「標籤不在 pending」回 None,所以 `given` 在目前結構下是多一層保險(等價);`start_screen::windows` 永遠不會給重複標籤 | 等價,不擋 |
| H-3 | 成本 | worker cost $2.64,工單預算 $2 = 1.32×(未超過 2×);opencode session ses_ebb722f53ffeOWL0tYSKfxAB2I,xai/grok-4.7,約 16.5 分鐘(協調者提供) | 記錄 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 detached @ 7ec36c1(node_modules 與 src-tauri/target 從別的驗收簽出複製),沒有 `.env`。開跑 tree sha `6c57081837aef1832e165ea26937b6b72255ee14`。
- **測試作者檢查**:worker 兩個 commit 的測試檔(`*.test.*`、`tests/`、`test-support`、`features/steps/**`、`.feature`、fixtures)變動 **0**;`git diff --name-only t21-start t21-opencode` 只有 main.rs、window_mode.rs、tauri.conf.json、報告。
  window_mode.rs 內 -e5 留的是簽名 stub(`unimplemented!`),worker 把它填成實作;沒有 `mod tests`。
- `git log --name-only t21-start..t21-opencode | grep -c mutants.out` = 0。
- 併進最新 main(fdb0a75):`git merge-tree` 無衝突。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries` | PASS(scanned=297) |
| cargo test(整個 desktop crate,CARGO_BUILD_JOBS=2) | 全綠:lib 4、asset_protocol 19、atomic_write 14、commands 24、event_log 14、learning_fs 28、learning_root 10、logging 4、path_guard 11、start_screen 16、window_mode **33** |
| vitest apps/desktop + packages/ui-shared | 33 檔 435 綠 |
| cucumber `@desktop-shell and @phase-6 and not @manual` | 7/7(26 步) |
| cucumber `@desktop-shell and not @manual` | 169 場景:160 綠、9 undefined(phase-3/4/5,gate 未開) |
| cucumber `@hud-skin and not @manual` | 23/23 |
| 重編 | cargo 在驗收簽出增量重編 |

## 3. 改壞版本(29 個:改一處實作 → 跑對應層 → 還原)

層:cargo = tests/window_mode.rs;cfg = apps/desktop 的 window-frameless.test.ts;acc = 驗收補測 window-frameless-acceptance.test.ts(T16 驗收時加的,已在 main);cuc6 = cucumber phase-6。編號 C = 表面/設定/接線,F = 啟動焦點。

| 編號 | 改壞 | 結果 | 失敗訊息(原文,截斷) |
|---|---|---|---|
| C1 | 沒有合成器時 surface_for 回 transparent true | 紅(cargo) | thread 'a_desktop_without_a_compositor_gets_an_opaque_window_in_the_solid_colour' (640112) panicked at tests/window_mode.rs:167:5: |
| C2a | 沒有合成器時沒有底色(None) | 紅(cargo) | thread 'a_desktop_without_a_compositor_gets_an_opaque_window_in_the_solid_colour' (641049) panicked at tests/window_mode.rs:167:5: |
| C2b | 底色 alpha 不是 255 | 紅(cargo) | thread 'the_solid_background_is_fully_opaque' (641998) panicked at tests/window_mode.rs:184:5: |
| C3a | Rust 色值跟 hud.css 不一樣 | 紅(cargo) | thread 'the_solid_background_is_the_hud_solid_of_hud_css' (643142) panicked at tests/window_mode.rs:238:5: |
| C4a | 有合成器時 transparent false | 紅(cargo) | thread 'a_composited_desktop_gets_a_transparent_window_without_a_background' (644358) panicked at tests/window_mode.rs:162:5: thre |
| C4b | 有合成器時也塗底色 | 紅(cargo) | thread 'a_composited_desktop_gets_a_transparent_window_without_a_background' (645558) panicked at tests/window_mode.rs:162:5: thre |
| C5a | builder 寫死 transparent(true) | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > main.rs 的接線:取函式本體再斷言(驗收 3、8) > 卡片視窗接線:desktop_is_composited 一次、surface_for 與 in |
| C5b | builder 寫死 transparent(false) | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > main.rs 的接線:取函式本體再斷言(驗收 3、8) > 卡片視窗接線:desktop_is_composited 一次、surface_for 與 in |
| C5c | builder 沒有 transparent 呼叫 | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > main.rs 的接線:取函式本體再斷言(驗收 3、8) > 卡片視窗接線:desktop_is_composited 一次、surface_for 與 in |
| C5d | 拿到底色不套用 | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > main.rs 的接線:取函式本體再斷言(驗收 3、8) > 卡片視窗接線:desktop_is_composited 一次、surface_for 與 in |
| C6 | 底色在 .build() 之後才設 | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 兩個視窗的設定(驗收 1、場景 1) > setup 視窗(啟動失敗的畫面)不在設定檔裡,仍由 main.rs 動態建立、不改 AssertionError: |
| C7 | 問兩次合成器、surface 拿另一個 mode | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > main.rs 的接線:取函式本體再斷言(驗收 3、8) > 卡片視窗接線:desktop_is_composited 一次、surface_for 與 in |
| C8a | teach 設定檔殘留 transparent true | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 兩個視窗的設定(驗收 1、場景 1) > 設定檔不寫 transparent(T21):透明由程式依合成器決定,teach、test 都沒有這個鍵 Asser |
| C8b | test 設定檔殘留 transparent false | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 兩個視窗的設定(驗收 1、場景 1) > 設定檔不寫 transparent(T21):透明由程式依合成器決定,teach、test 都沒有這個鍵 Asser |
| C9a | setup 視窗被加透明 | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 兩個視窗的設定(驗收 1、場景 1) > setup 視窗(啟動失敗的畫面)不在設定檔裡,仍由 main.rs 動態建立、不改 AssertionError: |
| C9b | setup 視窗被加底色 | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 兩個視窗的設定(驗收 1、場景 1) > setup 視窗(啟動失敗的畫面)不在設定檔裡,仍由 main.rs 動態建立、不改 AssertionError: |
| F1 | 還沒全部顯示就回焦點 | 紅(cargo) | thread 'a_label_that_is_not_in_the_set_is_ignored' (648037) panicked at tests/window_mode.rs:320:5: thread 'each_startup_focus_is_ |
| F2 | 永遠不回焦點 | 紅(cargo) | thread 'a_label_that_is_not_in_the_set_is_ignored' (648831) panicked at tests/window_mode.rs:321:5: thread 'a_single_card_window_s |
| F3 | 焦點回兩次(given 沒設) | **存活**(等價,見下) | |
| F4 | STARTUP_FOCUS 不是 test | 紅(cargo) | thread 'a_label_that_is_not_in_the_set_is_ignored' (651098) panicked at tests/window_mode.rs:321:5: thread 'a_set_that_does_not_co |
| F5 | 3 秒退路那邊忘了通知 | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > main.rs 的接線:取函式本體再斷言(驗收 3、8) > 啟動焦點接線:一個 StartupFocus、兩個顯示的地方都通知、set_focus 只有一處 |
| F6 | 載入完成那邊忘了通知 | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > main.rs 的接線:取函式本體再斷言(驗收 3、8) > 啟動焦點接線:一個 StartupFocus、兩個顯示的地方都通知、set_focus 只有一處 |
| F7 | 建窗後直接 set_focus | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > main.rs 的接線:取函式本體再斷言(驗收 3、8) > 啟動焦點接線:一個 StartupFocus、兩個顯示的地方都通知、set_focus 只有一處 |
| F8 | 對寫死的標籤 set_focus | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > main.rs 的接線:取函式本體再斷言(驗收 3、8) > 啟動焦點接線:一個 StartupFocus、兩個顯示的地方都通知、set_focus 只有一處 |
| F9 | 重複標籤各算一個 | **存活**(等價,見下) | |
| F10 | labels 沒有 test 也追蹤 | 紅(cargo) | thread 'a_set_that_does_not_contain_the_target_never_gives_focus' (653277) panicked at tests/window_mode.rs:327:5: |
| F11 | 焦點目標不是設定檔裡的標籤 | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 兩個視窗的設定(驗收 1、場景 1) > 兩個視窗都沒有系統外框:decorations 明寫 false AssertionError: expected  |
| F12 | 不認識的標籤也算顯示 | 紅(cargo) | thread 'a_label_that_is_not_in_the_set_is_ignored' (654154) panicked at tests/window_mode.rs:320:5: thread 'a_set_that_does_not_co |
| F13 | Some 之後還會再回 | **存活**(等價,見下) | |

分層統計:cargo 抓到 11、cfg 抓到 15、存活 3。
**存活 3 個,都是等價**:
- F3、F13(`given` 旗標不設/不查):Some 之後 `pending` 已空,後續任何標籤都不在 pending,仍回 None。
- F9(`new` 對重複標籤不去重):`start_screen::windows` 只會給 teach、test 各一次;重複標籤不是工單規定的情況。

## 4. cargo-mutants(window_mode.rs,-j 1、CARGO_BUILD_JOBS=2)

`cargo mutants --config <只含 window_mode.rs 的暫存設定> -j 1 --no-shuffle -- --test window_mode`(TMPDIR 在 repo 底下 dist/mutants-tmp,用完已刪;mutants.out 已刪、沒進 git)。
結果:**16 個變異:14 caught、0 missed、0 timeout、2 unviable**(`mode_for` 與 `surface_for` 換成 Default::default() 編不過)。
地板(.cargo/mutants.toml:183/202 = 90.6%,不准降):本批 14/14,合併後 (183+9+14)/(202+9+14) = 91.6%,沒有降。

## 5. grok-4.20 對抗審核

`opencode run -m xai/grok-4.20-0309-reasoning`,從空目錄跑,給工單全文與實作 diff;費用不知道。它的主張全部屬「寫法跟工單字面描述不完全一樣」,沒有指出任何會出錯的輸入;逐條自己驗:

| 主張 | 我的驗證 |
|---|---|
| `*label` 無法被 move closure 捕捉,會編譯錯誤 | **不成立**:cargo 編得過、33 條測試綠 |
| builder 拆成 `let mut builder` + `if let` 不符合「那一條鏈」,靜態檢查量不到 | **不成立**:靜態檢查有量到——C5a–C5d、C6(底色在 build 後才設)、C7 全紅 |
| 把通知抽成 helper `focus_if_both_shown`,使「兩處都通知」的檢查失去針對性 | **不成立**:F5(退路忘了通知)、F6(載入完成忘了通知)、F7(建窗後直接 set_focus)、F8(寫死標籤)全紅 |
| StartupFocus 用 Vec<String> 不夠極簡,邊界沒量到 | **不成立**:工單只規定行為不規定結構;行為表每一列有測試,F1–F13 十一個紅、三個等價 |
| 「單元測試很可能期望更直接的實作」 | 無依據(猜測),不成立 |

## 6. learning/ 前後(唯一量法,只讀)

| 時點 | 檔數 | 雜湊前 16 碼 | 帳本行數 |
|---|---|---|---|
| 開跑前(沿用上一張收尾量值) | 64 | 2ed7039eae558843 | 84 |
| 跑完後 | 64 | 2ed7039eae558843 | 84 |

前後相同;全程只讀。

## 7. 花費

worker cost $2.64(協調者提供)/ 預算 $2 = **1.32×**,未超過 2× 旗標線。grok 無 $ 上限,只記錄;驗收端 grok 費用:不知道。

## 8. 結論

通過(無阻擋項、無測試缺口)。
