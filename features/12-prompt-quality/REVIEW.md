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

---

## phase-2 補完(登記真 golden set) · 2026-09-04 · 審核 agent

**結論:PASS**

commit `b58a110` 之上再加一輪審核修補(未 push)。branch `pollux0971/golden-set-registration`,
worktree base = `eabb8b9`(**注意**:main 已經前進到 `fd81d46`,見 §9 的合併注意事項)。

### 1. 最優先:守門測試本身能不能守

工單要的性質是「`packages/core/prompts/**/*.md` **每個檔恰好被一個** golden set 引用」。
交付版本只做了「至少一個」——`checkPromptCoverage()` 把 `promptFile` 丟進 `Set`,
兩組指到同一個檔會被合併掉。**引用數 2 的方向沒有守。已補。**

#### 方向一:引用數 0(沒被登記的 prompt 檔)——原本就會紅 ✓

真的放了一個 `_probe.md`,不是模擬:

```
$ printf '# probe\n' > packages/core/prompts/ingest/_probe.md
$ npx vitest run packages/core/src/prompt-quality/golden-sets/registry.test.ts
     × 每一個 prompt 檔都被某個 golden set 的 promptFile 引用 8ms
     × 掃描器找得到 ingest 底下那五個檔,而且路徑是 repo 相對、用 / 分隔 1ms
     × 多一個沒被登記的 prompt 檔,unregistered 就會列出它 1ms
      Tests  3 failed | 23 passed (26)

$ npx tsx scripts/prompt-check.ts --list
packages/core/prompts/ 底下掃到 6 個 prompt 檔。
✗ 這個 prompt 檔沒有任何 golden set 登記,改了它不會有人發現:packages/core/prompts/ingest/_probe.md
cli exit=1

$ rm packages/core/prompts/ingest/_probe.md
$ git status --short packages/core/prompts/     # 0 changes
```

#### 方向二:引用數 2 ——**原本是綠的**,已補成紅

先做了一個會誤判的版本:把 `children.md` 的 `promptFile` 改指 `cards.md`。
那樣**確實**會紅,但紅的原因是 `children.md` 變成沒人引用(方向一),不是「兩個引用」。

真正的方向二要「**沒有任何檔變成孤兒**」。把 `selftest` 的 `promptFile` 也指到 `cards.md`
(它原本指到 `promptsDir` 外面的佔位檔,所以五個檔仍然每個都有人引用)。**交付版本全綠**:

```
$ npx tsx scripts/prompt-check.ts --list        # selftest → .../ingest/cards.md
packages/core/prompts/ 底下掃到 5 個 prompt 檔。
✓ 每個 prompt 檔都有 golden set 登記。
CLI exit=0                                       ← 守門沒守住
```

`registry.test.ts` 有兩個測試會紅,但那是它們**碰巧**逐字釘住了 selftest 的佔位檔路徑,
不是在數引用數。守門本身(CLI 退出碼)是綠的。

**已補**:`PromptCoverage` 新增 `duplicated: { promptFile, sets }[]`,`runList` 逐條印出並回 1。
同樣情境重跑:

```
$ npx tsx scripts/prompt-check.ts --list
packages/core/prompts/ 底下掃到 5 個 prompt 檔。
✗ 這個 prompt 檔被 2 組 golden set 登記(要恰好一組),ingest.cards / selftest 都指到:packages/core/prompts/ingest/cards.md
CLI exit=1                                       ← 現在守住了

$ # 還原後
✓ 每個 prompt 檔都恰好被一組 golden set 登記。
exit=0
```

新測試(`registry.test.ts`)先斷言 `unregistered` / `missing` / `scannerBroken` 在這個情境下
**全是綠的**,再斷言 `duplicated` 是紅的——把「舊的兩項不足以守住」寫進測試本身。

#### 方向三:掃到 0 個檔(P-28)——實跑,不是只有「目錄不存在」的測試 ✓

```
$ mv packages/core/prompts <scratch>/            # 整個目錄搬走
packages/core/prompts/ 底下掃到 0 個 prompt 檔。
✗ 一個 prompt 檔都沒掃到:這不是很乾淨,是掃描器壞了(packages/core/prompts/)
CLI exit=1

$ mv packages/core/prompts/ingest <scratch>/     # 目錄在、但是空的
packages/core/prompts/ 底下掃到 0 個 prompt 檔。
✗ 一個 prompt 檔都沒掃到:這不是很乾淨,是掃描器壞了(packages/core/prompts/)
CLI exit=1
      Tests  5 failed | 26 passed (31)
```

