---
id: T18
deps: [T12]
touches: [packages/core/src/ingest/children.ts, packages/core/src/ingest/siblings.ts, packages/core/src/ingest/index.ts, packages/core/prompts/ingest/children.md, packages/core/src/prompt-quality/golden-sets/registry.ts, packages/core/src/prompt-quality/parent-child-overlap.ts, packages/core/src/prompt-quality/cli.ts, packages/core/src/prompt-quality/types.ts, packages/core/src/prompt-quality/index.ts]
cpu: light
budget_usd: 1
status: todo
owner: worker-grok
must_catch:
  - children 的 prompt 沒有 already_covered 區塊(同分類有別的卡時),或區塊放在 body 之後、header 的 `---` 之外
  - 列出的卡包含父卡自己,或包含別的分類的卡,或包含 .short.md
  - 沒有別的卡時仍印出空的 already_covered(應整段省略)
  - 第二個父卡的 prompt 看不到第一個父卡剛寫進磁碟的子卡(sibling 清單在 generateChildrenForCards 開頭只讀一次)
  - 摘要不是 body 的第一句,或超過 60 字沒截斷,或把 example 圍欄的內容算進摘要
  - 卡片超過 80 張時 prompt 無上限地變長(上限沒生效),或上限砍掉的不是 id 最小的
  - golden 的 children 輸入沒有 already_covered,或內容隨便變(不是固定的 fixture:換一次跑 sibling 清單就不同)
  - --overlap-siblings 的退出碼永遠是 0;或把「自己的父卡」也當 sibling 比;或門檻被放寬(0.5 → 0.7、>= 改 >)
  - 改 prompt 卻沒有跑 golden run,或用有未提交修改的 prompt 把結果寫進 golden/
  - 動到 contracts/(卡片格式、新欄位)
---

# 工單 T18:子卡生成時看得到同分類的其他卡(跨主題不重述)

> 狀態:草稿,待技術顧問審(派令來自顧問,經協調者 2026-10-16)。**基底 = T12 合併之後的 main**(T12 的 `children.md` 與 `parent-child-overlap.ts` 是這張的前提)。
> 作者:統籌·契約(規格)。紅測試:-ed。開發:worker-grok。評分:顧問。派工:協調者。
> 規格:`features/02-ingest-pipeline/phase-4.feature`(5 個場景,本工單同批新增;02 的 phase-2 已 done,不動它的 .feature)。
> 這份檔是工單唯一的正本。**改的是 `prompts/` 與管線程式,屬硬規則 4:每一輪都要跑 golden run。**

## 起因

T12 第 2 輪之後,子卡與**自己的父卡**重述的對數是 0(機器最高 0.136)。但**跨主題**仍重複(顧問評):

- cors 的「何時會先發預檢」「OPTIONS 預檢如何核准」 ↔ preflight 的「哪些請求可免預檢」「預檢的 OPTIONS 交換」,幾乎同一件事;
- same-origin 的「放行權在回應標頭」重述 CORS 父卡「權限決定權在伺服器」。

原因:`buildChildrenPrompt(parent)` 只把**自己那一張父卡**交給模型,模型不知道同分類還有哪些卡。
T12 的 `children.md` 已經預留一句:「輸入在 body 之前有 `already_covered:`(同分類已有父卡的標題與一句摘要)……連換標題也不要再寫」——**但管線程式和 golden 輸入都還沒給這個區塊。**這張工單把它接上。

## 我在 T12 第 2 輪輸出上量到的(量尺 = T12 的 `parent-child-overlap.ts` 的 3-gram 重疊係數,跨主題兩兩比,每對只算一次)

資料:基準 `golden/ingest.cards/2026-10-15`(L0)+ T12 第 2 輪的 `children` 輸出(顧問評分過的那一輪;暫存檔,量完的數字記在這裡)。

