# gherkin-dup 三組判斷 + 模板 v1.3.2 同步

branch `pollux0971/template-132-gherkin` · base `4d95f6d` · commit `0c63fb5`
(工單說 branch 是 `pollux0971/gherkin-dup`,實際 worktree 給的是 `template-132-gherkin`,base 正確是 main。)

## 一、三組各自的判斷與證據

### (A) 06/phase-2 與 i3 —— **真重複,已收斂(改口吻)**【驗】

同一句 `The window and the terminal produce the same session` 出現在能力層與整合層。

`docs/integration/README.md` 的對照表就是那條「兩種口吻」規則:

| | features/ | integration/ |
|---|---|---|
| 驗什麼 | 一個模組的行為 | 模組串起來之後,**使用者做得到什麼** |
| 依賴 | 只有 contracts + fixture | 真的模組,沒有 stub |

「視窗 vs 終端機產生同一個 session」是**使用者視角**,屬於整合層。能力層借用了它的主詞,
所以兩邊寫出同一句話。

**做法**:i3 那份原樣保留;`features/06-test-card/phase-2.feature` 改成模組口吻 ——
主詞是卡片,後端是真的 scheduler:

```gherkin
Scenario: The card shows exactly what the real scheduler returns
  Given a fixed learning directory and a fixed date
  When the card builds its question list from the real scheduler
  Then the list matches the scheduler's due list in content and order
```

兩份都是 3 句步驟,而且 06/phase-2 狀態是 `todo`、那三句本來就沒有步驟定義
(`grep` features/steps/ 對三句都 0 命中),所以 undefined 數不因此增減。

### (B)(C) 六個 IN 的 `Every standalone entry point still runs` —— **設計對,但實作是六份複本;已用 tag 收斂,不需要 allowlist**【驗】

工單問的是「那六次有沒有各自的意義」。**沒有。**三條證據:

1. `features/steps/i1-content-pipeline.steps.ts` —— 那個 When 只做一件事:
   `this.runCommand('npx tsx scripts/check-standalone.ts', ...)`。無參數、無 IN 範圍、不讀 world 狀態。
2. `features/steps/_world.ts` —— `runCommand` 用 **`cwd: ROOT`**,不是 `this.dir`。
   所以六個整合檔各自的 Background(i3 的「built for Linux」、i5 的「installed on Linux」…)
   對這個步驟**完全沒有作用**。
3. `standalone.json` 全 repo **只有一份**(根目錄,13 個條目),沒有 per-IN 版本。

⇒ 六次跑的是**同一個 subprocess、同一份 manifest**,結果必然相同。這推翻了協調者的
【推】「每個 IN 的 standalone.json 內容不同」。

但**設計意圖本身站得住**:ADR-022(整合後仍要能單獨跑)+ ADR-024(每個整合點都是完整可用的系統),
合起來就是「每個 IN 都要重驗一次 standalone 還跑得動」。六份複本只是這個意圖的**實作方式**,不是意圖本身。

**做法(比 allowlist 好的那條路,顧問說「證明得到就更好」)**:

新增 `docs/integration/standalone-regression.feature`,feature 標頭掛
`@integration @i1 @i2 @i3 @i4 @i5 @i6`,六個整合檔各自那份刪掉。

**為什麼行得通**:`/integrate` 選整合點用的是**純 tag 篩選**
(`.claude/skills/integration-check/SKILL.md`:`--tags "@<in> and not @manual"`),
不是 per-IN profile,也不是路徑篩選。cucumber 的 tag 會從 Feature 標頭繼承到場景,
所以一份場體被六個 tag 各自選中一次。

**實測每個 IN 都仍然跑得到**:

```
for n in 1..6: cucumber-js --tags "@i$n and not @manual" --dry-run --format message
```

| IN | 名為 `Every standalone entry point still runs` 的 pickle 數 |
|---|---|
| @i1 | 1 |
| @i2 | 1 |
| @i3 | 1 |
| @i4 | 1 |
| @i5 | 1 |
| @i6 | 1 |

