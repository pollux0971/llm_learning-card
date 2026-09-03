# 05-grading / phase-2 審核報告

審核日期:2026-09-03
審核範圍:`packages/core/src/grading/grade-apply.ts`(應用題 rubric 逐條審核)
門檻:標準級 80%(LLM 相關模組,非嚴格級)

## 結論:PASS

Stryker 實測分數:**100%**(94 個變異,52 killed + 1 timeout + 39 errors〔TS 型別檢查排除〕,0 survived)
起始分數 67.27%,補測試後升到 100%,遠超 80% 門檻。

## 1. 邏輯對照 10 個場景(逐條核對實作,非僅讀 docstring)

讀了 `features/05-grading/phase-2.feature`(10 個 scenario,9 個自動化 + 1 個 `@manual @llm`)、
`grade-apply.ts` 實作本體、`grade-apply.test.ts`、`features/steps/grading.steps.ts` 的 phase-2 段落
與 `contracts/fixtures/llm/grade.apply.*.json` fixtures。確認以下都是真的實作,不是掛名:

- **verdict 數量不合的重試邏輯**:`parseApplyVerdict` 檢查 `criteria.length !== rubricCriteriaCount`
  才回 null;`gradeApply` 的 for-loop(attempt 0..1)重試同一份 prompt。有 fixture
  `grade.apply.count-mismatch.a1/a2.json` 對應,cucumber 場景「A verdict count that does not match
  the rubric is invalid」實際觸發兩次呼叫並驗證。
- **兩次失敗的 error 記錄**:兩次都無效回傳 `{pass:null, grader:'error'}`,不帶 criteria。
  補測試驗證了兩件事(原本沒測到):(1) 兩次失敗時只記錄「一次」retry warning,不是兩次
  (原本 `if (attempt===0)` 這個條件式的變異存活,代表沒人測到重試 log 只該出現一次這件事);
  (2) error 情況下 feedback 是有意義的中文說明,不是空字串。
- **feedback 截斷是否真的用契約 §5 的字數上限**:`truncateFeedback` 用 `countWords`
  (契約 §2 權威實作,`@core/schema/word-count.ts`),逐字元累加,超過上限就停在前一個字元。
  原本的測試只驗證「有截斷」「不超過上限」,沒驗證邊界(剛好等於 40 字)與截斷內容本身
  (只驗證字數 <=40,沒驗證文字內容真的是原文前綴)——這是變異測試抓到的最有價值的漏洞,
  已補上邊界測試(見下方第 3 節)。
- **空白答案短路**:`answer.trim() === ''` 直接回 `{pass:false, feedback:'沒有作答', grader:'empty'}`,
  完全不呼叫 router。測試與 cucumber 場景都驗證了 `calls` 陣列為空(router 真的沒被呼叫,不是回傳值
  湊巧一樣)。

其餘場景(prompt 內容、全過/部分失敗、cloud vs local-provisional、重試後採用第二次回應、結果欄位形狀)
也都對照過,實作與測試一致。

## 2. 自動化測試結果

| 項目 | 指令 | 結果 |
|---|---|---|
| npm ci | `npm ci` | 成功(433 packages) |
| boundaries | `npm run boundaries` | ✓ 無違規(掃描 156 檔案) |
| typecheck | `npm run typecheck` | ✓ 無錯誤 |
| 單元測試 | `npm test` | ✓ 56 files / 854 tests all passed |
| cucumber phase-2 | `cucumber-js --tags "@grading and @phase-2 and not @manual"` | ✓ 9 scenarios / 54 steps all passed |
| cucumber dry-run(全專案) | `cucumber-js --tags "not @manual" --dry-run` | ✓ **0 ambiguous**(178 undefined 屬於未開工的未來整合場景,非本次範圍) |

## 3. 變異測試(Stryker)

範圍:`packages/core/src/grading/grade-apply.ts`
門檻:標準級 80%

### 第一輪(補測試前)

分數 **67.27%**(94 mutants:36 killed、1 timeout、17 survived、1 no coverage、39 errors)
未達 80% 門檻。逐一分類存活變異:

| 分類 | 數量 | 處理 |
|---|---|---|
| 真的漏測 | 16 | 補測試 |
| 真等價 | 1 | 加 `// Stryker disable ... : 理由` |
| 無涵蓋(NoCoverage) | 1 | 補測試(logPath 檔案寫入路徑從沒被測過) |

**真的漏測,依根因分四類補測試:**

