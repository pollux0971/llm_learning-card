---
id: T37
deps: []
touches: [packages/core/src/teach/, packages/core/src/session/handler.ts, packages/core/src/session/protocol.ts, apps/desktop/src/webview/review-client.ts, apps/teach-card/src/, apps/teach-card/vite.config.ts, apps/teach-card/dev/, packages/core/src/session/teach.ts, packages/core/src/schema/graph.ts]
cpu: heavy
budget_usd: 6
status: todo
owner: worker-grok
must_catch:
  - 按「下一個」只改記憶體、不寫 reviews.json:Switching 與 next 的「recorded as learned」必須紅(看磁碟,不看畫面)
  - 換類別時沒有把目前那張標成學過:Switching also records the current card as learned 必須紅
  - 重開之後回到第一個類別:The last category is remembered 必須紅
  - 不照 order 檔、改用 id 排序:Order comes from the order file 必須紅(order 檔排的順序要跟 id 順序不同)
  - 沒有 order 檔時當成空的、或照 id 排了卻不記 warning:A missing order file falls back to id order 必須紅
  - 先備沒學就擋住下一個、或按下一個不標學過:An unlearned prerequisite does not block 必須紅
  - 跟著先備提示走時,把原本那張標成學過:跟提示走的那條自動測試必須紅
  - 已經在 reviews.json 的卡再被標一次學過時,它的 stage、next_due、history 被重設:必須紅
  - 寫 reviews.json 不經 core 的 saveReviewsIfUnchanged(§11b 四步):必須紅
  - 教學卡用 teach.open 時讀到的舊內容去寫(蓋掉別人在中間的改動):必須紅
  - 教學卡寫完無條件把考試卡的基準設成新雜湊(吞掉終端機的改動,T26 抓不到):必須紅
  - 考試卡複習進行中,教學卡標一張學過之後,考試卡下一次送出出現「複習紀錄剛被別的地方改過」:必須紅
  - 考試卡在同一個側車送出之後,教學卡下一次 teach.next 回錯:必須紅
  - 教學卡的今天跟 session 不是同一個來源(LC_REVIEW_TODAY 釘住時 learned_at 不是那一天):必須紅
  - 側車一直回 busy 時無限重試(超過 Rust 的請求逾時 180 秒還在轉):必須紅
  - learned 事件沒寫進 log.jsonl、或寫的不是契約 §10 的形狀:必須紅
  - 側車照 webview 給的路徑或任意卡 id 讀寫(例如換到設定檔裡沒有的分類、先備的序號超出範圍):必須紅,而且這種請求不讀不寫
  - 桌面版教學卡還在讀編進去的 fixture,不是真的 learning 目錄:必須紅
  - 單獨執行 npm run dev -w apps/teach-card 壞掉:standalone 必須紅
  - 06、07 phase-1、10、14、I2、I3 的既有場景或測試任一變紅,或任何 .feature 被改:不退步必須紅
---

# 工單 T37:07-teach-card phase-2——換類別、依賴順序、先備提示、接上真檔案

> 狀態:顧問審過 2026-10-21(D1、D3、D4 同意;D2 照顧問改寫的三條規則;D5 加上限)。決定記在 ADR-077(refine ADR-075,同一批)。
> 作者:UI/Tauri 負責人。編號:T37(協調者配)。派工:協調者。**I4 的關鍵路徑**,優先於 T36、T35。
> 實作:worker(opencode + grok-4.7);紅測試、協定向量、步驟定義:測試 agent;驗收:驗收 agent;觀感(`@manual`):前端,技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 依據:`../../features/07-teach-card/phase-2.feature`、`../../features/07-teach-card/FEATURE.md`、`../../features/07-teach-card/NEXT.md`(gate 全滿足:phase-1 done、01 phase-3 done、10 phase-2 done、I3 自動驗收 2026-10-21 通過);契約 §2 §4 §8 §10 §11 §11b §13;ADR-073、ADR-075、T26。
> 基底:main(I3 自動驗收通過之後)。

