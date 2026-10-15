# 14-hud-skin phase-1 實作報告(2026-10-15)

角色:phase-1 實作 agent。只改 `packages/ui-shared/src/hud/` 的新檔,沒有改測試檔。
紅測試與步驟定義是測試作者的 commit `2ca266e`(基底 `origin/main` `6798c1e`)。
沒有跑變異測試、`npm run check:all`、`--live`,沒有設 API key,沒有打網路 provider,沒有開 GUI。
session id:`ses_ec135bd6affejJv9hRtavqZ5F1`。

## 待協調

1. `features/14-hud-skin/FEATURE.md` 技術棧的字型那一列仍寫「選定後在這一列寫明字型名稱、版本、授權」。選定結果在下面「字型」。我沒改 FEATURE.md:這張只准動 `hud/` 與這份報告。要不要由協調者回寫那一列?
2. `standalone.json` 的 `14-hud-skin.pending` 仍在。展示頁指令現在跑得起來(cucumber 場景 1 綠)。依工單由協調者拿掉,我沒動共用檔。
3. 測試斷言沒有爭議。沒有「要改測試才能綠」的項目。
4. 畫面底列的累計 $ 我讀不到 UI,數字來自本機 session 資料庫 `session_v2.cost`(撰寫報告當下)。若底列與此不同,請協調者改成畫面上的數字。見文末。

## 開工狀態(原始輸出)

```
$ pwd; git log --oneline -3; echo "${OPENAI_API_KEY:-UNSET}" "${ANTHROPIC_API_KEY:-UNSET}" "${XAI_API_KEY:-UNSET}"; ls .env; git status --porcelain; jq -c .permission.skill opencode.json
/home/pollux/orca/workspaces/llm_learning-cards-workers/t14p1-opencode
2ca266e test(14-hud-skin): phase-1 紅測試 —— 步驟定義、hud/ 單元測試、測試輔助
6798c1e chore: 14-hud-skin 共用檔(standalone.json 加 pending 條目、boundaries.owners.json 加 hud 落點、roadmap 未排程加一列)
d354504 Merge hud-skin-spec(SAO HUD 外觀規格 14-hud-skin 與 ADR-071,只動 features/ 與決策表)
UNSET UNSET UNSET
ls: cannot access '.env': No such file or directory
{"*":"deny"}
```

`git status --porcelain` 沒有輸出(空)。5 分鐘負載當時 6.52,未超過 8。

## learning/ 基準

量法(唯讀,沒有讀寫 learning/、raw/、state/ 的內容以外的這三條):

```
cd /data/python/llm_learning-cards/learning && LC_ALL=C find . -path ./.git -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16
find . -path ./.git -prune -o -type f -print | wc -l
wc -l < state/log.jsonl
```

| 時點 | 檔數 | 雜湊前 16 碼 | log 行數 |
|---|---|---|---|
| 開工 | 64 | c5aa80b18b474ed4 | 52 |
| 收工(報告撰寫前再量) | 64 | c5aa80b18b474ed4 | 52 |

與預期 64 / c5aa80b18b474ed4 / 52 相同。

## 紅在哪(實作前)

`VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud`

```
 Test Files  7 failed | 1 passed (8)
      Tests  69 failed | 12 passed (81)
   Start at  17:04:49
   Duration  2.92s (transform 160ms, setup 163ms, import 185ms, tests 1.40s, environment 1ms)
```

通過的 12 條是測試輔助自己的檢查(`test-support.test.ts`)。69 條紅都是實作還不存在:動態載入找不到 `hp-bar.js` / `layout.js` / `window-controls.js`,`hud.css` 與五個 `.svelte`、`gallery/`、字型檔不存在。代表性錯誤:

```
Error: Cannot find module '/packages/ui-shared/src/hud/window-controls.js'
Error: hud/HudPanel.svelte 不存在
Error: hud/hud.css 不存在(設計值只有這一份)
AssertionError: gallery/index.html: expected false to be true
AssertionError: expected 0 to be greater than 0   # fontFiles()
```

## 做了什麼

全部在 `packages/ui-shared/src/hud/`。設計值只寫在 `hud.css`。元件樣式只用 `var(--hud-*)`,沒有 HTML `style=`、沒有 inline `<style>`。動畫只走 CSS。

| 設計值 | 寫死的值 |
|---|---|
| 內文 | `#333333` |
| 面板 | `rgba(255, 255, 255, 0.9)` |
| 框線 | `#000000`、`1px` |
| 切角 | `10px`(45° 切角,外層黑底 + 內層面板底,框線跟著切角走) |
| 亮點 | `#e87820`(只用在框線、底色、outline,不用來印字) |
| HP 條 | `#2f9e44`,右端斜切;滿(100)時填到底;0 時只剩框 |
| 展開 | `hud-expand 160ms ease-out`,不無限重複 |
| 減少動態 | `@media (prefers-reduced-motion: reduce)` 裡 `*, *::before, *::after { animation: none !important; transition: none !important; }` |

三條必有:

- 不在 Tauri:`createWindowControls` 在建立時用 `deps.isTauri()`(預設 `@tauri-apps/api/core` 的 `isTauri`)。false 時四個方法是空動作,不載入視窗、不丟錯、不 `console.error`。標題列不畫縮小與關閉鈕。
- 沒有 `hud-frameless`:不畫標題列、不畫 8 個縮放把手。有 class 才畫。按鈕還要 `controls.available`(在 Tauri)才畫。關閉鈕只呼叫 `controls.close()`,轉給視窗的 `close()`。
- `prefers-reduced-motion: reduce`:上面的總關閉。沒有 Svelte `transition:` / `in:` / `out:` / `animate:`,也沒有 `.animate()`。

`frameless` / `solid` 沒傳時,在 render 當下讀頁面根元素的 class(不是 `onMount`)。沒有 `document` 當作沒有 class。

展示頁:`gallery/index.html`、`main.ts`、`Gallery.svelte`、`vite.config.ts`(svelte 外掛;root 是 gallery 目錄,所以 `npx vite packages/ui-shared/src/hud/gallery` 會載到這份設定)。兩個 checkbox 用 `classList.toggle` 切 `hud-frameless` 與 `hud-solid`,並把同一個狀態傳進 `HudPanel`。文字來自 `contracts/fixtures/cards/valid-basic.md?raw`,沒有 import 06、07。

## 字型

| 項目 | 值 |
|---|---|
| 名稱 | Rajdhani Medium |
| 版本 | 1.201(name table id 5:`Version 1.201`) |
| 授權 | SIL Open Font License, Version 1.1 |
| 檔案 | `packages/ui-shared/src/hud/fonts/Rajdhani-Medium.ttf` 與同目錄 `OFL.txt` |
| 來源 | Google Fonts 倉庫 `ofl/rajdhani` 的 `Rajdhani-Medium.ttf` 與 `OFL.txt`(本機沒有現成 Rajdhani,從該倉庫取檔後放進 repo,執行時不連外部字型服務)。上游是 Indian Type Foundry,2014,倉庫 commit `86cae0e9a63279efa076915a470049dd76c044f0`。`@font-face` 的 `url()` 指向 `./fonts/Rajdhani-Medium.ttf`。 |

中文用系統字型。Rajdhani 只掛在標題、數字、按鈕。

## 轉綠(原始輸出)

單元測試(5 分鐘負載當時已是 10.18,這次沒先等;之後的 cucumber / tsc / boundaries 都等 5 分鐘平均降到 8 以下才跑):

```
$ VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud

 Test Files  8 passed (8)
      Tests  81 passed (81)
   Start at  17:14:32
   Duration  3.51s (transform 210ms, setup 164ms, import 222ms, tests 1.94s, environment 1ms)
```

場景:專案的 cucumber 載入器是 `NODE_OPTIONS=--import=tsx npx cucumber-js`。預設 `cucumber.js` 的 `import` 與 `paths` 是加總,不是取代;一載入全部步驟,`features/steps/desktop-shell-phase2.steps.ts` 的 `BeforeAll` 就會 `buildLcFs()`(cargo)。第一次誤用預設設定,cargo 跑完一次(`Finished dev profile [unoptimized + debuginfo] target(s) in 1m 51s`),那個行程已結束,沒有再跑。之後改用只含本 feature 與 `features/steps/hud-skin.steps.ts` 的暫存設定(在 `/tmp`,不進版控),tags `not @manual`,才沒有再編 Rust。

```
$ NODE_OPTIONS=--import=tsx npx cucumber-js --config <tmp>/cucumber-hud.js

13 scenarios (13 passed)
38 steps (38 passed)
0m02.996s (executing steps: 0m02.955s)
```

13 條都是 phase-1 非 `@manual`:

- The gallery runs on its own
- Body text stays readable on the panel
- The HP bar fills in proportion to progress(5 個 example)
- Without the frameless class there is no drawn title bar
- Outside the desktop app the title bar has no window buttons
- The drawn close button asks the window to close the normal way
- The HUD styles load nothing from outside
- The bundled font carries its licence
- Animations stop when less motion is requested

兩條 `@manual`(展示頁長相、實心底)沒跑,留給技術顧問看展示頁。

```
$ npx tsc --noEmit
```

沒有輸出,退出碼 0。

```
$ npm run boundaries
boundaries: 掃描 266 個檔案,允許例外 13 條
涵蓋:納管 317 / 掃描 317 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=266
```

`scripts/boundaries.owners.json` 已有 `packages/ui-shared/src/hud/` → `14-hud-skin`,沒有改它。

```
$ npx tsx scripts/check-doc-links.ts
doc-links: 掃描 120 個 markdown 檔,46 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=46
```

## 收工

```
$ git log --oneline origin/main..HEAD
e6384ac feat(14-hud-skin): phase-1 HUD 元件與展示頁
2ca266e test(14-hud-skin): phase-1 紅測試 —— 步驟定義、hud/ 單元測試、測試輔助
```

報告 commit 會接在 `e6384ac` 後面。不屬於測試作者 commit 的測試檔變動:

```
$ git diff --name-only 2ca266e..HEAD -- <hud 測試檔與 hud-skin.steps.ts、phase-1.feature>
(空)
```

`git status --porcelain`:報告 commit 之後應為空(這份檔進版控後再核一次)。

learning/ 前後:64 / c5aa80b18b474ed4 / 52 → 64 / c5aa80b18b474ed4 / 52。

累計 $(session_v2.cost,報告 commit 前):4.812138
session id:`ses_ec135bd6affejJv9hRtavqZ5F1`
