---
id: T51
deps: [T20]
touches: [packages/core/src/schema/parse-card.ts]
cpu: light
budget_usd: 1
status: merged
owner: worker-grok
must_catch:
  - 只認三個反引號的 example 圍欄(現況):契約 §2 四反引號那一列(= 2)與 fixture valid-example-with-nested-content.md(= 27)的 validateCard 測試必須紅
  - 結束的反引號比開始少也算結束(四反引號圍欄被內層的三反引號結束):同上兩條必須紅
  - body 修了、examples 沒跟著修(四反引號圍欄的內容被截斷,或內層的程式碼圍欄不在那一個 example 裡):examples 的測試必須紅
  - 為了讓測試綠,自己定義開閉在同一行、未閉合、或結束的反引號比開始多的圍欄怎麼算(契約沒定義,碰到停下回報)
  - 既有行為變了(三反引號 example、非 example 的圍欄不移除、examples 依序且 trim、CRLF、examples 這種較長的標記不算):既有的 parse-card 與 validate-card 測試必須紅
  - parse-card.ts 的變異分數低於 80%
  - 實作動到 touches 以外的檔(含 contracts/、fixture、word-count.ts、validate-card.ts、lint/、prompt-quality/、ui-shared/):不動的地方那條 diff 檢查必須有輸出
---

# 工單 T51:`parse-card.ts` 的 example 圍欄追上契約 §2(三個以上反引號,結束用同樣數量)

> 狀態:起草 2026-10-25,依技術顧問 2026-10-25 的交代(協調者轉)。規格:UI/Tauri 負責人(代筆)。編號 T51:協調者配的。
> 實作:worker(opencode + grok-4.7);紅測試:測試 agent;驗收(含變異):驗收 agent。
> 依據:`../../contracts/types.md` §2(1.2.0 的向量表與「Example 圍欄」那一段);`../02-decision-map.md` 的 ADR-060;`T20-unify-example-fence-regex.md` 的「2026-10-25 顧問審後更新」第 4 點。
> **這是程式追契約:不改契約、不用 ADR。** 基底:main(T20 合併之後)。LLM 真呼叫 0。

## 為什麼有這張

