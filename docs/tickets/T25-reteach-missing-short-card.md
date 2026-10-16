---
id: T25
deps: []
touches: [packages/core/src/session/present.ts, packages/core/src/session/types.ts, packages/core/src/session/io.ts, scripts/review.ts]
cpu: light
budget_usd: 1
status: todo
owner: worker-grok
must_catch:
  - 連錯兩次的卡(`fails_in_row === 2`)沒有 `<id>.short.md` 時,`presentNextCard` 仍然丟「找不到卡片檔案」,終端機 review 整個停掉(現況)
  - 讀不到縮短版時沒有退回原卡:回的 `shortBody` 是空字串、`undefined`,或不是原卡 `<id>.md` 的 body(不含 frontmatter、不含 example 圍欄)
  - 退回原卡時沒有記 warning,或記了不只一筆(同一張卡同一次 session 只記一筆),或 warning 帶了絕對路徑、卡片內容
  - 連原卡 `<id>.md` 也不存在時被吞掉(應照舊丟錯:卡不存在是磁碟壞掉的徵兆,不是縮短版缺檔)
  - 縮短版存在時行為改變(`shortBody` 不是縮短版的內容,或多記了 warning)
  - 退回原卡時動到了 reteachQueue 以外的狀態:session.current、progress 計數(`index`/`total`)、passed/failed/errors(對照 phase-1「it is not counted in the progress」)
  - 動到 `contracts/`、`learning/` 的檔案格式,或在 `learning/` 底下新增任何檔案(縮短版缺檔不要自動補生)
---

# 工單 T25:連錯兩次的卡沒有縮短版時,退回只顯示原卡(不要讓複習停掉)

> 狀態:草稿,待技術顧問審(派令來自顧問,經協調者 2026-10-16)。優先度:**高於 T22**(現在就會發生)。
> 作者:統籌·契約(規格)。紅測試:-ed。開發:worker-grok。派工:協調者。
> 這份檔是工單唯一的正本。**不改 `prompts/`、不改 `contracts/`、不需要 ADR。**

## 起因與查證

`packages/core/src/session/present.ts` 的 `presentNextCard`:`reteachQueue` 還有卡時,取一張並呼叫 `loadCardBody(learningDir, card, { short: true })`(`present.ts:78-79`)。
`loadCardBody` 走 `findCardFile`,找不到檔就 `throw new Error('找不到卡片檔案:<id>.short.md(learningDir=…)')`(`io.ts:90`)。

`reteachQueue` 來自 `deriveReteachQueue`(`build.ts:46`):**今天到期、而且 `fails_in_row === 2` 的卡**。也就是一張卡連續答錯兩次,下一次複習前要先看縮短版。

- **縮短版是誰產的**:目前 ingest 沒有產 `.short.md`(`reteach.short` 任務在契約 §7,但管線還沒接);**真 vault 目前沒有任何縮短版**。
- **後果**:任何一張卡連錯兩次、之後到期的那一天,終端機 `scripts/review.ts` 的 `runInteractive` 在 `presentNextCard` 丟出未捕捉的錯 → `main().catch` 印訊息、`process.exit(1)`,**整個複習停掉**,今天剩下的卡都問不到。這不是假設:只要有人把一張卡連錯兩次就會發生。
- 桌面版(T22/T24)走同一份 core,會繼承同一個炸點。

## 要求

只改 core 的呈現層(`present.ts`),外加必要的型別與終端機顯示。

1. **縮短版讀不到時不丟錯,退回只顯示原卡。**
   - 判斷「讀不到」= `<id>.short.md` **不存在**(`findCardFile` 找不到)。縮短版存在但壞掉(解析失敗)不在這張範圍,照現況(丟錯)——不要把 catch 寫得太寬,吞掉別的錯誤。
     實作建議:不要用 try/catch 包整個 `loadCardBody`;先用 `io.ts` 既有的查檔能力判斷縮短版是否存在(可在 `io.ts` 加一個小的 `shortCardExists`/或讓 `findCardFile` 另有不丟錯的版本——**`io.ts` 若要動,只准加這一個小函式,不改既有函式的行為**;touches 補 `io.ts`)。
   - 退回的內容 = **原卡 `<id>.md` 的 body**(`loadCardBody(learningDir, card)`,不含 frontmatter、不含 example 圍欄)。原卡不存在 → 照舊丟錯(「卡不存在」是真的壞掉,不是縮短版缺檔)。
   - 回傳形狀不變:`{ kind: 'reteach', card, shortBody }`,`shortBody` 放原卡的 body;**新增一個選用欄位 `usedOriginal?: true`**(只有退回時才有),讓顯示端知道這不是縮短版。縮短版存在時**不帶這個欄位**,整個回傳與現況逐位元相同。
