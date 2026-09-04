# 03 · llm-router — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-1(2026-09-02)、phase-2(2026-09-03) |
| 進行中 | phase-4(閘道本機 adapter + 預算備援,2026-09-04 開工) |
| 下一個 | phase-3(provisional 佇列)——gate 已由 ADR-039 解除,可以開工 |

## Gate

**phase-1**:無 gate。

**phase-2** 需要:
- [x] 自身:phase-1 `done`
- [x] 跨資料夾:無
- [x] 契約:**已解除**(ADR-037:本機模型延後,phase-2 只做路由表+線上偵測+`probeLocal` 固定回 unavailable,不需要真的本機模型)

**phase-3** 需要:
- [x] 自身:phase-2 `done`(2026-09-03)
- [x] 契約:**已解除**(ADR-039:本機模型由另一台機器的 Ollama + JWT 閘道提供,
      ADR-037 的「使用者決定裝本機模型」gate 不再成立。provisional 佇列現在有真的
      本機結果可以排隊了)

**phase-4** 需要:
- [x] 自身:phase-2 `done`(2026-09-03)
- [x] 契約:**已解除**(ADR-039,同 phase-3)

## Gate 未滿足時

**目前沒有未滿足的 gate。** phase-3 與 phase-4 的契約 gate 都已由 ADR-039 解除。

留下的不是 gate,是一個**已知的暫時狀態**:閘道機器還沒起來(`localhost:8787` 無回應、
`GATEWAY_API_KEY` 還沒進 `.env`)。這不擋開工——phase-4 的自動場景全部用假的
`globalThis.fetch` 模擬閘道(照 `features/steps/_fake-cloud.mjs` 的模式,router / client /
SDK 全跑真的),真連線的場景標 `@manual`,等使用者把閘道起起來再跑一次:

```bash
npx tsx scripts/llm.ts --probe     # 應該印出閘道上的模型清單
```

## 完成後

phase-2 完成後 02 與 05 就能丟掉各自的 `FakeLlmRouter`。這是 I1 與 I2 的關鍵路徑,
所以 phase-2 應該在 Wave 0 結束後**優先**做。

phase-4 完成後,ADR-039 連帶解開的還有 `05-grading/phase-3`(離線審核)與 I6 涉及本機
推論的那一半——那兩個原本也掛在 ADR-037 的同一個 gate 下。另外 `scripts/llm-spend.ts`
的退出碼讓 autopilot 可以在開始花錢的工作之前先問一句「今天還有預算嗎」。
