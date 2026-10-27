---
id: T58
deps: [T57]
touches: [packages/core/src/ingest/card-file.ts, packages/core/src/ingest/children.ts, packages/core/src/ingest/ingest.ts, packages/core/src/ingest/deps.ts]
cpu: light
budget_usd: 1
status: dispatched
owner: worker-grok
must_catch:
  - 寫卡片時圍欄還是固定三個反引號 第 4、5、7、8、9、17、18、21、22、24、25 列必須紅
  - 圍欄長度等於最長的反引號串(沒有加 1) 第 4 列必須紅
  - 少了最少三個(內容沒有反引號時寫出一個或兩個反引號的圍欄) 第 1 列與既有的三個寫卡片測試必須紅
  - 只數行首的反引號串(行中的不算) 第 6、20 列的圍欄長度必須紅
  - 整張卡用同一個長度(取所有 example 的最大值) 第 21 列的圍欄長度必須紅
  - 把波浪號也算進去,或改用波浪號圍欄 第 10 列的圍欄長度必須紅
  - 寫之前不再 trim example 第 16 列的整份檔案逐字比對必須紅
  - ingest.ts、deps.ts 或 children.ts 還留著自己的寫法(不用 card-file.ts 的 renderCardFile) 那條路的接線測試與字面守門必須紅
  - card-file.ts 有 yaml 以外的值 import(例如 node 的 fs),或用 require、動態 import card-file 的 import 守門必須紅
  - packages 或 apps 底下的非測試檔有字串含三個反引號接 example 字面守門必須紅
  - 讀回再寫一次跟第一次不一樣(deps 改寫卡片的路) 穩定性那條必須紅
  - body 或 frontmatter 的寫法變了(body 沒 trim、空行數、結尾換行) 既有的三個寫卡片測試必須紅
  - 實作動到 touches 以外的檔 不動的地方那條 diff 必須有輸出
---

# 工單 T58:寫卡片時 example 圍欄的長度跟著內容走

> 狀態:起草 2026-10-27,依協調者 2026-10-27 的交代(T57 已合 main `517ddbe`,契約 1.5.0、ADR-081)。顧問 2026-10-27 審過 `6b6ac2a`:准規則與 25 列表,改 6 處(見最後「顧問裁定」);改完由協調者直接合併,不再送審。規格:UI/Tauri 負責人(代筆)。編號 T58:協調者配的(T52 工單「不在範圍」的 F1、T57 工單「不在範圍」第一條)。
> 實作:worker(opencode + grok-4.7);紅測試:測試 agent(不是起草的人);驗收(含變異):驗收 agent。
> 依據:顧問 2026-10-27 定的方向——圍欄長度 = 內容裡最長的連續反引號 + 1,最少 3;要有「寫入 → 讀回」的測試,讀回用 T57 的解析器;「結束可以比開始多」與波浪號照 T57 算。
> **不改契約。** §2 已經寫了「內層含三反引號程式碼圍欄的內容,外層用四個反引號或波浪號包」(`contracts/types.md` 的 Example 圍欄一節);寫卡片的程式沒照做,這張只改程式。決定記在 ADR-082(`../02-decision-map.md`,跟這張工單同一個 docs commit)。LLM 真呼叫 0。

## 為什麼有這張

寫卡片的地方有三處,圍欄一律是三個反引號:

- `packages/core/src/ingest/ingest.ts` 第 215 行(ingest 寫第 0 層卡);
- `packages/core/src/ingest/children.ts` 第 124 行(`renderCardFile`;子卡、topic、deepen 都用它);
- `packages/core/src/ingest/deps.ts` 第 332 行(算完先備關係,把 prereqs 有變的卡重寫一次)。

起草時又掃了一次:`packages/`、`apps/` 底下的非測試檔,含「三個反引號接 example」字串的只有這三處。`packages/core/src/ingest/scan.ts` 也會改寫卡檔,但只在 frontmatter 裡插一行旗標,body 一個位元組都不動,不是寫圍欄的地方。

模型給的 example 只要含一段程式碼圍欄,裡面那三個反引號就會提早把外層關掉:

- example 被切掉一半,後半掉進 body;
- 掉進 body 的那三個反引號又開了一個沒關的程式碼圍欄,把後面的 example 全吞掉(第 4 節第 21 列:寫三個,讀回只剩 1 個);
- 掉進 body 的字會算字數。超過 100 字時,ingest 與 topic 是寫完檔才讀回驗證(`packages/core/src/ingest/ingest.ts` 第 281 行、`packages/core/src/ingest/topic.ts` 第 180 行),會丟錯,但檔已經寫了;deepen 是寫之前先驗(`packages/core/src/ingest/deepen.ts` 第 194 行),回報的原因是 collision,不是真的原因。

