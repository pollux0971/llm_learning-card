# allsuite-lock 另一半:覆核輪(spawnStryker group kill + 超集層)

分支 `pollux0971/lock-orphan`,實作 commit `af4d9c8`,`git merge main` 時已是最新(Already up to date)。
這輪是**覆核輪**:核對實作輪的三件說法、再試它沒提的形狀、嚴格級變異、全鏈驗收。
**動了測試檔**(§12b 加 SIGINT 版、假 stryker 改 node、新增 §12c 兩個 worktree 互不誤殺;§2b 補三條殺存活變異),**沒動 `scripts/mutate.ts`**;`scripts/run-tests.ts` 只加了**一行** `Stryker disable` 註解(真等價變異,理由寫在那行)。

## 一、結果一句話

| 項目 | 結果 |
|---|---|
| `spawnStryker` 與 `spawnVitest` 逐字比對 | **0 處實質差異**(只差函式名、binary 名、錯誤訊息裡的名字、兩個空行、註解) |
| `testRoots` 是真的掃出來的 | 是。加一個 `zz_probe_root/deep/x.test.ts` → 5 個根、四個全給變「小範圍」;刪掉 → 回 4 個 |
| 反向驗證 A(拿掉 detached + group kill) | §12b 紅,`孤兒 3/3` |
| 反向驗證 B(拿掉超集那一行) | run-tests.test.ts **11 紅 / 66 綠** |
| 真 Stryker,SIGTERM / SIGINT 打 inner 或 tsx 啟動器 | 四種組合 group **全部 11 → 0**,鎖都放了 |
| 真 Stryker,SIGKILL 打 inner | group **11 個全留**、鎖留著且 pid 已死(已知,歸「鎖要能自證死活」那張) |
| Stryker 正常跑完 | worker 0、stryker 0、鎖 no |
| 兩個 worktree 同時跑,殺一個 | 被殺那邊 group 歸零,**另一邊 worker 一個不少**(等鎖中 / 兩邊都在跑 × 先殺 X / 先殺 Y,共 3 種都做) |
| 嚴格級變異(`scripts/mutate.ts,scripts/run-tests.ts`) | 第一次 **98.25**(run-tests.ts 93.70:6 存活 + 2 沒覆蓋,全在新加的掃描碼);補 3 條測試 + 1 行等價註解後 **100.00**(446 killed + 9 timeout,0 存活 0 沒覆蓋) |
| 全鏈 12 步 | 全部 exit=0(含 `accept:dry` 0 ambiguous) |

## 二、覆核實作輪的三件

### 1. `spawnStryker` vs `spawnVitest` 逐字比對

方法:兩段各自去掉縮排與 `//` 註解行後 `diff`(`scripts/run-tests.ts:207-237` 對 `scripts/mutate.ts:606-647`)。

```
1,2c1,2
< function spawnVitest(args: string[]): Promise<number> {
< const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.bin', 'vitest');
---
> function spawnStryker(args: string[]): Promise<number> {
> const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.bin', 'stryker');
4a5
>
19a21
>
22c24
< console.error(`跑不起來 vitest(${bin}):${String(err)}`);
---
> console.error(`跑不起來 Stryker(${bin}):${String(err)}`);
```

差異清單:(a) 函式名 (b) binary 檔名 (c) 錯誤訊息裡的名字 (d) 兩個空行(mutate.ts 段落間多留白)。
`spawn` 選項、`forward` 的 try/catch 與 fallback、`prependListener`、`unforward`、`error` / `close` 處理**逐字相同**。
實作輪沒有漏報。兩段都在各自檔案的 `// Stryker disable all … restore all` 區間裡(mutate.ts:600-648、run-tests.ts:196-238),
所以變異分數**不涵蓋**這兩段,靠 §12 / §12b / §12c 這類真 spawn 的測試守。

### 2. `testRoots` 真的是掃出來的

