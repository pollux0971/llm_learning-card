# T47 實作報告

日期:2026-10-24。模型:Grok 4.7(opencode)。分支:`pollux0971/t47-opencode`。
開工 HEAD:`e645b52`(t47-start:紅測試已在起點)。

## 第一步金鑰檢查

```
$ [ -n "$OPENAI_API_KEY" ] && echo SET || echo UNSET
UNSET
$ [ -n "$ANTHROPIC_API_KEY" ] && echo SET || echo UNSET
UNSET
$ ls .env
ls: cannot access '.env': No such file or directory
```

LLM 真呼叫:0。沒有建立或讀取 `.env`,沒有使用任何 provider 金鑰。沒跑變異測試(`npm run mutate`、Stryker、cargo-mutants)、沒跑整條 `check:all`、沒有 `git push`。沒改測試檔、`features/**`、`.feature`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`opencode.json`、Rust 原始碼、`packages/core`、`packages/ui-shared`、`scripts/`。沒有自己跑 `cargo test` 或 `tauri build`。

## 做了什麼

`node_modules` 這個 worktree 原本沒有。用 `tar` 從 `/data/python/llm_learning-cards` 複製(不用 symlink;排除 `.vite`、`.vite-temp`、`node_modules/node_modules`;含 `apps/teach-card/node_modules`、`apps/test-card/node_modules`、`packages/ui-shared/node_modules`;不複製 `src-tauri/target`)。`node_modules/` 在 `.gitignore`,沒有 add。

只改兩個檔:

- `apps/desktop/src-tauri/tauri.conf.json`:教學卡視窗(`label: teach`)加 `minWidth: 360`、`minHeight: 400`。考試卡視窗與其他欄位一個字都沒動。沒開 `zoomHotkeysEnabled`。
- `apps/teach-card/src/App.svelte`(最外層仍是一個 `HudPanel`;沒有 `<svelte:window>`、沒有原生 `<button>`、沒有 `style=`、沒有 transition / animate;`<style>` 不新增 border / outline / box-shadow / clip-path,`.lc-example` 仍只有 `border-left`;顏色只用 `var(--hud-*)`):

  - 縮放級距 80 / 90 / 100 / 110 / 125 / 150 %,預設 100%。`Ctrl` 或 `Cmd` 加 `=` / `+`(含 `Ctrl+Shift+=`) / 數字鍵盤加號放大,`-` 與數字鍵盤減號縮小,`0` 與數字鍵盤 `0` 還原。到頭再按不變。這些鍵 `preventDefault`;沒按 Ctrl 的 `=` `-` `0`、`Ctrl+C`、`Ctrl+A` 不攔。監聽用 `$effect` + `window.addEventListener`,不用 `<svelte:window>`。
  - 只縮卡片內容(標示列、先備提示、標題、內文、例子)。包在 `.lc-scale` 上,`style:zoom`(CSS zoom,會重排)。不用 `transform`。按鈕列、狀態字樣、標題列、Wayland 提示不在這一層裡。
  - 級距記在 `deps.storage`,鍵 `lc-teach-zoom`。開視窗時讀,只有按鍵處理那條路會改。程式裡沒有 `setZoom(`、沒有 webview 縮放。
  - 按鈕列與 `.status-slot` 包在 `.dock`(`position: sticky; bottom: 0`),底色 `var(--hud-panel)`,不畫線。內文與例子仍在 `.hud-body` 裡一起捲。內容比視窗短時,這塊留在內容後面。
  - 放大層 `.lc-zoom` 放在縮放層與黏底區塊外面(放進 sticky 會縮成那一塊的大小;放進 zoom 會跟著內容縮)。
  - `.hud-body` 加 `scroll-padding-bottom: 200px`,讓 `scrollIntoView({ block: 'nearest' })` 把標題捲到黏底區塊上面。

`.hud-body` 的 `padding-bottom` 見「待協調」。

## 跑過的指令與輸出原文

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t47-window-static.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t47-zoom-layout-render.test.ts
 Test Files  1 passed (1)
      Tests  60 passed (60)
 Duration  130.04s
```

(這是 `padding-bottom: 0` 那一版。改成 1px 之後,教學卡整包又跑過,含這 60 條。)

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/
 Test Files  19 passed (19)
      Tests  289 passed (289)
 Duration  353.64s
```

`padding-bottom: 0` 時 HUD 的 T35 三條紅(教學卡):

```
FAIL  ... X11(沒有提示程式):...padding-bottom 是原本的值(> 0)...
AssertionError: expected 0 to be greater than 0

FAIL  ... 留白:提示在的時候,.hud-body 的 padding-bottom = 原本的值 + 提示現在的高度
AssertionError: 教學卡:留白多了: expected 69.0938 to be less than 53.59375

FAIL  ... 變窄重算:...
AssertionError: expected 128.797 to be less than 113.296875
```

改成 1px 之後:

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud/card-render-wayland-note-t35.test.ts
 Test Files  1 passed (1)
      Tests  21 passed (21)

$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/
 Test Files  25 passed (25)
      Tests  482 passed (482)
 Duration  347.40s
```

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/desktop/src/
 Test Files  20 passed (20)
      Tests  312 passed (312)
 Duration  6.58s
```

第一次跑這包時,`learning-root-probe.test.ts` 的冷編譯超過測試自己的 180 秒(`cargo build --bin lc-fs 失敗 status=error error=spawnSync cargo ETIMEDOUT`),其餘 302 條過。沒有另跑 cargo。增量再跑該檔 10 條過,然後整包重跑 312 條過(上面那次)。

```
$ npx tsc --noEmit
(無輸出)

$ npm run boundaries
boundaries: 掃描 374 個檔案,允許例外 24 條
涵蓋:納管 430 / 掃描 430 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=374

$ npx tsx scripts/check-doc-links.ts
doc-links: 掃描 259 個 markdown 檔,131 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=131
```

```
$ git diff --stat
 apps/desktop/src-tauri/tauri.conf.json |   2 +
 apps/teach-card/src/App.svelte         | 139 ++++++++++++++++++++++++---------
 2 files changed, 103 insertions(+), 38 deletions(-)
```

(提交前。報告檔另加。)

## 待協調

1. **`.hud-body` 的 `padding-bottom` 設成 1px,不是協調者說的 0。** 丟棄版的 `padding-bottom: 0` 讓測試 c、f 綠,但 T35 要求 X11 的計算值 `> 0`(`expected 0 to be greater than 0`)。另外,提示程式在卡片畫出來前就記 base:只在有 `.dock` 時歸零的話,它記到的仍是 16px,「base + 提示高度」對不上(實測 69px,要 53px)。捲到底時 `sticky` 的 `bottom` 不作用,16px 的 padding 會露在按鈕下面(測試 c 要 ≤ 2);`bottom: -1rem` 只在黏住時有效,捲到底仍是 16.3px。1px 同時滿足測試 c(≤ 2)、測試 f(按鈕在提示上面)、T35(`> 0`,而且提示記到的 base 與載入後量到的是同一個值)。若顧問堅持字面 0,T35 那條 `> 0` 要改,那不是這張能動的測試。
