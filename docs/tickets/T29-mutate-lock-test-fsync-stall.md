---
id: T29
deps: []
touches: [scripts/mutate.test.ts]
cpu: light
budget_usd: 1
status: todo
owner: -e5
must_catch:
  - 「tryAcquire 不漏 fd」那條的斷言被放寬、刪掉或改成不量值的寫法(為了讓它不逾時):fd 數差必須仍然剛好是 0;丟棄式改壞(讓 `tryAcquire` 不關 fd)時,改成 20 次之後仍然紅
  - 為了過關把全域 `testTimeout` 調大,或把逾時加在跟真 I/O、真行程無關的測試上
  - 改了 `scripts/mutate.ts`、`scripts/run-tests.ts` 或它們的行為(拿鎖、清殘鎖、重試間隔、2 小時規則、90 分鐘上限、超集規則):既有行為測試必須紅;這張只動測試
---

# 工單 T29:整鏈裡真 fsync 型測試逾時——根因是預熱後的髒頁寫回,不是測試本身

> 狀態:**顧問裁決 2026-10-18 第四次改寫(根因找到,縮到一條測試加一個鏈的程序)**。量測見 [measure-T29.md](../reviews/measure-T29.md)。優先度:低。
> 作者:協調者(短版,依顧問裁決改寫)。測試改動:-e5。驗收:-ed。**這張不改產品碼、不改 `scripts/run-tests.test.ts`。**

## 為什麼有這張

整鏈裡 scripts 底下做真 I/O、起真行程的測試,偶爾逾時 5000ms;單跑都綠而且很快。累計(都是「只有逾時、0 條斷言失敗」):

| 次 | 哪條 | 鏈內 | 單跑 |
|---|---|---|---|
| T22 鏈(d11ccfa 之前) | `mutate.test.ts` 活鎖時每 15 秒重試 | 6364ms | 綠 |
| T24 鏈第 1 次(9e0a18c) | `mutate.test.ts` 超過 2 小時的鎖也算殘鎖,清掉重拿 | 6344ms | 3 ms |
| T24 鏈第 1 次(06209d6) | `run-tests.test.ts` 三個根:鎖被別人握著照樣立刻跑 | 5746ms | 3–5 ms |
| 17a1387 鏈 | `deps.test.ts` 第一條 | 逾時 | 綠 |
| T31 鏈(a2e5c3c,2026-10-18) | `mutate.test.ts`「acquireLock 的預設值」3 條(真時鐘等滿 6329ms、release 刪鎖 12641ms、殘鎖被刪走 15160ms) | 逾時 | 185/185 綠 ×2 |
| T31 整步重跑第 2 次 | `mutate.test.ts`「tryAcquire 不漏 fd:拿 200 次鎖」 | 5282ms | 綠 |

## 根因(顧問 2026-10-18,依兩次鏈的 PSI 時間軸)

- 兩次鏈(a2e5c3c、17a1387)的 IO full 壓力只在兩個時段高:「預熱中與預熱結束後 1–2 分鐘」(a2e5c3c 03:42–03:43 到 82;17a1387 20:02:30–20:03:30 到 44)和「鏈尾」(04:00 到 46;20:21 到 41)。中間各 15–17 分鐘是 0。
- 逾時都落在預熱後那一窗:cargo 建 `lc-fs` 留下的髒頁,在幾十秒後被核心寫回,壓在 vitest 剛開跑的時候;真 fsync 的測試這時一次 `fsync` 就停好幾秒。
- 這也解釋了 -e5 用 `dd conv=fsync` 風暴量不出 `deps.test` 的逾時:風暴是持續的壓力,實際的逾時來自預熱結束後的一次性寫回。
- 之前「`dd` 風暴下 `tryAcquire` p90 5 秒」(measure-T29.md 第 3 節)證明 fsync 會被 IO 壓力拖慢,但不是整鏈逾時的直接原因。

## 要做什麼

### 一、鏈的程序(協調者,不進這張的 touches)

驗證鏈在預熱(`cargo build --bin lc-fs`)結束後、起 `npm run check:all` 之前:

1. 跑 `sync`;
2. 等 `/proc/pressure/io` 的 `full` `avg10` < 5,上限 3 分鐘,**等了多久記進 meta**;
3. 每秒取樣多記 `/proc/meminfo` 的 `Dirty`、`Writeback`(進同一份 tsv)。

鏈尾那個尖峰是哪一步造的:下次看 JSON reporter 加取樣,**先記、不修**。這套已寫進 SKILL.md 的鏈步驟,鏈腳本範本在協調者的 scratchpad(不進版控)。

### 二、一條測試(-e5)

`scripts/mutate.test.ts`「tryAcquire 不漏 fd:拿 200 次鎖(含 200 次 EEXIST),/proc/self/fd 的數量不變」:200 次改為 20 次。

- fd 數差仍要**剛好是 0**;
- 丟棄式證明:讓 `tryAcquire` 不關 fd 時,20 次也紅(驗收者重做一次);
- 只動這一個檔、這一條;不調全域 `testTimeout`、不改產品碼。

## 擱著的(原 T29 內容,條件滿足才回來做)

原本的「fixture 改 `writeFileSync`、鎖測試單條設逾時」不做。**連看 3 次整鏈(加了上面的 sync 等待之後),預熱窗外還有真 fsync 型逾時,才回來做**;回來時範圍是「做真 fsync 寫檔的測試」(名單見 measure-T29.md)。

## 驗收

- `scripts/mutate.test.ts` 單跑全綠,斷言數不減;「不漏 fd」那條 fd 差剛好 0;丟棄式改壞(不關 fd)20 次仍紅。
- 沒開風暴與開風暴(同 -e5 的 `dd` 條件)各連跑 3 次全綠。
- `npm run check:all` 綠;沒有未登記的新 `scripts/*.ts`。

## 待診斷(這張不修)

- `scripts/run-tests.test.ts`「三個根:鎖被別人握著照樣立刻跑」:原因不明(鏈內整檔 11.4 秒,單跑 0.94 秒,PSI 當時沒停頓)。找到原因之前,整鏈裡紅了,在同一份簽出單步重跑,綠就收(SKILL.md §4e 的四點條件)。
- 鏈尾的 IO 尖峰是哪一步造的。

## 觀察(這張不修)

- `mutate.test.ts`「兩個行程同時搶…」單跑固定 8.0 秒(3 次都一樣,像固定等待)。

## 不在範圍

- `degraded-report.test.ts` 那種內層 vitest 慢,是另一個問題,見 SKILL §4e。
- `apps/test-card/dev/standalone.test.ts` 的 vite 收尾卡住:那是 T24 的補丁,已完成。
- 改 `mutate.ts` 的重試間隔、2 小時、90 分鐘規則;改 `run-tests.ts` 的超集規則。
