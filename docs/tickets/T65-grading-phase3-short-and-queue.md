---
id: T65
deps: []
touches: [packages/core/src/grading/reteach-short.ts, packages/core/src/grading/index.ts, packages/core/prompts/grading/reteach-short.md, packages/core/src/prompt-quality/golden-sets/registry.ts, packages/core/src/prompt-quality/types.ts, packages/core/src/prompt-quality/structural-checks.ts]
cpu: light
budget_usd: 2
status: dispatched
owner: worker-grok
must_catch:
  - 縮短版的 body 超過 short_body_limit 還寫進檔(字數量的是讀回來的 body) 字數那條必須紅
  - 三次都太長時沒留最短的那個、或沒記 warning 三次都太長那條必須紅
  - 三次以內有一次夠短卻還繼續重試 第二次就夠短那條必須紅(呼叫次數)
  - 模型在 body 裡自己放 example 圍欄,讀回來 examples 不是剛好一個卻寫了檔 來回檢查那條必須紅
  - body 或 example 是空字串(trim 之後)卻當成好的 空欄位那條必須紅
  - prompt 裡沒有原卡的 body 或 examples,或重試的 prompt 沒寫上一次幾字與上限 prompt 那兩條必須紅
  - 三次都格式壞時丟錯、寫了檔、或進了佇列 三次都壞那條必須紅
  - 有好有壞時沒在好的裡面留最短的 有好有壞那條必須紅
  - 縮短版不是寫在原卡同一個分類資料夾的 id.short.md,或不是原子寫入,或 frontmatter 的 id 變了 寫檔那條必須紅
  - 沒寫檔卻進了佇列 沒寫檔那幾條必須紅(佇列檔不變)
  - 佇列的 local_sha256 不是寫進檔那一次的回應 留下的不是最後一次那條必須紅
  - 留下的那次是本機的,檔案卻沒標 provisional 或沒進佇列;留下的那次是雲端的,卻標了或進了 離線與在線那兩條必須紅
  - grading 底下從 ingest 只准 import card-file.js(prompts、errors 等都不准) import 守門必須紅
  - 改了 prompt 卻沒跑 golden、或拿有未提交修改的 prompt 寫進 golden 基準目錄 驗收必須擋下
  - 實作動到 touches 以外的檔 不動的地方那條 diff 必須有輸出
---

# 工單 T65:05-grading phase-3——縮短版生成

> 狀態:起草 2026-10-27,依協調者 2026-10-27 的交代(03 phase-3 已 done,佇列 API 已在 main `92c0e87`)。顧問 2026-10-27 裁 D1–D4 都選甲,補了幾條規則(見最後「顧問裁定」)。**05 phase-3 已拆好**(這個分支上的 `docs(05)` commit,ADR-084),現在是 `ready`。規格:UI/Tauri 負責人(代筆)。編號 T65:協調者配的。
> **優先做這張**:它解開 06 phase-4 → I5。
> 實作:worker(opencode + grok-4.7);紅測試、步驟定義、golden 輸入與 `--fake` 回應:測試 agent;驗收(含變異、live golden):驗收 agent。

## 為什麼有這張(已經解開的循環)

拆之前,05 phase-3 是「離線審核、複審修正、縮短版生成」三件事,gate 是 I5 通過。可是:

- I5 需要 06-test-card/phase-4(縮短版重教);
- 06 phase-4 需要 05 phase-3 `done`(它的場景「A missing shortened version is generated」);
- 05 phase-3 又要 I5 通過。

三個都開不了工。顧問裁 D1 甲,拆成兩個 phase(ADR-084):

| phase | 場景(`.feature`) | gate | 狀態 |
|---|---|---|---|
| **05 phase-3** = 縮短版生成 | `features/05-grading/phase-3.feature` 的 3 個場景(拆之前的場景 7–9),tag `@i5 @grading @phase-3` | 自身 phase-2、03 phase-3 | **ready**(這張) |
| 05 phase-4 = 離線審核、複審修正 | `features/05-grading/phase-4.feature` 的 6 個場景(拆之前的場景 1–6),tag `@i6 @grading @phase-4` | 自身 phase-3、04 phase-2、03 phase-3、I5 通過 | todo(之後) |

