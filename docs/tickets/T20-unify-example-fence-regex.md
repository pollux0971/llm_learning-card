---
id: T20
deps: [T19]
touches: [packages/core/src/ingest/word-count-min.ts, packages/core/src/ingest/word-count-min.test.ts, packages/core/src/ingest/generate-cards.ts, packages/core/src/ingest/index.ts, packages/core/src/ingest/types.ts, packages/core/src/ingest/questions.ts]
cpu: light
budget_usd: 1
status: todo
owner: worker-grok
must_catch:
  - 移除或改接之後,`ingest` 資料夾裡仍有任何地方呼叫 `word-count-min.ts` 的圍欄正則或 `countBodyWords`(兩份算法還在)
  - 改接之後,同一段 body 在 `ingest` 這邊算出的字數與 `validateCard` 算出的不同(逐字串差分)
  - 為了讓兩邊一致而自己定義「開閉在同一行的圍欄」或「未閉合的圍欄」怎麼算(契約 §2 未定義,碰到必須停下回報)
  - 動到 `packages/core/src/schema/` 或 `contracts/`
---

# 工單 T20:統一 example 圍欄的正則(移除 `word-count-min.ts` 這份 Wave 0 複本)

> 狀態:技術顧問 2026-10-25 審過,要求先改 4 處(見下方「2026-10-25 顧問審後更新」,以那一節為準,與下文衝突時那一節優先)。優先度:**低**,排在 T19 之後(依賴 T19:T19 完成後 `generate-cards.ts` 已不用這份複本)。
> 作者:統籌·契約(規格)。紅測試:由協調者另派(紅測試作者不是起草人、也不是實作人)。開發:worker-grok。派工:協調者。
> 這份檔是工單唯一的正本。**不改 `prompts/`、不改 `contracts/`、不改 `schema/`。**

## 起因

T19 查證時發現,**判斷字數有兩份圍欄正則**:

| 位置 | 正則 | 說明 |
|---|---|---|
| `packages/core/src/schema/parse-card.ts`(`validateCard` 實際走的) | `` /```example\r?\n([\s\S]*?)```/g `` | 開頭 `example` 後**必須**有換行 |
| `packages/core/src/ingest/word-count-min.ts`(Wave 0 複本) | `` /```example\r?\n?[\s\S]*?```/g `` | 換行**可有可無** |

兩份算法對「開閉在同一行的圍欄」(例如 `前` + 三反引號 + `example 內容` + 三反引號 + `後` 全在同一行)會算出不同的數字。**契約 §2(`contracts/types.md` 第 117 行)明寫這種情況「尚未定義(不在 1.2.0 範圍,不要自行假設)」**——所以現在不是哪一邊錯,而是**契約沒說**,兩邊各自猜了一個。

`word-count-min.ts` 的檔頭自己寫了「I1 整合後改用 01-data-layer 的正式驗證器」;這個複本是過渡品。T19 之後,`generate-cards.ts` 改成與 `validateCard` 同一條路(`parseCardText` + `countWords`),**這份複本在 `ingest/` 的最大用戶就消失了**。

## 2026-10-25 顧問審後更新(以這一節為準)

顧問在 main 629afa3 上 grep 過,工單原文有四處要更正:

1. **事實過時,走 (a) 移除。** T19 之後還在用 `word-count-min.ts` 的地方:
   - `packages/core/src/ingest/generate-cards.ts` 第 3 行:只剩 `BODY_WORD_LIMIT` → 改用 `@contracts` 的 `CARD_BODY_WORD_LIMIT`。
   - `packages/core/src/ingest/index.ts` 第 3 行:`export *` → 拿掉。
   - 註解提到它的:`ingest/types.ts` 第 4 行、`ingest/questions.ts` 第 19 行 → 改寫註解。
   - 兩個步驟定義檔 `features/steps/ingest.steps.ts` 第 12 行、`features/steps/i1-content-pipeline.steps.ts` 第 43 行(比 ingest 與 data-layer 字數的步驟):**屬於測試,由測試 agent 在紅測試 commit 裡改**(i1 那一步改成比 `generate-cards` 的 `countBodyWords` 與 `validateCard`),**worker 不碰**。
   - touches 因此加了 `generate-cards.ts`、`index.ts`、`types.ts`、`questions.ts`。
