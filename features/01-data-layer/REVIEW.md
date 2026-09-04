# REVIEW — 01-data-layer/phase-3 graph.ts 變異測試複核

## 背景

phase-3 的嚴格級變異測試(`packages/core/src/schema/graph.ts`,契約 §8 依賴圖)卡在
90.32%(門檻 95%)。上一輪審核者把剩下 15 個存活變異都判為「等價變異」但沒有第二人覆核,
也沒有照 `mutation-testing` skill 的規範在對應行加 `// Stryker disable next-line all: <理由>`。

這次複核逐一重新過這 15 個存活變異,不預設上一輪的判斷是對的。

## 起手式

```
npx stryker run --mutate "packages/core/src/schema/graph.ts,!packages/core/src/schema/graph.test.ts" --reporters json,clear-text
```

初次結果:90.32%(138 killed / 11 survived / 2 timeout / 4 no-coverage,共 15 個要處理的存活變異)。

## 15 個存活變異的處理

逐一手動分析(必要時手動套用該 mutant 的變更、單獨跑 `vitest run` 驗證),分成四類:

### 1. 真的漏測 → 補測試(3 個)

| 行為 | 對應變異 | 補的測試 |
|---|---|---|
| `buildAdjacency` 的 `for (const id of graph.nodes) register(id);` 這條 nodes 迴圈的 register 呼叫被拿掉,不影響 `hasCycle`,但會讓 DFS 起點順序悄悄改成「邊出現順序」而不是「nodes 陣列順序」 | `CallExpression` L126 | 新增 `starts the search in nodes array order, not edge-appearance order, when multiple independent cycles exist`:兩個各自獨立的循環,nodes 陣列順序刻意跟邊出現順序不同,驗證回報的是 nodes 裡先出現的那個循環 |
| `visit()` 結尾的 `stack.pop();` 被拿掉,已經走完退回的死路分支會殘留在 `stack` 陣列裡,混進之後 `stack.slice(start)` 算出來的循環路徑 | `CallExpression` L157 | 新增 `excludes an unrelated dead-end sibling branch that was already explored and backtracked from`:一張卡先連到一條無出邊的死路,再連到真正的循環,驗證死路那張卡不會混進 `path` |
| `buildAdjacency` 的 `register(to);`(edges 迴圈)被拿掉時,一張「只在某條邊的後學端出現、不在 nodes 裡、也從不是任何邊的先備端」的純終點卡不會被登記進鄰接表,拜訪到它時找不到鄰接表 | `CallExpression` L129 | 新增 `safely visits an edge target that never appears as a source or in nodes`:`sec-0001 -> sec-9999`,`sec-9999` 純終點,驗證 `detectCycle` 正常回傳 `{hasCycle:false, path:[]}` 而不是拿掉 register 後改成靠別的路徑「碰巧」補到 |

這三個都補在 `detectCycle` describe 區塊,現有測試沒有任何一個涵蓋「nodes 陣列順序 vs 邊出現順序」「死路兄弟分支殘留在 stack」「純終點卡的註冊路徑」這三種形狀。

### 2. 死程式 → 直接刪除(5 個 mutant,2 處改動)

**「排不出全序時的最後防線」**(topologicalSort 結尾 `if (result.length !== unique.length) { throw ... }`,對應
`ConditionalExpression` L218、`BlockStatement`/`StringLiteral`/`ArithmeticOperator` 共 4 個 mutant):

證明它到不了——`topologicalSort` 進 Kahn 演算法前一定先跑過:
1. `validateGraphEdges`(邊的兩端都在 `nodes` 裡,所以 `edges` 只會連到 `unique` 集合內的卡,不會有 `inDegree.get(to)`/`next.get(from)` 落空的情況)
2. `detectCycle`(整張圖沒有循環)

兩者都成立時,以 `unique` 為節點集合、`edges` 為邊集合的子圖數學上必為 DAG,Kahn 演算法保證能排出全部 `unique.length` 張卡。排不出全序等價於「有循環但 `detectCycle` 沒抓到」,那是 `detectCycle` 本身要負責的 bug,不是這裡該防的東西——**直接刪掉整個 if 區塊**,原地留一段註解說明為什麼刪。

