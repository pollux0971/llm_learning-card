# T61 實作報告

日期:2026-10-27。模型:Grok 4.7(opencode)。分支:pollux0971/t61-opencode。
開工 HEAD:b6acd4f(merge: T61 紅測試進起點分支)。LLM 真呼叫 0 次。

## 環境(開工第一行)

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

兩個 key 都是 UNSET,`.env` 不存在(ls 退出碼 2)。沒建立 .env,沒使用任何 provider 金鑰。沒碰 learning/、raw/。沒改測試、features/**、.feature、contracts/、prompts/、scripts/ingest.ts、card-file.ts、topic.ts、scan.ts、deepen.ts、packages/core/src/llm/、opencode.json。沒跑變異測試、沒跑 cucumber、沒跑 check:all、沒跑 --live、沒 git push。沒使用 skill,沒登入或登出。

## 做了什麼

沒改契約。CLI 沒改:scripts/ingest.ts 單檔路徑本來就印 result.message、用 result.exitCode 結束;掃描路徑本來就把 ok: false 收進失敗清單。

1. packages/core/src/ingest/errors.ts 第 45 行新增 ModelResponseFormatError extends Error。第 48 行 name 設成 'ModelResponseFormatError'。建構子只收訊息,訊息原樣進 Error。
2. packages/core/src/ingest/generate-cards.ts:parseCardCandidates 與 parseRegenerated 的格式錯改丟 ModelResponseFormatError,訊息文字不變。
   - 第 184 行不是 JSON、第 186 行不是陣列、第 198 行某一筆格式不正確。
   - 第 218 行 regenerate 不是 JSON、第 220 行不是陣列、第 221 行沒有卡片、第 225 行第 0 筆格式不正確。
   - 第 175 行 examplesAreAllStrings:陣列且每個元素都是字串。第 194 行用在批次解析的條件裡,不是就走原本的「格式不正確」。空陣列、空字串仍過。檢查在 parse 裡,寫任何檔之前。regenerate 的 adoptableExamples 沒改(缺、空、非字串仍是保留目前候選,不丟錯)。
3. packages/core/src/ingest/children.ts:parseChildCandidates 同理。第 113 行不是 JSON、第 115 行不是陣列、第 117 行筆數不對、第 123 行某一筆格式不正確。第 104 行同一個 examples 檢查,第 122 行用在條件裡。generateChildren 在寫檔前就呼叫 parse,所以壞的那筆不會留下子卡檔。
4. packages/core/src/ingest/ingest.ts 第 85 行那個 try/catch:第 91 行只接 ModelResponseFormatError,第 92 行取訊息第一行(split 換行再 trim,跟 topic.ts 的 errorFirstLine 同一種取法),第 93 行 fail('模型回應格式不對,沒有寫任何卡:' + 第一行, 1)。雲端需要的錯仍走原來那句。第 95 行其他錯照丟,堆疊保留。runIngestPipeline 第 320 行的子卡 catch 沒改:ModelResponseFormatError 是 Error 的子類別,仍記「子卡產生失敗,已略過」並略過,只是不再留下寫到一半的子卡。

boundaries 沒另登記:沒有新檔。scripts/boundaries.owners.json 已有 packages/core/src/ingest/ 這個目錄前綴。例外條數不變(25)。

packages/core/src/ingest/index.ts 第 2 行是 export * from './errors.js',新類別跟著出去,那個檔沒改。

呼叫端(git grep ModelResponseFormatError、parseCardCandidates、parseRegenerated、parseChildCandidates、examplesAreAllStrings;含 .mjs、.js):

- 三個解析函式與 examplesAreAllStrings 都沒有 export。parseCardCandidates 只在 generate-cards.ts 第 162 行;parseRegenerated 只在第 171 行;parseChildCandidates 只在 children.ts 第 143 行。
- ModelResponseFormatError 的生產呼叫端:generate-cards.ts、children.ts 丟;ingest.ts 第 91 行接。沒有 .mjs、.js 呼叫端。
- topic.ts 第 102 行只在註解提到 parseCardCandidates,沒有呼叫,沒改。
- deepen.ts 的 generateChildren / enforceWordLimit 對一般錯誤回 failed。新錯誤是 Error 的子類別,那兩條沒改,行為不變。
- 既有測試用 toThrow(訊息)或 toBeInstanceOf(Error),訊息沒變、子類別仍是 Error,ingest 目錄全綠。

## 跑過的指令與輸出原文

worktree 沒有 node_modules。用 tar 從 /data/python/llm_learning-cards 複製(排除 .vite、.vite-temp、node_modules/node_modules;連同 apps/teach-card/node_modules、apps/test-card/node_modules、packages/ui-shared/node_modules;不用 symlink;沒複製 src-tauri/target)。node_modules 在 .gitignore,沒有 add。

跑 CLI 測試前再確認一次 .env 不存在、兩個 key 是 UNSET。那個測試自己帶 _fake-cloud.mjs,HOME/XDG 指暫存。沒跑不帶 --fake 的 scripts/ingest.ts,也沒跑這個 CLI 測試以外會起 CLI 的 cucumber。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/t61-bad-model-output.test.ts features/support/t61-cli-bad-model-output.test.ts
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t61-opencode


 Test Files  2 passed (2)
      Tests  22 passed (22)
   Start at  10:40:01
   Duration  5.88s (transform 252ms, setup 54ms, import 429ms, tests 5.19s, environment 0ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t61-opencode


 Test Files  37 passed (37)
      Tests  636 passed (636)
   Start at  10:40:10
   Duration  30.85s (transform 814ms, setup 379ms, import 6.72s, tests 19.95s, environment 3ms)
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

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t61-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t61-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t61-opencode/scripts/gates.config.json
boundaries: 掃描 399 個檔案,允許例外 25 條
涵蓋:納管 457 / 掃描 457 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=399
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run check:json-duplicate-keys
```

```
> check:json-duplicate-keys
> tsx scripts/check-json-duplicate-keys.ts

json-duplicate-keys.scope.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t61-opencode/scripts/json-duplicate-keys.scope.json
✓ 43 個 JSON 設定檔沒有同層重複鍵
gate=json-duplicate-keys result=PASS scanned=43
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsx scripts/check-doc-links.ts
```

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 317 個 markdown 檔,174 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=174
```

交件前 git diff --stat(對起點,不含這份報告):

```
 packages/core/src/ingest/children.ts       | 16 +++++++++++-----
 packages/core/src/ingest/errors.ts         | 14 ++++++++++++++
 packages/core/src/ingest/generate-cards.ts | 22 ++++++++++++++--------
 packages/core/src/ingest/ingest.ts         |  6 +++++-
 4 files changed, 44 insertions(+), 14 deletions(-)
```

## 待協調

沒有。紅測試沒有要改的地方。
