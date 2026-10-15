---
id: T17
deps: []
touches: [scripts/review.ts, packages/core/src/session/build.ts, packages/core/src/session/cache.ts, packages/core/src/session/io.ts, packages/core/src/session/types.ts, packages/core/src/session/summary.ts, packages/core/src/session/index.ts, packages/core/src/session/present.ts]
cpu: light
budget_usd: 4
status: todo
owner: worker-grok
must_catch:
  - 同一天再跑一次,題目集合被重建(當天新到期的卡混進來,或順序變了),而不是用第一次建好的那一份
  - 中斷後續答從第一題重新開始,或進度不是「已答 2 / 共 5」,或已經答過的卡又被問一次
  - 跨午夜沒有重建,或昨天的快取檔還留著,或昨天沒答的卡沒有多逾期一天
  - 續答後小結只算本次執行答的(passed / returned 沒有包含早先執行已答的卡),或明日預估的回退數用的是本次的計數器
  - 批改失敗的題被算進 passed 或 returned,或沒有列「待重試 N 題」(N 不是名單裡沒有今天 history 的卡數),或沒印「本次作答 N 題」
  - 快取壞掉(不是合法 JSON、或欄位不合格式)時整個指令當掉,或沒有重建,或沒有寫一筆 warning 事件,或把已經記錄的答案忘掉
  - --pause 把任何一張卡記成答錯(reviews.json 有變動),或沒有在快取標記暫停
  - 暫停的那天再跑,仍然開始問題;或沒有說「今天已暫停」
  - --unpause 之後題目集合不是原本那一份,或還在暫停
  - --dry-run 建立或修改了快取檔,或列出的不是「剩下的題目」
  - 複習結束沒有呼叫 snapshot;--dry-run 或 --pause 卻呼叫了
  - snapshot 失敗(not-a-repo、git 錯誤)時退出碼變了,或沒有印出提示,或 not-a-repo 的提示沒說「跑 cli.ts init」
  - 快取寫進 learning/ 底下(含 state/),或被 snapshot commit 進 learning/ 的 git;或寫入不是原子的(沒走 writeFileAtomic)
  - 快取沒有用 vault_id 分開(換一本帳本讀到別本的快取),或 XDG_CACHE_HOME 為空字串時沒當成未設
  - 見證訊號(witness)或 boundaries 例外沒補,npm run boundaries 紅
---

# 工單 T17:11-review-cli phase-2 —— 續答、跨日、暫停、dry-run 完整化、結束時 snapshot

> 狀態:草稿,待技術顧問審(派令來自顧問 2026-10-16)。**編號暫定 T17,協調者配。**
> 作者:統籌·契約(測試 agent 身分寫紅測試)。派工:協調者。驗收:-ed。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 規格來源:`features/11-review-cli/phase-2.feature`(場景 1–8,**不改**)、同檔新增的 3 個 snapshot 場景(與本工單同批進來)、
> `features/11-review-cli/FEATURE.md` 的「snapshot 的呼叫點(ADR-042)」、`features/01-data-layer/phase-4.feature`。
> **gate 的解讀**:`features/11-review-cli/NEXT.md` 寫「I2 通過」,依 **ADR-073**(I2 不打 tag,自動驗收通過、人工確認延到 I4)要讀成「I2 自動驗收通過」。
> 小結的算法(今天這一輪)依顧問 2026-10-16 裁決;`phase-2.feature` 因此新增 2 個場景,既有場景文字不動。
> 這是 I3 的第一張工單(I3 在 I2 自動驗收通過的基礎上開工)。

## 已裁決的取捨(技術顧問 2026-10-16)

**Q1(顧問 2026-10-16 已裁決)· 當日快取放哪裡?** 放在 **`${XDG_CACHE_HOME:-~/.cache}/llm-learning-cards/<vault_id>/session-<YYYY-MM-DD>.json`**,
**不放在 `learning/` 裡**(不是使用者的資料、可以丟掉重建,也不該被 snapshot commit 進去)。契約 §12 不動,不必問使用者;理由記在 ADR-074。
`XDG_CACHE_HOME` 為空字串視同未設(跟 `XDG_CONFIG_HOME` 的規則一樣)。寫入照樣走 `writeFileAtomic`(對快取沒有壞處);讀不到或壞掉就丟棄重建並記一筆 warning 事件。
`<vault_id>` 的來源(我的決定,請審):讀 `<learning 目錄>/config/vault-id`(契約 §12 的身分標記,內容是 uuid、容許一個結尾換行);**複習不需要帳本身分**(契約:沒有 `vault-id` 的目錄複習不受影響,
`standalone.json` 與 fixture 目錄也沒有),所以沒有或格式不對時,改用 `path-` 加上「`--dir` 解析成絕對真實路徑後 sha256 的前 16 個十六進位字元」當資料夾名。

