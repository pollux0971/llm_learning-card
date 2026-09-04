# 11-review-cli / phase-1 審核報告

審核日期:2026-09-03
審核範圍:`packages/core/src/session/`(build/present/answer/summary/io)、`scripts/review.ts`
門檻:標準級 80%(FEATURE.md 已定案)

## 結論:FAIL

自動化測試(單元 + cucumber + boundaries + typecheck)全綠,Stryker 實測分數 **82.30%**、
超過 80% 門檻。但邏輯對照場景時發現一個**會讓互動 session 當掉的真實 bug**,不是理論上的
邊界案例,是 stage 2 卡片「兩題都答對」這條最常見的成功路徑——這條路徑目前沒有任何
phase-1.feature 的 scenario 覆蓋到,所以 14/14 cucumber 全過並不代表這裡沒問題。

## 1. 阻擋接受的問題:stage 2 兩題都過會丟未捕捉例外

**位置**:`packages/core/src/session/answer.ts:140-143`

```ts
} else if (overallPass) {
  throw new Error(
    `已知的 04-scheduler 介面缺口:applyPassTransition 只接受單一 type/grader,無法一次記錄...`,
  );
}
```

**成因**:04-scheduler 的 `applyPassTransition(review, ctx: PassCtx)`(`packages/core/src/scheduler/transitions.ts:39`)
簽章只吃單一 `{ type, grader }`,一次只記一筆 history、只推進一次 stage。它沒有像
`applyFailTransition` 的 `FailCtx.answers: FailAnswer[]` 那樣「一次 checkpoint 多筆結果」的介面。
stage 2 的 checkpoint 是 `['fill', 'apply']` 兩題,兩題都答完才 resolve(`CurrentQuestion.pendingAnswers`
會有 2 筆)。

- 兩題其中一題錯 → `applyFailTransition` 吃得下 2 筆 answers,這條路徑**正確**,
  也是唯一被 phase-1.feature 測到的 stage-2 路徑(「A card at stage two is only resolved
  after both questions」)。
- 兩題都對 → `overallPass=true` 且 `pendingAnswers.length===2`,現有程式碼直接 `throw`。

**實際影響**:`scripts/review.ts` 的 `main()` 只在最外層 `.catch()` 印錯誤訊息、`process.exit(1)`
(`scripts/review.ts:109-112`)。這代表:使用者複習一張 stage 2 的卡,填空題跟應用題**都答對**
(這是最常見、最該慶祝的路徑,不是邊界情況)——整個互動 session 會直接崩潰結束,那張卡的
通過結果完全沒寫進 `reviews.json`(卡在 undefined 狀態:pendingAnswers 有兩筆但沒有任何
transition 被套用),之前已經答對/答錯的其他卡片(已逐題落地)不受影響,但當次 session
的剩餘卡片全部問不到。

寫這段程式碼的人已經在註解裡承認是「已知的介面缺口」並打算「回報給使用者」,但沒有停下來
真的回報,也沒有在 phase-1.feature 補一個對應場景讓這個缺口在驗收層被看見——這是為什麼
14/14 cucumber 綠燈沒能攔住它。

**不是我(審核 agent)能就地修的原因**:正確修法要改 04-scheduler 的 `PassCtx`/`applyPassTransition`
簽章(讓它像 `FailCtx` 一樣接受 `answers[]`),04-scheduler 是別的 phase、已經標記完成、有自己的
契約與變異測試基準,不該在 11-review-cli 的審核裡順手動它。這屬於 CLAUDE.md 硬規則 1 說的
「函式簽章」軟約定,可以改,但要走正常流程(讓 04-scheduler 那邊補簽章 + 補測試 + commit 說明,
或走 `/decide` 記一筆決定),不是我在審核當下代勞。

**建議**:退回開發,選項之一:
1. 對稱 `FailCtx`,把 `PassCtx` 也改成接受 `answers: {type, grader}[]`(stage 1/3/4/5 傳長度 1 的
   陣列,stage 2 全過傳長度 2),`applyPassTransition` 一次寫多筆 history、只推進一次 stage。
2. 或在 11-review-cli 這層自己組出等價的 `Review` 更新(不呼叫 04 的函式),但這樣邏輯會跟
   04-scheduler 重複,不建議。
並且要在 phase-1.feature 補一個「stage 2 兩題都答對」的 scenario,不能只靠程式碼審查抓到。

## 2. 其餘邏輯對照(除上述缺口外都是真實作)

讀了 `features/11-review-cli/phase-1.feature`(15 scenarios)、`packages/core/src/session/{build,present,answer,summary,io}.ts`
與對應測試、`scripts/review.ts`。任務指定要特別檢查的幾點:

