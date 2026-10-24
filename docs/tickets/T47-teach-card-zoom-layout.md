---
id: T47
deps: [T46, T48]
touches: [apps/teach-card/src/, apps/desktop/src-tauri/tauri.conf.json]
cpu: heavy
budget_usd: 4
status: merged
owner: worker-grok
must_catch:
  - 放大、縮小、還原的按鍵沒有讓卡片內容變一級、到頭不停、換卡或重新載入之後回到 100%,或按鈕列、系統狀態字樣、標題列跟著變大小:渲染測試 a 必須紅
  - 任何一級縮放、360 寬或更寬時捲動區出現橫向捲動,或內容用 transform 放大而沒有重排:渲染測試 b 必須紅
  - 很長的例子捲到上面、中間、底下時,按鈕列有一部分在看得到的範圍外,或按鈕的位置跟著捲動變了:渲染測試 c 必須紅
  - 任何一級縮放下,T45 的轉換(短卡、長卡捲到底、長卡捲到中間)讓按鈕移動或捲動位置自己變了:渲染測試 d 必須紅
  - 教學卡視窗沒有最小寬高,或最小寬度不是 360,或考試卡視窗也被改了,或開了 zoomHotkeysEnabled、程式改了 webview 的縮放:靜態測試 e 必須紅
  - Wayland 一次性提示在的時候,黏在下面的按鈕列被提示蓋住(中心點打不到按鈕):渲染測試 f 必須紅
  - 實作動到 touches 以外的檔:不動的地方那條 diff 檢查必須有輸出
  - T43 到 T46 的教學卡測試、HUD 的 card-static 與 card-render、Wayland 提示的 T34 與 T35 測試、桌面殼讀 tauri.conf.json 的測試任一變紅:不退步必須紅
---

# 工單 T47:教學卡的縮放、長內容不弄丟按鈕、視窗大小(07-teach-card phase-4 的後半)

> 狀態:顧問審過 2026-10-24(D1–D4 照建議,記在 ADR-080;補 2 處:場景 6、7 的措辭,不准 Tauri 的縮放快捷鍵與 webview 縮放)。規格:UI/Tauri 負責人。編號 T47:協調者配。
> **07 phase-4 拆成兩張**(顧問裁 T46 的 D0):T46 做場景 1–5(折疊、圖片);這張做 `../../features/07-teach-card/phase-4.feature` 的場景 6–8。排在 T46 之後(兩張都改 `App.svelte`)。
> **這張會改版面**,而且碰到三個已經量過的保證:T45 的「系統狀態字樣不推動按鈕」(0 px)、T35 的 Wayland 提示留白、HUD 的「捲的是面板裡面」。D1–D4 顧問已裁(縮放範圍與長內容版面記在 ADR-080,ADR 由協調者寫進 `../02-decision-map.md`,跟這張工單分開合)。
> 實作:worker(opencode + grok-4.7);紅測試:測試 agent;驗收:驗收 agent;`@manual`:前端,技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 依據:`../../features/07-teach-card/phase-4.feature` 場景 6–8;`../00-design.md` 第 4.1 節(預設 360 × 480、可縮放、可捲動);`T45-teach-card-status-layout.md`(留的位置、0 px、D5 只量 360 寬);`../reviews/T45-manual-2026-10-24.md`(真 app 的量測);SKILL §4g 第 29 條。
> 基底:T46 合併之後的 main。
> **LLM 真呼叫 0。**

## 為什麼有這張

`phase-4.feature` 的後三個場景:

- **場景 6 縮放**:用快捷鍵放大一級,整張卡變大;縮小、還原也要能用;設定跨卡記住。
- **場景 7 很長的內容**:內文固定在上面,例子區自己捲,三顆按鈕固定在下面。現在是整個 `.hud-body` 一起捲,例子很長時按鈕在最下面,要捲到底才按得到。
- **場景 8 視窗大小**:視窗改大小時內容重排,縮到最小寬度就不再縮。現在 `tauri.conf.json` 沒有最小寬高。

