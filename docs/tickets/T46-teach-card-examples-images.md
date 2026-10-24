---
id: T46
deps: [T45]
touches: [packages/ui-shared/src/example-fence.ts, packages/ui-shared/src/image-path.ts, packages/ui-shared/src/index.ts, apps/teach-card/src/, apps/teach-card/dev/]
cpu: light
budget_usd: 5
status: dispatched
owner: worker-grok
must_catch:
  - 例子一開始不是展開的、按標題收不起來、收起來之後換下一張卡新卡的例子不是收著的(或第一幀先展開再收):渲染測試 a 必須紅
  - 三個例子沒有各自的標題,或按其中一個的標題讓別的跟著收放:渲染測試 b 必須紅
  - 例子裡的相對路徑圖片沒有經 LearningFs 的 assetUrl 換成網址,或交給 assetUrl 的字串不是解析後的 learning 相對路徑(多解碼、少解碼、被 markdown-it 編碼過):單元測試 c 與 cucumber 的 Image paths resolve 場景必須紅
  - 解析之後不在最上層 assets 底下的路徑(raw、cards、跳出 learning 根、絕對網址、data 網址、含百分號、不是 NFC)還是被要求載入:單元測試 c 與渲染測試 e 必須紅(網路紀錄要 0 個請求)
  - 按例子裡的圖沒有蓋在卡片上放大、放大的圖比原本小或超出視窗、按任何地方或 Esc 關不掉、關的那一下按到底下的按鈕送出請求:渲染測試 d 必須紅
  - 圖片檔不存在時畫面沒有字樣寫出檔名、還留著破圖、或卡片其他部分(標題、內文、別的例子、按鈕)少了:渲染測試 e 必須紅
  - 佔位字樣把卡片裡的路徑當 HTML 塞進去(路徑裡的角括號、引號變成元素或屬性):單元測試 c 與渲染測試 e 必須紅
  - fence 插件或圖片路徑解析的變異分數低於 80:變異測試必須紅
  - 實作動到 touches 以外的檔(含 HUD 元件與 card-static 的測試支援、teach-session.ts 以外的 session 邏輯):不動的地方那條 diff 檢查必須有輸出
  - T43 到 T45 的教學卡測試、HUD 的 card-static 與 card-render、example-fence 既有測試、Wayland 提示的 T34 與 T35 測試任一變紅:不退步必須紅
---

# 工單 T46:教學卡的例子可以折疊、例子裡的圖片(07-teach-card phase-4 的前半)

> 狀態:顧問審過 2026-10-24(D0–D5 照建議;補 4 處:HUD 樣本卡也用 renderMarkdown、「原文路徑」的定義、折疊不重算整張、變異指令)。規格:UI/Tauri 負責人。編號 T46:協調者配。
> **07 phase-4 拆成兩張**(顧問 2026-10-24 裁 D0):這張做 `../../features/07-teach-card/phase-4.feature` 的場景 1–5(折疊、圖片);T47 做場景 6–8(縮放、長內容、視窗大小)。這張不改版面,T47 才改。
> 實作:worker(opencode + grok-4.7);紅測試(含渲染測試與 cucumber 步驟):測試 agent;驗收:驗收 agent;`@manual`:前端,技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 依據:`../../features/07-teach-card/phase-4.feature`;`../../features/07-teach-card/FEATURE.md`(phase-4 只要 phase-1 done);`../00-design.md` 第 3.2 節(圖片放 `assets/`、用相對路徑)與第 4.1 節(範例區塊可折疊);`../../contracts/types.md` 第 12、13 節(目錄、`LearningFs.assetUrl`、白名單);SKILL §4g 第 29 條(使用者看得到的狀態轉換要真渲染)。
> 基底:main `42c8384` 或之後。
> **LLM 真呼叫 0。** 渲染測試用單獨執行的暫存根 + 假網路;`@manual` 用暫存根 + 假網路。

## 為什麼有這張

例子不算字數,所以可以很長、可以有圖。現在教學卡把例子畫成一個框(`.lc-example`),但:

