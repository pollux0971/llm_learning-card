---
id: T23
deps: [T24]
touches: [apps/test-card/src/App.svelte, apps/test-card/src/session.ts, apps/test-card/src/types.ts, packages/core/src/session/handler.ts, scripts/degraded-report.ts]
cpu: heavy
budget_usd: 5
status: todo
owner: worker-grok
must_catch:
  - start 的結果缺 overdue(或不是有限數字)時照常出題、沒走 bad-response 的「複習程式停了」:結果收窄的測試必須紅
  - handler 的 start 結果沒有 overdue,或不是「當日快取名單裡 overdue_days ≥ 1 的張數」(例如只算目前這張、只算還沒答的、用 ≥ 2、把 reteach 佇列算進去):core 的 start 結果測試必須紅
  - header 的逾期數不是 start 的 overdue(例如用目前這張卡的 overdueDays、或答一題就變):header 的測試必須紅
  - header 的「已答 / 總數」不再是 header.progress 裡的第一段字(逾期數插到前面、或改成「今日 0 / 3 題」):T15 的渲染測試與 header 的測試必須紅
  - next 回 done 之後沒有把 summary 的數字顯示出來、passed 與 returned 對調、retryLater > 0 沒說:小結的測試必須紅
  - 明天估計:capped 為 true 時沒說上限與順延張數、或 capped 為 false 時說了:小結的測試必須紅
  - summary 的結果缺必要欄位(passed、returned、retryLater、tomorrow 的四個欄位)卻照常顯示小結:結果收窄的測試必須紅
  - next 的 stuck 是 true 時沒有標記、或 false 時有:stuck 的測試必須紅
  - App.svelte 的「再試一次」或「重新開始」鈕沒接到 init(onclick 換成空函式、或接到 next):在真 Chrome 的渲染 harness 裡點鈕、數 `/__review` 收到幾次 start 的那條必須紅
  - start / next / submit / summary 的結果缺欄位(讀取函式回 undefined)之後 canRetry 是 true:「缺欄位只給重新開始」那條必須紅(用真的缺欄位結果,不是丟 kind 為 bad-response 的 ReviewError)
  - (c)T24 驗收 Stryker 在 session.ts 留下的兩個存活變異:見驗收 6,範圍待顧問點名
  - 關掉時五題答了兩題,重開同一天不是從第三題開始、或 header 不是「2 / 5」:「Closing part way through resumes in the same place」必須紅
  - 當天名單建好之後才到期的卡出現在當天:「The day's question set is fixed once chosen」必須紅
  - 換日之後沒有重建、或昨天沒答的三張逾期天數沒有加一:「Crossing midnight rebuilds the set」必須紅
  - 明天已到期 4 張加今天退回 2 張不是 6、或超過上限時沒報上限與順延:「Tomorrow's estimate accounts for returns and the cap」必須紅
  - 06 phase-1、phase-2 已有的非 @manual 場景任一條變紅,或任何 .feature 被改:不退步必須紅
---

# 工單 T23:06-test-card phase-3 —— 進度列的逾期數、小結、stuck 標記、續答

> 狀態:草稿,待顧問審。
> 作者:UI/Tauri 負責人(06 規格作者,不是實作者)。編號:T23(ADR-075 那批就留給 06 phase-3)。派工:協調者。
> 實作:worker-grok(opencode grok-4.7)。紅測試:另一個角色(協調者指定,不是前端、不是開發者)。驗收:-ed。觀感:前端拍、技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 決策:ADR-075(`../02-decision-map.md`):phase-3 要的資料都從側車的 `start` / `next` / `summary` 拿,不在 webview 算。依賴:**T24**(考試卡已經吃側車)。
> 規格:`features/06-test-card/phase-3.feature`(八個場景,四個 `@manual`)。`phase-1.feature`、`phase-2.feature` 不改,防退步。
> 基底:T24 合併後的 main(`391544a` 或之後)。

## 要顧問定的(審完刪掉這一節)

1. **驗收 6 的 (c) 指哪兩個存活變異。** 我的讀法是 `showRetry` 裡兩行等價的重複,做法是刪掉;不是的話請點名行號。
2. **「逾期」的邊界。** 草稿寫 `overdue_days ≥ 1`(過了到期日就算,跟 `--dry-run` 的「overdue 1d」同一個意思)。
   另一個讀法是照 Gherkin 字面「more than a day late」用 `≥ 2`。兩種在 `@manual` 的種子(兩張逾期兩天以上、三張今天到期)都是 2,只在「剛好逾期一天」不同。我建議 `≥ 1`。
