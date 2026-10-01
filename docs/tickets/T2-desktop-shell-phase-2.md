# 工單 T2:10 desktop-shell phase-2(LearningFs 的 Tauri 實作、路徑防護、載入真前端)

> 狀態:技術顧問已批(14 條)。派工時機:T1 收了、T3 排好之後,不疊。
> 作者:統籌·契約。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。

## 標的與 gate

- 標的:`features/10-desktop-shell/` 的 phase-2。
- gate:自身 phase-1 done(`NEXT.md`);跨資料夾:僅 10→01 的 `recordEvent`。

## 前置(必須先合進 main,worker 才取得到)

- 分支 `desktop-phase2-spec`(clone:`/data/python/llm_learning-cards-contracts`;頂端 `bf949f5`,基底 `3b6c211`):
  改寫後的 `features/10-desktop-shell/phase-2.feature`、`PATH-GUARD-EVIDENCE.md` 與 `evidence/`、`NEXT.md` 的登記。
- 分支 `contracts-1.2.0` 與疊在其上的 `contracts-s13`:契約 §13 的 1.3.0(白名單、不解碼)。
- 合併順序與方式由協調者定(`--no-ff`,不壓 commit,SKILL.md §2)。

## 驗收條件

1. `phase-2.feature` 全部非 `@manual` 場景:測試 agent 先寫成紅,開發 agent 實作到綠。

2. **字元集合推導(階段 0,先於實作)**:從 §1 的 `CardId` 與 `CategoryId`,加上實際掃過 `learning/` 與
   `contracts/fixtures/` 現存的目錄名與檔名,推出白名單字元集合與長度上限,回填契約 §13,
   並附「來源是 §1 加上 <日期> 實際掃過的內容」。
   起點量測(統籌·契約,2026-10-01):97 個名字,字元只有 `[A-Za-z0-9]` 與 `-`、`.`;
   `learning/` 只有一個分類 `security`。**樣本小、只有一個分類,不是結論**——
   `CategoryId` 只寫「非空,無路徑分隔符與空白」,可能含中文。
   已裁決:段不得以 `.` 開頭;允許 `_`。
   **推導必須回答兩個問題(技術顧問 2026-10-01 追加,不裁,要附依據)**:
   - **大小寫**:macOS 預設與 Windows 的檔案系統不分大小寫,`Cards/A.md` 與 `cards/a.md` 是同一個檔。
     結果必須給一個決定:字元集合只收小寫,或允許混合但邊界要拒絕「與既有名字只差大小寫」的路徑
     (那需要查檔案系統,比較重)。
   - **`raw/` 的讀取**:`raw/` 是使用者的素材,檔名可能有空白、中文、大寫(現有 97 個名字全是 `[A-Za-z0-9.-]`,
     但樣本只有一個分類)。要回答:**有沒有任何 UI 路徑透過 `LearningFs` 讀 `raw/`?**
     有,字元集合就必須容得下使用者的檔名;沒有,就寫明「`LearningFs` 不服務 `raw/`」,連讀也拒絕
     (比放寬字元集合更乾淨)。**依據要附 `git grep`,不要憑印象。**
   **保留裝置名清單要核實**:§13 第 6 條的清單是技術顧問依記憶寫的,沒對照 Microsoft 檔名規範原文
   (可能還有 `COM0`、`LPT0`、上標數字的 `COM¹` 之類)。階段 0 要查**原文**再補,附來源,不憑記憶。
   `write` 對 `raw/` 一律拒絕已裁(§13 1.3.0),不在這個推導裡。

3. **Unicode 正規化形式**:若第 2 條結論允許 CJK,同時產出正規化形式的裁決
   (建議 NFC;處理方式是「拒絕非該形式的輸入」,不是轉換)與向量
   (同一個字的 NFC 一列、NFD 一列,斷言只有一種被接受)。
   若不允許 CJK,寫明「因不允許非 ASCII,此條不適用」並附依據。
   第 2、3 條的結論回報技術顧問,不自行裁。