- 不能收起來。很長的例子會把按鈕擠到很下面。
- 例子裡的圖不會出現。卡片寫的是相對於卡片檔的路徑(例如卡片在 `cards/<分類>/`,圖寫成 `../../assets/<檔名>.png`),但畫面直接把這串交給瀏覽器,瀏覽器拿頁面的網址去解,解到錯的地方。桌面版要走 `lc` 協定(`../../apps/desktop/src-tauri/src/asset_protocol.rs`),網址要由 `LearningFs.assetUrl` 產生,現在沒有人呼叫它。
- 圖小的時候看不清楚,沒辦法放大。
- 圖不存在時只有一個破圖示,看不出缺了哪個檔。

## 要的結果(量結果,不綁做法)

畫面是 `App.svelte` 真的畫出來的樣子,視窗 360 × 480。

### 1. 例子可以折疊(場景 1)

- 每個例子區塊上面有一個標題列,按它就收起來,再按就展開。收起來時只剩標題,例子的內容(字、圖、清單)不佔位置、看不到。
- **一開始是展開的**(沒有記錄過的時候)。
- **折疊的狀態跨卡記住**(顧問裁 D2=A):**一個**狀態,等於使用者最後一次按的那一下;按的是收起或展開,下一張卡(按「下一個」、換類別、深入、回上一層、先備提示換過去的卡)的每個例子就從那個狀態開始。
  - 從第一幀就是那個狀態:不准先畫展開、下一幀才收起來(渲染測試用每一幀取樣量)。
  - 記在 `deps.storage`(同 `LAST_CATEGORY_KEY` 的做法),重開 app 之後也照舊。
- 標題列用鍵盤也能操作(Tab 走得到、Enter 或空白鍵收放)。

### 2. 好幾個例子各自折疊(場景 2)

- 每個例子區塊有自己的標題(顧問裁 D3:只有一個例子時寫「例子」,有好幾個時寫「例子 1」「例子 2」…;標題與內容之間不畫線)。
- 按其中一個的標題,只有那一個收放,其他的不變。
- 第 1 條的「跨卡記住」照最後一次按的那一下算(D2)。

### 3. 圖片路徑經桌面殼的邊界解析到 assets(場景 3,這條是自動驗收)

卡片裡每一張圖(`![替代文字](路徑)`;例子裡的、內文裡的都算)照下面的規則換成網址:

1. 路徑相對於**卡片檔所在的目錄**解析。卡片檔在 `cards/<分類>/<id>.md`(契約第 12 節),所以 `../../assets/a.png` 解析成 `assets/a.png`。
2. 解析後的 learning 相對路徑,**第一段必須是 `assets`**(最上層那一個,契約第 12 節),而且整串要過契約第 13 節的白名單(字元集合、NFC、不以點開頭或結尾、保留名、長度)。
3. 過了:網址是 `LearningFs.assetUrl(<解析後的路徑>)` 的回傳值,原樣放進 `src`。
   - 桌面版是 `../../apps/desktop/src/webview/learning-fs.ts` 的 `createLearningFs().assetUrl`(`lc://localhost/` 加逐段 `encodeURIComponent`);它丟 `PathRefusedError` 就當不過。
   - 瀏覽器單獨執行版是 dev server 給的網址(見第 6 條)。
4. **交給 `assetUrl` 的字串就是卡片原文裡寫的那段路徑解析出來的**,不多解碼也不少解碼(契約第 13 節「被檢查的字串必須和被使用的字串逐位元相同」)。
   - 「原文路徑」= markdown-it 解出來的**連結目的地**:markdown 自己的反斜線跳脫與 HTML 實體已經處理過、**normalizeLink 之前**的那串(顧問 2026-10-24)。
   - markdown-it 會把圖片網址的非 ASCII 字元編成 `%XX`(normalizeLink)。中文檔名 `../../assets/同源.png` 交給 `assetUrl` 的要是 `assets/同源.png`,不是 `assets/%E5%90%8C…`。
   - 卡片原文裡本來就寫了 `%` 的(例如 `a%20b.png`),不解碼,照第 2 條拒絕(`%` 不在字元集合)。
