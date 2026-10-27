# T65 實作驗收證據(05-grading phase-3:縮短版生成)

- 工單:T65(`docs/tickets/T65-grading-phase3-short-and-queue.md`)
- 被驗分支:`t65-impl` tip `243da8d8f64faa2a97b894fc89c82b5f786ad53a`(worker 分支),基底 `t65-start` `fb698fc40841410b7a3a0c90245f9ba5ce467317`
- 開跑與跑完的 tree sha(筆電與 i9 同):`082fe9adb5e7d1256fb5e9d60a1bd69d62af3096`
- 日期:2026-10-27。乾淨簽出(`git worktree add --detach`),兩邊 `ls .env` 都是 No such file,i9 `npm ci`,空 HOME。
- 重編:這張沒有 Rust 改動;cucumber 的 BeforeAll 自己處理 `lc-fs`。

## 1. 測試作者

`git diff --name-only t65-start t65-impl` 共 7 個檔:`reteach-short.ts`(新)、`grading/index.ts`、`prompts/grading/reteach-short.md`(新)、`golden-sets/registry.ts`、`types.ts`、`structural-checks.ts`、worker 自己的報告。**沒有任何測試檔、步驟檔、`.feature`**;就是工單 touches 的六個加報告。只有 1 個 commit。通過。

## 2. 全測試(i9,空 HOME,`VITEST_MAX_WORKERS=1`)

| 項目 | 結果 |
|---|---|
| 單元:`grading/`、`prompt-quality/`、`features/support`、`scripts/prompt-check` | **65 檔 1291/1291 綠** |
| `npm run typecheck` | 乾淨 |
| `npm run boundaries` | 過(scanned 407;例外 26 條,沒新增) |
| `npx tsx scripts/prompt-check.ts --golden --set reteach.short --fake` | **退出碼 0**,處理了 3 個 golden 輸入 |
| cucumber `@grading and @phase-3 and not @manual` | **3 場景 16 步全過** |
| cucumber `@grading and @phase-2` | 9/9、54 步 |
| cucumber `@llm-router and @phase-3` | 8/8、31 步 |
| cucumber `@integration and @i1` | 9/9、58 步 |
| cucumber `@prompt-quality` | 37/37、151 步 |
| 跑完空 HOME 底下 `llm-learning-cards` 快取資料夾 | 0 個 |

沒有跑 live golden、沒有碰 prompt 的人工評分(那是顧問)。

## 3. 變異(Stryker CLI,i9)

指令:`npm run mutate -- stryker.t65-reteach-short.json`

- 設定檔 `stryker.t65-reteach-short.json`(在這個證據分支上):`mutate` = `reteach-short.ts` 全檔 + `structural-checks.ts` 的新分支所在範圍(第 22–45 行,含常數與 `checkCardShape`);測試 = `reteach-short.test.ts`、`structural-checks.test.ts`、`structural-checks-t65.test.ts`;`--bail=1`。
- **總分 89.14%**(156 殺、19 活、0 無涵蓋、0 逾時;約 1 分鐘)。`structural-checks.ts` **100.00%**;`reteach-short.ts` **86.23%**。門檻 80%:過。

19 個存活的分類(逐個對過原始碼):

| 類別 | 個數 | 判定 |
|---|---|---|
| prompt 排版的空行與 `trimEnd`(第 58–61 行) | 5 | 等價(只差空白) |
| `JSON.parse` 失敗的 catch 清空(第 68 行) | 1 | 等價(後面的型別檢查照樣回 null) |
| 解析後「不是物件」的守門(第 71 行,`null` / 非物件 / 陣列) | 6 | 陣列與非物件等價;**`null` 這一條是真缺口**:回應是 JSON `null` 時,少了 `value === null` 會 `null.body` 丟 TypeError,測試沒有「回應是 `null`」這一列 |
| 來回檢查的 `examples.length !== 1`(第 85 行,其中一個) | 1 | **真缺口(G4)**:我實測 body 裡放一個「內容跟 example 完全相同」的 example 圍欄,讀回 examples 是 `[X, X]`,第一個跟模型給的相同,只靠第二個條件擋不住;少了長度檢查就會寫出 2 個 example 的縮短版。現有單元的沒關圍欄與有關圍欄兩條,內容都跟 example 不同,抓不到 |
| `return { readBackWords }` 清掉(第 86 行) | 1 | **真缺口(G5)**:來回檢查失敗時,下一次 prompt 的 N 用那次讀回的字數(worker 報告的待協調第二條),沒有測試釘它 |
| 同字數時留先出現的(第 97 行) | 1 | 等價(工單沒規定平手) |
| warning 的欄位字串(第 107 行) | 1 | 小缺口:測試只看 `reason`,不看 `type` / `task` 等字串 |
| `fit` 的三個變體(第 143 行) | 3 | 等價:停在第一個夠短的那一次,它必然是最後一個、也是最短的,`pickShortest` 照樣選到 |

