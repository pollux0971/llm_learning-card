# T0：以 repo 根為範圍的共用資源量測

- 產出者：T0 agent
- 主機：`pollux-IdeaPad`（8 核）
- 量測日期：2026-10-01（Asia/Taipei）
- 範圍：只讀量測與選項整理；沒有修改程式、契約、`learning/` 或任何真實帳本。
- 驗收 3、4：**未做**。它們屬於測試 agent 的合成 repo 對照，尚未證明「clone 無效、worktree 有效」的機制；本報告的 A1 只量到目前真實 clone 的帳本狀態。

本文件刻意不含使用者資料：不列出 `learning/` 下的檔名、內容、題目、卡片或帳本事件；路徑一律以角色或樣式表示。

## A1：帳本母體與憑證來源

### 方法與涵蓋面

量測時由三個已知 clone 的 `git worktree list --porcelain` 取得全部已登錄位置：主 clone 1 個主簽出加 4 個 worktree、workers clone 1 個主簽出加 4 個 worktree、contracts clone 1 個主簽出，合計 11 個位置。

每個位置以 `git rev-parse --git-common-dir` 取得 common git dir，將其絕對化後取上一層，再接 `learning/`。這與 `resolveVaultRoot()` 的演算法相同；相同 clone 的 worktree 因此映射到同一個帳本。結果是 11 個位置映射為 3 個不同帳本路徑：`<主 clone>/learning/`、`<workers clone>/learning/`、`<contracts clone>/learning/`。

| 位置群組（位置數） | 解析帳本路徑樣式 | log 行數 | log 最後修改時間 | `.env` |
| --- | --- | ---: | --- | --- |
| 主 clone 主簽出 + 4 個 worktree（5） | `<主 clone>/learning/<帳本>` | 52 | 2026-09-12 23:06:33 +0800 | 只在主簽出存在；各 worktree 不存在 |
| workers clone 主簽出 + 4 個 worktree（5） | `<workers clone>/learning/<帳本>` | 檔案不存在 | — | 全部不存在 |
| contracts clone 主簽出（1） | `<contracts clone>/learning/<帳本>` | 檔案不存在 | — | 不存在 |

每列的量測日期均為 2026-10-01。主 clone 真實 `learning/` 在開工前的完整性基準為 167 個檔、整棵樹雜湊 `9cdef57ce0928a05`、帳本 52 行。

### `llm-spend --today` 的量測

依技術顧問更正，量測腳本一律從本 worktree 執行，以 `--log <帳本絕對路徑>` 指向各位置解析出的帳本；明示提供非機密的 `LLM_DAILY_CAP_USD=1`、`LLM_PRICE_IN_PER_M=2.5`、`LLM_PRICE_OUT_PER_M=10`，日期為量測當日。每個位置各量一次；相同 clone 的 worktree 因 `--log` 相同而得到相同結果。

| 位置群組（位置數） | 輸出摘要 | 退出碼 |
| --- | --- | ---: |
| 主 clone 主簽出 + 4 個 worktree（5） | 今日 `$0.0000`、0 次呼叫、今日條目 0、上限 `$1.0000` | 0 |
| workers clone 主簽出 + 4 個 worktree（5） | 算不出來：帳本檔不存在 | 2 |
| contracts clone 主簽出（1） | 算不出來：帳本檔不存在 | 2 |

停止規則結果：**沒有發現非主簽出位置的非空帳本**。workers 與 contracts 的帳本檔皆不存在，故沒有可數的 `llm_call` 行；立即停止規則未觸發。此結論只說明量測當下的檔案狀態，不能推論 clone 沒有其他憑證來源或不會進行真呼叫。

### 憑證與 gateway JWT 的來源（只列來源，不列值）

CLI 的 `_env` helper 會載入「腳本所在簽出」的 `.env`；讀不到時吞掉錯誤並保留既有 shell 環境。library router 僅讀 `process.env`。量測 shell 中沒有 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、gateway 或 `LLM_` 前綴的環境變數。

主 clone 主簽出有 `.env`，其餘兩個 clone 與所有已登錄 worktree 都沒有 `.env`。雲端憑證可來自 `OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY`；gateway adapter 的 JWT 交換起點是 `GATEWAY_API_KEY`，並使用 `GATEWAY_BASE_URL` 與本機模型設定。故目前 workers/contracts 的「無 `.env`」不等於安全：shell、CI 或其他注入來源仍可提供憑證；本次僅量到本量測 shell 沒有這些變數。

### 偏離紀錄

在收到技術顧問更正之前，曾直接於主簽出執行一次 `npx tsx scripts/llm-spend.ts --today`。該行程載入了主簽出的 `.env`；輸出為「今日 `$0.0000`、0 次呼叫、今日條目 0、上限 `$1.0000`」，退出碼 0。它是唯讀，未寫帳本、未做 provider 呼叫；但此方式不符合後來明定的量測隔離要求，故後續結果均改用上一節的 `--log` 方法。本次另以 `npm ci --offline --ignore-scripts` 安裝本 worktree 的本地相依，未執行 package scripts 或網路呼叫。

## A2：以 repo 根（或 common git dir）為範圍的資源

### 可重現掃法

在 source（排除測試檔）搜尋下列結構訊號與候選名稱：

```sh
rg -n --glob '*.ts' --glob '!**/*.test.ts' \
  'git-common-dir|resolveVaultRoot|resolveVaultLearningDir|process\\.cwd\\(' packages scripts
rg -n --glob '*.ts' --glob '!**/*.test.ts' \
  '\\.stryker\\.lock|\\.stryker-tmp|baseline\\.json|reports/|checkpoints/|testcase-names\\.txt|\\.env|learning/' packages scripts
git -C <clone-root> worktree list --porcelain
```

