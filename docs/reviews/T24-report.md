# T24 實作報告:考試卡 phase-2,拿掉 stubs,改吃複習側車

日期:2026-10-17。模型:Grok 4.7(xai/grok-4.7)。
開工 HEAD:`1a4ce5a`(紅測試分支 tip)。實作 commit:`54a75e9`。
本報告是接著的 commit(提交時還不在下面的 log 裡;提交後 porcelain 空)。
session id:`ses_eb7c9326affeMvSXlj4CjL6Dda`。
API key:`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`XAI_API_KEY` 都是 `UNSET`。`.env` 不存在。`opencode.json` 的 `permission.skill` 是 `{"*":"deny"}`。開工 `git status --porcelain` 空。
沒有跑變異測試、`npm run check:all`、`tauri dev`、`tauri build`、`npx tsx scripts/degraded-report.ts`(不帶 `--in` 會起整套 vitest)。vitest / cucumber 前綴 `CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1`。cucumber 只用 `--tags`,沒給 feature 檔路徑。重活位子由協調者於 13:29 給,跑完已釋放。

## 做法

`TestSession` 只依賴桌面殼的 `ReviewClient` 與 `Pick<LearningFs, 'read'>`。`start` / `next` / `submit` 用讀取函式收窄成畫面型別;缺必要欄位當 bad-response,走「複習程式停了」。不自己排程、不自己批改、不讀 `reviews.json`。填空陣列原樣送。批改 `status === 'error'` 時題目與輸入留著。`next` 回 `done` 才呼叫 `summary`。縮短版經 `fs.read` 去掉開頭 frontmatter,純文字顯示;`short` 為 false 時加「先看原卡」那句。錯誤畫面不顯示 stack、原始 JSON 或例外原文。`root-mismatch` / `not-configured` 不給「重新開始」。

`main.ts` 用 `isTauri()` 分流:Tauri 內 `createReviewClient()` 與 `createLearningFs()`;瀏覽器走 `POST /__review`,`fs.read` 一律丟錯。`vite.config.ts` 加 `@core` alias(寫法照根目錄 `vitest.config.ts`),並掛 `dev/standalone` plugin。`scripts/boundaries.allow.json` 加 06-test-card → 10-desktop-shell,理由寫 ADR-075。

單獨執行:暫存根複製 `contracts/fixtures/learning-minimal`,用 `dev/reviews.seed.json` 蓋 `state/reviews.json`,`vault.ts init` 在暫存的 `HOME` / `XDG_*` 底下做,起同一支 `scripts/review-sidecar.ts`,環境帶 `LC_REVIEW_FAKE_CLOUD` 與 `LC_REVIEW_TODAY=2026-09-10`。暫存根跟 dev server 同生命,重新載入不重新種子。`GET /__review` 回 405,不轉給側車。

`scripts/degraded-report.ts` 的 `NOT_INSTRUMENTED` 整筆刪掉指向 stubs 與舊 `session.ts` 的 4 筆登記和它們上面的註解。新程式沒有用 `??` / `||` 補缺欄位,所以沒有新登記。

種子的 `learned_at` 讓 stage 1(只有填空)排在最前,否則逾期比相同時最早學的 stage 3 會先出應用題,T15 的 Enter 路徑量不到填空。

## git log

起點 `1a4ce5a`。

```text
54a75e9 feat(T24): 考試卡拿掉 stubs,改吃複習側車(ADR-075)
```

不屬於測試作者 commit 的測試檔變動:空。沒有改 `*.test.ts`、`features/steps/**`、`features/support/**`、`.feature`、fixtures、向量檔、帶 SOURCE 標頭的模板、`packages/core/prompts/`、`contracts/`。沒有寫 ADR。

## git diff --stat

`git diff --stat 1a4ce5a..54a75e9`(實作 commit,不含本報告):

```text
 apps/test-card/dev/fake-cloud.mjs     |  71 +++++
 apps/test-card/dev/reviews.seed.json  |  29 ++
 apps/test-card/dev/standalone.ts      | 255 +++++++++++++++++
 apps/test-card/package.json           |   2 +-
 apps/test-card/src/App.svelte         | 141 ++++++----
 apps/test-card/src/main.ts            |  26 +-
 apps/test-card/src/session.ts         | 501 +++++++++++++++++++++++++---------
 apps/test-card/src/stubs/.gitkeep     |   0
 apps/test-card/src/stubs/fixtures.ts  |  88 ------
 apps/test-card/src/stubs/grader.ts    |  66 -----
 apps/test-card/src/stubs/loader.ts    |  28 --
 apps/test-card/src/stubs/memory-fs.ts |  52 ----
 apps/test-card/src/stubs/scheduler.ts |  88 ------
 apps/test-card/src/types.ts           | 133 +++------
 apps/test-card/vite.config.ts         |  11 +-
 scripts/boundaries.allow.json         |   5 +
 scripts/degraded-report.ts            |   5 -
 17 files changed, 889 insertions(+), 612 deletions(-)
```

提交本報告前 `git status --porcelain` 只有這份未追蹤檔。提交後應為空。

## 開工紅

```bash
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/test-card --reporter=verbose
```

```text
 Test Files  3 failed (3)
      Tests  129 failed | 2 passed (131)
   Start at  13:03:55
   Duration  1.68s
```

派工參考是 154 條、149 紅 / 5 綠。這個 HEAD 沒有 `apps/test-card/src/stubs/scheduler.test.ts`(紅測試作者已刪),所以少了那一批,不是測試被改。紅的原因是 `init` 還不存在、stubs 還在、standalone 還沒寫。

## 轉綠

cucumber(協調者 13:29 給的重活位子):

```bash
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@test-card and (@phase-1 or @phase-2) and not @manual' --format summary
```

```text
lc-fs rebuilt:     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.19s
15 scenarios (15 passed)
72 steps (72 passed)
0m41.770s (executing steps: 0m41.026s)
```

phase-1 的非 `@manual` 場景含在這 15 條裡,全綠。

其他:

- `apps/test-card` vitest(session、靜態、standalone 15 條)全綠
- `features/support/test-card-core.test.ts`、`features/support/degraded-registry-rot.test.ts` 綠
- `apps/desktop` 226 條綠
- T15 `packages/ui-shared/src/hud/card-static.test.ts` 綠;`card-render.test.ts` 18 條綠
- `npx tsc --noEmit` 0 錯
- `npm run boundaries` PASS(掃描 326,允許例外 21)
- `npm run build -w apps/test-card` 成功
- `npx vitest run scripts/degraded-report.test.ts` 綠(沒跑 `degraded-report.ts` 本身)
- `npx vitest run scripts/zero-input-guard.test.ts` 綠
- `npx tsx scripts/check-doc-links.ts` 綠;`npm run lint:docs` 綠

## learning/ 前後量測

只量不改。量法:在 `/data/python/llm_learning-cards/learning` 做雜湊前 16 碼、檔案數、`state/log.jsonl` 行數。沒有讀寫 `learning/`、`raw/`、`state/` 的內容。

| 時點 | 雜湊前 16 碼 | 檔案數 | log 行數 |
|---|---|---|---|
| 開工 | c2e4dd6d71de3976 | 64 | 108 |
| 收工(報告 commit 前) | c2e4dd6d71de3976 | 64 | 108 |

前後相同。

## 累計費用

session `ses_eb7c9326affeMvSXlj4CjL6Dda`,opencode `session_v2.cost` = **$9.949382**(tokens in 528315、out 21431、reasoning 63439、cache read 10279424)。工單 `budget_usd: 5`,派工寫明 grok 不設上限、只記錄。LLM 真呼叫:0(三把 key 都 UNSET,批改走假 router)。

## 待協調

無。`@manual` 與 `tauri build` 依工單是前端的事,這次位子沒有要求,沒跑。
