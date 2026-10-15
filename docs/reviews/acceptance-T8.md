# 驗收證據:T8 帳本的剩餘缺口(壞行=不知道、壞標記 --force 重建、全新安裝、指標 0600)

驗收角色:-ed(測試 agent 兼驗收)。日期:2026-10-15(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`t8-claude` @ `5552e75`(worker 兩個 commit:`2a9abb1` 實作、`5552e75` 報告),base `t8-base` = `687cfc5`(`origin/main` `6f00771` 加我的紅測試 `0e578be`)。
我的補測在其上的分支 `pollux0971/t8-accept-tests`;所有突變都在驗收用簽出做、事後還原。
我只交證據與測試。不合併、不 push、沒改 worker 的任何實作檔。

## 0. 結論

**實作沒有阻擋項。** 工單十二條 `must_catch` 都有會紅的測試;worker 的紅測試在實作上全綠。
測試端找到並補上三類缺口(§5),補完之後 33 條突變 31 條紅,另 2 條(M11b、M11d)單獨存活但兩者同時做會紅(§3,成對冗餘,不是漏洞)。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| F-1 | 缺口,已補 | 舊標記顯示的三處沒有測試:反斜線轉義(S12)、空檔標示(S13)、「沿用指標 id」那條路也要先印舊標記(M5a)——拿掉任何一個,全部測試仍綠 | 補測 3 條 + 邊界/截斷/整段輸出 3 條,三個突變全紅 |
| F-2 | 缺口,已補 | `T8 E` 的 umask 測試在 Stryker 底下全紅:Stryker 的 vitest runner 固定用 worker threads,worker 裡 `process.umask(mask)` 會丟 `ERR_WORKER_UNSUPPORTED_OPERATION`。結果 vault.ts 根本跑不了 Stryker | 測試改成「換不了就用當下的 umask」,標記檔權限斷言跟著實際生效的 umask 算;一般 vitest 照指定的 mask 跑 |
| F-3 | 缺口,已補 | `UnknownSpendError` 的訊息尾句與物件欄位(只留路徑與行號、不留整行)沒有測試(Stryker 存活) | 補測 1 條 |
| F-4 | **新發現,既有行為,建議後續處理** | `computeDailySpend` 對「JSON 合法、是 llm_call 事件,但欄位壞掉」的行會**低估**花費:`tokens_in` 是字串或缺少 → 該次算 0;`tokens_in` 是負數(例如 −1,000,000)→ 與其他行抵銷(5 美元變 0 美元);`ts` 不是 ISO 字串 → 被排除在今日之外。T8 沒碰 `computeDailySpend`,這也不在工單的「壞行」定義裡 | 建議開後續工單:`llm_call` 事件的 tokens 欄位非有限非負數、`ts` 不可解析,一律當壞行(同一條「不知道」規則)。不擋 T8 |
| F-5 | 備註 | 兩個 init 同時跑時,指標與標記的 id 會不一致(§6,20 輪裡 6–9 輪)。工單的「已知限制」已寫明這是已知的,測試只斷言「不留壞檔、不留殘檔」 | 使用者看到 show 的 `match: no` 之後用 `init --force` 修 |
| F-6 | 成本 | worker 名目成本 $10.78,工單預算 $4(顧問核可到 $11)= 2.7×,超過 2× 旗標線 | 標出;在核可上限內 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 `acceptance-t8`(基於 `t8-claude`,`npm ci`),沒有 `.env`。
- **測試作者檢查**:`git diff --name-only 687cfc5 5552e75` 中 `*.test.*`、`features/steps/**`、`contracts/fixtures/**` 的變動共 **0** 個;worker 動了 9 個實作檔加一份報告(`ledger.ts`、`spend.ts`、`index.ts`、`golden-run.ts`、`atomic-write.ts`、`witness.ts`、`llm-spend.ts`、`vault.ts`、`zero-input-roster.ts`)。測試檔在 `687cfc5` 之後的變動只有我的補測 commit。
- 驗收前後 `learning/`(新量法:排除 `.git`、固定 `LC_ALL=C` 排序):**檔數 64、雜湊 `c5aa80b18b474ed4`、帳本 52 行**,前後相同(我全程只讀,沒有寫)。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| T8 紅測試(`ledger-bad-lines.test.ts` 等)在 worker 實作上 | 全綠(worker 開工時紅,低負載重跑 73 個相關檔 2465 條綠、168 跳過;worker 報告的 16 條逾時是負載 10–14 下的逾時,低負載重驗全綠) |
| 全部 vitest(`witness:degraded` 內含,`CI=1 VITEST_MAX_WORKERS=1`) | 131 檔,3454 綠、168 跳過、0 紅 |
| cucumber 全 feature | 677 場景(241 undefined、436 passed),3161 步;與 base 相同(T8 沒有碰 gherkin) |
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries`、`npm run lint:docs` | PASS |
| `witness:degraded` | 觸發退化分支 156(swallow 102、default-path 77);未標記 **151**,低於基準 152(`bad-line-skipped` 與 `local-prober-default` 兩個訊號不再被觸發);目錄/呼叫點/觸發 27/27/27(原本 28,少一個) |
| 併進最新 main(`ccbe32d`) | `git merge-tree`:無衝突 |

## 3. 工單 `must_catch` 的突變

做法:改一處實作 → 跑相關測試(`packages/core/src/llm`、`prompt-quality`、`schema/atomic-write`、`scripts/vault`、`scripts/llm-spend`,共 723 條)→ 記紅 → `git checkout` 還原 → 確認回綠。腳本與 33 條突變清單在驗收者的暫存區,不進版控。

| 工單條 | 突變 | 結果 |
|---|---|---|
| 壞行被跳過 | M1a JSON 壞的行被跳過;M1b 不是事件的行被跳過 | 紅(19、12 條) |
| 壞行判定又有兩份 | M2 `llm-spend.ts` 又長出自己的 `JSON.parse` | 紅 |
| 錯誤訊息沒指示去跑 llm-spend | M3 | 紅 |
| 有壞行時 router 仍打 adapter | M4 router 把 `UnknownSpendError` 吞成 0 | 紅(5 條) |
| `--force` 重建沒先印舊內容 | M5a(沿用 id 那條路)、M5b(新 id 那條路) | M5b 紅;**M5a 存活→補測後紅** |
| 不加 `--force` 就重建 | M6 | 紅(7 條) |
| 驗證過但 log 不存在時 exit 2 | M7a;M7b 未驗證的帳本檔案不存在也算全新安裝;M7c 任何讀檔錯誤都算全新安裝 | 全紅 |
| 報告沒註明「帳本還沒有紀錄」 | M8a;M8b `--json` 的 `log_exists` 永遠 true | 紅 |
| 指標檔權限放寬 | M11a 0664;M11c 沒給 mode 時預設也變 0600;S15 重建分支不傳 mode | 全紅 |
| 同上(暫存檔權限) | M11b 拿掉 `fchmod`;M11d 建立暫存檔不帶 mode | **兩者單獨都存活**;M11e = 兩個同時做 → 紅(5 條)。兩層各自保證 0600,任一層單獨壞掉時另一層補上,結果沒有錯——不是漏洞 |
| `createDefaultLiveRouter` 走預設 prober | M12 | 紅 |
| `learning_dir` 是 symlink | 未突變——工單 D 是純測試(實作本來就對),測試在實作上綠 | 無突變可做 |
| 兩個 init 同時跑 | 未突變——同上 | 見 §6 |

自己多做的 15 條(S1–S15):壞行判定的邊界(ts 型別、陣列、null、空白行、預覽 80→81 字、行號 0-based)、錯誤類別 name、重建時沿用指標 id 的兩個前提、舊標記預覽 200→201 位元組、控制字元、反斜線(S12)、`\xNN` 補零(S14)、空檔標示(S13)。S12、S13 原本存活,補測後紅;其餘原本就紅。

## 4. Stryker

| 檔 | 分數 | 殺掉 | 存活 | 無覆蓋 | 備註 |
|---|---|---|---|---|---|
| `packages/core/src/llm/spend.ts` | **98.06%** | 101 | 2 | 0 | 兩個存活:`MissingLedgerError` 的 name 字串(既有,不是 T8)、`UnknownSpendError` 訊息尾句(補測後會殺,未重跑) |
| `scripts/vault.ts` | **81.86%**(T5 時 76.88%) | 167 | 7 | 30 | 無覆蓋 30 個全是 `main()` 子程序入口與引數解析(T5 時也是同樣 30 個,ADR-030:CLI 入口由子程序測試手動驗證)。存活 7 個:`fail()` 結尾換行的方法替換、舊標記預覽初值字串、`given === ''` 與 `markerId !== undefined` 兩個等價條件、`main` 守衛三個 |

vault.ts 第一次跑 Stryker 是 F-2 的假失敗(dry run 紅),修測試之後兩次才跑成;以上是修完之後的數字。

## 5. 補測

我的 commit(`pollux0971/t8-accept-tests`):
- `5c792fe`:修好壞行之後的測試改用便宜的呼叫(`call(DAY, 1000)`,否則測到的是預算而不是壞行);舊的「壞行只跳過那一行」測試(`spend.test.ts`)改寫成「丟 `UnknownSpendError`」,並加「空白行不是壞行」。
- `9d1519a`、`42a45ab`:舊標記顯示——反斜線轉義、空檔標示、沿用 id 的路徑先印舊標記、可列印邊界(空白、`~` 原樣,0x1f、0x7f 轉義)、剛好 200 位元組不加註 / 201 才加註、兩條 `--force` 成功輸出整段逐字比對。
- `f9d3eb4`、`55fa541`:F-2。
- `4e4f2d1`:F-3。

## 6. 同時 init 的 id 不一致次數

`T8 D` 那條測試(3 個子程序同時 init 同一個全新資料夾,20 輪)跑 3 次:指標與標記 id 不一致的輪數是 **6、8、9**(平均約 7.7/20)。測試斷言的是工單寫的:退出碼只有 0 或 1、指標檔存在就是合法 JSON、沒有暫存檔殘留、標記存在就是合法 uuid——三次都過。不一致時 `show` 會報 `match: no`,使用者用 `init --force` 修(已知限制)。

## 7. 對抗審查(grok-4.20)

`opencode run -m xai/grok-4.20-0309-reasoning`,從空目錄跑,提示只給 diff 與工單。第一次逾時沒有輸出,重試成功。六條主張,我逐條自己重現:

1. 壞掉但合法的 JSON 事件欄位會讓花費偏低——**部分成立,既有行為**(F-4)。
2. router 的各條路徑沒有都擋住壞行——由 `ledger-bad-lines.test.ts` 的 router 測試蓋住;M4 紅。
3. 標記是目錄或 symlink 時的行為——低風險,走「標記不合法」那條,要 `--force`。
4. `state` 是懸空 symlink 時花費變 0——低風險,與 T5 的 F-C 同一類(ENOENT 視為全新安裝),已由 M7c 守住「只有 ENOENT 算全新」。
5. `fchmod` 與 umask——實作有 `fchmod`,測試涵蓋(M11e)。
6. 測試洞——用突變查過:5 個存活,3 個是真缺口(F-1,已補),2 個是成對冗餘。

## 8. 成本

worker 名目成本 $10.78;工單預算 `budget_usd: 4`;顧問核可到 $11。比值 **2.7×**,超過 2× 旗標線,已在此標出。在核可上限內。
