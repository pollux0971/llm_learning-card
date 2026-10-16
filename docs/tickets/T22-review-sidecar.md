---
id: T22
deps: [T21]
touches: [packages/core/src/session/engine.ts, packages/core/src/session/protocol.ts, packages/core/src/session/handler.ts, packages/core/src/session/answer.ts, packages/core/src/session/index.ts, scripts/review.ts, scripts/review-sidecar.ts, scripts/boundaries.allow.json, apps/desktop/src-tauri/src/review_sidecar.rs, apps/desktop/src-tauri/src/commands.rs, apps/desktop/src-tauri/src/lib.rs, apps/desktop/src-tauri/src/main.rs, apps/desktop/src/webview/review-client.ts]
cpu: heavy
budget_usd: 5
status: todo
owner: worker-grok
must_catch:
  - 側車收下 start、next、submit、summary、status 以外的 method(或 method 大小寫不同也照做):「未知 method 拒絕」必須紅
  - 協定的 schema 允許請求帶路徑或卡 id 欄位(params 不是嚴格物件):「訊息不帶路徑與 id」必須紅
  - 一行不是合法 JSON、或超過 256 KiB,側車結束或不回應:「壞的一行回 bad-request / too-large,側車還活著」必須紅
  - 未知的 v(例如 2)跟未知 method、壞 JSON 回同一種 kind:「unsupported-version、unknown-method、bad-request 三種分開」必須紅
  - 一行裡有 \r(CRLF 結尾)被接受,或字串裡的 U+2028 / U+2029 讓任一邊把一行切成兩行:向量測試必須紅
  - 側車的 stdout 出現協定以外的一行(例如 core 或依賴的 console.log):「stdout 只有協定行」必須紅
  - Rust 把 stdout 的非協定行或超長的回應轉給 webview:「Rust 丟掉並只記固定的一行」必須紅
  - 側車在記憶體裡留著 reviews.json 的快照,submit 不重讀:「側車不快取 reviews」必須紅(先改磁碟上的 reviews.json 再 submit,寫回的檔要保留那個改動)
  - Rust 的信封檢查跟 TS 的 schema 對同一份向量判得不一樣(例如 Rust 接受 v 為 2,或接受 id 為字串):向量測試兩邊之一必須紅
  - Rust 解析或改寫 params / result 的內容(例如加欄位、改值、依 method 分支):「Rust 原樣傳遞」的靜態與向量檢查必須紅
  - 子行程環境不是用白名單重建(例如帶了 NODE_OPTIONS、OPENAI_API_KEY 或任一個不在白名單的變數),或 release build 帶了 LC_REVIEW_FAKE_CLOUD / LC_REVIEW_TODAY:子行程環境的單元測試必須紅
  - webview 的請求 id 沒有比上一個大(重複或變小)還被送進側車,或回應 id 跟請求不符還被當成答案:id 的測試必須紅
  - 側車開著假 router 時 hello 沒帶 fakeCloud true、或 stderr 沒印「正在用假 router」:側車啟動的測試必須紅
  - 側車用 resolveVerifiedLedger 得到的 learning 目錄跟 --dir 不同,還照樣開始:「root-mismatch」必須紅
  - 回給 webview 的錯誤帶例外原文、provider 回應或金鑰樣子的字串(sk- 開頭等):錯誤訊息的測試必須紅
  - 側車死掉後,下一個請求卡住或一直回 sidecar-exited、不重起:生命週期測試必須紅
  - 一個請求超過逾時還在等:逾時測試必須紅(用注入的短逾時,不真的等 180 秒)
  - 同時送兩個請求,兩個都寫進側車:「忙的時候回 busy」必須紅
  - 關 app(RunEvent::Exit)沒收掉側車,或側車讀到 stdin EOF 不結束:生命週期測試必須紅
  - CLI 的行為變了(scripts/review.ts 的輸出、退出碼、快取、暫停、續答、snapshot 任一):既有 review 測試與 cucumber 11、I2 必須紅
  - CLI 與側車各留一份編排(例如 review.ts 仍自己 readSessionCache / buildAndStore / tallyToday):「編排只有一份」的靜態檢查必須紅
  - submitAnswer 的 keepOnError 開著時,批改 error 仍前進 typeIndex、仍跳過這張卡、或寫了 reviews.json:keepOnError 的單元測試必須紅;沒開時行為跟現在不同:既有 answer 測試必須紅
  - 填空用陣列送出時,答案裡的逗號被切開:陣列送出的單元測試必須紅
  - submit 回 failed 的填空題沒帶 correctAnswers,或答對 / 應用題也帶:submit 結果的測試必須紅
  - reteach 的結果帶了縮短版的內容(shortBody 或任何文字),或縮短版不存在時 next 回錯誤 / 卡住:next 結果的測試必須紅
  - summary 在這一次沒答題時也 snapshot,或有答題時不 snapshot:summary 的測試必須紅
