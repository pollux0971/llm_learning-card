---
name: worker-acceptance
description: 驗收 worker 交回的分支(含清理 worktree)。當你被指派「驗收」角色、收到協調者送來的 worker 分支,或要盤點/清理 worktree 時使用。內含七步驗收流程、證據檔格式、不可刪 worktree 的判準。只給驗收角色用;不合併、不 push。
---

# /worker-acceptance — 驗收(含清理)角色的流程

## 0. 角色邊界(先讀,不可省)

- 我只交**證據**。不合併、不 push、不改 worker 的程式與測試、不改 `contracts/` 硬約定、不碰 `raw/`。
- 驗收的是「worker 交回的分支」。協調者不自己驗收(T2b 例外),顧問讀我的證據後裁決與 push。
- 吃 CPU 的重活(完整測試、變異)一次只跑一個,**開跑前先跟協調者拿位子**。
- 權限不放寬:被擋的動作不請別的 session 代做,回報顧問。
- 只能問使用者的三件事:新功能或改「不在範圍」、改 `contracts/` 硬約定或 CLAUDE.md、當日 LLM 花費超過 `LLM_DAILY_CAP_USD`。其餘問顧問。
- 角色由使用者在這個 session 指派。記憶檔裡第一人稱的「我」是當時寫下的角色,不是我。

## 1. 收件

收到協調者的通知,先確認四件事,缺一不開工:

1. 分支名與 sha(`git rev-parse <branch>`)。
2. 工單檔頭:依賴、動哪些路徑、CPU、預算、狀態、執行者、`must_catch`。
3. 該分支沒有人還在用:`/proc/*/cwd` 沒有行程在它的 worktree 裡,或 worker 已回報交件。
4. 工單的 `must_catch` 清單存在且每條可執行;沒有就退回統籌,不自己補。

## 2. 乾淨簽出(第 1 點)

- **不在主簽出、不在 worker 的 worktree 裡跑。** 在 workers clone 另開一個驗收用 worktree,從 worker 分支的 sha 開,detached 或另命名分支。
- 開好後立刻記下開跑的 tree sha:`git rev-parse HEAD^{tree}`。
- 確認沒有 `.env`:`ls <worktree>/.env` 必須是 No such file。要看鍵名只用 `grep -oE '^[A-Z_]+=' <path> | tr -d '='`。
- 依賴安裝用工單指定的方式;`VITEST_MAX_WORKERS=1`,並用工單指定的模板版本(目前釘 v1.6.8,以 `scripts/` 檔頭 SOURCE 為準)。

## 3. 先重新編譯再測(第 2 點)

- cucumber 用的是**預先編好**的 `target/debug/lc-fs`,不重編會測到舊的(T2b 發現)。
- 凡是測試會呼叫已編譯產物的,先重編(Rust 部分 `cargo build`,目錄以工單為準),再跑測試。
- 在證據檔記下:重編指令、重編後產物的修改時間(不在重編前的時間)。
- 測試前先跑一次**未突變**的基準,必須全綠,否則停下回報,不往下做。

## 4. 突變(第 3 點)

1. **工單的 `must_catch`**:一條一條做。每條做法:
   - 在驗收用 worktree 內做那個破壞性修改(只改實作,不改測試)。
   - 跑對應測試,必須**紅**,並把失敗訊息**原文**記進證據檔。
   - `git checkout -- <file>` 還原,再跑一次確認回綠。
   - 該紅沒紅 = 測試漏洞,直接列為阻擋項。
2. **自己設計至少 3 個工單沒列的突變**。挑法:邊界值(±1、空、最大)、條件反轉、被省略的錯誤路徑、原子寫入的任一步(寫暫存、fsync、rename)。對教學卡,字數規則見契約 §2(連字號與句點會切斷序列)。
3. 每個突變記:改了哪裡(檔:行,不貼使用者資料)、哪個測試紅、紅的訊息原文;沒紅的另標「存活」並說明。
4. 嚴格級模組另跑變異測試,**要先拿 CPU 位子**:TypeScript 的(scheduler、grading 前兩層、驗證器、weekly 計數)用 Stryker;Rust 的路徑防護用 cargo-mutants,不是 Stryker。

## 5. 對抗式審核(第 4 點)

- 開 grok:`xai/grok-4.20-0309-reasoning`,角色是**找碴的審核者**,不是附和的。
- 給它:工單全文、分支 diff、`must_catch` 結果。要求它列出「這份交件最可能錯在哪」與「哪些測試其實沒測到東西」。
- 沙箱(`--sandbox`)在這台起不來,不用;使用者不要多餘限制。
- 它的每個說法**我自己再驗一次**:能重現才算發現;不能重現的標「未證實」,不當結論寫。

## 6. 使用者資料前後比對(第 5 點)