1. **prompt 模板文字沒被精確驗證**(7 個變異:rubric 編號 `i+1`、rubric 行內 `\n` 分隔、
   標頭字串「評分規準(rubric):」、JSON 格式指示三行字串、outer `.join('\n')`)。
   原本的測試只用 `toContain()` 鬆散比對,拿掉編號或指示文字都不會讓測試失敗。
   補了兩個測試:逐條驗證「每條 rubric 是獨立一行,格式 `N. 內容`」、驗證標頭與三行 JSON
   格式指示「各自整行存在」(用 `prompt.split('\n')` 精確比對整行,不是子字串)。

2. **`truncateFeedback` 邊界條件完全沒測到**(6 個變異:`<=`→`<`、初始值 `''`→垃圾字串、
   for 迴圈本體整個被拿掉、迴圈跳出條件的三種變異 `if(true)`/`>=`/`<=`)。
   這是**最有價值的發現**:原本的測試只驗證「截斷後字數 <= 上限」,這麼寬鬆的斷言連「回傳空字串」
   「回傳跟原文無關的垃圾內容」「提早跳出只留 1 個字」都測不出來。補了兩個邊界測試:
   - 剛好等於上限(40 字)不截斷,`truncated:false`
   - 超過上限時截斷結果剛好等於上限字數,而且**內容是原文的前綴**(`text === long.slice(0, LIMIT)`),
     不是空字串或垃圾字串

3. **兩次失敗的 log 行為沒測到**(1 個變異:`if (attempt===0)` 判斷式被拿掉,變成一律記 log)。
   補測試驗證兩次都失敗時,重試 warning **只記一次**,不是兩次。這正好對應任務指示要特別檢查的
   「兩次失敗的 error 記錄」。

4. **error 結果與 truncated log 的細節沒測到**(2 個變異:error 的 feedback 文字被清空、
   truncated log 事件的 `task` 欄位被清空)。補了 error feedback 內容斷言,並修正既有的截斷 log
   測試把 `task` 欄位也一併檢查(跟 retry log 測試原本就有的檢查方式一致)。

5. **NoCoverage:`createFileLogAppender` 從沒被真的呼叫過**(1 個)。所有既有測試都用
   `logAppender` 直接注入,`logPath`(寫真實檔案)這條路徑完全沒有測試涵蓋。補了一個測試,
   用 `mkdtempSync` 建暫存檔,呼叫 `gradeApply(..., { logPath })`,讀檔驗證 log 事件真的被寫入
   (跟 `packages/core/src/llm/router.test.ts` 既有的 `tmpLogPath()` 模式一致)。

**真等價變異(1 個)**:`parseApplyVerdict` 的 `try { parsed = JSON.parse(text) } catch { return null }`,
拿掉 `return null` 讓 catch block 變空,`parsed` 留在 `undefined`(宣告時 `let parsed: unknown;`
沒賦值)。之後 `VerdictShapeSchema.safeParse(undefined)` 一樣會驗證失敗,函式一樣沿著後面的
`if (!result.success) return null;` 回傳 null——兩條路徑的外部可觀察行為完全一致,是真等價變異,
不是漏測。已加 `// Stryker disable BlockStatement: <理由>` / `// Stryker restore BlockStatement`
包住這個 try/catch(注意:disable 註解必須放在 `try` **敘述之前**,不能放在 catch 區塊內部或
`} catch {` 同一行的中間——Babel 的 leading-comment 掛載規則會把中間位置的註解當成前一個
statement 的 trailing comment,Stryker 的 ignore-rule 抓不到,實測過三種放法才找到正確位置)。

### 第二輪(補測試後)

分數 **100%**(94 mutants:52 killed、1 timeout、0 survived、0 no coverage、39 errors)

`# errors` 39 個是 TypeScript checker 判定型別不合法而自動排除的變異(不算入未殺死清單,
是 Stryker 正常行為,不是問題)。

## 4. 變更檔案

- `packages/core/src/grading/grade-apply.ts`:+3 行,只加了 `Stryker disable/restore` 註解,
  沒有動任何邏輯行為(契約與功能不變)。
- `packages/core/src/grading/grade-apply.test.ts`:+13 個測試(21 → 32 個 `it`),全部針對第 3 節
  分類出的真實漏測補上,沒有為了衝分數寫斷言。

## 5. 人工確認清單

- [ ] `@manual @llm` 場景「An obviously right and an obviously wrong answer」需要真的打 API,
      不在這次審核範圍內(不打真的雲端服務)。
- [ ] 契約 §5 `GradeResult.pass===null` 時呼叫端(04-scheduler)不得推進/回退 stage 的不變量,
      這裡只驗證了 `gradeApply()` 回傳值本身正確;04-scheduler 端有沒有真的遵守,要等該模組
      整合時再驗。
