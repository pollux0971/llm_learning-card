---
id: T31
deps: [T30]
touches: [packages/core/src/llm/failures.ts, packages/core/src/llm/index.ts, packages/core/src/grading/grade-apply.ts, packages/core/src/grading/grade-fill.ts, packages/contracts/src/witness.ts, scripts/boundaries.allow.json, scripts/degraded-report.ts]
cpu: heavy
budget_usd: 5
status: merged
owner: worker-grok
must_catch:
  - 應用題批改時 router 丟 LlmTimeoutError、OutputTruncatedError、NoModelError、AbortError,或雲端 SDK 的 APIConnectionError / APIConnectionTimeoutError,或帶 status 429 / ≥ 500 的錯,gradeApply 往外丟(側車變 internal、終端機整個停):模型不能用的測試必須紅(要回 pass null、grader error)
  - gradeApply 把程式的 bug 收成 pass null(例如把分類函式換成永遠回一個原因、或 catch 不分類就收):bug 不藏的測試必須紅(TypeError、RangeError、ReferenceError、ZodError、UnknownTaskError、UnaccountableLlmCallError、MissingLedgerError、UnknownSpendError、普通的 Error 都要原樣丟出)
  - gradeApply 把憑證問題收成 pass null(MissingCredentialError,或 401——包在 NoModelError 的 cause 裡的也算):T30 的 credential-unavailable 就看不到了,憑證不收的測試必須紅
  - 設定錯誤(GatewayModelRejectedError、UnsupportedProviderError、雲端 400 / 403 / 404)被收成 pass null:設定錯誤不收的測試必須紅
  - 分類用 err.name 認 SDK 的錯(兩家 SDK 的錯 name 都是 "Error"),真的 SDK 錯誤物件認不出來:SDK 錯誤的測試必須紅(用真的 SDK class 建錯誤物件)
  - cause 鏈:NoModelError 包著 5xx 或連線失敗的 GatewayCallError 沒認成模型不能用,或包著 401 的被認成模型不能用:cause 鏈的測試必須紅
  - 模型不能用時沒有記 witness,或 witness 沒登記在 packages/contracts/src/witness.ts:退化訊號的測試(degraded-report 的登記檢查)必須紅
  - 模型不能用時又自動重打一次 router.call(同一題打兩次,使用者多等一倍):不自動重打的測試必須紅;回應解析不出來的那條「再打一次」照舊
  - 側車:應用題遇到模型不能用,submit 回 internal、或題目與輸入不見了、或 reviews.json 被改、或卡片前進 / 退回:submit 的測試必須紅(要 status error、題目留著)
  - 終端機:應用題遇到模型不能用,review.ts 整個停(exit 非 0)、或沒有記成「稍後再考」:終端機的測試必須紅
  - 填空:同義判斷的 router 丟程式的 bug 時還是收成 fallback-strict:填空 bug 不藏的測試必須紅;模型不能用、NoModelError、缺閘道鍵、閘道 401、模型名被拒照舊 fallback-strict
  - 05-grading phase-1、phase-2 的非 @manual 場景任一條變紅,T30 的測試變紅,或任何 .feature 被改:不退步必須紅
---

# 工單 T31:批改時模型連不上就是「評分失敗」,不是「複習程式停了」;程式的 bug 照樣丟出來

> 狀態:顧問審過 2026-10-17(五點照建議)。
> 作者:UI/Tauri 負責人(起草;顧問 2026-10-17 給方向)。編號:T31(協調者配)。派工:協調者。順序:T23 → T30 → T31。
> 實作:worker-grok(opencode grok-4.7)。紅測試:-e5(排在 T30 之後)。驗收:-ed(grading 是嚴格級,要跑變異)。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 起因:T24 `@manual` O1 之後的另一半(顧問 2026-10-17):T30 管憑證;憑證以外的批改失敗(網路、閘道掛、逾時)在 submit 一樣變成 `internal` 迴圈。
> 決策:ADR-076(T30:憑證錯誤走 `credential-unavailable`)、ADR-039(備援表)、ADR-044(退化訊號 witness)、契約 §7(路由表)。
> 基底:main(`2cb81bc` 或之後;T30 合併之後再派,這張要用到 T30 的 `credentialProblem`)。

