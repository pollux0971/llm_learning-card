# 04 · scheduler

## 一句話

決定「今天考誰、答完後下次何時」的純函式。不讀檔、不寫檔、不呼叫 LLM。

## 範圍

- 契約 §6 的固定骨架與間隔表
- stage → 題型對應
- 答錯回退、連錯計數、stuck 判定、reteach 事件
- 今日到期、每日上限、逾期比例優先序
- 所有函式吃狀態物件、吐新物件,無副作用

## 不在範圍

- 讀寫 reviews.json(呼叫端做)
- 審核對錯(→ 05)
- 縮短版內容生成(→ 05)
- 自適應演算法(ADR-001;介面設計成可替換)

## 單獨執行

```bash
npx tsx scripts/due.ts --state contracts/fixtures/reviews/mid-cycle.json --today 2026-09-10
npx tsx scripts/due.ts --simulate --days 200 --new-per-day 2
```

第一個印出今日到期清單與排序理由;第二個模擬 200 天的每日題數曲線,用來驗證穩態負擔。

## 依賴

**Wave 0(phase-1)**:無。這是最乾淨的一個——純函式,連 fixture 都只需要 reviews。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1 | |
| phase-3 | 自身 phase-2 | |

## Wave 0 的重複

無。

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `packages/core/src/scheduler/` |
| 日期 | ISO 字串,用 date-fns 的 addDays / differenceInDays | 不用 Date 物件做運算,避免時區 |
| 測試 | vitest + cucumber | |
| 變異門檻 | **嚴格 95%** | 算錯要幾週後才發現,代價最高 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | 固定骨架、到期清單、題型對應 | Wave 0 | done | 2026-09-02 |
| 2 | 錯誤回退、連錯、stuck、reteach | I2 | todo | |
| 3 | 每日上限、逾期比例優先序 | I2 | todo | |

## 驗收方式

全自動,無 `@manual`。這是全專案測試覆蓋最高的模組。
變異測試必須涵蓋間隔表**每一格**、逾期比例的四種常見錯誤實作、邊界(逾期 0 天、連錯剛好 2 / 3)。

## 開放問題

- 「今天」用本地時區 00:00 還是可設的一天開始時間(如 04:00)?先 00:00,I5 再議。

## 待協調

- **潛在的 cucumber step 撞名(來自 01-data-layer/phase-2,還沒發生,先提醒)**:
  `features/steps/data-layer.steps.ts` 已經定義了 `Then('stuck is false', ...)` 與
  `Then('the consecutive count is {int}', ...)`(讀 `this.lastResult`),因為 phase-2 開工時
  `features/steps/scheduler.steps.ts` 還沒實作到這幾句、暫時先頂著跑。等這個 phase(02/03)
  寫到 `SchedulerOutcome.review.stuck` 相關斷言時,如果也想用一模一樣的文字,會跟 01 那句撞名
  (cucumber 的 step 是全域註冊,不分 tag)。屆時要嘛沿用 01 那句(如果 `this.lastResult` 型別對
  得上),要嘛把這句拉進 `features/steps/common.steps.ts`(只有協調者能改)。開工前先讀一次
  `data-layer.steps.ts` 目前定義的句子,避免重複定義。
- **`cucumber.js`(共用檔)的 ESM profile 解析有 bug,擋住全專案的 `npm run accept*`。**(main
  已於 commit 217ad09 修好,下面這段是歷史記錄,不用再處理。)
  現在寫法是 `export default { default: { paths: [...], import: [...], ... } }`。
  但 `@cucumber/cucumber` 11.3.0 讀 ESM 設定檔時,`definitions` 會是整個 module
  namespace(`{ default: <你 export 的值> }`),不會像 CJS 一樣自動把 `.default`
  攤平回上一層。於是 `definitions['default']` 抓到的是你 export 的**整包**
  `{ default: {...實際設定...} }`,而不是裡面那層真正的 paths/import/tags——
  結果所有 step 定義都沒被載入,`npm run accept`、`accept:standalone`、
  `accept:integration` 三個指令跑起來全部變成「Undefined」,不管哪個資料夾。
  修法(二選一,已用第一種在本地驗證過可行):
  1. 拿掉多包的一層,直接 `export default { paths: [...], import: [...], ... }`
     (單一 profile 就不需要 `default:` 這個 key,ESM 的 `export default` 本身
     就對應到 profile map 的 `default` 鍵)。
  2. 保留現在的多 profile 結構,但改用具名 export:
     `export const config = {...}` 不行,要嘛用 `.mjs`/`.cjs` 明確副檔名讓
     loader 走 CJS 分支(那邊不會有這個雙層問題),要嘛照方案 1。
  這個檔案在「共用檔:只有協調者改」清單裡,我沒有動它。用
  `NODE_OPTIONS=--import=tsx npx cucumber-js --import 'features/steps/**/*.ts' ...`
  (繞過壞掉的設定檔,直接用 CLI flag 帶 import glob)驗證過:04-scheduler
  phase-1 的 17 個 scenario、63 個 step 全過。