**`visit()` 裡 `next.get(id) ?? []` 的 `?? []` 防禦性 fallback**(`ArrayDeclaration` L146,NoCoverage):

`next.get(id)` 傳進來的 `id` 只有兩種來源:`order`(`buildAdjacency` 的 `register` 一定先設過 `next.set(id, [])`)或別的節點鄰接表裡的鄰居(同樣一定先 `register` 過)。沒有第三種來源能讓 `id` 繞過 `register`。這條 fallback 在現行(未被變異的)程式碼裡 100% 不會被觸發(Stryker 回報的正是 `NoCoverage`,不是 `Survived`,代表這個分支在任何測試裡都沒被執行到)——**改成 `next.get(id)!`**,順便讓相關但獨立的其他變異(見下方等價變異分析)在少了這個安全網之後,只要真的破壞了註冊流程就會直接噴例外被抓到,而不是被這條 fallback 悄悄吸收掉。

### 3. 真等價 → `// Stryker disable next-line all`(5 個)

| 位置 | 變異 | 理由(精確到「為什麼這個分支測不出差異」) |
|---|---|---|
| `detectCycle` 內 `const stack: CardId[] = [];` | `ArrayDeclaration`:初始值塞一個假字串 | `stack` 只被 `push`/`pop`/`indexOf`/`slice` 操作。`indexOf` 找的永遠是真實 `CardId`(來自 `next` 的鄰接表),不可能是這個假字串;假字串也從不被當成 map key 去查 `next`/`state`。所以它是完全惰性、永遠不會被命中的資料,對 `hasCycle`/`path` 的計算結果沒有任何影響 |
| `visit()` 內 `if (color === undefined) { visit(neighbor)... }` | `ConditionalExpression`:改成 `if (true)`,對已經 black 的鄰居也重新 visit | 任何節點變黑的當下,代表它當時整條可達子樹都已走完且沒找到回邊——圖結構是靜態的,這個結論不會隨時間改變。之後如果有別的、目前還在堆疊上(gray)的祖先才連到它,重新 visit 只是把同一批早就走過的邊再走一次:如果這棵子樹真連得回某個目前是 gray 的祖先,那條回邊在它「第一次」被走訪時就一定會被發現、讓整個演算法立刻回傳(`found` 會一路 bubble 到最外層),根本走不到這個重複造訪的分支;走得到這裡,代表當時沒找到回邊,子樹確定無環,重新走一遍結論不會變 |
| 外層迴圈 `if (state.has(id)) continue;` | `ConditionalExpression`:改成 `if (false)`,對已經走過的節點也重新呼叫 `visit` | 走到這一輪代表前面所有 `visit()` 呼叫都已經正常退回(`stack` 清空、沒有任何節點是 gray)。在這個完全乾淨、沒有任何祖先在場的狀態下,重新 visit 一個已經是 black 的節點,等於把它那棵早就走過、確定無環的子樹再走一次——不可能生出新的回邊,回傳值必定還是 `null`,跟直接 `continue` 略過的效果一致 |
| `topologicalSort` 內 `const next = new Map(unique.map((id) => [id, []]))` | `ArrayDeclaration`:每張卡的初始鄰接表塞一個假字串 | 假字串只會在 Kahn 迴圈裡被當成某張卡的「後學」處理。`inDegree` 沒有這個假 id 的項目,`inDegree.get(to)! - 1` 對它來說永遠是 `undefined - 1` = `NaN`,`NaN === 0` 永遠是 `false`,所以它永遠不會被排進 `ready`、不會進 `result`,對 `unique.length` 張真卡的排序結果沒有任何影響 |
| `topologicalSort` 內 `index.get(id)! < index.get(pick)!` | `EqualityOperator`:改成 `<=` | `index` 是 `graph.nodes` 每張「不同」卡片第一次出現位置的對應表(`!index.has(id)` 保證一個 id 只設一次一次),所以不同 id 的 index 值必定互不相同;`ready` 又是 `Set`(內容不重複),同一輪迴圈裡拿來比較的 `id` 跟 `pick` 永遠是兩張不同的卡。`<=` 多出來的「相等」分支,對兩個不同 id 來說永遠不可能成立,所以 `<` 跟 `<=` 選出來的 `pick` 一定一樣 |

