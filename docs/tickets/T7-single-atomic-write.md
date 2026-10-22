---
id: T7
deps: []
touches: [packages/core/src/schema/, packages/core/src/ingest/state.ts, packages/core/src/lint/atomic-write.ts, packages/core/src/lint/index.ts, scripts/lint.ts, scripts/degraded-report.ts, scripts/boundaries.allow.json]
cpu: light
budget_usd: 4
status: merged
owner: worker-grok
must_catch:
  - 拿掉 fsync(目錄):writeFileAtomic 不再對目標所在目錄 fsync,§11b 測試的「fsync(目錄) 在 rename 之後」必須紅
  - EIO 被吞:目錄 fsync 的錯誤不分錯誤碼一律當成功(不只 EINVAL),「EIO 往外丟」與「ENOSPC 往外丟」必須紅
  - rename 失敗時 tmp 沒刪:把清理拿掉(或只在 fsync 失敗時清),「rename 失敗:刪掉 tmp 殘檔」必須紅
  - tmp 名稱不是 <name>.tmp:改回 .<name>.<pid>.<ts>.tmp(或任何別的名字),斷言暫存檔名的測試必須紅
  - 清理的錯誤蓋掉原本的錯誤:清理失敗時把清理的錯丟出去,「連清理都失敗時,丟出去的仍然是原本那個錯誤」必須紅
  - 舊樣式殘檔不再被清:拿掉舊樣式 .<name>.<pid>.<ts>.tmp 的清理,01 phase-2 的「a stray temporary file is cleaned up on the next write」必須紅
  - 兩份又長回來:atomicWriteJson 或 appendLogEvent 自己做 open/fsync/rename/append,而不是呼叫 01 的函式,靜態檢查必須紅
  - lint 留一份:scripts/lint.ts 改回呼叫 lint 自己的寫入(或 lint/atomic-write.ts 留著 open/fsync/rename),靜態檢查必須紅
  - 向量檔與實作脫鉤:TS 的 §11b 測試不讀 atomic-write.vectors.json(改成寫死在測試裡),或向量檔少一列而測試仍綠,向量 harness 的「列數與列名」斷言必須紅
---

# 工單 T7:§11b 原子寫入只留一份(`writeFileAtomic`),log append 只留一份(`appendLineAtomic`)

> 狀態:草稿,待技術顧問審。不改契約(§11b 本文不動,只是讓實作照本文做)。
> 作者:UI/Tauri 負責人(前端)。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 決策紀錄:ADR-070(TS 的 §11b 只留一份)。ADR-069 在 T2c 的分支;兩張工單由協調者同一批合併。
> 檔案:行號指 main @ `f2f7d76`。

## 為什麼有這張

2026-10-15 起草 T2c 時讀到(技術顧問同日打開 `atomic-write.ts` 核對過,屬實):

| 實作 | 位置 | 跟 §11b 的差別 | 誰在用 |
|---|---|---|---|
| `writeFileAtomic` | `../../packages/core/src/schema/atomic-write.ts:42` | 暫存檔名是 `.<name>.<pid>.<ts>.tmp`(§11b:「固定是 `<name>.tmp`」);**沒有 fsync(目錄)**(第 4 步);`renameSync`(:60)在 try 外面,**rename 失敗會留下 tmp** | `../../packages/core/src/session/io.ts:55`(**寫 `state/reviews.json`**)、`../../packages/core/src/schema/init.ts:76`、`../../packages/core/src/schema/graph.ts:262`、`../../features/steps/data-layer.steps.ts:663` |
| `atomicWriteJson` | `../../packages/core/src/ingest/state.ts:36` | 跟 §11b 一致:`<path>.tmp`、fsync(fd)、rename、fsync(目錄)、只有 EINVAL 算成功、清理在 finally 且不遮錯 | `ingest/ingest.ts`、`ingest/deps.ts` |
| `atomicWriteFileSync` | packages/core/src/lint/atomic-write.ts 第 40 行 | `<name>.tmp` 對,但**沒有 fsync(目錄)**(檔頭自己寫「三步」) | `../../scripts/lint.ts:85`(寫 `state/lint-report-<日期>.md`) |

