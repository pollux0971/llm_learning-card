# allsuite-lock 另一半:spawnStryker 的孤兒 worker + 超集漏(測試輪)

分支 `pollux0971/lock-orphan`,基於 main `a68a1b0`(merge 時已是最新)。
這輪是**測試輪**:紅測試已 commit(`c21534e`),**實作沒 commit**。
但工單要「改之前 / 改之後」的實際數字,所以我把對稱的改法當**暫存補丁**套上量了、量完就 `git checkout` 還原;
補丁全文在本文最後一節,實作輪可以照抄,也可以自己寫再拿 §12b / §2b 的測試對。

## 一、結果一句話

| | 改之前 | 改之後(暫存補丁) |
|---|---|---|
| 真跑 `npm run mutate`,SIGTERM 只打主行程,5 秒後剩的 Stryker worker | **1 個**(5 個起來、剩 1) | **0 個** |
| 單元測試 §12b(假 stryker fork 3 個 worker) | 紅,孤兒 **3/3** | 綠 |
| 單元測試 §2b(四個測試根全給要拿鎖,共 11 條) | 紅 11 條 | 綠 |

反向驗證都做了(把補丁拿掉 → 紅回來),見 §四。

## 二、甲:spawnStryker 的孤兒 worker

### 實測步驟(別人能照著重跑)

腳本在我的 scratchpad,這裡把它的做法寫死,不依賴那個檔:

1. 基線要是 0:`pgrep -af "$(pwd -P)" | grep -E "stryker|vitest|child-process-proxy"` 必須空的。
   **不是 0 就先清,不然量到的是上一輪的殘骸**(我第一次就踩到,見 §五)。
2. 起一個真的:`npm run mutate -- stryker.scanner-mutatelock.json > /tmp/m.log 2>&1 &`
   (這個設定只變異 `scripts/mutate.ts`,concurrency 4,worker 3–11 秒就起來,不用等它跑完)。
3. 找要打的 pid,兩種都量:
   - 跑 `mutate.ts` 的那個 node(我們的 signal handler 在這裡):`pgrep -f "tsx/dist/loader.*scripts/mutate.ts"`
   - tsx 啟動器:`pgrep -f "^node $(pwd -P)/node_modules/.bin/tsx scripts/mutate.ts"`
   - ⚠️ **不要**用 `pgrep -f "tsx scripts/mutate.ts" | head -1`:第一個撈到的是 npm 的 `sh -c` 包裝,打它是另一件事(§五)。
4. 等 worker 真的起來:`pgrep -af "$(pwd -P)" | grep -c child-process-proxy-worker` ≥ 4。
5. `kill -TERM <pid>`(只打這一個)。
6. `sleep 5` 之後再數一次第 4 步的指令。要 **0**。
7. 收尾:先殺主行程再殺 worker(順序反了 Stryker 會把 worker 再生出來),再確認鎖檔
   `/data/python/llm_learning-cards/.stryker.lock` 不在。

### 數字

改之前(main 的 `spawnStryker`,`child.kill(sig)` 只打 Stryker 主行程):

```
== before start: 0 個相關行程
target=inner pid = 2276676: node --require .../tsx/dist/preflight.cjs --import .../tsx/dist/loader.m... scripts/mutate.ts
== workers up (等了 6 秒): child-process-proxy-worker=5,全部相關行程 7
== kill -TERM 2276676 (只打這一個 pid)
== 5 秒後剩:1 個(其中 child-process-proxy-worker 1 個)
2278561 node .../@stryker-mutator/core/dist/src/child-proxy/child-process-proxy-worker.js
npm exit=143
```

```
target=launcher pid = 2282952: node .../node_modules/.bin/tsx scripts/mutate.ts -- stryker.scanner-mutatelock.json
== workers up (等了 11 秒): child-process-proxy-worker=4,全部相關行程 6
== kill -TERM 2282952 (只打這一個 pid)
== 5 秒後剩:1 個(其中 child-process-proxy-worker 1 個)
```

改之後(暫存補丁:`detached: true` + `process.kill(-child.pid, sig)`,跟 `spawnVitest` 同形):

```
target=inner pid = 2343323
== workers up (等了 3 秒): child-process-proxy-worker=5,全部相關行程 7
== kill -TERM 2343323 (只打這一個 pid)
== 5 秒後剩:0 個(其中 child-process-proxy-worker 0 個)
```

```
target=launcher pid = 2344452
== workers up (等了 3 秒): child-process-proxy-worker=5,全部相關行程 7
== kill -TERM 2344452 (只打這一個 pid)
== 5 秒後剩:0 個(其中 child-process-proxy-worker 0 個)
```

