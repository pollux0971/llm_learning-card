# 驗收 T43:07 teach-card phase-3「深入這個」

- 被驗:分支 t43-steps-fix,sha 2104b65e0c447ad5731ac9ce2057003b2a4d85bb(= t43-start c6ad238 + worker 實作 ef8fb05 + 測試角色的 1 個步驟檔補丁)
- tree 開跑前 e6f45299db4fa718eb11ccb2defab64c3bdb9b71,跑完 e6f45299db4fa718eb11ccb2defab64c3bdb9b71(相同,手改突變全數還原)
- 日期 2026-10-23。驗收:-5b。乾淨 worktree,ls .env 失敗(無 .env)。
- 環境:host pollux-IdeaPad,8 核,VITEST_MAX_WORKERS=1,CARGO_BUILD_JOBS=2,Stryker concurrency 2。load 開跑前 1.5、收尾 11.7(收尾時有別的行程在跑,不是這張的單一重活)。
- 重編:Rust 沒改(src-tauri 0 變動),複製既有 target 後 cargo test 照讀新向量,沒有需重編的 JS 產物。

## 1. 測試作者
- git diff --name-only c6ad238..2104b65 對受保護清單(測試檔、test-support、步驟檔、support、.feature、向量檔、fixtures、src-tauri/tests):只命中 features/steps/test-card-phase2-sidecar.steps.ts,來自測試角色的 commit 2104b65。
- worker 實作 ef8fb05 單看:對同一清單 0 命中。
- 2104b65 的內容:i3「review helper takes only review actions」的方法清單加上 teachBack、teachCancel、teachDeepen、teachPoll,攻擊清單加四個新動作、無參數檢查加四個名字。比原本更嚴,沒有放寬。
- 注意:所有 commit 的 git 作者都是同一個使用者,分不出人;以上用「這個 commit 動了什麼檔」判。

## 2. 硬規則 4(prompts)與其他不該動的路徑
git diff --stat c6ad238..2104b65 對 packages/core/prompts、apps/desktop/src-tauri、contracts:無輸出。scripts/boundaries.allow.json:無輸出(工單說 D8 例外由協調者加;boundaries 照樣 PASS,見下)。.feature:0 個被改。

## 3. 寫入路徑(非作者反向審)
- 假網路 apps/teach-card/dev/fake-cloud.mjs:沒有任何寫檔、刪檔,只換 fetch 與記請求。
- 深入寫入(packages/core/src/ingest/deepen.ts):考題檔、卡檔都走 writeFileAtomic;順序是考題 → 卡 → 圖(writeCategoryGraph)→ deepened 事件(recordEvent)。mkdirSync 只建 questions 與 cards/分類 目錄。目標都由傳入的 learningDir 組出,沒有寫死路徑。
- state/reviews.json 的寫入走既有的 saveReviewsIfUnchanged(沒新增直接寫入)。
- children.ts 的 writeFileSync 是 ingest 原本就有的寫法(只把內容抽成 renderCardFile 共用,ingest 路徑沒有改成原子,也不是這張新增的)。
- 硬規則 3:commitDeepen 在寫任何檔之前,對每張卡呼叫 validateCard;字數重試在 generate-cards.ts 的 enforceWordLimit(連字號、句點切斷規則沿用 validateCard 的計數)。但這個 validateCard 閘門沒有測試守著,見缺口 G1。

## 4. 基準(未突變)
| 項目 | 結果 |
|---|---|
| tsc --noEmit | 乾淨 |
| boundaries | gate=boundaries result=PASS scanned=361 |
| doc-links | gate=doc-links result=PASS scanned=131 |
| zero-input-guard 單跑 | 1 檔,775 過、171 略過 |
| T43 相關 vitest(protocol、t37-handler、review-client-deepen、apps/teach-card 全部、t43 七檔) | 19 檔 436 條全過 |
| 全部 vitest | 242 檔,6546 過、171 略過、0 失敗 |
| cucumber @teach-card and @phase-3 and not @manual | 8 場景全過(49 步) |
| cucumber @teach-card and @phase-2 and not @manual | 5 場景全過 |
| cucumber @teach-card and @phase-1 and not @manual | 10 場景全過 |
| cucumber @i2 and not @manual | 93 場景全過 |
| cucumber @i3 and not @manual | 190 場景全過 |
| cargo test(apps/desktop/src-tauri) | 258 過、0 失敗 |

