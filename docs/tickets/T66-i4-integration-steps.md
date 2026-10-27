---
id: T66
deps: []
touches: [features/steps/i4-two-card-system.steps.ts, features/support/i4-harness.ts, features/steps/teach-card-phase3.steps.ts, features/steps/ingest-phase3.steps.ts, features/steps/grading.steps.ts, features/support/t66-source-marker-render.test.ts]
cpu: heavy
budget_usd: 2
status: todo
owner: 測試
must_catch:
  - 側車排教學卡不看 order 檔(改成照 id 排) 依賴順序那條必須紅
  - 先備沒學時畫面不列出它(prereqs 回空陣列) 依賴順序那條的先備提示必須紅
  - 先備沒學時按下一個被擋(回錯誤或不前進) 依賴順序那條的 But 必須紅
  - 換類別時沒把顯示中的那張記成學過 換類別那條必須紅
  - 學過的紀錄不是排程的學過轉移(例如 next_due 寫成今天、stage 寫 0) 換類別那條必須紅(隔天的 review.ts --dry-run 沒列出它)
  - 換過去之後顯示的不是那個類別 order 檔裡第一張沒學的 換類別那條最後一句必須紅
  - 深入生成的子卡 level 等於父卡(沒有加 1) 深入生成那條必須紅
  - 深入生成的子卡沒有考題檔,或 deps.json 沒有父卡到子卡的邊 深入生成那條必須紅
  - 深入生成的模型請求沒經過驗證帳本的 router(log.jsonl 沒有 task 是 deepen 的 llm_call) 深入生成那條必須紅
  - 已經有子卡還呼叫模型 重用子卡那條必須紅
  - 深入生成不檢查字數(超過 100 字的那張照寫) 字數那條必須紅
  - 主題生成寫出 source raw 或帶 source_ref 的卡 沒有 raw 的類別那條必須紅
  - lc-fs 的 read 拒絕 cards 底下的路徑(教學卡讀卡片內文其實要經過它) 每一條顯示卡片的自動場景都必須紅
  - 考試卡答了一題卻沒寫 reviews.json 回歸那條必須紅
  - 動到產品程式或任何 .feature 不動的地方那條 diff 必須有輸出
---

# 工單 T66:i4 驗收檔的整合層步驟定義

> 狀態:起草 2026-10-27,依協調者 2026-10-27 的交代(顧問判 I4 盤點第 6 節第 4 點:同意開這張)。顧問 2026-10-27 審過、准:D1 甲(加 lint 條件)、D2 甲、D3 甲(見最後「顧問裁定」)。規格:UI/Tauri 負責人(代筆)。編號 T66:協調者配的。
> **只有測試,不改產品程式。** owner 是測試 agent,不派開發 worker。LLM 真呼叫 0,不准 `--live`。
> 起因:[I4 盤點](../reviews/I4-inventory.md)的 G1(7 條自動場景步驟全是 undefined)與 G2(整合工作沒有證據)。做法照 T34 的 A(I3 的整合層步驟)。
> 基底:main `175b837`(含 I4 盤點)。跟 T67 落點不相交,可以同時做。

## 為什麼有這張

- `../integration/i4-two-card-system.feature` 有 10 個場景:7 個自動、3 個 `@manual`。
- 7 個自動場景的步驟**一條都沒有定義**(背景三條每個場景都算,共 45 條 undefined)。
- 每條場景要的行為,phase 層都有場景守著,而且真跑全綠(盤點第 2 節)。差的是整合層:沒有一條場景從「視窗按下去」一路跑到「磁碟上的檔與排程狀態」。
- roadmap 的整合工作「07 接上真的 fs、order 檔、llm-router、scheduler」做在 T37、T40、T43、T44,但沒有證據(盤點 G2)。**這張的步驟做完,就是那份證據。**

## 起草時查的(讀程式,沒有跑 cucumber)

