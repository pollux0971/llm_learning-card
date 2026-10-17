# T30 實作報告:缺金鑰時 start 就說清楚、側車每次 start 重讀 .env 與重算今天

日期:2026-10-17。模型:Grok 4.7(xai/grok-4.7)。
開工 HEAD:`6915c3e`(t30-start: main 5be60bd + t30-red 56f355c)。實作 commit:`1956ef4`。
本報告是接著的 commit(提交時還不在下面的 log 裡;提交後 porcelain 空)。
session id:`ses_eb58ae8d3ffe50TYb32RKMsbM3`。
API key:`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`XAI_API_KEY` 都是 `UNSET`。`.env` 不存在(`ls .env` → No such file)。`opencode.json` 的 `permission.skill` 是 `{"*":"deny"}`。開工 `git status --porcelain` 空。
沒有跑變異測試(Stryker、cargo-mutants、`npm run mutate`)、完整 cucumber、`npm run check:all`、`tauri dev`、`tauri build`。沒有執行 `npx tsx scripts/degraded-report.ts`(它會起整套 vitest)。`@manual` 依工單是前端的事,沒跑。重活(vitest 含 headless Chrome、cucumber)用協調者派工時給的位子,`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`,同一時間只有一個。沒有新的靜默預設(`??` / `||` 補值),所以沒改 `scripts/degraded-report.ts`。LLM 真呼叫:0。不寫 ADR。

## 做法

只動工單 touches 裡的實作檔,加新檔 `packages/core/src/llm/credentials.ts`。沒改測試、`.feature`、Rust、HUD 元件、`contracts/`。

- `credentials.ts`:匯出 `requiredGradingKeys`、`missingGradingKeys`、`credentialProblem`、`credentialMessage`,以及從 router 抽出的 `envVarFor`、`resolveProviderName`。只看傳進來的 env,不讀檔、不打網路。openai / anthropic 要那家的鍵;沒設或不認得要 `GATEWAY_API_KEY`。`credentialProblem` 看錯誤自己與 cause 鏈(最多 8 層,見到繞圈就停),第一個認得的算。鍵名只能是三個之一。樣板兩句只換鍵名。
- `router.ts` 不再自己留 `envVarFor`,改呼叫 credentials 的純函式。`resolveProviderName` 也改呼叫同一份(仍看 env,沒有再看 settings 的空字串補值以外的新預設)。
- `index.ts` 轉出上面那些函式,側車與終端機從這裡 import。
- `protocol.ts`:`ERROR_KINDS` 加 `credential-unavailable`,備用句是「批改要用的金鑰不能用。請在專案根目錄的 .env 檢查。」檔頭註明這一種用 `credentialMessage` 的樣板。
- `handler.ts`:`today` 可以是字串或函式;`reloadEnv`、`missingKeys` 都可以不給(不給就是 T22)。start 順序:沒有卡 → 重讀(變了就丟 router 快取)→ 算今天一次 → 暫停日不建 router、不查金鑰 → 否則 `ensureRouter` 再查缺鍵 → `openDay`。進行中的 next / submit / summary / status 用這一輪的今天。submit 先重讀,變了就換 router 再批改;認得憑證錯誤就回 `credential-unavailable`,不清 session。
- `_env.ts` 匯出 `loadDotEnv`。只 import `node:`。用 `parseEnv`。第一次載入之前就有的變數永遠不動。檔案裡的鍵設成現在的值;上次從檔案設、這次沒有的刪掉。檔案不在或讀不到當空檔,不丟錯。`LC_REVIEW_` 開頭一律不設。回傳環境有沒有因此改變。import 的副作用仍是第一次載入。
- `review-sidecar.ts`:`reloadEnv` 是 `loadDotEnv`,`missingKeys` 是 `missingGradingKeys(process.env)`。沒設 `LC_REVIEW_TODAY` 時 `today` 傳 `localToday` 這個函式本身,不是起來時算好的字串;`hello` 的 today 仍是起來那天。`LC_REVIEW_FAKE_CLOUD` 仍只在起來時讀一次。
- `review.ts`:互動模式在驗帳本之後、`openDay` 之前查缺鍵,缺了印同一句、exit 2,還沒建快取。`--dry-run`、`--pause`、已暫停的日子在那之前就返回,不查。答題時 `credentialProblem` 認得的錯印同一句、exit 2,不印小結、不 snapshot。終端機不重讀 `.env`。
- 視窗:`start` 的 `credential-unavailable` 走「再試一次」,訊息原文直接接「改好之後按「再試一次」。」。`submit` 的那種題目與輸入留著,`gradingError` 是側車那一句接「改好之後再按「送出」。」。`App.svelte` 改印 `view.gradingError`,不再寫死「評分失敗,請再試一次」。

## git log

起點 `6915c3e`。

```text
1956ef4 feat(T30): 缺金鑰時 start 就說清楚,側車每次 start 重讀 .env 與重算今天
```

不屬於測試作者 commit 的測試檔變動:空。`git diff --name-only 6915c3e..1956ef4` 對 `*.test.ts`、`features/steps`、`features/support`、`*.feature`、fixtures 沒有輸出。受保護的測試檔(session.test.ts、t30-static.test.ts、review-session-harness.ts、t30-cli / t30-env / t30-handler / t30-sidecar、t30-cloud-401.mjs、credentials.test.ts、protocol.test.ts、review.test.ts)也沒有變動。

## git diff --stat

`git diff --stat 6915c3e..1956ef4`(實作 commit,不含本報告):

```text
 apps/test-card/src/App.svelte         |   2 +-
 apps/test-card/src/session.ts         |  11 +++
 packages/core/src/llm/credentials.ts  | 130 ++++++++++++++++++++++++++++++++++
 packages/core/src/llm/index.ts        |  12 ++++
 packages/core/src/llm/router.ts       |  13 +---
 packages/core/src/session/handler.ts  |  68 +++++++++++++++---
 packages/core/src/session/protocol.ts |   7 +-
 scripts/_env.ts                       |  75 ++++++++++++++++----
 scripts/review-sidecar.ts             |  19 +++--
 scripts/review.ts                     |  30 +++++++-
 10 files changed, 321 insertions(+), 46 deletions(-)
