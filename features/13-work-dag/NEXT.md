# 13 · work-dag — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-2(2026-10-22:工單 T39,合併 a92a51c;-5a 三輪驗收,Stryker `scripts/dag.ts` 663–1258 累計 97.95%、必補 0;32 張工單檔頭補齊;`dag:check` 進 `check:all`)、phase-1(2026-10-21:`scripts/dag.ts`;工單 T33,-0e 兩輪驗收無阻擋項,Stryker dag.ts 第二輪 89.58%,補測後 dag.test.ts 207 條) |
| 進行中 | 無 |
| 下一個 | 無(本資料夾的 phase 都做完了;接下來的事見「完成後」) |

## Gate

**phase-1**:無 gate。只依賴 `contracts/`(實際上什麼都不 import),吃自己資料夾底下的假樹 fixture。

**phase-2** 需要:
- [x] 自身:phase-1 `done`
- [ ] 整合:無
- [x] 決策:無(已定案,理由見下)

理由:2026-10-15 技術顧問已定案(ADR-065 accepted);R1–R5 與七條解讀已逐條確認,見 `FEATURE.md`。

## Gate 未滿足時

**phase-1 沒有 gate,可以立刻做。** 它是純讀取、純印出的小工具,沒有跨模組依賴,也不碰任何 CPU 重活
(不跑完整鏈、不跑 Stryker),可以和 T2b 的驗收同時進行。

**phase-2 等 phase-1 `done`。**(ADR-065 已定案。) 這段期間可以先寫工單檔頭的樣本(`docs/tickets/` 的未合併工單),
但**不要**寫 `dag:check` 的實作——沒有 phase-1 的解析器,實作只能憑空猜 NEXT.md 的形狀。

## 完成後

phase-2 完成後,協調者每輪先跑 `npx tsx scripts/dag.ts --root .` 看 `READY` / `START` / `HELD`,不再憑記憶排工。
接下來可以做、但**不在本資料夾**的事:

- 把 `--orca` 的輸出接給協調者的派工流程(屬於協調者的 SKILL.md,不是這裡);
- 若 R5 在真樹上實測常態逼近 4,回頭評估規則本身(ADR-065 的後續)。
