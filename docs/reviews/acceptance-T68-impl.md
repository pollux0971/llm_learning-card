# 驗收 T68 實作(07 phase-6「問 AI」核心與側車)

- 被驗分支:`t68-impl` = 204c49a3986d3dd7334bb1448e3a614fce4c02d7(基底 `t68-start` = c7d85dca7344a2857267e9955a6ac7d41ab0f793,實作者的 6 個 commit,22 檔 +612/−6)
- 驗收簽出(i9,detached):開跑與跑完的 tree sha 都是 a3c9c6f6b3c7a952dfe5296841bc6843f52e9f0e;沒有 `.env`;空 HOME、`VITEST_MAX_WORKERS=1`
- 日期:2026-11-25;驗收角色(acceptance line)
- 結論:**通過,沒有阻擋項。** 第一輪變異 71.19%(ask 設定),補測後第二輪 84.44%(達 80%),見第 9 節;路由表變異 97.73%,過 95%。(第一輪的缺口 G1 到 G9 已由測試 agent 補上。)

## 1. 測試作者與範圍

- `git diff --name-only t68-start t68-impl`:22 檔,**測試檔、步驟檔、向量檔、`.feature`、`contracts/types.md` 一個都沒有**(逐檔看過)。受保護的路徑(教學卡畫面、ui-shared、決策表、state、config)0 個。
- 超出工單 touches 的檔只有一個:`docs/reviews/T68-implementation.md`(實作報告,可以)。
- 反向掃描(新增的行裡找寫檔與行程呼叫):`writeFile`、`rmSync`、`unlink`、`rename`、`appendFile`、`mkdir`、`openSync`、`fsync`、`createWriteStream`、`execSync`、`spawn`、`fetch(` 都是 0 命中。實作只在 `teach-ask.ts` 讀檔(`readFileSync` 讀提示模板與帳本),沒有寫。

## 2. 基準(實作上)

| 檢查 | 結果 |
|---|---|
| `tsc --noEmit` | 乾淨 |
| `npm run boundaries` | PASS |
| `npm run check:steps` | PASS(沒有重複定義) |
| 全部 vitest(整個專案) | **301 檔全過;7875 過、174 略過(共 8049)** |
| cucumber `@teach-card and @phase-6 and not @manual` | 12 場景:2 過、10 undefined、0 敗;53 步:35 過、13 undefined、5 skipped。undefined 的 13 句正是 T69 的畫面句子 |
| cucumber `@teach-card and not @manual`(phase-1 到 6) | 44 場景:34 過、10 undefined、0 敗 |
| cucumber `@test-card and not @manual`(06) | 25 場景:19 過、6 undefined、0 敗(基底 t68-start 是 17 過、**2 敗**、6 undefined;那 2 敗就是紅測試加的「ReviewClient 多兩個方法」句,實作後轉綠) |
| cucumber `@grading and not @manual`(05) | 38 場景:32 過、1 敗、5 undefined;**與基底 t68-start 完全相同**(05-grading phase-4 已知基線,不是這張造成的) |
| cucumber `@llm-router and not @manual`(03) | 52/52 過 |
| cucumber `@i4 and not @manual` | 38/38 過 |

## 3. 三件請我特別看的事

### (a) 日上限不走 ExplicitLedger.unverified,直接讀 state/log.jsonl:可以接受

- 路徑:`teach-ask.ts` 讀 `<learningDir>/state/log.jsonl` → `parseLedger` → `computeDailySpend` → `isBudgetExhausted`。`learningDir` 來自側車的 `--dir`,側車啟動時有跟指標檔解析出的帳本目錄比對(`root-mismatch` 檢查),不是任意路徑。
- 與 router 的規則一致:`spend.ts` 的檔頭自己寫「有把手、檔案不存在(ENOENT)= 全新安裝 = 0」「壞行 = 不知道,永遠不回數字」。實作的 ENOENT → 空、壞行與其他讀檔錯誤 → 不知道,同一套。壞行時 router 本身也會拒絕真呼叫,所以就算這層漏了也不會花錢。
- 與紅測試的差別:壞行/讀不到時回 `error: 'budget'`,但訊息換成「今天的花費算不出來(帳本有問題)…」(不是「額度用完」)。紅測試只要求「是 error、不呼叫、不是 0」,所以過。我認為這個選擇合理(對使用者說實話)。
- 守門測試(`vault-pointer.test` 禁新增 `ExplicitLedger.unverified` 的呼叫點)全專案 vitest 綠,表示沒有違反。

