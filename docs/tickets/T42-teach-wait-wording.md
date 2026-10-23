---
id: T42
deps: [T40]
touches: [apps/teach-card/src/]
cpu: light
budget_usd: 1
status: dispatched
owner: worker-grok
must_catch:
  - 教學卡的 BUSY_MESSAGE 不是剛好 考試卡還在用複習程式,稍等一下。(還是舊字樣、少一個字、標點換成半形):teach-session 的常數測試必須紅
  - 只改了常數測試、畫面那條還在比舊字樣,或畫面用的不是 BUSY_MESSAGE:onWait 驅動的等候測試(t40-busy 與 teach-session 的 busyNotice)必須紅
  - 字樣改了、teach-session 的行為跟著動(等候時按鈕沒停用、等候字樣不由 onWait 驅動而是一送出就顯示、onWait 收到 false 之後字樣不收起、教學卡自己又重送一次):既有的等候與一層重試測試必須紅
---

# 工單 T42:教學卡的等候字樣改成「考試卡還在用複習程式,稍等一下。」(只改字樣)

> 狀態:草稿 2026-10-23。規格:UI/Tauri 負責人(T40 工單作者)。編號 T42:協調者配。
> 實作:worker(opencode + grok-4.7);改既有測試:測試 agent;驗收:驗收 agent。沒有 `@manual`。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 依據:顧問 2026-10-23 判 T40 `@manual`(docs/reviews/T40-manual-2026-10-23.md 的 O5)時定的字樣;refines ADR-077 D5(只有字樣),見 decision-map ADR-077 的 refined-by 行(協調者在 07 phase-2 done 的文件批加)。
> 基底:main。順序:排在 T35 之後(落點不重疊)。

## 為什麼有這張

T40 之後兩個視窗共用一個側車。app 一開,考試卡的 `start` 常常先起側車、在鎖裡等 `hello`;這段時間教學卡的請求拿到 `busy`,超過 1 秒就顯示等候字樣。T40 `@manual` 量到:考試卡先到的那批 12 次,教學卡**每一次**都顯示了「考試卡正在批改,稍等一下。」,顯示 0.01–2.2 秒。那時考試卡是在起動,不是在批改,字樣講錯了。

顧問定:字樣改成「**考試卡還在用複習程式,稍等一下。**」(開機與批改兩種情況都對),行為不動。

## 改什麼

- `../../apps/teach-card/src/teach-session.ts` 第 9 行 `BUSY_MESSAGE` 的值改成 `考試卡還在用複習程式,稍等一下。`(全形逗號、全形句號,跟舊字樣同樣的標點)。
- 別的都不動:
  - 重試在共用的 `../../apps/desktop/src/webview/review-client.ts`(300 ms、1 秒、180 秒,ADR-078),這張不碰那個檔;
  - 等候時按鈕停用、`onWait` 驅動畫面、樣式都照舊;
  - 考試卡的等候字樣「複習程式還在準備,稍等一下。」不動。
- 不改任何 `.feature`(目前沒有 `.feature` 寫到這句)、不改 `contracts/`、不改 decision-map(那一行由協調者加)。

## 驗收條件

### 1. 自動驗收

| 層 | 指令 | 過的條件 |
|---|---|---|
| 教學卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/` | 全綠,含改過的三處斷言 |
| 字樣只剩一份 | `git grep -n "考試卡正在批改" -- apps packages features scripts` | 沒有結果(舊字樣在程式與測試裡都不見;`docs/` 的歷史工單與證據不改) |

### 2. 改壞證明(驗收 agent 的丟棄式證明)

`must_catch` 每一條各做一次:改了哪裡、哪一條紅、紅的訊息原文、還原後綠。改壞只動 `../../apps/teach-card/src/teach-session.ts`(這張的落點);第 3 條至少做「等候時按鈕不停用」與「`onWait(false)` 之後字樣不收起」兩種。重試的時點(300 ms、1 秒、180 秒)在共用 client,由 T40 的測試守著,這張不重做。

## 要改的既有測試(測試 agent 改,開發 worker 不改)

這幾處把舊字樣釘住了,要換成新字樣(斷言一樣嚴,只換字):

- `../../apps/teach-card/src/teach-session.test.ts` 第 210 行(常數 `BUSY_MESSAGE`)、第 400 行(`onWait(true)` 之後的 `busyNotice`)、第 11 行的檔頭註解。
- `../../apps/teach-card/src/t40-busy.test.ts` 第 98 行(超過 1500 ms 的每一個畫面的 `busyNotice`)。

紅測試先寫:改完這三處,在 base 上要紅(紅的原因是字樣還是舊的),實作改一行後轉綠。

## 受保護的測試檔

`*.test.ts`、`features/steps/**`、`features/support/**`、`.feature`。worker 覺得測試有錯,寫進報告的「待協調」,不改。

## 落點

`apps/teach-card/` → 07-teach-card(已在 `../../scripts/boundaries.owners.json`)。不新增檔案、不新增 import、不新增例外。

## 不在範圍

- 改等候的行為或時點(ADR-078 的 300 ms、1 秒、180 秒)。
- 讓教學卡分辨「考試卡在起動」與「考試卡在批改」顯示兩種字樣(要 Rust 多回一個原因,顧問沒要)。
- 考試卡的字樣、T40 的其他觀察(O6 顧問判不用做)。

## 預算

US$1(一行實作;grok 不設停止線、只記錄)。沒有 LLM 花費。

## 測試誰寫

測試 agent 改上面三處斷言與第 11 行註解(紅測試先寫);開發 worker 只改 `teach-session.ts` 第 9 行。驗收:驗收 agent。
