---
id: T40
deps: [T37]
touches: [apps/desktop/src-tauri/src/review_sidecar.rs, apps/desktop/src-tauri/tests/, apps/desktop/src/, apps/teach-card/src/, apps/test-card/src/]
cpu: heavy
budget_usd: 4
status: todo
owner: worker-grok
must_catch:
  - Rust 照 webview 原本的 id 送(拿掉換號)、留著 id 要比上一個大 的拒絕:兩個 client 都從 1 數、交錯送出的測試必須紅(其中一個拿到 bad-envelope)
  - 拿掉換號、也拿掉舊規則:假側車收到的 id(received.log)有重複或沒有一直變大,線上 id 的測試必須紅
  - 換號之後沒換回:回給 webview 的回應 id 不是它送出的那個,必須紅(webview id 比線上 id 大、比線上 id 小兩種都要有)
  - 一個 client 從 1 重新數(視窗重新載入):在較大的 id 之後送 id 1 必須成功;只換了號卻在 webview id 上留著舊規則的實作必須紅
  - 線上 id 的計數器在側車重起之後歸 1 或變小:必須紅(只增不減,跨側車重起也一樣)
  - 信封檢查不再要求 id 是 1 以上的整數(id 0、字串、小數照樣送):既有的信封測試必須紅
  - 舊回應丟掉的規則改成比對 webview 原本的 id:stale 測試(假側車先回一個別的 id)必須紅
  - 考試卡收到 busy 就顯示 複習程式停了:client 連回兩次 busy 再成功時,考試卡必須出題,畫面不得出現 複習程式停了
  - busy 重試的間隔不是 300 ms、等候字樣不是剛好在超過 1 秒時出現、放棄不是在 180 秒:各自的測試必須紅(假時鐘;180 秒跟 Rust 原始檔的 REQUEST_TIMEOUT 比對)
  - 教學卡留著自己的重試迴圈(兩層重試):一次 busy 之後 invoke 次數不是剛好 2,必須紅;teach-session.ts 還有自己的 busy 判斷與 sleep,靜態測試必須紅
  - 放棄重試之後考試卡顯示 複習程式停了 或只給 重新開始:必須顯示 timeout 的固定字樣與 再試一次
  - 教學卡出錯畫面出現英文 kind(例如 bad-envelope):依 kind 顯示 ERROR_MESSAGES 的句子、不認得的 kind 顯示 internal 那一句的測試必須紅
  - client 對沒有 message 的 Rust 拒絕把 kind 當成 message:必須紅
  - 類別列的字樣不是 名稱 · 需要素材 · 剩 N 張 的順序與分隔,或 (目前) 不在最後:標籤測試必須紅
  - 標示列顯示類別 id 而不是名稱:必須紅
---

# 工單 T40:兩個視窗共用側車 —— id 由 Rust 編、`busy` 重試只在共用 client、錯誤只給固定字樣(07 phase-2 的修補)

> 狀態:草稿 2026-10-22,待顧問審。規格:UI/Tauri 負責人(T37 工單作者)。編號 T40、ADR-078:協調者配。
> 實作:worker(opencode + grok-4.7);紅測試、改既有測試:測試 agent;驗收:驗收 agent;觀感(`@manual`):前端,技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 依據:`../reviews/T37-manual-2026-10-22.md`(F1、F2、F3、O1–O4 的量測與時間線);決策 ADR-078(refine ADR-075、ADR-077 與 `T22-review-sidecar.md` 第 223 行的 id 規則);修法由顧問 2026-10-22 定案。
> 基底:main `ab98f5f`(T37 `@manual` 證據已合併)。這張擋 07 phase-2 done。

## 為什麼有這張

T37 讓教學卡也經同一個 Rust `SidecarHost` 打側車。Rust 那一側有兩條規則是照「只有考試卡一個 client」設計的,第二個 client 一來就出事(數字都是 T37 `@manual` 量的):

- **F1**:app 一開,先到的那個視窗的請求起側車、在鎖裡等 `hello`(約 1.3 秒)。教學卡先到時,考試卡的 `start` 拿到 `busy`;考試卡的 `showError` 不認得 `busy`,顯示「複習程式停了。」(16 次中 1 次)。
- **F2**:兩個視窗的 `ReviewClient` 各自從 1 編號;Rust 拒絕「id 沒有比上一個大」的請求(`../../apps/desktop/src-tauri/src/review_sidecar.rs` 第 257 行)。教學卡在等 `hello` 那段每 300 ms 重試,用掉 id 1–6;之後考試卡的 `submit` 與每次「重新開始」都被回 `bad-envelope`,要按 4–5 次,剛才那題沒有記到(12 次中 12 次)。
- **F3**:同一條規則反過來,教學卡的「下一個」被回 `bad-envelope`,畫面只寫英文「bad-envelope」,要按 3 次「再試一次」(12 次中 12 次)。
- T37 前(教學卡讀 fixture,不送 review 請求)9 次中 0 次。

