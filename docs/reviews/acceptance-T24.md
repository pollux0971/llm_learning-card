# T24 驗收(06 test-card phase-2:考試卡拿掉 stubs、改吃複習側車)

- 工單:`docs/tickets/T24-test-card-phase-2.md`(顧問審過)
- 被驗分支:`t24-opencode` tip 8728b10(基底 `t24-start` = t24-red 1a4ce5a;worker commit:54a75e9 實作、8728b10 報告)
- 驗收 worktree:acceptance-t24;開跑 tree sha 68b5564458e0ec0c88d6a2cc20b87f66337ecf85;沒有 `.env`
- 日期:2026-10-17
- 測試與紅測試是 1e04a4b / 5fb8ff8 / 1a4ce5a(測試角色,已另驗,見 `docs/reviews/acceptance-T24-red.md`);這份只驗**實作**

## 1. 測試作者檢查

- worker 的兩個 commit 相對 1a4ce5a 改 18 檔 +1010 −612。
- 變動檔裡的測試檔(`*.test.ts`、`features/steps/**`、`features/support/**`、`.feature`、`card-render-test-support.ts`):**0 個**。
- 沒碰 `apps/desktop/` 與 `scripts/review*.ts`。
- `mutants.out` 在歷史裡的次數:0。
- 範圍:`apps/test-card/src`(session.ts、types.ts、main.ts、App.svelte)、`apps/test-card/dev`(fake-cloud.mjs、reviews.seed.json、standalone.ts,新)、`stubs/` 刪 6 檔、`vite.config.ts`、`package.json`、`scripts/boundaries.allow.json`、`scripts/degraded-report.ts`、`docs/reviews/T24-report.md`。

## 2. 基準(worker 的實作,未改壞)

| 項目 | 結果 |
|---|---|
| `tsc --noEmit` | 乾淨 |
| `npm run boundaries` | PASS(掃 326 檔) |
| vitest:`apps/test-card`、`features/support/test-card-core.test.ts`、`degraded-registry-rot.test.ts`、`scripts/degraded-report.test.ts`、`scripts/zero-input-guard.test.ts`、`packages/ui-shared/src/hud/card-*.test.ts`(含真 Chrome 的渲染) | 11 檔 **1095 綠 / 168 skipped / 0 紅** |
| cucumber `@test-card and (@phase-1 or @phase-2) and not @manual`(含 T22 四個場景) | **15/15 場景、72/72 步驟** |
| cucumber `@i2 and not @manual` | 93/93(見下「未重現」) |
| 紅→綠 | 基底(沒有實作)是 vitest 149 紅 / 5 綠、cucumber 10 失敗 / 5 綠(`acceptance-T24-red.md` 第 2 輪);現在全綠 |

**未重現的一次失敗**:第一次跑 `@i2 and not @manual`(在剛複製過來的 target 上,`lc-fs` 被重編的那一次)有 2 個場景失敗(i2 headless 的前兩個);之後單獨重跑那個場景、再整批重跑,兩次都 93/93。判為冷編譯那一次的逾時,沒有抓到訊息原文;記錄在案。

## 3. 工單 must_catch 與自選改壞(對 worker 的實作改壞;只改實作,不改測試;每個改完還原)

指令:`MUT_WT=<worktree> python3 mutate.py <muts>.json`(vitest 單檔,`VITEST_MAX_WORKERS=1`)。

