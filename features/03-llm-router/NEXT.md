# 03 · llm-router — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-1(2026-09-02)、phase-2(2026-09-03) |
| 進行中 | 無 |
| 下一個 | phase-3、phase-4(皆卡在 ADR-037 本機模型決定) |

## Gate

**phase-1**:無 gate。

**phase-2** 需要:
- [x] 自身:phase-1 `done`
- [x] 跨資料夾:無
- [x] 契約:**已解除**(ADR-037:本機模型延後,phase-2 只做路由表+線上偵測+`probeLocal` 固定回 unavailable,不需要真的本機模型)

**phase-3** 需要:
- [ ] 自身:phase-2 `done`
- [ ] 契約:**使用者決定裝本機模型**(ADR-037,取代原本的「I5 通過」——provisional 佇列沒有本機模型可用就沒有意義)

**phase-4** 需要:
- [ ] 自身:phase-2 `done`
- [ ] 契約:**使用者決定裝本機模型**(ADR-037,同 phase-3)

## Gate 未滿足時

**phase-2 已經 ready**,可以立刻開工,跟 01-data-layer/phase-3 平行做。

**phase-3、phase-4 卡住**:等使用者決定要裝哪個本機模型、什麼時候裝(機器目前是 GTX 1650
4GB VRAM,14B 塞不進去,7B 部分 offload 堪用但應用審核偏弱——ADR-037 有完整記錄)。
提前做會做出一套沒人驗證過的東西,而且本機 adapter 沒有真的模型可以對,寫了也測不了真的。

## 完成後

phase-2 完成後 02 與 05 就能丟掉各自的 `FakeLlmRouter`。這是 I1 與 I2 的關鍵路徑,
所以 phase-2 應該在 Wave 0 結束後**優先**做。
