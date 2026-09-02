# 08 · weekly-goal

## 一句話

本週通過 D1 的卡片數有沒有到目標。沒有連續天數,沒有懲罰。

## 範圍

- 契約 §9 的 `Weekly` 計數與達標判定
- ISO 週切換與歸零
- D1 護欄(只有通過 D1 才計入)
- 顯示於兩張卡

## 不在範圍

- 其他遊戲化(ADR-008 只做這個)
- 通知

## 單獨執行

```bash
npx tsx scripts/weekly.ts --state contracts/fixtures/weekly/mid-week.json \
  --event pass-d1 --card sec-0042
```

預期輸出:更新後的 `Weekly` 物件與是否達標。

## 依賴

**Wave 0(phase-1)**:無。純函式,吃 `Weekly` 物件與事件。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1、07 phase-2、06 phase-3 | 要有地方顯示 |

## Wave 0 的重複

無。

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `packages/core/src/weekly/` |
| ISO 週 | date-fns 的 getISOWeek / getISOWeekYear | 年末交界是已知陷阱,要有測試 |
| 觸發 | 訂閱 scheduler 事件,不輪詢 | |
| 變異門檻 | **嚴格 95%** | 純函式,而且護欄邏輯錯了會靜默給錯數字 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | 計數、D1 護欄、週歸零 | Wave 0 | ready | |
| 2 | 顯示與目標調整 | I5 | todo | |

## 驗收方式

phase-1 全自動。ISO 週的年末交界(2026-12-31 與 2027-01-01 同屬 2026-W53)必須有測試。

## 開放問題

- 週一 00:00 歸零,但使用者週一凌晨還在用怎麼辦?先接受這個邊界。
