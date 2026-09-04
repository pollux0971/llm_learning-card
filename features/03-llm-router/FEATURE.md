# 03 · llm-router

## 一句話

所有 LLM 呼叫的唯一入口。呼叫端只說任務,router 決定走本機還是雲端。

## 範圍

- 契約 §7 的 `LlmRouter` 實作
- 雲端 adapter:Anthropic、OpenAI
- 本機 adapter:**閘道**(ADR-039)。本機模型跑在另一台機器上的 Ollama,前面一個 JWT 閘道;
  對這個專案來說它就是契約 §7 的「本機」——`LlmResult.provider` 回 `'ollama'`,**不改契約**。
  ADR-037 的「使用者決定裝本機模型」gate 已解除
- 網路可用性偵測(含 60 秒快取);本機可用性偵測的邏輯在 phase-2 寫,但固定回傳 unavailable(沒有本機模型可偵測)
- 路由表(契約 §7 的權威表)——phase-2 用注入的 online/local 布林值測滿,不依賴真的本機模型
- provisional 標記與複審佇列(phase-3,ADR-039 解除 gate)
- **備援規則(phase-4,ADR-039)**——契約 §7 的路由表**一格都不動**;這是在「在線」
  之上多的一層,處理契約沒有的第四種情況:**在線,但雲端這一次不能用**
  (5xx / 逾時 / 截斷重試後仍失敗,或當日預算用完):

  | task | 在線且雲端正常 | 雲端失敗或預算用完 |
  |---|---|---|
  | `grade.fill.llm` | 閘道(契約本來就是 local),`provisional=false` | 同左 |
  | `deepen` / `grade.apply` / `reteach.short` | OpenAI | **閘道,`provisional=true`**(進 I6 複審佇列) |
  | `ingest.cards` / `ingest.questions` / `ingest.deps` | OpenAI | **沒有備援**:失敗 → `CLOUD_REQUIRED`;預算用完 → `BUDGET_EXCEEDED`(拒絕開始) |

  `ingest.*` 沒有備援是使用者明確選的:卡片品質還沒用本機模型驗過,不讓它產卡。
- **當日預算(phase-4,ADR-039)**:`LLM_DAILY_CAP_USD`(預設 1 美元)。花費從
  `state/log.jsonl` 的 `llm_call` 事件算(只算 `provider === 'openai'` 且當日的,
  `tokens_in`/`tokens_out` × `LLM_PRICE_IN_PER_M`/`LLM_PRICE_OUT_PER_M`)。
  **`spent >= cap` 就算達到上限**(ADR-039 的邊界決定)。閘道免費,不計入。
- 每次呼叫寫 log

## 不在範圍

- 任何 prompt 內容(各功能自己管)
- 審核邏輯(→ 05)
- 對回傳做業務解析(呼叫端做)

## 單獨執行

```bash
LLM_CLOUD_PROVIDER=openai OPENAI_API_KEY=... LLM_CLOUD_MODEL=gpt-5.6-luna \
  npx tsx scripts/llm.ts --task deepen --prompt "用 50 字解釋同源政策"
npx tsx scripts/llm.ts --probe        # 印出線上與本機狀態,不呼叫模型
npx tsx scripts/llm-spend.ts --today  # 今日 OpenAI 花費;退出碼 1 = 已達上限
```

預期輸出:第一個印出 `LlmResult` 的 JSON;第二個印出 online / local 與可用模型清單;
第三個印出今日金額與筆數(ADR-039,給 autopilot 在花錢之前先問一句用)。

## 依賴

**Wave 0(phase-1)**:無。log 寫入用自己的最小 appender。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1 | 路由建立在介面上 |
| phase-3 | 自身 phase-2(契約 gate 已由 **ADR-039 解除**) | provisional 只在真的有本機模型可用時才有意義;閘道就是那個本機模型 |
| phase-4 | 自身 phase-2(契約 gate 已由 **ADR-039 解除**) | 閘道提供了真的可以對的本機模型;閘道本身還沒起來,所以 `@llm` 場景先用 mock 閘道,真連線標 `@manual` |

## Wave 0 的重複

| 東西 | 位置 | 整合時移除於 |
|---|---|---|
| 最小 log appender | `packages/core/src/llm/log-min.ts` | 已移除,2026-09-03(router.ts 改呼叫 01 的 `schema/log.ts` recordEvent()) |

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `packages/core/src/llm/` |
| 雲端 | 官方 SDK | 只在 adapter 內 import |
| 本機 | fetch → 閘道 `{GATEWAY_BASE_URL}/gateway/chat`(ADR-039) | 不用第三方 client;token 從 `/auth/token/exchange` 換,快取到過期前 |
| 設定 | 環境變數優先於 settings.yaml | |
| 變異門檻 | **標準 80%**,但 `routing.ts` 為**嚴格 95%** | 路由表決定成本與離線行為,必須測滿。phase-4 的備援規則(`fallback.ts`)與預算(`spend.ts`)**刻意不併進 `routing.ts`**,比照 `token-limits.ts` 的做法,避免動到既有的嚴格門檻 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | 介面、雲端 adapter、log、逾時 | Wave 0 | done | 2026-09-02 |
| 2 | 離線偵測、路由表(本機永遠回 unavailable) | I1 | done | 2026-09-03 |
| 3 | provisional 標記與複審佇列 | I6 | todo(gate 已由 ADR-039 解除) | |
| 4 | 閘道本機 adapter + 預算備援 | I6 | in-progress | |

