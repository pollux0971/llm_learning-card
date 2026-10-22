---
id: T30
deps: [T23]
touches: [scripts/_env.ts, scripts/review-sidecar.ts, scripts/review.ts, packages/core/src/session/handler.ts, packages/core/src/session/protocol.ts, packages/core/src/llm/credentials.ts, packages/core/src/llm/router.ts, packages/core/src/llm/index.ts, apps/test-card/src/session.ts, apps/test-card/src/App.svelte, scripts/degraded-report.ts]
cpu: heavy
budget_usd: 5
status: merged
owner: worker-grok
must_catch:
  - 側車 start 時批改路徑要的金鑰沒有設定,start 卻回 ready(或 internal、router-unavailable):金鑰檢查的測試必須紅
  - 要哪個鍵算錯:LLM_CLOUD_PROVIDER 是 openai / anthropic 時沒要那家的鍵,或沒設 provider(或不認得)時沒要 GATEWAY_API_KEY、反而要雲端的鍵:必要金鑰的測試必須紅(以 router 實際先走的那條路為準)
  - start 時的金鑰檢查打了網路(呼叫 fetch、probeOnline):檢查不打網路的測試必須紅
  - credential-unavailable 的訊息沒有鍵名、或帶了鍵的值、絕對路徑、例外原文:訊息的測試必須紅
  - 側車起來之後才在 .env 補上金鑰、或改了金鑰的值、或刪掉一個鍵,下一次 start 沒有照檔案現在的內容(例如只呼叫 process.loadEnvFile:它不覆蓋已經有的值):重讀 .env 的測試必須紅
  - 重讀 .env 改掉了啟動環境本來就有的變數:重讀 .env 的測試必須紅
  - .env 裡寫 LC_REVIEW_FAKE_CLOUD 或 LC_REVIEW_TODAY 就讓側車開假 router 或換測試日期(第一次載入或重讀都算;安全洞,硬條件):開關只來自啟動環境的測試必須紅
  - .env 內容變了,start 之後還用快取的舊 router(舊的閘道 token):重建 router 的測試必須紅
  - submit 遇到 MissingCredentialError、雲端 401、或閘道 GatewayCallError 401(包在 NoModelError 的 cause 裡的也算),回 internal:submit 憑證錯誤的測試必須紅(要回 credential-unavailable)
  - submit 遇到憑證錯誤之後 session 被清掉、reviews.json 被改、或帳本多一筆:submit 憑證錯誤的測試必須紅
  - 視窗:start 回 credential-unavailable 時顯示「複習程式停了」、沒有「再試一次」、或「再試一次」不是重新 start:錯誤處理的測試必須紅
  - 視窗:submit 回 credential-unavailable 時題目或輸入不見了、或顯示「評分失敗,請再試一次」(不是金鑰那一句)、或送出鍵停用:錯誤處理的測試必須紅
  - 終端機 review.ts:缺金鑰時不是印同一句、exit 2,或還建了當日快取、snapshot:終端機的測試必須紅
  - 側車在 D 日起來、D+1 日 start,今天還是 D(沒有設 LC_REVIEW_TODAY 時):每次 start 重算今天的測試必須紅
  - 設了 LC_REVIEW_TODAY 時,start 換成真的日期:測試日期的測試必須紅
  - 同一輪(start 之後的 next / submit / summary)中途換了日:進行中不換日的測試必須紅
  - T22、T24、T26 已有的側車與考試卡測試任一條變紅(除了本張驗收 2 寫明要改的那一條),或任何 .feature 被改:不退步必須紅
---

# 工單 T30:缺金鑰時 start 就說清楚、側車每次 start 重讀 .env 與重算今天