log 也有兩份:`../../packages/core/src/schema/atomic-write.ts:72` `appendLineAtomic`(O_APPEND、一次 `writeSync`、fsync)與
`../../packages/core/src/ingest/state.ts:90` `appendLogEvent`(`appendFileSync`,沒有 fsync)。§11b 對 log 只要求「每次寫入是完整的一行」,
兩份都做到,但仍是兩份。

**最重的一筆:幾個月的記憶資料 `state/reviews.json`,現在是用少了第 4 步的那一份寫的。** 這違反硬約定 §11b 與 CLAUDE.md 硬規則 5。

## 技術顧問裁決(2026-10-15)

- `schema/atomic-write.ts` 的 `writeFileAtomic` 是**唯一一份** §11b 實作(01 data-layer 是正主)。
- 把 `atomicWriteJson` 那套做法搬進 `writeFileAtomic`:固定 `<name>.tmp`、fsync(fd)、rename、fsync(目錄)(只有 EINVAL 算成功)、
  清理放在 `finally`、清理的錯誤不遮蔽原本的錯誤。
- `ingest/state.ts` 的 `atomicWriteJson` 改成呼叫 `writeFileAtomic`,不留兩份。
- 舊樣式 `.<name>.<pid>.<ts>.tmp` 的殘檔,照樣在下一次寫入時清掉。
- `appendLogEvent` 改成呼叫 `appendLineAtomic`,不留兩份。
- `state.test.ts:141` 那組 §11b 測試對統一後的實作跑一遍;那組就是 Rust(T2b 修補輪、T2c-1)要對齊的共用向量。
- **第三份 `lint/atomic-write.ts` 併進本張**(2026-10-15 追加裁決):`scripts/lint.ts` 改呼叫 01 的 `writeFileAtomic`;`npm run boundaries` 紅就在 `scripts/boundaries.allow.json` 加一條例外,理由寫「§11b 只留一份實作(T7)」。**不要為了避開守門又在 lint 留一份。**
- 「一行」= 不留第二份邏輯;`mkdirSync` 加一行轉呼叫可以(`appendLogEvent` 同)。
- **向量檔放 `packages/core/src/schema/atomic-write.vectors.json`**,跟著唯一那份實作的正主(01)放;不放 `contracts/fixtures/`(落點在 contracts 的工作和任何工作都互斥,會讓 T7 不能和 T2b 修補輪、T5 並行)。Rust 用 `include_str!` 讀同一個檔。要不要提升進 `contracts/fixtures/`,等 1.4.0 那一批由統籌·契約決定。

## 前置

- 無(`deps: []`)。不碰 `apps/`、不碰 Rust、不碰契約。
- **不能改 `features/01-data-layer/phase-2.feature`**(phase-2 已 done)。

## 起草時已查的兩件事(開工前不用再查,但要知道)

1. **01 phase-2 的步驟定義寫死了舊樣式。** `../../features/steps/data-layer.steps.ts:650` 造的殘檔是
   `` `.reviews.json.${process.pid}.${Date.now()}.tmp` ``,:660-666 斷言下一次 `writeFileAtomic` 之後 `state/` 只剩 `reviews.json`。
   **照裁決保留「清舊樣式殘檔」,這個場景不改步驟也會繼續綠**,所以不用停。
   但它從此只證明「舊樣式會被清」,不證明「新樣式 `<name>.tmp` 的殘檔會被處理」。新樣式那條由驗收 4 的單元測試補(測試 agent 寫)。
2. **建目錄的行為兩邊不一樣。** `atomicWriteJson` 會先 `mkdirSync(dir, { recursive: true })`(`state.ts:38`,有測試
   `state.test.ts:339`「照舊自動建立目標目錄」);`writeFileAtomic` 目標目錄不存在就丟錯(有測試 `atomic-write.test.ts:94`
   「throws when the target directory does not exist」)。兩條測試都要繼續綠,所以 **`atomicWriteJson` = `mkdirSync` + 一行呼叫**,
   `writeFileAtomic` 不建目錄。`appendLogEvent` 同理(`state.ts:91` 先建目錄,`appendLineAtomic` 不建)。
   「改成一行」在這裡的意思是「寫入本身一行」,建目錄那一行留著(技術顧問 2026-10-15 同意)。