三件事都跟 T45 有關:

- T45 留的位置(81.4 px)是用 360 寬、100%、字級 13.6 px 量的(T45 的 D5)。字樣跟著縮放變大、或視窗變窄,最高那句金鑰字樣就會多折一行,放不進留的位置。
- 按鈕要「固定在下面」,系統狀態字樣的位置就也在下面那一塊裡。那一塊如果靠底對齊,字樣變高時會把按鈕往上推。

## 要的結果(量結果,不綁做法)

### 1. 縮放(場景 6)

- **範圍(D1=A,ADR-080)**:縮放的是**卡片內容**:標示列、先備提示、標題、內文、例子(含例子裡的圖)。按鈕列、系統狀態字樣(T45 那一塊)、標題列、Wayland 提示**不縮放**。
  - 理由:T45 的留位與 0 px 是在固定字級下量的;按鈕與系統字樣不變大小,T45 在每一級縮放下都還成立,不用重量。
- **級距(D2)**:80%、90%、100%、110%、125%、150%,預設 100%。
- **按鍵**:放大 `Ctrl+=`、`Ctrl++`(`Ctrl+Shift+=`)、數字鍵盤的 `Ctrl+加號`;縮小 `Ctrl+-`、數字鍵盤的 `Ctrl+減號`;還原 `Ctrl+0`、數字鍵盤的 `Ctrl+0`。macOS 的 `Cmd` 一樣(phase-4 的 macOS 還沒做,先收)。到最大或最小再按不變。
- **一級就是一級**:每按一下,內容的字級(例如內文的計算 `font-size`、例子裡的圖的寬)照級距變,文字重排。**不准**用 `transform: scale` 這類不重排的做法(會橫向凸出去、會蓋到按鈕)。
- **跨卡記住**:換卡(下一個、換類別、深入、回上一層、先備提示)、重新載入頁面、重開 app 都照舊。記在 `deps.storage`。
- 其他快捷鍵不受影響;卡片裡沒有輸入框,不用管輸入時的衝突。
- **不准**(顧問 2026-10-24):不開 Tauri 的 `zoomHotkeysEnabled`,程式也不改 webview 的縮放(`setZoom` 之類)。開了的話 `Ctrl+=` 會把整個視窗(含按鈕)一起放大,等於 D1 的 B。

### 2. 很長的內容不弄丟按鈕(場景 7)

**D3=B(ADR-080)**:

- **按鈕列與系統狀態字樣那一塊黏在 `.hud-body` 看得到的範圍的底部**(內容比視窗短時,就在內容後面,跟現在一樣)。
- 內文與例子一起在 `.hud-body` 裡捲(捲的還是 `.hud-body`,T35 的留白、HUD 的捲動區測試照舊)。
- 捲到上面、中間、底下,按鈕列整塊都看得到,而且**位置不變**(同一張卡上捲動時,每顆按鈕的矩形相同)。
- 黏在下面那一塊有底色(`var(--hud-panel)`;內容從底下捲過去透出來太明顯的話改 `var(--hud-solid)`,`@manual` 截圖給顧問判),不畫線(畫線要新的 card-static 例外)。
- **T45 照舊**:那一塊的高度固定(按鈕列 + 留的位置),字樣出現、收掉、換種類不改變它的高度,所以按鈕不動、捲動位置不變。量的位置多一個:長卡捲到中間。


### 3. 視窗大小(場景 8)

- **最小寬高(D4=A)**:`../../apps/desktop/src-tauri/tauri.conf.json` 的教學卡視窗加 `minWidth: 360`、`minHeight: 400`。考試卡視窗不動(06 的事)。
  - 最小寬度 360 = 預設寬度,所以 T45 的「只量 360 寬」(D5)一直成立:視窗只會比 360 寬,不會更窄。
