---
id: T45
deps: [T44]
touches: [apps/teach-card/src/]
cpu: light
budget_usd: 2
status: todo
owner: worker-grok
must_catch:
  - 同一張卡上系統狀態字樣出現、收掉或換成另一種時,任何一顆前後都在的按鈕位置變了(不是 0 px):渲染測試 a 必須紅
  - 內文長要捲的卡捲到底之後,字樣出現或收掉讓任何一顆按鈕的位置變了,或捲動位置自己變了(轉換裡含 360 寬最高的那一句金鑰字樣):渲染測試 b 必須紅
  - 字樣出現時有一部分在面板看得到的範圍外(短卡、長卡捲到底兩種),或那一行裡的 取消 中心點打不到自己:渲染測試 c 必須紅
  - 字樣的字級、上方 1px var(--hud-line) 分隔線、字色跟 T44 第 8 條不同,取消 比 下一個 小,或分隔線不在 .generating 與 .deepen-error 自己身上:渲染測試 d 必須紅
  - 360 寬時字樣裡直角引號括住的詞被折成兩行(其他深入錯誤那一句與注入的一句都量),或捲動區出現橫向捲動:渲染測試 e 必須紅
  - 最深一層那張按 深入這個 之後在同一個點再按一下送出 teach.back 或換了卡,或沒有子卡那張同樣做送出 teach.cancel:渲染測試 f 必須紅
  - 實作動到 App.svelte 以外的檔(含 card-static 的測試支援、core 的錯誤字串、teach-session.ts):不動的地方那條 diff 檢查必須有輸出
  - T44 的渲染與 session 測試、T43 既有的測試、Wayland 提示的 T34 與 T35 測試、card-static 任一變紅:不退步必須紅
---

# 工單 T45:教學卡的系統狀態字樣不推動按鈕、直角引號裡的詞不折斷(T44 `@manual` 的 N1、N2)

> 狀態:顧問審過 2026-10-24(D1–D5 照建議;補一處:留的位置要用真的金鑰字串量最高的那一句,不估)。規格:UI/Tauri 負責人(T43、T44 工單作者)。編號 T45:協調者配。顧問 2026-10-24 判 T44 `@manual` 通過、N1 與 N2 開這張;**低優先,排在 07 phase-3 done 之後**。
> **T45 取代 T43 第 6 節「字樣在按鈕列上面」的位置規定(顧問 2026-10-24)。** T44 第 1 條「在按鈕列上面」那幾個字也一起取代。位置改成只規定結果(下面第 1、2 條)。不需要 ADR、不動契約。
> 實作:worker(opencode + grok-4.7);紅測試(含渲染測試):測試 agent;驗收:驗收 agent;`@manual`:前端,技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 依據:T44 `@manual` 證據 docs/reviews/T44-manual-2026-10-24.md 的 N1、N2(證據分支 ea7658a,跟 07 phase-3 done 一起合);`T43-teach-card-phase-3.md` 第 6 節;`T44-teach-card-generating-view.md` 第 8 條。
> 基底:main `e30a353` 或之後。
> **LLM 真呼叫:0。** 渲染測試用單獨執行的假網路;`@manual` 用暫存根 + 假網路。

## 為什麼有這張

T44 的 `@manual` 在真的 app 裡(真的指標點)量到:

- **N1**:四種系統狀態字樣都放在按鈕列上面,所以字樣一出現,整個按鈕列就往下移。量到的位移:生成中 73.5 px、最深一層 39.3 px、兩行的錯誤 59.3 px。指標還停在剛才按的地方,底下就換成別顆按鈕。
  - 在 level 4 那張快速雙擊「深入這個」(兩下相隔約 0.12 秒):第一下之後不到 10 ms 就出現「這張已經是最深的一層了。」,第二下落在往下移過來的「回上一層」上,送出 `teach.back`,畫面退回 level 3。
  - 沒有子卡的那張雙擊沒事:第二下落在生成中那一行的字上(那時按鈕都停用)。
  - T43 時字樣就在按鈕列上面,不是 T44 帶進來的。
