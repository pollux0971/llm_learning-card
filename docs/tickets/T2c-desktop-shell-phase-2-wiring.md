---
id: T2c
deps: [T2b, T5]
touches: [apps/desktop/]
cpu: heavy
budget_usd: 30
status: todo
owner: worker-grok
must_catch:
  - command 繞過 guard:任一個 #[tauri::command](read/write/list/exists)改成不經 check_rel_path 直接碰 fs,直接呼叫 command 的拒絕測試必須紅
  - Rust 寫 log 不是一整行:warning 事件拆成兩次寫入(JSON 與換行分開寫),或拿掉結尾換行,測試必須紅
  - read 讀不到檔回空字串:read 對 NotFound 改回 Ok("")(T2b 的 unwrap_or_default),測試必須紅
  - io 錯誤被歸成拒絕:read 的 NotFound 改成回 Refusal,測試必須紅(拒絕會寫 warning、io 錯誤不寫,兩邊都要斷言)
  - 圖片被當文字讀:asset handler 改回 read_to_string,PNG 位元組往返測試必須紅
  - Rust warning 事件欄位漂移:改名 reason、拿掉 ts 的時區、或 type 寫錯字,LogEventSchema 驗證 Rust 寫出的那一行必須紅
  - §11b 任一步被拿掉:分別拿掉 fsync(fd)、rename、fsync(目錄)、失敗時刪 tmp,共用向量對應那一列必須紅
  - §11b 吞錯範圍擴大:目錄 fsync 的 EIO 也當成功,共用向量的 EIO 列必須紅
  - 真前端沒載入:frontendDist 的 html 引用一個 frontendDist 裡不存在的檔(T2b 的 /teach-card/src/main.ts),靜態檢查必須紅
  - 根目錄有第二個來源:加回 LC_LEARNING_ROOT 環境變數的退路,「沒有指標檔、但有環境變數」的測試必須紅
  - 身分不符被放行:拿掉 vault_id 與 learning/config/vault-id 的比對,身分不符的測試必須紅
  - 指標檔路徑跟 T5 不同:改用 Tauri 的 app_config_dir(會是 ~/.config/dev.learningcards.desktop/),路徑測試必須紅
---

# 工單 T2c:10 desktop-shell phase-2 的接線(command、Rust 寫事件、io 錯誤、圖片、真前端、單一根目錄)

> 狀態:草稿,待技術顧問審;§11b 那一段(驗收 C)另請統籌·契約審。
> 作者:UI/Tauri 負責人(前端)。派工:協調者。審:技術顧問(全文)、統籌·契約(只審驗收 C)。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 檔案:行號一律指 T2b 的 `pollux0971/t2b-impl @ 51355fd`。T2b 退修之後行號會動,**以函式名為準**,行號只幫你找位置。

## 為什麼有這張

T2b 的白名單本身寫得對,但 2026-10-15 前端審查(只讀碼)查到:**app 裡沒有任何 Tauri command,前端拿不到 `LearningFs`**,
cucumber 綠的是 Node 裡的測試用 probe(`target/debug/lc-fs`),不是 app。技術顧問同日裁決:
T2b 這輪只修 symlink、原子寫入、asset 的 `/`、非法 UTF-8、Mark/com9 測試;**其餘拆到本張**。

| 審查發現(T2b @ 51355fd) | 在本張 |
|---|---|
| P0-2 沒有 command:`src-tauri/src` 裡 `invoke_handler`、`#[tauri::command]` 零個;`apps/desktop/src/boundary.ts:7`、`:50` 用 `node:child_process` 的 `spawnSync` 叫 probe | 驗收 A |
| P1-4 10-01 裁決 b(TS 呼叫 `recordEvent`)在 webview 做不到:`recordEvent` → `appendLineAtomic` 用 `node:fs`(`packages/core/src/schema/atomic-write.ts:1`);T2b 在 Node 的 `ProbeBoundary` 裡呼叫(`boundary.ts:127-136`) | 驗收 B(裁決 b 推翻) |
| P1-5 read 吞錯、圖片當文字:`learning_fs.rs:67` 的 `read_to_string(...).unwrap_or_default()`;`main.rs:52-56` 回 200、沒有 Content-Type | 驗收 D、E |
| P1-6 真前端沒載入:`tauri.conf.json:7` `frontendDist: "frontend"`;`frontend/teach.html:10`、`test.html` 同位置引用 `/teach-card/src/main.ts`(不在 frontendDist,沒有 build);測試 `shell-config.ts:77` `frontEndStatus` 只比對字樣 | 驗收 F |
| P1-7 根目錄兩個來源:Rust 讀 `LC_LEARNING_ROOT`(`lib.rs:11-13`);`startup.ts:30-33` 用 `node:fs` 寫另一份 JSON 設定,Rust 沒讀 | 驗收 G |