兩種目標、改前都剩 1、改後都 0。鎖檔兩邊都沒留。

**為什麼是「剩 1」不是「剩 5」**:Stryker 主行程自己有 SIGTERM handler,會把 worker pool dispose 掉,
所以大部分 worker 跟著死;剩的那 1 個是 dispose 當下還在起 / 還在跑 dry run 的那個。
所以 Stryker 比 vitest「好一點」,但不是 0。0 才是要的數字:一個 worker 也是一個 vitest 在跑整套。

### 單元測試 §12b(`scripts/mutate.test.ts`)

跟 §12 同一個沙盒做法(複製 `mutate.ts` + 假的 `node_modules/.bin/stryker`,走真的 `spawnStryker`),
差別是假 stryker 是一支 sh:起 3 個背景 `sleep 300` 當 worker、把 pid 寫檔、`wait`。
sh 吃 SIGTERM 會死但不替背景子行程收屍——跟真 Stryker 留孤兒同形。斷言:3 個 worker 全死、stryker 死、鎖不在。

兩個坑,都修了、都寫在測試的註解裡:

1. **`close` 事件永遠不來**:孤兒 worker 握著繼承來的 stdout/stderr 管線,`close` 要等管線全關。
   第一版紅在 60 秒逾時而不是紅在「孤兒還活著」。改等 `exit`,worker 的輸出也導到 /dev/null。
2. **`workers.some(pidIsAlive)` 是假的**:`some` / `filter` 把索引當第二個參數塞進去,那是 `pidIsAlive`
   可注入的 `kill`;索引 0 → `kill = 0` → TypeError → 非 ESRCH 一律當「活著」。
   結果補丁套上了測試還是紅 3/3,`ps` 卻說行程不在。改成 `(w) => pidIsAlive(w)`。
   這個形狀在 repo 別處有沒有?我 grep 了 `\.(some|filter|every|map)\(pidIsAlive\)`,只有我這條。

### 跟 spawnVitest 有沒有實質差異

**沒有,可以照抄。** 唯一的差別是 Stryker 主行程自己會收大部分 worker(所以改前剩 1 不是剩 5),
這對 group kill 沒影響:group 裡多送一次 SIGTERM 給一個已經在收拾的行程是無害的。
`stdio: 'inherit'` + `detached: true` 在 TTY 下的 SIGTTIN 疑慮,審核輪在 vitest 那邊已用 `script -qec` 驗過沒事,
Stryker 這邊 `npm run mutate` 我是從非 TTY 起的;實作輪若想再從真 TTY 跑一次 `npm run mutate` 看有沒有停在背景,那是唯一我沒量的。

## 三、乙:超集漏

### 規則(照顧問裁定)

小範圍判定(§2)之後**再加一層**:給定路徑解析後的**聯集**涵蓋了所有「含 `*.test.ts` 的頂層目錄」→ 仍算全套。
測試根**掃 cwd 的頂層目錄**算,不從 vitest config 推。錯的方向仍是多鎖。

### §2b 釘住的邊界(`scripts/run-tests.test.ts`,13 條 + runTests 層 2 條)

| 情境 | 判定 | 為什麼要釘 |
|---|---|---|
| `packages scripts apps features` 四個全給 | **全套** | 核心 |
| 順序 / 結尾斜線 / 絕對路徑 / 混著寫 | 全套 | 看聯集不看字面 |
| `scripts scripts scripts scripts` | 小範圍 | 「給了 ≥ 4 個」不是規則 |
| 三個 | 小範圍 | 少一個根就不是 100% |
| 四個 + 旗標 | 全套 | §2 同一條 |
| `docs`(沒測試檔)給不給 | 不影響 | 不是根 |
| 頂層**檔案** `vitest.config.ts` | 不是根 | 只看目錄 |
| `scripts/mutate.test.ts` + 其他三個根 | 小範圍 | 根底下的檔案 / 子目錄不算涵蓋那個根 |
| 新增 `tools/deep/er/cli.test.ts` | 四個變小範圍、五個才全套 | **掃出來的不是寫死的** |
| 刪掉 features 的測試檔 | 三個就全套 | 同上,反方向 |
| `.spec.ts` / `.test.js` / `test.ts` / `test.ts.bak` | 不算 | 只認 `*.test.ts` |
| `node_modules/…/x.test.ts`、`.stryker-tmp/sandbox-*/…`、`.git/…` | 不掃 | **規則的命門**:它們若算根,四個永遠「還差一個」,規則形同虛設(現況 node_modules 裡有 190 個 `*.test.ts`) |
| `packages/core/node_modules/dep/a.test.ts` | 不讓 packages 變根 | 根底下也不掃 node_modules |
| cwd 沒有任何根、或 cwd 不存在 | 這層不介入 | 對空集合「涵蓋全部」是空泛的真;而且 §2 的 `cwd=/nowhere` 那條要繼續綠 |
| `.` 或 `..` 混在四個裡 | 全套 | §2 那半句蓋過一切 |
| **真的 repo**:四個全給 / 三個 | 全套 / 小範圍 | 釘「現況就是這四個」;多了少了一個根會紅,那時來改 `ROOTS` |
| runTests:`npm test -- packages scripts apps features`,鎖被別人握 | `acquire` 被叫 1 次、參數原樣給 vitest | isPartialRun 對了還要 runTests 真的去拿 |
| runTests:三個根,鎖被別人握 | 立刻跑、別人的鎖一個位元組不動 | 這層不能把小範圍做過頭 |