3. **逾期數一天固定。** 草稿寫「當日名單裡的張數,答題不變」(跟分母 `total` 同一批)。另一個讀法是「還沒答的裡面幾張逾期」,會隨答題變少。我建議固定。

## 為什麼有這張

T24 把考試卡接上側車,畫面照 phase-1 的行為不變。phase-3 要的是「知道自己在哪裡、明天會怎樣」:進度列多一個逾期數、答完有小結、卡住的卡有標記、中途關掉同一天再開會續答。
後四件(續答、當天名單固定、跨日、暫停不記)是 core 已經有的行為(T22 的 engine、快取),這張只要在考試卡這一層有測試證明;前四件要改畫面,其中逾期數要側車多給一個數字。

另外 T24 驗收留下的測試缺口(點鈕有沒有真的重新 `start`、缺欄位之後不給「再試一次」)由這張補上(顧問 2026-10-17)。

## 驗收條件

### 1. 逾期數(`packages/core/src/session/handler.ts`、`session.ts`、`App.svelte`)

- 側車 `start` 的結果多一個欄位 `overdue`:**當日快取名單**(`dayCache.queue`)裡 `overdue_days ≥ 1` 的張數。`ready`、`paused`、`empty` 三種結果都帶。
  寫在 `startResult`(`../../packages/core/src/session/handler.ts:93`)。reteach 佇列不算(它不佔上限,也不在 `total` 裡)。
- 這個數字一天之內固定:答題不會讓它變,同一天重開(續答)還是同一個數;換日重建名單才會變(跟 `total` 同一份名單,所以「已答 / 總數」與逾期數講的是同一批卡)。
- `session.ts` 的 `readStart` 要求 `overdue` 是有限數字,缺了就是 bad-response(「複習程式停了。」+「重新開始」)。不補預設值。
- 畫面:題目狀態的 header 是 `<header class="progress">` 裡**先**一段「已答 / 總數」(照舊,例如「0 / 5」),**後**一段「逾期 N」(N 是 0 也顯示,`00-design.md` §5.5 的「逾期 0」),再來是 HP 條。
  「已答 / 總數」那一段的字一個都不改:T15 的渲染測試讀 `header.progress` 的第一個數字(`../../packages/ui-shared/src/hud/card-render-test-support.ts:218`)。
- 逾期數的字色用一般字色,不用 `--hud-fail`(逾期不是錯誤)。

### 2. 小結(`session.ts`、`types.ts`、`App.svelte`)

- `next` 回 `done` 時照舊呼叫 `client.summary()`(`../../apps/test-card/src/session.ts:315`),**這次要讀它的結果**。新增 `readSummary`,欄位照 `handleSummary`(`../../packages/core/src/session/handler.ts:215`):
  `{passed, returned, retryLater, tomorrow: {total, capped, shown, overflow}, snapshot, answeredThisRun?}`。
  `passed`、`returned`、`retryLater`、`tomorrow.total`、`tomorrow.shown`、`tomorrow.overflow` 是有限數字,`tomorrow.capped` 是布林,`snapshot` 是字串;缺一個就是 bad-response。
- 畫面狀態 `done` 依序顯示:
  1. 「今天的複習都做完了。」(照舊)
  2. 「通過 {passed} 張、退回 {returned} 張。」(core 算的是張數:一張卡今天每一筆都過才算通過,`../../packages/core/src/session/summary.ts:41`)
  3. 只有 `retryLater > 0` 時:「另有 {retryLater} 題評分失敗,下次再考。」
  4. `tomorrow.capped` 為 false:「明天預估 {tomorrow.shown} 張。」;為 true:「明天預估 {tomorrow.shown} 張(已到每天上限,另 {tomorrow.overflow} 張順延)。」
     (跟終端機的 `renderSummary` 同一個規則,`../../packages/core/src/session/summary.ts:62`:capped 時 `shown` 就是上限)
- 同一天重開、續答到 `done`,也走同一段(側車照當日快取算),所以重開看到的是同一份小結。
- `answeredThisRun`、`snapshot` 讀進來但這張不顯示(見「不在範圍」)。

