---
id: T6
deps: [T7]
touches: [packages/contracts/src/index.ts, packages/core/src/schema/, packages/core/src/ingest/, packages/core/src/lint/, scripts/ingest.ts]   # scripts/ingest.ts 是修補輪(缺陷 T6-A)補的
cpu: light                             # 驗收階段跑變異是重活:協調者排驗收時照 R3 當 heavy 算
budget_usd: 5                          # 草估,統籌·契約填
status: merged
owner: worker-grok
must_catch:
  - 放行 `C++`
  - 放行非 NFC(U+1100 U+1161、U+F900、e + U+0301)
  - 放行結尾的點(`a.`)
  - 放行開頭的點(`.hidden`)
  - 放行 Windows 保留名(`nul`、`COM9`、`COM¹`)
  - 放行 65 位元組的分類名(用多位元組字元湊的那一列)
  - ingest 拒絕分類之後仍然建出資料夾或檔案
  - lint 沒回報既有資料裡不合法的分類
  - schema 只擋卡片 frontmatter 的 category、不擋 categories.yaml 的 id(或反過來)
  - 測試複製了向量常數、沒有真的載入向量檔
---

# 工單 T6:`CategoryId` 收窄成 §13 的一個合法段

> 狀態:草稿,待技術顧問審。
> 作者:統籌·契約。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 裁決來源:技術顧問 2026-10-15;使用者 2026-10-15 在顧問 session 批准「§1 收窄 A」(依顧問轉述)。契約 §1 因此升版,見 ADR-067。

## 起因與事實

ADR-063 記下一個沒解決的問題:§1 的 `CategoryId` 比 §13 的路徑白名單寬,ingest 可以建出邊界讀不了的分類(例如 `C++`)。
契約 1.4.0 把它收窄成「§13 的一個合法段,且 UTF-8 位元組 ≤ 64」。**本張把 TypeScript 這一側做到跟契約一致。**

量測(2026-10-15,統籌·契約,只量數量不記名字):真實 `learning/` 的 `cards/` 與 `raw/` 底下各有同一個分類
(共 2 個資料夾、1 個分類),用向量檔的規則檢查,不合法 0 個。**不需要搬資料。**

## 契約文字(1.4.0,已在契約分支)

```ts
type CategoryId = string;    // 必須是 §13 的一個合法段,且 UTF-8 位元組 ≤ 64
```

合法段的全文在 §13(字元集合、已是 NFC、不以 `.` 開頭或結尾、第一個 `.` 之前不是 Windows 保留裝置名;非空、無 `/`)。
**Rust 是權威**(邊界在 Rust command);TS 這份是同一規則的第二份實作,兩份載入同一個向量檔
`contracts/fixtures/path-segment-vectors.json`(51 列,真碼位,每列附 `applies_to`、`rule`、`why`)。

## 範圍

三個執行的地方(顧問原文):

1. **01 的 zod schema**:卡片 frontmatter 的 `category`、`categories.yaml` 的 `id`。
2. **ingest 建分類時**:raw 資料夾名不合法就拒絕。**錯誤要說是哪一條規則(用向量檔的 `rule` 名),不建出任何東西。**
3. **09 lint**:回報既有資料裡的違規。

共用一個驗證函式(放在 01 的 schema 底下,02 與 09 引用它):輸入字串,回傳成功,或失敗加上 `rule` 名。
**開工第一步先查**:`git grep -n "CategoryId" -- packages` 的清單(哪些地方用到這個型別),以及 `scripts/boundaries.allow.json`
是否已允許 02→01、09→01 的引用;**不憑本稿**,查完回報。

## 不在範圍

- **Rust 那一側**(`LearningFs` 邊界載同一份向量檔):屬於 10 phase-2 的後續工單(T2c),本張不動 Rust。審 T2c 時要確認它載的是同一個檔。
- `LearningFs` 介面提升進 `packages/contracts`(`features/10-desktop-shell/NEXT.md` 已登記 owner,phase-2 完成之後)。
- 搬資料:0 個不合法,沒有資料要搬。使用者的 `raw/` 資料夾從不被改(CLAUDE.md 硬規則 2)。

