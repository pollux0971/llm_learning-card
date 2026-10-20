# 驗收證據:T36 複習測試的逾時要說自己是逾時(只改測試)

- 工單:T36(`../tickets/T36-review-harness-timeouts.md`,唯一正本)
- 被驗分支:`t36-tests`(測試 agent 作)。最終被驗 tip **f12ef6a**(疊在 a7e9554 之後,只加 `Then('exactly {int} questions are presented', { timeout: 150_000 }` 一行);基底 4c5aa62。
- 驗收者:驗收 agent。日期 2026-10-21。
- 乾淨簽出:workers clone 另開 worktree,從 f12ef6a 開;`ls .env` → No such file;開跑與跑完 tree sha 同為 **c0dfb5a26a7a360bfb58210fbef1a560b5f5f246**(`git status` 乾淨)。
- 機器:開跑 load 約 4–11(同時有別的 worker 在跑),跑完約 2.9。`VITEST_MAX_WORKERS=1`。
- 備註(工具):在這個簽出用 `npx cucumber-js` 加 `NODE_OPTIONS=--import=tsx` 會丟 esbuild「Expected id 1 but got id 0」;改成 `node --import tsx node_modules/@cucumber/cucumber/bin/cucumber.js …` 就正常。與 T36 無關。

## 測試作者

`git log --name-only 4c5aa62..HEAD`:兩個 commit(a7e9554、f12ef6a),只動 3 個檔:`features/support/review-session-harness.ts`、`scripts/review-session.test.ts`、`features/steps/i2-review-loop.steps.ts`。沒有產品程式、沒有 `.feature`、`mutants.out` 0。這是只改測試的工單,沒有開發 worker,所以沒有「worker 碰測試」的問題。

## 逐行讀 diff(非作者)

- 只加、不鬆斷言:review-session.test.ts 是純新增(+73,0 刪);步驟檔刪的 1 行只是函式簽名換成帶選項的(行為更嚴);harness 刪的行是把 resolve(null) 換成先等 close。
- 新加 4 條逾時測試:建的是 `dueVault` 暫存目錄;`processesFor` 只讀 /proc;沒有 rm/write 到真路徑,沒有碰 `learning/`。
- runReview 與 runInteractiveReview 都是 spawn 的行程本身被 SIGKILL(runReview 直接 spawn node,沒有 npx 包一層),close 才往下;5 秒後放棄等。
- allowTimeout 只在 runReview;runInteractiveReview 沒有關閉選項,工單允許。

## 基準(未突變)

| 項目 | 結果 |
|---|---|
| `scripts/review-session.test.ts` | 47 passed(含 4 條新的),約 139 秒 |
| 其他用 harness 的 14 個 vitest 檔(`git grep -l review-session-harness` 列出,去掉 review-session) | 14 files、262 passed |
| `@i2 and not @manual`(cucumber,f12ef6a) | 93 scenarios、464 steps 全過;lc-fs 重編 Finished 1m07s(冷編) |
| tsc `--noEmit` | 無輸出(乾淨) |

## 工單 (d) 改壞證明(我獨立重做,全部還原後回綠)

| # | 改了哪裡 | 結果 |
|---|---|---|
| d1 | harness 預設 `90_000` → `1_000`,跑續答那條 | 紅:`Error: runReview 1 秒逾時被 SIGKILL(不是斷言錯:子行程沒有在時限內結束,通常是機器負載太高)`——是逾時的錯,不是 asked / 快取斷言 |
| d2 | 同上再拿掉 (b) 那行,並把丟錯關掉,看原本的錯 | 紅:`AssertionError: expected '' to match /2\s*張延後/`(舊式的內容錯);(b) 那行在前面擋住的順序成立 |
| d3 | 步驟 `5 cards are due and the person answered 2` 拿掉 150 秒、加 `await sleep(6000)` | 紅:`Error: function timed out, ensure the promise resolves within 5000 milliseconds`;保留 150 秒、同樣 sleep 6 秒:綠(1 scenario passed,10.4 秒) |
| d4 | 步驟檔 `INTERACTIVE_LIMIT_MS` 120_000 → 1_000,跑續答場景 | 紅:`Error: runInteractiveReview 1 秒逾時被 SIGKILL(不是斷言錯:…)`,失敗在 `Given 5 cards are due and the person answered 2` |
| d5(補 f12ef6a 那一行) | `exactly {int} questions are presented` 拿掉 150 秒、加 sleep 6 秒,跑 daily 場景 | 紅:`function timed out, ensure the promise resolves within 5000 milliseconds` |