- **重排**:視窗變寬、變高時內容跟著排,沒有橫向捲動;按鈕列一直在看得到的範圍裡(第 2 條)。
- 渲染測試量 360 × 400、360 × 480、480 × 600、600 × 800 四種大小;真的視窗(縮到最小就停)在 `@manual` 量。

### 4. 不變的

- T46 的折疊、圖片、放大(放大層蓋整個視窗,不受縮放影響)。
- T45 的 0 px、看得到、O1 樣式;T44 的生成中畫面;T43 的深入。
- `<div class="controls">` 裡直接是四顆按鈕(`t43-deepen.test.ts` 讀原始碼找它);「下一個」的 `onclick={handleNext}`、`disabled={finished}`;最外層一個 HudPanel。
- `.hud-body` 的 `padding-bottom` 由 T35 的提示程式管,教學卡不碰。
- 側車、協定、Rust 程式碼、core、`packages/ui-shared/` 都不動(`tauri.conf.json` 只動教學卡視窗的兩個欄位)。

## 要改的 feature 措辭(測試 agent 在紅測試 commit 改,ADR-080 引用)

`../../features/07-teach-card/phase-4.feature` 有兩處跟裁決衝突(顧問 2026-10-24):

- **場景 6**:`Then the whole card scales up one step` 跟 D1=A(按鈕不縮)衝突。改成 `Then the card content scales up one step`,後面加 `And the controls keep their size`(措辭由測試 agent 定,意思是這樣)。
- **場景 7**:`Then the body stays fixed at the top` / `And the example area scrolls` / `And the three controls stay fixed at the bottom` 改成內文與例子一起捲、按鈕列固定在下面,例如 `Then the body and the examples scroll together` / `And the controls stay fixed at the bottom`。不寫「three」:level 1 起有「回上一層」,可能是四顆。
- `.feature` 在 `features/**`,開發 worker 不改;測試 agent 改完寫進紅測試的 commit 說明。

## card-static 的禁止清單(起草前掃過)

- 黏在下面那一塊:`position: sticky` 與底色 `var(--hud-*)` 可以;**不准**上框線、陰影(`border*`、`box-shadow`、`outline` 都是禁止的屬性名)、漸層底。
- 縮放:`<style>` 只准用 `--hud-` 開頭的變數,所以不能用自己的 CSS 變數傳縮放比例;標記不准有 `style=` 屬性。可以用 Svelte 的 `style:屬性={…}` 指令(CSSOM,CSP 放行),例如 `style:zoom` 或 `style:font-size`(哪個做得到第 1 條「重排、圖也跟著變」由 worker 定)。
- 不准 Svelte 的動畫指令;縮放不做動畫。
- 這張**不需要新的 card-static 例外**(除非 D3 要在黏住那一塊上面畫線)。

## 驗收條件

### 1. 自動驗收(測試 agent 寫)

| 層 | 指令 | 過的條件 |
|---|---|---|
| 教學卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/` | 全綠,含新的渲染測試、T43–T46 既有的 |
| HUD | `VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/` | 全綠,含 card-static、card-render、Wayland 提示 T34 / T35 |
| 桌面殼 | `VITEST_MAX_WORKERS=1 npx vitest run apps/desktop/src/`、`CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`,與 `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@desktop-shell and @phase-6 and not @manual' --format summary` | 全綠(讀 `tauri.conf.json` 的 TS 測試(CSP、視窗 label、無框)、Rust 與步驟照樣過;拿位子) |
| 不退步 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and not @manual' --format summary` | 全綠(拿位子) |
| 不動的地方 | `git diff --stat <T46 合併的 sha>..HEAD -- packages contracts scripts features/07-teach-card apps/desktop/src apps/desktop/src-tauri/src apps/teach-card/src/teach-session.ts apps/teach-card/src/main.ts` | 沒有輸出 |