> 狀態:顧問審過 2026-10-17(六點照建議,第 6 點另開 T31)。
> 作者:UI/Tauri 負責人(起草;顧問 2026-10-17 給方向)。編號:T30。派工:協調者。優先:中,排在 T23 之後。
> 實作:worker-grok(opencode grok-4.7)。紅測試:-e5。驗收:-ed。觀感:前端拍、技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 起因:T24 `@manual` 的 O1(`../reviews/T24-manual-2026-10-17.md`)。決策:ADR-034(`.env` 只在入口讀)、ADR-075(側車)。`protocol.ts` 的 `ERROR_KINDS` 是 core 的軟約定,不是 `contracts/` 硬約定。
> **ADR(ADR-076)**:協調者合併這張工單時用 `/decide` 配號寫一筆(顧問 2026-10-17):每次 start / submit 重讀 `.env`(只在 `_env.ts`、環境優先、`LC_REVIEW_` 不從檔案設)、每次 start 重算今天、`credential-unavailable` 與兩句樣板。
> ADR-034 與 ADR-075 不改內文,各加一行「部分由 ADR-076修訂(重讀 .env、樣板訊息)」的指標。實作 worker 不寫 ADR。
> 基底:main(`e5e3015` 或之後,T23 合併之後再派)。

## 為什麼有這張

缺金鑰時,應用題一送出:`router.call` 丟 `MissingCredentialError` → `gradeApply` 不接(`../../packages/core/src/grading/grade-apply.ts`)→ `submitAnswer` 丟 → handler 的 catch-all(`../../packages/core/src/session/handler.ts:211`)→ `internal` →「複習程式停了」。
按「重新開始」回到同一題,再送還是一樣,永遠過不去;使用者也看不出原因是缺金鑰。終端機同源:`review.ts` 的 `liveRouterOrExit`(`../../scripts/review.ts:68`)只驗帳本,router 懶建,缺金鑰要到批改時才爆。

T24 `@manual` 量到的是 `GATEWAY_API_KEY`:沒設 `LLM_CLOUD_PROVIDER` 時 `probeOnline` 回 false(`../../packages/core/src/llm/router.ts:179`),應用題照契約 §7 走 local,也就是閘道。所以「要哪個鍵」要照 router 實際先走的那條路算,不能寫死成雲端的鍵。

還有一個安全洞(起草時實測):側車先 `import './_env.js'`(`../../scripts/review-sidecar.ts:8`)才讀 `LC_REVIEW_FAKE_CLOUD`(第 106 行)與 `LC_REVIEW_TODAY`(第 112 行),所以 `.env` 裡寫這兩個就會開。
簽出的 `.env` 只放這兩行、環境不帶,直接跑側車 → `hello` 是 `fakeCloud: true`、`today` 是 `.env` 寫的日期。release build 一樣(Rust 的白名單管不到側車自己讀的檔),違反 ADR-075 第 6 點「假 router 只能由啟動時的環境變數開」。這張本來就要改 `_env.ts`,一起關掉(驗收 3,硬條件)。

另外側車的「今天」只在起來時算一次(`../../scripts/review-sidecar.ts:115`)。這是常駐的系統列 app,隔夜不重開,隔天 `start` 會拿到昨天的當日快取(顧問 2026-10-17 併進這張:跟「每次 start 重讀環境」是同一件事)。

## 驗收條件

### 1. 金鑰檢查(core:`packages/core/src/llm/credentials.ts`,新檔)

- `requiredGradingKeys(env)`:只看環境變數,不打網路,回批改**先走的那條路**要的鍵名:
  - `env.LLM_CLOUD_PROVIDER` 是 `openai` → `['OPENAI_API_KEY']`;是 `anthropic` → `['ANTHROPIC_API_KEY']`(應用題雲端優先,`grade.apply` 是 `gateway-fallback`);
  - 沒設或不認得 → `['GATEWAY_API_KEY']`(`probeOnline` 回 false,應用題走 local = 閘道)。
  - 判斷 provider 用 router 自己那一份(把 `../../packages/core/src/llm/router.ts:210` 的 `resolveProviderName` 與 `envVarFor`(第 46 行)抽成可匯出的純函式,router 改呼叫它),兩邊不會算得不一樣。側車與終端機建 router 時都沒給 `settings`,所以檢查也只看 `env`。
  - 填空的同義判斷(`grade.fill.llm`,閘道)缺鍵時照契約 §7 退回嚴格比對(`../../packages/core/src/grading/grade-fill.ts` 的 `fallback-strict`),不算「不能批改」,不列進必要的鍵。
