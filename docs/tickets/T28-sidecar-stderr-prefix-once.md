---
id: T28
deps: [T22]
touches: [apps/desktop/src-tauri/src/review_sidecar.rs]
cpu: heavy
budget_usd: 1
status: todo
owner: worker-grok
must_catch:
  - 側車自己印的 `[review-sidecar] 正在用假 router` 轉到 app stderr 變成 `[review-sidecar] [review-sidecar] 正在用假 router`(現況,T22 @manual 的 O1):純函式與接線測試必須紅
  - 沒有前綴的一行(例如依賴印的字)原樣轉出去、或整行不見:純函式與接線測試必須紅
  - 用「包含」判斷而不是「開頭」(`x [review-sidecar] y` 被原樣轉):純函式測試必須紅
  - 判斷不分大小寫、或先去掉前面的空白再比(`[Review-Sidecar] x`、`  [review-sidecar] x` 被原樣轉):純函式測試必須紅
  - 前綴少了結尾的空白(`[review-sidecar]x` 被當成已經有前綴):純函式測試必須紅
  - 結尾的 `\r` 或 `\n` 沒去掉(CRLF 結尾多一個 `\r`,或多一個空行):純函式測試必須紅
  - 一行分成好幾次寫進 app stderr(例如 `writeln!` 把內容和換行分兩次寫,會跟別的執行緒的輸出交錯):轉送迴圈的測試必須紅
  - forward_stderr 換成空函式(T22 驗收 cargo-mutants 唯一「缺口沒有補」的那一個):接線測試必須紅
  - (驗收 3,前端提議,顧問審時決定留不留)側車 stderr 一行有不合法的 UTF-8,轉送就停了、之後的行都不轉:轉送迴圈與接線測試必須紅
  - (驗收 3,同上)app 的 stderr 寫失敗時轉送就不讀了:轉送迴圈的測試必須紅
  - 側車自己的前綴被拿掉或改字(`scripts/review-sidecar.ts` 不在 touches):既有 `scripts/review-sidecar.test.ts` 必須紅
---

# 工單 T28:側車 stderr 轉到 app 時,前綴只印一次

> 狀態:草稿,待技術顧問審(派令來自顧問,經協調者 2026-10-17)。優先度:**低,排在 T24 之後**。
> 作者:UI/Tauri 負責人(10 的規格作者,不是實作者)。編號:協調者配(T28)。派工:協調者。
> 實作:worker-grok(opencode grok-4.7)。紅測試:-e5(先做 T24)。驗收:-ed。觀感與 `@manual`:前端做、技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 來源:`../reviews/T22-manual-2026-10-17.md` 的 O1;`../reviews/acceptance-T22.md` 的 cargo-mutants 一節(forward_stderr 換成空函式存活)。
> 決策:ADR-075(`../02-decision-map.md`)。**不需要新 ADR**:ADR-075 第 5 條定的是側車**自己**的 stderr 格式(`[review-sidecar] <kind>`),這張不動它;
> Rust 轉送時怎麼加前綴是 T22 工單驗收 5 的實作細節。顧問審時若要記成 ADR,號碼由寫入的人**在寫入當下**用這條指令取:
> `grep -oE '^#+ *ADR-[0-9]+' docs/02-decision-map.md | grep -oE '[0-9]+' | sort -n | tail -1`(取到的數字加 1;不在這裡配號)。
> 基底:最新的 origin/main(T22 與它的 `@manual` 已合併)。

## 為什麼有這張

T22 的 `@manual` 在真的 app 裡看到 app stderr 是 `[review-sidecar] [review-sidecar] 正在用假 router`:
側車自己印 `[review-sidecar] <…>`(T22 驗收 4),Rust 的 `forward_stderr` 轉出來時每一行再加一次 `[review-sidecar] `(T22 驗收 5)。兩邊都照工單,是規格沒對齊。

顧問裁決(2026-10-17):

1. Rust 遇到已經是 `[review-sidecar] ` 開頭的行,就不再加前綴。**側車自己的前綴不動**:單獨跑側車(`node --import tsx scripts/review-sidecar.ts`)與零輸入守門的探針都要看到它。
2. 「一行怎麼加前綴」抽成純函式,補單元測試;順便蓋掉 T22 驗收時 cargo-mutants 存活的 forward_stderr 那一個。
3. 落點只有 `apps/desktop/src-tauri/src/review_sidecar.rs`。

