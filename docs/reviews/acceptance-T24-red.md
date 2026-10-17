# T24 紅測試驗收(06 phase-2)——第 1 輪(1e04a4b)與第 2 輪(1a4ce5a)

> 第 2 輪結果在最後的「第 2 輪」一節,結論以那一節為準。第 1 輪的 B1 已由 1a4ce5a 解掉。

- 工單:`docs/tickets/T24-test-card-phase-2.md`(顧問審過;驗收的是「紅測試」,不是實作)
- 被驗分支:`t24-red` tip 1e04a4b(基底 main 55bce62,一個 commit,11 檔 +2179 −293)
- 驗收 worktree:acceptance-t24red,開跑 tree sha 422c8304dd53b3ff35be6be285fab3c6bdf8ad32;沒有 `.env`
- 日期:2026-10-17
- 範圍:第一個 commit。-e5 之後加的 T22 phase-2 四個步驟定義(Rust 側)到了再補驗(見「待補」)

## 1. 基準(未改動的 t24-red)

| 項目 | 結果 |
|---|---|
| tsc --noEmit | 0 錯誤 |
| npm run boundaries | PASS(掃 329 檔) |
| vitest `apps/test-card`、`features/support/test-card-core.test.ts` | 4 檔 151 條:**148 紅 / 3 綠**(與 -e5 報的相同) |
| cucumber `@test-card and (@phase-1 or @phase-2) and not @manual`(`--tags`) | 15 場景:**10 失敗 / 4 undefined / 1 綠**(與 -e5 報的相同) |

紅的原因分佈(vitest 148):`init is not a function` 117(session 還沒有新介面)、Cannot find module 10、檔案/設定不存在或字樣不符 21(`dev/fake-cloud.mjs`、`reviews.seed.json`、`stubs/` 還在、App.svelte 沒有「重新開始」等)。沒有「測試自己寫壞」的紅。
基底綠的 3 條:`GET /__review 不是往返`、`不碰 node:/不寫檔/不 fetch`、`App.svelte/session.ts 沒有 innerHTML/{@html`。這三條是「不准有」型的守護,基底上本來就成立;下面的改壞證明它們各自抓得到。
cucumber 10 個失敗全是 `rig.session.init is not a function`;4 個 undefined 是 phase-2 的 T22 步驟(takes only review actions 等),等 -e5 第二個 commit。

## 2. 沒動 .feature、測試作者

- `git diff 55bce62 t24-red -- 'features/**/*.feature'`:空。
- 這個 commit 全是測試與支援檔(`*.test.ts`、`features/steps/**`、`features/support/**`、`card-render-test-support.ts`);沒有實作檔。
- scripts 底下沒有新增 `.ts`;新檔在 `features/support`、`apps/` 內,不需 owners 登記;boundaries PASS。

## 3. 既有測試的改動(逐處:跟著 stubs 拿掉而改,不是放寬)

