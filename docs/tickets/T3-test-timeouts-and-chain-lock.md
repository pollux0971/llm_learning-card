# 工單 T3:測試逾時、自我競爭與整鏈鎖

> 狀態:第二版,待技術顧問對 B1a 的範圍確認後由協調者派工。
> 作者:統籌·契約。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。

## 性質

兩階段。**階段 B 在階段 A 被技術顧問審過之前不得開始。**

## 背景證據

- 對照組 `e3bf2d9` 只跑三檔:1 failed(`Test timed out in 5000ms`)。
- `17dc78f` 全跑:10 failed,全是逾時,零個斷言失敗。
- 兩次的 load 不同(40 與 52),差的是程度不是性質。**不要拿 1 和 10 算比例。**
- 技術顧問的量測(2026-10-01):host=pollux-IdeaPad、cores=8。起跑 load 24.56(08:23:14),
  啟動完整鏈 90 秒後 load 50.06(08:24:44)。**load 52 大部分是這條鏈自己造成的**,不是外部變因。
  所以「等 load 降下來再跑」做不到:整套自己就是 load。

## 事實(統籌·契約量的,唯讀)

| 事實 | 量法 | 結果 |
|---|---|---|
| 測試檔母體 | `git ls-files '*.test.ts' \| wc -l` | 113 |
| 會 spawn 子程序的 | `git grep -lE "spawnSync\|execFileSync\|execSync\|child_process\|spawn\(" -- '*.test.ts'` | 32 檔(多數在 `scripts/`) |
| vitest 逾時與並行度設定 | `grep -n "Timeout\|pool\|maxWorkers\|threads" vitest.config.ts` | 無輸出:`testTimeout`、`hookTimeout`、`pool`、`maxWorkers` 全部沒設,走 vitest 預設(測試 5000ms、worker 數接近核心數) |
| 鎖 | `.stryker.lock` 出現位置 | 只在 `run-tests.ts`、`mutate.ts`、`zero-input-roster.ts` 與其測試;`check-all.ts` 沒有任何鎖 |
| `check-all.ts` 的歸屬 | 檔頭 | `SOURCE: template v1.6.8 … 勿手改`,是模板擁有的檔,不能在本 repo 直接改 |

所以 5000ms 是「**從來沒有人做過這個決定**」,不是「有人選了太小的值」。

## 階段 A(只量,不改程式)

**A1 盤點。** 列出 32 檔裡每個會 spawn 子程序的測試,欄位:檔案:行、測試名、spawn 什麼、有效逾時
(明寫 or 預設 5000)、來源行、**是否 spawn 到會編譯的東西**(cargo build、tsc 等;之後 cargo-mutants
進來,一個 spawn npm 的和一個 spawn cargo 的耗時差一個量級)。母體大小寫在報告最前面。
方法說明必須寫:光 `grep 'timeout'` 會把 `scripts/mutate.test.ts` 第 2915、2931 行、
`scripts/reports-persist.test.ts` 第 184 行的 `timeout: 1` / `timeout: 0` 混進來——那是被測程式的參數,
不是 vitest 的測試逾時。

**A2 分類。** 每個測試三選一,每列附證據(把逾時拉大之後斷言還成不成立;讀碼,必要時實跑):

- (a) 逾時是斷言的一部分(拉大 10 倍會改變測試的意義)。
- (b) 從來沒有被決定過(沒有人選過這個值,是未填的空格)。
- (c) 不確定。判不了就列 (c),不要硬塞 (a) 或 (b)。

**A3a 單獨量。** 一次只跑一個 spawn 測試,其餘不跑;每個測試三次;記耗時、host、cores、load(1/5/15)。
得到「沒有自我競爭時要多久」。

**A3b 整套量。** 跑整套,記同一批測試在整套平行時的耗時;至少三輪;記 host、cores、worker 數、起跑 load。
得到「113 個檔平行跑的時候要多久」。

**兩者的比值**就是自我競爭讓這個測試慢幾倍。5000ms 預設值該不該動,取決於這個比值,不取決於任何一次耗時。
一次的耗時也不告訴你變異度:平均 1000ms 偶爾 4800ms 的測試,比穩定 4000ms 的更危險。

**A4 報告。** 放 `docs/reviews/`,帶 host、worker 數、load。報告要寫明**本工單不寫 `.feature`** 的理由:
守門基礎設施的驗收方式是 `scripts/*.test.ts`(現有 20 支守門、28 支測試,零個 `.feature`);
gherkin 的價值是用使用者的語言表達產品行為,一把跨 worktree 的檔案鎖沒有使用者可見的行為,
它的規格就是它的測試。這是對 CLAUDE.md「沒有 gherkin 不寫程式」(強烈建議)的有說明的例外。

**顧問審過 A 才開 B。**

## 階段 B

**優先順序:B1 比 B2 重要,B1a 最重要。** 若時間只夠一件,先做 B1a。

### B1 自我競爭與逾時(兩件一起量、分開記)