## 自選改壞(不在作者清單)

| # | 改了哪裡 | 結果 |
|---|---|---|
| m1 | 預設翻成允許逾時:`!opts.allowTimeout` → `opts.allowTimeout === false` | 紅 2 條:`逾時應該丟錯,不是回傳一個 status 為 null 的結果: expected undefined to be an instance of Error`、`promise resolved "{ status: null, timedOut: true, …(5) }" instead of rejecting` |
| m2 | 逾時時拿掉 `child.kill('SIGKILL')` | **存活**:4 條逾時測試全綠(見 G1) |
| m3 | 逾時時不等 close,直接 `resolveStatus(null)` | **存活**:4 條全綠(見 G1) |

### G1(補強建議,低;第二輪已補,見下):「逾時後子行程收得掉」沒有被任何測試真正證明

新測試用 `timeoutMs: 1`,行程在 1 毫秒時才剛起來;不殺它,它也會自己跑完退出,所以「不留行程」那個斷言怎樣都綠。m2、m3 因此存活。我用丟棄式測試證實這是測試的洞,不是等價突變:讓子行程卡住(`beforeAnswer` 睡 12 秒,`timeoutMs: 2000`),逾時之後檢查 `processesFor`——正確實作綠;m2(拿掉 SIGKILL)紅:`AssertionError: 逾時之後不留行程: expected [ <pid> ] to deeply equal []`。丟棄式測試不進 git、已刪。修法在測試端:新加一條「卡住的子行程」的逾時測試(測試 agent 改,我不改)。這不影響 must_catch 五條(都抓到了),但工單驗收條件「子行程照舊收得掉」目前只是宣稱。

## 另外量到的(工單要求只量、不改;交顧問)

(c) `@i2` 單步耗時(f12ef6a,負載 4–5,cucumber json 的 duration):

| 步驟(i2 步驟檔行號) | 秒 |
|---|---|
| L836 exactly 10 questions are presented | 3.19(已加 150 秒) |
| L981 5 cards are due and the person answered 2 | 2.41(150 秒) |
| L991 the person quits and runs the review command again | 2.30(沒加,< 2.5 秒) |
| L763 submits an answer that satisfies all 3 | 2.23 |
| L947 submits an apply answer | 2.23 |
| L809 an apply question is graded | 2.13 |
| L962 the card remains in today's list | 2.11 |
| L608 the first two cards have advanced one stage | 2.01 |
| L892 answers it incorrectly again | 1.89 |
| L695、L681、L114(x2)、L1022 | 1.70、1.67、1.63、1.01 |

其中沒有逾時設定的最慢是 L991 的 2.30 秒、L763/L947 的 2.23 秒,離 5 秒上限的餘裕約 2.2 倍;負載再高(協調者量到過 83.8)都可能撞到。要不要再加,交顧問。

(b) 其他沒先看 status 的位置:review-session.test.ts 行 121、136、180、285、303、322、334、396、405、597、604(接了結果但沒先斷言 status)與只呼叫不接結果的 194、200、260、548、562、668、784–787、797、818 等,是測試 agent 的清單,我沒逐條重驗;顧問已裁決不做。這些處因為 runReview 現在預設逾時丟錯,逾時會直接丟錯,不再回殘缺結果,風險已消。

## 使用者資料前後(只記數字)

| | 檔案數 | 雜湊 | 帳本行數 |
|---|---|---|---|
| 前 | 64 | c2e4dd6d71de3976 | 108 |
| 後 | 64 | c2e4dd6d71de3976 | 108 |

## 花費

這張工單沒有 LLM 花費(只改測試,我的驗收沒呼叫模型)。預算 1 美元,比值 0。算不出測試 agent 自己的用量,寫「不知道」。

