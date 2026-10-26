---
id: T57
deps: [T52]
touches: [packages/contracts/src/card-markdown.ts, packages/core/src/schema/example-fence.ts, packages/ui-shared/src/example-fence.ts, apps/teach-card/vite.config.ts, apps/test-card/vite.config.ts, package.json]
cpu: light
budget_usd: 3
status: todo
owner: worker-grok
must_catch:
  - 改用 markdown-it 之後舊的 85 列任何一列的字數或 body 變了(CRLF 四反引號那列的 examples 除外) 跨實作測試必須紅
  - 六種怪寫法(同一行、沒關、關的多、example 後有字、縮排 4 格、開始行前有字)任何一列跟畫面不同 跨實作測試必須紅
  - 資訊字串的判斷不是逐字(不分大小寫、解 HTML 實體、只認半形空白) Example、&#101;xample、全形空白那三列必須紅
  - 波浪號圍欄不算 example,或反引號與波浪號混著也算結束 波浪號那幾列必須紅
  - 清單或引用裡的開始行整行拿掉(1. 那列變 2),或容器記號留在 examples 裡 1. 那列等於 3 與裸引用那列等於 0 必須紅
  - examples 的換行沒換成 LF,或 body 裡圍欄以外的 CRLF 被改成 LF CRLF 那幾列必須紅
  - 解析前沒先 trim(body 第一行縮排 4 格的開始行) 那一列必須紅
  - core 的 example-fence.ts 對 markdown-it 實例用了 parse 以外的成員,或讀了 type、info、map、content 以外的 token 欄位 白名單守門必須紅
  - 畫面的 markdown-it 規則跟全新預設實例不同(block 的每一條鏈、core 的鏈;含 paragraph 少了 fence) 規則鏈護欄必須紅
  - 畫面的 example-fence.ts 出現 block 或 core 的成員存取 靜態守門必須紅
  - markdown-it 不是剛好 15.0.1(package.json 寫成範圍、node_modules 或 lockfile 的版本不同) 釘版測試必須紅
  - card-markdown.ts 有任何 import、require、export from、動態 import 零 import 守門必須紅
  - core 或畫面自己寫一份選項或 example 判斷,不用 CARD_MARKDOWN_OPTIONS 與 isExampleFence 守門必須紅
  - 沒登記的檔抄圍欄 regex,或拿字串 example 去比(core 與畫面也不准) 指紋掃描必須紅
  - 六個舊向量檔刪掉的條目沒有替身,或替身指到不存在的向量列 對照表核對必須擋下
  - 實作動到 touches 以外的檔(含 contracts/、docs/、prompts/、.feature、測試、向量檔) 不動的地方那條 diff 必須有輸出
  - 新的 schema/example-fence.ts 變異分數低於 80%
---

# 工單 T57:example 圍欄跟畫面一樣(契約 §2 改寫,1.4.0 → 1.5.0)

> 狀態:起草 2026-10-27,依協調者 2026-10-27 的交代(T52 已合 main `964502b`);顧問 2026-10-27 審過,改了 14 處(見最後「顧問裁定」)。規格:UI/Tauri 負責人(代筆)。編號 T57:協調者配的。
> 實作:worker(opencode + grok-4.7);紅測試與向量檔:測試 agent(不是起草的人);驗收(含變異):驗收 agent。
> 依據:**使用者 2026-10-27 選 A**(跟畫面一樣,見 `T52-word-count-single-source-vectors.md` 最後一節);顧問 2026-10-27 對 T57 的裁定;`../02-decision-map.md` 的 ADR-060 與 ADR-081。
> **這張改契約 §2(硬約定)。** 條文與 ADR 已寫進起點分支最底下的 commit:`pollux0971/t57-contract` `7164815`(基底 main `964502b`)。顧問讀過那個 commit 的 `contracts/types.md` diff,測試 agent 才開始寫紅測試;推 main 時顧問再看一次。LLM 真呼叫 0。落點含 `packages/contracts`:依 R2 不能跟別的含這個路徑的工單並行。

## 為什麼有這張

§2 只定義了正常的圍欄。T52 起草時量到六種怪寫法契約沒講,今天 `validateCard` 跟畫面有四種算得不一樣(T52 工單最後一節的表)。T57 起草時又量到幾類也不一樣:

- **波浪號** ` ~~~example `:畫面畫成例子框,`validateCard` 照算(7,該 2)。
- **清單與引用**:` > ` 每一行都有的引用,畫面畫成例子框,`validateCard` 照算(7,該 2);` - ` 或 ` > ` 只在開始行的,畫面是空的例子框、後面照算(6),`validateCard` 卻當成完整的圍欄(2)。
- **只有 CR 的換行**:畫面當換行,`validateCard` 不當(7,該 2)。
- **資訊字串**:`example` 後面接全形空白再接字,畫面算例子框,`validateCard` 照算(8,該 2)。