- **答案是否逐題立即寫**:是。`submitAnswer` 在同一次呼叫內完成「grade → transition →
  `loadReviews`/`saveReviews`(整份覆寫,`writeFileAtomic` 硬規則 5)→ 更新 session 計數」,
  回傳前磁碟已經是新狀態。沒有任何「等 session 結束才批次寫」的路徑。
  `answer.test.ts`「answers land one at a time」直接驗證:5 張卡只答 2 張、模擬 process 被殺,
  磁碟上剛好只有那 2 張變了,其餘 3 張跟建立時一模一樣。
- **stage-2 checkpoint 兩題都答完才 resolve**:第一題答完(`status:'partial'`)不寫檔——
  已驗證且正確。但「兩題都答完」這個判斷本身沒問題,問題出在都通過時的 resolve 邏輯(見上一節)。
- **grading 錯誤不寫 transition 但繼續下一題**:正確。`result.pass===null` → `hadError=true`,
  最後一題結束時若 `hadError` 就整個 checkpoint 不呼叫任何 04 的 transition、不寫檔,只把
  `session.errors+=1`、把卡從 queue shift 掉,回傳 `status:'error'`,呼叫端印訊息後繼續迴圈
  問下一張卡(`scripts/review.ts` 的 `runInteractive` 沒有在 `status==='error'` 時 break)。
  `answer.test.ts`「submitAnswer — grading error」與 phase-1.feature 對應場景都測到。
- **明日預估是否考慮 daily_cap**:是。`estimateTomorrow`(`summary.ts`)`total = dueTomorrowExcludingReturns
  + returnedToday`,超過 `dailyCap` 時 `capped=true、shown=dailyCap、overflow=total-dailyCap`,
  `renderSummary` 對 capped 情況印出上限與溢出張數,對應 phase-1.feature「The estimate accounts
  for returns and the cap」(4+2=6 且超過上限時報上限與溢出)。session 建立當下的 due 清單本身
  也是透過 04 的 `selectSession({ dailyCap })` 決定,沒有自己重算上限邏輯。
- **process 被 kill 時磁碟狀態**(「Answers land one at a time」):同第一點,已驗證 exactly
  已答完的卡片落地,其餘完全不動,佇列裡剩下的卡片正確保留。

其餘場景(dry-run 順序與不寫檔、nothing due、progress 顯示、fill 逗號分隔、apply 多行、
stage 1 答對進 stage 2、stage 3 答錯退 stage 1、reteach 提示不算進 progress、stuck 提示)
逐一核對實作與對應測試,都是真的實作,不是掛名。

## 3. 自動化測試結果

| 項目 | 指令 | 結果 |
|---|---|---|
| npm ci | `npm ci` | 成功(433 packages) |
| boundaries | `npm run boundaries` | ✓ 無違規(掃描 169 檔案) |
| typecheck | `npm run typecheck` | ✓ 無錯誤 |
| 單元測試 | `npx vitest run` | ✓ 61 files / 892 tests all passed |
| cucumber phase-1 | `cucumber-js --tags "@review-cli and @phase-1 and not @manual"` | ✓ 14 scenarios / 84 steps all passed |
| cucumber dry-run(全專案) | `cucumber-js --tags "not @manual" --dry-run` | ✓ **0 ambiguous**(164 undefined 屬於未開工的未來整合場景 如 I8-windows,非本次範圍) |

## 4. 變異測試(Stryker)

範圍:`packages/core/src/session/**/*.ts`
指令:`npx stryker run --mutate "packages/core/src/session/**/*.ts,!packages/core/src/session/**/*.test.ts"`

**分數 82.30%**(達 80% 門檻):189 個有效變異中 92 killed、1 timeout、17 survived、3 no coverage,
另有 77 個被 TypeScript checker 判定型別不合法而自動排除(不算入分數,Stryker 正常行為)。

| 檔案 | mutation score | 備註 |
|---|---|---|
| answer.ts | 83.33% | 見下方存活清單 |
| build.ts | 83.33% | |
| io.ts | 90.48% | |
| present.ts | 70.00% | 最低,見下方 |
| summary.ts | 83.33% | |

門檻已達標,依任務指示「未達標才需逐條處理存活變異」的規範不強制要求本輪補測試,
以下列出 17 個存活變異供之後 phase-2 或補測試參考,已快速分類但**未動手修**:

