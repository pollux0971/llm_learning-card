# T39 實作報告(13-work-dag phase-2)

環境檢查(開工第一步):

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

`--orca` 的 jq 路徑照協調者 2026-10-21 量好的寫,沒有自己建 task:`.result.task.id`。印出的行是

`T1=$(orca orchestration task-create --spec "$(cat docs/tickets/T1-….md)" --deps "[]" --json | jq -r '.result.task.id')`。

## 做了什麼

`dag:check` 沒有另開 `scripts/dag-check.ts`。測試釘死 npm script 必須跑 `scripts/dag.ts` 並帶 `--check`,所以入口是同一支工具的旗標。沒有這個檔,零輸入名冊也不該多一筆(名冊指到不存在的檔會紅;`.test.ts` 不能當名冊鍵,完整性檢查把測試檔排除在「磁碟上的入口」之外)。

- `scripts/dag.ts`:`--check`、`--orca`,讀 `docs/tickets/*.md` 檔頭(受限 YAML,自己解析,不 import 套件),工單進圖,R1–R5,`START` / `HELD` / `LANDING` / `WARN` / `PROBLEM`。沒有 `--check` 時有 PROBLEM 也是退出碼 0;`--check` 才變 1。`--orca` 只印 bash,不執行。沒有寫檔 API。
- `package.json`:`"dag:check": "tsx scripts/dag.ts --root . --check"`。
- `scripts/gates.config.json` 的 `chain` 末尾加 `dag:check`(接上之前先證明會紅,見下)。chain 20 → 21。
- `scripts/boundaries.owners.json`:設定檔與 `docs/`、14 個 `features/<NN-name>/`、`scripts/dag-check.ts`、`scripts/dag-check.test.ts`。`features/support/dag-p2-harness`(比 `features/support/` 長)→ `13-work-dag`,讓受保護測試的 import 落在同一落點,不必加 `boundaries.allow.json`(那份條數被 `features/support/t31-static.test.ts` 釘成 23,測試檔不准改)。`features/support/` 其餘仍是 `steps`。`check-boundaries.ts` 接受落點名 `docs`,沒有改用 `infra`。
- 舊工單檔頭:只改檔頭,見下表。沒有缺檔頭的檔。T39 自己的檔頭沒動。沒改 `FEATURE.md` / `NEXT.md` / `.feature` / 測試檔 / `contracts/` / `standalone.json`。

phase 的 R4 只數表上 `in-progress`,不把這輪已選的 ready phase 算進去。單元測試「只有一個 in-progress 不擋」在另一張 ready(表上是 todo)也被選上時,仍要求第三張 `START`。工單的 R4(dispatched ≤ 3)則把這輪已選的算進去,兩條不一樣,照各自的測試寫。

## must_catch → 程式