**為什麼這不是放寬規則**:沒有動 `check-gherkin-dup.ts`,也**沒有加任何 allow 條目**
(`scripts/gates.config.json` 仍然只有 `{"cucumberCwd": "."}`)。守門的判定標準一個字沒改,
是「被檢查的東西」真的不再重複了。allowlist 是宣告「這個重複可以接受」;這裡是**重複本來就不必存在**。

顧問給的 `gherkinDup.allow` 退路**沒有用到**,留著給未來真的無法收斂的情況。

## 二、反向驗證【驗】

### (a) 同檔複製

```
$ python3 - <<'PY'  # 把 i5 的 "Both cards still work as in I4" 場體複製一份,換個名字
$ npm run check:gherkin-dup
gherkin-dup: 掃描 47 個 .feature 檔,496 個場景

✗ 1 組場景本體逐字相同:
  ---
  docs/integration/i5-daily-habit.feature:80  Scenario: Both cards still work as in I4
  docs/integration/i5-daily-habit.feature:84  Scenario: A deliberately duplicated body for the reverse check
gate=gherkin-dup result=FAIL scanned=496
exit=1
```

### (b) 跨檔複製共用場體(工單指定的那個形狀)

```
$ # 把 standalone-regression.feature 的場體複製進 i4,換個名字
$ npm run check:gherkin-dup
gherkin-dup: 掃描 47 個 .feature 檔,496 個場景

✗ 1 組場景本體逐字相同:
  ---
  docs/integration/i4-two-card-system.feature:80  Scenario: A copy of the shared standalone regression body
  docs/integration/standalone-regression.feature:15  Scenario: Every standalone entry point still runs
gate=gherkin-dup result=FAIL scanned=496
exit=1
```

順帶證明了 allow 的語意:allow 要求「組裡**每個**場景名稱都等於 `scenario`」,
這裡名字不同 → 就算之後加了 allow 條目也擋不住這種真重複。

### (c) 還原

```
$ npm run check:gherkin-dup
gherkin-dup: 掃描 47 個 .feature 檔,495 個場景
✓ 無重複場景
gate=gherkin-dup result=PASS scanned=495
exit=0
```

`git status --short` 確認還原後沒有殘留改動。

## 三、模板 v1.3.2 同步

tag `template/v1.3.2` = `7eecc51`。`sync-gates.sh` 同步 9 支(7 支 `.ts` + `scripts/py/` 兩支 `.py`)。

**HOTFIX 已刪**:`check-phase-coverage.ts` 的本地補丁隨同步被覆蓋,`grep -rn HOTFIX scripts/` 0 命中,
`npm run typecheck` **exit 0** —— 根因(`--exactOptionalPropertyTypes`)確實修好了。

**順帶查到 `template/v1.3.3` 也存在**(spend check tri-state)。
`git diff --stat template/v1.3.2 template/v1.3.3 -- template/` 顯示它**只動 SKILL.md / CHANGELOG /
CHECKLIST / PITFALLS / VERSION,一支腳本都沒改**,`sync-gates.sh` 兩版逐字相同。
它講的 llm-spend 三態退出碼在 main 的 `e9c6d51` 已經做過了,所以對這張是 no-op。照工單同步 1.3.2。

### 前提驗證(第三次了,結果:找到一條真迴歸)

| 工單要求 | 結果 |
|---|---|
| 四支守門旗標清單沒少 | ✅ `--root`(boundaries/doc-links/standalone)、`--manifest`/`--only`/`--list`/`--timeout`(standalone)、`--cwd`/`--run`/`--tags`/`--run-phases`(phase-coverage)全在 |
| 「0 條目 FAIL」守衛還在 | ✅ boundaries / step-dup / gherkin-dup / phase-coverage / doc-links 都有,且 1.3.2 額外補了 `gate=... result=FAIL scanned=0` |
| `lint:docs` 對 `docs/00-design.md` 不誤報 | ✅ 60 檔 / 20 連結 / 0 壞連結 exit 0 |
| 跑 `standalone` 前後數字穩定 | ✅ 14 條 exit 0,前後一致 |
| `boundaries` 195 檔 / 11 例外 / 0 違規 | ⚠️ **198** 檔 / 11 例外 / 0 違規。**不是迴歸**:把 `HEAD` 版(v1.3.0)的舊腳本抓出來對同一棵樹跑,也印 198。掃描範圍的 diff 只有設定檔搜尋順序,沒動 SKIP_DIRS/EXTS。是 repo 從工單寫成時的 195 長大了。 |
| `verify-against.sh` 0 差異 | ⚠️ **前提本身在 1.3.2 之下不成立**,見下 |
| `sync-gates.sh --check` 綠 | ❌ **真迴歸,見下** |

