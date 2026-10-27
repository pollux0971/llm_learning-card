# T62 實作報告

日期:2026-10-27。模型:Grok 4.7(opencode)。分支:pollux0971/t62-opencode。
開工 HEAD:9a17610(merge: T62 紅測試進起點分支)。LLM 真呼叫 0 次。

## 環境(開工第一行)

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

兩個 key 都是 UNSET,`.env` 不存在(ls 退出碼 2)。跑 CLI 測試前再確認一次,仍是 UNSET / UNSET / No such file。沒建立 .env,沒使用任何 provider 金鑰。沒碰 learning/、raw/。沒改測試、features/**、.feature、contracts/、prompts/、packages/core/src/llm/、scan.ts、topic.ts、其他 scripts/、opencode.json。沒跑變異測試、沒跑 cucumber、沒跑 check:all、沒跑 --live、沒 git push。沒有自己手動跑不帶 --fake 的 scripts/ingest.ts。沒使用 skill,沒登入或登出。

## 做了什麼

沒改契約。packages/core/src/llm/ 沒改。boundaries 沒另登記:scripts/ingest.ts 本來就是 02-ingest-pipeline,改 import packages/core/src/llm/index.js 仍是 02 → 03,scripts/boundaries.allow.json 本來就有這條。例外條數不變(25)。

1. scripts/ingest.ts 不再 import LlmRouterImpl,也不再 `new LlmRouterImpl`。真呼叫改從 packages/core/src/llm/index.js 引 createLiveGatewayRouter、resolveVerifiedLedger、defaultVaultDeps(第 58–64 行)。檔頭「不帶 --fake」那段(第 26–47 行)照實改寫:帳本只接受驗證過的那本,--out 只決定卡片寫到哪。

2. --file(第 205–209 行,ensureInitialized 在第 209 行):驗完參數與分類名之後、ensureInitialized 之前,非 --fake 才呼叫 requireVerifiedLedger(第 82–90 行)。沒驗證過就印 resolved.message、退出碼 2,--out 一個位元組都不動。驗證過先把 ledger 留著,照舊建骨架、建分類、複製 raw。router 仍建在 ensureInitialized 之後(第 254–257 行):createLiveGatewayRouter({ ledger, settings: readLlmSettings(absOut) })。後面探測與 runIngestPipeline 照舊。--fake 不進這條,仍是 FakeLlmRouter,不碰指標檔。

3. 掃描與 --topic:lazyVerifiedRouter(第 97–119 行),照 scripts/grade.ts。第一次 probeOnline 或 call 才解析帳本;失敗印訊息、process.exit(2),不丟錯(掃描與主題會把 probeOnline 的例外當成離線,退出碼會變成 1)。只標 stale / source_missing 的掃描、已經生成過的主題不呼叫 router,沒有帳本也照常。建 router 時一併把 --out 的 settings.yaml 傳進去(顧問裁定 D3:模型設定照舊讀 --out,環境變數優先;帳本與設定可以來自不同資料夾)。opts 原樣轉交,deps 的 maxTokens 不會被丟掉。

4. packages/core/src/ingest/ingest.ts 第 92–93 行:runIngest 的 catch 在 CLOUD_REQUIRED 之後、ModelResponseFormatError 之前,用 isBudgetExceededError(第 199–200 行,跟 isCloudRequiredError 一樣看 code,不看類別名)接 BUDGET_EXCEEDED,回 fail('今日預算已用完(LLM_DAILY_CAP_USD),沒有寫任何卡', 1)。其他錯仍丟,含原本的 ModelResponseFormatError 處理沒動。掃描因此把每個檔收進失敗清單,不停下整個掃描。--topic 仍由 topic.ts 既有的 topicCallFailed 收成一句話,這張沒改 topic.ts。

呼叫端(git grep LlmRouterImpl、isBudgetExceededError、requireVerifiedLedger、lazyVerifiedRouter、runIngest、createLiveGatewayRouter;含 .mjs、.js):

- isBudgetExceededError 沒有 export。只在 ingest.ts 第 92 行與第 199 行。沒有 .mjs、.js 呼叫端。
- requireVerifiedLedger、lazyVerifiedRouter 只在 scripts/ingest.ts。
- scripts/ingest.ts 不再出現 LlmRouterImpl 這個 import 或 new。剩下的 new LlmRouterImpl 在允許的組合檔(router-gateway.ts、router-impl.ts)與 golden-run.ts(G1,T63 才拿掉),以及測試與步驟。features/steps 裡兩處註解仍寫 CLI 自己 new LlmRouterImpl,見待協調。
- runIngest 的生產呼叫端:scripts/ingest.ts 第 244 行(--fake)、ingest.ts 第 303 行(管線)。新的 catch 回 ok: false,不丟。掃描本來就把 ok: false 收進失敗清單;管線本來就在 !ok 時提前回傳。不需要改呼叫端。

## 跑過的指令與輸出原文

worktree 沒有 node_modules。用 tar 從 /data/python/llm_learning-cards 複製(排除 .vite、.vite-temp、node_modules/node_modules;連同 apps/teach-card/node_modules、apps/test-card/node_modules、packages/ui-shared/node_modules;不用 symlink;沒複製 src-tauri/target)。node_modules 在 .gitignore,沒有 add。

跑四個測試檔之前再確認:

```
LS_EXIT:2
OPENAI_UNSET
ANTHROPIC_UNSET
ls: cannot access '.env': No such file or directory
```

CLI 測試自己帶 _fake-cloud.mjs,HOME/XDG 指暫存。沒跑不帶 --fake 的 scripts/ingest.ts,也沒跑會起 CLI 的 cucumber。packages/core/src/ingest/ 目錄裡既有的 t53 掃描測試會自己起不帶 --fake 的 CLI,但那條只標 stale、不呼叫 router;工單要求這條保持綠,所以照指定跑了整個目錄。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/t62-budget-exhausted.test.ts features/support/t62-live-router-guard.test.ts features/support/t62-ingest-cli-ledger.test.ts features/support/t61-cli-bad-model-output.test.ts
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t62-opencode


 Test Files  4 passed (4)
      Tests  32 passed (32)
   Start at  11:56:54
   Duration  17.23s (transform 374ms, setup 80ms, import 1.09s, tests 15.65s, environment 0ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t62-opencode


 Test Files  38 passed (38)
      Tests  643 passed (643)
   Start at  11:57:22
   Duration  29.27s (transform 797ms, setup 372ms, import 6.69s, tests 18.34s, environment 3ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsc --noEmit
```

沒有輸出,退出碼 0。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run boundaries
```

```
boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t62-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t62-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t62-opencode/scripts/gates.config.json
boundaries: 掃描 400 個檔案,允許例外 25 條
涵蓋:納管 458 / 掃描 458 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=400
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run check:json-duplicate-keys
```

```
json-duplicate-keys.scope.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t62-opencode/scripts/json-duplicate-keys.scope.json
✓ 44 個 JSON 設定檔沒有同層重複鍵
gate=json-duplicate-keys result=PASS scanned=44
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsx scripts/check-doc-links.ts
```

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 319 個 markdown 檔,174 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=174
```

交件前 git diff --stat(不含這份報告):

```
 packages/core/src/ingest/ingest.ts |   9 ++++
 scripts/ingest.ts                  | 107 +++++++++++++++++++++++++++++--------
 2 files changed, 93 insertions(+), 23 deletions(-)
```

兩個檔,分屬 packages/core/src/ingest/ 與 scripts/。沒有 boundaries 登記。

## 待協調

無必須改的。features/steps/_fake-cloud.mjs 與 features/steps/ingest-pipeline.steps.ts 的註解仍寫 CLI 自己 new LlmRouterImpl。那是註解,靜態守門不看註解,而且 features/** 受保護,這張沒改。若要讓註解跟上實作,請協調者另開,不要算這張漏改。
