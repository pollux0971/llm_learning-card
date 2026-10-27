# T65 紅測試驗收證據,第二輪(G1/G2 補件 + 顧問加的 structural 規則)

- 工單:T65。第一輪見同資料夾的 acceptance-T65-red.md(基底 `2bf9d8e`,有阻擋項 G1)。
- 被驗分支:`t65-red` tip `9c06746844290014ee2107efcce1e4c79b0dec94`(在 `2bf9d8e` 上疊 3 個 commit:`45a6ad8` golden+G2、`452e78b` 行號補丁、`9c06746` structural 補測),基底 `t65-chore` `2ebc05bad7a4481fc62aa2c7bad62d7ef2666a92`
- tree sha:筆電 `d56137949e57a4e234202a5fda332f68cac81776`,i9 同。日期 2026-10-27。乾淨簽出,兩邊 `ls .env` 都是 No such file,i9 `npm ci`。
- 3 個 commit 作者都是測試 agent 帳號;沒有任何實作檔。

## 1. 我的丟棄式實作過整批(不進 git、已刪)

我重寫了第一輪的丟棄式 `generateShort`(G2 判準:讀回的 example 要等於模型給的 trim 後那個),另外為了讓 golden 與守門轉綠,加了:prompt 檔、registry 項(`reteach.short`,輸入來自 `fixtures/golden-short/inputs.json`,header 四行 golden / category / title / limit)、`GoldenSetId` 多一個值、`structural-checks.ts` 的縮短版形狀規則、`grading/index.ts` 匯出。

| 項目 | 結果 |
|---|---|
| 單元:`grading/`、`prompt-quality/`、`features/support`、`scripts/prompt-check`(i9,空 HOME) | **65 檔 1291/1291 綠**(含 `reteach-short.test` 51 條、`registry-t65` 與 `structural-checks-t65` 9 條、守門 5 條、`t31-static`) |
| 筆電:同批加 `t31-static` 與守門(33 檔) | 776/776 綠 |
| `npx tsx scripts/prompt-check.ts --golden --set reteach.short --fake` | **退出碼 0**,「處理了 3 個 golden 輸入」 |
| **現有 7 條 prompt 檔守門**(第一輪實作後紅的那 7 條:`cli.test` 2、`registry.test` 4、`registry-t55.test` 1) | **全綠** |
| cucumber `@prompt-quality and not @manual` | 基底(沒有實作):**36 過、1 敗**(「each of the six ingest prompt files is named by exactly one golden set」,等 prompt 檔與登記)。有實作:**37/37 綠、151 步全過** |
| cucumber `@grading and @phase-3 and not @manual` | 基底 3 場景全紅(`Cannot find module`);有實作 3/3、16 步全綠 |
| 不退步:`@grading and @phase-2` 9/9、`@llm-router and @phase-3` 8/8 | 綠 |
| 基底(沒有實作)`tsc`、`boundaries`(筆電) | 乾淨 / 過(scanned 406);有實作 boundaries 過(407) |

跑完空 HOME 底下沒有多出 `llm-learning-cards` 快取資料夾。

## 2. 既有測試的數字改動(沒放寬)

逐行看 `git diff 2bf9d8e..t65-red` 的既有檔:

- `cli.test`:24 → 27 個輸入、「七組」→「八組」、`slice(1,8)` → `slice(1,9)`、新增一行 `reteach.short` 的完整字串、結論行號 +1、`lines.length` 11 → 12。**每條斷言都更嚴(多一個項目),沒有刪 `expect`**。
- `registry.test`:掃描器清單多一個 `grading/reteach-short.md`(排序後在最前面)、set 清單與真任務清單各多 `reteach.short`、輸入數表多 `'reteach.short': 3`。
- `registry.test` 的「五組吃 raw 的真任務」那條,排除清單多了 `reteach.short`:**這是唯一一處範圍縮小**,理由與 T55 排除 `ingest.topic` 一樣(輸入不是 raw 切片,改由 `registry-t65.test` 管)。可接受。
- `prompt-quality-phase2.steps`:「六個 ingest prompt 檔」那步,原本 `scanned.length === 6` 改成「ingest 底下仍恰好 6 個」加「總數 7」,兩條都有,沒有放寬。
- `.feature` 一個字沒動。

## 3. 自選改壞

### G2(來回檢查判準;對我的丟棄式實作,單元檔 51 條)

| 改壞 | 結果 |
|---|---|
| 拿掉「讀回 example 等於模型給的」檢查 | **2 紅**(沒關圍欄那兩條) |
| 比對時不 trim | **1 紅**(「不誤殺:前後有空白」那條) |
| 改成比對讀回 body 與模型給的 body(不比 example) | 51/51 綠——**不是缺口**:這種寫法同樣擋掉沒關圍欄,條文只定了「結果要擋掉」,兩種實作都合規 |

### structural 規則(`structural-checks-t65.test`,9 條)

| 改壞 | 結果 |
|---|---|
| 縮短版上限 51 | 2 紅(51 字那兩條) |
| 縮短版上限 49 | 2 紅(正好 50 字那條與 51 字 detail 那條) |
| `>` 改 `>=` | 2 紅(正好 50 字沒問題、一般卡 100 字沒問題) |
| `typeof example === 'string'` 改成 `'example' in obj` | **1 紅**(「不是字串的 example 欄位」那條) |
| 改成 `example !== undefined` | 1 紅(同上) |
| 沒有縮短版規則(上限一律 100) | 2 紅 |
| 一般卡上限 101 / 99 | 1 紅 / 1 紅(101、100 邊界那條) |
| 縮短版仍要求 title | 5 紅 |
| 誰都不要求 title | 2 紅 |
| detail 文字寫成 100 | 1 紅 |

### golden registry(`registry-t65.test` 等 77 條)

| 改壞 | 結果 |
|---|---|
| `limit: 51` / 不帶 examples / 不帶 body / 沒有 title 行 / category 行寫死 | 各 1 紅 |
| task 改 `ingest.cards` | 6 紅 |
| 不列進真任務清單 | 3 紅 |
| 登記在 ingest.deps 前面 | 2 紅(順序釘住) |

**沒有存活的缺口。**

## 4. 補充觀察(不擋)

- golden 輸入:三張非資安、各有分類(science / programming / finance)的公開常識卡,原卡 body 都比 50 字長又不超過 100;`--fake` 回應的 body 都在 50 字以內;四個檔的 sha256 在測試裡釘住。我把輸入檔的內容讀過,沒有 `learning/`、`raw/` 或帳本的東西。
- 登記表的 prompt 格式(四行 header)只寫在測試裡,工單文字沒寫;worker 得照 `registry-t65.test` 寫。這是協調者派工時要提醒的一點。
- 上一輪的 G3(import 守門漏判有替換的模板字串動態 import)沒有處理,維持低優先、不擋。

## 5. 副作用與花費

- `learning/`:64 檔 / `01d84e9c918e1cf4` / 帳本 111 行,前後相同。筆電 `~/.cache/llm-learning-cards` 頂層 497,前後相同。LLM 花費 0。
- 暫存都清了:i9 簽出、暫存分支、暫存 ref、暫存 HOME、tar;筆電簽出裡的丟棄式實作先丟棄才開這個證據分支。

## 結論

通過。第一輪的阻擋項 G1(golden 輸入與 `--fake` 回應)已補齊;G2 補了判準測試;顧問加的 structural 規則的邊界(50/51、100/101、`typeof` 對 `in`)都有紅。沒有阻擋項。