## 5. 變異測試
指令(兩輪,都走單一入口,鎖由它管):
- 第一輪:npm run mutate -- stryker.t43-deepen.json
- 第二輪:npm run mutate -- stryker.t43-deepen-r2.json
範圍與測試:
- 第一輪 mutate:ingest/deepen.ts 全檔、session/teach-deepen.ts 全檔、ingest/generate-cards.ts 第 81–111 行(enforceWordLimit)與 147–158 行(字數與重寫套用的輔助函式)。測試:t43 handler、commit、cancel、deck、atomic,加 generate-cards 的兩個既有測試檔。--bail=1,concurrency 2,timeoutMS 120000。
- 第二輪:teach-deepen.ts 第 60–125、136–201 行,測試多加 t43-sidecar(真起側車;第一輪沒包它,所以先前的 shutdown 與缺金鑰存活者需要重驗)。

| 輪 | 檔 | 分數 | 殺掉 | 逾時 | 存活 |
|---|---|---|---|---|---|
| 1 | 全部(425 個) | 76.94 | 326 | 1 | 98 |
| 1 | deepen.ts | 70.68 | | | 56 |
| 1 | teach-deepen.ts | 81.58 | | | 35 |
| 1 | generate-cards.ts(範圍內) | 84.09 | | | 7 |
| 2 | teach-deepen.ts(173 個) | 80.92 | 140 | 0 | 33 |

第二輪把 t43-sidecar 加進去之後,teach-deepen.ts 存活從 35 降到 33(被側車測試多殺掉的是第 140 行的條件改為真、第 163 行的條件改為真)。原始 JSON 與報告:reports/mutation/ 的 2104b65-t43-deepen.json 與 2104b65-t43-deepen-r2.json(摘要);完整原始檔在驗收者暫存區。

### 存活者分類(第一輪 98 個;teach-deepen.ts 那 35 個第二輪重驗後剩 33 個;按原因分組)
等價(死碼、重複防線、結果相同):
- E1 deepen.ts 的 DeepenStopped 建構子與 name(第 22–24 行):內部標記,沒人讀字串。
- E2 deepen.ts 的 stoppingRouter 的 probeOnline、probeLocal(第 59–60 行):外面包過的 router 沒人呼叫這兩個。
- E3 provisional 的「if (provisional)」條件(deepen.ts 第 77、101 行):onResult 只在 true 時被叫,條件改成永遠真結果一樣。
- E4 「stopped」回傳的各種改法(deepen.ts 第 87、98、113、144、150 行,teach-deepen.ts 第 93 行):shouldStop 為真就等於這個工作已不是目前的工作,teach-deepen 第 92 行的 isCurrent 檢查會擋下,雙重防線。
- E5 「failed」、「cards」、「collision」回傳的物件形狀與 kind 字串(deepen.ts 第 91、120、151、152、190 行;teach-deepen.ts 第 98、116 行):kind 改掉後下游沒有對應分支,會落到 commitDeepen 或 enterChildren 丟例外,被 runJob 的 catch 接成同一個 deepen-failed。結果相同,但這代表失敗路徑有一部分靠「丟例外被接住」而不是明確分支。見備註 N1。
- E6 teach-deepen.ts 第 68 行 isCurrent 的 active === job:每次換 active 前舊工作一定先標 cancelled,所以這段是多餘的。
- E7 teach-deepen.ts 第 121 行、第 170 行(工作編號 id 沒人讀)、第 172–173 行(runJob 自己有 try/catch,外層 catch 到不了)。
- E8 deepen.ts 第 251 行(圖節點去重複):新 id 不會重複。
- E9 generate-cards.ts 第 94 行(witness 儀表呼叫與它的條件)、第 148 行(trim 與換行字串):不影響字數結果。
- E10 teach-deepen.ts 第 139–142 行 shutdown 的細節、第 182 行清理 active:側車 EOF 之後 process.exit 結束,shutdown 的內容不影響結果;我另做手改證明 EOF 那一段本身有被測試守住(H2 紅)。poll 後清理 active 沒有可觀察效果。
真缺口(測試沒守住):
- G1(中)deepen.ts 第 193–194 行:commitDeepen 寫檔前的 validateCard 閘門(硬規則 3 的「寫檔前檢查」)。我把它整段拿掉,311 條 T43 相關測試仍全過(H13)。目前靠 enforceWordLimit 先擋字數,但閘門本身(例如格式不合、字數計法與 validateCard 不同的邊界)沒有任何測試要它擋。建議測試角色補:造一張過得了 enforceWordLimit 但 validateCard 不過的卡,期待 deepen-failed 且磁碟沒變。
- G2(中低)teach-deepen.ts 第 72 行:failJob 的 isCurrent 防護。舊工作在被取消之後丟非預期例外,failJob 會把錯誤塞進 pending,影響新工作的 poll。測試只有「舊工作的呼叫回來」,沒有「舊工作丟例外」。
- G3(中低)deepen.ts 第 115、116、117、146 行:字數重寫那個呼叫丟憑證錯誤、丟無模型錯誤(只略過那張並計數)、以及考題呼叫丟憑證錯誤(應整個中止而不是略過)。沒有測試。
- G4(低)deepen.ts 第 197、198 行:mkdir 目標字串。測試的 vault 一開始就有 questions 與 cards/分類 目錄,所以看不出建目錄有沒有做對。
- G5(低)deepen.ts 第 225 行:略過張數的 warning 訊息文字沒被斷言。
- G6(低)teach-deepen.ts 第 165–166 行:缺金鑰時的 credential-unavailable 回傳形狀(第二輪側車測試殺掉其中一部分,剩這幾個)。
- G7(低)teach-deepen.ts 第 179、195、197 行:poll 在沒有 pending 時的分支、back 在生成中拒絕、back 失敗時直接回傳。第二輪後仍存活。
備註:
- N1 失敗路徑靠例外落地(見 E5)。行為對,不擋;建議顧問知道。
- N2 第一輪沒用 t43-sidecar,是我的範圍選擇(它每條真起側車、慢);第二輪補了 teach-deepen。deepen.ts 沒有重驗側車對它的殺傷,但側車測試主要驗進程層(EOF、帳),不太會殺 deepen.ts 的存活者。

