---
id: T2c_1
deps: [T2b, T7]
touches: [apps/desktop/]
cpu: heavy
budget_usd: 20
status: merged
owner: worker-grok
must_catch:
  - command 繞過 guard:任一個 `#[tauri::command]`(read、write、list、exists)改成不經 check_rel_path 直接碰 fs,直接呼叫 command 的拒絕測試必須紅
  - Rust 寫 log 不是一整行:warning 事件拆成兩次寫入(JSON 與換行分開寫),或拿掉結尾換行,測試必須紅
  - read 讀不到檔回空字串:read 對 NotFound 改回 Ok("")(T2b 的 unwrap_or_default),測試必須紅
  - io 錯誤被歸成拒絕:read 的 NotFound 改成回 Refusal,測試必須紅(拒絕會寫 warning、io 錯誤不寫,兩邊都要斷言)
  - 圖片被當文字讀:asset handler 改回 read_to_string,PNG 位元組往返測試必須紅
  - Rust warning 事件欄位漂移:改名 reason、拿掉 ts 的時區、或 type 寫錯字,LogEventSchema 驗證 Rust 寫出的那一行必須紅
  - §11b 任一步被拿掉:分別拿掉 fsync(fd)、rename、fsync(目錄)、失敗時刪 tmp,T7 共用向量對應那一列必須紅
  - §11b 吞錯範圍擴大:目錄 fsync 的 EIO 也當成功,T7 共用向量的 EIO 列必須紅
  - 目錄 fsync 的 EINVAL 判斷錯誤:真實實作的判斷永遠不算成功(T2b 修正輪 N4:dir_fsync_unsupported 永遠回 false),或錯誤碼寫錯(N11:22 改 23),在 syscall 層注入 EINVAL 的那一列必須紅
  - asset 限流失效:拿掉 60 秒視窗(每次拒絕都寫一行),或寫出的那一行少了 count、count 少算,限流向量必須紅
  - SVG 裡的 script 被執行:拿掉 .svg 回應的 Content-Security-Policy: script-src 'none',或把 tauri.conf.json 的 csp 改回 null,header 與設定測試必須紅(另有 @manual 實機確認)
  - Rust 自己抄一份段向量、和向量檔脫鉤:path_guard 的段測試不從 contracts/fixtures/path-segment-vectors.json 讀(改成寫死在測試裡),或向量檔改了(加/刪/改一列)而 Rust 測試仍綠,列數、各 rule 列數與檔案 sha256 的斷言必須紅
  - 段規則誤套 CategoryId 的 64 位元組上限:path_guard 對單一段加上 ≤ 64 位元組的檢查,T2b 既有的 length_counts_utf8_bytes(單段 234 位元組必須通過)必須紅
  - 用 rule 選列、不用 applies_to:Rust 段測試改成按 rule 過濾(或不過濾),「只跑 applies_to 含 segment 的列、列數 47」的斷言必須紅
  - 真前端沒載入:frontendDist 的 html 引用一個 frontendDist 裡不存在的檔(T2b 的 /teach-card/src/main.ts),靜態檢查必須紅
---

# 工單 T2c-1:10 desktop-shell phase-2 的接線(command、Rust 寫事件、io 錯誤、圖片、真前端)

> 狀態:草稿,待技術顧問審。
> 作者:UI/Tauri 負責人(前端)。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 決策紀錄:ADR-069(Rust 寫事件與原子寫入、asset 限流、SVG、首次啟動只讀)、ADR-070(TS 的 §11b 只留一份)。
> 檔案:行號指 T2b 的 `pollux0971/t2b-impl @ 51355fd`;T2b 退修之後行號會動,**以函式名為準**。
> 與 T2c-2 的關係:原 T2c 依技術顧問 2026-10-15 裁決拆成兩張。本張是 A–F;learning 根目錄(原 G)在 T2c-2。

## 為什麼有這張

T2b 的白名單寫得對,但 2026-10-15 前端審查(只讀碼)查到 app 裡沒有任何 Tauri command,前端拿不到 `LearningFs`;
cucumber 綠的是 Node 裡的測試用 probe(`target/debug/lc-fs`),不是 app。

