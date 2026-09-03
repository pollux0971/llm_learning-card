# REVIEW — 02-ingest-pipeline/phase-2 驗收(考題、level 1 子卡、依賴圖)

審核對象:commit `06dd2cd`(`packages/core/src/ingest/{questions,children,deps}.ts`
與 `packages/core/prompts/ingest/{questions,children,deps}.md`)。標準級模組
(契約 §3 §7 §8 的落地),變異門檻 80%(軟目標)。

worktree 確認:

```
$ pwd
/home/pollux/orca/workspaces/llm_learning-cards/02-ingest-pipeline-phase2
$ git branch --show-current
pollux0971/02-ingest-pipeline-phase2
```

## 1. 邏輯對照 9 個場景

逐一讀 `phase-2.feature`、三份實作、對應 `.test.ts`,重點看三個邊界情況:

- **「cycle 被挑戰一次、第二次還循環就丟掉那條邊」**(Scenario 6):`deps.ts` 的
  `analyzeDependencies()` 只在第一次 `detectCycle` 為真時重試一次,第二次不論
  結果如何都不再呼叫模型;丟的邊是 `detectCycle` 回傳 path 的最後一段
  `[path[len-2], path[len-1]]`。既有測試(`calls the model a second time`、
  `does not call the model a second time when...no cycle`、
  `drops the offending edge and logs cycle_removed`、
  `reports no removed edge...when the second attempt resolves`)四個方向都覆蓋到,
  邏輯與測試一致。
- **「只重排受影響的 category」**(Scenario 8):`writeCategoryGraph()` 只替換
  `deps.json` 裡呼叫者指定的 `category` 這個 key,`computeAndSaveCategoryOrder`
  是 01 的既有函式、本來就只寫 `order-<category>.json`。既有測試
  `does not touch another category order file or its deps.json entry` 直接驗證
  另一個分類的檔案位元組不變,覆蓋到位。
- **「單卡失敗不影響其他卡」**(Scenario 9):`generateQuestionsForCards()` 用
  try/catch 逐張處理、失敗記進 `failures`(附 card id)不中斷迴圈;`children.ts`
  的 `generateChildrenForCards()` 轉發 `questions.ts` 的失敗收集,不重新發明一套。
  既有測試涵蓋兩邊(第三張失敗、子卡第二張的考題失敗)。

三處邏輯與 9 個場景(不含 `@manual`)都對得上,沒有發現隱藏的邏輯缺陷。

## 2. 標準檢查

```
npm ci
npm run boundaries    # ✓ 掃描 153 個檔案,無違規
npm run typecheck     # ✓ 無錯誤
npm test               # ✓ 779/779 passed(vitest,全專案)
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@ingest-pipeline and @phase-2 and not @manual"
                        # ✓ 9 scenarios (9 passed), 52 steps (52 passed)
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "not @manual" --dry-run
                        # ✓ 0 ambiguous(213 undefined 都是尚未實作的未來 wave/整合場景,如 docs/integration/i8-windows.feature)
```

## 3. golden run(ADR-032,硬規則第 4 條)

開發 agent 的 commit message 聲稱「`npm run prompt:golden` 已跑過,現有
`grade.apply` 基準無回歸;三個新 prompt 尚未登記進 golden registry」。查證:

- `packages/core/src/prompt-quality/golden-sets/registry.ts` 目前只登記
  `grade.apply` 一個 self-test 任務,`ingest.questions` / `ingest.cards`(子卡共用)
  / `ingest.deps` 都還沒有 golden set——實測 `npm run prompt:golden -- --fake`
  只跑了 `grade.apply` 一個任務,確認新 prompt 目前不在 golden run 的量測範圍內。
- 但這不是 phase-2 的疏漏:`docs/02-decision-map.md` 的「待決事項」表明列
  「golden 評分的維度與規模 | I2 前 | 12-prompt-quality/phase-2」,是刻意留給
  另一個模組的決策,02 不越界改動 registry 屬於正確做法。
