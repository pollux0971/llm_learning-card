# steps/ — 步驟定義

Cucumber 的步驟定義。**先讀 `_world.ts` 再寫新的**——它定義了所有步驟共用的狀態容器。

## 檔案分工

一個功能一個檔:`data-layer.steps.ts`、`scheduler.steps.ts`……
整合用的放 `integration.steps.ts`。

同一句步驟在不同 feature 出現時**共用同一個定義**。cucumber 會對重複定義報錯,
這是好事——它逼你統一措辭。

## 寫步驟的原則

- **Given 設定狀態,When 做一件事,Then 只斷言**。Then 裡面不要有副作用
- **步驟措辭跟著 feature 檔走**,不要為了方便改 feature 的英文
- **參數用 cucumber expression**:`the person types {string}`,不要用正規表示式除非必要
- **不要在步驟裡寫商業邏輯**。步驟只是薄薄一層轉接,邏輯在 `packages/core`
- **一個步驟可以呼叫另一個嗎?** 可以但少用。三層以上就該重構

## 通用步驟:`common.steps.ts`(只有協調者改)

同一句話在兩個以上的資料夾出現,cucumber 會對重複定義報錯,所以只能定義一次。
Wave 0 已經在 `common.steps.ts` 定義好的句子(**worker 不要再定義**):

| 句子 | 你的 When 要做什麼 |
|---|---|
| `it exits with status {int}` | 呼叫 `this.runStandalone()` 或 `this.runCommand(cmd)` |
| `the standalone dev command is run` / `the server starts` | 不用做,通用步驟會啟動再關掉 dev server |
| `today is 2026-09-10`(有無引號皆可) | 讀 `this.today` |
| `a fake router replaying the recorded fixtures` | 讀 `this.useFakeRouter`,自己建 FakeLlmRouter,呼叫記錄推進 `this.llmCalls` |
| `it makes no model call` / `no model call is made` / `no network request is made` / `no network connection is attempted` / `no network request leaves the machine` | 你的 fake 把呼叫推進 `this.llmCalls` / `this.networkRequests` |
| `a card with three example fences` / `a card with a body and no example fence` | 讀 `this.cardText` |
| `the original object is unchanged` / `a new object is returned` | 呼叫前 `this.trackInput(input)`,回傳值放 `this.lastResult` |
| `the result is <X>`(含 `a pass` / `a failure`) | 把結果放 `this.lastResult`;不是原始值就設 `this.resultText` |
| `a learning directory populated by the I1 pipeline` | 讀 `this.dir` |

規則:
- **只用在 `@manual` 場景的句子不要定義**(自動測試會跳過它們,定義了只會跟別人撞)
- 你需要新的通用句子:寫在自己 FEATURE.md 的「待協調」段,合併時協調者加進 `common.steps.ts`
- feature 檔的第一行 tag(`@scheduler` 之類)會被 `standaloneKey()` 用來找 `standalone.json` 的 key,不要改

## TypeScript 載入(已決定,ADR-033)

`npm run accept` 用 `NODE_OPTIONS=--import=tsx cucumber-js`。步驟檔之間的 import 寫 `./_world.js`
(ESM 慣例,tsx 會對應到 `.ts`)。
