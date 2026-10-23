# 驗收 T42:教學卡等候字樣

- 被驗:分支 t42-impl,sha e4037cc7203f85562eebc5aa6943b191cba59192,tree 0631bb607b3c540ca09a439ba08c096a41ac68c9(開跑與跑完相同)
- 基底 t42-start 65bc35b(main 47375a1 + 紅測試 3e5486b)。日期 2026-10-23。驗收:-5b。
- 簽出:乾淨 worktree,無 .env(ls 失敗),VITEST_MAX_WORKERS=1。沒有 Rust 產物,不用重編。

## 測試作者
實作 commit 只動 teach-session.ts(+1/−1,第 9 行 BUSY_MESSAGE)與 docs/reviews/T42-implementation.md。
受保護測試檔(teach-session.test.ts、t40-busy.test.ts)0 變動,改動來自紅測試 commit。

## 基準(未突變)
- apps/teach-card vitest:Test Files 8 passed (8);Tests 72 passed (72)。
- tsc --noEmit:乾淨。
- boundaries:gate=boundaries result=PASS scanned=355。
- 舊字樣只剩一份:git grep -n 舊字樣 -- apps packages features scripts,0 命中。

## 手改突變(只改 teach-session.ts,改完還原,git status 乾淨)
指令:VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/

| 編號 | 改了什麼 | 結果 | 紅的測試 |
|---|---|---|---|
| W1 | 字樣少一字(稍等下) | 紅 3 | teach-session 常數與固定字樣;t40-busy 忙超過 1 秒的等候字樣 |
| W3 | 少句號 | 紅 3 | 同上 |
| W4 | 還原成舊字樣 | 紅 3 | 同上 |
| W2 | 逗號改全形 U+FF0C | 紅 3 | 同上 |
| S1 | 畫面寫死舊字樣、不用 BUSY_MESSAGE | 紅 2 | onWait 驅動的 busyNotice;t40-busy |
| B2 | onWait(false) 之後字樣不收起 | 紅 2 | onWait 驅動的 busyNotice;G2 按鈕停用那條 |
| B3 | 一送出就顯示字樣(waiting 或 inFlight) | 紅 3 | onWait 驅動的 busyNotice;t40-busy |
| B1b | onWait 之後按鈕一律不停用(controlsDisabled = false) | 紅 3 | onWait 驅動的 busyNotice;t40-busy |
| B1 | controlsDisabled 拿掉 isWaiting,只剩 inFlight | **存活**(72 全過) | 無 |

B1 備註:onWait(true) 只會在請求進行中來,isWaiting 蘊含 inFlight,所以兩種寫法等價。這跟 T40 驗收的 G2 同型,已知,不是 T42 新缺口。

## 工單文字
工單原寫「全形逗號」。實際舊字樣、新字樣、工單引用的字串與測試的逗號全是半形 U+002C,句號才是全形。實作與工單字串、測試一致,不是錯。工單那句文字已由協調者更正。

## 變異測試
工單沒指定變異範圍,沒跑 Stryker。

## learning/ 前後
前:64 檔 / c2e4dd6d71de3976 / 108 行。後:64 檔 / c2e4dd6d71de3976 / 108 行。相同。

## 花費
worker 自述 $0.35,預算 1,比值 0.35,未超 2 倍。

## 結論
通過。