起草時量的:第 4 節 25 列,今天的寫法有 11 列讀回不對。真資料與 golden 目前沒有 example 含三個以上連續的反引號(真資料 30 個、golden 94 個,最長都是 1 個),所以還沒真的發生;模型哪天給一段程式碼就會發生。

## 要的結果

### 1. 圍欄長度的規則

每一個 example 各自算:

1. 先 `trim()`(跟今天一樣)。
2. 找 trim 過的內容裡**最長的一串連續反引號**,長度記為 n。哪裡都算:行首、行中、行尾都算。沒有反引號時 n = 0。
3. 圍欄用 `max(3, n + 1)` 個反引號。開始行是「那串反引號 + `example`」,結束行是同樣長的那串反引號。
4. 只用反引號,不用波浪號。波浪號不算進 n(第 10 列)。

其他一個字都不變:frontmatter、`body.trim()`、body 後面空一行、example 之間空一行、檔尾一個換行。內容沒有三個以上連續反引號時,寫出來的檔跟今天**一字不差**(真資料 25 張、golden 114 張全部一樣,見最後一節)。

為什麼這樣夠:§2 說結束行要「同一種字元、數量至少跟開始一樣多、縮排 0–3 個空白、後面只能有空白」。圍欄比內容裡任何一串反引號都長,內容裡就不可能有一行能結束它。行中的反引號串本來就不會結束圍欄,一起算只是多一個,比較簡單,也不會錯。

### 2. 只留一個寫卡片的函式:新檔 `card-file.ts`(顧問裁 D1 = 乙')

- **新檔** `packages/core/src/ingest/card-file.ts`:
  - 放 `renderCardFile`,以及算圍欄長度、組 example 區塊的私有小函式。
  - 只 import `yaml`。要用 `Card` 的話只准型別 import(`import type`)。沒有 I/O:不讀檔、不寫檔、不 import `node:fs`。
  - 參數型別放寬成 `{ frontmatter: object; body: string; examples: readonly string[] }`。今天的呼叫端傳 `Card` 一樣可以。ingest 的 `CardFrontmatter` 的 prereqs 是選填的,不放寬就過不了型別檢查(起草時量到的)。
- **`children.ts`**:拿掉自己的 `renderCardFile`,改從 `./card-file.js` import,再 `export { renderCardFile }`。`topic.ts`、`deepen.ts` 照舊從 `./children.js` import,**不動**。
- **`ingest.ts`** 的 `writeCardFile` 改成寫 `renderCardFile({ frontmatter: fm, body, examples })`;**`deps.ts`** 的 `writeCardFile` 改成寫 `renderCardFile(card)`。兩個都直接 import `./card-file.js`,用不到的 `yaml` import 拿掉。
- 四個檔在同一個資料夾。`card-file.ts` 不 import 這個資料夾的任何檔,所以不會循環。
- 三處今天的輸出本來就一樣(都用 `yaml` 的 `stringify`)。`children.ts` 第 121 行的註解寫「ingest 與深入共用,格式必須一字不差」;搬進 `card-file.ts` 之後,只有一份,就一定一字不差。

### 3. 讀回是什麼(round-trip)

用 T57 的解析器讀回:`parseCardText`(core,裡面走 `stripExampleFences`)。卡片寫成 `renderCardFile({ frontmatter, body: B, examples: E })` 之後再讀回,要得到:

- **body** = `stripExampleFences(B.trim()).body`。B 沒有 example 圍欄時,就是 `B.trim()`,一個位元組都不變(含 CRLF,第 24 列)。
- **examples** = `stripExampleFences(B.trim()).examples` 接在前面,後面依序是 E 的每一個,各自 trim 過。
  換行一律變成 `\n`(CRLF 與只有 CR 都是),NUL 變成 U+FFFD。這是 markdown-it 讀的時候做的,§2 的 examples 定義已經這樣寫;寫的那邊**不用**先換。
- **穩定**:讀回的 body 與 examples 再寫一次、再讀回,結果跟第一次讀回的一樣。這是 deps 的路:ingest 寫 → `validateCard` 讀 → deps 用讀回的 Card 再寫。

