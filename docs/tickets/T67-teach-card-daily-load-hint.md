---
id: T67
deps: []
touches: [packages/core/src/session/summary.ts, packages/core/src/session/engine.ts, packages/core/src/session/teach.ts, packages/core/src/session/handler.ts, packages/core/src/session/protocol.ts, packages/core/src/teach/deck.ts, apps/teach-card/src/teach-session.ts, apps/teach-card/src/App.svelte]
cpu: heavy
budget_usd: 3
status: todo
owner: worker-grok
must_catch:
  - 今天學了幾張改數 log.jsonl 的 learned 事件或 weekly.json 只數今天那條必須紅(佈置只寫 reviews.json)
  - 今天學了幾張不看日期(昨天學的也算) 只數今天那條必須紅
  - 今天學了幾張用機器的日期或 UTC 日期,不是側車寫 learned_at 的那個今天 只數今天那條必須紅(LC_REVIEW_TODAY 釘的日期跟機器日期不同)
  - 按下一個之後回應裡的數字還是舊的(先算數字再寫檔) 按下一個那條必須紅
  - 換類別之後數字沒更新 換類別那條必須紅
  - 數字是視窗自己記的(關掉再開就歸零或不對) 關掉再開那條必須紅
  - 明天的估計只在開啟時算一次 學一張估計加一那條必須紅
  - 算 load 時建出當日快取檔(例如為了算數字叫 openDay) 唯讀那條必須紅(快取目錄前後一樣)
  - teach.load 之後畫面那張卡變了(或麵包屑變了) 唯讀那條必須紅
  - 明天的估計自己另算一份,不是考試卡小結的那個函式 同一個函式那條單元測試必須紅(mock 那個函式,兩邊都要經過它)
  - 明天的估計沒套每日上限 上限那條必須紅
  - learning/ 沒有卡、沒有 reviews.json 時出錯或顯示 NaN、undefined 空目錄那條必須紅
  - 考試卡小結的數字跟改之前不一樣 06 與 11 既有的小結測試必須紅
  - 提示出現或數字變了會推動按鈕或狀態字樣 版面那條渲染測試必須紅(按鈕矩形差 0)
  - 提示用 style 屬性或 innerHTML 塞樣式,或顏色不是 var(--hud-*) 樣式那條必須紅
  - 實作動到 touches 以外的檔 不動的地方那條 diff 必須有輸出
---

# 工單 T67:07-teach-card phase-5——今日負擔提示

> 狀態:起草 2026-10-27,依協調者 2026-10-27 的交代。顧問判 I4 盤點 G3:是真缺口,補,不從 I4 拿掉,不用問使用者(盤點第 6 節第 1 點)。決策 ADR-085(同一個分支上)。顧問 2026-10-27 審過、准:D1 甲(加唯讀條件)、D2 甲、D3 乙(見最後「顧問裁定」)。規格:UI/Tauri 負責人(代筆)。編號 T67:協調者配的。
> 實作:worker(opencode + grok-4.7);紅測試、步驟定義、渲染測試:測試 agent;驗收:驗收 agent;`@manual` 觀感:前端量、技術顧問判。
> 基底:main `175b837`(含 I4 盤點)。跟 T66 落點不相交,可以同時做。

## 為什麼有這張

- ADR-002:教學卡沒有每日上限,「只顯示『今天已學 N,明天約 M 題』」。07 FEATURE.md 的範圍也寫了「今日負擔」。
- 07 的 phase-1 到 phase-4 沒有一個認領它。`apps/teach-card/src` 裡找不到(我讀了 App.svelte 與 teach-session.ts:畫面只有標示列、內文、黏底的按鈕列與狀態字樣)。
- i4 驗收檔第 63 行的 `@manual` 要它。I4 盤點的 G3 發現,顧問判補成 07 phase-5(ADR-085)。

## 起草時查的(讀程式,沒有跑測試)

