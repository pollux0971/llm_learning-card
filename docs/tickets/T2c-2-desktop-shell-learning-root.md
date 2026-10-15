---
id: T2c-2
deps: [T5, T2c-1]
touches: [apps/desktop/]
cpu: heavy
budget_usd: 12
status: todo
owner: worker-grok
must_catch:
  - 根目錄有第二個來源:加回 LC_LEARNING_ROOT 環境變數的退路,「沒有指標檔、但有環境變數」的測試必須紅
  - 身分不符被放行:拿掉 vault_id 與 learning/config/vault-id 的比對,身分不符的測試必須紅
  - 指標檔路徑跟 T5 不同:改用 Tauri 的 app_config_dir(會是 ~/.config/dev.learningcards.desktop/),或忽略 XDG_CONFIG_HOME,路徑測試必須紅
  - 桌面程式長出第三份 bootstrap:Rust 寫指標檔或 config/vault-id(任何一個),靜態檢查與「首次啟動不寫任何檔」的測試必須紅
  - 四種失敗混在一起:任兩種失敗回同一個啟動狀態(例如讀不到與不存在都顯示「找不到資料夾」),狀態向量必須紅
---

# 工單 T2c-2:10 desktop-shell phase-2 的 learning 根目錄只有一個來源(讀 T5 的指標檔)

> 狀態:草稿,待技術顧問審。
> 作者:UI/Tauri 負責人(前端)。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 決策紀錄:ADR-069(Rust 寫事件與原子寫入、asset 限流、SVG、首次啟動只讀)、ADR-070(TS 的 §11b 只留一份)。
> 檔案:行號指 T2b 的 `pollux0971/t2b-impl @ 51355fd`;以函式名為準。
> 與 T2c-1 的關係:原 T2c 依技術顧問 2026-10-15 裁決拆成兩張。本張是原 G。

## 為什麼有這張

2026-10-15 前端審查(P1-7):learning 根目錄有兩個互不相干的來源。

- Rust 讀環境變數 `LC_LEARNING_ROOT`(`apps/desktop/src-tauri/src/lib.rs:11-13` 的 `configured_root`);
- `apps/desktop/src/startup.ts:30-33` 的 `saveChosenPath` 用 `node:fs` 把 `{ learningDir }` 寫進另一份 JSON 設定(webview 也跑不了),Rust 沒讀。

使用者在首次啟動選了路徑,`lc://` 仍然全部拒絕(`main.rs:47-49`)。T5 定了 CLI 與帳本共用的使用者層指標檔;桌面程式讀同一份。

## 技術顧問裁決(2026-10-15)

- 桌面程式讀 `${XDG_CONFIG_HOME:-~/.config}/llm-learning-cards/vault.json` 的 `learning_dir`(T5 定)。
- **首次啟動選 (b):桌面程式只讀指標檔,不寫。** 讀不到就顯示清楚的畫面,寫明要跑
  `npx tsx scripts/vault.ts init --learning-dir <路徑>`。**不做第三份 bootstrap**:那牽涉錢與身分,多一份就多一個會分歧的地方。

## 前置(worker 開工前必須已在 main)

1. **T2c-1 已合併**(command、Rust 寫事件都在)。
2. **T5 已合併**,而且 T5 提供:指標檔的**路徑規則**、**JSON 格式**(`learning_dir`、`vault_id`)、`config/vault-id` 標記的格式、
   **四種失敗**的判定方式、**向量檔**(驗收 2 要跟它跑同一份)、`scripts/vault.ts init` 的**確切指令與參數名**。
   T5 若沒有出向量檔,本張不能開工,退回統籌補,不由 worker 自己定。
   ⚠️ 本稿引用的 `--learning-dir` 是技術顧問裁決的寫法;**以 T5 合併後 `scripts/vault.ts` 的實際參數為準**,不一致就以 T5 為準並回報。
3. **`features/10-desktop-shell/phase-2.feature` 已由統籌·契約更新、顧問審過**。First run 與 configured path 兩個場景(T2b 版 :9、:16)
   照裁決 (b) 改寫:
   - `And it offers to initialise the directory if it is empty` 與 `And the chosen path is saved to the configuration` → 改成
     「顯示要執行的 init 指令」「不寫任何檔」;
   - 新增「指標檔讀不到」「身分不符」兩個場景。

## 驗收條件

1. 桌面程式從**指標檔**取得 learning 根目錄;`lc` 協定與四個 command 用的都是**同一個**解析結果(Tauri state 存一份,不各自讀)。
   **不要用 Tauri 的 `app_config_dir`**(會變成 `~/.config/dev.learningcards.desktop/`,跟 CLI 找的不是同一個檔)。