- **N2**:「其他深入錯誤」那句「這次沒有產生出能用的卡。可以再按一次「深入這個」。」在 360 寬折行,剛好切在「深入這個」中間(「深入這 / 個」。」)。字串在 `../../packages/core/src/session/protocol.ts` 的 `ERROR_MESSAGES`,這張不改它。

## 要的結果(量結果,不綁做法)

「系統狀態字樣」指這幾種,都在卡片畫面上:

- 生成中那一行(`.generating`,含裡面的「取消」);
- 深入的錯誤字樣(`.deepen-error`):最深一層、沒有模型、其他深入錯誤(`deepen-failed`)、金鑰不能用(`credential-unavailable`,字是側車給的,跟著鍵名變長短)。

畫面(`App.svelte` 真的畫出來的樣子,視窗 360 × 480):

1. **按鈕不動**:同一張卡上(標題沒換),字樣出現、收掉、或換成另一種的前後,每一顆前後都在畫面上的按鈕,`getBoundingClientRect` 完全相同(差 0;比數字時只容許 0.01 px 的浮點誤差)。
   - 「每一顆」= 按鈕列的四顆(有幾顆量幾顆)與先備提示的按鈕。「取消」跟著生成中那一行出現、收掉,不算。
   - 要量的轉換:沒字 → 生成中;生成中 → 沒字(取消);生成中 → 錯誤(輪詢拿到錯誤);沒字 → 最深一層、沒有模型、其他深入錯誤、金鑰不能用;錯誤 → 生成中(錯誤之後再按深入)。
   - 兩種位置都量:短卡(內容放得下、不用捲);長卡(內文長、要捲的卡)**捲到底**之後。長卡另外量捲動位置(`scrollTop`)前後相同:不准靠自己捲動把按鈕「放回」原處。
   - 換卡(生成完自己換成新卡、按下一個、回上一層)不算:那時整張卡都換了。
2. **看得到**:字樣出現時,整塊在面板看得到的範圍裡(`.hud-body` 的可見矩形裡,上下左右都不出界);生成中那一行的「取消」中心點 `elementFromPoint` 打得到自己。短卡、長卡捲到底兩種都量。
3. **O1 樣式照舊**(T44 第 8 條):字比內文小(0.85rem)、上方 1px `var(--hud-line)` 分隔線、字色 `var(--hud-text)`;「取消」跟「下一個」同字級、同高度。
   - card-static 的窄例外**不擴大**(`../../packages/ui-shared/src/hud/card-static-test-support.ts` 的 `separatorAllowed`):分隔線只能寫在 selector 剛好是 `.generating`、`.deepen-error` 或兩者合寫的那一條,值只能是 `1px solid var(--hud-line)`。所以:
     - 分隔線留在 `.generating`、`.deepen-error` 自己身上,不搬到外層容器(`.status`、`.status .generating` 這類 selector 都會紅);
     - 為了留位置加的外層容器不畫任何東西:沒有 `border*`、`outline`、`box-shadow`、`clip-path`、`mask`,背景不用漸層;
     - 顏色只用 `var(--hud-*)`;標記裡不帶 `style=` 屬性;不用 Svelte 的動畫指令。
4. **N2 直角引號裡的詞不折斷**:360 寬時,字樣裡每一段「…」(含兩個括號)在同一行。前提是那一段比一行短;比一行長的可以折,但不准橫向凸出去(`.hud-body` 的 `scrollWidth` ≤ `clientWidth`)。
   - 對所有字樣都成立,不是只對 `deepen-failed` 那一句寫死(渲染測試會注入另一句)。
   - **只改 `App.svelte`**,不改 core 的 `ERROR_MESSAGES`、`../../packages/core/src/llm/credentials.ts` 的字串。
