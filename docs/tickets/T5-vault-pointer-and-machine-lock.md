---
id: T5
deps: [T0]
touches: [packages/core/src/llm/, packages/core/src/prompt-quality/, scripts/llm.ts, scripts/llm-spend.ts, scripts/vault.ts, scripts/vault.test.ts, scripts/mutate.ts, scripts/run-tests.ts, scripts/check-ledger-pollution.ts]   # scripts/vault.ts 與 vault.test.ts 的落點(03-llm-router)已隨本批登記進 boundaries.owners.json
cpu: light                             # 驗收階段跑變異是重活:協調者排驗收時照 R3 當 heavy 算(檔頭一個欄位表達不了「某階段才重」)
budget_usd: 6
status: todo
owner: worker-grok                     # 預設值;這張牽涉錢,派工時協調者確認
must_catch:
  - 拿掉身分比對(標記不符仍放行)
  - 指標檔不存在時退回 git-common-dir
  - 身分沒驗證過時 readDailySpend 回 0(含 GatewayLlmRouter 沒有帳本時回 0 的那條路)
  - init 不加 --force 就覆寫指向別處的指標
  - 標記只比前綴(uuid 前 8 碼相同就放行)
  - learning_dir 是相對路徑也放行
  - 鎖路徑退回每個 clone 一把
  - 測試讀到或改到真的指標檔
  - 真呼叫的 router 收了 ExplicitLedger(未驗證的帳本)
  - 正式程式的預設路徑走 ExplicitLedger
---

# 工單 T5:帳本的位置由使用者層指標決定,加帳本身分;鎖改成機器範圍

> 狀態:草稿,待技術顧問審。**錢相關,最優先。**
> 作者:統籌·契約。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 裁決來源:技術顧問 2026-10-15,依據 T0 報告 A3 的 (a)+(c);使用者 2026-10-15 在顧問 session 裁決
> 「帳本 A(帳本與 `.stryker.lock` 跨 clone 共用)」「push 維持顧問」(依顧問轉述)。契約 §12 因此升版,見 ADR-066。

## 起因與事實

T0 量到並由合成 repo 證實:`learning/` 的位置現在是「`git rev-parse --git-common-dir` 的上一層加 `learning/`」(`packages/core/src/llm/vault.ts`
的 `resolveVaultLearningDir`)。它在 **worktree** 之間算出同一個位置(ADR-051 要的),在 **clone** 之間算出各自的位置:
三個 clone 就是三本帳本、三個互不相通的 `LLM_DAILY_CAP_USD`。量測見 `docs/reviews/T0-repo-root-shared-resources-2026-10-01.md` 的 A1 表
(主 clone 的帳本有內容,另兩個 clone 的 `learning/state/log.jsonl` 不存在);機制的特徵測試是
`packages/core/src/llm/vault-clone-ledger.characterization.test.ts`(它描述的是**舊行為**,本張要把它改成新行為的證明)。

這是 ADR-050 / ADR-051 修過的同一個洞的第三次出現:煞車接上了,但接的是「這個簽出自己的帳本」,而且**靜默**——沒有任何一方說謊,加起來超過。

另有三處「沒有帳本就當零」的路,都要在本張消掉(讀原文,以函式名為準):

| 位置 | 現況 | 為什麼是錢的洞 |
|---|---|---|
| `packages/core/src/llm/spend.ts` 的 `readDailySpend` | `readFileSync` 失敗就回 `{ usd: 0, calls: 0 }` 並 `witness('llm.spend.log-unreadable-zero')` | 「不知道」被回報成「沒花」,方向是「可以繼續花」 |
| `packages/core/src/llm/router-gateway.ts` 的 `spendReader` | 沒有 `logPath` 就回 `witnessed('llm.gateway-router.spend-no-log-zero', { usd: 0, calls: 0 })` | 同上,而且這條連檔案都不看 |
| `packages/core/src/llm/vault.ts` | 解析不到就用 git 的位置 | 正是靜默分裂的來源 |

對照:`scripts/llm-spend.ts` 的煞車路徑已經正確(讀不到就 `unknown`、exit 2,見該檔 `readFileSync` 的 catch 與 P-22 反轉那段註解)——**那是本張要全面套用的姿態**。

## 裁決(技術顧問原文,逐條是驗收的來源)