## 為什麼有這張

- **桌面版的教學卡現在讀的是編進去的 fixture。** `../../apps/teach-card/src/App.svelte` 用 `createFixtureFs()`(Vite `?raw` 把 `contracts/fixtures` 編進頁面)。
  桌面 app 打開看到的是那七張示範卡,不是 `learning/` 裡的卡。T34 B4 用暫存根跑,教學卡照樣是「同源政策」那張 fixture。
- **「學過」不落地。** `../../apps/teach-card/src/lib/deck.ts` 的 learned 只在記憶體(phase-1 寫明不落地)。
  卡沒被標成學過,就不會進排程,考試卡永遠沒有題目。I2、I3 要真資料的人工確認都在等這一步(ADR-073)。
- phase-2 的場景:換類別(列出每個類別剩幾張)、換類別也算學過、記住上次的類別、照 order 檔排、沒有 order 檔退回 id 順序並記 warning、先備提示(只點名沒學的、點了跳過去且原卡不算學過、不擋下一個)、需要素材的類別有標記。

## 形狀(ADR-077)

照 ADR-075 的分工,**教學卡的判斷與寫入也放在 Node 側車**,視窗只顯示與收輸入:

1. **側車多收四個教學卡的動作**(同一支 `scripts/review-sidecar.ts`、同一個行程、同一個 Rust 的 `review` command;Rust 只看信封,不用改):

   | 動作 | 參數 | 做什麼 | 回什麼 |
   |---|---|---|---|
   | `teach.open` | `{ category?: string }`(視窗記得的上次類別,可省略) | 讀設定、分類、order、reviews;決定目前的類別與要顯示的卡 | 類別清單、目前類別、目前卡、先備提示 |
   | `teach.next` | `{}` | 把**目前顯示的那張**標成學過(已經在 `reviews.json` 的不動),前進到這個類別下一張沒學的 | 同上 |
   | `teach.switch` | `{ category: string }` | 把目前那張標成學過,換到那個類別的第一張沒學的 | 同上 |
   | `teach.prereq` | `{ index: number }` | 顯示目前那張的第 `index` 個沒學的先備,**不**把目前那張標成學過 | 同上 |

   - 回的「目前卡」只給 `learning/` 裡的相對路徑與標示(id、標題),**不送內容**;視窗照舊用 `LearningFs.read` 讀檔、用 phase-1 的渲染器畫(跟 06 讀 reteach 卡同一個做法)。
   - **不收路徑、不收任意卡 id**(ADR-075 第 3 點):`category` 必須是設定檔 `config/categories.yaml` 裡的 id,`index` 必須在目前那張的未學先備清單範圍內;不是就回 `bad-request`,不讀不寫。
   - 「目前顯示的那張」由側車記著,不由視窗告訴它。

2. **寫入照 ADR-075 第 7 點的表,多一種寫入情況,照下面三條規則(顧問 2026-10-21)**:
   - `reviews.json` 一律經 core 的 `saveReviewsIfUnchanged`(§11b 四步)。新卡的初始狀態用 04-scheduler 的 `applyLearnedTransition`(stage 1、`learned_at` 今天、`next_due` 明天)。
   - **a. 教學卡不留長期基準。** 每次 `teach.next` / `teach.switch`,在同一個請求裡重讀 `reviews.json`、加上那一筆、用 `saveReviewsIfUnchanged(剛讀到的雜湊)` 寫。
     剛好有人在那幾毫秒內寫入、檢查沒過,就重讀再試一次;還是不過才回錯(新的錯誤種類 `teach-record-changed`,見 ADR-077)。新學一張卡只是加一筆,跟別人的改動合併是安全的。卡已經在 `reviews.json` 裡就不寫。
   - **b. 考試卡的基準只在「寫入前磁碟上的雜湊 == `session.reviewsHash`」時才前進成新雜湊。** 不相等表示外面有人改過(例如終端機),基準不動,考試卡下一次送出照 T26 報錯。沒有開著的 session 就不用管。
   - **c. 日期跟 session 同一個來源**(`LC_REVIEW_TODAY` / handler 的 `deps.today`,ADR-076 第 5 點);測試釘住。
   - `log.jsonl`:`{ type: 'learned', card }`(§10),core 現有的事件寫法;`reviews.json` 寫成功之後才寫這一行。
   - 沒有 order 檔:照 id 排,記一筆 `warning`(§10,建議重跑 ingest)。order 檔裡有、磁碟上沒有的卡略過;磁碟上有、order 檔沒有的,排在 order 檔的卡後面、照 id 排。

