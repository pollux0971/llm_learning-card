---
id: T65
deps: []
touches: [packages/core/src/grading/reteach-short.ts, packages/core/src/grading/index.ts, packages/core/prompts/grading/reteach-short.md, packages/core/src/prompt-quality/golden-sets/registry.ts]
cpu: light
budget_usd: 2
status: todo
owner: worker-grok
must_catch:
  - 縮短版的 body 超過 short_body_limit 還寫進檔 字數那條必須紅
  - 三次都太長時沒留最短的那個、或沒記 warning 三次都太長那條必須紅
  - 三次以內有一次夠短卻還繼續重試 第二次就夠短那條必須紅(呼叫次數)
  - 縮短版的 example 不是剛好一個 一個例子那條必須紅
  - prompt 裡沒有原卡的 body 或 examples prompt 那條必須紅
  - 縮短版不是寫在原卡同一個分類資料夾的 id.short.md,或不是原子寫入 寫檔那條必須紅
  - 離線走本機時檔案沒標 provisional、或沒進 provisional 佇列(task reteach.short、card 是原卡 id) 離線那條必須紅
  - 雲端給的結果標了 provisional 或進了佇列 在線那條必須紅
  - 改了 prompt 卻沒跑 golden、或拿有未提交修改的 prompt 寫進 golden 基準目錄 驗收必須擋下
  - 實作動到 touches 以外的檔 不動的地方那條 diff 必須有輸出
---

# 工單 T65:05-grading phase-3——先看能不能開工;能的話先做縮短版生成

> 狀態:起草 2026-10-27,依協調者 2026-10-27 的交代(03 phase-3 已 done,佇列 API 已在 main `92c0e87`)。規格:UI/Tauri 負責人(代筆)。編號 T65:協調者配的。
> **這張先是一份給顧問的決定。** 照今天寫的 gate,05 phase-3 **不能開工**,而且起草時發現計畫裡有一個**循環**(下面)。顧問選了 D1 的甲,這張的「要的結果」才可以派工。
> 實作:worker(opencode + grok-4.7);紅測試、步驟定義、golden 輸入與 `--fake` 回應:測試 agent;驗收(含變異、live golden):驗收 agent。

## 結論:今天不能開工,而且計畫有一個循環

**gate 沒滿足**:

- `features/05-grading/NEXT.md` 的 phase-3 要:自身 phase-2 `done`(有)、04 phase-2 `done`(有)、03 phase-3 `done`(2026-10-27,T59,有)、**I5 通過**(沒有)。
- `npx tsx scripts/dag.ts --root .` 印 `BLOCKED 05-grading/phase-3 by I5`。I4 也還沒通過,06p4、08p2、10p3 都還在 `BLOCKED … by I4`。

**循環**:

- I5 需要 `06-test-card/phase-4`(`docs/01-roadmap.md` 的 I5 表;整合工作寫「06 接上 grading 的 generateShort」);
- 06 phase-4 需要 05 phase-3 `done`(`features/06-test-card/NEXT.md` 第 22 行;它的場景「A missing shortened version is generated」);
- 05 phase-3 需要 I5 通過。

所以照現在的寫法,05 phase-3、06 phase-4、I5 三個都永遠開不了工。roadmap 把 05 phase-3 整個放在 I6(第 178 行),但 I5 只需要它的「縮短版生成」那一半。

**05 phase-3 其實是兩件事**(`features/05-grading/phase-3.feature` 的 9 個場景):

| 半 | 場景 | 要什麼 | 什麼時候能做 |
|---|---|---|---|
| **縮短版生成** | 7 生成縮短版、8 太長就重生、9 離線的縮短版標 provisional 並進佇列 | 05 phase-2、03 phase-3(場景 9 的佇列) | **現在**(都已 `done`) |
| **離線審核與複審** | 1 離線應用題走本機並進佇列、2 暫定通過照樣前進、3–6 對完之後的四種修正 | 04 phase-2、03 phase-3,以及 NEXT.md 說的「要有真實資料才想得清楚」 | I5 之後(原本的理由) |