1. **使用者層指標檔**,固定位置 `${XDG_CONFIG_HOME:-~/.config}/llm-learning-cards/vault.json`,內容
   `{ "learning_dir": "<絕對路徑>", "vault_id": "<uuid>" }`。
2. **帳本身分標記** `learning/config/vault-id`,內容是同一個 uuid。**不要用隱藏檔**(§13 會擋隱藏段,而且使用者要看得到)。
3. **解析順序**(所有呼叫端):明確參數(`--log` / `learningDir`)優先,其次是指標檔。**拿掉退回 git-common-dir 的那條路。**
   指標檔不存在、讀不到、`learning_dir` 不存在、標記不符——**四種都拒絕真呼叫**,錯誤訊息要寫出
   `npx tsx scripts/vault.ts init` 與 `show`;`llm-spend` 一律 exit 2。
4. `readDailySpend`:身分驗證過的帳本,**檔案不存在 = 全新安裝 = 0,合法**。身分沒驗證過就丟錯,**永遠不可以回 0**。
   **花錢的帳本只能是驗證過的那一本**(顧問追加):型別拆兩種——`VerifiedLedger`(只能由指標解析器產生)與 `ExplicitLedger`
   (明確參數;建構子名字要一眼看出未驗證,例如 `ExplicitLedger.unverified(path, reason)`,grep 找得到所有用到的地方)。
   **真呼叫(打網路、花錢)的 router 只收 `VerifiedLedger`**,假的 adapter 兩種都收。明確參數可以改**輸出**位置(`--out`、`learningDir`),
   不能改**帳本**位置——否則 `--log /tmp/x --live` 會把錢記進另一本帳,又裂開了。
5. `scripts/vault.ts init --learning-dir <abs>`:明確 bootstrap,建立標記與指標檔。指標檔已存在、而且指向別處時拒絕,
   除非加 `--force`(明示的丟棄可以,ADR-050)。`show` 印出位置與身分是否相符。
6. `.stryker.lock` 改成機器範圍:`${XDG_RUNTIME_DIR}/llm-learning-cards/stryker.lock`;沒有 `XDG_RUNTIME_DIR` 時用
   `~/.cache/llm-learning-cards/stryker.lock`。鎖不牽涉錢,所以不需要身分標記。`scripts/mutate.ts` 是我們自己的檔案
   (沒有 SOURCE 標頭),可以直接改。
7. 測試絕對不能碰真的指標檔:用 `mkdtemp` 當 `XDG_CONFIG_HOME`;沿用 T0 驗收 3、4 的合成主簽出 / worktree / clone,
   改成證明「三個位置都寫進同一本帳本」;另加反向測試:沒有指標檔時,真呼叫路徑要拒絕,而且**不會建出任何帳本檔**。
8. 合併後由協調者在主簽出跑一次 `vault.ts init --learning-dir /data/python/llm_learning-cards/learning`。真實的 `learning/`
   預期從 167 個檔變成 168 個(多一個 `config/vault-id`),帳本行數不變。這是**預期變化**,驗收時照這個數字比對。
9. 已知限制(寫進 ADR-066,這次不修):`.env` 的憑證與 `LLM_DAILY_CAP_USD` 仍然每個簽出各一份;帳本共用之後,差別只剩
   「上限的數字可能不同」。
10. T2c 的「根目錄只能有一個來源」:桌面程式也讀同一個指標檔。這條寫進 ADR-066,T2c 照做。

## 範圍

- 新增兩種帳本型別與解析器(純函式,`env`、`homedir`、檔案讀取都由呼叫端注入;**只有入口層**——`scripts/llm.ts` 的 `main`、`scripts/llm-spend.ts` 的 `main`、
  `createDefaultLiveRouter` 的零參數預設——才取真的 `process.env` / `os.homedir()`。理由同 ADR-051:「沒給的話退回哪裡」
  要能不碰真的檔案系統就測到;測試永遠注入合成的 `env`,所以不可能讀到真的指標檔)。
- 新增 `scripts/vault.ts`(`init`、`show`)。
- 所有呼叫端改用解析器:`scripts/llm.ts`、`scripts/llm-spend.ts`、`packages/core/src/prompt-quality/golden-run.ts`
  (`resolveLiveLearningDir` / `createDefaultLiveRouter`)、`GatewayLlmRouter` 的日上限檢查(`router-gateway.ts`)、
  `scripts/check-ledger-pollution.ts`(無法解析 → 沿用它既有的第三態 `UNKNOWN`,不是 PASS,也不是新增的紅)。
  `scripts/ingest.ts` 的 `--out` 是使用者每次明講的必要參數,**不在範圍**(同 ADR-051)。
