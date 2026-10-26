# 契約:型別與檔案格式

> 版本:1.5.0
>
> **硬約定**(§1 §2 §3 §4 §7 的 LlmTask 與路由表 §8 §9 §10 §11 §11b §12):改動需 ADR。
> (§1 與 §11b 於 1.2.0 補進索引,見 ADR-061;§2 的圍欄與 CJK 判定於 1.2.0 改寫,見 ADR-060。)
> **軟約定**(§5 §6 §7 的函式簽章 §13):改了跑測試、更新本文件、commit 說明理由即可。
> §13 的路徑檢查見 ADR-062(1.3.0)與 ADR-063(1.3.1:字元集合、長度、raw、保留名)。
> 1.4.0 動到兩個硬約定,使用者 2026-10-15 批准:§12 加帳本身分與位置由使用者層指標決定(ADR-066);§1 的 `CategoryId` 收窄成 §13 的一個合法段加長度上限(ADR-067)。
> 1.5.0 動到 §2(硬約定),使用者 2026-10-27 選 A:哪些是 example 圍欄,以教學卡畫面的區塊解析為準;步驟 2 的「其他」寫完整(ADR-081,補充 ADR-060)。
> 分層理由見 `README.md`。

以下是所有**跨模組**的定義。模組內部型別不在此。

---

## 1. 識別碼與基本型別

```ts
type CardId = string;        // /^[a-z]{2,6}-\d{4}$/  例 "sec-0042"
type CategoryId = string;    // 必須是 §13 的一個合法段,且 UTF-8 位元組 ≤ 64(1.4.0,見下)
type IsoDate = string;       // "YYYY-MM-DD",一律當地日期,不含時間
type IsoWeek = string;       // "YYYY-Wnn"  例 "2026-W37"
type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type Level = number;         // 0..4
type Source = 'raw' | 'llm';
type QuestionType = 'fill' | 'apply';
```

**`CategoryId`(1.4.0,ADR-067)**必須同時滿足:

1. **是 §13 的一個合法段**:非空、不含 `/`;每個字元是 ASCII 的 `A`–`Z`、`a`–`z`、`0`–`9`、`_`、`-`、`.`,或 Unicode 一般類別為 L、N、M;
   **已經是 NFC**(不是就拒絕,不轉換);不以 `.` 開頭或結尾;第一個 `.` 之前的部分(固定 ASCII 不分大小寫)不是 Windows 保留裝置名。
   這些規則的**全文在 §13**,這裡只引用,不重寫。
2. **UTF-8 位元組數 ≤ 64**。理由:分類名會出現在 `cards/<cat>/<id>.short.md`、`graph/order-<cat>.json` 的路徑裡;分類名太長,
   它底下的每個路徑都會超過 §13 的 240 位元組上限,而「邊界讀不了的分類」正是這次收窄要擋的。

**§1 引用 §13 的段規則,所以 §13「一個 `relPath` 通過,當且僅當」清單的第 2、3、5、6 條(字元集合與 NFC、開頭的點、結尾的點、保留名)今後的任何改動都等於改 §1 這個硬約定**,要走 ADR,不能當軟約定。
**Rust 是權威**(`LearningFs` 的邊界在 Rust command),TypeScript 那一側(schema、ingest、lint)是同一規則的第二份實作;兩份載入
同一個機器可讀的向量檔 `contracts/fixtures/path-segment-vectors.json`(真碼位,每列附 `applies_to`、`rule`、`why`),不各自抄表。**實作用 `applies_to` 選列、不用 `rule` 欄分**:長度那四列只適用於 `category`(64 位元組的上限是 `CategoryId` 的,
§13 的路徑段沒有這條,只有整條路徑 240);`expect` 是對 `applies_to` 裡每一種檢查而言。
1.4.0 之前的 `CategoryId` 只禁空白與分隔符,所以 ingest 可能建出邊界讀不了的分類(例如 `C++`);收窄之後 ingest 建分類前就拒絕。

## 2. 教學卡

檔案:`cards/<category>/<id>.md`。縮短版:`cards/<category>/<id>.short.md`。

```ts
interface CardFrontmatter {
  id: CardId;
  category: CategoryId;
  title: string;
  level: Level;
  source: Source;
  created: IsoDate;
  parent?: CardId;          // level >= 1 必填
  prereqs?: CardId[];       // 預設 []
  source_ref?: string;      // source==='raw' 必填,格式 raw/<cat>/<file>#L<a>-L<b>
  provisional?: boolean;    // 預設 false
  stale?: boolean;          // 預設 false
  source_missing?: boolean; // 預設 false
}

interface Card {
  frontmatter: CardFrontmatter;
  body: string;             // markdown,不含 example 圍欄
  examples: string[];       // 每個 example 圍欄的內容(解析器給的,見「Example 圍欄」;已 trim、換行一律 \n)
}
```

**Body 字數規則**(硬約定。權威定義,所有模組一致):