| 對 | 重疊係數 | 顧問(或我)的判斷 |
|---|---|---|
| cors「OPTIONS 預檢如何核准」↔ preflight「預檢的 OPTIONS 交換」 | **0.613** | 真重複(幾乎同一段) |
| same-origin「放行權在回應標頭」↔ preflight「免預檢不等於可讀回應」 | 0.435 | 重疊(都在講 `Access-Control-Allow-Origin` 決定能不能讀) |
| same-origin「放行權在回應標頭」↔ cors「OPTIONS 預檢如何核准」 | 0.391 | **雜訊**:只共用 `Access-Control-*` 標頭名 |
| cors「OPTIONS 預檢如何核准」↔ preflight「免預檢不等於可讀回應」 | 0.359 | 雜訊(同上) |
| same-origin「放行權在回應標頭」↔ cors「憑證模式的雙方配合」 | 0.333 | 雜訊 |
| cors「憑證模式的雙方配合」↔ preflight「免預檢不等於可讀回應」 | 0.308 | 雜訊 |
| **cors「何時會先發預檢」↔ preflight「哪些請求可免預檢」** | **0.242** | **顧問點名的真重複,低於 0.3** |
| same-origin「放行權在回應標頭」↔ cors L0「權限決定權在伺服器」 | < 0.15 | **顧問點名的真重複,幾乎量不到** |

- 跨主題 120 對(單向計),第 2 輪 ≥ 0.3 的有 14 對(7 個不重複的對);基準(T12 之前)只有 1 對 ≥ 0.3(cors「來源的組成」↔ same-origin L0「同源的定義」0.391,顧問當時判的就是這一對)。
- **結論(同 ADR-043)**:字面指標抓得到「逐字照抄」(0.613),抓不到改寫式的重複(0.242、< 0.15),而且在 CORS 這種共用大量標頭名的主題上,0.3 會誤報(4 對雜訊)。
  所以**機器指標只當回歸網,門檻訂 0.5**;≥ 0.3 的對一律印在「觀察清單」給顧問看,但**不擋**。真正的判斷歸顧問(跟 T12 一樣)。
  「0 對」不等於語意重複解決了。
- 自己的父卡那一邊(T12 的 `--overlap`,門檻 0.3)**不動**:那裡量得準(最高 0.136 / 基準 0.150)。

## 要求

### (a)「一句摘要」從哪來(我的決定,請顧問審)

**不新增欄位、不動 `contracts/`**:卡片格式(契約 §1–§2)本來就沒有摘要欄位,body 是自由 markdown(≤ 100 字)。摘要由 body **算出來**:

- 新檔 `packages/core/src/ingest/siblings.ts`,匯出純函式 `cardSummary(body: string): string`:
  1. 先移除 example 圍欄(同 `normalizeBody` 的規則:三個以上反引號加 `example` 開始、同數量結束);
  2. 空白(含換行)壓成一個半形空格並去頭尾;
  3. 取到第一個句子結束為止:`。` `!` `?` `!` `?`(全形或半形),或「`.` 後面接空白或字串結尾」;句子結束符保留在摘要裡。**沒有句子結束符就取整段**;
  4. 超過 **60 個字元**(以 code point 算,不拆 surrogate pair)就截到 60 並在尾端加 `…`(加了 `…` 之後總長是 61)。
- 同檔匯出 `listSiblings(cards, parent, cap = 80)`:純函式,輸入「該分類目前所有卡」(含 level 0 與 level 1…)與父卡,回傳 `{ id, title, summary }[]`:
  排除父卡自己(依 id);依 id 遞增排序;超過 `cap` 張時**保留 id 最大的 `cap` 張**(最近建立的最可能相關;已知限制,見下)。
- 讀磁碟的部分:`loadCategoryCards(outDir, category)` 讀 `cards/<category>/*.md`(**不含** `.short.md`),用既有的 `parseCardText`(`packages/core/src/schema/parse-card.ts`);**先 grep 現有的卡片讀取函式,不要重寫**。
  壞掉的卡檔(解析失敗)略過、不丟錯(生成子卡不該因為別張卡壞掉而失敗),也不寫進 sibling 清單。

### (b) prompt 的格式

`buildChildrenPrompt(parent, siblings)`:有 sibling 時,在 header 區塊裡、`parent_title:` 之後、結尾的 `---` 之前,加:

```
already_covered:
- <title>:<summary>
- <title>:<summary>
```

(`:` 是全形冒號;一張卡一行;標題與摘要裡的換行已在 `cardSummary` 壓掉,標題的換行同樣壓成空格。)**沒有 sibling 時整段省略**(不印空的 `already_covered:`),此時 prompt 與 T12 之後的版本逐字相同。
`children.md` 裡對 `already_covered:` 的那一行說明改成「同分類**已有卡片(含子卡)**的標題與一句摘要」;**其他規則不動**(T12 的 2–3 張、不重述父卡、標準細節要出……)。

### (c) 管線:每個父卡都重新讀