使用者選 A:**畫面當它是例子框,就不算字;畫面當一般文字,就照算。** 要做到「永遠跟畫面一樣」,最直接的是 core 用畫面同一個解析器(markdown-it)、同一組選項去判斷哪些是例子框(顧問裁「甲」)。自己再寫一條 regex 去追 CommonMark(容器、波浪號、未閉合)等於第六份實作,ADR-060 記的病會再來一次。

**還沒咬到使用者**(只數,不記內容;起草時用丟棄式雛形量,見最後「起草時量的」):真的 `learning/cards/` 25 張卡、30 個 example 圍欄;golden 存著的 63 筆輸出、117 個 body。字數、examples、body(逐位元組)**全部 0 筆不同**。

## 要的結果

### 1. 契約 §2 條文(已寫進起點分支)

原文在 `pollux0971/t57-contract` `7164815` 的 `contracts/types.md`,**以那個檔為準**,這裡不再抄一份。改的地方:

- 檔頭版本 1.4.0 → 1.5.0,加一行 1.5.0 的說明(ADR-081)。
- `Card.examples` 的註解:解析器給的內容、已 trim、換行一律 `\n`。
- 步驟 2 的「其他」:CJK 與 L*/N* 以外的所有字元(含 P*、S*、Z*、M*、C*)。
- 1.2.0 向量表四反引號那一列的依據:「結束至少要跟開始一樣多,內層三個不結束外層」。
- 拿掉「尚未定義」那一段。
- 「Example 圍欄」整段改寫。重點:
  - 以畫面的區塊解析為準:markdown-it 15.0.1、`{ html: false, linkify: true }`、解析用 `String.prototype.trim()` 過的 body。
  - 判斷用資訊字串原文(`token.info`,不處理跳脫與 HTML 實體):trim 後用 `/\s+/` 切,第一段逐字等於 `example`。
  - 判斷寫在 `packages/contracts/src/card-markdown.ts`,這個檔是 §2 的一部分。
  - 縮排 4 欄以上不是圍欄(前面空一行時是縮排程式碼,緊接在段落後面時是段落的續行)。
  - 「移除」用 `token.map` 的行範圍寫;trim 過的 body 裡圍欄以外逐位元組不變;examples 用 `token.content`、空的也算一個。
  - 7 列小表。
  - 版本政策:任何升版都是改 §2,先問使用者並附向量檔前後差異。

同一個 commit 也改了 `../01-roadmap.md` 第 15 行(契約版本 1.5.0)。

### 2. ADR-081(已寫進起點分支)

原文在同一個 commit 的 `../02-decision-map.md`:新增 ADR-081(補充 ADR-060,不推翻),ADR-060 底下加一行 `refined by ADR-081`。

### 3. 新檔 `packages/contracts/src/card-markdown.ts`(顧問裁)

- **0 個 import**。理由:這個檔只裝 §2 的東西,不受其他契約檔影響。畫面直接 import 這個檔,不經過 `packages/contracts/src/index.ts`(這是寫法,不是驗收條件)。
- 只放兩樣:
  - `CARD_MARKDOWN_OPTIONS`:`Object.freeze({ html: false, linkify: true })`(起草時試過:markdown-it 15.0.1 吃凍結的選項沒問題)。
  - `isExampleFence(info: string): boolean`:`info.trim().split(/\s+/)[0] === 'example'`。**`'example'` 這個字只出現在這個檔。**
- 檔頭註解寫:這兩樣是契約 §2「Example 圍欄」的一部分,改它就是改 §2。

### 4. core 的 `stripExampleFences` 改用 markdown-it(甲)

`../../packages/core/src/schema/example-fence.ts` 整個換掉(介面不變:`stripExampleFences(text) → { body, examples }`;`countBodyWords`、`parseCardText`、`validateCard` 照舊呼叫它):

1. 先 `text.trim()`(跟畫面 `../../apps/teach-card/src/lib/card.ts:43` 一樣)。
2. 模組裡建一個 `new MarkdownIt(CARD_MARKDOWN_OPTIONS)`,`md.parse(trimmed, {})`。
3. 挑出 `type === 'fence'` 而且 `isExampleFence(token.info)` 的 token。
4. 依 `token.map`(`[開始行, 結束行的下一行)`)改原文:開始行留下第一個反引號或波浪號之前的部分(加上那一行原本的換行);開始行之後到 `map[1]` 之前的行整行拿掉(連同它們的換行)。切行用 `/(\r\n|\r|\n)/`(跟 markdown-it 的正規化一樣),換行符原樣接回去,所以圍欄以外逐位元組不變。
5. `body` = 結果再 trim;`examples` = 每個 token 的 `content.trim()`,依出現順序。
6. **白名單**(顧問裁):markdown-it 實例上只准用 `.parse`;token 只准讀 `type`、`info`、`map`、`content`。黑名單抓不到 `md.options.maxNesting = …` 這種寫法。改了解析器的設定或規則,字數就跟畫面分家(起草時的坑:`ruler.at()` 沒帶 `alt` 會讓圍欄不能打斷段落)。
7. 檔頭註解改寫:§2 1.5.0、ADR-081、「以畫面的解析為準」;拿掉舊註解裡「契約未定義,不擴大」那句(`../../packages/core/src/schema/example-fence.ts:8`)。

