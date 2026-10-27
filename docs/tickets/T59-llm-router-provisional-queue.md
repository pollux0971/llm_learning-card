---
id: T59
deps: []
touches: [packages/core/src/llm/provisional-queue.ts, packages/core/src/llm/index.ts]
cpu: light
budget_usd: 2
status: todo
owner: worker-grok
must_catch:
  - 雲端給的結果也放進佇列(provisional 是 false 也放) 場景 2 必須紅
  - grade.fill.llm 走本機(provisional 是 false)也放進佇列 本機但不暫定那條必須紅
  - 同一張卡同一個 task 放兩次變成兩筆,或留下舊的時間 場景 3 必須紅
  - 少記 task、card、時間、本機結果雜湊、prompt 任何一個 場景 1 與場景 4 必須紅
  - 雜湊不是本機結果 text 的 sha256 雜湊那條必須紅
  - 離線時 drain 回傳東西,或改了佇列檔 場景 5 必須紅(比檔案位元組)
  - drain 把項目拿掉(在線時呼叫兩次,第二次少了) 只讀那條必須紅
  - resolve 沒刪那一筆、沒記 provisional_resolved、或 changed 記錯 場景 6 必須紅
  - 壞檔被刪掉或覆蓋(沒留備份)、沒重建、沒記 warning 場景 7 必須紅
  - 合法 JSON 但形狀不對的檔沒當成壞檔 形狀不對那條必須紅
  - 佇列只存在記憶體(新的實例讀不到) 場景 8 必須紅
  - 寫佇列檔沒走 writeFileAtomic 原子寫入那條必須紅
  - 包裝的 router 改了回傳值(text、provider、provisional 任何一個) 原樣回傳那條必須紅
  - 實作動到 touches 以外的檔 不動的地方那條 diff 必須有輸出
  - provisional-queue.ts 變異分數低於 80%
---

# 工單 T59:03-llm-router phase-3——provisional 佇列

> 狀態:起草 2026-10-27,依協調者 2026-10-27 的交代(T58 已合 main `d64b1d5`)。規格:UI/Tauri 負責人(代筆)。編號 T59:協調者配的。
> 實作:worker(opencode + grok-4.7);紅測試與步驟定義:測試 agent(不是起草的人);驗收(含變異):驗收 agent。
> 對象:`features/03-llm-router/phase-3.feature`(8 個場景,tag `@i6 @llm-router @phase-3`,沒有 `@manual`)。
> **不改契約。** §7 的 `LlmTask` 與路由表一格都不動;§10 已經有 `provisional_resolved` 事件;§12 已經列了 `state/provisional-queue.json`。LLM 真呼叫 0。

## 可以開工嗎:可以

- **gate**:`features/03-llm-router/NEXT.md` 寫 phase-3 只要 phase-2 `done`(2026-09-03)。契約 gate 由 ADR-039 解除。兩項都打勾了。
- **本機結果從哪來**:phase-4 的 `GatewayLlmRouter`(`packages/core/src/llm/router-gateway.ts`)已經合進 main。它在雲端失敗、預算用完、離線時改走閘道,回 `provisional: true`。phase-4 的狀態是 `blocked`,但只差閘道真連線那一條 `@manual`,程式與自動場景都驗收過了。phase-3 用的是它已經合進 main 的程式,不等那條 `@manual`。
- **要不要真的閘道**:**8 個場景都不用**。「本機回的結果」用假的閘道 client 做:注入 `GatewayLlmRouter` 的 `gateway` 選項,或照 phase-4 換掉 `globalThis.fetch` 的做法。「網路在不在」用注入的 `probeOnline`。所以閘道機器(`localhost:8787`)沒起來、`GATEWAY_API_KEY` 沒進 `.env`,都不擋這張。
- **需要真機的 `@manual`**:這張 0 條(`.feature` 本來就沒有)。真的有呼叫端接上佇列之後(見 D1),那張工單再加一條真閘道的觀察:`LLM_DAILY_CAP_USD=0` 讓預算一開始就算用完,呼叫走閘道、標 provisional、佇列多一筆,OpenAI 花費 0。`spend.ts` 的 `readDailyCapUsd` 吃 0(非負數就可以)。那條要等使用者把閘道起起來。

