# 覆核:兩條鎖測試「跟著日曆變紅」的修法

branch `pollux0971/date-dependent-test-review` · base `main` · 覆核對象 commit `8081fc9`
(協調者為了修 main 紅燈而動了 `scripts/mutate.test.ts`,依規則事後覆核。)

**結論:診斷成立,修法正確,不是放寬,不退回。同類只有這兩條,已全數修掉。**

---

## 一、診斷對不對 —— 【驗】成立

協調者的說法:兩條測試用 `info({ pid: process.pid, cwd: '/holder' })` 佔住鎖,
但 `info()` 的 `startedAt` 預設是寫死的 `T0 = 2026-09-04 12:00 UTC`,而這兩條走真實時鐘;
`T0` 一旦超過兩小時的殘鎖門檻,鎖被判成殘鎖、直接搶到,測試就再也觀察不到逾時。

反向驗證(把 `startedAt` 改回 `T0` 的預設):

```
$ npx vitest run scripts/mutate.test.ts -t "真的時鐘"

- Error {
-   "message": "rejected promise",
+ {
+     "cwd": ".../date-dependent-test-review",
+     "pid": 186621,
+     "startedAt": "2026-09-04T18:51:59.940Z",
+   "lockPath": "/tmp/mutate-lock-realclock-IP5oDF/.stryker.lock",
+   "release": [Function release],
  }
 ❯ scripts/mutate.test.ts:967:74
 Test Files  1 failed (1)
      Tests  1 failed | 108 skipped (109)

$ npx vitest run scripts/mutate.test.ts -t "預設的 sleep 是真的在睡"
 ❯ scripts/mutate.test.ts:1473:74
 Test Files  1 failed (1)
      Tests  1 failed | 108 skipped (109)
```

改回 `new Date().toISOString()`:

```
$ npx vitest run scripts/mutate.test.ts -t "真的時鐘"
 Test Files  1 passed (1)      Tests  1 passed | 108 skipped (109)
$ npx vitest run scripts/mutate.test.ts -t "預設的 sleep 是真的在睡"
 Test Files  1 passed (1)      Tests  1 passed | 108 skipped (109)
```

紅綠可以隨 `startedAt` 一個欄位來回切,程式一行沒動 —— 診斷確立。
注意失敗訊息裡**一個字都沒提到日期**,它只說「resolved 而不是 rejected」。

## 二、兩小時門檻是不是真的 —— 【驗】是

`scripts/mutate.ts`

```ts
export const STALE_AFTER_MS = 2 * 60 * 60_000;
```

`classifyLock`(`scripts/mutate.ts:208-213`):

```ts
const ageMs = now - Date.parse(info.startedAt);
if (ageMs > staleAfterMs) {
  return { kind: 'stale', info, why: `鎖從 ${info.startedAt} 到現在超過 ${staleAfterMs / 3_600_000} 小時` };
}
```

而且 `acquireLock`(`scripts/mutate.ts:305-310`)對 `stale` 是「清掉直接重搶,不睡」。
所以走真實時鐘時,`T0` 過期 = 立刻搶到 = 永遠等不到逾時。跑這次覆核時
`now - T0 ≈ 6 小時 52 分`,遠超過門檻。

## 三、這是不是放寬 —— 【驗】不是

關鍵問題:改成「現在」之後,「殘鎖會被清掉」那條保證還有沒有測試守著?**有,而且是刻意用假時鐘守的。**

**破壞一:讓兩小時規則永遠不觸發**

```bash
# scripts/mutate.ts:211  if (ageMs > staleAfterMs)  →  if (false && ageMs > staleAfterMs)
$ npx vitest run scripts/mutate.test.ts
     × 2 小時又 1 毫秒 → 殘鎖
     × 超時的鎖就算 pid 還活著也算殘鎖(pid 會重用,時間才是保底)
     × 超過 2 小時的鎖也算殘鎖,清掉重拿
     × 超時的鎖講的是「小時」而且數字對
      Tests  4 failed | 105 passed (109)
```

**破壞二:讓 `acquireLock` 不再清殘鎖**

```bash
# scripts/mutate.ts:305  if (verdict.kind === 'stale')  →  if (false && verdict.kind === 'stale')
$ npx vitest run scripts/mutate.test.ts
 FAIL  scripts/mutate.test.ts > acquireLock > 殘鎖(假 pid)會被清掉,然後立刻拿到——不用等 15 秒
 FAIL  scripts/mutate.test.ts > acquireLock > 超過 2 小時的鎖也算殘鎖,清掉重拿
      Tests  2 failed | 86 passed (109)
```

守著這條保證的是 `mutate.test.ts:485-497`「超過 2 小時的鎖也算殘鎖,清掉重拿」——
它把 `startedAt` 明寫成 `T0 - 3 小時`,而且**注入 `now: clock.now`**(假時鐘),
所以它跟日曆無關,永遠測得到。加上 `classifyLock` 那一整組(全部注入 `now`)。

被改掉的那兩條**從來就不是在測殘鎖清理**,它們測的是「不注入 `now`/`sleep`/`log` 時預設值是真貨」。
把 `startedAt` 寫成「現在」正是那兩條**本來就該有的前提**:持鎖者活著、鎖是新的。
所以這是把測試的前提修對,不是把規則放寬。**不退回。**

## 四、同類還有幾條 —— 只有這兩條,已全部處理

`T0` 在 `scripts/mutate.test.ts` 出現 39 次。分類:

| 用法 | 條數 | 走真實時鐘? | 判定 |
|---|---|---|---|
| `classifyLock(..., { now: T0 + … })` | 18 | 否,`now` 全部注入 | 安全 |
| `acquireLock(..., { now: clock.now })`(`fakeClock`) | 6 | 否 | 安全 |
| `acquireLock(..., { now: () => T0 })` | 4 | 否 | 安全 |
| `readLock` 用 `T0/1000 - 3600` 設 mtime | 1 | 是,但只斷言 `raw` 與 `mtimeMs`,不做 classify | 安全 |
| `releaseLock` 用 `info({ pid: 777 })` | 4 | 是,但 `releaseLock` 只比對 pid,不看時間 | 安全 |
| `selfLockInfo` 的字串常數 | 1 | 是,但只斷言原樣回傳 | 安全 |
| **真實時鐘 + `T0` 的鎖被 classify** | **2** | **是** | **就是被修的那兩條** |

另外兩類走真實時鐘的鎖測試都**不用 `T0`**,天生安全:
- `writeRacer` / `writeHolder` / `sandboxWithFakeStryker` 開的真子行程,鎖是 `new Date().toISOString()` 或 `selfLockInfo()` 現做的。
- `runMutate` 走預設 `acquire` 的兩條(`mutate.test.ts:1075`、`1134`),現場沒有既存的鎖可以判。

**結論:沒有「還沒被觸發的同類」。** `STALE_AFTER_MS` 是這個檔案裡唯一的時間門檻,
`CORRUPT_GRACE_MS` 那組全部注入 `now`,不會隨日曆變。

---

## 這個形狀值得記(PITFALLS 用)

> **走真實時鐘的測試裡,任何寫死的時間常數都是一顆定時炸彈:程式沒改、昨天全綠、今天全紅,
> 而失敗訊息只會說「resolved 而不是 rejected」,一個字都不會提到日期。**
> 症狀是「測試看起來測不到它本來要測的東西了」,原因是那個寫死的時間戳已經越過了程式裡的某個
> 老化門檻(這裡是 `STALE_AFTER_MS` 兩小時)。看到「昨天綠今天紅、diff 是空的」就先查時間常數。

### 想得到的機械化防線(給技術顧問決,我不自己動)

1. **測試層的規約(最便宜)** ——「注入了 `now` 就用寫死的 `T0`;沒注入 `now` 就一定要用 `new Date()`」。
   可以在 `info()` 裡加一個必填的 `clock: 'fake' | 'real'` 之類的分流,讓「真時鐘 + T0」
   在**型別層**就寫不出來。改動只在測試檔內,不動契約。**我推薦這條。**
2. **CI 的時光旅行跑一次** —— 定期(或每次 PR)用 `libfaketime` 之類把系統時間推到未來
   (例如 +90 天)再跑一次全套。抓得到所有同型的坑,但要多一條 CI job,而且會誤傷
   真的依賴當前日期的測試(排程模組大概會)。
3. **靜態守門** ——「`.test.ts` 裡的時間常數必須來自注入的 clock」。規則難寫準,誤判率高,不推薦。

## 驗收數字

```
$ npm run boundaries    → PASS  scanned=198
$ npm run typecheck     → PASS
$ npm run lint:docs     → PASS  scanned=20
$ npx vitest run        → Test Files 82 passed (82) / Tests 1691 passed (1691)
$ npm run accept:dry    → 497 scenarios (152 undefined, 345 skipped),0 ambiguous
$ npm run check:steps   → PASS  scanned=1943
$ npm run check:gherkin-dup → PASS  scanned=495
$ npm run accept:coverage   → PASS  scanned=38
$ sync-gates.sh <repo> scripts --check → ✓ 守門內容自同步以來未被更動
```

`scripts/mutate.ts` 我一行都沒改(破壞驗證後已還原,`git status` 乾淨),
變異測試數字見下方「變異測試」一節。

## 變異測試

工單給的指令用的是 **`stryker.config.json`(預設設定)**,那份有 `checkers: ["typescript"]`
且 `coverageAnalysis: perTest`;而 94.25% 的基準線來自 P-29 審核輪的
**`stryker.scanner-mutatelock.json`**(沒有 checker、`coverageAnalysis: off`、
專用的 `vitest.scanner-mutatelock.config.ts`)。兩者不可直接比,所以兩份都跑了。

**(一)工單指定的指令(預設設定)**

```
$ npm run mutate -- --mutate "scripts/mutate.ts,!scripts/mutate.test.ts"
           | % Mutation score |          |           |            |          |          |
File       |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
All files  |  91.16 |   92.41 |      128 |         6 |         11 |        2 |      114 |
Final mutation score of 91.16 is greater than or equal to break threshold 60   (exit 0)
```

`# errors = 114` —— 突變體總數一樣是 261,但預設設定的 TypeScript checker 把其中 114 個
先擋掉了,所以 killed 從 237 掉到 128。**這是設定差異,不是測試品質差異。**

**(二)與基準線同設定(可比的那一份)**

```
$ npm run mutate -- stryker.scanner-mutatelock.json
           | % Mutation score |          |           |            |          |          |
File       |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
All files  |  94.25 |   94.98 |      237 |         9 |         13 |        2 |        0 |
Final mutation score of 94.25 is greater than or equal to break threshold 0    (exit 0)
```

**94.25% / covered 94.98%,與 P-29 審核輪的基準線一字不差。**
協調者改的那兩行沒有讓任何突變體活下來。

> 順帶一提:未來的工單要卡 `scripts/mutate.ts` 的變異分數,指令應該寫
> `npm run mutate -- stryker.scanner-mutatelock.json`,不是 `--mutate` 那條。
