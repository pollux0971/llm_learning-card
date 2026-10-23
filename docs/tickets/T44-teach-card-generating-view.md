---
id: T44
deps: [T43]
touches: [apps/teach-card/src/]
cpu: light
budget_usd: 2
status: merged
owner: worker-grok
must_catch:
  - 按深入之後、生成結果回來之前,畫面上沒有 正在產生更深入的卡片,可能要等幾十秒。 那一行或沒有 取消:渲染測試 a 必須紅
  - 生成中 下一個、換類別、深入這個 任何一顆在畫面上沒停用,或 回上一層 出現而且沒停用:渲染測試 b 必須紅
  - 生成中在畫面上按 下一個 送出了 teach.next、或畫面出現 這一列不是合法的請求。 或進出錯畫面:渲染測試 c 必須紅
  - 生成結果回來之後畫面沒有自己換成第一張新卡(要使用者再按一下才換):渲染測試 d 必須紅
  - 按 取消 之後畫面不是原本那張、生成中那一行沒收掉、或主按鈕沒恢復:渲染測試 e 必須紅
  - 有子卡的那張按深入,畫面上出現過生成中那一行(哪怕只閃一下):渲染測試 f 必須紅
  - 生成中那一行或深入的錯誤字樣(含最深一層、沒有模型)跟內文同大小、上面沒有 1px 分隔線、或那一行裡的 取消 比 下一個 小:渲染測試 g 必須紅
  - 生成中呼叫 session 的 next、chooseCategory(別的類別)、followPrereq 送出任何側車請求,或之後 view 變成出錯畫面:session 層測試必須紅
  - teach-session.ts 出現 setTimeout、sleep、now,或教學卡自己判斷 busy:T40 的靜態測試必須紅
  - 等候字樣(onWait)不再顯示、或 T43 既有的 teach-session 與 t43-deepen 測試任一變紅:不退步必須紅
---

# 工單 T44:教學卡生成中的畫面要跟著更新(T43 `@manual` 的 F1、F2)

> 狀態:顧問審過 2026-10-24(大致照原樣;加第 8 條樣式 = T43 `@manual` 的 O1,與渲染測試 g)。規格:UI/Tauri 負責人(T43 工單作者)。編號 T44:協調者配。顧問 2026-10-24 判 F1、F2 成立、擋 07 phase-3;不需要 ADR、不動契約。
> 實作:worker(opencode + grok-4.7);紅測試(含渲染測試):測試 agent;驗收:驗收 agent;`@manual`:前端,技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 依據:`../reviews/T43-manual-2026-10-24.md` 的 F1、F2、O1;`T43-teach-card-phase-3.md` 第 6 節(視窗)。
> 基底:main `930de2a` 或之後。
> **LLM 真呼叫:0。** 渲染測試用單獨執行的假網路;`@manual` 用暫存根 + 假網路。

## 為什麼有這張

T43 的 `@manual` 在真的 app 裡量到(證據檔的 F1、F2):

- **F1**:按「深入這個」之後,整段生成(18–27 秒)畫面一點都沒變。沒有「正在產生更深入的卡片,可能要等幾十秒。」、沒有「取消」、三顆主按鈕都還可以按。側車那一側是對的(馬上回 `generating: true`、每 500 ms 輪詢)。
  - 原因:`../../apps/teach-card/src/App.svelte` 只在 `act()` 的 promise 結束時(以及共用 client 的 `onWait`)把 session 的畫面拉進來;`session.deepen()` 要等整段輪詢跑完才 resolve。`teach-session.ts` 的 `view()` 本身是對的。
  - 自動測試沒抓到:`t43-deepen.test.ts` 對 `App.svelte` 只比原始碼字串,沒有真的渲染。
- **F2**(F1 帶出來的):生成中按看起來還能按的「下一個」→ 視窗送 `teach.next` → 側車回 `bad-request` → 出錯畫面「這一列不是合法的請求。」+ 停用的「再試一次」,要等生成跑完(約 26 秒)才自己換成新卡。

## 要的結果(量結果,不綁做法)

畫面(`App.svelte` 真的畫出來的樣子):