### (b) 上次留的 G1 / G2 / G3 實作有照做

我另寫三條丟棄式測試(不進 git,用 t68 自己的 harness)在實作上跑:G1 提示含卡標題、G2 呼叫中 router 丟 BUDGET_EXCEEDED → `error: 'budget'`、G3 刪掉 log.jsonl 後第一次問成功且 router 被呼叫 1 次。**3/3 過**(實作的行為是對的)。例子(example)那一半我是讀程式確認:`buildAskPrompt` 對每個 example 加一行。

但**測試還沒有釘**:自選改壞 K8(提示拿掉標題)、K9(拿掉 example)、C12(BUDGET_EXCEEDED 改回 failed)、C15(沒帳本檔當壞)全部存活。這四條要測試 agent 補。

### (c) 空白問題與無目前卡回 bad-request(實作者加的、測試沒釘)

- 無目前卡:改壞 C6(無卡時不拒絕)**紅**,有被釘。但釘得鬆:測試接受「bad-request 或任何 ask.error」,所以 Stryker 把這個判斷改成 false 也沒紅(程式走到後面丟例外,被當成失敗)。
- 空白問題:H8(拿掉空白檢查)**存活**,沒有測試釘。行為本身合理(空白問題不該花一次 AI 呼叫)。建議補一條「問題只有空白 → bad-request、router 呼叫 0」,或明講不要這條規則。

## 4. must_catch 逐條改壞(實作上,一次一處;跑 teach、session、llm、golden-sets 與三個 t68 檔,共 1439 條)

基準全綠。每個改壞跑完還原;結束後 `git status` 乾淨。

| must_catch(工單) | 我的改壞 | 結果 |
|---|---|---|
| ask 跑著時換卡動作要照常並丟掉 ask(六個動作各一) | H1 open、H2 next、H3 switch、H4 prereq、H5 deepen、H6 back 各漏一個丟棄 | 6 個都**紅**(失敗 2、3、1、1、1、1 條) |
| 晚到的回答不進新卡的紀錄、poll 不回 | C1 丟棄時不標 cancelled;C3 呼叫回來後不檢查 cancelled | 都**紅**(各 1 條) |
| 同上 | C2 結果不檢查 job | 存活——**等價改壞**:呼叫回來後已經有 cancelled 檢查,這一道是第二道保險,拿掉一道行為不變 |
| deepen 跑著時 ask 回 bad-request | C4 拿掉 deepen 檢查 | **紅** |
| 一次只能一個 ask | C5 拿掉已有 ask 的檢查 | **紅**(2 條) |
| teach.ask 同步等回答 | H7 teach.ask 回的不是 asking:true | **紅**(68 條) |
| 側車收別的參數(strict) | L4 params 改成非 strict | **紅**(5 條) |
| 問的是別張卡 / 換卡後前輪被送給 AI | C8 拿掉「卡不同就清」的比對 | **紅** |
| 同上(invalidate 清 history 那行) | C7 | 沒套用(字串對不上);再看:invalidate 清 history 是冗餘的(`historyCard` 設成 undefined,下一次問就會因卡不同而清),Stryker 也標存活,視為**等價** |
| 輪數上限 | K6 輪數 5、K7 不限輪數、K13 取最舊 3 輪 | 都**紅** |
| 前輪問答都算進提示 | K12 只帶問題不帶回答 | **紅**(2 條) |
| 失敗那一輪不進討論 | C9 看不懂的也記進討論 | **紅** |
| 看不懂被猜成 continue / 截一截 | K5 猜 continue | **紅**(26 條) |
| 回答 JSON 缺欄位、suggestion 不合法、followups 超過 3、answer 空 | K1 非 strict、K2 followups 上限 4、K3 answer 可空、K4 suggestion 多一個 none | 都**紅** |
| highlight 三種 | C19 continue 不亮、C20 最深一層仍亮 deepen、C21 back 取最後一張、C22 back 沒先備亮 next | 都**紅** |
| 到每日上限呼叫了 AI | C14 上限不擋、C17 讀錯帳本檔、C18 花費日期錯 | 都**紅** |
| CAP=0 | C13 CAP=0 當用完 | **紅** |
| 壞行不是 0 | C16 壞行略過 | **紅** |
| 不落地 | C23 回答寫一個檔進 state | **紅**(6 條) |
| provisional / no-model | C10 provisional 固定 false、C11 NO_MODEL 對成 failed | 都**紅** |
| 路由與 deepen 同列、備援、token 1536 | L1 路由 cloud-only、L2 備援 cloud-only、L3 token 1024 | 都**紅**(10、11、3 條) |
| 提示只含目前那張卡 | K10 少內文、K11 少未學先備 | 都**紅** |
| 實作動到 touches 以外的檔 | `git diff --name-only` | 只有實作報告一個,可 |
| prompt 檔改了沒有 golden 集 | 全專案 vitest 綠(registry 與 registry-t68 全過) | 過 |