| 審查發現(T2b @ 51355fd) | 在本張 |
|---|---|
| P0-2 沒有 command:`src-tauri/src` 裡 `invoke_handler`、`#[tauri::command]` 零個;T2b 的 apps/desktop/src/boundary.ts 第 7、50 行(T2c-1 已刪)用 `node:child_process` 的 `spawnSync` 叫 probe | 驗收 A |
| P1-4 10-01 裁決 b(TS 呼叫 `recordEvent`)在 webview 做不到:`recordEvent` → `appendLineAtomic` 用 `node:fs`(`../../packages/core/src/schema/atomic-write.ts:1`);T2b 在 Node 的 `ProbeBoundary` 裡呼叫(`boundary.ts:127-136`) | 驗收 B |
| P1-5 read 吞錯、圖片當文字:`learning_fs.rs:67` 的 `read_to_string(...).unwrap_or_default()`;`main.rs:52-56` 回 200、沒有 Content-Type | 驗收 D、E |
| P1-6 真前端沒載入:`tauri.conf.json:7` `frontendDist: "frontend"`;T2b 的 apps/desktop/src-tauri/frontend/teach.html 第 10 行、`test.html` 同位置(T2c-1 已刪)引用 `/teach-card/src/main.ts`(不在 frontendDist,沒有 build);測試 `shell-config.ts:77` `frontEndStatus` 只比對字樣 | 驗收 F |
| P1-7 根目錄兩個來源 | **T2c-2** |

## 推翻的舊條款

- **T2 第 6 條「不得讓 Rust 寫 §10 事件」與 10-01 的裁決 b:推翻**(技術顧問 2026-10-15)。webview 沒有 `node:fs`,
  TS 端呼叫不了 `recordEvent`,改由 Rust 寫 `log.jsonl` 的 warning 事件。
- **T2b 工單驗收 A「asset handler 的拒絕只進 Rust log、不寫 §10 事件」:推翻。** 當初的理由(沒有 TS 呼叫端)已經消失。
  改成寫,但限流(驗收 B7)。`docs/02-decision-map.md` ADR-062 Consequences 的「asset protocol 的已知限制」要由顧問改寫或標 superseded。
- `tauri.conf.json` 的 `"csp": null`:不再允許(驗收 E13)。

## 前置(worker 開工前必須已在 main)

1. **T2b 已合併**(懸空 symlink 拒絕、§11b 四步原子寫入、`strip_prefix` 只去一個 `/`、非法 UTF-8 拒絕)。
2. **T7 已合併**:它提供 §11b 的共用向量檔(驗收 C 要讀)。
   ⚠️ 技術顧問的裁決寫的是 `deps: [T2b]`;本稿加了 T7,理由是驗收 C 的向量檔由 T7 產出,沒有它 Rust 只能自己抄一份向量,
   那就是兩份向量會漂移的形狀。**顧問若要拿掉 T7,驗收 C 要改寫成「照 `state.test.ts:141` 逐列轉寫」並接受這個風險。**
3. **`features/10-desktop-shell/phase-2.feature` 已由統籌·契約更新、顧問審過**(worker 與測試 agent 都不寫 gherkin)。至少:
   - 三處 `And the TypeScript caller records a warning event through recordEvent`(T2b 版 :66、:113、:243)→ 改成 Rust 寫事件;
   - :140-146 asset protocol 的 `no warning event is written` → 改成「寫一行、而且限流」;
   - 新增:io 錯誤與拒絕分得出來(驗收 D)、圖片位元組往返(驗收 E)、SVG 不執行 script(驗收 E)、真前端靜態檢查(驗收 F)。
4. 鎖:cargo-mutants 由**驗收者**跑(開發 worker 不跑,見「重活規則」),要拿協調者指定的那一把
   (T5 之後是 `$XDG_RUNTIME_DIR/llm-learning-cards/stryker.lock`);完整 `cargo test` 也算重活,不和別的重活同時跑。
