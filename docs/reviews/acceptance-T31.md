# 驗收 T31:批改時模型連不上就是「評分失敗」,程式的 bug 照樣丟出來

- 工單:T31(`../tickets/T31-llm-failure-ungraded-not-internal.md`)
- 被驗分支:`t31-opencode` = ef065ae(起點 t31-start = c30c1eb = main e78acc7 加測試作者 -e5 的 d3cdf44;worker 兩個 commit:208fab0 實作、ef065ae 報告)
- 驗收開跑與跑完的 tree sha(相同):`1b50495b4713c986764bb5629c587cd2975c1347`;驗收用 worktree 乾淨簽出,`ls .env` → No such file
- 日期:2026-10-18

## 重編

沒有 Rust 變動。cucumber 沿用預先編好的 `lc-fs`(從別的驗收簽出複製,`BeforeAll` 會重編)。

## 基準(未突變)

| 範圍 | 結果 |
|---|---|
| vitest 完整輕量(`VITEST_MAX_WORKERS=1`) | Test Files 214 passed (214);Tests 5614 passed \| 168 skipped (5782) |
| cucumber `(@grading or @review-cli or @test-card or @i2 or @review-session) and not @manual` | 164 場景:149 passed、15 undefined、0 failed。15 個 undefined 全是 05 phase-3(9)與 06 phase-4(6),都還沒做,基底也一樣 |
| `npm run boundaries` | PASS(scanned=335;新檔 failures.ts 在已納管的 03-llm-router 落點內) |
| `scripts/zero-input-guard.test.ts`、`scripts/degraded-report.test.ts`、`features/support/degraded-registry-rot.test.ts` | Test Files 3 passed (3);Tests 845 passed \| 168 skipped (1013) |
| `npx tsc --noEmit` | 0 錯 |

## 測試作者

- worker 的兩個 commit(208fab0、ef065ae)只動:`witness.ts`、`grade-apply.ts`、`grade-fill.ts`、`failures.ts`(新)、`llm/index.ts`、`boundaries.allow.json`、`docs/reviews/T31-report.md`。`.test.ts`、`features/steps`、`features/support`、`.feature`、`.mjs` 0 個。無違規。

## 對 -e5 改動既有測試的核對(工單驗收 6)

逐條對 `e78acc7..t31-start`:

| 檔 | 改了什麼 | 判斷 |
|---|---|---|
| `packages/core/src/grading/grade-fill.test.ts` | 4 條 `new Error('NO_MODEL')` → `new NoModelError('grade.fill.llm')` | 只換錯誤種類,斷言一個字沒動;不是放寬 |
| `features/support/t30-handler.test.ts` | 1 處 `new Error('沒有本機模型')` → `NoModelError` | 同上 |
| `scripts/review-handler.test.ts`、`scripts/review-handler-acceptance.test.ts` | 各 1 處 `new Error('沒有本機模型')` → `NoModelError` | 同上 |
| `features/support/test-card-rig.ts` | 1 處同上 | 同上 |
| `features/steps/grading.steps.ts` | 「no model is available」的假 router 改成丟真的 `NoModelError`;填空預設 router 包 `noRecordingIsNoModel` | 只改「沒有模型」的成因,場景的 Then 不變 |
| `features/steps/review-cli.steps.ts` | `makeRouter` 包 `noRecordingIsNoModel` | 同上 |
| `features/support/fixture-router.ts`(新增 `noRecordingIsNoModel`) | 只把訊息以「fixture-router: 沒有錄製」開頭的錯轉成 `NoModelError`(cause 留著原錯);其他錯(含對不上 attempt)原樣丟出;`probeOnline`、`probeLocal` 委派 | 範圍窄,只轉「沒錄製」這一種;`fixture-router.test.ts` 有 4 條測它(轉、不轉、委派) |

`.feature` 一個都沒改(`git diff --name-only e78acc7..ef065ae` 內 0 個 `.feature`)。沒有任何斷言被放寬。

## 先排除憑證在最前面

`llmUnavailableReason` 第一行就是 `credentialProblem(err, {}) !== undefined → undefined`(`failures.ts`)。我拿掉它(F1)→ `t31-handler.test.ts`「憑證問題:閘道 401 包在 NoModelError 裡」紅。填空另外認「沒有本機模型」那幾家(`isNoLocalModel`),只看丟出來的那個錯本身,不沿 cause。

## `must_catch` 與自選突變

做法:驗收 worktree 只改實作、不改測試,跑對應測試子集,必須紅,還原後工作樹乾淨。共 38 個。