NEXT.md 原本把整個 phase 卡在 I5 的理由是「複審邏輯的難點……要有真實資料才想得清楚」。這只講到複審那一半,沒講到縮短版。FEATURE.md 的依賴表寫「縮短版要真的離線經驗」,但縮短版的場景 7、8 是在線的。

## 待顧問決定

- **D1:怎麼解開循環。**
  - **甲(建議):拆成兩個 phase。**
    - 05 **phase-3** = 縮短版生成(場景 7–9),gate:自身 phase-2、03 phase-3。不等 I5。
    - 新的 05 **phase-4** = 離線審核與複審修正(場景 1–6),gate 照原本:04 phase-2、03 phase-3、I5 通過。
    - 06 phase-4 的依賴「05 phase-3」不用改,意思剛好就是縮短版。09-lint phase-2 的依賴改成「05 phase-4」。
  - **乙:整個 phase-3 現在就做**(9 個場景都用假閘道)。不拆、不動計畫,但跟 NEXT.md 的「複審要有真實資料」衝突。
  - **丙:照舊等 I5。** 等不到(循環),不建議。
  - 甲要改的文件不歸 worker,由協調者或顧問做一個 docs commit,**附 ADR-084**(協調者配號):
    - `features/05-grading/FEATURE.md` 的 phase 表加 phase-4,依賴表改;
    - `features/05-grading/NEXT.md` 的 gate;
    - `features/05-grading/phase-3.feature` 拆出 `phase-4.feature`。場景文字一個字都不改,只搬家;tag 前者 `@i5`、後者 `@i6`;
    - `features/09-lint/FEATURE.md` 與 `NEXT.md` 的「05 phase-3」改「05 phase-4」;
    - `docs/01-roadmap.md` 的 I5 表加 05 phase-3、I6 表的 05 phase-3 改成 phase-4。
- **D2:縮短版怎麼寫檔。** ADR-082 定了「只有一個寫卡片的函式」(`packages/core/src/ingest/card-file.ts`),但 05 → 02 今天不准 import(`scripts/boundaries.allow.json` 裡 05 只能到 01、03、infra)。
  - **甲(建議)**:開一條 05 → 02 的例外,理由寫「縮短版用唯一的寫卡函式(ADR-082)」。照 T43 的先例(`f6a9255`)做成派工前的一個 chore commit,跟 ADR-084 一起。
    `features/support/t31-static.test.ts` 第 29 行的 `BASE_ALLOW_ENTRIES = 25` 釘了條數,要改成 26。這是測試 agent 改。
  - **乙**:把 `card-file.ts` 搬到 01(`packages/core/src/schema/`)。架構上比較乾淨(卡片格式是 §2),但要動 T58 剛定的檔、ADR-082 的路徑、T58 的指紋護欄名單。
  - **丙**:05 自己寫一份。違反 ADR-082,不建議。
- **D3:模型回應的形狀用 `{ "body": "…", "example": "…" }`**(`example` 是一個字串,不是陣列)。「剛好一個例子」由形狀保證,寫檔時 `examples: [example]`。另一種是陣列加檢查長度,多一種失敗要處理。建議前者。
- **D4:prompt 放 `packages/core/prompts/grading/reteach-short.md`**,照 T55 的先例:新 prompt、新 golden set、一次 live golden、顧問評分。
  - 硬規則 4:改了 `prompts/` 就要跑 golden;
  - 另一種是像 `grade.apply` 那樣把 prompt 寫在程式裡(`packages/core/src/grading/grade-apply.ts` 第 126 行),不用 golden,但品質沒人看著(ADR-032 要防的就是這個)。
  - 建議前者。`packages/core/prompts/` 的落點是 02(`scripts/boundaries.owners.json` 第 20 行),所以這張也碰到 02。

## 要的結果(顧問選 D1 甲之後;新的 05 phase-3 = 場景 7–9)