## 驗收條件

### A. `writeFileAtomic` 照 §11b 本文

1. 輸入 `writeFileAtomic("<dir>/reviews.json", "X")`(`<dir>` 存在):
   - 系統呼叫順序是 open(`<dir>/reviews.json.tmp`, 'w') → write → fsync(檔案 fd) → close → rename(`reviews.json.tmp` → `reviews.json`)
     → open(`<dir>`) → fsync(目錄 fd) → close;
   - 完成後 `<dir>` 裡只有 `reviews.json`,內容位元組是 `X`。
2. `state.test.ts:141` 那組 describe(`atomicWriteJson · 契約 §11b(ADR-040)`)的每一個 `it`,**不改測試**,對統一後的實作全綠。
   這組現在是透過 `atomicWriteJson` 呼叫;統一後 `atomicWriteJson` 轉呼叫 `writeFileAtomic`,所以它量到的就是 `writeFileAtomic`。
   清理用 `rmSync(force)` 還是 `unlinkSync`,要讓這組測試的 `node:fs` mock(`state.test.ts:62`)觀察得到;**不能為了讓它綠去改 mock**。
3. `atomic-write.test.ts` 的既有測試全綠,**不改測試**。其中 :103 與 :118 用的是舊樣式殘檔名(`.reviews.json.12345.999.tmp`、
   `.weekly.json.1.2.tmp`):前者要被清、後者(別的目標檔的殘檔)不能被碰。
4. 新增的單元測試(測試 agent 寫):

   | 輸入 / 狀態 | 預期 |
   |---|---|
   | 寫之前 `<dir>/reviews.json.tmp` 已存在(內容 `"stale"`) | 寫入成功;`reviews.json` 是新內容;`<dir>` 裡沒有 `reviews.json.tmp` |
   | 寫之前 `<dir>/.reviews.json.1.2.tmp`(舊樣式)存在 | 寫入成功;舊樣式殘檔被刪 |
   | 寫之前 `<dir>/weekly.json.tmp` 存在 | 寫 `reviews.json` 不碰它 |
   | rename 丟 `EXDEV` | 丟出的是那一顆 `EXDEV` 本身;`reviews.json.tmp` 不存在;`reviews.json` 原位元組不動 |
   | rename 丟錯,而且刪 tmp 也丟錯 | 丟出的仍是 rename 那一顆 |
   | 目錄 fsync 丟 `EINVAL` | 成功 |
   | 目錄 fsync 丟 `EIO` | 丟出 `EIO`;`reviews.json` **已經**是新內容(rename 已完成,這是 §11b 的實際語意) |
   | 目錄 fsync 丟 `ENOSPC` | 丟出 `ENOSPC` |
   | 成功、以及目錄 fsync 丟錯 | 兩條路徑開過的 fd(檔案的與目錄的)全部關掉 |

### B. 只留一份

5. `ingest/state.ts` 的 `atomicWriteJson`:除了 `mkdirSync` 與 `JSON.stringify`,寫入本身是**一行**呼叫 `writeFileAtomic`;
   `state.ts` 不再 import `renameSync`、`fsyncSync`、`openSync`、`writeSync`、`closeSync`、`rmSync`、`appendFileSync`。
   **靜態檢查**(測試 agent 寫,放進一般測試):`packages/core/src/ingest/state.ts` 的非註解程式碼裡,上面這七個名字零命中。
6. `appendLogEvent`:`mkdirSync` + 一行呼叫 `appendLineAtomic(logPath, JSON.stringify(event))`。寫出的位元組不變
   (`JSON.stringify(event) + '\n'`),`readLogEvents` 讀回來一樣。