| 項目 | 改壞 | 結果 |
|---|---|---|
| 填空接成字串 | `answers.join(',')`(A01) | 紅:`填空:陣列原樣送給 client.submit({ fill }),不接成字串;答案裡有逗號也原樣` |
| 批改失敗題目留在原地 | error 後換題(A02)、清題目(A02b)、header +1(A02c) | 紅 ×3:`回 status error:顯示「評分失敗,請再試一次」,題目、header 不動,沒有 result,不換題` |
| done 要叫 summary | 拿掉 summary(A03);summary 失敗被吞(A03b) | 紅 ×2:`next 回 done:呼叫 client.summary 一次…`;`summary 失敗:不卡住,走錯誤畫面` |
| paused 還出題 | paused 後接 pullNext(A04) | 紅:`paused:畫面是暫停、只有一句話(含 --unpause),不呼叫 next` |
| no-cards 說今天沒有到期 | A05 | 紅:`no-cards:說掃描到 0 張卡,不能說「今天沒有到期」(P-28)` |
| root-mismatch 給重新開始 / 顯示「複習程式停了」 | A06、A06b | 紅 ×2:`root-mismatch:顯示 ReviewError.message 原文加 vault.ts show,不給「重新開始」` |
| 側車錯誤沒重試鍵 / 重試不是重新 start | 一般錯誤無重新開始(A07)、bad-response 無重新開始(A07b)、重新開始走 next(A15) | 紅 ×3 |
| review-record-changed | 無重新開始(A08)、訊息寫死(A08b) | 紅 ×2 |
| fakeCloud 標記 | 反過來(A09) | 紅 |
| reteach | short 反過來(A10)、讀錯路徑(A11)、寫死內容(A11b)、frontmatter 不去(A13) | 紅 ×4 |
| header 已答用 index | A12 | 紅:`header:progress index 1 / total 5 → 已答 0(index - 1,不是 index)` |
| 結果收窄(缺欄位當 bad-response) | 不檢查 prompt(A14)、blanks(A14b)、fakeCloud(A14d)、stuck(A14e)、overdueDays(A14f)、reteach 的 short(A14g) | 紅 ×6 |
| 不露例外原文 | 一般錯誤附上 `review.message`(A16) | 紅(10 條) |
| submitting 不歸位 | A17 | 紅 |
| 重新送出沒清舊錯誤等 | Ctrl/Meta 少一個(A21)、paused 種類不轉暫停(A22)、correctAnswers 不帶(A23)、Enter 不守階段(A26) | 紅 ×4 |
| 自己讀 reviews.json | A25 | 紅(58 條) |
| `{@html` / innerHTML / node: / fetch | B01–B04 | 紅 ×4:`App.svelte 沒有 {@html;session.ts、App.svelte 沒有 innerHTML`;`不碰 node:、不寫任何檔、不 fetch` |
| stubs 重新出現 | 放一個 `stubs/scheduler.ts` | 紅:`apps/test-card/src/stubs/ 整個資料夾不存在` |
| NOT_INSTRUMENTED 殘留 | 放回 stubs 登記(B05)、放回 session.ts 舊片段(B06) | 紅 ×2:`每一筆的檔案都存在`;`每一筆的 snippet 都還在那個檔裡` |
| standalone | 暫存根放進 contracts/fixtures(B07)、拿掉假 router(B08)、GET 也往返(B09)、不複製種子(B10)、重新載入重新種子(B11) | 紅 ×5 |

**存活的改壞(自選,共 6 個,都不是工單 must_catch)**:

| 改壞 | 判斷 |
|---|---|
| A14c · 不檢查 `progress` 是否存在 | 等價:後面讀 `progress.index` 丟 TypeError,被外層 catch 走同一個「複習程式停了」畫面 |
| A18 · submit 開頭不清舊 `gradingError` | 等價(可見面):成功與錯誤兩條路徑都會重設 `gradingError`,只差送出中途的瞬間 |
| A24 · 成功後不再清 `gradingError` | 等價:submit 開頭已清過 |
| A19 · `next()` 不守階段 | 測試缺口,低:UI 只在有結果或 reteach 時才出現「下一題」鍵;直接呼叫才會有差 |
| A20 · `submitFill` 不守題型 | 測試缺口,低:同上,UI 不會送錯題型 |
| A27 · `getView()` 在非題目階段仍帶 header 數字 | 測試缺口,低:App 只在 question 階段畫 header |

## 4. 實作面核對(工單要求的逐項)

| 項目 | 結果 |
|---|---|
| `session.ts` 的結果收窄函式缺欄位走 bad-response | 是:`readStart`、`readNext`、`readProgress`、`readSubmit` 缺欄位或型別不對都回 `undefined`,呼叫端走 `showStopped()`(「複習程式停了。」+重新開始);沒有補預設值 |
| 錯誤畫面無 stack / 原始 JSON / 例外原文 | 是:只有固定句與 `ReviewError.message`(固定句);改壞 A16(附上原文)紅 |
| `vite.config.ts` 有 `@core` alias | 有(指向 `packages/core/src`,與根目錄 vitest 設定一致) |
| `boundaries.allow.json` 06→10 一條且附 ADR-075 理由 | 有,一條,理由寫 ADR-075 |
| NOT_INSTRUMENTED 刪第 122–126 行該刪的 | 刪了 4 筆(三筆 stubs 與一筆 session.ts 的 `due.types[…] ?? 'fill'`);沒有留下指向已刪檔或已搬走片段的登記(`degraded-registry-rot` 3 條綠) |
| 新增靜默預設(`??` / `||`)有沒有未登記 | `src/`、`main.ts`、`App.svelte`、`dev/standalone.ts`:0 個。`dev/fake-cloud.mjs` 有 2 個 `??`(讀假 router 收到的請求本文:body 缺就退到 `input.text()` 或空字串;第 28、49 行),是**單獨執行用的假 router 替身**、不是產品路徑,**沒有登記**。工單說真的要用就在同一張表登記並寫理由;請顧問裁:登記、或把那兩行改成缺了就丟錯 |
| 沒碰 `apps/desktop/` 與 `scripts/review*.ts` | 沒碰(diff 空) |
| `main.ts` 的單獨執行 | `browserFs().read` 一律丟錯(`單獨執行不讀檔`);桌面版用 `createLearningFs()` + `createReviewClient()` |