在本 worktree 直接叫 `testRoots(cwd)` 與 `isPartialRun`(腳本在 scratchpad,不進 repo):

```
== BEFORE (no probe dir) ==
roots = [ 'apps', 'features', 'packages', 'scripts' ]
4 given partial? = false
3 given partial? = true
4 + nonexistent partial? = false
4 + docs(no tests) partial? = false
== WITH zz_probe_root/deep/x.test.ts ==
roots = [ 'apps', 'features', 'packages', 'scripts', 'zz_probe_root' ]
4 given partial? = true
3 given partial? = true
4 + nonexistent partial? = true
4 + docs(no tests) partial? = true
== AFTER rm ==
roots = [ 'apps', 'features', 'packages', 'scripts' ]
4 given partial? = false
```

`git status --short` 之後是乾淨的,探針目錄沒留在 diff 裡。

### 3. 反向驗證(我自己跑的)

**A. 拿掉 detached + group kill**(`sed` 把 `detached: true` 拿掉、`process.kill(-child.pid, sig)` 換回 `child.kill(sig)`,跑完 `git checkout` 還原):

```
npx vitest run scripts/mutate.test.ts -t "worker 不留"
     × 殺掉 npm run mutate,stryker 底下 fork 出來的 worker 也要跟著死,一個都不能留 5235ms
AssertionError: stryker 主行程死了但 worker 還活著(孤兒 3/3):: expected [ 2605217, 2605218, 2605219 ] to deeply equal []
 Test Files  1 failed (1)
      Tests  1 failed | 150 skipped (151)
```

**B. 拿掉超集那一行**(`if (roots.length > 0 && roots.every(...)) return false;` 刪掉):

```
npx vitest run scripts/run-tests.test.ts
 FAIL  isPartialRun 的超集規則(§2b) > 四個測試根全給 → 全套(拿鎖)
 FAIL  … > 順序、結尾斜線、絕對路徑、重複給都不影響
 FAIL  … > 四個根全給再多給旗標 → 還是全套
 FAIL  … > 沒有測試檔的頂層目錄不是測試根
 FAIL  … > 頂層檔案不是測試根
 FAIL  … > 測試根是掃出來的,不是寫死的
 FAIL  … > 只認 *.test.ts
 FAIL  … > node_modules 與點開頭的目錄不掃
 FAIL  … > 根底下的 node_modules 不算
 FAIL  … > 真的 repo:四個全給 → 全套;少一個 → 小範圍
 FAIL  runTests 的超集:四個根全給要拿鎖 > `npm test -- packages scripts apps features`:鎖被別人握著就要排隊
      Tests  11 failed | 66 passed (77)
```

兩次之後 `git status --short` 都是乾淨的。

## 三、它沒提到的形狀(全部用**真 Stryker**,`npm run mutate -- stryker.scanner-mutatelock.json --concurrency 5`)

行程樹(每次都長這樣):`npm` → `sh -c` → `tsx` 啟動器 → **inner node**(跑 mutate.ts、掛 installCleanup 的那個)→ `stryker`(**自己一組 pgid**)→ 5–6 個 `child-process-proxy-worker` + vitest fork。
「group」= stryker 那組 pgid 裡的行程數(含 worker 與 vitest fork,起來後 10–11 個,dry run 進行中會自然降到 6)。
量法:worker 起滿 5 個後再等 3 秒,打一個 pid,等 5 秒量。

