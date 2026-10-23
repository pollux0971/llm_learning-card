---
id: T43
deps: [T40, T42]
touches: [packages/core/src/ingest/deepen.ts, packages/core/src/ingest/children.ts, packages/core/src/ingest/questions.ts, packages/core/src/ingest/generate-cards.ts, packages/core/src/teach/deck.ts, packages/core/src/session/teach.ts, packages/core/src/session/teach-deepen.ts, packages/core/src/session/handler.ts, packages/core/src/session/protocol.ts, packages/core/src/llm/credentials.ts, scripts/review-sidecar.ts, scripts/boundaries.allow.json, apps/desktop/src/webview/review-client.ts, apps/teach-card/src/, apps/teach-card/dev/]
cpu: heavy
budget_usd: 8
status: todo
owner: worker-grok
must_catch:
  - 已經有子卡還打模型、或重生一批蓋掉既有子卡:Existing children are reused 必須紅(假網路的請求紀錄要是 0 行,既有子卡檔雜湊前後相同)
  - 新卡不是父卡 level 加 1、parent 不是這張、source 不是 llm、在線時 provisional 不是 false、張數不在 1 到 3:Children are generated when there are none 必須紅(看磁碟,不看畫面)
  - 新卡沒有考題檔、或考題檔不過 validateQuestionFile:必須紅
  - deps.json 沒加 父到子 的邊與子卡節點、或動到別的分類的圖:必須紅;那個分類沒有圖或圖壞了時,硬建一張只有這幾張卡的圖:必須紅
  - 一次深入裡有任何一個呼叫不是 task deepen(子卡照舊用 ingest.cards、考題照舊用 ingest.questions):必須紅(看 log.jsonl 每一筆 llm_call 的 task)
  - 離線走本機時新卡沒標 provisional、或畫面上沒有 待審核:Offline generation falls back and is marked 必須紅
  - 沒有模型時換掉目前的卡、進出錯畫面、或寫了 cards/ questions/ graph/ state/reviews.json 任何一個:No model at all is reported plainly 必須紅
  - 取消之後還寫了 cards/ questions/ graph/ state/reviews.json、記了 deepened,或又發了新的呼叫:Cancelling writes nothing 必須紅
  - 取消時把已經送出的那一個呼叫中斷、它的 llm_call 沒進帳本:必須紅(ADR-050,帳只能多不能少)
  - 取消後馬上再按深入,舊工作手上那一個呼叫回來之後寫了檔、或改到新工作的 poll 狀態或結果(舊工作只准記帳):必須紅
  - 字數超過上限不重試、重試超過 3 次、失敗 3 次的那張被寫進去、或因為一張失敗整批不寫:Generated cards obey the same word limit 必須紅
  - 先寫卡檔再寫考題檔(考題檔寫失敗時卡檔已經在磁碟上):必須紅
  - 最後一張子卡按下一個沒有把父卡一起記成學過、子卡與父卡分兩次寫、或之後顯示的不是父卡之後那張:Next within a set of children 必須紅
  - 回上一層把子卡記成學過、或回到的不是父卡:回上一層的自動測試必須紅
  - 最深一層(level 4)按深入還打模型或寫檔:There is a floor to how deep it goes 必須紅
  - 一個請求做完整段生成(握著側車直到生成結束):生成中考試卡的 start 與 next 要馬上拿到回應,等到生成結束才回就必須紅
  - 生成中三個主按鈕沒停用、沒有取消、或取消之後畫面上不是原本那張:視窗測試必須紅
  - 輪詢自己判斷 busy、或 teach-session.ts 出現 setTimeout、sleep、now:T40 的靜態測試與一層重試測試必須紅
  - 主流程的下一個或剩幾張把 level 2 以上的卡算進去:必須紅
  - 先備提示列出麵包屑上的父卡:必須紅
  - 側車讀到 stdin 結束時還在等生成的呼叫、或之後寫了檔:必須紅
  - 單獨執行按深入打到真的網路(沒開假 router):standalone 測試必須紅
  - 06、07 phase-1 與 phase-2、10、14、I2、I3 的既有場景或測試任一變紅,或任何 .feature 被改:不退步必須紅
  - 改了 packages/core/prompts/ 底下任何檔:驗收的 git diff 檢查必須抓到(CLAUDE.md 硬規則 4,這張不跑 golden run)
---

# 工單 T43:07-teach-card phase-3——深入這個

