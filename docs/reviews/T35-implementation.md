# T35 實作報告:Wayland 一次性提示讓出位置

日期:2026-10-23。模型:Grok 4.7(opencode)。
開工 HEAD:`9a0c8f3`(T35 紅測試已在起點)。
實作 commit:`44360f6`。
API key 開工檢查:

```text
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

沒有跑變異測試(`npm run mutate`、cargo-mutants、Stryker)、沒跑 `npm run check:all`、沒有建立或使用 `.env`、沒有用 provider 金鑰。LLM 真呼叫:0。沒改測試檔、`features/steps/**`、`features/support/**`、`.feature`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`hud.css`、HUD 元件、兩張卡的 `App.svelte`、`opencode.json`。沒有 `git push`。沒登入、沒登出、沒用 skill。

## 做了什麼

落點只有工單列的 `apps/desktop/src-tauri/src/wayland_note.js`。`git diff --stat`(commit 前):

```text
 apps/desktop/src-tauri/src/wayland_note.js | 137 +++++++++++++----------------
 1 file changed, 63 insertions(+), 74 deletions(-)
```

1. **提示固定在底部,不往上挪。** 刪掉 T34 的 `otherCenters`、`covers`、`clampInside`,以及「蓋到按鈕中心就往上挪」「還蓋到就改成右下角窄條」兩段。`pin`(第 66–80 行)每次都把提示設成 `left`/`right`/`bottom` = `8px`、`top: auto`、`width: auto`、`max-width: none`。捲動、換畫面、縮放都不改這個位置。
2. **讓出位置。** `scrollArea`(第 32–34 行)只找 `[data-hud="panel"].hud-fill .hud-body`,找不到就不加。`reserve`(第 48–63 行)在設 inline 之前記下該元素原本的 inline 值與計算出來的 `padding-bottom`;之後把 inline 的 `padding-bottom` 設成「那個計算值 + `getBoundingClientRect().height`」。同一個元素不重讀計算值,避免把已經加上的留白再加一次。樣式只走 `setProperty` / `removeProperty`,沒有 `style` 屬性、`innerHTML`、`<style>`、`cssText`。顏色仍只用 `var(--hud-*)`。提示 `pointer-events: none`、按鈕 `auto` 照舊。
3. **高度變了就重算。** `ResizeObserver` 看提示自己(第 152–157 行),寬度、換行、字型讓高度變了就再呼叫 `reserve`,用當下的高度重設留白。
4. **按「知道了」拿掉留白。** 按鈕的 click(第 137–145 行)呼叫 `stop`(第 82–93 行):先拆掉 `MutationObserver` 與 `ResizeObserver`,再 `release`(第 37–45 行)。原本的 inline 值是空的就 `removeProperty('padding-bottom')`,不是寫死 `16px`;有原本的 inline 值才設回去。`closed` 擋住按掉之後的回呼再把留白加回來。
5. **其他照 T34。** 字樣、`知道了`、`localStorage` 鍵 `lc-wayland-note-dismissed`、等 `DOMContentLoaded` / `readyState` 才畫,都沒改。X11 不帶這段程式,這張沒動 Rust。`MutationObserver` 留著,只在 `.hud-body` 晚出現或被換成另一個元素時重新記原本的值並再留白;改 inline style 不會觸發 `childList`。

## must_catch 對到哪段

| must_catch | 程式 |
|---|---|
| 拿掉底部留白:捲到底時最下面那顆按鈕跟提示的重疊面積大於 0 | `reserve` 第 61–62 行:`.hud-body` 的 inline `padding-bottom` = 設之前的計算值 + 提示現在的高度。拿掉這兩行,捲到底的矩形重疊不會是 0 |
| 擺位改回只看按鈕正中心、把提示往上挪 | `otherCenters` / `covers` / 往上挪 / 右下角窄條已刪。`pin` 第 68–78 行只寫死底部 8 px,不讀別的按鈕。加回 T34 的挪位,「左右各 8、離底 8、每個畫面矩形一樣」會紅 |
| 留白只在第一次顯示時算一次,變窄之後不重算 | `ResizeObserver` 第 152–157 行,回呼進 `reserve`,每次讀 `getBoundingClientRect().height`(第 61 行)再設。拆掉觀察者、只在 `show` 算一次,「變窄重算」會紅 |
| 按了「知道了」之後留白沒有拿掉 | click 第 143 行 `stop` → `release` 第 43–44 行:空的 inline 用 `removeProperty`,不寫 `16px`。`closed`(第 15、49、67、83 行)讓按掉之後的觀察者回呼不再設回去 |
| 留白加在別的元素上,或用 style 屬性、innerHTML、style 標籤 | 只對 `scrollArea()`(第 11、33 行的選擇器)呼叫 `setProperty('padding-bottom')`。樣式仍走 `paint` 的 `setProperty`(第 25–29 行)。沒有 `setAttribute('style')`、`style=`、`cssText`、`innerHTML`、`createElement('style')`、色碼字面值 |
| T34 既有的提示測試任一變紅,或任何 .feature 被改 | 沒改測試與 `.feature`。字樣、鍵、按鈕、`pointer-events`、`var(--hud-*)`、等頁面載入都留著。T34 的 `card-render-wayland-note.test.ts` 16 條與 `wayland-note-static.test.ts` 仍綠 |

## 待協調

沒有。紅測試沒改。覺得沒有測錯的地方。

沒跑的(工單說 cucumber / cargo 是重活,要先問位子;這張完成條件沒有列它們):`apps/desktop/src-tauri` 的 `cargo test`、cucumber。Rust 與 `.feature` 都沒改。`@manual` 那張表的數字這張不量,留給前端。

## 遇到的問題

- 這個 worktree 沒有 `node_modules`。第一次 `npx vitest` 因此起不來(`Cannot find package 'vitest'`)。`package-lock.json` 與主簽出 `/data/python/llm_learning-cards` 相同,所以把那邊的 `node_modules`(根、`packages/ui-shared`、`apps/test-card`、`apps/teach-card`)做成 symlink,沒跑 `npm ci`、沒打網路。`.gitignore` 的 `node_modules/` 對不上 symlink,`git status` 會看到 `?? node_modules` 等四條;沒有 add、沒有 commit。
- 沒有用 CodeGraph。工單落點是寫死的一個檔。

## 指令與輸出原文

開工金鑰檢查(exit 2,`.env` 不存在是預期的):

```text
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

第一次 vitest(symlink 之前,exit 1):

```text
failed to load config from /home/pollux/orca/workspaces/llm_learning-cards-workers/t35-opencode/vitest.config.ts

⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from /home/pollux/orca/workspaces/llm_learning-cards-workers/node_modules/.vite-temp/vitest.config.ts.timestamp-1792744299463-92b5b0e3a1d6d.mjs
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud/card-render-wayland-note-t35.test.ts`:

```text
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t35-opencode

 Test Files  1 passed (1)
      Tests  17 passed (17)
   Start at  16:32:05
   Duration  37.79s (transform 128ms, setup 45ms, import 129ms, tests 37.52s, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud/card-render-wayland-note.test.ts`:

```text
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t35-opencode

 Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  16:33:00
   Duration  41.21s (transform 166ms, setup 56ms, import 173ms, tests 40.84s, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud/render-test-support.test.ts apps/desktop/src/wayland-note-static.test.ts`:

```text
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t35-opencode

 Test Files  2 passed (2)
      Tests  31 passed (31)
   Start at  16:33:01
   Duration  619ms (transform 251ms, setup 80ms, import 232ms, tests 25ms, environment 0ms)
```

`npx tsc --noEmit`:沒有輸出,exit 0。

`npm run boundaries`:

```text
> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t35-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t35-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t35-opencode/scripts/gates.config.json
boundaries: 掃描 355 個檔案,允許例外 23 條
涵蓋:納管 411 / 掃描 411 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=355
```
