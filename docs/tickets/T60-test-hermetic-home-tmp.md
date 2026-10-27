---
id: T60
deps: []
touches: [scripts/review.test.ts, scripts/review-router.test.ts, scripts/check-gates-pinned.test.ts, scripts/degraded-report.test.ts, scripts/run-tests.test.ts]
cpu: light
budget_usd: 1
status: todo
owner: 測試
must_catch:
  - review.test.ts 不帶 dry-run 的那條還讀真的指標檔 用空的 HOME 跑必須紅
  - review.test.ts 或 review-router.test.ts 的子行程還把 session 快取寫進 HOME 底下 用空的 HOME 跑完 HOME 底下的 .cache 必須是空的
  - check-gates-pinned.test.ts 還用寫死的 opencode 暫存路徑 那個路徑底下多出東西必須抓到
  - 不設 NO_COLOR 時 degraded-report 或 run-tests 的測試是紅的卻沒修 在 i9 用 env -u NO_COLOR 跑那兩個檔必須綠
  - 拿掉 i9 鏈腳本的那兩行之後整鏈變紅 拿掉之後的那條鏈必須綠
  - 改的時候把原本的斷言放鬆(少一條 expect 或改成比較寬的比對) 三個檔的斷言數與期望字樣前後要一樣
---

# 工單 T60:測試封閉性——四處依賴跑測試那台機器的東西

> 狀態:起草 2026-10-27,依協調者 2026-10-27 的交代(低優先小票合併;T58 的 F2 另開 T61)。顧問 2026-10-27 審過 `fd9d269`:D1 甲(只修三處);`NO_COLOR` 找到出處,改成第 4 處(見最後「顧問裁定」)。規格:UI/Tauri 負責人(代筆)。編號 T60:協調者配的。
> **排序**:T59 + T61 先走,T62 接 T61,T60 最後(協調者 2026-10-27)。
> **只改測試,不改程式。** 由測試 agent 改(測試只由它改),不派開發 worker。LLM 真呼叫 0。
> `NO_COLOR` 那一處起草時在 repo 裡找不到,因為它不在 repo:在 i9 的鏈腳本裡(第 4 處)。

## 為什麼有這張

測試應該只碰自己建的暫存目錄。起草時量到兩處會碰跑測試那個人的家目錄,一處要求機器上先有一個特定的暫存資料夾。2026-10-26 把重活搬到 i9 時,要先在那台建一個空的帳本與那個暫存資料夾,測試才會過,就是這個原因。i9 的 `~/chain-logs/run-chain.sh` 第 2 行建那個暫存資料夾(遮住第 3 處),第 4 行 `export NO_COLOR=1`(遮住第 4 處)。

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

### 4. `NO_COLOR`:i9 的鏈腳本替測試設了(**協調者查到,還沒量**)

- i9 的 `~/chain-logs/run-chain.sh` 第 4 行 `export NO_COLOR=1`,2026-10-26 設 i9 時加的。當時記的原因是 `scripts/degraded-report.test.ts` 對色碼敏感。
- repo 裡沒有任何一行提到 `NO_COLOR` 或 `FORCE_COLOR`,`scripts/degraded-report.ts`、`scripts/run-tests.ts` 與它們的測試也沒有處理色碼的程式。所以要先量:不設 `NO_COLOR` 時,這兩個測試到底紅不紅。

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
5. **`NO_COLOR`(測試 agent 先在 i9 量,輕活)**:
   - 乾淨簽出(main 的 tip,沒有 `.env`);
   - `env -u NO_COLOR VITEST_MAX_WORKERS=1 npx vitest run scripts/degraded-report.test.ts scripts/run-tests.test.ts`;
   - **紅**:在 T60 修那幾條測試。做法二選一:比對前先拿掉色碼,或在起子行程時明寫 `NO_COLOR`。斷言不放鬆;
   - **綠**:這一處拿掉,工單記「量過不需要」。
6. **合併後(協調者)**:把 i9 `run-chain.sh` 建暫存資料夾的第 2 行拿掉;第 5 點量過不需要的話,第 4 行 `NO_COLOR` 也一起拿掉。拿掉之後再跑一條整鏈,還是綠,才算真的封閉。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 平常跑 | `VITEST_MAX_WORKERS=1 npx vitest run scripts/review.test.ts scripts/review-router.test.ts scripts/check-gates-pinned.test.ts` | 全綠 |
| 空的 HOME | 同一行,前面加 `env -u XDG_CACHE_HOME -u XDG_CONFIG_HOME HOME=<新開的空暫存目錄>` | 全綠;跑完那個 HOME 底下沒有 `.cache` 與 `.config`(`.npm` 是 npx 自己的,不算) |
| 真的快取 | 平常跑之前與之後,各數一次真的 `~/.cache/llm-learning-cards/` 底下的資料夾數 | 前後一樣(只記數字) |
| 暫存路徑 | 跑之前與之後,各列一次 `TEMP_BASE` 原本那個路徑底下的東西 | 前後一樣(它是 opencode 的,這張只看、不刪) |
| 斷言沒放鬆 | `git diff <基底>..HEAD -- scripts/review.test.ts scripts/review-router.test.ts scripts/check-gates-pinned.test.ts` 裡被刪掉的行 | 沒有 `expect(` 開頭的行被刪;期望字樣(`Nothing is due`、`張未排程` 等)前後都在 |
| `NO_COLOR` | 在 i9 的乾淨簽出:`env -u NO_COLOR VITEST_MAX_WORKERS=1 npx vitest run scripts/degraded-report.test.ts scripts/run-tests.test.ts` | 全綠(第 5 點修過,或本來就綠) |
| 真的封閉 | 合併後,i9 的 `run-chain.sh` 拿掉那一兩行,跑一條整鏈(重活,拿位子) | 整鏈綠 |
| 空 HOME 全套 cucumber | 在 i9 用空的 HOME 跑一次全套 cucumber(重活,拿位子) | 不是過關條件。記:HOME 底下多出幾個資料夾、哪些場景紅。用來決定 D1 的乙要不要做 |
| 不動的地方 | `git diff --stat <基底>..HEAD -- packages apps contracts prompts 'features/**/*.feature' scripts/review.ts scripts/degraded-report.ts scripts/run-tests.ts scripts/check-gates-pinned.sh vitest.config.ts` | 沒有輸出 |

