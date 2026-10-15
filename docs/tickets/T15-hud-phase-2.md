---
id: T15
deps: []
touches: [apps/teach-card/src/App.svelte, apps/teach-card/src/main.ts, apps/test-card/src/App.svelte, apps/test-card/src/main.ts, packages/ui-shared/src/hud/HudField.svelte, packages/ui-shared/src/hud/HudPanel.svelte, packages/ui-shared/src/hud/hud.css, packages/ui-shared/src/hud/gallery/Gallery.svelte]
cpu: light
budget_usd: 5
status: todo
owner: worker-grok
must_catch:
  - 教學卡的「下一個」改回原生 <button>:「教學卡用 HUD 元件」的靜態掃描必須紅
  - 教學卡或考試卡有內容放在 HudPanel 外面(例如把 <h1> 搬回面板上方):「最外層只有一個 HudPanel」必須紅
  - 卡片自己的 <style> 畫框(border / outline / box-shadow / clip-path / mask,.lc-example 的 border-left 除外):「不自畫外框」必須紅
  - 卡片的 <style> 出現顏色字面值(例如答對答錯改回 #1a7f37、#d1242f):顏色字面值掃描必須紅
  - --hud-pass 或 --hud-fail 對面板的最差對比 < 4.5:結果字色的對比檢查必須紅
  - 卡片自己設 hud-frameless / hud-solid,或傳 frameless / solid 給 HudPanel:「class 由桌面殼決定」必須紅
  - 考試卡有一個作答欄沒有包在 HudField 裡(只包第一格、或 textarea 沒包):「作答欄來自 HUD」必須紅
  - 進度不是 HpBar,或 HpBar 拿錯數字(done 多 1、total 寫死):「HP 條填到 1/3」必須紅
  - 「1 / 3」那行字拿掉,或搬出進度那一區:「1 / 3 還在旁邊」必須紅
  - 應用題沒有送出鍵,或送出鍵的 onclick 不是鍵盤用的同一個 submitFill / submitApply,或評分中沒有停用:送出鍵的靜態檢查必須紅
  - 送出鍵在 360 × 480 要捲動才看得到:「不捲動就看得到送出鍵」必須紅
  - HudField 的框變成 2–3 像素或沒有切角的線,或 focus-within 跟平常一樣:作答欄的框線與焦點檢查必須紅
  - 面板沒有撐滿視窗(例如置中加外距),或捲的是整頁不是面板裡面:「面板撐滿視窗」必須紅
  - 例子框左右任一邊離面板內緣 < 12 像素:例子框邊距檢查必須紅
  - 考試卡 import @learning/ui-shared 的根(07 的檔):npm run boundaries 必須紅
  - D1:展示頁頁首的字又直接畫在背景上,或深色時只改字色:頁首對比檢查必須紅
  - 06、07 已 done 的 phase 的非 @manual 場景照舊全綠、.feature 沒改;14 phase-1 的測試照舊全綠:長相改了,行為不變
---

# 工單 T15:14-hud-skin phase-2 —— 教學卡與考試卡換上 HUD

> 狀態:草稿,待技術顧問審。
> 作者:UI/Tauri 負責人(14-hud-skin 的規格作者,不是實作者)。編號:協調者配(T15)。派工:協調者。
> 實作:worker-grok。紅測試:另一個角色(建議見「紅測試」)。驗收:-ed。觀感:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 規格來源:`features/14-hud-skin/phase-2.feature`(**不改**)與 `features/14-hud-skin/FEATURE.md` 的「範圍」。
> 基底:origin/main `08c338d`(含 T13、T14、14 phase-1 done)。**紅測試與實作的基底還要含協調者的 `7b405e5`**
> (`scripts/boundaries.allow.json` 開 06→14、07→14 兩條例外,ADR-071);沒有它,卡片一 import `hud/`,`npm run boundaries` 就紅。

## 為什麼有這張

14 phase-1 做好了 HUD 元件(面板、按鈕、標題列、縮放把手、HP 條)與展示頁,技術顧問 2026-10-15 判通過。
phase-2 把它們套到兩張卡上。順便處理三件留下來的事:

| 來源 | 問題 |
|---|---|
| 技術顧問 T2c-1 `@manual`(2026-10-15) | 教學卡例子框的灰底右緣貼著視窗邊,沒有右邊距 |
| 同上 | 考試卡沒有看得到的「送出」鍵,作答欄只是一條細框 |
| 前端 T14 `@manual` 的 D1(技術顧問 2026-10-15 裁定記進本張) | 展示頁勾「深色背景」後,頁首的「HUD」、說明文字、三個開關的字(`--hud-text` #333)畫在 #333 底上,看不見 |

現在的兩張卡(`apps/teach-card/src/App.svelte`、`apps/test-card/src/App.svelte`)都是瀏覽器預設樣式:
`<h1>` 標題、原生 `<button>`、原生 `<input>`;考試卡只能用鍵盤送出(填空按 Enter、應用題按 Ctrl+Enter)。
06 的 FEATURE.md「範圍」本來就有「送出鍵」,phase-1 沒做出來。

## 驗收條件

### 1. 教學卡用 HUD 元件(靜態掃描,`phase-2.feature` 場景 1)

- `App.svelte` 的標記**最外層只有一個 `<HudPanel>`**,所有內容都在它裡面:讀取失敗、學完了、標記列、標題、內文、按鈕。
  理由是 D1 學到的:10 phase-6 之後視窗是透明的,面板外面的字畫在使用者的桌面上,深色桌面就看不見。
- 傳 `title="教學卡"`,拿掉 `<h1>教學卡</h1>`。標題列由 HudPanel 畫:有 `hud-frameless` 時才出現;
  沒有時系統標題列已經寫著視窗名稱,不會出現兩個標題。
- 傳 `controls={createWindowControls()}`(`hud/window-controls.ts`),**不傳** `frameless`、`solid`。
  這兩個 class 由桌面殼設在根元素上(10 phase-6),卡片的原始碼不提 `hud-frameless`、`hud-solid`、`FRAMELESS_CLASS`、`SOLID_CLASS`,也不碰 `classList`。
- 每一顆按鈕都是 `<HudButton>`,原始碼裡沒有原生 `<button>`。「下一個」照舊是 `onclick={handleNext}`、`disabled={finished}`。
- 卡片自己的 `<style>` **不畫框**:沒有 `border*`、`outline*`、`box-shadow`、`clip-path`、`mask*`。
  唯一例外是 `.lc-example`(例子框是內文,不是外框)的 `border-left`,顏色也只能用 `var(--hud-*)`。
- **顏色只用 `var(--hud-*)`**:`<style>` 裡沒有 `#xxx`、`rgb()`、`hsl()`。
  這是 hud/ 現有的「顏色字面值只在 hud.css」規則(`colourLiteralProblems`),範圍擴到兩張卡的 `App.svelte`。
  標記列的 #555、待審核徽章的 #a15c00 / #fff3cd、例子框的 #f6f8fa / #ccc 都要換掉。
  可以用現有的變數(例如例子框底色 `--hud-solid`),徽章可用 `--hud-accent-wash` 當底色、字用 `--hud-text`
  (橘色只用在線條與底色,不印內文,FEATURE.md 設計值)。
- HUD 元件從 `@learning/ui-shared/hud/…` import(例外 ADR-071)。原本 import 的 `@learning/ui-shared`(`renderMarkdown`,07 自己的)照舊。
- 「三個按鈕」:見文末「請技術顧問決定」Q1。建議:現在只有「下一個」,掃描檢查「教學卡的每一顆按鈕都是 HudButton、沒有原生 `<button>`」,
  不為了湊三顆而加空按鈕。「換類別」是 07 phase-2,「深入這個」是 07 phase-3,它們做的時候直接用 HudButton,這條掃描會擋住原生按鈕。

### 2. 考試卡用 HUD 元件(靜態掃描,場景 2)

- 跟第 1 點一樣:最外層只有一個 `<HudPanel title="考試卡" controls={…}>`,拿掉 `<h1>`,不傳 `frameless` / `solid`,不碰那兩個 class。
- 每一個 `<input type="text">` 與 `<textarea>` 都包在 `<HudField>` 裡(新元件,第 4 點)。
  **輸入框本身留在 `App.svelte`,還是原生元素**,`bind:value`、`bind:this`、`onkeydown`、`disabled`、`rows="6"` 都不動。
  這樣 06 phase-1 的「每格一個單行輸入框」「第一格有焦點」「應用題至少五行高」原樣成立。
- 進度:`header.progress` 裡放 `<HpBar done={view.answeredCount} total={view.totalCount} />`,
  原本那行字 `{view.answeredCount} / {view.totalCount}` 留著(06 phase-1 `@manual`「標頭寫 0 / 3」)。
- **送出鍵(新加)**:填空題與應用題各有一顆 `<HudButton>`,字是「送出」。
  - `onclick` 呼叫鍵盤走的**同一個** `submitFill` / `submitApply`,不寫新的邏輯。
  - `disabled={view.submitting}`(06 phase-1 `@manual`「評分中送出控制停用」)。
  - 題目顯示中、而且畫面上沒有評分結果時才出現,也就是「`view.result && !view.error`」不成立的時候。
    評分失敗(`view.error`)時還在,可以再送一次。看到結果之後只剩「下一題」,跟現在一樣。
  - Enter 與 Ctrl+Enter 照舊能送出,鍵盤路徑不動。
- 「下一題」改成 `<HudButton>`。原始碼裡沒有原生 `<button>`。
- `<style>` 的規則同第 1 點:不畫框、顏色只用 `var(--hud-*)`。
  答對 / 答錯的字色在 `hud.css` 加兩個設計值 `--hud-pass`、`--hud-fail`,
  對面板的**最差對比 ≥ 4.5**(跟內文一樣的算法:`--hud-panel` 分別疊在純白與純黑上,取比較差的那個,`worstContrast`)。
  現在的 #1a7f37 只有 4.05、#d1242f 只有 4.18,不夠。前端算過 #146c2e(5.21)與 #b31d28(5.36)可以,實作者可以另選。
- **只能** import `@learning/ui-shared/hud/…`。不能 import `@learning/ui-shared` 的根或 `ui-shared/src/` 底下其他檔:
  那些是 07 的,ADR-035 第 2 點(06 在 I3 前不 import 07 的圍欄插件)照舊成立。違反時 `npm run boundaries` 會紅。
- 不改 `apps/test-card/package.json`:workspace 的 `node_modules/@learning/ui-shared` 連結已經在,import 解析得到。
  如果實作者發現一定要改 package.json 或 lock,停下來回報協調者(共用檔)。

### 3. 考試卡的進度是 HP 條(畫出來量,場景 3)

- 用 headless Chrome 開 `apps/test-card` 的 dev server(它自己的 fixture:三題到期),視窗 360 × 480(`tauri.conf.json` 的預設大小)。
- 剛載入:`header.progress` 裡有 `[data-hud="hp-bar"]`,`data-percent` 是 0;同一區的字是「0 / 3」。
- 答完一題之後(每一格填 fixture 的答案、按「送出」、看到結果、按「下一題」):
  - `data-percent` 在 33.3–33.4 之間;
  - HP 條正中間那一列,綠色(`--hud-hp`)那一段是內寬的 1/3,誤差 ±6 像素(右端斜切,在中間那一列少約 3.6 像素);
  - 同一個 `header.progress` 裡的字(空白合併後)是「1 / 3」。
- 總數照 session 給的 `totalCount`,fixture 是 3。

### 4. HUD 作答欄元件 `HudField`(新,放在 hud/)

- 新檔 `packages/ui-shared/src/hud/HudField.svelte`:`<div data-hud="field">` 包住它的 children(原生的 input 或 textarea)。
- 長相寫在 `hud.css`,只引用 `var(--hud-*)`:
  - 跟 HudButton 同一種框:1 像素黑線沿切角走一圈,裡面是面板色。
  - 裡面的 input / textarea 沒有自己的框、外框線、底色;字型 `--hud-font-body`、字色 `--hud-text`;寬度撐滿 HudField。
  - 鍵盤焦點:`:focus-within` 時框線變亮點色(橘)。橘色只用在線條,不印字。
  - 輸入框停用時跟 HudButton 停用一樣變淡。
- 展示頁加兩個作答欄範例(一個單行、一個多行),放在面板裡 HP 條的後面。
  **展示頁的第一個 `[data-hud="panel"]` 與前三顆 `[data-hud="button"]` 維持原樣**:T14 的量尺用索引找元素。
- 量法(在展示頁,720 × 900,方法同 T14):
  - 單行作答欄的四條直邊,每條正中間跨邊量墨水量,在 0.7–1.35(1 像素黑線,T14 驗收 2 的量法);
  - 有切角的斜邊,墨水量在 0.6–2.0(T14 驗收 3 的量法);
  - 單行作答欄高度 ≥ 36 像素,寬度等於它的容器寬 ±2 像素(「不是一條細線」);
  - 輸入框強制 `:focus` + `:focus-visible` 之後,作答欄(外擴 6 像素)跟平常的截圖至少 30 個像素看得出不同(任一通道差 > 32)。

### 5. 面板撐滿卡片視窗(畫出來量)

- 兩張卡在 360 × 480 下:
  - 面板外框的矩形是 (0, 0, 360, 480),誤差 ±1 像素;
  - 整頁不捲動:`document.scrollingElement` 的 `scrollHeight` ≤ 480、`scrollWidth` ≤ 360;
  - 內容比視窗長時,捲的是面板裡面。教學卡第一張 fixture 卡(有例子框)比 480 長,面板裡捲動區的 `scrollHeight` > `clientHeight`;
  - 面板四條直邊的黑線就在視窗邊上,往內量墨水量 0.7–1.35(視窗外面沒有像素,只往內量)。
- 理由:使用者選了 A(透明視窗,切角就是視窗的形狀,10 phase-6)。面板如果飄在中間、四周留白,10 phase-6 又要重排一次。
- 做法由實作者選。例如 HudPanel 加一個 prop,讓面板高度等於視窗、內文區 `overflow: auto`,標題列不跟著捲。
  展示頁不用撐滿。捲軸要不要配 HUD 色(例如 `scrollbar-color`)不強制。

### 6. 例子框左右都有邊距(畫出來量,場景 5 的自動部分)

- 教學卡 360 × 480,第一張有例子框的卡:每個 `.lc-example` 的左緣與右緣,離面板捲動區的 client 範圍(不算捲軸)都 ≥ 12 像素。
- 捲動區沒有東西往橫向凸出去:捲動區的 `scrollWidth` ≤ `clientWidth`。

### 7. 不捲動就看得到送出鍵(畫出來量,場景 6 的自動部分)

- 考試卡 360 × 480,第一題(填空):「送出」整顆在視窗裡,也在面板捲動區看得到的範圍裡,不用捲動。
- 按鈕正中心那一點的 `elementFromPoint` 是這顆按鈕或它裡面的元素(沒有被別的東西蓋住)。

### 8. D1:展示頁的頁首在深色背景上看得清楚(只改 `gallery/Gallery.svelte`)

**決定:改展示頁,不改 `hud.css`。** 理由:

- 看不見的是展示頁**自己的**字,畫在展示頁**自己的**深色背景上。真的卡片不會這樣:第 1、2 點要求所有內容都在面板裡。
- `hud.css` 不准提 gallery(T14 的規則與測試),也不該為展示頁改共用的字色。
- 深色背景同時有 #333 的底與 `--hud-solid` 的白格線(T14 驗收 1b 刻意做成高對比)。**只換字色過不了**:淺色字壓在白格線上一樣看不見。
  所以頁首要自己墊一塊淺色底。

做法:

- 頁首(「HUD」標題、說明、三個開關)包在一個 `data-gallery="head"` 的容器裡,容器自己有淺色底(例如 `background: var(--hud-solid)`)。
  顏色照舊只用 `var(--hud-*)`。
- 不能用第二個 HudPanel 包頁首:T14 的量尺找的是第一個 `[data-hud="panel"]`,頁首在上面會搶走它。
- 深色背景的開關(`data-gallery="dark-backdrop"`)留在頁首裡,而且點得到。

量法(深色背景勾起來、沒勾,兩種都量):

- 頁首容器裡,每一個「自己直接有文字」的元素:先記下它的計算字色;
  再把頁首所有字設成透明、表單控制項設成 `visibility: hidden`,截它的矩形範圍。
- 那個字色對範圍裡**每一個**像素的對比都要 ≥ 4.5。
- 在基底上:深色背景時 #333 對 #333 是 1.0,紅;沒勾時字壓在 (213, 222, 230) 的格線底上,本來就綠(對照組)。

### 9. 不退步

- 06、07 已 done 的 phase(現在都是 phase-1)的非 `@manual` 場景全綠,它們的 `.feature` 沒改(場景 4)。
  `apps/teach-card`、`apps/test-card` 底下現有的 vitest 全綠。
- 06、07 的邏輯檔不在 touches:`session.ts`、`types.ts`、`stubs/`、`lib/` 都不改。
- 14 phase-1 的測試全綠:`packages/ui-shared/src/hud/*.test.ts`(T14 驗收後是 107 條),以及 `phase-1.feature` 的 19 個非 `@manual` 場景。
- 10 phase-2 的「The real front ends are loaded」照舊綠:`build:frontends` 把兩張卡建進 `apps/desktop/dist/`,
  字型檔要跟著輸出,每個引用都找得到,沒有 `.ts`。
- CSP:兩張卡的 `App.svelte` 與 `main.ts` 照 hud/ 的 `scanHudLoads` 規則:沒有 `style=` 屬性(`style:` 指令可以,那是 CSSOM,T14 的 G7)、
  不插 inline `<style>`、沒有外部網址。
- `npm run boundaries` 綠(要基底含 `7b405e5`)。

### 10. 觀感(`@manual`,前端重拍、技術顧問判;開發 worker 不做這件)

- 用 `tauri build` 的產物重拍,不用 `tauri dev`(`tauri dev` 沒有 CSP,理由同 T2c-2 工單驗收 11)。重活,要協調者給位子。
- 起法同 T2c-2 `@manual`:暫存的 `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_CACHE_HOME`、`vault.ts init` 建的暫存學習根,
  WebKit 遠端檢查器截圖與讀 console,關窗送 `WM_DELETE_WINDOW`。真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
- 三個 `@manual` 場景各附截圖:
  - 教學卡顯示有例子框的卡:很細的黑線切角框、HUD 按鈕、例子框左右都有邊距;
  - 考試卡顯示填空題:作答欄是完整的 HUD 輸入框,不是一條細線;不捲動就看得到「送出」;
  - 內文剛好 100 字的卡:前端在執行中的教學視窗裡,經由檢查器把內文換成 100 字(契約 §2 的算法,用 ui-shared 的 `wordCount` 算過),
    **不改檔**;在預設視窗大小下由技術顧問判斷好不好讀。
- 兩個視窗的 console 都是 0 則,沒有 CSP 違規。

## 使用者看得到的差別

- 兩個視窗:整個視窗是一塊白色半透明面板,四邊是很細的黑線,四個角切斜。按鈕是 HUD 按鈕:滑過整顆變橘,鍵盤焦點多一圈淺色內框。按鈕上的英文用 Rajdhani。
- 教學卡:上面那個大大的「教學卡」標題不見了(視窗名稱在系統標題列)。例子框左右都有空間,顏色換成 HUD 的淺灰。
- 考試卡:「0 / 3」旁邊多一條綠色 HP 條,答一題長一格。作答欄變成有切角黑框的 HUD 輸入框。
  **多一顆「送出」鍵**;Enter 與 Ctrl+Enter 照舊能用。「答對了」「答錯了」的綠與紅深一點。
- 展示頁:勾深色背景時,頁首的字看得清楚了;多了兩個作答欄範例。
- 還不會變的:系統標題列還在,視窗也還不透明(那是 10 phase-6)。所以現在看不到自畫的標題列與縮放把手。

## 紅測試(另一個角色寫,開發 worker 不改)

規格作者(本工單作者)不寫紅測試(SKILL §4g 第 1 條)。**建議由 -e5 寫**,-ed 驗收。
這跟 T13 一樣是三雙不同的手:規格、紅測試、驗收各一個人。-e5 沒空時改由 -ed 寫,驗收照舊 -ed。

紅測試要量的東西:

| 驗收 | 量什麼 | 怎麼量(建議) |
|---|---|---|
| 1、2 | 兩張卡的原始碼 | 靜態掃描 `App.svelte` 與 `main.ts`:最外層只有一個 `<HudPanel>`;沒有 `<h1>`、沒有原生 `<button>`;考試卡每個 `<input>` / `<textarea>` 的祖先有 `<HudField>`;`<HpBar>` 的 `done` / `total` 綁 `view.answeredCount` / `view.totalCount`;送出鍵的 `onclick` 呼叫 `submitFill` / `submitApply`、`disabled` 含 `view.submitting`;`<style>` 用 hud/ 的 `parseCss` 檢查不畫框、`colourLiteralProblems` 的規則檢查顏色;不提那兩個 class、不傳 `frameless` / `solid`;import 只來自 `@learning/ui-shared/hud/`(考試卡) |
| 2 | 結果字色 | `hud.css` 的 `--hud-pass`、`--hud-fail` 用 `worstContrast` 算,≥ 4.5 |
| 3 | HP 條 | headless Chrome 開 `apps/test-card` 的 dev server,360 × 480;透過 DOM 填答案、點「送出」與「下一題」;讀 `data-percent`、截圖量綠色那一段、讀進度那一區的字 |
| 4 | HudField | 在展示頁量框線墨水量、切角、高度與寬度、focus-within 的像素差;沿用 `render-test-support.ts` 的 `inkAcross`、`differingPixels`、`forceState` |
| 5、6、7 | 兩張卡畫出來的版面 | 同 3 的開法;量面板矩形、整頁與捲動區的捲動尺寸、四邊墨水量(只往內量)、`.lc-example` 的左右邊距、送出鍵的矩形與 `elementFromPoint` |
| 8 | D1 | 展示頁深色背景勾 / 不勾;頁首每個直接有字的元素,字設透明後截圖,算字色對每個像素的最差對比 |
| 9 | 不退步 | 場景 4:在子行程跑 `(@test-card or @teach-card) and @phase-1 and not @manual`,要 exit 0 而且場景數 > 0;「.feature 沒改」建議把 done phase 的 `.feature` 雜湊釘在步驟裡,並讀兩份 FEATURE.md 的 phase 表,新出現的 done phase 不在清單裡就紅(逼人有意識地更新,不默默放過) |

注意事項:

- 卡片視窗的量測需要把 `openGallery` 一般化(例如 `openApp(目錄, 視窗大小)`)。那是測試 agent 的檔,開發 worker 不改。
- 測試放在 14 自己的地方(`packages/ui-shared/src/hud/`、`features/steps/hud-skin-*.steps.ts`)時,**讀卡片的檔用 fs 讀、開 dev server 用目錄路徑**,
  不要 `import` 06、07 的模組。不然會多出一條 14→06 / 14→07 的 import,boundaries 只開了反方向。
- 新的步驟句子不能跟現有的重複或撞到(`npm run check:steps`、`npm run check:gherkin-dup`)。
- 在基底上預期:驗收 1–8 紅,9 綠(防退步)。請在紅分支的 commit 說明裡貼紅的原文。
- 建議照 T14 用丟棄式改法證明能轉綠(不進 git,交件前刪)。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud apps/teach-card apps/test-card
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@hud-skin and @phase-2 and not @manual' --format summary
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@hud-skin and @phase-1 and not @manual' --format summary
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '(@test-card or @teach-card) and @phase-1 and not @manual' --format summary
NODE_OPTIONS=--import=tsx npx cucumber-js --name '^The real front ends are loaded$' --format summary
npm run boundaries
npm run build:frontends -w apps/desktop
```

- 環境:`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`。受保護的測試檔清單由協調者派工時附上。
- **cucumber 一律用 `--tags`,不要在命令列給 feature 檔路徑**:`cucumber.js` 的 `paths` 不會被命令列蓋掉,給檔名會跑全部場景。
- **每次跑 cucumber,`BeforeAll` 都會先 `cargo build --bin lc-fs`**(10 phase-2 的步驟檔,不管 `--tags` 選了什麼)。
  新 worktree 的第一次是冷編譯,約 55 秒,算重活,先跟協調者拿位子;之後是增量編譯,很快。
- 量測會開 headless Chrome(這台是 `/usr/bin/google-chrome`,或設 `LC_CHROME`),一次約 4 秒,跑完自己收掉。
- `build:frontends` 是兩次 vite build,輸出在 `apps/desktop/dist/`(gitignored),很輕。
- 不跑變異測試(-ed 驗收的事)、不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev` / `tauri build`。

## 不在範圍

- 不改任何測試檔(`*.test.ts`、`*test-support.ts`、`features/steps/`)與 `.feature`。覺得測試錯了就停下回報協調者,由紅測試作者改。
- 不改 06、07 的行為與邏輯檔(`session.ts`、`types.ts`、`stubs/`、`lib/`);不加 07 的「換類別」「深入這個」(07 phase-2、phase-3)。
- 不碰 `apps/desktop/`:無框、透明、設根元素的兩個 class 都是 10 phase-6。
- 不改 `ui-shared` 根目錄的檔(`index.ts`、`example-fence.ts`、`word-count.ts`,07 的)、`package.json`、`package-lock.json`。
- 不需要新 ADR(例外是已存在的 ADR-071)。
- T14 已接受、不做的:G4(斜邊 0.71 像素)、G7(HP 條的 CSSOM style 屬性)、G8(展示頁印原始 markdown)。

## 預算

`budget_usd: 5`(比 T14 的 3 多:兩個畫面加一個新元件)。grok 不設花費上限(使用者 2026-10-15),只記錄;算不出來寫「不知道」。

## 測試誰寫

- 紅測試、步驟定義、量尺:建議 -e5(見上),在 `pollux0971/t15-red` 之類的分支,開發 worker 以它為基底。
- 實作:worker-grok,只改「touches」列的檔。
- 驗收:-ed,照 `worker-acceptance`。
- 觀感:前端重拍,技術顧問判(驗收 10)。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip(含 `7b405e5`),同一時間只給一個 agent。派工歸協調者。
排程:現在沒有人動 `apps/teach-card`、`apps/test-card`(06 phase-2/3、07 phase-2 的 I3 接線還沒開),R2 沒有互斥;本張做的期間不要開那幾張。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。

## 請技術顧問決定

- **Q1(規格措辭)**:`phase-2.feature` 場景 1 寫「its panel, its three buttons and its title bar」,但教學卡現在只有「下一個」一顆
  (07 的設計是三顆,另外兩顆在 07 phase-2、phase-3)。
  - 建議:不改 `.feature`;步驟把「three buttons」讀成「07 設計的三顆裡已經存在的那幾顆」,檢查「每一顆按鈕都是 HudButton、沒有原生 `<button>`」,不加空按鈕。
  - 另一個做法:改 `.feature` 的措辭成「its buttons」。那要動 `.feature`,協調者說這張不改,所以不建議。
- 第 2 點的「送出」出現時機、第 5 點「面板撐滿視窗」、`--hud-pass` / `--hud-fail` 兩個新設計值,是 UI/Tauri 負責人依 FEATURE.md 的設計值與使用者選的 A 決定的;
  顧問審工單時不同意就改。