| 檔案:行 | 變異 | 初步分類 |
|---|---|---|
| `answer.ts:153` `session.failed += 1` → `-= 1` | AssignmentOperator | 真漏測:沒有任何測試斷言 `session.failed` 的值 |
| `build.ts:15` fixtures 路徑字串清空 | StringLiteral | 低價值:只影響預設 router 找不到 fixture 目錄時的路徑,production 常數 |
| `io.ts:84` `if (existsSync(cardsDir))` → `if(true)` | ConditionalExpression | 真漏測:沒測過 `cards/` 目錄整個不存在的情況 |
| `io.ts:90` 錯誤訊息字串清空 | StringLiteral | 低價值:錯誤訊息內容沒被斷言,無關邏輯 |
| `present.ts:49`(×3:false/true/!==) | ConditionalExpression/EqualityOperator | 真漏測:`type==='fill'` 分支邏輯在 present.test.ts 沒有直接針對 apply 分支斷言到位 |
| `present.ts:49` 整個 if block 清空 | BlockStatement | 同上,真漏測 |
| `present.ts:82` `session.current` 續問分支 | NoCoverage(BlockStatement) | 真漏測:stage-2 第二題透過 `presentNextCard`(不是直接構造 current)重新呈現的路徑沒被測到 |
| `present.ts:103` `hadError:false` → `true` | BooleanLiteral | 真漏測:新建 `current` 的初始 `hadError` 沒被斷言 |
| `summary.ts:44`(×2) `errors>0` 條件 | ConditionalExpression/EqualityOperator | 真漏測:`errors===0` 不印錯誤行、`errors===1`(邊界)沒都測到 |
| `summary.ts:48` `join('\n')` → `join('')` | StringLiteral | 真漏測:斷言用 `toContain`,沒驗證分行 |
| `summary.ts:60` 同上(renderDryRun) | StringLiteral | 同上 |

## 5. 變更檔案

- 新增 `features/11-review-cli/REVIEW.md`(本檔案)。
- 沒有修改任何實作或測試檔案——本輪只做審核,未修復第 1 節的阻擋問題。

## 6. 人工確認清單

- [x] **阻擋項**:04-scheduler 的 `applyPassTransition`/`PassCtx` 已對稱 `FailCtx` 補上
      `answers[]` 介面,`answer.ts` 的 resolve 邏輯已換成真正呼叫,見下方第二輪審核。
- [ ] `@manual` 場景「The session is pleasant enough to use daily」需要真人手動跑,不在這次審核範圍。
- [ ] 存活變異(第 4 節、第 7 節)雖不擋門檻,建議之後補測試。

---

## 第二輪覆核(2026-09-03,commit 8006957 之後)

範圍擴大為兩個模組:`packages/core/src/scheduler/transitions.ts`(嚴格 95%)、
`packages/core/src/session/**`(標準 80%,`answer.ts` 本輪改了)。

### 結論:PASS

## 7. 修復驗證

第 1 節的阻擋問題已修復。核對 `packages/core/src/scheduler/transitions.ts` 的
`PassCtx`/`applyPassTransition`(commit 4b26d11)與 `packages/core/src/session/answer.ts`
的 `submitAnswer`(commit 8006957):

- `PassCtx` 新增 `answers: PassAnswer[]`,對稱 `FailCtx.answers`。`applyPassTransition`
  只算一次 `newStage`/`next_due`,但 `history` 用 `ctx.answers.map(...)` 把每一筆答案各自
  append 一條獨立 `ReviewEntry`(`date`/`stage`/`type`/`pass:true`/`grader`),`stage` 欄位用
  的是**推進前**的 `review.stage`——符合契約 §4 `ReviewEntry` 的硬約定與檔案頂端註解的說明。
- `answer.ts` 的 `submitAnswer` 不再 `throw`,`overallPass` 分支呼叫
  `applyPassTransition(review, { card, today, answers: pendingAnswers })`,跟
  stage 1/3/4/5(單題)、stage 2 全過(兩題)走同一條路徑,不分岔。
- 新場景核對(直接讀原始碼 + 跑過,非紙上核對):
  - `features/04-scheduler/phase-2.feature`「At stage two both questions passing advances
    the card once」↔ `features/steps/scheduler.steps.ts:292-306` 直接呼叫
    `applyPassTransition` 兩筆 answers,`Then` 斷言(`:496-502`)`history.length===2` 且兩筆
    entry 內容各自正確(`stage:2` 對兩筆都成立,因為都是推進前的 stage;`pass:true`;
    `grader` 分別是 `exact`/`cloud`)、`stage` 只推進到 3(對應間隔表 D30,`next_due` 是
    2026-10-10 = 2026-09-10 + 30 天)。**沒有「答一題進一階」的痕跡**。
  - `features/11-review-cli/phase-1.feature`「A card at stage two advances after both
    questions pass」↔ `features/steps/review-cli.steps.ts:527-568`。這裡刻意只驗證
    session 層該有的行為(不當機、correctly 推進到下一題),history/stage 細節的重複驗證
    留給上面 04 的場景(feature 檔案本身的註解說明了這個分工),避免同一件事驗兩次。
    註:該步驟檔第 511-518 行留有一段舊註解說「這個場景現在預期是紅燈」「TODO 下一輪實作」,
    是修復前寫的、已經過時(現在是綠燈),建議之後開發順手清掉,不影響本次驗收結論。
  - `transitions.test.ts` 裡「stage 2 兩題都過時只推進一次 stage,但兩筆答案都各自記進
    history」與 `answer.test.ts` 裡「stage 2 checkpoint, both questions pass ... advances
    the stage once and records both answers, instead of throwing」都是真斷言,不是空殼。

