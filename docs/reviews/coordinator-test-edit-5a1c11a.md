# 覆核:協調者為修 main 紅燈而動的 `scripts/mutate.test.ts`(commit `5a1c11a`)

branch `pollux0971/coordinator-test-edit-review` · base `main`(`e961543`)· 覆核對象 commit `5a1c11a`
(協調者依 §4「完整檢查在 main 上紅 → 先修 main」自己改了測試,依規則事後覆核。)

**結論:三處之中,(1) 測試錯但理由寫錯、(2) 放寬 → 退回並改寫、(3) 文件錯測試對。
核心保證沒有被拿掉;放寬的那一條已換成不依賴「現在跑在哪」的寫法。**

| # | 改動 | 判定 | 退回? |
|---|---|---|---|
| 1 | `SKIP_DIRS` 加 `'worktrees'` | **測試錯**(掃描範圍錯),但協調者給的理由不成立 | 改寫法,不退回結論 |
| 2 | 鎖路徑斷言改成「只在 worktree 裡才斷言不相等」 | **放寬** | **退回**,已改寫 |
| 3 | 兩份文件改寫 Stryker CLI 的提法 | **文件錯,測試對**(三選一裡最接近「實作錯」) | 不退回 |

---

## 一、`SKIP_DIRS` 加 `'worktrees'` —— 測試錯,但理由寫錯

### 協調者的說法【推】

「`.claude/worktrees/` 底下是**別的 repo 的簽出**(模板 repo),跟 `node_modules` 同一類;而且我們也改不動它(那些檔有版本標頭)。」

### 驗證【驗】

**不是別的 repo。** 那是**本 repo 自己的一個 worktree**,掛在別的分支上:

```
$ git worktree list
/data/python/llm_learning-cards                                             e961543 [main]
/data/python/llm_learning-cards/.claude/worktrees/agent-a551c3d51889a2793   02a3b8e [worktree-agent-a551c3d51889a2793]
...
$ cat /data/python/llm_learning-cards/.claude/worktrees/agent-a551c3d51889a2793/.git
gitdir: /data/python/llm_learning-cards/.git/worktrees/agent-a551c3d51889a2793
$ git -C .../agent-a551c3d51889a2793 rev-parse --git-common-dir
/data/python/llm_learning-cards/.git
$ git merge-base 02a3b8e main → 8a5d214;main..02a3b8e 有 67 個 commit
```

它的 remote 就是我們的 `origin`,裡面有我們的 `contracts/`、`features/`、`.claude/skills/`,
只是**停在 mutate-lock 之前的舊 main**(沒有 `scripts/mutate.ts`),再加上 `template/`。
所以它掃出來的 12 條違規,一半是**我們自己檔案的舊版本**(`package.json` 的 `"mutate": ...`、
`.claude/skills/mutation-testing/SKILL.md` 三行、`phase-acceptance/SKILL.md` 一行),
另一半是 `template/` 底下的複本。「有版本標頭改不動」只對 `template/` 那一半成立。

**結論還是對的**:巢狀簽出是另一棵樹,不是我們現在這一份;它裡面的違規要等那個分支
合併時由這條守門在**那棵樹上**抓,現在掃到只是把別的分支的舊檔算在自己頭上。
跟 `node_modules` 同一類 —— 這句成立,理由是「另一棵樹」,不是「別的 repo」。

**目錄名比對會不會誤殺?** 現在不會:repo 裡(tracked 與磁碟上)沒有任何叫 `worktrees` 的目錄。

```
$ git ls-files | grep -E '(^|/)worktrees/' | wc -l     → 0
$ find . -type d -name worktrees -not -path './node_modules/*' -not -path './.git/*'   → (無)
```

但拿**名字**認是脆弱的:哪天有人在 `docs/` 開個 `worktrees/` 放筆記,整個目錄就靜默不掃;
反過來,下一個巢狀簽出如果不叫 `worktrees`(例如 Orca 的 workspace 掛進來),照樣被掃。

### 改法

不用名字,用**有沒有 `.git`**(一般 repo 是目錄,worktree 是檔案,`existsSync` 兩種都認)認巢狀簽出:

```ts
function isNestedCheckout(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}
// walk(): if (isNestedCheckout(join(root, sub))) continue;
```

白名單那條測試的 fixture 跟著改:`worktrees/other/` **放一個 `.git` 檔**才跳過;
另加 `some-other-name/.git/`(目錄)也跳過、`worktrees/plain.md`(只是名字叫 worktrees)**照掃**。

拿同一套邏輯對主簽出跑一次(scratchpad 的 replica 腳本,邏輯與測試逐行相同):

