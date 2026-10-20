# T33 驗收證據(13-work-dag phase-1:scripts/dag.ts)

- 被驗分支:t33-opencode,tip e715040(起點 5eab1c8 = main d397537 + 紅測試 901552d;worker commit e6b7a15 實作、e715040 報告)
- 驗收開跑與跑完的 tree sha:9a37c83a905cbf818f8cccdc1b063153af759533(前後相同)
- 日期:2026-10-19
- .env:不存在(ls 失敗)。

## 測試作者
起點到 tip 恰好 5 檔:scripts/dag.ts、scripts/boundaries.owners.json、scripts/zero-input-roster.ts、standalone.json、docs/reviews/T33-report.md。測試檔、步驟定義、.feature、fixtures、contracts、scripts/check-next-gates.ts 都是 0 變動。兩個 commit 作者都是 worker。

## dag.ts 副作用
- import 只有 node:child_process、node:fs、node:path、node:url。沒有跨資料夾 import、沒有 YAML 或 markdown 套件。
- fs 只用 existsSync、readdirSync、readFileSync、statSync。沒有任何寫入。唯一子行程是 git tag --list。
- 自選改壞「main 末尾偷寫一個檔」:9 條測試紅。真 repo 跑完工作樹乾淨。

## 基準
- scripts/dag.test.ts:132/132。
- cucumber '@work-dag and @phase-1 and not @manual':34 個場景、181 步全過(先重編 lc-fs,Finished 1m 57s)。
- tsc 0。boundaries PASS(338)。zero-input-guard 單檔 775 passed、171 skipped。check-standalone PASS(16;13-work-dag 鍵通過)。
- 登記:owners 表與 zero-input 名冊都已加 scripts/dag.ts。

## 真 repo 煙霧(驗收 3)
在驗收用簽出(狀態 = 基底 + worker 的 4 個檔)跑 dag.ts 對整個 repo:退出碼 0、stderr 空、沒有 Error 或 stack、摘要行存在、兩次輸出逐位元組相同、跑完 git status 沒有新增或改動。PROBLEM 共 0 條。
下面是記錄行與摘要原文(省略 mermaid 邊):

```
READY 02-ingest-pipeline/phase-3 (table says todo)
READY 07-teach-card/phase-4 (table says todo)
READY 13-work-dag/phase-1
BLOCKED 05-grading/phase-3 by 03-llm-router/phase-3,I5
BLOCKED 06-test-card/phase-4 by 05-grading/phase-3,I4
BLOCKED 07-teach-card/phase-3 by 07-teach-card/phase-2
BLOCKED 08-weekly-goal/phase-2 by 07-teach-card/phase-2,I4
BLOCKED 09-lint/phase-2 by 03-llm-router/phase-3,05-grading/phase-3,I5
BLOCKED 10-desktop-shell/phase-3 by I4
BLOCKED 10-desktop-shell/phase-4 by 10-desktop-shell/phase-3,I6
BLOCKED 10-desktop-shell/phase-5 by 10-desktop-shell/phase-4,I7
BLOCKED 13-work-dag/phase-2 by 13-work-dag/phase-1
HUMAN 03-llm-router/phase-3 decision ADR-037
HUMAN 03-llm-router/phase-3 decision ADR-039
HUMAN 05-grading/phase-3 decision ADR-037
HUMAN 07-teach-card/phase-2 decision ADR-073
HUMAN 13-work-dag/phase-2 decision ADR-065
gate=dag result=OK ready=3 blocked=9 human=5 problems=0
```

注意:13-work-dag/phase-1 在這份簽出裡表上仍是 todo,所以出 READY;派工後它會變 in-progress,不再出現。

### 給顧問核對
- (a) 03-llm-router/phase-3 出的是 HUMAN(ADR-037、ADR-039),不是 READY。原因:它的 NEXT.md 已勾選的 gate 項文字裡寫了這兩個 ADR,規格說決策 gate 永遠只出 HUMAN、勾選不讀。這是規格的後果,不是工具讀錯。工單原文猜「READY 至少含 03-llm-router/phase-3」,與規格不一致,以顧問核對為準。
- (b) 02-ingest-pipeline/phase-3 出 READY:它在 NEXT.md 的 gate 寫 I1,tag I1 存在、phase-2 done。但同一份 NEXT.md 的「下一個」欄與 FEATURE.md 的表格寫「卡在 I4」。檔案兩處不一致,工具照 gate 正本。這是檔案錯,協調者另開文件小批改。
- 另外 BLOCKED 9 條的來源(I4、I5、I6、I7、前一個 phase)我用肉眼對過各 NEXT.md 的 gate,方向都對;PROBLEM 0 條,所以沒有「工具讀錯 / 檔案沒寫」要分類。