### 8. 本輪自動化測試結果

| 項目 | 指令 | 結果 |
|---|---|---|
| npm ci | `npm ci` | 成功(433 packages) |
| boundaries | `npm run boundaries` | ✓ 無違規(掃描 169 檔案) |
| typecheck | `npm run typecheck` | ✓ 無錯誤 |
| 單元測試 | `npx vitest run` | ✓ 61 files / **894** tests all passed |
| cucumber `@review-cli @phase-1` | `cucumber-js --tags "@review-cli and @phase-1 and not @manual"` | ✓ **15** scenarios / 92 steps all passed |
| cucumber `@scheduler @phase-2` | `cucumber-js --tags "@scheduler and @phase-2 and not @manual"` | ✓ **15** scenarios / 61 steps all passed,04 自己沒有回歸 |
| cucumber dry-run(全專案) | `cucumber-js --tags "not @manual" --dry-run` | ✓ **0 ambiguous**(164 undefined 屬於未開工的未來整合場景,非本次範圍) |

### 9. 變異測試(Stryker)——兩邊實測

**`packages/core/src/scheduler/transitions.ts`(嚴格 95%)**

```
npx stryker run --mutate "packages/core/src/scheduler/transitions.ts,!packages/core/src/scheduler/transitions.test.ts"
```

**分數 100.00%**(23 killed、0 timeout、**0 survived**、0 no coverage,另有 21 個被
TypeScript checker 判定型別不合法自動排除)。介面改動(`PassCtx.answers[]`)沒有讓分數退步,
遠超 95% 門檻,沒有存活變異需要處理。

**`packages/core/src/session/**`(標準 80%)**

```
npx stryker run --mutate "packages/core/src/session/**/*.ts,!packages/core/src/session/**/*.test.ts"
```

**分數 83.49%**(達 80% 門檻,較上一輪 82.30% 略升):90 killed、1 timeout、16 survived、
2 no coverage,另有 76 個型別不合法自動排除。

| 檔案 | mutation score |
|---|---|
| answer.ts | 86.84% |
| build.ts | 83.33% |
| io.ts | 90.48% |
| present.ts | 70.00%(最低,`present.ts:49` 的 fill/apply 分支跟 `:82` 續問分支沒被精確斷言,沿用上一輪已知缺口) |
| summary.ts | 83.33% |

門檻已達標,依規範「未達標才需逐條處理」不強制本輪補測試。`answer.ts` 本輪改動
(`submitAnswer` 呼叫 `applyPassTransition` 的新分支)本身沒有引入新的存活變異——存活的
16 個裡,`answer.ts` 佔 4 個,都是既有程式碼(`joinApplyLines` 的迴圈邊界 ×2、
`session.passed`/`session.failed` 計數 ×2),跟本輪改的 `overallPass` resolve 邏輯無關,
延續上一輪報告已記錄的真漏測分類,不是本輪新增的回歸。

### 10. 結論

**PASS**。兩個模組的門檻都達標且沒有退步:

- `scheduler/transitions.ts`:100.00%(門檻 95%)
- `session/**`:83.49%(門檻 80%)

第一輪 FAIL 的阻擋問題(stage 2 兩題都過會 throw)已確認修復,新場景是真實作、非投機取巧,
兩邊 cucumber 全綠、無回歸、無 ambiguous step。存活變異均為已知的低優先級真漏測,可留到
之後補測試,不擋本次驗收。

---
---

# 第三輪審核 — P-29 使用者資料的 0 值守門(2026-09-05)

> 上面第一、二輪審的是 11-review-cli/phase-1 的互動 session 邏輯(2026-09-03)。
> 這一輪審的是另一件事:`review.ts --dry-run` 的 0 值守門,分支
> `pollux0971/user-facing-zero-guard`。兩輪之間沒有推翻關係。


分支 `pollux0971/user-facing-zero-guard`,審核起點 `efa0f95`。
審核 agent 撰寫,對應 commit `efa0f95`(11-review-cli 那一半)。