---

# 工單 T22:複習側車的底層 —— Node 跑同一份 core session,Rust 只「起、傳、收、關」

> 狀態:草稿,待技術顧問審(-e5 審 ADR-075 與這張的契約相關部分)。
> 作者:UI/Tauri 負責人(06 與 10 的規格作者,不是實作者)。編號:協調者配(T22)。派工:協調者。
> 實作:worker-grok(opencode grok-4.7)。紅測試:另一個角色(協調者指定,不是前端、不是開發者)。驗收:-ed。觀感與 `@manual`:前端做、技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 決策:**ADR-075**(`../02-decision-map.md`;同一個分支寫入)。
> 規格:`features/06-test-card/phase-2.feature`(同一個分支加了側車的五個場景,見「規格」)。
> 基底:origin/main `6e2e71f`。**派工時基底要含 T21 合併後的 main**(T21 也動 `main.rs`;兩張落點都是 10-desktop-shell,R2 不能同時跑)。

## 為什麼有這張

I3 要在桌面視窗裡複習。批改要 LLM,router、帳本、session、快取、snapshot 全是 Node;webview 沒有 Node,也不能拿金鑰。
技術顧問選 ADR-075 的 B:整個複習 session 跑在一個 Node 側車,用跟終端機同一份 core。這張只做底層:

1. 把 CLI 的編排從 `scripts/review.ts` 搬進 core,CLI 與側車共用(CLI 行為不變)。
2. 定訊息形狀(一份 zod schema + 一份向量)。
3. Node 端的側車(`scripts/review-sidecar.ts`):stdio 一行一則 JSON,五個動作。
4. Rust 端:起側車、原樣傳遞、生命週期、錯誤。一個 Tauri command `review`。
5. webview 端的 client(`apps/desktop/src/webview/review-client.ts`),給 T24 的考試卡用。

考試卡本身(拿掉 stubs、畫面)是 T24,不在這張。

## 驗收條件

### 1. 編排只有一份(`packages/core/src/session/engine.ts`)

現在 `scripts/review.ts` 的 `main` 裡有一段只有 CLI 在用的編排。原樣搬進 core,名字照這裡寫(紅測試直接用):

```ts
import type { SessionCache } from './cache.js';
import type { Session, SessionSummaryInput } from './types.js';
import type { LlmRouter } from '@core/grading/index.js';

export type DayOpen =
  | { kind: 'paused'; cache: SessionCache }
  | { kind: 'ready'; session: Session; cache: SessionCache; resumed: boolean };

/** 讀今天的快取:ok 就用(續答);invalid 記 warning 再重建;missing / stale 重建並寫快取;paused 回 paused。 */
export async function openDay(opts: { learningDir: string; today: string; router: LlmRouter; env?: NodeJS.ProcessEnv }): Promise<DayOpen>;
/** CLI 的 --pause:有快取就標 paused;沒有(或壞掉,先記 warning)就用不評分的 router 建一份 paused 的快取。 */
export async function pauseDay(opts: { learningDir: string; today: string; env?: NodeJS.ProcessEnv }): Promise<void>;
/** CLI 的 --unpause:有快取就把 paused 改 false 並寫回,回傳新的快取;沒有就回 undefined。 */
export function unpauseDay(opts: { learningDir: string; today: string; env?: NodeJS.ProcessEnv }): SessionCache | undefined;
/** 小結的數字:tallyToday + 明天估計(跟現在 review.ts 算法相同);resumed 時帶 answeredThisRun。 */
export function summarizeDay(opts: { learningDir: string; today: string; cache: SessionCache; dailyCap: number; answeredThisRun: number; resumed: boolean }): SessionSummaryInput;
/** 這一次有答題(answeredThisRun ≥ 1)才 snapshot;失敗不丟錯。hint 是 git-repo 給的指引(CLI 照舊印;側車不往 webview 送,可能含路徑)。 */
export function snapshotAfterReview(opts: { learningDir: string; today: string; answeredThisRun: number }): { status: 'committed' | 'no-changes' | 'skipped' | 'failed'; hint?: string };
```

