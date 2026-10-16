---
id: T26
deps: []
touches: [packages/core/src/session/io.ts, packages/core/src/session/answer.ts, packages/core/src/session/build.ts, packages/core/src/session/types.ts, scripts/review.ts]
cpu: light
budget_usd: 1
status: todo
owner: worker-grok
must_catch:
  - 載入 `reviews.json` 之後、寫回之前,別的地方改過它(內容的雜湊變了),`submitAnswer` 仍然寫入並蓋掉別人的改動(現況)
  - 偵測到被改過時寫了一半、寫了暫存檔沒清、或把 session 的計數(passed/failed/queue)往前走了一步,卻沒寫進磁碟
  - 偵測到被改過時錯誤訊息不是「複習紀錄剛被別的地方改過,請重新開始今天的複習」,或沒有穩定的 `code`(`reviews-changed`)讓側車對應
  - 自己剛寫的那一次也被當成「別人改的」(第二題起每題都失敗):每次成功寫入後 session 的基準雜湊沒有更新
  - 檔案不存在(第一次複習前)的情況沒有處理:不存在要有固定的基準值,別人在這期間建了檔也要偵測到
  - 用鎖檔、改 `reviews.json` 的格式或欄位、在 `learning/` 底下新增任何檔案(§12 硬約定);或寫入沒走 `writeFileAtomic`
  - 放寬或刪掉 T17 與 session 既有測試的斷言;或 `saveReviews` / `loadReviews` 既有簽章與行為被改(其他呼叫端與測試依賴)
  - 終端機在偵測到被改過時仍印小結、仍做 snapshot、或退出碼是 0
  - 重建 session 的兩個地方只有一個記了基準雜湊(`buildTodaySession` 與 `scripts/review.ts` 的 `sessionFromCache`)
---

# 工單 T26:寫 `reviews.json` 之前先確認它沒被別人改過(樂觀檢查,不加鎖)

> 狀態:草稿,待技術顧問審(派令來自顧問,經協調者 2026-10-16)。**T24 依賴這張**(桌面側車與終端機會同時存在,見 ADR-075)。
> 作者:統籌·契約(規格)。紅測試:前端。開發:worker-grok。派工:協調者。
> 這份檔是工單唯一的正本。**不改 `contracts/`(`state/` 檔案格式不變,§12)、不改 `prompts/`、不需要 ADR。**

## 起因與查證

`reviews.json` 是幾個月累積的記憶資料(CLAUDE.md 硬規則 5)。ADR-075 之後,同一份 `learning/` 可能同時有兩個 Node 寫者:終端機的 `scripts/review.ts` 與桌面側車。

現況(我讀過):

- 唯一寫入點:`session/answer.ts` 的 `submitAnswer`,一張卡全部答完時 `loadReviews(learningDir)` → 算轉移 → `saveReviews(learningDir, reviews)`(整份覆寫,`answer.ts:132-147`;`saveReviews` 走 `writeFileAtomic`,`io.ts:53`)。其他地方只讀(`build.ts:94`、`scripts/review.ts` 的 `loadReviews`)。
- **session 活得比一次讀寫久**:`buildTodaySession` 在一開始讀 reviews 算出今天的題目;使用者可能花幾十分鐘答題。這段時間另一個行程若寫了 `reviews.json`(同一張卡被另一邊答掉,或別張卡的紀錄),我們靠 `answer.ts` 在最後那一刻重讀的那幾毫秒看不見「session 開始之後有人動過」,可能把同一張卡的轉移算兩次,或根據過時的 queue 繼續問。
- 顧問裁決:**靜默遺失一筆複習結果,機率低也不行。** 不接受「不加鎖、可能丟一次更新」;也不放鎖檔(放在 `learning/state/` 下要改 §12 硬約定)。改成**樂觀檢查**:寫之前重讀、比對雜湊,不一致就不寫並回清楚的錯誤。

## 要求

1. **雜湊的定義**:`state/reviews.json` **原始位元組**的 SHA-256(十六進位小寫)。檔案不存在 → 固定基準值字串 `'absent'`(不是空檔的雜湊;別人在這期間建了檔必須看得出來)。
2. **`io.ts` 加一個讀取函式**(新增,**不改** `loadReviews`/`saveReviews` 的簽章與行為):`readReviewsSnapshot(learningDir): { reviews: Record<CardId, Review>; hash: string }`,一次讀檔、同一份位元組既解析(同 `loadReviews` 的 `ReviewSchema.parse` 規則)又算雜湊。再加 `saveReviewsIfUnchanged(learningDir, reviews, expectedHash): string`:
   - 寫之前**再讀一次**磁碟上的 `reviews.json`、算雜湊;與 `expectedHash` 不同 → **什麼都不寫**(不建暫存檔)、丟 `ReviewsChangedError`;
   - 相同 → 照 `saveReviews` 的格式(`JSON.stringify(reviews, null, 2) + '\n'`)用 `writeFileAtomic` 寫入,回傳**剛寫進去的位元組的雜湊**(呼叫端當下一次的基準)。
   - `ReviewsChangedError`(新增,匯出):`message` 固定為 **`複習紀錄剛被別的地方改過,請重新開始今天的複習`**,`code` 固定為 `'reviews-changed'`(給側車對應成錯誤種類,T22/T24 自己處理)。
   - 誠實的限制(寫進 `io.ts` 的註解):重讀比對到 rename 之間仍有微秒級的空窗,**樂觀檢查不是鎖**;顧問已接受,不再加碼。
