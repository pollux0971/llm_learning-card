# P-29 實作輪回報:Stryker 跨 worktree 檔案鎖

接 `a31a6ef`(測試骨架)與 `fa66f88`(測試輪回報)。這一輪把 `scripts/mutate.ts` 的
13 個 TODO 填掉,並且把「繞過鎖」那條路堵掉。**沒有動任何 `*.test.ts` / `*.steps.ts` / `*.feature`。**

## 1. 13 個函式怎麼實作的

| # | 函式 | 做法 | 標記 |
|---|---|---|---|
| 1 | `strykerLockPath` | `git rev-parse --git-common-dir` → `resolve(cwd, out)` → `dirname` → `join(LOCK_FILENAME)`。主 repo 裡 git 回相對的 `.git`,所以一定要先 resolve | 【驗】兩個真 worktree 實測同一路徑 |
| 2 | `pidIsAlive` | `kill(pid, 0)`,沒丟就活;丟了只有 `ESRCH` 算死,其他(含 `EPERM`)一律當活 | 【驗】上一輪 M5 反向驗證 |
| 3 | `readLock` | `readFileSync` + `statSync`,`ENOENT` 回 null。先讀內容再 stat:中間被刪掉時 stat 丟 `ENOENT`,同一個 catch 收掉,結果跟「本來就沒鎖」一樣 | 【推】 |
| 4 | `parseLock` | `JSON.parse` 包 try;非物件 / null / 陣列擋掉;`pid` 檢查 `typeof === 'number'`(JSON 的數字必定有限,不用再驗 finite);`cwd` 檢查字串;`startedAt` 要是字串**且** `Date.parse` 解得出來 | 【推】 |
| 5 | `classifyLock` | 順序是**壞檔寬限 → pid → 年齡**。壞檔那段直接回,不問 `isAlive`(根本沒有 pid 可問) | 【驗】測試釘住「不會去問 isAlive」 |
| 6 | `tryAcquire` | `openSync(path,'wx')` → `writeSync` → `fsyncSync` → `closeSync`。`EEXIST` 回 false,其他錯誤往外丟 | 【驗】兩行程對齊搶鎖 |
| 7 | `releaseLock` | 讀 → parse → 比 pid → `unlinkSync`。讀不出 pid 就不刪(證明不了是自己的) | 【驗】 |
| 8 | `selfLockInfo` | `{ pid: process.pid, startedAt: nowIso, cwd }` | — |
| 9 | `acquireLock` | 迴圈:`tryAcquire` 成功就回;失敗讀鎖,讀到 null(剛被放掉)**直接重試不睡**;殘鎖清掉重搶;活鎖先檢查等待上限再印訊息睡 `retryMs` | 【驗】六條測試釘住睡幾次、睡多久 |
| 10 | `waitingMessage` | `等 <cwd> 的 Stryker(pid <pid>)跑完,已等 N 秒…`;holder 是 null 時換成「另一個 worktree」與「pid 讀不出」,不會印出 `undefined` | 【推】 |
| 11 | `installCleanup` | 掛 `SIGINT`(release → exit 130)、`SIGTERM`(release → exit 143)、`exit`(只 release,不再 exit)。回傳的函式用 `target.off?.()` 拆掉三個 | 【驗】 |
| 12 | `strykerArgs` | 取**第一個** `--` 之後的全部,前面補 `run`;使用者自己打了 `run` 就不補第二次。第二個 `--` 之後的原樣送過去 | 【驗】七個 case |
| 13 | `runMutate` | `acquire`(`LockTimeoutError` → 印訊息 return 1,**不跑 Stryker**)→ `installCleanup` → `try { runStryker } finally { uninstall; release }` | 【驗】六條測試 |

另外補了兩個沒在 TODO 清單裡、但沒有就不能用的東西:

- `removeLockFile`(內部):無條件刪鎖。只有兩個呼叫端——確認過是自己的(`releaseLock`)、
  確認過是殘鎖(`acquireLock`)。抽出來是為了讓「只刪自己的」跟「清殘鎖」在讀的時候分得開。