`generateChildren(parent, router, opts)` 在**每次呼叫時**讀 `loadCategoryCards`,所以 `generateChildrenForCards` 裡第二個父卡看得到第一個父卡剛寫進磁碟的子卡
(既有的「處理完一個 parent 就立刻寫檔」順序不變,見 `children.ts` 檔頭)。**不要在 `generateChildrenForCards` 開頭讀一次就重複使用。**

### (d) golden 輸入(`registry.ts` 的 `childrenInput`)

golden 的三個 children 輸入彼此獨立,所以 sibling 清單要用**固定的 fixture**,輸入才可重現:

- 假想的處理順序 = `RAW_SLICES` 的順序:same-origin → cors → preflight(跟真的管線一樣:所有 L0 先存在,children 依序產生、立刻寫檔)。
- 輸入 k 的 `already_covered` = **另外兩個切片的 L0 卡**(基準 `fixtures/golden-2026-10-15/ingest.cards/` 的輸出,固定)+ **排在 k 前面的切片的子卡**(見下)。
  - same-origin:cors、preflight 的 L0。
  - cors:same-origin、preflight 的 L0 + same-origin 的子卡。
  - preflight:same-origin、cors 的 L0 + same-origin、cors 的子卡。
- 「排在前面的切片的子卡」= **T12 合併後最後一次 golden run 寫進 `golden/ingest.children/<日期>/` 的 `children-<key>.output.json`,複製成固定檔**:放 `packages/core/src/prompt-quality/fixtures/golden-t18/children-<key>.output.json`(原檔複本,sha256 寫在 commit 說明,之後不再更新)。
  日期以 T12 合併後 `golden/ingest.children/` 底下的目錄為準(協調者派工時告訴 worker)。
- 組字串的程式與生產路徑**共用同一個 `cardSummary`、同一個格式函式**(不另寫一份),`already_covered` 的行由 `listSiblings` 的輸出組出。
- 登記表其他三組(cards、questions、deps、regenerate)**不動**。

### (e) 機器指標:跨卡重疊(`prompt-check.ts --overlap-siblings`)

在 `parent-child-overlap.ts` 加:

- `CROSS_CARD_OVERLAP_THRESHOLD = 0.5`(`>=` 才算一對);`CROSS_CARD_OBSERVE_THRESHOLD = 0.3`(只列觀察,不擋)。
- `checkGoldenSiblings({ childrenDir, cardsDir, opts? })`:對 `childrenDir` 裡每個 key 的每張子卡,比對 **別的 key 的 L0 卡**(`cardsDir`)與 **別的 key 的子卡**(同一個 `childrenDir`),**不比自己的 key**(自己的父卡是 `--overlap` 的事;同一個 key 的子卡彼此是 `checkDuplicates` 的事)。
  每個不重複的對只算一次(A↔B 與 B↔A 是同一對,報在字典序較小的那個 child 上)。回傳 `{ pairs(≥ 0.5), observe(0.3 ≤ x < 0.5), totalPairsChecked, maxOverlap }`。
  重疊係數、n-gram、`normalizeBody` 全部沿用 T12 的函式。
- CLI:`prompt-check.ts --overlap-siblings <children run 目錄> <cards run 目錄> [--threshold <0..1>]`:`pairs` 為空 → 退出碼 0,否則 1;錯誤(路徑、key 對不起來、`--threshold` 不合法)→ 1 並講原因;輸出一律列出觀察清單。
- 這條是**回歸網**(逐字照抄),不是語意判斷;這個限制要寫在檔頭註解(同 T12 的寫法)。

## 怎樣才算改善

1. **顧問重新評分**(children 三個輸入):「是一個概念嗎」維持 ≥ 4、正確性維持 5(T12 已達標,不能退步)。
2. **跨主題重複對數 = 0**——**由顧問判**(顧問點名的兩組:cors×preflight 的預檢兩對、same-origin 放行權 × CORS「權限決定權在伺服器」)。
3. 機器:`--overlap`(自己的父卡)0 對、`--overlap-siblings` 0 對(門檻 0.5);觀察清單印出來給顧問看。
4. 每個父卡仍然產出 2–3 張子卡(T12 的規則):看到 `already_covered` 之後模型不能因為「都講過了」就回空陣列或只回 1 張(`parseChildCandidates` 要求 1..3;回 0 張會丟錯)。
5. 預算:每輪 golden run 約 $0.04,**最多三輪**;不達標就停,回報顧問,不要為了湊分數放寬任何一條。
6. `cards`、`questions`、`deps`、`regenerate` 四組沒被動到 → 不需要重跑,條件自動成立。

