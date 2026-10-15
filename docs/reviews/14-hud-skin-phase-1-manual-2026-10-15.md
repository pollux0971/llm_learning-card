# 14-hud-skin phase-1 `@manual`:展示頁的長相

> 作者:UI/Tauri 負責人(本資料夾的規格作者,不是實作者)。判定:技術顧問。日期 2026-10-15。
> 依據:`../../features/14-hud-skin/phase-1.feature` 的兩個 `@manual` 場景,以及技術顧問 2026-10-15 的派令
> (切角框與 1 像素黑線、亮色、標題列有無 `hud-frameless`、按鈕一般 / hover / focus、HP 條、減少動態、Rajdhani 有沒有真的載入、中英混排、console 與 CSP)。
> 被驗:main `63e4dc6f5b8bf39f05eaf9687f940917fb893e4f`,workers clone 的 detached worktree,沒有 `.env`。

## 結果一覽

| 項目 | 結果 |
|---|---|
| 1 像素黑線沿著切角 | 直邊量到正好 1 像素 `#000`;45° 斜邊比較細(G4) |
| 亮色、**半透明** | **不成立**:面板量到是不透明的灰色 `(230,230,230)`,看不到後面(G1) |
| 標題列 | 沒有 `hud-frameless`:沒有標題列、沒有縮放把手;有:標題列 1 條、把手 8 個,瀏覽器裡沒有 – × |
| 按鈕 hover / focus | 都變橘色 `rgb(232,120,32)`;兩者長得一樣(G5)。只有英文字的按鈕,框線變粗(G3) |
| HP 條 | 綠色、斜切尾端、1 像素黑框;0 只剩框、3/3 填滿不斜切 |
| 實心底開關 | 切角外面變實心色;頁面 38 個元素的位置與大小前後一模一樣 |
| 減少動態 | 開啟時沒有任何元素在動畫或轉場;關掉後恢復 |
| Rajdhani | 真的載入了(兩個引擎都是 `loaded`;系統沒有裝 Rajdhani,所以是附帶的字型檔) |
| 中英混排 | 能用;Rajdhani 的大寫看起來比中文小一號(G6) |
| console 與 CSP | 套上桌面版 CSP 的正式產物:WebKitGTK 0 則;Chrome 0 次 CSP 違規,唯一一則是 Chrome 自己要 `/favicon.ico` 的 404 |

## 怎麼做的

- 開發伺服器:照 FEATURE.md 的單獨執行指令 `npx vite packages/ui-shared/src/hud/gallery`,只多加 `--host 127.0.0.1 --port 5199 --strictPort` 固定網址。
- 兩個引擎:
  - **Chrome 142 headless**(隔離的暫存 user-data-dir),用 DevTools Protocol。
    hover 與 focus 用 `CSS.forcePseudoState`,減少動態用 `Emulation.setEmulatedMedia`,截圖用 `Page.captureScreenshot`。
    `securitypolicyviolation` 的監聽器在頁面腳本之前就裝好(`Page.addScriptToEvaluateOnNewDocument`)。
  - **WebKitGTK 2.52.6**(桌面 app 在 Linux 用的引擎)。放在不顯示的 `Gtk.OffscreenWindow` 裡,用遠端檢查器讀 console、截圖。
- **不送滑鼠鍵盤。** 兩個開關是在頁面裡呼叫 checkbox 的 `click()`,中英混排是改掉頁面上幾個元素的文字(只在這次的 headless 頁面裡,沒有改檔)。
- CSP:dev server 本身沒有 CSP,而且它用 JS 插 `<style>`,套上 CSP 量不準。所以另外跑一次
  `npx vite build packages/ui-shared/src/hud/gallery --outDir <scratchpad>`(協調者同意,約 0.2 秒,不寫進 repo)。
  再用一個小的靜態伺服器送出,每個回應都帶 `apps/desktop/src-tauri/tauri.conf.json` 的 CSP:
  `default-src 'self'; script-src 'self'; object-src 'none'; frame-src 'none'; img-src 'self' lc: data:; connect-src ipc: http://ipc.localhost`。
- 截圖放在前端的 scratchpad,沒有進版控,路徑另外送技術顧問。像素顏色用 PIL 讀截圖取得。

## 量到的值