| 訊號 → 目標 | 打之前 group | 打之後 group | worker | stryker 活 | 鎖 | npm 退出碼 |
|---|---|---|---|---|---|---|
| SIGTERM → inner | 6 | **0** | 0 | 否 | 放了 | 143 |
| SIGTERM → tsx 啟動器 | 11 | **0** | 0 | 否 | 放了 | 143 |
| SIGINT → inner | 11 | **0** | 0 | 否 | 放了 | 130 |
| SIGINT → tsx 啟動器 | 11 | **0** | 0 | 否 | 放了 | 130 |
| SIGKILL → inner | 11 | **11** | 6 | 是 | **留著,pid 已死** | 137 |
| SIGKILL → tsx 啟動器 | 11 | 11 | 6 | 是 | 留著,pid(inner)**活著** | 137 |
| (不在本輪)SIGTERM → npm 的 `sh -c` | 11 | 11 | 6 | 是 | 留著,pid 活著 | 143 |
| (不在本輪)SIGINT → npm 的 `sh -c` | 11 | 11 → Stryker 自己跑完 | 跑完 0 | 跑完歸零 | 跑完放了 | 130 |

**SIGINT 該不該跟 SIGTERM 一樣?** 量了:一樣,0。而且**必須**一樣——Stryker 現在是 detached 起的(自己一個 session/group),終端機的 Ctrl-C 只會送到前景 group(mutate.ts 那組),
**不會**直接到 Stryker 那組;改之前 Stryker 跟 mutate.ts 同 group,Ctrl-C 兩邊都直接收得到。所以 detached 之後 SIGINT 的 forward 從「多一層保險」變成「唯一的路」。
現況 `forward('SIGINT')` 跟 `forward('SIGTERM')` 是同一個函式,`installCleanup` 兩邊也對稱,實測歸零。**我把 §12b 改成 `describe.each(['SIGTERM','SIGINT'])`**,兩種都釘住,以後誰把 SIGINT 那行拿掉會紅。

**SIGKILL → inner**:cleanup 跑不到,11 個全留、鎖留著。鎖檔裡的 pid(inner)已死,下一個來拿鎖的人會判「殘鎖」而把它刪掉、直接開跑——**但那 11 個 worker 還在吃 CPU**。
這正是「鎖要能自證死活」那張要接的(鎖的 pid 活著 ≠ Stryker 活著;pid 死了 ≠ Stryker 死了)。本輪**沒**救 SIGKILL,照工單。
那張工單的文字不在 repo 裡(grep 全 repo 與 main 簽出都找不到「自證死活」),在協調者的排隊清單;請協調者確認它有把「SIGKILL inner → pid 死、group 活」這個形狀寫進去。

**SIGKILL → tsx 啟動器**(順手):inner 活著、Stryker 照跑、鎖是活的,不算孤兒,只是 npm 先回 137。同樣不在本輪。

**npm 的 `sh -c`**(不在本輪,維持現狀):我一開始 pid 抓錯、打到它,順便量到——`sh` 死了 Stryker 照跑。這跟實作輪說的一致(它的改動對這件事無影響),另一張工單。

**Stryker 正常跑完**(最容易漏的一條):量了三次。
- 形狀表裡「SIGINT → sh」那次,Stryker 照跑到底(2 分 30 秒,100%),npm 退出後:`workers=0 in_group=0 lock=no`。
- 第一次正式跑(4 分 29 秒,退出碼 0)之後 3 秒:系統上 `workers=1 stryker=1 lock=yes`——**不是我的**:那個 stryker 的 cwd 是 `env-probe`、起動時間 14:25:42(我的鎖 14:25:41 放掉,它排隊接手);我那次的 pgid(2774112)底下 **0 個**行程。
- 第二次正式跑(第四節,4 分 28 秒,退出碼 0)之後 3 秒,按歸屬量:`my stryker pid=2948206 alive=no my_group=0 workers_in_my_cwd=0 lock=no`。**沒有殘留,鎖放了。**
教訓:量「殘留」要按 cwd / pgid 歸屬,鎖是全 repo 共用的,鄰居接手會讓「系統上還有 stryker」變成假陽性。

**兩個 worktree 同時跑**(第二個 worktree:`git worktree add --detach <scratchpad>/wt2 HEAD`,`node_modules` 用 symlink 指到本 worktree 的;`strykerLockPath()` 從 wt2 算出來是同一把 `/data/python/llm_learning-cards/.stryker.lock`;跑完 `git worktree remove` 拆掉):

