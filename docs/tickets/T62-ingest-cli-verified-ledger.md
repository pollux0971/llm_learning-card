---
id: T62
deps: [T61]
touches: [scripts/ingest.ts, packages/core/src/ingest/ingest.ts]
cpu: light
budget_usd: 2
status: dispatched
owner: worker-grok
must_catch:
  - --file、掃描、--topic 任何一條還直接建 LlmRouterImpl 或 CloudLlmRouter 靜態守門必須紅
  - 帳本沒驗證過時 --file 還寫了任何檔(連骨架、分類、raw 複本都不行) 拒絕那條必須紅(比 --out 前後的樹)
  - 拒絕的訊息沒有 vault.ts init 與 show,或退出碼不是 2 拒絕那條必須紅
  - llm_call 事件記在 --out 那本,不是驗證過的那本 帳本位置那條必須紅
  - 只標 stale 的掃描、已經生成過的主題,因為沒有帳本就被拒絕 不花錢的路那兩條必須紅
  - 預算用完時印堆疊、寫了卡、或叫了雲端或閘道 預算那條必須紅
  - --fake 的行為變了 既有的 --fake 測試必須紅
  - 實作動到 touches 以外的檔 不動的地方那條 diff 必須有輸出
---

# 工單 T62:`scripts/ingest.ts` 的真呼叫改走驗證過的帳本與當日上限

> 狀態:起草 2026-10-27,依協調者 2026-10-27 轉顧問的交代:T61 的 F1 是**真的違反契約 §12(1.4.0)**,不是改契約,不用問使用者。顧問 2026-10-27 審過 `9b6b4a1`:准(D1–D3 照建議,D4 不記 ADR),改 3 處(見最後「顧問裁定」);改完由協調者直接合併,接在 T61 後面,不再送審。規格:UI/Tauri 負責人(代筆)。編號 T62:協調者配的。
> 實作:worker(opencode + grok-4.7);紅測試與步驟改寫:測試 agent;驗收:驗收 agent。LLM 真呼叫 0。
> **排序**:T59 + T61 → **T62(接 T61,同落點 02,R2,所以 `deps: [T61]`)** → T63 → T60。

## 煞車(顧問 2026-10-27)

**T62 合併之前,所有 agent 一律不准跑不帶 `--fake` 的 `scripts/ingest.ts`。** 量測也一樣。

例外只有一種(顧問准):測試或 CLI 要起不帶 `--fake` 的 ingest 時,下面三件**同時**成立才可以:

- (a) 帶 `features/steps/_fake-cloud.mjs`(換掉 `globalThis.fetch`);
- (b) 那個 worktree 沒有 `.env`(跑之前 `ls .env` 確認是 No such file);
- (c) 子行程的 `XDG_CONFIG_HOME` 與 `XDG_CACHE_HOME` 都指到暫存目錄。

主簽出有 `.env`,一律不在那裡跑。

## 為什麼有這張

契約 §12(`contracts/types.md` 第 422、425–426 行):

- 任何會花錢的程式,帳本先看明確參數可不可以,再看指標檔;
- 明確參數(`--out`、`learningDir`)可以改**輸出**位置,**不能改帳本位置**;
- 真的會花錢的呼叫,只接受經指標檔與標記驗證過的帳本。

`scripts/ingest.ts` 的真呼叫有兩個地方建 router,都沒照做:

| 路 | 地方 | 今天 |
|---|---|---|
| `--file` | 第 193 行 | `new LlmRouterImpl({ settings, logPath: join(absOut, 'state/log.jsonl') })` |
| 掃描 | 第 112 行 | 同上 |
| `--topic` | 走掃描那一條(`runIngestScan` 把 `opts.router` 交給 `generateFromTopic`) | 同上 |

所以今天跑 ingest:

- 花費記在 `--out` 那本,不是驗證過的那本。`--out` 不是真的帳本時,`scripts/llm-spend.ts` 看不到這筆錢。
- `LLM_DAILY_CAP_USD` 擋不到 ingest。日上限只在 `GatewayLlmRouter` 裡,`LlmRouterImpl` 沒有。ingest 又是最貴的 task。

T5 工單把「`--out` 是使用者每次明講的必要參數」列為不在範圍(同 ADR-051)。T5 的其他入口(`scripts/llm.ts`、`scripts/grade.ts`、`scripts/review.ts`、`scripts/review-sidecar.ts`)都改了,只有 ingest 沒改。顧問 2026-10-27 判定這是違反 §12。

## 起草時量的

### A. `createLiveGatewayRouter` 對 `ingest.*` 的行為(**量過,不用改**)

用真的 `GatewayLlmRouter`,假的雲端 adapter 與假的閘道 fetch(數呼叫次數)。不打網路、不寫檔。

| 情況 | `ingest.cards` / `ingest.questions` / `ingest.deps` | 雲端被叫 | 閘道被叫 | 對照:`deepen` |
|---|---|---|---|---|
| 預算用完 | `DailyBudgetExceededError`(`BUDGET_EXCEEDED`) | 0 | 0 | 走閘道,provisional |
| 雲端 5xx | `CloudRequiredError`(`CLOUD_REQUIRED`) | 1 | 0 | 走閘道,provisional |
| 雲端逾時 | `CloudRequiredError` | 1 | 0 | 走閘道,provisional |
| 雲端截斷 | `CloudRequiredError` | 1 | 0 | 走閘道,provisional |
| 離線 | `CloudRequiredError` | 0 | 0 | 走閘道,provisional |
| 正常 | 雲端的結果,`provisional: false` | 1 | 0 | 雲端的結果 |

結論:

- 預算用完,在叫雲端**之前**就丟錯;
- `ingest.*` 在任何情況都**不會改走閘道**,跟路由表(離線是 `CLOUD_REQUIRED`)與 ADR-039 一樣。router 這邊不用改。

**要改的在 ingest 這邊**:`runIngest` 的 `catch`(`packages/core/src/ingest/ingest.ts` 第 85–92 行)只認 `CLOUD_REQUIRED`。換成 `GatewayLlmRouter` 之後,預算用完的 `BUDGET_EXCEEDED` 會原樣往外丟:

- 單檔路徑:CLI 印堆疊;
- 掃描路徑:整個停下。

主題路徑不會:`topicCallFailed` 已經把它變成一句「主題生成失敗: 今日預算已用完…」。

### B. 會真呼叫模型的入口(**掃過 `scripts/` 與 `packages/` 的非測試檔**)

| 入口 | 建 router 的方式 | 帳本 | 日上限 |
|---|---|---|---|
| `scripts/llm.ts` 的呼叫 | `createLiveGatewayRouter` | 驗證過 | 有 |
| `scripts/llm.ts --probe` | `new GatewayLlmRouter()`(沒有帳本) | 不花錢 | 不適用 |
| `scripts/grade.ts` | `lazyVerifiedRouter` → `createLiveGatewayRouter` | 驗證過 | 有 |
| `scripts/review.ts`、`scripts/review-sidecar.ts`(桌面的深入與批改也走這條) | `createLiveGatewayRouter` | 驗證過 | 有 |
| **`scripts/ingest.ts`** 的 `--file`、掃描、`--topic` | `new LlmRouterImpl` | **`--out`** | **沒有** |
| **`scripts/prompt-check.ts --live`**(golden) | `createDefaultLiveRouter`(`packages/core/src/prompt-quality/golden-run.ts` 第 417 行)→ `new LlmRouterImpl` | 驗證過 | **沒有**(G1) |

- `apps/` 底下沒有自己建 router 的。
- `new CloudLlmRouter` 只出現在 `router-impl.ts` 內部。
- `new LlmRouterImpl` 除了上面兩個入口,只在 `router-gateway.ts` 內部(組合用)。

