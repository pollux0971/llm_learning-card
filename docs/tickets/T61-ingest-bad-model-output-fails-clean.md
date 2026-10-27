---
id: T61
deps: []
touches: [packages/core/src/ingest/errors.ts, packages/core/src/ingest/generate-cards.ts, packages/core/src/ingest/children.ts, packages/core/src/ingest/ingest.ts]
cpu: light
budget_usd: 1
status: todo
owner: worker-grok
must_catch:
  - ingest.cards 回應不是合法 JSON 時 runIngest 還丟錯(沒有回 ok false) 壞 JSON 那條必須紅
  - 回應不是陣列、或某一筆欄位型別不對時還丟錯 那兩條必須紅
  - regenerate 回應壞掉時還丟錯 regenerate 那條必須紅
  - 失敗訊息超過一行,或印出堆疊(以 at 開頭的行) CLI 那條必須紅
  - examples 有非字串元素時寫了任何一張卡,或寫了 ingested.json 非字串那條必須紅(比 cards 與 state 前後)
  - 子卡回應 examples 有非字串元素時留下子卡檔 子卡那條必須紅
  - 掃描時一個檔的回應壞掉就整個停下,後面的檔沒處理 掃描那條必須紅
  - 把別的錯也吞成失敗(router 丟的一般錯誤、GraphFileCorruptError、fs 錯誤) 既有的照丟測試必須紅
  - 實作動到 touches 以外的檔 不動的地方那條 diff 必須有輸出
---

# 工單 T61:ingest 遇到格式不對的模型回應,乾淨地失敗、一張都不寫

> 狀態:起草 2026-10-27,依協調者 2026-10-27 的交代(低優先小票的 (b) 與 (c);(a) 測試封閉性在 T60)。規格:UI/Tauri 負責人(代筆)。編號 T61:協調者同意可拆。
> 實作:worker(opencode + grok-4.7);紅測試:測試 agent;驗收:驗收 agent。LLM 真呼叫 0。**不改契約**、不改 `prompts/`(不跑 golden)。

## 為什麼有這張

兩件事,都是「模型回來的東西格式不對」:

### (b) 壞 JSON 印出堆疊(**量過**)

用假 router 回三種壞回應,`runIngest` 三種都**丟錯**,不是回 `{ ok: false }`:

- 不是 JSON → 「ingest.cards 回應不是合法 JSON: …」;
- 不是陣列 → 「ingest.cards 回應必須是陣列」;
- 某一筆欄位型別不對 → 「ingest.cards 回應第 0 筆格式不正確: …」。

三種都沒有寫任何卡,磁碟是乾淨的。可是:

- `packages/core/src/ingest/ingest.ts` 第 91 行把錯原樣往外丟,`scripts/ingest.ts` 最後的 `main().catch` 印 `err.stack`。使用者看到的是一整段堆疊。
- **掃描**(不給 `--file`)的迴圈在 `packages/core/src/ingest/scan.ts` 第 460 行:`runIngest` 回 `ok: false` 會記下來、處理下一個檔;**丟錯就整個掃描停下**,後面的檔都沒處理。

T55 的主題生成已經是乾淨的做法:一句說明,只留錯誤訊息第一行,不帶堆疊(`packages/core/src/ingest/topic.ts` 第 258 行的 `topicCallFailed`)。

### (c) examples 裡有非字串元素:寫到一半(**量過**)

T58 工單的 F2。`packages/core/src/ingest/generate-cards.ts` 第 188 行與 `packages/core/src/ingest/children.ts` 第 116 行只檢查 `Array.isArray(r.examples)`,不檢查每個元素是不是字串。今天:

- **第 0 層**:回應兩筆,第二筆的 `examples` 是 `[42]`。結果:
  - 第一張卡**已經寫了**;
  - 寫第二張時 `example.trim is not a function`(TypeError);
  - `state/ingested.json` 沒寫。
  再跑一次會當成沒處理過,第一張卡會再寫一份(新的 id)。
- **子卡**:同樣的回應給 `generateChildrenForCards`,第一張子卡**已經寫了**才丟 TypeError。`runIngestPipeline` 接住、記一筆「子卡產生失敗,已略過」的 warning(`ingest.ts` 第 322 行),但那張子卡留在 `cards/` 裡:沒有考題檔、不在依賴圖裡。

`regenerate` 的 `adoptableExamples`(`generate-cards.ts` 第 236 行)有逐個檢查;主題生成(`topic.ts` 第 116 行)是濾掉非字串。只有上面兩處沒檢查。

## 要的結果

