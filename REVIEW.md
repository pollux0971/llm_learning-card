# 採用模板 v1.4.1 → v1.4.2 — 交接

分支 `pollux0971/template-141`,基底 `1e3b7a8`(main 之後只多一個 `c60173f`,只動 `scripts/degraded-report.ts`,不衝突)。
模板來源:先 tag `template/v1.4.1` = `ff7f64b`,再依協調者的 B2 決定升到 `template/v1.4.2` = `1c1d403`(模板為本 repo 的 P-83 出的修補版)。

**commit 切法**(依協調者要求,基準變動獨立):`f9ba3fa` 1.4.1 實作 → `d8d4a5c` zero-input 基準 66→48(只動基準檔)→ `4a239e2` 升 1.4.2 + phase-status 接線 → 最後一個 commit 是本檔的收尾。

## 一、結論先講

- 守門同步到 **v1.4.2 (1c1d403)**,20 支 `.ts` 全部帶 SOURCE 標頭;`check:gates` 綠(含接線檢查)。對 `scripts/` grep 那句可照抄的 Stryker CLI 指令(協調者要的那條 grep)→ **0 命中**,grep exit 1(1.4.1 時 1 處:`check-doc-rot.test.ts:432`)。
- `check:all` 一個指令跑完整鏈,chain **14 步**(§2.1 現有 11 步 + `check:doc-rot` + `check:next-gates` + `check:phase-status`;`check:known-defects` 走 `unwired`)。
- `check:phase-status`(1.4.2 新守門)report 模式,對本 repo:12 份 FEATURE.md / 38 列,**PASS,沒有漂移**。照 P-71 維持 report,不切 enforce。
- `check:next-gates`:report 模式 PASS scanned=12 → 已切 **enforce**,仍 PASS。
- `check:doc-rot`:只命中 **1 處**(`CLAUDE.md:77`,使用者的檔,照指示不動)→ **仍是 report**,沒清完不切 enforce。
- `check:doc-links`:18 處 `file:line` 全部拿掉行號(路徑本身都還存在,沒有一處需要改路徑)→ PASS。
- boundaries:1.4.1 時量到 **242 / 242**(工單寫 222);1.4.2 多兩檔 → **244 / 244**,基準寫 244。
- 三條反向驗證都實際做過、都紅(輸出見 §四)。
- **還剩 2 條紅**,都是同一個模板缺陷(§二.9),等協調者決定;其餘全綠。全鏈與 junit 對帳見 §六。

## 二、工單沒預料到、需要協調者知道的事

### 1. `sync-gates.sh` 的 glob `check-*.ts` 會蓋掉本 repo 自己的三支測試檔(資料流失陷阱)

`scripts/check-boundaries.test.ts`(224 行)、`check-doc-links.test.ts`(839 行)、`check-standalone.test.ts`(186 行)
是本 repo 自己寫的(P-28 審核輪補到 53 條、變異測過),**沒有 SOURCE 標頭**。1.3.x 模板不出貨 `.test.ts`,
所以以前 sync 不會碰它們;**1.4.x 模板開始出貨同名的 `check-*.test.ts`**,sync 的複製迴圈
`for src in $TEMPLATE_DIR/scripts/check-*.ts` 就把它們覆蓋掉了,而且 sync 一句話都不會講。

處置(協調者已同意,選項 B):
- 模板版留原名(`check-X.test.ts`,帶 SOURCE 標頭,受 `--check` 保護)。
- 本 repo 版從 `HEAD` 還原成 **`check-X.local.test.ts`**(sync 只複製模板有的檔名、`--prune` 只刪有標頭的檔,所以這個名字安全)。
- `scripts/boundaries.owners.json` 加了 11 筆(8 支新模板檔 + 3 支 `.local`),`vitest.scanner-{boundaries,doclinks,standalone}.config.ts`
  的 `include` 改成兩份都跑(Stryker 對掃描器變異時兩組測試都算)。

**建議回流模板**:sync 複製前若目標同名檔存在且**沒有** SOURCE 標頭,應該拒絕或改名備份,不要靜默覆蓋。
這是範式級的坑(PITFALLS 候選),不是本 repo 特有。

### 2. `.local` 測試對 1.4.1 有 5 條訊息形狀的假紅,已最小幅度改斷言(協調者同意,選項 X)

