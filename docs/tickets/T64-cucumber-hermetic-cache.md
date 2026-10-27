---
id: T64
deps: []
touches: [features/steps/_hermetic-cache.ts, features/support/hermetic-cache.ts]
cpu: light
budget_usd: 1
status: todo
owner: 測試
must_catch:
  - BeforeAll 沒把 XDG_CACHE_HOME 指到暫存目錄 在 i9 用空 HOME 跑全套 cucumber 跑完 HOME 底下多出 .cache/llm-learning-cards 必須抓到
  - AfterAll 沒刪那個暫存快取目錄 跑完暫存目錄還在必須抓到
  - 收工沒把 XDG_CACHE_HOME 還原成原本的值(原本沒設就要刪掉這個鍵) 還原那條單元測試必須紅
  - 已經自己指了 XDG_CACHE_HOME 的 harness 被蓋掉 那幾個 harness 的場景結果必須跟基準一樣
  - 場景結果跟基準不同(787 場景、720 過、1 失敗、66 undefined) 多一個少一個都要能解釋
  - 動到 vitest 設定、packages、scripts 或任何 .feature 不動的地方那條 diff 必須有輸出
---

# 工單 T64:cucumber 起的子行程與步驟,`XDG_CACHE_HOME` 一律指暫存目錄

> 狀態:起草 2026-10-27,依協調者 2026-10-27 的交代(顧問裁定,低優先)。顧問 2026-10-27 審過 `ecace49`:D1、D2 照建議,改 2 處(見最後「顧問裁定」)。規格:UI/Tauri 負責人(代筆)。編號 T64:協調者配的。
> **只改測試的支援層,不改程式。** owner 是測試 agent,不派開發 worker。LLM 真呼叫 0。
> 範圍只有 cucumber 的 support 層。**不碰 vitest 的全域設定**(T60 的 D1 乙不做)。`XDG_CONFIG_HOME` 這張**只量不改**。

## 為什麼有這張

T60 驗收時在 i9 用空 HOME 跑了一次全套 cucumber(`docs/reviews/acceptance-T60-impl.md` 第 5 節):

- 結果:787 個場景,720 過、1 失敗、66 undefined。唯一的失敗是 `05-grading/phase-3` 第一個場景,那個 phase 還沒做。
- 跑完 HOME 底下多出 `.cache/llm-learning-cards/`,裡面 **9 個 uuid 名的資料夾**,沒有 `path-` 名的。沒有逐場景歸因。
- 平常在筆電跑,這 9 個就寫進使用者真的 `~/.cache`。

## 起草時查的(grep,沒有跑 cucumber)

