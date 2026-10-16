# 驗收證據:T21 第 3 輪 —— 考試卡一定在教學卡之後顯示(啟動順序),兼改 T16 驗收補測的兩條舊斷言

驗收角色:-ed(測試·驗收)。日期:2026-10-17(Asia/Taipei)。
被驗分支:`t21-opencode` @ `2ea7f2f`(第 3 輪兩個 commit:c04107a 實作、2ea7f2f 報告);起點 40ce781(= main 0ca1c25 + 前端第 3 輪工單 909e19d + -e5 紅測試 0b90647)。第 1、2 輪的證據在 acceptance-T21.md。
驗收簽出 `acceptance-t21r3`(分支 `pollux0971/t21r3-accept-tests`,加這份證據並改我自己的補測檔 window-frameless-acceptance.test.ts)。不合併、不 push、沒改 worker 的任何檔。
觀感(@manual:`:1` 開 10 次 10/10 考試卡拿到焦點)是前端重拍、顧問判,不在這份。

## 0. 結論

**通過,無阻擋項。** worker 第 3 輪只動 main.rs、window_mode.rs 與報告,測試檔變動 0。
我自己的補測檔(T16 驗收時寫的 apps/desktop/src/window-frameless-acceptance.test.ts)有兩條斷言與第 3 輪的新規格相反,已改成新規格的等價斷言,**不是放寬**(第 2 節逐處說明),並附 15 個改壞版本全紅。
cargo-mutants(window_mode.rs):49 個,40 caught、3 missed(全是等價,第 4 節)、6 unviable、0 timeout。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| U-1 | 規格取代舊測試 | 見第 2 節:舊斷言要求退路與載入完成兩處「直接 `.show()`」,第 3 輪(顧問批准的工單與 -e5 的 startupWiringProblems)規定那兩處只准問 `on_ready` 並把動作交給 `run_startup_actions`,`.show()` 與 `.set_focus()` 全檔各只在那一個函式出現一次 | 已改,新斷言更嚴(多釘三件事),15 個改壞全紅 |
| U-2 | 成本 | worker 三輪累計 cost $7.622,工單預算 $2 = 3.8×(>2×,只記錄;第 3 輪單輪費用協調者沒有給,不知道);session ses_ebb722f53ffeOWL0tYSKfxAB2I,xai/grok-4.7 | 標出 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 detached @ 2ea7f2f(node_modules、src-tauri/target 從別的驗收簽出複製,用完刪),沒有 `.env`。開跑 tree sha `da43d0c39e9e961351cdbef86d53b67fc90228b9`。
- **測試作者檢查**:第 3 輪兩個 worker commit 的測試檔(`*.test.*`、`tests/`、`test-support`、`features/steps/**`、`.feature`、fixtures)變動 **0**;動的檔只有 main.rs、window_mode.rs、報告 docs/reviews/T21-round3-2026-10-16.md。
- `git log --name-only 40ce781..2ea7f2f | grep -c mutants.out` = 0;與最新 main(bb82d60)的 `git merge-tree`:無衝突。

## 2. 我的補測檔兩處斷言的改寫(逐處:為什麼是新規格取代舊規格)

背景:T16 驗收時我發現原測試只在整個 main.rs 找字串、拿掉「真正啟動 3 秒計時的呼叫」仍全綠,所以寫了 window-frameless-acceptance.test.ts,把 main.rs 去註解後取出函式本體與 on_page_load 閉包,各自斷言順序。第 3 輪改了啟動順序的設計,那兩條斷言與新設計相反(協調者回報 vitest 189 綠 / 2 紅,紅的就是這兩條),不可能同時綠:

| 舊斷言(T16 驗收) | 為什麼不能留 | 新斷言(第 3 輪規格的等價) |
|---|---|---|
| `arm_show_fallback` 本體:spawn → sleep(SHOW_FALLBACK) → on_timeout → warn → `.show()`,且 on_timeout 的 if 區塊裡要有 warn 與 `.show()` | 第 3 輪規定顯不顯示由 `StartupFocus::on_ready` 回的動作決定(考試卡要等教學卡),退路自己 `.show()` 會讓考試卡可能先於教學卡出現——正是第 3 輪要修的事 | 同樣釘「spawn → sleep(SHOW_FALLBACK) → on_timeout → **回 true 才** warn」,把 `.show()` 換成 **on_ready → run_startup_actions**(且 warn < on_ready < run_startup_actions),另新增「本體不准有 `.show()` / `.set_focus()`」 |
| `on_page_load` 閉包:只在 Finished,`if on_page_finished()` 的區塊裡有 `.show()`,不寫 warn、不計時 | 同上:載入完成那條也不准自己顯示 | 同樣釘「只在 Finished、`if on_page_finished()` 回 true 才動作、不寫 warn、不計時」,動作換成 **on_ready 且之後 run_startup_actions**,另新增「閉包不准有 `.show()`」 |