3. **教學卡的 deck 邏輯搬進 core**(`packages/core/src/teach/`,純函式為主:給 reviews、order、卡片 frontmatter,算出「下一張」「剩幾張」「未學先備」)。
   **落點修正(顧問 2026-10-21,B-lite)**:`packages/core/src/teach/`(歸 07)只放純函式(下一張、剩幾張、未學先備、order 跟磁碟不一致時的排法),輸入就是參數,不 import `session/`、schema 的 io、fs,只准 import contracts 的型別。會碰檔案的那段(四個 `teach.*` 動作的處理、重讀→寫入、基準規則、learned 與 warning 事件)放新檔 `packages/core/src/session/teach.ts`(歸 11),它 import `teach/`(11→07,單向新例外)、`session/io`、04 的 `applyLearnedTransition`、01 的 `listCardIds`。讀 order 檔的函式放 `packages/core/src/schema/graph.ts`(01),跟 `readCategoryGraph` 放一起(ADR-038 第 1 點:沒有檔要回明確的狀態)。不開 07→11。
   `apps/teach-card/src/lib/deck.ts` 留給單獨執行與 phase-1 的步驟用到它為止(FEATURE.md 的「Wave 0 的重複」本來就寫 phase-2 再看是否搬進 core)。

4. **視窗**(`apps/teach-card/`):桌面版(`isTauri()`)用 `createReviewClient()` 的教學卡動作 + `createLearningFs()`;單獨執行(`npm run dev -w apps/teach-card`)照 06 的做法,dev server 在 `contracts/fixtures/learning-minimal` 的暫存複本上跑同一支側車(ADR-022、ADR-075 的 Consequences)。
   07 → 10 的 import 例外由協調者加進 `scripts/boundaries.allow.json`(跟 06 → 10 同一條理由:用桌面殼的 ReviewClient 與 LearningFs)。

### 顧問的裁決(2026-10-21,記在 ADR-077)

| | 問題 | 定案 | 沒選的與為什麼 |
|---|---|---|---|
| D1 | 教學卡的寫入放哪 | **側車**(上面的形狀) | 視窗用 `LearningFs.write` 整份覆寫 `reviews.json`:讀改寫之間側車剛寫了一題就會被蓋掉(幾個月的記憶資料,硬規則 5);`log.jsonl` 也沒辦法用整份覆寫來追加一行;還要在視窗再寫一份初始狀態(ADR-060 的漂移) |
| D2 | 教學卡寫入與考試卡 session 的基準 | **上面第 2 點的 a、b、c 三條**:教學卡每次重讀、用剛讀到的雜湊寫(衝突重試一次);考試卡的基準只在寫入前的磁碟雜湊等於它的基準時才前進;日期同一個來源 | 草稿的「教學卡寫完就更新考試卡基準」只寫一半:教學卡若留著自己的長期基準,考試卡送出後它就過期,下一次 `teach.next` 誤報;無條件把考試卡基準設成新雜湊,會把終端機的改動一起吞掉,T26 就抓不到 |
| D3 | 「記住上次的類別」存哪 | **視窗的 `localStorage`**(鍵 `lc-teach-last-category`),`teach.open` 帶過去,側車驗它在 `categories.yaml` 裡。B4 量過兩張卡同一個來源、重開還在 | 存檔(例如 ADR-074 的快取目錄多一個檔):多一個檔案格式;這是畫面偏好,丟了只是回到第一個類別 |
| D4 | 學過要不要更新 `state/weekly.json` | **這張不碰**;`learned` 事件照寫 `log.jsonl` | 08 phase-2(I5)才做週目標的顯示與計數;現在改等於替 08 決定計數時機 |
| D5 | 側車忙時教學卡的動作 | **視窗收到 `busy` 就每 300 ms 重試**,超過 1 秒顯示「考試卡正在批改,稍等一下。」,按鈕停用;**一直 `busy` 到 Rust 的請求逾時(`review_sidecar.rs` 的 `REQUEST_TIMEOUT`,180 秒)就停止重試**,改顯示 06 的出錯畫面(`timeout` 的固定字樣「等候回覆的時間過了。」加「再試一次」)。Rust 不改 | Rust 排隊:改 T22 的「忙就回 busy」與它的測試。Rust 的 `call` 整個請求都握著鎖(`try_lock` 拿不到就回 `busy`),批改的 LLM 呼叫期間教學卡一定拿到 `busy`,所以重試是對的;但不能無限轉 |

