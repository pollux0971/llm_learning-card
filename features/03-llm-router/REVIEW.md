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
npm run mutate -- --mutate "packages/core/src/llm/routing.ts,!packages/core/src/llm/routing.test.ts"
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


---

# 收尾輪的審核(第二次審核)· 2026-09-04

審核 agent / worktree `phase-4-debug` / branch `pollux0971/phase-4-debug` / 起點 HEAD `f7eef94`。

上一次審核留下三個「要協調者處理的」,開發 agent 用六個 commit 做完:

| commit | 內容 |
|---|---|
| `e9ea5b6` | 測試先行:鎖住契約 §7 的離線錯誤碼 `NO_MODEL`(預期紅燈 18 條) |
| `9e98257` | 實作:離線時丟 `NoModelError`,閘道細節降級成 `cause` |
| `46724c9` | 測試先行:證明 `router-gateway.ts` 的備援重試分支到不了(29 條綠燈鎖前提) |
| `e88e932` | 實作:刪掉那一行 + 修正講反的註解 |
| `4ec2581` | 測試先行:鎖住 `probe()` 的逾時要涵蓋換 token(預期紅燈 3 條) |
| `f7eef94` | 實作:`token(signal?)`,`probe()` 兩個 fetch 共用同一個 controller |

**本輪結論:PASS。** 細節如下。

## 0. 這一輪最重要的部分:開發 agent 主動點出的三個缺口

開發 agent 照 P-29 自我檢查,誠實列出三個「答不出哪個測試會紅」的洞。**這是好事**——
它沒有假裝測試已經夠了。前兩個我補上,第三個是範圍外,完整描述在 §1.3。

### 1.1 洞 1:`NoModelError` 不給 detail 時的訊息文字沒有測試鎖 —— 已補

`9e98257` 給建構子加了第二個 optional 參數之後:

```ts
`task "${task}" has no model available: offline and no local model` +
  (options.detail === undefined ? '' : ` (${options.detail})`)
```

「沒給 detail 時訊息一字不變」沒有任何測試守著:

- `routing.test.ts:52` 只有 `toThrow(/deepen/)` —— 整句話只要還帶得出 task 名字就綠。
- `router-gateway.test.ts` 只測**有** detail 的那一半。

**實測**:把三元條件寫反(沒給 detail 時接一句 ` (undefined)`),全套一條都不會紅。
使用者會看到 `... offline and no local model (undefined)`,而 CI 全綠。訊息是使用者
唯一看得到的東西。

**補法**:新增 `packages/core/src/llm/errors.test.ts`(commit `e28523b`),鎖**完整字串**
——子字串比對擋不住「多接了一段」。順帶鎖住 `cause` 的身分(`toBe` 同一個物件)、
「沒給 cause 時連 own property 都不存在」、以及 `CloudRequiredError` 的訊息。

### 1.2 洞 2:「一個計時器管兩段」對「各開一個」現有測試分辨不出來 —— 已補

`f7eef94` 的核心修法就是讓逾時涵蓋換 token 那一步,但 `4ec2581` 的三條測試**分辨不出來**
實作是哪一種:

| 既有測試 | 為什麼分辨不出來 |
|---|---|
| 換 token 永不回應(`tokenHangs`)→ 回不可用 | 兩段各開一個 5 秒計時器的話,那一段自己的計時器一樣會 abort 它 → 一樣綠 |
| 換 token 請求要帶 `AbortSignal` | 兩種做法都會**帶** signal,差別只在是不是同一個 |
| 逾時路徑上不留計時器 | 兩種做法最後都清乾淨 |

差別只在**額度是共用還是各算**,所以要一個「每段都在額度內、加起來超過」的情境。

**補法**(commit `e28523b`,`adapters/gateway.test.ts` 新增一個 describe,假 fetch 多一個
`tokenDelayMs`,照既有 `modelsDelayMs` 的形狀):

1. **主測**:換 token 4 秒 + `/gateway/models` 2 秒,`probeTimeoutMs` 5 秒 → 回**不可用**。
   共用一份額度 → 5 秒時第二個請求還在飛 → abort。各一份 5 秒 → 4<5、2<5 → 會回**可用**。
   並斷言兩段都真的打出去過(`tokenCalls === 1 && modelCalls === 1`),不是在第一段就掛掉。
2. **對照組**:同樣 4+2 秒,額度放寬到 10 秒 → 回**可用**。證明分辨的是額度,不是延遲本身。
3. **機制**:probe 的兩個 fetch 拿到的是**同一個** `AbortSignal` 物件(`toBe`)。

全部用假計時器,不真的等。

**破壞驗證**:把 `probe()` 改成兩段各開一個 controller、各一份 `probeTimeoutMs`
(忠實的「另一種實作」,不是只把 signal 拔掉)——

- 新的三條:🔴 主測 + 機制兩條紅。
- 舊的三條:🟢 **全綠**,一條都沒動。

確認了缺口真的存在、也真的補起來了。

### 1.3 洞 3(範圍外,已轉技術顧問):`chat()` 那條路的換 token 同樣沒有逾時涵蓋

**哪個函式**:`packages/core/src/llm/adapters/gateway.ts` 的
`GatewayClient.postChat()`(檔案第 297–314 行),它呼叫 `await this.token()` **不帶 signal**。

**什麼情境會卡住**:

1. `GatewayLlmRouter.callGateway()`(`router-gateway.ts:221`)開一個 `AbortController` 加
   `setTimeout(timeoutMs)`,把 `controller.signal` 放進 `client.chat({ ..., signal })`。
2. `chat()` → `postChat()` 只把 `args.signal` 傳給 `/gateway/chat` 那個 fetch
   (`...(args.signal ? { signal: args.signal } : {})`),**沒有**傳給前面的 `await this.token()`。
3. 所以 token 快取過期(或第一次呼叫)而閘道的 `/auth/token/exchange` 掛住時——封包被
   防火牆黑洞吃掉,連 `ECONNREFUSED` 都不會回來——router 傳進來的 `timeoutMs`
   **完全管不到那一步**,`call()` 會掛到 OS 預設的 TCP timeout(可能兩分鐘)。
