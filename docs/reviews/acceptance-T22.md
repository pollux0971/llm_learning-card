# 驗收證據:T22(複習側車底層,ADR-075)

- 工單:T22。被驗分支:t22-opencode,tip f79f29b(實作 49a5348 + 報告 f79f29b),起點 719ba75(main 4e29373 + T22 紅測試 acd95d6)。
- 驗收用 worktree:乾淨簽出自 f79f29b,沒有 .env(`ls .env` 找不到),自己的 node_modules 與 target 複本。
- 開跑 tree sha:090ed7d6176d1c4baca649f6fdd8c5ecb9731570(f79f29b 的 tree)。
- 日期:2026-10-17。結論在最後一節。

## 測試作者檢查

worker 兩個 commit(49a5348、f79f29b)對測試檔、向量檔、harness、fixtures、golden 的變動 = 0(`git diff --name-only 719ba75..f79f29b` 逐一比對,只有實作檔、scripts 設定與報告)。測試全部來自紅測試作者(acd95d6);本次補測是驗收角色加的,見後面。mutants.out 在歷史裡 = 0。

## 基準(未突變)

| 項目 | 結果 |
|---|---|
| tsc --noEmit | 0 錯 |
| npm run boundaries | PASS(scanned 319) |
| 受保護 vitest(session、scripts/review、apps/desktop/src) | 38 檔 676/676 綠 |
| cargo test review_sidecar | 32/32 |
| cargo test window_mode / commands / logging | 38/38、24/24、4/4 |
| 真 cucumber `@review-cli and not @manual` | 32 場景 / 188 步全過 |
| 真 cucumber `@i2 and not @manual` | 93 場景 / 464 步全過 |
| cucumber `@test-card and @phase-2 and not @manual` | 9 場景,38 步中 36 undefined、2 skipped:這批步驟是 T24 要寫的,不是 T22 的紅,也不算 T22 通過的證據 |

重編:Rust 用 worker 已編好的 target 複本,cucumber 前 lc-fs 重編 0.14 秒(已是最新)。

## 驗收點逐條(工單 §4–§6、§9 與顧問三個條件)

1. 協定五個 method、嚴格 schema、訊息不帶路徑與 id、未知 method 拒絕、壞行與超長行回 bad-request 或 too-large 且側車活著:通過(改壞 T01、T02、T05 見下表紅)。
2. 編排只有一份:scripts/review.ts 的 readSessionCache 剩 2 處、buildTodaySession 剩 1 處(--dry-run);其餘沒有。通過。
3. handler 回傳不含換行、stdout 只有協定行、engine / handler / protocol 沒有 process.exit 與 stdout 寫入(grep 與測試都過;改壞 T06、T08 紅)。通過。
4. routerFactory 失敗可重試、不快取失敗、不留半個 session:既有測試涵蓋;另補「帶 kind 的普通物件」分類。通過。
5. review-record-changed 逐字 T26 全文並丟掉 session:訊息與 T26 工單逐字相同;改壞 T11 紅。通過。
6. Rust:env_clear 白名單、一次一個請求 busy 馬上回、id 遞增、逾時與結束 kill + wait 並下次重起、shutdown 先等再 kill、RunEvent::Exit 與 .manage:通過。**缺口一個已補**:關 app 的接線(RunEvent::Exit 呼叫 SidecarHost 的 shutdown)沒有任何測試,改壞 T21 存活;補了靜態測試後紅。
7. 既有 review.test、review-session.test、review-router.test 在 review.ts 重構後仍綠(沒有放寬):是,676 條全綠。
8. cucumber:`@review-cli`、`@i2` 真跑全過;06 phase-2 側車場景的步驟尚未實作(T24),T22 範圍內沒有可跑的。
9. 變異:見下兩節。
10. boundaries.owners.json:工單說只加 review-sidecar.ts 與 review-sidecar-stdio.ts 兩條。worker 多加了第三條 review-sidecar-stdio.js。**我實測拿掉第三條,boundaries FAIL**(import 寫 .js,解析時保留副檔名,找不到落點),所以必要;工單的描述不完整,不算違規。allow.json 只加一條 10-desktop-shell → 11-review-cli,工單列的例外。

