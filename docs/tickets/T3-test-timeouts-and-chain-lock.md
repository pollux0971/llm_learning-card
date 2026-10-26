---
id: T3
deps: [T5]                          # T5 把 .stryker.lock 改成機器範圍,直接回答 B2 的跨 clone 問題;兩張都動 scripts/mutate.ts、scripts/run-tests.ts
touches: [scripts/, package.json]
cpu: light                             # 2026-10-26 縮小後只剩 B3'(一支 wrapper + 測試);整鏈計時已在 i9 常態量測
budget_usd: 2                          # 縮小後的估計
status: dispatched                           # 階段 A 已合併(docs/reviews/T3-phase-a-2026-10-14.md);階段 B 縮小為 B3'(顧問 2026-10-26),未派
owner: worker-grok                     # 預設值,派工時由協調者確認
must_catch:
  - wrapper 沒印 host / 核數 / worker 數 / 1-5-15 分 load(起跑與結束各一次):B3' 測試 a 必須紅
  - 失敗那一步的輸出被吞掉或改寫,或 wrapper 的退出碼與 check-all 不同:B3' 測試 c 必須紅
  - 每 30 秒取樣不見了:B3' 測試 b 必須紅
  - 子行程被訊號殺掉時 wrapper 回 0(或收到 SIGINT/SIGTERM 沒轉給子行程):B3' 測試 e 必須紅
---

# 工單 T3:測試逾時、自我競爭與整鏈鎖

> 狀態:第二版(技術顧問已批,含 B1a 範圍與 B2(i) 的改寫),T1 結束後由協調者派工。
> 作者:統籌·契約。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。

## 性質

兩階段。**階段 B 在階段 A 被技術顧問審過之前不得開始。**

## 背景證據

- 對照組 `e3bf2d9` 只跑三檔:1 failed(`Test timed out in 5000ms`)。
- `17dc78f` 全跑:10 failed,全是逾時,零個斷言失敗。
- 兩次的 load 不同(40 與 52),差的是程度不是性質。**不要拿 1 和 10 算比例。**
- 技術顧問的量測(2026-10-01):host=pollux-IdeaPad、cores=8。起跑 load 24.56(08:23:14),
  啟動完整鏈 90 秒後 load 50.06(08:24:44)。**load 52 大部分是這條鏈自己造成的**,不是外部變因。
  所以「等 load 降下來再跑」做不到:整套自己就是 load。

## 事實(統籌·契約量的,唯讀)

| 事實 | 量法 | 結果 |
|---|---|---|
| 測試檔母體 | `git ls-files '*.test.ts' \| wc -l` | 113 |
| 會 spawn 子程序的 | `git grep -lE "spawnSync\|execFileSync\|execSync\|child_process\|spawn\(" -- '*.test.ts'` | 32 檔(多數在 `scripts/`) |
| vitest 逾時與並行度設定 | `grep -n "Timeout\|pool\|maxWorkers\|threads" vitest.config.ts` | 無輸出:`testTimeout`、`hookTimeout`、`pool`、`maxWorkers` 全部沒設,走 vitest 預設(測試 5000ms、worker 數接近核心數) |
| 鎖 | `.stryker.lock` 出現位置 | 只在 `run-tests.ts`、`mutate.ts`、`zero-input-roster.ts` 與其測試;`check-all.ts` 沒有任何鎖 |
| `check-all.ts` 的歸屬 | 檔頭 | `SOURCE: template v1.6.8 … 勿手改`,是模板擁有的檔,不能在本 repo 直接改 |

所以 5000ms 是「**從來沒有人做過這個決定**」,不是「有人選了太小的值」。

## 活的範例(技術顧問實測,A1/A3 的第一列)

`scripts/degraded-report.test.ts` 的測試「probe:1 passed、1 `ctx.skip()`(skip 前觸發一個訊號)、1 `it.skip`、1 todo →
passed 一列 ran + 兩列 skipped,outside 0」。協調者 A 組鏈(tip `903493c`,2 個 worker)中:
`Test timed out in 5000ms`,實際 5652ms,**零個斷言失敗**。同一個測試、同一份沒變的程式
(degraded-report 三個檔在 `17dc78f` 與 `903493c` 之間 diff 為空)的耗時:

| 條件 | 耗時 |
|---|---|
| 孤立單獨跑 6 次(load 21–25) | 3.0、1.8、1.1、1.1、1.5、2.8 秒 |
| 鏈內,`17dc78f` 那次(2 worker,load 26–28) | 未逾時 |
| 鏈內,A 組(2 worker,load 24–26) | 5.65 秒(上限 5 秒) |
| 鏈內,第一輪(預設約 7 個 worker,load 50–78) | 12.2 秒 |

孤立最慢 3 秒,鏈內因為另一個 worker 同時在跑,尾端超過 5 秒。這個測試會起**內層 vitest**,所以對 CPU 競爭特別敏感。
這就是 A3a / A3b 兩種量測存在的理由:**同一個測試在「孤立」與「鏈內」的耗時比**。
**A2 要把它列為 (b)「從未被決定過」的第一筆,但不預先選 timeout 數字,要從 A3 的分佈量出來。**
注意:2 個 worker 在同一條件下有一次綠一次紅,所以「2 個 worker」不是可靠的綠。

## 階段 A(只量,不改程式)

**A1 盤點。** 列出 32 檔裡每個會 spawn 子程序的測試,欄位:檔案:行、測試名、spawn 什麼、有效逾時
(明寫 or 預設 5000)、來源行、**是否 spawn 到會編譯的東西**(cargo build、tsc 等;之後 cargo-mutants
進來,一個 spawn npm 的和一個 spawn cargo 的耗時差一個量級)。母體大小寫在報告最前面。
方法說明必須寫:光 `grep 'timeout'` 會把 `scripts/mutate.test.ts` 第 2915、2931 行、
`scripts/reports-persist.test.ts` 第 184 行的 `timeout: 1` / `timeout: 0` 混進來——那是被測程式的參數,
不是 vitest 的測試逾時。

**A2 分類。** 每個測試三選一,每列附證據(把逾時拉大之後斷言還成不成立;讀碼,必要時實跑):

- (a) 逾時是斷言的一部分(拉大 10 倍會改變測試的意義)。
- (b) 從來沒有被決定過(沒有人選過這個值,是未填的空格)。
- (c) 不確定。判不了就列 (c),不要硬塞 (a) 或 (b)。

**A3a 單獨量。** 一次只跑一個 spawn 測試,其餘不跑;每個測試三次;記耗時、host、cores、load(1/5/15)。
得到「沒有自我競爭時要多久」。

**A3b 整套量。** 跑整套,記同一批測試在整套平行時的耗時;至少三輪;記 host、cores、worker 數、起跑 load。
得到「113 個檔平行跑的時候要多久」。

**兩者的比值**就是自我競爭讓這個測試慢幾倍。5000ms 預設值該不該動,取決於這個比值,不取決於任何一次耗時。
一次的耗時也不告訴你變異度:平均 1000ms 偶爾 4800ms 的測試,比穩定 4000ms 的更危險。

**A4 報告。** 放 `docs/reviews/`,帶 host、worker 數、load。報告要寫明**本工單不寫 `.feature`** 的理由:
守門基礎設施的驗收方式是 `scripts/*.test.ts`(現有 20 支守門、28 支測試,零個 `.feature`);
gherkin 的價值是用使用者的語言表達產品行為,一把跨 worktree 的檔案鎖沒有使用者可見的行為,
它的規格就是它的測試。這是對 CLAUDE.md「沒有 gherkin 不寫程式」(強烈建議)的有說明的例外。

**顧問審過 A 才開 B。**

## 階段 B(2026-10-26 縮小為 B3',技術顧問裁決)

**只做 B3'。B1a、B1b、B2 都不做**,理由與重開條件如下;下面「B1」「B2」「B3」三節保留原文作紀錄,**不是這張要做的**。

| 項目 | 狀態 | 理由 | 重開條件 |
|---|---|---|---|
| B1a worker 數曲線 | 不做 | 驗證鏈已固定 `VITEST_MAX_WORKERS=1`,且鏈改在 32 執行緒的 i9 上跑(起跑 load 約 1、21 分鐘、7000 多條全綠);曲線的動機(筆電被自己吃滿)已不存在 | 安靜起跑(1 分 load < 4)的 1-worker 整鏈仍然出現逾時 |
| B1b 個別逾時 | 不做 | 同上;i9 上零逾時 | 同上 |
| B2 整鏈鎖 | 不做 | 重活改在 i9,由協調者排位子(§4g 第 5 條),實務上同時只有一條鏈 | 出現兩條鏈在同一台機器互撞的事實 |