§2 既有的 `cwdWithFiles()` 加了第二個測試根(`packages/core/core.test.ts`):
只有一個根的話 `scripts/` 就是 100%,「給了存在的目錄 → 小範圍」那幾條會變成在測超集而不是在測「目錄算小範圍」。
加了之後那幾條改前改後都綠,測的還是原本的事。

### 給實作輪的三個提醒

- 掃描要跳過 `node_modules`、點開頭目錄,**以及 `target`**(`apps/desktop/src-tauri/target` 是 Rust 建置產物,
  不跳過的話 `apps` 這個根每次 `npm test` 都可能先走進去幾萬個檔才碰到第一個 `*.test.ts`)。
  暫存補丁用的是 §13 那組 `SKIP_DIRS`(node_modules / dist / target / coverage / reports)。測試只釘了 node_modules 與點開頭;
  target 那條我**沒有**釘成測試——那是效能不是正確性,釘了會變成在測實作細節。你要釘也行。
- `hasTestFile` 找到第一個就回,不要把整棵樹列完。
- `run-tests.ts` 檔頭那段「哪條線算小範圍」要補一句超集,§2b 的註解可以抄。

## 四、反向驗證

| 拿掉什麼 | 看到什麼 |
|---|---|
| 補丁 A(`spawnStryker` 的 detached + group kill)`git checkout scripts/mutate.ts` | §12b 紅:`孤兒 3/3: expected [ 2358694, 2358695, 2358696 ] to deeply equal []` |
| 補丁 B(超集那層)`git checkout scripts/run-tests.ts` | §2b 11 條紅(四個全給那條在內),其餘 66 條綠 |
| 兩個補丁都套上 | `scripts/run-tests.test.ts` 77/77、`scripts/mutate.test.ts` 151/151 |

真跑那邊的反向就是 §二的「改之前」:同一支腳本、同一個設定、改前剩 1、改後 0。

## 五、順手撈到、不在工單裡

1. **打 npm 的 `sh -c` 包裝(不是 tsx)→ 整棵樹全活**。第一次量我 `pgrep -f "tsx scripts/mutate.ts" | head -1`
   撈到的是 npm 起的 `sh -c tsx scripts/mutate.ts -- …`。SIGTERM 它:sh 死、npm 回 143,但 tsx、mutate.ts、Stryker、
   5 個 worker **一個都沒死**,鎖也還在(持鎖者 mutate.ts 還活著,所以不算殘鎖)。這不是 mutate.ts 能修的:
   signal 根本沒送到我們手上。任何 supervisor 用 `kill <npm 的 sh pid>` 收 `npm run mutate` 都會這樣。
   要不要處理(例如文件寫「殺 npm run 起的東西請殺整個 group」)交顧問判;我沒動。
2. 承上,我用 `kill -9` 清那棵樹時順序錯了(先殺 worker),Stryker 主行程立刻把 worker 再生出來,
   兩輪量到的都是它的殘骸——所以量測腳本現在**基線不是 0 就拒跑**,收尾**先殺主行程**。
3. 用 `kill -9` 清完之後 `/data/python/llm_learning-cards/.stryker.lock` 留著(pid 已死,是殘鎖),我刪了。
   下一個 acquireLock 本來也會判殘鎖清掉,只是不想留給別人。
4. worktree 沒有 `learning/state/log.jsonl`,所以工單那句「`llm-spend --today` 要回 0 或 1」在乾淨的 worktree
   **一定回 2**(訊息是「讀不到 log 檔」,不是環境變數)。環境變數有設對:`scripts/run-tests.test.ts`、`scripts/mutate.test.ts`
   新增的以外全綠、全套 2777 綠沒有那 12 條假紅。工單那條驗證可以改成看訊息不是看 exit code。