另有四個觀感小問題 O1–O4,顧問一起定了改法(下面第 4 節)。

## 修法(ADR-078)

### 1. id 由 Rust 編(F2、F3)

改 `../../apps/desktop/src-tauri/src/review_sidecar.rs`:

- `Inner` 的 `last_id` 換成一個**只增不減**的線上 id 計數器(從 1 開始;app 開著就不歸零,側車逾時、結束、重起都不歸零)。
- `call_locked`:信封檢查(`request_line`)通過之後,把請求的 `id` 換成計數器的下一個值再寫進側車;等回應時比的是**線上 id**;等到之後把回應的 `id` **換回 webview 原本的 id**,其餘原樣回傳。
- 拿掉「`id <= last_id` 就回 `bad-envelope`」(現在第 257 行)與記 `last_id`(第 279 行)。
- **留著**:`request_line` 的信封檢查(`v == 1`、`id` 是 ≥ 1 的整數、`method` 是字串、`params` 是物件、長度上限);識別碼不同的舊回應丟掉、非協定行丟掉;`try_lock` 拿不到回 `busy`(Rust 不排隊)。
- 寫進側車失敗時那個線上 id 就算用掉了(計數器不回退)。
- 側車與 core 不改:它們只要求 id 是正整數。`../../packages/core/src/session/protocol.vectors.json` 目前沒有「id 沒遞增要拒絕」的列(每一列各自獨立,合法列的 id 都是 1),**不用改**;測試 agent 確認一次,若有就一起改並寫進交件說明。

### 2. `busy` 重試只有一條路,在共用 client(F1)

改 `../../apps/desktop/src/webview/review-client.ts`,常數照 ADR-077 D5(數值不變,位置搬家):

- 匯出 `BUSY_RETRY_MS = 300`、`BUSY_NOTICE_AFTER_MS = 1000`、`BUSY_GIVE_UP_MS = 180_000`(要跟 Rust 的 `REQUEST_TIMEOUT` 一樣)。
- `createReviewClient` 多兩個可注入的選項 `sleep`、`now`(測試用假時鐘;預設 `setTimeout` 與 `Date.now`)。
- 每個動作收到 Rust 的 `busy`:等 `BUSY_RETRY_MS`,用**新的 webview id** 重送同一個動作與參數;從第一次送出算起超過 `BUSY_NOTICE_AFTER_MS` 時通知一次「開始等」;成功或遇到別的錯誤時,若通知過就通知「不等了」。
- 一直 `busy` 到 `BUSY_GIVE_UP_MS`:停止重送,通知「不等了」,丟出 `ReviewError`,`kind` 是 `timeout`、`message` 是 `ERROR_MESSAGES.timeout`,並且 `unsent === true`(這個請求從來沒有送進側車)。`ReviewError` 多一個 `readonly unsent: boolean`,其餘情況是 `false`。
- 通知的介面:`ReviewClient` 多一個 `onWait(listener: (waiting: boolean) => void): () => void`(回傳取消訂閱)。視窗在 `main.ts` 建 client、在畫面裡訂閱。
- 只有 `busy` 會重試;其他種類照舊直接丟出。
- **兩個視窗都用這條,只留一條路**:
  - 教學卡:`../../apps/teach-card/src/teach-session.ts` 拿掉自己的 busy 判斷、`sleep`、`now`、`REQUEST_TIMEOUT_MS` 迴圈;等候字樣改由 `onWait` 驅動(字樣照舊「考試卡正在批改,稍等一下。」、等候時按鈕停用)。`unsent` 的 `timeout` 照舊顯示「等候回覆的時間過了。」與「再試一次」,按了重送同一個動作。
  - 考試卡:`../../apps/test-card/src/session.ts` 與 `App.svelte`:等候時在面板最上面(測試模式那行下面)顯示一行 **「複習程式還在準備,稍等一下。」**(新字樣,見「待顧問審」第 1 點),樣式同教學卡的 `p.notice`;等候時「送出」等按鈕停用。`unsent` 的 `timeout` 不走「複習程式停了」:顯示「等候回覆的時間過了。」與「再試一次」(按了就是現在的 `restart()`,重新 `start`,續答照快取)。Rust 自己的 `timeout`(請求送進去了、側車沒在 180 秒內回)照舊。
  - 考試卡的 `showError` 不用再認 `busy`:`busy` 不會再到它手上。