- `sessionFromCache`、`buildAndStore`、`cacheFromSession`、`tallyToday` 加明天估計那幾行、`snapshotQuietly` 的判斷,都搬進這裡。`refusingRouter` 跟著搬(`pauseDay` 用)。
- `scripts/review.ts` 改成呼叫這幾個函式。**CLI 的輸出(每一行字)、退出碼、寫的檔、snapshot 的時機都不變。** 讀 stdin、印字、`--dry-run` 的列印留在 CLI。
- 靜態檢查:`scripts/review.ts` 不再直接呼叫 `readSessionCache`、`writeSessionCache`、`buildTodaySession`、`tallyToday`、`estimateTomorrow`、`snapshotLearningDir`(`--dry-run` 的唯讀路徑可以留 `readSessionCache` 與 `buildTodaySession`,其餘不行)。

### 2. `submitAnswer` 給側車的兩個小改(`packages/core/src/session/answer.ts`)

```ts
export async function submitAnswer(session: Session, answer: string | string[], opts?: { keepOnError?: boolean }): Promise<AnswerOutcome>;
```

- `answer` 是陣列時(只用於填空),直接當作每個空格的答案,不再用逗號切。字串時照舊(`splitFillAnswer`)。應用題收到陣列 → 丟錯(呼叫端寫錯)。
- `keepOnError: true` 且這一題批改回 `pass === null`:
  - 不設 `hadError`、不前進 `typeIndex`、不 shift queue、不寫 `reviews.json`、`session.errors` 不加。
  - 回 `{ status: 'error', pass: null, feedback, cardDone: false }`。下一次 `presentNextCard` 回同一題,可以再送。
- 沒給 `opts`(CLI)時,行為跟現在一模一樣(批改失敗那張卡今天跳過)。既有的 `answer.test.ts` 不改、全綠。

### 3. 訊息形狀(`packages/core/src/session/protocol.ts`,軟約定,登記在 ADR-075)

一份 zod schema,TS 端(側車、webview client)都 import 它;向量檔 `packages/core/src/session/protocol.vectors.json` 由紅測試作者寫,TS 與 Rust 的測試讀同一份。
這個檔**不 import 任何 `node:` 模組**(webview 也要用)。

一行一則 JSON,UTF-8,`\n` 結尾,一行最多 **256 KiB**(`MAX_LINE_BYTES = 262144`)。

| 種類 | 形狀 |
|---|---|
| 側車的第一行 | `{ "v": 1, "kind": "hello", "fakeCloud": boolean, "today": "YYYY-MM-DD" }` |
| 請求 | `{ "v": 1, "id": <整數 ≥ 1>, "method": "start" \| "next" \| "submit" \| "summary" \| "status", "params": <物件> }` |
| 成功 | `{ "v": 1, "id": <同一個>, "ok": true, "result": <物件> }` |
| 失敗 | `{ "v": 1, "id": <同一個,讀不出 id 時是 null>, "ok": false, "error": { "kind": <字串>, "message": <字串> } }` |

- 全部用 `z.strictObject`:多一個欄位就不合法。`v` 只能是 `1`。`method` 大小寫要完全相同。
- 每個 method 的 `params`:

  | method | params | result |
  |---|---|---|
  | `start` | `{}` | `{ state: 'paused' \| 'empty' \| 'ready', today, resumed: boolean, total, answered, deferred, dailyCap, fakeCloud: boolean }` |
  | `next` | `{}` | `{ kind: 'reteach', card, shortPath: string \| null }` \| `{ kind: 'question', card, stage, type: 'fill' \| 'apply', prompt, blanks?, progress: { index, total }, stuck, overdueDays }` \| `{ kind: 'done' }` |
  | `submit` | `{ fill: string[] }` \| `{ apply: string }` | `{ status: 'passed' \| 'failed' \| 'error' \| 'partial', pass: boolean \| null, feedback, cardDone, newStage?, correctAnswers?: string[] }` |
  | `summary` | `{}` | `{ passed, returned, retryLater, answeredThisRun?, tomorrow: { total, capped, shown, overflow }, snapshot: 'committed' \| 'no-changes' \| 'skipped' \| 'failed' }` |
  | `status` | `{}` | `{ paused: boolean, today }` |