## 為什麼有這張

應用題送出時,`gradeApply` 呼叫 `router.call('grade.apply', …)`(`../../packages/core/src/grading/grade-apply.ts` 的 `gradeApply`,兩次嘗試的迴圈),**router 丟的錯完全不接**:
`submitAnswer` 丟 → 側車 handler 的 catch-all 回 `internal`(`../../packages/core/src/session/handler.ts:211`)→ 視窗「複習程式停了。」,按「重新開始」回到同一題,網路沒好就永遠過不去;終端機 `review.ts` 直接印錯、exit 1(`../../scripts/review.ts:248`),這一輪後面的題都沒考。

但 `gradeApply` 本來就有「這次批不了」的出口:回應兩次解析不出來 → `{ pass: null, grader: 'error' }`(05 phase-2「Two failures leave the card untouched」)。
`submitAnswer` 遇到 `pass: null`:側車(`keepOnError`)回 `status: "error"`、題目留著(視窗「評分失敗,請再試一次」);終端機記成這張卡有錯、這一輪結束時算進「稍後再考」(`../../packages/core/src/session/answer.ts:127`、`:143`)。
所以這張只要讓「模型這次不能用」也走那個出口,側車、視窗、終端機都不用改。

關鍵是分清楚兩種(顧問 2026-10-17):

- **模型這次不能用**(網路、閘道掛、逾時、限流、服務端 5xx、沒有可用的模型):不是程式的錯,也不是使用者的錯,再試可能就好 → 「評分失敗」、題目留著。
- **程式的 bug、設定錯誤**(`TypeError`、`ZodError`、`UnknownTaskError`、沒接帳本……):收成「評分失敗」就是把 bug 藏成靜默退化 → 照舊往外丟(`internal`,看得見)。
- **憑證**是 T30 的(`credential-unavailable`),這張一定要讓它們原樣穿過去。

## 驗收條件

### 1. 分類函式(`packages/core/src/llm/failures.ts`,新檔,03-llm-router 的落點)

`llmUnavailableReason(err): LlmUnavailableReason | undefined`,`LlmUnavailableReason` 是 `'timeout' | 'truncated' | 'no-model' | 'network' | 'rate-limited' | 'server-error'`。

- **先排除憑證**:T30 的 `credentialProblem(err, env)` 認得的(缺鍵、401,含 `cause` 鏈)→ `undefined`(讓它往外丟,handler 變 `credential-unavailable`)。這一條一定在最前面:閘道的 401 被包成 `NoModelError`,不先排除就會被下面的 `no-model` 收掉。
- 看這個錯和它的 `cause` 鏈(最多三層),第一個認得的算:

| 認法 | 原因 |
|---|---|
| `instanceof LlmTimeoutError`;或 `name === 'AbortError'`(閘道那邊用 `AbortController` 做逾時,`../../packages/core/src/llm/router-gateway.ts` 的 `callGateway`,abort 丟出的是 `AbortError`,不會被包) | `timeout` |
| `instanceof OutputTruncatedError` | `truncated` |
| `instanceof NoModelError`(離線又沒有本機模型;閘道打不通也被包成這個) | `no-model` |
| 兩家 SDK 的 `APIConnectionError`(含子類 `APIConnectionTimeoutError`)——**用 `instanceof`**:實測兩家 SDK 的錯 `name` 都是 `"Error"`,只有 `constructor.name` 才是類別名 | `network` |
| 訊息或 `cause.code` 符合 ingest 用的同一個網路特徵正規式(`fetch failed`、`ECONNRESET`、`ECONNREFUSED`、`ETIMEDOUT`、`EAI_AGAIN`、`ENOTFOUND`、`EPIPE`、`socket hang up`、`network error`,`../../packages/core/src/ingest/questions.ts` 的 `NETWORK_ERROR_PATTERN`,照抄;旁邊加一行註解:「與 ingest/questions.ts 的 NETWORK_ERROR_PATTERN 同一份,收成一份見 backlog」) | `network` |
| 數字 `status` 是 429 | `rate-limited` |
| 數字 `status` ≥ 500 | `server-error` |

