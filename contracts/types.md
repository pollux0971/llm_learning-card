# 契約:型別與檔案格式

> 版本:1.1.0
>
> **硬約定**(§2 §3 §4 §7 的 LlmTask 與路由表 §8 §9 §10 §11 §12):改動需 ADR。
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

1. 移除所有 example 圍欄
2. 逐字元掃描,把字元分成三類:
   - **CJK**:Unicode 區段 CJK Unified Ideographs、Hiragana、Katakana、Hangul
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

這個定義偏嚴(`same-origin` 算 2 而不是 1),但**明確**比**寬鬆**重要——
兩個獨立實作必須算出同一個數字。

上限 100。縮短版上限 50(`settings.short_body_limit`)。

**Example 圍欄**:以 ` ```example ` 開始、` ``` ` 結束。內容是巢狀 markdown(不是程式碼),渲染時遞迴處理。一張卡可有 0..n 個。

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
  call(task: LlmTask, prompt: string, opts?: { timeoutMs?: number }): Promise<LlmResult>;
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
2. `fsync`
3. `rename` 到目標(同檔案系統上的 rename 是原子的)

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