場景文字一個字都沒改,只搬家。這張只做 phase-3 的三個場景:

1. 生成縮短版;
2. 太長就重生;
3. 離線的縮短版標 provisional 並進佇列。

## 要的結果

### 1. 新檔 `packages/core/src/grading/reteach-short.ts`

```ts
generateShort(args: {
  learningDir: string;
  card: Card;                 // 原卡(frontmatter、body、examples)
  router: LlmRouter;          // 原樣傳進來,不包 recordProvisional
  shortLimit: number;         // settings.short_body_limit,呼叫端讀好傳進來(05 不讀設定檔)
  queue?: ProvisionalQueue;   // 不給就用 provisionalQueuePath(learningDir)
  log: LogAppender;
}): Promise<
  | { kind: 'written'; path: string; provisional: boolean; attempts: number }
  | { kind: 'failed'; attempts: 3 }
  | { kind: 'no-model' }
>
```

**prompt**:

- 模板用自己的路徑讀:`join(import.meta.dirname, '../../prompts/grading/reteach-short.md')`。不用 `ingest/prompts.ts`(import 守門不准);
- 模板後面接原卡的 body 與每一個 example(場景 1 要 prompt 裡有原卡的 body 與 examples);
- 第二次與第三次的 prompt,最後多一行「上一次 N 字,上限 L」(N 是上一次讀回 body 的字數,L 是 `shortLimit`);
- task 用 `reteach.short`(§7 本來就有,不加新的)。

**每一次嘗試**(最多三次):

1. 呼叫 `router.call('reteach.short', prompt)`。
2. 回應要是 JSON 物件,有 `body` 與 `example` 兩個鍵(D3)。
   - 兩個都要是字串,而且 trim 之後不是空的;
   - 多的鍵忽略。
   不合就是**格式壞**,這一次算失敗。
3. **來回檢查**:
   - 用 `renderCardFile({ frontmatter, body, examples: [example] })` 組出要寫的檔;
   - 再用 01 的 §2 解析器(`parseCardText`)讀回來;
   - 讀回的 `examples` 一定要剛好 1 個,**而且那個 example 跟模型給的 `example` trim 之後一樣**,不是也算**格式壞**。這是防模型在 body 裡自己放 example 圍欄,也防 body 末尾沒關的圍欄吞掉真的 example(顧問同意,驗收缺口 G2);
   - 字數用 `countWords` 量**讀回來的 body**(跟教學卡同一把尺,契約 §2)。
4. 格式好而且 `字數 ≤ shortLimit` → 停,不再試。
5. 格式好但太長 → 記下來,再試(場景 2)。

**三次之後**:

- **有夠短的**:寫那一次。
- **都格式好、都太長**:寫字數最少的那一次,記一筆 `warning`(`reason: 'reteach_short_overlong'`,帶每一次的字數)。
- **有好有壞**:只在格式好的那幾次裡面挑。有夠短的就寫夠短的;都太長就留最短的,同樣記 overlong 的 warning。
- **三次都格式壞**:
  - 不丟錯;
  - 回 `{ kind: 'failed', attempts: 3 }`;
  - 記一筆 `warning`(`reason: 'reteach_short_bad_response'`);
  - 不寫檔、不進佇列。
  06 phase-4 照 `usedOriginal` 退回原卡。

**寫檔**:

- 位置:`cards/<原卡的分類>/<原卡 id>.short.md`,跟原卡同一個資料夾(場景 1);
- 內容:就是來回檢查組出來的那一份。frontmatter 照抄原卡,`id` 不變(lint 的 `packages/core/src/lint/scan.ts` 第 67、152 行跳過 `.short.md`,不會跟原卡撞);`provisional` = **留下的那一次**的 `provisional`;
- 用 `writeFileAtomic`(§11b 的寫法)。已經有縮短版就覆寫。06 phase-4 的「已經有就重用」由呼叫端決定要不要叫這個函式。

**佇列**(場景 3):

