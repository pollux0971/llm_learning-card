# 契約:型別與檔案格式

> 版本:1.3.0
>
> **硬約定**(§1 §2 §3 §4 §7 的 LlmTask 與路由表 §8 §9 §10 §11 §11b §12):改動需 ADR。
> (§1 與 §11b 於 1.2.0 補進索引,見 ADR-061;§2 的圍欄與 CJK 判定於 1.2.0 改寫,見 ADR-060。)
> **軟約定**(§5 §6 §7 的函式簽章 §13):改了跑測試、更新本文件、commit 說明理由即可。
> 分層理由見 `README.md`。

以下是所有**跨模組**的定義。模組內部型別不在此。

---

## 1. 識別碼與基本型別

```ts
type CardId = string;        // /^[a-z]{2,6}-\d{4}$/  例 "sec-0042"
type CategoryId = string;    // 非空,無路徑分隔符與空白
type IsoDate = string;       // "YYYY-MM-DD",一律當地日期,不含時間
type IsoWeek = string;       // "YYYY-Wnn"  例 "2026-W37"
type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type Level = number;         // 0..4
type Source = 'raw' | 'llm';
type QuestionType = 'fill' | 'apply';
```

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
  examples: string[];       // 每個 example 圍欄的原始內容
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
   - **其他**:空白、標點(P*)、符號(S*)
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
| `前` + 四反引號 example 圍欄(內含一個三反引號的內層圍欄與文字) + `後` | 2 | 圍欄語法:結束需同樣數量,內層三個不結束外層 |
| 三反引號 `js` 圍欄,內容 `ab` | 2 | 圍欄語法:不是 `example` 開始,不移除;`js`、`ab` 各 1,反引號是符號計 0 |

**尚未定義(不在 1.2.0 範圍,不要自行假設)**:未閉合的 example 圍欄怎麼算;開閉在同一行的圍欄怎麼算。
目前沒有任何向量涵蓋這兩種,實作之間是否一致只是巧合。要定義就是另一次硬約定的修改。

這個定義偏嚴(`same-origin` 算 2 而不是 1),但**明確**比**寬鬆**重要——
兩個獨立實作必須算出同一個數字。

上限 100。縮短版上限 50(`settings.short_body_limit`)。

**Example 圍欄**:以**三個以上**反引號加 `example` 開始,以**同樣數量**的反引號結束
(與 CommonMark 的圍欄規則一致)。所以內層含三反引號程式碼圍欄的內容,外層用四個反引號包。
只有以 `example` 標記開始的圍欄才是 example 圍欄;其他圍欄(如 ` ```js `)不移除,內容照算。內容是巢狀 markdown(不是程式碼),渲染時遞迴處理。一張卡可有 0..n 個。

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
└── config/                   categories.yaml settings.yaml
```

專案根目錄另有 `standalone.json`,列出每個功能的單獨執行指令:

```ts
type StandaloneManifest = Record<string, {
  cmd: string;          // 可直接執行的指令
  interactive: boolean; // true 表示是 dev server 之類,無法自動驗
  expect?: string;      // 預期輸出的關鍵字
}>;
```

## 13. 檔案存取(軟約定)

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
拒絕。兩份 Wave 0 的 stub guard 是黑名單(擋 `..` 與開頭的 `/`),實測 16 個輸入裡 14 個該拒絕的被放行
(`features/10-desktop-shell/PATH-GUARD-EVIDENCE.md`)。

一個 `relPath` 通過,當且僅當:

1. 它是一個或多個**段**,用單一個 `/` 串起來(沒有開頭的 `/`、沒有結尾的 `/`、沒有 `//`);
2. 每一段非空,且**每個字元都屬於允許的字元集合**(見下);
3. 沒有任何一段以 `.` 開頭(隱藏檔在多數工具裡對使用者、對列目錄、可能對備份都不可見,不該能被建在使用者的記憶資料裡;`.` 與 `..` 段是這條的特例,不需另寫);
4. 總長度不超過上限(上限的數字同樣由下面那一步推導,不在這裡憑印象裁)。

不符合的一律拒絕。下面這些**不需要各寫一條規則**,它們被上面四條自動擋住:`.` 與 `..` 段、隱藏檔(第 3 條)、
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

**字元集合與長度上限:本契約不憑印象裁定,由 10 phase-2 的工單推導後回填這裡。** 推導的輸入是
§1 的 `CardId`(`/^[a-z]{2,6}-\d{4}$/`)與 `CategoryId`(只寫「非空,無路徑分隔符與空白」,所以
**可能含中文**),加上實際掃過 `learning/` 與 `contracts/fixtures/` 底下現存的目錄名與檔名。
2026-10-01 統籌·契約的初步量測:`learning/` 只有一個分類 `security`;掃到的 97 個名字,字元全部落在
`[A-Za-z0-9]` 加 `-` 與 `.`。**這個樣本只有一個分類,不能代表會有中文分類名的使用者**,所以這不是結論,
只是推導的起點。回填時要寫「來源是 §1 加上 <日期> 實際掃過的內容」。
已裁決:段不得以 `.` 開頭(見第 3 條);**允許 `_`**(任何平台都不是路徑元字元,也不會造成「同一個檔有兩種
拼法」;現在量不到不代表以後用不到,排除它的代價是未來的一次契約修改)。
**若推導結果允許 CJK,這裡必須同時規定 Unicode 正規化形式**(建議 NFC),而且處理方式與百分號一致:
**不是把輸入正規化,而是拒絕任何不已經是那個形式的輸入**。同一個中文字可以有 NFC 與 NFD 兩種位元組表示
(macOS 檔案系統存 NFD、Linux 存 NFC),在同一台 Linux 上寫測試,兩種形式永遠不會同時出現,所以這個洞
不會被明顯的測試抓到。只決定「允許中文」而不處理正規化形式,得到的是一個在 Linux 上全綠、在 macOS 上有洞的防護。

**測試的要求**:拒絕測試必須包含一個對照 —— 把實作改成「先檢查、後轉換(解碼 / 換反斜線 / 修剪 / 摺疊斜線)」,
那些拒絕斷言要變紅。沒有它,一個先檢查後轉換的實作會讓所有餵「已轉換過的形式」的拒絕測試全綠。

**`LearningFs` 介面**目前在 06、07 各有一份 stub 宣告;10 phase-2 完成後,以真實作的形狀為準提升進
`packages/contracts`(見 `features/10-desktop-shell/NEXT.md`),在那之前本節的介面是文字描述。
