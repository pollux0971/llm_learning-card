# 06 · test-card — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | 無 |
| 進行中 | 無 |
| 下一個 | phase-1(Wave 0) |

## Gate

**phase-1**:無 gate。純前端 + fixture + stub,在瀏覽器跑。

**phase-2** 需要:
- [ ] 自身:phase-1 `done`
- [ ] 跨資料夾:04 三個 phase `done`、05 phase-2 `done`、10 phase-2 `done`
- [ ] 整合:**I2 通過**(排程與審核要先被真正驗證過)

**phase-3** 需要:phase-2 `done`
**phase-4** 需要:phase-3 `done`、05 phase-3 `done`、**I4 通過**

## Gate 未滿足時

**phase-2 卡住**:這是依賴最重的 phase,會等最久。這段時間**不要**開始接線——
先把 phase-1 的 stub 介面對齊 `contracts/types.md` §5 §6 §13,
對齊得越精確,I3 的接線工作越接近「刪掉 stub、換一行 import」。

如果 stub 的簽章跟契約不一樣,那是 phase-1 的 bug,現在就修。

## 完成後

phase-2 與 phase-3 完成即 I3。到這裡你就不用開終端機複習了。
