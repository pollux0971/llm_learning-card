# 驗收證據:T64(cucumber 行程的 XDG_CACHE_HOME 指暫存目錄)

- 被驗分支:t64-red,fd77fc2c97c3f726e09c712ef62b291f03978a9b(基底 86cd909)
- 開跑與跑完的 tree sha(筆電、i9 一致):d579b9245c6bf23e40444d796027269cdb8597f9
- 日期:2026-10-27。LLM 花費 0。沒有開發 worker(只有測試支援層)。
- 沒有 `.env`(兩台的簽出都 `ls .env` 失敗)。

## 1. 測試作者與範圍

- 基底到分支只有 1 個 commit,3 檔新增(164 行):features/support/hermetic-cache.ts、features/steps/_hermetic-cache.ts、features/support/hermetic-cache.test.ts。
- 對 packages、apps、scripts、contracts、prompts、所有 .feature、vitest.config.ts、cucumber.js 的 diff:無輸出。
- 該 commit 的 tracked 檔裡沒有 mutants 輸出夾(計數 0)。

## 2. 筆電:單元 + 型別 + 邊界

- 單元:1 檔 11/11 過。tsc 無輸出。boundaries PASS(掃 407 檔)。

### 自選改壞(只改 hermetic-cache.ts,單元測試)

| # | 改法 | 結果 |
|---|---|---|
| M1 | 還原時一律刪鍵(原本有值也刪) | 紅 3 |
| M2 | 原本已有值就不覆蓋 | 紅 1 |
| M4 | restore 不刪目錄 | 紅 2 |
| M5 | 「原本有沒有設」改用真值判斷(空字串被當沒設) | 紅 1 |
| M6 | 拿掉重複呼叫保護 | 紅 1 |
| M8 | 暫存目錄建在目前工作目錄而非 tmpdir | 紅 1 |
| M9 | 目錄名固定(不唯一) | 紅 3 |
| M10 | rmSync 不遞迴 | 紅 7 |
| M11 | 原本沒設時還原成字串 undefined | 紅 3 |
| M12 | 順手也設 XDG_CONFIG_HOME | 紅 2 |

10/10 紅,每次還原後檔案乾淨。

## 3. i9(空 HOME,env 清掉 XDG_CACHE_HOME、XDG_CONFIG_HOME、NO_COLOR、DBUS)

跑法:tags 加 "not @manual";cucumber 從 npm 腳本外直接呼叫;HOME 是我自己 mktemp 的暫存目錄,跑完只刪自己建的。

### 歸因(A 基底 vs B 改後,tags "@i2 and not @manual")

| 跑 | 場景 | HOME 下 .cache/llm-learning-cards 項目 | tmp 下 lc-cucumber-cache- 前→後 |
|---|---|---|---|
| A 基底 | 93 過 | 8(全是 uuid 名,0 個 path- 名) | 0→0 |
| B 改後 | 93 過 | 0 | 0→0 |

基底的 8 個符合工單預期(接近 9;T60 那次全套是 9,差一個是全套多了別的 tag 場景或隨機,不影響結論:這一組 @i2 就佔 8)。

### 全套(tags "not @manual",改後)

| 跑 | 場景 | HOME 下 .cache/llm-learning-cards | tmp 下 lc-cucumber-cache- 前→後 |
|---|---|---|---|
| C 全套 | 787:723 過 / 1 敗 / 63 undefined | 0 | 0→0 |
| D 全套 + 哨兵指標 | 787:723 過 / 1 敗 / 63 undefined | 0 | 0→0 |

- 與 T60 基準(720/1/66)的差:過 +3、undefined −3,正是 T65 合併後 05-grading phase-3 場景 7–9 由 undefined 變過(工單預期 723/1/63),一致。
- 唯一敗:05-grading phase-4.feature 第 7 行(phase-4 還沒做),跟基準同一個。
- 全套步驟:3636 步(1 敗、259 undefined、34 skipped、3342 過)。
- 指標檔哨兵(D):XDG_CONFIG_HOME 指到有效的指標檔,指向一本哨兵帳本(vault-id + 1 行 log)。哨兵樹雜湊前後相同(d59cb9e0855f6df6 → d59cb9e0855f6df6),log 行數 1 不變。沒有場景讀或寫機器指標指到的帳本。
- HOME 下 .cache 沒有其他項目(連 Chrome 的 fontconfig 都沒出現)。

### hook 層改壞(i9,@i2 子集;只改 features/steps/_hermetic-cache.ts,單元測試碰不到這層)

| # | 改法 | HOME 下 uuid 資料夾 | tmp 殘留 | 判定 |
|---|---|---|---|---|
| H1 | 拿掉 BeforeAll 的 install | 8(回到基底) | 0 | 抓到(多出 uuid 夾) |
| H2 | AfterAll 不呼叫 restore | 0 | +1 | 抓到(tmp 殘留列) |
| H3 | BeforeAll 裝兩次(第一個沒人還原) | 0 | +1 | 抓到(tmp 殘留列) |

注意:H2、H3 的 93 個場景都照樣全過;只有「HOME 下項目數」與「tmp 殘留」這兩個量法抓得到,場景結果本身分不出。所以這兩條量法要留在驗收條件裡,測試套件不會替你守。殘留的 2 個暫存夾是這兩個改壞留下的,我辨認前綴後刪掉,i9 的 tmp 下最後 0 個。

## 4. 工單裡 i2-review-loop 的 childEnv 沒設 XDG_CACHE_HOME 那一點

照工單處理(不改步驟檔)。B、C、D 的結果證明 childEnv 從 process.env 帶下去後確實落在暫存目錄:HOME 下 0 項。

## 5. 小觀察(不擋)

- 只有「HOME 下沒東西」與「tmp 殘留 0」兩個量法能抓 hook 層漏洞(H2、H3 場景不紅),單元測試碰不到 hook 檔。建議以後有人動 features/steps/_hermetic-cache.ts 就要重跑 @i2 子集兩列(約 4 分鐘)。
- 目前沒有任何測試釘住 hook 檔本身存在或被載入(cucumber 的 import 範圍是 features/steps 全部,會自動載入;沒有守門,刪檔不會紅單元)。H1 只靠量法抓到。

## 6. 資料前後

- 筆電 learning/:64 檔 / e31b011a670e1a0f / 帳本 114 行(跑後;與 handoff 記錄的基準一致;我的工作只在 i9 與獨立簽出,沒有進 learning/)。
- 筆電 ~/.cache/llm-learning-cards 頂層項目:497(不變)。
- 沒有寫真的指標檔。

## 7. 清理

- 筆電簽出、i9 的兩個簽出、暫存分支與引用、i9 暫存檔都已移除(i9 /data/python/wt 下 t64 開頭 0 個;git worktree 清單 0 個)。

## 結論

通過,沒有阻擋項。
