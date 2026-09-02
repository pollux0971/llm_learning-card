# 09 · lint

## 一句話

找出壞掉的、過時的、待複審的,列給你看。不自動改任何東西,除非你明確要求。

## 範圍

- 格式檢查:字數、缺考題、prereqs 指向不存在、孤兒、循環、不一致
- 狀態檢查:stuck、stale、source_missing、provisional
- provisional 一鍵複審
- 指定卡片重生(保留 id 與 history)
- 報告輸出

## 不在範圍

- 自動修正(除了明確的重生選項)
- 生成新內容(→ 02)

## 單獨執行

```bash
npx tsx scripts/lint.ts --dir contracts/fixtures/learning-broken
```

預期輸出:列出該 fixture 刻意埋的每一個問題,退出碼 1。
`learning-minimal` 應該退出碼 0。

## 依賴

**Wave 0(phase-1)**:無。自帶最小驗證器。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1、01 全部、03 phase-3、05 phase-3、I5 通過 | 複審與重生 |

## Wave 0 的重複

| 東西 | 位置 | 整合時移除於 |
|---|---|---|
| 最小卡片驗證器 | `packages/lint/src/validator-min.ts` | I6(改用 01) |

**這個重複是刻意的且值得**:lint 的價值在於「用另一雙眼睛看」。
Wave 0 期間它用自己的驗證器,如果它跟 01 的驗證器對同一張卡結論不同,
那就發現了一個真正的歧異——契約寫得不夠清楚。整合前把這件事查清楚。

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `scripts/lint.ts` + `packages/core/src/lint/` |
| 報告 | markdown,一個問題一行,附可點的相對路徑 | |
| 變異門檻 | **標準 80%** | 檢查邏輯要測到,報告格式不用 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | 格式與一致性健檢、報告(自帶驗證器) | Wave 0 | ready | |
| 2 | provisional 複審、stuck、重生 | I6 | todo | |

## 驗收方式

全自動,用 `learning-broken` fixture。每個檢查對應一個刻意埋的問題。

## 開放問題

- lint 要不要排程自動跑?先手動,I6 後看需求。