## Stryker(engine.ts、handler.ts、protocol.ts)

預設設定(覆蓋分析 perTest)量出 engine / handler / protocol 是 0%:這三個模組的測試用「算出來的 file URL 動態載入」,Stryker 看不到覆蓋,是量法失真,不是沒有測試。改用 command runner、覆蓋分析關閉、只跑相關 4 個測試檔(排除一條讀原始碼比對 import 的靜態測試,因為它會讀到 Stryker 插樁後的檔)。527 個變異。

| 時點 | engine | handler | protocol | 合計 | 存活 |
|---|---|---|---|---|---|
| 補測前 | 86.92% | 78.09% | 85.21% | 82.16% | 94 |
| 補測後 | 92.52% | 88.45% | 92.31% | 90.51% | 50 |

補測前 94 個存活,逐個判:真缺口全部補了測試(protocol-acceptance.test.ts 11 條、review-handler-acceptance.test.ts 10 條,後者的位置登記在 owners)。補的內容:上限剛好與多一個位元組(含結尾換行不算進大小)、id 下限 1、hello 的 today 前後多字元、hello 與 response 壞 JSON / 太長剛好回 { ok: false }、暫停日 start 的 resumed 與不叫 routerFactory、重教卡在身時 state 是 ready、answered 只算今天、fill 送到應用題回 no-question、帶 kind 的普通物件、submit / next / summary 的 internal 例外只回固定句子、snapshot commit 訊息用今天的日期、commit 被擋時 hint 是「snapshot 失敗:」開頭。

補測後剩 50 個,逐個判為等價(外面看不出差別),理由分類:
- dry-run 與暫停日用的拒絕 router(engine 與 handler 各一份)的建構、錯誤字串、物件內容:這個 router 在這兩條路徑上從不被呼叫,改壞看不到。
- isRecord 與 readableId 的各種條件變體:非物件進來時 `.id` 或 `.kind` 讀成 undefined 或丟 TypeError,後者被外層 catch 接成同一個 bad-request(id null)或 internal,對外輸出相同。
- startFailureKind 的 instanceof 與 isRecord 分支:換一條路徑得到同一個 kind。
- JSON.stringify 會丟掉 undefined,所以 newStage 與 answeredThisRun 的「有定義才設」條件反轉,輸出相同。
- 不可達的防禦:最外層 catch、switch 的 default(schema 已擋)、`session` 與 `cache` 永遠一起設一起清所以 `!session || !cache` 換成 `&&` 相同、snapshot 在 hint 缺的分支(非 committed 的每個狀態都帶 hint)、protocol 內層 JSON.parse 的 catch 清空後後面仍會得到同一個 bad-request。
- 初始值被 start 覆蓋的 resumed;Linux 上沒有反斜線的路徑換行字元;空群組的空字串後備;`session.current` 在 present 之後必定存在。
- 一個要說明的:engine 第 109 行 `if (true)` 在 Stryker 第三輪仍列存活,但我用手工同樣的改法跑新的 handler 補測,**紅**(實際收到 1 行 warning,預期 0)。Stryker 與手工結果不一致,原因我沒有查出來,這一個列為「未解釋」。

## cargo-mutants(review_sidecar.rs,`--in-place`,單一變異體一次)

預設設定會把整個 desktop crate 的 377 個變異都掃一遍,所以另用只列 review_sidecar.rs 的設定,71 個變異。第一次:49 caught / 13 missed / 9 unviable(79.0%)。13 個存活逐個判:
- 缺口,補了測試(tests/review_sidecar_acceptance.rs):request_line 與 parse_response_line 的 `>` 換成 `>=`(剛好上限的一行要接受),is_hello 換成 true(只有一行合法協定行但不是 hello 時,要等不到 hello)。三個都改為 caught。
- 等價 6 個:read_limited 與 discard_rest 裡 ErrorKind::Interrupted 的 match guard(pipe 上無法注入 EINTR)。
- 等價 3 個:discard_rest 的換成空函式、兩個 `==` 換成 `!=`:超長的一行會讓 host 直接 kill 側車,之後不會再讀,所以排空剩下的內容看不到差別。
- 缺口,沒有補 1 個:forward_stderr 換成空函式。側車的 stderr 只轉成 host 的 eprintln,工單沒有定義這個行為的對外約定,測試也沒法在行程內攔 stderr;記在這裡,不算阻擋。