> 狀態:顧問審過 2026-10-23(D1–D9 照建議;補三處:touches 加 `scripts/boundaries.allow.json`、舊工作不得碰新工作、真的深入前先查今日花費)。規格:UI/Tauri 負責人。編號 T43:協調者配。
> 決定的記錄:ADR-079(refine ADR-075、ADR-077;號碼協調者配),跟這張同一批合。
> 實作:worker(opencode + grok-4.7);紅測試、步驟定義、協定向量、cucumber 用的假網路:測試 agent;驗收:驗收 agent;觀感(`@manual`):前端,技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 依據:[phase-3.feature](../../features/07-teach-card/phase-3.feature)、[FEATURE.md](../../features/07-teach-card/FEATURE.md)、[NEXT.md](../../features/07-teach-card/NEXT.md)(gate 全滿足:07 phase-2 done 2026-10-23、03 phase-2 done 2026-09-03、02 phase-2 done 2026-09-03);[00-design.md](../00-design.md) §4.1、§4.3、§7;契約 §1、§2、§3、§7、§8、§10;ADR-004、006、032、039、050、075、077、078。
> 基底:main 4ba5d7a 或之後。
> **LLM 真呼叫:0。** cucumber、vitest、單獨執行、`@manual` 一律假 router(換掉 `fetch`,router、adapter、帳本照跑真的)。

## 為什麼有這張

phase-3 的場景:有子卡就直接用(不打模型、標出從哪張來);沒有就生 1 到 3 張下一層的卡(在線用雲端;離線用本機、標 provisional、畫面看得到);都沒有就說現在沒辦法;生成中看得到、可以取消、取消不寫檔;字數照 ingest 的規則重試、失敗三次的那張略過;可以回上一層;在一組子卡裡按下一個;有最深的一層。

現在的狀況:

- 教學卡只有「下一個」「換類別」兩顆按鈕,沒有深入。core 沒有深入的函式。
- 生子卡只有 ingest 那一份:`packages/core/src/ingest/children.ts` 第 132 行用 task `ingest.cards`,沒有字數重試,用 `writeFileSync` 直接寫。

有三件事決定了這張的形狀:

1. **Rust 一次只收一個請求。** `apps/desktop/src-tauri/src/review_sidecar.rs` 第 219 行用 `try_lock`,拿不到就回 `busy`;一個請求 180 秒沒回應就收掉側車(第 18 行 `REQUEST_TIMEOUT`)。
   一次深入最多 13 個呼叫(見「預算」),雲端每個呼叫的逾時是 60 秒(`packages/core/src/llm/router.ts` 第 38 行)。
   所以如果一個請求做完整段生成,會出三個問題:可能超過 180 秒被收掉;考試卡整段都拿到 `busy`;「取消」也拿到 `busy`,送不進去。
2. **側車的迴圈一次處理一行**(`scripts/review-sidecar.ts` 第 144–147 行),但 Node 可以讓一個工作在背景跑、同時回下一行。所以生成可以在背景跑,請求本身馬上回。
3. **`ingest.questions` 只走雲端**(契約 §7 路由表)。照舊用它出考題的話,離線深入生不出考題檔。
   而一張學過、卻沒有考題檔的卡,隔天考試卡會壞掉:`packages/core/src/session/io.ts` 第 133 行的 `loadQuestionFile` 丟錯,handler 的 `next` 回 `internal`,那張卡每天都過不去。

## 形狀

### 1. 側車多四個動作(Rust 不改)

同一支 `scripts/review-sidecar.ts`、同一個 Rust 的 `review` command。Rust 只看信封,方法名只驗是字串(ADR-077),不用改。

| 動作 | 參數 | 做什麼 | 回什麼 |
|---|---|---|---|
| `teach.deepen` | `{}` | 對**目前顯示的那張**深入。有子卡:推一層麵包屑、顯示第一張子卡(不打模型)。最深一層:回 `deepen-floor`。沒有子卡:在背景開一個生成工作,**馬上回** | 有子卡:新的畫面;要生成:目前畫面加 `generating: true` |
| `teach.poll` | `{}` | 看生成工作的狀態,**馬上回** | 還在跑:`generating: true`;成功:新的畫面(第一張新卡),只回一次;失敗:錯誤種類,只回一次;沒有工作:目前畫面 |
| `teach.cancel` | `{}` | 取消生成工作(規則見第 4 節) | 目前畫面(原本那張);工作已經寫完才收到取消:寫完之後的畫面 |
| `teach.back` | `{}` | 回上一層:顯示這組子卡的父卡,丟掉這一層麵包屑。目前這張子卡**不**記學過 | 新的畫面 |

- 照 ADR-075 第 3 點,這四個動作都不收路徑、不收卡 id;目前那張與麵包屑都記在側車裡。
- 不合狀態的請求回 `bad-request`、不讀不寫。例如:類別學完了還按深入、沒有麵包屑還按回上一層、生成中送 `teach.next` / `teach.switch` / `teach.prereq` / `teach.back`。
- `teach.open` 在生成中送來(視窗重新載入),就當成取消,再照舊開。
- 回給視窗的畫面(`TeachView`)多三個欄位:
  - `from: { id, title } | null`:麵包屑最上層的父卡;
  - `canBack: boolean`;
  - `generating: boolean`。

### 2. 生成(02 的函式,新檔 `packages/core/src/ingest/deepen.ts`)

FEATURE.md 的「不在範圍」寫明卡片生成邏輯歸 02。所以生成與寫卡放 02,07 只用它。

