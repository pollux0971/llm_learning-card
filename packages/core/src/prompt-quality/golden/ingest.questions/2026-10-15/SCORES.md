# ingest.questions — 2026-10-15 評分表

兩個維度,各 1–5 分:正確嗎、是一個概念嗎。工具不判斷品質,這份表是給人填的。

| id | 正確嗎 | 是一個概念嗎 |
|---|---|---|
| questions-same-origin | 5 | 5 |
| questions-cors | 5 | 5 |
| questions-preflight | 5 | 4 |

## 備註(技術顧問評分,2026-10-15)

- questions-same-origin(5/5):填空 3 的答案只收「不同源」,太窄,「不同來源」「非同源」會被判錯。
- questions-preflight(5/4):填空 1「有些 ___ 請求瀏覽器不敢直接送」照抄原文,空的答案太模糊。
