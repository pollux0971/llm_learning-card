# REVIEW — 全套 vitest 與 Stryker 共用一把鎖(測試輪,只寫紅)

分支 `pollux0971/stryker-lock-allsuite`,基底 main `9243d06`(含 `5748a38`)。
這一輪**只寫測試與簽章骨架**,函式體一律 `throw new Error('TODO(開發輪)…')`,
跟 P-29 測試輪(`docs/reviews/P-29-mutate-lock-tests.md`)同一個做法。**沒有實作。**

> 這個檔案取代了根目錄一份過期的 03-llm-router phase-2 第一輪審核紀錄
> (那份內容的後續版本在 `features/03-llm-router/REVIEW.md`,舊版留在 git 歷史)。

## 結果一句話

`npx vitest run scripts/run-tests.test.ts scripts/mutate.test.ts`:**183 條,59 紅 / 124 綠**。
59 紅全部是這輪新寫的;mutate.test.ts 既有的 117 條一條都沒弄紅。
完整原始輸出(含 stack)在根目錄 `REVIEW-red-run.log`(`*.log` 被 ignore,不進 git);
逐條清單在本檔最後的附錄。

其他守門:`typecheck` 過、`boundaries` 過(兩個新檔登記在 `scripts/boundaries.owners.json` 的 infra)、
`lint:docs` 過、`zero-input-guard` 的「清單完整性」6/6 過(`scripts/run-tests.ts` 登記為 `excluded`,理由同 mutate.ts)。

## 改了 / 新增了哪些檔

| 檔案 | 做了什麼 |
|---|---|
| `scripts/run-tests.ts` | **新增,骨架**。`vitestArgs` / `isPartialRun` / `runTests` 三個 export 都是 TODO;`spawnVitest` 照 mutate.ts 的 `spawnStryker` 寫好(Stryker disable 區);`isMainModule` 守衛照抄 mutate.ts |
| `scripts/run-tests.test.ts` | **新增**。§1–§10,52 條(45 紅 7 綠) |
| `scripts/mutate.ts` | **只加簽章**:`LockTask`、`LockInfo.task?`、`RunDeps.lock?`、`selfLockInfo(cwd, nowIso, task?)`、`WaitContext`、`sameWorktree()`(TODO)、`waitingMessage(holder, waitedMs, ctx = {})`(舊本體原樣保留,所以既有測試還是綠) |
| `scripts/mutate.test.ts` | **附加 §14**,29 條(14 紅 15 綠):`parseLock` 的 task 欄、`selfLockInfo` 的 task、`sameWorktree`、`waitingMessage` 兩種文案、`acquireLock` 印出來的訊息 |
| `scripts/zero-input-guard.test.ts` | ROSTER 加 `scripts/run-tests.ts`(excluded) |
| `scripts/boundaries.owners.json` | 兩個新檔落 infra |
| `package.json` | **沒動**。`test` 還是裸 `vitest run`;§9 那兩條紅就是要開發輪去改的接線(改成 `tsx scripts/run-tests.ts --`)。現在就改的話 `npm test` 會直接撞 TODO,整個 worktree 跑不了測試 |

## 這輪定下來的線(寫在測試裡,改線先改測試)

### 1. 哪種 vitest 拿鎖(`run-tests.test.ts` §2)

**`--` 之後有任何一個「存在於磁碟上的檔案或目錄」當位置參數 → 小範圍,不拿鎖。其他一律全套,拿鎖。**

- `npm test` → 全套,拿鎖
- `npm test -- scripts/mutate.test.ts`、`npm test -- packages/core` → 不拿鎖,立刻跑
- `npx vitest run …` → 根本不經過這支,當然不拿鎖(§9 釘 `test:watch` 也不走這支)
- `npm test -- --reporter verbose` → 全套(`verbose` 不是路徑)。**這條就是不用「不是旗標就是 filter」判的理由**:那樣判會把一個全套跑成沒鎖,漏鎖的代價是 OOM / 假紅
- `npm test -- mutate`(vitest 子字串 pattern)→ **當全套,多鎖一次**。故意往安全的方向錯:多鎖的代價是等幾分鐘,漏鎖的代價是整輪。要快就給真的路徑
- `npm test -- -t xxx` → 全套(還是載入所有檔案)

`isPartialRun(passthrough, cwd = process.cwd())`:`passthrough` 是去掉 `--` 與 `run` 之後的 vitest 參數。

### 2. 等待訊息(`mutate.test.ts` §14)

兩行,格式用 `toContain` 釘關鍵字,不釘整句:

```
等待 .stryker.lock(持鎖者 pid 2636796 跑 Stryker, cwd=/…/five-zero-guards)
→ 這是你自己排的鏈(同一個 worktree),正常,繼續等。逾時 90 分鐘,已等 6 分鐘。
```
```
等待 .stryker.lock(持鎖者 pid 2636796 跑全套測試, cwd=/…/other)
→ 這是別的 worktree 佔的。不要刪鎖,不要 kill 那個 pid。逾時 90 分鐘,已等 6 分鐘。
```