### C. 會起「不帶 `--fake` 的 CLI」的測試與步驟

| 檔 | 行 | 怎麼起 | T62 之後 |
|---|---|---|---|
| `features/steps/ingest-pipeline.steps.ts` | 751 | `_fake-cloud.mjs` + `--file` | 要建暫存指標檔與 `vault-id` |
| `features/steps/i2-review-loop.steps.ts` | 1034 | `_fake-cloud.mjs` + `--file` | **不用改**:`childEnv()`(第 394 行)已經把 `XDG_CONFIG_HOME` 指到有 `vault-id` 的暫存帳本(`setupVault`)(2026-10-27 測試 agent 實測更正) |
| `packages/core/src/ingest/t53-scan-buckets.test.ts` | 144 | 掃描,只標 stale,不碰網路 | **不能變**:不花錢的路不要帳本 |

`packages/core/src/ingest/` 其他起 CLI 的測試(`cli.test.ts`、`t53-cli.test.ts`、`t55-topic-cli.test.ts`、`t55-topic-failures.test.ts`)都帶 `--fake`。`ingest-category.test.ts` 在分類驗證就拒絕,走不到 router。`scripts/zero-input-roster.ts` 只用 `--fake`。

## 要的結果

1. **`scripts/ingest.ts` 的 `--file`**:
   - **順序**(顧問裁):
     1. 驗完參數與分類名(今天第 144–148 行那段);
     2. **`ensureInitialized` 之前**,用 `resolveVerifiedLedger(defaultVaultDeps())` 解析帳本;
     3. 沒驗證過 → 印 `resolved.message`(它本來就寫了 `npx tsx scripts/vault.ts init` 與 `show`)、退出碼 2。`--out` 一個位元組都不動(不建骨架、不建分類、不複製 raw);
     4. 驗證過 → **先把 `resolved.ledger` 留著**,照舊做 `ensureInitialized`、建分類、複製 raw;
     5. **router 還是建在今天建的位置**(第 193 行,`ensureInitialized` 之後):`createLiveGatewayRouter({ ledger: <留著的 ledger>, settings: readLlmSettings(absOut) })`。理由:`readLlmSettings(absOut)` 讀的 `config/settings.yaml` 要 `ensureInitialized` 之後才有。
   - 後面照舊:探測、`runIngestPipeline`。
2. **掃描與 `--topic`**:照 `scripts/grade.ts` 第 42 行的 `lazyVerifiedRouter`,**第一次** `probeOnline` 或 `call` 時才解析帳本,失敗印訊息、退出碼 2。所以這些不花錢的路沒有帳本照樣能跑:
   - 只標 stale / source_missing 的掃描;
   - 已經生成過的主題(T55:LLM 0、探測 0)。
3. **`--fake` 不變**:還是 `FakeLlmRouter`,不碰指標檔。
4. **`--out` 只決定卡片寫到哪**。`llm_call` 記在驗證過的帳本(`createLiveGatewayRouter` 本來就這樣)。`ingested`、`warning` 等 ingest 自己的事件照舊記在 `--out` 那本。兩者是同一個資料夾時(平常的用法),全在同一本。
5. **`runIngest` 接 `BUDGET_EXCEEDED`**:跟 `isCloudRequiredError` 一樣看 `code`,不看類別名。
   - 回 `fail('今日預算已用完(LLM_DAILY_CAP_USD),沒有寫任何卡', 1)`;
   - 一張都不寫,雲端與閘道都沒被叫(A 已量過:router 在叫雲端之前就丟)。
   - 掃描因此照樣處理下一個檔。下一個也會被拒,不花錢。
6. `scripts/ingest.ts` 不再 import `LlmRouterImpl`。檔頭那段說明(第 26 行起「不帶 --fake(預設):用 LlmRouterImpl…」)照實改寫。

## 紅測試(測試 agent)