## 為什麼有這張

契約 §7 說離線時 `deepen`、`grade.apply`、`reteach.short` 可以走本機,但結果是暫定的(`provisional=true`),之後要拿雲端再對一次。今天只有「標暫定」這一半:

- `GatewayLlmRouter` 會回 `provisional: true`;
- `gradeApply` 把 grader 記成 `local-provisional`(`packages/core/src/grading/grade-apply.ts` 第 229 行);
- 深入產的卡在 frontmatter 標 `provisional: true`(`packages/core/src/ingest/deepen.ts` 第 133 行)。

「之後再對一次」要的東西沒有地方放:那次的 prompt、當時本機回了什麼。`state/provisional-queue.json` 在契約 §12 裡有名字,程式裡一行都沒有。05-grading phase-3、09-lint phase-2、I6 的場景都寫「它進了 provisional 佇列」,都在等這張。

## 要的結果

### 1. 新檔 `packages/core/src/llm/provisional-queue.ts`

**一筆項目**(`ProvisionalEntry`):

| 欄位 | 型別 | 說明 |
|---|---|---|
| `task` | `LlmTask` | 實際上只會是 `deepen`、`grade.apply`、`reteach.short`(只有它們會回 provisional) |
| `card` | `CardId` | 用契約 §1 的 `CardIdSchema` 驗 |
| `queued_at` | 字串 | ISO 8601,含時區 |
| `local_sha256` | 字串 | 本機結果 `text` 的 sha256(UTF-8,小寫十六進位) |
| `prompt` | 字串 | 原本的 prompt,重放用 |

**檔案**:`<learningDir>/state/provisional-queue.json`,內容是項目的 JSON 陣列,依 `queued_at` 由舊到新。讀檔用 zod 驗。寫檔一律走 `@core/schema/atomic-write.js` 的 `writeFileAtomic`(§11b)。

**API**(名字 worker 可以調,行為照這張表):

| 呼叫 | 做什麼 |
|---|---|
| `provisionalQueuePath(learningDir)` | 回 `<learningDir>/state/provisional-queue.json` |
| `new ProvisionalQueue({ path, log, now? })` | `log` 是 `LogAppender`(`packages/core/src/llm/router.ts`),`now` 預設 `new Date().toISOString()` |
| `enqueue({ task, card, prompt, localText })` | 同一個 `card` + `task` 已經有一筆:拿掉舊的,把新的放到最後(`queued_at` 是新的,prompt 與雜湊也換新的)。沒有就加在最後。 |
| `list()` | 回目前所有項目(複本),不寫檔 |
| `drain(isOnline)` | `isOnline` 是 `() => Promise<boolean>`。在線:回所有項目(複本,含 prompt)。離線:回空陣列,**連檔都不讀**。兩種都**不寫檔**(D2)。 |
| `resolve({ card, task }, { cloudText, changed })` | 有那一筆:拿掉、寫檔、記一筆 `provisional_resolved` 事件(下面)、回 `true`。沒有:不寫、不記、回 `false`。 |

**事件**:

- `provisional_resolved`:`{ ts, type: 'provisional_resolved', card, task, changed, local_sha256, cloud_sha256 }`。`changed` 是呼叫端給的(D3);`cloud_sha256` 是 `cloudText` 的 sha256,留著對帳。
- 壞檔的 warning:`{ ts, type: 'warning', reason: 'provisional_queue_corrupt', backup: <備份檔名,不含路徑> }`。

