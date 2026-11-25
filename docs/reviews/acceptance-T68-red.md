# 驗收 T68 紅測試(07 phase-6「問 AI」核心與側車)

- 被驗分支:`t68-red` = 985f3cf56afdbefbcf425f0257ba1b78dfc0a51c(1 個 commit,基底 main d7866ec,27 檔 +2577/−36)
- 驗收簽出(i9):從該 sha 開 detached;開跑與跑完的 tree sha 都是 30dab804fa8c8c6178454ae467a1d5a0edda31d5;沒有 `.env`
- 日期:2026-11-25;驗收角色(acceptance line);i9 空 HOME、`VITEST_MAX_WORKERS=1`
- 結論:**通過**,沒有阻擋項;三個小缺口(見「缺口」)建議測試 agent 低優先補

## 1. 測試作者檢查

27 個檔全在同一個 commit(測試 agent 的)。產品程式、`.feature`、`contracts/` 都是 0 行(`git diff --name-only` 逐檔看過,沒有非測試檔)。沒有「測試作者違規」。

## 2. 基底上真的紅(不是只在原始碼找字串)

基底 = t68-red 本身(沒有實作)。守門:`tsc --noEmit` 乾淨、`npm run boundaries` PASS、`npm run check:steps` PASS(57 個 feature、1401 個定義、每種句型恰好 1 個)。

受影響的 vitest(session、llm、teach、prompt-quality、features/support/t68、scripts/llm):**71 檔、15 檔紅、197 條失敗、1704 條通過**。197 與作者說的一致。

失敗原因逐類看過,全是「功能還沒有」,沒有測試自己寫壞:

| 原因(訊息原文節錄) | 條數 |
|---|---|
| `unknown-method`「不認識這個動作」(teach.ask 協定沒有) | 約 15 |
| `Cannot find module …/teach/ask.ts` | 7 檔 |
| `client.teachAsk is not a function`、`client.teachAskPoll is not a function` | 4 |
| 登記表沒有 teach.ask、`teach/ask.md` 不存在、`fixtures/golden-ask/inputs.json` 不存在 | 約 15 |
| 路由 / token / 備援表沒有 teach.ask(`expected undefined to be 'deepen'` 等) | 約 15 |
| 等條件逾時、`teach.ask 的 router 呼叫沒有在 8 秒內到達`(背景那條,等不到) | 3 |
| 其餘(handler 與側車場景)同樣停在 unknown-method 之後的斷言 | 其餘 |

分檔紅條數:handler 72、ask 57、protocol 16、registry-t68 10、sidecar 9、router-gateway 7、client 5、fallback 4、fixtures 4、registry 3、cli 3、routing 3、token-limits 2、t63 1、registry-t65 1。

基底上本來就綠的 t68 條數(12 條:handler 4、sidecar 1、registry-t68 7):是「守住不退步」「量尺自測」「六個回應檔 sha 釘」「帳本壞行回 error」「沒有目前卡時問回 error」。後兩條在基底綠,是因為 unknown-method 本身就是 `ok:false`;它們的作用是擋「壞帳本當 0 繼續花」「沒卡還去叫模型」(丟棄式實作上、改壞版都轉紅,見第 6 節)。可以收。

cucumber `@teach-card and @phase-6 and not @manual`:基底 12 個場景全敗、53 步裡 12 敗(都停在 teach.ask 回 unknown-method)、13 undefined、10 skipped。

## 3. 丟棄式實作(證明可以轉綠;不進 git)

我另開一個 worktree 寫(子代理寫、我驗,不 commit),產品檔約 15 個。結果:

- 同一批 vitest:**71 檔、1903 條全綠**(基底 197 紅)。
- tsc、boundaries(415 檔)、check:steps 都 PASS。
- cucumber 同一組 tag:12 場景(2 過、10 undefined)、53 步(35 過、13 undefined、5 skipped、**0 敗**)。13 條 undefined 剛好是 T69 的畫面句子。
- 實作與 `.feature` 的 `@phase-6` 以外沒有互相打到:`@test-card and @phase-2` 9/9(作者的同批證據,我未重跑)。