**Q2(顧問已同意)· 因錯誤而沒有結果的卡,續答時要再問。**(批改失敗時卡片不動,見 phase-1「A grading error leaves the card alone」)
「已答」= 這張卡在 `reviews.json` 的 `history` 裡有一筆 `date` 等於今天;錯誤沒有寫 history,所以續答時會再出現一次。

**Q3 · 編號。** 協調者配。

## 為什麼有這張

phase-1(I2)做好了「建 session → 逐題作答 → 立即落地 → 小結」,但每次執行都是從頭再建一份:

- 中途離開,再執行會重新建 session;期間新到期的卡混進來,題目數和順序都變;
- 沒有「今天不想複習」;
- `--dry-run` 只能列出「如果現在建會考什麼」,不是「這個正在進行的 session 還剩什麼」;
- ADR-042 規定「每天備份一次」靠**複習結束時呼叫一次 snapshot**,CLI 還沒做。

這些是 `FEATURE.md` 說的「真的用過一週才看得出來的細節」。I2 的人工確認延到 I4(ADR-073),但自動場景和資料層(`snapshotLearningDir()`,01 phase-4)都已經在,所以不必等。

## 驗收條件

### 1. 當日快取 `${XDG_CACHE_HOME:-~/.cache}/llm-learning-cards/<vault_id>/session-<YYYY-MM-DD>.json`

- **建立**:當天第一次執行(互動或 `--pause`)時,在 `buildTodaySession` 算出題目集合之後、問第一題之前,用 `writeFileAtomic` 寫入(目錄不存在就先建,權限預設即可)。**`--dry-run` 永遠不建立、不修改。** 快取的位置只來自環境(`XDG_CACHE_HOME`、`HOME`)與 `--dir` 底下的 `config/vault-id`;`learning/` 底下不新增任何檔案。
- **之後同一天執行**:讀快取,**題目集合與順序用快取裡那一份**(`queue`、`reteach`、`total_due`、`deferred`),不再呼叫 `selectSession` 重新選;
  當天新到期的卡不加進來(等明天,NEXT.md 已定案)。
- **已答的不再問**:快取的 `queue` 裡,`reviews.json` 該卡的 `history` 有一筆 `date === today` 者視為已答,略過。進度分子 = 已略過 + 目前題號,分母 = `total_due`
  (例:5 題答了 2 題,續答時第一題顯示「3/5」,分母是當天整個 session 的題數。)
- **小結是「今天這一輪」的結果**(顧問裁決 2026-10-16,取代「只算本次執行」):有當日快取就表示**一天一個 session**,續答是同一個 session 的延續,不是新的一次。
  小結的 `passed` / `returned` 從 `reviews.json` 算,不從記憶體的計數器抄:

  - 範圍 = 當日快取名單(`queue`)裡的卡,而且該卡 `history` 有 `date === today` 的筆。
  - 一張卡「通過」= 它今天的那幾筆(stage 2 會有填空、應用兩筆)每一筆的有效結果都是通過;**有效結果 = `revised_to ?? pass`**(雲端改判過的以改判為準)。
    只要有一筆是未通過,這張卡就是「回退」(returned)。每張卡只算一次。
  - 批改失敗的題(卡片沒動、`history` 沒有今天的筆)**不算進 passed / returned**,另外列成「待重試 N 題」:N = 名單裡沒有今天的 `history` 的卡數(跑完整個迴圈後留下的就是它們;下次續答會再問,見 Q2)。
  - 另加一行「**本次作答 N 題**」:N = **這一次執行**裡使用者送出答案的題數(填空題、應用題各算 1 題;批改失敗的也算,因為使用者答了)。這是唯一只算本次的數字。
  - 文字(沿用 phase-1 的英文小結格式;紅測試只釘數字):`<P> passed, <R> returned.`、`Answered this run: <N>.`、`Retry later: <K> question(s).`(K = 0 時整行不出現,取代 phase-1 的 `N question(s) had a grading error and were skipped.`)、`Tomorrow: …`(照舊)。
  - 明日預估的 `returnedToday` 也用同一個 R(今天這一輪的回退數),不再用本次執行的計數器。
  - 一次跑完、沒有續答的 session,小結跟 phase-1 完全一樣(phase-1 的小結場景不變);`SessionSummaryInput` 多 `answeredThisRun`、`retryLater` 兩個欄位,`summary.test.ts` 由測試 agent 同步。
