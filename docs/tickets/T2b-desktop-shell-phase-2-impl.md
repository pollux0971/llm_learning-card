---
id: T2b
deps: [10-desktop-shell/phase-1]
touches: [apps/desktop/, features/steps/]
cpu: heavy                             # cargo-mutants、完整 cargo test
budget_usd: 8                          # 這一輪修補的預算;第一輪沒有預算,實際花了 $29.08
status: merged
owner: worker-grok
must_catch:
  - 白名單漏掉 Unicode Mark(M)類別(含組合記號)
  - 保留名漏掉 com9(及 COM¹–COM³ 上標)
  - raw 的五個方法(read write list exists assetUrl)有一個沒拒
  - 先檢查後轉換:`..\..\etc\passwd` 與反斜線列
  - 拿掉 canonicalize 比對,symlink 場景必須變紅
  - asset handler 對雙重編碼 `..%252f` 放行
---

# 工單 T2b:10 desktop-shell phase-2 的實作(T2 的階段 1)

> 狀態:草稿,待技術顧問審。
> 作者:統籌·契約。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 預算:第一輪沒有預算,實際花了 $29.08(顧問 2026-10-15 記);退回修補這一輪的預算是 $8。
> 與 T2 的關係:T2 的階段 0(字元集合、大小寫、保留名、`raw/` 讀取的推導)已由報告完成,結論由技術顧問裁決後
> 寫進契約 §13 的 1.3.1(見 ADR-063)。**本張是實作。T2 的條款處理如下,其餘以本張為準。**

## T2 條款的去向

| T2 條款 | 在本張的處理 |
|---|---|
| 1(`phase-2.feature` 紅→綠) | 沿用,但 feature 要先更新到 §13 1.3.1(見「前置」) |
| 2、3(字元集合、NFC 的推導) | **已完成**,結論在 §13 1.3.1,不再是義務 |
| 4(先檢查後轉換的對照) | 沿用 |
| 5(asset protocol 旁路) | **取代**,見驗收 A |
| 6(不得讓 Rust 寫 §10 事件) | 沿用 |
| 7(邊界例外 10→01,只放 `recordEvent`) | 沿用,開工第一步先查落點名稱與 TS 側檔案位置,不憑本稿 |
| 8、9(cargo-mutants、鎖) | **修訂**,見驗收 E |
| 10(紀錄附 host / worker / load) | 沿用 |
| 11(gherkin 格子對照) | 沿用 |
| 12(兩份 `MemoryFs` stub 的 guard 漏洞) | 沿用 |
| 13(載入真前端) | 沿用 |
| 14(`LearningFs` 介面提升進 `packages/contracts`) | 仍不在本張 |

## 前置

- **§13 的 1.3.1 已在 main**(分支 `contracts-1.3.1`,待顧問審、協調者合併)。**測試 agent 要等它進 main 才開始。**
- `features/10-desktop-shell/phase-2.feature` 要先對齊 1.3.1:`raw/` 的五個方法全拒、NFC 與字元集合的向量用真碼位、
  大寫與 `ー` 通過、保留名清單(含 `COM¹`–`COM³`、不含 `COM0`)。**這由統籌·契約更新、顧問審過再交測試 agent**
  (測試 agent 不寫 gherkin)。
- `features/10-desktop-shell/FEATURE.md` 的 phase 表目前 phase-2 是 `todo`;狀態更新歸 phase-done 流程,不在本張手動改。

## 驗收條件

### A. asset protocol(取代 T2 第 5 條;最重要,否則 phase 會全綠但有完整旁路)

**第一步先驗,結論寫進回報,再決定實作方式**(前端提醒內建的 `assetProtocol.scope` 是 glob 允許清單,
表達不了 §13 的保留名、結尾點、NFC):

1. Tauri 2 的 `register_uri_scheme_protocol` 能不能掛我們自己的檢查(解碼恰好一次 → 同一份白名單 → 通過才讀);
2. 內建的 `asset:` 協定能不能關掉。
   現況(統籌·契約讀 main 上的檔):`tauri.conf.json` 的 `security` 只有 `"csp": null`、沒有 `assetProtocol`;
   `Cargo.toml` 的 `tauri` 沒有開 feature;`capabilities/default.json` 只有 `core:default` 與 `window-state:default`。
   **這可能代表內建協定現在就沒開,也可能不是;未驗證,不要假設。**