再以 `git rev-parse --git-common-dir` 驗證每個 worktree 的解析結果，並檢查候選路徑是否存在、其 gitignore 規則與寫入端。`checkpoints/` 在本 worktree 不存在，source 未找到以該候選根為持久輸出的 writer；`.claude/checkpoints/` 僅見 ignore 規則，故不列為已確認共用資源。

| 現行位置／解析法 | 它保護的資源實際上是什麼 | 資源實際範圍 | 現在範圍對不對（依據） |
| --- | --- | --- | --- |
| `learning/`；`resolveVaultRoot()` 以 `--git-common-dir` 的上一層定位 | LLM 花費帳本，以及使用者的持久學習資料 | 花費是同一帳號／使用者的總額；資料是該使用者的持久資料 | **不對（跨 clone）**。common git dir 只跨 worktree，不跨 clone；三個 clone 得到三個帳本。鎖／帳本範圍小於要保護的金錢資源。 |
| `.stryker.lock`；`strykerLockPath()` 同樣以 common git dir 定位 | 避免並行完整測試／變異測試互搶 CPU 的互斥鎖 | 整台機器的 CPU 與高負載測試容量 | **不對（跨 clone）**。同 clone 的 worktree 共用鎖，但 clone 各有一把；CPU 是全機器資源。 |
| 根目錄 `.env`；CLI 以腳本 URL 的上一層載入 | 雲端／gateway 憑證，以及帳號日上限與費率設定 | 憑證與日上限屬使用者／帳號；設定檔物理上則是單一簽出 | **不對，若各 clone 操作同一帳號**。clone 的 `.env` 可不同或不存在，造成憑證和日上限靜默分叉。不存在不是安全證明，shell/CI 注入仍可使其可呼叫。 |
| `scripts/zero-input-guard.baseline.json`；已版控的 repo 路徑 | 既有守門缺陷的棘輪基線，保護程式品質 | 該程式碼庫／分支的品質歷史 | **對**。它隨 Git 版本走；clone 是同一 repo 的獨立簽出，並非要跨 clone 共用的外部資源。 |
| `reports/junit/testcase-names.txt` 及 `reports/degraded/`；以工作目錄或 Git top-level 接出 | 單次驗證的診斷與報告產物 | 執行中的工作樹／commit 診斷 | **對**。報告應可與產生它的工作樹、commit 對應；不需要跨 clone 共用。 |
| `.stryker-tmp/`；每次變異測試的 sandbox | 單次 Stryker 執行的暫存檔案樹 | 單一執行／工作樹 scratch 空間 | **對**。暫存目錄不應跨執行共用；其消耗的 CPU 才由上一列的鎖保護。 |

已確認的 clone-split 範圍不符資源共有 3 類：帳本、Stryker CPU 鎖、`.env` 的帳號設定。其餘 3 類是有意依 Git 版本、worktree 或單次執行隔離。這支持「為權限而分 repo，會靜默分裂所有以 repo 根定位、但實際資源更大的項目」；是否形成更廣泛結構性問題，仍需在新增此類資源時持續套用本表判準。

## A3：帳本的選項清單（不裁決）

ADR-050 原則：**明示的丟棄可以，預設的丟棄不行**。三個選項都不應在「無法證明帳本身分」時，把花費預設為零並繼續呼叫。

| 選項 | 做法與代價 | ADR-050 評估 | 全新安裝的第一次呼叫 |
| --- | --- | --- | --- |
| (a) 使用者範圍固定絕對路徑 | 帳本改放使用者 state 目錄，例如 `~/.local/state/<專案>/`，不隨 clone 改變。需改契約 §12 與 ADR-051，應走 decision record。 | 避免預設丟棄：所有 clone 的預設位置唯一。使用者若明示清除 state，屬可見且可恢復的丟棄。 | 安裝／首次啟動在該固定位置建立目錄與身分標記，再建立空帳本；不存在僅在此初始化路徑合法。 |
| (b) 每 repo 一份，但以明確環境變數共用 | 保留目前預設布局，新增例如 `LLM_LEARNING_DIR` 的絕對路徑設定，讓各 clone 明確指向同一帳本。需定義設定的優先序、驗證與文件。 | 僅有環境變數而缺省回 repo 本地路徑，仍是預設丟棄，故不可如此做；缺設定應拒絕真呼叫或要求明示初始化。 | 初始化命令建立帳本與身分標記，並輸出需設定的絕對路徑；第一次真呼叫只有在變數指向已驗證的初始化帳本時放行。 |
| (c) fail-closed 的帳本身分證明 | 呼叫前驗證帳本身分，例如 `learning/` 內不可自動複製的 marker，含初始化產生的 UUID、版本與 canonical 位置／所有者資訊；無法證明即拒絕。代價是需設計 migration 與錯誤 UX。 | 最直接落實原則：不認得不是零，帳本不明就不花錢。marker 的刪除或重置必須是使用者明示動作，並留下可理解的重新初始化流程。 | 「全新」只能由明示 bootstrap 建立 marker 與空帳本判定；clone 內看見無 marker／不同 marker，沒有 bootstrap 證據即拒絕。如此能分辨首次安裝與 clone 的靜默新帳本。 |

上述是選項，不構成裁決或程式改動。

## 未做事項與安全界線

- 未寫驗收 3、4 的合成 repo 測試；測試 agent 應以假 adapter 驗證 clone 寫向 clone 帳本、worktree 寫向主簽出帳本，且不得碰真實 `learning/`。
- 未執行 `--live`，未設定 API key，未呼叫 provider 或 gateway；所有帳本操作為讀取。
- 開工基準與收工重量須由收工前量測比對；真實 `learning/` 必須完全相同才可完成驗收 7。
