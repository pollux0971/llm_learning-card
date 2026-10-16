---
id: T24
deps: [T22, T26]
touches: [apps/test-card/src/App.svelte, apps/test-card/src/session.ts, apps/test-card/src/types.ts, apps/test-card/src/main.ts, apps/test-card/src/stubs/fixtures.ts, apps/test-card/src/stubs/grader.ts, apps/test-card/src/stubs/loader.ts, apps/test-card/src/stubs/memory-fs.ts, apps/test-card/src/stubs/scheduler.ts, apps/test-card/src/stubs/.gitkeep, apps/test-card/vite.config.ts, apps/test-card/package.json, apps/test-card/dev/standalone.ts, apps/test-card/dev/fake-cloud.mjs, apps/test-card/dev/reviews.seed.json, scripts/boundaries.allow.json]
cpu: heavy
budget_usd: 5
status: todo
owner: worker-grok
must_catch:
  - apps/test-card/src 底下還有 stubs/、或任何檔 import StubScheduler / StubGrader / MemoryFs / loader:「Wave 0 的重複已移除」的靜態檢查必須紅
  - TestSession 自己算排程、自己批改、自己讀 reviews.json(不經 ReviewClient):「判斷都在側車」的靜態檢查必須紅
  - 批改回 status error 時,畫面換到下一題或清掉輸入:「批改失敗題目留在原地」必須紅
  - 填空送出時把幾格答案用逗號接成一個字串:「填空送陣列」必須紅(答案裡有逗號時原樣到 grader)
  - 這一輪答完(next 回 done)沒呼叫 summary:「做完要叫 summary(snapshot)」必須紅
  - start 回 paused 時還出題、或 next 被呼叫:暫停的測試必須紅
  - start 回 no-cards 時顯示「今天沒有到期」:P-28 的測試必須紅
  - 側車錯誤(sidecar-exited、timeout、sidecar-unavailable、internal)時畫面卡住、沒有重試、或重試不是重新 start:錯誤處理的測試必須紅
  - review-record-changed 時沒有顯示「複習紀錄剛被別的地方改過,請重新開始今天的複習」、或沒有「重新開始」、或不重新 start 就繼續出題:錯誤處理的測試必須紅
  - start 回 fakeCloud true 時沒有「測試模式」標記,或 false 時有:標記的測試必須紅
  - reteach 的檔不是經 LearningFs 讀(例如經側車、fetch、寫死內容),或 short 是 false 時沒有說明「先看原卡」:reteach 的測試必須紅
  - 縮短版的內容用 innerHTML / {@html} 塞進畫面:靜態檢查必須紅
  - header 的「已答 / 總數」跟 next 的 progress 對不上(例如用 index 而不是 index - 1):header 的測試必須紅
  - 單獨執行(npm run dev)寫進 contracts/fixtures/ 本身、不是暫存複本,或沒有開假 router:單獨執行的測試必須紅
  - 06 phase-1 已 done 的非 @manual 場景任一條變紅,或 phase-1.feature 被改:不退步必須紅
---

# 工單 T24:06-test-card phase-2 —— 考試卡拿掉 stubs,改吃複習側車

> 狀態:草稿,待技術顧問審。
> 作者:UI/Tauri 負責人(06 規格作者,不是實作者)。編號:協調者配(T24)。派工:協調者。
> 實作:worker-grok(opencode grok-4.7)。紅測試:另一個角色(協調者指定,不是前端、不是開發者)。驗收:-ed。觀感:前端拍、技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 決策:ADR-075(`../02-decision-map.md`)。依賴:**T22**(側車、`review` command、`ReviewClient`、`createReviewHandler`)、**T26**(core 寫 `reviews.json` 前的樂觀檢查;這張要顯示它的錯誤)。
> 規格:`features/06-test-card/phase-2.feature`(T22 加的五個場景以外的六個,是這張的)、`features/06-test-card/phase-1.feature`(done,**不改**,防退步)。
> 基底:T22 合併後的 main。

## 為什麼有這張

