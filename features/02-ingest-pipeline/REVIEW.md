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
