---
id: T69
deps: [T68]
touches: [apps/teach-card/src/teach-session.ts, apps/teach-card/src/App.svelte, apps/teach-card/src/AskPanel.svelte]
cpu: heavy
budget_usd: 3
status: todo
owner: worker-grok
must_catch:
  - 回答顯示在卡片上面或蓋掉卡片內容 「顯示在卡下面、卡本身不變」那條必須紅(卡片區塊的 outerHTML 前後一樣)
  - 建議 continue 卻亮了別的按鈕、或亮了又自己按下去 亮按鈕那三條必須紅(只亮不按;卡沒換)
  - 亮的方式是改按鈕大小或位置(推動版面) 版面那條必須紅(按鈕矩形差 0)
  - 亮的顏色或樣式寫死(style 屬性、innerHTML、不是 var(--hud-*)) 樣式那條必須紅
  - 點追問沒有當下一個問題送出,或送出的是別的字 追問那條必須紅(側車收到的 question 逐字一樣)
  - 送出中沒有「問中」狀態、可以連點送出兩次 送出中那條必須紅(側車收到 1 次)
  - 換卡或關窗後舊問答還在畫面上 換卡那條必須紅
  - 看不懂、沒模型、到上限三種訊息畫面上沒字、或字樣一樣分不出來 三種訊息那條必須紅;而且任何一種都不能亮按鈕
  - 沒模型時「下一個」按鈕不能用 沒模型那條必須紅(按鈕仍可按)
  - 本機模型的回答沒標「暫定」 暫定那條必須紅
  - 問答區塊出現橫向捲動,或在 360 × 400 最小視窗蓋住黏底按鈕 版面那條必須紅(捲到底按鈕位置也要量,T50)
  - 輸入框拿掉焦點後鍵盤快捷鍵(下一個等)失效或在輸入框打字時觸發快捷鍵 鍵盤那條必須紅
  - 等待回答時按「下一個」拿到 busy,或換卡之後晚到的回答出現在新卡 送出中那條必須紅
  - back 且 highlight 是 null 時沒有「AI 建議先複習基礎。」那行,或四種錯誤字樣與定案不同 訊息那條必須紅
  - 實作動到 touches 以外的檔 不動的地方那條 diff 必須有輸出
---

# 工單 T69:07-teach-card phase-6(下半)——「問 AI」的畫面

> 狀態:起草 2026-11-25(協調者 -91),依技術顧問 2026-11-25 的交代。**依賴 T68**(協定與 `ask` 回應形狀),T68 合併後才派。決策 ADR-086、規格 `features/07-teach-card/phase-6.feature`(分支 `ask-ai-spec` `fc76c90`)。**待顧問審。**
> 實作:worker(opencode + grok-4.7);紅測試、渲染測試、步驟定義:測試 agent;驗收:驗收 agent;`@manual` 觀感:前端量、技術顧問判。
> 規格:UI/Tauri 負責人可補樣式細節,顧問定。

## 範圍

教學卡視窗加一塊「問 AI」。只做畫面與視窗端的狀態,**不碰側車與核心**(那是 T68)。

1. **輸入**:卡片下面(內文之後、黏底按鈕之前,在捲動區裡)一個單行輸入框加「問」按鈕(輸入框 placeholder:「問這張卡…」)。Enter 送出;輸入中的 Enter 與快捷鍵不要互相搶(輸入框有焦點時,下一個等單鍵快捷鍵不觸發)。空白不送。
2. **送出**:呼叫 T68 的 `teach.ask`(`ReviewClient.teachAsk(question)`,T68 加),側車馬上回 `{ asking: true }`,視窗用 `teach.ask.poll`(`ReviewClient.teachAskPoll()`)拿結果,**輪詢間隔照 deepen 在視窗端的做法**(`teach-session.ts` 的 teachPoll 那一段)。送出中顯示「問中…」、輸入框與「問」按鈕停用,不可連送。等待時其他按鈕照舊(AI 沒回之前還能按「下一個」;按了就換卡、清掉問答、**丟掉晚到的回答**)。
3. **回答**:顯示在卡片**下面**(`.ask-panel`,在捲動區裡,跟內文一起捲),卡片本身一個字不動。本機模型的回答加「暫定」字樣(`provisional`)。
4. **亮按鈕**:照回應的 `highlight`:`next`→亮「下一個」、`deepen`→亮「深入這個」、`{prereq}`→先備提示裡那一張亮。**只亮,不按、不換卡、不呼叫別的動作**。亮的做法:加一個 class,只改顏色(`var(--hud-*)`)或框線顏色,**不改大小、位置、字重**(不推動版面,T45 的規則)。換卡、按任何按鈕、再問一次,亮就收掉。`highlight: null` 不亮。
5. **追問**:`followups` 每個一顆按鈕(最多 3 個),點了就**當下一個問題逐字送出**,等於把那段字放進輸入框再按「問」。沒有追問就不顯示那一排。
6. **訊息**:`error` 三種(`unreadable`、`no-model`、`budget`)加 `failed` 各一句固定字樣,放在回答的位置,顏色用 `var(--hud-*)` 的錯誤色。`no-model` 與 `budget` 時「下一個」照常能按。字樣:
   - `unreadable`:「這次的回答讀不懂,請再問一次。」
   - `no-model`:「現在沒有可用的 AI,卡片照常能用。」
   - `budget`:「今天的 AI 額度用完了,明天再問。」
   - `failed`:「沒問成,請再問一次。」
   - 暫定標示:「暫定」。
   (顧問 2026-11-25 定案。)
   - `suggestion` 是 `back` 而且 `highlight` 是 `null` 時,回答下面加一行固定字樣「AI 建議先複習基礎。」(場景「the answer says the AI suggests reviewing the basics」靠這行,不靠 AI 自己寫)。