| 項目 | Chrome | WebKitGTK |
|---|---|---|
| `document.fonts` | `Rajdhani 500 loaded` | `Rajdhani:loaded` |
| `document.fonts.check('500 16px Rajdhani')` | true | true |
| 字型請求 | `200 font/ttf`(dev:`/@fs/…/fonts/Rajdhani-Medium.ttf`;正式產物:`/assets/Rajdhani-Medium-*.ttf`,同源) | 同左(正式產物) |
| 面板內部像素 | (230, 230, 230) | (230, 230, 230) |
| 頁面背景像素 | (213, 222, 230) | (213, 222, 230) |
| 框線 | 左邊 x=24 是 (0,0,0),x=25 已經是面板色 | 同左 |
| hover(第 2 顆) | 底色 `rgb(232, 120, 32)`;內層 `rgba(232, 120, 32, 0.16)` | — |
| focus-visible(第 3 顆) | 底色 `rgb(232, 120, 32)` | — |
| HP 條 | `--hp-fill` 0%、66.67%、100%;填色 `rgb(47, 158, 68)`;框 `1px rgb(0, 0, 0)` | 正式產物在 CSP 下 `::before` 寬 0 / 425 / 638 px(條寬的 0、2/3、全部) |
| 減少動態 | `matches: true`;面板 `animation-name: none`、按鈕 `transition-duration: 0s`;所有元素裡在動畫或轉場的:0 | — |
| 恢復一般動態 | 面板 `hud-expand 0.16s`、按鈕 `0.12s` | 面板 `hud-expand` |
| 有 `hud-frameless` | 標題列 1、標題「同源政策」、– 與 × 各 0(不在 Tauri)、把手 8 | 標題列 1、把手 8 |
| 沒有 `hud-frameless` | 標題列 0、把手 0 | 標題列 0、把手 0 |
| `hud-solid` | `html` 底色 `rgb(244, 246, 248)`、沒有格線;38 個元素的位置前後相同 | 有截圖(沒有量位置) |

console 原文:

- 開發伺服器(Chrome、WebKitGTK 都一樣):`[vite] connecting...`、`[vite] connected.`(vite 的 debug 訊息)。
  Chrome 另外有一則 `Failed to load resource: the server responded with a status of 404 (Not Found)`,是 `/favicon.ico`。
- 正式產物套 CSP:WebKitGTK **0 則**,securitypolicyviolation 也沒有。Chrome 的 securitypolicyviolation 從頁面開始到結束都是 `[]`,
  唯一一則 console 是同一個 `/favicon.ico` 404。那是瀏覽器自己要的,頁面沒有要;WebKitGTK 這次沒有發出這個請求。

## 發現

### G1:面板不是半透明,是不透明的灰色(場景「the panels are light and slightly see-through」不成立)

- 原因:`.hud-cut` 是黑色底加 1px padding,整片墊在 `.hud-cut-inner`(`rgba(255, 255, 255, 0.9)`)下面。
  所以面板到處都透出 10% 的黑:0.9 × 255 + 0.1 × 0 ≈ 230。量到的就是 230,兩個引擎都是。
- 如果真的是半透明,應該透出頁面:0.9 × 255 + 0.1 × (213, 222, 230) ≈ (251, 252, 253),而且看得到格線。現在看不到格線,也比設計值灰。
- 到了透明視窗(10 phase-6)也一樣:桌面永遠透不進面板,只有切角外面才看得到桌面。
- 建議方向(實作細節由實作者定):黑線只畫成一圈,不要整片墊在面板下面。
  例如 `.hud-cut` 底色透明,線用一個偽元素畫,`mask` 用兩層 `mask-composite: exclude` 挖掉中間。
  或者 `clip-path` 走「外八角形加內八角形」的單一路徑。對比測試要用合成之後的顏色重算。

### G2(往後的事,現在先記):頁面的格線底色寫在共用的 `hud.css` 裡

- `hud.css` 的 `html { background-color: var(--hud-page); background-image: …格線… }` 是展示頁用來假裝桌面的。
  但它寫在兩張卡 phase-2 都會 import 的共用樣式表裡。
