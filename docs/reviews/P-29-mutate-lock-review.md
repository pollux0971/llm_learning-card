# REVIEW — P-29:Stryker 跨 worktree 檔案鎖(審核輪)

審核對象:`2f2278a`(`scripts/mutate.ts` 實作),接 `a31a6ef`(測試骨架)、
`fa66f88`(測試輪回報)、`docs/reviews/P-29-mutate-lock-impl.md`(實作輪回報)。

**放這裡的理由**:這張跨 `scripts/`,沒有對應的 `features/NN-xxx/`。
P-28 的同類工單(掃描器 + 文件連結)就放 `docs/reviews/P-28-scanners-and-doc-links.md`,
而 P-29 的實作輪 / 測試輪回報也已經在 `docs/reviews/` 底下,照同一個慣例接上第三份。
根目錄的 `REVIEW.md` 是 `03-llm-router/phase-2` 專用的,不是共用檔,不該往裡塞。(2026-09-05:這段警告寫了兩次仍然被覆蓋一次,所以改成機械修法——那個檔已移到 `docs/reviews/03-llm-router-phase-2-round-1.md`。**但同一天陷阱就被重建了一次**:stryker-lock 那條分支照 P-17 慣例把交接寫在 worktree 根的 `REVIEW.md`,合併時它就變成 main 上一個新的追蹤檔,下一個 worker 照慣例寫又會覆蓋它。已再移到 `docs/reviews/stryker-lock-allsuite.md`。**搬走一個實例擋不住這個類** —— 真正的修法是模板 1.4.2 把交接慣例改成 `.orca-brief/REVIEW.md`(gitignore),讓「照慣例寫」不可能覆蓋任何追蹤檔。)

## 結論:**PASS**

鎖本身是對的,而且**我自己重跑的每一項都獨立複現了實作輪的宣告**。
審核輪額外做了三件事:補上實作輪不准動的測試(變異分數 **78.93% → 94.25%**)、
找出**一個實作輪與測試輪都漏掉的行為缺口**(SIGTERM 之後 Stryker 子行程),
以及把「文件裡不准教人繞過鎖」從一次性的人工 grep 釘成測試。

---

## 1. 二十五次競態 —— 我自己重跑的

**沒有沿用實作輪的腳本**,重寫了一支走 `runMutate()` 完整路徑的:
每輪同時起兩個行程搶同一把鎖,兩邊先空轉對齊到同一個時間點才進 `openSync`,
全程另外開 `nproc` 個 busy loop 把每顆核心塞滿。

一輪算通過要**同時**滿足五件事(比實作輪多兩條):

1. 恰好一個印出 `HELD`(拿到鎖)
2. 輸家**還活著而且在等**,不是死掉(印出 `waitingMessage`)
3. 持鎖期間鎖檔存在
4. SIGTERM 掉贏家之後,鎖不殘留,而且**輸家真的接手拿到鎖**
5. 兩邊都收掉之後鎖檔不留

```
#1 OK #2 OK #3 OK #4 OK #5 OK #6 OK #7 OK #8 OK #9 OK #10 OK #11 OK #12 OK
#13 OK #14 OK #15 OK #16 OK #17 OK #18 OK #19 OK #20 OK #21 OK #22 OK
#23 OK #24 OK #25 OK

=== 25/25 ===
```

**25/25,零失敗。** 腳本在 scratchpad(`race.mjs` / `holder.mts`),不進 git。

### 1.1 反向控制組 —— 九種破壞,全部變紅

只有正面 25/25 不算數(P-41)。逐一把程式改壞,看守門會不會紅。
**前兩個是我自己想的,不是實作輪用過的那個 `EEXIST` 分支。**

