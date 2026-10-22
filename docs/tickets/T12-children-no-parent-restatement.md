---
id: T12
deps: [T11]
touches: [packages/core/prompts/ingest/children.md, packages/core/prompts/ingest/regenerate.md, packages/core/src/prompt-quality/parent-child-overlap.ts, packages/core/src/prompt-quality/cli.ts, packages/core/src/prompt-quality/types.ts, packages/core/src/prompt-quality/index.ts]
cpu: light
budget_usd: 1
status: merged
owner: worker-grok
must_catch:
  - 機器指標的門檻被放寬(PARENT_CHILD_OVERLAP_THRESHOLD 離開 0.3、「>=」改成「>」)
  - 重疊計算只比標題、不比內文(body 逐字照抄父卡仍然 0 對)
  - 分母取錯:只除以子卡的 gram 數,或取兩邊較多的那個(子卡只截父卡一小段、或子卡把整張父卡包進去再加料時抓不到)
  - 把子卡與子卡、父卡與父卡也拿來比(同層重複是 checkDuplicates 的事,這裡會誤報)
  - example 圍欄的內容參與比對(只有圍欄裡的字相同就被判重述)
  - --overlap 的退出碼永遠是 0,或空目錄、key 對不起來時回「0 對」而不是錯誤
  - 為了抓顧問人判的那一對(預檢快取時間)把門檻往下調——基準上同一個門檻會多抓 6 對人判沒問題的
  - 改 prompt 卻沒有跑 golden run、或用有未提交修改的 prompt 把結果寫進 golden/(T11 的拒絕規則會擋,不要繞)
---

# 工單 T12:子卡不得重述父卡、regenerate 一卡一概念

> 狀態:草稿,待技術顧問審(派令與「怎樣才算改善」來自顧問 2026-10-15,原樣抄在下面的驗收條件)。
> 作者:統籌·契約(測試 agent 身分寫紅測試)。派工:協調者(I2 整合驗收通過後才派)。驗收:-ed。評分:顧問。
> 這份檔是工單唯一的正本。**改的是 `prompts/`,屬硬規則 4:每一輪都要跑 golden run。**

## 起因

12-prompt-quality/phase-2 的第一次真模型基準(`golden/<set>/2026-10-15/`,報告 `docs/reviews/12-phase-2-live-baseline-2026-10-15.md`)顧問逐份評分後,最低的兩項:

- **父卡與子卡內容重複**:`ingest.children` 的 cors 與 preflight 都是「一個概念」4 分(preflight 的「預檢快取時間」和父卡「預檢結果快取」重複;cors 的「來源的組成」是前置知識、不是子概念)。
  I1-REVIEW 第 8 節講的是同一個問題。
- **regenerate 一張卡塞好幾個概念**:`ingest.regenerate` 的 same-origin、cors 都是 3 分(定義加理由加規則塞在一起)。

對象檔:`packages/core/prompts/ingest/children.md`,必要時 `regenerate.md`(`cards.md` 只有在需要時才動,見下面「對照組」)。
`features/12-prompt-quality/NEXT.md` 寫的「下一張工單」就是這一張。

## 怎樣才算改善(顧問定的,原樣)

1. `children` 與 `regenerate` 兩組,**3 個輸入的「是一個概念嗎」分數都要 ≥ 4**——由**顧問重新評分**,不是機器分數。
2. **子卡重述父卡的對數 = 0**——由**顧問判**;另外照 ADR-043,用機器指標抓**字面上的重複**,加一條結構檢查當紅測試(下面「機器指標」)。
3. **正確性維持 5**。
4. `cards`、`questions`、`deps` 三組 `--diff` 只能有**雜訊等級**的差異(做法見「對照組」)。
5. 預算:每輪 golden run 約 $0.04,**最多三輪**。三輪還不達標就停,回報顧問,不要為了湊分數放寬任何一條。

## 機器指標(紅測試已寫好)

ADR-043 的結論要先看:**機器抓字面、語意重複歸人打分**。我在 2026-10-15 基準上量過,結論一樣:

| 指標(同一批 33 個「父 × 子」對) | 顧問人判「重述」的那一對 | 人判沒問題的最高 | 比它高的對數 |
|---|---|---|---|
| 3-gram Jaccard(`checkDuplicates` 用的) | 0.027 | 0.053 | 7 |
| 3-gram 子卡包含率 | 0.041 | 0.095 | 7 |
| 2-gram 包含率 | 0.061 | 0.186 | 16 |
| 標題 2-gram Jaccard | 0.250 | 0.333 | 1 |
| **3-gram 重疊係數(採用)** | **0.074** | **0.150** | **6** |

沒有任何字面指標分得開那一對。所以**這條機器指標不是要抓它,而是「逐字照抄」的回歸網**:改 prompt 之後如果子卡開始整句抄父卡,它會紅。
改寫式的重述(那一對就是)**仍然歸顧問評分**——這條寫進工單,不要有人看到「0 對」就以為語意重複解決了(同 ADR-043 的 Consequences 3)。

