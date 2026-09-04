# CLAUDE.md — 專案規則

「桌面學習卡片系統」的規格與開發骨架。你是這個專案的配對開發者。

## 開工前先讀

1. `contracts/types.md` — **每次都要讀**。所有跨模組的東西以它為準。
   注意 §2 的字數規則有明確的邊界定義,不要自己重新發明。
2. `docs/01-roadmap.md` 的「現況」表 — 現在在哪個 wave / integration。
3. 你要做的 `features/NN-xxx/FEATURE.md` 與 `NEXT.md`。
4. 對應的 `.feature`。

`docs/00-design.md` 是背景,不用每次讀。遇到「為什麼這樣設計」去查 `02-decision-map.md`。

## 五條硬規則

這五條沒有例外:

1. **不改 `contracts/` 的硬約定**(磁碟格式 §2 §3 §4 §8–§12、§7 的 `LlmTask` 與路由表)。
   要改就停下來走 decision-record。軟約定(§5 §6 §13、函式簽章)改了跑測試、更新 types.md、commit 說明理由即可。
2. **不改 `raw/`。** 那是使用者的素材。
3. **教學卡 body 上限 100 字**,程式硬檢查,不是靠 prompt 拜託。字數規則見契約 §2,
   注意連字號與句點會切斷序列(`same-origin` 算 2)。
4. **改了 `prompts/` 底下任何檔案就要跑 golden run。** 這是唯一會靜默毀掉品質的操作(ADR-032)。
5. **`state/` 的寫入必須是原子的**:寫暫存檔、fsync、rename。那是幾個月的記憶資料。

## 幾條強烈建議

違反這些不會出事,但會累積成問題:

- **沒有 gherkin 不寫程式。** 要做的 phase 應該有 `.feature`
- **Wave 0 期間不跨資料夾 import**(`npm run boundaries` 會檢查)。例外要在 FEATURE.md 說明理由
- **每個功能能單獨跑。** 指令在 `standalone.json`
- **LLM 呼叫經過 llm-router 的介面**,不在別處 import provider SDK
- **Gherkin 全英文**;`docs/`、`FEATURE.md`、`NEXT.md` 用繁體中文
- **一次一個 phase,WIP ≤ 2**
- **嚴格級模組驗收前跑變異測試**(scheduler、grading 前兩層、驗證器、weekly 計數、路徑防護)

## 目錄慣例

- `features/NN-name/` 兩位數編號,新功能接續最大編號
- `phase-N.feature` 從 1 開始
- `FEATURE.md` 的 phase 表是唯一狀態來源:`todo` `ready` `in-progress` `done` `blocked`
- `NEXT.md` 的 gate 決定下一個 phase 何時變 ready
- ADR 編號 `ADR-NNN`,只增不刪,被推翻標 `superseded by`
- 整合 `.feature` 在 `docs/integration/`,tag `@integration @iN`

## 技術棧

- 桌面:Tauri 2 + Svelte 5 + TypeScript
- 核心:TypeScript,monorepo `packages/core`(桌面與 CLI 共用)
- 腳本:TypeScript,`tsx` 執行
- Rust:只做視窗、系統列、fs、自啟
- 驗收:`@cucumber/cucumber`;單元:`vitest`;變異:`@stryker-mutator/core`
- 守門腳本採用模板 v1.3.4(`scripts/` 的 `_root.ts` 與 `check-*.ts`,檔頭有來源標頭,用 `sync-gates.sh` 升版,不手改;落點表與例外清單在 `scripts/boundaries.owners.json`、`boundaries.allow.json` 與 `gates.config.json`,那三個是我們自己的設定,模板不覆蓋)
- schema:`zod`
- 步驟定義先讀 `features/steps/_world.ts`,照那個結構寫,不要自己發明模式

## 覺得流程太重的時候

看 `docs/03-agile-workflow.md` 的「最小模式」。核心只有:契約、gherkin、
phase 驗收的四項核心檢查、端到端場景。其餘可以先關掉,需要時再開。

## 可用指令

- `/feature <描述>` — 新需求分流,**先提案、等確認、再寫檔**
- `/phase-done <folder>/<phase>` — 驗收一個 phase
- `/integrate <IN>` — 驗收一個整合點
- `/mutate [folder]` — 跑 mutation testing 並判讀
- `/decide <描述>` — 記錄 ADR
- `/sprint` — 規劃本週

## 做決定時

任何「A 或 B」先查 `02-decision-map.md` 有沒有決定過。有,照做。
沒有:技術取捨(資料結構、介面、規格措辭、gate 例外、重跑與否)問技術顧問 session
(目前 `llm-learning-cards-61`;名稱會變,找不到就用 `ListAgents` 找「llm-learning-cards-」開頭且不是協調者的那個),它決定後 `/decide` 記 ADR。只有三種情況問使用者:
新功能或改「不在範圍」、改 `contracts/` 硬約定或本檔、當日 LLM 花費超過 `LLM_DAILY_CAP_USD`。
問使用者時附選項與建議。人眼確認(`@manual`、`@e2e`)的觀感判定由技術顧問做,列清單即可,不擋其他工作。
權責表與協調者的迴圈見 `.claude/skills/autopilot/SKILL.md`。
