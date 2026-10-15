# 14 · hud-skin

## 一句話

兩個視窗共用的 SAO(刀劍神域)HUD 外觀:亮色半透明面板、很細的黑線切角框、自畫的標題列、HUD 按鈕、HP 條式進度條;
先做成一套元件,再套到教學卡與考試卡上。

> 來源:使用者 2026-10-15 對 UI/Tauri 負責人說「以第一階段來說可以,不過我要無框+SAO刀劍神域 特殊框HUD風格」;
> 選了 A(透明視窗、切角就是視窗形狀)、亮色;要求拆成兩塊(本資料夾 = 外觀;無框視窗 = 10 phase-6);
> 補充「可以畫出很細的黑線當框」。技術顧問 2026-10-15 審過分流提案(編號 14、透明的風險與退路、字型授權)。

## 範圍

- 外觀的設計值(顏色、線寬、切角大小、字型、間距、動畫時間)只有一份:`packages/ui-shared/src/hud/hud.css` 的 CSS 自訂屬性
- 切角框元件:很細的黑線(1 CSS 像素、`#000`)沿著切角畫一圈,裡面放任意內容
- 標題列元件:視窗標題、縮小(–)與關閉(×)兩個按鈕、拖曳區;**在 Tauri 裡**才顯示按鈕並呼叫視窗 API,
  在一般瀏覽器裡(06、07 的 `npm run dev`)按鈕不顯示、不丟錯
- 縮放把手元件:四邊四角各一個,拖曳時呼叫視窗的「開始縮放拖曳」;沒有系統外框之後,Linux 的邊緣縮放會不見,設計 §4.1 要「可縮放」
- 頁面根元素的兩個 class 決定兩件事,**由桌面殼(10 phase-6)設定**,本資料夾只照著畫:
  - `hud-frameless`:視窗沒有系統外框 → 顯示自畫的標題列與縮放把手。沒有這個 class 時兩者都不顯示
    (系統標題列還在的時候,不會出現兩條標題列)
  - `hud-solid`:透明做不出來 → 切角外面畫實心底色(退路)
- HUD 按鈕元件(教學卡的三個按鈕、考試卡的送出鍵用同一種)
- 作答欄元件(phase-2,T15):包住原生的 input / textarea,畫跟按鈕同一種切角細黑框;考試卡的作答欄用它
- HP 條式進度條元件:輸入「已完成 / 總數」,畫出綠色、斜切尾端、細黑框的條
- 減少動態:系統要求減少動態(`prefers-reduced-motion: reduce`)時關掉所有動畫
- 展示頁:一頁放齊所有元件與兩種模式(透明、實心底),吃 fixture 文字,能單獨跑
- 把元件套到教學卡(`apps/teach-card`)與考試卡(`apps/test-card`)的畫面上(phase-2)
- 一併處理技術顧問 T2c-1 `@manual` 的兩條觀感意見(phase-2):教學卡 example 灰底貼到視窗右邊;
  考試卡作答欄只是細框、看不到送出鍵

## 不在範圍

- 視窗本身的外框、透明、拖曳與縮放的權限設定(→ 10 phase-6,`apps/desktop/`)
- 偵測桌面有沒有合成器(compositor)、決定要不要加 `hud-solid` 與 `hud-frameless`(→ 10 phase-6;本資料夾只負責「有 class 時怎麼畫」)
- 卡片內容、按鈕的行為、題目判斷(→ 06、07、04、05;本資料夾只改長相,不改它們做什麼)
- 系統列與「關閉縮到系統列」(→ 10 phase-3;標題列的關閉鈕送的是跟系統關閉同一個關閉請求,見 10 phase-6)
- 多套主題、讓使用者換主題(使用者只要這一套;要多套走 `/feature`)
- 官方 SAO 的 logo、圖檔、字型、音效:一律不用,全部自己畫

## 單獨執行

```bash
npx vite packages/ui-shared/src/hud/gallery
```