| 查了什麼 | 結果 |
|---|---|
| 考試卡的「明天預估」在哪算 | `packages/core/src/session/engine.ts` 的 summarizeDay:今天的名單(當日快取的 queue)數出「回退幾張」,`buildDueList(reviews, 明天)` 數出明天到期的張數,再交給 `summary.ts` 的 estimateTomorrow 套每日上限。側車的 `summary` 回應帶 `tomorrow`,考試卡畫面印「明天預估 N 張。」 |
| 只共用 estimateTomorrow 夠不夠 | **不夠**。estimateTomorrow 只做加法與上限,「明天到期幾張」「回退幾張」是 summarizeDay 自己數的。只共用 estimateTomorrow,教學卡還是要自己數那兩個數,等於兩份算法 |
| 側車寫 `learned_at` 用哪個「今天」 | `packages/core/src/session/teach.ts` 的 recordIds 用 `host.today()`,就是 handler 的 day():有 `LC_REVIEW_TODAY` 用它;沒有就是當地日期;考試卡今天開過一輪就固定成那一輪的日期 |
| 教學卡的回應長什麼樣 | 每個 `teach.*` 動作都回同一個 TeachView(buildView 每次重讀 `reviews.json`)。webview 讀回應很寬鬆,多一個欄位不會壞 |
| 學過的卡什麼時候到期 | 學過轉移(applyLearnedTransition)給 stage 1、`next_due` = 明天。所以多學一張,明天的估計就多 1(沒到上限時) |
| learning/ 空的時候 | 有類別、沒有卡:教學卡進「這個類別學完了」的畫面。沒有 `reviews.json`:readReviewsSnapshot 回空物件 |
| 週目標 | 08 phase-2(I5)的場景把它放在教學卡的**標題列**。這張只做**頁尾**,不碰標題列 |

## 規格

`features/07-teach-card/phase-5.feature`(同一個分支,`@i4 @teach-card @phase-5`)。8 條自動場景加 1 條 `@manual`。顧問要釘的行為(ADR-085):

1. **今天學了幾張** = `state/reviews.json` 裡 `learned_at` 等於今天的紀錄數。
   - 「今天」= 側車寫 `learned_at` 用的同一個值(handler 的 day())。不自己用 `new Date()`,不用 UTC。契約 §1:`IsoDate` 是當地日期。
   - 不數 `log.jsonl` 的 learned 事件,不用 `weekly.json`。
2. 按「下一個」或「換類別」之後,**同一次回應**就帶新的數字。
3. **明天大約幾張** = 考試卡小結的「明天預估」,用**同一個函式**算(含每日上限)。同一個 learning 目錄狀態下,兩張卡是同一個數。到上限時顯示上限那個數(考試卡另外寫的「另 X 張順延」,教學卡不寫)。
4. learning/ 沒有卡、沒有複習紀錄時,兩個數都是 0,不出錯。

## 要的結果

### 1. 共用的估計函式(`packages/core/src/session/summary.ts`,純函式)

把 summarizeDay 裡「明天預估」那一段抽出來,兩邊都叫它:

```ts
export function estimateTomorrowFrom(input: {
  reviews: Readonly<Record<string, Review>>;
  today: IsoDate;
  /** 今天考試卡的名單(當日快取的 queue 的卡 id);今天還沒有快取就是 [] */
  queueCards: readonly string[];
  dailyCap: number;
}): EstimateResult;
```

- 內容就是現在 summarizeDay 的算法:tallyToday 數回退、`buildDueList(reviews, 明天).length`、estimateTomorrow 套上限。**數字一個都不變**。
- summarizeDay 改成叫它。06、11 既有的小結測試照舊全綠。
- 名字與位置是紅測試要 import 的,照這裡寫;要改先回報。

### 2. 今天學了幾張(`packages/core/src/teach/deck.ts`,純函式)

```ts
export function countLearnedOn(reviews: Readonly<Record<string, Review>>, day: IsoDate): number;
```

`learned_at === day` 的紀錄數。

### 3. 側車把兩個數帶給視窗

