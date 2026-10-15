# 驗收證據:T5 帳本指標、身分標記、機器鎖

驗收角色:-ed(測試 agent 兼驗收)。日期:2026-10-15(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`pollux0971/t5-claude` @ `45f1478`,tree `fbe59b86c09fe396551489270894c9f1316e7c74`,base `67e2ad7`,相對 base 共 10 個 commit。
**開跑 tree sha:`fbe59b86c09fe396551489270894c9f1316e7c74`。跑完 tree sha:`fbe59b86c09fe396551489270894c9f1316e7c74`(相同)。** 所有突變都在驗收用簽出做,事後還原,`git status --porcelain` 在 tracked 範圍為 0。
驗收簽出:`acceptance-t5`(detached @ `45f1478`,`npm ci`,沒有 `.env`),補測在其上的分支 `pollux0971/t5-accept-tests`。
我只交證據與測試。不合併、不 push、沒改 worker 的任何實作檔。

## 0. 結論

**實作沒有阻擋項。** 測試端找到並補上 6 個缺口(§9),補完之後所有非等價的突變都是紅。有 3 件事請顧問決定(§10 的 D1–D3),另有 1 個**既有的、錢的方向**的弱點要開後續工單(§10 的 F-A)。結論最後由顧問裁。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| F-A | 既有弱點(不是 T5 引入) | `readDailySpend` 遇到壞行就跳過,花費被低估:兩行合計 5 美元,壞掉一行變 2.5。煞車(router 的日上限)因此放行更多。`llm-spend` 的報告路徑是「壞行=算不出來」,兩邊姿態不一致 | 建議後續工單 |
| F-B | 設計限制 | 型別分不出 adapter 是真是假:`ExplicitLedger` 加上真的 adapter 編得過。已用靜態清單釘死使用處(補測三) | 已補測 |
| F-C | 設計限制 | 帳本只在建構時驗證一次(把 logPath 烤進物件);之後指標或標記被換、`state/` 被換成 symlink 都不會再驗。沒有 symlink 與並行 init 的測試 | 已知,未補 |
| D1 | 待決 | `init` 遇到內容不是合法 uuid 的標記檔,連 `--force` 也拒絕(要人工處理)。工單的表沒有這一列 | 請顧問確認 |
| D2 | 待決 | `--probe` 不解析帳本(worker 報告 §2.8 第 1 點);`llm-spend` 在「驗證過的帳本、log 檔不存在」仍 exit 2,而 `readDailySpend` 同情況回 0(§2.8 第 3 點) | 請顧問確認 |
| D3 | 待決 | worker 改了 `packages/contracts/src/witness.ts`(移除兩個退化訊號),不是 `contracts/` 的硬約定,但是 contracts 擁有者的檔 | 請顧問知悉 |
| F-D | 守門 | `witness:degraded` 未標記 155 > 基準 152。base 67e2ad7 已是 154 > 152(我在 T7 驗收時量過),T5 讓它多 1 | 鏈上本來就紅,多 1 |
| F-E | 超支 | worker 狀態列 $22.894(Max 訂閱等值)/ 預算 $6 = 3.8 倍,**超過 2 倍**;前一個 grok worker $25.39(被中斷) | 協調者提供 |
| F-F | 流程 | 17 個測試檔來自開發 worker,不是測試 agent | 已逐檔收下,見 §8 |

## 1. 乾淨簽出

- `ls <acceptance-t5>/.env` → `No such file or directory`。依賴 `npm ci`。
- 驗收前記下:`learning/` 前 `files=167 hash=196ae19b043f3cd2 ledger=52`(10:03:48);真指標檔 `~/.config/llm-learning-cards/vault.json` **不存在**(連 `llm-learning-cards` 目錄也不存在);`/run/user/1000/llm-learning-cards/` 存在、空的、mtime 08:58。
- T5 沒有 Rust 變更,**不需要重編** lc-fs。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯誤。**這一項不能省**:工單第 8 條的型別測試(`@ts-expect-error`)只有 tsc 驗得到,vitest 不做型別檢查(worker 報告 §3 第 3 點) |
| `npm run boundaries` | PASS,掃描 223 |
| `git grep` 舊 import(`resolveVaultRoot`、`resolveVaultLearningDir`、`llm/vault`) | 零命中;`vault.ts` 與 `vault.test.ts` 被刪,沒有遺漏的呼叫端 |
| 與 T5 相關的 35 個測試檔(用**真的 HOME 與 XDG**,不是沙箱) | 35 檔 1120 條全綠;跑完真指標檔仍不存在、runtime 鎖目錄沒變 |
| cucumber 全 feature | 677 scenarios(241 undefined、436 passed),3161 steps——與 base 67e2ad7 **逐數相同**。phase-4 的「The probe reports the gateway as unavailable instead of crashing」單跑:1 passed,6 steps passed(worker 報告 §3 第 4 點沒跑的那條) |
| 完整 vitest(由 `witness:degraded` 跑出) | 3239 條全綠,`ran_all` 真(退出碼 0,3239/3239)。比 base 多 140 條 |
| `npm run lint:docs`、`npm run check:steps` | PASS(48 條連結;scanned=2309) |
| 併進最新 main(`ea4e688`,含 T7 與批次 G)後 | `git merge-tree` 無衝突;在合併樹上 tsc 0 錯、boundaries PASS(226)、lint:docs PASS、T5 測試加 schema/ingest/lint/desktop 共 72 檔 2564 條全綠(168 條由退化見證器跳過) |

## 3. 工單 must_catch 十條(14 個突變,只改實作)

做法:改實作 → 跑 T5 相關的全部測試檔(1120 條) → 記紅 → `git checkout` 還原。表中「紅的測試」是實際變紅的測試名(節錄)。

| 突變 | 做法 | 結果 | 紅的測試 |
|---|---|---|---|
| MC1 | 拿掉身分比對(標記不符仍放行) | 紅 | 標記不符 → exit 2,不是 0; 標記不符時真呼叫拒絕,exit 2 …(共 5 條) |
| MC2 | 指標檔不存在時退回(合成的)預設位置 | 紅 | 沒有指標:unresolved,原因含 init 與 show;不建任何檔; 沒有指標、也沒有 --log → exit 2,stderr 含 init 與 show,stdout 一個字都沒有 …(共 9 條) |
| MC3a | 沒有帳本把手時 readDailySpend 回 0 | 紅 | cloud-only 任務:沒有帳本時第一次就丟 MissingLedgerError,雲端 0 次、閘道 0 次; gateway-fallback 任務:沒有帳本時同樣丟錯——不會因為「花費當 0」放行到雲端,也不會偷偷改走閘道 …(共 6 條) |
| MC3b | GatewayLlmRouter 沒有帳本時預設 spendReader 回 0 | 紅 | cloud-only 任務:沒有帳本時第一次就丟 MissingLedgerError,雲端 0 次、閘道 0 次; gateway-fallback 任務:沒有帳本時同樣丟錯——不會因為「花費當 0」放行到雲端,也不會偷偷改走閘道 …(共 5 條) |
| MC4 | init 不加 --force 就覆寫指向別處的指標 | 紅 | must_catch: init 不加 --force 就覆寫指向別處的指標 —— 拒絕,不改任何檔,exit 非 0,…; 指標與標記的 id 不符 → 拒絕,只印兩邊各自的前 8 碼(不印整個 uuid),要 --force …(共 9 條) |
| MC5 | 標記只比前綴(前 8 碼相同就放行) | 紅 | must_catch: 標記只比前綴不得放行; 標記只有前 8 碼相同也是標記不符 |
| MC6 | learning_dir 是相對路徑也放行 | 紅 | 指標裡的 learning_dir 是相對路徑(就算從 cwd 解析剛好是同一處)→ 不算「已初始化」,要 --forc…; JSON 壞、不是物件、欄位缺、型別錯、learning_dir 相對,全部是讀不到 …(共 4 條) |
| MC7 | 鎖路徑退回每個 clone 一把 | 紅 | XDG_RUNTIME_DIR 設了就用機器範圍路徑; XDG_RUNTIME_DIR 未設或空字串 → ~/.cache/llm-learning-cards/stryker… …(共 9 條) |
| MC8 | 實作無視注入的 env/homedir,寫到 $HOME/.config(用拋棄式 HOME 跑,不碰真的) | 紅 | 指標與標記相符:resolved,量的是那本的 state/log.jsonl; (驗證過的帳本)log 存在、今天 0 次呼叫 → exit 0,而且看得出「有 log、今天沒花」 …(共 57 條) |
| MC9a | 真呼叫 router 選項放寬成收 ExplicitLedger(tsc) | 紅 | packages/core/src/llm/router-gateway.ts(177,31): error TS2345: Argument of type 'LiveGatewayRouterOptions' is  |
| MC9b | VerifiedLedger 建構子改公開(tsc) | 紅 | packages/core/src/llm/vault-pointer.test.ts(358,7): error TS2578: Unused '@ts-expect-error' directive. |
| MC10a | scripts/llm.ts 預設路徑走 ExplicitLedger | 紅 | must_catch: 正式程式的預設路徑走 ExplicitLedger —— 沒有明確參數時,llm.ts 的帳本是… |
| MC10b | llm-spend 預設路徑走 ExplicitLedger | 紅 | (驗證過的帳本)log 存在、今天 0 次呼叫 → exit 0,而且看得出「有 log、今天沒花」; (驗證過的帳本)--json 在算得出來時吐 day / usd / calls / entries_today / l… …(共 5 條) |
| MC10c | golden-run 的帳本跟著 learningDir | 紅 | 印出模型、token 進出,以及「未定價就不估,但每日上限仍然有效」的花費; 有結構性問題時逐項列出,結尾那句說清楚那不代表品質不好 …(共 3 條) |

十條全部變紅。MC9a 與 MC9b 是 tsc 紅,不是 vitest 紅:這兩條證明了 worker 報告 §3 第 3 點——只跑 vitest 會漏。

## 4. 自選突變(工單沒列;要求 ≥ 3,實際 83 條)

來源:`S` 系列是第一批自己設計的 20 條;`G` 是 Stryker 之前存活的非等價突變;`H` 是診斷訊息與輸出形狀;`D`、`V` 是 CLI 入口與只有子程序測試看得到的程式;`N` 是第一輪沒有任何突變殺得掉的測試;`E` 是鎖目錄權限;`P` 是 parsePointer 的說明;`U` 是 ExplicitLedger 使用處的清單。

| 突變 | 做法 | 結果 | 紅的測試(一條) |
|---|---|---|---|
| D1 | fail() 的 stdout 不是空的 | 紅 | 拒絕時 stdout 是空的、stderr 剛好以一個換行結尾 …(共 3 條) |
| D2 | fail() 的結尾換行判斷用 startsWith | **存活(等價,見 §6)** |  |
| D3 | 已初始化訊息少結尾換行 | 紅 | 「已初始化」的整段輸出與 stderr |
| D4 | 舊指標原文補換行判斷用 startsWith | 紅 | --force 的輸出:先印舊指標原文(結尾沒換行就補一個,有換行不重複),再說已覆寫 |
| D5 | --force 覆寫訊息少結尾換行 | 紅 | --force 的輸出:先印舊指標原文(結尾沒換行就補一個,有換行不重複),再說已覆寫 |
| D6 | import 時就跑 main | 紅 | 被別的模組 import 時不會自己跑 main(沒有輸出、退出碼 0) |
| D7 | 指標檔讀不到的訊息被清空 | 紅 | 指標檔存在但讀的時候丟錯:pointer-unreadable,訊息帶出路徑與底層錯誤 |
| D8 | 解析時不先判斷標記是否存在 | 紅 | pointer-missing / pointer-unreadable / learning-dir-missing … |
| D9 | argValue index<=0 | **存活(等價,見 §6)** |  |
| D10 | argValue 取前一個 | 紅 | init → show 相符;再 init 一次是「已初始化」;沒有暫存檔殘留 …(共 5 條) |
| D11 | argValue 用 endsWith 判旗標 | 紅 | init 沒給 --learning-dir 或值是另一個旗標:退出非 0,什麼都不建 |
| D12 | main 不 slice argv | 紅 | init → show 相符;再 init 一次是「已初始化」;沒有暫存檔殘留 …(共 5 條) |
| D13 | init 判斷永遠成立(不認得的子指令也跑 init) | 紅 | 沒有子指令與不認得的子指令都印用法、退出 1 |
| D14 | --force 旗標字串寫錯 | 紅 | init A;init B 不加 --force 退出非 0 且指標沒變;加 --force 退出 0、指標改指 B、先… |
| D15 | main 的 catch 訊息被清空 | 紅 | init 途中丟出意外錯誤(設定目錄唯讀):退出 1,stderr 以「vault.ts 失敗」開頭,不留殘檔 |
| D16 | show 子指令判斷永遠不成立 | 紅 | init → show 相符;再 init 一次是「已初始化」;沒有暫存檔殘留 |
| D17 | stderr 永遠不寫 | 紅 | init A;init B 不加 --force 退出非 0 且指標沒變;加 --force 退出 0、指標改指 B、先… …(共 5 條) |
| E1 | ensureLockDir 對已存在的目錄也 chmod 0700 | 紅 | 目錄本來就在:不改它的權限(0750 還是 0750),也不丟錯 …(共 4 條) |
| G1 | samePlace 永遠 true | 紅 | 指標指向 A,B 的標記剛好是同一個 id(複製來的):init B 不算「已初始化」,不加 --force 拒絕,加了… |
| G1b | samePlace 不比 learning_dir | 紅 | 指標指向 A,B 的標記剛好是同一個 id(複製來的):init B 不算「已初始化」,不加 --force 拒絕,加了… |
| G2 | UUID_RE 拿掉開頭錨 | 紅 | 標記或指標的 id 前面或後面多了東西,即使裡面藏著一個合法 uuid,也不算合法 |
| G2b | UUID_RE 拿掉結尾錨 | 紅 | parseMarker 只回合法 uuid …(共 2 條) |
| H1 | show 的 lines 用 join("") 接起來 | 紅 | 沒有指標 …(共 6 條) |
| H2 | show 不檢查 learning_dir 是否存在 | 紅 | learning_dir 不存在 |
| H3 | show 無指標時 marker 欄位字串被清空 | 紅 | 沒有指標 |
| H4 | show 無指標時沒有錯誤說明 | 紅 | 沒有指標 |
| H5 | resolver pointer-missing 訊息不帶路徑 | 紅 | pointer-missing / pointer-unreadable / learning-dir-missing … |
| H6 | resolver learning-dir-missing 訊息不帶路徑 | 紅 | pointer-missing / pointer-unreadable / learning-dir-missing … |
| H7 | resolver 標記不符訊息不帶路徑 | 紅 | pointer-missing / pointer-unreadable / learning-dir-missing … |
| H8 | parsePointer JSON 壞的說明被清空 | 紅 | pointer-missing / pointer-unreadable / learning-dir-missing … …(共 2 條) |
| H9 | init 沒給 learning-dir 的訊息不說「(沒給)」 | 紅 | --learning-dir 沒給或是相對路徑:訊息帶出收到的值與用法 …(共 2 條) |
| H10 | init 全新成功沒有輸出說明 | 紅 | 全新與沿用既有標記,輸出各自說明是哪一種;stderr 是空的 …(共 2 條) |
| H11 | init 指標指向這裡但標記不存在:訊息被清空 | 紅 | 指標指向這裡,但標記檔不存在:不加 --force 拒絕(說出標記與指標 id 的前 8 碼),加了才重建標記 |
| N1 | XDG 沒設時 ~/.config 寫成 ~/.cfg | 紅 | XDG_CONFIG_HOME 空字串視同未設 …(共 2 條) |
| N2 | parsePointer 對調 learning_dir 與 vault_id | 紅 | 合法內容回 learning_dir 與 vault_id …(共 10 條) |
| N3 | VerifiedLedger 多一個公開 static 工廠 | 紅 | 類別上沒有任何公開的 static 工廠:mint / of / from 之類都不存在 |
| N4 | ExplicitLedger 建構子改公開(tsc) | 紅 | packages/core/src/llm/vault-pointer.test.ts(372,7): error TS2578: Unused '@ts-expect-error' directive. |
| N5 | realVaultIo 的寫入改成非原子 writeFileSync | 紅 | vault.ts 用的寫入器就是 schema 的 writeFileAtomic(寫暫存檔、fsync、rename) |
| N6 | init 對壞標記不拒絕 | 紅 | 標記檔內容不是合法 uuid → 拒絕,不寫指標(帳本身分壞了,要人看) |
| N7 | show 無指標時 exit 0 | 紅 | 指標不存在 / 讀不到:exit 非 0 …(共 3 條) |
| N8 | show 偷偷寫檔 | 紅 | 指標不存在 / 讀不到:exit 非 0 …(共 4 條) |
| N9 | llm.ts 用法錯誤退出碼 1→2 | 紅 | 用法錯(缺 --prompt、不認得的 task)exit 1,不解析帳本 |
| N10 | llm.ts --probe 也解析指標 | 紅 | --probe 不解析指標(不花錢、不判斷花費,不在契約 §12 範圍) |
| N11 | llm.ts 假模式也先解析指標 | 紅 | 假 adapter 模式 --log 可用,得到 ExplicitLedger;指標檔是壞的也通過,而且根本沒讀它 …(共 3 條) |
| N12 | llm.ts --fake --probe 變成真 probe | 紅 | --fake --log --probe:假 probe,不解析指標 |
| N13 | llm.ts --fake 不給 --log 不拒絕 | 紅 | --fake 沒給 --log 就拒絕(exit 2):假呼叫不寫進指標指向的真帳本,也不偷偷變成真呼叫 |
| N14 | 假 adapter 回覆不再是 [fake] | 紅 | 雲端任務與閘道任務都回假結果,事件寫進 --log 那本 |
| N15 | 假 router 的事件寫去別的帳本 | 紅 | 雲端任務與閘道任務都回假結果,事件寫進 --log 那本 …(共 2 條) |
| N16 | llm-spend 未驗證帳本的退出碼不再固定 2 | 紅 | exitCodeFor:未驗證的帳本一律 2——它不能被當成煞車的依據(未達、已達上限都一樣) …(共 5 條) |
| N17 | llm-spend 報告永遠標 verified | 紅 | buildSpendReport 標出把手的種類:ExplicitLedger → unverified …(共 5 條) |
| N18 | llm-spend --json 的 ledger 欄位永遠 verified | 紅 | 明講 --log 的 --json:ledger 是 unverified,exit 2 |
| N19 | llm-spend 明講 --log 時先去探測指標檔 | 紅 | 使用者明講 --log 時得到 ExplicitLedger,連指標檔都不探測 |
| P1 | parsePointer 的 learning_dir 相對路徑說明被清空 | 紅 | parsePointer 的「讀不到」各有自己的說明,不是同一句空話 |
| P2 | parsePointer 缺欄位說明被清空 | 紅 | parsePointer 的「讀不到」各有自己的說明,不是同一句空話 |
| S1 | 自選 1: 標記容許多個結尾換行 | 紅 | 逐字相等,容許且只容許一個結尾換行 …(共 2 條) |
| S2 | 自選 2: uuid 大寫也算合法 | 紅 | 不分大小寫不得放行;uuid 格式不合也算不符(兩邊同為大寫也一樣:大寫不是本系統寫出的格式) |
| S3 | 自選 3: XDG_CONFIG_HOME 空字串視為已設 | 紅 | XDG_CONFIG_HOME 空字串視同未設 |
| S4 | 自選 4: readDailySpend 讀檔的非 ENOENT 錯誤也回 0 | 紅 | 帳本檔存在但讀不出來(是目錄)= 不知道,丟錯,不回 0 |
| S5 | 自選 5: 無視 XDG_CONFIG_HOME(永遠 ~/.config) | 紅 | 指標與標記相符:resolved,量的是那本的 state/log.jsonl …(共 57 條) |
| S6 | 自選 6: 鎖目錄權限 0755 | 紅 | 目錄不存在就建,權限 0700 |
| S7 | 自選 7: XDG_RUNTIME_DIR 空字串視為已設 | 紅 | XDG_RUNTIME_DIR 未設或空字串 → ~/.cache/llm-learning-cards/stryker… |
| S8 | 自選 8: 鎖目錄建不出來時吞掉錯誤繼續跑 | 紅 | 建不出來就丟錯,不是安靜繼續 …(共 6 條) |
| S9 | 自選 9: show 在標記不符時 exit 0 | 紅 | 標記不符:exit 非 0,match: no …(共 2 條) |
| S10 | 自選 10: init 不檢查 learning-dir 是否存在 | 紅 | --learning-dir 是相對路徑或不存在 → 拒絕,不建任何東西 |
| S11 | 自選 11: init --force 不印舊指標內容 | 紅 | 指標指向別處 + --force → 覆寫指標,而且先印出舊指標內容(第 5 條) …(共 4 條) |
| S12 | 自選 12: 真呼叫模式 scripts/llm.ts 接受 --log | 紅 | 真呼叫模式給 --log 就拒絕,exit 2,訊息說帳本位置只能由指標檔決定;連指標都不看 …(共 3 條) |
| S13 | 自選 13: llm-spend 未驗證帳本不標 ledger=unverified | 紅 | 未驗證的帳本:第一行恰好是 ledger=unverified;驗證過的沒有這一行 …(共 3 條) |
| S14 | 自選 14: check-ledger-pollution 解析失敗回 PASS 而不是 UNKNOWN | 紅 | unresolved → UNKNOWN(不是 PASS、不是 FAIL),測試照跑,退出碼是測試的 …(共 2 條) |
| S15 | 自選 15: createDefaultLiveRouter 拒絕訊息不帶 init/show | 紅 | must_catch: 指標檔不存在時退回 git-common-dir —— createDefaultLiveRou… …(共 3 條) |
| S16 | 自選 16: init 的 id 不符訊息印出完整 uuid | 紅 | 指標與標記的 id 不符 → 拒絕,只印兩邊各自的前 8 碼(不印整個 uuid),要 --force …(共 2 條) |
| S17 | 自選 17: router 建構不再先建 state/ 目錄 | 紅 | 合成主簽出、worktree、clone 的假呼叫事件都進同一本,不是 clone 各記各的 |
| S18 | 自選 18: 解析時不檢查 learning_dir 是否存在 | 紅 | learning_dir 不存在必須拒絕 …(共 2 條) |
| S19 | 自選 19: 解析時標記檔不存在也放行 | 紅 | 標記檔不存在也算標記不符 …(共 2 條) |
| S20 | 自選 20: parsePointer 不檢查欄位型別 | 紅 | JSON 壞、不是物件、欄位缺、型別錯、learning_dir 相對,全部是讀不到 …(共 3 條) |
| U1 | router-impl.ts 多一處 ExplicitLedger.unverified( | 紅 | 非測試的正式程式裡,呼叫 ExplicitLedger.unverified( 的檔案恰好是核可的兩個 |
| V1 | vault.ts main 守門永遠不跑(if false) | 紅 | init → show 相符;再 init 一次是「已初始化」;沒有暫存檔殘留 …(共 7 條) |
| V2 | vault.ts main 守門永遠跑(if true) | 紅 | 被別的模組 import 時不會自己跑 main(沒有輸出、退出碼 0) |
| V3 | realVaultIo.mkdir 變空函式 | 紅 | init → show 相符;再 init 一次是「已初始化」;沒有暫存檔殘留 …(共 3 條) |
| V4 | vault.ts main:init 與 show 子指令對調判斷(show 永遠走 show) | 紅 | init → show 相符;再 init 一次是「已初始化」;沒有暫存檔殘留 …(共 6 條) |
| V5 | vault.ts argValue 永遠回 undefined(--learning-dir 讀不到) | 紅 | init → show 相符;再 init 一次是「已初始化」;沒有暫存檔殘留 …(共 4 條) |
| V6 | main 不傳 --force | 紅 | init A;init B 不加 --force 退出非 0 且指標沒變;加 --force 退出 0、指標改指 B、先… |
| V7 | vault.ts main:stdout 不寫出 | 紅 | init → show 相符;再 init 一次是「已初始化」;沒有暫存檔殘留 …(共 3 條) |
| V8 | vault.ts main:exitCode 不設 | 紅 | 沒有指標時 show 非 0;不認得的子指令非 0 …(共 6 條) |

**存活 2 條,皆為等價**(§6):D2(`fail()` 的結尾換行判斷)、D9(`argValue` 的 `index <= 0`)。

## 5. Stryker(工單第 21 條,標準 80%)

指令:`npm run mutate -- --mutate <檔>`,`MUTATE_TEST_GLOB` 指到相關測試,perTest 覆蓋,`VITEST_MAX_WORKERS=1`,concurrency 4。load:1–2。

| 檔 | 補測前 | 補測後 | 存活(補測後) | 無覆蓋 | 耗時 |
|---|---|---|---|---|---|
| `packages/core/src/llm/ledger.ts` | 總分 66.67,covered 75.00(18 存活) | **總分 86.42,covered 95.89**(70 殺、3 存活) | 3 條,皆等價 | 8 條(`realVaultIo.mkdir`,見下) | 2 分 38 秒 |
| `scripts/vault.ts` | 總分 47.50,covered 60.80(49 存活) | **總分 76.88,covered 94.62**(123 殺、7 存活) | 7 條,見 §6 | 30 條(`main`/`argValue`) | 3 分 06 秒 |
| `scripts/mutate.ts` 第 160–192 行(`strykerLockPath`、`ensureLockDir`) | 93.75(15 殺、1 存活) | 93.75 | 1 條,等價 | 0 | 46 秒 |

**`scripts/vault.ts` 的總分 76.88 低於 80,原因是 Stryker 的 perTest 覆蓋看不到子程序**:`main`、`argValue` 與 `realVaultIo.mkdir` 只有 CLI 子程序測試會跑到,Stryker 記成「無覆蓋」,沒有執行。我手動對這些突變逐條跑過(§4 的 V1–V8、D1–D17、V3 為 `realVaultIo.mkdir`),**全部變紅**(D2、D9 是等價)。把這些算進去,有效分數在 95% 以上。我把這個落差寫在這裡,不拿手動結果取代 Stryker 的數字。

## 6. 存活突變逐條分類(沒有「等價」帶過而沒有論證的)

| 位置 | 突變 | 判定 | 論證 |
|---|---|---|---|
| `ledger.ts` 的 `#verified`、`#explicit`(2 條) | `true`→`false` | 等價 | 私有欄位只給型別系統當名義型別的錨,執行期從不讀;型別行為由 MC9b、N4(tsc)守 |
| `ledger.ts` 的 `vaultIdsEqual` | `markerId !== undefined &&` 拿掉 | 等價 | `markerId` 是 undefined 時 `undefined === pointerId` 對字串型別的 `pointerId` 永遠為假 |
| `vault.ts` 的 `fail()` | `endsWith('\n')`→`startsWith('\n')` | 等價 | 現有的所有失敗訊息都不以換行開頭也不以換行結尾,兩個判斷都落到「補一個換行」;D2 實測存活 |
| `vault.ts` 開頭檢查的 `given === ''` | 條件拿掉或換字串 | 等價 | 空字串本來就過不了 `!isAbsolute(given)`,走同一個分支、同一則訊息 |
| `vault.ts` 的「已初始化」判斷 | `markerId !== undefined` 拿掉 | 等價 | 同 `vaultIdsEqual`:`undefined === old.vaultId` 為假 |
| `vault.ts` 的 `argValue` | `index <= 0` | 等價 | `argv[0]` 是子指令,旗標不可能出現在 0;D9 實測存活 |
| `vault.ts` 檔尾的入口守門(3 條) | `if (true)`、`if (false)`、`!==` | **非等價,但由子程序測試殺掉** | V1(`if (false)`)紅 7 條、D6(`if (true)`:被 import 就跑 main)紅 1 條(補測),`!==` 是 V1 的反面。Stryker 把這行記成存活是子程序盲區 |
| `mutate.ts` 的 `ensureLockDir` | `if (created !== undefined)` 拿掉 | 等價(實務上) | `mkdir` 的 mode 會被 umask 吃掉位元但不會多出位元,所以新建的目錄本來就是 0700;`chmodSync` 只在 umask 吃掉擁有者位元的病態情況才有差。E1(對已存在的目錄也 chmod)則有補測守住 |

## 7. 使用者資料、真指標檔、鎖目錄

- **`learning/` 前後**:前 `files=167 hash=196ae19b043f3cd2 ledger=52`(10:03:48),後 `files=167 hash=196ae19b043f3cd2 ledger=52`(11:39:01)。三項前後相同,只讀,算法同 T3 報告,只記數字。本檔不含 `learning/` 的任何檔名或內容。
- **真指標檔**:前後都不存在(不只 `ls`,連 `~/.config/llm-learning-cards` 目錄都沒有被建出來)。MC8 用拋棄式 `HOME` 跑(不是真的 HOME);S5 無視 `XDG_CONFIG_HOME` 的突變在**真 HOME 下**跑,測試全程在 mkdtemp 的沙箱裡,沒有任何東西漏到真的位置。
- **守門測試真的會紅(工單第 15 條,worker 報告 §3 第 6 點)**:用真 HOME 跑了一次,守門看的是真位置;另外做「洩漏注入」演練——以 `NODE_OPTIONS` 預載一個在 1200 毫秒後於 `$HOME/.config/llm-learning-cards/` 建出 `vault.json` 的腳本(`HOME` 指到拋棄式目錄),跑 `scripts/vault.test.ts`:`afterAll` 的守門與「show 沒有指標時非 0」都紅(`expected { exists: true, … } to deeply equal { exists: false, mtimeMs: null }`);對照(不洩漏)全綠;洩漏設在 2000 毫秒(測試已跑完)則綠。
- **`/run/user/1000/llm-learning-cards/`**:目錄 mtime 08:58 → 10:59。這是我自己跑 `npm run mutate`(Stryker)時,新的機器範圍鎖在這個目錄裡建立又放掉造成的——**預期行為,不是洩漏**;目錄裡沒有殘留的鎖檔。這同時是 T5 鎖路徑在真環境運作的實證。

## 8. 測試作者檢查與正式收下

`git diff --name-only 67e2ad7 45f1478` 中的測試檔(`*.test.ts`、`features/steps/**`)共 17 個。作者:`1d6e5d0`(grok worker 被中斷時由協調者保存的 WIP)、`a6e59e4`(grok 的紅測試)、`619a18b`、`408f701`、`b434a76`、`7dfdb1c`(Claude worker 在「只改實作」指示送達前寫的)。**全部來自開發 worker,沒有一個來自測試 agent**——依顧問裁決正式收下,不重做。

收下的方式:每個測試至少要有一個突變會讓它變紅;沒有的列出來並說明。下面是**新增或改過的測試**逐條(來源:97 個突變的實際紅燈;覆蓋 5 個核心檔 91 條與 7 個既有檔的新增測試)。

### 8.1 核心新檔(逐條)

「證明有效的突變」欄是實際讓這條測試變紅的突變編號(見 §3、§4)。型別層級的測試由 tsc 驗,不是 vitest 的紅。

#### `packages/core/src/llm/vault-pointer.test.ts`(38 條)

| # | 測試 | 證明有效的突變 |
|---|---|---|
| 1 | 指標檔位置(第 1 條) > XDG_CONFIG_HOME 優先於 ~/.config | MC8,S5 |
| 2 | 指標檔位置(第 1 條) > XDG_CONFIG_HOME 空字串視同未設 | N1,S3 |
| 3 | 指標檔位置(第 1 條) > 沒設 XDG_CONFIG_HOME 時用 homedir()/.config,而且是呼叫端注入的 homedir | N1 |
| 4 | 標記比對(第 2 條) > 逐字相等,容許且只容許一個結尾換行 | S1 |
| 5 | 標記比對(第 2 條) > must_catch: 標記只比前綴不得放行 | MC5 |
| 6 | 標記比對(第 2 條) > 不分大小寫不得放行;uuid 格式不合也算不符(兩邊同為大寫也一樣:大寫不是本系統寫出的格式) | S2 |
| 7 | 標記比對(第 2 條) > parseMarker 只回合法 uuid | G2b,S1 |
| 8 | parsePointer(第 1 條、第 6 條的「讀不到」) > 合法內容回 learning_dir 與 vault_id | N2 |
| 9 | parsePointer(第 1 條、第 6 條的「讀不到」) > JSON 壞、不是物件、欄位缺、型別錯、learning_dir 相對,全部是讀不到 | MC6,S20 |
| 10 | 解析器的四種拒絕(第 6 條) > must_catch: 指標檔不存在必須拒絕且不退回 git | MC2 |
| 11 | 解析器的四種拒絕(第 6 條) > 指標檔讀不到(JSON 壞)必須拒絕 | MC8,S5 |
| 12 | 解析器的四種拒絕(第 6 條) > 指標檔存在但讀取丟錯(例如權限)也算讀不到,不是丟例外 | MC8,S5 |
| 13 | 解析器的四種拒絕(第 6 條) > 欄位缺或型別錯算讀不到 | MC8,S20,S5 |
| 14 | 解析器的四種拒絕(第 6 條) > must_catch: learning_dir 是相對路徑必須拒絕(就算從 cwd 解析得到一個帶合法標記的目錄) | MC6,MC8,S5 |
| 15 | 解析器的四種拒絕(第 6 條) > learning_dir 不存在必須拒絕 | MC8,S18,S5 |
| 16 | 解析器的四種拒絕(第 6 條) > must_catch: 標記不符必須拒絕 | MC1,MC8,N2,S5 |
| 17 | 解析器的四種拒絕(第 6 條) > 標記檔不存在也算標記不符 | MC8,N2,S19,S5 |
| 18 | 解析器的四種拒絕(第 6 條) > 標記只有前 8 碼相同也是標記不符 | MC1,MC5,MC8,N2,S5 |
| 19 | 解析器的四種拒絕(第 6 條) > 相符時回 VerifiedLedger,log 在該 learning 的 state/log.jsonl | MC8,N2,S5 |
| 20 | 解析器的四種拒絕(第 6 條) > 解析器只讀指標與標記兩個檔,不建任何東西 | MC8,N2,S5 |
| 21 | VerifiedLedger 只能由指標解析器產生(第 8 條) > 類別上沒有任何公開的 static 工廠:mint / of / from 之類都不存在 | N3 |
| 22 | VerifiedLedger 只能由指標解析器產生(第 8 條) > 型別上建構子是私有的,字面值也冒充不了 | MC9b、N4(tsc 的 TS2578) |
| 23 | VerifiedLedger 只能由指標解析器產生(第 8 條) > ExplicitLedger 也只能經 ExplicitLedger.unverified 產生(grep 找得到每一個… | N4(tsc) |
| 24 | must_catch: 沒有帳本把手時 readDailySpend 不回 0(第 4、8 條) > 沒給把手就丟 MissingLedgerError,不是 { usd: 0 } | MC3a |
| 25 | must_catch: 沒有帳本把手時 readDailySpend 不回 0(第 4、8 條) > GatewayLlmRouter 沒有帳本、也沒注入 spendReader:查花費丟錯… | MC3a,MC3b |
| 26 | must_catch: 沒有帳本把手時 readDailySpend 不回 0(第 4、8 條) > GatewayLlmRouter 沒有帳本時 call() 在打任何 adapter 之… | MC3a,MC3b |
| 27 | must_catch: 沒有帳本把手時 readDailySpend 不回 0(第 4、8 條) > 兩種把手的檔案不存在 = 0(全新安裝),不是丟錯 | MC8,N2,S5 |
| 28 | must_catch: 沒有帳本把手時 readDailySpend 不回 0(第 4、8 條) > 帳本檔存在但讀不出來(是目錄)= 不知道,丟錯,不回 0 | S4 |
| 29 | must_catch: 真呼叫的 router 收了 ExplicitLedger(第 8 條,型別測試由 tsc 驗) > ExplicitLedger 不能傳給 createLiveGa… | MC9a(tsc 的 TS2345) |
| 30 | must_catch: 真呼叫的 router 收了 ExplicitLedger(第 8 條,型別測試由 tsc 驗) > 假的 adapter 的 router(每個 provider … | MC8,N2,S5 |
| 31 | 原子寫入接線(第 3 條) > vault.ts 用的寫入器就是 schema 的 writeFileAtomic(寫暫存檔、fsync、rename) | N5 |
| 32 | must_catch: 測試讀到或改到真的指標檔(第 15 條) > 這個檔案跑到這裡,真指標檔的存在與否與 mtime 不變(只 stat;afterAll 再驗一次) | 洩漏注入演練(§7) |
| 33 | 驗收補測(T5 測試 agent):uuid 的開頭與結尾都要錨定 > 標記或指標的 id 前面或後面多了東西,即使裡面藏著一個合法 uuid,也不算合法 | G2,G2b |
| 34 | 驗收補測(T5 測試 agent):拒絕訊息要指出是哪個檔、哪個目錄 > pointer-missing / pointer-unreadable / learning-dir-missin… | D8,H5,H6,H7,H8,MC1,MC2,MC8,N2,S18,S19,S5 |
| 35 | 驗收補測(T5 測試 agent):拒絕訊息要指出是哪個檔、哪個目錄 > parsePointer 的「讀不到」各有自己的說明,不是同一句空話 | H8,MC6,P1,P2,S20 |
| 36 | 驗收補測(T5 測試 agent):讀檔丟錯時的拒絕說明 > 指標檔存在但讀的時候丟錯:pointer-unreadable,訊息帶出路徑與底層錯誤 | D7,MC8,S5 |
| 37 | 驗收補測(T5 測試 agent):讀檔丟錯時的拒絕說明 > 標記檔存在但讀的時候丟錯:marker-mismatch,訊息說「讀不到」並帶出底層錯誤 | MC8,N2,S5 |
| 38 | 驗收補測(T5 測試 agent):ExplicitLedger.unverified 只准出現在核可的兩個入口 > 非測試的正式程式裡,呼叫 ExplicitLedger.unverifi… | U1 |

#### `scripts/vault.test.ts`(38 條)

| # | 測試 | 證明有效的突變 |
|---|---|---|
| 1 | vault init(第 4 條的表,每列一個測試) > 全新:無指標、learning 無標記 → 產生 uuid,寫標記與指標,exit 0 | MC8,S5 |
| 2 | vault init(第 4 條的表,每列一個測試) > 全新且不注入 randomUUID:寫出的是合法的小寫 uuid,兩份檔相同 | MC8,S5 |
| 3 | vault init(第 4 條的表,每列一個測試) > learning 已有標記、無指標 → 沿用標記的 uuid 寫指標(不重新產生,標記不動) | MC8,S5 |
| 4 | vault init(第 4 條的表,每列一個測試) > 指標已存在、指向同一個 learning_dir 且 id 相符 → 不改任何檔,exit 0,印「已初始化」 | MC8,S5 |
| 5 | vault init(第 4 條的表,每列一個測試) > must_catch: init 不加 --force 就覆寫指向別處的指標 —— 拒絕,不改任何檔,exit 非 0,訊息說要 -… | MC4,MC8,S5 |
| 6 | vault init(第 4 條的表,每列一個測試) > 指標指向別處 + --force → 覆寫指標,而且先印出舊指標內容(第 5 條) | MC8,S11,S5 |
| 7 | vault init(第 4 條的表,每列一個測試) > --learning-dir 是相對路徑或不存在 → 拒絕,不建任何東西 | S10 |
| 8 | vault init(第 4 條的表,每列一個測試) > 指標與標記的 id 不符 → 拒絕,只印兩邊各自的前 8 碼(不印整個 uuid),要 --force | MC4,MC8,S16,S5 |
| 9 | vault init(第 4 條的表,每列一個測試) > id 不符 + --force → 指標改成標記的 id(標記是帳本本身的身分,不動),並先印舊指標 | MC8,S11,S5 |
| 10 | vault init(第 4 條的表,每列一個測試) > 指標檔壞掉(不是 JSON)→ 拒絕,訊息說指標讀不到、要 --force,不誤報成 id 不符 | MC4,MC8,S5 |
| 11 | vault init(第 4 條的表,每列一個測試) > 指標裡的 learning_dir 是相對路徑(就算從 cwd 解析剛好是同一處)→ 不算「已初始化」,要 --force | MC4,MC6,MC8,S5 |
| 12 | vault init(第 4 條的表,每列一個測試) > 標記檔內容不是合法 uuid → 拒絕,不寫指標(帳本身分壞了,要人看) | N6 |
| 13 | vault show(第 4 條) > 相符時印出指標位置、learning_dir、標記存在、相符,exit 0 | MC8,S5 |
| 14 | vault show(第 4 條) > 標記不符:exit 非 0,match: no | MC8,S5,S9 |
| 15 | vault show(第 4 條) > 標記不存在:exit 非 0,marker: missing | MC8,S5 |
| 16 | vault show(第 4 條) > 指標不存在 / 讀不到:exit 非 0 | N7,N8 |
| 17 | vault show(第 4 條) > show 不寫任何東西 | N8 |
| 18 | CLI(子程序,HOME / XDG 在沙箱) > init → show 相符;再 init 一次是「已初始化」;沒有暫存檔殘留 | D10,D12,D16,MC8,N8,S5,V1,V3,V4,V5,V7 |
| 19 | CLI(子程序,HOME / XDG 在沙箱) > 沒有指標時 show 非 0;不認得的子指令非 0 | N7,V1,V8 |
| 20 | 驗收補測(T5 測試 agent):init 的覆寫判定 > 指標指向 A,B 的標記剛好是同一個 id(複製來的):init B 不算「已初始化」,不加 --force 拒絕,加了才改指向… | G1,G1b,MC4,MC8,S5 |
| 21 | 驗收補測(T5 測試 agent):init 的覆寫判定 > 指標指向這裡,但標記檔不存在:不加 --force 拒絕(說出標記與指標 id 的前 8 碼),加了才重建標記 | H11,MC4,MC8,S16,S5 |
| 22 | 驗收補測(T5 測試 agent):init 的覆寫判定 > --learning-dir 沒給或是相對路徑:訊息帶出收到的值與用法 | H9 |
| 23 | 驗收補測(T5 測試 agent):init 的覆寫判定 > 全新與沿用既有標記,輸出各自說明是哪一種;stderr 是空的 | H10 |
| 24 | 驗收補測(T5 測試 agent):show 的每一種狀態,逐行與錯誤說明 > 沒有指標 | H1,H3,H4,MC8,N7,N8,S5 |
| 25 | 驗收補測(T5 測試 agent):show 的每一種狀態,逐行與錯誤說明 > 指標壞掉 | H1,MC8,S5 |
| 26 | 驗收補測(T5 測試 agent):show 的每一種狀態,逐行與錯誤說明 > learning_dir 不存在 | H1,H2,MC8,S5 |
| 27 | 驗收補測(T5 測試 agent):show 的每一種狀態,逐行與錯誤說明 > 標記不存在 | H1,MC8,S5 |
| 28 | 驗收補測(T5 測試 agent):show 的每一種狀態,逐行與錯誤說明 > 標記不符 | H1,MC8,S5,S9 |
| 29 | 驗收補測(T5 測試 agent):show 的每一種狀態,逐行與錯誤說明 > 相符:四行、exit 0、stderr 空 | H1,MC8,S5 |
| 30 | 驗收補測(T5 測試 agent):CLI 把 --force 與路徑接到 init > init A;init B 不加 --force 退出非 0 且指標沒變;加 --force 退出 … | D10,D12,D14,D17,MC4,MC8,S11,S5,V1,V3,V4,V5,V6,V7,V8 |
| 31 | 驗收補測(T5 測試 agent):CLI 把 --force 與路徑接到 init > init 沒給 --learning-dir 或值是另一個旗標:退出非 0,什麼都不建 | D10,D11,D12,D17,H9,V1,V4,V8 |
| 32 | 驗收補測(T5 測試 agent):輸出的精確形狀 > 拒絕時 stdout 是空的、stderr 剛好以一個換行結尾 | D1,MC4 |
| 33 | 驗收補測(T5 測試 agent):輸出的精確形狀 > 「已初始化」的整段輸出與 stderr | D3,MC8,S5 |
| 34 | 驗收補測(T5 測試 agent):輸出的精確形狀 > --force 的輸出:先印舊指標原文(結尾沒換行就補一個,有換行不重複),再說已覆寫 | D4,D5,MC8,S11,S5 |
| 35 | 驗收補測(T5 測試 agent):CLI 入口層 > 被別的模組 import 時不會自己跑 main(沒有輸出、退出碼 0) | D6,V2 |
| 36 | 驗收補測(T5 測試 agent):CLI 入口層 > 沒有子指令與不認得的子指令都印用法、退出 1 | D1,D13,D17,V1,V4,V8 |
| 37 | 驗收補測(T5 測試 agent):CLI 入口層 > init 途中丟出意外錯誤(設定目錄唯讀):退出 1,stderr 以「vault.ts 失敗」開頭,不留殘檔 | D10,D12,D15,D17,MC8,S5,V1,V4,V5,V8 |
| 38 | 驗收補測(T5 測試 agent):CLI 入口層 > init 的 stdout 與 stderr 由結果決定:成功時 stdout 有字 stderr 空;拒絕時 stderr 有字 s… | D1,D10,D12,D17,H10,MC4,V1,V3,V4,V5,V7,V8 |

#### `scripts/machine-lock.test.ts`(13 條)

| # | 測試 | 證明有效的突變 |
|---|---|---|
| 1 | strykerLockPath(第 11、12 條) > XDG_RUNTIME_DIR 設了就用機器範圍路徑 | MC7 |
| 2 | strykerLockPath(第 11、12 條) > XDG_RUNTIME_DIR 未設或空字串 → ~/.cache/llm-learning-cards/stryker.lock(… | MC7,S7 |
| 3 | strykerLockPath(第 11、12 條) > 只看注入的 env:process.env 與 cwd 不同也不影響 | MC7 |
| 4 | ensureLockDir(第 11 條) > 目錄不存在就建,權限 0700 | S6 |
| 5 | ensureLockDir(第 11 條) > XDG_RUNTIME_DIR 沒設時連 ~/.cache 一起建出來 | MC7 |
| 6 | ensureLockDir(第 11 條) > 建不出來就丟錯,不是安靜繼續 | S8 |
| 7 | ensureLockDir(第 11 條) > 目錄本來就在:不改它的權限(0750 還是 0750),也不丟錯 | E1 |
| 8 | ensureLockDir(第 11 條) > 目錄在、但寫不進去也丟錯 | E1,S8 |
| 9 | 鎖目錄建不出來 / 寫不進去 = 拒絕開始跑(第 11 條) > runMutate:建不出來時回 1,Stryker 一次都沒跑 | S8 |
| 10 | 鎖目錄建不出來 / 寫不進去 = 拒絕開始跑(第 11 條) > runTests(全套):建不出來時回 1,vitest 一次都沒跑 | S8 |
| 11 | 鎖目錄建不出來 / 寫不進去 = 拒絕開始跑(第 11 條) > runMutate:寫不進去時回 1,Stryker 一次都沒跑 | E1,S8 |
| 12 | 鎖目錄建不出來 / 寫不進去 = 拒絕開始跑(第 11 條) > runTests(全套):寫不進去時回 1,vitest 一次都沒跑 | E1,S8 |
| 13 | must_catch: 鎖路徑退回每個 clone 一把(第 14 條) > 合成主簽出持鎖時,worktree 與另一個 clone 起的程序都看得到同一把鎖 | MC7 |

#### `packages/core/src/llm/vault-reject.live.test.ts`(1 條)

| # | 測試 | 證明有效的突變 |
|---|---|---|
| 1 | T5:沒有指標時真呼叫拒絕且不建檔(第 17 條) > must_catch: 指標檔不存在時退回 git-common-dir —— createDefaultLiveRouter 與 s… | MC2,S15 |

#### `packages/core/src/llm/vault-clone-ledger.characterization.test.ts`(1 條)

| # | 測試 | 證明有效的突變 |
|---|---|---|
| 1 | T5:三個簽出寫進指標指向的同一本帳本(第 16 條) > 合成主簽出、worktree、clone 的假呼叫事件都進同一本,不是 clone 各記各的 | MC8,S17,S5 |

**91 條裡沒有任何突變殺得掉、也沒有替代證明的:0 條。** 先前 4 條無突變的測試,3 條是型別層級(tsc 紅,見括號),1 條是真指標檔守門(洩漏注入演練,§7)。

### 8.2 既有檔裡新增或改過的測試

| 檔 | 新增/改動 | 證明有效 |
|---|---|---|
| `packages/core/src/llm/router-gateway.test.ts` | 3 條改寫(沒有帳本時丟 `MissingLedgerError`,取代舊的「沒 log 當 0」);其餘 112 條沒動 | MC3a、MC3b 紅 |
| `packages/core/src/llm/spend.test.ts` | 4 行機械式改動(`readDailySpend` 改收帳本把手) | 型別層級:tsc 會擋回裸字串;沒有專屬突變 |
| `scripts/llm.test.ts`(14 條,全新) | `planLlmRun` 的每條規則 | 第一輪 7 條有突變殺;其餘 7 條由 N9–N15 殺(用法錯誤碼、probe 不解析、假模式不讀指標、`--fake` 要有 `--log`、假結果、事件寫進 `--log`) |
| `scripts/llm-spend.test.ts`(15 條新增、7 條改寫) | 驗證/未驗證的報告、退出碼、`ledger=unverified` | 10 條由 MC/S 殺,其餘由 N16–N19 殺;被改寫的 7 條舊測試逐條有「(驗證過的帳本)」版本,內容與邊界(剛好等於上限、log 不存在 vs 空檔)未退步 |
| `packages/core/src/prompt-quality/live-run.test.ts`(4 條新增、1 條改寫) | 預設 router 的帳本、`learningDir` 只管輸出 | MC10c、MC2、S15、MC8 |
| `packages/core/src/prompt-quality/cli.test.ts`(1 條) | 沒有指標時 `--live` 不跑 | MC2、S15 |
| `scripts/check-ledger-pollution.test.ts`(4 條) | unresolved → UNKNOWN | S14、MC2、MC8 |
| `scripts/mutate.test.ts`(2 條新增、5 條舊的移除) | 鎖路徑不看 git/cwd | MC7;被移除的 5 條是「同一個 git 的 worktree 算出同一把鎖」這類舊行為,由 `machine-lock.test.ts` 的三簽出對照取代(驗收條件 14) |
| `scripts/run-tests.test.ts`(29 行、0 條新增) | 沙箱化 `HOME`/`XDG_RUNTIME_DIR`、`LOCK_FILENAME` 改名 | MC7 紅 |
| `scripts/degraded-report.test.ts` | 1 個標題 | 標題的「(30/30)」已改成不帶數字(T5 之後是 28 個訊號);見 §9 |
| `features/steps/llm-router.steps.ts` | 假閘道場景改用 `ExplicitLedger.unverified` | cucumber 全 feature 與 base 逐數相同;使用處由補測三的清單釘住 |
| 被刪的 `packages/core/src/llm/vault.test.ts`(6 條) | 對應的舊 `vault.ts` 一併刪除 | 舊行為由 `vault-pointer.test.ts` 的四種拒絕與 `vault-clone-ledger.characterization.test.ts`(改成新行為的證明)取代 |

## 9. 我補的測試與修的東西(測試 agent 的 commit)

分支 `pollux0971/t5-accept-tests`,從 `45f1478` 開;**只改測試檔(與一個證據檔),沒碰實作**。

| commit | 檔案 | 補了什麼 | 為什麼 |
|---|---|---|---|
| 驗收補測 | `packages/core/src/llm/vault-pointer.test.ts` | uuid 開頭與結尾錨定、各拒絕訊息帶出檔案路徑、`parsePointer` 說明各異 | Stryker 存活:拿掉 `^` 錨,`junk+uuid` 也被當成合法 |
| 驗收補測 | `scripts/vault.test.ts` | `init` 覆寫判定(B 的標記 id 與 A 的指標相同時仍要拒絕)、標記缺失、show 六種狀態逐行、CLI `--force` 接線 | `samePlace` 永遠為真的突變存活;`main` 不傳 `--force` 的突變存活 |
| 驗收補測 | `scripts/machine-lock.test.ts` | 既有目錄的權限不被改(worker 報告 §3 第 7 點) | 該缺口 |
| 驗收補測 | `scripts/degraded-report.test.ts` | 標題拿掉「(30/30)」 | worker 報告 §3 第 1 點 |
| 補測二 | `scripts/vault.test.ts`、`vault-pointer.test.ts` | 輸出的精確形狀、CLI 入口層(import 不跑 main、意外錯誤的訊息)、讀檔丟錯的說明 | Stryker 存活 |
| 補測三 | `packages/core/src/llm/vault-pointer.test.ts` | `ExplicitLedger.unverified(` 只准出現在 `scripts/llm.ts` 與 `scripts/llm-spend.ts` | F-B:型別分不出 adapter 真假;證明:在 `router-impl.ts` 多加一處,該測試紅(U1) |

worker 報告 §3 的 7 條待辦,逐條處理:1 標題→已改;2 `builtin-asset.test.ts` 的 lc-fs→批次 G 的 `build-lc-fs` helper 已處理;3 型別測試要跑 tsc→已跑(MC9a、MC9b、N4 都是 tsc 紅);4 probe 的 CLI 層→cucumber 單跑該 scenario 綠;5 `live-run.test.ts` 的 must_catch 10 只驗零參數→它抓不到「帳本跟著 learningDir」,但下一條(`learningDir` 只管輸出)會抓,MC10c 實測紅;「預設路徑走 ExplicitLedger」在執行期無法區分(`LlmRouterImpl` 只收 `logPath`),所以改由靜態清單守;6 真指標檔守門→真 HOME 跑過 + 洩漏注入演練;7 既有目錄權限→已補測。

## 10. 對抗式審核(流程第 4 步)

模型 `xai/grok-4.20-0309-reasoning`,經 `opencode run`,工作目錄是我的暫存區(**不是 repo**;但暫存區裡有我先前的突變腳本與結果檔,它讀到了——沒有機密與使用者資料,下次改用空目錄)。prompt 約 66 KB(工單裁決與驗收條件、`ledger.ts` 全文、`readDailySpend`、router 選項型別、`scripts/vault.ts` 全文、`planLlmRun`、`resolveSpendLedger`、`createDefaultLiveRouter`、鎖路徑、`vault-pointer.test.ts` 全文)。耗時 1 分 53 秒。結論「有阻擋項」。逐條我自己重驗:

| grok 主張 | 我的重現 | 判定 |
|---|---|---|
| 1 高:壞行被跳過,花費被低估,煞車放行 | 建一個兩行(各 1M tokens)的帳本:`{usd:5,calls:2}`;把第二行弄壞:`{usd:2.5,calls:1}`。base 67e2ad7 的 `spend.ts` 同樣有 `bad-line-skipped`,所以**不是 T5 引入** | **成立**(F-A)。T5 範圍外,但方向是錢;`llm-spend` 的路徑是「壞行=算不出來」,router 的路徑不是 |
| 2 高:驗證與使用之間 TOCTOU | 設計如此:`resolveVerifiedLedger` 只在建構時跑一次,`logPath` 烤進物件。race 沒有穩定重現 | 設計限制(F-C),未重現 |
| 3 高:壞標記 + `--force` 不符工單表 | 讀程式:標記內容不是合法 uuid 時一律 `fail`,不進 `--force` 路徑;已有測試鎖住這個行為(「標記檔內容不是合法 uuid → 拒絕,不寫指標」)。工單的表沒有「標記格式壞」這一列,只有「id 不符」 | 設計選擇,有測試(D1),請顧問確認要不要允許 `--force` 重建 |
| 4 中:`show` 的拒絕訊息缺 init/show 兩字串 | 工單第 6 條要求兩字串的是**解析器**的四種拒絕(`reject()` 加上了);`show` 本身的 stderr 另有說明,而且它就是 show。已補測 `show` 六種狀態的逐行輸出與說明 | 不成立(不是規格要求);補測已鎖 |
| 5 高:多個 must_catch 可被錯誤實作滿足(舉的例子是我的突變檔) | 它舉的突變 S4、MC3、MC10 等**在我這邊每一條都是紅**(§3、§4) | 不成立 |
| 6 中:symlink、並行 init 沒測 | 屬實:沒有這類測試 | 成立,未補(F-C) |

另外自己找到:**F-B**(型別洞,已補靜態清單)。

## 11. 花費(流程第 6 步)

| 項目 | 數字 |
|---|---|
| worker 實際花費(協調者提供) | Claude Opus 5.5,58 分鐘,狀態列 $22.894(Max 訂閱等值,不是現金);額度 5h 6%→10%、7d 6%→7%。前一個 grok 4.7 worker $25.39(被中斷) |
| 工單預算 | $6 |
| 比值 | **$22.894 / $6 = 3.8 倍,超過 2 倍**,標出 |
| 驗收這張的 LLM 花費 | **不知道**:`opencode run` 不顯示金額。用量:grok-4.20 一次呼叫、prompt 約 66 KB、1 分 53 秒;沒打 OpenAI |
| 驗收 CPU | 97 個突變(其中 34 個跑兩遍);Stryker 3 個檔共約 6 分半;`witness:degraded` 一次約 6 分 20 秒;cucumber 兩次;合併樹檢查一次。load 觀察 0.9–5.9,沒有與別人的重活撞到 |

## 12. 未做 / 限制

- 沒跑 `check:all`(協調者併批時跑)。
- 沒有 symlink、並行 `init` 的測試(F-C)。
- `witness:degraded` 的 +1 沒追到是哪一條新增測試(base 的報告檔已隨驗收簽出刪掉);全套 3239 條仍全綠。
- 第一輪的 34 個突變我跑了兩遍(第二遍是為了收完整的紅測試名),結果一致。
- 沒有對真的 `learning/` 跑 `vault.ts init`(工單第 19、20 條:那是協調者合併後做的事)。