3. **`Session` 加一個選用欄位 `reviewsHash?: string`**(`types.ts`):這個 session 最後一次「確定與磁碟一致」的雜湊。
   - `buildTodaySession`:用 `readReviewsSnapshot` 取代 `loadReviews`,把 `hash` 放進 session。
   - `scripts/review.ts` 的 `sessionFromCache`(續答時另一條建 session 的路):同樣用 `readReviewsSnapshot`,放進 session。**兩個建 session 的地方都要記,少一個就是漏洞**(must_catch 最後一條)。
4. **`submitAnswer`**(只有「一張卡全部答完、要寫 reviews.json」那一條路;批改失敗 `hadError` 那條本來就不寫,不動):
   - 用 `readReviewsSnapshot` 讀目前的磁碟;基準 = `session.reviewsHash`;**`session.reviewsHash` 是 `undefined` 時(測試手工組的 session)基準就是這次讀到的雜湊**——等於退回現況的毫秒窗,不讓既有測試因為沒設欄位而失敗,也不放寬它們。
   - 磁碟雜湊 ≠ 基準 → 丟 `ReviewsChangedError`,**在任何寫入之前**:不呼叫 `saveReviews*`、不 shift `session.queue`、不加 `passed`/`failed`。(批改已經花了的 LLM 費用就算了,答案不寫。)
   - 一致 → 算轉移,`saveReviewsIfUnchanged(dir, reviews, 基準)`;成功後 `session.reviewsHash = 回傳的雜湊`(下一題起的基準就是我們自己剛寫的)。
   - 丟錯之後這個 session 不可再用(呼叫端要結束或重建);不需要在 core 裡做復原。
5. **終端機**(`scripts/review.ts`):`ReviewsChangedError` 一路丟到 `main().catch`:印 `message` 到 stderr、**退出碼 1**、**不印小結、不做 snapshot**(磁碟狀態已和我們的對不上,不替它備份一份看似完整的快照)。已經寫進去的前幾題不受影響(每題立刻落地,phase-1 的保證)。再開一次 `review.ts` 就是「重新開始今天的複習」:快取的題目名單還在,已答的卡以 history 為準被剃掉(ADR-074)。
6. **不加鎖、不改格式**:不新增任何 `learning/` 底下的檔案;`reviews.json` 的欄位、縮排、結尾換行不變;寫入仍走 `writeFileAtomic`(§11b)。

### 「載入時」到底指哪一次(寫死,協調者/前端 2026-10-16 要求)

| 問題 | 規定 |
|---|---|
| 雜湊何時記 | **session 建立時**:`buildTodaySession` 讀 `reviews.json` 的那一次(續答則是 `sessionFromCache` 還原 session 時重新讀的那一次)。**不是** submit 當下的 `loadReviews`——那只剩幾毫秒的空窗,視窗與終端機交錯答題幾乎都抓不到。整個 session 期間 `reviews.json` 只要被別處改過,**下一次寫入就拒絕**。 |
| 記在哪 | 只在記憶體的 `Session.reviewsHash`。**不落地到 `learning/`、不寫進 ADR-074 的 session 快取**(快取格式 `SessionCacheSchema` 不動、§12 不動)。 |
| 續答(T17 快取還原的 session) | 還原時**重新讀** `reviews.json` 並記雜湊(快取不存雜湊)。還原到第一次寫入之間的改動才會被抓;還原之前別人寫的已經在還原時讀進來了(`dropAnsweredToday` 用的就是那份)。 |
| 寫成功之後 | 基準更新為**剛寫進去的位元組的雜湊**(`saveReviewsIfUnchanged` 的回傳值)。同一個 session 連續答題不會自己擋自己。 |
| 外部改動發生在 submit 之前、載入之後 | 一律拒絕,即使改動的是別張卡(寧可多拒絕一次,也不靜默蓋掉)。 |
| 錯誤類別 | 名字以本工單為準:**`ReviewsChangedError`**,從 `packages/core/src/session/io.ts` 匯出(也從 `session/index.ts` 再匯出);`code === 'reviews-changed'`;`message` 逐字「複習紀錄剛被別的地方改過,請重新開始今天的複習」。T22/T24 只依賴 `code` 與 `message`,不依賴 `instanceof`(側車是別的行程邊界)。 |

## 測試(前端寫;開發不改)

