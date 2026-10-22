---
id: T8
deps: [T5]
touches: [packages/core/src/llm/spend.ts, packages/core/src/llm/ledger.ts, packages/core/src/llm/router-gateway.ts, packages/core/src/prompt-quality/golden-run.ts, packages/core/src/schema/atomic-write.ts, packages/contracts/src/witness.ts, scripts/degraded-intended.json, scripts/llm-spend.ts, scripts/vault.ts, scripts/zero-input-roster.ts]
cpu: light
budget_usd: 4
status: merged
owner: worker-claude    # 預設值;使用者回答 grok 之前不派 grok(顧問 2026-10-15)
must_catch:
  - 壞行被跳過而不是不知道:readDailySpend 遇到壞行仍回一個數字(低估花費)
  - 壞行判定又有兩份:readDailySpend 與 llm-spend 各自判斷什麼叫壞行
  - 壞行的錯誤訊息沒有指示去跑 llm-spend 看是哪幾行
  - 有壞行時 router 仍打了雲端或閘道(拒絕不是發生在打 adapter 之前)
  - init --force 重建壞標記時沒有先印出舊內容
  - init 不加 --force 就重建壞標記
  - 驗證過但 log 不存在時 llm-spend 回 exit 2
  - 驗證過但 log 不存在時報告沒有註明「帳本還沒有紀錄」(與空 log、未驗證混在一起)
  - learning_dir 是 symlink 時解析到錯的帳本(改指到別的目錄、標記不同卻放行)
  - 兩個 init 同時跑,留下無法解析的指標檔或暫存檔殘留
  - 指標檔權限放寬:init 新建或覆寫的指標檔 mode 不是 0600(含暫存檔在 rename 之前的權限)
  - createDefaultLiveRouter 仍走 localProber 的預設分支(local-prober-default 訊號又被觸發)
---

# 工單 T8:帳本的剩餘缺口——壞行當「不知道」、壞標記可 `--force` 重建、全新安裝回 $0、symlink 與同時 init 的測試

> 狀態:草稿,待技術顧問審。**錢相關。**
> 作者:驗收·測試 agent(-ed)。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 裁決來源:技術顧問 2026-10-15 對 T5 驗收(`docs/reviews/acceptance-T5.md`)的裁決,四點逐條是本張的範圍。
> 檔案與行為以 T5 合併後的 main 為準;本張 `deps: [T5]`,T5 沒進 main 之前不開工。
> **`--live` 的煞車維持到本張合併為止**(顧問另行告知協調者)。

## 起因

T5 驗收(`docs/reviews/acceptance-T5.md`)找到四件事,顧問裁決全部收進本張:

| 代號 | 事實(我自己重現過) | 裁決 |
|---|---|---|
| F-A | `readDailySpend` 遇到壞行就跳過那一行並記一個 `witness`:兩行各 1M tokens 的帳本是 `{ usd: 5, calls: 2 }`,弄壞一行變 `{ usd: 2.5, calls: 1 }`。base 就有這個行為,不是 T5 引入。`scripts/llm-spend.ts` 的報告已經是「壞行 = 算不出來」(P-22 的反轉),router 的煞車卻不是——**低估花費的方向是「還可以繼續花」** | 壞行 = 不知道,真呼叫一律拒絕 |
| D1 | `scripts/vault.ts` 的 `init` 遇到 `config/vault-id` 內容不是合法 uuid,連 `--force` 也拒絕,只能人工改檔 | `--force` 可以重建;重建前把舊內容印出來(明示的丟棄可以,ADR-050) |
| D2 | `scripts/llm-spend.ts` 對「帳本驗證過、`state/log.jsonl` 不存在」回 exit 2;契約 §12 寫「身分驗證過的帳本,`state/log.jsonl` 不存在 = 全新安裝 = 今日花費 0,這是合法的」,`readDailySpend` 也照做回 0 | llm-spend 要回 $0、exit 0,並註明「帳本還沒有紀錄」。`--probe` 不解析帳本,維持不變 |
| F-C | 沒有 `learning_dir` 是 symlink 的測試,也沒有兩個 `init` 同時跑的測試 | 補測試(單人程式,後者只要求不留下壞掉的指標檔) |
| P | `vault.ts init` 寫出的指標檔權限是 0664(群組可寫)。外層目錄 0700 擋住了實際風險,但檔案本身應該收緊 | 新建的指標檔 0600(顧問 2026-10-15 追加) |
| W | T5 驗收 §13:`createDefaultLiveRouter()` 建 `LlmRouterImpl` 時沒給 `localProber`,每次呼叫都走 `llm.router-impl.local-prober-default` 這條預設分支(與錢無關,但讓 `witness:degraded` 的未標記數多 2 條) | 明講 `localProber`,語意不變(顧問 2026-10-15 同意併進本張) |

