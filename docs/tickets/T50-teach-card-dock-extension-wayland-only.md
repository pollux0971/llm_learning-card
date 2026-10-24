---
id: T50
deps: [T49]
touches: [apps/teach-card/src/]
cpu: light
budget_usd: 1
status: dispatched
owner: worker-grok
must_catch:
  - 沒有 Wayland 提示時,黏底那一塊的偽元素仍往下多蓋 1 px(67e2ded 現況,可以捲的範圍多 1 px、捲到底按鈕上移約 1.3 px):新的渲染測試 c1 必須紅;c4 留下的話也必須紅
  - 按掉提示之後偽元素仍往下多蓋:新的渲染測試 c3 必須紅
  - 提示在時不多蓋(多蓋整個拿掉,或判斷提示在不在的選擇器永遠不中,例如提示的 id 寫錯):新的渲染測試 c2 與 T49 的 b(Wayland 那一組)必須紅
  - 動到黏底那一塊本身的 bottom 或 margin-bottom(各負 1px 照舊),或 .hud-body 的 padding-bottom:T49 的 a 或 b、T47 的 c、T35、新的 c4 其中至少一條必須紅(c4 沒留的話,margin-bottom 那一條由 @manual 的 U-150 抓)
  - 用了 card-static 不准的寫法(畫框的屬性、漸層、hud 以外的顏色或變數、色碼字面值、style= 屬性):card-static 必須紅
  - 實作動到 touches 以外的檔:不動的地方那條 diff 檢查必須有輸出
  - T43 到 T49 的教學卡測試、HUD 的 card-static 與 card-render、Wayland 提示的 T34 與 T35 測試任一變紅:不退步必須紅
---

# 工單 T50:沒有 Wayland 提示時,黏底那一塊不往下多蓋(T49 `@manual` 的 F2)

> 狀態:起草 2026-10-25,依技術顧問 2026-10-25 對 T49 `@manual` 的裁決(F2 選 B,開這張小票;07p4 之後第一張,不擋 07p4 done + tag)。規格:UI/Tauri 負責人。編號 T50:顧問給的。
> 實作:worker(opencode + grok-4.7);紅測試:測試 agent;驗收:驗收 agent;`@manual`:前端,技術顧問判。
> 依據:`../reviews/T49-manual-2026-10-25.md` 的 F2 與「顧問判定」;`T49-teach-card-dock-opaque.md`;`../02-decision-map.md` 的 ADR-080。
> 基底:main(T49 `@manual` 證據與 07p4 done 之後)。**LLM 真呼叫 0。**

## 為什麼有這張

- T49 讓黏底那一塊的 `::before`、`::after` 用 `inset: 0 0 -1px 0` 往下多蓋 1 px(`../../apps/teach-card/src/App.svelte:470`),為了蓋住 Wayland 提示上緣那一排。
- T49 `@manual` 量到:這 1 px 在 WebKitGTK 也算進 `.hud-body` 可以捲的範圍。
  - X11(沒有提示)捲到底時,黏底那一塊停在比黏住時高 1.29 px 的地方,按鈕跟著上移 1.29 px(螢幕上 1 排)。T47 時是 0.29 px。
  - Chrome 也一樣:T47 c 的容差 0.5 px 在 T49 的做法下紅在 1.2 px(`21c0e18` 的說明),所以容差才放寬到 1.5 px。
- 探針(只在頁面用 CSSOM 把兩個偽元素的 `bottom` 改成 0,沒改檔):`scrollHeight` 4889 → 4888;捲到底時離下緣 1.27 → 0.27 px;按鈕位移 1.29 → 0.29 px。刪掉那條規則又回到 1.29。
- **X11 不需要多蓋**:
  - 捲到中間時,黏底那一塊本身已經超過看得到的下緣 0.03 px(`bottom` 與 `margin-bottom` 各 `-1px`,第 460–461 行)。
  - 捲到底時,下面沒有內容了。
  - 只有 Wayland 提示在時,黏底那一塊下緣(417.84)到提示上緣(418.84)之間那一排要多蓋。
- 顧問:那 1 px 只有提示需要,X11 是白付的。

## 要的結果(量結果,不綁做法)

### 1. 沒有提示時,偽元素不往下多蓋

- `.dock::before` 與 `.dock::after` 計算後的 `bottom` 是 `0px`。
- `.hud-body` 的 `scrollHeight` 等於「把兩個偽元素的 `bottom` 改成 0」時的值(同一張卡、同一級距、同一個視窗大小)。
- 捲到中間 − 捲到底,按鈕的 y 差 ≤ 0.5 px。
- 按掉提示之後也一樣(回到沒有提示的樣子)。