5. **契約 1.4.0 已在 main**(含 `contracts/fixtures/path-segment-vectors.json`,51 列;目前在 contracts clone 的 `contracts-1.4.0` @ `6d71bef8cdf83d4d63f6cccdb5330aa59e8100b4`,樹 `1bf59c71ebc2673faba083f4aeb4930d68311c26`;檔案 sha256 `71dded0ecbe5376fdb9adbe417f82e0d27d756d7256d359c6516e75e8ac7a1c6`)。驗收 A'(段向量)要讀它。統籌·契約定的合併順序:`feature-13-work-dag` → `contracts-1.4.0` → `tickets-t5-t6`。
6. learning 根目錄在本張**沿用 T2b 的來源**(`LC_LEARNING_ROOT`),只當測試與開發用;換成單一來源是 T2c-2 的事。本張不得再新增任何根目錄來源。

## 驗收條件

每條寫「輸入 → 預期」。「拒絕」= 白名單或 symlink 不過,會寫 warning 事件;「io 錯誤」= 路徑合法但檔案系統出錯,不寫 warning 事件。

### A. 真的 Tauri command(技術顧問裁決 B)

1. `src-tauri` 有四個 `#[tauri::command]`:`read`、`write`、`list`、`exists`,用 `invoke_handler(generate_handler![...])` 註冊。
   **每個 command 的本體只有一行**:呼叫 probe(`src/bin/lc-fs.rs`)用的**同一個** `learning_fs` 函式。
   檢查:每個 command 函式本體,除了那一行呼叫(與把 `Result` 轉成回傳型別的 `map_err`)之外沒有別的陳述式。
2. **直接呼叫 command 函式的拒絕測試**(Rust,不經 probe、不經 webview),至少:

   | 呼叫 | 輸入 | 預期 |
   |---|---|---|
   | `read` | `"raw/security/x.md"` | 拒絕,reason `raw`;檔案系統零次呼叫 |
   | `write` | `"raw/security/x.md"`, `"x"` | 拒絕;`raw/security/x.md` 不存在 |
   | `read` | `"../../etc/passwd"` | 拒絕,reason `structure` |
   | `write` | `"cards/../../escape.md"`, `"x"` | 拒絕;根目錄的上一層沒有出現 `escape.md` |
   | `exists` | `"raw/security/x.md"` | 拒絕(不是回 `false`) |
   | `list` | `"raw"` | 拒絕 |
   | `write` | 懸空 symlink `cards/evil.md` → 根外不存在的路徑 | 拒絕;根外的目標**沒有被建出來**(T2b 修的洞,這裡從 command 再測一次) |

3. **webview 端的 TS `LearningFs`**(新檔,位置由 worker 開工第一步回報):四個方法用 `@tauri-apps/api` 的 `invoke`
   (`assetUrl` 見驗收 E)。單元測試 mock `invoke`:
   - `read("cards/a.md")` → `invoke` 被呼叫恰好一次,command 名 `read`,參數的 `relPath` 逐位元等於 `"cards/a.md"`
     (phase-2.feature「Reading a file goes through the boundary」);
   - `read("..\\..\\etc\\passwd")` → `invoke` 仍被呼叫,參數**原樣**(TS 不先轉換;TS 端的檢查只是提示,權威在 Rust)。
4. **webview 端的 TS 不 import 任何 `node:` 模組,也不 import `@core/schema/log`**。靜態檢查:對 webview 端 `LearningFs` 與它
   import 的所有檔,`node:` 與 `@core/schema/log` 零命中。
   probe(`boundary.ts`、`shell-config.ts`)可以留給 cucumber 用,但要搬到測試支援的位置或檔名標明 probe;
   webview 端不再用 10→01 的話,刪掉 T2b 在 `scripts/boundaries.allow.json` 加的那一筆,`npm run boundaries` 要綠。

### A'. path_guard 讀契約的段向量(技術顧問 2026-10-15,契約 1.4.0 / ADR-067)

