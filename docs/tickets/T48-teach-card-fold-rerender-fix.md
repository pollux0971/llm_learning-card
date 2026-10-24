---
id: T48
deps: [T46]
touches: [apps/teach-card/src/]
cpu: light
budget_usd: 2
status: dispatched
owner: worker-grok
must_catch:
  - 同一張卡上每次 pull 都重算 html(或照舊在 parsed 裡讀 storage):渲染測試 f 必須紅(別的例子被改、details 節點換了一顆、按鈕動、缺圖再要一次)
  - 只把讀 storage 包進 untrack,同卡仍會重跑 parsed、拿到新的 storage 值:渲染測試 f 必須紅
  - 鍵只看 path,同一個 path 的 cardText 變了不重算(或鍵永遠不變、換卡還是舊的 html):渲染測試 h 與 T46 的渲染測試 a 必須紅
  - 換卡(下一個、換類別、深入完成、回上一層、先備提示)沒有重讀 storage,新卡的例子不是最後一下的狀態:T46 的渲染測試 a 必須紅
  - 放大時視窗改大小,圖不重算(停在原本的寬高)、或重算成超出視窗、或比例跑掉:渲染測試 g 必須紅
  - 比視窗高的圖放大後超出視窗或被裁;裝得進視窗的圖放大後比卡片裡小:渲染測試 g 必須紅
  - App.svelte 留著選不到任何元素的樣式(例如 scoped 的 .lc-missing),或找不到圖片的字樣比例子裡的字大:靜態測試 i 必須紅
  - 實作動到 touches 以外的檔:不動的地方那條 diff 檢查必須有輸出
  - T43 到 T46 的教學卡測試、HUD 的 card-static 與 card-render、Wayland 提示的 T34 與 T35 測試任一變紅:不退步必須紅
---

# 工單 T48:同一張卡不重畫例子、放大跟著視窗重算(T46 `@manual` 的 F1、L2、O5、F2)

> 狀態:起草 2026-10-24,依技術顧問 2026-10-24 對 T46 `@manual` 的裁決(協調者轉述;顧問交代寫好直接交協調者合)。規格:UI/Tauri 負責人。編號 T48:協調者配。
> 實作:worker(opencode + grok-4.7);紅測試(渲染測試 f、g、h,靜態測試 i):測試 agent;驗收:驗收 agent;`@manual`:前端,技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 依據:`../reviews/T46-manual-2026-10-24.md` 的 F1、F2、L2、O5;`T46-teach-card-examples-images.md` 的「做法」(折疊狀態只在換卡時讀)與第 4 條(放大);`T45-teach-card-status-layout.md`(按鈕 0 px、字樣看得到);SKILL §4g 第 29 條(使用者看得到的狀態轉換要真渲染)。
> 基底:main `3a1913b` 或之後。**順序**(協調者):T48 先做完、合併;T47 等 T48 合併後再派(兩張都改 `../../apps/teach-card/src/App.svelte`)。
> **LLM 真呼叫 0。**

## 為什麼有這張

T46 `@manual` 在真的 app 裡量到(證據 `../reviews/T46-manual-2026-10-24.md`):

- **F1**:同一張卡上,使用者手動收放過例子之後按「深入這個」,整張卡重畫。
  - 只開例子 2、最後按的是「開」:按深入後三個全開。卡從 625 px 變 1926 px,按鈕從 y 339 被推到 1640,生成中那一行與「取消」出了畫面。
  - 最後按的是「收」:例子 2 自己收起來。
  - 不存在的那張圖每重畫一次就再要一次;三個開著時「沒字 → 生成中」那一下,按鈕跳 9 px 一幀。T45 的 0 px 在這個情況下不成立。
  - 根因(顧問在 `../../apps/teach-card/src/App.svelte` 第 53、61 行確認):第 61 行 `shown = $derived(parsed())` 依賴 `view`;第 22–23 行每次 `pull()` 都換一個新的 `view`,所以同一張卡上每次 `pull()` 都重跑 `parsed()`,第 53 行在裡面重讀 storage。storage 從畫這張卡之後變過,html 字串就不同,`{@html}` 整塊換掉。
  - 自動測試沒抓到:T46 的渲染測試 b 只量「按一個標題」,沒有量「按標題之後再做會 `pull()` 的動作」。