09-lint 那一半寫在 `features/09-lint/REVIEW.md`。**兩個 steps 檔的覆核寫在那一份**
(第 3 節),這裡不重複,只在第 3 節放一句話結論與指向。
第 6 節的完整驗收清單是**兩份共用**的,放在這一份。

> 這一輪的審核在中途被暫停(WIP commit `7cc0449`),由接手的審核 agent 完成
> `accept:coverage`、`accept:integration` 與這份報告。前一段的實測結論已複驗,
> 沒有推翻。

---

## 1. 結論

**PASS。**

| 項目 | 結果 |
|---|---|
| `review` 變異分數 | **100.00%**(47 個變異,0 存活;基準 75.51%) |
| `lint` 變異分數 | **100.00%**(88 個變異,0 存活;基準 60.23%) |
| `state.router ??= build()` 的判定 | **會讓該紅的變綠**,已改成旗標分流的更小版本 + 4 條單元測試,實測回到紅 |
| `common.steps.ts` 的搬移 | 照 `features/steps/README.md` 規則,**留下** |
| 真 vault `--dry-run` | 印 **25 張卡,0 張到期,25 張未排程**;`state/` 沒有多出 `reviews.json` |
| `standalone.json` | 沒有動 |
| 完整驗收(第 6 節) | 全綠,唯一的紅來自 **base 比 main 舊**,不是這一輪(第 7 節) |

---

## 2. 這一輪修的是什麼

`review.ts --dry-run` 對兩種截然不同的世界印同一句話:

```
25 張卡、今天沒有到期 → Nothing is due today.   exit=0
0 張卡(卡片全部消失) → Nothing is due today.   exit=0
```

第一句是使用者**每天**看到的安心訊息。卡片被同步刪掉、`--dir` 指錯地方、
目錄被搬走的那幾天,他看到的是一模一樣的綠燈,而且會連續好幾天都不知道。

修法兩件:

1. **基數上移**。`--dry-run` 先印 `掃描 N 張卡,N 張到期,N 張未排程。`
   三個數字缺一不可——「0 張到期」同時是「今天剛好沒排到」「全部未排程」
   「卡片全部消失」三種情況的答案。
2. **0 張卡 → exit 1**,說「這個 vault 沒有卡片」,而且**絕不**印
   `Nothing is due today.`。判斷放在 `buildTodaySession` **之前**:
   卡片不見時排程本身也已經沒有意義。互動模式走同一條路徑。

---

## 3. 兩個 steps 檔的覆核(結論)

開發 agent 動了兩個依規矩不該動的檔案並主動申報。完整論證見
`features/09-lint/REVIEW.md` 第 3 節,這裡只放結論:

| 檔案 | 判定 |
|---|---|
| `features/steps/common.steps.ts` | **留下**。跨資料夾的句子照 README 就是搬到 common,`npm run check:steps` 綠 |
| `features/steps/i1-content-pipeline.steps.ts` | **會讓該紅的變綠,已改小**。改成 Background 旗標分流 + 4 條單元測試,實測從 1 passed 回到 1 failed |

**一句話總結**:`state.router ??= buildReachableCloudRouter(this)` 是實測有害的——
破壞 I1 的 Background 之後,那個唯一在講 router 的場景會自己就地生一個 router
安靜地變綠(`fd81d46` 1 failed → `efa0f95` **1 passed**),改成旗標分流之後回到 1 failed。

---

## 4. ⚠️ 必辦:變異分數

### 4.1 完整指令

```bash
npm run mutate -- stryker.user-facing-review.json
```

`package.json` 的 `mutate` = `stryker run`,所以實際執行的是
`stryker run stryker.user-facing-review.json`。

另一半(對照用,完整指令一樣寫在這裡):

```bash
npm run mutate -- stryker.user-facing-lint.json
```

### 4.2 分數

| 設定檔 | 基準(開發交付) | 最終 | 變異數 | 存活 |
|---|---|---|---|---|
| `stryker.user-facing-review.json` | 75.51% | **100.00%** | 47 | **0** |
| `stryker.user-facing-lint.json` | 60.23% | **100.00%** | 88 | **0** |

review 這半邊的基準分數逐檔:

| 檔案 | 基準 |
|---|---|
| `scripts/review.ts` | 83.33% |
| `packages/core/src/session/io.ts` | 70.83% |
| `packages/core/src/session/summary.ts` | 71.43% |

### 4.3 `mutate` 範圍改過,要說清楚

`stryker.user-facing-review.json` 的 `mutate` 這一輪動了一行,**變異總數從 49 變成 47**:

```diff
-    "scripts/review.ts:89-110",
+    "scripts/review.ts:89-95",
+    "scripts/review.ts:98-110",
```

挖掉的是 `scripts/review.ts` 的第 96–97 行:

```ts
const router = new FakeLlmRouter(loadFixturesFromDir(resolve(ROOT, 'contracts/fixtures/llm')));
const session = await buildTodaySession({ learningDir: dir, today, router });
```

`git log -L 96,97:scripts/review.ts` 顯示這兩行來自 `82aaad1`(這個檔第一次寫出來的
那個 commit),**不是 P-29 加的**。原本的 `89-110` 是一段連續範圍,順手把它們掃進去了。
挖掉它們等於把範圍收回「這一輪新增的程式碼」,對應 09-lint 報告 4.3 的**分類 D**。

**這不是為了衝分數**:47 個變異裡 0 存活,那兩行留著也只會多兩個跟本輪無關的
既有邏輯變異。收窄的理由要寫在這裡,是因為「分母變小、分數變好看」這件事
不能只留在 diff 裡不解釋。

### 4.4 12 個存活變異逐條處理

開發交付時 12 個存活,分三類,**全部殺掉,沒有一個被歸成「不值得測」**。

#### 分類 A:真漏測 —— `listCardIds()` 完全沒有單元測試

`packages/core/src/session/io.ts:102-116` 的存活變異。根因跟 09-lint 一樣:
這一層**只有**經由 `scripts/review.test.ts` spawn 真 CLI 的端到端測試,
而那層的 fixture 分不出細節。

活下來的典型:

- `if (!existsSync(cardsDir)) return []` → `if (false)`
- `!name.endsWith('.md')` → `endsWith('')` / 換方法 / `true` / `false`
- `name.endsWith('.short.md')` 那半條拿掉 —— **fixture 裡根本沒有 `.short.md` 檔**
- `join(learningDir, 'cards')` → `join(learningDir, '')`
- `!statSync(categoryDir).isDirectory()` 的 `continue` 拿掉
- `name.slice(0, -'.md'.length)` 的邊界

**處理**:新增 `packages/core/src/session/zero-guard.test.ts`,`listCardIds()` 7 條,
直接對純函式斷言:

1. `cards/` 不存在 → 空陣列(不丟例外,也不憑空生項目)
2. `cards/` 在但沒有類別 → 空陣列
3. 回傳的是卡片 id 不是檔名(`.md` 要去掉)
4. `.short.md` 是同一張卡的縮短版,**不另外算一張**(← 補上 fixture 缺的那個檔)
5. 非 `.md` 的檔案不算卡片
6. `cards/` 底下的**檔案**不會被當成類別目錄(不可以炸掉也不可以算進去)
7. 跨類別收齊,而且排序過

#### 分類 B:真漏測 —— 兩支 render 函式的字串沒有逐字斷言

`packages/core/src/session/summary.ts:75-91`。`renderDryRunHeader()` 的三個數字
可以互換、`renderNoCards()` 的整句可以變成 `''`,CLI 的鬆斷言照樣通過。

**處理**:`zero-guard.test.ts` 再加 10 條:

- `renderDryRunHeader()` 3 條:三個數字都印且各自對得上名稱;數字跟著輸入走不是寫死的;
  **三個位置不可以互換**(「幾張卡」跟「幾張到期」講的不是同一件事)
- `renderNoCards()` 5 條:說出「這個 vault 沒有卡片」並指名是哪個目錄;
  帶上三支守門掃描器共用的「掃描器壞了」那句話;說明可能的原因;
  兩行結構(第一行事實、第二行方向與原因);
  **絕對不可以出現使用者每天看到的那句安心訊息**

CLI 那一層補 1 條(`scripts/review.test.ts`):
0 張卡的訊息指名的是 `<dir>/cards`,**不是 vault 本身**——使用者要拿著這條路徑去 `ls`,
指到 vault 本身等於叫他去看一個「明明就在」的目錄。

#### 分類 C:等價變異 → 改成可觀測

兩個,都是「在真環境裡不可觀測」而不是「測試寫得爛」:

**C-1 `listCardIds()` 結尾的 `.sort()` 被拿掉。**
跟 09-lint 同一個根因:**這台機器的檔案系統 readdir 本來就回傳字母序**,
所以「真的建檔案再斷言結果是排序的」永遠殺不掉它。

處理:新增 `packages/core/src/session/list-card-ids-order.test.ts`,
把 `node:fs` 換成假的讓 `readdirSync` 保證回傳**倒序**,再斷言 id 是字母序。
2 條:單一類別倒序、跨類別(要驗的是**一份總排序**,不是每個類別各自排完接起來)。
`vi.mock` 整檔生效,所以另開一支檔案,`zero-guard.test.ts` 繼續用真的檔案系統。

**C-2 `if (dryRun)` 這個分支拿掉。**
`scripts/review.test.ts` 原本**一律帶 `--dry-run`**,所以把分支條件改成 `true`
兩條路印一樣的東西,測試分不出來。

