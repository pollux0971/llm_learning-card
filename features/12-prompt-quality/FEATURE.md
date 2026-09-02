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
| 1 | golden 框架、結構性檢查、diff(FakeLlm) | Wave 0 | ready | |
| 2 | 真模型 golden run、評分表、回歸流程 | I2 | todo | |

## 什麼時候該跑

| 時機 | 模式 |
|---|---|
| 改任何 `prompts/` 底下的檔 | `--golden --live` 然後 `--diff` 對上一次 |
| 換雲端模型 | 同上,而且要重新評分 |
| CI | `--golden --fake`,只驗結構不驗品質 |

**改了 prompt 沒跑 golden 就 commit,是這個專案唯一會靜默毀掉品質的操作。**
這條寫進 CLAUDE.md。

## 開放問題

- 評分要幾個維度?先兩個:「正確嗎」「是一個概念嗎」,各 1–5 分。太多維度沒人會填
- golden set 要多大?先每個任務 3 個輸入。大了你不會想評

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