- **一次深入的每一個呼叫都用 task `deepen`**(D3)。包括生子卡、字數重寫、出考題。
  - 這樣路由一致:在線走雲端;雲端失敗或當日預算用完走閘道、標 provisional(ADR-039);都不行丟 `NoModelError`。
  - 契約 §7 的 `LlmTask` 與路由表一格都不動。
- **重用,不另寫**:
  - 生子卡:`generateChildren`,加一個 task 參數,預設 `ingest.cards`,ingest 的行為不變。包含 T18 的 `already_covered`。
  - 字數重寫:照 `generate-cards.ts` 的做法(第 10 行 `MAX_ATTEMPTS = 3`,用 `regenerate` 模板)。
    把那段抽成可共用的函式,ingest 照舊呼叫它,深入用 task `deepen` 呼叫它。字數用同一條路算(`countWords(parseCardText(...).body)`)。
  - 出考題:`generateQuestions`,加一個 task 參數,預設 `ingest.questions`。
    深入呼叫時明講 `maxTokens: TASK_MAX_TOKENS['ingest.questions']`,跟 ingest 同一個上限;截斷重試照舊加倍。
    `deepen` 的表格值 2048 是給子卡用的。
- **不改 `packages/core/prompts/` 底下任何檔。** 用的是既有的 `children`、`regenerate`、`questions` 三個模板,都有 golden 基準。
  改了就要跑 golden run(CLAUDE.md 硬規則 4),那要真的花錢,不在這張。worker 覺得模板不夠用,寫進報告的「待協調」。
- **生成只在記憶體裡做**:回每張新卡的卡片內容、考題內容、`provisional`,以及被略過的張數。
  - 每一個呼叫之前都先問一次「要停了嗎」(由呼叫端給的函式)。要停就不再發呼叫。
- **一張一張判斷**:
  - 字數重試三次還超過 100 字 → 略過這張;
  - 這張的考題生不出來、或沒過 `validateQuestionFile` → 略過這張;
  - 其他張照留。
  - 張張都略過 → 回「沒有能用的卡」。
  - 生子卡那一個呼叫本身丟 `NoModelError` → 回「沒有模型」。
- **`provisional`**:這張卡用到的任何一個呼叫(子卡、重寫、考題)回 `provisional: true`,這張就是 `true`。
- **frontmatter**:
  - `id` 用 `nextCardIds`;
  - `category` 同父卡;`title` 用模型給的;
  - `level` = 父卡 + 1;`source: llm`;`created` = 側車的今天(跟 session 同一個來源,ADR-077 D2 c);
  - `parent` = 父卡;`prereqs: [父卡]`(D6);
  - `provisional` 見上;`stale: false`、`source_missing: false`。

### 3. 寫入(提交)

生成跑完、而且沒被取消,才寫。整段寫入是**同步的一段**(中間沒有 `await`),所以側車在這段時間不會處理別的請求、也看不到寫一半的狀態。

1. 先確認這幾張的卡檔與考題檔**都不存在**。有一個存在(例如終端機同時在 ingest 同一個分類、撞號)→ 整批不寫,回 `deepen-failed`。
2. 寫**考題檔**(`questions/<id>.yaml`),再寫**卡檔**(`cards/<分類>/<id>.md`)。
   - 都用 01 的 `writeFileAtomic`。
   - 卡檔的內容格式跟 `children.ts` 的 `writeCardFile` 一字不差:把組字串的那段抽成共用函式,ingest 照用。
   - 寫卡檔之前用 `validateCard` 再檢查一次 100 字(硬規則 3)。
   - **順序的理由**:中途停掉時,留下沒有卡的考題檔無害;留下沒有考題檔的卡,學過之後隔天考試卡就壞(上面第 3 件事)。
3. 更新 `graph/deps.json`:這個分類的圖加子卡節點與 `[父卡, 子卡]` 的邊,用 `writeCategoryGraph`(§11b 的原子寫入)。
   - 讀不到這個分類的圖(檔不在、沒有這個分類、檔壞了;`readCategoryGraph` 丟錯)→ 不建新圖、不動檔,記一筆 `warning`(建議重跑 ingest),卡照留(D6)。
   - 不動 `order-<分類>.json`:主流程本來就不排 level 2 以上(第 4 節)。
4. 記 `log.jsonl`(契約 §10):
   - `{ type: 'deepened', card: <父卡>, children: [<新卡 id>…], provisional, skipped }`;
   - 有略過的,另記一筆 `warning`,只寫父卡 id 與張數,不寫卡片內容。
5. **深入不寫 `state/reviews.json`**:誰記學過,看第 4 節的麵包屑規則。

### 4. 麵包屑、學過、取消

**麵包屑**(側車記):一層一筆 `{ 父卡, 子卡清單, 目前位置 }`。

