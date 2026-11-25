---
id: T68
deps: []
touches: [packages/core/src/llm/types.ts, packages/core/src/llm/routing.ts, packages/core/src/llm/token-limits.ts, packages/core/prompts/teach/ask.md, packages/core/src/teach/ask.ts, packages/core/src/teach/index.ts, packages/core/src/prompt-quality/golden-sets/registry.ts, packages/core/src/prompt-quality/types.ts, packages/core/src/prompt-quality/fixtures/golden-ask/inputs.json, packages/core/src/session/teach.ts, packages/core/src/session/handler.ts, packages/core/src/session/teach-ask.ts, packages/core/src/session/protocol.ts, packages/core/src/session/protocol.vectors.json, apps/desktop/src/webview/review-client.ts, contracts/fixtures/llm/teach.ask.json, contracts/fixtures/README.md]
cpu: heavy
budget_usd: 4
status: todo
owner: worker-grok
must_catch:
  - ask 跑著時 teach.next(或 switch、prereq、open、deepen、back)回 busy 或 bad-request 同時有 ask 在跑那條必須紅(這些動作照常執行,同時丟掉還在跑的 ask)
  - 換卡後晚到的回答進了新卡的問答紀錄,或出現在 teach.ask.poll 的結果 晚到那條必須紅(側車丟掉)
  - deepen 跑著時 teach.ask 沒回 bad-request 互斥那條必須紅
  - teach.ask 同步等雲端回答才回(回應不是 { asking: true }) 背景那條必須紅(假 router 慢回答時,teach.ask 在回答之前就回了)
  - TASK_MAX_TOKENS 少了 teach.ask 或 LLM_TASKS 沒有它 token-limits 與 routing 的窮盡測試必須紅
  - teach.ask 的路由跟 deepen 不同(例如離線無本機沒丟 NO_MODEL、離線有本機沒標 provisional) 路由表那組必須紅
  - 側車收路徑、卡 id 或任何多餘參數 protocol 的 strict schema 與向量必須紅
  - 問的是別張卡(用參數指定、或用上一張的畫面狀態) 換卡之後再問那條必須紅(提示裡只能有目前那張卡)
  - 回答 JSON 缺欄位、suggestion 不是三選一、followups 超過 3 個、answer 為空 解析失敗那四條必須紅,而且回應裡不能有亮按鈕的建議
  - 看不懂的回答被「猜」成 continue 或被截一截當成功 解析失敗那條必須紅(建議必須是 none 且帶可再問的訊息)
  - 到每日上限還呼叫了 AI 上限那條必須紅(呼叫次數 0)
  - LLM_DAILY_CAP_USD=0 被當成「已用完」 CAP=0 那條必須紅(0 是沒有上限)
  - 討論寫進 reviews.json、卡檔、order 檔、log.jsonl 以外的任何檔 不落地那條必須紅(前後位元組一樣;log 只多 llm_call 行)
  - 換卡或關窗後前一輪問答還被送給 AI 換卡那條必須紅(送出的提示不含舊問答)
  - 輪數上限沒有擋(第 N+1 輪的提示還含最舊的一輪) 輪數那條必須紅
  - 追問選項被當成指令(例如點它直接跳卡) 追問那條必須紅(只是下一個問題的文字)
  - prompt 檔改了沒有 golden 集 registry 測試必須紅(有 prompt 沒登記 = 紅)
  - 實作動到 touches 以外的檔 不動的地方那條 diff 必須有輸出
---

# 工單 T68:07-teach-card phase-6(上半)——「問 AI」的核心與側車

> 狀態:起草 2026-11-25(協調者 -91),依技術顧問 2026-11-25 的交代。使用者 2026-11-25 用 `/feature` 確認「可以加上詢問選項輔佐討論,都選a」。決策 ADR-086、規格 `features/07-teach-card/phase-6.feature`、契約 1.6.0(都在分支 `ask-ai-spec` `fc76c90`)。**待顧問審。**
> 實作:worker(opencode + grok-4.7);紅測試與步驟定義:測試 agent;驗收:驗收 agent;golden 評分:技術顧問。
> 基底:`ask-ai-spec` 合進 main 之後的 main。**同一批 main 還沒推之前不派工。**
> 下半(畫面)是 T69,依賴這張。落點不相交,但 T69 要 T68 的協定與回應形狀,所以先 T68。

## 為什麼拆兩張