這個性質的前提是 B 裡**沒有沒關的圍欄**。沒關的圍欄會一直開到卡片結尾,把後面寫的 example 吞掉;這不是圍欄長度的問題,見「不在範圍」的 F1。

### 4. 紅測試(測試 agent)

建議:(a) 的表放 `packages/core/src/ingest/card-file.test.ts`;掃 repo 的 (c)、(d) 放 `features/support/t58-card-file-guards.test.ts`(放 `features/support` 不用登記 owners)。檔名與分法測試 agent 定。

**(a) 寫入 → 讀回的表**,直接呼叫 `card-file.ts` 的 `renderCardFile`。每一列斷言三件事:

1. 每個 example 的開始行與結束行**剛好**是表上那麼多個反引號(開始行是反引號串接 `example`)。
2. core 讀回的 body 與 examples 照第 3 節。
3. 穩定(第 3 節)。

量長度時,不要在整份檔案裡找「反引號串接 `example`」的行:第 9 列的內容裡就有一行長得像開始行。起草時的量測腳本就在這一列量錯過(找到內層那行,以為是 3)。可以用 markdown-it 解析寫出來的檔、讀頂層 fence token 的 `markup` 長度,或照位置找。

第 1、16、21 列另外比整份檔案逐字(期望值測試 agent 手寫)。

記號:`K` = 一個反引號,`T` = 三個,`Q` = 四個,`F` = 五個,`X` = 十個,`W` = 三個波浪號,`NUL` = U+0000。body 沒寫的列是 `正文`。「今天」欄是今天的 `renderCardFile` 寫完、照第 3 節讀回對不對(起草時量的)。

| # | example(寫入前) | 圍欄反引號數 | 讀回的 examples | 今天 | 註 |
|---|---|---|---|---|---|
| 1 | `範例` | 3 | `範例` | 對 | 最少 3,跟今天一字不差 |
| 2 | `KcK` | 3 | `KcK` | 對 | 一個反引號 |
| 3 | `aKKb` | 3 | `aKKb` | 對 | 兩個反引號 |
| 4 | `Tjs\nx\nT` | 4 | `Tjs\nx\nT` | 錯 | 內層程式碼圍欄(§2 那句) |
| 5 | `Q\nx\nQ` | 5 | `Q\nx\nQ` | 錯 | 內層四個 |
| 6 | `a T b` | 4 | `a T b` | 對 | 行中的也算(今天剛好沒事,長度照規則) |
| 7 | `T` | 4 | `T` | 錯 | 只有三個反引號 |
| 8 | `X` | 11 | `X` | 錯 | 十個 |
| 9 | `Texample\ninner\nT` | 4 | `Texample\ninner\nT`(1 個) | 錯 | 內層是 example 圍欄:core 讀回 1 個 |
| 10 | `W\nx\nW` | 3 | `W\nx\nW` | 對 | 波浪號不算 |
| 11 | 空字串 | 3 | 空字串(1 個) | 對 | 空的也算一個(§2) |
| 12 | 三個空白 | 3 | 空字串(1 個) | 對 | trim 後是空的 |
| 13 | `l1\r\nl2` | 3 | `l1\nl2` | 對 | CRLF 讀回是 `\n`(§2) |
| 14 | `x\ry` | 3 | `x\ny` | 對 | 只有 CR 也是 |
| 15 | `a` NUL `b` | 3 | `a` U+FFFD `b` | 對 | markdown-it 把 NUL 換掉 |
| 16 | 前後各兩個空白的 `lead` | 3 | `lead` | 對 | 寫之前 trim |
| 17 | `x\nF` | 6 | `x\nF` | 錯 | 最後一行五個 |
| 18 | `before\nT\nafter` | 4 | `before\nT\nafter` | 錯 | 中間一行只有 T |
| 19 | `a\n\tb` | 3 | `a\n\tb` | 對 | Tab 留著 |
| 20 | `fooT` | 4 | `fooT` | 對 | 行尾的也算 |
| 21 | 三個:`Tjs\nx\nT`、`Q\nx\nQ`、`plain` | 4、5、3 | 三個,順序不變 | 錯(讀回 1 個) | 每個各算,不是整張卡取最大 |
| 22 | body `a\n\nTjs\nx\nT`;example `plain`、`Tpy\ny\nT` | 3、4 | `plain`、`Tpy\ny\nT` | 錯 | body 裡關好的程式碼圍欄不變 |
| 23 | body `a\n\nTexample\nz\nT`;example `plain` | 3 | `z`、`plain`;body `a` | 對 | body 自己的 example 在前面 |
| 24 | body `a\r\nb`;example `T\nq\nT` | 4 | `T\nq\nT`;body 逐位元組是 `a\r\nb` | 錯 | body 的 CRLF 不變 |
| 25 | body `a\n\n- p\n\n> q\n\n    code`;example `T\nq\nT` | 4 | `T\nq\nT`;body 不變 | 錯 | body 結尾是清單、引用、縮排程式碼 |

