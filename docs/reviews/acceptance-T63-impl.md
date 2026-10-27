# 驗收證據:T63 實作

- 工單:T63(live golden 有日上限,而且永遠不改走本機,ADR-083)
- 被驗:實作分支 86630179a5a011827fba931f3202f881d0420c59(1 個 commit),起點 t63-start(main + 紅測試 t63-red 95e6f50)
- 驗收用簽出的 tree sha:實作 eaecf9248f5873c924b9dd2028d898a429299ed6;加上我的變異設定檔後 cb4b5020e33b69ad04bf862023048153cb3cbe4a(筆電與 i9 相同);沒有 .env
- 日期:2026-10-27
- 實作者:opencode + grok-4.7,花費 $1.5945(預算 $1,1.59 倍,沒超過 2 倍,只記錄)
- 重活在 i9;筆電只做改壞迴圈。**沒有跑 live golden,LLM 0**:全部測試用假 fetch、暫存指標檔與暫存 HOME。

## 結論

**通過,沒有阻擋項。** 一個舊有的測試缺口(不擋,非 T63 新增):沒有測試證明預設 router 讀的 settings.yaml 來自 learningDir 參數(見 R13)。

## 測試作者與範圍

實作 commit 只動 3 個檔(golden-run.ts、cli.ts、工單報告),沒有任何 .test.ts、步驟檔、.feature、契約檔;測試來自起點的紅測試 commit。prompts、packages/core/prompts、packages/core/src/llm、contracts、scripts、golden 的登記表與 fixtures 對起點比 diff:零行。進歷史的變異工具輸出檔數:0。

## 驗收條件整表(i9,簽出沒有 .env)

| 層 | 結果 |
|---|---|
| 單元:prompt-quality 資料夾 + llm 資料夾 + scripts/prompt-check.test(40 檔) | **1128/1128 全綠**(含 t63 新檔 19 條與改過的 ADR-066 那條) |
| typecheck | 過 |
| boundaries | 過,例外條數不變 |
| json-duplicate-keys | 過(多算一個是我的變異設定檔) |
| doc-links | 過(對驗收簽出跑過) |
| cucumber @prompt-quality(not @manual and not @llm) | **37/37** |
| `npm run prompt:golden`(預設 --fake) | 退出碼 0;跑前跑後 `git status --short` 都是空的:**不改任何追蹤檔,也沒有多出未追蹤檔**(golden-fake 輸出不變) |
| 靜態:非測試檔還有沒有 `new LlmRouterImpl(` 或 `new CloudLlmRouter(` | 除了 T62 還沒合併的 scripts/ingest.ts 兩處,只剩 router-gateway.ts 與 router-impl.ts(組合);golden-run.ts 已經沒有。所以 T62 守門「golden-run.ts 的例外」(T62 與 T63 都合併後)可以拿掉;**T62 守門檔尚未進 main,合併後要核對例外清單沒有 golden-run.ts** |
| 副作用 | i9 的 ~/.cache/llm-learning-cards 前後 54、~/.config/llm-learning-cards 前後 1;測試只用暫存目錄 |

## 變異(npm run mutate,Stryker CLI)

設定檔 stryker.t63-golden-cap.json,mutate 放 golden-run.ts 改到的三段(新錯誤類別、runGoldenLive 的預算檢查、備援表與預設 router);測試範圍是 t63-golden-cap.test 與 live-run.test。

| 檔 | 分數 |
|---|---|
| golden-run.ts(改到的幾段) | **91.84%**(49 個變異,45 殺,4 活) |

存活逐條:

| 位置 | 改了什麼 | 判斷 |
|---|---|---|
| 第 73 行 | 錯誤類別的 name 改成空字串 | 無害的測試缺口:CLI 用 instanceof 判斷,沒有地方讀 name;沒有測試斷言 name |
| 第 467 行 | 建 state 資料夾的名字改成空字串 | 等價:建構 router 時 createLiveGatewayRouter 自己會建帳本所在的資料夾 |
| 第 474 行 | localProber 回的物件改成空物件(兩個變異) | 等價:預設 router 的 probeLocal 已固定回不可用、備援表全是 cloud-only,底層的本機探測用不到 |

## 自選改壞(17 個,丟棄式,每個改完還原,跑 t63 與 live-run 兩個檔共 50 條)

| # | 改了什麼 | 結果 |
|---|---|---|
| R1 | reteach.short 不是 cloud-only | 紅 1 條 |
| R1b | deepen 不是 cloud-only | 紅 1 條 |
| R2 | 備援表不凍結 | 紅 1 條 |
| R5 | 預算檢查挪到 probeOnline 之前 | 紅 1 條(離線優先那條) |
| R6 | 預算檢查整個拿掉 | 紅 4 條 |
| R7 | probeLocal 委派給閘道 router | 紅 1 條 |
| R8 | budgetExhausted 永遠回 false | 紅 3 條 |
| R9 | 不傳備援表(用預設表) | 紅 3 條 |
| R10 | 拿掉 localProber | **活**,等價(同上) |
| R11 | 預算訊息少了 LLM_DAILY_CAP_USD | 紅 1 條 |
| R12 | CLI 不處理預算錯誤 | 紅 1 條 |
| R13 | 預設 router 忽略 settings.yaml(settings 給空物件) | **活**:舊就有的測試缺口(所有測試都用環境變數設 provider/model,沒有測試證明 learningDir 決定讀哪裡的 settings)。不是 T63 新增,不擋 |
| R14 | 不建 state 資料夾 | **活**,等價(同上) |
| R15 | probeOnline 借道閘道的 probeLocal | 紅 3 條 |
| R16 | 錯誤類別 name 寫錯 | **活**(同上第 73 行,無害) |
| R17 | 預算訊息變兩行 | 紅 2 條 |
| R18 | 沒有 budgetExhausted 的 router 反而被當成預算用完 | 紅 13 條 |

17 個裡 13 個紅、4 個活(R10、R14 等價;R16 無害;R13 舊缺口),沒有實作錯誤。

## 其他檢查

- 證據與報告沒有 learning 或 raw 的真實檔名。
- 開發 worker 的報告「待協調」寫「無」,與我的驗證一致。
- 不動 prompts/,所以硬規則 4 不觸發,沒跑 live golden。

## 資料前後

learning/:檔案數 64、整體雜湊 01d84e9c918e1cf4、帳本 111 行;前後相同。

## 花費

實作者 $1.5945 / 預算 $1 = 1.59 倍(沒超過 2 倍)。LLM(產品用)0。驗收的 i9 CPU:單元、守門、cucumber 一個 tag、假 golden、變異各一次。
