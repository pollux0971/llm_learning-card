# 驗收 T23(06-test-card phase-3:逾期數、小結、stuck、續答)

- 被驗:分支 t23-red-2,tip 4b0521f(= worker 的 t23-opencode 05a27d1 + 測試作者補 `scripts/review-handler.test.ts` 的一個 commit)。起點 t23-start 1291f12。
- 開跑與跑完的 tree sha:4ad2db37af767a7bbf2a7768731a74295e340912(兩次相同)。驗收日 2026-10-17。`ls .env` 在簽出裡:No such file。
- 驗收者:-ed。worker:opencode grok-4.7,帳面 $2.607(報告寫 $2.24 是提交前快照);工單預算 $5,實際/預算 = 0.52,沒超過 2 倍。

## 測試作者檢查
`git diff --name-only 1291f12..4b0521f`:App.svelte、session.ts、types.ts、handler.ts、docs/reviews/T23-report.md、`scripts/review-handler.test.ts`。
測試檔只有 review-handler.test.ts 一個,來自測試作者補的那個 commit(start 結果多釘 `overdue`,從 8 鍵改 9 鍵,斷言沒放鬆);worker 的 commit 0 個測試檔。歷史裡 mutants.out 0。

## 基準(未突變)
- 輕量 vitest(apps/test-card、apps/desktop/src、packages/core/src/session、scripts/review-handler.test.ts、features/support/test-card-phase3-core.test.ts):39 檔 864/864 綠。補丁前同一組在 05a27d1 上有 2 條紅(review-handler.test.ts 把 start 結果釘成八個鍵,沒有 `overdue`),補丁後綠。
- headless Chrome:card-render + card-render-phase3 共 26/26。
- cucumber `@test-card and (@phase-1 or @phase-2 or @phase-3) and not @manual`:19 場景 / 90 步全綠(lc-fs 重編後)。
- Chrome 與第一次 cucumber 在 05a27d1 上跑;4b0521f 與它只差一個測試檔,程式碼相同。cucumber 之後又在 4b0521f 上重跑一次,同樣 19/19。

## 變異測試(只經 npm run mutate,Stryker CLI)
指令:`npm run mutate -- <設定檔>`;設定檔(暫存,不進版控):commandRunner 跑 `vitest run --bail=1 --config vitest.mutate.config.ts`,`coverageAnalysis: off`,`concurrency 2`,`timeoutMS 300000`。
- session.ts:`MUTATE_TEST_GLOB='apps/test-card/src/session.test.ts'`,mutate 只列 apps/test-card/src/session.ts。561 mutants:killed 494、survived 67,分數 **88.06%**(T24 驗收是 81.62%)。
  `phase3-static.test.ts` 不能放進 glob:它讀 session.ts 原文,Stryker 插入的程式碼會讓「沒有 `|| 0`」那條紅,初始跑就失敗(第一次嘗試如此,改窄 glob 後正常)。
- handler.ts:`MUTATE_TEST_GLOB` 蓋 `scripts/review-handler.test.ts`、`packages/core/src/session/*.test.ts`、`features/support/test-card-phase3-core.test.ts`。257 mutants:killed 201、survived 56,分數 **78.21%**。
  survived 的位置都在舊程式(ReviewStartError 建構、refusingRouter、各處防禦)。**T23 新增的 overdue 迴圈與回傳欄位沒有任何存活變異。**
- session.ts 新程式裡的存活:`answeredThisRun` 的選擇性檢查(工單只要求讀進來不顯示)、`summaryLines` 的初始與重設值(畫面只在 done 才用,view 也用 phase 擋住)、`readSummary` 失敗後 `if (!summary)` 的區塊(拿掉之後 `summaryLinesOf(undefined)` 丟錯,被外層 try 接去 showStopped,結果相同)。判為低風險或等價,不阻擋。
- 摘要:reports/mutation 底下兩個 4b0521f 開頭的 json(隨本分支)。

## 自選改壞(16 個,只改實作,每個還原後綠)
| 改法 | 結果 |
|---|---|
| handler:`>= 1` 改 `> 1` | 紅 6 |
| handler:不管逾期天數全算 | 紅 8 |
| handler:start 結果不帶 overdue | 紅 19 |
| session:overdueCount 取 total | 紅 8 |
| session:passed / returned 對調 | 紅 11 |
| session:capped 永遠不說上限 | 紅 3 |
| session:`retryLater > 0` 改 `>= 0` | 紅 9 |
| session:root-mismatch 句號後加回空白 | 紅 4 |
| session:readStart 不查 overdue | 紅 8 |
| session:readTomorrow 不查 capped 型別 | 紅 3 |
| session:showStopped 的 canRetry 設 true | 紅 68 |
| App:「再試一次」onclick 換空函式 | 紅 2(真 Chrome) |
| App:stuck 條件反轉 | 紅 1 |
| App:reteach 的「繼續」搬到內文下面 | 紅 1(靜態) |
| App:小結句子的 each 清空 | 紅 2(靜態) |
| App:逾期 0 不顯示 | 紅 4(真 Chrome) |
沒有存活。(上一輪對測試分支驗收時,小結區塊整段拿掉與非 done 帶小結兩個存活,補丁 1034a17 之後前者已紅、後者判等價。)

## 其他
- 非退步:phase-1、phase-2 的非 @manual 場景在上面的 19/19 裡全綠;review-cli 兩個 phase 的舊場景(`@review-cli and (@phase-1 or @phase-2) and not @manual and not @llm and not @e2e`,含測試作者轉接的四句共用步驟)在 4b0521f 上 28 場景 / 162 步全綠。
- worker 報告:沒有卡片、帳本、raw 內容;沒有真實 learning 目錄路徑。
- learning/ 前後(唯一量法):64 個檔 / c2e4dd6d71de3976 / 帳本 108 行,前後相同。
- 沒有新增 .ts 檔(這張沒有)。

## 結論
通過。