## 5. 沒被釘住的改壞(存活)與判斷

| 編號 | 改壞 | 判斷 |
|---|---|---|
| K8、K9 | 提示拿掉標題 / 拿掉 example | **缺口 G1**:工單第 2 點寫輸入有標題、body、example |
| C12 | 呼叫中 router 丟 BUDGET_EXCEEDED 改回 failed | **缺口 G2** |
| C15 | 沒有帳本檔當壞帳本 | **缺口 G3**(全新安裝第一次問會失敗) |
| H8 | 空白問題照問 | **缺口 G4**(見 3-c) |
| C24 | deepen 開始時改用「清掉所有」 | 工單寫「deepen 成功才清」,實作是「失敗保留」;測試沒釘「deepen 失敗後問答還在」。小缺口 G5,可以不補 |
| Stryker 看到的:第一輪的提示不該有「前面的討論」區塊;history 初始值被改成怪值也不紅 | 缺口 G6:測試只檢查舊字串不出現,沒檢查第一輪提示沒有前輪區塊 |
| Stryker 看到:answer 或追問只有空白 | 缺口 G7:程式把「全空白」當空(NonBlank),測試沒釘 |
| Stryker 看到:poll 在沒有 ask 時(idle)回的內容 | 缺口 G8:沒有 ask 就 poll,現在回純 TeachView;沒人釘 |
| Stryker 看到:`failed` 與「花費算不出來」的訊息字串被改成空字串 | 缺口 G9:訊息沒釘「非空」,畫面會顯示空白 |

## 6. 變異測試(Stryker)

指令:`npm run mutate -- stryker.t68-ask.json` 與 `npm run mutate -- stryker.t68-routing.json`(兩份設定都在本分支根目錄)。coverageAnalysis off、跑 8 個測試檔(t68 三個、ask、protocol、t37/t43 handler、session)。ask 這份花 20 分鐘。

| 檔 / 範圍 | 分數 | 殺 / 活 |
|---|---|---|
| **ask 設定總計** | **71.19%** | 215 / 87 |
| teach/ask.ts(整檔) | 53.13% | 殺 34、活 30 |
| session/teach-ask.ts(整檔) | 75.00% | 殺 120、活 40 |
| session/handler.ts(接線 350 到 361 與 398 到 440 行) | 78.08% | 殺 57、活 16 |
| session/teach.ts(askContext) | 80.00% | 殺 4、活 1 |
| **routing.ts(門檻 95%)** | **97.73%** | 殺 43、活 1 → **過** |

存活怎麼分(逐條讀過清單):