- **子卡清單**:同分類裡 frontmatter 的 `parent` 是這張的卡,照 id 排。從第一張開始,學過的也照樣顯示。
- **在子卡上再深入**:再推一層。
- **下一個(在一組子卡裡)**:這張子卡記學過,換到下一張兄弟。
- **下一個(在最後一張子卡)**:這張子卡記學過,再對父卡做一次「下一個」(D4)。
  - 父卡記學過。
  - 父卡本身也在一組子卡裡:換到它的下一張兄弟。它也是那組的最後一張:再往上一層。
  - 回到主流程:照 phase-2 的下一個,顯示這個類別第一張沒學的。
  - 這一路要記學過的卡,**在同一次寫入裡一起寫**:照 ADR-077 D2 的 a,重讀、加上這幾筆、`saveReviewsIfUnchanged`、衝突重試一次,還不過回 `teach-record-changed`、一筆都不寫。
  - 考試卡基準照 D2 的 b。寫成功之後,每張各記一筆 `learned`。
- **回上一層**:見第 1 節。
- **換類別**:照 phase-2,目前顯示的這張記學過,麵包屑清空,父卡不記。
- **跟先備走**:照 phase-2,目前這張不記學過,麵包屑清空。
- **主流程只排 level 0、1**(D5,設計 §4.1「下一個:取下一張 level 0 或 level 1 的卡」)。類別清單的「剩幾張」也只算這兩層。level 2 以上只從深入進去。
  - `packages/core/src/session/teach.ts` 第 78 行的 `cardsInCategory` 現在不分 level。
  - 現在的 ingest 只產 0、1 兩層,所以既有資料的畫面不變。
- **先備提示不列麵包屑上的父卡**(D4):你剛從它下來,它是新卡的 `prereqs`。

**生成工作與取消**(D1、D2):

- 同一時間最多一個**沒被取消的**工作。
- 被取消的工作只會跑完手上那一個呼叫:那個呼叫照常記帳,之後不再發呼叫、不寫任何檔。
  - 所以取消後馬上再按深入,新的工作直接開始,不用等舊的。
- **每個工作帶一個編號**(側車開著就只增不減)。側車只記「目前的工作編號」。
  - `teach.poll` 只回目前那個編號的工作。
  - 舊編號的工作收尾時(它手上那一個呼叫回來、或丟錯),發現自己不是目前的工作:不寫檔、不改麵包屑與目前那張、不改 poll 的狀態或結果,只留下 router 已經記的帳。
  - 寫入前的檢查是「沒被取消,而且我還是目前的工作」,兩個條件都要。
- 工作自己的錯一律接住、變成 `teach.poll` 的錯誤種類,不往外丟。背景工作沒被接住的錯,會讓 Node 結束側車。
- 開工前照 `start` / `submit` 的做法:
  1. 重讀 `.env`(ADR-076);
  2. 拿 router(`ensureRouter`,失敗回 `root-mismatch` / `router-unavailable`);
  3. 查金鑰(缺了回 `credential-unavailable`,字樣見 D7)。
  - 生成用的 router 跟考試卡同一個(同一本帳、同一個 `LLM_DAILY_CAP_USD`)。
- 生成中,考試卡的請求照樣馬上處理。兩邊都碰 `log.jsonl`,都是 append 一整行(ADR-075 第 7 點),不會交錯。
- **側車讀到 stdin 結束**(關 app):把進行中的工作當成取消,馬上結束行程,不等手上的呼叫回來。

### 5. 錯誤種類與字樣(`packages/core/src/session/protocol.ts`,core 的軟約定)

| kind | 字樣 | 什麼時候 |
|---|---|---|
| `deepen-floor` | 這張已經是最深的一層了。 | 目前那張 level 4(契約 §1 `Level` 是 0..4) |
| `no-model` | 現在沒辦法產生新卡:連不上雲端,也沒有可用的本機模型。 | 生子卡的呼叫丟 `NoModelError`(包括預算用完、閘道也不通) |
| `deepen-failed` | 這次沒有產生出能用的卡。可以再按一次「深入這個」。 | 張張都被略過、模型回應不合格式、寫入前發現撞號 |
| `credential-unavailable`(既有) | 產生新卡要用的金鑰…(D7) | 開工前查金鑰,缺或被拒絕 |

- `REQUEST_METHODS` 多四個動作。
- 協定版本 `v` 不變:只加動作與種類,既有訊息的形狀不變。
- `protocol.vectors.json` 同一批由測試 agent 更新,TS 與 Rust 的測試都讀。

### 6. 視窗(`apps/teach-card/`,前端定,`@manual` 照這個量)

全部用 14 的 HUD 元件(ADR-071),視窗 360 × 480。

- **按鈕列**:「回上一層」(只在 `canBack` 時有)、「下一個」、「換類別」、「深入這個」,同一列,放不下就換行(現在的 `.controls` 就是 flex-wrap)。
- **標示列**:有 `from` 時,在類別、原始/生成、Level 後面加「來自:<父卡標題>」。
  - provisional 的卡照舊有「待審核」(App.svelte 第 83–85 行,phase-1 就有),不另做標示。
