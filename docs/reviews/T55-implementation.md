# T55 實作報告

環境檢查(開工第一件事,原文):

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

兩個 key 都是 UNSET。.env 不存在。沒有建立 .env,沒有使用任何 provider 金鑰,LLM 真呼叫 0 次(測試全走假 router;沒跑 --live,沒跑 golden 真呼叫)。

## 做了什麼

沒有 raw、分類不要求 raw、給了主題時,不再回「還沒做」,改走主題生成。

- 新增 packages/core/src/ingest/topic.ts。正規化在第 67 行(trim、Unicode NFC、連續空白併成一個空白)。長度在第 76 行用 code point 數,不是 UTF-16。空的或超過 200 在第 250 行拒絕(topic_invalid),不探測、不呼叫 LLM、不寫檔。200 過、201 拒。
- 鍵是 topic:分類:sha256(正規化主題),第 86 行。值的 sha256 就是鍵裡那個 sha,cardIds 是這次寫出的 level 0 id,processedAt 是 ISO 時間。寫入走既有的 atomicWriteJson(裡面是 writeFileAtomic)。不准另開 state/ 新檔。
- 同一個分類、正規化後同一個主題再跑:第 258 行略過,訊息含「已經生成過」並列出卡 id,不探測、不呼叫 LLM、不重寫 ingested.json。
- 要生成才探測。探測失敗回 cloudBlocked,不寫卡、不記主題(第 263 行)。
- 主題回應沒有 lines,自己解析(第 103 行),沒有改 parseCardCandidates。body 超過 100 字走既有的 enforceWordLimit(regenerate.md 沒動)。超過 5 張只留前 5,並寫一筆 warning,訊息含原來的張數(第 293 行)。0 張或全部暫緩回 topic_failed,不寫卡、不記主題鍵。暫緩的仍寫既有的 state/needs-review.json。
- 寫出的卡:level 0、source llm、沒有 source_ref、created 用呼叫端給的今天、prereqs 空。id 照 nextCardIds。卡檔走 writeFileAtomic(第 168 行)。
- 不是 levelZeroOnly 時,寫完接既有的考題、子卡、依賴圖(第 188 行起)。task 仍是 ingest.cards,沒有新的 LlmTask。
- packages/core/src/ingest/scan.ts 第 347 行起,在「不要求 raw、沒有可處理的 raw、給了主題」這條改呼叫主題生成。第 401 行掃描迴圈先跳過 topic: 開頭的鍵,stale 與 source_missing 都不會把主題鍵當成 raw 路徑。isDirectRawKey 的分類前綴檢查還在。
- packages/core/src/ingest/index.ts 第 14 行匯出 topic.ts。
- 新增 packages/core/prompts/ingest/topic.md(含「主題」、超過 200 字元;字數規則、一張卡一個概念、examples 不重複 body、只回 JSON 陣列照 cards.md 能照抄的部分;輸入是一行主題、1–5 張、不要 lines、只寫一般公認的知識)。其他 prompt 檔沒有改。
- packages/core/src/prompt-quality/types.ts 第 68 行 GoldenSetId 加 ingest.topic。登記表 packages/core/src/prompt-quality/golden-sets/registry.ts 第 242 行,排在 ingest.cards 後面(第 309 行)。task 是 ingest.cards,promptFile 是 topic.md。三個輸入自己組 header(golden、category、topic 各一行),不 import ingest/。
- scripts/ingest.ts 沒改。既有的掃描 CLI 已印 result.message;refused 或 cloudBlocked 退出碼 1,其餘 0。已經生成過的訊息與卡 id 都在 message 裡,CLI 測試過了。

沒動 contracts/、其他 prompts/、schema/、scheduler/、raw/、測試檔、.feature。沒跑 cucumber,沒跑變異,沒跑 check:all,沒跑 --live。

## 跑過的指令與輸出原文

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/t55-topic-generation.test.ts packages/core/src/ingest/t55-topic-cli.test.ts
```

```
 Test Files  2 passed (2)
      Tests  32 passed (32)
   Start at  18:23:52
   Duration  2.97s (transform 264ms, setup 47ms, import 598ms, tests 2.14s, environment 0ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/ packages/core/src/prompt-quality/
```

(補上契約 Card 型別要求的 provisional / stale / source_missing 之後再跑一次,結果相同。)

```
 Test Files  55 passed (55)
      Tests  1019 passed (1019)
   Start at  18:25:03
   Duration  31.97s (transform 885ms, setup 475ms, import 7.10s, tests 19.30s, environment 4ms)
```

```
npx tsc --noEmit
```

沒有輸出,退出碼 0。

```
npm run boundaries
```

```
boundaries: 掃描 397 個檔案,允許例外 24 條
涵蓋:納管 453 / 掃描 453 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=397
```

```
npx tsx scripts/check-doc-links.ts
```

寫完這份報告之後再跑一次(掃描數多了這份報告):

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 297 個 markdown 檔,154 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=154
```

## 待協調

- topic.md 是新 prompt,硬規則 4 的 golden 真呼叫沒跑。依工單,只由協調者在主簽出跑,這份工作一次都沒跑、沒碰金鑰。
- 全部暫緩時仍寫 state/needs-review.json(工單說暫緩照舊寫),但不寫卡、不記主題鍵。若全部失敗時連 needs-review 都不該留,再說。
- 沒跑 cucumber(留給驗收)。沒跑變異。沒跑 check:all。