起草時用雛形量過:25 列新寫法 0 列錯。測試 agent 用真的 `renderCardFile` 與 `parseCardText` 重量;有一列對不上就停下回報。

**(b) 接線**:三條路各一條。example 用第 4 列;寫完的檔用 `validateCard` 讀回,examples 等於 `Tjs\nx\nT`,body 不含反引號。

- ingest(`runIngest`,假的 router;照 `packages/core/src/ingest/ingest.test.ts` 第 267 行那條的做法);
- 子卡(`generateChildrenForCards`;照 `packages/core/src/ingest/children.test.ts` 第 292 行);
- deps 改寫(prereqs 有變、卡被重寫;照 `packages/core/src/ingest/deps.test.ts` 第 256 行)。

**(c) `card-file.ts` 的 import 守門**:用語法樹讀 `card-file.ts`。值 import 只能是 `yaml`;其他 import 只能是 `import type`;沒有 `require`、沒有動態 `import()`。今天這個檔不存在,所以紅。

壞樣本(合成)要紅:加 `import { writeFileSync } from 'node:fs'`;把 `Card` 改成值 import;加一個 `require`。

**(d) 字面守門**:只掃 `packages/` 與 `apps/` 底下的非測試檔,**不掃 `scripts/`**(顧問裁)。非測試檔的判斷照 `features/support/word-count-vectors.test.ts` 的 `isTestFile`。用語法樹找字串字面值與樣板字串的片段,內容含「三個以上反引號,後面接 `example`」的,要 0 個。今天紅 3 個,就是第 1 節那三處。

守門要附合成的壞樣本與好樣本:

- 壞樣本:拼接字串、樣板字串,要抓到。
- 好樣本:註解裡的、用 `repeat` 產生反引號串再接 `example` 的,不能抓。

**(e) 指紋掃描的護欄**:T52 的指紋掃描「不能被抓」名單裡有 `ingest.ts`、`children.ts`、`deps.ts`,實作之後還是不能被抓。測試 agent 在 `features/support/word-count-vectors.test.ts` 的那份名單加 `packages/core/src/ingest/card-file.ts`(顧問裁)。名單的第一個斷言是「檔要存在」,所以在基底上紅。新寫的反引號計數**不要**寫成「反引號量詞 + example」的 regex,否則會被當成讀規則的寫法(`features/support/word-count-vectors.test.ts` 的 `fence-regex`)。起草時的雛形用 `` /`+/g `` 找反引號串,不會被抓:丟棄式實作把 `card-file.ts` 加進名單,指紋掃描的 14 條全綠。

### 5. 既有測試:只改一處

只有 (e) 那一處:指紋掃描的「不能被抓」名單加 `card-file.ts`(測試 agent 改)。其他不用改。

起草時用丟棄式實作(第 2 節的做法,新檔 `card-file.ts`)跑過:

- `packages/core/src/`、`packages/contracts/src/`、`features/support/word-count-vectors.test.ts`、`features/support/t57-example-fence-guards.test.ts`,加上 `features/support/` 裡碰到 ingest 的另外 5 個檔:3073 條全綠。
- 型別檢查 0 錯;`npm run boundaries` PASS。

三個既有的寫卡片測試(上面 (b) 那三行)用的 example 沒有反引號,圍欄還是三個,剛好守住「最少 3」與檔案格式。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 單元 | `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ packages/contracts/src/ features/support/word-count-vectors.test.ts features/support/t57-example-fence-guards.test.ts`,加上 T58 的新測試檔 | 全綠 |
| 守門 | `npm run typecheck`、`npm run boundaries` | 全過;boundaries 例外條數不變(同一個資料夾內的 import) |
| 不退步 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@ingest-pipeline and not @manual and not @llm' --format summary`;`--tags '@teach-card and @phase-3 and not @manual and not @e2e'`;`--tags '@i1 and not @manual and not @llm and not @e2e'`;`--tags '@data-layer and not @manual'` | 全綠(重活,拿位子) |
| 真資料 | 驗收 agent 的丟棄式腳本:用自己的簽出,真的 `learning/cards/` 每張卡用 `parseCardText` 讀出來,分別用紅測試分支 tip 的 `renderCardFile` 與實作後的 `renderCardFile` 在記憶體裡各寫一次(不寫檔),比兩份文字 | 全部一字不差(只記「全部相同 / N 張不同」,不記檔名);`learning/` 檔案數、整體雜湊、帳本行數前後相同 |
| golden | 同一支腳本,對存著的 golden 卡片(有 `body` 與 `examples` 的)做一樣的比較 | 全部一字不差。**不跑 live golden**(沒動 `prompts/`),LLM 0 |
| 變異 | `npm run mutate -- stryker.t58-card-fence.json`(驗收 agent 加,`mutate` 放整個 `packages/core/src/ingest/card-file.ts`) | ≥ 80%;存活的逐條說明 |
| 不動的地方 | `git diff --stat <紅測試分支的 tip>..HEAD -- contracts docs prompts packages/core/prompts 'features/**/*.feature' packages/core/src/schema packages/core/src/ingest/topic.ts packages/core/src/ingest/deepen.ts packages/core/src/ingest/generate-cards.ts packages/core/src/ingest/scan.ts packages/ui-shared apps` | 沒有輸出 |