## 驗收方式

路由決策全自動(mock 網路與 Ollama 狀態)。真呼叫只在 `@llm` 與 `@manual`。
`routing.ts` 的變異門檻 95%——契約 §7 的表格每一格都要有測試。

## phase-4 的落點(ADR-039)

| 檔案 | 做什麼 | 為什麼在這裡 |
|---|---|---|
| `packages/core/src/llm/adapters/gateway.ts` | 閘道客戶端:換 token(含快取)、`/gateway/models` 探測、`/gateway/chat` 推論 | 跟雲端 adapter 平行,唯一碰網路的地方 |
| `packages/core/src/llm/fallback.ts` | ADR-039 的備援規則(純函式 + 資料表) | **不放進 `routing.ts`**,避免動到它的嚴格 95% 門檻 |
| `packages/core/src/llm/spend.ts` | 從 log 算當日花費、`isBudgetExhausted()` | 同上;而且是純函式,好測 |
| `packages/core/src/llm/router-gateway.ts` | `GatewayLlmRouter`:把上面三個接到 I/O 上 | 組合 phase-2 的 `LlmRouterImpl`,**不改它一行**(跟 phase-2 包 phase-1 一樣) |
| `scripts/llm-spend.ts` | `--today` 印今日金額與筆數,**退出碼 1 = 已達上限** | 給 autopilot 在花錢之前先問一句 |

錯誤(`errors.ts`):`GatewayModelRejectedError`(403,設定錯誤,**不備援**)、
`GatewayCallError`(5xx / 連線失敗)、`DailyBudgetExceededError`(訊息含「今日預算已用完」)。

閘道還沒起來(8787 無回應、key 未進 `.env`),所以 `phase-4.feature` 的自動場景全部用
**假的 `globalThis.fetch`**(照 `features/steps/_fake-cloud.mjs` 的模式,只換最外層的網路邊界,
router / client / SDK 全跑真的),真連線的場景標 `@manual`。假 fetch 的裝卸掛在
`Before/After({ tags: '@llm-router and @phase-4' })`——**`@phase-4` 這個 tag 06/07/10 也在用**,
只寫 `@phase-4` 會換掉別人場景的 fetch。

## 已決定但要複核(ADR-034)

- 雲端 provider:**OpenAI**。金鑰在專案根目錄 `.env` 的 `OPENAI_API_KEY`(已被 .gitignore 擋住)。
- 模型名稱:使用者給的是 `gpt-5.6-luna`。**不要在程式碼裡寫死。** 依契約 §11,
  模型名從環境變數 `LLM_CLOUD_MODEL` 讀(其次 `settings.llm.cloud_model`),provider 從
  `LLM_CLOUD_PROVIDER`。scaffold 已在 `.env.example` 放這三個變數與預設值。
- `.env` 的載入:Node 22 內建 `process.loadEnvFile('.env')`,只在 CLI 入口(`scripts/llm.ts`)呼叫,
  檔案不存在時吞掉錯誤;library 程式碼只讀 `process.env`,不碰檔案。
- 模型名已由協調者用 API 驗證存在(2026-09-02)。之後要換模型只改 `.env`,不用動程式碼。
- **OpenAI adapter 的參數名**:協調者用實際金鑰打過 `/v1/chat/completions`,`gpt-5.6-luna` 確實存在(HTTP 200),
  但**不吃 `max_tokens`**,會回 400 `Unsupported parameter: 'max_tokens' ... Use 'max_completion_tokens' instead.`
  adapter 一律用 `max_completion_tokens`。

## 開放問題

- 雲端逾時 60 秒是否太長?先這樣,用了再調。
- token 用量要不要做 UI?先只 log。

## i1-integration-fix:真的呼叫 gpt-5.6-luna 生成卡片時發現的洞(截斷)

真的打 API 才發現:openai adapter 的 `MAX_COMPLETION_TOKENS` 寫死 1024,長回應被切斷。
這次剛好切在 JSON 中間才被抓到——如果切在別的地方,JSON 可能仍合法,會得到一張**少字的卡,
而且測試全綠**。這輪(測試/審核 agent)只定介面 + 補測試,不碰真的 SDK,分工:

- **已完成(這輪,測試綠燈)**:
  - `errors.ts`:新增 `OutputTruncatedError`(`code='OUTPUT_TRUNCATED'`,帶 `task` / `maxTokens` / `tokensOut`)。
  - `types.ts`:`CloudAdapterCallArgs` 加 `maxTokens: number`;`CloudAdapterResult` 加
    `truncated?: boolean`(adapter 自己判斷、router 看這個欄位決定要不要丟錯,不是 adapter 直接丟)。
  - `token-limits.ts`(新檔案,跟 `routing.ts` 放一起、故意不共用同一個檔案,避免動到
    `routing.ts` 既有的嚴格 95% 變異門檻):`TASK_MAX_TOKENS`,7 個 task 各自的上限。
  - `router.ts` 的 `call()`:`opts.maxTokens ?? TASK_MAX_TOKENS[task]` 查表後傳給 adapter;
    adapter 回傳 `truncated: true` 就丟 `OutputTruncatedError`(不回傳 text),並且 log 一筆
    `llm_call` 事件帶 `truncated: true` / `max_tokens` / `tokens_out`,跟現有 `LlmTimeoutError`
    的 catch 邏輯同一個模式。
  - `LlmRouter.call()` 簽章(契約 §7 軟約定)加 `opts?.maxTokens`,`contracts/types.md` 已同步。
  - 測試:`router.test.ts`(用假 adapter 驗證截斷丟錯 + log + 每任務查表 + `opts.maxTokens`
    覆蓋表格值)、`token-limits.test.ts`(7 個 task 都有、`ingest.cards >= 4096` 回歸鎖)。
- **留給下一輪開發 agent(真的碰 SDK,未實作,已在檔案內留 TODO 註解)**:
  - `adapters/openai.ts`:`max_completion_tokens` 從寫死的常數改用 `args.maxTokens`;
    `response.choices[0]?.finish_reason === 'length'` 時回傳的結果加 `truncated: true`。
  - `adapters/anthropic.ts`:同上,`max_tokens` 改用 `args.maxTokens`;
    `response.stop_reason === 'max_tokens'` 時加 `truncated: true`。
  - 這兩個檔案的邏輯不需要新測試——`router.test.ts` 用假 adapter 已經把 router.ts 這半的行為鎖住,
    adapter 端做完後用 `@llm`/`@manual` 手動打一次真的 API 確認 `finish_reason`/`stop_reason` 有正確映射即可。

**`.env` 沒有在 CLI 入口載入的洞**:ADR-034 原意是「所有 `scripts/*.ts` 入口都要載入 `.env`」,
但只有 `scripts/llm.ts` 真的做了,`scripts/ingest.ts`/`scripts/review.ts` 沒有,沒設環境變數時
直接丟一個沒有前後文的 `MissingCredentialError` stack trace。已抽成 `scripts/_env.ts`
(guarded `process.loadEnvFile('.env')`,檔案不存在吞掉錯誤),`ingest.ts`/`review.ts` 開頭
`import './_env.js'`。`scripts/check-boundaries.ts` 的 `OWNERS` 加了 `scripts/_env.ts`(`infra`),
`boundaries.allow.json` 加了 `02-ingest-pipeline → infra`、`11-review-cli → infra` 兩條。
純 CLI 入口的 side effect,沒有寫測試(跟 `scripts/llm.ts` 原本的做法一致)。

## 待協調

- **`cucumber.js`(共用檔,worker 不能自己改)有 bug,擋住所有功能的 `npm run accept:standalone` /
  `npm run accept`。** 現況(ESM,`"type": "module"`):
  ```js
  export default {
    default: { paths: [...], import: [...], tags: 'not @manual', format: [...], publishQuiet: true },
  };
  ```
  cucumber-js 11.3.0 用 `await import()` 讀 ESM 設定檔時,模組的 `export default` 值本身就會被當成
  「`default` profile 的內容」——不需要再手動包一層 `default:`。現在這樣包兩層,實際解析出來的
  `paths` / `import` 都是空陣列,所以**目前沒有任何 `.feature` 真的載入到 `features/steps/**/*.ts`
  的步驟定義**,`npm run accept:standalone` 對所有功能都回報 100% undefined steps(不是我這個功能
  獨有的問題)。
  修法(已驗證):拿掉多包的 `default:` 一層,改成
  ```js
  export default {
    paths: ['features/**/*.feature', 'docs/integration/**/*.feature'],
    import: ['features/steps/**/*.ts'],
    tags: 'not @manual',
    format: ['progress'],
  };
  ```
  (`publishQuiet` 這版也提示已不需要,可以順便拿掉,但不影響本問題。)
  改完之後我這個功能的 phase-1.feature 12 個非 `@manual` 場景全過(本地用暫時修好的
  `cucumber.js` 驗證過:`12 scenarios (12 passed)`,驗完立刻還原檔案沒有留改動)。
  **這個 bug 擋住其他九個平行 worker 的驗收,建議優先修。**