寫這張時另外查到一件事,放在驗收 3,**由顧問審時決定留不留**(刪掉的話,其他各條照舊):
T22 的轉送用 `BufRead::read_line`,讀到不合法的 UTF-8 會回 `Err`,迴圈就 `break`,reader 被丟掉。之後側車寫 stderr 會 `EPIPE`。
側車回業務錯誤前會用 `writeSync` 寫一行 stderr(`noteError`),這一行丟錯就跳出主迴圈,`main().catch` 裡再寫一次又丟錯,側車 exit 1,**那一個請求的回應沒寫出去**,webview 拿到 `sidecar-exited`。
前端用兩個小複製品確認過這條鏈(不是在真的 app 裡):Rust 的 `read_line` 讀 `b"ok\nbad \xff\nafter\n"`,第二行回 `Err`、`after` 沒轉;Node 照側車主迴圈的形狀、stderr 讀端關掉後 exit 1、stdout 沒有回應。
平常 node 與 tsx 只印 UTF-8,所以很少發生;但只要發生一次,後面每一個業務錯誤都會把側車弄死。修法跟這張是同一個函式,所以一起提。

## 驗收條件

### 1. 純函式(`review_sidecar.rs`;名字照這裡寫)

```rust
/// 側車 stderr 轉到 app stderr 時用的前綴(結尾有一個空白)。側車自己印的行也是這個開頭(ADR-075 第 5 條)。
pub const STDERR_PREFIX: &str = "[review-sidecar] ";

/// 側車 stderr 的一行 → 要寫到 app stderr 的那一行(不含換行)。
/// `raw` 是讀到的位元組,可能帶結尾的 `\n` 或 `\r\n`,可能有不合法的 UTF-8。
pub fn host_stderr_line(raw: &[u8]) -> String;
```

規則,照順序:

1. 去掉結尾**所有**的 `\n` 與 `\r`(跟 T22 的 `trim_end_matches(['\n', '\r'])` 一樣)。中間的 `\r` 留著。
2. 轉成字串用 `String::from_utf8_lossy`(壞位元組變 U+FFFD,不丟錯)。
3. 已經是 `STDERR_PREFIX` 開頭 → 原樣回傳。否則 → `STDERR_PREFIX` + 內容。
   「開頭」是逐位元組比:分大小寫;前面有空白就不算;`[review-sidecar]` 後面沒有那個空白也不算。

| 讀到的一行(`raw`) | 回傳 |
|---|---|
| `[review-sidecar] 正在用假 router\n` | `[review-sidecar] 正在用假 router` |
| `[review-sidecar] internal\r\n` | `[review-sidecar] internal` |
| `plain from a dependency\n` | `[review-sidecar] plain from a dependency` |
| `x [review-sidecar] y\n` | `[review-sidecar] x [review-sidecar] y` |
| `  [review-sidecar] x\n` | `[review-sidecar]   [review-sidecar] x` |
| `[Review-Sidecar] x\n` | `[review-sidecar] [Review-Sidecar] x` |
| `[review-sidecar]x\n` | `[review-sidecar] [review-sidecar]x` |
| `[review-sidecar] `(只有前綴,沒有換行) | `[review-sidecar] ` |
| `\n`(空行) | `[review-sidecar] `(跟 T22 一樣,結尾一個空白) |
| `a\rb\n` | `[review-sidecar] a\rb` |
| `bad \xff byte\n` | `[review-sidecar] bad \u{FFFD} byte` |

### 2. 轉送迴圈與接線

```rust
/// 從 `reader` 一行一行讀(`read_until(b'\n')`)到 EOF,每一行經 `host_stderr_line` 換好、加 `\n`,
/// 用**一次** `write_all` 寫進 `sink`(一行的內容與換行一起寫,不會跟別的執行緒的輸出交錯)。回傳讀到幾行。
pub fn forward_lines(reader: impl BufRead, sink: impl Write) -> usize;
```

- 讀到 EOF(`Ok(0)`)或讀錯(`Err`)才結束。`read_until` 自己會重試 `Interrupted`。
- `forward_stderr` 名字不變,只剩接線:開一條執行緒跑 `forward_lines(BufReader::new(stderr), std::io::stderr())`。`spawn` 裡呼叫它的地方不變。
- Rust 自己印的 `[review-sidecar] dropped non-protocol line`(兩個地方)不經過這裡,照舊。
- 接線要有測試證明:`SidecarHost` 起的側車往 stderr 印的字,真的出現在 app 行程的 stderr,而且每一行剛好一個前綴(做法見「紅測試」)。

