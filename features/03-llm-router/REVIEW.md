# REVIEW — 03-llm-router:OpenAI 截斷 bug 修復(i1-integration-fix)

日期:2026-09-04
審核對象:commit 63cd09e(截斷偵測介面 + token 上限表骨架)+ a2d3ed5(adapter 實作)
審核者:審核 agent(本 session)

## 結論:PASS

修法邏輯是真的,不是投機取巧。發現一個真漏測(adapter 轉換邏輯完全沒有單元測試涵蓋),已在本次審核中補上測試並確認關掉。全部檢查通過,細節見下。

## 1. 邏輯審查

- `router.ts`:`call()` 用 `opts.maxTokens ?? TASK_MAX_TOKENS[task]` 查表,查到的
  `maxTokens` 連同 prompt 一起交給 adapter;拿到 `result.truncated === true` 時
  丟 `OutputTruncatedError`,**不**把半截 `text` 包進 `LlmResult` 回傳——確認不是
  「先回傳、事後才發現」的設計,是真的擋在回傳前面。
- `token-limits.ts`:`TASK_MAX_TOKENS` 7 個鍵和 `LLM_TASKS`(`types.ts`)完全對應,
  `ingest.cards: 8192 >= 4096` 回歸鎖存在且有獨立測試釘住。
- `errors.ts` 的 `OutputTruncatedError`:帶 `task` / `maxTokens` / `tokensOut`,
  訊息可讀。
- `adapters/openai.ts` / `adapters/anthropic.ts`:兩邊都不再寫死
  `MAX_COMPLETION_TOKENS = 1024`,改用呼叫端傳入的 `maxTokens`;openai 用
  `finish_reason === 'length'`、anthropic 用 `stop_reason === 'max_tokens'`
  各自映射到 `result.truncated`——這是修法的核心,邏輯正確。
- `router.ts` 的 catch 分支裡,`truncated: true` 連同 `max_tokens` / `tokens_out`
  確實寫進 log 事件(不是只 throw 不記);正常呼叫不會誤寫 `truncated` 欄位
  (`router.test.ts` 有測「正常呼叫不留下 truncated log」)。
- `router-impl.ts`(`scripts/ingest.ts` 實際使用的路由器)把 `call()` 委派給底層
  `CloudLlmRouter.call()`,修法會傳導到真正被呼叫的路徑,不是只修了一個沒人用的
  平行實作。
- `scripts/_env.ts`:CLI 入口用 `process.loadEnvFile()` 載入 `.env`,library 程式碼
  (`router.ts` 等)仍只讀 `process.env`,沒有把檔案 I/O 滲進 core——符合契約
  邊界。

## 2. 發現的問題與處理

**真漏測(已修)**:`adapters/openai.ts`、`adapters/anthropic.ts` 原本完全沒有
針對自己檔案的單元測試——`router.test.ts` 只用 `fakeAdapter` 假物件測 router 邏輯,
從沒有真的呼叫到 adapter 裡 `finish_reason` / `stop_reason` 映射、
`tokens_in`/`tokens_out` 欄位組裝、`latency_ms` 計算這些程式碼。第一輪 Stryker
證實了這點:adapters 兩個檔案 mutation score 0%(NoCoverage)。

處理方式:補上 `adapters/openai.test.ts`(11 個測試)、`adapters/anthropic.test.ts`
(12 個測試),mock `openai` / `@anthropic-ai/sdk` 的建構子,直接測 adapter 自己的
轉換邏輯,包含截斷偵測、token 計數、文字擷取、latency 計算。第二輪 Stryker 後
adapters 從 0% 升到 100%。

**一個等價變異(已標記,非漏測)**:`anthropic.ts` 的
`textBlock && textBlock.type === 'text' ? textBlock.text : ''` 這行,
`textBlock` 是用 `response.content.find((block) => block.type === 'text')` 找出來的,
truthy 時 `.type` 必為 `'text'`,再檢查一次恆真——把條件改成 `true` 的變異體
行為完全相同,是真等價,不是漏測。已加
`// Stryker disable next-line ConditionalExpression` 註解並寫明理由。

