# 驗收證據:T39(13-work-dag phase-2)

- 工單:`docs/tickets/T39-work-dag-phase-2.md`(唯一正本)
- 被驗分支:`t39-impl`,sha `b91bd0354b751f942b71477c606c8df5d3498adf`(worker 分支同 sha)
- 驗收樹(開跑與跑完相同):tree `9ae31c36d3b1330b0aaf7b1fdd6dbeb8f00989e0`
- 驗收者:驗收線 -5a,日期 2026-10-22
- 機器:開跑時 load 約 20(別的 session 在跑),完整 vitest 第一次跑時 load 28,變異跑時 load 3–4;main 之外沒有別的重活與我同時用位子
- 沒有 `.env`(`ls .env` 失敗)

## 結論

**有阻擋項:變異分數 76.06%,低於標準級 80%。** 其餘項目全部通過。阻擋項只有變異這一條,缺口集中在「輸出排序」「檔頭解析的邊角路徑」「落點檔載入的錯誤路徑」,交測試線補測試,實作不用改(我沒有找到實作錯誤)。

## 1 受保護測試檔(測試作者檢查)

- 基底 `712c331`;`git diff --name-only 712c331..t39-impl` 的測試檔只有 5 個:work-dag.steps.ts、work-dag-phase2.steps.ts、dag-p2-harness.ts、dag-check.test.ts、dag.test.ts。
- 這 5 個檔對測試線最終版 `t39-red` 41b79930 的 diff 為**空**;worker 的 3 個 commit(d97b439、cded927、b91bd03)沒有碰任何測試檔、步驟、`.feature`、fixtures。
- 歷史中 mutants.out 檔數:0。
- `.feature`、`contracts/`、`scripts/check-next-gates.ts`、`standalone.json` 都沒被改。

## 2 自動驗收項目

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 乾淨 |
| `npm run boundaries` | PASS,掃描 351 檔、允許例外 23 條(沒變)、納管 407/407 |
| `npx tsx scripts/check-doc-links.ts` | PASS,127 條連結 |
| cucumber `@work-dag and @phase-2`(用 `node --import tsx` 呼叫 cucumber,`--tags`) | 76 場景 / 396 步全過 |
| cucumber `@work-dag and @phase-1` | 34 場景 / 181 步全過(不退步) |
| 重編 lc-fs | 驗收樹第一次跑時重編,Finished 2m12s(`CARGO_BUILD_JOBS=2`) |
| `zero-input-guard.test.ts` + `dag-check.test.ts` 單檔 | 2 檔 791 過 / 171 skipped |
| 完整 vitest(`VITEST_MAX_WORKERS=1`)第一次 | 6148 過、2 條紅,都是 5000ms 逾時(`degraded-report.test.ts` 一條、`hud/components.test.ts` 一條),當時 load 28,與 T39 無關 |
| `npm run check:test-ledger`(內含再跑一次完整套件) | 229 檔 6150 過、0 紅;帳本行數相同 108;`gate=ledger-pollution result=PASS` |
| `dag.ts --root .` | `gate=dag result=OK ready=9 blocked=9 human=0 problems=0` |
| `npm run dag:check`(真樹) | 綠,0 個 PROBLEM、0 個 WARN |
| T32(檔頭含反引號) | 沒有被報 invalid;docs/tickets 底下 40 張檔頭含反引號的全部有效 |
| `standalone.json`、`@standalone` | 沒動,符合工單 |

第一次那兩條逾時是機器忙(load 28)造成,第二次完整套件(load 約 5)同兩條都過。這類 5000ms 預設逾時在 load 高時會紅,不是 T39 引入。

### 設定 JSON 釘住的測試

動到 `scripts/gates.config.json`(chain 加 `dag:check`)、`package.json`(加 `dag:check`)、`scripts/boundaries.owners.json`(+92 行,多是新落點列)。`git grep` 找出釘它們的測試有 `check-all.test.ts`、`check-boundaries*.test.ts`、`check-doc-links*.test.ts` 等十多個檔;完整套件(含 `check:test-ledger`)全過,沒有一條因為 chain 變 21 條或 owners 增加而紅。`scanned=20` 的字面只出現在 `docs/phase-status-cost-baseline.md` 這份歷史證據,接進 chain 之後那句話對「當時的 20 條」仍然成立,不需要改(我沒有改任何 `docs/reviews/` 的歷史證據)。