**改壞證明**(驗收 agent):

- 把 1 的 `XDG_CONFIG_HOME` 拿掉,用空的 HOME 跑 → 第 221 行那條紅;
- 把 2 的 `XDG_CACHE_HOME` 拿掉,用空的 HOME 跑 → HOME 底下多出 `.cache`;
- 把 3 改回寫死的路徑 → 那個路徑底下多出 `t4b` 開頭的暫存資料夾;
- 第 5 點修了的話:把修的那一行拿掉,`env -u NO_COLOR` 跑 → 那幾條紅。

## 受保護的檔

- 程式(`scripts/review.ts`、`packages/`、`apps/`)、`.feature`、契約、`vitest.config.ts`:這張不改。

## 落點

- `scripts/review.test.ts`、`scripts/review-router.test.ts` → 11-review-cli;`scripts/check-gates-pinned.test.ts`、`scripts/degraded-report.test.ts`、`scripts/run-tests.test.ts` → infra(`scripts/boundaries.owners.json`)。後兩個只有第 5 點量到紅才改。
- R2:跟 T59(03)、T61 與 T62(02)不相交。i9 的 `run-chain.sh` 不在 repo 裡,不算 touches。

## 顧問裁定(2026-10-27)

審 `fd9d269`:

- **D1 = 甲**:只修三處。乙(vitest 全域 setup)等驗收時空 HOME 的全套 cucumber 量完再決定。
- **`NO_COLOR` 不是找不到**:在 i9 的 `~/chain-logs/run-chain.sh` 第 4 行。同一個檔第 2 行建暫存資料夾,遮住的就是第 3 處。工單改成:
  1. 測試 agent 先在 i9 量一次(第 5 點);
  2. 合併後拿掉 `run-chain.sh` 那一兩行,鏈還是綠才算真的封閉(第 6 點);
  3. 驗收時在 i9 用空 HOME 跑一次全套 cucumber,記多出幾個資料夾、哪些場景紅;
  4. 筆電 `~/.cache` 那 497 個資料夾不刪,由使用者決定。
- 排序:T59 + T61 先走,T62 接 T61,**T60 最後**。

## 觀察(不在範圍)

- **F1:真的快取裡那 497 個資料夾。** 不刪(顧問裁:由使用者決定)。要清的話由使用者自己來:留下指標檔 `vault_id` 那一個,其他都是測試留下的。
- **F2:uuid 名的 394 個還有別的來源。** 上面 1、2 兩處每跑一次各留 1 個,對不上 394。最可能是 cucumber 步驟(`features/steps/` 有 11 個碰 session 的檔),那是重活,起草時沒量。驗收時在 i9 用空的 HOME 跑一次全套 cucumber(上面的驗收表),量完再決定 D1 的乙。

## 低優先小票清單(協調者不另建清單檔,記在工單裡)

- **D1 的乙**:vitest 多一個 setup 檔,整個測試行程的 `XDG_CONFIG_HOME`、`XDG_CACHE_HOME` 預設指到暫存目錄。等驗收時空 HOME 的全套 cucumber 量完,有別的漏洞才開。落點 infra(`vitest.config.ts`),要先確認沒有測試故意讀真的位置。

## 預算

`budget_usd: 1`(測試 agent 改三到五個測試檔)。LLM 花費 0。`cpu: light`(改測試與第 5 點的量測都是輕活);整鏈與空 HOME 的全套 cucumber 是驗收的重活,協調者排位子。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底 main `d64b1d5`,只給測試 agent。派工歸協調者。

## 起草時量的(只讀)

- 用空的 HOME 跑 `scripts/review.test.ts`:20 條紅 1 條(第 221 行),訊息是指標檔不存在。
- 用空的 HOME 跑 23 個碰 session 快取的 vitest 檔(`packages/core/src/session/`、`scripts/review-*.test.ts`、`features/support/` 的 sidecar/cli 測試、兩個 app 的 `dev/standalone.test.ts` 等):612 條全綠,HOME 底下多出 1 個快取資料夾。一個一個檔跑,找到是 `scripts/review-router.test.ts`。
- 真的 `~/.cache/llm-learning-cards/`:497 個資料夾(394 uuid、103 `path-`),最舊 2026-10-16、最新 2026-10-25。只數,沒有打開、沒有刪。
- 量測用的空 HOME 是暫存目錄,量完刪掉。