退出碼與 `gate=… result=FAIL` 標記全部仍正確,只有字串漂移:
- `check-doc-links.local.test.ts` ×3:排除清單那一行從 1.3.x 的 7 項順序改成 S10 共用 `DEFAULT_SKIP_DIRS` 的 18 項;`SKIP_LINE` 常數跟著改。
- `check-boundaries.local.test.ts` ×2:`--root` 明講時,1.4.1 S14(P-73)不再退回腳本自身目錄讀本 repo 的 owners.json,
  紅的位置從「掃描到 0 個檔案」變成「設定檔未找到於 …」。斷言改成含 `設定檔未找到於`,其餘(exit 1、FAIL scanned=0、不准有 ✓)不動。
  註解寫明版本沿革。
- 跟 1.3.2 採用時的「跟進的兩處測試改動」是同一種性質(見 `docs/reviews/gherkin-dup-and-template-132.md`)。

### 3. pre-commit hook **沒有裝**(協調者同意,選項 Q)

- 這個 worktree 的 `.git` 是檔案;hooks 目錄是主簽出共用的 `/data/python/llm_learning-cards/.git/hooks`(目前只有 sample)。
  工單那行 `cp … .git/hooks/pre-commit` 在 worktree 裡會直接失敗。
- 交互作用:hook 用 `git rev-parse --show-toplevel` 找 `.stryker.lock`,鎖在**主根**;而 `npm test` 全套現在也拿這把鎖。
  裝進共用 hooks 之後,**任何 worktree 跑全套期間,主簽出拒絕 commit(包含協調者的合併 commit)**,worktree 內 commit 反而不受影響。
  協調者另開工單處理,不進這輪。
- 裝法(含 worktree 正確路徑)已寫進 `README.md`「clone 完不會自動有的三樣東西」。
- `check:gates` 印的 `○ pre-commit hook 未安裝` 是資訊行,不算失敗;它看的是 `$TARGET/.git/hooks/pre-commit`,在 worktree 永遠印未安裝。

### 4. 工單裡的三個數字跟我量到的不同

| 項目 | 工單 | 實測 | 說明 |
|---|---|---|---|
| doc-rot 命中 | 3 處(2 在 SKILL.md) | **1 處**(`CLAUDE.md:77`) | 本分支與 `main` 的 SKILL.md 都 grep 不到三條黑名單 pattern,主簽出的工作檔也沒有 |
| boundaries 涵蓋 | 222 / 222 | **242 / 242** | 含這次新增的 11 檔;新增前是 231,也不是 222 |
| next-gates | PASS scanned=12 | PASS scanned=12 | 一致 |

### 5. 模板 worktree HEAD 不是 v1.4.1

`$TEMPLATE_DIR`(`agent-a551c3d51889a2793`)HEAD 是 `1c838e6`「template 1.4.2 (draft)」,比 tag 多了
`check-phase-status.ts`/`.test.ts` 與 `_root.ts` 的 `phaseStatus` 鍵。直接從那裡 sync 會裝到 1.4.2 草稿。
我用 `git worktree add --detach <scratch> ff7f64b` 開了一個暫時簽出、以它當 `TEMPLATE_DIR` 做 sync,
標頭因此正確寫 `template v1.4.1 (ff7f64b)`。`--check` 是自包含的(只讀已裝檔案的標頭雜湊),之後用任何 `TEMPLATE_DIR` 跑 `check:gates` 結果一樣。
暫時簽出已移除。**協調者之後若從 1.4.2 草稿 sync,要知道會多一支 `check-phase-status.ts` 需要接線或 unwired。**

### 6. worktree 起手的第三樣缺的東西:`learning/`

`learning/` 是使用者的資料 repo(契約 §11b,gitignored),worktree 沒有 → `llm-spend --today` 讀不到
`learning/state/log.jsonl`,**即使三個環境變數都設了也回 2**。我建了 `learning/state/` 目錄並把
`log.jsonl` 用 symlink 指到主簽出那份(目錄名 `learning/` 被 `.gitignore` 蓋住,`git status` 乾淨)。
`.env` 也建在 worktree(gitignored)。建議下次派工說明把這個加進「clone 完不會自動有」清單。

### 7. `zero-input-guard.test.ts`(本 repo 的零輸入守門)對 1.4.1 的兩種反應

- **18 筆棘輪基準「已修好」**:1.4.1 的 S9(設定壞掉大聲失敗)把 boundaries / doc-links / gherkin-dup / phase-coverage /
  standalone 在「設定檔是壞 JSON / 型別錯 / 不存在」時的裸 stack、同 healthy、exit 0 都修掉了。測試明講「從基準移除、max 改小」,
  已從 `scripts/zero-input-guard.baseline.json` 拿掉 18 筆,`max` 66 → 48(那是設定檔)。**這是 1.4.1 真的還了 18 筆債。**
