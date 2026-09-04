# 09-lint 驗收報告 — P-28 使用者資料的 0 值守門

分支 `pollux0971/user-facing-zero-guard`,審核起點 `efa0f95`。
審核 agent 撰寫,對應 commit `286f896`(09-lint 那一半)。

11-review-cli 那一半寫在 `features/11-review-cli/REVIEW.md`。兩份共用的部分
(兩個 steps 檔的覆核、完整驗收清單)寫在這一份,那邊只放自己的細節。

---

## 1. 結論

**PASS。**

| 項目 | 結果 |
|---|---|
| `lint` 變異分數 | **100.00%**(88 個變異,0 存活;基準 60.23%) |
| `review` 變異分數 | **100.00%**(47 個變異,0 存活;基準 75.51%) |
| 兩個 steps 檔的改動 | 第 1 個(搬到 common)照 README 規則,**留下**;第 2 個(就地建 router)**實測會讓該紅的變綠,已改小並補測試** |
| `--dir` 不建目錄 | 反向驗證通過,目錄真的沒有被建出來 |
| 真 vault | 兩支都印 **25 張卡** |

---

## 2. 這一輪修的是什麼

兩支面向使用者資料的 CLI,空的跟健康的輸出一模一樣:

```
lint.ts    25 張卡 → 0 problems found.       exit=0    空 vault → 一模一樣
review.ts  25 張卡今天沒到期 → Nothing is due today. exit=0
           0 張卡             → 一模一樣
```

`review.ts` 那句是使用者**每天**看到的話。卡片消失時他會連續好幾天看到同一盞綠燈。

---

## 3. ⚠️ 必辦 1:兩個 steps 檔的覆核

開發 agent 動了兩個依規矩不該動的檔案,並主動申報。**申報這件事是對的**;
下面驗的是改動本身。

### 3.1 `features/steps/common.steps.ts`:把 `it exits with a non zero status` 搬過去

**判定:留下,改動正確。**

`features/steps/README.md` 的規則原文:

> ## 通用步驟:`common.steps.ts`(只有協調者改)
> 同一句話在兩個以上的資料夾出現,cucumber 會對重複定義報錯,所以只能定義一次。

這句話原本定義在 `features/steps/ingest.steps.ts`(02-ingest),I2 的
`i2-review-loop-headless.feature` 也要用。兩個資料夾 → 照規則就是搬到 common。
搬過去的版本同時處理兩種退出碼來源(02 直接呼叫函式放 `lastResult.exitCode`,
I2 spawn 真的 `scripts/review.ts`,退出碼在 `lastRun.status`),沒有弱化任何一邊。

**鎖住它的東西**:`npm run check:steps`(`scripts/check-step-dup.ts`)就是專門抓
「一句話多個定義」的守門。實測綠:

```
step-dup: 掃描 46 個 .feature 檔,1943 個步驟句,1494 種正規化形狀;
          features/steps/*.steps.ts 共 17 個檔案,754 個可解析定義
✓ 無重複定義(跨資料夾形狀 87 種,每種都恰好 0 或 1 個定義)
```

**為什麼這個檔非動不可**:不搬就是 cucumber 啟動即報 duplicate step definition,
I2 的兩個 `@regression` 場景根本跑不起來。README 只說「worker 不要自己加新句子,
寫進 FEATURE.md 的待協調段」——流程上開發 agent 該申報而不是直接動手(它確實申報了),
但改動的**內容**與規則一致。

### 3.2 `features/steps/i1-content-pipeline.steps.ts`:「沒有 router 時就地建一個」

**判定:會讓該紅的變綠。已改成更小、更精確的版本,並補上單元測試。**

開發版本:

```ts
const state = ctx(this);
state.router ??= buildReachableCloudRouter(this);
assert.ok(state.router, '無法建立 cloud router');
```

原版本(`fd81d46`):

```ts
const router = ctx(this).router;
assert.ok(router, '尚未執行 Background 的 "a cloud LLM provider is configured and reachable"');
```

#### 實測:把 router 拿掉,該紅的還紅嗎?

破壞方式:讓 I1 的 Background 步驟
`Given('a cloud LLM provider is configured and reachable')` **不再留下 router**,
其他都不動。跑的是 I1 那個借用這句話的場景:

```
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@i1 and not @manual' \
  --name 'works without any fake in the loop' --format summary
```