### 5. 畫面改用同一份

- `../../packages/ui-shared/src/example-fence.ts`:
  - `new MarkdownIt({ html: false, linkify: true })`(第 167 行)改 `new MarkdownIt(CARD_MARKDOWN_OPTIONS)`;
  - 自己的 `fenceLang`(第 25 行)刪掉;用到它的兩處(第 35 行 `exampleLabel`、第 158 行 `renderer.rules.fence`)都是拿去跟 `'example'` 比,改成 `isExampleFence(token.info)`;
  - 從 `@contracts/card-markdown.js` import。
  - **畫面的行為一個都不變。** 改完這個檔不再有 `'example'` 字面值。
- `../../apps/teach-card/vite.config.ts:11` 與 `../../apps/test-card/vite.config.ts:11` 旁邊加一條 `'@contracts'` 別名(跟根目錄 `vitest.config.ts` 對齊,寫法同 `@core` 那條)。今天 ui-shared 沒有 import 過 `@contracts`,兩個 app 的 Vite 解析不到它;桌面的 `build:frontends` 用的是這兩份設定。

### 6. 釘 markdown-it 15.0.1

- 根目錄 `package.json` 第 67 行 `"markdown-it": "^15.0.1"` 改成 `"15.0.1"`。
- `package-lock.json` 只會變一行(第 18 行,根套件的依賴宣告;`npm install` 跟著 `package.json` 改的)。它不在檔頭的 touches:落點表(`../../scripts/boundaries.owners.json`)沒有這個檔,工單也從來沒列過;驗收的「lockfile」那一列守它。`node_modules/markdown-it` 那一段(版本、`resolved`、`integrity`)**一個字不變**;lockfile 裡 markdown-it 只有一份。
- `@types/markdown-it` 不動。

### 7. 向量檔加列(測試 agent)

`contracts/fixtures/word-count-vectors.json`(格式照 T52:全 ASCII、每列 `name`、`body` 或 `fixture`、`words`、`examples`、`covers`、`basis`、`why`):