- 結論:golden run 這條硬規則**有跑**(避免了「改 prompt 沒跑就 commit」這個
  唯一會靜默毀掉品質的操作),但三個新 prompt 的品質目前**沒有量測工具在看**,
  只能靠 cucumber 場景(結構性檢查)與人工閱讀 prompt 內容把關。等
  12-prompt-quality/phase-2 決定 golden 的維度與規模後,應該回來把
  `ingest.questions` / `ingest.cards` / `ingest.deps` 登記進 registry——這是待辦,
  不是本次驗收的阻塞項。

## 4. Stryker 變異測試

```
npx stryker run --mutate "packages/core/src/ingest/questions.ts,packages/core/src/ingest/children.ts,packages/core/src/ingest/deps.ts,!packages/core/src/ingest/**/*.test.ts"
```

初次結果:**45.56%**(77 killed / 72 survived / 20 no-coverage,error 78 個是
TypeScript checker 擋下的編譯錯誤,不計入分數分母),遠低於 80% 目標。

### 4.1 存活變異分類與處理

逐一分類,不接受「等價變異」隨口帶過:

**真的漏測 → 補測試(大宗)**

- **三個模組送給 LLM router 的 prompt 內容完全沒被斷言過**——只驗證「router 被
  呼叫」,沒驗證 prompt 裡真的帶了 template、card/parent id、title、category、
  cards 清單、分隔線 `---`。三個檔案各補一個「prompt 內容」測試,連分隔線的
  出現次數與空行位置都用 `toContain('\n\n...')` 精確斷言(不能只用陣列
  `toContain` 判斷有沒有出現,那樣兩個 `'---'` 只要活一個就會被誤判成殺死)。
- **`deps.ts` 重試時附上的循環路徑說明**同樣沒測過內容,補了兩個測試驗證
  `之前的回應形成循環,不能再回同一條路徑:` 這段訊息真的出現、路徑用
  `' -> '` 串接、且第一次呼叫(沒有循環)不會誤帶這段文字。
- **`fetchEdges()` 的兩種模型回應錯誤路徑(JSON 解析失敗、回應缺 `edges` 陣列)
  完全沒有測試觸發過**(NoCoverage)——`deps.test.ts` 新增
  `describe('when the model response for ingest.deps is malformed')`,兩個案例
  各自驗證丟出的錯誤訊息。
- **`children.ts` 的 `parseChildCandidates()`**:合法 JSON 但不是陣列的情況
  (NoCoverage)、單筆候選缺欄位的錯誤訊息(NoCoverage,含索引數字)都沒測過,
  各補一個測試。子卡數量的上下界(`>` vs `>=`)原本只測了 0 個(失敗)跟 4 個
  (失敗),沒測剛好 1 個、剛好 3 個(邊界情況最有價值,見下),都補上。
- **`questions.ts` 的兩個 throw 測試**原本只用 `.rejects.toThrow()`(不管訊息
  內容),JSON 解析失敗跟 validateQuestionFile 失敗會丟出不同訊息,但兩種
  mutant(拿掉 catch 內容、清空錯誤訊息字串)都被這種鬆散斷言蓋過去——收緊成
  `.rejects.toThrow('不是合法 JSON')` / `.rejects.toThrow('未通過 validateQuestionFile')`。
  另外多驗證多筆 validator 錯誤用 `'; '` 串接。
- **`deps.ts` 的 `mergeEdges()` 去重**跟 **`prereqsByCardOf()` 的去重**是兩層
  互相遮蔽的防線——先補的測試只斷言最終寫回卡片的 `prereqs`,`mergeEdges` 壞了
  也測不出來(因為 `prereqsByCardOf` 那層還會再擋一次)。改成直接檢查
  `result.graph.edges` 裡指定 `[from, to]` 只出現一次,才真的測到 `mergeEdges`
  本身。
- **`writeUpdatedPrereqs()` 的 `same` 判斷**(`stored.length === computed.length
  && stored.every(...)`)原本的測試要嘛長度就不同、要嘛完全一樣,沒有「長度
  相同但內容不同」跟「部分重疊」兩種情況——`every` 被改成 `some` 在完全不重疊
  時結果剛好一樣,測不出差異,補了一個「長度相同、共用一個 id 但不完全一樣」
  的案例才真的分得出 `every` 跟 `some`。