## 3. 測試 / 型別 / boundaries

```
npm ci                 通過
npm run boundaries      ✓ 無違規(掃描 171 個檔案)
npm run typecheck       ✓ 無錯誤
npx vitest run          938 個測試全過(64 個測試檔;原 916 + 本次新增 22)
```

## 4. Stryker 變異測試

### 標的模組(標準 80% 門檻):router.ts / token-limits.ts / adapters/openai.ts / adapters/anthropic.ts

| 輪次 | 分數 | 說明 |
|---|---|---|
| 第一輪(審核前現況) | **66.29%** | adapters/openai.ts、adapters/anthropic.ts 完全零覆蓋(NoCoverage),router.ts / token-limits.ts 100% |
| 第二輪(補 22 個 adapter 測試後) | 93.26% | 6 個存活變異:2 個 latency_ms 算式(`-` 被換成 `+`)、1 個 optional chaining、2 個 usage null 檢查、1 個等價變異(見上) |
| 第三輪(補 latency/optional-chaining/usage-null 測試 + 標記等價變異後) | **100.00%** | 0 存活 |

**最終分數:100.00%(門檻 80%)→ 通過**

### routing.ts 迴歸檢查(嚴格 95% 門檻)

本次沒有直接改 `routing.ts`,只是確認同資料夾的改動(`token-limits.ts`)沒有
意外互相影響。

```
npx stryker run --mutate "packages/core/src/llm/routing.ts,!packages/core/src/llm/routing.test.ts"
→ 100.00%(17 killed / 0 survived)
```

**最終分數:100.00%(門檻 95%)→ 無退步,通過**

## 5. Cucumber 乾跑

```
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "not @manual" --dry-run
→ 452 scenarios (164 undefined, 288 skipped)
→ ambiguous: 0 筆
```

`undefined` 的 164 個場景是還沒開工的未來 phase/feature(例如 I8 Windows 整合),
不是本次改動造成的問題。重點的 **ambiguous 步驟定義衝突為 0**,確認新增/修改的
step 沒有跟既有的撞名。

## 6. 修改檔案清單

- `packages/core/src/llm/adapters/anthropic.ts`(加一行等價變異註解,邏輯未變)
- `packages/core/src/llm/adapters/openai.test.ts`(新增)
- `packages/core/src/llm/adapters/anthropic.test.ts`(新增)
- `features/03-llm-router/REVIEW.md`(本檔案,新增)

## 7. 給協調者的結論

**PASS**。原始 bug(OpenAI adapter 寫死 1024 token 上限,截斷時靜默降級)已用
`OutputTruncatedError` + 每任務上限表徹底修好,且已傳導到 `scripts/ingest.ts`
實際使用的 `LlmRouterImpl` 路徑。審核過程中發現 adapter 轉換邏輯原本零測試覆蓋,
已在本次補齊,兩邊 Stryker 都拿到門檻以上分數,`routing.ts` 沒有退步。
沒有需要協調者人工確認的事項。

---

# 03-llm-router/phase-4 — 閘道本機 adapter + 預算備援(ADR-039)

審核 agent,2026-09-04。commit `c649fca`(測試)+ `4bff839`(實作)。

## 結論:PASS(附兩個要追的問題)

| 驗收項 | 結果 |
|---|---|
| `npm run boundaries` | 183 檔 0 違規 |
| `npm run typecheck` | 綠 |
| `npx vitest run` | 69 檔 **1136 passed / 0 failed**(審核前 1092,補了 44 個) |
| cucumber `not @manual` | 469 場景 **308 passed / 0 failed**(審核前 305) |
| phase-4 非 @manual | **17 場景 96 步全綠**(審核前 14 場景 77 步) |
| cucumber `--dry-run` | **0 ambiguous** |
| `npm run standalone` | 全部通過,`03-llm-router` ✓ |
| Stryker `fallback.ts` | **100.00%**(21 killed / 0 survived) |
| Stryker `spend.ts` | **98.41%**(62 killed / 1 survived,等價) |
| Stryker `adapters/gateway.ts` | **98.88%**(88 killed / 1 survived,等價) |
| Stryker `routing.ts` | **不用跑** —— `git diff dc04b2d..HEAD -- routing.ts` 是空的,整個 phase-4 一行都沒動它 |