5. 不過:**不載入**(畫面上沒有 `img` 去要那個網址,網路紀錄 0 個請求),改顯示佔位字樣(第 5 條)。下面這些都算不過:
   - 解析後在 `raw/`、`cards/`、`questions/` 等 `assets` 以外的地方;
   - 解析後跳出 learning 根(`../../../x.png`);
   - 絕對網址(`http:`、`https:`、`lc:`、`//host`)與 `data:image/…` 網址(顧問裁 D4:拒絕);
   - 含 `?`、`#`、`%`、反斜線,或不是 NFC。
   - markdown-it 的 validateLink 本來就擋掉 `file:`、`javascript:`、`vbscript:` 與不是圖片的 `data:`:那些根本不會變成圖片 token,畫面上是原文字。這種只要「沒有 `img`、0 個請求」就算過,**不要求**出「圖片路徑不能用」字樣。
6. 瀏覽器單獨執行版(`npm run dev -w apps/teach-card`,渲染測試也用它):`apps/teach-card/dev/` 的 dev server 多一條路由服務暫存根裡的圖片(例如 `/__asset?path=<路徑>`),跟 `/__card` 一樣只讀暫存根、擋 `..`;回傳位元組(不是文字),`Content-Type` 照副檔名,不存在回 404。`main.ts` 的瀏覽器版 `fs` 多一個 `assetUrl` 回這條路由的網址。
   - 暫存根裡要有一張可以用的圖(單獨執行時看得到、渲染測試用得到)。做法 worker 定(例如 dev server 起暫存根時寫一張很小的 PNG 到 `assets/`);不改 `contracts/fixtures/`。
7. 這條是 `phase-4.feature` 裡唯一不是 `@manual` 的場景,要有 cucumber 步驟(測試 agent 寫)。

### 4. 圖片可以放大(場景 4)

- 按例子裡的圖,那張圖蓋在卡片上面放大顯示。
  - 放大的圖等比例,放到視窗裝得下的最大(不超出視窗、不裁切),而且比在卡片裡顯示的大(原本就已經佔滿寬度的除外,那時至少一樣大)。
  - 蓋住整個視窗(含標題列);底下的按鈕按不到。
- **按任何地方**(圖上、圖外)或**按 Esc** 就關掉,回到原本的卡片,捲動位置不變。
  - 關的那一下不能穿過去按到底下的按鈕:那段時間 `/__review` 0 個請求、卡片沒換。
- 放大時不載入第二份圖(用同一個網址,不另外要檔)。
- 佔位字樣(第 5 條)不能放大。
- 鍵盤放大不做(顧問裁 D5);Esc 關閉要做。

### 5. 圖片不存在時不弄壞卡片(場景 5)

- 圖片載入失敗(dev server 或 `lc` 協定回 404)時,那張圖的位置換成一行字樣,**寫出缺的那個檔**:「找不到圖片:<解析後的路徑>」(例如「找不到圖片:assets/a.png」)。
- 第 3 條第 5 點拒絕的路徑(markdown-it 當成圖片的那些),同樣位置換成「圖片路徑不能用:<卡片原文裡寫的路徑>」,不發請求。
- 兩種字樣:
  - 不留破圖示、不留空的 `img`;替代文字(如果有)可以一起寫在字樣後面;
  - 樣式跟例子裡的字一樣或小一號,顏色只用 `var(--hud-*)`,不畫框(card-static);
  - 路徑當**文字**放(跳脫 `<`、`>`、`&`、`"`),不當 HTML。
- 卡片其他部分照常:標題、內文、別的例子、別的圖、按鈕都在,按鈕可以按。

### 6. 不變的

