# T49 實作報告

日期:2026-10-25。模型:Grok 4.7(opencode)。分支:`pollux0971/t49-opencode`。
開工 HEAD:`00da5bf`(t49-start:紅測試與紅測試驗收證據已在起點)。

## 第一步金鑰檢查

```
$ [ -n "$OPENAI_API_KEY" ] && echo SET || echo UNSET
UNSET
$ [ -n "$ANTHROPIC_API_KEY" ] && echo SET || echo UNSET
UNSET
$ ls .env
ls: cannot access '.env': No such file or directory
```

LLM 真呼叫:0。沒有建立或讀取 `.env`,沒有使用任何 provider 金鑰。沒跑變異測試(`npm run mutate`、Stryker、cargo-mutants)、沒跑整條 `check:all`、沒跑 cucumber、沒有 `git push`。沒改測試檔、`features/**`、`.feature`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`opencode.json`、Rust 原始碼、`packages/*`、`scripts/`、`apps/desktop`。沒有自己跑 `cargo` 或 `tauri build`。

## 做了什麼

`node_modules` 這個 worktree 原本沒有。用 `tar` 從 `/data/python/llm_learning-cards` 複製(不用 symlink;排除 `.vite`、`.vite-temp`、`node_modules/node_modules`;含 `apps/teach-card/node_modules`、`apps/test-card/node_modules`、`packages/ui-shared/node_modules`;不複製 `src-tauri/target`)。`node_modules/` 在 `.gitignore`,沒有 add。

只改 `apps/teach-card/src/App.svelte` 的 `.dock` 與其 `<style>`。標記沒動:最外層仍是一個 `HudPanel`;`<div class="controls">` 仍直接包按鈕;「下一個」仍是 `onclick={handleNext}`、`disabled={finished}`;沒有 `<svelte:window>`、沒有原生 `<button>`、沒有 `style=`、沒有 transition / animate。`.hud-body` 的 `padding-bottom` 仍是 `1px`,`scroll-padding-bottom` 仍是 `200px`。`.lc-scale`、`.lc-zoom`(在 `.dock` 外面)沒動。

黏底那一塊的底改成跟旁邊面板同一套疊法(card-static 不准一個 `background` 疊兩層,所以用偽元素):

- `.dock` 自己的底是 `var(--hud-solid)`。
- `::before` 畫 `var(--hud-panel)`,`z-index: -1`,在內容下面。
- `::after` 再墊一層 `var(--hud-solid)`,`z-index: -2`。
- 兩層都是 `content: ''`、`position: absolute`、`inset: 0 0 -1px 0`(往下多蓋 1px)、`pointer-events: none`。

補縫:sticky 的 `bottom` 與 `margin-bottom` 各 `-1px`,加上面那 1px 的多蓋。沒有合成器時面板是白、這一塊是面板色疊在 solid 上,通道差 1,在 ≤ 1 裡;有 `hud-solid` 時跟面板同一套疊法。`padding-bottom` 沒改成 0。

## 交件前 diff

```
$ git diff --stat
 apps/teach-card/src/App.svelte | 32 ++++++++++++++++++++++++++------
 1 file changed, 26 insertions(+), 6 deletions(-)

$ git diff --name-only
apps/teach-card/src/App.svelte

$ git diff --stat 63877ee -- packages contracts apps/desktop scripts features/07-teach-card apps/teach-card/src/teach-session.ts apps/teach-card/src/main.ts apps/teach-card/dev prompts src-tauri packages/core
(無輸出)
```

加上這份報告後,commit 只有 `apps/teach-card/src/App.svelte` 與 `docs/reviews/T49-implementation.md`。

## 跑過的指令與輸出原文

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t49-dock-opaque-render.test.ts

 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t49-opencode

 Test Files  1 passed (1)
      Tests  32 passed (32)
   Start at  03:01:18
   Duration  52.70s (transform 118ms, setup 44ms, import 89ms, tests 52.47s, environment 0ms)
```

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t47-zoom-layout-render.test.ts

 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t49-opencode

 Test Files  1 passed (1)
      Tests  64 passed (64)
   Start at  03:02:14
   Duration  140.54s (transform 140ms, setup 42ms, import 104ms, tests 140.29s, environment 0ms)
```

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card packages/ui-shared/src apps/desktop/src

 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t49-opencode

 Test Files  65 passed (65)
      Tests  1119 passed (1119)
   Start at  03:04:40
   Duration  762.74s (transform 1.06s, setup 599ms, import 2.10s, tests 753.42s, environment 5ms)
```

```
$ npx tsc --noEmit
(無輸出,結束碼 0)
```

```
$ npm run boundaries

> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t49-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t49-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t49-opencode/scripts/gates.config.json
boundaries: 掃描 375 個檔案,允許例外 24 條
涵蓋:納管 431 / 掃描 431 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=375
```

```
$ npx tsx scripts/check-doc-links.ts
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 265 個 markdown 檔,136 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=136
```

三次 vitest 分開跑,沒有同時開兩個。

## 待協調

無。測試沒改。cucumber(`@teach-card and not @manual`)這張的完成條件沒列、也沒跟協調者拿位子,沒跑。