## 變異測試(驗收 6)
指令:npm run mutate -- stryker.t33-dag.json(驗收簽出根目錄的暫存設定,沒進 git)。設定:測試執行器 command,內容是單跑 scripts/dag.test.ts 的 vitest(--bail=1,獨立 config),coverageAnalysis off,concurrency 2,timeoutMS 120000,mutate 範圍 scripts/dag.ts 整檔,門檻 high 90 / low 80。VITEST_MAX_WORKERS=1。
結果:**69.46%**(574 killed、6 timeout、255 survived、0 no coverage),低於工單的 80%。摘要:reports/mutation/e715040-t33-dag.json。

存活 255 條依函式分布(次數):

| 函式 | 存活 | 備註 |
|---|---|---|
| collectGateText | 54 | 清單項(勾選與一般)的 regex 錨點與量詞、續行判斷 started、遇到標題停止 |
| dashItemText | 26 | 兩條 regex 的錨點與量詞、回傳值 |
| analyzeTree | 25 | 見下 |
| parseNext | 22 | 工單列為必殺的「NEXT.md 解析」 |
| compareNatural 與 tokenize、compareDigits | 32 | 自然排序:長度比較、字串比較、前導零、數字判斷;多條 `if (false) return -1` 存活 |
| isSeparator、splitRow、findPhaseTable 等表解析 | 約 30 | 表頭分隔列、前後 `|` 判斷 |
| readTags、loadTree、main、invokedAsCli、usage、fail | 約 30 | 多數是錯誤訊息字串與 CLI 入口的條件 |
| 其他 | 約 36 | findCycles 8、lineKey 6、parseGateRefs 7 等 |

突變類型:Regex 69、ConditionalExpression 63、StringLiteral 31、EqualityOperator 20、MethodExpression 16、LogicalOperator 12。
工單 6 點要求「一定殺掉」的項目中,以下確實有存活:NEXT.md 解析的 checklist 項(collectGateText、dashItemText)、自然排序(compareNatural)。其餘必殺項(狀態、tag 精確比對、決策 gate、環、摘要計數、mermaid)的自選改壞都紅,見下。
說明:這份分數只算 vitest(dag.test.ts)。cucumber 場景沒有放進變異執行器;但下面的自選改壞兩層都跑,存活的在兩層都存活。

## 自選改壞(只改 dag.ts,每個跑完還原;先 vitest,存活再跑 cucumber)
| 改壞 | 結果 |
|---|---|
| 依賴 in-progress 算 done | 2 紅 |
| tag 改前綴比對(長得像的 tag 解鎖) | 6 紅 |
| in-progress 不跳過 | 存活,等價:後面還有一道只放 todo、ready 的過濾 |
| done 不跳過 | 存活:同上,只差 done 的 phase 若有決策 gate 會多出 HUMAN 行(規格沒提) |
| blocked 狀態不輸出 BLOCKED by status:blocked | 2 紅 |
| 沒宣告 gate 的猜成 READY | 6 紅 |
| 環上節點不排除 | 存活,等價:環上節點一定有未完成的依賴,先被擋 |
| 決策 gate 當作已滿足 | 10 紅 |
| 不輸出 HUMAN 行 | 9 紅 |
| 重複 phase 列改成最後一列贏 | 存活:沒有重複列的測試(低) |
| 邊排序拿掉第二鍵 | 1 紅 |
| 摘要 human 數寫成 ready 數 | 13 紅 |
| mermaid 箭頭方向反 | 2 紅 |
| 引用不存在的 phase 時丟例外 | 7 紅 |
| 自然排序換成字串排序 | 7 紅 |
| [x] 勾選項不被認得(落到一般項) | 存活,等價:勾選狀態本來就不讀 |
| 不讀真 git tag(只列不存在的 tag) | 1 紅 |
| main 末尾偷寫檔 | 9 紅 |
| 決策 ref 不去重 | 存活,等價:後面 uniqueSorted 會去重 |
| 邊不去重 | 1 紅 |
| 有 PROBLEM 時退出碼 1 | 2 紅 |
| READY 註記一律加 | 8 紅 |

22 個改壞:17 紅、5 存活(4 等價或規格沒提、1 低)。

## 第二輪(B1 補測試之後,2026-10-21)
- 被測:t33-opencode e715040(實作一個字沒變)加上 t33-gaps e3da6b8 的 scripts/dag.test.ts。t33-gaps 相對紅測試基底 t33-red 只改這一個檔(+457/−1,兩個 commit,作者都是測試 agent);被刪的那 1 行只是 import 列表,加了 chmodSync 與 symlinkSync;另在檔頭型別多了 dashItemText。沒有刪任何斷言。
- 驗收簽出的 tree:t33-opencode 的 tree 加上這份測試檔(測試檔未 commit 進驗收分支)。
- 基準:scripts/dag.test.ts 207/207。
- 變異測試:同一條 npm run mutate -- stryker.t33-dag.json(設定與第一輪相同;scripts/dag.ts 整檔、vitest 單跑 dag.test.ts、門檻 80、concurrency 2)。
  結果 **89.58%**(744 killed、4 timeout、87 survived、0 no coverage),高於 80%;第一輪是 69.46%(574、6、255)。摘要:reports/mutation/e715040-t33-dag-gaps.json。第一輪的摘要檔留著不動。
