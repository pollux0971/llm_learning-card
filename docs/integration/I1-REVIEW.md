# I1 整合驗收(審核 agent 最終驗收)

日期:2026-09-03
審核對象:commit 85f717c(runIngestPipeline 實作 + CloudRequiredError 統一)、
7edc7e1(log-min.ts → 01 的 log.ts)。
審核者:審核 session(非開發 agent)。

## 結論:**PASS**

runIngestPipeline() 真的把 phase-2 的 questions/children/deps 接進主流程,不是繞過;
CloudRequiredError 統一後兩處呼叫端都認得出來;log 寫入真的換成 01 的
`recordEvent()`(原子寫入 + schema)。過程中發現並修掉一個會擋住 I1 驗收的
step-definition 錯誤,以及把 `ingest.ts` 的 mutation score 從 40% 補到 100%
(原本沒有獨立門檻紀錄的技術債)。細節見下。

## 1. 邏輯核對(不是繞過)

- `packages/core/src/ingest/ingest.ts` 的 `runIngestPipeline()`:
  先跑 `runIngest()`(level 0),再依序呼叫 `generateQuestionsForCards()`、
  `generateChildrenForCards()`、`analyzeDependencies()`(phase-2 三步),
  讀寫的都是磁碟上真實的卡片檔(`loadWrittenCards()` 用 data-layer 的
  `validateCard()` 讀回,不是記憶體裡繼續傳遞候選物件)。子卡與依賴圖分析
  各自包在 try/catch,單獨失敗只記警告、不拖垮已完成的步驟——這行為現在有
  專門的測試覆蓋(見第 4 節)。
- `CloudRequiredError` 統一:`packages/core/src/llm/errors.ts` 是唯一定義,
  `fake-llm.ts` 改成 `export { CloudRequiredError }` 轉發同一個 class。
  `ingest.ts` 的 `isCloudRequiredError()` 改看 `err.code === 'CLOUD_REQUIRED'`
  這個契約 §7 路由表共用的值,不依賴 `instanceof`,兩處呼叫端(`runIngest()`
  內部的 catch、`scripts/ingest.ts` 的 probeOnline 分支)都認得出來。
  `scripts/ingest.ts` 的說明有一段沒跟著改,見第 3 節。
- `packages/core/src/llm/router.ts` 的 log 寫入:`createFileLogAppender()`
  改呼叫 `@core/schema/log.js` 的 `recordEvent()`(§10/§11b 的正式實作,
  `appendLineAtomic` 原子寫入)。`LogAppender` 的介面型別不變,
  `router-impl.ts` 只是轉發型別,呼叫端組裝的事件形狀沒變,不是表面接線。

## 2. 自動化測試

| 項目 | 結果 |
|---|---|
| `npm ci` | 成功(433 packages) |
| `npm run boundaries` | ✓ 無違規(154 檔案,3 條允許例外) |
| `npm run typecheck` | ✓ 無錯誤 |
| `npx vitest run` | ✓ 55 檔案、**822** 測試全過 |

## 3. Cucumber `@i1`(排除 `@manual`、`@llm`)

```
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@i1 and not @manual and not @llm"
74 scenarios (1 failed, 1 undefined, 72 passed)
295 steps (1 failed, 3 undefined, 1 skipped, 290 passed)
```

- **72 passed**。`i1-content-pipeline.feature` 本身 8 個場景扣掉 `@manual`
  一個、`@llm` 一個,剩 6 個全跑,其中 5 個過。
- **1 failed**:「Every standalone entry point still runs」,卡在
  `11-review-cli`(`scripts/review.ts` 找不到模組)。**這是 I2(review-cli)
  還沒實作的既有缺口,不是這輪 I1 改動造成的**——`git log --all` 查過
  `scripts/review.ts` 從未存在過。不擋這次驗收,但列出來讓下一輪知道
  standalone 全跑腳本目前對這一項一定紅。
