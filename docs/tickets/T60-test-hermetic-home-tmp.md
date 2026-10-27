---
id: T60
deps: []
touches: [scripts/review.test.ts, scripts/review-router.test.ts, scripts/check-gates-pinned.test.ts]
cpu: light
budget_usd: 1
status: todo
owner: 測試
must_catch:
  - review.test.ts 不帶 dry-run 的那條還讀真的指標檔 用空的 HOME 跑必須紅
  - review.test.ts 或 review-router.test.ts 的子行程還把 session 快取寫進 HOME 底下 用空的 HOME 跑完 HOME 底下的 .cache 必須是空的
  - check-gates-pinned.test.ts 還用寫死的 opencode 暫存路徑 那個路徑底下多出東西必須抓到
  - 改的時候把原本的斷言放鬆(少一條 expect 或改成比較寬的比對) 三個檔的斷言數與期望字樣前後要一樣
---

# 工單 T60:測試封閉性——三處讀寫了跑測試那台機器的東西

> 狀態:起草 2026-10-27,依協調者 2026-10-27 的交代(低優先小票合併;T58 的 F2 另開 T61)。規格:UI/Tauri 負責人(代筆)。編號 T60:協調者配的。
> **只改測試,不改程式。** 由測試 agent 改(測試只由它改),不派開發 worker。LLM 真呼叫 0。
> 協調者交代的三處,`NO_COLOR` 那一處起草時找不到,見 D2。

## 為什麼有這張

測試應該只碰自己建的暫存目錄。起草時量到兩處會碰跑測試那個人的家目錄,一處要求機器上先有一個特定的暫存資料夾。2026-10-26 把重活搬到 i9 時,要先在那台建一個空的帳本與那個暫存資料夾,測試才會過,就是這個原因。

### 1. `scripts/review.test.ts`:不帶 `--dry-run` 的那條讀真的指標檔(**量過**)

- 第 112–119 行的 `runInteractive` 起 `scripts/review.ts` 時,環境變數是 `...process.env` 原樣傳下去。
- 互動模式在 `scripts/review.ts` 第 229 行 `liveRouterOrExit()` 會去讀指標檔 `${XDG_CONFIG_HOME:-~/.config}/llm-learning-cards/vault.json`,也就是跑測試那個人真的指標檔。
- 用空的 HOME(`XDG_CONFIG_HOME`、`XDG_CACHE_HOME` 都不設)跑這個檔:20 條紅 1 條(第 221 行「基數那一行只屬於 --dry-run」),訊息是「指標檔不存在:…/vault.json」。
- 有真的指標檔時它會過,但 `openDay` 會把當日 session 快取寫進真的 `~/.cache/llm-learning-cards/path-<雜湊>/`(測試的暫存帳本沒有 `vault-id`,所以資料夾名是路徑雜湊)。

### 2. `scripts/review-router.test.ts`:子行程沒指 `XDG_CACHE_HOME`(**量過**)

- 第 100 行把 `XDG_CONFIG_HOME` 指到暫存目錄了,`XDG_CACHE_HOME` 沒有。
- 用空的 HOME 跑這個檔:全綠,但跑完 HOME 底下的 `.cache/llm-learning-cards/` 多出 1 個資料夾(名字是測試自己產的 uuid)。平常跑就是寫進真的 `~/.cache`。

### 3. `scripts/check-gates-pinned.test.ts`:寫死一個暫存路徑(**看程式碼**)

- 第 26 行的 `TEMP_BASE` 寫死一個 opencode 用的暫存資料夾。第 40 行直接在它底下 `mkdtempSync`,沒有先建,所以機器上沒有那個資料夾就 `ENOENT`。
- 第 49 行還把子行程的 `TMPDIR` 指到它。

### 起草時順便量到的

- 筆電上真的 `~/.cache/llm-learning-cards/` 現在有 **497 個資料夾**:394 個是 uuid 名、103 個是 `path-` 名,日期從 2026-10-16 到 2026-10-25。
- 真的帳本只有一本,所以幾乎全部是測試留下的。
- 1、2 兩處每跑一次各留 1 個。這個數字比較像 `path-` 那 103 個,uuid 的 394 個應該還有別的來源(見 F2)。

## 要的結果

1. `scripts/review.test.ts` 的 `runInteractive`:
   - 照 `scripts/review-router.test.ts` 第 79 行 `xdgPointingAt` 的做法,在暫存目錄建一個指標檔,指到這條測試自己的暫存帳本,帳本裡寫對應的 `config/vault-id`;
   - 子行程的 `XDG_CONFIG_HOME` 與 `XDG_CACHE_HOME` 都指到暫存目錄。
   - 斷言一個字都不改(還是要印 Nothing is due、不印「張未排程」)。