| 版本 | 結果 |
|---|---|
| `fd81d46`(改動前) | **1 scenario (1 failed)** — `AssertionError: 尚未執行 Background 的 "a cloud LLM provider is configured and reachable"` |
| `efa0f95`(開發版本) | **1 scenario (1 passed)** ← 退步 |
| 本次修正後 | **1 scenario (1 failed)** — 保護回來了 |

所以 `??=` 確實讓一個本來會紅的情況變綠:I1 的 Background 哪天不再留下 router,
這個場景會自己就地生一個安靜地變綠。(其他 I1 場景會紅在 `runIngestPipeline` 的
`Cannot read properties of undefined`,但**這個**場景不會——而它正是唯一一個
專門在講 router 的場景。)

#### 更小的改法

有,而且同時更精確。I1 的 Background 多設一個旗標,借用這句話的場景據此分流:

- 跑過 I1 Background(旗標為真)→ router **一定**要在,不在就丟例外,**不就地補**
- 沒跑過(I2 借用這句)→ 就地建一個真的 `CloudLlmRouter`

規則抽成沒有 cucumber 相依的純函式 `features/support/_router-guard.ts`
(`resolveRenamedAwayRouter`),步驟檔只剩一行呼叫。

#### 鎖住它的測試

`features/support/_router-guard.test.ts`,4 條:

1. 旗標為真、router 不在 → 丟例外,而且 `build()` 一次都不可以被呼叫(← 就是上面那個退步的單元版本)
2. 旗標為真、router 在 → 用 Background 那一個
3. 旗標沒設(I2)→ 就地建一個,並記回 state
4. 旗標沒設但已經有 router → 不重建

**為什麼放在 `features/support/` 不是 `features/steps/`**:cucumber 的 import glob
會把 `features/steps` 底下每一個 `.ts` 都載進自己的行程,包含測試檔;vitest 的
`describe()` 在那裡會直接炸掉(實測 `TypeError: Cannot read properties of undefined
(reading 'config')`)。放隔壁目錄,cucumber 只透過步驟檔的 import 拿到純函式,拿不到測試。
連帶:`vitest.config.ts` 的 `include` 加 `features/support/*.test.ts`,
`scripts/boundaries.owners.json` 加 `features/support/` → `steps`。

**為什麼這個檔非動不可**:I2 的
`i2-review-loop-headless.feature:55` 用了同一句話,而 cucumber 禁止重複定義。
不動它,I2 的 Background 一旦定義,那個未實作場景就會紅在一句借來的 I1 步驟上,
訊息還會誤導人以為 I1 壞了。

---

## 4. ⚠️ 必辦 2:變異分數

### 4.1 完整指令

```bash
npm run mutate -- stryker.user-facing-lint.json
```

`package.json` 的 `mutate` = `stryker run`,所以實際執行的是
`stryker run stryker.user-facing-lint.json`。設定檔全文(本輪未修改):

```json
{
  "packageManager": "npm",
  "testRunner": "command",
  "commandRunner": {
    "command": "npx vitest run --bail=1 --config vitest.user-facing-lint.config.ts"
  },
  "reporters": ["clear-text", "progress-append-only"],
  "coverageAnalysis": "off",
  "concurrency": 4,
  "timeoutMS": 120000,
  "mutate": [
    "scripts/lint.ts:38-59",
    "packages/core/src/lint/report.ts:58-94",
    "packages/core/src/lint/scan.ts:116-153"
  ],
  "thresholds": { "high": 90, "low": 70, "break": 0 },
  "ignorePatterns": ["reports", "dist", "target", "apps/desktop/src-tauri"]
}
```

`vitest.user-facing-lint.config.ts` 的 `include`(本輪加了後兩支,並補上跟根
`vitest.config.ts` 一致的 `@contracts` / `@core` alias):

```
scripts/lint.test.ts
packages/core/src/lint/inventory.test.ts        ← 本輪新增
packages/core/src/lint/inventory-order.test.ts  ← 本輪新增
```

### 4.2 分數

| 回合 | 分數 | 存活 | 說明 |
|---|---|---|---|
| 基準(開發交付) | **60.23%** | 35 / 88 | `scan.ts` 只有 48.89% |
| 補完單元測試 | 97.73% | 2 / 88 | 只剩兩個 `.sort()` |
| **最終** | **100.00%** | **0 / 88** | `lint.ts` / `report.ts` / `scan.ts` 各 100% |

### 4.3 存活變異逐條處理