| 查了什麼 | 結果 |
|---|---|
| 45 條 undefined 的字,跟現有步驟會不會撞 | 撞到 4 句,見下面「共用的句子」 |
| 07 phase-3 用哪個假網路 | `features/steps/_fake-deepen-cloud.mjs`(換掉側車子行程的 fetch),**不是** `_fake-cloud.mjs`。協調者的交代寫 `_fake-cloud.mjs`,那支是給 CLI 的 ingest 用的。深入的三條用前者,主題生成那條用後者 |
| 主題生成的 CLI 怎麼跑 | `features/support/ingest-cli-runner.ts`(T61、T62 用的):子行程從零組環境、帶 `_fake-cloud.mjs`、沒有 `.env` 就不起、`HOME` 與 `XDG_*` 指暫存 |
| `_fake-cloud.mjs` 能不能回主題生成 | 能。主題的回應解析(`packages/core/src/ingest/topic.ts` 的 parseTopicCards)不看 `lines`,假網路預設的 level 0 回應可以直接用 |
| 教學卡畫面怎麼標「生成」 | `apps/teach-card/src/App.svelte` 的標示列直接寫 `source === 'raw' ? '原始' : '生成'`,**沒有任何測試量過它**(見 D3) |
| 現有的教學卡 fixture 能不能直接用 | 不能整個照用。`features/support/teach-harness.ts` 的第一個類別,order 檔**刻意不是**拓樸順序(07 phase-2 要量「照檔案,不照 id」);i4 第 23 行要的是「是拓樸順序」。要新的佈置,見下面 |

## 要的結果

新的步驟檔 `features/steps/i4-two-card-system.steps.ts`,佈置與觀測放 `features/support/i4-harness.ts`。照 `features/steps/_world.ts` 的結構寫,照 `features/steps/i3-desktop-review.steps.ts` 的樣子分派(`Before` 看 `pickle.uri` 是不是 i4 那個檔,標進 world)。

步驟的字**照 i4 原文**,不改 `.feature`。

### 接上的真零件

| 零件 | 用什麼 | 守的是盤點 G2 的哪一項 |
|---|---|---|
| 側車 | 真的子行程 `scripts/review-sidecar.ts`(`features/support/review-sidecar-harness.ts` 的 spawnSidecar,跟 Rust 起的同一支) | 07 跑在同一份 core 上 |
| 視窗 | `apps/teach-card/src/teach-session.ts` 的 createTeachSession,client 是真的 createReviewClient(handler 把一行寫進側車的 stdin) | — |
| 讀卡片內文 | 注入給 createTeachSession 的 `fs` 用 webview 的 `createLearningFs()`,`invoke` 轉到 lc-fs probe(做法照 i3 的「File access goes through the Tauri boundary」,`apps/desktop/src/test-support/webview-learning-fs.ts` 與 `probe.ts`) | 真的 fs |
| order 檔 | 暫存根裡的 `graph/order-<類別>.json`,側車自己讀 | order 檔 |
| 模型 | 側車裡照舊用驗證帳本的 router(createLiveGatewayRouter),只有網路層換成假的 | llm-router |
| 排程 | 側車寫的 `state/reviews.json`;隔天用真的 `scripts/review.ts --dry-run --today <隔天>` 看它到期 | scheduler |

全部用暫存根(learning、`XDG_*`、`HOME` 同一個 mkdtemp)。不碰真的 learning/,不准 live。

### 背景三條

| 句子(行) | 做法 |
|---|---|
| the desktop application is running(第 8 行) | `process.platform` 是 `linux`,lc-fs 從這個簽出編好(共用 `apps/desktop/src/test-support/build-lc-fs.ts`,跟 i3 的背景一樣,不另寫一份)。側車與視窗**延到第一個 When 才起**(照 07 phase-3 的 ensureWindow),因為後面的 Given 會改佈置 |
| a learning directory with three categories(第 9 行) | 新的暫存根,設定檔三個類別。不是 Linux 或編不起來就紅,不跳過 |
| 第 10 行那個 order 檔 exists | 斷言那個檔在暫存根裡 |

### 七條場景