- **schema 與 highlight(工單點名嚴格級)**:highlight 的 `highlightFor` 沒有任何存活;schema 只活了 NonBlank 的「全空白」判斷(G7)與 `JSON.parse(text.trim())` 的 trim(等價:JSON.parse 本來就容忍前後空白)。
- **提示文字**(ask.ts 的 `category:`、`title:`、`level:`、`deepest level:`、`unlearned prereqs:` 這些標籤字串、區塊分隔線、「earlier discussion」字樣、輪數編號):約 28 個,這是 ask.ts 分數低的主因。其中標題、example 屬規格缺口(G1);其餘純標籤與分隔符號,只影響給模型看的格式,我歸為文字層、不要求逐字釘。但「最深一層」標記(`deepest level: yes`)是告訴模型別選 deepen,值得釘一條。
- **等價或死碼**:`running()` 四個(handler 不用它);兩道晚到保險中的一道;`finally` 裡清 job;`JSON.parse` 的 trim;invalidate 清 history(冗餘,見上);`shutdown` 的清理(側車結束前)。
- **不是這張的**:handler 第 403、407、411 行的 `deepen.running()` 擋 next/switch/prereq 的判斷是 T43 以前就有的程式,落在我設的範圍裡才算進來;不屬於 T68 的驗收。
- **缺口類**:G1 到 G9(見第 5 節)。

## 7. 金鑰、花費與資料

- LLM 呼叫 0(全程假 router、`--fake`)。沒有 live、沒有 `.env`。
- 真 learning/ 前後(只讀):64 檔 / 3f944d2429767455 / 118 行,前後相同。筆電 `~/.cache/llm-learning-cards` 頂層 498,前後相同。(雜湊與作者說的 60755f0d 不同、`~/.cache` 比我兩輪前量的 497 多一個:是使用者 I4 試用造成的,我沒寫過。)
- 這份證據不含 learning/ 與 raw/ 的檔名或卡片內容。
- 花費:實作者是子代理,用量我看不到,寫「不知道」;驗收側沒有 LLM 花費。

## 8. 建議(給協調者轉測試 agent)

補測試後我重跑 ask 這份變異。優先序:

1. G1:提示含卡標題、含 example(提示測試)。
2. G2:router 丟 BUDGET_EXCEEDED(呼叫中)→ `error: 'budget'`。
3. G3:沒有 log.jsonl 時第一次問成功。
4. G4:空白問題 → bad-request、router 呼叫 0(或明講取消這條規則)。
5. G6:第一輪(與換卡後第一問)的提示沒有「前面的討論」區塊。
6. G7:answer 或追問只有空白 → `unreadable`。
7. G9:每種 error 的 message 非空。
8. 鬆的那條:「沒有目前卡時問」改成要求 bad-request,不接受任何 ask.error。

G5、G8 與提示標籤的字串可以不補。

## 9. 補測後重跑(2026-11-25,第二輪)

- 被驗:`t68-red2` = aa6e1660f706bfd7813b7b2f5c3834f28d12b7b0(基底 t68-impl 204c49a;3 個檔、+432/−4)。i9 簽出的 tree sha 開跑與跑完都是 9c801edd083d8829d2f476d1494cc8ba6eb8f862;沒有 `.env`。
- 測試作者與範圍:`git diff --name-only t68-impl t68-red2` 只有 3 個測試檔(新增的缺口測試兩個、既有 handler 測試一個),**實作 0 行**。既有 handler 測試改的是「沒有目前卡時問」那一條,從「bad-request 或任何 ask.error 都行」收緊成**明確 bad-request、router 呼叫 0**(舊斷言被換掉,新的更嚴)。
- 基準:tsc 乾淨、check:steps PASS、**全部 vitest 303 檔全過;7922 過、174 略過(共 8096)**(上一輪 301 檔 7875 過,多的是新增測試)。
- 變異:`npm run mutate -- stryker.t68-ask-r2.json`。設定與範圍和第一輪相同(ask.ts、teach-ask.ts、handler 接線兩段、teach.ts 的 askContext),只有測試檔清單多了兩個新測試檔。原設定檔 stryker.t68-ask.json 保留不動。

| 檔 / 範圍 | 第一輪 | **第二輪** | 殺 / 活 |
|---|---|---|---|
| **ask 設定總計** | 71.19% | **84.44%**(過 80%) | 255 / 47 |
| teach/ask.ts | 53.13% | 85.94% | 55 / 9 |
| session/teach-ask.ts | 75.00% | 83.75% | 134 / 26 |
| session/handler.ts(接線) | 78.08% | 83.56% | 61 / 12 |
| session/teach.ts(askContext) | 80.00% | 100.00% | 5 / 0 |

