---
id: T19
deps: []
touches: [packages/core/src/ingest/generate-cards.ts]
cpu: light
budget_usd: 1
status: todo
owner: worker-grok
must_catch:
  - regenerate 回應只有 title 與 body(沒有 examples、沒有 lines)時,generateCards 丟「格式不正確」而不是接受(現況)
  - regenerate 回應有 lines 時,接受的卡的 lines 被換成回應裡的(應永遠是原卡的 lines);或回應的 lines 是亂值(字串、NaN、長度 3)就丟錯
  - regenerate 回應沒有 examples 時,卡的 examples 變成 undefined 或空陣列(應保留原卡的 examples);有 examples 時沒有採用
  - regenerate 回應的 title 被採用(應保留原卡的 title:prompt 規定「不要改變 title」)
  - 動到批次回應(cards.md)的解析:缺 lines、lines 長度不是 2 時應仍然丟錯(第一批的嚴格檢查不能被一併放寬)
  - regenerate 回應 body 不是字串、不是陣列、不是合法 JSON、是空陣列時,沒有丟錯(或錯誤訊息裡沒有 regenerate)
  - 用 golden 基準裡真的 regenerate 輸出(含模型回顯的 golden / category / source 欄位)餵進去時失敗
  - 重試三次仍超長時,parked 的 lines 不是原卡的 lines,或 attempts 少記一次
  - 動到 contracts/(source_ref 的格式、lines 欄位)
---

# 工單 T19:regenerate 的回應不要求 `lines`(02-ingest-pipeline 生產路徑的解析器)

> 狀態:草稿,待技術顧問審(派令來自顧問,經協調者 2026-10-16)。優先度:**中**,排在 T17 之後。
> 作者:統籌·契約(規格)。紅測試:-ed(用**生產路徑**證明現況會失敗)。開發:worker-grok。派工:協調者。
> 這份檔是工單唯一的正本。**沒有改 `prompts/`(不需要 golden run);沒有改 `contracts/`(不需要 ADR)。**

## 起因與查證(我讀過的現況)

`packages/core/src/ingest/generate-cards.ts` 的字數重試流程:第一次回應(`cards.md`)超過 100 字的卡,最多再呼叫 `regenerate` 兩次(`MAX_ATTEMPTS = 3`)。

- **解析器只有一個**:`callAndParse` → `parseCardCandidates`,批次回應與 regenerate 回應共用。它要求每一筆 `title`(字串)、`body`(字串)、`examples`(陣列)、`lines`(長度 2 的陣列),少一個就丟 `ingest.cards 回應第 N 筆格式不正確`。
- **regenerate 的 prompt 沒有行號**:`buildRegeneratePrompt` 只送 `category`、`source`、`title`、`limit`、`previous body`;`regenerate.md` 說「回傳格式跟 ingest.cards 一樣,但只回傳這一張卡的 JSON 陣列(單一元素)」,沒有叫模型附 `lines`。模型沒有任何理由知道要回行號。
- **regenerate 的回應裡,`lines`、`title` 從來沒被用到**:迴圈只取 `regenerated.body` 與 `regenerated.examples ?? current.examples`,其餘照 `current`(`{ ...current, body, examples }`)。`lines` 是原卡的(切自 raw 的位置),下游 `ingest.ts` 用它算 `source_ref: raw/<cat>/<file>#L<a>-L<b>`(經 `clampLines`)。
- **2026-10-15 的真模型基準**(`golden/ingest.regenerate/2026-10-15/regenerate-*.output.json`)的回應只有 `title` 與 `body`(加上模型回顯的 header 欄位 `golden`、`category`、`source`),**沒有 `examples`、沒有 `lines`**。
- **我在 `dc2a4c1` 上用生產路徑(`generateCards`,假 router)實測**:

  | regenerate 的回應 | 結果 |
  |---|---|
  | `[{title, body, examples, lines}]`(完整形狀) | 通過(`lines` 被忽略,卡的 `lines` 是原卡的) |
  | `[{title, body, lines}]`(沒有 examples) | **丟「格式不正確」** |
  | `[{title, body}]`(基準的形狀) | **丟「格式不正確」** |

  現有測試(`generate-cards.test.ts`、`ingest.test.ts` 的 `regenerateOnceRouter`)的 regenerate 回應全是完整形狀,所以沒抓到。**結論:真模型跑 regenerate 時,只要模型照 prompt 乖乖只回 `title`/`body`,整次 ingest 就以解析錯誤失敗。**

### `lines` 是不是契約硬約定?(協調者問的)

**不是,不需要問使用者,也不需要 ADR。**

- 契約 `types.md` 只有 `source_ref?: string`(`source==='raw'` 必填,格式 `raw/<cat>/<file>#L<a>-L<b>`,第 57 行)——**磁碟格式的硬約定是 `source_ref` 這個字串**。
- `lines: [number, number]` 只是**模型回應的 JSON 形狀**(`CardCandidate`,02 內部型別),不是磁碟格式、不在契約裡。
- 這張工單**不動 `source_ref` 的來源**:它永遠由**原卡的** `lines` 算出,regenerate 前後不變(原卡的來源引用保留——regenerate 只是把同一張卡講得更精簡,不是新的一張卡,見 `regenerate.md`「不要引入新概念」)。

## 要求

只改 `packages/core/src/ingest/generate-cards.ts`。