- D5 的已知限制:側車的第一個請求還要等 `hello`(最多 20 秒),所以極端情況下考試卡那邊還沒逾時,教學卡就先顯示出錯;按「再試一次」即可。
- 180 秒在視窗那一側是常數,要跟 Rust 的 `REQUEST_TIMEOUT` 一樣:測試讀 Rust 原始檔比對(跟 T15 讀 `hud.css` 的做法一樣),不一樣就紅。
協定的形狀照舊只有一份:`packages/core/src/session/protocol.ts` 的 zod schema 加 `protocol.vectors.json`,TS 與 Rust 的測試讀同一份。

## 畫面(前端定,`@manual` 照這個量)

全部用 14 的 HUD 元件(ADR-071),不另畫框。視窗 360 × 480。

- **按鈕列**:「下一個」「換類別」並排,在卡片內文下面(phase-3 的「深入這個」之後加在同一列)。
- **換類別**:按了之後,捲動區換成類別清單,不開新視窗、不用彈出層。
  - 每一列是一顆 `HudButton`:「<名稱> · 剩 N 張」;剩 0 張寫「<名稱> · 學完了」;`require_raw` 的類別在名稱後面加「需要素材」。
  - 目前的類別那列加「(目前)」,按它等於取消(**不**標學過)。清單最下面一顆「取消」。
  - 三個類別時整份清單不用捲就看得到。
- **先備提示**:在標示列(類別、原始/生成、Level)下面、標題上面,一行「先備還沒學:」接每個沒學的先備的標題,每個標題是一顆可以按的連結樣式按鈕(`data-hud="button"` 的文字版,沒有 HUD 現成的就用 `HudButton`)。學過的先備不出現;全部學過就沒有這一行。
- **類別學完**:照 phase-1 的字樣「這個類別已經學完了。可以考慮補充更多素材。」,按鈕列只剩「換類別」。
- **出錯**:側車回錯誤時照 06 的做法,顯示固定字樣、可以重試,不卡住。

## 驗收條件

### 1. 自動驗收(cucumber,測試 agent 寫步驟)

`NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and @phase-2 and not @manual' --format summary`:0 undefined、全綠。

