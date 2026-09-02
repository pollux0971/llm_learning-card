# 10 · desktop-shell — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | 無 |
| 進行中 | 無 |
| 下一個 | phase-1(Wave 0) |

## Gate

**phase-1**:無 gate。placeholder HTML,不碰任何 core。

**phase-2** 需要:
- [ ] 自身:phase-1 `done`
- [ ] 跨資料夾:無(它提供 `LearningFs`,不消費別人)
- [ ] 整合:無

**phase-3** 需要:phase-2 `done`、**I4 通過**
**phase-4** 需要:phase-3 `done`、**I6 通過**、一台 macOS 實機
**phase-5** 需要:phase-4 `done`、**I7 通過**、一台 Windows 實機

## Gate 未滿足時

**phase-2 沒有 gate,可以緊接著 phase-1 做。** 它提供 `LearningFs` 給 06 與 07,
所以早點做完對 I3 有幫助。

**phase-3 等 I4**:系統列要顯示「今天幾題到期」,那要有真的排程與真的資料才有意義。
提前做只能顯示假數字。

**phase-4 / 5 卡在硬體**:沒有實機就不要開始。跨平台的問題九成是「在那台機器上才會出現」的,
用 CI 或虛擬機驗不出來。

## 完成後

phase-2 完成後 06 與 07 就能丟掉 `MemoryFs`。
路徑防護的部分**不要**當成 UI 程式對待——那是安全邊界,變異門檻 95%,要有逃逸嘗試的測試。
