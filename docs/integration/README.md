# integration/ — 分階段整合的 Gherkin

每個檔案是一個整合點的驗收規格。與 `features/*/phase-N.feature` 的差別:

| | features/ | integration/ |
|---|---|---|
| 驗什麼 | 一個模組的行為 | 模組串起來之後,**使用者做得到什麼** |
| 依賴 | 只有 contracts + fixture | 真的模組,沒有 stub |
| 資料 | fixture | 真的 `learning/` 目錄 |
| 通過的意思 | 這塊做完了 | **系統是完整可用的** |

## 鐵則

每個整合的 Gherkin 都必須有至少一個場景,描述**一個人從頭到尾做完一件有意義的事**。
如果寫不出這樣的場景,那個整合點就切錯了——重切,不要湊。

## 執行

```bash
npm run accept:integration                       # 全部
npx cucumber-js docs/integration --tags '@i2'    # 單一整合點
```

自動場景需要真的 `learning/` 目錄與(部分)真的 LLM 呼叫,所以比 `features/` 的慢。
`@manual` 的由 `/integrate` 列成清單給你確認。

## Tag 慣例

- `@integration` — 全部整合檔都有
- `@i1`..`@i8` — 哪個整合點
- `@e2e` — 端到端的那個關鍵場景(每個檔至少一個)
- `@regression` — 驗證前一個整合點的能力沒被弄壞
- `@manual` — 人眼確認
- `@llm` — 需要真的雲端呼叫(會花錢,CI 跳過)

## Regression 是刻意的

每個整合檔都有 `@regression` 場景,重跑前一個整合點的關鍵能力。
因為「每次整合都是完整可用的系統」的意思是:**新的能加進來,舊的不能壞**。

## 人工確認可以延後,不能跳過

自動場景通過、但 `@e2e` 或 `@manual` 缺前置條件(例:I2 需要教學卡才能把卡標成學過)時,整合點**不打 tag**,
人工確認寫進 roadmap 的現況表、併到能做的那個整合點一起問使用者(ADR-073)。補完才打 tag。
