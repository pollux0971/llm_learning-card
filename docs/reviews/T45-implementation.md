# T45 實作報告

日期:2026-10-24。模型:Grok 4.7(opencode)。分支:`pollux0971/t45-opencode`。
開工 HEAD:`97a4de8`(T45 紅測試已在起點)。

## 第一步金鑰檢查

```
$ echo "${OPENAI_API_KEY:-UNSET}"; echo "${ANTHROPIC_API_KEY:-UNSET}"; ls .env
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

LLM 真呼叫:0。沒有建立或讀取 `.env`,沒有使用任何 provider 金鑰。沒跑變異測試(`npm run mutate`、Stryker、cargo-mutants)、沒跑整條 `check:all`、沒有 `git push`。沒改測試檔、`features/**`、`.feature`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`opencode.json`、`src-tauri`、`packages/core`、`packages/ui-shared`、`teach-session.ts`、`main.ts`。沒有新增 `.ts`,沒有改 `boundaries.owners.json`。

## 做了什麼

只動 `apps/teach-card/src/App.svelte` 的標記與 `<style>`(script 裡加了一個切段函式)。`<div class="controls">` 標記沒改。

顧問選 A:系統狀態字樣(`.generating`、`.deepen-error`)從按鈕列上面搬到下面。按鈕列底下加一塊永遠在的 `.status-slot`:

- `display: flow-root`,讓第一個 `p` 的 `margin-top: 0.75rem` 留在槽裡,不外溢 12px。
- `min-height: calc(67.4px + 0.75rem + 2px)`。67.4px 是工單寫的、360 寬下最高金鑰句(missing / `ANTHROPIC_API_KEY`,3 行)的 `.deepen-error` 邊框盒;加上那條上外距,再留 2px 給次像素。沒有估成兩行。沒有字樣時這塊是空的,不畫框、不加陰影、不用漸層。
- 分隔線仍只寫在 `.generating, .deepen-error` 自己身上(`border-top: 1px solid var(--hud-line)`),字級 0.85rem、字色 `var(--hud-text)` 照舊。沒有 `style=` 屬性,沒有 Svelte 動畫指令。沒有另寫按鈕 `font-size`(見待協調)。

直角引號:每一句(不寫死 deepen-failed)照「…」切段,用 `{#each}` 輸出文字節點,不用 `{@html}`。含括號 ≤14 字的那段包 `<span class="quote-keep">`(`white-space: nowrap`);更長的不包,照常折行,不橫向凸出。

## 跑過的指令與輸出原文

這個 worktree 沒有 `node_modules`。`package-lock.json` 與 `/data/python/llm_learning-cards` 相同,所以把那邊的 `node_modules` 做成 symlink,沒跑 `npm ci`、沒打網路。symlink 是未追蹤檔,沒有 add、沒有 commit。

第一次 vitest 在 symlink 之前失敗(沒有套件):

```
failed to load config from /home/pollux/orca/workspaces/llm_learning-cards-workers/t45-opencode/vitest.config.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from .../node_modules/.vite-temp/vitest.config.ts...
```

symlink 之後,一次只跑一個 vitest。

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t45-status-layout-render.test.ts`:

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t45-opencode

 Test Files  1 passed (1)
      Tests  42 passed (42)
   Start at  05:36:56
   Duration  65.68s (transform 117ms, setup 37ms, import 139ms, tests 65.41s, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t44-generating-render.test.ts`:

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t45-opencode

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  05:38:07
   Duration  17.78s (transform 104ms, setup 40ms, import 133ms, tests 17.50s, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/`:

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t45-opencode

 Test Files  13 passed (13)
      Tests  173 passed (173)
   Start at  05:38:30
   Duration  99.51s (transform 329ms, setup 129ms, import 471ms, tests 97.69s, environment 1ms)
```

含 t45 渲染 42 條、t44 渲染 11 條、`t44-generating-session`、`t43-deepen`、`teach-session`、`t40-busy`。

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud/card-static.test.ts packages/ui-shared/src/hud/card-static-self.test.ts packages/ui-shared/src/hud/card-render-wayland-note.test.ts packages/ui-shared/src/hud/card-render-wayland-note-t35.test.ts packages/ui-shared/src/hud/card-render.test.ts`:

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t45-opencode

 Test Files  5 passed (5)
      Tests  168 passed (168)
   Start at  05:40:17
   Duration  127.19s (transform 184ms, setup 77ms, import 271ms, tests 126.36s, environment 0ms)
```

`npx tsc --noEmit`:無輸出,結束碼 0。

`npm run boundaries`:

```
boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t45-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t45-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t45-opencode/scripts/gates.config.json
boundaries: 掃描 364 個檔案,允許例外 24 條
涵蓋:納管 420 / 掃描 420 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=364
```

`npx tsx scripts/check-doc-links.ts`:

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 246 個 markdown 檔,131 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=131
```

交件前 `git diff --stat`(不含報告):

```
 apps/teach-card/src/App.svelte | 53 ++++++++++++++++++++++++++++++++++--------
 1 file changed, 43 insertions(+), 10 deletions(-)
```

`git diff --name-only` 只有 `apps/teach-card/src/App.svelte`。受保護檔、`prompts/`、`contracts/`、`src-tauri`、`packages/core`、`teach-session.ts`、`main.ts` 都沒有輸出。

## 待協調

無。測試沒有改。「取消」沒有另寫 `font-size`:按鈕是瀏覽器預設字級,不繼承 `.generating` 的 0.85rem;t45 的 d 與 t44 的 g 都綠(字級與高度跟「下一個」相同)。若驗收環境的按鈕會繼承外層字級,再明寫對齊即可。