- **改一列**:`fence: crlf with four backticks` 的 `examples` 換行換成 `\n`;`why` 寫「example content line ends are \n (contract 1.5.0, ADR-081)」。
- **改一句**:四反引號那列的 `why`(今天第 177 行「closing needs the same number of backticks…」)改成「至少要一樣多」,跟 §2 的 1.2.0 向量表同一個改法。
- **新的 `basis`**(名字測試 agent 定,例如 `s2-fence-1.5.0`):期望值來自畫面的區塊解析(markdown-it 15.0.1)。1.5.0 起它就是定義,所以不是「抄某份實作的輸出」。
- **描述**(`description`)最後那句「Fence shapes that section 2 does not define are NOT in this file (ticket T57)」改掉。
- **加列**,至少下面這些(期望值是起草時用畫面的解析量的;測試 agent 用 `renderMarkdown` 重量一次,有一列對不上就停下回報)。`C` = `內容 內容`,`T` = 三個反引號,`Q` = 四個反引號,`W` = 三個波浪號:

  | # | body | 字數 | examples | 註 |
  |---|---|---|---|---|
  | 1 | `前\n\nTexample CT\n\n後` | 7 | 無 | 同一行開關:不是圍欄 |
  | 2 | `前\n\nTexample\nC\n\n後` | 1 | `C\n\n後` | 沒關:到卡片結尾 |
  | 3 | `前\n\nTexample\nC` | 1 | `C` | 沒關、檔尾沒換行 |
  | 4 | `前\n\nTexample\nC\nQ\n\n後` | 2 | `C` | 結束比開始多 |
  | 5 | `前\n\nTexample 標題\nC\nT\n\n後` | 2 | `C` | example 後有字 |
  | 6 | `前\n\nTexample\tx\nC\nT\n\n後` | 2 | `C` | example 後 Tab 再有字 |
  | 7 | `前\n\nTexample\nC\n    T\n\n後` | 1 | `C\n    T\n\n後` | 結束縮排 4:不結束 |
  | 8 | `前\n\n    Texample\n    C\n    T\n\n後` | 7 | 無 | 開始縮排 4、前面空一行:縮排程式碼 |
  | 9 | `前\n    Texample\nC\nT\n\n後` | 7 | 無 | 開始縮排 4、緊接段落:段落的續行,之後的 T 開一般圍欄 |
  | 10 | `前\n\n   Texample\n   C\n   T\n\n後` | 2 | `C` | 開始縮排 3:是圍欄 |
  | 11 | `    Texample\nC\nT\n\n後` | 1 | `C` | body 第一行縮排 4:先 trim,是圍欄 |
  | 12 | `前 Texample\nC\nT\n\n後` | 7 | 無 | 開始行前有字:不是圍欄 |
  | 13 | `前\n\nWexample\nC\nW\n\n後` | 2 | `C` | 波浪號 |
  | 14 | `前\n\n~~~~example\nTjs\nx\nT\n~~~~\n\n後` | 2 | `Tjs\nx\nT` | 四個波浪號包反引號程式碼 |
  | 15 | `前\n\nWexample\nC\nT\n\n後` | 1 | `C\nT\n\n後` | 波浪號開、反引號不能關 |
  | 16 | `前\n\nTexample\nC\nW\n\n後` | 1 | `C\nW\n\n後` | 反引號開、波浪號不能關 |
  | 17 | ``前\n\nWexample `x`\nC\nW\n\n後`` | 2 | `C` | 波浪號的資訊字串可以有反引號 |
  | 18 | `前\n\n- Texample\n  C\n  T\n\n後` | 2 | `C` | 清單、續行縮排 |
  | 19 | `前\n\n1. Texample\n   C\n   T\n\n後` | **3** | `C` | 留下 `1. `(顧問要的列) |
  | 20 | `前\n\n- Texample\nC\nT\n\n後` | 6 | 一個空字串 | 清單續行沒縮排:空例子框,後面照算 |
  | 21 | `前\n\n> Texample\n> C\n> T\n\n後` | 2 | `C` | 引用每行都有 `> ` |
  | 22 | `> Texample\n> C\n> T` | **0** | `C` | 裸引用(顧問要的列) |
  | 23 | `前\n\n> Texample\nC\nT\n\n後` | 6 | 一個空字串 | 只有開始行有 `> ` |
  | 24 | `前\n\n- > Texample\n  > C\n  > T\n\n後` | 2 | `C` | 清單裡的引用 |
  | 25 | `前\n\n\tTexample\n\tC\n\tT\n\n後` | 7 | 無 | Tab 縮排:縮排程式碼 |
  | 26 | `前\r\n\r\nTexample\r\n內容\r\n內容\r\nT\r\n\r\n後` | 2 | `內容\n內容` | CRLF:examples 換成 `\n` |
  | 27 | `前\r\rTexample\rC\rT\r\r後` | 2 | `C` | 只有 CR 的換行(沒有 LF) |
  | 28 | `前\n\nT&#101;xample\nC\nT\n\n後` | 8 | 無 | HTML 實體不解:不是 example(顧問要的列) |
  | 29 | `前\n\nTExample\nC\nT\n\n後` | 7 | 無 | 大小寫不同:不是 example(顧問要的列) |
  | 30 | `前\n\nTexample` + U+3000 + `x\nC\nT\n\n後` | 2 | `C` | 全形空白也切開:是 example(顧問要的列) |

- **body 要驗原文的列**:向量檔現在只比字數與 examples,body 只驗有沒有 trim。至少下面兩種要比 body 原文(新的可選欄位,名字測試 agent 定):
  - 第 19 列:`前\n\n1. \n\n後`(開始行留下 `1. ` 自成一行);
  - 一列 CRLF、圍欄前後都有多行文字的:圍欄以外的 `\r\n` 原樣留著(起草時量的例子:`前\r\n後\r\n\r\nTexample\r\nC\r\nT\r\n\r\n尾` → body `前\r\n後\r\n\r\n\r\n\r\n尾`,字數 3)。
- `covers` 加新類別(怪寫法六種、資訊字串逐字、波浪號、清單、引用、容器記號、空的 example、只有 CR、先 trim),`REQUIRED_COVERS` 跟著加。`EXPECTED_ROWS` 改成新列數。`../../contracts/fixtures/README.md` 那行的列數跟著改。

### 8. 既有測試要改的(測試 agent)

起草時用丟棄式雛形(第 4 節的做法,不進 git、量完還原)在 main `964502b` 跑 `packages/core/src/`、`packages/contracts/src/` 與跨實作測試:**core 與 contracts 3053 條裡紅 3 條,跨實作測試紅 4 條**,全部是下面列的,而且都是「舊測試釘住了契約沒定義的寫法」或「本來就要改」:

| 檔 | 哪裡 | 為什麼紅 | 改法 |
|---|---|---|---|
| `../../features/support/word-count-vectors.test.ts` | CRLF 那列(三個實作) | examples 換成 `\n` | 向量檔改那一列(第 7 節) |
| 同上 | `../../features/support/word-count-vectors.test.ts:583` | `example-fence.ts` 不再有圍欄 regex,指紋種類對不上 | 指紋掃描改寫(下面) |
| `../../packages/core/src/prompt-quality/parent-child-overlap.test.ts:299` | 輸入是 `parentonlytext ```example…`(開始行前有字) | 1.5.0 起那不是圍欄 | 改輸入:圍欄自己一行(空一行再開始);斷言不變 |
| `../../packages/core/src/ingest/generate-cards.regenerate.test.ts:512` | `example 後面還有字 96` / `97` 兩列釘住「不是圍欄」 | 1.5.0 起那是 example 圍欄,圍欄裡的字不算 | 兩列的輸入改成 `同`×100 與 `同`×101(後面接同一個 ` ```example js ` 圍欄),期望 100 與 101,跟上面「example 後面有空白」那兩列同一個形狀;第 472–476、490 行的註解改寫 |

**沒量到的**(要驗收 agent 跑):`packages/ui-shared`、`apps/**` 的測試(有些用 Chrome,重活)與 cucumber 步驟。畫面行為不變,預期 0 條紅。

**跨實作測試**(`../../features/support/word-count-vectors.test.ts`):

- 檔頭「範圍:不測契約沒定義的圍欄寫法…(T57 才定義)」改寫。
- **畫面那一列**(第 294 行)改走真的路:`apps/teach-card/src/lib/card.ts` 的 `parseCard` → `bodyMarkdown` → `renderMarkdown`(`../../apps/teach-card/src/App.svelte:69`)。現在直接 `renderMarkdown(body)` 沒先 trim,第 11 列會算錯。
- **指紋掃描**:
  - 圍欄 regex 的指紋照舊,但登記的檔裡**不再有任何圍欄 regex**,所以全 repo 命中任何一個都紅(更嚴)。
  - 新指紋:字串字面值 `'example'` 當比較的一邊(`===`、`!==`、`==`、`!=`、`switch` 的 `case`),或當 `startsWith`、`includes`、`indexOf`、`match`、`test` 的引數。**登記的檔只有 `packages/contracts/src/card-markdown.ts`**;core 與畫面都不准再有這種比較(顧問裁)。
  - `REGISTERED_HOMES` 變成 `packages/contracts/src/card-markdown.ts`(比 `'example'`)與 `packages/core/src/schema/word-count.ts`(Script)。core 的 `example-fence.ts` 改完之後一個指紋都沒有,從登記表移到「不能被抓」那份名單;`packages/ui-shared/src/example-fence.ts` 留在那份名單。登記檔「掃得到的種類」那條斷言(第 583 行)跟著改。例外表由測試 agent 在 main `964502b` 上實際掃出來再列。
- `md.block.ruler` 那條坑(`ruler.at()` 沒帶 `alt`)要有改壞證明。

**新的守門測試**(放 `features/support/` 或 `packages/contracts/src/`,測試 agent 定):

- **零 import**:讀 `packages/contracts/src/card-markdown.ts`,用語法樹找 `import`、`import x = require`、`export … from`、`import()`、`require()`:0 個。只有那兩個 export。`CARD_MARKDOWN_OPTIONS` 是凍結的、剛好 `{ html: false, linkify: true }`。
- **規則鏈護欄**(顧問確認 G1,再多比):`createMarkdownRenderer()` 跟 `new MarkdownIt(CARD_MARKDOWN_OPTIONS)` 比函式身分與順序:
  - `block.ruler.getRules(鏈)`,**每一條鏈都比**:`''` 加上兩邊實例所有規則 `alt` 名字的聯集(今天兩邊都是 `paragraph`、`reference`、`blockquote`、`list`)。**只比 `''` 不夠**:起草時量的,`ruler.at('fence', 同一個函式)` 不帶 `alt` 之後,`''` 鏈的身分完全一樣,`paragraph` 鏈從 7 條變 6 條。
  - `core.ruler.getRules('')`(normalize 與 block 在那裡;今天 8 條,兩邊一樣)。
