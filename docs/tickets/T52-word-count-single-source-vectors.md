---
id: T52
deps: [T51]
touches: [packages/core/src/schema/example-fence.ts, packages/core/src/schema/parse-card.ts, packages/core/src/schema/word-count.ts, packages/core/src/schema/index.ts, packages/core/src/lint/validator-min.ts, packages/core/src/lint/checks.ts, packages/core/src/prompt-quality/word-count.ts, packages/core/src/prompt-quality/structural-checks.ts, packages/core/src/ingest/siblings.ts, packages/ui-shared/src/word-count.ts, packages/ui-shared/src/index.ts, scripts/boundaries.allow.json, features/09-lint/FEATURE.md]
cpu: light
budget_usd: 3
status: todo
owner: worker-grok
must_catch:
  - lint 或 prompt-quality 留著自己的圍欄 regex 或 CJK 判斷(只是不再被呼叫也算) 登記掃描必須紅
  - prompt-quality 改成用 01 的圍欄但 CJK 仍照區段算 擴充 B、相容區、Hangul Jamo、Hangul 相容字母四列必須紅
  - 四反引號、空白寬容、不算結束的行那幾列在 lint 或 prompt-quality 算錯 跨實作測試必須紅
  - stripExampleFences 或 countBodyWords 跟 validateCard 有任何一列不同(body 或 examples 沒 trim、examples 順序反、少收一個) 必須紅
  - 把圍欄規則搬出 parse-card.ts 時行為變了 T51 的向量測試與空白寬容測試必須紅
  - 跨實作測試少跑了列或少跑了實作(過濾掉、提早 return、向量檔讀成空陣列) 列數與每個實作跑過的列數斷言必須紅
  - 有人把圍欄 regex 或 CJK 判斷抄進沒登記的檔 登記掃描必須紅
  - lint 的 frontmatter 行為跟著變了(例如 created 從 Date 變成字串) lint 的護欄測試必須紅
  - 畫面(markdown-it)認的 example 個數跟向量檔不一致 跨實作測試必須紅
  - 存著的 golden 輸出用新程式重算 structural 有任何一筆不同 驗收的離線重算必須擋下
  - 實作動到 touches 以外的檔(含 contracts/、prompts/、.feature、測試、向量檔) 不動的地方那條 diff 必須有輸出
  - 新寫或改過的 schema 圍欄與字數程式、validator-min.ts 變異分數低於 80%
---

# 工單 T52:字數規則只留一份實作,所有實作跑同一份向量檔

> 狀態:起草 2026-10-27,依協調者 2026-10-27 的交代。規格:UI/Tauri 負責人(代筆)。編號 T52:協調者配的(2026-10-25)。
> 實作:worker(opencode + grok-4.7);紅測試與向量檔:測試 agent(不是起草的人);驗收(含變異):驗收 agent。
> 依據:`../../contracts/types.md` §2;`../02-decision-map.md` 的 ADR-060 第 3 點(四份統一成一份,拆成 `stripExampleFences`、`countWords`、`countBodyWords`)與它的 Consequences(契約給機器可讀的向量檔、守門登記每一份實作);`T51-parse-card-fence-backtick-count.md` 的「不在範圍」與「起草時補的」第 2 點;顧問 2026-10-25 對 T51 的裁決乙(圍欄的空白寬容)。
> **這張是程式追契約:不改 `contracts/types.md`、不升契約版本、不用新 ADR。** 契約沒定義的圍欄寫法另外整理成一題給使用者(最後一節),這張不等那一題的答案。基底:main `888288d`。LLM 真呼叫 0。

## 為什麼有這張

ADR-060 決定 §2 的字數規則只留一份實作,還要交叉測試。T20 刪了 ingest 那一份,T51 把 01 那一份(`validateCard` 走的路)修到符合 §2。**還沒做的**:

