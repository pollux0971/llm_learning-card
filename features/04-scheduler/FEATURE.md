# 04 · scheduler

## 一句話

決定「今天考誰、答完後下次何時」的純函式。不讀檔、不寫檔、不呼叫 LLM。

## 範圍

- 契約 §6 的固定骨架與間隔表
- stage → 題型對應
- 答錯回退、連錯計數、stuck 判定、reteach 事件
- 今日到期、每日上限、逾期比例優先序
- 所有函式吃狀態物件、吐新物件,無副作用

## 不在範圍

- 讀寫 reviews.json(呼叫端做)
- 審核對錯(→ 05)
- 縮短版內容生成(→ 05)
- 自適應演算法(ADR-001;介面設計成可替換)

## 單獨執行

```bash
npx tsx scripts/due.ts --state contracts/fixtures/reviews/mid-cycle.json --today 2026-09-10
npx tsx scripts/due.ts --simulate --days 200 --new-per-day 2
```

第一個印出今日到期清單與排序理由;第二個模擬 200 天的每日題數曲線,用來驗證穩態負擔。

## 依賴

**Wave 0(phase-1)**:無。這是最乾淨的一個——純函式,連 fixture 都只需要 reviews。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1 | |
| phase-3 | 自身 phase-2 | |

## Wave 0 的重複

無。

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `packages/core/src/scheduler/` |
| 日期 | ISO 字串,用 date-fns 的 addDays / differenceInDays | 不用 Date 物件做運算,避免時區 |
| 測試 | vitest + cucumber | |
| 變異門檻 | **嚴格 95%** | 算錯要幾週後才發現,代價最高 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | 固定骨架、到期清單、題型對應 | Wave 0 | ready | |
| 2 | 錯誤回退、連錯、stuck、reteach | I2 | todo | |
| 3 | 每日上限、逾期比例優先序 | I2 | todo | |

## 驗收方式

全自動,無 `@manual`。這是全專案測試覆蓋最高的模組。
變異測試必須涵蓋間隔表**每一格**、逾期比例的四種常見錯誤實作、邊界(逾期 0 天、連錯剛好 2 / 3)。

## 開放問題

- 「今天」用本地時區 00:00 還是可設的一天開始時間(如 04:00)?先 00:00,I5 再議。