1. **新錯誤類別** `ModelResponseFormatError extends Error`(`packages/core/src/ingest/errors.ts`,`name` 設成 `'ModelResponseFormatError'`)。
2. **解析的地方改丟它**,訊息文字不變:
   - `generate-cards.ts` 的 `parseCardCandidates`:不是 JSON、不是陣列、某一筆格式不正確;
   - `generate-cards.ts` 的 `parseRegenerated`:不是 JSON、不是陣列、沒有卡片、格式不正確;
   - `children.ts` 的 `parseChildCandidates`:不是 JSON、不是陣列、筆數不對、某一筆格式不正確。
3. **examples 逐個檢查**:`generate-cards.ts` 第 188 行與 `children.ts` 第 116 行的條件加上「每個元素都是字串」。不是就是「格式不正確」(D1)。這樣檢查發生在寫任何檔**之前**。
4. **`runIngest` 接住它**(`ingest.ts` 第 85–92 行那個 `try`/`catch`):
   - `err instanceof ModelResponseFormatError` → `fail('模型回應格式不對,沒有寫任何卡:' + 訊息的第一行, 1)`。
   - 其他錯**照丟**:router 丟的一般錯誤、`GraphFileCorruptError`、fs 錯誤。它們是程式錯或磁碟問題,不是模型的錯,堆疊要留著。
5. **CLI 不用改**:`scripts/ingest.ts` 的單檔路徑本來就印 `result.message`、用 `result.exitCode` 結束;掃描路徑本來就把 `ok: false` 收進失敗清單、繼續下一個檔。

子卡那邊不用另外接:`parseChildCandidates` 在寫子卡之前就丟,`runIngestPipeline` 原本的 `catch` 照樣記 warning、略過,只是不再留下寫到一半的子卡。deepen 用同一個 `generateChildren`,它對一般錯誤回 `failed`,`ModelResponseFormatError` 是 `Error` 的子類別,行為不變。

## 紅測試(測試 agent)

- **單元**(建議 `packages/core/src/ingest/t61-bad-model-output.test.ts`),學習資料夾用暫存目錄、假 router:
  - 壞 JSON、不是陣列、欄位型別不對:各一條。`runIngest` 回 `ok: false`、`exitCode: 1`;訊息以「模型回應格式不對」開頭、只有一行;`cards/` 與 `state/` 的樹雜湊前後一樣。
  - regenerate 回應壞掉(第一次回超過 100 字的卡,regenerate 回壞 JSON):回 `ok: false`,一張都不寫。
  - 非字串 example(第二筆 `[42]`):回 `ok: false`,`cards/` 一張都沒有,`state/ingested.json` 不存在。
  - 子卡非字串 example:`generateChildrenForCards` 丟 `ModelResponseFormatError`,`cards/` 沒有子卡檔。
  - 掃描:兩個新 raw 檔,第一個的回應壞掉、第二個正常。第二個照樣處理(卡寫了、進 `ingested.json`),失敗清單有第一個。
- **照丟的不能被吞**:`packages/core/src/ingest/ingest.test.ts` 第 198 行(router 丟一般錯誤要原樣丟)、`t53-scan-extra.test.ts` 第 49 行、`t55-topic-failures.test.ts` 第 257 行那幾條既有測試要還是綠。另加一條:`GraphFileCorruptError` 照丟。
- **CLI**(建議放 `features/support/`):起 `scripts/ingest.ts --file …`,用 `features/steps/_fake-cloud.mjs` 的做法換掉 `globalThis.fetch`,讓 `ingest.cards` 回壞 JSON。斷言:
  - 退出碼 1;
  - 輸出有「模型回應格式不對」;
  - 沒有以 `at ` 開頭的行;
  - `cards/` 前後一樣。
  假雲端要多一個「回壞 JSON」的開關:改 `_fake-cloud.mjs` 是測試 agent 的事。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 單元 | `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/ packages/core/src/prompt-quality/ features/support/word-count-vectors.test.ts features/support/t57-example-fence-guards.test.ts`,加上 T61 的新測試檔 | 全綠 |
