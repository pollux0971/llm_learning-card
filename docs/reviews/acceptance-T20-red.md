# T20 紅測試驗收證據

- 工單:T20(移除 word-count-min 這份字數複本,統一 example 圍欄的算法)。只驗測試與步驟定義。
- 被驗分支:t20-red,sha c5cb6cc0f0bf691dd33ff71c963e8b34398050f2(基底 ee79ff9,1 個 commit)
- 開跑與跑完的 tree sha:068e9acb9d146579a1a4d8d7811919b50c54c907(相同;丟棄式實作與改壞都已還原,git status 乾淨)
- 日期:2026-10-25
- 工作樹:乾淨簽出(detached),沒有 .env

## 只動測試
4 個檔:新 packages/core/src/ingest/t20-no-word-count-min.test.ts、新 packages/core/src/ingest/example-fence-word-count.test.ts、改 features/steps/ingest.steps.ts 與 features/steps/i1-content-pipeline.steps.ts。沒有實作檔。

## 沒有釘契約沒定義的東西
測試裡沒有期望值 6;沒有四反引號案例(契約 1.2.0 是 2,現實作算 6 是 T51 的缺陷,T20 不釘);沒有開閉在同一行、未閉合的圍欄。差分用的 body 與案例清單我逐條讀過。

## 基底紅綠
基底(ee79ff9)上兩個新檔共 31 條 = 3 紅 / 28 綠:
- 紅 3,都是靜態檢查:仍有 import word-count-min(generate-cards 第 3 行、index 第 3 行、舊測試檔共 3 處);word-count-min.ts 與它的舊測試檔還在;ingest 的 barrel 還在匯出舊複本的 4 個名字。
- 綠 28:搬來的邊界案例 8 + 4 + 3 條、差分 12 條等;本來就綠(T19 之後兩邊一致),是護欄,不是紅的來源。前提檢查那一條也綠。
- 步驟定義改走公開的 enforceWordLimit:cucumber 在基底與丟棄實作上都綠(@ingest-pipeline and @phase-1:10 場景 82 步;@i1:79 場景 339 步)。步驟不是紅的來源。
靜態測試掃 packages/、scripts/、features/ 的 .ts .js .mjs .cjs .svelte,跳過 node_modules 等;認 from、import(、require( 與 vi.mock 的來源路徑;註解裡提到檔名不算;前提檢查證明正則抓得到靜態、export from、動態 import,且不誤判註解。barrel 檢查真的載入 index.ts,包含 export * 轉出來的名字。

## 搬過來的邊界案例逐條對照(舊 word-count-min.test.ts)
| 舊測試 | 新位置 |
|---|---|
| countWords:CJK 每字 1(4) | COUNT_CASES 第 1 條(葉模組與 ingest 兩條路都量) |
| 連字號切斷(same-origin = 2) | COUNT_CASES |
| 連續英數字(TLS = 1) | COUNT_CASES |
| 句點切斷(1.5 = 2) | COUNT_CASES |
| 撇號切斷(don't = 2) | COUNT_CASES |
| 空白切斷(RFC 6265 = 2) | COUNT_CASES |
| 標點與符號本身 0 | COUNT_CASES |
| 混合案例 wordcount-cases(23) | COUNT_CASES |
| stripExampleFences:移除圍欄、收 examples | parseCardText 的 body 與 examples 一條(body 比對時把空白去掉,比舊測試的逐字略鬆,不影響字數意義) |
| 沒有圍欄原樣、examples 空 | 一條 |
| 多個圍欄依序收集 | 一條 |
| countBodyWords:先去圍欄再算(5) | FENCE_CASES 第 1 條 |
另補工單列的「非 example 的圍欄不移除」和「圍欄在中間」、「多個圍欄各自去掉」。舊測試沒有四反引號的條目,沒東西可搬。每條都對 ingest 的 enforceWordLimit 第一次字數、葉模組的 countWords(parseCardText(...).body),再與 validateCard 的 bodyWordCount 差分。

## 丟棄式實作(不進 git,已刪)
generate-cards.ts 改用 @contracts 的 CARD_BODY_WORD_LIMIT;index.ts 拿掉那行 export *;刪掉 word-count-min.ts 與舊測試。packages/core/src/ingest 加 schema 共 37 檔 830 條全綠;tsc 乾淨;兩組 cucumber 在丟棄實作上也全綠(同基底)。

## 自選改壞(對丟棄實作手改;範圍 packages/core/src/ingest 共 421 條)
| # | 改法 | 結果 |
|---|---|---|
| W1 | countBodyWords 不去圍欄 | 紅 15(T20 差分與圍欄案例) |
| W3 | 上限判斷 +1 | 紅 16(ingest 既有重試測試,T20 新檔不抓) |
| W4 | countBodyWords 改自帶舊正則(換行可有可無) | 紅 6,全在 T19 既有的 generate-cards.regenerate 測試;T20 新檔不抓(契約沒定義的案例不測,是刻意的) |
| W9 | 含連字號的 body 多算 1 | 紅 13(T20 COUNT 與差分) |
| W5 | word-count-min.ts 檔案還在但沒人用 | 紅 1(存在檢查) |
| W6 | barrel 多匯出 countWords | 紅 1 |
| W7 | barrel 又 export * 舊檔 | 紅 3 |
7 個全紅,沒有存活。每次還原,最後 git status 乾淨。

## 觀察(不擋)
工單 must_catch 第 1 條「ingest 仍有任何地方用舊複本的圍欄正則」:T20 新檔只靠 import 路徑與檔案存在檢查,抓不到 worker 在 generate-cards 裡自己再寫一份舊正則(W4);這種情況要靠 T19 既有的 regenerate 測試(CRLF、example 後有字等)才紅,實際上有被抓到。建議不用另補。

## 資料前後(只記數字)
learning/ 檔案數、整體雜湊、帳本行數:前 64 / c2e4dd6d71de3976 / 108,後 64 / c2e4dd6d71de3976 / 108(前後相同)。

## 結論
通過。
