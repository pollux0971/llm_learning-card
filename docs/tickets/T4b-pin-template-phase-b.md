# 工單 T4b:`check:gates` 釘住模板版本(T4 的階段 B)

> 狀態:草稿,待技術顧問審。T4 階段 A 的報告已審(量測結論由顧問裁決,見下)。
> 作者:統籌·契約。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 與 T4 的關係:T4 是階段 A(只量);本張是 T4 的階段 B,做的是 T4 的「過渡期」小節所說的那件事。

## 做法(技術顧問 2026-10-14 裁決)

**候選 (b):執行期用 `git archive` 取 `SOURCE` 標頭寫的 commit,再用那份跑 `sync-gates.sh --check`。**
拒絕 (a) 存副本(會漂移)與 (c) submodule。

## 條件

1. **標頭必須恰好一種 (版本, commit) 組合。** 掃 `scripts/` 底下所有「第一行符合 `^(//|#) SOURCE: template v`」的檔
   (**用 `head -1`,不要用 `grep -l` 掃全檔;要用 `grep` 的地方加 `-a`**,見 T4 的 A3:同一個「數檔案」的動作,
   不同寫法差一個檔而且不報錯)。組合不是恰好一種,**紅,並列出檔名與值;不准多數決。**
2. **缺席一律紅,不准退回活的 HEAD。** 模板 repo 取不到、commit 取不到、archive 解不出 `sync-gates.sh`,
   全部紅。現況基準(T4 量過):模板目錄不存在時 `check:gates` 是 rc=127,直接紅;新做法不得退步成綠。
   腳本用 `set -euo pipefail`,暫存目錄用 `trap` 清掉。
3. **實作成「我們自己的」包裝腳本**:**不要帶 `SOURCE` 標頭**,不碰任何模板擁有的檔(`check-all.ts`、
   `sync-gates.sh`、任何第一行有 `SOURCE` 標頭的檔)。`package.json` 的 `check:gates` 改呼叫它。
4. **兩個變數語意不同,不要混用**:
   - `TEMPLATE_DIR`:使用者**明確設了**就維持現行行為,直接用它(CI 會需要);
   - 模板 **repo** 的路徑用另一個變數(預設 `/data/python/dev-paradigm`),給「執行期取 commit」用。
5. **不新增獨立的完整性 gate。** 「標頭同版」這一半已內建在條件 1 的唯一性檢查。
   「新增檔忘了標頭」(`sync-gates.sh --check` 比每個檔的 sha,不會發現有人新增一個該帶標頭卻沒有的檔)
   這一半:**接受並登記為刻意不做**。
   **落點(技術顧問 2026-10-14 裁決)**:**ADR,不加登記表條目。** T4b 做完時顧問寫 ADR-064,Consequences 寫明
   「新增檔忘了標頭,這個義務刻意不守」、理由、以及誰會發現(沒人,這就是代價);T4b 的報告也寫一句指向它。
   理由:`scripts/deliberately-absent.json` 的欄位是 `{adr, path, reason}`,主鍵是「刻意不存在的**路徑**」;
   `scripts/gates.config.json` 的 `unwired` 欄位是 `{file, reason}`,主鍵是「**守門腳本檔名**」;
   「刻意不守的一項義務」兩個都不是。
6. **上游提案**(`sync-gates.sh --check` 不該因模板自己新增需求而對舊版消費端變紅)**等本張做完再送**,
   要帶 T4 的 2×2 證據與本張實作後的結果。

## 驗收條件

1. 包裝腳本存在且**第一行不是 `SOURCE` 標頭**;`package.json` 的 `check:gates` 呼叫它。
2. 正常情況:25 個標頭同為 `template v1.6.8 (88a3e11)`,模板 repo 在預設路徑,輸出末行
   `✓ 守門內容自同步以來未被更動`,rc=0。**rc 要用「先存變數再看 `$?`」量,不要接 `| tail`**(管線會吃掉 rc)。
3. **紅燈對照(三個,都要非零退出碼,都用合成 fixture,不要動真的標頭,不要動模板 repo)**:
   - 不存在的 commit(標頭寫一個模板 repo 裡沒有的 sha);
   - 不存在的 repo(模板 repo 路徑指向不存在的目錄);
   - 混版標頭(合成 fixture 裡兩個檔的 (版本, commit) 不同)。**兩個 commit 必須是兩個不同的、都存在於模板 repo 的合法 commit**,
     才算測到「唯一性」,不是只測到「commit 不存在」(那是第一個對照)。
   三個都要有「把對應檢查拿掉,測試必須變紅」的對照。
4. `TEMPLATE_DIR` 明確設定時維持現行行為(直接用,不經 `git archive`),有測試;**包裝腳本在這種情況要印一行
   「TEMPLATE_DIR 明設,未驗證釘版本」**(不印的話,人會以為釘版本已經被檢查過),測試要斷言這一行存在。
5. 取 tag 要比 **commit**,不是 tag 物件(`v1.6.8` 是 annotated tag:`git rev-parse v1.6.8` 是 tag 物件,
   `git rev-parse 'v1.6.8^{commit}'` 才是 `88a3e11`)。有測試。
6. 沒有修改任何帶 `SOURCE` 標頭的檔,也沒有動 `/data/python/dev-paradigm`(只讀;不 checkout、不改 index、不建 tag):
   用 `git status` 前後各一份證明。

## 測試誰寫

測試 agent 先寫紅測試(3、4、5);開發 agent 只寫包裝腳本,不改測試;審核 agent 做 3 的「拿掉檢查就紅」對照與變異。

## 不在範圍

升模板(什麼時候升由顧問裁)、改 `sync-gates.sh`、新增獨立的標頭完整性 gate。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,同一時間一個 agent。派工歸協調者。
