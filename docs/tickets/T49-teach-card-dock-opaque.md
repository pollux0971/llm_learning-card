---
id: T49
deps: [T47]
touches: [apps/teach-card/src/]
cpu: light
budget_usd: 2
status: merged
owner: worker-grok
must_catch:
  - 黏底那一塊的底是半透明(42bbcb2 現況,只有一層 var(--hud-panel)),捲到底下的洋紅圖或字透出來:渲染測試 a 必須紅
  - 黏底那一塊不透明,但跟旁邊面板實際畫出來的顏色任一通道差超過 1(例如只鋪一層 var(--hud-solid),紅綠藍差 11、9、7):渲染測試 a 必須紅
  - 黏底那一塊的下緣到看得到範圍的下緣之間,有任何一排露出捲過去的內容(42bbcb2 的 1 px 縫;Wayland 提示在時黏底與提示之間的 2 px):渲染測試 b 必須紅
  - 補縫時把 .hud-body 的 padding-bottom 寫成 0,或黏底那一塊離看得到範圍的下緣超過 2 px,或 Wayland 提示在時按鈕被蓋住:T35 的渲染測試或 T47 的渲染測試 c、f 必須紅
  - 用了 card-static 不准的寫法(畫框的屬性、漸層、hud 以外的顏色或變數、色碼字面值、style= 屬性):card-static 必須紅
  - 實作動到 touches 以外的檔:不動的地方那條 diff 檢查必須有輸出
  - T43 到 T48 的教學卡測試、HUD 的 card-static 與 card-render、Wayland 提示的 T34 與 T35 測試任一變紅:不退步必須紅
---

# 工單 T49:黏底那一塊不透明、底下不留縫(T47 `@manual` 透字那一列與 O2)

> 狀態:起草 2026-10-24,依技術顧問 2026-10-24 對 T47 `@manual` 的裁決(顧問交代寫好直接交協調者合)。規格:UI/Tauri 負責人。編號 T49:顧問給的。
> 實作:worker(opencode + grok-4.7);紅測試(渲染測試 a、b):測試 agent;驗收:驗收 agent;`@manual`:前端,技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 依據:`../reviews/T47-manual-2026-10-24.md` 的「黏底那一塊透字」與 O2(含 2026-10-24 的更正);`T47-teach-card-zoom-layout.md` 第 2 條;`../02-decision-map.md` 的 ADR-080;SKILL §4g 第 29 條。
> 基底:main(T47 與它的 `@manual` 證據合併之後)。**LLM 真呼叫 0。**

## 為什麼有這張

T47 把按鈕列與狀態字樣包成黏底那一塊(`.dock`,`../../apps/teach-card/src/App.svelte:454`)。顧問判 T47 `@manual` 的透字那一列**不過,擋 07p4 done**:

- 那一塊的底是 `var(--hud-panel)`(`rgba(255, 255, 255, 0.9)`,第 459 行),捲到底下的內容透 10% 出來。
  - 字透成一排淡灰字 `#ebebeb`,底是 `#fefeff`(1.18 : 1)。
  - 例子裡的圖透成一大塊淡粉紅 `#fbe9f8`。
  - 出錯字樣疊在透出來的字上,讀起來吃力。
  - 顧問的話:看起來像畫壞。
- O2:`.hud-body` 的 `padding-bottom: 1px`(第 467 行,為了 T35 的「base > 0」)在黏底那一塊下面留了一排。捲過去的內容在那一排是原色,例如 150% 時一條 240 px 寬的洋紅線。
- 起草時另外量到:**Wayland 提示在的時候**,黏底那一塊下緣(416.84)到提示上緣(418.84)之間有 2 排,也是捲過去的內容原色。150% 捲到中間時量到 `#333333` 的字(T47 `@manual` 的 `WL-150-mid`)。這是同一個問題,一起修。

## 要的結果(量結果,不綁做法)

### 1. 黏底那一塊不透明,顏色等於旁邊的面板