預期:dev server 起來,瀏覽器開它看到展示頁:亮色半透明的切角框(很細的黑線)、
三個 HUD 按鈕、0/3、2/3、3/3 三條 HP 條;頁面上有兩個開關,切換根元素的 `hud-frameless`(出現標題列與縮放把手,
瀏覽器裡標題列沒有 – × 按鈕)與 `hud-solid`(切角外面變實心底)。

**同時要加進根目錄的 `standalone.json`**(`14-hud-skin`,`interactive: true`)——那是協調者的共用檔,寫在「待協調」。

## 依賴

**Wave 0(phase-1)**:無。元件只 import 自己的目錄、`svelte` 與 `@tauri-apps/api`(root 已裝);展示頁吃
`contracts/fixtures/cards/` 的卡片文字,不 import 06、07 的程式。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1、06 與 07 的 phase-1(都 done)、boundaries 例外(見下) | 套到兩個畫面上;06、07 要 import 本資料夾的元件 |

**跨資料夾的例外(phase-2 起)**:`apps/teach-card`(07)與 `apps/test-card`(06)要 import `packages/ui-shared/src/hud/`(14)。
理由:外觀只有一份,兩邊各抄一份就會長得不一樣。只開「06→14」「07→14」兩條,不開 14→06/07。
ADR-035 第 2 點寫「06-test-card 在 I3 前不 import ui-shared」,那條是為了不讓 06、07 同時改 07 擁有的圍欄插件;
`hud/` 歸 14,不是 07 的檔,所以不碰那條的理由。記在 ADR-071(例外,不是推翻 ADR-035)。

## Wave 0 的重複

無。

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 位置 | `packages/ui-shared/src/hud/` | ui-shared 已是 workspace,不改 root `package.json`;owners 表加 `packages/ui-shared/src/hud/` → 14(比 07 的 `packages/ui-shared/` 長,協調者改) |
| 元件 | Svelte 5 | 跟 06、07 同一套 |
| 樣式 | 全部放 `.css` 檔與元件的 `<style>` | 不用 HTML 的 `style=` 屬性、不插 inline `<style>`(桌面版 CSP 是 `default-src 'self'`,沒有 `style-src`) |
| 字型 | 開放授權(SIL OFL 1.1)的拉丁字型,只用在標題、數字、按鈕的英文字;中文用系統字型 | 候選 Rajdhani(OFL 1.1)。字型檔與 `OFL.txt` 一起放在 `hud/fonts/`,從本機載入,不連外部字型服務(CSP)。**已選定(2026-10-15 回寫)**:Rajdhani Medium v1.201(Indian Type Foundry),SIL OFL 1.1,檔案 `Rajdhani-Medium.ttf` 與 `OFL.txt` 在 `hud/fonts/`,與上游 google/fonts 倉庫 ofl/rajdhani 的檔逐位元組相同(sha256 前 16 碼 12ff7dcfe4c206e3,驗收者 -ed 比對);`@font-face` 帶 `size-adjust`(大於 100%,T14),讓中英混排的大寫字高接近中文 |
| 視窗 API | `@tauri-apps/api/window` 的縮小、關閉、開始拖曳、開始縮放拖曳 | 只在偵測到 Tauri 時呼叫;權限由 10 phase-6 開。關閉一律呼叫視窗的 `close()`(送出跟系統關閉同一個關閉請求),不直接結束程式、不直接藏視窗 |
| 測試 | vitest(純函式與設定值的檢查)+ cucumber | 外觀本身走 `@manual`,由技術顧問判 |
| 變異門檻 | 寬鬆,不強制 | UI;可自動的只有幾個純函式 |

### 外觀的設計值(phase-1、phase-2 照這個做;要改先問 UI/Tauri 負責人)

