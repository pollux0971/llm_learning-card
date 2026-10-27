# 驗收證據:T62 實作

- 工單:T62(scripts/ingest.ts 的真呼叫改走驗證過的帳本與當日上限,契約 §12)
- 被驗:實作分支 48b8af2ce57e69ff9b11071d0b099967e5f3a839(1 個 commit),起點 t62-start(main 91d5549 + 紅測試 t62-red2 bc32972)
- 驗收用簽出的 tree sha:實作 fadd13fb72db9291d36c2df5163e552757c646a1;加上我的變異設定檔後 7c1e128900c230bd6bc4f49e84360c3a0b75e2fa(筆電與 i9 相同);沒有 .env
- 日期:2026-10-27
- 實作者:opencode + grok-4.7,花費 $2.5494(預算 $2,1.27 倍,只記錄)
- 重活在 i9;筆電只做靜態守門的合併狀態檢查與呼叫端掃描。不帶 --fake 的 scripts/ingest.ts 一律照煞車三條件跑:簽出沒有 .env、帶 _fake-cloud.mjs、XDG 指暫存;沒有手動打真網路。

## 結論

**通過,沒有阻擋項。** 三個測試缺口(不擋):掃描與單檔路徑的 settings.yaml 仍從 --out 讀、lazy router 轉交 call 的 opts,都沒有測試守。

## 測試作者與範圍

實作 commit 只動 3 個檔(scripts/ingest.ts、packages/core/src/ingest/ingest.ts、工單報告),沒有任何 .test.ts、步驟檔、_fake-cloud.mjs、.feature、契約檔;測試來自起點的紅測試 commit。contracts、docs、prompts、packages/core/prompts、features、packages/core/src/llm、prompt-quality、scan.ts、topic.ts、scripts/grade.ts、scripts/review.ts、scripts/llm.ts 對起點比 diff:除了工單報告一個檔,零行。進歷史的變異工具輸出檔數:0。scripts/ingest.ts 不再 import LlmRouterImpl,也沒有任何 new LlmRouterImpl。

## 驗收條件整表(i9,簽出沒有 .env)

| 層 | 結果 |
|---|---|
| 單元:ingest 資料夾 + llm 資料夾 + T61/T62 的 CLI 與守門測試 + 向量與 T58 守門(61 檔) | **1387/1387 全綠** |
| typecheck | 過 |
| boundaries | 過,例外條數不變 |
| json-duplicate-keys | 過(多算一個是我的變異設定檔) |
| doc-links | 過(對驗收簽出跑過) |
| **顧問要的:外面的 XDG_CONFIG_HOME 是空的暫存目錄(mktemp -d)包住整個測試行程**:T62 新測試 + ingest 資料夾裡起 CLI 的 7 個測試檔(cli、t53-cli、t55-topic-cli、t55-topic-failures、ingest-category、t53-scan-buckets,加 T61 的 CLI 測試) | **8 檔 109/109 全綠**:代表每一條都自己指了 XDG,沒有靠機器上的指標檔 |
| 同樣的空 XDG 包住 cucumber @ingest-pipeline | **37/37** |
| 同樣的空 XDG 包住 cucumber @integration 且 @i2 | **13/13**(i2-review-loop.steps.ts 不用改) |
| 同樣的空 XDG 包住 cucumber @i1 | **78/78** |
| /tmp 殘留 | 跑完 /tmp 沒有留下 lc-xdg 暫存指標目錄(紅測試補的 cleanupTmps 有效) |

## 帳本汙染檢查(npm run check:test-ledger)

做法:整套 vitest(281 檔)前後比帳本行數。i9 的原指標指到 ~/lc-empty-learning,那裡沒有 state/log.jsonl,所以原環境會是 UNKNOWN(不算過)。我改用暫存指標檔指到一個暫存學習資料夾,裡面放一個零行的 state/log.jsonl,不動 ~/lc-empty-learning。

- 第一次:整套 7381 條過、1 條失敗,gate 紅(帳本行數 0 變 0,沒有汙染)。失敗的是 scripts/degraded-report.test.ts 一條(自己起 vitest 子行程,比對輸出裡的「Test Files 1 passed」,我這個 ssh 環境的子行程輸出帶 ANSI 色碼所以比對不到)。**起點 t62-start(沒有 T62)同一條也紅**;設 NO_COLOR=1 該檔 81/81 全綠。與 T62 無關。
- 用 NO_COLOR=1 重跑整套:`gate=ledger-pollution result=PASS`,**帳本行數相同:0**。

## 變異(npm run mutate,Stryker CLI)

設定檔 stryker.t62-ingest-ledger.json:mutate 放 packages/core/src/ingest/ingest.ts 的 catch(第 84 到 100 行)與 isBudgetExceededError(第 195 到 205 行)。scripts/ingest.ts 是 CLI 入口,依工單由 CLI 測試守、不跑變異。測試範圍:t62-budget-exhausted、t61-bad-model-output、ingest、ingest.regenerate、t53-scan-extra。

