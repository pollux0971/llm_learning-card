# 驗收證據:T59 實作

- 工單:T59(03-llm-router phase-3:provisional 佇列)
- 被驗:實作分支 b7e9b5ac3c4f671b217c52f1173ac04665f685c8(1 個 commit),起點 t59-start(main + 紅測試 t59-red2,含補的 O18 一條)
- 驗收用簽出的 tree sha:實作 540d498957859296da7bbb6b8f0fa9ad08bdc95e;加上我的變異設定檔後 3ff277766ad091721600e9f2abaaca4863630abb(筆電與 i9 相同);沒有 .env
- 日期:2026-10-27
- 實作者:opencode + grok-4.7,花費 $3.2266(預算 $2,1.61 倍,沒超過 2 倍,只記錄)
- 重活在 i9;筆電只做改壞迴圈

## 結論

**通過,沒有阻擋項。** 形狀嚴格度那幾條(時間格式、雜湊格式)實作有做,但測試沒守,記為低優先的測試缺口(協調者已決定不要求)。

## 測試作者與範圍

實作 commit 只動 3 個檔(provisional-queue.ts 新、llm/index.ts 加匯出、工單報告),沒有任何 .test.ts、步驟檔、.feature、契約檔;測試與三個步驟檔的轉接來自起點的紅測試 commit。router.ts、router-impl.ts、router-gateway.ts、routing.ts、fallback.ts、spend.ts 對起點比 diff:零行。進歷史的變異工具輸出檔數:0。

## 驗收條件整表(i9,簽出沒有 .env)

| 層 | 結果 |
|---|---|
| 單元:packages/core/src/llm/(19 檔) | **713/713 全綠**(含補的 O18 那條) |
| typecheck | 過 |
| boundaries | 過(掃 400 個檔),例外條數不變 |
| json-duplicate-keys | 過(掃 44 個,比平常多的一個是我的變異設定檔) |
| doc-links | 過(對驗收簽出跑過) |
| cucumber @llm-router 且 @phase-3 | **8/8** |
| cucumber @llm-router 且 not @manual(含 phase-3 的 8 個與 phase-4 等) | **52/52**(假 fetch 沒有外洩到同一行程裡的別的場景) |
| 三句轉接影響的 tag:@grading 且 @phase-2 | 9/9(與紅測試核對時的基底一樣) |
| @review-cli 且 @phase-2 | 13/13(一樣) |
| @integration 且 @i1 | 8/8(一樣) |
| @grading(整個,not @manual and not @llm) | 38 場景:1 失敗、8 undefined、29 過(與基底、與紅測試分支一模一樣,既有的,不是 T59) |
| --dry-run | 0 個 ambiguous,undefined 場景 67(與紅測試分支一樣) |

## 變異(npm run mutate,Stryker CLI)

設定檔 stryker.t59-provisional-queue.json,mutate 放整個 provisional-queue.ts,測試範圍是 provisional-queue.test.ts(場景那邊的 8 條另由 cucumber 守)。

| 檔 | 分數 |
|---|---|
| provisional-queue.ts | **91.89%**(111 個變異,100 殺、2 逾時、9 活) |

存活逐條:

| 位置 | 改了什麼 | 判斷 |
|---|---|---|
| 第 36 行 | queued_at 的時間格式:不要求時區偏移(兩個變異) | **測試缺口(形狀嚴格度)**,實作有做:沒有「queued_at 不是時間或沒帶時區就當壞檔」的測試 |
| 第 37 行 | local_sha256 的格式檢查拿掉開頭或結尾的錨(兩個變異) | **測試缺口(形狀嚴格度)**:沒有「雜湊太長或前後多字」當壞檔的測試 |
| 第 59 行 | 雜湊的編碼參數改成空字串 | 等價:字串輸入預設就是 UTF-8 |
| 第 91 行、第 116 行 | 沒給 maxTokens 時也多設一個值為 undefined 的 max_tokens 鍵 | 等價於檔案內容:JSON 寫檔會丟掉 undefined 的鍵;只有直接比 list() 回傳物件的 `in` 才看得出來,沒有測試這樣比 |
| 第 100 行 | 解析時 catch 區塊清空 | 等價:空 catch 之後 undefined 一樣驗不過,結果一樣回壞檔 |
| 第 181 行 | 讀檔的編碼參數改成空字串 | 等價:讀出 Buffer,JSON.parse 一樣接得住 |

## 自選改壞(23 個,丟棄式,每個改完還原,跑 40 條單元)

| # | 改了什麼 | 結果 |
|---|---|---|
| A1 | max_tokens 任何數字都收 | **活**(形狀嚴格度,見上) |
| A1b | max_tokens 收小數 | **活**(同上) |
| A2 | queued_at 任何字串都收 | **活**(同上) |
| A2b | queued_at 不要求時區 | **活**(同上) |
| A3 | sha 任何字串都收 | **活**(同上) |
| A3b | sha 收大寫 | **活**(同上) |
| A4 | task 任何字串都收 | 紅 1 條 |
| A5 | card 任何字串都收 | 紅 1 條 |
| A6 | 備份名的時間不先正規化成 UTC | **活**:測試只用 UTC 的 now(),沒有帶時區偏移的輸入。低優先 |
| A7 | enqueue 不去重 | 紅 3 條 |
| A8 | 新項目放最前面 | 紅 3 條 |
| A10 | resolve 記的 changed 反過來 | 紅 1 條 |
| A13 | 壞檔的 warning 沒有備份檔名 | 紅 7 條 |
| A16 | 撞名計數從 -3 開始 | 紅 1 條 |
| A17 | 備份名的毫秒保留小數點 | 紅 8 條 |
| A18 | 包裝 router 不帶 maxTokens | 紅 1 條 |
| A19 | warning 的 ts 用牆上時鐘不用注入的 now() | 紅 8 條 |
| A20 | provisional_resolved 的 ts 用牆上時鐘 | **活**:測試只斷言 ts 是字串。低優先 |
| A21 | 離線的 drain 也讀檔 | 紅 1 條 |
| A22 | 寫檔加縮排 | **活**:佇列檔格式沒被釘(場景與單元都比解析後的內容與「位元組前後一樣」,不比排版)。無害 |
| A23 | 複製項目時丟掉 max_tokens | 紅 1 條 |
| A24 | resolve 找不到那一筆也記事件 | 紅 1 條 |

(含 O18:resolve 的鍵是 card 加 task——補的那條 713 內已綠;我上次的 O18 改壞在紅測試核對時已證實活,這次起點已補。)

23 個裡 16 個紅、7 個活;7 個活全是測試缺口(形狀嚴格度 6 個——A1、A1b、A2、A2b、A3、A3b;時間欄位 2 個——A6、A20;排版 1 個——A22,無害),沒有實作錯誤。

## 其他檢查

- 證據與報告沒有 learning 或 raw 的真實檔名。
- 開發 worker 的報告「待協調」寫「無」,與我的驗證一致。
- 沒有呼叫端接上(工單 D1 乙):recordProvisional 只被測試用,符合範圍。

## 資料前後與副作用

learning/:檔案數 64、整體雜湊 01d84e9c918e1cf4、帳本 111 行;前後相同。i9 的 ~/.cache/llm-learning-cards 整個跑法前後都是 54。測試與場景只寫 mkdtemp 暫存目錄。

## 花費

實作者 $3.2266 / 預算 $2 = 1.61 倍(沒超過 2 倍)。LLM(產品用)0。驗收的 i9 CPU:單元、守門、cucumber 六個 tag、變異(第一次我的設定檔寫法有誤沒跑起來,第二次完整)。