4. **更糟的一格是 401 重試路徑**:`chat()` 在 401 之後 `invalidateToken()` 再 `postChat()`
   一次,所以第二次**一定**會打 `/auth/token/exchange`,同樣不帶 signal。也就是
   「token 剛好過期」這個**最常見**的情境,正好落在沒有逾時保護的那條路上。
5. 結果是同一個 `token()` 函式在兩個呼叫端的逾時保證**不一致**:`probe()` 帶 signal
   (`f7eef94` 修好了),`postChat()` 不帶。

**現況影響**:`GATEWAY_BASE_URL` 還是 `localhost:8787`,沒人聽就是立刻 `ECONNREFUSED`,
所以看不出來。ADR-039 Consequences 寫的「之後換成網域」以後才會踩到——跟洞 2 是
同一天會踩到的東西。

**為什麼我沒有補測試**(刻意的):補了就要選一邊,而兩邊都不是我能決定的。

- 鎖現況(chat 的 token 不帶 signal)= 把偏差固化成規格,正是上一輪對
  `GATEWAY_FAILED` **正確避開**的錯誤。
- 鎖修法(帶 signal)= 替技術顧問做了決定。而且這是個真的取捨:`probe()` 的逾時是
  「可達性檢查」的 5 秒短逾時,`chat()` 的逾時是 router 傳進來的**模型呼叫**逾時
  (`opts.timeoutMs ?? defaultTimeoutMs`,雲端那邊是 60 秒),涵蓋範圍該不該包含換
  token 是要想過的。

**實測留給後續的資訊**:把 `postChat()` 的 `this.token()` 改成 `this.token(args.signal)`,
`npx vitest run packages/core/src/llm` **全綠 334 條**。**兩個方向都沒有測試守著**,
所以決定權完整留給技術顧問,做哪一邊都不會被既有測試擋。

## 2. 十個設計判斷的逐一破壞驗證(P-29 / P-28)

我手上沒有開發 agent 那份【驗】/【推】的原始清單,所以從三個實作 commit 的 diff
**自己重建**了十個設計判斷,逐一手動破壞、跑測試、還原(`git status` 每輪確認乾淨)。

跑的指令一律是 **`npx vitest run packages/core/src/llm`**(基準 334 條綠)。
下表的「紅在哪」全部來自 `git ls-files` 確認過的 committed 測試檔。

| # | 設計判斷 | 破壞方式 | 結果 |
|---|---|---|---|
| J1 | 攔截點放在 `callGateway()` **一處**,結構性涵蓋三條進入閘道的路 | 加 `&& cause !== undefined`,只在備援路徑轉 | 🔴 **7 條** |
| J2 | 403 的 `GatewayModelRejectedError` **不**轉成 `NoModelError` | `instanceof GatewayCallError` → `instanceof Error` | 🔴 **1 條** |
| J3 | `cause` 掛的是**這一次**真的丟出來的那個物件 | 換成 `new GatewayCallError('replaced placeholder')` | 🔴 **4 條** |
| J4 | `detail` 說得清「本機閘道不可達」 | 拿掉 `local gateway ` 五個字 | 🟢 **原本全綠 → 見 §3** |
| J5 | 沒給 `detail` 時訊息一字不變 | 三元條件寫反,接一句 ` (undefined)` | 🔴 **2 條**(§1.1 補的) |
| J6 | `GATEWAY_FAILED` 完全不外洩 router 公開介面 | 整段不轉,原樣 `throw err` | 🔴 **23 條** |
| J7a | 刪掉的 `if (retry.target !== 'gateway') throw err;` 真的到不了 | 把那一行**加回來** | 🟢 **全綠 334 —— 預期綠,這就是「到不了」的證明** |
| J7b | 備援重試用的是 `cloud: 'failed'`(J7a 的前提) | 改成 `cloud: 'ok'` | 🔴 **7 條** |
| J8 | `ingest.*` 的 `CLOUD_REQUIRED` 來自 `decideFallback` **丟出來**的錯誤(修正後的註解) | `fallback.ts:116` 的 `throw new CloudRequiredError(task)` 改成 `return { target: 'cloud', ... }` | 🔴 **16 條** |
| J9 | `probe()` 的逾時是**一份共用額度**,涵蓋換 token 那一段 | 兩段各開一個 controller、各一份 `probeTimeoutMs` | 🔴 **2 條**(§1.2 補的) |
| J10 | `token(signal?)` 是 optional,`chat()` 那條路行為一字不變 | `postChat()` 改成 `this.token(args.signal)` | 🟢 **全綠 334 —— 這就是缺口 3(§1.3)** |

### P-28:每一條紅來自哪個 committed 檔案的哪個測試

指令全部是 `npx vitest run packages/core/src/llm`。

**J1**(7 條,全在 `packages/core/src/llm/router-gateway.test.ts`)
- `完全離線(雲端不通 + 閘道也不通) > grade.fill.llm 丟契約 §7 的 NO_MODEL,不是閘道的錯誤碼`
- `… > grade.fill.llm 把閘道的原始錯誤留在 cause 裡,診斷資訊不丟掉`
- `… > grade.fill.llm 的訊息說得清「本機閘道不可達」,不是只有一句沒有模型`
- `… > grade.fill.llm 的 detail 字面就是「local gateway unreachable」`
- `… > 離線時的完整訊息一字不差(括號內外都是使用者看得到的東西)`
- `GATEWAY_FAILED 不從 router 的公開介面外洩 > grade.fill.llm:完全離線時丟出來的不是 GATEWAY_FAILED`
- `… > grade.fill.llm:在線但閘道不通,一樣不外洩`

只有 `grade.fill.llm` 紅,正好證明「直接走閘道」那條路是被**同一段程式**保護的:
攔在 `call()` 的三條分支各一次的話,這一格就會漏。

**J2**(1 條,`router-gateway.test.ts`)
- `GatewayLlmRouter.call — 閘道 403 不觸發備援 > 填了雲端模型名時錯誤往外丟,不改走雲端`

**J3**(4 條,`router-gateway.test.ts`)
- `完全離線… > {deepen | grade.apply | reteach.short | grade.fill.llm} 把閘道的原始錯誤留在 cause 裡,診斷資訊不丟掉`