- 上半是核心與協定(純邏輯、zod、側車動作、prompt、golden),可以不開 Chrome 單獨驗。
- 下半是畫面(Svelte、渲染測試、`@manual`),要真 Chrome,是重活。
- 兩張的紅測試、驗收、變異範圍不同,拆開各自能退回,不會互相卡。

## 規格(ADR-086 的實作面)

1. **契約 §7**(1.6.0 已在規格批改好,**唯讀**):`LlmTask` 加 `teach.ask`,路由跟 `deepen` 同一列。
   - `packages/core/src/llm/types.ts` 的 `LLM_TASKS` 加 `'teach.ask'`。
   - `packages/core/src/llm/routing.ts` 的 `ROUTING_TABLE['teach.ask']` = `deepen` 同一組(`cloud-or-local`)。
   - `packages/core/src/llm/token-limits.ts` 的 `TASK_MAX_TOKENS['teach.ask']`:**1536**(顧問定;截斷算錯誤〔`OutputTruncatedError`〕,中文回答加 3 個追問很容易碰到 1024)。prompt 寫明:answer 不超過 200 字,每個追問不超過 30 字;zod 不檢查長度,只檢查非空。
2. **prompt**:`packages/core/prompts/teach/ask.md`(新資料夾,照 `prompts/grading/reteach-short.md` 的寫法)。輸入有:目前那張卡(標題、body、example)、這張卡的先備清單與哪些還沒學、前幾輪的問答(最多 N 輪,見第 5 點)、這一輪的問題。輸出是**一個 JSON 物件**,不要別的字。
3. **回答格式**(模組內部,**不是契約**;`packages/core/src/teach/ask.ts` 用 zod 驗,strict):

   ```ts
   { answer: string /* 非空 */,
     suggestion: 'continue' | 'deepen' | 'back',
     followups: string[] /* 0–3 個,每個非空 */ }
   ```

   - 看不懂(不是 JSON、缺欄位、多欄位、值不合法、followups 超過 3 個)→ **整個當失敗**:不猜、不截、不修;側車回「這次的回答看不懂,可以再問一次」,建議是 `none`。
   - `back` 要回 `unlearned prerequisite` 的 id 時,由**側車**從這張卡的先備算(AI 不給 id、不收 AI 給的 id):第一張未學的先備;沒有就是 `none-available`。
4. **側車動作 `teach.ask`(背景執行,照 deepen 的做法;顧問 2026-11-25 擋下同步 await)**:
   - 側車 `review_sidecar.rs` 用 try_lock,同一時間只有一個請求,第二個拿 busy。雲端回答要 5–15 秒,所以 `teach.ask` **不能同步等**:新增 `packages/core/src/session/teach-ask.ts`(`createAskController`,照 `teach-deepen.ts` 的 `createDeepenController`),`teach.ask` 只在背景開始、**馬上回 `{ asking: true }`**;視窗用新動作 **`teach.ask.poll`**(參數 `{}`)拿結果(進行中回 `{ asking: true }`,完成回下面的 `ask`)。
   - 問的時候按 `teach.next`、`switch`、`prereq`、`open`、`deepen`、`back`:**照常執行,同時丟掉還在跑的 ask**(像 deepen 的 abandon);晚到的回答由側車丟掉,不放進新卡的問答紀錄、`teach.ask.poll` 也不回它。
   - `deepen` 跑著時呼叫 `teach.ask`:回 `bad-request`,跟 `teach.next` 的規則一樣。
   - 協定方法表加 `'teach.ask'`、`'teach.ask.poll'`,向量檔兩個都補。
   - 以下是動作的內容:(`protocol.ts`、`handler.ts`、`session/teach.ts`;協定向量檔補,測試 agent 寫):
   - 參數:`{ question: string }`,strict。**不收路徑、不收卡 id、不收別的**。問的永遠是側車目前那張卡。
   - 回應(接在現有 `TeachView` 後面,同一條路,ADR-075、ADR-077):

     ```ts
     ask: { answer: string; provisional: boolean;
            suggestion: 'continue' | 'deepen' | 'back' | 'none';
            highlight: 'next' | 'deepen' | { prereq: CardId } | null;
            followups: string[] } | { error: 'unreadable' | 'no-model' | 'budget' | 'failed'; message: string }
     ```

   - `highlight` 由側車算(畫面只照著亮):`continue`→`next`;`deepen`→`deepen`(已是最深一層時 `null`,照 phase-3 的「已經是最深的一層」);`back`→第一張未學先備,沒有就 `null`。
   - 同一張卡的前幾輪問答放在**側車記憶體**,換卡(`teach.next`、`teach.switch`、`teach.prereq`、`teach.deepen` 成功、`teach.back`、`teach.open`)就清;側車重啟就沒了。**上限 N = 4 輪**(顧問可改;問答都算進提示,所以也是 token 上限)。
   - 一次只准一個 ask 在背景跑;跑著時再來一個 `teach.ask` 回 `bad-request`。
