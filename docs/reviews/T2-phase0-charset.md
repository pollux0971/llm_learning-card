# T2 phase-0：字元集合與 Unicode 正規化推導

> 產出者：T2 phase-0 worker
>
> 量測日期：2026-10-01（Asia/Taipei）
>
> Host：`pollux-IdeaPad`；CPU：8；開工 load（1/5/15 分）：32.39 / 27.27 / 26.18
> 範圍：工單 T2 驗收條件 2、3 的推導與建議；未修改契約、測試、實作或 Tauri 設定。

## 給技術顧問的結論（待裁決）

建議採用下列互相配合的一組規則：

1. 段內允許 ASCII `a-z`、`0-9`、`_`、`-`、`.`，以及 Unicode Script 為 Han、Hiragana、Katakana、Hangul 的字元；禁止 ASCII 大寫字母。既有「段不得以 `.` 開頭或結尾」仍適用。
2. 整個 `relPath` 必須已是 **Unicode NFC**；不轉換，非 NFC 立即拒絕。
3. `relPath` 以 **UTF-8 bytes** 計的總長度上限建議為 **240 bytes**。
4. `LearningFs` 不服務 `raw/`：第一段以固定 ASCII 不分大小寫比對為 `raw` 時，`read` 與 `write` 都拒絕。這不影響既有 ingest 管線；它不是 UI 經 `LearningFs` 的讀取者。
5. Windows 保留裝置名補為：`CON`、`PRN`、`AUX`、`NUL`、`COM1`–`COM9`、`COM¹`–`COM³`、`LPT1`–`LPT9`、`LPT¹`–`LPT³`（比對第一個 `.` 前的部分、ASCII 不分大小寫）。**不加入 `COM0` 或 `LPT0`**，因 Microsoft 原文未列它們。

這是建議，不是我自行修改契約的裁決。請技術顧問確認兩個政策取捨：

- `CategoryId` 的既有定義只禁止分隔符與空白，且工單明示可能含中文。若字元集合僅收 ASCII，會把有效的中文分類縮窄為不合法；因此建議允許上述 CJK scripts，並以 NFC 封住不同檔案系統的同名不同位元組問題。
- §1 並未給 `CategoryId` 長度上限，現有名字也不能**演繹**出唯一的有限數字。240 是安全邊界的明示政策值：高於本次最長相對路徑、低於常見單一檔名 255-byte 級限制；它不能保證「任意使用者選的 learning 絕對路徑」都不會撞全路徑上限。後者取決於使用者選擇的根目錄，應由首次選目錄／實作層另行回報。

## 來源、量測與範圍

推導來源是 **契約 §1**（`CardId=/^[a-z]{2,6}-\\d{4}$/`，`CategoryId` 非空、無路徑分隔符與空白）加上 **2026-10-01 實際唯讀掃過**的 `learning/` 與 `contracts/fixtures/`。

工作樹沒有 `learning/`；依派工指示，主目錄的 `learning/` 僅以唯讀方式掃描。本工作樹的 `contracts/fixtures/` 為受版控 fixtures。主目錄 `learning/` 自身是 Git repository，故排除其 `.git/` 管理資料；它不是 `learning/` 的應用資料，也不應當是 `LearningFs` 的可存取項目。

```sh
# learning/.git 排除後，僅量測目錄名與檔名；不輸出到報告。
find '<主目錄>/learning' -path '<主目錄>/learning/.git' -prune -o \
  -mindepth 1 \( -type d -o -type f \) -printf '%f\\n'
find 'contracts/fixtures' -mindepth 1 \( -type d -o -type f \) -printf '%f\\n'
```

同一輪輸出摘要（只保留計數、字元集合與長度）：

```text
learning_files=63
learning_directories=9
fixture_files=71
fixture_directories=21
combined_file_count=134
combined_file_max_bytes=37
entry_count=164
unique_entry_names=114
max_name_bytes=37
observed_characters=[A-Za-z0-9._-]
non_[A-Za-z0-9._-]_names=0
category_count=1
longest_main_learning_relpath_bytes=31
longest_fixture_relpath_bytes=43
```