## 4. 既有測試的改動(第 2 項)

逐行讀過 diff。全部是照契約 1.6.0 把 7 個 LlmTask 擴成 8 個,或把清單加一個元素:

- token-limits:7→8、表加 `teach.ask: 1536`、多一條釘 1536 且小於 deepen。更嚴。
- routing:11 組→14 組(teach.ask 三列,與 deepen 同列)、NO_MODEL 訊息點名、`ROUTING_TABLE['teach.ask']` 等於 deepen 的值。更嚴。
- fallback、router-gateway:把 teach.ask 加進同組清單,多一條「雲端失敗 → 閘道且標暫定」。更嚴。
- t63-golden-cap:7→8 個、全 cloud-only。同一強度。
- registry:契約清單、掃到的 prompt 檔、登記表、輸入數 `teach.ask: 6` 都加一項。只有一處**排除**:「五組吃 raw」那條把 teach.ask 排除。理由成立(它的輸入是自擬的,不來自 raw),而且另有 registry-t68 逐組檢查沒有 raw/learning 路徑。不算放寬。
- registry-t65:原本斷言 reteach.short 緊貼 selftest,現在改成「teach.ask 緊貼 reteach.short、reteach.short 在 selftest 前兩格」。位置仍然釘死。
- cli:27→33 個輸入、八→九組、各行號 +1。
- protocol:14→16 個方法、加向量自測與 params 嚴格性。
- test-card-phase2-sidecar 步驟:鍵清單加兩個方法、teachAsk 只收 1 個參數、teachAskPoll 0 個;「不收路徑與卡 id」多三列。更嚴。
- teach-card.steps:共用句多一個分派到 phase6。不改既有分支行為。

沒有任何一處斷言變鬆。

## 5. `--fake` 的六個回應檔與 sha 釘(第 3 項)

- 六個檔都在、各一筆、`task` 是 teach.ask、`prompt_contains` 是 `golden: ask-<key>`、`attempt` 1;回應文字是合法三欄 JSON。
- 六個 sha256 在基底就全綠(釘的值與檔案一致),另有一條檢查「每個檔三欄、suggestion 三選一、追問至多 3 個」。
- 我另量長度:answer 8–40 字、追問 0–2 個且每個 ≤ 8 字,都遠小於提示的 200/30 上限。
- 觀察(不算缺口):六個回應裡 suggestion 是 continue 五個、back 一個,沒有 deepen。`--fake` 只驗跑得起來,不影響評分。
- `--golden --set teach.ask --fake` 在丟棄式實作上退出碼 0、處理 6 個輸入。
- contracts 的 `fixtures/llm/teach.ask.<情境>.json` 由實作者新增(測試要求至少 4 個、一檔一筆),本批 `contracts/` 是 0 行,符合。

## 6. T68 與 T69 的句子分法(第 4 項)

`check:steps` PASS:1401 個定義、每種句型恰好 1 個,T68 步驟檔沒有重複定義任何 T69 的畫面句子。cucumber 在實作上 13 條 undefined 就是 commit 說明列的那 13 句。分派用 `phase6Active`,T69 照用即可。

## 7. 自選改壞(第 5 項;不在作者 35 個清單上)

在丟棄式實作上一次改一處,跑 `features/support/t68`、`teach`、`session` 三組(577 條,基準全綠)。還原後兩個被改檔的 md5 與改前一致。