- **params 沒有任何路徑或卡 id 欄位**(`card` 與 `shortPath` 只出現在 result)。`answered` 是今天已答的張數(續答時 > 0),`total` 是 `totalDue`。
- `shortPath`:縮短版在 learning/ 裡的相對路徑(`cards/<分類>/<id>.short.md`,正斜線)。視窗用 `LearningFs` 自己讀(ADR-075 第 3 點:縮短版照舊走 `LearningFs`),側車不送內容。檔案不存在時是 `null`(05 phase-3 還沒做,真 vault 目前沒有縮短版)。
- `fakeCloud`:跟 `hello` 的同一個值(webview 看不到 `hello`,所以 `start` 再帶一次),給視窗顯示「測試模式」。
- `correctAnswers`:只在填空題、這一次 `pass === false` 時有,每個空格取可接受寫法的第一個(06 phase-1 畫面要的)。
- 錯誤的 `kind`(固定清單;`message` 是固定的中文句子,每個 kind 一句,寫在 `protocol.ts`):

  | 誰回 | kind | 什麼時候 |
  |---|---|---|
  | 側車 | `bad-request` | 不是合法 JSON、一行裡有 `\r`、信封不合、params 不合 |
  | 側車 | `unsupported-version` | `v` 不是 `1`(跟 `bad-request`、`unknown-method` 分開) |
  | 側車 | `unknown-method` | method 不在五個裡 |
  | 側車 | `too-large` | 一行超過上限 |
  | 側車 | `root-mismatch` | 指標檔指向的目錄跟 `--dir` 不同 |
  | 側車 | `router-unavailable` | 帳本身分驗不過(`resolveVerifiedLedger` 失敗)|
  | 側車 | `no-cards` | `cards/` 底下 0 張卡(P-28:不能說成「今天沒有到期」)|
  | 側車 | `paused` | 今天暫停時呼叫 `next` / `submit` |
  | 側車 | `no-session` | 還沒 `start` 就呼叫 `next` / `submit` / `summary` |
  | 側車 | `no-question` | 還沒 `next` 拿到題目就 `submit`,或 `fill` / `apply` 跟目前題型不合 |
  | 側車 | `internal` | 其他例外(原文不回;stderr 只印 `[review-sidecar] internal`)|
  | Rust | `not-configured` | 啟動狀態不是 ok(learning 根沒設好,T2c-2)|
  | Rust | `sidecar-unavailable` | 起不來(沒有 node、20 秒內沒有 hello)|
  | Rust | `sidecar-exited` | 側車結束了(下一個請求會重起)|
  | Rust | `timeout` | 180 秒沒回;側車被收掉 |
  | Rust | `busy` | 已經有一個請求在等 |
  | Rust | `bad-envelope` | webview 給的信封不合(`v`、`id`、`method` 型別、長度),或 `id` 沒有比上一個請求大 |
  | Rust | `bad-response` | 側車回的那一行超過 256 KiB(整行丟掉) |

- 批改失敗不是錯誤:`submit` 回 `ok: true`、`status: 'error'`(驗收 2 的 `keepOnError`)。

### 4. Node 端的側車(`scripts/review-sidecar.ts`,方法在 `packages/core/src/session/handler.ts`)

- 入口:`node --import tsx scripts/review-sidecar.ts --dir <learning 根>`。第一行 `import './_env.js'`(ADR-034,金鑰只在這裡讀)。
- **stdout 只准協定行**:任何 import 之前,先把 `console.log`、`console.info`、`console.debug`、`console.warn` 導到 stderr;協定的那一行只由框線程式用 `process.stdout.write` 寫。core 或依賴印出的任何字都只會到 stderr。
- 啟動:
  1. `LC_REVIEW_FAKE_CLOUD` 有值 → `await import(那個路徑)`(它換掉 `fetch`),stderr 印 `[review-sidecar] 正在用假 router`。
  2. 今天 = `LC_REVIEW_TODAY`(要符合 `YYYY-MM-DD`,不符就印 `[review-sidecar] bad-today` 並以 2 結束),沒設就是本機日期。
  3. 印 `hello`。