## 5. 變異測試(Stryker,`apps/test-card/src/session.ts` 單檔)

- 指令(command runner;`session.test.ts` 用動態算出來的 file URL 載入,所以 `coverageAnalysis` 要關掉):
  直接用 Stryker CLI 帶暫存設定檔跑(**沒有走 `npm run mutate`,所以沒拿 `.stryker.lock`**;當時重活位子由協調者排給 -ed,沒有別的變異測試同時在跑;下次一律走 `npm run mutate`,見 §4g 第 6 條與 `scripts/mutate.test.ts` 的繞過鎖守門),`VITEST_MAX_WORKERS=1`;設定檔內容:`testRunner: command`、`commandRunner.command = MUTATE_TEST_GLOB='apps/test-card/src/session.test.ts' VITEST_MAX_WORKERS=1 npx vitest run --bail=1 --config vitest.mutate.config.ts`、`coverageAnalysis: off`、`concurrency: 2`、`mutate: ["apps/test-card/src/session.ts"]`。(設定檔是暫存的,不進版控。)
  (協調者 2026-10-17 改寫,原本是直接叫 Stryker CLI 的指令;分數與結論不變。)
- 結果:**482 個變異,殺死 393、存活 89、逾時 0、無覆蓋 0;分數 81.54%**(≥ 80%)。
- 存活 89 個的分類(因為過了 80%,不要求逐個;下面分組,行號是 `session.ts` 的行):
  - **等價或冗餘(約 50 個)**:型別守衛 `isRecord`/`isFiniteNumber`/`isStringArray` 的邏輯運算變體(第 33、37 行;進來的值已是物件);`readProgress`/`readNext` 後面還有一層會丟 TypeError 的保護,結果同一個畫面(第 86、97、103、276、305 行的 `if (!x)` 空區塊或 false);回傳物件的 `kind: ''`(第 107、120 行,後面不再讀);多餘的 `clearCard()`(第 211、226、329、368、375 行,前面或後面已清);`submitting = false`(第 379、393 行,`finally` 也會設);`decideKeydown` 的 `&&`/false 變體(第 199 行,`question` 與 `phase` 一起變);`getView` 的 `reteach: true ? …`(第 266 行,其他階段 `reteach` 已被清);`result.correctAnswers = undefined`(第 291 行,相等比較視 undefined 同缺)。
  - **測試缺口,低風險(約 39 個)**:
    1. `readStart` 要求 `today`、`resumed`、`deferred`、`dailyCap`(第 53、54、57、58 行):測試只量 `state`、`total`、`answered`、`fakeCloud`,這四個欄位缺了會不會 bad-response 沒人測。
    2. `readNext` 的 `stage`(第 99 行)、reteach 的 `card`(第 94 行)缺了不被擋。
    3. `readSubmit`:error 狀態要求 `pass === null`(第 145、146 行)、`correctAnswers` 要是字串陣列(第 41、152 行,`every` 變 `some` 也活)。
    4. `reviewOf` 的備援分支(第 159–163 行,約 15 個):以 `name === 'ReviewError'` 與 `kind` 判斷、不靠 `instanceof`。測試丟的都是真的 `ReviewError`,備援分支沒人走;跨模組複本(打包出兩份 `ReviewError`)時才會用到。
    5. `stripFrontmatter` 的「只有開頭 `---`、沒有收尾」(第 171、178 行)沒測。
    6. 初始值與階段守衛:`canRestart`/`submitting` 的初始值(第 185、190 行)、`init` 開頭的 `phase = 'loading'`(第 207 行)、`next()`/`submitFill()`/`submitApply()` 的階段守衛(第 239、244、249 行)、`getView` 的 `onQuestion`(第 254 行)。
    7. `no-cards` 與 `router-unavailable` 的 `canRestart`(第 397、402 行):工單只說這兩種的訊息,沒說有沒有「重新開始」,所以兩種做法都過。這是規格沒寫,不是測試漏。請顧問看要不要寫進工單。
- 都不是 must_catch。需要的話,上面第 4、5、6 組各補一兩條測試就能殺掉大部分,由測試角色補。