| 檔 | 分數 |
|---|---|
| ingest.ts(那兩段) | **93.62%**(47 個變異,44 殺,3 活) |

存活逐條:第 96 行拿掉第一行的 trim(等價,T61 已說明)、第 96 行預設字串(等價)、第 200 行 `typeof err === 'object'` 檢查改永遠成立(等價:非物件取 code 是 undefined,結果一樣)。

## 改壞證明(自選 11 個,丟棄式,每個改完還原,跑 T62 的 CLI/守門/預算單元 + T61 CLI,共 32 條)

| # | 改了什麼 | 結果 |
|---|---|---|
| M1 | 帳本解析挪到 ensureInitialized 之後 | 紅 2 條 |
| M2 | 拒絕的退出碼改成 1 | 紅 6 條 |
| M3 | 掃描一開始就急著解析帳本 | 紅 2 條(只標 stale 與已生成過的主題) |
| M4 | router 的帳本改指 --out | 紅 1 條(llm_call 位置那條) |
| M5 | 拿掉預算分支 | 紅 5 條 |
| M6 | 預算分支改看類別名 | 紅 2 條 |
| M7 | --fake 也要求帳本 | 紅 3 條 |
| M9 | 掃描用的 lazy router 忽略 --out 的 settings.yaml | **活**:測試缺口,沒有測試證明掃描路徑仍讀 --out 的 settings.yaml(工單 D3) |
| M10 | lazy router 丟掉 call 的 opts | **活**:測試缺口,maxTokens 轉交沒測 |
| M11 | 預算用完的退出碼改成 0 | 紅 2 條 |
| M12 | 拒絕訊息印 stdout 不印 stderr | 活:輸出是合併檢查的,等價 |
| M13 | 單檔路徑的 router 忽略 --out 的 settings.yaml | **活**:同 M9 的測試缺口 |

11 個裡 8 個紅、3 個活的測試缺口(M9、M10、M13)加 1 個等價(M12);沒有實作錯誤。建議之後補:放一份 --out/config/settings.yaml 指定 model,看真呼叫用它;以及 maxTokens 轉交。

## 靜態守門:golden-run.ts 例外清單狀態

紅測試的靜態守門把 golden-run.ts 列為「T63 修好就拿掉」的例外。T63 已合進 main。我實測了合併後的狀態(目前 main + 這張的 scripts/ingest.ts + T62 守門檔):

- golden-run.ts 已經沒有 new LlmRouterImpl;守門 7/7 過(這條例外沒有命中,但設計上不會因此紅)。
- **建議拿掉那條例外。** 但守門檔自己有一句斷言「這個例外的理由要寫『T63 修好就拿掉』」(檔案裡 ALLOWED 的 golden-run.ts 條目、頭註解第 7 行、以及測試裡的 toContain 斷言),只拿 ALLOWED 的條目會讓那條測試紅。要由測試作者一起改:刪條目、刪那句斷言、改頭註解。我把條目拿掉試過:7 條裡 1 條紅(就是那句斷言),證實要一起改。
- 非測試檔 new LlmRouterImpl / new CloudLlmRouter(含 .mjs/.js、scripts、packages、apps):在 t62-impl 只剩 router-gateway.ts、router-impl.ts(組合)和 golden-run.ts(T63 已在 main 修掉);三個 _fake-*.mjs 假雲端檔不建 router。

## 其他檢查

- 證據與報告沒有 learning 或 raw 的真實檔名。
- 開發 worker 的報告「待協調」寫「無必須改的」;兩處註解(_fake-cloud.mjs 與 ingest-pipeline.steps.ts)仍寫 CLI 自己 new LlmRouterImpl,屬受保護檔,由協調者請測試作者改,與我的驗證一致。

## 資料前後與副作用

learning/:檔案數 64、整體雜湊 01d84e9c918e1cf4、帳本 111 行;前後相同。筆電的 ~/.cache/llm-learning-cards 前後都是 497。i9 的 ~/.cache/llm-learning-cards 在我的 cucumber @integration 且 @i2 跑完增加(既有行為,每跑一次約多 6 個資料夾,不是 T62 新測試造成);T62 的新測試與 CLI 測試都用暫存 HOME 與 XDG_CACHE_HOME。i9 的 ~/.config/llm-learning-cards 前後不變。

## 花費

實作者 $2.5494 / 預算 $2 = 1.27 倍(沒超過 2 倍)。LLM(產品用)0。驗收的 i9 CPU:單元、守門、空 XDG 的測試與 cucumber 三個 tag、變異、改壞、帳本汙染檢查兩次(第一次紅在無關的色碼問題)。