- 處理請求的邏輯放在 core:`createReviewHandler(deps) => (line: string) => Promise<string>`(`handler.ts`;收一行、回一行,不碰 stdio)。
  `deps` 是 `{ learningDir, today, routerFactory, env }`;`routerFactory` 在第一次 `start` 時呼叫(跟 CLI 的 `liveRouterOrExit` 同一條路:`resolveVerifiedLedger` → `createLiveGatewayRouter`),
  並檢查 ledger 的 learning 目錄真實路徑等於 `learningDir`,不同回 `root-mismatch`。
  T24 的 vitest / cucumber 用這個函式在程序內接一個 client,不起行程。
- `start`:`listCardIds` 為空 → `no-cards`;`openDay`;`paused` → `state: 'paused'`;`totalDue === 0` 且沒有 reteach → `state: 'empty'`;否則 `ready`。
- `next`:`presentNextCard` 的結果,`question` 另帶 `overdueDays`(`session.current.overdueDays`)。`reteach` 不送 `shortBody`,改送 `shortPath`(`findCardFile(…, { short: true })` 相對於 learning 根);縮短版不存在時 `presentNextCard` 會丟錯(reteach 已經從佇列拿掉),handler 接住、回 `shortPath: null`,下一次 `next` 照常出題。
- `submit`:`submitAnswer(session, fill ?? apply, { keepOnError: true })`;填空 `pass === false` 時加 `correctAnswers`。這一次答了幾題(含批改失敗)記在 handler 裡。
- `summary`:`summarizeDay` + `snapshotAfterReview`(這一次有答題才 snapshot);result 的 `snapshot` 只帶 `status`,不帶 `hint`。
- `status`:讀今天的快取的 `paused`(沒有快取 → false)。
- 一個請求處理完才讀下一行(依序,不併發)。stdin 結束(EOF)→ 結束行程(退出碼 0)。
- 只用 `\n` 分行;字串裡的 U+2028 / U+2029 是合法 JSON,照常處理,不當成換行。一行裡有 `\r` → `bad-request`。
- **不快取 reviews**:側車不在記憶體裡留 `reviews.json` 的內容;每次 `submit` 都經 core 重讀再寫(`answer.ts` 現在就是 `loadReviews` → 轉移 → `saveReviews`)。這樣跟終端機同時用時,丟的最多是同時那一題的 history,不會蓋掉別人早就寫好的。
- 壞的一行:回 `bad-request`(或 `too-large`),**不結束**。
- 回給 webview 的錯誤 `message` 只用 `protocol.ts` 的固定句子;例外原文、stack、provider 回應都不出側車。stderr 只印 `[review-sidecar] <kind>` 這種固定格式。

### 5. Rust 端(`apps/desktop/src-tauri/src/review_sidecar.rs`、`commands.rs`、`main.rs`)

純函式(不起行程就能測;名字照這裡寫):

```rust
pub const MAX_LINE_BYTES: usize = 262_144;
pub const HELLO_TIMEOUT: Duration = Duration::from_secs(20);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);
/// 子行程的環境只從這份白名單重建(env_clear 之後逐一帶入),不是刪黑名單(ADR-062 的白名單原則)。
pub const CHILD_ENV_ALLOWLIST: [&str; 12] = [
    "PATH", "HOME", "USER", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR",
    "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME",
];
/// 只有 debug build 才另外帶入的兩個(測試用)。release build 一律不帶。
pub const DEBUG_ONLY_ENV: [&str; 2] = ["LC_REVIEW_FAKE_CLOUD", "LC_REVIEW_TODAY"];

/// webview 給的請求:只檢查 v == 1、id 是 ≥ 1 的整數、method 是字串、params 是物件、序列化成一行後 ≤ MAX_LINE_BYTES。
/// 通過就回那一行(serde_json::to_string,內容不改)。
pub fn request_line(request: &serde_json::Value) -> Result<String, EnvelopeError>;
/// 側車回的一行:只檢查是 JSON 物件、v == 1、長度;回傳原樣的 Value。hello 另一個函式。
pub fn parse_response_line(line: &str) -> Result<serde_json::Value, EnvelopeError>;
/// 子行程的環境:CHILD_ENV_ALLOWLIST 裡有值的變數;debug == true 時再加 DEBUG_ONLY_ENV 裡有值的。其他一律不帶(NODE_OPTIONS、金鑰、LLM_* 都不帶)。
pub fn child_env(debug: bool, env: impl Iterator<Item = (String, String)>) -> Vec<(String, String)>;
/// 起側車的程式、參數、工作目錄:("node", ["--import", "tsx", "<repo>/scripts/review-sidecar.ts", "--dir", <learning 根>], <repo>)。
pub fn sidecar_command(repo_root: &Path, learning_root: &Path) -> (String, Vec<String>, PathBuf);
```