1. **生成中看得到**:`teach.deepen` 回 `generating: true` 之後,畫面上在按鈕列上面有 `GENERATING_MESSAGE` 那一行與「取消」;一直到輪詢拿到結果、或取消完成為止。
2. **生成中停用**:「下一個」「換類別」「深入這個」停用;「回上一層」有的話也停用;先備提示的按鈕也停用(第 6 節「類別清單打不開」照舊)。「取消」可以按。
3. **完成自己換**:輪詢拿到新卡,畫面自己換成第一張新卡(標示列有「來自:」),不用使用者再做任何事;輪詢拿到錯誤,錯誤字樣照 T43 第 6 節顯示在卡片上、按鈕恢復。
4. **取消**:按「取消」之後回到原本那張,生成中那一行收掉、主按鈕恢復(T43 第 6 節:手上那一個請求回來之後才送 `teach.cancel`,照舊)。
5. **不閃**:有子卡的那張按深入(`teach.deepen` 直接回子卡),畫面上不出現生成中那一行,哪怕一瞬間。
6. 等候字樣(`onWait`,T42 的字樣)照舊。

session 層(第二道防線,F2 不靠畫面停用才擋得住):

7. 生成中呼叫 `session.next()`、`session.chooseCategory(<別的類別>)`、`session.followPrereq(i)`:送出 **0 個**側車請求,`view()` 不變(不進出錯畫面、不改目前那張)。`back()`、`openCategories()` 在生成中本來就直接 return,照舊。

樣式(T43 `@manual` 的 O1,顧問 2026-10-24 判併進這張):

8. **系統狀態的字樣跟內文分開**。生成中那一行(`.generating`)與深入的錯誤字樣(`.deepen-error`:最深一層「這張已經是最深的一層了。」、沒有模型、其他深入錯誤)是系統狀態,現在跟卡片內文同色同大小(16 px)、沒有分隔,看起來像內文最後一段。要改成:
   - 字比內文小。顧問建議 `font-size: 0.85rem`(跟 `.markers` 一樣)。
   - 上面一條 1 px 的分隔線,顏色 `var(--hud-line)`。顧問建議上內距約 0.4rem。
   - 分隔線用 `border-top`:`packages/ui-shared` 的 card-static 規則「不畫框」對教學卡的 `.generating`、`.deepen-error` 開窄例外(只放行 `border-top: 1px solid var(--hud-line)`;顧問 2026-10-24 裁,理由:分隔線是內文裡的分隔,不是外框)。測試支援與自測由 `t44-static` 改。
   - 字色照舊 `var(--hud-text)`,不加新顏色;只用 `var(--hud-*)`。
   - 那一行裡的「取消」大小跟「下一個」一樣。按鈕的字沒有自己的 `font-size`,會繼承外層,所以外層改成 0.85rem 時要讓按鈕維持原來的大小。
   - 只改 `App.svelte` 的 `<style>` 與 class,不改 `../../packages/ui-shared/src/hud/hud.css`。
   - 「取消」排在字樣的下一行可以(O2 顧問判收),不要求同一行。

不變的:

- `teach-session.ts` 裡不出現 `setTimeout`、`sleep`、`now`,不自己判斷 busy(T40 的靜態測試,`../../apps/teach-card/src/t40-busy.test.ts` 第 160–167 行)。輪詢間隔照舊由 `main.ts` 注入的 `pause` 給。
- 側車、協定、Rust 都不動。

## 做法建議(不綁做法,量的結果才是驗收)

- session 加一個變更通知,形狀照 `onWait`:`onChange(listener): () => void`。在這幾個時候通知:`teach.deepen` 回 `generating: true` 之後、每次 `teach.poll` 回來之後、生成結束(成功、錯誤、取消)之後。
  - 「不閃」:不要在送出 `teach.deepen` 的當下就通知(那時還不知道是不是要生成);等回應說 `generating: true` 再通知。
- `App.svelte` 在 `$effect` 裡訂閱、收到就 `pull()`,跟 `onWait` 那一段同一個寫法。
- 第二道防線:`next`、`chooseCategory`、`followPrereq` 開頭跟 `back` 一樣,`generating` 時直接 return。

## 驗收條件

### 1. 自動驗收(vitest,測試 agent 寫)

| 層 | 指令 | 過的條件 |
|---|---|---|
| 教學卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/` | 全綠,含新的渲染測試與 session 測試、T40 的靜態測試、T43 既有的測試 |
| 不退步 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and @phase-3 and not @manual' --format summary`,與 `--tags '@teach-card and @phase-2 and not @manual'` | 全綠(拿位子) |
| 不動的地方 | `git diff --stat 930de2a..HEAD -- packages/core contracts apps/desktop/src-tauri packages/core/prompts features` | 沒有輸出 |

**渲染測試**(新檔,放 `apps/teach-card/src/`,例如 `t44-generating-render.test.ts`):

