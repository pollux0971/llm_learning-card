# T3 B3' 實作報告:鏈輸出 wrapper

日期:2026-10-26。模型:Grok 4.7(opencode)。
開工 HEAD:`ae71033`(分支 `pollux0971/t3b-opencode`)。
範圍:只做工單「階段 B(2026-10-26 縮小為 B3')」與「B3' 鏈輸出 wrapper」,以及驗收條件 B3' a–e。B1a、B1b、B2、原條件 2–7 沒做。

開工金鑰檢查(exit 2,`.env` 不存在是預期的):

```text
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

沒有跑變異測試、沒跑 `npm run check:all`、沒跑整條鏈、沒跑 `check:test-ledger` / `run-tests`、沒有 `--live` 或真 LLM 呼叫。沒有建立或使用 `.env`,沒有使用 provider 金鑰。沒改測試檔、`features/steps/**`、`features/support/**`、`.feature`、`fixtures`、`scripts/check-all.ts`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`packages/core`、`opencode.json`。沒有 `git push`。沒登入、沒登出、沒用 skill。

## 做了什麼

`npm run check:all` 改成走 consumer 自己的 wrapper,再由 wrapper 用絕對路徑起動原本的 `scripts/check-all.ts`。模板檔一個位元組都沒動(`git diff -- scripts/check-all.ts` 為空)。

1. 新增 `scripts/check-all-wrapped.ts`(不帶 SOURCE 標頭)。
   - 匯出 `runWrapped` 在 scripts/check-all-wrapped.ts 第 60 行:resolve 退出碼、不自己 `process.exit`、`intervalMs` 不設下限。
   - wrapper 自己的行全部 `process.stderr.write`,前綴 `[chain-env] start|end|sample`,欄位 host / cores / workers / load / time。沒設 `VITEST_MAX_WORKERS` 印 `default`(scripts/check-all-wrapped.ts 第 25 行)。時間戳用 `toISOString()`(Z,ISO 8601 含時區)。
   - 子行程 `stdio: 'inherit'`(scripts/check-all-wrapped.ts 第 103 行),wrapper 不經手子行程的位元組。
   - 取樣計時器在子行程結束時 `clearInterval`(scripts/check-all-wrapped.ts 第 94 行),resolve 後行程能自己結束。
   - 被訊號殺掉回 128 + 訊號編號(scripts/check-all-wrapped.ts 第 118 行)。起不來回 127,仍印結束行(第 109 行)。
   - SIGINT / SIGTERM 轉給子行程、自己不退、等子行程結束再回碼(第 72–101 行)。
   - CLI 讀 `CHAIN_ENV_SAMPLE_MS`,預設 30000;不是正整數字串或小於 100,在起動 check-all 之前退出碼 2,stderr 點名該變數(第 126–137 行)。
   - CLI 用 `process.execPath` 起 `tsx/cli` 的絕對路徑再加 `scripts/check-all.ts` 的絕對路徑,參數 `process.argv.slice(2)` 原樣轉發(第 149–154 行)。不使用 `--import tsx`,不靠 cwd 解析 tsx。
2. `package.json` 第 26 行:`check:all` 改成 `tsx scripts/check-all-wrapped.ts`。只改這一行。
3. `scripts/zero-input-roster.ts` 第 278 行抽出 `checkAllCommand`。`scripts/check-all.ts` 與 `scripts/check-all-wrapped.ts`(第 385 行)的四個 probe 與 healthy 基線用同一批函式參考,不是複製一份。probe 名字與四種 kind 跟 check-all 相同。
4. `scripts/boundaries.owners.json` 第 224 行登記 `scripts/check-all-wrapped.ts` 為 infra。測試檔的登記沒拿掉。

工單 B2 節的射程句原文(本次沒做鎖,照錄、不代表這次實作了鎖):

> 本鎖解決整條 check:all 之間的互斥;與 .stryker.lock(變異測試之間互斥)是兩把,各管各的;不解決單條鏈內部的 CPU 占用。

單條鏈內部的 CPU 占用屬 B1,不屬 B2。兩者本次都不做。

## 待協調

沒有。受保護的測試沒改。`scripts/check-all.ts` 無差異。允許跑的測試與守門都綠。整條鏈依工單禁止沒跑,所以沒有整鏈計時可回報。

## 指令與輸出原文

開工金鑰檢查:

```text
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run scripts/check-all-wrapped.test.ts`:

```text
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t3b-opencode


 Test Files  1 passed (1)
      Tests  47 passed (47)
   Start at  22:41:20
   Duration  18.83s (transform 99ms, setup 43ms, import 84ms, tests 18.60s, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run scripts/zero-input-guard.test.ts`:

```text
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t3b-opencode


 Test Files  1 passed (1)
      Tests  789 passed | 174 skipped (963)
   Start at  22:41:42
   Duration  43.67s (transform 104ms, setup 47ms, import 106ms, tests 43.39s, environment 0ms)
```

`npx tsc --noEmit`:無輸出,exit 0。

`npm run boundaries`:

```text
> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t3b-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t3b-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t3b-opencode/scripts/gates.config.json
boundaries: 掃描 398 個檔案,允許例外 24 條
涵蓋:納管 456 / 掃描 456 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=398
```

`npx tsx scripts/check-doc-links.ts`:

```text
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 299 個 markdown 檔,154 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=154
```

交件前 `git diff --stat`(報告尚未寫入時):

```text
 package.json                   |  2 +-
 scripts/boundaries.owners.json |  4 ++++
 scripts/zero-input-roster.ts   | 46 +++++++++++++++++++++++++++---------------
 3 files changed, 35 insertions(+), 17 deletions(-)
```

`git diff -- scripts/check-all.ts` 無輸出。未追蹤的實作檔是 `scripts/check-all-wrapped.ts`。worktree 原本沒有 `node_modules`,用 tar 從 `/data/python/llm_learning-cards` 複製(排除 `.vite`、`.vite-temp`、`node_modules/node_modules`,連同 apps/teach-card、apps/test-card、packages/ui-shared 的 node_modules;沒有 symlink 當 node_modules;沒複製 src-tauri/target)。`node_modules` 被 gitignore,沒有 add、沒有 commit。

## 第二輪

起點:`git merge --ff-only t3b-round2`,快轉到 `f60b812`(驗收證據與補測)。只改 `scripts/check-all-wrapped.ts`,沒改測試檔。顧問點名的 7 件:

1. `CHAIN_ENV_SAMPLE_MS` 只收純十進位整數字串(無前導零、無空白),且 100 ≤ n ≤ 3600000。否則在印 start 之前退出碼 2、stderr 點名該變數。scripts/check-all-wrapped.ts 第 108–119 行。
2. load 取值刪掉 undefined / NaN / 負值守衛,直接 `toFixed(2)`。`loadavg()` 用 `as [number, number, number]` 應付 `noUncheckedIndexedAccess`。第 32–38 行。
3. `signalNumber` 的 `typeof` 後備刪掉,直接回 `constants.signals[signal]`。第 49–51 行。
4. 訊號 handler 改在 `spawn` 之後才註冊(第 66 行 spawn,第 90–91 行註冊)。刪掉 `pending` 與 spawn 後的補轉。`forward` 不再檢查 child 是否存在。
5. `forward` 只留 `child.kill(sig)`。已退出檢查與 try/catch 刪掉。第 68–70 行。
6. close handler 的 `failedToStart` 分支刪掉。error 與 close 都走 `finish`,重入守衛保留(第 82 行)。
7. 匯出 `childArgs`。第 123–125 行。main 寫成 `childArgs(tsxCli, checkAll, process.argv)`。第 140 行。

保留沒刪:`detach`(第 76–79 行)、`isDirectRun` 的 argv1 檢查(第 127–130 行)、main 最外層 catch(第 146–151 行)。`ChildProcess` 型別 import 因 child 不再是 optional 而拿掉,沒有別的邏輯改動。

### 待協調

沒有。沒跑變異、沒跑 `npm run check:all`、沒跑整鏈。

### 指令與輸出原文

`git merge --ff-only t3b-round2`:

```text
Updating 44db1bb..f60b812
Fast-forward
 docs/reviews/acceptance-T3B-impl.md |  59 +++++++++++++
 scripts/check-all-wrapped.test.ts   | 170 +++++++++++++++++++++++++++++++++++-
 stryker.t3b-wrapper.json            |  32 +++++++
 3 files changed, 260 insertions(+), 1 deletion(-)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run scripts/check-all-wrapped.test.ts`:

```text
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t3b-opencode


 Test Files  1 passed (1)
      Tests  74 passed (74)
   Start at  23:47:03
   Duration  24.64s (transform 158ms, setup 71ms, import 111ms, tests 24.34s, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run scripts/zero-input-guard.test.ts`:

```text
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t3b-opencode


 Test Files  1 passed (1)
      Tests  789 passed | 174 skipped (963)
   Start at  23:47:32
   Duration  45.05s (transform 244ms, setup 132ms, import 157ms, tests 44.63s, environment 0ms)
```

`npx tsc --noEmit`:無輸出,exit 0。

`npm run boundaries`:

```text
> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t3b-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t3b-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t3b-opencode/scripts/gates.config.json
boundaries: 掃描 398 個檔案,允許例外 24 條
涵蓋:納管 456 / 掃描 456 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=398
```

`npx tsx scripts/check-doc-links.ts`:

```text
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 301 個 markdown 檔,154 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=154
```