## 推翻的舊條款

- **T2 第 6 條「不得讓 Rust 寫 §10 事件」與 10-01 的裁決 b:推翻。** 理由:webview 沒有 `node:fs`,TS 端呼叫不了
  `recordEvent`。改成 Rust 寫 `log.jsonl` 的 warning 事件。T2b 工單驗收 A 的「asset handler 的拒絕只進 Rust log、不寫 §10 事件」
  的**理由**(沒有 TS 呼叫端)因此消失;asset handler 要不要也寫事件,見「待裁」1。
- `scripts/boundaries.allow.json` 裡 T2b 加的 10→01(`recordEvent`)例外:本張完成後 webview 端不再需要它,見驗收 A4。

## 前置(worker 開工前必須已在 main)

1. **T2b 已合併**(含懸空 symlink 拒絕、§11b 四步原子寫入、`strip_prefix` 只去一個 `/`、非法 UTF-8 拒絕)。
2. **T5 已合併**,而且 T5 有提供:指標檔的**路徑規則**、**JSON 格式**、**四種失敗**的判定方式、**向量檔**(驗收 G 要跟它跑同一份)。
   T5 若沒有出向量檔,本張驗收 G 不能開工,退回統籌補,不由 worker 自己定。
3. **`features/10-desktop-shell/phase-2.feature` 已由統籌·契約更新、顧問審過**(worker 與測試 agent 都不寫 gherkin)。至少要改:
   - 現在有三處寫 `And the TypeScript caller records a warning event through recordEvent`(T2b 版的 :66、:113、:243)→
     改成 Rust 寫事件的說法;
   - :140-146 的 asset protocol「no warning event is written」→ 依「待裁」1 的結果改或留;
   - First run / configured path 兩個場景(:9、:16)→ 改成讀 T5 的指標檔,加「身分不符」場景;
   - 新增:io 錯誤與拒絕分得出來(驗收 D)、圖片位元組往返(驗收 E)、真前端靜態檢查(驗收 F)。
4. 鎖:T5 會把 Stryker 鎖搬到 `$XDG_RUNTIME_DIR/llm-learning-cards/stryker.lock`(退 `~/.cache`)。本張的 cargo-mutants 與完整
   `cargo test` 要拿**那一把**。

## 驗收條件

每條寫「輸入 → 預期」。「拒絕」= 白名單或 symlink 不過,會寫 warning 事件;「io 錯誤」= 路徑合法但檔案系統出錯,不寫 warning 事件。

### A. 真的 Tauri command(顧問裁決 B)

1. `src-tauri` 有四個 `#[tauri::command]`:`read`、`write`、`list`、`exists`,用 `invoke_handler(generate_handler![...])` 註冊。
   **每個 command 的本體只有一行**:呼叫 probe(`src/bin/lc-fs.rs`)用的**同一個** `learning_fs` 函式。
   檢查:`grep` 每個 command 函式本體,除了那一行呼叫(與把 `Result` 轉成回傳型別的 `map_err`)之外沒有別的陳述式。
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

3. **webview 端的 TS `LearningFs`**(新檔,位置由 worker 開工第一步回報):五個方法用 `@tauri-apps/api` 的 `invoke`
   (`assetUrl` 除外,見驗收 E)。單元測試 mock `invoke`:
   - `read("cards/a.md")` → `invoke` 被呼叫恰好一次,command 名 `read`,參數的 `relPath` 逐位元等於 `"cards/a.md"`(phase-2.feature「Reading a file goes through the boundary」);
   - `read("..\\..\\etc\\passwd")` → `invoke` 仍被呼叫,參數**原樣**(TS 不先轉換;TS 端的檢查只是提示,權威在 Rust)。
4. **webview 端的 TS 不 import 任何 `node:` 模組,也不 import `@core/schema/log`**。靜態檢查:對 webview 端 `LearningFs` 與它
   import 的所有檔,`node:` 與 `@core/schema/log` 零命中。
   probe(`boundary.ts`、`shell-config.ts`)可以留著給 cucumber 用,但要搬到測試支援的位置或檔名標明 probe;
   若 webview 端完全不用 10→01,把 T2b 在 `scripts/boundaries.allow.json` 加的那一筆刪掉,`npm run boundaries` 要綠。