7. 寫入位元組不變:`atomicWriteJson(p, {a: 1})` 寫出的仍是 `"{\n  \"a\": 1\n}\n"`(2 空格縮排 + 結尾換行,`state.test.ts:339`)。
8. **lint 的第三份拿掉**:`../../scripts/lint.ts:85` 改呼叫 01 的 `writeFileAtomic`(寫 `state/lint-report-<日期>.md`,位元組不變);`packages/core/src/lint/atomic-write.ts` 刪掉,`../../packages/core/src/lint/index.ts:6` 的 `export * from './atomic-write.js'` 一併拿掉。`lint/atomic-write.test.ts` 由測試 agent 刪掉或改成測 `writeFileAtomic`(開發 agent 不碰)。`scripts/lint.ts` 歸 09-lint(`../../scripts/boundaries.owners.json:108`),所以這是 09→01 的 import。
   **靜態檢查**:`packages/core/src/lint/` 與 `scripts/lint.ts` 的非測試程式碼裡 `renameSync`、`fsyncSync` 零命中。
9. **`scripts/degraded-report.ts` 的登記跟著改**:它的「沒有計數的退化分支」登記表(`:115-117`)指名了三個清理點:`ingest/state.ts` 的 `rmSync(tmp, { force: true });`、`schema/atomic-write.ts` 的 `unlinkSync(tmp);`、`lint/atomic-write.ts` 的 `ops.unlinkSync(tmp);`。統一之後前兩筆的位置或片段會變、第三筆的檔不存在。改成只剩 `schema/atomic-write.ts` 一筆,片段對上新的清理那一行;`npm run witness:degraded` 的輸出裡這幾個檔不得出現「片段已搬走」。
10. `npm run boundaries` 綠。`02-ingest-pipeline → 01-data-layer` 的邊已經在 `scripts/boundaries.allow.json`(第一筆),
   **reason 要補一句「§11b 寫入與 log append 用 01 的 writeFileAtomic / appendLineAtomic(T7)」**,不新增另一筆。
   09→01 若紅,新增一筆 `{ "from": "09-lint", "to": "01-data-layer", "reason": "§11b 只留一份實作(T7):scripts/lint.ts 寫 state/lint-report 用 01 的 writeFileAtomic" }`。

### C. 共用向量(給 Rust)

11. 把驗收 A4 那張表(加上 A1 的順序)抽成 **`packages/core/src/schema/atomic-write.vectors.json`**,TS 測試從檔案讀;**Rust 的 T2b 修補輪與 T2c-1 用 `include_str!` 讀同一份**。每一列至少有:向量名、注入(哪個呼叫在第幾次丟什麼錯誤碼)、預期(丟出哪個錯誤碼或成功、目錄裡剩哪些檔、目標的位元組)。
    TS harness 要斷言**列數與列名**等於一份寫在測試裡的清單:向量檔被刪一列而測試仍綠,就是向量與實作脫鉤。
    `npm run boundaries` 不管 `.json`;`apps/desktop` 的 Rust 讀 01 的檔不經 TS import,不需要邊界例外。

### D. 驗收時

12. 一般測試全綠(`VITEST_MAX_WORKERS=1`);01 phase-2 的 cucumber 全綠(不改 `.feature`、不改步驟定義)。
13. 對 `packages/core/src/schema/atomic-write.ts` 跑 Stryker(要先拿 CPU 位子與鎖),存活的變異體逐一列出,標「補測試」或「等價,理由」。
14. `must_catch` 逐條照 `worker-acceptance` 流程做。

## 已裁(技術顧問 2026-10-15)

1. `lint/atomic-write.ts` 併進本張(見驗收 B8)。
2. 「一行」= 不留第二份邏輯,`mkdirSync` 留著(見「起草時已查的兩件事」2)。
3. 向量檔放 `packages/core/src/schema/atomic-write.vectors.json`(見驗收 C11)。

## 預算

`budget_usd: 4`(技術顧問裁定)。依據:grok 小票實績 $0.9–2.6(協調者回報);本張是三份實作併成一份加測試,不碰 Rust。驗收另計(cpu heavy:Stryker)。**實際超過 2 倍($8)要在報告標出來。**

## 測試誰寫

- 測試 agent:驗收 A4 的新測試、B5 與 B8 的靜態檢查、C11 的向量檔與 TS 讀檔 harness、`lint/atomic-write.test.ts` 的刪除或改寫。
- 開發 agent(worker-grok):只改實作,不改測試、不改 `.feature`、不改步驟定義。既有測試要改才能綠,就停下回報協調者。
- 驗收:照 `worker-acceptance`。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底 `origin/main`,同一時間一個 agent。派工歸協調者。