回答「有測試斷言 `cause` 的身分嗎,還是只斷言有 cause?」——**有身分**:
`toBeInstanceOf(GatewayCallError)` + `codeOf(cause) === 'GATEWAY_FAILED'` +
`messageOf(cause)` 要含 `ECONNREFUSED`。換成隨手 new 一個空殼就紅(實測)。
`errors.test.ts` 另外用 `toBe` 鎖了「掛的是同一個物件」。

**J5**(2 條,`packages/core/src/llm/errors.test.ts`)
- `NoModelError — 訊息文字 > 不給 detail 時訊息一字不多(不能接出 "(undefined)" 這種尾巴)`
- `NoModelError — cause > detail 與 cause 可以只給其中一個`

**J6**(23 條,`router-gateway.test.ts`;前 12 條)
- `完全離線… > {4 個 task} 丟契約 §7 的 NO_MODEL,不是閘道的錯誤碼`
- `完全離線… > {4 個 task} 把閘道的原始錯誤留在 cause 裡,診斷資訊不丟掉`
- `完全離線… > {4 個 task} 的訊息說得清「本機閘道不可達」,不是只有一句沒有模型`
- 其餘 11 條含 `GATEWAY_FAILED 不從 router 的公開介面外洩` 整個 describe

回答「有沒有一個測試掃 router 公開介面丟出來的錯誤型別?」——**有,而且已經在
committed 的測試裡**:`router-gateway.test.ts` 的
`describe('GATEWAY_FAILED 不從 router 的公開介面外洩')`,7 個 task 全掃一遍
(`it.each(ALL_TASKS)`),加上「在線但閘道不通」與「雲端失敗且閘道也不通」兩格。
這一條契約層的保證不用補。

**J7b**(7 條,`router-gateway.test.ts`)
- `雲端失敗時的備援 > grade.apply 退到閘道並標 provisional`
- `雲端失敗時的備援 > 備援那一筆 log 記下 fallback 與原因`
- `雲端失敗時的備援 > 逾時也會備援`
- `雲端失敗時的備援 > ingest.cards 不備援,丟 CLOUD_REQUIRED,而且閘道一次都沒被打`
- `雲端整個連不上(probeOnline 回 false) > deepen 在 NoModelError 之後改走閘道並標 provisional`
- `… > grade.apply 與 reteach.short 也一樣`
- `… > 備援那一筆 log 記下原因是 cloud_failed,而不是預算`

**J8**(16 條,`packages/core/src/llm/fallback.test.ts` 5 條 + `router-gateway.test.ts` 11 條)
- `fallback.test.ts > decideFallback — cloud-only(ingest.*) > {ingest.cards | ingest.questions | ingest.deps}:雲端失敗就丟 CLOUD_REQUIRED,不備援`
- `fallback.test.ts > … > CLOUD_REQUIRED 的錯誤點名是哪個 task`
- `fallback.test.ts > decideFallback 是純函式 > 改備援表就改行為,不用改 decideFallback 本身`
- `router-gateway.test.ts > 雲端失敗時的備援 > ingest.cards 不備援,丟 CLOUD_REQUIRED,而且閘道一次都沒被打`
- `router-gateway.test.ts > 備援重試:cloud "failed" 永遠不會回到 cloud(…) > …` 共 10 條

**J9**(2 條,`packages/core/src/llm/adapters/gateway.test.ts`)
- `GatewayClient.probe — 逾時是整段流程共用一份額度,不是每段各一份 > 換 token 4 秒 + models 2 秒(各自都沒超過 5 秒,加起來超過)→ 回不可用`
- `… > probe 的兩個請求帶的是**同一個** AbortSignal(共用額度的機制前提)`

### J7 / 刪掉的死程式:確認刪對了行,而且註解真的正確

**刪對了行**(`git show e88e932`):刪掉的就是
`if (retry.target !== 'gateway') throw err;` 這一行加上它的 TODO 註解區塊,
`decideFallback` 的呼叫與 `return this.callGateway(...)` 一行沒動。

**J7a 的綠是預期的**:把那一行加回來,334 條全綠——沒有任何測試分辨得出它在不在,
這正是「到不了」的定義。而 J7b(把 `cloud: 'failed'` 改成 `'ok'`)7 條紅,證明
「到不了」的**前提**是被鎖住的:哪天有人讓 `decideFallback` 在 `'failed'` 時回 cloud,
那些窮舉測試會先紅。

**修正後的註解真的正確**:原註解說「再回 cloud 就代表沒有備援,把**原本的錯誤**
往外丟(`ingest.*` 得到 `CloudRequiredError`)」——這句話錯兩次:(a) 靠的不是那個
`if`,(b) 往外丟的**不是**原本那個雲端錯誤(那會是 503 之類),而是
`decideFallback` **自己丟**的 `CloudRequiredError`(它蓋掉了原本的 `err`)。

修正後的版本經查證屬實:`packages/core/src/llm/fallback.ts:116` 就是
`if (cloud === 'failed') throw new CloudRequiredError(task);`。而且 J8 的破壞
(把那個 throw 改成 return)讓 16 條紅,其中包含
`router-gateway.test.ts > … > ingest.cards 不備援,丟 CLOUD_REQUIRED,而且閘道一次都沒被打`
——**註解宣稱的機制,就是測試守著的機制**。註解正確。

## 3. 破壞驗證抓到的新洞:`detail` 的字面沒鎖(已補)

J4 是這一輪唯一一個「破壞了但沒有任何測試紅」的**真缺口**(J7a 的綠是預期的,
J10 的綠是範圍外的缺口 3)。

把 `callGateway()` 的 detail 從 `local gateway unreachable: ${err.message}` 改成
`unreachable: ${err.message}`(整個「本機閘道」的說法都拿掉),334 條**全綠**。

原因:守著這件事的是 `expect(messageOf(err)).toMatch(/gateway/i)`,而 `cause` 那個
`GatewayCallError` 的訊息本來就以 `gateway call failed: ` 開頭——`/gateway/i` 被
**內層**那句話餵飽了,router 這一層自己加的那句話等於沒鎖。跟洞 1 是同一類問題
(使用者可見文字沒鎖字面),所以照同樣的方式補。

**補法**(commit `8e11178`,`router-gateway.test.ts`):
- 四個 task 各一條:訊息含字面 `(local gateway unreachable: `
- `grade.fill.llm` 一條全字串比對(它直接走閘道、不經過雲端失敗,內層訊息最短,
  最不會因為別處改動而假紅)