1. **新檔 `packages/core/src/grading/reteach-short.ts`**:

   ```ts
   generateShort(args: {
     learningDir: string;
     card: Card;           // 原卡(frontmatter、body、examples)
     router: LlmRouter;
     shortLimit: number;   // settings.short_body_limit,呼叫端讀好傳進來(05 不讀設定檔)
     queue?: ProvisionalQueue;  // 不給就用 provisionalQueuePath(learningDir)
     log: LogAppender;
   }): Promise<{ kind: 'written'; path: string; provisional: boolean; attempts: number } | { kind: 'no-model' }>
   ```

   - **prompt**:讀 `packages/core/prompts/grading/reteach-short.md` 當模板,後面接原卡的 body 與每一個 example(場景 7 要 prompt 裡有原卡的 body 與 examples)。task 用 `reteach.short`(§7 本來就有,不加新的)。
   - **回應**:JSON `{ body, example }`(D3)。不是合法 JSON、或欄位型別不對 → 這一次算失敗,照樣算進三次。三次都失敗 → 丟錯,不寫檔。
   - **字數**:`countWords` 量 body(`@core/schema`,跟教學卡同一把尺,契約 §2)。`≤ shortLimit` 就停,寫檔;超過就再要一次,最多三次(場景 8)。
   - **三次都太長**:留字數最少的那一個寫檔,記一筆 `warning`(`reason: 'reteach_short_overlong'`,帶三次的字數)。
   - **寫檔**:`cards/<原卡的分類>/<原卡 id>.short.md`,跟原卡同一個資料夾(場景 7)。
     - 內容用 `renderCardFile`(D2 甲),frontmatter 照抄原卡,只把 `provisional` 設成這次結果的 `provisional`;
     - body 是縮短版,`examples` 是那一個;
     - 用 `writeFileAtomic`(§11b 的寫法)。已經有縮短版就覆寫(06 phase-4 的「已經有就重用」由呼叫端決定要不要叫這個函式)。
   - **離線**(場景 9):`reteach.short` 是備援組,雲端不能用就走閘道並回 `provisional: true`。
     - 外面用 03 的 `recordProvisional(router, queue, card.frontmatter.id)` 包,provisional 的結果就進佇列(task `reteach.short`、card 是原卡 id);
     - 檔案的 frontmatter 標 `provisional: true`。
     - 雲端的結果不進佇列、不標。
   - **沒有模型**(離線而且閘道也不通):router 丟 `NO_MODEL` → 回 `{ kind: 'no-model' }`,不寫檔。06 phase-4 那邊會退回顯示原卡(`present.ts` 已經有 `usedOriginal`)。
2. **`packages/core/src/grading/index.ts`**:匯出 `generateShort`。
3. **新 prompt `packages/core/prompts/grading/reteach-short.md`**:
   - 要的東西:一張卡的縮短版,body 在 `short_body_limit` 以內,剛好一個例子,用不同的說法講同一個概念。上限數字由程式帶進去,不寫死在 prompt;
   - 回應只要 JSON;
   - worker 寫,golden 評分歸顧問。
4. **golden set**(`packages/core/src/prompt-quality/golden-sets/registry.ts`):加一組 `reteach.short`,`task` 是 `reteach.short`,`promptFile` 是上面那個檔。三個輸入:非資安的公開常識卡,照 T55 的做法;輸入與 `--fake` 回應由測試 agent 寫。

**呼叫端不在這張**:06 phase-4 的「介面載入時沒有縮短版就生成」是 06 那張工單接。這張只交 `generateShort`。

## 紅測試(測試 agent)

- **步驟**:`features/05-grading/phase-3.feature` 的場景 7–9。
  - 學習資料夾用暫存目錄,雲端用假的,閘道用假的 client(照 T59 的做法);
  - 子行程(如果有)照 T62 的煞車三件事;`XDG_*` 指暫存。
- **小心步驟文字撞名**:有幾句已經在別的步驟檔定義了,要照 `features/steps/i2-review-loop.steps.ts` 第 197 行那種「依 tag 分派」的做法共用,不能再定義一次:
  - `the network is available`(`grading.steps.ts`);
  - `the network is unavailable`(`i1-content-pipeline.steps.ts`、`teach-card-phase3.steps.ts`);
  - `the network is unavailable and a local model is running`(`teach-card-phase3.steps.ts` 第 198 行)。
  今天 cucumber 空 HOME 全套唯一的失敗,就是 05 phase-3 第一個場景用到這一句,07 phase-3 的定義丟「還沒有 phase-3 的世界」。那是場景 1(離線審核那一半),這張不做,但分派要先留好。