| # | 破壞什麼 | 為什麼這樣改會出事 | 結果 |
|---|---|---|---|
| 1 | **`openSync(lockPath, 'wx')` → `'w'`**(我自己想的) | `wx` 的 `O_EXCL` 才是原子性的來源;`'w'` 是「有就覆蓋」,兩個行程會同時「拿到」 | **紅 ✅** |
| 2 | **鎖路徑改成 worktree 本地**(我自己想的) | `dirname(git-common-dir)` 換成 `resolve(cwd)`,每個 worktree 一把自己的鎖 = 沒鎖 | **紅 ✅** |
| 3 | `runMutate` 的 `finally` 不再 release | 路 A:Stryker 正常結束或丟例外時鎖會留下 | **紅 ✅** |
| 4 | `installCleanup` 不掛 SIGTERM | 路 B:被 kill 時鎖會留下 | **紅 ✅** |
| 5 | `installCleanup` 不掛 SIGINT | 路 B:Ctrl-C 時鎖會留下 | **紅 ✅** |
| 6 | `spawnStryker` 不轉發 signal 給子行程 | 鎖放掉了、Stryker 還在吃記憶體 | **紅 ✅**(只有審核輪新加的那條測試抓到,見 §3) |
| 7 | 剛好 2 小時就算殘鎖(`>` → `>=`) | 邊界 | **紅 ✅** |
| 8 | 壞檔寬限期 `<=` → `<`(剛好 10 秒就刪) | 邊界 | **紅 ✅** |
| 9 | `EPERM` 當成死的 | 會刪掉別人正在用的鎖,正是要防的踩踏 | **紅 ✅** |

**9/9 全部變紅。** 每次都 `cp` 還原,跑完 `git diff -- scripts/mutate.ts` 是空的。

第 3 條與第 4/5 條**分開驗**,證實 `finally` 與 signal handler 是兩條**各自獨立**的路:
拆掉任一條,另一條的測試照樣綠、被拆的那條變紅。

---

## 2. 鎖路徑真的跨 worktree —— 實測,不是看測試

拿這台機器上**真的**五個 worktree(加一個子目錄)去算 `strykerLockPath()`:

```
/data/python/llm_learning-cards/.stryker.lock   <=   /data/python/llm_learning-cards
/data/python/llm_learning-cards/.stryker.lock   <=   /data/python/llm_learning-cards/.claude/worktrees/agent-a551c3d51889a2793
/data/python/llm_learning-cards/.stryker.lock   <=   /home/pollux/orca/workspaces/llm_learning-cards/golden-set-registration
/data/python/llm_learning-cards/.stryker.lock   <=   /home/pollux/orca/workspaces/llm_learning-cards/mutate-lock
/data/python/llm_learning-cards/.stryker.lock   <=   /home/pollux/orca/workspaces/llm_learning-cards/user-facing-zero-guard
/data/python/llm_learning-cards/.stryker.lock   <=   /home/pollux/orca/workspaces/llm_learning-cards/mutate-lock/scripts
---
unique lock paths: 1
```

**六個不同的呼叫端,一個路徑。** 而且是主 repo 的根,不是任何一個 worktree 自己的根。

實際跑的時候也確認過鎖真的被建出來:

```
$ npm run mutate -- stryker.scanner-mutatelock.json &
$ cat /data/python/llm_learning-cards/.stryker.lock
{"pid":1047706,"startedAt":"2026-09-04T08:46:44.296Z","cwd":"/home/pollux/orca/workspaces/llm_learning-cards/mutate-lock"}
```

---

## 3. 釋放的兩條路 + **實作輪漏掉的第三件事**

`finally` 與 signal handler 各自破壞過(§1.1 的 3 / 4 / 5),各有測試會紅,**各自獨立成立**。

### 3.1 子行程那條**沒有測試**(這是這次審核最主要的發現)

實作輪回報說「SIGTERM 之後鎖被刪、Stryker 子行程也一起收掉」,並且貼了 `ps` 的手動實測。
**但那是一次性的人工觀察,沒有任何測試釘住它。** 原本的
`describe('SIGTERM 之後鎖不留')` 注入的是假的 `runStryker`,
真正負責轉發 signal 的 `spawnStryker` 一行都沒被執行到(它還帶著 `// Stryker disable all`)。

這個缺口很危險:**鎖放掉了、吃記憶體的 Stryker 還在**,下一個人拿到鎖之後照樣被同一個
Stryker OOM 掉 —— 正是這張工單要解的問題,只是換了個更難查的形狀。

