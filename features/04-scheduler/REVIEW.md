# REVIEW — 04-scheduler/phase-3(每日上限、逾期比例優先序)

審核對象:commit 7dd184b(`packages/core/src/scheduler/select.ts` 的
`selectSession` / `computeOverdueRatio` / `simulateSteadyState` 實作)。

## 結論:PASS

Stryker mutation score(`select.ts`,嚴格 95% 門檻):**100.00%**
(36 killed + 2 timeout,0 survived;另有 19 個 mutant 因 TypeScript 型別檢查
直接編譯失敗,被 Stryker 排除在分母外,不計入分數)。連跑三次皆為 100.00%,
非單次僥倖。

## 1. 邏輯對照場景

逐一比對 `phase-3.feature` 的 10 個 Scenario/Outline 與 `select.ts` 實作:

- **每日上限**:`selectSession` 用 `sorted.slice(0, ctx.dailyCap)`,`deferred`
  是 `sorted.length - selected.length`,對照「More due than the cap」
  「Fewer due than the cap」兩個場景。上限來自 `ctx.dailyCap`,不是寫死常數
  (有專門場景與測試驗證)。
- **逾期比例排序**:`computeOverdueRatio` 用 `isoDaysBetween / intervalDaysForStage`,
  數字與 Outline 的 6 組期望值(stage 1~5)一致,不是自建的間隔表。
- **排序鍵**:`overdue_ratio` 高到低,平手用 `learned_at` 早到晚——對照
  「The most fragile memory is asked first」與「Equal ratios break by ...」。
- **上限驗證**:`dailyCap <= 0` 丟錯且訊息帶出實際值,對照
  「An invalid cap is rejected」Outline(0、-1 兩列)。
- **reteach 不佔上限**:`ctx.reteach ?? []` 原樣回傳,不進 due/deferred 計算。
- **順延卡片隔天狀態**:`selectSession` 是純函式,不改輸入;由呼叫端
  (測試與 `simulateSteadyState`)隔天重新用 `buildDueList` 算出新的
  `overdue_days`,對照「Deferred cards are one day more overdue tomorrow」。
- **穩態模擬**:`simulateSteadyState` 逐日呼叫 `applyLearnedTransition` 新增卡片、
  `buildDueList` 建到期清單、`selectSession` 排序套上限、對選中的卡片呼叫
  `applyPassTransition` 真的推進狀態(不是只算數字),回報 `daily` 曲線與
  `cap_reached_days`/`cap_reached_ratio`。

結論:實作是真的照契約 §6 與間隔表算,沒有寫死答案或投機取巧繞過測試。

## 2. 測試套件全過

| 檢查 | 結果 |
|---|---|
| `npm ci` | 成功(433 packages) |
| `npm run boundaries` | 掃描 147 檔案,0 違規 |
| `npm run typecheck` | 通過 |
| `npm test`(vitest) | 51 files / 700 tests 全過(含本次新增 4 個) |
| cucumber `@scheduler and @phase-3 and not @manual` | 17 scenarios / 76 steps 全過 |
| cucumber 全專案 `--dry-run --tags "not @manual"` | **0 ambiguous**(215 個
  undefined 屬於尚未開工的未來 phase/整合點,例如 `docs/integration/i8-windows.feature`,
  與本次改動無關) |

## 3. Mutation testing:存活變異處理

第一輪 `npx stryker run --mutate "packages/core/src/scheduler/select.ts,!...test.ts"`
結果 80~88%(多次重跑分數在這區間浮動,因為部分 mutant 是耗時的迴圈變異,
timeout/survived 的判定會因系統負載而不同,但下列 7 個真正的邏輯缺口每次都在
存活名單裡,不受浮動影響)。逐一處理:

### 補測試殺掉(真的沒測到——4 類,共對應 5 個 mutant)

1. **`addIsoDays(startDate, day - 1)` → `day + 1`**(line 150,`simulateSteadyState`
   算日期用的位移量)。舊測試只斷言 `daily[0].day===1`、`daily.at(-1).day===200`,
   從沒檢查過 `date` 欄位的實際值。
   → 新增「每天的日期從 startDate 逐天遞增一天」,直接斷言
   `report.daily.map(d=>d.date)` 等於逐日遞增的日期陣列。

2. **`for (let i = 0; i < ctx.newCardsPerDay; i++)` → `i <=`**(line 152,
   每天新學卡片數的迴圈上界)。舊測試只比較「多學的天數總到期數比較多」,
   對「剛好差一張」的 off-by-one 不敏感。
   → 新增「每天真的新學 newCardsPerDay 張卡」,利用 stage 1 間隔剛好 1 天的
   事實:第 1 天到期數必為 0、第 2 天到期數必剛好等於第 1 天新學的張數,
   多學一張立刻露餡。