| 場景 | 要接上的真零件 | 過的條件(看磁碟,不看畫面) |
|---|---|---|
| 背景:三個類別、真的 learning 目錄與 order 檔 | 暫存根(learning、`XDG_*`、`HOME` 同一個 mkdtemp);`vault.ts init` | 真的 `config/categories.yaml` 三個類別、`graph/order-<cat>.json` |
| Switching also records the current card as learned | 側車子行程(`features/support/review-sidecar-harness.ts` 的 `spawnSidecar`)送 `teach.open`、`teach.switch` | `reviews.json` 有那張卡,stage 1、`learned_at` 今天、`next_due` 明天;`log.jsonl` 多一行 `learned` |
| The last category is remembered | 視窗那一側的 `localStorage` 由步驟模擬(D3) | 關掉(結束側車)再開,`teach.open` 帶上次的類別,回的是那個類別 |
| Order comes from the order file | order 檔的順序跟 id 順序不同 | `teach.next` 兩次,依序是 order 檔的第 2、3 張 |
| A missing order file falls back to id order | 刪掉那個類別的 order 檔 | 照 id 排;`log.jsonl` 多一行 `warning`,內容提到重建 order |
| An unlearned prerequisite does not block | 卡有一個沒學的先備 | `teach.next` 照樣把它標成學過、前進 |

另外的自動測試(vitest,測試 agent 寫):

- core 的 deck 純函式:下一張、剩幾張、未學先備、order 檔與磁碟不一致的三種情況(上面第 2 點最後一句)。
- `teach.prereq`:回的是那個先備;**原本那張不在 `reviews.json`**。之後 `teach.next` 標的是先備那張。
- 已學過的卡:`teach.next` / `teach.switch` 對已經在 `reviews.json` 的卡,不改它的任何欄位(雜湊前後相同)。
- 同一個側車,兩個方向(D2):考試卡 `start` → 教學卡 `teach.next` → 考試卡 `submit` 成功,磁碟上兩筆都在;考試卡 `submit` → 教學卡 `teach.next` 成功(教學卡沒有過期的基準)。
- 寫入那幾毫秒的衝突(D2 a):用注入的 io 讓第一次寫入前磁碟雜湊不符 → 教學卡重讀再寫一次、成功;連續兩次都不符 → 回 `teach-record-changed`,`reviews.json` 與 `log.jsonl` 都沒動。
- 日期(D2 c):`LC_REVIEW_TODAY` 釘一個不是今天的日期,`learned_at` 是那一天、`next_due` 是隔天。
- 終端機同時改(D2 a、b):考試卡 `start` 之後、教學卡 `teach.open` 與 `teach.next` 之間,另一個行程改了 `reviews.json` → `teach.next` 成功,那個行程的改動還在(沒被蓋掉)、新卡也在;**考試卡下一次 `submit` 照 T26 報錯**(基準沒有前進)。
- 拒絕:`teach.switch` 給設定檔裡沒有的分類、`teach.prereq` 的 `index` 超出範圍、參數多出欄位 → `bad-request`,`reviews.json` 與 `log.jsonl` 雜湊前後相同。
- 協定向量:四個新動作的合法與不合法請求各至少一列,TS 與 Rust 的測試都讀(`protocol.vectors.json`)。
- 視窗:桌面版不 import `stubs/fixture-data`(建出來的 `apps/desktop/dist/teach/` 裡沒有 fixture 卡的內容);`busy` 時重試、超過 1 秒出現等候字樣;一直 `busy` 到 180 秒(假時鐘)停止重試、出現「等候回覆的時間過了。」與「再試一次」,按了重送同一個動作(D5)。
- 單獨執行:`standalone.json` 的 teach-card 指令照樣起得來。

### 2. 改壞證明(測試 agent 的丟棄式證明)

must_catch 每一條各做一次:改了哪裡、哪一條紅、紅的訊息原文、還原後綠。看磁碟的那幾條,改壞法要是「畫面照樣對、磁碟不對」(例如 `next` 只改記憶體),證明測試看的是磁碟。

### 3. 觀感(`@manual`,前端做、技術顧問判)

做法同 T23、T32、T34 B4:暫存根 + fixture(三個類別、有先備鏈、一個 `require_raw`),假 router,隔離的顯示(Xvfb `:97` + 巢狀 GNOME Shell),不碰使用者的桌面 `:1`。

