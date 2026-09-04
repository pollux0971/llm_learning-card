# 12 · prompt-quality

## 一句話

讓 prompt 的改動有辦法被驗證。LLM 產品最常見的靜默退化就是有人改了 prompt、
輸出品質下降、幾週後才發現。

## 為什麼需要

`packages/core/prompts/` 底下的檔案決定了卡片、考題、審核的品質,但它們:

- 不是程式,型別檢查抓不到
- 輸出是自然語言,單元測試斷言不了
- 改動很輕鬆(改一行文字),後果很嚴重(所有新卡片變差)

一般的測試對這個完全無能為力。需要的是**golden fixture 加人工評分**:
把一份基準輸入用當前 prompt 跑一次、人評分、存下來;之後每次改 prompt 重跑並比對。

這不是要自動判斷「好不好」——那做不到。是要讓**變差這件事被看見**。

## 範圍

- prompt 檔案的組織與版本(每個 prompt 一個檔,改動走 git)
- golden set:每個 prompt 任務一組固定輸入
- `--golden` 模式:跑一次、產出並存到 `prompts/golden/<task>/<date>/`
- `--diff` 模式:比對兩次 golden run,列出每一項的差異供人看
- 人工評分表:每次 golden run 附一份 `SCORES.md`,你打分數
- 結構性的自動檢查(不判斷品質,只判斷格式):字數、JSON 合法、rubric 條數、
  空格數與答案數一致

## 不在範圍

- 自動判斷輸出「好不好」(做不到,別假裝)
- prompt 內容本身(各功能自己寫)
- LLM 呼叫(→ 03)

## 單獨執行

```bash
npx tsx scripts/prompt-check.ts --golden --task ingest.cards --fake
npx tsx scripts/prompt-check.ts --diff prompts/golden/ingest.cards/2026-09-10 prompts/golden/ingest.cards/2026-10-01
```

`--fake` 用重播 fixture,所以單獨執行不花錢也不需要網路;它的輸出存到不進 git 的
`golden-fake/`(要存到別處用 `--out <目錄>`)。
真的評分要 `--live`,那會呼叫雲端。

## 依賴

| Phase | 需要 | 原因 |
|---|---|---|
| 1 | 無(用 FakeLlmRouter) | 框架本身不需要真模型 |
| 2 | I1 通過、03 phase-1 | 要有真的 prompt 與真的輸出才有東西可評 |

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `scripts/prompt-check.ts` |
| golden 儲存 | `prompts/golden/<task>/<ISO date>/` 底下一堆檔 | 進 git,diff 看得到 |
| diff | 逐項並排,不做語意比對 | 人來判斷 |
| 變異門檻 | **標準 80%**,只針對結構性檢查 | diff 與儲存不用 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | golden 框架、結構性檢查、diff(FakeLlm) | Wave 0 | done | 2026-09-02 |
| 2 | 真模型 golden run、評分表、回歸流程 | I2 | in-progress | |

## 什麼時候該跑

| 時機 | 模式 |
|---|---|
| 改任何 `prompts/` 底下的檔 | `--golden --live` 然後 `--diff` 對上一次 |
| 換雲端模型 | 同上,而且要重新評分 |
| CI | `--golden --fake`,只驗結構不驗品質 |

**改了 prompt 沒跑 golden 就 commit,是這個專案唯一會靜默毀掉品質的操作。**
這條寫進 CLAUDE.md。

## 開放問題

- ~~評分要幾個維度?~~ 定了:**就兩個**,「正確嗎」「是一個概念嗎」,各 1–5 分。
  phase-2 不加第三個。重複率與圖形狀是機器算的結構性檢查,放在 SCORES.md 的
  另一段「機器檢查(不用填)」,不是要人填的欄位(ADR-032:多了就沒人填)
- golden set 要多大?先每個任務 3 個輸入。大了你不會想評

## phase-2 的兩項批次結構性檢查

跟字數、JSON 合法、rubric 條數同一個體系(`structural-checks.ts`),
只驗形狀、不判斷品質。差別是它們看的是「同一批」——同一類別一次 ingest 產出的全部卡。

### 重複率

演算法:同一批的卡兩兩比,符合任一條就算一對。

1. **標題正規化後相同**。正規化規則(依序):NFKC → 轉小寫 → 去掉所有空白
   (含全形空白 U+3000)→ 去掉所有標點與符號(Unicode `P*` `S*`)。
   所以 `CORS 預檢請求` / `cors－預　檢請求` / `「ＣＯＲＳ-預檢請求」` 三者相同,
   但**包含關係不算相同**:`預檢請求` ≠ `CORS 預檢請求`。
