---
id: T13
deps: []
touches: [scripts/review.ts, scripts/grade.ts, packages/core/src/session/build.ts, packages/core/src/session/summary.ts, packages/core/src/grading/index.ts, packages/core/src/grading/fake-llm.ts, packages/contracts/src/witness.ts, scripts/degraded-report.ts, scripts/boundaries.allow.json, features/05-grading/FEATURE.md]
cpu: light
budget_usd: 4
status: merged
owner: worker-grok
must_catch:
  - buildTodaySession 沒給 router 時悄悄退回 fake(或 router 又變成選填、執行期不擋)
  - review.ts 互動模式在指標檔不存在或身分標記不符時照常進行(退回 fake、退回預設帳本位置)
  - review.ts --dry-run 也要求指標檔(standalone.json 的 11-review-cli 會紅)
  - grade.ts 的第一、二層(exact、fuzzy)也要求指標檔(standalone.json 的 05-grading 會紅);或第三層沒有指標檔卻仍然評分
  - 應用題評分的 grader 沒記成 cloud(reviews.json 最後一筆不是 cloud),或帳本沒有 grade.apply 的 llm_call
  - 批改錯誤(雲端連兩次回無法解析)時卡片被動到:stage、next_due、history、fails_in_row 任一個變了
  - 批改錯誤時雲端被問的次數不是剛好 2(沒重試,或重試沒有上限)
  - 填空題在 exact / fuzzy 能判定時呼叫了 LLM(雲端被問、或帳本多出 llm_call)
  - 到期超過 daily_cap 卻沒報「N 張延後」;或沒有延後卻也印出那一行
  - 0 張卡的檢查被排到帳本檢查之後(沒有指標檔時 0 張卡變成退出碼 2,不是 1)
  - grading/fake-llm.ts 刪了、index.ts 的匯出還在;或入口與 build.ts 留著 FakeLlmRouter / contracts/fixtures/llm 的引用
  - 見證訊號 session.router-default-fake 還登記在 witness.ts(死訊號,報告會列出一個沒有 witness() 呼叫的條目)
---

# 工單 T13:I2 整合工作——複習迴圈接上真的 router,移除 Wave 0 的 fake

> 狀態:草稿,待技術顧問審(派令來自顧問 2026-10-15)。**這是整合接線,不是取捨;不寫 ADR。**
> 作者:統籌·契約(測試 agent 身分寫紅測試)。派工:協調者。驗收:-ed。
> 這份檔是工單唯一的正本。

## 起因

I2 的 5 個 phase 都 `done`,但「整合工作」沒做(協調者在 63e4dc6 上量的):

- `scripts/review.ts`、`scripts/grade.ts` 與 `packages/core/src/session/build.ts`(沒給 router 時的預設)都還在用 05 的 `FakeLlmRouter`
  ——也就是說應用題是被預錄的 fixture「批改」,從來沒走過 03 的雲端 router;
- `docs/integration/i2-review-loop-headless.feature` 的 14 個非 `@manual` 場景裡,12 個沒有步驟定義。

05 的 FEATURE.md 早就寫好了:`FakeLlmRouter` 是「整合時移除於 I2(改用 03)」的 Wave 0 重複。這張工單就是那一步。

## 要求

### (a) 複習迴圈改用真的 router

1. **`buildTodaySession` 的 `router` 必填**:型別上必填(`BuildSessionCtx.router` 去掉 `?`),**執行期也擋**——沒給或是 `undefined` 就丟錯,
   訊息含 `router`(JS 呼叫端與 `as never` 都過得了型別)。刪掉預設的 `FakeLlmRouter`、`LLM_FIXTURES_DIR` 與見證訊號 `session.router-default-fake`
   (連同 `witness.ts` 的登記、`build.ts` 裡所有提到 FakeLlmRouter 的註解)。
2. **`scripts/review.ts` 互動模式**用「帳本驗證過的路徑」組 router,檢查順序(早的先擋):
   1. 參數不全 → 既有的用法錯誤(退出碼 1);
   2. **磁碟上 0 張卡 → 既有的「沒有卡片」(退出碼 1)**,**早於**帳本檢查(沒有指標檔時也是 1,不是 2);
   3. 互動模式(不是 `--dry-run`):`resolveVerifiedLedger(defaultVaultDeps())`,`!ok` → 把 `message` 印到 stderr、**退出碼 2**,不建 session、不動任何檔;
      **不管今天有沒有卡到期都先查**(快速失敗);
   4. `ok` → `createLiveGatewayRouter({ ledger })`(與 `scripts/llm.ts` 同一條真呼叫路),交給 `buildTodaySession`。