1. **還有別份實作,算出來的不一樣。** 起草時在 main `888288d` 上量的(只讀;42 列候選向量,來源見「測試」一節;期望值照 §2 與裁決乙推出來,不是照某份實作抄的):

   | 實作 | 位置 | 算錯的列 | 錯在哪 |
   |---|---|---|---|
   | 01 `validateCard` / `parseCardText` + `countWords` | `../../packages/core/src/schema/parse-card.ts:22` | 0 | (權威,T51 之後) |
   | 09-lint `countBodyWords` | `../../packages/core/src/lint/validator-min.ts:36` | 字數 13 列、examples 2 列 | 圍欄寫死三個反引號、碰到第一個三反引號就結束;開始行 `example` 後面有空白就不認 |
   | 12-prompt-quality `countBodyWords` | `../../packages/core/src/prompt-quality/word-count.ts:7` | 17 列 | 同上的圍欄問題;CJK 用 Unicode 區段,擴充 B、相容區、Hangul Jamo、Hangul 相容字母各算 1(該 2,ADR-060 的表);`examples` 這種較長的標記也被當成圍欄 |
   | `packages/ui-shared` 的 `wordCount` | `../../packages/ui-shared/src/word-count.ts:11` | 2 列 | 結束行前面有 1–3 個空白就不認(裁決乙說要認)。**沒有正式呼叫端**:`apps/` 裡 0 處用它,只有自己的測試與 `index.ts` 的 export |
   | 畫面(markdown-it,`exampleFencePlugin`) | `../../packages/ui-shared/src/example-fence.ts:158` | example 個數 0 列 | (只比 example 個數,它不算字) |

2. **另外兩處也自己寫了圍欄 regex**(不是算字數,是比對內容前先拿掉例子,但規則是同一條 §2 步驟 1):
   - `../../packages/core/src/prompt-quality/structural-checks.ts:126`(`normalizeBody`,重複偵測與父子重疊用);
   - `../../packages/core/src/ingest/siblings.ts:23`(兄弟卡摘要;註解還寫「四個反引號的內層圍欄是 T20」,T20、T51 都做完了)。
3. **向量散在七個測試檔**,各抄各的:`schema/word-count.test.ts`、`schema/validate-card.contract-vectors.test.ts`、`schema/validate-card.fence-whitespace.test.ts`、`ingest/example-fence-word-count.test.ts`、`lint/validator-min.test.ts`、`prompt-quality/word-count.test.ts`、`ui-shared/src/word-count.test.ts`,外加 `../../features/01-data-layer/phase-1.feature` 的 `Word counting follows the contract` 表。lint 與 prompt-quality 那兩份只抄了 §2「關鍵推論」六列,所以全綠卻算錯(ADR-060 記的同一個病:「附向量表不等於防住漂移」)。
4. **沒有東西擋第五份。** 上面第 2 點那兩處就是沒人登記、自己長出來的。

**還沒咬到使用者**(只數,不記內容):真的 `learning/cards/` 25 張卡、30 個 example 圍欄全是三反引號;五份實作與畫面對這 25 張算出來的字數與 example 個數**全部一樣**。存著的 golden 輸出(`packages/core/src/prompt-quality/golden/` 與 `fixtures/`,42 筆輸出、96 個 body)沒有一個含反引號,prompt-quality 換成 01 的算法**0 筆字數不同**,重算 structural 也 0 筆不同。

## 要的結果

### 1. 一份向量檔(測試 agent 寫,實作不改)

新檔 `contracts/fixtures/word-count-vectors.json`(fixture 規則「加新的隨時可以」,見 `../../contracts/fixtures/README.md`)。格式照 `contracts/fixtures/path-segment-vectors.json` 的做法:

- **整個檔只用 ASCII**,非 ASCII 字元一律寫成 JSON 的 `\u` 跳脫(說明用英文)。理由跟路徑向量一樣:編輯器的 NFC 會把 U+F900 換成 U+8C48,那一列就失去意義而且不會報錯。
- 每一列:`name`(唯一)、`body` 或 `fixture`(二擇一;`fixture` 是 `contracts/fixtures/` 底下的相對路徑,讀檔後拿掉 frontmatter 當 body)、`words`、`examples`(trim 過、依出現順序的內容陣列;沒有就是空陣列,每一列都要有)、`covers`(這一列涵蓋哪些類別,見下)、`basis`(依據,下面幾種之一)、`why`(推導過程,一句英文)。
- `basis` 只能是:§2「關鍵推論」表;§2「1.2.0 向量表」;§2 定義推導(`why` 寫是哪一步);顧問 2026-10-25 的裁決乙(T51);fixture;01 phase-1 的 gherkin 表。**每一列都從定義推出來,不從某份實作的輸出抄。**
- `covers` 要涵蓋 §2 定義裡**每一個類別**(ADR-060:向量要涵蓋類別,不是只涵蓋例子)。至少:
  - CJK:Han(一般、擴充 A、擴充 B、相容區)、Hiragana、Katakana、Hangul(音節、Jamo、相容字母);CJK 切斷字母數字序列(`字a` = 2)。
  - 字母數字:拉丁字母、非拉丁的 L*(例如希臘或西里爾字母)、全形英數、數字、N* 的其他數字(例如上標 ²)、**Script 是 Common 但類別是 L 的字**(U+30FC 長音符號:不是 CJK,是字母數字,所以兩個相連算 1)。
  - 切斷:空白、全形空白 U+3000、連字號、句點、撇號、CJK 標點(`。` `、`)、符號(反引號、emoji)。
  - 空字串 = 0;上限邊界(100、101)。
  - 圍欄(§2 與裁決乙):三反引號;四反引號含內層三反引號;五反引號含內層四反引號;一張卡多個 example 依序;非 `example` 的圍欄(`js`)不移除;`examples` 這種較長的標記不是;兩個反引號不是圍欄;CRLF;結束行在檔尾沒有換行;結束行尾有空白或 Tab;結束行縮排 1–3 個空白;開始行 `example` 後有空白或 Tab;圍欄裡「N 個反引號後面接字」與「內容貼著 N 個反引號結尾」的行不算結束。
  - fixture:`contracts/fixtures/cards/wordcount-cases.md` = 23;`contracts/fixtures/cards/valid-example-with-nested-content.md` = 27、examples 1 個(含內層程式碼圍欄)。
  - 01 phase-1 gherkin 那張表的九列,每一列都要在向量檔裡、數字相同。
- 起草時用的 42 列候選(上面那張表的數字從這裡來)已經涵蓋 §2 兩張表全部、T51 的兩個測試檔、T20 搬過來的案例、prompt-quality 與 lint 現有的案例。測試 agent 可以自己重推,**有一列推出來跟上表的「算錯的列」對不上,就停下回報**。
- `contracts/fixtures/README.md` 的清單加一行說明這個檔(測試 agent 加)。

### 2. 只留一份實作:01 的 `@core/schema`

`@core/schema/index.ts` 多 export 兩個(ADR-060 第 3 點的名字):

- `stripExampleFences(text)` → `{ body, examples }`:圍欄規則就是 `parse-card.ts:22` 現在那條(T51 + 裁決乙),**一個字都不改**。`body` 是拿掉所有 example 圍欄之後再 trim;`examples` 是每個圍欄的內容、trim 過、依出現順序。
- `countBodyWords(text)` = `countWords(stripExampleFences(text).body)`。
- 圍欄 regex 搬到新檔 `packages/core/src/schema/example-fence.ts`,`parse-card.ts` 改成呼叫 `stripExampleFences`。這樣 `word-count.ts` 用得到 `stripExampleFences`,又不必帶進 gray-matter。
- `parseCardText`、`countWords`、`validateCard` 的行為**不變**(既有測試全綠)。

其他地方改成用它:

| 位置 | 改成 |
|---|---|
| `lint/validator-min.ts` | 不再有自己的圍欄 regex、CJK 或字母數字判斷。`countBodyWords` 改成從 `@core/schema` 轉 export(`lint/index.ts` 的 export 不變)。`parseCard` 的 frontmatter 照舊用 gray-matter(**不做** `parseCardText` 的日期轉換,lint 的 frontmatter 行為一個都不改);body 與 examples 用 `stripExampleFences`。檔頭註解改寫:字數與圍欄用 01(T52、ADR-060);frontmatter 的最小驗證還是 Wave 0 的「另一雙眼睛」,I6 再換 |
| `lint/checks.ts` | 字數用 `countWords(parsed.body)`(body 已經拿掉圍欄),跟 `validateCard` 同一條路;不要再用 `countBodyWords` 拿掉第二次 |
| `prompt-quality/word-count.ts` | `countBodyWords` 改成從 `@core/schema` 轉 export,不留自己的邏輯(`prompt-quality/index.ts` 不變) |
| `prompt-quality/structural-checks.ts` | `normalizeBody` 用 `stripExampleFences(body).body` 取代自己的 regex(顧問 D2 選 A 才做) |
| `ingest/siblings.ts` | 摘要用 `stripExampleFences(body).body` 取代自己的 regex(D2 選 A 才做) |
| `ui-shared/src/word-count.ts` | 刪掉,`ui-shared/src/index.ts` 拿掉那一行 export(D1 選 A 才做) |
| `scripts/boundaries.allow.json` | 加一條 `12-prompt-quality → 01-data-layer`,理由寫 T52 與 ADR-060 第 3 點;`09-lint → 01-data-layer` 那條的理由補上字數與圍欄(不加新條) |
| `features/09-lint/FEATURE.md` | 「Wave 0 的重複」那張表註明:字數與圍欄 T52 起改用 01,最小驗證器的其餘部分仍在 I6 移除 |

### 3. 登記每一份實作(守門,在跨實作測試裡)

- 測試裡有一份**登記表**:每一份讀 §2 規則的程式各一列(檔案、怎麼呼叫、比字數還是比 examples)。T52 之後應該是:`validateCard`、`parseCardText`、`stripExampleFences`、`countBodyWords`、lint 回報字數的那條路(掃描 → 檢查)、lint 的 `parseCard`、prompt-quality 的 `countBodyWords`、ingest 的 `enforceWordLimit`(T20 那條差分)、畫面的 markdown-it(只比 example 個數)。
- **每一份都跑向量檔的每一列。** 斷言列數(不准少跑)、每份實作跑過的列數等於向量檔列數。
- **指紋掃描**:掃 `packages/`、`apps/`、`scripts/`、`features/steps/` 底下的非測試原始碼(含 `apps/*/src-tauri/src/` 的 Rust),找「長得像 §2 實作」的寫法:`Script=Han` 這類 Script 判斷、CJK 區段的碼位範圍(`0x4e00` 之類)、反引號接 `example` 的 regex 或字串。命中的檔**必須在登記表裡,或在例外表裡附理由**,否則紅。T52 之後的例外只有三個寫卡片的地方(`ingest/ingest.ts`、`ingest/children.ts`、`ingest/deps.ts`,它們是寫圍欄、不讀,見「起草時補的」F1)。
- 在 main `888288d` 上,掃描會抓到 `lint/validator-min.ts`、`prompt-quality/word-count.ts`、`prompt-quality/structural-checks.ts`、`ingest/siblings.ts`、`ui-shared/src/word-count.ts` 五處沒登記的副本(紅)。

## 測試(測試 agent 寫,實作不改)

| 檔 | 內容 | 在 main `888288d` 上 |
|---|---|---|
| `contracts/fixtures/word-count-vectors.json` | 上面第 1 節 | — |
| `features/support/word-count-vectors.test.ts`(新;`features/support/` 是膠水,import 哪一層都不會被邊界檢查擋) | 向量檔的結構檢查(ASCII、欄位、`basis` 合法、`covers` 涵蓋全部類別、U+F900 那一列真的是 U+F900、fixture 檔存在、gherkin 表九列都在);登記表每份實作跑每一列;指紋掃描 | `validateCard`、`parseCardText`、ingest、畫面那幾份綠(護欄);`stripExampleFences`、`countBodyWords` 紅(還沒有);lint、prompt-quality 紅(列數見第一張表);掃描紅 |
| lint 的護欄 | `parseCard` 的 frontmatter 照舊(沒加引號的 `created` 還是 gray-matter 給的 Date,不是字串) | 本來就綠 |
| 既有的向量測試 | 第 3 點那七個檔:各自抄的表**改成讀向量檔**,或確認已被新測試蓋到後刪掉(刪的每一條要在 commit 說明寫替身在哪);`ui-shared/src/word-count.test.ts` 跟著 D1 處理 | — |

