# T33 實作報告:13-work-dag phase-1

日期:2026-10-19。模型:Grok 4.7(xai/grok-4.7)。
開工 HEAD:`5eab1c8`(Merge t33-red into t33-start;origin/main `d397537` + 紅測試)。實作 commit:`e6b7a15`。
本報告是接著的 commit(提交時還不在下面的 log 裡;提交後 porcelain 空)。
session id:`ses_eace72e1dffecbOUoQ7b7zGN8t`。
API key:`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`XAI_API_KEY` 都是 `UNSET`。`.env` 不存在(`ls .env` → No such file)。`opencode.json` 的 `permission.skill` 是 `{"*":"deny"}`。開工 `git status --porcelain` 空。
沒有跑變異測試、`npm run check:all`、tauri、完整 cucumber。cucumber 只用 `--tags '@work-dag and @phase-1 and not @manual'`(工單寫的 `@work-dag and not @manual` 會把 phase-2 沒有步驟定義的場景也選進來,派工改過)。重活用協調者派工時給的位子,`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`,同一時間只有一個。LLM 真呼叫:0。不寫 ADR。沒有改測試檔、`.feature`、fixtures、Rust、contracts、`scripts/check-next-gates.ts`、任何 NEXT.md 或 FEATURE.md。

## 做法

新檔 `scripts/dag.ts`。只 import `node:` 模組,自己解析 markdown,不讀 `scripts/check-next-gates.ts`。CLI 是 `npx tsx scripts/dag.ts --root <樹>`:用法錯誤退出碼 2,其餘(含 PROBLEM)退出碼 0。不寫任何檔。git tag 用 `git -C <root> tag --list`;不是 git 工作樹就當沒有 tag,不把 git 的訊息印出來。

登記:`scripts/boundaries.owners.json` 加 `scripts/dag.ts` → `13-work-dag`(`scripts/dag.test.ts` 那四行沒動)。`scripts/zero-input-roster.ts` 把 `scripts/dag.ts` 登記成 entry,四種探針都是真的跑 CLI(空目錄、根不存在、FEATURE.md 是目錄、`--root` 指到檔案),不是 excluded。`standalone.json` 加鍵 `13-work-dag`,`expect` 是 `gate=dag`。

CLI 只掃 `features/` 底下名字以兩位數字加連字號開頭的子目錄(規格的 `features/<NN-name>/`)。`steps`、`support`、`_template` 不是功能資料夾,不進圖。

## git log

起點 `5eab1c8`。

```text
e6b7a15 feat(T33): scripts/dag.ts 從 FEATURE、NEXT、I<N> tag 算出工作圖
```

不屬於測試作者 commit 的測試檔變動:空。`git diff --name-only 5eab1c8..e6b7a15` 對 `*.test.ts`、`features/steps`、`features/support`、`*.feature`、fixtures 沒有輸出。受保護的 `scripts/dag.test.ts`、`features/steps/work-dag.steps.ts`、`features/13-work-dag/phase-1.feature`、`features/13-work-dag/fixtures/` 沒改。

## git diff --stat

`git diff --stat 5eab1c8..e6b7a15`(實作 commit,不含本報告):

```text
 scripts/boundaries.owners.json |   4 +
 scripts/dag.ts                 | 650 +++++++++++++++++++++++++++++++++++++++++
 scripts/zero-input-roster.ts   |  24 ++
 standalone.json                |   5 +
 4 files changed, 683 insertions(+)
