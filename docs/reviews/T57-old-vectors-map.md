# T57 舊向量測試檔對照表

> 測試 agent 寫(T57,顧問 2026-10-27 裁:T52 留下的六個舊向量檔收斂)。向量檔:`contracts/fixtures/word-count-vectors.json`。
> 每一條「刪」的替身都是向量檔裡存在的列(`features/support/t57-example-fence-guards.test.ts` 的對照表核對會檢查);「留」寫原因。
> 條目是逐列展開的(`it.each` 一列一條);「新增」表示這一列是為了接住舊條目而新加進向量檔的(名字以 `legacy ` 開頭)。

## packages/core/src/schema/word-count.test.ts

整個刪(16 組、全是字面向量)

| 條目 | 處置 |
|---|---|
| counts "TLS handshake needs 3 rounds." as 5 (contract examples) | 刪 → 替身是向量列 `gherkin: TLS handshake needs 3 rounds.` |
| counts "同源政策" as 4 (contract examples) | 刪 → 替身是向量列 `gherkin: 同源政策` |
| counts "同源政策(same-origin policy)" as 7 (contract examples) | 刪 → 替身是向量列 `gherkin: 同源政策(same-origin policy)` |
| counts "a b c d e" as 5 (contract examples) | 刪 → 替身是向量列 `gherkin: a b c d e` |
| counts "一、二、三。" as 3 (contract examples) | 刪 → 替身是向量列 `cut: cjk punctuation between han` |
| counts "TLS 1.3" as 3 (contract examples) | 刪 → 替身是向量列 `gherkin: TLS 1.3` |
| counts "don't" as 2 (contract examples) | 刪 → 替身是向量列 `gherkin: don't` |
| counts "RFC 6265" as 2 (contract examples) | 刪 → 替身是向量列 `gherkin: RFC 6265` |
| counts "" as 0 (contract examples) | 刪 → 替身是向量列 `empty string` |
| shipped word count fixture card (23) | 刪 → 替身是向量列 `legacy word-count #001`(新增) |
| 100 CJK = 100 | 刪 → 替身是向量列 `legacy word-count #002`(新增) |
| 101 CJK = 101 | 刪 → 替身是向量列 `legacy word-count #003`(新增) |
| CJK adjacent to letters/digits "字a" | 刪 → 替身是向量列 `cjk cuts: han then latin` |
| CJK adjacent to letters/digits "a字" | 刪 → 替身是向量列 `legacy word-count #004`(新增) |
| CJK adjacent to letters/digits "在TLS下" | 刪 → 替身是向量列 `cjk cuts: in the middle` |
| CJK adjacent to letters/digits "a字b" | 刪 → 替身是向量列 `cjk cuts: latin both sides` |
| CJK adjacent to letters/digits "1字2" | 刪 → 替身是向量列 `legacy word-count #005`(新增) |
| CJK adjacent to letters/digits "字a字a" | 刪 → 替身是向量列 `legacy word-count #006`(新增) |
| CJK adjacent to letters/digits "TLS1.3在" | 刪 → 替身是向量列 `legacy word-count #007`(新增) |
| CJK adjacent to letters/digits "同源政策same-origin" | 刪 → 替身是向量列 `legacy word-count #008`(新增) |
| 100 CJK then ab = 101 | 刪 → 替身是向量列 `legacy word-count #009`(新增) |
| ab then 100 CJK = 101 | 刪 → 替身是向量列 `legacy word-count #010`(新增) |
| scripts "ひらがな" | 刪 → 替身是向量列 `legacy word-count #011`(新增) |
| scripts "カタカナ" | 刪 → 替身是向量列 `legacy word-count #012`(新增) |
| scripts "한글" | 刪 → 替身是向量列 `legacy word-count #013`(新增) |
| scripts "漢字かなカナ한글" | 刪 → 替身是向量列 `legacy word-count #014`(新增) |
| scripts "ひらがなabc" | 刪 → 替身是向量列 `legacy word-count #015`(新增) |
| scripts "résumé" | 刪 → 替身是向量列 `legacy word-count #016`(新增) |
| scripts "naïve" | 刪 → 替身是向量列 `legacy word-count #017`(新增) |
| scripts "Ελληνικά" | 刪 → 替身是向量列 `legacy word-count #018`(新增) |
| scripts "١٢٣" | 刪 → 替身是向量列 `legacy word-count #019`(新增) |
| consecutive hyphenated words | 刪 → 替身是向量列 `key: same-origin` |
| period inside digits | 刪 → 替身是向量列 `key: 1.5` |
| apostrophe breaks | 刪 → 替身是向量列 `gherkin: don't` |
| long alphanumeric run | 刪 → 替身是向量列 `legacy word-count #020`(新增) |
| repeated separators between words | 刪 → 替身是向量列 `legacy word-count #021`(新增) |
| whitespace only | 刪 → 替身是向量列 `legacy word-count #022`(新增) |
| punctuation and symbols | 刪 → 替身是向量列 `legacy word-count #023`(新增) |
| words separated by newlines | 刪 → 替身是向量列 `legacy word-count #024`(新增) |