**重跑同一個破壞:🔴 5 條紅**(四個 task 的 detail 字面 + 全字串那條)。

## 4. 完整驗收

| 檢查 | 結果 |
|---|---|
| `npm ci` | ✅ exit 0 |
| `npm run boundaries` | ✅ exit 0 |
| `npm run typecheck` | ✅ exit 0 |
| `npx vitest run`(起點 `f7eef94`) | ✅ **71 檔 1266 條全綠**(與開發 agent 回報一致) |
| `npx vitest run`(本輪補完) | ✅ **72 檔 1297 條全綠** |
| `NODE_OPTIONS=--import=tsx npx cucumber-js --tags "not @manual"` | ✅ **484 場景 323 passed / 0 failed**(上一輪 469 場景 308 passed)→ **不退化** |
| `npm run accept:dry` | ✅ exit 0,**0 ambiguous** |
| `npm run standalone` | ✅ **全部通過**(7 個跑、3 個 interactive 跳過) |

cucumber 的 161 個 `undefined` 場景是還沒開工的未來 phase/feature,不是本次造成的
(上一輪是 164 個);場景總數從 469 漲到 484 是因為中間合併了
`28adc83`(learning-repo-snapshot / ADR-042)。**failed 一直是 0。**

## 5. Stryker 變異測試

| 檔案 | 門檻 | 上一輪 | 本輪 | 判定 |
|---|---|---|---|---|
| `fallback.ts` | **嚴格 95%**(P-26) | 100.00% | **100.00%**(21 killed / 0 survived) | ✅ 無退步 |
| `spend.ts` | **嚴格 95%**(P-26) | 98.41% | **98.41%**(62 killed / 1 survived) | ✅ 無退步 |
| `adapters/gateway.ts` | 標準 80% | 98.88% | **98.89%**(89 killed / 1 survived) | ✅ 微升(本輪補的測試多殺一個) |
| `router-gateway.ts` | 標準 80% | **從未量過** | **100.00%**(52 killed / 0 survived) | ✅ 見下 |

**`router-gateway.ts` 是這一輪最大的發現。** 它這次是**第一次**被量到——上一輪的報告
寫得很清楚:「`router-gateway.ts` 不在嚴格門檻名單也不在這次要跑的三個檔案裡,所以
Stryker 沒有報它」。第一次量出來是 **46.15%**,遠低於標準 80%:104 個變異裡
24 killed / **23 survived** / **5 no-coverage**。

這不是退步(從來沒有基準),但是一個真的品質缺口,而且缺口不是零散的,是**三整塊
從來沒有測試碰過的接線**:

1. **`callGateway()` 的逾時接線**(第 229–254 行)。既有測試**一條都沒給過**
   `timeoutMs`,所以整段是死的:`opts.timeoutMs ?? defaultTimeoutMs` 被換成 `&&`、
   `timeoutMs === undefined ? …` 被換成 `true` / `false` / `!==`、signal 有沒有真的
   傳進 `client.chat()`、`finally` 的 `clearTimeout` 被整個拿掉——全都沒人發現。
   **這跟 `f7eef94` 修的 probe 逾時是同一類問題**(router 設的逾時有沒有真的接到閘道
   呼叫),只是這一半從來沒被量過,而 `callGateway()` 是**唯一**會真的送出閘道請求
   的地方,閘道又在另一台機器上。
2. **log 事件的組裝**(第 257–275 行)。既有測試只斷言 `fallback` 與 `fallback_reason`
   兩個欄位。`type: 'llm_call'` 這個字串、`tokens_in` / `tokens_out` 的 `!= null` 判斷
   (**`spend.ts` 是照這兩個欄位算錢的**)、`if (cause !== undefined)` 被換成
   `if (true)`,全都存活。
3. **`probeLocal()` 的 catch 分支**與 **`createFileLogAppender()`**。零覆蓋。

**補了 15 條**(commit `95ab592`),重跑 **46.15% → 100.00%**。

### 存活變異逐條處理(四分類)

跑完四個檔案共 **2 個**存活變異,兩個都是**真等價**,而且兩個都是上一輪就查證過、
程式碼裡已經寫了理由的同一組。

| 檔案:行 | 變異 | 分類 | 處理 |
|---|---|---|---|
| `spend.ts:167` | `} catch { continue; }` → `} catch {}` | **真等價** —— `continue` 是 `for` 迴圈本體的最後一句,拿掉之後控制流一模一樣 | 不補測試。程式碼已有 `// Stryker disable next-line all` 與理由 |
| `adapters/gateway.ts:157` | `} catch { return undefined; }` → `} catch {}` | **真等價** —— 函式掉到結尾本來就回 `undefined`,對呼叫端完全一樣 | 不補測試。程式碼已有 `// Stryker disable next-line all` 與理由 |

四分類的另外三類本輪**都是零**:

- **真漏測**:0(`router-gateway.ts` 原本那 23 個 + 5 個零覆蓋全部補掉了,見上)
- **邊界**:0(`isCloudFailure` 的 `>= 500` 邊界本輪補上,已殺)
- **不值得測**:0

補充(沿用上一輪的結論,本輪重新確認):這兩個 `catch` 區塊的 `// Stryker disable
next-line all` 指令 Stryker **沒有吃**——它對 `} catch {` 這種 BlockStatement 變異的
行號定位跟指令的 next-line 對不起來。這是工具的限制,不是品質缺口:兩個都確認過是
真等價,理由寫在程式碼註解裡,而且 98.41% / 98.89% 都遠高於門檻。

## 6. 結論:PASS

**六個 commit 的三件實作都正確,而且測試真的守得住。**

- 契約 §7 的 `NO_MODEL` 對齊做對了,而且 `GATEWAY_FAILED` 不外洩是**結構性**的
  (攔在 `callGateway()` 唯一出口,不是三處各自記得),有 7 個 task 全掃的測試守著。
- 403 不轉是對的(設定錯誤不是「沒有模型」),而且有測試鎖住(J2 破壞 → 紅)。
- 刪掉的死程式刪對了行,前提被 29 條窮舉測試鎖住,修正後的註解**經查證屬實**
  ——註解宣稱的機制就是 J8 破壞會弄紅的那個機制。