4a. `path_guard.rs` 把每一段的規則抽成一個公開函式 `check_segment(seg: &str) -> Result<(), Refusal>`(非空、不含 `/`、字元集合、不以 `.` 開頭或結尾、保留名;段層級的 NFC),`check_rel_path` 對每一段呼叫它,再做整條路徑的規則(結構、NFC、240 位元組、`raw/`)。**行為不變**:T2b 的既有 path_guard 測試全綠、不改。
4b. Rust 測試用 `include_str!` 從 `apps/desktop/src-tauri/` 以相對路徑載入 **`contracts/fixtures/path-segment-vectors.json`**(只讀,不寫;不算 R2 的 contracts 落點)。**用每列的 `applies_to` 選列,不用 `rule` 分**:

   | 列 | 斷言 |
   |---|---|
   | `applies_to` 含 `"segment"` 的每一列(47 列) | `check_segment(segment).is_ok() == (expect == "accept")` |
   | `applies_to` 不含 `"segment"` 的列(4 列,`["category"]`,都是 64/65 位元組的長度列) | **忽略**(向量檔語意:沒列在 `applies_to` 的檢查必須忽略該列);只斷言被忽略的列數是 4 |

   64 位元組是 §1 `CategoryId` 的上限,§13 的段沒有這條,桌面程式也不建分類。**「有人把 64 上限誤套到所有路徑段」由 T2b 既有的 `length_counts_utf8_bytes`(`path_guard.rs` 的測試;51355fd 在 :220,修補輪會移動,以函式名為準;單段 234 位元組的 `cards/aaa…a.md` 必須通過)擋**;這個測試不能刪。
4c. **脫鉤防護**:斷言總列數 = 51、`applies_to` 含 `segment` 的列數 = 47、各 `rule` 的列數(全部 51 列:charset 21、reserved 15、nfc 5、length 4、leading-dot 3、empty 1、separator 1、trailing-dot 1),以及檔案內容的 sha256 = `71dded0ecbe5376fdb9adbe417f82e0d27d756d7256d359c6516e75e8ac7a1c6`。向量檔一改,這三條至少一條紅,改的人必須同時更新這三個數字,也就會看到 Rust 的段測試。**向量檔沒有「列名」欄位**,所以不用逐列名稱清單(那等於把 51 個段在測試裡再抄一次,正是要防的事)。
4d. 向量檔的 `unicode_version_used_to_verify` 是 `15.0.0`;回報 `unicode-properties`、`unicode-normalization` 帶的 Unicode 版本。兩邊不同而某列結果不一致時,**不改向量**,停下回報(§13 已知限制:Rust 是權威,但向量是契約)。

### B. Rust 寫 warning 事件(技術顧問裁決 A)

5. 經過 command 的每一次**拒絕**,Rust 往 `<learning 根>/state/log.jsonl` append **一行**(command 的拒絕**不限流**):
   `{"ts":"<ISO 8601 含時區>","type":"warning","path":"<原樣的 relPath>","reason":"path-refused"}` + `\n`。
   欄位與順序跟 T2b 的 TS 版(`boundary.ts:129-134`)一樣,另可加 `op`(哪個方法)與 `check`(Refusal 的 reason)。
   **加不加 `op`/`check` 由 worker 回報,不要靜默加。**
6. 寫法:`O_APPEND` 開檔,**一次** `write_all` 寫完「JSON + `\n`」,然後 `fsync`。實作要讓測試能數寫入次數
   (例如 append 函式收一個 `impl Write` 的 sink):

   | 輸入 | 預期 |
   |---|---|
   | `read("raw/x.md")` | log 多 1 行;那一行用 `packages/contracts` 的 `LogEventSchema` 驗證通過;sink 收到恰好 1 次寫入,緩衝區以 `\n` 結尾 |
   | `read("cards/a.md\u0000.png")`(含 NUL) | log 多 1 行;`path` 的 NUL 被 JSON 轉義成 `\u0000`,整行仍是一行、可 `JSON.parse`;解出來的 `path` 逐位元等於輸入 |
   | `read("cards/a.md")`(合法且存在) | log 行數不變 |
   | `read("cards/missing.md")`(合法、不存在) | log 行數不變(io 錯誤不是拒絕) |
   | log 檔原本最後一行沒有 `\n` | 本張不處理,記為已知限制(TS 版同樣不處理) |

