# 驗收證據:T16 10-desktop-shell phase-6 無框透明視窗

驗收角色:-ed(測試·驗收)。日期:2026-10-16(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`pollux0971/t16-opencode` @ `fd5b6c7`(worker 五個 commit:9469079 實作、fa133a9 ADR-072、d0a75ea 報告、06301d0 第 2 輪修正、fd5b6c7 報告第 2 輪)。
起點 `t16-start`(6ed8e29,-e5 的紅測試)+ -e5 第二批 `0843854`(合併 commit 5a17184)。
我的補測在 `pollux0971/t16-accept-tests`(基於 fd5b6c7,只加一個測試檔與這份證據)。不合併、不 push、沒改 worker 的任何實作檔。

## 0. 結論

**實作沒有阻擋項。** 工單 must_catch 每一條都有會紅的測試,唯獨一條有測試缺口(下表 A4):
把真正啟動 3 秒逾時計時的呼叫 `arm_show_fallback(&window, gate);` 拿掉,原本的測試全綠,
但那會讓「頁面一直不完成載入時視窗永遠不顯示」。這是**測試端**缺口、不是實作錯誤(實作有呼叫)。
已補 `apps/desktop/src/window-frameless-acceptance.test.ts`(3 條,基底綠;A4 與另外 5 個同類改壞版本全紅),建議隨 worker 分支一起合併。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| G-1 | 測試缺口,已補 | main.rs 的接線檢查只確認標記字串在檔案任何地方出現過;呼叫被拿掉、計時不睡、載入完成不 show()、逾時不看 on_timeout 結果、載入完成路徑寫 warn,6 個改壞版本原測試全部存活 | 補測 3 條,6 個全紅 |
| G-2 | 備註 | hud-skin.steps.ts 共用句子的分派:只在已有視窗打開(openedWindows 有值)時才是斷言,否則照舊設定。phase-6 場景 3 的 When 若沒登記視窗,Then 會空過。實測改壞 window_mode.js 時會紅(A8a),所以目前不是漏洞 | 備註 |
| G-3 | 合併注意 | 對 main dcbd243 的 merge-tree 只有 docs/02-decision-map.md 一處內容衝突(worker 的 ADR-072 與 main 的 ADR-073/074 都加在同一個位置),兩邊都要留 | 協調者合併時處理 |
| G-4 | 成本 | worker 累計約 $17(協調者提供),工單預算 $5 = 約 3.4×,超過 2× 旗標線;grok 無 $ 上限,只記錄 | 標出 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 `acceptance-t16`(detached @ fd5b6c7;node_modules 與 src-tauri/target 從 acceptance-t15 複製),沒有 `.env`。
- 開跑 tree sha:`6d300c93cc3e9fd4b373f3d28549a6ab80b5f698`;補測 commit 之前同一個 tree。
- **測試作者檢查**:worker 的五個 commit 逐一列檔,`*.test.*`、`tests/`、`test-support`、`features/steps/**`、`.feature`、fixtures 的變動共 **0** 個(迴圈檢查輸出為空)。
  `git diff --name-only t16-start fd5b6c7` 裡的測試檔(tests/logging.rs、window-frame.ts、window-frameless.test.ts)全部來自 -e5 的 0843854;
  worker 在 5a17184 之後碰的檔:Cargo.toml、lib.rs、main.rs、docs/02-decision-map.md、報告。
- 實作檔沒有 `mod tests`(window_mode.rs、lib.rs、main.rs 都沒有 cfg(test))。
- `git log --name-only t16-start..fd5b6c7 | grep -c mutants.out` = 0。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries` | PASS(scanned=293) |
| cargo test(src-tauri,CARGO_BUILD_JOBS=2) | 全綠:lib 4、asset_protocol 19、atomic_write 14、commands 24、event_log 14、learning_fs 28、learning_root 10、logging 4、path_guard 11、start_screen 16、window_mode 13 |
| vitest apps/desktop + packages/ui-shared | 32 檔 404 綠(worker 報告的 383 只含 apps/desktop 與 hud 目錄) |
| cucumber `@desktop-shell and @phase-6 and not @manual` | 5/5 |
| cucumber `@desktop-shell and not @manual`(全部 phase) | 167 場景:158 綠、9 undefined(全是 phase-3/4/5,gate 未開) |
| cucumber `@hud-skin and not @manual` | 23/23 |
| cucumber `(@teach-card or @test-card) and not @manual` | 45 場景:16 綠、29 undefined(06/07 的 phase-2 以後,尚未做);phase-1 全綠 |
| 重編 | 驗收簽出 cargo test 重編,lc-fs 與 learning-cards-desktop 產物時間 07:36(在重編之後) |

## 3. -e5 對既有測試的兩處修改:有沒有放寬?(顧問要求判斷)

**判斷:沒有放寬。** 依據(讀 6ed8e29 的 diff 與 window-frame-test-support.ts 的 disabledProblems):

1. `render-test-support.ts` 的 frameLineProblems:改成只量「沒停用」的按鈕。
   - 原本量展示頁上**所有**按鈕;T16 起展示頁在後面多了一顆**停用**的按鈕(故意 opacity 0.45,1 像素黑線量到 0.46 會誤紅)。
   - 啟用按鈕的量法與門檻原封不動(索引、邊緣墨量判定都沒變);原本存在的三顆按鈕都不是停用的,所以對它們的檢查範圍沒有縮小。
   - 停用狀態**有自己的量法**,不是跳過:disabledProblems 對停用的 HudButton 與 HudField 各量四件事——跟同一元素的一般狀態差 ≥ 30 像素(不能長得一樣)、停用時切角外側等於後面背景、外圍與矩形附近橘色點數 ≤ 門檻(停用不能變橘)、停用 + 滑鼠移上去也不變橘。
   - 我用改壞版本驗證它真的會紅:B5a(停用按鈕 hover 變橘)、B5b(停用按鈕 opacity 1 看起來跟一般一樣)、B5d(停用作答欄看起來跟一般一樣)全紅。
   - 沒有量的:停用鈕的 1 像素黑線本身是否存在(只要求「跟一般不同、不變橘、切角不填滿」)。工單驗收 8 的字面就是這三件,所以不算缺口,只記下。
2. `hud-skin.steps.ts` 的 `the page root has the frameless class`:同一句話在 14 phase-1(設定)與 10 phase-6 場景 3(斷言)。
   - 分派條件是「這個場景已有視窗打開」;14 phase-1 的場景沒有開視窗,行為不變(23/23 綠證明)。
   - 斷言本身嚴格:每個打開的視窗都要有 FRAMELESS class,且頁面程式不能丟錯;A8a/A8b/A11d 改壞後紅。
   - 空過風險見 G-2:目前不是漏洞。

## 4. must_catch 與自選突變(45 個,改壞後跑對應測試層,還原後確認回綠)

做法:每個突變只改一處實作(不改測試)→ 跑對應層(cfg = apps/desktop 的 window-frameless.test.ts;cargo = tests/window_mode.rs 或 tests/logging.rs;cuc6 = cucumber phase-6;render = packages/ui-shared 的 window-frame.test.ts)→ 記第一個紅的層與失敗訊息原文 → git checkout 還原。
編號:A = 工單 must_catch(含設定、權限、頁面程式、ShowGate);B = 外觀類(CSS);C = 我自己多做的 8 個。
工單 must_catch 十七條中,最後一條(不退步)由第 2 節基準證明;其餘每條至少有一個突變(下表)。

| 編號 | 改壞 | 結果 | 失敗訊息(原文,截斷) |
|---|---|---|---|
| A1t | test decorations 改 true | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 兩個視窗的設定(驗收 1、場景 1) > 兩個視窗都沒有系統外框:decorations 明寫 false AssertionError: expected [ Array(1) ] to deep |
| A2t | test transparent 改 false | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 兩個視窗的設定(驗收 1、場景 1) > 兩個視窗都透明:transparent 明寫 true AssertionError: expected [ Array(1) ] to deeply eq |
| A3t | test visible 改 true | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 兩個視窗的設定(驗收 1、場景 1) > 兩個視窗都先藏起來:visible 明寫 false,載入完才由 Rust 顯示 AssertionError: expected [ Array(1) ] |
| A4 | 拿掉 3 秒逾時退路(不啟動計時) | **存活** | |
| A4b | SHOW_FALLBACK 改 30 秒 | 紅(cargo) | thread 'the_fallback_waits_three_seconds' (1284040) panicked at tests/window_mode.rs:97:5: |
| A5a | 逾時總是回 true(顯示兩次/載入完仍 warn) | 紅(cargo) | thread 'a_page_that_never_finishes_loading_is_shown_once_when_the_timeout_fires' (1284925) panicked at tests/window_mode.rs:105:5: thread 'a_page_that |
| A5b | 載入完成總是回 true | 紅(cargo) | thread 'a_page_that_finishes_after_the_timeout_is_not_shown_a_second_time' (1285617) panicked at tests/window_mode.rs:119:5: thread 'each_window_has_i |
| A6-start-dragging | 少開 core:window:allow-start-dragging | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 權限剛好六條(驗收 2、場景 2) > permissions 跟那六條集合相等、沒有重複,windows 仍是 teach 與 test AssertionError: expected [ …( |
| A6-start-resize-dragging | 少開 core:window:allow-start-resize-dragging | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 權限剛好六條(驗收 2、場景 2) > permissions 跟那六條集合相等、沒有重複,windows 仍是 teach 與 test AssertionError: expected [ …( |
| A6-minimize | 少開 core:window:allow-minimize | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 權限剛好六條(驗收 2、場景 2) > permissions 跟那六條集合相等、沒有重複,windows 仍是 teach 與 test AssertionError: expected [ …( |
| A6-close | 少開 core:window:allow-close | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 權限剛好六條(驗收 2、場景 2) > permissions 跟那六條集合相等、沒有重複,windows 仍是 teach 與 test AssertionError: expected [ Ar |
| A7a | 多開 allow-set-position | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 權限剛好六條(驗收 2、場景 2) > permissions 跟那六條集合相等、沒有重複,windows 仍是 teach 與 test AssertionError: expected [ …( |
| A7b | 多開 allow-hide | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 權限剛好六條(驗收 2、場景 2) > permissions 跟那六條集合相等、沒有重複,windows 仍是 teach 與 test AssertionError: expected [ …( |
| A7c | 多開 core:window:default | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 權限剛好六條(驗收 2、場景 2) > permissions 跟那六條集合相等、沒有重複,windows 仍是 teach 與 test AssertionError: expected [ …( |
| A8a | 頁面程式不加 hud-frameless | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 頁面那段程式 window_mode.js(驗收 3、場景 3 與 Scenario Outline) > class 名字跟 14 的 layout.ts 一樣(hud-frameless、hud |
| A8b | hud-frame-less 錯字 | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 頁面那段程式 window_mode.js(驗收 3、場景 3 與 Scenario Outline) > class 名字跟 14 的 layout.ts 一樣(hud-frameless、hud |
| A9a | solid 判斷反了(有合成器反而 solid) | 紅(cargo) | thread 'a_composited_desktop_is_frameless_and_not_solid' (1288201) panicked at tests/window_mode.rs:36:5: thread 'a_desktop_without_a_compositor_is_fr |
| A9b | solid 永遠 true | 紅(cargo) | thread 'a_composited_desktop_is_frameless_and_not_solid' (1288967) panicked at tests/window_mode.rs:36:5: |
| A9c | solid 永遠 false | 紅(cargo) | thread 'a_desktop_without_a_compositor_is_frameless_and_solid' (1289706) panicked at tests/window_mode.rs:41:5: |
| A10 | Rust/JS 的 solid class 名字不一致(hud-solidd) | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 頁面那段程式 window_mode.js(驗收 3、場景 3 與 Scenario Outline) > 有合成器:根元素只有 hud-frameless;沒有合成器:hud-frameless  |
| A11a | 頁面程式用 innerHTML | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 頁面那段程式 window_mode.js(驗收 3、場景 3 與 Scenario Outline) > 有合成器:根元素只有 hud-frameless;沒有合成器:hud-frameless  |
| A11b | 頁面程式設 style 屬性 | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 頁面那段程式 window_mode.js(驗收 3、場景 3 與 Scenario Outline) > 有合成器:根元素只有 hud-frameless;沒有合成器:hud-frameless  |
| A11c | 頁面程式插 <style> | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 頁面那段程式 window_mode.js(驗收 3、場景 3 與 Scenario Outline) > 有合成器:根元素只有 hud-frameless;沒有合成器:hud-frameless  |
| A11d | 改成等 invoke 回來才加 class | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 頁面那段程式 window_mode.js(驗收 3、場景 3 與 Scenario Outline) > 有合成器:根元素只有 hud-frameless;沒有合成器:hud-frameless  |
| B1a | 縮小/關閉鈕 focus 又出現方形 outline | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > 縮小 / 關閉鈕 一般、hover、focus-visible:切角外側 = 背景,外圍 2–4 像素沒有橘色(沒有方形 outli |
| B1b | 縮小/關閉鈕 hover 橘色填滿矩形(含切角) | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > 縮小 / 關閉鈕 一般、hover、focus-visible:切角外側 = 背景,外圍 2–4 像素沒有橘色(沒有方形 outli |
| B2 | 縮小/關閉鈕內底寫死不透明白 | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > 縮小 / 關閉鈕 一般:內部跟著 --hud-panel 走(放大法:半透明紅疊深色頁底,寫死的不透明白、灰、--hud-solid |
| B2b | 縮小/關閉鈕內底寫死 --hud-solid | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > 縮小 / 關閉鈕 一般:內部跟著 --hud-panel 走(放大法:半透明紅疊深色頁底,寫死的不透明白、灰、--hud-solid |
| B3a | 縮小/關閉鈕 hover 框線變淡(accent 30%) | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > 縮小 / 關閉鈕 hover、focus-visible 的框線:四條直邊正中間是飽和橘 (231,119,31) ±10,不是淡橘 |
| B3b | HudButton hover 框線變黑(不是橘) | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > HudButton hover、focus-visible 的框線:四條直邊正中間是飽和橘 ±10 AssertionError:  |
| B3c | HudField focus 框線變淡 | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > HudField focus 的框線:四條直邊正中間是飽和橘 ±10 AssertionError: expected [ …(4) |
| B3d | 縮小/關閉鈕 focus 框線不見(background none) | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > 縮小 / 關閉鈕 hover、focus-visible 的框線:四條直邊正中間是飽和橘 (231,119,31) ±10,不是淡橘 |
| B4 | 縮放把手 hover 又塗橘色方塊 | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > 縮放把手 hover:計算 background-color 透明、沒有填色,把手範圍裡 0 個橘色像素(四個角不會在切角裡畫橘色方 |
| B5a | 停用按鈕 hover 變橘(拿掉 :not(:disabled)) | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > 停用的 HudButton 與 HudField:排在現有元件後面、跟一般差 ≥ 30 像素、沒有橘色(滑鼠移上去也不變橘)、切 |
| B5b | 停用按鈕看起來跟一般一樣(opacity 1) | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > 停用的 HudButton 與 HudField:排在現有元件後面、跟一般差 ≥ 30 像素、沒有橘色(滑鼠移上去也不變橘)、切 |
| B5c | 停用作答欄 focus 變橘(拿掉 :not(:has(:disabled))) | **存活** | |
| B5d | 停用作答欄看起來跟一般一樣 | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > 停用的 HudButton 與 HudField:排在現有元件後面、跟一般差 ≥ 30 像素、沒有橘色(滑鼠移上去也不變橘)、切 |
| C1 | ShowGate 的 shown 旗標沒設(每次都回 true) | 紅(cargo) | thread 'a_page_that_finishes_after_the_timeout_is_not_shown_a_second_time' (1325371) panicked at tests/window_mode.rs:119:5: thread 'a_page_that_finis |
| C2 | init_script 沒帶 window_mode.js | 紅(cargo) | thread 'the_script_uses_the_class_names_of_the_hud_kit' (1326056) panicked at tests/window_mode.rs:89:9: thread 'the_rest_of_the_script_is_window_mode |
| C3 | window-state 沒拿掉 VISIBLE | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 兩個視窗的設定(驗收 1、場景 1) > window-state 外掛的 StateFlags 拿掉 VISIBLE(不然它在頁面載入前就把視窗打開) AssertionError: expect |
| C4 | capabilities 的 windows 少一個 | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > 權限剛好六條(驗收 2、場景 2) > permissions 跟那六條集合相等、沒有重複,windows 仍是 teach 與 test AssertionError: expected [ Ar |
| C5 | mode_for 的 frameless 改 false | 紅(cargo) | thread 'a_composited_desktop_is_frameless_and_not_solid' (1327353) panicked at tests/window_mode.rs:36:5: thread 'a_desktop_without_a_compositor_is_fr |
| C6 | on_page_load 不檢查 Finished(Started 也顯示) | 紅(cfg) |  FAIL apps/desktop/src/window-frameless.test.ts > main.rs 的接線(靜態;驗收 1、3) > 問 GDK、用 initialization_script、page load 的 Finished 與另開的計時各呼叫 ShowGate,逾時寫  |
| C7 | log 預設 filter 退回只印 error | 紅(cargolog) | thread 'without_rust_log_this_crates_warnings_are_printed' (1328524) panicked at tests/logging.rs:18:5: |
| C8 | 縮小/關閉鈕 focus-visible 淺色內框拿掉(minimize/close 的 background-image) | 紅(render) |  FAIL packages/ui-shared/src/hud/window-frame.test.ts > 展示頁勾「無框」與「假視窗按鈕」(驗收 5–8) > 縮小 / 關閉鈕 hover、focus-visible、一般 兩兩差 ≥ 30 個像素(focus 跟 hover 分得出來) A |

**存活 2 個**:
- **A4**(拿掉 arm_show_fallback 的呼叫):真缺口,見 G-1 與第 5 節。
- **B5c**(停用作答欄的 focus-within 橘框守衛 `:not(:has(:disabled))` 拿掉):等價——停用的 input 不可能取得焦點,focus-within 不會成立;測試只強制 hover(也無法強制 focus)。

## 5. 補測(驗收者寫,`apps/desktop/src/window-frameless-acceptance.test.ts`)

把 main.rs 去註解後取出三段各自查:open_windows 真的呼叫 arm_show_fallback 且在 build 之後;arm_show_fallback 本體順序 spawn → sleep(SHOW_FALLBACK) → on_timeout → if 區塊內 warn 與 show;on_page_load 閉包只處理 Finished、if on_page_finished 才 show、不寫 warn、不計時。

| 改壞 | 原測試(window-frameless.test.ts) | 補測 |
|---|---|---|
| A4 拿掉計時呼叫 | 存活 | 紅:open_windows 沒有呼叫 arm_show_fallback:頁面一直不完成載入時視窗永遠不會顯示 |
| D1 計時執行緒不睡 | 存活 | 紅:缺少 sleep(SHOW_FALLBACK) |
| D2 載入完成不 show() | 存活 | 紅:on_page_finished 區塊裡沒有 show() |
| D6 逾時不寫 warn | 存活 | 紅:缺少 log::warn! |
| D7 逾時不看 on_timeout 結果 | 存活 | 紅:on_timeout 的結果要用 if 判斷 |
| D8 載入完成路徑也寫 warn | 存活 | 紅:載入先完成時不該寫 warn |

基底(未突變)補測 3 條全綠;tsc 0 錯。

## 6. cargo-mutants(window_mode.rs,照 .cargo/mutants.toml 的做法,-j 1、CARGO_BUILD_JOBS=2)

`cargo mutants --config <只含 window_mode.rs 的暫存設定> -j 1 --no-shuffle -- --test window_mode`(TMPDIR 在 repo 底下 dist/mutants-tmp,兩層深,用完已刪;mutants.out 已刪、沒進 git)。
結果:**10 個變異:9 caught、0 missed、0 timeout、1 unviable**(mode_for 換成 Default::default() 編不過)。
地板(.cargo/mutants.toml 第三次實測 183/202 = 90.6%,不准降):本檔 9/9 = 100%,合併後 (183+9)/(202+9) = 91.0%,沒有降。
(第一次 -j 2 的嘗試因為把整個 examine_globs 都跑起來而被我中止;顧問提醒高負載下 TIMEOUT 不可信,後來單工重跑,沒有 timeout。)

## 7. grok-4.20 對抗審核

`opencode run -m xai/grok-4.20-0309-reasoning`,從空目錄跑,提示給工單全文與實作 diff(不含測試、不含 learning/ 內容);費用不顯示,寫「不知道」。逐條自己驗:

| 主張 | 我的驗證 |
|---|---|
| main.rs 的 mode/script/gate 在迴圈外,連 setup 視窗也被套上無框與隱藏 | **不成立**:迴圈走的是 start_screen::windows(state),只回 teach/test(失敗時是空陣列);setup 視窗在迴圈之後另用 WebviewWindowBuilder::new 建立,沒有 initialization_script、on_page_load、計時。測試 mainRsUnchangedProblems 也守著 |
| 計時與 spawn 留在 main.rs,測不到 | 部分成立,已補:這正是 G-1(原測試只認字串);補測第 5 節 |
| 標題列按鈕畫法與 HudButton 不同,量尺可能失效 | **不成立**:window-frame.test.ts 的框線、放大法、切角外側、外圍一圈、outline 都量得到(B 組 13 個 CSS 改壞版本全紅,B5c 等價) |
| Gallery.svelte 的  可能影響索引 | **不成立**:停用元件放在現有元件後面,disabledProblems 有索引守衛;全部量尺綠 |
| class 名字沒有共用常數 | **不成立**:測試比對 layout.ts 的 FRAMELESS_CLASS / SOLID_CLASS,A8b、A10 改壞全紅 |
| 「不改測試檔所以 CSS must_catch 沒有真的被量到」 | **不成立**:該工單的測試由 -e5 寫好(6ed8e29、0843854),worker 沒改;上面突變證明量得到 |
| 「建議退回重做」 | 不成立;唯一成立的是 G-1(測試缺口,已補) |

## 8. learning/ 前後(唯一量法,只讀)

| 時點 | 檔數 | 雜湊前 16 碼 | 帳本行數 |
|---|---|---|---|
| 開跑前 | 64 | 2ed7039eae558843 | 84 |
| 跑完後 | 64 | 2ed7039eae558843 | 84 |

前後相同。基準不是 worker 報告的 1e612e55854cdc1c/72:協調者在這之前跑了 T12 的真模型 golden run(兩輪共 12 筆呼叫、尾端追加、檔數不變),與 T16 無關(協調者確認過 2ed7039e/84 這個值)。我全程只讀。

## 9. 花費

worker 累計約 $17(協調者提供,取自 worker 報告前的累計),工單預算 $5:**約 3.4×,超過 2× 旗標線**;超在哪裡:不知道(沒有分輪成本)。grok 無 $ 上限(使用者 2026-10-15),只記錄。驗收端的 grok 審核費用:不知道。

## 10. 結論

通過(實作沒有阻擋項);有一個測試缺口(G-1)已由驗收補測關閉,補測需隨 worker 分支一起進 main;合併時 docs/02-decision-map.md 兩邊的 ADR 都要留(G-3)。觀感(@manual)不在這份,前端與顧問判。
