# REVIEW — 03-llm-router/phase-2(第一輪)

審核對象:commit `e1d7377`(`decideRoute()` + `LlmRouterImpl` 實作,回應 `de68d15` 留下的測試骨架)。

## 結論:**FAIL**

程式邏輯本身是對的(路由表 11 組、快取、probeLocal 吞錯都手動核對過,行為正確),
但兩個變異測試門檻都沒過,不是差一點點——`router-impl.ts` 差很多。卡在下一輪開發
agent 補測試,不是重寫邏輯。

## 逐項結果

### 1. 邏輯核對(routing.ts / router-impl.ts vs 測試)

- `routing.ts` 的 `decideRoute()`:純函式,讀 `ROUTING_TABLE` 分三組
  (`cloud-only` / `cloud-or-local` / `local-only`),行為對照契約 §7 表格,
  逐條核對過,**正確**。`grade.fill.llm` 是 local-only,不管 `online` 值——
  對照契約表格「在線 → local」那格,是對的(容易誤會成「local-only 也該吃
  online」,程式沒有犯這個錯)。
- `routing.test.ts` 的 11 組 Examples 跟 `phase-2.feature` 的 Scenario Outline
  逐行核對,**完全一致**,沒有漏掉或改動任何一列。
- `router-impl.ts`:`probeOnline()` 快取用 `now - at < ttl`,TTL 預設 60_000ms;
  `probeLocal()` 用 try/catch 吞錯回報 unavailable;`resolveLocalModel()` 環境變數
  優先於 settings。這三個都跟 docstring 描述的行為一致,**邏輯正確**。
- `call()`:先 `probeOnline()` 再 `probeLocal()`,丟給 `decideRoute()`,cloud
  分支轉given底層 `CloudLlmRouter.call()`,local 分支丟 phase-4 未實作錯誤。
  **邏輯正確**,但完全沒有單元測試蓋到(見下方變異測試段落)。

### 2. 實際重跑指令(全部貼真實輸出)

```
$ npm ci
added 433 packages, and audited 440 packages in 15s
(EBADENGINE 警告是 node 版本,跟這次改動無關,忽略)

$ npm run boundaries
boundaries: 掃描 145 個檔案,允許例外 0 條
✓ 無違規

$ npm run typecheck
> tsc --noEmit
(無輸出,乾淨過)

$ npm test
 Test Files  50 passed (50)
      Tests  662 passed (662)
   Duration  5.45s

$ NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@llm-router and @phase-2 and not @manual"
15 scenarios (15 passed)
45 steps (45 passed)
```

15 scenarios = 3 個非 Outline(local absent / cache 10s / cache 90s)+ 11 組 Outline
+ 1 個「改路由表」= 15,跟 `.feature` 對得上。

### 3. 變異測試(**FAIL 在這裡**)

#### routing.ts(嚴格 95% 門檻)—— 93.75%,**未達標**

```
$ npm run mutate -- --mutate "packages/core/src/llm/routing.ts,!packages/core/src/llm/routing.test.ts"
...
[Survived] CallExpression
packages/core/src/llm/routing.ts:81:7
-         throw new NoModelError(task);
+         ;

All files   |  93.75 |   93.75 |       15 |         0 |          1 |        0 |       22
```

原因:`decideRoute()` 的 `switch` 沒有 `break`(全靠 `return`/`throw` 跳出),
`cloud-or-local` 分支結尾的 `throw new NoModelError(task)`(第 81 行)被拿掉後,
執行會落到下一個 `case 'local-only'` 的邏輯——巧的是它結尾也是
`throw new NoModelError(task)`,對測試輸入來說結果一樣,所以這個 mutant「存活」
但不代表邏輯真的錯。是 switch fallthrough 造成的結構性巧合,不是功能 bug。

**要過 95% 門檻需要下一輪修**:把 `switch` 改成不會 fallthrough 的寫法(例如
if-else-if 鏈,或每個 case 包一層 block 並在結尾加上不會被巧合覆蓋的 return/throw
差異),讓這個 mutant 被殺掉。這是最小改動,不涉及邏輯重寫。

#### router-impl.ts(標準 80% 門檻)—— 53.33%(以「覆蓋的 mutant」算是 80%,但含未覆蓋的算全部只有 53.33%),**明顯漏洞,遠低於門檻**

```
$ npm run mutate -- --mutate "packages/core/src/llm/router-impl.ts,!packages/core/src/llm/router-impl.test.ts"
...
[NoCoverage] ConditionalExpression  router-impl.ts:135:9   (if (decision.target === 'cloud'))  x3 種變異
[NoCoverage] BlockStatement         router-impl.ts:135:38  (整個 if block 被清空)
[NoCoverage] StringLiteral          router-impl.ts:139:21  (phase-4 錯誤訊息文字被清空)

[Survived] EqualityOperator   router-impl.ts:145:29   `<` 改成 `<=`
[Survived] ArithmeticOperator router-impl.ts:145:29   `now - at` 改成 `now + at`

All files       |  53.33 |   80.00 |        8 |         0 |          2 |        5 |       44
[91mERROR[39m Final mutation score 53.33 under breaking threshold 60, setting exit code to 1 (failure).
```