- **本次作答 0 題**(例如續答時名單全是已答、或進來就離開):照樣印小結,`Answered this run: 0.`;不呼叫 snapshot(見第 4 點)。
- **跨日**:快取的 `date` 不等於今天(或檔名日期不等於今天)→ 用 `reviews.json` 重新建;**建好今天的之後**刪掉這個 `<vault_id>` 資料夾裡所有其他日期的 `session-*.json`(別的帳本的資料夾不動)。
  昨天沒答的卡仍然到期,所以自然多逾期一天(04 的 `overdue_days` 由 `reviews.json` 算,不是從快取抄)。
- **快取讀不到或壞掉**(不是合法 JSON、或欄位不合下面的格式):丟掉、重建、**寫一筆 `warning` 事件**到 `state/log.jsonl`(`reason: "session-cache-invalid"`,`path` 是快取檔的檔名,不寫絕對路徑;
  事件欄位照契約 §10 與既有 warning 事件,不新增欄位),不當掉。重建時「已答的不再問」照常成立(它看 `reviews.json`,不看快取)。
- **快取格式**:

  ```json
  { "version": 1, "date": "2026-10-16", "paused": false, "total_due": 5, "deferred": 0,
    "queue": [ { "card": "<CardId>", "stage": 1, "overdue_days": 0, "overdue_ratio": 0 } ],
    "reteach": [ "<CardId>" ] }
  ```

  `queue` 的欄位就是 04 `DueItem` 的欄位(`card`、`stage`、`overdue_days`、`overdue_ratio`);讀回來用 zod 驗證(`SessionCacheSchema`,放 `packages/core/src/session/cache.ts`),
  未知的 `version` 當壞掉。**不存 `learned_at`、不存答案、不存分數**:那些以 `reviews.json` 為準,快取只記「今天的題目名單」。

### 2. 暫停

- `--pause`:不需要指標檔、不需要帳本、不評分。快取不存在就先建(帶 `paused: true`),存在就把 `paused` 設成 `true`;**不改 `reviews.json`、不改 `weekly.json`、不寫 `reviews` 類事件**。印「今天已暫停」,退出碼 0。
- 暫停的那天直接再執行(沒帶旗標):**在查帳本之前**印「今天已暫停,要繼續請加 --unpause」,退出碼 0,不問任何題目、不 snapshot。
- `--unpause`:把 `paused` 設回 `false`,題目集合維持快取裡原來那份(包括已答的略過),印「已恢復今天的複習」並**接著**照一般執行(進入答題)。`--pause` 與 `--unpause` 同時給 → 用法錯誤(退出碼 1)。
- 日期換了,暫停就失效(昨天的快取在跨日時被刪)。

### 3. `--dry-run` 反映真實 session

- 今天已有快取:列出**剩下還沒答的**題目(跟互動模式接下來會問的同一份、同順序),標題行說明「已答 X / 共 N」;**不修改快取**(檔案內容與 mtime 都不變)。
- 今天沒有快取:行為跟 phase-1 一樣(現算,不建快取)。
- 快取壞掉:`--dry-run` **不重建、不寫 warning**(它不寫任何東西),照「現算」處理並在輸出說明快取無法讀取。

### 4. 結束時 snapshot(ADR-042)

- `scripts/review.ts` 的 `main()` 在印完 `renderSummary(...)` **之後**呼叫一次 `snapshotLearningDir(dir)`(`@core/schema/git-repo.js`)。
- `--dry-run`、`--pause`、暫停日的直接執行、`--unpause` 之後**沒有答任何題就離開**:不呼叫 snapshot(沒有變更 snapshot 本來也是 no-op,但 dry-run 的契約是不寫任何檔,commit 也是寫)。
  其餘照一般結束:本次作答 ≥ 1 題就呼叫。
- **snapshot 失敗不影響複習**:不改退出碼、不丟錯;印一行提示。`not-a-repo` 的提示要說「跑 `cli.ts init` 就會補上版本控制」;其他失敗印原因。
- `11-review-cli → 01-data-layer` 的 boundaries 例外已經在 `scripts/boundaries.allow.json`,不新增。

### 5. 檢查順序(接在 T13 的順序後面,早的先擋)

1. 參數不全 → 用法錯誤(1);`--pause` 與 `--unpause` 同時給 → 用法錯誤(1)。
2. 磁碟上 0 張卡 → 既有的「沒有卡片」(1)。
3. `--pause` / `--unpause` / `--dry-run`:處理完就結束(`--unpause` 例外,見第 2 點,結束 pause 後繼續到 4)。
4. 今天的快取標記為暫停 → 印暫停訊息,退出碼 0。
5. 互動模式查帳本(`resolveVerifiedLedger`,失敗退出碼 2)。
6. 讀或建快取 → 答題 → 小結 → snapshot。