## 6. 手改突變(must_catch;只改實作,改完還原)
指令:VITEST_MAX_WORKERS=1 npx vitest run --bail=3,測試為 t43 七檔、protocol.test、apps/teach-card 的 t43-deepen。

| 編號 | 對應 must_catch | 改了什麼 | 結果 | 紅的測試 |
|---|---|---|---|---|
| H1 | 取消後不寫檔 | 同時拿掉三道關:deepen 結尾 shouldStop、teach-deepen 兩處 isCurrent | 紅 1 | t43-cancel「手上是最後一個呼叫時取消:寫入前還要再檢查」 |
| H2 | 側車 stdin 結束 | review-sidecar.ts 的 EOF 後不 shutdown、不 exit | 紅 1 | t43-sidecar「側車讀到 stdin 結束:進行中的工作當成取消,馬上結束行程」 |
| H3 | 取消 | teach.cancel 不取消工作 | 紅 2 | t43-sidecar「Cancelling writes nothing」等 |
| H4 | 每個呼叫 task 是 deepen | 子卡呼叫改回 ingest.cards | 紅 2 | t43-sidecar「Children are generated when there are none」帳本 task |
| H6 | deps 邊 | 邊反向 [子, 父] | 紅 1 | t43-handler「deps.json:多了每張新卡的節點與 [父, 子]」 |
| H7 | 最深一層 | 底線 4 改 5 | 紅 1 | t43-handler「There is a floor」 |
| H8 | 主流程 level 2 | isMainFlowLevel 改成 level <= 2 | 紅 4 | t43-deck「剩幾張只算 level 0 與 1」等 |
| H9 | 最後一張記父卡 | 最後一張不把父卡放進 record | 紅 5 | t43-deck「Next within a set of children」等 |
| H10b | 離線標 provisional | 新卡 provisional 兩處都寫死 false | 紅 2 | t43-handler「Offline generation falls back and is marked」 |
| H11 | 新卡先備 | 新卡 prereqs 不放父卡 | 紅 4 | t43-commit 卡檔內容一字不差、t43-handler |
| H12 | deepened 事件 provisional | 事件寫死 false | 紅 2 | t43-handler「Offline generation falls back and is marked」 |
| H13 | 硬規則 3 寫檔前閘門 | 拿掉 validateCard 閘門 | **存活**(311 全過) | 無 → 缺口 G1 |
H10(只改 frontmatter 那一行、留後面的覆寫)沒紅:後面 card.frontmatter.provisional = cardProvisional 蓋過去,是重複寫法,等價;H10b 兩處都改才紅。

must_catch 其餘條(既有子卡不重打模型、考題檔要過驗證、寫入順序、字數重試次數上限、不同分類的圖不動、生成中 start/next 馬上回、舊工作不碰新工作、輪詢不自己判斷 busy、standalone 不打真網路、不退步、prompts 無改動)由 Stryker 第一輪與以上通過的 t43 測試、cucumber 場景覆蓋;這些條我沒各自手改,以 Stryker 殺掉對應位置為準,存活者見上。

## 7. learning/ 前後
前:64 檔 / c2e4dd6d71de3976 / 108 行。後:64 檔 / c2e4dd6d71de3976 / 108 行。相同。

## 8. 花費
worker 花費 $25.74(只記錄,grok 不設上限),工單 budget_usd 8,比值 3.2,超過 2 倍。超在哪:工單範圍大(核心 ingest、session、視窗、側車、假網路四層),worker 跑 31 分鐘;我沒有逐項拆解,所以不知道超的原因分佈。

## 9. 結論
通過,附缺口 G1(中)、G2、G3(中低)與低風險 G4–G7;不擋合併。G1 是硬規則 3 的寫檔前閘門沒有測試守住,建議交測試角色補一條再收。@manual 與 I4 的人工確認不在這份範圍。
