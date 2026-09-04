# 02 · ingest-pipeline — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-1(2026-09-03)、phase-2(2026-09-03) |
| 進行中 | 無 |
| 下一個 | phase-3(卡在 I4,見 Gate)。I1 整合驗收現在可以做了 |

## Gate

**phase-1**:無 gate。用 `FakeLlmRouter` 與自己的最小字數檢查,不等任何人。

**phase-2** 需要:
- [x] 自身:phase-1 `done`
- [x] 跨資料夾:01 phase-2 與 phase-3 `done`、03 phase-2 `done`
- [x] 整合:無(phase-2 **就是** I1 的一部分)

**phase-3** 需要:
- [ ] 自身:phase-2 `done`
- [ ] 整合:**I1 通過**
- [ ] 契約:無

## Gate 未滿足時

**phase-2 卡住**:代表 01 或 03 還沒做完。這段時間**不要**先寫 phase-2 的實作——
你會照著猜測的介面寫,然後全部重寫。可以做的是:讀 `contracts/types.md` §3 §8,
把考題與圖的 prompt 草稿先寫進 `packages/core/prompts/ingest/`,那不依賴任何人。

**phase-3 卡住**:等 I1。phase-3 處理增量與 stale,而「增量」的意義要建立在
一個真的跑過的完整管線上,提前做會做錯。

## 開放問題(待辦,不阻擋任何 phase)

- **給 `scripts/ingest.ts` 一個 `--deps-only` 入口**,讓「只重生依賴圖」不用整篇重
  ingest。動機:ADR-038 決定「丟邊達上限就移除該分類的過期圖資料」,代價是上一次
  成功的圖會被丟掉,要重跑才回得來;有 `--deps-only` 就只需要一次 `ingest.deps`
  呼叫,不用重跑卡片與考題生成。**現在不做**,記著。

## 完成後

phase-2 完成是 I1 的最後一塊。I1 通過後你就能把真的素材餵進去了——**立刻去做**,
不要等 I2。真實資料會暴露一堆 fixture 蓋不到的問題。
