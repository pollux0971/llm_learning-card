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
