# 11 · review-cli

## 一句話

把 scheduler、grading、檔案讀寫串成一個能用的互動式複習指令。I2 的主角。

## 為什麼獨立成一個資料夾

04 是純函式、05 是審核、01 是格式。**沒有人負責把它們串起來**——v2 漏了這個,
整合 gherkin 到處寫 "the review command" 但沒有任何 feature 產出它。

這一層很薄但很真實:它決定了 session 怎麼開始、答案什麼時候落地、中斷怎麼續、
一天的邊界在哪。這些都不是 04 或 05 的職責。

而且它是**桌面版的規格來源**:06-test-card 做的事就是把這個 CLI 換一個介面。
CLI 先做,行為先定案,UI 就只是換皮。

## 範圍

- 建立當日 session:讀 reviews、呼叫 scheduler、寫入當日快取
- 逐題呈現與收輸入(填空單行、應用多行)
- 呼叫 grading、依結果呼叫 scheduler、**立即**落地
- 中斷續答、跨日重建
- session 小結與明日預估
- **複習結束時呼叫一次 `snapshot`**(ADR-042,phase-2 做)
- `--dry-run`(只列出今天要考什麼,不作答)
- 暫停今天

## 不在範圍

- 排程與審核的邏輯(→ 04、05)
- 圖形介面(→ 06)
- 教學(→ 07)

## 單獨執行

```bash
npx tsx scripts/review.ts --dir contracts/fixtures/learning-minimal --dry-run --today 2026-09-10
```

預期輸出:今天到期的卡片清單與排序理由。`--dry-run` 不寫任何檔案。

## 依賴

| Phase | 需要 | 原因 |
|---|---|---|
| 1 | 04 三個 phase、05 phase-2、01 phase-2 | 這一層本來就是組合層,沒有獨立的 Wave 0 版本 |
| 2 | 自身 phase-1、I2 通過 | 續答與跨日邊界要在真的用過之後才知道怎麼設計 |

**注意**:這是唯一沒有 Wave 0 phase-1 的資料夾。組合層在被組合的東西存在之前無法獨立,
硬造一個吃 stub 的版本只是在寫兩次。這是 ADR-021 的一個明確例外。

## Wave 0 的重複

無(不參與 Wave 0)。

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `scripts/review.ts` + `packages/core/src/session/` |
| 互動 | Node readline,不引入 TUI 框架 | 保持薄 |
| 當日快取 | `state/session-<date>.json` | 中斷續答靠它 |
| 變異門檻 | **標準 80%** | session 邊界邏輯要測到,IO 不用 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | session 建立、作答、落地、小結 | I2 | done | 2026-09-03 |
| 2 | 續答、跨日、暫停、dry-run 完整化、結束時 snapshot(ADR-042) | I3 | todo | |

## 驗收方式

phase-1 大部分可自動測(把 readline 換成注入的輸入序列)。互動體驗 `@manual`。

## snapshot 的呼叫點(ADR-042)

契約 §11b 說 `learning/` 該是一個 git repo,`state/` 的變更每天 commit 一次。**v1 沒有
daemon,也不裝任何跨平台排程器**(cron / launchd / 工作排程器三份設定,失敗還是靜默的),
所以「每天一次」由**這個 CLI 每次複習結束時呼叫一次 snapshot** 來達成。

理由:`state/reviews.json`、`state/weekly.json`、`state/log.jsonl` 幾乎只在複習的時候變。
「複習完了」正好就是「今天的資料剛剛全部落地」的那一刻,而且使用者每天都會做這件事。
沒複習的那天沒有變更,snapshot 本來就什麼都不做(它不製造空 commit),兩條規則咬得剛好。

**phase-2 要做的,具體是**:

1. `scripts/review.ts` 的 `main()` 在印完 `renderSummary(...)` **之後**,呼叫一次
   `snapshotLearningDir(dir)`(`@core/schema/git-repo.js`)。
2. **`--dry-run` 不呼叫**。dry-run 的契約是「不寫任何檔案」,commit 也是寫。
3. **暫停(`--pause`)不特別處理**。暫停本來就不改 `state/`,沒有變更 snapshot 自然 no-op。
4. **snapshot 失敗不可以讓複習失敗**。使用者已經答完題了,答案早就一題一題落地了
   (那是 phase-1 的保證)。備份沒做成只印一行提示,退出碼維持原本的。
   `not-a-repo`(使用者是在 §11b 之前建的目錄)是最可能遇到的一種,提示要說「跑
   `cli.ts init` 就會補上版本控制」。
5. `11-review-cli → 01-data-layer` 的邊界例外**已經在** `scripts/boundaries.allow.json` 裡,
   不用新增。

**場景寫在哪**:目前只寫在這裡與 NEXT.md,**沒有**寫進 `phase-2.feature`。原因見 ADR-042
Consequences 第 1 點——這份 feature 的步驟一個都還沒寫,現在加場景只會讓 `accept:dry` 的
undefined 數字變多,或逼別人先佔用 phase-2 自己要用的步驟名字。**phase-2 開工的人請把
上面那五條寫成場景**(建議三個:結束時 snapshot、dry-run 不 snapshot、snapshot 失敗不影響
退出碼)。模組本身的行為已經有規格了,在 `features/01-data-layer/phase-4.feature`。