- **ROSTER 完整性**:4 支新入口(`check-all` / `check-doc-rot` / `check-known-defects` / `check-next-gates`)不在清單 → 紅。
  已各補一筆宣告式 entry(healthy 基線 + 四種探針),照 `check-gherkin-dup` 的形狀;1.4.2 後再補第 5 支 `check-phase-status`。
  `check-all` / `check-doc-rot` / `check-known-defects` / `check-phase-status` 的健康基線用 `--root` 指到假 consumer(對本 repo 跑分別是
  「跑整條鏈」「掃 500 檔且 CLAUDE.md 有命中」「0 目標例外 exit 1」「對 38 個 done phase 真起 cucumber」,都不是健康路徑)。
  結果:5 個 healthy 基線全過;20 個探針 18 全過、2 個只差「指名路徑」一項(§二.9)。**沒有新增任何基準條目,`max` 沒有因新入口變大。**

### 8. `mutate.test.ts`「文件裡不准出現繞過鎖的指令」撞到模板的測試資料

`scripts/mutate.test.ts` 會 grep 全 repo 所有文字檔,禁止字面的 Stryker CLI 子指令(明講不開例外)。1.4.1 進來兩處命中:
- `scripts/doc-rot.blacklist.json`(本 repo 的設定):那條規則的 `pattern` 與 `reason` 是字面寫法。已改成
  `npx\s+stryker\s+run`、`reason` 改寫、加 `note` 說明理由;`--self-test` 3/3 仍命中。
- `scripts/check-doc-rot.test.ts:432`(**模板檔**,SOURCE 標頭,不能改):測試資料裡的字面規則。
  **協調者決 B2、拒絕 B1**(「來源可查 ≠ 內容可信」,SOURCE 豁免等於幫整個目錄開後門)。模板出 **1.4.2**:fixture 改 `['npx','stryker','run'].join(' ')`、黑名單改 `\s+` regex、新增 `no-bypass-literal.test.ts`(PITFALLS P-83)。本 repo 重 sync 到 1.4.2 後 `mutate.test.ts` 150/150 綠。

### 9. 兩個探針不過:`check-next-gates` / `check-phase-status` 對不存在的 `--root` 不指名路徑(**等你決定,沒塞進基準**)

zero-input ROSTER 補的 5 支新入口 × 4 種探針 = 20 個探針,每個探針有「退出碼非 0 / 不噴裸 stack / 跟 healthy 不同 / 指名路徑(有給 mention 才比)」幾項檢查。
**18 個探針全項通過;2 個探針只有「指名有問題的那條路徑」那一項不過**,形狀一模一樣:

```
$ npx tsx scripts/check-next-gates.ts --root /tmp/definitely-not-here
✗ next-gates: 掃到 0 份 NEXT.md
這不是很乾淨,是掃描器壞了。features/ 底下沒有任何 NN-name 資料夾有 NEXT.md,或 --root 指錯路徑時就長這樣。
gate=next-gates result=FAIL scanned=0

$ npx tsx scripts/check-phase-status.ts --root /tmp/definitely-not-here
✗ 掃到 0 份 FEATURE.md。這不是很乾淨,是掃描器壞了。
gate=phase-status result=FAIL scanned=0
```

對照同一批裡有做對的兩支(`check-doc-rot`、`check-all`):
```
✗ 設定檔未找到於 /tmp/definitely-not-here/scripts/doc-rot.blacklist.json(--root 明講時不退回腳本自身目錄;要指定別處請設 GATES_CONFIG_DIR)
```

ADR-045 鎖 1:新入口必須先達標才進 main,基準只收守門誕生前的洞、`max` 不准變大——所以這 2 條**沒有**進基準,
探針也**沒有**拿掉 `mention` 來放寬(我一開始對 next-gates 那條拿掉過,已還原成誠實的紅)。兩條路都要你講:
- (i) **回流模板**:兩支對 `--root` 明講且目錄不存在時,像 doc-rot / check-all 一樣印出那條路徑(1.4.3)。本 repo 等新版再 sync。
- (ii) 判定「0 份 + 『--root 指錯路徑時就長這樣』」已足夠指名問題 → 探針不填 `mention`(那項檢查會 skip)。
我的傾向是 (i):其餘三支都指名,這兩支不指名是不一致,不是設計。

`check:all` 的 `test` 步因此仍紅(就這 2 條)。其餘 13 步全綠。

