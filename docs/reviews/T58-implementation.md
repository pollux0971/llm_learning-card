# T58 實作報告

日期:2026-10-27。模型:Grok 4.7(opencode)。分支:pollux0971/t58-opencode。
開工 HEAD:ba334e9(merge: T58 紅測試進起點分支)。LLM 真呼叫 0 次。

## 環境(開工第一行)

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

兩個 key 都是 UNSET,`.env` 不存在(ls 退出碼 2)。沒建立 .env,沒使用任何 provider 金鑰。沒碰 learning/、raw/。沒改測試、contracts/、docs/(這份報告除外)、prompts/、.feature、topic.ts、deepen.ts、opencode.json。沒跑變異測試、沒跑 cucumber、沒跑 check:all、沒跑 --live、沒 git push。沒使用 skill,沒登入或登出。

## 做了什麼

契約 §2 與 ADR-082 唯讀,以那兩份為準。沒改契約。畫面、讀的那邊、prompts/ 都沒動。

1. 新增 packages/core/src/ingest/card-file.ts。值 import 只有 yaml(第 5 行 `stringify as yamlStringify`)。沒有 Card 的 import(參數型別已放寬,用不到)。沒有 I/O。
   - 第 19 行 export exampleFenceLength:先 trim,找最長連續反引號串 n(第 9 行 `/`+/g`,行首行中行尾都算,波浪號不算),回 max(3, n+1)。
   - 第 23 行 renderExampleBlock:內容用 trim 過的字,開始行是那串反引號接 example,結束行同樣長。只用反引號,不用字面三反引號接 example。
   - 第 30 行 export renderCardFile,參數是 { frontmatter: object; body: string; examples: readonly string[] }。frontmatter 仍是 yaml stringify 再 trimEnd;body.trim();example 之間空一行;沒有 example 就沒有結尾區塊;檔尾一個換行。其餘格式跟搬走之前那一份一樣。
2. packages/core/src/ingest/children.ts:第 51 行從 ./card-file.js import renderCardFile,第 57 行 export { renderCardFile }。刪掉自己原本那份與用不到的 yaml import。topic.ts、deepen.ts 仍從 ./children.js import,沒改。
3. packages/core/src/ingest/ingest.ts 第 6 行 import,第 214 行 writeCardFile 改成寫 renderCardFile({ frontmatter: fm, body, examples })。拿掉 yaml import。
4. packages/core/src/ingest/deps.ts 第 93 行 import,第 331 行 writeCardFile 改成寫 renderCardFile(card)。拿掉 yaml import。mkdir 與寫檔仍留在這支函式。

boundaries 沒另登記:scripts/boundaries.owners.json 已有 packages/core/src/ingest/ 這個目錄前綴,新檔落在同一個資料夾,import 也是同資料夾,例外條數不變。

呼叫端(含 .mjs、.js;git grep renderCardFile):
- 生產碼:children.ts 轉出並在自己的 writeCardFile 呼叫;topic.ts 第 17 行與第 172 行、deepen.ts 第 16 行與第 192 行仍從 children.js 進來,簽章放寬後 Card 仍可傳,這兩個檔沒改。
- ingest.ts、deps.ts 改為直接 import ./card-file.js。
- packages/core/src/ingest/index.ts 的 export * from children.js 仍轉得出 renderCardFile,沒改那個檔。
- .mjs、.js 沒有呼叫端。exampleFenceLength 只有 card-file.ts 自己用。

## 跑過的指令與輸出原文

worktree 沒有 node_modules。用 tar 從 /data/python/llm_learning-cards 複製(排除 .vite、.vite-temp、node_modules/node_modules;連同 apps/teach-card/node_modules、apps/test-card/node_modules、packages/ui-shared/node_modules;不用 symlink;沒複製 src-tauri/target)。那三個套件目錄排除快取後是空目錄。node_modules 在 .gitignore,沒有 add。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/card-file.test.ts packages/core/src/ingest/t58-card-fence-wiring.test.ts features/support/t58-card-file-guards.test.ts features/support/word-count-vectors.test.ts
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t58-opencode


 Test Files  4 passed (4)
      Tests  80 passed (80)
   Start at  08:34:55
   Duration  4.53s (transform 780ms, setup 66ms, import 1.04s, tests 3.00s, environment 0ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t58-opencode


 Test Files  36 passed (36)
      Tests  614 passed (614)
   Start at  08:35:10
   Duration  29.31s (transform 745ms, setup 341ms, import 6.17s, tests 19.18s, environment 3ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t58-opencode


 Test Files  131 passed (131)
      Tests  2860 passed (2860)
   Start at  08:35:42
   Duration  75.80s (transform 1.78s, setup 1.18s, import 22.31s, tests 38.97s, environment 11ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsc --noEmit
```

沒有輸出,退出碼 0。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run boundaries
```

```
> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t58-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t58-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t58-opencode/scripts/gates.config.json
boundaries: 掃描 398 個檔案,允許例外 25 條
涵蓋:納管 456 / 掃描 456 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=398
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run check:json-duplicate-keys
```

```
> check:json-duplicate-keys
> tsx scripts/check-json-duplicate-keys.ts

json-duplicate-keys.scope.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t58-opencode/scripts/json-duplicate-keys.scope.json
✓ 42 個 JSON 設定檔沒有同層重複鍵
gate=json-duplicate-keys result=PASS scanned=42
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsx scripts/check-doc-links.ts
```

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 310 個 markdown 檔,174 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=174
```

報告寫完後再跑一次同一條(掃描範圍多了這份報告):掃描 311 個 markdown 檔,174 條相對連結,PASS。

## 待協調

沒有。實作與契約 §2、ADR-082、紅測試沒有對不上的地方。工單把算圍欄長度的小函式寫成私有,派工指令要匯出;以派工指令為準,匯出名稱是 exampleFenceLength。測試只要求 renderCardFile,多匯出這一個沒有跟測試衝突。