```

工單 touches 裡的 `scripts/degraded-report.ts` 沒改:新程式沒有 `??` / `||` 補值,不用登記。

## git status

實作 commit 之後、本報告提交之前,`git status --porcelain` 只有未追蹤的本報告。本報告提交後必須空。

## learning/ 量測

只量不改。開工與收工相同。

| | sha256 前 16 | 檔數 | state/log.jsonl 行數 |
|---|---|---|---|
| 開工 | c2e4dd6d71de3976 | 64 | 108 |
| 收工 | c2e4dd6d71de3976 | 64 | 108 |

量的是主簽出的 learning/。沒有讀、寫、刪那裡的檔,也沒有碰 raw/、state/ 以外的那次 `wc`。

## 測試

受保護的紅測試在實作後轉綠。全範圍 vitest(工單怎麼跑,再加上派工點名的 t30 與 card-render):

```text
 Test Files  68 passed (68)
      Tests  1698 passed (1698)
   Start at  23:39:54
   Duration  372.71s (transform 1.11s, setup 661ms, import 8.57s, tests 357.46s, environment 5ms)
```

指令:`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/llm packages/core/src/session scripts/review apps/test-card apps/desktop features/support/t30-cli.test.ts features/support/t30-env.test.ts features/support/t30-handler.test.ts features/support/t30-sidecar.test.ts packages/ui-shared/src/hud/card-render.test.ts packages/ui-shared/src/hud/card-render-phase3.test.ts`

cucumber(`NODE_OPTIONS=--import=tsx npx cucumber-js --tags '(@test-card or @review-cli) and not @manual' --format summary`):

```text
57 scenarios (6 undefined, 51 passed)
308 steps (25 undefined, 5 skipped, 278 passed)
1m41.216s (executing steps: 1m40.529s)
```

退出碼 1。6 個 undefined 都是 `features/06-test-card/phase-4.feature` 的未實作步驟,與本張無關,派工寫明基底也一樣。51 個已實作場景通過。

`npx tsc --noEmit`:退出碼 0,沒有輸出。

`npm run boundaries`:

```text
boundaries: 掃描 331 個檔案,允許例外 21 條
涵蓋:納管 387 / 掃描 387 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=331
```

`npx tsx scripts/check-doc-links.ts` 與 `npm run lint:docs`(同一支掃描器):

```text
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=91
```

`npx vitest run scripts/zero-input-guard.test.ts`:

```text
 Test Files  1 passed (1)
      Tests  761 passed | 168 skipped (929)
   Start at  23:50:32
   Duration  42.33s (transform 92ms, setup 39ms, import 93ms, tests 42.09s, environment 0ms)
```

`npx vitest run scripts/degraded-report.test.ts features/support/degraded-registry-rot.test.ts`:

```text
 Test Files  2 passed (2)
      Tests  84 passed (84)
   Start at  23:51:17
   Duration  7.90s (transform 114ms, setup 54ms, import 118ms, tests 7.53s, environment 0ms)
```

## 累計費用

session `ses_eb58ae8d3ffe50TYb32RKMsbM3`,opencode `session_v2.cost` = **$5.560458**(tokens in 317600、out 14281、reasoning 51214、cache read 9064576)。工單 `budget_usd: 5`,派工寫明 grok 不設上限、只記錄。LLM 真呼叫:0(三把 key 都 UNSET)。數字是提交報告前的快照,不含提交報告這一步之後的 token。

## 待協調

沒有。
