# T23 實作報告:考試卡 phase-3(逾期數、小結、stuck、續答)

日期:2026-10-17。模型:Grok 4.7(xai/grok-4.7)。
開工 HEAD:`1291f12`(t23-start: main 17a1387 + t23-red 1034a17)。實作 commit:`f075db3`。
本報告是接著的 commit(提交時還不在下面的 log 裡;提交後 porcelain 空)。
session id:`ses_eb60e1999ffedQ6kv2vsOM7Oqa`。
API key:`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`XAI_API_KEY` 都是 `UNSET`。`.env` 不存在(`ls .env` → No such file)。`opencode.json` 的 `permission.skill` 是 `{"*":"deny"}`。開工 `git status --porcelain` 空。
沒有跑變異測試(Stryker、cargo-mutants、`npm run mutate`)、完整 cucumber、`npm run check:all`、`tauri dev`、`tauri build`。`@manual` 依工單是前端的事,沒跑。重活(vitest 含 headless Chrome、cucumber)用協調者派工時給的位子,`VITEST_MAX_WORKERS=1`。沒有新的靜默預設(`??` / `||` 補值),所以沒改 `scripts/degraded-report.ts`。LLM 真呼叫:0。

## 做法

只動工單 touches 裡的四個實作檔。沒改測試、`.feature`、`apps/desktop/`、`packages/ui-shared/` 的 HUD 元件、`scripts/review*.ts`。不寫 ADR。

- `packages/core/src/session/handler.ts` 的 `startResult` 加 `overdue`:當日快取名單 `dayCache.queue` 裡 `overdue_days ≥ 1` 的張數(剛好逾期 1 天要算;今天到期的不算;reteach 佇列不在 queue,不另外加)。`ready`、`paused`、`empty` 都走這一個函式,所以三種結果都帶。答題不改名單,同一天重開還是同一個數。
- `apps/test-card/src/session.ts` 的 `readStart` 要求 `overdue` 是有限數字,缺、字串、NaN、Infinity 走 bad-response(「複習程式停了。」+「重新開始」),不補預設。`overdueCount` 只在 question 狀態露出,值是 start 的 `overdue`,不是目前這張卡的 `overdueDays`;其他狀態是 0。
- 新增 `readSummary`。`passed`、`returned`、`retryLater`、`tomorrow` 的四個欄位、`snapshot` 缺一或型別錯就是 bad-response。`answeredThisRun` 可缺,有的話必須是有限數字;讀進來但不顯示。`summaryLines` 只有 `done` 才有,其他狀態(含 loading)是空陣列 `[]`。句子在 session.ts 組好,畫面只印。
- 小結三到四句:「通過 N 張、退回 N 張。」;只有 `retryLater > 0` 才加「另有 N 題評分失敗,下次再考。」;`tomorrow.capped` 為 false 說「明天預估 N 張。」,為 true 說「明天預估 N 張(已到每天上限,另 N 張順延)。」
- `showRetry` 裡重複的 `clearCard()` 與 `submitting = false` 已刪。`showStopped` 與 `showError` 的 `submitting = false` 也刪,只留 `submit()` 的 `finally` 那一份。`showError` 的 `clearCard()` 留著。
- root-mismatch、not-configured 改成 message 原文直接接 vault 提示,中間不加空白。
- `apps/test-card/src/types.ts` 的 `SessionView` 加 `overdueCount`、`summaryLines`。
- `apps/test-card/src/App.svelte`:header 順序是「已答 / 總數」→「逾期 N」(一般字色,不用 `--hud-fail`)→ HP 條。stuck 為 true 時題幹上面一行「這張卡已經連續答錯 3 次以上。」,樣式跟 reteach 說明一樣(`--hud-fail`)。小結的 `{#each view.summaryLines}` 只放在 `view.state === 'done'` 分支,不放在共用的 paused/empty/done/error 分支。reteach 的「繼續」改到說明那一行之後、`<pre class="reteach">` 之前。

## git log

起點 `1291f12`。

```text
f075db3 feat(T23): 考試卡顯示逾期數、小結與 stuck
```

不屬於測試作者 commit 的測試檔變動:空。`git diff --name-only 1291f12..f075db3` 對 `*.test.ts`、`features/steps`、`features/support`、`*.feature`、fixtures 沒有輸出。

## git diff --stat

`git diff --stat 1291f12..f075db3`(實作 commit,不含本報告):

```text
 apps/test-card/src/App.svelte        | 13 +++++-
 apps/test-card/src/session.ts        | 81 ++++++++++++++++++++++++++++++++----
 apps/test-card/src/types.ts          |  6 ++-
 packages/core/src/session/handler.ts |  6 +++
 4 files changed, 96 insertions(+), 10 deletions(-)
```

加上本報告後,`1291f12..HEAD` 預期五檔:上面四個,加 `docs/reviews/T23-report.md`。沒有 `scripts/degraded-report.ts`。

## git status --porcelain

提交本報告後 `git status --porcelain` 沒有輸出(空)。

## learning/ 量測

只量不改。量法是工單指定的那一條(主簽出的 learning/,不是這個 worktree)。

開工:

```text
c2e4dd6d71de3976
64
108
```

收工(寫本報告前再量一次):

```text
c2e4dd6d71de3976
64
108
```

前後相同。

## 開工紅

指令(含 headless Chrome):

```bash
VITEST_MAX_WORKERS=1 npx vitest run apps/test-card apps/desktop packages/core/src/session packages/ui-shared/src/hud/card-render.test.ts packages/ui-shared/src/hud/card-render-phase3.test.ts features/support/test-card-phase3-core.test.ts
```

```text
 Test Files  5 failed | 35 passed (40)
      Tests  86 failed | 766 passed (852)
   Start at  21:01:08
   Duration  221.78s (transform 998ms, setup 729ms, import 7.70s, tests 208.79s, environment 3ms)
```

退出碼 1。紅的是逾期數、小結、stuck、reteach「繼續」位置、root-mismatch 多一個空白,以及 Chrome header 的「逾期 N」。協調者給的參考基底(輕量 vitest 79 紅 / 207 綠、Chrome 4 紅 / 22 綠)跟這次合併跑的 86 紅對得上(79 + Chrome 那 4 條,再加上合併集合裡多出來的幾條)。T24 已做的收窄、點鈕、刪重複那幾組在基底上本來就綠,這次沒把它們改壞。

cucumber:

```bash
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@test-card and (@phase-1 or @phase-2 or @phase-3) and not @manual' --format summary
```

```text
19 scenarios (2 failed, 17 passed)
90 steps (2 failed, 1 skipped, 87 passed)
0m37.524s (executing steps: 0m36.814s)
```

退出碼 1。紅的兩條是 phase-3 的「Tomorrow's estimate accounts for returns and the cap」(畫面還沒有 summaryLines)與「Crossing midnight rebuilds the set」(overdueCount 還是 undefined)。跟參考基底「2 場景紅 17 綠」一致。

## 轉綠

同一條 vitest:

```text
 Test Files  40 passed (40)
      Tests  852 passed (852)
   Start at  21:17:21
   Duration  229.55s (transform 1.16s, setup 471ms, import 6.89s, tests 217.80s, environment 3ms)
```

退出碼 0。

同一條 cucumber:

```text
19 scenarios (19 passed)
90 steps (90 passed)
0m44.751s (executing steps: 0m43.265s)
```

退出碼 0。

其他(收工前):

- `npx tsc --noEmit`:退出碼 0,沒有輸出。
- `npm run boundaries`:`gate=boundaries result=PASS scanned=328`。
- `npx tsx scripts/check-doc-links.ts`:`gate=doc-links result=PASS scanned=91`。寫完本報告再跑一次仍是 PASS(掃描 191 個 markdown,91 條連結)。
- `npm run lint:docs`:同樣 PASS(它就是再跑一次 doc-links)。
- `VITEST_MAX_WORKERS=1 npx vitest run scripts/zero-input-guard.test.ts scripts/degraded-report.test.ts features/support/degraded-registry-rot.test.ts`:

```text
 Test Files  3 passed (3)
      Tests  845 passed | 168 skipped (1013)
   Start at  21:14:23
   Duration  79.20s (transform 306ms, setup 156ms, import 355ms, tests 78.24s, environment 0ms)
```

沒有執行 `npx tsx scripts/degraded-report.ts` 本身。

- `npm run build -w apps/test-card`:vite build 成功(`✓ built in 2.14s`)。有三則既有的 svelte 警告(App.svelte 第 13 行 `deps` 只取初始值、HudTitleBar / HudResizeHandles 的 a11y),不是這張改出來的,建置沒有失敗。

## 累計費用

session `ses_eb60e1999ffedQ6kv2vsOM7Oqa`,opencode `session_v2.cost` = **$2.240444**(tokens in 151677、out 10279、reasoning 22244、cache read 3483904)。工單 `budget_usd: 5`,派工寫明 grok 不設上限、只記錄。LLM 真呼叫:0(三把 key 都 UNSET)。數字是提交報告前的快照,不含提交報告這一步之後的 token。

## 待協調

`scripts/review-handler.test.ts` 第 188 行用 `toEqual` 釘死 start 結果的欄位(沒有 `overdue`),第 195 行用 `Object.keys` 釘死鍵名清單(同樣沒有 `overdue`)。工單要求 `startResult` 加 `overdue`,這兩條會紅。該檔不在這張的受保護測試清單,也不在派工指定的 vitest 路徑(`packages/core/src/session` 與 `scripts/` 是不同目錄),所以這次指定的 vitest 是綠的。開發 worker 不准改測試,沒有動它。若要那支舊測試也綠,請協調者派測試作者把 `overdue` 加進那兩個斷言。