| 場景(行) | 過的條件(看磁碟,不看畫面) |
|---|---|
| Teaching order follows the dependency graph(第 22 行) | Given 驗證 order 檔是 `graph/deps.json` 那個類別的圖的拓樸順序(每條邊的起點都排在終點前;**只看兩端都在 order 檔裡的邊**,跨類別那條的起點不在這個類別的 order 檔裡,不算,步驟註解寫明),**而且跟 id 順序不同**(不然照 id 排也會過)。按「下一個」一路按到類別學完,依序出現的卡就是 order 檔的順序。路上至少有一張卡的 `prereqs`(畫面那一欄)不是空的,佈置照 D1 甲,而且要過真的 lint(見驗收條件第 8 條)。那張照樣前進、照樣記成學過 |
| Switching category also records the current card as learned(第 29 行) | 換類別之後,`state/reviews.json` 剛好多了離開的那張,紀錄等於排程的學過轉移(stage 1、`learned_at` 今天、`next_due` 明天);`state/log.jsonl` 多一行 learned;**用真的 `review.ts --dry-run --today <明天>` 看,它在到期名單裡**。畫面換到新類別 order 檔裡第一張沒學的 |
| Going deeper generates a new level when none exists(第 35 行,`@llm`) | 顯示中的卡用 level 1(同 07 phase-3 的背景)。假網路用 `_fake-deepen-cloud.mjs`。新卡 1 到 3 張,level 2;每張有考題檔、過 validateQuestionFile;`graph/deps.json` 有父卡到每張新卡的邊;畫面是第一張新卡;`log.jsonl` 每個模型請求一筆 `llm_call`,task 都是 `deepen` |
| Going deeper reuses existing children(第 44 行) | 佈置兩張子卡。假網路收到 0 個請求,`log.jsonl` 沒有新的 `llm_call`;畫面是 id 排第一的子卡 |
| Generated cards obey the same body limit(第 50 行) | 假網路讓其中一張永遠超過 100 字(`FAKE_DEEPEN_LONG_TITLE`)。寫進磁碟的每張新卡,body 用契約 §2 唯一的字數函式算 ≤ 100,過 validateCard;超字那張沒寫進去。「the same validator used by ingest」的證據:靜態測試量 `packages/core/src/ingest/deepen.ts` 與 `ingest.ts` 都從 `schema/validate-card` 拿 validateCard、深入的重寫走 `generate-cards.ts` 的 enforceWordLimit(起草時讀過,現在就是這樣;測試釘住它,不是兩份) |
| Categories without raw material follow their configuration(第 69 行) | 設定檔加第四個類別(id 照原文),`require_raw: false`,`raw/` 底下沒有它的檔。真的跑 `scripts/ingest.ts --out <暫存根> --category <它> --topic <一句話>`(經 ingest-cli-runner,帶 `_fake-cloud.mjs`)。寫出來的 level 0 卡都是 `source: llm`、沒有 `source_ref`。之後教學卡換到這個類別,畫面上那張卡的內文(經 lc-fs 讀回來的)frontmatter 是 `source: llm`;「標示」本身由 D3 的渲染測試量 |
| Desktop review still works as in I3(第 76 行,`@regression`) | 照 D2 甲:同一個暫存根,教學卡先學一張(日期 D),再用 `LC_REVIEW_TODAY` = D+1 起新的側車,考試卡開起來那張就在題目裡。過的條件:考試卡(06 的 TestSession,接同一支真側車)答一題,`reviews.json` 那張卡今天多一筆 history,stage 與 `next_due` 跟排程轉移函式對同一筆舊紀錄算出來的一樣 |

### 共用的句子(要分派,不准定義兩次)

cucumber 不准同一句有兩個定義。下面前 3 句已經有人定義(盤點數到 45 條 undefined 而不是 49 條,差的 4 條就是它們:深入那句出現兩次),i4 的版本照 i3 的做法分派(在原本的定義裡加一行 `if (isI4(this)) return ...`,函式寫在 i4 的步驟檔)。第 4 句是提醒形狀:

| 句子 | 原本的定義在 | 原本做什麼 |
|---|---|---|
| the network is available | `features/steps/grading.steps.ts` | 分派給 03 phase-3、05 phase-3;其他是純敘述 |
| the person presses deepen | `features/steps/teach-card-phase3.steps.ts` | 07 phase-3 的 ensureWindow(沒有 phase-3 的世界會直接丟錯) |
| each has a question file | `features/steps/ingest-phase3.steps.ts` | 看 02 phase-3 主題生成寫的 level 0 卡 |
| 第 10 行的「`{string}` exists」 | 沒有人定義(`desktop-shell-phase2.steps.ts` 的是「the file … exists」,形狀不同) | — |

i4 的自動場景加背景一共 30 句不同的字;扣掉前 3 句,其他 27 句是 i4 自己的字,沒有人定義過。交件前跑 `npm run check:steps`。

### 證據檔要多一張表(盤點 G2 與顧問判定第 2 點)

驗收證據 `docs/reviews/acceptance-T66.md` 要有一張「I4 整合工作的證據」表:

| 欄 | 內容 |
|---|---|
| 零件 | 真的 fs、order 檔、llm-router、scheduler 四列 |
| 哪條場景 | i4 的第幾行 |
| 哪個斷言 | 一句話 |
| 改壞哪裡會紅 | 對應的 must_catch,附紅的訊息原文 |

