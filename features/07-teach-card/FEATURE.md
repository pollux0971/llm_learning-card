# 07 · teach-card

## 一句話

教學卡的 UI。一次一張、你拉不是它推、三個按鈕、可以往下鑽。

## 範圍

- 依 order 檔取下一張未學的卡
- 渲染 frontmatter 標示、body、example 圍欄(巢狀 markdown)、圖片
- 三個按鈕:下一個、換類別、深入這個
- learned 標記、先備提示(軟性)
- 深入:讀既有子卡或呼叫生成
- 範例折疊、縮放、圖片放大
- 今日負擔與週目標的顯示位置

## 不在範圍

- 卡片生成邏輯(→ 02)
- 週目標計算(→ 08)
- 視窗(→ 10)

## 單獨執行

```bash
npm run dev -w apps/teach-card
```

用 `contracts/fixtures/learning-rich` 與 `MemoryFs`。
預期:能翻卡、能換類別、能看到 example 與圖片。learned 不落地。

## 依賴

**Wave 0(phase-1)**:無。`MemoryFs` 吃 fixture。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1、01 phase-3、10 phase-2、I3 通過 | order 檔與真的檔案存取 |
| phase-3 | 自身 phase-2、03 phase-2、02 phase-2 | 深入需要 router 與生成函式 |
| phase-4 | 自身 phase-1 | 純渲染,可與 2/3 平行 |

## Wave 0 的重複

| 東西 | 位置 | 整合時移除於 |
|---|---|---|
| `MemoryFs` | `apps/teach-card/src/stubs/memory-fs.ts` | I4 |
| 假的 order(直接用 id 排序) | `apps/teach-card/src/stubs/order.ts` | I4 |

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 框架 | Svelte 5 + Vite | `apps/teach-card/` |
| markdown | markdown-it | |
| example 圍欄 | 自寫 fence 插件:lang 為 example 時遞迴 render 為 HTML 而非 pre | `packages/ui-shared/`,與考試卡共用 |
| 圖片 | I4 起用 Tauri asset protocol | Wave 0 用 dev server 靜態路徑 |
| 變異門檻 | 寬鬆;但 fence 插件為 **標準 80%** | 插件是共用邏輯,不是 UI |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | 渲染、下一個、fence 插件(MemoryFs) | Wave 0 | ready | |
| 2 | 換類別、依賴順序、先備提示、接上真檔案 | I4 | todo | |
| 3 | 深入這個 | I4 | todo | |
| 4 | 範例折疊、縮放、圖片放大 | I4 | todo | |

## 驗收方式

多數 `@manual`。fence 插件的解析可自動測,門檻 80%。

## 開放問題

- 「下一個」要不要有「跳過不標 learned」?目前沒有,滑過就算學了。
