# 12 · prompt-quality — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-1(2026-09-02) |
| 進行中 | phase-2(gherkin 與測試已寫,實作待接) |
| 下一個 | phase-2 的實作 |

## Gate

**phase-1**:無 gate。框架本身用 FakeLlmRouter,不需要真模型。

**phase-2** 需要:phase-1 done、**I1 通過**、03 phase-1 done
→ 三項都滿足(I1 於 2026-09-04 通過,tag `I1`),gate 已解除。

## Gate 未滿足時

**phase-2 等 I1** 是對的——在有真的 prompt 之前,golden set 沒東西可放。

但 phase-1 **可以也應該在 Wave 0 做**,而且它是十二個裡最便宜的一個(大概半天)。
早點做完的好處是:02 與 05 在寫 prompt 的時候,golden 框架已經在那裡了,
可以邊寫邊存基準,而不是事後補。

## phase-2 目前的狀態

測試 agent 已寫完 `phase-2.feature`(18 個非 @manual 場景)與四個測試檔
(`batch-checks` / `live-run` / `regression` / `scores-phase2`,共 70 個測試),
本體全部是 `throw new Error('not implemented (12-prompt-quality/phase-2)')`。
下一步是開發 agent 把它們填綠。要填的東西:

| 檔案 | 要實作的 |
|---|---|
| `structural-checks.ts` | `normalizeTitle` `normalizeBody` `charNgrams` `jaccard` `checkDuplicates` `checkPrereqShape` `runBatchChecks` |
| `golden-run.ts` | `runGoldenLive` `createDefaultLiveRouter` `estimateCostUsd` |
| `regression.ts` | `markBaseline` `findBaseline` `detectPromptDrift` `reviewRegression` |
| `scores.ts` | `renderBatchCheckSection` |

**下一張工單(不在 phase-2)**:`prompts/ingest/children` 加「子卡不得重述父卡或
同層 L0 卡」。改 `prompts/` 就要跑 golden run(硬規則 4),所以要先有 phase-2 的基準才能比。

## 完成後

這個資料夾做完之後就是背景設施,平常不會碰它。唯一要記得的是那條規則:
**改了 prompt 就跑 golden**。

如果三個月後你發現卡片品質變差了卻不知道哪裡開始的,那就是這條規則沒有被遵守。