## 三、做了什麼(照工單順序)

1. sync:`sync-gates.sh <root> scripts --lang ts --prune`,選集 ts,18 支守門 + `hooks/pre-commit` + 兩個新設定檔(`doc-rot.blacklist.json`、`known-defects.json`,佔位版)。`scripts/py` 本來就不存在。
2. `package.json` 加 sync 印出的四行(`check:all`、`check:doc-rot`、`check:next-gates`、`check:known-defects`)。
3. `scripts/gates.config.json`:`chain`(§2.1 現有順序 11 步 + `check:doc-rot` + `check:next-gates`)、`nextGates.mode`、`docRot.mode`、`unwired`。鍵都對過 `KNOWN_GATES_CONFIG_KEYS`。
4. `check:gates` 綠;`check:all` 可跑。**`check:all` 沒有取鎖**,鎖只在 `npm test` 裡。
5. doc-rot 逐條:1 處,`CLAUDE.md:77` → 留給技術顧問問使用者。`docRot.mode` 維持 report。
6. doc-links 18 處逐處拿掉行號(清單見 git diff,9 個檔;`features/03-llm-router/REVIEW.md` 裡三個是 `ingest/…`、`adapters/…` 的簡寫路徑,拿掉行號後不再是路徑參照,文字照舊)。
7. next-gates:report PASS 12 → 切 enforce → PASS 12。
8. boundaries:先量(231 → 加 11 檔後 242/242 100%),`coverageBaseline: {managed: 242, scanned: 242}`。
9. hook:不裝(§二.3),README 寫落地步驟。
10. 驗收:§四、§五、§六。
11. **升 1.4.2**(協調者 B2):重 sync 20 支;`package.json` 加 `check:phase-status`;`gates.config.json` 加 `phaseStatus.mode=report`、chain 第 14 步;owners 加 2 檔、基準 244;ROSTER 加第 5 支。`doc-rot.blacklist.json` 是 copy-once,1.4.2 升級指南要手改的那一筆我在 1.4.1 時就已改成 `\s+` 寫法。

`{{PARALLEL_CAP}}` = 3(SKILL.md 由協調者改)。`CLAUDE.md`、`.claude/skills/` 都沒動。

## 四、三條反向驗證的實際輸出(做完都還原了,`check:gates` 重跑綠)

(1) 弄壞一支守門(`echo "// tamper" >> scripts/check-step-dup.ts`)→ `npm run check:gates`:
```
✗ check-step-dup.ts 內容被改過(sha256 不符;急修請在第 2 行加 HOTFIX 註解:<日期> <理由>)
exit=1
```
還原後 exit=0。

(2) `chain` 開頭放 `no-such-script-xyz` → `npm run check:all -- --fail-fast`:
```
✗ no-such-script-xyz 不是 npm script(P-55)
gate=all result=FAIL scanned=14
exit=1
```

(3) `gates.config.json` 放未知鍵 `chian` → `check:next-gates` 與 `boundaries` 都紅:
```
✗ 設定檔有不認識的鍵:chian(打錯字?)已知鍵:cucumberCwd, phaseCoverage, docLinks, gherkinDup, sync, chain, unwired, nextGates, skipDirs, docRot, knownDefects(…/scripts/gates.config.json)
gate=next-gates result=FAIL scanned=0
next-gates exit=1
gate=boundaries result=FAIL scanned=0
boundaries exit=1
```

## 五、五條斷言的改動(逐條:舊 / 新 / 為什麼是措辭 / 破壞驗證)