- **`writeUpdatedPrereqs()` 的「已經一致就不寫檔」分支**只驗證過某一張卡
  「有沒有出現在 `cardsUpdated`」,沒驗證整個陣列(包含完全沒有先備關係的卡
  也不該進 `cardsUpdated`)——收緊成 `toEqual([])`,順便測到 `computed` 的
  `?? []` fallback。
- **循環丟邊的判斷是 `from === offending[0] && to === offending[1]`**
  (deps.ts:219)——`&&` 被改成 `||`,或只保留其中一半條件,三種 mutant 都存活,
  因為既有的循環測試只有 3 張卡,丟掉的邊剛好是圖裡唯一同時符合兩個條件的邊,
  分不出差異。加了 5 張卡的版本:一條邊跟 offending 共用 `from`(不同 `to`)、
  一條邊共用 `to`(不同 `from`),驗證兩條「只符合一半條件」的邊都不會被
  誤刪,才真正證明判斷是「兩個條件都要符合」。
- **`writeCardFile()`**(`children.ts`、`deps.ts` 各自一份,結構相同):
  `.trimEnd()`/`.trimStart()`、`e.trim()`、example 圍欄字面量、`'\n\n'` join
  分隔線這些 mutant 之所以存活,是因為既有測試的 `examples` 都是空陣列——
  callback 本體從沒被呼叫過(NoCoverage),連 `.trimEnd()` 前後有沒有多一行都
  沒人看。補了帶內容(含前後空白)、帶兩個 example 的案例,並且用正則
  精確比對「`---` 關閉後緊接內容、不留空行」「body 後面隔一行才接例句區塊」
  「沒有 example 時不留下多餘的圍欄或空白」三種形狀。

**邊界情況(依 skill 規範優先處理)**

上面「子卡數量剛好 1、剛好 3」「先備長度相同但部分重疊」「丟邊判斷共用單一
端點」三組都是邊界案例,已併入上面「真的漏測」逐項列出,不重複列。

**等價變異 → `// Stryker disable next-line all: <理由>`(3 處)**

| 位置 | 變異 | 理由 |
|---|---|---|
| 三個檔案模組頂層 `const XXX_TEMPLATE = loadPromptTemplate('...')` | `StringLiteral`:模板檔名清空 | 模組載入時執行一次的靜態初始化,`coverageAnalysis: perTest` 下 `coveredBy` 恆為空(不歸屬任何測試)。錯字會讓 `readFileSync` 在 import 當下就丟 `ENOENT`、整個測試檔案載入失敗,等同被所有測試殺死,只是 Stryker 的 per-test 歸因模型算不出來(用手動套用同款 mutant 實測驗證過:9/11 個 `analyzeDependencies` 測試確實會失敗)。 |
| `deps.ts` `writeUpdatedPrereqs()` 內 `card.frontmatter.prereqs ?? []` | `LogicalOperator`:`??` 改 `&&` | `card.frontmatter` 的型別是 `CardFrontmatterSchema`(`z.infer` 輸出),`prereqs` 是 `.optional().default([])`,輸出型別永遠是 `CardId[]`、不可能是 `undefined`——在型別保證成立的前提下,`??` 跟 `&&` 對這個欄位行為相同。 |
| `deps.ts` `buildDepsPrompt()` 內 `if (cyclePath && cyclePath.length > 0)` | `EqualityOperator`/`ConditionalExpression`:`length > 0` 的邊界 | `cyclePath` 只會是 `undefined`(第一次呼叫)或 `detectCycle` 回傳、`hasCycle` 為 `true` 時的 `path`——graph.ts 的不變量保證這種 `path` 頭尾是同一張卡,長度必定 ≥ 2,不可能是空陣列,`length > 0` 恆真、不可達 `false` 分支。 |
| `deps.ts` `prereqsByCardOf()` 內 `if (!list.includes(from)) list.push(from)` | `ConditionalExpression`:強制 `true` | `prereqsByCardOf()` 只被 `writeUpdatedPrereqs()` 呼叫,傳入的 `graph.edges` 一定先跑過 `mergeEdges()`——`mergeEdges` 已經保證同一個 `[from, to]` 不會出現兩次,所以同一個 `to` 底下不可能收到兩次相同的 `from`,這個 `includes` 檢查在目前唯一呼叫路徑下永遠是 `true`,是防呆而非可達分支。 |