**B1a 限制 vitest 的 worker 數。** `vitest.config.ts` 現在完全沒設 `pool` / `maxWorkers`。
8 核預設開接近核心數的 worker,每個 worker 裡的測試又各自 spawn 子程序,約 16 個行程搶 8 核。
工單**不裁數值**,產出「worker 數 → 整套耗時與逾時數」的曲線,至少三個點(例如 8、4、2),
每點記 host、cores、起跑 load、耗時、逾時數。`timeout` 與斷言不動。

> ⚠️ 範圍待顧問明說:B1a **能不能把 `maxWorkers` 寫成 repo 的預設值**(動全域 `vitest.config.ts`),
> 還是**只在量曲線時用 CLI 旗標**、結論回報顧問再裁預設值。本版預設採後者(只量、不改全域預設),
> 顧問明說可以改預設才改。注意 `vitest.mutate.config.ts` 是另一份設定,不要連帶改。

**B1b 逾時。** 只動 A2 的 (b) 類(從來沒被決定過的),用單一測試的 `timeout` 參數;
不動全域 `testTimeout`(那要另行裁,因為它會讓真的卡死的測試也拖更久才被發現);(a)(c) 不動。
順序:先 B1a,看曲線,再決定 B1b 還需不需要、範圍多大。

### B2 整鏈鎖(次要)

解決的是「兩條鏈互撞」。**一條鏈自己就能把 8 核吃到 load 50,所以鎖裝好之後單條鏈仍可能逾時,
那屬 B1,不屬 B2。** 「先量 load 再決定跑不跑」不算鎖。

第一步先回答:

- (i) **鎖放哪**:必須是整台主機共用,**不能放在 checkout 裡,也不能是「repo 根」**。每個 worktree / clone
  各有一份 checkout,放裡面就各鎖各的;顧問的 detached 隔離簽出(`/tmp/verify-120` 那類)也會繞過它,
  而且會「成功」,沒有任何訊號。同形狀:ADR-051(記帳檔在每個 worktree 各一份)。
- (ii) **N 是多少**:從 8 執行緒與 A3b 量出的單鏈 CPU 占用推,不憑印象。
- (iii) **鎖被占時**:等多久、輸出誰占著(host / pid / 開始時間)、孤兒鎖怎麼辦。
- (iv) **做在哪**(顧問已裁):現在做 1 —— 本 repo 的 `package.json` 讓 `check:all` 包一層 wrapper 腳本
  (consumer 自己的檔,**不動 `check-all.ts`**);同時做 2 的前半 —— 上游提案給 dev-paradigm,內容是
  「請提供整鏈取鎖的機制,N 與鎖路徑由 consumer 設定」,不是「請改 `check-all.ts`」。提案送出時機:
  A 階段報告出來之後(提案要帶量測)。現在不改模板:`/data/python/dev-paradigm` 有未追蹤項目、
  多個 dev-paradigm session 在線,那棵樹在動。

### B3 鏈輸出

鏈開始、結束、每一步都印 host、worker 數、1/5/15 分 load。

### 射程句(原文,必須寫進報告)

> 本鎖解決整條 check:all 之間的互斥;與 .stryker.lock(變異測試之間互斥)是兩把,各管各的;
> 不解決單條鏈內部的 CPU 占用。

單條鏈內部的 CPU 占用屬 B1,不屬 B2。

## 驗收條件

1. A 報告存在:母體大小在最前;每列有 a/b/c 與證據;A1 有「會編譯」欄;方法說明有 `grep 'timeout'`
   的陷阱;A3 同時有 a 與 b 兩組數字與比值,每個測試三次耗時。
2. **對照(B1 之後)**:比較要在「同 worker 數、同起跑 load 區間」下做,每組記 host、cores、worker 數、
   起跑 load。不同 worker 數的結果不當同一組比。若「改後 0 逾時」但「同設定的改前」不是原本那批逾時數,
   **整個對照作廢,重做**(母體本身不穩定,10→0 沒有意義)。
3. **B1a**:有至少三個 worker 數的曲線(例如 8、4、2),每點有 host、起跑 load、耗時、逾時數。
4. **鎖的正向測試**:同時起兩條鏈,第二條必須等或被拒,並印出第一條的 host / pid。
   對照:把鎖拿掉,第二條立刻跑起來,測試必須紅。
5. **鎖在 checkout 之外**:在兩個不同 worktree 各起一條鏈,仍互斥。
6. **孤兒鎖**:殺掉持鎖行程,下一條鏈能接手,並印出「接手了孤兒鎖」。
7. **鏈輸出**每步都有 host / worker / load。

## 測試誰寫

- 測試 agent 寫 4–7 的測試(用 `scripts/*.test.ts`,不寫 `.feature`)。
- 開發 agent 只寫實作,不改測試。
- 審核 agent 做 A 的抽樣獨立重量、驗收 2 的對照、鎖測試的變異。
  A 的報告不是審核 agent 自己產出的證據,審核 agent 要自己重量其中抽樣的列,不收轉述。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,同一時間一個 agent。

## 不在範圍

- 全域 `testTimeout`(要另行裁)。
- `vitest.config.ts` 的 `maxWorkers` 是否成為 repo 預設值:**見 B1a 的待確認框**,確認前視為不在範圍。
- 鏈內 18 個不拿鎖的步驟如何各自限流。
- 統一字數實作。

## 派工時機

T1 結束前不疊第二張。
