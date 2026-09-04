# 12-prompt-quality — 審核記錄

這個檔案只增不刪,每次審核往下追加一段。

---

## phase-2 · 2026-09-04 · 審核 agent

**結論:PASS**(有兩處 ADR 數字已修正、九處測試漏洞已補、三處死程式已刪)

審核對象:`9b60517`(gherkin + 70 個紅燈測試)與 `adb5fa1`(實作 + ADR-043)。

### 1. 驗收指令

| 項目 | 結果 |
|---|---|
| `npm ci` | 通過 |
| `npm run boundaries` | 掃 181 個檔案、10 條例外,無違規 |
| `npm run typecheck` | 通過 |
| `npx vitest run` | **1115 passed / 69 檔**(開發 agent 交付時是 1064,本次審核補了 51 個) |
| `cucumber --tags "not @manual"` | **310 passed / 0 failed / 158 undefined** —— 與 `a921428` 同,無退化 |
| phase-2 的非 @manual 場景 | 18 個全過 |
| `npm run accept:dry` | **0 ambiguous** |
| `npm run standalone` | 全部通過(含 `12-prompt-quality`) |

### 2. 變異測試(門檻:FEATURE.md 標準 80%)

| 檔案 | 交付時 | 審核後 | 判定 |
|---|---|---|---|
| `structural-checks.ts` | 57.77% | **91.26%** | 過 |
| `scores.ts` | 68.92% | **89.19%** | 過 |
| `golden-run.ts` | 73.44% | **84.06%** | 過 |
| `regression.ts` | 58.54% | **83.78%** | 過 |

`structural-checks.ts` 交付時的 57.77% 有一半來自 **phase-1** 的那半個檔案
(`checkCardShape` / `checkRubricShape` / `checkCriteriaShape` / `checkFillShape`,
39 個存活變異)。那半邊從來沒跑過變異測試,原本的測試每一條都是
`expect(issues.map(i => i.kind)).toContain(...)` 的形狀,沒有踩過任何一個邊界值。
既然 FEATURE.md 的門檻掛在「結構性檢查」這個檔案上,一併補齊。

### 3. 十一條設計判斷的逐一查證與反向驗證

反向驗證的做法:把該項行為**弄壞**,只跑對應的測試檔,看會不會紅。
`綠燈` 代表沒有任何測試鎖住那條判斷——下一個人可以無聲改掉。

| # | 判斷 | 查證 | 反向驗證(修補前) | 修補後 |
|---|---|---|---|---|
| 1 | `charNgrams` 依 code point 切 | 實作確實是 `[...text]` | `[...text]` → `split('')`:**綠燈** ❌ | 紅燈 ✅ |
| 2 | 空字串回空集合、不回 `{''}` | 實作正確 | 拿掉空集合那行:**綠燈** ❌ | 紅燈 ✅ |
| 3 | `jaccard` 任一邊為空即 0 | 行為正確,但那行是**死程式** | 拿掉整行:**綠燈**(等價) | 已刪那行,行為改由測試鎖住 ✅ |
| 4 | 判定是 `>=`(邊界含 0.6) | 正確 | `<` → `<=`:**紅燈** ✅ | — |
| 5 | 兩張都沒標題不算撞名 | 正確 | 拿掉 `x.title.length > 0`:**綠燈** ❌ | 紅燈 ✅ |
| 6 | 斷鏈略過(那是 09-lint) | **09-lint 真的有那條** | 斷鏈改成報一筆:**紅燈** ✅ | — |
| 7 | probeOnline → 讀 prompt → mkdir | 正確 | probeOnline 移到 mkdir 後:**紅燈** ✅<br>讀檔移到 mkdir 後:**綠燈** ❌ | 紅燈 ✅ |
| 8 | 查不到 model 時欄位整個不存在 | 正確 | 改成永遠寫 `estimated_cost_usd`:**綠燈** ❌ | 紅燈 ✅ |
| 9 | 有基準但 golden set 不見時丟錯 | 正確 | `throw` → `return undefined`:**綠燈** ❌ | 紅燈 ✅ |
| 10 | `markBaseline` 先查再寫 | 正確 | 寫與查對調:**紅燈** ✅ | — |
| 11 | 固定三位小數、0 也照印 | 正確 | `toFixed(3)` → `String()`:**紅燈** ✅ | — |

**十一條判斷本身全部是對的,沒有一條要推翻。**
但十一條裡有 **6 條(1、2、3、5、7 的後半、8、9)在交付時沒有任何測試鎖住**——
包含第 9 條那個「靜默失敗」的形狀。這正是前幾輪抓過的同一種洞。