3. **`for (const item of result.due) { ...applyPassTransition... }` 整個迴圈本體
   被刪除**(line 166,選中的卡片是否真的被推進狀態)。這是最重要的一個缺口:
   如果呼叫端沒有真的套用 pass transition,卡片的 `next_due` 永遠不變,
   到期清單只會逐天累加、永遠不會因為晉階而喘口氣。舊測試的斷言
   (`selected_count<=cap`、`selected+deferred===due_count`、`cap_reached===deferred>0`)
   全部是「當下這一天」的恆等式,不管卡片有沒有真的被推進都會成立,測不出來。
   → 新增「選進題目的卡片會被推進到下一階、間隔拉長」,跑 10 天、每天學 1 張,
   靠 stage 1(間隔 1 天)晉階 stage 2(間隔 7 天)的節奏,斷言最後一天的
   `due_count <= 2`。若沒有套用 pass transition,10 天後到期清單會累積到 9 張,
   兩者差距夠大,不是邊界巧合。

4. **`cap_reached: result.deferred > 0` → 寫死 `false`**、
   **`daily.filter((d) => d.cap_reached)` → `filter(() => undefined)`**、
   **`capReachedDays / ctx.days` → `capReachedDays * ctx.days`**
   (line 183、187、192,三個都跟「有沒有真的碰到上限」有關)。舊測試的
   `dailyCap: 10, newCardsPerDay: 2, days: 200` 這組參數在間隔表下從來不會
   真的觸頂,`deferred_count` 恆為 0,三個 mutant 的行為在「恆為 0」的情況下
   跟正確實作沒有差別,測不出來。
   → 新增「新卡量超過上限時,cap_reached 與累計次數/比例反映真正的
   deferred_count」,故意用 `newCardsPerDay: 20, dailyCap: 5` 逼上限一定會觸頂,
   斷言 `capReachedDays > 0` 且 `cap_reached_days`/`cap_reached_ratio` 用獨立算出的
   `capReachedDays` 核對,一次殺掉三個 mutant。

### 真等價(加 disable 註記,共 2 個 mutant,同一行的 2 種變異)

**`cardCounter += 1` → `-= 1`**、**`padStart(6, '0')` → `padStart(6, '')`**
(line 153/154 一帶,模擬用卡片 id `sim-000001` 的產生方式)。

理由(寫在 `select.ts` 對應行上方的註解,和這裡一致):

- `cardCounter` 只是拿來讓模擬內部每張卡片的 id 唯一,不管遞增或遞減,序列
  `1,2,3,...` 或 `-1,-2,-3,...` 都保證每個 id 彼此不同,不會造成
  `reviews[id]` 互相覆蓋。
- `SimulationReport`(`daily` 與 `cap_reached_*`)只回報張數統計,完全不
  外露卡片 id 或 `due` 陣列的排序,呼叫端(這個模組本身、`select.test.ts`、
  `scheduler.steps.ts`)沒有任何地方讀得到這個 id 字串。
- 唯一會讀 id 字串排序的地方是 `buildDueList` 的 `a.card.localeCompare(b.card)`,
  但 `selectSession` 之後一律重新依 `overdue_ratio`/`learned_at` 排序,
  `buildDueList` 的初始順序只在「同一天新學、同 stage、同逾期比例、同
  `learned_at`」的完全平手情況下才可能影響最終選出/順延的是「哪一張」,
  而不影響選出/順延的「張數」——`SimulationReport` 只回報張數,所以就算平手
  取捨換了一張,也沒有任何斷言能觀察到差異。
- 結論:這兩個變異在目前的公開介面(`SimulationReport`)下無法被任何測試
  區分,是真等價變異,不是「懶得補測試」。

### 死程式 / 邊界情況

沒有發現到不了的分支或未覆蓋的邊界條件——原本 7 個存活 mutant 全部落在上述
「真的沒測到」與「真等價」兩類,沒有第三類。

## 4. 改動清單

- `packages/core/src/scheduler/select.ts`:在 `simulateSteadyState` 的
  `cardCounter += 1` 與 id 產生那兩行前各加一行
  `// Stryker disable next-line all: ...`,行為完全不變。
- `packages/core/src/scheduler/select.test.ts`:新增 4 個測試(見上方
  「補測試殺掉」四點),0 個既有測試被修改或刪除。
- 新增本檔案 `features/04-scheduler/REVIEW.md`。

`contracts/` 與 `raw/` 均未觸碰。