**渲染測試**(新檔,放 `apps/teach-card/src/`;做法同 T45:`openApp` + `initScript` 改 `/__card` 的回應、扣住 `teach.poll`):

- **a. 縮放**:每一級的內文 `font-size` 與例子裡圖的寬照級距(容許 0.5 px);按到最大、最小再按不變;`Ctrl+0` 回 100%;按「下一個」、重新載入之後是同一級;每一級下「下一個」的字級與高、`.status-slot` 的高、標題列的高跟 100% 時相同。
- **b. 重排**:每一級 × 第 3 條的四種大小,`.hud-body` 的 `scrollWidth` ≤ `clientWidth`;內文的行數隨級距增加(證明是重排,不是 transform)。
- **c. 長內容**:很長的例子(`scrollHeight - clientHeight` ≥ 300 px),`scrollTop` 在 0、中間、最大三個位置,四顆按鈕整顆都在 `.hud-body` 看得到的範圍裡、`elementFromPoint` 打得到自己,三個位置的按鈕矩形相同。
- **d. T45 在縮放下**:T45 渲染測試 a、b 的轉換(含最高那句金鑰字樣),在 80%、100%、150% 三級、短卡與長卡捲到底、長卡捲到中間,每顆按鈕的矩形差 0(0.01 px)、`scrollTop` 不變。
- **e. 視窗大小與縮放快捷鍵**(靜態):教學卡視窗 `minWidth` 360、`minHeight` 400;考試卡視窗沒有這兩個欄位(或跟原本相同);兩個視窗都沒有開 `zoomHotkeysEnabled`;`apps/teach-card/src/` 沒有呼叫 webview 縮放(`setZoom`)。
- **f. Wayland 提示**:用 T35 測試的做法(`initScript` 放 Rust 組出來的提示程式),長卡捲到中間與底下,按鈕中心點打得到按鈕、沒有被提示蓋住。
- 每一條在基底上的紅綠寫進紅測試的 commit 說明(c、f 在基底上應該紅;d 在基底上 100% 那一級本來就綠)。

### 2. 改壞證明(驗收 agent 的丟棄式證明)

至少:縮放改成連按鈕列一起縮 → a 紅、d 的大級距紅;改成 `transform: scale` → b 紅;拿掉 sticky → c 紅;黏住那一塊改成靠底對齊、留的位置拿掉 → d 紅;`minWidth` 改成 300 → e 紅;sticky 的位置算進提示的高度之外 → f 紅(要是 f 在做法上本來就成立,寫明為什麼)。

### 3. 觀感(`@manual`,前端做、技術顧問判)

做法同 T45 `@manual`(Xvfb `:97` + 巢狀 GNOME Shell、XTest 真的指標與按鍵、LLM 0、learning/ 前後相同);Wayland 那一列用 `:98` 上的巢狀 `--nested --wayland`(同 T34 的 B4)。

| 列 | 過的條件 |
|---|---|
| M1 縮放 | 真的按鍵放大、縮小、還原;換卡、重開 app 照舊;按鈕與系統字樣不變大小(順便確認沒有被 webview 整個放大:標題列、按鈕的字級與高跟 100% 時相同) |
| M2 長內容 | 很長的例子捲到上、中、下,按鈕一直在下面、按得到、位置不變;黏住那一塊的底色截圖給顧問判 |
| M3 T45 不退步 | 150% 下,長卡捲到中間與底下,按深入出生成中、取消、出錯,按鈕不動(同 T45 的每一幀量法) |
| M4 視窗大小 | 真的 WM 拖拉縮小,寬到 360、高到 400 就停;放大時內容重排、沒有橫向捲動 |
| M5 Wayland | 有提示時長卡捲到中間,按鈕沒有被蓋住 |

另外看:console 0 則。

## 要改的既有測試(測試 agent 改,開發 worker 不改)