- Rust 不改成等鎖(ADR-077、ADR-078 都不採用)。

### 3. 錯誤只顯示固定字樣(F3)

- `review-client.ts` 匯出 `reviewErrorText(err: unknown): string`:`ReviewError` 依 `kind` 查 `ERROR_MESSAGES`(`../../packages/core/src/session/protocol.ts` 第 41 行起;10 → 11 只 import 這個檔,現有例外涵蓋);不認得的 `kind`、不是 `ReviewError` 的錯,都回 `ERROR_MESSAGES.internal`(「內部發生問題,請稍後再試。」)。
- 同一個檔:Rust 的拒絕沒有 `message` 時(現在第 64–67 行把 `kind` 當 message),`message` 改成上面查到的句子。
- 教學卡的錯誤畫面一律用 `reviewErrorText`(現在 `teach-session.ts` 第 79–82 行用 `err.message`)。**畫面永遠不出現英文的 kind。**
- 考試卡現有的對照(`showError` 的各種 kind、`credential-unavailable` 的金鑰樣板)不動。

### 4. 觀感 O1–O4(教學卡)

- **O1**:類別列的字樣改成「資安 · 需要素材 · 剩 3 張」;學完是「資安 · 需要素材 · 學完了」;目前的類別在最後加「 (目前)」。沒有 `require_raw` 的照舊「語言 · 剩 3 張」。
- **O2**:類別清單**一列一顆**(直排),每顆撐滿內容寬、字靠左;「取消」自己一列,放在最下面。三個類別時整份清單照樣不用捲。
- **O3**:卡片上方的標示列顯示**類別名稱**(資安、語言、網路,從側車回的類別清單查),不是 id;查不到才顯示 id。
- **O4**:先備提示那一行,「先備還沒學:」的字放進自己的 `span`,跟每顆先備按鈕的字**垂直置中**;量法:`getBoundingClientRect` 的垂直中心,字與按鈕裡的字相差 ≤ 1 px。

## 驗收條件

### 1. 自動驗收

| 層 | 指令 | 過的條件 |
|---|---|---|
| Rust | `CARGO_BUILD_JOBS=2 cargo test --test review_sidecar --test review_sidecar_acceptance`(`apps/desktop/src-tauri`) | 全綠,含下面新的 id 測試 |
| client | `VITEST_MAX_WORKERS=1 npx vitest run apps/desktop/src/` | 全綠,含 busy 重試、`onWait`、`unsent`、`reviewErrorText` |
| 教學卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/` | 全綠,含 O1–O3 與錯誤字樣 |
| 考試卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/test-card/` | 全綠,含 busy 不再變成「複習程式停了」 |
| cucumber | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@teach-card and @phase-2 and not @manual' --format summary`,`@i2 and not @manual`、`@i3 and not @manual` | 全綠,0 undefined |

測試 agent 要寫的(紅測試先寫;Rust 測試放 `../../apps/desktop/src-tauri/tests/review_sidecar.rs`,不寫在實作檔的 `mod tests`):

- **Rust,假側車**(現有的 `Fixture` 與 `received.log`):
  - 兩個 client 交錯:webview id 依序 1、1、2、2、3(兩邊各自從 1 數)全部成功;每個回應的 `id` 等於送出的那個;`received.log` 的 id 是 1、2、3、4、5。
  - 重新從 1 數:先送 5、6,再送 1 → 成功、回應 id 是 1,線上 id 照樣變大。
  - 回應 id 換回:webview 送 9007199254740991(2^53−1)與 1,回應各自是原本的值。
  - 側車重起之後(逾時或結束)線上 id 繼續往上,不歸 1。
  - 舊回應丟掉(`stale` 模式)照舊成功、拿到的是對的那一行。
  - 信封檢查照舊(id 0、字串、小數、`v` 不是 1 …… 都是 `bad-envelope`、不起側車)。
  - 現有的 `request_ids_must_increase_and_a_refused_one_is_not_sent` 改成上面這幾條(見「要改的既有測試」)。
