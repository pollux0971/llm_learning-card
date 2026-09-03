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