- 契約 §2(1.2.0,ADR-060,使用者裁):example 圍欄「以**三個以上**反引號加 `example` 開始,以**同樣數量**的反引號結束」。向量表有一列:`前` + 四反引號 example 圍欄(內含一個三反引號的內層圍欄與文字)+ `後` = **2**。
- `../../packages/core/src/schema/parse-card.ts:12` 的 `EXAMPLE_FENCE_RE` 寫死三個反引號,而且碰到第一個三反引號就結束。`validateCard` 走的就是它。
- 起草時量的(只讀,在 main `5f3cac8` 上):

  | 輸入 | 現在 `validateCard` 的字數 | 照 §2 定義 | 現在的 examples |
  |---|---|---|---|
  | 四反引號那一列的寫法 | 6 | **2** | 1 個,被內層的三反引號截斷 |
  | `contracts/fixtures/cards/valid-example-with-nested-content.md` | 33 | **27** | 1 個,同樣被截斷 |

  - 「照 §2 定義」= 照步驟 1 把整個四反引號圍欄拿掉,剩下的交給 `countWords`。`packages/ui-shared/src/word-count.ts` 對這個 fixture 也算 27(ADR-060 的表)。
  - 現在的 regex 從第二個反引號開始配到 `` ```example ``,然後在內層程式碼圍欄的開頭就結束,所以圍欄後半段(內層的程式碼與外層的結尾)留在 body 裡被算進去。
- 顧問數過:真的 learning/ 裡四反引號以上的 example 圍欄 **0 個**,所以現在還沒咬到使用者。

## 要的結果

1. **body 與 examples 一起修**:
   - 開始:三個以上反引號,接著 `example`,接著換行。
   - 結束:**同樣數量**的反引號自成一行。數量比開始少的那一行不結束(內層的程式碼圍欄)。
   - 整個圍欄(開始那一行到結束那一行)從 body 移除。
   - 圍欄裡面的內容(開始那一行與結束那一行之間,已 trim)依出現順序放進 `examples`。內層的程式碼圍欄是內容的一部分,原樣留在裡面。
2. **既有行為不變**(`parse-card.test.ts` 現有的每一條):三反引號 example;多個 example 依序、各自 trim;body 頭尾 trim、中間的空行不合併;CRLF;example 裡的圖片;非 `example` 的圍欄(例如 `js`)不移除、照算;`examples` 這種較長的標記不算 example。
3. **`countWords` 不動**,`validate-card.ts` 不動。字數規則只有圍欄那一步(§2 步驟 1)在這張。

## 測試(測試 agent 寫,實作不改)

**validateCard 的向量測試**(新檔,放 `packages/core/src/schema/`,例如 `validate-card.contract-vectors.test.ts`):

- 每一列都包成一張合法的卡(frontmatter 合法、body 就是那一列的內容),跑 `validateCard`,比 `bodyWordCount`。
- 範圍:§2 的**兩張表全部**——「關鍵推論」六列(`same-origin` = 2 等)與 1.2.0 向量表十列(含四反引號 = 2、`js` 圍欄 = 2)。
- 圍欄那幾列的寫法:**開始那一行、內容、結束那一行各自一行**;`前`、`後` 各在圍欄的前一段與後一段。不寫成開閉同一行(契約沒定義)。
- 四反引號那一列另外斷言:`examplesCount` 是 1;那一個 example 裡有內層的三反引號開始與結束兩行、還有內層的文字;body 裡沒有反引號。
- **fixture**:`contracts/fixtures/cards/valid-example-with-nested-content.md` 跑 `validateCard`:`ok`、`bodyWordCount` = 27、`examplesCount` = 1,那一個 example 含內層的程式碼圍欄。fixture 檔**不改**。
- 在 T20 合併後的 main 上:四反引號那一列、fixture 兩條、examples 那幾條**紅**(紅的原因是「還沒有這個功能」);其餘本來就綠。紅綠寫進紅測試的 commit 說明。
- **不測**:開閉在同一行、未閉合、結束的反引號比開始多(見下一節)。測試裡也不放這類字串。

**既有測試**:`parse-card.test.ts`、`validate-card.test.ts`、`word-count.test.ts` 照綠;T20 搬到 `ingest/` 的邊界案例照綠(T20 不准把四反引號寫成 6;T51 之後應該跟著變成 2,若 T20 的測試有釘四反引號的數字,測試 agent 回報顧問)。

## 契約沒定義的(不測,碰到就停)

- 開閉在同一行的圍欄;未閉合的圍欄(§2「尚未定義」那一段)。
- **結束的反引號比開始多**(例如四反引號開始、五反引號那一行):契約字面寫「同樣數量」,括號裡又寫「與 CommonMark 的圍欄規則一致」,而 CommonMark 是「至少同樣數量」就結束。兩句對這種情況說的不一樣。repo 裡兩份實作也不一樣:`packages/ui-shared/src/word-count.ts` 要剛好同樣數量;教學卡的渲染(`packages/ui-shared/src/example-fence.ts`,markdown-it)照 CommonMark,多的也結束。**起草時發現的,請顧問判**(見最後一節)。
- 開始那一行在 `example` 後面還有字(例如空白或別的字)、圍欄有縮排:契約沒說。這張照現在的行為(`example` 後面直接換行才算),不擴大。

碰到上面任何一種(舊測試裡有、或改了之後兩邊算出來不同):**停下來,回報協調者**,附案例字串、兩邊各算幾、哪一條測試。不要為了讓測試綠去選邊。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| core | `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/schema/ packages/core/src/ingest/` | 全綠,含新的向量測試 |
| 不退步 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@data-layer and not @manual' --format summary`,另跑 `--tags '@i1 and not @manual and not @llm and not @e2e'` | 全綠(拿位子;01 phase-1 的 `the validator runs against every file under the cards fixture directory` 那一步會讀到這個 fixture) |
| 變異 | `npm run mutate -- stryker.t51-parse-card.json`(驗收 agent 加這個設定檔,照 `stryker.t46-ui.json` 的寫法,`mutate` 只放 `parse-card.ts`) | ≥ 80%;存活的逐條說明 |
| 不動的地方 | `git diff --stat <紅測試分支的基底>..HEAD -- contracts packages/core/src/schema/word-count.ts packages/core/src/schema/validate-card.ts packages/core/src/lint packages/core/src/prompt-quality packages/ui-shared` | 沒有輸出 |