`packages/core/src/session/teach.ts` 的 TeachView 多一個欄位:

```ts
load: { learnedToday: number; dueTomorrow: number };
```

- buildView 每次都算(它本來就每次重讀 `reviews.json`)。寫完學過紀錄之後才組畫面,所以按「下一個」「換類別」的那次回應就是新的數。
- 算 dueTomorrow 要的 `queueCards` 與 `dailyCap` 由 handler 給(TeachHost 多一個回呼)。建議:今天的考試卡 session 開著,就用它的名單與它的 dailyCap(小結用的就是這兩個);沒開著,讀磁碟上今天的快取,沒有就 `[]`,上限讀 `config/settings.yaml`。
- 生成中(`teach.deepen`、`teach.poll`)的回應也帶,數字照算。
- **算 load 只讀**(不管是哪個動作順帶算的,還是 `teach.load`):
  - 不寫 `reviews.json`、不寫 `log.jsonl`。
  - 不建、也不改當日 session 快取。今天沒有快取(或讀到 missing、invalid、stale)就當 `queueCards = []`,**不能為了算數字叫 openDay**,也不叫 warnInvalidSessionCache(它會寫一筆 warning 進 `log.jsonl`)。`packages/core/src/session/cache.ts` 的 readSessionCache 本來就只讀,起草時讀過。
- **新的唯讀動作 `teach.load`**(D1 甲):參數 `{}`,回 `{ learnedToday, dueTomorrow }`。除了上面兩條,也**不改畫面那張卡與麵包屑**(叫完之後再叫任何 `teach.*`,結果跟沒叫過一樣)。協定的方法表與 schema 在 `packages/core/src/session/protocol.ts`。

### 4. 視窗顯示(`apps/teach-card/src/teach-session.ts`、`App.svelte`)

- teach-session 從回應讀 `load`,放進 view。讀不到(舊側車、欄位壞掉)就不顯示提示,不丟錯。
- 視窗**拿到焦點時**叫一次 `teach.load`,更新那一行。側車 busy、逾時或回錯誤:**安靜保留舊數字**,不出錯誤畫面、不改 view 的其他欄位、不顯示錯誤字樣。
- App.svelte 在頁尾顯示一行:黏底那一塊(`.dock`)的最下面,狀態字樣那一格(`.status-slot`)底下,固定一行高(D2 甲)。字樣「今天已學 N 張,明天約 M 張」(D3 乙)。
- 顯示的畫面:卡片畫面與「這個類別學完了」畫面都要有。載入中、出錯、類別清單不顯示。
- 樣式:不用 `style` 屬性、不用 `innerHTML` 塞樣式;顏色只用 `var(--hud-*)`。不改 `hud.css` 與 HUD 元件。

## D:顧問已判(2026-10-27)

### D1 · 數字怎麼送到視窗

- **甲(建議;顧問選這個,加唯讀條件,見「要的結果」第 3、4 節)**:既有的每個 `teach.*` 回應多帶 `load`,**再加一個唯讀的 `teach.load`**(回 `{ learnedToday, dueTomorrow }`,不動卡、不寫檔)。教學卡視窗重新拿到焦點時叫它一次。
  - 理由:另一個視窗的考試卡答完一輪,明天的估計就變了。只靠既有回應的話,教學卡要等下一次按按鈕才更新,中間兩張卡的數字不一樣。現在沒有「只看不動」的教學卡動作(`teach.open` 會把畫面換回第一張沒學的),所以要新的。
  - 代價:協定多一個方法(`protocol.ts` 的方法表、schema,`protocol.vectors.json` 的向量由測試 agent 補)。
- 乙:只在既有回應多帶欄位,不加方法。範圍小;考試卡那邊答完之後,教學卡的估計要等下一次按按鈕才會變。`@manual` 那條要寫明這件事。

### D2 · 提示放哪

