# 10 · desktop-shell

## 一句話

Tauri 殼。兩個視窗、置頂、系統列、開機自啟、跨平台。Rust 只做這些。

## 範圍

- 兩個獨立視窗(teach、test),各自記位置大小
- 置頂(X11 / macOS / Windows;Wayland 偵測與提示)
- 系統列圖示、選單、關閉縮到系統列
- 開機自啟開關
- learning 路徑設定與首次啟動流程
- 契約 §13 的 `LearningFs` 的 Tauri 實作與路徑防護
- 三平台編譯

## 不在範圍

- 視窗內的內容(→ 06、07)
- 業務邏輯(→ packages/core)

## 單獨執行

```bash
npm run tauri dev
```

Wave 0 是兩個 placeholder HTML 視窗,不載入任何真的內容。
預期:兩個視窗出現、可移動縮放、關掉再開回到原位。

## 依賴

**Wave 0(phase-1)**:無。placeholder HTML,不碰 core。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1 | |
| phase-3 | 自身 phase-2、I4 通過 | 系統列要顯示到期數,需要真的排程 |
| phase-4 | 自身 phase-3、I6 通過 | macOS |
| phase-5 | 自身 phase-4、I7 通過 | Windows |

## Wave 0 的重複

| 東西 | 位置 | 整合時移除於 |
|---|---|---|
| placeholder HTML | `apps/desktop/src-tauri/placeholder/` | I3 |

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 框架 | Tauri 2 | `apps/desktop/src-tauri/` |
| 前端建置 | Vite + Svelte 5 | |
| 系統列 | Tauri tray API | GNOME 需 AppIndicator 擴充 |
| 自啟 | tauri-plugin-autostart | |
| 視窗狀態 | tauri-plugin-window-state | |
| fs | tauri-plugin-fs,scope 限 learning/ | |
| 變異門檻 | **寬鬆**;但路徑防護為 **嚴格 95%** | 路徑逃逸是安全問題 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | Linux 兩視窗、置頂、位置記憶(placeholder) | Wave 0 | ready | |
| 2 | LearningFs、路徑設定、路徑防護、載入真前端 | I3 | todo | |
| 3 | 系統列、自啟、縮到系統列 | I5 | todo | |
| 4 | macOS | I7 | todo | |
| 5 | Windows | I8 | todo | |

## 驗收方式

幾乎全 `@manual`,每個平台一台實機。例外是路徑防護——那個必須自動測且變異門檻 95%。

## 開放問題

- Wayland 置頂:偵測並提示,不做 hack。
- 兩個視窗還是一個視窗兩分頁?定為兩個。用了覺得煩就在 I5 時 `/decide`。