| must_catch | 落點 |
|---|---|
| 最長前綴改成第一個符合的前綴必須紅 | `resolveTouch`:同長度才退讓,否則取最長前綴;目錄(`以 / 結尾`)再併入底下每一列 |
| R3 改成只數 dispatched,review 場景必須紅 | `augment`:heavy 的 `dispatched` 與 `review` 都進 `r3-heavy`;HELD 的 R3 也含 review |
| contracts 互斥拿掉必須紅 | `overlapReasons`:任一方落點含 `contracts` 就 `on contracts` |
| infra 改回落點比對,不同檔被誤判相交必須紅;逐字相同或目錄前綴仍相交 | `infraShared`:逐字相同,或一方以 `/` 結尾且是另一方的前綴;較短的那個寫進 `infra:` |
| review 不佔落點必須紅;兩張都是 review 不算紅 | R2 紅燈要求這一對裡至少一張 `dispatched`;HELD 仍把 review 當佔位 |
| dropped 被當成滿足必須紅 | `wireDeps` + `blockerText`:`BLOCKED … by <id> (dropped)`,不算滿足 |
| WARN 被當成紅燈、或 R5 把 done/merged/有 tag 算進去必須紅 | `makeDepth` / `satisfied`:done、merged、有 tag 深度 0;R4/R5 只 `WARN`,不進 `problems`、不改退出碼 |
| merged/dropped 對不到落點不得 no-landing;todo/dispatched/review 仍紅 | `augment`:只有這三種 status 才查 `no-landing`、才印 `LANDING` |
| 反引號開頭的清單項被當成不合法必須紅 | `parseHeaderText` 對 `- 項目` 走 `dashItemText`,不剝反引號、不把行內 `#` 當註解 |
| 缺檔頭、缺欄、值不合法沒被抓必須紅 | `parseHeaderText`:`missing-header` / `bad-header … missing\|invalid`;`budget_usd: 0` 只准 merged/dropped;owner 含「測試」 |
| 對不到落點卻猜一個必須紅 | 沒有最長前綴、也沒有目錄涵蓋 → `PROBLEM no-landing`,不猜 |
| START 用字串排序必須紅 | `uniqueSorted` / `compareNatural`(`T2` 在 `T10` 前);同層 `--orca` 先吐完這一層再解下一層 |
| 工具寫檔必須紅 | `dag.ts` 只有讀取;沒有 write/mkdir/rename |
| dag:check 沒接 chain、或弄壞輸入不紅 | 見「先證明會紅」;chain 與 npm script 都有 |
| 新檔沒登記 owners / roster 必須紅 | `scripts/dag-check.test.ts` → `13-work-dag`。沒有 `dag-check.ts`,名冊不加 |
| 改了 .feature / contracts / check-next-gates.ts 必須紅 | 這三處都沒改 |

## 第 4 步檔頭

沒有缺檔頭的工單。下列都只改檔頭,內文不動。status 的依據是這條歷史裡的合併 commit(實作與驗收已進 `8be4ac9` 的祖先)。

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
| docs/tickets/T21-solid-window-without-compositor.md | status: todo | status: merged | `891f228` Merge T21 第 3 輪 |
| docs/tickets/T22-review-sidecar.md | status: todo | status: merged | `9773f49` Merge T22 |
| docs/tickets/T23-test-card-phase-3.md | status: todo | status: merged | `389b2fd` Merge T23 |
| docs/tickets/T24-test-card-phase-2.md | status: ready | status: merged | `341b663` Merge T24;`ready` 不是合法 status |
| docs/tickets/T25-reteach-missing-short-card.md | status: todo | status: merged | `0ca1c25` Merge T25 |
| docs/tickets/T26-reviews-optimistic-check.md | status: todo | status: merged | `bb82d60` Merge T26 |
| docs/tickets/T28-sidecar-stderr-prefix-once.md | status: todo | status: merged | `95281b0` Merge T28 |
| docs/tickets/T29-mutate-lock-test-fsync-stall.md | status: todo | status: merged | `bef9c8b` Merge t29-fd20(第 2 件,量測報告在 `9af3c3b`) |
| 同上 | owner: -e5 | owner: 測試 | 顧問 2026-10-22 另准;不是合併證據 |
| docs/tickets/T2c-1-desktop-shell-phase-2-wiring.md | id: T2c-1 | id: T2c_1 | 顧問 2026-10-22 另准(檔名與內文不動) |
| 同上 | status: todo | status: merged | `7a3b534` Merge T2c-1 (batch J) |
| docs/tickets/T2c-2-desktop-shell-learning-root.md | id: T2c-2 | id: T2c_2 | 顧問 2026-10-22 另准 |
| 同上 | deps: [T5, T2c-1] | deps: [T5, T2c_1] | 同上,只改檔頭 deps |
| 同上 | status: todo | status: merged | `4df31b8` Merge T2c-2 (batch L) |
| docs/tickets/T30-missing-credential-and-daily-start.md | status: todo | status: merged | `e78acc7` Merge T30 |
| docs/tickets/T31-llm-failure-ungraded-not-internal.md | status: todo | status: merged | `a2e5c3c` Merge T31 |
| docs/tickets/T32-test-card-header-one-line.md | status: todo | status: merged | `a3178c6` Merge T32 |
| docs/tickets/T33-work-dag-phase-1.md | status: todo | status: merged | `535806e` Merge t33-accept-tests |
| docs/tickets/T34-i3-integration-steps-and-wayland-note.md | status: todo | status: merged | `db558ee` Merge t34-accept-tests |
| docs/tickets/T36-review-harness-timeouts.md | status: todo | status: merged | `88fc3df` Merge t36-accept-tests |
| 同上 | owner: test-agent | owner: 測試 | 顧問 2026-10-22 另准 |
| docs/tickets/T37-teach-card-phase-2.md | status: todo | status: merged | `d3be8cc` Merge t37-fixes2(驗收通過);證據合併 `b123049` |

