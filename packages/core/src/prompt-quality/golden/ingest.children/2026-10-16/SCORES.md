# ingest.children — 2026-10-16 評分表

兩個維度,各 1–5 分:正確嗎、是一個概念嗎。工具不判斷品質,這份表是給人填的。

| id | 正確嗎 | 是一個概念嗎 |
|---|---|---|
| children-same-origin | 5 | 5 |
| children-cors | 5 | 5 |
| children-preflight | 5 | 5 |

## 備註(技術顧問評分,2026-10-17)

這是 T12 第 3 輪合併後、乾淨 main 上的基準(prompt `4308996`)。

- **子卡重述自己的父卡:0 張。** 九張逐張做「刪掉子卡,父卡 body 教得會這一點嗎」:都教不會。
  字面 overlap 0 對,最高 0.229(門檻 0.3)。
  - children-cors 第 3 張「憑證模式的雙方配合」不是重述:父卡只說「指名來源、不能用萬用字元」,
    這張講前端 credentials 模式與 `Access-Control-Allow-Credentials`,是加深。
  - children-preflight 第 1 張「哪些請求會跳過預檢」和父卡的觸發條件相鄰,但它講的是反面
    (簡單請求的條件、送 JSON 會預檢),還順便修正了素材「改變伺服器狀態的方法」的不精確說法。算加深。
- **跨主題重複(留給 T18):2 處。** children 的 prompt 只看得到自己的父卡,所以會寫出別的主題的卡。
  1. children-same-origin 第 1 張「CORS 的伺服器授權」≈ 父卡 cards-cors 的主旨。
  2. children-same-origin 第 2 張「預檢請求的觸發」≈ children-cors 第 1 張(標題一字不差),也 ≈ 父卡 cards-preflight 的觸發條件;
     children-preflight 第 1 張也部分相鄰。
  第 3 輪 worker 那次也是 2 處,同一類。T18 驗收時拿這兩處當「之前」對照。
- 正確性:九張沒有錯誤說法。