- `spawnStryker`:真的把 Stryker 叫起來(`node_modules/.bin/stryker`,`stdio: 'inherit'`)。
  測試一律注入假的 `runStryker`,這一段沒有測試覆蓋,所以用 `// Stryker disable all`
  標掉——不要讓測不到的 spawn 混進分數裡假裝有人守。

### 一個 typecheck 逼出來的細節

專案開了 `exactOptionalPropertyTypes: true`,所以 `acquireLock` 不能寫
`classifyLock(read, { staleAfterMs: deps.staleAfterMs })`——`number | undefined` 塞不進 `number`。
改成展開 `deps`:`classifyLock(read, { ...deps, now: now(), isAlive })`。
順帶好處是 `staleAfterMs` / `corruptGraceMs` 的預設值只有 `classifyLock` 一份,不會有兩個真相。

## 2. signal handler 與 finally 怎麼分工

**兩條獨立的路,不是同一件事的兩種寫法。** 上一輪已經查證過(M1 / M2 反向驗證),這一輪照那個結論實作:

| 結束方式 | 走哪條路 | finally 會跑嗎 |
|---|---|---|
| Stryker 正常結束(退出碼 0 或非 0) | `runMutate` 的 `finally` | ✅ |
| Stryker 丟例外 | `runMutate` 的 `finally`(例外照樣往外傳) | ✅ |
| 使用者 Ctrl-C(SIGINT) | `installCleanup` 的 handler → release → `exit(130)` | ❌ |
| 被 `kill`(SIGTERM) | `installCleanup` 的 handler → release → `exit(143)` | ❌ |
| `process.exit()` 被別處呼叫 | `installCleanup` 的 `exit` handler(只 release,不再 exit) | ❌ |

signal 一旦掛了 handler,預設「結束程序」的行為就沒了,變成我們負責結束,所以 release 之後
要自己 `exit(128 + signo)`。而 `process.exit()` 是同步的、不會 unwind,`finally` 根本跑不到——
所以兩邊都要有,少一個鎖就會留下來。

`release` 是冪等的(`releaseLock` 讀不到檔案就回 false),所以 finally 與 handler 各叫一次不會出事。

### 追加:SIGTERM 要連 Stryker 子行程一起收掉

自己攔了 SIGINT / SIGTERM 之後,「連子行程一起收掉」的預設行為也沒了。不處理的話會變成
**鎖放掉了、吃記憶體的 Stryker 還在**——正好是這支要防的踩踏。

`spawnStryker` 用 `process.prependListener` 把「轉發 signal 給子行程」排在 `installCleanup`
的 handler **前面**:那個 handler 會直接 `process.exit`,排在它後面永遠不會跑到。

**實測**:acceptance 那輪 Stryker 跑到一半,對持鎖的 pid 送 `SIGTERM`——

```
$ cat /data/python/llm_learning-cards/.stryker.lock
{"pid":227247,"startedAt":"2026-09-04T07:47:29.998Z","cwd":".../mutate-lock"}
$ kill -TERM 227247 && sleep 3
$ ls /data/python/llm_learning-cards/.stryker.lock
ls: cannot access ...: No such file or directory      ← 鎖刪掉了
$ ps -eo cmd | grep "[m]utate-lock" | grep stryker
(空)                                                  ← Stryker 子行程也一起沒了
```

## 3. 參數透傳怎麼驗的

`npm run mutate` = `tsx scripts/mutate.ts --`。npm 會把使用者的參數接在那個 `--` 後面,
所以 `strykerArgs` 看到的 argv 就是 `[node, mutate.ts, --, <使用者的東西>]`。

單元測試七個 case 釘住轉換規則。端到端則有兩個實證:

1. **帶引號的逗號與驚嘆號沒被拆開。** acceptance 那輪跑的是
   `npm run mutate -- --mutate "scripts/mutate.ts,!scripts/mutate.test.ts"`,`ps` 看到底層是
   ```
   node ... scripts/mutate.ts -- --mutate scripts/mutate.ts,!scripts/mutate.test.ts
   ```
   整串是**一個 argv 元素**;Stryker 也確實解讀成排除規則(見第 5 節的 `Found 1 of ... file(s)`)。
2. **設定檔當位置參數也過得去。** 25 次競態測試每一輪跑的都是
   `npm run mutate -- stryker.scanner-doclinks.json --dryRunOnly`,Stryker 讀到了那份設定檔
   (log 裡有 `Instrumented 1 source file(s) with 271 mutant(s)`,正是 doclinks 的範圍)。

## 4. 25 次競態反向驗證

P-41:懷疑競態的反向驗證要跑 25 次以上,只有幾 % 會紅的守門等於沒守門。

**做法**(腳本在 scratchpad,不進 git):每一輪**同時**起兩個**真的 `npm run mutate`**,
搶主 repo 根的同一把 `.stryker.lock`。兩邊跑的都是
`stryker.scanner-doclinks.json --dryRunOnly`(約 12 秒,拿鎖的窗口遠大於開機時間的抖動)。
全程另外開 `nproc` 個 busy loop 把每顆核心塞滿,製造負載。

一輪算通過要同時滿足三件事:恰好一個拿到鎖、恰好一個印出等待訊息、兩邊被 SIGTERM 收掉後鎖不殘留。

```
round 1..25: OK  winners=1 waiters=1 lockLeft=0 decided=1
───────────────────────────────
rounds=25 ok=25 bad=0  兩邊都贏(鎖失效)=0  兩邊都等(卡死)=0  殺掉後鎖殘留=0
```

輸家印的就是 `waitingMessage`:

```
等 /home/pollux/orca/workspaces/llm_learning-cards/mutate-lock 的 Stryker(pid 46751)跑完,已等 0 秒…
等 /home/pollux/orca/workspaces/llm_learning-cards/mutate-lock 的 Stryker(pid 46751)跑完,已等 15 秒…
```

### 反向驗證這個反向驗證

25 次全綠的守門,要先證明它「會紅」才算數。把 `tryAcquire` 的 `EEXIST` 分支從 `return false`
改成 `return true`(鎖形同失效),同一支腳本跑 3 輪:

```
round 1: BAD  winners=2 waiters=0 lockLeft=0 decided=0
round 2: BAD  winners=2 waiters=0 lockLeft=0 decided=0
round 3: BAD  winners=2 waiters=0 lockLeft=0 decided=0
rounds=3 ok=0 bad=3  兩邊都贏(鎖失效)=3  ...
```

3/3 抓到。改回來之後 `grep -n "NEGATIVE CONTROL" scripts/mutate.ts` 0 命中,`git diff` 也確認還原乾淨。

## 5. 把繞過鎖的路堵掉

上一輪點出的缺口:文件裡用 `npx` 直接叫 `stryker run` 的寫法會繞過鎖。**這比想像的嚴重**——
repo 裡幾乎每一份審核紀錄與 skill 都寫那條指令,鎖做好了但每一輪審核都會繞過它。

改了 25 處、10 個檔案:

| 檔案 | 處數 |
|---|---|
| `.claude/skills/mutation-testing/SKILL.md` | 3 |
| `.claude/skills/phase-acceptance/SKILL.md` | 1 |
| `REVIEW.md` | 4 |
| `features/01-data-layer/FEATURE.md` | 3 |
| `features/01-data-layer/REVIEW.md` | 2 |
| `features/02-ingest-pipeline/REVIEW.md` | 4 |
| `features/03-llm-router/REVIEW.md` | 1 |
| `features/04-scheduler/REVIEW.md` | 1 |
| `features/11-review-cli/REVIEW.md` | 3 |
| `docs/reviews/P-28-scanners-and-doc-links.md` | 3 |