- `.stryker.lock` 的路徑函式(`scripts/mutate.ts` 的 `strykerLockPath`)與它的兩個使用者(`scripts/mutate.ts`、`scripts/run-tests.ts`)。
- 契約文字(§12)與 ADR-066 **不在本張的程式範圍**:契約 1.4.0 由統籌·契約另開分支寫,工單的前置見下。

## 不在範圍

- `.env` 憑證與 `LLM_DAILY_CAP_USD` 跨簽出共用(已知限制,見 ADR-066)。
- 讀取時加總多本帳本(ADR-051 已否決,仍然是單一帳本,仍然不加總)。
- Windows / macOS 的使用者層設定位置(`%APPDATA%`、`~/Library/Application Support`):phase-4/5 的事,先寫進已知限制。
- 帳本檔本身的並行寫入(`appendLineAtomic` 的問題,另案)。

## 前置

- 契約 1.4.0 的 §12 文字與 ADR-066 在 main(契約由統籌·契約寫、顧問審、協調者合併)。**測試 agent 要等它進 main 才開始。**
- `scripts/vault.ts` 與 `scripts/vault.test.ts` 的落點(`03-llm-router`)已登記在 `scripts/boundaries.owners.json`(隨本張工單合併,派工之前就在 main)。
- 開工第一步先查:`03-llm-router`(`packages/core/src/llm/`)與 `scripts/` 能不能 import `packages/core/src/schema/atomic-write.ts` 的原子寫入,
  **查 `scripts/boundaries.allow.json`,不憑本稿**。查完回報。注意 T7 正在把 `schema/atomic-write.ts` 與 `ingest/state.ts` 的 §11b 實作統一成一份——
  兩張的合併順序由協調者定;本張不改 `schema/`。

## 驗收條件

### A. 指標檔與標記

1. 指標檔格式、位置、`XDG_CONFIG_HOME` 優先於 `~/.config`(`XDG_CONFIG_HOME` 為空字串視同未設,依 XDG 規範)。`learning_dir`
   必須是絕對路徑;相對路徑 = 讀不到(拒絕)。
2. 標記 `learning/config/vault-id`:內容與指標檔的 `vault_id` **逐字相等**(容許且只容許一個結尾換行)。比對是整串相等,
   不是前綴、不是不分大小寫;uuid 格式不合也算不符。
3. 兩份檔的**寫入都走原子寫入**(寫暫存檔、fsync、rename;CLAUDE.md 硬規則 5 的精神,指標檔雖不在 `state/` 也照做)。

### B. `vault.ts init` / `show`

4. 下表每一列一個測試:

| 情境 | `init` 的行為 |
|---|---|
| 全新:無指標、`learning/` 無標記 | 產生 uuid,寫標記與指標,exit 0 |
| `learning/` 已有標記、無指標 | 沿用標記的 uuid 寫指標(不重新產生),exit 0 |
| 指標已存在、指向同一個 `learning_dir` 且 id 相符 | 不改任何檔,exit 0,印「已初始化」 |
| 指標已存在、指向**別處** | 拒絕,不改任何檔,exit 非 0,訊息說要 `--force`;**加 `--force` 才覆寫** |
| `--learning-dir` 是相對路徑或不存在 | 拒絕,不建任何東西 |
| 指標與標記的 id 不符 | 拒絕,說明哪一邊是哪個值的**前 8 碼**(不印整個 uuid 以外的任何使用者資料),要 `--force` |

   `show`:印出指標位置、`learning_dir`、標記是否存在、是否相符;任何不符 exit 非 0。
5. `init --force` 之前先把舊指標的內容印出來(明示的丟棄可以,但要讓人看見丟了什麼,ADR-050)。

### C. 解析與拒絕

6. 解析器的回傳是有分支的結果(成功 / 拒絕),拒絕要區分**四種原因**:指標檔不存在、讀不到(含 JSON 壞、欄位缺或型別錯)、`learning_dir` 不存在、標記不符(含標記檔不存在)。
   每種原因各一個測試;訊息都含 `npx tsx scripts/vault.ts init` 與 `npx tsx scripts/vault.ts show` 兩個字串。