再加一列給第 55 行 `@manual`(範例的 markdown 與圖片)。顧問判「引用 07 phase-4 的證據,不重做」,這一列寫三塊對照:

- 07 phase-1 第 32 行的自動場景(清單、粗體、不被當預格式);
- 07 phase-4 第 20 行的自動場景(圖片從 assets 解析);
- T46、T48 的 `@manual` 證據(`../reviews/T46-manual-2026-10-24.md`、`../reviews/T48-manual-2026-10-24.md`,真視窗裡圖片顯示)。

## D:顧問已判(2026-10-27)

### D1 · 第 26 行「先備沒學的那張要提示」,在拓樸順序裡怎麼發生

照拓樸順序一張一張按,**同一個類別裡的先備一定先學過**,所以照字面不會有「先備沒學」的卡。

- **甲(建議;顧問選這個,加條件)**:佈置裡有一張卡的 `prereqs` 指到**別的類別**的卡。那個先備還沒學,畫面就會列出它。側車算「沒學的先備」時本來就看全部類別的卡 id(`packages/core/src/session/teach.ts` 的 buildView),不用改產品。
  - **佈置要過真的 lint**(`packages/core/src/lint` 的 runChecks 對 scanDir 的結果):`prereq_mismatch`、`missing_prereq`、`cycle` 都是 0。
  - lint 的 prereq_mismatch(`packages/core/src/lint/checks.ts` 的 checkPrereqMismatch,起草時讀過)要求:每張列在某個類別圖 `nodes` 裡的卡,frontmatter 的 `prereqs` 剛好等於那張圖裡指向它的邊的起點。所以**跨類別那條邊放進「後學那張卡所在類別」的圖**,起點是別類別的卡;後學那張要在那張圖的 `nodes` 裡。
  - order 檔照樣是拓樸順序:Given 只看兩端都在 order 檔裡的邊(見上面場景表)。
  - lint 的其他種(例如沒有考題檔的 `missing_questions`)不在這條;證據檔照實列出 runChecks 每一種的數字。
  - **lint 怎麼擺都不乾淨就停下來回報**,顧問改判乙。
- 乙:改場景的字(例如拿掉那一句,或改成「跳著看」)。這是規格措辭,顧問決定;但會動 `.feature`。只在甲的 lint 條件做不到時才改走這條。

### D2 · 第 76 行回歸那條,到期的卡從哪來

i4 的背景是「什麼都還沒學」,沒有到期的卡,考試卡沒題可答。

- **甲(建議;顧問選這個)**:同一個暫存根,先用教學卡學一張(日期 D),再用 `LC_REVIEW_TODAY = D+1` 起新的側車,考試卡開起來那張就在題目裡,答一題。
  一條場景串起 07 → 04 → 06,正好是 G2 的「scheduler」證據,也是第 12 行 `@e2e` 的自動版。注意:**這不算第 12 行的人工確認**(那條要真資料、真的跨一天,盤點第 4 節)。
- 乙:照 I3 的背景,直接在 `reviews.json` 種一張今天到期的卡。比較簡單,但沒接到 07。

### D3 · 第 73 行「教學卡顯示 llm 的標示」

`App.svelte` 的「原始 / 生成」標示是寫在模板裡的一行,沒有測試量過。整合步驟只能看側車回的內文。

- **甲(建議;顧問選這個)**:加一條渲染測試 `features/support/t66-source-marker-render.test.ts`(真 Chrome,`packages/ui-shared/src/hud/render-test-support.ts` 的 openApp,照 t45 的做法):`source: llm` 的卡,標示列是「生成」;`source: raw` 的是「原始」。只有測試,不改產品程式。cucumber 那一句看內文的 frontmatter,證據檔寫「標示由渲染測試量」。
- 乙:照 07 phase-3 那條「the marker is visible in the interface」的先例,只看 frontmatter。少一支測試,但標示寫錯不會被抓到。

## 不改產品,發現產品有缺口時

這張只寫測試。若某條場景因為**產品真的少了行為**而紅(不是測試寫錯),停下來,在證據檔寫清楚哪一條、紅的訊息原文、缺什麼,回報協調者開修補票。不在這張改產品程式。

## 驗收條件