**壞檔**(場景 7,D4):`enqueue`、`list`、`resolve`,以及在線的 `drain`,讀檔時遇到下面兩種,就做三件事:

- 不是合法 JSON;
- 是合法 JSON,但 zod 驗不過(形狀不對)。

三件事:

1. 把原檔 `rename` 成 `provisional-queue.json.corrupt-<UTC 時間,例如 20261027T093000Z>`,同一個資料夾;
2. 寫一個空陣列 `[]` 當新的佇列;
3. 記上面那筆 warning。

然後照常做原本那件事。檔不存在 = 空佇列,不是壞檔,不記 warning。

**包裝 router**(場景 1、2、3、7,D1):

```ts
recordProvisional(inner: LlmRouter, queue: ProvisionalQueue, card: CardId): LlmRouter
```

- `call()` 委派給 `inner`。回來的結果 `provisional === true` 才 `enqueue({ task, card, prompt, localText: result.text })`。
- 回傳值**原樣**交回去,一個欄位都不改。
- `inner` 丟錯就原樣往外丟,不放進佇列。
- `probeOnline`、`probeLocal` 直接委派。

`deepen.ts` 裡的 `stoppingRouter` 就是同一種包法。

### 2. `packages/core/src/llm/index.ts`

匯出上面那些,給 05-grading phase-3、09-lint phase-2 之後用。

### 3. 紅測試與步驟(測試 agent)

- **步驟**:建議放 `features/steps/llm-router-phase3.steps.ts`。8 個場景都用真的 `GatewayLlmRouter`,外面套 `recordProvisional`。閘道用假的(注入 `gateway`,或照 phase-4 換 `globalThis.fetch`);雲端用注入的 adapter 丟 5xx 讓它備援,或注入 `spendReader` 讓預算用完。學習資料夾用暫存目錄。
- **注意**:假 fetch 的裝卸要掛在 `Before/After({ tags: '@llm-router and @phase-3' })`。只寫 `@phase-3` 會碰到別的功能的場景(phase-4 的 FEATURE.md 寫過同一個陷阱)。
- **場景怎麼對**:

| 場景 | 怎麼做 | 斷言 |
|---|---|---|
| 1 本機結果進佇列 | `deepen`,雲端丟 5xx → 走閘道 | 佇列 1 筆,`task`、`card`、`queued_at`、`local_sha256` 都對;雜湊等於假閘道回的 text 的 sha256 |
| 2 雲端結果不進 | `deepen`,雲端正常 | 佇列檔的位元組不變(不存在就還是不存在) |
| 3 同卡同 task 一筆 | 先放一筆 `grade.apply`,再對同一張卡本機批改一次 | 還是 1 筆;`queued_at` 是新的;prompt 是第二次的 |
| 4 drain 帶 prompt | 放三筆,在線 | 回 3 筆,每筆的 prompt 等於當初那次呼叫的 prompt |
| 5 離線 drain | 放三筆,離線 | 回 0 筆;佇列檔位元組不變 |
| 6 resolve | 放一筆,`resolve` 給 `changed: true`(另一條 `false`) | 佇列 0 筆;log 多一筆 `provisional_resolved`,`changed` 等於給的值 |
| 7 壞檔 | 佇列檔寫成 `{not json`,再做一次會進佇列的本機呼叫 | 備份檔存在、內容逐位元組等於原本的壞內容;佇列剛好 1 筆(這一次的);log 多一筆 warning |
| 8 重開 | 放三筆,另建一個 `ProvisionalQueue` 讀同一個路徑 | 3 筆,內容一樣 |

場景 7 的「重建成空的」:讀成空佇列,再放進這一次的那一筆,所以之後剛好 1 筆、沒有舊的。這是起草者的解讀,寫在這裡讓顧問看。