- **生成中**:
  - 卡片照舊顯示(還是原本那張);
  - 按鈕列上面一行「正在產生更深入的卡片,可能要等幾十秒。」,後面一顆「取消」;
  - 「下一個」「換類別」「深入這個」與「回上一層」停用;
  - 類別清單打不開。
  - 側車忙時照舊出現 T42 的等候字樣(共用 client 的 `onWait`)。
- **深入的錯誤**(上面第 5 節那幾種,和輪詢拿到的其他側車錯誤):
  - 卡片照舊顯示,在按鈕列上面一行字樣;
  - **不**進出錯畫面(場景要求 the current card stays on screen);
  - 下一個動作時收掉。
  - client 這一層的錯(`timeout`、`sidecar-exited` 這些)照 T40 的出錯畫面,不另做。
- **輪詢**:每 500 ms 送一次 `teach.poll`。
  - 間隔用注入的等待函式(`main.ts` 給)。`teach-session.ts` 裡不出現 `setTimeout`、`sleep`、`now`(T40 的靜態測試,`apps/teach-card/src/t40-busy.test.ts` 第 160–167 行,要照舊綠)。
  - `busy` 照舊只由共用 client 重試(ADR-078),輪詢不自己判斷。
- **按取消**:停止輪詢;手上那一個請求回來之後送 `teach.cancel`,照它回的畫面顯示。
- **單獨執行**(`npm run dev -w apps/teach-card`):
  - 側車環境加 `LC_REVIEW_FAKE_CLOUD=<apps/teach-card/dev/fake-cloud.mjs 的絕對路徑>`。
  - 這個檔是新的,由 worker 寫,照 `apps/test-card/dev/fake-cloud.mjs` 的做法,不 import `features/`;深入回兩張合格的子卡與考題,延遲約 1.5 秒,看得到生成中。
  - 現在 `apps/teach-card/dev/standalone.ts` 第 28–45 行只給假金鑰、沒有假網路:按深入會真的連到 provider。

## 顧問的裁決(2026-10-23,記在 ADR-079)

D1–D9 全部照下表的「定案」。另外補了三處:
- `touches` 加 `scripts/boundaries.allow.json`(D8 會動到它,R2 才看得到跟別張的重疊);
- `must_catch` 與第 4 節加「舊工作不得碰新工作」;
- 「預算」加「真的深入之前先查今日花費」。

| | 問題 | 定案 | 另一個做法與為什麼不選 |
|---|---|---|---|
| D1 | 生成怎麼跑才能取消 | **背景工作 + 輪詢**:`teach.deepen` 馬上回,`teach.poll` 看狀態,`teach.cancel` 取消。Rust 不改,每個請求都只握鎖幾毫秒,考試卡不受影響 | **一個請求做完整段**:取消送不進去(`try_lock` 回 `busy`);考試卡整段 `busy`;最壞超過 180 秒被收掉。**Rust 加取消的 command**:stdin 現在在鎖裡面(`review_sidecar.rs` 的 `Inner`),要改鎖的設計;超過「起、傳、收、關」要問使用者(ADR-075 第 2 點) |
| D2 | 場景的「Then the request is aborted」怎麼做 | **工作中止,不中斷 HTTP**:不再發新的呼叫、丟掉結果、不寫檔、視窗馬上回到原本那張;已經送出的那一個呼叫讓它跑完,照常記帳 | **真的中斷呼叫**(router 加 `opts.signal`,契約 §7 的函式簽章是軟約定,但要動 03 的 router):被中斷的呼叫 provider 可能照樣計費,我們卻拿不到用量,帳本少記,`LLM_DAILY_CAP_USD` 的煞車就低估了(ADR-050 的教訓) |
| D3 | 考題用哪個 task | **一次深入的每個呼叫都用 `deepen`**(子卡、重寫、考題),離線也能出考題、標 provisional | **考題照舊用 `ingest.questions`**:離線一律 `CLOUD_REQUIRED`,離線深入出不了考題。要嘛不能離線深入(違反場景),要嘛留下沒考題的卡,隔天考試卡壞掉(要另外改 11 的 session 讓它跳過缺考題的卡) |
| D4 | 父卡什麼時候記學過 | **離開最後一張子卡往前走時**(跟子卡在同一次寫入);先備提示不列麵包屑上的父卡。符合設計 §4.1「下一個、換類別才記學過」,衝突處理跟一般的下一個同一套 | **按深入、子卡顯示出來時就記父卡**:多一次寫入;它衝突時要在「子卡已經生好」的畫面上報「這一張還沒記成學過」,字樣講不通 |
| D5 | 主流程排不排 level 2 以上 | **不排**,剩幾張也不算(設計 §4.1)。level 2 以上只從深入進去 | **照現在全部排**:深入生出來、沒看完的子卡,會跑到主流程的尾巴,跟父卡分開出現 |
| D6 | 新卡的先備與圖 | **`prereqs: [父卡]` + 圖加 `[父卡, 子卡]`**,兩邊一致(`checkPrereqConsistency` 的定義)。分類沒有圖或圖壞了:不建、記 `warning`、卡照留 | **`prereqs: []`**(跟 ingest 的 level 1 一樣,等 deps 分析再填):圖有邊、frontmatter 沒有,兩邊不一致。**沒圖就建一張**:只有這幾張卡的圖,會被當成整個分類的圖(order 一重算,其他卡全掉) |
| D7 | 缺金鑰的字樣 | **深入用自己的兩句**:「產生新卡要用的金鑰沒有設定:{鍵名}。請在專案根目錄的 .env 加上。」與「產生新卡用的金鑰被拒絕:{鍵名}(可能過期或打錯)。請在專案根目錄的 .env 換一個。」`credentialMessage` 加一個用途參數,批改的兩句不變(`packages/core/src/llm/credentials.ts` 第 127、129 行) | **照用批改那兩句**:教學卡上出現「批改要用的金鑰」,講錯事 |
| D8 | 側車呼叫 02 的生成 | **新增一條 import 例外 11 → 02**(組合層,跟 11 → 04/05/07 同理由),協調者加進 `scripts/boundaries.allow.json` | **把生成搬進 11**:FEATURE.md 寫明卡片生成歸 02;`children.ts` 與 `questions.ts` 會多一份 |
| D9 | 要不要新 ADR | **要**:背景工作、取消的意思、task、麵包屑與學過的規則都是 ADR-075、ADR-077 沒講到的。顧問判完由前端起草 | 只寫在工單:下一張碰側車的工單找不到這些規則 |

