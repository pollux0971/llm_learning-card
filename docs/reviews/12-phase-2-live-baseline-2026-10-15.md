# 12-prompt-quality phase-2:第一次真模型基準與「故意改壞 prompt」實驗(2026-10-15)

> 作者:協調者(執行)與技術顧問(評分)。這份報告對應 `features/12-prompt-quality/phase-2.feature` 最後兩個 `@manual @llm` 場景。
> **phase-2 是否 done 由審核輪/技術顧問判,這份報告不自己標。**

## 1. 第一次真實基準

- 指令(主簽出,只有主簽出有憑證):`npx tsx scripts/prompt-check.ts --golden --set <id> --live`,五組:`ingest.cards`、`ingest.children`、`ingest.regenerate`、`ingest.questions`、`ingest.deps`,各 3 個輸入,共 15 次呼叫。
- 模型 `openai/gpt-5.6-luna`。輸入是 `contracts/fixtures/raw/security-basics.md` 的三個小節(測試素材,不是使用者資料)。沒有改動 `prompts/` 任何檔(硬規則 4 不觸發)。
- 輸出存在 `packages/core/src/prompt-quality/golden/<set>/2026-10-15/`(進 git):每組有 `meta.json`、`prompt.snapshot.md`、三個 `*.output.json`、`SCORES.md`。
- 花費(`llm-spend --today` 前後):$0.0000 → $0.0919(15 次呼叫);上限 $1.0000。各組估計:cards 0.0253、children 0.0246、regenerate 0.0132、questions 0.0235、deps 0.0053,加總與帳本一致。token 進 7241、出 7377。
- 帳本 `learning/state/log.jsonl`:golden run 結束時 52 → 67 行,只在尾端追加,0 行被刪或改。learning/ 檔數 64 不變。(第 3 節的實驗之後是 70 行、雜湊 ee37f9e1fa9193c6;這一節的 15 次 / $0.0919 只含 golden run 本身。)

## 2. 人工評分(技術顧問,15 份輸出逐份讀過)

兩個維度各 1–5:正確嗎 / 是一個概念嗎。已填進五份 `SCORES.md`,下方備註一併寫入。

| set | 輸入 | 正確 | 單一概念 | 備註 |
|---|---|---|---|---|
| ingest.cards | same-origin | 5 | 4 | 第 3 張「不同路徑仍可同源」和第 1 張的定義重疊 |
| ingest.cards | cors | 5 | 5 | |
| ingest.cards | preflight | 5 | 5 | 忠於原文;但素材原文第 28 行「改變伺服器狀態的方法」對預檢觸發條件的說法不精確,是素材的問題,不是模型的 |
| ingest.children | same-origin | 5 | 5 | |
| ingest.children | cors | 5 | 4 | 第 3 張「來源的組成」是前置知識,不是 CORS 的子概念 |
| ingest.children | preflight | 5 | 4 | 第 3 張「快取時間」和父卡 cards-preflight 的第 3 張重複 |
| ingest.regenerate | same-origin | 5 | 3 | 一張卡塞了三、四個子概念(定義加理由加規則) |
| ingest.regenerate | cors | 5 | 3 | 同上 |
| ingest.regenerate | preflight | 5 | 4 | |
| ingest.questions | same-origin | 5 | 5 | 填空 3 的答案只收「不同源」,太窄,「不同來源」「非同源」會被判錯 |
| ingest.questions | cors | 5 | 5 | |
| ingest.questions | preflight | 5 | 4 | 填空 1「有些 ___ 請求瀏覽器不敢直接送」照抄原文,空的答案太模糊 |
| ingest.deps | 三組 | 5 | 5 | |

**總結**:正確性全部 5 分。主要的品質問題有兩個:**父卡和子卡內容重複**(I1-REVIEW 第 8 節的問題還在),以及 **regenerate 一張卡塞好幾個概念**。這份就是之後改 prompt 的回歸基準。

## 3. 「故意改壞 prompt」實驗

- 做法(主簽出):把 `packages/core/prompts/ingest/cards.md` 暫時改壞——標題句「拆成數張『一張卡一個概念』的教學卡」改成「拆成數張教學卡」,並刪掉「一張卡只講一個概念,不要把整節內容塞進一張卡」那一行。**只跑 `ingest.cards` 一組**:`prompt-check.ts --golden --set ingest.cards --live --out <暫存目錄>`。
  用 `--out` 是因為 live run 預設寫進 `golden/<set>/<日期>`,同一天會覆蓋剛 commit 的基準;帳本不跟著 `--out`(T5 / ADR-066),花費照樣記進同一本。
- 做完立刻 `git checkout -- packages/core/prompts/ingest/cards.md`;還原後 porcelain 0、`git diff` 與 `git diff --cached` 都是 0 行。壞掉的 prompt **沒有 commit**。暫存目錄的 `prompt.snapshot.md` 留有壞掉那一版,可對照。
- 花費:$0.0919 → $0.1157(+$0.0238,3 次呼叫)。**當日合計 18 次、US$0.1157**;帳本最後 18 行:前 15 行 ts 11:19:40–11:21:19 UTC 是 golden run,後 3 行 11:24:05–11:24:20 UTC 是這個實驗(tokens 進 1606 出 1979,與實驗輸出的 meta 一致),沒有重跑、逾時或截斷。
- 結果(基準 vs 壞掉的 prompt,卡數 / 平均 body 字數 / 最長 body / examples 數):

| 輸入 | 基準 | 壞掉 |
|---|---|---|
| cards-same-origin | 4 / 27 / 40 / 5 | 3 / 39 / 44 / 5 |
| cards-cors | 4 / 37 / 44 / 4 | 4 / 36 / 43 / 4 |
| cards-preflight | 3 / 34 / 37 / 4 | 1 / 44 / 44 / 1 |

- 判讀:**有可見的方向性變化**——同源少一張、預檢從 3 張縮成 1 張(整節塞進一張),平均 body 變長;CORS 那一組沒變。`prompt-check.ts --diff <基準目錄> <壞掉的目錄>` 逐輸入標出「不同」並列出兩邊全文,人讀得出差別。
- **限制,照實寫**:(1) 每個輸入只跑一次,沒有「同一個好 prompt 再跑一次」的對照組,所以分不出多少差別是模型本身的隨機性;三組裡一組沒變就是例子。(2) `--diff` 只標「不同」,不量化卡數或概念數;上表是我另外算的。(3) **觀察到一個工具缺口(待顧問裁決,我沒有改)**:壞掉那次 run 的 `meta.json` 寫的 `promptFileGitCommit` 仍是 `a2a6669`(乾淨的 commit),沒有標示「這個 prompt 檔有未提交的修改」。也就是說,用有未提交修改的 prompt 跑出來的結果,會被記成像是某個 commit 的基準。原因(讀過程式):`golden-run.ts` 的 `gitCommitOf` 用 `git log -1 --format=%h -- <檔>`,只有「檔案未追蹤或沒有 commit」才回 `uncommitted`;已追蹤但工作樹有修改的檔,會回它最後一次 commit,所以類型註解(types.ts)寫的語意沒有涵蓋「已追蹤但被改過」。

## 4. 沒做的事

- SCORES.md 的後續評分(之後每次改 prompt 的比對)不在這份範圍。
- 沒有跑完整 `check:all` 鏈(這批只動資料檔與文件);跑了的守門見 commit 說明與送審訊息。