7. **asset handler 的拒絕也寫 warning,但限流**(技術顧問 2026-10-15):同一個拒絕理由(`Refusal` 的 reason)**每 60 秒最多寫一行**,
   那一行多一個 `count` 欄位 = 上一行寫出之後(含這一次)被拒絕了幾次;`path` 是觸發寫入的那一次的路徑。時鐘要能注入。向量:

   | 時間(秒) | 事件 | 預期 |
   |---|---|---|
   | 0 | asset 拒絕,reason `structure` | 寫一行,`count: 1` |
   | 10、20 | asset 拒絕,reason `structure` | 不寫 |
   | 5 | asset 拒絕,reason `raw` | 寫一行,`count: 1`(不同理由各自計) |
   | 61 | asset 拒絕,reason `structure` | 寫一行,`count: 3`(10、20、61) |
   | 61 之後到程式結束,又被拒 2 次但沒到 60 秒 | 程式正常結束時把未寫出的 `count` 補寫一行(盡力而為;被強制結束時會少,記為已知限制) |

   寫出的每一行都要通過 `LogEventSchema`(`count` 屬於 `[k: string]: unknown`)。
8. **TS 與 Rust 寫出的事件一致**:同一個拒絕輸入,TS `recordEvent` 寫出的行與 Rust 寫出的行,去掉 `ts`(與 Rust 多加的 `op`/`check`/`count`)
   之後 `JSON.parse` 結果深度相等。這條在 Node 跑(可以用 probe 叫 Rust)。任何一邊改了欄位,這條紅。

### C. §11b 原子寫入對齊 T7 的共用向量

9. Rust 的原子寫入(T2b 修補輪寫的)用 `include_str!` 讀 T7 產出的 **`packages/core/src/schema/atomic-write.vectors.json`**(從 `apps/desktop/src-tauri/` 用相對路徑),**逐列**跑過;Rust 用 trait 包 fs 呼叫來注入錯誤。Rust harness 也要斷言列數與列名,跟 TS harness 用同一份清單。
   向量的「注入」與「預期」兩欄 Rust 與 TS 必須逐列相同;Rust 不得自己新增或略過任何一列(要加就回報,改向量檔)。
9a. **EINVAL 的判斷要在真實實作上被測到**(技術顧問 2026-10-15,T2b 修正輪 N4、N11 兩個突變存活)。
    現況(T2b 修正輪 `a53b9e3` 的 `learning_fs.rs`):「EINVAL 算成功」分在兩個地方——`StdWriteIo::fsync_dir`(:182-199)把 `raw_os_error() == Some(22)`轉成 `detail: "EINVAL"` 字串,`dir_fsync_unsupported`(:212-214)再比對這個字串;而 `dir_fsync_unsupported` 是 `WriteIo` trait 的方法,測試的假 `Script`(:438 起)**自己實作了一份**(:524-526),所以真的那份判斷從來沒被呼叫到。
    要求:
    - 判斷改成一個**不能被測試替身覆寫**的函式(例如 `fn dir_fsync_is_unsupported(e: &io::Error) -> bool`,不放在 trait 上),用 `libc::EINVAL` 比對,不寫死 `22`;`IoStep` 保留原始的 `io::Error`(或至少 `raw_os_error`),不要只留字串。
    - 測試替身只在 **syscall 層**注入 `io::Error`(`fsync_dir` 的那次 `sync_all` 回什麼),判斷一律走真的那個函式。
    - 新增 `libc` 相依(版本由 worker 回報);只在 `cfg(unix)` 用,Windows 的對應碼是 phase-5 的事,寫進已知限制。

    | T7 向量列 | 在 fsync(目錄) 注入 | 預期 |
    |---|---|---|
    | 目錄 fsync EINVAL | `io::Error::from_raw_os_error(libc::EINVAL)` | 成功;目標檔是新內容;沒有 `<name>.tmp` |
    | 目錄 fsync EIO | `io::Error::from_raw_os_error(libc::EIO)` | 錯誤往外丟,`raw_os_error() == Some(libc::EIO)`;目標檔已經是新內容(rename 已完成) |
    | 目錄 fsync ENOSPC | `io::Error::from_raw_os_error(libc::ENOSPC)` | 錯誤往外丟,`raw_os_error() == Some(libc::ENOSPC)` |

    對照:把判斷改成永遠回 `false`(N4)、或把 `libc::EINVAL` 換成 `libc::EINVAL + 1`(N11),第一列必須紅;改成永遠回 `true`,第二、三列必須紅。
