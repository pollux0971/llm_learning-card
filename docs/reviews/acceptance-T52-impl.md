# T52 實作驗收(證據)

- 工單:T52(字數規則只留一份實作,所有實作跑同一份向量檔)
- 被驗分支:t52-impl = b515b2cdb1b4e7da7da0e89eb41d26f9681904f7,起點 t52-start = 94a7eb5ab60705b291cc8cb1cf1352dd58597da7
- 驗的樹 = t52-impl + t52-red3(5b9de405…,只改 features/support/t31-static.test.ts,例外條數 24→25)+ 驗收用變異設定檔。tree sha(筆電與 i9 相同):bb904055365dac76ad42fb176749ce527e92b14b;沒有 .env
- 日期:2026-10-27
- 重活(單元、cucumber、變異)在 i9 跑;golden 重算、真資料、改壞在筆電跑。i9 中途重開機一次,整批重跑,以下是重跑後的結果

## 結論

**通過**。沒有阻擋項。有 2 件事要協調者知道(第 5、第 9 節),都不是實作缺陷。

## 1. 測試作者與範圍

- t52-start..t52-impl 只有 1 個 commit、14 檔。沒有任何 *.test.ts、contracts、prompts、.feature、向量檔被動到。
- 14 檔除了報告 docs/reviews/T52-implementation.md,全部在工單 touches 內。
- 不動的地方(工單驗收表最後一列的 diff 指令)沒有輸出。
- 圍欄 regex 一個字沒改:新檔裡的那一行跟起點 parse-card 的那一行相同。
- 測試作者:t31-static 那個 commit 是測試 agent 的(red3),實作者沒碰測試。

## 2. 單元層(i9)

| 指令範圍 | 結果 |
|---|---|
| 工單單元那一列的全部目錄與檔,再加 teach-card 的 fixture-data 測試 | 109 檔 / 2169 條全綠 |
| 釘住 allow 的測試(git grep 列出 5 檔:desktop review-client、test-card 兩檔、t31-static、check-boundaries) | 5 檔 / 332 條全綠(含 red3 改的 t31-static) |

## 3. 守門(i9)

| 指令 | 結果 |
|---|---|
| typecheck | 通過,無輸出 |
| boundaries | 無違規,掃 397 檔;例外條數 24 → 25(+1) |
| check:json-duplicate-keys | 通過,41 個 JSON |
| doc-links | 在這棵樹上紅 1 條:工單檔第 42 行的反引號路徑指到被刪的 ui-shared word-count 檔。照協調者說的,在合併批次改工單文字處理;我把那一處暫時改成不帶反引號再跑:166 條連結全過;改完已還原,樹乾淨 |

## 4. 不退步的 cucumber(i9)

| tags | 結果 |
|---|---|
| @data-layer and not @manual | 88 場景全過,351 步全過 |
| @prompt-quality and not @manual and not @llm | 37 場景全過,151 步全過 |
| @i1 and not @manual and not @llm and not @e2e | 78 場景全過,329 步全過 |
| @lint and not @manual | 24 場景:14 過、**10 undefined**(09-lint phase-2 的場景,步驟定義還沒寫) |

@lint 那 10 條 undefined 在起點 t52-start 上一模一樣(同一批 10 條,24 場景 / 14 過 / 10 undefined,96 步 36 undefined),所以**不是 T52 造成的**,是既有狀況。工單寫的「全綠」對這個 tag 本來就達不到;建議協調者驗收時把這個 tag 的標準寫成「跟起點相同」。

## 5. golden 離線重算

丟棄式腳本(不進 git):對存著的 golden 輸出(golden 與 fixtures 底下共 42 筆,有 text 與 id 的)用新程式重跑結構檢查。

- 39 筆有存著的結構檢查結果:新程式重算 **0 筆不同**。
- 另外 3 筆沒存結果:我用起點程式與新程式各算一次,輸出雜湊兩邊相同。
- 另有 24 筆是模型回應替身檔(不是 golden 輸出),不在比對範圍。
- LLM 呼叫 0,沒跑 live golden。

## 6. 真資料(只讀,只記數字)

對真的 learning/cards 25 張卡,各算三個數字:T52 之前 lint 的字數(起點樹)、T52 之後 lint 的字數、validateCard 的字數,另比 example 個數。結果:**25 張全部相同,0 張不同**;example 個數也是 25 張全相同。