### 3. 轉送不會自己停(前端提議;顧問審時刪掉的話,must_catch 標「驗收 3」的兩條一起刪)

- 不合法的 UTF-8:照驗收 1 換成 U+FFFD,**繼續讀下一行**(用 `read_until` 讀位元組,不用 `read_line`)。
- `sink` 寫失敗(app 的 stderr 關了或壞了):**繼續讀到 EOF**,之後的行讀了就丟,不再試著寫也可以。不能因為寫不出去就不讀 —— 不讀的話側車的 stderr 管子會滿或斷,側車就卡住或死掉(見「為什麼有這張」)。

### 4. 不退步

- `apps/desktop/src-tauri/tests/review_sidecar.rs`、`tests/review_sidecar_acceptance.rs`:**不改、全綠**。
- `scripts/review-sidecar.test.ts`:不改、全綠(它看側車自己的 `[review-sidecar] 正在用假 router`、`bad-today`、`internal`;側車不在 touches)。
- `apps/desktop/src/review-sidecar-static.test.ts`:全綠(它只看原始碼裡有 `[review-sidecar]` 與 `dropped non-protocol line`,改完仍成立)。
  那一條的標題「stderr 每一行加 [review-sidecar] 前綴再轉出去」跟新行為不符,**由紅測試作者改標題**(斷言不放鬆),開發 worker 不改。
- 零輸入守門:側車沒改,不用另跑。
- `npm run boundaries`:PASS。

### 5. T22 工單與 ADR 要不要同步改

| 位置 | 改不改 | 理由 |
|---|---|---|
| T22 驗收 4(側車)的 `[review-sidecar] <kind>`、`正在用假 router`、`bad-today` | **不改** | 側車自己的前綴照舊,單獨跑與零輸入守門都看它 |
| T22 驗收 5 第一個子彈「stderr 每一行加 `[review-sidecar]` 前綴轉到 app 的 stderr」 | **改** | 這句就是印兩次的來源。這張的工單分支另一個 commit 在那一句下面補一行,指向這張(T28 合併前照原句) |
| T22 驗收 8 第 2 列的過關條件「app stderr 有 `[review-sidecar] 正在用假 router`」 | **不改** | 這張之後照字面仍然成立,而且變成剛好一次;「剛好一次」由這張的驗收 6 量 |
| ADR-075 第 5 條 | **不改** | 講的是側車自己的 stderr 格式 |
| `docs/reviews/` 底下 T22 的兩份證據 | **不改** | 是當時的紀錄 |

### 6. 觀感與實機(`@manual`,前端做、技術顧問判)

用 `tauri build --debug --no-bundle` 的產物(重活,要協調者給位子;熱 target 約 15 秒)。照 T22 `@manual` 的做法,在 Xvfb `:97`,暫存根,帶 `LC_REVIEW_FAKE_CLOUD`,經檢查器呼叫一次 `start`,再對側車送 SIGKILL、呼叫 `status` 兩次讓它重起一次,然後 `WM_DELETE_WINDOW` 關。

| 檢查 | 過的條件 |
|---|---|
| 前綴只印一次 | app stderr 有兩行剛好是 `[review-sidecar] 正在用假 router`(原本的側車一行、重起的一行);`[review-sidecar] [review-sidecar]` 出現 0 次 |
| T22 驗收 8 不退步 | 同一輪裡第 1、2、4、6 列照 T22 的過關條件 |

真的 learning/ 開工、收工各量一次,前後要相同。

## 規格

這張不改 `.feature`(stderr 的格式不在任何場景裡)。工單分支另一個 commit 改 T22 工單驗收 5 的那一句(見驗收 5)。