- 要真的把 `App.svelte` 畫出來:用 `../../packages/ui-shared/src/hud/render-test-support.ts` 的 `openApp(<apps/teach-card 的目錄>, { viewport: 360 × 480, initScript })`。它起的是單獨執行的 vite dev server(`dev/standalone.ts`:真的側車、暫存根、`dev/fake-cloud.mjs` 每個呼叫延遲約 1.5 秒)。
- 時點用 `initScript` 控制,不靠等很久:在頁面自己的腳本之前把 `window.fetch` 換成會記錄 `/__review` 每個請求 method 的版本,並能**扣住** `teach.poll` 的請求、等測試放行才轉給真的側車。做法同 `../../packages/ui-shared/src/hud/card-render-phase3.test.ts`(那支記錄 `/__review` 並注入錯誤)。
- **不准**用讀原始碼比字串代替渲染;不新增 npm 依賴。07 → 14(`packages/ui-shared/src/hud/`)的 import 例外已經有(ADR-071),不用新加。
- 至少這幾條,看的都是畫面(DOM 與計算樣式),不是 `view()`:
  - **a.** 按深入、`teach.poll` 被扣住時:畫面上有 `GENERATING_MESSAGE` 那一行與「取消」。
  - **b.** 同一個時點:「下一個」「換類別」「深入這個」是 `disabled`;有「回上一層」的話也是。
  - **c.** 同一個時點按「下一個」:記錄裡 0 個 `teach.next`;畫面沒有出現「這一列不是合法的請求。」、沒有出錯畫面。
  - **d.** 放行之後:畫面自己換成第一張新卡(標題換了、標示列有「來自:」、生成中那一行不見),測試期間不再按任何按鈕。
  - **e.** 按「取消」(必要時放行手上那一個 `teach.poll`):畫面回到原本那張、生成中那一行收掉、主按鈕恢復。
  - **f.** 有子卡的那張按深入:頁面裡的 `MutationObserver` 從按下去到子卡出現,沒有任何一筆畫面有生成中那一行。
  - **g.** 樣式(第 8 條),看計算樣式,生成中與最深一層兩種畫面都量:
    - 那一行(`.generating`、`.deepen-error`)的 `font-size` 小於 `.body`;
    - 有 1 px 的上框線,顏色等於計算出來的 `--hud-line`;
    - 生成中那一行裡的「取消」,`font-size` 與高度跟「下一個」一樣;
    - 最深一層的畫面(四顆按鈕加那一行字)在 360 × 480:四顆按鈕都在面板框裡,中心點 `elementFromPoint` 打得到自己。
    - 最深一層的畫面要走到 level 4:單獨執行的暫存根只有 level 0 的卡,可以連按深入讓它一層一層生(假網路每層約 4.5 秒),或在 `initScript` 裡讓 `teach.deepen` 回一個 `deepen-floor` 錯誤(照 card-render-phase3 注入錯誤的做法)。
  - 提示:單獨執行的暫存根裡,第一張卡深入成功之後就有子卡了。取消那條先做(取消不寫檔),或換一張沒有子卡的卡;f 用 d 生出來的子卡那一張(回上一層再深入)。

**session 層測試**(放 `apps/teach-card/src/`,沿用 `teach-session.test.ts` / `t43-deepen.test.ts` 的假 client):

- 生成中(`teachDeepen` 回 `generating: true`、`teachPoll` 還沒回)呼叫 `next()`、`chooseCategory(<別的類別>)`、`followPrereq(0)`:假 client 的請求紀錄不多任何一筆;`view()` 的 `state` 還是 `card`、`card` 不變、`generating` 還是 true。
- 變更通知(如果照建議做):`teach.deepen` 回 `generating: true`、每次 `teach.poll`、結束時各通知;`teach.deepen` 直接回子卡時,在子卡之前不通知生成中。這條綁做法,只在 worker 照建議做時才寫;沒照做的話,以渲染測試 a、d、f 為準。

**紅測試先寫**:在 `930de2a` 上 a、b、c、e、g 與 session 層那條要紅(紅的原因是「畫面沒更新」「送出了 `teach.next`」「那一行跟內文同大小、沒有分隔線」,不是測試自己壞;g 在最深一層的畫面上就紅得出來,那個畫面在 `930de2a` 上看得到、沒有樣式);d、f 在 `930de2a` 上本來就綠(標「本來就綠」,它們守的是修完之後不能退步)。

### 2. 改壞證明(驗收 agent 的丟棄式證明)