門檻是 80%,三個都過。

## 契約檢查

| 項目 | 結果 |
|---|---|
| `LlmResult.provider` | `GATEWAY_PROVIDER = 'ollama'`,契約 §7 的三個合法值之一,沒改契約 |
| 契約 §7 路由表本體 | `ROUTING_TABLE` 與 `decideRoute()` 一個字都沒動 |
| `fallback.ts` / `spend.ts` 的落點 | 都是獨立檔案,沒有被搬進 `routing.ts`(ADR-039 決策 5) |
| 預算邊界 | `isBudgetExhausted` 是 `spent >= cap`,`cap <= 0` 視為不設限。剛好 1.00 算達到,有測試 |
| `ingest.*` 達上限 | `decideFallback` 在打雲端**之前**丟 `DailyBudgetExceededError`,訊息含「今日預算已用完」。有測試斷言雲端一次都沒被打到 |
| `ingest.*` 任何情況都不走閘道 | `FALLBACK_TABLE` 三個 `ingest.*` 都是 `cloud-only`,`decideFallback` 只會回 cloud 或丟錯,沒有到閘道的路徑 |
| `grade.fill.llm` 的 `provisional` | `gateway-always` 回 `provisional: false`;備援路徑才是 `true`。有測試 |
| 403(填雲端模型名) | `GatewayModelRejectedError` 直接往外丟,`callGateway` 不接,不觸發任何備援。有測試 |
| token 過期 | `chat()` 看到 401 就 `invalidateToken()` 重換再重試**一次**,第二次還 401 就丟錯不迴圈。有測試 |
| probe 的三種失敗 | 401 / 連線被拒 / `/gateway/models` 掛掉,全部回 `{ available: false, models: [] }`,都不 throw。審核時再補了「錯誤狀態碼」「body 形狀不對」「HTML 回應」「逾時」四種 |
| `spend.ts` 讀的欄位 vs 實際寫進 log 的 | **對得上**。`router.ts:126-134` 與 `router-gateway.ts:234-243` 寫的是 `ts` / `type:'llm_call'` / `provider` / `tokens_in` / `tokens_out`,`spend.ts` 讀的就是這五個。`ingest/questions.ts:191` 那筆重試事件**沒有 `provider` 欄位**,所以 `isLlmCallEvent()` 不會算它——這是對的,那只是重試標記,真正的呼叫由 `router.ts` 另外記一筆,不會重複計費 |

契約 §10 本身只定義 `LogEvent` 的 `ts` / `type` + catchall,`llm_call` 的欄位不在契約裡,所以權威是實際的產生端(上面那兩處),不是合成 fixture。開發 agent 用合成 log 驗 `llm-spend.ts` 沒問題(`learning/` 只存在於主 repo,worktree 裡本來就沒有)。

## 兩個「超出測試」的自主判斷 — 逐一判定

### 判斷 1:離線時把 `NoModelError` 也當成可備援的失敗 → **合理,保留,已補測試**

先查清楚 `NoModelError` 到底什麼時候丟。它只有一個產生點,`routing.ts:79` 與 `:82` 的 `decideRoute()`:

- `cloud-or-local`(deepen / grade.apply / reteach.short)+ `online === false` + `local === false`
- `local-only`(grade.fill.llm)+ `local === false`

而 `online` 來自 `CloudLlmRouter.probeOnline()`,它打的是 **OpenAI 的 `/v1/models`,回 `res.status < 500`**——不是「有沒有網路」。所以協調者問的那格是**會發生的**:

> OpenAI 掛掉(5xx)或 DNS 不通,但閘道在區網/另一台機器上還活著
> → `probeOnline()` 回 false → 底層 `localProber` 是 `alwaysUnavailable`(它不知道有閘道)
> → `decideRoute` 判成「離線+無本機」丟 `NoModelError`