- `missingGradingKeys(env)`:`requiredGradingKeys` 裡值是空或沒設的那些。
- `credentialProblem(err, env)`:submit 時把丟出來的錯認成憑證問題,認不出來回 `undefined`。看這個錯**和它的 `cause` 鏈**(最多幾層,第一個認得的算):
  閘道的錯會被包起來——`callGateway` 把 `GatewayCallError` 包成 `NoModelError`,原本的錯放在 `cause`(`../../packages/core/src/llm/router-gateway.ts` 的 `callGateway`),所以只看外層的 `name` 認不出閘道的 401。
  - `name` 是 `MissingCredentialError` → 缺,鍵 = 它的 `envVar`(閘道 client 在 `try` 外面建,缺 `GATEWAY_API_KEY` 時這個錯不會被包);
  - `name` 是 `GatewayCallError`、`status` 401(換 token 被拒、或重換 token 之後還是 401)→ 被拒絕,鍵 = `GATEWAY_API_KEY`;
  - 其他 `Error` 帶數字 `status` 401(雲端 SDK 的 401;`isCloudFailure` 只認 5xx,所以 401 不會換閘道,直接丟出來)→ 被拒絕,鍵 = 目前 provider 的鍵。
  - 鍵名只能是 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GATEWAY_API_KEY` 三個之一;不是這三個就回 `undefined`(照舊 `internal`)。403 不算(閘道的 403 是模型名填錯,`GatewayModelRejectedError`)。
- `credentialMessage(problem)`:兩句固定的樣板,只換鍵名:
  - 缺:「批改要用的金鑰沒有設定:{鍵名}。請在專案根目錄的 .env 加上。」
  - 被拒絕:「批改用的金鑰被拒絕:{鍵名}(可能過期或打錯)。請在專案根目錄的 .env 換一個。」
  - 不帶值、不帶絕對路徑、不帶例外原文。檔案寫成「專案根目錄的 .env」(ADR-075 第 4 點「訊息不帶路徑」不改),鍵名只從上面三個挑,所以可能出現的訊息是有限的幾句、都由程式決定(ADR-075 第 5 點的「固定的訊息」由這張的 ADR 補上樣板這一種)。

### 2. 側車(`handler.ts`、`protocol.ts`、`review-sidecar.ts`)

- `protocol.ts`:`ERROR_KINDS` 加 `credential-unavailable`;`ERROR_MESSAGES` 給它一句備用的固定句(「批改要用的金鑰不能用。請在專案根目錄的 .env 檢查。」)。檔頭的「回給視窗的 message 只用這裡的句子」補一句:這一種用 `credentialMessage` 的樣板。
- `ReviewHandlerDeps` 多三個(都可以不給,不給就是 T22 的行為,既有測試不用改):
  - `reloadEnv?: () => boolean`:重讀 `.env`,回「內容有沒有變」;
  - `missingKeys?: () => readonly string[]`:回缺的鍵名;
  - `today` 可以是字串(照舊)或 `() => string`。
- `start` 的順序(`../../packages/core/src/session/handler.ts:125`):
  1. 沒有卡 → `no-cards`(照舊);
  2. `reloadEnv()`;回 true 就丟掉快取的 router(下面第 4 步重建;閘道 client 在 router 裡懶建、會留著舊的 token);
  3. 算今天(`today` 是函式就呼叫一次),這一輪之後的 `next` / `submit` / `summary` / `status` 都用這一天,**進行中不換日**,只有下一次 `start` 會;
  4. 暫停日照舊不建 router、不查金鑰(暫停日不評分);否則 `ensureRouter()`(帳本、root-mismatch,照舊)→ `missingKeys()` 非空 → `credential-unavailable`,訊息是 `credentialMessage`(缺的那一個鍵;不只一個時用第一個,順序照 `requiredGradingKeys`);
  5. `openDay`(照舊)。
- `routerFactory` 還是「第一次 start 才呼叫、成功就快取」(`scripts/review-handler.test.ts` 第 7 行寫的 T22 行為),只多「`reloadEnv` 回 true 時丟掉快取」這一個例外。紅測試作者要不要改那一條既有測試的說明,由紅測試作者判斷並寫在 commit 說明裡。
- `submit`:先 `reloadEnv()`(回 true 一樣丟掉快取的 router,這一題用新建的;題目與輸入留著時,使用者改好 `.env` 再按「送出」就會用到新的值)。批改丟錯時,catch 先問 `credentialProblem`:認得 → `credential-unavailable` 加 `credentialMessage`;**不清 session**(題目留著,可以再送);認不得照舊(`review-record-changed` 照舊清 session,其他 `internal`)。
  憑證錯誤時 `submitAnswer` 還沒寫 `reviews.json`(批改在寫之前),帳本也沒有新的一筆(雲端與閘道的 `llm_call` 都在成功之後才記;失敗那次只有逾時與截斷會記,`../../packages/core/src/llm/router.ts` 的 catch);測試要證明這兩件。
- `review-sidecar.ts`:`reloadEnv` 用 `_env.ts` 匯出的函式(驗收 3);`missingKeys` 用 `missingGradingKeys(process.env)`;
  `today`:**起來時**有 `LC_REVIEW_TODAY`(debug build 才有)就固定用它(格式不對照舊 exit 2);沒有就傳 `localToday` 這個函式。`hello` 的 `today` 照舊是起來那天(只是告知)。
  `LC_REVIEW_FAKE_CLOUD` 照舊只在起來時讀一次;重讀 `.env` 不會改它(驗收 3)。

### 3. 重讀 `.env`(`scripts/_env.ts`,ADR-034 的「只在一個地方讀」不變)

- 匯出 `loadDotEnv(): boolean`。`import './_env.js'` 的副作用照舊(第一次載入),其他 CLI 入口不用改。
- 規則(`process.loadEnvFile` 不覆蓋已經有的值,改了的鍵、刪掉的鍵都看不到,實測 Node v22.15.1;所以重讀不能只再呼叫它一次):
  - 用 Node 內建的 `util.parseEnv` 解析(跟 `loadEnvFile` 同一個解析器),不自己寫;
  - **第一次載入之前**環境裡就有的變數,永遠不動(跟現在一樣:環境優先);
  - 檔案裡的鍵:設成檔案現在的值(新的加上、改的換掉);上一次從檔案設的鍵、這次檔案裡沒有了 → 從 `process.env` 刪掉;
  - 檔案不在 = 空檔案(從檔案設的鍵全部刪掉);讀不到也一樣,不丟錯;
  - **`LC_REVIEW_` 開頭的鍵一律不設**(第一次載入也是;**硬條件**,安全洞,見「為什麼有這張」):除錯開關只能來自啟動環境;
  - 回傳 `process.env` 有沒有因此改變。
- 只有 `_env.ts` 讀 `.env`;library 照舊只讀 `process.env`。值不印、不寫進任何 log。

### 4. 視窗(`apps/test-card/src/session.ts`、`App.svelte`)

- `start` 回 `credential-unavailable` → 走 T24 的「再試一次」畫面:訊息照原文,後面接「改好之後按「再試一次」。」;按了重新 `init()`(從 `start` 開始)。不用「複習程式停了」。
- `submit` 回 `credential-unavailable` → **題目與輸入都留著**,送出鍵可以再按;題目下面顯示那一句訊息,後面接「改好之後再按「送出」。」(取代「評分失敗,請再試一次」的位置與樣式)。
  `App.svelte` 現在把「評分失敗,請再試一次」寫死在畫面上(`../../apps/test-card/src/App.svelte:183`),改成顯示 `view.gradingError` 的字;批改回 `status: "error"` 時 `gradingError` 還是「評分失敗,請再試一次」,畫面字不變。
- `submit()` 的 catch 先看 kind:`credential-unavailable` → 上面那樣;其他照舊 `showError`。

### 5. 終端機(`scripts/review.ts`)

- 互動模式在 `liveRouterOrExit`(驗帳本)之後、`openDay` 之前:`missingGradingKeys(process.env)` 非空 → `console.error(credentialMessage(…))`、exit 2。這時還沒建當日快取、不 snapshot。`--dry-run`、`--pause`、`--unpause` 之後遇到暫停日照舊不查(它們不評分)。
- 答題時 `submitAnswer` 丟的錯若 `credentialProblem` 認得:印同一句、exit 2,不印小結、不 snapshot(跟 `ReviewsChangedError` 那條同一個收尾,`../../scripts/review.ts:248`)。之前答過的照舊已經寫進 `reviews.json`。
- 終端機一次跑完就結束,不重讀 `.env`。

### 6. 不退步

- `features/` 底下的 `.feature` 都不改。T22(`scripts/review-handler*.test.ts`、`review-sidecar*.test.ts`、Rust 的 `review_sidecar` 測試)、T24 / T23 的考試卡測試、T26 的樂觀檢查測試全綠。
- cucumber `@test-card and not @manual`、`@review-cli and not @manual`(拿位子)全綠。`npm run boundaries`:PASS。
- 新程式能不用靜默預設就不用;要用就登記在 `scripts/degraded-report.ts` 的 `NOT_INSTRUMENTED` 並寫理由。
- Rust 不用改:它只看信封,不認 `kind`(`../../apps/desktop/src-tauri/src/review_sidecar.rs`)。

### 7. 觀感(`@manual`,前端做、技術顧問判)

用 `tauri build --debug --no-bundle` 的產物,暫存根 + `vault.ts init`,**假 router**,不准 live。重活要協調者給位子。真的 learning/ 開工、收工各量一次,前後要相同。檢查器設 `value`、按鈕 `click()`,不在使用者的桌面送滑鼠鍵盤。
簽出的 `.env` 只放假值(`fake-key`),做完刪掉。

| 場景 | 怎麼做 | 過的條件 |
|---|---|---|
| start 缺鍵 | 簽出沒有 `.env`、帶 `LC_REVIEW_FAKE_CLOUD` | 「批改要用的金鑰沒有設定:GATEWAY_API_KEY。…改好之後按「再試一次」。」與「再試一次」;**app 不關**,在簽出放假值的 `.env`、按「再試一次」→ 出題;側車 stdin 看得到又一次 `start`;側車 pid 沒變(沒有重起) |
| submit 缺鍵 | 開始時 `.env` 有假鍵;出應用題後把 `.env` 裡那個鍵刪掉;送出 | 題目與作答欄裡的字都在,下面是缺鍵那一句;放回去、再按「送出」→ 有結果;`reviews.json` 在第一次送出前後不變 |
| `.env` 不能開假 router | 不帶 `LC_REVIEW_FAKE_CLOUD`,`.env` 裡寫 `LC_REVIEW_FAKE_CLOUD=…` | `hello.fakeCloud` 是 false、沒有「測試模式」那一行(不送出,不打真網路) |
| 終端機缺鍵 | 沒有 `.env`,`review.ts --dir <暫存> --today <今天>` | 印同一句、exit 2;暫存的當日快取不存在 |
| 長相 | 檢查器截圖:start 缺鍵、submit 缺鍵 | console 0 則;「送出」與「再試一次」不捲動可見(T15 的量法) |

- 跨日在真 app 上量不到(側車的環境是白名單,`LD_PRELOAD` 之類的時鐘工具帶不進去;等到真的午夜不實際)。由 vitest 用注入的時鐘驗(驗收 2 第 3 步);`@manual` 不做這一列。

## 規格

這張不加、不改 `.feature`(修正型工單,跟 T25、T26、T28 同型)。行為以本檔驗收條件為準。

## 紅測試(-e5 寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| 1 | 必要的鍵、訊息、認錯 | vitest:`requiredGradingKeys` 四種 provider 值(openai、anthropic、沒設、亂寫);`missingGradingKeys` 空字串當沒設;`credentialProblem` 三種錯各一、`GatewayCallError` 401 包在 `NoModelError` 的 `cause` 裡、401 以外的 status、不在三個鍵名裡的 `MissingCredentialError`;`credentialMessage` 全文;`globalThis.fetch` 換成會丟錯的,證明不打網路 | 紅 |
| 2 | 側車 start / submit / 今天 | vitest:`createReviewHandler` + 暫存根 + 假 `reloadEnv` / `missingKeys` / 時鐘;start 缺鍵 → `credential-unavailable`、補上再 start → ready;`reloadEnv` 回 true 時 `routerFactory` 再被叫一次;submit 用丟 `MissingCredentialError` / 401 的假 router → 那一種、session 還在、`reviews.json` 雜湊不變、帳本行數不變;D 日起、D+1 日 start → 新的一天;固定日期不變;start 之後換日,`next` / `submit` 還是舊的那天 | 紅 |
| 3 | 重讀 `.env` | vitest:暫存目錄放 `.env`(測試給檔案位置,或測 `_env.ts` 匯出的純邏輯);加鍵、改值、刪鍵、整個檔刪掉、啟動環境已有的鍵不動、`LC_REVIEW_` 開頭不設、回傳值 | 紅 |
| 4 | 視窗 | vitest:假 `ReviewClient`;start 那種 → `canRetry`、按了重新 `start`;submit 那種 → 題目與輸入在、`submitting` false、`gradingError` 是那一句;`status: "error"` 的字不變;靜態:`App.svelte` 沒有寫死「評分失敗,請再試一次」 | 紅 |
| 5 | 終端機 | vitest 或 cucumber(子程序):沒有金鑰的環境跑 `review.ts`(帶 `--import` 假 cloud,不打網路)→ stderr 那一句、exit 2、快取目錄沒有當日檔;答題中丟憑證錯 → 同一句、exit 2、沒有小結 | 紅 |
| 6 | 不退步 | 既有測試全綠 | 綠 |

- 自測片段一律最小,不放可以直接抄的完整實作。
- 測試一律用 `mkdtemp` 當 `XDG_*` 與 `HOME`;**不准 live**;不讀主簽出的 `.env`(要 `.env` 就在暫存目錄自己放假值)。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/llm packages/core/src/session scripts/review apps/test-card apps/desktop
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '(@test-card or @review-cli) and not @manual' --format summary
npm run boundaries
```