### B. Rust 寫 warning 事件(顧問裁決 A)

5. 經過 command 的每一次**拒絕**,Rust 往 `<learning 根>/state/log.jsonl` append **一行**:
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

7. **TS 與 Rust 寫出的事件一致**:同一個拒絕輸入,TS `recordEvent` 寫出的行與 Rust 寫出的行,去掉 `ts` 之後 `JSON.parse` 結果
   深度相等。這條測試在 Node 跑(可以用 probe 叫 Rust)。任何一邊改了欄位,這條紅。

### C. §11b 原子寫入的共用向量(統籌·契約審這一段)

> ⚠️ **開工前要先裁的事實**:TS 那邊**已經有兩份** §11b,而且不一樣(2026-10-15 前端讀 main @ f2f7d76):
> - `packages/core/src/ingest/state.ts:36` `atomicWriteJson`:`<path>.tmp`、fsync(fd)、rename、fsync(目錄)、EINVAL 例外、失敗清理不遮錯
>   —— 跟 §11b 本文一致,行為規格在 `state.test.ts:141` 的 describe。
> - `packages/core/src/schema/atomic-write.ts:42` `writeFileAtomic`:暫存檔名是 `.<name>.<pid>.<ts>.tmp`(§11b 寫「暫存檔名固定是 `<name>.tmp`」)、
>   **沒有 fsync(目錄)**、rename 失敗時不刪 tmp。**它是 `session/io.ts:55` 寫 `state/reviews.json` 用的那一份。**
>
> 所以「Rust 跟 TS 跑同一組向量」的 TS 是哪一份,要先定。本稿建議**以 §11b 本文為準、向量照 `state.test.ts:141` 那組**,
> `writeFileAtomic` 的偏差另開工單(它在 main 上違反硬約定 §11b,不是本張的範圍)。

8. 向量放一個 Rust 與 TS 都讀得到的資料檔(位置由統籌·契約定,建議 `contracts/fixtures/atomic-write/`)。每一列:

   | 向量 | 注入 | 預期 |
   |---|---|---|
   | 成功 | 無 | 目標位元組等於輸入;目錄裡沒有 `<name>.tmp` |
   | 殘留 tmp | 寫之前先放一個 `<name>.tmp`(內容 `"stale"`) | 成功;目標是新內容;沒有 `<name>.tmp` |
   | rename 失敗 | rename 回錯誤(TS 現有測試注入的是 `EXDEV`,`state.test.ts:148`) | 丟出的是 rename 那一顆錯誤本身(不包裝);`<name>.tmp` 不存在;原檔位元組不動 |
   | 清理也失敗 | rename 失敗,而且刪 tmp 也失敗 | 丟出的仍是 **rename** 的錯誤,不是清理的錯誤 |
   | 目錄 fsync EINVAL | 目錄 fsync 回 EINVAL | 成功 |
   | 目錄 fsync EIO | 目錄 fsync 回 EIO | 丟出 EIO;**目標已被 rename**(這是 §11b 的實際語意,向量要寫明) |
   | 目錄 fsync ENOSPC | 同上換 ENOSPC | 丟出 ENOSPC |
   | 順序 | 記錄呼叫順序 | fsync(fd) 在 rename 之前、fsync(目錄) 在 rename 之後;fsync 的目錄就是目標所在目錄 |
   | fd 不漏 | 成功與「目錄 fsync 丟錯」兩條路徑 | 開過的 fd 全部關掉 |

   注入方式(Rust 用 trait 包 fs 呼叫、TS 用 vitest mock)由各自決定,**向量的「注入」與「預期」兩欄兩邊必須逐列相同**。
9. Rust 的 `write` command 對 `state/` 底下的路徑一律走這份原子寫入。**`state/` 以外**(`cards/`、`config/`)走不走,由統籌·契約定;
   本稿建議全部走(同一個函式、少一條分支、少一個變異點)。

### D. read 的 io 錯誤與拒絕分得出來(顧問裁決 (3))