- **另外的單元測試**(建議 `packages/core/src/llm/provisional-queue.test.ts`):
  - 本機但不暫定(`grade.fill.llm`,`provisional: false`)不進佇列;
  - 在線時 `drain` 兩次,第二次一樣 3 筆(只讀);
  - 合法 JSON 但形狀不對(例如少 `prompt`)也當壞檔;
  - `resolve` 找不到那一筆回 `false`,佇列檔與 log 都不變;
  - 寫檔經過 `writeFileAtomic`(spy,照 `packages/core/src/ingest/t55-topic-generation.test.ts` 第 341 行那條的做法);
  - 包裝 router 回傳的 `text`、`provider`、`model`、`provisional` 跟 `inner` 一樣;
  - `inner` 丟錯時佇列不變。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 單元 | `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/llm/` | 全綠 |
| 場景 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@llm-router and @phase-3' --format summary` | 8 個場景全過(重活,拿位子) |
| 不退步 | `--tags '@llm-router and not @manual'`;`--tags '@grading and not @manual and not @llm'` | 全綠(重活) |
| 守門 | `npm run typecheck`、`npm run boundaries` | 全過;例外條數不變(03 → 01 本來就有) |
| 變異 | `npm run mutate -- stryker.t59-provisional-queue.json`(驗收 agent 加,`mutate` 放 `packages/core/src/llm/provisional-queue.ts`) | ≥ 80%(03 的標準門檻;`routing.ts` 的 95% 不受影響,這張不碰它) |
| 真資料 | `learning/` 前後量檔案數、整體雜湊、帳本行數 | 三項相同(這張的測試全部用暫存目錄) |
| 不動的地方 | `git diff --stat <紅測試分支的 tip>..HEAD -- contracts docs prompts packages/core/prompts 'features/**/*.feature' packages/core/src/llm/routing.ts packages/core/src/llm/router.ts packages/core/src/llm/router-impl.ts packages/core/src/llm/router-gateway.ts packages/core/src/llm/fallback.ts packages/core/src/grading packages/core/src/ingest scripts` | 沒有輸出 |

**改壞證明**(驗收 agent,每條:改了哪裡、哪一條紅、訊息原文、還原後綠):

- 包裝 router 不看 `provisional` 一律放 → 場景 2 紅;
- `enqueue` 不去重 → 場景 3 紅;
- `drain` 回傳後清空檔案 → 只讀那條紅;
- 離線 `drain` 也回項目 → 場景 5 紅;
- 壞檔直接覆蓋(不備份) → 場景 7 紅;
- 寫檔改用 `writeFileSync` → 原子寫入那條紅;
- 只放記憶體、不寫檔 → 場景 8 紅。

## 受保護的檔(開發 worker 不改)

- 測試、步驟、`.feature`、`contracts/`、`docs/`。
- `routing.ts`(嚴格 95%)、`router.ts`、`router-impl.ts`、`router-gateway.ts`、`fallback.ts`、`spend.ts`:這張**只用組合**,不改它們一行(跟 phase-2 包 phase-1、phase-4 包 phase-2 一樣)。
- 05-grading、02-ingest、07 的程式:這張不接呼叫端(D1)。

## 落點

- `packages/core/src/llm/` → 03-llm-router(`scripts/boundaries.owners.json`)。
- import:`@core/schema/atomic-write.js`、`@core/schema/log.js`(03 → 01,`scripts/boundaries.allow.json` 本來就有)、`@contracts/index.js`(一律放行)。
- R2:只有 03-llm-router 一個落點,跟 T60、T61 不相交。

## 待顧問決定

- **D1:誰把結果放進佇列。**
  - **乙(建議)**:這張只做佇列與 `recordProvisional` 包裝。呼叫端知道自己在處理哪張卡,由它包:
    - `grade.apply` 與 `reteach.short` → 05-grading phase-3(它的場景本來就寫「enters the provisional queue」);
    - `deepen` → 另開一張小票(落點 02 或 07)。
    理由:不改 §7 的 `call()` 簽章;這張留在 03 一個落點,不跟 T61(02)搶 R2。
  - **甲**:`call()` 的 `opts` 加 `card?: CardId`(§7 函式簽章,軟約定),由 `createLiveGatewayRouter` 做出來的 router 自己放。缺點:今天的呼叫端(`gradeApply`、`generateDeepen`)都沒有傳卡片 id,不傳就放不進去,要嘛靜默漏掉、要嘛丟錯;要補就得改 05、02 的程式。