計算對象:**只有 body**,不含 frontmatter、不含 example 圍欄。

演算法,依序:

1. 移除所有 example 圍欄(語法見本節最後的「Example 圍欄」)
2. 逐字元掃描,把字元分成三類:
   - **CJK**:Unicode **Script** 屬性為 `Han`、`Hiragana`、`Katakana`、`Hangul` 的字元。
     **不是** Unicode 區段(block):區段會漏掉擴充區與相容區的漢字與韓文字母
     (例如 U+3400 擴充 A、U+20000 擴充 B、U+F900 相容區、U+1100 Hangul Jamo)
   - **字母數字**:Unicode 類別 L*(非 CJK)與 N*
   - **其他**:CJK 與 L*/N* 以外的所有字元(含 P*、S*、Z*、M*、C*)
3. 每個 CJK 字元計 1
4. 每個「字母數字的連續序列」計 1。**「其他」類的字元會切斷序列**
5. 「其他」類本身計 0

關鍵推論(v1.0 未講清楚,曾造成歧義):

| 內容 | 計算 | 結果 |
|---|---|---|
| `same-origin` | 連字號是標點,切斷序列 → `same` + `origin` | 2 |
| `TLS` | 一個序列 | 1 |
| `1.5` | 句點切斷 → `1` + `5` | 2 |
| `don't` | 撇號切斷 → `don` + `t` | 2 |
| `同源政策` | 四個 CJK | 4 |
| `RFC 6265` | 空白切斷 → `RFC` + `6265` | 2 |

**向量表(1.2.0 擴充)**:上面六列全是同一類(標點切斷序列),所以四份實作在
CJK 邊界與圍欄上各自解讀、算出不同數字(ADR-060)。下表補上其餘的類別。
每一列都是**從本節定義推出來的**,不是從某份實作觀察來的;「依據」欄指出推導自哪一條。
CJK 的列一律用**兩個相同字元**:單一字元在「被當成字母數字」與「被當成 CJK」下都算 1,看不出差別;
兩個相連才分得出來(字母數字連續序列算 1,CJK 每字算 1)。

| 內容 | 結果 | 依據 |
|---|---|---|
| `同源` | 2 | 步驟 3:Han 每字 1 |
| U+3400 ×2(擴充 A) | 2 | 步驟 2:Script=Han,是 CJK |
| U+20000 ×2(擴充 B) | 2 | 步驟 2:Script=Han |
| U+F900 ×2(相容區) | 2 | 步驟 2:Script=Han |
| U+1100 ×2(Hangul Jamo) | 2 | 步驟 2:Script=Hangul |
| U+3131 ×2(Hangul 相容字母) | 2 | 步驟 2:Script=Hangul |
| `か` `カ` 各一,相連 | 2 | 步驟 2:Hiragana、Katakana 是 CJK |
| `前` + 三反引號 example 圍欄(內含 `內容 內容`) + `後` | 2 | 步驟 1:圍欄整段移除,只剩 `前` `後` |
| `前` + 四反引號 example 圍欄(內含一個三反引號的內層圍欄與文字) + `後` | 2 | 圍欄語法:結束至少要跟開始一樣多,內層三個不結束外層 |
| 三反引號 `js` 圍欄,內容 `ab` | 2 | 圍欄語法:不是 `example` 開始,不移除;`js`、`ab` 各 1,反引號是符號計 0 |

這個定義偏嚴(`same-origin` 算 2 而不是 1),但**明確**比**寬鬆**重要——
兩個獨立實作必須算出同一個數字。

上限 100。縮短版上限 50(`settings.short_body_limit`)。

**Example 圍欄**(1.5.0 改寫,ADR-081):**哪些是 example 圍欄,以教學卡畫面的區塊解析為準**:
markdown-it **15.0.1**、選項 `{ html: false, linkify: true }`,解析的對象是 body(frontmatter 以外的文字)
用 JavaScript 的 `String.prototype.trim()` 去掉頭尾空白之後的文字(畫面與 core 都這樣做)。
解析結果裡的每一個圍欄(`fence` token),它的資訊字串原文(`token.info`,不處理跳脫與 HTML 實體)
用 `trim()` 去掉頭尾空白、再用 `/\s+/` 切開,第一段逐字等於 `example`(大小寫一樣),就是一個 example 圍欄。
選項與「是不是 example 圍欄」的判斷寫在 `packages/contracts/src/card-markdown.ts`,
**這個檔是本節的一部分,改它就是改本節**。
下面用 CommonMark 的話描述解析結果;描述跟解析器不同時,**以解析器為準**。

- **開始**:三個以上反引號,或三個以上波浪號 `~`,後面接資訊字串,第一段是 `example`
  (後面可以再有別的字,例如 `example 標題`;全形空白 U+3000 也會切開)。`Example`、`&#101;xample` 都不是。
  反引號開始的那一行,資訊字串裡不能有反引號。開始行縮排 0–3 個空白;
  縮排 4 欄以上(Tab 算到下一個 4 的倍數)不是圍欄(前面空一行時是縮排程式碼,緊接在段落後面時是段落的續行)。
  開始行前面有一般文字(同一行)也不是圍欄。