06 phase-1 的考試卡跑在 Wave 0 的 stubs 上(`StubScheduler`、`StubGrader`、`MemoryFs`,`features/06-test-card/FEATURE.md` 的「Wave 0 的重複」表寫明 I3 移除)。
T22 做好了複習側車:跟終端機同一份 core 在 Node 跑,webview 經 `ReviewClient` 用五個動作跟它說話。
這張把考試卡接上去:拿掉 stubs,`TestSession` 改吃 `ReviewClient`,畫面照 phase-1 的行為不變。

進度列的逾期數、小結畫面、stuck 標記、續答的 header 是 T23(06 phase-3),不在這張。

## 驗收條件

### 1. 拿掉 Wave 0 的重複

- 刪掉 `apps/test-card/src/stubs/` 整個資料夾的實作檔(`fixtures.ts`、`grader.ts`、`loader.ts`、`memory-fs.ts`、`scheduler.ts`、`.gitkeep`)。
  `stubs/scheduler.test.ts` 是測試檔,由紅測試作者刪(見「紅測試」)。
- `types.ts` 只留畫面自己要的型別;跟協定重複的(`DueItem`、`Review`、`GradeResult`…)改用 `ReviewClient` 匯出的型別,不再手抄契約。
- 靜態檢查:`apps/test-card/src` 底下沒有 `stubs/`,沒有任何檔 import `stubs/`、`yaml`、`date-fns`,沒有讀 `state/reviews.json` 或 `questions/` 的字串。

### 2. `TestSession` 改吃 `ReviewClient`(`apps/test-card/src/session.ts`)

`TestSession` 仍是純 TypeScript、不依賴 Svelte(cucumber 直接 import 它,phase-1 的理由不變)。依賴改成:

```ts
export interface SessionDeps {
  client: ReviewClient;              // T22 的介面(apps/desktop/src/webview/review-client.ts)
  fs: Pick<LearningFs, 'read'>;      // 讀縮短版用;桌面版是 webview 的 LearningFs
}
```

| 動作 | 做什麼 |
|---|---|
| `init()` | `client.start()`。`paused` → 畫面狀態 `paused`;`empty` → `empty`;`ready` → 呼叫 `client.next()` |
| `next()` 的結果 `question` | 畫面顯示題目;填空的輸入格數 = `blanks`;header = `progress.index - 1` / `progress.total` |
| `next()` 的結果 `reteach` | `fs.read(path)`,去掉開頭的 frontmatter(第一行是 `---` 時,到下一個只有 `---` 的行為止),其餘當**純文字**顯示,下面一顆「繼續」;按了再 `client.next()`。`short` 是 false 時,上面加一句「這張卡連續答錯兩次;縮短版還沒有產生,先看原卡。」 |
| `next()` 的結果 `done` | 呼叫 `client.summary()`(側車在這裡 snapshot),畫面狀態 `done`(文字照 phase-1:「今天的複習都做完了。」;小結的數字是 T23) |
| `submitFill(answers)` | `client.submit({ fill: answers })`,陣列原樣送,不接成字串 |
| `submitApply(text)` | `client.submit({ apply: text })` |
| 送出的結果 `error` | 顯示「評分失敗,請再試一次」,**題目與輸入都留著**,可以再送(phase-1、phase-2 的場景) |
| 送出的結果 `partial` | 顯示這一題的結果與「下一題」;按了 `client.next()`(同一張卡的第二題) |
| 送出的結果 `passed` / `failed` | 顯示結果;`failed` 的填空有 `correctAnswers` 就顯示「正確答案:…」;「下一題」→ `client.next()` |
| `ReviewError` | 見驗收 4 |

- Enter / Ctrl+Enter 的規則(`decideKeydown`)、送出中停用、3 秒後「仍在處理」的提示:照 phase-1,不改。
- `TestSession` 不自己算排程、不自己批改、不讀 `reviews.json`、不寫任何檔。

### 3. 桌面版與單獨執行的接法(`apps/test-card/src/main.ts`、`App.svelte`)

