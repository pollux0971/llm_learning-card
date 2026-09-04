# REVIEW — P-28:掃描器 0 條目 FAIL + markdown 相對連結檢查

審核對象:`b65c20d`(兩支掃描器掃到 0 個東西 → exit 1)與 `8beac58`(`scripts/check-doc-links.ts` 實作)。
分支 `pollux0971/scanner-and-doc-links`,審核起點 HEAD = `8beac58`。

這張工單跨 `scripts/`,不屬於任何單一 feature,所以報告放在新開的 `docs/reviews/` 底下,
而不是塞進某個 `features/NN-*/REVIEW.md`,也不是覆蓋根目錄那份還停留在 03-llm-router 的 `REVIEW.md`。

## 結論:**PASS**(有兩個回報但不擋的發現)

實作是對的,`stripCode` 偏離 CommonMark 的那個選擇是正當的而且我實測驗證過。
但**開發輪交出來的測試沒有守住 commit message 裡自己宣稱的大半行為**——
變異測試把 `check-doc-links.ts` 打到 63.13%,存活的變異正好落在
「角括號連結」「protocol-relative」「mailto:」「%20 還原」「行號保留」
「inline code 精確長度配對」這些 commit message 明講、但一條測試都沒有的地方。
審核輪補了 53 個測試(1197 → 1250),三支的變異分數都拉過標準級 80%。

| 項目 | 結果 |
|---|---|
| `stripCode` 第 4 條規則(有 info 的圍欄 push 不 pop) | **正當**,破壞驗證會紅,見 §3 |
| 三支 0 條目 FAIL | 各自實測通過,見 §4 |
| `lint:docs` 掛進檢查鏈 | 有,見 §5 |
| 20 條連結的數字 | 用 markdown-it 獨立 parse 對過,一模一樣,見 §6 |
| 變異分數(標準 80%) | doc-links 91.88% / standalone 91.67% / boundaries 91.30%,見 §8 |
| 投機取巧 | 沒發現,見 §9 |

---

## 1. 完整驗收

全部在這個 worktree、`npm ci` 之後跑的。

| 指令 | 結果 |
|---|---|
| `npm ci` | exit 0 |
| `npm run boundaries` | `掃描 185 個檔案,允許例外 10 條` / `✓ 無違規`,exit 0 |
| `npm run typecheck` | exit 0 |
| `npx vitest run` | 73 檔 **1243 passed**(開發輪交件時是 1197,審核輪 +46) |
| `npm run lint:docs` | `掃描 76 個 markdown 檔,20 條相對連結` / `✓ 連結全部都在`,exit 0(補了本報告與跑過 standalone 之後是 78 檔、仍然 20 條、仍然 exit 0——檔數會變的原因見 §10.6) |
| `NODE_OPTIONS=--import=tsx npx cucumber-js --tags "not @manual"` | `471 scenarios (161 undefined, 310 passed)`、`2163 steps (656 undefined, 72 skipped, 1435 passed)`、**真正失敗 0 個**(`✗` 出現 0 次;exit 1 來自 undefined 的未實作場景,是既有基準,沒有退化) |
| `npm run accept:dry` | `471 scenarios (161 undefined, 310 skipped)`,**0 ambiguous** |
| `npm run standalone` | `讀到 13 個條目`、10 個 ✓、3 個 interactive 跳過、`全部通過`,exit 0 |

## 2. 兩個新參數沒有動到既有行為(逐字比對,不是看測試綠不綠)

任務點名要確認那兩個回歸測試不是空轉。**它們確實不是在測既有行為**:兩個都走 `--root` fixture,
也就是新路徑;預設路徑一條測試都沒有。所以我改用「舊版 vs 新版逐字 diff」直接驗:

把 `b65c20d~1` 的兩支掃描器取出來、放在同一棵樹上跑,比對 stdout+stderr:

```
$ npx tsx scripts/_old-check-boundaries.ts   vs   npx tsx scripts/check-boundaries.ts
  → diff 空,退出碼相同
$ npx tsx scripts/_old-check-boundaries.ts --verbose  vs  新版 --verbose
  → diff 空,退出碼相同
$ npx tsx scripts/_old-check-standalone.ts --list  vs  新版 --list
  → 只多一行:standalone: 從 <repo>/standalone.json 讀到 13 個條目
     其餘每一行與退出碼都相同
```

(比對用的暫存檔跑完就刪了,所以那次 boundaries 兩邊都是 exit 1——多出來的
`scripts/_old-*.ts` 沒有落點。兩邊看到的是同一棵樹,比對仍然成立。)

