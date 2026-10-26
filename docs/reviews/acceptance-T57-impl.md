# 驗收證據:T57 實作

- 工單:T57(example 圍欄跟畫面一樣,契約 1.5.0、ADR-081)
- 被驗:實作分支 b21db5f36b8571612f159f2a1b594ad7ec9dfe3a(1 個 commit),起點 ca9ee2726a2139ab528a1adedced467677cf4745(main + 契約 1.5.0 + ADR-081 + 紅測試,含兩列新向量)
- 驗收用簽出:實作 tree 93c3457d755143aa2101c98d13f7467a9941461c;加上我的變異設定檔後 tree ee317e94a6339b780719c059e04a1aee20728f8c(單元、畫面、守門、cucumber 用這個);最後設定檔改過一次的 tree ac8745b5427b45879173bccb15761d2b8c8463a6(最後一次變異用這個)。筆電與 i9 的 tree 相同,沒有 .env
- 日期:2026-10-27
- 實作者:opencode + grok-4.7,花費 $3.18(預算 $3,1.06 倍,只記錄)
- 重活在 i9;筆電只做單檔 vitest、改壞迴圈、真資料與 golden 重算、doc-links

## 結論

**通過,沒有阻擋項。** 一個小缺口(不擋,在向量檔,見自選改壞 E10)。

## 測試作者

實作 commit 只動 8 個檔,沒有任何 .test.ts、features、向量檔、契約檔、契約 docs。「不動的地方」那條 diff 只有工單報告 docs/reviews/T57-implementation.md 一個檔(報告本身,預期內)。進歷史的變異工具輸出檔數:0。

## 範圍

8 個檔都在工單 touches 內:card-markdown.ts(新,落點 contracts)、core 的 example-fence.ts(換成只用 md.parse)、ui-shared 的 example-fence.ts(刪 fenceLang、改用 isExampleFence 與 CARD_MARKDOWN_OPTIONS)、兩個 vite.config.ts 各加一條 @contracts 別名、package.json 釘 15.0.1、package-lock.json、報告。lockfile 只動根套件宣告那一行(^15.0.1 變 15.0.1),markdown-it 的 node_modules 那段一個字不變,lockfile 裡只有一份。

## 驗收條件整表(i9)

| 層 | 結果 |
|---|---|
| 單元:core + contracts + 跨實作 + 守門 + scripts/lint.test.ts(134 檔) | **3002/3002 全綠** |
| 畫面單元:ui-shared + teach-card + test-card(48 檔) | 第一次 1150/1151:真 Chrome 的 T35 一條「捲到底不蓋」等不到頁面載入事件,逾時 180 秒。單獨重跑該檔 21/21 全綠。起點基底的同一批是全綠;判斷為真 Chrome 的偶發逾時,不是 T57(該檔不碰圍欄) |
| typecheck | 過 |
| boundaries | 過(掃 395 個檔),例外條數不變 |
| json-duplicate-keys | 過(掃 42 個,比平常多的一個是我的變異設定檔) |
| build:frontends(兩個 app) | 都建得出來,@contracts 別名生效 |
| cucumber @data-layer | 88/88 |
| cucumber @prompt-quality | 37/37 |
| cucumber @ingest-pipeline | 37/37 |
| cucumber @teach-card | 24/24 |
| cucumber @i1 | 78/78 |
| cucumber @lint | 24 個場景:14 過 / 10 undefined。跟起點一樣,是 09-lint phase-2 步驟還沒寫,不是 T57 造成的 |
| lockfile | 只有那一行 |
| 舊向量對照表核對 | 守門測試裡那條核對在上面 3002 條內,全綠 |

## golden 離線重算與真資料

- golden:42 筆輸出(跟 T52 同一個腳本與算法),有存結構結果的 39 筆起點與實作都 0 筆不同;沒存的 3 筆新舊雜湊一樣。
- 真資料(25 張卡,唯讀,用自己的簽出跑):字數、example 個數、body 雜湊、examples 雜湊、錯誤數,起點與實作逐張比:**25 張全部相同**。

## 變異(npm run mutate,Stryker CLI)

設定檔 stryker.t57-example-fence.json,mutate 放 schema 的 example-fence.ts 與 contracts 的 card-markdown.ts。測試範圍:parse-card、validate-card、validate-card.contract-vectors、validator-min、lint 的 checks 與 index、向量跨實作測試、守門測試;守門測試裡「core 白名單」那一條用名稱排除,因為變異沙盒會在檔案裡插入追蹤呼叫,靜態的型別檢查一定紅(起始乾跑會被擋),它守的是原始碼而不是行為。

| 檔 | 分數 |
|---|---|
| example-fence.ts | **87.30%**(63 個,55 殺,8 活) |
| card-markdown.ts | **90.91%**(11 個,10 殺,1 活) |
| 合計 | 87.84% |

(第一次跑我漏了守門測試,card-markdown.ts 只有 54.55%;那是我的測試範圍設定不對,不是實作問題。加回後重跑的結果是上表。)

存活逐條:

| 位置 | 改了什麼 | 判斷 |
|---|---|---|
| card-markdown 判斷 | 切開用 \s 代替 \s+ | 等價:只取第一段,連續空白多切幾個空段不影響第一段 |
| example-fence 切行 | 迴圈條件改小於等於 | 等價:多一行空行,最後 trim 吃掉 |
| example-fence 切行 | 字串預設值改成別的字 | 等價:parts[i] 永遠有值 |
| example-fence 前綴 | 條件改成「有波浪號就用波浪號」 | **真缺口(測試),實作是對的**。反引號圍欄的資訊字串若含波浪號(例如反引號 example 後接 a~b),改壞版會把資訊字串留在 body。向量檔沒有這種列。見 E10 |
| example-fence 前綴 | 小於改小於等於 | 等價:同一位置不會同時是兩種字元 |
| example-fence 過濾 | 拿掉 type 是 fence 的判斷 | 等價:只有 fence 的資訊字串非空 |
| example-fence | 拿掉 map 為空的防呆 | 等價:fence 一定有 map |
| example-fence | 開始行存在的防呆 | 等價:map 指到的行一定存在 |
| example-fence | 被拿掉行存在的防呆 | 等價:同上 |

## 改壞證明(31 個,丟棄式,每個改完還原)

跑向量跨實作測試 + 守門測試 + core 的 schema 與 contracts 的單元。工單列的那串全做了(T1–T12),自選 12 個(E1–E12)。

| # | 改了什麼 | 結果 |
|---|---|---|
| T1 | 解析前不 trim | 紅 7 條 |
| T2 | 開始行整行拿掉(不留前綴) | 紅 9 條 |
| T3 | examples 用原文的行切出來,不用 token.content | 紅 4 條 |
| T4 | body 用 LF 接回去 | 紅 3 條 |
| T5 | 前綴只找反引號(波浪號圍欄整行留下) | 紅 8 條 |
| T6a | 判斷先轉小寫 | 紅 11 條 |
| T6b | 判斷先解 HTML 實體 | 紅 11 條 |
| T6c | 只用半形空白切 | 紅 11 條 |
| T7a | core 的 md 加 ruler.at 沒帶 alt | 紅 10 條 |
| T7b | core 的 md.options.maxNesting 設 1 | 紅 11 條 |
| T7c | 同一行加在畫面的 createMarkdownRenderer | 紅 3 條(執行時護欄) |
| T7d | 同一行加在畫面的 installAssetImages | 紅 1 條(畫面靜態守門) |
| T8a | 畫面 createMarkdownRenderer 加 md.set({ maxNesting: 5 }) | 紅 3 條 |
| T8b | 同一行加在 installAssetImages | 紅 1 條 |
| T9 | package.json 改回範圍 | 紅 1 條 |
| T10 | card-markdown 加一行 import zod | 紅 2 條 |
| T11a | core 自己加 info.trim() 比 example | 紅 12 條 |
| T11b | 畫面自己加同樣的比較 | 紅 3 條 |
| T12a | 判斷改成 startsWith | 紅 12 條 |
| E1 | token.map 結束行少一行 | 紅 13 條 |
| E2 | examples 不 trim | 紅 10 條 |
| E3 | 最後的 body 不 trim | 紅 7 條 |
| E4 | 切行只認 LF | 紅 9 條 |
| E5 | 只處理第一個 example 圍欄 | 紅 11 條 |
| E6 | examples 去重 | 紅 4 條(這就是紅測試補上的兩列接住的) |
| E7 | 選項沒凍結 | 紅 1 條 |
| E8 | 畫面關掉縮排程式碼規則 | 紅 2 條 |
| E9 | 前綴多留一個字元 | 紅 7 條 |
| E10 | 前綴:有波浪號就用波浪號(不看誰在前) | **活**,見上表:向量檔缺「反引號圍欄資訊字串含波浪號」那一列。實作是對的,我用實作與改壞版各跑一次確認:實作的 body 正確,改壞版留下 example 字樣 |
| E11 | 空內容的 example 不算 | 紅 9 條 |
| E12 | test-card 的 vite.config.ts 拿掉 @contracts 別名 | 紅 1 條 |

31 個裡 30 個紅、1 個活(E10,測試缺口,建議加一列:反引號 example 圍欄,資訊字串帶波浪號,例如 example a~b,期望字數 2、examples 一個、strippedBody 為前後兩個字)。

## 其他檢查

- 證據與報告沒有 learning 或 raw 的真實檔名。
- 開發 worker 的報告「待協調」寫「無」,與我的驗證一致。

## 資料前後

learning/:檔案數 64、整體雜湊 01d84e9c918e1cf4、帳本 111 行;前後相同。

## 花費

實作者 $3.18 / 預算 $3 = 1.06 倍(沒超過 2 倍)。LLM(產品用)0。驗收的 i9 CPU:單元、畫面、build、cucumber 六個 tag 各一次,變異三次(第一次範圍設錯、第二次乾跑被擋、第三次完整)。

## 補驗:E10 向量補列(紅測試分支補了一列之後)

- 驗收簽出 tree 448caad55dd8373b48ae509852c5fbf4597528c1(實作 + 驗收證據 + 補的那一列)。
- 向量檔新列「fence: tilde inside a backtick fence info string」:body 手算:反引號圍欄、資訊字串 example a~b 是 example,拿掉後剩「前」「後」2 個字,strippedBody 是前、兩個換行加空行、後,對。
- 向量跨實作測試 + 守門測試 2 檔 63/63 全綠。
- E10 改壞版(前綴「有波浪號就用波浪號」)套上去:9 條轉紅,失敗訊息都帶新列名,例如「fence: tilde inside a backtick fence info string」字數 4,該是 2;以及同一列的 body 留下 example 字樣,與該有的 body 不同。還原後 63/63 綠。
- 結論:E10 缺口已補,且補得接得住。
- learning/ 前後:64 / 01d84e9c918e1cf4 / 111 不變。