- **協調者注意**:`scripts/boundaries.allow.json` 由協調者在同一批加 D8 那一條(worker 不改)。它是設定 JSON,不算只動文件:那一批要跑完整的 `check:test-ledger`,再 grep 釘例外條數的測試(2026-10-21 加兩條讓 t31-static 釘 21 條的測試紅、main 紅)。
- 沒有要問使用者的事:場景都在 `phase-3.feature` 裡,契約的硬約定不動,CLAUDE.md 不動。
- 已知限制(要顧問知道,不打算這張修):
  - 考試卡批改與深入同時在跑時,兩邊各自查日上限,最多多超一次呼叫(ADR-039 第 4 點的 b:帳本本來就偏低估)。
  - 側車被收掉時(關 app、Rust 逾時)手上那一個呼叫記不到帳,跟今天 Rust 逾時收掉側車一樣。

## 驗收條件

### 1. 自動驗收(cucumber,測試 agent 寫步驟)

`NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and @phase-3 and not @manual' --format summary`:0 undefined、全綠(`@llm` 那條也跑,用假網路)。

共同的接法:
- 暫存根(learning、`XDG_*`、`HOME` 同一個 mkdtemp)+ `vault.ts init`;
- 側車子行程(`features/support/review-sidecar-harness.ts` 的 `spawnSidecar`),啟動環境帶 `LC_REVIEW_FAKE_CLOUD`,指向測試 agent 寫的假網路;
- 假網路把每一個請求記一行,測試靠它數「打了幾次模型」;
- 「看磁碟」= `cards/`、`questions/`、`graph/`、`state/reviews.json` 的雜湊,與 `log.jsonl` 的事件。

| 場景 | 怎麼造 | 過的條件 |
|---|---|---|
| 背景:目前那張 level 1 | 分類裡有 level 0、1 的卡,`teach.open` 之後走到那張 level 1 | 畫面的卡是它 |
| Existing children are reused | 那張已有兩張子卡 | `teach.deepen` 回第一張(id 小的),`from` 是父卡;假網路 0 行;磁碟雜湊前後相同 |
| Children are generated when there are none(`@llm`) | 沒有子卡、在線 | 輪詢到成功;1 到 3 張新卡,level 2、`parent`、`source: llm`、`provisional: false`;各有過 `validateQuestionFile` 的考題檔;`deps.json` 有每張的節點與 `[父, 子]`;畫面是第一張新卡;每一筆 `llm_call` 的 task 是 `deepen` |
| Offline generation falls back and is marked | 雲端探測失敗、假閘道會回 | 新卡 `provisional: true`;`llm_call` 的 provider 是 `ollama`;畫面上的「待審核」由 vitest 的畫面測試量 |
| No model at all is reported plainly | 雲端探測失敗、閘道也不通 | 輪詢到 `no-model`;畫面還是原本那張;磁碟雜湊前後相同 |
| Generation is visible and cancellable(`@manual`) | — | 見第 4 節 |
| Cancelling writes nothing | 假網路把生子卡的回應扣住 | `teach.deepen` → `teach.cancel` 回原本那張;放行之後等工作結束:磁碟雜湊前後相同、沒有 `deepened`、`log.jsonl` 有那一個呼叫的 `llm_call`、假網路剛好 1 行 |
| Generated cards obey the same word limit | 兩張子卡;一張三次都超過 100 字 | 只寫一張;超字那張的重寫呼叫剛好 2 次;有一筆 `warning`(只有 id 與張數) |
| Going back up(`@manual`) | — | 見第 4 節;另有 vitest |
| Next within a set of children | 兩張子卡 | 下一個:第一張進 `reviews.json`、畫面是第二張;再下一個:第二張與父卡都進 `reviews.json`、畫面是主流程裡父卡之後那張 |
| There is a floor to how deep it goes | 目前那張 level 4 | 回 `deepen-floor`;假網路 0 行;磁碟雜湊前後相同 |