驗收:**內建 `asset:` 協定關閉,或其 scope 為空;並有測試證明直接用 `asset:` URL 讀 `learning/` 內的檔會被拒絕。**
asset handler 的拒絕只進 Rust log、不寫 §10 事件(已登記的已知限制,T2 第 6 條)。
**asset handler 要有一列 `raw` 的 `assetUrl` 被拒**(除了 `..%252f` 雙重編碼):`LearningFs` 的五個方法
(`read`、`write`、`list`、`exists`、`assetUrl`)對第一段是 `raw` 的路徑**全部拒絕**(§13 1.3.1),`assetUrl` 若不拒絕,
webview 就能拿到 `raw/` 檔案的 URL 繞過 `read`。
**`assetUrl` 是同步簽名**(§13:`assetUrl(relPath: string): string`),不可能往返 Rust command:TS 側的拒絕只是**提示**
(函式自己丟錯、不呼叫 `recordEvent`),**權威是 asset handler 在 webview 真的請求該 URL 時拒絕**。
所以 `phase-2.feature` 把 `assetUrl` 放在獨立場景,不放進另四個方法的 Outline。
**第一步驗證 `register_uri_scheme_protocol` 時,一併回報 `assetUrl` 要怎麼產生 URL**(例如用 `convertFileSrc` 還是自訂協定的 URL 形式),
以及 TS 側提示用的是哪一份檢查(§13 已說 Rust 為權威、TS 只是提示)。

### B. 白名單檢查(§13 1.3.1,Rust 為權威)

3. 拒絕與通過的向量用 `phase-2.feature` 與 §13 向量表(**真碼位**,不是佔位)。
   **`raw` 的五個方法全拒要各有場景**:`read`、`write`、`exists`、`list("raw")` 在同一個 Outline(拒絕往返 TS、記 `recordEvent`);`assetUrl` 在獨立場景(同步簽名,見驗收 A)。對第一段不分大小寫:`Raw/` 也拒。
4. **NFC 檢查要新增 Rust 相依**(例如 `unicode-normalization`):**工單回報要寫出名稱、版本、用途**,
   並記下它帶的 Unicode 版本(§13 已知限制:Rust 與 TypeScript 的 Unicode 版本可能不同,Rust 是權威)。
5. 對照:把實作改成「先檢查、後轉換」,`..\..\etc\passwd` 與拒絕 Examples 的反斜線列必須變紅(沿用 T2 第 4 條);
   `raw/` 讀寫拒絕、結尾點、保留名各自「拿掉那一條檢查,對應場景必須變紅」。

### C. symlink 檢查(與白名單是兩道**獨立**的檢查,驗收分開列)

6. 路徑 `canonicalize` 後必須在 `learning/` 根目錄之內;指向根目錄外的 symlink 拒絕(`phase-2.feature` 已有場景)。
7. 對照:拿掉 `canonicalize` 比對,symlink 場景必須變紅;**白名單那組驗收在這一步仍然全綠**
   (證明兩道檢查互相獨立,不是其中一道在替另一道擋)。

### D. 其餘沿用 T2

8. T2 的 1、4、6、7、10、11、12、13(見上表)。

### E. cargo-mutants 與鎖(修訂 T2 第 8、9 條)

9. 先安裝 `cargo-mutants`(**安裝耗時與版本進報告**,不是只進 commit 訊息),對第一版防護跑一次,
   第一次實測的值當地板;門檻只准升不准降;設定檔寫明「這個地板來自 cargo-mutants 的第一次實測,不是 Stryker 的 95%」。
10. **鎖的現況(T0 證實,還沒修)**:`.stryker.lock` 目前**每個 clone 一把**,不是每台機器一把。
    所以 cargo-mutants「取 `.stryker.lock`」只擋得住同一個 clone 內的互撞。**這張工單的重活
    (cargo-mutants、完整 `cargo test`)不得與別的重活同時跑,協調者負責排。** 鎖的範圍要不要跨 clone 是 T3 的 B2 要量的事,不在本張。

## 測試誰寫

- 測試 agent:紅測試與步驟定義(照 `features/steps/_world.ts`),**等 §13 1.3.1 進 main 才開始**。
- 審核 agent:驗收 B5、C7 的對照與 Rust 變異。
- 開發 agent:只寫實作,不改測試。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,同一時間一個 agent。派工歸協調者。