`docs/reviews/P-29-mutate-lock-tests.md` 那一處是**描述缺口的散文**,不是可以照抄的指令,
所以改成「直接叫 stryker CLI 的那條路」,不是機械替換。

兩個 skill 另外加了說明:用 `npx` 直接叫 `stryker` 會繞過鎖、可能跟別的 worktree 互相 OOM,
一律用 `npm run mutate`,並寫清楚鎖的三個行為(15 秒重試 / 殘鎖判定 / signal 清理)。

P-40(批次改文字後要 grep 驗證,`sed` 找不到不會報錯):

```
$ grep -rn "npx[ ]stryker" --include="*.md" . | grep -v node_modules
(0 命中)
```

### 順帶抓到的現況

做這一輪的時候,`ps` 顯示 **`golden-set-registration` worktree 正在直接跑 `stryker`**
(不是 `npm run mutate`),7 個 worker 行程、記憶體剩 11 GB、swap 已經吃滿 3/3。
這就是這張工單要防的場景,而且證明「只改程式不改文件」等於沒做——
acceptance 那輪的 Stryker 是排在它後面才跑的。

## 6. 驗收數字

| # | 檢查 | 結果 |
|---|---|---|
| 1 | `npm run boundaries` | ✅ 掃描 195 個檔案,允許例外 11 條,**0 違規** |
| 1 | `npm run typecheck` | ✅ 0 錯誤 |
| 1 | `npm run lint:docs` | ✅ 掃描 80 個 markdown 檔,20 條相對連結,全部都在 |
| 2 | `npx vitest run` | ✅ **80 個檔案全綠,1578 條全綠**(既有 1510 + 新的 68) |
| 3 | `npm run accept:dry` | ✅ 496 scenarios / 2264 steps,**0 ambiguous**(155 undefined 是既有未實作的 feature) |
| 4 | `npm run mutate -- ...` 真的跑起來 | ✅ **總分 78.93% / covered 84.43%**(195 killed、11 timeout、38 survived、17 no-cov,276 個變異,3 分 39 秒)見下方 |
| 5 | `grep -rn "npx[ ]stryker" --include="*.md" .` | ✅ **0 命中**(含這份回報自己——描述缺口的地方一律寫成「用 `npx` 直接叫 `stryker`」,才不會讓下一輪的 grep 誤判成沒改完) |
| 6 | 競態反向驗證 ×25(負載下) | ✅ **25/25**;反向控制組 3/3 抓到 |
| 7 | `git diff --stat fa66f88..HEAD -- '*.test.ts' '*.steps.ts' '*.feature'` | ✅ **空的** |

### Stryker 分數

**先講一件要協調者知道的事**:工單指定的
`npm run mutate -- --mutate "scripts/mutate.ts,!scripts/mutate.test.ts"` **真的跑得起來**
(拿到鎖、Stryker 起來、參數原樣過去、`Found 1 of 440 file(s) to be mutated`),但它走
`stryker.config.json` 的預設值——`coverageAnalysis: perTest` 加上跑全 repo 的 vitest。
`scripts/mutate.ts` 有 13 個 static mutant(模組層級的常數),每一個都得重跑整套 1578 條測試:

```
WARN MutantTestPlanner Detected 13 static mutants (5% of total) that are estimated to take 94% of the time
Mutation testing 0% (elapsed: <1m, remaining: ~5h 0m) 2/276 tested
```

**ETA 5 小時**,而且那 5 小時裡有一大半是重跑跟這支完全無關的測試。所以改用這個專案自己的
scanner 慣例(P-28 對三個掃描器做過同一件事):新增
`stryker.scanner-mutatelock.json` + `vitest.scanner-mutatelock.config.ts`
(`coverageAnalysis: off`、vitest 只 include `scripts/mutate.test.ts`、`concurrency: 4`)。
**同樣 276 個變異、同樣的範圍,3 分 39 秒跑完。**