- Rust **不看** `method` 的值、`params`、`result`、`error` 的內容;不依 method 分支。信封檢查的接受 / 拒絕要跟 TS 的 schema 對同一份向量一致。
- `repo_root`:這一版用編譯時的 `CARGO_MANIFEST_DIR` 往上三層(`apps/desktop/src-tauri` → repo 根)。打包是 ADR-075 的已知限制,這張不做。
- `SidecarHost`(Tauri managed state,`main.rs` 加 `.manage(...)`):
  - 第一次 `review` 時起側車(`std::process::Command`,stdin / stdout 接管,stderr 每一行加 `[review-sidecar]` 前綴轉到 app 的 stderr),等 `hello`(`HELLO_TIMEOUT`)。
  - 一次一個請求(`Mutex`);鎖不到就回 `busy`。
  - 寫一行、讀到 `id` 相同的那一行為止(`id` 不同的舊回應丟掉);`REQUEST_TIMEOUT` 到了就收掉側車、回 `timeout`。
  - 請求的 `id` 要比上一個送出的大(webview 的 client 從 1 往上數;重開 app 從頭數),不然回 `bad-envelope`、不送。
  - stdout 讀到不是合法 JSON 的一行(≤ 256 KiB):丟掉,不轉給 webview,app stderr 只記一行 `[review-sidecar] dropped non-protocol line`,繼續等。
  - stdout 讀到超過 256 KiB 的一行:讀到上限就停、把那一行剩下的丟掉,等中的請求回 `bad-response`。
  - 讀到 EOF 或寫失敗 → 回 `sidecar-exited`,標記為死;下一個請求重起。
  - `RunEvent::Exit`:關掉 stdin、等它結束(最多 3 秒),還在就 kill,再 wait。不留孤兒、不留殭屍。
  - 逾時與等待時間可以注入(測試用短的),預設是上面三個常數。
  - 啟動狀態不是 ok(`LearningRoot::dir()` 失敗)→ 回 `not-configured`,不起側車。
- command:`#[tauri::command] async fn review(request: serde_json::Value) -> Result<serde_json::Value, ReviewError>`:
  成功時回側車那一行原樣的 Value(含 `ok: false` 的業務錯誤);Rust 自己的錯誤是 `Err({ kind })`。加進 `commands::handler()` 的清單。
- capabilities 不用改(app 自己的 command 不走 `capabilities/`;T2c-1 的四個 command 也沒有)。

### 6. webview 的 client(`apps/desktop/src/webview/review-client.ts`)

```ts
export interface ReviewClient {
  start(): Promise<StartResult>;
  next(): Promise<NextResult>;
  submit(answer: { fill: string[] } | { apply: string }): Promise<SubmitResult>;
  summary(): Promise<SummaryResult>;
  status(): Promise<StatusResult>;
}
export class ReviewError extends Error { readonly kind: string; }
export function createReviewClient(opts?: { invoke?: InvokeFn; handler?: (line: string) => Promise<string> }): ReviewClient;
```

- 預設用 `@tauri-apps/api/core` 的 `invoke('review', { request })`;`handler` 有給時改走程序內(測試、T24 的單獨執行用),行為一樣。
- `id` 由 client 自己從 1 往上數。回應用 `protocol.ts` 的 schema 驗;`ok: false` 或 Rust 的 `Err` 都轉成 `ReviewError(kind)`。
- 不 import 任何 `node:` 模組(`webview-imports.test.ts` 的規則照舊)。import `packages/core/src/session/protocol.ts` 要在 `scripts/boundaries.allow.json` 加一條 10-desktop-shell → 11-review-cli(理由寫 ADR-075)。

### 7. 不退步

- `scripts/review.test.ts`、`scripts/review-session.test.ts`、`scripts/review-router.test.ts`、`packages/core/src/session/*.test.ts`:**不改、全綠**。
- cucumber `@review-cli and not @manual`、`@i2 and not @manual`:全綠。
- `apps/desktop/src/*.test.ts`、`apps/desktop/src-tauri/tests/*`:全綠(T16、T21 的測試照舊)。
- `npm run boundaries`:PASS。