| # | 檔 · 測試 | 舊字串 | 新字串 | 為什麼是措辭不是行為 | 破壞驗證(弄壞守門 → 仍紅) |
|---|---|---|---|---|---|
| 1 | `check-doc-links.local.test.ts` · 全綠 | `SKIP_LINE` = `排除片段 [node_modules, .stryker-tmp, dist, .git, target, .svelte-kit, archive]` | `排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, __pycache__, .venv, venv, reports, .stryker-tmp, archive]` | 1.4.0 S10 把各掃描器自己的略過清單換成 `_root.ts` 共用的 `DEFAULT_SKIP_DIRS`;列表內容與順序變,exit 0 / ✓ / gate 標記全部不變 | 第 537 行 `✓ 無壞掉的連結` 多一個字 → **1 failed**(就是這條) |
| 2 | 同檔 · 有壞連結 | 同上 `SKIP_LINE` | 同上 | 同上;`✗ N 條連結指到不存在的檔案` 與「怎麼修」那行都沒動 | 第 530 行 ✗ 標題多一個字 → **1 failed**(就是這條) |
| 3 | 同檔 · 0 條連結 | 同上 `SKIP_LINE` | 同上 | 同上;`掃描器壞了` 那行、exit 1、`scanned=0` 都沒動 | 第 524 行 `code: 1` → `code: 0`(0 條連結時放行)→ **7 failed**,含這條 |
| 4 | `check-boundaries.local.test.ts` · --root 指到不存在的目錄 | `expect(output).toContain(SCANNER_BROKEN)`(`這不是很乾淨,是掃描器壞了`) | `expect(output).toContain('設定檔未找到於')` | 1.4.1 S14(P-73):`--root` 明講時不再退回腳本自身目錄讀本 repo 的 owners.json,紅的位置從「掃描到 0 個檔案」變成「設定檔未找到於 …」。exit 1、`gate=boundaries result=FAIL scanned=0`、`not.toContain('✓ 無違規')` 三條原斷言都留著 | 第 153 行 `if (found.hardErrorMessage) configError(...)` 改成不呼叫 → **2 failed**(這條與 #5) |
| 5 | 同檔 · root 存在但沒有 owners.json | 同 #4 | 同 #4 | 同 #4 | 同 #4 |

破壞後全部 `git checkout` 還原,`git status` 乾淨,`check:gates` 0 個 ✗。

## 六、全鏈與 junit 對帳(1.4.2 最終狀態)

### `npm test` 全套(最後一次,commit `ad76bf3` 的樹)

```
Test Files  1 failed | 104 passed (105)
     Tests  2 failed | 2770 passed | 138 skipped (2910)
FAIL scripts/zero-input-guard.test.ts > check-next-gates   > [missing] --root 不存在:指名有問題的那條路徑
FAIL scripts/zero-input-guard.test.ts > check-phase-status > [missing] --root 不存在:指名有問題的那條路徑
```
**只剩 §二.9 那 2 條**。`mutate.test.ts` 150/150(1.4.2 拆掉字面之後;中途我自己在 REVIEW.md 引了那句 grep 又被它抓到一次,已改寫)。

### `npm run check:all`(1.4.2,14 步)

```
✓ boundaries
✓ typecheck
✓ lint:docs
✗ test (exit 1)          ← 只有 §二.9 的 2 條探針
✓ accept:standalone
✓ standalone
✓ accept:dry
✓ check:steps
✓ check:gherkin-dup
✓ accept:coverage
✓ check:gates
✓ check:doc-rot          (report:CLAUDE.md:77 那 1 處仍在,使用者的檔)
✓ check:next-gates       (enforce)
✓ check:phase-status     (report,PASS 38 列)
gate=all result=FAIL scanned=14
```

### junit 對帳(名稱 multiset,基準 = main 的 `reports/junit/def8b04.xml`,本分支 = `reports/junit/branch-142b.xml`)

```
baseline total=2689 distinct=2680 ; branch total=2910 distinct=2901
same-name duplicates: baseline=9 branch=9
removed (in baseline, not in branch): 18
added (in branch, not in baseline): 239
```
- **「消失」的 18 筆不是消失,是改名**:就是從基準移除的那 18 條——它們的 testcase 名稱原本帶後綴
  `〔基準 since 2026-09-05,預期仍紅〕`,拿出基準後後綴消失,所以舊名少 18、新名多 18(在 239 裡)。零筆真的不見。
- 239 筆新增 = 模板 9 支 `check-*.test.ts`(check-all 11、boundaries 26、doc-links 6、doc-rot 27、known-defects 14、
  next-gates 17、phase-status 21、standalone 14 = 136)+ zero-input 新 ROSTER 5 支(5 healthy + 20 探針 × 4 項 = 85)+ 上述改名 18。
- `.local` 三支 85 條名稱不變,不算新增也不算消失。同名 testcase 兩邊都是 **9**(工單說 8,多的那 1 筆基準就有)。

### 交件狀態

- 14 步裡 13 步綠;`test` 紅在且只在 §二.9 的 2 條探針,兩條都是同一個模板缺陷,等協調者決 (i) 回流 / (ii) 探針不填 mention。
- 依協調者要求的三樣:20 個探針結果見 §二.7 / §二.9;`max` 66→48 的獨立 commit = `d8d4a5c`;
  重 sync 後對 `scripts/` grep 那句可照抄的 Stryker CLI 指令 = **0 命中(grep exit 1)**。