- 其他一律 `undefined`。特別是:`TypeError` / `RangeError` / `ReferenceError` / `SyntaxError`(除非訊息符合網路特徵字——undici 的連線失敗是 `TypeError('fetch failed')`)、`ZodError`、`UnknownTaskError`、`UnaccountableLlmCallError`、`MissingLedgerError`、`UnknownSpendError`、`GatewayModelRejectedError`、`UnsupportedProviderError`、`CloudRequiredError`、400 / 403 / 404、不是 `Error` 的丟出物。
- 純函式,不打網路、不記 log、不讀檔。

### 2. 應用題(`packages/core/src/grading/grade-apply.ts`)

- `router.call('grade.apply', …)` 包一層 try:`llmUnavailableReason(err)` 有值 → 記 witness `grading.apply.llm-unavailable`、記一筆 warning(`{ type: 'warning', task: 'grade.apply', reason: 'llm_unavailable', cause: <原因> }`,只寫原因的代號,不寫例外原文),回
  `{ pass: null, feedback: '這次沒辦法批改(模型暫時連不上),請再試一次。', grader: 'error' }`;沒有值 → 原樣往外丟。
- 回應解析不出來的「再打一次」照舊(兩次的迴圈不改);**模型不能用不重打**(顧問 2026-10-17:使用者再按「送出」就是重打;自動重打在逾時的情況下會讓人多等一倍,雲端逾時 60 秒,`../../packages/core/src/llm/router.ts` 的 `DEFAULT_TIMEOUT_MS`):第一次 `router.call` 就丟出來時,這一題只打一次。第一次回應解析不出來、第二次 `router.call` 丟出模型不能用 → 一樣回上面那個 `pass: null`。
- warning 的 log 照 `gradeApply` 現在的寫法:有 `logPath` 才寫(`../../packages/core/src/grading/grade-apply.ts` 的 `createFileLogAppender`,沒給就不寫;複習那條路現在沒給,跟「回應解析不出來」那筆 warning 一樣)。這張不加 `logPath` 的接線。
- `packages/contracts/src/witness.ts` 登記 `grading.apply.llm-unavailable`(`kind: 'swallow'`、`owner: '05-grading'`、一句說明),跟 `grading.apply.unparsable-skipped` 同一區。`scripts/degraded-report.ts` 的報表要讀得到它。

### 3. 填空(`packages/core/src/grading/grade-fill.ts`)

`gradeFillBlank` 現在 `catch {}` 全收,連程式的 bug 都變成 `fallback-strict`。這正是「不准一律收掉」(顧問 2026-10-17),所以一起收窄。

- `gradeFillBlank` 的 `catch {}` 改成先分類:`llmUnavailableReason(err)` 有值,或是契約 §7「沒有本機模型」那一家(`NoModelError`、`MissingCredentialError` 且鍵是 `GATEWAY_API_KEY`、閘道 401、`GatewayModelRejectedError`)→ 照舊 `fallback-strict` 與 witness `grading.fill.llm-failed-strict`;其他往外丟。
- 填空的同義判斷永遠不回 `pass: null`、不回 `credential-unavailable`(T30 寫的「填空缺閘道鍵照契約 §7 退回嚴格比對」不變)。
- `witness.ts` 裡 `grading.fill.llm-failed-strict` 的說明改成「router 回報模型不能用或沒有本機模型時……」,不再寫「呼叫丟錯」。

### 4. 側車、視窗、終端機(不改程式,補測試證明)

