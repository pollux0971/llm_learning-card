---
id: T63
deps: []
touches: [packages/core/src/prompt-quality/golden-run.ts, packages/core/src/prompt-quality/cli.ts]
cpu: light
budget_usd: 1
status: dispatched
owner: worker-grok
must_catch:
  - golden 的預設 router 還是 LlmRouterImpl(沒有日上限) 預算那條必須紅
  - 雲端失敗時 golden 的 grade.apply 改走閘道(用了預設的備援表) 不走閘道那條必須紅
  - 備援表只把 golden 現在用的四個 task 設成 cloud-only,其他三個留預設 七個都是 cloud-only 那條必須紅
  - 預算用完時建了 golden 的輸出資料夾,或寫了 prompt 快照 預算那條必須紅(比輸出目錄前後)
  - 預算用完的 CLI 訊息超過一行、印堆疊、或退出碼不是 1 CLI 那條必須紅
  - probeLocal 去碰閘道 不碰閘道那條必須紅
  - llm_call 沒記進驗證過的帳本 既有的 ADR-050 與 ADR-066 那幾條必須紅
  - 動到 prompts 或 touches 以外的檔 不動的地方那條 diff 必須有輸出
---

# 工單 T63:live golden 有日上限,而且永遠不改走本機

> 狀態:起草 2026-10-27,依協調者 2026-10-27 轉顧問的交代(T62 起草時的 G1;做法照起草者第一個候選)。顧問 2026-10-27 准 `ebcb9b0`:D1–D4 照建議,工單內容不改;ADR-083 已寫進 `../02-decision-map.md`(見最後「顧問裁定」)。協調者直接合併並派測試 agent。規格:UI/Tauri 負責人(代筆)。編號 T63:協調者配的。
> 實作:worker(opencode + grok-4.7);紅測試:測試 agent;驗收:驗收 agent。LLM 真呼叫 0(不跑 live golden)。
> **排序**:T59 + T61 → T62 → **T63** → T60。落點 12,跟 T62(02)不相交,可以並行。要排在**下一次 live golden 之前**。
> **不改契約、不動 `prompts/`**(硬規則 4;這張只改 router 的接法,不改任何 prompt,所以不用 golden run)。決定記在 ADR-083。

## 煞車(協調者 2026-10-27)

T63 合併之前,要跑 live golden 一律先跑 `npx tsx scripts/llm-spend.ts --today`。**退出碼 1(已達上限)就不跑。**

## 為什麼有這張

`scripts/prompt-check.ts --live` → `packages/core/src/prompt-quality/cli.ts` → `runGoldenLive` → `createDefaultLiveRouter`(`packages/core/src/prompt-quality/golden-run.ts` 第 417 行):

- 帳本是驗證過的那本(T5 改過);
- 但 router 是 `new LlmRouterImpl`,`LLM_DAILY_CAP_USD` 擋不到。日上限只在 `GatewayLlmRouter` 裡。

live golden 會真的花錢(每次都打 OpenAI)。使用者定的規矩是當日花費超過 `LLM_DAILY_CAP_USD` 要問使用者,所以 golden 不能繞過它。

**不能直接換成 `createLiveGatewayRouter`。** 預設的備援表會讓 golden 用到的 `grade.apply` 在雲端失敗或預算用完時改走閘道,本機模型的輸出就混進 golden 了。起草時量過(下面 A)。

## 起草時量的

### A. 同一個 `GatewayLlmRouter`,兩種備援表(**量過**)

假的雲端 adapter、假的閘道 fetch(數呼叫次數)。不打網路、不寫檔。格子裡是結果、雲端被叫幾次、閘道被叫幾次。

| 情況 | 預設表:`grade.apply` | 七個都 `cloud-only`:`grade.apply` | 七個都 `cloud-only`:`ingest.cards` |
|---|---|---|---|
| 預算用完 | **走閘道**,provisional(雲端 0、閘道 2) | `BUDGET_EXCEEDED`(0、0) | `BUDGET_EXCEEDED`(0、0) |
| 雲端 5xx | **走閘道**,provisional(1、2) | `CLOUD_REQUIRED`(1、0) | `CLOUD_REQUIRED`(1、0) |
| 雲端逾時 | **走閘道**,provisional(1、2) | `CLOUD_REQUIRED`(1、0) | `CLOUD_REQUIRED`(1、0) |
| 離線 | **走閘道**,provisional(0、2) | `CLOUD_REQUIRED`(0、0) | `CLOUD_REQUIRED`(0、0) |
| 正常 | 雲端的結果(1、0) | 雲端的結果(1、0) | 雲端的結果(1、0) |