2. **body 的字元 3-gram Jaccard ≥ 0.6**。body 正規化:移除 example 圍欄(契約 §2)
   → NFKC → 轉小寫 → 去掉所有空白,**保留標點**。標題剝標點而 body 不剝,
   是因為標點在正文裡帶訊息,剝掉會把不一樣的句子拉近、灌水相似度。

**閾值邊界:`>=`,剛好 0.6 算一對。** 偵測性的檢查在剛好到門檻時應該報出來讓人看一眼,
不是靜靜放過。`batch-checks.test.ts` 有專門的「剛好 0.6」與「剛好差一格(6/11)」兩個測試,
因為 `>` / `>=` 正是變異測試第一個會換掉的地方。

閾值與 n-gram 大小是 `structural-checks.ts` 的具名常數
(`DUPLICATE_BODY_JACCARD_THRESHOLD`、`DUPLICATE_NGRAM_SIZE`),
`checkDuplicates()` 也吃 `{ threshold }` 覆寫。golden 跑兩次之後要調的就是它。

輸出「重複對數 / 卡數」與清單(哪兩張)。**golden 的目標是 0 對。**

### 重複率的已知限制(實測,2026-09-04)

I1-REVIEW §8.1 記的 4 對(`sec-0007`/`sec-0015`、`sec-0006`/`sec-0016`、
`sec-0003`/`sec-0013`、`sec-0003`/`sec-0014`)**這個指標抓不到**,而且不是調閾值就能解決:

| 那 4 對的實際 Jaccard | 0.132 / 0.082 / 0.057 / 0.019 |
|---|---|
| 25 張兩兩共 300 對裡的最高分 | 0.357(`sec-0019`/`sec-0021`,**不在那 4 對裡**) |
| 門檻 0.6 抓到 | 0 對 |
| 要含進最弱的 0.019 得把門檻降到 0.019 | 那會抓到 72 對 |

只比「父子/prereq 相連」的 34 對也一樣分不開(0.306、0.221、0.152 都排在那 4 對之上)。

原因:那 4 對是**中文語意上的改寫重複**(「預檢請求」與「CORS 預檢請求」講同一件事、
但用字不同),字元 3-gram 抓的是**字面**重複。

**決定(技術顧問 2026-09-04 裁決)**:演算法與 0.6 不動。I1 這批在這個指標下的真實基準
就是 **0 對**,golden 之後拿它比;人判的那 4 對屬於人打分的兩個維度,不屬於機器指標
(ADR-032:工具不判斷品質)。這件事在 `batch-checks.test.ts` 有一個專門的測試釘住,
免得之後有人看到 0 對就以為檢查壞了。

> 這個決定記在 **ADR-043**「機器指標抓字面重複,語意重複歸人打分」,含上表的實測數字與兩個被否掉的替代方案。

### 圖形狀

一張卡的 prereq 指向 **level 比自己深**的卡就算一筆(主卡依賴別人的子卡,
教學順序會先教子卡)。I1-REVIEW §8.2 的 L0 卡 prereq 含 L1 卡是這條的特例。
prereq 指向不存在的 id **不在這裡報**——那是 09-lint 的斷鏈檢查。目標 0 筆。

**基準更正**:I1-REVIEW §8.2 只點名了 `sec-0003`→`sec-0011` 一筆,
實際掃 25 張是 **4 筆**:

| 卡 | prereq |
|---|---|
| `sec-0003`(L0) | `sec-0011`(L1) |
| `sec-0004`(L0) | `sec-0012`(L1) |
| `sec-0007`(L0) | `sec-0022`(L1) |
| `sec-0008`(L0) | `sec-0023`(L1) |

### 基準資料放哪

`packages/core/src/prompt-quality/fixtures/i1-security-batch.ts` —— I1 那次真實 ingest
的 25 張卡,逐字取自 `learning/cards/security/`。複製進來而不是讀那個目錄,是因為
learning 目錄不在 repo 裡、也會隨之後的 ingest 改變,而基準必須凍結。
合成的正面/負面/邊界批次在 `fixtures/synthetic-batches.ts`。

## 待協調