### 2. 提示在時,多蓋的那 1 px 還在

- `.dock::before` 與 `.dock::after` 計算後的 `bottom` 是 `-1px`。
- 黏底那一塊下緣到提示上緣之間,0 排露出內容(T49 的 b,Wayland 那一組照綠)。

### 3. 不變的

- 黏底那一塊本身:`bottom`、`margin-bottom` 各 `-1px`;底色(`var(--hud-solid)`,`::before` 疊 `var(--hud-panel)`,`::after` 墊 `var(--hud-solid)`);`z-index`;高度。
- `.hud-body` 的 `padding-bottom` 1px、`scroll-padding-bottom` 200px(第 486–489 行;T35 的 base > 0)。
- T49 的 a、b 全部;T47 全部,**T47 c 的容差維持 1.5 px,不再動**(顧問)。
- 有合成器時的色差照顧問 2026-10-25 的改讀:檢查器截圖差 ≤ 1;螢幕上黏底那一塊是不透明底座,不跟透出桌面的面板比。
- `<div class="controls">` 裡直接是按鈕;「下一個」的 `onclick={handleNext}`、`disabled={finished}`;最外層一個 HudPanel。
- 側車、協定、Rust、core、`packages/ui-shared/`、`apps/desktop/` 都不動。

## 怎麼知道提示在不在(起草前查過 T34 / T35 的程式)

- 提示是 `../../apps/desktop/src-tauri/src/wayland_note.js` 在頁面載入後加到 `document.body` 最後面的 `<div id="lc-wayland-note">`。按「知道了」就把它從 DOM 拿掉。
- 它**不在** `html` 或 `body` 加 class 或屬性。提示在時,它只改 `.hud-body` 的 inline `padding-bottom`(原本的值 + 提示的高)。
- **建議做法:用 `:has()`**。例如 `:global(body:has(> #lc-wayland-note)) .dock::before` 這一類選擇器,只在提示在時讓偽元素往下多蓋 1 px;平常 `inset: 0`。
  - 只動 `App.svelte`,touches 只有 `apps/teach-card/src/`。
  - 這台的 WebKitGTK 是 2.52.6,跟 Chrome 一樣支援 `:has()`。
  - 提示按掉就從 DOM 拿掉,`:has()` 自然不中,不用寫程式。
  - 提示的 id 是 `apps/desktop` 那邊的字串。那邊改名,這裡會靜默不中,所以 c2 用 Rust 組出來的真提示程式測(T49 b 的做法)。
- **不採用**:在 `wayland_note.js` 加 class 或屬性。要動 `apps/desktop`、T35 的提示程式與它的 Rust 測試,範圍比這張大。
- **不行**:用屬性選擇器看 `.hud-body` 的 inline `style` 有沒有 `padding-bottom`(比字串,太脆)。

## card-static 的禁止清單(起草前掃過 `../../packages/ui-shared/src/hud/card-static-test-support.ts:366` 的 `styleProblems`)

- 選擇器沒有限制:`:global(…)`、`:has(…)`、`#id` 都可以。
- 注意:`<style>` 裡 `#` 後面接 3–8 個十六進位字母的字樣,會被當成色碼字面值。`#lc-…` 不會中(`l` 不是十六進位)。
- 宣告照舊:不准畫框的屬性、漸層、hud 以外的顏色或變數、色碼字面值;標記不准有 `style=` 屬性。
- 這張只改偽元素的 `inset` / `bottom`,不加顏色。**不需要新的 card-static 例外。**

## 驗收條件

### 1. 自動驗收(vitest 與 cucumber,測試 agent 寫)

| 層 | 指令 | 過的條件 |
|---|---|---|
| 教學卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/` | 全綠,含新的 c1–c4,T43–T49 既有的 |
| ui-shared | `VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/` | 全綠(card-static、card-render、Wayland 提示 T34 / T35) |
| 不退步 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and not @manual' --format summary` | 全綠(拿位子) |
| 不動的地方 | `git diff --stat <紅測試分支的基底>..HEAD -- packages contracts apps/desktop scripts features/07-teach-card apps/teach-card/src/teach-session.ts apps/teach-card/src/main.ts apps/teach-card/dev` | 沒有輸出 |