7. **清掉的時機**:換卡(任何 `teach.*` 回應的 `card` 與上一張不同)、關窗。問答只在視窗記憶體裡,不寫任何東西。
8. **畫面狀態**:沒有 AI 回答之前,問答區塊是空的、不佔高度(只有輸入那一列)。「這個類別學完了」與生成中畫面**不顯示**輸入。

## 紅測試(測試 agent 寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| 場景 | `phase-6.feature` 裡畫面類的句子(顯示、亮、追問可點、換卡清掉) | 步驟檔的畫面段,真 Chrome + 真 `createTeachSession`;`openApp`(`packages/ui-shared/src/hud/render-test-support.ts`)加假的 client(含「慢回答」) | 紅 |
| 只亮不按 | 三種建議各亮對的那顆;側車收到的動作序列裡沒有 `teach.next`/`teach.deepen` | 假 client 記呼叫 | 紅 |
| 版面 | 亮與取消亮、回答出現與消失,每顆按鈕的矩形差 0;360 × 400 與每一個縮放層沒有橫向捲動;捲到底按鈕位置(T47、T49、T50 的量法)不變 | 渲染測試,照 t45 | 紅 |
| 樣式 | 不用 style 屬性、不用 innerHTML 塞樣式、顏色只用 `var(--hud-*)`;console 0 則(排除 `[vite]`) | 靜態 + 渲染 | 紅 |
| 送出中 | 「問中…」顯示、連點只送一次、送出中按「下一個」換卡、晚到的回答被丟掉 | 慢 client(可控制 resolve 時機) | 紅 |
| 鍵盤 | 輸入框有焦點時單鍵快捷鍵不觸發;Enter 送出;空白不送 | 渲染測試 | 紅 |
| 訊息 | 四種 `error` 各自字樣、不亮、「下一個」可按 | 假 client 回各種 error | 紅 |
| 暫定 | `provisional: true` 顯示「暫定」 | 假 client | 紅 |
| 不退步 | 07 phase-1 到 phase-5 的渲染與版面測試全綠(T45、T47、T49、T50、T67) | 既有 | 綠 |

測試一律用假的 client,**不准 live、不碰真側車的 AI 呼叫**(T68 守那一邊)。

## 驗收條件

1. `NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@teach-card and @phase-6 and not @manual" --format summary` → 12 個自動場景全過(T68 與 T69 合起來)。
2. `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card packages/ui-shared` 全綠。
3. 07 phase-1 到 phase-5 的既有測試與場景全綠。
4. must_catch 每一條:在驗收 worktree 做那個改壞,對應的測試紅,記失敗訊息原文,還原再綠。
5. `@manual`(phase-6 第 13 條,前端量、顧問判):問兩個問題之後,回答與追問跟卡片一起捲、不蓋住按鈕;亮的按鈕看得出來但不吵;最小視窗與每個縮放層都看得清楚。證據放 `docs/reviews/T69-manual-<日期>.md`。
6. `git diff --stat <基底>...<分支>` 只有 touches 列的檔加測試檔。`.feature` 0 行。

## 受保護的檔

- 任何 `.feature`、`contracts/`、`prompts/`。
- `packages/core/`(側車與核心是 T68)、`packages/ui-shared/src/hud/`(`hud.css`、HUD 元件)、`apps/test-card/`。
- `apps/desktop/src/webview/review-client.ts`(`teachAsk()` 是 T68 加的,這張只用它)。

## 怎麼跑

```bash
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@teach-card and @phase-6 and not @manual" --format summary
VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card packages/ui-shared
npx tsc --noEmit
npm run check:steps
npm run boundaries
```

- 環境:`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`。cucumber 與帶 Chrome 的 vitest 是重活,先跟協調者拿位子(i9)。
- 不跑完整 cucumber、不跑 `npm run check:all`、不跑變異、不跑 `tauri dev`。

## 不在範圍

- 側車、協定、prompt、golden、路由(T68)。
- 問答存檔、跨卡討論、自動跳卡(ADR-086)。
- 週目標、今日負擔提示(phase-5)的改動。
- 語音輸入、Markdown 渲染 AI 回答(這版回答是純文字,不跑 `renderMarkdown`;要渲染另開票)。

## 顧問已定(2026-11-25)

輸入框不收合;回答用純文字。無待定項。

## 預算

`budget_usd: 3`。grok 不設花費上限,只記錄。LLM 真呼叫:0。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是 T68 合併後的 main 加 T69 紅測試。同一時間只給一個 agent。派工歸協調者。
落點:`apps/teach-card/src/`。R2:跟 T68 的 touches 不相交,但 T68 先合,T69 後派。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
