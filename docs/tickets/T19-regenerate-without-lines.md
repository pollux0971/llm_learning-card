---
id: T19
deps: []
touches: [packages/core/src/ingest/generate-cards.ts, packages/core/src/ingest/ingest.ts]
cpu: light
budget_usd: 1
status: todo
owner: worker-grok
must_catch:
  - regenerate 回應只有 title 與 body(沒有 examples、沒有 lines)時,generateCards 丟「格式不正確」而不是接受(現況)
  - regenerate 回應有 lines 時,接受的卡的 lines 被換成回應裡的(應永遠是原卡的 lines);或回應的 lines 是亂值(字串、NaN、長度 3)就丟錯
  - regenerate 回應沒有 examples、或 examples 是空陣列 [] 時,卡的 examples 變成 undefined 或被清空(應保留目前候選的 examples;T12 第 2 輪的輸出就是 []);或連續多次重寫時回退到第一批的 examples(第 2 次回 ["新"]、第 3 次回 [] → 卡應保留 ["新"],不是回到原卡的)
  - regenerate 回應給了非空的字串陣列 examples 卻沒有替換原卡的;或 examples 格式不對(非陣列、含非字串或空字串)時丟錯或被半採用(應整個忽略、保留目前候選的 examples)
  - 重寫後 body 仍超過 100 字(契約 §2)的卡被寫成卡片檔(應整張不寫、進 needs-review.json、記一筆 warning);或字數判斷和寫檔前把關的 `validateCard` 不是同一條路(例如還用 `word-count-min.ts` 的複本——兩邊的圍欄正則不同,開閉在同一行的圍欄會算出不同數字)
  - regenerate 回了不只一筆時:丟錯,或第二筆以後被驗證/採用,或沒有記那一筆 warning,或批次(cards.md)的多筆語意被改動
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
> 2026-10-16 顧問補兩點:examples 缺少或 `[]` 都保留目前候選的、重寫後仍要過 §2 字數驗證(見要求 2、4)。
> 2026-10-16 顧問三題裁決(Q1–Q3):examples 以「目前候選」為準;回應多於一筆取第一筆但記一筆 warning;字數判斷與 `validateCard` 同一條路(見要求 2、4)。touches 因此補上 `ingest.ts`(只准加讀 `warnings` 並記 warning 的幾行)。
> 這份檔是工單唯一的正本。**沒有改 `prompts/`(不需要 golden run);沒有改 `contracts/`(不需要 ADR)。**

## 起因與查證(我讀過的現況)

`packages/core/src/ingest/generate-cards.ts` 的字數重試流程:第一次回應(`cards.md`)超過 100 字的卡,最多再呼叫 `regenerate` 兩次(`MAX_ATTEMPTS = 3`)。

- **解析器只有一個**:`callAndParse` → `parseCardCandidates`,批次回應與 regenerate 回應共用。它要求每一筆 `title`(字串)、`body`(字串)、`examples`(陣列)、`lines`(長度 2 的陣列),少一個就丟 `ingest.cards 回應第 N 筆格式不正確`。
- **regenerate 的 prompt 沒有行號**:`buildRegeneratePrompt` 只送 `category`、`source`、`title`、`limit`、`previous body`;`regenerate.md` 說「回傳格式跟 ingest.cards 一樣,但只回傳這一張卡的 JSON 陣列(單一元素)」,沒有叫模型附 `lines`。模型沒有任何理由知道要回行號。
- **regenerate 的回應裡,`lines`、`title` 從來沒被用到**:迴圈只取 `regenerated.body` 與 `regenerated.examples ?? current.examples`,其餘照 `current`(`{ ...current, body, examples }`)。`lines` 是原卡的(切自 raw 的位置),下游 `ingest.ts` 用它算 `source_ref: raw/<cat>/<file>#L<a>-L<b>`(經 `clampLines`)。
- **2026-10-15 的真模型基準**(`golden/ingest.regenerate/2026-10-15/regenerate-*.output.json`)的回應只有 `title` 與 `body`(加上模型回顯的 header 欄位 `golden`、`category`、`source`),**沒有 `examples`、沒有 `lines`**。
- **我在 `dc2a4c1`(`428aa88` 同)上用生產路徑(`generateCards`,假 router)實測**:

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