- 存活 87 條逐條歸類(行號指 scripts/dag.ts;其中 84 條解析得出行號,另 3 條是跨多行的突變,歸在最後一類「其他」):
  | 類別 | 行 | 條數(約) | 判斷 |
  |---|---|---|---|
  | 預設值字串或空陣列(「?? 預設值」換成別的字、「?? []」換成有東西的陣列) | 51、52、136、138、231、233、268、275、302、310、350、359、416、446、579 | 約 19 | 等價:那個分支走不到,或被後面的比對過濾掉 |
  | 自然排序的邊界比較(`<` 與 `<=`、tokenize 的 `\D` 與 `\D+`、`if (false) return 0`) | 52、60、68、78、84(×4) | 9 | 等價或低:長度已不同、文字已不同才會走到、或後面還會再比;84 行的 `<=` 在 token 全等時才有差,再由原字串碼位決定 |
  | 表分隔列判斷 isSeparator(各種 regex 與 every/some) | 106(×12) | 12 | 低:分隔列各種寫法偏門(`|:-|`、`|-:|` 以外的壞寫法);-e1 預判略過 |
  | splitRow 的 trim、normalizeStatus 的 trim 與判斷 | 102、110、112、135 | 4 | 低:狀態與欄位後面還會再 trim 或比對 |
  | 清單項的 regex 尾端 `$` 與 `\s+` 變 `\s`、未 trim 的續行 | 230、232、266、273、281、299、307、310 | 約 12 | 等價:`(.*)` 本來就吃到行尾;多吃的空白後面 trim |
  | 十六進位決策參照的 mixedHex 閘 | 207 | 1 | **真缺口(低)**:純數字或純字母的 7 碼以上字串(例如七個字母的字)會被當成 commit 決策 gate;現有測試只用混合型。建議補一條 |
  | 迴圈邊界多跑一格 | 298、353 | 2 | 等價:多讀到 undefined,regex 與 Map 都不命中 |
  | 並行去重與 findCycles 內部 | 314、345、346、357、447、468、469、491、492 | 約 9 | 等價:後面有 uniqueSorted 或排序去重;findCycles 內部的集合更新被輸出去重蓋住;-e1 預判略過 |
  | lineKey(排序鍵) | 379、380(×5) | 6 | 低:只影響同鍵之間的次序,實際行都有空格;-e1 預判略過 |
  | 解析工具函式的 folder 為 null | 480、481(×3) | 4 | 等價:不可達(查表的資料夾一定在表裡) |
  | readTags 的 stdio、trim、filter、catch 預設 | 575(×4)、577(×4)、579 | 約 9 | 等價或低:git 輸出沒有多餘空白;空字串 tag 無害;非 git 目錄回空或回無害值;-e1 預判略過 |
  | main 與 invokedAsCli | 618、623、631、632(×3) | 6 | 低:錯誤訊息文字、argv 判斷的次要分支;錯誤路徑本身(root 不存在)由別的檢查擋下 |
  | 其他(多行突變) | — | 3 | 未逐條展開,同屬上面幾類的條件分支 |
  與 -e1 預判的 11 條等價(行 51、52、60、68、78、84、266、298、481、632×2)吻合;-e1 預判略過的 82 條(預設值字串、isSeparator、normalizeStatus、findCycles 內部、lineKey、readTags stdio、去重、process.exit)在這一輪剩下的存活裡有出現,歸類如上。
  工單 6 點點名必殺:NEXT.md 解析(清單項、續行、三種參照寫法、無 gate)、狀態判斷、tag 精確比對、決策 gate、環偵測、自然排序、摘要計數、mermaid:這一輪都沒有實質存活,剩下是上表的等價或低;唯一建議補的是 207 行的 mixedHex。
- learning/ 前後:64 個檔、雜湊 c2e4dd6d71de3976、帳本 108 行,前後相同。

## 資料前後
learning/:64 個檔、雜湊 c2e4dd6d71de3976、帳本 108 行,前後相同。

## 花費
worker 累計 9.197 美元,預算 5 美元,比值 1.84(未超過 2 倍)。

## 阻擋項(第一輪,第二輪已解除)
- **B1:變異分數 69.46%,低於工單門檻 80%。** 缺口集中在 NEXT.md 的清單項與續行解析(collectGateText、dashItemText、parseNext)、自然排序(compareNatural 家族)、Phase 表解析。這些是「測試沒釘住」,實作本身在 22 個自選改壞上的行為是對的。依角色分工,補測試由測試 agent 做,實作 worker 不動;補完後重跑同一指令,存活逐條說明。

## 結論
通過