**死程式**:沒有發現。

**方法論提醒**:過程中發現 Stryker 的 `coverageAnalysis: "perTest"` 對這個
codebase 的部分 mutant 有假陰性——手動套用同一款 mutant(`deps.ts` 兩處
`ConditionalExpression`)直接跑 `vitest`,測試確實會失敗,但 Stryker 官方跑法
回報「Survived」。懷疑跟 `tsx` 的 ESM transform 在 async/await 邊界上的
instrumentation 歸因有關。這次沒有因為報告寫 Survived 就照單全收去補多餘測試,
而是手動驗證過才分類。

### 4.2 意外發現:committed 原始碼有一個 null byte

驗證過程中 `git diff` 把 `deps.ts` 顯示成 binary diff。查證後發現
`mergeEdges()` 裡 `` const key = `${from}\x00${to}`; `` 這行的分隔字元不是空白
`' '`,是一個真正的 null byte(`\x00`)——用 `git show 06dd2cd:...` 確認這個
null byte**在開發 agent 的原始 commit 就存在**(上一輪的骨架 commit
`44b620b` 沒有,是 phase-2 實作時混進去的,大概是產生程式碼的過程中的編碼
瑕疵)。功能上無害(字串內含 `\x00` 一樣能當 Set/Map key,去重邏輯本身沒壞),
但會讓 `git diff`、`git blame -L` 等以行為單位的工具在這個檔案上失效。已在這次
審核中換成正常空白字元一併修正,修完重跑過一次 Stryker 確認分數不受影響。

### 4.3 改動清單

- `packages/core/src/ingest/questions.ts` — 加 1 個等價變異 disable 註解
- `packages/core/src/ingest/questions.test.ts` — 收緊 2 個既有斷言、新增 3 個測試
- `packages/core/src/ingest/children.ts` — 加 1 個等價變異 disable 註解
- `packages/core/src/ingest/children.test.ts` — 收緊 2 個既有斷言、新增 9 個測試
- `packages/core/src/ingest/deps.ts` — 加 3 個等價變異 disable 註解、修正
  `mergeEdges()` 的 null byte 錯字
- `packages/core/src/ingest/deps.test.ts` — 收緊/擴充 3 個既有測試、新增 9 個測試

### 4.4 最終結果

```
npx stryker run --mutate "packages/core/src/ingest/questions.ts,packages/core/src/ingest/children.ts,packages/core/src/ingest/deps.ts,!packages/core/src/ingest/**/*.test.ts"
```

- **變異分數:100.00%**(門檻 80%,級別:標準)
  - `children.ts`:100.00%(49 killed,0 survived)
  - `deps.ts`:100.00%(81 killed,0 survived)
  - `questions.ts`:100.00%(28 killed,0 survived)
- 改動後重跑 `npm test`(779/779)、`npm run typecheck`、`npm run boundaries`、
  cucumber `@ingest-pipeline @phase-2`(9/9)全過。

## 5. 判定

**PASS**。

- 邏輯對照 9 個場景(含三個指定的邊界情況)無缺陷。
- boundaries / typecheck / test / cucumber(phase-2 場景 + 全專案 dry-run 0
  ambiguous)全過。
- golden run 已跑,grade.apply 基準無回歸;三個新 prompt 尚未進 golden
  registry 是 02-decision-map.md 記錄在案、指定給 12-prompt-quality/phase-2
  的待決事項,不是本 phase 的疏漏,但列為後續待辦。
- Stryker 標準門檻(80%)原本未達(45.56%),逐一分類存活變異(補測試為主、
  3 處記理由的等價變異、0 處死程式)後達到 **100%**,並在過程中順手修正一個
  committed 原始碼裡的 null byte 瑕疵。

### 後續待辦(不阻塞本次 PASS)

- 等 12-prompt-quality/phase-2 決定 golden 評分維度後,把 `ingest.questions` /
  `ingest.cards` / `ingest.deps` 登記進 `golden-sets/registry.ts`。

---

