# 驗收 T30:缺金鑰時 start 就說清楚、側車每次 start 重讀 .env 與重算今天

- 工單:T30(`../tickets/T30-missing-credential-and-daily-start.md`,ADR-076)
- 被驗分支:`t30-opencode` = fd2177a(起點 t30-start = 6915c3e;基底 5be60bd 加測試作者 -e5 的兩個 commit)
- 驗收開跑與跑完的 tree sha:`7914579d89ed12b9e178cb00458100c005b4f44d`(兩次相同,工作樹沒被動過;驗收用 worktree 乾淨簽出,`ls .env` → No such file)
- 日期:2026-10-18

## 重編

沒有 Rust 變動。cucumber 會用到的 lc-fs 產物沿用預先編好的(`apps/desktop/src-tauri/target/debug/lc-fs`,修改時間 2026-10-18 00:22,是 cucumber 的 `BeforeAll` 重編後的時間)。

## 基準(未突變)

| 範圍 | 結果 |
|---|---|
| vitest(T30 相關,50 檔) | 50 passed,1446/1446 |
| vitest 完整(輕量,`VITEST_MAX_WORKERS=1`) | **1 failed**,5276 passed,168 skipped(下面「阻擋項」) |
| Chrome:`packages/ui-shared/src/hud/card-render*.test.ts` | 26/26 |
| cucumber `(@test-card or @review-cli) and not @manual` | 57 場景:51 passed、0 failed、6 undefined(全是 06 phase-4,工單的 tag 沒排除它,phase-4 還沒做;基底也是) |
| `npm run boundaries` | PASS(納管 387 / 掃描 387) |
| `scripts/zero-input-guard.test.ts` | 761 passed,168 skipped |
| `npx tsc --noEmit` | 0 錯 |
| `npx tsx scripts/check-doc-links.ts --root <worktree>` | PASS |
| 其他呼叫 `envVarFor` 的地方(含 .mjs) | 只有 `router.ts` 與 `credentials.ts` 自己;沒有別處留舊的 |

## 測試作者

- 工單範圍的測試檔(`credentials.test.ts`、`t30-*.test.ts`、`review-session-harness.ts`、`t30-cloud-401.mjs`、`session.test.ts`、`protocol.test.ts`、`review.test.ts`)全部來自測試作者的兩個 commit(5242d90、56f355c)。
- 開發 worker 的兩個 commit(1956ef4、fd2177a)碰到的檔案:`.test.ts`、`.feature`、`.mjs`、`features/` 底下 0 個。無違規。

## 阻擋項(測試與工單互相矛盾,不是 worker 的錯)

**B1** `packages/ui-shared/src/hud/card-static.test.ts`「結果那一行…評分失敗不帶符號」在 t30-opencode 上紅;基底 5be60bd 綠。
失敗訊息原文:

```text
AssertionError: expected [ Array(1) ] to deeply equal []
+ [ "找不到「評分失敗,請再試一次」那一行(06 phase-1 照舊要有)" ]
```

原因:工單驗收 4 要求 `App.svelte` 不再寫死「評分失敗,請再試一次」、改顯示 `view.gradingError`;14-hud-skin 的量尺(`card-static-test-support.ts` 的 `resultMarkupProblems`)卻要求 `App.svelte` 的標記裡有那句字面。兩邊都照各自的規格做了,工單沒把這條既有測試列進「要改的那一條」。
這屬於測試端:要由測試作者改量尺(改成認 `<p class="error">` 帶 `{view.gradingError}` 或字面,仍要求不帶 data-result、不帶符號;`card-static-self.test.ts` 的自測片段跟著補)。「評分失敗,請再試一次」這句本身仍由 T30 的視窗測試守著(`status: "error"` 的字不變)。合併前要先修,否則整鏈多一條紅。

## `must_catch` 與自選突變

做法:在驗收 worktree 只改實作、不改測試,跑對應測試,必須紅,還原後工作樹乾淨。共 47 個,用 `scripts` 之外的暫存腳本逐個跑,每個只跑對應的測試子集。