### 8. 觀感與實機(`@manual`,前端做、技術顧問判)

用 `tauri build --debug --no-bundle` 的產物。重活要協調者給位子。真的 learning/ 開工、收工各量一次,前後要相同。
不在使用者的桌面上送滑鼠鍵盤;這張的檢查都經由檢查器呼叫 client(`Runtime.evaluate`),不經畫面。暫存根照 T16 `@manual` 的做法(XDG 全指暫存、`vault.ts init`)。

| 檢查 | 怎麼做 | 過的條件 |
|---|---|---|
| 第一次呼叫才起側車 | 開 app 後列 app 的子行程;再經檢查器呼叫 `start` | 呼叫前沒有側車;呼叫後剛好一個 `node … review-sidecar.ts` |
| 假 router 標記 | 帶 `LC_REVIEW_FAKE_CLOUD`(指向 `features/steps/_fake-review-cloud.mjs`)開 app | `hello.fakeCloud` 是 true,app stderr 有 `[review-sidecar] 正在用假 router` |
| 不帶就是 live | 不帶變數開 app(暫存根、沒有 `.env` 的簽出) | `hello.fakeCloud` 是 false;`start` 回 `router-unavailable` 或正常開始,不會悄悄用假的 |
| 關 app 不留孤兒 | `WM_DELETE_WINDOW` 關兩個視窗 | app exit 0,3 秒內沒有側車行程 |
| app 被強制結束也不留 | 對 app 送 SIGKILL | 3 秒內側車自己結束(stdin EOF) |
| 側車死掉可以重來 | 對側車送 SIGKILL,再呼叫 `status` 兩次 | 第一次 `sidecar-exited`,第二次正常(新的側車) |
| 金鑰不出側車 | 上面每一次的 app stderr、`log.jsonl`、檢查器拿到的每個回應 | `grep` 不到 `.env` 裡任何值的前 8 個字元(只比對,不印出值) |

## 規格(同一個分支另一個 commit,技術顧問一起審)

`features/06-test-card/phase-2.feature` 加五個場景(英文;步驟由紅測試作者寫):

- `The review helper takes only review actions`:start、next、submit、summary、status 以外的動作被拒絕;請求沒有路徑與卡 id 的欄位。
- `The helper's message shape is the same on both sides`:同一份向量,TS 與 Rust 接受與拒絕的一樣。
- `A helper that has exited is reported and the next action starts a new one`。
- `The fake grader can only be turned on when the application starts`。
- `@manual` `The helper does not outlive the application`。

## 紅測試(另一個角色寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| 1 | 編排只有一份 | vitest:`engine.ts` 的五個函式各自的行為(照 review.ts 現在的分支逐一列);靜態讀 `scripts/review.ts`,不得直接呼叫驗收 1 列的那幾個函式 | 紅 |
| 1 | CLI 不變 | 既有 review 測試與 cucumber,不改 | 綠(防退步) |
| 2 | `keepOnError`、陣列送出 | vitest:批改回 error 時 typeIndex / queue / reviews.json / errors 都不變;下一次 present 同一題;陣列裡含逗號的答案原樣送進 grader;應用題給陣列丟錯 | 紅 |
| 3 | 訊息形狀 | 向量檔(紅測試作者寫):合法與不合法的 hello / 請求 / 回應各若干行,至少含:多一個欄位(strictObject 拒絕)、`v: 2`(`unsupported-version`)、`id: "1"`、`method: "Start"`(`unknown-method`)、超長、非法 JSON(`bad-request`)、CRLF 結尾、字串裡有 U+2028 / U+2029(接受、不斷行)、回應 id 跟請求不符;每一列寫明預期的 kind;vitest 用 schema 跑、Rust 的 `tests/review_sidecar.rs` 用 `request_line` / `parse_response_line` 跑,兩邊結果要跟向量寫的一樣 | 紅 |
| 4 | 側車 | vitest 起真的 `scripts/review-sidecar.ts` 子行程(暫存根、`XDG_*`、`HOME` 全暫存;`LC_REVIEW_FAKE_CLOUD` 指向 `_fake-review-cloud.mjs`):hello、五個 method、壞的一行、EOF 結束、root-mismatch、錯誤訊息不帶原文;另外直接測 `createReviewHandler` | 紅 |
| 5 | Rust | `tests/review_sidecar.rs`(獨立檔):`child_env` 的 debug / release(白名單以外的變數,例如 `NODE_OPTIONS`、`OPENAI_API_KEY`、`FOO`,兩種 build 都不帶)、`sidecar_command`、常數值;stdout 的非協定行與超長行;id 不遞增;用一支假側車(`sh -c` 小腳本:印 hello、回固定的行、故意不回、故意結束)測 busy、timeout、sidecar-exited 後重起、Exit 時收掉 | 紅 |
| 5 | Rust 原樣傳遞 | 向量裡的 params / result 經 `request_line` / `parse_response_line` 後逐位元相同;靜態:`review_sidecar.rs` 不出現 `"start"` 等 method 名字的字串比對 | 紅 |
| 6 | client | vitest:用假 `invoke` 與 `handler` 兩種,id 遞增、回應驗證、錯誤轉成 `ReviewError(kind)`;webview 不 import `node:` | 紅 |
| 7 | 不退步 | 上面列的既有測試 | 綠 |