- **不要用 `recordProvisional` 包 router**。三次重試加留最短,包的話佇列記的是最後一次,不是留下的那一次;沒寫檔的時候也會留一筆。
- 改成:**寫完檔之後**,留下的那一次是 `provisional` 的,才呼叫 `queue.enqueue` 一次:
  - task `reteach.short`;
  - card 是原卡 id;
  - prompt 與 localText 是**留下的那一次**的 prompt 與回應 text。
- 留下的那次是雲端的:不進佇列、檔案不標 provisional。

**沒有模型**:離線而且閘道也不通,router 丟 `NO_MODEL` → 回 `{ kind: 'no-model' }`,不寫檔、不進佇列。

### 2. `packages/core/src/grading/index.ts`

匯出 `generateShort`。

### 3. 新 prompt `packages/core/prompts/grading/reteach-short.md`(D4)

- 要的東西:一張卡的縮短版,body 在上限以內,剛好一個例子,用不同的說法講同一個概念。上限數字由程式帶進去,不寫死在 prompt。
- 只回 JSON `{ "body": "…", "example": "…" }`;不要在 body 裡放程式碼圍欄或 example 圍欄。
- worker 寫,golden 評分歸顧問。
- `packages/core/prompts/` 的落點是 02(owners 不改),R2 照排。

### 4. golden set(`packages/core/src/prompt-quality/golden-sets/registry.ts`)

- 加一組 `reteach.short`:`task` 是 `reteach.short`,`promptFile` 是上面那個檔。
- 三個輸入:非資安的公開常識卡,照 T55 的做法。輸入與 `--fake` 回應由測試 agent 寫(已交:`fixtures/golden-short/inputs.json`、`fixtures/llm/reteach.short.golden-short-*.json`)。
- 登記項的位置、輸入的 header 格式(`golden`/`category`/`title`/`limit: 50` 四行,後接原卡 body 與 examples)寫在 `golden-sets/registry-t65.test.ts` 的檔頭,照它做,不要自己發明。
- `types.ts` 的 `GoldenSetId` 加 `'reteach.short'`(不加 registry.ts 過不了 tsc,T55 先例)。
- `structural-checks.ts` 的 `checkCardShape`(顧問裁定):`typeof obj.example === 'string'` 就是縮短版形狀,不要求 title;縮短版形狀的 body 上限用 50(契約 §2 `short_body_limit` 預設),超過記 `body-too-long`、detail 寫上限 50。一般卡(要 title、上限 100)一個字都不變。測試在 `structural-checks-t65.test.ts`。

**呼叫端不在這張**:06 phase-4 的「介面載入時沒有縮短版就生成」是 06 那張工單接。這張只交 `generateShort`。

## 派工前(協調者)

- **import 例外的 chore commit**(D2 甲,ADR-084):
  - `scripts/boundaries.allow.json` 加 `05-grading → 02-ingest-pipeline`,理由「只 import card-file.ts 的 renderCardFile(ADR-082 唯一寫卡函式,純函式只 import yaml)」;
  - 照 T43 的先例(`f6a9255`),放在起點分支**最底下**,不是 worker 做。
- **跟著它的測試改動**:`features/support/t31-static.test.ts` 第 29 行 `BASE_ALLOW_ENTRIES = 25` 改成 26,加一行來源註解(T65 / ADR-084)。由測試 agent 改,跟 allow 那條同一批(紅測試的第一個 commit)。

## 紅測試(測試 agent)

- **步驟**:`features/05-grading/phase-3.feature` 的三個場景。
  - 學習資料夾用暫存目錄,雲端用假的,閘道用假的 client(照 T59);
  - 子行程(如果有)照 T62 的煞車三件事;`XDG_*` 指暫存。
- **步驟文字撞名**:下面幾句已經在別的步驟檔定義了,要照 `features/steps/i2-review-loop.steps.ts` 第 197 行與 T59 的「依 tag 分派」共用,不能再定義一次:
  - `the network is available`(`grading.steps.ts`);
  - `the network is unavailable`(`i1-content-pipeline.steps.ts`、`teach-card-phase3.steps.ts`);
  - `the network is unavailable and a local model is running`(`teach-card-phase3.steps.ts` 第 198 行)。這句在 05 phase-4 的第一個場景。今天 cucumber 空 HOME 全套唯一的失敗就是它(07 phase-3 的定義丟「還沒有 phase-3 的世界」)。phase-4 這張不做,但分派要先留好,不要讓它更難接。