這時候閘道還在、而且免費,放棄是浪費。所以這條是**有意義的補強**,不是把不該備援的錯誤路徑打開。

**沒有實質改變路由語意**,理由:

- `grade.fill.llm` 走 `gateway-always`,**根本不會進到 `inner.call()`**,所以它的 `NoModelError` 分支在 `GatewayLlmRouter` 底下是不可達的,這條判斷碰不到它。
- `ingest.*` 是 `cloud-only`,離線時 `decideRoute` 丟的是 `CloudRequiredError` 不是 `NoModelError`,而且就算真的丟了,catch 裡的 `decideFallback({cloud:'failed'})` 對 `cloud-only` 一樣丟 `CloudRequiredError`。**實測確認 `ingest.cards` 在「離線 + 閘道活著」下仍然是 `CLOUD_REQUIRED`,閘道一次都沒被打。**
- 唯一被打開的是 `deepen` / `grade.apply` / `reteach.short`,而那三個正是 ADR-039 決策 2 指定要備援到閘道的三個。

**問題:上一輪完全沒有測試鎖住它。** 我手動把 `&& !(err instanceof NoModelError)` 拿掉,**261 個 llm 單元測試與 49 個 llm-router 場景全綠**——就是上一張工單踩過的那個坑。

已補:

- `router-gateway.test.ts` 新增 `describe('GatewayLlmRouter.call — 雲端整個連不上(probeOnline 回 false)')` 4 個測試(deepen / grade.apply / reteach.short 退到閘道且標 provisional、備援原因是 `cloud_failed`、`ingest.cards` 仍然 `CLOUD_REQUIRED` 且閘道沒被打)
- `phase-4.feature` 新增 2 個場景:`Deepening still reaches the gateway when the cloud is unreachable`、`Card generation still refuses when the cloud is unreachable`,以及 `Given the cloud provider cannot be reached at all` 這個步驟(把 `onlineProber` 切成 false,其餘照舊)

再跑同一個手動變異:**3 個單元測試 + 1 個場景紅**。鎖住了。

### 判斷 2:`scripts/llm.ts` 改用 `GatewayLlmRouter` → **合理,保留,已補測試**

- 閘道沒起來時 `--probe` **乾淨**:`GatewayLlmRouter.probeLocal()` 用 try/catch 包住 `gateway().probe()`,連 `createGatewayClient()` 在沒設 `GATEWAY_API_KEY` 時丟的 `MissingCredentialError` 也接得住,回 `{ available: false, models: [] }`。實跑 `npm run standalone` 的 `03-llm-router` 通過(838ms,沒有 stack trace)。
- `standalone.json` **不用改**:`expect` 是 marker `"online"`,而 `--probe` 印的 JSON 永遠有 `"online"` 這個 key;退出碼仍然是 0。兩者都沒因為這個改動變動。

已補:`phase-4.feature` 新增 `Scenario: The probe reports the gateway as unavailable instead of crashing`(跑真的 CLI subprocess),斷言退出碼 0、印得出 online/offline、`local.available === false`、`local.models === []`、而且**輸出裡沒有 stack trace**。

## 審核中發現的問題

### 1)【已修】`adapters/gateway.ts` 的變異分數只有 **43.88%**,遠低於 80% 門檻

37 個存活 + 18 個沒覆蓋。根因不是「沒寫測試」,是**斷言太鬆**——最典型的:

```ts
it('5xx 丟 GatewayCallError 並帶著狀態碼', ...)   // 只斷言 instanceof + status
```

把 `if (!response.ok) throw ...` 整條拿掉,程式會往下走到「回應裡沒有 content」那條路,丟的**還是** `GatewayCallError`、status **還是** 503。兩個版本只有訊息不一樣,所以測試照樣綠。換 token 那一邊(`if (!response.ok)` → 落到「沒有 access_token」)是同一個陷阱。

另一個是**自我參照**:

```ts
now += GATEWAY_TOKEN_FALLBACK_TTL_MS - 1;   // 常數被改成別的值,基準跟著一起變
```

`50 * 60_000` 被改成 `50 / 60_000` 時測試照樣過,因為它拿常數自己當基準。

補了 37 個測試(26 → 63),涵蓋:錯誤訊息與 status 的精確斷言、`expires_in <= 0`、`expires_at` 的 epoch 秒 / 毫秒 / ISO 三種寫法與 **1e12 的分界邊界**、`absolute - now` 不是 `+`、token 剛好到期的邊界、寫死 50 分鐘的保守值、空的 / 型別不對的 `access_token`、`tokenExchanges` 計數、請求形狀(POST / content-type / Bearer)、`/gateway/models` 的錯誤狀態碼與壞掉的 body、**狀態碼壞掉時不看 body**、probe 逾時真的 abort、成功後不留計時器、chat 回應沒有 content / model 是空字串、`latency_ms` 不是兩個時間戳相加、**非 JSON 的 HTML 回應**、`AbortSignal` 有沒有真的傳給 fetch、`GATEWAY_BASE_URL` 預設值、結尾多個斜線。

**43.88% → 98.88%。**

過程中順手抓到假 fetch 兩個不夠忠實的地方,一併修掉:(a) 原本 `throwOn: 'all'` 會讓**換 token** 先失敗,所以「chat 連線失敗」那個測試其實從來沒走到 `postChat` 的 catch,補了 `throwOn: 'chat'`;(b) 假 fetch 完全忽略 `init.signal`,所以「signal 有沒有接上去」在測試裡看起來永遠都對,改成跟真的 fetch 一樣看到已 abort 的 signal 就 reject。

### 2)【已修】`spend.ts`:只有空白的 `LLM_DAILY_CAP_USD` 會**靜默關掉預算上限**

`readNonNegativeNumber` 的 `raw.trim() === ''` 少了 `.trim()` 的話,`Number('   ')` 是 **0**,而 `0` 在 `isBudgetExhausted` 裡的意思是「不設限」。也就是說一個手滑打成空白的環境變數會讓每日花費上限**完全失效**,而且不會有任何錯誤訊息。錢的方向上這是最糟的失敗模式。原本沒有測試。已補測試鎖住(`'   '`、`'\t\n'`、價格那兩個變數也一起)。

### 3)【已修】`spend.ts`:`ts` 是數字的事件會被算進花費

`typeof event.ts !== 'string'` 這道檢查沒有測試。拿掉之後,一筆 `ts` 是 epoch 毫秒(數字)的 `llm_call` 會被 `new Date()` 接受、算出一個真的日期,於是一筆形狀壞掉的紀錄被當成今天的花費算進帳。契約 §10 明寫 `ts: string`。已補測試。

### 4)【已修】`spend.ts`:「壞掉的一行只跳過那一行」這個安全性質沒有測試

程式註解特別強調「整份放棄會把花費算成 0,而 0 的方向是『還可以繼續花』」,但 `readDailySpend` 的測試裡沒有任何一行是壞的。已補測試(被砍斷的半行、完全不是 JSON 的行、空行、只有空白的行,其餘照算)。

**`spend.ts` 92.54% → 98.41%。**

### 5)【留著,要追】完全離線時的錯誤碼與契約 §7 不一致

契約 §7 路由表第三欄「離線+無本機」要求:`deepen` / `grade.apply` / `reteach.short` / `grade.fill.llm` 丟 `NO_MODEL`。ADR-039 的 Consequences 也明寫「離線(連不到閘道也連不到 OpenAI)的行為完全不變,還是契約 §7 那張表」。

實測(`onlineProber` 回 false + 閘道 fetch 直接 throw):

```
deepen           -> GatewayCallError code=GATEWAY_FAILED   契約§7要求: NO_MODEL
grade.apply      -> GatewayCallError code=GATEWAY_FAILED   契約§7要求: NO_MODEL
reteach.short    -> GatewayCallError code=GATEWAY_FAILED   契約§7要求: NO_MODEL
grade.fill.llm   -> GatewayCallError code=GATEWAY_FAILED   契約§7要求: NO_MODEL
ingest.cards     -> CloudRequiredError code=CLOUD_REQUIRED  ✓
```