- 七個都 `cloud-only` 時,閘道在每一種情況都被叫 0 次;預算用完是在叫雲端**之前**就丟。
- `grade.fill.llm` 在 `cloud-only` 下一律 `CLOUD_REQUIRED`(底層路由表說它走本機,本機不可用,再被 `cloud-only` 擋下)。golden 沒有用到它;用到的話是大聲失敗,不是偷偷走本機。

### B. `createLiveGatewayRouter` 本來就收 `fallbackTable`

`LiveGatewayRouterOptions`(`packages/core/src/llm/router-gateway.ts` 第 171 行)繼承 `GatewayLlmRouterBaseOptions`,裡面就有 `fallbackTable`、`settings`、`localProber`。**03 不用改**,這張只動 12。

### C. golden 用到的 task

`packages/core/src/prompt-quality/golden-sets/registry.ts` 登記的:`ingest.cards` 4 組、`ingest.questions`、`ingest.deps`、`grade.apply` 各 1 組。

### D. 丟棄式實作跑既有測試

`packages/core/src/prompt-quality/`、`packages/core/src/llm/`、`scripts/prompt-check.test.ts`:1109 條紅 1 條,型別檢查 0 錯。紅的那條見「既有測試要改的」。量完 `git checkout` 還原。

## 要的結果

1. **golden 專用的備援表** `GOLDEN_FALLBACK_TABLE`(放 `golden-run.ts`):契約 §7 的七個 `LlmTask` **全部** `'cloud-only'`(D1),`Object.freeze`。
2. **`createDefaultLiveRouter` 改走 `createLiveGatewayRouter`**:
   - 帳本的解析與拒絕照舊(`resolveVerifiedLedger`,失敗丟錯、不建任何目錄)、照舊先建驗證過那本的 `state/`;
   - `createLiveGatewayRouter({ ledger, settings: readLlmSettings(settingsDir), fallbackTable: GOLDEN_FALLBACK_TABLE, localProber: 固定不可用 })`;
   - **`probeLocal()` 固定回 `{ available: false, models: [] }`,不碰閘道**(D3)。今天的 `localProber` 就是這個意思(T8 F)。`GatewayLlmRouter` 的 `probeLocal` 會去探閘道,所以**只包 `probeLocal` 這一個**;`call`、`probeOnline`、`budgetExhausted` 直接委派(`probeOnline` 本來就委派給底層的雲端探測,不碰閘道);
   - 回傳的 router 要能問「今天的預算用完了沒」(例如帶 `budgetExhausted()`)。
3. **`runGoldenLive` 在建任何目錄之前查預算**(D2):
   - 順序:`probeOnline()` 之後、讀 prompt 檔與 `mkdirSync` 之前;
   - router 有 `budgetExhausted` 而且回 `true` → 丟新的 `LiveRunBudgetExceededError(set)`。訊息一句話,含「今日預算已用完」與 `LLM_DAILY_CAP_USD`;
   - 注入的測試 router 沒有 `budgetExhausted` 的,照舊不查。
4. **`cli.ts`**:`LiveRunBudgetExceededError` 跟 `LiveRunOfflineError` 一樣處理(`✗` 加訊息、退出碼 1,第 286 行那一段)。

跑到一半預算用完(前幾個輸入做完了,下一個被拒):`router.call` 在叫雲端之前就丟 `DailyBudgetExceededError`,不花錢。但那次的輸出資料夾已經建了,會留下沒有 `meta.json` 的半套。這跟今天任何一次中途失敗一樣,這張不改(低優先小票清單)。

## 紅測試(測試 agent)

