# T59 實作報告

UNSET
UNSET
ls: cannot access '.env': No such file or directory

日期:2026-10-27。模型:Grok 4.7(opencode)。分支:pollux0971/t59-opencode。
開工 HEAD:c7b47af(merge: T59 紅測試進起點分支)。LLM 真呼叫 0 次。

兩個 key 都是 UNSET,.env 不存在(ls 退出碼 2)。沒建立 .env,沒使用任何 provider 金鑰。沒碰 learning/、raw/。沒改測試、步驟、.feature、contracts/、prompts/、routing.ts、router.ts、router-impl.ts、router-gateway.ts、fallback.ts、spend.ts、05-grading、02-ingest、07。沒跑變異測試、沒跑 check:all、沒跑 --live、沒 git push。沒使用 skill,沒登入或登出。docs/ 只加了這份報告。

## 做了什麼

顧問裁定 D1 乙:只做佇列與包裝,不接呼叫端。D2 drain 只讀、resolve 才刪。D3 changed 由呼叫端給。D4 壞檔備份。D5 格式不寫進契約。沒改契約。

1. 新增 packages/core/src/llm/provisional-queue.ts。
   - 第 21 行 ProvisionalEntry。card 用契約 §1 的 CardIdSchema;檔案內容用 zod(第 33 行 EntrySchema、第 42 行 QueueFileSchema)。task 必須在 LLM_TASKS;local_sha256 是 64 位小寫十六進位;queued_at 是含時區的 ISO 8601;max_tokens 是選填正整數。
   - 第 120 行 provisionalQueuePath:回 learningDir/state/provisional-queue.json。
   - 第 124 行 ProvisionalQueue。建構子 new ProvisionalQueue({ path, log, now? });now 沒給就用 new Date().toISOString()(第 132 行)。
   - 第 136 行 enqueue:同一個 card + task 拿掉舊的、新的放最後;沒給 maxTokens 就不留舊的 max_tokens。雜湊是本機結果 text 的 UTF-8 sha256(第 58 行)。
   - 第 143 行 list、第 151 行 drain:回複本。drain 先問 isOnline;離線直接回空陣列,不呼叫 load。在線才讀。
   - 第 161 行 resolve:鍵是 card + task。有那一筆才寫檔並記 provisional_resolved(changed 原樣、cloud_sha256 是 cloudText 的 sha256);沒有則不寫、不記、回 false。
   - 第 179 行 load 是唯一讀檔入口。檔不存在是空佇列,不是壞檔。不是合法 JSON 或 zod 不過都算壞檔。
   - 第 192 行 quarantine:rename 成 provisional-queue.json.corrupt-加上 UTC 毫秒(第 63 行,例如 20261027T093000123Z);同名已有檔依序加 -2、-3,不蓋舊檔。然後寫空陣列、記 warning(reason provisional_queue_corrupt,backup 只有檔名)。
   - 第 187 行 save:寫檔一律走 writeFileAtomic。空陣列寫成 []。
   - 第 211 行 recordProvisional:provisional === true 才 enqueue;opts.maxTokens 有給才帶 maxTokens;timeoutMs 不記。回傳值原樣;inner 丟錯原樣往外丟;probeOnline、probeLocal 直接委派。
2. packages/core/src/llm/index.ts 第 102 到 110 行匯出 ProvisionalQueue、provisionalQueuePath、recordProvisional、ProvisionalEntry,以及 EnqueueArgs、ProvisionalQueueOptions。

事件交給建構子注入的 LogAppender,不在佇列裡自己開 log 路徑。測試注入的就是這個函式;正式接線時由呼叫端把 LogAppender 指到 @core/schema/log.js 的 recordEvent(跟 router.ts 同一種做法)。所以這張沒有直接 import log.js。

boundaries 沒另登記。scripts/boundaries.owners.json 已有 packages/core/src/llm/ 這個目錄前綴,新檔落在同一個資料夾。import 是 @core/schema/atomic-write.js(03 到 01,例外本來就有)與 @contracts/index.js(一律放行)。例外條數仍是 25。

呼叫端(git grep ProvisionalQueue、provisionalQueuePath、recordProvisional、ProvisionalEntry,含 .mjs、.js):
- 生產碼只有新檔自己,以及 index.ts 第 104 到 108 行的匯出。沒有既有呼叫端被改到簽章。
- 測試(沒改):packages/core/src/llm/provisional-queue.test.ts、features/steps/llm-router-phase3.steps.ts。它們動態 import 新檔,不從 index 取值(index 那條單元測試除外)。
- .mjs、.js 沒有呼叫端。gradeApply、generateDeepen 沒包 recordProvisional(D1,留給後面的小票)。

## 跑過的指令與輸出原文

worktree 沒有 node_modules。用 tar 從 /data/python/llm_learning-cards 複製(排除 .vite、.vite-temp、node_modules/node_modules;連同 apps/teach-card/node_modules、apps/test-card/node_modules、packages/ui-shared/node_modules;不用 symlink;沒複製 src-tauri/target)。node_modules 在 .gitignore,沒有 add。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/llm/provisional-queue.test.ts
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t59-opencode


 Test Files  1 passed (1)
      Tests  40 passed (40)
   Start at  11:04:51
   Duration  743ms (transform 235ms, setup 46ms, import 80ms, tests 515ms, environment 0ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/llm/
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t59-opencode


 Test Files  19 passed (19)
      Tests  713 passed (713)
   Start at  11:05:00
   Duration  8.06s (transform 393ms, setup 196ms, import 1.81s, tests 4.18s, environment 2ms)
```

跑場景前再 ls .env,仍是 No such file。cucumber 要載入 TypeScript 步驟,所以加了專案 accept 腳本同款的 NODE_OPTIONS=--import=tsx(工單驗收條件也寫了這段)。tag 照派工單,多加 not @manual。

```
ls .env
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@llm-router and @phase-3 and not @manual'
```

```
ls: cannot access '.env': No such file or directory
lc-fs rebuilt:    Compiling learning-cards-desktop v0.0.0 (/home/pollux/orca/workspaces/llm_learning-cards-workers/t59-opencode/apps/desktop/src-tauri) |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 39s
.......................................................................................................................................................................................................................

8 scenarios (8 passed)
31 steps (31 passed)
1m39.938s (executing steps: 0m00.074s)
```

那次編譯是既有 hook 重建 lc-fs,不是這張改的。src-tauri/target 沒進 commit。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsc --noEmit
```

```
TSC_OK
```

(tsc 沒有別的輸出。)

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run boundaries
```

```
boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t59-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t59-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t59-opencode/scripts/gates.config.json
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
json-duplicate-keys.scope.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t59-opencode/scripts/json-duplicate-keys.scope.json
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

寫完這份報告後又跑了一次 doc-links(報告本身多一個 markdown),以及拿掉未使用常數之後再跑一次單元:

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/llm/provisional-queue.test.ts
```

```
 Test Files  1 passed (1)
      Tests  40 passed (40)
   Start at  11:09:00
   Duration  4.14s (transform 228ms, setup 51ms, import 77ms, tests 3.91s, environment 0ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsx scripts/check-doc-links.ts
```

```
doc-links: 掃描 318 個 markdown 檔,174 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=174
```

沒跑 Stryker、沒跑 npm run mutate。變異留給驗收 agent。

## 待協調

無。測試沒有要改的地方。呼叫端仍不接(D1 乙);deepen 的鍵與真閘道 @manual 留在工單的低優先小票。
