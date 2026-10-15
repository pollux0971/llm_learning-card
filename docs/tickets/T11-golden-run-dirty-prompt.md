---
id: T11
deps: []
touches: [packages/core/src/prompt-quality/golden-run.ts, packages/core/src/prompt-quality/cli.ts, packages/core/src/prompt-quality/types.ts]
cpu: light
budget_usd: 2
status: todo
owner: worker-grok
must_catch:
  - prompt 檔已追蹤、工作區有修改,meta 的 promptFileGitCommit 卻是乾淨的 sha
  - 只查工作區(git diff)不查暫存區(git diff --cached):修改已 git add 時記成乾淨
  - 只查暫存區不查工作區
  - dirty 的判斷看整個 repo 而不是只看這個 prompt 檔(別的檔案髒就誤標)
  - --live 沒帶 --out、prompt 是 dirty,仍然寫進 golden/(或仍然呼叫了 router、花了錢)
  - 拒絕之後留下目錄(golden/ 底下多出空的 run 目錄)
  - 用 --out 指回 golden/(含不存在的子目錄、golden/ 本身、`..` 繞回、symlink 繞進、root 本身是 symlink)繞過拒絕
  - 輸出目錄在 golden/ 以外(mkdtemp)的 dirty 被拒絕(應該照常寫,只是 meta 是 -dirty)
  - 路徑比對用字串前綴,把 golden-fake/、golden-extra/ 當成 golden/ 底下
  - 沒追蹤或還沒有 commit 的檔案被標成 uncommitted-dirty(既有的 uncommitted 要維持原樣)
---

# 工單 T11:golden run 的 meta 不能把 dirty 的 prompt 記成乾淨的 commit

> 狀態:草稿,待技術顧問審(派令與「也要拒絕」的裁決來自顧問 2026-10-15)。**這是修 bug,不是取捨,不寫 ADR。**
> 作者:統籌·契約(測試 agent 身分寫紅測試)。派工:協調者。驗收:-ed。
> 這份檔是工單唯一的正本。

## 起因

`packages/core/src/prompt-quality/golden-run.ts` 的 `gitCommitOf` 只用 `git log -1 --format=%h -- <檔>`:
檔案沒被追蹤、或還沒有 commit 時回 `uncommitted`;**檔案已追蹤、工作區卻有未提交的修改**,它照樣回最後一次 commit 的 sha。
協調者 2026-10-15 改壞 `cards.md` 做實驗時,`meta.json` 的 `promptFileGitCommit` 記的是 `a2a6669`——出處是錯的。
`regression.ts` 的 `detectPromptDrift` 拿這個欄位當基準的出處,之後拿它判斷「prompt 有沒有被改過」會誤判。

## 要求

1. **偵測 dirty**:`git diff --quiet -- <檔>` 與 `git diff --cached --quiet -- <檔>` **只要其中一個不為 0**,
   `gitCommitOf` 回 `<短 sha>-dirty`。只看這個 prompt 檔,不看整個 repo。
   沒追蹤、沒有 commit、不是 git repo:維持 `uncommitted`(不加後綴)。
2. **拒絕規則看解析後的輸出路徑,不看有沒有帶 `--out`**(顧問 2026-10-15 裁決;理由:`golden/` 是回歸基準,基準必須能用某個 commit 的 prompt 重現,
   dirty 的 prompt 不屬於任何 commit,meta 誠實標了 `-dirty` 也不能當基準):
   **prompt 是 dirty,而且輸出目錄的 realpath 落在 `<root>/packages/core/src/prompt-quality/golden/` 底下(含它本身)→ 拒絕。**
   - 沒給 `baseDir`(live 預設就是 `golden/`)當然被拒絕;`--out` 指進 `golden/`(不存在的子目錄、`golden/` 本身、`..` 繞回、symlink 繞進)同樣拒絕。
   - `baseDir` 還不存在時,取最近一個存在的祖先做 realpath 再接回剩下的路徑;`golden/` 自己的位置也要 realpath(`root` 本身可能是 symlink)。
   - 「底下」比路徑邊界:`golden-fake/`、`golden-extra/` 不是 `golden/` 底下。
   - 丟 `DirtyPromptError`,**在任何 `router.call` 之前、在建立任何目錄之前**(不花錢、不留空目錄)。
   - CLI:退出碼非 0,訊息講明原因:哪個 prompt 檔 dirty、先提交,或用 `--out` 指到 `golden/` 以外。
   - 規則不分 mode(顧問原話沒有限定 live);fake 預設存 `golden-fake/`,碰不到,只有 `--out` 指進 `golden/` 時才會被拒絕。