- **「面板實際畫出來的顏色」**:同一張截圖裡,`.hud-body` 左右內距裡、黏底那一塊上面的一點(不在例子框、不在字上)。
  - 有合成器(`html` 沒有 `hud-solid`,T47 `@manual` 的環境):面板是 `.hud-cut-inner` 的 `var(--hud-panel)` 疊在頁面的白底上,量到 `#ffffff`(`../../packages/ui-shared/src/hud/hud.css:109`)。
  - 沒有合成器(`html` 有 `hud-solid`,T21):`.hud-cut-inner` 的 `var(--hud-panel)` 疊在面板的 `var(--hud-solid)` 上(`hud.css:40`、`hud.css:58`)。照算法是 `#fefeff`,沒有量過。
  - **兩種都要成立**。
- **條件**:黏底那一塊扣掉按鈕(每顆外擴 1.5 px,含按鈕自己的黑框)之後,**每一個像素**跟面板的顏色每個通道差 ≤ 1。
  - 100% 與 150%,捲到中間與捲到底。
  - 內容捲到底下的時候也一樣:底下是例子裡的大塊洋紅圖、或例子的字,黏底那一塊範圍內都是 0 個內容色的像素。
- **出錯字樣在的時候**:扣掉按鈕與字樣那一行的矩形,其餘照上一條。字樣本身的字色照 T44/T45(不改)。

### 2. 黏底那一塊下面不露出內容

- 黏底那一塊的下緣到 `.hud-body` 看得到範圍的下緣之間,**每一排**都沒有捲過去的內容:每個像素跟面板色每個通道差 ≤ 1,或者那幾排根本不存在。
  - 100% 與 150%,捲到中間與捲到底。
- **Wayland 提示在的時候**:量黏底那一塊下緣到提示上緣之間,條件一樣。
- 這幾條照舊要過:
  - T35:提示出現前 `.hud-body` 的計算 `padding-bottom` > 0;提示在時是「原本的值 + 提示的高」。
  - T47 的 c:黏底那一塊的下緣離看得到範圍的下緣 ≤ 2 px;捲到上、中、下,按鈕的矩形相同(±0.5 px)。
  - T47 的 f:提示在的時候按鈕的正中心打得到自己。

### 3. 不變的

- T47 全部:只縮卡片內容、六級、記住級距、黏底、內文與例子一起捲、視窗最小寬高。
- T45 的 0 px 與留的位置、T46 的放大層(蓋整個視窗,不在黏底那一塊裡)。
- `<div class="controls">` 裡直接是按鈕(`t43-deepen.test.ts` 讀原始碼找它);「下一個」的 `onclick={handleNext}`、`disabled={finished}`;最外層一個 HudPanel。
- 黏底那一塊的高度(按鈕列 + 留的位置)不因為這張改變。
- 側車、協定、Rust、core、`packages/ui-shared/` 都不動。

## card-static 的禁止清單(起草前掃過 `../../packages/ui-shared/src/hud/card-static-test-support.ts`)

教學卡的 `<style>` 由 `styleProblems` 掃:

- **不准**:畫框的屬性(`border*`、`outline`、`box-shadow`、`clip-path`、`mask`,第 337 行)。例外只有兩個:例子框的 `border-left`、生成中與深入失敗那兩行的 1px 上分隔線。
- **不准**:`background` 漸層(第 375 行)。所以不能用「`linear-gradient(var(--hud-panel), var(--hud-panel))` 疊在 `var(--hud-solid)` 上」這種一個 `background` 疊兩層的寫法。
- **顏色只能** `var(--hud-*)`;變數只能 `--hud-` 開頭;`<style>` 裡不准有色碼或 `rgb()` 字面值。
- 標記不准有 `style=` 屬性(可以用 Svelte 的 `style:` 指令)。
- `::before` / `::after` 與 `content` 的禁令(第 301 行)**只掃考試卡的結果那一行,不掃教學卡**。教學卡可以用 `::before`,但它的宣告照上面幾條掃。
- `transition` 不在掃描清單;這張不需要,也不要加(T47 不准 Svelte 的動畫指令)。
- 這張**不需要新的 card-static 例外**。

## 做法(建議;量的結果才是驗收)

