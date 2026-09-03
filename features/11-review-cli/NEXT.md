# 11 · review-cli — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | 無 |
| 進行中 | phase-1 |
| 下一個 | (完成後即 I2) |

## Gate

**phase-1** 需要:
- 04-scheduler 三個 phase done
- 05-grading phase-2 done
- 01-data-layer phase-2 done

**phase-2** 需要:phase-1 done、I2 通過

## Gate 未滿足時

這個資料夾不參與 Wave 0,所以 Wave 0 期間它就是空的。這是對的,不要為了「讓它有事做」
而先寫一個吃 stub 的版本。

Wave 0 期間唯一值得做的:**把 session 的行為想清楚並寫進 phase-1 的 gherkin**。
特別是這三個問題,它們之後會影響 06-test-card:

1. 「今天」的邊界在哪?(04 的開放問題,00:00 還是可設的時間)
2. session 建立之後,當天新到期的卡怎麼辦?(目前定為等明天)
3. 答案什麼時候落地?(定為每題立刻,不是 session 結束)

想清楚了就寫進 gherkin,不用等程式。

## 完成後

phase-1 完成即 I2。**那時停下來連續用一週。** 06-test-card 的 phase-2 就是把這個 CLI
換成視窗,如果 CLI 的行為有問題,換皮之後只會更難發現。
