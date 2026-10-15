---
id: T9
deps: [T8]
touches: [packages/core/src/llm/spend.ts]
cpu: light
budget_usd: 3
status: todo
owner: worker-claude    # 預設值;使用者回答 grok 之前不派 grok(顧問 2026-10-15)
must_catch:
  - 負的 tokens 抵掉花費:5 美元的帳本多一行 tokens_in 為負,算出來變少,而不是「不知道」
  - tokens 是字串(或 null、小數、布林、陣列、Infinity)被當成 0
  - tokens 在計價行裡缺少,被當成 0
  - 缺 ts 的行被跳過(它可能是今天的)
  - schema 驗證被拿掉:type 不在 EVENT_TYPES、ts 為空、card 不合法的行放行
  - ts 不是含時區的 ISO 8601,或不是真實的日期(2026-02-30)
  - 計價行缺 provider
  - 只對今日的行驗證(先用 ts 濾今日、再驗)
  - 壞行的回報不是第一個,或不帶行號,或沒點名違規的欄位
---

# 工單 T9:帳本每一行都要通過 LogEventSchema,llm_call 再加三條花費規則

> 狀態:草稿,待技術顧問審。**錢相關。**
> 作者:驗收·測試 agent(-ed)。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 裁決來源:技術顧問 2026-10-15 對 T8 驗收的裁決(F-4)。**`--live` 的煞車維持到本張合併為止。**
> 基底是含 T8 的分支(`pollux0971/t8-accept-tests`);T8 沒進 main 之前本張的測試跑不起來。

## 為什麼有這張

T8 之後「壞行 = 不知道」,但壞行只有兩種:JSON.parse 失敗、`ts` 在卻不是字串。
JSON 合法、卻會讓花費算少的行,還是能混進帳本(我自己重現過):

| 壞掉的行 | 現在的結果 |
|---|---|
| `tokens_in` 是 −2,000,000,別的兩行各 1M | $5 變 $0:負數把別的花費抵掉 |
| `tokens_in` 是字串或缺少 | 那一次算 0 元(witness `llm.spend.tokens-missing-zero`) |
| 缺 `ts` | 被「今日」的 filter 靜默略過 |
| `ts` 是 `"yesterday"` | `dayOf` 回 NaN 日期,不等於今天,被略過 |

我們自己寫的行一定合規;不合規只可能是損壞、手動改過、或程式有 bug。三種都不能當成「花得比較少」。

## 規則(單一定義在 `spend.ts` 的 `parseLedger`)

`scripts/llm-spend.ts`、`readDailySpend`、router 都已經經過它,不要再開第二個判定的地方。

**L. 每一行**:JSON 物件,而且通過 `@contracts/index.js` 的 `LogEventSchema`(同一份定義,**不另寫一份**類型清單或規則)。
不通過的 `bad.what` 要含 `LogEventSchema`,並帶出 schema 的第一個錯誤訊息(例如 `ts 不可為空`)。

**C. `type === 'llm_call'` 再加**:

| 條 | 規則 |
|---|---|
| C1 | `ts` 是 ISO 8601 含時區(`Z` 或 `±hh:mm`,冒號必須有)的**真實時間點**:`2026-02-30`、月份 13、小時 25 都不算;閏日 `2028-02-29` 算 |
| C2 | `tokens_in`、`tokens_out` **只要出現**,就必須是非負的安全整數(`null`、字串、小數、布林、陣列、負數、`Infinity`、超過 `Number.MAX_SAFE_INTEGER` 都是壞的) |
| C3 | **計價行**必須有非空字串 `provider`、有 `tokens_in` 與 `tokens_out` |

「計價行」= `provider !== 'ollama'`(只認小寫,跟 `isLlmCallEvent` 一致),而且不是**標記行**。
標記行 = 我們自己寫的、本來就沒有完整 tokens 的行,標記欄位必須剛好是布林 `true`:

| 標記 | 寫入點 | 形狀 |
|---|---|---|
| `timeout: true` | `router.ts` 逾時 | 沒有 tokens |
| `truncated: true` | `router.ts` 截斷 | 只有 `tokens_out` |
| `retry: true` | `ingest/questions.ts` 重試 | 沒有 provider、沒有 tokens |

標記行免 C3(免 provider、免 tokens 存在),但仍受 L、C1、C2。`ollama` 同理:tokens 可有可無,有的話受 C2。
`bad.what` 要點名違規的欄位(`ts` / `tokens_in` / `tokens_out` / `provider`)。壞行不分哪一天;多個壞行回報行號最小的那個。

### 已知決定點(請顧問審)

1. **標記行免 tokens 存在**是我依「我們自己寫的行一定合規」做的最小讓步。不讓步的話,一筆逾時就會讓之後所有真呼叫被拒絕。
2. `truncated` 行只有 `tokens_out`、沒有 `tokens_in`:輸入端的花費在現況就沒算進去(`numberField` 當 0)。**這是既有的低估,本張不改**;witness `llm.spend.tokens-missing-zero` 因此仍然可達,不要刪。要不要讓寫入端補 `tokens_in` 是另一張的事。
3. 其他事件(`learned`、`warning`…)只受 L,不受 C:它們的欄位不進花費。

### 真實帳本的檢查(驗收者做,只印數字)

規則依上面這份在真的 `learning/state/log.jsonl` 上跑過一次(唯讀):**52 行全部通過**(48 行 `llm_call`、4 行其他)。

## 驗收條件

1. 上面的 L、C1–C3,逐列由 `packages/core/src/llm/ledger-line-schema.test.ts` 的合規表(16 列)與壞行表(43 列)釘住,**測試已經寫好**。
2. 壞行讓 `readDailySpend` 丟 `UnknownSpendError`(行號在 `lineNumber` 與訊息裡)、`llm-spend` exit 2 且報告裡有行號與欄位、router 在打任何 adapter 之前拒絕(`scripts/llm-spend.test.ts` 的 T9 區塊、同檔的 router 區塊)。
3. 寫入端的每一種 `llm_call` 形狀(成功、閘道成功、備援、逾時、截斷、重試)過規則;router 真的呼叫後寫進帳本的行馬上被接受。
4. 既有測試的假資料不合規的,**測試 agent 已經改**(`review_done` 不是契約的事件類型,改 `reviewed`;`event()` 的預設補 `tokens_in/out: 0`;「沒有 ts 的物件照常算」改成壞行)。開發 worker 不改測試。
5. `parseLedger` 與 `LogEventSchema` 的關係:`spend.ts` 引用 `LogEventSchema`,不出現 `EVENT_TYPES` 或事件類型字面清單;`llm-spend.ts` 沒有 `JSON.parse(`。
6. 全部 vitest 綠;`npm run boundaries`、`lint:docs` PASS;`tsc` 0 錯。

## 測試誰寫

- 測試 agent:上面全部(已寫)。丟棄式實作證明可轉綠:跑 `packages/core/src/llm`、`ingest`、`schema`、`prompt-quality`、`scripts` 共 3146 條全綠(已還原,不在 git);16 條突變(負數放行、字串放行、小數放行、拿掉 schema、ts 不查、2/30 放行、時區可省、計價行缺 tokens/provider 放行、標記寬鬆、ollama 不分大小寫、ollama 免 C2、標記行免 C2、回報行號錯、訊息不點名、只驗今日)16 條都紅。
- 開發 agent(worker-claude):只寫 `spend.ts`。**不跑變異測試**(重活規則)。
- 驗收:照 `worker-acceptance`,含 Stryker `spend.ts`、真帳本唯讀檢查。

## 預算

`budget_usd: 3`。實際超過 2 倍($6)要在報告標出。