## 紅測試(-e5 寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| 1 | `STDERR_PREFIX` 與 `host_stderr_line` | `tests/` 新檔,驗收 1 的表逐列;常數逐字比對 | 紅(編不過 —— 用 Rust 紅測試的老規矩:逐檔 `--no-run` 證明是「還沒有」而不是寫壞) |
| 2 | `forward_lines` | 記錄每一次 `write` 呼叫的假 sink:三行輸入 → 剛好三次 `write`,每次是「換好的一行 + `\n`」;回傳 3;空輸入回 0、不寫 | 紅 |
| 2 | 接線(蓋掉 forward_stderr 換成空函式) | 測試 binary 用 `std::env::current_exe()`,帶 `--exact <這條的名字> --nocapture` 與一個環境變數重跑自己一次。子行程裡:`SidecarHost` + 現有 `tests/review_sidecar.rs` 那種 `sh -c` 假側車,先往 stderr 印幾行(含已經有前綴的、沒有的、CRLF 的)再印 hello、回一則;`call` 一次、`shutdown`、等約 300 ms 再結束。父行程讀子行程的 stderr,這幾行要剛好是換好的樣子、順序一樣、各一次。(子行程要 `--nocapture`:libtest 會攔測試開的執行緒的輸出。) | 紅 |
| 3 | 壞位元組不停 | `forward_lines` 讀 `b"a\nbad \xff\nlast\n"`:三行都寫出、第二行有 U+FFFD;接線測試的假側車也印一行 `printf 'bad \377 byte\n' >&2`,後面那一行還要出現 | 紅 |
| 3 | 寫失敗也讀到 EOF | 每次 `write` 都回 `Err` 的假 sink:`forward_lines` 仍回傳全部的行數,reader 讀到底(用一個會記錄讀到哪的 reader) | 紅 |
| 4 | 不退步 | 既有測試不改;`review-sidecar-static.test.ts` 那一條只改標題 | 綠 |

- 寫完對正確實作想一遍:接線測試是不是只在測自己的假側車(例如父行程比對的字串剛好也是子行程自己印的)。比對的應該是**只有轉送才會產生**的那幾行(前綴是 Rust 加的那幾行)。
- 用丟棄式實作證明能轉綠;不進 git,交件前刪。測試一律用 `std::env::temp_dir()` 底下新建的目錄,不碰真的 learning/。

## 怎麼跑

```bash
(cd apps/desktop/src-tauri && CARGO_BUILD_JOBS=2 cargo test --test review_sidecar_stderr --test review_sidecar --test review_sidecar_acceptance)
VITEST_MAX_WORKERS=1 npx vitest run scripts/review-sidecar.test.ts apps/desktop/src/review-sidecar-static.test.ts
npm run boundaries
```

- 新的測試檔名 `review_sidecar_stderr.rs` 是建議;紅測試作者定了別的名字,協調者派工時照實際的改這一行。
- cargo 是重活,先跟協調者拿位子,`CARGO_BUILD_JOBS=2`。不跑變異測試(-ed 驗收的事)、不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev`。
- 開發 worker 可以跑一次 `npm run tauri -- build --debug --no-bundle` 確認編得過(重活,要位子);`@manual` 是前端的事。
- **-ed 驗收時**對 `review_sidecar.rs` 重跑 cargo-mutants(T22 驗收用的那份只列這個檔的設定):`host_stderr_line`、`forward_lines`、`forward_stderr` 的變異體要全部 caught;等價的逐個說明(`STDERR_PREFIX` 是常數,cargo-mutants 不改它,由驗收 1 的逐字比對蓋)。T22 列為「缺口,沒有補」的 forward_stderr 那一個要變成 caught。

## 不在範圍

- 不改側車(`scripts/review-sidecar.ts`、`review-sidecar-stdio.ts`)與它自己的前綴。
- 不改 Rust 自己印的 `dropped non-protocol line`,不改 stdout 的協定處理、逾時、生命週期。
- 不把側車的 stderr 寫進 `log.jsonl` 或任何檔(stderr 只轉到 app 的 stderr,跟 T22 一樣)。
- 不改 `main.rs`、`commands.rs`、`lib.rs`。
- 不改任何測試檔。覺得測試錯了就停下回報協調者。

## 預算

`budget_usd: 1`。grok 不設花費上限,只記錄。LLM 真呼叫:0。

## 測試誰寫

- 紅測試:-e5(顧問指定;先做 T24)。開發 worker 以紅測試分支為基底。
- 實作:worker-grok,只改「touches」列的檔。
- 驗收:-ed(含 cargo-mutants)。觀感:前端(驗收 6),技術顧問判。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
排程:落點是 `apps/desktop/src-tauri/`(10-desktop-shell),跟 T24(`apps/test-card/`、`scripts/boundaries.allow.json`)不重疊;顧問排在 T24 之後。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