## 第二輪:G1 補完後重驗(最終 tip 17f61dd)

- 被驗:`t36-tests` 最終 tip **17f61dd**(疊序 a7e9554、f12ef6a、88a67ba、17f61dd);對基底 4c5aa62 共 3 檔 +174/−13,`mutants.out` 0。tree sha 開跑與跑完同為 **a7641faa1173b10b0509110b0866332a9d626179**,簽出乾淨,`ls .env` 無。load 開跑約 2.5、跑完約 5.5。
- 新 commit 只動測試檔與步驟檔(88a67ba:review-session.test.ts +36;17f61dd:步驟檔 +7/−1)。

### 88a67ba:卡住的子行程測試

讀:啟動前用 50 毫秒輪詢 /proc 收集所有命令列帶這個暫存目錄的 pid;`beforeAnswer` 睡 6 秒、timeoutMs 1500;丟錯之後對每個 pid 做 `kill(pid, 0)`(殭屍也算還在)。有「量尺」斷言:至少抓到一個子行程。沒有碰真路徑。

| 改壞 | 結果 |
|---|---|
| m2 逾時時拿掉 `child.kill('SIGKILL')` | 紅:`AssertionError: 逾時錯誤丟出時,子行程還在: expected [ <pid> ] to deeply equal []`;還原後綠 |
| m3 不等 close(`giveUp` 那行換成立刻 `resolveStatus(null)`) | **存活**。原因:SIGKILL 一送出行程幾毫秒內就被收掉,測試在停止輪詢後還有最多 50 毫秒的空檔才檢查,所以「是不是等 close 才往下」分不出來。它是 SIGKILL 之上的次要保證(行程已經殺了),評為低、近似等價,不要求再補 |

### 17f61dd:runInteractiveReview 整組殺

讀:`spawn('npx', …, { detached: true })` 讓 child 自成行程群組(群組 id = child.pid);逾時 `process.kill(-child.pid!, 'SIGKILL')`,丟例外(例如 pid 沒有)就退回 `child.kill('SIGKILL')`。只對自己 spawn 的那個 child 的群組送訊號,沒有碰別人的 pid;`detached` 只在這一個 spawn 上;正常結束時不送訊號。

重做「INTERACTIVE_LIMIT_MS 改短,跑 `@i2` 續答場景」:

| 設定 | 結果 |
|---|---|
| 1 秒、1.6 秒(在 17f61dd 上) | 紅,訊息 `runInteractiveReview 1 秒逾時被 SIGKILL(不是斷言錯:…)`(1.6 秒版寫 1.6);用 `ps` 找命令列帶 review.ts 或 _fake-review-cloud 的行程:跑完當下與 3~4 秒後都是空的 |
| 同上,但把整組殺換回 `child.kill`(拿掉 17f61dd 的修法) | 一樣紅,`ps` 也是空的 |
| 2.5 秒 | 沒逾時(步驟 2.4 秒就跑完),不算 |

結論:這台上我**重現不出**「只殺 npx 會留孤兒」(兩種寫法 `ps` 都乾淨;npx 一死,管線關閉,review.ts 讀到 EOF 就自己結束),所以 17f61dd 的修法在這個場景下我分辨不出有無。程式本身讀起來安全(只殺自己的群組、失敗有退路)。改壞後我另外掃過並清掉殘留(本來就沒有)。

### 重跑

| 項目 | 結果 |
|---|---|
| `scripts/review-session.test.ts` | 48 passed(含卡住的那條),約 67 秒 |
| `@i2 and not @manual` | 93 scenarios、464 steps 全過 |
| 使用者資料 前 / 後 | 64 檔、c2e4dd6d71de3976、108 行 / 相同 |

### 交顧問判:runDryRun

`runDryRun` 用 `spawnSync` 加 120 秒逾時,同型但非互動,測試 agent 沒動。spawnSync 逾時會回 `status` 為 null(帶 `signal`),呼叫處照樣往下比;影響與原來的 runReview 同形。要不要比照處理,請顧問判。

## 結論

通過