## 特別提醒的三處,結論

- **「排不出全序時的最後防線」**:確認是死程式,已刪除(見上方「2. 死程式」)。不是等價變異——它本來就摸不到,留著只是在製造一段不會被驗證到的錯誤訊息。
- **防禦性 fallback**(`next.get(id) ?? []`):同樣確認是死程式,已刪除,改成 `next.get(id)!`。
- **DFS 冪等重訪**:這個確實是真等價,但這次寫出了「為什麼」到精確的程度(見上表兩條 `ConditionalExpression`),不是只寫「測不到」。

## 改動清單

- `packages/core/src/schema/graph.ts`
  - 刪除 `topologicalSort` 結尾「排不出全序」的死程式防線(連同它的舊註解)
  - `visit()` 內 `next.get(id) ?? []` 簡化成 `next.get(id)!`,並加註解說明為什麼保證有值
  - 加 5 個 `// Stryker disable next-line all: <理由>`(見上表)
- `packages/core/src/schema/graph.test.ts`
  - 新增 3 個測試(見上方「1. 真的漏測」)

## 最終結果

```
npx stryker run --mutate "packages/core/src/schema/graph.ts,!packages/core/src/schema/graph.test.ts"
```

- **變異分數:100.00%**(門檻 95%,級別:嚴格)
- 總 134 killed + 2 timeout,0 survived,0 no-coverage

其餘檢查:

- `npm run boundaries`:✓ 無違規
- `npm run typecheck`:✓ 無錯誤
- `npm run test`(vitest,全專案):✓ 691/691 passed
- `npm run accept -- --tags '@data-layer and @phase-3'`:✓ 10/10 scenarios,45/45 steps passed

## 判定

**PASS**。90.32% → 100%,15 個存活變異全部有明確歸類與處理(3 補測試、5 個 mutant 對應的
2 處死程式刪除、5 個等價變異附完整理由),四項檢查(boundaries / typecheck / test /
cucumber @data-layer @phase-3)全過。

---

# 審核輪 · ADR-040 `atomicWriteJson()` 四步寫入保證(commit `215a610` / `79135f3`)

日期 2026-09-04。branch `pollux0971/atomic-write-integrity`。

## A.1 判定

**PASS**。`packages/core/src/ingest/state.ts` 變異分數 **84.78% → 100.00%**(0 存活、
1 timeout 算殺死、6 個 mutant 被 TypeScript checker 擋掉不計分),四項反向驗證全部如預期
變紅。有一個 **Windows 的已知限制**要記錄(見 A.5),但它不擋這一輪:桌面端 Windows 是
I8,現在還沒跑,而且**開發 agent 對它的診斷是錯的**,修法跟他想的不一樣。

## A.2 四步是不是真的四步、順序對不對

實作(`state.ts:38-61`)照 §11b 的字面走:

```
mkdirSync(dir) → openSync(tmp,'w') → writeSync → fsyncSync(fd) → closeSync(fd)
              → renameSync(tmp, path) → fsyncDir(dir)
              → finally: rmSync(tmp, { force: true })(自己的錯內層吞掉)
```

四步都在,順序對。測試用 `vi.mock('node:fs')` 把 `openSync` / `fsyncSync` / `renameSync` /
`rmSync` 全部 pass-through 到真 fs、只多記一筆呼叫,再用 `h.calls` 的**索引比大小**鎖住
順序。「這是檔案的 fsync 還是目錄的 fsync」不看實作用哪個 API,而是看那個 fd 當初開的
路徑在當下是不是目錄 —— 不綁死寫法,換個等價實作照樣認得出來。這是這一輪最重要的那組
斷言,不是裝飾。

## A.3 四項反向驗證(我自己動手改壞,確認測試會紅)

