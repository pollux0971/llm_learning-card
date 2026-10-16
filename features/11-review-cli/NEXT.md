# 11 · review-cli — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-3(2026-10-17:連錯兩次的卡沒有縮短版時退回原卡並記一筆 warning(T25,-ed 驗收無阻擋項,證據 docs/reviews/acceptance-T25.md);reviews.json 寫入前的樂觀檢查,被別處改過就不寫、叫使用者重來(T26,-ed 驗收無阻擋項,真 cucumber 4/4,證據 docs/reviews/acceptance-T26.md);phase-3.feature 四個場景全綠,沒有 @manual)。phase-2(2026-10-16:當日快取、續答、跨日、暫停、dry-run、結束時 snapshot;工單 T17,-ed 驗收無阻擋項,session 三檔 Stryker 96.67%,證據見 docs/reviews/acceptance-T17.md 與 T17-2026-10-16.md)。phase-1(2026-09-03) |
| 進行中 | 無 |
| 下一個 | 無(三個 phase 都完成;I3 整合等 06 phase-2 與 phase-3) |

## Gate

**phase-1** 需要:
- 04-scheduler 三個 phase done
- 05-grading phase-2 done
- 01-data-layer phase-2 done

**phase-2** 需要:phase-1 done、I2 自動驗收通過(ADR-073:I2 不打 tag,人工確認延到 I4)、01-data-layer phase-4 done(ADR-042 的
`snapshotLearningDir()` 要先能用)

**phase-3** 需要:phase-2 done

## Gate 未滿足時

這個資料夾不參與 Wave 0,所以 Wave 0 期間它就是空的。這是對的,不要為了「讓它有事做」
而先寫一個吃 stub 的版本。

Wave 0 期間唯一值得做的:**把 session 的行為想清楚並寫進 phase-1 的 gherkin**。
特別是這三個問題,它們之後會影響 06-test-card:

1. 「今天」的邊界在哪?(04 的開放問題,00:00 還是可設的時間)
2. session 建立之後,當天新到期的卡怎麼辦?(目前定為等明天)
3. 答案什麼時候落地?(定為每題立刻,不是 session 結束)

想清楚了就寫進 gherkin,不用等程式。

## phase-2 多了一件事(ADR-042)

複習結束時要呼叫一次 snapshot,把當天的 `state/` 變更 commit 進 `learning/` 自己的 git repo。
**這是 v1 唯一的「每天備份一次」機制**,沒有排程器。要寫成什麼場景、五條細節(dry-run 不
呼叫、失敗不影響退出碼……)見 FEATURE.md 的「snapshot 的呼叫點(ADR-042)」。

## 後續小項(不擋 phase-2,I3 整合驗收時一起確認)

- **續答時 reteach 名單照快取回放,不看那張卡今天是否已經重教過**(T17 驗收備註,顧問 2026-10-16 記)。
  例:早上答完、下午續答,早上已重教過的卡會再出現一次複習提示。資料不會壞,但使用者會以為系統當掉或重複了。
  應改成:續答時已經重教過的卡不再出現。來源見 `docs/reviews/acceptance-T17.md` 的備註。

## 完成後

phase-1 完成即 I2。**那時停下來連續用一週。** 06-test-card 的 phase-2 就是把這個 CLI
換成視窗,如果 CLI 的行為有問題,換皮之後只會更難發現。