## 流程與分工

跟 T12 一樣:worker 只跑 `--fake`、不跑 `--live`;真呼叫由協調者在主簽出跑(跑前跑後各記 `llm-spend --today`,日上限 $1);`--out` 指到 `golden/` 以外直到最後一輪達標,prompt commit 後再用乾淨的 prompt 寫進 `golden/`(T11 的規則)。
真的 `learning/` 前後不變(基準 64 個檔 / `c5aa80b18b474ed4` / 帳本只准在尾端追加)。

## 測試(-ed 寫)

| 驗收 | 量什麼 | 怎麼量 |
|---|---|---|
| (a) | `cardSummary`:第一句、全形/半形結束符、`.` 後接空白才算、沒結束符取整段、60 字邊界(60 不截、61 截成 60+`…`)、surrogate pair、example 圍欄不算、換行壓平;`listSiblings`:排除父卡、依 id 排序、cap 80 保留 id 最大的、其他分類不混進來 | vitest 純函式 |
| (a) | `loadCategoryCards`:不含 `.short.md`、壞卡檔略過、其他分類不讀 | 暫存目錄 |
| (b)(c) | **phase-4 的 5 個場景**(步驟定義 -ed 寫);`generateChildren` 送給 router 的 prompt:有 sibling 時有 `already_covered:` 且在 header 的 `---` 之內、格式逐行;沒有 sibling 時整段省略且與 T12 版逐字相同;`generateChildrenForCards` 第二個父卡的 prompt 含第一個父卡剛寫的子卡標題 | 假 router 記錄 prompt |
| (d) | golden 輸入:三個 children 輸入各自的 `already_covered` 內容(標題清單)釘死;fixture 的 sha256 釘死;其他四組輸入位元組不變 | `registry.test.ts` 風格 |
| (e) | 門檻 0.5 剛好(`>=`)、0.3–0.5 只進觀察、不比自己的 key、A↔B 只算一次、基準與 T12 第 2 輪輸出(把 r2 的 7 個輸出放進 fixture)上的數字(0.613 的那對被抓、0.242 的不被抓——**已知限制**,測試要釘住這件事,同 T12 的做法)、CLI 退出碼與錯誤 | 同 T12 的 `parent-child-*.test.ts` |
| 不退步 | T12 的 `parent-child-*.test.ts`、`prompt-quality` 與 `ingest` 資料夾既有測試全綠;`npm run boundaries` | |

- 紅測試用暫存目錄,不碰真的 `learning/`;不呼叫真的 LLM(`--fake` 與假 router)。

## 不在範圍

- 不改 `contracts/`(卡片格式、摘要欄位、新的磁碟檔都不加)。不改 `cards.md`(L0 卡跨主題重複是另一件事:同批 L0 已有 `checkDuplicates`)。
- 不把機器指標放寬去抓改寫式的重複;不加第三個人打的分數維度。
- 不改 regenerate(T19)。
- 已知限制:sibling 清單超過 80 張時只列 id 最大的 80 張——v1 一個分類遠低於這個數字;之後分類變大要改成「依相關性挑」再開票。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest packages/core/src/prompt-quality
npx tsx scripts/prompt-check.ts --golden --set ingest.children --fake
npx tsx scripts/prompt-check.ts --overlap-siblings <children run> <cards run>
npm run boundaries
```

不跑 `--live`(worker)、不跑變異測試(-ed)、不跑 `check:all`、不碰真的 `learning/`。

## 預算

`budget_usd: 1`(worker 草估,無 $ 上限只記錄)。另外:真呼叫每輪約 $0.04,最多三輪,由協調者跑。

## 已裁決的取捨(顧問 2026-10-16)

- **Q1(顧問已裁決)· gherkin 放哪?** 照 feature-triage A 開 **02 的新 phase-4**(`features/02-ingest-pipeline/phase-4.feature`,gate = 自身 phase-2 done + T12 合併);步驟定義由 -ed 寫;FEATURE.md 的 phase 表與 NEXT.md 的 gate 已補。
- **Q2(顧問已同意)· 門檻 0.5 與觀察清單 0.3**:0.3 會誤報 4 對雜訊、0.5 只抓逐字;真正的判斷歸顧問(ADR-043)。