| 檔 | 改了什麼 | 判斷 |
|---|---|---|
| `apps/test-card/src/stubs/scheduler.test.ts` | 刪(6 條 it、12 個 expect;測的是 StubScheduler) | StubScheduler 沒了,測的對象不在;真的 scheduler 有 04 自己的測試。phase-1 場景「被選中的卡與真 scheduler 一致」由 `features/steps/test-card.steps.ts` 的「opening it shows the first question」對終端機第一張卡比對接手 |
| `apps/test-card/src/session.test.ts` | 原 5 條 it(18 個 expect/assert)全換成吃假 `ReviewClient`;現 53 條、170 個 expect | 原 5 條各有替身且更嚴:Enter 規則(`decideKeydown` 的填空/應用題/修飾鍵三條)、送出後 header 不動(「送出之後、按下一題之前,header 不動」)、stage-2 兩種題型答完才前進(`partial` 那條:按下一題呼叫 next、不是 summary)、批改錯誤不前進(error 列三條,含題目與 header 不動)、空日畫面(`empty`)。改壞 M02/M02b/M02c 證明 error 列夠嚴 |
| `features/steps/test-card.steps.ts` | 18 個步驟一個不少(Given/When/Then 18 → 18);assert 20 → 23;import stubs 全換成程序內 handler + 假 router(`features/support/test-card-rig.ts`) | 唯一「少」的斷言:`graderCalls.fill/apply.length === 1` 與 `advanceCalls.count === 0`(對 stub 計數)。替身:對 core handler 的 submit 呼叫次數與內容(`calls.length === 1`、`deepEqual({fill})`/`{apply}`)、以及更強的 `reviews.json` 逐位元組不變(原本只數 stub 的 advance 沒被叫)。「drop in replaceable」步驟改成:session.ts 沒有 `StubScheduler` 等名字 + 對終端機第一張卡比對 + `start` 真的呼叫過 handler;`.feature` 的字沒動 |
| `packages/ui-shared/src/hud/card-render-test-support.ts`(+15/−7) | `fixtureFillAnswers` 改讀 `contracts/fixtures/learning-minimal/questions/*.yaml`(原本用 regex 讀 stubs/fixtures.ts 的文字);`click`「下一題」後等結果消失;`currentQuestion` 先等 `.prompt` 有字(最多 5 秒) | 逐個 diff 行核過:沒有任何 `expect`/`assert` 被刪或改弱(檔內本來就沒有 expect;是量測輔助)。兩處「等」只是因為題目現在是非同步來自側車;等不到時照現狀回傳(`waitFor` 的最多 5 秒後不丟錯),所以量測不會因此變鬆。fixture 答案來源由 stubs 文字換成同一組 yaml(題目內容相同的來源) |
| `features/steps/desktop-shell-phase2.steps.ts`(+9)、`features/steps/i2-review-loop.steps.ts`(+6) | 新增匯出 `requestPathOutsideDirectory`;共用句「the cloud grader returns an unparseable response twice」依 `@test-card` tag 分派到考試卡版 | 只加不改;i2 的原分支行為不變(`@i2 and not @manual` 93/93 綠) |

## 4. 丟棄式實作:證明可以轉綠

做法:在驗收 worktree 由一個子代理照工單寫了丟棄式實作(session.ts、main.ts、App.svelte、dev/standalone.ts 等,刪 stubs)。**不進 git**,交件前 `git reset --hard 1e04a4b` 丟掉。

| 項目 | 結果 |
|---|---|
| vitest(test-card + test-card-core) | **151/151**(連跑 3 次綠) |
| cucumber `@test-card and (@phase-1 or @phase-2) and not @manual` | 15 場景:**11 綠、4 undefined、0 失敗**(4 個 undefined 是 T22 的步驟,待 -e5) |
| cucumber `@i2 and not @manual` | 93/93 |
| ui-shared 的 `card-*` 渲染測試(T15) | 99/99 |
| tsc、boundaries | 乾淨、PASS |
| 全套 vitest | 198 檔,4931 綠 / 168 skipped / 0 紅(見 §7) |

丟棄式實作過程中子代理指出測試的幾個怪點(已記進 §6)。

## 5. must_catch 與自選改壞(對丟棄式實作逐條改壞;只改實作,不改測試)

指令:`MUT_WT=<worktree> python3 mutate.py muts-t24.json`;每個改完還原。紅 = 至少一條測試失敗。

