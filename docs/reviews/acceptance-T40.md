# T40 驗收證據(兩個視窗共用側車:id 由 Rust 編、busy 重試只在共用 client、錯誤只給固定字樣)

驗收:驗收 agent。日期 2026-10-22。工單:`../tickets/T40-shared-sidecar-ids-busy-errors.md`。
被驗:主 repo 分支 t40-impl,sha ef6d318eaa57433b8665027bc58e75b952b33a3c。基底 t40-start 9e0f838(main c9ba0b5 加紅測試 31a5b75)。
tree sha(開跑與跑完相同):6b229894a02d3de0cef384a51cecfa95fd8e386e。驗收 worktree 沒有 .env(`ls .env` 回 No such file)。
本證據在分支 t40-accept-tests(不合併、不 push,交協調者)。

## 結論

**通過,附一組要補的測試缺口(交測試 agent,不擋合併由顧問裁)。**
- 工單列的自動驗收全綠(Rust、三個 app 的 vitest、cucumber 三組 tag)、整個 crate 的 cargo test 全綠、tsc 與 boundaries 與 doc-links 乾淨。
- 工單 must_catch 15 條,我各用一個手改的改壞(不在紅測試作者的清單上)逐條試,15 條都紅;另自選 19 條,14 紅、5 存活(下面)。
- Stryker 範圍(重試與 reviewErrorText 與選項):148 個變異,120 個被殺(含 2 個逾時),**81.08%,過 80%**;扣掉 5 個等價 = 83.92%。整個檔案 206 個變異 76.70%,其中 58 個在舊的回應驗證 attempt 那一段(不在工單範圍)。
- cargo-mutants(call_locked):2 個變異,2 個 caught,0 存活。
- 17 個真缺口(紅測試沒釘到)列在 `acceptance-T40-survivors.md`,最重要的是:預設時鐘與預設 sleep 從沒被測試走過(換成 undefined 全綠)、放棄那一刻的精確邊界(多送一次或多睡一次全綠)、時鐘起點不是 0 時的等候通知。
- learning/ 前後相同。

## 測試作者檢查

t40-start..t40-impl 的 diff 沒有任何受保護測試檔(`*.test.ts`、`features/steps/**`、`apps/desktop/src-tauri/tests/**`、vectors)。動到的 8 個檔:review_sidecar.rs、review-client.ts、teach-card 的 App.svelte 與 teach-session.ts、test-card 的 App.svelte、session.ts、types.ts、報告。測試只來自 t40-red(31a5b75 與 4743a44,測試 agent)。Rust 實作檔裡沒有 mod tests。

## 重編

cargo 的產物從主簽出複製 target 後在驗收 worktree 重編。lc-fs 修改時間 2026-10-22 20:14:24(重編後)。cucumber 的 BeforeAll 又跑了一次重編(0.15 秒,沒有東西要編)。

## 基準(未突變)

| 項目 | 指令(原文) | 結果 |
|---|---|---|
| Rust 工單指令 | `CARGO_BUILD_JOBS=2 cargo test --test review_sidecar --test review_sidecar_acceptance`(src-tauri) | review_sidecar 41 過、acceptance 4 過 |
| Rust 整個 crate | `CARGO_BUILD_JOBS=2 cargo test`(src-tauri) | 全部 test result ok,0 失敗(lib 4、asset_protocol 19、atomic_write 14、commands 24、event_log 14、learning_fs 28、learning_root 10、logging 4、path_guard 11、review_sidecar 41、acceptance 4、stderr 22、start_screen 16、wayland_note 9、window_mode 38) |
| tsc | `npx tsc --noEmit -p .` | 0 輸出(乾淨) |
| boundaries | `npm run boundaries` | gate=boundaries result=PASS scanned=354 |
| doc-links | `npx tsx scripts/check-doc-links.ts --root <worktree>` | PASS scanned=127 |
| 桌面殼 | `VITEST_MAX_WORKERS=1 npx vitest run apps/desktop/src/` | 19 檔 279 過 |
| 教學卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/` | 8 檔 70 過 |
| 考試卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/test-card/` | 6 檔 320 過 |
| cucumber | `node --import tsx node_modules/@cucumber/cucumber/bin/cucumber.js --tags '<tag>' --format summary` | `@teach-card and @phase-2 and not @manual`:5 場景 25 步全過;`@i2 and not @manual`:93 場景 464 步全過;`@i3 and not @manual`:190 場景 858 步全過 |

額外(不在工單):`@teach-card and not @manual` 與 `@test-card and not @manual` 各有 9 與 6 個 undefined 場景,都是教學卡 phase-3(還沒做的功能),不是 T40 造成。沒跑完整 check:test-ledger(工單沒列;只動 apps/ 與 Rust 一個檔,上面三個 app 的完整套件已跑)。

## must_catch(15 條,手改一個實作點,只改實作)