| 組 | 數量 | 結果 |
|---|---|---|
| credentials.ts:anthropic 鍵錯、預設改要雲端鍵、空字串算有設、不走 cause、cause 只看 1 層、閘道 401→403、雲端 401→403、鍵名不限三個、被拒/缺訊息沒鍵名、雲端 401 鍵固定 openai | 11 | 全紅 |
| _env.ts:LC_REVIEW_ 可從檔案設、環境優先被蓋、刪鍵不刪、改值不套用、回傳恆 false、讀不到就丟錯、只重讀一次 | 7 | 全紅 |
| _env.ts:第二迴圈不查 preset | 1 | 存活,等價(從檔案設的鍵集合本來就不含 preset 的鍵) |
| handler.ts:reload 不丟 router、今天只算一次、不查缺鍵、缺鍵不清 session、submit 不重讀、submit 不換 router、submit 不認憑證、憑證錯清 session、缺鍵取最後一個、字串 today 也重算、start 不重算今天、start 不重讀 | 12 | 全紅 |
| review-sidecar.ts:不傳 reloadEnv、不傳 missingKeys、今天算死、忽略固定日 | 4 | 全紅 |
| review.ts:不查鍵、缺鍵 exit 1、答題憑證錯 exit 1、答題憑證錯不認 | 4 | 全紅 |
| session.ts / App.svelte(視窗):submit 沒提示、submit 憑證錯走 showError、start 憑證錯走「停了」、start 沒「再試一次」、畫面寫死評分失敗 | 5 | 全紅 |
| credentials.ts 的 settings 後備(`cloud_provider`),以 `packages/core/src/llm` 全部測試跑 | 1 | **存活**:拿掉 `settings.cloud_provider` 這條後備,582 條全綠。這條搬家前就沒有專屬測試(router 的 settings 路徑沒人測),不是 T30 新增的行為;低 |
| credentials.ts 的 env 優先、settings 未給時回空字串 | 2 | 紅 |

工單 `must_catch` 逐條對應:缺鍵 start 回 ready(H3)、要哪個鍵(C1、C2)、不打網路(測試直接把 fetch 換成會丟錯的,沒有突變能讓它紅,不列)、訊息帶鍵名/不帶值(C8、C10)、重讀 .env(H1、H5、H6、H12、E3、E4、E5、E8)、重讀不改啟動環境(E2)、LC_REVIEW_ 不從檔案設(E1,硬條件)、舊 router(H1、H6)、submit 憑證錯誤回 credential-unavailable(H7、C4、C5、C6、C9、C11)、session 不清(H8)、視窗(W1–W4、A1)、終端機(RV1–RV4)、每次 start 重算今天(H2、H11)、固定日期不變(SC3、SC4)。「進行中不換日」由 H2 這類突變加 `roundDay` 測試守著。

## 非阻擋發現

**F1(低)`status` 在 `start` 之前被叫會回 `internal`**(退步)。側車沒設 `LC_REVIEW_TODAY` 時 `today` 是函式,`day()` 在第一次 `start` 之前沒有值就丟錯;T22 時 `status` 在 start 前回 `{paused, today}`。我用暫存腳本證明:`today` 給字串 → `ok`,給函式 → `internal`。視窗目前沒有呼叫 `status`(只有 ReviewClient 的介面有),所以使用者看不到;Stryker 的存活(handler.ts 的 `if (typeof deps.today === 'string')` 與 `if (roundDay !== undefined)`)也指向同一個洞:沒有任何測試在 start 前叫 status 並用函式 today。建議:`day()` 沒有值時改回 `deps.today()` 現算一次(不鎖),並補一條測試。

**F2(低)** `scripts/review.ts` 主流程 catch 裡「其他錯誤」那兩行(印原訊息、exit 1)沒有測試(Stryker 存活 2 個);是舊程式。

**F3(低)** `credentials.ts` 的 `credentialMessage` 對不認得的輸入丟錯、`isProblem` 的各個檢查沒有測試(Stryker 存活約 13 個)。呼叫端只傳 `credentialProblem` 的回傳值,所以是死的防禦;建議測試補一條「丟錯」或之後刪掉防禦。

## 變異測試(Stryker CLI,經 `npm run mutate`,唯一入口,拿 `.stryker.lock`)

指令形:`npm run mutate -- <設定檔>`,設定檔都是 `testRunner: command`、`coverageAnalysis: off`、`concurrency: 2`、`timeoutMS: 300000`,測試指令 `MUTATE_TEST_GLOB='<glob>' VITEST_MAX_WORKERS=1 npx vitest run --bail=1 --config vitest.mutate.config.ts`。

| 範圍(mutate) | 測試 glob | 變異數 | 殺掉 | 存活 | 分數 |
|---|---|---|---|---|---|
| `packages/core/src/llm/credentials.ts` | `packages/core/src/llm/credentials.test.ts`、`features/support/t30-handler.test.ts` | 154 | 118 | 36 | **76.62%** |
| `scripts/_env.ts` | `features/support/t30-env.test.ts` | 34 | 31 | 3 | **91.18%** |
| `packages/core/src/session/handler.ts` | `scripts/review-handler.test.ts`、`packages/core/src/session/*.test.ts`、`features/support/t30-handler.test.ts`、`features/support/test-card-phase3-core.test.ts` | 307 | 254 | 53 | **82.74%**(T23 時 78.21%) |
| `apps/test-card/src/session.ts` | `apps/test-card/src/session.test.ts` | 578 | 511 | 67 | **88.41%**(T23 時 88.06%) |
| `scripts/review.ts` 只算 T30 的行(83–97、269–277) | `features/support/t30-cli.test.ts`、`scripts/review.test.ts` | 23 | 16 | 7 | **69.57%** |

