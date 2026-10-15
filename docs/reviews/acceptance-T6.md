# 驗收證據:T6 `CategoryId` 收窄成 §13 的一個合法段

驗收角色:-ed(測試 agent 兼驗收)。日期:2026-10-15(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`pollux0971/t6-claude` @ `cda377e`,tree `1990dba4441e28fe1ff992114983029f3446365d`,base `t6-base` = `fc9fbb6`(`ea4e688` 加工單 touches 補丁加測試作者 -e5 的紅分支 `5b8fa6e`)。worker 只有 2 個 commit:`94896c5` 實作、`cda377e` 報告。
**開跑 tree sha:`1990dba4441e28fe1ff992114983029f3446365d`。跑完 tree sha:`1990dba4441e28fe1ff992114983029f3446365d`(相同)。** 所有突變都在驗收簽出做,事後還原,tracked 範圍的 `git status --porcelain` 為 0。
驗收簽出:`acceptance-t6`(detached @ `cda377e`,`npm ci`,沒有 `.env`);我的補測在其上的分支 `pollux0971/t6-accept-tests`(只動測試檔與本證據檔)。
我只交證據與測試。不合併、不 push、沒改 worker 的任何實作檔。

## 0. 結論

**CategoryId 驗證本身(契約 §1/§13 的規則、schema 兩處、ingest 的函式庫入口、lint)沒有阻擋項**;但**使用者真正跑的入口 `scripts/ingest.ts` 有一個缺陷**,請顧問裁它擋不擋(下表 T6-A)。結論由顧問裁。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| T6-A | **已修,已驗(見 §12)** | `scripts/ingest.ts` 先 `ensureInitialized(輸出目錄)` 才 `setCategory`:不合法的 `--category C++` 會**先把整個骨架建出來**(`config/categories.yaml`、`settings.yaml`、`state/log.jsonl`、各子目錄),再丟一段 stack trace、退出碼 1。工單驗收 3 要求「整個輸出目錄列檔前後相等」——`runIngest` 函式庫入口做到了,真正的使用者入口沒有。已有骨架的輸出目錄不受影響(實測前後相等) | 3 條 CLI 紅測試已在我的分支;修法一行(在 `ensureInitialized` 之前驗證並印一行訊息)。`scripts/ingest.ts` 不在工單 `touches` 裡 |
| T6-B | 缺口(低) | lint 不掃 `graph/order-<分類>.json` 的檔名與 `graph/deps.json` 的 key。重現:只有這兩處壞時 lint 回報 0 個。契約 §1 自己點名分類名會出現在 `graph/order-<cat>.json` 的路徑裡。對真實資料無影響(0 個不合法),且只要 `raw/`、`cards/` 還有同名資料夾就會被另外報到 | 建議後續處理 |
| T6-C | 已補 | `setCategory` 的驗證被整個拿掉,原本**沒有任何測試變紅**(Stryker 之外我自己的突變 S15 存活) | 已補測(`97bb1dc`),該突變現在紅 |
| T6-D | 已審 | -e5 改了既有測試 3 處(`index.test.ts` 兩條、`graph.test.ts` 一條) | 沒有放寬,見 §8.3 |
| T6-E | 流程 | 工單的 R2:本張動 `packages/contracts/src/index.ts`,T8 動同目錄的 `witness.ts`——不同檔、同落點 | 協調者已定 T6 先合 |

## 1. 乾淨簽出

- `ls <acceptance-t6>/.env` → `No such file or directory`。T6 沒有 Rust 變更,**不需要重編** lc-fs。
- **測試作者檢查**:`git diff --name-only fc9fbb6 cda377e` 中的 `*.test.ts`、`features/steps/**`、`contracts/fixtures/**` 共 **0** 個——worker 沒有碰任何測試檔。T6 的測試全來自 -e5 的 `5b8fa6e`(`category-id.test.ts`、`category-id.schema.test.ts`、`category-id-schema.test.ts`、`ingest-category.test.ts`、`category-lint.test.ts`、fixture `learning-broken-category/`、`index.test.ts` 與 `graph.test.ts` 的改動)。我補的測試是另一個 commit。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯誤 |
| `npm run boundaries` | PASS,掃描 228 |
| `npm run lint:docs`、`npm run check:steps` | PASS |
| vitest(contracts、core 的 schema/ingest/lint,共 40 檔) | 806 條全綠,45 秒 |
| cucumber 全 feature | 677 scenarios(241 undefined、436 passed),3161 steps——與 T5 驗收時的 base 逐數相同 |
| 併進最新 main(`49090e1`)的合併樹 | `git merge-tree` 無衝突;tsc 0 錯、boundaries PASS(232)、lint:docs PASS;合併樹上的測試結果見 §9 備註 |

## 3. 工單 must_catch 十條(20 個突變,只改實作或向量檔)

做法:改實作 → 跑 contracts 與 core 的 schema/ingest/lint 全部測試 → 記紅 → `git checkout` 還原。表中「紅的測試」是實際變紅的測試名(節錄)。

| 突變 | 做法 | 結果 | 紅的測試 |
|---|---|---|---|
| MC1 | 放行 `C++`(拿掉字元集合檢查) | 紅 | 拒絕 "C++" …(共 14 條) |
| MC2 | 放行非 NFC | 紅 | 拒絕 "가" …(共 13 條) |
| MC3 | 放行結尾的點 | 紅 | 拒絕 "a." …(共 8 條) |
| MC4 | 放行開頭的點 | 紅 | 拒絕 ".hidden" …(共 8 條) |
| MC5a | 放行 Windows 保留名(拿掉 reserved 檢查) | 紅 | 拒絕 "nul" …(共 12 條) |
| MC5b | `COM¹` 這類上標數字不在保留名裡 | 紅 | 拒絕 "COM¹" …(共 4 條) |
| MC6a | 65 位元組放行(上限 64→65) | 紅 | 拒絕 "가가가가가가가가가가가가가가가가가가가가가ab" …(共 8 條) |
| MC6b | 64 位元組被拒(`>` 變 `>=`) | 紅 | 放行 "가가가가가가가가가가가가가가가가가가가가가a" …(共 4 條) |
| MC6c | 長度用字元數不是位元組 | 紅 | 拒絕 "가가가가가가가가가가가가가가가가가가가가가ab" …(共 8 條) |
| MC7 | ingest 拒絕前先建骨架(先 `ensureInitialized`) | 紅 | 資料夾 C++:拒絕、退出碼非 0、訊息含資料夾名與 rule charset、LLM 沒被呼叫、輸出目錄零變動 …(共 7 條) |
| MC8a | `CategorySchema` 的 id 不再擋(categories.yaml) | 紅 | CategorySchema.id 與 CardFrontmatterSchema.category 都用同一個規則 …(共 12 條) |
| MC8b | 卡片 frontmatter 的 category 不再擋 | 紅 | CategorySchema.id 與 CardFrontmatterSchema.category 都用同一個規則 …(共 12 條) |
| MC9a | lint 完全不跑 invalid_category 檢查 | 紅 | 恰好 3 個問題,都是 invalid_category,位置與 rule 對得上 EXPECTED.md …(共 14 條) |
| MC9b | lint 漏掉 `raw/` 資料夾 | 紅 | 恰好 3 個問題,都是 invalid_category,位置與 rule 對得上 EXPECTED.md …(共 8 條) |
| MC9c | lint 漏掉 `cards/` 資料夾 | 紅 | cards/C++ 也回報(資料夾名),detail 含 rule charset …(共 6 條) |
| MC9d | lint 漏掉 categories.yaml 的 id | 紅 | 恰好 3 個問題,都是 invalid_category,位置與 rule 對得上 EXPECTED.md |
| MC9e | lint 漏掉卡片 frontmatter 的 category | 紅 | 恰好 3 個問題,都是 invalid_category,位置與 rule 對得上 EXPECTED.md …(共 3 條) |
| MC10a | 向量檔:`C++` 那列預期被翻轉(證明測試真的讀檔) | 紅 | 檔案在、列數對得上(防止測試對著空陣列綠) …(共 2 條) |
| MC10b | 向量檔:刪光 `length` 的列(rule 覆蓋守門) | 紅 | only drops the exact offending [from, to] pair, keeping edges th… …(共 6 條) |
| MC10c | 向量檔:刪光 `reserved` 的列 | 紅 | 檔案在、列數對得上(防止測試對著空陣列綠) …(共 4 條) |

十條(含 a/b/c 變體)全部變紅。「測試複製了向量常數、沒有真的載入向量檔」由 MC10a/b/c 證明:改向量檔的一列、刪光某個 rule 的列,測試都會紅,所以測試是在執行時讀檔,不是抄常數。

## 4. 自選突變與過度拒絕突變(要求 ≥ 3,實際 28 條)

`S` 是我設計的 18 條(漏判類與介面類);`V`、`SK` 是向量檔與 Stryker 存活的手動重做;`P1`–`P8` 是**過度拒絕**類(把合法的分類也拒絕,用來證明「正向對照」測試真的有用——先前它們沒有任何漏判類突變會讓它們變紅)。

| 突變 | 做法 | 結果 | 紅的測試(一條) |
|---|---|---|---|
| P1 | 字元集合只收 ASCII(日文分類被誤殺) | 紅 | 放行 "セキュリティー" …(共 28 條) |
| P2 | 含大寫字母就拒絕(Security 被誤殺) | 紅 | 放行 "Security" …(共 14 條) |
| P3 | 保留名用前綴比對(console 被誤殺) | 紅 | --category C++(rule charset):退出碼非 0,訊息帶值與 rule 名,不是一段 stack trac… …(共 4 條) |
| P4 | ingest 一律拒絕(合法的也被誤殺) | 紅 | 只印一個卡片張數,後面接建立的卡片 id …(共 41 條) |
| P5 | setCategory 一律丟錯 | 紅 | 只印一個卡片張數,後面接建立的卡片 id …(共 6 條) |
| P6 | lint 判斷反過來(合法的被報) | 紅 | 恰好 3 個問題,都是 invalid_category,位置與 rule 對得上 EXPECTED.md …(共 23 條) |
| P7 | lint 每個違規報兩次 | 紅 | --category C++(rule charset):退出碼非 0,訊息帶值與 rule 名,不是一段 stack trac… …(共 17 條) |
| P8 | CategoryIdSchema 一律拒絕 | 紅 | 放行 "security" …(共 93 條) |
| S2 | 保留名比整個值而不是第一個 . 之前 | 紅 | applies_to 含 category 的每一列,結果等於 expect;拒絕時 rule 等於該列的 rule |
| S3 | COM0/LPT0 也當保留名 | 紅 | applies_to 含 category 的每一列,結果等於 expect;拒絕時 rule 等於該列的 rule |
| S4 | LPT 不在保留名 | 紅 | applies_to 含 category 的每一列,結果等於 expect;拒絕時 rule 等於該列的 rule |
| S5 | 空字串放行 | 紅 | 拒絕 "" …(共 5 條) |
| S6 | 斜線不單獨回報 separator | 紅 | §1 basic types …(共 2 條) |
| S7 | 開頭點與結尾點檢查順序對調 | 紅 | applies_to 含 category 的每一列,結果等於 expect;拒絕時 rule 等於該列的 rule |
| S8 | 字元集合多放行 + | 紅 | 拒絕 "C++" …(共 12 條) |
| S9 | 字元集合不含組合記號 M | 紅 | 拒絕 "é",錯誤訊息含 rule 名 nfc …(共 3 條) |
| S10 | 字元集合不含連字號 | 紅 | 放行 "a.b-c_d9" …(共 4 條) |
| S11 | NFC 比對改成 NFKC | 紅 | 拒絕 "COM¹",錯誤訊息含 rule 名 reserved …(共 3 條) |
| S12 | ingest 只擋 raw 推出來的分類,不擋明講的 category | 紅 | 明講的 category 不合法也拒絕(raw 資料夾本身是合法的),輸出目錄零變動 |
| S13 | ingest 拒絕訊息不帶 rule 名 | 紅 | §1 basic types …(共 33 條) |
| S14 | ingest 拒絕退出碼 1→0 | 紅 | 資料夾 C++:拒絕、退出碼非 0、訊息含資料夾名與 rule charset、LLM 沒被呼叫、輸出目錄零變動 …(共 7 條) |
| S15 | setCategory 不再擋不合法 id | 紅 | S15: 不合法的 id 丟錯(訊息帶被拒絕的值與 rule 名),categories.yaml 一個位元組都沒變 …(共 5 條) |
| S16 | 拒絕訊息不帶被拒絕的值 | 紅 | 恰好 3 個問題,都是 invalid_category,位置與 rule 對得上 EXPECTED.md …(共 14 條) |
| S17 | lint 問題的 detail 不帶 rule | 紅 | 恰好 3 個問題,都是 invalid_category,位置與 rule 對得上 EXPECTED.md …(共 13 條) |
| S18 | lint 的 type 寫成別的 | 紅 | 恰好 3 個問題,都是 invalid_category,位置與 rule 對得上 EXPECTED.md …(共 14 條) |
| SK1 | Stryker 存活突變手動重做:lpt 前綴換成空字串 | 紅 | applies_to 含 category 的每一列,結果等於 expect;拒絕時 rule 等於該列的 rule |
| V1 | 向量檔:刪光 nfc 的列 | 紅 | 檔案在、列數對得上(防止測試對著空陣列綠) …(共 4 條) |
| V2 | 向量檔:刪光 charset 的 refuse 列後只剩 accept(翻轉 emoji 那列) | 紅 | 檔案在、列數對得上(防止測試對著空陣列綠) …(共 2 條) |

全部變紅。其中 **S15**(`setCategory` 不再擋不合法的 id)**原本存活**:`ingest/init.ts` 加了這道檢查,卻沒有任何測試會因為它被拿掉而變紅。補測之後紅(T6-C)。

## 5. Stryker(驗證器屬嚴格級,門檻 95%)

指令:`npm run mutate -- --mutate "packages/contracts/src/index.ts:18-92"`(`CategoryId` 的全部實作:規則函式、保留名表、訊息、schema),`MUTATE_TEST_GLOB` 蓋 contracts 與 core 的 schema/ingest/lint,perTest 覆蓋,`VITEST_MAX_WORKERS=1`,耗時 2 分 34 秒,load 約 2–3。

| 範圍 | 總分 | 殺 | timeout | 存活 | 型別錯誤(不能編譯的變異體) |
|---|---|---|---|---|---|
| `packages/contracts/src/index.ts` 第 18–92 行 | **97.62**(≥ 95 ✅) | 34 | 7 | 1 | 22 |

**唯一的存活突變**:保留名表的 `'lpt' + d` 換成 `"" + d`(第 53 行)。這是**模組載入時算一次的常數**,Stryker 對這種靜態初始化的變異體在 perTest 模式下不會重新載入模組,所以記成存活。我手動把同一個變異做在檔案上(SK1)再跑一遍:**紅**(向量檔裡的 `lpt9`、`LPT²` 兩列會抓到)。所以實際上沒有存活的非等價突變。

## 6. 對抗式審核(流程第 4 步)

模型 `xai/grok-4.20-0309-reasoning`,經 `opencode run`,**工作目錄是一個空目錄**(這次改正了 T5 時把暫存區的突變腳本也暴露給它的問題)。prompt 約 46 KB(工單、`CategoryId` 實作、ingest/lint 的 diff、向量檔全文、三個新測試檔全文、五點檢查要求)。耗時 1 分 43 秒。結論「有阻擋項」。逐條我自己重驗:

| grok 主張 | 我的重現 | 判定 |
|---|---|---|
| 1/4 高:lint 遺漏 `graph/order-<cat>.json` 檔名、`deps.json` 的 key、questions 與 log 裡的 category | 做了一個只有 `graph/order-C++.json` 與 `deps.json` 的 key 是壞名字的資料目錄:lint 回報 **0** 個。`questions` 與 log 事件在契約裡**沒有** category 欄位,所以那兩個位置不存在 | **部分成立**:graph 的兩處屬實(T6-B,低);questions 與 log 不成立 |
| 2 高:兩處既有測試被放寬 | 逐條審 diff:`index.test.ts` 把整句訊息改成「訊息含 rule 名」,新斷言要求 rule 名出現,舊斷言只要求文字;`graph.test.ts` 刪掉的測試靠「空字串同時違反兩條規則、zod 回兩個 issue」,新的 `CategoryIdSchema` 只加一個 issue,任何輸入都產生不出兩個,「用 `; ` 接起來」的行為在這一層已經測不到,不是被放寬 | **不成立**(§8.3) |
| 3 中:`ctx.addIssue(字串)` 不是物件,zod 可能不認 | 型別檢查 0 錯;schema 兩處的測試斷言訊息含 rule 名且全綠;MC8a/MC8b(把 schema 換成不擋的)各自紅 | **不成立** |
| 5 低:Unicode 邊界(孤立代理、零寬、RTL、同形字)與保留名邊界 | 實測 22 組(見下),全部符合規格與向量檔期待 | **不成立** |
| 6 中:`inferCategory` 的路徑推導(`..`、尾斜線、大小寫)可能繞過 | 讀程式:`inferCategory` 只有在路徑恰好是 `raw/<段>/<檔>`(三段)時才取第二段,其他一律回 undefined、走預設分類 `security`;明講的 `category` 與預設值都經過 `validateCategoryId`。**沒有繞過的路徑**;預設 `security` 本身是合法分類 | **不成立** |

**Unicode 與保留名實測**(`validateCategoryId` 的回傳):孤立高代理 `\uD800` → charset;零寬連接符、BOM、RLO(U+202E) → charset;`nul` 加空白 → charset;`NUL.txt` → reserved;`com1.` → trailing-dot(結尾點先於保留名,與向量檔一致);`COM²` → reserved;`LPT0` → 放行(§13 不含 0);全形 `ｎｕｌ` → 放行;`console` → 放行;64 個 ASCII → 放行,65 個 → length;`.` 與 `..` → leading-dot;emoji → charset;帶組合記號的天城文 → 放行;NFD 的 `é` → nfc,NFC 的 `é` → 放行;tab、NUL 字元、反斜線 → charset。

## 7. 使用者資料與真實資料比對

- **`learning/` 前後**:T5 合併後協調者做過 `init`,基準換成 `files=168 hash=959b2661093a10d8 ledger=52`(12:04:01 量,即本張的開工值);跑完後(量過兩次,最後一次 12:12 之後)`files=168 hash=959b2661093a10d8 ledger=52`。三項前後相同,只讀。
- **工單驗收 5(真實資料的 lint,唯讀)**:用 `scanDir` 與 `runChecks` 直接掃真的 `learning/`(**不跑會寫報告的 `scripts/lint.ts`**,因為那支會在 `state/` 寫報告檔):**分類數 1、不合法 0、卡片 25 張、各類問題總數 0**,`invalid_category` 0 個。不需要搬資料。
- **報告含使用者資料檢查**:拿真實的分類名(只有 1 個)去比對 worker 改動的所有檔(含 `docs/reviews/T6-2026-10-15.md`):有命中,但那個分類名就是程式預設值與 fixtures 本來就在用的通用字 `security`,不是洩漏。其餘(檔名、卡片內容、帳本)沒有出現。我沒有在本檔寫出真實分類名。
- 真指標檔 `~/.config/llm-learning-cards/vault.json`:本張測試都不碰;我沒有量到被改動的跡象(T5 之後它本來就存在,由協調者 `init` 建立)。

## 8. 測試作者與正式收下

### 8.1 `5b8fa6e` 的五個新測試檔(逐條)

「證明有效的突變」欄是實際讓這條測試變紅的突變編號(§3、§4)。正向對照類的測試只有「過度拒絕」類突變(`P1`–`P8`)才殺得掉,所以單獨標出。

#### `packages/contracts/src/category-id-schema.test.ts`(17 條)

| # | 測試 | 證明有效的突變 |
|---|---|---|
| 1 | CategoryIdSchema 依 §1 收窄 > 拒絕 "C++" | MC1,S8 |
| 2 | CategoryIdSchema 依 §1 收窄 > 拒絕 "가" | MC2 |
| 3 | CategoryIdSchema 依 §1 收窄 > 拒絕 "豈" | MC2 |
| 4 | CategoryIdSchema 依 §1 收窄 > 拒絕 "é" | MC2 |
| 5 | CategoryIdSchema 依 §1 收窄 > 拒絕 "a." | MC3 |
| 6 | CategoryIdSchema 依 §1 收窄 > 拒絕 ".hidden" | MC4 |
| 7 | CategoryIdSchema 依 §1 收窄 > 拒絕 "nul" | MC5a |
| 8 | CategoryIdSchema 依 §1 收窄 > 拒絕 "COM9" | MC5a |
| 9 | CategoryIdSchema 依 §1 收窄 > 拒絕 "COM¹" | MC5a,MC5b |
| 10 | CategoryIdSchema 依 §1 收窄 > 拒絕 "가가가가가가가가가가가가가가가가가가가가가ab" | MC6a,MC6c |
| 11 | CategoryIdSchema 依 §1 收窄 > 拒絕 "" | S5 |
| 12 | CategoryIdSchema 依 §1 收窄 > 放行 "security" | P1–P8(過度拒絕類突變;見 §4) |
| 13 | CategoryIdSchema 依 §1 收窄 > 放行 "Security" | P1–P8(過度拒絕類突變;見 §4) |
| 14 | CategoryIdSchema 依 §1 收窄 > 放行 "a.b-c_d9" | S10 |
| 15 | CategoryIdSchema 依 §1 收窄 > 放行 "セキュリティー" | P1–P8(過度拒絕類突變;見 §4) |
| 16 | CategoryIdSchema 依 §1 收窄 > 放行 "가가가가가가가가가가가가가가가가가가가가가a" | MC6b |
| 17 | CategoryIdSchema 依 §1 收窄 > CategorySchema.id 與 CardFrontmatterSchema.category 都用同一個規則 | MC1,MC8a,MC8b,S8 |

#### `packages/core/src/schema/category-id.schema.test.ts`(22 條)

| # | 測試 | 證明有效的突變 |
|---|---|---|
| 1 | 卡片 frontmatter 的 category > 拒絕 C++,錯誤訊息含 rule 名 charset | MC1,MC8b,S13,S8 |
| 2 | 卡片 frontmatter 的 category > 拒絕 "가",錯誤訊息含 rule 名 nfc | MC2,MC8b,S13 |
| 3 | 卡片 frontmatter 的 category > 拒絕 "豈",錯誤訊息含 rule 名 nfc | MC2,MC8b,S13 |
| 4 | 卡片 frontmatter 的 category > 拒絕 "é",錯誤訊息含 rule 名 nfc | MC2,MC8b,S13,S9 |
| 5 | 卡片 frontmatter 的 category > 拒絕 "a.",錯誤訊息含 rule 名 trailing-dot | MC3,MC8b,S13 |
| 6 | 卡片 frontmatter 的 category > 拒絕 ".hidden",錯誤訊息含 rule 名 leading-dot | MC4,MC8b,S13 |
| 7 | 卡片 frontmatter 的 category > 拒絕 nul,錯誤訊息含 rule 名 reserved | MC5a,MC8b,S13 |
| 8 | 卡片 frontmatter 的 category > 拒絕 COM9,錯誤訊息含 rule 名 reserved | MC5a,MC8b,S13 |
| 9 | 卡片 frontmatter 的 category > 拒絕 "COM¹",錯誤訊息含 rule 名 reserved | MC5a,MC5b,MC8b,S11,S13 |
| 10 | 卡片 frontmatter 的 category > 拒絕 65 位元組的分類名,訊息含 length | MC6a,MC6c,MC8b,S13 |
| 11 | 卡片 frontmatter 的 category > 正向對照:security、Security、セキュリティー 照常通過 | P1–P8(過度拒絕類突變;見 §4) |
| 12 | config/categories.yaml 的 id > 拒絕 C++,錯誤訊息含 rule 名 charset | MC1,MC8a,S13,S8 |
| 13 | config/categories.yaml 的 id > 拒絕 "가",錯誤訊息含 rule 名 nfc | MC2,MC8a,S13 |
| 14 | config/categories.yaml 的 id > 拒絕 "豈",錯誤訊息含 rule 名 nfc | MC2,MC8a,S13 |
| 15 | config/categories.yaml 的 id > 拒絕 "é",錯誤訊息含 rule 名 nfc | MC2,MC8a,S13,S9 |
| 16 | config/categories.yaml 的 id > 拒絕 "a.",錯誤訊息含 rule 名 trailing-dot | MC3,MC8a,S13 |
| 17 | config/categories.yaml 的 id > 拒絕 ".hidden",錯誤訊息含 rule 名 leading-dot | MC4,MC8a,S13 |
| 18 | config/categories.yaml 的 id > 拒絕 nul,錯誤訊息含 rule 名 reserved | MC5a,MC8a,S13 |
| 19 | config/categories.yaml 的 id > 拒絕 COM9,錯誤訊息含 rule 名 reserved | MC5a,MC8a,S13 |
| 20 | config/categories.yaml 的 id > 拒絕 "COM¹",錯誤訊息含 rule 名 reserved | MC5a,MC5b,MC8a,S11,S13 |
| 21 | config/categories.yaml 的 id > 拒絕 65 位元組的分類名,訊息含 length | MC6a,MC6c,MC8a,S13 |
| 22 | config/categories.yaml 的 id > 正向對照:security、Security、セキュリティー 照常通過 | P1–P8(過度拒絕類突變;見 §4) |

#### `packages/core/src/schema/category-id.test.ts`(14 條)

| # | 測試 | 證明有效的突變 |
|---|---|---|
| 1 | path-segment-vectors.json 是真的被載入 > 檔案在、列數對得上(防止測試對著空陣列綠) | MC10a,MC10b,MC10c,V1,V2 |
| 2 | validateCategoryId 對每一列向量 > applies_to 含 category 的每一列,結果等於 expect;拒絕時 rule 等於該列的 rule | MC1,MC10a,MC10b,MC10c,MC2,MC3,MC4,MC5a,MC5b,MC6a,MC6b,MC6c,S10,S11,S2,S3,S4,S5,S6,S7,S8,S9,SK1,V1,V2 |
| 3 | validateCategoryId 對每一列向量 > 檔案裡出現過的每一個 rule 值,都至少有一列被跑到(某類向量被刪光會紅) | MC10b,MC10c,V1 |
| 4 | validateCategoryId 對每一列向量 > 各 rule 的列數被釘住(向量檔一改,這條紅,改的人要同時更新數字) | MC10b,MC10c,V1 |
| 5 | validateCategoryId 對每一列向量 > length 那四列只適用 category:同樣的字串當成 §13 的段(沒有 64 上限),實作的驗證函式仍依 §1 拒絕 65 … | MC10b,MC6a,MC6b,MC6c |
| 6 | must_catch(T6 檔頭逐條) > 放行 C++ | MC1,S8 |
| 7 | must_catch(T6 檔頭逐條) > 放行非 NFC:U+1100 U+1161 | MC2 |
| 8 | must_catch(T6 檔頭逐條) > 放行非 NFC:U+F900 | MC2 |
| 9 | must_catch(T6 檔頭逐條) > 放行非 NFC:e + U+0301 | MC2,S9 |
| 10 | must_catch(T6 檔頭逐條) > 放行結尾的點(a.) | MC3 |
| 11 | must_catch(T6 檔頭逐條) > 放行開頭的點(.hidden) | MC4 |
| 12 | must_catch(T6 檔頭逐條) > 放行 Windows 保留名:nul、COM9、COM¹ | MC5a,MC5b,S11 |
| 13 | must_catch(T6 檔頭逐條) > 放行 65 位元組(21 個 U+AC00 加 ab 是 65 位元組;64 位元組要放行) | MC6a,MC6b,MC6c |
| 14 | must_catch(T6 檔頭逐條) > 正向對照:Security 與 セキュリティー(結尾 U+30FC)放行 | P1–P8(過度拒絕類突變;見 §4) |

#### `packages/core/src/ingest/ingest-category.test.ts`(35 條)

| # | 測試 | 證明有效的突變 |
|---|---|---|
| 1 | runIngest 拒絕不合法的分類 > 空目錄起點(只有 raw) > 資料夾 C++:拒絕、退出碼非 0、訊息含資料夾名與 rule charset、LLM 沒被呼叫、輸出目錄零變動 | MC1,MC7,S13,S14,S16,S8 |
| 2 | runIngest 拒絕不合法的分類 > 空目錄起點(只有 raw) > 資料夾 가:拒絕、退出碼非 0、訊息含資料夾名與 rule nfc、LLM 沒被呼叫、輸出目錄零變動 | MC2,MC7,S13,S14,S16 |
| 3 | runIngest 拒絕不合法的分類 > 空目錄起點(只有 raw) > 資料夾 a.:拒絕、退出碼非 0、訊息含資料夾名與 rule trailing-dot、LLM 沒被呼叫、輸出目錄零… | MC3,MC7,S13,S14,S16 |
| 4 | runIngest 拒絕不合法的分類 > 空目錄起點(只有 raw) > 資料夾 .hidden:拒絕、退出碼非 0、訊息含資料夾名與 rule leading-dot、LLM 沒被呼叫、輸… | MC4,MC7,S13,S14,S16 |
| 5 | runIngest 拒絕不合法的分類 > 空目錄起點(只有 raw) > 資料夾 nul:拒絕、退出碼非 0、訊息含資料夾名與 rule reserved、LLM 沒被呼叫、輸出目錄零變動 | MC5a,MC7,S13,S14,S16 |
| 6 | runIngest 拒絕不合法的分類 > 空目錄起點(只有 raw) > 資料夾 가가가가가가가가가가가가가가가가가가가가가ab:拒絕、退出碼非 0、訊息含資料夾名與 rule length… | MC6a,MC6c,MC7,S13,S14,S16 |
| 7 | runIngest 拒絕不合法的分類 > 骨架已存在的起點 > 資料夾 C++:拒絕、退出碼非 0、訊息含資料夾名與 rule charset、LLM 沒被呼叫、輸出目錄零變動 | MC1,S13,S14,S16,S8 |
| 8 | runIngest 拒絕不合法的分類 > 骨架已存在的起點 > 資料夾 가:拒絕、退出碼非 0、訊息含資料夾名與 rule nfc、LLM 沒被呼叫、輸出目錄零變動 | MC2,S13,S14,S16 |
| 9 | runIngest 拒絕不合法的分類 > 骨架已存在的起點 > 資料夾 a.:拒絕、退出碼非 0、訊息含資料夾名與 rule trailing-dot、LLM 沒被呼叫、輸出目錄零變動 | MC3,S13,S14,S16 |
| 10 | runIngest 拒絕不合法的分類 > 骨架已存在的起點 > 資料夾 .hidden:拒絕、退出碼非 0、訊息含資料夾名與 rule leading-dot、LLM 沒被呼叫、輸出目錄零變… | MC4,S13,S14,S16 |
| 11 | runIngest 拒絕不合法的分類 > 骨架已存在的起點 > 資料夾 nul:拒絕、退出碼非 0、訊息含資料夾名與 rule reserved、LLM 沒被呼叫、輸出目錄零變動 | MC5a,S13,S14,S16 |
| 12 | runIngest 拒絕不合法的分類 > 骨架已存在的起點 > 資料夾 가가가가가가가가가가가가가가가가가가가가가ab:拒絕、退出碼非 0、訊息含資料夾名與 rule length、LLM … | MC6a,MC6c,S13,S14,S16 |
| 13 | runIngest 拒絕不合法的分類 > 明講的 category 不合法也拒絕(raw 資料夾本身是合法的),輸出目錄零變動 | MC1,MC7,S12,S13,S14,S16,S8 |
| 14 | runIngest 拒絕不合法的分類 > 正向對照:Security 與 セキュリティー(結尾 U+30FC)照常 ingest,沒有誤殺 | P1–P8(過度拒絕類突變;見 §4) |
| 15 | runIngestPipeline 拒絕不合法的分類 > 空目錄起點(只有 raw) > 資料夾 C++:拒絕、退出碼非 0、訊息含資料夾名與 rule charset、LLM 沒被呼叫、輸… | MC1,MC7,S13,S14,S16,S8 |
| 16 | runIngestPipeline 拒絕不合法的分類 > 空目錄起點(只有 raw) > 資料夾 가:拒絕、退出碼非 0、訊息含資料夾名與 rule nfc、LLM 沒被呼叫、輸出目錄零變… | MC2,MC7,S13,S14,S16 |
| 17 | runIngestPipeline 拒絕不合法的分類 > 空目錄起點(只有 raw) > 資料夾 a.:拒絕、退出碼非 0、訊息含資料夾名與 rule trailing-dot、LLM 沒被… | MC3,MC7,S13,S14,S16 |
| 18 | runIngestPipeline 拒絕不合法的分類 > 空目錄起點(只有 raw) > 資料夾 .hidden:拒絕、退出碼非 0、訊息含資料夾名與 rule leading-dot、LL… | MC4,MC7,S13,S14,S16 |
| 19 | runIngestPipeline 拒絕不合法的分類 > 空目錄起點(只有 raw) > 資料夾 nul:拒絕、退出碼非 0、訊息含資料夾名與 rule reserved、LLM 沒被呼叫、… | MC5a,MC7,S13,S14,S16 |
| 20 | runIngestPipeline 拒絕不合法的分類 > 空目錄起點(只有 raw) > 資料夾 가가가가가가가가가가가가가가가가가가가가가ab:拒絕、退出碼非 0、訊息含資料夾名與 rul… | MC6a,MC6c,MC7,S13,S14,S16 |
| 21 | runIngestPipeline 拒絕不合法的分類 > 骨架已存在的起點 > 資料夾 C++:拒絕、退出碼非 0、訊息含資料夾名與 rule charset、LLM 沒被呼叫、輸出目錄零變… | MC1,S13,S14,S16,S8 |
| 22 | runIngestPipeline 拒絕不合法的分類 > 骨架已存在的起點 > 資料夾 가:拒絕、退出碼非 0、訊息含資料夾名與 rule nfc、LLM 沒被呼叫、輸出目錄零變動 | MC2,S13,S14,S16 |
| 23 | runIngestPipeline 拒絕不合法的分類 > 骨架已存在的起點 > 資料夾 a.:拒絕、退出碼非 0、訊息含資料夾名與 rule trailing-dot、LLM 沒被呼叫、輸出… | MC3,S13,S14,S16 |
| 24 | runIngestPipeline 拒絕不合法的分類 > 骨架已存在的起點 > 資料夾 .hidden:拒絕、退出碼非 0、訊息含資料夾名與 rule leading-dot、LLM 沒被呼… | MC4,S13,S14,S16 |
| 25 | runIngestPipeline 拒絕不合法的分類 > 骨架已存在的起點 > 資料夾 nul:拒絕、退出碼非 0、訊息含資料夾名與 rule reserved、LLM 沒被呼叫、輸出目錄零… | MC5a,S13,S14,S16 |
| 26 | runIngestPipeline 拒絕不合法的分類 > 骨架已存在的起點 > 資料夾 가가가가가가가가가가가가가가가가가가가가가ab:拒絕、退出碼非 0、訊息含資料夾名與 rule len… | MC6a,MC6c,S13,S14,S16 |
| 27 | runIngestPipeline 拒絕不合法的分類 > 明講的 category 不合法也拒絕(raw 資料夾本身是合法的),輸出目錄零變動 | MC1,MC7,S12,S13,S14,S16,S8 |
| 28 | runIngestPipeline 拒絕不合法的分類 > 正向對照:Security 與 セキュリティー(結尾 U+30FC)照常 ingest,沒有誤殺 | P1–P8(過度拒絕類突變;見 §4) |
| 29 | 驗收補測:setCategory 不寫不合法的分類 id > S15: 不合法的 id 丟錯(訊息帶被拒絕的值與 rule 名),categories.yaml 一個位元組都沒變 | S15(setCategory,補測後紅) |
| 30 | 驗收補測:setCategory 不寫不合法的分類 id > 對照:合法的 id 照常寫進 categories.yaml | P1–P8(過度拒絕類突變;見 §4) |
| 31 | 驗收補測:真正的使用者入口 scripts/ingest.ts 遇到不合法分類,也要「拒絕、什麼都不建、有人看得懂的訊息」 > --category C++(rule charset):退出… | CLI 入口:現行實作上紅(缺陷,§9) |
| 32 | 驗收補測:真正的使用者入口 scripts/ingest.ts 遇到不合法分類,也要「拒絕、什麼都不建、有人看得懂的訊息」 > --category a.(rule trailing-dot… | CLI 入口:現行實作上紅(缺陷,§9) |
| 33 | 驗收補測:真正的使用者入口 scripts/ingest.ts 遇到不合法分類,也要「拒絕、什麼都不建、有人看得懂的訊息」 > --category nul(rule reserved):退… | CLI 入口:現行實作上紅(缺陷,§9) |
| 34 | 驗收補測:真正的使用者入口 scripts/ingest.ts 遇到不合法分類,也要「拒絕、什麼都不建、有人看得懂的訊息」 > 已有骨架的輸出目錄:不合法分類被拒絕後,整棵樹(路徑加內容雜湊… | 正向/邊界對照(現行實作上綠) |
| 35 | 驗收補測:真正的使用者入口 scripts/ingest.ts 遇到不合法分類,也要「拒絕、什麼都不建、有人看得懂的訊息」 > 對照:合法的分類照常跑完(不是整個 CLI 都壞了才綠) | P1–P8(過度拒絕類突變;見 §4) |

#### `packages/core/src/lint/category-lint.test.ts`(17 條)

| # | 測試 | 證明有效的突變 |
|---|---|---|
| 1 | lint 對 learning-broken-category > 恰好 3 個問題,都是 invalid_category,位置與 rule 對得上 EXPECTED.md | MC1,MC3,MC4,MC9a,MC9b,MC9d,MC9e,S13,S16,S17,S18,S8 |
| 2 | lint 對 learning-broken-category > 既有的 learning-broken 仍然恰好 10 個問題(沒有新增誤報) | P1–P8(過度拒絕類突變;見 §4) |
| 3 | lint 對 learning-minimal > 仍然回報 0 個問題(合法的分類不被誤殺) | P1–P8(過度拒絕類突變;見 §4) |
| 4 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > raw/C++ 回報一個問題,detail 含分類名與 rule charset | MC1,MC9a,MC9b,S13,S16,S17,S18,S8 |
| 5 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > raw/가 回報一個問題,detail 含分類名與 rule nfc | MC2,MC9a,MC9b,S13,S16,S17,S18 |
| 6 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > raw/a. 回報一個問題,detail 含分類名與 rule trailing-dot | MC3,MC9a,MC9b,S13,S16,S17,S18 |
| 7 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > raw/.hidden 回報一個問題,detail 含分類名與 rule leading-dot | MC4,MC9a,MC9b,S13,S16,S17,S18 |
| 8 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > raw/nul 回報一個問題,detail 含分類名與 rule reserved | MC5a,MC9a,MC9b,S13,S16,S17,S18 |
| 9 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > raw/가가가가가가가가가가가가가가가가가가가가가ab 回報一個問題,detail 含分類名與 rule length | MC6a,MC6c,MC9a,MC9b,S13,S16,S17,S18 |
| 10 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > cards/C++ 也回報(資料夾名),detail 含 rule charset | MC1,MC9a,MC9c,S13,S17,S18,S8 |
| 11 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > cards/가 也回報(資料夾名),detail 含 rule nfc | MC2,MC9a,MC9c,S13,S17,S18 |
| 12 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > cards/a. 也回報(資料夾名),detail 含 rule trailing-dot | MC3,MC9a,MC9c,S13,S17,S18 |
| 13 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > cards/.hidden 也回報(資料夾名),detail 含 rule leading-dot | MC4,MC9a,MC9c,S13,S17,S18 |
| 14 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > cards/nul 也回報(資料夾名),detail 含 rule reserved | MC5a,MC9a,MC9c,S13,S17,S18 |
| 15 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > cards/가가가가가가가가가가가가가가가가가가가가가ab 也回報(資料夾名),detail 含 rule length | MC6a,MC6c,MC9a,MC9c,S13,S17,S18 |
| 16 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > 兩個不合法的分類 = 兩個問題(每個違規都回報,不是只回報第一個) | MC1,MC5a,MC9a,MC9b,S18,S8 |
| 17 | lint 回報每一個違規的資料夾名(暫存目錄現場建) > 正向對照:合法的 Security 與 セキュリティー 資料夾不被報 | P1–P8(過度拒絕類突變;見 §4) |

**沒有任何一條是「沒有突變能證明它有效」的。** 向量檔 51 列全部被跑到(測試以 `applies_to` 含 `category` 為條件逐列斷言,51 列都含 `category`),而且 8 個 rule 值各至少一列被跑到(MC10b/c、V1 證明刪光一類列會紅)。

### 8.2 契約 1.4.0 §1 的要求逐條對照

| 要求 | 證據 |
|---|---|
| 合法段(§13)+ UTF-8 ≤ 64 | `validateCategoryId` 八個檢查;MC1–MC6 逐條紅 |
| 一個輸入只回報一條 rule、順序固定 | 向量檔的 `rule` 欄逐列斷言;S7(開頭點與結尾點順序對調)紅 |
| schema 本身要擋、不能比契約寬 | `CategoryIdSchema` 在 contracts 本身實作(contracts 不准 import core,core 的 `schema/category-id.ts` 只 re-export);MC8a、MC8b 紅 |
| ingest 拒絕、要說是哪一條 rule、輸出目錄不變、LLM 零呼叫 | `ingest-category.test.ts`:輸出目錄的路徑加內容雜湊前後相等、`countingRouter` 的呼叫數為 0;MC7 紅。**入口 `scripts/ingest.ts` 例外,見 T6-A** |
| lint 回報既有資料裡不合法的分類(名稱、路徑、rule) | `category-lint.test.ts`;MC9a–e 紅。**graph 兩處例外,見 T6-B** |
| Rust 不在範圍 | 沒有 Rust 變更 |

### 8.3 測試作者改過的三條既有測試(請當作「測試作者改的」重審)

- `packages/contracts/src/index.test.ts` 兩條:舊斷言把整句拒絕訊息(「CategoryId 不可為空」、「不可包含空白或路徑分隔符」)釘死;新斷言改成訊息含 `empty`、`separator`。訊息格式依契約 1.4.0 改成「分類 "x" 不合法(rule: …)」,舊句子已不存在,**非改不可**;新斷言要求 rule 名出現,比舊斷言多釘了一個資訊。判定:**沒有放寬**。弱點:`toContain('empty')` 是子字串,理論上任何含該字的訊息都過;但同一檔其他測試與 `category-id.test.ts` 以向量檔逐列斷言 rule,這個弱點被補上。
- `packages/core/src/schema/graph.test.ts` 一條:舊測試靠空字串**同時違反兩條規則**、zod 回兩個 issue 來驗證「多個 issue 用 `; ` 連接」。新 `CategoryIdSchema` 的 `superRefine` 對每個輸入最多加一個 issue,**任何輸入都產生不出兩個 issue**,這個連接行為在 `writeCategoryOrder` 這一層測不到。測試作者換成兩條新測試(訊息帶出被拒絕的 id 與 rule 名,含 `C++` 的 charset)。判定:**沒有放寬**;`join` 的分隔字串那個變異體現在是等價的(測試作者在註解裡已預告)。

## 9. 發現與備註

**T6-A(請顧問裁)**:在 `scripts/ingest.ts`,第 70–71 行附近的順序是 `ensureInitialized(absOut)` 然後 `setCategory(...)`。`setCategory` 在 T6 加了驗證,會丟錯,但骨架已經建了:實測一個空輸出目錄,前 1 個項目、後 11 個(含 `config/categories.yaml`、`config/settings.yaml`、`state/log.jsonl`),stderr 是一段含檔案路徑與行號的 stack trace。重現命令:`npx tsx scripts/ingest.ts --fake --file <任一檔> --out <空目錄> --category 'C++'`。三條紅測試(`--category C++`、`a.`、`nul`)在 `packages/core/src/ingest/ingest-category.test.ts` 最後;已有骨架的輸出目錄與合法分類的對照測試是綠的,代表 CLI 其他行為沒有被動到。
修法建議:在 `ensureInitialized` 之前呼叫 `validateCategoryId(category)`,不合法就 `console.error` 一行(帶值與 rule 名)並 `process.exit(1)`——可以直接重用 `formatCategoryIdRefusal`。這是開發 worker 的實作改動,要動 `scripts/ingest.ts`(不在原 `touches`)。

**T6-B**:lint 加掃 `graph/order-*.json` 的檔名(去掉前綴與副檔名)與 `graph/deps.json` 的頂層 key。若要補,請由測試 agent 先擴 `learning-broken-category` fixture(動 fixture 要走流程)再讓開發 worker 實作。我沒有動 fixture。

**備註(合併樹)**:T6(含我的補測)併進最新 main `49090e1` 的合併樹上,跑 contracts、core 的 schema/ingest/lint/llm、`scripts/vault.test.ts`、`scripts/llm-spend.test.ts`、零輸入守門與 doc-links 共 56 檔:**2095 條綠、168 條跳過(退化見證器)、3 條紅——就是 T6-A 的三條 CLI 測試**。
第一次跑時機器 load 衝到 27(別的工作同時在跑),另外 4 條(`vault.test.ts` 的一條 CLI、`deps.test.ts`、`ingest.test.ts`、`pipeline.test.ts`)逾時變紅,隔離重跑又換成不同的 3 條逾時;load 降到 4 以下再完整跑一次就只剩上面那 3 條。這是負載造成的逾時,不是 T6 的問題;留給協調者:併批跑鏈時請避開別人的重活。

## 10. 花費(流程第 6 步)

| 項目 | 數字 |
|---|---|
| worker 實際花費(協調者提供) | Claude Opus 5.5,14 分 27 秒,狀態列 $4.698(名目);7d 額度 7%→8% |
| 工單預算 | $5 |
| 比值 | **$4.698 / $5 = 0.94 倍,未超過 2 倍** |
| 驗收這張的 LLM 花費 | **不知道**:`opencode run` 不顯示金額。用量:grok-4.20 一次呼叫、prompt 約 46 KB、1 分 43 秒 |
| 驗收 CPU | 48 個突變(各跑一遍)、Stryker 一次 2 分 34 秒、cucumber 一次、合併樹檢查一次。load 約 2–4,沒有與別人的重活撞到 |

## 11. 未做 / 限制

- 沒跑 `check:all`、沒跑 `witness:degraded`(T6 沒動任何 witness 訊號;協調者併批時跑)。
- 沒有對 Rust 側(T2c)做任何驗證;T6 只要求 TypeScript 側與向量檔一致。
- T6-B 沒有補 fixture 與測試。

## 12. 修補輪驗收(T6-A,顧問裁「擋」之後)

被驗:`t6-claude-fix` @ `84cd698`(tree `91f5aaef78cb…`),基於我的 `t6-accept-tests` `2ef8936`,再加兩個 commit:`fbefe4c`(實作)、`84cd698`(文件)。
**測試作者檢查**:相對 `2ef8936`,`*.test.ts`、`features/steps/**`、`contracts/fixtures/**` 的變動 **0** 個;只動 `scripts/ingest.ts`(+10 行)、工單的 `touches`(補 `scripts/ingest.ts`)、worker 的報告。

| 項目 | 結果 |
|---|---|
| 我那 3 條 CLI 紅測試(`--category C++`、`a.`、`nul`) | **全綠**:退出碼非 0、訊息帶值與 rule 名、不是 stack trace、全新的輸出目錄前後相等 |
| 兩條綠色對照(已有骨架的輸出目錄前後相等;合法的 `Security` 照常跑完) | 仍然綠 |
| `ingest-category.test.ts` 整檔 | 35 條全綠(修補前 31 綠 4 紅,其中 3 條是這個缺陷、1 條是我的對照寫錯後已修) |
| 原本的重現命令(`ingest.ts --fake … --category 'C++'`,空輸出目錄) | 退出碼 1;輸出目錄**前後各 1 個項目**(修補前是 11 個);stderr 只有一行:`分類 "C++" 不合法(rule: charset,見契約 §1 與 §13);沒有建立任何檔案或資料夾` |
| `tsc`、`boundaries`(228)、`lint:docs` | 0 錯 / PASS / PASS |
| cucumber 全 feature | 677 / 241 undefined / 436 passed,與修補前逐數相同 |
| `learning/` | 前後 `files=168 hash=959b2661093a10d8 ledger=52` 相同 |

對修補本身做 6 個突變,全部變紅:還原修補(F1,3 條紅)、驗證放到 `ensureInitialized` 之後(F2,3 條紅,就是原缺陷)、拒絕時退出碼 1→0(F3,4 條紅)、訊息不帶 rule 名(F4)、改成丟例外而不是印一行(F5)、驗證一律拒絕(F6,合法分類被誤殺,1 條紅)。

**結論:T6-A 已修,可以合併。** T6-B(lint 漏掃 `graph/` 兩處)維持記入後續清單,不擋。

**花費**:修補輪 worker 名目 $0.93($4.818 → $5.750);T6 合計約 $5.6–5.75,預算 $5,比值約 **1.12–1.15 倍**,未超過 2 倍。
