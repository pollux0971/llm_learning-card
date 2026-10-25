# T51 第二輪實作驗收證據

- 工單:T51 第二輪(example 圍欄的開始行與結束行接受 CommonMark 空白寬容,顧問裁決乙)
- 被驗分支:t51-impl2,sha 0cde9675b30b623442732e3ab251893b1f01adb8(起點 t51b-start 6c61f2b,已含補測 t51-red3)
- 開跑與跑完的 tree sha:f4901753eabe6f0a50763d4bb1f9c3de7e2adb0e(相同;改壞後都已還原)
- 日期:2026-10-25
- 工作樹:乾淨簽出(detached),沒有 .env

## 測試作者與範圍
對起點只改 packages/core/src/schema/parse-card.ts(+8/−3)與 docs/reviews/T51-implementation-2.md。測試檔沒動。通過。

## 基準(VITEST_MAX_WORKERS=1)
| 項目 | 結果 |
|---|---|
| packages/core + packages/ui-shared 全部(含 contract-vectors、fence-whitespace 與 D 組) | 142 檔 3244 條全綠 |
| tsc | 乾淨 |
| boundaries(含新測試檔) | PASS,掃 378 |
| cucumber,標籤 @data-layer and not @manual | 88 場景 351 步綠 |
| cucumber,標籤 @i1 and not @manual and not @llm and not @e2e | 78 場景 329 步綠 |
| doc-links | PASS(掃描見最後一行指令輸出) |

## 變異測試
指令:VITEST_MAX_WORKERS=1 npm run mutate -- stryker.t51-parse-card.json(Stryker CLI)
- 設定檔的測試範圍我先前只有 parse-card、validate-card、contract-vectors 三個檔,漏了新的 fence-whitespace 測試檔;用舊範圍跑出 89.29%(28 個、殺 25、存活 3)。這個分數偏低是範圍的問題,不是測試的問題,所以我把 fence-whitespace 測試檔加進設定(本證據分支裡的 stryker.t51-parse-card.json 已改)。
- 範圍補齊後:**96.43%**(28 個變異,殺 27、存活 1、逾時 0、無覆蓋 0),≥ 80%,過。24 秒。
- 存活 1 個:把結束行檢查的 `\r?\n` 改成 `\r\n`。在有 m 旗標時 $ 已涵蓋 LF,等價。

## 自選改壞(對 t51-impl2 手改 parse-card.ts 的正則;範圍 packages/core/src/schema 加 regenerate 測試檔 共 600 條)
| # | 改法 | 結果 |
|---|---|---|
| X1 | 不容忍結束行縮排 | 紅 4 |
| X3 | 不容忍結束行尾空白 | 紅 8 |
| X4 | 不容忍開始行空白 | 紅 8(含 regenerate 那 2 列) |
| X5 | 開始行只容忍空白、不容忍 Tab | 紅 2 |
| X6 | 結束行尾只容忍空白、不容忍 Tab | 紅 4 |
| X8 | example 後面什麼字都算開始行 | 紅 3 |
| X9 | 反引號兩個以上 | 紅 1 |
| X12 | 結束行在檔尾沒換行不算結束 | 紅 2 |
| X14 | 結束反引號不必在行首(貼在內容行尾也算結束) | 紅 4(D 組補測抓到,上一輪這條存活) |
| X16 | 拿掉結束行後面的檢查(反引號後面接字也算結束) | 紅 4(D 組補測抓到) |
| X2 | 縮排放寬到 4 個空白 | **存活**(縮排 4 以上屬未定義,不測) |
| X10 | 縮排也容忍 Tab | **存活**(未定義) |
| X15 | 結束的反引號可以比開始多 | **存活**(契約未定義,不測) |
13 個:10 紅、3 存活;3 個存活都是契約未定義的情況,屬設計。上一輪的殘餘缺口(結束行後面有字、貼在內容行尾)已由補測守住。

## 資料前後(只記數字)
learning/ 檔案數、整體雜湊、帳本行數:前 64 / c2e4dd6d71de3976 / 108,後 64 / c2e4dd6d71de3976 / 108(前後相同)。

## 花費
worker 1.17 美元(只記錄;第一輪 1.10,合計 2.27)。LLM 真呼叫 0。grok 審核這次沒開。

## 結論
通過(變異 96.43%)。
