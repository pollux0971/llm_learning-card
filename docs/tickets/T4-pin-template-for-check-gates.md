# 工單 T4:`check:gates` 要量「我們聲稱的模板版本」,不是模板的活 HEAD

> 狀態:草稿,待技術顧問審。順序在 T0、T3 之後;比 T3 的 B2 小得多。
> 作者:統籌·契約。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。

## 起因與事實

`npm run check:gates`(`package.json` 第 24 行)是

```
"${TEMPLATE_DIR:-/data/python/dev-paradigm}/scripts/sync-gates.sh" "$(git rev-parse --show-toplevel)" scripts --check
```

預設對著 `/data/python/dev-paradigm` 的**活 HEAD**。上游 2026-09-19 的 commit `0d02c74` 讓 `sync-gates.sh`
開始要求 `.npx-init-manifest.json`,所以(技術顧問實測的 2×2):

| 我們的樹 | 模板 | 結果 |
|---|---|---|
| `e3bf2d9` | 活模板 | rc=1(`✗ .npx-init-manifest.json 不存在`) |
| `e3bf2d9` | v1.6.8 | rc=0(37 ✓、0 ✗) |
| `17dc78f` | 活模板 | rc=1 |
| `17dc78f` | v1.6.8 | rc=0 |

同一個 commit,只差模板是哪一份。**一個回答「我們的副本被改過沒」的檢查,因為模板自己新增需求而變紅。**
v1.6.8 就是我們檔頭 `SOURCE` 寫的版本。

統籌·契約補量(2026-10-01):
- `scripts/` 底下帶 `SOURCE` 標頭的檔共 **25** 個(14 個非測試、11 個 `.test.ts`),**版本全是 `template v1.6.8 (88a3e11)`**,
  沒有不一致。**數法是這張工單的陷阱**:技術顧問先後量到 24 與 25,兩個都錯,錯在不同地方,總數剛好湊對:
  - 24:用 `grep -h` 取版本,`check-known-defects.ts` 被 grep 當成二進位(`file` 回報 `data`)而整個被跳過。
  - 25(錯的 25):用 `grep -l` 找「檔內任何位置有那串字」,把第一行是 `/**`、那串字只出現在第 83 行正規表示式裡的
    `check-template-freshness.ts` 算了進去,同時漏掉 `check-known-defects.ts`。一進一出,總數仍是 25。
  - 正確標準(`sync-gates.sh` 判斷模板擁有的做法):**第一行**符合 `^(//|#) SOURCE: template v`,即 `head -1`。
  統籌·契約先前量到的 25 用的是 `git grep '^// SOURCE'`(行首錨定、任何一行),碰巧與正確結果相同,
  **不是正確標準**;以 `head -1` 為準。
- `v1.6.8` 是 annotated tag:`git rev-parse v1.6.8` 得到 tag 物件 `8047b77…`,`git rev-parse 'v1.6.8^{commit}'`
  才是 `88a3e11`(與 `SOURCE` 標頭一致)。**任何釘版本的比對要比 commit,不是 tag 物件。**
- 吃 `TEMPLATE_DIR` 的:`package.json` 的 `check:gates`(第 24 行)、`scripts/check-template-freshness.ts`
  (讀 `$TEMPLATE_DIR/VERSION`,沒設時回報「無法判斷」,刻意 report-only)、`scripts/zero-input-roster.ts`
  (為前者構造輸入的測試名冊)。`check:template-freshness` 在 `package.json` 第 25 行。

## 範圍:階段 A 只量;階段 B 不在範圍

階段 B(實際釘版本)牽涉「什麼時候升模板」的決定,那要技術顧問裁。

### A1 吃 TEMPLATE_DIR 的清單

列出所有吃 `TEMPLATE_DIR` 的 npm script 與守門(上面是起點,要用 `git grep` 重掃,報告寫掃法),
每個寫「**它拿模板的什麼**」。兩類要分開判,不要一刀切:

- `check:template-freshness`:**刻意比活的**。它的工作就是回報「落後多少」,不該釘。
- `check:gates`:問的是「我們的副本有沒有被改過」,該量**我們聲稱的版本**(`SOURCE` 標頭),不是活 HEAD。

### A2 `check:gates` 釘住的方式

對每個候選回答「失敗方向」——**模板 repo 沒有那個 tag(或該 commit)時是紅還是靜默通過?靜默通過的排除。**

- (a) 在本 repo 存一份 v1.6.8 的 archive(代價:一份模板擁有的檔的副本,本身會漂移,要有人維護)。
- (b) 執行時從模板 repo 用 `git archive`(或 `git worktree`)取 `SOURCE` 標頭寫的 commit,再跑 `sync-gates.sh --check`。
- (c) 其他(由量測者提出)。

每個候選要有**會紅的對照**:把 tag 指到不存在的東西,檢查要紅,不是綠。

### A3 `SOURCE` 標頭

1. **數標頭用 `head -1`**(第一行符合 `^(//|#) SOURCE: template v`),不要用 `grep -l` 掃全檔。
2. **要用 `grep` 的地方加 `-a`**,否則被當成二進位的檔(例如 `check-known-defects.ts`)會整個消失,而且不報錯。
   這一條本身要寫進報告:同一個「數檔案」的動作,不同寫法差一個檔,而且不報錯。
3. 標頭版本不一致時(例如 24 個 v1.6.8、1 個別的):釘哪一個?用哪個當「我們聲稱的版本」?
4. **誰擔保 25/25**:`sync-gates.sh --check` 自己對每個檔比 sha,那是擔保者;數字只是它的副產品。
   要不要另有一個守門檢查「所有標頭同版」,由報告提出選項,不裁。

### A4 報告

放 `docs/reviews/`,帶日期與 host。**只量,不改任何檔。**

## 限制(明確禁止項)

1. **不得修改 `scripts/check-all.ts`、`sync-gates.sh`、或任何帶 `SOURCE` 標頭的檔**——它們是模板擁有的
   (改了就是「我們的副本被改過」,正好是 `check:gates` 要抓的)。`package.json` 的 script 是我們自己的,可以改。
2. **不得動 `/data/python/dev-paradigm`**:那棵樹有未追蹤項目(`.orca-brief/` 等)、多個 session 在線。只讀。
   取 tag 內容用 `git archive` / 唯讀的 `git worktree` 到本機暫存路徑,**不 checkout、不改它的 index、不建 tag**。

## 上游提案(另一份交付物)

「`sync-gates.sh --check` 是『我們的副本被改過沒』的問題,不該因為模板自己新增需求而對舊版本的消費端變紅。」
要帶上面的 2×2 證據。**等 A 階段報告出來再送**,現在送只是抱怨。

## 驗收條件

1. A1 清單存在,每列有「拿模板的什麼」與「該釘還是該比活的」的判定,掃法可重現。
2. A2 每個候選有失敗方向與會紅的對照;沒有「靜默通過」的候選被採納。
3. A3 用 `head -1` 與 `grep -a` 重數一次並說明三種數法為何差一個檔;回答標頭不一致時的處理與「誰擔保」。
4. 2×2 在報告裡重現一次(同樣四格,附指令與輸出的關鍵一行,記 host 與日期)。
5. 報告沒有修改任何帶 `SOURCE` 標頭的檔,也沒有動 `/data/python/dev-paradigm`(用 `git status` 前後各一份證明)。

## 測試誰寫

階段 A 沒有程式。第 4 條的重現由審核 agent 獨立重量(不收轉述)。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,同一時間一個 agent。派工歸協調者。
