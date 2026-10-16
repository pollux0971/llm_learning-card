# 驗收證據:T25 連錯兩次的卡沒有縮短版時退回原卡(不讓複習停掉)

驗收角色:-ed(測試·驗收;紅測試也是我寫的,所以這次驗的是 worker 實作「紅轉綠」與改壞版本,不是審自己的測試設計)。日期:2026-10-16(Asia/Taipei)。
被驗分支:worker 原樣 `t25-opencode` @ `fbf93c4`(8bae233 實作、fbf93c4 報告);驗收基底 `t25-accept-base` @ `24227bb`(= fbf93c4 + 協調者合入我的 c7f6e58 題目夾具修正;worker 起點是 cda5c4f,它報告的「兩條單元紅是題目夾具不符契約」就是 c7f6e58 修掉的)。
我的補測在 `pollux0971/t25-accept-tests`(基於 24227bb,只加一個測試檔與這份證據)。不合併、不 push、沒改 worker 的實作檔。

## 0. 結論

**通過,實作沒有阻擋項。** 工單 must_catch 七條各有改壞版本被抓到;19 個改壞版本 17 個一次就紅,2 個存活是**測試缺口**(G-1),已補測關閉。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| G-1 | 測試缺口,已補 | (a) `shortCardExists` 只查第一個分類(T18):紅測試把原卡與縮短版放同一個分類,量不到「縮短版在別的分類」;(b) 沒有 `cards/` 目錄時 `shortCardExists` 自己丟 ENOENT(T19):紅測試的「都不存在」案例有建 cards/security,量不到 | 補測 2 條,兩個都紅 |
| G-2 | 備註 | Stryker 對 present.ts 78.57%(<80%):12 個存活全在 phase-1 既有程式(pickQuestion 的 fill/apply 分支、第二題與 current 的判斷、pendingAnswers 初值),T25 新增的 reteach 退回與 warn 函式 0 個存活。這些既有行在單元層沒被殺,靠 cucumber 與別處(不在這次的測試範圍)。不擋 | 記錄 |
| G-3 | 成本 | worker cost $2.488,工單預算 $1 = **約 2.5×,超過 2× 旗標線**(協調者提供;session ses_ebb76340bffer5h61JTn9iDxoh,xai/grok-4.7);grok 無 $ 上限,只記錄 | 標出 |
| G-4 | 備註 | 實作比工單多一步:warn 前先 `mkdirSync(state)`(跟 session/cache.ts 的 warnInvalidSessionCache 同寫法),都在 try 裡;我的單元測試因此不依賴「state 不存在時要不要 mkdir」 | 無需處理 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 `acceptance-t25`(detached @ 24227bb;node_modules、src-tauri/target 從別的驗收簽出複製),沒有 `.env`。開跑 tree sha `c2be5bad1ad46dc8ec35d877e8804811ee59ab00`。
- **測試作者檢查**:worker 兩個 commit(8bae233、fbf93c4)測試檔(`*.test.*`、`tests/`、`test-support`、`features/steps/**`、`.feature`、fixtures)變動 **0**;動的檔:session/{present,types,io}.ts、scripts/review.ts、報告。
- `git log --name-only cda5c4f..fbf93c4 | grep -c mutants.out` = 0。與最新 main(fdb0a75)的 `git merge-tree`:無衝突。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯 |
| boundaries / check:steps / check:gherkin-dup / check:phase-status / check:next-gates | 全 PASS |
| vitest session + features/support + scripts/review* | 17 檔 217 綠 |
| cucumber `@review-cli and @phase-3 and not @manual` | 2/2(14 步) |
| cucumber `@review-cli and not @manual` | 30/30(176 步) |
| cucumber `@integration and @i2 and not @manual` | 15/15(96 步) |

## 3. 改壞版本(19 個:改一處實作 → 跑 present-reteach-fallback + reteach-missing-short → 還原)

| 編號 | 改壞 | 結果 |
|---|---|---|
| T01 | 缺縮短版仍丟錯(不判斷存在) | 紅(10 failed | 6 passed) |
| T02 | 退回的 shortBody 是空字串 | 紅(5 failed | 11 passed) |
| T03 | 退回的 shortBody 含 frontmatter | 紅(7 failed | 9 passed) |
| T04 | 退回時沒有 usedOriginal | 紅(6 failed | 10 passed) |
| T05 | 退回時不記 warning | 紅(4 failed | 12 passed) |
| T06 | warning 記兩筆 | 紅(4 failed | 12 passed) |
| T07 | warning 帶絕對路徑 | 紅(2 failed | 14 passed) |
| T08 | warning 帶卡片內容 | 紅(1 failed | 15 passed) |
| T09 | 原卡不存在也被吞掉 | 紅(2 failed | 14 passed) |
| T10 | 縮短版存在時多帶 usedOriginal | 紅(3 failed | 13 passed) |
| T11 | 縮短版存在時也記 warning | 紅(2 failed | 14 passed) |
| T12 | 退回時動到 session.current / totalDue | 紅(2 failed | 14 passed) |
| T13 | 自動補生縮短版檔 | 紅(3 failed | 13 passed) |
| T14 | 縮短版壞掉也被吞掉(退回原卡) | 紅(1 failed | 15 passed) |
| T15 | 記錄失敗讓複習停掉(拿掉 try/catch) | 紅(2 failed | 14 passed) |
| T16 | 終端機標題沒有提示 | 紅(1 failed | 15 passed) |
| T17 | 終端機標題對縮短版也加提示 | 紅(1 failed | 15 passed) |
| T18 | shortCardExists 只查第一個分類 | **存活**(補測後紅,見 G-1) |
| T19 | shortCardExists 對沒有 cards 目錄丟錯 | **存活**(補測後紅,見 G-1) |