### B3' 鏈輸出 wrapper

讓 `npm run check:all` 在每次整鏈前後多印機器狀態,事後分得出「程式變慢」和「機器變忙」(§4e「回報要帶」那五個欄位)。

- 新增 consumer 自己的 wrapper 腳本(`scripts/` 底下),`package.json` 的 `check:all` 改成呼叫它(所以 `touches` 含 `package.json`),它再啟動原本的 `scripts/check-all.ts`。**不得修改 `scripts/check-all.ts`**(檔頭有 `SOURCE: template` 標頭,勿手改)。
- **輸出通道(顧問裁)**:wrapper 自己印的行(起跑、取樣、結束)**全部寫 stderr,加固定前綴 `[chain-env]`**;子行程的 stdio 用 `inherit`,wrapper 一個位元組都不經手。所以 stdout 的最後一行仍是 check-all 自己印的 `gate=all result=...`(合併 2>&1 後,結束行會排在 gate 行後面,可接受)。
- 起跑與結束各印一行,欄位:`host`(os.hostname())、核數(`os.availableParallelism()`)、worker 數(讀 `VITEST_MAX_WORKERS`;沒設就印 `default`,**不猜數字**)、1/5/15 分 load、時間戳(ISO 8601 含時區)。
- 執行期間每 `CHAIN_ENV_SAMPLE_MS` 毫秒印一行 load 取樣(預設 30000)。**壞輸入不准安靜照跑**:值不是正整數、或小於 100,在啟動 check-all 之前就以**退出碼 2** 結束,訊息點名 `CHAIN_ENV_SAMPLE_MS`。取樣計時器在子行程結束時要清掉,且不能讓 wrapper 卡著不退出。
- **參數原樣轉發**:wrapper 把 `process.argv` 的使用者參數全部傳給 `check-all.ts`。
- **退出碼與訊號**:退出碼與 check-all 相同;子行程被訊號殺掉時,退出碼 = 128 + 訊號編號,**不准回 0**;wrapper 自己收到 SIGINT / SIGTERM 要轉給子行程。
- **零輸入守門**:新增的 `.ts` 要登記 `scripts/boundaries.owners.json`,並在 `scripts/zero-input-roster.ts` 登記成 entry,沿用 check-all 那四個 `--root` 假 consumer 探針(builder 共用,不要複製一份),讓零輸入守門跑它時不起真的整鏈、不遞迴;`scripts/zero-input-guard.test.ts` 要通過(§4c 第 4 條)。
- **測試注入**:要換掉被包的指令只能用匯出的函式(例如 `runWrapped({ command, args, intervalMs })`),CLI 不開這個口。
- `npm run check:all` 之後的使用者(i9 的 `run-sha.sh`/`run-chain.sh`、驗證鏈指令)不需要改。

### B1 自我競爭與逾時(兩件一起量、分開記)

**B1a 限制 vitest 的 worker 數。** `vitest.config.ts` 現在完全沒設 `pool` / `maxWorkers`。
8 核預設開接近核心數的 worker,每個 worker 裡的測試又各自 spawn 子程序,約 16 個行程搶 8 核。
工單**不裁數值**,產出「worker 數 → 整套耗時與逾時數」的曲線,至少三個點(例如 8、4、2),
每點記 host、cores、起跑 load、耗時、逾時數。`timeout` 與斷言不動。
曲線點至少含:**預設(約 7–8 個 worker)、4、2、1**。技術顧問已把驗證鏈的 worker 數從 2 改成 1,依據是上面的量測不是結果;
1 個 worker 的整套耗時還沒量,**不給數字**,由本工單量。

> 顧問已裁(2026-10-01):B1a **只在量曲線時用 CLI 旗標**,**不改 repo 預設值**;量完回報顧問,再裁預設值。
> 理由:量測與政策分開——若量曲線時就改了 config,曲線是在改過的 config 上量的,沒有「改之前」的對照。
> **明確禁止項(不是註解)**:不得修改 `vitest.mutate.config.ts`(另一份設定,看起來很像,
> 順手改兩份的人不會覺得自己做錯了什麼);不得修改 `vitest.config.ts` 的 `maxWorkers` / `pool` / `testTimeout`。

