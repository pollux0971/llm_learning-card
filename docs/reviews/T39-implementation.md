# T39 實作報告(worker-grok / opencode grok-4.7)

## 環境檢查(開工第一步)

```text
$ echo "${OPENAI_API_KEY:-UNSET}"; echo "${ANTHROPIC_API_KEY:-UNSET}"; ls .env
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

沒有建立或讀取 `.env`,沒有用任何 provider 金鑰。

## 做了什麼

phase-2 併進既有的 `scripts/dag.ts`(沒有另建 `scripts/dag-check.ts`)。`npm run dag:check` 是 `tsx scripts/dag.ts --root . --check`。測試釘的是這條,不是另一個入口。

CLI 仍只認 `--root <tree>`、`--check`、`--orca`。用法錯誤的 stderr 維持 `Usage: npx tsx scripts/dag.ts --root <tree>`,退出碼 2。沒有 `--check` 時有 PROBLEM 也是退出碼 0;`--check` 才讓 PROBLEM 變退出碼 1。`--orca` 只印 bash,不執行,jq 路徑是協調者量好的 `.result.task.id`。

工單檔頭自己解析(不 import YAML)。落點用 `scripts/boundaries.owners.json` 的 `owners`,取**最長**前綴,不看表的順序。目錄(以 `/` 結尾)再把表裡落在該目錄下的列都算進來。

## must_catch 對到哪段程式

| must_catch | 程式 |
|---|---|
| 最長前綴,不是第一個符合的 | `resolveTouch`:在所有 `touch.startsWith(prefix)` 裡留最長的 |
| R3 要數 review,不只 dispatched | `augment` 的 `occupying` 含 `dispatched` 與 `review`;`heavyOcc` 從這裡取;HELD 的 R3 也看這兩個狀態加上這輪已選的 |
| contracts 和任何工作互斥 | `overlapReasons`:任一方落點含 `contracts` 就列入 `contracts` |
| infra 用檔案層級,不是落點層級 | `infraShared`:逐字相同,或一方以 `/` 結尾且是另一方的目錄前綴;PROBLEM 寫 `on infra:<較短的那個>` |
| review 佔落點;兩張都是 review 不讓 dag:check 紅 | R2 的 PROBLEM 只在這一對裡至少一張是 `dispatched` 時印;HELD 仍把 review 算進佔位 |
| dropped 不算滿足 | `wireDeps`:不是 `merged` 就 unmet;dropped 另記,`blockerText` 印 `BLOCKED … by <id> (dropped)` |
| R4 / R5 只 WARN;已 done/merged/有 tag 不算深度 | `makeDepth` 對已滿足節點直接回 0;超過才 `WARN r5-depth` / `WARN r4-dispatched`;不進 PROBLEM、不改退出碼 |
| merged / dropped 對不到落點不出 no-landing | `augment` 只對 `todo` / `dispatched` / `review` 查 `noLanding` |
| 反引號當純文字 | 檔頭清單走 `dashItemText`(不把行首反引號當語法);註解只認空白後的 `#` |
| 缺檔頭、缺欄位、值不合法 | `parseHeaderText` → `PROBLEM missing-header` / `PROBLEM bad-header <名> missing\|invalid <欄位>`;`budget_usd: 0` 只准 merged / dropped |
| 不猜落點 | 對不到就 `PROBLEM no-landing`,不補一個最近的 |
| START 用自然排序,不是字串排序、也不是優先權 | 既有 `compareNatural`;READY 工單依 id 自然排序逐張選 |
| 工具不寫檔 | `dag.ts` 沒有 fs 寫入 API;phase-2 測試的前後樹雜湊比對已綠 |
| dag:check 接進 chain 之前先證明會紅 | 見下方三次紅、一次綠。接上之後 `scripts/gates.config.json` 的 chain 末項是 `dag:check` |
| 新檔要登記 | `scripts/dag-check.test.ts` → `13-work-dag`。沒有新增 `scripts/dag-check.ts`,所以 `zero-input-roster.ts` 沒加條目(名冊不收 `*.test.ts`;測試寫「若 dag-check.ts 存在才查名冊」) |
| 不改 .feature / contracts / check-next-gates | 沒改 |

## 第 4 步檔頭修改

只動檔頭。沒改工單內文。T39 的檔頭沒動(`id: T39`、`status: todo`、`owner: worker-grok`)。沒有缺檔頭的檔,所以沒有補檔頭。