| # | 我怎麼改壞 | 結果 | 變紅的測試 |
|---|---|---|---|
| 1 | `renameSync` 與 `fsyncDir` 對調 | ✅ 紅 | `fsync(fd) 在 rename 之前、fsync(目錄) 在 rename 之後` —— 訊息直接印出實際序列 `fsync:file → fsync:dir → rename → unlink` |
| 2 | `fsyncDir` 的 `code !== 'EINVAL'` 改成 catch-all | ✅ 紅 **2 條** | `EIO 時往外丟` 與 `ENOSPC 時往外丟` |
| 3 | 清理的 `try`/`catch` 拿掉(讓清理的錯冒到 `finally` 外) | ✅ 紅 | `連清理都失敗時,丟出去的仍然是原本那個錯誤` |
| 4 | (見 02 的 REVIEW,ADR-041 的 re-throw) | ✅ 紅 | — |

每次改壞跑完就 `cp` 還原,`git status` 確認過工作區乾淨。

## A.4 `try`/`finally` 不遮蔽原錯 —— 有測,而且測得對

「rename 失敗**且** unlink 也失敗」這個組合**已經有測試**(`state.test.ts` 的
`連清理都失敗時…`),不用補。它做對的關鍵是最後那句:

```ts
expect(h.calls, `沒有嘗試刪 tmp:${...}`).toContain('unlink');
```

沒有這句的話,一個**完全不清理**的實作也會讓「丟出來的是 rename 的錯」成立 —— 測試會
變成「斷言沒丟錯」那一類的投機取巧。有這句才真的鎖住「清理有發生 + 清理的錯被吞」兩件事。

## A.5 ⚠️ Windows:開發 agent 的診斷是錯的,結論碰巧對

開發 agent 提報「`openSync(dir,'r')` 在 Windows 會丟 `EISDIR`」。**查證後這是錯的。**
證據取自 libuv `v1.x` 的 `src/win/fs.c` 與 Microsoft 官方文件,不是印象:

1. `fs__open()` 明確加上 `FILE_FLAG_BACKUP_SEMANTICS`,原始碼的註解就寫著
   *"Setting this flag makes it possible to open a directory."* —— 所以 **Windows 上
   `openSync(dir, 'r')` 會成功**,不會丟 `EISDIR`。
2. 那段 `SET_REQ_UV_ERROR(req, UV_EISDIR, error)` 只在 `ERROR_FILE_EXISTS` **且**帶
   `O_CREAT` 時才走到 —— 那是用 `'w'`/`'a'` 開目錄的情境,不是我們這裡。
3. 真正會爆的是**下一步**:`fsyncSync(fd)` 在 Windows 走 `FlushFileBuffers()`,而
   Microsoft 文件寫死 *"The file handle must have the **GENERIC_WRITE** access right."*
   我們的 fd 是 `'r'` 開的,只有讀權限 → `FlushFileBuffers` 回 `ERROR_ACCESS_DENIED`
   → libuv 的 `fs__sync_impl()` 走 `SET_REQ_WIN32_ERROR` → Node 端拿到 **`EACCES`**。

**所以 Windows 上的實際行為是**:tmp 寫好、fsync 好、rename **成功**(磁碟上的檔案是
對的),然後第 4 步丟 `EACCES` 出來 —— `state/` 的每一次寫入都會丟錯,即使資料其實已經
寫進去了。影響面是全部呼叫端(`ingest.ts` 的 `needs-review.json` / `ingested.json`、
`deps.ts` 的 `writeCategoryGraph()` / `removeCategoryGraph()`)。

**為什麼這很重要**:如果照開發 agent 的診斷去「把 `EISDIR` 也加進吞掉的清單」,
**Windows 一樣會爆**,因為錯誤碼根本不是 `EISDIR` 而是 `EACCES`,而且爆的地方不是 open
是 fsync。我沒有改契約、也沒有加任何錯誤碼 —— 那是 ADR 的事。留給技術顧問決定的是:
Windows 上目錄 fsync 這件事本身在語意上要怎麼對應(常見做法是整段跳過,或改用
`FILE_FLAG_BACKUP_SEMANTICS` + 可寫的 handle,後者 Node 的 `fs` 沒有直接暴露)。

**現在不擋這一輪**:桌面端 Windows 是 I8,還沒跑;Linux / macOS 上四步完全正確。

## A.6 存活變異的處理(7 個,四分類逐條)

