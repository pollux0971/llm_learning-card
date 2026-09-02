# 05 · grading — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-1(2026-09-02) |
| 進行中 | 無 |
| 下一個 | phase-2 |

## Gate

**phase-1**:無 gate。前兩層是純函式,第三層用 FakeLlm。

**phase-2** 需要:
- [ ] 自身:phase-1 `done`
- [ ] 跨資料夾:**03 phase-2 `done`**
- [ ] 整合:無

**phase-3** 需要:
- [ ] 自身:phase-2 `done`
- [ ] 跨資料夾:04 phase-2 `done`、03 phase-3 `done`
- [ ] 整合:**I5 通過**

## Gate 未滿足時

**phase-2 卡在 03**:等 llm-router 的路由表。這段時間可以先寫 rubric 的 prompt
(`packages/core/prompts/grading/apply.md`)並用 phase-1 的 FakeLlm 驗證 JSON 解析與重試邏輯——
那部分不依賴真的 router。

**phase-3 卡住**:等 I5。複審邏輯的難點不是程式,是「本機判過、雲端判不過,而且中間又考過一次」
這類情境該怎麼辦。這要有真實資料才想得清楚。

## 完成後

phase-2 完成是 I2 的最後一塊。I2 通過後**連續用一週再往下**——
UI 做得再漂亮,審核判錯了整個系統就是錯的。
