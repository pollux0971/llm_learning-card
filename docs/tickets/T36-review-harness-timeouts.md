---
id: T36
deps: []
touches: [features/support/review-session-harness.ts, scripts/review-session.test.ts, features/steps/i2-review-loop.steps.ts]
cpu: heavy
budget_usd: 1
status: todo
owner: test-agent
must_catch:
  - runReview 的 90 秒計時器到時 SIGKILL 子行程,呼叫處照樣拿到一個 status 為 null 的結果往下比:必須改成丟出寫明逾時的錯
  - review-session.test.ts 的續答那條,第一輪被殺、還沒答第一題時,錯誤訊息是「asked 不對」而不是「第一輪沒有正常結束」:必須改成先斷言第一輪 status 0
  - @i2 的 The session can be interrupted and resumed 第一步在負載高時撞到 cucumber 預設的 5 秒上限:那一步要有明確的較長逾時
  - 把 runReview 的 90 秒改成 1 秒時,看到的不是「逾時」的錯:改壞證明不成立
---

# 工單 T36:複習測試的逾時要說自己是逾時(只改測試)

> 狀態:草稿,交技術顧問審(2026-10-21)。規格:技術顧問 -eb(協調者轉述,這份檔照它寫)。
> 作者:UI/Tauri 負責人(代筆)。編號:T36(協調者配)。派工:協調者。優先序:低於 T37、高於 T35。
> **只改測試,給測試 agent;沒有開發 worker。** 驗收:驗收 agent。沒有 `@manual`。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 基底:main。

## 為什麼有這張

負載很高時(量到 83.8),測試會紅,但紅的訊息看起來像斷言錯,其實是逾時:

- `../../features/support/review-session-harness.ts` 的 `runReview`:計時器(預設 90 秒,`opts.timeoutMs`)到了就 `SIGKILL` 子行程、把 status 當成 `null` 回傳。呼叫處沒有人檢查 status,照樣去比 `asked`、`stdout`。
- `../../scripts/review-session.test.ts` 第 170 行那條(續答時延後的張數照快取):第一輪 `runReview(v, { answers: 1 })` 被殺時還沒答第一題,第二輪就從 [1, 3] 開始,看起來像「續答從錯的地方開始」。
- `../../docs/integration/i2-review-loop-headless.feature` 的「The session can be interrupted and resumed」:第一步(`../../features/steps/i2-review-loop.steps.ts` 的「{int} cards are due and the person answered {int}」)單跑就要 4.7 秒,cucumber 的預設上限是 5 秒,這個 repo 沒有 `setDefaultTimeout`。負載一高就紅。

這三個都不是產品的錯。要讓它們紅的時候,訊息直接說「逾時」。

## 驗收條件

### (a) `runReview` 的逾時

- 計時器到了、`SIGKILL` 子行程時,回傳值多一欄 `timedOut: true`(沒逾時是 `false`)。
- **預設丟錯**,訊息寫明「runReview 90 秒逾時被 SIGKILL」(用 `opts.timeoutMs` 時寫實際的秒數),後面接子行程到那時為止的 stdout 與 stderr 的最後幾行(方便看卡在哪)。
- 要測逾時本身的測試,用一個明確的選項關掉丟錯(例如 `allowTimeout: true`),拿到 `{ timedOut: true, status: null }`。現在沒有測試傳 `timeoutMs`,所以這個選項目前沒人用;加的時候寫一條測試用它,證明「關掉」真的不丟。
- `runToEnd`、`runAndQuit` 跟著 `runReview`,不另寫。
- 子行程照舊收得掉:逾時之後不留行程(看 `child.exitCode` 或 `close` 事件)。

### (b) 續答那條先看第一輪有沒有正常結束

- `../../scripts/review-session.test.ts` 第 170 行 `const first = await runReview(v, { answers: 1 });` 之後,加 `expect(first.status).toBe(0)`,在任何 `asked`、快取的斷言之前。
- 同一個檔裡,其他「跑了一輪,接著比內容」的地方,如果也沒有先看 status,列出來(檔名第幾行),交顧問判要不要一起加;這張不改它們。