- **import 守門**(建議放 `features/support/t65-grading-imports.test.ts`):`packages/core/src/grading/` 底下的非測試檔,從 `ingest/` 只 import `card-file.js`。附合成的壞樣本:import `ingest/prompts.js`、`ingest/errors.js` 要紅。
- **單元**(建議 `packages/core/src/grading/reteach-short.test.ts`,假 router、暫存目錄):
  - **prompt**:有原卡的 body 與每一個 example;第二次的 prompt 最後一行是「上一次 N 字,上限 L」,N 對、L 對;
  - **次數**:第一次就夠短叫 1 次;第二次夠短叫 2 次就停;
  - **三次都太長**:寫最短的那次、記 `reteach_short_overlong`、叫 3 次;
  - **來回檢查**:回應的 body 裡放一個 example 圍欄 → 讀回 examples 不是 1 個 → 這次算格式壞;
  - **空欄位**:body 或 example 是空白字串 → 格式壞;多的鍵不影響;
  - **三次都格式壞**:回 `failed`、記 `reteach_short_bad_response`、沒有 `.short.md`、佇列檔不變;
  - **有好有壞**:例如第 1 次壞、第 2 次太長、第 3 次壞 → 寫第 2 次、記 overlong;
  - **寫檔**:路徑、frontmatter 照抄(`id` 不變)、`provisional` 等於留下那次的值、經過 `writeFileAtomic`;
  - **離線**(留下的那次是本機):檔案標 provisional;佇列剛好一筆,task、card 對,`local_sha256` 等於**寫進檔那一次**的回應 text 的雜湊。另做一條:三次都是本機、留下的是第 1 次,佇列記的是第 1 次,不是第 3 次;
  - **在線**:佇列不變、檔案不標;
  - **`NO_MODEL`**:回 `no-model`、不寫檔、佇列不變。
- **改既有測試**:`features/support/t31-static.test.ts` 第 29 行 25 → 26,加來源註解(上面「派工前」)。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 單元 | `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/grading/ packages/core/src/prompt-quality/ features/support/t31-static.test.ts`,加上新測試檔 | 全綠 |
| 場景 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@grading and @phase-3 and not @manual' --format summary` | 3 個場景全過。不退步:`--tags '@grading and not @manual and not @llm'`(重活,拿位子) |
| 守門 | `npm run typecheck`、`npm run boundaries` | 全過;例外條數 26(派工前那一條) |
| golden(fake) | `npx tsx scripts/prompt-check.ts --golden --set reteach.short` | 退出碼 0 |
| golden(live) | T63 已合併,golden live 自己會擋日上限。跑前仍先跑 `npx tsx scripts/llm-spend.ts --today`,**退出碼 1 就不跑**。再跑 `npx tsx scripts/prompt-check.ts --golden --set reteach.short --live --out <golden 基準目錄以外的暫存目錄>`,prompt 要是已提交的版本 | 跑完;花費照 T55 的估法,一輪約幾美分。人的評分交顧問(照 `golden/ingest.cards/2026-10-15/SCORES.md` 的格式:更短、同一個概念、例子具體、剛好一個例子) |
| 變異 | `npm run mutate -- stryker.t65-reteach-short.json`(驗收 agent 加,`mutate` 放 `reteach-short.ts`) | ≥ 80%(LLM 相關,05 的標準門檻) |
| 真資料 | `learning/` 前後三項 | 相同 |
| 不動的地方 | `git diff --stat <紅測試分支的 tip>..HEAD -- contracts docs ':(exclude)docs/reviews' ':(exclude)docs/tickets' 'features/**/*.feature' packages/core/prompts/ingest packages/core/src/grading/grade-apply.ts packages/core/src/grading/grade-fill.ts packages/core/src/llm packages/core/src/session packages/core/src/ingest scripts` | 沒有輸出。`docs/reviews`(驗收證據)與 `docs/tickets` 排除 |