- **結束**:同一種字元、數量**至少**跟開始一樣多、縮排 0–3 個空白、後面只能有空白。數量比開始少的那一行不結束。
- **沒有結束**:圍欄一直到它所在的容器結束(卡片結尾,或清單項目、引用結束)。
- **清單與引用裡的圍欄也算**(畫面一樣畫成例子框)。
- 資訊字串第一段不是 `example` 的(如 ` ```js `、` ```examples `)、兩個反引號的,都不是 example 圍欄,不移除,內容照算。

步驟 1 的「移除」:這個圍欄在解析結果裡佔的那些行(`token.map`)中,開始行留下第一個反引號或波浪號**之前**的部分
(例如清單的 `1. `、引用的 `> `),自己成一行;開始行以外的每一行整行拿掉(連同行首的 `> ` 與清單續行的縮排)。
trim 過的 body 裡,圍欄以外一個位元組都不變(含 CRLF)。

examples:每個 example 圍欄的內容,也就是解析器給的內容(`token.content`:已經去掉容器記號與縮排,
換行一律是 `\n`,CRLF 的卡也一樣),trim 過,依出現順序。內容是空的也算一個,是空字串。
內層含三反引號程式碼圍欄的內容,外層用四個反引號或波浪號包。內容是巢狀 markdown(不是程式碼),渲染時遞迴處理。一張卡可有 0..n 個。

| 內容 | 結果 | 依據 |
|---|---|---|
| `前` + ` ```example 標題 ` 開始的圍欄 + `後` | 2 | 資訊字串第一段是 `example` |
| `前` + 沒有結束的 example 圍欄(後面還有 `後`) | 1 | 圍欄到卡片結尾 |
| `前` + 三反引號開始、四反引號結束 + `後` | 2 | 結束可以比開始多 |
| `前` + ` ~~~example ` 圍欄 + `後` | 2 | 波浪號也算 |
| `前` + 空一行 + 縮排 4 格的 ` ```example ` 圍欄(內含 `內容 內容`) + `後` | 7 | 縮排程式碼,照算 |
| `前` + 清單 `1. ` 開始的圍欄 + `後` | 3 | 留下 `1. `,`1` 算 1 |
| 每一行都有 `> ` 的引用圍欄,前後沒有字 | 0 | 只留下 `> ` |

**版本**:markdown-it 的版本(15.0.1)寫在本節裡,所以**任何升版都是改本節**(硬約定):
要先問使用者,並附上 `contracts/fixtures/word-count-vectors.json` 每一列升版前後的結果差異。

## 3. 考題

檔案:`questions/<id>.yaml`

```ts
interface FillQuestion {
  prompt: string;           // 用 ___ 標記空格,至少 1 個
  answers: string[][];      // 外層長度 === prompt 中 ___ 的數量;內層至少 1 個非空字串
}

interface ApplyQuestion {
  prompt: string;
  rubric: string[];         // 2..4 條,每條是可回答是/否的敘述
}

interface QuestionFile {
  card: CardId;
  fill: FillQuestion[];     // 2..3
  apply: ApplyQuestion[];   // 1..2
}
```

## 4. 複習狀態

檔案:`state/reviews.json`,型別 `Record<CardId, Review>`

```ts
interface ReviewEntry {
  date: IsoDate;
  stage: Stage;
  type: QuestionType;
  pass: boolean;
  grader: Grader;
  provisional?: boolean;
  revised_by?: 'cloud';
  revised_to?: boolean;
}

interface Review {
  stage: Stage;
  learned_at: IsoDate;
  next_due: IsoDate | null;   // stage===6 時為 null
  fails_in_row: number;
  total_fails: number;
  stuck: boolean;
  history: ReviewEntry[];
}
```

**間隔表**(權威):

| stage | 意思 | 距上次通過 |
|---|---|---|
| 0 | 新學未考 | — |
| 1 | 待 D1 | 1 |
| 2 | 待 D7 | 7 |
| 3 | 待 D30 | 30 |
| 4 | 待 D90 | 90 |
| 5 | 待 D180 | 180 |
| 6 | 歸檔 | — |

**題型對應**:stage 1 → `['fill']`;stage 2 → `['fill','apply']`;stage 3/4/5 → `['apply']`

## 5. 審核結果(軟約定)

```ts
type Grader =
  | 'exact' | 'fuzzy' | 'local-llm' | 'fallback-strict' | 'empty'   // fill
  | 'cloud' | 'local-provisional' | 'error';                        // apply

interface GradeResult {
  pass: boolean | null;     // null 僅在 grader==='error',呼叫端不得推進或回退 stage
  criteria?: boolean[];     // apply 才有,長度 === rubric.length
  feedback: string;         // <= 40 字
  grader: Grader;
}
```

## 6. 排程(軟約定)

