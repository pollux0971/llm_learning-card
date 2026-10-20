# 覆核證據:T38 例外清單條數(只改測試,修 main 紅燈)

- 被覆核:`t38-allow-count` tip **0dc654a**(測試 agent 作,基底 3d471e4,只改 `features/support/t31-static.test.ts`,+7/−1)。
- 覆核者:驗收 agent,2026-10-21。輕活,沒有重活位子。
- 乾淨簽出 tree sha(開跑與跑完同):**33621a319996082bbb5340bfb915d057d5853892**;`ls .env` 無。

## (1) 是「計數過期」,不是「誤加例外」

我自己用 `git show d397537:scripts/boundaries.allow.json` 對 3d471e4 的同一檔做 (from, to) 集合差:

- 條數 21 → 23。
- 新增恰好兩條:`07-teach-card → 10-desktop-shell`、`11-review-cli → 07-teach-card`。
- 移除 0 條。
- 兩條各由一個 commit 加進來,各自只動 `scripts/boundaries.allow.json` 一個檔、各 +5 行:4c5aa62(07 → 10)與 3d471e4(11 → 07)。
- 理由對得上:第一條的 `reason` 引 ADR-077(跟 06 → 10 同理由,只開單向);第二條寫「組合層(ADR-021 例外,同 11 → 04/05)…ADR-077」。ADR-077 在 `../02-decision-map.md` 有標題與 refined by 記載;11 → 07 是顧問 2026-10-21 的 B-lite 裁決(commit 3d471e4 的說明)。

## (2) 沒放寬斷言

diff 只有:`BASE_ALLOW_ENTRIES` 21 → 23,加一段註解。斷言仍是 `expect(allow()).toHaveLength(BASE_ALLOW_ENTRIES)`,測試名「整份例外清單條數不變(不加新的一條)」不變,絆線還在。我另做兩個改壞(丟棄式、已還原):

| 改壞 | 結果 |
|---|---|
| 常數改回 21 | 紅:`expected [ … ] to have a length of 21 but got 23` |
| 例外清單少一條(22) | 紅:`expected [ … ] to have a length of 23 but got 22` |

## (3) 註解來源描述

註解寫:T31 當時 21 條;ADR-077(T37)依序加兩條;07 → 10 在 4c5aa62、11 → 07 在 3d471e4;合計 23。與 (1) 的 git 記錄一致。最後一句「別的工單加例外時,在這裡補上來源再改數字」是流程提醒,不放寬任何東西。

## (4) 獨立 grep

對 `t38-allow-count` 的 `features`、`scripts` 搜 `BASE_ALLOW_ENTRIES` 與 `boundaries.allow.json`:條數只釘在 t31-static.test.ts 這一處(常數 1 處、斷言 1 處)。`scripts/check-boundaries.test.ts` 只是用自己造的暫存設定測腳本,與真例外清單的條數無關。內容類:review-client.test.ts、no-stubs-static.test.ts、session.test.ts(兩個 session.test.ts,桌面與考試卡)。

## (5) 測試

`VITEST_MAX_WORKERS=1`,5 個檔:`features/support/t31-static.test.ts`、`apps/desktop/src/review-client.test.ts`、`apps/desktop/src/session.test.ts`、`apps/test-card/src/no-stubs-static.test.ts`、`apps/test-card/src/session.test.ts`——5 files、305 passed。t31-static 單檔 14 條全過。

## 結論

通過