**順帶修掉一個假綠**:`scanPromptFiles` 原本寫 `join(ROOT, promptsDir)`,
給絕對路徑時會接成 `ROOT/tmp/xxx`(不存在)。於是「空目錄」的測試其實在測「目錄不存在」,
兩件事被混成一件。改成 `resolve(ROOT, promptsDir)`,並補一個真的空目錄的測試。

### 2. 型別上分不分得開(branded type 的實測)

**不是 branded type,是兩個不同的字串聯集別名。** 實測結果:編譯器在**兩個方向**都擋,
但有一個刻意的邊界。用一個暫時的 `__tsc_probe.ts` 跑 `npx tsc --noEmit`:

```
(9,30): error TS2345: Argument of type 'GoldenSetId' is not assignable to parameter of type 'LlmTask'.
(12,30): error TS2322: Type 'LlmTask' is not assignable to type 'GoldenSetId'.
(15,30): error TS2345: Argument of type '"ingest.children"' is not assignable to parameter of type 'LlmTask'.
(18,30): error TS2322: Type '"deepen"' is not assignable to type 'GoldenSetId'.
```

| 情境 | 擋住? |
|---|---|
| `GoldenSetId` 型別的變數傳進吃 `LlmTask` 的位置 | ✓ |
| `LlmTask` 型別的變數傳進吃 `GoldenSetId` 的位置 | ✓ |
| 字面量 `'ingest.children'` / `'ingest.regenerate'` / `'selftest'` 當 task | ✓ |
| 字面量 `'deepen'` / `'grade.fill.llm'` / `'grade.apply'` / `'reteach.short'` 當 set id | ✓ |
| 字面量 `'ingest.cards'` / `'ingest.questions'` / `'ingest.deps'` | **✗ 兩邊都合法** |

最後一列是刻意的:那三組的 set id 與 task **本來就是同一個字**,傳錯也是同一個值,
不會出事。真的會出事的六個字全部被擋住。**判定:「不同別名」的要求已滿足,不需要 branded type。**

**原本沒有測試,已補**——`registry.test.ts` 用 `@ts-expect-error` 把六條都釘住。
反向驗證(把 `GoldenSetId` 改成 `string`,等於合併兩個別名):

```
$ npx tsc --noEmit
registry.test.ts(151,5): error TS2578: Unused '@ts-expect-error' directive.
registry.test.ts(159,5): error TS2578: Unused '@ts-expect-error' directive.
exit=2
```

### 3. 遷移:`--diff` 在新舊混雜時的行為

**交付版本有一個會給出錯答案的洞。** 舊版面的 run 目錄是 `<base>/<task>/<date>`、
`meta.json` 沒有 `set` 欄位。`compareRuns` 比的是 `metaA.set !== metaB.set`:

| A | B | 交付版本 | 應該 |
|---|---|---|---|
| 舊 | 新 | 丟 `NotComparableError`(訊息寫 `undefined vs selftest`) | 丟錯 ✓(訊息不好) |
| 新 | 舊 | 同上 | 丟錯 ✓ |
| **舊** | **舊** | `undefined === undefined` → **靜靜比下去** | **丟錯** ✗ |

兩個舊目錄可以是完全不同的任務,並排顯示出來的東西沒有意義。**已補** `LegacyRunLayoutError`,
在比 `set` **之前**先擋(順序有意義,寫在程式註解裡了),CLI `--diff` 一併接住。

`--migrate` 沒有做,理由是這個 repo 裡沒有東西要搬:`golden/`(進 git 的 live run)不存在、
`git ls-files` 查無已 commit 的 run;`golden-fake/` 在 `.gitignore` 裡、每個 worktree 各自一份。
**改成把搬法寫進錯誤訊息**,滿足「不要讓人手動猜目錄名」:

```
<dir> 是舊版面的 golden run(meta.json 沒有 set 欄位,目錄名是 LlmTask)。
新版面一組 golden set 一個目錄:<base>/<golden set id>/<date>。
這一份的 task 是「grade.apply」——對應的新 set id 是「selftest」,
把它搬到 <base>/selftest/<date>/ 並在 meta.json 補上 "set": "selftest" 就能比。
```

