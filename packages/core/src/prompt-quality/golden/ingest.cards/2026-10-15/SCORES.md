# ingest.cards — 2026-10-15 評分表

兩個維度,各 1–5 分:正確嗎、是一個概念嗎。工具不判斷品質,這份表是給人填的。

| id | 正確嗎 | 是一個概念嗎 |
|---|---|---|
| cards-same-origin | 5 | 4 |
| cards-cors | 5 | 5 |
| cards-preflight | 5 | 5 |

## 備註(技術顧問評分,2026-10-15)

- cards-same-origin(5/4):第 3 張「不同路徑仍可同源」和第 1 張的定義重疊。
- cards-preflight(5/5):忠於原文。但素材 contracts/fixtures/raw/security-basics.md 第 28 行「改變伺服器狀態的方法」對預檢觸發條件的說法不精確——這是素材的問題,不是模型的。