閘道就是 §7 的「本機」(ADR-039 決策 1),所以「閘道也連不上」就是「無本機」那一格,契約要求 `NO_MODEL`,實際拿到 `GATEWAY_FAILED`。`ingest.*` 是對的。

兩個來源:`grade.fill.llm` 那條是 `gateway-always` 造成的(ADR-039 決策 2 本身,不是判斷 1);另外三個是判斷 1 把原本會正確往外丟的 `NoModelError` 換成了閘道的錯誤。

**目前沒有任何 consumer 會壞**——production code 裡唯一對錯誤碼分支的是 `ingest/ingest.ts:169` 的 `code === 'CLOUD_REQUIRED'`,而 `ingest.*` 的行為是對的;沒有任何 production code 分支在 `NO_MODEL` 上。所以這是**潛在**的硬約定偏差,不是現在會爆的 bug,因此**沒有擋這次 PASS**。

但 §7 路由表是硬約定,而且 `05-grading/phase-3`(離線審核)與 I6 正是未來會分支在 `NO_MODEL` 上的地方。**建議開一個 debug session 修**,最小修法是在備援路徑保留原錯誤:

```ts
// callGateway 失敗、而原錯誤是 NoModelError 時,把 NoModelError 丟回去
// ——「閘道也連不上」就是契約 §7 的「無本機」,不是「閘道壞了」
```

`grade.fill.llm` 那半要不要一起改(什麼樣的閘道失敗算「無本機」、什麼算「本機壞了」)契約沒有這一格,那是**新決策,要走 `/decide`**,我沒有自己選。

**沒有補測試把現在的 `GATEWAY_FAILED` 鎖起來**——那會把偏差固化成規格。

### 6)【留著,小】`router-gateway.ts:170` 是死程式

```ts
const retry = decideFallback({ task, cloud: 'failed', ... }, this.fallbackTable);
if (retry.target !== 'gateway') throw err;   // ← 不可達
```

`cloud: 'failed'` 是寫死的,而 `decideFallback` 在 `cloud === 'failed'` 時:`gateway-always` → gateway、`gateway-fallback` → gateway、`cloud-only` → **丟錯**。三個分組都不可能回 `target: 'cloud'`,所以這個 if 永遠是 false。手動拿掉它,261 個單元測試與 49 個場景全綠(確認過)。

不影響正確性,建議 debug session 一併刪掉。`router-gateway.ts` 不在嚴格門檻名單也不在這次要跑的三個檔案裡,所以 Stryker 沒有報它。

### 7)【留著,小】`probe()` 的短逾時管不到換 token 那一步

`probe()` 開的 `AbortController` 只傳給 `/gateway/models` 的 fetch;`this.token()` 裡打 `/auth/token/exchange` 的 fetch **沒有 signal**。現在 `GATEWAY_BASE_URL` 是 `localhost:8787`,沒人聽就是立刻 ECONNREFUSED,所以看不出來。ADR-039 說之後要換成網域、而且特別要求「`probeLocal()` 的逾時要短(當可用性檢查用)」——那時候封包被防火牆黑洞吃掉,`token()` 會掛到 OS 預設的 TCP timeout(可能兩分鐘),`GATEWAY_PROBE_TIMEOUT_MS = 5000` 完全沒作用。

換網域之前修掉就好,現在不影響。

## 有沒有投機取巧

沒有。假閘道(`features/steps/llm-router.steps.ts` 的 `installFakeFetch` 與 `gateway.test.ts` 的 `makeFetch`)都是照 `_fake-cloud.mjs` 的模式**只換 `globalThis.fetch` / 注入 `fetchImpl`**,router / GatewayClient / OpenAI SDK 全部跑真的,狀態碼與 body 都是真的 `Response` 物件。沒有硬寫死 fixture 當成回傳值。原本的問題是**斷言太鬆**(見發現 1),不是 mock 造假——修法是把斷言收緊,不是換掉 mock。