| 守門 | `npm run typecheck`、`npm run boundaries` | 全過;例外條數不變 |
| 不退步 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@ingest-pipeline and not @manual and not @llm' --format summary`;`--tags '@teach-card and @phase-3 and not @manual and not @e2e'` | 全綠(重活,拿位子) |
| 變異 | `npm run mutate -- stryker.t61-bad-model-output.json`(驗收 agent 加,`mutate` 放 `ingest.ts` 的那個 `catch`、`generate-cards.ts` 與 `children.ts` 改到的那幾行) | ≥ 80%;存活的逐條說明 |
| 真資料 | `learning/` 前後量檔案數、整體雜湊、帳本行數 | 三項相同(測試全部用暫存目錄) |
| 不動的地方 | `git diff --stat <紅測試分支的 tip>..HEAD -- contracts docs prompts packages/core/prompts 'features/**/*.feature' scripts packages/core/src/ingest/card-file.ts packages/core/src/ingest/topic.ts packages/core/src/ingest/scan.ts packages/core/src/ingest/deepen.ts packages/core/src/llm` | 沒有輸出 |

**改壞證明**(驗收 agent):

- `catch` 改回 `throw err` → 壞 JSON 那三條與 CLI 那條紅;
- `catch` 改成接住所有錯 → 照丟的那幾條紅;
- 拿掉「每個元素都是字串」 → 非字串那兩條紅(第 0 層寫了一張、子卡留一張);
- 訊息改成整個 `err.message`(含多行) → 只有一行那條紅。

## 受保護的檔(開發 worker 不改)

- 測試、`features/**`(含 `_fake-cloud.mjs`)、`.feature`、`contracts/`、`docs/`、`prompts/`。
- `scripts/ingest.ts`、`card-file.ts`(T58 剛定)、`topic.ts`、`scan.ts`、`deepen.ts`、`packages/core/src/llm/`。

## 落點

- `packages/core/src/ingest/` → 02-ingest-pipeline。
- R2:跟 T59(03-llm-router)、T60(11-review-cli、infra)不相交,可以同時做。

## 待顧問決定

- **D1:非字串元素要「整筆拒絕」還是「濾掉」。**
  - **拒絕(建議)**:跟同一行的 `title`、`body` 型別檢查一致。模型沒照格式回,就大聲失敗,不默默少一個例子。加上這張的 (b),拒絕就是一句話的失敗、一張都不寫。
  - **濾掉**:跟主題生成(`topic.ts` 第 116 行)一致。卡照寫,只是少一個 example,沒有人會知道。
  - 主題生成那邊這張不改。要統一的話另開票。
- **D2:CLI 的 `main().catch` 要不要也只印訊息。** 這張不改:會走到那裡的只剩程式錯與磁碟問題,堆疊有用。

## 觀察(給協調者與顧問,不在範圍)

- **F1:`scripts/ingest.ts` 的真呼叫不經過驗證過的帳本、也沒有當日上限。** 兩條路(第 193 行的 `--file`、第 112 行的掃描)都是直接 `new LlmRouterImpl({ logPath: join(absOut, 'state/log.jsonl') })`:
  - 不是 `createLiveGatewayRouter`,所以 `LLM_DAILY_CAP_USD` 擋不到 ingest;
  - 花費記在 `--out` 那本,不是指標檔驗證過的那本。
  T5 工單把「`--out` 是使用者明講的參數」列為不在範圍(同 ADR-051)。但契約 §12(1.4.0)寫的是:任何會花錢的程式,明確參數只能改**輸出**位置,不能改帳本位置。ingest 又是最貴的 task。起草者建議開一張票,由顧問判斷算不算違反 §12。這張不碰。
- **F2:掃描有檔失敗時,退出碼還是 0**(`scripts/ingest.ts` 的 `finishScan` 只看 `refused` 與 `cloudBlocked`)。這是今天就有的行為(空檔案等失敗也一樣),這張不改。

## 預算

`budget_usd: 1`(一個錯誤類別、三個解析函式、一個 `catch`;grok 不設停止線,只記錄)。LLM 花費 0。`cpu: light`。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 分支順序:main `d64b1d5` → 這張工單 → 測試 agent 的紅測試 → 開發 worker 的實作。

## 起草時量的(只讀;丟棄式腳本在前端的暫存區,不進 git)

- 假 router 回三種壞回應:`runIngest` 三種都丟 `Error`,`cards/` 0 張。
- 第 0 層第二筆 `examples: [42]`:丟 TypeError,`cards/` 留 1 張,`ingested.json` 沒寫。子卡同樣的回應:丟 TypeError,留 1 張子卡檔。
- 丟棄式實作(上面 1–4):
  - `packages/core/src/ingest/`、`packages/core/src/prompt-quality/` 與 6 個 `features/support/` 檔共 1163 條全綠,型別檢查 0 錯;
  - 三種壞回應與非字串都回 `ok: false`、0 張;子卡 0 張;
  - 量完 `git checkout` 還原,工作樹乾淨。