3. **輸出目錄在 `golden/` 以外**(例如 mkdtemp 的 `--out`):照常寫,`meta.promptFileGitCommit` 仍是 `-dirty`。
   prompt 乾淨時不受影響(`--out` 指進 `golden/` 也照常寫)。
4. **fake 模式**:不拒絕(預設存 `golden-fake/`,不進 git);`meta` 同樣記 `-dirty`。
5. `types.ts` 裡 `promptFileGitCommit` 的註解更新(多了 `-dirty` 後綴的說明)。

## 介面(測試釘住的,細節見 `packages/core/src/prompt-quality/dirty-prompt.test.ts` 檔頭)

| 項目 | 形狀 |
|---|---|
| `gitCommitOf(relPath, root?)` | 新增匯出;`root` 預設 `ROOT` |
| `RunGoldenOptions.root?` | 讀 prompt 檔與問 git 的 repo 根,預設 `ROOT` |
| `defaultGoldenBaseDir(mode, root?)` | `root` 給了,預設存放處搬到 `<root>/packages/core/src/prompt-quality/golden` 或 `golden-fake` |
| `DirtyPromptError` | 新增匯出,`name`、`set`、`promptFile`;訊息含 prompt 檔相對路徑與 `--out` |
| `main(argv, deps?: { root? })` | `root` 原樣傳給 `runGolden` |

`root` 是為了讓測試能在 mkdtemp 的 git repo 裡做,**不碰真的 `prompts/`、真的 `golden/`**。預設值要讓既有呼叫的行為完全不變。

## 不在範圍 / 未裁決

- 既有的 `golden/` 基準裡舊的 `promptFileGitCommit` 值不改。
- `detectPromptDrift` 的行為不改:`<sha>-dirty` 不等於任何乾淨的 sha,所以以 dirty 當基準時會被報成漂移——這是想要的(dirty 基準本來就不該被當成乾淨的出處)。

## 驗收條件

1. `packages/core/src/prompt-quality/dirty-prompt.test.ts` 全綠(34 條,**測試已經寫好**)。
2. 既有的 `packages/core/src/prompt-quality` 全部測試仍綠(292 條含新的);`tsc` 0 錯;`npm run boundaries`、`lint:docs` PASS。
3. 跑完測試後,真的 `golden/` 與 `golden-fake/` 沒有任何新增或變動(測試自己的 afterEach 也會量)。
4. 不跑 `--live`、不花錢;不碰真的 `prompts/`。

## 測試誰寫

- 測試 agent:上面全部(已寫)。base 上:`tsc` 0 錯、34 條全紅(原因:`gitCommitOf` / `DirtyPromptError` 沒匯出、`root` 不被認)。
  丟棄式實作(約 30 行,不進 git)讓 `prompt-quality` 資料夾 292 條全綠;16 條突變
  (只查工作區、只查暫存區、永不 dirty、`git diff` 不限定檔案、不拒絕、有給 `baseDir` 就不查、不查 dirty、fake 不查、後綴寫錯、`uncommitted-dirty`、CLI 沒接住錯誤、
  golden/ 不做 realpath、輸出不做 realpath、字串前綴比對、不含 golden/ 本身)全部變紅。
- 開發 agent(worker-grok):只寫 `golden-run.ts`、`cli.ts`、`types.ts` 註解。**不改測試**,不跑變異測試。
- 驗收(-ed):照 `worker-acceptance`;`gitCommitOf` 是小函式,變異門檻沿用 `prompt-quality` 現行設定。

## 預算

`budget_usd: 2`(草估)。實際超過 2 倍要在報告標出。