- **1 undefined**:`docs/integration/i2-review-loop-headless.feature` 的
  「The content pipeline still works」場景,tag 是 `@regression @i1`
  (I2 對 I1 的回歸檢查),3 個步驟未實作——這是 I2 的範圍,I1 階段本來就
  該是 undefined,不是漏做。
- `@llm` 場景(「A person turns one article into a browsable card set」)
  需要真的雲端 API,這次沒有打——**列出但不擋**,依任務指示。

**過程中修掉的 bug**(屬於這輪 fa14c16「設計 + 寫測試不實作」留下的缺陷,
之前因為 `runIngestPipeline()` 丟 `not implemented` 提早失敗而沒被踩到,
這次實作完成後才第一次真的執行到):

`features/steps/i1-content-pipeline.steps.ts` 有兩個 step definition 宣告了
`{string}` 佔位符,但 handler 函式沒有對應的參數接它(只有 TS 專用、編譯後
會消失的 `this: LearningWorld`),造成 cucumber 丟出
`function has 0 arguments, should have 1...`:

- `Then('at least 3 cards exist under {string}', ...)`(line 290)
- `Then('cycle detection over {string} reports no cycles', ...)`(line 397,
  對應「The dependency graph is acyclic」場景)

已修成 `function (this: LearningWorld, _pathLabel: string)`(跟同檔案其他
step 一致的寫法,未使用的參數加底線前綴)。修完後「The dependency graph is
acyclic」場景真的跑過 `detectCycle()` + `checkPrereqConsistency()`,不再是
提早噴例外。

**Dry-run 全專案 ambiguous 檢查**:

```
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "not @manual" --dry-run
450 scenarios (187 undefined, 263 skipped)
```

`grep -i ambiguous` 對輸出是 0 筆命中——**0 ambiguous**。187 個 undefined
都是還沒開工的 wave/integration(I2 起、i7/i8 平台場景等),預期中的紅燈。

## 4. Mutation testing(Stryker)

### `packages/core/src/ingest/ingest.ts`

這個檔案過去只在「整個 `packages/core/src/ingest/**`」的複合分數下被間接
測過,從沒單獨量過——第一次獨立跑,分數是 **40.30%**,遠低於
02-ingest-pipeline 標準 80%。逐一補測試(不是刪代碼降門檻):

| 輪次 | 分數 | 補了什麼 |
|---|---|---|
| 初次 | 40.30% | — |
| +子卡/依賴圖整批失敗的 catch 測試、預設 category/today 推導測試 | 50.75% | `runIngestPipeline` 對 phase-2 三步失敗容錯的路徑之前完全沒測到 |
| +錯誤訊息內容斷言、CloudRequiredError 邊界(null/字串/typeof 不符但 code 對的函式)、parked 卡片流程、regenerate 事件、line 越界 clamp、example 圍欄格式 | 85.82% | `runIngest()`(phase-1 本體)本身的既有測試很薄,只測「有沒有寫卡」,沒測訊息內容、字數重試、parked 分支 |
| +守門條件的反向斷言(沒有 parked 卡時真的不寫 needs-review.json)、frontmatter trimEnd 精確斷言、ensureInitialized 副作用斷言 | 99.23% | 補齊剩下幾個條件分支與字串細節 |
| 最終 | **100.00%**(128 killed / 2 timeout,0 survived,0 no coverage) | `runIngestPipeline` 分類推導 fallback 的最後一個 NoCoverage 分支 |

兩處低價值/近乎等價的 mutant 用精確理由 disable,不是為了灌分數硬測:

- `mkdirSync(cardsDir, { recursive: true })`——`ensureInitialized()` 保證
  `outDir/cards` 已存在,category id 是單一識別字不含路徑分隔符,現在的骨架下
  `recursive:true/false` 沒有可觀察差異。
- `loadWrittenCards()` 內驗證失敗訊息的字串內容——那是「剛用 `writeCardFile()`
  寫出的卡片理論上一定通過同一份 `validateCard()`」的內部不變量守門,要測到
  得故意在寫入後、讀回前弄壞磁碟上的檔案,價值遠低於複雜度;`if` 條件本身
  (`!check.ok || !check.card`)沒被列為存活,只豁免訊息字串的 mutant。