- **煞車底下怎麼起 CLI**:紅測試是在**還沒修**的程式上跑。那時不帶 `--fake` 的 `scripts/ingest.ts` 還是 `LlmRouterImpl`,探測會真的打網路。所以每一個起 CLI 的測試都照上面「煞車」的 (a)(b)(c) 三件同時做。
- **靜態守門**(建議 `features/support/t62-live-router-guard.test.ts`):`scripts/` 與 `packages/` 的非測試檔,用語法樹找 `new LlmRouterImpl(` 與 `new CloudLlmRouter(`。只准出現在:
  - `packages/core/src/llm/router-gateway.ts`、`packages/core/src/llm/router-impl.ts`(組合);
  - `packages/core/src/prompt-quality/golden-run.ts`:G1 的例外。守門裡的理由要寫「**T63 修好就拿掉**」(T63 把 golden 改走 `createLiveGatewayRouter`)。
  今天紅在 `scripts/ingest.ts` 的兩處。附合成的壞樣本。
- **拒絕**(`--file`,空的 `XDG_CONFIG_HOME`):
  - 退出碼 2;
  - 輸出有 `vault.ts init` 與 `vault.ts show`;
  - `--out` 的樹前後一樣(不存在就還是不存在);
  - 假雲端被叫 0 次(`_fake-cloud.mjs` 要多一個記次數的開關,測試 agent 加)。
- **帳本位置**:暫存指標檔指到帳本 A(照 `scripts/review-router.test.ts` 第 80 行的 `xdgPointingAt`),`--out` 是另一個資料夾 B,`_fake-cloud.mjs` 正常回應。斷言:
  - A 的 `state/log.jsonl` 有 `llm_call`;
  - B 的 `state/log.jsonl` 沒有 `llm_call`;
  - 卡在 B。
- **不花錢的路不用帳本**:
  - 只標 stale 的掃描:`t53-scan-buckets.test.ts` 第 144 行那條,不改,要還是綠;
  - 已經生成過的主題,不帶 `--fake`、空的 `XDG_CONFIG_HOME`:退出碼 0、印「已經生成過」。
- **預算**:指標指到暫存帳本,上限 US$1(`LLM_DAILY_CAP_USD=1`),在那本驗證過的暫存帳本種一筆**今天**的 `provider: 'openai'` `llm_call`,金額照 `LLM_PRICE_IN_PER_M` / `LLM_PRICE_OUT_PER_M` 算到 US$1(`spent >= cap` 就算用完)。
  - **更正(2026-10-27,測試 agent 實測)**:原本寫「`LLM_DAILY_CAP_USD=0`,0 也算用完」是錯的。`packages/core/src/llm/spend.ts` 的 `isBudgetExhausted` 第一行是 `if (!(capUsd > 0)) return false;`:上限 0 是「**沒設上限**」,不是用完。
  - 斷言:
  - `--file`:退出碼 1、訊息有「今日預算已用完」、沒有以 `at ` 開頭的行、`cards/` 沒有卡、假雲端被叫 0 次;
  - 掃描兩個新檔:兩個都在失敗清單,沒有一個停下整個掃描。
- **步驟改寫**:只有 `features/steps/ingest-pipeline.steps.ts` 第 751 行的 CLI 步驟要補暫存指標檔。`features/steps/i2-review-loop.steps.ts` 第 1034 行**不用改**:`childEnv()` 已經把 XDG 指到有 `vault-id` 的暫存帳本(更正,同上)。
  - 子行程加暫存的 `XDG_CONFIG_HOME`,指標指到那次的 `--out` 資料夾,並在那裡寫對應的 `config/vault-id`;
  - 指到同一個資料夾,原本對那本 log 的斷言就不用改;
  - 建法照 `xdgPointingAt`。