### 3. stuck 標記(`App.svelte`)

- `next` 的結果 `stuck: true` 時,題幹上面一行「這張卡已經連續答錯 3 次以上。」(跟終端機的字一樣,`../../scripts/review.ts` 的 `stuckNote`,不含括號);用 `--hud-fail` 的字色,跟 reteach 的說明同一個樣式。`stuck: false` 時沒有這一行。
- `QuestionView.stuck` 已經有(T24),只要畫出來。

### 4. 續答、當天名單固定、跨日、暫停(行為已在 core,這張只補測試)

phase-3 的四個非畫面場景,用程序內的 `createReviewClient({ handler: createReviewHandler({ … routerFactory: 假 router }) })` 跑(T24 phase-2 步驟的同一個做法),每個場景一個 `mkdtemp` 暫存根:

| 場景 | 怎麼做 | 要成立的 |
|---|---|---|
| `Closing part way through resumes in the same place` | 五張到期;答完兩張後丟掉這個 handler;同一個暫存根、同一天新建一個 handler | 新的 `start` 是 `resumed: true`、`answered: 2`;第一個 `next` 是第三張、`progress` 是 `{index: 3, total: 5}`;`TestSession` 的 header「2 / 5」 |
| `The day's question set is fixed once chosen` | 早上建名單(十張);之後再讓別的卡到期(改 `reviews.json`);同一天新建 handler | 還是同樣十張、同樣順序;新到期的卡不在裡面(明天才出現) |
| `Crossing midnight rebuilds the set` | 昨天的 handler 留三張沒答;用今天的日期新建 handler | `resumed: false`(重建);那三張的 `overdue_days` 比昨天多 1;`overdue` 跟著變 |
| `Tomorrow's estimate accounts for returns and the cap` | 明天已到期四張,今天退回兩張;再做一次讓總數超過 `daily_cap` | `summary` 的 `tomorrow.total` 是 6;超過時 `capped: true`、`shown` = 上限、`overflow` = 超出的張數;畫面照驗收 2 的第 4 句 |

- 「跨日」只驗「重新開啟」(新的 handler 帶新的日期)。app 開著跨過午夜時側車的日期不會變,那是另一件事(見「相關的另一張」)。
- 暫停(`@manual Pausing the day records nothing`)是前端的 `@manual`;core 的「暫停不記失敗」已有 `features/11-review-cli/phase-2.feature` 的「Pausing today records nothing」。

### 5. T24 留下的兩個測試缺口(顧問 2026-10-17)

- **(a) 點鈕真的重新 `start`。** 在真 Chrome 的渲染 harness 裡(`card-render-test-support.ts` 的 `openApp`,開考試卡的 dev server)點「再試一次」與「重新開始」,斷言 `/__review` 又收到一次 `method: "start"` 的請求,之後畫面出題。
  做法建議:用 DevTools Protocol 的 `Fetch` 攔 `/__review`,第一次 `start` 回一行 `no-cards` 的錯誤(id 照請求的),其餘放行;「重新開始」那條攔一次 `next` 回 `internal`。這是測試那一邊的事,產品程式不用為它改。
  T24 的 `@manual` 第 7 列(`../reviews/T24-manual-2026-10-17.md`)在這條補上之前撐著;補上之後這條就是自動的證據。
- **(b) 缺欄位之後沒有「再試一次」。** `start`、`next`、`submit`、`summary` 各給一個缺必要欄位的**結果**(讀取函式回 `undefined`,走 `showStopped`),斷言畫面是「複習程式停了。」、`canRestart` true、`canRetry` false。
  T24 的「bad-response」那條丟的是 `kind: 'bad-response'` 的 `ReviewError`(走 `showError`),沒有走到 `showStopped`,所以 `showStopped` 把 `canRetry` 設成 true 時沒有測試紅(-ed 的 C11)。

### 6. T24 Stryker 留下的兩個存活變異(待顧問點名)

顧問要求「T24 驗收時 Stryker 在 `session.ts` 留下的兩個存活變異缺口,都要有會殺死它們的測試」。
-ed 的報告(`../reviews/acceptance-T24.md` §E)寫的新存活是三個:`showStopped` 的 `canRetry = true`(= C11,驗收 5 的 (b) 會殺)、`showRetry` 裡的 `clearCard()` 與 `submitting = false`(`../../apps/test-card/src/session.ts:390`、`:391`)。
後兩個是**等價**的:`showRetry` 只被 `showError` 呼叫,`showError` 進來就先做了同樣兩件(`../../apps/test-card/src/session.ts:408`、`:409`),測試殺不死。

