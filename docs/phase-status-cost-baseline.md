# `check:phase-status` 基線量測

## 結論

前提不成立，停手不改方案。這個 worktree 在量測 commit
`9a36483a5aad47503dceb5e80f220738051f0d95`（`git merge main`：Already up to date）上，
實際耗時是 3 分 36 秒，不是工單估算的約 38 分鐘；而且目前程式實際 spawn 22 次，不是
38 次，因此沒有足夠數字依據選 A、B 或 C。

## 當場量測

環境：

- commit：`9a36483a5aad47503dceb5e80f220738051f0d95`
- 啟動時機器負載：`load average: 0.72, 3.01, 6.22`
- 結束時機器負載：`load average: 20.72, 17.00, 11.61`
- 量測期間觀察到的負載快照：`load average: 30.20, 17.90, 11.52`
- `gates.config.json`：`phaseStatus.mode=report`

執行的原始命令（依工單要求）：

```bash
export LLM_DAILY_CAP_USD=1 LLM_PRICE_IN_PER_M=2.5 LLM_PRICE_OUT_PER_M=10
export TEMPLATE_DIR=/data/python/dev-paradigm
time npx tsx scripts/check-phase-status.ts
```

原始輸出（逐字）：

```text
commit=9a36483a5aad47503dceb5e80f220738051f0d95
load= 01:22:05 up 1 day,  3:47,  1 user,  load average: 0.72, 3.01, 6.22
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards/phase-status-cost/scripts/gates.config.json
phase-status: phaseStatus.mode=report(reviewDirs=docs/reviews)
phase-status: 12 份 FEATURE.md,共 38 個 phase 表格列

✓ 沒有偵測到狀態表漂移
gate=phase-status result=PASS scanned=38

real	3m36.283s
user	2m21.337s
sys	0m19.172s
```

## 實際 spawn 次數

`scripts/check-phase-status.ts` 的 `runTagActual()` 只有一個 `spawnSync` 呼叫；主迴圈只對
狀態為 `done` 或 `in-progress` 且存在對應 `.feature` 的列呼叫它。本次 38 列中有 20 個
`done`、2 個 `in-progress`、15 個 `todo`、1 個 `todo(gate 已由 ADR-039 解除)`，對應 feature
檔案全部存在，所以實際執行數是 22。

另以 `PHASE_STATUS_RUN_CMD` 注入每次失敗輸出 `phase-status-invocation` 的探針跑過一次，
父程式回報的 invocation marker 數為 `22`；此探針只驗證呼叫次數，不取代上面的耗時基線。

## 決策與範圍

決策：**前提不成立，A/B/C 均不實作**。3m36.283s 已是工單明確舉例的「例如只花 3 分鐘」
情況；此外目前是 report 模式且本次沒有命中，沒有證據支持把它移出鏈或改成 enforce。

因此：

- 沒有修改 `scripts/check-phase-status.ts`。
- 沒有修改 `scripts/gates.config.json`，也沒有加入 `unwired` reason。
- 沒有做 A 的前後輸出對照、B 的收割窗口排程或 C 的故意弄壞陽性對照；三者均因前提不成立而不適用。
- 工作樹除本報告外無檔案變更；未修改 `raw/`、`learning/`、`CLAUDE.md`、`contracts/`、`prompts/` 或 `scripts/_root.ts`。

## 驗證

`npx vitest run scripts/zero-input-guard.test.ts`：`694 passed | 164 skipped (858)`，退出 0。

`npm run check:all`（未帶 `--fail-fast`）在 `check:test-ledger` 因既有
`scripts/degraded-report.test.ts` 單測 5 秒 timeout 而 FAIL（`1 failed | 3067 passed | 164 skipped`）；
其後鏈仍完成，`check:phase-status` 本身 PASS、`scanned=38`。完整命令的最後兩行為：

```text
1 個失敗
gate=all result=FAIL scanned=20
```
