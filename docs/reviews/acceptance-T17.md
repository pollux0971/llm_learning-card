# 驗收證據:T17 11-review-cli phase-2 —— 當日快取、續答、跨日、暫停、dry-run、結束時 snapshot

驗收角色:-ed(測試·驗收;紅測試 `t17-red` 也是我寫的,所以本次對 worker 實作做的是「紅轉綠」驗證與突變,不是審查我自己的測試設計)。日期:2026-10-16(Asia/Taipei)。
被驗分支:`pollux0971/t17-opencode` @ `6b7115f`(worker 兩個 commit:25cee9a 實作、6b7115f 報告;起點 `t17-start` cce3b86 + 協調者合入的 0ed8a36)。
我的補測在 `pollux0971/t17-accept-tests`(基於 6b7115f,只加兩個測試檔與這份證據)。不合併、不 push、沒改 worker 的任何實作檔。

## 0. 結論

**實作沒有阻擋項。** 工單 must_catch 每一條都有會紅的測試;48 個改壞版本裡 47 個一次就紅,1 個存活(X4:續答時 reteach 不照快取)是**測試缺口**,已補測關閉。
變異分數(session 三檔,程序內單元層)96.7%,高於標準 80%。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| G-1 | 測試缺口,已補 | 把 `sessionFromCache` 的 reteach 改成空陣列,紅測試全綠;快取存 reteach 的目的就是續答時照用 | 補測 1 條(手寫帶 reteach 的快取,要看到複習提示在第一題之前),X4 改壞後紅 |
| G-2 | 補強 | 紅測試是子程序層(一條 2–3 秒),不能拿去跑 Stryker;工單要求 session 邊界邏輯變異門檻 80% | 補 `cache-acceptance.test.ts`(33 條,程序內,秒級)讓 Stryker 跑得動;分數見第 4 節 |
| G-3 | 備註 | I2 整合第一次跑有 3 個場景死在 cucumber 預設的 5000 毫秒步驟逾時(步驟會起 review.ts 子程序,沒設逾時),當時機器 load 約 2–7;同一組重跑 15/15 全綠。步驟檔不是 T17 的,也不是 worker 改的 | 標出;建議之後給那幾個 I2 步驟加逾時(測試端的事,不擋) |
| G-4 | 備註 | 續答時 reteach 名單照快取原樣回放,不看那張卡今天是否已答過:使用者早上已答過的 reteach 卡,下午續答又會先看一次它的複習提示。工單沒規定,屬體驗小事 | 不擋;提顧問知道 |
| G-5 | 成本 | worker 沒有可讀的累計費用(報告寫「畫面底列的 $ 讀不到,不知道」);工單預算 $4 | 不知道(不寫 0) |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 `acceptance-t17`(detached @ 6b7115f;node_modules 與 src-tauri/target 從別的驗收簽出複製),沒有 `.env`。開跑 tree sha:`c83e64833bb54eae7d4c15980dcb3bff8e10bf15`。
- **測試作者檢查**:worker 兩個 commit(25cee9a、6b7115f)列檔,測試檔(`*.test.*`、`tests/`、`test-support`、`features/steps/**`、`.feature`、fixtures)變動 **0**;
  25cee9a 動的檔:session/{build,cache,index,present,summary,types}.ts、scripts/review.ts、scripts/boundaries.owners.json(把紅測試檔 review-session.test.ts 登記成 steps,讓 boundaries 綠;不是新增 allow)。