7. 明確參數(`--log` / `learningDir`)優先於指標檔,產生 `ExplicitLedger`;明確參數存在時**不讀指標檔**(測試用:指標檔是壞的,
   明確參數仍通過)。`ExplicitLedger` 只准用在:假的 adapter、讀取報告(`llm-spend`,見第 9 條)、測試。
8. **`readDailySpend` 與 `GatewayLlmRouter` 不再接受裸字串路徑**:它們收一個帳本把手(`VerifiedLedger` 或 `ExplicitLedger`)。
   理由:**這是型別檢查抓得到、而裸字串抓不到的那一類錯**——裸字串讓任何呼叫端都能繞過驗證,編譯不報錯、只在花錢的時候才出事。
   - **真呼叫的 router 型別上只收 `VerifiedLedger`**;把 `ExplicitLedger` 傳給真呼叫的 router 必須是**編譯錯誤**
     (用 `// @ts-expect-error` 的型別測試證明,拿掉型別限制該測試必須變紅)。假的 adapter 的 router 兩種都收。
   - 帳本把手(兩種)檔案不存在 = 0(全新安裝);**沒有帳本把手(`logPath` 沒給)= 丟錯**,不再回 0、不再印 `witness`。
   - `git grep -n "ExplicitLedger.unverified" -- packages scripts ':!*.test.ts'` 的結果貼進報告,**逐筆說明為什麼不是真呼叫路徑**;
     預期正式程式的**預設路徑**(沒有明確參數時)一筆都沒有。
9. `scripts/llm.ts`:解析被拒絕 → 不發出任何請求、exit 2、不建任何檔(包含不建 `learning/`);**真呼叫模式下 `--log` 不是帳本位置的選項**
   (給了就拒絕,exit 2,訊息說明帳本位置只能由指標檔決定;假 adapter 模式下 `--log` 可用)。`scripts/llm-spend.ts`:任何拒絕 exit 2
   (它既有的 `unknown` 路徑不退步);它收明確的 `--log` 時,報告的第一行要標 `ledger=unverified`,且該報告**不能被當成煞車的依據**
   (煞車只消費 `VerifiedLedger`)。`golden-run` 的 `--live` 與 `createDefaultLiveRouter`:拒絕 → 丟錯,不建 router;`--live` 時 `learningDir`
   只管輸出位置,不管帳本。
10. **拿掉退回 git 的那條路**:`git grep -n "git-common-dir" -- packages scripts ':!*.test.ts'` 的結果貼進報告,逐筆說明
    (預期:鎖不再用、帳本不再用;若有剩下的,每一筆為什麼還在)。舊的 `resolveVaultRoot` / `resolveVaultLearningDir`
    若沒有任何呼叫端就刪,不留死碼。

### D. 鎖

11. 鎖路徑:`${XDG_RUNTIME_DIR}/llm-learning-cards/stryker.lock`;`XDG_RUNTIME_DIR` 未設或空字串 → `~/.cache/llm-learning-cards/stryker.lock`。
    目錄不存在就建(權限 0700)。**建不出來或寫不進去 = 拒絕開始跑,不是沒鎖繼續跑**(沒有鎖的靜默 = 互撞又回來)。
12. 路徑解析同樣是注入 `env` / `homedir` 的純函式;測試用 `mkdtemp`,不碰真的 `XDG_RUNTIME_DIR`。
13. 鎖的行為(殘鎖判定、`STALE_AFTER_MS`、pid 檢查)**不變**;只改位置。`scripts/mutate.ts` 與 `scripts/run-tests.ts` 兩個使用者都跟著改。
14. 對照:在合成的「主簽出 + worktree + 另一個 clone」三處各起一個取鎖的程序,**第二個必須看到第一個的鎖**
    (舊行為下 clone 看不到,這是 T0 量到的)。

### E. 測試的隔離(最重要的一條)

15. 本張所有新增與修改的測試,`XDG_CONFIG_HOME`、`XDG_RUNTIME_DIR`、`HOME` 都指向 `mkdtemp` 的目錄,**包括它們 spawn 的子程序**。
    加一個守門測試:跑完整個測試檔前後,真的指標檔(`${XDG_CONFIG_HOME:-~/.config}/llm-learning-cards/vault.json` 的**真實**位置)
    的存在與否與 mtime 都沒變(只做 `stat`,不讀內容)。