釘住的字:`等待 .stryker.lock`、`pid <n>`、`cwd=<path>`、`這是你自己排的鏈` + `同一個 worktree` + `繼續等`、
`這是別的 worktree 佔的` + `不要刪鎖` + `不要 kill`、`逾時 90 分鐘`、`已等 N 分鐘`(≥ 60 秒)/ `已等 N 秒`(< 60 秒)。
**互斥**:自己的那句不能出現「別的 worktree」,別人的那句不能出現「自己」。
持鎖者讀不出(null)→ 寫「不要刪鎖」、不能寫「自己排的鏈」。
持鎖者在跑什麼:`task: 'stryker'` → 有 `Stryker` 沒 `全套`;`'test'` → 有 `全套`;沒有 task(舊鎖)→ 兩個都提、不能有 `undefined`。

「自己的鏈」= **同一個 worktree**:`sameWorktree(a, b)` 各自 `git rev-parse --show-toplevel` 比;
不是 git 目錄退回比 resolve 後的路徑;**路徑不存在不丟例外、回 false**(對面的 worktree 可能已經被 remove;
不確定往「別人的、不要刪」保守)。注意**不能**用 `--git-common-dir`,那會把所有 worktree 判成自己的。

### 3. 鎖檔多一欄 `task`

`LockInfo.task?: 'stryker' | 'test'`。`parseLock`:合法值保留;缺欄 → `undefined`(舊格式**不是壞檔**,
判成壞檔會在 10 秒後被當殘鎖刪掉一把活的);認不得的字串 / 不是字串 → 丟掉那欄,鎖照樣合法。
`selfLockInfo(cwd, nowIso, task?)`:沒給 task 時物件裡**沒有那個 key**(`exactOptionalPropertyTypes`,
JSON 化後要跟舊格式一樣)。`runTests` 寫 `'test'`,`runMutate` 寫 `'stryker'`。

### 4. 逾時 / 殘鎖 / signal:全部沿用

`runTests` 走同一個 `acquireLock`,不重新發明:預設 `maxWaitMs` 就是 `MAX_WAIT_MS`(90 分鐘)→ exit 1、不跑 vitest、
別人的鎖不動;殘鎖(pid 不在 / 超過 2 小時)清掉直接跑、一次都不睡;`installCleanup` 掛上、結束拆掉;SIGTERM 之後鎖不留。
§10 另外釘:`run-tests.ts` 裡不准出現 `openSync(` / `unlinkSync(` / 字串字面值 `'.stryker.lock'`——鎖的規則只能有一份真相。

### 5. 注入點

`RunTestsDeps` 與 `RunDeps` 都多一個 `lock?: AcquireDeps`,交給預設的 `acquireLock`(給了 `acquire` 就不看)。
測試靠它走**真的**拿鎖迴圈但注入假時鐘 / 假 sleep。`RunTestsDeps.cwd` 給 `isPartialRun` 判路徑用。

## 59 條紅,紅在哪

| 區 | 條數 | 現在紅的訊息 |
|---|---|---|
| run-tests §1 `vitestArgs` | 5 | `TODO(開發輪):vitestArgs 未實作` |
| run-tests §2 `isPartialRun` | 10 | `TODO(開發輪):isPartialRun 未實作` |
| run-tests §3 小範圍不拿鎖 | 3 | `TODO(開發輪):runTests 未實作` |
| run-tests §4 全套拿鎖 | 8 | 7 條 `runTests 未實作`;「runMutate 寫 task: stryker」是 `expected undefined to be 'stryker'`(selfLockInfo 還沒帶 task,runMutate 也還沒傳) |
| run-tests §5 兩個全套排隊 | 3 | 2 條 `runTests 未實作`;子行程那條 `子行程沒印出「HELD」就結束了`(holder 腳本裡的 runTests 丟 TODO) |
| run-tests §6 互斥 | 2(第 3 條綠) | 「Stryker 握著 → 全套等」`runTests 未實作`;「全套握著 → runMutate 等」**5 秒逾時**——runMutate 還沒接 `lock`,走真的 15 秒 sleep(測試 finally 會把鎖拿掉,不留迴圈) |
| run-tests §7 逾時 / 殘鎖 | 4(第 2 條綠) | `runTests 未實作` / `expected … to throw 'disk on fire' but got 'TODO…'` |
| run-tests §8 SIGTERM | 1 | `子行程沒印出「HELD」就結束了` |
| run-tests §9 接線 | 2(其餘 3 綠) | `expected 'vitest run' to contain 'scripts/run-tests.ts'`、`expected false to be true`(結尾不是 `--`) |
| mutate §14 `parseLock` task | 1(其餘 3 綠) | `expected undefined to be 'stryker'`(parseLock 丟掉 task) |
| mutate §14 `selfLockInfo` task | 1(另 1 綠) | `expected undefined to be 'test'` |
| mutate §14 `sameWorktree` | 5 | `TODO(開發輪):sameWorktree 未實作` |
| mutate §14 `waitingMessage` | 11 | `expected '等 /home/x/… 的 Stryker(pid 2636796)跑完…' to contain '等待 .stryker.lock'` 之類(舊格式) |
| mutate §14 `acquireLock` 印的訊息 | 3 | `expected '等 … 跑完,已等 0 秒…' to contain '自己排的鏈'` 之類 |

現在就綠的 17 條是「接線 / 常數 / 結構」檢查:`test:watch` 不走鎖、`mutate` 還走 mutate.ts、`.gitignore`、
`MAX_WAIT_MS === 90 分鐘`、run-tests.ts 沒有自己的 openSync、parseLock 對舊格式 / 壞 task 不炸、
selfLockInfo 沒給 task 時沒有 key、裸 acquireLock 拿不到全套握著的鎖、以及 §14 幾條「不能出現 undefined / 不能亂猜」在舊格式下恰好成立。
它們現在綠是**應該的**,開發輪不要把它們弄紅。