`status: todo` → `merged`,依據是該張的驗收合併 commit(在這條歷史裡):

| 檔 | 舊值 | 新值 | 依據 |
|---|---|---|---|
| docs/tickets/T5-vault-pointer-and-machine-lock.md | status: todo | status: merged | `5b7c92d` Merge T5 (batch H) |
| docs/tickets/T6-category-id-narrowing.md | status: todo | status: merged | `2f47531` Merge T6 (batch I) |
| docs/tickets/T7-single-atomic-write.md | status: todo | status: merged | `3f6185d` Merge T7 (batch G) |
| docs/tickets/T8-ledger-hardening.md | status: todo | status: merged | `b376567` Merge T8 (batch K) |
| docs/tickets/T9-ledger-line-schema.md | status: todo | status: merged | `8e752a3` Merge T9 (batch L) |
| docs/tickets/T11-golden-run-dirty-prompt.md | status: todo | status: merged | `e95c1d9` Merge T11 (batch O) |
| docs/tickets/T12-children-no-parent-restatement.md | status: todo | status: merged | `c6df770` Merge T12 第 3 輪 |
| docs/tickets/T13-i2-integration-wiring.md | status: todo | status: merged | `08c338d` Merge T13 (batch Q) |
| docs/tickets/T14-hud-phase-1-fixes.md | status: todo | status: merged | `21db38b` Merge T14 (batch P) |
| docs/tickets/T15-hud-phase-2.md | status: todo | status: merged | `e4499a3` Merge T15 (batch R) |
| docs/tickets/T16-desktop-phase-6.md | status: todo | status: merged | `2d4241f` Merge T16 |
| docs/tickets/T17-review-cli-phase-2.md | status: todo | status: merged | `4fdf666` Merge T17 |
| docs/tickets/T18-children-sees-sibling-cards.md | status: todo | status: merged | `0f248ae` Merge T18 |
| docs/tickets/T19-regenerate-without-lines.md | status: todo | status: merged | `699e74b` Merge T19 |
| docs/tickets/T21-solid-window-without-compositor.md | status: todo | status: merged | `891f228` Merge T21 第 3 輪(含 -ed 驗收證據) |
| docs/tickets/T22-review-sidecar.md | status: todo | status: merged | `9773f49` Merge T22 |
| docs/tickets/T23-test-card-phase-3.md | status: todo | status: merged | `389b2fd` Merge T23 |
| docs/tickets/T24-test-card-phase-2.md | status: ready | status: merged | `341b663` Merge T24;`ready` 不是合法值 |
| docs/tickets/T25-reteach-missing-short-card.md | status: todo | status: merged | `0ca1c25` Merge T25 |
| docs/tickets/T26-reviews-optimistic-check.md | status: todo | status: merged | `bb82d60` Merge T26 |
| docs/tickets/T28-sidecar-stderr-prefix-once.md | status: todo | status: merged | `95281b0` Merge T28 |
| docs/tickets/T30-missing-credential-and-daily-start.md | status: todo | status: merged | `e78acc7` Merge T30 |
| docs/tickets/T31-llm-failure-ungraded-not-internal.md | status: todo | status: merged | `a2e5c3c` Merge T31 |
| docs/tickets/T32-test-card-header-one-line.md | status: todo | status: merged | `a3178c6` Merge T32 |
| docs/tickets/T33-work-dag-phase-1.md | status: todo | status: merged | `535806e` Merge t33-accept-tests |
| docs/tickets/T34-i3-integration-steps-and-wayland-note.md | status: todo | status: merged | `db558ee` Merge t34-accept-tests |
| docs/tickets/T36-review-harness-timeouts.md | status: todo | status: merged | `88fc3df` Merge t36-accept-tests |
| docs/tickets/T36-review-harness-timeouts.md | owner: test-agent | owner: 測試 | 顧問 2026-10-22,工單第 4 步另准(`712c331`) |
| docs/tickets/T37-teach-card-phase-2.md | status: todo | status: merged | `d3be8cc` Merge t37-fixes2(驗收通過);證據收尾 `b123049` |
| docs/tickets/T2c-1-desktop-shell-phase-2-wiring.md | id: T2c-1 | id: T2c_1 | 顧問 2026-10-22 另准;檔名與內文沒動 |
| docs/tickets/T2c-1-desktop-shell-phase-2-wiring.md | status: todo | status: merged | `7a3b534` Merge T2c-1 (batch J) |
| docs/tickets/T2c-2-desktop-shell-learning-root.md | id: T2c-2 | id: T2c_2 | 同上,只改檔頭 |
| docs/tickets/T2c-2-desktop-shell-learning-root.md | deps: [T5, T2c-1] | deps: [T5, T2c_1] | 顧問另准:全 repo 只有這張的 deps 引用 T2c-1 |
| docs/tickets/T2c-2-desktop-shell-learning-root.md | status: todo | status: merged | `4df31b8` Merge T2c-2 (batch L) |
| docs/tickets/T29-mutate-lock-test-fsync-stall.md | owner: -e5 | owner: 測試 | 顧問 2026-10-22 另准 |
| docs/tickets/T29-mutate-lock-test-fsync-stall.md | status: todo | status: merged | `bef9c8b` 第 2 件;`9af3c3b` 量測報告。沒有單獨的整張驗收合併,見待協調 |