逐條說明:

**#1 code point 切法**:`charNgrams('abcd')` 這種 ASCII 測試分不出
`[...text]` 與 `text.split('')`;中文也分不出(CJK 常用字都在 BMP,一個 code unit)。
只有代理對(emoji、U+2A6xx 那類罕見漢字)分得出來。
補:`batch-checks.test.ts` 用 🐈🐉🐊🐋 與 U+2A6B2 三個字釘住,並斷言每個 gram 剛好 3 個 code point。

**#2 空集合**:原本只測了 `jaccard(new Set(), new Set())`,那條在 `charNgrams('')`
回 `{''}` 的時候照樣通過(因為測試自己造了空 Set,沒有走 `charNgrams`)。
補:直接斷言 `charNgrams('').size === 0`,再加一條「兩張 body 空白的卡不算重複」。

**#3 這條是死程式,不是漏測**:`if (a.size === 0 || b.size === 0) return 0;`
拿掉之後結果完全一樣——一邊空時交集必為 0、聯集等於另一邊的大小,算出來就是 0;
兩邊都空時由 `union === 0 ? 0 : ...` 接住。留著它反而讓 `union === 0` 那個分支
**永遠走不到**,變異測試看到的是一批殺不掉的存活變異。**已刪**,
行為改由「兩邊都空」與「任一邊空就是 0」兩條測試鎖住(換寫法也得維持)。

**#5 兩張都沒標題**:契約 §2 的 `title: string` 是必填,所以「兩張卡都沒有標題」
不是合法的磁碟狀態;但這個檢查吃的是 **LLM 剛吐出來、還沒落盤**的一批卡,
標題空白正是模型會犯的錯,所以這個防禦是對的、值得留、也值得測。
補:兩張空標題不同 body 的卡 → 0 對;有標題且相同 → 1 對。

**#6 斷鏈略過**:查了 `features/09-lint/phase-1.feature`,
第 39 行有 `Scenario: A prerequisite pointing nowhere is found`。
**這條判斷成立,不是洞。**

**#7 順序**:離線那個測試釘住了「probeOnline 在 mkdir 之前」,
但**沒有**釘住「讀 prompt 檔在 mkdir 之前」——把讀檔搬到 mkdir 之後,
既有測試一個都不會紅。可是「golden set 指錯路徑 / prompt 被搬走」是真的會發生的事,
那時候一樣會留下一個空目錄。補:一個 promptFile 指向不存在檔案的 golden set,
斷言丟錯而且 `readdirSync(baseDir)` 是空的。

**#8 欄位存在與否**:原本寫 `expect(result.meta.estimated_cost_usd).toBeUndefined()`,
那對「欄位不存在」與「欄位存在但值是 undefined」是同一個結果。
`meta.json` 落盤那條也分不出來(`JSON.stringify` 會把 undefined 的 key 丟掉)。
補:`expect('estimated_cost_usd' in result.meta).toBe(false)`,以及有價目時 `.toBe(true)`。

**#9 靜默失敗**:`detectPromptDrift` 在「有基準、commit 不一樣、但 golden set 從
registry 消失」時丟錯——這條完全沒有測試。有人把 registry 的一行刪掉,
漂移偵測就從此永遠回 `undefined`,也就是永遠說「沒漂移」。
補:`deepen` 有 `LlmTask` 但沒登記 golden set,正好是這個狀態;
另加一條「commit 一樣時仍回 undefined」確認不是無條件丟錯。

### 4. ADR-043 的數字重算

從真實卡片目錄 `/data/python/llm_learning-cards/learning/cards/security/`
(唯讀,未修改)重新解析 25 張卡,用實作本身的函式重算:

| ADR 寫的 | 重算 | 判定 |
|---|---|---|
| 25 張、300 對 | 300 對 | ✅ |
| 門檻 0.6 之下 0 對 | 0 對 | ✅ |
| 人判 4 對 = 0.132 / 0.082 / 0.057 / 0.019 | 完全相符 | ✅ |
| 最高 0.357 是 `sec-0019`/`sec-0021`,不在名單裡 | 相符(名次 1/300) | ✅ |
| 0.306、0.221、0.152 排在那 4 對之上 | 相符 | ✅ |
| 「降到 0.019 會抓到 **72 對**」 | 實際 **75 對** | ❌ **已修正** |
| 「prereq 相連的 **34 對**」 | 實際 **33 對** | ❌ **已修正** |
| 8 張 L0、17 張 L1 | 相符 | ✅ |
| 圖形狀 4 筆(0003→0011、0004→0012、0007→0022、0008→0023) | 相符 | ✅ |
| fixture 逐字取自真實卡片 | 25 張的 title / level / prereqs / body 全部一致 | ✅ |