4. **路徑防護的對照**:`..\..\etc\passwd` 必須拒絕;再把實作改成「先檢查後轉換」,
   該斷言與拒絕 Examples 的 #5–#9(見 `PATH-GUARD-EVIDENCE.md`)必須變紅。審核 agent 做。

5. **asset protocol 旁路(最重要,否則 phase 會全綠但有完整旁路)**:`assetProtocol` 啟用且 scope 限
   `learning/`;有場景證明繞過 read command 的 asset URL 也被拒絕;雙重編碼 `..%252f..%252fetc`
   解一次後仍含 `%`,拒絕。現況(統籌·契約讀過):`tauri.conf.json` 的 `security` 只有 `"csp": null`;
   `capabilities/default.json` 只有 `core:default` 與 `window-state:default`;`Cargo.toml` 沒有
   `tauri-plugin-fs`。

6. **不得讓 Rust 寫 §10 事件**:read command 的拒絕回給 TS 呼叫端,由 TS 呼叫 `recordEvent`;
   asset protocol 的拒絕只進 Rust log,不產生 §10 的 warning 事件——這是登記的已知限制,不是 bug
   (沒有 TS 呼叫端可以回傳;在 Rust 重做 §11b 的四步寫入沒有任何東西會檢查它有沒有漂移)。

7. **邊界例外**:`scripts/boundaries.allow.json` 加 10→01,symbol 只放 `recordEvent`,
   **不順便拉 `LearningFs` 型別**。開發 agent 開工第一步先查 10 在 `scripts/boundaries.owners.json`
   的落點名稱與 TS 側檔案位置,查完回報,**不憑本稿**。

8. **變異**:路徑防護本體在 Rust,用 cargo-mutants。先安裝
   (**安裝耗時與版本兩個數字要進報告,不是只進 commit 訊息**,下一個專案要用),
   對第一版防護跑一次,第一次實測的值當地板;門檻設成只准升不准降的棘輪;
   設定檔寫明「這個地板來自 cargo-mutants 的第一次實測,不是 Stryker 的 95%」。**不寫 95%**:
   兩個引擎的變異算子不同,同一份邏輯的存活率沒有可比性。

9. cargo-mutants 取 `.stryker.lock`。射程只寫:
   「解決變異測試之間的互斥;不解決整條鏈之間的互斥,見另案(T3)。」

10. 每次鏈或變異的紀錄附 host、worker 數、1/5/15 分 load。

11. **gherkin 格子對照**:測試 agent 寫一個測試,把 `phase-2.feature` 的 `" ../x"` 那列讀出來,
    斷言解出來第一個字元是空白、且 `JSON.parse` 後等於 `" ../x"`;再斷言 `..\..\etc\passwd` 那列
    解出來含真的反斜線。(Gherkin 格子會去頭尾空白、把反斜線當轉義字元;Examples 的路徑欄是 JSON 字串,
    格子裡一個真反斜線寫成四個。)

12. 兩份 `MemoryFs` stub 的 guard 漏洞(`features/10-desktop-shell/PATH-GUARD-EVIDENCE.md`):
    phase-2 完成時,真實 `LearningFs` 通過同一份 Examples;stub 本身不要求修,`REVIEW` 註明。

13. 「載入真前端」:placeholder 不再出現。

14. `LearningFs` 介面提升進 `packages/contracts`:**phase-2 完成之後**的事,不在本張
    (`NEXT.md` 已登記 owner)。現在從 stub 推介面,會讓不需要處理危險的實作去定義必須處理危險的介面。

## 測試誰寫

- 測試 agent:紅測試與步驟定義(照 `features/steps/_world.ts`)、第 11 條。
- 審核 agent:第 4 條的對照、Rust 變異。
- 開發 agent:只寫實作,不改測試。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,同一時間一個 agent。