兩個真的問題,不是巧合:

1. **`call()` 方法(第 130–140 行)完全沒有單元測試蓋到**——5 個 NoCoverage
   mutant 都在這裡。`router-impl.test.ts` 只測 `probeLocal()` / `probeOnline()` /
   `resolveLocalModel()` 三個方法,從沒直接呼叫過 `router.call()`。cucumber
   那邊的 phase-2 場景也刻意繞過 `LlmRouterImpl.call()`,直接測 `decideRoute()`
   (見 `llm-router.steps.ts` 開頭註解,這是 ADR-037 之下故意的設計)。
   結果是:cloud 分支轉呼叫底層 router、local 分支丟 phase-4 錯誤這兩段組裝邏輯,
   **一次都沒被測試執行過**。
2. **`probeOnline()` 快取的邊界(第 145 行)沒測到剛好等於 TTL 的那個點**——
   兩個 survived mutant 都在同一行:`<` 換成 `<=`、`-` 換成 `+`。現有測試只測
   10 秒(遠小於 60 秒 TTL)跟 90 秒(遠大於),從沒測「剛好 60000ms」那個邊界,
   所以邊界寫錯這個 mutant 殺不掉。這正好對應這次審核任務要求特別確認的
   「10 秒/90 秒邊界」——邊界本身邏輯是對的,但測試沒有釘住它。

**下一輪要補的測試**(不用改 `router-impl.ts` 本體邏輯,邏輯是對的):
- 幫 `call()` 補至少兩個測試:cloud 分支真的轉呼叫底層 `cloudRouter.call()`、
  local 分支真的丟出帶 phase-4 字樣的錯誤。
- 幫 `probeOnline()` 補一個「剛好等於 TTL」的邊界測試(例如 `now += 60_000`
  該不該重打,依契約行為釘死是 `<` 還是 `<=`)。

### 4. `call()` 走 local 分支的錯誤訊息

`throw new Error('local adapter not implemented until phase-4')`——純文字訊息,
不是專屬的錯誤類別(不像 `CloudRequiredError` / `NoModelError` 有 `.code`)。
但訊息本身清楚寫明「phase-4 才會實作」,呼叫端在 log/stack trace 裡一眼就能看出
不是一般程式錯誤。**可以接受**,不是阻擋項;如果要更嚴謹可以做成專屬類別,
但 FEATURE.md 沒有要求,列為建議不是缺陷。

### 5. 全專案 dry-run(檢查 ambiguous step)

```
$ NODE_OPTIONS=--import=tsx npx cucumber-js --tags "not @manual" --dry-run
453 scenarios (249 undefined, 204 skipped)
2037 steps (1083 undefined, 954 skipped)
```

`grep -ic "ambiguous"` 對輸出結果是 **0**。249 個 undefined 都是還沒開工的未來
phase/integration 場景(例如 `docs/integration/i8-windows.feature`),跟這次改動
無關,**沒有新的 ambiguous step**。

### 6. 沒動到不該動的檔案

```
$ git diff --name-only main...HEAD
features/steps/llm-router.steps.ts
packages/core/src/llm/errors.ts
packages/core/src/llm/index.ts
packages/core/src/llm/router-impl.test.ts
packages/core/src/llm/router-impl.ts
packages/core/src/llm/routing.test.ts
packages/core/src/llm/routing.ts
```

`router.ts`、`adapters/**`、`log-min.ts` **完全沒出現**,確認沒動到。

## 下一輪要重看的清單

1. ~~`routing.ts` 第 73–87 行的 `switch`：改掉 fallthrough 結構,殺掉第 81 行那個
   存活 mutant~~ **已完成,見下方第三輪記錄。**
2. ~~`router-impl.test.ts`:補 `call()` 的 cloud/local 兩條分支測試,補
   `probeOnline()` 剛好等於 TTL 邊界的測試。~~ **已完成,見下方第二輪記錄。**
3. **上面兩項都已過門檻。** 其餘檢查(typecheck / boundaries / 666 單元測試 /
   15 個 phase-2 cucumber 場景 / dry-run 無 ambiguous / 未動到 router.ts 等)
   這輪都已確認過。**下一輪應直接進最終驗收(/phase-done),不用再修邏輯。**

---

## 第二輪(測試 agent,只補 `router-impl.test.ts`)

只改了 `packages/core/src/llm/router-impl.test.ts` 一個檔案,補了 5 個測試:

- `call()` cloud 分支:注入假 `cloudRouter`(用 `vi.spyOn` 換掉 `CloudLlmRouter.call`),
  確認 `decision.target === 'cloud'` 時真的轉呼叫它,回傳值就是它的回傳值。