- **`cucumber.js` 的 config 沒有生效(阻擋全專案的 `npm run accept*`)**:目前寫法是
  `export default { default: { paths, import, tags, ... } }`。cucumber-js 11.3.0 對
  `.js`(ESM)設定檔用 `import()` 讀取,拿到的是模組命名空間物件,它的 `.default` 已經是
  我們自己 export 的整包東西;把整包東西又包一層 `default: {...}` 等於多包了一層,
  cucumber-js 內部 `fromFile()` 抓到的是這層多餘的 `default`,schema 驗證時整包被當成
  不認得的東西丟掉,最後 `import`/`paths`/`tags` 都退回空值——**所有 `.steps.ts` 都不會被載入,
  每個 feature 的每個 scenario 都變成 undefined**,即使步驟其實有定義。這不是我這個 phase 造成的
  (是 scaffold commit 8586915 帶進來的),但影響全部 12 個功能的 `npm run accept` /
  `accept:standalone` / `accept:integration`。
  **修法**(已用暫存複本驗證過,driver 是拿掉多餘的外層 `default:`):
  ```js
  export default {
    paths: ['features/**/*.feature', 'docs/integration/**/*.feature'],
    import: ['features/steps/**/*.ts'],
    tags: 'not @manual',
    format: ['progress'],
  };
  ```
  (順便拿掉 `publishQuiet`——cucumber-js 11 說這個選項已經不需要了,會印一行 deprecation 警告。)
  這個檔案是共用檔,我沒有動它;12-prompt-quality 本身的 15 個 scenario 已經用
  `NODE_OPTIONS=--import=tsx npx cucumber-js --import 'features/steps/**/*.ts' --tags '@prompt-quality and @standalone'`
  繞過這個問題驗證過,66 個 step 全過。
- **golden 輸出的存放位置**:FEATURE.md 原本寫「`prompts/golden/<task>/<ISO date>/`」,但
  `packages/core/prompts/` 在 `packages/core/README.md` 的落點表是 02-ingest-pipeline 的地盤,
  而 phase-1 沒有真的 prompt(02 還沒動工)。目前存到自己的
  `packages/core/src/prompt-quality/golden/<task>/<date>/`,golden set 登記表(含一組
  `grade.apply` 的自我測試 demo,3 個固定輸入)在
  `packages/core/src/prompt-quality/golden-sets/registry.ts`,demo 用的佔位 prompt 檔也在
  同一個資料夾。等 02/05 的真 prompt 檔存在後,把 registry.ts 對應項目的 `promptFile` 指過去
  即可,存放路徑要不要真的搬進 `packages/core/prompts/golden/` 麻煩協調者決定。
- **fake run 不進 git、測試不碰 repo 檔案**(回應獨立審核意見):原本 `cli.test.ts` 的
  `afterEach` 對 repo 裡的 `golden/grade.apply/` 做 `rmSync`,跑 `npm test` 就把 git 追蹤的
  golden 檔真的刪掉——正是 ADR-032 要防的事。現在:(1) `runGolden` / CLI 依模式選預設存放處,
  fake run 存到 `packages/core/src/prompt-quality/golden-fake/`(已 `.gitignore`,重播 fixture
  的輸出沒有品質資訊),live run(phase-2)才存到 `golden/` 進 git;(2) CLI 加 `--out <目錄>`,
  所有測試(vitest 與 cucumber steps)一律寫到 `mkdtemp` 暫存目錄,清理範圍也只限暫存目錄;
  (3) 先前誤 commit 進 git 的 demo run `golden/grade.apply/2026-09-02/`(meta 還寫著
  `promptFileGitCommit: uncommitted`,是開發中跑測試留下的產物)已移除。
  跑 `npm test` 與 `prompt-check.ts --golden --fake` 之後 `git status` 都是乾淨的。

## phase 2 為什麼從 done 退回 in-progress(2026-09-04)

框架寫完了、測試 1508 全綠、四個檔案的變異分數都過 80%,但
`golden-sets/registry.ts` **只登記了 Wave 0 留下的一組 demo 自我測試**
(`grade.apply` 配三句 `[PQ_DEMO_1]` 假學生答案)。

真的 prompt(`packages/core/prompts/ingest/` 底下五個檔)**一個都沒被登記**。
registry 的檔頭註解自己寫著「phase-2 會登記真的任務」——那件事沒做。

phase-2 自己的 `@manual @llm` 場景寫的是「a live golden run is performed
**for the ingest tasks**」。沒登記 ingest 就是沒做完。

**如果照原樣跑 `--live`**,會產生一個看起來像基準、實際上什麼都沒鎖住的檔案:
之後有人改 `prompts/ingest/cards.md` 再比對,會拿到「沒有變化」,因為根本沒在比
那個 prompt。**「改了 prompt 沒人發現品質變差」正是這個資料夾存在的唯一理由。**

不另立 phase 3——那等於把「沒做完」改名。補登記後才算 done。