## 6. deps.ts 動態 maxTokens 驗收(commit `87e37c8`)

審核對象:`packages/core/src/ingest/deps.ts` 的 `computeDepsMaxTokens()` 與
`analyzeDependencies()` 兩處 `router.call('ingest.deps', ...)` 呼叫點。標準級
模組,變異門檻 80%。

worktree 確認:

```
$ pwd
/home/pollux/orca/workspaces/llm_learning-cards/deps-token-scaling
$ git branch --show-current
pollux0971/deps-token-scaling
```

### 6.1 邏輯對照

背景 bug:`ingest.deps` 原本吃固定 2048 token 上限,卡片數量一多回應被截斷,
依賴圖分析整段被跳過。修法:`computeDepsMaxTokens(cardCount)` 算出
`clamp(2048, cardCount*256, 16384)`,在 `analyzeDependencies()` 開頭只算一次
(`maxTokens = computeDepsMaxTokens(cards.length)`),兩次 `fetchEdges()` 呼叫
(第一次、cycle 偵測到後的重試那次)都吃同一個 `maxTokens`、都真的傳進
`router.call(..., { maxTokens })` 的 opts——不是只改了第一次呼叫、重試那次還
留著舊值這種投機取巧。讀原始碼(`deps.ts:219-229`)確認兩個呼叫點的
`maxTokens` 是同一個變數,不是各自重算或其中一個漏改。

`deps.test.ts` 邊界測試:

- `computeDepsMaxTokens`:3 張卡(2048,下限)、0 張卡(2048,下限)、30 張卡
  (7680,精確值非只驗證範圍)、50 張卡(12800)、1000 張卡(16384,上限)。
- `analyzeDependencies`:`passes a maxTokens computed from the card count into
  router.call opts`(30 張卡場景,一般路徑)、`passes a maxTokens near the
  2048 floor for a small category`(3 張卡)、`passes the same computed
  maxTokens into both the first call and the cycle-retry call`——這一個直接
  用真的循環邊集(3 張卡構成 A→B→C→A)逼出 cycle-retry 分支,斷言
  `optsCalls[0].maxTokens === optsCalls[1].maxTokens === computeDepsMaxTokens(3)`,
  是這次驗收的關鍵測試,確認兩次呼叫真的帶同一個算出來的值,不是巧合相等。

邏輯是真的實作,不是投機取巧。

### 6.2 標準檢查

```
npm ci            → 433 packages,無錯誤(僅既有 EBADENGINE / deprecated 警告)
npm run boundaries → 掃描 173 個檔案,✓ 無違規
npm run typecheck  → 無輸出,0 錯誤
npx vitest run     → 64 test files, 950 tests 全過
```

### 6.3 Stryker

```
npx stryker run --mutate "packages/core/src/ingest/deps.ts,!packages/core/src/ingest/deps.test.ts"
```

**變異分數:100.00%**(門檻 80%,級別:標準)。118 個變異點,85 killed +
33 errors(視為 killed)、0 survived、0 timeout、0 no coverage。不需要處理
存活變異(沒有存活的)。

### 6.4 Cucumber dry-run

```
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "not @manual" --dry-run
```

452 scenarios(164 undefined、288 skipped)、**0 ambiguous**。undefined 的
164 個是既有的、尚未實作的未來 integration 場景(I8 Windows 等),跟這次改動
無關,不影響判定。

### 6.5 判定

**PASS**。

- `computeDepsMaxTokens()` 公式與邊界測試(3/0/30/50/1000)精確值全對。
- `analyzeDependencies()` 兩次 `router.call`(含 cycle 重試)都真的帶上同一個
  算出來的 `maxTokens`,有測試直接鎖住這個不變量,不是巧合或投機取巧。
- boundaries / typecheck / vitest(950/950)/ Stryker(**100.00%**,遠高於
  80% 門檻,0 survived)/ cucumber dry-run(0 ambiguous)全過。
- 沒有發現需要處理的存活變異、沒有邏輯缺陷、沒有新增的技術債。

---

## 7. 循環本地修復 + 考題失敗回報審核輪(commit `0184f54` / `b9cd4b8` / `a4b6437` / `9b982b9`)