樣本含大寫 ASCII 名字，但主 learning 應用資料的既有路徑均為小寫 ASCII。樣本仍只有一個分類，不能據此否定 §1 所容許的中文分類；所以樣本只用來量測既有形狀、最長值與已出現的 ASCII 字元，**不**用來將 `CategoryId` 收窄成 ASCII。

## 大小寫決定的依據

採「白名單只收 ASCII 小寫」而不是「接受混合大小寫後查檔案系統有無同名異大小寫」。理由如下：

- `CardId` 本來就只含小寫 ASCII；實際 learning 路徑也沒有大寫 ASCII。
- Windows 與一般 macOS 預設檔案系統會把僅差大小寫的名字視為同一檔；一律拒絕大寫可在邊界上保證單一拼法，不需每次讀取額外列目錄或查檔。
- Microsoft 的檔名規範也明示不可假定大小寫敏感。

## `raw/` 是否有 UI 經 LearningFs 讀取

結論：**沒有。建議 §13 明定 `LearningFs` 不服務 `raw/`，讀、寫一律拒絕。**

下列 `git grep` 直接檢查 UI app source；第一個命令沒有任何匹配，exit status 為 1。第二個命令列出 4 個目前 production `fs.read` 呼叫：其匿名化路徑樣式為一筆 `cards/<分類>/<id>.md`、一筆 `questions/<id>.yaml`、一筆 `state/<檔名>.json`、一筆 `config/<檔名>.yaml`；沒有 `raw/<分類>/<檔名>`。

```sh
git grep -n -E "['\\\"]raw/" -- apps
# output: （無）
# exit_status=1

git grep -n -E 'fs\\.read\\(' -- apps
# output: 4 production read 呼叫；路徑樣式如上。
```

教學卡的 `cardPath` 建構結果為 `cards/<分類>/<id>.md`；不是 `raw/`。UI 中 `raw` 的字樣只可能是 source frontmatter 的顯示值或 Vite build-time fixture text import，不是透過 `LearningFs` 讀使用者的 `learning/raw/`。

此結論的界限：CLI ingest 與其測試確實使用匿名路徑樣式 `raw/<分類>/<檔名>.md`，但那不是 UI、不是 `LearningFs`，也不應藉由放寬桌面 UI 的檔案安全邊界來遷就。若後續真要在 UI 顯示或選取 raw 素材，必須先另訂一個明確的讀取需求及其字元策略。

## Windows 保留裝置名：原文核實

已查閱 Microsoft Learn 的原文：[Naming Files, Paths, and Namespaces](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)。其列出的保留名為：

```text
CON, PRN, AUX, NUL,
COM1–COM9, COM¹–COM³,
LPT1–LPT9, LPT¹–LPT³
```

同一原文說明：保留名後直接接副檔名仍等價，並特別說明 ISO/IEC 8859-1 上標數字 `¹`、`²`、`³` 會被 Windows 當作 COM/LPT 裝置名中的數字。因此 §13 第 6 條應補上六個上標形式。`COM0`、`LPT0` 不在該原文列舉中，故不臆測加入。

注意：建議的主白名單本身不收 ASCII 大寫或上標數字，所以大寫上標裝置名會先因字元集合拒絕；仍把它寫入保留名清單，讓規格完整反映平台規則，並避免未來字元集合放寬時遺漏這一層。

## Unicode 正規化裁決建議與向量

因建議允許 CJK，§13 必須釘死 NFC，且是「檢查、拒絕」而不是轉換：`relPath` 若不等於其 Unicode NFC 形式即拒絕。這維持契約既有的「被檢查字串與被使用字串逐位元相同」原則，並避免 NFC/NFD 在不同檔案系統上指到看似同名檔案的分岔。

建議加入最小向量（NFC Hangul 單一碼點 vs 同一音節的 NFD Jamo 序列）：

| 操作 | 輸入 | 結果 | 依據 |
|---|---|---|---|
| `read` | `"cards/<NFC-Hangul>/<id>.md"` | 通過字元與 NFC 檢查 | 已是 NFC；Hangul 在允許 scripts 內 |
| `read` | `"cards/<NFD-Hangul>/<id>.md"` | 拒絕 | 同一音節的 NFD，不得轉換後使用 |