- `probe()` 的逾時修法正確,而且現在有測試分辨得出「共用一份額度」與「各一份」。

**但是有一個這一輪才第一次量到的品質缺口,已經補掉**:`router-gateway.ts` 從來沒被
Stryker 量過,第一次量是 **46.15%**(23 存活 + 5 零覆蓋)。缺口集中在
`callGateway()` 的**逾時接線**——既有測試一條都沒給過 `timeoutMs`,所以「router 設的
逾時有沒有真的接到閘道呼叫」整段是死的。這跟開發 agent 這一輪修的 probe 逾時
(`f7eef94`)是**同一類問題的另一半**,只是這一半沒人量過所以沒人發現。補 15 條後
**100.00%**。

這件事本身值得記一筆:**沒有被 Stryker 涵蓋的檔案,測試看起來再多也可能是空的**——
`router-gateway.test.ts` 原本就有 30 幾條測試、全綠,但整個逾時接線沒有任何一條碰到。
建議之後 `03-llm-router` 的 Stryker 標的清單把 `router-gateway.ts` 固定列進去。

**本輪補的三處測試**(都已 commit,未 push):

| commit | 檔案 | 補什麼 | 條數 |
|---|---|---|---|
| `e28523b` | `packages/core/src/llm/errors.test.ts`(新) | 洞 1:`NoModelError` / `CloudRequiredError` 的完整訊息字串、`cause` 身分 | 8 |
| `e28523b` | `packages/core/src/llm/adapters/gateway.test.ts` | 洞 2:分辨「一份共用額度」與「各一份」+ 假 fetch 的 `tokenDelayMs` | 3 |
| `8e11178` | `packages/core/src/llm/router-gateway.test.ts` | J4:`detail` 的字面 + 離線完整訊息 | 5 |
| `95ab592` | `packages/core/src/llm/router-gateway.test.ts` | Stryker 46.15% → 100%:逾時接線、log 組裝、`probeLocal` catch、檔案 log | 15 |

全套從 **1266 條**(起點 `f7eef94`)變成 **1297 條**,71 檔 → 72 檔。

**留給後續的一件事**:缺口 3(`chat()` 那條路的換 token 沒有逾時涵蓋,§1.3)。
已確認**兩個方向都沒有測試守著**,決定權完整留給技術顧問。要在
`GATEWAY_BASE_URL` 換成網域之前處理——跟洞 2 是同一天會踩到的東西。

**環境備註**:跑 Stryker 時另一個 worktree(`prompt-quality-phase-2`)也在跑 Stryker,
機器 load average 一度到 26 / 8 核、可用記憶體歸零,我的 Stryker 被 OOM 殺掉兩次。
最後改成等對方跑完再開始。不是程式問題,但同機器多個 worktree 同時跑變異測試會互相殺。

---

# REVIEW — 五支 0 值守門(分支 `five-zero-guards`,審核輪)

審核對象:`dedd04a`(llm-spend 三態)/ `7622381`(lint --dir)/ `9be29da`(check-questions)/
`3b03714`(due)/ `0159186`(weekly),HEAD = `0159186`,base = `2c8aacf`。
五支跨五個 feature(03 / 09 / 01 / 04 / 08)。**完整報告放這裡**(llm-spend 的那個
真洞是這一輪唯一的 FAIL 項,而 llm-spend 屬 03),01 / 04 / 08 / 09 的 REVIEW.md 各留一段
摘要指回這裡,不重複貼。

## 結論:**FAIL**(一個真洞,其餘四支 PASS)

- **真洞**:`llm-spend.ts` 的「整份 log 不是 JSONL」沒被擋住。整份是 `"hello"` / `42` /
  `[]` → **exit 0** 並印「今日 OpenAI 花費 $0.0000 … 今日條目 0 筆」——一份被寫壞的 log
  變成「有 log 但沒花」,煞車不響。`null` → exit 2 但是靠 `Cannot read properties of null`
  的例外訊息,沒有行號 / 前 80 字 / 怎麼修。HTML 那種(JSON.parse 直接失敗)是對的。
  已寫 6 條新測試鎖住(§4;5 條紅,HTML 那條現在就綠),留給開發 agent 修;五個測試檔其餘 115 條全綠(120 條裡紅的只有這 5 條)。
- 必辦 1 / 2 / 3 都做完,反向驗證全部紅(§1–§3)。
- 其他四支(lint / check-questions / due / weekly)行為驗過,PASS。
- 四個 Stryker 分數見 §7。

## 1. 必辦 1:weekly 那條「數學上不可能同時成立」的測試

照協調者裁定換 fixture、不動斷言語意:

```
- ['欄位型別不對(learned 是字串)', '{"week":"2026-W37","target":7,"learned":"lots","passed_d1":0,"counted":[]}']
+ ['欄位型別不對(learned 是字串)', '{"week":"2026-W37","target":7,"learned":"lots","counted":[]}']
```

**代價的處理**:換掉之後參數化那組不再涵蓋「`learned` 型別錯 + 原檔本身就有 `passed_d1`」。
那個組合反而是最像「正常」的壞檔,所以**另外補了一條**,而且不用子字串當代理指標——
直接看被代理的那件事:捏造出來的 Weekly 走 **stdout**(成功路徑印 JSON 的地方),
回聲走 **stderr**。`runWeekly()` 改成同時回 `stdout` / `stderr`,新測試斷言
`stdout === ''`、`stderr` 含 `Weekly` 與 `raw.slice(0, 80)`、不含 `"target_met"`、不噴 stack。
開發 agent 的 commit 說明本來就寫了「錯誤訊息走 stderr,失敗時 stdout 要乾淨」,
這條把那個設計判斷鎖住。

## 2. 必辦 2:「三種 0 兩兩不同」從比輸出改成比訊息

開發 agent 點出的病確認屬實,而且**不只三支,是四條**:

| 檔 | 測試 | 原本比什麼 |
|---|---|---|
| `scripts/due.test.ts` | 三種 0 的輸出兩兩不同 | 三個含不同暫存路徑的 output |
| `packages/core/src/schema/cli-check-questions.test.ts` | 三種 0 的輸出兩兩不同 | 同上 |
| `scripts/llm-spend.test.ts` | log 不存在與 log 空檔的輸出不一樣 | 兩個含不同暫存路徑的 output |
| `scripts/weekly.test.ts` | 「不是 Weekly」與「讀不到檔」的訊息不一樣 | 同上 |