- **`runIngest` 單元**:假 router 丟 `DailyBudgetExceededError` → 回 `ok: false`、`exitCode: 1`、訊息有「今日預算已用完」、`cards/` 與 `state/` 不變。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 單元 | `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/ packages/core/src/llm/`,加上 T62 的新測試檔 | 全綠 |
| 場景 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@ingest-pipeline and not @manual and not @llm' --format summary`;`--tags '@i1 and not @manual and not @llm and not @e2e'`;`--tags '@integration and @i2 and not @manual and not @e2e'` | 全綠(重活,拿位子;在沒有 `.env` 的 worktree) |
| 守門 | `npm run typecheck`、`npm run boundaries` | 全過;例外條數不變(02 → 03 本來就有) |
| 變異 | `npm run mutate -- stryker.t62-ingest-ledger.json`(驗收 agent 加,`mutate` 放 `ingest.ts` 新加的那幾行) | ≥ 80%;`scripts/ingest.ts` 是 CLI 入口,由上面的 CLI 測試守,不跑變異 |
| 不靠機器的指標檔 | **在 i9**,用 `XDG_CONFIG_HOME=$(mktemp -d)` 包住整個測試行程,跑:T62 的新測試;`packages/core/src/ingest/` 裡起 CLI 的測試;那兩個改寫過的步驟所在的 tag(`@ingest-pipeline and not @manual and not @llm`、`@integration and @i2 and not @manual and not @e2e`) | 全綠。外面的 `XDG_CONFIG_HOME` 是空的暫存目錄,忘了自己指 XDG 的測試就讀不到指標檔、會被拒絕而紅。所以全綠代表每一條都自己指了(重活,拿位子) |
| 帳本沒被汙染 | 在 i9 照平常的環境跑 `npm run check:test-ledger`(`scripts/check-ledger-pollution.ts`:整套 vitest 前後比帳本行數) | `PASS`。`UNKNOWN` 不算過(重活,拿位子) |
| 真資料 | `learning/` 前後量檔案數、整體雜湊、帳本行數 | 三項相同。帳本行數**一定**要相同:這張的測試一筆都不准寫進真的帳本 |
| 不動的地方 | `git diff --stat <紅測試分支的 tip>..HEAD -- contracts docs prompts packages/core/prompts 'features/**/*.feature' packages/core/src/llm packages/core/src/prompt-quality packages/core/src/ingest/scan.ts packages/core/src/ingest/topic.ts scripts/grade.ts scripts/review.ts scripts/llm.ts` | 沒有輸出 |

**改壞證明**(驗收 agent):

- `--file` 改回 `new LlmRouterImpl` → 靜態守門、拒絕、帳本位置三條紅;
- 解析帳本挪到 `ensureInitialized` 之後 → 拒絕那條的「`--out` 不變」紅;
- 掃描改成一開始就解析帳本 → 「只標 stale」那條紅;
- 拿掉 `BUDGET_EXCEEDED` 那個分支 → 預算那兩條紅。

## 受保護的檔(開發 worker 不改)

- 測試、`features/**`(含 `_fake-cloud.mjs`)、`.feature`、`contracts/`、`docs/`。
- `packages/core/src/llm/`(router 不用改,A 量過)、`packages/core/src/prompt-quality/`(G1 另開)、`scan.ts`、`topic.ts`、其他 `scripts/`。

## 落點

- `scripts/ingest.ts`、`packages/core/src/ingest/` → 02-ingest-pipeline。
- import:`scripts/ingest.ts` 改 import `packages/core/src/llm/index.js` 的 `createLiveGatewayRouter`、`resolveVerifiedLedger`、`defaultVaultDeps`(02 → 03,`scripts/boundaries.allow.json` 本來就有)。
- R2:跟 T61 同落點 02,所以 `deps: [T61]`,接在 T61 後面。跟 T59(03)、T60(11、infra)不相交。

## 顧問裁定(2026-10-27)

審 `9b6b4a1`:准。D1–D3 照建議,D4 不記 ADR。改 3 處:

