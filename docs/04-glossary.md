# 術語表

## 資料

| 術語 | 意思 |
|---|---|
| raw | 你放進來的原始素材。唯讀。 |
| 卡片 / card | 一個概念一張,LLM 產生的教學單位。body ≤ 100 字。 |
| body | 卡片正文,受字數限制的部分。 |
| example 圍欄 | ` ```example ` 區塊,放範例與圖片,不計字數,渲染為巢狀 markdown。 |
| level | 深度。0 = 從 raw 直接產生;1 = 預生的第二層;2+ = 按「深入這個」即時生成。 |
| prereqs | 先備概念,學這張之前建議先學的卡片 id。 |
| source | `raw`(從素材)或 `llm`(模型自身知識)。 |
| provisional | 本機模型在離線時產生或審核的結果,待雲端複審。 |
| stale | 來源 raw 已變更但卡片尚未重生。 |
| fixture | `contracts/fixtures/` 的共用測試資料。凍結。 |

## 複習

| 術語 | 意思 |
|---|---|
| stage | 0 新學未考,1 待 D1,2 待 D7,3 待 D30,4 待 D90,5 待 D180,6 歸檔。 |
| D1 / D7 / D30 / D90 / D180 | 距上次通過的天數,固定骨架的五個檢查點。 |
| 填空 / fill | 題型一,考回想。三層審核:精確、模糊、本機 LLM。 |
| 應用 / apply | 題型二,考遷移。LLM 依 rubric 逐條判斷。 |
| rubric | 應用題評分條目,2–4 條,各自 true / false,全 true 才過。 |
| 逾期比例 | 逾期天數 ÷ 該 stage 的間隔。決定每日上限內先考誰。 |
| stuck | 連續答錯 3 次以上,lint 會列出。 |
| 縮短版 / short | 連錯 2 次後重寫的 ≤ 50 字版本。 |
| learned | 在教學卡按下「下一個」的那一刻,進入排程。 |
| 週目標 | 本週通過 D1 的卡片數 ≥ target。滑過去不算。 |

## 架構

| 術語 | 意思 |
|---|---|
| contracts | 跨模組型別、格式、簽章、路由表 + 真的 fixture。平行開發的支點。 |
| 硬約定 | 磁碟格式與 `LlmTask`。改動需 ADR,因為會讓已產生的資料失效。 |
| 軟約定 | 記憶體介面。改了跑測試、更新 types.md、commit 說明理由即可。 |
| golden run | 用固定輸入跑一次 prompt、存下輸出、人打分數。讓 prompt 退化被看見。 |
| 組合層 | 把其他模組串起來的薄薄一層(`11-review-cli`)。不參與 Wave 0。 |
| llm-router | 所有 LLM 呼叫的唯一入口,依任務與網路狀態決定 provider。 |
| LlmTask | 契約定義的七種任務名,決定路由。 |
| LearningFs | UI 存取檔案的唯一介面。Wave 0 是 MemoryFs,整合後是 Tauri 實作。 |
| stub / Fake | Wave 0 為了不依賴別人而自造的假實作。整合時移除。 |

## 流程

| 術語 | 意思 |
|---|---|
| feature(資料夾) | `features/NN-name/`,一個能力。不等於整合點。 |
| phase | feature 內可獨立交付的一小塊,一個 `.feature`。 |
| Wave 0 | 十個資料夾的 phase-1,完全平行,無跨資料夾依賴。 |
| Integration / I1–I8 | 整合點。每個通過時系統都是完整可用的。 |
| gate | `NEXT.md` 定義的三類條件:自身 phase、整合點、契約待決事項。 |
| standalone | 該 phase 能用一行指令單獨跑起來。`/phase-done` 會實際執行。 |
| sprint | 一週的工作單位,2–4 個 phase。 |
| ADR | Architecture Decision Record,一筆決策。 |
| DoR / DoD / DoI | Definition of Ready / Done / Integrated。 |
| WIP | 同時 in-progress 的 phase 數,上限 2。 |

## 測試

| 術語 | 意思 |
|---|---|
| mutation testing | 故意改壞程式,看測試會不會失敗。驗證測試是否真的在測東西。 |
| 變異存活 | 程式被改壞了但測試照樣通過 = 那行沒被真正測到。 |
| 變異殺死 | 程式被改壞後測試失敗 = 測試有效。 |
| 等價變異 | 改了但行為完全一樣,無法也不需要殺死。 |
| 分級門檻 | 嚴格 95% / 標準 80% / 寬鬆不強制,依模組性質。 |
| `@manual` | 需人眼確認,自動測試跳過。 |
| `@e2e` | 整合檔中「一個人做完一件有意義的事」的關鍵場景。 |
| `@regression` | 整合檔中驗證前一個整合點沒被弄壞的場景。 |
| `@llm` | 需要真的雲端呼叫,會花錢,CI 跳過。 |
| 嚴格級 | 變異門檻 95%,硬門檻。scheduler、grading 前兩層、驗證器、weekly 計數、路徑防護。 |
| 標準級 | 變異門檻 80%,軟目標。未達回報但不擋。 |
| EXPECTED.md | `learning-broken` 的答案卷,lint 找到的問題數必須相符。 |
