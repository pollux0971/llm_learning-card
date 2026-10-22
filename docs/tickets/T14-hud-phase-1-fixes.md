---
id: T14
deps: []
touches: [packages/ui-shared/src/hud/hud.css, packages/ui-shared/src/hud/HudPanel.svelte, packages/ui-shared/src/hud/HudButton.svelte, packages/ui-shared/src/hud/gallery/Gallery.svelte]
cpu: light
budget_usd: 3
status: merged
owner: worker-grok
must_catch:
  - 黑線層又整片墊回面板底下(面板變成不透明的灰):「面板半透明」的像素檢查必須紅
  - --hud-panel 改成不透明(alpha 1):「面板半透明」必須紅
  - 純英文按鈕的內層沒有撐滿按鈕(上下露出黑底,框看起來 2–3 像素):「框線 1 像素」必須紅
  - 切角斜邊的線被拿掉(例如改用只畫矩形的 mask 再裁成八角形):「切角還有細線」必須紅
  - focus-visible 的樣式拿掉、跟 hover 一樣,或畫在按鈕自己的 clip-path 外面被裁掉:「焦點跟 hover 不一樣」的像素檢查必須紅
  - 格線或底色回到 hud.css 的 html / :root / body 規則:「共用樣式不畫頁面底色」必須紅
  - 拿掉 Rajdhani 的 size-adjust,或設成 100% 以下:size-adjust 檢查與大寫高度比例都必須紅
  - 展示頁沒有深色背景的切換,或切了之後面板後面不是深色、沒有高對比圖樣:深色背景那條必須紅
  - 深色背景上面板不符合疊色公式(例如深色模式另外把面板改成不透明):深色背景的疊色檢查必須紅
  - 深色背景或格線寫進 hud.css(hud.css 提到 gallery):「hud.css 不提 gallery」必須紅
  - 現有 14 phase-1 的測試(85 條 vitest、13 個非 @manual 場景)照舊全綠:長相改了,行為與規則不變
---

# 工單 T14:14-hud-skin phase-1 修補 —— 面板真的半透明、框線 1 像素、焦點看得見、格線搬出共用樣式、中英混排字高

> 狀態:草稿,待技術顧問審。
> 作者:UI/Tauri 負責人(14-hud-skin 的規格作者,不是實作者)。編號:協調者配(T14)。派工:協調者。
> 實作:worker-grok。驗收:-ed。觀感:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 裁決來源:技術顧問 2026-10-15 對 14 phase-1 `@manual` 的裁決——**暫不通過**:「使用者選的是白色半透明加橘色亮點,現在面板是不透明的灰,要修。」
> 證據:前端的 14 phase-1 `@manual` 報告(分支 `pollux0971/hud-p1-manual-evidence` @ `e36327c` 的
> `docs/reviews/14-hud-skin-phase-1-manual-2026-10-15.md`;還沒進 main,所以這裡不放連結)。
> 基底:main `63e4dc6`(含 14 phase-1 的實作與驗收)。紅測試在 `pollux0971/t14-hud-fixes-red`,開發 worker 以它為基底。

## 為什麼有這張

14 phase-1 的展示頁,前端用 Chrome 142 headless 與 WebKitGTK 2.52.6(桌面 app 在 Linux 用的引擎)量過,兩個引擎的結果一樣:

| 代號 | 問題 | 量到的 |
|---|---|---|
| G1 | 面板不是半透明,是不透明的灰 | 面板內部 (230, 230, 230)。黑色框線層(`.hud-cut` 的黑底 + 1px padding)整片墊在白 0.9 的面板下面:0.9 × 255 + 0.1 × 0 ≈ 230。真的半透明應該是 0.9 × 255 + 0.1 × 頁面 ≈ (251, 252, 253) |
| G2 | 頁面的格線底色寫在共用的 `hud.css` | `html { background-color: var(--hud-page); background-image: 格線 }`。phase-2 兩張卡一 import,透明視窗(10 phase-6)切角外面就會是格線,不是桌面 |
| G3 | 純英文的按鈕,上下框變粗 | 第 3 顆換成「NEXT」:上框 2.25、下框 3.00 像素(Chrome);2、3 像素(WebKitGTK)。flex 把按鈕拉高,內層 `display: block` 只有自己那一行高,底下的黑色露出來 |
| G5 | 鍵盤焦點跟 hover 長得一樣 | `:focus-visible` 的 `outline` 在按鈕自己的 `clip-path` 外面,被裁掉了;focus 與 hover 的截圖差 0 個像素,計算樣式也完全一樣 |
| G6 | 中英混排時,Rajdhani 的大寫比中文矮一號 | 同字級下,「H」是「國」的 0.72(42 / 58 px @64px)。Noto Sans CJK TC 自己的「H」是 0.81,那才是中文字型裡看起來相配的比例 |

另有三條顧問接受、**本張不用做**的:G4(45° 斜邊的線只有約 0.71 像素;新做法順便變成 1 像素最好,做不到也接受)、
G7(HP 條執行時 DOM 上有 `style="--hp-fill: …"`,那是 Svelte 用 CSSOM 設的,CSP 實測不擋)、G8(展示頁把卡片內文印成原始 markdown)。

## 驗收條件

1. **G1 面板真的半透明。** 黑線只畫成一圈,不再整片墊在面板底下。做法由實作者選,例如 mask 挖空中間,或 `clip-path: polygon(evenodd, 外八角形, 內八角形)`。
   - 量法:面板左右內距各一條直線,每個像素都要等於「`--hud-panel` 疊在面板後面那個像素上」,每個通道誤差 ≤ 3。
     「面板後面」是把面板藏起來再截一次、同一個位置量到的像素。
   - 展示頁現在的頁面底色是 (213, 222, 230),面板應該量到約 (251, 252, 253)。
   - 注意:不透明度 0.9 時,格線透過面板只差約 1.5 個色階,在展示頁肉眼幾乎看不出來;換成深色的桌面才明顯。
     所以自動驗收用疊色公式,眼睛看的部分見 1b。不透明度維持 0.9(技術顧問 2026-10-15:100 字內文好讀比較重要)。
