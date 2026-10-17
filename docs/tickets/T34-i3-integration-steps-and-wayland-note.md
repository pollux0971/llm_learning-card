---
id: T34
deps: []
touches: [apps/desktop/src-tauri/src/main.rs, apps/desktop/src-tauri/src/window_mode.rs, apps/desktop/src-tauri/src/window_mode.js, apps/desktop/src-tauri/src/wayland_note.js]
cpu: heavy
budget_usd: 3
status: todo
owner: worker-grok
must_catch:
  - 側車在 submit 回應之後才寫 reviews.json(例如改成 summary 或結束時才寫):整合層「Answers are written immediately」必須紅(要在 submit 回應之後把側車行程 SIGKILL,磁碟上照樣有那一題)
  - 側車給的題目順序跟終端機 `review.ts --dry-run` 不一樣(例如 queue 反過來、或側車自己重排):整合層「The window and the terminal produce the same session」必須紅
  - 視窗答過的題,終端機還會再問(例如側車不寫當日快取、或寫到別的 vault_id):整合層「The window and the terminal see the same state」必須紅
  - lc-fs 的 read 收下含 `..` 的路徑或目錄外的路徑(路徑防護改鬆):整合層「File access goes through the Tauri boundary」必須紅
  - 終端機的一輪複習壞掉(例如 review.ts 送出後不前進):整合層的回歸那條必須紅
  - Wayland 底下兩個卡片視窗沒有一次性提示(函式沒有進真前端、或在頁面載入前就叫):Wayland 提示的測試必須紅
  - X11 底下也出現提示:X11 不顯示提示的測試必須紅
  - 按了「知道了」之後再啟動還會出現:提示只出現到按掉為止的測試必須紅
  - Wayland 底下還是呼叫 set_always_on_top:Wayland 不設置頂的測試必須紅
  - 提示蓋住「送出」或其他按鈕(正中心點不到):提示出現時按鈕看得到的測試必須紅
  - 提示用 style 屬性或 innerHTML 塞樣式(CSP 擋掉、console 有錯),或顏色不是 var(--hud-*):提示樣式的檢查必須紅
  - 06、07、10、14 任一個既有場景或測試變紅,或任何 .feature 被改(顧問同意的 C 除外):不退步必須紅
---

# 工單 T34:i3 驗收檔的整合層步驟定義,與 Wayland 一次性提示接到真前端

> 狀態:顧問審過 2026-10-18(三點照建議:A 用真的側車子行程、背景只要求 lc-fs 編好、C 改場景字樣;驗收 A 加兩句:日期釘住、SIGKILL 的改壞證明要穩)。
> 作者:UI/Tauri 負責人(10-desktop-shell、06-test-card 的規格作者)。編號:T34(協調者配)。派工:協調者。
> 實作:A 由 -e5 寫(只有測試);B 由 worker-grok(opencode grok-4.7)實作、-e5 寫紅測試。驗收:-ed。觀感:前端(驗收 B4),技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 起因:I3 盤點(`../reviews/I3-inventory.md`,顧問 2026-10-18 派)。決策:ADR-073(I3 不打 tag、gate 怎麼算)、ADR-075(複習跑在側車)。
> 基底:main(I3 盤點合併之後)。

## 為什麼有這張

I3 盤點的兩個缺口:

- **A. i3 的驗收檔一條都沒跑過。** `../integration/i3-desktop-review.feature` 的五條自動場景與背景「Given the desktop application is built for Linux」**沒有步驟定義**:
  `cucumber-js --tags '@i3 and not @manual'` 是 185 passed、5 undefined。
  每一條要的行為,phase 層都有一對一的場景守著,而且真跑全綠(盤點第 1 節)。但 phase 層的「視窗」是程序內的 handler,「被殺掉」是丟掉參照。
  整合點自己的驗收應該接上真的零件:Rust 起的那支側車行程、lc-fs 的 read、真的 `review.ts`。