新增的測試在 `packages/core/src/ingest/ingest.test.ts`(16→27 個測試)與
`packages/core/src/ingest/pipeline.test.ts`(4→9 個測試),全部針對真實行為
(錯誤訊息內容、parked 卡片寫入 needs-review.json、regenerate 事件記錄、
分類推導的三種邊界、CloudRequiredError 誤判防呆),不是湊 mutant 數字。

### `packages/core/src/llm/router-impl.ts`

開發 agent 回報 100%,獨立覆核一次:

```
File            |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
router-impl.ts  |    100 |     100 |       15 |         0 |          0 |        0 |       44 |
```

**確認無誤,獨立覆核結果一致,100%。**(59 個 mutant 中 44 個是 stryker 判定
的 invalid mutant/errors,不計入分母;15 個有效 mutant 全部 killed。)

## 5. 改動範圍(`git diff --stat main...HEAD`)

```
features/03-llm-router/FEATURE.md           |   2 +-
features/steps/_world.ts                    |   6 +
features/steps/i1-content-pipeline.steps.ts | 434 +++++++++++++++++
features/steps/ingest-pipeline.steps.ts     |  39 ++-
features/steps/ingest.steps.ts              |   3 +-
packages/core/src/ingest/fake-llm.ts        |  17 +-
packages/core/src/ingest/ingest.ts          | 128 +++++-
packages/core/src/ingest/pipeline.test.ts   | 260 +++++++++
packages/core/src/llm/index.ts              |   3 +-
packages/core/src/llm/log-min.test.ts       |  32 --
packages/core/src/llm/log-min.ts            |  17 --
packages/core/src/llm/router-impl.ts        |   2 +-
packages/core/src/llm/router.ts             |  12 +-
scripts/boundaries.allow.json               |   5 +
scripts/ingest.ts                           |  77 ++-
```

**沒有動到** `questions.ts` / `children.ts` / `deps.ts` / `graph.ts` /
`select.ts` / `transitions.ts` 的邏輯本身——這輪只接線,phase-2 的實作內容
不變,範圍合理。（審核過程中額外修改的 `ingest.test.ts` / `pipeline.test.ts`
/ `i1-content-pipeline.steps.ts` / `ingest.ts` 的兩個 disable 註解與一段
過時說明未列在上面這份 main...HEAD 的 diff 裡,因為還沒 commit——見下方
commit 清單。）

## 6. 這次審核順手修的東西

1. `features/steps/i1-content-pipeline.steps.ts`:兩個 step definition 的
   arity bug(見第 3 節),不修「The dependency graph is acyclic」場景會
   一直失敗。
2. `packages/core/src/ingest/ingest.ts` / `packages/core/src/ingest/pipeline.test.ts` /
   `packages/core/src/ingest/ingest.test.ts`:mutation score 40%→100% 的
   測試補強,兩個精確理由的 disable 註解。
3. `scripts/ingest.ts` 檔頭註解過時(還在講「`runIngestPipeline()` 目前是
   throw not implemented」「CloudRequiredError 認不出對方是已知不修的
   bug」——兩者都已經被這輪實作修掉了,舊註解會誤導下一個讀者),更新成
   反映現況。

## 7. 給下一輪的提醒

- `11-review-cli`(`scripts/review.ts`)不存在,`standalone.json` 的
  「Every standalone entry point still runs」場景會持續紅,直到 I2 把
  review-cli 生出來。
- `contracts/fixtures/llm/` 還沒有 `ingest.questions` / `ingest.deps` 的
  預錄回應,所以 `scripts/ingest.ts --fake` 路徑刻意只呼叫 `runIngest()`
  (level 0),沒接 `runIngestPipeline()`。要接上得先補這些 fixture。