## 受保護的檔(開發 worker 不改)

- 測試、`features/**`、`.feature`、`contracts/`、`docs/`、`scripts/boundaries.allow.json`(派工前的 chore commit 不是 worker 做)。
- `grade-apply.ts`、`grade-fill.ts`、`packages/core/src/session/`、`packages/core/src/llm/`、`packages/core/src/ingest/`(含 `card-file.ts`:只 import,不改)、`packages/core/prompts/ingest/`。

## 落點

- `packages/core/src/grading/` → 05-grading;`packages/core/prompts/` → 02-ingest-pipeline;`golden-sets/registry.ts` → 12-prompt-quality。
- import:
  - 05 → 03:`ProvisionalQueue`、`provisionalQueuePath`,本來就有;
  - 05 → 01:`countWords`、`parseCardText`、`writeFileAtomic`,本來就有;
  - **05 → 02:只有 `card-file.js` 的 `renderCardFile`**,派工前那條例外。
- R2:有 02 與 12 兩個落點。派工時不能跟別的碰 02 或 12 的工單並行(協調者排)。

## 顧問裁定(2026-10-27)

- **D1 甲:拆 phase**。理由是 I5 → 06 phase-4 → 05 phase-3 → I5 的循環。拆法照上面的表,文件改動與 ADR-084 在這個分支的 `docs(05)` commit:
  - 05 FEATURE/NEXT;
  - phase-3 / phase-4 兩個 `.feature`;
  - 09 FEATURE/NEXT 的 05 phase-3 → phase-4;
  - 03 NEXT 第 50 行;
  - roadmap 的 I5、I6 表與現況表。
  03 的 REVIEW.md 第 256 行是歷史紀錄不改;06 的 FEATURE/NEXT、02 FEATURE 第 20 行不改。
- **D2 甲:開 05 → 02 例外**,只准 import `card-file.ts` 的 `renderCardFile`。allow 的 chore commit 由協調者在派工前放在起點分支最底下(照 T43 `f6a9255`);`t31-static` 25 → 26 由測試 agent 補來源註解,跟 allow 同一批。另加一條靜態紅測試:grading 底下從 ingest 只 import `card-file.js`。prompt 用自己的路徑讀。
- **D3 甲:回應 `{ body, example }`**,再補:
  - 兩個都要是 trim 後不空的字串,多的鍵忽略;
  - 寫之前做來回檢查(`renderCardFile` 結果用 01 的 §2 解析器讀回,examples 剛好 1 個,字數量讀回的 body,不合算一次失敗);
  - 重試的 prompt 後面加一行「上一次 N 字,上限 L」;
  - 三次都格式壞不丟錯,回 `failed`,記 `reteach_short_bad_response`,不寫檔、不進佇列;
  - 有好有壞就在好的裡面留最短的。
  - **佇列不要用 `recordProvisional` 包**,改成寫完檔、留下的那次是 provisional 才 `enqueue` 一次。
  - frontmatter 照抄原卡(`id` 不變),`provisional` = 留下那次的值。
- **D4 甲:prompt 放 `packages/core/prompts/grading/reteach-short.md`**,owners 不改(R2 照排)。golden live:T63 已合,golden 自己會擋上限;跑前仍先 `llm-spend --today`,退出碼 1 就不跑。評分交顧問。
- 步驟文字撞名:照 i2 / T59 的依 tag 分派共用(測試 agent)。

## 給之後 05 phase-4 的分析(拆之前的場景 1–6,這張不做)

協調者問的幾件事,先寫下來,給 phase-4 的工單用:

- **`grade.apply` 怎麼接佇列**:
  - `gradeApply(question, answer, router)` 不知道卡片 id(`grade-apply.ts` 第 199 行),知道卡的是 session 那層(`packages/core/src/session/answer.ts` 的 `submitAnswer`)。
  - 注意跟這張一樣的陷阱:`gradeApply` 回應壞掉會重試一次。用 `recordProvisional` 包的話,佇列記的是最後一次呼叫。最後一次還是壞的話,佇列會留一筆沒有用到的結果。
  - phase-4 要決定:照 T59 的包法,還是像這張一樣,批完、確定用了哪一次才 `enqueue`。佇列路徑是 `provisionalQueuePath(learningDir)`。