對照工單 must_catch:(1)缺縮短版仍丟錯 = T01;(2)shortBody 空/非原卡 body = T02、T03;(3)沒記/記兩筆/帶絕對路徑或內容 = T05–T08;(4)原卡缺被吞 = T09(另 T19 補);(5)縮短版存在時行為改變 = T10、T11、T14(縮短版壞掉被吞);(6)動到 reteachQueue 以外狀態 = T12;(7)自動補生/動 contracts 或 learning/ 格式 = T13。另:T15 記錄失敗讓複習停掉;T16、T17 終端機標題兩個方向。

## 4. 補測(驗收者寫,`packages/core/src/session/present-reteach-acceptance.test.ts`,2 條)

- 原卡在排前面的分類、縮短版在排後面的分類 → 仍用縮短版、不記 warning(殺 T18)。
- 沒有 cards/ 目錄 → 丟「找不到卡片檔案」(不是 ENOENT)(殺 T19)。
基底綠、tsc 0。

## 5. Stryker(present.ts,測試 = session 全部測試)

`stryker.t25-present.json`(驗收用,不進版控):78.57%(44 殺 / 12 活)。12 個存活全在 phase-1 既有程式(見 G-2);T25 新增程式 0 個存活。

## 6. -e5 對 phase-3.feature 的核對(協調者轉來,原文摘要)

t25-start 的 phase-3.feature、11 FEATURE.md 第 3 列、NEXT.md gate 與 T25 工單建議場景語意一致,無需改動。
場景 1(沒有縮短版):不中止、先顯示原卡並附「沒有縮短版」提示、之後問該卡題目、退出碼 0、log 一筆缺縮短版 warning,五點逐點對得上。
場景 2(有縮短版):顯示縮短版、無提示、問題目、無 warning;多一句「問題在縮短版之後」,語意相容。
全英文、tag @review-cli @phase-3,符合 CLAUDE.md;FEATURE.md 第 3 列與 NEXT.md「phase-3 需要:phase-2 done」與工單一致。
T26 的兩個場景之後由 T26 紅測試作者在同一個 phase-3.feature 後面加,不重建檔案。

## 7. 實作 diff 的三個重點(顧問要求特別看)

- **縮短版壞掉不被吞**:先用 shortCardExists(只查存在)判斷,存在就走原本的 loadCardBody(short) 且不包 try/catch;壞掉照舊丟錯,不記 warning(T14 改壞版本紅;紅測試「縮短版存在但壞掉 → 丟錯、沒有 warning」守著)。
- **warning 不帶絕對路徑**:事件欄位只有 ts/type/card/reason(T07、T08 紅)。
- **記錄失敗不停複習**:warn 函式整個包在 try/catch,只吞這一步,讀卡的錯不吞(T15 紅;log.jsonl 是目錄與 state 唯讀兩個單元案例)。

## 8. grok

本張是輕量工單,沒有另跑 grok 對抗審核(協調者與顧問未要求;T25 diff 只有 35 行,三個重點已逐項用改壞版本驗證)。

## 9. learning/ 前後(唯一量法,只讀)

| 時點 | 檔數 | 雜湊前 16 碼 | 帳本行數 |
|---|---|---|---|
| 開跑前(沿用上一張收尾量值) | 64 | 2ed7039eae558843 | 84 |
| 跑完後 | 64 | 03b3ca76e6cf509a | 90 |

**前後不同的說明**:跑完後比開跑前多 6 行帳本(84 → 90,檔數不變、尾端追加),全是 `llm_call` 事件、時間 2026-10-16 13:00 UTC(約 21:00 台北),task 欄 ingest.cards(golden run 用的任務標籤)。這段時間協調者在跑 T12 第 3 輪的真模型 golden run(`--live`);我的所有測試(vitest、cucumber、改壞版本)都用暫存 learning 與暫存 XDG,沒有指向真目錄。新基準 64/03b3ca76e6cf509a/90,已回報協調者確認。

## 10. 結論

通過(實作無阻擋項);測試缺口 G-1 已補,補測檔建議隨 worker 分支一起進 main。成本 2.5×(G-3)。