10. command 的錯誤回傳分兩種形狀,TS 端各自丟不同的錯誤類別(名稱由 worker 回報):

    | 呼叫 | 輸入 / 狀態 | 預期 |
    |---|---|---|
    | `read` | `"cards/missing.md"`(不存在) | io 錯誤,`code: "not_found"`;不寫 warning |
    | `read` | `"cards"`(是目錄) | io 錯誤,`code: "is_dir"`;不寫 warning |
    | `read` | 權限 000 的 `cards/locked.md` | io 錯誤,`code: "permission"`;不寫 warning。**以 root 執行時這列略過並在報告寫明**(root 讀得到 000 的檔) |
    | `read` | `"cards/bad.md"` 內容是不合法的 UTF-8(`FF FE 00`) | io 錯誤,`code: "not_utf8"`;不寫 warning |
    | `read` | `"raw/x.md"` | 拒絕;寫 warning |
    | `exists` | `"cards/missing.md"` | `false`(不是錯誤) |
    | `list` | `"cards/nope"`(不存在) | io 錯誤,`code: "not_found"` |
    | `list` | 目錄含一個讀不到 metadata 的條目 | 略過那個條目,其餘照回(§13:不通過的條目略過、不丟錯) |

11. TS 端:`read("cards/missing.md")` 丟出的錯誤 `instanceof` io 錯誤類別、**不是**拒絕類別;`read("raw/x.md")` 反過來。

### E. 圖片用 bytes(P1-5)

12. asset handler(`lc` 協定)用 `fs::read` 讀**位元組**,依副檔名設 `Content-Type`,並加 `X-Content-Type-Options: nosniff`:

    | 請求 | 預期 |
    |---|---|
    | `assets/x.png`,內容是 PNG 檔頭加含 `00`、`FF` 的位元組 | 200;body 的 sha256 等於檔案的 sha256;`Content-Type: image/png` |
    | `assets/x.jpg`、`.jpeg`、`.gif`、`.webp` | 對應的 `image/*` |
    | `assets/x.svg` | 見「待裁」2(SVG 可以帶 script) |
    | `assets/x.bin`(未知副檔名) | `application/octet-stream` |
    | `assets/missing.png` | **404**,不是 200 空 body,也不是 403 |
    | `raw/x.png` | 403(拒絕) |

13. TS 的 `assetUrl`:同步產生 URL,Linux 是 `lc://localhost/<逐段 encodeURIComponent>`。**Windows 的 `http://lc.localhost/` 形式不在本張**
    (phase-5),但要寫成一個依平台選前綴的函式,不要再寫死(T2b `boundary.ts:110`)。

### F. 真前端載入(P1-6)

14. `tauri.conf.json` 的 `build` 有 `beforeBuildCommand`(與開發用的 `devUrl` 或等效設定),把 `apps/teach-card`、`apps/test-card`
    建置進 `frontendDist`;兩個視窗的 `url` 指向建置產物。
15. **靜態檢查**(Node 測試,不開視窗):跑完建置指令之後,
    - 兩個視窗 `url` 指的 html 都存在於 `frontendDist`;
    - 每個 html 裡每一個 `<script src>`、`<link href>` 解析後都是 `frontendDist` 裡存在的檔;
    - 沒有任何被引用的檔以 `.ts` 結尾;
    - 把 T2b 的 `frontend/teach.html` 原樣放回去(引用 `/teach-card/src/main.ts`),這條檢查必須紅。
16. **人眼確認(`@manual`,由 UI/Tauri 負責人截圖、技術顧問判)**:`npm run tauri dev` 之後
    - 教學卡視窗:看得到 fixture 的第一張卡(標題與內文),不是空白;
    - 考試卡視窗:看得到第一題的題目文字與作答欄;
    - 兩個視窗都沒有「placeholder」字樣。
    06/07 這時候還是吃 stub(MemoryFs);換成真的 `LearningFs` 是 I3 的事,不在本張。

### G. learning 根目錄只有一個來源(P1-7,依賴 T5)

17. 桌面程式讀**使用者層指標檔** `${XDG_CONFIG_HOME:-~/.config}/llm-learning-cards/vault.json` 的 `learning_dir`(T5 定),
    並比對 `vault_id` 與 `<learning_dir>/config/vault-id`。**路徑規則、JSON 格式、失敗判定跟 T5 跑同一份向量**。
    **不要用 Tauri 的 `app_config_dir`**(會變成 `~/.config/dev.learningcards.desktop/`,跟 CLI 找的不是同一個檔)。