## 範圍

- **A. 壞行**(`packages/core/src/llm/spend.ts`、`packages/core/src/llm/router-gateway.ts` 只在需要讓錯誤原樣往外丟時動、`scripts/llm-spend.ts`、`packages/contracts/src/witness.ts`、`scripts/degraded-intended.json`)。
- **B. 壞標記的 `--force`**(`scripts/vault.ts`)。
- **C. 全新安裝回 $0**(`scripts/llm-spend.ts`、`scripts/zero-input-roster.ts` 裡 llm-spend 的探針基線)。
- **D. 測試**(symlink、同時 init;測試 agent 寫)。
- **E. 指標檔權限 0600**(`scripts/vault.ts`、`packages/core/src/llm/ledger.ts` 的 `VaultIo`、`packages/core/src/schema/atomic-write.ts`)。
- **F. `createDefaultLiveRouter` 明講 `localProber`**(`packages/core/src/prompt-quality/golden-run.ts` 一行)。

## 不在範圍

- 把 `learning_dir` 做 `realpath` 或拒絕 symlink:本張只**用測試記錄並鎖住現行行為**(見驗收 D);若測試顯示現行行為有洞,回報,不在本張順手改。
- 指標與標記之間的 TOCTOU(帳本只在建構時驗證一次):已知限制,維持。
- **已知限制(顧問 2026-10-15 裁決,不開新票)**:`learning/state` 是 symlink 指到 `learning/` 外面時,解析器放行(驗收 16 的測試鎖住現況)。所有 clone 都從同一個指標解析到同一個 `learning_dir`,再經過同一個 symlink,寫的仍是同一本帳本,不會裂開;這是使用者自己的磁碟安排(例如把 `state/` 放到別的磁碟)。
- **已知限制(同上)**:兩個 `init` 同時跑可能讓指標與標記的 id 不一致。`show` 會判成「不相符」,真呼叫因此被拒絕(fail-closed),使用者再跑 `init --force` 即可。單人程式,接受;驗收時把 20 輪裡不一致的輪數記進證據,不要求為零。
- `.env` 與 `LLM_DAILY_CAP_USD` 的跨簽出一致:ADR-066 的已知限制。
- 帳本檔本身的並行寫入(`appendLineAtomic`):另案。

## 驗收條件

### A. 壞行 = 不知道