- **第 1 條**,把面板的疊法搬到黏底那一塊。下面兩種都只用既有的兩個變數,不加新色值:
  - 顧問建議的做法:`.dock` 的底用 `var(--hud-solid)`,再用 `.dock::before`(`content: ""`、蓋滿、`z-index` 在內容下面)鋪 `var(--hud-panel)`。`.dock` 是 `position: sticky` 加 `z-index: 1`,自己就是一個堆疊環境。
  - 或者:`.dock` 裡面多包一層元素鋪 `var(--hud-panel)`,`.dock` 本身鋪 `var(--hud-solid)`。`.controls` 仍然直接包按鈕。
  - 兩種的結果都是 `#fefeff`:沒有合成器時跟面板一樣;有合成器時面板是 `#ffffff`,差 1,剛好在 ≤ 1 裡。
  - **不行的**:只鋪一層 `var(--hud-solid)`(`#f4f6f8`,比面板深 11、9、7);只鋪一層 `var(--hud-panel)`(就是現況,半透明)。
- **第 2 條**:怎麼做給 worker 選。限制是 T35 的提示程式在卡片畫出來前就記 `.hud-body` 的 `padding-bottom` 當 base(App.svelte 第 461–465 行的註解),所以 base 不能是 0。可以想的方向:
  - 讓黏底那一塊往下蓋住那一排;
  - 讓那一排不畫捲過去的內容。
  - 提示在時的 2 排,也要一起想。

## 驗收條件

### 1. 自動驗收(vitest 與 cucumber,測試 agent 寫)

| 層 | 指令 | 過的條件 |
|---|---|---|
| 教學卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/` | 全綠,含新的 a、b,T43–T48 既有的 |
| ui-shared | `VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/` | 全綠(card-static、card-render、Wayland 提示 T34 / T35) |
| 不退步 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and not @manual' --format summary` | 全綠(拿位子) |
| 不動的地方 | `git diff --stat <紅測試分支的基底>..HEAD -- packages contracts apps/desktop scripts features/07-teach-card apps/teach-card/src/teach-session.ts apps/teach-card/src/main.ts apps/teach-card/dev` | 沒有輸出 |

這張沒有新的純邏輯模組,不跑變異測試。改壞證明見第 2 節。

**渲染測試**(新檔,放 `apps/teach-card/src/`)。做法同 T47 的渲染測試:

- `openApp` 加 `initScript` 改 `/__card`;圖片走 `/__asset`。
- 讀像素用 `../../packages/ui-shared/src/hud/render-test-support.ts` 的 `screenshot` 與 `px`。
- **不准**用讀原始碼比字串代替渲染(SKILL §4g 第 29 條);不改 `packages/ui-shared/src/hud/` 的測試支援。
- 卡:一個很長的例子,中間一張**高對比的大圖**(例如純洋紅,畫出來比黏底那一塊寬、比它高),捲到那張圖正好蓋住黏底那一塊、而且往下超過黏底那一塊的下緣。

**要被真渲染看到的畫面狀態**(a、b 在 `42bbcb2` 的 App.svelte 上紅,紅的原因是「還沒有這個功能」):

- **a. 不透明、同色**:
  - 量的範圍:`html` 沒有與有 `hud-solid` × 100% 與 150% × 捲到中間與捲到底。
  - 條件:黏底那一塊扣掉按鈕(外擴 1.5 px)之後,每個像素跟面板色(`.hud-body` 左內距裡、黏底那一塊上面的一點)每通道差 ≤ 1。
  - 另加一次出錯字樣在的時候(扣掉字樣那一行)。
  - `42bbcb2` 上應該紅在洋紅疊出來的 `#fbe9f8` 與淡灰字。
- **b. 下面不留縫**:
  - 同樣的範圍:黏底那一塊下緣(往上取整)到看得到範圍下緣(往下取整)之間每一排,每個像素跟面板色每通道差 ≤ 1。
  - 另加 Wayland 提示在的時候(用 T35 測試的做法,`initScript` 放 Rust 組出來的提示程式),量黏底那一塊下緣到提示上緣之間。
  - `42bbcb2` 上應該紅在那 1 排(與提示在時的 2 排)的洋紅。
- 每一條在基底上的紅綠寫進紅測試的 commit 說明。

### 2. 改壞證明(驗收 agent 的丟棄式證明)

`must_catch` 每一條各做一次:改了哪裡、哪一條紅、紅的訊息原文、還原後綠。至少:

- 黏底那一塊改回只有 `var(--hud-panel)` → a 紅;
- 改成只有 `var(--hud-solid)` → a 紅(色差 11、9、7);
- 修好的版本裡把補縫的那一處拿掉 → b 紅;
- `.hud-body` 的 `padding-bottom` 寫成 0 → T35 紅;
- 黏底那一塊的 `bottom` 改成 4px → T47 的 c 紅。