- Switching category:清單列出三個類別與剩幾張,選一個 → 出那個類別第一張沒學的;清單不用捲就看得到;「(目前)」與「取消」不標學過(看 `reviews.json`)。
- Unlearned prerequisites are named:兩個先備一個沒學 → 標題上面點名沒學的那個,學過的不出現。
- A prerequisite hint can be followed:按點名的先備 → 出那張;原本那張不在 `reviews.json`。
- Categories that require raw material are marked:有「需要素材」。
- 真檔案:桌面版開起來是暫存根 `learning/` 的卡,不是 fixture 的七張;按「下一個」之後 `reviews.json` 多一筆;隔天的日期(`LC_REVIEW_TODAY`)開考試卡,那張出現在名單裡。
- 長相:截圖(清單、先備提示、學完);console 0 則;真的 learning/ 前後相同。

### 4. 不退步

- 06、07 phase-1、10、14 的既有場景與測試全綠;cucumber `@i2 and not @manual`、`@i3 and not @manual`、`@teach-card and @phase-1`(拿位子)全綠。
- `cargo test`(`apps/desktop/src-tauri`)全綠(協定向量變了,Rust 那一側照讀)。
- 任何 `.feature` 都不改。

## 受保護的測試檔(開發 worker 不改)

`*.test.ts`、`features/steps/**`、`features/support/**`、`apps/desktop/src-tauri/tests/**`、`packages/core/src/session/protocol.vectors.json`、`contracts/fixtures/**`、各 `*-test-support.ts`、`.feature`。
worker 覺得測試有錯,寫進報告的「待協調」,不改。

## 做法建議(不綁做法,量的結果才是驗收)

- 側車的 handler 現在的 `switch (method)` 加四個 case;教學卡的狀態(目前類別、目前那張)放在 handler 的閉包裡,跟 session 同一個生命週期。
- 讀 order 檔:01 有 `writeCategoryOrder` 與 `readCategoryGraph`(`../../packages/core/src/schema/graph.ts`),沒有讀 order 檔的函式;在 core 補一個,「沒有檔」回明確的狀態,不回空陣列(ADR-038 第 1 點:「沒有圖」是一個明確狀態)。
- 未學 = 不在 `reviews.json`。卡片清單用 core 的 `listCardIds`(不含 `.short.md`)。
- 初始狀態有兩份:`schema/review.ts` 的 `createInitialReview` 與 `scheduler/transitions.ts` 的 `applyLearnedTransition`,欄位相同。用排程那一份;另一份要不要刪另議(不在這張)。
- 視窗的「目前卡」改成側車回的路徑之後,`stubs/fixture-data.ts` 只在單獨執行的 dev 頁面用。

## 不在範圍

- 深入這個(phase-3)、範例折疊與縮放與圖片放大(phase-4)。
- 週目標的計數與顯示、「今天已學 N,明天約 M 題」(08 phase-2,I5;見 D4)。
- 「下一個」要不要「跳過不標學過」(FEATURE.md 的開放問題,照現狀:滑過就算學了)。
- Rust 的側車管理(T22 的 cargo 測試守);打包時帶 Node(ADR-075 已知限制)。
- `@e2e`、真的 learning/ 上的人工確認:I4 一起問使用者(ADR-073)。

## 預算

`budget_usd: 6`。grok 不設花費上限,只記錄。LLM 真呼叫:0(教學卡的動作不呼叫 LLM;測試用假 router)。

## 測試誰寫

- 紅測試、步驟定義、協定向量、改壞證明:測試 agent。開發 worker 以紅測試分支為基底,不改測試。
- 實作:worker(opencode + grok-4.7),只改「touches」列的檔。
- 驗收:驗收 agent。觀感:前端,技術顧問判。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
落點:`packages/core/src/teach/`(新)、`packages/core/src/session/`(handler、protocol)、`apps/teach-card/`、`apps/desktop/src/webview/review-client.ts`。跟 T35(`wayland_note.js`)、T36(測試)不重疊。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。重活(cucumber、vitest、cargo、tauri build)先跟協調者拿位子,`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`,cucumber 一律 `--tags`。