只改 `packages/core/src/ingest/generate-cards.ts`,外加 `packages/core/src/ingest/ingest.ts` 讀 `warnings` 並記錄的幾行(見要求 2);**不改 `schema/`**。

1. **批次回應(`cards.md`)的解析不動**:`parseCardCandidates` 的檢查(`title`、`body`、`examples`、`lines` 長度 2)一個字都不放寬。
2. **新增 regenerate 專用的解析**(例如 `parseRegenerated(text): { body: string; examples?: string[] }`),規則:
   - 不是合法 JSON、不是陣列 → 丟錯,訊息含 `regenerate`;空陣列 → 沿用既有的 `regenerate 回應沒有回傳卡片`;多於一筆 → 取第一筆、後面的**不驗證**(第二筆即使不是物件也不丟錯),並**記一筆 warning**(顧問 Q2)。
     **查證現行語意**:批次(`cards.md`)回應多筆本來就是多張卡、每筆都驗證,**這個語意不變**;regenerate 現行是 `const [regenerated] = …` 靜默丟掉後面的,沒有任何記錄——現在要補上記錄。
     **warning 怎麼記(沿用現有機制:`ingest.ts` 的 `appendLogEvent(... type: 'warning' ...)`)**:`GenerateCardsResult` 新增 `warnings: string[]`(沒有就是 `[]`),`generateCards` 每遇到一次多筆就推一則,文字 `regenerate 回了 N 筆,只用第一筆`(N 是實際筆數,後面可附卡的 title);`runIngest` 對每則記一筆 `{ ts, type: 'warning', file: rawRelPath, message }`,記在 parked 的 warning 之前或之後都行。**`ingest.ts` 只准加這幾行**(讀 `generated.warnings` 並記錄,與把本地型別標註補上 `warnings`);其他一行都不動。
   - 第一筆必須是物件而且 `body` 是字串;否則丟錯,訊息含 `regenerate`,並附上那筆(同批次的訊息格式)。
   - `examples`(顧問 2026-10-16:模型不寫 examples 多半是沒想到、不是想刪,為了一張重寫卡丟掉原本好的例子等於預設丟棄,ADR-050 不行):
     **缺少、或是空陣列 `[]` → 保留目前候選的 `examples`**(「目前候選」= 上一次有效的:第一次重寫前是原卡的,之後是上一次被採用的重寫結果;`[]` 的意思是模型這次沒寫例子,不是要回退。例:第 2 次回 `["新"]`、第 3 次回 `[]` → 卡保留 `["新"]`。T12 第 2 輪的 regenerate 輸出就是 `[]`);**只有給了非空、而且每一項都是非空字串(去頭尾空白後)的陣列才替換**。
     **格式不對**(不是陣列、含非字串、含空字串)→ **整個忽略、保留目前候選的 `examples`,不丟錯**(不要為了一個旁枝欄位讓一次 ingest 失敗;也不要半採用:`["ok", 1]` 整個不採用)。
   - `title`:**忽略**(保留原卡的 title;prompt 規定不改 title)。**`lines`:忽略**——不論缺、有、或是亂值(字串、NaN、長度 3)都不驗證、不採用、不丟錯。**其他未知欄位**(基準上的 `golden`、`category`、`source`)一律忽略。