處理:`scripts/review.test.ts` 加一條 + 一個 `runInteractive()` helper
(不帶 `--dry-run`、`input: ''` 把 stdin 關掉,所以只在「今天沒有任何卡到期」的
vault 上用——那種情況根本不會進 readline 迴圈):

```
dry.output         要有「張未排程」
interactive.output 不可以有「張未排程」,但要有 Nothing is due today.
```

兩邊印一樣的東西,就代表那個分支根本沒有在分。

---

## 5. 要驗的行為

### 5.1 真 vault(`/data/python/llm_learning-cards/learning`),`--dry-run` 只讀不寫

```
$ npx tsx scripts/review.ts --dir /data/python/llm_learning-cards/learning \
    --today 2026-09-05 --dry-run
掃描 25 張卡,0 張到期,25 張未排程。
Nothing is due today.
exit=0
```

**25 張卡**,跟磁碟一致,也跟 `lint.ts` 那一支印的數字一致。
以前這裡**只有第二行**。

跑完 `state/` 仍然是原本那三個檔案,**沒有生出 `reviews.json`**(硬規則 2):

```
$ ls -1 /data/python/llm_learning-cards/learning/state/
ingested.json
lint-report-2026-09-04.md
log.jsonl
```

`25 張未排程` 是**正常**狀態,不是紅燈——真 vault 現在 25 張全部是剛 ingest 出來的新卡,
連 `reviews.json` 都還沒有。它只是報數。

### 5.2 三個數字缺一不可

| 情況 | 卡 | 到期 | 未排程 | exit |
|---|---|---|---|---|
| 有卡、今天剛好沒排到 | N | 0 | 0 | 0 |
| 有卡、全部還沒排程 | N | 0 | N | 0 |
| 卡片全部消失 | 0 | — | — | **1**,走 `renderNoCards()` |

只看「0 張到期」時,前兩列跟第三列長得一模一樣——這就是這一輪要修的東西。

### 5.3 `reviews.json` 的三個邊界

| 邊界 | 行為 |
|---|---|
| 檔案不存在 vs 檔案是 `{}` | 輸出**逐字相同**。`loadReviews` 兩種都給 `{}`,摘要行不含路徑,所以天生一致。差別只在磁碟上有沒有那個檔案,對使用者沒有意義 |
| 卡片在、部分卡沒有 review 紀錄 | 正常,exit 0,但要說出「N 張未排程」——不然分不出「排程是空的」跟「今天剛好沒排到」 |
| 0 張卡 + 沒有 `reviews.json` | 「沒有卡片」贏,**exit 1**,不是「還沒排程」 |

### 5.4 既有行為的護欄(不可以退化)

- 到期清單本身一個字沒改:`id`、`stage N`、`overdue Nd` 照舊,摘要行不帶任何卡片 id
- 有卡但 0 張到期**仍然 exit 0**——正常的空閒日不可以被改成紅燈
- `Nothing is due today.` 那一行在安閒日**保留**(I2 的 `@regression` 場景
  「it says nothing is due today」這樣要求)
- `standalone.json` **沒有動**。11-review-cli 的 expect 是 `"due"`,
  安閒日輸出仍含那一行、有到期時清單本來就有 `overdue`,兩種情況都含 `due`

---

## 6. 完整驗收(兩份共用)

「本輪複驗」= 接手的審核 agent 這一輪親自跑過;
「前段」= WIP commit `7cc0449` 那一段跑的,這一輪沒有重跑。

| 檢查 | 指令 | 結果 | 誰跑的 |
|---|---|---|---|
| 單元測試 | `npx vitest run` | **86 檔 / 1594 條全綠**,exit 0 | 本輪複驗 |
| gherkin 無歧義 | `npm run accept:dry` | 498 場景、**0 ambiguous**(154 undefined、344 skipped) | 本輪複驗 |
| 步驟定義無重複 | `npm run check:steps` | ✓ 無重複定義(46 個 `.feature`、1943 句、17 個步驟檔、754 個定義) | 本輪複驗 |
| **phase 涵蓋率** | `npm run accept:coverage` | **✓ 38 個 phase 檔全部至少涵蓋 1 個場景**,exit 0 | **本輪(前段被中斷)** |
| **整合場景** | `npm run accept:integration` | **498 場景、0 failed**、344 passed、154 undefined(exit 1 來自 undefined,見下) | **本輪(前段被中斷)** |
| 單獨執行 | `npm run standalone` | 12/12 綠,11-review-cli ✓ | 前段 |
| standalone gherkin | `npm run accept:standalone` | 158/158 | 前段 |
| `review` 變異 | `npm run mutate -- stryker.user-facing-review.json` | **100.00%**(47 變異,0 存活) | 前段 |
| `lint` 變異 | `npm run mutate -- stryker.user-facing-lint.json` | **100.00%**(88 變異,0 存活) | 前段 |
| 真 vault(`review.ts`) | `npx tsx scripts/review.ts --dir <真 vault> --today 2026-09-05 --dry-run` | 25 張卡、0 到期、25 未排程;`state/` 沒多出 `reviews.json` | 本輪複驗 |
| 真 vault(`lint.ts`) | 見 09-lint 報告 5.1 | 25 張卡 | 前段 |
| `--dir` 不建目錄 | 見 09-lint 報告 5.3 | 反向驗證通過 | 前段 |