5. **花費**:呼叫前照 `LLM_DAILY_CAP_USD` 擋,到上限回 `error: 'budget'`、**不呼叫**。用 `packages/core/src/llm/spend.ts` 的 `readDailySpend` 與 `isBudgetExhausted`(`CAP=0` = 沒有上限,不是用完)。**先讀 `router-gateway.ts` 現在怎麼擋**(`budget-exhausted`):能用同一條就用同一條,不要另寫一份算法;兩邊對「上限」的看法要一樣。
6. **離線**:`NO_MODEL` → `error: 'no-model'`;本機回的 `provisional: true` 帶回去,畫面標「暫定」。
7. **不落地**:不寫卡檔、`reviews.json`、order 檔;router 照舊記 `llm_call`(不由這張改)。
8. **golden 集**:登記 `teach.ask`(`registry.ts`、`GoldenSetId`),輸入放 `packages/core/src/prompt-quality/fixtures/golden-ask/inputs.json`,至少 6 組:一般問題、問題跟卡無關、要求 AI 直接給答案跳過學習、卡有未學先備、卡已是最深一層、問得很短。**全是假資料(沒有 `learning/` 的內容)**。
9. **FakeLlmRouter 的 fixture**:`contracts/fixtures/llm/teach.ask.json`(一組好回答、一組壞回答、一組追問 3 個、一組追問 0 個),`contracts/fixtures/README.md` 加一行。

## 紅測試(測試 agent 寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| 契約窮盡 | `LLM_TASKS`、`TASK_MAX_TOKENS`、路由表都含 `teach.ask`,且與 `deepen` 同組 | 既有的 `token-limits.test.ts`(7→8、`toEqual` 表加一列)、`routing.test.ts`(11 組變 14 組)、`router.test.ts`、`fallback.test.ts` 跟著改;**每一處改了什麼、為什麼,寫進紅測試 commit 說明**(測試 agent 改既有測試) | 紅 |
| 回答 schema | `ask.ts` 的 zod:好回答、缺欄位、多欄位、suggestion 非法、followups 4 個、answer 空、不是 JSON、JSON 外有字 | vitest 表格 | 紅 |
| 背景與互斥 | teach.ask 回 `{ asking: true }` 在回答之前;ask 跑著時 next/switch/prereq/open/deepen/back 照常執行並丟掉 ask;晚到的回答不進新卡紀錄、poll 不回;deepen 跑著時 ask 回 bad-request | 真側車 + 可控制 resolve 時機的假 router | 紅 |
| 側車協定 | `teach.ask` 的 strict schema:多一個欄位(`path`、`card`、`id`)必須被拒;向量檔 | `protocol.test.ts` 加向量 | 紅 |
| 只問目前那張 | 換卡再問,提示裡只有新那張卡;前一輪問答被清掉 | 真側車 + `FakeLlmRouter` 記下收到的 prompt | 紅 |
| 輪數上限 | 第 5 輪的提示不含第 1 輪 | 同上 | 紅 |
| highlight | continue/deepen/back 三種各算對;back 沒未學先備時 `null`;deepen 在最深一層時 `null` | 真側車 + 假 router | 紅 |
| 失敗路徑 | 看不懂、`NO_MODEL`、上限、`failed`(router 丟別的錯) 四種都回 `error`、不亮、不丟例外 | 同上 | 紅 |
| 上限 | 帳本已達上限 → 呼叫次數 0;`CAP=0` → 照常呼叫;帳本壞行 → 照 router 現在的處理(**不是零**,見 spend 的 `UnknownSpendError`) | 假帳本(mkdtemp) | 紅 |
| 不落地 | 前後位元組一樣(`reviews.json`、卡檔、order 檔);`log.jsonl` 只多 router 記的 `llm_call` | mkdtemp 的 learning、`XDG_*`、`HOME`;**不准 live** | 紅 |
| golden 登記 | `registry.test.ts`:`teach.ask` 有集、prompt 檔存在、至少 6 組、每組 id 唯一 | vitest | 紅 |
| 場景 | `phase-6.feature` 的場景 1、2、3、4、5、6、7、8、9、10、11、12(自動的 12 條;第 13 條 `@manual` 在 T69) | 新步驟檔(例如 `features/steps/teach-card-phase6.steps.ts`),真側車子行程 + `FakeLlmRouter`;**畫面類的句子(「顯示在卡下面」「按鈕亮」)交 T69 的渲染步驟,這張只定義到側車回應** | 紅 |

