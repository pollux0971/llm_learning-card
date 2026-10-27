# 驗收證據:T58 實作

- 工單:T58(寫卡片時 example 圍欄的長度跟著內容走,ADR-082)
- 被驗:實作分支 8e63b9defdd2e5e57b18c22ee5982e3fa742d711(1 個 commit),起點 ba334e9(main + 紅測試 23cc69e)
- 驗收用簽出的 tree sha:實作 112340d9c8801383d5df162e4016f719d3fd1a23;加上我的變異設定檔後 968bb245c4508e72d2575679b2dbf3ead7dabd81(筆電與 i9 相同,單元以後各項都用這個);沒有 .env
- 日期:2026-10-27
- 實作者:opencode + grok-4.7,花費 $1.7476(預算 $1,1.75 倍,沒超過 2 倍,只記錄)
- 重活在 i9;筆電只做真資料與 golden 比對、改壞迴圈

## 結論

**通過,沒有阻擋項。** 一個測試缺口(不擋,見變異存活 S1):向量表沒有「同一個 example 裡有兩串反引號、第一串最長」或「第一串較短」的列,所以「取最後一串」「只看第一串」兩種寫錯的實作都抓不到。實作本身是對的(取最長)。

## 測試作者

實作 commit 只動 5 個檔(card-file.ts 新、children.ts、deps.ts、ingest.ts、工單報告),沒有任何 .test.ts、features、向量檔、契約檔;測試檔來自起點的紅測試 commit(測試作者的)。進歷史的變異工具輸出檔數:0。

## 範圍與呼叫端

- 4 個實作檔都在工單 touches 內;ingest.ts、deps.ts 直接用 card-file.ts,children.ts 從那裡 import 後再 export,topic.ts 與 deepen.ts 仍從 children.js 取,沒動。
- 實作者多匯出一個 exampleFenceLength(派工指令要的,工單寫私有);無害,導入守門與測試都不受影響。
- 呼叫端掃描(git grep 含 mjs、js、svelte、rs,排除測試):renderCardFile 的呼叫只有 card-file.ts 自己、children.ts、deps.ts、ingest.ts、topic.ts、deepen.ts;非測試檔裡沒有任何寫死「三個以上反引號接 example」的字串字面值(card-file.ts 用變數拼圍欄);scripts/check-doc-links.ts 的相關字樣只在註解裡。
- 副作用:實作 diff 沒有新增任何 fs 呼叫(寫檔的 writeFileSync、mkdirSync 都是原來就有的);card-file.ts 沒有 I/O。紅測試只寫暫存目錄(上一輪已核)。

## 驗收條件整表(i9)

| 層 | 結果 |
|---|---|
| 單元:core + contracts + 向量跨實作 + T57/T58 守門(136 檔) | **3024/3024 全綠** |
| typecheck | 過 |
| boundaries | 過(掃 398 個檔),例外條數不變 |
| json-duplicate-keys | 過(掃 43 個,比平常多的一個是我的變異設定檔) |
| cucumber @ingest-pipeline | 37/37 |
| cucumber @teach-card 且 @phase-3 | 8/8 |
| cucumber @i1 | 78/78 |
| cucumber @data-layer | 88/88 |
| doc-links | 過(對驗收簽出跑過) |

## 真資料與 golden(寫出的文字,舊寫法 vs 新寫法)

做法:丟棄式腳本,舊寫法 = T58 之前 renderCardFile 的原文(固定三個反引號),新寫法 = 實作的 renderCardFile;每張卡在記憶體裡各寫一次,逐字比對,不寫檔。

- 真資料(自己的簽出,唯讀):25 張卡,**0 張不同**;example 裡最長的反引號串是 1。
- golden:凡有 body 與 examples 的候選(我的走法把 golden 與 fixtures 底下所有 JSON 遞迴走過,含每筆輸出的 text 再解析):123 個候選、95 個 example,**0 個不同**;最長反引號串 1。工單寫的是 114 張與 94 個 example,數法不同(我連 fixtures 與 children、topic 的輸出都算),結論一樣:全部一字不差。

## 變異(npm run mutate,Stryker CLI)

設定檔 stryker.t58-card-fence.json,mutate 放整個 card-file.ts。測試範圍:card-file.test、t58-card-fence-wiring.test、children.test、ingest.test、deps.test、t58-card-file-guards.test。

| 檔 | 分數 |
|---|---|
| card-file.ts | **88.89%**(27 個變異,24 殺,3 活) |

存活逐條:

| 位置 | 改了什麼 | 判斷 |
|---|---|---|
| 最長一串的比較 | 條件改成永遠成立(每一串都覆蓋 n,結果是「最後一串」) | **S1,測試缺口,實作是對的**。沒有任何列同時有兩串反引號、而最後一串比前面最長的短 |
| 最長一串的比較 | 大於改成大於等於 | 等價:相等時取哪一串結果一樣 |
| 算圍欄長度時的 trim | 拿掉 trim | 等價:trim 不會改變反引號串;實際寫出時內容本來就已經 trim 過 |

## 改壞證明(自選 15 個,丟棄式,每個改完還原)

跑 ingest 資料夾全部單元 + T58 守門 + 向量跨實作測試(659 條)。這些都不在測試作者那串與工單那串裡。

| # | 改了什麼 | 結果 |
|---|---|---|
| C1 | 圍欄長度加 2 | 紅 15 條 |
| C2 | 最少改成 2 | 紅 24 條 |
| C3 | 各串長度加總(不取最長) | 紅 8 條 |
| C4 | 寫之前不 trim example | 紅 4 條 |
| C5 | 結束行少一個反引號 | 紅 37 條 |
| C6 | example 之間只空一行(單換行) | 紅 5 條 |
| C7 | 開始行反引號和 example 之間多一個空白 | 紅 33 條 |
| C8 | frontmatter 不 trimEnd | 紅 8 條 |
| C9 | 卡片 body 不 trim | 紅 4 條 |
| C10 | 少結尾換行 | 紅 8 條 |
| C11 | ingest.ts 寫卡時丟掉 examples | 紅 3 條 |
| C12 | deps.ts 改寫時只留第一個 example | 紅 1 條 |
| C13 | children.ts 寫卡時 examples 順序反過來 | 紅 1 條 |
| C14 | 長於三個時改用波浪號圍欄 | 紅 14 條 |
| C15 | 只看第一串反引號 | **活**(同 S1):沒有列的第二串比第一串長 |

15 個裡 14 個紅、1 個活(C15,與 S1 同一個缺口)。建議補兩列到表:(1) 一個 example 內容含「四個反引號串 … 三個反引號串」(最長在前),期望圍欄 5;(2) 「三個 … 四個」(最長在後),期望圍欄 5。補了之後 S1 與 C15 都會紅。

## 其他檢查

- 證據與報告沒有 learning 或 raw 的真實檔名。
- 開發 worker 的報告「待協調」寫「無」,與我的驗證一致。

## 資料前後

learning/:檔案數 64、整體雜湊 01d84e9c918e1cf4、帳本 111 行;前後相同。

## 花費

實作者 $1.7476 / 預算 $1 = 1.75 倍(沒超過 2 倍)。LLM(產品用)0。驗收的 i9 CPU:單元、守門、cucumber 四個 tag、變異各一次。