(llm-spend 純函式層的那條「三種輸出兩兩不同」用的是**同一個**假路徑 `/tmp/x/log.jsonl`,
差在數字 7 / 0 與「算不出來」,不在此列。)

做法:每個測試檔加一個 `withoutPath(output, ...paths)`,把該次跑用的路徑與它的目錄換成
`<PATH>` / `<DIR>`,**剩下的才是訊息**;再斷言 (a) 每一句 trim 後非空、(b) `Set.size` 等於
案例數。每檔一份 3 行的小函式,沒抽共用——`packages/core` 的測試不能 import `scripts/`
(Wave 0 邊界),抽了反而要開例外。

**反向驗證(驗收條件):把訊息清空 / 改成同一句 → 測試必須紅。** 五個都紅:

```
$ sed -i 's|  for (const line of lines) console.error(line);|  void lines;|' scripts/due.ts
$ npx vitest run scripts/due.test.ts -t "三種 0 的訊息兩兩不同"
     × 三種 0 的訊息兩兩不同(路徑正規化之後比,不是比輸出)
AssertionError: 有一種 0 一句話都沒說: expected '' not to be ''
      Tests  1 failed | 11 skipped (12)

$ sed -i 's|  for (const line of lines) console.error(line);|  void lines; console.error("✗ due: 算不出來");|' scripts/due.ts
$ npx vitest run scripts/due.test.ts -t "三種 0 的訊息兩兩不同"
AssertionError: 三種 0 有兩種長一樣:
: expected 1 to be 3
      Tests  1 failed | 11 skipped (12)

$ sed -i '140,175s/console\.error(/void (/' packages/core/src/schema/cli.ts
$ npx vitest run packages/core/src/schema/cli-check-questions.test.ts -t "三種 0 的訊息兩兩不同"
AssertionError: 有一種 0 一句話都沒說: expected '' not to be ''
      Tests  1 failed | 7 skipped (8)

$ # formatSpendReport 開頭插一行 return '';
$ npx vitest run scripts/llm-spend.test.ts -t "log 不存在與 log 空檔的訊息不一樣"
AssertionError: expected '' not to be ''
      Tests  1 failed | 36 skipped (37)

$ sed -i '39,80s/console\.error(/void (/' scripts/weekly.ts
$ npx vitest run scripts/weekly.test.ts -t "「不是 Weekly」與「讀不到檔」的訊息不一樣"
AssertionError: expected '\nnode:internal/modules/run_main:122\…' not to be '\nnode:internal/modules/run_main:122\…'
      Tests  1 failed | 26 skipped (27)
```

每次都 `git checkout --` 還原,`git status` 確認只剩五個測試檔有改動。

## 3. 必辦 3:lint 「路徑是檔案」那條守門沒被任何測試守著

確認屬實。刪掉 `scripts/lint.ts` L45–49 之後,`lint(file)` 走到 `mkdirSync(<file>/state)`
丟 `ENOTDIR`,node exit 1、也不印 `0 problems`,原本那條測試照樣綠。

補的測試(`scripts/lint-missing-dir.test.ts`「路徑是檔案時,是守門的那句人話,不是掉進
mkdirSync 的 ENOTDIR stack」)斷言:exit 1、含 `不是目錄`、含路徑、含 `init`、
**不 match stack trace、不含 `ENOTDIR`**。反向驗證:

```
$ sed -i '45,49d' scripts/lint.ts
$ npx vitest run scripts/lint-missing-dir.test.ts -t "路徑存在但是一個檔案|路徑是檔案時"
     × 路徑是檔案時,是守門的那句人話,不是掉進 mkdirSync 的 ENOTDIR stack
AssertionError: expected 'node:fs:1364\n  const result = bindin…' to contain '不是目錄'
      Tests  1 failed | 1 passed | 6 skipped (8)
```

那個 `1 passed` 就是原本那條——沒守門它還是綠,證實開發 agent 的說法。
「目錄不存在」那條守門本來就被守著(拿掉 `existsSync` 那段會掉進 `statSync` 的 ENOENT
stack,既有測試要求 `目錄不存在` + `init` 會紅),沒有另外補。

## 4. 追加驗收:整份 log 不是 JSONL —— **真洞**

協調者要求「不能假設極端情形自動被涵蓋」。實跑(`LLM_DAILY_CAP_USD=1` 等三個變數都設):

```
$ printf '"hello"' > hello.jsonl
$ npx tsx scripts/llm-spend.ts --day 2026-09-04 --log hello.jsonl
今日 OpenAI 花費 $0.0000(0 次呼叫,log: …/hello.jsonl,今日條目 0 筆),上限 $1.0000
>>> exit=0                                            ← 洞

$ printf '42\n' > num.jsonl       → 同上,exit=0          ← 洞
$ printf '[]\n' > arr.jsonl       → 同上,exit=0          ← 洞
$ printf 'null\n' > null.jsonl
算不出來:Cannot read properties of null (reading 'type')
>>> exit=2                        ← 碼對,但沒有行號 / 前 80 字 / 怎麼修,是例外不是守門

$ printf '<html><body>login</body></html>\n' > page.html
算不出來:…/page.html 第 1 行不是合法的 JSON,所以今天的花費算不出來:<html><body>login</body></html>(修好或移除該行後重跑;這是花錢的煞車,不會自動跳過壞行)
>>> exit=2                        ← 對
```

原因:`buildSpendReport` 只擋 `JSON.parse` 丟例外的行。`"hello"` / `42` / `[]` / `null`
每一行都是合法 JSON,但沒有一個是契約 §10 的 log 事件(物件 + `ts`);`computeDailySpend`
拿到字串就當成「不是今天、不是 llm_call」濾掉,結果是「今日條目 0 筆、$0、exit 0」。
「其中一行壞」與「每一行都壞」確實走了不同分支——前者靠 parse 失敗,後者 parse 全過。

已鎖住的紅測試(`scripts/llm-spend.test.ts`):
- 純函式層 5 條參數化:`"hello"` / `42` / `[]` / `null` / HTML → `unknown`,原因含
  `第 1 行`、該行前 80 字、`不會自動跳過`(HTML 這條現在就綠,其餘 4 條紅)。
