# T40 驗收第二輪(測試 agent 補測後)

日期 2026-10-22。被驗:主 repo 分支 t40-red-2,sha 430ae9c6bce443113845ee59212f90b80c3815fc(基底 t40-impl ef6d318)。tree sha(開跑與跑完相同):c1828a9260ec6dbf8c18d4ca4c5577bf1e5f51bf。沒有 .env。
第一輪見 `acceptance-T40.md`;存活清單見 `acceptance-T40-survivors.md`。

## 結論

**通過。** 第一輪的 17 個真缺口(G1、G3、G4、G5、G6,以及教學卡 G2)在這輪的 Stryker 裡全部被殺;工單範圍 148 個變異只剩 5 個存活,都是等價。

## 測試作者與 diff

t40-impl 到 t40-red-2:2 個檔、450 行新增、**0 行刪除**,兩個 commit 都是測試 agent 的:apps/desktop/src/review-client-busy.test.ts(+415)與 apps/teach-card/src/teach-session.test.ts(+35)。實作檔、其他測試檔 0 變動。既有斷言一條都沒改(刪除行數 0)。無 mutants.out。

## 基準

| 項目 | 指令(原文) | 結果 |
|---|---|---|
| 桌面殼 | `VITEST_MAX_WORKERS=1 npx vitest run apps/desktop/src/` | 19 檔 305 過(第一輪 279) |
| 教學卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/` | 8 檔 72 過(第一輪 70) |
| 考試卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/test-card/` | 6 檔 320 過 |
| tsc | `npx tsc --noEmit -p .` | 0 輸出 |

這輪跑的時候機器 load 5–14(別的專案的 vitest 在跑),Stryker 因此用了 6 分 39 秒(第一輪 4 分 18 秒),沒有因逾時多出存活。

## Stryker

指令原文:`VITEST_MAX_WORKERS=1 npm run mutate -- stryker.t40-client.json`(設定同第一輪;範圍 review-client.ts 第 9–183 行,測試 review-client.test.ts、review-client-busy.test.ts、review-client-teach.test.ts,`--bail=1`、concurrency 2、timeoutMS 120000)。報告摘要 `reports/mutation/430ae9c-t40-client.json`。

| 範圍 | 變異 | 殺 | 存活 | 分數 |
|---|---|---|---|---|
| 整個檔 | 206 | 189(含逾時 2) | 17 | **91.75%**(第一輪 76.70%) |
| 工單範圍(行 9–93、121–183) | 148 | 143 | 5 | 96.62%;扣 5 等價 100% |
| attempt(行 95–119,不在工單範圍) | 58 | 46 | 12 | 79.3% |

G 組逐項:預設 sleep 與 now(行 78、79)、時鐘起點(行 125)、放棄檢查兩處(行 137、154、156)、拒絕值 kind 判斷(行 47)、取消訂閱(行 87)、ReviewError 名稱、BAD_RESPONSE、listeners 複製、attempt 丟出的 ReviewError——這些位置在這輪都沒有存活者。教學卡 G2 不在 Stryker 範圍:第一輪的手改(onWait 結束時 controlsDisabled 只看 isWaiting)要在補測後變紅,我沒有重做這一個手改,**未重驗**(補測自述有對應測試)。

### 仍存活的 17 個

工單範圍 5 個,**等價**:行 138、150、155、161、166 的 endWait(),同一函式最外層 catch 也會呼叫,任何一處拿掉出口還是通知「不等了」一次。

attempt 12 個(舊的回應驗證;`ResponseSchema`(protocol.ts)已先擋掉形狀不對的回應,下面的判斷在 invoke 路徑上多餘):
- 行 101 欄 11(換成 false):丟出前 parseResponseLine 的結果檢查;handler 回壞行時 raw 變 undefined,後面一樣丟 bad-response。**等價**。
- 行 106 欄 18、欄 33,行 107 欄 20、欄 35:invoke 回字串的分支。Tauri 的 invoke 回物件,字串分支是死碼。**等價**(死碼)。
- 行 108 欄 9(`||` 換成 `&&`):parse 成功就一定是物件。**等價**。
- 行 114 欄 23(換成 true):ResponseSchema 規定 error.message 是字串。**等價**。
- 行 117 欄 9(兩個:換成 false、`||` 換成 `&&`)、欄 77(字樣換空):ResponseSchema 規定 ok:true 的 result 是物件、ok 只能是 true 或 false。**等價**。
- 行 113 欄 20(換成 true):**低,不是等價**。側車回 `ok:false` 且 error.kind 是空字串時(schema 允許),原本落到 internal,改壞後 kind 變空字串。協定上側車不會這樣回;補一個測試即可,不擋。

等價共 16 個(工單範圍 5、attempt 11),低 1 個。扣等價後整檔 189/190 = 99.47%。

### 要加等價註解的行(review-client.ts 現檔行號,與 ef6d318 相同)

下一行要加 `// Stryker disable next-line <變異器>: <理由>`:

| 行 | 變異器 |
|---|---|
| 101 | ConditionalExpression |
| 106 | ConditionalExpression,StringLiteral |
| 107 | ConditionalExpression,StringLiteral |
| 108 | LogicalOperator |
| 114 | ConditionalExpression |
| 117 | ConditionalExpression,LogicalOperator,StringLiteral |
| 138、150、155、161、166 | CallExpression |

**不要**加在行 113(低,不是等價)。註解會把同一行同一變異器、已被殺的變異也略過,只影響統計。

## 資料前後

| 項目 | 前 | 後 |
|---|---|---|
| learning/ 檔案數 | 64 | 64 |
| 整體雜湊(前 16 碼) | c2e4dd6d71de3976 | c2e4dd6d71de3976 |
| 帳本行數 | 108 | 108 |
