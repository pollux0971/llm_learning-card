# 驗收證據:T39 第二輪(補測後重測)

- 基底:t39-verify 4baf6832ceda22bc6e5ccb20e1de22bb8897b72e(= t39-impl-2 0a1170f 加 merge t39-red-2 b8ce744);驗收樹(開跑與跑完相同)tree 3d6d528543915e17c5abd61aa8b894bd44d08578
- 驗收者:驗收線 -5a,日期 2026-10-22;沒有 .env
- 第一輪證據:acceptance-T39.md;存活者分類:acceptance-T39-survivors.md、acceptance-T39-equivalents.md;本輪剩餘清單:acceptance-T39-round2-survivors.md

## 結論

**有阻擋項:必補區沒清完。** 分數 90.09% 過了標準級 80%,但顧問的收法要求必補每隻要嘛殺、要嘛有理由的等價;必補 174 隻只殺了 91 隻,剩 83 隻,另有 1 個手工發現的缺口(行內清單含反引號)。補測清單見 acceptance-T39-round2-survivors.md,第二輪補完後只重測那些行。

## 測試作者與範圍

- t39-verify 相對 t39-impl-2 只多 scripts/dag.test.ts +576 行、0 刪除(git diff --stat);3 個 commit 都是測試線 -1d(92cfc53、5d00f06、b8ce744)加 merge。scripts/dag.ts 沒動。既有斷言沒被改或刪(0 刪除)。

## 變異重測

指令(完整):

    npm run mutate -- stryker.t39-dag-rerun.json

設定:mutate 為 scripts/dag.ts 的 59 段行範圍(涵蓋第一輪 266 隻存活者所在的 84 行,行號已換成 t39-impl-2 的);測試 MUTATE_TEST_GLOB='{scripts/dag.test.ts,scripts/dag-check.test.ts}',vitest --bail=1;concurrency 2、timeoutMS 120000、thresholds 90/80/0;CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1。報告 reports/mutation/4baf683-t39-dag-rerun.json。

結果:398 隻:殺 294、存活 104、逾時 0、錯誤 0(另有 19 隻被 Stryker 註解略過)。耗時 118 分 45 秒。

| 項 | 數 |
|---|---|
| 第一輪:殺 | 845 |
| 本輪新殺(原存活的非等價 194 隻裡) | 91 |
| 等價(已加註解 71 + 1093:85 未加註解) | 72 |
| **分數** (845+91)/(1111−72) | **936/1039 = 90.09%** |

存活 104 = 必補 83 + 可低 20 + 等價 1(1093:85)。必補剩餘分布:augment 25、compareRecord 14、parseHeaderText 10、classifyDep 10、orcaScript 10、loadLandings 5、loadTicketNodes 4、wireDeps 2、resolveTouch 1、infraShared 1、phaseStatusMap 1。逐隻見 acceptance-T39-round2-survivors.md。我逐組重看,沒有新發現的等價;也沒有把任何一隻改列可低(顧問允許的「為殺而殺」彈性還沒用)。

等價註解核對:t39-impl-2 0a1170f 相對 b91bd03 只多 50 行 Stryker 註解,非註解變更 0 行;每條註解的下一行對回舊檔同一行,指定 mutator 的 7 條沒蓋到同行的必補;1093:85 未加註解,存活如預期。

## 完整 vitest 與 check:test-ledger(t39-verify)

- npm run check:test-ledger(內含完整套件,VITEST_MAX_WORKERS=1):229 檔,228 過、1 檔紅;6201 過、2 紅、171 skipped(共 6374),耗時 1310 秒。紅的兩條都在 scripts/review-engine.test.ts:「沒有快取:建 session、寫快取;…」與「沒有快取:reviews.json 逐位元不變」,錯誤都是 Test timed out in 5000ms(零斷言失敗)。帳本行數未變 108。
- 單檔重跑 scripts/review-engine.test.ts 兩次:兩次都是 34 條全過、耗時約 1.8 秒(逾時是整套件下的壓力造成,不是行為紅)。壓力資訊:重跑時 /proc/pressure/cpu 的 some avg300 14.22(剛跑完 20 分鐘的整套件與變異)、io full avg300 2.57;load average 4.6。
- 第一輪(b91bd03)同樣的完整套件是 229 檔 6150 條全過、帳本 108 不變;本輪多了補測 53 條(6150 → 6201 過),新增測試本身沒有紅。
- 判定:照 load 型收(零斷言失敗的逾時、單跑連 2 綠);但這次 test-ledger 的 gate 行寫 FAIL,所以**我沒有一次乾淨的 test-ledger PASS 可附**。要乾淨 PASS 需要再跑一次整套件(約 20 分鐘),等第二輪補測交件後的最終驗收一起跑。

