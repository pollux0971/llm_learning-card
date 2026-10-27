# 05 · grading — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-1(2026-09-02)、phase-2(2026-09-03)、phase-3(2026-10-27:縮短版生成 `generateShort`,`packages/core/src/grading/reteach-short.ts`,新 prompt `prompts/grading/reteach-short.md`;工單 T65,-5b 驗收,變異 89.14%,真 cucumber `@grading and @phase-3` 3/3;golden `reteach.short` 2026-10-27 顧問評 5/5、4/5、5/5;呼叫端〔06 phase-4 介面載入時生成〕與 `grade.apply` 的佇列包裝歸 05 phase-4 與 06 phase-4 的工單) |
| 進行中 | 無 |
| 下一個 | phase-4(離線審核、複審修正;卡在 I5,見 Gate) |

## Gate

**phase-1**:無 gate。前兩層是純函式,第三層用 FakeLlm。

**phase-2** 需要:
- [ ] 自身:phase-1 `done`
- [ ] 跨資料夾:**03 phase-2 `done`**
- [ ] 整合:無

**phase-3** 需要:
- [x] 自身:phase-2 `done`
- [x] 跨資料夾:03 phase-3 `done`
- [x] 整合:無

理由:縮短版寫卡用 03 的佇列(離線時進 provisional 佇列)。2026-10-27 從原本的 phase-3 拆出來(ADR-084):原本整個卡在 I5,但 I5 要 06 phase-4,06 phase-4 要這裡的縮短版生成,是一個循環。

**phase-4** 需要:
- [ ] 自身:phase-3 `done`
- [x] 跨資料夾:04 phase-2 `done`、03 phase-3 `done`
- [ ] 整合:**I5 通過**

註:離線審核要有本機模型才能測,本機模型的 gate 已解除(閘道,ADR-039)。

## Gate 未滿足時

**phase-2 卡在 03**:等 llm-router 的路由表。這段時間可以先寫 rubric 的 prompt
(`packages/core/prompts/grading/apply.md`)並用 phase-1 的 FakeLlm 驗證 JSON 解析與重試邏輯——
那部分不依賴真的 router。

**phase-4 卡住**:等 I5。複審邏輯的難點不是程式,是「本機判過、雲端判不過,而且中間又考過一次」
這類情境該怎麼辦。這要有真實資料才想得清楚。

## 完成後

phase-2 完成是 I2 的最後一塊。I2 通過後**連續用一週再往下**——
UI 做得再漂亮,審核判錯了整個系統就是錯的。
