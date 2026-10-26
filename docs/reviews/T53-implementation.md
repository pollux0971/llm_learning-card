# T53 實作報告

環境檢查(開工第一件事,原文):

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

兩個 key 都是 UNSET。.env 不存在。沒有建立 .env,沒有使用任何 provider 金鑰,LLM 真呼叫 0 次(測試與 CLI 的 --fake 都走假 router)。

## 合併

協調者補測之後,先在本分支執行 `git merge --no-ff t53-start2`。只加了 packages/core/src/ingest/t53-scan-buckets.test.ts,並小改 t53-test-support.ts(Counting 多了 probes)。沒有衝突。合併 commit:3630935。

補測釘的三條都做了:

1. 一個 raw 檔只落一個桶。skipped 只放已處理且 sha 相同的。內容變了的只進 staleCards(訊息裡有張數),不進 skipped。刪了的不進 skipped、不進 processed,只進 missingSourceCards。
2. 沒有新檔要生成時不呼叫 probeOnline、不呼叫 LLM。拒絕(分類沒定義、要求 raw)也不探測。CLI 不帶 --fake、沒有金鑰、沒有新檔,只標 stale,退出碼 0,不印「需要雲端 / requires a cloud」。
3. 結果多 unconfiguredFolders。不給 category 的掃描列出 raw/ 第一層、不在設定裡的資料夾名字(含空資料夾,排序後)。不含 raw/ 直接放的檔、不含已設定的分類。沒有時是空陣列。不處理、不建 cards/<它>。

## 做了什麼

新增 packages/core/src/ingest/scan.ts,由 packages/core/src/ingest/index.ts 第 13 行匯出 runIngestScan。選項是 outDir、router、category?、topic?、today?、levelZeroOnly?。levelZeroOnly true 只跑既有的 runIngest(level 0);沒給就跑 runIngestPipeline。

分類規則在 scan.ts 第 339–350 行,拒絕時不建骨架、不寫設定、不呼叫 LLM:

- 分類沒設定,或不合法(不拿去拼路徑):refused category_undefined,訊息含「沒有定義」。
- 要求 raw、沒有可處理的 raw、給了主題:requires_raw,訊息含「要求 raw」。
- 不要求 raw、沒有 raw、給了主題:topic_not_implemented,訊息含「還沒做」。什麼都不寫。
- 有可處理的 raw 又給主題:照 raw 跑,topicIgnored true,訊息含「被略過」。卡的 source 仍是 raw(走既有 runIngest)。

可處理的 raw(scan.ts 第 109 行 listCategoryRaw):第一層、副檔名 .md、不以 . 開頭、一般檔。符號連結不跟,記在 skippedLinks。解析後不在 raw/<分類>/ 裡的記在 outsideCategory,不處理(第 95 行 resolvedInsideCategory)。掃描不寫 raw/。

增量(第 379–403 行):ingested.json 沒有的檔才生成。sha 相同進 skipped,卡一個位元組都不動。sha 不同只標 stale,不更新 sha,不重新生成。檔案不見只標 source_missing,卡和考題都留著。

標記(第 216 行 markFlagText):純文字。在 frontmatter 結尾那一行 --- 前面插一行 `key: true`,用檔案原本的換行(LF 或 CRLF)。頂層已經是 `key: false` 就只換那一行。已經是 `key: true` 不再寫檔(位元組與 mtime 都不變),仍算進張數。引號、yes、縮排等看不懂的不改,報在 unreadableFlags。卡檔不見不重建。寫卡檔走 01 的 writeFileAtomic(第 252 行 applyFlag 呼叫)。事件走既有 appendLogEvent → appendLineAtomic,type 只用 warning(契約 §10 已有)。不自己 writeFileSync。state/ingested.json 在只標旗標時不重寫。

沒有新檔時不探測(第 418 行:pending 空就不會呼叫 probeOnline)。有新檔才探測一次;探測失敗不呼叫 LLM,結果帶 cloudBlocked,CLI 退出碼 1。

scripts/ingest.ts:

- 不給 --file 就是掃描 / 主題跑法(--out、--category、--topic)。拒絕或 cloudBlocked 退出碼 1,其餘 0。--fake 傳 levelZeroOnly true。CLI 不在掃描前先 probeOnline(第 91 行 runScanCli)。
- --file:分類不存在才 setCategory(require_raw true)並印「新建分類 <id>(require_raw: true)」(第 155 行)。已存在不覆寫 name、require_raw。同名同內容不複製(mtime 不變)。同名不同內容拒絕,退出碼 1,印出檔名,不覆寫、不呼叫 LLM。

listCategories 加在 packages/core/src/ingest/init.ts 第 56 行,只讀。沒有改 boundaries.owners.json:新檔落在 packages/core/src/ingest/,已在落點內。

沒做場景 2(主題生成,T55)。沒動 prompts/、contracts/、schema/、scheduler/、standalone.json、測試檔、.feature。

## 跑過的指令與輸出原文

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/t53-scan-routing.test.ts packages/core/src/ingest/t53-scan-incremental.test.ts packages/core/src/ingest/t53-scan-flags.test.ts packages/core/src/ingest/t53-cli.test.ts packages/core/src/ingest/t53-scan-buckets.test.ts
```

```
 Test Files  5 passed (5)
      Tests  48 passed (48)
   Start at  16:12:45
   Duration  13.25s (transform 412ms, setup 105ms, import 1.73s, tests 10.79s, environment 0ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/
```

```
 Test Files  25 passed (25)
      Tests  469 passed (469)
   Start at  16:13:02
   Duration  27.77s (transform 637ms, setup 324ms, import 4.72s, tests 19.58s, environment 3ms)
```

```
npx tsc --noEmit && npx tsx scripts/check-doc-links.ts
```

tsc 沒有輸出(退出碼 0,後面的 && 才接著跑)。doc-links:

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 290 個 markdown 檔,154 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=154
```

```
npm run boundaries
```

```
boundaries: 掃描 386 個檔案,允許例外 24 條
涵蓋:納管 442 / 掃描 442 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=386
```

沒有跑 cucumber(留給驗收)。沒有跑變異測試。沒有跑 check:all。

## 待協調

- 有新檔要生成、但 probeOnline 回 false(或丟錯)時:不呼叫 LLM,結果 cloudBlocked,CLI 退出碼 1,訊息沿用既有的「ingest requires a cloud model,目前偵測不到可用的雲端模型,不會降級到本機模型。」。補測只釘「沒有新檔不探測、退出碼 0」和「有新檔才探測」,沒釘探測失敗的退出碼。若要改成別的退出碼或訊息,再說。
- 給了 category 時 unconfiguredFolders 固定空陣列。補測寫的是「不給 --category 的掃描列出」。若指定分類時也要列出別的未設定資料夾,再說。
- 分類資料夾本身若是符號連結:不跟,記在 skippedLinks(路徑 raw/<分類>)。測試沒構造這個。
- 卡檔本身若是符號連結:不當一般檔寫進去,當成卡檔不見、不重建。測試沒構造這個。
