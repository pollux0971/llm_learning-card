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

- **文字層(提示標籤、分隔符號,9 個)**:ask.ts 的模板開頭、`example:` 標籤、`earlier discussion on this card:` 標籤、輪數編號、結尾空行,以及 NonBlank 的錯誤訊息字串。只影響給模型看的格式與 zod 的訊息,不是行為。
- **等價或死碼(約 24 個)**:`running()` 四個(handler 不用);「晚到」第二道保險與 `cancelled` 預設值(第一道已擋,拿掉行為不變);`finally` 清 job;`JSON.parse` 的 trim(JSON 本來容忍前後空白);`history` 初始值與 invalidate、shutdown 裡的清理(下一次問時因為卡 id 不同本來就會清,等價);poll 的 idle 與 done 判斷(handler 之後的回應形狀不變);`errorCode` 的型別判斷;帳本壞行那個 `if` 與它的訊息字串(壞行走到下一行一樣丟、一樣回 budget 與同一個訊息);`shutdown` 的清理。
- **不是這張的(約 9 個)**:handler 第 399、403、407、409、411、413 行是 T43 以前就有的「換卡動作」程式(`deepen.running()` 擋、`abandon`、預設參數),落在我設的範圍裡才被算進來。
- **剩下 2 個小缺口(不擋)**:
  1. 讀帳本時「不是 ENOENT 的讀檔錯誤」(例如權限不夠)現在會被當成「沒花費」放行:把那個 `catch` 的處理拿掉、或把 `!== 'ENOENT'` 改成 false,測試都不紅。實務上 router 本身遇到壞帳本會拒絕真呼叫,所以不會多花錢,但行為與「不知道不是 0」的原則不完全一致。建議補一條:帳本檔不是 ENOENT 的錯誤(例如把 log.jsonl 換成資料夾)→ `error: 'budget'`、router 呼叫 0。
  2. handler 第 357 行 `reloadAndMaybeDropRouter()`(問之前重讀 .env、金鑰變了就換 router)沒有測試。這是 deepen 與考題也在用的共用步驟,不是 T68 新邏輯,可以不補。

### 結論(第二輪)

變異 84.44%,**達到 ≥80%**。第一輪的 G1 到 G9(提示含標題與 example、呼叫中 BUDGET_EXCEEDED、無帳本檔、空白問題、第一輪無前輪區塊、全空白回答、訊息非空、無卡時嚴格 bad-request)都已經釘住,對應的改壞不再存活。剩下的是文字層、等價、非 T68 的既有程式,加上上面 2 個小缺口。沒有阻擋項。

- 真 learning/ 前後仍是 64 檔 / 3f944d2429767455 / 118 行,`~/.cache` 498,不變。LLM 呼叫 0。