- `@llm` 標的 e2e 場景(真的打雲端 API)這次沒跑,需要有網路與憑證時另外驗證。

---

# I1 `@e2e @llm` 真呼叫驗收(第四次)

日期:2026-09-04
執行者:協調者 session。
對象:main `4ba1663`(第四次真呼叫時的 HEAD)。
指令:

```bash
LLM_CLOUD_PROVIDER=openai LLM_CLOUD_MODEL=gpt-5.6-luna \
  npx tsx scripts/ingest.ts --file contracts/fixtures/raw/security-basics.md \
  --out ./learning --category security
```

跑之前清掉 `learning/cards` `learning/questions` `learning/graph`、`state/ingested.json`
重設為 `{}`、`state/log.jsonl` 另存;`raw/` 與 `config/` 未動。

## 結論:**PASS**,`@e2e @llm` 綠燈(由技術顧問覆核確認)

`@manual` 的「The cards read like one concept each」仍待使用者人工確認。

## 1. 場景逐條對照

`docs/integration/i1-content-pipeline.feature` 的 `@e2e @llm`
「A person turns one article into a browsable card set」:

| Then | 結果 |
|---|---|
| at least 3 cards exist under `cards/security/` | ✓ 25 張(`sec-0001`..`sec-0025`) |
| every card passes the data-layer validator | ✓ **25/25 OK**(`schema/cli.ts validate` 逐張) |
| every card has a question file with the same id | ✓ diff 空;考題另跑 `validate-question` **25/25 OK** |
| `graph/order-security.json` lists every card exactly once | ✓ 25 筆,無重複、無遺漏、無幽靈項 |
| the person can open any card in a markdown viewer and read it | 待人工(併入 `@manual` 一起問使用者) |

## 2. 產出統計

```
卡片        25 張          考題        25 份
deps.json   security: 25 nodes / 33 edges,DFS 驗過無環 (DAG)
order 檔    25 筆
llm_call    36 筆          tokens      38,287 (in+out)
warning     0 筆
事件分佈    { llm_call: 36, ingested: 1, cycle_removed: 3 }
```

CLI 印出單一卡片數(25),無失敗清單,退出碼 0。

## 3. 證據:本輪修的三個 bug 都在真資料上被驗到

前三次真呼叫連續發現三個 fake router 測不到的 bug。第四次的價值在於
**其中最難的那個真的在這次觸發了**,不是靠 fixture 推論。

### 3.1 依賴圖需要丟三條邊才無環(ADR-038 之前的邏輯會寫出矛盾狀態)

`state/log.jsonl` 的三筆 `cycle_removed`:

```
丟邊 1  ["sec-0007","sec-0022"]   category: security
丟邊 2  ["sec-0013","sec-0011"]   category: security
丟邊 3  ["sec-0014","sec-0011"]   category: security
```

丟邊 2 與 3 都指向 `sec-0011`,丟邊 1 完全獨立——**模型這次回的圖含多個獨立環**。

修復前的邏輯:第二次模型呼叫仍有環時只丟**一條**邊就寫 `graph/deps.json`,
而 order 檔因 `topologicalSort` 失敗而不寫。也就是說若無本輪修復,這次跑完
磁碟上會是「有環的 `deps.json` + 沒有 order 檔」的自相矛盾狀態,與第三次真呼叫
完全相同的災情。本地丟邊迴圈(丟到無環或達 `cards.length` 上限)正確處理。

### 3.2 考題失敗回報

第三次真呼叫:29 張卡但 `sec-0022` 缺考題,`log.jsonl` 零記錄、CLI 零輸出,
只能事後比對檔案數字才發現。本輪修復後失敗會逐筆寫 `warning`、CLI 印清單、
退出碼非 0。這次 **warning 真的是 0 筆**——是「有事會記而沒事發生」,不是
「根本沒在記」。

### 3.3 動態 maxTokens

`ingest.deps` 依卡片數算上限(前一輪合併)。25 張卡的依賴分析未再截斷。