- **client**(假 `invoke`、假時鐘):
  - `busy` 兩次再成功:`invoke` 被呼叫 3 次、間隔各 300 ms、每次的 webview id 都不同;回傳成功的結果。
  - `onWait`:總等候 ≤ 1000 ms 時不通知;超過時通知 `true` 一次,結束時通知 `false` 一次。
  - 一直 `busy`:在 180 秒停,丟 `timeout`、`unsent === true`、`message` 是固定字樣;之後不再呼叫 `invoke`。
  - `BUSY_GIVE_UP_MS` 跟 Rust 原始檔 `REQUEST_TIMEOUT` 的秒數相同(讀 `review_sidecar.rs` 比對,跟 T37 的做法一樣)。
  - 非 `busy` 的拒絕不重試;沒有 `message` 的 Rust 拒絕,`message` 是 `ERROR_MESSAGES` 的句子,不是 kind。
  - `reviewErrorText`:每個 `ERROR_KINDS` 都回它的句子;不認得的 kind 與一般 `Error` 回 `internal` 的句子;回傳值不符合 `/^[a-z-]+$/`。
- **教學卡**:client 一次 `busy` 後成功 → `invoke` 剛好 2 次(沒有兩層重試);等候字樣由 `onWait` 驅動;`unsent` 的 `timeout` 顯示固定字樣與「再試一次」、按了重送同一個動作;Rust 拒絕 `bad-envelope`(沒有 message)時畫面是「請求的信封不合規定。」;不認得的 kind 是「內部發生問題,請稍後再試。」;O1 的標籤三種(剩 N 張、學完了、加「(目前)」);O3 標示列是名稱。靜態:`teach-session.ts` 裡沒有自己的 busy 判斷與 `sleep`。
- **考試卡**:`start` 時 client 回 `busy` 兩次再成功 → 出題、畫面從沒出現「複習程式停了。」;等候超過 1 秒顯示「複習程式還在準備,稍等一下。」;`unsent` 的 `timeout` → 「等候回覆的時間過了。」與「再試一次」,不是「重新開始」;Rust 的 `timeout`(`unsent === false`)照舊。

### 2. 改壞證明(測試 agent 的丟棄式證明)

`must_catch` 每一條各做一次:改了哪裡、哪一條紅、紅的訊息原文、還原後綠。Rust 那幾條要同時有「拿掉換號」與「換號但沒換回」兩種改壞。

### 3. 觀感(`@manual`,前端做、技術顧問判)

做法同 T37 `@manual`:暫存根 + 三個類別的 fixture、假 router、`Xvfb :97` + 巢狀 GNOME Shell(兩者包 `systemd-run --user --scope -p MemoryMax=…`)、`node` 替身記側車那一側、檢查器 `Network` 記視窗那一側;不碰使用者的桌面 `:1`。

| 列 | 怎麼量 | 過的條件 |
|---|---|---|
| M1(F1) | 新的暫存根、`LC_REVIEW_TODAY` = 明天,開 app 12 次,看考試卡第一個畫面與側車第一個收到的請求 | 12 次都沒有「複習程式停了。」;教學卡先到的那幾次,考試卡只出現等候字樣(或直接出題) |
| M2(F2) | 同一批:答第一題 | 12 次都直接出結果;側車收到的 id 一直變大、沒有重複;視窗那一側每個回應的 id 等於它送出的 |
| M3(F3) | 同一批:考試卡答過題之後,教學卡按「下一個」;另外在暫存根製造一個側車會回錯的情況(例如把 `reviews.json` 改成唯讀再按「下一個」) | 「下一個」一次就成功;錯誤畫面是中文固定字樣,沒有英文 kind |
| M4(O1–O4) | 清單、標示列、先備提示各量一次 | O1 字樣一字不差;O2 每列的 x 相同、y 往下排、「取消」最後一列;O3 是名稱;O4 中心差 ≤ 1 px |
| M5 | T37 七列快速重做一次 | 都還是過 |
| M6 | console、真的 learning/ | 每次開都是 0 則;learning/ 前後相同(唯一量法) |

### 4. 不退步

- 06、07、10 的既有場景與測試全綠(扣掉下面「要改的既有測試」);`cargo test`(`apps/desktop/src-tauri`)全綠。
- 任何 `.feature` 都不改。`contracts/` 不改。

## 要改的既有測試(測試 agent 改,開發 worker 不改)

這幾條把現在的行為釘住了,跟 ADR-078 矛盾:

- `../../apps/desktop/src-tauri/tests/review_sidecar.rs` 的 `request_ids_must_increase_and_a_refused_one_is_not_sent`(現在第 469 行起)→ 換成第 1 節的 id 測試。
- `../../apps/desktop/src/review-client-teach.test.ts` 的「Rust 的 busy 拒絕變成 kind 為 busy 的 ReviewError(視窗靠它重試)」(現在第 105 行起)→ busy 改由 client 重試。
- `../../apps/desktop/src/review-client.test.ts`:kind 對照(現在第 110 行)與 `busy` 那一條(現在第 166 行)→ `busy` 改成重試;沒有 message 的拒絕,message 是固定字樣。
- `../../apps/teach-card/src/teach-session.test.ts`:busy 重試那幾組(常數、假時鐘、180 秒比對 Rust)→ 搬到 client 的測試;教學卡只測「用 `onWait` 顯示等候」與錯誤字樣;O1 的標籤期望。
- `../../apps/test-card/src/session.test.ts`:`it.each` 的 kind 清單裡的 `busy`(現在第 716、726 行)→ 拿掉(`busy` 不會再到考試卡)。
- 改的時候在 commit 與交件說明寫清楚:哪一條、為什麼、新斷言有沒有更嚴。

## 受保護的測試檔

`*.test.ts`、`features/steps/**`、`features/support/**`、`apps/desktop/src-tauri/tests/**`、`packages/core/src/session/protocol.vectors.json`、`contracts/fixtures/**`、各 `*-test-support.ts`、`.feature`。
worker 覺得測試有錯,寫進報告的「待協調」,不改。

## 落點

`touches` 都已在 `../../scripts/boundaries.owners.json`:`apps/desktop/` → 10-desktop-shell、`apps/teach-card/` → 07-teach-card、`apps/test-card/` → 06-test-card。不新增 `scripts/` 底下的檔;新的測試檔放在這些資料夾裡就不用另外登記。
import:06、07 → 10(現有例外)、10 → 11 只 import `protocol.ts`(現有例外)。不新增例外。

## 待顧問審

1. 考試卡的等候字樣「複習程式還在準備,稍等一下。」:量到的 `busy` 幾乎都在開機等 `hello` 那 1.3 秒,所以用「準備」;教學卡的「考試卡正在批改,稍等一下。」照 D5 不動。
2. 考試卡 `unsent` 的 `timeout` 按「再試一次」是重新 `start`(續答照快取),不是重送那一次 `submit`:180 秒的極端情況,答案要重打一次,換來只有一條重試路徑。

顧問 2026-10-22 審過,兩點都同意。更正理由:`unsent` 表示那個請求從來沒進側車,重送 `submit` 不會重複批改也不會多花 LLM 錢;選重新 `start` 是為了簡單(只留一條重試路徑),不是為了錢。

已知代價(接受):教學卡等候字樣「考試卡正在批改,稍等一下。」在開機那 1.3 秒、考試卡只是在起動時,超過 1 秒也可能閃一下。照 D5 不改字樣。

## 不在範圍

- Rust 排隊、改 `REQUEST_TIMEOUT`、改 `HELLO_TIMEOUT`。
- 教學卡等候字樣的內容(D5 定的)。
- 考試卡其他錯誤的字樣與對照。
- phase-3 的「深入這個」、phase-4。

## 預算

`budget_usd: 4`。grok 不設花費上限,只記錄。LLM 真呼叫:0。

## 測試誰寫

- 紅測試、改既有測試、改壞證明:測試 agent。
- 驗收(含變異,`npm run mutate` 範圍:`review_sidecar.rs` 的 `call_locked` 以 cargo-mutants、`review-client.ts` 的重試與 `reviewErrorText` 以 Stryker):驗收 agent。
  - Stryker(`review-client.ts` 的重試與 `reviewErrorText`)≥ 80%(T33、T37 先例)。
  - cargo-mutants(`call_locked`):must_catch 對到的 mutant 全殺;其他存活者逐一列出,歸成等價、低、真缺口三類;真缺口由測試 agent 補完才合併。
- `@manual`:前端。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底 main `ab98f5f` 或之後。跟 T39(`scripts/`、`docs/tickets/`、`features/13-work-dag/`)不重疊;跟 T35(`wayland_note.js`,10-desktop-shell)同一個落點,不要同時派。

派工順序(顧問 2026-10-22,照 R3):T39 是 `cpu: heavy`,目前 dispatched、之後還有 review,所以 T40 的開發 worker 等 T39 合併(離開 review)才派;測試 agent 的 T40 紅測試可以先寫。T35 排在 T40 後面。