## R5 在真樹上的深度

接進 chain 之前量過(只印深度、不寫檔;量完拿掉偵錯輸出)。未滿足節點的深度,最深是 **4**:

- `10-desktop-shell/phase-5` = 4
- `06-test-card/phase-4`、`09-lint/phase-2`、`10-desktop-shell/phase-4` = 3
- 其餘未滿足的 phase / 工單是 1 或 2

規則是 ≤ 4 才不 WARN。真樹剛好貼著上限,沒有 `WARN r5-depth`,也沒有 `WARN r4-dispatched`(dispatched 數是 0)。接進 `check:all` 不會因為 R4/R5 一接就紅。深度 4 已經頂到規則,後續若再疊未滿足的 phase,會開始 WARN。這是量到的事實,不在這裡改規則。

## 真樹輸出(顧問可對 NEXT.md)

`npx tsx scripts/dag.ts --root .` 與 `npm run dag:check` 都是退出碼 0,最後一行:

```text
gate=dag result=OK ready=10 blocked=9 human=0 problems=0
```

沒有 PROBLEM、沒有 WARN。記錄行:

```text
READY 02-ingest-pipeline/phase-3 (table says todo)
READY 03-llm-router/phase-3 (table says todo)
READY 07-teach-card/phase-2 (table says todo)
READY 07-teach-card/phase-4 (table says todo)
READY 13-work-dag/phase-2 (table says todo)
READY T3
READY T20
READY T29
READY T35
READY T39
BLOCKED 03-llm-router/phase-4 by status:blocked
BLOCKED 05-grading/phase-3 by 03-llm-router/phase-3,I5
BLOCKED 06-test-card/phase-4 by 05-grading/phase-3,I4
BLOCKED 07-teach-card/phase-3 by 07-teach-card/phase-2
BLOCKED 08-weekly-goal/phase-2 by 07-teach-card/phase-2,I4
BLOCKED 09-lint/phase-2 by 03-llm-router/phase-3,05-grading/phase-3,I5
BLOCKED 10-desktop-shell/phase-3 by I4
BLOCKED 10-desktop-shell/phase-4 by 10-desktop-shell/phase-3,I6
BLOCKED 10-desktop-shell/phase-5 by 10-desktop-shell/phase-4,I7
START 02-ingest-pipeline/phase-3
START 03-llm-router/phase-3
START 07-teach-card/phase-2
START 07-teach-card/phase-4
START 13-work-dag/phase-2
START T3
HELD T20 by R2 with T3
HELD T29 by R2 with T3
HELD T35 by R3 with T3
HELD T39 by R2 with T3
HELD T39 by R3 with T3
```

T3 仍是 todo(檔頭自己寫階段 B 未派)。T5 已合併之後它變 READY,而且是 heavy,自然排序又在 T20/T29/T35/T39 前面,所以這輪 START 是 T3,另外四張被 HELD。這是規則算出來的,不是優先權。

## 先證明會紅,才接進 chain

三次都是 `npm run dag:check`(`tsx scripts/dag.ts --root . --check`),弄壞之後還原,再改下一次。還原後、接進 chain 之前真樹已是 problems=0。chain 是在這三次之後才加的。

### 紅 1:缺檔頭

把 `docs/tickets/T35-wayland-note-reserve-space.md` 第一行改成不是 `---`。退出碼 1。stderr 空。

```text
> dag:check
> tsx scripts/dag.ts --root . --check

PROBLEM missing-header T35-wayland-note-reserve-space.md
gate=dag result=OK ready=8 blocked=9 human=0 problems=1
```