18. 四種失敗對到啟動狀態(phase-2.feature 的 First run / configured path 場景):

    | 狀態 | 預期 |
    |---|---|
    | 指標檔不存在 | 首次啟動:請使用者選資料夾,空資料夾時提供初始化 |
    | 指標檔讀不到或不是合法 JSON | 顯示「設定檔讀不到」,請使用者重選;**不覆寫**那個讀不到的檔(除非使用者確認) |
    | `learning_dir` 不存在 | 顯示「找不到資料夾」,請使用者重選 |
    | `vault_id` 與 `config/vault-id` 不符 | 拒絕開啟,顯示「這不是同一個資料夾」;**不自動改寫任何一邊** |
    | 全部正常 | 用這個根目錄;`lc` 協定與四個 command 都用同一個根 |

19. **沒有第二個來源**:`apps/desktop/src-tauri/src` 的非測試程式碼裡 `LC_LEARNING_ROOT` 零命中;T2b 的 `startup.ts`(`node:fs`)
    不再被 app 使用(要嘛刪掉,要嘛搬成測試支援並標明)。測試:沒有指標檔、但設了 `LC_LEARNING_ROOT=/tmp/x`,啟動狀態必須是「首次啟動」。
20. 首次啟動選了資料夾之後,誰寫指標檔與 `config/vault-id`:見「待裁」3。

### H. cargo-mutants

21. 本張新增的 Rust(command、事件 append、io 錯誤分類、asset 的 bytes 與 Content-Type、指標檔解析)納入 cargo-mutants;
    沿用 T2b 的地板棘輪(只准升不准降),拿前置 4 的那把鎖。存活的變異體逐一列在報告,各標「補測試」或「等價,理由」。

## 待裁(技術顧問)

1. **asset protocol 的拒絕要不要也寫 warning 事件。** 以前不寫的理由是「沒有 TS 呼叫端」,現在 Rust 自己寫,理由消失了。
   建議:**寫**,同一個 append 函式;但 webview 可以一直發壞請求灌 log,所以同一個 `path` 一秒內只記一次(或每次啟動上限 N 行)。
   不寫的話,ADR-062 的「已知限制」要改寫理由。
2. **SVG。** 在 webview 裡直接開 SVG 會執行裡面的 script(`csp` 現在是 `null`)。建議:asset handler 對 `.svg` 回
   `Content-Security-Policy: script-src 'none'`,或乾脆不服務 `.svg`。
3. **首次啟動誰寫指標檔。** webview 沒辦法跑 `scripts/vault.ts init`。選項:(a) Rust 照 T5 的規則寫(第三份實作,要跟 T5 共用向量,
   寫入也要原子);(b) 桌面程式只讀,首次啟動顯示「請在終端機跑 `npx tsx scripts/vault.ts init <資料夾>`」。
   建議 (a),phase-2.feature 的「chosen path is saved」要的是 (a);但它讓 T5 的 init 規則多一份實作,向量必須共用。
4. **要不要拆。** 驗收 A–F 不依賴 T5,只有 G 依賴。建議拆成 T2c-1(A–F,T2b 合併後就能派)與 T2c-2(G,等 T5)。
   本稿照顧問指示寫成一張,`deps` 含 T5。
5. **驗收 C 的 TS 基準與 `writeFileAtomic` 的偏差**:見驗收 C 開頭。偏差那份是 `state/reviews.json` 的寫法,屬硬約定 §11b,
   建議另開工單,不在本張修。

## 預算

`budget_usd: 30`。依據:T2b(同一個資料夾、範圍相近)opencode grok-4.7 實際 $29.08(協調者回報,遠超小票的 $0.9–2.6)。
本張範圍比 T2b 大(command、事件、§11b 向量、bytes、前端建置、指標檔),但白名單與 symlink 不用再寫。
**實際超過 2 倍($60)要在報告標出來,寫明超在哪。** 若照待裁 4 拆開,建議 T2c-1 $20、T2c-2 $12。

## 測試誰寫

- 測試 agent:紅測試、步驟定義(照 `features/steps/_world.ts`)、驗收 C 的向量檔(Rust 與 TS 兩邊的 harness)。**等前置 1–3 都在 main 才開始。**
- 開發 agent(worker-grok):只寫實作,不改測試、不改 gherkin。要改測試就停下回報協調者。
- 驗收:照 `worker-acceptance` 的流程(先重編 `lc-fs` 再跑 cucumber、`must_catch` 逐條、自選 ≥ 3 個突變)。
- UI/Tauri 負責人:驗收 F16 的截圖與「看哪裡、什麼算對」清單,交技術顧問判。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是含 T2b 與 T5 的 `origin/main`,同一時間一個 agent。派工歸協調者。
