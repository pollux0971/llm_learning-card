# T31 實作報告:批改時模型連不上就是「評分失敗」,程式的 bug 照樣丟出來

日期:2026-10-18。模型:Grok 4.7(xai/grok-4.7)。
開工 HEAD:`c30c1eb`(chore: main e78acc7 + 紅測試 t31-red d3cdf44)。實作 commit:`208fab0`。
本報告是接著的 commit(提交時還不在下面的 log 裡;提交後 porcelain 空)。
session id:`ses_eb4d59ff3ffessD0qQAV61ik8V`。
API key:`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`XAI_API_KEY` 都是 `UNSET`。`.env` 不存在(`ls .env` → No such file)。`opencode.json` 的 `permission.skill` 是 `{"*":"deny"}`。開工 `git status --porcelain` 空。
沒有跑變異測試(Stryker、cargo-mutants、`npm run mutate`)、完整 cucumber、`npm run check:all`、`tauri dev`、`tauri build`。沒有執行 `npx tsx scripts/degraded-report.ts`(它會起整套 vitest)。`@manual` 依工單是前端的事,沒跑。重活(vitest、cucumber)用協調者派工時給的位子,`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`,同一時間只有一個。沒有新的靜默預設(`??` / `||` 補值),所以沒改 `scripts/degraded-report.ts`。LLM 真呼叫:0。不寫 ADR。沒有改測試檔、`.feature`、側車、視窗、`review.ts`、Rust。

## 做法

只動工單 touches 裡的實作檔,加新檔 `packages/core/src/llm/failures.ts`。分類只寫一份,05 從 `@core/llm` 引用。

- `failures.ts`:`llmUnavailableReason(err)` 先呼叫 T30 的 `credentialProblem(err, {})`(任何 env 都會把數字 status 401 算成憑證,這裡不讀 `process.env`)。認得出憑證就回 `undefined`。否則看錯本身與 cause 鏈,最多三層(錯本身、cause、cause 的 cause;第 4 層不看,繞圈就停),第一個認得的算。SDK 的連線錯用 `instanceof`(OpenAI 與 Anthropic 的 `APIConnectionError`,子類 `APIConnectionTimeoutError` 一起算),不用 `err.name`。網路特徵正規式與 `ingest/questions.ts` 的 `NETWORK_ERROR_PATTERN` 同一份,旁邊有「同一份 / backlog」註解。不是 `Error` 的丟出物一律 `undefined`。純函式,不改傳進來的錯。
- `index.ts` 轉出 `llmUnavailableReason`。
- `grade-apply.ts`:`router.call('grade.apply', …)` 包 try。`llmUnavailableReason` 有值 → 記 `grading.apply.llm-unavailable`、記一筆 warning(`reason: 'llm_unavailable'`,`cause` 是原因代號,不含例外原文),回 `{ pass: null, feedback: '這次沒辦法批改(模型暫時連不上),請再試一次。', grader: 'error' }`,不自動重打。沒有值就原樣丟出同一個物件。回應解析不出來的再打一次照舊;第二次才丟模型不能用,也走同一個出口。有 `logPath` 才寫 log,沒有加新的接線。
- `grade-fill.ts`:空的 `catch {}` 改成 `catch (err)`。`llmUnavailableReason` 有值,或是契約 §7「沒有本機模型」那一家(`NoModelError`、`MissingCredentialError` 且鍵是 `GATEWAY_API_KEY`、`GatewayCallError` status 401、`GatewayModelRejectedError`)→ 照舊 `fallback-strict` 與 `grading.fill.llm-failed-strict`。其他往外丟。填空不回 `pass: null`。沒有本機模型那一家只看丟出來的那個錯本身,不沿 cause 把包在外面的 bug 收掉。
- `witness.ts`:登記 `grading.apply.llm-unavailable`(`kind: 'swallow'`、`owner: '05-grading'`)。`grading.fill.llm-failed-strict` 的說明改成「模型不能用或沒有本機模型」,不再寫「呼叫丟錯」。
- `boundaries.allow.json`:05-grading → 03-llm-router 還是那一條,`reason` 補上 `grade-apply.ts`、`grade-fill.ts`、`llmUnavailableReason`,保留 `scripts/grade.ts` 與 `createLiveGatewayRouter`。整份仍是 21 條。

## git log

起點 `c30c1eb`。

```text
208fab0 feat(T31): 批改時模型連不上回評分失敗,程式的 bug 照樣丟出
```

不屬於測試作者 commit 的測試檔變動:空。`git diff --name-only c30c1eb..208fab0` 對 `*.test.ts`、`features/steps`、`features/support`、`*.feature`、fixtures 沒有輸出。

## git diff --stat

`git diff --stat c30c1eb..208fab0`(實作 commit,不含本報告):

```text
 packages/contracts/src/witness.ts        |  7 ++-
 packages/core/src/grading/grade-apply.ts | 16 +++++-
 packages/core/src/grading/grade-fill.ts  | 30 +++++++++-
 packages/core/src/llm/failures.ts        | 94 ++++++++++++++++++++++++++++++++
 packages/core/src/llm/index.ts           |  1 +
 scripts/boundaries.allow.json            |  2 +-
 6 files changed, 145 insertions(+), 5 deletions(-)
