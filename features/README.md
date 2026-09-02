# features/

一個資料夾 = 一個**能力**(ADR-018)。資料夾內按 phase 切,每個 phase 一個 `.feature`。

## 索引

| # | 功能 | 一句話 | Phases | Wave 0 單獨執行 |
|---|---|---|---|---|
| 01 | data-layer | 檔案格式、驗證器、依賴圖 | 3 | `tsx packages/core/src/schema/cli.ts validate <file>` |
| 02 | ingest-pipeline | raw → 卡片、考題、圖 | 3 | `tsx scripts/ingest.ts --fake --file <raw>` |
| 03 | llm-router | LLM 呼叫的唯一入口 | 3 | `tsx scripts/llm.ts --task deepen --prompt "…"` |
| 04 | scheduler | 骨架、回退、上限、優先序 | 3 | `tsx scripts/due.ts --state <fixture>` |
| 05 | grading | 填空三層、應用 rubric、複審 | 3 | `tsx scripts/grade.ts --fill --q <f> --answer "…"` |
| 06 | test-card | 考試卡 UI | 4 | `npm run dev -w apps/test-card` |
| 07 | teach-card | 教學卡 UI | 4 | `npm run dev -w apps/teach-card` |
| 08 | weekly-goal | 週目標計數 | 2 | `tsx scripts/weekly.ts --state <f>` |
| 09 | lint | 健檢、複審、重生 | 2 | `tsx scripts/lint.ts --dir <fixture>` |
| 10 | desktop-shell | Tauri 視窗、系統列、跨平台 | 5 | `npm run tauri dev` |
| 11 | review-cli | 把排程與審核串成能用的複習指令 | 2 | `tsx scripts/review.ts --dry-run` |
| 12 | prompt-quality | golden run,讓 prompt 退化被看見 | 2 | `tsx scripts/prompt-check.ts --golden --fake` |

精確狀態看各 `FEATURE.md` 的 phase 表。下一步由各 `NEXT.md` 決定。
單獨執行指令的權威來源是根目錄的 `standalone.json`,上表只是方便閱讀。

`11-review-cli` 沒有 Wave 0 的 phase-1——組合層在被組合的東西存在之前無法獨立(ADR-028)。

## 資料夾結構

```
NN-name/
├── FEATURE.md        範圍、不在範圍、依賴、技術棧、單獨執行、phase 表、Wave 0 的重複
├── NEXT.md           ★ 目前狀態、下一個 phase 的 gate、gate 未滿足時該做什麼
├── phase-1.feature   Wave 0,必須完全獨立
└── phase-N.feature
```

新資料夾從 `_template/` 複製,**三個檔都要**。

## phase-1 的原則

Wave 0 的 phase-1 應該:

1. **只 import `contracts/`** 與自己的目錄。這條由 `npm run boundaries` 檢查,是唯一硬性的
2. **能單獨跑**,指令在 `standalone.json`
3. **只吃 `contracts/fixtures/`**
4. **需要別人的能力就用 stub**,在 FEATURE.md 的「Wave 0 的重複」列出來

例外是允許的,但要在 `FEATURE.md` 說明理由,並在 decision map 記一筆
(`11-review-cli` 就是這樣的例外,見 ADR-028)。

## 狀態

| 狀態 | 意思 |
|---|---|
| `todo` | 有 gherkin,gate 未滿足 |
| `ready` | gate 滿足,可挑進 sprint |
| `in-progress` | 本 sprint 在做 |
| `done` | 通過 `/phase-done` |
| `blocked` | 卡住,原因在 NEXT.md |

建議讓 `/sprint` 與 `/phase-done` 維護狀態,這樣 gate 計算才會正確。
手動改也不會壞掉,只是下次 `/sprint` 可能給出奇怪的建議。

## Gherkin 慣例

全英文,cucumber 預設語言,不需 language 標頭。

檔頭第一行是 tags:

```gherkin
@wave0 @scheduler @phase-1 @standalone
```

| Tag | 意思 |
|---|---|
| `@wave0` / `@i1`..`@i8` | 屬於哪個階段 |
| `@<feature-name>` | 哪個資料夾 |
| `@phase-N` | 哪個 phase |
| `@standalone` | 不需要其他模組,`npm run accept:standalone` 會跑 |
| `@manual` | 人眼確認,自動測試跳過 |
| `@llm` | 需要真的雲端呼叫,會花錢 |

規則:

- 一個場景只驗一件事
- 步驟用使用者看得懂的語言,不寫實作細節(不寫 "calls function X",寫 "runs the validator")
- 多個變體用 `Scenario Outline` + `Examples`
- 場景名稱是一句敘述,不加編號
- 每個 phase-1 的第一個場景應該是「單獨跑起來會怎樣」

## 步驟定義

`steps/`,依功能分檔。同一句步驟在不同 feature 出現時共用同一個定義。

## 一個 phase 的大小

一個人加 Claude Code 在 1–3 天內做完。超過就拆,少於半天就併。