- CLI 層 1 條:整份 `"hello"` → exit 2、含 `算不出來`、不印預算句(紅)。

**留給開發 agent**:parse 成功之後還要驗「是物件、不是陣列、`ts` 是字串」,不是就走
`badLineReason()` 同一句(行號 / 前 80 字 / 怎麼修)。不改 `packages/core` 的
`readDailySpend()`(那支是讀事件,P-22 的方向仍然對)。

## 5. 三態實跑與 exit 2 三樣的實際文字

```
exit 0  今日 OpenAI 花費 $0.0000(0 次呼叫,log: <path>,今日條目 2 筆),上限 $1.0000
exit 1  今日 OpenAI 花費 $0.0225(1 次呼叫,log: <path>,今日條目 1 筆),上限 $0.0225 — 今日預算已用完
        (cap 設 0.0225,spent == cap → 1,測試「花費剛好等於上限 → exit 1」)
exit 2  算不出來:<path> 第 2 行不是合法的 JSON,所以今天的花費算不出來:not json(修好或移除該行後重跑;這是花錢的煞車,不會自動跳過壞行)
        ├ 行號:「第 2 行」(1-based)
        ├ 前 80 字:「not json」(長行測試證實截到 80 且不整行倒出)
        └ 怎麼修:「修好或移除該行後重跑;這是花錢的煞車,不會自動跳過壞行」
exit 2  算不出來:讀不到 log 檔 <path>:ENOENT: no such file or directory, open '<path>'
exit 2  算不出來:環境變數 LLM_DAILY_CAP_USD 沒有設定(在 .env 或 shell 裡設一個非負數字)
```

壞行反轉(不分哪天)驗過:壞行夾在兩筆 2025 年的條目中間也 unknown(既有測試綠)。

## 6. 其他驗證

- **weekly**:壞 JSON → exit 1 + 「讀不到」(回歸鎖已有,沒動);`{}` / `[]` / `"hi"` / `42` /
  `null` / 少欄位 / 型別錯 → exit 1,訊息含 `Weekly`、`它實際是:<前 80 字>`、
  `第一個對不上的地方:…`,stdout 乾淨。
- **lint --dir 打錯不建目錄**:`existsSync(missing) === false`、沒有 `<dir>/state`,訊息含
  `目錄不存在` + 路徑 + `init`;沒給 `--dir` 仍 exit 2。
- **check-questions 三種 0**:目錄不在 / 沒 cards/ / cards 空 → 各自一句、exit 2、不印 `OK`;
  健康 → `OK 檢查了 2 張卡`;有缺 → `FAIL 檢查了 2 張卡,其中 1 張缺考題`。
- **due 三種 0**:空表 / 缺檔 / 壞 JSON / 不是 Review 表 → exit 1、不說「沒有到期的卡片」、
  不噴 stack;健康 → `(讀到 2 張卡)` 分母。
- **`git diff 2c8aacf..HEAD -- '*.test.ts' '*.steps.ts' '*.feature'`**:**0 行**,確認開發 agent
  沒動測試。

## 7. Stryker(四個設定檔,全部 `npm run mutate -- <設定檔>`)

設定檔都在 repo 根目錄、都是 `testRunner: "command"`(測試是 spawn `npx tsx` 的子行程,
Stryker 的 vitest runner 在行程內切 mutant,子行程看不到;command runner 用環境變數
`__STRYKER_ACTIVE_MUTANT__`,子行程會繼承),各自只跑蓋得到那支的測試檔
(`MUTATE_TEST_GLOB` + `vitest.mutate.config.ts`)。**跑兩輪**:第一輪是開發 agent 交來的
測試原樣(只做了必辦 1–3),第二輪是補完存活變異之後。

| 設定檔 | 變異範圍 | 測試 | 開發回報 | 第一輪 | **第二輪** |
|---|---|---|---|---|---|
| `stryker.zero-guards-llmspend.json` | `scripts/llm-spend.ts` | `scripts/llm-spend.test.ts`(`-t '^(?!.*整份)'` 排除 6 條紅) | 77.47% | 77.47%(141 殺 / 41 活) | **98.90%**(178 殺 + 2 timeout / 2 活) |
| `stryker.zero-guards-lint.json` | `scripts/lint.ts` 全檔 | `scripts/lint-missing-dir.test.ts` | 41.46% | 58.54%(24 / 17) | **70.73%**(29 / 12) |
| `stryker.zero-guards-lint-guard.json` | `scripts/lint.ts:20-49`(守門) | 同上 | 37.50% | — | **100.00%**(23 / 0) |
| `stryker.zero-guards-due.json` | `scripts/due.ts` | `scripts/due.test.ts` | 58.82% | 60.29%(41 / 27) | **97.06%**(66 / 2) |
| `stryker.zero-guards-checkq.json` | `cli.ts:140-175` + `validate-question.ts:64-92` | `cli-check-questions.test.ts` + `validate-question.test.ts` | 89.90% | 87.30%(55 / 8) | **100.00%(63 / 0;第二輪半途 96.83%,補「一種 0 只講一件事」兩條後三跑到 100)** |

指令一律 `npm run mutate -- <設定檔>`(走 P-29 的跨 worktree 鎖;第一輪等了另一個
worktree 的 Stryker 約 10 分鐘,鎖有在做事)。

### 第二輪還活著的,逐條

**llm-spend(2 活,2 timeout)**
- `L209 const events = ["Stryker was here"]`:塞一個字串進事件陣列,`computeDailySpend`
  當成「不是事件」默默略過 → 結果不變。**等價**於現況,但它跟 §4 的洞是同一族
  (非物件的事件被靜默忽略);實作修好 §4 之後這個 mutant 仍然等價(它不是 parse 出來的行)。
- `L229 typeof e.ts === 'string' → true`:沒有 `ts` 的條目走到 `dayOf(undefined)`,
  `new Date(undefined)` 是 Invalid Date → `NaN-NaN-NaN` ≠ 今天。**等價**。
- 2 個 timeout:Stryker 算殺掉。沒有列出是哪兩個(clear-text 不印 Timeout),
  誠實講:timeout 是「測試沒在時限內回來」,不等於「測試看出差別」。