## packages/core/src/schema/validate-card.contract-vectors.test.ts

留一條(fixture 是合法的卡),其餘刪

| 條目 | 處置 |
|---|---|
| key table same-origin | 刪 → 替身是向量列 `key: same-origin` |
| key table TLS | 刪 → 替身是向量列 `key: TLS` |
| key table 1.5 | 刪 → 替身是向量列 `key: 1.5` |
| key table don't | 刪 → 替身是向量列 `gherkin: don't` |
| key table 同源政策 | 刪 → 替身是向量列 `gherkin: 同源政策` |
| key table RFC 6265 | 刪 → 替身是向量列 `gherkin: RFC 6265` |
| vector table han | 刪 → 替身是向量列 `vec: han pair` |
| vector table ext A | 刪 → 替身是向量列 `vec: han ext A` |
| vector table ext B | 刪 → 替身是向量列 `vec: han ext B` |
| vector table compat | 刪 → 替身是向量列 `vec: han compat` |
| vector table jamo | 刪 → 替身是向量列 `vec: hangul jamo` |
| vector table hangul compat | 刪 → 替身是向量列 `vec: hangul compat letters` |
| vector table hira+kata | 刪 → 替身是向量列 `vec: hiragana + katakana` |
| three-backtick fence | 刪 → 替身是向量列 `vec: three-backtick example fence` |
| four-backtick fence | 刪 → 替身是向量列 `legacy validate-card.contract-vectors #025`(新增) |
| js fence | 刪 → 替身是向量列 `vec: js fence is not removed` |
| four-backtick: examples/body/validateCard (same card, LF) | 刪 → 替身是向量列 `legacy validate-card.contract-vectors #025`(新增) |
| four-backtick CRLF | 刪 → 替身是向量列 `legacy validate-card.contract-vectors #026`(新增) |
| five backticks around four | 刪 → 替身是向量列 `fence: five backticks around four` |
| four then three, in order | 刪 → 替身是向量列 `fence: four around three then a three example` |
| js fence after four-backtick example | 刪 → 替身是向量列 `legacy validate-card.contract-vectors #027`(新增) |
| fixture valid-example-with-nested-content.md:validateCard ok、errors 空 | 留 → 不是向量:這張 fixture 是合法的卡(frontmatter 合法);字數 27 與 examples 一個由向量列 `fixture: valid-example-with-nested-content.md` 管 |
| fixture 那一個 example 含內層程式碼圍欄、body 沒有反引號 | 刪 → 替身是向量列 `fixture: valid-example-with-nested-content.md`(examples 逐字比,含內層兩行圍欄;字數 27) |
| 四反引號 body 裡沒有反引號、只剩前後 | 刪 → 替身是向量列 `vec: four-backtick fence with inner three`(新欄位 strippedBody 比 body 原文) |
| validateCard 對每張卡的 errors 為空(卡要合法) | 留 → 不是向量:向量檔跑的是 body;卡的合法性由 validateCard 自己的測試管,fixture 那條留在本檔 |

## packages/core/src/schema/validate-card.fence-whitespace.test.ts

整個刪(6 組、全是字面向量;參數組合展開成逐列)

| 條目 | 處置 |
|---|---|
| A. closing line at end of text, 3 backticks | 刪 → 替身是向量列 `fence: closing at end of text, three` |
| A. closing line at end of text, 4 backticks | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #028`(新增) |
| B. two backticks | 刪 → 替身是向量列 `fence: two backticks are not a fence` |
| C1. 3 backticks, closing tail one space | 刪 → 替身是向量列 `fence: closing with trailing space (three)` |
| C1. 3 backticks, closing tail two spaces | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #029`(新增) |
| C1. 3 backticks, closing tail one tab | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #030`(新增) |
| C1. 3 backticks, closing tail space and tab | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #031`(新增) |
| C1. 4 backticks, closing tail one space | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #032`(新增) |
| C1. 4 backticks, closing tail two spaces | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #033`(新增) |
| C1. 4 backticks, closing tail one tab | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #034`(新增) |
| C1. 4 backticks, closing tail space and tab | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #035`(新增) |
| C2. 3 backticks, closing indent 1 | 刪 → 替身是向量列 `fence: closing indented by one space` |
| C2. 3 backticks, closing indent 3 | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #036`(新增) |
| C2. 4 backticks, closing indent 1 | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #037`(新增) |
| C2. 4 backticks, closing indent 3 | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #038`(新增) |
| C3. 3 backticks, opening tail one space | 刪 → 替身是向量列 `fence: opening with trailing space` |
| C3. 3 backticks, opening tail two spaces | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #039`(新增) |
| C3. 3 backticks, opening tail one tab | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #040`(新增) |
| C3. 4 backticks, opening tail one space | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #041`(新增) |
| C3. 4 backticks, opening tail two spaces | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #042`(新增) |
| C3. 4 backticks, opening tail one tab | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #043`(新增) |
| D. 3 backticks, trap followed by word | 刪 → 替身是向量列 `fence: closing backticks followed by a word do not close` |
| D. 3 backticks, trap glued to content | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #044`(新增) |
| D. 3 backticks, trap both | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #045`(新增) |
| D. 4 backticks, trap followed by word | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #046`(新增) |
| D. 4 backticks, trap glued to content | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #047`(新增) |
| D. 4 backticks, trap both | 刪 → 替身是向量列 `legacy validate-card.fence-whitespace #048`(新增) |
| 每條的「body 只剩前後(去掉空白)」 | 刪 → 替身是向量列 `vec: three-backtick example fence`(字數 2、examples,並用 strippedBody 比 body 原文;各列的字數與 examples 也都比) |