### 剩下 47 個存活怎麼分(逐條讀過)

- **文字層(提示標籤、分隔符號,9 個)**:ask.ts 的模板開頭、example 前面那個空行的內容、`earlier discussion on this card:` 標籤、輪數編號、結尾空行,以及 NonBlank 的錯誤訊息字串。只影響給模型看的格式與 zod 的訊息,不是行為。
- **等價或死碼(約 24 個)**:`running()` 四個(handler 不用);「晚到」第二道保險與 `cancelled` 預設值(第一道已擋,拿掉行為不變);`finally` 清 job;`JSON.parse` 的 trim(近似等價:只差前後有 BOM 或不換行空白時,見第 10 節 41);`history` 初始值與 invalidate、shutdown 裡的清理(下一次問時因為卡 id 不同本來就會清,等價);poll 的 idle 與 done 判斷(handler 之後的回應形狀不變);`errorCode` 的型別判斷;帳本壞行那個 `if` 與它的訊息字串(壞行走到下一行一樣丟、一樣回 budget 與同一個訊息);`shutdown` 的清理。
- **不是這張的(約 9 個)**:handler 第 399、403、407、409、411、413 行是 T43 以前就有的「換卡動作」程式(`deepen.running()` 擋、`abandon`、預設參數),落在我設的範圍裡才被算進來。
- **剩下 2 個小缺口(不擋)**:
  1. 讀帳本時「不是 ENOENT 的讀檔錯誤」(例如權限不夠、log.jsonl 被換成資料夾):**實作的行為是對的**(丟錯,外層回 `error: 'budget'`、不呼叫);但**沒有測試釘住**,把處理拿掉或把判斷改成永遠放行,測試都不紅。(本節第一次寫成「現在被當成沒花費放行」是說反了:放行的是改壞版,不是實作。更正見第 10 節。)建議補一條:帳本檔讀取失敗且不是 ENOENT → `error: 'budget'`、router 呼叫 0。
  2. handler 第 357 行 `reloadAndMaybeDropRouter()`(問之前重讀 .env、金鑰變了就換 router)沒有測試。這是 deepen 與考題也在用的共用步驟,不是 T68 新邏輯,可以不補。

### 結論(第二輪)

變異 84.44%,**達到 ≥80%**。第一輪的 G1 到 G9(提示含標題與 example、呼叫中 BUDGET_EXCEEDED、無帳本檔、空白問題、第一輪無前輪區塊、全空白回答、訊息非空、無卡時嚴格 bad-request)都已經釘住,對應的改壞不再存活。剩下的是文字層、等價、非 T68 的既有程式,加上上面 2 個小缺口。沒有阻擋項。

- 真 learning/ 前後仍是 64 檔 / 3f944d2429767455 / 118 行,`~/.cache` 498,不變。LLM 呼叫 0。

## 10. 47 個存活逐個列表(第二輪,ask 設定 84.44%)