兩處錯誤的成因:人判 4 對裡最弱的那一對(`sec-0003`/`sec-0014`)實際值是
**0.018518…**,顯示成 0.019 是四捨五入。把門檻設在字面的 `0.019` 會抓到 72 對,
但**連那一對都收不進來**——要收進來得設 0.0185,那是 75 對(300 對的 25%)。
ADR 原本那句話自相矛盾。prereq 相連的無序對重算是 33(prereq 項目共 33 筆、0 筆斷鏈、去重後仍 33)。

**兩處都已改進 `docs/02-decision-map.md`。結論不變**——75 對 vs 72 對都是「誤報四分之一」,
ADR-043 的決定(演算法與 0.6 不動、機器指標只做回歸偵測)完全成立。

**沒有試圖讓機器指標抓到那 4 對。** ADR-043 把那個方向否決掉了,審核照辦。

### 5. 硬規則與 ADR-032

- **硬規則 2、4**:`git diff a921428..HEAD -- prompts/ raw/` 是空的,
  本次審核也沒有動。golden run 不需要跑。✅
- **ADR-032 人打分維持兩個維度**:`SCORE_DIMENSIONS` 仍是 `['正確嗎', '是一個概念嗎']`,
  長度 2;`renderScoresSheet` 的表頭只有 `| id | 正確嗎 | 是一個概念嗎 |`;
  批次檢查在下方獨立的「機器檢查(不用填)」段,而且 `parseScoresSheet` 讀不到它。
  **沒有偷偷長出第三個人打的維度。** ✅
- **boundaries 例外 12→03**:理由寫得對——那條例外正是為了遵守「LLM 呼叫一律經過
  llm-router 的介面」,不是繞過它。✅

### 6. 有沒有投機取巧

沒有。逐項看過:

- `--live` 的測試**只在 `globalThis.fetch` 造假**,03 的 `LlmRouterImpl` /
  `CloudLlmRouter` / adapter / Anthropic SDK 全跑真的,而且斷言「真的送出了
  三次 `/v1/messages`」與「router 真的寫了三筆 `llm_call` log」。
  換成注入假 router 就等於什麼都沒驗——開發 agent 沒有這樣做。
- `i1-security-batch.ts` 逐字比對過真實卡片,25 張全對,不是抄近似值。
- gherkin 的 `Given the cloud is reachable` 沒有重定義既有的
  `the network is available`,accept:dry 仍是 0 ambiguous——這是真的想過的。
- 邊界 fixture(`abcdefghij` / `abcdefghxy` / `abcdefghwxy`)的 3-gram 交集/聯集
  手算過:6/10 = 剛好 0.6、6/11 ≈ 0.545,註解寫的算式正確。

### 7. 存活變異的四分類處理

**真漏測 → 補測試(共 51 條)**

| 位置 | 沒被測到的東西 |
|---|---|
| `charNgrams` | code point 切法、空字串 |
| `checkDuplicates` | 空 body、空標題、`ngramSize` 覆寫、**清單排序**(輸入亂序時) |
| `checkPrereqShape` | **清單排序**(同一張卡兩筆違規時的第二層次序) |
| `normalizeTitle/Body` | 輸出**實際**長什麼樣(原本每條都是「兩邊相等」,`toLowerCase→toUpperCase` 兩邊一起變,殺不掉) |
| `runBatchChecks` | issue 的 `detail` 文字 |
| phase-1 的四個 check | body 剛好 100 字、rubric 剛好 2/4 條、criteria 超過 4、apply 缺 prompt、answers 有空組/非陣列、遞迴掃樹、每一句 detail |
| `renderScoresSheet` | 逐字固定的輸出(這份檔案是要拿去 diff 的,格式本身就是規格) |
| `parseScoresSheet` | 只填一半的列、非表格行、前後空白、表頭與分隔列 |
| `runGoldenLive` | 讀檔早於 mkdir、`estimated_cost_usd` 欄位存在與否、兩個錯誤型別的 `name` 與訊息、`promptFileGitCommit` 是不是真的 sha、沒有輸入時的 `unknown` |
| `markBaseline` | 錯誤訊息帶不帶得出舊基準的位置 |
| `findBaseline` | 多個標記檔時取最早、task 目錄裡夾雜檔案 |
| `detectPromptDrift` | golden set 消失時丟錯 |
| `reviewRegression` | 輸入亂序時的排序 |

**死程式 → 刪掉(3 處)**