### 觀察(不擋,交顧問)

- O1:`scripts/boundaries.owners.json` 登記了 `scripts/dag-check.ts`(→ `13-work-dag`),但這支檔**不存在**(worker 把 `dag:check` 做在 `dag.ts --check`,報告有說明)。是一列沒用到的登記,boundaries 與 zero-input 都不報。
- O2:摘要行在有 PROBLEM 時仍寫 `gate=dag result=OK … problems=N`,退出碼才是 1。這是 phase-1 以來測試釘住的約定(dag.test.ts 有一條專門測「有 PROBLEM 摘要行也是 result=OK」),不是 worker 引入;但 chain 的判斷靠退出碼,不靠 `result=` 這行。

## 3 第 4 步:工單檔頭修改逐筆核對

`git diff 712c331..t39-impl -- docs/tickets` 共 32 個檔,每個檔都只動檔頭欄位,沒有改內文,沒有補新檔頭(32 張本來就有)。

- 只改 `status`:27 張(T5 T6 T7 T8 T9 T11 T12 T13 T14 T15 T16 T17 T18 T19 T21 T22 T23 T25 T26 T28 T30 T31 T32 T33 T34 T37 與 T24)。其中 T24 是 `ready` → `merged`(`ready` 不是合法值,工單允許)。
- 顧問另准的:T29(`owner: -e5` → `測試` 加 status)、T36(`owner: test-agent` → `測試` 加 status)、T2c-1(`id` → `T2c_1`、status)、T2c-2(`id` → `T2c_2`、`deps` 的 `T2c-1` → `T2c_1`、status)。
- `deps`、`touches`、`cpu` 沒有任何一筆被動(上述 T2c-2 的 deps 是顧問另准)。T39 自己的檔頭沒動。
- 每筆 `merged` 我都用 `git log --merges --grep` 在 712c331 之前的 main 歷史找到對應的 Merge commit(T5 49090e1/5b7c92d、T6 2f47531、T7 3f6185d、T8 b376567、T9 8e752a3、T11 e95c1d9、T12 c6df770、T13 08c338d、T14 21db38b、T15 0225d88、T16 1bb24b0、T17 4fdf666、T18 0f248ae、T19 699e74b、T21 18672ad、T22 7a48f31、T23 f21dcb6、T24 de5ac65、T25 0ca1c25、T26 bb82d60、T28 95281b0、T2c-1 7a3b534、T2c-2 75d18f5、T30 e78acc7、T31 72d01c2、T32 29f7ead、T33 eaeb04c、T34 db558ee、T36 88fc3df、T37 b123049)。
- **T29 例外**:只有分項合併(bef9c8b 第 2 件、9af3c3b 量測報告),沒有整張驗收合併。worker 已列「待協調」;我同意列為待決,不擋。
- 沒被動的:T3、T20、T35 仍是 `todo`,T0、T2b、T4、T4b 已是 `merged`/`dropped`。

### 第 3 點:T3 為什麼 HELD T39

T3 檔頭寫 `status: todo`,檔頭註解自己寫「階段 A 已合併;階段 B 未派」,T3 的 `deps` 只有 T5,T5 已合併,所以規則上 T3 是 READY 且 heavy。真樹輸出 `START T3`,`HELD T20 by R2 with T3`、`HELD T35 by R3 with T3`、`HELD T39 by R2 with T3`、`HELD T39 by R3 with T3`。這是工單狀態的真實狀況(階段 B 沒派卻沒有 deps 或狀態表達),**不是 worker 漏改**;worker 依規定沒有動 T3。要不要讓 T3 不再被 START,是顧問的產品決定(例如把 T3 拆成 T3a/T3b 或標 `dropped`/`blocked`)。

## 4 弄壞輸入確認 dag:check 會紅(我自己做)

在驗收樹內改工單檔頭,每次用 `dag.ts --root . --check` 跑,看退出碼,改完就還原:

| 弄壞 | 輸出 | 退出碼 |
|---|---|---|
| 刪掉 T7 的檔頭 | `PROBLEM missing-header T7-single-atomic-write.md`,還有 `unresolved-ref` 兩條 | 1 |
| T9 的 `cpu: medium` | `PROBLEM bad-header T9 invalid cpu` | 1 |
| T3 與 T39 都改 `dispatched` | `PROBLEM r2-overlap T3 T39 on 13-work-dag` / `on infra:scripts/`、`PROBLEM r3-heavy T3 T39` | 1 |
| T8 的 deps 指回 T9(造環) | `PROBLEM cycle T8 -> T9 -> T8` | 1 |
| T20 的 touches 改成不存在的路徑 | `PROBLEM no-landing T20 nowhere/x.ts` | 1 |
| 還原後 | `problems=0` | 0 |

worker 報告記的「接進 chain 前三次紅一次綠」原文(報告第 150–205 行附近)與我的重現同形狀,三次紅都是 PROBLEM 且退出碼 1,一次綠退出碼 0。

## 5 變異測試

指令(完整):

    npm run mutate -- stryker.t39-dag.json

設定檔 `stryker.t39-dag.json`(本分支新增,放在驗收分支,不屬於 worker 的交件):mutate 範圍 `scripts/dag.ts:663-1258`(phase-2 新增的部分:檔頭解析、滿足判定、R2–R5、touches 對落點、`--orca`、CLI);測試 `MUTATE_TEST_GLOB='{scripts/dag.test.ts,scripts/dag-check.test.ts}'`(vitest,`--bail=1`);`concurrency 2`、`timeoutMS 120000`、`coverageAnalysis off`、門檻 90/80/break 0。`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1`。phase-1 的部分(第 1–662 行)在 T33 已驗,不重跑。

結果:**76.06%**。1111 個變異:殺 845、存活 266、逾時 0、無覆蓋 0、錯誤 0。耗時 228 分 34 秒。報告 `reports/mutation/b91bd03-t39-dag.json`。**低於標準級 80%,是阻擋項。**

### 各函式存活數(存活 / 總數)

augment 61/312(80% 殺)、parseHeaderText 60/256(77%)、compareRecord 30/33(9%)、loadLandings 17/34(50%)、orcaScript 17/59、overlapReasons 13/39、classifyDep 13/41、loadTicketNodes 12/62、parseInlineList 9/30、wireDeps 7/36、scalarUnsupported 4/7、invokedAsCli 4/23、stripKeyComment 3/9、makeDepth 3/14、parseFlags 3/43、main 3/21;其餘 resolveTouch 2、phaseTables 2、infraShared 1、phaseStatusMap 1、orcaLine 1、blockerText 0。

### 存活者分類(按模式逐組看過原始碼,不是 266 筆各自證明;數字是約數)

**真缺口(測試沒釘住的行為,交測試線補,約 150 個)**

1. 輸出排序(約 60):`compareRecord` 幾乎全活(30/33)—— PROBLEM 行的排序(同一張工單的 `missing` 排在 `invalid` 前、依 id 自然排序)沒有測試;`augment` 的 `items.sort(...)`(第 1132 行)與邊排序(第 1143–1145 行)、邊去重(第 1139–1140 行)沒有被釘。證明方式:把比較函式換成 `() => 0` 全綠。
2. 檔頭解析邊角(約 35):檔頭中的空行與 `#` 註解行(第 706–707 行)、不是 `key: value` 的雜訊行(第 718–719 行)、重複的鍵(第 726–727 行)、空值(第 732 行)、`budget_usd` 小數格式(第 782 行 regex)、`scalarUnsupported` 的 `>` 開頭與引號等字元、`parseInlineList` 的括號判斷。
3. 落點檔載入的錯誤路徑(約 17):`loadLandings` 的檔案不存在、不是檔案、JSON 壞、`owners` 不是陣列、列的型別不對,各自該回空表的行為沒有測試。
4. 循環節點不得 READY / 滿足判定(約 11):`augment` 第 1052–1060 行把環上節點排除出 START 的邏輯,與 `status !== 'todo'` 跳過。
5. R2/R3 配對訊息順序與只有 R3 / 只有 R2 的 HELD 行(約 12):`HELD … by R2 with …` 的 id 順序(左右互換)、`r2.length > 0` 與 `r3.length > 0` 各自獨立印。
6. `overlapReasons` 的落點互斥細節(約 13):`infra` 與 `contracts` 不當作一般落點交集的過濾條件(第 864、866 行)沒有被各別釘住;`I\d+$` 的 I 閘門 regex 沒有錨點測試(`classifyDep`、`augment` 第 906、1028 行,6 個)。
7. `--orca` 腳本(約 17):`orcaScript` 的雜項輸出(變數命名、依賴串接)只有部分被測。
8. CLI 殼(約 10):`invokedAsCli`、`parseFlags`、`main` 的邊角。