| 項目 | 值 |
|---|---|
| 面板 | 白色半透明,不透明度約 0.9(太透明會讓 100 字的內文難讀) |
| 框線 | **很細的黑線**:1 CSS 像素、`#000`,沿切角畫一圈 |
| 切角 | 四個角各切一個 45° 小角(約 8–12 px),框線跟著切角走 |
| 內文字色 | 深灰,對面板底色的對比 ≥ 4.5 : 1 |
| 亮點 | 橘色:滑過、鍵盤焦點、目前這一項。**只用在線條與底色**,不用來印內文(橘字在白底對比不夠) |
| HP 條 | 綠色填滿、右端斜切、細黑框;0 時只剩框,滿時填到底 |
| 動畫 | 面板打開時展開一次,≤ 200 ms;減少動態時沒有動畫 |
| 作答欄(phase-2) | 跟按鈕同一種框(1 像素黑線、切角),裡面是面板色;單行高度 ≥ 36 px;鍵盤焦點時框線變橘 |
| 結果字色(phase-2) | `--hud-pass` 綠、`--hud-fail` 紅,對面板的最差對比 ≥ 4.5(算法同內文) |
| 卡片視窗裡的面板(phase-2) | 撐滿視窗(使用者選 A:切角就是視窗的形狀);內容比視窗長時捲面板裡面,不捲整頁 |
| 標題列的縮小、關閉鈕(10 phase-6,T16) | 跟 HudButton 同一種切角畫法;hover 框線飽和橘加淡橘底,focus 框線飽和橘加淺色內框;任何狀態都不准有 outline |
| 縮放把手(10 phase-6,T16) | 看不見;hover 時不畫填色,只換游標 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | HUD 元件與展示頁(瀏覽器單獨跑) | Wave 0 | done | 2026-10-15 |
| 2 | 套到教學卡與考試卡 | 不綁整合點 | done | 2026-10-16 |

## 驗收方式

- **外觀類的規則**(技術顧問 2026-10-16,T15 的教訓):每一種狀態(一般、hover、focus、停用)都要量,不存在的狀態要寫明;量法要分得開不透明與半透明(放大法:`--hud-panel` 覆寫成 `rgba(255, 0, 0, 0.5)`、頁底 `#202020`);切角外側與外圍一圈的橘色點數要是 0。
- 自動:設計值的對比(內文字色 vs 面板底色 ≥ 4.5 : 1)、HP 條比例的算法、標題列在非 Tauri 環境不顯示按鈕也不丟錯、
  樣式檔沒有外部網址、沒有 `style=` 屬性、字型檔旁邊有授權檔。
- `@manual`:展示頁與兩個視窗的長相,由技術顧問判(截圖用 `tauri build` 的產物,理由見 T2c-2 工單驗收 11)。

## 開放問題

- 切角外面「看起來透明」的區域,點擊仍然會被視窗吃掉(視窗實際上還是長方形)。使用者選 A 時已知道;
  要做到點擊穿透得改視窗形狀,現在不做。

## 待協調

共用檔只有協調者改(ADR-035 第 3 點),這裡列需求:

1. `standalone.json` 加 `"14-hud-skin": { "cmd": "npx vite packages/ui-shared/src/hud/gallery", "interactive": true, "pending": "14-hud-skin/phase-1" }`
   (phase-1 做完之前指令跑不起來,用 `pending` 不擋 gate)。
2. `scripts/boundaries.owners.json` 加 `["packages/ui-shared/src/hud/", "14-hud-skin"]`(比 07 的 `packages/ui-shared/` 長,所以優先)。
3. phase-2 開工前:`scripts/boundaries.allow.json` 開 `apps/teach-card`(07)→ `packages/ui-shared/src/hud/`(14)與
   `apps/test-card`(06)→ 同一個目錄,兩條,理由見「依賴」。
4. `docs/01-roadmap.md` 的「未排程」加一行:14-hud-skin phase-1、phase-2 與 10 phase-6(使用者 2026-10-15 的需求)。
5. phase-1 的紅測試(測試 agent)寫好步驟定義之後,`phase-1.feature` 第一行再加 `@standalone`。
   現在先不加:`accept:standalone` 不是 dry-run,步驟還沒定義就會紅。