10. Rust 的 `write` command 對 `learning/` 底下**所有**路徑都走這份原子寫入(不只 `state/`):同一個函式、少一條分支、少一個變異點。

### D. read 的 io 錯誤與拒絕分得出來(技術顧問裁決 (3))

11. command 的錯誤回傳分兩種形狀,TS 端各自丟不同的錯誤類別(名稱由 worker 回報):

    | 呼叫 | 輸入 / 狀態 | 預期 |
    |---|---|---|
    | `read` | `"cards/missing.md"`(不存在) | io 錯誤,`code: "not_found"`;不寫 warning |
    | `read` | `"cards"`(是目錄) | io 錯誤,`code: "is_dir"`;不寫 warning |
    | `read` | 權限 000 的 `cards/locked.md` | io 錯誤,`code: "permission"`;不寫 warning。**以 root 執行時這列略過並在報告寫明** |
    | `read` | `"cards/bad.md"` 內容是不合法的 UTF-8(`FF FE 00`) | io 錯誤,`code: "not_utf8"`;不寫 warning |
    | `read` | `"raw/x.md"` | 拒絕;寫 warning |
    | `exists` | `"cards/missing.md"` | `false`(不是錯誤) |
    | `list` | `"cards/nope"`(不存在) | io 錯誤,`code: "not_found"` |
    | `list` | 目錄含一個讀不到 metadata 的條目 | 略過那個條目,其餘照回(§13:不通過的條目略過、不丟錯) |

12. TS 端:`read("cards/missing.md")` 丟出的錯誤 `instanceof` io 錯誤類別、**不是**拒絕類別;`read("raw/x.md")` 反過來。

### E. 圖片用 bytes、SVG 不執行 script(P1-5;技術顧問裁決 2)

13. `tauri.conf.json` 的 `app.security.csp` **不得為 `null`**,至少:
    `default-src 'self'; script-src 'self'; object-src 'none'; frame-src 'none'; img-src 'self' lc: data:`。
    Tauri 2 會自己往 CSP 加 IPC 需要的來源;**worker 開工第一步回報設了 csp 之後 `invoke` 是否照常能用**,以及開發模式
    (vite HMR)要不要 `devCsp`。設定測試:讀 `tauri.conf.json`,`csp` 是字串且含上面五個指令。
14. asset handler(`lc` 協定)用 `fs::read` 讀**位元組**,依副檔名設 `Content-Type`,每個回應都帶 `X-Content-Type-Options: nosniff`:

    | 請求 | 預期 |
    |---|---|
    | `assets/x.png`,內容是 PNG 檔頭加含 `00`、`FF` 的位元組 | 200;body 的 sha256 等於檔案的 sha256;`Content-Type: image/png` |
    | `assets/x.jpg`、`.jpeg`、`.gif`、`.webp` | 對應的 `image/*` |
    | `assets/x.svg` | 200;`Content-Type: image/svg+xml`;**另帶 `Content-Security-Policy: script-src 'none'`** |
    | `assets/x.bin`(未知副檔名) | `application/octet-stream` |
    | `assets/missing.png` | **404**,不是 200 空 body,也不是 403;不寫 warning |
    | `raw/x.png` | 403(拒絕);照驗收 B7 限流寫 warning |

15. **`@manual`(UI/Tauri 負責人截圖,技術顧問判)**:`assets/pwn.svg` 內含 `<script>document.title='pwned'</script>`,
    用 `<img src>` 載入、也直接在視窗開 `lc://localhost/assets/pwn.svg`,兩種都**不能**讓 title 變成 `pwned`。
16. TS 的 `assetUrl`:同步產生 URL,Linux 是 `lc://localhost/<逐段 encodeURIComponent>`。Windows 的 `http://lc.localhost/`
    不在本張(phase-5),但要寫成依平台選前綴的函式,不要再寫死(T2b `boundary.ts:110`)。

### F. 真前端載入(P1-6)

17. `tauri.conf.json` 的 `build` 有 `beforeBuildCommand`(與開發用的 `devUrl` 或等效設定),把 `apps/teach-card`、`apps/test-card`
    建置進 `frontendDist`;兩個視窗的 `url` 指向建置產物。