這張沒有新的純邏輯模組,不跑變異測試。改壞證明見第 2 節。

**渲染測試**(新檔 `apps/teach-card/src/t50-dock-extension-render.test.ts`,做法同 T49 的渲染測試:`openApp` 加 `initScript`;提示用 `WAYLAND_NOTE_JS`):

- **c1. 沒有提示**(有合成器與 `hud-solid` 兩種底 × 100% 與 150%,長卡):
  - 兩個偽元素計算後的 `bottom` 是 `0px`;
  - `scrollHeight` 等於在測試頁裡用 CSSOM `insertRule` 把兩個偽元素的 `bottom` 改成 0 之後的值(量完 `deleteRule`)。
  - **插入的規則要真的生效**:Svelte 會在選擇器加 scoped class,裸的 `.dock::before` 權重輸,不生效時兩邊永遠相等,這半條是假綠。規則要加 `!important`,插完先量一次兩個偽元素計算後的 `bottom`,確認是 `0px` 再比 `scrollHeight`。T49 `@manual` 的探針用 `.hud-body .dock::before, .hud-body .dock::after { bottom: 0px !important; }`,量到計算值變成 `0px`、`scrollHeight` 少 1。
- **c2. 提示在**:兩個偽元素計算後的 `bottom` 是 `-1px`。
- **c3. 提示在 → 按「知道了」**:回到 c1 的兩條。
- **c4. 沒有提示,150% 長卡**:捲到中間 − 捲到底,三顆按鈕的 y 差都 ≤ 0.5 px(只在這個檔,T47 c 的容差不動)。
  - **留 c4 之前先證明它在 Chrome 轉得綠**:紅測試作者用丟棄式實作(只在沒提示時讓偽元素的 `bottom` 是 0,不進 git)跑 c4,Chrome 量到 ≤ 0.5 px 才留。
  - 量不到就把 c4 拿掉,這一條只靠 `@manual`,並把 Chrome 量到的數字回報顧問。
  - 理由:`21c0e18` 只證明「多蓋時」Chrome 看得到約 1.2 px,沒證明「不多蓋時」Chrome 回得到 0.3。
- 在 `67e2ded` 的 App.svelte 上:**c1、c3 紅;c4 留下的話也紅**。紅的原因是「還沒有這個功能」(偽元素一律多蓋 1 px)。c2 本來就綠,是護欄。每一條的紅綠、c4 丟棄式實作量到的數字,寫進紅測試的 commit 說明。
- 不准用讀原始碼比字串代替渲染(SKILL §4g 第 29 條)。CSSOM 只在測試頁裡用,不改檔。

### 2. 改壞證明(驗收 agent 的丟棄式證明)

`must_catch` 每一條各做一次:改了哪裡、哪一條紅、紅的訊息原文、還原後綠。至少:

- 多蓋改回不看提示、一律多蓋 → c1、c4 紅;
- 選擇器裡提示的 id 寫錯 → c2 與 T49 b(Wayland)紅;
- 多蓋整個拿掉 → c2 與 T49 b(Wayland)紅;
- 黏底那一塊的 `bottom` 改成 0 → T49 b 紅(捲到中間時露 1 排);
- 黏底那一塊的 `margin-bottom` 拿掉 → c4 應該紅(沒提示時可以捲的範圍又多 1 px,捲到底按鈕上移約 1.3 px)。T49 驗收時這一條存活過(N12,當時偽元素一律多蓋,差別被蓋掉),所以這次要寫下紅的是哪一條。c4 沒留的話,標「只靠 `@manual`」。
- 在 `:has(…)` 那條規則裡放一個禁止的宣告(例如 `box-shadow` 或色碼)→ card-static 必須紅。這一條證明 card-static 的 `parseCss`(自己寫的,`../../packages/ui-shared/src/hud/test-support.ts:269`)讀得進 `:has(> …)` 這種巢狀括號的規則,沒有整條跳過。
  - 起草時試過(把規則接在 `67e2ded` 的 `<style>` 後面,只讀不寫):選擇器整條讀進來;`box-shadow`、`#ff00ff`、`var(--x-pink)` 三種都被抓到;只有 `bottom: -1px` 的乾淨那條 0 個問題(`#lc-` 沒被當成色碼)。驗收要在真的實作上再做一次(規則的位置可能不在最後面)。

### 3. 觀感(`@manual`,前端做、技術顧問判)