## 7. 變異(i9,Stryker CLI,設定檔 stryker.t52-word-count.json)

測試範圍:schema 的五個測試檔、lint 的 validator-min、checks、index 測試、新向量測試檔。

| 檔 | 變異數 | 殺 | 存活 | 分數 |
|---|---|---|---|---|
| schema/example-fence.ts | 25 | 24 | 1 | 96.00% |
| schema/word-count.ts | 28 | 28 | 0 | 100% |
| schema/parse-card.ts | 5 | 5 | 0 | 100% |
| lint/validator-min.ts | 2 | 2 | 0 | 100% |
| 全部 | 60 | 59 | 1 | 98.33% |

每檔都 ≥ 80%。**存活的 1 個是等價變異**:結束行後面的前瞻 (?=\r?\n|$) 被改成 (?=\r\n|$)。正則帶 m 旗標,$ 本來就匹配 LF 之前,所以單獨的 LF 結尾仍然成立,CRLF 由 \r\n 匹配,行為不變。

備註:validator-min 只剩 2 個可變異的地方(其餘都搬走了),這是正常的。

## 8. 改壞證明(筆電,每次只改一處,只跑新向量測試檔,改完還原,樹乾淨)

| # | 改了什麼 | 結果 |
|---|---|---|
| E1 | prompt-quality 的轉 export 換回舊檔 | 紅 2:prompt-quality 那一列、指紋掃描 |
| E2 | prompt-quality 的 CJK 換回區段版(圍欄仍用 01) | 紅 2:prompt-quality 那一列、指紋掃描 |
| E3 | stripExampleFences 的 body 不 trim | 紅 3 |
| E4 | examples 順序反 | 紅 3 |
| E5 | examples 不 trim | 紅 3 |
| E6 | lint checks 的字數換成另一條算法 | 紅 1:lint 回報字數那條路 |
| E7 | 沒登記的檔加 Script=Han | 紅 1(掃描) |
| E8 | 沒登記的檔加圍欄 regex | 紅 1(掃描) |
| E9 | ingest siblings 換回自己的 regex | 紅 1(掃描) |
| E10 | lint 的 parseCard 把 Date 變字串 | 紅 1(lint 護欄) |
| E12 | 向量檔 U+F900 改成 U+8C48 | 紅 1 |
| E13 | parseCardText 的 body 不走 stripExampleFences | 紅 2 |
| E14 | structural-checks 的 normalizeBody 換回舊 regex | 紅 1(掃描) |
| F1 | countBodyWords 不拿掉圍欄 | 紅 4(含 countBodyWords、lint、prompt-quality、一致性) |
| F2 | 向量檔刪一列 | 紅 4(列數、covers 等) |

15 個全紅,沒有存活。工單「改壞證明」八條全涵蓋:轉 export 換回舊檔(E1)、CJK 換回區段(E2)、body 不 trim 與 examples 順序反(E3、E4)、lint 另一份算法(E6)、沒登記的檔加 Script=Han 與圍欄 regex(E7、E8)、刪一列(F2)、U+F900 變 U+8C48(E12);「只跑前 10 列」在上一輪紅測試驗收已做(紅 10)。

## 9. 備註

- 實作跟我之前寫的丟棄式參考做法幾乎一樣:圍欄 regex 搬到 example-fence.ts,parse-card、validator-min、兩處舊 regex、轉 export 都照工單;lint 的 checks 用 countWords(body 已去圍欄)。
- 報告 docs/reviews/T52-implementation.md 說「沒跑變異、沒跑 cucumber」——那是驗收的事,正確。報告提到第一次單元跑有 3 條 hud 渲染逾時、隔離重跑全綠;我在 i9 的單元跑沒有逾時。
- 花費:worker 回報 $3.44,預算 $3,比值 1.15,沒超過 2 倍。
- 工單 touches 沒列報告檔,但報告是標準交件物,不算越界。

## 10. learning/ 前後(數字)

| | 檔案數 | 整體雜湊 | 帳本行數 |
|---|---|---|---|
| 前 | 64 | 01d84e9c918e1cf4 | 111 |
| 後 | 64 | 01d84e9c918e1cf4 | 111 |