- **單元**(建議 `packages/core/src/grading/reteach-short.test.ts`):
  - prompt 裡有原卡的 body 與每一個 example;
  - 第一次就夠短:叫 1 次;第二次夠短:叫 2 次就停;
  - 三次都太長:寫最短的、記 warning、叫 3 次;
  - 回應不是 JSON 算一次失敗;三次都失敗就丟錯、不寫檔;
  - 寫檔路徑、frontmatter 照抄、`provisional` 跟結果一致、經過 `writeFileAtomic`;
  - 離線:檔案標 provisional,佇列一筆(task、card 對);在線:佇列不變;
  - `NO_MODEL`:回 `no-model`、不寫檔、佇列不變。
- **改既有測試**:`features/support/t31-static.test.ts` 第 29 行改 26(D2 甲)。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 單元 | `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/grading/ packages/core/src/prompt-quality/ features/support/t31-static.test.ts`,加上新測試檔 | 全綠 |
| 場景 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@grading and @phase-3 and not @manual' --format summary` | 場景 7–9 過(D1 甲之後,phase-3 只剩這三個);不退步:`--tags '@grading and not @manual and not @llm'`(重活,拿位子) |
| 守門 | `npm run typecheck`、`npm run boundaries` | 全過;例外條數 26(D2 甲那一條) |
| golden(fake) | `npx tsx scripts/prompt-check.ts --golden --set reteach.short` | 退出碼 0 |
| golden(live) | 先跑 `npx tsx scripts/llm-spend.ts --today`,退出碼 1 就不跑(T63 合併前的煞車)。再跑 `npx tsx scripts/prompt-check.ts --golden --set reteach.short --live --out <golden 基準目錄以外的暫存目錄>`,prompt 要是已提交的版本 | 跑完;花費照 T55 的估法,一輪約幾美分。人的評分交顧問(照 `golden/ingest.cards/2026-10-15/SCORES.md` 的格式:更短、同一個概念、例子具體、剛好一個例子) |
| 變異 | `npm run mutate -- stryker.t65-reteach-short.json`(驗收 agent 加,`mutate` 放 `reteach-short.ts`) | ≥ 80%(LLM 相關,05 的標準門檻) |
| 真資料 | `learning/` 前後三項 | 相同 |
| 不動的地方 | `git diff --stat <紅測試分支的 tip>..HEAD -- contracts docs 'features/**/*.feature' packages/core/prompts/ingest packages/core/src/grading/grade-apply.ts packages/core/src/grading/grade-fill.ts packages/core/src/llm packages/core/src/session scripts` | 沒有輸出 |

## 給之後 05 phase-4 的分析(場景 1–6,這張不做)

協調者問的幾件事,先寫下來,給 phase-4 的工單用:

- **`grade.apply` 怎麼包**:`gradeApply(question, answer, router)` 不知道卡片 id(`grade-apply.ts` 第 199 行)。知道卡的是 session 那層(`packages/core/src/session/answer.ts` 的 `submitAnswer`)。所以在那裡用 `recordProvisional(router, queue, card)` 包好再傳給 `gradeApply`。佇列路徑是 `provisionalQueuePath(learningDir)`。
- **卡片的鍵**:`card` 是被考的那張卡的 id,task 是 `grade.apply`。T59 的規則是同一張卡同一個 task 只留最新一筆。所以同一張卡在還沒對之前又被本機批一次,舊的那筆就被換掉,只對最新那次。
  phase-4 要決定這樣夠不夠。一天只考一次的話通常夠。