T50 合併後,前端照 T49 `@manual` 的做法重拍(暫存根 + 假網路、Xvfb `:97` / `:98`、巢狀 GNOME Shell、ibus-daemon 替身、MemoryMax=2G、LLM 真呼叫 0、真的 learning/ 前後相同),讀檢查器截圖與 framebuffer:

| 列 | 過的條件 |
|---|---|
| U-150(有合成器的 X11) | 150% 長卡:捲到中間 − 捲到底,按鈕 y ≤ 0.5 px(WebKitGTK 真 app 的頁面座標);黏底那一塊裡面與下面 0 個內容色像素 |
| U-150(沒有合成器的 X11,`hud-solid`) | 同上 |
| WL-150-mid | Wayland 提示在、150% 捲到中間:黏底那一塊下緣到提示上緣之間 0 排露出內容 |

顧問判過才收。

## 受保護的檔(開發 worker 不改)

- 測試:`*.test.ts`、`*-test-support.ts`、`features/**`、`.feature`。worker 覺得測試有錯,寫進報告的「待協調」,不改。
- 實作:`packages/`(含 `ui-shared/src/hud/`)、`contracts/`、`apps/desktop/`(含 `wayland_note.js`)、`scripts/`、`apps/teach-card/dev/`、`apps/teach-card/src/teach-session.ts`、`apps/teach-card/src/main.ts`。

## 落點

`apps/teach-card/` → 07-teach-card(`../../scripts/boundaries.owners.json`)。不新增 import 例外。

## 顧問的裁決(2026-10-25,T49 `@manual`)

- 五列通過;F1 收(螢幕上黏底那一塊是不透明底座,不跟透出桌面的面板比)。
- F2 要修,開這張小票,不擋 07p4 done + tag;07p4 之後第一張。
- 做法:只有提示在時偽元素才往下多蓋 1 px;黏底那一塊本身的 `bottom` / `margin-bottom` `-1px` 照舊(探針只動偽元素就回到 0.29)。
- 量法:WebKitGTK 真 app,X11 U-150 捲中間 − 捲到底按鈕 y ≤ 0.5 px;WL-150-mid 漏線仍 0 排;T49 全部測試照綠;T47 c 容差維持 1.5 px 不再動。
- 紅測試抓 Chrome 也抓得到的那半:沒提示時偽元素不加可捲範圍;有提示時多蓋那 1 px 還在。要在 `67e2ded` 上紅。
- `@manual` 只重拍 U-150(兩種 X11)與 WL-150-mid。

**起草時補的兩處**(顧問 2026-10-25 審過,同意):

- c3(按掉提示之後回到沒有提示的樣子):提示按掉就拿掉,選擇器要跟著不中。
- c4(按鈕位移 ≤ 0.5 px 直接寫成渲染測試):`21c0e18` 說明 Chrome 量得到這 1 px,所以 Chrome 上也能紅,不必只靠 `@manual`。

**顧問審工單時加的三條**(2026-10-25):

- c4 要先用丟棄式實作證明 Chrome 轉得綠(≤ 0.5 px)才留;量不到就降成只靠 `@manual`,數字回報顧問。
- c1 用 `insertRule` 比 `scrollHeight` 時,插入的規則要真的生效(`!important`,並先量計算後的 `bottom` 是 0),不然那半條是假綠。
- 改壞證明加一條:`:has(…)` 那條規則裡放禁止的宣告 → card-static 必須紅(證明 `parseCss` 讀得進巢狀括號的規則)。

## 不在範圍

- F1(螢幕上黏底那一塊與半透明面板不同色,顧問收了)。
- T47 c 的容差、`wayland_note.js`、T35 的留白算法。
- O1(縮放把手的拖拉,14-hud-skin 的調查小票,排在這張後面)。
- 考試卡(06)。

## 預算

`budget_usd: 1`(只改 `App.svelte` 的幾行 CSS;grok 不設停止線,只記錄)。沒有 LLM 花費。

`cpu: light`:沒有 Rust。渲染測試會起 vite dev server、headless Chrome 與側車;cucumber 是重活,協調者照重活排位子。

## 測試誰寫

- 紅測試(渲染 c1–c4):測試 agent。改壞證明:驗收 agent。開發 worker 以紅測試分支為基底,不改測試。
- 實作:worker(opencode + grok-4.7)。
- `@manual`:前端,技術顧問判。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 重活(vitest 完整、cucumber、渲染測試)先跟協調者拿位子:`VITEST_MAX_WORKERS=1`,cucumber 一律 `--tags`。