**採用的指標:重疊係數** `|A∩B| / min(|A|,|B|)`,A、B 是 body 的字元 3-gram 集合(`normalizeBody`:移除 example 圍欄、NFKC、小寫、去空白、保留標點;n-gram 大小與 `checkDuplicates` 同一個 `DUPLICATE_NGRAM_SIZE`)。
理由:Jaccard 在兩邊長度差很多時很低(子卡只截父卡一小段,Jaccard 遠低於 0.6,重疊係數是 1);兩個方向都算(子卡把整張父卡包進去再加料也是重述)。
**門檻 `PARENT_CHILD_OVERLAP_THRESHOLD = 0.3`,`>=` 才算一對**,另外「標題正規化後相同且非空」也算(標題優先)。

**目前基準有幾對超過:0 對**(33 對,最高 0.150,是 same-origin 的第 3 張子卡對第 4 張父卡;門檻是它的 2 倍)。
這個門檻是量出來的、不是猜的:低於 0.15 就開始誤報人判沒問題的對,高於 0.3 太鬆(基準最高值的 2 倍以內的逐字照抄都會漏)。**要調,先寫理由、改常數、同步改測試,不要偷偷動。**

新增的東西(實作者照這個寫;細節與邊界在 `parent-child-overlap.test.ts` 檔頭):

| 項目 | 內容 |
|---|---|
| `packages/core/src/prompt-quality/parent-child-overlap.ts`(新檔) | `PARENT_CHILD_OVERLAP_THRESHOLD`、`PARENT_CHILD_NGRAM_SIZE`、`overlapCoefficient`、`checkParentChildOverlap`、`runParentChildChecks`、`checkGoldenParentChild`;`index.ts` 匯出 |
| `types.ts` | `StructuralIssueKind` 加 `'parent-child-overlap'` |
| `cli.ts` | `prompt-check.ts --overlap <children run 目錄> <parents run 目錄> [--threshold <0..1>]`;0 對 → 退出碼 0,有 → 1;錯誤(路徑、配不起來、`--threshold` 不合法)→ 1 並講原因 |

**怎麼用(每一輪)**:`children` 的 run 目錄對 **`ingest.cards` 的 run 目錄**(父卡 = 同一個輸入的 cards 輸出,例如 `children-cors` ↔ `cards-cors`)。
`cards.md` 沒被改的時候,父卡用基準的 `golden/ingest.cards/2026-10-15/`(固定不動),不用再跑一次 cards。
`regenerate` 沒有父卡,**機器指標不適用**,它只看顧問的「一個概念」與 `--diff`。

## 流程與分工(誰跑什麼)

| 誰 | 做什麼 | 不做什麼 |
|---|---|---|
| 開發 worker(grok) | 改 `prompts/ingest/children.md`(必要時 `regenerate.md`)、寫 `parent-child-overlap.ts` 與 `cli.ts` 的 `--overlap`、跑 `--fake`(`--golden --set <id> --fake`)與測試 | **不跑 `--live`**(它的簽出沒有憑證)、不改測試、不動 `contracts/` |
| 協調者 | 在**主簽出**跑真呼叫:`npx tsx scripts/prompt-check.ts --golden --set ingest.children --live --out <暫存目錄>`(`regenerate` 同);**跑前跑後各記 `llm-spend --today`**(日上限 $1);跑 `--overlap` 與 `--diff`,把結果交顧問 | 不評分 |
| 顧問 | 看輸出、評「一個概念」與正確性、判「重述對數」 | |
| 不達標 | 退回開發 worker 再改,**最多三輪** | |

**`--out` 一律指到 `golden/` 以外**:prompt 還沒 commit 的時候(worker 改的 `children.md` 是 dirty),T11 的規則會拒絕寫進 `golden/`(那是回歸基準,必須能用某個 commit 的 prompt 重現)。
同一天寫進 `golden/<set>/2026-10-15` 也會覆蓋剛 commit 的基準。**最後一輪達標之後**,prompt 先 commit,再用乾淨的 prompt 跑一次寫進 `golden/`(日期若與基準同一天,基準仍可從 `63e4dc6` 與
`packages/core/src/prompt-quality/fixtures/golden-2026-10-15/` 取回)。這就是 `deps: [T11]` 的原因:沒有 T11,dirty 的 prompt 會被記成乾淨的 commit。

### 對照組(驗收條件 4 的做法)

`--diff` 只標「不同」,而模型本來就有隨機性,所以「雜訊等級」要有一個尺:

- **只改 `children.md` / `regenerate.md`**(預期的情況):`cards`、`questions`、`deps` 三組的 prompt **沒有被動到**,它們的輸出不會因為這張工單而變,**不需要重跑、條件 4 自動成立**。
  (`questions` 與 `deps` 讀的是 cards 的輸出,不讀 children 的輸出。)