### 🔴 迴歸一:`sync-gates.sh --check` 在本 repo 必紅

```
$ sync-gates.sh <repo> scripts --check
✓ _root.ts
✗ check-boundaries.test.ts 缺 SOURCE 標頭或格式不對(第一行:/**)
✓ check-boundaries.ts
✗ check-doc-links.test.ts 缺 SOURCE 標頭或格式不對(第一行:/**)
✓ check-doc-links.ts
✓ check-gherkin-dup.ts
✓ check-phase-coverage.ts
✗ check-standalone.test.ts 缺 SOURCE 標頭或格式不對(第一行:/**)
✓ check-standalone.ts
✓ check-step-dup.ts
✓ mutate.py / test_mutate.py
○ 三個設定檔(不比對)
exit=1
```

**根因(讀 code 定位,不是猜)**:

- v1.3.0 的 `--check` 列舉的是 **`$TEMPLATE_DIR/scripts/check-*.ts`**(模板側的檔案清單)。
  模板裡沒有 `.test.ts`,所以我們自己的測試檔從來不會被列舉 → 綠。
- v1.3.2 的 `--check` 改成列舉 **`$DEST/check-*.ts`**(目標目錄的 glob)。
  這個 glob **會吃到 `check-*.test.ts`** —— 那是專案自己的測試檔,從來不是模板檔、
  從來沒被 sync 過、當然沒有 SOURCE 標頭 → 必紅。

sync 那一側仍然從模板列舉(所以不會去複製 `.test.ts`)。**兩側列舉來源不一致**,就是這條 bug。

影響面:**任何把 `check-*.test.ts` 放在守門旁邊的 repo,`--check` 都永遠綠不了。**
`v1.3.3` 沒有修(`sync-gates.sh` 兩版逐字相同)。

**建議的模板修法**(一行):`--check` 迴圈裡跳過 `*.test.ts`

```bash
for dst in "$DEST"/_root.ts "$DEST"/check-*.ts; do
  [ -f "$dst" ] || continue
  case "$dst" in *.test.ts) continue;; esac   # ← 加這行
  ...
```

**我沒有自己改**:`sync-gates.sh` 不在同步進本 repo 的檔案清單裡(它住在模板),
改本地也沒有東西會用到;而把我們的測試檔改名去迎合模板 bug 是本末倒置。
已在 `.claude/skills/autopilot/SKILL.md` 的檢查鏈標註判讀方式:
**只有那三行 `✗ check-*.test.ts 缺 SOURCE 標頭` 可放行,其他任何一行紅都是真的漂移。**

### ⚠️ 迴歸二(較輕):`verify-against.sh` 對 check-boundaries 永遠有差異

6 支裡 5 支「✓ 一致」,只有 `check-boundaries.ts` 退出碼 模板=1 / consumer=0。

**根因**:1.3.2 把設定檔搜尋順序改成「**腳本自己所在的目錄** → `<ROOT>/scripts/`」。
`verify-against.sh` 跑模板側那支時,候選 1 命中的是**模板自己的** `boundaries.owners.json`
(佔位用,owners 表較小、`boundaries.allow.json` **0 條例外**),拿它套我們的樹
→ 4 個檔案沒落點 + 43 個違規 import;consumer 側讀到我們真正的設定(40 owners / 11 例外)→ 綠。

也就是說**差異來自設定檔,不是程式碼**。程式碼同一份這件事由 `--check` 的 sha256 獨立證明了(7 支全 ✓)。