### (c) `@i2` 續答場景第一步的逾時

- 「{int} cards are due and the person answered {int}」這一步加明確的逾時:**150 秒**。理由:它裡面的 `runInteractiveReview` 有自己的 120 秒 `SIGKILL` 計時器,步驟的上限要比它長,裡面的逾時才有機會用自己的訊息報出來,而不是 cucumber 的「function timed out」。
- 同一個場景的第二步「the person quits and runs the review command again the same day」也跑一整輪,單跑量一次時間;超過 2.5 秒(預設上限的一半)就同樣加 150 秒,寫進交件說明。
- 這個檔裡另外還有 6 步直接呼叫 `runFreshSession`(其中「a full session can be completed as in I2」已經有 300 秒),還有幾步經 `ensureRun` 間接跑一整輪。**只量、不改**:各單跑一次,列出時間,交顧問判。
- `.feature` 不改(步驟的字不變,只改步驟定義的選項)。

### (d) 改壞證明(丟棄式,不進 git)

1. 把 `runReview` 的 90 秒改成 1 秒,跑第 170 行那條:要看到 (a) 的「逾時被 SIGKILL」的錯,**不是** `asked` 或快取的斷言錯。訊息原文貼進交件說明。
2. 把 (b) 加的那行拿掉、同時保留 1 秒:要看到原本那種「asked 不對」的錯(證明 (b) 那行真的在前面擋住)。這一步是對照,只為了證明順序有作用。
3. (c):把那一步的逾時拿掉、在步驟裡多等 6 秒(例如 `await sleep(6000)`):cucumber 報預設 5 秒逾時;放回 150 秒:綠。
4. 每一種寫:改了哪裡、哪一條紅、紅的訊息原文、還原後綠。

### 不退步

- `VITEST_MAX_WORKERS=1 npx vitest run scripts/review-session.test.ts` 全綠。
- 有用 harness 的其他測試全綠(`features/support/*.test.ts`、`scripts/review-*.test.ts` 用到 `review-session-harness` 的那些;清單用 `git grep -l review-session-harness` 列)。
- `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@i2 and not @manual' --format summary` 全綠。
- 不改任何產品程式、不改任何 `.feature`。harness 在 `features/support/` 底下,不用登記 `scripts/boundaries.owners.json`(只有新增 `scripts/*.ts` 才要)。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run scripts/review-session.test.ts
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@i2 and not @manual' --format summary
```

- 重活(vitest、cucumber)先跟協調者拿位子;`CARGO_BUILD_JOBS=2`(cucumber 的 BeforeAll 會編 lc-fs)、`VITEST_MAX_WORKERS=1`;cucumber 一律 `--tags`。
- 全部用暫存根,不碰真的 learning/,不准 live。真的 learning/ 開工、收工各量一次,前後要相同。

## 不在範圍

- 為什麼那一步要 4.7 秒(每一輪都 `npx` 起一次 tsx)、為什麼負載會到 83.8:另議。這張只讓逾時說自己是逾時。
- `features/steps/i2-review-loop.steps.ts` 自己的 `runInteractiveReview` 逾時也是回 `null`、不丟錯(同一種形狀):列進交件說明,交顧問判要不要開下一張。
- 調高 vitest 或 cucumber 的全域逾時(記憶裡的教訓:負載是自己造成的,修並行度不是調逾時)。

## 預算

`budget_usd: 1`。LLM 真呼叫:0。

## 測試誰寫

- 全部:測試 agent(這張只有測試)。
- 驗收:驗收 agent(看改壞證明有沒有做、訊息原文對不對、不退步)。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底 main。落點只有上面三個檔。跟 T35(`wayland_note.js`)、T37(07 phase-2)不重疊;T37 的步驟定義是另一個檔。