- 場景要的「畫面顯示 / 亮」那幾句步驟:**分派給 T69**。T68 的步驟檔只定義到「側車回應裡 `answer`、`highlight`、`followups`、`error` 是什麼」。測試 agent 在紅測試裡先把兩邊的句子分好、寫進 commit 說明,兩張不重複定義(`check:steps` 要綠)。
- 測試一律用 mkdtemp 當 learning、`XDG_*`、`HOME`;**不准 live**。

## 驗收條件

1. `NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@teach-card and @phase-6 and not @manual" --format summary`:T68 負責的場景全過;屬於 T69 的句子仍是 undefined(`check:dry-run` 不紅,見規格批的證據)。
2. `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/llm packages/core/src/teach packages/core/src/session packages/core/src/prompt-quality` 全綠。
3. 07 phase-1 到 phase-5、06、05、03 既有測試與場景全綠(只有 8 個 LlmTask 的窮盡測試是照契約 1.6.0 改的)。
4. must_catch 每一條:在驗收 worktree 做那個改壞,對應的測試紅,記失敗訊息原文,還原再綠。
5. 變異:`ask.ts`(回答 schema 與 highlight)嚴格級,`npm run mutate` 的設定與範圍由驗收者定、分數附完整指令;`routing.ts` 維持原本的 95% 門檻。
6. **golden run**(硬規則 4、ADR-032):prompt 檔改了就要跑。**由協調者在主簽出跑**(`--live`,跑前跑後記 `llm-spend --today`),結果放 `packages/core/src/prompt-quality/golden-sets/` 同一層的日期資料夾與 `SCORES.md`,**顧問評分**。開發 worker 沒有金鑰,不跑。預估 6 組 × 約 2 回合,約 US$0.01。
7. `git diff --stat <基底>...<分支>` 只有 touches 列的檔加測試檔。`.feature` 0 行、`contracts/types.md` 0 行(契約已在規格批改好)。

## 受保護的檔

- 任何 `.feature`、`contracts/types.md` 與契約其他硬約定、`prompts/` 以外別資料夾的 prompt。
- `apps/teach-card/`(畫面是 T69)、`packages/ui-shared/`。
- `state/` 不新增任何檔、`config/` 的格式不動。
- `docs/02-decision-map.md`(ADR-086 已寫好)。

## 怎麼跑

```bash
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@teach-card and @phase-6 and not @manual" --format summary
VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/llm packages/core/src/teach packages/core/src/session packages/core/src/prompt-quality
npx tsc --noEmit
npm run check:steps
npm run boundaries
```

- 環境:`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`。cucumber 是重活,先跟協調者拿位子(i9)。
- 不跑完整 cucumber、不跑 `npm run check:all`、不跑變異、不跑 `--live`。
- 新增 `.ts` 要登記 `scripts/boundaries.owners.json`;新增 `scripts/*.ts` 要登記名冊(這張預期不新增)。

## 不在範圍

- 畫面(回答區塊、亮按鈕、追問按鈕):T69。
- 把問答存成檔案、跨卡的討論、自動跳卡(ADR-086 已否決)。
- 改 `deepen` 或 `teach.deepen` 的行為。
- 其他 task 的 token 上限。

## 顧問已定

(2026-11-25 顧問已定:`TASK_MAX_TOKENS['teach.ask']` = 1536、輪數 N = 4、`back` 不帶先備標題。無待定項。)

## 預算

`budget_usd: 4`。grok 不設花費上限,只記錄。LLM 真呼叫:worker 0 次;golden run 由協調者跑(約 US$0.01,算今日花費)。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
落點:`packages/core/src/llm/`、`packages/core/src/teach/`、`packages/core/src/session/`、`packages/core/prompts/teach/`、`packages/core/src/prompt-quality/`、`apps/desktop/src/webview/review-client.ts`(只加 `teachAsk()`)。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