- `t30-static`、`t30-sidecar` 與 `phase3-static` 這類會讀原始碼的測試不放進 glob(儀器化會改掉原始碼,初始跑會紅)。
- `session.ts` 的存活全在舊程式;T30 新增的行(提示字樣、憑證分支)沒有存活。
- `handler.ts` 新增行的存活只有:`today` 為字串的預設值與 `day()` 沒值時的丟錯(F1)、start 缺鍵後備的兩行(`credentialLine` 認不得時的後備,不可能走到,等價)、submit 的 `router === undefined` 判斷(`ensureRouter` 有快取,等價)。
- `_env.ts` 的 3 個存活:`value === undefined`(`parseEnv` 只回字串,走不到)、第二迴圈的 preset 檢查(等價)、`hasOwnProperty` 檢查(等價)。
- `credentials.ts` 的 36 個存活大多是 `resolveProviderName` 的 settings 後備(沒測,見上)、`name`/`instanceof` 兩條認法擇一(真錯誤兩個都成立)、cause 迴圈的 `seen`/邊界、`isProblem` 與 `credentialMessage` 的防禦。沒有一個會讓缺鍵或 401 認錯。
- 摘要在 `reports/mutation/fd2177a-t30-*.json`。

## 使用者資料前後

`learning/`(唯讀量):前後都是 64 個檔、雜湊 `c2e4dd6d71de3976`、帳本 108 行。不變。這張的測試都用暫存目錄,沒有碰真的 learning/。

## 報告與守門

- worker 報告 `docs/reviews/T30-report.md`:沒有真實 learning 路徑、沒有卡片內容(只有帳本檔名那個固定名字);「待協調」為空。
- 新增的 `.ts` 只有 `packages/core/src/llm/credentials.ts`(已納管)。

## 花費

worker 實際 $5.56,預算 $5,比值 1.11(沒超過 2 倍;只記錄,grok 不設上限)。驗收:LLM 0;主要是 CPU(完整 vitest 12 分鐘、Stryker 約 29 分鐘、突變 47 個約 25 分鐘)。

## 結論

有阻擋項(B1:14-hud-skin 的 `card-static` 量尺與工單矛盾,要測試作者改;修好後其餘全部通過)。實作本身沒有發現會讓 must_catch 漏接的洞;F1 是低風險的退步,建議順手修。

## 第二輪(被驗 t30-opencode = 18199f6,基底 fd2177a)

- tree sha(開跑與跑完相同):`46387eeb9231a316c901993a894900f98b30a49d`;`ls .env` → No such file。
- 測試作者:fd2177a..18199f6 的測試檔全部來自 -e5 的 p14-gradingerror(96e08b4、e9e9723:`features/support/t30-handler.test.ts`、`card-static.test.ts`、`card-static-self.test.ts`、`card-static-test-support.ts`、`card-static-samples-test-support.ts`);worker 的 18199f6 只改 `handler.ts` 一行與 `docs/reviews/T30-report.md`,0 個測試檔。
- 單跑 B1+F1(24 檔):Test Files 24 passed (24);Tests 508 passed (508)。
- 完整輕量 vitest:Test Files 208 passed (208);Tests 5295 passed | 168 skipped (5463)。第一輪的 B1(card-static 那條)已消失,沒有新紅。
- 丟棄式改壞(還原後工作樹乾淨):
  - 拿掉 `handler.ts` 新增那一行 → 紅 3 條(`t30-handler.test.ts` 的三條 F1:start 前 status 回 ok / 不鎖日 / 不影響之後 start)。
  - `session.ts` 的 `GRADING_ERROR` 前面加 ✓ → 紅 2 條在量尺(`card-static.test.ts` 的「評分失敗那行的字從 session.ts 來…兩個常數的值都沒有 ✓」、`card-static-self.test.ts` 的「真的 session.ts 的常數讀得到」),視窗的 `session.test.ts` 另紅 7 條。
- 變異測試:F1 那一行只有 3 條專屬測試,上面改回去就紅,不重跑 Stryker CLI(`handler.ts` 第一輪 82.74%,新增這行沒有新的存活條件)。
- `npx tsc --noEmit` 0 錯;`npm run boundaries` PASS(scanned=331)。
- `learning/` 前後:64 個檔、`c2e4dd6d71de3976`、108 行,不變。
- 結論:第一輪阻擋項 B1 與 F1 都已解決;沒有新問題。