新增(新規格才有的,所以也是更嚴):
- 全檔 `.show()` 剛好 1 處、`.set_focus()` 剛好 1 處,而且都在 `run_startup_actions` 裡;
- `arm_order_backstop`:spawn → sleep(ORDER_BACKSTOP) → on_backstop → `if !actions.is_empty()` 才 warn 再 run_startup_actions;自己不 show;`open_windows` 真的呼叫它(第 3 輪新增的順序退路,沒有呼叫就是教學卡不出現時考試卡永遠不顯示)。
保留不動的:第一條「open_windows 真的呼叫 arm_show_fallback 且在 `.build()` 之後」(T16 驗收就綠、第 3 輪仍成立)。

**改壞版本(對第 3 輪實作,測試只跑這個檔):15 個,全紅。** S1 退路直接 `.show()`、S2 載入完成直接 `.show()`(舊規格的寫法,新斷言要紅,紅)、S3 退路不問 on_ready、S4 問了但不交給 run_startup_actions、S5 載入完成不問 on_ready、S6 退路不寫 warn、S7 退路不睡、S8 退路不看 on_timeout 結果、S9 全檔多一個 `.show()`、S10 全檔多一個 `.set_focus()`、S11 拿掉 arm_order_backstop 的呼叫、S12 順序退路不睡、S13 順序退路不寫 warn、S14 順序退路不看有沒有動作、S15 載入完成那條自己寫 warn。

## 3. 基準(未突變,第 3 輪實作 + 我改過的補測檔)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries` | PASS(scanned=299) |
| cargo test(整個 desktop crate,CARGO_BUILD_JOBS=2) | 全綠:lib 4、asset_protocol 19、atomic_write 14、commands 24、event_log 14、learning_fs 28、learning_root 10、logging 4、path_guard 11、start_screen 16、window_mode **38** |
| vitest apps/desktop + packages/ui-shared | 33 檔 440 綠(含改過的補測檔 5 條) |
| cucumber `@desktop-shell and @phase-6 and not @manual` | 9/9(34 步) |
| cucumber `@desktop-shell and not @manual` | 171 場景:162 綠、9 undefined(phase-3/4/5,gate 未開) |
| cucumber `@hud-skin and not @manual` | 23/23 |

## 4. cargo-mutants(window_mode.rs,-j 1、CARGO_BUILD_JOBS=2)

`cargo mutants --config <只含 window_mode.rs 的暫存設定> -j 1 --no-shuffle -- --test window_mode`(TMPDIR 在 repo 底下 dist/mutants-tmp,用完已刪;mutants.out 已刪、沒進 git)。
結果:**49 個變異:40 caught、3 missed、6 unviable、0 timeout**。caught / (caught + missed) = 93.0%,高於 .cargo/mutants.toml 的地板(90.6%,只准升)。
3 個存活全是等價(外層呼叫端已經擋住,守衛重複):
- `on_ready` 開頭的 `!opens(label) || is_ready(label)` 換成 `&&`:沒開的標籤落到最後的 `Vec::new()`;已 ready 的標籤再進來,`show_first` / `show_focus` 各自還有 `is_shown` 守衛,回空;
- `on_backstop` 的 `!opens(STARTUP_FOCUS) || is_shown(STARTUP_FOCUS)` 換成 `&&`:`show_focus` 自己有同樣的守衛;
- `show_first` 的 `!opens(SHOW_FIRST) || is_shown(SHOW_FIRST)` 換成 `&&`:唯一的呼叫端 `on_ready` 開頭已確認 `opens(label)`,而且 `is_ready` 守衛讓同一標籤進不來第二次。

## 5. grok

第 1、2 輪已跑過對抗審核(acceptance-T21.md);第 3 輪是同一組檔案的狀態機重寫,協調者與顧問未要求再跑。靠 49 個 Rust 變異、15 個接線改壞版本與基準逐項驗證。沒有另跑 grok。

## 6. learning/ 前後(唯一量法,只讀)

| 時點 | 檔數 | 雜湊前 16 碼 | 帳本行數 |
|---|---|---|---|
| 開跑前(沿用 T26 收尾量值,協調者確認) | 64 | 6335855d9945ca2b | 96 |
| 跑完後 | 64 | 6335855d9945ca2b | 96 |

前後相同;全程只讀。

## 7. 結論

通過(無阻擋項)。我的補測檔兩條舊斷言已被新規格取代並改成等價斷言(更嚴),補測檔建議隨 worker 分支一起進 main。
