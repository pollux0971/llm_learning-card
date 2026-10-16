# 驗收證據:T26 寫 reviews.json 之前先確認它沒被別人改過(樂觀檢查,不加鎖)

驗收角色:-ed(測試·驗收)。日期:2026-10-17(Asia/Taipei)。
被驗分支:`t26-opencode` @ `c1e27bc`(worker 兩個 commit:f644098 實作、c1e27bc 報告);起點 `t26-start` c5ee493(= main 0ca1c25 + 前端紅測試 t26-red 75765ee)。
驗收簽出 `acceptance-t26`(分支 `pollux0971/t26-accept-tests`,只加這份證據)。不合併、不 push、沒改 worker 的任何檔。紅測試作者:前端;起草:-e5;驗收:我。

## 0. 結論

**通過,無阻擋項,也沒有測試缺口。** 工單 must_catch 九條都有改壞版本被抓到;17 個改壞版本 16 個紅、1 個存活且是等價(R01,見第 3 節)。
真 cucumber(phase-3 四個場景,含 T26 新增的兩個)全綠。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| L-1 | 備註 | R01(拿掉 `submitAnswer` 裡的早期比對)存活是等價:`saveReviewsIfUnchanged` 寫入前自己會再重讀比對,同樣丟 ReviewsChangedError;早期比對只是在算轉移之前先失敗,這之間沒有任何磁碟寫入或 session 狀態改變可觀察(R17「早期比對裡先 shift queue」才會被抓到,紅) | 等價,不擋 |
| L-2 | 備註 | 誠實的限制照工單:重讀比對到 rename 之間仍有微秒級空窗(樂觀檢查不是鎖),顧問已接受 | 不擋 |
| L-3 | 成本 | worker cost $1.722,工單預算 $1 = 1.72×(未超過 2×);session ses_ebb2a7640ffedaz1LMvfbNPxdF,xai/grok-4.7(協調者提供) | 記錄 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 detached @ c1e27bc(node_modules、src-tauri/target 從別的驗收簽出複製,用完刪),沒有 `.env`。開跑 tree sha `00175708f14e81b38be401a2cda56f83ad834ead`。
- **測試作者檢查**:worker 兩個 commit 的測試檔(`*.test.*`、`tests/`、`test-support`、`features/steps/**`、`.feature`、fixtures)變動 **0**;動的檔只有 io.ts(+67)、answer.ts、build.ts、types.ts、scripts/review.ts 與報告。測試與步驟(reviews-optimistic.test.ts、reviews-changed-cli.test.ts、review-cli-phase3-conflict.steps.ts、phase-3.feature 的兩個新場景、harness 補充)全來自前端的 75765ee。
- `git log --name-only c5ee493..c1e27bc | grep -c mutants.out` = 0。與最新 main(55bd943)的 `git merge-tree`:無衝突。
- `loadReviews` / `saveReviews` 的簽章與行為沒動(diff 只新增 `readReviewsSnapshot`、`saveReviewsIfUnchanged`、`ReviewsChangedError`;既有 answer/io 測試全綠)。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯 |
| boundaries / check:steps / check:gherkin-dup / check:phase-status / check:next-gates | 全 PASS |
| vitest session + features/support + scripts/review* | 20 檔 247 綠 |
| cucumber `@review-cli and @phase-3 and not @manual` | 4/4(26 步) |
| cucumber `@review-cli and not @manual` | 32/32(188 步) |
| cucumber `@integration and @i2 and not @manual` | 15/15(96 步) |

## 3. 改壞版本(17 個:改一處實作 → 跑 session 全部測試 + reviews-changed-cli 共 161 條 → 還原)

| 編號 | 改壞 | 結果 |
|---|---|---|
| R01 | submitAnswer 不做早期比對 | **存活(等價,L-1)** |
| R02 | 寫入前不重讀比對 | 紅(4) |
| R03 | 錯誤訊息少了第二句 | 紅(10) |
| R04 | code 不是 `reviews-changed` | 紅(3) |
| R05 | 成功寫入後基準雜湊沒更新 | 紅(3):第二題起誤報 |
| R06 | 檔案不存在的基準是空檔雜湊 | 紅(3) |
| R07 | 雜湊算重新序列化後的內容 | 紅(7) |
| R08 | 雜湊不是 SHA-256 | 紅(5) |
| R09 | 寫入不走 writeFileAtomic | 紅(5) |
| R10 | 回傳的不是剛寫進去的雜湊 | 紅(6) |
| R11 | buildTodaySession 沒記基準雜湊 | 紅(4) |
| R12 | sessionFromCache 沒記基準雜湊 | 紅(2) |
| R13 | 終端機吞掉被改過的錯誤繼續跑 | 紅(2) |
| R14 | 寫入格式不同於 saveReviews | 紅(1) |
| R15 | 讀 reviews 不過 schema | 紅(1) |
| R16 | 基準永遠信任磁碟 | 紅(5) |
| R17 | 偵測到被改過時已 shift queue(計數往前走) | 紅(1) |

對照工單 must_catch:被改過仍寫入(R02、R16;R01 等價)、寫一半/暫存檔沒清/計數往前走(R17、R09)、訊息與 code(R03、R04)、第二題起誤報(R05、R10)、檔案不存在的基準(R06)、鎖檔/格式/不走 writeFileAtomic(R09、R14)、既有簽章(既有測試全綠)、終端機仍印小結/snapshot/退出碼 0(R13)、兩處建 session 只有一處記基準(R11、R12)。

## 4. 三個重點(協調者要求特別看)

- 雜湊是**原始位元組** SHA-256 小寫十六進位,不是重新序列化的(R07、R08 紅);檔案不存在是固定的 `'absent'`,別人在這期間建檔(哪怕是空檔)會被偵測到(R06 紅)。
- 錯誤時任何寫入之前就丟:不建暫存檔、不 shift queue、不加 passed/failed(R02、R09、R17 紅;單元測試守磁碟位元組不變與 state/ 沒有多出任何檔)。
- 成功寫入後 `session.reviewsHash` 更新(R05、R10 紅),所以第二題起不誤報;`buildTodaySession` 與 `sessionFromCache` 兩處都記基準(R11、R12 紅);終端機被改過時 stderr 印固定訊息、退出碼 1、不印小結、不 snapshot(cucumber 場景與 CLI 測試綠,R13 紅)。

## 5. grok

這張是輕量工單(五個檔、+約 100 行),協調者與顧問未要求對抗審核,上面三個重點已逐項用改壞版本驗證。沒有另跑 grok。

## 6. learning/ 前後(唯一量法,只讀)

| 時點 | 檔數 | 雜湊前 16 碼 | 帳本行數 |
|---|---|---|---|
| 開跑前(沿用 T12 收尾量值) | 64 | 03b3ca76e6cf509a | 90 |
| 跑完後 | 64 | 6335855d9945ca2b | 96 |

**前後不同的說明**:跑完後多 6 行帳本(90 → 96,檔數不變、尾端追加),全是 `llm_call` 事件、task 欄 ingest.cards、時間 2026-10-16 16:41 UTC(台北 00:41),模式與 T12 第 3 輪的 golden `--live`(children 三次加 regenerate 三次)相同。我這張的所有測試(vitest、cucumber、改壞版本)都用暫存 learning 與暫存 XDG,沒有指向真目錄;已請協調者確認那是他合併後重跑的 golden。

## 7. 花費

worker cost $1.722 / 預算 $1 = 1.72×(未超過 2×)。驗收端沒有用 LLM。

## 8. 結論

通過(無阻擋項、無測試缺口)。