2. **終端機顯示**(`scripts/review.ts`):`presentation.usedOriginal` 為真時,標題行改成 `[複習提示,先看過再回答問題] <id>(沒有縮短版,以下是原卡)`;其餘照舊。縮短版存在時輸出與現況逐字相同。
3. **記一筆 warning**,走既有機制:`recordEvent(join(learningDir, 'state/log.jsonl'), { ts, type: 'warning', card, reason: 'short-card-missing' })`(跟 `session/cache.ts` 的 `warnInvalidSessionCache` 同一個寫法與位置)。
   - 欄位只有 `ts`、`type`、`card`、`reason`;**不寫絕對路徑、不寫卡片內容**。
   - **同一次 session、同一張卡只記一筆**(`presentNextCard` 把卡從 `reteachQueue` shift 掉,所以自然只呼叫一次;不要因為重試或重新呈現而重複記)。
   - 記錄失敗(例如 log 寫不進去)**不可以讓複習停掉**:包起來吞掉,只吞這一步。
4. 不改 progress、不動 `session.current`、不動 passed/failed/errors(跟縮短版存在時一樣,見 `present.ts` 檔頭第 1 點)。
5. 不自動補生縮短版(那是 `reteach.short` 任務與 ingest 的事,另開票)。

## 測試(-ed 寫;開發不改)

| 驗收 | 量什麼 | 怎麼量 |
|---|---|---|
| 要求 1 | `reteachQueue` 有一張卡、沒有 `.short.md`、有原卡 → `presentNextCard` 不丟錯,回 `{ kind: 'reteach', card, shortBody: <原卡 body>, usedOriginal: true }`(body 不含 frontmatter 與 example 圍欄) | vitest,暫存目錄(`present.test.ts` 風格) |
| 要求 1 | 縮短版存在 → 回傳與現況逐位元相同(`toEqual` 且**沒有** `usedOriginal` 這個鍵);原卡也不存在 → 仍丟錯,訊息含檔名 | 同上 |
| 要求 1 | 縮短版存在但壞掉(frontmatter 解析失敗)→ 仍丟錯(不吞) | 同上 |
| 要求 3 | 退回時 `state/log.jsonl` 剛好多一行 `type: 'warning'`、`reason: 'short-card-missing'`、`card` 是該卡;沒有絕對路徑(整行 `grep` 不到 `learningDir`)、沒有卡片內容;縮短版存在時**沒有**這行;log 目錄不可寫時不丟錯 | 同上 |
| 要求 4 | 退回後 `session.current`、`queue`、`totalDue`、passed/failed/errors 不變;下一次 `presentNextCard` 照常出該卡的第一題 | 同上 |
| 要求 2 | 終端機:連錯兩次的卡沒有縮短版 → `scripts/review.ts` 不中止,輸出含「沒有縮短版,以下是原卡」,之後問該卡的題目,退出碼 0 | cucumber 步驟或 CLI 整合測試(見下「場景」) |
| 不退步 | `present.test.ts`、`io.test.ts`、T17 的 `cache*.test.ts`、`summary*.test.ts`、`zero-guard.test.ts` 與 11 的 phase-1/phase-2 場景全綠;**不得放寬任何既有斷言** | vitest + `--tags` 跑 11 的場景 |

### 場景(gherkin 由紅測試作者與步驟定義同一批進 main)

規格場景、紅測試、步驟定義同一批進 main(顧問 2026-10-16)。**11 的 phase-1、phase-2 已 done,不改它們的 .feature**;場景寫進 `features/11-review-cli/phase-3.feature`(新增,全英文,tag `@review-cli @phase-3`),同批補 FEATURE.md phase 表的第 3 列(`todo`→完成時 `done`)與 NEXT.md 的 gate(依賴:自身 phase-2 done)。建議兩個場景:

1. `A card failed twice in a row has no short version` → 複習不中止、先看到原卡與「沒有縮短版」提示、再被問題目、退出碼 0、`log.jsonl` 多一筆 warning。
2. `A card failed twice in a row has a short version` → 與 phase-1 的 reteach 場景相同(縮短版內容、**沒有**提示、**沒有** warning)。

## 排程與互斥

- touches:`packages/core/src/session/present.ts`、`types.ts`(`CardPresentation` 的 reteach 型別加一個選用欄位)、`io.ts`(只准加一個小函式)、`scripts/review.ts`(顯示一行)。
- 與 **T26**(`io.ts` 的 `saveReviews`、`answer.ts`、`build.ts`、`types.ts`)有**檔案重疊**(`io.ts`、`types.ts`、`scripts/review.ts`)→ **不要並行**;T25 先(優先度高),T26 後。
- 與 **T22/T24**(側車、06)沒有檔案重疊,但它們依賴 core 的呈現:T22 之前先合 T25,側車就不會繼承炸點。

## 不在範圍

- 不產生縮短版(`reteach.short` 任務的接線、ingest 的縮短版產出)。
- 不改 reteach 的觸發規則(`fails_in_row === 2`)。
- 不處理「縮短版存在但壞掉」。
- 不改 `contracts/`、`prompts/`。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/session
npm run boundaries
```

不跑 `--live`、不跑變異測試(-ed 的事)、不跑 `check:all`、不碰真的 `learning/`。

## 預算

`budget_usd: 1`(純函式與一行顯示)。
