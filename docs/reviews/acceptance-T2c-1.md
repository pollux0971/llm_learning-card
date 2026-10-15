# 驗收證據:T2c-1 desktop-shell phase-2 的接線

驗收角色:-ed(測試 agent 兼驗收)。日期:2026-10-15(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`t2c1-claude` @ `c0f8b38`,tree `174d3c84c824…`,base `t2c1-base` = `8a37942`(`origin/main` `49090e1` 加 -30 的紅測試 `465212c` 與 phase-2.feature)。
worker 4 個 commit:`bd2289a` 實作、`209a0f8` 工單兩處純文字、`2d7f487` run-mutants.mjs、`c0f8b38` 報告。
**開跑 tree sha:`174d3c84c824…`(c0f8b38)。** 我的補測在其上的分支 `pollux0971/t2c1-accept-tests`;所有突變都在驗收用簽出做、事後還原。
驗收簽出:`acceptance-t2c1`(detached 後另開分支,`npm ci`,沒有 `.env`);cargo 一律 `CARGO_BUILD_JOBS=2`,cargo-mutants `-j 2`,一次只開一個重活,取機器範圍鎖。
我只交證據與測試。不合併、不 push、沒改 worker 的任何實作檔。

## 0. 結論

**實作沒有阻擋項。** 工單 A–G 的驗收條件除了兩條 `@manual`(E15、F19,截圖歸前端與顧問)都有自動化證據;測試端找到並補上 5 類缺口(§9),補完之後所有非等價的突變都是紅。cargo-mutants 地板棘輪通過(§6)。有兩件合併時要處理(下表 U1、U2)。結論最後由顧問裁。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| U1 | **合併時要處理** | `run-mutants.mjs` 與前端分支 `t2c-tickets-heavy-work`(`3c5553d`)改同一檔,`git merge-tree` 確認**只有這一個檔衝突**(工單文字兩邊都改,但自動合併成功)。顧問裁決以前端版為準;前端版少一行 `ensureLockDir`(冒煙測試證實會 ENOENT),worker 的版本有那一行但把 `-j` 寫死成 4(違反兩份並行度的規定)。**建議採 `pollux0971/runmutants-smoke` 的 `1c955a9` 那個版本的 `run-mutants.mjs`**(前端版加 `ensureLockDir`;該分支的 15 條冒煙測試對它全綠) | 協調者併批時處理 |
| U2 | 已修 | worker 報告 §6 第 1 條:`npm run boundaries` 紅 1 條——`webview-imports.test.ts` 裡掃描器樣本的**字串**被邊界檢查器當成 10→01 的 import(連帶 `check-boundaries.local.test.ts` 兩條) | 我改了測試端(`7e506a3`):樣本字串改用 `JSON.stringify` 組,掃描器測試仍綠;boundaries PASS |
| F-1 | 缺口,已補 | `<name>.tmp` 用 `O_NOFOLLOW` 開(worker 報告 §6 第 4 點)沒有任何測試蓋到:拿掉它,全部 cargo 測試仍綠 | 補測 2 條,拿掉旗標與改壞清理都會紅 |
| F-2 | 缺口,已補 | TS 端 `read` 先 `trim` 路徑再送出:既有「原樣」測試沒有帶空白的路徑,全綠 | 補測 29 條(四個方法 × 七種怪路徑加內容原樣),四個突變全紅 |
| F-3 | 缺口,已補 | cargo-mutants 存活 38 條裡的 9 條非等價(分類表、list 在檔案上、經過一般檔案的路徑、舊樣式殘檔的精確判斷、`flush_refusals`) | 補測 5 條,存活降到 29,其餘逐條分類見 §6 |
| F-4 | 設計限制 | 狀態回報函式 `same_checks_as_read`、`scope_is_learning_root`(T2b 遺留)回傳常數 `true` 的版本沒有測試會紅(cucumber 只斷言它們回 true)。真正的行為由 `tests/asset_protocol.rs` 的 symlink 與解碼測試守住 | 不擋;建議之後刪掉這兩個自我回報函式或改成斷言行為 |
| F-5 | 工單前提不成立 | `must_catch` 第 14 條「Rust 段測試改成按 `rule` 過濾,47 列斷言必須紅」:`rule != "length"` 與 `applies_to` 含 `segment` **選出同一批 47 列**(那 4 列只適用於 `category` 的列恰好就是 4 列 `length`),所以按 rule 過濾與現況不可區分;「不過濾」變體則紅 | 顧問裁決:**等價突變,接受**,不開新票。要分得出來,需要向量檔多一列 rule 為 `length` 而 `applies_to` 含 `segment` 的列,屬於契約變更,這張不做 |
| F-6 | 流程 | 全程沒有碰 `@manual` 的 E15、F19(SVG script 不執行的截圖、兩個視窗看得到卡片與題目、devtools console 沒有 CSP 違規) | 前端與顧問 |
| F-7 | 備註 | `apps/desktop/src-tauri/placeholder/` 是 phase-1 的殘留,`tauri.conf.json` 已不引用,無害;`frontend/` 已刪 | 可之後清 |

## 1. 乾淨簽出與測試作者檢查

- `ls <acceptance-t2c1>/.env` → `No such file or directory`。
- **測試作者檢查**:`git diff --name-only 8a37942 c0f8b38` 中 `*.test.*`、`features/steps/**`、`test-support/**`、`fixtures/**`、`tests/**`、`.feature` 的變動共 **0** 個;worker 的 diff 也沒有新增或刪除任何 `#[test]`、`#[cfg(test)]`、`mod tests` 行(Rust 的測試全在 `tests/*.rs`,由 -30 的 `465212c` 提供)。T2c-1 的測試全來自測試作者 -30。
- 驗收前記下的資料基準:`learning/` `files=168 hash=959b2661093a10d8 ledger=52`(T5 的 `init` 之後的基準)。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `cargo test`(`apps/desktop/src-tauri`,`CARGO_BUILD_JOBS=2`) | 101 條全綠(4 + 18 + 14 + 22 + 10 + 22 + 11):與 worker 報告相同;加我的補測後 108 條全綠 |
| vitest `apps/desktop/src` | 58 條全綠;加我的補測後 87 條全綠 |
| cucumber `@desktop-shell and @phase-2 and not @manual` | **124 場景 124 綠**,521 步全綠(worker 開工時 119 紅) |
| cucumber 全 feature | 716 場景(241 undefined、475 passed),3318 步;base 是 677 / 241 / 436——多出的 39 個場景全綠,undefined 數不變(既有) |
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries` | **修我的測試字串之前紅(U2),之後 PASS**(掃描 238);工單 A4 要求刪掉的 10→01 那一筆 allow 確實不在了 |
| `npm run lint:docs`、`npm run check:steps` | PASS(44 條連結;scanned=2411) |
| 相關的倉庫層測試(`check-boundaries.local`、`zero-input-guard`、`check-doc-links.local`、`degraded-report`、`reports-persist`) | 5 檔 907 條綠、168 條跳過 |
| 併進最新 main(`6f00771`)與前端分支 | `git merge-tree`:無衝突,**除了** `run-mutants.mjs`(U1);`docs/tickets/T2c-1…` 兩邊都改過,自動合併成功 |

## 3. 工單 `must_catch` 十五條(對實作做的突變)

做法:改一處實作(或向量檔) → 跑對應的測試 → 記紅 → `git checkout` 還原。Rust 的突變跑整個 `cargo test`,TS 的跑 `apps/desktop/src` 的 vitest,「只有 cucumber 看得到」的另外跑 `@phase-2` 的 cucumber。

| 條 | 突變 | 結果 |
|---|---|---|
| 1 command 繞過 guard | `read`、`write`、`list`、`exists` 各自改成 `root.join(rel)`(A1r、A1w、A1l、A1e);`generate_handler!` 少註冊 `exists`(A1h) | 5 條都紅(`tests/commands.rs`) |
| 2 Rust 寫 log 不是一整行 | 拆成兩次 `write_all`(B1);拿掉結尾換行(B2);不用 `O_APPEND`(B3);不 `fsync`(B4) | B1、B2、B3 紅;**B4 在 cargo 測試存活,cucumber 的「the line was flushed to disk before the command returned」(LD_PRELOAD shim)紅** |
| 3 read 讀不到回空字串 | `fs::read(..).unwrap_or_default()`(D1) | 紅 |
| 4 io 錯誤被歸成拒絕 | NotFound 改回 `Refusal`(D2);`is_dir` 碼寫錯(D3);`exists` 的 NotFound 回 true(D5);非 UTF-8 默默轉換(D4) | 全紅 |
| 5 圖片被當文字讀 | asset 改成 `read_to_string`(E1) | 紅 |
| 6 warning 欄位漂移 | `reason` 改名(B5)、`ts` 拿掉 `Z`(B6)、`type` 寫錯字(B7) | 全紅 |
| 7 §11b 任一步被拿掉 | 拿掉 fsync(檔案)(G1)、rename(G2)、fsync(目錄)(G3)、失敗時刪 tmp(G4) | 全紅(`tests/atomic_write.rs`) |
| 8 吞錯範圍擴大 | 目錄 fsync 的 EIO 也當成功(G5);判斷永遠為真(G8) | 紅 |
| 9 EINVAL 判斷錯誤 | 永遠不算成功(G6);錯誤碼 +1(G7) | 紅 |
| 10 asset 限流失效 | 視窗永遠過了(H1);`count` 永遠 1(H2);`≥ 60` 改 `> 60`(H3);`flush` 不補寫(H4) | 全紅 |
| 11 SVG 裡的 script | 拿掉 `.svg` 的 CSP header(E2);拿掉 nosniff(E3);`csp` 改回 `null`(T1);`csp` 少 `script-src`(T2) | 全紅(另有 `@manual`) |
| 12 向量脫鉤 | 段向量檔翻轉一列(J1);刪光 `length` 的列(J2);§11b 向量檔少一列 `dir-fsync-eio`(J3) | 全紅(列數、各 rule 列數、sha256 斷言) |
| 13 誤套 64 位元組 | `check_segment_shape` 加 `seg.len() > 64`(I1) | 紅(`length_counts_utf8_bytes` 等) |
| 14 用 rule 選列、不用 applies_to | 測試端把選列改成 `rule != "length"`(TM1);改成不過濾(TM2) | **TM2 紅;TM1 存活——與現況選出同一批 47 列,不可區分(F-5)** |
| 15 真前端沒載入 | 視窗 `url` 指到不存在的 html(T3);`frontendDist` 指到不存在的資料夾(T4) | vitest 不會紅(那條檢查要真的建置),**cucumber「The real front ends are loaded」紅**;檢查器本身用 T2b 原樣的 `teach.html` 當 fixture 的測試也綠 |

另外自選的突變(要求 ≥ 3):`raw` 不再拒絕(I2)、保留名只看整段(I3)、長度上限 241(I4)、webview 的 `LearningFs` 加 `import 'node:fs'`(T5)、io 錯誤被丟成拒絕類別(T6)與反過來(T7)、`assetUrl` 不 encode(T9)、不做提示檢查(T10)、Linux 用 windows 前綴(T11)——全紅;`read` 先 trim(T8)**存活** → 補測後 `T8` 與 `T8w`、`T8l`、`T8e` 共 4 個變體全紅;`<name>.tmp` 不用 `O_NOFOLLOW`(N1)與清理改刪 symlink 的目標(N2)**原本沒有測試** → 補測後紅。

## 4. 對抗式審核(流程第 4 步)

模型 `xai/grok-4.20-0309-reasoning`,經 `opencode run`,工作目錄是**空目錄**。prompt 約 47 KB(五個 Rust 檔全文、`tauri.conf.json`、檢查要點)。耗時 5 分 46 秒。結論「有阻擋項」。逐條重驗:

| grok 主張 | 我的判定 |
|---|---|
| 1 高:`refuse_raw` 無條件拒絕以 `raw` 開頭的路徑,`read("raw/…")` 也被拒,違反「raw/ 唯讀」 | **不成立**。工單驗收 A2 第一列就寫 `read "raw/security/x.md"` → 拒絕、reason `raw`、檔案系統零次呼叫(桌面程式的邊界不讀 raw,raw 由 ingest 另外處理);測試與 I2 突變(讓 raw 不再拒絕 → 紅)都鎖住 |
| 2 高:`list` 重建路徑後做 NFC 檢查,macOS 的 NFD 檔名會被默默略過 | **平台相依,不成立於現在**。Linux 不正規化檔名;§13 明文「不通過的條目略過、不丟錯」;macOS 屬 phase-5。已記入已知限制 |
| 3 高:symlink 檢查有 TOCTOU | 設計限制,與 T2b 同;檢查到使用之間換目錄的競爭未重現。工單範圍沒有要求防競爭 |
| 4 中:log 可能交錯 | 不成立:`O_APPEND` 加單一 `write_all`(B1 突變證明有測試鎖「一次寫完」,B3 證明鎖 `O_APPEND`);POSIX 對 `O_APPEND` 的單次寫入保證不交錯。未重現 |
| 5 中:rename 之後 fsync(目錄) 失敗仍回錯,但目標已是新內容 | **符合工單**:驗收 9a 的 EIO 列寫明「錯誤往外丟;目標檔已經是新內容(rename 已完成)」 |

grok 的六項檢查要點都沒有找到真缺陷;我自己找到的缺口都來自 cargo-mutants 與手動突變(§3、§6、§9)。

## 5. 資料、鎖與環境

- **`learning/`**:前 `files=168 hash=959b2661093a10d8 ledger=52`,後相同。只讀;驗收程式全部在 mkdtemp 與驗收簽出內。
- **指標檔與機器鎖**:指標檔 `~/.config/llm-learning-cards/vault.json` 是 T5 之後協調者建的,我沒有碰它;`/run/user/1000/llm-learning-cards/` 底下的 `stryker.lock` 我跑 cargo-mutants 時取放過兩次(包裝程式取鎖、跑完釋放),驗收結束後目錄是空的。
- **cargo-mutants 在這個 crate 要 `TMPDIR`**(worker 報告 §6 第 3 點):測試用 `include_str!("../../../../…")` 讀 crate 外的向量檔,預設複製到 `/tmp` 會讓 baseline 編不過。我用 `TMPDIR=<驗收簽出>/dist/mutants-tmp`(gitignored,剛好兩層深)與 `--copy-target false`;跑完刪掉。建議把這兩個設定寫進 `run-mutants.mjs`(目前只有 `mutants.toml` 的 `copy_target = true`)。

## 6. cargo-mutants(工單 G20;變異測試歸驗收,worker 沒跑)

指令:`cargo mutants -j 2 -t 120 --copy-target false -v`,`CARGO_BUILD_JOBS=2`,拿機器鎖,load 約 8–13(含我自己的編譯)。範圍:`mutants.toml` 的 `examine_globs` 五個檔(`path_guard.rs`、`learning_fs.rs`、`asset_protocol.rs`、`commands.rs`、`event_log.rs`),198 個變異體。

| | caught | missed | unviable | 比例 caught/(caught+missed) | 耗時 |
|---|---|---|---|---|---|
| 第一次(補測前) | 118 | 38 | 42 | 118/156 = **75.6%** | 25 分 |
| 第二次(補測後) | 127 | 29 | 42 | 127/156 = **81.4%** | 24 分 |
| T2b 地板 | 36 | 17 | 9 | 36/53 = 67.9% | |

**地板棘輪(只准升不准降)通過**:`127 × 53 = 6731 ≥ 36 × 156 = 5616`。地板已由我升到 127/156(`apps/desktop/src-tauri/.cargo/mutants.toml`,顧問同意);`unviable` 不進分母。

### 6.1 存活的 29 條逐條分類

「cucumber 殺」指我把同一個突變手動做在檔案上、跑 `@phase-2` 的 cucumber,看到紅。

| 位置(檔 + 函式) | 突變 | 判定 |
|---|---|---|
| `asset_protocol.rs` 的 `fallback` ×3 | 回傳固定 body | **等價/不可達**:只在 `Response::builder` 失敗時用,而 header 值都是常數,builder 不會失敗(原碼註解同) |
| `same_checks_as_read` ×3(`true`、`false`、`==→!=`) | 回傳常數或反向 | `false` 與 `==→!=`:**cucumber 殺**(C7);`true`:**存活(C6)**,見 F-4(自我回報函式) |
| `scope_is_learning_root` ×8(`true`、`false`、`&&→||`、`==→!=`、刪 `!`) | | `false`:**cucumber 殺**(C9);刪 `!`、`==→!=` 這幾條與 `false` 同類(結果變 false),按 C9 類推定 cucumber 殺,未逐條手動重做;`true`、`&&→||`:**存活(C8)**,見 F-4 |
| `FsError::refusal` → `None` | probe 的 `refused` 旗標 | **cucumber 殺**(C5) |
| `learning_fs.rs` 的 `inside`:`!=→==` | 迴圈後的 `acc != full` 檢查 | **等價**:`acc` 逐段 push 出來的就是 `root.join(rel)`,最後這道檢查是冗餘的防線 |
| `exists` 的 `Err(..) if NotFound => false` 守衛改 `true` | 其他 metadata 錯誤也回 false | **等價(實務上)**:`guard` 先用 `symlink_metadata` 走過同一條路徑,不是 NotFound 的錯誤(權限、ENOTDIR)在那裡就被拒絕了,走不到這一行 |
| `fsync_file`、`fsync_dir` → `Ok(())` | 真的 syscall 沒做 | **cucumber 殺**(C1、C2:LD_PRELOAD shim 追蹤 syscall) |
| `close_file`、`close_dir`、`close`(兩個)→ `Ok(())` | 沒有回報 close 的錯誤 | **等價**:這些函式吃 `File` 的所有權,函式結束時 drop 就關了 fd;差別只在 close 失敗時的錯誤碼,在測試機上造不出 close 失敗(C3、C4 手動做:cucumber 也不紅) |
| `dir_fsync_is_unsupported` → `true`(第 353 行) | | **等價**:那是 `#[cfg(not(unix))]` 的版本,Linux 上不編譯;unix 版的同一類突變(G5、G8)都紅 |
| `write_then_rename` 的守衛 `!dir.as_os_str().is_empty()` → `true` | | **不可達**:`write` command 一律把相對路徑接在 learning 根底下,父目錄不會是空的;只有直接對相對檔名呼叫 `atomic_replace` 才走得到 |
| `check_structure` → `Ok(())`、三個 `||→&&` ×4 | 整條路徑的結構檢查 | **等價**:空段、開頭或結尾的 `/`、`//` 都會被逐段的 `check_segment`(`seg.is_empty()`)以同樣的 reason `structure` 拒絕;這道檢查是冗餘防線 |

沒有「存活但沒論證」的項目。補測前 38 條裡殺掉的 9 條:`io_code` 四個分支(NotADirectory、StorageFull、ReadOnlyFilesystem、CrossesDevices)、`must_be_inside_if_present` 的 NotFound 守衛、`is_old_style_tmp` 的 `&&→||`、`all_digits` ×2、`flush_refusals`。

## 7. 工單驗收條件對照

| 條 | 證據 |
|---|---|
| A1 四個 command、本體一行 | `commands.rs` 四個函式各一行呼叫 `learning_fs`;`tests/commands.rs` 22 條經真的 Tauri IPC;A1r/A1w/A1l/A1e/A1h 紅 |
| A2 直接呼叫 command 的拒絕 | 同上,七列表格在 `tests/commands.rs` 與 `tests/learning_fs.rs`;含懸空 symlink |
| A3、A4 webview 端 TS | `webview-learning-fs.test.ts`(我補 29 條)、`webview-imports.test.ts`(import 掃描:`node:` 與 `@core/schema/log` 零命中,T5 突變紅);`boundaries.allow.json` 的 10→01 已刪,boundaries PASS |
| A'4a–4d 段向量 | `tests/path_guard.rs`:`include_str!` 讀向量檔、`applies_to` 選列、47 跑 4 忽略、各 rule 列數與 sha256;J1、J2、I1 紅;Unicode 版本:兩個 crate 都帶 17.0.0,向量驗證 15.0.0,47 列 Rust 全一致 |
| B5–B8 warning 事件 | `tests/event_log.rs` 10 條、`tests/commands.rs`;限流向量 H1–H4 紅;TS 與 Rust 事件一致由 cucumber 對應步驟守(`@phase-2` 124 場景全綠) |
| C9–C10 §11b 對齊 T7 向量 | `tests/atomic_write.rs` 14 條逐列跑 `atomic-write.vectors.json`;G1–G8、J3 紅;`write` 對所有路徑走同一份原子寫入 |
| C9a EINVAL | 判斷是不在 trait 上的普通函式 `dir_fsync_is_unsupported`,用 `libc::EINVAL`;G6、G7、G8 紅 |
| D11–D12 io 錯誤與拒絕 | `tests/commands.rs`、`learning_fs.rs`(含權限 000:非 root 執行,**沒有略過**);TS 兩個錯誤類別各自 `instanceof`;D1–D5、T6、T7 紅 |
| E13 CSP | `tauri-config.test.ts`;T1、T2 紅。**工單前提與 Tauri 不符**:Tauri 2.11.5 不會自己加 IPC 來源,worker 補了 `connect-src ipc: http://ipc.localhost`;`invoke` 是否照常能用要看 `@manual` F19 的 devtools |
| E14 asset 位元組與 header | `tests/asset_protocol.rs`:PNG 位元組 sha256 往返、各副檔名的 Content-Type、SVG 的 CSP、nosniff、404、403;E1–E3 紅 |
| E15 `@manual` SVG | 未做(F-6) |
| E16 `assetUrl` | T9、T10、T11 紅 |
| F17–F18 真前端 | cucumber「The real front ends are loaded」真的建置並檢查;T3、T4 紅;檢查器本身對 T2b 的 `teach.html` 原樣會紅 |
| F19 `@manual` | 未做(F-6) |
| G20 cargo-mutants | §6 |

## 8. 花費(流程第 6 步)

| 項目 | 數字 |
|---|---|
| worker 實際花費(協調者提供) | Claude Opus 5.5,名目 $17.54;額度 5h 1%→5%、7d 8%→9% |
| 工單預算 | $20 |
| 比值 | **$17.54 / $20 = 0.88 倍,未超過 2 倍** |
| 驗收這張的 LLM 花費 | **不知道**:`opencode run` 不顯示金額。用量:grok-4.20 一次呼叫、prompt 約 47 KB、5 分 46 秒 |
| 驗收 CPU | cargo-mutants 兩次各約 25 分(`-j 2`、`CARGO_BUILD_JOBS=2`);手動 Rust 突變 39 條加後補 4 條(各跑整個 `cargo test`);TS 端突變 14 條,另有 2 條(T3、T4)改跑 cucumber;cucumber 突變約 13 次(各約 1.5 分);其餘為單檔測試。全程一次只開一個重活;load 約 5–13 |

## 9. 我補的測試(測試 agent 的 commit,只動測試檔)

分支 `pollux0971/t2c1-accept-tests`,從 `c0f8b38` 開:

| commit | 檔案 | 內容 |
|---|---|---|
| `7e506a3` | `apps/desktop/src/webview-imports.test.ts` | 掃描器樣本字串用 `JSON.stringify` 組,不再被邊界檢查器當成真的 import(U2) |
| `2fc4bb9` | `apps/desktop/src/webview-learning-fs.test.ts`、`apps/desktop/src-tauri/tests/learning_fs.rs` | TS 端 29 條:帶空白、NUL、點的路徑與內容對四個方法都逐位元原樣送出(F-2);Rust 2 條:`<name>.tmp` 是指向根外的 symlink 時 `write` 必須失敗、根外檔案不被寫或覆蓋、清理刪的是 symlink 本身、清掉後重試成功(F-1) |
| `e7317d8` | `apps/desktop/src-tauri/tests/learning_fs.rs`、`tests/asset_protocol.rs` | 5 條:`io_code` 分類表、`list` 在一般檔案上回 `not_dir` 且不寫 warning、經過一般檔案的路徑被拒絕(reason `symlink`,記錄現行行為)、舊樣式殘檔的精確判斷(非數字、只有一段數字、別的目標都不碰)、`flush_refusals` 補寫未寫出的 count 且只寫一次(F-3) |

我寫的測試檔(之後比對「測試檔只能來自測試 agent」的基準):`apps/desktop/src/webview-imports.test.ts`、`apps/desktop/src/webview-learning-fs.test.ts`、`apps/desktop/src-tauri/tests/learning_fs.rs`、`apps/desktop/src-tauri/tests/asset_protocol.rs`(都是在 -30 的檔上追加或改一行)。
上面每一條補測都在對應的存活突變上證明會紅(N1、N2、T8 四個變體;cargo-mutants 第二次的 127 caught)。

## 10. 未做 / 限制

- 兩條 `@manual`(E15、F19)沒做。
- 完整的 `check:all` 與 `witness:degraded` 沒跑(協調者併批時跑;T2c-1 沒有動 witness 訊號)。
- `scope_is_learning_root` 的幾個變體(刪 `!`、`==→!=`)按 C9 類推定 cucumber 會殺,沒有逐條手動重做。
- Windows 與 macOS 的行為(`dir_fsync_is_unsupported` 的非 unix 版本、檔名正規化)是 phase-5。