3. `generateCards` 的重試迴圈改用新解析;`accepted` 的卡永遠是 `{ ...current, body: <新>, examples: <新或原> }`,`lines`/`title` 不變;`parked` 的 `lines` 是原卡的、`attempts` 每次都記(第 1 次是原卡)。
4. **重寫完的卡照樣要過字數驗證(契約 §2)**。查證現況(`dc2a4c1`/`428aa88`):
   - `generateCards` 每次重寫後用 `countBodyWords(current.body) > 100` 決定要不要再重寫;三次仍超長 → `parked`(`ParkedCandidate`,`attempts` 記每一次的 body 與字數)。**沒有通過的卡不會被寫成卡片檔。**
   - `runIngest` 對 `parked` 已有現成的處理(parked 的這一段**不用改**):`state/needs-review.json` 追加一筆 `{ category, title, source, lines, reason: 'body_over_limit', attempts, recordedAt }`,
     並在 `state/log.jsonl` 記**一筆** `type: 'warning'`(`file`、`message: "N 張卡因字數超過上限被暫緩,見 needs-review.json"`)——這就是「記一筆 warning」的現有機制,沿用,不另造。
   - **「原卡保留」的意思**:第一批的原 body 本來就超過 100 字、不能寫成卡片檔;它連同每次重寫的結果留在 `needs-review.json` 的 `attempts[0]`(`attempt: 1`),人可以回頭處理。**請顧問確認這個讀法**(我的理解:你說的「原卡保留」= 不蓋掉、不丟掉原本的內容)。
   - **字數判斷必須和寫檔前後把關的 `validateCard` 一模一樣**(顧問 Q3)。**查證**:`validateCard`(`schema/validate-card.ts`)的字數 = `countWords(parseCardText(raw).body)`,其中圍欄由 `parseCardText`(`schema/parse-card.ts`,正則 ``` /```example\r?\n([\s\S]*?)```/g ```)移除並 trim,`countWords` 是 `schema/word-count.ts` 的;`schema` 裡**沒有**單獨 export 的 `stripExampleFences`。而 `word-count-min.ts` 另有一份圍欄正則(`\n?` 可有可無)——兩邊對「開閉在同一行的圍欄」算法不同(契約 §2 把這種情況列為尚未定義,本工單不定義它,只要求和 `validateCard` 走同一條路)。
     **做法(不需要改 `schema/`,touches 不加 schema)**:`parseCardText` 與 `countWords` 都已由 `@core/schema/index.js` export。`generate-cards.ts` 用 `countWords(parseCardText(CARD_FILE_PREFIX + body.trim() + '\n').body)` 當唯一的字數函式,`CARD_FILE_PREFIX = '---\n---\n\n'`(與 `ingest.ts` 的 `writeCardFile` 寫出的檔案同形:front matter 之後空一行再接 body;前綴只是讓 `parseCardText` 的 `gray-matter` 不把以 `---` 開頭的 body 當成 front matter)。已查證 `gray-matter` 對空 front matter 回 `{}`、body 原樣保留。這個函式同時給 `attempts[].wordCount`、重試判斷、接受判斷用。
     **不再用 `word-count-min.ts` 的 Wave 0 複本**(那個檔頭自己寫了「I1 整合後改用 01-data-layer 的正式驗證器」;`countWords` 演算法現在一致、圍欄正則不一致,而且各自一份遲早漂移;ADR-060、ADR-070 的教訓是:各自一份遲早漂移)。
     `BODY_WORD_LIMIT` 仍是 100。`word-count-min.ts` 本身不刪(別處還在用,不在這張範圍)。
   - 寫成卡片檔之後 `runIngestPipeline` 還會用 `validateCard` 讀回驗證;這一步不改。
5. 不改 `buildRegeneratePrompt`、不改 `regenerate.md`(那是 prompt,要 golden run;模型現在本來就不附 `lines`,解析器配合現實)。
   後續如果要把 prompt 那句「回傳格式跟 ingest.cards 一樣」改清楚(明說「只需要 title 與 body」),是另一張要跑 golden run 的工單,不在這裡。

## 測試(-ed 寫;開發不改)

