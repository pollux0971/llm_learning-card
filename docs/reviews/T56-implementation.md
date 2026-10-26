# T56 實作報告

日期:2026-10-25。模型:Grok 4.7(opencode)。分支:pollux0971/t56-opencode。
開工 HEAD:d347fffbc7ea88b8ce1fe8bc4f1c66a2e587b87e。LLM 真呼叫 0 次。

## 環境(開工第一行)

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

兩個 key 都是 UNSET,沒有 .env。沒建立 .env,沒使用任何 provider 金鑰。沒碰 learning/、raw/、contracts/、prompts/、CLAUDE.md、opencode.json。沒改測試、沒跑變異測試、沒跑 cucumber、沒跑 check:all、沒 git push。沒使用 skill,沒登入或登出。

同一行還印了 uptime(5 分鐘 load 6.16,未超過 8,所以後來照跑編譯與 vitest):

```
 15:47:38 up 2 days, 13:28,  1 user,  load average: 8.01, 6.16, 4.68
```

## 做了什麼

只改兩個檔。縮放方向、命令名、按鈕的 onclick、closest('button') 擋法都沒動。沒呼叫 preventDefault。沒有同時掛 mousedown 與 pointerdown。

縮放把手 packages/ui-shared/src/hud/HudResizeHandles.svelte:

- 第 17 行 onResize 改收 MouseEvent。第 18 行 button 不是 0 就 return。第 19 行仍呼叫 startResizeDragging(edge),八個方向字串沒改。
- 第 27 行由 onpointerdown 改成 onmousedown,把事件傳進去。

標題列 packages/ui-shared/src/hud/HudTitleBar.svelte:

- 第 6 行 onDrag 的參數由 PointerEvent 改成 MouseEvent。第 7 行 button 不是 0 就 return。第 8–9 行仍用 event.target 的 closest('button') 擋縮小與關閉鈕。第 10 行仍呼叫 startDragging()。
- 第 14 行由 onpointerdown 改成 onmousedown。縮小、關閉鈕的 onclick 沒動。

## 跑過的指令與輸出原文

worktree 沒有 node_modules。用 tar 從 /data/python/llm_learning-cards 複製(排除 .vite、.vite-temp、node_modules/node_modules;連同 apps/teach-card/node_modules、apps/test-card/node_modules、packages/ui-shared/node_modules;不用 symlink;沒複製 src-tauri/target)。那三個套件目錄在來源裡只有 vite 快取,排除後是空目錄。node_modules 在 .gitignore,沒有 add。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud/hud-drag-wiring-render.test.ts
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t56-opencode


 Test Files  1 passed (1)
      Tests  61 passed (61)
   Start at  15:50:12
   Duration  44.01s (transform 170ms, setup 75ms, import 136ms, tests 43.59s, environment 0ms)
```

開跑前 5 分鐘 load 5.51。一次只跑這一個 vitest。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src apps/teach-card apps/test-card
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t56-opencode


 Test Files  53 passed (53)
      Tests  1198 passed (1198)
   Start at  15:51:24
   Duration  808.49s (transform 1.74s, setup 740ms, import 2.80s, tests 797.45s, environment 6ms)
```

開跑前 5 分鐘 load 5.48。前一個 vitest 已結束才開這一個。含渲染測試 61 條,以及 HUD、教學卡、考試卡既有測試。全綠。

```
npx tsc --noEmit
```

無輸出,exit 0。

```
npm run boundaries
```

```
> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t56-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t56-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t56-opencode/scripts/gates.config.json
boundaries: 掃描 379 個檔案,允許例外 24 條
涵蓋:納管 435 / 掃描 435 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=379
```

報告寫入前 git diff --stat(對工作樹,起點 d347fff):

```
 packages/ui-shared/src/hud/HudResizeHandles.svelte | 5 +++--
 packages/ui-shared/src/hud/HudTitleBar.svelte      | 5 +++--
 2 files changed, 6 insertions(+), 4 deletions(-)
```

```
npx tsx scripts/check-doc-links.ts
```

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 290 個 markdown 檔,154 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=154
```

報告寫入後跑一次,把上面這段補進報告後再跑一次,兩次輸出相同(掃描 290 個 markdown 檔,154 條相對連結,PASS)。

## 待協調

無。測試沒有改。紅的原因是還沒有這個功能,改完 a–f 都綠,沒有要協調者裁的測試爭議。