- 套到卡片、視窗又透明(10 phase-6)之後,切角外面會是這片不透明的格線,看不到桌面。
- 建議:格線搬進 `gallery/Gallery.svelte`(或掛在只有展示頁才有的 class 底下)。`hud.css` 的 `html` 預設透明,只有 `hud-solid` 才填實色。

### G3:只有英文字的按鈕,上下框線變成 2–3 像素

- 中英混排那一張(WebKitGTK)裡,按鈕寫「NEXT」那一顆:同一欄量到上框 2 像素、下框 3 像素。「BACK 上一張」「OK 記住了」都是 1 像素。
- 原因:`.actions` 是 flex,三顆按鈕被拉成一樣高(最高的是中文字的行高)。但 `.hud-button-label` 是 `display: block`,
  高度只有自己的那一行;Rajdhani 的行高比中文矮,上下就露出底下的黑色,看起來像框變粗。
- 現在兩張卡的按鈕都是中文,所以還不會發生;只要有一顆是純英文(或字型不同),就會出現。
- 建議:讓內層填滿按鈕,例如按鈕用 `display: grid`,或內層 `height: 100%`。

### G4(小):45° 斜邊的線比 1 像素細

- 內層切角是 `--hud-cut - 1px`,斜邊的垂直距離只有 1/√2 ≈ 0.71 像素。截圖放大 8 倍看得出來,原尺寸是斜邊稍淡。
- 要斜邊也是 1 像素,內層切角是 `cut − (2 − √2) × 線寬`(約 `cut − 0.59px`)。觀感由技術顧問判,我覺得可以先不改。

### G5(小):focus 的外框被切角裁掉,focus 看起來跟 hover 一樣

- `:focus-visible` 的 `outline: 1px solid` 與 `outline-offset: 2px` 在按鈕自己的 `clip-path` 外面,所以被裁掉、看不到。
- 結果 focus 與 hover 都是整顆變橘。場景只要求「hover 與鍵盤焦點用橘色標出」,這點成立。只是那兩行 outline 沒有作用,鍵盤使用者分不出現在是 hover 還是 focus。

### G6(觀感):中英混排時,Rajdhani 的大寫看起來比中文小一號

- 標題列試了「CORS 與 Same-Origin 政策 Level 2」(`text-transform: uppercase`)。拉丁字母明顯比旁邊的中文矮、細。按鈕的「BACK 上一張」也一樣。
- 要調的話,可以在 `@font-face` 加 `size-adjust`(例如 110%),或給顯示字型另一個字級。由技術顧問判要不要調。

### G7(資訊):HP 條在執行時有 `style` 屬性

- Svelte 的 `style:--hp-fill` 執行時用 CSSOM(`style.setProperty`)設值,所以 DOM 上看得到 `style="--hp-fill: 66.66666666666666%;"`。
- CSP 不管 CSSOM:正式產物在桌面版 CSP 下,兩個引擎 0 次違規,填色寬度正確。
- 場景「no element carries an inline style attribute」是掃原始碼量的,原始碼裡確實沒有 `style=`。執行時的這個屬性要不要算違反,由技術顧問判;
  我覺得那條規則是為了 CSP,而 CSP 實測沒問題,可以接受。

### G8(展示頁才有):卡片內文是原始 markdown

- 展示頁把 fixture 的內文原樣印出來,` ```example `、反引號都看得到。只影響展示頁。教學卡自己會排版,phase-2 套上去之後不會這樣。

## 資料前後

真的 learning/ 前後都是 64 / ee37f9e1fa9193c6 / 70,真的指標檔沒變。worktree 的 `git status --porcelain` 是空的。
vite 的快取在 `node_modules/.vite`,已經被忽略。

## 花費

LLM $0;grok 沒用。CPU:`npm ci` 約 6 秒,vite build 0.2 秒,其他都是開頁面。

## 結論

- 兩個 `@manual` 場景:
  - 「The gallery looks like an SAO style HUD」:**有一條不成立**。半透明不成立(G1);1 像素黑線、橘色亮點、HP 條都成立。
  - 「The solid fallback fills the corners」:成立。
- 派令的其他項目:標題列有無 `hud-frameless`、減少動態、Rajdhani 載入、CSP 與 console,都成立。
- 待技術顧問裁決:G1(建議回 phase-1 修)、G3(建議一起修)、G2(建議記進 14 phase-2 的 NEXT 或工單)、G4–G8。
