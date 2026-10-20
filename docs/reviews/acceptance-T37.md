# 驗收證據:T37 07-teach-card phase-2(教學卡接上側車、換類別、先備提示)

- 工單:T37(`../tickets/T37-teach-card-phase-2.md`,唯一正本)。實作報告:`T37-implementation.md`(同目錄)。
- 被驗分支:`t37-impl` tip **efd95bf**(基底 t37-start 2cc7d86 = origin/main 4c5aa62 + 紅測試 6aaf523;後來合進 -5c 的 B-lite 補測 32f7fdc〔合併 7d4042f〕與 worker 的 efd95bf)。
- 驗收者:驗收 agent,2026-10-21。tree sha(開跑與跑完同):**316a29c620ed9481b4ee16df1bf4cb185a9e1f2e**。簽出乾淨,`ls .env` 無。
- 機器:`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`;load 開跑 0.7,鏈中 4–8,變異時 4–6。
- 先做過一輪輕的(ffdecef),再等 deck.ts 去 fs 的補丁,重的只在 efd95bf 跑一遍。

## 測試作者

`git diff --name-only t37-start t37-impl`:測試類檔只有兩個:`packages/core/src/teach/deck.test.ts`、`packages/core/src/teach/no-node-static.test.ts`,都來自測試 agent 的 32f7fdc。worker 的 efd95bf 只改 `teach/deck.ts` 與報告,0 個測試檔。`.feature`、`features/support`、`features/steps`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`:這個 diff 都沒碰。`mutants.out` 0。
新增的 .ts 全落在既有的 owners 前綴(`teach/`、`apps/teach-card/`、`session/`),`boundaries.owners.json` 沒變。`scripts/boundaries.allow.json` 只多 11 → 07 那條(與 origin/main 一致)。

## 基準(未突變,efd95bf)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 乾淨(7 秒) |
| `npm run boundaries` | **紅,1 個違規**(見 B1) |
| 整個 vitest | 3 files failed、**4 條紅**、6030 passed、171 skipped(見 B1、N1) |
| cucumber `@teach-card and @phase-2 and not @manual` | 5 scenarios、25 steps 全過,0 undefined |
| cucumber `@teach-card and @phase-1 and not @manual` | 10 / 41 全過 |
| cucumber `@i2 and not @manual` | 93 / 464 全過 |
| cucumber `@integration and @i3 and not @manual` | 6 / 33 全過 |
| cucumber `@desktop-shell and not @manual` | 171 scenarios:162 過、9 undefined(phase-3/4/5 還沒做的場景,與 T34 驗收時相同)、0 失敗 |
| `cargo test`(apps/desktop/src-tauri,含 review_sidecar 與協定向量) | 全部 249 passed、0 failed |

## 阻擋項

### B1:`npm run boundaries` 紅,而且是測試 agent 的檔造成的

違規訊息原文:`packages/core/src/teach/no-node-static.test.ts:75  import '../scheduler/transitions.js'  (07-teach-card → 04-scheduler)`。
原因:那個測試的自測用一行「合成片段」`"import { applyLearnedTransition } from '../scheduler/transitions.js';"`(放在 `fine` 清單裡,證明掃描器不會把非 node 的 import 當成 node)。邊界掃描器是用文字掃的,把字串裡的這行當成 teach/ 真的 import 了 04-scheduler。
連帶紅的 vitest 三條:`scripts/check-boundaries.local.test.ts` 兩條(預設掃本 repo、--verbose)、`scripts/zero-input-guard.test.ts` 一條(check-boundaries 基線)。
我用丟棄式做法證明它是唯一原因:刪掉那一行(不進 git)後 `npm run boundaries` 回 PASS(scanned 350),那三條回綠。把字串用 `'..' + '/scheduler…'` 拼起來**不行**(掃描器改報 `import '..'` 不在任何落點內),要換成不被掃成 import 的寫法。
這是測試檔的問題,worker 沒有碰它;修法在測試端(測試 agent 改),不是實作問題,也不需要新增邊界例外。

### B2:變異分數 75.25%,低於 80%

| | 範圍 |
|---|---|
| 指令 | `npm run mutate -- stryker.t37-teach.json`(設定檔隨證據附上) |
| 被變異的檔 | `packages/core/src/session/teach.ts`(整檔)、`packages/core/src/teach/deck.ts`(整檔)、`packages/core/src/schema/graph.ts` 的 readOrderFile(第 82–92 行) |
| 測試 | 一支 vitest 命令,`MUTATE_TEST_GLOB` 只含 `t37-handler.test.ts`、`t37-conflict.test.ts`、`deck.test.ts`,`--bail=1`,coverageAnalysis off,concurrency 2,timeoutMS 120000,門檻 high 90 / low 80 |
| 結果 | **75.25%**:295 個 mutant,222 killed、0 timeout、73 survived、0 no-coverage |

分檔:`deck.ts` 100%(39/39);`teach.ts` 72.37%(165 killed、63 survived);`graph.ts` 的 readOrderFile 64.29%(18 killed、10 survived)。報告檔 `reports/mutation/efd95bf-t37-teach.json`。

存活者我逐條歸類(沒歸進去的都列出):

等價或低(不要求補):
- teach.ts 第 63 行 `isReviewsChanged` 的型別防護(7 個)、第 68/72/80 行(`categories.yaml` 不是陣列或單筆不合法、分類目錄不存在時的防護)、第 83/85 行(略過 `.short.md` 與「不在 allIds 裡」:`listCardIds` 已經先濾過,冗餘)、第 91 行讀檔編碼、第 100 行反斜線換成斜線(Linux 上無影響)、第 165/170/182 行 `recordCurrent` 的回傳字串(呼叫處只比對 `'conflict'`)、第 227 行 `index >= length` 的邊界與 `Number.isInteger`/`< 0`(zod schema 在協定層已擋,且第 229 行的 `picked === undefined` 還有一道)、第 229 行(死碼防護)。
- graph.ts 第 87 行編碼、第 89 行錯誤訊息字樣。

**真的測試缺口**(測試沒蓋到的行為,不是等價):
1. **G-a 寫入遇到非「記錄被改過」的錯誤時被吞掉**(teach.ts 第 183/184 行 `if (!isReviewsChanged(err)) throw err`:拿掉後,例如磁碟寫入失敗會被當成「衝突」重試、最後回 `teach-record-changed`,而不是把真錯誤往上丟)。這是寫 `reviews.json`(使用者幾個月的記憶資料)的路徑,風險最高。
2. **G-b `order` 檔壞掉時的行為沒測**(graph.ts 第 88/89 行:內容不是字串陣列時應丟錯;拿掉判斷後壞檔會被當成 ok 吃進去)。
3. **G-c `teach.next` / `teach.prereq` 在 `teach.open` 之前呼叫**(teach.ts 第 208、223 行 `bad-request`)沒有測;這兩條防護拿掉測試仍綠。
4. **G-d 「沒有 order 檔」的 warning 每個類別只記一次**(第 123/124 行 `warned` 集合):沒測。我另做的手工改壞 m17(每次都記)也存活。工單只說「記一筆 warning」,一天內多次 `teach.next` 會重複寫,日誌被洗。
5. **G-e `readOrderFile` 對不合法的分類 id 回 missing 不去讀路徑**(graph.ts 第 84 行;手工 m26 也存活):API 層其他防護先擋了,但函式本身的這道「不把任意字串當路徑」沒有直接的測試。
6. **G-f 卡片 frontmatter 的 `title` 不是字串/空字串、`prereqs` 不是字串陣列**時的退路(teach.ts 第 93/94 行,6 個 mutant)沒測。
7. G-g `categories.yaml` 沒有任何分類時 `teach.open` 回 `bad-request`(第 202 行)沒測。

若扣掉我歸為等價的約 30 個,有效分數約 84%;但上面七項是真的行為,建議由測試 agent 補測,尤其 G-a。要不要擋,交顧問判(工單沒寫變異分數門檻;本專案 T33 先例是 80%)。

## 工單 must_catch(21 條)—— 我自己的改壞(丟棄式,全部還原)

我做了 29 個手工改壞,每個先 `tsc` 確認能編譯,再跑 t37-handler、t37-conflict、t37-sidecar、deck 與 session 目錄的 vitest,存活的再補跑 `@teach-card and @phase-2` cucumber。**24 個紅、5 個存活**;紅的訊息原文留在 vitest 輸出,這裡列對應:

| 改壞 | 對到的 must_catch / 行為 | 結果 |
|---|---|---|
| 不寫 reviews(`saveReviewsIfUnchanged` 換成假雜湊) | 「next 只改記憶體」 | 紅 |
| 考試卡基準無條件設成新雜湊 | 「吞掉終端機改動」 | 紅(t37-handler:外面改了 reviews.json 的那條) |
| 考試卡基準從不前進 | 「考試卡下一次送出報被改過」 | 紅 |
| `learned_at` 改用系統今天 | 「今天跟 session 不是同一個來源」 | 紅 |
| 已在 reviews 的卡再標一次(拿掉存在檢查) | 「stage / next_due / history 被重設」 | 紅 |
| 重試 2 → 1、2 → 3 | 衝突重試一次 | 各紅 |
| `switch` 不標目前那張 | 「換類別時沒標學過」 | 紅 |
| 不寫 learned 事件 / 先寫 log 再寫 reviews | 「learned 沒寫或順序不對」 | 各紅 |
| 不記 warning | 「沒有 order 檔不記 warning」 | 紅 |
| `prereq` 順手把原卡標學過 | 「跟先備走時把原卡標學過」 | 紅 |
| `open` 不驗類別、`switch` 不驗類別 | 「照 webview 給的任意類別」 | 各紅 |
| 衝突時不回 teach-record-changed | 衝突回錯 | 紅 |
| 忽略 order 檔 / 尾巴不排序 / 缺 order 時不排序 / order 重複 | 「不照 order 檔」 | 前三個紅;**order 內有重複 id 去重存活**(低,工單沒寫重複) |
| 先備清單:不濾學過的、不濾磁碟沒有的 | 「只點名沒學的」 | 各紅 |
| 剩幾張多算 | 類別清單的剩幾張 | 紅 |
| 空陣列 order 檔當成 missing | 「沒有檔」與「檔在但空」要分開 | 紅 |
| handler 的今天改系統時間 / 考試卡 session 傳 undefined | 日期同源、同側車不互相絆倒 | 各紅 |
| `index > length`(邊界)、預設 index 0、warning 每次都記、readOrderFile 不驗分類 | 見等價 / G-d / G-e | 存活(前兩個等價) |

其他 must_catch(桌面版不讀 fixture、busy 重試 180 秒上限、standalone 起得來、四個動作的協定向量、考試卡與教學卡雙向)由 cucumber / vitest / cargo 的基準綠燈覆蓋;我沒有逐條再改壞,測試 agent 的自述改壞(M01–M19)我不採信也沒有重做。

### no-node-static 的改壞證明(協調者要我自己重做)

| 改壞 | 結果 |
|---|---|
| `teach/deck.ts` 開頭加 `import { readFileSync } from "node:fs";` | 紅:`AssertionError: teach/ 是純函式(ADR-077 B-lite);碰檔案的在 session/teach.ts,讀 order 檔的在 schema/graph.ts: expected [ Array(1) ] to deeply equal []`(「沒有任何一個 import 是 node: 模組或內建模組名」那條) |
| 同處加 `import { join } from "path";`(沒有 node: 前綴的內建模組) | 一樣紅,同一則訊息 |

還原後綠。

## 其他量到的

- **N1:vitest 第四條紅 `features/support/t31-static.test.ts`「整份例外清單條數不變」**(`expected … to have a length of 21 but got 23`)。這不是 T37 的問題:t37-impl 的基底還沒有 T38(`0dc654a`,條數 21 → 23)。我丟棄式把常數改成 23 後它回綠。合進 origin/main 之後就沒有。
- **N2:`deck.test.ts` 那組衝突已解**:`deck.ts` 現在只有純函式(53 行)、沒有 `node:` import;`readOrderFile` 只在 `schema/graph.ts`,與 ADR-077 B-lite 一致。
- 簽章變動的使用處:`REQUEST_METHODS` 5 → 9、`ERROR_KINDS` 加 `teach-record-changed`;`git grep`(含 `.mjs`、`.js`、`.rs`、`.svelte`)的非測試使用處只有 `protocol.ts` 與 `session/teach.ts`;Rust 側只從協定向量讀,cargo 全綠。
- 成本:協調者通知 grok-4.7 約 19.6 美元(只記錄);預算 6 美元,比值約 3.3 倍,超過 2 倍(超在規模大、跑了兩輪補丁)。我這邊沒有 LLM 花費。

## 使用者資料前後(只記數字)

| | 檔案數 | 雜湊 | 帳本行數 |
|---|---|---|---|
| 前 | 64 | c2e4dd6d71de3976 | 108 |
| 後 | 64 | c2e4dd6d71de3976 | 108 |

第一輪(efd95bf)的結論是「有阻擋項」(B1、B2),已在 -5c 的補丁(a68acfa)修掉,見下。

## 第二輪:測試端補丁後重驗(`t37-fixes` tip a68acfa)

- 被驗:`t37-fixes` **a68acfa**(基底 t37-impl efd95bf,只多 -5c 一個 commit:`features/support/t37-conflict.test.ts`、`features/support/t37-gaps.test.ts`(新)、`packages/core/src/teach/deck.test.ts`、`packages/core/src/teach/no-node-static.test.ts`,4 個測試檔,實作檔 0 個)。tree sha(開跑與跑完同):**e52df5848e7fcf8a76aad129fff5af73ade44a1b**;簽出乾淨,`ls .env` 無。實作沒變,所以 cucumber 與 cargo 沒有重跑(第一輪在 efd95bf 的結果仍成立)。
- 機器:load 開跑約 3.7,變異時約 4.4。

### 重跑結果

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 乾淨 |
| `npm run boundaries` | **PASS**(scanned 350,無違規)——B1 已解:`no-node-static.test.ts` 的自測片段改成 `./deck.js` 樣本,不再被掃成 07 → 04 |
| 整個 vitest | 6053 passed、171 skipped、**1 條紅**:`t31-static.test.ts` 的「整份例外清單條數不變」(N1,不是 T37:基底沒有 T38)。我丟棄式把常數改成 23:t31-static 14 條全過 |
| no-node-static 自己重做 | `teach/deck.ts` 加 `import { readFileSync } from "node:fs"`:紅;加 `import { join } from "path"`:也紅。訊息同:`teach/ 是純函式(ADR-077 B-lite);碰檔案的在 session/teach.ts,讀 order 檔的在 schema/graph.ts: expected [ Array(1) ] to deeply equal []`。還原後綠 |

### 變異(`npm run mutate -- stryker.t37-teach.json`,範圍與旗標同第一輪)

**一個必須講清楚的差別**:第一輪的測試只有 3 個檔(`t37-handler`、`t37-conflict`、`deck.test`)。-5c 的補測放在**新檔** `t37-gaps.test.ts`,不在那組裡,所以照原樣重跑會量不到它。我先照原樣跑一次,再把 `t37-gaps.test.ts` 加進同一個 `MUTATE_TEST_GLOB`(其他旗標不變:`--bail=1`、concurrency 2、timeoutMS 120000、coverageAnalysis off、門檻 90/80)再跑一次。縮小測試是為了加速,glob 本來就該蓋住被變異檔的**所有**測試。

| 跑法 | 分數 | killed / survived | graph.ts(readOrderFile)/ teach.ts / deck.ts |
|---|---|---|---|
| 原 glob(漏掉新檔) | 79.32% | 234 / 61 | 89.29% / 74.56% / 100% |
| **glob 加上 t37-gaps.test.ts(正確的量法)** | **86.44%** | **255 / 40** | 89.29% / 83.77% / 100% |

兩份報告都在 `reports/mutation/`:`a68acfa-t37-teach.json`(86.44)與 `a68acfa-t37-teach-oldglob.json`(79.32)。設定檔 `stryker.t37-teach.json` 已更新(glob 多了 t37-gaps)。**原始分數 ≥ 80% 成立**,前提是用上一段的 glob;用舊 glob 是 79.32%,差 0.68 個百分點,原因就是漏掉新檔。

### G-a 到 G-g 逐一對照(第二輪存活清單)

| 缺口 | 第一輪的 mutant | 第二輪 |
|---|---|---|
| G-a 寫入遇到非 reviews-changed 的錯誤被吞 | teach.ts 第 183、184 行 | **殺掉**(第 183/184 行不在存活清單) |
| G-b order 檔內容壞掉 | graph.ts 第 88 行的判斷 4 個 mutant | **殺掉**;只剩第 89 行錯誤訊息字樣被換成空字串(低) |
| G-c 動作在 open 之前 | teach.ts 第 208 行(next)、第 223 行(prereq) | `next` 殺掉;`prereq` 的整個 `if (false)` 殺掉;**存活 3 個**:第 223 行的 `&&`(`category === undefined && cardId === undefined`)與 `|| false`:代表「類別已經學完、沒有目前卡」時呼叫 `teach.prereq`,沒有測試(實作會走到讀 undefined 卡,而不是回 bad-request);`false || cardId === undefined` 等價(類別沒有時一定沒有卡) |
| G-d warning 只記一次 | 第 123/124 行 | **殺掉** |
| G-e `readOrderFile` 不合法分類 id 不去讀路徑 | graph.ts 第 84 行 | **仍存活**(1 個 `if (false)`)。我寫丟棄式測試證明這是真的測試缺口,不是等價:讓 `learning/x.json` 存在、呼叫 `readOrderFile(<root>, 'a/../../x')`:有防護回 `{ kind: 'missing' }`;拿掉防護回 `{ kind: 'ok', ids: ['zz'] }`(讀到 graph 目錄外的 json)。API 層因為類別一定要在 categories.yaml 裡,先擋掉了,所以實際上到不了;一條單元測試就能殺它 |
| G-f frontmatter title / prereqs 型別 | 第 93、94 行 6 個 | 第 94 行的 3 個(`filter` 拿掉、`filter` 恆真、退路換成別的陣列)**確認等價**——-5c 說得對:非字串項目拿到「磁碟上有沒有這張卡」那一步就被擋掉(`unlearnedPrereqs` 只留磁碟上有的 id),輸出一樣。第 93 行 `title` 的 `true && length > 0` 存活 1 個(低:卡片 frontmatter 在 schema 層一定有 title) |
| G-g categories.yaml 沒有分類時 open | 第 202 行 | **殺掉** |

### 其他存活者(清單外?)

剩下 40 個存活:graph.ts 3 個(第 84 行 = G-e、第 87 行編碼、第 89 行訊息字樣);teach.ts 37 個,全部在我第一輪列的等價/低清單內:第 63 行型別防護、第 80/83/85 行(分類目錄不存在與 `.short.md` 濾除,`listCardIds` 已先濾)、第 91 行編碼、第 100 行反斜線、第 140 行 `cats[0]?.id` 的退路、第 165/170/182 行回傳字串(呼叫處只比 'conflict')、第 203 行(`requested !== undefined` 恆真:等價)、第 227/229 行(index 邊界與死碼防護,zod 在協定層已擋)、第 93/94 行(G-f)、第 223 行(G-c 剩的那 3 個)。**沒有清單外的新存活者。**

### 過關條件對照(協調者轉述顧問)

1. 原始分數 ≥ 80%:**達成**(86.44%,用涵蓋新測試檔的 glob;原 glob 79.32%,見上)。
2. G-a 到 G-g 對應 mutant 逐一被殺:**G-a、G-b、G-c(open 之前)、G-d、G-g 殺掉;G-f 的第 94 行三個確認等價;未殺的有三處**:G-e(第 84 行,單元層缺口,API 層到不了)、G-c 的 prereq「沒有目前卡」(第 223 行 `&&`/`|| false`)、G-f 的第 93 行 `title` 型別。三處都低,建議之後順手補一條單元測試(G-e 一條就夠:上面的 `a/../../x`)。
3. 其餘存活者都在等價/低清單內:**是**。

## 使用者資料前後(第二輪,只記數字)

| | 檔案數 | 雜湊 | 帳本行數 |
|---|---|---|---|
| 前 | 64 | c2e4dd6d71de3976 | 108 |
| 後 | 64 | c2e4dd6d71de3976 | 108 |

## 結論

通過(第二輪;三處低缺口 G-e、G-c 的 prereq 無目前卡、G-f 的 title 型別未殺,交顧問判是否要補)