做法:改驗收 worktree 的實作一處、跑對應套件、`git checkout -- <檔>` 還原。腳本與完整輸出在驗收者暫存區;下面是紅的第一條失敗訊息。還原後 `git status` 乾淨。

| # | must_catch | 我的改壞(不在紅測試清單) | 結果 |
|---|---|---|---|
| 1 | 拿掉換號、兩個 client 交錯 | R1:線上 id 直接用 webview id | 紅:`a_client_that_starts_counting_from_one_again_after_larger_ids_still_succeeds` 等 4 條 FAILED |
| 2 | 拿掉換號也拿掉舊規則,received.log 重複 | R1(同一改法,實作已沒有舊規則) | 紅:`the_request_is_written_as_request_line_says_and_the_response_comes_back_untouched` FAILED |
| 3 | 回應 id 沒換回 | R2:回應 id 寫線上 id | 紅:`a_business_error_response_also_gets_the_webview_id_back` 等 4 條;`the_response_id_is_the_one_the_webview_sent_larger_and_smaller_than_the_wire_id` 另被 R5 殺 |
| 4 | 從 1 重新數仍成功 | R1、R2、R5 都紅 | 紅:`a_client_that_starts_counting_from_one_again_after_larger_ids_still_succeeds` FAILED |
| 5 | 計數器重起後歸 1 | R4:spawn 後 next_wire_id 設回 1 | 紅:`the_wire_id_does_not_reset_when_the_sidecar_exited` 與 `..._restarted_after_a_timeout` FAILED(`test result: FAILED. 39 passed; 2 failed`) |
| 6 | 信封不再要求 id ≥ 1 | R8:`id < 1` 換成 `id < 0` | 紅:4 條(`the_envelope_check_still_requires_a_positive_integer_id_and_refuses_before_anything_starts` 等) |
| 7 | 舊回應改比 webview id | R3:比對 Some(webview_id) | 紅:`a_stale_response_is_matched_on_the_wire_id_even_when_it_carries_the_webview_id` 等 4 條 |
| 8 | 考試卡收 busy 顯示「複習程式停了」 | X6:client 不重試 busy,跑考試卡套件 | 紅:`start 先 busy 兩次再成功...` AssertionError: expected 'error' to be 'question' |
| 9a | 重試間隔不是 300 ms | C1:250 | 紅:expected [ 250, 250 ] to deeply equal [ 300, 300 ] |
| 9b | 等候字樣不是剛好超過 1 秒 | C2:`>` 換 `>=` | 紅:剛好滿 1 秒還不通知(expected 1000 to be 1500) |
| 9c | 放棄不是 180 秒 | C3:179000 | 紅:常數與「跟 Rust REQUEST_TIMEOUT 一樣」兩條(expected 179000 to be 180000) |
| 10 | 教學卡留著自己的重試迴圈 | X7:client 不重試 busy(教學卡套件);S1:teach-session 多一個 sleep | 紅:expected [ 'teach.next' ] to deeply equal [ 'teach.next', 'teach.next' ];靜態:expected ... not to match /\bsleep\b/ |
| 11 | 放棄後顯示「複習程式停了」或只給重新開始 | X5:拿掉考試卡 unsent timeout 的專用分支 | 紅:expected '複習程式停了。' to contain '等候回覆的時間過了。' |
| 12 | 教學卡出錯畫面出現英文 kind | T1:錯誤畫面改顯示 err.message | 紅(教學卡套件) |
| 13 | 沒有 message 的 Rust 拒絕,message 是 kind | C8 | 紅:expected 'bad-envelope' to be '請求的信封不合規定。' |
| 14 | 類別列字樣順序 | T3:「(目前)」放最前面 | 紅(教學卡套件) |
| 15 | 標示列顯示 id | T4:categoryNameOf 回 id | 紅(教學卡套件) |

對「不認得的 kind 顯示 internal 那一句」:C7(fallback 換成 kind)紅:expected 'brand-new-kind' to be '內部發生問題,請稍後再試。'。

## 自選改壞(19 條,只改實作;另有 17 條用在上面 must_catch 表)

紅(14):R5 計數器不加(4 條紅)、R6 計數器從 0 起(多條紅)、R7 整行拿掉計數器遞增(紅;**不是**「寫成功才加」,是整行不見)、C6 busy 之外 timeout 也重試(紅:600 次 invoke)、C9 webview id 不遞增(紅)、C10 重試之間不睡(紅)、C11 放棄的 unsent 改 false(紅)、C12 成功後不通知「不等了」(紅)、C13 reviewErrorText 對非 ReviewError 回空字串(紅)、C14 取消訂閱不動作(紅)、T5 「學完了」條件改壞(紅)、X1 考試卡所有 timeout 都走再試一次(紅:Rust 自己的 timeout 要照舊)、X3 等候字樣永遠顯示(紅)、X4 unsent 永遠 false(紅)。