- **起 router 的方式**:照 `packages/core/src/prompt-quality/live-run.test.ts` 第 406 行那條。
  - `installFakeCloud` 換掉 `fetch`;
  - 暫存的指標檔與 `vault-id`;
  - `XDG_CONFIG_HOME`、`HOME` 指暫存目錄。
  不打網路、不碰真帳本。
- **預算**:上限 US$1(`LLM_DAILY_CAP_USD=1`),在驗證過的暫存帳本種一筆**今天**的 `provider: 'openai'` `llm_call`,金額照 `LLM_PRICE_IN_PER_M` / `LLM_PRICE_OUT_PER_M` 算到 US$1(`spent >= cap` 就算用完)。用預設 router 跑 `runGoldenLive`。
  - **更正(2026-10-27,測試 agent 在 T62 實測)**:原本寫「`LLM_DAILY_CAP_USD=0`,0 也算用完」是錯的。`packages/core/src/llm/spend.ts` 的 `isBudgetExhausted` 第一行是 `if (!(capUsd > 0)) return false;`:上限 0 是「**沒設上限**」,不是用完。
  - 斷言:
  - 丟 `LiveRunBudgetExceededError`;
  - 輸出目錄前後一樣(沒有建 set 的資料夾、沒有 `prompt.snapshot.md`);
  - 假雲端被叫 0 次。
- **不走閘道**:假雲端回 503,`GATEWAY_BASE_URL` 指到一個會記次數的假位址,`GATEWAY_API_KEY` 給假值。用預設 router 呼叫 `grade.apply`。斷言:
  - 丟 `CLOUD_REQUIRED`;
  - 閘道被叫 0 次。
- **七個都是 cloud-only**:`GOLDEN_FALLBACK_TABLE` 的鍵剛好是契約 §7 的七個 task,值全部是 `'cloud-only'`,而且凍結。
- **不碰閘道的 `probeLocal`**:同上的假閘道,`probeLocal()` 回不可用,閘道被叫 0 次。T8 F 那條(第 478 行)照舊綠。
- **CLI**:`cli.ts` 的 `main(argv)`,`--live`,預算用完。斷言:
  - 退出碼 1;
  - 輸出有 `✗` 與「今日預算已用完」;
  - 沒有以 `at ` 開頭的行。
- **既有測試要改的**(測試 agent 改,不是 worker):`live-run.test.ts` 第 526 行「ADR-066: 合成 worktree 的預設 router…」。
  - 它在子行程裡讀 `router.cloudRouter.log`,那是 `LlmRouterImpl` 的內部欄位。換成 `GatewayLlmRouter`(外面再包一層)之後讀不到,紅在「default router did not create a log appender」。
  - 改成走公開的路:子行程裡用假雲端真的 `call()` 一次,再看事件進了指標指向的那本、不在 worktree 也不在主簽出。斷言不放鬆。
- **拿掉 T62 守門的例外(測試 agent 做)**:T62 的工單(已在 main `aa33557`)規定,靜態守門(`scripts/` 與 `packages/` 的非測試檔不准直接 `new LlmRouterImpl(` 或 `new CloudLlmRouter(`)把 `packages/core/src/prompt-quality/golden-run.ts` 列為「T63 修好就拿掉」的例外。
  - 這張的紅測試由**測試 agent** 把這個例外拿掉。拿掉之後,守門在基底上紅在 `golden-run.ts` 那一處,這張的實作讓它轉綠。
  - 守門測試檔本身是 T62 的紅測試寫的。`aa33557` 只有工單,檔還沒進 main。測試 agent 寫 T63 紅測試時,那個檔還沒進 main 的話,就等它進了再拿;或寫 T62 守門時直接不加這個例外,看哪張的紅測試先寫(協調者排)。
  - 不管哪個順序,T62 與 T63 都合併之後,守門的例外清單裡**不再有 `golden-run.ts`**。驗收 agent 核對這一點。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 單元 | `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/prompt-quality/ packages/core/src/llm/ scripts/prompt-check.test.ts`,加上 T63 的新測試檔 | 全綠 |
