# 驗收證據:T7 §11b 原子寫入只留一份

驗收角色:-ed。日期:2026-10-15(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`pollux0971/t7-impl` @ `4f6f0b1`(base `67e2ad7`,3 個 commit:`c03a0e0` 紅測試、`a72a224` 實作、`4f6f0b1` 報告)。
**開跑 tree sha:`58beb1305f1f88bd3e7d5f3e580fcac1dce06626`。跑完 tree sha:`58beb1305f1f88bd3e7d5f3e580fcac1dce06626`(相同;tracked 檔零變動,每條突變後 `git status --porcelain` 在 tracked 範圍為 0)。**
驗收用簽出:`acceptance-t7`(detached @ `4f6f0b1`,`npm ci`,沒有 `.env`)。對照用簽出:`acceptance-t7-base`(detached @ `67e2ad7`)。兩個都不是主簽出、不是 worker 的 worktree。

我只交證據。不合併、不 push、沒改 worker 的任何 tracked 檔(突變都在驗收簽出做,事後 `git checkout` 還原並重跑確認回綠)。

## 結論

**有阻擋項 1 條**(文件連結);程式與測試本身,我沒找到阻擋項。結論由顧問裁決。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| B1 | 阻擋 | `npm run lint:docs` 紅:2 條連結指到被刪的 `lint/atomic-write.ts`,連帶 3 個測試紅 | 協調者已說明併批時另開 docs commit 修(連結改純文字) |
| F1 | 偏離 | 工單 A3「不改 `atomic-write.test.ts`」,實際改了 1 條既有測試 | 理由成立(見下),請顧問確認 |
| F2 | 提醒 | 寫紅測試與寫實作是同一份報告、同一個 worker | 請顧問確認是否違反「測試與實作不同 session」 |
| F3 | 缺口 | 自選突變 X12 存活:`appendLineAtomic` 拆成兩次 `writeSync`,41 個測試仍綠 | 既有缺口,非 T7 引入;建議補一條 |
| F4 | 超支 | 實際花費 $9.37 / 預算 $4 = 2.34 倍,**超過 2 倍** | 協調者提供的數字,非我量得 |

## 1. 乾淨簽出與重編(流程第 1、2 步)

- 乾淨簽出見上。`ls <acceptance-t7>/.env` → `No such file or directory`。
- T7 沒有 Rust 變更(`git diff 67e2ad7 4f6f0b1 --stat` 無 `apps/`、無 `.rs`)。只有 `features/steps/desktop-shell-phase2.steps.ts` 用到預編的 `lc-fs`,那組與 T7 無關,且驗收簽出沒有 `target/`。**重編:不適用**;本次驗的全是 TypeScript,vitest 與 tsx 每次直接讀 `.ts` 原始碼。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯誤,5.4 秒 |
| `npm run boundaries` | PASS,納管 269 / 掃描 269(100%),無未納管;新 `.ts` 在既有前綴下,不需另登記 |
| vitest `schema ingest lint session` 四個目錄 | 37 檔 650 測試。**第一次跑 1 failed**(`ingest/deps.test.ts` 的 `analyzeDependencies` 第一個 `it`,冷啟動),之後同一組連跑 3 次全綠、`deps.test.ts` 單檔連跑 8 次全綠。1/12,**沒有抓到失敗訊息原文**,歸類為冷啟動逾時,未證實 |
| 突變用的 4 個測試檔 | 41 測試全綠(`atomic-write.test.ts`、`atomic-write.vectors.test.ts`、`state.test.ts`、`append-log-event.test.ts`) |
| cucumber `features/01-data-layer/phase-2.feature`(`NODE_OPTIONS=--import=tsx cucumber-js`,設定檔 `paths` 會吃到全部 feature) | T7:677 scenarios(241 undefined、436 passed),3161 steps。**base 同樣是 677 / 241 / 436 / 3161 steps(1076 undefined、113 skipped、1972 passed)**,逐數相同。241 undefined 是既有狀態(base 退出碼同為 1),不是 T7 造成 |
| 完整 vitest(由 `witness:degraded` 跑出) | T7:3107 測試 / 118 檔,**3 失敗**(都是 B1)。base:3099 測試 / 117 檔,全綠。T7 多 8 個測試 |

## 3. 工單 must_catch 九條

做法:只改實作(或向量檔),跑上面那 4 個測試檔,記紅與失敗訊息,`git checkout` 還原,再跑確認 41 綠。腳本與每條原始輸出在驗收者的暫存區,不進版控。

| 條 | 突變 | 結果 | 失敗訊息原文(節錄) |
|---|---|---|---|
| 1 拿掉目錄 fsync | `renameSync` 後不呼叫 `fsyncDir` | 紅 14 | `沒有 fsync 目標所在的目錄:fsync:file → rename → unlink: expected -1 to be greater than or equal to 0` |
| 2 EIO 被吞 | 目錄 fsync 的 catch 不分錯誤碼 | 紅 6 | `目錄 fsync 的 EIO 被吞掉了: expected undefined to be Error: EIO: i/o error, fsync` |
| 3 rename 失敗沒刪 tmp | finally 的 `unlinkSync(tmp)` 拿掉 | 紅 5 | `失敗後留下了 .tmp 殘檔: expected true to be false` |
| 4 tmp 名稱不對 | 改回 `.<name>.<pid>.<ts>.tmp` | 紅 4 | `expected '/tmp/lc-atomic-…/.reviews.json.3…' to be '/tmp/lc-atomic-…/reviews.json.tmp'` |
| 5 清理錯誤蓋掉原錯 | 清理 catch 只吞 ENOENT,其餘重丟 | 紅 2 | `expected Error: EPERM: operation not permitted, un… to be Error: EIO: i/o error, rename` |
| 6 舊樣式殘檔不再清 | 拿掉 `cleanupStrayTmp(path)` 呼叫 | 紅 2(vitest)**+ cucumber 紅** | vitest:`expected [ '.reviews.json.12345.999.tmp', …(1) ] to deeply equal [ 'reviews.json' ]`。cucumber `A write interrupted part way leaves the old file intact` 的 `And a stray temporary file is cleaned up on the next write`:`殘留的 tmp 檔應該被下一次寫入清掉:[".reviews.json.3620403.1792026620033.tmp","reviews.json"]`(未突變 4/4 步綠;突變 3 綠 1 紅;還原後 4/4 綠) |
| 7a `state.ts` 自己 rename | import 並使用 `renameSync` | 紅 1 | `expected [ 'renameSync' ] to deeply equal []` |
| 7b `appendLogEvent` 自己 `appendFileSync` | 換掉 `appendLineAtomic` | 紅 1 | `expected [ 'appendFileSync' ] to deeply equal []` |
| 8a `scripts/lint.ts` 自己 rename | 改回 `writeFileSync` + `renameSync` | 紅 1 | `…/scripts/lint.ts: expected [ 'renameSync' ] to deeply equal []` |
| 8b `lint/atomic-write.ts` 留著 | 新增含 open/fsync/rename 的同名檔 | 紅 1 | `lint/atomic-write.ts 不該還在: expected true to be false` |
| 9a 向量檔少一列 | 刪 `dir-fsync-eio` | 紅 1 | `expected [ 'syscall-order', …(9) ] to deeply equal [ 'syscall-order', …(10) ]` |
| 9b 向量檔改一列(證明真的被讀) | `dir-fsync-eio` 的預期 code 改 `EBUSY` | 紅 1 | `dir-fsync-eio: expected 'EIO' to be 'EBUSY'` |

九條全部變紅,每條還原後 41 全綠。

## 4. 自選突變(工單沒列;要求 ≥ 3,做了 12 條)

| 條 | 突變 | 結果 |
|---|---|---|
| X1 | 拿掉檔案 fd 的 fsync(第 2 步) | 紅 4:`沒有 fsync 檔案內容:rename → fsync:dir → unlink: expected -1 …` |
| X2 | 目錄 fsync 排到 rename 之前 | 紅 5:`fsync(目錄) 沒有排在 rename 之後:fsync:file → fsync:dir → rename → unlink: expected 1 to be greater than 2` |
| X3 | `fsyncDir` 漏關 fd | 紅 6:`結束時還開著的 fd: expected [ '27=/tmp/lc-atomic-…/state' ] to deeply equal []` |
| X4 | 舊樣式清理不分目標檔(會誤刪別人的殘檔) | 紅 1:`does not touch a stray tmp file belonging to a different target file` |
| X5 | 也吞 `ENOSPC` | 紅 2:`dir-fsync-enospc 應該丟錯: expected undefined to be an instance of Error` |
| X6 | `appendLineAtomic` 不補換行 | 紅 4 |
| X7 | `appendLineAtomic` 不 fsync | 紅 1:`expected "vi.fn()" to be called 1 times, but got 0 times` |
| X8 | `atomicWriteJson` 去掉結尾換行 | 紅 1:`expected '{\n  "a": 1\n}' to be '{\n  "a": 1\n}\n'` |
| X9 | `atomicWriteJson` 不再建目錄 | 紅 8:`ENOENT: no such file or directory, open '/tmp/lc-atomic-…/state/ingested.json.tmp'` |
| X10 | tmp 以 `'wx'` 開(遇到殘留的 `<name>.tmp` 會 EEXIST) | 紅 2:`stale-tmp-overwritten: expected Error: EEXIST: file already exists, open … to be undefined` |
| X11 | `appendLineAtomic` 的 `'a'` 改 `'w'`(截斷 log) | 紅 2:`expected '{"n":2}\n' to be '{"n":1}\n{"n":2}\n'` |
| G3 | `atomicWriteJson` 改用 `writeFileSync` 直寫(不在七個名字內) | 紅 10:`state.ts 非註解程式碼裡,第二份寫入的七個 syscall 名字零命中,而且寫入本身是轉呼叫` 等(被「寫入本身是轉呼叫」那半條抓到,不是只靠名單) |
| **X12** | **`appendLineAtomic` 拆成兩次 `writeSync`(一行被切開)** | **存活:41 passed。** `atomic-write.test.ts` 對 append 只量 fsync 與 close 次數、沒有任何測試斷言 `writeSync` 只呼叫一次、整行一次寫完。base 的測試檔也沒有 `writeSync` 斷言,所以是既有缺口,非 T7 引入。函式註解把「單一 `writeSync`」當成原子性的依據,但沒有測試鎖它。建議補一條 |

## 5. Stryker(工單驗收 13)

`npm run mutate -- --mutate "packages/core/src/schema/atomic-write.ts"`,perTest 覆蓋,concurrency 4,`VITEST_MAX_WORKERS=1`。09:36:13 → 09:37:48,共 1 分 34 秒。load:開跑 2.00,收尾 9.25(同時有 T5 的 worker 在跑測試)。
結果:**總分 100.00,49 killed、0 timeout、0 survived、0 no-cov、1 error**(error = 型別檢查器擋下的不能編譯變異體,不算存活)。每個變異體平均跑 9.70 個測試。
沒有存活變異體,所以沒有需要標「補測試」或「等價」的項目。注意:Stryker 的運算子不會產生 X12 那種「拆成兩次寫」的變異,所以 100% 與 F3 不矛盾。

## 6. 對抗式審核(流程第 4 步)

模型 `xai/grok-4.20-0309-reasoning`,經 `opencode run`(`grok` CLI 沒有這個模型 id,只有 grok-4.7 等;opencode 有)。工作目錄在暫存區,不在 repo,給它的是 prompt 檔(工單背景 + 實作 diff + 兩個新測試檔 + 向量檔),要求只讀。耗時 1 分 50 秒。結論「有阻擋項」。逐條我自己重驗:

| grok 主張 | 我的重現 | 判定 |
|---|---|---|
| 1 高:目錄不存在時 `cleanupStrayTmp` 的 `readdirSync` 會丟 ENOENT,不是 open 丟 | `writeFileAtomic('/tmp/lc-no-such-dir-xyz/foo.json','c')` → 丟 `ENOENT`,`syscall: open`。`cleanupStrayTmp` 第 17 行 `if (!existsSync(dir)) return;` 先擋掉了 | **不成立** |
| 2 高:固定 `<name>.tmp` 使並行寫同一目標不安全 | 沒做並行重現。這是契約 §11b 本文規定的檔名(「固定是 `<name>.tmp`」),不是 T7 的缺陷。並行保護靠另外的鎖(T5) | **契約既定,非本張問題**;未重現 |
| 3 高:靜態檢查可被繞過(`writeFileSync`、刪向量列但不改清單) | 做了 G3(`writeFileSync` 直寫)→ 紅 10,被「寫入本身是轉呼叫」抓到;做了 9a(刪向量列)→ 紅 | **不成立**(兩種繞法都被擋) |
| 4 高:append 沒有錯誤路徑 / 半行測試,是同義反覆 | 半行與 crash 無法穩定重現(單一 `writeSync`+`O_APPEND` 的原子性是 POSIX 保證)。但這個方向引出 X12:**拆成兩次寫真的沒有測試擋** | **部分成立**:X12 證實了缺口(F3);「crash 留半行」未證實 |
| 5 中:殘檔名 `.reviews.json.999.888.tmp.extra` 會被誤刪 | 建檔後呼叫 `writeFileAtomic`:剩 `['.reviews.json.999.888.tmp.extra','reviews.json']`,`.extra` 檔保留(regex 有 `$` 錨) | **不成立** |
| 6 中:很多向量對自己的 mock 同義反覆,把 `fsyncDir` 移到 rename 前測試仍綠 | 做了 X2(目錄 fsync 移到 rename 前)→ 紅 5 | **不成立**(該重現直接失敗) |

grok 的六條裡,我能證實的只有 F3 一條(而且是我借它的方向另外做 X12 才證實的,它提的重現方式本身不成立)。

## 7. `learning/` 前後(流程第 5 步)

指令照 T3 報告的算法,只輸出數字:
- 開跑前(09:00:42):`files=167 hash=196ae19b043f3cd2 ledger=52`
- 跑完後(09:38:13):`files=167 hash=196ae19b043f3cd2 ledger=52`
- 三項前後相同,也與協調者給的基準相同。只讀,沒寫。腳本從驗收簽出外的暫存區以絕對路徑量,沒有載入任何 `.env`。
- 本檔不含 `learning/` 的任何檔名或內容。

## 8. 其他守門(我只跑了輕的;`check:all` 是協調者併批時跑)

| 項目 | T7 | base 67e2ad7 |
|---|---|---|
| `npm run lint:docs` | **紅(B1)**:2 條連結指到不存在的檔 | 綠 |
| `scripts/check-doc-links.local.test.ts` + `scripts/zero-input-guard.test.ts` | 3 失敗(下) | 774 passed、164 skipped,全綠 |
| `npm run witness:degraded` | 退出碼 1:未標記 154 > 基準 152(多 2) | **同樣退出碼 1:未標記 154 > 基準 152** |

**B1 細節**:
- `docs/02-decision-map.md:1347` → `../packages/core/src/lint/atomic-write.ts:40`
- `docs/tickets/T7-single-atomic-write.md:37` → `../../packages/core/src/lint/atomic-write.ts:40`
- 這兩處是已在 main 的文字;T7 刪掉了被指的檔,連結就斷。連帶紅的三個測試:`check-doc-links.local.test.ts` 的「沒有 --root 就掃這個 repo:連結數 > 0、退出碼 0」與「--verbose 之類不認得的參數不會被當成 root」,以及 `zero-input-guard.test.ts` 的 `check-doc-links.ts · 基線 healthy:exit 0、沒有裸錯誤`。
- worker 報告只跑了 `tsc`、`boundaries`、`check:steps`、cucumber 與 vitest 四個目錄,沒跑 `lint:docs`,所以沒看到。協調者已回覆:併批時另開獨立 docs commit,把這兩處連結改成純文字。我不改。

**witness:degraded 154 > 152 不是 T7 造成**:base 同樣 154、同樣 FAIL。T7 的「觸發退化分支」數字與 base 相同(162,swallow 102、default-path 83)。登記表 8 條、`scripts/degraded-report.ts` 的清理登記只剩 `schema/atomic-write.ts` 一筆,沒有「片段已搬走」或「檔案不存在」的訊息。

## 9. F1、F2 說明

- **F1**:`c03a0e0` 改了 `atomic-write.test.ts` 一條既有測試(`fsyncs the temp file descriptor and closes it exactly once` → `opens <name>.tmp, fsyncs the file then the directory, and closes both`)。舊斷言是 fsync 與 close 各一次,那是缺第 4 步的舊行為,與工單 A1 要求的目錄 fsync 矛盾,兩者不能同時為真。worker 在報告「與工單的出入」第 1 項與程式註解都交代了。其餘既有測試(含 :103、:118 的殘檔案例)沒動。我認為偏離成立,新斷言比舊的更嚴(鎖了開檔名、旗標、兩次 fsync 與兩次 close 的順序)。
- **F2**:報告把紅測試(`c03a0e0`)與實作(`a72a224`)都列為「這輪」的產出,是同一個 worker。工單「測試誰寫」寫的是測試 agent 寫、開發 agent 只改實作。實作 commit 沒有碰任何測試檔(`git show --stat a72a224` 只有 7 個實作檔與設定,已核對),紅測試是獨立 commit。但「寫測試與寫實作不是同一個 session」這條,我從 commit 與報告看不出是否滿足,**不知道**。

## 10. 花費(流程第 6 步)

| 項目 | 數字 |
|---|---|
| worker 實際花費(協調者提供) | $9.37,session `ses_ec30add88ffeDrt18CAfIhEDcV`,1344 秒,grok-4.7 |
| 工單預算 | $4 |
| 比值 | **2.34 倍,超過 2 倍**,標出。worker 報告自己寫「讀不到畫面底列的美元累計,寫不知道」,所以 $9.37 不是 worker 量的 |
| 驗收這張的 LLM 花費 | **不知道**:`opencode run` 不顯示金額。用量:grok-4.20 一次呼叫,prompt 約 34 KB,耗時 1 分 50 秒;沒打 OpenAI(`OPENAI_API_KEY` 沒用到) |
| 驗收 CPU | Stryker 1 分 34 秒;`witness:degraded` 在 T7 與 base 各跑一次(各約 8–9 分,單 worker);其餘為單檔 vitest。load 觀察:基準時 0.8–2.0,Stryker 尾端 9.3(T5 並行) |

## 11. 未做 / 限制

- 沒跑 `check:all`(協調者併批時跑)。
- 沒跑並行寫入的重現(grok 主張 2),它屬契約本文。
- 沒有為 `appendLineAtomic` 補測試(X12),那是測試 agent 的事,我只交證據。
- 冷啟動那 1 次 `deps.test.ts` 失敗沒抓到訊息原文,歸類未證實。
- 完整 cucumber 有 241 個 undefined scenario,base 同數,未調查原因。