```ts
interface DueItem {
  card: CardId;
  stage: Stage;
  types: QuestionType[];
  overdue_days: number;
  overdue_ratio: number;    // overdue_days / interval(stage)
  stuck: boolean;
}

interface SelectResult {
  due: DueItem[];           // 已排序,長度 <= settings.daily_cap
  deferred: number;         // 因上限而順延的張數
  reteach: CardId[];        // 不佔上限
}

interface SchedulerEvent {
  type: 'reteach_queued' | 'stuck' | 'archived';
  card: CardId;
}

interface SchedulerOutcome {
  review: Review;           // 新物件,不修改輸入
  events: SchedulerEvent[];
}
```

排程函式一律純函式:`(review, ctx) => SchedulerOutcome`。不讀檔、不寫檔、不呼叫 LLM。

## 7. LLM(`LlmTask` 與路由表為硬約定,函式簽章為軟約定)

```ts
type LlmTask =
  | 'ingest.cards' | 'ingest.questions' | 'ingest.deps'
  | 'deepen' | 'grade.fill.llm' | 'grade.apply' | 'reteach.short';

interface LlmResult {
  text: string;
  provider: 'anthropic' | 'openai' | 'ollama';
  model: string;
  latency_ms: number;
  provisional: boolean;
  tokens_in?: number;
  tokens_out?: number;
}

interface LlmRouter {
  call(task: LlmTask, prompt: string, opts?: { timeoutMs?: number; maxTokens?: number }): Promise<LlmResult>;
  probeOnline(): Promise<boolean>;
  probeLocal(): Promise<{ available: boolean; models: string[] }>;
}
```

**路由表**(權威):

| task | 在線 | 離線+本機 | 離線+無本機 |
|---|---|---|---|
| ingest.cards / ingest.questions / ingest.deps | cloud | throw `CLOUD_REQUIRED` | throw `CLOUD_REQUIRED` |
| deepen / grade.apply / reteach.short | cloud | local, provisional=true | throw `NO_MODEL` |
| grade.fill.llm | local | local | throw `NO_MODEL` |

**Wave 0 的 stub**:每個需要 LLM 的功能自備 `FakeLlmRouter implements LlmRouter`,從 `contracts/fixtures/llm/` 讀預錄回應。這是各功能能單獨跑的關鍵。

**`opts.maxTokens`(軟約定,函式簽章)**:每個 task 的預設上限見 `packages/core/src/llm/token-limits.ts`
的 `TASK_MAX_TOKENS`(對照這裡的 7 個 `LlmTask`)。`call()` 沒收到 `opts.maxTokens` 時查這張表;
收到就覆蓋表格值。動機:adapter 原本寫死一個全域 1024,真的呼叫時回應被截斷——如果切斷點剛好切壞
JSON 才會被抓到,切在別的地方 JSON 可能仍合法,會靜默回傳一張少字的卡。截斷本身視為錯誤
(`OutputTruncatedError`,`packages/core/src/llm/errors.ts`),不回傳半截 text。

## 8. 依賴圖

檔案:`graph/deps.json`,型別 `Record<CategoryId, Graph>`;`graph/order-<category>.json` 為 `CardId[]`

```ts
interface Graph {
  nodes: CardId[];
  edges: [CardId, CardId][];   // [先備, 後學]
}
```

## 9. 週目標

檔案:`state/weekly.json`

```ts
interface Weekly {
  week: IsoWeek;
  target: number;        // 正整數
  learned: number;
  passed_d1: number;
  counted: CardId[];     // 本週已計入的,避免重複計
}
```

## 10. 事件記錄

檔案:`state/log.jsonl`,每行一個 JSON

```ts
type EventType =
  | 'learned' | 'reviewed' | 'ingested' | 'linted' | 'llm_call'
  | 'deepened' | 'reteach_queued' | 'reteach_viewed' | 'week_rolled'
  | 'regenerate' | 'cycle_removed' | 'provisional_resolved' | 'warning';

interface LogEvent {
  ts: string;            // ISO 8601 含時區
  type: EventType;
  card?: CardId;
  [k: string]: unknown;  // 各事件自己的額外欄位
}
```

## 11. 設定

`config/categories.yaml`:

```ts
interface Category { id: CategoryId; name: string; require_raw: boolean; }
```

`config/settings.yaml`:

```ts
interface Settings {
  daily_cap: number;          // 預設 10,必須 > 0
  weekly_target: number;      // 預設 7,正整數
  short_body_limit: number;   // 預設 50
  llm: { cloud_provider: 'anthropic' | 'openai'; cloud_model: string; local_model: string; };
}
```

環境變數 `LLM_CLOUD_PROVIDER` `LLM_CLOUD_MODEL` `LLM_LOCAL_MODEL` 覆蓋 `settings.llm`。

## 11b. 寫入保證(硬約定)

`state/` 底下的檔案是幾個月累積的記憶資料,寫壞一次就沒了。所有對 `state/` 的寫入必須:

1. 寫到同目錄的 `<name>.tmp`
2. `fsync(fd)` —— 檔案內容落地
3. `rename` 到目標(同檔案系統上的 rename 是原子的)
4. `fsync(目標所在的目錄)` —— 讓 rename 這個**目錄項**的變更本身也落地。少了這一步,
   斷電時可能內容已經落地、rename 卻還留在目錄的 page cache 裡沒寫出去,整個 rename 丟掉。

暫存檔名固定是 `<name>.tmp`。這是單一程序的桌面程式,不需要隨機後綴。

**任何一步失敗,都要先刪掉 `<name>.tmp`、再把錯誤丟出去**,不留殘檔。清理本身失敗
(tmp 已經不在、目錄唯讀……)時**不可以遮蔽原本那個錯誤**:呼叫端要看到的是「為什麼
寫失敗」,不是「為什麼清不掉」。

第 4 步只有一個例外:目錄 `fsync` 回 **`EINVAL`** 時視為成功(tmpfs 與部分 CI 的檔案
系統不支援對目錄 fsync,那不是資料完整性問題)。**其他任何錯誤碼一律往外丟,不吞。**

`log.jsonl` 例外:它是 append-only,直接 append 即可,但每次寫入必須是完整的一行。

另外,`learning/` 建議是一個 git repo。`state/` 的變更每天自動 commit 一次
(由 `scripts/snapshot.ts` 做,或你自己排程),這樣任何損毀都可以回溯。

## 12. 目錄結構

```
learning/
├── raw/<category>/           唯讀
├── cards/<category>/
├── questions/
├── assets/
├── state/                    reviews.json weekly.json log.jsonl
│                             ingested.json needs-review.json provisional-queue.json
├── graph/                    deps.json order-<category>.json
└── config/                   categories.yaml settings.yaml vault-id
```

**`learning/` 的位置與帳本身分(1.4.0,ADR-066)**

- `learning/` 的位置**不由程式碼所在的簽出決定**(舊做法:`git rev-parse --git-common-dir` 的上一層;它在 worktree 之間算出同一個位置、
  在 clone 之間算出不同的位置,於是一台機器上有多本帳本、多個各自的 `LLM_DAILY_CAP_USD`),而是由**使用者層的指標檔**決定:
  `${XDG_CONFIG_HOME:-~/.config}/llm-learning-cards/vault.json`,內容 `{ "learning_dir": "<絕對路徑>", "vault_id": "<uuid>" }`。
  `XDG_CONFIG_HOME` 為空字串視同未設。其他作業系統的位置在 phase-4/5 決定。
- **帳本身分標記** `learning/config/vault-id`:內容是同一個 uuid(逐字相等,容許且只容許一個結尾換行)。不是隱藏檔——使用者要看得到,
  而且 §13 不放行以 `.` 開頭的段。
- **任何會花錢、或判斷花了多少錢的程式**(LLM 呼叫、日上限、花費報告)的帳本解析:先看明確參數可不可以(見下),再看指標檔;
  指標檔不存在、讀不到、`learning_dir` 不存在、標記不符,**四種一律拒絕**,不退回任何預設位置,錯誤訊息要寫出
  `npx tsx scripts/vault.ts init` 與 `show`。
- **花錢的帳本只能是驗證過的那一本。** 明確參數(`--out`、`learningDir`)可以改**輸出**位置,**不能改帳本位置**:真的會花錢的呼叫
  只接受經指標檔與標記驗證過的帳本;未驗證的帳本只准給假的 adapter。
- 身分驗證過的帳本,`state/log.jsonl` 不存在 = 全新安裝 = 今日花費 0,這是合法的。**身分沒驗證過時,花費是「不知道」,不是 0。**
- `vault-id` 由 `scripts/vault.ts init` 建立。沒有它的 `learning/` 不能被當成帳本;不涉及花費的讀取(lint、複習)不受影響。
- 既有硬約定不變:`raw/<category>/` 唯讀、單一帳本不加總(ADR-051 的後半仍然成立;被取代的是它「用 git 位置解析」的那一半)。

專案根目錄另有 `standalone.json`,列出每個功能的單獨執行指令:

```ts
type StandaloneManifest = Record<string, {
  cmd: string;          // 可直接執行的指令
  interactive: boolean; // true 表示是 dev server 之類,無法自動驗
  expect?: string;      // 預期輸出的關鍵字
}>;
```

## 13. 檔案存取(軟約定,見 ADR-062、ADR-063;其中段規則被 §1 引用,見下)

UI 不直接碰 fs。透過:

```ts
interface LearningFs {
  read(relPath: string): Promise<string>;
  write(relPath: string, content: string): Promise<void>;
  list(relDir: string): Promise<string[]>;
  exists(relPath: string): Promise<boolean>;
  assetUrl(relPath: string): string;
}
```

`relPath` 一律用正斜線,相對於 `learning/`。含 `..` 或絕對路徑必須拒絕。
Wave 0 的 UI 功能用 `MemoryFs implements LearningFs`(吃 fixture),整合時換成 Tauri 實作。

