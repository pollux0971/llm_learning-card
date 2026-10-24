# 驗收 T46:教學卡例子折疊與圖片(實作)

- 被驗分支:`t46-impl`,sha `b447a2da408eb417c44971952ca39ebc032b706f`(基底 `t46-start`,紅測試 `t46-red` 的 `8e71cb2`)
- 驗收開跑與跑完的 tree sha:`7724da56b5e217f6d7f64b42db96fdd65e7df47a`(前後相同,手改全部還原,`git status` 乾淨)
- 日期:2026-10-24;驗收 agent;`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`;worktree 沒有 `.env`
- 結論:**有阻擋項**(變異分數未達 80,見下;其餘全過)

## 測試作者

`git diff --name-only e479955..t46-impl` 共 8 檔:`standalone.ts`、`App.svelte`、`main.ts`、`teach-session.ts`(只有 `fs` 型別那一行)、`example-fence.ts`、`image-path.ts`、`index.ts`、`T46-implementation.md`。沒有 `*.test.ts`、`features/`、`hud/`、`core/`、`scripts/`、`src-tauri`。`mutants.out` 0。

## 基準(未改壞)

| 項目 | 結果 |
|---|---|
| tsc | 乾淨 |
| boundaries | 368 檔,無違規 |
| doc-links | 131 檔,無壞連結 |
| vitest ui-shared 與 teach-card 全部 | 40 檔 628 條全過(含 t46 三檔、HUD card-static 與 card-render、T34/T35、T43–T45) |
| cucumber `@teach-card and @phase-4 and not @manual` | 1 場景過(lc-fs 重編,新產物) |
| cucumber `@teach-card` phase-1 / phase-2 / phase-3 | 10 / 5 / 8 場景全過 |
| cucumber `@hud-skin and @phase-2` | 4 場景全過 |

## 讀 diff

- card-static 禁令:`App.svelte` 最外層仍只有一個 HudPanel;沒有 `<svelte:window>`(用 `$effect` 加視窗監聽)、原生 button、`style=` 屬性(只用 `style:` 指令)、transition、border/outline/clip-path、顏色字面值;`.lc-example` 仍只有 `border-left`。
- 放大層的定位:放大層在 HudPanel 裡面,用 JS 量自己的矩形、把盒子對到視窗(量到的差值回推,不寫死)。**探針**(丟棄式渲染測試,不進 git):放大期間把 `.hud-body` 捲到底、捲回頂、捲 40 px,放大層矩形都是 0,0,360×480;視窗改成 480×600,放大層跟著變 480×600,圖仍置中。站得住。
  - 小缺點(L2):視窗縮放時,圖的寬高不重算(360×180 的圖在 480×600 的視窗裡仍是 360×180,沒有再放到最大)。放大期間改視窗很少見。
- example-fence:原文路徑取自 `normalizeLink` 呼叫的第一個引數(跳脫與實體已處理),巢狀 alt 的情況有保存外層的值;佔位字樣 `escapeHtml`;`examplesOpen` 只在輸出 HTML 時決定 `open`。
- `/__asset`:字串上擋 `..`、反斜線、NUL、開頭斜線,再要求 `assets/` 開頭、resolve 之後落在 `assets/` 底下、是檔案、副檔名在圖片白名單。
- `teach-session.ts`:diff 只有型別一行,沒有 setTimeout、sleep、now、busy。
- 特例檢查:實作裡沒有測試的 fixture 檔名或標記(grep 只命中 `seed.png`,那是單獨執行種子圖,工單要求)。

## 變異(Stryker CLI,經 `npm run mutate`)

指令:`npm run mutate -- stryker.t46-ui.json`(設定檔在本分支;mutate 範圍是 `example-fence.ts` 與 `image-path.ts`,測試是 `image-path.test.ts` 與既有的 `example-fence.test.ts`;原始 JSON 存在驗收暫存區)。

| 檔 | 分數 | 殺 | 逾時 | 活 |
|---|---|---|---|---|
| example-fence.ts | 66.67 | 97 | 1 | 49 |
| image-path.ts | 79.17 | 95 | 0 | 25 |

**兩個檔都低於工單的 80,必須紅。** 存活分三類:

1. 單元測試沒有走到 `examplesOpen: false` 的輸出(`open` 不加):`example-fence.ts` 約 20 個存活集中在 `examplesOpen` 的判斷、輸出的 `open` 字串、`renderMarkdown` 的 env。這幾條由渲染測試 a/b 守(我的手改 H1、H19 變紅),但 Stryker 這個設定沒有跑渲染測試,所以算活。**要補一條單元測試**:`renderMarkdown(…, { examplesOpen: false })` 輸出沒有 `open`、標題與內容仍在;`examplesOpen: true` 與不帶 `examplesOpen` 都有 `open`。
2. `image-path.ts` 真的測試缺口:保留名只測了 con / NUL / com1。存活的有 prn、aux、com2–9、lpt1–9、`¹²³` 結尾(約 11 個);`cardDir` 為空字串的分支沒測。**要補**:`prn.png`、`AUX`、`com9.png`、`lpt1.png`、`com¹.png` 拒絕;`cardDir` 為空時 `assets/a.png` 過、`../assets/a.png` 拒絕。
3. 等價或多層防線(不要求補):空字串、反斜線、開頭斜線、`.`/空段、整串 NFC 與逐段 NFC 互相重複(拿掉一個,另一個還在);抓原文路徑的巢狀保護(其中「alt 裡再有圖」的情況值得一條單元測試:`![a ![b](../../assets/x.png)](../../assets/c.png)`,`assetUrl` 只收到 `assets/c.png`)。

估計補完第 1、2 點後 `image-path.ts` 約 88、`example-fence.ts` 約 80 以上;補完要重跑確認。

## 手改(App.svelte 與路由,作者沒跑變異,所以 20 個都是我的)

測試:`apps/teach-card/src/t46-examples-images-render.test.ts`(依類別 -t 篩)、`apps/teach-card/dev/t46-asset.test.ts`、單元兩檔。紅 13、活 7。

| 編號 | 改了什麼 | 結果 |
|---|---|---|
| H1 | 預設改成收起 | 紅(內容看得到:expected false to be true,12 條) |
| H2 | 不寫 storage | 紅(換類別之後每一幀都要收起) |
| H3 | 拿掉 toggle 監聽 | 紅 |
| H4 | 記反(寫成 !open) | 紅(展開後換下一張要展開) |
| H5 | 拿掉 error 監聽 | 紅(不存在的圖要出現字樣) |
| H7 | 放大層按了不關 | 紅(放大層要關掉) |
| H8 | 拿掉 Esc 監聽 | 紅(Esc:關掉) |
| H11 | 放大取 max 比例 | 紅(不超出視窗) |
| H12 | 找不到字樣不寫路徑 | 紅 |
| H13 | cardDir 恆為空 | 紅(圖要載好) |
| H14 | assetUrl 不用 | 紅 |
| H18 | 單一例子也編號 | 紅(例子 1 vs 例子) |
| H19 | 不讀 storage 永遠展開 | 紅 |
| H6 | 內文裡的圖也能放大(拿掉「要在 .lc-example 裡」) | **活**(L2:工單只說例子裡的圖;沒有測試證明內文的圖不放大) |
| H9 | 放大層 click 不攔截 | 活(等價:放大層在內文容器外面,事件不會冒到它) |
| H10 | 拿掉 mousedown/mouseup 攔截 | 活(同上) |
| H15 | 拿掉 `.body img { max-width: 100% }` | **活**(L2:沒有寬圖測試,寬圖會超出卡片) |
| H16 | 放大層 z-index 改 0 | 活(低:現況沒有比它更高的疊層) |
| H17 | `/__asset` 不看圖片副檔名 | 活(L2:路由測試只試 .md;assets 底下的非圖檔會以 image/png 回) |
| H20 | 放大前不檢查 naturalWidth | 活(等價:載入失敗的圖已被換成字樣) |

## `learning/` 前後

| | 檔案數 | 雜湊(前 16 碼) | 帳本行數 |
|---|---|---|---|
| 前 | 64 | c2e4dd6d71de3976 | 108 |
| 後 | 64 | c2e4dd6d71de3976 | 108 |

## 花費

worker 花費(協調者給的):12.93 美元,工單估 5 美元,2.6 倍,超過 2 倍;只記錄不退回(grok 不設限額)。驗收本身 LLM 呼叫 0。

## 結論

有阻擋項:變異分數未達 80(`example-fence.ts` 66.67、`image-path.ts` 79.17)。缺口都在測試,不在實作:請 -a6 補上面「變異」第 1、2 點的單元測試(外加 alt 裡再有圖那條),再由我重跑變異確認 ≥ 80。另有 4 個低風險缺口可順手補:寬圖不超出卡片、內文的圖不放大、`/__asset` 對非圖檔回 404、視窗縮放時放大圖重算(最後一項要實作改,先記著)。實作本身其餘全過。