1. `NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@integration and @i4 and not @manual" --format summary` → 7 個場景全過,0 undefined、0 ambiguous。
2. 其他 `@i4` 場景結果不變:23 個 phase 場景照舊全過(02 phase-3、07 phase-2/3/4)。T67 的 `phase-5.feature` 也帶 `@i4`;**T67 的 docs 先合的話**,`@i4 and not @manual` 會多出 phase-5 的 undefined,那是 T67 的事,這張只看第 1 條與這 23 個。
3. 分派進去的三個步驟檔,原本的 phase 結果不變:`@teach-card and @phase-3`、`@ingest-pipeline and @phase-3`、`@grading`、`@llm-router and @phase-3` 照舊全過。
4. must_catch 每一條:在驗收 worktree 裡做那個改壞(只改產品程式,不改測試),對應的場景紅,記失敗訊息原文,還原再綠。
5. `npm run check:steps` 過(0 個重複定義)。
6. D3(顧問選甲):渲染測試在基底上就是綠的(行為本來就在),交件前用改壞(把「生成」改成別的字)證明它會紅。
7. `git diff --stat i4-base...<分支>` 只有 touches 列的檔,加上證據檔。產品程式與 `.feature` 0 行。
8. D1 的佈置過真的 lint:步驟(或 harness 的單元測試)對佈置好的暫存根跑 `packages/core/src/lint/index.ts` 的 lint(根)(就是 runChecks(scanDir(根));09-lint 的步驟也用它),`prereq_mismatch`、`missing_prereq`、`cycle` 都是 0;證據檔附每一種的數字。
9. 證據檔寫明:第 76 行那條(D2 甲)是「今天學、隔天考」的**自動**證據,**不算第 12 行 `@e2e @manual` 的人工確認**。

## 受保護的檔

- 任何 `.feature`(i4、07、02、06 的都一樣)。
- `packages/`、`apps/`、`scripts/` 底下的任何檔。D3 的渲染測試也放 `features/support/`(vitest 的 include 有它,不用登記 owners),不放進 `apps/teach-card/`:那是 07 的落點,T67 正在用,放進去 dag 會把兩張卡判成同一個落點(R2)。
- `features/steps/_fake-deepen-cloud.mjs`、`_fake-cloud.mjs`:照用。不夠用(例如要一個新的開關)就加環境變數,不改既有開關的行為,並在證據檔寫清楚。

## 怎麼跑

```bash
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@integration and @i4 and not @manual" --format summary
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@i4 and not @manual" --format summary
VITEST_MAX_WORKERS=1 npx vitest run features/support/t66-source-marker-render.test.ts
npm run check:steps
```

- 環境:`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`。cucumber 一律用 `--tags`,是重活,先跟協調者拿位子(i9)。
- 新簽出第一次跑會冷編 lc-fs。
- 不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev`。

## 不在範圍

- 第 12 行 `@e2e @manual`、第 63 行 `@manual`(每日負擔提示,T67 做)、第 55 行 `@manual`(引用 07 phase-4 的證據)。
- 改任何 `.feature` 的字(D1 選乙的話,由規格作者另一個 commit 改)。
- 完整的 `tauri build`(跟 T34 的顧問裁決一樣:Linux + lc-fs 編好就夠)。
- 真模型(golden 守 `deepen` 與 `ingest.topic` 的品質)。

## 顧問裁定(2026-10-27)

經協調者轉來,兩張(T66、T67)都准。T66 的部分:

1. **D1 甲,加條件**:佈置要過真的 lint,`prereq_mismatch`、`missing_prereq`、圖的問題(`cycle`)都是 0。跨類別先備那條邊放進後學那張卡所在類別的圖(起點是別類別的卡)。Given 的拓樸順序檢查只看兩端都在 order 檔裡的邊,步驟註解寫明。lint 怎麼擺都不乾淨就停下來回報,顧問改判乙。
2. **D2 甲**:今天學、`LC_REVIEW_TODAY` 隔天考,串起 07 → 04 → 06。證據檔寫明「不算第 12 行的人工確認」。
3. **D3 甲**:渲染測試放 `features/support/`。

## 低優先小票清單(協調者不另建清單檔,記在工單裡)

- 07 phase-3「the marker is visible in the interface」也只看 frontmatter。D3 選甲之後,可以用同一支渲染測試補「待審核」徽章。

## 預算

`budget_usd: 2`(測試 agent 的時間)。LLM 真呼叫:0。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底 main `175b837` 之後。只給測試 agent。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