`parse-card.ts` 是驗證器的一部分(`validateCard` 的圍欄那一步),屬嚴格級(CLAUDE.md「嚴格級模組驗收前跑變異測試」)。變異是驗收 agent 的重活,協調者排位子。

**改壞證明**(驗收 agent 的丟棄式證明,每條:改了哪裡、哪一條紅、訊息原文、還原後綠):

- 改回只認三個反引號 → 四反引號那一列與 fixture 紅;
- 結束只看「三個以上」、不看數量 → 同上紅;
- 只修 body、examples 照舊用舊的配法 → examples 那幾條紅;
- `trim` 拿掉 → 既有的 trim 測試紅;
- 非 `example` 的圍欄也移除 → `js` 那一列紅。

## 受保護的檔(開發 worker 不改)

- 測試:`*.test.ts`、`features/**`、`.feature`、fixture。worker 覺得測試有錯,寫進報告的「待協調」,不改。
- 實作:`contracts/`、`packages/core/src/schema/` 裡除了 `parse-card.ts` 以外的檔、`packages/core/src/lint/`、`packages/core/src/prompt-quality/`、`packages/ui-shared/`、`prompts/`。

## 落點

`packages/core/src/schema/` → 01-data-layer(`../../scripts/boundaries.owners.json`)。不新增 import 例外。實作只用 `parse-card.ts` 自己的程式,**不** import `ui-shared`。

## 不在範圍

- 契約 §2 沒定義的那幾種圍欄(上面那一節)。
- 另外兩份也寫死三個反引號的圍欄處理:`../../packages/core/src/lint/validator-min.ts:36`(09-lint 刻意不 import `schema/` 的「另一雙眼」,I6 整合時改用正式驗證器)與 `../../packages/core/src/prompt-quality/word-count.ts:7`。起草時發現的,請顧問判要不要併進 T52(統一字數向量檔)。
- T20 的範圍(`ingest/word-count-min.ts` 的移除)。

## 預算

`budget_usd: 1`(只改 `parse-card.ts`;grok 不設停止線,只記錄)。沒有 LLM 花費。`cpu: light`(開發只跑 vitest);變異與 cucumber 是驗收的重活,協調者排位子。

## 測試誰寫

- 紅測試:測試 agent。改壞證明與變異:驗收 agent。開發 worker 以紅測試分支為基底,不改測試。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。

## 起草時補的(請顧問看)

1. **結束的反引號比開始多**:契約字面(同樣數量)與括號(CommonMark,至少同樣數量)說的不一樣,repo 裡兩份實作也不一樣(`ui-shared/word-count.ts` 剛好同樣、`example-fence.ts` 的渲染照 CommonMark)。我把它列成「沒定義、不測、碰到停」。要定義就是改硬約定,是使用者的事。
2. **另外兩份寫死三個的**:`lint/validator-min.ts` 與 `prompt-quality/word-count.ts`。T51 修好之後,它們對四反引號圍欄會跟 `validateCard` 算出不同的數字。不在 T51,建議併進 T52 的「登記每一份實作、跑同一份向量」。
3. **向量測試含 §2 兩張表全部**(協調者轉的要點說「向量表每一列」),「關鍵推論」那六列一起放進來,成本幾乎是 0。