我的讀法(請顧問確認或點名別的兩個,附行號):(c) 指 `showRetry` 那兩個。做法是**刪掉 `showRetry` 裡重複的那兩行**(呼叫端已經做了),變異就不存在;驗收時 Stryker 不再列出這兩個,而且 `showError` 的那兩行要被殺(拿掉 `showError` 的 `clearCard()`,review-record-changed 那條要紅)。
如果顧問指的是 -ed 報告 §5 的「測試缺口,低風險」第 1–7 組裡的某兩個,請點名,我改這一節與 must_catch。

### 7. 不退步

- `features/06-test-card/phase-1.feature`、`phase-2.feature`、`phase-3.feature` 都**不改**;phase-1、phase-2 的非 `@manual` 場景全綠。
- `apps/test-card/src/*.test.ts`、`apps/test-card/dev/*.test.ts`、`apps/desktop/src/*.test.ts`、`packages/core/src/session/*.test.ts`、T15 的渲染測試(`packages/ui-shared/src/hud/card-render.test.ts`)全綠。
- `npm run boundaries`:PASS。
- 新程式能不用靜默預設(`?? 0` 之類)就不用;真的要用就登記在 `scripts/degraded-report.ts` 的 `NOT_INSTRUMENTED` 並寫理由(T24 的規則)。
- 長相:HUD 元件與 T15、T16 的量值不變;畫面只多 header 的逾期數、小結三到四行、stuck 一行。「送出」仍不捲動可見(stuck 那一行加上去之後也是)。

### 8. 觀感(`@manual`,前端做、技術顧問判)

用 `tauri build --debug --no-bundle` 的產物,暫存根 + `vault.ts init`,**假 router**,不准 live。重活要協調者給位子。真的 learning/ 開工、收工各量一次,前後要相同。
不在使用者的桌面上送滑鼠鍵盤(檢查器設 `value`、按鈕 `click()`)。帶假 router 的輪次,簽出要有只含假值的 `.env`(T24 `@manual` O1:桌面版側車的金鑰只從 `<repo>/.env` 來)。

| 場景 | 怎麼做 | 過的條件 |
|---|---|---|
| `@manual The header includes the overdue count` | 五張到期,兩張逾期兩天以上、三張今天到期 | header「0 / 5」與「逾期 2」;答一題之後還是「逾期 2」;再加一張逾期一天的,「逾期 3」 |
| `@manual The session ends with a summary` | 五張,答對三張、答錯兩張 | 「通過 3 張、退回 2 張。」與明天預估;另做一輪讓明天超過上限,看到「已到每天上限,另 N 張順延」 |
| `@manual A stuck card is marked` | 一張 `fails_in_row: 3` 的卡今天到期 | 題幹上面「這張卡已經連續答錯 3 次以上。」;別張沒有 |
| `@manual Pausing the day records nothing` | 啟動前終端機 `review.ts --pause` | 畫面是暫停那一句;`reviews.json` 不變;用明天的日期 `--dry-run`,那些卡的逾期多一天 |
| 續答 | 五張答兩張後關掉、同一天再開 | 從第三張開始,header「2 / 5」、逾期數跟關掉前一樣 |
| 長相 | 檢查器截圖:有逾期數的題目、stuck、小結(一般、到上限)四種 | console 0 則;「送出」不捲動可見(T15 的量法),含 stuck 那一行的題目 |

## 規格

這張不改 `.feature`。phase-3 的八個場景照原文;四個 `@manual` 在驗收 8,四個自動的在驗收 4。