- 例子框的樣子照舊:`.lc-example` 的 class、背景、左邊 1px `var(--hud-line)` 線、內距與外距(HUD 的 card-render 測試量它)。標題列在框裡面。
- **`renderMarkdown` 不只教學卡用**:`../../packages/ui-shared/src/hud/card-static-samples-test-support.ts` 第 47 行也用它畫 HUD 的樣本卡;`../../packages/ui-shared/src/hud/card-render-test-support.ts` 第 137、472 行量 `.lc-example` 的邊距與左邊的線。fence 插件改輸出 `<details>`,HUD 的樣本會一起變(見「要改的既有測試」)。
- 版面不動:這張不改按鈕列、系統狀態字樣的位置(T45)、`.hud-body` 的捲動與 `padding-bottom`(T35)。**T45 的 0 px 不准退步**(T45 的渲染測試照樣綠)。
- 內文與例子的順序照卡片原文(這張不把例子搬到別的地方;那是 T47 的事)。
- 「下一個」的 `onclick={handleNext}`、`disabled={finished}`;`<div class="controls">`;最外層一個 HudPanel。
- 側車、協定、Rust、core、`packages/ui-shared/src/hud/` 都不動。

## card-static 的禁止清單(起草前掃過,`../../packages/ui-shared/src/hud/card-static-test-support.ts` 與 `../../packages/ui-shared/src/hud/test-support.ts`)

折疊與放大最容易碰到的幾條,實作照下面做就**不需要新的例外**:

| 規則 | 會碰到的地方 | 這張的做法 |
|---|---|---|
| `<style>` 不准寫 `border*`、`outline`、`box-shadow`、`clip-path`、`mask`(連 `outline: none` 也算;只看屬性名) | 標題列的焦點框、放大層的邊、裁圖 | 標題列不寫 `outline`(用瀏覽器預設的焦點框);放大層不畫邊、不加陰影;圖不用 `clip-path` 裁 |
| `.lc-example` 只准 `border-left` | 例子框 | 照舊只有 `border-left`;標題列與內容不另畫線(要分隔線就要新例外,見 D3) |
| 顏色只准 `var(--hud-*)`,沒有顏色字面值,背景不准漸層 | 放大層的底色、佔位字樣 | 放大層的底用 `var(--hud-solid)` 或 `var(--hud-panel)`;要半透明就用 `opacity` 加這兩個之一,不寫 `rgba(…)` |
| `<style>` 只准用 `--hud-` 開頭的變數 | 縮放(T47)、放大層 | 不新增自己的 CSS 變數 |
| 標記不准有 `style=` 屬性;不准插 `<style>`、`setAttribute('style')`、`.style.cssText =`;外部網址 | 放大的圖、佔位字樣 | 要動態樣式用 Svelte 的 `style:屬性` 指令(CSSOM,CSP 放行) |
| 按鈕都要是 `HudButton`,`App.svelte` 標記裡不准原生 `<button>` | 標題列、放大層的關閉 | 標題列用 fence 插件產生的 `<details>` / `<summary>`(顧問裁 D1=A;在 `{@html}` 裡,不是 `App.svelte` 的標記;`summary` 不是按鈕元素,鍵盤操作是瀏覽器內建的);放大層不放關閉鈕(按任何地方就關) |
| 教學卡只准 import `@learning/ui-shared` 與 `@learning/ui-shared/hud/…` | 圖片路徑解析 | 解析函式放 `packages/ui-shared/src/`(新檔 image-path.ts),從 `@learning/ui-shared` 的 index 匯出 |
| 不准 Svelte 的 `transition:` / `in:` / `out:` / `animate:` 指令 | 收放、放大 | 不做動畫(要的話只能用 CSS,而且要被 `prefers-reduced-motion` 關掉) |

## 做法(建議;量的結果才是驗收)

- **折疊**:fence 插件(`../../packages/ui-shared/src/example-fence.ts`)把例子輸出成 `<details class="lc-example" open><summary>例子 N</summary>…</details>`(D1=A)。`App.svelte` 在 `{@html}` 的容器上聽 `toggle`(capture),記下最後一次的狀態;新卡渲染時依記錄決定 `open`,在插件輸出的字串裡就決定(插件收一個選項),不在掛上去之後才改(避免第一幀先展開)。
  - **折疊狀態只在換卡時讀。** 同一張卡上,不准因為按了一個標題就重算整張 html(例如讓 `shown` 的 `$derived` 依賴折疊狀態):整張重畫,另外兩個例子會被一起收掉或展開。渲染測試 b 會抓到;寫在這裡是為了別踩。