| 形狀 | 殺之前 | 殺第一個之後 | 殺第二個之後 |
|---|---|---|---|
| A:X 持真鎖在跑、Y 在等(Y 印「這是別的 worktree 佔的」);先殺 Y | X group 6、Y 無 stryker | **X group 6**(不變)、鎖仍是 X 的、Y 退出 143 | X group 0、鎖放了 |
| B:兩邊都在跑(Y 用注入的另一把鎖);先殺 Y | X 7、Y 11 | **X 6**、Y **0**、X 的鎖在、Y 的鎖放了 | 全 0 |
| B:兩邊都在跑;先殺 X | X 7、Y 10 | X **0**、**Y 9**、X 的鎖放了、Y 的鎖在 | 全 0 |

(7→6、10→9 是 dry run 的 vitest fork 自然結束;worker 本身 5/6 個一個沒少。)
**新增 §12c** 用兩個沙盒各 fork 3 個 sleep 釘住同一件事:殺 A → A 的 3 個死、B 的 3 個活、B 的鎖在;再殺 B → 全死。

**超集層**(本 worktree 實測,見二之 2 的輸出):
- `packages scripts apps features` 全給 → **拿鎖**(`partial=false`)
- 少給一個 → **不拿鎖**(`partial=true`)
- 多給一個**不存在**的目錄(`nope_dir`)→ **拿鎖**。理由:不存在的路徑在 `existing` 那層就被濾掉(它不可能是「小範圍」的證據),
  vitest 拿它當 filter 也對不到任何檔,聯集還是四個根 = 100%;而且這是往「多鎖一次」的安全方向錯,跟檔頭的原則一致。判定正確。
- 多給一個**存在但沒測試檔**的目錄(`docs`)→ 拿鎖,理由同上(§2b 已有測試)。

**等鎖訊息**(工單特別交代):正式跑 Stryker 時,從**同一個 worktree**再起一個 `npm run mutate`,它印的是:

```
等待 .stryker.lock(持鎖者 pid 2774067 在跑 Stryker, cwd=/home/pollux/orca/workspaces/llm_learning-cards/lock-orphan)
→ 這是你自己排的鏈(同一個 worktree),正常,繼續等。逾時 90 分鐘,已等 0 秒。
```

正確。順帶:形狀測試中途有一次鎖被 `env-probe` worktree 的全套測試佔著,訊息是「這是別的 worktree 佔的。不要刪鎖,不要 kill 那個 pid」,也正確,而且我的那次真的排隊等到它放才開跑。

## 四、嚴格級變異

```
npm run mutate -- stryker.scanner-mutatelock.json --mutate scripts/mutate.ts,scripts/run-tests.ts
```

兩次都是這條指令,`git merge main` 之後、本 worktree、`concurrency 4`(設定檔的值)。兩次都排隊等過 `env-probe` 的鎖(訊息「這是別的 worktree 佔的」),等到才跑。

**第一次(實作輪的狀態 + 我的 §12b/§12c 測試,還沒補 §2b)**:4 分 29 秒

```
File          |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
All files     |  98.25 |   98.68 |      439 |         9 |          6 |        2 |        0 |
 mutate.ts    | 100.00 |  100.00 |      320 |         9 |          0 |        0 |        0 |
 run-tests.ts |  93.70 |   95.20 |      119 |         0 |          6 |        2 |        0 |
```

**掉下來的 8 個逐一分類**(全部在 `run-tests.ts` 的新掃描碼 109–136 行):