**B1b 逾時。** 只動 A2 的 (b) 類(從來沒被決定過的),用單一測試的 `timeout` 參數;
不動全域 `testTimeout`(那要另行裁,因為它會讓真的卡死的測試也拖更久才被發現);(a)(c) 不動。
順序:先 B1a,看曲線,再決定 B1b **需不需要**(若限 worker 數就讓逾時歸零,那些 timeout 本來就不是問題,問題是並行度);**一次只動一個變因**,同時動兩個永遠分不出是哪一個起作用。

### B2 整鏈鎖(次要)

解決的是「兩條鏈互撞」。**一條鏈自己就能把 8 核吃到 load 50,所以鎖裝好之後單條鏈仍可能逾時,
那屬 B1,不屬 B2。** 「先量 load 再決定跑不跑」不算鎖。

第一步先回答:

- (i) **鎖的範圍要不要跨 clone**(舊版寫「鎖放哪」,已作廢——那個問題有現成答案)。現有的鎖路徑算法在
  `scripts/mutate.ts` 的 `strykerLockPath()`(註解自己寫了為什麼):用 `git rev-parse --git-common-dir`
  取主 repo 的工作目錄,所以**所有 worktree 算出同一個路徑**;**照它做,不要重新發明**。
  但它解決不了 **clone**,因為 clone 有自己的 `.git`。技術顧問 2026-10-01 實測五個位置算出**三把**不同的鎖:
  `/data/python/llm_learning-cards`(含 `/tmp/verify-120` 這類 worktree)、
  `/data/python/llm_learning-cards-workers`(含 `~/orca/workspaces/llm_learning-cards-workers/*` 的 worktree)、
  `/data/python/llm_learning-cards-contracts`。今天早上只有一把:為了讓不該推的角色推不出去而開的 clone,
  把跨 worktree 的互斥切成互不相通的區域,而它們搶的是同一台 8 核機器。同形狀:ADR-051
  (`resolveVaultLearningDir` 解到主簽出,`--git-common-dir` 解到主 repo 的 `.git`,兩者在 worktree 下等價、
  在 clone 下不等價)。**現有的鎖在今天的新結構下已經犯了這個錯,不是「未來的新鎖可能犯」。**
  兩個選項,**工單不裁,要量出依據再回報顧問**:
  - 跨 clone(鎖在以主機為範圍的固定路徑,如 `/tmp` 或 `~/.cache` 底下):反映實際資源競爭(CPU 整台共用);
    代價是同一台機器上別的 repo 用同一個模板時會互相擋。鎖識別要含「哪個 repo 的哪個任務」
    (現有鎖檔已有 `pid`、`startedAt`、`cwd`、`task` 四個欄位,夠用)。顧問傾向此選項,但未裁。
  - 不跨 clone(維持現狀):clone 之間互不干擾,但只是名義上的——它們搶同一顆 CPU。
  **A 階段要加一條量測**:此刻這台機器上有幾個位置算出**不同**的鎖路徑(母體)。今天從 1 變 3,
  會隨著開 clone 繼續變;報告記下日期與清單。機制在哪個檔:`scripts/mutate.ts`(以及 `run-tests.ts`)
  檔頭**沒有** `SOURCE` 標頭,是 consumer 自己的檔,可以改;`check-all.ts` 有,不能改。
- (ii) **N 是多少**:從 8 執行緒與 A3b 量出的單鏈 CPU 占用推,不憑印象。
- (iii) **鎖被占時**:等多久、輸出誰占著(host / pid / 開始時間)、孤兒鎖怎麼辦。
- (iv) **做在哪**(顧問已裁):現在做 1 —— 本 repo 的 `package.json` 讓 `check:all` 包一層 wrapper 腳本
  (consumer 自己的檔,**不動 `check-all.ts`**);同時做 2 的前半 —— 上游提案給 dev-paradigm,內容是
  「請提供整鏈取鎖的機制,N 與鎖路徑由 consumer 設定」,不是「請改 `check-all.ts`」。提案送出時機:
  A 階段報告出來之後(提案要帶量測)。現在不改模板:`/data/python/dev-paradigm` 有未追蹤項目、
  多個 dev-paradigm session 在線,那棵樹在動。

### B3 鏈輸出