- **圖片**:新檔 image-path.ts 放一個純函式,輸入「卡片檔的目錄、markdown 原文裡的路徑」,輸出「解析後的路徑」或「拒絕的原因」。fence 插件與內文共用 markdown-it 的 image 規則:拿 token 的**原文**路徑(不是 normalizeLink 之後的),過了交給呼叫端給的 `assetUrl`,不過就輸出佔位字樣(跳脫過)。`renderMarkdown` 多一個選項帶 `assetUrl` 與卡片目錄;不帶選項時行為不變(既有呼叫與測試照舊)。
- **找不到**:`App.svelte` 在容器上用 capture 聽 `error`(`img` 的 error 不冒泡),把那張圖換成「找不到圖片」字樣。
- **放大**:`App.svelte` 聽容器上的 click,目標是例子裡的 `img` 就開一層 `position: fixed` 蓋滿視窗的放大層,用同一個 `src`;放大層上任何 click 關掉並 `stopPropagation`;Esc 在 window 的 keydown 關掉。
- **桌面殼的邊界**:`TeachSessionDeps['fs']` 從 `Pick<LearningFs, 'read'>` 改成 `Pick<LearningFs, 'read' | 'assetUrl'>`;Tauri 版直接用 `createLearningFs()`(已經有 `assetUrl`),瀏覽器版在 `main.ts` 加。`teach-session.ts` 只改這個型別,不改邏輯。

## 驗收條件

### 1. 自動驗收(vitest 與 cucumber,測試 agent 寫)

| 層 | 指令 | 過的條件 |
|---|---|---|
| 教學卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/` | 全綠,含新的渲染測試與 dev server 測試、T43–T45 既有的測試、T40 的靜態測試 |
| ui-shared | `VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/` | 全綠,含新的圖片路徑單元測試、HUD 的 card-static、card-render、Wayland 提示 T34 / T35 |
| 場景 3 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and @phase-4 and not @manual' --format summary` | 1 個場景全綠(拿位子) |
| 不退步 | 同上,`--tags '@teach-card and @phase-1'`、`'@teach-card and @phase-2 and not @manual'`、`'@teach-card and @phase-3 and not @manual'` | 全綠(拿位子) |
| 變異 | `npm run mutate -- <設定檔>`;設定檔由驗收 agent 新增在 repo 根(同 `../../stryker.t44-session.json` 的做法),`mutate` 範圍是 `packages/ui-shared/src/example-fence.ts` 與新檔 image-path.ts | 兩個檔各 ≥ 80(FEATURE.md 的技術棧表:fence 插件是標準 80%;圖片路徑解析是同一類共用邏輯,而且決定要不要發請求) |
| 不動的地方 | `git diff --stat 42c8384..HEAD -- packages/core packages/ui-shared/src/hud contracts apps/desktop scripts features/07-teach-card` | 沒有輸出(`features/steps` 是測試 agent 的,不在這裡) |

**單元測試 c**(新檔,放 `packages/ui-shared/src/`):圖片路徑解析的向量,至少:

| 卡片目錄 | 原文路徑 | 結果 |
|---|---|---|
| `cards/demo` | `../../assets/a.png` | `assets/a.png` |
| `cards/demo` | `../../assets/sub/b.png` | `assets/sub/b.png` |
| `cards/demo` | `../../assets/同源.png` | `assets/同源.png`(不是 `%E5…`) |
| `cards/demo` | `../../raw/demo/x.png` | 拒絕 |
| `cards/demo` | `../x.png`、`assets/a.png`(在卡片目錄底下) | 拒絕(不在最上層 `assets`) |
| `cards/demo` | `../../../x.png` | 拒絕(跳出根) |
| `cards/demo` | `https://a.test/x.png`、`//a.test/x.png`、`lc://localhost/assets/a.png`、`data:image/png;base64,AAAA` | 拒絕(佔位字樣) |
| `cards/demo` | `file:///x.png`、`javascript:x`、`data:text/plain,x` | markdown-it 的 validateLink 擋掉,不是圖片 token:輸出沒有 `<img`、`assetUrl` 0 次;不要求佔位字樣 |
| `cards/demo` | `../../assets/a%20b.png`、`../../assets/a.png?x`、`../../assets/a.png#y`、`..\..\assets\a.png` | 拒絕(不解碼) |
| `cards/demo` | `../../assets/a\_b.png`(markdown 的反斜線跳脫) | `assets/a_b.png`(跳脫由 markdown-it 處理過,才是原文路徑) |
| `cards/demo` | `../../assets/é.png`(U+0065 U+0301,不是 NFC) | 拒絕 |
| `cards/demo` | `../../assets/./a.png`、`../../assets//a.png` | 拒絕或解析成 `assets/a.png`,二選一寫死(測試 agent 定,寫進 commit 說明;交給 `assetUrl` 的字串不能含 `.` 段或空段) |

另外:`renderMarkdown` 帶選項時,`src` 是假 `assetUrl` 的回傳值、假 `assetUrl` 收到的字串逐字等於上表的結果;拒絕的那幾個,假 `assetUrl` 0 次呼叫、輸出裡沒有 `<img`;路徑含 `"><img src=x onerror=…>`、`<b>`、`&` 時輸出裡沒有多出元素或屬性。不帶選項時,既有 example-fence 測試的輸出照舊。

**渲染測試**(新檔,放 `apps/teach-card/src/`,例如 t46-examples-images-render.test.ts):

- 真的把 `App.svelte` 畫出來,做法同 `../../apps/teach-card/src/t45-status-layout-render.test.ts`:`../../packages/ui-shared/src/hud/render-test-support.ts` 的 `openApp(<apps/teach-card 的目錄>, { viewport: 360 × 480, initScript })`。`initScript` 改 `/__card` 的回應,讓卡片有一個、三個例子,例子裡有存在的圖、不存在的圖、會被拒絕的路徑;記錄 `/__review` 與 `/__asset` 每一個請求。
- **不准**用讀原始碼比字串代替渲染(SKILL §4g 第 29 條);不新增 npm 依賴;不改 `packages/ui-shared/src/hud/` 的測試支援。
- **要被真渲染看到的畫面狀態**(每一條都在 `42c8384` 上紅,紅的原因是「還沒有這個功能」):
  - **a. 折疊**:例子展開(內容看得到、高度 > 標題列)→ 按標題 → 收起(內容 `offsetParent` 為 null 或高度 0、只剩標題)→ 按「下一個」→ 新卡的例子從第一幀就是收起的(頁面裡每一幀取樣,沒有一幀是展開的)→ 展開一個 → 下一張是展開的 → 重新載入頁面(同一份 storage)還是展開的。
  - **b. 三個例子**:三個標題,字是「例子 1」「例子 2」「例子 3」(D3);按第 2 個只有第 2 個收起;鍵盤 Tab 到第 1 個、按 Enter 收起。
  - **d. 放大**:按例子裡存在的那張圖 → 放大層出現,裡面的圖 `src` 跟原本的相同、矩形比原本的大且在視窗裡、`elementFromPoint` 在原本按鈕的位置打到的是放大層 → 在原本「下一個」的位置按一下 → 放大層關掉、`/__review` 0 個請求、標題沒換、`.hud-body` 的 `scrollTop` 跟打開前相同 → 再打開 → 按 Esc 關掉 → 放大期間 `/__asset` 對那張圖沒有第二個請求。
  - **e. 找不到與拒絕**:不存在的那張 → 畫面上有「找不到圖片:assets/<檔名>」、那個位置沒有 `img`;會被拒絕的那幾張(要用 markdown-it 會當成圖片的路徑:`../../raw/…`、`https:…`、`data:image/png…`)→ 「圖片路徑不能用:<原文>」、`/__asset` 與外部網址 0 個請求;路徑含角括號與引號的那張 → 字樣裡看得到原字、DOM 裡沒有多出元素;同一張卡的標題、內文、別的例子、存在的那張圖、按鈕都在,「下一個」按得下去。