| 編號 | 改了什麼 | 結果 | 紅的訊息 / 說明 |
|---|---|---|---|
| Y1 | 看不懂的那一輪也記進討論 | **紅** | 「失敗的那一輪不留在討論裡:壞回答之後再問,提示不帶那個壞回答的字」 |
| Y5 | back 但沒有未學先備時 highlight 變 next | **紅** | 「back + 先備都學過 → highlight 是 null(不亮任何東西),建議仍是 back」 |
| Y10 | 前幾輪只帶問題、不帶回答 | **紅**(2 條) | 「第二輪的提示帶第一輪的問題與回答」、「提示最多帶 4 輪…」 |
| Y2 | 呼叫中 router 丟 BUDGET_EXCEEDED 改回 failed | **存活** | 缺口 G2 |
| Y4 | 沒有帳本檔時當作壞帳本 | **存活** | 缺口 G3 |
| Y7 | 提示不帶卡的標題 | **存活** | 缺口 G1 |
| Y8 | 提示不帶卡的 example | **存活** | 缺口 G1 |
| Y3 | poll 讀走結果後就清掉(只能讀一次) | 存活 | 工單沒規定能不能重複 poll,不算缺口(未規定) |
| Y6 | 換卡動作「失敗」時也重設討論 | 存活 | 工單沒規定,不算缺口(未規定) |
| Y9 / Y12 | 提示的最深一層記號、level 行消失 | 存活 | 丟棄式實作自己的措辭,規格沒要求 |
| Y11 | 缺金鑰照問 | 存活 | 丟棄式實作自己的依賴,規格沒要求 |

12 個:3 紅、9 存活;其中 3 項(Y2、Y4、Y7+Y8)是規格有寫、測試沒釘的真缺口,其餘 5 項規格沒寫,不算。

誠實記錄:第一輪改壞跑的時候,有另一個腳本(寫丟棄式實作的子代理)同時在改同一批檔,結果被污染,我整批作廢;停掉後確認兩檔 md5 還原,才重跑,上表是重跑的結果。

作者的 35 個改壞我**沒有重跑**,沿用作者的證據(35 紅、0 存活);這份驗收只獨立確認「基底紅、可轉綠、既有測試沒放寬、自選 12 個」。

## 8. 缺口(都小、不擋,建議測試 agent 補)

- **G1**:工單第 2 點說提示輸入有卡的「標題、body、example」。作者的提示測試釘了問題、內文、未學先備,沒有釘標題與 example。補:提示含卡標題、含 example。(Y7、Y8)
- **G2**:呼叫進行中 router 丟 BUDGET_EXCEEDED(呼叫前的檢查過了、呼叫中才超)要回 `budget`,不是 `failed`。現有測試只釘呼叫前擋。補一條 router 丟 BUDGET_EXCEEDED → `error: 'budget'`。(Y2)
- **G3**:全新的 learning(還沒有 log.jsonl)第一次問也要能問成,不能當壞帳本。現有帳本測試都有檔。補一條沒有帳本檔 → 照常呼叫。(Y4)

## 9. 真 learning/ 前後(只讀;只記數字)

| 項目 | 前 | 後 |
|---|---|---|
| 檔數 / 整體雜湊 / 帳本行數 | 64 / 3f944d2429767455 / 118 | 64 / 3f944d2429767455 / 118 |
| 筆電 `~/.cache/llm-learning-cards` 頂層數 | 498 | 498 |

說明:作者 commit 說明裡的雜湊是 60755f0d6d0bc3c9,與我量到的不同;檔數與行數相同。我這次整個驗收期間前後一致。這個目錄會因為使用者的人工試用(I4 第 1 天)變動,與我無關;我沒寫過它。`~/.cache` 的 498 比我前一輪的 497 多一個,同理不是我的(我在筆電只做 git 與讀檔)。

## 10. 花費與清理

- LLM 呼叫 0;沒有 live。`--fake` 與假 router 而已。
- 子代理(丟棄式實作)用量:約 24 萬 token;預算欄是工單的 4 美元(那是 worker 的實作預算,不是驗收預算);比值不適用,寫「不知道」。
- 清理:i9 的驗收簽出、暫存 HOME、暫存分支與筆電驗收簽出收尾時移除;證據分支 `t68-red-accept-tests` 保留。
