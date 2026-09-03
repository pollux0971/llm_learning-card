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

- [ ] **阻擋項**:04-scheduler 的 `applyPassTransition`/`PassCtx` 需要對稱 `FailCtx` 補上多筆
      answers 的介面,`answer.ts:140-143` 的 `throw` 才能換成真正的 resolve 邏輯,並補
      phase-1.feature 的「stage 2 兩題都答對」場景。
- [ ] `@manual` 場景「The session is pleasant enough to use daily」需要真人手動跑,不在這次審核範圍。
- [ ] 17 個存活變異(第 4 節)雖不擋門檻,建議下一輪處理阻擋項時一併補測試。