| # | 位置 | 變異 | 分類 | 處置 |
|---|---|---|---|---|
| 1 | 109:19 `TEST_FILE = /\.test\.ts$/` | 拿掉 `$` | **真缺口**:`a.test.ts.bak`、`b.test.tsx` 會被當測試檔。既有測試只放了 `test.ts.bak`(沒有前面的點),對不到 | 補測試 `*.test.ts 要在檔名結尾` |
| 2–5 | 111:44/52/62/74 `SKIP_DIRS` 的 `'dist'` `'target'` `'coverage'` `'reports'` | 各換成 `""` | **真缺口**:只有 `node_modules` 有測試,另外四個名字沒有任何測試放測試檔進去。`reports/` 尤其要緊——Stryker 沙盒就在那底下,整個專案的複本會讓 `reports` 變成永遠涵蓋不到的假根 | 補測試,四個名字各一組斷言(頂層 + 根底下) |
| 6 | 126:12 `listDirs` 的 `catch { return []; }` | 回 `["Stryker was here"]` | **真等價**:`listDirs` 的回傳值一定再過一次 `hasTestFile` → `readdirSync`,不存在的名字在那層變 `false`,任何非空陣列結果都一樣(頂層 cwd 不存在 → roots 仍是 `[]`;遞迴那層 → 仍是 `false`) | `// Stryker disable next-line ArrayDeclaration: …` 精確理由寫在那行 |
| 7–8 | 135:11 / 136:12 `hasTestFile` 的 `catch { return false; }` | 整個 catch 拿掉 / 回 `true` | **邊界沒測到**:目錄存在但 `readdirSync` 失敗(EACCES)那條路沒人走過。拿掉 catch 會炸(`entries` 是 undefined),回 `true` 會把讀不到的目錄當成根 | 補測試:`chmod 000` 的頂層目錄裡放 `x.test.ts`,四個全給仍是 100%;root 底下跳過(chmod 擋不住 root,不能假綠) |

沒有一個用「等價變異」一句帶過;#6 是唯一的等價,理由在程式碼那行。

**第二次(補完之後)**:4 分 28 秒

```
File          |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
All files     | 100.00 |  100.00 |      446 |         9 |          0 |        0 |        0 |
 mutate.ts    | 100.00 |  100.00 |      320 |         9 |          0 |        0 |        0 |
 run-tests.ts | 100.00 |  100.00 |      126 |         0 |          0 |        0 |        0 |
Final mutation score of 100.00 is greater than or equal to break threshold 0
```

跟 allsuite-lock 那輪一樣維持 100%。`mutate.ts` 的 9 個 timeout 兩次都一樣(算 killed,不是存活)。

## 五、動了什麼

- `scripts/mutate.test.ts`
  - §12b `describe('SIGTERM 之後…')` → `describe.each(['SIGTERM','SIGINT'] as const)`,`child.kill(sig)`;兩條各自真 spawn。
  - 新增 §12c「SIGTERM 只收自己的 Stryker group,別的 worktree 的 worker 不動」:兩個沙盒、兩把鎖、各 3 個 sleep worker。
- `scripts/run-tests.test.ts` §2b 補三條(regex 錨點、四個跳過目錄、讀不到的目錄)。
- `scripts/run-tests.ts`:`listDirs` 的 `return [];` 上面加一行 `// Stryker disable next-line ArrayDeclaration: …`(真等價,理由見第四節)。程式碼本身沒動。
- `REVIEW.md`(本檔,覆寫上一輪的交接;上一輪內容在 `b5c7908`)。
- **沒動** `scripts/mutate.ts`、`prompts/`、`contracts/`。

### 新增 / 改動的測試(各自跑過綠,也各自反向驗證過紅)

| 檔案 | 條目 | 反向驗證 |
|---|---|---|
| `scripts/mutate.test.ts` §12b | `describe.each(['SIGTERM','SIGINT'])`,`child.kill(sig)` | 拿掉 detached + group kill → 兩條都紅 `孤兒 3/3` |
| `scripts/mutate.test.ts` §12b helper | 假 stryker 從 **sh 改成 node**(spawn 3 個 `sleep`,setInterval 留著) | 見下面「假 stryker 為什麼要改」 |
| `scripts/mutate.test.ts` §12c(新) | 兩個沙盒各 3 個 worker、兩把鎖;殺 A → A 死 3、B 活 3、B 鎖在;殺 B → 全死 | 拿掉 detached + group kill → 紅在 `A 死了但 A 的 worker 還在` |
| `scripts/run-tests.test.ts` §2b(新 3 條) | `a.test.ts.bak` / `b.test.tsx` 不算;`dist`/`target`/`coverage`/`reports` 頂層與根底下都不算;chmod 000 的頂層目錄不是根也不炸 | 對應變異各自從存活變 killed(第四節) |