```

工單 touches 裡的 `scripts/degraded-report.ts` 沒改:新程式沒有 `??` / `||` 補值,不用登記。本報告提交後,`c30c1eb..HEAD` 會多這份報告。

## git status

實作 commit 之後、本報告提交之前,`git status --porcelain` 空(報告還沒寫入)。本報告提交後必須空。

## learning/ 量測

只量不改。開工與收工相同。

| | sha256 前 16 | 檔數 | state/log.jsonl 行數 |
|---|---|---|---|
| 開工 | c2e4dd6d71de3976 | 64 | 108 |
| 收工 | c2e4dd6d71de3976 | 64 | 108 |

量的是主簽出的 learning/。沒有讀、寫、刪那裡的檔,也沒有碰 raw/、state/ 以外的那次 `wc`。

## 測試

實作前,受保護紅測試(同一條 vitest,含 t31-cli / t31-handler / t31-static):

```text
 Test Files  6 failed (6)
      Tests  214 failed | 98 passed (312)
   Start at  02:44:04
   Duration  15.80s (transform 265ms, setup 89ms, import 638ms, tests 14.32s, environment 0ms)
```

與派工參考基底一致(failures 90 紅/1 綠、grade-apply-unavailable 69/59、grade-fill-unavailable 13/17、t31-handler 28/17、t31-cli 3/1、t31-static 11/3,加總 214 紅 / 98 綠)。紅的原因是 `failures.ts` 還沒有、`gradeApply` 不接 router 的錯、填空空 `catch {}` 把 bug 收掉、witness 與 boundaries 理由還沒補。

實作後,派工指定的 vitest 範圍:

```text
 Test Files  59 passed (59)
      Tests  1809 passed (1809)
   Start at  02:46:26
   Duration  220.02s (transform 961ms, setup 565ms, import 9.86s, tests 204.23s, environment 5ms)
```

指令:`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/llm packages/core/src/grading packages/core/src/session scripts/review apps/test-card features/support/t30-cli.test.ts features/support/t30-handler.test.ts features/support/t31-cli.test.ts features/support/t31-handler.test.ts features/support/t31-static.test.ts features/support/fixture-router.test.ts`

cucumber(只用 `--tags`,沒給 feature 路徑):

```text
164 scenarios (15 undefined, 149 passed)
804 steps (64 undefined, 14 skipped, 726 passed)
3m29.143s (executing steps: 1m54.329s)
```

指令:`CARGO_BUILD_JOBS=2 NODE_OPTIONS=--import=tsx npx cucumber-js --tags '(@grading or @review-cli or @test-card or @i2 or @review-session) and not @manual' --format summary`

退出碼 1,因為 15 個 undefined。都是 05 phase-3 與 06 phase-4 未實作的步驟,與派工參考基底(164 場景 149 過、15 undefined)相同。沒有已實作的場景變紅。

`npx tsc --noEmit`:無輸出,退出碼 0。

`npm run boundaries`:

```text
boundaries: 掃描 335 個檔案,允許例外 21 條
✓ 無違規
gate=boundaries result=PASS scanned=335
```

`npx tsx scripts/check-doc-links.ts` 與 `npm run lint:docs`(同一支檢查)都是:

```text
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=95
```

`npx vitest run scripts/zero-input-guard.test.ts`(單跑):

```text
 Test Files  1 passed (1)
      Tests  761 passed | 168 skipped (929)
   Start at  02:54:40
   Duration  42.40s (transform 90ms, setup 40ms, import 93ms, tests 42.16s, environment 0ms)
```

`npx vitest run scripts/degraded-report.test.ts features/support/degraded-registry-rot.test.ts`(沒有執行 `scripts/degraded-report.ts` 本身):

```text
 Test Files  2 passed (2)
      Tests  84 passed (84)
   Start at  02:55:23
   Duration  7.26s (transform 100ms, setup 48ms, import 105ms, tests 6.93s, environment 0ms)
```

## 累計費用

session `ses_eb4d59ff3ffessD0qQAV61ik8V`,opencode `session_v2.cost` = **$2.585424**(tokens in 173153、out 9067、reasoning 31906、cache read 3986560)。工單 `budget_usd: 5`,派工寫明 grok 不設上限、只記錄。LLM 真呼叫:0(三把 key 都 UNSET)。數字是提交報告前的快照,不含提交報告這一步之後的 token。畫面底列若與此有秒差,以協調者畫面上的為準。

## 待協調

無。