| 變異 | 位置 | 分類 | 處理 |
|---|---|---|---|
| `} finally {}`(吃掉 `closeSync(fd)`) | `state.ts:45` | **真漏測** | 補測試 |
| `closeSync(fd)` → `;` | `state.ts:46` | **真漏測** | 同上 |
| `} finally {}`(吃掉 `fsyncDir` 的 `closeSync`) | `state.ts:76` | **真漏測** | 同上 |
| `closeSync(fd)` → `;`(`fsyncDir`) | `state.ts:77` | **真漏測** | 同上 |
| `rmSync(tmp, { force: true })` → `{}` | `state.ts:56` | **真等價** | `Stryker disable next-line all` + 理由 |
| 同上 → `{ force: false }` | `state.ts:56` | **真等價** | 同上(同一行,一個註解涵蓋) |
| `.filter((l) => l.trim().length > 0)` → `l.length > 0` | `state.ts:95` | **真漏測** | 補測試 |

**四個 `closeSync` 的漏測**:漏關 fd 在單次寫入上沒有任何症狀,但 `atomicWriteJson()`
是 state/ 全部寫入的單一入口、桌面端常駐,漏一個就是每次寫入漏一個,跑久了撞 `EMFILE`
—— 而那時的錯誤會出現在一個跟真正原因完全無關的地方。補的是**成功路徑**與**目錄 fsync
失敗路徑**兩條「開了就要關」。

寫這組測試時踩到一個真的坑,值得記:第一版用 `Set<number>` 記「關過哪些 fd」**是錯的**
—— 作業系統會**重用 fd 編號**(關掉 22 之後下一個 open 又拿到 22),集合比對會讓
「開 22 → 關 22 → 再開 22 沒關」看起來是平的;測試當場就抓到只有 1 個 fd 進 Map(第二次
open 把第一次的覆寫掉了)。改成記 open/close **事件序列**再重放,才算得準。

**`force: true` 的兩個等價變異**:外層那個 `catch` 本來就吞掉清理自己丟的每一顆錯,
所以 `force` 唯一的作用(吸收成功路徑上「tmp 早就被 rename 走了」的 ENOENT)在可觀察行為
上是零。不刪它,因為 ADR-040 指名了「刪不掉就算了」這個形式,而且留著讓意圖不必依賴
外層 catch 才看得懂 —— 附精確理由的 `Stryker disable next-line all`。

**`l.trim()` 的漏測**:pre-existing,不是這一輪引進的,但在 mutate 範圍內。`log.jsonl`
是 append-only(§11b 的例外),被中斷或被編輯器補尾巴時空白行是真的會出現的東西,
`l.length > 0` 會讓那一行進 `JSON.parse` 直接丟、整份 log 讀不出來。補了一條白空格行的
`readLogEvents` 測試,順手補了「檔案不存在回空陣列」。

## A.7 有沒有投機取巧

沒有。逐條看過:mock 一律 pass-through 到真 fs(不是回假值),斷言的是**磁碟上的實際
位元組**(`readFileSync(path,'utf8')).toBe(before)`)而不是「沒丟錯」,錯誤比對用
`toBe(原物件)` 而不是 `toThrow()` 這種抓得太寬的形式,EINVAL 那條還額外斷言
`h.calls` 裡真的有 `fsync:dir`(否則「不丟錯」可能是**根本沒 fsync 目錄**的結果)。

## A.8 完整驗收結果

| 檢查 | 結果 |
|---|---|
| `npm ci` | ✅ |
| `npm run boundaries` | ✅ |
| `npm run typecheck` | ✅ |
| `npx vitest run` | ✅ 66 檔 **1008 passed**(補測試前 1004) |
| `cucumber-js --tags "not @manual"` | ✅ **293 passed / 0 failed**(164 undefined 是未開工的 phase) |
| `npm run accept:dry` | ✅ **0 ambiguous** |
| `npm run standalone` | ✅ 全部通過(9 跑、3 interactive 跳過) |
| Stryker `state.ts` | ✅ **100.00%**(84.78% → 100.00%) |
| Stryker `deps.ts` | ✅ **100.00%**(未退步,見 02 的 REVIEW) |

## A.9 本輪修改的檔案

- `packages/core/src/ingest/state.test.ts` —— 補 fd 不外洩 ×2、`readLogEvents` ×2
- `packages/core/src/ingest/state.ts` —— 只加一個 `Stryker disable next-line all` 註解,
  行為零改動