### 6.1 `accept:integration` 的 exit 1 要怎麼看

```
498 scenarios (154 undefined, 344 passed)
2278 steps (619 undefined, 66 skipped, 1593 passed)
EXIT=1
```

**0 failed。** exit 1 完全來自 **undefined**(還沒實作的整合場景),
cucumber 對 undefined 也回非 0。這 154 個 undefined 是**這條分支之前就存在**的既有狀態:
`efa0f95` 的 commit message 記的是「原 157 → 154」,也就是這一輪把三個 undefined 變成了 passed,
沒有製造任何新的 undefined,也沒有任何 failed。

輸出裡那個 `Failures:` 區塊是 cucumber 用來列 undefined 場景的,逐條看過都是
`? Given/When/Then … Undefined. Implement with the following snippet:`,
**沒有一條是斷言失敗**。

### 6.2 I2 的兩個 zero-guard 場景確實綠了

`docs/integration/i2-review-loop-headless.feature` 有 16 個非 `@manual` 場景。
在 `accept:integration` 的 undefined 清單裡出現的是第 15/27/34/41/47/54/59/66/72/78/85/92 行
那 12 個(I2 本體還沒實作),**沒有出現**的是:

| 行 | 場景 | 狀態 |
|---|---|---|
| 97 | `@regression` **An empty or missing card directory is reported, not shown as nothing due** | **passed** |
| 105 | `@regression` **Having cards but none scheduled today is an ordinary quiet day** | **passed** |
| 112 | Every standalone entry point still runs | passed |

這兩個 `@regression` 場景就是 P-28/P-29 要守的東西,而且它們刻意 **spawn 真的 CLI**
(`this.runCommand`),不像 `review-cli.steps.ts` 直接呼叫 session 模組:
要守的是使用者在終端機看到的字與退出碼,繞過 CLI 等於繞過受測物。

---

## 7. base 比 main 舊 —— 沒有造成任何紅

main 現在是 `8081fc9`,比這條分支的 base 多了模板守門 v1.3.4 的同步。
交辦時提醒可能會看到兩種紅,**兩種都沒有發生**,原因是那些檔案在這個 worktree 裡根本還不存在:

| 提醒的紅 | 實測 |
|---|---|
| `scripts/mutate.test.ts` 兩條測試(寫死 `T0 = 2026-09-04 12:00 UTC` 卻走真實時鐘,過了兩小時殘鎖門檻就被判成殘鎖 → 昨天綠今天紅) | `npx vitest run scripts/mutate.test.ts` → **No test files found**。這個檔在 base 上還沒有,所以 `npx vitest run` 的 1594 條裡不含它 |
| `sync-gates.sh --check` 不一致 | `scripts/sync-gates.sh` 在 base 上不存在(`scripts/` 底下沒有任何 `.sh`),跑不起來 |
| `scripts/py/` 被 `--prune` 清掉 | base 上沒有 `scripts/py/` |

**結論:第 6 節那張表沒有一格的紅是 base 舊造成的。** 合併到 main 之後
`scripts/mutate.test.ts` 會一起進來,那兩條的修法已經在 main 上,不需要這條分支處理。

---

## 8. 我改了什麼(接手這一段)

| 檔案 | 改動 |
|---|---|
| `features/11-review-cli/REVIEW.md` | **附加**這一段(第三輪)。原本的第一、二輪審核報告原封不動留在上面 |
| `features/09-lint/REVIEW.md` | 只改第 6 節那一句交叉引用,指明是「第三輪」那一段的第 6 節 |

**沒有改**:`contracts/`、`raw/`、`prompts/`、`standalone.json`、任何程式碼或測試檔。
**沒有 push。**
`/data/python/llm_learning-cards/learning/` 只讀不寫:唯一碰它的是 `--dry-run`,
跑完 `state/` 仍是原本三個檔案。

WIP commit `7cc0449` 那一段改的檔案清單見 `features/09-lint/REVIEW.md` 第 7 節。