- 在 Tauri 裡(`isTauri()`):`client = createReviewClient()`、`fs = createLearningFs()`(都是 `apps/desktop/src/webview/`)。
- 不在 Tauri(瀏覽器,單獨執行):`client = createReviewClient({ handler: (line) => fetch('/__review', { method: 'POST', body: line }).then((r) => r.text()) })`;`fs` 是一個 `read` 一律丟錯的物件(單獨執行的種子資料不會觸發 reteach,見驗收 5)。
- `scripts/boundaries.allow.json` 加一條 06-test-card → 10-desktop-shell(理由寫 ADR-075:考試卡用桌面殼的 `ReviewClient` 與 `LearningFs`)。
- `start` 回 `fakeCloud: true` 時,標題列下方顯示一行「測試模式:批改是假的」(用 `--hud-fail` 的字色);false 時不顯示。

### 4. 錯誤時畫面不卡住

| `ReviewError.kind` | 畫面 |
|---|---|
| `no-cards` | 「掃描到 0 張卡 —— 這個 learning 資料夾沒有卡片。」(**不能**說成「今天沒有到期」,P-28) |
| `router-unavailable` | 「帳本身分驗不過,批改不能用。請在終端機執行 `npx tsx scripts/vault.ts show` 看原因。」 |
| `paused` | 同 `start` 回 `paused` 的畫面:「今天已暫停。要繼續,在終端機執行 `npx tsx scripts/review.ts --dir <learning 目錄> --today <今天> --unpause`。」 |
| `review-record-changed` | 「複習紀錄剛被別的地方改過,請重新開始今天的複習。」加一顆「重新開始」;按了重新 `init()`。這一題**沒有**被記下(T26 拒絕寫入),重新開始後會再問 |
| `sidecar-exited`、`timeout`、`sidecar-unavailable`、`internal`、`busy` | 「複習程式停了。」加一顆「重新開始」;按了重新 `init()`(從 `start` 開始;T22 的 Rust 會重起側車) |
| 其他 | 同上 |

- 錯誤畫面不顯示 `ReviewError` 的 `message` 以外的東西(不顯示 stack、不顯示原始 JSON)。

### 5. 單獨執行(ADR-022,`npm run dev -w apps/test-card`)

- `apps/test-card/vite.config.ts` 加一個只在 dev server 生效的 plugin(`apps/test-card/dev/standalone.ts`):
  1. 開一個暫存根(`mkdtemp`):複製 `contracts/fixtures/learning-minimal` 到裡面的 `learning/`,再用 `apps/test-card/dev/reviews.seed.json` 覆蓋 `state/reviews.json`
     (三張卡在固定日期 `2026-09-10` 都到期:stage 1、2、3 各一張,`fails_in_row` 都是 0,所以不會出現 reteach)。
  2. 暫存的 `XDG_CONFIG_HOME`、`XDG_CACHE_HOME`、`HOME`;`npx tsx scripts/vault.ts init --learning-dir <暫存 learning>`。
  3. 起 `scripts/review-sidecar.ts`(跟桌面版同一支),環境帶 `LC_REVIEW_FAKE_CLOUD=<apps/test-card/dev/fake-cloud.mjs 的絕對路徑>`、`LC_REVIEW_TODAY=2026-09-10`。
  4. `POST /__review`:把 body(一行)寫給側車,回它的那一行。
  5. dev server 關掉時收掉側車、刪暫存根。
- `apps/test-card/dev/fake-cloud.mjs`:換掉 `fetch`,填空同義詞與應用題都回固定的合法回應(照 `features/steps/_fake-review-cloud.mjs` 的形狀;不 import `features/` 底下的檔)。
- **不寫 `contracts/fixtures/` 本身**;一律假 router;答案只落在暫存根,dev server 關掉就沒了(跟 phase-1 的「答案不落地」同一個意思)。
- `FEATURE.md` 的「單獨執行」指令不變。

### 6. 不退步

- `features/06-test-card/phase-1.feature`(done)**不改**;它的非 `@manual` 場景全綠(步驟由紅測試作者改接新的後端,見「紅測試」)。
- `apps/desktop/src/*.test.ts`、T22 的測試全綠。cucumber `@test-card and @phase-1 and not @manual`、`@test-card and @phase-2 and not @manual` 全綠。
- `npm run boundaries`:PASS。
- 長相:HUD 元件與 T15、T16 的量值不變(畫面只多錯誤、暫停、reteach、測試模式幾種狀態)。

