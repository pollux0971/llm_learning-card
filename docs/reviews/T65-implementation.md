# T65 實作報告:縮短版生成

開工三行(同一條指令裡還印了工作目錄;兩個 key 都是 UNSET,.env 不存在):

```
UNSET
UNSET
/home/pollux/orca/workspaces/llm_learning-cards-workers/t65-opencode
ls: cannot access '.env': No such file or directory
```

## 做了什麼

只改工單 touches 的六個檔。沒有改測試、契約、features、llm、ingest 實作,也沒有新的 boundaries 登記(新檔都落在既有目錄前綴底下;boundaries 掃完仍是 26 條例外)。

1. packages/core/src/grading/reteach-short.ts(新):generateShort。prompt 用 join(import.meta.dirname, '../../prompts/grading/reteach-short.md') 讀(第 27 行)。寫卡只 import ingest/card-file.js 的 renderCardFile。每一次:JSON 要有 trim 後不空的 body 與 example(多的鍵忽略);renderCardFile 組檔再用 parseCardText 讀回,examples 剛好 1 個且那個 example 跟模型給的 example trim 後一樣,否則算格式壞(第 78–91 行);字數用 countWords 量讀回的 body。字數小於或等於 shortLimit 就停。都太長留最短(字數相同留先出現的那次),記 warning reason reteach_short_overlong,words 帶格式好的那幾次的字數。三次都格式壞回 failed、記 reteach_short_bad_response,不寫檔、不進佇列。第 2 或第 3 次 NoModelError:已有格式好的結果就從那些裡面挑,attempts 記實際呼叫次數;一個都沒有回 no-model。其他錯誤原樣丟出。寫檔路徑是 cards/分類/id.short.md,frontmatter 照抄原卡、provisional 等於留下那一次,經過 writeFileAtomic。寫完才 enqueue 一次,而且只有留下的那次是 provisional 才進佇列;沒給 queue 就用 provisionalQueuePath(learningDir)。
2. packages/core/src/grading/index.ts 第 6 行:匯出 generateShort。
3. packages/core/prompts/grading/reteach-short.md(新):只回 JSON {"body","example"},要求縮短、剛好一個例子、body 裡不要放圍欄。上限數字不寫死,由程式在送出的 prompt 裡帶 上限: N。範本裡沒有「上一次」這三個字,避免第一次的 prompt 被重試那一行的判準誤傷。
4. packages/core/src/prompt-quality/golden-sets/registry.ts:reteach.short 登記在 ingest.deps 後面、selftest 前面(第 348 行)。輸入 header 是 golden / category / title / limit: 50 四行,後接原卡 body 與 examples。不 import ingest/。
5. packages/core/src/prompt-quality/types.ts 第 73 行:GoldenSetId 加 reteach.short。
6. packages/core/src/prompt-quality/structural-checks.ts 第 28–44 行:typeof example === 'string' 走縮短版形狀,不要求 title,body 上限 50,超過記 body-too-long、detail 寫 50。一般卡那一段(要 title、上限 100)沒改判斷。

呼叫端:git grep generateShort,生產碼只有新檔自己;既有呼叫是單元測試與 features/steps/grading-phase3.steps.ts(測試 agent 寫的,這張不改)。checkCardShape 只有同檔 walk 呼叫。沒有要改的其他呼叫端。

## 跑過的指令與輸出原文

前置:worktree 沒有 node_modules,用 tar 從 /data/python/llm_learning-cards 複製(排除 .vite、.vite-temp、node_modules/node_modules;含 apps/teach-card、apps/test-card、packages/ui-shared 的 node_modules;不用 symlink)。沒有跑真 LLM、沒有 --live、沒有不帶 --fake 的 scripts/ingest.ts、沒有 cucumber、沒有變異、沒有 check:all。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/grading/reteach-short.test.ts features/support/t65-grading-imports.test.ts features/support/t31-static.test.ts packages/core/src/prompt-quality/
```

```
 Test Files  27 passed (27)
      Tests  548 passed (548)
   Start at  16:54:38
   Duration  18.64s (transform 579ms, setup 249ms, import 3.87s, tests 11.98s, environment 2ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/grading/
```

```
 Test Files  7 passed (7)
      Tests  279 passed (279)
   Start at  16:55:00
   Duration  2.20s (transform 240ms, setup 86ms, import 956ms, tests 513ms, environment 1ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsc --noEmit
```

無輸出,命令成功結束。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run boundaries
```

```
boundaries: 掃描 407 個檔案,允許例外 26 條
涵蓋:納管 465 / 掃描 465 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=407
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run check:json-duplicate-keys
```

```
✓ 47 個 JSON 設定檔沒有同層重複鍵
gate=json-duplicate-keys result=PASS scanned=47
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsx scripts/check-doc-links.ts
```

```
doc-links: 掃描 328 個 markdown 檔,174 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=174
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsx scripts/prompt-check.ts --golden --set reteach.short
```

預設是 fake(沒有 --live)。退出碼 0。輸出:

```
✓ golden run reteach.short → /home/pollux/orca/workspaces/llm_learning-cards-workers/t65-opencode/packages/core/src/prompt-quality/golden-fake/reteach.short/2026-10-27(3 個輸入)
golden run 完成:處理了 3 個 golden 輸入
EXIT:0
```

golden-fake/ 在 gitignore,沒有進 commit。沒有寫進 golden 基準目錄。

## 待協調

- 重試那一行:工單寫第二次與第三次的 prompt 最後一行是「上一次 N 字,上限 L」,N 是上一次讀回 body 的字數。前一次在來回檢查之前就格式壞(不是 JSON、空欄位)時沒有讀回的 body,這份實作不加那一行,也不發明一個 N(packages/core/src/grading/reteach-short.ts 第 57–61 行、第 131 行)。現有紅測試只在前一次格式好但太長時檢查這一行。若要這種情況也加一行,請指定 N 用什麼。
- 來回檢查失敗(讀得到 body,但 examples 不是剛好一個或內容對不上)時,下一次的 N 用的是那次讀回 body 的字數。工單的定義是這樣;測試沒有單獨釘這條。
- cucumber 場景依煞車沒跑。步驟定義呼叫的是同一個 generateShort。場景驗收不是這張的事。
- live golden 與人工評分不是這張的事。