3. **`--dry-run` 不需要指標檔、不建 router**:它只讀、不評分、不花錢,`standalone.json` 的 `11-review-cli` 就是這樣跑的。
   給 `buildTodaySession` 一個「被呼叫就丟錯」的 router(dry-run 永遠不會評分)。
4. **`scripts/grade.ts --fill`**:router 是**惰性**的——第一、二層(exact、fuzzy)從不碰它,沒有指標檔、沒有網路也照常
   (`standalone.json` 的 `05-grading` 就是這樣跑的);**要用到第三層才**解析帳本:`!ok` → 印 `message`、退出碼 2;`ok` → 同上的 `createLiveGatewayRouter`。
5. **延後張數**:到期的卡超過 `daily_cap` 時,`--dry-run` 與互動模式開頭都印一行含 `N 張延後` 的訊息(`N = session.deferred`,
   建議 `其餘 N 張延後(今日上限 CAP)。`;測試只釘 `(\d+)\s*張延後` 的 N,以及 `N = 0` 時整行不出現)。
   目前 CLI 完全沒報這個數字,feature 的「the remaining 5 are reported as deferred」沒有東西可驗。

### (b) 移除 Wave 0 的 fake

6. 刪 `packages/core/src/grading/fake-llm.ts`,拿掉 `grading/index.ts` 的匯出,`FEATURE.md`(05)的「Wave 0 的重複」表那一列標「已移除(T13,I2 整合)」。
7. `scripts/degraded-report.ts` 裡指向那個檔案的「反例」條目拿掉;`scripts/boundaries.allow.json` 裡提到 FakeLlmRouter 的 `reason` 改成現況,
   並補上 `scripts/review.ts`、`scripts/grade.ts` 對 03 的 import 所需的例外(照 `scripts/llm.ts` 現有的條目與措辭)。
8. **測試不歸你改**:所有用到舊 `FakeLlmRouter` 的測試與步驟已經由測試 agent 改成**注入假的 `CloudAdapter`**
   (`features/support/fixture-router.ts`:真的 `CloudLlmRouter` + 重播預錄 fixture 的 adapter;`fake-llm.test.ts` 的 12 條已搬過去並加 3 條)。
   你只刪實作。如果有測試因為你的實作而必須改,**停下來回報,由測試 agent 改**。

## 設計裁決(請顧問確認的,標明是推論)

- **router 用 `createLiveGatewayRouter({ ledger })`,不是裸的 `CloudLlmRouter`。**(推論)派令寫 `CloudLlmRouter`,但裸 `CloudLlmRouter` 沒有「只收驗證過的帳本」這層型別,
  也沒有 ADR-039 的閘道回退與日上限檢查;`scripts/llm.ts` 的真呼叫就是 `createLiveGatewayRouter`,它裡面包的 `LlmRouterImpl` 用的就是 `CloudLlmRouter`。
  **測試與這個選擇無關**:CLI 層的測試在最外層網路邊界造假(`fetch`),`CloudLlmRouter` / `GatewayLlmRouter` 哪一個都過。顧問要改成別的,只動實作。
- **`--dry-run` 與 `grade.ts` 前兩層不要求指標檔**(推論)。理由:`standalone.json` 的兩條指令都不帶指標檔,而且兩者都不花錢;
  要求就會讓「每個功能能單獨跑」(CLAUDE.md)破功。
- 延後那一行的措辭是建議值,不是契約。

## 不在範圍

- `docs/integration/i2-review-loop-headless.feature` 的 `@manual` 場景(「A person actually uses it for a week」)——人眼確認,顧問判。
- 只動「迴圈裡的 fake」。`ingest/fake-llm.ts`、`prompt-quality/fake-llm.ts`(`--fake` 旗標與 golden 的 fake 模式用它,是明確要求才用的選項)**不動**。
- 不改 `contracts/` 硬約定。不跑 `--live`、不花錢、不碰真的 `learning/`。

## 驗收條件

1. `npx tsc --noEmit -p .` 0 錯。
2. 測試全綠,且**測試檔一個字都沒改**(`git diff <基底>..HEAD -- '*.test.ts' features/` 只有刪除實作造成的 0 行):
   - `npx vitest run packages/core/src/session scripts/review-router.test.ts features/support`
   - `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@integration and @i2 and not @manual'`:**15 個場景全過**(含兩個原本就有的 `@regression`)。
3. 既有的測試仍綠:`packages/core/src/grading`、`packages/core/src/session`、`scripts/degraded-report.test.ts`、`packages/contracts`、
   cucumber 的 `@grading`、`@review-cli`(舊的重播 router 已換成注入假 adapter,行為與斷言不變)。