1. **什麼叫壞行(單一定義,只留一份)**:內容不是空白的一行,而且 `JSON.parse` 失敗,或解析出來不是物件,或 `ts` 欄位存在卻不是字串。這個判定目前在 `scripts/llm-spend.ts`(`buildSpendReport` 一帶)與 `packages/core/src/llm/spend.ts` 的 `readDailySpend` 各有一份邏輯;改成**一個共用的純函式**,放在 `packages/core/src/llm/spend.ts`,兩處都引用。靜態檢查(測試 agent 寫):`scripts/llm-spend.ts` 與 `spend.ts` 裡,`JSON.parse` 對帳本行的呼叫恰好一處。
2. **`readDailySpend` 遇到任何壞行就丟錯**(新錯誤類別,**名字固定為 `UnknownSpendError`**,和 `MissingLedgerError` 一樣從 `spend.ts` 匯出,`name` 屬性也是 `UnknownSpendError`;紅測試依這個名字寫),**不回任何數字**。壞行**不分哪一天**(壞行讀不到 `ts`,證明不了它不是今天的)。空白行不是壞行。
3. 錯誤訊息必須含:帳本路徑、**行號**、該行前 80 個字元、一句怎麼修,並明確指示 **`npx tsx scripts/llm-spend.ts`**(用它看是哪幾行壞了;`--log` 指到未驗證的帳本時它也看得到)。訊息裡**不得**出現完整的行內容(只有前 80 字)。帳本路徑與前 80 字屬於使用者資料,**不進任何會被提交的報告**(測試與報告只用合成樣本)。
4. **拒絕發生在打 adapter 之前**:`GatewayLlmRouter.call()` 在帳本有壞行時,雲端 adapter 0 次、閘道 0 次,錯誤原樣往外丟(不被吞成備援、不被當成 `isCloudFailure`)。`dailySpend()` 與 `budgetExhausted()` 每一次都丟錯,沒有任何一次回數字。對 `VerifiedLedger` 與 `ExplicitLedger`(假 adapter)兩種把手行為相同。
5. `scripts/llm-spend.ts` 的既有行為**不退步**:壞行 → `算不出來`、exit 2、訊息帶行號 / 前 80 字 / 怎麼修(`badLineReason`);`ts` 不是字串的行同樣算壞行。共用判定之後,既有的 `llm-spend.test.ts` 壞行測試**不改**也要綠。
6. **witness 目錄同步**(ADR-047:訊號目錄漂移本來就是 FAIL):`llm.spend.bad-line-skipped` 的呼叫點隨程式刪除,`packages/contracts/src/witness.ts` 同批移除這個訊號;`scripts/degraded-intended.json` 裡指向被改掉的測試的條目同步改或刪。**報告要逐一對應「被刪的訊號 → 被刪的程式」。** `npm run witness:degraded` 的訊號目錄/呼叫點/觸發三個數字要彼此相等,未標記數**不得比 T5 合併後增加**。

### B. `init --force` 重建壞標記

7. 標記檔 `config/vault-id` **存在但內容不是合法 uuid**(含空檔、多餘字元、大寫、`\r\n`):
   - 不加 `--force`:照舊拒絕,exit 非 0,不改任何檔;訊息**新增**一句:這種情況可以加 `--force` 重建,**舊內容會被丟棄**。
   - 加 `--force`:先在 stdout 印「舊標記(將被丟棄):」與舊內容(**最多 200 位元組,控制字元以 `\xNN` 顯示**,避免亂碼污染終端機),再重建標記與指標,exit 0。
8. 重建時用哪個 id:**指標存在、指向同一個 `learning_dir`、而且指標的 `vault_id` 是合法 uuid → 沿用指標的 id 重寫標記**(帳本身分不變,其他簽出裡的指標不用動);否則產生新 uuid,同時改寫指標。(這條是起草者的選擇,審的時候請顧問確認。)
9. 其他 `init` 的行為**不變**(第 4 條的表、`samePlace` 判斷、`--force` 覆寫別處指標)。標記**不存在**的情況不受影響。
10. 兩份檔的寫入仍走原子寫入(`writeFileAtomic`)。

### C. 全新安裝回 $0

