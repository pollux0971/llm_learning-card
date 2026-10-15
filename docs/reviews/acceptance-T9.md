# 驗收證據:T9 帳本每一行過 LogEventSchema、llm_call 三條花費規則

驗收角色:-ed(測試 agent 兼驗收)。日期:2026-10-15(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`t9-opencode` @ `5870214`(worker 兩個 commit:`000f707` 實作、`5870214` 報告),base `t9-base` = `a4d04ff`(`origin/main` `8eda4c2` 加我的 `t9-ticket` `c445397`)。
實作者:opencode grok-4.7(xai)。我的補測在其上的分支 `pollux0971/t9-accept-tests`;所有突變都在驗收用簽出做、事後還原。
我只交證據與測試。不合併、不 push、沒改 worker 的實作檔。

## 0. 結論

**實作沒有阻擋項。** 工單的規則 L、C1–C3 全部照做,`spend.ts` 是唯一被改的實作檔,`parseLedger` 仍是壞行的唯一定義。
測試端補了一類缺口(§4,時間欄位的邊界值)。補完之後 30 條實作突變 28 條紅,另 2 條是等價突變。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| F-1 | 缺口,已補 | 我的壞行表沒蓋到 ts 的邊界:分鐘 60、秒數 60、時區分鐘 60、時區小時 24、ollama 與標記行的 tokens 型別;合法表沒有蓋到「最大值」(12/31 23:59:59、時區 ±23:59),所以「邊界多擋一格」的突變(`>=`)存活 | 補 10 列壞行 + 5 列合法;相關 11 條突變全紅 |
| F-2 | 備註,等價 | `day < 1`、`month < 1` 兩個守衛拿掉仍然正確:`Date.UTC` 的滾動會讓回頭對年月日時對不上 | 等價突變,不補 |
| F-3 | 備註,無害 | 年份 0000–0099 一律被拒:`Date.UTC(50, …)` 會把兩位數年當 19xx,回頭對不上。這是意外的行為,但帳本不可能有那種年份 | 不處理 |
| F-4 | 流程 | 這次 Stryker 試了四次才跑成:兩次是機器上別的工作把 load 推到 9–14 造成 5 秒逾時,一次是 `node_modules` 用 symlink 指到主簽出,「合成 worktree」的測試找不到模組。驗收簽出要有自己的 `node_modules`,而且 load 要低 | 已用複製的 `node_modules` 與等 load < 3 解決 |
| F-5 | 成本 | worker 名目 $4.80,預算 $3 = 1.6×(未超過 2× 旗標線);使用者裁決 grok 不設花費上限 | 記錄 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 `acceptance-t9`(基於 `t9-opencode`)。
- **測試作者檢查**:`git diff --name-only a4d04ff 5870214` 中 `*.test.*`、`features/steps/**`、`contracts/fixtures/**` 的變動共 **0** 個;worker 只動了 `packages/core/src/llm/spend.ts` 與報告。
- 驗收前後 `learning/`(唯一量法):**64 檔 / `c5aa80b18b474ed4` / 52 行**,前後相同(我只讀)。
- **真帳本通過新規則**:用 worker 的 `parseLedger` 讀真的 `learning/state/log.jsonl`:`ok events=52`(52 行全部合規;沒有印任何內容)。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `packages` + `scripts` 的 vitest(`VITEST_MAX_WORKERS=1`) | 121 檔,3488 綠、168 跳過、0 紅 |
| 全部 vitest(`witness:degraded` 內含) | 3635 綠、168 跳過,0 紅 |
| cucumber 全 feature | 716 場景(241 undefined、475 passed),3318 步;與 main 基準相同 |
| `npx tsc --noEmit` | 0 錯 |
| `witness:degraded` | 未標記 **147**(基準 152,可以降到 147);目錄/呼叫點/觸發 27/27/27;觸發退化分支 152(swallow 98、default-path 77) |
| 併進最新 main(`c293f90`) | `git merge-tree`:無衝突 |

## 3. 工單 `must_catch` 的突變

做法:改一處實作 → 跑相關測試(`ledger-line-schema`、`llm-spend`、`ledger-bad-lines`、`spend`,共 235 條)→ 記紅 → `git checkout` 還原 → 確認回綠。24 條對 worker 實作寫的突變(W1–W25,沒有 W17):

| 工單條 | 突變 | 結果 |
|---|---|---|
| 負的 tokens 抵掉花費 | W1 負數放行 | 紅(11 條) |
| tokens 是字串/null/小數… | W2 tokens_in 不檢查、W24 tokens_out 不檢查、W21 超過安全整數放行 | 全紅 |
| tokens 在計價行缺少 | W11、W12 | 紅 |
| 缺 ts 的行被跳過 / schema 驗證被拿掉 | W3 `if (!schema.success)` 永遠不成立 | 紅(18 條) |
| ts 不是 ISO / 不是真實日期 | W4 C1 整段拿掉、W5 不回頭對日期、W6 時區可省、W7 小時 25、W18 時區分鐘、W19 秒 60、W23 分鐘 60 | 全紅(W18、W19、W23 原本存活,補測後紅) |
| 計價行缺 provider | W10 | 紅 |
| 標記只看 truthy / ollama 不分大小寫 | W8、W9 | 紅 |
| ollama / 標記行免 tokens 型別規則 | W15、W16 | 原本存活,補測後紅 |
| 行號不是第一個 / 訊息不點名 | W13、W14 | 紅(14、12 條) |
| 物件以外的值(陣列)當事件 | W25 | 紅 |
| 等價 | W20(`day < 1` 拿掉)、W22(`month < 1` 拿掉) | 存活,等價(F-2) |

另做 6 條「邊界多擋一格」(B1–B6:`month >= 12`、`hour >= 23`、`minute >= 59`、`second >= 59`、`zoneHour >= 23`、`zoneMinute >= 59`):這些是 Stryker 找出來存活的,補了合法表的最大值之後全紅。

## 4. Stryker

`packages/core/src/llm/spend.ts`:**90.84%**(殺 220、逾時 8、存活 22、無覆蓋 1、編譯錯誤 96)。T8 時是 98.06%(檔案變大、新增的時間驗證邏輯有許多等價的守衛)。
存活 22 個:
- 1 個是 `MissingLedgerError` 的 name(既有,T8 就有);
- 18 個在 `isRealIso8601WithZone`:其中的比較邊界(`>=` 那一類)就是 F-1,補測之後已經用 B1–B6 逐個驗過會紅;其餘是 `month < 1`/`day < 1`/`match[8] !== 'Z'`/年份與月份對照的等價守衛(F-2、F-3);
- 3 個在 `year` 對照的條件(同 F-3)。
- 1 個無覆蓋:`schema.error.issues[0]?.message ?? '驗證失敗'` 的備援字串(zod 一定給 message,不可達)。
補測後沒有重跑整個 Stryker(要 5 分鐘以上且 load 低);用 B1–B6 與 W 系列定點驗證代替。

## 5. 補測

我的 commit(`pollux0971/t9-accept-tests`):
- 補 10 列壞行(小時 24、分鐘 60、秒 60、日 00、月 00、時區小時 24、時區分鐘 60、ollama 的 tokens_out 負數、逾時行的 tokens_in 負數、重試行的 tokens_in 字串);
- 補 5 列合法(最大值、最小值、時區 ±23:59、+00:00)。

## 6. 對抗審查(grok-4.20)

`opencode run -m xai/grok-4.20-0309-reasoning`,從空目錄跑,提示給規格與 diff。五條主張,我逐條自己重現:

1. 把 `type` 手改成非 `llm_call`(例如 `warning`)就繞過 C 規則——**成立但無法偵測**:改 `type` 的行本來就不是花費行,任何規則都分不出它是手改的。範圍外。
2. 在完整計價行上加 `truncated: true` 會少算——**不成立**:`computeDailySpend` 只看 tokens 欄位,有 tokens 就照算(重現:`tokens_in` 1,000,000 加 `truncated: true` → `usd: 2.5`)。
3. 手改 `provider: "ollama"` 讓花費變 0——**成立但既有**:`ollama` 免費是設計(`isLlmCallEvent` 本來就這樣),手改 provider 無法偵測。範圍外。
4. `ts` 規則太嚴——**不成立**:`.123+08:00` 通過(重現);小寫 `z`、`+0800`、缺秒數被拒是工單 C1 規定的,寫入端用 `toISOString()`(`Z` 加毫秒)。
5. 日期驗證漏洞(年份 0000、`2026-04-31`、`2026-02-30T25:00:00Z`)——**不成立**:三個都被拒(重現)。

## 7. 成本

worker 名目成本約 $4.80;工單預算 `budget_usd: 3`。比值 **1.6×**,未超過 2× 旗標線。使用者裁決 grok 不設花費上限,只記錄。