4. `npm run boundaries`、`npm run check:step-dup`、`npm run check:gherkin-dup`、`npm run lint:docs`、`npm run check:module-cast` 通過。
5. `git grep -n "FakeLlmRouter" -- scripts/review.ts scripts/grade.ts packages/core/src/session packages/core/src/grading` 沒有結果;
   `git grep -n "router-default-fake" -- packages/contracts scripts packages/core/src/session` 沒有結果。
6. 真的 `learning/` 前後不變(顧問裁定的唯一量法,基準 **64 個檔 / `c5aa80b18b474ed4` / 帳本 52 行**,前後各量一次、只記數字)。
7. 驗收(-ed)另外跑:`grading` 前兩層(`normalize.ts`、`fuzzy.ts`、`grade-fill.ts`)的 Stryker——**嚴格級 95%**。這張工單沒有改它們,
   但「前兩層沒被動到」要靠分數證明,不靠口頭;`session/build.ts` 走標準 80%。

## 測試誰寫(已寫好,分支 `t13`)

在 base(`origin/main` 63e4dc6)上:`tsc` 0 錯;**紅**:

| 測試 | 檔案 | base 上 | 紅的原因 |
|---|---|---|---|
| router 必填(4 條,第 5 條「session.router 就是給的那一個」本來就綠) | `packages/core/src/session/build.test.ts` | 4 紅 | 沒給 router 時悄悄用 fake;`build.ts` 還引用 FakeLlmRouter |
| CLI 帳本檢查與延後行、grade.ts 第三層、原始碼與檔案已移除 | `scripts/review-router.test.ts` | 8 紅 / 6 本來就綠 | 沒有指標檔仍進行(退出碼 ≠ 2);沒有「N 張延後」;`grade.ts` 第三層用 fake;fake 檔案還在 |
| 「Apply answers are graded against the rubric」 | `docs/integration/i2-review-loop-headless.feature` | 紅 | CLI 評分時丟「沒有錄製 task=grade.apply 的 fixture」 |
| 「Grading works without any fake in the loop」 | 同上 | 紅 | 同上 |
| 「The daily cap is respected and the rest defer」 | 同上 | 紅 | 輸出沒有「N 張延後」 |
| 「A grading error leaves the card untouched」 | 同上 | 紅 | 同「Apply answers」:CLI 在評分時當掉(退出碼 1),沒有走到「批改失敗」小結 |

本來就綠的(**測的是既有行為,不是這張工單才有的**):I2 的其餘 11 個場景(含 2 個 `@regression`)——排程、題型、填空短路、最脆弱先問、reteach 不占名額、
中斷續做、內容管線——它們走真的 CLI 或 session 模組,是 I2 迴圈的整合回歸網,不是這張工單的紅。
**哪些是紅、哪些本來就綠,以這張表為準,不要自己重判。**

丟棄式實作(約 40 行,**不進 git**)讓以上全部轉綠:vitest 333 條(session + review-router + support + degraded-report + contracts + grading)、
I2 的 15 個場景、全部 cucumber(759 個場景:521 過、238 個是各 phase 尚未定義步驟的既有狀態、0 失敗)。

- 開發 agent(worker-grok):只寫上面 (a)(b) 的實作與文件。**不改測試**,不跑變異測試,不跑 `--live`。
- 驗收(-ed):照 `worker-acceptance`;`must_catch` 逐條做突變;grading 前兩層 Stryker 95%。

### 測試怎麼不花錢又走真的路(給驗收的人看)

- 子程序(`review.ts`)的網路層由 `features/steps/_fake-review-cloud.mjs` 換成假的(照 `_fake-cloud.mjs` 的模式:`CloudLlmRouter`、openai adapter、OpenAI SDK 全跑真的,
  只換最外層 `fetch`)。回應腳本在 `features/steps/_i2-cloud-script.ts`,**作答文字裡的標記**(`PASSALL` / `FAILONE` / `GARBAGE` / `LONGFEEDBACK`)決定回什麼。
- 每個場景在暫存目錄寫一份指標檔與身分標記(`XDG_CONFIG_HOME` 指過去),所以 `resolveVerifiedLedger` 是真的被走過的,不是被繞過的。
- 程序內的評分(填空、session 建構)注入假的 `CloudAdapter`;`scripts/review-router.test.ts` 的 XDG 一律指到暫存目錄,讀不到真的指標檔。
- 沒有任何一步打真網路或花錢;真的 `learning/` 與 `contracts/fixtures/llm/` 不被搬動、不被寫入。

## 預算

`budget_usd: 4`(草估,grok;無 $ 上限只記錄)。實際超過 2 倍要在報告標出。