11. `scripts/llm-spend.ts`,**帳本驗證過**(指標與標記相符)而 `state/log.jsonl` **不存在**:輸出 $0.0000、0 次呼叫、今日條目 0 筆、上限照印,**exit 0**(上限為 0 的「不設限」同樣 exit 0);第一行之後或同一行註明 **「帳本還沒有紀錄」**。`--json` 吐 `usd: 0, calls: 0, entries_today: 0`,並多一個欄位 `log_exists: false`(`log_exists: true` 用在檔案存在時)。
12. 三種情況的輸出**兩兩不同**:log 不存在(新)、log 存在但今天 0 次呼叫(既有:「有 log、今天沒花」)、算不出來。既有的「log 不存在與 log 空檔的訊息與退出碼都不一樣」測試因此要改:**退出碼現在相同(0),訊息仍要不同**——這是工單明確要求的改動,由測試 agent 改(開發 agent 不碰)。
13. 未驗證的帳本(`--log`):**不變**——一律 exit 2、第一行 `ledger=unverified`。檔案不存在在未驗證時仍是 `算不出來`/exit 2(未驗證的帳本不能說「全新安裝」)。
14. 不是檔案不存在的讀取錯誤(權限、目錄而非檔案):**不變**,仍是 `算不出來`、exit 2。
15. `scripts/zero-input-roster.ts` 裡 llm-spend 的探針基線依新行為調整(探針「log 不存在 → exit 2」改成 exit 0 的新基線;另保留一個「log 不可讀 → exit 2」的探針)。零輸入守門的測試 `scripts/zero-input-guard.test.ts` 必須綠(它跑 `scripts/zero-input-roster.ts` 的探針;沒有獨立的 npm script)。

### D. 測試(測試 agent 寫;開發 agent 不碰)

16. **symlink**(`packages/core/src/llm/vault-pointer.test.ts` 或新檔):
    - 指標的 `learning_dir` 是 symlink,指向有相符標記的目錄:解析成功,`logPath` 以指標裡寫的路徑為準(不 `realpath`)。
    - 同一個 symlink 事後改指到另一個**標記不同**的目錄:`marker-mismatch`,拒絕。
    - 懸空 symlink(目標不存在):`learning-dir-missing`。
    - `learning/state` 本身是 symlink 指到 `learning/` 外面:**記錄現行行為**(放行或拒絕都行,但要有測試鎖住,並在報告寫明是哪一種;如果放行,在報告提醒顧問「帳本可以被導到驗證範圍之外」)。
    - `init --learning-dir` 給的是 symlink:指標裡存的是 `path.resolve` 的結果(不解 symlink),以及標記寫進 symlink 指到的真目錄。
17. **同時 init**(`scripts/vault.test.ts`):用子程序同時起 2–4 個 `init`,指到同一個全新 `learning_dir`,重複 20 輪(每輪全新沙箱):每個子程序退出碼是 0 或 1;**結束後指標檔存在時一定是合法 JSON 且 `learning_dir`、`vault_id` 欄位型別正確**;`config/` 與指標檔目錄裡**沒有 `*.tmp` 殘檔**;標記檔存在時內容是合法 uuid。**不要求**指標與標記的 id 一致(已知競爭,不修),但報告要列「20 輪裡有幾輪不一致」的次數。
18. 隔離:HOME / XDG_CONFIG_HOME / XDG_RUNTIME_DIR 都指向 `mkdtemp`,子程序也是;守門測試(真指標檔只 `stat`)照 T5 的做法。

### E. 指標檔權限 0600

19. `scripts/vault.ts init` **新建**的指標檔,`stat(...).mode & 0o777 === 0o600`;`--force` **覆寫**既有指標(原本 0664 的舊檔)之後同樣是 0600。標記檔 `config/vault-id` 不在本條範圍(它在 `learning/` 底下,權限跟著 `learning/`)。
20. **沒有一個瞬間比 0600 寬**:不能先用預設權限寫完再 `chmod`。`writeFileAtomic` 要能接一個 mode(建立暫存檔時就是 0600,rename 之後權限留著);預設行為(沒給 mode)**不變**,T7 的向量檔與既有測試不改也要綠。`VaultIo.writeAtomic` 簽章跟著多一個可選的 mode,`vault.ts` 寫指標時傳 0o600。
21. 測試用 `umask(0)` 與 `umask(0o022)` 各跑一次,結果都是 0600(證明不是靠 umask 湊出來的)。