1. **批次回應(`cards.md`)的解析不動**:`parseCardCandidates` 的檢查(`title`、`body`、`examples`、`lines` 長度 2)一個字都不放寬。
2. **新增 regenerate 專用的解析**(例如 `parseRegenerated(text): { body: string; examples?: string[] }`),規則:
   - 不是合法 JSON、不是陣列 → 丟錯,訊息含 `regenerate`;空陣列 → 沿用既有的 `regenerate 回應沒有回傳卡片`;多於一筆 → 取第一筆(既有行為)。
   - 第一筆必須是物件而且 `body` 是字串;否則丟錯,訊息含 `regenerate`,並附上那筆(同批次的訊息格式)。
   - `examples`:**沒有這個欄位 → 保留原卡的 `examples`**(不是 `undefined`、不是 `[]`);**有 → 必須是字串陣列**,是就採用,不是(例如 `"abc"`、`[1]`)就丟錯。
   - `title`:**忽略**(保留原卡的 title;prompt 規定不改 title)。**`lines`:忽略**——不論缺、有、或是亂值(字串、NaN、長度 3)都不驗證、不採用、不丟錯。**其他未知欄位**(基準上的 `golden`、`category`、`source`)一律忽略。
3. `generateCards` 的重試迴圈改用新解析;`accepted` 的卡永遠是 `{ ...current, body: <新>, examples: <新或原> }`,`lines`/`title` 不變;`parked` 的 `lines` 是原卡的、`attempts` 每次都記(第 1 次是原卡)。
4. 不改 `buildRegeneratePrompt`、不改 `regenerate.md`(那是 prompt,要 golden run;模型現在本來就不附 `lines`,解析器配合現實)。
   後續如果要把 prompt 那句「回傳格式跟 ingest.cards 一樣」改清楚(明說「只需要 title 與 body」),是另一張要跑 golden run 的工單,不在這裡。

## 測試(-ed 寫;開發不改)

| 驗收 | 量什麼 | 怎麼量 |
|---|---|---|
| 要求 2 | **生產路徑**:`generateCards(router, opts)`,第一次回應超長、第二次回應是基準形狀 `[{title, body}]`(再加 `[{title, body, lines}]`、`[{title, body, examples}]`、完整形狀)→ 每種都被接受,卡的 `lines`/`title` 是原卡的,`examples` 依規則 | vitest,假 router |
| 要求 2 | 回應的 `lines` 是別的值(`[99, 100]`、`"x"`、`[1]`、`[1,2,3]`)→ 接受,`lines` 仍是原卡的 | 同上 |
| 要求 2 | 錯誤:非 JSON、非陣列、空陣列、`body` 不是字串、`examples` 不是字串陣列 → 丟錯,訊息含 `regenerate` | 同上 |
| 要求 1 | 批次回應缺 `lines` / `lines` 長度 3 / 缺 `examples` → 仍丟錯(嚴格版不變) | 同上 |
| 要求 3 | 三次仍超長 → `parked`,`lines` 是原卡的,`attempts` 有 3 筆;第二次合格 → `regenerateEvents` 是 1 | 同上 |
| 端到端 | `runIngest`(假 router,regenerate 回應是基準形狀)→ 卡檔寫出,front-matter 的 `source_ref` 是原卡 `lines` 算出的 `raw/<cat>/<file>#L<a>-L<b>`,日誌有一筆 `regenerate` 事件 | `ingest.test.ts` 風格,暫存目錄 |
| 真實形狀 | 把 `golden/ingest.regenerate/2026-10-15/regenerate-*.output.json` 的 `text`(含 `golden`/`category`/`source` 回顯欄位)當 regenerate 回應餵進去 → 被接受(這些 body 本身可能仍超長,測試用字數合格的 body 取代,只保留欄位形狀) | 讀檔,不改檔 |

- 在 `dc2a4c1` 上預期:基準形狀、沒有 examples 的形狀、端到端、真實形狀 **紅**(解析錯誤);完整形狀、批次嚴格檢查、parked 本來就綠。
- 紅測試用暫存目錄;不呼叫真的 LLM。

## 排程與互斥

- **touches 只有 `packages/core/src/ingest/generate-cards.ts`**(測試檔 `generate-cards.test.ts` 由 -ed 動)。
- 與 **T18**(`ingest/children.ts`、`ingest/siblings.ts`、`ingest/index.ts` …)**沒有檔案重疊**,但同在 `packages/core/src/ingest/`;若協調者要照 R2 把「同一資料夾」也當互斥,排在 T18 之後或之前都可以,沒有順序依賴。
- 與 **T17**(`packages/core/src/session/`、`scripts/review.ts`)沒有重疊。
- 只用 `generateCards` 的呼叫端(`ingest.ts`)不用改。

## 不在範圍

- 不改 `prompts/`(含 `regenerate.md`)、不改 `contracts/`、不改 `buildRegeneratePrompt`、不改批次解析。
- 不處理 regenerate 回應的語意品質(是不是真的精簡、有沒有引入新概念):那是 golden 評分與顧問的事(T12 已處理)。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest
npm run boundaries
```

不跑 `--live`、不跑變異測試(-ed 的事)、不跑 `check:all`、不碰真的 `learning/`。

## 預算

`budget_usd: 1`(worker 草估,無 $ 上限只記錄)。純函式與解析,不需要真呼叫。
