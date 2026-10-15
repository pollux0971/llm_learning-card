# 驗收證據:T13 I2 整合接線(複習迴圈接上驗證過的帳本 router,移除 grading 的 FakeLlmRouter)

驗收角色:-ed(測試 agent 兼驗收)。日期:2026-10-15(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`t13-opencode` @ `3739959`,base `599d83e`(-e5 的紅分支,基底 `origin/main` `63e4dc6`)。worker 兩個 commit:`34940a6` 實作、`3739959` 報告。實作者:opencode grok-4.7(名目 $8.97,預算 $4 ≈ 2.2×,只記錄)。
測試作者:-e5(`f9f7888`、`599d83e`)。我的補測在其上的分支 `pollux0971/t13-accept-tests`。
我只交證據與測試。不合併、不 push、沒改 worker 的實作檔。

## 0. 結論

**實作沒有阻擋項。** 工單十二條 `must_catch` 都有會紅的測試,實作全綠;Stryker 兩個門檻都過(grading 前兩層嚴格級 95% → 實測 100%;`session/build.ts` 標準 80% → 實測 100%)。
測試端一個缺口(§3):「N 張延後」那一行只延後 1 張時整行消失,原本沒人知道。已補。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| F-1 | 缺口,已補 | 突變 S7(`deferred === 0` 改成 `deferred <= 1`)原本存活:只有 1 張被延後時,使用者看不到「有一張排到明天」 | 補 `summary-deferred.test.ts` 7 條(0 張不印、1/2/7/120 張印出且 N 是延後數、N 不是上限、單行),S7 紅 |
| F-2 | 備註 | 工單 `touches` 沒列 `grading/grade-apply.ts`,worker 動了它:**只改註解**(把「整合時把 `LlmRouterImpl` 注入」的敘述改成「注入實作」,去掉對 `FakeLlmRouter` 的提及),沒有程式變動 | 無 |
| F-3 | 備註 | `process.exit(2)` 寫在 `grade.ts` 的 `lazyVerifiedRouter` 裡而不是丟錯:原因是 `gradeFillQuestion` 會把 `router.call` 的例外收成 fallback-strict,丟錯會被吞;worker 在註解寫明了。帳本壞時第三層確實退出碼 2(有紅測試) | 無 |
| F-4 | 成本 | 名目 $8.97 / 預算 $4 ≈ 2.2×,超過 2× 旗標線;使用者裁決 grok 不設花費上限,只記錄 | 記錄 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 `acceptance-t13`(基於 `t13-opencode`)。
- **測試作者檢查**:`git diff --name-only 599d83e 3739959` 中 `*.test.*`、`/tests/`、`test-support`、`features/steps/**`、`.feature`、`contracts/fixtures/**` 的變動共 **0** 個。worker 動 12 個檔:報告、`features/05-grading/FEATURE.md`(重複表標已移除)、`witness.ts`、刪 `grading/fake-llm.ts`、`grade-apply.ts`(只有註解)、`grading/index.ts`、`session/build.ts`、`session/summary.ts`、`scripts/boundaries.allow.json`、`scripts/degraded-report.ts`、`scripts/grade.ts`、`scripts/review.ts`。
- 驗收前後 `learning/`(唯一量法):**64 檔 / `ee37f9e1fa9193c6` / 70 行**,前後相同(我只讀)。
- **生產路徑沒有 fake**:`review.ts`、`grade.ts`、`session/`、`grading/` 的非測試檔 `FakeLlmRouter` 零命中;`grading/fake-llm.ts` 不存在;`witness.ts` 沒有 `session.router-default-fake`(訊號目錄 27 → 26)。
- **真路徑**:`review.ts` 的 `liveRouterOrExit()` 與 `grade.ts` 的 `lazyVerifiedRouter()` 都走 `resolveVerifiedLedger(defaultVaultDeps())`,失敗印訊息、退出碼 2;成功才 `createLiveGatewayRouter({ ledger: resolved.ledger })`——與 `scripts/llm.ts` 同一條真呼叫路。`--dry-run` 用 `refusingRouter()`(被呼叫就丟錯),不查帳本。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| vitest `grading` + `session` + `scripts` | 44 檔 1814 條綠、168 跳過;加我的補測後多 7 條 |
| cucumber `@integration and @i2 and not @manual` | 15 場景 15 綠,96 步全綠(base 是 12 個沒有步驟定義) |
| cucumber 全 feature | 759 場景(238 undefined、521 passed、0 failed);undefined 比 base 少(I2 的步驟已定義) |
| `npx tsc --noEmit`、`npm run boundaries`、`npm run lint:docs` | 0 錯、PASS(掃描 269)、PASS(50 條連結) |
| `witness:degraded` | 未標記 **143**(基準 152,可降到 143);目錄/呼叫點/觸發 **26/26/26**(死訊號已移除) |
| 併進最新 main(`2ead49b`,含 T11、T14) | `git merge-tree`:無衝突 |

## 3. 工單 `must_catch` 的突變(我自選,不在 -e5 的清單上)

做法:改一處實作 → 跑 `grading` + `session` + `scripts` 的 vitest,再跑 I2 integration cucumber → 記紅 → `git checkout` 還原。

| 目標 | 突變 | 結果 |
|---|---|---|
| `--dry-run` 不要求指標檔 | S1 `--dry-run` 也走 `liveRouterOrExit()` | 紅 |
| 互動模式帳本壞時退出碼 2 | S2 帳本壞時不退出、退回拒絕型 router;S3 退出碼 2 → 1 | 紅 |
| 0 張卡的檢查早於帳本檢查 | S4 兩段順序互換 | 紅 |
| 「N 張延後」 | S5 0 張時也印;S6 N 用上限而不是延後數;S7 只延後 1 張時不印 | S5、S6 紅;**S7 原本存活**(F-1),補測後紅 |
| `buildTodaySession` 的 router 必填 | S8 執行期不再擋 | 紅 |
| grade.ts 第一二層不要求帳本 | S9 `lazyVerifiedRouter` 一建立就解析帳本(eager);S10 第三層退出碼 2 → 1 | 全紅 |

## 4. Stryker(工單驗收 7)

指令:`CI=1 VITEST_MAX_WORKERS=1 npm run mutate -- --mutate <檔>`,取機器範圍的鎖。

| 檔 | 級別 | 門檻 | 分數 | 殺掉 | 逾時 | 存活 | 無覆蓋 |
|---|---|---|---|---|---|---|---|
| `grading/normalize.ts` | 嚴格 | 95% | **100%** | 3 | 0 | 0 | 0 |
| `grading/fuzzy.ts` | 嚴格 | 95% | **100%** | 14 | 0 | 0 | 0 |
| `grading/grade-fill.ts` | 嚴格 | 95% | **100%** | 59 | 1 | 0 | 0 |
| `session/build.ts` | 標準 | 80% | **100%** | 10 | 0 | 0 | 0 |

(編譯期錯誤的變異體另計,不進分母;跑的時候 load 約 1–4。)

## 5. 對抗審查

沒有跑 grok:這張是接線(把已經驗證過的路徑接到 `review.ts`、`grade.ts`),Stryker 100% 加十條非作者突變已經涵蓋「誰在什麼順序做什麼檢查」;grok 審查對這類接線的價值低於上面的實測。**真批改**(`@llm`、花幾美分)由協調者在主簽出另做,不是我的事。

## 6. 補測

我的 commit(`pollux0971/t13-accept-tests`):`packages/core/src/session/summary-deferred.test.ts`(新,7 條)。

## 7. 成本

worker 名目成本 $8.97;工單 `budget_usd: 4`;比值 **≈ 2.2×**,超過 2× 旗標線,已在此標出。使用者裁決 grok 不設花費上限,只記錄。
