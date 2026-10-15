# 10 · desktop-shell — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-1(2026-09-03) |
| 進行中 | 無 |
| 下一個 | phase-2 |

## Gate

**phase-1**:無 gate。placeholder HTML,不碰任何 core。

**phase-2** 需要:
- [ ] 自身:phase-1 `done`
- [ ] 跨資料夾:無(它提供 `LearningFs`,不消費別人)
- [ ] 整合:無

**phase-3** 需要:phase-2 `done`、**I4 通過**
**phase-4** 需要:phase-3 `done`、**I6 通過**、一台 macOS 實機
**phase-5** 需要:phase-4 `done`、**I7 通過**、一台 Windows 實機

**phase-6**(無框透明視窗;使用者 2026-10-15 提的需求,長相在 `features/14-hud-skin/`)需要:
- [ ] 自身:phase-2 `done`。**T2c-2 合併之前不動 `apps/desktop/`**(R2:同一個目錄同一時間一張工單)
- [ ] 跨資料夾:14 phase-2 `done`——兩張卡都已經用上自畫的標題列與縮放把手。否則拿掉系統外框之後,視窗沒有地方可以拖、也關不掉
- [ ] 整合:無
- [ ] 契約:無(不動磁碟格式)

  要動的只有 `apps/desktop/`:`tauri.conf.json` 兩個視窗設 `decorations: false`、`transparent: true`;
  `capabilities/default.json` 加開始拖曳、開始縮放拖曳、縮小、關閉四個視窗權限;頁面根元素加 `hud-frameless`,
  偵測不到合成器(compositor)時再加 `hud-solid`(Linux 的 WebKitGTK 沒有合成器時透明區會變黑,所以要退回實心底)。
  偵測放 Rust 端,怎麼把結果交給頁面由工單定,目標是第一次畫面之前就決定,不要先黑再變。
  - **關閉走同一條路**:自畫的關閉鈕呼叫視窗的 `close()`,跟系統關閉鈕送同一個關閉請求。phase-3 的「關閉縮到系統列」
    攔的是同一個事件,所以 phase-3 不用為自畫的按鈕另寫一次。
  - **已知限制**:切角外面看起來透明,點擊還是會被視窗吃掉(視窗實際上是長方形)。使用者選這個做法時已知道。
  - **CSP**:截圖與 console 一律用 `tauri build` 的產物(`tauri dev` 沒有 CSP,見 T2c-2 工單驗收 11)。
  - macOS 的透明視窗要 `macOSPrivateApi`,Windows 另有行為差異:跟 phase-4、phase-5 一起在實機上驗,phase-6 只驗 Linux。

  待辦(有實機時一起做):`atomicWriteJson()` 的目錄 `fsync` 在 Windows 會回 `EACCES`
  (`FlushFileBuffers()` 要 `GENERIC_WRITE`;`openSync(dir)` 本身是成功的)。
  候選解法是 win32 跳過目錄 fsync,**必須在真 Windows 上驗過再寫**。診斷與不採用的替代方案
  見 **ADR-040** 的 Consequences 第 5 點。

## 已登記、尚未做:`LearningFs` 介面目前有三處宣告

`LearningFs`(契約 §13)現在在 `apps/test-card/src/types.ts` 與 `apps/teach-card/src/stubs/memory-fs.ts` 各有一份
stub 宣告,phase-2 會產生第三份(真實作)。**計畫:phase-2 完成後,以真實作的形狀為準,把介面提升進
`packages/contracts`;06、07 在 I3 拿掉 stub 時改用它。**

順序不能反:現在從 stub 推介面,會讓不需要處理危險的實作(沒有 symlink、沒有 canonicalize、
沒有 URL 編碼)去定義一個必須處理危險的介面。phase-2 的邊界例外(10→01)只放 `recordEvent`,
不要順便把 `LearningFs` 的型別也拉進例外。Owner:phase-2 的審核輪。

## Gate 未滿足時

**phase-2 沒有 gate,可以緊接著 phase-1 做。** 它提供 `LearningFs` 給 06 與 07,
所以早點做完對 I3 有幫助。

**phase-3 等 I4**:系統列要顯示「今天幾題到期」,那要有真的排程與真的資料才有意義。
提前做只能顯示假數字。

**phase-4 / 5 卡在硬體**:沒有實機就不要開始。跨平台的問題九成是「在那台機器上才會出現」的,
用 CI 或虛擬機驗不出來。

## 完成後

phase-2 完成後 06 與 07 就能丟掉 `MemoryFs`。
路徑防護的部分**不要**當成 UI 程式對待——那是安全邊界,變異門檻 95%,要有逃逸嘗試的測試。