| 驗收 | 量什麼 | 怎麼量 |
|---|---|---|
| 要求 2 | **生產路徑**:`generateCards(router, opts)`,第一次回應超長、第二次回應是基準形狀 `[{title, body}]`(再加 `[{title, body, lines}]`、`[{title, body, examples}]`、完整形狀)→ 每種都被接受,卡的 `lines`/`title` 是原卡的,`examples` 依規則 | vitest,假 router |
| 要求 2 | **examples**:缺少、`[]` → 目前候選的 examples;`["新"]` → 替換;`"abc"`、`[1]`、`["ok", 1]`、`[""]`、`null` → 整個忽略、保留目前候選的,不丟錯 | 同上 |
| 要求 2(Q1) | **連續多次重寫**:第 2 次回 `["新"]`、第 3 次回 `[]`(或格式不對)→ 卡的 examples 是 `["新"]`;第 2 次回 `[]`、第 3 次回 `["新"]` → `["新"]` | 同上 |
| 要求 2(Q2) | **回應多於一筆**(`[A, B]`):只用 A、B 不驗證(B 即使不是物件也不丟錯)、`log.jsonl` 剛好一筆 `type: 'warning'` 含「regenerate 回了 2 筆,只用第一筆」;只有一筆時沒有這筆 warning;**批次回應多筆照舊每筆都是一張卡**(語意不變) | 同上(`runIngest`,暫存目錄) |
| 要求 2 | 回應的 `lines` 是別的值(`[99, 100]`、`"x"`、`[1]`、`[1,2,3]`)→ 接受,`lines` 仍是原卡的 | 同上 |
| 要求 2 | 錯誤:非 JSON、非陣列、空陣列、第一筆不是物件、`body` 不是字串 → 丟錯,訊息含 `regenerate`(`examples` 格式不對**不**丟錯,見上一列) | 同上 |
| 要求 1 | 批次回應缺 `lines` / `lines` 長度 3 / 缺 `examples` → 仍丟錯(嚴格版不變) | 同上 |
| 要求 4 | **超長的重寫**:第二、三次回應的 body 仍超過 100 字(§2 算法,含英數序列與標點切斷的邊界:101 字 → 不通過、100 字 → 通過)→ `parked`、**沒有卡片檔**、`needs-review.json` 多一筆(`reason: 'body_over_limit'`,`attempts[0].body` 是原 body,`attempts` 有 3 筆)、`log.jsonl` 剛好一筆 `warning`、`regenerateEvents` 是 0(`runIngest`,假 router,暫存目錄) | vitest |
| 要求 4(Q3) | 字數判斷與 `validateCard` **同一條路**:同一批邊界字串(CJK、英數序列、連字號切斷 `same-origin` = 2、example 圍欄內不算、body 以 `---` 開頭、body 含多個圍欄)→ `generateCards` 的接受/暫緩判斷與 `validateCard(組好的卡檔文字).bodyWordCount > 100` 一致(卡檔文字照 `ingest.ts` 的 `writeCardFile` 組);101 字不通過、100 字通過。**不測開閉在同一行的圍欄**(契約 §2 未定義,見 T20) | vitest 差分 |
| 要求 3 | 三次仍超長 → `parked`,`lines` 是原卡的,`attempts` 有 3 筆;第二次合格 → `regenerateEvents` 是 1 | 同上 |
| 端到端 | `runIngest`(假 router,regenerate 回應是基準形狀)→ 卡檔寫出,front-matter 的 `source_ref` 是原卡 `lines` 算出的 `raw/<cat>/<file>#L<a>-L<b>`,日誌有一筆 `regenerate` 事件 | `ingest.test.ts` 風格,暫存目錄 |
| 真實形狀 | 把 `golden/ingest.regenerate/2026-10-15/regenerate-*.output.json` 的 `text`(含 `golden`/`category`/`source` 回顯欄位)當 regenerate 回應餵進去 → 被接受(這些 body 本身可能仍超長,測試用字數合格的 body 取代,只保留欄位形狀) | 讀檔,不改檔 |

- 在 `428aa88` 上預期:基準形狀、沒有 examples 的形狀、`examples: []` 的形狀、端到端、真實形狀 **紅**(解析錯誤);完整形狀、批次嚴格檢查、超長重寫的 parked 與 warning(現有機制)、字數差分 **本來就綠**(防退步)。
- 紅測試用暫存目錄;不呼叫真的 LLM。

## 排程與互斥

- **touches 是 `packages/core/src/ingest/generate-cards.ts` 與 `ingest.ts`(只加 warnings 那幾行)**;**不動 `schema/`**。測試檔由前端(紅測試作者)動。
- 與 **T18**(`ingest/children.ts`、`ingest/siblings.ts`、`ingest/index.ts` …)**沒有檔案重疊**,但同在 `packages/core/src/ingest/`;若協調者要照 R2 把「同一資料夾」也當互斥,排在 T18 之後或之前都可以,沒有順序依賴。
- 與 **T17**(`packages/core/src/session/`、`scripts/review.ts`)沒有重疊。
- `ingest.ts` 是 `generateCards` 的呼叫端,只加讀 `warnings` 並記 warning 的幾行;`GenerateCardsResult` 多一個欄位不影響其他呼叫端(`warnings` 恆存在)。

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