審核對象是「真的跑一次 OpenAI 呼叫才浮出來、fake router 測不到」的兩個 bug:

1. 依賴圖有多個獨立循環時,舊邏輯只丟一條邊就寫 `graph/deps.json`,order 檔卻因
   `topologicalSort()` 丟錯而沒寫,磁碟留下自相矛盾的狀態。
2. 考題產生失敗完全沒有 log、CLI 沒印、退出碼還是 0,靜默失敗(真跑時 sec-0022
   少了考題檔,只能事後數檔案才發現)。

### 7.1 補完兩個永遠紅燈的步驟定義

上一輪測試 agent 在 `features/steps/ingest-pipeline.steps.ts` 留了兩個註解裡自己
承認未完成的步驟,讓 phase-2 的 `Generation failure for one card does not lose the
others` 恆紅。這一輪補完:

**`When('the run completes')`** 從只跑 `generateQuestionsForCards()` 改成跑完整的
`runIngestPipeline()`。考題失敗的 warning 依 `questions.ts` 的介面契約是
pipeline 的責任(批次函式只把失敗收進 `failures`,不寫 log),不跑到那一層就永遠
驗不到真東西。`runIngestPipeline()` 是從 raw 檔開始跑的,所以這個 When 另開一個
乾淨的 learning 目錄(Background 手寫的五張卡只用來讓 Given 算出「第三張卡」的
id);新目錄的 level 0 編號一樣從 `sec-0001` 起算,步驟裡用一個 `assert.deepEqual`
把這個耦合寫死,對不上就當場紅。

**`Then('the command prints the failed card and exits with a non-zero status')`**
從一句無條件的 `assert.fail()` 改成真的用 `this.runCommand()` spawn
`scripts/ingest.ts`,斷言輸出含失敗卡片 id、退出碼非 0、失敗那張卡沒有考題檔、
其餘卡片都有。

CLI 沒有注入 router 的縫(它自己 `new LlmRouterImpl(...)`),而參數解析、複製
raw、印出清單、退出碼正是這一句要驗的東西,不能繞過去。所以改在**最外層的網路
邊界**造假:新增 `features/steps/_fake-cloud.mjs`,子程序用
`npx tsx --import ./features/steps/_fake-cloud.mjs` 啟動,只換掉
`globalThis.fetch`——`LlmRouterImpl` / `CloudLlmRouter` / `anthropicAdapter` /
Anthropic SDK 全部跑真的,整個測試不打真網路。副檔名刻意用 `.mjs`,
`cucumber.js` 的 `import: ['features/steps/**/*.ts']` 不會把它載進 cucumber 自己的
程序(載進去的話,覆寫 fetch 的副作用會汙染所有場景)。

**兩個步驟都做過反向驗證**,不是「補到綠就算」:

| 故意弄壞 | 結果 |
|---|---|
| `scripts/ingest.ts` 的 `if (result.hasQuestionFailures)` 改成恆假 | 該場景紅(退出碼斷言失敗) |
| `ingest.ts` 裡逐筆寫 warning 的迴圈改成不跑 | 該場景紅(warning 斷言失敗) |

另外把 `a warning naming the third card and the reason is in the log` 加強成
真的檢查「and the reason」:除了 card id,還斷言 warning 訊息含
`questionFailures` 裡那筆的完整 error 字串。

### 7.2 實作品質審核