- **L2**:放大時視窗改大小,放大層跟著變,圖的寬高不重算(480×600 的視窗裡還是 360×90)。
- **O5**:第 377 行的 `.lc-missing` 樣式選不到任何元素(「找不到圖片」的 `span` 是執行時用 `document.createElement` 建的,Svelte 的元件樣式套不到),是死樣式。Svelte 編譯時已經有 `css_unused_selector` 的警告。
- **F2**:比視窗高的圖(240×960),「放到視窗裝得下的最大」與「比卡片裡大」不能同時成立。顧問裁了新的規則(第 4 條)。

## 要的結果(量結果,不綁做法)

畫面是 `App.svelte` 真的畫出來的樣子,視窗 360 × 480(第 3 條另換大小)。

### 1. 同一張卡,例子的 html 只算一次

- **鍵** = 現在這張卡的 `view.card` 的 path 加上 `cardText`。鍵沒變,卡片內文(含例子)的 html 就是同一份:
  - 不重算 html,不重讀 storage;
  - 畫面上每個例子的 `details` 是同一顆 DOM 節點,開或收維持使用者最後留下的樣子;
  - 「找不到圖片」換上去的字樣留著,不換回 `img`、不再要一次那張圖。
- **換卡** = path 或 `cardText` 變了。含按「下一個」、換類別、深入完成(換到子卡)、回上一層、先備提示換過去。換卡時才讀 storage,照 T46 第 1 條:新卡每個例子從「最後一下」的狀態開始,從第一幀就是。
- 會在同一張卡上觸發 `pull()` 的動作都算「同一張卡」:按深入(生成中)、取消、深入出錯、輪詢、忙碌提示。
  - 側車每回一次帶著卡片的畫面,session 都會重讀一次卡片檔(`../../apps/teach-card/src/teach-session.ts` 第 198 行)。內容一樣,鍵就一樣。
- T45 照舊:這些轉換裡,按鈕每一幀差 0 px、`scrollTop` 不變、生成中那一行與「取消」看得到。

### 2. 放大後的大小(F2,取代 T46 第 4 條第一點的那一句)

- 放大後 = **等比例、裝進視窗的最大**(不超出視窗、不裁切,寬或高其中一邊剛好碰到視窗)。
- **只有卡片裡顯示的大小本來就裝得進視窗時**,才要求放大後至少一樣大。
- 比視窗高或寬的圖(例如 240×960),放大就是「整張看得到」,不保證比卡片裡大。
- T46 第 4 條其他各點照舊(蓋整個視窗、按任何地方或 Esc 關、關的那一下不穿過去、不載第二份、佔位字樣不能放大)。

### 3. 放大時視窗改大小(L2)

- 放大層開著的時候視窗改大小(放大或縮小):放大層照舊蓋滿新的視窗,圖照第 2 條**重算**成新視窗裝得下的最大,比例不變。
- 改回原本的大小,圖也回到原本的大小。

### 4. 不留死樣式(O5)

- `App.svelte` 的 `<style>` 不留選不到任何元素的規則。`.lc-missing` 改成 `:global(.lc-missing)` 讓它生效,或刪掉那條。二選一,worker 定。
- 「找不到圖片」字樣的字級跟例子裡的字一樣或小一號(T46 第 5 條);顏色只用 `var(--hud-*)`、不畫框(card-static)。

### 5. 不變的

- T46 第 6 條全部照舊(例子框的樣子、`renderMarkdown` 的介面、HUD 樣本卡、版面、`onclick={handleNext}` 等)。
- `packages/ui-shared/`(含 `hud/`)、側車、協定、Rust、core、`teach-session.ts` 都不動。只改 `App.svelte`(要的話可以在 `apps/teach-card/src/lib/` 加一個小檔)。
- 不新增 npm 依賴。

## card-static 的禁止清單

照 T46 那一節,不需要新的例外:

- `:global(.lc-missing)` 只能寫字級、字色(`var(--hud-*)`);不寫 `border*`、`outline`。
- 放大的重算用 Svelte 的 `style:` 指令(CSSOM)。不寫 `style=` 屬性、不用 `.style.cssText`。
- 視窗監聽照 T46 用 `$effect` 加,不用 `<svelte:window>`(驗收 agent 在 T46 記過這條)。

## 做法(建議;量的結果才是驗收)

- `parsed()` 前面加一層記憶:記住上一次的鍵(path + `cardText`)與算出來的 html。鍵一樣就直接回同一個字串,不呼叫 `renderMarkdown`、不讀 storage。鍵不一樣才讀 storage、重算、記下來。
  - 回同一個字串時,Svelte 的 `{@html}` 不會換節點(它比的是字串相等)。
  - **只把讀 storage 包進 `untrack` 不夠**:`parsed()` 還是會因為 `view` 換了而重跑,重跑時讀到的是新的 storage 值,字串一樣會變。
  - 記一份就好(上一張卡)。回到之前看過的卡算換卡,照 storage 重算。