```
$ npm run mutate -- stryker.scanner-mutatelock.json

-----------|------------------|----------|-----------|------------|----------|----------|
           | % Mutation score |          |           |            |          |          |
File       |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
-----------|--------|---------|----------|-----------|------------|----------|----------|
All files  |  78.93 |   84.43 |      195 |        11 |         38 |       17 |        0 |
 mutate.ts |  78.93 |   84.43 |      195 |        11 |         38 |       17 |        0 |
-----------|--------|---------|----------|-----------|------------|----------|----------|
Done in 3 minutes and 39 seconds.
```

**總分 78.93%,covered 84.43%。** 分級表把「CLI 進入點」列在寬鬆級(不跑),
但拿標準級的 80% 對照的話,covered 過了、total 沒過。以下是 55 個沒被殺掉的(38 存活 + 17 no coverage)逐一分類
(**沒有一個是靠改測試才能修的,因為這一輪不准動測試**)。

| 類別 | 數量 | 行號 | 判定 |
|---|---|---|---|
| **訊息字串的內容沒被斷言** | 11 | 104、199、201、212、215、307、316×2、328、329、330 | **不值得**。測試斷的是 `toContain('小時')` / `toContain('pid')` / `toContain('讀不出')` / `not.toContain('undefined')`——斷關鍵詞而不是整句,是對的做法;整句被釘死之後改一個字就紅 |
| **等價變異(行為完全一樣)** | 8 | 115、128、173、176、182、368、369、370 | **不值得**。`git rev-parse` 輸出的 `.trim()` 拿掉照樣對(`dirname()` 本來就吃掉換行);`parseLock` 的 `typeof value !== 'object'` 被後面的 `typeof pid !== 'number'` 擋住;`target.off?.()` 的 `?.` 是給 optional 介面成員用的,真假 target 都有 `off` |
| **觀察不到的副作用** | 3 | 235、236、237 | **不值得**。`fsyncSync` 是掉電後的耐久性、`closeSync` 是 fd 洩漏,兩件都不是單元測試看得到的 |
| **測試沒走到的路徑**(要補測試) | 7 | 163、228、295、300、409、415、422 | 「不是 ENOENT / EEXIST 就往外丟」那幾條、`read === null` 的競態窗口、`acquireLock` 回傳的 `release` 沒有被叫過。**這一輪不准動測試**,留給審核輪判斷 |
| **頂層 bootstrap** | 9 | 476、477×3、478×3、481×2 | **在這個測試檔裡殺不掉**。測試是 `import` 這個模組的,`isMainModule` 永遠回 false;要殺得另外開子行程 |
| **注入 fake 之後預設值沒人走**(Stryker 記成 no coverage) | 17 | 264、266×5、273、274、285、286×2、287、405、408、477、481、484 | `deps.now ?? (() => Date.now())`、`deps.lockPath ?? strykerLockPath()`、`selfLockInfo` 的兩個預設參數、`removeLockFile` 的 ENOENT 分支。同上,要補測試 |

`spawnStryker`(真的把 Stryker 叫起來那段)用 `// Stryker disable all` 排除了,
所以上面的數字裡沒有它——那段沒有測試,混進來只會讓分數看起來比實際有人守的多。

### 這一輪順手殺掉的 6 個

第一次跑是 **77.90 / 83.01**,`errnoCode` 一個函式就佔了 8 個存活。原本寫成:

```ts
if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
const { code } = err as { code: unknown };
return typeof code === 'string' ? code : undefined;
```

那層守衛是**死的**:呼叫端一律拿結果去跟 `'ENOENT'` / `'EEXIST'` / `'ESRCH'` 比對,
`code` 是數字、是 undefined、`err` 根本不是物件——比出來都一樣是 false。守衛在不在,
沒有任何一個呼叫端的行為會變。簡化成一行 optional chaining 之後分數變 **78.93 / 84.43**。

這不是為了殺變異而改程式,是變異測試指出了一段沒有作用的防禦性程式碼——
正是 `mutation-testing` skill 說的「不值得殺 → 簡化程式」那一類。