- 測試一律從 `@core/schema/index.js` import 新函式,不綁內部檔名。
- **不測**:最後一節那一題的幾種寫法,M*(組合記號)、Cf(格式字元)這類 §2 沒列名的字元(見 F2)。測試與向量檔裡都不放這類字串。
- 紅綠寫進紅測試的 commit 說明。

## 契約沒定義的(不測,碰到就停)

- 圍欄:開閉在同一行、未閉合、結束的反引號比開始多、`example` 後面還有別的字(中間隔空白)、縮排 4 個以上、開始行前面有別的字。現在這幾種的算法**照 `parse-card.ts` 現狀,不擴大、不收窄**。
- 字元:§2 的三類只列了 CJK、L* 與 N*、空白標點符號;M*、Cf 等沒列名(F2)。現在五份實作都當「其他」,照現狀。

碰到上面任何一種(舊測試裡有、或改了之後兩邊算出來不同):**停下來,回報協調者**,附案例字串、兩邊各算幾、哪一條測試。不要為了讓測試綠去選邊。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 單元 | `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/schema/ packages/core/src/lint/ packages/core/src/prompt-quality/ packages/core/src/ingest/ packages/ui-shared/src/ features/support/word-count-vectors.test.ts scripts/lint.test.ts` | 全綠 |
| 守門 | `npm run typecheck`、`npm run boundaries`、`npm run check:json-duplicate-keys` | 全過;boundaries 的例外條數 +1 |
| 釘住 allow 的測試 | `git grep -n boundaries.allow -- '*.test.ts'` 列出的檔全跑 | 全綠(動到 allow JSON 不能只跑輕守門) |
| 不退步 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@data-layer and not @manual' --format summary`;`--tags '@lint and not @manual'`;`--tags '@prompt-quality and not @manual and not @llm'`;`--tags '@i1 and not @manual and not @llm and not @e2e'` | 全綠(重活,拿位子) |
| golden 離線重算 | 驗收 agent 寫一支丟棄式腳本:每一筆存著的 golden 輸出,用新程式重跑 `runStructuralChecks(text)`,跟檔裡存的 `structural` 比 | 0 筆不同。**不跑 live golden**(沒動 `prompts/`,CLAUDE.md 硬規則 4 不適用),LLM 0 |
| 真資料 | 用自己的簽出,對真的 `learning/cards/` 每張卡比:T52 之後 lint 回報的字數、`validateCard` 的字數、T52 之前 lint 的字數(紅測試分支的基底) | 三個數字每張都相同(只記「全部相同 / N 張不同」,不記檔名);`learning/` 檔案數、整體雜湊、帳本行數前後相同 |
| 變異 | `npm run mutate -- stryker.t52-word-count.json`(驗收 agent 加,照 `stryker.t51-parse-card.json` 的寫法;`mutate` 放 `schema/example-fence.ts`、`schema/word-count.ts`、`schema/parse-card.ts`、`lint/validator-min.ts`) | 每檔 ≥ 80%;存活的逐條說明 |
| 不動的地方 | `git diff --stat <紅測試分支的 tip>..HEAD -- contracts prompts packages/core/prompts features/**/*.feature packages/ui-shared/src/example-fence.ts packages/core/src/ingest/generate-cards.ts packages/core/src/schema/validate-card.ts` | 沒有輸出 |

**改壞證明**(驗收 agent 的丟棄式證明,每條:改了哪裡、哪一條紅、訊息原文、還原後綠):