task 不是 `grade.apply` 時改叫人查 `prompt-check.ts --list`;連 task 都沒有時叫人重跑。
三條分支都有逐字比對的測試(不是 `toContain`)。

### 4. 契約與 raw 的 diff 證明

```
$ B=$(git merge-base main HEAD)      # eabb8b9

$ git diff $B..HEAD -- contracts/
(空的)
$ git diff main..HEAD -- contracts/
(空的)
$ git diff $B..HEAD -- contracts/fixtures/raw/
(空的)
$ git diff main..HEAD -- raw/
(空的)
```

**契約 §7 的 `LlmTask` 一個字都沒改,`raw/` 與 `contracts/fixtures/raw/` 沒動。**
硬規則 1 與 2 都守住。

切片是**執行時讀**、不是複製一份,而且改了那個檔會紅。實測(在第 2 行插一行字):

```
     × 三個切片,對應原檔自己的三個 ## 小節
     × 最後一個切片收在檔案的最後一行——不是切到一半就不管了
     × 三個切片長度不同:CORS 最長、預檢最短(這是選它們的理由之一)
     × sliceRaw 逐字等於原檔那幾行,含 ## 標題、不含尾端空白
     × sliceBody 逐字等於同一段去掉 ## 標題的正文,前後都沒有空白
      Tests  5 failed | 5 passed (10)
```

fixture 被動到不會靜默換掉基準,會是五個紅燈。

### 5. `--fake` 的 fixture 品質(抽查)

抽了五個。**是真的像模型輸出,不是佔位字串**,而且內容都是從那三個切片的語意來的:

- `ingest.cards.golden-cards-cors`:三張卡,`title`/`body`/`examples`/`lines` 齊全,
  body 是「伺服器在回應裡加標頭,說明哪些來源可以讀這個回應…」——真的在講 CORS
- `ingest.cards.golden-children-preflight`:一張子卡「預檢結果可以快取」,沒有 `lines`
  (子卡本來就沒有),形狀跟父卡不同
- `ingest.cards.golden-regenerate-same-origin`:一張重寫過的卡,body 壓在 100 字以內
- `ingest.questions.golden-questions-cors`:`fill` 兩題(答案帶同義詞陣列)+ `apply` 一題
  帶三條 rubric,契約 §5 的 2..4 條範圍內
- `ingest.deps.golden-deps-reversed-order`:輸入是**倒過來列**的三張卡,
  回的 edges 仍然是 `same-origin → cors → preflight`——正是這一份輸入要驗的訊號

結構性檢查在 `--fake` 下算得出有意義的東西(合法 JSON、body 在字數內、rubric 條數對)。
`FakeLlmRouter` 對不到 fixture 會丟 `FixtureNotFoundError`,不會靜默回空字串;
「沒有任何 golden 標記是另一則的子字串」也有測試釘住。

### 6. 驗收數字(全部重跑)

| 檢查 | 結果 |
|---|---|
| `npm ci` | ✓ |
| `npm run boundaries` | ✓ 198 檔,11 條例外,無違規 |
| `npm run typecheck` | ✓ |
| `npm run lint:docs` | ✓ 80 檔 20 條連結全在 |
| `npx vitest run` | ✓ **1581 passed / 81 files**(交付版 1562,本輪 +19) |
| `cucumber-js --tags "not @manual"` | **500 scenarios / 345 passed / 0 failed**(交付版 496/341/0,+4 是新場景) |
| `npm run accept:dry` | ✓ **0 ambiguous** |
| `npm run accept:standalone` | ✓ 158 scenarios / 696 steps |
| `npm run standalone` | ✓ 全部通過 |
| `prompt-check.ts --list` | ✓ 五個 ingest set + selftest,五個 prompt 檔各恰好一組 |
| `prompt-check.ts --golden --fake` | ✓ 18 個輸入,沒花錢 |
| `git status` | 乾淨(只有本輪修改的檔) |

`npm run check:steps` 與 `npm run accept:coverage` **這個 branch 上不存在**——
它們是 main 在 `e7a2387`(模板 v1.3.0)才加的,本 branch 的 base 比那早。不是退化,見 §9。

**沒有跑 `--live`**(工單交代由協調者跑)。

### 7. Stryker(一律 `npm run mutate --`,不要直接叫 Stryker CLI —— 那會繞過鎖)