- **甲(建議;顧問選這個)**:黏底那一塊(`.dock`)的最下面,狀態字樣那一格(`.status-slot`)底下,固定一行高。
  - 理由:i4 第 67 行寫 footer;T45 定的規則是「字樣出現、收掉、換種類都不推動按鈕」,固定高度的一行照同一個規則;標題列留給 08 phase-2 的週目標。
  - 代價:黏底那一塊高一行。T45 量過的「字樣不推動按鈕」、T47、T49、T50 量過的「捲到底按鈕位置」與「黏底塊不透明、不留縫」都要在紅測試裡重量(顧問裁定)。
- 乙:放進標示列(類別、原始/生成、Level 那一排)。不改黏底塊的高度;但標示列在縮放層裡會跟著內容縮放,而且 08 phase-2 的週目標也要放在上面,會擠。

### D3 · 字樣

- 甲:照 ADR-002 原字「今天已學 N,明天約 M 題」。
- **乙(建議;顧問選這個)**:「今天已學 N 張,明天約 M 張」。
  - 理由:M 數的是**卡**(buildDueList 一張卡一筆;一張 stage 2 的卡要考兩題)。考試卡小結寫的是「明天預估 M 張」。兩張卡顯示同一個數,單位也一樣,才不會讓人以為是兩個數。
  - ADR-002 的字是決策的描述,不是畫面字樣;選乙不用改 ADR-002。

## 紅測試(測試 agent 寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| 場景 1–8 | phase-5.feature 的自動場景 | 新的步驟檔(例如 `features/steps/teach-card-phase5.steps.ts`):真側車子行程 + createTeachSession,同 07 phase-2 的做法;`LC_REVIEW_TODAY` 釘一個**跟機器日期不同**的日子 | 紅 |
| 共用 | 兩邊都經過 estimateTomorrowFrom | vitest:`vi.mock` 那個模組,spy 計次;教學卡的回應與考試卡的 `summary` 各叫一次都要經過它(T19 的「同一條路」量法) | 紅 |
| 純函式 | countLearnedOn、estimateTomorrowFrom | vitest:空、今天、昨天、上限邊界(剛好等於、多 1)、回退 | 紅 |
| 不退步 | 小結數字不變 | 06、11 既有的小結與 summarizeDay 測試 | 綠 |
| 版面 | 提示不推動按鈕 | 渲染測試(真 Chrome,`packages/ui-shared/src/hud/render-test-support.ts` 的 openApp,照 t45):數字變化前後、卡片畫面與學完畫面,每顆按鈕的矩形差 0;360 × 400 最小視窗不出現橫向捲動 | 紅 |
| 樣式 | 不用 style 屬性、顏色 var(--hud-*) | 靜態 + 渲染:console 0 則 | 紅 |
| 唯讀 | `teach.load` 與順帶算 load 都不寫東西、不動畫面 | 叫前叫後:畫面那張卡與麵包屑一樣;`reviews.json`、`log.jsonl` 的位元組一樣;**今天沒有快取時,快取目錄(`XDG_CACHE_HOME` 底下)叫完還是沒有當日快取檔**;快取壞掉時也不多一筆 warning | 紅 |
| 焦點 | 拿到焦點才重拿、出錯安靜 | teach-session 的單元測試:焦點事件送一次 `teach.load`;回 busy、逾時、錯誤時 view 的數字不變、state 不變成 error | 紅 |
| 版面重量 | T45、T47、T49、T50 的版面測試 | 黏底塊多一行之後重跑、需要的話更新預期值;每一處改了什麼、為什麼,寫進紅測試的 commit 說明(這是測試 agent 改既有測試,照 worker-acceptance 0.5 第 7 條) | 綠 → 依實作 |