- 環境:`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`。cucumber 一律用 `--tags`(`BeforeAll` 會編 `lc-fs`,重活,先拿位子)。
- 不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev`。變異測試由驗收(-ed)走 `npm run mutate`。

## 不在範圍

- 憑證以外的批改失敗(網路、閘道、逾時)在 submit 變成 `internal` 的迴圈 —— **T31**(顧問 2026-10-17:要分清楚「router / LLM 的失敗」與「程式本身的 bug」,不能一律收成「評分失敗」;多半在 grading 層處理,grading 是嚴格級模組)。
- 填空同義判斷缺閘道鍵時退回嚴格比對(契約 §7 的設計,不改)。
- `LLM_CLOUD_PROVIDER` 填錯字(不認得)時的提示 —— 照 router 現在的行為當「沒有雲端」,要的是閘道的鍵;不另外說「provider 打錯了」。
- 不改 Rust(`apps/desktop/src-tauri/`)、HUD 元件、`contracts/`、任何 `.feature`、任何測試檔(測試由 -e5 改)。

## 預算

`budget_usd: 5`。grok 不設花費上限,只記錄。LLM 真呼叫:0。

## 測試誰寫

- 紅測試:-e5。開發 worker 以紅測試分支為基底。
- 實作:worker-grok,只改「touches」列的檔。
- 驗收:-ed。觀感:前端(驗收 7),技術顧問判。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
排程:落點橫跨 `scripts/`(`_env.ts`、`review-sidecar.ts`、`review.ts`)、`packages/core/src/llm`、`packages/core/src/session`、`apps/test-card/src`。**跟 T23 都改 `session.ts` 與 `App.svelte`,所以 T23 合併之後再派**(檔頭 `deps`)。跟 T28(`review_sidecar.rs`)、T29 不重疊。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