**改壞證明**(驗收 agent 的丟棄式證明,每條:改了哪裡、哪一條紅、訊息原文、還原後綠):

- 圍欄寫死三個 → 表上「今天」是錯的那 11 列紅,三條接線紅;
- 長度用 n(不加 1) → 第 4 列紅;
- 拿掉「最少 3」 → 第 1 列與三個既有寫卡片測試紅;
- 只數行首的反引號串 → 第 6、20 列的長度紅;
- 整張卡取最大值 → 第 21 列的長度紅;
- 波浪號也算進 n → 第 10 列的長度紅;
- 寫之前不 trim → 第 16 列的逐字比對紅;
- `ingest.ts` 或 `deps.ts` 換回自己那一行(三個反引號) → 那條接線紅、字面守門紅;
- `children.ts` 留著自己的舊 `renderCardFile`(不轉 export) → 子卡那條接線紅、字面守門紅;
- `card-file.ts` 加 `import { writeFileSync } from 'node:fs'` → import 守門紅;
- 在 `topic.ts` 加一個自己拼的「三個反引號接 example」字串 → 字面守門紅。

## 受保護的檔(開發 worker 不改)

- 測試:`*.test.ts`、`features/**`、`.feature`。worker 覺得測試有錯,寫進報告的「待協調」,不改。
- 契約與文件:`contracts/`、`docs/`。
- 實作:`prompts/`、`packages/core/src/schema/`(讀的那邊,T57 剛定)、`topic.ts`、`deepen.ts`、`generate-cards.ts`、`scan.ts`、`packages/ui-shared/`、`apps/`、touches 以外的一切。

## 落點

- `packages/core/src/ingest/` → 02-ingest-pipeline(`scripts/boundaries.owners.json`)。四個檔都在這個資料夾。
- import 例外:不用加。`ingest.ts`、`deps.ts`、`children.ts` → `card-file.ts` 是同一個資料夾;`yaml` 是套件名。

## 不在範圍

- **F1:body 裡沒關的圍欄**(顧問 2026-10-27:記著,不開票)。body 有一個沒關的反引號或波浪號圍欄時,它一直開到卡片結尾,把後面寫的 example 全吞掉。起草時量的四種都是這樣:
  - 沒關的 `Tjs`;
  - 沒關的 `W`;
  - 結尾單獨一行 `T`;
  - `Q` 開、`T` 收(收不掉)。
  這時 core 與畫面讀到的一樣(都是 0 個 example,吞掉的字算 body),只是不是寫的人要的。真資料 25 張、golden 114 張都是 0 張。這不是圍欄長度的問題,T58 不處理。