- 場景 3 的 cucumber 步驟(新檔,放 `features/steps/`):用桌面殼真的 `createLearningFs({ os: 'linux', invoke: <假的> }).assetUrl` 渲染一張例子裡有相對路徑圖的卡,斷言 `src` 是 `lc://localhost/assets/<檔名>`、`assetUrl` 收到 `assets/<檔名>`、假的 `invoke` 0 次呼叫(`assetUrl` 是同步的,不經 command)。

### 2. 改壞證明(驗收 agent 的丟棄式證明)

`must_catch` 每一條各做一次:改了哪裡、哪一條紅、紅的訊息原文、還原後綠。至少要有:

- 預設改成收起 → a 紅;折疊狀態不寫進 storage → a 的「下一張」紅;掛上去之後才收起 → a 的「第一幀」紅;
- 三個例子共用一個狀態 → b 紅;
- 交給 `assetUrl` 的改成 normalizeLink 之後的字串 → c 的中文檔名紅;多做一次 `decodeURIComponent` → c 的 `%20` 紅;拿掉「第一段是 assets」→ c 的 `raw`、`cards` 紅、e 的拒絕紅;
- 佔位字樣不跳脫 → c 與 e 的角括號紅;
- 放大層的 click 不 `stopPropagation`(或放大層沒蓋住按鈕)→ d 的「0 個請求」紅;拿掉 Esc → d 紅;
- 拿掉 error 的處理 → e 的「找不到」紅。

### 3. 觀感(`@manual`,前端做、技術顧問判)

做法同 T45 `@manual`:暫存根 + 假網路、Xvfb `:97` + 巢狀 GNOME Shell、`PATH` 放 ibus-daemon 替身、MemoryMax=2G,不碰使用者的桌面 `:1`;使用者的動作用 XTest 真的指標,只送 `:97`;LLM 真呼叫 0;真的 learning/ 前後相同。暫存根的 `assets/` 放幾張圖(寬圖、高圖、很小的圖),卡片的例子引用它們、一張不存在的、一張會被拒絕的。

| 列 | 過的條件 |
|---|---|
| M1 折疊 | 真指標按標題收起、再按展開;收起後按「下一個」,新卡的例子是收起的;重開 app 還是收起的 |
| M2 三個例子 | 三個標題,各自收放 |
| M3 圖片經 `lc` | 真的 app 裡例子的圖看得到;`img.src` 是 `lc://localhost/assets/…`;CSP 沒有擋(console 0 則);Rust log 沒有拒絕;中文檔名的圖也看得到 |
| M4 放大 | 按圖放大蓋住整個視窗;按圖外、圖上、Esc 都關得掉;關的那一下沒有按到底下的按鈕 |
| M5 找不到 | 不存在的圖換成「找不到圖片:…」;會被拒絕的換成「圖片路徑不能用:…」,`lc` 協定沒有收到它的請求、帳本沒有 warning;卡片其他部分照常 |
| M6 樣子 | 截圖給顧問判:展開、收起、三個例子、放大(寬圖、高圖、小圖)、兩種佔位字樣;T45 的 0 px 在有例子的卡上照舊(按深入出字樣,按鈕不動) |

另外看:console 0 則;放大時按「下一個」的位置不會換卡。

## 要改的既有測試(測試 agent 改,開發 worker 不改)