用 `MUTATE_TEST_GLOB='packages/core/src/prompt-quality/**/*.test.ts'`、一個檔一次。

| 檔 | 開發回報 | 審核重跑① | 補測試後② | 門檻 80% |
|---|---|---|---|---|
| `golden-sets/registry.ts` | 99.33 | 95.54 | **98.17** | ✓ |
| `golden-sets/raw-slices.ts` | 92.86 | 91.30 | **95.00** | ✓ |
| `compare.ts` | 91.43 | 85.37 | **100.00** | ✓ |
| `cli.ts` | 88.75 | **89.06** | — | ✓ |
| `regression.ts` | 87.50 | **83.78** | — | ✓ |
| `golden-run.ts` | 84.85 | **82.86** | — | ✓ |

**開發回報的數字重現不出來。** `regression.ts` / `golden-run.ts` 我一個字都沒改,
分數卻分別低了 3.7 與 2.0 個百分點——差異來自 stryker 的叫用方式不同(開發沒有寫出完整指令;
我用一份 `stryker.pq.json` 指定 `vitest.configFile`,跑完刪掉)。
**以審核這一欄為準**,六個檔全部在 80% 以上。①→② 的下降是我加的程式帶進來的,已補回。

#### 存活變異逐條處理(四分類)

| # | 檔:行 | 變異 | 分類 | 處置 |
|---|---|---|---|---|
| 1 | registry:283-286 | `duplicated` 的 `.sort(comparator)` 整段拿掉 | 測試太弱 | 排序測試的登記順序本來就等於字典序,拿掉沒差。改成 `questions` 那一對排前面、`cards` 那一對排後面,順序必須被翻過來 |
| 2 | registry:286 | `a < b ? -1 : 1` → `false ? -1 : 1` | 測試太弱 | 同 #1,已殺 |
| 3 | registry:286 | `<` → `<=` | **等價變異** | Map 的 key 唯一,兩邊永遠不相等。**改寫程式**:先 `[...bySet.keys()].sort()` 再組結果,不用 comparator——等價變異連同 `+1 : 1` 的 NoCoverage 一起消失 |
| 4 | registry:241 | `return out.sort()` → `return out` | **等價變異(在這個平台上)** | 實測過:放三十個檔到暫存目錄再掃,`readdirSync` 在這台機器的檔案系統上本來就回傳排好的順序,殺不掉。`.sort()` 要留著(POSIX 不保證讀取順序),測試改成釘住「輸出是排序的」這個對外承諾,註解誠實寫明殺不掉 |
| 5 | registry:289 | `bySet.get(f) ?? []` 的 `[]` | NoCoverage,防禦性死路 | key 一定存在,`?? []` 走不到。保留(型別需要),記錄 |
| 6 | raw-slices:69 | `lines[0] ?? ''` | NoCoverage,防禦性死路 | `split('\n')` 不會回空陣列。保留(`noUncheckedIndexedAccess` 需要),記錄 |
| 7 | raw-slices:65 | `/^\s+|\s+$/g` → `/^\s+|\s$/g` | **死程式** | `sliceRaw` 已經修掉尾端空白,`\s+$` 那一半走不到。**刪掉**,改成 `/^\s+/`。分數 91.30 → 95.00 |
| 8 | compare:25/28 | `LegacyRunLayoutError` 訊息的兩段字串 → `''` | 測試太弱(我自己新加的) | 原本用 `toContain` 抓關鍵字,而 `grade.apply` 剛好也出現在暫存目錄路徑裡,所以刪掉整段訊息還是過。改成**逐字比對整句**,三條分支各一個 |
| 9 | compare:34 | `this.name = 'LegacyRunLayoutError'` → `""` | 測試太弱(我自己新加的) | 只驗 `toBeInstanceOf`。補 `.name` 斷言 |
| 10 | compare:44 | `this.name = 'NotComparableError'` → `""` | 測試太弱(既有) | 補 `.name` 與逐字訊息斷言 |
| 11 | compare:55 | `/\.output\.json$/` → `/\.output\.json/` | 測試太弱(既有) | 沒有中間含 `.output.json` 的 id。補一個 id 叫 `weird.output.json-1` 的測試 |
| 12 | compare:82 | `Array.from(new Set([...idsA, ...idsB])).sort()` → 拿掉 `.sort()` | 測試太弱(既有) | 所有測試兩邊的 id 都一樣。補一個 A 只有 `z`、B 只有 `a` 的測試,聯集的自然順序是 `[z, a]` |
| 13 | cli.ts × 9 | 多處 `lines.join('\n')` → `''`、訊息字串 | 測試太弱(既有,未處理) | 都是 `toContain` 換成逐行比對就能殺。**沒動**——89.06 已過門檻,而且那是交付版本的既有狀態,不是這一輪的退化 |
| 14 | regression.ts × 5 | `readdirSync(...).sort(cmp)`、`<` → `<=` | 等價 + 既有測試太弱 | 跟 #3/#4 同一族(readdir 已排序、key 唯一)。**沒動**,83.78 已過門檻 |
| 15 | golden-run.ts × 11 | 訊息字串、`existsSync` 分支 | 既有測試太弱 | **沒動**,82.86 已過門檻 |