- **`changed` 誰給**:grading 給。本機的 `pass` 跟雲端重批的 `pass` 不同就是 `true`。T59 的 D3 已經定了由呼叫端給。
- **`drain`、`resolve` 誰叫、什麼時候叫**:09-lint phase-2 的 `lint --reconcile`(場景「Reconciliation replays each provisional result against the cloud」)。
  - 在線才 `drain`,逐筆拿 prompt 給雲端重放,交給 grading 算修正,再 `resolve`;
  - **重放一定要只走雲端**,不然又被備援到閘道。可以用 T63 那種七個 task 全 `cloud-only` 的備援表。
  - 05 要提供的是「拿到雲端的結果之後,怎麼改 reviews.json」那一段(場景 3–6:同意只清旗標、通過被推翻要退回、失敗被推翻要恢復、之後又考過就只改旗標);
  - 怎麼對到 history 裡那一筆(`ReviewEntry.date` 只到日,佇列的 `queued_at` 到毫秒),phase-4 要定。
- **哪些場景要真機**:9 個場景都可以用假閘道與假雲端自動跑,`phase-3.feature` 沒有 `@manual`。等閘道真的起來,可以再加一條真閘道的觀察(做法見 T59:暫存驗證帳本、上限 US$1、種一筆今天已花 US$1 的 openai `llm_call`;**不要用 `LLM_DAILY_CAP_USD=0`,那是沒設上限**)。不擋 done。

## 受保護的檔(開發 worker 不改)

- 測試、`features/**`、`.feature`、`contracts/`、`docs/`、`scripts/boundaries.allow.json`(D2 的 chore commit 不是 worker 做)。
- `grade-apply.ts`、`grade-fill.ts`、`packages/core/src/session/`、`packages/core/src/llm/`、`packages/core/prompts/ingest/`。

## 落點

- `packages/core/src/grading/` → 05-grading;`packages/core/prompts/` → 02-ingest-pipeline;`golden-sets/registry.ts` → 12-prompt-quality。
- import:05 → 03(`recordProvisional`、`provisionalQueuePath`,本來就有)、05 → 01(`countWords`、`writeFileAtomic`,本來就有)、**05 → 02(`renderCardFile`,D2 甲要新開)**。
- R2:有 02 與 12 兩個落點。派工時不能跟別的碰 02 或 12 的工單並行(協調者排)。

## 低優先小票清單(協調者不另建清單檔,記在工單裡)

- **05 phase-4 的工單**(D1 甲之後):離線審核與複審修正,場景 1–6,gate 照舊等 I5。上面「給之後 05 phase-4 的分析」就是它的起點。
- **主題生成的 examples 是濾掉非字串**(T61 的 D1 註):要不要跟 ingest 一樣改成拒絕,另開票。

## 預算

`budget_usd: 2`(一個新模組、一個 prompt、一組 golden;grok 不設停止線,只記錄)。LLM 花費:驗收的一次 live golden,約幾美分,在日上限以內,不用問使用者。`cpu: light`;cucumber、變異、live golden 是驗收的事,協調者排位子。

## worktree

- 顧問選了 D1 甲、D2 甲之後:起點分支最底下是協調者或顧問的 docs 與 chore commit(拆 phase、ADR-084、allow 例外),上面是測試 agent 的紅測試,再上面是開發 worker 的實作。
- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,沒有 `.env`。派工歸協調者。

## 起草時查的(只讀)

- `npx tsx scripts/dag.ts --root .`:`BLOCKED 05-grading/phase-3 by I5`;I4 也還沒過。
- `docs/reviews/acceptance-T60-impl.md` 第 57 行:空 HOME 全套 cucumber 唯一的失敗是 05 phase-3 第一個場景,原因是步驟文字撞到 07 phase-3 的定義。
- 縮短版今天:
  - **沒有任何程式寫 `.short.md`**,`reteach.short` 沒有呼叫端;
  - 讀的那邊已經有:`packages/core/src/session/io.ts` 的 `findCardFile`(`short: true`)與 `shortCardExists`,以及 `present.ts` 的 `usedOriginal` 退路;
  - 契約 §2 已經定了檔名(`cards/<category>/<id>.short.md`)與上限(`settings.short_body_limit`,預設 50)。
- `packages/core/prompts/` 今天只有 `ingest/` 一個資料夾;`grade.apply` 的 prompt 寫在程式裡。