- **B. Wayland 的一次性提示在真前端不見了。**
  - `window.__lcShowWaylandNote` 只寫在 placeholder 頁面用的 `../../apps/desktop/src-tauri/placeholder/wayland-note.js`。10 phase-2 換成真前端之後,兩張卡的頁面都沒有載入它(建出來的 `apps/desktop/dist/` 裡 0 處)。
  - Rust 在 `builder.build()` 之後馬上 `eval`(`../../apps/desktop/src-tauri/src/main.rs:166`、`:33`),沒等頁面載入完。
  - 盤點時在無頭 GNOME Shell(Wayland,沒有 Xwayland)裡開 app:兩頁的 `typeof window.__lcShowWaylandNote` 都是 `"undefined"`,沒有提示。
  - 沒有任何自動測試碰過這個提示:10 phase-1 的那條是 `@manual`,寫在 placeholder 的年代。

## 驗收條件

### A. 整合層的步驟定義(只有測試,-e5 寫;產品程式不改)

新的步驟檔,例如 `features/steps/i3-desktop-review.steps.ts`。照 `features/steps/_world.ts` 的結構寫。

| 場景(行) | 要接上的真零件 | 過的條件 |
|---|---|---|
| 背景:the desktop application is built for Linux | `process.platform` 是 `linux`;lc-fs 從這個簽出編好(共用 `apps/desktop/src/test-support/build-lc-fs.ts`,不另寫一份) | 不是 Linux 或編不起來 → 紅,不跳過 |
| The window and the terminal produce the same session(20) | 考試卡的 `TestSession`,`ReviewClient` 的 handler 接**真的側車子行程**(`features/support/review-sidecar-harness.ts` 的 `spawnSidecar`,跟 Rust 起的同一支 `scripts/review-sidecar.ts`);終端機是真的 `scripts/review.ts --dry-run` | 視窗依序問的卡,跟終端機列的內容與順序一樣 |
| File access goes through the Tauri boundary(25) | webview 的 `createLearningFs()`,`invoke` 轉到 lc-fs probe(跟 Tauri command 同一份 `learning_fs`) | 讀卡片走 `read` 這個 command、路徑是相對 learning 目錄的;含 `..` 的、目錄外的(絕對路徑、指出去的符號連結)都被拒絕,拒絕回到 TypeScript 這邊 |
| Answers are written immediately(31) | 同第 20 行的側車子行程 | 答一題、拿到 submit 的回應之後,**對側車行程送 SIGKILL**(不叫 summary、不關 stdin);`state/reviews.json` 裡那張卡今天有一筆 |
| The window and the terminal see the same state(36) | 同上 + 真的 `review.ts --dry-run` | 視窗答兩題之後,終端機只列剩下的三張,順序不變 |
| The terminal review loop still works as in I2(61,`@regression`) | 「When the person runs the review command」沿用 `../../features/steps/i2-review-loop.steps.ts:575` | 「a full session can be completed as in I2」:用 i2 headless 同一套跑完一整輪(全部答完、exit 0、小結有通過數);不另寫一份 CLI 驅動 |

- 背景的另兩條(「a learning directory populated by the I1 pipeline」「5 cards are due today」)已經有定義(`../../features/steps/common.steps.ts:27`、`../../features/steps/scheduler.steps.ts:550`)。新步驟要用它們佈置好的那個 learning 目錄,不另起一個。
- 全部用暫存根(learning、`XDG_*`、`HOME` 同一個 mkdtemp)、假 router(`LC_REVIEW_FAKE_CLOUD`),**不碰真的 learning/,不准 live**。
- **日期釘住**(顧問 2026-10-18):「同一個 session」「同一個狀態」兩條要比側車和 `review.ts --dry-run` 的輸出,兩邊用同一個日期:側車的 `LC_REVIEW_TODAY` 與 `review.ts` 的 `--today` 是同一個值。不然跨午夜跑會假紅。
- **SIGKILL 那條的改壞證明要穩**(顧問 2026-10-18):must_catch 第一條「改成回應之後才寫」是在搶時間,回應送出後寫檔只要幾毫秒,SIGKILL 不一定搶得贏。
  -e5 的丟棄式證明要「改壞的版本連跑 10 次都紅」。做不到 10 / 10,就換一種保證會紅的改壞法(例如改成 summary 時才寫),並在 commit 說明寫清楚這條守的是哪一種退步。
- 完成的樣子:`cucumber-js --tags '@i3 and not @manual'` 0 undefined、全綠。

### B. Wayland 一次性提示接到真前端(worker 實作)