- **F2:examples 裡不是字串的元素**(顧問 2026-10-27:記著,放進協調者的低優先小票清單,跟測試封閉性那幾張一起)。`children.ts` 第 114 行與 `generate-cards.ts` 第 188 行只檢查 `Array.isArray`,不檢查每個元素是不是字串。今天遇到非字串,寫卡片時的 `e.trim()` 會丟 TypeError;T58 之後一樣丟,不改這個行為(topic 有先過濾)。
- 寫的那邊不先把 CR 換成 `\n`:讀的時候 markdown-it 會換,§2 已經定義讀回是 `\n`(第 13、14 列)。
- 改用波浪號圍欄、只數「能結束圍欄的那幾行」、固定寫四個:都不採用,理由見 ADR-082。
- 契約:不改(§2 那句本來就要求外層比內層多)。
- 畫面、讀的那邊(`stripExampleFences`、`card-markdown.ts`)、`prompts/`(不跑 live golden):一個都不變。畫面頂層例子框的比對也不做(顧問拿掉)。

## 預算

`budget_usd: 1`(四個實作檔,其中一個是新檔;grok 不設停止線,只記錄)。LLM 花費 0。`cpu: light`(開發只跑 vitest 不含 Chrome 的部分);cucumber 與變異是驗收的重活,協調者排位子。

## 測試誰寫

- 第 4 節的表、接線、字面守門:測試 agent(起草的人不寫)。改壞證明與變異:驗收 agent。開發 worker 以紅測試分支為基底,不改測試。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 分支順序(由下往上):main `517ddbe` → 這張工單 → 測試 agent 的紅測試 → 開發 worker 的實作。

## 顧問裁定(2026-10-27)

審 `6b6ac2a`:准規則與 25 列表,改 6 處。

1. **D1 = 乙'**:`renderCardFile` 與算圍欄長度的小函式搬進新檔 `packages/core/src/ingest/card-file.ts`(只 import `yaml`,`Card` 只准型別 import,沒有 I/O)。`children.ts` 從那裡 import 再 `export { renderCardFile }`(`topic.ts`、`deepen.ts` 不動);`ingest.ts`、`deps.ts` 直接 import `./card-file.js`。touches 加 `card-file.ts`;參數型別放寬;變異的 `mutate` 放整個 `card-file.ts`;T52 指紋掃描「不能被抓」名單加 `card-file.ts`(測試 agent 加)。→ 第 2 節、第 4 節 (c)(e)、第 5 節、驗收、改壞證明。
2. **拿掉畫面頂層例子框個數那一項**:第 3 節最後一段、第 4 節斷言 4、第 9 列的畫面註、表下面那句與「起草時量的」講畫面的部分。
3. **F1** 記著,不開票。
4. **F2** 記著,放進低優先小票清單(跟測試封閉性那幾張放一起)。
5. **記 ADR-082**(短的,當下最大號 + 1):每個 example 各自算圍欄長度 = max(3, 最長連續反引號 + 1),只用反引號;只有一個寫卡片的函式(`card-file.ts`)。不採用:改波浪號、只數能結束圍欄的行、固定寫四個。跟這張工單同一個 docs commit,放進 `../02-decision-map.md`。不是改契約:§2 本來就要求外層比內層多。
6. **字面守門只掃 `packages/` 與 `apps/`**,不掃 `scripts/`。→ 第 4 節 (d)。

## 起草時量的(只讀;丟棄式雛形在前端的暫存區,不進 git)

- **雛形**:第 1 節的規則,加上第 2 節的做法。
- **第 4 節 25 列**:
  - 今天的寫法 11 列讀回不對,新寫法 0 列;
  - 讀回再寫一次:抽 6 列(含 CRLF、NUL、body 裡有 example 圍欄)都穩定。
- **丟棄式實作**:做了兩次。第一次是 `6b6ac2a` 的乙(放在 `children.ts`);第二次是顧問裁的乙'(新檔 `card-file.ts`)。
  - 型別檢查 0 錯(參數型別不放寬時有 1 個錯,見第 2 節);
  - 乙':第 5 節的測試 3073 條全綠、`npm run boundaries` PASS;指紋掃描名單加 `card-file.ts` 後 14 條全綠;25 列直接呼叫 `card-file.ts` 的 `renderCardFile` 都對,`children.ts` 轉出去的是同一個函式;
  - 兩次量完都 `git checkout` 還原、新檔刪掉,工作樹乾淨。
- **真資料**:25 張卡、30 個 example,example 裡最長的反引號串是 1;舊寫法與新寫法寫出來 25 張一字不差;body 裡有沒關圍欄的 0 張、有 example 圍欄的 0 張。
- **golden**:114 張卡(有 `body` 與 `examples` 的)、94 個 example,最長的反引號串是 1;114 張一字不差;沒關圍欄 0 張。
- `learning/` 前後都是 64 個檔、`01d84e9c918e1cf4`、帳本 111 行(2026-10-27)。