- `../../packages/ui-shared/src/example-fence.test.ts`:如果 D1 選 `<details>`,斷言 `class="lc-example"` 的那幾條照樣成立;有寫死 `<div class=` 的才改。不准放鬆「不是 code block」「巢狀 markdown 照常渲染」那幾條。
- `TeachSessionDeps['fs']` 加了 `assetUrl` 之後,既有測試裡的假 `fs` 要補一個(型別才過)。只補欄位,不改斷言。
- **HUD 的樣本卡**(顧問 2026-10-24):fence 插件改輸出 `<details>` 會一起改到 HUD 的樣本(見「不變的」)。測試 agent 寫紅測試之前,先用丟棄式的 `<details>` 版本跑一次 HUD 的 card-render 與 card-static,確認真的不用改,結果寫進紅測試的 commit 說明。**不准**為了它改 `packages/ui-shared/src/hud/` 的測試支援;真的紅了就停下來回報協調者與顧問。
- 要注意的一條:例子多了一行標題,卡片會變高一點。T45 渲染測試的「短卡」如果因此放不下(要捲),那是前提變了,不是 T45 退步:測試 agent 換一張放得下的短卡(或在 `initScript` 裡縮短內容),不放鬆 0 px 的斷言,在 commit 說明裡講。

## 受保護的檔(開發 worker 不改)

- 測試:`*.test.ts`、`*-test-support.ts`、`features/**`、`.feature`。worker 覺得測試有錯,寫進報告的「待協調」,不改。
- 實作:`packages/core/`、`packages/ui-shared/src/hud/`、`contracts/`(含 `contracts/fixtures/`)、`apps/desktop/`(含 Rust 與 `learning-fs.ts`)、`scripts/`、`apps/teach-card/src/teach-session.ts` 除了 `fs` 的型別那一行。

## 落點

- `packages/ui-shared/src/`(hud 以外)與 `apps/teach-card/` → 07-teach-card(`../../scripts/boundaries.owners.json`;ui-shared 的根歸 07,ADR-035)。
- 教學卡已經 import 桌面殼的 `learning-fs.ts`(`main.ts`),不新增 import 例外。

## 顧問的裁決(2026-10-24)

- **D0 拆兩張:同意。** 這張是場景 1–5,不改版面;T47 是場景 6–8。
- **D1=A**:fence 插件輸出 `<details>` / `<summary>`。鍵盤、螢幕報讀是瀏覽器內建的,`App.svelte` 不多原生按鈕,card-static 不用例外。
- **D2=A**:「跨卡記住」記**一個**狀態,等於使用者最後一次按的那一下(收起或展開);下一張卡的每個例子都從它開始。
- **D3**:一個例子寫「例子」,好幾個寫「例子 1」「例子 2」…;標題列與內容之間不畫線。
- **D4**:`data:` 網址拒絕。
- **D5**:這張不做鍵盤放大;Esc 關閉要做。
- **路徑規則同意**:第一段是 `assets`、不解碼、過契約第 13 節的白名單。這比契約第 13 節窄,是 UI 自己收緊,不動契約。
- 補四處:HUD 樣本卡也用 `renderMarkdown`(「不變的」「要改的既有測試」);「原文路徑」的定義與 validateLink(第 3 條);折疊狀態只在換卡時讀(做法);變異的指令形式(驗收條件 1)。

## 不在範圍

- 縮放、長內容的版面、視窗大小(T47)。
- 放大後再拖曳、再縮放圖;圖片的說明文字排版。
- 考試卡的例子與圖片(考試卡不 import `@learning/ui-shared` 的根,ADR-035)。
- `cards/<分類>/assets/` 這種卡片自己的圖片目錄(契約第 12 節只有最上層 `assets/`)。

## 預算

`budget_usd: 5`(三個共用檔、`App.svelte`、dev server;grok 不設停止線,只記錄)。沒有 LLM 花費。

`cpu: light`:實作沒有 Rust。渲染測試會起 vite dev server、headless Chrome 與側車;cucumber 與變異測試是重活,協調者照重活排位子。

## 測試誰寫

- 紅測試(單元 c、渲染 a / b / d / e、場景 3 的 cucumber 步驟)、要改的既有測試:測試 agent。改壞證明:驗收 agent。開發 worker 以紅測試分支為基底,不改測試。
- 實作:worker(opencode + grok-4.7)。
- `@manual`:前端,技術顧問判。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 重活(vitest 完整、cucumber、渲染測試、變異)先跟協調者拿位子:`VITEST_MAX_WORKERS=1`,cucumber 一律 `--tags`。