5. **雙擊**:最深一層那張快速雙擊「深入這個」,第二下不送 `teach.back`、還在 level 4、最深一層的字樣還在;沒有子卡那張雙擊,第二下不送 `teach.cancel`、生成照跑。(第 1 條做到了,這條自然成立;`@manual` 用真的指標量。)

不變的:

- T44 第 1–8 條,除了「在按鈕列上面」那幾個字。T43 第 6 節的其他規定照舊(字樣不進出錯畫面、下一個動作時收掉、輪詢、取消的做法)。
- 等候字樣(T42 的 `.notice`,在面板最上面)照舊,這張不管(顧問的裁決 D4)。
- Wayland 一次性提示(T34、T35)照舊。它用 `.hud-body` 的 `padding-bottom` 讓出位置(`../../packages/ui-shared/src/hud/card-render-wayland-note-t35.test.ts`),教學卡不要碰 `.hud-body` 的 `padding-bottom`。
- 按鈕列的標記照舊是 `<div class="controls">`,裡面直接是四顆按鈕:`t43-deepen.test.ts` 第 556 行那條讀原始碼的測試用 `<div class="controls">…</div>` 找它。「下一個」的 `onclick={handleNext}`、`disabled={finished}` 照舊(card-static 的 buttonProblems)。
- `teach-session.ts`、`main.ts`、側車、協定、Rust、core 都不動。

## 做法(顧問 2026-10-24 選 A;量的結果才是驗收)

兩個做法都過得了第 1、2 條。顧問選 A(D1):

- **A. 字樣搬到按鈕列下面,底下先留好位置。**
  - 按鈕列下面放一塊固定高度的位置,字樣出現在裡面;沒有字樣時那塊是空的,什麼都不畫。字樣在按鈕下面,出現、收掉都碰不到上面的按鈕。
  - 為什麼要先留位置:長卡捲到底時,沒有留位置的話,字樣會出現在下緣外面(違反第 2 條);字樣收掉時,捲動區變矮、瀏覽器把捲動位置往回夾,整張往下跳(違反第 1 條)。
  - 高度用最高的那一種在 360 寬量出來,**用真的字串量,不估**。T44 `@manual` 量到:生成中那一塊(字一行加「取消」一行)61.5 px、兩行的錯誤 47.4 px,另加上外距 12 px。金鑰那句的字跟著問題種類與鍵名變長短,要把真的會出現的每一句都量過(見「渲染測試」那節的「最高的金鑰句」),取最高的。
  - 那塊位置在短卡上就是按鈕下面的空白,看不出來;長卡上是捲到底多出來的一段空白。
  - 「取消」可以照舊排在字的下一行(T43 的 O2 顧問判收)。
- **B. 字樣留在按鈕列上面,先留好位置。**(沒選)一樣過得了,但按鈕跟內文之間永遠多一塊約 80 px 的空白;而且留的位置不夠高時(字樣變長),第 1 條就破。

N2 的做法:

- 在 `App.svelte` 裡把字樣照「…」切段,括號那一段包一個 `<span>`,給 `white-space: nowrap`(或 `word-break: keep-all`,量過不會橫向凸出再用)。
- 用 `{#each}` 輸出文字節點,不用 `{@html}`:金鑰那句的字是側車給的。

## 驗收條件

### 1. 自動驗收(vitest,測試 agent 寫)

| 層 | 指令 | 過的條件 |
|---|---|---|
| 教學卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/` | 全綠,含新的渲染測試、T44 的渲染與 session 測試、T43 既有的測試、T40 的靜態測試 |
| HUD | `VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud/card-static.test.ts packages/ui-shared/src/hud/card-static-self.test.ts packages/ui-shared/src/hud/card-render-wayland-note.test.ts packages/ui-shared/src/hud/card-render-wayland-note-t35.test.ts packages/ui-shared/src/hud/card-render.test.ts` | 全綠 |
| 不退步 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and @phase-3 and not @manual' --format summary`,與 `--tags '@teach-card and @phase-2 and not @manual'` | 全綠(拿位子) |
| 不動的地方 | `git diff --stat e30a353..HEAD -- packages contracts apps/desktop features scripts apps/teach-card/src/teach-session.ts apps/teach-card/src/main.ts` | 沒有輸出 |