1. **Wayland 底下兩個卡片視窗都顯示提示。** 判斷用現有的 `session::detect_from_env()`(10 phase-1 的偵測規則不改)。
   - 字樣照 placeholder 的:「Wayland 底下無法強制視窗置頂,請在桌面環境設定「永遠在最上層」。」,一顆「知道了」。
   - 頁面載入完才出現,不能靠 `build()` 之後馬上 `eval`。
2. **只出現到按掉為止。** 任一個視窗按「知道了」之後,之後每次啟動兩個視窗都不再出現。存在頁面的 `localStorage`,鍵名照舊 `lc-wayland-note-dismissed`。兩張卡同一個來源,所以按一次就夠。
3. **X11 底下不出現**,而且照舊置頂(`set_always_on_top` 與拿到焦點時重新置頂,`../../apps/desktop/src-tauri/src/main.rs:21`)。**Wayland 底下不呼叫 `set_always_on_top`**(照舊)。
4. **觀感(`@manual`,前端做、技術顧問判)**:做法同 I3 盤點第 4 節。
   - Wayland:無頭 `gnome-shell --headless --wayland --no-x11`,`dbus-run-session`,暫存 `HOME` / `XDG_*` / `XDG_RUNTIME_DIR`。第一次開,兩個視窗都有提示(截圖)。提示在的時候,「送出」照 T15 的量法不捲動可見、正中心點得到。按考試卡的「知道了」,關掉再開,兩個視窗都沒有提示。
   - X11:Xvfb `:97` + 巢狀 `gnome-shell --x11`,沒有提示,`_NET_WM_STATE_ABOVE` 照舊。
   - 都不碰使用者的桌面 `:1`。console 0 則。
5. **樣式**:
   - 頁面的 CSP 是 `default-src 'self'; script-src 'self'`,沒有 `unsafe-inline`(`../../apps/desktop/src-tauri/tauri.conf.json`)。所以不用 `style` 屬性,不用 `innerHTML` 塞樣式;要設樣式用 CSSOM 或 HUD 現成的掛鉤(例如按鈕用 `data-hud="button"`)。
   - 顏色只用 `var(--hud-*)`。不改 `hud.css`、HUD 元件、兩張卡的 `App.svelte`。

### C. `@e2e @manual` 的字樣(顧問 2026-10-18 同意改字樣)

- 場景「A person completes a review session in the window」寫「Then the header shows "Today 0 / 5"」。現在的 header 是「0 / 5」「逾期 0」兩段,是 T15、T23、T32 定的;`../00-design.md` §5.5 是「今日 3 / 10 題,逾期 0」。
- 這條在 I4 做的時候,照字面就對不上。
- **改場景的字樣去對齊畫面,不改畫面。** 理由:T15 的渲染測試讀 header 的第一個數字,前面加字會改到它。
- 規格作者(前端)在派工前改了 `docs/integration/i3-desktop-review.feature` 那一行(同一條分支另一個 commit),改成「Then the header shows zero of five and that none are overdue」。
  畫面上就是「0 / 5」「逾期 0」兩段。照 CLAUDE.md「Gherkin 全英文」與 06 的寫法(「the header shows zero of three」「the header shows the progress and that two are overdue」),步驟字不放中文字樣。
- 這一條是 `@manual`,沒有步驟定義,I4 那一輪照它看畫面。

### D. 不退步

- 06、07、10、14 的既有場景與測試全綠;cucumber `@i3 and not @manual`、`@i2 and not @manual`、`@desktop-shell and not @manual`(拿位子)全綠。
- `cargo test`(`apps/desktop/src-tauri`)全綠。
- 任何 `.feature` 都不改(C 除外,由規格作者改)。

## 做法建議(不綁做法,量的結果才是驗收)

- B:`window_mode::init_script` 已經在每一頁的頁面腳本之前注入(`window.__LC_WINDOW_MODE__` 加 `window_mode.js`)。
  在它的 JSON 多帶一欄 session(例如 `wayland: true`),Wayland 時再 `include_str!` 一段提示的程式(例如 `src/wayland_note.js`),等 `DOMContentLoaded` 或頁面掛好再顯示。
  這樣 `main.rs` 的那行 `eval` 就可以拿掉,也不用動兩張卡。
- 判斷「要不要顯示」與「要不要置頂」寫成純函式,Rust 測試放 `tests/`,不寫在實作檔的 `mod tests`。
- placeholder 的 `wayland-note.js` 這張不動(它現在沒人載入;要不要刪另議)。