- 放大的重算:`resize` 時用那張圖的 `naturalWidth` / `naturalHeight` 照第 2 條重算寬高。現在第 122、140 行只在打開時算一次,第 193–194 行的 `place()` 只對位置。

## 驗收條件

### 1. 自動驗收(vitest 與 cucumber,測試 agent 寫)

| 層 | 指令 | 過的條件 |
|---|---|---|
| 教學卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/` | 全綠,含新的 f、g、h、i,T43–T46 既有的測試,T40 的靜態測試 |
| ui-shared | `VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/` | 全綠(HUD 的 card-static、card-render、Wayland 提示 T34 / T35、T46 的圖片路徑) |
| 不退步 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and @phase-4 and not @manual' --format summary`,另外 `'@teach-card and @phase-1'`、`'@teach-card and @phase-2 and not @manual'`、`'@teach-card and @phase-3 and not @manual'` | 全綠(拿位子) |
| 不動的地方 | `git diff --stat 3a1913b..HEAD -- packages contracts apps/desktop scripts features/07-teach-card apps/teach-card/src/teach-session.ts apps/teach-card/dev` | 沒有輸出(`features/steps` 是測試 agent 的,不在這裡) |

這張沒有新的純邏輯模組,不跑變異測試。改壞證明見第 2 節。

**渲染測試**(新檔,放 `apps/teach-card/src/`,例如 t48-fold-rerender-render.test.ts)。做法同 T46 的渲染測試:

- `../../packages/ui-shared/src/hud/render-test-support.ts` 的 `openApp(<apps/teach-card 的目錄>, { viewport: 360 × 480, initScript })`;`initScript` 改 `/__card`、`/__review`、記錄 `/__asset`。
- 用 T45 的每一幀取樣量(`requestAnimationFrame` 加 `MutationObserver`)。
- **不准**用讀原始碼比字串代替渲染(SKILL §4g 第 29 條);不改 `packages/ui-shared/src/hud/` 的測試支援。

**要被真渲染看到的畫面狀態**(f、g、h 在 `3a1913b` 上紅,紅的原因是「還沒有這個功能」;g 的 F2 部分本來就綠,要標出來):

- **f. 手動收放之後的深入**:三個例子的卡(例子 2 裡有一張不存在的圖),卡比視窗長。每一種都要做,而且各做一次「捲到頂」與「捲到底」:
  1. 進卡時 storage 是收(三個都收),手動只開例子 2(這時 storage 變開,畫面是 010)→ 按深入 → 生成中 → 按取消。
  2. 同上,但最後按的是「收」(例如開例子 1、2,再收例子 1:storage 收、畫面 010)→ 按深入 → 生成中 → 按取消。
  3. 同 1,但生成中之後是深入出錯(例如輪詢回其他深入錯誤)。

  從按深入的前一幀到取消(或出錯)之後 1 秒的每一幀都要成立:
  - 每個例子的開或收跟按深入之前相同;
  - 每個 `details` 跟按深入之前是同一顆節點(事先在節點上做記號,事後比對);
  - 按鈕的 x / y / 寬 / 高差 0 px,`.hud-body` 的 `scrollTop` 不變;
  - 生成中那一行與「取消」整塊在看得到的範圍裡(捲到底那一次);
  - `/__asset` 對不存在那張圖的請求數不增加;
  - storage 的值不被這些動作改掉。
- **g. 放大的大小**:
  1. 比視窗高的圖(例如 240×960)放大:整張在視窗裡、比例不變、高剛好碰到視窗(本來就綠,標出來)。
  2. 裝得進視窗的圖放大:至少跟卡片裡一樣大(T46 的 d 已經有,這裡只要不退步)。
  3. 放大開著時用 `page.resize(480, 600)` 換視窗:放大層蓋滿 480×600,圖重算成裝得進 480×600 的最大(寬或高其中一邊碰到,比例不變);再 `resize(360, 480)`:回到原本的大小。
- **h. 同一個 path,內容變了**:深入時 `/__card` 第二次回應改一個字(同一個 path)→ 這算換卡:html 重算,例子照 storage 的狀態畫。對照組:內容沒變時 html 不重算(就是 f)。

**靜態測試 i**(新檔,放 `apps/teach-card/src/`):

- 用 `svelte/compiler` 編譯 `App.svelte`,警告裡沒有 `css_unused_selector`。`3a1913b` 上是紅的:第 377 行 `.lc-missing`。
- 同一個檔(或渲染測試 e 裡)量:「找不到圖片」字樣的字級不大於例子裡的字。