```

加上本報告後,`5eab1c8..HEAD` 預期 5 檔:上面四個,加 `docs/reviews/T33-report.md`。

## git status --porcelain

提交本報告後 `git status --porcelain` 沒有輸出(空)。

## learning/ 量測

只量不改。開工與收工相同。量的是主簽出的 learning/,沒有讀、寫、刪那裡的檔,也沒有碰 raw/。

| | sha256 前 16 | 檔數 | state/log.jsonl 行數 |
|---|---|---|---|
| 開工 | c2e4dd6d71de3976 | 64 | 108 |
| 收工 | c2e4dd6d71de3976 | 64 | 108 |

## 測試

`scripts/dag.test.ts` 先量到紅(檔還不存在時是載入失敗;寫完第一版後剩 1 紅:只有表頭、沒有資料列的資料夾沒報 `no-phase-table`)。補上之後:

```text
 Test Files  1 passed (1)
      Tests  132 passed (132)
   Start at  16:02:36
   Duration  9.24s (transform 214ms, setup 113ms, import 119ms, tests 8.82s, environment 0ms)
```

派工指定的 tag(不是工單正文那條會把 phase-2 選進來的 tag)。解析 shorthand 改完之後重跑,與最終程式一致:

```text
34 scenarios (34 passed)
181 steps (181 passed)
0m12.392s (executing steps: 0m10.871s)
```

`npx tsc --noEmit` 退出碼 0。

`npm run boundaries`:

```text
boundaries: 掃描 338 個檔案,允許例外 21 條
涵蓋:納管 394 / 掃描 394 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=338
```

`scripts/boundaries.test.ts` 這個路徑不存在,vitest 沒有把它算進 Test Files。守門是上面的 `npm run boundaries`。

派工那條三個檔的 vitest(實際跑到兩個存在的檔):

```text
 Test Files  2 passed (2)
      Tests  907 passed | 171 skipped (1078)
   Start at  16:04:29
   Duration  61.46s (transform 127ms, setup 48ms, import 131ms, tests 61.06s, environment 0ms)
```

`npx vitest run scripts/zero-input-guard.test.ts` 單跑:

```text
 Test Files  1 passed (1)
      Tests  775 passed | 171 skipped (946)
   Start at  16:07:08
   Duration  111.01s (transform 584ms, setup 206ms, import 577ms, tests 109.78s, environment 0ms)
