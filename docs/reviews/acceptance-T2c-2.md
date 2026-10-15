# 驗收證據:T2c-2 desktop-shell 的 learning 根目錄只有一個來源(指標檔)

驗收角色:-ed(測試 agent 兼驗收)。日期:2026-10-15(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`t2c2-claude` @ `e0ad891`(樹 `2380293af152`),base `t2c2-base` = `8ea6be0`,再合進我的 `t2c2-red`(含 `c99d4bb`)。
worker 的實作 commit `c182653`,合併 `53fb6b1`,報告 `e0ad891`。實作者:Claude(名目成本 $10.05)。
我的補測在其上的分支 `pollux0971/t2c2-accept-tests`;所有突變都在驗收用簽出做、事後還原。
我只交證據與測試。不合併、不 push、沒改 worker 的實作檔(只動了我自己的測試、`mutants.toml` 的設定與紀錄)。

## 0. 結論

**實作沒有阻擋項。** 工單驗收 1–5、8–11 的自動化部分都有會紅的測試,而且實作全綠;驗收 6(`@manual` 截圖)與驗收 9、11 的「實機」部分歸前端與顧問。
測試端有三類缺口,都是我的:(1) 一條 `boundaries` 紅(我的 probe 測試跨資料夾 import 01 的 schema);(2) 新檔 `start_screen.rs` 沒有 Rust 測試——cargo-mutants 存活 27 條,其中 `escape_html` 五個分支全部存活(路徑來自使用者的指標檔,頁面上是任意字串);(3) `ensure_state_dir` 沒有直接的 Rust 測試。三類都已補,補完之後實作突變 15 條全紅,cargo-mutants 地板升到 183/202。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| F-1 | 缺口,已補 | `npm run boundaries` 紅 1 條:`learning-root-probe.test.ts` 跨資料夾 import `packages/core/src/schema/log.js`(worker 報告待協調 #1)。是我的測試的錯,不是實作 | 已改成只對契約 §10 的最小形狀(ISO 含時區 + type 是字串);boundaries PASS |
| F-2 | 缺口,已補 | `start_screen.rs`(畫面文字、視窗清單、HTML 轉義、回應標頭、網址)沒有任何 Rust 測試;cargo-mutants 存活 27 條。畫面上的資料夾路徑是指標檔裡的任意字串,轉義是安全邊界 | 補 `tests/start_screen.rs` 11 條;重跑後 27 條全殺 |
| F-3 | 缺口,已補 | `event_log::ensure_state_dir`(驗收 10)只有 probe 與 cucumber 會紅,cargo 測試不紅(worker 預告過) | 補 `tests/event_log.rs` 4 條(建 state/、已存在不算錯、是一般檔案就失敗且不動它、根不存在不建根);殺掉 1 條,剩 1 條等價 |
| F-4 | 缺口,已補 | webview 的 `LearningNotConfiguredError`(worker 做的最小版)沒有測試——工單沒定 TS 側形狀 | 補 1 條測四個方法分類一致;2 條突變紅。**形狀由前端決定**,改名要跟著改這條 |
| F-5 | 備註,給前端 | 真的 app 的接線(`main.rs` 的 `open_windows`、`lc-start` 自訂協定、`setup` 視窗、`tauri.conf.json` 的 `create: false`)**沒有自動化測試能開視窗**;能自動化的部分(文字、轉義、視窗清單、回應標頭、網址、狀態解析)都過了。其餘歸驗收 6 的 `@manual`(用 `tauri build` 產物,驗收 11) | 前端截圖 |
| F-6 | 備註 | witness 報告的 `未標記 156 > 基準 152`:**不是 T2c-2 造成的**——報告裡沒有任何 `apps/desktop` 的測試觸發退化分支;這個分支的基底不含 T8/T9(T8 驗收時我量到 base 本來就 154–156,T8 之後 151、T9 之後 147)。合進現在的 main 之後預期 147 | 見 §2 |
| F-7 | 備註 | 驗收中 load 一度到 22:自己的兩份 cargo-mutants,加上主機上另一個專案(`~/Desktop/教學系統`)的 node。cargo-mutants 輸出 **0 條 TIMEOUT**,所以沒有「高負載逾時」要重跑的突變 | 見 §4 |
| F-8 | 成本 | worker 名目 $10.05,預算 $12 = 0.84×;額度 5h 15%/7d 12%(開工 13%/11%) | 記錄 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 `acceptance-t2c2`(基於 `t2c2-claude`)。
- **測試作者檢查**:`git diff --name-only c99d4bb e0ad891` 中 `*.test.*`、`/tests/`、`test-support/`、`features/steps/**`、`.feature`、`contracts/fixtures/**` 的變動共 **0** 個;worker 動 16 個檔:`mutants.toml`、`Cargo.lock/toml`、`asset_protocol.rs`、`bin/lc-fs.rs`、`commands.rs`、`event_log.rs`、`learning_fs.rs`、`learning_root.rs`(新)、`lib.rs`、`main.rs`、`start_screen.rs`(新)、`tauri.conf.json`、`startup.ts`(刪)、`webview/learning-fs.ts`、報告。
- 驗收前後 `learning/`(唯一量法):**64 檔 / `c5aa80b18b474ed4` / 52 行**,前後相同(我只讀)。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `cargo test`(`CARGO_BUILD_JOBS=2`) | 全綠:lib 4、`asset_protocol` 19、`atomic_write` 14、`commands` 24、`event_log` 10、`learning_fs` 28、`learning_root` 10、`path_guard` 11;加我的補測後 `event_log` 14、`start_screen` 11 |
| vitest `apps/desktop` | 11 檔 124 條綠;加我的補測後 125 條 |
| cucumber 全 feature | 737 場景(241 undefined、496 passed),3436 步;undefined 數與 base 相同,多出的 21 個場景(新的 phase-2 場景)全綠 |
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries` | **修我的 import 之前紅 1 條(F-1),之後 PASS**(掃描 247) |
| `npm run lint:docs` | PASS |
| `witness:degraded` | 3477 條綠;訊號目錄 28/28/28;未標記 156(基準 152,見 F-6);沒有任何 `apps/desktop` 測試觸發退化分支 |
| 併進最新 main(`8e752a3`) | `git merge-tree`:無衝突 |
| 靜態:`startup.ts` 已刪;`LC_LEARNING_ROOT` 在非測試程式零命中;只有 `learning_root.rs` 寫路徑名;`main.rs` 只 `resolve` 一次 | 全綠(`learning-root-static.test.ts`) |

## 3. 工單 `must_catch` 的突變(對 worker 的實作做,15 條)

做法:改一處實作 → 跑完整的 `cargo test` + vitest `apps/desktop` + cucumber 全 feature → 記紅 → `git checkout` 還原 → 確認回綠。

| 工單條 | 突變 | 結果 |
|---|---|---|
| 根目錄有第二個來源 | A:`resolve` 在沒有指標檔時退回 `LC_LEARNING_ROOT` | 紅(vitest 的「沒有指標檔但設了環境變數」) |
| 身分不符被放行 | B:標記比對 `|| true` | 紅(cargo) |
| 指標檔路徑跟 T5 不同 | C:改用 identifier 目錄;C2:忽略 `XDG_CONFIG_HOME`;D:空字串當有設 | 全紅(向量檔逐列) |
| 第三份 bootstrap / 寫檔 | E:解析 ok 時建 `state/`;F:沒有指標檔時建指標目錄 | 全紅(解析不寫檔的逐列檢查) |
| 四種失敗混在一起 | G:讀不到當成不存在;G2:資料夾不存在當成身分不符 | 全紅(狀態向量) |
| 標記容許多個結尾換行 | N | 紅(向量 + 狀態列) |
| `default-run` | H:拿掉 | 紅(`cargo metadata` 靜態檢查) |
| 沒有 logger | J:`init_logging` 變空 | 紅(`state` 是一般檔案那列的 stderr 斷言) |
| asset 協定範圍 | K:`guard` 不檢查白名單與 symlink;K2:解碼後不再跑 `check_rel_path` | 全紅 |
| command 與 lc 各自解析 | P:`commands.rs` 多一個 `learning_root::resolve(` 呼叫 | 紅(靜態:只有 `main.rs` 解析一次) |

兩條我的補測也做了突變:T1(webview 不認 `not-configured`)、T2(把它當 io 錯誤)——都紅。

## 4. cargo-mutants(驗收 7)

指令:`NODE_OPTIONS=--import=tsx TMPDIR=<repo>/dist/mutants-tmp CARGO_BUILD_JOBS=2 MUTANTS_JOBS=2 node apps/desktop/src-tauri/run-mutants.mjs`,取機器範圍的鎖。`examine_globs` 加了 `start_screen.rs`(worker 只加了 `learning_root.rs`)。

- 第一輪(43 分鐘):**256 tested,155 caught,47 missed,54 unviable。** `learning_root.rs` **0 條存活**。47 條存活:`start_screen.rs` 27、`event_log.rs` 的 `ensure_state_dir` 2、其餘 18 條是 T2c-1 驗收證據第 6.1 節已分類的舊存活(`asset_protocol` 的 `fallback` 三條、`learning_fs` 的 fsync/close 一組與 `exists` 守衛等、`path_guard` 的 `check_structure` 四條);兩個自我回報函式已刪,所以比 T2c-1 的 29 少。
- 補測後只重跑 `start_screen.rs` 與 `event_log.rs`(16 分鐘):**59 tested,51 caught,1 missed,7 unviable。** 剩下的一條:`ensure_state_dir` 的 `!= AlreadyExists` 守衛換成 `false`——等價:守衛不成立時落到 `_ => Ok(())`,下一步開檔會把同樣的錯交出來。
- 合計:**183 caught,19 missed**(18 條舊的已分類存活 + 1 條等價)。地板 = **183/202(90.6%)**,舊地板 127/156(81.4%);已寫進 `mutants.toml`。
- **TIMEOUT:0 條。** 這段時間 load:第一輪期間 1 分鐘平均 14–22(自己兩份 `rustc`/`rust-lld` 加主機上另一個專案的 node),第二輪開始時 1.65。沒有突變被判 TIMEOUT,所以沒有需要「高負載逾時,待低負載重跑」的條目。

## 5. 對抗審查(grok-4.20)

`opencode run -m xai/grok-4.20-0309-reasoning`,從空目錄跑,提示給 `learning_root.rs`、`commands.rs`、`main.rs`、`start_screen.rs` 與 `event_log` 的 diff。五條主張,我逐條查:

1. `ensure_state_dir` 在 learning 根建 `state/`,違反「桌面程式只讀」——**是工單驗收 10 明文要求的**(warning 不能因為 `state/` 不存在而靜默消失);只在要寫 warning 時建,啟動時不建(`learning-root-probe.test.ts` 與 Rust 解析測試守著)。不是缺陷。
2. 指標檔在 `exists()` 與 `read` 之間被刪或改權限,狀態在 missing 與 unreadable 之間跳——**成立但屬已知限制**:解析只在啟動做一次,之後沒有再讀(這是設計:四個 command 與 `lc` 共用一份),T5 的 TS 版也是同樣的 TOCTOU(T8 工單已記)。單人程式,接受。
3. `learning_dir` 是 symlink,在 `exists`/`canonicalize` 與讀標記之間被換掉——**同上**。解析結果的 `root` 是 canonical 路徑,之後的 command 與 asset 都以它為根;啟動後換 symlink 不影響已解析的根。
4. `LearningDirMissing` 仍碰了 learning 目錄(`exists`/`canonicalize`)——**不成立**:那是唯讀的 stat,不是寫入,也不是開檔;驗收 5 守的是「前後檔案清單與雜湊不變」,逐列測過。
5. 失敗狀態的 Resolved 可能走到 `append_to_log`——**不可達**:`commands` 與 `main.rs` 的退出清理都經過 `LearningRoot::dir()`,失敗狀態回 `NotConfigured`;`tests/commands.rs` 測四種失敗下四個 command 都不建任何東西。

## 6. 補測

我的 commit(`pollux0971/t2c2-accept-tests`):
- 修 boundaries 紅(F-1);
- `tests/start_screen.rs` 11 條:五個標題逐字、`text` 各態內容(`--force` 只在該有的地方)、`shell_word` 引號(空白、`$()`、單引號、`;`、非 ASCII、空字串)、`page` 的 HTML 轉義(`<script>`、`&`、`"`、`'`、`>` 逐一,且不轉兩次)、標題與 `<pre>` 的分工、四態頁面互不相同、回應標頭(`nosniff`、CSP 無 `script-src`)、網址與協定名(`lc-start` ≠ `lc`);
- `tests/event_log.rs` 4 條(F-3);
- `webview-learning-fs.test.ts` 1 條(F-4);
- `mutants.toml` 納入 `start_screen.rs`、地板升到 183/202。

## 7. 給前端與顧問

1. 驗收 6 / 9 / 11 的實機部分:用 `tauri build --debug --no-bundle` 的產物看五種狀態;worker 的 `setup` 視窗是 `lc-start://localhost/` 的靜態頁,CSP 為 `default-src 'none'; style-src 'unsafe-inline'`——請確認 `tauri build` 的 app CSP 不會擋掉它自己的自訂協定頁面。
2. 畫面文字(worker 報告待協調 #3):三個 `--force` 指令,以及 marker-mismatch 直接把資料夾路徑填進 `init` 指令(路徑有空白或特殊字元時會用單引號包起來,測試守著)。
3. TS 側 `LearningNotConfiguredError` 的名字與欄位(`name`、`relPath`)是 worker 的最小版,由前端決定。
4. worker 報告待協調 #5(Rust 的 `serde_json` 與 Node 的 `JSON.parse` 對落單 surrogate、超出範圍的數字、巢狀超過 128 層的差異):向量沒有這幾列,兩邊目前行為不同;單人程式、指標檔由 `vault.ts` 寫出,不會有這種內容,記下不處理。

## 8. 成本

worker 名目成本 $10.05;工單預算 `budget_usd: 12`。比值 **0.84×**。額度 5h 15% / 7d 12%(開工 13% / 11%)。