16. 把 T0 驗收 3、4 的合成主簽出 / worktree / clone 改成:三個位置各跑一次「寫一筆帳」的程序(假 adapter,**不呼叫任何真的 provider**),
    `XDG_CONFIG_HOME` 指向同一個合成指標;證明三處的事件都進**同一本**帳本。
17. 反向測試(必備):合成環境**沒有指標檔**,跑真呼叫路徑(`scripts/llm.ts`、`createDefaultLiveRouter`),要拒絕,
    並斷言**整個合成樹裡沒有出現任何新檔或新目錄**(列檔前後相等)。
18. 對照:拿掉「標記不符」的檢查,第 6 條的標記不符測試必須變紅;拿掉「指標不存在 → 拒絕」改成退回 git,第 17 條必須變紅。審核 agent 做。

### F. 真的 `learning/` 的預期變化(協調者在合併後做,不是測試 agent)

19. 做之前:記下 `learning/` 的檔案清單(相對路徑,排序)與 `state/log.jsonl` 的行數,貼進報告的是**數字與哈希**,不是檔名與內容。
    合併後在主簽出跑 `npx tsx scripts/vault.ts init --learning-dir /data/python/llm_learning-cards/learning`。
    之後:檔案數 167 → 168,**差異恰好是一個新增的 `config/vault-id`**,沒有任何既有檔被修改或刪除(逐檔比哈希),帳本行數不變。
    `npx tsx scripts/vault.ts show` 回報相符。
20. 這一步**測試 agent 與開發 agent 不得執行**(那是唯一一次合法地寫真的 `learning/`)。

### G. 變異與報告

21. 解析器、標記比對、`init` 的覆寫判定、鎖路徑函式進變異範圍,標準 80%(錢的路徑,存活者逐條分類,不得以「等價」帶過而沒有論證)。
    `must_catch`(檔頭)每一條要有一個**具名測試**,報告列「條目 → 測試名」。
22. 報告記 host、worker 數、1/5/15 分 load。報告**不得含**使用者資料:不貼 `learning/` 的檔名與內容、不貼帳本事件、不貼完整 uuid、
    不貼 `learning_dir` 的真實絕對路徑(寫成 `<learning_dir>`)。

## 與其他工單的關係

- **T7**(§11b 兩份實作統一,前端起草):動 `schema/`、`ingest/`、`scripts/lint.ts`、`scripts/degraded-report.ts`。落點表的 `infra` 是一個大桶——本張的
  `scripts/mutate.ts` 與 T7 的 `scripts/degraded-report.ts` 都落在 `infra`,R2 會判重疊;若要並行,先把 `infra` 的落點拆細(落點表是我們自己的檔,顧問裁)。
- **T3**(測試逾時與整鏈鎖):它的 B2 在問「鎖要不要跨 clone」。本張(裁決 6)直接回答了:**要**,而且改位置。T3 的 header 因此 `deps: [T5]`:
  兩張都動 `scripts/mutate.ts`、`scripts/run-tests.ts`,R2 不能並行;T3 階段 B 開工前要重讀本張合併後的鎖。
- **T2b**:驗收 E 第 10 條寫「`.stryker.lock` 每個 clone 一把」,本張合併後這句過時;T2b 合併後由統籌·契約改文。
- **T2c**(前端起草):「learning 根目錄只能有一個來源」讀本張的指標檔(Rust 端讀 `vault.json`)。
- **T6**(§1 收窄):與本張無實作依賴,契約升版一起做(1.4.0)。

## 測試誰寫

- 測試 agent:紅測試(上面 A–E),**等契約 1.4.0 進 main 才開始**。
- 審核 agent:第 18 條的對照、變異、第 19 條之前的基準與之後的比對。
- 開發 agent:只寫實作,不改測試。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,同一時間一個 agent。派工歸協調者。

## 後續(不在本張,記下來)

- 協調者的 SKILL.md 與 `docs/`:新機器 / 新 clone 的第一步是 `vault.ts init`(或 `show` 確認),沒做之前真呼叫會被拒絕——這是設計。
- `.env` 與 `LLM_DAILY_CAP_USD` 的跨簽出一致(ADR-066 的已知限制)。