**已補**(`scripts/mutate.test.ts` §12):把 `scripts/mutate.ts` **原封不動** `cpSync` 到臨時目錄,
在它旁邊放一支假的 `node_modules/.bin/stryker`(`echo $$ > pidfile; exec sleep 600`,
用 `exec` 才保證 pid 就是被 kill 的那個),然後只給 `lockPath` 呼叫 `runMutate` ——
`runStryker` 走預設值,也就是**真正的 `spawnStryker`**。SIGTERM 父行程之後同時斷言:

- 假 stryker 的 pid **已經死了**
- 鎖檔**不在了**

反向驗證(§1.1 第 6 條):把 `process.prependListener` 那兩行拿掉,
`Tests 1 failed | 87 passed` —— **只有這一條紅**,證明缺口是真的、而且現在被補起來了。

### 3.2 真的 kill 一次真的 Stryker

審核過程中對正在跑的 `npm run mutate`(pid 1186342)送 SIGTERM:

```
$ kill -TERM 1186342
$ ls /data/python/llm_learning-cards/.stryker.lock
(不存在)
$ pgrep -af stryker | grep mutate-lock
(空)
```

鎖清掉、子行程收乾淨。

---

## 4. 三個邊界

| 邊界 | 有測試? | 邊界值本身有測? | 破壞會紅? |
|---|---|---|---|
| 剛好 2 小時算**活鎖**(規格是「超過」) | ✅ | ✅ 三條:`2h`、`2h+1ms`、`2h-1ms` | ✅(§1.1 #7) |
| 鎖檔壞掉用 mtime **10 秒**寬限 | ✅ | ✅ 三條:寬限期內、**剛好 10 秒**、超過 | ✅(§1.1 #8) |
| `EPERM` 算**活的不刪** | ✅ | ✅ 連「其他錯誤碼也當活的」都有 | ✅(§1.1 #9) |

另外還有兩條邊界寫得對而且有測:`startedAt` 在未來(時鐘跳了)不算殘鎖;
壞檔超過寬限期時**不去問 `isAlive`**(根本沒有 pid 可問)。

---

## 5. 25 處文件改動 —— 自己再 grep 一次

跑的是工單指定的那條(pattern 用變數組出來,免得這份文件自己變成下一輪的誤報):

```
$ PAT='npx st''ryker\|st''ryker run'
$ grep -rn "$PAT" --include="*.md" --include="*.json" . | grep -v node_modules
(0 命中)
```

再跑一條更寬的(涵蓋 `pnpm` / `yarn` / `bunx`,而且連 `*.ts` / `*.sh` 都掃):

```
$ grep -rnE "(^|[^-a-z])(npx |pnpm |yarn |bunx )?st""ryker (run|--)" \
    --include="*.md" --include="*.json" --include="*.ts" --include="*.sh" . | grep -v node_modules
scripts/mutate.test.ts:882   (測試名稱:「走的是 scripts/mutate.ts,不是直接叫 CLI」)
scripts/mutate.ts:9          (docstring:說明 npm run mutate 等同於哪條指令)
scripts/mutate.ts:15         (docstring:警告哪條路會繞過鎖)
```

**`.md` / `.json` 0 命中,達標。** 剩下三處都在程式碼的註解與測試名稱裡,
是在**說明這條路不能走**,不是可以照抄的指令。

初次 grep 時另外抓到一處:`docs/reviews/P-29-mutate-lock-impl.md:134` 把那條指令
寫在反引號裡(描述缺口的散文)。反引號會讓下一輪的人以為那是指令,已改成「Stryker CLI」,語意不變。

### 5.1 這一條不能只靠人跑一次 grep

工單說得對:**這條是這張工單的成敗關鍵**。但實作輪的做法是「人跑一次 grep,貼結果」——
grep 不會自己再跑一次。下一個人寫一份新的審核紀錄,照抄那條 CLI 指令,鎖就再次形同虛設。

**已補**(`scripts/mutate.test.ts` §13)四條測試:

1. 掃全 repo 的 `.md` / `.json` / `.sh`,不准出現 `npx|pnpm|yarn|bunx` + Stryker CLI
2. 不准出現可以照抄的 CLI 子指令形式
3. **掃描器不是空掃**(掃到的檔案數 > 20,而且一定要包含 `.claude/skills/mutation-testing/SKILL.md`)
   —— P-28 的教訓:找到 0 條目的掃描器長得跟「全部通過」一模一樣
4. 反向控制:拿假的違規行餵規則,確認規則本身認得出來

第 3 條**當場就抓到自己**:第一版用 `git ls-files`,在 Stryker 的沙盒
(`.stryker-tmp/sandbox-*`,不是 git repo)裡掃到 0 個檔案,dry run 直接紅。
改成從測試檔往上找第一個有 `.git` 的祖先(worktree 的 `.git` 是檔案不是目錄,
`existsSync` 兩種都認),從沙盒走回真正的 repo —— 這條規則本來就該檢查真的那一份。

**這份文件自己也被這條規則掃到了。** 第一版把 grep 的原始輸出整段貼進來,
於是文件裡就真的出現了那條可以照抄的指令,測試變紅。
**沒有替它開例外** —— 例外一開就會被下一個人沿用,規則就爛了。
改成用「Stryker CLI」轉述,pattern 用字串拼接躲開。規則維持零例外。

### 5.2 順帶記錄:鎖還沒進 main,現在就有人在繞

審核期間 `ps` 顯示 `golden-set-registration` worktree 正在跑:

```
1099596 npm run mutate stryker.pq.json --mutate .../registry.ts
1099733 sh -c <Stryker CLI 直接呼叫> stryker.pq.json --mutate .../registry.ts
```

它的 `npm run mutate` 還是舊的、直接叫 CLI 的版本(那個分支早於這把鎖),所以**繞過了鎖**。
這不是缺陷,是「鎖還沒合併進 main」的必然結果,但它具體證明了 §5 那 25 處改動的必要性:
**只要有一個地方還寫著舊指令,鎖就擋不住那個人。**

---

## 6. 其餘檢查

| 檢查 | 結果 |
|---|---|
| `git diff a31a6ef..HEAD -- '*.test.ts' '*.steps.ts' '*.feature'` | ✅ **空的**(實作輪確實沒動測試) |
| `.stryker.lock` 在 `.gitignore` | ✅ 第 7 行,而且有測試釘住 |
| 參數透傳 `--mutate "a.ts,!b.test.ts"` | ✅ 七個單元 case;而且審核輪真的用 `npm run mutate -- stryker.scanner-mutatelock.json` 跑起來過 |
| 縮範圍的設定檔合不合理 | ✅ 見下 |

### 6.1 `stryker.scanner-mutatelock.json` 縮掉的是對的

`mutate: ["scripts/mutate.ts", "!scripts/mutate.test.ts"]`、
vitest 只 `include: ['scripts/mutate.test.ts']`、`coverageAnalysis: off`。

**縮掉的部分跟這張完全無關**:這張只動 `scripts/mutate.ts` 一個檔案,
被排除的是其他 79 個測試檔與 457 個沒被改到的原始檔。
沒有「該測的被縮掉」——`scripts/mutate.ts` 全部進來了,一行沒漏。
這跟 P-28 對三個掃描器做的是同一件事。

**為什麼非縮不可**:走 `stryker.config.json` 的預設值(`coverageAnalysis: perTest` + 全 repo vitest)
ETA 是 5 小時,因為 13 個 static mutant 各要重跑一次全部 1596 條測試。
縮範圍之後同樣的變異、同樣的檔案,4 分鐘跑完。

---

## 7. 變異測試

### 7.1 分數

| 輪次 | 總分 | covered | killed | timeout | survived | no cov |
|---|---|---|---|---|---|---|
| 實作輪交件 | 78.93% | 84.43% | 195 | 11 | 38 | 17 |
| 審核輪(第一批補測試後) | 88.51% | 89.19% | 220 | 11 | 28 | 2 |
| 審核輪(全部補完) | **94.25%** | **94.98%** | 236 | 10 | 13 | 2 |

**94.25%,過 80%**(嚴格級的 95% 也只差 0.75)。
用的是同一份 `stryker.scanner-mutatelock.json`,同樣 261 個變異,
`Done in 4 minutes and 23 seconds`、**退出碼 0**,不是被殺掉的殘缺結果。

單元測試從 **68 條 → 109 條**(全 repo 1578 → 1617),全綠。

### 7.2 補的測試怎麼分的

實作輪標成「要補測試」的 24 個,審核輪逐一處理:

| 補了什麼 | 殺掉的行 | 為什麼是**真漏測**而不是為了分數 |
|---|---|---|
| `readLock` 碰到 `EISDIR` 要往外丟 | 163 | 靜靜回 null = 「沒人持鎖」= 直接搶,兩個 Stryker 一起跑 |
| `tryAcquire` 碰到 `ENOENT` 要往外丟 | 228 | 靜靜回 false = 永遠等一把建不出來的鎖,90 分鐘後 exit 1 |
| `selfLockInfo` 不給參數時的預設值 | 273、274 | pid / cwd 寫錯,`releaseLock` 就認不出自己的鎖 |
| `acquireLock` 預設的 now / sleep / log | 285、286、287 | 預設 sleep 是 no-op 的話會空轉幾千圈,不是每 15 秒一次 |
| `acquireLock` 回的 `release` 真的刪鎖 | 295 | 這是 `finally` 與 signal handler 兩條路共用的那個函式 |
| 殘鎖在清掉前被別人刪走(`removeLockFile` 的 ENOENT) | 264、266 | 用 `isAlive` 的副作用把競態窗口變成確定的 |
| `read === null` 的競態窗口:馬上重搶不睡 | 300 | 懸空 symlink:`openSync('wx')` 丟 EEXIST 但 `readFileSync` 丟 ENOENT,正好造出那個窗口 |
| `runMutate` 預設的 lockPath / acquire / log | 405、408、409 | 預設 lockPath 走錯 = 每個 worktree 一把鎖 |
| `acquire` 丟的不是 `LockTimeoutError` 要原樣往外丟 | 415 | 翻成 exit 1 會讓「磁碟壞了」長得跟「等鎖等太久」一樣 |
| 交給 `installCleanup` 的 callback 真的放掉這把鎖 | 422 | |
| `isMainModule` 四條 | 476、477、478 | 回 true 的話,任何 import 這個模組的人都會被順便跑一輪 Stryker |
| **`parseLock('null')` 不能丟 TypeError** | 176 | `typeof null === 'object'`,少了 `value === null` 那一段會去解構 null → **例外炸穿 acquireLock,鎖留在原地** |
| `startedAt` 解不出時間時回 null | 182 | `NaN > staleAfterMs` 永遠 false → **那把鎖永遠不會過期,擋滿 90 分鐘** |
| 訊息裡的單位換算(秒 / 分 / 小時) | 201、212、316、330 | 乘除寫反會印成「10000 秒」「45000000 秒」,人會照著錯的數字判斷 |
| 每個 verdict 的 `why` 不能是空字串 | 199、215、307 | 空字串會讓「清掉殘留的 Stryker 鎖:」後面什麼都沒有 |
| `waitingMessage` 的兩個備用字樣 | 328、329 | |
| `LockTimeoutError.name` | 104 | `err.name === 'LockTimeoutError'` 的判斷會失效 |
| `target.off?.()` 的 `?.` | 368、369、370 | `off` 在 `SignalTarget` 介面裡是 optional,沒有 off 的 target 一 uninstall 就 TypeError |
| **SIGTERM 之後 Stryker 子行程也要死** | (spawnStryker,已 disable) | §3.1,這條不影響分數但影響正確性 |
| **文件裡不准教人繞過鎖** | (不在 mutate.ts) | §5.1 |

**訊息類的判定原則**:整句**不釘**(改一個字就紅,那是壞測試),但
(a) 理由不能是空字串、(b) 單位換算不能算錯 —— 這兩件是真的會誤導人的。

### 7.3 剩下 15 個沒殺掉的,逐條分四類

存活 13 + no coverage 2 = 15,全部列在這裡,沒有省略:

| 類別 | 行:欄 | 變異種類 | 判定與**精確**理由 |
|---|---|---|---|
| **真等價** | 115:10 | OptionalChaining | `(err as ...)?.code` 的 `?.` 拿掉。只有 `throw null` / `throw undefined` 才有差,而 `errnoCode` 的四個呼叫端接的都是 `fs` / `child_process` 丟出來的 `Error`。**沒有可達的輸入能分辨**。 |
| **真等價** | 128:18 | MethodExpression | `git rev-parse` 輸出的 `.trim()` 拿掉。結果拿去 `resolve(cwd, x)` 再 `dirname()`,尾巴的 `\n` 落在最後一段、被 `dirname()` 整段吃掉。**輸出位元組完全相同**。 |
| **真等價** | 173:11 | BlockStatement | `JSON.parse` 的 `catch { return null }` 清空。清空之後 `value` 留 `undefined`,下一行 `typeof undefined !== 'object'` 立刻回 `null`。**同樣回 null**。 |
| **真等價** | 176:7 | ConditionalExpression | 這一行有三個判斷,`value === null` 那個已經被新測試殺掉(§7.2)。剩下這個變異把整條件釘成常數,而 `Array.isArray` 那半段本來就被後面的 `typeof pid !== 'number'` 完全遮住(`[].pid` 是 `undefined`)。**遮蔽關係,不可分辨**。 |
| **真等價** | 182:7 | ConditionalExpression | 同上:`Number.isNaN(Date.parse(...))` 那半段已被新測試殺掉,剩下的是被 `typeof startedAt !== 'string'` 遮住的那半。 |
| **觀察不到的副作用** | 235:5 | CallExpression | `fsyncSync` 拿掉。它保的是**機器掉電之後**鎖檔不是半截的;單元測試在同一台沒斷電的機器上跑,看不到差別。要測得真的拔電源。 |
| **觀察不到的副作用** | 236:13 | BlockStatement | 同一個 `try/finally` 的 finally 區塊。 |
| **觀察不到的副作用** | 237:5 | CallExpression | `closeSync` 拿掉 = fd 洩漏。要測得跑幾千次 `tryAcquire` 撞 `EMFILE`,那種測試本身就是 flaky 來源。**不值得**。 |
| **死程式** | 264:17 | BlockStatement | `removeLockFile` 的 `catch` 區塊。 |
| **死程式** | 266:9 | ConditionalExpression | `if (errnoCode(err) === 'ENOENT') return false`。 |
| **死程式** | 266:45 | BooleanLiteral | 那個 `false`。 |
| **頂層 bootstrap** | 481:5 ×2 | ConditionalExpression | `if (isMainModule(...))` 的真 / 假兩個變異。 |
| **頂層 bootstrap** | 481:53 | BlockStatement(no cov) | 那個 `if` 的區塊。 |
| **頂層 bootstrap** | 484:35 | BlockStatement(no cov) | `runMutate().then(...)` 的 callback。 |

三個「死程式」的**精確理由**:`removeLockFile` 回傳的布林值**沒有任何呼叫端在看**。
`acquireLock` 那個呼叫直接丟掉;`releaseLock` 雖然 `return` 出去,但「讀得到鎖卻刪不到」
那一格只有在別人搶先刪掉時才會發生,而那一格 `true` 跟 `false` 對每一個呼叫端
(`held.release()` 丟掉回傳值、`installCleanup` 的 handler 也丟掉)都是同一個結果。
**建議把 `removeLockFile` 改成回 `void`**,三個變異會一起消失,讀的人也少一件要想的事。
不在這一輪改 —— 審核輪不重構實作(§9 待辦 1)。

四個「頂層 bootstrap」的**精確理由**:測試是 `import` 這個模組的,
vitest 底下 `process.argv[1]` 是 vitest 自己,`isMainModule` 永遠回 `false`。
把那個 `if` 變成 `true` 的變異,會讓「一 import 就跑一輪真的 Stryker」——
那不是測試能安全覆蓋的形狀(會真的去搶主 repo 的鎖、真的 spawn Stryker)。
`isMainModule` 的**函式本體**已經補了四條測試,476 / 477 / 478 全部殺掉了;
擋在門口的那個 `if` 留著,跟 `spawnStryker` 的 `// Stryker disable all` 是同一個道理。

**沒有一條走「加 disable 註解」那一類。** 這一輪一個 disable 都沒加。

**沒有為了衝分數改程式。** `scripts/mutate.ts` 這一輪**一行都沒動**
(`git diff 2f2278a..HEAD -- scripts/mutate.ts` 是空的)。

---

## 8. 完整驗收(全部真的重跑)

| # | 指令 | 結果 |
|---|---|---|
| 1 | `npm ci` | ✅ added 433 packages |
| 2 | `npm run boundaries` | ✅ 掃描 195 個檔案,允許例外 11 條,**0 違規** |
| 3 | `npm run typecheck` | ✅ 0 錯誤(補完測試之後再跑一次,仍 0) |
| 4 | `npm run lint:docs` | ✅ 掃描 80 個 markdown 檔,20 條相對連結,全部都在 |
| 5 | `npx vitest run` | ✅ **80 個檔案、1617 條全綠**(交件時 1578,審核輪 +39) |
| 6 | `npm run accept:dry` | ✅ 496 scenarios / 2264 steps,**0 ambiguous**(155 undefined 是既有未實作的 feature,數字跟交件時一模一樣) |
| 7 | `npm run accept:standalone` | ✅ 158 scenarios / 696 steps 全過 |
| 8 | `npm run standalone` | ✅ 全部通過(兩個 interactive 依設計跳過) |
| 9 | `npm run mutate -- stryker.scanner-mutatelock.json` | ✅ **94.25% / covered 94.98%**,`Done in 4m23s`,**退出碼 0** |
| 10 | 競態 ×25(負載下) | ✅ **25/25**;反向控制組 **9/9 全紅** |
| 11 | `git diff a31a6ef..HEAD -- '*.test.ts' '*.steps.ts' '*.feature'` | ✅ 空的 |

**沒有跑到的兩條**:工單列的 `npm run check:steps` 與 `npm run accept:coverage`
**在這個 repo 裡不存在**(`package.json` 沒有這兩個 script)。
最接近的替代已經跑了:`accept:dry` 就是 step 定義的檢查(ambiguous / undefined),
`standalone` 是單獨執行檢查。這兩個名字大概是從別的專案的工單模板抄過來的,
**建議把工單模板的指令清單對齊這個 repo 的 `package.json`**,不然每一輪都要重新解釋一次。

**沒有出現 137 / 144。** 每一輪 Stryker 都是正常 `Done in ...` 收尾。
(其中一輪確實跟 `golden-set-registration` 的 Stryker 同時在跑 —— 見 §5.2 —— 但那一輪
正常跑完、退出碼 0,不是被殺掉的殘缺結果。最終那一輪是等它跑完之後才開始的。)

---

## 9. 待辦(回報,不擋)

1. **`removeLockFile` 的布林回傳值沒有呼叫端在看**(§7.3)。建議改成回 `void`,
   `releaseLock` 直接 `return true`。三個變異會跟著消失,而且讀的人少一個要想的東西。
2. **`acquireLock` 的 `read === null` 那條是同步空轉的**(`continue` 不 `await`)。
   實際情形下那個窗口只有幾毫秒,沒問題;但如果鎖路徑變成一個**懸空的 symlink**
   (`openSync('wx')` 永遠 EEXIST、`readFileSync` 永遠 ENOENT),它會 100% CPU 空轉、
   而且**跳過等待上限檢查**,永遠不會 exit 1。補一個「連續 N 次讀到 null 就當異常」很便宜。
   審核輪的測試(§11 那條)已經把這個形狀記錄下來了。
3. **`runMutate` 的 `log` 沒有往下傳給 `acquireLock`**。等鎖的訊息走的是 `acquireLock`
   自己的預設 `console.log`,所以人還是看得到;但注入 `log` 的呼叫端會以為自己攔得到全部。
   不是 bug,是介面不一致。
4. **工單模板的指令清單**要對齊這個 repo 的 `package.json`(§8)。

---

## 附:審核輪改動的檔案

- `scripts/mutate.test.ts` —— 只加不改。68 條 → 109 條。四個新 describe 區塊
  (§11 預設值與例外、§12 子行程收屍、§13 文件守門、§14 剩下的存活變異)。
  **既有的 68 條一個字都沒動。**
- `docs/reviews/P-29-mutate-lock-impl.md` —— 一處措辭:反引號裡的 CLI 指令改成
  「Stryker CLI」,免得下一輪的 grep(與照抄的人)誤判。語意不變。
- `docs/reviews/P-29-mutate-lock-review.md` —— 這一份。

`scripts/mutate.ts` **一行都沒動**。