- prompt-quality 的轉 export 換回舊檔 → 跨實作測試紅、掃描紅;
- 只把 prompt-quality 的 CJK 換回區段 → 四列 CJK 紅;
- `stripExampleFences` 的 body 不 trim、或 examples 順序反 → 紅;
- lint 的 `checks.ts` 改回 `countBodyWords(parsed.body)` 之外的另一份算法 → 紅;
- 在任何一個沒登記的檔加一行 `\p{Script=Han}` → 掃描紅;
- 向量檔刪掉一列、或讓測試只跑前 10 列 → 列數斷言紅;
- 把 U+F900 那一列存成 U+8C48 → 結構檢查紅。

## 受保護的檔(開發 worker 不改)

- 測試與向量:`*.test.ts`、`features/**`(除了 `features/09-lint/FEATURE.md`)、`.feature`、`contracts/`(含新向量檔與 fixture README)。worker 覺得測試或向量有錯,寫進報告的「待協調」,不改。
- 實作:`prompts/`、`packages/core/src/schema/validate-card.ts`、`packages/core/src/ingest/generate-cards.ts`、`packages/ui-shared/src/example-fence.ts`、touches 以外的一切。

## 落點

- `packages/core/src/schema/` → 01-data-layer;`lint/` → 09-lint;`prompt-quality/` → 12-prompt-quality;`ingest/` → 02-ingest-pipeline;`ui-shared/` → 07-teach-card(`../../scripts/boundaries.owners.json`)。
- import 例外:新增 `12-prompt-quality → 01-data-layer` 一條;`09-lint → 01-data-layer`、`02-ingest-pipeline → 01-data-layer` 已有。`ui-shared` 不 import `@core`(D1 選 A 就不需要)。

## 不在範圍

- 契約沒定義的圍欄寫法與字元類別(最後一節那一題、F2)。使用者選了要定義,另開工單:改 §2、加向量列、改 `example-fence.ts`。T52 做完之後那張只要加列。
- `ingest/generate-cards.ts` 的字數寫法(T20 定的 `countWords(parseCardText(...).body)`,跟 `countBodyWords` 同值,登記表會守著)。
- 寫卡片時一律用三個反引號(F1)。
- lint 最小驗證器的 frontmatter 部分(I6)。

## 預算

`budget_usd: 3`(五、六個小檔;grok 不設停止線,只記錄)。LLM 花費 0。`cpu: light`(開發只跑 vitest);變異與 cucumber 是驗收的重活,協調者排位子。

## 測試誰寫

- 向量檔與紅測試:測試 agent(起草的人不寫)。改壞證明與變異:驗收 agent。開發 worker 以紅測試分支為基底,不改測試、不改向量檔。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。

## 起草時補的(請顧問看)

**D1. `ui-shared/src/word-count.ts`(沒有正式呼叫端,2 列算錯)**

- A(建議)**刪掉**,連同 `index.ts` 的 export 與它的測試。ADR-060 第 3 點本來就是「統一成一份」;沒人用的副本最容易漂。
- B 留著、修到跑過向量。代價:`ui-shared` 要 import `@core`(07 → 01 新例外,而且教學卡的 webview 會帶進 core),或繼續自己抄一份再靠登記表守。

**D2. 另外兩處圍欄 regex(`structural-checks.ts:126`、`siblings.ts:23`)**

- A(建議)**併進 T52**,改用 `stripExampleFences`。同一條 §2 步驟 1;golden 與真資料 0 筆受影響;不做的話登記表要替它們開例外。
- B 不在 T52,登記成例外,另開小票。

**D3. `contracts/fixtures/cards/README.md` 第 5 行寫 `wordcount-cases.md` 的正確字數是 26**

同一份檔後面又寫「合計 23(表格加總曾誤植為 26,已修正)」,再後面還有一段「待確認」。四個測試都釘 23,新向量檔也會寫 23。fixture 規則寫「改既有的要 ADR」,所以不在 worker 的範圍。建議:顧問裁一句(或記一行 ADR),協調者把第 5 行改成 23、刪掉「待確認」那段;fixture 本身不動。

**F1. 寫卡片時一律用三個反引號(不在 T52)**