```

`npx tsx scripts/dag.ts --root features/13-work-dag/fixtures/basic` 退出碼 0:

```text
READY 01-alpha/phase-2
BLOCKED 01-alpha/phase-3 by 01-alpha/phase-2
BLOCKED 02-beta/phase-2 by 01-alpha/phase-3
```mermaid
graph TD
    "01-alpha/phase-1" --> "01-alpha/phase-2"
    "01-alpha/phase-2" --> "01-alpha/phase-3"
    "01-alpha/phase-3" --> "02-beta/phase-2"
```
gate=dag result=OK ready=1 blocked=2 human=0 problems=0
```

`npx tsx scripts/check-standalone.ts --only 13-work-dag`:

```text
✓  13-work-dag  (831 ms)
全部通過
gate=standalone result=PASS scanned=1
```

沒跑 `npm run accept:standalone`(那是 `@standalone and not @manual` 的完整 cucumber,派工說不跑)。也沒跑完整 `npm run standalone`:條目裡的 `llm.ts --probe` 會打網路,派工不准 live。見待協調。

`npx tsx scripts/check-doc-links.ts` 與 `npm run lint:docs`(同一支腳本)在本報告寫入後:

```text
doc-links: 掃描 205 個 markdown 檔,124 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=124
```

## 真 repo 煙霧

`npx tsx scripts/dag.ts --root .` 退出碼 0,stderr 空,沒有 `Error`、沒有 stack trace。git tag 只有 `I1`。全文:

```text
READY 02-ingest-pipeline/phase-3 (table says todo)
READY 07-teach-card/phase-4 (table says todo)
READY 13-work-dag/phase-1
BLOCKED 05-grading/phase-3 by 03-llm-router/phase-3,I5
BLOCKED 06-test-card/phase-4 by 05-grading/phase-3,I4
BLOCKED 07-teach-card/phase-3 by 07-teach-card/phase-2
BLOCKED 08-weekly-goal/phase-2 by 07-teach-card/phase-2,I4
BLOCKED 09-lint/phase-2 by 03-llm-router/phase-3,05-grading/phase-3,I5
BLOCKED 10-desktop-shell/phase-3 by I4
BLOCKED 10-desktop-shell/phase-4 by 10-desktop-shell/phase-3,I6
BLOCKED 10-desktop-shell/phase-5 by 10-desktop-shell/phase-4,I7
BLOCKED 13-work-dag/phase-2 by 13-work-dag/phase-1
HUMAN 03-llm-router/phase-3 decision ADR-037
HUMAN 03-llm-router/phase-3 decision ADR-039
HUMAN 05-grading/phase-3 decision ADR-037
HUMAN 07-teach-card/phase-2 decision ADR-073
HUMAN 13-work-dag/phase-2 decision ADR-065
```mermaid
graph TD
    "01-data-layer/phase-1" --> "01-data-layer/phase-4"
    "01-data-layer/phase-2" --> "02-ingest-pipeline/phase-2"
    "01-data-layer/phase-2" --> "11-review-cli/phase-1"
    "01-data-layer/phase-3" --> "02-ingest-pipeline/phase-2"
    "01-data-layer/phase-3" --> "07-teach-card/phase-2"
    "01-data-layer/phase-4" --> "11-review-cli/phase-2"
    "02-ingest-pipeline/phase-1" --> "02-ingest-pipeline/phase-2"
    "02-ingest-pipeline/phase-2" --> "02-ingest-pipeline/phase-3"
    "02-ingest-pipeline/phase-2" --> "02-ingest-pipeline/phase-4"
    "02-ingest-pipeline/phase-2" --> "07-teach-card/phase-3"
    "03-llm-router/phase-1" --> "03-llm-router/phase-2"
    "03-llm-router/phase-1" --> "12-prompt-quality/phase-2"
    "03-llm-router/phase-2" --> "02-ingest-pipeline/phase-2"
    "03-llm-router/phase-2" --> "03-llm-router/phase-3"
    "03-llm-router/phase-2" --> "03-llm-router/phase-4"
    "03-llm-router/phase-2" --> "05-grading/phase-2"
    "03-llm-router/phase-2" --> "07-teach-card/phase-3"
    "03-llm-router/phase-3" --> "05-grading/phase-3"
    "03-llm-router/phase-3" --> "09-lint/phase-2"
    "04-scheduler/phase-2" --> "04-scheduler/phase-3"
    "04-scheduler/phase-2" --> "05-grading/phase-3"
    "05-grading/phase-1" --> "05-grading/phase-2"
    "05-grading/phase-2" --> "05-grading/phase-3"
    "05-grading/phase-2" --> "06-test-card/phase-2"
    "05-grading/phase-2" --> "11-review-cli/phase-1"
    "05-grading/phase-3" --> "06-test-card/phase-4"
    "05-grading/phase-3" --> "09-lint/phase-2"
    "06-test-card/phase-1" --> "06-test-card/phase-2"
    "06-test-card/phase-1" --> "14-hud-skin/phase-2"
    "06-test-card/phase-2" --> "06-test-card/phase-3"
    "06-test-card/phase-2" --> "14-hud-skin/phase-2"
    "06-test-card/phase-3" --> "06-test-card/phase-4"
    "06-test-card/phase-3" --> "08-weekly-goal/phase-2"
    "06-test-card/phase-3" --> "14-hud-skin/phase-2"
    "07-teach-card/phase-1" --> "07-teach-card/phase-2"
    "07-teach-card/phase-1" --> "07-teach-card/phase-4"
    "07-teach-card/phase-1" --> "14-hud-skin/phase-2"
    "07-teach-card/phase-2" --> "07-teach-card/phase-3"
    "07-teach-card/phase-2" --> "08-weekly-goal/phase-2"
    "07-teach-card/phase-2" --> "14-hud-skin/phase-2"
    "08-weekly-goal/phase-1" --> "08-weekly-goal/phase-2"
    "09-lint/phase-1" --> "09-lint/phase-2"
    "10-desktop-shell/phase-1" --> "10-desktop-shell/phase-2"
    "10-desktop-shell/phase-2" --> "06-test-card/phase-2"
    "10-desktop-shell/phase-2" --> "07-teach-card/phase-2"
    "10-desktop-shell/phase-2" --> "10-desktop-shell/phase-3"
    "10-desktop-shell/phase-2" --> "10-desktop-shell/phase-6"
    "10-desktop-shell/phase-3" --> "10-desktop-shell/phase-4"
    "10-desktop-shell/phase-4" --> "10-desktop-shell/phase-5"
    "11-review-cli/phase-1" --> "11-review-cli/phase-2"
    "11-review-cli/phase-2" --> "11-review-cli/phase-3"
    "12-prompt-quality/phase-1" --> "12-prompt-quality/phase-2"
    "12-prompt-quality/phase-2" --> "02-ingest-pipeline/phase-4"
    "13-work-dag/phase-1" --> "13-work-dag/phase-2"
    "14-hud-skin/phase-1" --> "14-hud-skin/phase-2"
    "14-hud-skin/phase-2" --> "10-desktop-shell/phase-6"
    "I1" --> "02-ingest-pipeline/phase-2"
    "I1" --> "02-ingest-pipeline/phase-3"
    "I1" --> "12-prompt-quality/phase-2"
    "I3" --> "14-hud-skin/phase-2"
    "I4" --> "06-test-card/phase-4"
    "I4" --> "08-weekly-goal/phase-2"
    "I4" --> "10-desktop-shell/phase-3"
    "I5" --> "05-grading/phase-3"
    "I5" --> "09-lint/phase-2"
    "I6" --> "10-desktop-shell/phase-4"
    "I7" --> "10-desktop-shell/phase-5"
```
gate=dag result=OK ready=3 blocked=9 human=5 problems=0
```

PROBLEM:沒有。0 條。

請顧問核對直覺時,這幾條不是 PROBLEM,但是規格與「看 NEXT.md 的感覺」可能不一致。worker 沒改那些檔。

- `03-llm-router/phase-3` 是 HUMAN,不是 READY。Phase 表寫 `todo(gate 已由 ADR-039 解除)`(features/03-llm-router/FEATURE.md 第 85 行)。NEXT 的清單寫契約已解除,同一項的續行提到 ADR-037(features/03-llm-router/NEXT.md 第 20–24 行)。規格:決策 gate 永遠不算滿足,勾了也不算。工單正文那句「READY 至少含 03-llm-router/phase-3」已註明不以那句為準。
- `05-grading/phase-3` 同時 BLOCKED(03 phase-3、I5)與 HUMAN ADR-037。ADR-037 出現在跨資料夾那一項的括號裡(features/05-grading/NEXT.md 第 22 行),工具照 ADR-NNN 抽出來,沒有把它讀成「已經決定所以不算」。
- `07-teach-card/phase-2` 是 HUMAN ADR-073,不是 BLOCKED by 某個 I。整合項寫「那個整合點不打 tag」(features/07-teach-card/NEXT.md 第 18 行)。phase-1、01 phase-3、10 phase-2 都已 done,所以沒有 BLOCKED 行。
- `13-work-dag/phase-2` 是 BLOCKED by phase-1,再加上 HUMAN ADR-065。清單勾了 `- [x]`(features/13-work-dag/NEXT.md 第 18 行),勾選不讀。
- `13-work-dag/phase-1` 是 READY。FEATURE.md 第 80 行狀態仍是 `ready`,不是 `in-progress`。派工說派工後會變 in-progress;這棵樹還沒改,工具照表。
- `02-ingest-pipeline/phase-3` 是 READY,因為 Gate 寫的是 I1(features/02-ingest-pipeline/NEXT.md 第 22 行),而且 tag `I1` 存在、phase-2 已 done。同一檔第 9 行「目前」寫「卡在 I4」。工具只讀 Gate,不讀「目前」。
- 「三個 phase」這種寫法不是三種 phase 參照,沒有畫邊,也沒有猜。features/09-lint/NEXT.md 第 17 行的「01 三個 phase」、features/06-test-card/NEXT.md 第 17 行的「04 三個 phase」、features/11-review-cli/NEXT.md 第 14 行的「04-scheduler 三個 phase done」。01 與 04 的 phase 都已 done,11 的 phase-1 也已 done,所以 READY / BLOCKED 清單不變;11 phase-1 的 mermaid 少了 04 那三條邊。

為了不把現有 shorthand 讀成環,解析多認了三種規格沒有逐字寫死、但檔裡在用的寫法:`<資料夾全名> phase-N`(空格,不是斜線)、`<name> phase-A 與 phase-B`(同一個前綴)、`<name> phase-A/B`(兩個編號)。單獨的 `phase-N` 要緊接 `done` 才算 gate,所以「phase-2 就是 I1」「記進 phase-2 工單」不會變成自己需要自己。單元測試的三種寫法與自環場景仍照舊。

## 累計費用

session `ses_eace72e1dffecbOUoQ7b7zGN8t`,opencode `session_v2.cost` = **$9.196996**(tokens in 401112、out 20883、reasoning 91603、cache read 9591552、cache write 0)。工單 `budget_usd: 5`,派工寫明 grok 不設上限、只記錄。已超過工單預算,沒有因為花費停工。LLM 真呼叫:0(三把 key 都 UNSET)。數字是提交報告前的快照,不含提交報告這一步之後的 token。畫面底列若與此有秒差,以協調者畫面上的為準。

## 給 phase-2

phase-1 匯出、phase-2 可重用的解析函式(都在 `scripts/dag.ts`):

- `compareNatural`:自然排序比較。數字段按數值、不經 Number;數值相同但寫法不同再以原字串碼位比,全序。
- `parsePhaseTable`:讀含「Phase」與「狀態」兩欄的表。狀態取開頭關鍵字(`todo(…)` → `todo`);不認得的原樣。
- `parseGateRefs`:從一段文字依出現順序抽 phase、`I<N>`、`ADR-NNN`、`§N`、七碼以上混合 hex。不剝反引號,不把行內 `#` 當註解。
- `dashItemText`:一行 `- 項目` 或 `- [ ]` / `- [x]` 的項目文字。不把行首反引號當語法,不把行內 `#` 當註解。工單檔頭逐行清單請用這個,不要另寫會把反引號或 `#` 當註解的切法。
- `parseNext`:讀 `**phase-N**:無 gate` 與 `**phase-N** 需要:`。勾選不讀。清單可以跟 `需要:` 之間空行;`##` 或下一個 `**phase-N**` 才結束。單獨的 `phase-N` 要緊接 `done` 才留(說明裡提到自己的編號不算 gate)。

`analyzeTree` 與 `renderReport` 的分組(READY、BLOCKED、HUMAN、PROBLEM)與 mermaid 邊形狀 phase-2 可以沿用;工單節點、R1–R5、`--check` 不在這兩個函式裡。

## 待協調

- 沒跑完整 `npm run standalone`,也沒跑 `npm run accept:standalone`。前者會執行 `llm.ts --probe`(打網路,派工不准 live);後者是完整 cucumber(派工說不跑)。`13-work-dag` 這一條用 `check-standalone.ts --only 13-work-dag` 驗過,綠。若要整條 standalone gate,請協調者排位子後跑。
- CLI 只掃兩位數字開頭的 `features/` 子目錄。若顧問要 `steps` / `support` / `_template` 也進圖,說一聲,同一張補。