## must_catch 逐條手工改壞(t39-verify,單檔 vitest dag.test.ts + dag-check.test.ts,--bail=1,改完還原)

| # | 改壞 | 結果(第一個紅的測試) |
|---|---|---|
| 1 | R2 最長前綴改第一個符合 | 紅:落點表裡短前綴排在長前綴前面也要選最長的 |
| 2a | R3 的 HELD 過濾拿掉 review | 紅:ready 的 heavy 被 review 的 heavy 擋住 |
| 2b | R3 的 PROBLEM 佔用只算 dispatched | 紅:狀態矩陣 dispatched 或 review 的 heavy 合計超過 1 張才紅 |
| 3 | contracts 互斥拿掉 | 紅:contracts 和任何工作互斥 |
| 4 | infra 改落點比對 | 紅:infra 用檔案層級比對 |
| 5 | review 不佔落點 | 紅:狀態矩陣(同一個非 infra 落點) |
| 5b | 兩張 review 也算相交 | 紅:同上狀態矩陣 |
| 6 | dropped 當成滿足 | 紅:dropped 不算滿足 |
| 7a | R5 違反變 PROBLEM | 紅:R5 深度 |
| 7b | R4 違反變 PROBLEM | 紅:R4 的 dispatched 數量 |
| 7c | R5 深度不排除已滿足 | 紅:已 merged 的不算 |
| 8a | merged/dropped 也報 no-landing | 紅:LANDING 只印還沒結束的工單 |
| 8b | todo/dispatched/review 不報 no-landing | 紅:no-landing 相關測試 |
| 9 | 逐行清單反引號開頭當不合法 | 紅:逐行清單項目以反引號開頭 |
| 9b | **行內清單含反引號當不合法** | **存活:348 條全綠(缺口,列入第二輪)** |
| 10a–10g | cpu、status、owner、budget 非數字、budget 0 配 todo、deps 非清單、缺檔頭 各自不檢查 | 全紅:檔頭驗證各條 |
| 11 | 對不到落點時猜 infra | 紅:只有以 / 結尾的才算目錄 |
| 12 | 自然排序改字串排序 | 紅:by 的自然排序 phase-2 在 phase-10 前面 |
| 12b | START 順序反過來 | 紅:id 較小的 START、另一張 HELD |
| 13 | 工具寫檔(在 docs/tickets 寫一個檔) | 紅:scripts/dag.ts 當指令跑 |
| 14 | --check 不設退出碼 | 紅 |
| 新檔登記 A | 從 boundaries.owners.json 拿掉 dag-check.test.ts | npm run boundaries 紅 |
| 新檔登記 B | 拿掉 features/support/dag-p2-harness | npm run boundaries 紅 |
| chain C | gates.config.json 的 chain 拿掉 dag:check | 紅:chain 有 dag:check 而且只有一個 |
| chain D | package.json 拿掉 dag:check script | 紅(8 條) |

結果:工單 must_catch 15 條都有對應改壞被殺,**唯一例外**是「反引號」那條的行內清單半邊(9b)存活。另:zero-input-roster 的「新增檔沒登記」本工單不適用(worker 沒新增 scripts/*.ts;dag:check 做在 dag.ts --check,dag.ts 本來就在名冊);「.feature、contracts/、check-next-gates 被改」是範圍檢查,我以 git diff 核對代替:t39-verify 相對 712c331 沒有任何 .feature、contracts、scripts/check-next-gates.ts 的變更。

## 資料前後與花費

- learning/(唯一量法)前後都是 64 / c2e4dd6d71de3976 / 108。
- 本輪驗收的 CPU:變異 119 分鐘、完整套件 22 分鐘、手工改壞約 10 分鐘。worker 花費同第一輪(記錄 $24.33 / 預算 6,不重算)。