### 7. 觀感(`@manual`,前端做、技術顧問判)

用 `tauri build --debug --no-bundle` 的產物,暫存根 + `vault.ts init`,**假 router**(`LC_REVIEW_FAKE_CLOUD`),不准 live。重活要協調者給位子。
真的 learning/ 開工、收工各量一次,前後要相同。不在使用者的桌面上送滑鼠鍵盤:輸入經檢查器設 `value` 送 `input`、按鈕呼叫 `click()`(T15 的做法)。

| 場景 | 怎麼做 | 過的條件 |
|---|---|---|
| phase-2 `@manual`「A full session end to end」 | 暫存 learning 有 5 張到期(learning-minimal 複製再補兩張);答完五張 | `reviews.json` 五張都有今天的 history;關掉再開,顯示「今天沒有到期的複習」;`learning/` 有一個新的 snapshot commit |
| 視窗與終端機看到同一份 | 視窗答兩張後關掉;終端機跑 `scripts/review.ts --dry-run` | 列出剩下的三張,順序跟視窗原本的一樣 |
| 批改失敗留在原地 | fake cloud 回不合法的回應兩次 | 畫面顯示「評分失敗,請再試一次」,同一題、輸入還在;`reviews.json` 那張卡不變 |
| 視窗與終端機同時寫 | 視窗出題後,用終端機答一題(T26 的觸發方式),再在視窗送出 | 視窗顯示「複習紀錄剛被別的地方改過,請重新開始今天的複習。」與「重新開始」;`reviews.json` 只有終端機那一筆;按「重新開始」後正常出題 |
| 測試模式標記 | 帶 / 不帶 `LC_REVIEW_FAKE_CLOUD` | 帶的時候有那一行;不帶時沒有(不帶時用沒有 `.env` 的簽出,`start` 回 `router-unavailable` 或正常開始) |
| 側車停了 | 對側車送 SIGKILL,再按「下一題」 | 顯示「複習程式停了」;按「重新開始」回到題目(續答,header 是已答 / 總數) |
| 長相 | 檢查器截圖:題目、結果、錯誤、暫停、reteach 五種畫面 | console 0 則;送出鍵不捲動可見(T15 的量法) |

## 規格

這張不改 `.feature`。phase-2 的六個場景(T22 加的五個以外)照原文:
`The card shows exactly what the real scheduler returns`、`A file outside the learning directory cannot be reached`、`Answers are written immediately`、
`The interface and the terminal agree`、`A grading error still leaves the card untouched`、`@manual A full session end to end`。

`features/06-test-card/FEATURE.md` 的「技術棧」與「Wave 0 的重複」兩處在規格那個 commit 已改成 ADR-075 的寫法(前端改)。

## 紅測試(另一個角色寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| 1 | 拿掉 stubs | 靜態掃 `apps/test-card/src`(驗收 1 的清單) | 紅 |
| 2 | `TestSession` 的每一列 | vitest:假的 `ReviewClient`(記下每次呼叫與參數)與假的 `fs`;驗收 2 表逐列;陣列含逗號原樣送;error 時題目與 view 的輸入不變 | 紅 |
| 2 | 程序內跑真的 core | vitest / cucumber:`createReviewClient({ handler: createReviewHandler({ … routerFactory: 假 router }) })`,暫存根(learning-minimal 複本);phase-2 的「real scheduler」「answers written immediately」「interface and terminal agree」「grading error」四個場景 | 紅 |
| 2 | 縮短版 | 假 `fs` 記錄讀了哪個路徑;`short: false` 時讀的是原卡的 path、畫面有那一句說明;靜態:`App.svelte` 沒有 `{@html`、`session.ts` 沒有 `innerHTML` | 紅 |
| 3 | 測試模式標記 | vitest:`fakeCloud` true / false 兩種的 view | 紅 |
| 4 | 錯誤 | vitest:每個 kind 的畫面狀態;重試時重新 `start` | 紅 |
| 4 | path 防護 | cucumber `A file outside the learning directory cannot be reached`:考試卡用的那個 `fs`(桌面版的 `LearningFs`,經 T2c-1 的 probe)讀 `../x` 被拒絕 | 紅 |
| 5 | 單獨執行 | vitest:`dev/standalone.ts` 的暫存根不在 `contracts/fixtures/` 底下、側車環境有 `LC_REVIEW_FAKE_CLOUD`、`POST /__review` 往返一行 | 紅 |
| 6 | phase-1 不退步 | 既有的 `features/steps/test-card.steps.ts`、`apps/test-card/src/session.test.ts` **改接新的後端**(見下),phase-1 場景全綠 | 改完後綠 |