- **如果必須動 `cards.md`**(例如「同層 L0 卡」要在 cards 這一邊才擋得住):先**用沒改的 `cards.md` 再跑一次 `ingest.cards`**(約 $0.025)當對照組,
  量出「同一個好 prompt 跑兩次的 `--diff`」有多大,再拿改過的跟基準比;差異不超過對照組的範圍才算雜訊。改了 `cards.md` 就一併重跑 `questions`、`deps`(它們的輸入是 cards 的輸出)。

## 不在範圍

- 不改 `contracts/`。不把機器指標放寬去抓改寫式的重述。不加第三個人打的分數維度(ADR-043 Consequences 2)。
- 不動 golden 基準檔本身(`golden/*/2026-10-15/` 是 git 歷史的一部分);我放進 `fixtures/golden-2026-10-15/` 的是它們的複本。
- 「同層 L0 卡」的重複(子卡與別張 L0 卡重複):機器指標的函式接受任意的「父」清單,所以**可以**把同層 L0 卡也當父卡傳進去,但這一輪的基準與測試只有「對自己的父卡」。要擴到同層,先量基準再訂門檻,不是這張工單。

## 驗收條件

1. `tsc` 0 錯;`packages/core/src/prompt-quality` 全部測試綠(基準前 258 條 + 新的 44 條);`npm run boundaries`、`lint:docs` PASS。
2. 紅測試(`parent-child-overlap.test.ts`、`parent-child-cli.test.ts`)轉綠,且**測試檔與 `fixtures/golden-2026-10-15/` 一個字都沒改**。
3. 每一輪:`--overlap <children run> <cards 基準或對照的 run>` 的退出碼 0(「重疊 0 對」),顧問評分達到上面條件 1–3,條件 4 依「對照組」。
4. 最後一輪達標後,prompt 已 commit,golden run 寫進 `golden/`,`SCORES.md` 填好;花費每輪記錄、總數不超過 3 輪。
5. 不跑 `--live`(worker);主簽出的 `--live` 只由協調者跑,每輪前後各記 `llm-spend --today`;真的 `learning/` 前後不變(基準 **64 個檔 / `c5aa80b18b474ed4` / 帳本 52 行 +該輪的 llm_call 行**——帳本會因為 golden run 增加,只准在尾端追加,不准有行被刪或改)。

## 測試誰寫(已寫好,分支 `t12`)

- `packages/core/src/prompt-quality/parent-child-overlap.test.ts`(35 條):常數、`overlapCoefficient`、門檻邊界(剛好 0.3 / 3/11 差一格 / `opts.threshold` / `opts.ngramSize`)、
  比內文不只比標題、長度差很多的包含(重疊係數 1 而 Jaccard < 0.6)、反方向、標題規則(正規化、標題優先、空標題、只有一字相同)、只比父 × 子、body 正規化、
  `runParentChildChecks`、**基準 2026-10-15 的 0 對與最高值 0.150**、**已知限制(0.074 的那一對不會被報,門檻降到 0.074 會多抓 6 對誤報)**、目錄載入與錯誤。
- `packages/core/src/prompt-quality/parent-child-cli.test.ts`(9 條):`--overlap` 的退出碼與輸出。
- `fixtures/golden-2026-10-15/`:基準的 `ingest.children` 與 `ingest.cards`(各 3 個輸出 + `meta.json`)的原檔複本;sha256 在 commit 說明。

在 base 上:`tsc` 0 錯;44 條全紅(原因:`parent-child-overlap.ts` 與 `--overlap` 還沒有)。**沒有本來就綠的。**
丟棄式實作(約 70 行,**不進 git**,已刪)讓 `prompt-quality` 資料夾 302 條全綠(測試誤差我自己修過:重疊係數的分母是兩邊較少的那個,邊界案例要兩邊 gram 數相同);
16 條突變(`>=` 變 `>`、門檻 0.5、門檻 0.2、分母取第一邊、分母取大、只比標題、空標題算相同、不剝圍欄與空白、reason 一律 body、子×子也比、缺父不報、空目錄不報、CLI 永遠 0、
最高值算錯、rate 分母錯、空集合算 1)**全部變紅**。

- 開發 agent(worker-grok):`prompts/` 的修改、`parent-child-overlap.ts`、`cli.ts`、`types.ts`、`index.ts`。**不改測試**,不跑變異測試,不跑 `--live`。
- 驗收(-ed):照 `worker-acceptance`;`parent-child-overlap.ts` 是新的小函式,變異門檻沿用 `prompt-quality` 現行設定;`must_catch` 逐條做突變。

## 預算

`budget_usd: 1`(開發 worker 的草估,無 $ 上限只記錄)。**另外**:真呼叫每輪約 $0.04,最多三輪,由協調者在主簽出跑,日上限 $1。