```
== 舊邏輯(5a1c11a 之前)對 /data/python/llm_learning-cards ==
files scanned: 1051 | under .claude/worktrees: 435 | violation hits: 12(全在 .claude/worktrees/agent-*/ 底下)
== 新邏輯(.git 偵測)==
files scanned: 616  | under .claude/worktrees: 0   | skipped: [".claude/worktrees/agent-a551c3d51889a2793"] | violation hits: 0
== 對這個 worktree(沒有巢狀簽出)==
舊 496 / 新 496,兩邊都 0 違規 —— 自己這棵樹一個檔都沒少掃。
```

### 反向驗證:掃描沒有被弄壞

在**我們自己的** `docs/` 放一個含違規指令的 `.md`(內容是 `npx` + Stryker 子指令那一行):

```
$ npx vitest run scripts/mutate.test.ts -t "文件裡不准出現繞過鎖的指令"
 FAIL  … > 沒有任何檔案教人用 npx / pnpm / yarn 直接叫 stryker
 AssertionError: 這些地方會讓下一輪審核繞過鎖:  docs/_tmp-review-violation.md:3: …
 FAIL  … > 沒有任何檔案寫著可以照抄的 Stryker CLI 子指令
 AssertionError: 還有可以照抄的 Stryker CLI 子指令:  docs/_tmp-review-violation.md:3: …
      Tests  2 failed | 5 passed | 105 skipped (112)
```

兩條都抓到。檔案已刪,`git status` 乾淨。

---

## 二、鎖路徑斷言加 `inWorktree` 守衛 —— 放寬,退回

### 協調者的說法【推】

「那條測試內建了『一定在 worktree 裡跑』的假設。在 worktree 裡兩者不同 → 綠;在 main 上兩者本來就相同 → 永遠紅。」
診斷這半句是對的。**修法不對。**

### 驗證【驗】

正面斷言 `expect(seen).toBe(strykerLockPath())` **沒被動**。問題在守衛本身:

```ts
const inWorktree = strykerLockPath() !== join(REPO_ROOT, '.stryker.lock');
if (inWorktree) expect(seen).not.toBe(join(REPO_ROOT, '.stryker.lock'));
```

`inWorktree` 是拿**被測的函式自己**算的。函式算錯成 worktree 本地路徑時,
`strykerLockPath()` 恰好等於 `join(REPO_ROOT, '.stryker.lock')`,`inWorktree` 變 false,
斷言被跳過 —— **綠的是它自己,不是實作。** 這條的反向斷言在任何位置都不可能再紅。

實測:把 `strykerLockPath` 改成 `return join(cwd, LOCK_FILENAME)`,**在這個 worktree 裡跑**:

```
$ npx vitest run scripts/mutate.test.ts -t "不給 lockPath 時用 strykerLockPath"
      Tests  1 passed | 111 skipped (112)          ← 該紅沒紅 = 放寬
$ npx vitest run scripts/mutate.test.ts -t "^strykerLockPath"
 FAIL  strykerLockPath > 兩個不同 worktree 算出來是同一個鎖路徑
 FAIL  strykerLockPath > worktree 與主 repo 算出來也是同一個
 FAIL  strykerLockPath > 鎖就在主 repo 的 .git 旁邊,檔名 .stryker.lock
 FAIL  strykerLockPath > worktree 的子目錄算出來還是同一個
      Tests  4 failed | 1 passed                    ← §1 的直接測試還守著
```

所以**整體**沒有失守(§1 在臨時 git repo 裡蓋兩個 worktree 直接驗 `strykerLockPath(cwd)`,
本來就不看套件跑在哪),但 `5a1c11a` 那條的反向斷言已經是裝飾,依規則判**放寬 → 退回**。

### 改法(不依賴「現在在哪」)

1. 那條測試只留它真正能保證的東西:**委派**。
   `expect(seen).toBe(strykerLockPath())` 加 `expect(seen).toBe(strykerLockPath(process.cwd()))`,
   拿掉 `inWorktree` 那兩行,註解寫明為什麼那個守衛是套套邏輯。
2. 新增一條行程層級的測試(§12,`describe('鎖的位置不看測試套件自己在哪裡跑')`):
   自己 `git init` 一個主 repo、掛一個 worktree,用既有的 `sandboxWithFakeStryker` 沙盒,
   **子行程的 cwd 設成那個 worktree、不傳 `lockPath`**,等假 stryker 起來之後斷言
   `main/.stryker.lock` 存在、`wtA/.stryker.lock` 不存在。套件在 main 或任何 worktree 裡跑,測的都是同一件事。

同一個破壞再跑一次:

```
$ npx vitest run scripts/mutate.test.ts -t "鎖的位置不看測試套件|不給 lockPath 時用 strykerLockPath"
 FAIL  鎖的位置不看測試套件自己在哪裡跑 > 從 worktree 裡起跑、不給 lockPath:鎖落在主 repo 的根,不是那個 worktree 的根
 AssertionError: 主 repo 的根沒有鎖:: expected false to be true
      Tests  1 failed | 1 passed | 111 skipped (113)   ← 現在會紅
```