18. **靜態檢查**(Node 測試,不開視窗):跑完建置指令之後,
    - 兩個視窗 `url` 指的 html 都存在於 `frontendDist`;
    - 每個 html 裡每一個 `<script src>`、`<link href>` 解析後都是 `frontendDist` 裡存在的檔;
    - 沒有任何被引用的檔以 `.ts` 結尾;
    - 把 T2b 的 `frontend/teach.html` 原樣放回去(引用 `/teach-card/src/main.ts`),這條檢查必須紅。
19. **`@manual`(UI/Tauri 負責人截圖,技術顧問判)**:`npm run tauri dev` 之後
    - 教學卡視窗:看得到 fixture 的第一張卡(標題與內文),不是空白;
    - 考試卡視窗:看得到第一題的題目文字與作答欄;
    - 兩個視窗都沒有「placeholder」字樣;
    - 開發者工具的 console 沒有 CSP 違規訊息(驗收 E13 的 csp 沒有擋到自己的 script)。
    06/07 這時候還是吃 stub(MemoryFs);換成真的 `LearningFs` 是 I3 的事,不在本張。

### G. cargo-mutants(驗收者跑,開發 worker 不跑)

20. 本張新增的 Rust(command、事件 append 與限流、io 錯誤分類、asset 的 bytes 與 header)納入 cargo-mutants;
    沿用 T2b 的地板棘輪(只准升不准降)。**由驗收者在拿到重活位子之後跑**,拿前置 4 的那把鎖,指令前面加 `CARGO_BUILD_JOBS=2`。
    開發 worker 要做的只有:把 `.cargo/mutants.toml` 的 `examine_globs` 補上本張新增的檔(`commands.rs`、`event_log.rs`)。
    存活的變異體由驗收者逐一列在驗收報告,各標「補測試」或「等價,理由」;要補的測試由測試 agent 寫。

## 重活規則(技術顧問 2026-10-15 12:5x;開發 worker 自己跑 cargo-mutants,24 個行程把負載推到 34 之後補上)

1. **開發 worker 不跑變異測試。** cargo-mutants 與 Stryker 都是驗收 / 測試 agent 的工作,而且只在跟協調者拿到重活位子之後才跑。
   開發 worker 交件前只跑一般測試(`cargo test`、vitest、phase-2 的 cucumber),不跑 `run-mutants.mjs`、`cargo mutants`、`npm run mutate`。
2. **所有 cargo 指令前面加 `CARGO_BUILD_JOBS=2`**,例如 `CARGO_BUILD_JOBS=2 cargo test --test commands`。
   vitest 與 cucumber 會自己呼叫 `cargo build --bin lc-fs` 重編 probe,所以跑它們時也在指令前面加(環境變數會傳下去)。
3. **同一時間只開一個重活。** 完整 `cargo test`、cucumber、vite build、變異測試,一次一個;不在背景同時跑兩個,也不跟別的 agent 的重活重疊(先問協調者)。

## 預算

`budget_usd: 20`(技術顧問裁定)。參考:T2b(同一資料夾、範圍相近)opencode grok-4.7 實際 $29.08。
**實際超過 2 倍($40)要在報告標出來,寫明超在哪。**

## 測試誰寫

- 測試 agent:紅測試、步驟定義(照 `features/steps/_world.ts`)、驗收 C 的 Rust harness(讀 T7 的向量檔)。**等前置 1–3 都在 main 才開始。**
- 開發 agent(worker-grok):只寫實作,不改測試、不改 gherkin。要改測試就停下回報協調者。**不跑變異測試**;cargo 指令加 `CARGO_BUILD_JOBS=2`;一次一個重活(見「重活規則」)。
- 驗收:照 `worker-acceptance` 的流程(先重編 `lc-fs` 再跑 cucumber、`must_catch` 逐條、自選 ≥ 3 個突變、驗收 G 的 cargo-mutants),拿到重活位子才跑。
- UI/Tauri 負責人:驗收 E15、F19 的截圖與「看哪裡、什麼算對」清單,交技術顧問判。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是含 T2b 與 T7 的 `origin/main`,同一時間一個 agent。派工歸協調者。