- **沒有全域的 hook**:`features/steps/` 裡的 `BeforeAll` 只有兩個(`desktop-shell-learning-root.steps.ts` 第 42 行、`desktop-shell-phase2.steps.ts` 第 83 行),都是在編 `lc-fs`。`AfterAll` 三個,都在關 vite 與 Chrome。沒有一個在設環境變數。
- **`_world.ts` 的 `runCommand`、`startDevServer`** 都是 `withoutNodeOptions(process.env)` 再疊上呼叫端給的值。所以 cucumber 行程的 `process.env` 裡有什麼,子行程就有什麼。
- **已經自己指了 `XDG_CACHE_HOME` 的**(不用改,而且不能被蓋掉):
  - `features/support/review-session-harness.ts`:第 370 行先把 `XDG_CACHE_HOME`、`XDG_CONFIG_HOME`、`HOME` 從 `process.env` 拿掉,再指到自己的暫存目錄;
  - `review-sidecar-harness.ts`、`teach-harness.ts`、`t43-harness.ts`:用上面那一份;
  - `test-card-rig.ts` 第 89 行:同樣指暫存目錄;
  - `ingest-cli-runner.ts`:T62 加的,HOME、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME` 都指暫存目錄。
- **沒指 `XDG_CACHE_HOME` 的**:`features/steps/i2-review-loop.steps.ts` 第 394 行的 `childEnv()`。它把 `XDG_CONFIG_HOME` 指到 `setupVault` 建的暫存帳本(那裡有 `vault-id`),但 `XDG_CACHE_HOME` 是從 `process.env` 原樣帶下去。它起的 `scripts/review.ts`(互動模式與 `--dry-run`)會寫或讀當日的 session 快取,資料夾名就是那本暫存帳本的 `vault-id`,也就是 uuid 名。
  - I2 的 feature(`docs/integration/i2-review-loop-headless.feature`)有 14 個不是 `@manual` 的場景,大多走這條。**9 個 uuid 資料夾多半就是這裡來的**,但這是推測,驗收時要逐 tag 歸因(見驗收條件)。
- **其他起子行程的步驟**:
  - `hud-skin*.steps.ts`、`work-dag.steps.ts`、`data-layer.steps.ts`、`dag-p2-harness.ts`:不碰 session 快取;
  - `test-card-phase2-sidecar.steps.ts` 第 59 行:跑 `cargo test`,也不碰。

## 要的結果

1. **新檔 `features/support/hermetic-cache.ts`**(純函式,vitest 測得到):
   - `installHermeticCache(env = process.env)`:`mkdtempSync(join(tmpdir(), 'lc-cucumber-cache-'))`,記下 `env.XDG_CACHE_HOME` 原本的值(含「原本沒設」),把 `env.XDG_CACHE_HOME` 設成新目錄。回傳 `{ dir, restore }`;
   - `restore()`:刪掉那個目錄(`rmSync` recursive、force),`XDG_CACHE_HOME` 還原成原本的值。原本沒設就 `delete` 掉這個鍵,不是設成字串 `'undefined'`。
2. **新檔 `features/steps/_hermetic-cache.ts`**(cucumber 的 hook,底線開頭跟 `_world.ts` 一樣):
   - `BeforeAll` 呼叫 `installHermeticCache()`;
   - `AfterAll` 呼叫 `restore()`。
   - 一次 cucumber 行程一個暫存快取目錄(D1)。`cucumber.js` 沒開平行,只有一個行程。
3. **不改任何 harness 與步驟**。已經自己指的照舊用自己的。`i2-review-loop.steps.ts` 的 `childEnv()` 是 `...rest`(從 `process.env` 來),`BeforeAll` 設好之後自動帶到暫存目錄,不用改。
4. **`XDG_CONFIG_HOME` 只量不改**:見驗收條件的「指標檔」那一列。量到有場景故意讀真的指標檔,就列出來交顧問,這張不改。

起草時靜態看過可能讀指標檔的入口,都不讀:

- `standalone.json` 裡會被 cucumber 起的指令:
  - `scripts/grade.ts --fill`:`lazyVerifiedRouter` 只在真的要呼叫模型時才解析,fixture 的答案是完全相符,不呼叫;
  - `scripts/llm.ts --probe`:在解析指標之前就回傳;
  - `scripts/review.ts --dry-run`:不建 router。
- 其他起 CLI 的 harness 都自己指 `XDG_CONFIG_HOME`。

所以預期是 0 個。這只是推測,要量。

## 紅測試與單元測試(測試 agent)

- **單元**(建議 `features/support/hermetic-cache.test.ts`,傳一個假的 env 物件進去,不碰真的 `process.env`):
  - 原本沒設:裝上之後是新目錄、目錄存在;還原之後鍵不見了、目錄不在;
  - 原本有值:還原之後是原本那個值;
  - 新目錄在 `os.tmpdir()` 底下,而且每次呼叫都是不同的目錄。
- **紅在哪裡**:單元測試在基底上紅(檔還不存在)。整套 cucumber 的效果靠驗收量,不另寫 cucumber 場景(不改 `.feature`)。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 單元 | `VITEST_MAX_WORKERS=1 npx vitest run features/support/hermetic-cache.test.ts` | 全綠 |
| 快取封閉 | **在 i9**:`env -u XDG_CACHE_HOME -u XDG_CONFIG_HOME -u NO_COLOR HOME=<新開空目錄> …`(其他照 T60 驗收第 5 節那一行)`NODE_OPTIONS=--import=tsx npx cucumber-js --tags "not @manual"` | 跑完 HOME 底下**沒有** `.cache/llm-learning-cards`。Chrome 的 `.cache/fontconfig` 等是瀏覽器自己的,照 T60 記下不算(重活,拿位子) |
| 場景結果 | 同一次 | **總數 787 不變**。基準是 T60 那次的 720 過、1 失敗、66 undefined。**T65 先合併的話**,05 phase-3 的場景 7–9 會從 undefined 變成過,預期 **723 過、1 失敗、63 undefined**。不管哪一種,多一個或少一個都要逐條解釋(例如期間有別的工單合併,新增或做完了場景) |
| 暫存目錄 | 同一次,跑之前與之後列 `os.tmpdir()` 底下 `lc-cucumber-cache-` 開頭的 | 跑完一個都不剩 |
| 歸因 | 改之前(基底)在 i9 用空 HOME 跑 `--tags "@i2 and not @manual"`,數 HOME 底下的 uuid 資料夾;改之後再跑一次 | 改之前的數字記下來(預期接近 9);改之後 0。不是 9 的話,用 tag 二分找出其他來源,寫進證據 |
| 指標檔(只量) | 在 i9 用 `XDG_CONFIG_HOME=<暫存目錄>`,裡面放一份**有效的**指標檔,指到一本哨兵帳本(有 `vault-id`、`state/log.jsonl` 預先一行)。再跑一次全套 cucumber(`--tags "not @manual"`) | 只記錄,不是過關條件:<br>• 哨兵帳本的樹雜湊與 `log.jsonl` 行數前後一樣,代表沒有場景寫進機器指標指到的那本;<br>• 有變的話,用 tag 二分找出是哪些場景,列給顧問 |
| 真資料 | 筆電的 `learning/` 前後量三項;筆電 `~/.cache/llm-learning-cards` 頂層數 | 都相同(這張的重活全在 i9,筆電不跑 cucumber 全套) |
| 不動的地方 | `git diff --stat <基底>..HEAD -- packages apps scripts contracts prompts docs ':(exclude)docs/reviews' ':(exclude)docs/tickets' 'features/**/*.feature' vitest.config.ts vitest.mutate.config.ts cucumber.js` | 沒有輸出。`docs/reviews`(驗收證據自己會加)與 `docs/tickets` 排除 |

**改壞證明**(驗收 agent):

- `BeforeAll` 那一行拿掉 → `--tags "@i2 and not @manual"` 空 HOME 跑完多出 uuid 資料夾;
- `restore()` 不刪目錄 → 暫存目錄那一列抓到;
- `restore()` 原本沒設時設成字串 → 單元測試紅。

## 受保護的檔

- `packages/`、`apps/`、`scripts/`、`contracts/`、`prompts/`、`.feature`、`vitest.config.ts`、`cucumber.js`。
- 既有的 harness(`review-session-harness.ts` 等)與步驟檔:這張不改。

## 落點

- `features/steps/`、`features/support/` → steps(`scripts/boundaries.owners.json`)。
- R2:跟 T65(05-grading)、其他進行中的工單不相交。

## 顧問裁定(2026-10-27)

審 `ecace49`:

- **D1 = 甲**:一次 cucumber 行程一個暫存目錄(`BeforeAll`/`AfterAll`)。今天場景之間本來就共用同一個 `~/.cache`,最小改動。每個場景一個留在低優先小票清單。
- **D2 = 甲**:拆成純函式(`features/support/hermetic-cache.ts`,vitest 測得到「還原」)加 hook(`features/steps/_hermetic-cache.ts`,vitest 不會載它)兩個檔。
- 改 2 處:
  1. 「不動的地方」那一列的 `docs` 會被驗收證據自己弄紅,改成排除 `docs/reviews` 與 `docs/tickets`(T65 同樣排除);
  2. 場景基準:總數 787 不變。T65 先合併的話,場景 7–9 從 undefined 變成過,預期 723 / 1 / 63,照「多一個少一個都要解釋」記。

## 低優先小票清單(協調者不另建清單檔,記在工單裡)

- **每個場景各自一個快取目錄**(D1 的後者):量到有場景之間互相影響時再開。

## 預算

`budget_usd: 1`(測試 agent 寫兩個小檔加一個單元測試)。LLM 花費 0。`cpu: light`;i9 的全套 cucumber(三到四次:基底的 I2、改後全套、指標檔哨兵全套)是驗收的重活,協調者排位子。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,沒有 `.env`,基底 main `92c0e87`,只給測試 agent。派工歸協調者。
