# 12 · prompt-quality — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-1(2026-09-02) |
| 進行中 | phase-2(框架已交付;2026-09-04 因為只登記了 Wave 0 的 demo 而退回,見 FEATURE.md 最後兩節) |
| 下一個 | 不在這個資料夾:`prompts/ingest/children` 的「子卡不得重述父卡」(見下面「下一張工單」) |

## Gate

**phase-1**:無 gate。框架本身用 FakeLlmRouter,不需要真模型。

**phase-2** 需要:phase-1 done、**I1 通過**、03 phase-1 done
→ 三項都滿足(I1 於 2026-09-04 通過,tag `I1`),gate 已解除。

## Gate 未滿足時

**phase-2 等 I1** 是對的——在有真的 prompt 之前,golden set 沒東西可放。

但 phase-1 **可以也應該在 Wave 0 做**,而且它是十二個裡最便宜的一個(大概半天)。
早點做完的好處是:02 與 05 在寫 prompt 的時候,golden 框架已經在那裡了,
可以邊寫邊存基準,而不是事後補。

## phase-2 補完之後的狀態(2026-09-04)

五個真的 prompt 檔都登記了 golden set(細節見 FEATURE.md 最後一節),
守門測試會在「有 prompt 檔沒被登記」時變紅。剩下的仍然是那兩個 `@manual @llm` 場景
——第一次 `--live` 真實基準要花錢,由協調者安排。**phase 2 的狀態由審核輪決定,這一輪不自己標。**

## phase-2 收在哪裡

`phase-2.feature` 的 18 個非 @manual 場景全過,四個測試檔(`batch-checks` /
`live-run` / `regression` / `scores-phase2`)加上審核補測共 172 個測試全綠,
四個檔案的變異分數都在 80% 之上(structural-checks 91.26%、scores 89.19%、
golden-run 84.06%、regression 83.78%)。詳情與逐條查證見 `REVIEW.md`。

還沒做的只剩 `phase-2.feature` 裡兩個 `@manual @llm` 場景——那要真的花錢打雲端,
由人另外安排(第一次真實基準、以及「故意改壞 prompt 看得不看得出來」)。
ADR-043 記了為什麼機器指標抓不到 I1 那 4 對語意重複。

**下一張工單(不在 phase-2)**:`prompts/ingest/children` 加「子卡不得重述父卡或
同層 L0 卡」。改 `prompts/` 就要跑 golden run(硬規則 4),所以要先有 phase-2 的基準才能比。

## 完成後

這個資料夾做完之後就是背景設施,平常不會碰它。唯一要記得的是那條規則:
**改了 prompt 就跑 golden**。

如果三個月後你發現卡片品質變差了卻不知道哪裡開始的,那就是這條規則沒有被遵守。