## 下一輪(開發)要注意

1. **先接 `package.json`**:`"test": "tsx scripts/run-tests.ts --"`。結尾的 `--` 是 §9 釘的,少了位置參數會被 tsx 吃掉。
   接完 `npm test` 就走鎖,在 worktree 裡驗證的時候記得隔壁有沒有人在跑 Stryker(會排隊,那是對的)。
2. `runMutate` 要接 `deps.lock`(展開進 acquireLock,`info` 固定帶 `task: 'stryker'`),不然 §6 那條會一直 5 秒逾時。
3. `acquireLock` 印訊息時要傳 `{ selfCwd: info.cwd, maxWaitMs }` 進 `waitingMessage`——`info.cwd` 是等鎖的人自己的 cwd。
   `sameWorktree` 每 15 秒叫兩次 git 沒關係,想省就算一次快取。
4. `sameWorktree` **不可以丟例外**、路徑不存在回 false;用 `--show-toplevel` 不是 `--git-common-dir`。
5. `isPartialRun` 用 `existsSync(resolve(cwd, arg))`,旗標(`-` 開頭)直接跳過;不要去猜哪些旗標帶值。
6. `selfLockInfo` 沒有 task 時**不要放 `task: undefined`** 進物件(§14 有測)。
7. 不要動 `waitingMessage` 既有兩條(§5)與 §12 的斷言:新格式要**同時**滿足它們——舊格式沒有 task 的持鎖者訊息裡要有 `Stryker`,
   null 持鎖者要有 `另一個 worktree` 與 `讀不出`,45 秒要印 `已等 45 秒`。
8. 改完跑 `npm run typecheck && npm run boundaries && npx vitest run scripts/run-tests.test.ts scripts/mutate.test.ts`,
   再跑一次全套(這次會經過鎖)。mutate.ts 屬嚴格級(路徑防護),審核輪會跑 `npm run mutate -- --mutate "scripts/mutate.ts,scripts/run-tests.ts"`。
9. 這一輪**沒有**碰 `check:all`——那是模板 v1.4.1 的東西,main 上不存在;1.4.1 落地後它呼叫的 `npm test` 自然帶鎖。
10. 鎖沒有任何規則變動:檔名、位置、90 分鐘、2 小時、10 秒寬限、只刪自己的——全部沿用。

## 附錄:`npx vitest run scripts/run-tests.test.ts scripts/mutate.test.ts --reporter=verbose`

機器 load 約 15–18(uptime 08:19)。