EXIT:1。已還原。

### 紅 2:有環

暫時把 T29 的 deps 改成 `[T35]`、T35 的 deps 改成 `[T29]`。退出碼 1。

```text
> dag:check
> tsx scripts/dag.ts --root . --check

PROBLEM cycle T29 -> T35 -> T29
gate=dag result=OK ready=8 blocked=9 human=0 problems=1
```

EXIT:1。已還原(T29 的 owner 維持顧問准的 `測試`,status 維持 todo)。

### 紅 3:dispatched 違反 R2

暫時把 T3 與 T39 的 status 改成 `dispatched`(兩張落點相交,而且都是 heavy)。退出碼 1。

```text
> dag:check
> tsx scripts/dag.ts --root . --check

PROBLEM r2-overlap T3 T39 on 13-work-dag
PROBLEM r2-overlap T3 T39 on infra:scripts/
PROBLEM r3-heavy T3 T39
gate=dag result=OK ready=7 blocked=9 human=0 problems=3
```

EXIT:1。已還原。T39 檔頭回復 `status: todo`。

### 綠(接進 chain 之後)

`scripts/gates.config.json` 的 chain 末項加上 `dag:check`(20 → 21)。`package.json` 的 script 是 `tsx scripts/dag.ts --root . --check`。

```text
> dag:check
> tsx scripts/dag.ts --root . --check

gate=dag result=OK ready=10 blocked=9 human=0 problems=0
```

EXIT:0。沒有 PROBLEM、沒有 WARN。

## 落點登記

`scripts/boundaries.owners.json` 追加(放在既有列之後,避免 `ownerOf` 的第一個符合蓋掉既有檔):

- `package.json`、`standalone.json`、`scripts/gates.config.json`、`scripts/boundaries.owners.json`、`scripts/boundaries.allow.json` → `infra`
- `docs/` → `docs`(`check-boundaries.ts` 沒有落點名白名單,`npm run boundaries` 認)
- `features/01-data-layer/` … `features/14-hud-skin/`(14 個)→ 同名落點。沒有加 blanket `features/`,所以 `features/steps/`、`features/support/` 仍歸 `steps`
- `scripts/dag-check.test.ts`、`scripts/dag-check.ts` → `13-work-dag`(後者檔案不存在;T39 的 touches 有這條路徑,落點表要對得到,否則 no-landing)
- `features/support/dag-p2-harness` → `13-work-dag`,插在 `features/support/` 前面

最後這一列是因為 boundaries 的 `ownerOf` 取**第一個**符合的前綴,不是最長。`scripts/dag.test.ts` 與 `scripts/dag-check.test.ts` 被測試釘成 `13-work-dag`,又 import 假樹工具。不改測試、也不開 allow 的話,那一條 import 會被看成跨落點。把 harness 檔的前綴放在 `features/support/` 前面,boundaries 把這個檔算成 `13-work-dag`,import 變成同落點。dag 自己對落點用最長前綴,不受這條順序影響。`features/support/` 其餘檔仍歸 `steps`。

沒有加 blanket `scripts/`。boundaries 的第一個符合若先撞上 `scripts/`,既有腳本的落點會整批變成 infra。

`npm run boundaries`:

```text
boundaries: 掃描 351 個檔案,允許例外 23 條
涵蓋:納管 407 / 掃描 407 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=351
```

`coverageBaseline` 仍是 253/253。這次是 407/407,比例沒降,棘輪沒有要求改基準,所以沒改。

## 釘住設定的測試與文件(沒改它們)

`git grep` 釘 `boundaries.owners.json` 的測試:內容是自己的 fixture,或只檢查特定檔的落點(`scripts/dag.test.ts` 檢查 `scripts/dag.ts` / `scripts/dag.test.ts`;`scripts/dag-check.test.ts` 檢查新檔與 T39 touches 的前綴)。沒有測試把 owners 的條數或 `coverageBaseline: 253` 寫死成斷言。`scripts/check-boundaries.local.test.ts` 會把真檔複製進暫存目錄再跑,所以它跟的是檔的內容,不是一個寫死的條數。

chain 長度:

- `docs/phase-status-cost-baseline.md` 有 `gate=all result=FAIL scanned=20`。那是當時 check:all 的歷史輸出。接進 chain 之後 `scanned` 會變成 21,那句話不再描述現在的 chain。**沒改這份歷史證據**,請協調者決定要不要在別處加一句「T39 之後 chain 是 21」。
- `docs/reviews/date-dependent-lock-tests.md` 的 `scanned=20` 是 `npm run lint:docs` 的輸出,不是 chain 長度。這次 `check-doc-links` 是 `scanned=127`,那句歷史話也不描述現在的 doc-links,同樣沒改。
- 沒有測試把 chain 長度寫死成 20。`scripts/dag-check.test.ts` 只要求 chain 裡有且只有一個 `dag:check`,而且每一項都是 npm script。

## cucumber

只用 `--tags`,沒給 feature 檔名。兩段都全過。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 NODE_OPTIONS=--import=tsx ./node_modules/.bin/cucumber-js --tags "@work-dag and @phase-2"
76 scenarios (76 passed)
396 steps (396 passed)
0m10.967s (executing steps: 0m10.129s)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 NODE_OPTIONS=--import=tsx ./node_modules/.bin/cucumber-js --tags "@work-dag and @phase-1"
34 scenarios (34 passed)
181 steps (181 passed)
0m05.547s (executing steps: 0m04.767s)
```

## 待協調

- **T29 檔頭 status 是 merged**,依據是 `bef9c8b`(第 2 件)與 `9af3c3b`(量測報告),沒有單獨的整張驗收合併。owner 改 `測試` 是顧問另准。若這不算整張完成,請協調者把 status 改回 `todo`。
- **T35 status 仍是 todo。** 只看到工單合併 `5b48d19`,沒有實作驗收合併。沒改 status。
- **T20 status 仍是 todo。** 沒有 Merge T20。T19 改成 merged 之後,T20 變成 READY,再被 T3 以 R2 擋住。
- **T3 仍是 todo**,檔頭註解寫階段 B 未派。T5 合併之後它 READY 且 heavy,這輪 START 是它。若階段 B 不該被當成可開工,那是 deps / 狀態的產品決定,這裡不准改 deps。
- **T21 標了 merged**,依據是 `891f228`(含驗收證據)。稍早的 `6e39a01` 寫 phase-6 維持 in-progress,`18672ad` 的觀感當時寫「待顧問判」。若顧問認為這張還沒完,把 status 改回去。
- cucumber 已跑,見上一節。phase-2 與 phase-1 都全過。
- `npm run check:test-ledger` 會跑整套 vitest。這裡啟動後被終止(退出碼 143),沒有重跑整套。單檔 `scripts/dag.test.ts`(279)與 `scripts/dag-check.test.ts`(16)已綠。

## 跑過的指令與輸出

開工環境檢查見報告開頭。

```text
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run scripts/dag.test.ts --maxWorkers=1
 Test Files  1 passed (1)
      Tests  279 passed (279)

CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run scripts/dag-check.test.ts --maxWorkers=1
 Test Files  1 passed (1)
      Tests  16 passed (16)

CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsc --noEmit
(無輸出,退出碼 0)

npm run boundaries
gate=boundaries result=PASS scanned=351

npx tsx scripts/check-doc-links.ts
doc-links: 掃描 218 個 markdown 檔,127 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=127

npx tsx scripts/dag.ts --root .
gate=dag result=OK ready=10 blocked=9 human=0 problems=0
(退出碼 0)

npm run dag:check
(同上,退出碼 0)
```

三次紅的原始輸出見上一節。

位子給了之後的 cucumber(Scenarios / Steps 原文):

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 NODE_OPTIONS=--import=tsx ./node_modules/.bin/cucumber-js --tags "@work-dag and @phase-2"
76 scenarios (76 passed)
396 steps (396 passed)
0m10.967s (executing steps: 0m10.129s)

CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 NODE_OPTIONS=--import=tsx ./node_modules/.bin/cucumber-js --tags "@work-dag and @phase-1"
34 scenarios (34 passed)
181 steps (181 passed)
0m05.547s (executing steps: 0m04.767s)
```

## learning/ 量測

量的是主簽出 `/data/python/llm_learning-cards/learning`,唯一量法(不含 `.git`、`LC_ALL=C`)。這張 worktree 的實作沒有讀、寫、刪那裡的檔。收工量一次:

| sha256 前 16 | 檔數 | state/log.jsonl 行數 |
|---|---|---|
| c2e4dd6d71de3976 | 64 | 108 |

與 T33 報告記下的數字相同。沒有列出任何 learning/ 或 raw/ 的檔名。
