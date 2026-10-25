# T20 實作驗收證據

- 工單:T20(移除 word-count-min 這份字數複本,統一 example 圍欄的算法)
- 被驗分支:t20-impl,sha 25686a705304b385132c3b861c56a4e4009245ee(起點 t20-start 5c30d43)
- 開跑與跑完的 tree sha:cd303a02715dddc30f8cf727047cf6959cfca01b(相同;改壞後都已還原;重驗用的暫時合併已放棄,不在這個分支裡)
- 日期:2026-10-25
- 工作樹:乾淨簽出(detached),沒有 .env

## 測試作者
對起點改了 7 個檔:刪 word-count-min.ts 與 word-count-min.test.ts;改 generate-cards.ts、index.ts、types.ts、questions.ts(types、questions 只有註解);加 docs/reviews/T20-implementation.md。測試檔、features/steps、schema、contracts 都沒動(起點與 t20-red 只差文件)。通過。

## 基準(未突變,VITEST_MAX_WORKERS=1)
| 項目 | 結果 |
|---|---|
| packages/core + features/support 全部 | 142 檔 3143 條全綠 |
| tsc | 乾淨 |
| cucumber,標籤 @ingest-pipeline and @phase-1 and not @manual | 10 場景 82 步綠 |
| cucumber,標籤 @i1 and not @manual and not @e2e | 78 場景 329 步綠 |
| doc-links(t20-impl 原樣,從主簽出以 --root 跑) | **紅**:13 條壞連結,全在 worker 的 docs/reviews/T20-implementation.md(反引號裡寫了 路徑:行號,指到測試檔註解與 FEATURE.md 的行);本證據檔 0 條。要請 worker 或協調者把那份報告的 路徑:行號 改成不加反引號或不帶行號 |
| boundaries(t20-impl 原樣) | **紅 1**:t20-no-word-count-min.test.ts 第 41 行的示範字串被掃描器當成真 import。不是 worker 造成,是紅測試檔的問題(我驗紅測試時漏跑 boundaries,已承認) |
| boundaries(含 t20-red-fix 541a961 的暫時合併樹) | **PASS**,掃 376;tsc 乾淨;兩個 T20 新測試檔 31 條全綠 |
boundaries 的最後一列是在含 fix 的樹上跑的;暫時合併用 --no-commit 做,驗完 merge --abort,沒有進這個分支。

## 殘留檢查
git grep word-count-min(程式與設定,不含 docs):只剩測試檔裡的註解與字串(T20 新測試、generate-cards 的兩份既有測試註解)、packages/core/README.md 第 9 行、features/02-ingest-pipeline/FEATURE.md 第 46、95 行(後兩份由協調者合併時改)。另 reports/junit/testcase-names.txt 是 tracked 的測試名稱基準,還列著被刪掉的舊測試名;它不是守門,跑 run-tests 時會重新產生,合併後可能要一次基準更新。

## 改壞(手改 t20-impl,範圍 packages/core/src/ingest 共 421 條)
| # | 改法 | 結果 |
|---|---|---|
| W1 | countBodyWords 不去圍欄 | 紅 15(T20 差分與圍欄案例) |
| L99 | 字數上限換成 99 | 紅 17(generate-cards 既有重試測試;T20 新檔不抓) |
| L101 | 字數上限換成 101 | 紅 16(同上) |
| W4 | countBodyWords 自帶舊正則(換行可有可無) | 紅 6,全在 T19 既有 regenerate 測試;T20 新檔不抓(契約沒定義,刻意不測) |
| W9 | 含連字號的 body 多算 1 | 紅 13(T20 COUNT 與差分) |
| W5 | word-count-min.ts 檔案又出現但沒人用 | 紅 1(存在檢查) |
| W6 | barrel 多匯出 countWords | 紅 1 |
| W7 | barrel 又 export * 舊檔 | 紅 3 |
8 個全紅,沒有存活。上限 99 / 101 都由既有重試測試抓,確認了「T20 新檔不抓上限」靠既有測試。每次還原,最後 git status 乾淨。

## 資料前後(只記數字)
learning/ 檔案數、整體雜湊、帳本行數:前 64 / c2e4dd6d71de3976 / 108,後 64 / c2e4dd6d71de3976 / 108(前後相同)。

## 花費
worker 1.34 美元,工單預算 1,比值 1.34 倍,沒有超過 2 倍。LLM 真呼叫 0。grok 審核這次沒開。

## 結論
通過,附兩個要處理的守門:boundaries 需要 t20-red-fix 一起合併才會綠;worker 報告 docs/reviews/T20-implementation.md 的 doc-links 要修(13 條)。實作程式本身沒問題。