```
 × scripts/run-tests.test.ts > vitestArgs > 沒有 -- 時只有 run
   → TODO(開發輪):vitestArgs 未實作
 × scripts/run-tests.test.ts > vitestArgs > -- 之後原樣透傳,前面補 run
   → TODO(開發輪):vitestArgs 未實作
 × scripts/run-tests.test.ts > vitestArgs > 使用者自己打了 run 就不補第二次
   → TODO(開發輪):vitestArgs 未實作
 × scripts/run-tests.test.ts > vitestArgs > 只認第一個 --,後面的 -- 是要給 vitest 的
   → TODO(開發輪):vitestArgs 未實作
 × scripts/run-tests.test.ts > vitestArgs > 不會讓 vitest 進 watch 模式:透傳裡沒有 run 就補 run,不是補 watch
   → TODO(開發輪):vitestArgs 未實作
 × scripts/run-tests.test.ts > isPartialRun(小範圍的線) > 沒有位置參數 → 全套(拿鎖)
   → TODO(開發輪):isPartialRun 未實作
 × scripts/run-tests.test.ts > isPartialRun(小範圍的線) > 給了存在的測試檔 → 小範圍(不拿鎖)
   → TODO(開發輪):isPartialRun 未實作
 × scripts/run-tests.test.ts > isPartialRun(小範圍的線) > 給了存在的目錄 → 小範圍(不拿鎖)
   → TODO(開發輪):isPartialRun 未實作
 × scripts/run-tests.test.ts > isPartialRun(小範圍的線) > 絕對路徑也算
   → TODO(開發輪):isPartialRun 未實作
 × scripts/run-tests.test.ts > isPartialRun(小範圍的線) > 旗標加檔案 → 還是小範圍(旗標不改變範圍)
   → TODO(開發輪):isPartialRun 未實作
 × scripts/run-tests.test.ts > isPartialRun(小範圍的線) > 只有旗標 → 全套(拿鎖)
   → TODO(開發輪):isPartialRun 未實作
 × scripts/run-tests.test.ts > isPartialRun(小範圍的線) > 旗標的值(--reporter verbose 的 verbose)不是路徑 → 全套(這條就是不用「不是旗標」判的理由)
   → TODO(開發輪):isPartialRun 未實作
 × scripts/run-tests.test.ts > isPartialRun(小範圍的線) > -t <名字> 沒有檔案 → 全套(還是會載入所有檔案,重的是載入)
   → TODO(開發輪):isPartialRun 未實作
 × scripts/run-tests.test.ts > isPartialRun(小範圍的線) > 子字串 pattern(不是存在的路徑)→ 全套:故意往安全的方向錯
   → TODO(開發輪):isPartialRun 未實作
 × scripts/run-tests.test.ts > isPartialRun(小範圍的線) > 不給 cwd 時用 process.cwd() 判(套件在 repo 根跑,scripts/ 就在)
   → TODO(開發輪):isPartialRun 未實作
 × scripts/run-tests.test.ts > runTests 小範圍時不拿鎖 > 給了存在的檔案:acquire 一次都不會被叫,vitest 直接跑
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > runTests 小範圍時不拿鎖 > 鎖被活著的別人握著,單檔 vitest 照樣**立刻**跑,不排隊
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > runTests 小範圍時不拿鎖 > 小範圍時退出碼一樣原樣往外傳
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > runTests 全套時拿鎖 > 沒人持鎖:拿到鎖再跑 vitest,跑的時候鎖在、跑完鎖不在
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > runTests 全套時拿鎖 > 鎖檔裡寫 task: "test",等鎖的人才分得出對面是 Stryker 還是全套
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > runTests 全套時拿鎖 > runMutate 那邊寫的是 task: "stryker"(對照組,兩邊都要標)
   → expected undefined to be 'stryker' // Object.is equality
 × scripts/run-tests.test.ts > runTests 全套時拿鎖 > vitest 失敗時退出碼原樣往外傳,鎖照樣刪掉
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > runTests 全套時拿鎖 > vitest 丟例外時鎖也要刪掉(這條就是 finally)
   → expected [Function] to throw error including 'boom' but got 'TODO(開發輪):runTests 未實作'
 × scripts/run-tests.test.ts > runTests 全套時拿鎖 > 給了 acquire 就用給的,而且 finally 會叫它回的 release
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > runTests 全套時拿鎖 > 不給 lockPath 時用 strykerLockPath():跟 Stryker **同一把**,不是另一把
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > runTests 全套時拿鎖 > 把 signal 清理掛上去,結束時再拆掉
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > 兩個全套排隊 > 第一個握著鎖時,第二個每 15 秒重試、印等待訊息,鎖放掉才跑 vitest
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > 兩個全套排隊 > 等的時候不動別人的鎖(內容一個位元組都不變)
   → TODO(開發輪):runTests 未實作
 ✓ scripts/mutate.test.ts > strykerLockPath > 兩個不同 worktree 算出來是同一個鎖路徑
 ✓ scripts/mutate.test.ts > strykerLockPath > worktree 與主 repo 算出來也是同一個
 ✓ scripts/mutate.test.ts > strykerLockPath > 鎖就在主 repo 的 .git 旁邊,檔名 .stryker.lock
 ✓ scripts/mutate.test.ts > strykerLockPath > 回的是絕對路徑(主 repo 裡 git 會回相對的 .git,不 resolve 就會算錯)
 ✓ scripts/mutate.test.ts > strykerLockPath > worktree 的子目錄算出來還是同一個
 × scripts/run-tests.test.ts > 兩個全套排隊 > 真的兩個行程:第一個握著,第二個只印等待、不印 RAN;第一個被殺掉之後第二個才 RAN
   → 子行程沒印出「HELD」就結束了:
 × scripts/run-tests.test.ts > Stryker 與全套互斥 > Stryker 握著鎖 → 全套等它放掉才跑
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > Stryker 與全套互斥 > 全套握著鎖 → Stryker(runMutate)等它放掉才跑
   → Test timed out in 5000ms.
 ✓ scripts/run-tests.test.ts > Stryker 與全套互斥 > 全套握著鎖 → 裸 acquireLock(Stryker 那條路)也拿不到
 × scripts/run-tests.test.ts > 逾時與殘鎖沿用 acquireLock 的規則 > 等滿 90 分鐘(MAX_WAIT_MS)就放棄:回 1,而且根本不跑 vitest
   → TODO(開發輪):runTests 未實作
 ✓ scripts/run-tests.test.ts > 逾時與殘鎖沿用 acquireLock 的規則 > 90 分鐘就是 90 分鐘:MAX_WAIT_MS 沒被這支另外定義
 × scripts/run-tests.test.ts > 逾時與殘鎖沿用 acquireLock 的規則 > 殘鎖(pid 不在)清掉直接跑,一次都不睡
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > 逾時與殘鎖沿用 acquireLock 的規則 > 超過 2 小時的鎖也算殘鎖,清掉重拿(時間規則是 mutate.ts 的,這裡只確認有走到)
   → TODO(開發輪):runTests 未實作
 × scripts/run-tests.test.ts > 逾時與殘鎖沿用 acquireLock 的規則 > 等鎖超時時 LockTimeoutError 被翻成 1;別的例外原樣往外丟
   → expected [Function] to throw error including 'disk on fire' but got 'TODO(開發輪):runTests 未實作'
 × scripts/run-tests.test.ts > SIGTERM 之後鎖不留 > 跑到一半被 SIGTERM 殺掉,鎖檔不會留下來
   → 子行程沒印出「HELD」就結束了:
 × scripts/run-tests.test.ts > package.json 接線 > npm test 走 scripts/run-tests.ts,不是裸 vitest
   → expected 'vitest run' to contain 'scripts/run-tests.ts'
 × scripts/run-tests.test.ts > package.json 接線 > npm test 的參數會透傳(結尾是 --,跟 mutate 一樣)
   → expected false to be true // Object.is equality
 ✓ scripts/run-tests.test.ts > package.json 接線 > test:watch 不走鎖(watch 會把鎖握到天荒地老)
 ✓ scripts/run-tests.test.ts > package.json 接線 > mutate 還是走 scripts/mutate.ts(這張工單不動 Stryker 那邊的接線)
 ✓ scripts/run-tests.test.ts > package.json 接線 > .gitignore 擋掉 .stryker.lock(同一把鎖,同一條 ignore)
 ✓ scripts/run-tests.test.ts > 不重新發明鎖 > run-tests.ts 從 mutate.ts import 鎖,自己沒有 openSync / unlinkSync
 ✓ scripts/run-tests.test.ts > 不重新發明鎖 > mutate.ts 還是鎖的唯一定義處(LOCK_FILENAME 只在那裡)
 ✓ scripts/mutate.test.ts > tryAcquire(openSync wx) > 兩個行程同時搶,只有一個拿到
 ✓ scripts/mutate.test.ts > tryAcquire(openSync wx) > 鎖不存在時拿得到,而且寫進去的內容讀得回來
 ✓ scripts/mutate.test.ts > tryAcquire(openSync wx) > 鎖已經在的時候回 false,而且不覆蓋原本的內容
 ✓ scripts/mutate.test.ts > pidIsAlive > 自己的 pid 是活的
 ✓ scripts/mutate.test.ts > pidIsAlive > ESRCH(程序不在)算死的
 ✓ scripts/mutate.test.ts > pidIsAlive > EPERM(程序在,只是不是我的)算活的
 ✓ scripts/mutate.test.ts > pidIsAlive > 其他錯誤碼也當活的(不確定就別刪)
 ✓ scripts/mutate.test.ts > parseLock > 合法的鎖檔解得出來
 ✓ scripts/mutate.test.ts > parseLock > 壞掉的鎖檔(空字串)回 null
 ✓ scripts/mutate.test.ts > parseLock > 壞掉的鎖檔(只有空白)回 null
 ✓ scripts/mutate.test.ts > parseLock > 壞掉的鎖檔(半截 JSON)回 null
 ✓ scripts/mutate.test.ts > parseLock > 壞掉的鎖檔(不是物件)回 null
 ✓ scripts/mutate.test.ts > parseLock > 壞掉的鎖檔(null)回 null
 ✓ scripts/mutate.test.ts > parseLock > 壞掉的鎖檔(陣列)回 null
 ✓ scripts/mutate.test.ts > parseLock > 壞掉的鎖檔(少了 pid)回 null
 ✓ scripts/mutate.test.ts > parseLock > 壞掉的鎖檔(pid 是字串)回 null
 ✓ scripts/mutate.test.ts > parseLock > 壞掉的鎖檔(pid 是 NaN 來源)回 null
 ✓ scripts/mutate.test.ts > parseLock > 壞掉的鎖檔(startedAt 不是可解析的時間)回 null
 ✓ scripts/mutate.test.ts > parseLock > 壞掉的鎖檔(少了 cwd)回 null
 ✓ scripts/mutate.test.ts > classifyLock > pid 還在、時間也還沒到 → 活鎖
 ✓ scripts/mutate.test.ts > classifyLock > pid 不在(ESRCH)→ 殘鎖
 ✓ scripts/mutate.test.ts > classifyLock > 剛好 2 小時 → 還是活鎖(規格是「超過」,不是「達到」)
 ✓ scripts/mutate.test.ts > classifyLock > 2 小時又 1 毫秒 → 殘鎖
 ✓ scripts/mutate.test.ts > classifyLock > 2 小時差 1 毫秒 → 活鎖
 ✓ scripts/mutate.test.ts > classifyLock > 超時的鎖就算 pid 還活著也算殘鎖(pid 會重用,時間才是保底)
 ✓ scripts/mutate.test.ts > classifyLock > startedAt 在未來(時鐘跳了)不算殘鎖
 ✓ scripts/mutate.test.ts > classifyLock > 壞掉的鎖檔、剛寫沒多久 → 當活鎖(可能是別人才剛 openSync 還沒寫完)
 ✓ scripts/mutate.test.ts > classifyLock > 壞掉的鎖檔、剛好在寬限期上 → 當活鎖
 ✓ scripts/mutate.test.ts > classifyLock > 壞掉的鎖檔、超過寬限期 → 殘鎖,刪掉
 ✓ scripts/mutate.test.ts > classifyLock > 壞掉的鎖檔超過寬限期時,不會去問 isAlive(根本沒有 pid 可問)
 ✓ scripts/mutate.test.ts > readLock > 檔案不在回 null
 ✓ scripts/mutate.test.ts > readLock > 讀得到內容與 mtime
 ✓ scripts/mutate.test.ts > releaseLock > 是自己的鎖就刪掉
 ✓ scripts/mutate.test.ts > releaseLock > 不是自己的鎖就不動它
 ✓ scripts/mutate.test.ts > releaseLock > 鎖已經不在了也不丟例外(release 會被 finally 跟 signal 各叫一次)
 ✓ scripts/mutate.test.ts > releaseLock > 鎖檔壞掉時不刪(讀不出 pid 就證明不了是自己的)
 ✓ scripts/mutate.test.ts > acquireLock > 沒人持鎖時直接拿到,一次都不睡
 ✓ scripts/mutate.test.ts > acquireLock > 殘鎖(假 pid)會被清掉,然後立刻拿到——不用等 15 秒
 ✓ scripts/mutate.test.ts > acquireLock > 超過 2 小時的鎖也算殘鎖,清掉重拿
 ✓ scripts/mutate.test.ts > acquireLock > 活鎖時每 15 秒重試一次,並印出持鎖的 worktree 與 pid
 ✓ scripts/mutate.test.ts > acquireLock > 等超過 90 分鐘就放棄,丟 LockTimeoutError
 ✓ scripts/mutate.test.ts > acquireLock > 等待上限與重試間隔可以調,邊界是「等滿才放棄」
 ✓ scripts/mutate.test.ts > waitingMessage > 印得出是哪個 worktree 的哪個 pid
 ✓ scripts/mutate.test.ts > waitingMessage > 鎖檔讀不出持有者時也印得出東西,不是 undefined
 ✓ scripts/mutate.test.ts > installCleanup > 掛上 SIGINT / SIGTERM / exit 三個 handler
 ✓ scripts/mutate.test.ts > installCleanup > SIGTERM 會 release,然後以 143 結束
 ✓ scripts/mutate.test.ts > installCleanup > SIGINT 會 release,然後以 130 結束
 ✓ scripts/mutate.test.ts > installCleanup > exit 會 release,但不會再 exit 一次(已經在結束了)
 ✓ scripts/mutate.test.ts > installCleanup > 回傳的函式會把 handler 拆掉
 ✓ scripts/mutate.test.ts > SIGTERM 之後鎖不留 > 跑到一半被 SIGTERM 殺掉,鎖檔不會留下來
 ✓ scripts/mutate.test.ts > strykerArgs > 沒有參數
 ✓ scripts/mutate.test.ts > strykerArgs > 只有 --
 ✓ scripts/mutate.test.ts > strykerArgs > 一般參數原樣透傳
 ✓ scripts/mutate.test.ts > strykerArgs > 設定檔當位置參數
 ✓ scripts/mutate.test.ts > strykerArgs > --mutate 的值有逗號與驚嘆號,不能被拆開
 ✓ scripts/mutate.test.ts > strykerArgs > 使用者自己打了 run 就不補第二次
 ✓ scripts/mutate.test.ts > strykerArgs > 第二個 -- 之後的也原樣透傳
 ✓ scripts/mutate.test.ts > runMutate > Stryker 成功時回它的退出碼,並刪掉鎖
 ✓ scripts/mutate.test.ts > runMutate > Stryker 失敗時把退出碼原樣往外傳,鎖照樣刪掉
 ✓ scripts/mutate.test.ts > runMutate > Stryker 丟例外時鎖也要刪掉(這條就是 finally)
 ✓ scripts/mutate.test.ts > runMutate > 把 -- 之後的參數交給 Stryker
 ✓ scripts/mutate.test.ts > runMutate > 等鎖超時回 1,而且根本不跑 Stryker
 ✓ scripts/mutate.test.ts > runMutate > 掛上 signal 清理,結束時再拆掉
 ✓ scripts/mutate.test.ts > .gitignore > 擋掉 .stryker.lock
 ✓ scripts/mutate.test.ts > .gitignore > npm run mutate 走的是 scripts/mutate.ts,不是直接叫 Stryker CLI
 ✓ scripts/mutate.test.ts > 錯誤不是 ENOENT / EEXIST 就往外丟 > readLock 碰到 ENOENT 以外的錯誤要往外丟,不能靜靜當成沒鎖
 ✓ scripts/mutate.test.ts > 錯誤不是 ENOENT / EEXIST 就往外丟 > tryAcquire 碰到 EEXIST 以外的錯誤要往外丟,不能靜靜當成「有人持鎖」
 ✓ scripts/mutate.test.ts > selfLockInfo 的預設值 > 不給參數時用這個程序的 pid、現在的時間、現在的工作目錄
 ✓ scripts/mutate.test.ts > selfLockInfo 的預設值 > 給了參數就用給的
 ✓ scripts/mutate.test.ts > acquireLock 的預設值(不注入 now / sleep / log 時) > 用真的時鐘、真的 setTimeout、真的 console.log,等滿就丟 LockTimeoutError
 ✓ scripts/mutate.test.ts > acquireLock 的預設值(不注入 now / sleep / log 時) > 拿到鎖之後回傳的 release 真的把鎖刪掉
 ✓ scripts/mutate.test.ts > acquireLock 的預設值(不注入 now / sleep / log 時) > 殘鎖在清掉之前就被別人刪走了也不會爆,照樣拿到鎖
 ✓ scripts/mutate.test.ts > acquireLock 的預設值(不注入 now / sleep / log 時) > 剛好在 tryAcquire 與 readLock 之間被放掉時,馬上重搶而不是睡 15 秒
 ✓ scripts/mutate.test.ts > runMutate 的預設值與例外 > 不給 lockPath 時用 strykerLockPath(),以現在的 cwd 算
 ✓ scripts/mutate.test.ts > runMutate 的預設值與例外 > 不給 acquire 時走真的 acquireLock
 ✓ scripts/mutate.test.ts > runMutate 的預設值與例外 > 等鎖超時時,不給 log 就印到真的 console.log
 ✓ scripts/mutate.test.ts > runMutate 的預設值與例外 > acquire 丟的不是 LockTimeoutError 就原樣往外丟,不能翻成 exit 1
 ✓ scripts/mutate.test.ts > runMutate 的預設值與例外 > 交給 installCleanup 的那個 callback 真的會放掉這一把鎖
 ✓ scripts/mutate.test.ts > isMainModule > 沒有 argv[1](-e / REPL)時不算主模組
 ✓ scripts/mutate.test.ts > isMainModule > argv[1] 就是這個檔案時算主模組
 ✓ scripts/mutate.test.ts > isMainModule > 相對路徑跟絕對路徑指到同一個檔案也算
 ✓ scripts/mutate.test.ts > isMainModule > 別的檔案不算主模組
 ✓ scripts/mutate.test.ts > SIGTERM 之後 Stryker 子行程不留 > 殺掉 npm run mutate,底下的 stryker 也要跟著死(不然它繼續吃記憶體)
 ✓ scripts/mutate.test.ts > 鎖的位置不看測試套件自己在哪裡跑 > 從 worktree 裡起跑、不給 lockPath:鎖落在主 repo 的根,不是那個 worktree 的根
 ✓ scripts/mutate.test.ts > 文件裡不准出現繞過鎖的指令 > 沒有任何檔案教人用 npx / pnpm / yarn 直接叫 stryker
 ✓ scripts/mutate.test.ts > 文件裡不准出現繞過鎖的指令 > 沒有任何檔案寫著可以照抄的 Stryker CLI 子指令
 ✓ scripts/mutate.test.ts > 文件裡不准出現繞過鎖的指令 > 這個掃描器不是空掃(掃到 0 個檔案就該紅,不是看起來很乾淨)
 ✓ scripts/mutate.test.ts > 文件裡不准出現繞過鎖的指令 > 掃描範圍蓋到程式碼:那個躲過守門的活例子現在在範圍內
 ✓ scripts/mutate.test.ts > 文件裡不准出現繞過鎖的指令 > 掃描範圍是白名單:文字檔全收,二進位與跳過目錄不收
 ✓ scripts/mutate.test.ts > 文件裡不准出現繞過鎖的指令 > 掃描器真的抓得到(拿一個假的違規行餵它)
 ✓ scripts/mutate.test.ts > 文件裡不准出現繞過鎖的指令 > 反向控制用的違規字串跟寫死的一樣(拼接不是在改規則)
 ✓ scripts/mutate.test.ts > parseLock 的守衛拿掉會爆,不是回 null > 內容是 JSON 的 null 時回 null,不能丟 TypeError
 ✓ scripts/mutate.test.ts > parseLock 的守衛拿掉會爆,不是回 null > 內容是陣列時回 null
 ✓ scripts/mutate.test.ts > parseLock 的守衛拿掉會爆,不是回 null > 內容是純量時回 null
 ✓ scripts/mutate.test.ts > parseLock 的守衛拿掉會爆,不是回 null > startedAt 是字串但解不出時間時回 null
 ✓ scripts/mutate.test.ts > 給人看的理由不能是空的 > 活鎖 的 why 是有內容的一句話
 ✓ scripts/mutate.test.ts > 給人看的理由不能是空的 > pid 不在 的 why 是有內容的一句話
 ✓ scripts/mutate.test.ts > 給人看的理由不能是空的 > 超時 的 why 是有內容的一句話
 ✓ scripts/mutate.test.ts > 給人看的理由不能是空的 > 壞檔還在寬限期 的 why 是有內容的一句話
 ✓ scripts/mutate.test.ts > 給人看的理由不能是空的 > 壞檔超過寬限期 的 why 是有內容的一句話
 ✓ scripts/mutate.test.ts > 訊息裡的單位換算 > 壞檔超過寬限期時,講的是「秒」而且數字對
 ✓ scripts/mutate.test.ts > 訊息裡的單位換算 > 超時的鎖講的是「小時」而且數字對
 ✓ scripts/mutate.test.ts > 訊息裡的單位換算 > 等鎖放棄時講的是「分鐘」而且數字對
 ✓ scripts/mutate.test.ts > 訊息裡的單位換算 > 等待訊息裡的秒數是真的秒數,不是毫秒
 ✓ scripts/mutate.test.ts > 訊息裡的單位換算 > 讀不出持有者時,兩個備用字樣都要在(空字串等於沒訊息)
 ✓ scripts/mutate.test.ts > acquireLock 預設的 sleep 是真的在睡 > 等 60 毫秒、每次重試 20 毫秒,印出來的等待訊息只有個位數行
 ✓ scripts/mutate.test.ts > installCleanup 的 target 沒有 off 也不能爆 > 拆 handler 時 target 沒有 off,uninstall 要安靜地什麼都不做
 ✓ scripts/mutate.test.ts > 清殘鎖時要印出理由 > 清掉殘鎖那一行要說清楚為什麼(空訊息等於沒交代)
 × scripts/mutate.test.ts > parseLock 的 task 欄 > task 是 "stryker" / "test" 時保留
   → expected undefined to be 'stryker' // Object.is equality
 ✓ scripts/mutate.test.ts > parseLock 的 task 欄 > 舊格式(沒有 task 欄)照樣解得出來,task 是 undefined——不是壞檔
 ✓ scripts/mutate.test.ts > parseLock 的 task 欄 > task 是認不得的字串時,丟掉那一欄但鎖照樣算合法(不因為一個標籤刪別人的鎖)
 ✓ scripts/mutate.test.ts > parseLock 的 task 欄 > task 不是字串(數字 / 物件)時同上:丟掉那一欄,鎖照樣合法
 × scripts/mutate.test.ts > selfLockInfo 的 task > 給了 task 就寫進去
   → expected undefined to be 'test' // Object.is equality
 ✓ scripts/mutate.test.ts > selfLockInfo 的 task > 不給 task 時物件裡**沒有**那個 key(不是 task: undefined——JSON 化之後要跟舊格式一樣)
 × scripts/mutate.test.ts > sameWorktree > 同一個 worktree 的根與子目錄 → 同一個
   → TODO(開發輪):sameWorktree 未實作
 × scripts/mutate.test.ts > sameWorktree > 兩個不同的 worktree → 不同(就算掛在同一個主 repo 底下)
   → TODO(開發輪):sameWorktree 未實作
 × scripts/mutate.test.ts > sameWorktree > worktree 與主 repo → 不同
   → TODO(開發輪):sameWorktree 未實作
 × scripts/mutate.test.ts > sameWorktree > 不是 git 目錄:路徑相同才算同一個
   → TODO(開發輪):sameWorktree 未實作
 × scripts/mutate.test.ts > sameWorktree > 持鎖者的路徑已經不存在(worktree 被 remove 掉了)→ 當別人的,而且**不丟例外**
   → expected [Function] to not throw an error but 'Error: TODO(開發輪):sameWorktree 未實作' was thrown
 × scripts/mutate.test.ts > waitingMessage:自己的鏈 vs 別人的 > 第一行是事實:鎖檔名、持鎖者 pid、cwd
   → expected '等 /home/x/five-zero-guards 的 Stryker(…' to contain '等待 .stryker.lock'
 × scripts/mutate.test.ts > waitingMessage:自己的鏈 vs 別人的 > 同一個 worktree → 「這是你自己排的鏈」,而且不能出現「別的 worktree」
   → expected '等 /home/x/five-zero-guards 的 Stryker(…' to contain '這是你自己排的鏈'
 × scripts/mutate.test.ts > waitingMessage:自己的鏈 vs 別人的 > 不同 worktree → 「這是別的 worktree 佔的」+ 不要刪鎖、不要 kill,而且不能出現「自己」
   → expected '等 /home/x/five-zero-guards 的 Stryker(…' to contain '這是別的 worktree 佔的'
 × scripts/mutate.test.ts > waitingMessage:自己的鏈 vs 別人的 > 逾時與已等的時間都在,單位是分鐘(≥ 60 秒)
   → expected '等 /home/x/five-zero-guards 的 Stryker(…' to contain '逾時 90 分鐘'
 × scripts/mutate.test.ts > waitingMessage:自己的鏈 vs 別人的 > 不到一分鐘講秒,剛好一分鐘講分鐘
   → expected '等 /home/x/five-zero-guards 的 Stryker(…' to contain '已等 1 分鐘'
 × scripts/mutate.test.ts > waitingMessage:自己的鏈 vs 別人的 > maxWaitMs 可以調,印出來的逾時跟著變
   → expected '等 /home/x/five-zero-guards 的 Stryker(…' to contain '逾時 5 分鐘'
 × scripts/mutate.test.ts > waitingMessage:自己的鏈 vs 別人的 > 持鎖者在跑什麼要講出來:Stryker / 全套測試
   → expected '等 /some/worktree 的 Stryker(pid 4242)跑…' to contain '全套'
 × scripts/mutate.test.ts > waitingMessage:自己的鏈 vs 別人的 > 舊格式的鎖(沒有 task)不能印 undefined,也不能亂猜——講「Stryker 或全套測試」
   → expected '等 /some/worktree 的 Stryker(pid 4242)跑…' to contain '全套'
 × scripts/mutate.test.ts > waitingMessage:自己的鏈 vs 別人的 > 讀不出持有者(剛建鎖還沒寫完)→ 分不出是誰的,一樣寫「不要刪鎖」
   → expected '等 另一個 worktree 的 Stryker(pid 讀不出)跑完,已…' to contain '不要刪鎖'
 × scripts/mutate.test.ts > waitingMessage:自己的鏈 vs 別人的 > 不給 sameWorktree 時用真的 sameWorktree 判:同一個 git worktree 的根與子目錄 → 自己的鏈
   → expected '等 /tmp/mutate-lock-git-6Ye3k7/wt-a/pa…' to contain '自己排的鏈'
 × scripts/mutate.test.ts > waitingMessage:自己的鏈 vs 別人的 > 不給 selfCwd 時用 process.cwd():持鎖者寫的就是這個 cwd → 自己的鏈
   → expected '等 /home/pollux/orca/workspaces/llm_le…' to contain '自己排的鏈'
 × scripts/mutate.test.ts > acquireLock 印的等待訊息帶著「自己 / 別人」的判斷 > 持鎖者跟我在同一個 worktree → 每一行都說這是自己排的鏈
   → expected '等 /tmp/mutate-lock-git-x2suuC/wt-a/pa…' to contain '自己排的鏈'
 × scripts/mutate.test.ts > acquireLock 印的等待訊息帶著「自己 / 別人」的判斷 > 持鎖者在別的 worktree → 每一行都說不要刪鎖、不要 kill
   → expected '等 /tmp/mutate-lock-git-er650x/wt-b 的 …' to contain '別的 worktree'
 × scripts/mutate.test.ts > acquireLock 印的等待訊息帶著「自己 / 別人」的判斷 > 已等的時間跟逾時一起印,而且每次重試都在變
   → expected '等 /other/worktree 的 Stryker(pid 4242)…' to contain '已等 1 分鐘'

 Test Files  2 failed (2)
      Tests  59 failed | 124 passed (183)
   Start at  08:19:11
   Duration  11.66s (transform 449ms, setup 161ms, import 385ms, tests 17.05s, environment 0ms)
```
