# 驗收證據:T61 實作

- 工單:T61(ingest 遇到格式不對的模型回應,乾淨地失敗、一張都不寫)
- 被驗:實作分支 42bbab9c139c470b874d0c8524ac26b3dc7af93b(1 個 commit),起點 b6acd4f(main + 紅測試 3e6d511)
- 驗收用簽出的 tree sha:實作 bd4b823409328300e1f07dcf70012d978d605fbd;加上我的變異設定檔後 6a5c3d0114e37a93d06c16c20c0cd4f574fa08a6(筆電與 i9 相同);沒有 .env
- 日期:2026-10-27
- 實作者:opencode + grok-4.7,花費 $1.5379(預算 $1,1.54 倍,沒超過 2 倍,只記錄)
- 重活在 i9;筆電只做改壞迴圈與呼叫端掃描

## 結論

**通過,沒有阻擋項。** 兩個小測試缺口(不擋,實作是對的):子卡回應的 title 型別沒被測、regenerate 回應第 0 筆格式不正確沒被測(見變異存活與改壞 P15)。

## 測試作者與範圍

實作 commit 只動 5 個檔(errors.ts、generate-cards.ts、children.ts、ingest.ts、工單報告),沒有任何 .test.ts、features、向量檔、契約檔;測試來自起點的紅測試 commit(測試作者的)。進歷史的變異工具輸出檔數:0。4 個實作檔都在工單 touches 內。

## 呼叫端掃描(含 mjs、js、svelte、rs,排除測試)

- ModelResponseFormatError 只在 errors.ts(定義)、generate-cards.ts 與 children.ts(丟)、ingest.ts(接)。
- 解析函式的呼叫端:generateCards 只被 ingest.ts 呼叫(那個 catch 接);generateChildren 被 deepen.ts、generateChildrenForCards(ingest.ts、topic.ts 都呼叫)用;新類別是 Error 的子類別,這些呼叫端原本接一般錯誤的行為不變(deepen 對一般錯誤回失敗、topic 有自己的 topicCallFailed、runIngestPipeline 對子卡失敗記 warning 略過)。scripts 與 apps 沒有直接用到這些解析函式。

## 驗收條件整表(i9)

| 層 | 結果 |
|---|---|
| 單元:ingest 資料夾 + prompt-quality 資料夾 + 向量/T57/T58 守門 + T61 的 CLI 測試(62 檔) | **1144/1144 全綠** |
| typecheck | 過 |
| boundaries | 過(掃 399 個檔),例外條數不變 |
| json-duplicate-keys | 過(掃 44 個,比平常多的一個是我的變異設定檔) |
| doc-links | 過(對驗收簽出跑過) |
| cucumber @ingest-pipeline | 37/37 |
| cucumber @teach-card 且 @phase-3 | 8/8 |

煞車三條件(T62 合併前,不帶 --fake 的 scripts/ingest.ts 只能這樣跑):簽出沒有 .env(跑前 ls 確認)、一律帶 _fake-cloud.mjs、子行程的 HOME 與 XDG_CONFIG_HOME、XDG_CACHE_HOME 都指暫存。T61 的 CLI 測試由測試作者的共用 runner 起(內建三條件),@ingest-pipeline 的步驟也帶假雲端;i9 的 ~/.cache/llm-learning-cards 在整個跑法前後不變(52 個)。

真資料與 golden:T61 沒有改任何寫卡片的格式,LLM 0,不涉及比對;learning/ 前後見最後一節。

## 變異(npm run mutate,Stryker CLI)

設定檔 stryker.t61-bad-model-output.json:mutate 放 ingest.ts 的那個 catch(第 84 到 96 行)、generate-cards.ts 第 175 到 232 行、children.ts 第 104 到 127 行、errors.ts 新類別。測試範圍:t61-bad-model-output.test、ingest.test、ingest.regenerate.test、children.test、generate-cards.test、generate-cards.regenerate.test、t53-scan-extra.test。

| 檔 | 分數 |
|---|---|
| children.ts | **97.83%** |
| errors.ts | **100%** |
| generate-cards.ts | **98.53%** |
| ingest.ts | **86.67%** |
| 合計 | 96.95%(131 個變異,127 殺,4 活) |

存活逐條:

| 位置 | 改了什麼 | 判斷 |
|---|---|---|
| children.ts 第 122 行 | 子卡每一筆的 title 型別檢查拿掉 | **測試缺口,實作是對的**。紅測試只用 body 不是字串測子卡「欄位型別不對」,沒有 title 不是字串的列。建議補一列 |
| generate-cards.ts 第 230 行 | 重寫結果的 examples 判斷改成永遠成立 | 等價:examples 是 undefined 時多設一個值為 undefined 的鍵,讀的地方看不出差別 |
| ingest.ts 第 92 行 | 拿掉第一行的 trim | 等價於目前所有輸入:原本訊息的第一行尾端沒有空白;只在模型/JSON 錯誤訊息第一行尾端有空白時才有差,沒有測試輸入 |
| ingest.ts 第 92 行 | 預設字串改成別的字 | 等價:split 的第 0 項一定存在 |

## 改壞證明(自選 15 個,丟棄式,每個改完還原)

跑 ingest 資料夾裡 5 個相關測試檔(201 條)。這些都不在測試作者那串與工單那串裡。

| # | 改了什麼 | 結果 |
|---|---|---|
| P1 | 第 0 層解析:examples 的元素檢查拿掉 | 紅 3 條 |
| P2 | 子卡解析:元素檢查拿掉 | 紅 2 條 |
| P3 | 允許 examples 裡有 null | 紅 1 條 |
| P12 | 元素檢查的 every 改成 some(第 0 層) | 紅 25 條 |
| P12b | 同上(子卡) | 紅 11 條 |
| P4 | 訊息用整段,不只第一行 | 紅 2 條 |
| P5 | catch 改成接所有 Error | 紅 5 條 |
| P6 | 前綴字縮短 | 紅 9 條 |
| P8 | 退出碼改成 0 | 紅 9 條 |
| P9 | 類別 name 寫錯 | 紅 2 條 |
| P10 | regenerate 空陣列的錯誤改回普通 Error | 紅 1 條 |
| P11 | 子卡筆數錯誤改回普通 Error | 紅 1 條 |
| P14 | 訊息取第二行 | 紅 2 條 |
| P15 | regenerate「第 0 筆格式不正確」改回普通 Error | **活**:測試沒有 regenerate 回傳不是物件或 body 不是字串的列。建議補一列 |
| P16 | 子卡「不是合法 JSON」改回普通 Error | 紅 1 條 |

15 個裡 14 個紅、1 個活(P15,測試缺口)。

## 其他檢查

- 證據與報告沒有 learning 或 raw 的真實檔名。
- 開發 worker 的報告「待協調」寫「沒有」,與我的驗證一致。

## 資料前後

learning/:檔案數 64、整體雜湊 01d84e9c918e1cf4、帳本 111 行;前後相同。

## 花費

實作者 $1.5379 / 預算 $1 = 1.54 倍(沒超過 2 倍)。LLM(產品用)0。驗收的 i9 CPU:單元、守門、cucumber 兩個 tag、變異各一次。