## 六、跑過什麼(本輪最終狀態:紅測試已 commit、補丁未套)

| 指令 | 結果 |
|---|---|
| `npm test`(全套,拿鎖,1m55s,load 0.3 起跑) | **12 紅 / 2777 綠 / 138 skipped**;12 紅**全部**是本輪的 §12b(1)+ §2b(11),沒有別的紅(沒有 llm-spend 那 12 條假紅) |
| `npm test -- scripts/run-tests.test.ts scripts/mutate.test.ts`,補丁 A+B 套上 | 77/77、151/151 綠 |
| `npm run check:gates` | 守門內容自同步以來未被更動 ✓ |
| `npm run boundaries` | PASS scanned=211 |
| `npm run lint:docs` | PASS,71 個 md、20 條連結 |
| 跑完 `pgrep -f '^sleep 300'` | 0(§12b 紅的時候會留 3 個 sleep,finally 自己收) |
| 跑完 `/data/python/llm_learning-cards/.stryker.lock` | 不在 |

環境:`LLM_DAILY_CAP_USD=1 LLM_PRICE_IN_PER_M=2.5 LLM_PRICE_OUT_PER_M=10`、`TEMPLATE_DIR` 指主簽出的 template。

## 七、暫存補丁(未 commit;實作輪可照抄)

補丁 A `scripts/mutate.ts`(`spawnStryker`,跟 `spawnVitest` 同形):

```diff
@@ function spawnStryker(args: string[]): Promise<number> {
-    const child = spawn(bin, args, { stdio: 'inherit' });
+    // Stryker 起在**自己的 process group**(`detached: true`),signal 轉給整個 group 而不是只給
+    // Stryker 主行程——跟 scripts/run-tests.ts 的 spawnVitest 同一個形狀。實測(2026-09-05):
+    // 只 SIGTERM 主行程,Stryker 自己會收大部分 worker,但 5 個 child-process-proxy-worker 會剩 1 個
+    // 孤兒繼續跑;打整個 group 才歸零。
+    const child = spawn(bin, args, { stdio: 'inherit', detached: true });
@@
-    const forward = (sig: 'SIGINT' | 'SIGTERM') => () => void child.kill(sig);
+    const forward = (sig: 'SIGINT' | 'SIGTERM') => () => {
+      // 負的 pid = 整個 process group。group 已經沒了(ESRCH)就當作已經死透,不能丟。
+      try {
+        if (child.pid !== undefined) process.kill(-child.pid, sig);
+      } catch {
+        void child.kill(sig);
+      }
+    };
```

補丁 B `scripts/run-tests.ts`(`isPartialRun` 尾端 + 掃描):

```diff
-import { existsSync } from 'node:fs';
+import { existsSync, readdirSync } from 'node:fs';
@@ export function isPartialRun(
   if (existing.some((target) => isSameOrAncestor(target, here))) return false;
-  return existing.length > 0;
+  if (existing.length === 0) return false;
+  // 超集(§2b):給的路徑聯集涵蓋了所有含 *.test.ts 的頂層目錄 → 那是 100%,只是換了個寫法。
+  // 沒有任何測試根(cwd 不存在、或這裡根本沒測試)→ 這層不介入,上面的規則照舊。
+  const roots = testRoots(here);
+  if (roots.length > 0 && roots.every((root) => existing.includes(root))) return false;
+  return true;
 }
+
+const TEST_FILE = /\.test\.ts$/;
+/** 不掃的目錄:相依、建置產物、Stryker 沙盒(整個專案的複本)。點開頭的一律不掃。 */
+const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', 'coverage', 'reports']);
+
+/** cwd 底下「含 *.test.ts 的頂層目錄」,解析成絕對路徑。掃出來的,不從 vitest config 推。 */
+export function testRoots(cwd: string): string[] {
+  return listDirs(cwd)
+    .filter((name) => hasTestFile(join(cwd, name)))
+    .map((name) => resolve(cwd, name));
+}
+
+function listDirs(dir: string): string[] {
+  try {
+    return readdirSync(dir, { withFileTypes: true })
+      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
+      .map((e) => e.name);
+  } catch {
+    return [];
+  }
+}
+
+function hasTestFile(dir: string): boolean {
+  let entries;
+  try {
+    entries = readdirSync(dir, { withFileTypes: true });
+  } catch {
+    return false;
+  }
+  if (entries.some((e) => e.isFile() && TEST_FILE.test(e.name))) return true;
+  return listDirs(dir).some((name) => hasTestFile(join(dir, name)));
+}
```