**假 stryker 為什麼要改成 node**:SIGINT 版第一次跑是**紅**的(孤兒 3/3),但真 Stryker 實測 SIGINT 是 0。
查下來是 POSIX 的規矩:非互動 sh 用 `&` 起的子行程,**SIGINT 會被設成忽略**;群組送 SIGINT 時 3 個 `sleep` 全部不理。
那是假 stryker 的假象,不是 `spawnStryker` 的洞——真 Stryker 的 worker 是 node,預設處置就是死。
改成 node spawn `sleep`(同 group、預設處置)後 SIGTERM / SIGINT 兩版都綠,反向驗證兩版都紅。
反向驗證 A'(拿掉 detached + group kill)對新測試的輸出:

```
× 殺掉 npm run mutate(SIGTERM),stryker 底下 fork 出來的 worker 也要跟著死,一個都不能留 6293ms
× 殺掉 npm run mutate(SIGINT),stryker 底下 fork 出來的 worker 也要跟著死,一個都不能留 6749ms
× 兩個 runner 各帶 3 個 worker:殺 A → A 的 3 個死、B 的 3 個活、B 的鎖還在;再殺 B → 全死 6298ms
AssertionError: stryker 主行程死了但 worker 還活著(孤兒 3/3)
AssertionError: stryker 主行程死了但 worker 還活著(孤兒 3/3)
AssertionError: A 死了但 A 的 worker 還在
 Tests  3 failed | 4 passed | 146 skipped (153)
```

## 六、全鏈(每步退出碼)

`git merge main` 之後(`Already up to date`),依序執行,每步都是**單獨的 `npm run <script>` 呼叫**、非平行:

| 步驟 | 指令 | exit |
|---|---|---|
| 1 | `npm run boundaries` | 0 |
| 2 | `npm run typecheck` | 0 |
| 3 | `npm run lint:docs` | 0(掃 71 個 md、20 條相對連結,無壞連結) |
| 4 | `npm test` | 0(579 通過、138 略過;起手排過一次 `.stryker.lock` 隊,訊息是「這是你自己排的鏈」,等後正常跑) |
| 5 | `npm run accept:standalone` | 0 |
| 6 | `npm run standalone` | 0 |
| 7 | `npm run accept:dry` | 0(497 scenarios:150 undefined + 347 skipped;2263 steps:611 undefined + 1652 skipped;**0 ambiguous**——摘要行完全沒出現 ambiguous 字樣) |
| 8 | `npm run check:steps` | 0 |
| 9 | `npm run check:gherkin-dup` | 0 |
| 10 | `npm run accept:coverage` | 0 |
| 11 | `npm run check:gates`(`TEMPLATE_DIR` 指向本輪指定的 agent worktree) | 0 |
| 12 | `npm run check:all` | 0(14 個 gate 全 PASS,含 boundaries / doc-links / next-gates / phase-status 等) |

跑完 `git status --short` 是乾淨的,沒有殘留探針目錄或補丁檔。

## 七、留給下一張

- **SIGKILL inner → pid 死、group 活、鎖被下一個人當殘鎖刪掉**:歸「鎖要能自證死活」。建議那張的驗收形狀直接用本文第三節那行(`kill -KILL <inner>` 後 5 秒 group 仍 11、鎖 pid 已死)。
- **npm 的 `sh -c` 吃 signal**:維持現狀,已另開。本輪只是順手量到它的數字(上表兩行)。