- **畫面的靜態守門**:`packages/ui-shared/src/example-fence.ts` 的語法樹裡,markdown-it 實例**不准出現 `block` 或 `core` 的成員存取**。理由:`renderMarkdown` 帶選項時走 `installAssetImages`,執行時的護欄只檢查 `createMarkdownRenderer()`,蓋不到那條路。今天這個檔對實例用到的是 `inline.ruler`、`inline.parse`、`renderer.rules`、`normalizeLink`、`helpers.parseLinkLabel`、`render`、`use`。所以「只准 `inline.ruler` 與 `renderer.rules`」照字面寫會讓現在的程式就紅;守門只禁 `block` 與 `core`(見「顧問裁定」第 11 點的註)。
- **core 白名單**:`packages/core/src/schema/example-fence.ts` 的語法樹裡,markdown-it 實例的成員存取只有 `parse`,token 的成員存取只有 `type`、`info`、`map`、`content`。它從 `@contracts/card-markdown.js` import 了 `CARD_MARKDOWN_OPTIONS` 與 `isExampleFence`,`new MarkdownIt(...)` 的引數就是 `CARD_MARKDOWN_OPTIONS`。畫面那份同樣要 import 這兩個,不能再有自己的 `fenceLang`。
- **釘版**:根 `package.json` 的 `dependencies["markdown-it"]` 剛好是 `15.0.1`;`node_modules/markdown-it/package.json` 的 `version` 是 `15.0.1`;`package-lock.json` 的 `packages["node_modules/markdown-it"].version` 是 `15.0.1`,而且 lockfile 裡沒有第二份 markdown-it。

**六個舊向量測試檔收斂**(顧問 2026-10-27 裁,T52 留下的):

- `../../packages/core/src/schema/word-count.test.ts`(16 條)
- `../../packages/core/src/schema/validate-card.contract-vectors.test.ts`(14 條)
- `../../packages/core/src/schema/validate-card.fence-whitespace.test.ts`(6 組)
- `../../packages/core/src/ingest/example-fence-word-count.test.ts`(6 組)
- `../../packages/core/src/lint/validator-min.test.ts`(6 條)
- `../../packages/core/src/prompt-quality/word-count.test.ts`(5 條)

(條數是起草時數的 `it`/`it.each`,`each` 一組算一條。)

每一條二擇一:

1. **字面向量**(「這段文字 → 這個數字或這些 examples」):向量檔裡有同一列 → 刪掉這條;沒有 → 先加進向量檔,再刪。跨實作測試已經讓每一份實作跑每一列,留著是第二份抄本。
2. **不是向量的**(例如 lint `parseCard` 拆 frontmatter、ingest 跟 `validateCard` 的差分、100/101 邊界的接受與否):留著,或改成讀向量檔。

測試 agent 交一份**對照表**(例如 `docs/reviews/T57-old-vectors-map.md`,或放在紅測試 commit 說明裡):每一條一列,寫「刪 → 替身是向量列 `<name>`」或「留 → 原因」。檔被刪光就整個刪。檔頭註解裡「不放:開閉在同一行…」那類說明(`validate-card.contract-vectors.test.ts:7`、`validate-card.fence-whitespace.test.ts:15`、`example-fence-word-count.test.ts:11`)留下的檔要改寫。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 單元 | `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ packages/contracts/src/ features/support/word-count-vectors.test.ts scripts/lint.test.ts`,加上新守門測試的檔 | 全綠 |
| 畫面單元 | `VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/ apps/teach-card/src/ apps/test-card/src/` | 全綠(有 Chrome 的是重活,拿位子) |
| 守門 | `npm run typecheck`、`npm run boundaries`、`npm run check:json-duplicate-keys` | 全過;boundaries 例外條數不變(import contracts 一律放行) |
| 前端建置 | `npm run build:frontends -w @learning/desktop` | 兩個 app 都建得出來(`@contracts` 別名生效) |
| 不退步 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@data-layer and not @manual' --format summary`;`--tags '@lint and not @manual'`;`--tags '@prompt-quality and not @manual and not @llm'`;`--tags '@ingest-pipeline and not @manual and not @llm'`;`--tags '@teach-card and not @manual and not @e2e'`;`--tags '@i1 and not @manual and not @llm and not @e2e'` | 全綠(重活,拿位子) |
| lockfile | `git diff <紅測試分支的 tip>..HEAD -- package-lock.json` | 只有根套件那一行 `^15.0.1` → `15.0.1` |
| golden 離線重算 | 驗收 agent 的丟棄式腳本:每一筆存著的 golden 輸出用新程式重跑 `runStructuralChecks(text)`,跟檔裡存的 `structural` 比 | 0 筆不同。**不跑 live golden**(沒動 `prompts/`),LLM 0 |
| 真資料 | 用自己的簽出,對真的 `learning/cards/` 每張卡比 T57 前後的 `validateCard` 字數、examples、body | 全部相同(只記「全部相同 / N 張不同」,不記檔名);`learning/` 檔案數、整體雜湊、帳本行數前後相同 |
| 舊向量對照表 | 驗收 agent 用腳本核對對照表 | 每條「刪」的替身都指到向量檔裡存在的列;六個檔裡留下的條目都有原因 |
| 變異 | `npm run mutate -- stryker.t57-example-fence.json`(驗收 agent 加,照 `stryker.t52-word-count.json`;`mutate` 放 `schema/example-fence.ts`、`packages/contracts/src/card-markdown.ts`) | 每檔 ≥ 80%;存活的逐條說明 |
| 不動的地方 | `git diff --stat <紅測試分支的 tip>..HEAD -- contracts docs prompts packages/core/prompts 'features/**/*.feature' packages/core/src/schema/parse-card.ts packages/core/src/schema/word-count.ts packages/core/src/schema/validate-card.ts packages/core/src/lint packages/core/src/prompt-quality packages/core/src/ingest apps/teach-card/src/lib/card.ts` | 沒有輸出 |

