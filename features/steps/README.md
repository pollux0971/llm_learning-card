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

## 已知待決

`@cucumber/cucumber` 載入 TypeScript 的方式依版本而異(loader / tsx / ts-node)。
第一次跑不起來時查官方文件,決定後把設定寫進 `cucumber.js` 並在 decision map 記一筆。
這件事列在待決表,是 Wave 0 第一個 `/phase-done` 之前要解掉的。