| 工單 must_catch | 改壞做法 | 結果 | 紅的第一條 |
|---|---|---|---|
| stubs 還在 / import StubX、MemoryFs、loader | 放回 `stubs/scheduler.ts`;放一個 import `memory-fs` 的檔 | 紅、紅 | `apps/test-card/src/stubs/ 整個資料夾不存在`:`還留著:…/stubs/scheduler.ts`;`沒有任何(非測試)檔 import …` |
| TestSession 自己算/自己批改/自己讀 reviews.json | session.ts 多讀 `state/reviews.json`(M15);`node:fs`(S09);`fetch`(S10) | 紅 ×3 | `讀的是 next 給的 path(剛好一次)…`;`不碰 node:、不寫任何檔、不 fetch` |
| 批改 error 後換題或清輸入 | error 後自動 `fetchNext`(M02);清掉題目(M02b);header 多 +1(M02c) | 紅 ×3 | `回 status error:顯示「評分失敗,請再試一次」,題目、header 不動,沒有 result,不換題` |
| 填空用逗號接成字串 | `answers.join(',')`(M01) | 紅 | `填空:陣列原樣送給 client.submit({ fill }),不接成字串;答案裡有逗號也原樣` |
| 答完沒叫 summary | 拿掉 `client.summary()`(M03);summary 失敗被吞(M17) | 紅 ×2 | `next 回 done:呼叫 client.summary 一次…`;`summary 失敗:不卡住,走錯誤畫面` |
| paused 還出題 | paused 分支後接 `fetchNext`(M04) | 紅 | `paused:畫面是暫停、只有一句話(含 --unpause),不呼叫 next` |
| no-cards 顯示「今天沒有到期」 | 訊息換 EMPTY(M05) | 紅 | `no-cards:說掃描到 0 張卡,不能說「今天沒有到期」(P-28)` |
| 側車錯誤卡住/沒重試/重試不是 start | 拿掉 canRestart(M06,33 條紅);restart 走 next(M16) | 紅 ×2 | `sidecar-exited:「複習程式停了。」加「重新開始」…`;`review-record-changed 按「重新開始」(init):重新 start,再出題;不會直接 next` |
| root-mismatch/not-configured 給「重新開始」或顯示「複習程式停了」 | M07、M08 | 紅 ×2 | `root-mismatch:顯示 ReviewError.message 原文加 vault.ts show,不給「重新開始」` |
| next 缺必要欄位仍照常 | 缺 prompt 不檢查(M09)、填空缺 blanks 不擋(M09c) | 紅 ×2 | `next 的結果 question 缺 prompt`;`next 的結果 填空缺 blanks` |
| review-record-changed 沒有全文/沒有重新開始/不重新 start | 拿掉 canRestart(M10);訊息寫死(M10b) | 紅 ×2 | `review-record-changed:顯示全文與「重新開始」…`;`…的訊息用 ReviewError.message 原文` |
| fakeCloud 標記 | true/false 反過來(M11) | 紅 | `fakeCloud true:有「測試模式:批改是假的」` |
| reteach 不經 LearningFs / short 沒說明 | 寫死內容(M12b);讀錯路徑(M12c);short 反過來(M12) | 紅 ×3 | `讀的是 next 給的 path(剛好一次),不經 client、不 fetch…`;`short false:讀的是原卡的 path,畫面上有那句說明` |
| 縮短版用 innerHTML / {@html | session.ts 加 innerHTML(M14);App.svelte 加 `{@html`(S07) | 紅 ×2 | `App.svelte 沒有 {@html;session.ts、App.svelte 沒有 innerHTML` |
| header 已答/總數對不上 | 已答用 index 不減 1(M13) | 紅(8 條) | `header:progress index 1 / total 5 → 已答 0(index - 1,不是 index)` |
| 單獨執行寫進 contracts/fixtures 本身 / 沒開假 router | 暫存根放進 `contracts/fixtures/`(S02);拿掉 `LC_REVIEW_FAKE_CLOUD`(S03);不複製種子(S05) | 紅 ×3 | `暫存根在 os.tmpdir() 底下、不在 contracts/fixtures/ 底下…`;`LC_REVIEW_FAKE_CLOUD 是 dev/fake-cloud.mjs 的絕對路徑…` |
| phase-1 不退步 | (由改接後的 phase-1 場景負責:基準 phase-1 場景全走新 handler)丟棄式實作下 phase-1 場景全綠;`.feature` 沒改 | 綠 | — |
| **stubs 刪了,degraded-report 的登記還指著它** | 把 `NOT_INSTRUMENTED` 的 stubs 登記放回去(S01) | **存活(阻擋項 B1)** | `scripts/degraded-report.test.ts` 81 條全綠,沒有測試變紅 |

自選額外改壞(工單沒列):欄位型別 / 讀檔失敗不露例外原文(M18,12 條紅)、frontmatter 不去(M19)、submitting 不歸位(M20,12 條紅)、送出前沒清舊 gradingError(M21)、next 後 result 沒清(M22),全紅。

### 存活與弱點

- **B1(阻擋)· must_catch「stubs 刪了登記還指著它必須紅」沒有任何紅測試。** 現況:`scripts/degraded-report.ts` 的 `NOT_INSTRUMENTED` 對不存在的檔只會在報告印 `…:?(檔案不存在)`(`locateSnippet`),不會失敗;`degraded-report.test.ts` 沒有任何一條讀這張表(`degraded-intended.json` 的「登記過期」規則是另一張表)。把 stubs 的三筆登記放回去,81 條全綠。工單這條(719a32e,顧問 2026-10-17 補)比 t24-red 的基底 55bce62 晚,紅測試沒跟上。需要補一條:對真實 repo 的 `NOT_INSTRUMENTED` 每筆 file 必須存在、snippet 必須找得到(或 degraded-report 對不存在的檔退出非 0),基底上紅(登記還指著 stubs)。**這要由測試角色補(-e5 或我);補的時候要看實作側要不要改 `degraded-report.ts` 本身(目前它不執法,測試要紅就得有人讓它執法,這是工單範圍外的決定,請顧問裁)**。
- S04(`GET /__review` 也往返)存活:現有那條只斷言「不是 200 且 ok:true」,GET 若回協定錯誤的 JSON 也會過。「只收 POST」不在 must_catch;低。
- M09b(next 的 question 缺 progress 時改成走 done)存活:該條「question 缺 progress」靠「假 client 沒排 summary 的回應 → 丟錯 → 走錯誤畫面」碰巧過,沒有斷言 `summary` 沒被叫。低,但可以在那條 `it.each` 加 `expect(f.count('summary')).toBe(0)`。

## 6. 測試上的怪點(丟棄式實作的人與我都看到;建議,不是阻擋)

1. `dev/standalone.test.ts` 的「走完三張」「答案只落在暫存根」沒設 timeout;預設 5 秒要涵蓋 vault init + 側車冷啟動 + 往返,吃機器負載。建議兩條加 `, 60_000`(同檔其他條已是 120_000)。
2. `session.test.ts` 的「重新 init」那條 `it.each` 內有重複的 `expect(state).toBe('error')`,與一個恆真的 `if (where === 'next')`;不會誤判,只是多餘。
3. `no-stubs-static.test.ts` 對 `types.ts` 做字面比對,註解裡寫 `DueItem` 也被判紅。意圖是擋重複型別,字面上稍過度。
4. `no-stubs-static.test.ts` 的 `/read\s*[:(][^]*?throw/` 在整份 main.ts + App.svelte 任意位置找 `read` 後出現 `throw`,很鬆,量不到「fs.read 一律丟錯」。
5. 「重新載入頁面 = 新種子」是 T15 渲染量測要的隱含規格,工單 §5 沒寫,建議補進工單。
6. 實作側(給顧問):丟棄式實作把 `degraded-report.ts` 的 session.ts 登記(「due.types[…] ?? 'fill'」)一併刪了,工單只寫刪 stubs 的三筆;新寫的 session.ts 已不含那段程式。見 B1:現行的表不執法,所以刪或不刪都不會紅。

## 7. 全套與 learning/

- 全套 vitest(丟棄式實作在):198 檔 passed,4931 passed / 168 skipped,0 失敗。
- learning/ 前:64 檔 / c2e4dd6d71de3976 / 108 行;後:64 檔 / c2e4dd6d71de3976 / 108 行(三項相同)。

## 8. 花費

這張只有測試,沒有 LLM 花費(不准 live;假 router)。預算欄不適用。

## 9. 待補

- -e5 的第二個 commit(T22 phase-2 四個步驟定義:takes only review actions、message shape same on both sides、helper exited → new helper、fake grader only at start;基底綠、附改壞證明)到了再驗:4 個 undefined 場景轉成可跑、基底綠、改壞各自紅。
- B1 補測後重驗。

## 結論(第 1 輪)

第 1 輪有阻擋項 B1;已由 1a4ce5a 處理,見下一節。

---

# 第 2 輪:t24-red 新 tip 1a4ce5a

- 被驗:`t24-red` tip 1a4ce5a(55bce62 之上三個 commit:1e04a4b 第 1 輪驗過、5fb8ff8 T22 四個步驟、1a4ce5a B1 與裁決;中間夾 main 的 merge 25650a0)。tree sha 653cdd908b5b88df7510df1ec021f43e3b7f7e1d。本分支與 `t24-red` 內容相同,只多這份證據檔。
- `.feature` diff vs 55bce62:空。tsc 乾淨;boundaries PASS。
- 這一輪新增或改動的檔:`features/steps/test-card-phase2-sidecar.steps.ts`(新,+240)、`features/support/degraded-registry-rot.test.ts`(新,+32)、`apps/test-card/dev/standalone.test.ts`(+30/−19,逐處看過)、`packages/ui-shared/src/hud/card-render-test-support.ts`(+15/−1)。`scripts/degraded-report.ts` 的 4 行是 main 的 c89867a(刪腐爛登記)進來的,不是測試。

## 2.1 基準(沒有實作)

| 項目 | 結果 |
|---|---|
| vitest test-card + test-card-core + degraded-registry-rot | 154 條:**149 紅 / 5 綠**(第 1 輪是 148 紅 / 3 綠:新增的 3 條 registry-rot 基底綠;原本綠的「GET 不是往返」被收緊成紅) |
| 基底綠的 5 條 | registry-rot 3 條(基底上登記表是乾淨的,見下);`不碰 node:、不寫檔、不 fetch`;`App.svelte/session.ts 沒有 innerHTML/{@html`(「不准有」型守護,基底成立) |
| cucumber `@test-card and (@phase-1 or @phase-2) and not @manual` | 15 場景:**10 失敗 / 0 undefined / 5 綠**(第 1 輪是 10 / 4 undefined / 1 綠:T22 四個場景現在有步驟、基底綠;phase-1 的 5 個、phase-2 的 4 個原本就紅的場景仍紅,全是 `session.init is not a function`) |

## 2.2 5fb8ff8:T22 四個步驟(基底綠 4/4)

這四個測的是已合併的 T22,所以基底就綠;價值在於改壞 T22 會紅。步驟的做法:Node 側直接起 `scripts/review-sidecar.ts` 走 stdio,訊息形狀用 `protocol.ts`;Rust 側包既有 cargo 測試(`--exact`)並要求每個名字出現 `... ok`。`.feature` 字沒動。

我自己重做(用 `--name` 只跑該場景;失敗訊息已確認是**測試失敗**而不是編譯失敗):

| 改壞 | 結果與第一行訊息 |
|---|---|
| N1 · `protocol.ts` 的 `EmptyParams` 放寬為 passthrough(-e5 的 M1) | 紅:`start 帶 {"path":"/etc/passwd"} 不該被接受:{…"ok":true…}` |
| N2 · `protocol.ts` 的 `MAX_LINE_BYTES` ×2(M3) | 紅:`視窗側判決跟向量不一致:` |
| N3 · Rust `request_line` 不查版本(M4,要 cargo) | 紅:`cargo 測試沒過:… error: test failed, to rerun pass --test review_sidecar` |
| N4 · Rust `child_env` 發行版也帶測試變數(M9,要 cargo) | 紅:同上 cargo 測試沒過 |
| N5 · `review-sidecar.ts` hello 的 `fakeCloud` 恆 true(M8) | 紅:`hello 說這是假批改,但啟動時沒給變數` |
| N6 · 自選:Rust `id < 1` 改 `id < 0` | 紅:cargo 測試沒過 |
| N7 · 自選:Rust 不再要求 `params` 是物件 | 紅:cargo 測試沒過 |
| N9 · 自選:Rust 所有 `sidecar-exited` 改回 `timeout` | 紅:cargo 測試沒過(「helper exited」場景) |
| N8 · 自選:Rust 上限 `>` 改 `>=`(邊界) | **存活**。這四個場景的向量沒有量到剛好等於上限的那一行。同一個缺口 T22 驗收時已在 `review_sidecar_acceptance.rs` 補過,所以不是新洞;這四個場景不負責 |

沒做(-e5 列的):M2、M6、M7(M9 已做、N9 涵蓋 M6/M7 的 Rust 面)、M5。

## 2.3 1a4ce5a

- `features/support/degraded-registry-rot.test.ts`(3 條):基底綠。我的改壞(丟棄式實作在):
  - R1 登記檔名寫錯 → 紅 `每一筆的檔案都存在`
  - R2 登記指回已刪的 stubs → 紅 `每一筆的檔案都存在`
  - R3 登記的 snippet 搬走 → 紅 `每一筆的 snippet 都還在那個檔裡`
  - R4 表清到 0 筆 → 紅 `表不是空的(掃到 0 筆不算過)`
  - 第 1 輪 B1(放回 stubs 登記,81 條全綠)現在會紅 → **B1 解掉**。
- `standalone.test.ts`:13 處測試補 `120_000` timeout(逐處看了 diff,只動第二個參數,斷言不變);「GET 只收 POST」收緊成 404/405 且側車沒收到那一行(之後 `next` 回 `no-session`);「重新載入不會重新種子」取代舊的「重新載入=新種子」(對應工單 §5 修訂)。改壞:G1 GET 也往返 → 紅;G2 GET 回 200 → 紅;D1 重新載入時重新種子(把 block 放回)→ 紅。第 1 輪的 S04 存活已解。
- `card-render-test-support.ts`:`openCard` 對考試卡包一層,`reset()` = 先開新 app 再關舊的;其他卡走原路。逐處核:檔內 `expect`/`assert` 數 0 → 0(量尺的 `expect` 都在 `card-render-*.test.ts`,這輪沒動);量值門檻(顏色容差、像素數、位置容差)的常數都在 `card-design-values-test-support.ts`,這輪沒動;包裝只改「頁面怎麼重來」,不改任何量測函式。因為舊做法(重新載入頁面)會續答而不再從「剛載入的三題」開始,所以要關掉整個 app,這是跟著 §5 修訂而改,不是放寬。丟棄式實作下 T15 渲染測試 99/99 綠,證明包裝沒把量測弄壞。

## 2.4 丟棄式實作(第 2 輪)

把第 1 輪的丟棄式實作 cherry-pick 上來(不進 git、已丟)。它原本在「重新載入頁面」時換新種子,與修訂後的 §5 衝突,所以標準答案要拿掉那段才綠(D1 就是把那段放回去,會紅,正是這條測試要擋的)。

| 項目 | 結果 |
|---|---|
| vitest test-card + core + registry-rot | **154/154** |
| cucumber `@test-card and (@phase-1 or @phase-2) and not @manual` | **15/15 場景綠**,72/72 步驟(含 T22 的四個) |
| ui-shared `card-*` 渲染測試 | 99/99 |
| tsc、boundaries | 乾淨、PASS |
| 全套 vitest | 第 1 輪是 198 檔 4931 綠;這輪只動測試與一個支援檔,沒有再跑全套(只跑受影響的三組,見上) |

## 2.5 資料與花費

- learning/ 前:64 檔 / c2e4dd6d71de3976 / 108 行;後:64 檔 / c2e4dd6d71de3976 / 108 行(相同)。
- 無 LLM 花費(假 router、不 live)。

## 結論(第 2 輪)

通過。B1 已解;第 1 輪的兩個小存活(S04 GET 太鬆、M09b)中 S04 已解,M09b 仍低風險存活;N8(邊界)是 T22 已補過的缺口,不屬這張。