補測後(52 caught / 10 missed 等價或無對外約定):83.9%。

## 自選改壞(21 個,只改實作)

| 編號 | 改法 | 結果 |
|---|---|---|
| T01 | submit 的 params 不嚴格 | 紅(protocol.test:夾帶 card 與 apply+fill 同時) |
| T02 | 空 params 不嚴格 | 紅(夾帶 path、側車壞行測試) |
| T03 | hello 的 fakeCloud 永遠 false | 紅(review-sidecar.test 啟動與 hello) |
| T04 | 不印「正在用假 router」 | 紅 |
| T05 | 不檢查 root-mismatch | 紅(指標檔指向別處) |
| T06 | 回應不加換行 | 紅(14 條) |
| T07 | LC_REVIEW_TODAY 不驗結尾 | 紅(bad-today) |
| T08 | console.log 不導到 stderr | 紅(stdout 只有協定行) |
| T09 | keepOnError 不生效 | 紅(6 條) |
| T10 | next 不看磁碟上的暫停 | 紅 |
| T11 | 紀錄被改過後不丟掉 session | 紅(2 條) |
| T12 | 沒答題也 snapshot | 紅(2 條) |
| T13 | reteach 退回原卡時 short 仍 true | 紅 |
| T14 | 填空陣列被逗號切開 | 紅 |
| T15 | 答錯填空不帶 correctAnswers | 紅(2 條) |
| T16 | 答對也帶 correctAnswers | 紅(2 條) |
| T17 | submit 的 internal 回應帶例外原文與金鑰樣子的字串 | **原測試存活**(一次連續跑「答了題」那條 snapshot 測試曾失敗一次,三次重跑都綠,未重現,當作偶發);補 expectFixedInternal 後紅 |
| T18 | Rust 子行程不 env_clear | 紅(the_child_environment_is_exactly_what_the_spec_says) |
| T19 | Rust id 檢查 `<=` 換成 `<` | 紅(request_ids_must_increase_and_a_refused_one_is_not_sent) |
| T20 | Rust 忙的時候排隊(try_lock 換成 lock) | 紅(rc 101,失敗名稱未另記) |
| T21 | 關 app 不關側車(main.rs) | **原測試存活**;補靜態測試後紅(rc 101) |

兩個存活(T17、T21)都是真缺口,補測後轉紅。

## grok 對抗式審核

這次沒有開(協調者沒要求,工單沒列)。

## learning/ 前後(只量數字)

| 時點 | 檔案數 | 雜湊前 16 碼 | 帳本行數 |
|---|---|---|---|
| 開始(08:14) | 64 | bc1699974215c435 | 102 |
| 結束(10:02) | 64 | c2e4dd6d71de3976 | 108 |

雜湊與行數改變,是協調者在同一段時間對主簽出跑 T18 的 children golden(真呼叫 6 次),在帳本尾端追加 6 行:`tail` 出來的新增行型別全是 llm_call(6 行),檔案數不變。不是驗收造成的(驗收從不寫真的 learning/)。

## 花費

worker 自報 $18.87,工單預算 $5,比值 3.8 倍(超過 2 倍,**標出**):超在側車、handler、engine、protocol 與 Rust 四塊一起做,又多輪修紅測試。grok 無限額,只記錄。驗收自己的 LLM 花費:0(沒打任何 provider)。

## 衝突檢查

驗收分支與 main 的 `git merge-tree --write-tree --name-only HEAD main`:見交件訊息(結果與 main 的 tip 有關,main 在驗收期間前進過)。

## 結論

通過。實作沒有擋住合併的問題;兩個測試缺口(關 app 接線沒測、submit 例外回應不檢查固定句子)與數個邊界缺口已補測試並用改壞證明轉紅。剩下的存活逐個判為等價,另一個(forward_stderr)沒有對外約定。
