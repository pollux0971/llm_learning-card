# T48 實作報告

日期:2026-10-24。模型:Grok 4.7(opencode)。分支:`pollux0971/t48-opencode`。
開工 HEAD:`ef3ed84`(t48-start:main + T48 紅測試)。

## 第一步金鑰檢查

```
$ [ -n "$OPENAI_API_KEY" ] && echo SET || echo UNSET; [ -n "$ANTHROPIC_API_KEY" ] && echo SET || echo UNSET; ls .env
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

LLM 真呼叫:0。沒有建立或讀取 `.env`,沒有使用任何 provider 金鑰。沒跑變異測試(`npm run mutate`、Stryker、cargo-mutants)、沒跑整條 `check:all`、沒有 `git push`。沒改測試檔、`*-test-support.ts`、`features/**`、`contracts/`、`packages/`、`apps/desktop/`、`scripts/`、`apps/teach-card/src/teach-session.ts`、`apps/teach-card/dev/`、`prompts/`、`raw/`、`CLAUDE.md`、`opencode.json`、`src-tauri`。

## 做了什麼

`node_modules` 這個 worktree 原本沒有。用 `tar` 從 `/data/python/llm_learning-cards` 複製(不 symlink;排除 `node_modules/node_modules`、`.vite`、`.vite-temp`;另複製 `apps/teach-card/node_modules` 與 `packages/ui-shared/node_modules`,那兩個排除快取後是空的)。複製後 `node_modules/@learning/ui-shared` 是相對連結 `../../packages/ui-shared`,realpath 指到這個 worktree 的 `packages/ui-shared`。`node_modules/` 在 `.gitignore`,沒有 add。

只改 `apps/teach-card/src/App.svelte`。

## 做法與理由

### 同一張卡的 html 只算一次

`parsed()` 前面加一份記憶(上一張卡):鍵是 `view.card.path` 與 `view.cardText` 分開比,不是只放其中一個,也不把 storage 的值放進鍵。鍵一樣就回同一份 html 字串,不呼叫 `renderMarkdown`、不讀 storage。`{@html}` 比的是字串相等,`details` 節點才不會換、缺圖字樣才不會變回 `img`。

鍵不一樣(下一個、換類別、深入完成、回上一層、先備、同一個 path 但內文變了、內文一樣但目錄不同)才讀 storage、重算、蓋掉那一份。回到之前看過的卡也算換卡。

只把讀 storage 包 `untrack` 不夠:`view` 一換 `parsed()` 還是會重跑,重跑時讀到的是新的 storage 值。所以快取命中時根本不讀 storage。記憶不是 `$state`,避免寫進去又變成 `$derived` 的依賴。

離開卡片畫面(`view.state` 不是 `'card'`:換類別、loading、finished、error)用 `$effect` 清掉記憶。`$derived` 是惰性的,類別清單時 `shown` 沒被讀,`parsed()` 不會跑,不能在裡面清。不清的話,`{@html}` 卸下再掛上會拿到舊 html(折疊還是進卡時的那一份),T46 渲染測試 a(換類別再選回卡)會紅。

### 放大跟著視窗重算

打開時把那張圖的 `naturalWidth` / `naturalHeight` 記在放大狀態上。既有的 `resize` 監聽(`$effect` + `window.addEventListener`,不用 `<svelte:window>`)除了對位置,也用這兩個原尺寸照「等比例、裝進視窗的最大」重算寬高,經 `style:width` / `style:height` 寫上去(不寫 `style=`、不用 `.style.cssText`)。改回原視窗大小就回到原本的寬高。公式仍是 `Math.min`,不用 `Math.max`:比視窗高的圖就是整張看得到,不保證比卡片裡大。

### 不留死樣式

`.lc-missing` 改成 `:global(.lc-missing)`。那顆 `span` 是執行時 `createElement` 的,scoped 選不到。只寫字級(`0.85rem`,比例子裡的字小一號)與 `color: var(--hud-text)`,不寫框。

沒有新的 card-static 例外。`teach-session.ts` 沒動。

## 跑過的指令與輸出原文

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t48-app-compile-static.test.ts`:

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t48-opencode

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  13:35:51
   Duration  403ms (transform 37ms, setup 41ms, import 262ms, tests 3ms, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t48-fold-rerender-render.test.ts`:

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t48-opencode

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  13:36:18
   Duration  42.01s (transform 111ms, setup 39ms, import 81ms, tests 41.79s, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/`:

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t48-opencode

 Test Files  17 passed (17)
      Tests  221 passed (221)
   Start at  13:37:06
   Duration  183.34s (transform 444ms, setup 175ms, import 892ms, tests 180.61s, environment 1ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/`:

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t48-opencode

 Test Files  25 passed (25)
      Tests  482 passed (482)
   Start at  13:40:15
   Duration  197.88s (transform 360ms, setup 235ms, import 694ms, tests 194.58s, environment 2ms)
```

`npx tsc --noEmit`:無輸出,結束碼 0。

`npm run boundaries`:

```
> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t48-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t48-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t48-opencode/scripts/gates.config.json
boundaries: 掃描 371 個檔案,允許例外 24 條
涵蓋:納管 427 / 掃描 427 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=371
```

`npx tsx scripts/check-doc-links.ts`:

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 256 個 markdown 檔,131 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=131
```

交件前 `git diff --stat`(相對工作區,報告尚未寫入時):

```
 apps/teach-card/src/App.svelte | 58 ++++++++++++++++++++++++++++++------------
 1 file changed, 42 insertions(+), 16 deletions(-)
```

## 待協調

無。沒有覺得需要新的 card-static 例外,也沒有覺得測試有錯。