`../../packages/core/src/ingest/ingest.ts:215`、`../../packages/core/src/ingest/children.ts:124`、`../../packages/core/src/ingest/deps.ts:332` 都是 ``'```example\n' + e.trim() + '\n```'``。§2 說內容裡有三反引號程式碼圍欄時外層要用四個;現在模型給的 example 只要含一個程式碼區塊,寫出去的卡就會被內層的結束行提早關掉(剩下的那行跑進 body)。起草時數的:golden 存著的 94 個 example、真資料 30 個 example,含反引號圍欄行的都是 **0**。建議另開小票:開始與結束用「比內容裡最長的反引號串多一個,至少三個」,加一條寫完再讀回來相等的測試。

**F2. §2 的三類沒列名的字元**

§2 步驟 2 的「其他」寫的是「空白、標點(P*)、符號(S*)」;M*(組合記號,例如 é 拆開寫的那一撇)、Cf(格式字元,例如零寬連接)、Co、Cn 沒列名。現在五份實作都把它們當「其他」(切斷序列、計 0)。真資料 25 張卡的 body(1099 個字元)與 golden 96 個 body(5602 個字元)命中都是 0。使用者若在下面那一題選 A,建議同一次改契約順便寫一句「不是 CJK、也不是 L* 或 N* 的字元一律算其他」(跟現在所有實作一致,程式不用改)。

## 給使用者的一題(顧問轉問)

> **卡片裡的「例子框」寫得怪怪的時候,字數要怎麼算?**
>
> 例子框是卡片裡用 ```` ```example ```` 包起來的那一段,裡面的字不算進 100 字上限。契約只講了正常的寫法,下面這幾種怪寫法沒講:
>
> 1. 開和關寫在同一行
> 2. 開了沒關
> 3. 關的反引號比開的多
> 4. `example` 後面還有別的字(例如 `example 標題`)
> 5. 縮排 4 格以上
> 6. 開的那一行前面還有別的字(起草時多找到的)
>
> 你的 25 張真卡片、30 個例子框:**六種都是 0 次**。golden 存著的模型輸出也是 0 次。
>
> - **A(建議)跟畫面一樣。** 教學卡畫面把它當例子框,就不算字;畫面當一般文字,就照算。要改一次契約 §2(硬約定)再加一張小工單。好處:字數永遠跟畫面對得上;§2 本來就寫「與 CommonMark 一致」,畫面就是 CommonMark,A 只是把這句做完整。
> - **B 先不定義。** 維持現在,不花工。壞處:哪天模型剛好這樣寫,字數跟畫面會對不上。今天就有 4 種(2、3、4、6)對不上。

給顧問的細節(不用轉給使用者):

| 寫法 | 現在 `validateCard` 怎麼算 | 畫面(markdown-it)怎麼認 | 選 A 之後 |
|---|---|---|---|
| 1 開關同一行 | 不是圍欄,照算 | 不是圍欄(開始行的資訊字串不能有反引號),當行內程式碼 | 不變 |
| 2 沒關 | 不是圍欄,照算 | 圍欄一直到卡片結尾 | 開始那一行之後都不算 |
| 3 關的比開的多 | 不算結束(要剛好 N 個) | 算結束(至少 N 個) | 算結束 |
| 4 `example` 後還有字 | 不是 example | 看第一個字,是 example | 是 example |
| 5 縮排 4 格以上 | 結束行不算結束;開始行看情況 | 結束行不算結束;開始行是縮排程式碼,不是圍欄 | 開始行縮排 4 格以上不是圍欄 |
| 6 開始行前面有字 | 是 example(開始不必在行首) | 不是圍欄 | 不是圍欄,照算 |

- 起草時對同一段內容量的字數(`前` + 圍欄 + `後`,圍欄裡 4 個字):1 是 7 / 7;2 是 7 / 1;3 是 7 / 2;4 是 9 / 2;6 是 2 / 7(`validateCard` / 畫面)。5 只有跟「沒關」連在一起才會不同。
- 我沒把「驗證器直接拒收這幾種」列成選項:模型產生的卡會多一條被擋下的路,而別人手寫的卡畫面還是照 CommonMark 顯示,字數跟畫面一樣會分家。
- 選 A 的話,F2 那一句可以同一次一起改(不用再開一次硬約定的門)。