2. **路徑規則、JSON 格式、失敗判定跟 T5 跑同一份向量**(讀 T5 的向量檔,逐列;不得自己新增或略過任何一列)。至少要涵蓋:

   | 環境 | 預期指標檔路徑 |
   |---|---|
   | `XDG_CONFIG_HOME=/tmp/x` | `/tmp/x/llm-learning-cards/vault.json` |
   | 沒設 `XDG_CONFIG_HOME`,`HOME=/tmp/h` | `/tmp/h/.config/llm-learning-cards/vault.json` |
   | `XDG_CONFIG_HOME=""`(空字串) | 照 T5 的向量(XDG 規範把空字串當沒設;T5 怎麼定就怎麼做) |

3. 啟動狀態(四種失敗各自一個狀態,畫面文字由 worker 回報、UI/Tauri 負責人審):

   | 狀態 | 預期 |
   |---|---|
   | 指標檔不存在 | 「還沒有設定 learning 資料夾」畫面,顯示要執行的 `scripts/vault.ts init` 完整指令;**不寫任何檔** |
   | 指標檔讀不到(權限)或不是合法 JSON | 「設定檔讀不到」畫面,顯示指標檔的絕對路徑;**不寫任何檔**、不覆寫它 |
   | `learning_dir` 不存在 | 「找不到資料夾」畫面,顯示那個路徑與 init 指令 |
   | `vault_id` 與 `<learning_dir>/config/vault-id` 不符(或 `config/vault-id` 不存在) | 「這不是同一個資料夾」畫面;**不自動改寫任何一邊** |
   | 全部正常 | 正常開啟兩個視窗 |

   四種失敗狀態下,四個 command 一律回「未設定」的錯誤(不是拒絕、不寫 warning),`lc` 協定一律 403。
4. **沒有第二個來源**:`apps/desktop/src-tauri/src` 的非測試程式碼裡 `LC_LEARNING_ROOT` 零命中;T2b 的 `startup.ts`(`node:fs`)
   不再被 app 使用(刪掉,或搬成測試支援並標明)。測試:沒有指標檔、但設了 `LC_LEARNING_ROOT=/tmp/x`,啟動狀態必須是「指標檔不存在」。
   測試與 probe 要指定根目錄,一律走「指向暫存目錄的 `XDG_CONFIG_HOME` + 暫存指標檔」,不另開後門。
5. **不寫檔**:靜態檢查 `apps/desktop/src-tauri/src` 的非測試程式碼,對 `vault.json` 與 `vault-id` 只有讀取。
   行為測試:五種狀態各跑一次啟動,前後 `XDG_CONFIG_HOME` 目錄與 learning 目錄的檔案清單與內容雜湊不變。
6. **`@manual`(UI/Tauri 負責人截圖,技術顧問判)**:五種狀態各一張截圖;四種失敗畫面的 init 指令可以直接複製貼上執行。
7. cargo-mutants:本張新增的 Rust(指標檔解析、身分比對、啟動狀態)納入,沿用地板棘輪。**由驗收者在拿到重活位子之後跑**
   (拿協調者指定的鎖、指令前面加 `CARGO_BUILD_JOBS=2`);開發 worker 不跑,只把新檔補進 `.cargo/mutants.toml` 的 `examine_globs`。

## 重活規則(技術顧問 2026-10-15 12:5x;開發 worker 自己跑 cargo-mutants,24 個行程把負載推到 34 之後補上)

1. **開發 worker 不跑變異測試。** cargo-mutants 與 Stryker 都是驗收 / 測試 agent 的工作,而且只在跟協調者拿到重活位子之後才跑。
   開發 worker 交件前只跑一般測試(`cargo test`、vitest、phase-2 的 cucumber),不跑 `run-mutants.mjs`、`cargo mutants`、`npm run mutate`。
2. **所有 cargo 指令前面加 `CARGO_BUILD_JOBS=2`**,例如 `CARGO_BUILD_JOBS=2 cargo test --test commands`。
   vitest 與 cucumber 會自己呼叫 `cargo build --bin lc-fs` 重編 probe,所以跑它們時也在指令前面加(環境變數會傳下去)。
3. **同一時間只開一個重活。** 完整 `cargo test`、cucumber、vite build、變異測試,一次一個;不在背景同時跑兩個,也不跟別的 agent 的重活重疊(先問協調者)。

## 預算

`budget_usd: 12`(技術顧問裁定)。**實際超過 2 倍($24)要在報告標出來。**

## 測試誰寫

- 測試 agent:紅測試、步驟定義、讀 T5 向量檔的 Rust harness。**等前置 1–3 都在 main 才開始。**
- 開發 agent(worker-grok):只寫實作,不改測試、不改 gherkin。**不跑變異測試**;cargo 指令加 `CARGO_BUILD_JOBS=2`;一次一個重活(見「重活規則」)。
- 驗收:照 `worker-acceptance`(含驗收 7 的 cargo-mutants),拿到重活位子才跑。
- UI/Tauri 負責人:驗收 3 的畫面文字與驗收 6 的截圖。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是含 T5 與 T2c-1 的 `origin/main`,同一時間一個 agent。派工歸協調者。
