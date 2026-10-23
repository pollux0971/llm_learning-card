# T44 實作報告

日期:2026-10-24。模型:Grok 4.7(opencode)。分支:`pollux0971/t44-opencode`。
開工 HEAD:`9b995b6`(T44 紅測試已在起點)。

## 第一步金鑰檢查

```
$ echo "${OPENAI_API_KEY:-UNSET}"; echo "${ANTHROPIC_API_KEY:-UNSET}"; ls .env
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

LLM 真呼叫:0。沒有建立或讀取 `.env`,沒有使用任何 provider 金鑰。沒跑變異測試(`npm run mutate`、Stryker、cargo-mutants)、沒跑整條 `check:all`、沒有 `git push`。沒改測試檔、`features/**`、`.feature`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`opencode.json`、`src-tauri`、`packages/core`、`packages/ui-shared`。

## 做了什麼

只動 `apps/teach-card/src/teach-session.ts` 與 `apps/teach-card/src/App.svelte`。沒有新增檔,沒有改 `boundaries.owners.json`。

1. **變更通知** `session.onChange(listener): () => void`,形狀照 `onWait`,回傳的函式從清單拿掉那個 listener。通知時機:
   - `teach.deepen` 回 `generating: true` 之後(送出當下不通知;本地仍先把 `generating` 設成 true,連按第二下不會多送請求,但畫面要等這次通知才拉);
   - 每次 `teach.poll` 回來、而且還是這個工作時:還在生成就通知,拿到結果就先 `apply` 再通知,拿到錯誤就先 `stayOnCard` 再通知;
   - 生成結束:成功(子卡路徑 `apply` 之後、輪詢結束的那一次)、錯誤(`stayOnCard` 之後)、取消(`apply` 或 `stayOnCard` 之後)。
   - 工作編號已經換掉(取消進行中)的那一次 poll 不通知,由 `cancel` 收尾時通知。
2. **畫面訂閱**。`App.svelte` 另開一個 `$effect`,訂 `session.onChange`,收到就 `pull()`,寫法跟 `onWait` 那一段一樣。
3. **第二道防線**。`next`、`chooseCategory`、`followPrereq` 在 `generating` 時開頭直接 `return Promise.resolve()`:0 個側車請求、不改 `deepenError`、不 `restoreList`、`view()` 不變。`back`、`openCategories` 本來就直接 return,沒動。
4. **樣式(第 8 條)**。只改 `App.svelte` 的 `<style>`:`.generating` 與 `.deepen-error` 設 `font-size: 0.85rem`、`padding-top: 0.4rem`、`border-top: 1px solid var(--hud-line)`、`color: var(--hud-text)`。沒有新顏色,沒有改 `hud.css`。沒有另寫按鈕的 `font-size`(見待協調)。
5. 先備提示的按鈕本來就綁 `view.controlsDisabled`;生成中這個旗標是 true,通知把畫面拉進來之後就是停用。畫面上沒有「回上一層」時不另畫(生成中 `canBack` 仍是 false,T43 既有行為)。

`teach-session.ts` 沒有 `setTimeout`、`sleep`、`now`,也不自己判斷 busy。輪詢間隔仍是 `main.ts` 注入的 `pause`。

## 跑過的指令與輸出原文

這個 worktree 沒有 `node_modules`。`npm ci`(7s,added 433 packages)。`package-lock.json` 沒有變。`node_modules/` 在 `.gitignore`,沒有 add。

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t44-generating-session.test.ts`:

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t44-opencode

 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  01:40:18
   Duration  296ms (transform 93ms, setup 43ms, import 34ms, tests 120ms, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t44-generating-render.test.ts`:

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t44-opencode

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  01:40:21
   Duration  18.22s (transform 99ms, setup 37ms, import 133ms, tests 17.95s, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/`:

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t44-opencode

 Test Files  12 passed (12)
      Tests  131 passed (131)
   Start at  01:40:48
   Duration  35.17s (transform 290ms, setup 128ms, import 374ms, tests 33.59s, environment 1ms)
```

含 t44 兩檔 23 條、`t43-deepen`、`teach-session`、`t40-busy`。一次只跑一個 vitest。

`npx tsc --noEmit`:無輸出,結束碼 0。

`npm run boundaries`:

```
boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t44-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t44-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t44-opencode/scripts/gates.config.json
boundaries: 掃描 363 個檔案,允許例外 24 條
涵蓋:納管 419 / 掃描 419 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=363
```

`npx tsx scripts/check-doc-links.ts`(寫這份報告之前,242 個 markdown;寫完再跑一次,243 個,這份報告沒有相對連結):

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 243 個 markdown 檔,131 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=131
```

## git diff --stat(實作,不含這份報告)

```
 apps/teach-card/src/App.svelte       | 15 +++++++++++++++
 apps/teach-card/src/teach-session.ts | 36 ++++++++++++++++++++++++++++++++++--
 2 files changed, 49 insertions(+), 2 deletions(-)
```

兩個檔都在 `apps/teach-card/src/`。`git diff --name-only` 看不到 `*.test.ts`、`*-test-support.ts`、`features/**`、`.feature`、`contracts/`、`prompts/`、`src-tauri`、`packages/core`。

## 待協調

- 工單第 8 條寫「按鈕的字會繼承外層,外層改 0.85rem 時要讓取消維持原來的大小」,改壞證明也寫「只拿掉讓取消維持原大小的那條規則 → g 紅」。派工單已註明這句與實測不符:按鈕是瀏覽器預設字級,不繼承外層。渲染測試 g 在沒有按鈕 `font-size` 規則的情況下綠(「取消」與「下一個」的計算字級與高度相等)。所以沒有加那條規則;把取消改成 `1rem` 會讓 g 紅,沒有做。驗收若要「拿掉那條規則就紅」,這條在這個 Chrome 上沒有可拿的規則。
- 沒跑 cucumber。派工的完成條件沒有列它;工單驗收條件第 1 節的 `@teach-card` phase-2 / phase-3 留給驗收 agent。