## 紅測試(另一個角色寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| 1 | core 的 `overdue` | vitest:`createReviewHandler` + 暫存根,`overdue_days` 0、1、2 各一張 → `overdue` 2;答一題後再 `start`(續答)還是 2;reteach 的卡不算;`paused` 的結果也有 | 紅 |
| 1 | 收窄與 header | vitest:假 `ReviewClient`;`overdue` 缺 / 字串 / NaN → bad-response;header 的值是 start 的 `overdue`,答題後不變;`header.progress` 的字以「已答 / 總數」開頭 | 紅 |
| 2 | 小結 | vitest:假 `summary` 結果 → 三到四句的字照驗收 2;passed / returned 不對調;`retryLater` 0 不說;capped 兩種;缺欄位 → bad-response | 紅 |
| 3 | stuck | vitest(view 有 `stuck`)+ 靜態或渲染:`stuck: true` 那一行在、`false` 不在 | 紅 |
| 4 | 四個自動場景 | cucumber `@test-card and @phase-3 and not @manual`(新的步驟檔,照 `features/steps/_world.ts` 的結構;程序內 handler + 假 router + `mkdtemp`) | 紅(沒有步驟) |
| 5 (a) | 點鈕重新 start | 真 Chrome 渲染 harness + `Fetch` 攔 `/__review`(見驗收 5) | 本來就綠(T24 的接線是對的;拿掉 onclick 要紅,交件前用丟棄式改壞證明) |
| 5 (b) | 缺欄位不給再試一次 | vitest:四種結果各缺一個必要欄位 → `canRetry` false | 本來就綠(同上,改壞 `showStopped` 要紅) |
| 6 | 兩個存活變異 | 見驗收 6(待顧問點名) | — |
| 7 | 不退步 | 既有測試全綠 | 綠 |

- 驗收 5 的兩條在基底上是綠的(T24 的程式是對的,缺的是測試);紅測試作者交件時寫明「本來就綠」,並附「改壞會紅」的丟棄式證明(不進 git)。
- 自測片段一律最小,不放可以直接抄的完整實作。
- 測試一律用 `mkdtemp` 當 `XDG_*` 與 `HOME`;**不准 live**。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run apps/test-card apps/desktop packages/core/src/session packages/ui-shared/src/hud/card-render.test.ts
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@test-card and (@phase-1 or @phase-2 or @phase-3) and not @manual' --format summary
npm run boundaries
npm run build -w apps/test-card
```

- 環境:`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`。cucumber 一律用 `--tags`(`BeforeAll` 會編 `lc-fs`,重活,先拿位子)。渲染測試開 headless Chrome,也算重活。
- 開發 worker 可以跑一次 `npm run tauri -- build --debug --no-bundle` 確認編得過(重活,要位子);截圖與 `@manual` 是前端的事。
- 不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev`。變異測試由驗收(-ed)走 `npm run mutate`。

## 不在範圍

- 縮短版的正式畫面、reteach 的「繼續」在長原卡時跑到第一屏外(T24 `@manual` O5)—— 06 phase-4(I5)。
- 小結裡的「這次答了幾題」(`answeredThisRun`)、snapshot 失敗的提示 —— 終端機有,視窗這張不顯示。
- 週目標的顯示(08)。
- 沒有金鑰時應用題「複習程式停了」(T24 `@manual` O1)—— 顧問另判,不在這張。
- 不改 `apps/desktop/`、`packages/ui-shared/`(HUD 元件)、`scripts/review*.ts`。`packages/core/` 只動 `handler.ts` 的 `startResult` 一處(加 `overdue`)。
- 不改任何測試檔與 `.feature`。覺得測試錯了就停下回報協調者。

## 相關的另一張(不在這張修)

- 側車的「今天」在起來時算一次(`../../scripts/review-sidecar.ts` 的 `localToday()`)。app 開著跨過午夜,沒有重起側車,`start` 還是昨天的日期;使用者按「重新開始」也一樣。
  phase-3 的「Crossing midnight」寫的是「重新開啟」,這張照那個驗。要不要讓側車每次 `start` 重算日期,請顧問判(要的話另開,落點是 T22 的檔)。

## 預算

`budget_usd: 5`。grok 不設花費上限,只記錄。LLM 真呼叫:0。

## 測試誰寫

- 紅測試、步驟定義:協調者指定的角色(不是前端、不是開發者)。開發 worker 以紅測試分支為基底。
- 實作:worker-grok,只改「touches」列的檔。
- 驗收:-ed。觀感:前端(驗收 8),技術顧問判。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
排程:這張的落點是 `apps/test-card/`(06)、`packages/core/src/session/handler.ts` 一處、`scripts/degraded-report.ts`(登記表,如果有新的靜默預設)。跟 T28(`review_sidecar.rs`)、T29 不重疊。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
