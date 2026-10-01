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

舊測試會 `rm -rf` 真實 `learning/`，這是被退回的原因：它把 `resolveVaultLearningDir(ROOT)` 的執行期結果當成清理目標，即使有 `skipIf` 仍非結構性保護。新測試不再讀寫真實帳本，也沒有 `skipIf`：先以 `mkdtemp` 建立合成主簽出，複製最小程式／fixtures、`git init` 後以 `git worktree add` 建立合成 worktree；子程序在該合成 worktree 真正呼叫 `createDefaultLiveRouter()`，並以該 router 建出的真實 log appender 寫入一個假 `llm_call`。因此 `ROOT`、`git --git-common-dir` 與 `resolveVaultLearningDir()` 在結構上都只能解析到合成主簽出。斷言合成主簽出的 `learning/state/log.jsonl` 有事件、合成 worktree 自己的 log 不存在；`finally` 唯一遞迴刪除的路徑是 `mkdtemp` 直接回傳的 sandbox。沒有 API key、沒有 router call、沒有網路與 `--live`。

指令原文：

```text
git rev-parse 'HEAD^{tree}'
npx vitest run packages/core/src/llm/router.test.ts packages/core/src/llm/router-gateway.test.ts packages/core/src/prompt-quality/live-run.test.ts packages/core/src/llm/spend.test.ts
git rev-parse 'HEAD^{tree}'
```

輸出原文：

```text
30fe123cb88980efa3e6797c05f386a62d0846ea

 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t1-spend-brake


 Test Files  4 passed (4)
      Tests  218 passed (218)
   Start at  08:45:35
   Duration  15.99s (transform 5.00s, setup 1.00s, import 12.91s, tests 11.38s, environment 8ms)

30fe123cb88980efa3e6797c05f386a62d0846ea
```

指定變異把 `createDefaultLiveRouter()` 的預設目錄從 `resolveLiveLearningDir(learningDir)` 改成 `learningDir ?? join(ROOT, 'learning')`（worktree 自己的 `learning/`），測試如預期紅；已立即還原。指令原文：

```text
npx vitest run packages/core/src/prompt-quality/live-run.test.ts
```

輸出原文：

```text
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t1-spend-brake

 ❯ packages/core/src/prompt-quality/live-run.test.ts (27 tests | 1 failed) 12525ms
     × ADR-051: 合成 worktree 的預設 router 把帳本接到合成主簽出，不是 worktree 自己 10632ms

 FAIL  packages/core/src/prompt-quality/live-run.test.ts > createDefaultLiveRouter — ADR-050:預設一定要接上記帳,不能悄悄不寫 > ADR-051: 合成 worktree 的預設 router 把帳本接到合成主簽出，不是 worktree 自己
AssertionError: expected false to be true // Object.is equality

 ❯ packages/core/src/prompt-quality/live-run.test.ts:486:39
    484|
    485|       const mainLogPath = join(main, 'learning/state/log.jsonl');
    486|       expect(existsSync(mainLogPath)).toBe(true);
       |                                       ^

 Test Files  1 failed (1)
      Tests  1 failed | 26 passed (27)
```

結論：通過；新測試確實量到主簽出 owner，且清理在結構上不可能碰到真實 `learning/`。

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

「本次驗證的範圍是單一 clone 的帳本。日上限目前以 clone 為單位計算,因此本結論不涵蓋跨 clone 的總額。見工單 T0。」

## 6. 全程零實際花費

所有 router／gateway 測試均注入假 cloud adapter；live-run 的網路邊界以 `globalThis.fetch` 假實作攔截，假 API key 僅為測試字串，未設定真實憑證、未執行 `--live`。第 5 條的 cloud adapter 為測試內計數函式，沒有任何 fetch；第 4 條的唯一 `/v1/messages` 請求由 `installFakeCloud()` 在程序內回覆。指令與輸出原文同第 5 條，結果 `3 passed, 186 passed`。結論：通過，沒有真網路呼叫或費用。

## 變更與交付前檢查

變更僅為兩個測試檔：`packages/core/src/prompt-quality/live-run.test.ts` 的 ADR-051 行為測試，以及 `packages/core/src/llm/router-gateway.test.ts` 的日上限檔案帳本測試；本次退回只替換前者的清理風險測試與本報告第 4 條。舊測試會 `rm -rf` 真實 `learning/`，這是被退回的原因；新測試只刪 `mkdtemp` 直接建立的合成 sandbox。`git diff --check` 已通過；提交後已以新的 HEAD tree SHA 重跑四個指定測試檔，確認提交未改變結果。