來源:第二輪 Stryker 的報告(逐個讀過,每個對回 t68-impl 的原始碼);報告檔在 i9 上已隨簽出清掉,這一節沒有重跑。行號是 t68-impl(也是 t68-red2)的行號。
分類:**文字層**(只改給模型看的格式)、**等價**(改了行為不變,寫一句為什麼)、**死碼**(沒有人呼叫)、**沒測到**(行為會變、沒有測試紅;分「非 T68」「共用步驟」「T68 缺口」)。
統計:文字層 8、等價 15(其中 2 個是推定:#23、#24)、死碼 4、近似等價 1、沒測到·非 T68 7、沒測到·共用 1、沒測到·T68 缺口 11(其中 #36、#37 影響小),共 47。

### 10.1 handler.ts(12 個)

| # | 行 | Stryker 改了什麼 | 分類 | 說明 / 建議補什麼 |
|---|---|---|---|---|
| 1 | 357 | CallExpression:刪掉 `reloadAndMaybeDropRouter()` | 沒測到·共用 | 問之前重讀 .env、金鑰變了就丟舊 router。deepen、考題用同一段,不是 T68 新邏輯。可不補;要補:換 .env 金鑰後再問,router 工廠被呼叫第二次 |
| 2 | 399 | CallExpression:刪掉 `deepen.abandon()`(teach.open) | 沒測到·非 T68 | T43 以前就有的規則(開啟時放掉進行中的深入),落在我的範圍才算進來 |
| 3 | 403 | ConditionalExpression → `false`(teach.next 的「deepen 跑著回 bad-request」) | 沒測到·非 T68 | 同上,T43 規則;T68 的互斥測試只測 teach.ask 這一邊 |
| 4 | 403 | StringLiteral `'bad-request'` → `""` | 沒測到·非 T68 | 同上(錯誤種類字串) |
| 5 | 407 | ConditionalExpression → `false`(teach.switch 同一條規則) | 沒測到·非 T68 | 同 3 |
| 6 | 407 | StringLiteral `'bad-request'` → `""` | 沒測到·非 T68 | 同 4 |
| 7 | 409 | StringLiteral:`category ?? ''` 的預設值 `''` → `"Stryker was here!"` | 等價 | 協定規定 switch 一定帶 category(必填字串),預設值走不到 |
| 8 | 411 | ConditionalExpression → `false`(teach.prereq 同一條規則) | 沒測到·非 T68 | 同 3 |
| 9 | 411 | StringLiteral `'bad-request'` → `""` | 沒測到·非 T68 | 同 4 |
| 10 | 413 | UnaryOperator:`index ?? -1` 的 `-1` → `+1` | 等價 | 協定規定 prereq 一定帶 index(必填非負整數),預設值走不到 |
| 11 | 428 | StringLiteral:`question ?? ''` 的 `''` → `"Stryker was here!"` | 等價 | 協定規定 teach.ask 一定帶 question(必填字串),預設值走不到 |
| 12 | 437 | ConditionalExpression → `true`(`polled.state === 'done'` 恆真) | 等價 | 不是 done 時 `polled.ask` 是 undefined,回應 `{...view, ask: undefined}` 經 JSON 序列化後與沒有 ask 一樣 |

### 10.2 teach-ask.ts(26 個)

| # | 行 | Stryker 改了什麼 | 分類 | 說明 / 建議補什麼 |
|---|---|---|---|---|
| 13 | 75 | ConditionalExpression → `true`(errorCode 的 `typeof err === 'object'` 判斷) | 沒測到·T68 缺口 | 這四個(13 到 16)是同一件事:router 丟的不是物件(字串、null、undefined)時,原本回 `undefined` 走 `failed`;改壞後讀 `.code` 會對 null 丟 TypeError,從 catch 裡逃出去變成沒人處理的 rejection。**補一條:router 丟字串、丟 null → `error: 'failed'`,不留下未處理的錯誤** |
| 14 | 75 | LogicalOperator:`&&` → `\|\|` | 沒測到·T68 缺口 | 同 13 |
| 15 | 75 | ConditionalExpression → `true`(`err !== null` 那半) | 沒測到·T68 缺口 | 同 13 |
| 16 | 75 | ConditionalExpression → `true`(另一半) | 沒測到·T68 缺口 | 同 13 |
| 17 | 92 | ArrayDeclaration:`history` 初始 `[]` → `["Stryker was here"]` | 等價 | 第一次問時 `historyCard` 還是 undefined,與卡 id 不同,第一行就先把 history 清成 `[]` |
| 18 | 109 | BlockStatement:讀帳本的 `catch` 整塊清空 | 沒測到·T68 缺口 | **小缺口①**(見 10.4):非 ENOENT 的讀檔錯誤現在會丟錯、回 budget;改壞版會把它吞掉當沒花費,沒有測試紅 |
| 19 | 110 | ConditionalExpression → `false`(`code !== 'ENOENT'` 永遠不丟) | 沒測到·T68 缺口 | 同 18 |
| 20 | 113 | ConditionalExpression → `false`(`if (!parsed.ok) throw`) | 等價 | 壞行時 `parsed.events` 是 undefined,下一行的 computeDailySpend 一樣丟錯,同一個外層 catch 回同一個 budget 與同一句訊息 |
| 21 | 113 | StringLiteral:丟出的錯誤文字 → `""` | 等價 | 外層 catch 不看錯誤文字,固定回「花費算不出來」那一句 |
| 22 | 123 | ConditionalExpression → `true`(`job === mine && !mine.cancelled` 整個) | 沒測到·T68 缺口 | 這個條件擋「晚到的結果」。成功路徑前面還有一道 cancelled 檢查,所以成功不會漏;但 catch 路徑沒有,**晚到的『失敗』(router 在換卡後才丟錯)會漏進新狀態,poll 會回舊卡的錯誤**。**補一條:ask 在途中換卡,router 之後才失敗(NO_MODEL 與一般錯誤各一)→ poll 不回那個失敗** |
| 23 | 123 | LogicalOperator:`&&` → `\|\|` | 等價(推定) | 可到達的狀態只有兩種:兩邊都真(還在跑)、兩邊都假(已丟棄),`\|\|` 與 `&&` 結果一樣;沒有「一真一假」的路 |
| 24 | 123 | ConditionalExpression → `true`(其中一個子條件) | 等價(推定) | 丟棄時 `job` 與 `cancelled` 一起變(drop 同時設兩個),另一個子條件單獨就擋得住。**22 到 24 因為報告已清,我分不出哪個 mutant 對應哪一種;22 的補測一次就能確認** |
| 25 | 127 | ConditionalExpression → `false`(`if (mine.cancelled) return` 在拿到 router 之後) | 沒測到·T68 缺口 | 換卡發生在「拿 router」途中時,原本不再呼叫 AI;改壞版會多呼叫一次 AI(結果事後被丟,但錢花了)。**補一條控制器單元測試(假的 acquireRouter 刻意拖慢):拿 router 途中換卡 → router 的 call 次數 0** |
| 26 | 165 | ConditionalExpression → `true`(`finally` 裡 `if (job === mine) job = undefined` 恆真) | 沒測到·T68 缺口 | **最值得補**:舊 ask 晚到收尾時,會把「新卡上新開的 ask」的 job 也清掉,新 ask 的答案就被丟掉、poll 一直回 idle,畫面卡住。**補一條:ask1 被攔住 → 換卡 → ask2 開始 → 放行 ask1 → ask2 仍在跑、最後 poll 拿到 ask2 的答案** |
| 27 | 170 | ArrowFunction:`running` 整個換成回 undefined | 死碼 | `running()` 在介面上,但 handler 沒有人呼叫(互斥由 `ask()` 自己判斷)。建議之後刪掉,或有人用了再測 |
| 28 | 170 | ConditionalExpression → `true` | 死碼 | 同 27 |
| 29 | 170 | ConditionalExpression → `false` | 死碼 | 同 27 |
| 30 | 170 | EqualityOperator:`!==` → `===` | 死碼 | 同 27 |
| 31 | 186 | ObjectLiteral:`{ cancelled: false }` → `{}` | 等價 | `cancelled` 只被當真假讀,`undefined` 也是假 |
| 32 | 194 | ConditionalExpression → `true`(`result !== undefined` 恆真) | 等價 | 沒結果時回 `{state:'done', ask: undefined}`,handler 展開後 `ask: undefined` 經 JSON 序列化消失,與 idle 的回應一樣 |
| 33 | 195 | ObjectLiteral:idle 的 `{ state: 'idle' }` → `{}` | 等價 | handler 只比對 `'asking'` 與 `'done'`,其他一律走純 TeachView 那條,所以內容是什麼都一樣 |
| 34 | 195 | StringLiteral:`'idle'` → `""` | 等價 | 同 33 |
| 35 | 204 | ArrayDeclaration:invalidate 裡 `history = []` → `["Stryker was here"]` | 等價 | invalidate 同時把 `historyCard` 設成 undefined,下一次問就會因卡 id 不同而清掉 history |
| 36 | 208 | BlockStatement:`shutdown()` 整個清空 | 沒測到·T68 缺口(小) | shutdown 在側車結束時才呼叫,沒有測試看得到。**可補一條控制器單元測試:shutdown 後在途的 ask 不再產生結果、不再呼叫 router**;影響小(行程就要結束) |
| 37 | 209 | CallExpression:刪掉 shutdown 裡的 `drop()` | 沒測到·T68 缺口(小) | 同 36 |
| 38 | 210 | ArrayDeclaration:shutdown 裡 `history = []` → 怪值 | 等價 | 同 35(shutdown 本身行程要結束,history 清不清沒人看得到) |

### 10.3 ask.ts(9 個)

| # | 行 | Stryker 改了什麼 | 分類 | 說明 / 建議補什麼 |
|---|---|---|---|---|
| 39 | 18 | ObjectLiteral:NonBlank 的 `{ message: '不能是空的' }` → `{}` | 文字層 | 只是 zod 的錯誤訊息,不外露 |
| 40 | 18 | StringLiteral:`'不能是空的'` → `""` | 文字層 | 同 39 |
| 41 | 32 | MethodExpression:`JSON.parse(text.trim())` 拿掉 `trim()` | 近似等價(小缺口) | JSON.parse 本來就容忍前後的空格、換行、tab;只有「前後有 BOM 或不換行空白(NBSP)」時,原版接受、改壞版拒絕。我第一版寫「等價」不夠精確。若規格要容忍這種前後字元,補一條「前後有 BOM 仍算合法」;不然可不補 |
| 42 | 75 | StringLiteral → `""`(提示的分隔線 `'---'` 或模板結尾換行處理之一) | 文字層 | 只影響給模型看的區塊分隔 |
| 43 | 75 | StringLiteral → `""`(同一行的另一個) | 文字層 | 同 42 |
| 44 | 76 | StringLiteral:example 前面那個空行 `''` → `"Stryker was here!"` | 文字層 | 只是 example 前的空行內容(`example:` 標籤與 example 文字本身已被 G1 測試釘住,沒有存活) |
| 45 | 79 | StringLiteral:`'earlier discussion on this card:'` → `""` | 文字層 | 前面討論區塊的標題字樣;G6 測試釘的是「第一輪沒有這個區塊」,沒釘標題字 |
| 46 | 81 | ArithmeticOperator:`i + 1` → `i - 1`(前輪編號) | 文字層 | 只是 earlier question 1/2/3 的編號 |
| 47 | 84 | StringLiteral:`'---'` → `""`(問題前的分隔線) | 文字層 | 同 42 |

### 10.4 小缺口①(帳本讀檔錯誤不是 ENOENT)一句話

**現在實作的行為(對):** 讀 `state/log.jsonl` 遇到不是「檔案不存在」的錯誤(例如權限不夠、被換成資料夾),`teach-ask.ts` 第 110 行會把錯往外丟,外層回 `error: 'budget'`(訊息「今天的花費算不出來」)且不呼叫 router;**應該的行為**也是這個——所以實作不用改,缺的是測試:第 109、110 行被改壞(把錯吞掉當沒花費)時沒有任何測試紅(# 18、19)。**請 -67 補一條:把 log.jsonl 換成資料夾 → `error: 'budget'`、router 呼叫 0 次。** 我在第 9 節第一次寫成「實作現在被當成沒花費放行」是說反了,已更正。

### 10.5 建議補測的優先序(重跑變異前)

1. **#26**(舊 ask 晚到收尾清掉新 ask,畫面會卡住):最重要。
2. **#22**(晚到的失敗漏進新卡)。
3. **#13 到 16**(router 丟非物件)。
4. **#18、19**(帳本讀檔錯誤)。
5. **#25**(拿 router 途中換卡,不再呼叫)。
6. 低優先:#36、37(shutdown)、#41(BOM)、#1(.env 重讀)。
7. 其餘(文字層 8、等價 15、死碼 4、非 T68 7)不補。#27 到 30 建議之後把沒人用的 `running()` 刪掉。

補完 1 到 4 之後,預期 ask 設定的分數會升到約 87% 到 88%(多殺 8 到 9 個);這是估算,沒有重跑。