- 預期不用改(D3=B):T45 的 b(長卡捲到底)、T35 的留白、HUD 的捲動區(`scrollInsideProblems`)量的都還是 `.hud-body`。真的紅了,停下來回報協調者與顧問,不放鬆斷言。
- `phase-4.feature` 場景 6、7 的措辭(見上一節)。

## 受保護的檔(開發 worker 不改)

- 測試:`*.test.ts`、`*-test-support.ts`、`features/**`、`.feature`。
- 實作:`packages/`、`contracts/`、`apps/desktop/` 裡 `tauri.conf.json` 以外的檔(含 Rust、CSP 那一行)、`scripts/`、`apps/teach-card/src/teach-session.ts`、`apps/teach-card/src/main.ts`。

## 落點

`apps/teach-card/src/` → 07-teach-card;`apps/desktop/src-tauri/tauri.conf.json` → 10-desktop-shell(這張只加教學卡視窗的兩個欄位)。不新增 import 例外。

## 顧問的裁決(2026-10-24;D1 + D3 記在 ADR-080)

- **D1=A 只縮放卡片內容**(標示列、先備提示、標題、內文、例子),按鈕列、系統狀態字樣、標題列不縮放。T45 的留位與 0 px 在每一級都成立。整個視窗一起縮放(B)的話,150% 等於 240 px 寬的版面,最高那句金鑰字樣會多折行,T45 的留位要用最大一級量。
- **D2**:80%、90%、100%、110%、125%、150%;`Ctrl` 加 `=` `+` `-` `0`(含數字鍵盤),macOS 的 `Cmd` 一樣。
- **D3=B 按鈕列與字樣那一塊黏在底部,內文和例子一起在 `.hud-body` 裡捲。** 推算的數字(T45 `@manual`,360 × 480,看得到 433 px):照原文(A)例子區只剩約 33–150 px,而且 `.hud-body` 不再是捲的那一個,T45、T35、HUD 的捲動區測試都要改;B 黏底那一塊約 127 px(兩排按鈕約 169 px),可讀約 290 px,那些測試照舊。代價是內文跟著捲走,所以場景 7 的措辭要改(上面那一節)。
- **D4=A**:`tauri.conf.json` 的教學卡視窗 `minWidth: 360`、`minHeight: 400`。360 讓 T45 的 D5(只量 360 寬)一直成立。
- **ADR-080**:D1 + D3,號碼協調者配,寫在 `../02-decision-map.md`(跟這張工單分開合)。
- 補兩處:場景 6、7 的措辭(「要改的 feature 措辭」);不准 `zoomHotkeysEnabled` 與 webview 縮放(第 1 條、靜態測試 e、M1)。
- 顧問特別要留的兩條:d(縮放下 T45 照舊)、f(黏底的按鈕不被 Wayland 提示蓋住:sticky 遇到 T35 加在 `.hud-body` 的 `padding-bottom` 就在這裡出事)。

## 不在範圍

- 考試卡視窗的縮放與最小大小(06)。
- 用滑鼠滾輪加 `Ctrl` 縮放;觸控板手勢。
- Wayland 下視窗管理員怎麼處理最小大小(`@manual` 只量 X11 + 巢狀 GNOME Shell;M5 只看提示有沒有蓋住按鈕)。
- T42 的等候字樣(`.notice`,在面板最上面)跟著黏住:不做。

## 預算

`budget_usd: 4`。沒有 LLM 花費。

`cpu: heavy`:改了 `tauri.conf.json`,驗收要跑 cargo 測試與 tauri build;渲染測試起 vite、headless Chrome 與側車。協調者照重活排位子。

## 測試誰寫

- 紅測試(渲染 a–d、f,靜態 e)、要改的既有測試:測試 agent。改壞證明:驗收 agent。
- 實作:worker(opencode + grok-4.7)。
- `@manual`:前端,技術顧問判。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 重活先跟協調者拿位子:`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`,cucumber 一律 `--tags`。