## packages/core/src/ingest/example-fence-word-count.test.ts

留差分(讀向量檔),字面向量刪

| 條目 | 處置 |
|---|---|
| COUNT_CASES "同源政策" | 刪 → 替身是向量列 `gherkin: 同源政策` |
| COUNT_CASES "same-origin" | 刪 → 替身是向量列 `key: same-origin` |
| COUNT_CASES "TLS" | 刪 → 替身是向量列 `key: TLS` |
| COUNT_CASES "1.5" | 刪 → 替身是向量列 `key: 1.5` |
| COUNT_CASES "don't" | 刪 → 替身是向量列 `gherkin: don't` |
| COUNT_CASES "RFC 6265" | 刪 → 替身是向量列 `gherkin: RFC 6265` |
| COUNT_CASES "。、!?" | 刪 → 替身是向量列 `legacy example-fence-word-count #049`(新增) |
| COUNT_CASES "同源政策(same-origin policy)在 TLS | 刪 → 替身是向量列 `legacy word-count #001`(新增) |
| FENCE_CASES four han then fence | 刪 → 替身是向量列 `t20: four han before a fence` |
| FENCE_CASES fence in the middle | 刪 → 替身是向量列 `fence: text on both sides` |
| FENCE_CASES two fences | 刪 → 替身是向量列 `fence: two examples in order` |
| FENCE_CASES js fence counts | 刪 → 替身是向量列 `legacy example-fence-word-count #050`(新增) |
| parse: strip fence | 刪 → 替身是向量列 `fence: text on both sides` |
| parse: no fence | 刪 → 替身是向量列 `legacy example-fence-word-count #051`(新增) |
| parse: several fences in order | 刪 → 替身是向量列 `fence: two examples in order` |
| 差分:同一段 body,ingest 字數 = validateCard 的 bodyWordCount | 留(改成對向量檔每一列比)→ 原因:這是兩條路彼此一致的性質,不是向量;向量列自己的期望由登記表管 |

## packages/core/src/lint/validator-min.test.ts

留 parseCard 兩條,countBodyWords 的字面向量刪

| 條目 | 處置 |
|---|---|
| key table same-origin | 刪 → 替身是向量列 `key: same-origin` |
| key table TLS | 刪 → 替身是向量列 `key: TLS` |
| key table 1.5 | 刪 → 替身是向量列 `key: 1.5` |
| key table don't | 刪 → 替身是向量列 `gherkin: don't` |
| key table 同源政策 | 刪 → 替身是向量列 `gherkin: 同源政策` |
| key table RFC 6265 | 刪 → 替身是向量列 `gherkin: RFC 6265` |
| strip fence then count | 刪 → 替身是向量列 `legacy validator-min #052`(新增) |
| empty string | 刪 → 替身是向量列 `empty string` |
| whitespace between letters | 刪 → 替身是向量列 `legacy validator-min #053`(新增) |
| parseCard:拆出 frontmatter、body(不含圍欄)、examples | 留 → 原因:拆 frontmatter 與欄位對應,不是向量(圍欄那段的 examples 另由向量檔 09-lint parseCard 登記項跑) |
| parseCard:沒有 example 圍欄時 examples 是空陣列、body 只有正文 | 留 → 原因:同上,frontmatter 缺欄位時的行為 |

## packages/core/src/prompt-quality/word-count.test.ts

整個刪(5 組、全是字面向量)

| 條目 | 處置 |
|---|---|
| key table same-origin | 刪 → 替身是向量列 `key: same-origin` |
| key table TLS | 刪 → 替身是向量列 `key: TLS` |
| key table 1.5 | 刪 → 替身是向量列 `key: 1.5` |
| key table don't | 刪 → 替身是向量列 `gherkin: don't` |
| key table 同源政策 | 刪 → 替身是向量列 `gherkin: 同源政策` |
| key table RFC 6265 | 刪 → 替身是向量列 `gherkin: RFC 6265` |
| strip fence then count | 刪 → 替身是向量列 `legacy word-count #054`(新增) |
| empty string | 刪 → 替身是向量列 `empty string` |
| whitespace between letters | 刪 → 替身是向量列 `legacy validator-min #053`(新增) |
| 101 han | 刪 → 替身是向量列 `limit: 101 han` |