## 我改了什麼

只有測試檔,加上三處**純註解**的 source 改動(Stryker 等價變異的說明,`git diff` 確認過沒有任何非註解改動):

- `features/03-llm-router/phase-4.feature` — +3 場景(14 → 17)
- `features/steps/llm-router.steps.ts` — +1 Given、+2 Then、`onlineProber` 改成可切換
- `packages/core/src/llm/router-gateway.test.ts` — +4 測試(判斷 1)
- `packages/core/src/llm/adapters/gateway.test.ts` — +37 測試,假 fetch 補齊忠實度
- `packages/core/src/llm/spend.test.ts` — +3 測試
- `packages/core/src/llm/spend.ts` — 只有註解(1 處等價變異說明)
- `packages/core/src/llm/adapters/gateway.ts` — 只有註解(2 處等價變異說明)

## 存活變異的四分類處理

| 檔案 | 位置 | 分類 | 處理 |
|---|---|---|---|
| spend.ts | `readNonNegativeNumber` 的 `.trim()` | 真漏測(且會靜默關掉預算上限) | 補測試 ✅ 殺掉 |
| spend.ts | `typeof event.ts !== 'string'` | 真漏測 | 補測試 ✅ 殺掉 |
| spend.ts | `line.trim().length === 0` ×2 | 真等價(下面的 JSON.parse 會丟錯被 catch,結果完全相同) | 補了壞行測試拿到覆蓋;變異本身等價,程式碼註明理由 |
| spend.ts | `catch { continue }` | 真等價(continue 是迴圈本體最後一句) | 註明理由 |
| gateway.ts | 錯誤訊息 / status 的 12 處 | 真漏測(斷言太鬆) | 補測試 ✅ 殺掉 |
| gateway.ts | `expires_in` / `expires_at` / `1e12` 分界 8 處 | 邊界 | 補測試 ✅ 殺掉 |
| gateway.ts | `now < expiresAt`、`body.model.length > 0` | 邊界 | 補測試 ✅ 殺掉 |
| gateway.ts | probe 的狀態碼 / body 形狀 / 逾時 / 計時器 | 真漏測 | 補測試 ✅ 殺掉 |
| gateway.ts | 請求形狀(method / headers)5 處 | 真漏測 | 補測試 ✅ 殺掉 |
| gateway.ts | `readJson` 的 catch、`AbortSignal` 傳遞 | 真漏測 | 補測試 ✅ 殺掉(HTML 回應、signal 傳遞) |
| gateway.ts | `models === null` | 真等價(外層 catch 會吞掉 `Object.keys(null)` 的 TypeError,回同一個值) | 註明理由 |
| gateway.ts | `catch { return undefined }` | 真等價(掉到函式結尾本來就回 undefined) | 註明理由 |

補充:兩個 `catch` 區塊的等價變異(`spend.ts:167`、`gateway.ts:154`)寫了 `// Stryker disable next-line all` 但 Stryker **沒有吃**——它對 `} catch {` 這種 BlockStatement 變異的行號定位跟指令的 next-line 對不起來(換過三種擺法都一樣)。這是工具的限制,不是品質缺口:兩個都確認過是真等價,理由寫在程式碼註解裡,而且 98.41% / 98.88% 都遠高於 80% 門檻。

## 要協調者處理的

1. **發現 5(離線錯誤碼 vs 契約 §7)** — 開 debug session。`deepen` / `grade.apply` / `reteach.short` 那半是照契約修(保留原 `NoModelError`);`grade.fill.llm` 那半是新決策,要走 `/decide`。
2. **發現 6(`router-gateway.ts:170` 死程式)** — 同一個 debug session 順手刪。
3. **發現 7(probe 逾時管不到換 token)** — 換到網域之前修。

phase-4 本身的 17 個場景、1136 個單元測試、三個檔案的變異分數都達標,可以標 done。