**路徑檢查(1.3.0 補,2026-10-01 的裁決)**

**一條原則:被檢查的字串必須和被使用的字串逐位元相同。** `LearningFs` 的邊界**不解碼、不轉換、
不修剪**:收到什麼就檢查什麼,通過了就原樣使用,沒通過就拒絕。

**檢查用白名單,不用黑名單。** 黑名單不完整的時候,失敗方向是放行;白名單不完整的時候,失敗方向是
拒絕。兩份 Wave 0 的 stub guard 是黑名單(擋 `..` 與開頭的 `/`),實測 16 個輸入全被放行(其中 14 個當時就判為該拒絕,另 2 個後來被 ADR-062 推翻改為拒絕)
(`features/10-desktop-shell/PATH-GUARD-EVIDENCE.md`)。

一個 `relPath` 通過,當且僅當:

1. 它是一個或多個**段**,用單一個 `/` 串起來(沒有開頭的 `/`、沒有結尾的 `/`、沒有 `//`);
2. 每一段非空,且**每個字元都屬於允許的字元集合**(見「字元集合與長度」);整個 `relPath` 必須**已經是 NFC**;
3. 沒有任何一段以 `.` 開頭(隱藏檔在多數工具裡對使用者、對列目錄、可能對備份都不可見,不該能被建在使用者的記憶資料裡;`.` 與 `..` 段是這條的特例,不需另寫);
4. 總長度不超過上限:**UTF-8 位元組數 ≤ 240**(見「字元集合與長度」)。
5. 沒有任何一段以 `.` **結尾**(Windows 會吃掉結尾的點,所以 `a.` 與 `a` 是同一個檔的兩種拼法;空白已不在字元集合,
   所以只需補點);
6. 沒有任何一段是 **Windows 保留裝置名**:段落在**第一個 `.` 之前**的部分,不分大小寫(固定 ASCII 對照),等於
   `CON`、`PRN`、`AUX`、`NUL`、`COM1`–`COM9`、`COM¹`–`COM³`、`LPT1`–`LPT9`、`LPT¹`–`LPT³`
   (`nul.md` 也算:Windows 對有沒有副檔名都當裝置;`console.md` 不算;**不含 `COM0` 與 `LPT0`**)。
   **這份清單已按 Microsoft Learn〈Naming Files, Paths, and Namespaces〉2024-08-28 版核實**(見 ADR-063)。
   `¹²³` 是 Unicode 類別 No,屬於允許的字元集合,所以**保留名這一層不是備援,是真的在擋** `COM¹.txt` 這類名字。
   依據是對反斜線用的同一個判準:路徑的意義取決於作業系統,就拒絕。平台是真的要做
   (`features/10-desktop-shell/FEATURE.md` 的 phase-4 macOS、phase-5 Windows;`tauri.conf.json` 的 bundle targets 是 `"all"`)。