沒改:T0 / T2 / T2b / T4 / T4b(本來就是 merged 或 dropped)、T3、T20、T35、T39。

## R5 真樹深度

未滿足節點的深度(含自己;done / merged / 有 tag 的是 0,不列入)。最大是 4,沒有 `WARN`。接進 chain 不會因為 R5 變紅。

| 深度 | 節點 |
|---|---|
| 1 | 02-ingest-pipeline/phase-3、03-llm-router/phase-3、03-llm-router/phase-4、07-teach-card/phase-2、07-teach-card/phase-4、13-work-dag/phase-2、T2(dropped,不算滿足)、T20、T3、T35、T39 |
| 2 | 05-grading/phase-3、07-teach-card/phase-3、08-weekly-goal/phase-2、10-desktop-shell/phase-3 |
| 3 | 06-test-card/phase-4、09-lint/phase-2、10-desktop-shell/phase-4 |
| 4 | 10-desktop-shell/phase-5 |

沒有深度 > 4。沒有 `WARN r4-dispatched`(dispatched 0 張)。

## 真樹 `npm run dag:check`(還原後,退出碼 0)

```
READY 02-ingest-pipeline/phase-3 (table says todo)
READY 03-llm-router/phase-3 (table says todo)
READY 07-teach-card/phase-2 (table says todo)
READY 07-teach-card/phase-4 (table says todo)
READY 13-work-dag/phase-2 (table says todo)
READY T3
READY T20
READY T35
READY T39
START 02-ingest-pipeline/phase-3
START 03-llm-router/phase-3
START 07-teach-card/phase-2
START 07-teach-card/phase-4
START 13-work-dag/phase-2
START T3
HELD T20 by R2 with T3
HELD T35 by R3 with T3
HELD T39 by R2 with T3
HELD T39 by R3 with T3
gate=dag result=OK ready=9 blocked=9 human=0 problems=0
```

沒有 `PROBLEM`、沒有 `WARN`。表上沒有 `in-progress`,所以五個 ready phase 都 `START`(見上,phase R4 不數這輪已選的)。T3 先被選上,T20 / T39 被它的落點擋住,T35 / T39 被它的 heavy 擋住。

## 先證明會紅,才接 chain

接進 `scripts/gates.config.json` 之前,在真 repo 用暫時工單弄壞再刪掉。三次都是 `npm run dag:check`(退出碼記在 `EXIT:`)。

缺檔頭(`docs/tickets/T99-missing-header-probe.md`,跑完已刪):

```
> dag:check
> tsx scripts/dag.ts --root . --check
PROBLEM missing-header T99-missing-header-probe.md
gate=dag result=OK ready=9 blocked=9 human=0 problems=1
EXIT:1
```

有環(T97 ↔ T98,跑完已刪):

```
> dag:check
> tsx scripts/dag.ts --root . --check
PROBLEM cycle T97 -> T98 -> T97
gate=dag result=OK ready=9 blocked=11 human=0 problems=1
EXIT:1
```

dispatched 違反 R2(T95 `apps/desktop/src-tauri/`、T96 `apps/desktop/src/`,跑完已刪):

```
> dag:check
> tsx scripts/dag.ts --root . --check
PROBLEM r2-overlap T95 T96 on 10-desktop-shell
gate=dag result=OK ready=9 blocked=9 human=0 problems=1
EXIT:1
```

