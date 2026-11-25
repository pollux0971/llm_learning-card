# T68 實作報告(worker)

環境檢查:`OPENAI_API_KEY`=UNSET、`ANTHROPIC_API_KEY`=UNSET、`.env` 不存在(No such file)。

## 做了什麼

- llm 五張表:`LLM_TASKS`、`ROUTING_TABLE`(cloud-or-local)、`TASK_MAX_TOKENS`(1536)、`FALLBACK_TABLE`(gateway-fallback)、`GOLDEN_FALLBACK_TABLE`(cloud-only);`prompt-quality/types.ts` 的本地 LlmTask 鏡射與 `GoldenSetId` 加 `teach.ask`。
- `teach/ask.ts`:`AskAnswerSchema`(strictObject)、`parseAskAnswer`、`buildAskPrompt`(最多 4 輪含這一輪、只含傳進來的那一張卡)、`MAX_ASK_ROUNDS`;`teach/index.ts`。
- `prompts/teach/ask.md`。
- `session/teach-ask.ts`(`createAskController`):背景執行、結果 poll、一次一個、deepen 跑著回 bad-request、`invalidate`(換卡全清)/`abandon`(deepen 開始時丟掉在跑的 ask,問答紀錄以卡 id 比對)、日上限先查再呼叫、四種錯誤、highlight 由側車算。
- `session/teach.ts` 加 `askContext()`;`handler.ts` 接線(teach.open/next/switch/prereq/back 呼叫 `ask.invalidate()`,teach.deepen 呼叫 `ask.abandon()`);`protocol.ts` 方法表與 strict params。
- `review-client.ts`:`teachAsk(question)`、`teachAskPoll()`。
- golden:registry 登記 `teach.ask`、`fixtures/golden-ask/inputs.json` 六組假資料。
- `contracts/fixtures/llm/teach.ask.{good,unreadable,three-followups,no-followups}.json` 與 README 一行。

## 驗證(原文)

```
packages/core/src/llm            Test Files  19 passed (19)   Tests  734 passed (734)
packages/core/src/teach          Test Files  3 passed (3)     Tests  81 passed (81)
packages/core/src/session        Test Files  18 passed (18)   Tests  401 passed (401)
packages/core/src/prompt-quality Test Files  25 passed (25)   Tests  495 passed (495)
features/support/t68-sidecar / t68-fixtures / t68-client      Test Files  3 passed (3)   Tests  19 passed (19)
features/support/t68-handler (含於 session 之外另跑)           通過
npx tsc --noEmit        TypeScript: No errors found
npm run boundaries      ✓ 無違規(掃描 416 檔;teach/、session/ 是目錄級納管,不需新登記)
npm run check:steps     ✓ 無重複定義(1401 個定義)
```

沒跑:cucumber、變異、`--live`、`check:all`。

## 待協調

1. 日上限不能用 `ExplicitLedger.unverified(`(`vault-pointer.test.ts` 釘死只准 `scripts/llm.ts`、`scripts/llm-spend.ts`)。所以 `teach-ask.ts` 直接讀 `<learningDir>/state/log.jsonl`,經 `parseLedger` + `computeDailySpend` + `isBudgetExhausted`(跟 router 同一份壞行定義與 `CAP=0 = 無上限`)。壞行/讀不到 → `error: 'budget'`(訊息說花費算不出來),不呼叫。請驗收者看這個取捨。真 router 呼叫中丟 `BUDGET_EXCEEDED` 也對到 `budget`(G2)。
2. `grading/types.ts` 與 `ingest/types.ts` 各有一份 LlmTask 鏡射,沒動(不在 touches);`teach-ask.ts` 照 `teach-deepen.ts` 的做法 cast 成 `@core/llm` 的 `LlmRouter`。
3. 失敗四種都是 `ok: true`、`ask.error`;沒有目前這張卡時 `teach.ask` 回 `bad-request`;空白問題回 `bad-request`。
4. 回答 `answer` 全空白也視為空(`trim`),測試沒釘。
5. golden run(`--live`)由協調者跑;ask.md 是新檔。
