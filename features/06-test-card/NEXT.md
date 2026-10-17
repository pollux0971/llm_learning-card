# 06 · test-card — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-1(2026-09-03)、phase-2(2026-10-17:考試卡拿掉 stubs、改吃複習側車;工單 T24,-ed 驗收無阻擋項,真 cucumber @test-card 15/15,Stryker session.ts 81.62%;@manual 八列由技術顧問判通過,證據見 docs/reviews/acceptance-T24.md 與 docs/reviews/T24-manual-2026-10-17.md)、phase-3(2026-10-17:考試卡顯示逾期數、小結(通過/退回/明天預估/到上限)、stuck 提醒,reteach 的「繼續」移到第一屏,root-mismatch 訊息空白修正;工單 T23,-ed 驗收無阻擋項,Stryker session.ts 88.06%、handler.ts 78.21%,真 cucumber @test-card 19/19;@manual 八列由技術顧問判通過,證據見 docs/reviews/acceptance-T23.md 與 docs/reviews/T23-manual-2026-10-17.md)|
| 進行中 | 無 |
| 下一個 | phase-4(gate:05 phase-3 `done`、I4 通過,尚未滿足) |

## Gate

**phase-1**:無 gate。純前端 + fixture + stub,在瀏覽器跑。

**phase-2** 需要:
- [x] 自身:phase-1 `done`
- [x] 跨資料夾:04 三個 phase `done`、05 phase-2 `done`、10 phase-2 `done`
- [x] 整合:**I2 通過**(排程與審核要先被真正驗證過;自動驗收通過,人工確認延到 I4、不打 tag,ADR-073)

**phase-3** 需要:
- [x] 自身:phase-2 `done`
**phase-4** 需要:phase-3 `done`、05 phase-3 `done`、**I4 通過**

## Gate 未滿足時

**phase-2 卡住**:這是依賴最重的 phase,會等最久。這段時間**不要**開始接線——
先把 phase-1 的 stub 介面對齊 `contracts/types.md` §5 §6 §13,
對齊得越精確,I3 的接線工作越接近「刪掉 stub、換一行 import」。

如果 stub 的簽章跟契約不一樣,那是 phase-1 的 bug,現在就修。

## 完成後

phase-2 與 phase-3 完成即 I3。到這裡你就不用開終端機複習了。