### 6. 不退步

- phase-1 的場景全綠;`scripts/review.test.ts`、`packages/core/src/session/*.test.ts` 全綠;`standalone.json` 的 `11-review-cli` 單獨執行照舊(`--dry-run` 不需要指標檔)。
- 變異門檻**標準 80%**(FEATURE.md):session 邊界邏輯(快取讀寫、已答判定、跨日、暫停)要被測到;IO 與印出文字不用。-ed 驗收時跑。

## 紅測試(另一個角色寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量 |
|---|---|---|
| 1 | 當日集合固定、續答、已答不再問、跨日、壞快取 | `phase-2.feature` 場景 1–4、7 的步驟定義(`features/steps/review-cli-phase2.steps.ts`),在暫存的 learning 目錄上跑真的 `scripts/review.ts`(輸入用 stdin,環境變數 `XDG_CACHE_HOME`、`HOME` 指向暫存目錄),查 `reviews.json`、快取檔、`log.jsonl` |
| 1 | 快取格式與位置 | `session/cache.test.ts`:`SessionCacheSchema` 接受上面的格式、拒絕未知 version / 缺欄位 / 多餘的 `learned_at`;路徑在 `XDG_CACHE_HOME` 底下(測試一律 `mkdtemp` 當 `XDG_CACHE_HOME`;空字串視同未設 → `$HOME/.cache`,`HOME` 也用暫存目錄);`<vault_id>` 分開(兩本帳本互不看見);沒有 vault-id 時用 `path-<16 hex>`;寫入走 `writeFileAtomic`(殘檔 `.tmp` 不留);`learning/` 底下沒有多出任何檔案 |
| 1 | 小結 | 新增的 2 個 phase-2 場景(續答後的小結涵蓋整天、批改失敗列待重試);`summary.test.ts` 的 `SessionSummaryInput` 新欄位;passed/returned 以 `revised_to ?? pass` 與 stage 2 兩筆合成一張卡驗證;未續答的 session 小結位元組與 phase-1 相同 |
| 2 | 暫停 | 場景 5、6;另測 `reviews.json` 位元組不變、`--pause`+`--unpause` 同時給 → 1 |
| 3 | dry-run | 場景 8;快取位元組與 mtime 不變;沒有快取時不建立 |
| 4 | snapshot | 新增的 3 個場景(結束時 snapshot、dry-run 不 snapshot、失敗不影響退出碼與 not-a-repo 的提示);用暫存 git repo 驗 commit 真的出現(且 commit 裡沒有快取),用非 repo 目錄驗提示 |
| 5 | 檢查順序 | 暫停日不需要指標檔;0 張卡仍是 1 |
| 6 | 不退步 | phase-1 場景、既有單元測試照跑 |

- 紅測試用**暫存的 learning 目錄與暫存的 `XDG_CACHE_HOME`、`HOME`**(`mkdtemp`),不碰真的 `learning/` 與真的 `~/.cache`;不呼叫真的 LLM(應用題用 T13 之後的注入 router 或只用填空題)。
- 基底上預期:場景 1–8 與 snapshot 場景紅(功能還沒有);phase-1 綠。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/session scripts/review.test.ts
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@review-cli and @phase-2 and not @manual' --format summary
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@review-cli and @phase-1 and not @manual' --format summary
npm run boundaries
```

- 環境:`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`。cucumber 一律用 `--tags`,不給 feature 檔路徑;每次 `BeforeAll` 會 `cargo build --bin lc-fs`,先跟協調者拿位子。
- 不跑變異測試(-ed 的事)、不跑 `npm run check:all`、不碰真的 `learning/`、不加 `--live`。

## 不在範圍

- 不改 `.feature` 與任何測試檔(`*.test.ts`、`features/steps/`);覺得測試錯了就停下回報協調者。
- 不加 CLI 的學新卡指令(ADR-073)。不做桌面視窗版(06 的兩個 phase 是另一張,前端起草)。
- 不改 04 的排程邏輯、不改 05 的審核;不在 `learning/` 底下新增任何檔案(快取在 XDG cache)。
- 不改 `contracts/types.md`(§12 不動,ADR-074)。

## 預算

`budget_usd: 4`。grok 不設花費上限(使用者 2026-10-15),只記錄;算不出來寫「不知道」。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間一個 agent。派工歸協調者。
排程:改 `packages/core/src/session/` 與 `scripts/review.ts`;期間不要開別的改這兩處的工單。