### 3. 觀感(`@manual`,前端做、技術顧問判)

T49 合併後,前端照 T47 `@manual` 的做法重拍,並讀那一塊的像素(暫存根 + 假網路、Xvfb `:97` + 巢狀 GNOME Shell、ibus-daemon 替身、MemoryMax=2G、LLM 真呼叫 0、真的 learning/ 前後相同):

| 列 | 過的條件 |
|---|---|
| U-100 | 長例子捲到一半、字在黏底那一塊底下:黏底那一塊扣掉按鈕,每個像素跟面板色差 ≤ 1;沒有淡灰字、沒有粉紅塊 |
| U-150 | 同上,150% |
| T45-150-mid-error | 150% 捲到中間、深入出錯:出錯字樣底下沒有透出來的字 |
| Z150-A | 150% 短卡:黏底那一塊下面那一排沒有洋紅線 |
| WL-150-mid | Wayland 提示在、150% 捲到中間:黏底那一塊與提示之間沒有內容色(起草時加的;顧問 2026-10-24 同意留著,要看這一列) |

顧問判過才做 07p4 done + tag。

## 受保護的檔(開發 worker 不改)

- 測試:`*.test.ts`、`*-test-support.ts`、`features/**`、`.feature`。worker 覺得測試有錯,寫進報告的「待協調」,不改。
- 實作:`packages/`(含 `ui-shared/src/hud/`)、`contracts/`、`apps/desktop/`、`scripts/`、`apps/teach-card/dev/`、`apps/teach-card/src/teach-session.ts`、`apps/teach-card/src/main.ts`。

## 落點

`apps/teach-card/` → 07-teach-card(`../../scripts/boundaries.owners.json`)。不新增 import 例外。

## 顧問的裁決(2026-10-24,T47 `@manual`)

- 七列行為都過(M1–M6 與 T45 不退步);**透字那一列不過,擋 07p4 done**。
- 第 1 條、第 2 條(O2 併進來)、must_catch 三條(半透明紅、1 px 漏線紅、色差 > 1 紅,都要在 `42bbcb2` 上紅)、用真渲染讀截圖像素:照上面寫的。
- 建議做法 `var(--hud-solid)` 加 `::before` 的 `var(--hud-panel)`,不強制。
- T49 合併後 `@manual` 只重拍 U-100、U-150、T45-150-mid-error、Z150-A 並讀像素;顧問判過才 07p4 done + tag。
- O1(縮放把手第一下沒接上、還選了字):不是 T47 的碼,不擋;07p4 之後前端再起草一張 14-hud-skin 的調查小票,低優先。
- O3:T49 之後黏底那一塊 = 面板色,比例子框白是對的,只記。O4、O5、O6 只記。

**起草時補的兩處**(依據是量到的值;顧問 2026-10-24 都同意,兩處都留):

- 面板實際畫出來的顏色有兩種底(有合成器 `#ffffff`、`hud-solid` 照算法 `#fefeff`),a 兩種都量。
- Wayland 提示在時黏底與提示之間的 2 排一起修(第 2 條、b、`@manual` 的 WL-150-mid)。

## 不在範圍

- O1(縮放把手的拖拉,另開 14-hud-skin 的調查小票)、O4、O5、O6。
- 黏底那一塊的高度、按鈕的樣子、狀態字樣的字色。
- 考試卡(06)。

## 預算

`budget_usd: 2`(只改 `App.svelte`;grok 不設停止線,只記錄)。沒有 LLM 花費。

`cpu: light`:沒有 Rust。渲染測試會起 vite dev server、headless Chrome 與側車;cucumber 是重活,協調者照重活排位子。

## 測試誰寫

- 紅測試(渲染 a、b):測試 agent。改壞證明:驗收 agent。開發 worker 以紅測試分支為基底,不改測試。
- 實作:worker(opencode + grok-4.7)。
- `@manual`:前端,技術顧問判。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 重活(vitest 完整、cucumber、渲染測試)先跟協調者拿位子:`VITEST_MAX_WORKERS=1`,cucumber 一律 `--tags`。