`must_catch` 每一條各做一次:改了哪裡、哪一條紅、紅的訊息原文、還原後綠。改壞只動 `apps/teach-card/src/` 的實作檔(`App.svelte`、`teach-session.ts`)。至少要有:

- 拿掉 `App.svelte` 的訂閱(或不通知)→ a、b 紅;
- 在送出 `teach.deepen` 的當下就通知 → f 紅;
- 拿掉 `next` 開頭的生成中檢查,同時讓「下一個」在畫面上不停用 → c 與 session 層那條紅;
- 只拿掉 `next` 的檢查(畫面照樣停用)→ session 層那條紅、c 照樣綠(證明兩道防線各自有測試);
- 拿掉第 8 條那段樣式 → g 紅;只拿掉讓「取消」維持原大小的那條規則 → g 紅。

### 3. 觀感(`@manual`,前端做、技術顧問判)

做法同 T43 `@manual`(暫存根 + 假網路、Xvfb `:97` + 巢狀 GNOME Shell、`PATH` 放 ibus-daemon 替身,不碰使用者的桌面 `:1`;LLM 真呼叫 0;真的 learning/ 前後相同):

| 列 | 過的條件 |
|---|---|
| F1 | 按深入之後 0.5 秒內出現生成中那一行與「取消」、三顆主按鈕停用,一直到新卡出現;新卡自己出現 |
| F2 | 生成中「下一個」停用;按它沒反應、不送 `teach.next`、不進出錯畫面 |
| 取消 | 按「取消」→ 回到原本那張、按鈕恢復;等手上那一個呼叫回來之後,磁碟(`cards/`、`questions/`、`graph/`、`reviews.json`)雜湊前後相同、帳本只多那一筆 `llm_call` |
| 生成中再按 | 「深入這個」停用、按它沒反應;直接送一個 `teach.deepen`,回同一個生成中畫面、假網路 0 個新請求、畫面不變 |
| O1 | 四種畫面各截一張給顧問判:生成中、最深一層、沒有模型(字樣兩行)、子卡(四顆按鈕);另量那一行的 `font-size`、上框線、「取消」與「下一個」的大小 |

另外照 T43 的做法看一次:有子卡的那張深入沒有閃出生成中那一行;console 0 則。

## 要改的既有測試

預期沒有。`t43-deepen.test.ts` 對 `App.svelte` 比原始碼字串的兩條(第 556 行起)修完照樣綠,測試 agent 決定留或刪;它們不算這張的驗收。

## 受保護的檔(開發 worker 不改)

- 測試:`*.test.ts`、`*-test-support.ts`、`features/**`、`.feature`。worker 覺得測試有錯,寫進報告的「待協調」,不改。
- 實作:`packages/core/prompts/`、`contracts/`、`apps/desktop/src-tauri/`、`packages/core/src/ingest/deepen.ts`、`packages/core/src/session/teach-deepen.ts`(這張只動視窗層)。

## 落點

`apps/teach-card/src/` → 07-teach-card(已在 `../../scripts/boundaries.owners.json`)。實作只動 `App.svelte`、`teach-session.ts`;新測試檔也放這裡。不新增 import 例外。

## 不在範圍

- T43 `@manual` 的觀察:O1 併入這張第 8 條;O2(「取消」在 360 寬排到下一行)顧問判收、不改。
- 連按兩次「取消」送出兩個 `teach.cancel`、「取消」按下後到回應之間要不要停用。
- 側車、協定、Rust、core 的任何改動;整個 `App.svelte` 的渲染測試(這張只測深入流程)。

## 預算

`budget_usd: 2`(兩個檔的小改動加測試;grok 不設停止線,只記錄)。沒有 LLM 花費。

`cpu: light`:實作只有兩個檔的小改動(檔頭的 cpu 只收 light、heavy)。但渲染測試會起 vite dev server、headless Chrome 與側車:測試 agent 寫紅測試、驗收 agent 跑完整 vitest 與 cucumber 時,協調者照重活排位子。

## 測試誰寫

- 紅測試(渲染測試、session 層測試)、改壞證明:測試 agent 寫渲染與 session 測試,驗收 agent 做改壞證明。開發 worker 以紅測試分支為基底,不改測試。
- 實作:worker(opencode + grok-4.7),只改 `touches` 列的目錄裡的 `App.svelte`(含第 8 條的 `<style>`)與 `teach-session.ts`。
- `@manual`:前端,技術顧問判。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 重活(vitest 完整、cucumber、渲染測試)先跟協調者拿位子:`VITEST_MAX_WORKERS=1`,cucumber 一律 `--tags`。