1. `jaccard` 的 `if (a.size === 0 || b.size === 0) return 0;` —— 理由見 §3 的 #3。
2. `reviewRegression` 排序的 `: 0` 第三分支 —— id 由 `compareRuns` 的 `Set` 併出來,
   保證唯一,那個分支走不到。改成兩分支(跟同檔的 `findBaseline` 一致)。
3. `runGolden` 的 fake 路徑抽成 `runGoldenFake(opts, set?)`,形狀跟
   `runGoldenLive(opts, set?)` 一致 —— 原本 golden set 一律從 registry 拿,
   所以「prompt 檔不存在」與「沒有輸入」那兩條路**沒有任何辦法從測試走到**
   (registry 登記的那一組永遠有檔案、永遠有 3 個輸入)。抽出來之後兩條都測得到了。

**真等價 → 留著並記錄(不加 Stryker disable,因為同一行還有殺得掉的變異)**

- `charNgrams` 的 `chars.length < n` → `<=`:長度剛好等於 n 時,
  特例回傳「整個字串當一個 gram」與迴圈跑一輪的結果是同一個。
- `checkDuplicates` 迴圈的 `i < prepared.length` → `<=`:多跑一圈但內層 `j = i+1`
  不會執行,結果相同。
- 各處比較子的 `<` → `<=`:兩邊是唯一的 id / 目錄名,永遠不會相等。
- `pairs.sort` / `violations.sort` 三分支寫法裡的 `: 0`:同上,走不到。
  (這兩處沒有跟著 #2 一起改成兩分支,因為 `p.a === q.a` 那層本來就需要三段語意,
  改了反而難讀;它們貢獻的存活變異在 91.26% 之下是可接受的。)
- `parseScoresSheet` 的 `if (cells.length < 2) continue;` → `if (false)`:
  少於 2 格的列走到後面也組不出任何維度,`any` 是 false,一樣不會被收進來。

**測不到(環境限制)→ 記錄**

- `findBaseline` 的 `readdirSync(...).sort(...)`(3 個變異):
  這台機器的檔案系統 `readdirSync` **本來就回傳排序好的結果**——實測建立 30 個
  遞減命名的目錄,readdir 回傳的是遞增的。所以「有排序」與「沒排序」在這裡
  觀察不到差別,任何測試都殺不掉。**但那行不能刪**:別的檔案系統(ext4 dir_index、
  網路檔案系統)不保證這件事,那行是真的保險。
- `gitCommitOf` 的 `spawnSync` 參數(6 個變異):變異測試的沙箱是 repo 底下
  `.stryker-tmp/sandboxNNN/` 的複本,裡面的檔案一個都沒被 git 追蹤,
  `git log -- <path>` 一律回空字串 → `'uncommitted'`,參數怎麼改都一樣。
  對應的測試(`meta.promptFileGitCommit` 是真的短 sha)用
  `it.skipIf(!IN_GIT_WORKTREE)` 在沙箱裡跳過,在真的工作區裡照跑。
- `findBaseline` 的 `if (!entry.isDirectory()) continue;` → `if (false)`:
  要殺掉它得有一個「檔案」裡面裝著 `BASELINE.json`,不可能。

### 8. 發現的問題與處置

| # | 問題 | 處置 |
|---|---|---|
| 1 | 6 條設計判斷沒有測試鎖住(含 #9 的靜默失敗形狀) | 已補測試,反向驗證全部轉紅 |
| 2 | ADR-043 的「72 對」應為 75 對(0.019 是四捨五入,設在字面 0.019 收不進最弱那對) | 已改 `docs/02-decision-map.md` |
| 3 | ADR-043 的「prereq 相連 34 對」應為 33 對 | 已改 `docs/02-decision-map.md` |
| 4 | `structural-checks.ts` 的 **phase-1 那半邊**從沒跑過變異測試,39 個存活變異 | 已補 13 個邊界/分支/訊息測試 |
| 5 | `scores.ts` 的 `renderScoresSheet` 沒有任何逐字斷言,整份輸出被改掉也不會紅 | 已補逐字固定的測試 |
| 6 | `NEXT.md` 的「現況」還停在「gherkin 與測試已寫,實作待接」 | 已更新 |
| 7 | `FEATURE.md` phase 2 仍是 `in-progress` | 已改 `done`(本次驗收通過) |

### 9. 沒有動到的東西

`prompts/`、`raw/`、`contracts/`、`.feature`、`.steps.ts`、`i1-security-batch.ts`、
`synthetic-batches.ts`,以及真實卡片目錄 `/data/python/llm_learning-cards/learning/`。
