# T1 花錢煞車審核報告

審核日期：2026-10-01。範圍限於 router、live-run、vault 與對應測試；未設定 API key、未執行 `--live`，所有可觸及的 adapter／網路邊界均為假實作。開始基準 tree SHA 為 `b55c97fad5cf4bc097eb0c39fc6867512e0389c7`。

## 1. 指定既有測試全綠

指令原文：

```text
npx vitest run packages/core/src/llm/router.test.ts packages/core/src/prompt-quality/live-run.test.ts
```

輸出原文：

```text
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t1-spend-brake


 Test Files  2 passed (2)
      Tests  71 passed (71)
   Start at  08:20:50
   Duration  6.10s (transform 1.80s, setup 660ms, import 5.06s, tests 1.62s, environment 0ms)
```

這包含 `router.test.ts:498/:509/:520` 與 `live-run.test.ts:406/:445` 當時的既有案例。補測後重跑的 tree SHA 前後均為 `b55c97fad5cf4bc097eb0c39fc6867512e0389c7`，輸出如下；結論：通過。

```text
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t1-spend-brake


 Test Files  3 passed (3)
      Tests  186 passed (186)
   Start at  08:23:31
   Duration  5.96s (transform 2.29s, setup 727ms, import 8.32s, tests 2.76s, environment 0ms)
```

## 2. 拔除未記帳硬擋的變異

在獨立暫存 worktree `/tmp/t1-spend-brake-mutation.cDBYFs/worktree`，將 `router.ts` 的原始兩行 `const log = this.log; if (!log) throw new UnaccountableLlmCallError();` 改為 `const log = this.log!;`；沒有 commit 到本分支。指令原文：

```text
npx vitest run packages/core/src/llm/router.test.ts packages/core/src/prompt-quality/live-run.test.ts
```

輸出原文：

```text
 RUN  v4.1.11 /tmp/t1-spend-brake-mutation.cDBYFs/worktree

 ❯ packages/core/src/llm/router.test.ts (44 tests | 1 failed) 483ms
     × 沒有 logPath 也沒有 logAppender 時,call() 在打真的 adapter 之前就丟 UnaccountableLlmCallError 70ms
 ❯ packages/core/src/prompt-quality/live-run.test.ts (27 tests | 1 failed) 1012ms
     × 對照:直接用 LlmRouterImpl({}) 重現舊 bug(不給 logPath/logAppender)——call() 現在硬錯,不再是悄悄不寫 43ms

 Test Files  2 failed (2)
      Tests  2 failed | 69 passed (71)
```

兩個失敗都是預期的 `UnaccountableLlmCallError` 斷言失敗（變異後收到 `TypeError: log is not a function`）。暫存 worktree 與分支已用 `git worktree remove --force`、`git branch -D` 移除。結論：通過；兩個測試確實量到未記帳煞車。

## 3. 拔除 `createDefaultLiveRouter()` 的 `logPath`

在第二個獨立暫存 worktree `/tmp/t1-spend-brake-mutation.vtXcDA/worktree`，從 `golden-run.ts` 的 `new LlmRouterImpl({...})` 移除唯一的 `logPath,`。指令原文：

```text
npx vitest run packages/core/src/prompt-quality/live-run.test.ts
```

輸出原文：

```text
 RUN  v4.1.11 /tmp/t1-spend-brake-mutation.vtXcDA/worktree

 ❯ packages/core/src/prompt-quality/live-run.test.ts (27 tests | 1 failed) 759ms
     × 真的把這次呼叫寫進 <learningDir>/state/log.jsonl,不是靜默的 no-op 20ms

 FAIL  packages/core/src/prompt-quality/live-run.test.ts > createDefaultLiveRouter — ADR-050:預設一定要接上記帳,不能悄悄不寫 > 真的把這次呼叫寫進 <learningDir>/state/log.jsonl,不是靜默的 no-op
UnaccountableLlmCallError: LLM 呼叫必須可記帳:請提供 `logPath`,或明確注入 `logAppender`
 ❯ CloudLlmRouter.call packages/core/src/llm/router.ts:102:21
 ❯ LlmRouterImpl.call packages/core/src/llm/router-impl.ts:139:31
 ❯ packages/core/src/prompt-quality/live-run.test.ts:414:20

 Test Files  1 failed (1)
      Tests  1 failed | 26 passed (27)
```

此 worktree 與分支也已刪除；本分支未留下變異。結論：通過，原 live-run 記帳測試會阻止 `logPath` 被拔掉。

## 4. ADR-051：主簽出才是帳本 owner

原本 `resolveLiveLearningDir() === resolveVaultLearningDir(ROOT)` 的恆等式案例已替換為實際行為：在本非主簽出 worktree 呼叫 `createDefaultLiveRouter()`，經全域假雲端回覆一次 `grade.apply`，斷言唯一的 `llm_call` 寫入主簽出 `/data/python/llm_learning-cards-workers/learning/state/log.jsonl`，且本 worktree 的 `learning/state/log.jsonl` 不存在。為避免碰既有資料，只有主簽出尚無 `learning/` 時執行；本次該條件成立，測試後建立的目錄已移除。指令原文與輸出原文同第 1 條補測重跑（`3 passed, 186 passed`，tree SHA 前後均為 `b55c97fad5cf4bc097eb0c39fc6867512e0389c7`）。結論：通過；不需要修改 `router.ts` 或 `vault.ts`。

## 5. 日上限在 adapter 呼叫前煞車

在 `router-gateway.test.ts` 新增 T1 案例：用真實暫存 `log.jsonl` 預塞 `2026-10-01` 的 `llm_call`，令 1,000 input tokens × 每百萬 $1 剛好等於環境變數 `LLM_DAILY_CAP_USD=0.001`；`today()` 固定為同一天。以注入假 cloud adapter 呼叫 `ingest.cards` 時丟 `DailyBudgetExceededError` 且計數為 0；清空同一帳本後，相同呼叫成功且計數為 1。指令原文：

```text
npx vitest run packages/core/src/llm/router.test.ts packages/core/src/llm/router-gateway.test.ts packages/core/src/prompt-quality/live-run.test.ts
```

輸出原文：

```text
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t1-spend-brake


 Test Files  3 passed (3)
      Tests  186 passed (186)
   Start at  08:23:31
   Duration  5.96s (transform 2.29s, setup 727ms, import 8.32s, tests 2.76s, environment 0ms)
```

結論：屬於停止規則的結果 (i)：已有 call 前煞車，且新測試以實體帳本、環境 cap、假日期和假 adapter 證明其行為；不用修改實作。

## 6. 全程零實際花費

所有 router／gateway 測試均注入假 cloud adapter；live-run 的網路邊界以 `globalThis.fetch` 假實作攔截，假 API key 僅為測試字串，未設定真實憑證、未執行 `--live`。第 5 條的 cloud adapter 為測試內計數函式，沒有任何 fetch；第 4 條的唯一 `/v1/messages` 請求由 `installFakeCloud()` 在程序內回覆。指令與輸出原文同第 5 條，結果 `3 passed, 186 passed`。結論：通過，沒有真網路呼叫或費用。

## 變更與交付前檢查

變更僅為兩個測試檔：`packages/core/src/prompt-quality/live-run.test.ts` 的 ADR-051 行為測試，以及 `packages/core/src/llm/router-gateway.test.ts` 的日上限檔案帳本測試。`git diff --check` 已通過；提交後已再以新的 HEAD tree SHA 重跑第 5 條指令，確認提交未改變結果。