### F. `createDefaultLiveRouter` 的 `localProber`

22. `createDefaultLiveRouter` 建 `LlmRouterImpl` 時明講 `localProber: async () => ({ available: false, models: [] })`(跟 `scripts/llm.ts` 的 `createFakeRouter` 同一個寫法與註解),行為與現在完全相同。驗證:`live-run.test.ts` 裡呼叫 `createDefaultLiveRouter()` 的測試不再觸發 `llm.router-impl.local-prober-default`;`npm run witness:degraded` 的未標記數比 T5 合併後(155)少。

### G. 驗收時

23. 一般測試全綠(`VITEST_MAX_WORKERS=1`);`npx tsc --noEmit` 0 錯(不能省:型別測試只有 tsc 驗得到);`npm run boundaries`、`lint:docs` 綠。
24. 對 `packages/core/src/llm/spend.ts` 的壞行判定與 `scripts/vault.ts` 的 `--force` 重建判定跑 Stryker(要先拿 CPU 位子與鎖);存活者逐條分類。`vault.ts` 的子程序盲區用手動突變補驗,寫進報告(ADR-030:只有嚴格級門檻是硬的)。
25. `must_catch`(檔頭)每一條要有一個**具名測試**;驗收角色逐條做突變證明會紅。

## 預算

`budget_usd: 4`(起草者估:三處小改動加共用函式抽取,不碰 Rust;T5 預算 $6 實際超 3.8 倍,請協調者在派工時把「超過 $8 要停」寫進補充區塊)。

## 測試誰寫

- 驗收·測試 agent(-ed):A–F 全部的紅測試與靜態檢查;改既有的「log 不存在與 log 空檔」測試(驗收 12)。**先寫,開發 agent 才開工。**
- 開發 agent:只改實作,不改測試、不改 `.feature`。既有測試要改才能綠,就停下回報協調者。
- 驗收:照 `worker-acceptance`。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底為 T5 合併後的 `origin/main` 加上本張的紅測試分支,同一時間一個 agent。派工歸協調者。

## 風險

- 共用壞行判定時,`llm-spend` 的 `badLineReason` 與 `spend.ts` 的錯誤訊息要用同一份文字來源,否則兩邊各自漂移。
- 把 `readDailySpend` 改成遇壞行就丟錯後,**所有**用它的呼叫端都會受影響(router 的日上限、`createDefaultLiveRouter` 的路徑);派工前先 `git grep readDailySpend` 列清單,測試 agent 寫紅測試時逐一覆蓋。
- 帳本被一行壞資料卡死 = 使用者要自己修帳本(ADR-050:修帳本是明示的動作)。訊息要寫清楚怎麼修,不要自動刪行。

## 紅測試清單(測試 agent 寫的檔——之後驗收比對「測試檔只能來自測試 agent」的基準)

分支 `pollux0971/t8-red`(基底 T5 合併後的 `origin/main`,加上本工單):

| 檔 | 內容 |
|---|---|
| `packages/core/src/llm/ledger-bad-lines.test.ts`(新檔) | 驗收 A:壞行、錯誤訊息、router 在打 adapter 之前拒絕、單一定義、witness 訊號隨程式消失 |
| `scripts/llm-spend.test.ts`(改既有一條、加一個 describe) | 驗收 C(含驗收 12 要求改的那一條) |
| `scripts/vault.test.ts`(加 describe) | 驗收 B、驗收 D 的 init 部分(symlink、同時 init)、驗收 E |
| `packages/core/src/llm/vault-pointer.test.ts`(加 describe) | 驗收 D 的解析器部分(symlink) |
| `packages/core/src/prompt-quality/live-run.test.ts`(加一條) | 驗收 F |

說明:驗收 D 的 symlink 與同時 init 測試是**記錄現行行為**的測試,在 T5 合併後的實作上本來就綠,不是紅的;它們的作用是之後有人改動時會紅。其餘測試在現行實作上都是紅的。