- 側車:應用題遇到模型不能用 → `submit` 回 `status: "error"`、`pass: null`、`cardDone: false`;session 還在,再送一次可以;`reviews.json` 雜湊不變;卡片 stage 不動。
- 視窗(T24 的程式):「評分失敗,請再試一次」,題目與輸入留著(T24 已有的行為,這次換成「模型不能用」這個成因再驗一次)。
- 終端機 `review.ts`:應用題遇到模型不能用 → 印那句 feedback,繼續下一題;這一輪結束時小結的「Retry later」算進這一題;exit 0;有答題就照舊 snapshot。

### 5. 變異測試(嚴格級,驗收跑)

- 驗收(-ed)走 `npm run mutate`,範圍:`packages/core/src/llm/failures.ts`、`grade-apply.ts`、`grade-fill.ts`。
- 門檻照各自的 FEATURE.md:05-grading 的 LLM 相關檔 80%(前兩層 95% 那一段這張不碰);03-llm-router 的一般檔 80%。新出現的存活變異逐條說明(等價或缺口)。
- 一定要殺掉的:分類表每一列換成別的原因或拿掉;「先排除憑證」那一步拿掉;`cause` 鏈只看一層;`instanceof` 換成 `name` 比對;`gradeApply` 的 try 拿掉或改成不分類就收。

### 6. 不退步

- `features/05-grading/phase-1.feature`、`phase-2.feature` 的非 `@manual` 場景全綠;任何 `.feature` 都不改。
- T30 的憑證測試全綠(這張不能把憑證問題收掉)。T22、T24、T26 的側車與考試卡測試全綠。cucumber `@grading and not @manual`、`@review-cli and not @manual`(拿位子)全綠。
- `npm run boundaries`:PASS。grading 現在沒有從 `@core/llm` import 任何東西(它用自己 `types.ts` 的 `LlmRouter` 型別);這張要 import 分類函式與錯誤類別。
  `scripts/boundaries.allow.json` 已有 05-grading → 03-llm-router 這一條,但理由只寫 `scripts/grade.ts`;在同一條的 `reason` 補一句(`grade-apply.ts`、`grade-fill.ts` 用 03 的 `llmUnavailableReason` 與錯誤類別分辨「模型不能用」與 bug,不在 05 另寫一份),不加新的一條。
- 新程式不用靜默預設;要用就登記在 `scripts/degraded-report.ts` 的 `NOT_INSTRUMENTED` 並寫理由。

### 7. 觀感(`@manual`,前端做、技術顧問判)

用 `tauri build --debug --no-bundle` 的產物,暫存根 + `vault.ts init`,**假 router**,不准 live。重活要協調者給位子。真的 learning/ 開工、收工各量一次。檢查器設 `value`、按鈕 `click()`。簽出的 `.env` 只放假值,做完刪掉。

| 場景 | 怎麼做 | 過的條件 |
|---|---|---|
| 閘道掛了 | 假 cloud 的複本:`/gateway/chat` 回 503(沒設 `LLM_CLOUD_PROVIDER`,應用題走閘道) | 「評分失敗,請再試一次」,題目與作答欄的字都在;側車回 `status: "error"`;改回正常、再按「送出」→ 有結果 |
| 連線被拒 | 假 cloud 的 `fetch` 丟 `TypeError('fetch failed')`(cause `ECONNREFUSED`) | 同上 |
| bug 不藏 | 假 cloud 回一個會讓 adapter 丟 `TypeError`(不是網路特徵字)的回應 | 「複習程式停了。」(`internal`),不是「評分失敗」 |
| 終端機 | 同「閘道掛了」,跑 `review.ts`,應用題送出 | 印 feedback、繼續下一題、小結有「Retry later: 1」、exit 0 |
| 長相 | 檢查器截圖「評分失敗」畫面 | console 0 則 |

## 規格

這張不加、不改 `.feature`:05 phase-2「Two failures leave the card untouched」(`pass: null`、呼叫端不前進也不退回)已經涵蓋這個結果,這張是同一個結果多一個成因(顧問 2026-10-17)。
05 phase-3(I6,離線審核與複審)不碰:這張不產生 provisional、不進複審佇列。行為以本檔驗收條件為準。