既有測試要改的(紅測試作者改,開發 worker 不改):

| 現在 | 改成 |
|---|---|
| `apps/test-card/src/stubs/scheduler.test.ts` | 刪掉(StubScheduler 沒了;真的 scheduler 有 04 自己的測試) |
| `apps/test-card/src/session.test.ts`(吃 stubs) | 改吃假的 `ReviewClient`(驗收 2) |
| `features/steps/test-card.steps.ts`(import stubs) | phase-1 的場景改接程序內的 `createReviewHandler` 與假 router:「stub grader is configured to take four seconds」= 假 router 延遲 4 秒、「returns an error result」= 假 router 回不合法的回應兩次、「The stubs are drop in replaceable」= 考試卡用的就是 core 的 scheduler(經 handler);`.feature` 的字一個都不改 |

- 自測片段一律最小,不放可以直接抄的完整實作。
- 測試一律用 `mkdtemp` 當 `XDG_*` 與 `HOME`;**不准 live**。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run apps/test-card apps/desktop
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@test-card and (@phase-1 or @phase-2) and not @manual' --format summary
npm run boundaries
npm run build -w apps/test-card
```

- 環境:`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`。cucumber 一律用 `--tags`(`BeforeAll` 會編 `lc-fs`,重活,先拿位子)。
- 開發 worker 可以跑一次 `npm run tauri -- build --debug --no-bundle` 確認編得過(重活,要位子);截圖與 `@manual` 是前端的事。
- 不跑變異測試、不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev`。

## 不在範圍

- 進度列的逾期數、小結的數字與明天估計、stuck 標記、續答 header 的「二之五」、當天名單固定、跨日、暫停畫面的細節 —— T23(06 phase-3)。這張的暫停只顯示一句話。
- 縮短版的正式畫面(markdown、範例框)—— 06 phase-4(I5)。這張只顯示純文字。
- 不改 `apps/desktop/`、`packages/core/`、`scripts/review*.ts`(T22 的落點)。不改 `packages/ui-shared/`(HUD 元件)。
- 不改任何測試檔與 `.feature`。覺得測試錯了就停下回報協調者。
- 不開網路埠(單獨執行的 vite dev server 是開發工具本來的埠)。

## 相關的另一張(不在這張修)

- 縮短版不存在時,core 的 `presentNextCard` 會丟錯(`findCardFile` 找不到 `.short.md`),終端機的 `review` 遇到連錯兩次的卡會整個停掉。
  顧問裁決另開 **T25**:不丟錯、退回只顯示原卡、記一筆 warning。側車(T22)照同一個規則回原卡的 `path`,所以這張不受 T25 先後影響。

## 預算

`budget_usd: 5`。grok 不設花費上限,只記錄。LLM 真呼叫:0。

## 測試誰寫

- 紅測試、步驟定義:協調者指定的角色(不是前端、不是開發者)。開發 worker 以紅測試分支為基底。
- 實作:worker-grok,只改「touches」列的檔。
- 驗收:-ed。觀感:前端(驗收 7),技術顧問判。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
排程:這張的落點是 `apps/test-card/`(06)與 `scripts/boundaries.allow.json`(infra,檔案層級)。跟 T21、T22 的檔案不重疊,但**依賴 T22**(要它的 client 與 handler)。T23 依賴這張。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