**lint(12 活)**
- `L17 i >= 0 → i > 0`:`--dir` 永遠不可能在 argv[0](那是 node)。**等價**。
- `L54 / 57 / 58×5 / 59 / 61 / 63 / 64 / 66`(11 個):全部在 `lint()` **之後**的寫報告路徑。
  `lint-missing-dir.test.ts` 檔頭寫明「成功時的輸出歸另一半」;main 已經有
  `scripts/lint.test.ts` + `stryker.user-facing-lint.json` 蓋這一段(本 base 沒有)。
  在這裡再寫一份會跟 main 撞——**不補,留給合併後 main 的那份**。守門那段
  (L20–49)單獨跑是 100%。

**due(2 活)**
- `L43 i >= 0 → i > 0`:同 lint L17,**等價**。
- `L89 '(無)' → ''`:`safeParse` 失敗時 `issues[0]` 一定在,`first ? … : '(無)'` 的
  else 分支**到不了**。死程式,不補。

**check-questions**
- 第二輪跑完剩 2 個(L150 / L157 的 `process.exit(2)` 拿掉:守門句印完不收工,接著再印下一種 0 的句子)。補「一種 0 只講一件事」兩條斷言後第三跑 **0 活**。

### 第二輪補了什麼測試(對應殺掉的變異)

- `llm-spend.test.ts`:`parseSpendArgs` 11 條(預設路徑、`--today` 清 day、`--day`/`--log`
  缺值或接到旗標、四種壞日期、不認得的參數);cap = 0 是不設限 / cap 負數 unknown;
  今日條目排除別天與沒 `ts` 的;`formatSpendReport` 句首、`無上限`、`今日預算已用完`;
  CLI `--json` 算得出來的六個欄位;**算得出來走 stdout、算不出來走 stderr**(這條殺掉
  4 個「換 console.log / console.error」的 mutant,而且對接 stdout 的協調者有意義);
  參數壞掉的訊息含 `算不出來:` 與格式提示。
- `lint-missing-dir.test.ts`:「目錄不存在」那條補 `不會幫你建出來` 與不噴 stack
  (拿掉 `process.exit(1)` 會印完人話再掉進 `statSync` 的 ENOENT);用法含 `用法`;
  守門不誤傷真的目錄(init 一個 vault 跑 lint → exit 0、兩句守門話都沒出現)。
- `due.test.ts`:缺檔含 `讀不到` 與 ENOENT;壞 JSON 含 `不是合法的 JSON`、parse 原因、
  `它開頭長這樣:`,長壞檔只印 80 字;不是 Review 表的 6 個案例各鎖
  `不是一份 reviews.json` / `它實際是:<前 80>` / `第一個對不上的地方:<where>`
  (根層 `(根): `、`sec-0001: `、巢狀 `sec-0001.stage: `),長的只印 80 字;
  空表兩句補充;到期清單的標題分母、`types=fill,apply`(stage 2 有兩種題型)、
  `STUCK` 只在卡住的那張行尾、沒卡住的行尾乾淨。
- `cli-check-questions.test.ts`:三種 0 各鎖補充句(`沒有檢查任何東西` / `init` /
  `空的 vault`);路徑是檔案 → exit 2 + `不是目錄` + 不噴 stack;**一種 0 只講一件事**
  (拿掉 `process.exit(2)` 會接著再印下一種 0)。

## 8. 完整驗收(main 的清單;base 比 main 舊,跑不到的註明)

```
npm run boundaries        → 掃描 204 個檔案,允許例外 11 條 ✓ 無違規
npm run typecheck         → 0 error
npm run lint:docs         → exit 0
npm test                  → 87 檔:85 passed / 2 failed;1783 條:1776 passed / 7 failed
                            7 紅 = 本輪 5 條鎖洞的紅(§4)+ scripts/mutate.test.ts 的 2 條
                            (鎖的 fixture 日期過了 STALE_AFTER_MS,main 的 8081fc9
                            「stop two lock tests from going stale with the calendar」已修;
                            本分支沒碰 mutate.ts / mutate.test.ts)
npm run accept:dry        → 502 scenarios,ambiguous = 0
npm run accept:standalone → 158 scenarios (158 passed) / 696 steps (696 passed)
npm run standalone        → 全部通過
npm run check:steps       → ✓ 無重複定義
npm run check:gherkin-dup → ✗ 3 組逐字相同(06-test-card/phase-2 與 docs/integration/i1–i6 的
                            「Every standalone entry point still runs」);這些 .feature 本分支
                            一個字沒動,main 已改 scanner 與那些檔(standalone-regression.feature),
                            是 base 舊,不是本輪缺漏
npm run accept:coverage   → ✓ 全部 phase 檔至少涵蓋 1 個場景
check:gates               → 本 base 沒有這個 script(main 的模板 v1.3.4 才有),跑不到
```

## 9. 本輪改動的檔案

- `scripts/weekly.test.ts`:fixture 換掉、補 stdout/stderr 分開的那條、兩句比較改比訊息。
- `scripts/due.test.ts`、`packages/core/src/schema/cli-check-questions.test.ts`:三種 0 改比訊息。
- `scripts/llm-spend.test.ts`:兩句比較改比訊息;新增 6 條「整份不是 JSONL」(純函式 5 條:4 紅 + HTML 1 綠;CLI 1 條:紅)。
- `scripts/lint-missing-dir.test.ts`:補「守門句 vs ENOTDIR stack」那條。
- 新增 `stryker.zero-guards-{llmspend,lint,lint-guard,due,checkq}.json`。
- 第二輪為了殺存活變異補的測試見 §7 末段(四個測試檔都有)。
- 本檔與 01 / 04 / 08 / 09 的 REVIEW.md 摘要。

實作檔(`scripts/*.ts`、`packages/core/src/schema/cli.ts`)**沒有動**——反向驗證的改動全部還原。
`contracts/` 與 `raw/` 未觸碰。

**下一輪**:開發 agent 修 §4 的洞,讓 5 條紅轉綠;之後重跑
`npm run mutate -- stryker.zero-guards-llmspend.json`(設定檔裡的 `-t '^(?!.*整份)'`
是因為 Stryker 的 dry run 不能有紅,修好後把那段拿掉)。