13/14/15 是交付前就存在的狀態,不在這張工單的補完範圍;列在這裡是為了不讓它們消失。

### 8. 補的 gherkin

`CLAUDE.md`「沒有 gherkin 不寫程式」。守門是 phase-2 的行為,但 `.feature` 裡沒有它。
補了四個場景到 `phase-2.feature`(`the registration gate` 那一節)與對應步驟:
恰好一組 / 沒人登記 / 兩組都登記 / 掃到 0 個。
步驟名一開始叫 `it passes`,跟 `weekly-goal.steps.ts` **ambiguous**;改成 `the gate passes` 之後
`accept:dry` 回到 0 ambiguous。

### 9. 給協調者的合併注意事項(**這一條要看**)

這個 branch 的 base 是 `eabb8b9`,**main 已經前進到 `fd81d46`**,中間 5 個 commit
包含「採用模板 v1.3.0 的守門」(`e7a2387` + merge `fd81d46`),那次改動:

- **重寫**了 `scripts/check-boundaries.ts`(-185/+…)與 `scripts/check-doc-links.ts`
- 新增 `scripts/check-step-dup.ts`、`scripts/check-phase-coverage.ts`、`scripts/check-gherkin-dup.ts`
- 新增 `scripts/boundaries.owners.json`、`scripts/_root.ts`、`gates.config.json`
- `package.json` 加了 `check:steps`、`check:gherkin-dup`、`accept:coverage`

本 branch 沒碰那些檔,合併應該不會衝突,但 **merge 之後要重跑一次
`npm run check:steps` 與 `npm run accept:coverage`**——我新增的四個場景與步驟定義
是那兩支守門要看的東西,而它們在這個 branch 上還不存在,這裡驗不到。

另外 `docs/paradigm/coordinator-practices-2026-09-04.md` 在 main 上被刪了(`fd81d46`),
本 branch 沒有引用它,`lint:docs` 兩邊都綠。

### 10. 這一輪改了什麼

| 檔 | 改動 |
|---|---|
| `golden-sets/registry.ts` | `PromptCoverage.duplicated`;`join` → `resolve`;`duplicated` 改用排序後的 key 組(拿掉等價變異) |
| `golden-sets/raw-slices.ts` | `sliceBody` 刪掉走不到的 `\s+$`(死程式) |
| `compare.ts` | 新增 `LegacyRunLayoutError`,在比 `set` 之前先擋舊版面 |
| `cli.ts` | `--list` 逐條印重複引用並回 1;`--diff` 接住 `LegacyRunLayoutError` |
| `golden-sets/registry.test.ts` | +7:重複引用三個情境、絕對路徑空目錄、掃描排序、型別別名的 `@ts-expect-error` |
| `cli.test.ts` | +4:重複引用兩個情境、掃描器壞掉時不抱怨重複、`--diff` 舊版面 |
| `compare.test.ts` | +8:舊版面五個情境、id 排序、`.output.json` 只砍結尾、兩個錯誤的 `.name` 與逐字訊息 |
| `phase-2.feature` / `prompt-quality-phase2.steps.ts` | +4 個守門場景與步驟 |

**沒有動**:`packages/core/prompts/`、`contracts/`、`raw/`、`FEATURE.md`、`NEXT.md`、
`docs/`、`REPORT-phase-2-registration.md`。phase 2 的狀態欄仍然是 `in-progress`,
按工單交代**不由我改回 `done`**。