### 2. 另外的自動測試(vitest,測試 agent 寫)

- **02 的生成**:
  - 每個呼叫的 task 是 `deepen`,考題的 `maxTokens` 是 `ingest.questions` 的表格值;
  - 「要停了嗎」回真之後不再呼叫;
  - 一張考題失敗只略過那張;
  - provisional 的判斷(只有考題是本機的,那張也算);
  - ingest 呼叫 `generateChildren`、`generateQuestions` 不帶 task 時照舊用 `ingest.cards`、`ingest.questions`(不退步)。
- **寫入順序**:
  - 用注入的 io 讓考題檔寫失敗 → 磁碟上沒有任何新卡檔;
  - 卡檔與考題檔都經 `writeFileAtomic`;
  - 卡檔跟 `children.ts` 寫出來的同一份內容一字不差;
  - 撞號(目標卡檔已存在)→ 整批不寫、`deepen-failed`。
- **圖**:分類沒有圖、圖壞了 → `deps.json` 雜湊前後相同、有 `warning`、卡照留;別的分類的圖不動。
- **麵包屑**:
  - 兩層深入後在最後一張按下一個,一路往上記學過,在**同一次** `saveReviewsIfUnchanged` 裡;
  - 衝突兩次 → `teach-record-changed`、一筆都沒寫;
  - 回上一層不寫 `reviews.json`;
  - 換類別、跟先備走、`teach.open` 清空麵包屑;
  - 先備提示不列麵包屑上的父卡。
- **主流程**:有 level 2 的卡時,下一個與剩幾張都不算它們。
- **背景工作**:
  - 生成中考試卡的 `start`、`next` 馬上回;
  - 生成中 `teach.next` 回 `bad-request`;
  - 取消後馬上再深入,新的工作開始;舊工作手上那一個呼叫在新工作還在跑、與新工作已經寫完兩種時點回來,都不寫檔、不改麵包屑與目前那張、新工作的 `teach.poll` 照舊回新工作的狀態與結果,`log.jsonl` 只多那一個呼叫的 `llm_call`;
  - 工作裡丟錯不會讓側車結束;
  - 側車 stdin 結束時不等手上的呼叫,之後沒有寫檔。
- **協定向量**:四個新動作的合法與不合法請求各至少一列,三個新種類的字樣;TS 與 Rust 都讀。
- **視窗**:
  - 生成中三個主按鈕與回上一層停用、有取消;
  - 輪詢間隔 500 ms(假的等待函式);
  - 按取消送 `teach.cancel`、畫面回原本那張;
  - 深入的錯誤字樣顯示在卡片上面、不進出錯畫面;
  - `from` 有值時標示列有「來自:」;
  - provisional 的卡有「待審核」;
  - T40 的靜態測試照舊綠。
- **單獨執行**:側車環境有 `LC_REVIEW_FAKE_CLOUD`;按深入不打真網路;`standalone.json` 的 teach-card 指令照樣起得來。

### 3. 改壞證明(測試 agent 的丟棄式證明)

`must_catch` 每一條各做一次:改了哪裡、哪一條紅、紅的訊息原文、還原後綠。

- 看磁碟的那幾條,改壞法要是「畫面照樣對、磁碟不對」,證明測試看的是磁碟。
- 取消那兩條各做一次:取消後照樣寫;取消時中斷呼叫。

### 4. 觀感(`@manual`,前端做、技術顧問判)

做法同 T37、T40:
- 暫存根 + fixture:一張 level 1 沒有子卡、一張 level 0 有兩張子卡、一張 level 4;
- 假 router,深入的回應延遲幾秒;
- 隔離的顯示(Xvfb `:97` + 巢狀 GNOME Shell,PATH 放 ibus-daemon 替身),不碰使用者的桌面 `:1`。

- **Generation is visible and cancellable**:
  - 按深入 → 出現「正在產生更深入的卡片,可能要等幾十秒。」與「取消」,三個主按鈕停用;
  - 按取消 → 回到原本那張,磁碟沒變(雜湊);
  - 再按一次讓它跑完 → 出現第一張新卡,標示列有「來自:」。
- **Going back up**:在子卡上按「回上一層」→ 回到父卡;那張子卡不在 `reviews.json`。
- 有子卡的那張:深入馬上出子卡,沒有生成中那一行;level 4 那張:出現「這張已經是最深的一層了。」,卡片還在。
- 生成中切到考試卡作答:考試卡照常出題、批改,不出現等候字樣超過一秒。
- 長相:截圖(生成中、子卡、最深一層、沒有模型);四顆按鈕放不下時的換行;console 0 則;真的 learning/ 前後相同。

### 5. 不退步