- `call()` local 分支:注入 `localProber` 讓 `grade.fill.llm` 判定 local 可用,
  確認丟出的錯誤訊息含 `phase-4` 字樣。
- `probeOnline()` 剛好等於 TTL(60000ms)的邊界:讀了第 145 行確認實際判斷式是
  `now - at < ttl`(嚴格小於),所以邊界(elapsed === ttl)算「已過期」,測試釘住
  「第二次呼叫會再打一次探測」這個行為,不是我自己假設的。
- 另外多補一個「時鐘從很大的數字開始(模擬真的 `Date.now()` epoch ms)」的測試——
  單純的邊界測試(從 0 起算)殺不掉 `now - at` → `now + at` 這個變異(因為
  `at = 0` 時加減同值),所以另外用非零起點驗證 TTL 內快取依然有效,才能同時
  殺掉 `EqualityOperator` 和 `ArithmeticOperator` 這兩個原本存活的 mutant。

### 重跑結果(全部貼真實輸出)

```
$ npx vitest run packages/core/src/llm/router-impl.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)

$ npm run typecheck
> tsc --noEmit
(無輸出,乾淨過)

$ npm run boundaries
boundaries: 掃描 145 個檔案,允許例外 0 條
✓ 無違規

$ npm run mutate -- --mutate "packages/core/src/llm/router-impl.ts,!packages/core/src/llm/router-impl.test.ts"
...
All files       | 100.00 |  100.00 |       15 |         0 |          0 |        0 |       44
Final mutation score of 100.00 is greater than or equal to break threshold 60
```

**分數變化:53.33% → 100.00%**(0 survived、0 no-coverage;那 44 筆是原本就存在、
跟型別標註相關會導致編譯錯誤而被排除計分的 mutant,跟這輪改動無關)。

`router-impl.ts` 這項的門檻(≥80%)已過。`routing.ts` 的 switch fallthrough
(清單第 1 項)這輪**沒有動**——那是本體邏輯改動,不在這輪測試 agent 的範圍內,
留給下一輪。

---

## 第三輪(開發 agent,只改 `routing.ts` 一個檔案)

只改了 `packages/core/src/llm/routing.ts` 的 `decideRoute()` 本體,把沒有 `break`
(靠 `return`/`throw` 跳出)的 `switch` 改成 `if / else if / else` 三個互斥區塊。

**為什麼能解決問題**:原本的 `switch` 沒有 `break`,`cloud-or-local` 分支結尾的
`throw new NoModelError(task)`(第 81 行)被拿掉後,JS 的 fallthrough 語意會讓
執行「掉進」下一個 `case 'local-only'` 的程式碼繼續跑;而 `local-only` 分支
剛好也是走到 `throw new NoModelError(task)` 收尾,對測試輸入來說結果一樣,
所以這個 mutant「存活」——不是邏輯錯,是兩個 case 共用同一段 fallthrough 路徑
造成的巧合。改成 `if / else if / else` 後,三個分支是各自獨立、互斥的程式碼區塊,
不共用任何路徑:某個分支裡的 `throw` 被拿掉,執行只會落到整個
if-else-if-else 結構外面(函式隱含回傳 `undefined`),不會意外跑到另一個分支
的邏輯裡去,兩者的行為必然不同,mutant 一定會被殺掉。

**行為完全沒變**:三個分支的判斷順序、條件、回傳值、丟的錯誤類型都跟原本
一模一樣,只是換了控制流的寫法(`switch`→`if/else if/else`),對照
`routing.test.ts` 的 11 組 Examples 沒有任何一組結果不同。

### 重跑結果(全部貼真實輸出)

```
$ npx vitest run packages/core/src/llm/routing.test.ts
 Test Files  1 passed (1)
      Tests  14 passed (14)

$ npm run typecheck
> tsc --noEmit
(無輸出,乾淨過)

$ npm run boundaries
boundaries: 掃描 145 個檔案,允許例外 0 條
✓ 無違規

$ npm test
 Test Files  50 passed (50)
      Tests  666 passed (666)

$ npm run mutate -- --mutate "packages/core/src/llm/routing.ts,!packages/core/src/llm/routing.test.ts"
...
All files   | 100.00 |  100.00 |       17 |         0 |          0 |        0 |       26
Final mutation score of 100.00 is greater than or equal to break threshold 60
```

**分數變化:93.75% → 100.00%**(0 survived、0 no-coverage;第 81 行那個原本存活
的 mutant 已被殺掉)。

`git diff --stat` 確認只動了 `packages/core/src/llm/routing.ts` 一個檔案,沒有碰
`routing.test.ts`、`router-impl.ts` 或任何其他檔案。

**兩個待辦項目(清單第 1、2 項)都已完成。下一輪應直接進最終驗收
(`/phase-done`),不需要再改邏輯或補測試。**