2. **紅測試的形狀。**
   - 靜態:`packages/`、`scripts/`、`features/` 裡**沒有任何** import `word-count-min`(現在紅)。
   - 舊 `word-count-min.test.ts` 的邊界案例搬到 `packages/core/src/ingest/` 底下的新檔(**不放 `schema/`**,工單禁動 `schema/`)。
3. **第 3 條(開閉在同一行、未閉合不測、碰到就停)照留。**
4. **新發現,測試不准犯。** 契約 §2 1.2.0(ADR-060,使用者裁)的四反引號向量 = 2。顧問實測 `word-count-min` 算 6、`validateCard` 路徑也算 6;契約 fixture `valid-example-with-nested-content.md` 的 `validateCard` 算 33(圍欄內程式碼被算進去)。兩邊一樣錯,所以 T20 的「逐字串差分」不會停,但 **T20 的測試不准把 6 寫成期望值**。舊測試若有釘四反引號的數字,測試 agent 回報顧問,**不搬**。這個缺陷由 T51 處理(`parse-card.ts` 的 `EXAMPLE_FENCE_RE` 寫死三個反引號),T20 先做。

## 要求

1. **先查誰還在用**:`grep` 出 `word-count-min`、`countBodyWords`、`stripExampleFences`、`BODY_WORD_LIMIT` 在 `packages/` 與 `scripts/`、`features/` 的所有引用(包含測試),列在 commit 說明裡。
2. 二擇一(開發依查到的引用數選,**選了要寫理由**):
   - **(a) 移除**:引用都能改接 `@core/schema/index.js` 的 `parseCardText` 與 `countWords`(與 T19 相同的接法)→ 刪掉 `word-count-min.ts` 與它的測試(舊測試的每一條邊界案例,要在新位置找得到替身,找不到就補)。
   - **(b) 統一正則**:仍有引用拿不掉 → 讓 `word-count-min.ts` 的圍欄處理改成呼叫 `parseCardText`(單一來源),不再自帶正則。
3. **碰到「開閉在同一行」或「未閉合」的案例**(舊測試裡有、或改接後兩邊結果不同):**停下來,回報協調者**。**不要自己定義**它們的算法,不要為了讓測試綠而改正則去選邊。回報時附:案例字串、兩邊各算幾、舊測試的哪一條。
4. 不改 `countWords` 的演算法、不改 `parse-card.ts`、不改契約。

## 測試

| 驗收 | 量什麼 | 怎麼量 |
|---|---|---|
| 要求 1、2 | `grep` 不到 `word-count-min` 的殘留引用((a) 的情況),或圍欄只剩一份正則((b) 的情況) | 靜態檢查 |
| 要求 2 | 既有 `word-count-min.test.ts` 的**每一條**邊界案例,在新位置有同值的測試(CJK、英數序列、連字號切斷、example 圍欄內不算、四反引號圍欄、非 `example` 的圍欄不移除) | vitest |
| 要求 3 | **不測**開閉在同一行、未閉合的圍欄(契約未定義);測試裡也不放這類案例 | — |
| 整體 | `ingest` 的既有測試全綠 | vitest |

## 不在範圍

- 不定義契約 §2 尚未定義的兩種圍欄情況。要定義要走 ADR 與契約版本(那是契約硬約定),由顧問決定,不在這張。
- 不改 `schema/`、不改 `contracts/`、不改 `prompts/`。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest packages/core/src/schema
npm run boundaries
```

不跑 `--live`、不跑變異測試、不跑 `check:all`、不碰真的 `learning/`。

## 預算

`budget_usd: 1`(純刪除與改接)。