- 06、07 phase-1 與 phase-2、10、14 的既有場景與測試全綠;cucumber `@teach-card and @phase-2 and not @manual`、`@i2 and not @manual`、`@i3 and not @manual`(拿位子)全綠。
- `cargo test`(`apps/desktop/src-tauri`)全綠:協定向量變了,Rust 那一側照讀。
- `git diff --stat <基底>..HEAD -- packages/core/prompts apps/desktop/src-tauri contracts`:沒有輸出。
- 任何 `.feature` 都不改。

## 要改的既有測試(測試 agent 改,開發 worker 不改)

由測試 agent 盤點。可能有:
- 釘住 `REQUEST_METHODS`、`ERROR_KINDS` 清單的斷言;
- 用完全相等比 `TeachView` 形狀的斷言(多了 `from`、`canBack`、`generating`);
- 主流程「剩幾張」用到 level 2 以上 fixture 的斷言。

每一條在 commit 說明寫為什麼改、新斷言是否一樣嚴。

## 受保護的測試檔(開發 worker 不改)

`*.test.ts`、`features/steps/**`、`features/support/**`、`apps/desktop/src-tauri/tests/**`、`packages/core/src/session/protocol.vectors.json`、`contracts/fixtures/**`、各 `*-test-support.ts`、`.feature`。
worker 覺得測試有錯,寫進報告的「待協調」,不改。

## 做法建議(不綁做法,量的結果才是驗收)

- `packages/core/src/session/teach-deepen.ts`(新,歸 11)管工作、取消、麵包屑;`teach.ts` 的 `recordCurrent`(第 164 行)改成一次可以記好幾張。
- 純的部分放 `packages/core/src/teach/deck.ts`(歸 07,只放純函式,不 import `session/`、fs):找子卡、level 篩選、麵包屑往下一個怎麼走。
- handler(第 332 行起的 `teach.*` case)多四個 case;生成用的 router 走同一個 `ensureRouter`。
- `scripts/review-sidecar.ts` 的迴圈結束(EOF)後,取消工作、`process.exit`。

## 不在範圍

- provisional 卡的雲端複審與重生(03 phase-3、09 lint、I6)。
- 02 phase-3 的增量 ingest 會不會動到深入出來的卡與邊。
- 改 prompt 模板與 golden run;router 支援中斷(D2 的另一個做法)。
- Rust 的任何改動(D1)。
- 範例折疊、縮放、圖片放大(07 phase-4);週目標(08 phase-2)。
- 真資料上的人工確認(`@e2e`):I4 一起問使用者(ADR-073)。

## 預算

- `budget_usd: 8`(worker 的花費;grok 不設停止線,只記錄)。
- **這張的 LLM 真呼叫:0**。測試、單獨執行、`@manual` 全部用假 router。
- **合併之後,真的深入一次的花費**(使用者在真資料上用時,經 router、帳本、`LLM_DAILY_CAP_USD`):
  - 最多 13 個呼叫:子卡 1 次 + 每張最多 2 次重寫 × 3 張 + 每張考題最多 2 次 × 3 張。
  - 用 `packages/core/src/llm/spend.ts` 的預設價估(每百萬 token 輸入 2.5、輸出 10 美元;`.env` 的真價我沒看):
    - 一般一次(1 次子卡 + 3 次考題)約 US$0.04;
    - 最壞(13 次都用滿輸出上限)約 US$0.6。
  - 當日預算用完時深入改走閘道、標 provisional(ADR-039,閘道免費),不會超過日上限再花雲端的錢。
  - **任何一次真的深入之前**(例如 I4 的真資料確認),先跑 `npx tsx scripts/llm-spend.ts --today`,確認「今天已花 + 最壞 US$0.6」不超過 `LLM_DAILY_CAP_USD`。
    會超過就不跑,改問使用者(當日花費超過上限是使用者保留的決定)。

## 測試誰寫

- 紅測試、步驟定義、協定向量、cucumber 用的假網路與假閘道、改壞證明:測試 agent。開發 worker 以紅測試分支為基底,不改測試。
- 實作(含 `apps/teach-card/dev/fake-cloud.mjs`):worker(opencode + grok-4.7),只改 `touches` 列的檔。
- 驗收:驗收 agent。觀感:前端,技術顧問判。

## worktree 與落點

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
- 落點:
  - `packages/core/src/ingest/` → 02;
  - `packages/core/src/session/` → 11;
  - `packages/core/src/teach/` → 07;
  - `packages/core/src/llm/credentials.ts` → 03(只有 D7);
  - `apps/teach-card/` → 07;
  - `apps/desktop/src/webview/review-client.ts` → 10;
  - `scripts/review-sidecar.ts` → 11。
- 都已在 `../../scripts/boundaries.owners.json` 的範圍裡,新檔不用另登記。新的 import 例外只有 D8 那一條:`scripts/boundaries.allow.json` 列在 `touches` 裡,但由協調者在同一批加,worker 不改。
- 真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
- 重活(cucumber、vitest、cargo、tauri build)先跟協調者拿位子:`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`,cucumber 一律 `--tags`。