| 檢查項 | 結果 |
|---|---|
| 丟邊是確定性的 | ✅ `detectCycle()` 的 `buildAdjacency()` 只照 `nodes`/`edges` 的陣列順序建鄰接表,`Map`/`Set` 只做成員查詢不決定走訪順序;`removeCyclesLocally()` 用 `Array.filter()` 保留其餘邊的相對順序,沒有排序、沒有物件 key 迭代 |
| 上限是 `cards.length` | ✅ `removeCyclesLocally({ nodes, edges }, cards.length)`,不是寫死的小數字 |
| 達上限時 deps.json **與** order 檔都不寫 | ✅ `repaired.unresolved` 非 null 時 early return,`writeCategoryGraph` / `writeUpdatedPrereqs` / `computeAndSaveCategoryOrder` 三個全部跳過 |
| 每丟一條邊各自一筆 `cycle_removed` | ✅ 格式 `{ts, type, category, edge}`,契約 §10 的 `LogEvent` 允許額外欄位 |
| 達上限的 warning 含殘留環路徑 | ✅ `unresolved.join(' -> ')`,`file` 欄位是 `graph/deps.json` |
| 重試只針對非確定性錯誤 | ✅ `try` 區塊只包 `router.call()` 那一行,JSON parse 與 `validateQuestionFile` 天然在重試範圍外 |
| 只重試一次 | ✅ 沒有迴圈,第二次不管成敗都往外丟 |
| 網路層判斷夠窄 | ✅ `NETWORK_ERROR_PATTERN` 只認 `fetch failed` / `ECONNRESET` / … ,同時比對 `err.message` 與 `err.cause.code`;模型自己回報的失敗(`model unavailable for this card`)不命中,已補測試釘住 |
| 每筆考題失敗各一筆 warning(level 0 + 子卡) | ✅ `[...questions.failures, ...childQuestionFailures]` 逐筆;沒有失敗就一筆都不寫(空陣列迴圈不跑) |
| CLI 的 `cardsCreated` 含子卡 | ✅ `[...result.cardsCreated, ...result.childrenCreated]`,實跑印出 10 張(5 level 0 + 5 子卡) |
| 有沒有投機取巧 | ✅ 沒有硬寫死 fixture 值、沒有把上限縮成測試用的小數字 |

### 7.3 存活變異逐條處理

#### `deps.ts`:95.96% → **100.00%**(第一次跑 4 個存活,全部是真漏測)

| # | 變異 | 分類 | 處置 |
|---|---|---|---|
| 1 | `file: 'graph/deps.json'` → `""` | 真漏測 | 「達上限」的測試沒有斷言 warning 的 `file` 欄位。補 `expect(warning!.file).toBe('graph/deps.json')` |
| 2 | `unresolved.join(' -> ')` → `join("")` | 真漏測 | 只斷言訊息「含 sec-0001」,分隔符怎麼接沒被檢查。補 `toContain('sec-0001 -> sec-0002 -> sec-0003 -> sec-0001')` |
| 3 | `order: []` → `["Stryker was here"]` | 真漏測 | 只驗了磁碟上沒有 order 檔,沒驗回傳值。補 `expect(result.order).toEqual([])` |
| 4 | `cardsUpdated: []` → `["Stryker was here"]` | 真漏測 | 同上。補 `expect(result.cardsUpdated).toEqual([])` |

#### `questions.ts`:76.00% → **100.00%**(第一次跑 11 個存活 + 1 個 no coverage)

| # | 變異 | 分類 | 處置 |
|---|---|---|---|
| 1 | (no coverage)`if (!(err instanceof Error)) return false` → `return true` | 真漏測 | 沒有測試丟出非 Error 的值。補 `does not retry when the router throws a value that is not an Error`:丟字串時不重試,只呼叫一次 |
| 2 | `TASK_MAX_TOKENS['ingest.questions'] * 2` → `/ 2` | 真漏測 | 重試的預算完全沒被斷言。`makeScriptedRouter` 改成連 `opts` 一起記,補 `doubles the token budget on the truncation retry …` |
| 3–6 | `reason === 'output_truncated' ? { maxTokens } : undefined` 的 4 個變異(`true ?`、`false ?`、`!==`、`{}`) | 真漏測 | 同一個洞的四面。補三個測試:截斷重打時 `opts` 是 `{ maxTokens: 預設 * 2 }`、第一次呼叫不帶 `opts`、逾時與網路重打時 `opts` 是 `undefined` |
| 7–11 | `generateQuestionsForCards()` 裡 `onRetry` 寫 `llm_call` 的整段(BlockStatement 移除、ObjectLiteral 清空、`type: ''`、`task: ''`、`retry: false`) | 真漏測 | 這筆 log 只在 cucumber 驗過,vitest 一個都沒有。補 `appends one llm_call event naming the card and the retry reason …`(逐欄位比對,`ts` 另外驗型別)與 `writes no llm_call event when no card needs a retry` |
| 12 | `const causeCode = … : ''` → `"Stryker was here!"` | **真等價** | 這個 `''` 只是「沒有 `cause.code`」的佔位字串,唯一用途是餵給 `NETWORK_ERROR_PATTERN.test()`。換成任何不含 `fetch failed` / `ECONNRESET` / … 特徵的字面值,`test()` 結果一樣是 `false`,對每一種輸入都不可觀測。加 `// Stryker disable next-line StringLiteral` 並寫明理由 |