## 顧問的裁決(2026-10-18)

1. **A 用真的側車子行程**(不用 06 phase-2 那套程序內的 handler)。理由:
   - 整合點要驗的就是零件接起來的樣子;
   - 「被殺掉」只有真行程能做 SIGKILL;
   - harness 已經有了(T22 的 `spawnSidecar`)。
   代價是每條多起一個 node 行程,約幾百毫秒。Rust 那一段「起、傳、收、關」由 T22 的 cargo 測試守,這張不重複。
2. **背景「built for Linux」= Linux + lc-fs 編好,不跑完整的 `tauri build`。** 理由:完整建置要十幾秒到幾分鐘、而且是重活;視窗那一側要用的 Rust 是 lc-fs 共用的 `learning_fs`。
3. **C 改字樣**(見上)。
4. B 的做法建議同意。localStorage 跨視窗、跨重啟在 WebKitGTK 有沒有留下,Chrome 測不到,所以 B4 的 `@manual`「按掉 → 關掉再開,兩頁都沒有」保留,那就是證明。

## 規格

A 不加、不改 `.feature`:步驟的字照 `i3-desktop-review.feature` 原文。
B 的行為以 10 phase-1「Wayland is detected and explained」與 i3「Wayland is detected and explained rather than hacked」(兩條都是 `@manual`)為準,細節以本檔驗收條件為準。

## 紅測試(-e5 寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| A | 五條整合場景 + 背景 | cucumber 步驟定義(見 A 的表) | 綠(行為本來就在;這幾條是整合驗收,不是紅測試。交件前用 must_catch 前五條的改壞證明它們會紅;SIGKILL 那條見驗收 A 的「改壞證明要穩」) |
| B1 | Wayland 兩頁都有提示 | Rust:`init_script` 在 Wayland 帶提示、X11 不帶;真 Chrome(`openCard`)載入注入了提示程式的頁面 → 出現、字樣對、按鈕在 | 紅 |
| B2 | 按掉之後不再出現 | 真 Chrome:按「知道了」→ 重新載入 → 沒有;`localStorage` 鍵 | 紅 |
| B3 | X11 不出現、Wayland 不置頂 | Rust 純函式(session → 要做的動作) | 紅(前半)/ 本來就綠(後半) |
| B5 | 樣式 | 靜態:提示程式沒有 `style=`、`innerHTML` 帶樣式、顏色字面值;真 Chrome:提示在時 console 0 則、「送出」正中心點得到 | 紅 |
| D | 不退步 | 既有測試全綠 | 綠 |

- 自測片段一律最小,不放可以直接抄的完整實作。測試一律用 `mkdtemp` 當 `XDG_*` 與 `HOME`;**不准 live**。

## 怎麼跑

```bash
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@i3 and not @manual' --format summary
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@desktop-shell and not @manual' --format summary
VITEST_MAX_WORKERS=1 npx vitest run apps/desktop packages/ui-shared/src/hud apps/test-card apps/teach-card
CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run boundaries
```

- 環境:`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`。cucumber 一律用 `--tags`(重活,先拿位子)。
- lc-fs 的 probe 路徑寫死在簽出的 `apps/desktop/src-tauri/target/debug/`。新簽出第一次跑會冷編。
- 不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev`。

## 不在範圍

- Rust 起側車的那一段(T22 的 cargo 測試守)。
- 完整的 `tauri build` 進 cucumber。
- `@e2e @manual`「A person completes a review session in the window」本身:要真資料,併到 I4(ADR-073)。
- placeholder 頁面與它的 `wayland-note.js`;Wayland 的視窗位置(協定不讓客戶端設);hud.css、HUD 元件、兩張卡的 `App.svelte`。
- 盤點的 O2(GNOME 第二次開時考試卡沒拿到焦點)、O3(面板半透明):另議。

## 預算

`budget_usd: 3`。grok 不設花費上限,只記錄。LLM 真呼叫:0。

## 測試誰寫

- A:-e5(全部是測試)。B 的紅測試:-e5。開發 worker 以紅測試分支為基底。
- 實作:worker-grok,只改「touches」列的檔。
- 驗收:-ed。觀感:前端(B4),技術顧問判。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
落點:`apps/desktop/src-tauri/src/`(B)、`features/steps/` 新檔(A)。跟 T33(13-work-dag)不重疊。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