| 組 | 數量 | 結果 |
|---|---|---|
| failures.ts:不先排除憑證、cause 只看 1 層、cause 看 4 層、兩家 SDK 的 `instanceof` 各換成 `name`、AbortError / 截斷 / 沒有模型 / SDK 連線錯 各拿掉、429→428、≥500→>500、cause.code 不看、訊息特徵不看、特徵字少 ECONNREFUSED / socket hang up、逾時換成 network、非 Error 物件也認 | 17 | 全紅 |
| failures.ts:`seen` 拿掉 | 1 | 存活,等價(最多 3 層,繞圈也會停) |
| failures.ts:`Number.isFinite` 拿掉(`Infinity` 當 server-error) | 1 | 存活,低(`status` 不會是 Infinity) |
| grade-apply.ts:永遠 rethrow、不分類就收、不記 witness、回 pass false、warning 帶例外原文、模型不能用也重打、warning reason 改、warning 不記 | 8 | 全紅 |
| grade-fill.ts:不分類就收、一律不收、NoModelError 不收、模型名被拒不收、閘道 401→403、不記 witness、不看 unavailable、缺閘道鍵不收 | 8 | 全紅 |
| grade-fill.ts:`MissingCredentialError` 只收閘道鍵 → 任何鍵都收(GF5) | 1 | **存活**:缺的是 `OPENAI_API_KEY` 時,填空會誤收成 fallback-strict(工單說只有閘道鍵才收),沒有測試 |
| grade-fill.ts:`GatewayCallError` 只收 401 → 任何閘道錯都收(GF10) | 1 | **存活**:閘道回 400 / 404 / 403 時填空會誤收成 fallback-strict(設定錯誤被藏起來),沒有測試 |
| grade-fill.ts:模型名被拒改用 `name` 比對 | 1 | 存活,等價(真錯誤兩種認法都成立) |

## 變異測試(Stryker CLI,經 `npm run mutate`,唯一入口,拿 `.stryker.lock`)

指令形:`npm run mutate -- <設定檔>`;設定檔 `testRunner: command`、`coverageAnalysis: off`、`concurrency: 2`、`timeoutMS: 300000`,測試指令 `MUTATE_TEST_GLOB='<glob>' VITEST_MAX_WORKERS=1 npx vitest run --bail=1 --config vitest.mutate.config.ts`。門檻 80%(工單驗收 5)。

| 範圍(mutate) | 測試 glob | 變異數 | 殺掉(含 timeout) | 存活 | 分數 |
|---|---|---|---|---|---|
| `packages/core/src/llm/failures.ts` | `packages/core/src/llm/failures.test.ts`、`features/support/t31-handler.test.ts` | 94 | 86 | 8 | **91.49%** |
| `packages/core/src/grading/grade-apply.ts` | `packages/core/src/grading/grade-apply.test.ts`、`grade-apply-unavailable.test.ts`、`features/support/t31-handler.test.ts` | 107 | 106(1 timeout) | 1 | **99.07%** |
| `packages/core/src/grading/grade-fill.ts` | `packages/core/src/grading/grade-fill.test.ts`、`grade-fill-unavailable.test.ts` | 116 | 108(1 timeout) | 8 | **93.10%** |

三個都過 80%。`t31-static.test.ts` 這類讀原始碼的測試不放進 glob(儀器化會改掉原始碼)。存活逐條:

- failures.ts(8):`status` 的 `typeof`、`isFinite` 檢查(`undefined >= 500` 本來就是 false,等價);`cause.code` 的 `typeof` 與 `undefined` 檢查(等價);`status !== undefined &&`(等價);`seen`、`seen.add`、`'cause' in`(最多 3 層,等價)。一個真缺口:`status` 給數字字串(例如 `'503'`)會被當 server-error,沒有測試;工單寫的是「數字 status」,低。
- grade-apply.ts(1):`opts.timeoutMs === undefined ? {} : …` 這個條件式,是舊程式(傳 timeout 的那一行),不是 T31 新增。
- grade-fill.ts(8):4 個是 `GRADER_DEPTH` 陣列的字串(舊程式);另 4 個是 `isNoLocalModel` 裡兩條 `&&` 的條件(GF5、GF10 的同一件事,上面「存活」兩列)。T31 新增行唯一的真缺口就是這兩個。

## 非阻擋發現

**F1(低)填空的 `isNoLocalModel` 條件沒有負向測試**:`MissingCredentialError` 缺的是非閘道鍵、`GatewayCallError` 非 401(400 / 403 / 404)時,工單要往外丟(bug / 設定錯誤不藏),實作也是這樣寫,但沒有測試守著;被改壞也綠(GF5、GF10)。建議測試作者各補一條:填空遇到 `MissingCredentialError('OPENAI_API_KEY')` → 丟出;遇到 `GatewayCallError` status 400 → 丟出。
**F2(低)** `status` 給字串數字的邊界沒有測試(見上)。

## 使用者資料前後

`learning/`(唯讀量):前後都是 64 個檔、雜湊 `c2e4dd6d71de3976`、帳本 108 行。不變。這張的測試都用暫存目錄與假 router。

## 報告與守門

- worker 報告 `docs/reviews/T31-report.md`:沒有真實 learning 路徑與卡片內容。
- witness `grading.apply.llm-unavailable` 已登記在 `packages/contracts/src/witness.ts`(`swallow`、`05-grading`),degraded-report 與 registry-rot 測試綠。
- `boundaries.allow.json` 只補同一條的 `reason`,沒有新增一條。

## 花費

worker $2.59,預算 $5,比值 0.52(沒超過 2 倍;只記錄)。驗收:LLM 0;主要是 CPU(完整 vitest 約 13 分鐘、cucumber 1.5 分鐘、Stryker 約 13 分鐘、突變 38 個約 12 分鐘)。

## 結論

通過(無阻擋項)。F1、F2 是測試缺口,建議由測試作者補,不擋合併。