- 共用的句子:「the person presses next」在 `features/steps/teach-card.steps.ts`(已經分派給 phase-2、phase-3),phase-5 照樣加一個分派。「the teach card is opened」08 phase-2 的 `@manual` 場景也用,現在沒有定義;phase-5 定義它,08 以後要用再分派。交件前跑 `npm run check:steps`。
- 場景「Learning a card raises tomorrow's estimate」:步驟要把 `config/settings.yaml` 的 `daily_cap` 設得**夠高**(明天到期的張數加 1 之後還碰不到上限),否則「多 1」不成立。步驟檔註解寫明這件事(顧問裁定)。上限那條另外由「Tomorrow's estimate stops at the daily cap」守。
- 測試一律用 mkdtemp 當 learning、`XDG_*`、`HOME`;**不准 live**。

## 驗收條件

1. `NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@teach-card and @phase-5 and not @manual" --format summary` → 8 個場景全過。
2. 07 的 phase-1 到 phase-4、06 phase-3、11 的既有測試與場景全綠(小結數字不變)。
3. 共用函式的 spy 測試、渲染測試、紅測試全綠。
4. must_catch 每一條:在驗收 worktree 做那個改壞,對應的測試紅,記失敗訊息原文,還原再綠。
5. `@manual`(前端量、技術顧問判):卡片畫面與學完畫面都有那一行,字樣是「今天已學 N 張,明天約 M 張」;另一個視窗的考試卡答完一輪、切回教學卡(拿到焦點)之後,明天的估計跟考試卡小結一樣;數字變的時候按鈕與狀態字樣不動(T45 的量法,矩形差 0);最小視窗 360 × 400、每一級縮放都看得清楚;console 0 則。做法同 T45、T47 的 `@manual`(真視窗、暫存 `HOME` / `XDG_*`、不碰使用者的桌面)。
6. `git diff --stat i4-base...<分支>` 只有 touches 列的檔加測試檔。`.feature` 0 行(規格在派工前就寫好了)。

## 受保護的檔

- 任何 `.feature`、`contracts/`。
- `packages/ui-shared/src/hud/`(`hud.css`、HUD 元件)、`apps/test-card/`(考試卡畫面不改;它的數字經共用函式算,結果不變)。
- `config/` 的格式。`state/` 不新增任何檔。

## 怎麼跑

```bash
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@teach-card and @phase-5 and not @manual" --format summary
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@teach-card and not @manual" --format summary
VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/session packages/core/src/teach apps/teach-card
npm run check:steps
npm run boundaries
```

- 環境:`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`。cucumber 與帶 Chrome 的 vitest 是重活,先跟協調者拿位子(i9)。
- 不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev`。

## 不在範圍

- 週目標的顯示(08 phase-2,I5,標題列)。
- 考試卡畫面的任何改動。
- 「今天學太多了」之類的警告或上限(ADR-002:沒有每日上限,只提示)。
- prompts、golden(這張沒有 LLM 呼叫)。

## 顧問裁定(2026-10-27)

經協調者轉來,兩張(T66、T67)都准。T67 的部分:

1. **D1 甲,加條件**:`teach.load` 只讀——不寫 `reviews.json`、`log.jsonl`;不建也不改當日 session 快取(沒有快取就當 `[]`,不能為了算數字叫 openDay);不改畫面那張卡與麵包屑。webview 在視窗拿到焦點時叫;側車 busy 或出錯就安靜保留舊數字,不出錯誤畫面。must_catch 加兩條(算 load 時建出當日快取檔、`teach.load` 之後畫面那張卡變了)。
2. **D2 甲**:`.dock` 最下面固定一行。T45、T47、T49、T50 的版面測試照工單在紅測試裡重量。
3. **D3 乙**:「今天已學 N 張,明天約 M 張」。
4. 場景「Learning a card raises tomorrow's estimate」:步驟把每日上限設得夠高、確定沒碰上限,步驟檔註解寫明。
5. `phase-5.feature`、ADR-085、07 FEATURE/NEXT、roadmap 照這一版。

## 預算

`budget_usd: 3`。grok 不設花費上限,只記錄。LLM 真呼叫:0。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
落點:`packages/core/src/session/`、`packages/core/src/teach/`、`apps/teach-card/src/`。跟 T66(只有 `features/steps/`、`features/support/` 與一支渲染測試)不重疊。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