還原後再跑(接 chain 之前的那一次綠;接上之後又跑一次,同樣退出碼 0、`problems=0`,見上一節):

```
> dag:check
> tsx scripts/dag.ts --root . --check
gate=dag result=OK ready=9 blocked=9 human=0 problems=0
EXIT:0
```

## 釘住 chain / owners 的測試與文件

- `git grep scanned=20`:`docs/phase-status-cost-baseline.md` 第 77 行是當時 `check:all` 的歷史輸出(`gate=all result=FAIL scanned=20`)。chain 現在 21,新跑一輪會印 `scanned=21`。那句話是當時的紀錄,仍然描述那一次;沒改 `docs/reviews/` 與那份基線。請協調者決定要不要另記一筆,不要改歷史證據。
- `docs/reviews/date-dependent-lock-tests.md` 的 `scanned=20` 是 `lint:docs`,不是 chain 長度,這次不影響。
- `docs/reviews/template-141-adoption-handoff.md` 寫 chain 14 步,是升模板當時的紀錄,不是現況的斷言。
- owners 條數沒有測試釘死絕對數字。`coverageBaseline` 仍是 253/253。這次 `npm run boundaries` 是 `涵蓋:納管 407 / 掃描 407 檔(100.0%)`,比例沒下降,棘輪過,沒有把基準改高。`scripts/check-boundaries.test.ts` 的棘輪測試用自己的假 owners,不讀真檔的 253。

## 待協調

- T3 檔頭註解寫階段 A 已合併、階段 B 未派,status 仍是合法的 `todo`。沒有「階段 B 已合併」的 commit,所以沒改。結果是 `START T3`,並且 `HELD T39 by R2 with T3`、`HELD T39 by R3 with T3`(T3 的 touches 蓋到多個落點,cpu 是 heavy)。若協調者認為階段 B 不該被當成可開工,要另裁 status,不是這張能猜的。
- T20 沒有實作合併(只在起草 T19 的 `482ae5d` 被提到)。留 `todo`。被 T3 以 R2 擋住。
- T35 只有工單合併 `5b48d19`,沒有實作合併。留 `todo`。被 T3 以 R3 擋住。
- phase R4 不數這輪已選的 ready phase(測試要求)。真樹上 0 個 in-progress 時,五個 ready phase 一起 `START`。這比工單 R4 的「這輪已選的也算」鬆。若顧問要 phase 也數這輪已選的,要改測試,實作才能跟著改。
- `check:test-ledger` 沒跑完:一啟動就在等 `stryker.lock`,持鎖者是這個 worktree 裡另一個 `scripts/run-tests.ts --`(pid 2761565,當時已跑約 1 分半)。沒有等滿 90 分鐘,也沒有殺那個行程。
- cucumber(`@work-dag and @phase-2`,以及 `@phase-1`)還沒跑。feature 級要先向協調者要位子。

## 跑過的指令與輸出

開工環境檢查見文首。

`npx tsc --noEmit`(`./node_modules/.bin/tsc --noEmit`):無輸出,退出碼 0。

`scripts/dag.test.ts` phase-2 區 72 條綠;整檔 279 條在 phase R4 改回「只數 in-progress」之後,phase-2 篩選再跑 72 條綠。中間有一次整檔紅 1 條(把這輪已選的 phase 算進 WIP),已改回。

`scripts/dag-check.test.ts` 16 條綠。

`scripts/zero-input-guard.test.ts`:775 passed,171 skipped。

`npm run boundaries`:

```
boundaries: 掃描 351 個檔案,允許例外 23 條
涵蓋:納管 407 / 掃描 407 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=351
```

`npx tsx scripts/check-doc-links.ts`:

```
doc-links: 掃描 218 個 markdown 檔,127 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=127
```

真樹 `npm run dag:check` 與三次紅一次綠見上。沒跑 `npm run mutate`,沒跑整條 `check:all`。