不符合的一律拒絕。下面這些**不需要各寫一條規則**,它們被上面這幾條自動擋住:`.` 與 `..` 段、隱藏檔(第 3 條)、
絕對路徑與 UNC(第 1 條)、磁碟機代號與 `file:`(冒號不在字元集合)、`~`(不在字元集合)、
NUL 與其他控制字元(不在字元集合)、反斜線(不在字元集合,所以 `cards\a.md` 拒絕:`\` 在這個系統裡
從來不是分隔符,含它的路徑的意義取決於作業系統)、**百分號**(不在字元集合,見下)、前導空白
(空白不在字元集合,所以 `" ../x"` 拒絕)。

**不解碼。** 百分號編碼只存在於 URL 裡,而 `LearningFs` 收的是磁碟上的相對路徑,不是 URL。所以在這個邊界上
任何 `%XX` 要嘛是攻擊、要嘛是呼叫端搞錯了,兩種都拒絕:`%` 不在字元集合裡,不需要解碼就擋得住,
也不需要「解到不再變為止」那種要自己判斷終止條件的迴圈。
**asset protocol 的路徑是唯一的例外來源**:協定自己會解碼**恰好一次**(那是協定規定的,不是這裡選的);
解完之後把結果交給同一份白名單檢查,檢查之後使用的也是這個字串。雙重編碼因此自動被擋:
`..%252f..%252fetc` 解一次是 `..%2f..%2fetc`,仍含 `%`,拒絕。

**冗餘寫法也拒絕**:`"./cards/a.md"` 與 `"cards//a.md"` 含 `.` 段與空段,**拒絕**。邊界對每一個檔案只接受
一種拼法;兩種拼法指向同一個檔,就表示有一個轉換存在,而每個轉換都是「檢查的字串」與「使用的字串」
可以分岔的地方。呼叫端串路徑時不要產生空段或 `.` 段(局部的一行修正,而且錯了會立刻被拒絕,不會靜默)。
(這推翻了 2026-10-01 稍早的個案裁決「正規化後允許」。**通則:一個結構性規則讓先前的個案裁決變得不一致時,
讓步的是個案,不是結構。** 個案裁決只對一個輸入給答案,結構性規則對所有輸入給答案;保留一個與結構衝突的
個案,等於在規則上開一個只有讀過當初那條裁決的人才知道的例外。)

**解碼只發生在 asset protocol 的 handler,不在 `LearningFs` 邊界。** 一個會解碼的層和一個不解碼的層之間要有
一條明確的線:協定的解碼(恰好一次)結束的地方,就是我們的檢查開始的地方。

**字元集合與長度(1.3.1,2026-10-14 技術顧問裁決,見 ADR-063)**

1. **字元集合**:每一段的每個字元必須是 ASCII 的 `A`–`Z`、`a`–`z`、`0`–`9`、`_`、`-`、`.`,
   或 Unicode 一般類別為 **L(字母)、N(數字)、M(組合記號)** 的字元。**整個 `relPath` 必須已經是 NFC;
   不是就拒絕,不轉換**(與百分號同一個處理方式:拒絕,不是修正)。
   - **為什麼是類別式、不是文字系統清單**:`ー`(U+30FC,片假名長音,「セキュリティー」會用到)的一般類別是 `Lm`(字母),
     但它的 Script 是 `Common`,「Han / Hiragana / Katakana / Hangul」四個文字系統的清單會把它擋掉;注音符號、
     帶重音的拉丁字母也一樣。類別式一句話講完,而且不用維護文字系統清單。
   - **為什麼允許大寫**:分類名就是使用者 `raw/` 資料夾的名字原樣(ingest 用 `raw/${category}` 與 `cards/<category>`,
     沒有轉小寫),`CategoryId`(§1,1.4.0 起套同一條段規則)允許大寫。只收小寫會讓 `raw/Security/` 這種分類整個被邊界擋掉。
   - **為什麼要 NFC**:同一個字可以有 NFC 與 NFD 兩種位元組表示(macOS 檔案系統存 NFD、Linux 存 NFC),
     在同一台 Linux 上寫測試兩種形式永遠不會同時出現,所以這個洞不會被明顯的測試抓到。只決定「允許中文」
     而不處理正規化形式,得到的是一個在 Linux 上全綠、在 macOS 上有洞的防護。
2. **長度**:整個 `relPath` 的 **UTF-8 位元組數 ≤ 240**。
3. **`raw/`**:`LearningFs` **不服務 `raw/`**,`read` 與 `write` 都拒絕。第一段以**固定 ASCII 不分大小寫**比對
   (只把 `A`–`Z` 摺成 `a`–`z`),**不用依語系變化的 `toLowerCase`**(例如土耳其語的 `I`)。

**已知限制(不是規則)**

- **不分大小寫的檔案系統上,同一個檔可能有兩種拼法**(`Sec` 與 `sec`)。這不會造成逃逸,只是重複;
  保護前綴 `raw` 已用 ASCII 不分大小寫比對,不受影響。
- **Windows 的 `MAX_PATH` 260 算的是絕對路徑**,含 `learning/` 根目錄,所以 240 位元組的上限**不保證任意根目錄**都放得下;
  Windows 階段(`features/10-desktop-shell/` 的 phase-5)要加根目錄長度檢查。
- **Rust 與 TypeScript 的 Unicode 版本可能不同**,同一個字元的類別或 NFC 結果可能不一致。
  **Rust 是權威,TypeScript 那一側只是提示,不是執行。**
- ~~§1 的 `CategoryId` 比這份白名單寬~~ —— **1.4.0 已解**(ADR-067):`CategoryId` 必須是本節的一個合法段(加 64 位元組上限),
  ingest 建分類前就拒絕。**反過來的耦合要記住:「一個 `relPath` 通過,當且僅當」清單的第 2、3、5、6 條(字元集合與 NFC、開頭的點、結尾的點、保留名)被 §1 引用,
  改這幾條 = 改 §1 的硬約定,要走 ADR 與使用者。**

**`raw/` 不服務。** `relPath` 的第一段(固定 ASCII 不分大小寫)等於 `raw` 時,**`LearningFs` 的五個方法
(`read`、`write`、`list`、`exists`、`assetUrl`)全部拒絕**(1.3.0 只拒絕 `write`,1.3.1 擴大,見上「字元集合與長度」
第 3 點)。這是執行既有的硬約定(§12 `raw/<category>/` 唯讀;`CLAUDE.md` 硬規則 2「不改 `raw/`,那是使用者的素材」),
不是修改它。在不分大小寫的檔案系統上 `Raw/x.md` 與 `raw/x.md` 是同一個檔,所以比對不依賴字元集合的結論。
為什麼不只拒絕 `read` 與 `write`:
1. `assetUrl` 是讀取路徑。它若不拒絕,webview 就能拿到 `raw/` 檔案的 URL 再載入,繞過「`read` 拒絕 `raw`」——
   這正是「全綠但有旁路」。
2. `exists` 與 `list` 會洩漏使用者素材存不存在、叫什麼名字。
`list` 本身要求至少一段,所以列根目錄時 `raw` 不會出現(根目錄本來就拒絕),但 `list("raw")` 要拒絕。

**`list(relDir)`**:`relDir` 用**同一份白名單**,**至少一段**,不開「空字串代表根」的例外(審查時查到
`.list(` 在 `apps`、`packages`、`scripts` 的非測試程式碼零呼叫,沒有人列根目錄;沒有使用者就不開例外。
以後真有人要列根,再加一個明確的單一例外並附向量)。
**`list` 的回傳要能往返**:回傳的每個名字接回 `relDir` 之後必須通過同一份檢查;**不通過的條目略過,不丟錯**。
理由:§11b 建議 `learning/` 是 git repo,根目錄會有 `.git`,只要有一個不合規的條目就丟錯,整個 `list` 就不能用。

**向量(1.3.0 補、1.3.1 擴充;輸入是字面字串(含引號),非 ASCII 字元以碼位標明;格子的轉義寫法見 `features/10-desktop-shell/phase-2.feature` 檔頭註解)**

| 操作 | 輸入 | 結果 | 依據 |
|---|---|---|---|
| `write` | `"raw/security/x.md"` | 拒絕 | `raw/` 不服務 |
| `read` | `"raw/security/x.md"`、`"Raw/security/x.md"` | 拒絕 | `raw/` 不服務;第一段固定 ASCII 不分大小寫 |
| `exists` | `"raw/security/x.md"` | 拒絕 | `raw/` 不服務(不洩漏素材存在與否) |
| `list` | `"raw"` | 拒絕 | `raw/` 不服務(不洩漏素材名字) |
| `assetUrl` | `"raw/security/x.md"` | 拒絕 | `raw/` 不服務(否則 webview 能繞過 `read`) |
| `read` | `"cards/a."` | 拒絕 | 第 5 條:段不得以 `.` 結尾 |
| `read` | `"cards/"` | 拒絕 | 第 1 條:沒有結尾的 `/` |
| `read` | `""`(空字串) | 拒絕 | 第 1、2 條:至少一段、每段非空 |
| `read` | `"nul.md"`、`"CON"`、`"cards/Aux.txt"`、`"com1.md"` | 拒絕 | 第 6 條:Windows 保留裝置名 |
| `read` | `"COM¹.txt"`(`COM` + U+00B9) | 拒絕 | 第 6 條:`¹` 屬 No,字元集合放行,保留名在擋 |
| `read` | `"com0.md"` | 通過 | 第 6 條:Microsoft 原文不含 `COM0` |
| `read` | `"cards/console.md"` | 通過(以字元集合為準) | 第 6 條只比第一個 `.` 之前的整段 |
| `read` | `"cards/가.md"`(U+AC00) | 通過 | 類別 Lo,已是 NFC |
| `read` | `"cards/가.md"`(U+1100 U+1161,Hangul Jamo 兩個碼位) | 拒絕 | 非 NFC(NFC 後是 U+AC00) |
| `read` | `"cards/豈.md"`(U+F900,相容漢字) | 拒絕 | 非 NFC(NFC 後是 U+8C48) |
| `read` | `"cards/é.md"`(U+00E9) | 通過 | 類別 Ll,已是 NFC |
| `read` | `"cards/é.md"`(U+0065 U+0301) | 拒絕 | 非 NFC(NFC 後是 U+00E9) |
| `read` | `"cards/Security.md"` | 通過 | 大寫在集合內 |
| `read` | `"cards/セキュリティー.md"`(結尾是 U+30FC `ー`) | 通過 | `ー` 類別 Lm |
| `read` | `"cards/C++.md"` | 拒絕 | `+` 不在集合(`CategoryId` 在 1.4.0 起也拒絕 `C++`,見 §1) |
| `list` | `""`(空字串) | 拒絕 | `relDir` 至少一段,不開根目錄例外 |
| `list` | 目錄含 `.hidden` 與 `ok.md` | 回傳 `["ok.md"]` | 回傳要能往返,不合規的略過不丟錯 |

**測試的要求**:拒絕測試必須包含一個對照 —— 把實作改成「先檢查、後轉換(解碼 / 換反斜線 / 修剪 / 摺疊斜線)」,
那些拒絕斷言要變紅。沒有它,一個先檢查後轉換的實作會讓所有餵「已轉換過的形式」的拒絕測試全綠。
`write` 對 `raw/`、結尾點、保留裝置名三條也各要有同樣的對照:**把那一條檢查拿掉,對應的場景必須變紅**,不紅就是測試在量別的東西。

**`LearningFs` 介面**目前在 06、07 各有一份 stub 宣告;10 phase-2 完成後,以真實作的形狀為準提升進
`packages/contracts`(見 `features/10-desktop-shell/NEXT.md`),在那之前本節的介面是文字描述。