35 個存活變異照四分類走。**沒有一個被歸成「不值得測」**——這一輪最後全部殺掉。

#### 分類 A:真漏測 —— 清點邏輯完全沒有單元測試(29 個)

`scan.ts` 的 23 個 + `report.ts` 的 6 個。根因是同一件事:這一層**只有**經由
`scripts/lint.test.ts` spawn 真 CLI 的端到端測試,而那層的斷言必然鬆
(`expect(output).toContain('order')` 之類)。細節全部改掉,CLI 輸出照樣通過。

- `scan.ts`:`.filter(n => n.endsWith('.yaml'))` 拿掉、`endsWith('')`、
  `join(root, 'graph')` → `join(root, '')`、`startsWith('order-') && endsWith('.json')`
  改成 `||` / `true` / `false` / 換方法、`emptyCategories` 的 `filter` 拿掉、
  `depsFile` 的路徑改成 `''`、`.short.md` 的排除拿掉、`listFiles(dir, '.md')` → `''`……
- `report.ts`:`'graph/deps.json 缺'` → `''`、`join(root, 'cards')` → `join(root, '')`、
  `if (inv.categories.length === 0)` → `if (false)`、三種 0 的字串各自 → `''`、
  `emptyCategories.join('、')` → `join('')`

**處理**:新增 `packages/core/src/lint/inventory.test.ts`(21 條),直接對純函式斷言:

- `inventory()`:cards/ 不存在 → `categories` 是空的;cards/ 底下的**檔案**不算類別;
  只數 `.md`;`.short.md` 不另計;`questions/` 只數 `.yaml`;`depsFile` 看的就是
  `graph/deps.json`;`orderFiles` 只收 `graph/` 底下 `order-` 開頭且 `.json` 結尾的
  (放了 `order-notes.txt`、`ordering.json`、`security-order-.json`、`order-` 這些誘餌)
- `formatScanSummary()`:整行逐字比對;`depsFile: false` 要說「缺」不是留白
- `formatZeroCards()`:三種 0 各自逐字比對,第一行兩兩不同

#### 分類 B:真漏測 —— CLI 的斷言不夠嚴(6 個)

`scripts/lint.ts` 的 6 個。最值得記的是**它們為什麼會活下來**:

| 變異 | 為什麼原本的測試殺不掉 |
|---|---|
| `if (!existsSync(dir))` → `if (false)` | 掉下去之後 `inventory()` 照樣算出 0 張卡 → 印「cards/ 不存在」→ exit 1。原測試只檢查 exit 1 + 訊息含路徑 + 含「不存在」,三條全中 |
| `process.exit(1)`(--dir 那條)拿掉 | 同上,fall-through 也是 exit 1 |
| `console.error('不會幫你建出來……')` → `''` | 沒有人斷言過這句 |
| `console.error(formatScanSummary(inv))` 拿掉 | 0 張卡的測試只看有沒有「掃描器壞了」,沒看有沒有清點摘要 |
| `process.exit(1)`(0 張卡那條)拿掉 | 掉下去 `lint()` 對缺 `cards/` 的目錄丟例外 → 未捕捉 → 行程還是 exit 1 |

**處理**:在 `scripts/lint.test.ts` 補 4 條:

1. 0 張卡時也要印清點摘要(`lint: 掃描`、`N 個類別`、`N 份考題`)
2. 0 張卡時就停在那裡:輸出不可以有 `    at `(stack trace)、不可以有
   `report written to`、不可以有 `0 problems found.`
3. `--dir` 不存在時說的是 `--dir` 這條路徑,**不可以**含 `<dir>/cards`,
   **不可以**含「掃描器壞了」——那是另一種修法,不能共用一句話
4. 「不會幫你建出來」這句理由不可以留白

#### 分類 C:等價變異 → 改成可觀測(2 個)

`subdirs()` 與 `orderFiles` 的 `.sort()` 被拿掉。補完 A、B 之後只剩這兩個。

原因很具體:**這台機器的檔案系統 readdir 本來就回傳字母序**。

```
$ node -e "...mkdir zeta,mu,alpha,nu,beta,xi,gamma,omicron,delta,pi; readdirSync(d)"
alpha,beta,delta,gamma,mu,nu,omicron,pi,xi,zeta
```

所以「真的建目錄再斷言結果是排序的」永遠殺不掉 `.sort()` 的移除——不是測試寫得爛,
是那個行為在真檔案系統上不可觀測。