| 驗收 | 量什麼 | 怎麼量 |
|---|---|---|
| 要求 1、2 | `readReviewsSnapshot`:雜湊 = 檔案位元組的 SHA-256;檔案不存在 → `'absent'`;`reviews` 與 `loadReviews` 的結果深度相等(同一份資料);壞格式照舊丟 zod 錯 | vitest,暫存目錄 |
| 要求 2 | `saveReviewsIfUnchanged`:雜湊相同 → 寫入且回傳新雜湊(= 讀回檔案算的);不同 → 丟 `ReviewsChangedError`(`message` 與 `code` 逐字)、**磁碟檔案位元組不變、目錄裡沒有 `reviews.json.tmp`**;檔案原本不存在而基準是 `'absent'` → 可寫;基準是 `'absent'` 但別人已建檔 → 丟錯 | 同上 |
| 要求 4 | **確定的造法**:`buildTodaySession`(或 `sessionFromCache`)之後、最後一題 `submitAnswer` 之前,**直接改寫磁碟上的 `reviews.json`**(例如另一張卡的 history 多一筆)→ 回答最後一題 → 丟 `ReviewsChangedError`;檔案位元組仍是被改過的那份(不是我們的);`session.queue.length`、`passed`、`failed` 不變 | 同上,假 router |
| 要求 4 | 兩張卡連續答:第一張成功寫入後,第二張**不會**誤報被改(基準已更新);兩張之間若有人改檔 → 第二張丟錯 | 同上 |
| 要求 4 | `session.reviewsHash` 為 `undefined`(手工組的 session)→ 行為與現況相同,不丟錯 | 同上 |
| 要求 3 | `buildTodaySession` 回的 session 有 `reviewsHash` 且等於磁碟雜湊;續答路徑(`sessionFromCache`)也有 | 同上 + 靜態檢查 `scripts/review.ts` 兩個建 session 的位置 |
| 要求 5 | 終端機:答到一半改 `reviews.json` → 退出碼 1、stderr 含固定訊息、stdout 沒有小結、`learning/` 沒有 snapshot commit;再執行一次 → 從快取續答、已答的不重問 | CLI 整合測試 / cucumber(見下) |
| 要求 6 | 靜態:`learning/state/` 沒有新檔名(對照 §12 清單);`writeFileAtomic` 仍是唯一寫入路徑 | vitest 靜態檢查 |
| 不退步 | T17 與 session 既有測試(`answer.test.ts`、`build.test.ts`、`io.test.ts`、`cache*.test.ts`、`summary*.test.ts`、`zero-guard.test.ts`)與 11 的 phase-1/phase-2 場景全綠;**不得放寬或刪除任何既有斷言**;需要為新欄位改既有測試時,改動限於「補欄位」,在 commit 說明逐條講為什麼 | vitest + `--tags` |

### 場景

規格場景、紅測試、步驟定義同一批進 main(顧問 2026-10-16)。**11 的 phase-1、phase-2 已 done,不改**;場景寫進 `features/11-review-cli/phase-3.feature`(全英文,tag `@review-cli @phase-3`)。**這個檔與 T25 共用**:先進 main 的那一批建立檔案與 FEATURE.md/NEXT.md 的 phase-3 列,後進的只加場景。建議兩個場景:

1. `Reviews changed elsewhere while answering` → 使用者答完最後一題時 `reviews.json` 已被別處改過 → 印固定訊息、退出碼 1、別處的改動還在、沒有小結。
2. `A second answer after a successful save is not a conflict` → 同一個 session 連答兩張卡,中間沒有外部改動 → 兩張都寫入、沒有錯誤(防止「基準沒更新」)。

## 排程與互斥

- touches:`session/io.ts`、`answer.ts`、`build.ts`、`types.ts`、`scripts/review.ts`。
- 與 **T25** 有檔案重疊(`io.ts`、`types.ts`、`scripts/review.ts`)→ **不並行**;順序 **T25 → T26**。
- **T24 依賴 T26**;T22(側車底層)不依賴,但側車的 `submit` 要把 `code: 'reviews-changed'` 對應成錯誤種類(T22/T24 的事)。
- 與 T17(已合併)的關係:T17 的測試都要原樣綠;`reviewsHash` 是選用欄位,沒設就是現況行為。

## 不在範圍

- 不加鎖(檔案鎖、鎖檔、`flock`);不改 §12;不改 `reviews.json` 格式。
- 不做自動重試或自動合併(偵測到就停,由使用者重新開始)。
- 不處理 `log.jsonl`(append-only,兩個寫者各寫完整一行,ADR-075 已說明)與 session 快取(可丟棄,ADR-074)。
- 不處理 `state/` 的其他檔案(`needs-review.json` 等,不在複習路徑上)。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/session
npm run boundaries
```

不跑 `--live`、不跑變異測試、不跑 `check:all`、不碰真的 `learning/`。

## 預算

`budget_usd: 1`(純函式與一個欄位)。