1. `--file` 的順序寫清楚:帳本在 `ensureInitialized` 之前解析(拒絕時 `--out` 不動);router 還是建在今天建的位置(`ensureInitialized` 之後,因為 `readLlmSettings(absOut)` 讀的 `settings.yaml` 要那之後才有)。→「要的結果」第 1 點、改壞證明。
2. 防汙染真帳本:T62 之後,不帶 `--fake` 起 ingest 的測試只要忘了指 `XDG_CONFIG_HOME`,就會讀到那台機器的指標檔(筆電上是使用者的真帳本;i9 是空的 `~/lc-empty-learning`)。驗收加兩條:i9 用空的 `XDG_CONFIG_HOME` 包住整個測試行程跑一次;另跑一次 `scripts/check-ledger-pollution.ts`。→ 驗收條件。
3. 靜態守門的例外 `golden-run.ts` 附註「T63 修好就拿掉」。→ 紅測試的靜態守門。

煞車跑法也准了:(a)(b)(c) 三件同時成立;主簽出一律不跑。→「煞車」一節。

原本的四個選項,留著當紀錄:

- **D1(准)**:`--file` 一開始就解析帳本,掃描與 `--topic` 用到才解析。
  - `--file` 今天本來就一定會探測雲端,一開始解析可以做到「拒絕時 `--out` 一個位元組都不動」;
  - 掃描與主題有不花錢的路(只標 stale、主題已經生成過)。§12 說不涉及花費的讀取不受影響,所以要等真的要呼叫模型才解析(`scripts/grade.ts` 同樣做法)。三條都一開始解析的話,只標 stale 的掃描沒有帳本就跑不了。
- **D2(准)**:帳本沒驗證過,退出碼 2,跟 `scripts/llm.ts`、`scripts/grade.ts`、`scripts/review.ts` 一樣。ingest 其他失敗照舊是 1。
- **D3(准)**:模型設定照舊讀 `--out` 的 `config/settings.yaml`(環境變數優先)。帳本與設定可以來自不同資料夾。
- **D4(准,不記 ADR)**:照 §12 與 T5 已經定的做法補上漏掉的入口,沒有新的取捨。

## 另開(不在範圍)

- **G1:live golden 沒有日上限。** `scripts/prompt-check.ts --live` 走 `createDefaultLiveRouter`(`golden-run.ts` 第 417 行)。帳本是驗證過的(T5 改過),但 router 是 `LlmRouterImpl`,`LLM_DAILY_CAP_USD` 擋不到。
  - **不能直接換成 `createLiveGatewayRouter`**:golden 有 `grade.apply`,預設的備援表會在雲端失敗時改走閘道,本機模型的輸出就混進 golden 了。
  - 做法候選:注入 `fallbackTable`,把 golden 用到的 task 都設成 `cloud-only`(golden 用到 `ingest.cards`、`ingest.questions`、`ingest.deps`、`grade.apply`,沒有 `grade.fill.llm`)。或跑之前先查 `budgetExhausted()`。
  - → **T63**(`T63-golden-live-daily-cap.md`,落點 12,可以跟 T62 並行,排在下一次 live golden 之前)。在 T63 之前,live golden 跑之前一律先跑 `npx tsx scripts/llm-spend.ts --today`,退出碼 1 就不跑。
- **F1:管線跑到一半預算用完**。第 0 層的卡寫了,考題、子卡、依賴圖那幾次呼叫被拒(不花錢),各自記成失敗或 warning,CLI 照今天的規則以 1 結束(有卡沒考題)。這張不改這個行為。
- **T5 工單**那句「`scripts/ingest.ts` 的 `--out` 不在範圍」:由這張取代。舊工單不改(歷史紀錄)。

## 預算

`budget_usd: 2`(一個 CLI 入口、一個 `catch` 分支;grok 不設停止線,只記錄)。LLM 花費 0。`cpu: light`;cucumber 與變異是驗收的重活,協調者排位子。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,**不能有 `.env`**。基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 分支順序:main(T61 合併之後)→ 這張工單 → 測試 agent 的紅測試 → 開發 worker 的實作。