| 場景 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@prompt-quality and not @manual and not @llm' --format summary` | 全綠(重活,拿位子) |
| fake golden | `npm run prompt:golden`(預設 `--fake`) | 退出碼 0;golden-fake 的輸出跟改之前一樣 |
| 守門 | `npm run typecheck`、`npm run boundaries` | 全過;例外條數不變(12 → 03 本來就有) |
| 變異 | `npm run mutate -- stryker.t63-golden-cap.json`(驗收 agent 加,`mutate` 放 `golden-run.ts` 改到的那幾行) | ≥ 80% |
| T62 守門 | T62 的靜態守門測試(T62 與 T63 都合併後) | 綠,而且例外清單裡沒有 `golden-run.ts` |
| 真資料 | `learning/` 前後量檔案數、整體雜湊、帳本行數 | 三項相同 |
| 不動的地方 | `git diff --stat <紅測試分支的 tip>..HEAD -- contracts docs prompts packages/core/prompts 'features/**/*.feature' packages/core/src/llm packages/core/src/prompt-quality/golden-sets packages/core/src/prompt-quality/fixtures scripts` | 沒有輸出 |

**不跑 live golden**:這張沒動 `prompts/`,硬規則 4 不觸發;LLM 0。

**改壞證明**(驗收 agent):

- `createDefaultLiveRouter` 改回 `new LlmRouterImpl` → 預算、不走閘道那幾條紅;
- 不傳 `fallbackTable`(用預設表) → 不走閘道那條紅;
- 預算檢查挪到 `mkdirSync` 之後 → 預算那條的「輸出目錄不變」紅;
- `probeLocal` 委派給 `GatewayLlmRouter` → 不碰閘道那條紅。

## 受保護的檔(開發 worker 不改)

- 測試、`features/**`、`.feature`、`contracts/`、`docs/`、**`prompts/` 與 `packages/core/prompts/`**。
- `packages/core/src/llm/`(B 量過,不用改)、golden 的登記表與 fixtures、`scripts/`。

## 落點

- `packages/core/src/prompt-quality/` → 12-prompt-quality。
- import:`@core/llm/index.js` 的 `createLiveGatewayRouter`、`FallbackGroup`(12 → 03,本來就有)。
- R2:跟 T59(03)、T61 與 T62(02)、T60(11、infra)都不相交。

## 顧問裁定(2026-10-27)

准 `ebcb9b0`,工單內容不改:

- **D1**:七個 task 全部 `cloud-only`。另外三個留預設的話,哪天新增 `deepen` 或 `reteach.short` 的 golden set,就會在雲端失敗時默默走本機。全部 `cloud-only` 等於「golden 永遠只量雲端」,一條規則。
- **D2**:預算在建目錄之前查。讓第一次 `call` 去丟,會在 `golden/`(進 git)留下一個只有 `prompt.snapshot.md` 的資料夾,跟「離線不留空目錄」的既有規矩衝突(`golden-run.ts` 第 329 行的註解)。
- **D3**:`probeLocal` 固定不可用、不碰閘道。`probeOnline` 本來就直接委派雲端的探測、不碰閘道,所以**只包 `probeLocal`**。
- **D4**:記 **ADR-083**,用工單裡的草稿。寫入前跑了取最大號(main `aa33557` 與這個分支都是 082)。→ `../02-decision-map.md` 最後一條。
- 「golden 中途失敗留半套資料夾」照記在下面的低優先小票清單。
- T62 守門的 `golden-run.ts` 例外由測試 agent 在這張拿掉(上面「紅測試」最後一條)。

## 低優先小票清單(協調者不另建清單檔,記在工單裡)

- **golden 跑到一半失敗會留半套資料夾**:不管是預算用完、雲端失敗還是其他錯,`runGoldenLive` 中途丟錯時,那次的輸出資料夾留著、沒有 `meta.json`。今天就有的行為。修法候選:先寫到暫存資料夾,全部做完再 rename 進 `golden/`。落點 12。

## 預算

`budget_usd: 1`(兩個檔、一個備援表、一個錯誤類別;grok 不設停止線,只記錄)。LLM 花費 0。`cpu: light`;cucumber 與變異是驗收的重活,協調者排位子。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,沒有 `.env`。基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 分支順序:main `d64b1d5` → 這張工單 → 測試 agent 的紅測試 → 開發 worker 的實作。