這些是字元／正規化邊界向量；是否存在該實體檔案屬後續 read 的正常檔案不存在結果，與路徑白名單通過無關。

## 建議回填 §13 的完整文字（待技術顧問核定）

以下文字設計為取代 §13 中「字元集合與長度上限」尚待推導的段落，並同步補強既有的 raw read 與保留名條文；可直接貼回後再由契約角色調整版本／措辭。

> **字元集合、大小寫、正規化與長度（2026-10-01 推導）。** 本規則的來源是 §1 的 `CardId`（`/^[a-z]{2,6}-\\d{4}$/`）與 `CategoryId`（非空、無路徑分隔符與空白），加上 2026-10-01 實際唯讀掃過 `learning/`（排除其 `.git/`）及 `contracts/fixtures/` 的目錄名與檔名。掃描到 164 個目錄／檔案項目（134 個檔案），名字字元均落在 `[A-Za-z0-9._-]`；最長名字 37 UTF-8 bytes，最長既有 learning 相對路徑 31 bytes、fixture 相對路徑 43 bytes。主 learning 僅有一個分類，此樣本不能收窄 §1 所容許的中文分類。
>
> 每一段的每個字元必須是 ASCII `a`–`z`、ASCII `0`–`9`、`_`、`-`、`.`，或 Unicode Script 為 `Han`、`Hiragana`、`Katakana`、`Hangul` 的字元。ASCII 大寫字母不允許；這讓僅差 ASCII 大小寫的兩種拼法不會同時進入邊界。既有的「段不得以 `.` 開頭或結尾」規則仍適用。整個 `relPath` 必須已是 Unicode NFC；實作只比較／驗證並拒絕非 NFC 輸入，**不得**正規化後再使用。總長度以 UTF-8 bytes 計，最多 240 bytes。此數字是明示的邊界上限（高於本次 43-byte 樣本，且低於常見單一檔名 255-byte 級限制），不保證任意使用者所選 learning 絕對路徑都符合作業系統的全路徑上限。
>
> **`raw/`。** `LearningFs` 不服務 `raw/`。`relPath` 的第一段以固定 ASCII 不分大小寫比對後若等於 `raw`，`read` 與 `write` 均拒絕；不得因 raw 素材可能含空白、中文或大寫檔名而放寬本邊界。2026-10-01 的 UI source `git grep` 找到的 `LearningFs.read` 僅讀匿名化樣式 `cards/<分類>/<id>.md`、`questions/<id>.yaml`、`state/<檔名>.json`、`config/<檔名>.yaml`，沒有 `raw/<分類>/<檔名>`。CLI ingest 對 raw 的讀取不在 LearningFs/UI 範圍。
>
> **Windows 保留裝置名。** 每一段在第一個 `.` 前的部分，以固定 ASCII 不分大小寫比對後，不得等於 `CON`、`PRN`、`AUX`、`NUL`、`COM1`–`COM9`、`COM¹`–`COM³`、`LPT1`–`LPT9`、`LPT¹`–`LPT³`。保留名後直接接副檔名亦拒絕。此清單已按 Microsoft Learn〈Naming Files, Paths, and Namespaces〉原文核實；原文沒有 `COM0` 或 `LPT0`，不列入。

## 不確定處與後續責任

- 240 bytes 是建議的 policy cap，不是可由現有樣本或 §1 唯一推得的數學結果；技術顧問若偏好更短／更長上限，應保留「UTF-8 bytes」這個跨 Rust/TypeScript 可一致實作的度量方式，並同步更新向量。
- 建議允許的四個 CJK scripts 是為滿足「可能含中文」並採用契約 §2 已使用的 CJK script 分類。若產品只要中文，技術顧問可限縮為 Han；那會改變日文／韓文分類能否使用的產品政策，不能由目前單一分類樣本判定。
- 這輪只產出推導；不寫測試、不寫 Rust/TS 實作，也不自行改契約。後續實作須將 NFC 檢查置於白名單／使用同一字串的邊界上，不能藉正規化、大小寫摺疊或其他轉換把被拒絕的輸入變成可使用路徑。
