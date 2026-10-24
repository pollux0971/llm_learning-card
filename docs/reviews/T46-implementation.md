# T46 實作報告

日期:2026-10-24。模型:Grok 4.7(opencode)。分支:`pollux0971/t46-opencode`。
開工 HEAD:`e479955`(t46-start:紅測試已在起點)。

## 第一步金鑰檢查

```
$ [ -n "$OPENAI_API_KEY" ] && echo SET || echo UNSET; [ -n "$ANTHROPIC_API_KEY" ] && echo SET || echo UNSET; ls .env
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

LLM 真呼叫:0。沒有建立或讀取 `.env`,沒有使用任何 provider 金鑰。沒跑變異測試(`npm run mutate`、Stryker、cargo-mutants)、沒跑整條 `check:all`、沒有 `git push`。沒改測試檔、`features/**`、`.feature`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`opencode.json`、`src-tauri`、`packages/core`、`packages/ui-shared/src/hud/`、`scripts/`。

## 做了什麼

`node_modules` 這個 worktree 原本沒有。用 `tar` 從 `/data/python/llm_learning-cards` 複製(不用 symlink,排除 `node_modules/node_modules`)。複製後 `node_modules/@learning/ui-shared` 指到這個 worktree 的 `packages/ui-shared`。`node_modules/` 在 `.gitignore`,沒有 add。

新增 `packages/ui-shared/src/image-path.ts`,從 `index.ts` 匯出 `resolveImagePath`。`packages/ui-shared/` 已歸 07-teach-card,`boundaries.owners.json` 不用改(腳本受保護;先確認已涵蓋)。`npm run boundaries` 過。

路徑規則(測試 agent 選的那一邊:`.` 段與空段拒絕,不正規化):

- 相對於卡片目錄走完 `..`;走出 learning 根就拒絕。
- 走完之後第一段必須正好是 `assets`,而且至少還有一段檔名。
- 整串過契約 §13 白名單(字元集合、NFC、不以點開頭或結尾、保留名、UTF-8 ≤ 240)。不解碼。`\`、`?`、`#`、`%`、絕對路徑、網址都拒絕。

`example-fence.ts`:

- 例子輸出 `<details class="lc-example" open><summary>…</summary>…</details>`。一個例子標題「例子」,多個「例子 1」「例子 2」…,編號每次渲染重算,不跨次累加。`examplesOpen: false` 時不加 `open`(第一幀就收,不在掛上去之後改)。
- 帶 `{ cardDir, assetUrl }` 時,fence 與內文共用 image 規則,拿 markdown-it `normalizeLink` 之前的原文路徑。過了 `src` 用 `assetUrl` 的回傳值(另加 `data-asset-path` 給找不到時用);不過或 `assetUrl` 丟錯,輸出「圖片路徑不能用:<原文>」(跳脫 `<` `>` `&` `"`)。不帶選項時圖片路徑原樣。
- 抓原文路徑時,解析 alt 會再進 image 規則,巢狀呼叫會把外層抓到的字清掉。存回外層的值,否則 alt 含角括號的那條會落到預設 `<img>`。

`App.svelte`(仍是最外層一個 `HudPanel`,沒有 `<svelte:window>`、沒有原生 `<button>`、沒有 `style=`、沒有 transition/animate):

- 折疊狀態記在 `deps.storage`,鍵 `lc-teach-example-open`(`'1'` / `'0'`,沒有鍵 = 展開)。只在算 html 時讀,不放進 `$state`,按標題不重算整張 html。容器上 capture 聽 `toggle`,只寫 storage。
- 容器上 capture 聽 `error`,把那張圖換成「找不到圖片:<解析後的路徑>」(textContent,不當 HTML)。
- 按例子裡已載入的 `img` 開放大層,在 `HudPanel` 裡面。`position: fixed` 用 JS 把盒子對到視窗(`.hud-cut` 的 `clip-path` 會變成 fixed 的包含塊,純 `inset: 0` 蓋不到視窗邊)。圖的寬高用原圖 `naturalWidth` / `naturalHeight` 對 `window.innerWidth` / `innerHeight` 等比算,`style:width` / `style:height` 設上去(小圖才會放大)。同一個 `src`。放大層任何 click 關掉並 `stopPropagation`;Esc 用 `$effect` + `window.addEventListener`。佔位字樣不是 `img`,不能放大。
- 顏色只用 `var(--hud-*)`。`.lc-example` 仍只有 `border-left`。沒有新的 CSS 變數,沒有畫框例外。

`main.ts`:瀏覽器版 `fs.assetUrl` 回 `/__asset?path=`(逐段 `encodeURIComponent`)。Tauri 版本來就是 `createLearningFs()`。

`teach-session.ts`:只把 `fs` 改成 `Pick<LearningFs, 'read' | 'assetUrl'>`。沒有 `setTimeout`、`sleep`、`now`,也不自己判斷 busy。

`dev/standalone.ts`:`GET /__asset?path=` 只回最上層 `assets/` 底下的圖檔。`..` 在字串上擋,resolve 之後再確認落在 `assets/` 裡(測試用 `.png` 跳出目錄)。Content-Type 依副檔名。不存在、目錄、空路徑、不是圖,都 404,不落到 index.html。暫存根起來時寫一張 1×1 PNG 到 `assets/seed.png`。

## 跑過的指令與輸出原文

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/image-path.test.ts packages/ui-shared/src/example-fence.test.ts`(修 alt 巢狀抓路徑之後):

```
 Test Files  2 passed (2)
      Tests  89 passed (89)
   Start at  09:31:12
   Duration  411ms (transform 81ms, setup 47ms, import 56ms, tests 111ms, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/dev/t46-asset.test.ts`:

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  09:31:15
   Duration  2.02s (transform 43ms, setup 39ms, import 17ms, tests 1.87s, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/t46-examples-images-render.test.ts`:

```
 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  09:31:21
   Duration  39.53s (transform 106ms, setup 40ms, import 92ms, tests 39.30s, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/`(改 `classList` 之前;card-static 一條紅,其餘綠):

```
 Test Files  1 failed | 24 passed (25)
      Tests  1 failed | 424 passed (425)
   Start at  09:32:05
   Duration  197.66s
```

紅的原因是 `App.svelte` 寫了 `classList`(card-static 禁止,那兩個 class 由桌面殼決定)。改成看 `className`。最終程式再跑一次全套:

```
 Test Files  25 passed (25)
      Tests  425 passed (425)
   Start at  09:41:31
   Duration  197.76s (transform 354ms, setup 224ms, import 709ms, tests 194.45s, environment 2ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/`(最終的 `App.svelte`):

```
 Test Files  15 passed (15)
      Tests  203 passed (203)
   Start at  09:35:39
   Duration  143.93s (transform 361ms, setup 152ms, import 538ms, tests 141.81s, environment 1ms)
```

含 t46 三檔、example 相關、HUD 不在這包;t43-deepen、t44、t45、teach-session、t40-busy 都在這 203 條裡。

`NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and @phase-4 and not @manual' --format summary`:

```
1 scenario (1 passed)
3 steps (3 passed)
0m59.622s (executing steps: 0m00.025s)
```

(前面 59 秒是側車步驟觸發的 `lc-fs` debug build,場景本身 0.025 秒。)

`NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and @phase-1' --format summary`:

```
10 scenarios (10 passed)
41 steps (41 passed)
0m12.429s (executing steps: 0m05.366s)
```

`NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and @phase-2 and not @manual' --format summary`:

```
5 scenarios (5 passed)
25 steps (25 passed)
0m07.146s (executing steps: 0m06.590s)
```

`NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and @phase-3 and not @manual' --format summary`:

```
8 scenarios (8 passed)
49 steps (49 passed)
0m10.736s (executing steps: 0m10.159s)
```

`npx tsc --noEmit`:先紅一條(`MarkdownEnv` 缺 index signature,對不上 markdown-it 的 `Env`)。補上 `[key: string | symbol]: unknown` 之後沒有輸出。

`npm run boundaries`:

```
boundaries: 掃描 368 個檔案,允許例外 24 條
涵蓋:納管 424 / 掃描 424 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=368
```

`npx tsx scripts/check-doc-links.ts`:

```
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=131
```

`git diff --stat`(報告與新檔 image-path.ts 在 commit 前另計):

```
 apps/teach-card/dev/standalone.ts       |  70 +++++++++++++-
 apps/teach-card/src/App.svelte          | 166 +++++++++++++++++++++++++++++++-
 apps/teach-card/src/main.ts             |   3 +
 apps/teach-card/src/teach-session.ts    |   2 +-
 packages/ui-shared/src/example-fence.ts | 130 +++++++++++++++++++++++--
 packages/ui-shared/src/index.ts         |   3 +
 6 files changed, 361 insertions(+), 13 deletions(-)
```

`teach-session.ts` 的 diff 只有 `fs` 那一行型別。`git diff --name-only` 看不到受保護檔、`prompts/`、`contracts/`、`src-tauri`、`packages/core`、`packages/ui-shared/src/hud/`、`scripts/`、`features/`。

## 待協調

沒有。測試沒改,card-static 沒有加例外。折疊鍵名工單沒釘,用 `lc-teach-example-open`;行為(換卡、重載)由渲染測試 a 守,不靠鍵名。