**低(影響小,先不擋,約 40 個)**:`loadTicketNodes` / `wireDeps` 中對已經在別處驗過的欄位重複防護、`phaseTables` / `phaseStatusMap` 的空值保護、`stripKeyComment` 的 `trim` 方向、`blockerText` 以外的字串拼接標點。

**等價(程式行為不變,約 70 個)**:`?? ''` 與 `?? []` 的預設值被改成 `"Stryker was here!"` / `["Stryker was here"]`,但後面的驗證立刻判不合法或不會被讀到(第 723、766、771、776、781、786、800–804 行);迴圈邊界 `i < lines.length` 改 `<=`(第 692、704、1067、1077 行)只多讀一個 `undefined` 元素,後面的判斷已擋掉;`makeDepth` 的備忘化與 `visiting.delete`(第 1011、1016、1018 行)只影響效能不影響結果;`compareNatural(...) <= 0` 改 `<`(第 1072、1081 行)因為兩張不同工單的 id 不會相等。

**未覆蓋**:0 個(Stryker 報告無覆蓋為 0)。

### 估算

把「等價」約 70 個從分母拿掉,分數約 81%;但我沒有逐筆證明每一個都是等價,所以**不用這個數字過關**,照 76.06% 判。補第 1–5 類測試(約 150 個存活者裡大半)很可能就過 80%。

### 補測試建議(交測試線 -1d)

1. PROBLEM 行排序:兩張工單各有 `missing`/`invalid` 的混合,斷言輸出順序(`compareRecord` 全部);READY/BLOCKED/HELD 各類行的自然排序(T2 在 T10 前)與邊的排序、去重。
2. `parseHeaderText`:空行、`#` 註解行、`key` 後面接雜訊、重複鍵、空值、`budget_usd: 1.5` 與 `1.` 與 `.5`、`status: >` 開頭。
3. `loadLandings` 的 5 種壞檔 / 缺檔。
4. 環上節點(有 deps 環的 todo 工單)不得出 READY / START。
5. 只有 R2 衝突時只印 R2 行、只有 R3 衝突時只印 R3 行;配對中兩個 id 的順序。
6. I 閘門 `I4x`、`xI4` 這類不該被當成 I 閘門。

## 6 沒有做的

- 沒有跑對抗式審核(grok):本輪變異不過關已是阻擋項,先不花這一步;補完測試再驗時再做。
- 沒有重跑 Rust cargo test:T39 沒有改任何 Rust 檔(`git diff --stat` 只有 scripts、docs、features、package.json),不適用。
- `--orca` 沒有拿真的 orca 建 task 驗證輸出(工單明說不去建 task)。

## 7 資料前後與花費

- `learning/`(唯一量法):檔數、雜湊前 16、帳本行數 前 = 後 = **64 / `c2e4dd6d71de3976` / 108**,三項前後相同。
- 花費:worker grok-4.7,記錄 $24.33,工單預算 6,**比值 4.05(> 2 倍)**,只記錄(使用者:GROK 不需要限額)。主要超在:worker 從 07 到 13 的檔頭 32 張修補與三次「先證明會紅」的重跑;我這邊沒有量 worker 的分項。驗收我用的是 CPU:變異 228 分鐘、cucumber 約 3 分鐘、完整套件兩次約 36 分鐘。