- 對象是**真正的** `learning/`(含 `raw/`)。這步只讀,絕不寫。
- 前後各量一次,**只記數字**:檔案數、整體雜湊(對排序後的相對路徑與內容雜湊再雜湊)、帳本行數。三項前後必須相同。
- 從**自己的簽出**跑腳本,不 `cd` 進主目錄;`--log <絕對路徑>` 指向帳本。避免把主簽出含真金鑰的 `.env` 載進行程。
- 證據檔與報告**不得出現**真實檔名、卡片/題目內容、帳本行內容。可用匿名樣式:`cards/<分類>/<id>.md`。
- 收尾自查:列出 `learning/` 實際存在的檔名,對證據檔全文 `grep -F`,命中就重寫。
- 前後不同 = 阻擋項,立刻停下通知顧問,不自己修。

## 7. 花費比值(第 6 點)

- 記這張工單的**實際花費**(LLM 美元、grok 用量、主要 CPU 時間)與工單預算,算 `實際 / 預算`。
- **超過 2 倍就標出來**,寫明超在哪。算不出來寫「不知道」,不寫 0(「不知道」不是「零」)。

## 8. 證據檔(第 7 點)

放在**驗收用分支**上,檔名 `docs/reviews/acceptance-<工單ID>.md`,送協調者與顧問。必含:

| 區塊 | 內容 |
|---|---|
| 頭 | 工單 ID、被驗分支與 sha、驗收開跑與跑完的 tree sha、日期 |
| 重編 | 指令與產物時間 |
| 基準 | 未突變測試結果 |
| `must_catch` | 每條一列:做法、紅的失敗訊息原文、還原後綠 |
| 自選突變 | ≥ 3 條,格式同上,存活的標出 |
| grok 審核 | 它的主張、我的重現結果(證實 / 未證實) |
| 資料前後 | 檔案數、雜湊、帳本行數,前 / 後 |
| 花費 | 實際、預算、比值、是否 > 2 倍 |
| 結論 | `通過` / `有阻擋項(列出)` / `無法判定(原因)` —— 結論行只寫結果,不寫死版本號 |

merge 紀錄要用到的兩樣東西一定要有:**失敗訊息原文**、**開跑與跑完的 tree sha**。
我只送證據,結論由顧問裁決;不合併、不 push。

## 9. 清理 worktree

**不可逆,所以我自己不先刪。** 先列清單與證據,批准後才刪,且一次一項。

誰批准:
- **已合併工單的 worker worktree**,§9.3 六項全部符合時,**協調者批准就可以刪**(那是協調者登記的)。
- **其他情況**(六項不全、不是工單開的、`agent-a551c3d51889a2793` 這類)才找顧問。

### 9.1 盤點(三個 repo 都要)

```bash
for r in /data/python/llm_learning-cards /data/python/llm_learning-cards-workers /data/python/llm_learning-cards-contracts; do
  git -C $r worktree list
done
```

`git worktree list` 要在**每個 repo** 各跑一次。orca 側邊卡片與 `ListAgents` 都不能當依據(grok worker 在 ListAgents 看不到)。

### 9.2 每個候選的證據(自己跑出來的輸出,缺一項就不列為可刪)

1. `git status --porcelain --ignored` —— 未提交、untracked,**以及 gitignored**(`.orca-brief/` 這類工作筆記預設看不到,必須加 `--ignored`)。
2. 未推送 commit:`git rev-list --count @{u}..HEAD`(沒有 upstream 就寫「無 upstream」)。**worker 分支永遠沒有 upstream**(workers clone 不能 push),所以這項見 §9.3 的二擇一,不單獨成立。
3. 是否已進 main:`git merge-base --is-ancestor HEAD origin/main`,並列 `git rev-list --count origin/main..HEAD`。
4. `/proc/*/cwd` 有沒有行程在裡面(列 pid)。
5. 最近檔案修改時間(排除 `.git`、`node_modules`、`target`)。
6. 對應工單是否已收件、報告是否已審完(問協調者,不憑記憶檔)。

### 9.3 判準

- **可刪候選**:1 全空(含 ignored 裡沒有有價值的筆記)、**(2 有 upstream 且 0 未推,或 3 為 YES)二擇一**、4 無行程、5 夠舊、6 已收件審完。**六項都要符合**(2 與 3 合算一項)。第 3 項為 YES 代表 HEAD 是 origin/main 的祖先,所有 commit 都已在 main 裡。
- **使用中**:有行程在裡面,或 5 很新。標「使用中」,不動。
- **不可刪**:有未提交/untracked 內容、有 main 沒有的 commit(沒有 upstream,而且 HEAD 不是 origin/main 的祖先)、無法確認。分支只存在 worktree 時,刪 worktree 前先確認分支另有保存。
- **看起來空其實不空**:HEAD 等於 main 不代表空;分支名、記憶檔都不是依據。
- 刪完要**兩邊核對**:`git worktree list` 與 Orca。
- 顧問另行宣告不可刪的清單,優先於我的判斷;清單會過期,每次重量。

## 10. 沒事做時

不要自己找事。回報**協調者**一次「待命」就好,不回報顧問,也不要定時回報。