## 6. learning/ 前後(只印數字)

| | 檔案數 | 雜湊 | 帳本行數 |
|---|---|---|---|
| 前 | 64 | c2e4dd6d71de3976 | 108 |
| 後 | 64 | c2e4dd6d71de3976 | 108 |

## 7. 其他

- 驗收分支相對 worker tip 8728b10 只多這份證據檔。
- `git merge-tree --write-tree --name-only` 對 main:乾淨(rc 0)。
- doc-links:PASS。
- 花費:worker 自報累計 $11.48(opencode,只記錄,不限額);預算欄:工單沒有給額度,比值不適用。驗收本身沒有 LLM 花費(假 router、不 live)。
- `@manual`(觀感)是前端的事,不在這份。
- 沒有跑 grok(沒被要求)。

## 結論

通過。must_catch 全紅;存活的改壞都是等價或低風險的測試缺口(沒有工單 must_catch 漏掉);Stryker 81.54%。兩件請顧問裁:(1) `dev/fake-cloud.mjs` 兩個未登記的 `??`(登記或改成丟錯);(2) `no-cards` / `router-unavailable` 要不要「重新開始」(工單沒寫)。

---

# 增量驗收:小補(啟動錯誤「再試一次」、fake-cloud 缺 messages 丟錯)

- 被驗:`t24-opencode` tip aa64834(基底 `t24-fix-start` 8d0f61b = 前面驗過的 8728b10 + 測試角色 31b61a5 + main e513f0a 的工單改字)。
- 驗收 worktree:acceptance-t24b;基底 tree sha 671985892fee58a68eb304696f679a6c148e6cb7;aa64834 的 tree sha c18d8d319821f1dbffccefedf5d3db7788f22015;沒有 `.env`。
- 小補只改 5 檔(相對 8d0f61b):`apps/test-card/dev/fake-cloud.mjs`(+3/−1)、`App.svelte`(+3)、`session.ts`(+21/−6)、`types.ts`(+2)、`docs/reviews/T24-report.md`。測試檔變動 0;沒有碰 `scripts/`、`apps/desktop/`;`mutants.out` 0。

## A. 新測試在基底紅、在 aa64834 綠

| | 結果 |
|---|---|
| 基底 8d0f61b(test-card、test-card-core、registry-rot) | 176 條中 **29 紅**:`再試一次` 相關(no-cards / router-unavailable / root-mismatch / not-configured 各自的訊息與「按再試一次重新 start」「還是同一個錯不卡死」)、非啟動錯誤「沒有再試一次」12 條(`canRetry` 還不存在 → `expected undefined to be false`)、`review-record-changed` 的 `canRetry`、App.svelte 缺 `canRetry`、fake-cloud 兩條(缺 messages、content 不是字串 → 回了全對的假回應) |
| aa64834 | 同一批全綠;見 §C |

基底還有 1 條紅是「真的 scheduler 的清單與順序」(`Error: STACK_TRACE_ERROR`,不是斷言訊息);在 aa64834 綠,這個小補沒有碰排程。我沒查出它在基底為何紅(可能是第一次載入逾時或 rig 的暫態),如實記錄為「基底上有一條無法解釋的紅,aa64834 上綠」。

## B. 改壞(對 aa64834;只改實作)

| 改壞 | 結果 |
|---|---|
| C01 拿掉 App.svelte 的「再試一次」鈕 | 紅:`App.svelte:測試模式一行用 --hud-fail 的字色、錯誤畫面有「重新開始」與「再試一次」` |
| C02b `init()` 在 `canRetry` 時不重新 start | 紅 8 條:`no-cards:按「再試一次」(init)= 重新 start(不是 next / submit),改好之後出題` 等 |
| C03 root-mismatch 改顯示「複習程式停了」 | 紅 6 條:`root-mismatch:顯示 ReviewError.message 原文加 vault.ts show 加「再試一次」,不顯示「複習程式停了」…` |
| C05 sidecar 錯誤也給 `canRetry` | 紅 7 條:`sidecar-exited:不是啟動錯誤,沒有「再試一次」` 等 |
| C06 `showRetry` 兩鍵同時 true | 紅 4 條 |
| C07 review-record-changed 也給 `canRetry` | 紅 2 條 |
| C08 少了提示句「改好之後按「再試一次」。」 | 紅 4 條 |
| C09 no-cards 改走 `showStopped` | 紅 3 條 |
| C10 `init` 不重設 `canRetry` | 紅 4 條 |
| C12 paused 帶 `canRetry` | 紅:`paused:不是啟動錯誤,沒有「再試一次」` |
| C13 fake-cloud 缺 messages 不丟錯(舊行為) | 紅 3 條:`請求本文缺 messages → 丟錯,不回「全對」的假回應` |
| C14 fake-cloud content 數字也當字串 | 紅 2 條:`messages[0].content 不是字串(缺、數字、陣列)→ 丟錯` |
| **存活 C02** · App.svelte 的「再試一次」鈕 `onclick` 換成空函式 | **測試缺口**:鈕有沒有接到 `restart` 只有靜態檢查字樣,沒有任何測試點它(`session.init()` 的行為有測,但畫面把鈕接到 init 沒測)。同樣的缺口也在原本的「重新開始」鈕。低~中:鈕壞了使用者按了沒反應 |
| **存活 C11** · `showStopped()`(bad-response:回應缺欄位那條)帶 `canRetry = true` | **測試缺口,低**:「bad-response:不是啟動錯誤,沒有再試一次」那條丟的是 `kind: 'bad-response'` 的 ReviewError(走一般錯誤的收尾),真的結果缺欄位(走 `showStopped`)沒量 `canRetry` |

