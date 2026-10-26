# T57 實作報告

日期:2026-10-27。模型:Grok 4.7(opencode)。分支:pollux0971/t57-opencode。
開工 HEAD:ca9ee27(chore(T57): start = main + 契約 1.5.0 + 紅測試(t57-red2))。LLM 真呼叫 0 次。

## 環境(開工第一行)

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

兩個 key 都是 UNSET,沒有 .env。沒建立 .env,沒使用任何 provider 金鑰。沒碰 learning/、raw/。沒改測試、向量檔、contracts/(含 types.md)、docs/(這份報告除外)、prompts/、.feature、opencode.json。沒跑變異測試、沒跑 cucumber、沒跑 check:all、沒跑 --live、沒 git push。沒使用 skill,沒登入或登出。

## 做了什麼

契約 1.5.0 與 ADR-081 唯讀,以起點分支那兩份為準。畫面行為沒改。stripExampleFences 的簽章沒改。

1. 新增 packages/contracts/src/card-markdown.ts(0 個 import,只 export 兩樣)。第 5 行 CARD_MARKDOWN_OPTIONS = Object.freeze({ html: false, linkify: true })。第 8–9 行 isExampleFence:info.trim().split(/\s+/)[0] === 'example'。'example' 這個字面值只在這個檔。檔頭註解寫這兩樣是契約 §2 的一部分,改它就是改 §2。boundaries 的 packages/contracts/ 前綴已經蓋到這個檔,沒另登記。

2. packages/core/src/schema/example-fence.ts 整個換掉。第 14 行模組裡 new MarkdownIt(CARD_MARKDOWN_OPTIONS)。第 45 行 stripExampleFences 先 text.trim(),第 47 行只呼叫 md.parse,挑 type === 'fence' 且 isExampleFence(token.info) 的 token。依 token.map 改原文:開始行留下第一個反引號或波浪號之前的部分,加上那一行原本的換行;開始行之後到 map[1] 之前的行整行拿掉(連同換行)。切行用 /(\r\n|\r|\n)/,換行符原樣接回去。body 是結果再 trim;examples 是每個 token.content.trim(),空的也算一個,依序。實例只碰 .parse;token 只讀 type、info、map、content。從 @contracts/card-markdown.js import。舊註解「契約未定義,不擴大」已拿掉。

3. packages/ui-shared/src/example-fence.ts:第 3 行改從 @contracts/card-markdown.js import。刪掉自己的 fenceLang。第 32 行 exampleLabel、第 155 行 renderer.rules.fence 改呼叫 isExampleFence(token.info)。第 164 行 new MarkdownIt(CARD_MARKDOWN_OPTIONS)。這個檔不再有 'example' 字面值,也沒碰 block、core、set、configure,沒寫 options。

4. apps/teach-card/vite.config.ts 第 12 行、apps/test-card/vite.config.ts 第 12 行各加 '@contracts' 別名,寫法同 @core 那條,對齊根目錄 vitest.config.ts。

5. 根目錄 package.json 第 67 行 "markdown-it" 由 "^15.0.1" 改成 "15.0.1"。package-lock.json 只改根套件那一行(第 18 行)。node_modules/markdown-it 那一段一個字沒動。@types/markdown-it 沒動。

呼叫端:git grep fenceLang 只剩守門測試自己(它在查這個名字不該再出現)。EXAMPLE_FENCE_RE 已沒有呼叫端。stripExampleFences 的呼叫端(parse-card、word-count、validator-min、structural-checks、siblings、schema barrel)簽章仍是 { body, examples },沒改那些檔。

## 跑過的指令與輸出原文

worktree 沒有 node_modules。用 tar 從 /data/python/llm_learning-cards 複製(排除 .vite、.vite-temp、node_modules/node_modules;連同 apps/teach-card/node_modules、apps/test-card/node_modules、packages/ui-shared/node_modules;不用 symlink;沒複製 src-tauri/target)。那三個套件目錄排除快取後是空目錄。node_modules 在 .gitignore,沒有 add。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run features/support/word-count-vectors.test.ts features/support/t57-example-fence-guards.test.ts
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t57-opencode


 Test Files  2 passed (2)
      Tests  63 passed (63)
   Start at  05:13:20
   Duration  3.69s (transform 589ms, setup 48ms, import 693ms, tests 2.76s, environment 0ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ packages/contracts/src/ features/support/word-count-vectors.test.ts features/support/t57-example-fence-guards.test.ts scripts/lint.test.ts
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t57-opencode


 Test Files  134 passed (134)
      Tests  3002 passed (3002)
   Start at  05:13:30
   Duration  96.85s (transform 1.84s, setup 1.07s, import 20.26s, tests 63.01s, environment 10ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsc --noEmit
```

沒有輸出,退出碼 0。package.json 的 typecheck 就是 tsc --noEmit。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run boundaries
```

```
> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t57-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t57-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t57-opencode/scripts/gates.config.json
boundaries: 掃描 395 個檔案,允許例外 25 條
涵蓋:納管 453 / 掃描 453 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=395
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run check:json-duplicate-keys
```

```
> check:json-duplicate-keys
> tsx scripts/check-json-duplicate-keys.ts

json-duplicate-keys.scope.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t57-opencode/scripts/json-duplicate-keys.scope.json
✓ 41 個 JSON 設定檔沒有同層重複鍵
gate=json-duplicate-keys result=PASS scanned=41
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsx scripts/check-doc-links.ts
```

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 307 個 markdown 檔,174 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=174
```

報告寫完後再跑一次同一條(掃描範圍多了這份報告):掃描 308 個 markdown 檔,174 條相對連結,PASS。

lockfile:

```
git diff -- package-lock.json
```

只有根套件那一行 ^15.0.1 改成 15.0.1。

沒跑:packages/ui-shared、apps 的畫面測試(有 Chrome,留給驗收)、cucumber、變異測試、build:frontends、check:all、--live。

## 待協調

無。實作與向量檔、守門測試沒有對不上的列。沒改測試、沒改向量檔。