## 紅測試(-e5 寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| 1 | 分類 | vitest:分類表每一列一個(SDK 的錯用真的 `OpenAI.APIConnectionError` / `Anthropic.APIConnectionError` 建);排除表的每一種;`cause` 鏈兩層、三層、四層(第四層不看);`NoModelError` 包 503 / 包 401;不是 `Error` 的丟出物 | 紅 |
| 2 | 應用題 | vitest:假 router 第一次就丟各種錯 → `pass: null`、`grader: 'error'`、`router.call` 只被叫一次;丟 bug / 設定錯 / 憑證 → 原樣丟出(同一個物件);第一次解析不出、第二次丟模型不能用 → `pass: null`;witness 記了;有 `logPath` 時 warning 的欄位、沒有例外原文 | 紅 |
| 2 | witness 登記 | 既有的 degraded-report / witness 登記檢查(新的名字沒登記就紅) | 紅 |
| 3 | 填空 | vitest:模型不能用、`NoModelError`、缺閘道鍵、閘道 401、模型名被拒 → `fallback-strict`;`TypeError`(非網路)、`ZodError` → 丟出 | 紅(後兩種;前面的本來就綠) |
| 4 | 側車 / 終端機 | vitest:`createReviewHandler` + 會丟模型不能用的假 router → submit 的結果、session、雜湊;`review.ts` 子程序(`--import` 假 cloud 回 503)→ exit 0、小結 | 紅 |
| 6 | 不退步 | 既有測試全綠。用 `new Error(...)` 當「沒有模型」的舊測試,改成真的錯誤種類(`NoModelError` 等),**逐條**寫進 commit 說明(檔名、測試名、改前改後);-ed 驗收時逐條核對每一條都是換成真的錯誤種類,不是把斷言放寬 | 綠 |

- 自測片段一律最小,不放可以直接抄的完整實作。測試一律用 `mkdtemp` 當 `XDG_*` 與 `HOME`;**不准 live**。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/llm packages/core/src/grading packages/core/src/session scripts/review
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '(@grading or @review-cli) and not @manual' --format summary
npm run boundaries
```

- 環境:`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`。cucumber 一律用 `--tags`(重活,先拿位子)。變異測試由驗收走 `npm run mutate`。
- 不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev`。

## 不在範圍

- 設定錯誤(`GatewayModelRejectedError`、`UnsupportedProviderError`、雲端 400 / 403 / 404)照舊往外丟(`internal`,看得見但說不清楚)。專屬的錯誤種類記在 backlog,不配號;有人回報再開(顧問 2026-10-17)。
- ingest 改用同一個分類函式:這張不動 `ingest/questions.ts`(02-ingest 也是嚴格級);收成一份記在 backlog。
- router 層的備援規則:雲端連線錯(`APIConnectionError`)現在不算 `isCloudFailure`(只認逾時、截斷、5xx),所以不會換到閘道。要不要讓它也換閘道是 ADR-039 的事,不在這張。
- 05 phase-3 的離線審核、provisional、複審(I6)。
- `submitAnswer` 把 `logPath` 傳給 `gradeApply`(複習那條路的 warning 現在都不寫進帳本)。
- 不改側車、視窗、`review.ts`、Rust、`contracts/`(磁碟格式)、任何 `.feature`、任何測試檔(測試由 -e5 改)。

## 預算

`budget_usd: 5`。grok 不設花費上限,只記錄。LLM 真呼叫:0。

## 測試誰寫

- 紅測試:-e5。開發 worker 以紅測試分支為基底。
- 實作:worker-grok,只改「touches」列的檔。
- 驗收:-ed(含變異測試)。觀感:前端(驗收 7),技術顧問判。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
排程:落點是 `packages/core/src/llm`(新檔)、`packages/core/src/grading`、`packages/contracts/src/witness.ts`。**要用 T30 的 `credentialProblem`,T30 合併之後再派**(檔頭 `deps`)。跟 T28、T29 不重疊。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