- **卡片的鍵**:`card` 是被考的那張卡的 id,task 是 `grade.apply`。T59 的規則是同一張卡同一個 task 只留最新一筆。一天只考一次的話通常夠,phase-4 再確認。
- **`changed` 誰給**:grading 給。本機的 `pass` 跟雲端重批的 `pass` 不同就是 `true`(T59 的 D3)。
- **`drain`、`resolve` 誰叫、什麼時候叫**:09-lint phase-2 的 `lint --reconcile`。
  - 在線才 `drain`,逐筆拿 prompt 給雲端重放,交給 grading 算修正,再 `resolve`;
  - **重放一定只走雲端**(可以用 T63 那種七個 task 全 `cloud-only` 的備援表);
  - 05 要提供的是「拿到雲端的結果之後,怎麼改 reviews.json」那一段(phase-4 的場景 3–6);
  - 怎麼對到 history 裡那一筆(`ReviewEntry.date` 只到日,佇列的 `queued_at` 到毫秒),phase-4 要定。
- **哪些場景要真機**:兩個 `.feature` 都沒有 `@manual`,9 個場景都可以用假閘道與假雲端自動跑。等閘道真的起來,可以再加一條真閘道的觀察:
  - 做法見 T59:暫存驗證帳本、上限 US$1、種一筆今天已花 US$1 的 openai `llm_call`;
  - **不要用 `LLM_DAILY_CAP_USD=0`,那是沒設上限**。
  - 不擋 done。

## 低優先小票清單(協調者不另建清單檔,記在工單裡)

- **05 phase-4 的工單**:離線審核與複審修正,gate 等 I5。上面「給之後 05 phase-4 的分析」就是它的起點。
- **主題生成的 examples 是濾掉非字串**(T61 的 D1 註):要不要跟 ingest 一樣改成拒絕,另開票。

## 預算

`budget_usd: 2`(一個新模組、一個 prompt、一組 golden;grok 不設停止線,只記錄)。LLM 花費:驗收的一次 live golden,約幾美分,在日上限以內,不用問使用者。`cpu: light`;cucumber、變異、live golden 是驗收的事,協調者排位子。

## worktree

- 分支順序(由下往上):
  1. main(含這個分支的 `docs(05)` commit 與這張工單);
  2. 協調者的 allow chore commit;
  3. 測試 agent 的紅測試(第一個 commit 含 `t31-static` 25 → 26);
  4. 開發 worker 的實作。
- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,沒有 `.env`。派工歸協調者。

## 起草時查的(只讀)

- 拆之前:`npx tsx scripts/dag.ts --root .` 印 `BLOCKED 05-grading/phase-3 by I5`;I4 也還沒過。
- 拆之後(這個分支):
  - `READY 05-grading/phase-3`;
  - `BLOCKED 05-grading/phase-4 by 05-grading/phase-3,I5`;
  - `BLOCKED 06-test-card/phase-4 by 05-grading/phase-3,I4`;
  - `BLOCKED 09-lint/phase-2 by 05-grading/phase-4,I5`;
  - problems=0。
- `docs/reviews/acceptance-T60-impl.md` 第 57 行:空 HOME 全套 cucumber 唯一的失敗是拆之前 05 phase-3 的第一個場景(現在在 phase-4),原因是步驟文字撞到 07 phase-3 的定義。
- 縮短版今天:
  - **沒有任何程式寫 `.short.md`**,`reteach.short` 沒有呼叫端;
  - 讀的那邊已經有:`packages/core/src/session/io.ts` 的 `findCardFile`(`short: true`)與 `shortCardExists`,以及 `present.ts` 的 `usedOriginal` 退路;
  - 契約 §2 已經定了檔名(`cards/<category>/<id>.short.md`)與上限(`settings.short_body_limit`,預設 50)。
- `packages/core/prompts/` 今天只有 `ingest/` 一個資料夾;`grade.apply` 的 prompt 寫在程式裡(`grade-apply.ts` 第 126 行)。
