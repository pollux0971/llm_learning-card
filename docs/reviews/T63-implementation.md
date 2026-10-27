# T63 實作報告

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

日期:2026-10-27。模型:Grok 4.7(opencode)。分支:pollux0971/t63-opencode。
開工 HEAD:8a05962(merge: T63 紅測試進起點分支)。LLM 真呼叫 0 次。

兩個 key 都是 UNSET,`.env` 不存在(ls 退出碼 2)。沒建立 .env,沒使用任何 provider 金鑰。沒碰 learning/、raw/。沒改測試、contracts/、docs/(這份報告除外)、prompts/、packages/core/prompts/、packages/core/src/llm/、.feature、scripts/、opencode.json。沒跑 live golden、沒跑 --live、沒跑變異測試、沒跑 cucumber、沒跑 check:all。沒 git push。沒使用 skill,沒登入或登出。

## 做了什麼

只改工單 touches 的兩個檔。ADR-083 唯讀,沒改契約。LLM_DAILY_CAP_USD=0 沒拿來當「用完」(spend.ts 對 cap 不大於 0 回沒設上限)。

1. packages/core/src/prompt-quality/golden-run.ts
   - 第 70 行 LiveRunBudgetExceededError。訊息一句話,含「今日預算已用完」與 LLM_DAILY_CAP_USD,沒有換行。
   - 第 420 行 GOLDEN_FALLBACK_TABLE:契約 §7 的七個 LlmTask 全部 cloud-only,Object.freeze。
   - 第 434 行 liveBudgetExhausted:router 有 budgetExhausted 而且回 true 才算用完;沒有這個方法的測試 router 不查。用 call 綁定,方法讀 this 不會指錯。
   - 第 346 行 runGoldenLive:probeOnline() 之後、讀 prompt 檔與 mkdirSync 之前查預算,用完就丟 LiveRunBudgetExceededError。離線仍先丟 LiveRunOfflineError。
   - 第 458 行 createDefaultLiveRouter 改走 createLiveGatewayRouter。帳本仍是 resolveVerifiedLedger,失敗丟錯、不建任何目錄;照舊先建驗證過那本的 state/。settings 仍是 readLlmSettings(settingsDir)。fallbackTable 是 GOLDEN_FALLBACK_TABLE。localProber 固定回不可用。
   - 第 476 行回傳的 router:call、probeOnline、budgetExhausted 直接委派;只包 probeLocal,固定回 available false、models 空陣列,不碰閘道。
   - 這個檔不再 new LlmRouterImpl。

2. packages/core/src/prompt-quality/cli.ts 第 286 行:LiveRunBudgetExceededError 跟 LiveRunOfflineError 同一段處理(✗ 加訊息、退出碼 1,不印堆疊)。

boundaries 沒另登記。12-prompt-quality 到 03-llm-router 本來就在 scripts/boundaries.allow.json。這次跑 boundaries 允許例外仍是 25 條。scripts/ 受保護,沒改那條理由文字(仍寫 LlmRouterImpl)。

呼叫端(git grep,含 .mjs、.js;不含 node_modules):

- GOLDEN_FALLBACK_TABLE、LiveRunBudgetExceededError、liveBudgetExhausted:生產碼只有 golden-run.ts 與 cli.ts。測試是 t63-golden-cap.test.ts 的動態取值,沒改。
- createDefaultLiveRouter:golden-run.ts 第 341 行自己呼叫。測試呼叫端 live-run.test.ts、t63-golden-cap.test.ts、packages/core/src/llm/vault-reject.live.test.ts(子行程字串)簽章沒變,沒改那些檔。
- createLiveGatewayRouter 既有呼叫端(scripts/llm.ts、scripts/grade.ts、scripts/review.ts、scripts/review-sidecar.ts、packages/core/src/llm/router-gateway.ts)沒改。
- .mjs、.js 沒有這幾個新符號的呼叫端。

## 跑過的指令與輸出原文

worktree 沒有 node_modules。用 tar 從 /data/python/llm_learning-cards 複製(排除 .vite、.vite-temp、巢狀 node_modules;連同 apps/teach-card/node_modules、apps/test-card/node_modules、packages/ui-shared/node_modules;不用 symlink;沒複製 src-tauri/target)。那三個套件目錄在來源裡只有 .vite 與 .vite-temp,排除後是空目錄。node_modules 在 .gitignore,沒有 add。

指令前面都加了 CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/prompt-quality/t63-golden-cap.test.ts packages/core/src/prompt-quality/live-run.test.ts
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t63-opencode

 Test Files  2 passed (2)
      Tests  50 passed (50)
   Start at  11:23:19
   Duration  10.24s (transform 286ms, setup 47ms, import 957ms, tests 9.05s, environment 0ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/prompt-quality/ packages/core/src/llm/ scripts/prompt-check.test.ts
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t63-opencode

 Test Files  40 passed (40)
      Tests  1128 passed (1128)
   Start at  11:23:35
   Duration  24.26s (transform 692ms, setup 350ms, import 4.94s, tests 15.17s, environment 3ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsc --noEmit
```

無輸出,退出碼 0。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run boundaries
```

```
> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t63-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t63-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t63-opencode/scripts/gates.config.json
boundaries: 掃描 399 個檔案,允許例外 25 條
涵蓋:納管 457 / 掃描 457 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=399
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run check:json-duplicate-keys
```

```
> check:json-duplicate-keys
> tsx scripts/check-json-duplicate-keys.ts

json-duplicate-keys.scope.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t63-opencode/scripts/json-duplicate-keys.scope.json
✓ 43 個 JSON 設定檔沒有同層重複鍵
gate=json-duplicate-keys result=PASS scanned=43
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsx scripts/check-doc-links.ts
```

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 317 個 markdown 檔,174 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=174
```

寫完這份報告後再跑一次(掃描數多這一個檔):

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 318 個 markdown 檔,174 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=174
```

交件前實作 diff(還沒含這份報告):

```
 packages/core/src/prompt-quality/cli.ts        |  6 +-
 packages/core/src/prompt-quality/golden-run.ts | 86 +++++++++++++++++++++-----
 2 files changed, 72 insertions(+), 20 deletions(-)
```

兩個檔都在 packages/core/src/prompt-quality/。

## 待協調

無。測試沒有看起來錯的地方,沒改測試。