**另外補了自動測試守這件事**:`check-boundaries.test.ts` 的「不帶 `--root` 的既有行為」
兩條(預設掃 repo、`--verbose` 多印歸屬),`check-standalone.test.ts` 的「不帶 `--manifest`
預設讀 repo 根的 standalone.json」,`check-doc-links.test.ts` 的「沒有 `--root` 就掃這個 repo」。
補之前那三個地方的變異全部存活,補之後全部被殺。

## 3. `stripCode` 第 4 條規則:破壞驗證

### 3.1 這個偏離 CommonMark 的選擇是正當的

commit message 說純 CommonMark 會在 `` ```example `` 就收掉外層。我先確認**這個坑是真的**,
不是假想敵——用非貪婪 regex 重跑一次真的 `docs/00-design.md`:

```
naive regex 版本抓到的相對連結: [ '../../assets/sec-0042-sop.png:L119' ]
```

那條連結不存在,所以 naive 版會報一條**根本不存在的壞連結**。坑是真的。

反過來,選 push 的代價是「外層要兩個 ``` 才收乾淨」。這跟 `docs/00-design.md:97-121` 的實際寫法
一致(該檔自己就在 126 行說 `` ```example `` 是「巢狀 markdown 容器」),所以這個選擇對這個 repo 是對的。
**判定:正當。**

### 3.2 手動把第 4 條改成 pop

```diff
         if (fence.info !== '') {
-          stack.push({ char: fence.char, len: fence.len });
+          stack.pop();
           return blankLine(line);
         }
```

```
$ npx vitest run scripts/check-doc-links.test.ts
 FAIL  反引號裡的檔名是行文提及,不是連結 > 圍欄裡又出現一行帶 info string 的圍欄時,不可以提早收掉區塊
 AssertionError: expected 1 to be +0
 Tests  1 failed | 20 passed (21)

$ npm run lint:docs
doc-links: 掃描 76 個 markdown 檔,21 條相對連結
✗ 1 條連結指到不存在的檔案:
  docs/00-design.md:119  →  ../../assets/sec-0042-sop.png
```

測試會紅,而且真的 repo 會冒出那條誤報。**這條規則有被守住。**(改完已還原,`git status` 乾淨。)

### 3.3 `docs/00-design.md:114-121` 的實測

直接對真檔案跑 `stripCode` + `findRelativeLinks`:

```
docs/00-design.md 抓到的相對連結 = []   ← 空的,沒有 sec-0042-sop.png
```

誤報確實被擋掉了。

## 4. commit message 沒提到的巢狀形狀(我自己想的)

全部直接對 `stripCode` + `findRelativeLinks` 跑。「應該看到」= 圍欄外的真連結,
「不應該看到」= 圍欄裡的示範連結。

| # | 形狀 | 結果 | 判定 |
|---|---|---|---|
| A | ```` ```` ```` 外層,裡面一整組 ``` ``` ``` 圍欄 + 假連結 | 只抓到外面的真連結 | ✅ 對(規則 5:短的收不了尾) |
| B | ``` ``` ``` 開頭,中間出現 ```` ```` ````(無 info、比 top 長) | 在 ```` ```` ```` 收尾,之後的連結抓得到 | ✅ 對(規則 3,合 CommonMark) |
| C | 圍欄沒收尾,一路吃到檔尾 | 後面的連結全部不算 | ✅ 對(CommonMark:未閉合圍欄延伸到文件結尾) |
| D | inline code 裡放 `` `](` `` 這種長得像連結的字元 | 沒被騙,同行真連結照樣抓到 | ✅ 對 |
| E | 孤兒單反引號後面接真連結 | 反引號原樣留著,真連結抓得到 | ✅ 對 |
| F | ``` ```markdown ``` → ``` ```example ``` → ``` ```example2 ```,只用兩個 ``` ``` ``` 收 | 少收一層,後面的真連結被吃掉 | ⚠️ **已知代價**,見下 |
| G | 縮排 3 格的圍欄 | 算圍欄 | ✅ 對(CommonMark 上限 3 格) |
| H | 縮排 4 格 | 不算圍欄 | ✅ 對(那是 indented code) |
| I | ``` ``` ``` 圍欄裡出現 `~~~` | 當內文,收不了尾 | ✅ 對(規則 2) |
| J | 單反引號包住 `` ```example ``(`00-design.md:126` 的形狀) | 整段被當 inline code,同行真連結照樣抓到 | ✅ 對 |
| K | 真檔案 `docs/00-design.md` | 0 條相對連結,沒有 `sec-0042-sop.png` | ✅ 對 |

**F 是 push 語意的已知代價**:巢狀層數與收尾的 ``` ``` ``` 數量對不上時,stack 清不乾淨,
後面的真連結會被靜默吃掉。方向是「少報」不是「誤報」,而且極端情況(整份文件被吃光)
會撞上「0 條連結 → FAIL」那道防線。不擋,但記在這裡。

## 5. `lint:docs` 真的掛進了會被跑到的地方

三個證據,不是只看 `package.json` 有這個 script:

1. **在版控裡**
   ```
   $ git ls-files scripts/ | grep doc-links
   scripts/check-doc-links.test.ts
   scripts/check-doc-links.ts
   ```
2. **掛在會被跑到的鏈上**(這三處都是 `d90cd36` 那個測試 commit 一起加的)
   - `package.json` → `"lint:docs": "tsx scripts/check-doc-links.ts"`
   - `.claude/skills/autopilot/SKILL.md:39` 的收割檢查鏈:
     `npm run boundaries && npm run typecheck && npm run lint:docs && npm test && …`
     ——這條是每次合併都會跑的,不是文件裝飾
   - `docs/03-agile-workflow.md:91` 的 Definition of Done 選配清單
   - 單元測試本身也會跑:`vitest.config.ts` 的 `include` 有 `scripts/**/*.test.ts`
3. **真的跑一次那條鏈**
   ```
   $ npm run boundaries && npm run typecheck && npm run lint:docs
   boundaries: 掃描 185 個檔案,允許例外 10 條
   ✓ 無違規
   doc-links: 掃描 76 個 markdown 檔,20 條相對連結
   ✓ 連結全部都在
   ```

**一個缺口(回報不擋)**:`.claude/skills/phase-acceptance/SKILL.md` 的驗收步驟裡**沒有** `lint:docs`
(第五步只有 `npm run boundaries`)。`/phase-done` 走的是那份 skill,所以單獨驗收一個 phase 時不會跑到。
建議補進去,或明確決定它只在合併鏈上跑。

## 6. 那個「20」是真的

不信回報,自己數一次。用 `markdown-it`(repo 既有依賴)**真的 parse**,
完全不碰 `check-doc-links.ts` 的 `stripCode`,再拿兩邊的清單對:

```
獨立計數(markdown-it):76 個 md 檔,20 條相對連結,0 條壞的
check-doc-links   :76 個 md 檔,20 條相對連結,0 條壞的
diff 兩邊的連結清單 → 完全相同(20 條全在 docs/01-roadmap.md)
```

**再故意弄壞一條**(加一條壞的 + 一條好的到 `docs/01-roadmap.md`):

```
doc-links: 掃描 76 個 markdown 檔,22 條相對連結        ← 數字有跟著動
✗ 1 條連結指到不存在的檔案:
  docs/01-roadmap.md:211  →  ./THIS-FILE-DOES-NOT-EXIST.md   ← 行號正確
exit 1
```

還原後回到 `20 條 / ✓ / exit 0`,`git status` 乾淨。

順帶一提:20 條全部集中在 `docs/01-roadmap.md` 一個檔案。哪天有人把 roadmap 的連結表改成別的寫法,
連結數會直接歸零、`lint:docs` 會 FAIL 並說「掃描器壞了」——那是設計上想要的行為,不是誤報,
但接手的人要知道這件事。

## 7. 三支 0 條目 FAIL 的實測輸出

各自跑一次,不是只信回報。

```
########## 1. boundaries --root <空目錄> ##########
boundaries: 掃描 0 個檔案,允許例外 0 條

✗ boundaries: 掃描到 0 個檔案(walk 找到 0 個原始檔,實際檢查 0 個)
這不是很乾淨,是掃描器壞了。落點表 OWNERS、walk() 的 SKIP_DIRS、或副檔名清單 EXTS 壞掉時就長這樣。
EXIT=1

########## 2. standalone --manifest <空 manifest {}> --list ##########
standalone: 從 <tmp>/empty-manifest.json 讀到 0 個條目

✗ 讀到 0 個條目
這不是很乾淨,是掃描器壞了。manifest 路徑指錯、檔案被清空、或格式改掉時就長這樣。
EXIT=1

########## 3. check-doc-links --root <只有一個沒連結的 md> ##########
doc-links: 掃描 1 個 markdown 檔,掃描到 0 條相對連結
這不是很乾淨,是掃描器壞了。掃描範圍 SCAN_DIRS、副檔名、或 stripCode 挖太多時就長這樣。
EXIT=1
```

**「這不是很乾淨,是掃描器壞了」三支都有,一字不差。** 沒有抽共用模組是刻意的(見 `b65c20d` 的說明),
三支的測試各自釘住這句話,所以誰改掉都會紅。

**補了一條原本沒守到的瞎法**:`found > 0` 但 `scanned = 0`——落點表把所有東西標成膠水(`infra`/`steps`),
walk 找得到檔案卻一個 import 都沒看過。開發輪的三條測試全部是 `found = 0`,那個 `||` 的右半邊沒人守。
現在有了(`check-boundaries.test.ts`「全部都是膠水落點(scanned=0):不可以印「✓ 無違規」」)。

## 8. 變異測試

### 8.1 工具本身的坑(這件事值得寫下來)

`stryker.config.json` 的 `mutate` 只涵蓋 `packages/`,不含 `scripts/`,所以三支都要手動指定範圍——這點任務有預期到。
但還有一個沒預期到的:

**`check-boundaries.ts` 與 `check-standalone.ts` 在 import 的當下就跑 `main()` / `process.exit()`,
所以它們的測試只能開子行程測。而 Stryker 預設的 vitest runner 只在「同一個行程內」啟用變異,
子行程拿到的是沒啟用變異的程式碼——量出來的分數是假的。**

實證:
- 直接用 `--mutate "scripts/check-boundaries.ts"` → `No tests were executed`,Stryker 直接中止
- 繞過去(限定 vitest include + `related: false`)→ `check-standalone.ts` **4.59%,0 killed / 104 survived**,
  包含 `if (all.length === 0) → if (false)` 這種我手動驗過測試一定抓得到的變異

修法:改用 Stryker 的 **command test runner**。它會把 `__STRYKER_ACTIVE_MUTANT__` 放進環境變數,
而 instrumented 的程式碼會從 `process.env` 讀,所以子行程也吃得到。

本次用的設定檔留在 repo 根:`stryker.scanner-{doclinks,standalone,boundaries}.json`
與 `stryker.scanner-boundaries-p28.json`,搭配 `vitest.scanner-*.config.ts`(限定單一測試檔,不然每個變異都要跑全套 1243 個測試)。

跑法:

```bash
npm run mutate -- stryker.scanner-doclinks.json
npm run mutate -- stryker.scanner-standalone.json
npm run mutate -- stryker.scanner-boundaries-p28.json
```

### 8.2 分數(標準級門檻 80%)

| 檔案 | 範圍 | 分數 | 判定 |
|---|---|---|---|
| `scripts/check-doc-links.ts` | 整個檔案(P-28 新檔) | **91.88%** | ✅ |
| `scripts/check-standalone.ts` | P-28 動到的 22–25、32–59 | **91.67%** | ✅ |
| `scripts/check-boundaries.ts` | P-28 加的 24–34、186–192、226–232 | **91.30%** | ✅ |
| `scripts/check-boundaries.ts` | 參考:整個 `main()` 區段 185–232 | 61.11% | ⓘ 見下 |

`check-doc-links.ts` 的變化:**63.13% → 86.35% → 91.51% → 91.88%**(每一段是補一批測試)。

`check-boundaries.ts` 整個 `main()` 只有 61.11%,但 42 個存活裡有 **40 個落在 202–225**,
也就是 P-28 完全沒動過的「違規偵測 + 報告」內文——那段本來就沒有單元測試,是既有狀態,不是這張工單造成的。
**回報不擋**,建議之後單獨開一張補測試的工單。

### 8.3 存活變異逐條分類

分類用 `.claude/skills/mutation-testing/SKILL.md` 的四類:
①真的漏測→補測試 ②等價→標記忽略 ③該行不該存在→刪掉 ④邊界沒測到。

#### `check-boundaries.ts`(P-28 範圍,2 個存活)

| 行 | 變異 | 類 | 理由 |
|---|---|---|---|
| 26 | `i >= 0` → `i > 0` | ② 等價 | `process.argv.indexOf(name)`:argv[0] 是 node、argv[1] 是腳本,參數旗標永遠不可能落在索引 0,所以 `>= 0` 與 `> 0` 行為相同 |
| 227 | `found === 0 \|\| scanned === 0` → `false \|\| scanned === 0` | ③ 該行的左半邊到不了 | `scanned++` 只在 `found++` 的迴圈內,所以 `found === 0` **蘊含** `scanned === 0`,左半邊永遠不會單獨成立。留著不會錯(訊息同時印兩個數字仍然有價值),但它不是一個獨立的條件。**回報不擋,不改程式。** |

#### `check-standalone.ts`(P-28 範圍,3 個存活)

| 行 | 變異 | 類 | 理由 |
|---|---|---|---|
| 34 | `i >= 0` → `i > 0` | ② 等價 | 同上 |
| 38 | `arg('--timeout') ?? 120_000` → `&& 120_000` | ② 測不到且非本工單範圍 | `--timeout` 只在真的執行指令時用得到;掃描器測試一律加 `--list`(不然每個變異都要真的跑十幾個 npm 指令,幾小時起跳)。`--timeout` 是 P-28 之前就有的參數,不在這張工單 |
| 38 | `arg('--timeout')` → `arg("")` | ② 等價 | `process.argv.indexOf("")` 永遠是 -1 → `undefined` → 一樣退回 120000 |

#### `check-doc-links.ts`(17 存活 + 5 no-coverage = 22)

**其中 11 個落在 288–292 的 CLI bootstrap**(`isDirectRun` 與那三行),全部是 ② **工具限制**:
測試是用 `spawnSync` 真的跑 `npx tsx scripts/check-doc-links.ts`(兩條,一條壞連結、一條 0 連結),
但 Stryker 的 vitest runner 在子行程裡不啟用變異,所以看不到那兩條測試的效果。
那段程式**有被測到**,只是變異測試量不到。

剩下 11 個:

| 行 | 變異 | 類 | 理由 |
|---|---|---|---|
| 65 | `/^ {0,3}…$/` → 去掉 `$` | ② 等價 | 沒有 `m` 旗標、輸入是單行,`(.*)` 本來就貪婪到行尾 |
| 92 / 97 / 103(5 個) | `i < line.length` → `<=`、`&&` 左邊 → `true` | ② 等價 | `line[line.length]` 是 `undefined`,`undefined === '` + '`' + `'` 為 false,迴圈一樣在同一個位置停 |
| 170 | `(?:\s+…)` → `(?:\s…)` | ④ 邊界,低價值 | 要殺掉需要「路徑與 title 之間有兩個以上空白」的連結。真實文件不會這樣寫,補一條只為殺變異的測試違反 skill 的「不要無腦補測試」 |
| 186(3 個) | `startsWith('<')` → `startsWith("")`、`endsWith('>')` → `endsWith("")`、`&&` → `\|\|` | ② 防禦性,等價於現實輸入 | 要殺掉需要「開頭是 `<` 但結尾不是 `>`」或反過來的畸形目標。角括號的正常/壞掉/空 `<>` 三種都已經有測試 |
| 222 | `p.split('\\').join('/')` → `join("")` | ② 平台等價 | Linux 上 `split('\\')` 永遠只有一個元素,`join` 做什麼都一樣。這行是給 Windows 用的,在這裡標為等價 |

**沒有任何一個存活變異落在「① 真的漏測」。**(補測試之前有——見 8.4。)

### 8.4 開發輪交件時真正漏測的東西(已補)

第一次跑 63.13% 時存活的變異,指到的是 commit message **明講、但一條測試都沒有**的行為。
審核輪照「補一個反映真實需求的測試」而不是「補一個剛好殺死變異的斷言」補了:

- **行號與欄位保留**(`blankLine` 換等長空白、`.join('\n')`)——commit message 說「報 file:line 才準」,
  但沒有任何一條測試檢查過行號。補了 `stripCode` 的逐行等長斷言,與「壞連結報第 7 行」
- **inline code 的精確長度配對**——這是 `stripInlineCode` 不用 regex 的**全部理由**,卻沒測。
  補了 `00-design.md:126` 的形狀、孤兒反引號、雙反引號配對
- **`<角括號>` 形式** / **protocol-relative `//`** / **`mailto:` `file:`** / **`%20` 還原**
  ——commit message 四條都寫了,測試零條。全部補上(含壞掉的 `%ZZ` 走 catch 的那條)
- **圍欄規則 2、3、5** 與 **``` 的 info string 不能有反引號**——只有規則 4 有測試
- **`SKIP_DIRS` 的 `dist` / `.git` / `target` / `.svelte-kit`**——只有 `node_modules` 有測試
- **根目錄 `README*.md` 的命名**——只測了 `README.md`,`README-zh.md` 與 `readme.txt` 沒測
- **訊息本身的完整格式**——三種輸出(全綠 / 有壞連結 / 0 條)現在逐行釘死。
  訊息就是這張工單的產出,不能只用 `toContain` 蒙混
- **`--root` / `--manifest` 指到不存在的路徑**——要 FAIL,不是當機也不是綠燈
- **不帶參數時的預設行為**(三支都補)

`linkCount()` 這個測試輔助函式的 regex 也修了:原本是 `/(\d+) 條相對連結/`,
`links--` 這種壞法會印 `-1 條相對連結`,舊 regex 會從 `-1` 裡撿到 `1`,看起來像對的。改成 `(-?\d+)`。

### 8.5 順手修的一個 flaky 風險

`check-boundaries.test.ts` 與 `check-standalone.test.ts` 每條測試都開一個 `npx tsx` 子行程(1–3 秒),
而 vitest 的預設 test timeout 是 **5 秒**。機器一忙就會假性變紅——我在跑變異測試時就真的踩到了
(4 條測試同時 `Test timed out in 5000ms`)。掃描器的測試變成 flaky 比沒有測試更糟,
所以每條開子行程的測試都明確給了 60 秒 timeout。

## 9. 有沒有投機取巧

沒有。逐項確認過:

- **測試不是自己測自己**:三支都用臨時目錄 / 臨時 manifest 當 fixture。這是對的——直接掃這個 repo 的話,
  「0 個東西」那條分支一輩子跑不到,而且任何人改文件都會讓測試莫名其妙變紅。測試檔的註解也把這件事寫清楚了
- **0 條目的判斷不是靠 `try/catch` 蒙混**:三支都是明確數數字再比 0
- **`--only` 找不到名字** 與 **manifest 是空的** 是兩種不同的紅,`all.length === 0` 的檢查刻意放在 `--only`
  過濾**之前**,訊息也不同。這點有測試守著
- **`check-boundaries` 的 0 分支印在 unmapped / violations 之後、`✓ 無違規` 之前**,所以既有的兩種紅不受影響,
  也不會同時印出「無違規」跟「掃描器壞了」。實測確認
- **沒有為了讓 `lint:docs` 過而改文件**:`git status` 全程乾淨,20 條連結本來就都在
- **`process.exit` 的退出碼**:三支都逐一實測過真實退出碼,不是只看訊息

## 10. 待辦(回報不擋)

1. `.claude/skills/phase-acceptance/SKILL.md` 第五步補 `npm run lint:docs`,或明確決定它只在合併鏈上跑(§5)
2. `scripts/check-boundaries.ts` 的 202–225(違規偵測與報告內文)沒有單元測試,變異分數 61.11%。
   既有狀態,建議另開工單(§8.2)
3. `check-boundaries.ts:227` 的 `found === 0 ||` 左半邊到不了(§8.3)。留著無害,但知道就好
4. `stripCode` 的 push 語意在「巢狀層數與收尾數量對不上」時會靜默吃掉後面的連結(§4 的 F)。
   方向是少報不是誤報,極端情況會撞上 0 條連結的防線
5. 20 條連結全部集中在 `docs/01-roadmap.md`(§6)。改那個檔案要留意連結數
6. **掃描範圍會吃到跑測試產生的檔案**(審核中途發現)。`npm run standalone` 的 09-lint 那一項會在
   `contracts/fixtures/learning-broken/state/` 底下寫出 `lint-report-<日期>.md`。那個檔案被 `.gitignore`
   忽略,但 `check-doc-links` 照樣掃得到,所以「掃描 N 個 markdown 檔」的 N 會隨「今天有沒有跑過 standalone」
   而變(我這次就看到 76 → 78)。目前那份報告裡一條 `](` 都沒有,所以不影響對錯;
   但哪天 `scripts/lint.ts` 的報告格式改成寫 markdown 連結,`lint:docs` 就會去報一個**產生物**裡的壞連結。
   建議把 `contracts/fixtures/` 或 `state/` 排除在掃描範圍外,或至少不要掃被 gitignore 的檔案

## 附:審核輪改動的檔案

只動測試檔與新增設定檔,**沒有改任何一支掃描器的程式**:

- `scripts/check-doc-links.test.ts`(21 → 64 條)
- `scripts/check-boundaries.test.ts`(5 → 10 條)
- `scripts/check-standalone.test.ts`(5 → 10 條)
- `stryker.scanner-{doclinks,standalone,boundaries}.json`、`stryker.scanner-boundaries-p28.json`
- `vitest.scanner-{doclinks,standalone,boundaries}.config.ts`
- 本檔