### 2. 改壞證明(驗收 agent 的丟棄式證明)

`must_catch` 每一條各做一次:改了哪裡、哪一條紅、紅的訊息原文、還原後綠。至少:

- 拿掉記憶(每次都重算)→ f 紅;
- 記憶在,但每次照舊讀 storage 組字串 → f 紅;
- 只用 `untrack` 包住讀 storage → f 紅;
- 鍵只放 path → h 紅;鍵寫死成常數 → T46 的 a 紅;
- 拿掉 `resize` 的重算 → g 的 3 紅;重算用 `Math.max` → g 紅;
- 把 `:global(.lc-missing)` 改回 `.lc-missing`(或留一條選不到的規則)→ i 紅。

### 3. 觀感(`@manual`,前端做、技術顧問判)

T48 合併後,前端照 T46 `@manual` 的做法重做(暫存根 + 假網路、Xvfb `:97` + 巢狀 GNOME Shell、`PATH` 放 ibus-daemon 替身、MemoryMax=2G、XTest 真的指標;LLM 真呼叫 0;真的 learning/ 前後相同):

| 列 | 過的條件 |
|---|---|
| M1 | T46 的 M1 照舊過(折疊、換卡第一幀、重開 app) |
| M2 | T46 的 M2 照舊過(三個例子各自收放、鍵盤) |
| M4 | T46 的 M4 照舊過;高圖照第 2 條(整張看得到);放大時視窗改成 480×600 再改回,圖都是裝得進視窗的最大 |
| M6 | 截圖給顧問判;有例子的卡上 T45 的轉換 0 px(三個開著、三個收著) |
| F1-X1 | 只開例子 2、storage 開 → 深入 → 取消:三個例子不變、按鈕 0 px、生成中那一行看得到、缺圖不再要 |
| F1-X2 | 010、storage 收 → 深入 → 取消:同上 |

O1(縮放把手那一圈按了不關放大)、O3(捲軸畫在放大層上)、O4(「不能 / 用」折行)只記不修,不在這張驗。

## 受保護的檔(開發 worker 不改)

- 測試:`*.test.ts`、`*-test-support.ts`、`features/**`、`.feature`。worker 覺得測試有錯,寫進報告的「待協調」,不改。
- 實作:`packages/`(含 `ui-shared/src/hud/`)、`contracts/`、`apps/desktop/`、`scripts/`、`apps/teach-card/dev/`、`apps/teach-card/src/teach-session.ts`。

## 落點

`apps/teach-card/` → 07-teach-card(`../../scripts/boundaries.owners.json`)。不新增 import 例外。

## 顧問的裁決(2026-10-24,T46 `@manual`)

- M1–M5 過,M6 截圖過;**F1 是缺陷,擋 07p4 done**。
- 修法:同一張卡以 path 加 `cardText` 為鍵,html 只算一次;storage 只在換卡時讀。
- 渲染測試先手動收放成跟 storage 不同,再深入、生成中、取消或出錯;每一幀量其他例子不變、details 是同一顆、按鈕 0 px、缺圖不再要;在 `3a1913b` 上要紅。
- L2(放大層跟著視窗大小重算)、O5(`.lc-missing` 改 `:global` 或刪,不留死樣式)併進這張。
- F2:放大 = 等比例裝進視窗的最大;只有卡片裡的大小本來就裝得進視窗時,才要求放大後至少一樣大。
- O1、O3、O4 只記。
- T48 合併後,前端重做 M1、M2、M4、M6 與 F1 的兩種重現。

## 不在範圍

- O1、O3、O4。
- 縮放、長內容的版面、視窗大小下限(T47)。
- 例子的折疊狀態改成每個例子各記一個(T46 D2=A:記一個)。

## 預算

`budget_usd: 2`(只改 `App.svelte`;grok 不設停止線,只記錄)。沒有 LLM 花費。

`cpu: light`:沒有 Rust。渲染測試會起 vite dev server、headless Chrome 與側車;cucumber 是重活,協調者照重活排位子。

## 測試誰寫

- 紅測試(渲染 f / g / h、靜態 i):測試 agent。改壞證明:驗收 agent。開發 worker 以紅測試分支為基底,不改測試。
- 實作:worker(opencode + grok-4.7)。
- `@manual`:前端,技術顧問判。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 重活(vitest 完整、cucumber、渲染測試)先跟協調者拿位子:`VITEST_MAX_WORKERS=1`,cucumber 一律 `--tags`。