存活(5),逐一說明:
- C4 / C5:放棄檢查的 `>=` 換成 `>`(兩個位置)。剛好 180000 ms 時多送一次或多睡一次,測試沒釘到那一刻的次數。**真缺口**(清單 G1)。
- C15:拿掉 attempt 丟出的 ReviewError 那一支的 endWait。外層 catch 也有 endWait,**等價**。
- C16:側車 ok:false 沒有 message 時 message 用 kind 還是空字串。這一行是舊的回應驗證(不在工單範圍),**低**。
- T2:教學卡 onWait 結束時 `controlsDisabled = isWaiting || inFlight` 改成只看 isWaiting。等候一結束、請求還在進行(讀卡片檔那段)按鈕就會被放開,可以重複按。**真缺口**(清單 G2)。

## 變異測試

**Stryker(只走 npm run mutate)。** 指令原文:`VITEST_MAX_WORKERS=1 npm run mutate -- stryker.t40-client.json`(設定檔在本分支):範圍 apps/desktop/src/webview/review-client.ts 第 9–183 行;測試 review-client.test.ts、review-client-busy.test.ts、review-client-teach.test.ts;`--bail=1`、concurrency 2、timeoutMS 120000、coverageAnalysis off、門檻 90/80/0。取鎖:機器範圍的 stryker.lock。4 分 18 秒。報告 `reports/mutation/ef6d318-t40-client.json`(摘要);原始 JSON 在驗收者暫存區。

注意:第一次跑 Stryker 的沙箱沒複製 Rust 原始檔,而 busy-test 會讀 review_sidecar.rs 比對 180 秒,初始測試失敗。設定檔的 ignorePatterns 因此只擋 apps/desktop/src-tauri/target,不擋整個 src-tauri。

| 範圍 | 變異 | 殺 | 存活 | 分數 |
|---|---|---|---|---|
| 整個檔(9–183) | 206 | 158(含逾時 2) | 48 | 76.70% |
| 工單範圍:常數、ReviewError、rejectionKind、messageOfKind、reviewErrorText、rejectionError、選項與 onWait、call(行 9–93 與 121–183) | 148 | 120 | 28 | **81.08%** |
| 同上扣 5 個等價 | 143 | 120 | 23 | 83.92% |
| attempt(行 95–119,舊的回應驗證) | 58 | 38 | 20 | 65.5%(不在工單範圍;列在存活清單) |

工單範圍的 28 個存活歸類:真缺口 17、低 6、等價 5。逐個與補法在 `acceptance-T40-survivors.md`。

**cargo-mutants(call_locked)。** 指令原文:`TMPDIR=<worktree>/dist/mutants-tmp MUTANTS_JOBS=1 CARGO_BUILD_JOBS=2 NODE_OPTIONS=--import=tsx node apps/desktop/src-tauri/run-mutants.mjs`(鎖包裝)。cargo-mutants 預設設定沒有 review_sidecar.rs,所以只在跑的時候把 .cargo/mutants.toml 暫時改成 `examine_globs = ["src/review_sidecar.rs"]` 加 `examine_re = ["call_locked"]`,跑完用 git checkout 還原(不進本分支)。結果:Found 2 mutants;baseline 110s build + 17s test;**2 caught,0 missed,0 unviable**(整個函式換成 Ok(Default::default());回應 id 比對的 `==` 換成 `!=`)。cargo-mutants 在 call_locked 只產生這 2 個,因為它不做函式呼叫參數、加法、let 綁定的變異;這些改我用手改的 R1–R8 補了。

## 觀察(不擋)

1. call_locked 在信封檢查通過後,把 id 換成線上 id 再檢查一次長度(request_line 含 MAX_LINE_BYTES 檢查)。webview 送的行剛好等於上限、線上 id 位數比 webview id 多時,第二次檢查會回 bad-envelope(此時側車已起來、線上 id 沒用掉)。純程式碼推論,我沒有寫測試重現;實際需要請求剛好在上限邊緣,可能性極小。
2. 工單「待顧問審」第 2 點與實作一致:考試卡 unsent 的 timeout 按「再試一次」是重新 start。
3. 整個 crate 的 cargo test 工單沒列,實作報告寫在待協調;我補跑了(全綠)。
4. grok 對抗式審核:這次沒開(協調者沒要求)。

## 資料前後(只記數字)

| 項目 | 前 | 後 |
|---|---|---|
| learning/ 檔案數 | 64 | 64 |
| 整體雜湊(唯一量法,前 16 碼) | c2e4dd6d71de3976 | c2e4dd6d71de3976 |
| 帳本行數 | 108 | 108 |

## 花費

實作 worker(grok-4.7):$9.12,工單預算 $4,**2.28 倍(超過 2 倍)**;grok 不設上限,只記錄(協調者提供的數字,超在哪一段我不知道)。驗收我這邊的 LLM 呼叫:0。主要 CPU:Stryker 4 分 18 秒、cargo-mutants 4 分、cucumber 三組約 2 分 15 秒、Rust 整個 crate 約 3 分。