`scripts/mutate.ts` 已還原(`git status` 只剩測試檔)。

---

## 三、兩份文件改寫 —— 文件錯,測試對

那組測試的註解確實寫著(`scripts/mutate.test.ts`,「沒有任何檔案寫著可以照抄的 Stryker CLI 子指令」那條):

> 連在說明文字裡都不要出現——下一輪的人 grep 到會以為還沒改完,或更糟:直接照抄。要提到那條路就寫「Stryker CLI」。

兩處都命中規則:`coordinator-practices-2026-09-04.md` 第 170 行原本是 `npx` + 子指令(兩條規則都中),
`REVIEW.md` §7 標題原本是 `npx` 接 Stryker 的套件名(中第一條規則:套件管理員 + stryker,不需要子指令)。
它們是在 mutate-lock 分支在飛的時候寫進 main 的,所以分支上綠、合併後紅 —— 這正是這條守門存在的目的。

語意沒有失真:

- 第 170 行:「我的審核工單模板全部寫 `npx …`」→「全部直接叫 Stryker CLI(而不是 `npm run mutate`)」。
  仍然是在描述一個錯誤,還多說了正確的那條路。
- §7 標題:「`npm run mutate --`,不是 `npx` 接 Stryker」→「一律 `npm run mutate --`,不要直接叫 Stryker CLI —— 那會繞過鎖」。
  同義,多了理由。

不退回。

---

## 四、協調者說沒動的兩道防護 —— 【驗】都在,都還會紅

| 防護 | 在? | 破壞一次 |
|---|---|---|
| `expect(files.length).toBeGreaterThan(20)` | 在(這條測試名「這個掃描器不是空掃」) | 改成 `> 1000000` → `AssertionError: expected 496 to be greater than 1000000`,1 failed |
| 拿假違規行餵規則(「掃描器真的抓得到」) | 在 | 第一個 `toBe(true)` 改 `toBe(false)` → `AssertionError: expected true to be false`,1 failed |

兩次破壞都已還原。

---

## 五、驗收

| 檢查 | 結果 |
|---|---|
| `npm run boundaries` | PASS(205 檔,0 違規) |
| `npm run typecheck` | PASS |
| `npm run lint:docs` | PASS(66 md,20 連結) |
| `npx vitest run` | **89 files / 1780 passed**(main 1779 + 新增 1 條) |
| `npm run accept:dry` | 0 ambiguous(150 undefined 是既有的) |
| `npm run check:steps` | PASS(1943 步驟句,0 重複) |
| `npm run accept:coverage` | PASS(38 phase 檔) |

### 變異測試

兩份都跑了(先跑與 94.25% 基準線同設定的那份,再跑工單字面上的指令;兩份都經過 `npm run mutate` 的鎖,
跑的時候 `/data/python/llm_learning-cards/.stryker.lock` 在,跑完不在)。

**(一)與基準線同設定(可比的那一份)**

```
$ npm run mutate -- stryker.scanner-mutatelock.json
           | % Mutation score |          |           |            |          |          |
File       |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
All files  |  94.25 |   94.98 |      237 |         9 |         13 |        2 |        0 |
Final mutation score of 94.25 is greater than or equal to break threshold 0    (exit 0, 3m34s)
```

**94.25% / covered 94.98%,killed 237、survived 13,與基準線一字不差。** 沒有低於 94.25。

**(二)工單字面上的指令(預設設定,有 TypeScript checker)**

```
$ npm run mutate -- --mutate "scripts/mutate.ts,!scripts/mutate.test.ts"
           | % Mutation score |          |           |            |          |          |
File       |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
All files  |  91.16 |   92.41 |      128 |         6 |         11 |        2 |      114 |
Final mutation score of 91.16 is greater than or equal to break threshold 60   (exit 0, 6m20s)
```

跟上一次覆核(`docs/reviews/date-dependent-lock-tests.md`)量到的 91.16 / 92.41 一字不差。
這條本來就到不了 94.25:TypeScript checker 先擋掉 114 個突變體,分母不同,不能拿來跟基準線比 ——
那份覆核已經寫過「未來要卡 `scripts/mutate.ts` 的分數,指令應該寫 `npm run mutate -- stryker.scanner-mutatelock.json`」,
這次的工單還是寫了 `--mutate` 那條,建議協調者的工單模板改過來。

---

## 六、給協調者的兩件事

1. **「別的 repo」這種事實要用 `git worktree list` / `cat .git` 驗過再寫進註解。** 這次的結論碰巧對,理由錯;
   下一個人照著錯的理由推,就會以為「只要是 template 的東西都可以跳過」。
2. **守衛不能拿被測函式自己算。** `if (f() !== X) expect(f()).not.toBe(X)` 這種形狀永遠綠,
   要嘛在測試裡自己造出兩種環境(這次的做法),要嘛只斷言委派、把保證交給已經不依賴環境的那組測試。