沒有「死程式」類的存活變異(沒有刪掉任何東西)。

### 7.4 另外強化的測試

`deps.test.ts` 的 `is deterministic: the same graph run twice drops the same edges in the same order` 原本只比較同一個 process 裡跑兩次的結果——靠 `Set`/`Map`
迭代順序決定丟哪條邊的實作也會兩次一樣,這個斷言擋不住。改成連「丟的是哪兩條」
一起釘死(`['sec-0003','sec-0001']` 與 `['sec-0006','sec-0004']`,也就是每個環裡
DFS 最後走到的那條回邊),確定性才真的被鎖住。

### 7.5 驗收實測

| 項目 | 結果 |
|---|---|
| `npm ci` | ✅ |
| `npm run boundaries` | ✅ 掃描 173 個檔案,允許例外 9 條,無違規 |
| `npm run typecheck` | ✅ 無輸出 |
| `npx vitest run` | ✅ **64 檔 / 975 測試全綠**(968 + 這輪補的 7 個) |
| cucumber `not @manual` | ✅ **455 場景:291 綠、164 undefined、0 紅** |
| cucumber phase-2 | ✅ **12 場景全綠 / 74 步驟全綠** |
| cucumber `--dry-run` | ✅ **0 ambiguous** |
| Stryker `deps.ts` | ✅ **100.00%**(98 killed + 1 timeout + 45 errors,0 survived、0 no coverage) |
| Stryker `questions.ts` | ✅ **100.00%**(49 killed + 31 errors,0 survived、0 no coverage) |

164 個 undefined 是未來 wave 的既有狀態(I8 Windows 等),與這輪無關。

### 7.6 審核中發現、但沒有改的事(留給使用者判斷)

1. **CLI 連著印出兩個不同的卡片數。** `scripts/ingest.ts` 先印
   `建立了 10 張卡:`(level 0 + 子卡,這一輪剛修對的),下一行接著
   `console.log(result.message)`,而 `result.message` 來自 `runIngest()`、只算
   level 0,內容是 `建立了 5 張卡`。兩個數字背靠背出現,使用者會困惑。
   不是正確性 bug(任務要求的「`cardsCreated` 含子卡」已經滿足),但值得順手修
   ——`runIngestPipeline()` 應該覆寫 `message`,或 CLI 不要再印一次 `message`。

2. **達上限時舊的 deps.json / order 檔會留在磁碟上。** early return 只保證
   「這一次不寫」,如果上一次成功的 run 已經寫過檔,那兩個舊檔還在。契約 §8 的
   「要嘛都寫、要嘛都不寫」對這一次的寫入成立,但讀檔的人會拿到過期的圖,而且
   看不出來它過期了。要不要在這個情況下刪檔(或寫一個 stale 標記)是個取捨,
   照 CLAUDE.md 的「做決定時」規則不該由我默默選一個,列在這裡等決定。

### 7.7 判定

**PASS**。

- 兩個永遠紅燈的步驟定義補完,而且都做過反向驗證(弄壞實作會紅),不是靠放水
  斷言換綠燈。
- 實作沒有找到邏輯缺陷:丟邊確定性、上限是 `cards.length`、達上限時兩個檔都不
  寫、log 格式合契約 §10、重試範圍精準且只一次、失敗回報逐筆、CLI 退出碼與清單
  都對。
- 兩個嚴格級模組的變異分數都是 **100.00%**;15 個存活/未覆蓋變異裡 14 個是真漏
  測(全部補測試)、1 個是真等價(加 disable 並寫明理由),沒有用「等價變異」
  一句話帶過。
- 7.6 的兩點是體驗/取捨問題,不影響這一輪的驗收。