鏈開始、結束、每一步都印 host、worker 數、1/5/15 分 load。

### 射程句(原文,必須寫進報告)

> 本鎖解決整條 check:all 之間的互斥;與 .stryker.lock(變異測試之間互斥)是兩把,各管各的;
> 不解決單條鏈內部的 CPU 占用。

單條鏈內部的 CPU 占用屬 B1,不屬 B2。

## 驗收條件

**2026-10-26 縮小後只有下面 B3' 的 a–e 與 A 報告(條件 1,已完成)有效;條件 2–7 對應 B1/B2,不做。**

- B3' a:wrapper 的起跑與結束各在 stderr 印出 `[chain-env]` 行,含 host、核數、worker 數(有設 `VITEST_MAX_WORKERS` 印數字,沒設印 `default`)、1/5/15 分 load、ISO 8601 含時區時間戳;子行程 stdout 不含這些行。
- B3' b:執行期間按 `CHAIN_ENV_SAMPLE_MS` 間隔印 load 取樣行(測試用短間隔,斷言行數 ≥ 預期;子行程結束後不再印、wrapper 不卡住);`CHAIN_ENV_SAMPLE_MS` 為非正整數或小於 100 時,在啟動被包指令之前退出碼 2 且訊息點名該變數、被包指令一次都沒跑。
- B3' c:被包的指令失敗時,wrapper 退出碼相同、失敗輸出逐字出現在 stdout/stderr 原通道(用會印特定字串並以非零退出的假指令驗證);成功時退出 0 且 **stdout 的最後一行**是被包指令自己的最後一行;參數原樣轉發。
- B3' e:被包的指令被訊號殺掉 → wrapper 退出碼 = 128 + 訊號編號(不是 0);wrapper 收到 SIGINT / SIGTERM 時子行程也收到。
- B3' d:`scripts/check-all.ts` 一個位元組都沒動(`git diff` 為空);`npm run check:all` 的行為對其他使用者不變。

1. A 報告存在:母體大小在最前;每列有 a/b/c 與證據;A1 有「會編譯」欄;方法說明有 `grep 'timeout'`
   的陷阱;A3 同時有 a 與 b 兩組數字與比值,每個測試三次耗時。
2. **對照(B1 之後)**:比較要在「同 worker 數、同起跑 load 區間」下做,每組記 host、cores、worker 數、
   起跑 load。不同 worker 數的結果不當同一組比。若「改後 0 逾時」但「同設定的改前」不是原本那批逾時數,
   **整個對照作廢,重做**(母體本身不穩定,10→0 沒有意義)。
3. **B1a**:有至少四個 worker 數的曲線(預設、4、2、1),每點有 host、起跑 load、耗時、逾時數。
4. **鎖的正向測試**:同時起兩條鏈,第二條必須等或被拒,並印出第一條的 host / pid。
   對照:把鎖拿掉,第二條立刻跑起來,測試必須紅。
5. **鎖的範圍**(依 B2(i) 回報後顧問的裁決):若裁跨 clone,在兩個不同 clone 各起一條鏈,仍互斥;若裁不跨,測試要證明同一 clone 的兩個 worktree 互斥(沿用 `--git-common-dir`)。A 報告的「不同鎖路徑位置清單」存在。
6. **孤兒鎖**:殺掉持鎖行程,下一條鏈能接手,並印出「接手了孤兒鎖」。
7. **鏈輸出**每步都有 host / worker / load。

## 測試誰寫

- 測試 agent 寫 B3' a–e 的測試(原 4–7 不做;用 `scripts/*.test.ts`,不寫 `.feature`)。
- 開發 agent 只寫實作,不改測試。
- 審核 agent 做 A 的抽樣獨立重量、驗收 2 的對照、鎖測試的變異。
  A 的報告不是審核 agent 自己產出的證據,審核 agent 要自己重量其中抽樣的列,不收轉述。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,同一時間一個 agent。

## 不在範圍

- 全域 `testTimeout`(要另行裁)。
- `vitest.config.ts` 的 `maxWorkers` / `pool` / `testTimeout` 成為 repo 預設值:量完曲線、顧問另裁之前不在範圍;`vitest.mutate.config.ts` 一律不動。
- 鏈內 18 個不拿鎖的步驟如何各自限流。
- 統一字數實作。

## 派工時機

T1 結束前不疊第二張。
