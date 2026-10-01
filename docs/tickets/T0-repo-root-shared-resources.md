# 工單 T0:以 repo 根為範圍的共用資源(花費帳本、鎖、其他),只量不改

> 狀態:草稿,待技術顧問審。**優先序在 T3 之前,因為它牽涉錢。**
> 作者:統籌·契約。派工:協調者。審:技術顧問。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 編號 T0:它在 T3 之前,而且不重編號。

## 起因

2026-10-01 為了讓不該推 main 的角色推不出去,開了兩個 clone(`/data/python/llm_learning-cards-workers`、
`/data/python/llm_learning-cards-contracts`)。這個理由是對的。但同一個動作有一個沒有人預料到的後果:
**它把「以 repo 根為範圍的共用資源」切成互不相通的區域,而且靜默。**

## 事實(技術顧問實測 + 統籌·契約對照 `vault.ts` 原文)

- 花費帳本位置:`packages/core/src/llm/vault.ts` 的 `resolveVaultRoot()`:
  `git rev-parse --git-common-dir` 取上一層,接 `learning/`。與 `strykerLockPath()` 同一個機制,
  **解決 worktree,解決不了 clone**(clone 有自己的 `.git`)。
- 三個 clone 的 `learning/state/log.jsonl`:主 repo 52 行;workers clone 不存在;contracts clone 不存在。
- 統籌·契約補量(2026-10-01):`learning/` 與 `.env` 都在 `.gitignore`(第 29、20 行);
  主 repo 有 `.env` 與 `learning/`,**兩個 clone 都沒有 `.env`、也沒有 `learning/`**。
  所以兩個 clone 目前**不一定拿得到憑證**——這可能讓真呼叫在 clone 裡直接失敗而不是花錢,
  但那是**未驗證的推論**(環境變數、gateway 的 JWT 有沒有別的來源、env loader 往哪裡找,見 A1 的量測項)。
  不要把這個當成「所以安全」。
- 沒有任何環境變數可以釘死帳本位置:`LLM_LEARNING_DIR`、`LEARNING_DIR`、`VAULT_ROOT` 在
  `packages/core/src/llm/*.ts` 與 `golden-run.ts` 零命中(技術顧問 grep)。
- `.env.example` 的 `LLM_DAILY_CAP_USD=1`。日上限的算法是「拿帳本裡今天的行數算花費、跟上限比」。

## 後果

帳本是空的 → 花費是零 → 上限永遠不觸發。三個 clone,每個一美元額度,實際上限變成三美元;
每開一個 clone 就多一美元,沒有任何東西會說。

**煞車(技術顧問已下,本工單期間持續有效)**:任何 clone、任何 worktree 都不准跑 `--live` 或任何會真呼叫的東西。

## 對 T1 的影響(射程,不是對錯)

T1 的 worker 在 workers clone 的 worktree 裡驗證,所以它驗的是「**workers clone 的帳本上**,日上限擋得住」。
那個結論正確,但說明不了「這個帳號一天花不超過一美元」。T1 的報告要加一句射程限制,寫窄:

> 本次驗證的範圍是單一 clone 的帳本。日上限目前以 clone 為單位計算,因此本結論不涵蓋跨 clone 的總額。見工單 T0。

## 範圍:只量,不改

階段 A(只量)。**階段 B 不在 T0 範圍**:把帳本路徑改成使用者範圍會動到契約 §12 目錄結構(硬約定)
與 ADR-051,要走 decision-record,可能要問使用者。T0 只產出一份報告加一份選項清單,
由技術顧問帶著它去判或去問。

### A1 帳本母體

列出這台機器上**所有會算出不同 `learning/` 路徑的位置**(含各 clone、各 worktree),每個附:
行數、最後修改時間、量測日期。母體今天從 1 變 3,還會變,所以日期必須記。
同時量:各 clone 是否拿得到 LLM 憑證(`.env` 在哪、env loader 往哪裡找、有沒有 shell 環境變數、
gateway 的 JWT 來源)。**只讀、只列來源,不印出任何密鑰值。**

### A2 以 repo 根為範圍的共用資源清單

列出所有「範圍是從 repo 根(或 `--git-common-dir`)算出來的」共用資源。已知兩個:
`.stryker.lock`、`learning/`。要掃的候選:各種 `*.baseline.json`(例如 `scripts/zero-input-guard.baseline.json`)、
`reports/`、`checkpoints/`、junit 的 `testcase-names.txt`(`reports/junit/`)。掃法要寫在報告裡,
讓下一個人能重現,並找出沒在候選清單上的(例如 `grep` `git-common-dir`、`resolveVaultRoot`、
`process.cwd()` 當路徑根的地方)。

每一列三欄:
1. **它保護的資源實際上是什麼**;
2. **那個資源的實際範圍**(CPU = 整台機器;錢 = 整個帳號;棘輪基線 = 這個 repo 的程式品質;…);
3. **現在的範圍對不對**(判定,附依據)。

判準(採 AI_KM 顧問的那句):**鎖的範圍要跟它保護的資源一樣大。**
所以 A2 的產出不是「全部都要改成機器範圍」,是「每一個各自判,依據是它保護什麼」。
棘輪基線保護的是 repo 範圍的品質,不用改。

A2 的總數是這條 ADR 的證據:只有兩個資源受影響是兩個 bug;有六個是一個結構性的事。

### A3 報告

放 `docs/reviews/`,帶 host、日期。寫明:本報告不含任何改動;選項清單(不裁決)。

## 驗收條件

1. A1 清單存在,每個位置附行數、最後修改時間、量測日期;憑證來源有列、沒有印出密鑰值。
2. A2 清單存在,每列有「保護什麼資源」「資源實際範圍」「現在的範圍對不對」三欄與依據;掃法可重現。
3. **正向對照**:在**非主簽出的 clone** 裡用**假 adapter** 產生一筆記帳,證明它落在**那個 clone 自己的帳本**,
   不是主簽出的。這一條證明問題真的存在,不是只從程式推論。
4. **反向對照**:同樣的動作在**主 repo 的 worktree** 裡做,證明它落在**主簽出的帳本**。這一條證明
   ADR-051 在 worktree 層面仍然有效——我們修的是 clone,不是把 ADR-051 推翻。
   第 3、4 條一起看才有意義:它們證明「worktree 有效、clone 無效」,那個對比就是 T0 的全部內容。
5. **全程不打網路**,只用假 adapter。出現真網路呼叫 = 工單失敗。
6. 工單過程中,所有量測用的 clone / worktree 都**不跑任何會真呼叫的指令**(煞車在整個工單期間有效)。

## 測試誰寫

- 第 3、4 條的測試:測試 agent。
- 審核 agent:對 A1、A2 抽樣獨立重量(不收轉述),並檢查第 3、4 條的對照。
- 開發 agent:本工單**沒有開發工作**(不改程式);若 A 階段發現必須修的 bug,停下來回報,不順手修。

## worktree

兩個位置各一個(第 3 條要一個 clone 裡的 worktree、第 4 條要主 repo 的 worktree),各同一時間一個 agent。
開 worktree 與派工歸協調者。

## ADR

技術顧問寫,但要等 A2 的量測。核心論證:「為權限而分 repo,會把所有以 repo 根為範圍的共用資源一起分掉,
而且靜默。」