- `git log --name-only t17-start..6b7115f | grep -c mutants.out` = 0。
- **i2-review-loop.steps.ts 對 dc2a4c1 的 diff**(顧問要求附上;我在紅測試階段改的,worker 沒碰):只有兩處,斷言沒有放鬆 ——
  1. `/1 question\(s\) had a grading error/` → `/Retry later: 1 question\(s\)\./`(同一個檔的其他斷言:`0 passed, 0 returned`、雲端剛好問兩次、退出碼 0,原樣)。
  2. 續答第一題 `(1/3)` → `(3/5)`,並新增整個序列 `3/5、4/5、5/5` 的 deepEqual(更嚴)。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries` | PASS(scanned=291) |
| vitest `packages/core/src/session` + `scripts/review-session.test.ts` + `scripts/review.test.ts` | 12 檔 180 綠 |
| cucumber `@review-cli and @phase-2 and not @manual` | 13/13(70 步) |
| cucumber `@review-cli and @phase-1 and not @manual` | 15/15(92 步) |
| cucumber `@integration and @i2 and not @manual` | 第一次 12/15(3 個 5 秒逾時,見 G-3);重跑 15/15(96 步) |
| 重編 | cucumber BeforeAll 重編 lc-fs(target 由 T16 驗收簽出複製後增量編) |
| 併進最新 main(df3dbc2) | `git merge-tree`:無衝突 |

## 3. 改壞版本(48 個,改一處實作 → 跑對應層 → 還原)

層:unit = `packages/core/src/session` 全部測試;rs = `scripts/review-session.test.ts`(子程序);cuc2 = cucumber phase-2。編號 M = 工單 must_catch 對應,X = 我自選。

| 編號 | 改壞 | 結果 | 失敗訊息(原文,截斷) |
|---|---|---|---|
| M01 | 同一天再跑重建題目集合(讀到快取當沒有) | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > readSessionCache > 合法 → ok,內容原樣 AssertionError: expected { kind: 'miss |
| M02 | 續答不略過已答的卡 | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > dropAnsweredToday > 今天有 history 的卡拿掉;昨天或更早的不算;沒有紀錄的卡留著;順序不變 AssertionE |
| M03 | 進度分母用剩下的題數 | 紅(rs) |  FAIL scripts/review-session.test.ts > 當日快取:位置與格式(驗收 1) > 要 reteach 的卡(fails_in_row 剛好 2)記在 reteach;超過每日上限的記在 deferred,total_due  |
| M04 | 跨日不刪舊快取 | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > writeSessionCache > 刪掉同一個帳本資料夾裡其他日期的 session-*.json,留下今天的、非 session 開頭 |
| M05 | 過期(裡面 date 是昨天)也照用 | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > readSessionCache > 檔案裡的 date 不是今天 → stale(帶回內容) AssertionError: expect |
| M06 | 壞 JSON 讓指令當掉 | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > readSessionCache > 不是 JSON、空檔、schema 不過 → invalid |
| M07 | 壞快取不寫 warning | 紅(rs) |  FAIL scripts/review-session.test.ts > 壞快取:丟掉、重建、記一筆 warning,不當掉(驗收 1) > 不是合法 JSON → 重建、剛好一筆 warning(reason 與檔名,不含絕對路徑)、退出碼 0、題目照 |
| M10a | --pause 對既有快取沒標暫停 | 紅(rs) |  FAIL scripts/review-session.test.ts > 暫停(驗收 2、5) > --pause 在快取已經存在時只把 paused 設成 true,題目集合(queue、reteach、total_due、deferred)原封不動  |
| M10b | --pause 新建的快取沒標暫停 | 紅(rs) |  FAIL scripts/review-session.test.ts > 暫停(驗收 2、5) > --pause 不需要指標檔、不需要帳本身分:退出碼 0、印「今天已暫停」、快取標記 paused;reviews.json、weekly.json、lo |
| M11 | 暫停日仍然問題 | 紅(rs) |  FAIL scripts/review-session.test.ts > 暫停(驗收 2、5) > 暫停的那天直接再執行:在查帳本之前就擋下(沒有指標檔也是退出碼 0,不是 2)、說要加 --unpause、不問任何題目、reviews.json 不變  |
| M12 | 暫停訊息沒說今天已暫停 | 紅(rs) |  FAIL scripts/review-session.test.ts > 暫停(驗收 2、5) > 暫停的那天直接再執行:在查帳本之前就擋下(沒有指標檔也是退出碼 0,不是 2)、說要加 --unpause、不問任何題目、reviews.json 不變  |
| M13 | --unpause 之後重建題目集合 | 紅(rs) |  FAIL scripts/review-session.test.ts > 暫停(驗收 2、5) > --unpause:印「已恢復今天的複習」、paused 設回 false、題目集合維持原來那份(暫停期間新到期的卡不加進來),接著照一般執行進入答題;一 |
| M14 | --unpause 之後還是暫停 | 紅(rs) |  FAIL scripts/review-session.test.ts > 暫停(驗收 2、5) > --unpause:印「已恢復今天的複習」、paused 設回 false、題目集合維持原來那份(暫停期間新到期的卡不加進來),接著照一般執行進入答題;一 |
| M15 | --dry-run 重寫快取 | 紅(rs) |  FAIL scripts/review-session.test.ts > --dry-run 反映真實 session、永遠不寫(驗收 3) > 已有快取(5 題答了 2 題):列出剩下 3 題、同順序,標題行說「已答 2 / 共 5」;快取內容與 mt |
| M16 | --dry-run 沒快取時建快取 | 紅(rs) |  FAIL scripts/review-session.test.ts > --dry-run 反映真實 session、永遠不寫(驗收 3) > 今天沒有快取:跟 phase-1 一樣現算(第一行基數、逐張列出),不建任何快取,連資料夾都不建;不需要指標 |
| M17 | --dry-run 列的不是剩下的題目 | 紅(rs) |  FAIL scripts/review-session.test.ts > --dry-run 反映真實 session、永遠不寫(驗收 3) > 已有快取(5 題答了 2 題):列出剩下 3 題、同順序,標題行說「已答 2 / 共 5」;快取內容與 mt |
| M18 | 結束沒有 snapshot | 紅(rs) |  FAIL scripts/review-session.test.ts > 結束時 snapshot(驗收 4,ADR-042) > 答完一題以上:結束時剛好一個 commit(只有 state/ 底下的檔案,commit 訊息 snapshot <日期> |
| M19a | --pause 也 snapshot | 紅(rs) |  FAIL scripts/review-session.test.ts > 結束時 snapshot(驗收 4,ADR-042) > 暫停日再跑、--pause、--dry-run、--unpause 之後一題都沒答就離開:都不 snapshot(工作樹的 |
| M19b | --dry-run 也 snapshot | 紅(rs) |  FAIL scripts/review-session.test.ts > 結束時 snapshot(驗收 4,ADR-042) > 暫停日再跑、--pause、--dry-run、--unpause 之後一題都沒答就離開:都不 snapshot(工作樹的 |
| M20 | snapshot 失敗讓退出碼變 1 | 紅(rs) |  FAIL scripts/review-session.test.ts > 結束時 snapshot(驗收 4,ADR-042) > git 出錯(commit 被 hook 擋下)不影響複習:退出碼仍是 0、答案已落地、小結照印,之後有一行說明失敗(不丟 |
| M21 | not-a-repo 沒印提示 | 紅(rs) |  FAIL scripts/review-session.test.ts > 結束時 snapshot(驗收 4,ADR-042) > 不是 git repo:退出碼不變(0),小結先印,之後提示「跑 cli.ts init 就會補上版本控制」;learni |
| M22 | 快取寫進 learning/state | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > sessionCacheFile / sessionCacheFilename > <快取根>/llm-learning-cards/<資料 |
| M23 | 寫入不原子(直接 writeFileSync) | 紅(unit) |  FAIL packages/core/src/session/cache.test.ts > 寫入走 writeFileAtomic(硬規則 5:暫存檔、fsync、rename) > cache.ts 沒有自己寫檔或改名(writeFileSync /  |
| M24 | vault_id 不用,一律 path-hash | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > sessionCacheFolder > 合法 vault-id(含一個結尾換行或沒有換行)就用它 AssertionError: expe |
| M25 | XDG_CACHE_HOME 空字串當有設 | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > sessionCacheHome > 空字串視同未設 → $HOME/.cache AssertionError: expected ''  |
| M26 | 小結 passed/returned 只算本次 | 紅(rs) |  FAIL scripts/review-session.test.ts > 當日快取:同一天再跑,用快取裡那一份(驗收 1) > 小結是「今天這一輪」(顧問裁決):先答 1 題、續答剩下 3 題(續答第一題故意答錯)→ 「3 passed, 1 retur |
| M27 | 有效結果不看 revised_to | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > tallyToday > 有效結果 = revised_to ?? pass:改判成過算過、改判成沒過算回退(兩個方向) Assertion |
| M28 | stage 2 兩筆只要一筆過就算通過 | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > tallyToday > 每筆有效結果都過 → passed;任何一筆沒過 → returned;沒有今天的 history → retry |
| M29 | 待重試永遠不算 | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > tallyToday > 每筆有效結果都過 → passed;任何一筆沒過 → returned;沒有今天的 history → retry |
| M30 | 沒結果的卡被算進 passed | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > tallyToday > 每筆有效結果都過 → passed;任何一筆沒過 → returned;沒有今天的 history → retry |
| M31 | 本次作答數用整天的數字 | 紅(rs) |  FAIL scripts/review-session.test.ts > 當日快取:同一天再跑,用快取裡那一份(驗收 1) > 小結是「今天這一輪」(顧問裁決):先答 1 題、續答剩下 3 題(續答第一題故意答錯)→ 「3 passed, 1 retur |
| M32 | 本次作答 0 題也 snapshot | 紅(rs) |  FAIL scripts/review-session.test.ts > 結束時 snapshot(驗收 4,ADR-042) > 暫停日再跑、--pause、--dry-run、--unpause 之後一題都沒答就離開:都不 snapshot(工作樹的 |
| M33 | --pause 與 --unpause 同時給不報錯 | 紅(rs) |  FAIL scripts/review-session.test.ts > 暫停(驗收 2、5) > --pause 與 --unpause 同時給 → 用法錯誤(退出碼 1),不建快取 AssertionError: 今天已暫停 |
| M34 | reteach 沒存進快取 | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > toSessionCache > 只留 DueItem 的四個欄位,不存 learned_at / 答案 / 分數;reteach 是拷貝  |
| M35 | deferred 沒存進快取 | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > toSessionCache > 只留 DueItem 的四個欄位,不存 learned_at / 答案 / 分數;reteach 是拷貝  |
| M36 | warning 的 path 寫絕對路徑 | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > warnInvalidSessionCache > 追加一筆 warning:reason、只有檔名的 path、ISO 時間;state/ |
| M37 | schema queue 項不嚴格 | 紅(unit) |  FAIL packages/core/src/session/cache.test.ts > SessionCacheSchema 拒絕壞的快取(壞了就丟掉重建) > 不存 learned_at:queue 項若多一個 learned_at 就是壞的(那個 |
| M38 | schema 不檢查 version | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > readSessionCache > 不是 JSON、空檔、schema 不過 → invalid AssertionError: "{\" |
| M39 | 暫停日先查帳本 | 紅(rs) |  FAIL scripts/review-session.test.ts > 暫停(驗收 2、5) > 暫停的那天直接再執行:在查帳本之前就擋下(沒有指標檔也是退出碼 0,不是 2)、說要加 --unpause、不問任何題目、reviews.json 不變  |
| M40 | HOME 退路用相對路徑 | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > sessionCacheHome > 空字串視同未設 → $HOME/.cache AssertionError: expected '.c |
| M41 | path- 雜湊不解 symlink | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > sessionCacheFolder > 雜湊用的是真實路徑:symlink 與真實目錄得到同一個資料夾 AssertionError: e |
| M42 | 已答判定把更早的 history 也算 | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > dropAnsweredToday > 今天有 history 的卡拿掉;昨天或更早的不算;沒有紀錄的卡留著;順序不變 AssertionE |
| M44 | 明日預估回退數用本次計數 | 紅(rs) |  FAIL scripts/review-session.test.ts > 當日快取:同一天再跑,用快取裡那一份(驗收 1) > 小結的 passed / returned 從 reviews.json 算(今天這一輪):stage 2 的兩筆合成一張卡, |
| M45 | snapshot 在小結之前 | 紅(cuc2) |  ✖ Then the summary is printed first # features/steps/review-cli-phase2.steps.ts:581 AssertionError [ERR_ASSERTION]: 小結(1 |
| X1 | dry-run 標題「已答」數算錯 | 紅(rs) |  FAIL scripts/review-session.test.ts > --dry-run 反映真實 session、永遠不寫(驗收 3) > 已有快取(5 題答了 2 題):列出剩下 3 題、同順序,標題行說「已答 2 / 共 5」;快取內容與 mt |
| X2 | 快取 queue 的 stage 不存(用 1) | 紅(unit) |  FAIL packages/core/src/session/cache-acceptance.test.ts > toSessionCache > 只留 DueItem 的四個欄位,不存 learned_at / 答案 / 分數;reteach 是拷貝  |
| X3 | hook:壞快取時 --dry-run 不說明 | 紅(rs) |  FAIL scripts/review-session.test.ts > --dry-run 反映真實 session、永遠不寫(驗收 3) > 快取壞掉:--dry-run 不重建、不寫 warning(它不寫任何東西),照現算列出,並說明快取無法讀取 |
| X4 | 續答時 reteach 不照快取 | **存活** | |

分層統計:unit 抓到 22、rs 抓到 24、cucumber 抓到 1(M45,snapshot 先於小結,只有 cucumber 的時間順序斷言抓得到)、存活 1(X4,補測後紅:`X4b RED-BY rsacc`)。

## 4. 變異測試(Stryker,標準門檻 80%)

`stryker.t17-session.json`(驗收用設定,不進版控):mutate = session 的 cache.ts、build.ts、summary.ts;測試 = `packages/core/src/session/**/*.test.ts`(含補測 cache-acceptance);concurrency 2。
補測前 95.0%(228 殺、12 活);補測後 **96.67%**(232 殺、8 活;cache.ts 97.30、build.ts 93.62、summary.ts 97.56)。
這只算程序內單元層;子程序層(review-session.test.ts)另外殺掉的不計入,所以是下限。剩下 8 個存活:
- build.ts(deriveReteachQueue 的可選鏈、selectSession 前的 map)與 summary.ts(renderDryRun 的 join 分隔符、todays 預設陣列內容):phase-1 既有程式,非本工單新增;
- build.ts / summary.ts 的 `?? []` 預設陣列內容(`?? ["Stryker was here"]`):等價(元素的 date 是 undefined,過濾結果相同);
- cache.ts:標記檔 existsSync 守衛(等價:readFileSync 丟錯照樣走 catch)、readFileSync 編碼字串換空(等價:Buffer 也能 JSON.parse)、JSON.parse 的 catch 清空(等價:raw 為 undefined,schema 照樣判壞)。

## 5. 補測

| 檔 | 內容 |
|---|---|
| `packages/core/src/session/cache-acceptance.test.ts`(33 條) | sessionCacheHome 四種環境;sessionCacheFolder(uuid、結尾換行、/空白/路徑跳脫、目錄當標記、symlink、不存在);sessionCacheFile;readSessionCache 各種(missing/ok/stale/invalid、EISDIR、無權限、date 前後多字元);writeSessionCache(格式、只刪同資料夾其他日期的 session-*.json、別本不動、無暫存檔);warnInvalidSessionCache(欄位、檔名、state 不存在);toSessionCache;dueItemsFromCache;dropAnsweredToday;tallyToday(revised_to 兩個方向、stage 2 兩筆一張卡、名單外/帳本沒有);renderSummary 新欄位 |
| `features/support/review-session-acceptance.test.ts`(1 條) | 續答時 reteach 照快取(G-1) |

## 6. grok-4.20 對抗審核

`opencode run -m xai/grok-4.20-0309-reasoning`,從空目錄跑,提示給工單全文與實作 diff;費用不知道。逐條自己驗:

| 主張 | 我的驗證 |
|---|---|
| 一次跑完、有批改失敗時小結改變,違反「跟 phase-1 一樣」 | **不成立**:工單明文「Retry later 取代 phase-1 的 grading error 那行」,顧問裁決同;I2 場景(已同步措辭)與 cucumber 都綠 |
| --dry-run 沒列 reteach | **不成立/非缺陷**:reteach 是提示不是題目;phase-1 的 dry-run 本來就只列 due 清單,工單「剩下的題目」指答題 |
| not-a-repo 提示不保證含 cli.ts init | **不成立**:實測輸出(子程序測試與 cucumber 場景)含 cli.ts init 與版本控制;改壞 M21 紅 |
| dry-run 不清舊快取 | **非缺陷**:工單明定 dry-run 永遠不寫;M15、M16 紅守著 |
| 壞快取後已答紀錄是否保留沒被量到 | **不成立**:cucumber 壞快取場景與我補在紅測試裡的專測都量;M02 紅 |
| owners 把 vitest 檔登成 steps 可能錯 | 實測 boundaries PASS;worker 已在報告說明取捨(待協調),不擋 |

## 7. learning/ 前後(唯一量法,只讀)

| 時點 | 檔數 | 雜湊前 16 碼 | 帳本行數 |
|---|---|---|---|
| 開跑前(沿用 T16 收尾量值) | 64 | 2ed7039eae558843 | 84 |
| 跑完後 | 64 | 2ed7039eae558843 | 84 |

前後相同;全程只讀,所有測試用暫存目錄。

## 8. 花費

不知道(G-5)。工單預算 $4;worker 報告沒有可讀的累計費用。grok 無 $ 上限(使用者 2026-10-15),只記錄。

## 9. 結論

通過(實作無阻擋項);測試缺口 G-1 已補;補測兩個檔建議隨 worker 分支一起進 main。