## 4. 我自選的改壞(對 `reteach-short.ts`,單元檔 51 條,筆電空 HOME)

13 個,**11 紅**:丟掉 example 一致性檢查(2 紅)、`provisional` 一律 false(2 紅)、回傳的 provisional 錯(4 紅)、永遠 enqueue(3 紅)、overlong warning 不帶字數(1 紅)、N 只算第一次(1 紅)、NO_MODEL 的 attempts 固定 3(2 紅)、NO_MODEL 有好的也回 no-model(2 紅)、example 只擋空字串不 trim(1 紅)、prompt 沒有上限行(1 紅)、重試那行的上限寫錯(1 紅)。

**存活 2**:
- **H1:前一次格式壞時,N 沿用更早那次的字數**:51/51 仍綠。這就是 worker 報告「待協調」第一條的行為,沒有測試釘住是哪一種。
- 同字數留後一次:等價。

## 5. 「待協調」兩條的判斷(給協調者與顧問)

1. **前一次在來回檢查前就格式壞 → 下一次 prompt 不加「上一次 N 字」那行。** 我的判斷:**接受,與工單和測試不矛盾。**
   - 工單寫的是「N 是**上一次**讀回 body 的字數」,上一次沒有讀回的 body,就沒有 N;發明一個 N 沒有意義。
   - 紅測試只在每次都格式好的情況檢查那行。我實測「沿用更早的 N」(H1)也全綠,所以兩種寫法都過,測試沒有選邊。
   - 建議(低優先):請測試 agent 補兩列釘住——「第 1 次格式壞 → 第 2 次 prompt 沒有『上一次』」「太長 → 壞 → 第 3 次 prompt 沒有『上一次』」,之後就不會被改成另一種。
2. **來回檢查失敗(讀得到 body,但 examples 不對)時,下一次的 N 用那次讀回 body 的字數。** 工單定義如此,實作照做。測試沒釘(G5,存活)。
   建議一併請測試 agent 補一列:沒關圍欄那一次之後,第 2 次 prompt 的最後一行是「上一次 N 字」,N 是讀回的字數。

## 6. 缺口彙整(都不擋;建議一起補,低優先)

- G4:body 內帶一個「內容跟 example 相同」的 example 圍欄 → 應算格式壞。
- G5:來回檢查失敗後的下一次 prompt 的 N(見上)。
- 回應是 JSON `null` 要算格式壞(不丟錯)。
- 待協調兩條的釘住列(見第 5 節)。
- warning 的 `type` / `task` 欄位沒被斷言。

## 7. 副作用與花費

- `learning/`:64 檔 / `01d84e9c918e1cf4` / 帳本 111 行,前後相同。筆電 `~/.cache/llm-learning-cards` 頂層 497,前後相同。
- worker 花費:$4.35(opencode grok-4.7,協調者給的數字,只記錄;不設限額)。我這邊 LLM 花費 0。
- 暫存都清了:i9 簽出、暫存分支、暫存 ref、報告檔、暫存 HOME;筆電簽出與暫存目錄。變異報告檔留在已刪的簽出裡,沒有進 git。
- 沒有刪任何公共路徑,只刪我自己 `mktemp` 或自己建的東西。

## 結論

通過。沒有阻擋項。變異 89.14%(`structural-checks.ts` 100%、`reteach-short.ts` 86.23%);全部指定的測試與場景全綠。缺口 G4、G5 與 `null` 回應為低優先,建議請測試 agent 補列。