1b. **展示頁加一個深色背景的切換**(技術顧問 2026-10-15:判觀感時要用眼睛看到它真的是半透明)。
   - 只改 `gallery/Gallery.svelte`:一個 `<input type="checkbox" data-gallery="dark-backdrop">`,勾起來就換成深色背景;不勾時是原本的格線。
     `hud.css` 不提 gallery,真的卡片不受影響。
   - 深色背景要有高對比的圖樣,例如深色底加粗格線,模擬桌面。顏色照舊只能用 `var(--hud-*)`(現有的「顏色字面值只在 hud.css」測試)。
     現有的變數就夠用:例如 `--hud-text`(#333)或 `--hud-line`(#000)當底,`--hud-solid` 畫粗格線。不新增顏色、不動 `hud.css`。
   - 量法(面板藏起來之後量面板後面):整片區域每 4 像素取一點,平均亮度 ≤ 128;面板左右那兩條取樣線上,亮度起伏 ≥ 100。
   - 切到深色時,面板一樣要符合驗收 1 的疊色公式。拿 #333 加 4 像素白格線來說,面板會在約 (235, 235, 235) 與 (254, 254, 254) 之間跟著格線變。
   - 前端重拍時附一張深色背景的面板截圖,技術顧問用那一張判斷是不是真的半透明。
2. **G3 框線在每條直邊都剛好 1 像素**:面板四邊、三顆按鈕的四邊,第 3 顆換成純英文「NEXT」也一樣;按鈕都是中文時也一樣。
   - 量法:每條邊的正中間,跨邊量 7 個像素的「墨水量」,要在 0.7–1.35 之間(1 像素的黑線 ≈ 1,不管落在整數還是半個像素上)。
3. **切角的斜邊還有細線**(防止 G1 的新做法把斜邊的線弄掉)。面板四個切角,在斜邊正中間那一列橫著量,墨水量要在 0.6–2.0 之間。
   45° 的線橫著量是垂直粗細的 √2 倍:0.71 像素 ≈ 1.0,1 像素 ≈ 1.41,沒有線 ≈ 0。G4 不強制。
4. **G5 鍵盤焦點看得見,而且跟 hover 不一樣。**
   - 第 2 顆按鈕強制成 `:focus` + `:focus-visible` 之後,截圖(按鈕外擴 6 像素)要跟 `:hover` 有 ≥ 30 個像素看得出不同(任一通道差 > 32),
     跟一般狀態也要 ≥ 30 個。
   - 按鈕與它所有後代(含 `::before`、`::after`)跟外觀有關的計算樣式,也要跟 hover 不同。
   - 焦點的記號必須畫在看得到的地方(按鈕自己的 `clip-path` 裡面)。例如框內再加一圈 2 像素的內框。
5. **G2 格線搬出共用樣式。** `hud.css` 裡指整個頁面的規則(`html`、`:root`、`body`)不設 `background`、`background-color`、`background-image`;
   只有帶 `hud-solid` 的規則(實心底退路)可以。展示頁的格線搬進 `gallery/Gallery.svelte`(例如 `:global(html)`)。
   顏色照舊只能用 `var(--hud-*)`(現有的「顏色字面值只在 hud.css」測試),`--hud-page` 與 `--hud-page-line` 兩個設計值留在 `hud.css`。
6. **G6 中英混排的字高。** Rajdhani 的 `@font-face` 加 `size-adjust`,而且要大於 100%。
   同字級、同一串顯示字型(按鈕的 `font-family`)下,用畫布量「H」與「國」的實際高度,比例要在 0.78–0.92 之間。
   前端用丟棄式的改法試過:112% 時量到 0.81。
7. **不退步。** 14 phase-1 現有的測試全部照舊綠:`packages/ui-shared/src/hud/*.test.ts` 的 85 條,以及 `phase-1.feature` 原本 13 個非 `@manual` 場景。
   CSP 照舊:不用 HTML 的 `style=` 屬性,不插 inline `<style>`,不連外部服務。
8. **觀感(`@manual`,前端重拍、技術顧問判)。** 修完之後,前端照 14 phase-1 `@manual` 報告的方法重拍:
   Chrome 與 WebKitGTK 兩個引擎,外加「正式產物套桌面版 CSP」。其中標題列的中英混排一定要重拍,
   深色背景下的面板也要附一張(驗收 1b)。交顧問判。

## 紅測試(規格作者寫,開發 worker 不改)

| 檔 | 內容 |
|---|---|
| `packages/ui-shared/src/hud/render-test-support.ts` | 量測本體:用 vite 的 `createServer` 起展示頁,開 headless Chrome(`LC_CHROME` 或常見路徑;找不到就紅,不跳過),720 × 900、一個 CSS 像素就是一個影像像素,`--force-color-profile=srgb`。hover / focus 用 DevTools 的 `CSS.forcePseudoState`,不送滑鼠鍵盤。檔名以 `test-support.ts` 結尾,所以不會被 hud/ 的原始碼掃描掃到 |
| `packages/ui-shared/src/hud/render.test.ts` | vitest:驗收 1–6 與 1b,共 10 條(驗收 2 多一條「都是中文」的對照,本來就綠;「hud.css 不提 gallery」現在也是綠的) |
| `packages/ui-shared/src/hud/render-test-support.test.ts` | 量尺自己的測試(合成影像):PNG 解碼五種 filter、墨水量(整數與半像素的 1px ≈ 1、2px ≈ 2、3px ≈ 3、外暗內亮不誤算)、像素差、`LC_CHROME` 錯了會丟錯。本來就綠 |
| `features/14-hud-skin/phase-1.feature` | 加 6 個場景(在原本的 `@manual` 前面) |
| `features/steps/hud-skin-render.steps.ts` | 那 6 個場景的步驟;展示頁與 Chrome 整個 cucumber 行程只開一次 |

在基底上的紅(原文,Chrome 142):

```text
G1   (29,180) 是 rgb(230,230,230),面板後面是 rgb(213,222,230),半透明疊上去應該約 rgb(251,252,253)
1b   展示頁沒有深色背景的切換([data-gallery="dark-backdrop"] 的 checkbox)
G3   第 3 顆按鈕(NEXT)的top邊框線量起來是 2.25 像素,要 1 像素
     第 3 顆按鈕(NEXT)的bottom邊框線量起來是 3.00 像素,要 1 像素
G5   focus-visible 跟 hover 只差 0 個像素(至少要 30),鍵盤使用者分不出焦點
     focus-visible 與 hover 的計算樣式完全相同
G2   hud.css 的「html」設了 background-color: var(--hud-page)
     hud.css 的「html」設了 background-image: linear-gradient(var(--hud-page-line) 1px, transparent 1px), …
G6   Rajdhani 的 @font-face 沒有 size-adjust
     大寫「H」高 42.0px、中文「國」高 58.0px,比例 0.724,要在 0.78–0.92 之間
```

vitest 共紅 8 條(G1、1b ×2、G3、G5、G6 ×2、G2),cucumber 用 tag 跑的 19 個場景裡紅 6 個。
本來就綠、在這張當防退步用的:面板四條直邊與另外兩顆中文按鈕的框線、切角斜邊的線(現在約 0.78)、hud.css 不提 gallery。

**能轉綠的證明**:前端用丟棄式的改法試過(沒有進 git,已還原)。改動是:黑線改成一圈、按鈕內層撐滿、焦點加一圈內框、
格線搬進展示頁、深色背景切換(#333 底加 4 像素白格線,只用 var())、`size-adjust: 112%`。
結果 hud/ 底下 105 條全綠:新的 10 條、量尺自測 10 條、原本的 85 條。做法不附,由實作者決定。

## 怎麼跑(都是輕的,不用拿重活位子)

```bash
VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@hud-skin and @phase-1 and not @manual'
```

- **cucumber 一定要用 `--tags` 縮範圍,不要在命令列給 feature 檔路徑**:`cucumber.js` 設定裡的 `paths` 不會被命令列蓋掉,給檔名會跑全部 764 個場景(前端踩過)。
- 每跑一次會開一個 Chrome 約 4 秒,跑完自己收掉(整個行程群組,暫存 profile 也刪)。這台的 Chrome 是 `/usr/bin/google-chrome`。
- 不跑變異測試(那是 -ed 驗收的事)、不跑完整 cucumber、不跑 `npm run check:all`。

## 不在範圍

- 不改任何測試檔(`*.test.ts`、`*test-support.ts`、`features/steps/`)與 `.feature`。覺得測試錯了就停下回報協調者,由規格作者改。
- 不碰 `apps/teach-card`、`apps/test-card`(那是 14 phase-2),不碰 `apps/desktop/`(10 phase-6)。
- `features/14-hud-skin/FEATURE.md` 技術棧的字型那一列(Rajdhani 的名稱、版本、授權)由協調者回寫,不是本張。

## 預算

`budget_usd: 3`。grok 不設花費上限(使用者 2026-10-15),只記錄;算不出來寫「不知道」。

## 測試誰寫

- 紅測試、步驟定義、量尺:UI/Tauri 負責人(規格作者)寫好了,在 `pollux0971/t14-hud-fixes-red`。
- 實作:worker-grok,只改「touches」列的檔。
- 驗收:-ed,照 `worker-acceptance`。
- 觀感:前端重拍,技術顧問判(驗收 8)。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是 `pollux0971/t14-hud-fixes-red` 的 tip,同一時間只給一個 agent。派工歸協調者。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