- 自測片段一律最小,不放可以直接抄的完整實作。
- 測試一律用 `mkdtemp` 當 `XDG_CACHE_HOME`、`XDG_CONFIG_HOME`、`HOME`;**不准 live**(簽出裡沒有 `.env`;假 router 走 `LC_REVIEW_FAKE_CLOUD`)。
- 建議照 T14 用丟棄式改法證明能轉綠(不進 git,交件前刪)。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/session scripts/review apps/desktop
(cd apps/desktop/src-tauri && CARGO_BUILD_JOBS=2 cargo test --test review_sidecar)
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '(@review-cli or @i2) and not @manual' --format summary
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@test-card and @phase-2 and not @manual' --format summary
npm run boundaries
```

- 環境:`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`。受保護的測試檔清單由協調者派工時附上。
- **cucumber 一律用 `--tags`**,不給 feature 檔路徑。cargo 與 cucumber 都是重活,先跟協調者拿位子,一次一個。
- 06 phase-2 的其他場景(拿掉 stubs 那些)是 T24 的,這張跑 `@test-card and @phase-2` 時它們還是 undefined,只看這張加的五個。
- 開發 worker 可以跑一次 `npm run tauri -- build --debug --no-bundle` 確認編得過(重活,要位子);`@manual` 是前端的事。
- 不跑變異測試(-ed 驗收的事)、不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev`。

## 不在範圍

- 考試卡(`apps/test-card`)任何改動 —— T24。進度、逾期、小結畫面 —— T23。
- 不改任何測試檔與 `.feature`(紅測試作者改)。覺得測試錯了就停下回報協調者。
- 不改 `contracts/`(§7 路由表與 `LlmRouter` 簽章是硬約定);不改 `CLAUDE.md`;不改 `packages/core/src/llm/`、`grading/`、`scheduler/`。
- 不開網路埠。不做打包(Node runtime 怎麼帶,10 phase-4、phase-5 再決定)。
- 不加 `pause` 這個 method(暫停照舊由終端機 `review --pause` 設;系統列是 10 phase-3)。
- 不處理視窗與終端機同時答題的寫入衝突(ADR-075 Consequences 的已知限制)。
- 不改 `tauri.conf.json`、`window_mode.rs`(T21 的落點)、`capabilities/`、`Cargo.toml`、`package.json`。

## 預算

`budget_usd: 5`。grok 不設花費上限(使用者 2026-10-15),只記錄;算不出來寫「不知道」。LLM 真呼叫:0(測試全走假 router)。

## 測試誰寫

- 紅測試、向量檔、步驟定義:協調者指定的角色(不是前端、不是開發者)。開發 worker 以紅測試分支為基底。
- 實作:worker-grok,只改「touches」列的檔。
- 驗收:-ed,照 `worker-acceptance`。
- `@manual`:前端(驗收 8),技術顧問判。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip(紅測試分支要從含 T21 的 main 開),同一時間只給一個 agent。派工歸協調者。
排程:這張的落點有 `apps/desktop/`(10-desktop-shell)、`packages/core/src/session/`(11-review-cli)、`scripts/`(infra,檔案層級)。T21 合併前不能派;T24 依賴這張。
真的 learning/ 開工、收工各量一次,前後要相同(不寫死數字)。