**渲染測試**(新檔,放 `apps/teach-card/src/`,例如 `t45-status-layout-render.test.ts`):

- 真的把 `App.svelte` 畫出來,做法同 `../../apps/teach-card/src/t44-generating-render.test.ts`:`../../packages/ui-shared/src/hud/render-test-support.ts` 的 `openApp(<apps/teach-card 的目錄>, { viewport: 360 × 480, initScript })`;`initScript` 記錄 `/__review` 每個請求的 method、能扣住 `teach.poll`、能讓某個 method 回指定的錯誤(含 `credential-unavailable` 帶 `message`)。
- **不准**用讀原始碼比字串代替渲染(SKILL §4g 第 29 條);不新增 npm 依賴;不改 `packages/ui-shared` 的測試支援(那不在這張的 `touches` 裡)。
- **長卡**:單獨執行的暫存根裡有一張卡比視窗長(`../../packages/ui-shared/src/hud/card-render-test-support.ts` 的 `scrollInsideProblems` 靠它),可以直接用。不夠長(要 `scrollHeight - clientHeight` ≥ 150 px)的話,在 `initScript` 改回應裡的卡片內文加例子區塊。**短卡**:內容放得下的那張;沒有的話同樣改回應。做法測試 agent 定。
- **最高的金鑰句**(顧問 2026-10-24 補):留的位置夠不夠高,要用真的字串量,不估。
  - 測試裡 import `../../packages/core/src/llm/credentials.ts`,做法同 `t43-deepen.test.ts` 第 43 行(`pathToFileURL` 算出 file URL 再動態 import),不新增 boundaries 例外。
  - 列出 `credentialMessage(problem, 'deepen')` 所有真的會出現的組合:問題種類 `missing`、`rejected` × 鍵名 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GATEWAY_API_KEY`,共 6 句(`GRADING_KEYS` 沒有 export,測試裡寫出這三個,並先斷言 `credentialMessage` 收下每一個)。另加側車沒帶 `message` 時畫面用的那一句(`../../packages/core/src/session/protocol.ts` 的 `ERROR_MESSAGES['credential-unavailable']`)。
  - 在 360 寬、真的樣式下量每一句的 `.deepen-error` 高度,找出最高的那一句(一句一句注入量,或其他做法,測試 agent 定)。用 `initScript` 把它注入成 `teach.deepen` 回的 `credential-unavailable` 錯誤的 `message`;先斷言畫面上的字就是注入的那一句,才往下量。
  - a、b、c 的轉換都要包含這一句。量到的高度與行數寫進紅測試的 commit 說明。
- 量的都是畫面(DOM 與計算樣式),不是 `view()`:
  - **a.** 短卡,第 1 條列的每一種轉換(金鑰不能用用最高的那一句):前後每顆按鈕的矩形相同。
  - **b.** 長卡捲到底(`scrollTop` = `scrollHeight - clientHeight`),同 a 的轉換:前後每顆按鈕的矩形相同、`scrollTop` 相同。
  - **c.** 第 2 條:短卡、長卡捲到底,每一種字樣出現時整塊在 `.hud-body` 的可見矩形裡;生成中「取消」的中心點打得到自己。
  - **d.** 第 3 條:沿用 T44 g 的斷言(字級、分隔線、字色、「取消」與「下一個」同大小),另外量分隔線就在 `.generating`、`.deepen-error` 那個元素自己身上(它的計算 `border-top-width` 是 1px),它的祖先到 `.hud-body` 為止都沒有框線。
  - **e.** 第 4 條:`deepen-failed` 那句在 360 寬,括號連同「深入這個」那一段的 `Range.getClientRects()` 都在同一行(top 相同)。另外注入一句 `credential-unavailable` 的 `message`,讓「…」在 `e30a353` 上剛好落在折行處,量同一件事。兩次都量 `.hud-body` 的 `scrollWidth` ≤ `clientWidth`。
  - **f.** 第 5 條,用 DOM 模擬「指標還停在原地的第二下」:記下「深入這個」的中心點,按它;字樣出現之後,在同一個點 `document.elementFromPoint` 拿到的元素,是可以按的按鈕就 `click()` 它。最深一層(讓 `teach.deepen` 回 `deepen-floor`):記錄裡 0 個 `teach.back`、標題沒換。沒有子卡那張(扣住 `teach.poll`):0 個 `teach.cancel`、還在生成中。
- **紅測試先寫**:在 `e30a353` 上 a、e、f(最深一層)要紅,紅的原因是「按鈕列被字樣推下去」「括號裡的詞被折斷」「第二下按到回上一層」,不是測試自己壞。c、d 與 f(沒有子卡)在 `e30a353` 上本來就綠(標「本來就綠」,它們守的是換了位置之後不能退步)。
  - b 在 `e30a353` 上應該紅;但 Chrome 有 scroll anchoring,可能自己把捲動位置調回去、讓按鈕看起來沒動。那樣的話 b 的 `scrollTop` 那一半會紅;兩半都綠就標「本來就綠」並在 commit 說明。真的 app(WebKitGTK)由 `@manual` 的 M3 量。

### 2. 改壞證明(驗收 agent 的丟棄式證明)

`must_catch` 每一條各做一次:改了哪裡、哪一條紅、紅的訊息原文、還原後綠。改壞只動 `App.svelte`。至少要有:

- 把字樣搬回按鈕列上面(拿掉留好的位置)→ a 紅;
- 字樣留在按鈕列下面,只拿掉留好的位置 → b 或 c 紅(長卡捲到底看不到字樣,或收掉時整張往下跳);
- 留的位置改成只夠一行字 → b 紅(生成中那一塊是兩行高:字一行加「取消」一行);
- 留的位置只夠兩行,而最高的金鑰句是三行 → b 紅。**只有真的量到三行的句子時才做**;量出來最高只有兩行,就照上一條「只夠一行字」做,並把量到的最高行數寫進驗收證據;
- 拿掉括號那一段不折行的規則 → e 紅;改成只處理 `deepen-failed` 那一句 → e 的注入那句紅;
- 把分隔線搬到外層容器 → card-static 紅、d 紅;「取消」縮成 0.85rem → d 紅。

### 3. 觀感(`@manual`,前端做、技術顧問判)

做法同 T44 `@manual`:暫存根 + 假網路、Xvfb `:97` + 巢狀 GNOME Shell、`PATH` 放 ibus-daemon 替身、MemoryMax=2G,不碰使用者的桌面 `:1`;使用者的動作用 XTest 真的指標,只送 `:97`;LLM 真呼叫 0;真的 learning/ 前後相同。

| 列 | 過的條件 |
|---|---|
| M1 雙擊最深一層 | 真指標快速雙擊 level 4 那張「深入這個」:第二下不送 `teach.back`、還在 level 4、最深一層的字樣在 |
| M2 雙擊沒有子卡 | 同樣雙擊:第二下不送 `teach.cancel`,生成照跑、跑完出新卡 |
| M3 按鈕不動 | 真 app(WebKitGTK)量第 1 條的轉換:短卡與長卡捲到底,前後每顆按鈕的矩形差 0、長卡 `scrollTop` 不變 |
| M4 看得到 | 短卡、長卡捲到底,字樣整塊在面板看得到的範圍裡、「取消」點得到 |
| M5 N2 | 其他深入錯誤那句在 360 寬,「深入這個」在同一行 |
| M6 O1 | 五種畫面各截一張給顧問判:生成中、最深一層、沒有模型、其他深入錯誤、金鑰不能用;字級、分隔線、「取消」與「下一個」的大小照 T44 |

另外看:有子卡的那張深入不閃出生成中那一行;console 0 則。

## 要改的既有測試(測試 agent 改,開發 worker 不改)

- `../../apps/teach-card/src/t44-generating-render.test.ts` 的 a(第 211–221 行):拿掉「而且在按鈕列上面」那一句斷言(`compareDocumentPosition`),標題裡的字一起改。顧問 2026-10-24 批:T45 取代那條規定;a 其他的斷言(有生成中那一行與「取消」)照舊,不准放鬆。在紅測試的 commit 裡說明。
- 其他預期不用改。`t43-deepen.test.ts` 第 556 行那條讀原始碼的測試照樣要綠:這是實作的限制(見「不變的」),不是要改的測試。

## 受保護的檔(開發 worker 不改)

- 測試:`*.test.ts`、`*-test-support.ts`、`features/**`、`.feature`。worker 覺得測試有錯,寫進報告的「待協調」,不改。
- 實作:`packages/`(含 `packages/ui-shared/src/hud/` 的 hud.css 與 card-static 測試支援、core 的 `ERROR_MESSAGES` 與 `credentials.ts`)、`contracts/`、`apps/desktop/`、`apps/teach-card/src/teach-session.ts`、`apps/teach-card/src/main.ts`。

## 落點

`apps/teach-card/src/` → 07-teach-card(已在 `../../scripts/boundaries.owners.json`)。實作只動 `App.svelte`;新測試檔也放這裡。不新增 import 例外(07 → 14 已有,ADR-071)。

## 顧問的裁決(2026-10-24)

- **D1 位置的做法:A。** 字樣搬到按鈕列下面,底下留位置。按鈕和內文之間不多空白,比 B 好。
- **D2 第 2 條只量短卡、長卡捲到底兩種。** 「只捲到剛好看得到按鈕、還沒到底」不量(A 的話那時字樣可能在下緣外面一點)。
- **D3 不加 Wayland 量測。** 留的位置在 `.hud-body` 的正常排版裡,T35 的 `padding-bottom` 已經保證捲到底時內容在提示上面。
- **D4 等候字樣這張不管**,記在「不在範圍」。
- **D5 只量 360 寬。**
- 補一處:留的位置要夠高,而且要用真的字串量,不估(「渲染測試」那節的「最高的金鑰句」、改壞證明那節的三行那條)。
- t44 渲染測試 a 拿掉「在按鈕列上面」那半句:批(見「要改的既有測試」)。

## 不在範圍

- 等候字樣(D4)、出錯畫面(`.error`)裡的字樣折行、比 360 窄的視窗(D5)。
- Wayland 提示在的時候另外量第 2 條(D3)。
- 「取消」跟字放同一行(O2 顧問判收,不要求)。
- core 的錯誤字串、側車、協定、Rust、HUD 元件(`packages/ui-shared/src/hud/`)的任何改動。

## 預算

`budget_usd: 2`(一個檔的小改動加測試;grok 不設停止線,只記錄)。沒有 LLM 花費。

`cpu: light`:實作只有一個檔(檔頭的 cpu 只收 light、heavy)。但渲染測試會起 vite dev server、headless Chrome 與側車:測試 agent 寫紅測試、驗收 agent 跑完整 vitest 與 cucumber 時,協調者照重活排位子。

## 測試誰寫

- 紅測試(渲染測試)、要改的既有測試:測試 agent。改壞證明:驗收 agent。開發 worker 以紅測試分支為基底,不改測試。
- 實作:worker(opencode + grok-4.7),只改 `App.svelte`(標記與 `<style>`)。
- `@manual`:前端,技術顧問判。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 重活(vitest 完整、cucumber、渲染測試)先跟協調者拿位子:`VITEST_MAX_WORKERS=1`,cucumber 一律 `--tags`。