- **D2:`drain` 只讀。** 只有 `resolve` 會拿掉項目。理由:複審跑到一半當掉時,還沒對完的不會消失。另一種是 `drain` 就拿走,當掉就丟了。建議只讀。
- **D3:`changed` 由呼叫端給。** `.feature` 開頭寫「這個 phase 只管佇列;對完要怎麼辦歸 grading 與 lint」。比雜湊不可行:`grade.apply` 回的是 JSON,本機與雲端的字幾乎一定不同,但「過或沒過」可能一樣。所以「結果有沒有變」只有呼叫端知道。佇列只把兩邊的雜湊都記下來。
- **D4:壞檔。** 備份名用 `.corrupt-<UTC 時間>`;合法 JSON 但形狀不對也算壞;每一種讀都檢查。repo 裡沒有現成的備份命名慣例(起草時 grep 過)。
- **D5:檔案格式不寫進契約。** 只有 03 讀寫這個檔,其他功能只透過 API(跟 02 的 `ingested.json`、`needs-review.json` 一樣,契約只列檔名)。要寫進契約的話是改 §12(硬約定),要問使用者。建議不寫。

## 觀察(給顧問看,不在範圍)

- **F1:兩個行程同時寫**。桌面的側車與 lint CLI 同時開時,讀改寫會蓋掉對方。這張不加鎖,跟 `reviews.json` 在 T26 之前一樣。之後 09-lint phase-2 真的會同時開時再看要不要比照 T26 的樂觀檢查。
- **F2:深入一次會叫好幾次 `deepen`**。子卡清單、每張的字數重試、每張的考題,都是 `deepen`。用「卡片 + task」當鍵,同一張父卡的好幾次呼叫只會留最後一次。09-lint phase-2 對卡片是「從來源重生」,不是重放 prompt,所以影響不大;要接 deepen 的那張小票再決定。

## 預算

`budget_usd: 2`(一個新檔、一個匯出;grok 不設停止線,只記錄)。LLM 花費 0。`cpu: light`;cucumber 與變異是驗收的重活,協調者排位子。

## 測試誰寫

- 步驟定義、單元測試:測試 agent。改壞證明與變異:驗收 agent。開發 worker 以紅測試分支為基底,不改測試。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 分支順序(由下往上):main `d64b1d5` → 這張工單 → 測試 agent 的紅測試 → 開發 worker 的實作。
- 完成後 `features/03-llm-router/FEATURE.md` 的 phase 表改 `done`、`NEXT.md` 改「已完成」:協調者做,不是 worker。

## 起草時查的(只讀)

- 佇列在程式裡 0 行(`provisional-queue`、`ProvisionalQueue`、`provisional_resolved` 只出現在契約與一個 ledger 測試的排除清單)。`features/steps/` 沒有 phase-3 的步驟。
- 會花錢的 router 全部從 `createLiveGatewayRouter`(`packages/core/src/llm/router-gateway.ts` 第 176 行)出來:`scripts/review.ts`、`scripts/grade.ts`、`scripts/review-sidecar.ts`、`scripts/llm.ts`。
- `gradeApply` 呼叫 `router.call('grade.apply', …)` 時沒有卡片 id(`packages/core/src/grading/grade-apply.ts` 第 199 行);`deepen.ts` 已經有一個包 router 的 `stoppingRouter`(第 51 行)。
- 03 → 01 的 import 例外本來就有;repo 裡沒有現成的壞檔備份命名慣例。