⇒ 工單那句「sync 後兩邊同一份,理論上應為 0 差異」在 1.3.2 之下**對 check-boundaries 不成立**,
而且對任何填了真 owners.json 的 consumer 都不成立。這比較像 `verify-against.sh` 的可用性問題
(模板側那次執行應該指向 consumer 的設定檔),不影響守門本身的正確性。**不擋這張。**

### 跟進的兩處測試改動(我們自己的測試,不是模板檔)

1. `check-doc-links.test.ts` ×3 —— 逐字比對整段輸出。1.3.2 每支守門結尾多印
   `gate=<name> result=... scanned=N`(CHANGELOG 1.3.2 (C)),把那行補進期望值。
2. `check-boundaries.test.ts` ×2 —— `--root` 指到不存在/空目錄。因為新的搜尋順序
   讓它仍讀得到本 repo 的 owners.json,紅的位置從「找不到設定檔」移到「掃描到 0 個檔案」。
   **仍然是紅、仍然 exit 1、仍然不是綠燈**。這兩條測試自己的註解就寫著
   「這條守的是『絕對不可以是綠燈』,不是某一句特定的字」,所以改成斷言
   退出碼 1 + `SCANNER_BROKEN` + `gate=boundaries result=FAIL scanned=0`,
   比原本比對一個實作細節字串更貼近它的本意。

## 四、驗收數字

| 檢查 | 結果 |
|---|---|
| `boundaries` | 198 檔 / 11 例外 / 0 違規 · **exit 0** |
| `typecheck` | **exit 0**(HOTFIX 已刪) |
| `lint:docs` | 60 檔 / 20 連結 / 0 壞 · **exit 0** |
| `vitest run` | **1582 / 1582 passed**,81 檔全綠 |
| `check:steps` | 47 檔 / 1943 步驟句 / 0 重複定義 · **exit 0** |
| `accept:coverage` | 38 個 phase 檔全涵蓋 · **exit 0** |
| `standalone` | 14 條 · **exit 0** |
| `check:gherkin-dup` | 47 檔 / 495 場景 / **✓ 無重複** · **exit 0** |
| `accept:dry` | 502→**497** scenarios · undefined 157→**152**(減少) · **0 ambiguous** |
| `accept:standalone` | **158 / 158 passed(不變)** |
| `sync-gates.sh --check` | ❌ exit 1 —— 見迴歸一 |

### 消失的場景去哪了(工單要求逐一交代)

- **scenarios −5**:六份 `Every standalone entry point still runs` 移除,新增一份共用的 → 淨 −5。
  **覆蓋沒少**:上面的表證明六個 `@iN` 各自仍然選到它 1 次。
- **steps −30**:移掉的 6 個 pickle = 6×3 句場景步驟(18)+ 各自 Background(i1 3、i2 2、i3 3、
  i4 3、i5 2、i6 2 = 15)= 33;新檔 3 句(**沒有 Background**,因為那個步驟用 `cwd: ROOT`,
  跟任何 Background 都無關)。33 − 3 = **30**,與實測 2293→2263 完全對得上。
- **undefined −5**:同上五份複本的步驟本來就是 undefined(整合檔尚未實作),移除後自然減少。
  **沒有增加**,符合驗收。
- **`accept:standalone` 158 不變**:`@standalone` 只掛在 `features/*/phase-1.feature`,
  整合檔沒有這個 tag,所以這次收斂完全不碰它。

## 五、沒做的事

- **沒有加 `gherkinDup.allow` 條目** —— 因為用不到(見一之(B)(C))。
  `scripts/gates.config.json` 維持 `{"cucumberCwd": "."}`。
- **沒有 push**(工單要求 commit only)。
- **`sync-gates.sh --check` 沒有弄綠** —— 那需要模板出 1.3.4,不是本 repo 能單方面解的;
  硬弄綠只有兩條路(改我們測試檔的檔名去閃 glob、或給測試檔偽造 SOURCE 標頭),
  兩條都是為了讓守門閉嘴而扭曲專案,正是這張工單禁止的形狀。
