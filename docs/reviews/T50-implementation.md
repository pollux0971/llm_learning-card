# T50 實作報告

日期:2026-10-25。模型:Grok 4.7(opencode)。分支:`pollux0971/t50-opencode`。
開工 HEAD:`6143aae`(t50-start:紅測試 c2fc8cc 與紅測試驗收證據已在起點)。

## 第一步金鑰檢查

```
$ [ -n "$OPENAI_API_KEY" ] && echo SET || echo UNSET
UNSET
$ [ -n "$ANTHROPIC_API_KEY" ] && echo SET || echo UNSET
UNSET
$ ls .env
ls: cannot access '.env': No such file or directory
```

(`ls` 結束碼 2,就是沒有 `.env`。)

LLM 真呼叫:0。沒有建立或讀取 `.env`,沒有使用任何 provider 金鑰。沒跑變異測試(`npm run mutate`、Stryker、cargo-mutants)、沒跑整條 `check:all`、沒跑 cucumber、沒有 `git push`。沒改測試檔、`features/**`、`.feature`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`opencode.json`、Rust 原始碼、`packages/*`、`scripts/`、`apps/desktop`。沒有自己跑 `cargo` 或 `tauri build`。沒有使用 skill,沒有登入或登出。

## 做了什麼

`node_modules` 這個 worktree 原本沒有。從 `/data/python/llm_learning-cards` 複製(不用整棵 symlink;排除 `.vite`、`.vite-temp`、巢狀 `node_modules`;含 `apps/teach-card/node_modules`、`apps/test-card/node_modules`、`packages/ui-shared/node_modules`;不複製 `src-tauri/target`)。那三個套件目錄在來源裡只有 vite 快取,排除後是空的。目錄型 symlink 不會被 walk 抄到,所以 `node_modules/@learning/` 底下六個 workspace 連結(`ui-shared`、`core`、`contracts`、`desktop`、`teach-card`、`test-card`)用原來的相對路徑補上。`node_modules/` 在 `.gitignore`,沒有 add。

只改 `apps/teach-card/src/App.svelte` 的 `<style>`。標記沒動:最外層仍是一個 `HudPanel`;`<div class="controls">` 仍直接包按鈕;「下一個」仍是 `onclick={handleNext}`、`disabled={finished}`;沒有 `<svelte:window>`、沒有原生 `<button>`、沒有 `style=`、沒有 transition / animate。`.hud-body` 的 `padding-bottom` 仍是 `1px`,`scroll-padding-bottom` 仍是 `200px`。`.lc-scale`、`.lc-zoom` 沒動。T47 c 的容差沒動。

黏底那一塊本身沒動:`bottom`、`margin-bottom` 各 `-1px`;`z-index`、`display`、`background: var(--hud-solid)` 照舊。`::before` 仍是 `var(--hud-panel)`、`z-index: -1`;`::after` 仍是 `var(--hud-solid)`、`z-index: -2`。

偽元素不再一律多蓋:

- `.dock::before`、`.dock::after` 的 `inset` 從 `0 0 -1px 0` 改成 `0`(沒有提示時計算後 `bottom` 是 `0px`)。
- 只有 `body` 的直接子元素是 `#lc-wayland-note` 時才多蓋:`:global(body:has(> #lc-wayland-note)) .dock::before` 與同形的 `::after` 設 `bottom: -1px`。提示按掉就從 DOM 拿掉,`:has()` 自然不中。沒改 `wayland_note.js`,也沒用屬性選擇器比 `.hud-body` 的 inline style。

## 交件前 diff

```
$ git diff --stat
 apps/teach-card/src/App.svelte | 14 ++++++++++----
 1 file changed, 10 insertions(+), 4 deletions(-)

$ git diff --name-only
apps/teach-card/src/App.svelte

$ git diff --stat 6143aae -- packages contracts apps/desktop scripts features/07-teach-card apps/teach-card/src/teach-session.ts apps/teach-card/src/main.ts apps/teach-card/dev prompts src-tauri
(無輸出)
```

加上這份報告後,commit 只有 `apps/teach-card/src/App.svelte` 與 `docs/reviews/T50-implementation.md`。

## 跑過的指令與輸出原文

三次正式 vitest 分開跑,沒有同時開兩個。第一次 T50 與第一次整包是環境問題,下面記原因;綠的是重跑那次。

第一次 T50(10 紅)是複製 `node_modules` 時漏了 `@learning` 的目錄 symlink,vite 解不了 `@learning/ui-shared`。補上連結後重跑。摘要:

```
 FAIL  apps/teach-card/src/t50-dock-extension-render.test.ts
AssertionError: 卡片要畫出來;畫面文字:: expected false to be true

 Test Files  1 failed (1)
      Tests  10 failed (10)
   Start at  07:24:39
   Duration  205.02s
```

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t50-dock-extension-render.test.ts

 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t50-opencode


 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  07:28:21
   Duration  24.38s (transform 141ms, setup 67ms, import 121ms, tests 24.04s, environment 0ms)
```

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t49-dock-opaque-render.test.ts

 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t50-opencode


 Test Files  1 passed (1)
      Tests  32 passed (32)
   Start at  07:28:49
   Duration  59.57s (transform 189ms, setup 70ms, import 140ms, tests 59.20s, environment 0ms)
```

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t47-zoom-layout-render.test.ts

 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t50-opencode


 Test Files  1 passed (1)
      Tests  64 passed (64)
   Start at  07:29:52
   Duration  153.28s (transform 255ms, setup 77ms, import 186ms, tests 152.84s, environment 0ms)
```

第一次整包 vitest 在 desktop 測試自己叫的 Rust 編譯途中,被這次工具的 900000 ms 逾時打斷(沒有自己跑 `cargo`)。target 已有半成品(gitignore),重跑整包過了:

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card packages/ui-shared/src apps/desktop/src

 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t50-opencode


 Test Files  66 passed (66)
      Tests  1129 passed (1129)
   Start at  07:48:52
   Duration  1048.67s (transform 3.17s, setup 1.80s, import 6.20s, tests 1022.77s, environment 11ms)
```

```
$ npx tsc --noEmit
(無輸出,結束碼 0)
```

```
$ npm run boundaries

> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t50-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t50-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t50-opencode/scripts/gates.config.json
boundaries: 掃描 376 個檔案,允許例外 24 條
涵蓋:納管 432 / 掃描 432 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=376
```

```
$ npx tsx scripts/check-doc-links.ts
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 270 個 markdown 檔,142 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=142
```

## 待協調

無。測試沒改。cucumber(`@teach-card and not @manual`)這張的完成條件沒列、也沒跟協調者拿位子,沒跑。