建議測試角色補:(1)點「再試一次」「重新開始」鈕的行為測試(可以在 `card-render` 的真 Chrome 渲染裡點,或用 Svelte 元件測試);(2)結果缺欄位(readStart/readNext 回 undefined)後 `canRetry` 是 false。這兩條都不是這張工單的 must_catch。

## C. 實作面

| 項目 | 結果 |
|---|---|
| `canRetry` 只用於 no-cards / router-unavailable / root-mismatch / not-configured | 是:`canRetry = true` 只出現在 `showRetry()` 一處,`showRetry` 只被這四個 kind 呼叫 |
| `canRestart` 與 `canRetry` 不同時為 true | 是:`showRetry` 設 `canRestart=false, canRetry=true`;其他每個收尾都把 `canRetry` 設成 false(改壞 C06 紅) |
| 「session 類」與 review-record-changed 不變 | 是:review-record-changed 仍 `canRestart=true`、`canRetry=false`(C07 紅);sidecar-exited/timeout/internal/busy/no-session/bad-response 仍是「複習程式停了。」+「重新開始」 |
| fake-cloud 第 28 行沒動、沒登記進 NOT_INSTRUMENTED | 是:第 28 行的 `init?.body ?? …` 原樣;`scripts/` 沒有變動 |
| fake-cloud 第 49 行 | 現在 `messages` 不是陣列或 `messages[0].content` 不是字串就丟錯(訊息含 `fake-cloud: messages[0].content 不是字串`),沒有 `?? ''` |

## D. 整批回歸(aa64834)

| 項目 | 結果 |
|---|---|
| tsc、`npm run boundaries` | 乾淨、PASS(326 檔) |
| vitest 同上一輪子集(test-card、core、registry-rot、degraded-report、zero-input-guard、card-*) | 11 檔 **1117 綠** / 168 skipped / 0 紅(上一輪 1095;多的 22 條是新測試) |
| cucumber `@test-card and (@phase-1 or @phase-2) and not @manual` | **15/15、72/72** |
| cucumber `@i2 and not @manual` | **93/93、464/464** |
| T15 渲染(真 Chrome,`card-*` 測試,含在上面 vitest 裡) | 綠 |
| learning/ 前 | 64 檔 / c2e4dd6d71de3976 / 108 行 |
| learning/ 後 | 64 檔 / c2e4dd6d71de3976 / 108 行(相同) |

## E. Stryker(`apps/test-card/src/session.ts` 單檔)

- 指令同前面的 §5(command runner、`coverageAnalysis: off`、`concurrency: 2`、測試只跑 `apps/test-card/src/session.test.ts`、`VITEST_MAX_WORKERS=1`)。
- 結果:**495 個變異,殺死 404、存活 91、逾時 0;分數 81.62%**(前一次 81.54%;沒有拉低,≥ 80%)。
- 新程式(第 370 行以後)新出現的存活 3 個:`showStopped` 的 `canRetry = true`(即 C11)、`showRetry` 裡多餘的 `clearCard()` 與 `submitting = false`(前面已清、`submit()` 的 `finally` 也會設,等價)。其餘 88 個與前一次相同類別(行號因多 27 行而位移)。

## F. 結論(增量)

通過。新測試基底紅(29)、aa64834 綠;改壞 14 個,12 紅;存活 2 個都是測試缺口(App 鈕的接線、showStopped 的 canRetry),非 must_catch;整批回歸全綠;Stryker 81.62%。