2. `scripts/review-router.test.ts` 的 `run`:子行程多帶 `XDG_CACHE_HOME`,指到暫存目錄。斷言不改。
3. `scripts/check-gates-pinned.test.ts`:`TEMP_BASE` 改成在 `os.tmpdir()` 底下用 `mkdtempSync` 開一個這個檔專用的資料夾(`beforeAll` 建、`afterAll` 刪),子行程的 `TMPDIR` 也指到它。斷言不改。
4. 三個檔的檔頭註解各補一句:子行程的 `XDG_*`(或 `TMPDIR`)指到暫存目錄,不碰跑測試那台機器的東西。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 平常跑 | `VITEST_MAX_WORKERS=1 npx vitest run scripts/review.test.ts scripts/review-router.test.ts scripts/check-gates-pinned.test.ts` | 全綠 |
| 空的 HOME | 同一行,前面加 `env -u XDG_CACHE_HOME -u XDG_CONFIG_HOME HOME=<新開的空暫存目錄>` | 全綠;跑完那個 HOME 底下沒有 `.cache` 與 `.config`(`.npm` 是 npx 自己的,不算) |
| 真的快取 | 平常跑之前與之後,各數一次真的 `~/.cache/llm-learning-cards/` 底下的資料夾數 | 前後一樣(只記數字) |
| 暫存路徑 | 跑之前與之後,各列一次 `TEMP_BASE` 原本那個路徑底下的東西 | 前後一樣(它是 opencode 的,這張只看、不刪) |
| 斷言沒放鬆 | `git diff <基底>..HEAD -- scripts/review.test.ts scripts/review-router.test.ts scripts/check-gates-pinned.test.ts` 裡被刪掉的行 | 沒有 `expect(` 開頭的行被刪;期望字樣(`Nothing is due`、`張未排程` 等)前後都在 |
| 不動的地方 | `git diff --stat <基底>..HEAD -- packages apps contracts prompts 'features/**/*.feature' scripts/review.ts scripts/check-gates-pinned.sh vitest.config.ts` | 沒有輸出 |

**改壞證明**(驗收 agent):

- 把 1 的 `XDG_CONFIG_HOME` 拿掉,用空的 HOME 跑 → 第 221 行那條紅;
- 把 2 的 `XDG_CACHE_HOME` 拿掉,用空的 HOME 跑 → HOME 底下多出 `.cache`;
- 把 3 改回寫死的路徑 → 那個路徑底下多出 `t4b` 開頭的暫存資料夾。

## 受保護的檔

- 程式(`scripts/review.ts`、`packages/`、`apps/`)、`.feature`、契約、`vitest.config.ts`:這張不改。

## 落點

- `scripts/review.test.ts`、`scripts/review-router.test.ts` → 11-review-cli;`scripts/check-gates-pinned.test.ts` → infra(`scripts/boundaries.owners.json`)。
- R2:跟 T59(03)、T61(02)不相交。infra 只有這一個測試檔。

## 待顧問決定

- **D1:只修三處,還是改成全域的預設。**
  - **甲(建議,這張)**:只修上面三處。小、看得見、不動共用設定。
  - **乙(之後)**:vitest 多一個 setup 檔,整個測試行程的 `XDG_CONFIG_HOME`、`XDG_CACHE_HOME` 預設就指到暫存目錄,子行程照樣繼承。之後新寫的測試忘了也不會漏。但要先用空的 HOME 跑一次全套(重活,i9),看有沒有測試是**故意**要讀真的位置的(例如 T5 的守門測試)。
  - 建議先做甲,F2 量完再決定乙。
- **D2:`NO_COLOR` 那一處找不到。** 起草時查了:
  - 整個 repo(含 `features/steps`、`scripts`、`packages`、`apps`)沒有任何一行提到 `NO_COLOR` 或 `FORCE_COLOR`;
  - 在 vitest 裡起子行程,設不設 `NO_COLOR` 輸出都一樣(Node 22.23.4);
  - 會吃 ANSI 色碼的只有 `features/steps/hud-skin.steps.ts` 第 60 行,它已經先把色碼拿掉了。
  - 請協調者給出處(哪一條測試、在哪台機器、什麼訊息)。找不到的話,這一處從 T60 拿掉。

## 觀察(不在範圍)

- **F1:真的快取裡那 497 個資料夾。** 這張不刪(使用者的家目錄,刪不可逆)。要清的話由使用者自己來:留下指標檔 `vault_id` 那一個,其他都是測試留下的。
- **F2:uuid 名的 394 個還有別的來源。** 上面 1、2 兩處每跑一次各留 1 個,對不上 394。最可能是 cucumber 步驟(`features/steps/` 有 11 個碰 session 的檔),那是重活,起草時沒量。建議驗收時在 i9 用空的 HOME 跑一次全套 cucumber,數 HOME 底下多出幾個資料夾、哪些場景因為沒有指標檔而紅,再決定 D1 的乙。

## 預算

`budget_usd: 1`(測試 agent 改三個測試檔)。LLM 花費 0。`cpu: light`(三個檔,不含 Chrome)。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底 main `d64b1d5`,只給測試 agent。派工歸協調者。

## 起草時量的(只讀)

- 用空的 HOME 跑 `scripts/review.test.ts`:20 條紅 1 條(第 221 行),訊息是指標檔不存在。
- 用空的 HOME 跑 23 個碰 session 快取的 vitest 檔(`packages/core/src/session/`、`scripts/review-*.test.ts`、`features/support/` 的 sidecar/cli 測試、兩個 app 的 `dev/standalone.test.ts` 等):612 條全綠,HOME 底下多出 1 個快取資料夾。一個一個檔跑,找到是 `scripts/review-router.test.ts`。
- 真的 `~/.cache/llm-learning-cards/`:497 個資料夾(394 uuid、103 `path-`),最舊 2026-10-16、最新 2026-10-25。只數,沒有打開、沒有刪。
- 量測用的空 HOME 是暫存目錄,量完刪掉。