**改壞證明**(驗收 agent 的丟棄式證明,每條:改了哪裡、哪一條紅、訊息原文、還原後綠):

- 解析前不 trim → 第 11 列紅;
- 開始行整行拿掉(不留前綴) → 第 19 列紅;
- examples 用原文切出來(不用 `token.content`) → CRLF、引用那幾列紅;
- body 用 `\n` 接回去(不保留原本的換行) → CRLF body 那列紅;
- 只認反引號(不認波浪號) → 波浪號那幾列紅;
- `isExampleFence` 先轉小寫、或先解 HTML 實體、或只用半形空白切 → 第 28、29、30 列各自紅;
- core 的 `md` 加 `md.block.ruler.at('fence', 原函式)`(不帶 `alt`),或加 `md.options.maxNesting = 1` → core 白名單守門紅;同一行加在畫面的 `createMarkdownRenderer` → 規則鏈護欄紅(`paragraph` 鏈);加在畫面的 `installAssetImages` → 畫面的靜態守門紅;
- `package.json` 改回 `^15.0.1` → 釘版測試紅;
- `card-markdown.ts` 加一行 `import { z } from 'zod'` → 零 import 守門紅;
- 在 core 或畫面或任何沒登記的檔加 `if (info.trim() === 'example')` → 指紋掃描紅;
- `isExampleFence` 改成 `startsWith('example')` → `examples` 標記那列紅(core 與畫面都紅)。

## 受保護的檔(開發 worker 不改)

- 測試與向量:`*.test.ts`、`features/**`、`.feature`、`contracts/`(含向量檔與 fixture README)、對照表。worker 覺得測試或向量有錯,寫進報告的「待協調」,不改。
- 文件:`contracts/types.md`、`docs/`(契約與 ADR 在起點分支最底下,不是 worker 寫的)。
- 實作:`prompts/`、`packages/core/src/schema/parse-card.ts`、`word-count.ts`、`validate-card.ts`、`lint/`、`prompt-quality/`、`ingest/`、`apps/teach-card/src/lib/card.ts`、touches 以外的一切。

## 落點

- `packages/contracts/` → contracts;`packages/core/src/schema/` → 01-data-layer;`packages/ui-shared/` → 07-teach-card(`../../scripts/boundaries.owners.json`)。
- import 例外:不用加。對到 contracts 的 import 一律放行(`../../scripts/check-boundaries.ts` 的 `contractsOwner`)。core import `markdown-it` 是套件名,不算跨界;它本來就是根目錄的 `dependencies`。
- R2:落點含 `packages/contracts`,跟別的含這個路徑的工單不並行(協調者 2026-10-27:目前沒有)。

## 不在範圍

- 寫卡片時一律用三個反引號(F1)→ **T58**,排在 T57 後面(T57 定義了「結束可以比開始多」與波浪號,T58 的圍欄長度照它算)。
- 畫面的行為(`exampleFencePlugin` 怎麼畫、`renderMarkdown` 的圖片規則):一個都不變。
- 畫面與 core 拆 frontmatter 的方法不同(`card.ts` 的 regex 對 gray-matter):不在 §2。
- markdown-it 升版:版本寫在 §2 裡,任何升版都是改硬約定,先問使用者並附向量檔前後差異。
- `@types/markdown-it`、`prompts/`(不跑 live golden)。

## 預算

`budget_usd: 3`(三個小實作檔、兩個設定檔、版本號;grok 不設停止線,只記錄)。LLM 花費 0。`cpu: light`(開發只跑 vitest 不含 Chrome 的部分);Chrome 測試、cucumber、變異、前端建置是驗收的重活,協調者排位子。

## 測試誰寫

- 向量檔、紅測試、守門測試、六個舊檔的收斂與對照表、第 8 節那兩個既有測試的改寫:測試 agent(起草的人不寫)。改壞證明與變異:驗收 agent。開發 worker 以紅測試分支為基底,不改測試、不改向量檔。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 分支順序(由下往上):main `964502b` → 契約與 ADR `7164815`(`pollux0971/t57-contract`)→ 測試 agent 的紅測試 → 開發 worker 的實作。

## 顧問裁定(2026-10-27)

審 8c46643 的草稿,方向對,改 14 處:

1. **「第一段」寫死**:用 `token.info` 原文(不處理跳脫與 HTML 實體),trim 後用 `/\s+/` 切,第一段逐字等於 `example`。向量檔加 `&#101;xample`(不算)、`Example`(不算)、`example` 後接 U+3000 再接 `x`(算)三列(第 7 節第 28–30 列)。
2. 條文寫明判斷在 `card-markdown.ts`,這個檔是 §2 的一部分。
3. 縮排 4 那句寫清楚「前面空一行是縮排程式碼、緊接段落是段落的續行」(第 9 列)。
4. 「移除」用 `token.map` 的行範圍寫;「圍欄以外逐位元組不變」限定在 trim 過的 body 裡。
5. trim 寫明是 `String.prototype.trim()`。
6. examples 空的也算一個,是空字串(第 20、23 列)。
7. 版本政策改嚴:任何升版都是改硬約定,先問使用者並附向量檔前後差異(不是「向量變了才問」)。
8. 1.2.0 向量表四反引號那列的依據改成「結束至少要跟開始一樣多」。
9. `card-markdown.ts` 出 `isExampleFence(info): boolean`,不出 `exampleFenceLang`。`'example'` 只活在這個檔;新指紋的登記檔只剩它。
10. core 守門改白名單:實例只准 `.parse`,token 只准 `type`、`info`、`map`、`content`。
11. G1 確認,而且多比:block 每一條鏈(`''` 加兩邊 `alt` 名字的聯集)、`core.ruler.getRules('')`;再加畫面的靜態守門(不准 `block` 或 `core`)。**註(起草者寫入時量的)**:顧問原話是「只准碰 `md.inline.ruler` 與 `md.renderer.rules`」,但這個檔今天還用到 `inline.parse`、`normalizeLink`、`helpers.parseLinkLabel`、`render`、`use`(都在 `installAssetImages` 與外掛安裝),照字面會讓現在的程式就紅。所以守門寫成「不准 `block` 或 `core`」。其中 `normalizeLink` 在區塊階段的 `reference` 規則也會被叫到;`installAssetImages` 包的那一層原樣回傳 `originalNormalize(url)`,不改結果。
12. G2:拿掉「匯入路徑守門」(畫面本來就有 zod,這條不保護行為)。0 import 守門保留,理由改成「這個檔只裝 §2 的東西,不受其他契約檔影響」。
13. `generate-cards.regenerate.test.ts:512` 的改法寫清楚(第 8 節表)。
14. 落點:`packages/contracts/` → contracts。

- **D1 同意**:起草者照改好的條文寫進 `contracts/types.md`、`docs/02-decision-map.md`、`docs/01-roadmap.md` 第 15 行,做成一個 docs commit,放在 T57 起點分支最底下(基底 main `964502b`)→ `7164815`。ADR 號碼寫入當下取:最大 080,所以是 ADR-081。

## 起草時量的(只讀;丟棄式雛形在前端的暫存區,不進 git)

- **雛形**:第 4 節的做法(公開 API、先 trim、圍欄以外逐位元組保留)。
- **向量檔現有 85 列**:字數 0 列不同、body(逐位元組)0 列不同、畫面的例子框個數 0 列不同;examples 只有 `fence: crlf with four backticks` 一列不同(CRLF → `\n`,顧問已准)。不先 trim 的版本也是 0 列不同(只有第 11 列這種現有向量沒有)。
- **新列**:第 7 節 30 列,雛形的 examples 個數跟畫面的例子框個數全部一樣;其中 20 列跟今天的 `validateCard` 字數不同(怪寫法、波浪號、清單引用、只有 CR、全形空白)。第 28、29 列今天也不算 example(8、7),字數不變。
- **既有測試**:第 8 節(`packages/core/src/` + `packages/contracts/src/` 3053 條紅 3 條;跨實作測試紅 4 條)。量完 `git checkout` 還原、新檔刪掉,工作樹乾淨。
- **真資料**:25 張卡、30 個圍欄、0 張含 CR;字數、examples、body 0 張不同。**golden**:63 筆輸出、117 個 body,0 筆不同。`learning/` 前後都是 64 個檔、`01d84e9c918e1cf4`、帳本 111 行(2026-10-27 03:48)。
- **規則鏈**:`createMarkdownRenderer()` 與全新 `new MarkdownIt(CARD_MARKDOWN_OPTIONS)` 的 block 五條鏈(`''` 11、`paragraph` 7、`reference` 7、`blockquote` 6、`list` 3)與 core 鏈(8)函式身分與順序都一樣;兩邊的 `alt` 名字一樣。`ruler.at('fence', 同一個函式)` 不帶 `alt`:`''` 鏈仍一樣,`paragraph` 鏈 7 → 6。
- **lockfile**:markdown-it 只有一份(15.0.1);根套件宣告在 `package-lock.json` 第 18 行。markdown-it 15.0.1 吃 `Object.freeze` 過的選項沒問題。