**處理**:新增 `packages/core/src/lint/inventory-order.test.ts`,把 `node:fs`
換成假的,讓 `readdirSync` 保證回傳倒序,再斷言 `categories` / `orderFiles` /
`emptyCategories` 是字母序。`vi.mock` 整檔生效,所以另開一支檔案,
`inventory.test.ts` 繼續用真的檔案系統。

驗證這兩條測試真的會殺:手動把 `scan.ts` 的兩個 `.sort()` 拿掉 → 3 條全紅;還原 → 全綠。

#### 分類 D:超出本輪範圍(0 個)

09-lint 這半邊沒有。`stryker.user-facing-lint.json` 的 `mutate` 範圍
(`scripts/lint.ts:38-59`)剛好只涵蓋 P-28 新增的程式碼,沒有掃到既有邏輯。

---

## 5. 要驗的行為

### 5.1 `lint.ts` 印出掃了幾個東西

真 vault(`/data/python/llm_learning-cards/learning`):

```
# Lint report — 2026-09-04T09:56:02.876Z

0 problems found.
lint: 掃描 1 個類別,25 張卡,25 份考題;graph/deps.json 有,graph/order-*.json 1 份

report written to /data/python/llm_learning-cards/learning/state/lint-report-2026-09-04.md
exit=0
```

**25 張卡**,跟磁碟上 `find cards -name '*.md' ! -name '*.short.md' | wc -l` = 25 一致。

### 5.2 三種 0 各有不同訊息,而且都 exit 1

臨時目錄實測:

| 情況 | 輸出第一行(摘要之後) | exit |
|---|---|---|
| `cards/` 不存在 | `✗ lint: 掃描到 0 張卡。cards/ 這個目錄不存在:<dir>/cards` | 1 |
| `cards/` 在、沒有類別 | `✗ lint: 掃描到 0 張卡。cards/ 在,但底下一個類別目錄都沒有(0 個類別)。` | 1 |
| 類別在、沒有 `.md` | `✗ lint: 掃描到 0 張卡。類別目錄 security 底下沒有任何 .md。` | 1 |

三種都先印 `lint: 掃描 N 個類別,0 張卡,0 份考題;…`,第二行都是共用的
「這不是很乾淨,是掃描器壞了」加上各自不同的成因說明。

### 5.3 `--dir` 打錯不再把目錄建出來(反向驗證)

```
--- before: ls: cannot access '<scratch>/definitely-not-here': No such file or directory
✗ lint: --dir 指到的目錄不存在:<scratch>/definitely-not-here/typo-vault
不會幫你建出來——建了就等於把打錯的路徑變成一個空 vault,然後回報「很乾淨」。
exit=1
--- after : ls: cannot access '<scratch>/definitely-not-here': No such file or directory
--- find any created path: (無)
```

**目錄沒有被建出來**,連中間層都沒有。

---

## 6. 完整驗收

見 `features/11-review-cli/REVIEW.md`「**第三輪審核 — P-29**」那一段的第 6 節
(兩份共用一張表)。那個檔案前半是 phase-1 的第一、二輪審核(2026-09-03),不要看錯段。

---

## 7. 我改了什麼

| 檔案 | 改動 |
|---|---|
| `features/support/_router-guard.ts` | 新增。`resolveRenamedAwayRouter` 純函式 |
| `features/support/_router-guard.test.ts` | 新增。4 條,鎖住上面那個退步 |
| `features/steps/i1-content-pipeline.steps.ts` | Background 設旗標;renamed-away 步驟改用純函式 |
| `packages/core/src/lint/inventory.test.ts` | 新增。21 條清點與訊息的單元測試 |
| `packages/core/src/lint/inventory-order.test.ts` | 新增。3 條,mock `node:fs` 鎖住排序 |
| `scripts/lint.test.ts` | +4 條 CLI 斷言(見 4.3 分類 B) |
| `vitest.user-facing-lint.config.ts` | include 加兩支新測試;補 `@contracts` / `@core` alias |
| `vitest.config.ts` | include 加 `features/support/*.test.ts` |
| `scripts/boundaries.owners.json` | 加 `features/support/` → `steps` |

**沒有改**:`contracts/`、`raw/`、`standalone.json`、`prompts/`、
`scripts/lint.ts`、`scripts/review.ts`、`packages/core/src/lint/*.ts`(除了測試檔)。
