# T53 紅測試驗收證據

- 工單:T53(02-ingest-pipeline phase-3:來源規則、增量與 stale)。只驗測試與步驟定義。
- 被驗分支:t53-red,sha e5d818551b13853eb963f2e0fad6849bf91f0467(基底 723f13a,1 個 commit)
- 開跑與跑完的 tree sha:8b9b4e12547ce3a936d17c03a7520cc8cc74284f(相同;丟棄實作與改壞都已還原、新增的檔已刪,git status 乾淨)
- 日期:2026-10-25
- 工作樹:乾淨簽出(detached),沒有 .env

## 只動測試
8 個檔,都是測試、步驟定義或測試支援:新 features/steps/ingest-phase3.steps.ts;改既有 features/steps/ingest.steps.ts(+3)與 prompt-quality-phase2.steps.ts(+5/−1);4 個 t53-*.test.ts(36 條);t53-test-support.ts。沒有實作檔。

## 基底紅綠
- 單元 36 條:全紅(沒有一條綠)。紅的原因:27 條是 runIngestScan 還沒匯出;CLI 那幾條是 CLI 還沒有掃描跑法,或現況的缺陷(已設定的分類被 --file 覆寫、同名同內容仍被複製)。
- cucumber @ingest-pipeline and @phase-3:8 場景 = 6 紅 / 1 undefined / 1 綠。紅:場景 1、3、4、5、6、7;undefined:場景 2(留給 T55,步驟沒定義,正確);綠:場景 8(stale 的卡照樣複習,護欄)。

## 兩個改過的既有步驟檔有沒有害到既有場景
都沒有。在紅測試的樹上單條 --tags 跑:
| 標籤 | 結果 |
|---|---|
| @ingest-pipeline and not @phase-3 and not @manual | 29 場景 195 步全綠 |
| @prompt-quality and @phase-2 and not @manual and not @live(12 phase-2) | 22 場景 85 步全綠 |
| @i1 and not @manual and not @llm and not @e2e | 78 場景 329 步全綠 |
改動方式:ingest.steps.ts 的「ingest runs」先問 phase-3 有沒有情境(只有 phase-3 設了 raw 檔才走掃描,其他世界查不到就走原路);prompt-quality-phase2 的「no directory is created」先問場景 7 有沒有記掃描前的目錄雜湊,有才在那邊驗,否則走原本的斷言。步驟重複檢查 npm run check:steps:PASS(1293 個定義每種形狀恰好 1 個)。

## 步驟不是空殼、安全
- 各 Then 都比對結果欄位、卡檔位元組(用 expectedMarked 算出預期)、LLM 呼叫數(場景 1 要 0)、輸出目錄雜湊、raw/ 雜湊;場景 1 的「no cards are written」用預設分類 security,剛好等於場景的分類,不是假綠。
- rmSync 只用在 mkdtemp 出來的暫存目錄裡(刪暫存的 raw 檔、卡檔);沒有指向 learning/、家目錄或任何寫死的 /data/python 路徑。
- 含新檔樹:boundaries PASS(383);tsc 乾淨。

## 丟棄式實作(不進 git,已刪;由 sonnet 子代理寫,我自己重跑驗證)
新 scan.ts(runIngestScan 與純文字標記函式)加 scripts/ingest.ts 的掃描 / 主題跑法、不覆寫既有分類、同名不同內容拒絕。我重跑:packages/core 的 ingest 與 schema 共 43 檔 918 條全綠(含 36 條新測試);tsc 乾淨;boundaries PASS(384);cucumber phase-3:8 場景 = 7 綠 / 1 undefined(場景 2)。證明紅測試能轉綠。
子代理回報的、測試沒有釘的地方(給顧問知道,不擋):已處理但內容變了的檔,實作把它同時放進 skipped 與 staleCards,測試允許這樣;非 --fake 的掃描會先探測雲端(連只標 stale 也會),測試只用 --fake;設定裡沒有的 raw 資料夾不會出現在結果裡。

## 手改壞(對丟棄實作手改;範圍 4 個 t53 單元檔 36 條)
| # | 改法 | 結果 |
|---|---|---|
| S1 | sha 一樣也標 stale | 紅 3 |
| S2 | 標記一律用 LF(CRLF 卡的換行被改) | 紅 8 |
| S3 | 已經標過的卡又寫一次 | 紅 3(mtime) |
| S4 | 拒絕未定義分類前先建了資料夾 | 紅 4 |
| S5 | 掃描跟著符號連結走 | 紅 2 |
| S6 | 要求 raw 的分類沒有 raw 卻不拒絕 | 紅 3 |
| S7 | raw 刪了卻標成 stale 而不是 source_missing | 紅 2 |
| S8 | . 開頭的檔也處理 | 紅 2 |
| S9 | 非 .md 的檔也處理 | 紅 3 |
| S10 | 有 raw 又給主題卻不報「主題被略過」 | 紅 3 |
| S11 | 看不懂的旗標也再插一行 | 紅 1 |
| S12 | --file 同名不同內容直接覆寫 raw | 紅 1 |
| S13 | --file 每次都覆寫已設定的分類 | 紅 1 |
| S16 | 記錄用了契約 §10 沒有的事件類型 | 紅 1 |
| S17 | 拿掉「解析後路徑不在分類資料夾內」的檢查 | **存活**(符號連結在前一步已被擋,這條在沒有硬連結或掛載的情況下構造不出來;等價) |
15 個:14 紅、1 存活。工單 must_catch 對應:已處理又處理(S1 的反面由 incremental 單元測試守)、stale 位元組(S2、S3)、source_missing(S7)、沒設定的分類被建(S4)、要求 raw 的呼叫數(S6 與 cucumber 場景 1)、raw 優先(S10)、符號連結(S5)、事件類型(S16)、--file 覆寫(S12、S13)。

## 資料前後(只記數字)
learning/ 檔案數、整體雜湊、帳本行數:前 64 / c2e4dd6d71de3976 / 108,後 64 / c2e4dd6d71de3976 / 108(前後相同)。

## 結論
通過(附三點測試沒釘的行為,見丟棄式實作一節)。