## 4. 與前幾次的差異說明

卡片數 25 vs 前幾次 29/30 是模型輸出量的差異,**不是回歸**。`@e2e` 的判準是
「≥3 張卡 + 每張卡都有同 id 的考題 + order 齊全 + 全數通過驗證器」,四條皆滿足。
輸出量的穩定度由 `12-prompt-quality` 的 golden run 負責,不在 I1 判準內
(技術顧問確認)。

## 5. 本輪相關的 ADR 與 tag

| 項目 | 內容 |
|---|---|
| `i1-deps-cycle-and-question-reporting` | 本地丟邊迴圈、考題失敗回報、非確定性錯誤重試一次 |
| `ingest-cli-card-count` | CLI 不再連著印兩個矛盾的卡片數 |
| ADR-038 / `ADR-038-stale-graph-removal` | 丟邊達上限時移除該分類的過期圖資料(粒度是分類) |

`deps.ts` 與 `questions.ts` 兩個嚴格級模組的變異分數皆 **100.00%**。

## 6. 待決事項(審核 agent 在 `features/02-ingest-pipeline/REVIEW.md` §8.4 提出)

兩項 pre-existing、不在本輪範圍、實作檔未修改:

1. `deps.json` 損壞時 `JSON.parse` 會丟錯,蓋掉原本要記的 warning。
2. `atomicWriteJson()` 失敗時會留下 `.tmp` 殘檔,且不 fsync 目錄。

## 7. 人工確認:**兩條皆 PASS**

使用者將觀感判定授權給技術顧問 session(2026-09-04)。判定結果:

### 7.1 `@manual`「The cards read like one concept each」—— PASS

判定依據:讀 `sec-0003` / `sec-0012` / `sec-0021` 全文,另掃 25 張的標題與例子。
三張都是一句話一個概念;例子分別是網址對比、銀行表單與 fetch 兩個情境、
`fetch` 呼叫加回應標頭,皆非重述 body。

`sec-0021` 只有一個 example 不算問題——場景沒有規定數量,那一個例子就是最具體的形式。

### 7.2 `@e2e`「the person can open any card in a markdown viewer and read it」—— PASS

標準 YAML frontmatter + 短 body + ```example 圍欄,任何 viewer 都能開。
圍欄在通用 viewer 顯示為 code block,遞迴渲染是 **07 的渲染器**的責任
(契約 §2),不是 I1 的問題。`prereqs` 是 id 清單而非 wiki link,
所以 Obsidian 不會自動連出關聯圖——「讀得順」不含「連得起來」。

## 8. 驗收中發現、**不擋 I1** 的兩件事

### 8.1 子卡與主卡近乎重複(約 8/25 張)

四對:

| A | B |
|---|---|
| `sec-0007` 預檢請求 | `sec-0015` CORS 預檢請求 |
| `sec-0006` 帶憑證的跨來源請求 | `sec-0016` 攜帶憑證的 CORS |
| `sec-0003` 的例子之一 | `sec-0013` |
| `sec-0003` 的例子之二 | `sec-0014` |

單張看都合格,合起來是 25 張裡約 8 張在講重複的事。**影響**:之後每天的
複習量會被灌水。

**歸屬**:
1. **12-prompt-quality/phase-2** 的 golden 維度加「重複率」——`ingest.children`
   的 prompt 要求「子卡不得重述父卡或同層 level-0 卡」。改 `prompts/` 要跑
   golden run(硬規則 4)。
2. **09-lint** 之後加「近重複標題」檢查。

這是 12/phase-2 的 gate 解開後**第一件該做的事**。

### 8.2 level-0 卡把 level-1 子卡當 prereq

`sec-0003`(L0)的 `prereqs` 是 `sec-0011`(L1)。契約允許,但圖的形狀怪
(主卡依賴別人的子卡),教學順序會**先教子卡**。

**歸屬**:09-lint 的圖形狀檢查,或 `ingest.deps` 的 prompt 加約束。先記著。