## 前置

- 契約 1.4.0(§1、§12)與 ADR-067 在 main。**測試 agent 要等它進 main 才開始。**
- **T7 已合併**(把 `schema/atomic-write.ts` 與 `ingest/state.ts` 的 §11b 實作統一成一份):兩張都動 `schema/` 與 `ingest/`,
  R2 不能並行。

## 驗收條件

1. **向量檔是真的被載入**:測試在執行時讀 `contracts/fixtures/path-segment-vectors.json` 本身,對**每一列**呼叫驗證函式,斷言結果等於 `expect`。
   **用 `applies_to` 選列**:對 `applies_to` 含 `category` 的每一列斷言 `expect`(長度那四列只適用於 `category`;對 §13 的路徑段,65 位元組是合法的)。
   不得用 `rule` 欄分,也不得把向量複製成測試裡的常數。另加一個測試:檔案裡出現過的每一個 `rule` 值(`charset`、`nfc`、`leading-dot`、`trailing-dot`、
   `reserved`、`empty`、`separator`、`length`),都至少有一列被跑到(防止某類向量被刪光而沒人發現)。
   對照:把驗證函式改成放行 `C++`,該測試必須變紅。
2. **schema**:卡片 frontmatter 的 `category` 與 `categories.yaml` 的 `id` 兩處都用同一個驗證函式;不合法時的錯誤訊息含 `rule` 名。
   兩處各有一個測試(缺一處,`must_catch` 的對應條目就沒人抓)。
3. **ingest 拒絕**:對 `raw/<不合法>/x.md` 的輸入,ingest 拒絕、退出碼非 0、訊息含 `rule` 名與資料夾名,而且**整個輸出目錄列檔前後相等**
   (不建 `cards/<cat>/`、`questions/`、`state/` 的任何條目;`needs-review`、`ingested` 也不寫)。
   至少涵蓋:`C++`(charset)、NFD 的 `가`(nfc)、`a.`(trailing-dot)、`nul`(reserved)、65 位元組(length)。
   正向對照:同一個測試檔裡,合法的 `Security` 與 `セキュリティー`(結尾 U+30FC)照常 ingest(沒有誤殺)。
4. **lint**:對含不合法分類的資料目錄,`lint` 回報每一個違規(分類名、出現在哪個路徑、`rule` 名),計入問題數;
   對 `contracts/fixtures/learning-minimal/` 仍然回報 0 個問題。
   fixture:**新增** `contracts/fixtures/learning-broken-category/`(附 `EXPECTED.md`,每個問題一行,同 `learning-broken/` 的慣例),
   **不改**既有的 `learning-broken/`(改既有 fixture 要 ADR,因為別人的測試靠它)。
5. **真實資料的比對**:對真的 `learning/` 跑 lint(唯讀),新增的違規數為 0;報告寫**數字**(分類數、違規數),不寫名字。
6. 報告記 host、worker 數、1/5/15 分 load。報告**不得含**使用者資料:不貼 `learning/` 與 `raw/` 的檔名、分類名與內容。

## 變異

驗證函式屬於「驗證器 / 路徑防護」這一類,CLAUDE.md 列為嚴格級,門檻 **95%**(顧問若認為這個小函式不適用,請改);
存活者逐條分類,不得以「等價」帶過而沒有論證。`must_catch`(檔頭)每一條要有一個**具名測試**,報告列「條目 → 測試名」。

## 測試誰寫

- 測試 agent:紅測試(上面 1–4),**等契約 1.4.0 與 T7 進 main 才開始**;新 fixture 與 `EXPECTED.md` 也是測試 agent 寫。
- 審核 agent:變異、第 1 條的對照、第 5 條。
- 開發 agent:只寫實作,不改測試。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,同一時間一個 agent。派工歸協調者。
